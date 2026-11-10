import type { RawJson, RawMember } from "@cosyte/fhir";
import fc from "fast-check";
import type { Arbitrary } from "fast-check";

import { NULL, arr, bool, member, num, obj, str } from "./json.js";

/**
 * The values and datatypes a generated resource is built from, each as raw JSON. Every value is
 * random and synthetic: a name is random letters, an identifier a random token under
 * `example.org`, a date a random day.
 *
 * @internal
 * @packageDocumentation
 */

/** The members one element contributes to its parent: none, one, or a value and its `_` sibling. */
export type Members = readonly RawMember[];

/** What every generator below shares: whether to add extensions, and how long a list may be. */
export interface Shape {
  /** Add extensions to elements and to primitives (in the `_` sibling). */
  readonly extensions: boolean;
  /** The most items in a repeating element. */
  readonly maxRepeats: number;
}

/** The base of every generated URL: a domain reserved for examples. */
export const EXAMPLE_BASE = "http://example.org/fhir";

/**
 * The characters a generated string is drawn from: letters, digits, spaces, the characters JSON
 * and XML have to escape, tab and line feed, and characters outside ASCII, a pair of UTF-16 units
 * among them. Random by design: nothing here looks like a name, a date or an identifier.
 *
 * @internal
 */
const STRING_UNITS: readonly string[] = [
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
  ..."    ",
  ...`"'<>&\\/:;.,-_#%*+=?!@[](){}|^~$`,
  "\t",
  "\n",
  "é",
  "ß",
  "Ω",
  "漢",
  "😀",
];

/** The characters a narrative's text is drawn from: no control characters, so XML keeps them. */
const TEXT_UNITS: readonly string[] = STRING_UNITS.filter((u) => u !== "\t" && u !== "\n");

/** Options for {@link stringValue}. */
export interface StringValueOptions {
  /** The shortest value, at least 1. Defaults to 1. */
  readonly minLength?: number;
  /** The longest value, in characters. Defaults to 16. */
  readonly maxLength?: number;
}

/**
 * Generate the text of a FHIR `string`: never empty, never only whitespace, and mixing in the
 * characters JSON and XML have to escape, tab, line feed and characters outside ASCII.
 *
 * @param options Its length bounds.
 * @returns An arbitrary of the text.
 * @example
 * ```ts
 * import fc from "fast-check";
 * import { stringValue } from "@cosyte/fhir/arbitraries";
 *
 * const [text] = fc.sample(stringValue({ maxLength: 4 }), 1);
 * // text is one to four characters, such as "a<&" or "Ω"
 * ```
 */
export function stringValue(options: StringValueOptions = {}): Arbitrary<string> {
  return unitsString(STRING_UNITS, options);
}

/**
 * A string over some units, never only whitespace.
 *
 * @internal
 */
function unitsString(units: readonly string[], options: StringValueOptions): Arbitrary<string> {
  const minLength = Math.max(1, options.minLength ?? 1);
  const maxLength = Math.max(minLength, options.maxLength ?? 16);
  return fc
    .array(fc.constantFrom(...units), { minLength, maxLength })
    .map((parts) => parts.join(""))
    .filter((text) => text.trim() !== "");
}

/**
 * A token of `[A-Za-z0-9]`, for codes, ids and identifier values.
 *
 * @internal
 */
export function token(maxLength = 10): Arbitrary<string> {
  return fc.string({
    unit: fc.constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"),
    minLength: 1,
    maxLength,
  });
}

/**
 * Random letters, capitalized: a family or given name nobody has.
 *
 * @internal
 */
export function word(): Arbitrary<string> {
  return fc
    .tuple(
      fc.constantFrom(..."BCDFGHJKLMNPQRSTVWXZ"),
      fc.string({ unit: fc.constantFrom(..."aeiouxyzqvkj"), minLength: 2, maxLength: 7 }),
    )
    .map(([head, tail]) => head + tail);
}

/**
 * A whole number written with `width` digits, zero-padded.
 *
 * @internal
 */
function digits(min: number, max: number, width: number): Arbitrary<string> {
  return fc.integer({ min, max }).map((n) => String(n).padStart(width, "0"));
}

