/**
 * The models the XML well-formedness refusals are graded over, spelled as data.
 *
 * Shared by the capture script (`scripts/capture-xml-wellformed.ts`), which builds every model here
 * with the BASE tree's own readers and constructors and records what that tree's two writers
 * returned for it, and by the two suites that grade head: `test/xml-wellformed.test.ts` (the
 * refusals head adds) and `test/xml-wellformed-base.test.ts` (what head must keep as the base did).
 * A model is a {@link Recipe} rather than a built node so it can be committed beside the output it
 * produced, and so each tree builds it with its own code rather than with the other's.
 *
 * "Name" and "Char" below are XML 1.0 (Fifth Edition) productions [5] and [2]. Every name, value
 * and namespace URI here is synthetic.
 */

import { WITHHELD } from "../src/model/path.js";

/**
 * A model, as data. `json` and `xml` are documents a reader turns into a resource; `complex`,
 * `list` and `primitive` are built with the model constructors, which is how a caller composes a
 * resource the readers never produce (a name beginning `_`, two members of one name).
 */
export type Recipe =
  | { readonly json: string }
  | { readonly xml: string }
  | { readonly complex: readonly (readonly [string, Recipe])[] }
  | { readonly list: readonly Recipe[] }
  | {
      readonly primitive: string | boolean | null;
      readonly id?: string;
      readonly extension?: readonly Recipe[];
    };

/** The readers and constructors a tree builds a {@link Recipe} with, so base and head are called alike. */
export interface ModelCodec<N, C extends N> {
  readonly parseResource: (text: string) => { readonly resource: C };
  readonly parseResourceXml: (text: string) => { readonly resource: C };
  readonly complex: (properties: readonly { readonly name: string; readonly value: N }[]) => C;
  readonly list: (items: readonly N[]) => N;
  readonly primitive: (
    value: string | boolean | undefined,
    meta?: { readonly id?: string; readonly extension?: readonly C[] },
  ) => N;
}

/** Build a recipe that names a complex (a document or a `complex`), refusing any other kind. */
export function buildComplex<N, C extends N>(recipe: Recipe, codec: ModelCodec<N, C>): C {
  if ("json" in recipe) return codec.parseResource(recipe.json).resource;
  if ("xml" in recipe) return codec.parseResourceXml(recipe.xml).resource;
  if ("complex" in recipe) {
    return codec.complex(
      recipe.complex.map(([name, value]) => ({ name, value: buildNode(value, codec) })),
    );
  }
  throw new Error("recipe does not name a complex");
}

/** Build any recipe. */
export function buildNode<N, C extends N>(recipe: Recipe, codec: ModelCodec<N, C>): N {
  if ("list" in recipe) return codec.list(recipe.list.map((item) => buildNode(item, codec)));
  if ("primitive" in recipe) {
    const meta: { id?: string; extension?: readonly C[] } = {};
    if (recipe.id !== undefined) meta.id = recipe.id;
    if (recipe.extension !== undefined) {
      meta.extension = recipe.extension.map((ext) => buildComplex(ext, codec));
    }
    return codec.primitive(recipe.primitive ?? undefined, meta);
  }
  return buildComplex(recipe, codec);
}

/** What one writer did with one model: the string it returned, or the refusal it raised. */
export type Outcome =
  | { readonly written: string }
  | { readonly refused: string; readonly locations: readonly string[] }
  | { readonly threw: string };

/**
 * Run one writer and record its outcome. A `FhirSerializeError` is recognised by name rather than by
 * class, because the base tree's class is a different object from head's.
 */
export function outcome(write: () => string): Outcome {
  try {
    return { written: write() };
  } catch (error) {
    if (error instanceof Error && error.name === "FhirSerializeError") {
      const { code, locations } = error as Error & { code?: unknown; locations?: unknown };
      return {
        refused: String(code),
        locations: Array.isArray(locations) ? locations.map((entry) => String(entry)) : [],
      };
    }
    return { threw: error instanceof Error ? error.name : "unknown" };
  }
}

/** One named model and, where a suite grades a refusal head raises, the locations it must list. */
export interface NamedModel {
  readonly label: string;
  readonly recipe: Recipe;
  /** Head's locations for the new code, in walk order. Absent where the base's record is the grade. */
  readonly locations?: readonly string[];
}

