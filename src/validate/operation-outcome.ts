/**
 * The `OperationOutcome` builder, the value-free wire form of a validation result.
 *
 * `OperationOutcome` is FHIR's standard "here is what I found" resource (operationoutcome.html). The
 * builder turns a list of {@link ValidationIssue}s into an immutable {@link FhirComplex} model that
 * serializes to spec-clean FHIR JSON via {@link ../codec/write.js}. Every issue carries:
 *
 * - `severity`, the R4 severity (`fatal | error | warning | information`);
 * - `code`, the R4 `IssueType`;
 * - `expression`, the FHIRPath *location* (a repeating element), whose segments are the document's
 *   own names bounded to the published form of a FHIR name. A name outside that form reads as the
 *   {@link ../model/path.js} `WITHHELD` marker, and an expression carrying one is a location with a
 *   gap rather than a path that resolves against the instance, so the outcome is spec-clean as a
 *   resource while that one element is deliberately not resolvable; and
 * - `diagnostics`, a value-free line derived **only** from the validation code (the redaction
 *   chokepoint in {@link ./issues.js}). No instance value ever reaches this resource; in particular
 *   neither identity below is interpolated into it; and
 * - `details`, present only when the finding carries an identity asserted **outside** the document:
 *   an invariant's constraint key (`details.text`), or a membership finding's code-system release
 *   record (`details.coding` marks whether the caller's terminology service declared a release, and
 *   a declared one rides verbatim in `details.text`). A resource's own `Coding.version` is never
 *   read and never appears here.
 *
 * An `OperationOutcome.issue` is `1..*`, it must carry at least one issue. When validation found
 * nothing, {@link toOperationOutcome} emits a single `information` / `informational` "all clear"
 * issue rather than an (invalid) empty one. R4 has no `success` severity (that is R5),
 * so the all-clear is `information`.
 *
 * @packageDocumentation
 */

import { complex, list, primitive, type FhirComplex, type FhirProperty } from "../model/index.js";
import {
  diagnosticFor,
  CODE_SYSTEM_VERSION_RECORD_CODES,
  CODE_SYSTEM_VERSION_RECORD_SYSTEM,
  ISSUE_SEVERITIES,
  ISSUE_TYPES,
  type CodeSystemVersionRecord,
  type ValidationIssue,
} from "./issues.js";

/** Build one `OperationOutcome.issue` complex node from a validation issue. */
function issueNode(issue: ValidationIssue): FhirComplex {
  const properties: FhirProperty[] = [
    { name: "severity", value: primitive(issue.severity) },
    { name: "code", value: primitive(issue.type) },
    { name: "diagnostics", value: primitive(diagnosticFor(issue.code)) },
    { name: "expression", value: list([primitive(issue.expression)]) },
  ];
  const details = detailsNode(issue);
  if (details !== undefined) properties.splice(3, 0, { name: "details", value: details });
  return complex(properties);
}

/**
 * The `issue.details` CodeableConcept, or `undefined` when the finding carries neither identity it
 * can hold. Both are assertions made **outside** the document, which is why they may be surfaced at
 * all; `diagnostics` is untouched either way and stays keyed by the finding code alone.
 *
 * - An **invariant** finding names its constraint key in `details.text`, a public FHIR identifier
 *   (e.g. `"ait-1"`), never an instance value.
 * - A **membership** finding names its code-system release record in `details.coding`: the marker
 *   from {@link CODE_SYSTEM_VERSION_RECORD_CODES} says whether the caller's service declared a
 *   release, and a declared one rides verbatim in `details.text`. The two elements are separate on
 *   purpose, so no release string a service could declare (`"undeclared"` included) can be mistaken
 *   for the marker, and an undeclared answer is a positive statement rather than an absence.
 *
 * The two never co-occur (only `CODE_NOT_IN_VALUESET` carries a release record and it is not an
 * invariant finding), and `details.text` is written at most once regardless.
 */
function detailsNode(issue: ValidationIssue): FhirComplex | undefined {
  const members: FhirProperty[] = [];
  const record = issue.codeSystemVersion;
  if (record !== undefined) members.push({ name: "coding", value: list([recordCoding(record)]) });

  let text: string | undefined = issue.constraint;
  if (record !== undefined) text = record.declared ? record.version : undefined;
  if (text !== undefined) members.push({ name: "text", value: primitive(text) });

  return members.length === 0 ? undefined : complex(members);
}

/** The `details.coding[0]` marker saying whether the answer declared a code-system release. */
function recordCoding(record: CodeSystemVersionRecord): FhirComplex {
  const marker = record.declared
    ? CODE_SYSTEM_VERSION_RECORD_CODES.DECLARED
    : CODE_SYSTEM_VERSION_RECORD_CODES.UNDECLARED;
  return complex([
    { name: "system", value: primitive(CODE_SYSTEM_VERSION_RECORD_SYSTEM) },
    { name: "code", value: primitive(marker) },
  ]);
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
 * spec-clean, **value-free** FHIR JSON. Safe to log or return to a caller, it contains locations and
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
