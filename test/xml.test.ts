import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  complex,
  FhirXmlError,
  ISSUE_CODES,
  isList,
  isPrimitive,
  isRetracted,
  list,
  nodesEquivalent,
  parseResource,
  parseResourceXml,
  primitive,
  readRawXml,
  readSafety,
  resourceType,
  serializeResource,
  serializeResourceXml,
  XML_FATAL_CODES,
  type FhirComplex,
} from "../src/index.js";
import { req } from "./_util.js";

const FHIR_NS = 'xmlns="http://hl7.org/fhir"';

/** Load a fixture as its exact text (fixtures carry no trailing newline). */
function fixture(name: string): string {
  return readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");
}

/** The paired JSON + XML golden files, the same resource in both wire formats. */
const PAIRS = [
  "patient",
  "observation-decimals",
  "primitive-extensions",
  "value-absent",
  "extension-only-list",
  "bundle",
  "patient-narrative",
] as const;

describe("XML byte-identical round-trip (golden files)", () => {
  it.each(PAIRS)("round-trips %s.xml byte-for-byte", (name) => {
    const source = fixture(`${name}.xml`);
    const { resource } = parseResourceXml(source);
    expect(serializeResourceXml(resource)).toBe(source);
  });

  it("is idempotent (a second round-trip changes nothing)", () => {
    for (const name of PAIRS) {
      const once = serializeResourceXml(parseResourceXml(fixture(`${name}.xml`)).resource);
      const twice = serializeResourceXml(parseResourceXml(once).resource);
      expect(twice).toBe(once);
    }
  });

  it("preserves decimal trailing zeros and 64-bit magnitude (never through a number)", () => {
    const out = serializeResourceXml(
      parseResourceXml(fixture("observation-decimals.xml")).resource,
    );
    expect(out).toContain('value="70.0"');
    expect(out).toContain('value="0.010"');
    expect(out).toContain('value="0.0000000010"');
    expect(out).toContain('value="9223372036854775807"');
  });
});

describe("JSON↔XML model equivalence", () => {
  it.each(PAIRS)(
    "the same resource parses to an equivalent model from JSON and XML: %s",
    (name) => {
      const fromJson = parseResource(fixture(`${name}.json`)).resource;
      const fromXml = parseResourceXml(fixture(`${name}.xml`)).resource;
      expect(nodesEquivalent(fromJson, fromXml)).toBe(true);
      // …and symmetrically.
      expect(nodesEquivalent(fromXml, fromJson)).toBe(true);
    },
  );

  it.each(PAIRS)("serializing the JSON-parsed model to XML equals the XML golden: %s", (name) => {
    const fromJson = parseResource(fixture(`${name}.json`)).resource;
    expect(serializeResourceXml(fromJson)).toBe(fixture(`${name}.xml`));
  });

  it("distinguishes non-equivalent models", () => {
    const a = parseResource('{"resourceType":"Patient","active":true}').resource;
    const b = parseResource('{"resourceType":"Patient","active":false}').resource;
    expect(nodesEquivalent(a, b)).toBe(false);
    // Different property count.
    const c = parseResource('{"resourceType":"Patient","active":true,"id":"x"}').resource;
    expect(nodesEquivalent(a, c)).toBe(false);
  });

  it("treats a boolean/decimal (JSON) as equivalent to its lexical string (XML)", () => {
    const json = parseResource(
      '{"resourceType":"Observation","valueQuantity":{"value":0.010}}',
    ).resource;
    const xml = parseResourceXml(
      `<Observation ${FHIR_NS}><valueQuantity><value value="0.010"/></valueQuantity></Observation>`,
    ).resource;
    expect(nodesEquivalent(json, xml)).toBe(true);
  });

  it("treats a singleton list as equivalent to a single node (array vs one element)", () => {
    const jsonList = parseResource('{"resourceType":"Patient","name":[{"family":"X"}]}').resource;
    const xmlSingle = parseResourceXml(
      `<Patient ${FHIR_NS}><name><family value="X"/></name></Patient>`,
    ).resource;
    expect(nodesEquivalent(jsonList, xmlSingle)).toBe(true);
  });

  it("does not treat a two-item list as equivalent to a one-item list", () => {
    const one = parseResource('{"resourceType":"Patient","name":[{"family":"X"}]}').resource;
    const two = parseResource(
      '{"resourceType":"Patient","name":[{"family":"X"},{"family":"Y"}]}',
    ).resource;
    expect(nodesEquivalent(one, two)).toBe(false);
  });

  it("compares multi-item lists by length then element-wise", () => {
    const two = list([primitive("A"), primitive("B")]);
    const three = list([primitive("A"), primitive("B"), primitive("C")]);
    expect(nodesEquivalent(two, three)).toBe(false); // length mismatch
    expect(nodesEquivalent(two, list([primitive("A"), primitive("B")]))).toBe(true);
    expect(nodesEquivalent(two, list([primitive("A"), primitive("Z")]))).toBe(false); // item mismatch
  });

  it("compares a primitive's extensions by count and content", () => {
    const withExt = primitive("v", {
      extension: [complex([{ name: "url", value: primitive("x") }])],
    });
    const noExt = primitive("v");
    expect(nodesEquivalent(withExt, noExt)).toBe(false); // extension-count mismatch
    const other = primitive("v", {
      extension: [complex([{ name: "url", value: primitive("y") }])],
    });
    expect(nodesEquivalent(withExt, other)).toBe(false); // extension-content mismatch
  });
});