/** A JSON document recipe, from an object `JSON.stringify` spells. */
function json(document: Record<string, unknown>): Recipe {
  return { json: JSON.stringify(document) };
}

/** A primitive recipe. */
function prim(value: string | boolean | null, meta: { id?: string } = {}): Recipe {
  return meta.id === undefined ? { primitive: value } : { primitive: value, id: meta.id };
}

/** A resource recipe built with the constructors, `resourceType` first. */
function resource(type: string, ...properties: (readonly [string, Recipe])[]): Recipe {
  return { complex: [["resourceType", prim(type)], ...properties] };
}

/** Each recipe composed into its own `Bundle.entry.resource`, as a caller builds one after reading. */
function bundle(...resources: readonly Recipe[]): Recipe {
  return resource(
    "Bundle",
    ["type", prim("collection")],
    ["entry", { list: resources.map((r): Recipe => ({ complex: [["resource", r]] })) }],
  );
}

const W = WITHHELD;
const XHTML = "http://www.w3.org/1999/xhtml";
const FHIR_NS = "http://hl7.org/fhir";

/** A `Patient` carrying one member named `name`, whose value is the string `v`. */
function named(name: string): Recipe {
  return json({ resourceType: "Patient", [name]: "v" });
}

/** A `Patient` whose generated narrative is `div`. */
function narrative(div: string): Record<string, unknown> {
  return { resourceType: "Patient", text: { status: "generated", div } };
}

/**
 * Names that are not a Name and that the base does not refuse: each fails neither the tag-breaking
 * question nor the colon question the base asks, so the base wrote every one of them.
 */
const NOT_A_NAME: readonly (readonly [string, string])[] = [
  ["an ampersand", "a&b"],
  ["a leading digit", "1abc"],
  ["a leading hyphen", "-x"],
  ["a leading full stop", ".x"],
  ["a double quote", 'a"b'],
  ["an apostrophe", "a'b"],
  ["a leading U+00B7, a NameChar that is not a NameStartChar", "·x"],
  ["a leading combining mark U+0300", "̀x"],
  ["U+0000", "a\u0000b"],
  ["U+0001", "a\u0001b"],
  ["a vertical tab, which is not a Char", "a\u000bb"],
  ["a form feed, which is not a Char", "a\u000cb"],
  ["a non-breaking space, a Char that is not a NameChar", "a b"],
  ["an unpaired high surrogate", "a\ud800b"],
  ["an unpaired low surrogate", "a\udc00b"],
  ["U+FFFE", "a￾b"],
  ["U+00D7, a Char between two NameStartChar ranges", "a×b"],
  ["U+2190, a Char between two NameStartChar ranges", "a←b"],
  ["U+3000, a Char between two NameStartChar ranges", "a　b"],
  ["U+FDD0, a Char that is not a NameChar", "a﷐b"],
];

