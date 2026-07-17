/**
 * FHIR R4 primitive datatype value-domain validation (validation layer 3, the datatype half).
 *
 * Each FHIR R4 primitive type carries a lexical constraint — a regular expression published in the
 * spec (datatypes.html §Primitive Types). This module holds those patterns verbatim (anchored) and
 * validates a model value against a declared datatype. It is deliberately **resource-independent**:
 * given a value and its datatype name, it can say whether the value is well-formed, without any
 * StructureDefinition. Which element *is* which datatype is the schema's job ({@link ./schema.js});
 * Phase 6 supplies that from real StructureDefinitions.
 *
 * The model already stores primitives losslessly: strings as JS strings, `boolean` as a JS boolean,
 * and every JSON number (`integer`, `unsignedInt`, `positiveInt`, `decimal`, `integer64`) as a
 * {@link ../model/decimal.js} carrying its exact lexical text. So validation reads the lexical form
 * from the model (a string, or `FhirDecimal.raw`) and tests the datatype's pattern — never a float.
 *
 * @packageDocumentation
 */

import { FhirDecimal, type PrimitiveValue } from "../model/index.js";

/**
 * The FHIR R4 primitive datatype names. `code`, `id`, `markdown`, `url`, `canonical`, `oid`, `uuid`
 * are string-derived types with their own patterns; the JSON-number family (`integer` …) is stored
 * as {@link ../model/decimal.js}. Frozen so the union is exact.
 */
export const PRIMITIVE_TYPES = [
  "boolean",
  "integer",
  "integer64",
  "unsignedInt",
  "positiveInt",
  "decimal",
  "string",
  "code",
  "markdown",
  "id",
  "uri",
  "url",
  "canonical",
  "oid",
  "uuid",
  "base64Binary",
  "instant",
  "date",
  "dateTime",
  "time",
] as const;

/** A FHIR R4 primitive datatype name. */
export type PrimitiveType = (typeof PRIMITIVE_TYPES)[number];

/**
 * Whether `name` is a known FHIR R4 primitive datatype.
 *
 * @param name - A datatype name.
 * @returns `true` for a primitive type name, `false` for a complex one.
 * @example
 * ```ts
 * import { isPrimitiveType } from "@cosyte/fhir";
 * isPrimitiveType("date");      // true
 * isPrimitiveType("HumanName"); // false
 * ```
 */
export function isPrimitiveType(name: string): name is PrimitiveType {
  return (PRIMITIVE_TYPES as readonly string[]).includes(name);
}

/**
 * The R4 lexical patterns, verbatim from the spec (datatypes.html), anchored with `^…$`. Types whose
 * value-domain is enforced by the model rather than a regex — `boolean` (a JS boolean),
 * `string`/`markdown` (any non-control text) — are handled in {@link validatePrimitiveValue} rather
 * than here. `integer64` shares the `integer` pattern (a 64-bit-range signed integer; the model
 * preserves the exact magnitude, so only the lexical shape is checked here).
 *
 * @internal
 */
const PATTERNS: Partial<Record<PrimitiveType, RegExp>> = {
  integer: /^([0]|[-+]?[1-9][0-9]*)$/u,
  integer64: /^([0]|[-+]?[1-9][0-9]*)$/u,
  unsignedInt: /^([0]|[1-9][0-9]*)$/u,
  positiveInt: /^[1-9][0-9]*$/u,
  decimal: /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/u,
  code: /^[^\s]+(\s[^\s]+)*$/u,
  id: /^[A-Za-z0-9\-.]{1,64}$/u,
  uri: /^\S*$/u,
  url: /^\S*$/u,
  canonical: /^\S*$/u,
  oid: /^urn:oid:[0-2](\.(0|[1-9][0-9]*))+$/u,
  uuid: /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u,
  base64Binary: /^(\s*([0-9a-zA-Z+/=]){4}\s*)+$/u,
  instant:
    /^([0-9]([0-9]([0-9][1-9]|[1-9]0)|[1-9]00)|[1-9]000)-(0[1-9]|1[0-2])-(0[1-9]|[1-2][0-9]|3[0-1])T([01][0-9]|2[0-3]):[0-5][0-9]:([0-5][0-9]|60)(\.[0-9]+)?(Z|[+-]((0[0-9]|1[0-3]):[0-5][0-9]|14:00))$/u,
  date: /^([0-9]([0-9]([0-9][1-9]|[1-9]0)|[1-9]00)|[1-9]000)(-(0[1-9]|1[0-2])(-(0[1-9]|[1-2][0-9]|3[0-1]))?)?$/u,
  dateTime:
    /^([0-9]([0-9]([0-9][1-9]|[1-9]0)|[1-9]00)|[1-9]000)(-(0[1-9]|1[0-2])(-(0[1-9]|[1-2][0-9]|3[0-1])(T([01][0-9]|2[0-3]):[0-5][0-9]:([0-5][0-9]|60)(\.[0-9]+)?(Z|[+-]((0[0-9]|1[0-3]):[0-5][0-9]|14:00)))?)?)?$/u,
  time: /^([01][0-9]|2[0-3]):[0-5][0-9]:([0-5][0-9]|60)(\.[0-9]+)?$/u,
};