describe("XML reader: schema-free model mapping", () => {
  it("synthesizes resourceType from the root element name", () => {
    const { resource } = parseResourceXml(`<Patient ${FHIR_NS}/>`);
    const rt = req(resource.properties[0]);
    expect(rt.name).toBe("resourceType");
    expect(isPrimitive(rt.value) && rt.value.value).toBe("Patient");
  });

  it("keeps a primitive value as its exact lexical string (no datatype coercion)", () => {
    const { resource } = parseResourceXml(`<Patient ${FHIR_NS}><active value="true"/></Patient>`);
    const active = req(resource.properties.find((p) => p.name === "active")).value;
    expect(isPrimitive(active) && active.value).toBe("true"); // string, not boolean
  });

  it("accepts an already-parsed XmlElement tree", () => {
    const tree = readRawXml(`<Patient ${FHIR_NS}><id value="z"/></Patient>`);
    const { resource } = parseResourceXml(tree);
    const id = req(resource.properties.find((p) => p.name === "id")).value;
    expect(isPrimitive(id) && id.value).toBe("z");
  });

  it("reads Element.id (attribute) and Extension.url (attribute) as properties", () => {
    const { resource } = parseResourceXml(
      `<Patient ${FHIR_NS}><name id="n1"><given value="J"><extension url="http://x"><valueBoolean value="true"/></extension></given></name></Patient>`,
    );
    const name = req(resource.properties.find((p) => p.name === "name")).value as FhirComplex;
    expect(name.properties[0]?.name).toBe("id"); // id attribute → leading property
  });

  it("decodes predefined and numeric character references", () => {
    const { resource } = parseResourceXml(
      `<Patient ${FHIR_NS}><name><family value="A&amp;B &lt;x&gt; &#65;&#x42;"/></name></Patient>`,
    );
    const name = req(resource.properties.find((p) => p.name === "name")).value as FhirComplex;
    const family = req(name.properties.find((p) => p.name === "family")).value;
    expect(isPrimitive(family) && family.value).toBe("A&B <x> AB");
  });

  it("skips the XML declaration, comments, and processing instructions", () => {
    const { resource, issues } = parseResourceXml(
      `<?xml version="1.0" encoding="UTF-8"?><!-- lead --><Patient ${FHIR_NS}><!-- inner --><active value="true"/><?pi data?></Patient>`,
    );
    expect(issues).toHaveLength(0);
    expect(resource.properties.some((p) => p.name === "active")).toBe(true);
  });

  it("flags an unexpected default namespace (lenient: preserved)", () => {
    const { issues } = parseResourceXml(
      `<Patient xmlns="http://example.com/wrong"><active value="true"/></Patient>`,
    );
    expect(issues.some((i) => i.code === ISSUE_CODES.UNEXPECTED_XML_CONTENT)).toBe(true);
  });

  it("flags stray character data on a FHIR element", () => {
    const { issues } = parseResourceXml(
      `<Patient ${FHIR_NS}>stray<active value="true"/></Patient>`,
    );
    expect(issues.some((i) => i.code === ISSUE_CODES.UNEXPECTED_XML_CONTENT)).toBe(true);
  });

  it("flags an unknown attribute but preserves the element", () => {
    const { issues } = parseResourceXml(
      `<Patient ${FHIR_NS}><active value="true" foo="bar"/></Patient>`,
    );
    expect(issues.some((i) => i.code === ISSUE_CODES.UNKNOWN_PROPERTY)).toBe(true);
  });

  it("carries narrative <div> as an opaque XHTML string: conformant emit, no data loss on round-trip", () => {
    const src = `<Patient ${FHIR_NS}><text><status value="generated"/><div xmlns="http://www.w3.org/1999/xhtml"><p class="lead">Hi &amp; bye</p><br/></div></text></Patient>`;
    const { resource, issues } = parseResourceXml(src);
    expect(issues).toHaveLength(0); // fully carried (like FHIR JSON), not flagged unsupported
    const text = req(resource.properties.find((p) => p.name === "text")).value as FhirComplex;
    const div = req(text.properties.find((p) => p.name === "div")).value;
    // The full <div> element (wrapper + xmlns) is preserved, exactly the FHIR JSON representation.
    expect(isPrimitive(div) && div.value).toBe(
      '<div xmlns="http://www.w3.org/1999/xhtml"><p class="lead">Hi &amp; bye</p><br/></div>',
    );
    // Conformant strict-emit: a real <div>…</div>, never an escaped `<div value="…">` attribute.
    const out = serializeResourceXml(resource);
    expect(out).not.toContain("div value=");
    expect(out).toBe(src); // byte-identical round-trip, no narrative lost
    // …and a second round-trip is stable (the narrative survives re-reading).
    expect(serializeResourceXml(parseResourceXml(out).resource)).toBe(src);
  });

  it("flags a misplaced value attribute and an unknown attribute on a resource/complex element", () => {
    const { issues } = parseResourceXml(`<Patient ${FHIR_NS} value="x" foo="1"/>`);
    expect(issues.filter((i) => i.code === ISSUE_CODES.UNKNOWN_PROPERTY)).toHaveLength(2);
  });

  it("flags an unknown attribute on a nested complex element", () => {
    const { issues } = parseResourceXml(
      `<Patient ${FHIR_NS}><code foo="1"><text value="t"/></code></Patient>`,
    );
    expect(issues.some((i) => i.code === ISSUE_CODES.UNKNOWN_PROPERTY)).toBe(true);
  });

  it("flags a non-extension child on a value-bearing primitive (kept as a primitive)", () => {
    const { resource, issues } = parseResourceXml(
      `<Patient ${FHIR_NS}><active value="true"><bogus value="1"/></active></Patient>`,
    );
    expect(issues.some((i) => i.code === ISSUE_CODES.UNKNOWN_PROPERTY)).toBe(true);
    const active = req(resource.properties.find((p) => p.name === "active")).value;
    expect(isPrimitive(active) && active.value).toBe("true");
  });
});

