/**
 * A model name reaching an XML TAG position that XML cannot spell there.
 *
 * `serializeResourceXml` builds a start tag by interpolating a name the document supplied. FHIR
 * element names and resource type names are narrow, so for a conformant resource that is safe, but
 * the model is schema-free and the JSON reader admits any member name at all. Before this suite
 * existed the writer emitted whatever it was handed, and the interesting half of that is not the
 * markup that fails to parse: it is the markup that parses into DIFFERENT elements.
 *
 * The comparand throughout is **the same model through `serializeResource`**, the JSON writer, which
 * escapes a member name, so no name reaches a refusal there. That is what makes the refusal a
 * refusal rather than a loss: the name is still writable, in the format that can express it. It is
 * not a claim that the JSON output is spec-clean, which that writer's own exception list governs.
 *
 * **A name that carries no colon and is still not an XML 1.0 `Name` used to be written verbatim**,
 * and it re-read through this library unchanged, which is why the tag-breaking line let it through.
 * It is refused now, on `UNSERIALIZABLE_XML_NAME`, and the characterization tests that pinned it as
 * written were rewritten over the same names in the change that closed it. The full grade of that
 * refusal is `test/xml-wellformed.test.ts`.
 *
 * **A name carrying a colon used to sit in that same gap and no longer does.** XML reads the colon as
 * a namespace prefix, the model carries no binding to declare one with, so the output was not
 * namespace-well-formed and the report that two vendor vocabularies were merged did not survive one
 * write and one re-read. It is refused now, on a code of its own, and the characterization tests
 * that pinned it as written were rewritten over the same documents in the change that closed it.
 *
 * **THE LAST THREE BLOCKS ARE THE OTHER MARKUP-EMITTING SITE**, the `div` branch, which writes a
 * VALUE into markup position rather than a name. It used to carry whole elements into the document
 * and is now checked at that branch; the first two blocks are paired the same way, one for what is
 * refused and one for what is still written. The third is the colon residual reached through that
 * value: a `div` whose own markup names a prefix nothing inside it binds, refused on a code of its
 * own. **Two sites are covered here. Do not read that as a statement about every branch
 * `serializeResourceXml` has.**
 *
 * All documents, names, namespace URIs and values here are synthetic.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  FhirSerializeError,
  SERIALIZE_ERROR_CODES,
  WITHHELD,
  complex,
  list,
  parseResource,
  parseResourceXml,
  primitive,
  readSafety,
  serializeResource,
  serializeResourceXml,
  validateResource,
  type FhirComplex,
} from "../src/index.js";

const FHIR_NS = 'xmlns="http://hl7.org/fhir"';

/** Read a JSON resource, asserting nothing about it, and hand back the model. */
function model(json: string): FhirComplex {
  return parseResource(json).resource;
}

/** A one-property `Patient` whose single member is spelled `name`. */
function withName(name: string, value: unknown = "v"): FhirComplex {
  return model(JSON.stringify({ resourceType: "Patient", [name]: value }));
}

/** The `FhirSerializeError` `serializeResourceXml` throws for `node`, or `undefined`. */
function refusal(node: FhirComplex): FhirSerializeError | undefined {
  try {
    serializeResourceXml(node);
    return undefined;
  } catch (err) {
    if (err instanceof FhirSerializeError) return err;
    throw err;
  }
}

/**
 * Every name shape the writer must refuse, with the reason it cannot be written.
 *
 * The two groups are not the same harm and the difference is what decided the remedy. The first
 * group emits markup no parser reads back at all. The second emits markup a conformant parser
 * ACCEPTS, as a different set of elements than the model holds.
 */
const BREAKS_THE_TAG = [
  ["a space", "a b"],
  ["a tab", "a\tb"],
  ["a newline", "a\nb"],
  ["a carriage return", "a\rb"],
  ["an equals sign", "a=b"],
  ["a less-than sign", "a<b"],
  ["a greater-than sign", "a>b"],
  ["a solidus", "a/b"],
  ["an empty name", ""],
  ["a leading bang, which opens a markup declaration", "!ab"],
  ["a leading question mark, which opens a processing instruction", "?ab"],
] as const;

const FABRICATES_ELEMENTS = [
  ["a bare breakout", "x/><script"],
  ["a breakout that forges a clinical element", 'zz value="1"/><status'],
] as const;

/**
 * The name shapes the writer used to keep writing because this library's own round trip returned
 * each unchanged. A conformant third-party parser rejects all of them, since none is an XML 1.0
 * `Name`, and each is refused now on a code of its own. **None of them carries a colon**: the three
 * rows that did moved to {@link COLON_BEARING} when that half of the gap closed.
 */
const NOT_A_NAME_ONCE_WRITTEN = [
  ["an ampersand", "a&b"],
  ["a leading digit", "1abc"],
  ["a leading hyphen", "-lead"],
  ["a leading full stop", ".lead"],
  ["a double quote", 'a"b'],
  ["an apostrophe", "a'b"],
  ["a vertical tab, which is not XML whitespace", "ab"],
  ["a form feed, which is not XML whitespace", "a\fb"],
  ["a non-breaking space, which is not XML whitespace", "a b"],
] as const;

/**
 * The three rows the declared gap above used to hold that carry a colon, labels unchanged. The
 * writer wrote each verbatim (`<Patient xmlns="http://hl7.org/fhir"><p:x value="v"/></Patient>`)
 * with nothing declaring the prefix, which a conformant parser rejects. Each is refused now.
 */
const COLON_BEARING = [
  ["a prefix nothing declares", "p:x"],
  ["a leading colon", ":x"],
  ["two colons", "a:b:c"],
] as const;

/** Every code `SERIALIZE_ERROR_CODES` held at the pin this change was measured against (AC-4). */
const CODES_AT_PIN = [
  "DROPPED_ELEMENT_TEXT",
  "UNSERIALIZABLE_ELEMENT_NAME",
  "UNSERIALIZABLE_DIV_MARKUP",
  "UNSERIALIZABLE_JSON_ONLY_SHAPE",
  "UNSERIALIZABLE_ARRAY_WRAPPER",
  "UNSERIALIZABLE_CHOICE_WRAPPER",
  "UNSERIALIZABLE_SHADOWED_PROPERTY",
  "UNSERIALIZABLE_RESOURCE_TYPE",
  "UNSERIALIZABLE_FOREIGN_ROOT",
] as const;

/** D1: a prefix rebound between siblings, two vendor vocabularies merged into one model name. */
const D1 =
  `<Observation ${FHIR_NS}><status value="final"/>` +
  `<p:x xmlns:p="urn:a" value="1"/><p:x xmlns:p="urn:b" value="2"/></Observation>`;
/** D2: a root whose prefix nothing binds, modeled under its verbatim tag. */
const D2 = `<v:Observation><v:id value="o1"/><v:status value="final"/></v:Observation>`;
/** D3: a foreign child whose prefix IS bound in the source, and whose binding the model drops. */
const D3 =
  `<Observation ${FHIR_NS}><status value="final"/>` +
  `<v:x xmlns:v="urn:vendor" value="1"/></Observation>`;

/** Each resource composed into its own `Bundle.entry.resource` after parsing, as a caller builds one. */
function inBundle(...resources: readonly FhirComplex[]): FhirComplex {
  return complex([
    { name: "resourceType", value: primitive("Bundle") },
    { name: "type", value: primitive("collection") },
    {
      name: "entry",
      value: list(resources.map((resource) => complex([{ name: "resource", value: resource }]))),
    },
  ]);
}

/** A `Patient` carrying nothing but a generated narrative spelled `div`, as the JSON text read. */
function narrativeJson(div: string): string {
  return JSON.stringify({ resourceType: "Patient", text: { status: "generated", div } });
}

/** The property names under `text` in `node`, in order. */
function textNames(node: FhirComplex): string[] {
  const text = node.properties.find((p) => p.name === "text")?.value;
  return text?.kind === "complex" ? text.properties.map((p) => p.name) : [];
}

/**
 * The code a `div` naming a prefix nothing inside it binds is refused on, spelled as a literal and
 * not read off `SERIALIZE_ERROR_CODES`: the pin has no such member, so reading it there would compare
 * `undefined` with `undefined` and a refusal test would pass against a tree that never refuses.
 */
const DIV_PREFIX = "UNSERIALIZABLE_DIV_PREFIX";

/** The first member of the unbound example set, and the one row the `AC-7(d)` list gave up. */
const UNBOUND_ROOT = "<v:div>x</v:div>";

/**
 * The unbound example set (AC-1): each passes the one-`div`-element check, and each names a prefix
 * that no declaration inside the string binds, on the root, on an inner element, on an attribute.
 */
const UNBOUND_DIVS = [
  ["on the root", UNBOUND_ROOT],
  ["on an inner element", '<div xmlns="http://www.w3.org/1999/xhtml"><v:p>x</v:p></div>'],
  ["on an attribute", '<div xmlns="http://www.w3.org/1999/xhtml"><p v:a="1">x</p></div>'],
] as const;

/** The narrative spellings `parseResourceXml` produces a `div` string for, each written verbatim. */
const NARRATIVES = [
  ["the default XHTML spelling", '<div xmlns="http://www.w3.org/1999/xhtml">ok</div>'],
  ["a prefixed XHTML spelling", '<h:div xmlns:h="http://www.w3.org/1999/xhtml">ok</h:div>'],
  ["XHTML structure inside it", '<div xmlns="http://www.w3.org/1999/xhtml"><p>a</p><br/></div>'],
  ["an empty narrative element", '<div xmlns="http://www.w3.org/1999/xhtml"/>'],
  ["no namespace declaration at all", "<div>ok</div>"],
  ["a vendor namespace", '<div xmlns="urn:vendor">ok</div>'],
  ["an escaped less-than in the prose", '<div xmlns="http://www.w3.org/1999/xhtml">a &lt; b</div>'],
] as const;