/**
 * A FHIR `date`: a year, a year and month, or a whole date, from 1900 to 2039.
 *
 * @internal
 */
export function date(): Arbitrary<string> {
  return fc
    .tuple(digits(1900, 2039, 4), digits(1, 12, 2), digits(1, 28, 2), fc.nat(2))
    .map(([y, m, d, precision]) => [y, m, d].slice(0, precision + 1).join("-"));
}

/**
 * A time zone: `Z`, or an offset from -12:00 to +14:00.
 *
 * @internal
 */
function zone(): Arbitrary<string> {
  return fc.oneof(
    fc.constant("Z"),
    fc
      .tuple(fc.constantFrom("+", "-"), digits(0, 12, 2), fc.constantFrom("00", "30", "45"))
      .map(([sign, h, m]) => `${sign}${h}:${m}`),
  );
}

/**
 * Hours, minutes and seconds, with up to three fraction digits.
 *
 * @internal
 */
function clock(): Arbitrary<string> {
  return fc
    .tuple(
      digits(0, 23, 2),
      digits(0, 59, 2),
      digits(0, 59, 2),
      fc.constantFrom("", ".0", ".5", ".123"),
    )
    .map(([h, m, s, frac]) => `${h}:${m}:${s}${frac}`);
}

/**
 * A FHIR `dateTime`: a date of any precision, or a whole date with a time and zone.
 *
 * @internal
 */
export function dateTime(): Arbitrary<string> {
  return fc.oneof(date(), instant());
}

/**
 * A FHIR `instant`: a whole date, a time and a zone.
 *
 * @internal
 */
export function instant(): Arbitrary<string> {
  return fc
    .tuple(digits(1900, 2039, 4), digits(1, 12, 2), digits(1, 28, 2), clock(), zone())
    .map(([y, m, d, t, z]) => `${y}-${m}-${d}T${t}${z}`);
}

/**
 * A FHIR `time`.
 *
 * @internal
 */
export function time(): Arbitrary<string> {
  return clock();
}

/** Options for {@link decimalText}. */
export interface DecimalTextOptions {
  /** Allow a negative value. Defaults to `true`. */
  readonly negative?: boolean;
  /** Allow an exponent, such as `1.5e3`. Defaults to `true`. */
  readonly exponent?: boolean;
}

/**
 * Generate the text of a FHIR `decimal` as JSON writes it, biased toward the spellings a reader
 * that turns numbers into doubles gets wrong: trailing zeros (`1.50`), more significant digits than
 * a double holds (`0.10000000000000000555`), and exponents (`1.0e-7`).
 *
 * @param options Whether to allow a sign and an exponent.
 * @returns An arbitrary of the decimal's text.
 * @example
 * ```ts
 * import fc from "fast-check";
 * import { decimal } from "@cosyte/fhir";
 * import { decimalText } from "@cosyte/fhir/arbitraries";
 *
 * fc.assert(fc.property(decimalText(), (text) => decimal(text).raw === text));
 * ```
 */
export function decimalText(options: DecimalTextOptions = {}): Arbitrary<string> {
  const negative = options.negative ?? true;
  const exponent = options.exponent ?? true;
  const integerPart = fc.oneof(
    fc.constant("0"),
    fc.integer({ min: 1, max: 99999 }).map(String),
    fc.bigInt({ min: 10n ** 15n, max: 10n ** 22n }).map(String),
  );
  const fraction = fc.oneof(
    fc.string({ unit: fc.constantFrom(..."0123456789"), minLength: 1, maxLength: 4 }),
    fc
      .string({ unit: fc.constantFrom(..."0123456789"), minLength: 1, maxLength: 3 })
      .map((f) => `${f}00`),
    fc.string({ unit: fc.constantFrom(..."0123456789"), minLength: 16, maxLength: 24 }),
  );
  return fc
    .record({
      sign: negative ? fc.boolean() : fc.constant(false),
      int: integerPart,
      frac: fc.option(fraction, { nil: undefined }),
      exp: exponent
        ? fc.option(
            fc.tuple(
              fc.constantFrom("e", "E"),
              fc.constantFrom("", "+", "-"),
              fc.integer({ min: 0, max: 20 }),
            ),
            { nil: undefined, freq: 4 },
          )
        : fc.constant(undefined),
    })
    .map(({ sign, int, frac, exp }) => {
      const body = frac === undefined ? int : `${int}.${frac}`;
      const tail = exp === undefined ? "" : `${exp[0]}${exp[1]}${String(exp[2])}`;
      return `${sign && body !== "0" ? "-" : ""}${body}${tail}`;
    });
}