describe("XML writer", () => {
  it("names the root Resource when the model carries no resourceType", () => {
    const model = parseResource('{"active":true}').resource; // no resourceType
    expect(serializeResourceXml(model)).toBe(
      `<Resource ${FHIR_NS}><active value="true"/></Resource>`,
    );
  });

  it("escapes control characters in attribute values round-trip-safe", () => {
    const model = parseResource('{"resourceType":"Patient","id":"a\\tb\\nc"}').resource;
    const xml = serializeResourceXml(model);
    expect(xml).toContain("&#9;");
    expect(xml).toContain("&#10;");
    const back = req(parseResourceXml(xml).resource.properties.find((p) => p.name === "id")).value;
    expect(isPrimitive(back) && back.value).toBe("a\tb\nc");
  });

  it("emits Element.id as an attribute (not a child) on a non-resource complex", () => {
    const model = parseResource(
      '{"resourceType":"Patient","name":[{"id":"n1","family":"X"}]}',
    ).resource;
    expect(serializeResourceXml(model)).toContain('<name id="n1"><family value="X"/></name>');
  });

  it("omits an id attribute whose primitive carries no value (defensive)", () => {
    // A hand-built model where an element-level `id` primitive is value-absent.
    const model = complex([
      { name: "resourceType", value: primitive("Patient") },
      {
        name: "name",
        value: complex([
          { name: "id", value: primitive(undefined) },
          { name: "family", value: primitive("X") },
        ]),
      },
    ]);
    expect(serializeResourceXml(model)).toBe(
      `<Patient ${FHIR_NS}><name><family value="X"/></name></Patient>`,
    );
  });

  it("emits each item of a nested list as a repeated element (defensive)", () => {
    const model = complex([
      { name: "resourceType", value: primitive("Patient") },
      { name: "given", value: list([list([primitive("A"), primitive("B")])]) },
    ]);
    expect(serializeResourceXml(model)).toBe(
      `<Patient ${FHIR_NS}><given value="A"/><given value="B"/></Patient>`,
    );
  });
});