/** AC-1: every model whose only refusal head adds is the name code, with its locations. */
export const NAME_MODELS: readonly NamedModel[] = [
  ...NOT_A_NAME.map(
    ([label, name]): NamedModel => ({
      label: `a property name carrying ${label}`,
      recipe: named(name),
      locations: [`Patient.${W}`],
    }),
  ),
  {
    label: "a name read from XML, which the reader reads back as written",
    recipe: {
      xml: `<Patient xmlns="${FHIR_NS}"><active value="true"/><1abc value="v"/></Patient>`,
    },
    locations: [`Patient.${W}`],
  },
  {
    label: "a name inside a backbone element",
    recipe: json({ resourceType: "Patient", contact: [{ gender: "other", "a&b": "x" }] }),
    locations: [`Patient.contact[0].${W}`],
  },
  {
    label: "a name inside a contained resource",
    recipe: json({
      resourceType: "Patient",
      contained: [{ resourceType: "Observation", status: "final", "1abc": "v" }],
    }),
    locations: [`Patient.contained[0].${W}`],
  },
  {
    label: "a name inside Bundle.entry.resource, as read",
    recipe: json({
      resourceType: "Bundle",
      type: "collection",
      entry: [{ resource: { resourceType: "Observation", status: "final", "-x": "v" } }],
    }),
    locations: [`Bundle.entry[0].resource.${W}`],
  },
  {
    label: "a name inside a resource composed into Bundle.entry.resource after it was read",
    recipe: bundle(named("a\u0000b")),
    locations: [`Bundle.entry[0].resource.${W}`],
  },
  {
    label: "a name inside an extension on a complex element",
    recipe: json({
      resourceType: "Patient",
      extension: [{ url: "http://example.org/e", ".y": "v" }],
    }),
    locations: [`Patient.extension[0].${W}`],
  },
  {
    label: "a name inside an extension on a primitive",
    recipe: json({
      resourceType: "Patient",
      gender: "other",
      _gender: { extension: [{ url: "http://example.org/e", "1x": "v" }] },
    }),
    locations: [`Patient.gender.extension[0].${W}`],
  },
  {
    label: "a name inside a modifierExtension",
    recipe: json({
      resourceType: "Patient",
      modifierExtension: [{ url: "http://example.org/e", "a'b": "v" }],
    }),
    locations: [`Patient.modifierExtension[0].${W}`],
  },
  {
    label: "the root resourceType, which is the root's tag",
    recipe: json({ resourceType: "1Patient", active: true }),
    locations: [W],
  },
  {
    label: "a root resourceType carrying U+0000",
    recipe: json({ resourceType: "Pat\u0000ient", active: true }),
    locations: [W],
  },
  {
    label: "a contained resource's resourceType, reported at the element wrapping it",
    recipe: json({ resourceType: "Patient", contained: [{ resourceType: "Obs&ervation" }] }),
    locations: ["Patient.contained[0]"],
  },
  {
    label: "a Bundle entry's resourceType, reported at the element wrapping it",
    recipe: json({
      resourceType: "Bundle",
      type: "collection",
      entry: [{ resource: { resourceType: "-Observation", status: "final" } }],
    }),
    locations: ["Bundle.entry[0].resource"],
  },
  {
    label: "the wrapper name of a resource-valued element",
    recipe: json({
      resourceType: "Patient",
      "1c": { resourceType: "Observation", status: "final" },
    }),
    locations: [`Patient.${W}`],
  },
  {
    label: "a repeating element, one location per item",
    recipe: json({ resourceType: "Patient", "a&b": ["x", "y"] }),
    locations: [`Patient.${W}[0]`, `Patient.${W}[1]`],
  },
  {
    label: "a name beginning an unpaired surrogate on a primitive carrying extensions",
    recipe: resource("Patient", [
      "\udfffx",
      { primitive: "v", extension: [{ complex: [["url", prim("http://example.org/e")]] }] },
    ]),
    locations: [`Patient.${W}`],
  },
  {
    label: "several positions, each listed once, in walk order",
    recipe: json({
      resourceType: "Patient",
      "a&b": "1",
      "1abc": "2",
      contact: [{ "-x": "3" }, { ".y": "4" }],
      contained: [{ resourceType: "Obs&ervation" }],
      extension: [{ url: "http://example.org/e", "a\u0000": "5" }],
    }),
    locations: [
      `Patient.${W}`,
      `Patient.contact[0].${W}`,
      `Patient.contact[1].${W}`,
      "Patient.contained[0]",
      `Patient.extension[0].${W}`,
    ],
  },
];

/** The code points outside Char that AC-2 names, each once. */
const NOT_A_CHAR: readonly (readonly [string, string])[] = [
  ["U+0000", "\u0000"],
  ["U+0001", "\u0001"],
  ["U+0008", "\u0008"],
  ["U+000B", "\u000b"],
  ["U+000C", "\u000c"],
  ["U+000E", "\u000e"],
  ["U+001F", "\u001f"],
  ["an unpaired high surrogate U+D800", "\ud800"],
  ["an unpaired high surrogate U+DBFF followed by a non-surrogate", "\udbffx"],
  ["an unpaired low surrogate U+DC00", "\udc00"],
  ["an unpaired low surrogate U+DFFF", "\udfff"],
  ["U+FFFE", "￾"],
  ["U+FFFF", "￿"],
];

