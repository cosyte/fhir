/**
 * `FhirDecimal` — the string-backed representation of a FHIR `decimal` primitive.
 *
 * The single most important commitment of the codec (architecture ADR 0001): a FHIR `decimal`
 * value NEVER passes through the JavaScript `number` type — not on read, not on compare, not on
 * write. `JSON.parse('{"v":0.010}').v` is `0.01` in JavaScript: the trailing zero is destroyed
 * before any of our code runs, and `0.1 + 0.2 !== 0.3`. The FHIR spec makes trailing-zero precision
 * *significant* — it states plainly that `0.010` is a different value from `0.01` (the trailing zero
 * records the precision of a measurement) — so routing a dose or a lab value through a double is
 * silent data corruption that can change clinical meaning.
 *
 * `FhirDecimal` therefore stores the **exact lexical text as it appeared on the wire** and re-emits
 * it byte-for-byte. Arithmetic and comparison are provided over a small BigInt-backed decomposition
 * (coefficient + scale) so no float is ever involved.
 *
 * @packageDocumentation
 */

/**
 * The JSON number grammar (ECMA-404 / RFC 8259), which is a strict superset of the FHIR `decimal`
 * lexical space. A value read off the wire has already satisfied this (the raw-JSON reader enforces
 * it); the public {@link decimal} factory re-checks it so a hand-built value cannot smuggle in
 * non-numeric text.
 *
 * @internal
 */
const JSON_NUMBER = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;

/**
 * A decimal decomposed into an exact integer coefficient and a base-10 scale, such that the
 * mathematical value is `coefficient × 10^(-scale)`. Both fields are exact — `coefficient` is a
 * `bigint`, `scale` a plain integer — so equality and ordering never touch a float.
 *
 * @internal
 */
interface DecimalParts {
  readonly coefficient: bigint;
  readonly scale: number;
}

/**
 * Decompose a JSON-number literal into `{ coefficient, scale }`. Returns `null` when the text is not
 * a valid JSON number (the caller decides whether that is an error or a "cannot compare"). No
 * `Number`/`parseFloat` is used — the coefficient is built with `BigInt`, so arbitrary precision and
 * magnitude survive.
 *
 * @internal
 */
function decompose(raw: string): DecimalParts | null {
  if (!JSON_NUMBER.test(raw)) return null;

  let mantissa = raw;
  let exponent = 0;
  const eIndex = mantissa.search(/[eE]/);
  if (eIndex !== -1) {
    exponent = Number.parseInt(mantissa.slice(eIndex + 1), 10);
    mantissa = mantissa.slice(0, eIndex);
  }

  const dotIndex = mantissa.indexOf(".");
  let fractionLength = 0;
  if (dotIndex !== -1) {
    fractionLength = mantissa.length - dotIndex - 1;
    mantissa = mantissa.slice(0, dotIndex) + mantissa.slice(dotIndex + 1);
  }

  const coefficient = BigInt(mantissa);
  // value = coefficient × 10^(exponent − fractionLength) = coefficient × 10^(−scale)
  const scale = fractionLength - exponent;
  return { coefficient, scale };
}

/**
 * Put a decomposition into a canonical form — coefficient stripped of its trailing factors of ten
 * (with the scale adjusted to match), and zero collapsed to `(0, 0)` — so two decompositions denote
 * the same quantity **iff** their canonical `(coefficient, scale)` pairs are identical.
 *
 * This exists to make {@link valueEquals} exponentiation-free (see its note). The work is bounded by
 * the coefficient's digit count (one `% 10n` / `/ 10n` per trailing zero), never by the exponent's
 * magnitude, so an adversarial `0e9999999999999999999` cannot blow it up.
 *
 * @internal
 */
function canonical(parts: DecimalParts): DecimalParts {
  if (parts.coefficient === 0n) return { coefficient: 0n, scale: 0 };
  let coefficient = parts.coefficient;
  let scale = parts.scale;
  while (coefficient % 10n === 0n) {
    coefficient /= 10n;
    scale -= 1;
  }
  return { coefficient, scale };
}

/**
 * Compare two decompositions for exact quantity equality. `0.010` and `0.01` compare **equal** here
 * (same quantity); precision is compared separately by {@link FhirDecimal.equals}.
 *
 * **Never exponentiates.** The previous approach aligned scales with `10n ** (scaleDiff)`, which is a
 * DoS hazard: an adversarial literal such as `0e9999999999999999999` decomposes to a scale of
 * astronomical magnitude, and `10n ** thatMagnitude` throws `RangeError: Maximum BigInt size
 * exceeded` (or, for merely-large magnitudes, hangs building a multi-gigabyte BigInt). Comparing
 * canonical forms instead is bounded by digit count, so the read path (which calls this via
 * {@link wouldLosePrecisionAsDouble}) can never be crashed or hung by a hostile number.
 *
 * @internal
 */
function valueEquals(a: DecimalParts, b: DecimalParts): boolean {
  const na = canonical(a);
  const nb = canonical(b);
  return na.coefficient === nb.coefficient && na.scale === nb.scale;
}

/**
 * A FHIR `decimal`, backed by its exact lexical source string.
 *
 * Construct one via the {@link decimal} factory (which validates the text) rather than `new`. The
 * value is immutable and carries no `number` field by design — read {@link FhirDecimal.toString} for
 * the exact literal, {@link FhirDecimal.toBigInt} for an integer-valued decimal, and
 * {@link FhirDecimal.toNumber} only when you have consciously accepted the precision loss.
 *
 * @example
 * ```ts
 * import { decimal } from "@cosyte/fhir";
 * const dose = decimal("0.010");
 * dose.toString();                 // "0.010" — the trailing zero survives
 * dose.equals(decimal("0.01"));    // false — different precision (FHIR: 0.010 ≠ 0.01)
 * dose.equalsValue(decimal("0.01")); // true  — same quantity
 * ```
 */