/** An XHTML `div` holding `n` nested paragraphs. */
function nestedDiv(n: number): string {
  return `<div xmlns="http://www.w3.org/1999/xhtml">${"<p>".repeat(n)}x${"</p>".repeat(n)}</div>`;
}

/** The `AC-7(d)` list, the same documents in the same order, the unbound root still among them. */
const AC7D_DIVS = [
  ...NARRATIVES.map(([, div]) => div),
  UNBOUND_ROOT,
  nestedDiv(253),
  nestedDiv(254),
  "<div>x</div>",
  '<?xml version="1.0"?><div xmlns="http://www.w3.org/1999/xhtml">x</div>',
  '<!--c--><div xmlns="http://www.w3.org/1999/xhtml"/>',
];

/**
 * AC-3's admitted set: every prefix bound inside the string, or only the `xml` prefix, followed by
 * every other row the `AC-7(d)` list holds. Each was written verbatim at the pin.
 */
const ADMITTED_DIVS = [
  '<h:div xmlns:h="http://www.w3.org/1999/xhtml">ok</h:div>',
  '<div xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:x"><v:p>x</v:p></div>',
  '<div xmlns="http://www.w3.org/1999/xhtml"><p xmlns:v="urn:x" v:a="1">x</p></div>',
  '<div xmlns="http://www.w3.org/1999/xhtml" xml:lang="en">x</div>',
  ...AC7D_DIVS.filter((div) => div !== UNBOUND_ROOT),
];

/** What the writer emits for {@link narrativeJson} when it writes `div` verbatim. */
function writtenNarrative(div: string): string {
  return `<Patient ${FHIR_NS}><text><status value="generated"/>${div}</text></Patient>`;
}

/** One model holding a colon-bearing name at a tag site, with what was measured for it. */
interface ColonCase {
  /** Builds the model afresh, so no test can share a node with another. */
  readonly build: () => FhirComplex;
  /** Every colon-bearing name the model holds at a tag site. */
  readonly names: readonly string[];
  /** Other document content the refusal must not echo: namespace URIs and values. */
  readonly content: readonly string[];
  /** The refusal's locations, in walk order. */
  readonly locations: readonly string[];
  /** What `serializeResource` returned for this model at the pin, measured there. */
  readonly json: string;
  /** The property names `parseResource` read back from that string at the pin. */
  readonly jsonNames: readonly string[];
}

/**
 * Every model AC-3 names. Each one wrote a document at the pin (measured, and recorded with the
 * change), so none of them drew a refusal there, which is what AC-4 keys on.
 */
const COLON_MODELS: readonly (readonly [string, ColonCase])[] = [
  [
    "D1, a prefix rebound between siblings",
    {
      build: () => parseResourceXml(D1).resource,
      names: ["p:x"],
      content: ["urn:a", "urn:b", "final"],
      locations: [`Observation.${WITHHELD}[0]`, `Observation.${WITHHELD}[1]`],
      json: '{"resourceType":"Observation","status":"final","p:x":["1","2"]}',
      jsonNames: ["resourceType", "status", "p:x"],
    },
  ],
  [
    "D2, a root whose prefix nothing binds",
    {
      build: () => parseResourceXml(D2).resource,
      names: ["v:Observation", "v:id", "v:status"],
      content: ["o1", "final"],
      locations: [WITHHELD, `${WITHHELD}.${WITHHELD}`],
      json: '{"resourceType":"v:Observation","v:id":"o1","v:status":"final"}',
      jsonNames: ["resourceType", "v:id", "v:status"],
    },
  ],
  [
    "D3, a foreign child whose prefix the source bound",
    {
      build: () => parseResourceXml(D3).resource,
      names: ["v:x"],
      content: ["urn:vendor", "final"],
      locations: [`Observation.${WITHHELD}`],
      json: '{"resourceType":"Observation","status":"final","v:x":"1"}',
      jsonNames: ["resourceType", "status", "v:x"],
    },
  ],
  ...COLON_BEARING.map(([label, name]): readonly [string, ColonCase] => [
    `M1, ${label}`,
    {
      build: () => withName(name),
      names: [name],
      content: [],
      locations: [`Patient.${WITHHELD}`],
      json: JSON.stringify({ resourceType: "Patient", [name]: "v" }),
      jsonNames: ["resourceType", name],
    },
  ]),
  [
    "a property named xmlns:x, a prefix no element name may carry",
    {
      build: () => withName("xmlns:x"),
      names: ["xmlns:x"],
      content: [],
      locations: [`Patient.${WITHHELD}`],
      json: '{"resourceType":"Patient","xmlns:x":"v"}',
      jsonNames: ["resourceType", "xmlns:x"],
    },
  ],
  [
    "a name inside a backbone element",
    {
      build: () => model('{"resourceType":"Patient","name":[{"p:x":"x"}]}'),
      names: ["p:x"],
      content: [],
      locations: [`Patient.name[0].${WITHHELD}`],
      json: '{"resourceType":"Patient","name":[{"p:x":"x"}]}',
      jsonNames: ["resourceType", "name"],
    },
  ],
  [
    "a name on an extension",
    {
      build: () =>
        model('{"resourceType":"Patient","_gender":{"extension":[{"url":"http://e","p:x":"x"}]}}'),
      names: ["p:x"],
      content: [],
      locations: [`Patient.gender.extension[0].${WITHHELD}`],
      json: '{"resourceType":"Patient","_gender":{"extension":[{"url":"http://e","p:x":"x"}]}}',
      jsonNames: ["resourceType", "gender"],
    },
  ],
  [
    "a name inside a contained resource",
    {
      build: () =>
        model('{"resourceType":"Patient","contained":[{"resourceType":"Observation","p:x":"1"}]}'),
      names: ["p:x"],
      content: [],
      locations: [`Patient.contained[0].${WITHHELD}`],
      json: '{"resourceType":"Patient","contained":[{"resourceType":"Observation","p:x":"1"}]}',
      jsonNames: ["resourceType", "contained"],
    },
  ],
  [
    "the resourceType of a contained resource",
    {
      build: () =>
        model(
          '{"resourceType":"Patient","contained":[{"resourceType":"v:Observation","id":"c1"}]}',
        ),
      names: ["v:Observation"],
      content: ["c1"],
      locations: ["Patient.contained[0]"],
      json: '{"resourceType":"Patient","contained":[{"resourceType":"v:Observation","id":"c1"}]}',
      jsonNames: ["resourceType", "contained"],
    },
  ],
  [
    "the wrapper name of a resource-valued element",
    {
      build: () =>
        model('{"resourceType":"Patient","c:d":{"resourceType":"Observation","status":"final"}}'),
      names: ["c:d"],
      content: ["final"],
      locations: [`Patient.${WITHHELD}`],
      json: '{"resourceType":"Patient","c:d":{"resourceType":"Observation","status":"final"}}',
      jsonNames: ["resourceType", "c:d"],
    },
  ],
  [
    "D3 composed into Bundle.entry.resource after parsing",
    {
      build: () => inBundle(parseResourceXml(D3).resource),
      names: ["v:x"],
      content: ["urn:vendor", "final", "collection"],
      locations: [`Bundle.entry[0].resource.${WITHHELD}`],
      json: '{"resourceType":"Bundle","type":"collection","entry":[{"resource":{"resourceType":"Observation","status":"final","v:x":"1"}}]}',
      jsonNames: ["resourceType", "type", "entry"],
    },
  ],
  [
    "D2 composed into Bundle.entry.resource after parsing",
    {
      build: () => inBundle(parseResourceXml(D2).resource),
      names: ["v:Observation", "v:id", "v:status"],
      content: ["o1", "final", "collection"],
      locations: ["Bundle.entry[0].resource", `Bundle.entry[0].resource.${WITHHELD}`],
      json: '{"resourceType":"Bundle","type":"collection","entry":[{"resource":{"resourceType":"v:Observation","v:id":"o1","v:status":"final"}}]}',
      jsonNames: ["resourceType", "type", "entry"],
    },
  ],
];

/**
 * Models that drew a refusal at the pin AND carry a colon-bearing name, with the code and the
 * locations the pin raised, measured there (AC-5). One per refusal the pin could raise.
 */
