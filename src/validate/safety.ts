/**
 * The safety validation layer (Phase 3, the fail-closed status & negation spine).
 *
 * Layered on top of the Phase-2 structural validator, this layer enforces the parts of FHIR that,
 * read wrong, harm a patient (roadmap §4). It produces value-free {@link ValidationIssue}s for three
 * things:
 *
 * 1. **Unhandled `modifierExtension` → fail closed.** FHIR's modifier rule (`?!`, roadmap §4.8): a
 *    consumer that does not understand a `modifierExtension` MUST reject the element, it must not
 *    process it as if the modifier were absent. This library understands *no* modifier extensions yet
 *    ({@link ../safety/codes.js} `KNOWN_MODIFIER_EXTENSION_URLS` is empty), so **any** `modifierExtension`
 *    anywhere in the resource is an `error` (`UNHANDLED_MODIFIER_EXTENSION`). This check is universal,
 *    every resource type, not only the six safety types.
 * 2. **Retraction surfaced.** A resource marked `entered-in-error` is retracted, not data
 *    (`RETRACTED_RESOURCE`, `information`), surfaced so a consumer cannot silently treat it as active.
 * 3. **The named invariants**, `ait-1`/`ait-2` (AllergyIntolerance), `con-3`/`con-4`/`con-5`
 *    (Condition), `obs-6`/`obs-7` (Observation), hand-evaluated against the model from their exact
 *    R4 FHIRPath (`INVARIANT_VIOLATED`, with the constraint key on the issue). Each expression and
 *    severity is transcribed verbatim from the R4 StructureDefinition; see the per-check notes.
 *    (A general FHIRPath engine is Phase 7, ADR 0002; Phase 3 hand-codes only this safety-critical set.)
 *
 * This layer **surfaces and enforces**; it never reconciles contradictions or infers clinical meaning
 * (roadmap §4, known limitations).
 *
 * @packageDocumentation
 */

import { getProperty, type FhirComplex } from "../model/index.js";
import {
  ALLERGY_VERIFICATION_SYSTEM,
  choicePresent,
  codingsOf,
  CONDITION_CATEGORY_SYSTEM,
  CONDITION_CLINICAL_SYSTEM,
  CONDITION_VERIFICATION_SYSTEM,
  ENTERED_IN_ERROR,
  hasCoding,
  isRetracted,
  primitiveString,
  SAFETY_RESOURCE_TYPES,
} from "../safety/codes.js";
import { unhandledModifierExtensions } from "../safety/status.js";
import { ISSUE_SEVERITIES, validationIssue, type ValidationIssue } from "./issues.js";

/**
 * Collect every safety finding for a resource: fail-closed modifier extensions (universal), the
 * `entered-in-error` retraction note, and the named invariants (for the six safety types).
 *
 * @param resource - The resource model.
 * @param rt - Its resolved `resourceType` (the caller has already established it is present).
 * @returns The value-free safety {@link ValidationIssue}s, in a stable order.
 * @example
 * ```ts
 * import { collectSafetyIssues, parseResource } from "@cosyte/fhir";
 * const { resource } = parseResource('{"resourceType":"Observation","status":"entered-in-error"}');
 * collectSafetyIssues(resource, "Observation"); // → one RETRACTED_RESOURCE issue
 * ```
 */
export function collectSafetyIssues(resource: FhirComplex, rt: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // 1. Fail closed on any modifierExtension we do not understand, every resource type.
  for (const location of unhandledModifierExtensions(resource, rt)) {
    issues.push(validationIssue("UNHANDLED_MODIFIER_EXTENSION", ISSUE_SEVERITIES.ERROR, location));
  }

  if (!SAFETY_RESOURCE_TYPES.has(rt)) return issues;

  // 2. Surface a retracted (entered-in-error) resource, not a defect, but never to be missed.
  if (isRetracted(resource)) {
    const at =
      primitiveString(getProperty(resource, "status")) === ENTERED_IN_ERROR
        ? `${rt}.status`
        : `${rt}.verificationStatus`;
    issues.push(validationIssue("RETRACTED_RESOURCE", ISSUE_SEVERITIES.INFORMATION, at));
  }

  // 3. The named invariants.
  switch (rt) {
    case "AllergyIntolerance":
      checkAllergyIntolerance(resource, issues);
      break;
    case "Condition":
      checkCondition(resource, issues);
      break;
    case "Observation":
      checkObservation(resource, issues);
      break;
    default:
      break;
  }
  return issues;
}

/** Push an `INVARIANT_VIOLATED` issue for a failed constraint at the given location. */
function invariant(
  issues: ValidationIssue[],
  key: string,
  severity: (typeof ISSUE_SEVERITIES)[keyof typeof ISSUE_SEVERITIES],
  expression: string,
): void {
  issues.push(validationIssue("INVARIANT_VIOLATED", severity, expression, key));
}

/**
 * AllergyIntolerance invariants (both `error`).
 *
 * - **ait-1** `verificationStatus.coding.where(system = '…-verification' and code = 'entered-in-error')`
 *   `.exists() or clinicalStatus.exists()`, clinicalStatus SHALL be present unless verificationStatus
 *   is entered-in-error.
 * - **ait-2** `… .empty() or clinicalStatus.empty()`, clinicalStatus SHALL NOT be present when
 *   verificationStatus is entered-in-error.
 */