/**
 * A FHIR `integer`, as JSON writes it.
 *
 * @internal
 */
export function integerText(min = -1000, max = 100000): Arbitrary<string> {
  return fc.integer({ min, max }).map(String);
}

/**
 * A URL under {@link EXAMPLE_BASE}.
 *
 * @internal
 */
export function exampleUrl(kind: string): Arbitrary<string> {
  return token(8).map((t) => `${EXAMPLE_BASE}/${kind}/${t}`);
}

/**
 * An element written, or left out (about one time in `freq`).
 *
 * @internal
 */
export function optional(arb: Arbitrary<Members>, freq = 2): Arbitrary<Members> {
  return fc.option(arb, { nil: undefined, freq }).map((m) => m ?? []);
}

/**
 * The members of several elements, in order.
 *
 * @internal
 */
export function concat(...parts: readonly Arbitrary<Members>[]): Arbitrary<Members> {
  return fc.tuple(...parts).map((all) => all.flat());
}

/**
 * A complex element: one member holding an object.
 *
 * @internal
 */
export function element(name: string, value: Arbitrary<RawJson>): Arbitrary<Members> {
  return value.map((v) => [member(name, v)]);
}

/**
 * A repeating complex element: one member holding a non-empty array.
 *
 * @internal
 */
export function repeated(name: string, item: Arbitrary<RawJson>, shape: Shape): Arbitrary<Members> {
  return fc
    .array(item, { minLength: 1, maxLength: Math.max(1, shape.maxRepeats) })
    .map((items) => [member(name, arr(items))]);
}

/**
 * An object from members, never empty: `fallback` stands in when nothing else was drawn.
 *
 * @internal
 */
export function objectOf(
  parts: Arbitrary<Members>,
  fallback: Arbitrary<Members>,
): Arbitrary<RawJson> {
  return fc
    .tuple(parts, fallback)
    .map(([members, extra]) => obj(members.length > 0 ? members : extra));
}

/**
 * An extension's `value[x]`: one of the common types, as its member.
 *
 * @internal
 */
function extensionValue(): Arbitrary<RawMember> {
  return fc.oneof(
    stringValue().map((v) => member("valueString", str(v))),
    fc.boolean().map((v) => member("valueBoolean", bool(v))),
    integerText().map((v) => member("valueInteger", num(v))),
    decimalText().map((v) => member("valueDecimal", num(v))),
    token(8).map((v) => member("valueCode", str(v))),
    dateTime().map((v) => member("valueDateTime", str(v))),
  );
}

/**
 * An extension: a URL under `example.org` and either a value or nested extensions (`ext-1`), never
 * both.
 *
 * @internal
 */
export function extension(depth = 1): Arbitrary<RawJson> {
  const simple = fc
    .tuple(exampleUrl("StructureDefinition"), extensionValue())
    .map(([url, value]) => obj([member("url", str(url)), value]));
  if (depth <= 0) return simple;
  const nested = fc
    .tuple(
      exampleUrl("StructureDefinition"),
      fc.array(extension(depth - 1), { minLength: 1, maxLength: 2 }),
    )
    .map(([url, inner]) => obj([member("url", str(url)), member("extension", arr(inner))]));
  return fc.oneof({ weight: 3, arbitrary: simple }, { weight: 1, arbitrary: nested });
}

/**
 * The `extension` member of an element, when the shape asks for extensions.
 *
 * @internal
 */
export function extensions(shape: Shape, freq = 5): Arbitrary<Members> {
  if (!shape.extensions) return fc.constant([]);
  return optional(
    fc
      .array(extension(), { minLength: 1, maxLength: 2 })
      .map((items) => [member("extension", arr(items))]),
    freq,
  );
}

