/**
 * The validation issue vocabulary — severities, R4 `IssueType` codes, the stable public validation
 * code registry, and the **one redaction chokepoint** that turns a coded issue into value-free
 * diagnostic text.
 *
 * Two tiers, layered on top of the codec's read-time diagnostics ({@link ../codec/issues.js}):
 *
 * - The codec's {@link ../codec/issues.js} carries what the *reader* tolerated (unknown property,
 *   decimal precision). This module carries what the *validator* found: structure, cardinality, and
 *   datatype/value-domain problems, each mapped to an R4 `OperationOutcome.issue.code` (an
 *   `IssueType`) and an R4 `severity`.
 *
 * **PHI discipline (roadmap §7).** A FHIR resource is PHI by default, and diagnostics are the leak
 * vector. Every {@link ValidationIssue} is **value-free by construction**: a stable `code`, a
 * `severity`, an `IssueType`, and an `expression` (a FHIRPath *location* such as
 * `Patient.name[0].given[1]`) — never the offending value. The human-readable `diagnostics` string
 * that reaches an `OperationOutcome` is derived **only** from the code, through the single
 * {@link diagnosticFor} table — there is no code path that interpolates an instance value into a
 * message. This is the redaction chokepoint the roadmap places in Phase 2.
 *
 * @packageDocumentation
 */

/**
 * The R4 issue-severity value set (`valueset-issue-severity`), in full. R4 does **not** include the
 * R5 `success` value (roadmap §10) — the "all clear" case is expressed as `information` +
 * {@link ISSUE_TYPES.INFORMATIONAL}, not a `success` severity.
 */
export const ISSUE_SEVERITIES = {
  FATAL: "fatal",
  ERROR: "error",
  WARNING: "warning",
  INFORMATION: "information",
} as const;

/** One of the four R4 {@link ISSUE_SEVERITIES}. */
export type ValidationSeverity = (typeof ISSUE_SEVERITIES)[keyof typeof ISSUE_SEVERITIES];

/**
 * The subset of the R4 `IssueType` value set (`valueset-issue-type`) that the Phase-2 layers emit.
 * These are the wire `OperationOutcome.issue.code` values; the richer sub-code tree (terminology,
 * invariant, profile) arrives with the phases that emit it. Renaming one is a breaking change.
 */
export const ISSUE_TYPES = {
  /** Structural issue — an element that is not allowed here, or a cardinality-max violation. */
  STRUCTURE: "structure",
  /** A required element (min cardinality ≥ 1) is missing. */
  REQUIRED: "required",
  /** An element value is invalid against its datatype value-domain (a primitive-regex failure). */
  VALUE: "value",
  /** A code is not a member of a required-strength value set binding. */
  CODE_INVALID: "code-invalid",
  /** Informational only — carries no defect (e.g. "this resource type has no schema yet"). */
  INFORMATIONAL: "informational",
} as const;

/** One of the {@link ISSUE_TYPES} — the R4 `OperationOutcome.issue.code`. */
export type IssueType = (typeof ISSUE_TYPES)[keyof typeof ISSUE_TYPES];

/**
 * Stable string codes for every validation finding the Phase-2 layers can raise. Frozen via
 * `as const` so the union is exact and a comparison is typo-checked. **Renaming a code is a breaking
 * change** — the roadmap snapshots this set (see `test/validation-codes.test.ts`).
 */
export const VALIDATION_CODES = {
  /** Layer 1 — an element the resource's structure does not define at this location. */
  UNKNOWN_ELEMENT: "UNKNOWN_ELEMENT",
  /** Layer 1 — the resource carries no `resourceType`, so it cannot be structurally validated. */
  RESOURCE_TYPE_UNKNOWN: "RESOURCE_TYPE_UNKNOWN",
  /** Layer 1 — no schema is available for this resource type; structural layers were skipped. */
  RESOURCE_NOT_MODELED: "RESOURCE_NOT_MODELED",
  /** Layer 1 — an element's node shape (primitive / complex) is not what its datatype expects. */
  TYPE_MISMATCH: "TYPE_MISMATCH",
  /** Layer 1 — more than one variant of a `choice[x]` element is present. */
  CHOICE_AMBIGUOUS: "CHOICE_AMBIGUOUS",
  /** Layer 2 — a required element (min ≥ 1) is absent. */
  CARDINALITY_MIN: "CARDINALITY_MIN",
  /** Layer 2 — an element appears more times than its maximum cardinality allows. */
  CARDINALITY_MAX: "CARDINALITY_MAX",
  /** Layer 3 — a primitive value does not match its datatype's lexical form. */
  PRIMITIVE_INVALID: "PRIMITIVE_INVALID",
  /** Layer 3 — a `code` value is outside a required-strength enumerated binding. */
  CODE_INVALID: "CODE_INVALID",
} as const;