/** AC-2: every model whose only refusal head adds is the character code, with its locations. */
export const CHARACTER_MODELS: readonly NamedModel[] = [
  ...NOT_A_CHAR.map(
    ([label, char]): NamedModel => ({
      label: `${label} in a primitive's value`,
      recipe: json({ resourceType: "Observation", status: "final", valueString: `a${char}b` }),
      locations: ["Observation.valueString"],
    }),
  ),
  {
    label: "a non-Char at the start of a value",
    recipe: json({ resourceType: "Observation", status: "final", valueString: "\u0000ab" }),
    locations: ["Observation.valueString"],
  },
  {
    label: "a non-Char at the end of a value, a high surrogate with no pair after it",
    recipe: json({ resourceType: "Observation", status: "final", valueString: "ab\ud83d" }),
    locations: ["Observation.valueString"],
  },
  {
    label: "a non-Char in a primitive's id, which is written as an attribute",
    recipe: json({ resourceType: "Patient", gender: "other", _gender: { id: "g\u0000" } }),
    locations: ["Patient.gender.id"],
  },
  {
    label: "a non-Char in a complex element's id, which is written as an attribute",
    recipe: json({ resourceType: "Patient", contact: [{ id: "c\u000b", gender: "other" }] }),
    locations: ["Patient.contact[0].id"],
  },
  {
    label: "a non-Char in Extension.url, which is written as an attribute",
    recipe: json({
      resourceType: "Patient",
      extension: [{ url: "http://example.org/\u0000", valueString: "x" }],
    }),
    locations: ["Patient.extension[0].url"],
  },
  {
    label: "a non-Char in the url of an extension on a primitive",
    recipe: json({
      resourceType: "Patient",
      gender: "other",
      _gender: { extension: [{ url: "http://example.org/￾", valueCode: "x" }] },
    }),
    locations: ["Patient.gender.extension[0].url"],
  },
  {
    label: "a non-Char in a value inside an extension",
    recipe: json({
      resourceType: "Patient",
      extension: [{ url: "http://example.org/e", valueString: "a\u001fb" }],
    }),
    locations: ["Patient.extension[0].valueString"],
  },
  {
    label: "a non-Char in Resource.id, which is written as a child element's value",
    recipe: json({ resourceType: "Patient", id: "p\u0001" }),
    locations: ["Patient.id"],
  },
  {
    label: "a non-Char in a value inside a contained resource",
    recipe: json({
      resourceType: "Patient",
      contained: [{ resourceType: "Observation", status: "final", valueString: "a\u0000" }],
    }),
    locations: ["Patient.contained[0].valueString"],
  },
  {
    label: "a non-Char in a value inside a resource composed into Bundle.entry.resource",
    recipe: bundle(json({ resourceType: "Observation", status: "fin￿al" })),
    locations: ["Bundle.entry[0].resource.status"],
  },
  {
    label: "a non-Char in one item of a repeating element",
    recipe: json({
      resourceType: "Observation",
      status: "final",
      note: [{ text: "a" }, { text: "b\u0000" }],
    }),
    locations: ["Observation.note[1].text"],
  },
  {
    label: "a non-Char in a model read from XML, where a character reference denoted it",
    recipe: {
      xml: `<Observation xmlns="${FHIR_NS}"><status value="final"/><valueString value="a&#0;b"/></Observation>`,
    },
    locations: ["Observation.valueString"],
  },
  {
    label: "a non-Char in a value whose property name begins with an underscore, built by hand",
    recipe: resource("Patient", ["_x", prim("a\u0000")]),
    locations: [`Patient.${W}`],
  },
  {
    label: "two members of one name at one location, listed once",
    recipe: resource(
      "Observation",
      ["status", prim("final")],
      ["valueString", prim("a\u0000")],
      ["valueString", prim("b\u0001")],
    ),
    locations: ["Observation.valueString"],
  },
  {
    label: "several locations, each listed once, in walk order",
    recipe: json({
      resourceType: "Patient",
      id: "a\u0000",
      gender: "c\u0002",
      _gender: { id: "b\u0001" },
      contact: [{ id: "d\u0003", gender: "other" }],
      extension: [{ url: "http://example.org/\u0004", valueString: "e\u0005" }],
      contained: [{ resourceType: "Observation", status: "f\u0006" }],
    }),
    locations: [
      "Patient.id",
      "Patient.gender.id",
      "Patient.gender",
      "Patient.contact[0].id",
      "Patient.extension[0].url",
      "Patient.extension[0].valueString",
      "Patient.contained[0].status",
    ],
  },
];