export class FhirDecimal {
  /** The exact lexical text as it appeared on the wire (or was supplied to {@link decimal}). */
  public readonly raw: string;

  /**
   * @param raw - A validated JSON-number literal. Prefer the {@link decimal} factory over calling
   *   this directly; the factory is where validation lives.
   * @internal
   */
  public constructor(raw: string) {
    this.raw = raw;
  }

  /**
   * The exact lexical form — the string this decimal was created from, unchanged. This is what the
   * serializer emits, so a spec-clean value round-trips byte-for-byte.
   */
  public toString(): string {
    return this.raw;
  }

  /**
   * The exact value as a `bigint`, valid only for an integer-valued decimal (no fractional digits
   * after accounting for the exponent). Throws a `RangeError` otherwise — a caller asking for an
   * integer view of `1.5` has a bug, and silently truncating would be a data-integrity hazard.
   *
   * @example
   * ```ts
   * import { decimal } from "@cosyte/fhir";
   * decimal("9223372036854775807").toBigInt(); // 9223372036854775807n — exact past 2^53
   * ```
   */
  public toBigInt(): bigint {
    const parts = decompose(this.raw);
    if (parts === null) throw new RangeError("FhirDecimal.raw is not a valid number");
    // Zero is integer-valued 0n at any scale — short-circuit before any `10n ** scale`, so a hostile
    // `0e9999999999999999999` returns 0n instead of exploding the exponentiation.
    if (parts.coefficient === 0n) return 0n;
    if (parts.scale === 0) return parts.coefficient;
    if (parts.scale < 0) return parts.coefficient * 10n ** BigInt(-parts.scale);
    const divisor = 10n ** BigInt(parts.scale);
    if (parts.coefficient % divisor !== 0n) {
      throw new RangeError(`FhirDecimal "${this.raw}" is not integer-valued`);
    }
    return parts.coefficient / divisor;
  }

  /**
   * The value as a JavaScript `number`. **Lossy and deliberately explicit**: this is the one place
   * the float hazard ADR 0001 warns about is allowed in, and only because the caller named it. For
   * values with more than ~15 significant digits, trailing-zero precision, or magnitude beyond
   * `Number.MAX_SAFE_INTEGER`, the result is not exact. Prefer {@link FhirDecimal.toString} or
   * {@link FhirDecimal.toBigInt}.
   */
  public toNumber(): number {
    return Number(this.raw);
  }

  /**
   * Precision-sensitive equality — the FHIR-conformant default. Two decimals are equal only when
   * they denote the same quantity **and** carry the same precision, so `0.010` does not equal `0.01`
   * (the trailing zero is significant). Use {@link FhirDecimal.equalsValue} for quantity-only
   * comparison.
   */
  public equals(other: FhirDecimal): boolean {
    const a = decompose(this.raw);
    const b = decompose(other.raw);
    if (a === null || b === null) return this.raw === other.raw;
    return a.scale === b.scale && valueEquals(a, b);
  }

  /**
   * Quantity equality, precision-insensitive: `0.010` equals `0.01` equals `1e-2`. Computed by
   * aligning scales with BigInt arithmetic — no float is involved.
   */
  public equalsValue(other: FhirDecimal): boolean {
    const a = decompose(this.raw);
    const b = decompose(other.raw);
    if (a === null || b === null) return this.raw === other.raw;
    return valueEquals(a, b);
  }
}

/**
 * Whether a JSON-number literal would lose information if it were routed through a JavaScript
 * `number` (an IEEE-754 double) and back. This is the exact test the codec uses to raise
 * `DECIMAL_PRECISION_AT_RISK`: it is `true` when a naive `JSON.parse`-based reader *would have*
 * corrupted this value — either by changing its quantity (too many significant digits, or magnitude
 * past the safe-integer range) or by dropping trailing-zero precision (`0.010` → `0.01`).
 *
 * @example
 * ```ts
 * import { wouldLosePrecisionAsDouble } from "@cosyte/fhir";
 * wouldLosePrecisionAsDouble("0.010"); // true  — trailing zero dropped by a double
 * wouldLosePrecisionAsDouble("0.5");   // false — survives a double exactly
 * ```
 */
export function wouldLosePrecisionAsDouble(raw: string): boolean {
  const original = decompose(raw);
  if (original === null) return false;

  const asDouble = Number(raw);
  if (!Number.isFinite(asDouble)) return true;

  const roundTripped = decompose(asDouble.toString());
  if (roundTripped === null) return true;

  // Quantity changed, or precision (scale) was reduced — either is a loss.
  return !valueEquals(original, roundTripped) || original.scale !== roundTripped.scale;
}

/**
 * Construct a {@link FhirDecimal} from its exact lexical text, validating that the text is a JSON
 * number. Throws a `TypeError` on anything else — a decimal primitive can only hold a number literal,
 * and accepting arbitrary text here would defeat the whole point of the type.
 *
 * @param raw - The exact decimal literal, e.g. `"0.010"`, `"-3.14"`, `"1e3"`, `"42"`.
 * @throws TypeError when `raw` is not a valid JSON number.
 * @example
 * ```ts
 * import { decimal } from "@cosyte/fhir";
 * const weight = decimal("70.0"); // one-decimal-place precision, preserved
 * ```
 */
export function decimal(raw: string): FhirDecimal {
  if (!JSON_NUMBER.test(raw)) {
    throw new TypeError(`Not a valid FHIR decimal literal: ${JSON.stringify(raw)}`);
  }
  return new FhirDecimal(raw);
}