describe("XML reader: safety: XXE / billion-laughs / DoS (roadmap §6)", () => {
  it("refuses any DOCTYPE (closes XXE): loudly, before any element", () => {
    const xxe =
      '<!DOCTYPE foo [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>' +
      `<Patient ${FHIR_NS}><name><family value="&xxe;"/></name></Patient>`;
    expect(() => parseResourceXml(xxe)).toThrow(FhirXmlError);
    try {
      parseResourceXml(xxe);
    } catch (err) {
      expect(err).toBeInstanceOf(FhirXmlError);
      expect((err as FhirXmlError).code).toBe(XML_FATAL_CODES.DTD_FORBIDDEN);
      expect((err as FhirXmlError).message).not.toContain("etc/passwd");
    }
  });

  it("refuses a billion-laughs DOCTYPE (no entity is ever declared)", () => {
    const bomb =
      '<!DOCTYPE lolz [ <!ENTITY lol "lol"> <!ENTITY lol2 "&lol;&lol;&lol;"> ]>' +
      `<Patient ${FHIR_NS}><name><family value="&lol2;"/></name></Patient>`;
    let thrown: unknown;
    try {
      parseResourceXml(bomb);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(FhirXmlError);
    expect((thrown as FhirXmlError).code).toBe(XML_FATAL_CODES.DTD_FORBIDDEN);
  });

  it("refuses an undefined entity even without a DTD (second, independent guard)", () => {
    const xml = `<Patient ${FHIR_NS}><name><family value="&secret;"/></name></Patient>`;
    try {
      parseResourceXml(xml);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(FhirXmlError);
      expect((err as FhirXmlError).code).toBe(XML_FATAL_CODES.UNDEFINED_ENTITY);
      // Value-free: the diagnostic must not echo the offending entity name.
      expect((err as FhirXmlError).message).not.toContain("secret");
    }
  });

  it("refuses an undefined entity in text content too", () => {
    const xml = `<Patient ${FHIR_NS}><name><family value="x"/>&oops;</name></Patient>`;
    expect(() => parseResourceXml(xml)).toThrow(
      expect.objectContaining({ code: XML_FATAL_CODES.UNDEFINED_ENTITY }),
    );
  });

  it("refuses a malformed numeric character reference", () => {
    const xml = `<Patient ${FHIR_NS}><name><family value="&#xZZ;"/></name></Patient>`;
    expect(() => parseResourceXml(xml)).toThrow(
      expect.objectContaining({ code: XML_FATAL_CODES.UNDEFINED_ENTITY }),
    );
  });

  it("refuses a numeric character reference outside the Unicode range", () => {
    const xml = `<Patient ${FHIR_NS}><name><family value="&#x110000;"/></name></Patient>`;
    expect(() => parseResourceXml(xml)).toThrow(
      expect.objectContaining({ code: XML_FATAL_CODES.UNDEFINED_ENTITY }),
    );
  });

  it("bounds nesting depth with a typed error (no stack overflow)", () => {
    const deep = "<a>".repeat(300) + "</a>".repeat(300);
    try {
      readRawXml(deep);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(FhirXmlError);
      expect((err as FhirXmlError).code).toBe(XML_FATAL_CODES.MAX_DEPTH_EXCEEDED);
    }
  });
});

describe("XML reader: well-formedness fatals", () => {
  const cases: readonly (readonly [string, string])[] = [
    ["empty document", "   "],
    ["unterminated tag", `<Patient ${FHIR_NS}`],
    ["mismatched end tag", `<Patient ${FHIR_NS}><name></wrong></Patient>`],
    ["unclosed element", `<Patient ${FHIR_NS}><name>`],
    ["trailing content after root", `<Patient ${FHIR_NS}/><Extra/>`],
    ["CDATA section", `<Patient ${FHIR_NS}><x><![CDATA[hi]]></x></Patient>`],
    ["missing '=' in attribute", `<Patient ${FHIR_NS}><a value/></Patient>`],
    ["unquoted attribute value", `<Patient ${FHIR_NS}><a value=x/></Patient>`],
    ["'<' inside attribute value", `<Patient ${FHIR_NS}><a value="<"/></Patient>`],
    ["duplicate attribute", `<Patient ${FHIR_NS}><a value="1" value="2"/></Patient>`],
  ];

  it.each(cases)("throws MALFORMED_XML on %s", (_label, xml) => {
    try {
      parseResourceXml(xml);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(FhirXmlError);
      expect((err as FhirXmlError).code).toBe(XML_FATAL_CODES.MALFORMED_XML);
      expect((err as FhirXmlError).offset).toBeTypeOf("number");
    }
  });

  it("refuses a stray markup declaration inside content as a DTD refusal", () => {
    expect(() => parseResourceXml(`<Patient ${FHIR_NS}><!ELEMENT x></Patient>`)).toThrow(
      expect.objectContaining({ code: XML_FATAL_CODES.DTD_FORBIDDEN }),
    );
  });
});

/**
 * Namespace resolution. FHIR XML is defined in the `http://hl7.org/fhir` namespace, and XML lets a
 * document bind that namespace to a prefix rather than making it the default. `<f:Patient
 * xmlns:f="http://hl7.org/fhir">` and `<Patient xmlns="http://hl7.org/fhir">` are the same document,
 * so they must read to the same model: a prefix is a spelling, not part of the name.
 */
describe("XML reader: namespace prefixes are resolved, not modeled as part of the name", () => {
  const DEFAULT_NS = `<Observation ${FHIR_NS}><id value="o1"/><status value="entered-in-error"/><code><coding><system value="http://loinc.org"/><code value="718-7"/></coding></code></Observation>`;
  const PREFIXED = `<f:Observation xmlns:f="http://hl7.org/fhir"><f:id value="o1"/><f:status value="entered-in-error"/><f:code><f:coding><f:system value="http://loinc.org"/><f:code value="718-7"/></f:coding></f:code></f:Observation>`;

  it("reads a prefixed resource to the same model as the default-namespace spelling", () => {
    const plain = parseResourceXml(DEFAULT_NS);
    const prefixed = parseResourceXml(PREFIXED);
    expect(prefixed.issues).toEqual([]);
    expect(nodesEquivalent(prefixed.resource, plain.resource)).toBe(true);
    // The model carries local names, so it serializes to the identical spec-clean JSON.
    expect(serializeResource(prefixed.resource)).toBe(serializeResource(plain.resource));
  });

  it("resolves the synthetic resourceType from the local name, not the tag", () => {
    const { resource } = parseResourceXml(PREFIXED);
    const rt = req(resource.properties.find((p) => p.name === "resourceType")).value;
    expect(isPrimitive(rt) && rt.value).toBe("Observation");
    expect(resourceType(resource)).toBe("Observation");
  });

  it("READS THE RETRACTION a prefixed document used to hide: the safety-critical consequence", () => {
    // Before namespace resolution every element was named `f:status`, so the status spine saw no
    // `status` at all and a retracted result read as summarisable. This is the harm the defect had.
    const { resource } = parseResourceXml(PREFIXED);
    expect(readSafety(resource).retracted).toBe(true);
    expect(isRetracted(resource)).toBe(true);
    // The whole readout, not just the retraction: the two spellings are the same document, so the
    // status spine must not be able to tell them apart.
    expect(readSafety(resource)).toEqual(readSafety(parseResourceXml(DEFAULT_NS).resource));
  });

  it("groups repeats across different prefixes for the same namespace", () => {
    const { resource, issues } = parseResourceXml(
      `<Patient xmlns:a="http://hl7.org/fhir" xmlns:b="http://hl7.org/fhir" ${FHIR_NS}><a:name><family value="Roe"/></a:name><b:name><family value="Doe"/></b:name></Patient>`,
    );
    expect(issues).toEqual([]);
    const names = req(resource.properties.find((p) => p.name === "name")).value;
    expect(isList(names) && names.items.length).toBe(2);
  });

  it("unwraps a prefixed contained/resource-valued element", () => {
    const { resource, issues } = parseResourceXml(
      `<f:Bundle xmlns:f="http://hl7.org/fhir"><f:entry><f:resource><f:Patient><f:id value="p1"/></f:Patient></f:resource></f:entry></f:Bundle>`,
    );
    expect(issues).toEqual([]);
    expect(serializeResource(resource)).toBe(
      '{"resourceType":"Bundle","entry":{"resource":{"resourceType":"Patient","id":"p1"}}}',
    );
  });

  it("honours an inner re-binding of a prefix, so scope is nested and not global", () => {
    const { issues } = parseResourceXml(
      `<f:Patient xmlns:f="http://hl7.org/fhir"><f:contact xmlns:f="http://example.org/other"><f:name/></f:contact></f:Patient>`,
    );
    // The re-bound child leaves the FHIR namespace, and it is flagged where it leaves it: once, at
    // the boundary, not again on the descendant that merely inherits it.
    expect(issues.filter((i) => i.code === ISSUE_CODES.UNEXPECTED_XML_CONTENT)).toHaveLength(1);
  });

  it("flags a prefix bound to a namespace that is not FHIR", () => {
    const { issues } = parseResourceXml(
      `<f:Patient xmlns:f="http://example.org/not-fhir"><f:active value="true"/></f:Patient>`,
    );
    expect(issues.some((i) => i.code === ISSUE_CODES.UNEXPECTED_XML_CONTENT)).toBe(true);
  });

  it("flags an unresolvable prefix and keeps the tag verbatim rather than guessing a binding", () => {
    const { resource, issues } = parseResourceXml(
      `<Patient ${FHIR_NS}><f:active value="true"/></Patient>`,
    );
    expect(issues.some((i) => i.code === ISSUE_CODES.UNEXPECTED_XML_CONTENT)).toBe(true);
    // Not read as `active`: an undeclared prefix binds to nothing, so inventing a binding for it
    // would model an element under a name the document never gave it.
    expect(resource.properties.some((p) => p.name === "active")).toBe(false);
    expect(resource.properties.some((p) => p.name === "f:active")).toBe(true);
  });

  it("still flags a default namespace that is not FHIR, and an undeclaration of it", () => {
    expect(
      parseResourceXml(`<Patient xmlns="http://example.com/wrong"><active value="true"/></Patient>`)
        .issues,
    ).toContainEqual(expect.objectContaining({ code: ISSUE_CODES.UNEXPECTED_XML_CONTENT }));
    expect(
      parseResourceXml(`<Patient ${FHIR_NS}><active xmlns="" value="true"/></Patient>`).issues,
    ).toContainEqual(expect.objectContaining({ code: ISSUE_CODES.UNEXPECTED_XML_CONTENT }));
  });

  it("no longer reports a redundant FHIR namespace declaration as an unknown attribute", () => {
    // Re-declaring the namespace you are already in is legal XML and says nothing new. It used to
    // read as a stray attribute on a primitive (`.@xmlns`), which was a false positive.
    const { issues } = parseResourceXml(
      `<Patient ${FHIR_NS}><active ${FHIR_NS} value="true"/></Patient>`,
    );
    expect(issues).toEqual([]);
  });

  it("keeps the narrative <div> unflagged: XHTML is the one namespace FHIR requires it in", () => {
    const { issues } = parseResourceXml(
      `<Patient ${FHIR_NS}><text><status value="generated"/><div xmlns="http://www.w3.org/1999/xhtml"><p>Hi</p></div></text></Patient>`,
    );
    expect(issues).toEqual([]);
  });

  it("leaves a document with no namespace at all exactly as it read before", () => {
    const { resource, issues } = parseResourceXml(
      `<Patient><active value="true"/><name><family value="Roe"/></name></Patient>`,
    );
    expect(issues).toEqual([]);
    expect(serializeResource(resource)).toBe(
      '{"resourceType":"Patient","active":"true","name":{"family":"Roe"}}',
    );
  });

  it("resolves xml:lang without treating `xml` as an undeclared prefix", () => {
    const { issues } = parseResourceXml(
      `<Patient ${FHIR_NS}><name xml:lang="en"><family value="Roe"/></name></Patient>`,
    );
    // The attribute is still unmodeled (FHIR carries language in an element), but it is reported as
    // an unknown attribute rather than as an unresolvable namespace.
    expect(issues.map((i) => i.code)).toEqual([ISSUE_CODES.UNKNOWN_PROPERTY]);
  });
});