/**
 * AC-3: `div` strings the base wrote (each spells the one `div` element and binds every prefix it
 * names) that carry a non-Char, raw or denoted by a character reference, with their locations.
 */
export const DIV_MODELS: readonly NamedModel[] = [
  ...(
    [
      ["U+0000 raw in the text", `<div xmlns="${XHTML}">a\u0000b</div>`],
      ["U+000C raw in an attribute value", `<div xmlns="${XHTML}" title="a\u000cb">x</div>`],
      ["an unpaired surrogate raw in the text", `<div xmlns="${XHTML}"><p>a\udc00b</p></div>`],
      ["U+FFFF raw inside a comment", `<div xmlns="${XHTML}">x<!--￿--></div>`],
      [
        "U+0001 raw in an element name inside it",
        `<div xmlns="${XHTML}"><p\u0001>x</p\u0001></div>`,
      ],
      ["&#0; in the text", `<div xmlns="${XHTML}">a&#0;b</div>`],
      ["&#x1F; in the text", `<div xmlns="${XHTML}">a&#x1F;b</div>`],
      ["&#xFFFE; in an attribute value", `<div xmlns="${XHTML}" title="a&#xFFFE;b">x</div>`],
      ["&#8; in a nested element", `<div xmlns="${XHTML}"><p><b>a&#8;b</b></p></div>`],
      ["&#xD800; in the text", `<div xmlns="${XHTML}">a&#xD800;b</div>`],
      // Each reference refers to an unpaired surrogate; decoded together they read as one U+1F600.
      [
        "a surrogate pair spelled as two hex references in the text",
        `<div xmlns="${XHTML}">a&#xD83D;&#xDE00;b</div>`,
      ],
      [
        "a surrogate pair spelled as two decimal references in the text",
        `<div xmlns="${XHTML}">a&#55357;&#56832;b</div>`,
      ],
      [
        "a surrogate pair spelled as two hex references in an attribute value",
        `<div xmlns="${XHTML}" title="&#xD800;&#xDC00;">x</div>`,
      ],
      ["&#xFFFF; in the text", `<div xmlns="${XHTML}">a&#xFFFF;b</div>`],
      ["&#x0B; under a prefix the string binds", `<h:div xmlns:h="${XHTML}">a&#x0B;b</h:div>`],
    ] as const
  ).map(
    ([label, div]): NamedModel => ({
      label: `a div carrying ${label}`,
      recipe: json(narrative(div)),
      locations: ["Patient.text.div"],
    }),
  ),
  {
    label: "a div inside a contained resource",
    recipe: json({
      resourceType: "Patient",
      contained: [narrative(`<div xmlns="${XHTML}">&#0;</div>`)],
    }),
    locations: ["Patient.contained[0].text.div"],
  },
  {
    label: "a div inside a resource composed into Bundle.entry.resource",
    recipe: bundle(json(narrative(`<div xmlns="${XHTML}">a\u0000</div>`))),
    locations: ["Bundle.entry[0].resource.text.div"],
  },
  {
    label: "a div string read from XML, where a character reference denoted the non-Char",
    recipe: {
      xml: `<Patient xmlns="${FHIR_NS}"><text><status value="generated"/><div xmlns="${XHTML}">a&amp;#0;b&#x7;</div></text></Patient>`,
    },
    locations: ["Patient.text.div"],
  },
  {
    label: "two divs, each listed once, in walk order",
    recipe: json({
      ...narrative(`<div xmlns="${XHTML}">&#0;</div>`),
      contained: [narrative(`<div xmlns="${XHTML}">&#x1;</div>`)],
    }),
    locations: ["Patient.text.div", "Patient.contained[0].text.div"],
  },
];

/**
 * AC-3: `div` strings whose references all denote Chars, and one whose only non-Char-looking text
 * sits inside a comment where no reference is decoded. Each must be written as the base wrote it.
 */