function checkAllergyIntolerance(resource: FhirComplex, issues: ValidationIssue[]): void {
  const verEIE = hasCoding(
    getProperty(resource, "verificationStatus"),
    ALLERGY_VERIFICATION_SYSTEM,
    ENTERED_IN_ERROR,
  );
  const clinicalPresent = getProperty(resource, "clinicalStatus") !== undefined;
  if (!verEIE && !clinicalPresent) {
    invariant(issues, "ait-1", ISSUE_SEVERITIES.ERROR, "AllergyIntolerance.clinicalStatus");
  }
  if (verEIE && clinicalPresent) {
    invariant(issues, "ait-2", ISSUE_SEVERITIES.ERROR, "AllergyIntolerance.clinicalStatus");
  }
}

/**
 * Condition invariants.
 *
 * - **con-3** (`warning`, best-practice): `clinicalStatus.exists() or verificationStatus.coding`
 *   `.where(system='…condition-ver-status' and code = 'entered-in-error').exists() or`
 *   `category.select($this='problem-list-item').empty()`. R4's literal last disjunct is effectively
 *   vacuous, `category.select($this='problem-list-item')` compares a `CodeableConcept` to a string,
 *   which never matches, so a strict reading makes con-3 never fire, and the official validator
 *   agrees. It is a *best-practice* (`warning`) constraint, and the SD's own explanation is "most
 *   systems will expect a clinicalStatus … for problem-list-items managed over time." We surface that
 *   **intent** as a `warning` (never `error`, so it can never flip `valid`), rather than reproduce a
 *   no-op: a problem-list-item with no clinicalStatus and not entered-in-error draws con-3.
 * - **con-4** (`error`): `abatement.empty() or clinicalStatus.coding.where(system='…condition-clinical'`
 *   `and (code='resolved' or code='remission' or code='inactive')).exists()`, an abated condition's
 *   clinicalStatus must be resolved/remission/inactive.
 * - **con-5** (`error`): `verificationStatus.coding.where(system='…condition-ver-status' and`
 *   `code='entered-in-error').empty() or clinicalStatus.empty()`, clinicalStatus SHALL NOT be present
 *   when verificationStatus is entered-in-error.
 */
function checkCondition(resource: FhirComplex, issues: ValidationIssue[]): void {
  const verEIE = hasCoding(
    getProperty(resource, "verificationStatus"),
    CONDITION_VERIFICATION_SYSTEM,
    ENTERED_IN_ERROR,
  );
  const clinicalStatus = getProperty(resource, "clinicalStatus");
  const clinicalPresent = clinicalStatus !== undefined;

  // con-3 (warning, intent, see note above).
  const problemListItem = hasCoding(
    getProperty(resource, "category"),
    CONDITION_CATEGORY_SYSTEM,
    "problem-list-item",
  );
  if (!clinicalPresent && !verEIE && problemListItem) {
    invariant(issues, "con-3", ISSUE_SEVERITIES.WARNING, "Condition.clinicalStatus");
  }

  // con-4 (error).
  if (choicePresent(resource, "abatement")) {
    const abatedOk = codingsOf(clinicalStatus).some(
      (c) =>
        c.system === CONDITION_CLINICAL_SYSTEM &&
        (c.code === "resolved" || c.code === "remission" || c.code === "inactive"),
    );
    if (!abatedOk) invariant(issues, "con-4", ISSUE_SEVERITIES.ERROR, "Condition.clinicalStatus");
  }

  // con-5 (error).
  if (verEIE && clinicalPresent) {
    invariant(issues, "con-5", ISSUE_SEVERITIES.ERROR, "Condition.clinicalStatus");
  }
}

/**
 * Observation invariants (both `error`).
 *
 * - **obs-6** `dataAbsentReason.empty() or value.empty()`, `dataAbsentReason` SHALL only be present
 *   when there is no `value[x]`.
 * - **obs-7** `value.empty() or component.code.where(coding.intersect(%resource.code.coding).exists())`
 *   `.empty()`, if a component repeats the Observation's own `code`, the top-level `value[x]` SHALL
 *   NOT be present. The R4 `intersect` compares whole `Coding`s (system, version, code, display,
 *   userSelected); we deliberately match on the concept identity `(system, code)` alone. That is a
 *   *narrowing*, it can only ever flag more (a component that repeats the concept but differs in
 *   display/version), never fewer, so it can produce a false `error` but never a false *valid* (the
 *   direction the fail-safe rule forbids). It also tracks obs-7's intent ("don't restate the value
 *   under the same concept") more closely than a display-sensitive equality would.
 */
function checkObservation(resource: FhirComplex, issues: ValidationIssue[]): void {
  const valuePresent = choicePresent(resource, "value");

  // obs-6 (error).
  if (getProperty(resource, "dataAbsentReason") !== undefined && valuePresent) {
    invariant(issues, "obs-6", ISSUE_SEVERITIES.ERROR, "Observation.dataAbsentReason");
  }

  // obs-7 (error).
  if (valuePresent) {
    const obsCodings = codingsOf(getProperty(resource, "code"));
    const component = getProperty(resource, "component");
    const components =
      component === undefined ? [] : component.kind === "list" ? component.items : [component];
    const clash = components.some((comp) => {
      if (comp.kind !== "complex") return false;
      const compCodings = codingsOf(getProperty(comp, "code"));
      return obsCodings.some(
        (a) =>
          a.system !== undefined &&
          a.code !== undefined &&
          compCodings.some((b) => b.system === a.system && b.code === a.code),
      );
    });
    if (clash) invariant(issues, "obs-7", ISSUE_SEVERITIES.ERROR, "Observation.component");
  }
}
