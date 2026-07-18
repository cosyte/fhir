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
  /** A content-validation rule (a resource `constraint` / invariant) failed. */
  INVARIANT: "invariant",
  /** The content uses a modifier the processor does not support and cannot safely ignore. */
  NOT_SUPPORTED: "not-supported",
  /** Informational only — carries no defect (e.g. "this resource type has no schema yet"). */
  INFORMATIONAL: "informational",
  /** A business rule / profile-level assertion failed (e.g. a declared profile version is unknown). */
  BUSINESS_RULE: "business-rule",
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
  /**
   * Safety (Phase 3) — an element carries a `modifierExtension` this library does not understand.
   * FHIR's `?!` rule forbids ignoring an unknown modifier, so this **fails closed** (an `error`): the
   * element cannot be safely processed. See {@link ./safety.js}.
   */
  UNHANDLED_MODIFIER_EXTENSION: "UNHANDLED_MODIFIER_EXTENSION",
  /**
   * Safety (Phase 3) — the resource is marked `entered-in-error` and is therefore **retracted, not
   * data**. Surfaced as `information` (it is not itself a defect) so a consumer cannot miss it.
   */
  RETRACTED_RESOURCE: "RETRACTED_RESOURCE",
  /**
   * Safety (Phase 3) — a named resource invariant failed (`ait-1`/`ait-2`, `con-3`/`con-4`/`con-5`,
   * `obs-6`/`obs-7`). The specific constraint key travels in {@link ValidationIssue.constraint}, and
   * the severity mirrors the constraint's own (`error`, except the best-practice `con-3` → `warning`).
   */
  INVARIANT_VIOLATED: "INVARIANT_VIOLATED",
  /**
   * Invariant (Phase 7) — a profile `constraint`'s FHIRPath `expression` is **outside the bounded
   * engine's subset** (ADR 0002) and could not be evaluated. Always `information` (`informational`):
   * the constraint is reported **unchecked, never assumed to pass** (roadmap §6 fail-safe) — the
   * library does not claim conformance to an invariant it could not test. The constraint `key` travels
   * in {@link ValidationIssue.constraint}. Value-free (the location + key, never an instance value).
   */
  INVARIANT_UNCHECKED: "INVARIANT_UNCHECKED",
  /**
   * Quantity/UCUM (Phase 4) — a `Quantity` claims the UCUM `system` but its `code` is absent or not a
   * shape-valid UCUM expression, so the unit cannot be trusted for machine use. A `warning`
   * (`value`): the value is **preserved verbatim and never converted** — the library does not bundle
   * UCUM content, so it cannot assert the code *is* a real unit, only that it is present and well-shaped.
   */
  UCUM_UNIT_UNRECOGNIZED: "UCUM_UNIT_UNRECOGNIZED",
  /**
   * Quantity/UCUM (Phase 4) — a vital-signs Observation's measured value carries a unit the FHIR
   * vital-signs profile forbids for that LOINC code (wrong UCUM `code`, or a non-UCUM `system`). An
   * `error` (`code-invalid`): the vital-signs profile *requires* the unit, so a nonconformant one is a
   * profile violation, compared on the UCUM `code` (case- and bracket-sensitive), never the `unit` string.
   */
  VITAL_SIGN_UNIT_NONCONFORMANT: "VITAL_SIGN_UNIT_NONCONFORMANT",
  /**
   * Quantity/UCUM (Phase 4) — an Observation whose profile expects a numeric `Quantity` value carries
   * a different `value[x]` variant instead (e.g. `valueString`). A `warning` (`value`): the value is
   * preserved and surfaced by its real type — a caller must not read it as a number.
   */
  VALUE_TYPE_UNEXPECTED: "VALUE_TYPE_UNEXPECTED",
  /**
   * Terminology (Phase 5) — a bound coding's `system` URI is not in the frozen known-systems registry
   * (and not one the binding's value set draws from). Always `information` (`code-invalid`): an
   * unknown system may be a legitimate local/proprietary one, so it is never a defect — it only means
   * the library cannot validate codes drawn from it. Content-free, so it can never flip validity.
   */
  CODE_SYSTEM_UNKNOWN: "CODE_SYSTEM_UNKNOWN",
  /**
   * Terminology (Phase 5) — a bound coding uses a **known** code `system` that is not one the
   * binding's value set draws from (e.g. an ICD-10-CM code where the binding expects RxNorm + SNOMED).
   * This is the content-free "wrong system for this binding" check — decided from the `system` alone,
   * with no value-set content. Severity follows the binding strength (`required` → `error`;
   * `extensible`/`preferred` → `warning`, since a different system may be a legitimate extension;
   * `example` → none). Compared on the `system` URI, never a code value.
   */
  CODE_SYSTEM_UNEXPECTED: "CODE_SYSTEM_UNEXPECTED",
  /**
   * Terminology (Phase 5) — a configured terminology service reported that a bound coding's
   * `(system, code)` is **not a member** of the binding's value set. Severity follows the binding
   * strength (`required`/`extensible` → `error`; `preferred` → `warning`; `example` → `information`,
   * never an error). Emitted **only** when a service definitively answers `not-in`; with no service,
   * or an `unknown` answer, the library degrades to the content-free system checks and never
   * false-errors (roadmap §5 fail-safe). Value-free — the coding location, never the code itself.
   */
  CODE_NOT_IN_VALUESET: "CODE_NOT_IN_VALUESET",
  /**
   * Profile (Phase 6) — an instance element is present under a **closed** slicing whose discriminators
   * matched none of the profile's defined slices. A `structure` `error`: `closed` slicing forbids
   * content outside the named slices. (Under `open` slicing an unmatched element is allowed and draws
   * nothing; under `openAtEnd` it is allowed only in the trailing position — this library flags a
   * closed-slicing miss and leaves the ordering nuance to a later phase.)
   */
  PROFILE_SLICE_UNMATCHED: "PROFILE_SLICE_UNMATCHED",
  /**
   * Profile (Phase 6) — a slicing whose discriminator this library cannot evaluate (a `profile`
   * discriminator, which needs recursive profile resolution, or the R5-only `position`). Emitted as
   * `information` so slice membership is reported **unchecked, never silently passed** (the roadmap
   * §6 fail-safe): the library does not guess a slice assignment it cannot justify.
   */
  PROFILE_SLICE_UNCHECKED: "PROFILE_SLICE_UNCHECKED",
  /**
   * Profile (Phase 6) — an element the profile marks **must-support** is absent from the instance.
   * **Always `information`, never an error** (the roadmap §8 fail-safe, and the single most important
   * must-support rule): must-support is a *system obligation* on the sender to be able to populate the
   * element and on the receiver to tolerate its absence — it is **not** an instance-presence
   * requirement. A strict client that errors on an absent must-support element is the classic bug this
   * code exists to avoid.
   */
  MUST_SUPPORT_ABSENT: "MUST_SUPPORT_ABSENT",
  /**
   * Profile (Phase 6) — the instance's `meta.profile` declares a profile at a version the supplied
   * profile set does not carry (`canonical|version` with a different version, or an unresolvable
   * canonical). A `warning` (`business-rule`): the roadmap requires flagging an unknown profile
   * version rather than silently best-effort-validating against a different one.
   */
  PROFILE_VERSION_MISMATCH: "PROFILE_VERSION_MISMATCH",
  /**
   * Profile (Phase 6) — an element carries a value that is not **exactly** the profile's `fixed[x]`.
   * A `value` `error`: `fixed[x]` is an equality constraint (the element SHALL match the fixed value
   * exactly, including every nested property). Compared structurally and precision-exactly (decimals
   * via {@link ../model/decimal.js}), never by echoing the value.
   */
  PROFILE_FIXED_MISMATCH: "PROFILE_FIXED_MISMATCH",
  /**
   * Profile (Phase 6) — an element does not match the profile's `pattern[x]`. A `value` `error`:
   * `pattern[x]` is a **subset** constraint (the element SHALL contain *at least* the pattern's
   * properties and values, but may carry more) — the weaker sibling of `fixed[x]`. Value-free.
   */
  PROFILE_PATTERN_MISMATCH: "PROFILE_PATTERN_MISMATCH",
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
  /**
   * The spec constraint key when the finding is an invariant violation (e.g. `"ait-1"`, `"obs-6"`) —
   * a public FHIR identifier, never an instance value, so it is safe to surface. `undefined` for
   * every non-invariant finding. It reaches the `OperationOutcome` as `issue.details.text`.
   */
  readonly constraint?: string;
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
  UNHANDLED_MODIFIER_EXTENSION: ISSUE_TYPES.NOT_SUPPORTED,
  RETRACTED_RESOURCE: ISSUE_TYPES.INFORMATIONAL,
  INVARIANT_VIOLATED: ISSUE_TYPES.INVARIANT,
  INVARIANT_UNCHECKED: ISSUE_TYPES.INFORMATIONAL,
  UCUM_UNIT_UNRECOGNIZED: ISSUE_TYPES.VALUE,
  VITAL_SIGN_UNIT_NONCONFORMANT: ISSUE_TYPES.CODE_INVALID,
  VALUE_TYPE_UNEXPECTED: ISSUE_TYPES.VALUE,
  CODE_SYSTEM_UNKNOWN: ISSUE_TYPES.CODE_INVALID,
  CODE_SYSTEM_UNEXPECTED: ISSUE_TYPES.CODE_INVALID,
  CODE_NOT_IN_VALUESET: ISSUE_TYPES.CODE_INVALID,
  PROFILE_SLICE_UNMATCHED: ISSUE_TYPES.STRUCTURE,
  PROFILE_SLICE_UNCHECKED: ISSUE_TYPES.INFORMATIONAL,
  MUST_SUPPORT_ABSENT: ISSUE_TYPES.INFORMATIONAL,
  PROFILE_VERSION_MISMATCH: ISSUE_TYPES.BUSINESS_RULE,
  PROFILE_FIXED_MISMATCH: ISSUE_TYPES.VALUE,
  PROFILE_PATTERN_MISMATCH: ISSUE_TYPES.VALUE,
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
  UNHANDLED_MODIFIER_EXTENSION:
    "Element carries a modifierExtension this processor does not understand; it cannot be safely " +
    "processed and is rejected (fail-closed).",
  RETRACTED_RESOURCE:
    "Resource is marked entered-in-error; it is retracted and must not be treated as active data.",
  INVARIANT_VIOLATED: "A resource invariant (content-validation constraint) was violated.",
  INVARIANT_UNCHECKED:
    "A resource invariant could not be evaluated by the bounded FHIRPath engine; it is reported " +
    "unchecked rather than assumed to pass.",
  UCUM_UNIT_UNRECOGNIZED:
    "Quantity declares the UCUM system but its unit code is absent or not a well-formed UCUM " +
    "expression; the unit is preserved verbatim and never converted.",
  VITAL_SIGN_UNIT_NONCONFORMANT:
    "Vital-signs measurement carries a unit the vital-signs profile does not allow for this code.",
  VALUE_TYPE_UNEXPECTED: "Observation value is present but not the expected type for this profile.",
  CODE_SYSTEM_UNKNOWN:
    "Coding uses a code system that is not in the known-systems registry; its codes cannot be " +
    "validated (an unrecognized system is not itself an error).",
  CODE_SYSTEM_UNEXPECTED: "Coding uses a code system that the bound value set does not draw from.",
  CODE_NOT_IN_VALUESET:
    "Coding is not a member of the value set required by this element's binding.",
  PROFILE_SLICE_UNMATCHED:
    "Element is present under closed slicing but matches none of the profile's defined slices.",
  PROFILE_SLICE_UNCHECKED:
    "Slice membership could not be evaluated (an unsupported discriminator); it is reported " +
    "unchecked rather than assumed to pass.",
  MUST_SUPPORT_ABSENT:
    "Profile marks this element must-support; it is absent. Must-support is a system obligation, " +
    "not an instance-presence requirement — this is informational, never an error.",
  PROFILE_VERSION_MISMATCH:
    "Instance declares a profile at a version the supplied profile set does not carry; it was not " +
    "validated against that exact version.",
  PROFILE_FIXED_MISMATCH:
    "Element value does not exactly match the value the profile fixes for it.",
  PROFILE_PATTERN_MISMATCH: "Element does not match the pattern the profile requires for it.",
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
 * @param constraint - The spec constraint key, for an invariant finding only (e.g. `"ait-1"`).
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
  constraint?: string,
): ValidationIssue {
  const issue: ValidationIssue = { code, severity, type: ISSUE_TYPE_OF[code], expression };
  return constraint === undefined ? issue : { ...issue, constraint };
}