export const DIV_WRITTEN_MODELS: readonly NamedModel[] = (
  [
    ["&#9;", `<div xmlns="${XHTML}">a&#9;b</div>`],
    ["&#10;", `<div xmlns="${XHTML}">a&#10;b</div>`],
    ["&#13;", `<div xmlns="${XHTML}">a&#13;b</div>`],
    ["&#233;", `<div xmlns="${XHTML}">caf&#233;</div>`],
    ["&#x20; and &#xD7FF; in an attribute", `<div xmlns="${XHTML}" title="&#x20;&#xD7FF;">x</div>`],
    ["&#xE000; and &#xFFFD;", `<div xmlns="${XHTML}">&#xE000;&#xFFFD;</div>`],
    ["&#x10000; and &#x10FFFF;", `<div xmlns="${XHTML}">&#x10000;&#x10FFFF;</div>`],
    ["&#x1F600;", `<div xmlns="${XHTML}">&#x1F600;</div>`],
    [
      "&#0; inside a comment, where no reference is decoded",
      `<div xmlns="${XHTML}">a<!--&#0;-->b</div>`,
    ],
    ["&#x1; inside a comment before the root", `<!--&#x1;--><div xmlns="${XHTML}">a</div>`],
  ] as const
).map(
  ([label, div]): NamedModel => ({
    label: `a div carrying ${label}`,
    recipe: json(narrative(div)),
  }),
);

/**
 * AC-5: every tag name a Name and every emitted value and `div` string Chars only, reaching into the
 * ranges a narrower rule would wrongly refuse. Each must be written as the base wrote it.
 */
export const CLEAN_MODELS: readonly NamedModel[] = [
  { label: "a non-ASCII NameStartChar, U+00E9", recipe: named("é") },
  { label: "a name of CJK ideographs", recipe: named("中文") },
  {
    label: "a name beginning with an underscore, built by hand",
    recipe: resource("Patient", ["_x", prim("v")]),
  },
  {
    label: "a name beginning with an underscore, read from XML",
    recipe: { xml: `<Patient xmlns="${FHIR_NS}"><_x value="v"/></Patient>` },
  },
  { label: "xml:1abc, which is a Name", recipe: named("xml:1abc") },
  { label: "NameChars that are not NameStartChars, after the first", recipe: named("a-.9·̀ͯ‿⁀") },
  { label: "the NameStartChar range edges", recipe: named("ÀÖØöø˿ͰͽͿ῿‌‍⁰↏Ⰰ⿯、퟿豈﷏ﷰ�") },
  { label: "a supplementary NameStartChar, U+1F600, as a surrogate pair", recipe: named("😀") },
  { label: "U+EFFFF, the last NameStartChar", recipe: named("x󯿿") },
  { label: "a non-ASCII resourceType", recipe: json({ resourceType: "Patiént", active: true }) },
  {
    label: "the discouraged-but-legal range U+007F to U+009F in a value",
    recipe: json({
      resourceType: "Observation",
      status: "final",
      valueString: "a\u007f\u0085\u009fb",
    }),
  },
  {
    label: "the discouraged-but-legal range U+FDD0 to U+FDEF in a value",
    recipe: json({ resourceType: "Observation", status: "final", valueString: "﷐﷯" }),
  },
  {
    label: "U+1F600 in a value, as a surrogate pair",
    recipe: json({ resourceType: "Observation", status: "final", valueString: "a😀b" }),
  },
  {
    label:
      "the Char edges in a value: tab, newline, carriage return, U+0020, U+D7FF, U+E000, U+FFFD, U+10000, U+10FFFF",
    recipe: json({
      resourceType: "Observation",
      status: "final",
      valueString: "\t\n\r ퟿�𐀀􏿿",
    }),
  },
  {
    label: "Chars in an id, an element id and an Extension.url",
    recipe: json({
      resourceType: "Patient",
      id: "\u0085﷐",
      gender: "other",
      _gender: { id: "😀" },
      contact: [{ id: "\u009f", gender: "other" }],
      extension: [{ url: "http://example.org/é﷯", valueString: "\u007f" }],
    }),
  },
  {
    label: "a div carrying U+1F600, U+0085 and U+FDD0 raw",
    recipe: json(narrative(`<div xmlns="${XHTML}">😀\u0085﷐</div>`)),
  },
  {
    label: "a Name at every tag position of a contained resource and a Bundle entry",
    recipe: bundle(
      json({
        resourceType: "Patient",
        é: "v",
        contained: [{ resourceType: "Observation", status: "final", 中: "v" }],
      }),
    ),
  },
];