/**
 * A primitive's metadata (the `_` sibling): an `id`, extensions, or both.
 *
 * @internal
 */
function primitiveMeta(): Arbitrary<RawJson> {
  return fc
    .record(
      {
        id: token(8),
        extension: fc.array(extension(0), { minLength: 1, maxLength: 2 }),
      },
      { requiredKeys: [] },
    )
    .filter((m) => m.id !== undefined || m.extension !== undefined)
    .map((m) =>
      obj([
        ...(m.id === undefined ? [] : [member("id", str(m.id))]),
        ...(m.extension === undefined ? [] : [member("extension", arr(m.extension))]),
      ]),
    );
}

/**
 * Whether a primitive's metadata carries an extension: what `ele-1` needs of a primitive with no
 * value, since an `id` alone is not a child.
 *
 * @internal
 */
export function carriesExtension(meta: RawJson): boolean {
  return meta.t === "obj" && meta.members.some((m) => m.key === "extension");
}

/**
 * Options for a primitive element.
 *
 * @internal
 */
export interface PrimitiveOptions {
  /**
   * Whether the element may carry metadata and no value, which is spec-clean only where the
   * element is optional and no safety read depends on its value.
   */
  readonly absent?: boolean;
}

/**
 * A primitive element: its value, and with extensions on, sometimes a `_` sibling carrying an `id`
 * or extensions. With `absent`, sometimes the sibling alone.
 *
 * @internal
 */
export function primitiveElement(
  name: string,
  value: Arbitrary<RawJson>,
  shape: Shape,
  options: PrimitiveOptions = {},
): Arbitrary<Members> {
  if (!shape.extensions) return value.map((v) => [member(name, v)]);
  return fc
    .tuple(value, fc.option(primitiveMeta(), { nil: undefined, freq: 6 }), fc.nat(4))
    .map(([v, meta, roll]): Members => {
      if (meta === undefined) return [member(name, v)];
      if (options.absent === true && roll === 0 && carriesExtension(meta))
        return [member(`_${name}`, meta)];
      return [member(name, v), member(`_${name}`, meta)];
    });
}

/**
 * A repeating primitive element: the value array and, with extensions on, sometimes a `_` array
 * index-aligned with it, `null` where an item has no metadata and where an item has no value.
 *
 * @internal
 */
export function primitiveList(
  name: string,
  value: Arbitrary<RawJson>,
  shape: Shape,
): Arbitrary<Members> {
  const item = shape.extensions
    ? fc.tuple(
        fc.option(value, { nil: undefined, freq: 8 }),
        fc.option(primitiveMeta(), { nil: undefined, freq: 4 }),
      )
    : value.map((v): [RawJson | undefined, RawJson | undefined] => [v, undefined]);
  return fc
    .array(item, { minLength: 1, maxLength: Math.max(1, shape.maxRepeats) })
    .map((items): Members => {
      // An item needs a value or an extension to exist at all (`ele-1`), and the list a value.
      const kept = items.filter(
        ([v, m]) => v !== undefined || (m !== undefined && carriesExtension(m)),
      );
      const values = kept.map(([v]) => v ?? NULL);
      const metas = kept.map(([, m]) => m ?? NULL);
      if (!values.some((v) => v !== NULL)) return [];
      const out: RawMember[] = [member(name, arr(values))];
      if (metas.some((m) => m !== NULL)) out.push(member(`_${name}`, arr(metas)));
      return out;
    });
}

/**
 * A `Coding` in one system, from a list of codes or random tokens.
 *
 * @internal
 */
export function coding(
  system: Arbitrary<string>,
  code: Arbitrary<string>,
  shape: Shape,
): Arbitrary<RawJson> {
  return concat(
    element("system", system.map(str)),
    primitiveElement("code", code.map(str), shape),
    optional(primitiveElement("display", stringValue().map(str), shape, { absent: true })),
  ).map(obj);
}

/**
 * The code systems a generated concept uses: random codes under `example.org`.
 *
 * @internal
 */
