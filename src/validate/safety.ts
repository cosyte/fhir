/**
 * The safety validation layer (the fail-closed status & negation spine).
 *
 * Layered on top of the structural validator, this layer enforces the parts of FHIR that,
 * read wrong, harm a patient. It produces value-free {@link ValidationIssue}s for four
 * things:
 *
 * 1. **Unhandled `modifierExtension` → fail closed.** FHIR's modifier rule (`?!`): a
 *    consumer that does not understand a `modifierExtension` MUST reject the element, it must not
 *    process it as if the modifier were absent. This library understands *no* modifier extensions yet
 *    ({@link ../safety/codes.js} `KNOWN_MODIFIER_EXTENSION_URLS` is empty), so **any** `modifierExtension`
 *    anywhere in the resource is an `error` (`UNHANDLED_MODIFIER_EXTENSION`). This check is universal,
 *    every resource type, not only the six safety types.
 * 2. **A repeated property name → fail closed.** FHIR JSON requires unique property names
 *    (json.html §2.6.2: "Property names SHALL be unique") and expresses a repeating element as an array, so
 *    a name written twice violates a `SHALL` and leaves the element holding two values that RFC 8259
 *    §4 gives no rule for ranking. That is an `error` (`DUPLICATE_PROPERTY`), universal like the
 *    modifier check: a `status` written twice must never validate clean.
 * 2b. **A `0..1` safety element wrapped in an array → fail closed.** FHIR JSON writes a single-valued
 *    element as a name/value pair and reserves the array for a repeating element (json.html §2.6.2.2), so
 *    `{"status":["entered-in-error"]}` is a non-conformant encoding in which a single-value read finds
 *    no code at all. Same `error` posture (`ARRAY_WRAPPED_SCALAR`), and it matters because
 *    array-wrapping every element is ordinary generic XML-to-JSON converter output, the usual route a
 *    C-CDA or v2 feed takes to a FHIR surface.
 * 3. **Retraction surfaced.** A resource marked `entered-in-error` is retracted, not data
 *    (`RETRACTED_RESOURCE`, `information`), surfaced so a consumer cannot silently treat it as active.
 * 4. **The named invariants**, `ait-1`/`ait-2` (AllergyIntolerance), `con-3`/`con-4`/`con-5`
 *    (Condition), `obs-6`/`obs-7` (Observation), hand-evaluated against the model from their exact
 *    R4 FHIRPath (`INVARIANT_VIOLATED`, with the constraint key on the issue). Each expression and
 *    severity is transcribed verbatim from the R4 StructureDefinition; see the per-check notes.
 *    (A general FHIRPath engine is {@link ../fhirpath/index.js}; this layer hand-codes only this
 *    safety-critical set.)
 *
 * This layer **surfaces and enforces**; it never reconciles contradictions or infers clinical meaning
 * (known limitations).
 *
 * @packageDocumentation
 */

import { getAllProperties, getProperty, type FhirComplex } from "../model/index.js";
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
  primitiveStrings,
  safetyCodingsOf,
  safetyHasCoding,
  SAFETY_RESOURCE_TYPES,
} from "../safety/codes.js";
import {
  arrayWrappedScalars,
  nestedArrays,
  shadowedProperties,
  unhandledModifierExtensions,
} from "../safety/status.js";
import { ISSUE_SEVERITIES, validationIssue, type ValidationIssue } from "./issues.js";

/**
 * Collect every safety finding for a resource: fail-closed modifier extensions and repeated property
 * names (both universal), the `entered-in-error` retraction note, and the named invariants (for the
 * six safety types).
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

  // 2. A repeated property name violates FHIR's unique-name SHALL and leaves the element ambiguous.
  // Universal, like the modifier check: it is what stops the validator returning `valid` for a
  // document whose safety-bearing element carries two values.
  for (const location of shadowedProperties(resource, rt)) {
    issues.push(validationIssue("DUPLICATE_PROPERTY", ISSUE_SEVERITIES.ERROR, location));
  }

  // 2b. A `0..1` safety element wrapped in an array is the same fault by a different route: FHIR JSON
  // reserves the array for a repeating element, so the encoding is non-conformant and a single-value
  // read finds nothing in it. Universal like the two above, and for the same reason: it is what stops
  // the validator returning `valid` for a document whose retraction is sitting inside a wrapper.
  for (const location of arrayWrappedScalars(resource, rt)) {
    issues.push(validationIssue("ARRAY_WRAPPED_SCALAR", ISSUE_SEVERITIES.ERROR, location));
  }

  // 2c. A nested array is the same family again and the widest of them: FHIR JSON gives an array of
  // arrays no meaning at any position, so the reader holds what it carried and no element reads a
  // value out of it. Universal like the three above, and needing neither a cardinality table nor a
  // type gate to be certain, since no conformant document contains one. It is what stops the
  // validator returning `valid` for a document whose refutation is sitting one array deep.
  for (const location of nestedArrays(resource, rt)) {
    issues.push(validationIssue("NESTED_ARRAY", ISSUE_SEVERITIES.ERROR, location));
  }

  if (!SAFETY_RESOURCE_TYPES.has(rt)) return issues;

  // 3. Surface a retracted (entered-in-error) resource, not a defect, but never to be missed. The
  // location read matches `isRetracted`'s own fail-safe read over every value written for `status`,
  // so a retraction in a member a repeated name shadowed is still reported at `status`.
  if (isRetracted(resource)) {
    const retractedStatus = getAllProperties(resource, "status").some((node) =>
      primitiveStrings(node).includes(ENTERED_IN_ERROR),
    );
    const at = retractedStatus ? `${rt}.status` : `${rt}.verificationStatus`;
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
  const verEIE = safetyHasCoding(
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
  const verEIE = safetyHasCoding(
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
    const abatedOk = safetyCodingsOf(clinicalStatus).some(
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
    // `Observation.code` is a windowed element (reported), so it reads through a wrapper.
    // `component[i].code` is a backbone element, outside the reporting window, so it stays on the
    // plain read: unwrapping it would resolve a code with no diagnostic anywhere.
    const obsCodings = safetyCodingsOf(getProperty(resource, "code"));
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