const REFUSED_AT_THE_PIN: readonly (readonly [
  string,
  () => FhirComplex,
  string,
  readonly string[],
])[] = [
  [
    "a tag-breaking name beside a colon-bearing one",
    () => model('{"resourceType":"Patient","a b":"1","contact":[{"p:x":"2"}]}'),
    "UNSERIALIZABLE_ELEMENT_NAME",
    [`Patient.${WITHHELD}`],
  ],
  [
    "one name carrying both a colon and a tag-breaking character",
    () => withName("a b:c"),
    "UNSERIALIZABLE_ELEMENT_NAME",
    [`Patient.${WITHHELD}`],
  ],
  [
    "a div string the pin refused beside a colon-bearing name",
    () => model('{"resourceType":"Patient","div":"<p>a</p>","p:x":"v"}'),
    "UNSERIALIZABLE_DIV_MARKUP",
    ["Patient.div"],
  ],
  [
    "dropped element text beside a colon-bearing foreign element",
    () =>
      parseResourceXml(
        `<Observation ${FHIR_NS}><status>final</status>` +
          `<v:x xmlns:v="urn:vendor" value="1"/></Observation>`,
      ).resource,
    "DROPPED_ELEMENT_TEXT",
    ["Observation.status"],
  ],
  [
    "a JSON-only shape beside a colon-bearing name",
    () => model('{"resourceType":"Patient","name":[[{"family":"X"}]],"p:x":"v"}'),
    "UNSERIALIZABLE_JSON_ONLY_SHAPE",
    ["Patient.name[0]"],
  ],
  [
    "an array wrapper beside a colon-bearing name",
    () => model('{"resourceType":"Observation","status":["final"],"p:x":"v"}'),
    "UNSERIALIZABLE_ARRAY_WRAPPER",
    ["Observation.status"],
  ],
  [
    "a shadowed member beside a colon-bearing name",
    () =>
      model(
        '{"resourceType":"Observation","status":"final","status":"entered-in-error","p:x":"v"}',
      ),
    "UNSERIALIZABLE_SHADOWED_PROPERTY",
    ["Observation.status"],
  ],
  [
    "an untaggable resourceType beside a colon-bearing name",
    () => model('{"resourceType":"Patient","contained":[{"resourceType":42,"p:x":"v"}]}'),
    "UNSERIALIZABLE_RESOURCE_TYPE",
    ["Patient.contained[0].resourceType"],
  ],
  [
    "a foreign root holding a colon-bearing child",
    () =>
      parseResourceXml(
        `<v:Observation xmlns:v="urn:vendor"><v:status value="final"/>` +
          `<w:x xmlns:w="urn:w" value="1"/></v:Observation>`,
      ).resource,
    "UNSERIALIZABLE_FOREIGN_ROOT",
    ["Observation"],
  ],
  [
    "a value[x] wrapper beside a colon-bearing name",
    () => model('{"resourceType":"Observation","status":"final","valueString":["a"],"p:x":"v"}'),
    "UNSERIALIZABLE_CHOICE_WRAPPER",
    ["Observation.valueString"],
  ],
];

/** The paired golden fixtures `test/xml.test.ts` round-trips, for AC-7(e). */
const PAIRS = [
  "patient",
  "observation-decimals",
  "primitive-extensions",
  "value-absent",
  "extension-only-list",
  "bundle",
  "patient-narrative",
] as const;

/**
 * Every element name in `xml`: what follows `<` or `</` up to XML whitespace, `/` or `>`, skipping
 * a comment, a declaration or a processing instruction. Attribute values cannot hold a `<` here,
 * because the writer escapes it there.
 */
function elementNames(xml: string): string[] {
  return [...xml.matchAll(/<(?![!?])\/?([^ \t\n\r/>]+)/gu)].map((match) => match[1] ?? "");
}

/** Whether a written element name is namespace-well-formed with no declaration in scope. */
function needsNoDeclaration(name: string): boolean {
  return !name.includes(":") || /^xml:[^:]+$/u.test(name);
}