/** The FHIR `string`/`markdown` constraint: 1..1048576 chars, only tab/CR/LF among controls. */
const STRING_PATTERN = /^[ \r\n\t\S]+$/u;
const STRING_MAX_LENGTH = 1_048_576;

/**
 * The lexical form of a model primitive value: the exact source text for a number (never a float),
 * the string itself for a string, or `"true"`/`"false"` for a boolean.
 *
 * @internal
 */
function lexicalForm(value: PrimitiveValue): string {
  if (value instanceof FhirDecimal) return value.raw;
  if (typeof value === "boolean") return value ? "true" : "false";
  return value;
}

/**
 * Whether a model primitive value is well-formed for a declared FHIR R4 primitive datatype.
 *
 * Returns `"ok"` when the value matches the datatype's value-domain, `"type-mismatch"` when the
 * value's *shape* is wrong for the datatype (e.g. a JS string where a `boolean` is required, or a
 * `boolean` where a numeric type is required), and `"invalid"` when the shape is right but the
 * lexical form fails the datatype's pattern. The caller maps these to `TYPE_MISMATCH` /
 * `PRIMITIVE_INVALID` issues.
 *
 * An unknown (non-primitive) datatype name yields `"ok"` — a complex datatype is validated
 * structurally elsewhere, not here; this function speaks only for the primitives it knows.
 *
 * @param value - The model primitive value.
 * @param datatype - The declared FHIR datatype name.
 * @returns `"ok"` | `"type-mismatch"` | `"invalid"`.
 * @example
 * ```ts
 * import { validatePrimitiveValue } from "@cosyte/fhir";
 * validatePrimitiveValue("2013-06-08", "date");   // "ok"
 * validatePrimitiveValue("2013-13-40", "date");   // "invalid"
 * validatePrimitiveValue("male", "boolean");      // "type-mismatch"
 * ```
 */
export function validatePrimitiveValue(
  value: PrimitiveValue,
  datatype: string,
): "ok" | "type-mismatch" | "invalid" {
  if (!isPrimitiveType(datatype)) return "ok";

  const isNumberType =
    datatype === "integer" ||
    datatype === "integer64" ||
    datatype === "unsignedInt" ||
    datatype === "positiveInt" ||
    datatype === "decimal";

  // Shape checks: the model kind must match the datatype family.
  if (datatype === "boolean") {
    return typeof value === "boolean" ? "ok" : "type-mismatch";
  }
  if (isNumberType) {
    if (!(value instanceof FhirDecimal)) return "type-mismatch";
  } else {
    // Every remaining primitive is string-shaped on the wire.
    if (typeof value !== "string") return "type-mismatch";
  }

  if (datatype === "string" || datatype === "markdown") {
    const text = value as string;
    return text.length <= STRING_MAX_LENGTH && STRING_PATTERN.test(text) ? "ok" : "invalid";
  }

  const pattern = PATTERNS[datatype];
  if (pattern === undefined) return "ok";
  return pattern.test(lexicalForm(value)) ? "ok" : "invalid";
}