/** Discriminant union of every {@link VALIDATION_CODES} value. */
export type ValidationCode = (typeof VALIDATION_CODES)[keyof typeof VALIDATION_CODES];

/**
 * A single value-free validation finding.
 *
 * `expression` is a FHIRPath location into the document (e.g. `Patient.gender`,
 * `Observation.component[1].valueQuantity.value`) — it says *where* without echoing *what*. An issue
 * never contains a resource value, so it is safe to log or return in an `OperationOutcome`.
 */
export interface ValidationIssue {
  readonly code: ValidationCode;
  readonly severity: ValidationSeverity;
  /** The R4 `OperationOutcome.issue.code` this finding maps to. */
  readonly type: IssueType;
  /** FHIRPath location of the finding. */
  readonly expression: string;
}

/** The fixed R4 `IssueType` each validation code maps to. */
const ISSUE_TYPE_OF: Readonly<Record<ValidationCode, IssueType>> = {
  UNKNOWN_ELEMENT: ISSUE_TYPES.STRUCTURE,
  RESOURCE_TYPE_UNKNOWN: ISSUE_TYPES.STRUCTURE,
  RESOURCE_NOT_MODELED: ISSUE_TYPES.INFORMATIONAL,
  TYPE_MISMATCH: ISSUE_TYPES.STRUCTURE,
  CHOICE_AMBIGUOUS: ISSUE_TYPES.STRUCTURE,
  CARDINALITY_MIN: ISSUE_TYPES.REQUIRED,
  CARDINALITY_MAX: ISSUE_TYPES.STRUCTURE,
  PRIMITIVE_INVALID: ISSUE_TYPES.VALUE,
  CODE_INVALID: ISSUE_TYPES.CODE_INVALID,
};

/**
 * The single value-free human-readable line for each code. **This is the redaction chokepoint**: it
 * is keyed only by the code, so no instance value can ever reach `diagnostics`. Every string here is
 * a description of the *kind* of problem, never a rendering of the offending data.
 */
const DIAGNOSTIC_OF: Readonly<Record<ValidationCode, string>> = {
  UNKNOWN_ELEMENT: "Element is not defined at this location in the resource structure.",
  RESOURCE_TYPE_UNKNOWN: "Resource is missing a resourceType and cannot be structurally validated.",
  RESOURCE_NOT_MODELED:
    "No structural schema is available for this resource type; structural validation was skipped.",
  TYPE_MISMATCH: "Element value is not of the shape its datatype requires.",
  CHOICE_AMBIGUOUS: "More than one variant of a choice element is present.",
  CARDINALITY_MIN: "Required element is missing.",
  CARDINALITY_MAX: "Element appears more times than its maximum cardinality allows.",
  PRIMITIVE_INVALID: "Primitive value does not match the required lexical form for its datatype.",
  CODE_INVALID: "Code is not in the required value set for this element.",
};

/**
 * The value-free diagnostic line for a code — the only text that reaches an `OperationOutcome`.
 *
 * @param code - The validation code.
 * @returns A description of the *kind* of problem, guaranteed free of any instance value.
 * @example
 * ```ts
 * import { diagnosticFor } from "@cosyte/fhir";
 * diagnosticFor("CARDINALITY_MIN"); // "Required element is missing."
 * ```
 */
export function diagnosticFor(code: ValidationCode): string {
  return DIAGNOSTIC_OF[code];
}

/**
 * Construct a value-free {@link ValidationIssue}. The `IssueType` is fixed by the code; only the
 * `severity` is caller-chosen (it varies with lenient vs strict mode for some codes).
 *
 * @param code - The validation code.
 * @param severity - The R4 severity to record (mode-dependent for some codes).
 * @param expression - The FHIRPath location of the finding — never a value.
 * @example
 * ```ts
 * import { validationIssue } from "@cosyte/fhir";
 * const issue = validationIssue("CODE_INVALID", "error", "Patient.gender");
 * ```
 */
export function validationIssue(
  code: ValidationCode,
  severity: ValidationSeverity,
  expression: string,
): ValidationIssue {
  return { code, severity, type: ISSUE_TYPE_OF[code], expression };
}