describe("a model name at an XML tag position", () => {
  describe("the route that decided the remedy: markup that re-reads as DIFFERENT elements", () => {
    /**
     * THE HEADLINE, AND THE REASON THIS IS A REFUSAL RATHER THAN A REPORT.
     *
     * This document names no `status` anywhere, and nothing upstream of the writer objects to the
     * member NAME beyond "not an element R4 defines", which is a warning. Written as XML by the
     * unguarded writer it became `<zz value="1"/><status value="final"/>`, which is well-formed,
     * which a conformant parser accepts, and which this library re-reads as an `Observation`
     * **whose status is `final`**. A clinical value present on neither side of the sender's
     * document, asserted by our own writer, with nothing at either end saying so.
     */
    it("does not fabricate a status the document never named", () => {
      const forged = model(
        JSON.stringify({ resourceType: "Observation", 'zz value="1"/><status': "final" }),
      );
      // The reading itself is unremarkable, which is precisely the problem: nothing upstream of the
      // writer has any reason to object to the NAME. The built-in Observation element table reports
      // it as an element R4 does not define, at warning severity, and raises the two mandatory
      // elements this bare document never carried. Not one of the three is about the markup the
      // writer will make of that name, which is why the refusal has to live in the writer.
      expect(parseResource(JSON.stringify({ resourceType: "Observation" })).issues).toEqual([]);
      const findings = validateResource(forged).issues;
      expect(findings.map((issue) => `${issue.code}/${issue.severity}`)).toEqual([
        "UNKNOWN_ELEMENT/warning",
        "CARDINALITY_MIN/error",
        "CARDINALITY_MIN/error",
      ]);
      expect(readSafety(forged).status).toBeUndefined();

      const err = refusal(forged);
      expect(err?.code).toBe(SERIALIZE_ERROR_CODES.UNSERIALIZABLE_ELEMENT_NAME);

      // The capability is not lost, it is routed to the format that can express the name.
      expect(serializeResource(forged)).toBe(
        '{"resourceType":"Observation","zz value=\\"1\\"/><status":"final"}',
      );
    });

    it.each(FABRICATES_ELEMENTS)("refuses %s", (_label, name) => {
      expect(refusal(withName(name))?.code).toBe(SERIALIZE_ERROR_CODES.UNSERIALIZABLE_ELEMENT_NAME);
    });
  });

  describe("the rest of the refused set: markup that does not re-read at all", () => {
    it.each(BREAKS_THE_TAG)("refuses %s", (_label, name) => {
      expect(refusal(withName(name))?.code).toBe(SERIALIZE_ERROR_CODES.UNSERIALIZABLE_ELEMENT_NAME);
    });

    it("still writes every one of them as JSON, which escapes a member name", () => {
      for (const [, name] of [...BREAKS_THE_TAG, ...FABRICATES_ELEMENTS]) {
        const json = serializeResource(withName(name));
        // Round-trips through the format that can carry it, so nothing is unwritable.
        expect(parseResource(json).resource.properties.map((p) => p.name)).toEqual([
          "resourceType",
          name,
        ]);
      }
    });
  });

  /**
   * THE GAP THAT CLOSED: A NAME THIS LIBRARY ROUND-TRIPPED AND XML DOES NOT ADMIT.
   *
   * The characterization tests that pinned these as written went red when the gap closed, and are
   * rewritten here over the same names. The pin wrote each as `<Patient …><NAME value="v"/></Patient>`
   * and this library's own reader read that back as the same one property, which is the line the
   * tag-breaking refusal draws; a conformant parser rejects every one, which is the line drawn now.
   * Neither the tag-breaking code nor the colon code widened to reach them: each draws a code of its
   * own.
   */
  describe("a name this library round-tripped and XML does not admit is refused on its own code", () => {
    it.each(NOT_A_NAME_ONCE_WRITTEN)(
      "AC-1: refuses %s on UNSERIALIZABLE_XML_NAME, which the pin wrote verbatim",
      (_label, name) => {
        const err = refusal(withName(name));
        expect(err?.code).toBe("UNSERIALIZABLE_XML_NAME");
        expect(err?.locations).toEqual([`Patient.${WITHHELD}`]);
        // The pin's output, rebuilt by hand, still reads back as the same one property: this
        // library's round trip survived it, and that is not the line any more.
        const pin = `<Patient ${FHIR_NS}><${name} value="v"/></Patient>`;
        expect(parseResourceXml(pin).resource.properties.map((p) => p.name)).toEqual([
          "resourceType",
          name,
        ]);
      },
    );
  });

  /**
   * THE HALF OF THE GAP THAT CLOSED: A COLON AT A TAG POSITION.
   *
   * XML reads a colon in an element name as a namespace prefix (Namespaces in XML 1.0 §5, "The
   * namespace prefix, unless it is xml or xmlns, MUST have been declared"), and the model carries no
   * binding, so every such name the writer emitted was undeclared. The output was not
   * namespace-well-formed, and on D1 the one report that said two vendor vocabularies were merged
   * (`MIXED_XML_SPELLING`) was gone after one write and one re-read. Refused now rather than written;
   * `serializeResource` spells a member name as a JSON string and is the route that stays open.
   */
  describe("a colon at a tag position is refused rather than written with its prefix unbound", () => {
    it.each(COLON_BEARING)(
      "AC-1, AC-3: refuses %s rather than writing it verbatim",
      (_label, name) => {
        const err = refusal(withName(name));
        expect(err).toBeInstanceOf(FhirSerializeError);
        expect(err?.code).toBe(SERIALIZE_ERROR_CODES.UNSERIALIZABLE_PREFIXED_NAME);
        expect(err?.locations).toEqual([`Patient.${WITHHELD}`]);
      },
    );

    it("AC-1, AC-3: refuses a prefixed foreign property rather than emitting its prefix unbound", () => {
      // The read is unchanged: the foreign child keeps its verbatim tag as its model name.
      const { resource } = parseResourceXml(D3);
      expect(resource.properties.map((p) => p.name)).toEqual(["resourceType", "status", "v:x"]);
      // The pin emitted `<v:x value="1"/>` with `v` bound to nothing; nothing is emitted now.
      const err = refusal(resource);
      expect(err).toBeInstanceOf(FhirSerializeError);
      expect(err?.code).toBe(SERIALIZE_ERROR_CODES.UNSERIALIZABLE_PREFIXED_NAME);
      expect(err?.locations).toEqual([`Observation.${WITHHELD}`]);
    });

    it.each(COLON_MODELS)("AC-3: refuses %s, at every location in walk order", (_label, c) => {
      const node = c.build();
      expect(() => serializeResourceXml(node)).toThrow(FhirSerializeError);
      const err = refusal(node);
      expect(err?.code).toBe(SERIALIZE_ERROR_CODES.UNSERIALIZABLE_PREFIXED_NAME);
      expect(err?.locations).toEqual(c.locations);
    });

    it("AC-4: carries one code for every such model, new at head and not the name code", () => {
      const codes = new Set(COLON_MODELS.map(([, c]) => refusal(c.build())?.code));
      expect([...codes]).toEqual(["UNSERIALIZABLE_PREFIXED_NAME"]);
      expect(Object.values(SERIALIZE_ERROR_CODES)).toContain("UNSERIALIZABLE_PREFIXED_NAME");
      expect(CODES_AT_PIN).not.toContain("UNSERIALIZABLE_PREFIXED_NAME");
      // Every code the pin published is still published, so none was renamed to make room.
      expect(Object.values(SERIALIZE_ERROR_CODES)).toEqual(
        expect.arrayContaining([...CODES_AT_PIN]),
      );
      expect(codes.has(SERIALIZE_ERROR_CODES.UNSERIALIZABLE_ELEMENT_NAME)).toBe(false);
    });

    it.each(REFUSED_AT_THE_PIN)(
      "AC-5: keeps the pin's code and locations for %s",
      (_label, build, code, locations) => {
        const err = refusal(build());
        expect(err).toBeInstanceOf(FhirSerializeError);
        expect(err?.code).toBe(code);
        expect(err?.locations).toEqual(locations);
      },
    );

    it.each(COLON_MODELS)("AC-6: echoes no document content for %s", (_label, c) => {
      const err = refusal(c.build());
      expect(err).toBeInstanceOf(FhirSerializeError);
      const locations = err?.locations ?? [];
      const surface = `${String(err?.message)}\n${locations.join("\n")}`;
      // No colon anywhere, which covers every colon-bearing name and every prefix followed by one.
      expect(surface).not.toContain(":");
      for (const name of c.names) {
        expect(surface).not.toContain(name);
        const localParts = [
          name.slice(name.indexOf(":") + 1),
          name.slice(name.lastIndexOf(":") + 1),
        ];
        for (const location of locations) {
          for (const segment of location.split(".")) {
            expect(localParts).not.toContain(segment.replace(/(?:\[\d+\])+$/u, ""));
          }
        }
      }
      for (const content of c.content) expect(surface).not.toContain(content);
      for (const location of locations) {
        for (const segment of location.split(".")) {
          expect(segment).toMatch(/^(?:[A-Za-z][A-Za-z0-9]*|<withheld>)(?:\[\d+\])*$/u);
        }
      }
      expect(new Set(locations).size).toBe(locations.length);
      expect(err?.message).toContain(`${String(locations.length)} location(s)`);
    });

    it("AC-6: echoes none of the strings named for D1, D2 and D3", () => {
      const named = [
        [D1, ["p:x", "urn:a", "urn:b"]],
        [D2, ["v:Observation", "v:", "o1", "final"]],
        [D3, ["v:x", "urn:vendor"]],
      ] as const;
      for (const [doc, strings] of named) {
        const err = refusal(parseResourceXml(doc).resource);
        expect(err).toBeInstanceOf(FhirSerializeError);
        const surface = `${String(err?.message)}\n${(err?.locations ?? []).join("\n")}`;
        for (const content of strings) expect(surface).not.toContain(content);
      }
    });

    it("AC-7(b): writes a name under the xml prefix, which Namespaces in XML binds by definition", () => {
      expect(serializeResourceXml(withName("xml:x"))).toBe(
        `<Patient ${FHIR_NS}><xml:x value="v"/></Patient>`,
      );
    });

    it("AC-7(c): writes a FHIR element read under a prefix bound to FHIR, as the pin did", () => {
      const { resource } = parseResourceXml(
        `<Patient ${FHIR_NS} xmlns:f="http://hl7.org/fhir"><f:active value="true"/></Patient>`,
      );
      expect(serializeResourceXml(resource)).toBe(
        `<Patient ${FHIR_NS}><active value="true"/></Patient>`,
      );
    });

    it.each(PAIRS)("AC-7(e): still round-trips the %s golden pair byte for byte", (name) => {
      const source = readFileSync(new URL(`./__fixtures__/${name}.xml`, import.meta.url), "utf8");
      expect(serializeResourceXml(parseResourceXml(source).resource)).toBe(source);
    });

    it.each(COLON_MODELS)("AC-9: the JSON writer returns the pin's string for %s", (_label, c) => {
      const json = serializeResource(c.build());
      expect(json).toBe(c.json);
      expect(parseResource(json).resource.properties.map((p) => p.name)).toEqual(c.jsonNames);
    });
  });

  describe("what the refusal reports", () => {
    /**
     * A refused name is document content, and one of the shapes it takes here is a forgery built to
     * look like markup. So the location must not echo it. That is not a new mechanism: every
     * location in this library is bounded by a published-name shape, and every name this refuses
     * fails that shape by construction, since the shape is far narrower than XML's. Asserted rather
     * than reasoned about, because it is the assertion that would notice if either shape moved.
     */
    it("never echoes the refused name, at a property position", () => {
      for (const [, name] of [...BREAKS_THE_TAG, ...FABRICATES_ELEMENTS]) {
        const err = refusal(withName(name));
        expect(err?.locations).toEqual([`Patient.${WITHHELD}`]);
        // The empty name is skipped: every string contains "", so the assertion would be vacuous.
        if (name !== "") expect(err?.message).not.toContain(name);
      }
    });

    /**
     * **The stronger sentence "every location renders `WITHHELD`" was written, and it is FALSE.** A
     * nested resource's type is reported at the location of the element WRAPPING it, so the refused
     * name never becomes a segment and there is nothing to withhold. What is asserted here is the
     * weaker and true property, which is also the one that carries the safety: it is echoed nowhere.
     */
    it("echoes nothing at a nested-resource position either, where there is no segment", () => {
      const bad = "O/><Patient";
      const err = refusal(
        model(JSON.stringify({ resourceType: "Patient", contained: [{ resourceType: bad }] })),
      );
      expect(err?.locations).toEqual(["Patient.contained[0]"]);
      expect(err?.locations.join("|")).not.toContain(bad);
      expect(err?.message).not.toContain(bad);
    });

    /**
     * Deduplicated, on the same reasoning the dropped-text refusal reports one location however
     * many marked nodes sit at it: a location is a POSITION. Here that bites harder than it does
     * there, because every refused name at one parent withholds to the same string, so `a b` and
     * `c=d` above are one location and the count says one. That is the honest reading of a count of
     * locations, and the alternative is to distinguish them by echoing them.
     */
    it("reports every offending location in one pass, deduplicated, in walk order", () => {
      const node = model(
        JSON.stringify({
          resourceType: "Patient",
          "a b": "1",
          "c=d": "2",
          contact: [{ "c/>d": "3" }, { "c/>d": "4" }],
          gender: "male",
        }),
      );
      const err = refusal(node);
      expect(err?.code).toBe(SERIALIZE_ERROR_CODES.UNSERIALIZABLE_ELEMENT_NAME);
      expect(err?.locations).toEqual([
        `Patient.${WITHHELD}`,
        `Patient.contact[0].${WITHHELD}`,
        `Patient.contact[1].${WITHHELD}`,
      ]);
      expect(err?.message).toContain("3 location(s)");
    });

    it("counts locations in the message and never the content", () => {
      const err = refusal(withName("a b"));
      expect(err?.message).toContain("1 location(s)");
      expect(err?.message).toContain("serializeResource escapes a member name");
      expect(err?.message).toContain("this refusal never reaches it");
    });

    it("does not tell the caller the JSON writer encodes the model correctly", () => {
      // The message used to end "serializeResource encodes this model correctly" and that reached
      // consumer logs. It is a claim about the WHOLE MODEL, and the counterexample below falsifies
      // it, so the message now says only what this refusal does not reach.
      expect(refusal(withName("a b"))?.message).not.toContain("encodes this model correctly");
    });

    it("a model refused here can carry a JSON-writer exception, which is why the claim was cut", () => {
      const node = model(
        JSON.stringify({
          resourceType: "Observation",
          name: [[{ family: "X" }]],
          'zz value="1"/><status': 1,
        }),
      );
      expect(refusal(node)?.code).toBe(SERIALIZE_ERROR_CODES.UNSERIALIZABLE_ELEMENT_NAME);
      // An array inside an array is the first entry on `serializeResource`'s own declared exception
      // list, and it comes straight back out. The name route stays open; the model is not "correct".
      expect(serializeResource(node)).toContain('"name":[[{"family":"X"}]]');
    });
  });

  describe("every tag position, not just a top-level property", () => {
    it("refuses a name inside a backbone element", () => {
      expect(
        refusal(model(JSON.stringify({ resourceType: "Patient", name: [{ "a b": "x" }] })))
          ?.locations,
      ).toEqual([`Patient.name[0].${WITHHELD}`]);
    });

    it("refuses a name on an extension, whose tag is written by the same site", () => {
      expect(
        refusal(
          model(
            JSON.stringify({
              resourceType: "Patient",
              _gender: { extension: [{ url: "http://e", "a b": "x" }] },
            }),
          ),
        )?.code,
      ).toBe(SERIALIZE_ERROR_CODES.UNSERIALIZABLE_ELEMENT_NAME);
    });

    it("refuses a resourceType at the ROOT, which is the tag rather than a child", () => {
      const err = refusal(
        model(JSON.stringify({ resourceType: 'P xmlns="urn:evil"', active: true })),
      );
      expect(err?.code).toBe(SERIALIZE_ERROR_CODES.UNSERIALIZABLE_ELEMENT_NAME);
      // The root location withholds too, so the forged type is not echoed either.
      expect(err?.locations).toEqual([WITHHELD]);
    });

    /**
     * A resource-valued element writes TWO tags, the wrapper and the inner resource type, at two
     * different sites. The inner one is covered by the complex-element site; the wrapper is its own
     * site and had no test until a mutation of it left this suite green.
     */
    it("refuses the WRAPPER name of a resource-valued element, not only the inner type", () => {
      const err = refusal(
        model(
          JSON.stringify({
            resourceType: "Patient",
            "c d": { resourceType: "Observation", status: "final" },
          }),
        ),
      );
      expect(err?.code).toBe(SERIALIZE_ERROR_CODES.UNSERIALIZABLE_ELEMENT_NAME);
      expect(err?.locations).toEqual([`Patient.${WITHHELD}`]);
    });

    it("refuses a resourceType inside a contained resource", () => {
      expect(
        refusal(
          model(
            JSON.stringify({
              resourceType: "Patient",
              contained: [{ resourceType: "O/><Patient", id: "c1" }],
            }),
          ),
        )?.code,
      ).toBe(SERIALIZE_ERROR_CODES.UNSERIALIZABLE_ELEMENT_NAME);
    });
  });

  describe("the bound on the whole thing", () => {
    /**
     * THE INVARIANT THE REFUSAL EXISTS TO BUY, ASSERTED OVER GENERATED NAMES RATHER THAN A LIST.
     *
     * Either the writer refuses, or its output re-reads as the same property names in the same
     * order. A list of shapes can only ever say "not these"; this widens that to every name the
     * alphabet below can spell, which is built from exactly the characters that make a tag
     * ambiguous plus a few ordinary ones.
     *
     * **It is NOT a universal over all names, and the earlier draft of this comment claimed it
     * was.** The alphabet is the scope. It deliberately cannot spell `div`, which is a live
     * counterexample to the invariant as stated: `{"div":"v"}` emits `<Patient>v</Patient>` and the
     * property is gone on the re-read, because that name takes the raw-string branch rather than a
     * tag. That gap is pinned directly, below, rather than hidden by an alphabet that avoids it.
     *
     * The alphabet spells `:` and names that are not an XML 1.0 `Name`, so a refusal here may carry
     * any of the three name codes, and a document the writer does return is also held to carrying no
     * element name that needs a namespace declaration, which is what the colon refusal buys.
     */
    it("AC-11: either refuses on a name code, or its output re-reads as the same property names", () => {
      const alphabet = [..."ab19-._:&\"'/<>= \t\n\r!?", " ", "", "\f", "é"];
      fc.assert(
        fc.property(
          fc.array(fc.constantFrom(...alphabet), { minLength: 0, maxLength: 6 }),
          (chars) => {
            const name = chars.join("");
            // A leading `_` is the reader's primitive-extension sibling, a different mechanism
            // entirely: the model never holds a property under that name, so there is no tag to
            // compare against.
            if (name.startsWith("_")) return;
            const node = withName(name);
            // `resourceType` is compared out on both sides: it is a member in JSON and the TAG in
            // XML, so it always leads the XML reading whatever position the JSON object put it in,
            // and an integer-like key sorts ahead of it in a JavaScript object literal.
            const names = node.properties.map((p) => p.name).filter((n) => n !== "resourceType");
            let xml: string;
            try {
              xml = serializeResourceXml(node);
            } catch (err) {
              expect(err).toBeInstanceOf(FhirSerializeError);
              expect([
                SERIALIZE_ERROR_CODES.UNSERIALIZABLE_ELEMENT_NAME,
                SERIALIZE_ERROR_CODES.UNSERIALIZABLE_PREFIXED_NAME,
                SERIALIZE_ERROR_CODES.UNSERIALIZABLE_XML_NAME,
              ]).toContain((err as FhirSerializeError).code);
              return;
            }
            // Every element name the writer wrote is namespace-well-formed with no declaration: no
            // colon, or the `xml` prefix bound by definition.
            for (const written of elementNames(xml)) {
              expect(needsNoDeclaration(written)).toBe(true);
            }
            expect(
              parseResourceXml(xml)
                .resource.properties.map((p) => p.name)
                .filter((n) => n !== "resourceType"),
            ).toEqual(names);
          },
        ),
        { numRuns: 3000 },
      );
    });

    /**
     * **The refusal does not fire for an UNPREFIXED tag, and that is a property of the raw reader's
     * scanner rather than of a lucky corpus**: it stops at exactly the characters that break a tag
     * and refuses an empty name, so no such tag can carry one.
     *
     * **It is NOT "unreachable from XML", which is what this comment said and what shipped in the
     * `.d.ts`.** A prefixed name has its prefix STRIPPED, so a `!` or `?` can end up at the front of
     * a modeled name that no tag could start with. The counterexample is asserted below rather than
     * left as prose, and it is the reason this generator emits no `xmlns:` declaration: it is scoped
     * to the unprefixed case on purpose, and the scope is now stated.
     */
    it("does not fire for an unprefixed tag this library read from XML", () => {
      const alphabet = [..."ab19-._:&\"'/<>= \t!?", "é"];
      fc.assert(
        fc.property(
          fc.array(fc.constantFrom(...alphabet), { minLength: 1, maxLength: 6 }),
          (chars) => {
            const doc = `<Observation ${FHIR_NS}><${chars.join("")} value="1"/></Observation>`;
            let node: FhirComplex;
            try {
              node = parseResourceXml(doc).resource;
            } catch {
              return; // the reader refused the input; nothing reached the model.
            }
            // Specifically NOT this refusal. The OTHER one is reachable from XML and is supposed to
            // be: a tag that closes early leaves the rest of the text as character data on a FHIR
            // element, which is the dropped-text marker. Asserting "no refusal at all" here would
            // be asserting something false, which is how this test first failed.
            expect(refusal(node)?.code).not.toBe(SERIALIZE_ERROR_CODES.UNSERIALIZABLE_ELEMENT_NAME);
          },
        ),
        { numRuns: 3000 },
      );
    });

    /**
     * THE COUNTEREXAMPLE TO "UNREACHABLE FROM XML", ASSERTED SO THE CLAIM CANNOT COME BACK.
     *
     * The prefix is stripped to give the model name, so a local part beginning `!` or `?` is
     * reachable from a document whose TAG begins with neither. This one reads with zero issues and
     * `valid: true`, and it is refused. Base wrote it as `<!x value="1"/>`, which this library could
     * not then re-read, so the refusal is the better of the two behaviours. It is still a document
     * that used to serialize and now does not, and that is the honest shape of the cost.
     */
    it("IS reachable from XML through prefix stripping, which is a real cost", () => {
      const doc =
        `<Patient ${FHIR_NS} xmlns:a="http://hl7.org/fhir">` + `<a:!x value="1"/></Patient>`;
      const { resource, issues } = parseResourceXml(doc);
      expect(issues).toEqual([]);
      expect(validateResource(resource).valid).toBe(true);
      expect(resource.properties.map((p) => p.name)).toEqual(["resourceType", "!x"]);
      expect(refusal(resource)?.code).toBe(SERIALIZE_ERROR_CODES.UNSERIALIZABLE_ELEMENT_NAME);
    });
  });

  /**
   * THE SECOND MARKUP-EMITTING SITE: a `div` property, whose raw string `writeItem` splices in.
   *
   * The name check above governs names. This one governs the one branch that writes a *value* into
   * markup position, and the harm it closes is a FABRICATION rather than an unreadability: a string
   * that closes its own element and opens siblings puts spec-clean FHIR into the document that the
   * sender never wrote, and it re-reads as ordinary content of the resource.
   *
   * **The three tests that used to sit here were characterization tests over the open gap, and they
   * went red on this change, which is the mechanism working.** They are rewritten below as the same
   * shapes with their new outcome, so the comparison base-to-head is still readable in one place.
   */
  describe("a div property carrying markup that is not the div the model names", () => {
    /** The flagship: a balanced breakout that forges a positive clinical assertion. */
    const FORGED_ALLERGY =
      '<div xmlns="http://www.w3.org/1999/xhtml">ok</div></text>' +
      '<code><coding><system value="http://snomed.info/sct"/>' +
      '<code value="716186003"/></coding></code><text>';

    it("no longer forges a no-known-allergy negation the record never asserted", () => {
      const forged = model(
        JSON.stringify({
          resourceType: "AllergyIntolerance",
          text: { status: "generated", div: FORGED_ALLERGY },
        }),
      );
      // Nothing on the way in: no allergy code anywhere in the model, and no negation.
      expect(readSafety(forged).noKnownAllergy).toBe(false);
      expect(readSafety(forged).negations).toEqual([]);

      const err = refusal(forged);
      expect(err?.code).toBe(SERIALIZE_ERROR_CODES.UNSERIALIZABLE_DIV_MARKUP);
      expect(err?.locations).toEqual(["AllergyIntolerance.text.div"]);
      // Value-free like every other diagnostic here: the string is document content, and this shape
      // of it is a forgery, so it must not be echoed into a message or a location.
      expect(`${String(err?.message)}${err?.locations.join("")}`).not.toContain("716186003");

      // The route that stays open. JSON carries the string as a string, so the model is still
      // writable in the format that can express it, and the coding is still absent from the read.
      const json = serializeResource(forged);
      expect(json).toContain("716186003");
      expect(readSafety(parseResource(json).resource).noKnownAllergy).toBe(false);
    });

    it("is keyed on the NAME div alone, so the refusal is not confined to Narrative.div", () => {
      const forged = model(
        JSON.stringify({ resourceType: "Observation", div: '<status value="final"/>' }),
      );
      expect(readSafety(forged).status).toBeUndefined();
      // One well-formed element, and refused anyway: well-formedness is not the line, being the
      // `div` this property names is. Emitting this authors an `Observation.status` outright.
      expect(refusal(forged)?.code).toBe(SERIALIZE_ERROR_CODES.UNSERIALIZABLE_DIV_MARKUP);
      expect(refusal(forged)?.locations).toEqual(["Observation.div"]);
      expect(readSafety(parseResource(serializeResource(forged)).resource).status).toBeUndefined();
    });

    it("refuses a string carrying no markup, which base lost loudly", () => {
      const node = model(JSON.stringify({ resourceType: "Patient", div: "v" }));
      expect(node.properties.map((p) => p.name)).toEqual(["resourceType", "div"]);
      // Base emitted `<Patient …>v</Patient>`: the property gone, one `UNEXPECTED_XML_CONTENT` and
      // `safeToSummarize: false`. That was the one of the three shapes that failed safe, and it is
      // still a round trip that did not survive, so refusing withdraws nothing that worked.
      expect(refusal(node)?.code).toBe(SERIALIZE_ERROR_CODES.UNSERIALIZABLE_DIV_MARKUP);
      const base = parseResourceXml(`<Patient ${FHIR_NS}>v</Patient>`);
      expect(base.resource.properties.map((p) => p.name)).toEqual(["resourceType"]);
      expect(base.issues.map((i) => `${i.code}:${i.severity}`)).toEqual([
        "UNEXPECTED_XML_CONTENT:warning",
      ]);
    });

    it("refuses an empty div, which base dropped in silence", () => {
      // Not in the three shapes recorded against this defect, and the worst of them on the way in:
      // base emitted `<text><status value="generated"/></text>`, so the property vanished with an
      // empty issue list and `valid: true` at both ends. Measured while taking the item.
      const node = model(
        JSON.stringify({ resourceType: "Patient", text: { status: "generated", div: "" } }),
      );
      expect(refusal(node)?.code).toBe(SERIALIZE_ERROR_CODES.UNSERIALIZABLE_DIV_MARKUP);
      const base = parseResourceXml(
        `<Patient ${FHIR_NS}><text><status value="generated"/></text></Patient>`,
      );
      expect(base.issues).toEqual([]);
      expect(validateResource(base.resource).valid).toBe(true);
    });

    it("reports every refused div location once, in walk order, and never the markup", () => {
      const node = model(
        JSON.stringify({
          resourceType: "Patient",
          text: { status: "generated", div: "<p>a</p>" },
          contained: [{ resourceType: "Observation", div: "<p>b</p>" }],
        }),
      );
      const err = refusal(node);
      expect(err?.code).toBe(SERIALIZE_ERROR_CODES.UNSERIALIZABLE_DIV_MARKUP);
      expect(err?.locations).toEqual(["Patient.text.div", "Patient.contained[0].div"]);
    });

    it("raises the NAME refusal first when a model trips both, as base did", () => {
      const node = model(JSON.stringify({ resourceType: "Patient", div: "<p>a</p>", "a b": "v" }));
      expect(refusal(node)?.code).toBe(SERIALIZE_ERROR_CODES.UNSERIALIZABLE_ELEMENT_NAME);
    });
  });

  /**
   * WHAT IS STILL WRITTEN, ASSERTED AS HARD AS WHAT IS REFUSED.
   *
   * The cost of the refusal above is whatever it takes away, so the spellings this library reads a
   * narrative under are pinned here. Each is a document `parseResourceXml` produces the string for,
   * so a refusal that caught one of them would be withdrawing a round trip that works.
   */
  describe("div markup that is still written", () => {
    it.each(NARRATIVES)("writes %s verbatim", (_label, div) => {
      const node = model(
        JSON.stringify({ resourceType: "Patient", text: { status: "generated", div } }),
      );
      const xml = serializeResourceXml(node);
      expect(xml).toBe(
        `<Patient ${FHIR_NS}><text><status value="generated"/>${div}</text></Patient>`,
      );
    });

    it.each(NARRATIVES)("re-writes the string the reader hands back for %s", (_label, div) => {
      // The rows above are not asserted to be every spelling. Each is asserted to be one the reader
      // produces a `div` string for, and that string is asserted to be writable in turn, which is
      // what makes "no working round trip was withdrawn" checkable rather than a claim.
      const doc = `<Patient ${FHIR_NS}><text><status value="generated"/>${div}</text></Patient>`;
      const text = parseResourceXml(doc).resource.properties.find((p) => p.name === "text")?.value;
      const read =
        text?.kind === "complex" ? text.properties.find((p) => p.name === "div") : undefined;
      const value = read?.value.kind === "primitive" ? read.value.value : undefined;
      expect(typeof value).toBe("string");
      const again = model(
        JSON.stringify({ resourceType: "Patient", text: { status: "generated", div: value } }),
      );
      expect(refusal(again)).toBeUndefined();
      expect(serializeResourceXml(again)).toContain(String(value));
    });

    /**
     * The characterization test that pinned the `div`-value route as written, rewritten over the
     * same documents in the change that closed it. Every row but one is still written exactly as the
     * pin wrote it. The one that moved out, a root whose prefix nothing binds, is refused now: the
     * pin wrote it into a document a conformant parser rejects.
     */
    it("AC-2, AC-7(d): writes every div string in this block as the pin did, but the unbound root", () => {
      for (const div of AC7D_DIVS.filter((row) => row !== UNBOUND_ROOT)) {
        expect(serializeResourceXml(model(narrativeJson(div)))).toBe(writtenNarrative(div));
      }
      const err = refusal(model(narrativeJson(UNBOUND_ROOT)));
      expect(err).toBeInstanceOf(FhirSerializeError);
      expect(err?.code).toBe(DIV_PREFIX);
      expect(err?.locations).toEqual(["Patient.text.div"]);
    });

    /**
     * WHAT THE NEW REFUSAL MUST NOT REACH, AS A PIN COMPARISON: every prefix bound inside the string,
     * on the root, on an inner element or on an attribute, the `xml` prefix, and every other row of
     * the list above. Literals, and this test passes against the pin's `src/` as well.
     */
    it("AC-3: writes every div that binds its own prefixes, or uses only xml, as the pin did", () => {
      for (const div of ADMITTED_DIVS) {
        const node = model(narrativeJson(div));
        expect(refusal(node)).toBeUndefined();
        expect(serializeResourceXml(node)).toBe(writtenNarrative(div));
      }
    });

    /**
     * ACCEPTED IS NOT LOSSLESS, AND THESE ARE THE COUNTEREXAMPLES THAT KEEP THAT FROM BEING CLAIMED.
     *
     * The check answers one question (does this string spell the one `div` element the property
     * names), and a string can pass it and still not come back the same, and still leave output a
     * conformant parser rejects. They are asserted rather than described, because a sentence in
     * this area keeps being refuted and an example cannot drift from the code. Each reproduces on
     * base; none is caused by the check. The unbound root that used to lead this list is refused
     * now, by a check of its own, below.
     */
    it("accepts a div whose nesting the re-read cannot afford, and that failure is loud", () => {
      // The check spends the reader's depth budget from 0; the re-read spends it from the `div`'s
      // depth in the document, so the two do not agree at the boundary. 253 survives, 254 does not.
      const nest = (n: number): string =>
        `<div xmlns="http://www.w3.org/1999/xhtml">${"<p>".repeat(n)}x${"</p>".repeat(n)}</div>`;
      const build = (n: number): FhirComplex =>
        model(
          JSON.stringify({ resourceType: "Patient", text: { status: "generated", div: nest(n) } }),
        );
      expect(refusal(build(253))).toBeUndefined();
      expect(() => parseResourceXml(serializeResourceXml(build(253)))).not.toThrow();
      expect(refusal(build(254))).toBeUndefined();
      // The CODE, not just a throw: a bare `toThrow()` stays green if the failure degrades to
      // something else, and the prose above names this one.
      expect(() => parseResourceXml(serializeResourceXml(build(254)))).toThrow(/depth bound/);
    });

    it("accepts a div that comes back carrying a namespace the sender never wrote", () => {
      // Not byte-identity: `<div>` under no declaration takes its parent's, which is the FHIR
      // namespace rather than the XHTML one the datatype names, and nothing says so.
      const node = model(
        JSON.stringify({
          resourceType: "Patient",
          text: { status: "generated", div: "<div>x</div>" },
        }),
      );
      const back = parseResourceXml(serializeResourceXml(node));
      const text = back.resource.properties.find((p) => p.name === "text")?.value;
      const read =
        text?.kind === "complex" ? text.properties.find((p) => p.name === "div") : undefined;
      expect(read?.value.kind === "primitive" ? read.value.value : undefined).toBe(
        '<div xmlns="http://hl7.org/fhir">x</div>',
      );
      expect(back.issues).toEqual([]);
    });

    it("accepts an XML declaration, which is not a processing instruction", () => {
      // XML 1.0 §2.6 reserves the `xml` target and §2.8 allows the declaration only at the start of
      // an entity, but `skipMisc` swallows one, so this is written into the middle of a document and
      // a conformant third-party parser rejects the result. This library's own re-read does not.
      const div = '<?xml version="1.0"?><div xmlns="http://www.w3.org/1999/xhtml">x</div>';
      const node = model(
        JSON.stringify({ resourceType: "Patient", text: { status: "generated", div } }),
      );
      const xml = serializeResourceXml(node);
      expect(xml).toContain('<?xml version="1.0"?>');
      expect(parseResourceXml(xml).issues).toEqual([]);
    });

    it("accepts a comment beside the root, which the re-read drops", () => {
      const div = '<!--c--><div xmlns="http://www.w3.org/1999/xhtml"/>';
      const node = model(
        JSON.stringify({ resourceType: "Patient", text: { status: "generated", div } }),
      );
      const xml = serializeResourceXml(node);
      expect(xml).toContain(div);
      const text = parseResourceXml(xml).resource.properties.find((p) => p.name === "text")?.value;
      const read =
        text?.kind === "complex" ? text.properties.find((p) => p.name === "div") : undefined;
      // One element still, and it is the div: the comment is not an element, and it does not survive.
      expect(read?.value.kind === "primitive" ? read.value.value : undefined).toBe(
        '<div xmlns="http://www.w3.org/1999/xhtml"/>',
      );
    });

    /**
     * THE FALSE-POSITIVE CONTROL: A REFUSAL COSTS NOTHING THAT WORKED.
     *
     * Base spliced the string in unexamined, so base's output for any `div` is exactly the document
     * this builds by hand. The property is one-directional on purpose (refused implies base's round
     * trip did not return the same string) because an ACCEPTED string need not come back
     * byte-identical either (an unprefixed `<div>` picks up its parent's namespace on the way back).
     */
    it("refuses nothing whose base round trip returned the same string", () => {
      const alphabet = [..."<>/divp \"='!?-&;\n", "716186003", "status", "value", "code"];
      fc.assert(
        fc.property(
          fc.array(fc.constantFrom(...alphabet), { minLength: 1, maxLength: 12 }),
          (chars) => {
            const div = chars.join("");
            const node = model(
              JSON.stringify({ resourceType: "Patient", text: { status: "generated", div } }),
            );
            if (refusal(node)?.code !== SERIALIZE_ERROR_CODES.UNSERIALIZABLE_DIV_MARKUP) return;
            const baseOutput = `<Patient ${FHIR_NS}><text><status value="generated"/>${div}</text></Patient>`;
            let returned: unknown;
            try {
              const text = parseResourceXml(baseOutput).resource.properties.find(
                (p) => p.name === "text",
              )?.value;
              const read =
                text?.kind === "complex"
                  ? text.properties.find((p) => p.name === "div")
                  : undefined;
              returned = read?.value.kind === "primitive" ? read.value.value : undefined;
            } catch {
              return; // base's output did not re-read at all.
            }
            expect(returned).not.toBe(div);
          },
        ),
        { numRuns: 2000 },
      );
    });
  });

  /**
   * THE SAME RESIDUAL THROUGH A VALUE, CLOSED ON A CODE OF ITS OWN.
   *
   * A `div` string that passes the one-element check can still name a prefix nothing inside it
   * binds, and the branch splices the string in verbatim, so the pin wrote `<v:div>x</v:div>` into a
   * document a conformant parser rejects, and the narrative came back as a property named `v:div`.
   * The line is the one the tag-site refusal drew: every prefix bound by a declaration inside the
   * string, `xml` exempt. The refusal tests here fail against the pin's `src/`; the ones named as
   * pin comparisons assert, as literals, what the pin already did, and pass there too.
   */
  describe("a div whose markup names a prefix nothing inside it binds", () => {
    /** AC-1's document read from XML: its XHTML `div` binds nothing for the prefix its child uses. */
    const READ_FROM_XML =
      `<Patient ${FHIR_NS}><text><status value="generated"/>` +
      `<div xmlns="http://www.w3.org/1999/xhtml"><v:p>x</v:p></div></text></Patient>`;

    /** One model holding a member of the unbound example set. */
    interface UnboundCase {
      /** Builds the model afresh, so no test can share a node with another. */
      readonly build: () => FhirComplex;
      /** The refusal's locations, in walk order. */
      readonly locations: readonly string[];
      /** What `serializeResource` returned for this model at the pin, measured there. */
      readonly json: string;
    }

    /** A `Patient` whose one contained `Patient` carries the narrative `div`. */
    const containedJson = (div: string): string =>
      JSON.stringify({
        resourceType: "Patient",
        contained: [{ resourceType: "Patient", text: { status: "generated", div } }],
      });

    /** Every model AC-1 names, at every depth it names, and the one read from XML. */
    const UNBOUND_MODELS: readonly (readonly [string, UnboundCase])[] = [
      ...UNBOUND_DIVS.flatMap(([where, div]): (readonly [string, UnboundCase])[] => [
        [
          `a prefix ${where}, at Patient.text.div`,
          {
            build: () => model(narrativeJson(div)),
            locations: ["Patient.text.div"],
            json: narrativeJson(div),
          },
        ],
        [
          `a prefix ${where}, inside a contained resource`,
          {
            build: () => model(containedJson(div)),
            locations: ["Patient.contained[0].text.div"],
            json: containedJson(div),
          },
        ],
        [
          `a prefix ${where}, in a resource composed into Bundle.entry.resource after it was read`,
          {
            build: () => inBundle(model(narrativeJson(div))),
            locations: ["Bundle.entry[0].resource.text.div"],
            json: `{"resourceType":"Bundle","type":"collection","entry":[{"resource":${narrativeJson(div)}}]}`,
          },
        ],
      ]),
      [
        "a div string read from XML, then written",
        {
          build: () => parseResourceXml(READ_FROM_XML).resource,
          locations: ["Patient.text.div"],
          json: '{"resourceType":"Patient","text":{"status":"generated","div":"<div xmlns=\\"http://www.w3.org/1999/xhtml\\"><v:p>x</v:p></div>"}}',
        },
      ],
    ];

    /**
     * Conformant documents whose narrative uses a prefix an ANCESTOR of the `div` binds, with the
     * `div` string the reader hands back for each: it carries the inherited declaration, which is
     * what keeps the write open (AC-4). The first is the one AC-4 names.
     */
    const ANCESTOR_BOUND = [
      [
        "on the div itself, which an ancestor",
        `<Patient ${FHIR_NS} xmlns:h="http://www.w3.org/1999/xhtml"><text><status value="generated"/>` +
          `<h:div>ok</h:div></text></Patient>`,
        '<h:div xmlns:h="http://www.w3.org/1999/xhtml">ok</h:div>',
      ],
      [
        "on an inner element, which an ancestor",
        `<Patient ${FHIR_NS} xmlns:v="urn:x"><text><status value="generated"/>` +
          `<div xmlns="http://www.w3.org/1999/xhtml"><v:p>x</v:p></div></text></Patient>`,
        '<div xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:x"><v:p>x</v:p></div>',
      ],
      [
        "on an attribute, which an ancestor",
        `<Patient ${FHIR_NS} xmlns:v="urn:x"><text><status value="generated"/>` +
          `<div xmlns="http://www.w3.org/1999/xhtml"><p v:a="1">x</p></div></text></Patient>`,
        '<div xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:x"><p v:a="1">x</p></div>',
      ],
    ] as const;

    /** Strings that fail the one-element check AND name an unbound prefix (AC-5). */
    const FAILS_BOTH = [
      ["an unbound root followed by a sibling", "<v:div>x</v:div><x/>"],
      ["an unbound root whose local name is not div", "<v:p>x</v:p>"],
    ] as const;

    /** A model the pin refused, built around one member of the unbound example set. */
    interface EarlierCase {
      /** Builds the model afresh. */
      readonly build: () => FhirComplex;
      /** What `serializeResource` returned for this model at the pin, measured there. */
      readonly json: string;
    }

    /** A model read from `json`, which the pin's JSON writer returned unchanged. */
    const fromJson = (json: string): EarlierCase => ({ build: () => model(json), json });

    /** A root read out of a vendor vocabulary, which the pin refused on the foreign-root code. */
    const FOREIGN_ROOT =
      '<v:Observation xmlns:v="urn:vendor"><v:status value="final"/></v:Observation>';

    /**
     * Every refusal the pin raised that the JSON writer does not share, each beside a member of the
     * unbound example set, with the code and the locations the pin raised for it, measured there.
     */
    const EARLIER_ROWS: readonly (readonly [
      string,
      (div: string) => EarlierCase,
      string,
      readonly string[],
    ])[] = [
      [
        "a colon-bearing property name",
        (div) =>
          fromJson(
            JSON.stringify({
              resourceType: "Patient",
              text: { status: "generated", div },
              "p:x": "v",
            }),
          ),
        "UNSERIALIZABLE_PREFIXED_NAME",
        [`Patient.${WITHHELD}`],
      ],
      [
        "a tag-breaking property name",
        (div) =>
          fromJson(
            JSON.stringify({
              resourceType: "Patient",
              text: { status: "generated", div },
              "a b": "v",
            }),
          ),
        "UNSERIALIZABLE_ELEMENT_NAME",
        [`Patient.${WITHHELD}`],
      ],
      [
        "a second div failing the one-element check",
        (div) =>
          fromJson(
            JSON.stringify({
              resourceType: "Patient",
              text: { status: "generated", div },
              contained: [
                { resourceType: "Patient", text: { status: "generated", div: "<p>b</p>" } },
              ],
            }),
          ),
        "UNSERIALIZABLE_DIV_MARKUP",
        ["Patient.contained[0].text.div"],
      ],
      [
        "a shape only FHIR JSON can spell",
        (div) =>
          fromJson(
            JSON.stringify({
              resourceType: "Patient",
              text: { status: "generated", div },
              name: [[{ family: "X" }]],
            }),
          ),
        "UNSERIALIZABLE_JSON_ONLY_SHAPE",
        ["Patient.name[0]"],
      ],
      [
        "an array wrapper around a 0..1 element",
        (div) =>
          fromJson(
            JSON.stringify({
              resourceType: "Observation",
              status: ["final"],
              text: { status: "generated", div },
            }),
          ),
        "UNSERIALIZABLE_ARRAY_WRAPPER",
        ["Observation.status"],
      ],
      [
        "an untaggable resourceType",
        (div) =>
          fromJson(
            JSON.stringify({
              resourceType: "Patient",
              text: { status: "generated", div },
              contained: [{ resourceType: 42 }],
            }),
          ),
        "UNSERIALIZABLE_RESOURCE_TYPE",
        ["Patient.contained[0].resourceType"],
      ],
      [
        "a foreign root in the same Bundle",
        (div) => ({
          build: () => inBundle(parseResourceXml(FOREIGN_ROOT).resource, model(narrativeJson(div))),
          json: `{"resourceType":"Bundle","type":"collection","entry":[{"resource":{"resourceType":"Observation","status":"final"}},{"resource":${narrativeJson(div)}}]}`,
        }),
        "UNSERIALIZABLE_FOREIGN_ROOT",
        ["Bundle.entry[0].resource"],
      ],
      [
        "an array wrapper around a value[x] choice",
        (div) =>
          fromJson(
            JSON.stringify({
              resourceType: "Observation",
              status: "final",
              valueString: ["a"],
              text: { status: "generated", div },
            }),
          ),
        "UNSERIALIZABLE_CHOICE_WRAPPER",
        ["Observation.valueString"],
      ],
    ];

    /** Every row above, once with each member of the unbound example set. */
    const EARLIER_MODELS = EARLIER_ROWS.flatMap(([label, make, code, locations]) =>
      UNBOUND_DIVS.map(
        ([where, div]) =>
          [`${label}, beside a prefix ${where}`, make(div), code, locations] as const,
      ),
    );

    /**
     * The characterization test that pinned this route as written, rewritten over the same document
     * in the change that closed it. The pin wrote the string as it stands, and its re-read of that
     * output (built here by hand, exactly as the pin wrote it) carries a property named `v:div` where
     * the narrative was, with nothing at either end saying so.
     */
    it("AC-2: refuses a root whose prefix nothing binds, which the pin wrote and re-read as another property", () => {
      const err = refusal(model(narrativeJson(UNBOUND_ROOT)));
      expect(err).toBeInstanceOf(FhirSerializeError);
      expect(err?.code).toBe(DIV_PREFIX);
      expect(err?.locations).toEqual(["Patient.text.div"]);
      expect(textNames(parseResourceXml(writtenNarrative(UNBOUND_ROOT)).resource)).toEqual([
        "status",
        "v:div",
      ]);
    });

    /**
     * The spellings AC-1's clause reaches beyond the example set: a prefix that no declaration can
     * bind, whatever the string declares. An empty declaration binds nothing (Namespaces in XML 1.0
     * §3 forbids it, 1.1 reads it as undeclaring), `xmlns` may never be declared (§3), and a name
     * with an empty prefix, an empty local part or two colons is no qualified name at all (§7).
     */
    it.each([
      [
        "a prefix whose only declaration is empty",
        '<div xmlns="http://www.w3.org/1999/xhtml" xmlns:v=""><v:p>x</v:p></div>',
      ],
      [
        "an empty prefix, declared anyway",
        '<div xmlns="http://www.w3.org/1999/xhtml" xmlns:="urn:x"><:p>x</:p></div>',
      ],
      [
        "the xmlns prefix on an element, declared anyway",
        '<div xmlns="http://www.w3.org/1999/xhtml" xmlns:xmlns="urn:x"><xmlns:p>x</xmlns:p></div>',
      ],
      [
        "two colons under a bound prefix",
        '<div xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:x"><v:p:q>x</v:p:q></div>',
      ],
      [
        "an empty local part under a bound prefix",
        '<div xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:x"><p v:="1">x</p></div>',
      ],
    ])("AC-1: refuses a div whose markup names %s, which no declaration binds", (_label, div) => {
      const err = refusal(model(narrativeJson(div)));
      expect(err).toBeInstanceOf(FhirSerializeError);
      expect(err?.code).toBe(DIV_PREFIX);
      expect(err?.locations).toEqual(["Patient.text.div"]);
    });

    it.each(UNBOUND_MODELS)("AC-1: refuses %s, and returns no document", (_label, c) => {
      const node = c.build();
      expect(() => serializeResourceXml(node)).toThrow(FhirSerializeError);
      const err = refusal(node);
      expect(err).toBeInstanceOf(FhirSerializeError);
      expect(err?.code).toBe(DIV_PREFIX);
    });

    it.each(UNBOUND_MODELS)(
      "AC-7: reports %s at its bounded location, and echoes none of it",
      (_label, c) => {
        const err = refusal(c.build());
        expect(err).toBeInstanceOf(FhirSerializeError);
        expect(err?.locations).toEqual(c.locations);
        const surface = `${String(err?.message)}\n${(err?.locations ?? []).join("\n")}`;
        for (const [, div] of UNBOUND_DIVS) expect(surface).not.toContain(div);
        expect(surface).not.toContain("v:");
        // No `<`, no `>`, and no colon at all, which covers every prefix followed by its colon.
        expect(surface).not.toMatch(/[<>:]/u);
        expect(err?.message).toContain(`${String(c.locations.length)} div location(s)`);
      },
    );

    it("AC-7: reports every refused div once, deduplicated, in walk order", () => {
      const text = (div: string): FhirComplex =>
        complex([
          { name: "status", value: primitive("generated") },
          { name: "div", value: primitive(div) },
        ]);
      // Two properties named `text` in one element, built by hand: the writer walks both, at one
      // location, and a third div sits in a contained resource after them.
      const node = complex([
        { name: "resourceType", value: primitive("Patient") },
        { name: "text", value: text(UNBOUND_DIVS[0][1]) },
        { name: "text", value: text(UNBOUND_DIVS[1][1]) },
        { name: "contained", value: list([model(narrativeJson(UNBOUND_DIVS[2][1]))]) },
      ]);
      const err = refusal(node);
      expect(err).toBeInstanceOf(FhirSerializeError);
      expect(err?.code).toBe(DIV_PREFIX);
      expect(err?.locations).toEqual(["Patient.text.div", "Patient.contained[0].text.div"]);
      expect(err?.message).toContain("2 div location(s)");
    });

    it.each(ANCESTOR_BOUND)(
      "AC-4: writes back a narrative whose prefix %s bound, and re-reads it as the narrative",
      (_label, doc, read) => {
        const { resource } = parseResourceXml(doc);
        expect(refusal(resource)).toBeUndefined();
        const xml = serializeResourceXml(resource);
        expect(xml).toBe(writtenNarrative(read));
        expect(textNames(parseResourceXml(xml).resource)).toEqual(["status", "div"]);
      },
    );

    it.each(FAILS_BOTH)(
      "AC-5: refuses %s on the one-element check, as the pin did, never on the prefix code",
      (_label, div) => {
        const err = refusal(model(narrativeJson(div)));
        expect(err).toBeInstanceOf(FhirSerializeError);
        expect(err?.code).toBe("UNSERIALIZABLE_DIV_MARKUP");
        expect(err?.code).not.toBe(DIV_PREFIX);
        expect(err?.locations).toEqual(["Patient.text.div"]);
      },
    );

    it.each(EARLIER_MODELS)(
      "AC-6: keeps the pin's code and locations for %s",
      (_label, c, code, locations) => {
        const err = refusal(c.build());
        expect(err).toBeInstanceOf(FhirSerializeError);
        expect(err?.code).toBe(code);
        expect(err?.locations).toEqual(locations);
      },
    );

    it.each(UNBOUND_MODELS)(
      "AC-8: the JSON writer returns the pin's string, and no refusal, for %s",
      (_label, c) => {
        expect(serializeResource(c.build())).toBe(c.json);
      },
    );

    it.each(EARLIER_MODELS)(
      "AC-8: the JSON writer returns the pin's string, and no refusal, for %s",
      (_label, c) => {
        expect(serializeResource(c.build())).toBe(c.json);
      },
    );

    it("AC-8: the JSON writer returns the pin's string, and no refusal, for every AC-3, AC-4 and AC-5 model", () => {
      for (const div of [...ADMITTED_DIVS, ...FAILS_BOTH.map(([, row]) => row)]) {
        expect(serializeResource(model(narrativeJson(div)))).toBe(narrativeJson(div));
      }
      for (const [, doc, read] of ANCESTOR_BOUND) {
        expect(serializeResource(parseResourceXml(doc).resource)).toBe(narrativeJson(read));
      }
    });
  });
});
