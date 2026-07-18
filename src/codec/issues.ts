/**
 * Codec diagnostics — the value-free warning registry shared by the JSON **and** XML readers, plus
 * the typed fatal for the JSON reader (the XML reader has its own {@link ../xml/issues.js FhirXmlError}).
 *
 * Two tiers, mirroring the cosyte parser convention (`hl7`'s warnings/errors split):
 *
 * - **Warnings** ({@link FhirIssue}) are recoverable — the reader keeps going and preserves the
 *   data, accumulating a value-free issue so the consumer knows what was tolerated.
 * - **Fatals** ({@link FhirCodecError}) are unrecoverable — malformed JSON, or a primitive/`_`-sibling
 *   array whose lengths disagree so the reader cannot know which value an extension belongs to. The
 *   latter fails *closed*: guessing the alignment could attach an extension to the wrong clinical
 *   value, so the reader refuses rather than risk it.
 *
 * **PHI discipline (roadmap §7).** A FHIR resource is PHI by default, and diagnostics are the leak
 * vector. Every issue and every error here is **value-free by construction**: it carries a coded
 * `code`, a `severity`, and an `expression` (a FHIRPath *location* such as `Patient.name[0].given[1]`)
 * — never the offending value. The `FhirCodecError` for malformed JSON carries a byte `offset`, not
 * the surrounding text.
 *
 * @packageDocumentation
 */

/**
 * Stable string codes for every warning the JSON reader may emit. Frozen via `as const` so the
 * `IssueCode` union is exact and a comparison is typo-checked. Renaming a code is a breaking change.
 *
 * @example
 * ```ts
 * import { parseResource, ISSUE_CODES } from "@cosyte/fhir";
 * const { issues } = parseResource(json);
 * if (issues.some((i) => i.code === ISSUE_CODES.DECIMAL_PRECISION_AT_RISK)) {
 *   // a value here would have been corrupted by a naive JSON.parse — we preserved it
 * }
 * ```
 */
export const ISSUE_CODES = {
  /**
   * A numeric primitive whose exact value would have been corrupted by routing it through a
   * JavaScript `number` — trailing-zero precision, more than ~15 significant digits, or magnitude
   * past the safe-integer range. Informational: the reader preserved it losslessly; this flags that
   * the protection mattered here.
   */
  DECIMAL_PRECISION_AT_RISK: "DECIMAL_PRECISION_AT_RISK",
  /**
   * A property the reader did not expect at this position and preserved verbatim (Postel's Law —
   * lenient read). Warning severity: nothing was lost, but a consumer may want to know.
   */
  UNKNOWN_PROPERTY: "UNKNOWN_PROPERTY",
  /**
   * The XML reader met content it did not expect at this position and could not map to the model —
   * non-whitespace character data on a FHIR element (FHIR elements carry values in the `value`
   * attribute, not as text, except the deferred narrative `<div>`), or a default namespace other
   * than the FHIR one. Warning severity: preserved-and-flagged, nothing rejected.
   */
  UNEXPECTED_XML_CONTENT: "UNEXPECTED_XML_CONTENT",
} as const;

/** Discriminant union of every {@link ISSUE_CODES} value. */
export type IssueCode = (typeof ISSUE_CODES)[keyof typeof ISSUE_CODES];

/** FHIR issue severities carried by a warning (the recoverable subset of the R4 set). */
export type IssueSeverity = "warning" | "information";

/**
 * A single value-free diagnostic accumulated during a lenient read.
 *
 * `expression` is a FHIRPath location into the document (e.g. `Bundle.entry[2].resource.ofType(Patient).name[0].given[1]`,
 * or a simpler `Patient.birthDate`) — it says *where* without echoing *what*. It never contains a
 * resource value, so an issue is safe to log.
 */
export interface FhirIssue {
  readonly code: IssueCode;
  readonly severity: IssueSeverity;
  readonly expression: string;
}

/**
 * Build a {@link ISSUE_CODES.DECIMAL_PRECISION_AT_RISK} issue at `expression`.
 *
 * @example
 * ```ts
 * import { decimalPrecisionAtRisk } from "@cosyte/fhir";
 * const issue = decimalPrecisionAtRisk("Observation.valueQuantity.value");
 * ```
 */
export function decimalPrecisionAtRisk(expression: string): FhirIssue {
  return { code: ISSUE_CODES.DECIMAL_PRECISION_AT_RISK, severity: "information", expression };
}

/**
 * Build a {@link ISSUE_CODES.UNKNOWN_PROPERTY} issue at `expression`.
 *
 * @example
 * ```ts
 * import { unknownProperty } from "@cosyte/fhir";
 * const issue = unknownProperty("Patient.wibble");
 * ```
 */
export function unknownProperty(expression: string): FhirIssue {
  return { code: ISSUE_CODES.UNKNOWN_PROPERTY, severity: "warning", expression };
}

/**
 * Build a {@link ISSUE_CODES.UNEXPECTED_XML_CONTENT} issue at `expression` (XML reader only).
 *
 * @example
 * ```ts
 * import { unexpectedXmlContent } from "@cosyte/fhir";
 * const issue = unexpectedXmlContent("Observation.status");
 * ```
 */
export function unexpectedXmlContent(expression: string): FhirIssue {
  return { code: ISSUE_CODES.UNEXPECTED_XML_CONTENT, severity: "warning", expression };
}

/**
 * Stable string codes for the reader's unrecoverable fatals. Locked to two: everything less severe
 * is a recoverable {@link FhirIssue}.
 */
export const FATAL_CODES = {
  /** The input is not well-formed JSON. */
  MALFORMED_JSON: "MALFORMED_JSON",
  /**
   * A primitive value array and its `_`-sibling array have different lengths, so the null-padded
   * index alignment is broken and the reader cannot know which value each extension belongs to
   * (cf. HAPI #5738). Fails closed — see the module doc.
   */
  PRIMITIVE_EXTENSION_MISALIGNED: "PRIMITIVE_EXTENSION_MISALIGNED",
} as const;

/** Discriminant union of every {@link FATAL_CODES} value. */
export type FatalCode = (typeof FATAL_CODES)[keyof typeof FATAL_CODES];

/**
 * Thrown by the JSON reader on an unrecoverable structural failure. Carries the coded reason, a
 * FHIRPath `expression` location (for a misalignment) or an `offset` byte position (for malformed
 * JSON), and — by design — **no** slice of the offending input, because that slice could be PHI.
 *
 * @example
 * ```ts
 * import { parseResource, FhirCodecError, FATAL_CODES } from "@cosyte/fhir";
 * try {
 *   parseResource(feed);
 * } catch (err) {
 *   if (err instanceof FhirCodecError && err.code === FATAL_CODES.PRIMITIVE_EXTENSION_MISALIGNED) {
 *     // the `_`-sibling alignment was broken at err.expression
 *   }
 * }
 * ```
 */
export class FhirCodecError extends Error {
  public readonly code: FatalCode;
  /** FHIRPath location of the failure, when it has one (misalignment). */
  public readonly expression: string | undefined;
  /** Byte offset into the input, when it has one (malformed JSON). */
  public readonly offset: number | undefined;

  /**
   * @param code - The fatal reason.
   * @param message - A PHI-safe description — must not embed any input value.
   * @param location - Either a FHIRPath `expression` or a byte `offset`.
   * @internal
   */
  public constructor(
    code: FatalCode,
    message: string,
    location: { expression?: string; offset?: number } = {},
  ) {
    super(message);
    this.name = "FhirCodecError";
    this.code = code;
    this.expression = location.expression;
    this.offset = location.offset;
  }
}