export function exampleCoding(kind: string, shape: Shape): Arbitrary<RawJson> {
  return coding(fc.constant(`${EXAMPLE_BASE}/CodeSystem/${kind}`), token(8), shape);
}

/**
 * A `CodeableConcept` of one or more codings, and sometimes a text.
 *
 * @internal
 */
export function codeableConcept(codingArb: Arbitrary<RawJson>, shape: Shape): Arbitrary<RawJson> {
  return concat(
    fc
      .array(codingArb, { minLength: 1, maxLength: Math.min(2, Math.max(1, shape.maxRepeats)) })
      .map((items) => [member("coding", arr(items))]),
    optional(primitiveElement("text", stringValue().map(str), shape, { absent: true }), 3),
  ).map(obj);
}

/**
 * A concept from one fixed system and a fixed list of codes.
 *
 * @internal
 */
export function fixedConcept(
  system: string,
  codes: readonly string[],
  shape: Shape,
): Arbitrary<RawJson> {
  return codeableConcept(coding(fc.constant(system), fc.constantFrom(...codes), shape), shape);
}

/**
 * A random concept under `example.org`.
 *
 * @internal
 */
export function exampleConcept(kind: string, shape: Shape): Arbitrary<RawJson> {
  return codeableConcept(exampleCoding(kind, shape), shape);
}

/**
 * An `Identifier`: a system under `example.org` and a random token.
 *
 * @internal
 */
export function identifier(shape: Shape): Arbitrary<RawJson> {
  return concat(
    optional(
      primitiveElement("use", fc.constantFrom("usual", "official", "secondary").map(str), shape),
      3,
    ),
    element("system", exampleUrl("identifier").map(str)),
    primitiveElement("value", token(12).map(str), shape),
  ).map(obj);
}

/**
 * A `Reference` to a resource of one of `types`, by a relative URL.
 *
 * @internal
 */
export function reference(types: readonly string[], shape: Shape): Arbitrary<RawJson> {
  return concat(
    fc
      .tuple(fc.constantFrom(...types), token(12))
      .map(([type, id]) => [member("reference", str(`${type}/${id}`))]),
    optional(primitiveElement("display", stringValue().map(str), shape), 4),
  ).map(obj);
}

/**
 * A `HumanName` of random letters.
 *
 * @internal
 */
export function humanName(shape: Shape): Arbitrary<RawJson> {
  return objectOf(
    concat(
      optional(element("use", fc.constantFrom("usual", "official", "nickname", "old").map(str))),
      optional(primitiveElement("family", word().map(str), shape)),
      optional(primitiveList("given", word().map(str), shape)),
    ),
    primitiveElement("family", word().map(str), shape),
  );
}

/**
 * A `ContactPoint` at `example.org`.
 *
 * @internal
 */
export function contactPoint(shape: Shape): Arbitrary<RawJson> {
  return fc
    .tuple(
      fc.constantFrom("email", "url"),
      token(8),
      optional(element("use", fc.constantFrom("home", "work").map(str))),
    )
    .chain(([system, user, use]) =>
      concat(
        element("system", fc.constant(str(system))),
        primitiveElement(
          "value",
          fc.constant(str(system === "email" ? `${user}@example.org` : `${EXAMPLE_BASE}/${user}`)),
          shape,
        ),
        fc.constant(use),
      ),
    )
    .map(obj);
}

/**
 * An `Address` of random text.
 *
 * @internal
 */
export function address(shape: Shape): Arbitrary<RawJson> {
  return objectOf(
    concat(
      optional(primitiveList("line", stringValue({ maxLength: 12 }).map(str), shape)),
      optional(primitiveElement("city", word().map(str), shape)),
      optional(element("postalCode", token(6).map(str))),
      optional(element("country", fc.constantFrom("ZZ", "XX").map(str))),
    ),
    element("city", word().map(str)),
  );
}

/**
 * The UCUM units a generated quantity is in.
 *
 * @internal
 */
const UCUM_UNITS = [
  "mg",
  "mL",
  "kg",
  "cm",
  "mmol/L",
  "%",
  "g/dL",
  "1",
  "/min",
  "mm[Hg]",
  "10*3/uL",
] as const;