/**
 * AC-6: models the base refused, each carrying a new-code trigger elsewhere or at the same location,
 * and one per same-name case the criterion lists. The base's code and locations are the grade.
 */
export const PIN_REFUSED_MODELS: readonly NamedModel[] = [
  {
    label: "dropped element text beside a name that is not a Name",
    recipe: {
      xml: `<Observation xmlns="${FHIR_NS}"><status>final</status><1abc value="1"/></Observation>`,
    },
  },
  {
    label: "dropped element text beside a non-Char value",
    recipe: {
      xml: `<Observation xmlns="${FHIR_NS}"><status>final</status><valueString value="a&#0;b"/></Observation>`,
    },
  },
  {
    label: "dropped element text that itself carried a non-Char",
    recipe: {
      xml: `<Observation xmlns="${FHIR_NS}"><status>fin&#0;al</status><1abc value="1"/></Observation>`,
    },
  },
  {
    label: "a tag-breaking name beside a name that is not a Name",
    recipe: json({ resourceType: "Patient", "a b": "1", contact: [{ "1abc": "2" }] }),
  },
  {
    label: "a tag-breaking name beside a non-Char value",
    recipe: json({ resourceType: "Patient", "a b": "1", gender: "a\u0000" }),
  },
  { label: "a name with a space, which breaks the tag and is not a Name", recipe: named("a b") },
  {
    label: "a name with a less-than sign, which breaks the tag and is not a Name",
    recipe: named("a<b"),
  },
  {
    label: "a name that breaks the tag and carries U+0000, whose value carries U+0001",
    recipe: json({ resourceType: "Patient", "a b\u0000": "v\u0001" }),
  },
  {
    label: "a div failing the one-element check beside a name that is not a Name",
    recipe: json({ ...narrative("<p>a</p>"), "1abc": "v" }),
  },
  {
    label: "a div failing the one-element check beside a non-Char value",
    recipe: json({ ...narrative("<p>a</p>"), gender: "a\u0000" }),
  },
  {
    label: "a div failing the one-element check that carries a non-Char itself",
    recipe: json(narrative("<p>a\u0000&#0;</p>")),
  },
  {
    label: "a JSON-only shape beside a name that is not a Name",
    recipe: json({ resourceType: "Patient", contact: [[{ gender: "other" }]], "1abc": "v" }),
  },
  {
    label: "a JSON-only shape whose item carries a non-Char",
    recipe: json({ resourceType: "Patient", contact: [[{ gender: "a\u0000" }]] }),
  },
  {
    label: "an array wrapper beside a name that is not a Name",
    recipe: json({ resourceType: "Observation", status: ["final"], "1abc": "v" }),
  },
  {
    label: "an array wrapper whose one item carries a non-Char",
    recipe: json({ resourceType: "Observation", status: ["fi\u0000nal"] }),
  },
  {
    label: "a value[x] wrapper beside a name that is not a Name",
    recipe: json({ resourceType: "Observation", status: "final", valueString: ["a"], "1abc": "v" }),
  },
  {
    label: "a value[x] wrapper whose one item carries a non-Char",
    recipe: json({ resourceType: "Observation", status: "final", valueString: ["a\u0000"] }),
  },
  {
    label: "a shadowed member beside a name that is not a Name",
    recipe: {
      json: '{"resourceType":"Observation","status":"final","status":"entered-in-error","1abc":"v"}',
    },
  },
  {
    label: "a shadowed member whose shadowing value carries a non-Char",
    recipe: { json: '{"resourceType":"Observation","status":"fi\\u0000nal","status":"a\\u0001"}' },
  },
  {
    label: "an untaggable resourceType beside a name that is not a Name in the same element",
    recipe: json({ resourceType: "Patient", contained: [{ resourceType: 42, "1abc": "v" }] }),
  },
  {
    label: "an untaggable resourceType beside a non-Char value",
    recipe: json({ resourceType: "Patient", gender: "a\u0000", contained: [{ resourceType: 42 }] }),
  },
  {
    label: "a foreign root holding a name that is not a Name",
    recipe: {
      xml: `<Observation xmlns="urn:vendor"><status value="final"/><1abc value="1"/></Observation>`,
    },
  },
  {
    label: "a foreign root holding a non-Char value",
    recipe: {
      xml: `<Observation xmlns="urn:vendor"><status value="final"/><valueString value="a&#0;b"/></Observation>`,
    },
  },
  {
    label: "a colon-bearing name beside a name that is not a Name",
    recipe: json({ resourceType: "Patient", "p:x": "v", contact: [{ "1abc": "v" }] }),
  },
  {
    label: "a colon-bearing name whose value carries a non-Char",
    recipe: json({ resourceType: "Patient", "p:x": "a\u0000" }),
  },
  { label: "a name carrying a colon that is not a Name, 1a:b", recipe: named("1a:b") },
  {
    label: "a div whose prefix nothing binds, beside a name that is not a Name",
    recipe: json({ ...narrative("<v:div>x</v:div>"), "1abc": "v" }),
  },
  {
    label: "a div whose prefix nothing binds, beside a non-Char value",
    recipe: json({ ...narrative("<v:div>x</v:div>"), gender: "a\u0000" }),
  },
  {
    label: "a div whose prefix nothing binds and which carries a non-Char itself",
    recipe: json(narrative("<v:div>a\u0000&#0;</v:div>")),
  },
];

