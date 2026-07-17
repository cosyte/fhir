/**
 * The `OperationOutcome` builder — the value-free wire form of a validation result (Phase 2).
 *
 * `OperationOutcome` is FHIR's standard "here is what I found" resource (operationoutcome.html). The
 * builder turns a list of {@link ValidationIssue}s into an immutable {@link FhirComplex} model that
 * serializes to spec-clean FHIR JSON via {@link ../codec/write.js}. Every issue carries:
 *
 * - `severity` — the R4 severity (`fatal | error | warning | information`);
 * - `code` — the R4 `IssueType`;
 * - `expression` — the FHIRPath *location* (a repeating element); and
 * - `diagnostics` — a value-free line derived **only** from the validation code (the redaction
 *   chokepoint in {@link ./issues.js}). No instance value ever reaches this resource.
 *
 * An `OperationOutcome.issue` is `1..*` — it must carry at least one issue. When validation found
 * nothing, {@link toOperationOutcome} emits a single `information` / `informational` "all clear"
 * issue rather than an (invalid) empty one. R4 has no `success` severity (that is R5, roadmap §10),
 * so the all-clear is `information`.
 *
 * @packageDocumentation
 */

import { complex, list, primitive, type FhirComplex, type FhirProperty } from "../model/index.js";
import { diagnosticFor, ISSUE_SEVERITIES, ISSUE_TYPES, type ValidationIssue } from "./issues.js";

/** Build one `OperationOutcome.issue` complex node from a validation issue. */
function issueNode(issue: ValidationIssue): FhirComplex {
  const properties: FhirProperty[] = [
    { name: "severity", value: primitive(issue.severity) },
    { name: "code", value: primitive(issue.type) },
    { name: "diagnostics", value: primitive(diagnosticFor(issue.code)) },
    { name: "expression", value: list([primitive(issue.expression)]) },
  ];
  // An invariant finding names its constraint key in `issue.details.text` — a public FHIR identifier
  // (e.g. "ait-1"), never an instance value, so the redaction chokepoint holds.
  if (issue.constraint !== undefined) {
    properties.splice(3, 0, {
      name: "details",
      value: complex([{ name: "text", value: primitive(issue.constraint) }]),
    });
  }
  return complex(properties);
}

/** The synthetic "all clear" issue emitted when there are no findings. */
function allClearNode(): FhirComplex {
  return complex([
    { name: "severity", value: primitive(ISSUE_SEVERITIES.INFORMATION) },
    { name: "code", value: primitive(ISSUE_TYPES.INFORMATIONAL) },
    { name: "diagnostics", value: primitive("No issues detected.") },
  ]);
}

/**
 * Build an `OperationOutcome` resource model from validation issues.
 *
 * The result is an immutable {@link FhirComplex}; serialize it with `serializeResource` to get
 * spec-clean, **value-free** FHIR JSON. Safe to log or return to a caller — it contains locations and
 * coded reasons, never resource values.
 *
 * @param issues - The validation findings (may be empty → an "all clear" outcome).
 * @returns The `OperationOutcome` as a model resource.
 * @example
 * ```ts
 * import { validateResource, toOperationOutcome, serializeResource } from "@cosyte/fhir";
 * const { issues } = validateResource(resource);
 * const outcome = toOperationOutcome(issues);
 * serializeResource(outcome); // → {"resourceType":"OperationOutcome","issue":[…]}
 * ```
 */
export function toOperationOutcome(issues: readonly ValidationIssue[]): FhirComplex {
  const nodes = issues.length === 0 ? [allClearNode()] : issues.map(issueNode);
  return complex([
    { name: "resourceType", value: primitive("OperationOutcome") },
    { name: "issue", value: list(nodes) },
  ]);
}