/**
 * A `Quantity` in a UCUM unit, its value a hazard-biased decimal.
 *
 * @internal
 */
export function quantity(
  shape: Shape,
  value: Arbitrary<string> = decimalText(),
): Arbitrary<RawJson> {
  return fc
    .tuple(fc.constantFrom(...UCUM_UNITS), primitiveElement("value", value.map(num), shape))
    .map(([unit, valueMembers]) =>
      obj([
        ...valueMembers,
        member("unit", str(unit)),
        member("system", str("http://unitsofmeasure.org")),
        member("code", str(unit)),
      ]),
    );
}

/**
 * A `Range`, its low no higher than its high, in one unit.
 *
 * @internal
 */
export function range(): Arbitrary<RawJson> {
  return rangeMembers().map(obj);
}

/**
 * The members of a {@link range}: its low and its high.
 *
 * @internal
 */
export function rangeMembers(): Arbitrary<Members> {
  return fc
    .tuple(
      fc.integer({ min: 0, max: 500 }),
      fc.integer({ min: 0, max: 500 }),
      fc.constantFrom(...UCUM_UNITS),
    )
    .map(([a, b, unit]) => {
      const bound = (n: number): RawJson =>
        obj([
          member("value", num(String(n))),
          member("unit", str(unit)),
          member("system", str("http://unitsofmeasure.org")),
          member("code", str(unit)),
        ]);
      return [member("low", bound(Math.min(a, b))), member("high", bound(Math.max(a, b)))];
    });
}

/**
 * A `Ratio` of two quantities.
 *
 * @internal
 */
export function ratio(shape: Shape): Arbitrary<RawJson> {
  const positive = decimalText({ negative: false, exponent: false }).filter((t) =>
    /[1-9]/u.test(t),
  );
  return fc
    .tuple(quantity(shape, positive), quantity(shape, positive))
    .map(([n, d]) => obj([member("numerator", n), member("denominator", d)]));
}

/**
 * A `Period`: a start, an end no earlier than it, or both.
 *
 * @internal
 */
export function period(): Arbitrary<RawJson> {
  return fc
    .tuple(
      fc.integer({ min: 1900, max: 2030 }),
      fc.integer({ min: 0, max: 9 }),
      digits(1, 12, 2),
      fc.nat(2),
    )
    .map(([year, span, month, which]) => {
      const start = member("start", str(`${String(year)}-${month}`));
      const end = member("end", str(`${String(year + span + 1)}-${month}`));
      return obj(which === 0 ? [start] : which === 1 ? [end] : [start, end]);
    });
}

/**
 * An `Annotation`: its text, and sometimes a time.
 *
 * @internal
 */
export function annotation(shape: Shape): Arbitrary<RawJson> {
  return concat(
    optional(element("time", dateTime().map(str)), 3),
    primitiveElement("text", stringValue({ maxLength: 40 }).map(str), shape),
  ).map(obj);
}

/**
 * Escape text for the XHTML of a narrative.
 *
 * @internal
 */
export function escapeXhtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/**
 * A generated `Narrative`: one paragraph of random text in an XHTML `div`.
 *
 * @internal
 */
export function narrative(): Arbitrary<RawJson> {
  return fc
    .tuple(
      fc.constantFrom("generated", "extensions", "additional"),
      unitsString(TEXT_UNITS, { maxLength: 30 }),
    )
    .map(([status, text]) =>
      obj([
        member("status", str(status)),
        member(
          "div",
          str(`<div xmlns="http://www.w3.org/1999/xhtml"><p>${escapeXhtml(text)}</p></div>`),
        ),
      ]),
    );
}

/**
 * A resource's `meta`: a version id, a last-updated instant, or both, and sometimes a tag.
 *
 * @internal
 */
export function meta(shape: Shape): Arbitrary<RawJson> {
  return objectOf(
    concat(
      optional(element("versionId", token(4).map(str))),
      optional(element("lastUpdated", instant().map(str))),
      optional(repeated("tag", exampleCoding("tag", { ...shape, extensions: false }), shape), 3),
    ),
    element("versionId", token(4).map(str)),
  );
}
