/**
 * `FhirInteger64` — the string-backed representation of a FHIR `integer64` primitive (added in R5).
 *
 * Its range is the full signed 64-bit integer, `-9223372036854775808 … 9223372036854775807`, which
 * exceeds JavaScript's `Number.MAX_SAFE_INTEGER` (`2^53 − 1`). Precisely because of that, FHIR
 * encodes `integer64` in JSON as a **string**, not a number — and parsing that string through
 * `Number` would silently drop the low-order digits of a large identifier. Like `FhirDecimal`
 * (architecture ADR 0001), `FhirInteger64` is string-backed and exposes a lazy `bigint` view for
 * arithmetic; it never routes the value through `number`.
 *
 * In this phase the JSON reader preserves an `integer64` losslessly as an ordinary string primitive
 * (a string cannot lose precision), because typing a field *as* `integer64` requires the schema
 * layer that lands in a later phase. `FhirInteger64` is the typed primitive that field will resolve
 * to, and is available now for callers constructing a model by hand.
 *
 * @packageDocumentation
 */

/** Signed decimal-integer grammar (an optional `-` then digits, no leading zeros beyond `0`). */
const SIGNED_INTEGER = /^-?(?:0|[1-9][0-9]*)$/;

/** Inclusive bounds of a signed 64-bit integer, per the FHIR `integer64` definition. */
const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;

/**
 * A FHIR `integer64`, backed by its exact lexical source string.
 *
 * Construct via the {@link integer64} factory (which validates range and grammar). Immutable; the
 * `bigint` view is computed lazily on first access and cached.
 *
 * @example
 * ```ts
 * import { integer64 } from "@cosyte/fhir";
 * const big = integer64("9223372036854775807");
 * big.toString();  // "9223372036854775807"
 * big.toBigInt();  // 9223372036854775807n — exact, no 2^53 truncation
 * ```
 */
export class FhirInteger64 {
  /** The exact lexical text as it appeared on the wire (FHIR JSON encodes this as a string). */
  public readonly raw: string;

  #value: bigint | undefined;

  /**
   * @param raw - A validated signed-integer literal within the 64-bit range. Prefer the
   *   {@link integer64} factory; validation lives there.
   * @internal
   */
  public constructor(raw: string) {
    this.raw = raw;
  }

  /** The exact lexical form — what the serializer emits (as a JSON string, per FHIR). */
  public toString(): string {
    return this.raw;
  }

  /**
   * The value as a `bigint` — exact across the whole 64-bit range. Computed once and cached.
   */
  public toBigInt(): bigint {
    this.#value ??= BigInt(this.raw);
    return this.#value;
  }

  /** Exact equality of two `integer64` values (by numeric value, so `"-0"`-style variants agree). */
  public equals(other: FhirInteger64): boolean {
    return this.toBigInt() === other.toBigInt();
  }
}

/**
 * Construct a {@link FhirInteger64} from its lexical text, validating both the signed-integer grammar
 * and the 64-bit range. Throws a `TypeError`/`RangeError` on anything else.
 *
 * @param raw - The exact integer literal, e.g. `"9223372036854775807"`, `"-42"`.
 * @throws TypeError when `raw` is not a signed-integer literal.
 * @throws RangeError when `raw` is outside the signed 64-bit range.
 * @example
 * ```ts
 * import { integer64 } from "@cosyte/fhir";
 * const n = integer64("-9223372036854775808"); // the 64-bit minimum, exact
 * ```
 */
export function integer64(raw: string): FhirInteger64 {
  if (!SIGNED_INTEGER.test(raw)) {
    throw new TypeError(`Not a valid integer64 literal: ${JSON.stringify(raw)}`);
  }
  const value = BigInt(raw);
  if (value < INT64_MIN || value > INT64_MAX) {
    throw new RangeError(`integer64 out of signed 64-bit range: ${raw}`);
  }
  return new FhirInteger64(raw);
}
