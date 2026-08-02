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
  validateResource,
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
    // Two spellings of `{http://hl7.org/fhir}name`, so one element written twice: they group. The
    // widening that produces is reported, and nothing else is.
    expect(issues).toEqual([
      { code: ISSUE_CODES.MIXED_XML_SPELLING, severity: "warning", expression: "Patient.name" },
    ]);
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

  /**
   * An expanded name is a namespace AND a local name (Namespaces in XML 1.0 §6.1), so
   * `{urn:vendor}code` and `{http://hl7.org/fhir}code` are different names. Resolving a prefix away
   * without comparing the namespace it came from would merge foreign content into the FHIR element
   * beside it, letting a document assert FHIR content it never wrote in FHIR.
   *
   * **Every test in here spells the foreign content with a PREFIX, and that is the scope of the
   * claim.** Keeping the tag verbatim is what separates the two vocabularies, and only a prefixed
   * tag has anything to keep. Foreign content reached by a default declaration is the sibling block
   * below: it is modeled as the FHIR element it is spelled as, and reported.
   */
  describe("PREFIXED foreign-namespace content never joins a FHIR element's occurrences", () => {
    const VENDOR = 'xmlns:v="urn:vendor"';

    it("does not retire a true vital-signs unit error with a foreign sibling in category.coding", () => {
      const src = (extra: string) =>
        `<Observation ${FHIR_NS} ${VENDOR}><id value="w"/><status value="final"/>` +
        `<category><coding><system value="http://terminology.hl7.org/CodeSystem/observation-category"/>` +
        `<code value="vital-signs"/>${extra}</coding></category>` +
        `<code><coding><system value="http://loinc.org"/><code value="29463-7"/></coding></code>` +
        `<valueQuantity><value value="70"/><unit value="pounds"/><system value="http://unitsofmeasure.org"/><code value="lb"/></valueQuantity>` +
        `</Observation>`;
      const clean = validateResource(parseResourceXml(src("")).resource);
      expect(clean.valid).toBe(false);
      const withForeign = validateResource(
        parseResourceXml(src('<v:code value="vital-signs"/>')).resource,
      );
      // A weight in `lb` where R4 vital signs requires kg/g stays an error: the vendor element is
      // not a second FHIR `code`.
      expect(withForeign.valid).toBe(false);
      expect(withForeign.issues.map((i) => i.code)).toEqual(clean.issues.map((i) => i.code));
    });

    it("does not manufacture a no-known-allergy assertion from a foreign coding", () => {
      const src =
        `<AllergyIntolerance ${FHIR_NS} ${VENDOR}><id value="a"/>` +
        `<code><coding><system value="http://snomed.info/sct"/><code value="227493005"/></coding>` +
        `<v:code value="716186003"/></code></AllergyIntolerance>`;
      const safety = readSafety(parseResourceXml(src).resource);
      // 716186003 is "No known allergy". Asserting it over a record that names an allergen is a
      // positive clinical claim the sender never made in FHIR.
      expect(safety.noKnownAllergy).toBe(false);
      expect(safety.negations).toEqual([]);
    });

    it("does not lose a retraction to a foreign sibling in verificationStatus.coding", () => {
      const src =
        `<AllergyIntolerance ${FHIR_NS} ${VENDOR}><id value="a"/>` +
        `<verificationStatus><coding>` +
        `<system value="http://terminology.hl7.org/CodeSystem/allergyintolerance-verification"/>` +
        `<code value="entered-in-error"/><v:code value="confirmed"/>` +
        `</coding></verificationStatus></AllergyIntolerance>`;
      const { resource } = parseResourceXml(src);
      expect(readSafety(resource).retracted).toBe(true);
      expect(isRetracted(resource)).toBe(true);
    });

    it("does not promote a foreign extension into a primitive's FHIR extensions", () => {
      const { resource, issues } = parseResourceXml(
        `<Patient ${FHIR_NS} ${VENDOR}><birthDate value="1980-01-01"><v:extension url="urn:x"><v:valueBoolean value="true"/></v:extension></birthDate></Patient>`,
      );
      // Not re-emitted as a conformant FHIR extension the sender never wrote.
      expect(serializeResource(resource)).not.toContain("extension");
      expect(issues.some((i) => i.code === ISSUE_CODES.UNKNOWN_PROPERTY)).toBe(true);
    });

    it("does not unwrap a foreign resource-shaped element as a contained resource", () => {
      const { resource } = parseResourceXml(
        `<Bundle ${FHIR_NS} ${VENDOR}><entry><resource><v:Patient><v:id value="p"/></v:Patient></resource></entry></Bundle>`,
      );
      expect(serializeResource(resource)).not.toContain('"resourceType":"Patient"');
    });

    it("flags the foreign element rather than reading it silently", () => {
      const { issues } = parseResourceXml(
        `<Patient ${FHIR_NS} ${VENDOR}><name><v:family value="Roe"/></name></Patient>`,
      );
      expect(issues.some((i) => i.code === ISSUE_CODES.UNEXPECTED_XML_CONTENT)).toBe(true);
    });

    /**
     * The other half of the same rule, and the one that costs something. Two prefixes both bound to
     * the FHIR namespace are two spellings of ONE name, so an element written twice that way is a
     * genuinely repeated element and is read as one. That is the correct reading, and it is the
     * reading the same document gets when it is spelled one way, which is what this pins: the
     * MODEL and every verdict over it are identical, so the resolution decides nothing on its own,
     * it only stops misreading the second spelling as a separate junk property.
     *
     * What it does change is the **count** an element presents with, and that is not free: a check
     * that reads a `0..1` element as a single value gets nothing from a repeat. So the read carries
     * `MIXED_XML_SPELLING` at that element, which is the one channel on which the two documents
     * deliberately differ.
     */
    it("reads two spellings of one namespace exactly as it reads one spelling", () => {
      const doc = (second: string) =>
        `<Observation ${FHIR_NS} xmlns:z="http://hl7.org/fhir"><id value="w"/><status value="final"/>` +
        `<category><coding><system value="http://terminology.hl7.org/CodeSystem/observation-category"/>` +
        `<code value="vital-signs"/>${second}</coding></category>` +
        `<code><coding><system value="http://loinc.org"/><code value="29463-7"/></coding></code>` +
        `<valueQuantity><value value="70"/><unit value="pounds"/><system value="http://unitsofmeasure.org"/><code value="lb"/></valueQuantity>` +
        `</Observation>`;
      const twoSpellings = parseResourceXml(doc('<z:code value="vital-signs"/>')).resource;
      const oneSpelling = parseResourceXml(doc('<code value="vital-signs"/>')).resource;
      const verdict = (r: FhirComplex) => {
        const v = validateResource(r);
        const s = readSafety(r);
        return {
          valid: v.valid,
          issues: v.issues.map((i) => `${i.code}/${i.severity}@${i.expression}`).sort(),
          retracted: s.retracted,
          safeToSummarize: s.safeToSummarize,
          negations: [...s.negations].sort(),
        };
      };
      expect(serializeResource(twoSpellings)).toBe(serializeResource(oneSpelling));
      expect(verdict(twoSpellings)).toEqual(verdict(oneSpelling));
    });

    it("catches a retraction written through a second spelling, which a raw-tag read missed", () => {
      const { resource } = parseResourceXml(
        `<Observation ${FHIR_NS} xmlns:z="http://hl7.org/fhir"><id value="o"/><status value="final"/><z:status value="entered-in-error"/></Observation>`,
      );
      // Two `{http://hl7.org/fhir}status` elements: the safety spine reads every value written, so
      // the retraction is seen, and the `0..1` breach is reported rather than resolved.
      expect(readSafety(resource).retracted).toBe(true);
      const { valid, issues } = validateResource(resource);
      expect(issues.map((i) => i.code)).toContain("ARRAY_WRAPPED_SCALAR");
      expect(valid).toBe(false);
    });

    it("still keeps a PREFIXED div in a vendor namespace out of Narrative.div", () => {
      // Recognising the narrative by its expanded name did not widen this: `{urn:vendor}div` is not
      // `{xhtml}div`, and the prefixed spelling keeps its tag, so it cannot reach `Narrative.div`.
      // The UNPREFIXED spelling still can, and is pinned as the residual it is in the block below:
      // this test's scope is the prefixed one, and no claim anywhere may be wider.
      const { resource, issues } = parseResourceXml(
        `<Patient ${FHIR_NS} xmlns:v="urn:vendor"><text><status value="generated"/><v:div><v:p>Hi</v:p></v:div></text></Patient>`,
      );
      expect(serializeResource(resource)).not.toContain('"div"');
      expect(issues.some((i) => i.code === ISSUE_CODES.UNEXPECTED_XML_CONTENT)).toBe(true);
    });
  });

  /**
   * The narrative `<div>` is the one element FHIR *requires* in a namespace other than its parent's,
   * so it is the one element whose expanded name (`{http://www.w3.org/1999/xhtml}div`) is what the
   * reader keys on rather than the tag the document happened to spell it with.
   *
   * **Before this, a prefixed narrative was DESTROYED under a passing verdict**: `<h:div>` kept its
   * tag, failed the `div` test, was read as an empty complex (or vanished entirely when it held only
   * text), and the resource still validated `valid: true`: silent loss of clinical prose. The two
   * diagnostics it did draw were both at a `<withheld>` location, so they did not even name the
   * position. Every document here is legal, namespace-well-formed XML.
   */
  describe("the narrative <div> is recognised by its namespace, not its spelling", () => {
    const XHTML = "http://www.w3.org/1999/xhtml";
    const narrative = (patientAttrs: string, div: string) =>
      `<Patient ${FHIR_NS}${patientAttrs}><text><status value="generated"/>${div}</text></Patient>`;

    /** The whole reading of a document, so two spellings can be compared on everything at once. */
    const reading = (src: string) => {
      const { resource, issues } = parseResourceXml(src);
      const v = validateResource(resource);
      const s = readSafety(resource);
      return {
        issues: issues.map((i) => `${i.code}@${i.expression ?? ""}`).sort(),
        valid: v.valid,
        findings: v.issues.map((i) => `${i.code}/${i.severity}`).sort(),
        safeToSummarize: s.safeToSummarize,
        retracted: s.retracted,
        json: serializeResource(resource),
        xml: serializeResourceXml(resource),
      };
    };

    /** The narrative text a reading preserved, as a single searchable string. */
    const carried = (src: string) => {
      const r = reading(src);
      return { json: r.json, xml: r.xml };
    };

    /** The `Narrative.div` string a document read to, or `undefined` when it carried none. */
    const divOf = (json: string): unknown =>
      (JSON.parse(json) as { text?: { div?: unknown } }).text?.div;

    it("carries a prefixed narrative rather than destroying it", () => {
      const { json, xml } = carried(
        narrative(` xmlns:h="${XHTML}"`, "<h:div><h:p>Allergic to penicillin</h:p></h:div>"),
      );
      expect(json).toContain("Allergic to penicillin");
      expect(xml).toContain("Allergic to penicillin");
      // Modeled at `Narrative.div`, the property a consumer reads, not at a `h:div` it never looks at.
      expect(JSON.parse(json)).toMatchObject({
        text: {
          div: `<h:div xmlns:h="${XHTML}"><h:p>Allergic to penicillin</h:p></h:div>`,
        },
      });
    });

    it("carries a prefixed narrative that holds only text", () => {
      // The shape that vanished WITHOUT TRACE before: no element children, so the reader fell into
      // the primitive branch and produced a value-absent primitive the writer then omitted.
      const { json } = carried(
        narrative(` xmlns:h="${XHTML}"`, "<h:div>Allergic to penicillin</h:div>"),
      );
      expect(json).toContain("Allergic to penicillin");
    });

    it("reads a prefixed narrative exactly as it reads the same document spelled with a default xmlns", () => {
      // The headline: every observable of the read matches, modulo the narrative's own spelling,
      // which is preserved rather than rewritten.
      const prefixed = reading(narrative(` xmlns:h="${XHTML}"`, "<h:div><h:p>Hi</h:p></h:div>"));
      const dflt = reading(narrative("", `<div xmlns="${XHTML}"><p>Hi</p></div>`));
      expect(prefixed.issues).toEqual(dflt.issues);
      expect(prefixed.issues).toEqual([]);
      expect(prefixed.valid).toBe(dflt.valid);
      expect(prefixed.findings).toEqual(dflt.findings);
      expect(prefixed.safeToSummarize).toBe(dflt.safeToSummarize);
      expect(prefixed.retracted).toBe(dflt.retracted);
      // Same model shape, same property name; only the opaque string's spelling differs.
      const respell = (json: string): unknown =>
        JSON.parse(json.replace(/xmlns:h=/g, "xmlns=").replace(/h:/g, ""));
      expect(respell(prefixed.json)).toEqual(respell(dflt.json));
    });

    it("emits a prefixed narrative with its prefix bound, so the output is well-formed XML", () => {
      // Before, the writer re-emitted `h:` bound to nothing: the document did not re-parse.
      const src = narrative(` xmlns:h="${XHTML}"`, "<h:div><h:p>Hi</h:p></h:div>");
      const { xml } = carried(src);
      expect(xml).toContain(`<h:div xmlns:h="${XHTML}">`);
      // And it genuinely re-reads, to the same narrative.
      const reread = parseResourceXml(xml);
      expect(reread.issues).toEqual([]);
      expect(serializeResource(reread.resource)).toBe(carried(src).json);
    });

    it("carries the declarations the narrative inherited, so the fragment stands on its own", () => {
      // `Narrative.div` is a self-contained XHTML fragment; a binding written on an ancestor has to
      // travel with it or the string is not namespace-well-formed. Nothing is invented: the URI is
      // the one that was in scope where the document wrote the element.
      const { json } = carried(
        narrative(` xmlns:v="urn:vendor"`, `<div xmlns="${XHTML}"><v:x/></div>`),
      );
      expect(divOf(json)).toBe(`<div xmlns="${XHTML}" xmlns:v="urn:vendor"><v:x/></div>`);
    });

    it("leaves the implicit xml prefix alone, and leaves an unbound one exactly as written", () => {
      const withXmlLang = carried(
        narrative("", `<div xmlns="${XHTML}"><p xml:lang="en">x</p></div>`),
      );
      expect(divOf(withXmlLang.json)).toBe(`<div xmlns="${XHTML}"><p xml:lang="en">x</p></div>`);
      // `<f:div/>` with no `xmlns:f` in scope resolves to nothing, so it is NOT the narrative: the
      // unbound-prefix residual, unchanged.
      const unbound = reading(narrative("", "<f:div>x</f:div>"));
      expect(unbound.json).not.toContain('"div"');
      expect(unbound.issues.some((i) => i.startsWith(ISSUE_CODES.UNEXPECTED_XML_CONTENT))).toBe(
        true,
      );
    });

    it("escapes a `<` in an inherited namespace URI, so the emitted document stays well-formed", () => {
      // The raw reader refuses a literal `<` in an attribute but decodes `&lt;`, so a URI can carry
      // one. The writer emits `Narrative.div` verbatim, so an unescaped `<` in the fixup would put a
      // document out that is not well-formed XML and does not re-read: the exact defect this slice
      // closes, through a new door. One escaper serves both the element's attributes and the fixup.
      const src = narrative(` xmlns:v="urn:a&lt;b"`, `<div xmlns="${XHTML}"><v:x/>prose</div>`);
      const { xml } = carried(src);
      expect(divOf(carried(src).json)).toBe(
        `<div xmlns="${XHTML}" xmlns:v="urn:a&lt;b"><v:x/>prose</div>`,
      );
      // The whole point: it re-reads, to the same narrative.
      const reread = parseResourceXml(xml);
      expect(divOf(serializeResource(reread.resource))).toBe(divOf(carried(src).json));
    });

    /**
     * **What reading the narrative COSTS, pinned rather than glossed.**
     *
     * Carrying the element as a string necessarily stops modelling anything inside it as FHIR, so a
     * `<modifierExtension>` written inside a prefixed narrative no longer raises
     * `UNHANDLED_MODIFIER_EXTENSION`, and such a document goes from `valid: false` to `valid: true`.
     *
     * That is not a weakening, and the only yardstick that settles it is the **same document spelled
     * with a default `xmlns`**, not the previous release: the finding existed only because a prefixed
     * narrative was not recognised as one, and the unprefixed twin has read `valid: true` all along.
     * Nothing inside `Narrative.div` is a FHIR modifier extension. What this test pins is the two
     * spellings agreeing at head; the other half of the claim, that the default spelling read this
     * way on the previous release too, is a cross-version comparison no in-repo test can make and is
     * recorded in the changeset instead.
     */
    it("reads a prefixed narrative's insides as narrative, exactly as the default spelling does", () => {
      const inner = '<p><modifierExtension url="urn:x"/>Take 5 mg</p>';
      const prefixed = reading(
        narrative(
          ` xmlns:h="${XHTML}"`,
          '<h:div><h:p><h:modifierExtension url="urn:x"/>Take 5 mg</h:p></h:div>',
        ),
      );
      const dflt = reading(narrative("", `<div xmlns="${XHTML}">${inner}</div>`));
      // Not "the same as the previous release": the same as the twin, which is the bar.
      expect(prefixed.valid).toBe(dflt.valid);
      expect(prefixed.findings).toEqual(dflt.findings);
      expect(prefixed.safeToSummarize).toBe(dflt.safeToSummarize);
      expect(prefixed.issues).toEqual(dflt.issues);
      expect(prefixed.valid).toBe(true);
      expect(prefixed.json).toContain("Take 5 mg");
    });

    /**
     * `PRE-EXISTING`, identical for **every** spelling, and deliberately left open.
     *
     * A `<div>` holding exactly one capitalized child is taken by the resource-valued branch before
     * the narrative branch, so its prose is destroyed and it re-emits stripped of the XHTML
     * namespace, which then re-reads clean. Uppercase element names in a narrative are not exotic:
     * HTML-4-era generators emit `<BR>`, `<TABLE>`, `<P>`. Reordering the two branches would recover
     * it, and is a separate decision with its own blast radius, not one a change about how the
     * narrative is SPELLED gets to make.
     */
    it("still loses a narrative holding one capitalized child, identically for both spellings", () => {
      for (const src of [
        narrative("", `<div xmlns="${XHTML}"><Table>dose 5 mg</Table></div>`),
        narrative(` xmlns:h="${XHTML}"`, "<h:div><h:Table>dose 5 mg</h:Table></h:div>"),
      ]) {
        const { json } = carried(src);
        expect(json).not.toContain("dose 5 mg");
        expect(json).toContain('"resourceType":"Table"');
      }
      // The sharpest form, and the one to file: prose written BESIDE the capitalized child is
      // destroyed with ZERO diagnostics under `valid: true`, because the div's own text nodes are
      // never inspected once the child is read as a resource. Both spellings, and the prefixed one
      // reads exactly as the default one does rather than better.
      for (const src of [
        narrative("", `<div xmlns="${XHTML}">Take 5 mg<BR/></div>`),
        narrative(` xmlns:h="${XHTML}"`, "<h:div>Take 5 mg<h:BR/></h:div>"),
      ]) {
        const r = reading(src);
        expect(r.json).not.toContain("Take 5 mg");
        expect(r.issues).toEqual([]);
        expect(r.valid).toBe(true);
      }
      // What the route does still report, kept pinned: content read as FHIR because it came through
      // the resource-valued branch is still judged as FHIR, at a location that resolves.
      const { resource } = parseResourceXml(
        narrative(
          ` xmlns:h="${XHTML}"`,
          '<h:div><h:Table><h:modifierExtension url="urn:x"/></h:Table></h:div>',
        ),
      );
      const v = validateResource(resource);
      expect(v.valid).toBe(false);
      expect(v.issues.map((i) => `${i.code}@${i.expression ?? ""}`)).toContain(
        "UNHANDLED_MODIFIER_EXTENSION@Patient.text.div.modifierExtension",
      );
    });

    it("reports two spellings of the narrative as the repeat they are, rather than dropping one", () => {
      const { resource, issues } = parseResourceXml(
        narrative(` xmlns:h="${XHTML}"`, `<div xmlns="${XHTML}">A</div><h:div>B</h:div>`),
      );
      // Both are `{xhtml}div`, so they are one element written twice: grouped, both kept, and the
      // widened count reported exactly as it is for any other mixed spelling.
      expect(issues.map((i) => i.code)).toContain(ISSUE_CODES.MIXED_XML_SPELLING);
      const json = serializeResource(resource);
      expect(json).toContain(">A<");
      expect(json).toContain(">B<");
    });
  });

  /**
   * The other side of the same predicate, and the limit of the separation above.
   *
   * A foreign element reached by a **default** declaration (`<extension xmlns="urn:vendor">`) has no
   * prefix, so its tag IS the FHIR spelling. It therefore does everything the prefixed case cannot:
   * it groups with a FHIR sibling, satisfies the `extension` test, reads as a resource name, and
   * reads as the narrative `div`. That is not a regression, it is what a reader that did not resolve
   * namespaces at all already did, and these pin it as the residual it is.
   *
   * **What must hold is that none of it is silent.** `UNEXPECTED_XML_CONTENT` is raised at every one
   * of those positions, which is the guarantee that covers all foreign content rather than only the
   * prefixed half. These four documents each lost that diagnostic once, because the extension and
   * resource-unwrap branches modeled a child without passing it through the flagging site.
   */
  describe("UNPREFIXED foreign content is modeled as FHIR, and is always reported", () => {
    const at = (issues: readonly { code: string; expression?: string }[], code: string) =>
      issues.filter((i) => i.code === code).map((i) => i.expression);

    it("reports a foreign extension it promotes into a primitive's extensions", () => {
      const { resource, issues } = parseResourceXml(
        `<Patient ${FHIR_NS}><birthDate value="1980-01-01"><extension xmlns="urn:vendor" url="urn:x"><valueBoolean value="true"/></extension></birthDate></Patient>`,
      );
      // It IS modeled as a FHIR extension: unprefixed, so there is no tag to keep it apart.
      expect(serializeResource(resource)).toContain('"extension"');
      // And it is reported at exactly the position it was promoted into.
      expect(at(issues, ISSUE_CODES.UNEXPECTED_XML_CONTENT)).toContain(
        "Patient.birthDate.extension[0]",
      );
    });

    it("reports a foreign resource it unwraps as a contained resource", () => {
      const { resource, issues } = parseResourceXml(
        `<Patient ${FHIR_NS}><contained><Patient xmlns="urn:vendor"><active value="true"/></Patient></contained></Patient>`,
      );
      expect(serializeResource(resource)).toContain('"resourceType":"Patient"');
      expect(at(issues, ISSUE_CODES.UNEXPECTED_XML_CONTENT)).toContain("Patient.contained");
    });

    it("reports a foreign element it joins to a FHIR element's occurrences", () => {
      const { resource, issues } = parseResourceXml(
        `<Patient ${FHIR_NS}><name><given value="Peter"/></name><name xmlns="urn:vendor"><given value="Vendor"/></name></Patient>`,
      );
      expect(serializeResource(resource)).toBe(
        '{"resourceType":"Patient","name":[{"given":"Peter"},{"given":"Vendor"}]}',
      );
      expect(at(issues, ISSUE_CODES.UNEXPECTED_XML_CONTENT)).toContain("Patient.name[1]");
    });

    it("reports a foreign div it stores as Narrative.div", () => {
      const { resource, issues } = parseResourceXml(
        `<Patient ${FHIR_NS}><text><status value="generated"/><div xmlns="urn:vendor">Hi</div></text></Patient>`,
      );
      expect(serializeResource(resource)).toContain('"div"');
      expect(at(issues, ISSUE_CODES.UNEXPECTED_XML_CONTENT)).toContain("Patient.text.div");
    });
  });

  /**
   * Resolving prefixes widens what a `0..1` reader sees: an element written under two spellings of
   * one namespace has two occurrences where a raw-tag read saw one of each name. That is the right
   * reading, but a check that reads a single value gets nothing from a repeat, so the widening is
   * reported rather than left to be discovered downstream.
   */
  describe("a widened read window is reported, not silent", () => {
    it("reports the element whose occurrences were spelled more than one way", () => {
      const { issues } = parseResourceXml(
        `<Observation ${FHIR_NS} xmlns:z="http://hl7.org/fhir"><status value="final"/><z:status value="amended"/></Observation>`,
      );
      expect(
        issues.filter((i) => i.code === ISSUE_CODES.MIXED_XML_SPELLING).map((i) => i.expression),
      ).toEqual(["Observation.status"]);
    });

    it("names the element once, not once per occurrence", () => {
      const { issues } = parseResourceXml(
        `<Patient ${FHIR_NS} xmlns:z="http://hl7.org/fhir"><name><family value="a"/></name>` +
          `<z:name><family value="b"/></z:name><z:name><family value="c"/></z:name></Patient>`,
      );
      expect(issues.filter((i) => i.code === ISSUE_CODES.MIXED_XML_SPELLING)).toHaveLength(1);
    });

    it("says nothing when every occurrence is spelled the same way", () => {
      // A genuine repeat, one spelling: the count came from the content, so there is nothing to say.
      const { issues } = parseResourceXml(
        `<Patient ${FHIR_NS}><name><family value="a"/></name><name><family value="b"/></name></Patient>`,
      );
      expect(issues.some((i) => i.code === ISSUE_CODES.MIXED_XML_SPELLING)).toBe(false);
    });

    it("says nothing when the second spelling is a different namespace", () => {
      // Prefixed foreign content is a different name, so it never joined the group in the first
      // place and no window widened.
      const { issues } = parseResourceXml(
        `<Patient ${FHIR_NS} xmlns:v="urn:vendor"><name><family value="a"/></name><v:name><family value="b"/></v:name></Patient>`,
      );
      expect(issues.some((i) => i.code === ISSUE_CODES.MIXED_XML_SPELLING)).toBe(false);
    });

    /**
     * The measured case. A `Reference.reference` written under two spellings reads as a repeat, and
     * `REFERENCE_UNRESOLVED` is a single-value read, so the finding a one-spelling document raises
     * disappears. It is the disappearance that had to stop being silent, not the repeat.
     */
    it("accompanies a finding that a single-value read drops on a repeat", () => {
      const doc = (second: string) =>
        `<Bundle ${FHIR_NS} xmlns:z="http://hl7.org/fhir"><id value="b1"/><type value="collection"/>` +
        `<entry><fullUrl value="urn:uuid:1"/><resource><Patient><id value="1"/>` +
        `<managingOrganization><reference value="Organization/2"/>${second}</managingOrganization>` +
        `</Patient></resource></entry>` +
        `<entry><fullUrl value="https://ex.org/fhir/Observation/9"/><resource><Observation>` +
        `<id value="9"/><status value="final"/><subject><reference value="Patient/1"/></subject>` +
        `</Observation></resource></entry></Bundle>`;
      const one = parseResourceXml(doc(""));
      const two = parseResourceXml(doc('<z:reference value="Organization/2"/>'));
      const codes = (r: FhirComplex) => validateResource(r).issues.map((i) => i.code);
      expect(codes(one.resource)).toContain("REFERENCE_UNRESOLVED");
      expect(codes(two.resource)).not.toContain("REFERENCE_UNRESOLVED");
      expect(
        two.issues
          .filter((i) => i.code === ISSUE_CODES.MIXED_XML_SPELLING)
          .map((i) => i.expression),
      ).toEqual(["Bundle.entry[0].resource.managingOrganization.reference"]);
    });
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
