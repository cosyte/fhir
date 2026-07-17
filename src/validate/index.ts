/**
 * FHIR validation — the layered structural / cardinality / value-domain validator and its
 * `OperationOutcome` output (Phase 2, validation layers 1–3).
 *
 * Postel's Law holds here too: a lenient read warns-and-preserves an unknown element while a strict
 * emit errors on it. Every finding is **value-free** — a coded reason plus a FHIRPath location — and
 * the human-readable `diagnostics` that reach an `OperationOutcome` are derived only from the code
 * (the redaction chokepoint), so no resource value can leak.
 *
 * Terminology binding beyond required-code enumeration (Phase 5), profile / slicing / must-support
 * (Phase 6), and FHIRPath invariants (Phase 7) arrive with the phases that own them. FHIRPath itself
 * is governed by `documentation/decisions/0002-fhirpath-dependency-posture.md`.
 */

export { validateResource } from "./validate.js";
export type { ValidateOptions, ValidationMode, ValidationResult } from "./validate.js";
export { collectSafetyIssues } from "./safety.js";
export { toOperationOutcome } from "./operation-outcome.js";
export {
  diagnosticFor,
  validationIssue,
  ISSUE_SEVERITIES,
  ISSUE_TYPES,
  VALIDATION_CODES,
} from "./issues.js";
export type { IssueType, ValidationCode, ValidationIssue, ValidationSeverity } from "./issues.js";
export { isPrimitiveType, validatePrimitiveValue, PRIMITIVE_TYPES } from "./primitives.js";
export type { PrimitiveType } from "./primitives.js";
export { baseSchema, buildRegistry, isChoice, resolveElement, UNBOUNDED } from "./schema.js";
export type { ElementSchema, RequiredBinding, ResourceSchema, SchemaRegistry } from "./schema.js";