/** AC-6: models carrying both new triggers and no base one; head raises the name code for each. */
export const BOTH_NEW_MODELS: readonly NamedModel[] = [
  {
    label: "a name that is not a Name at one location and a non-Char value at another",
    recipe: json({ resourceType: "Patient", gender: "a\u0000", "1abc": "v" }),
    locations: [`Patient.${W}`],
  },
  {
    label: "a name that is not a Name whose own value carries a non-Char",
    recipe: json({ resourceType: "Patient", "1abc": "a\u0000" }),
    locations: [`Patient.${W}`],
  },
  {
    label: "a non-Char div beside a name that is not a Name",
    recipe: json({ ...narrative(`<div xmlns="${XHTML}">&#0;</div>`), contact: [{ "a&b": "v" }] }),
    locations: [`Patient.contact[0].${W}`],
  },
];

/**
 * AC-4: sentinels. Each refused name, value or `div` carries `zzsentinel`, which occurs nowhere
 * else in the model, so finding it in a message or a location is an echo.
 */
export const SENTINEL = "zzsentinel";

/** AC-4: one model per new refusal, with the refused content a message and a location must not echo. */
export const SENTINEL_MODELS: readonly (NamedModel & { readonly content: readonly string[] })[] = [
  {
    label: "a refused name",
    recipe: named(`${SENTINEL}&name`),
    locations: [`Patient.${W}`],
    content: [`${SENTINEL}&name`, "&"],
  },
  {
    label: "a refused name carrying U+0000",
    recipe: named(`${SENTINEL}\u0000name`),
    locations: [`Patient.${W}`],
    content: [`${SENTINEL}\u0000name`, "\u0000"],
  },
  {
    label: "a refused nested resourceType",
    recipe: json({ resourceType: "Patient", contained: [{ resourceType: `${SENTINEL}\ud800` }] }),
    locations: ["Patient.contained[0]"],
    content: [`${SENTINEL}\ud800`, "\ud800"],
  },
  {
    label: "a refused value",
    recipe: json({
      resourceType: "Observation",
      status: "final",
      valueString: `${SENTINEL}\u0001value`,
    }),
    locations: ["Observation.valueString"],
    content: [`${SENTINEL}\u0001value`, "\u0001"],
  },
  {
    label: "a refused Extension.url",
    recipe: json({
      resourceType: "Patient",
      extension: [{ url: `urn:${SENTINEL}￿`, valueString: "x" }],
    }),
    locations: ["Patient.extension[0].url"],
    content: [`urn:${SENTINEL}￿`, "￿"],
  },
  {
    label: "a refused div",
    recipe: json(narrative(`<div xmlns="${XHTML}">${SENTINEL}&#0;</div>`)),
    locations: ["Patient.text.div"],
    content: [`${SENTINEL}&#0;`, "&#0;", "\u0000"],
  },
];
