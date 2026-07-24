/**
 * The Quantity / UCUM validation layer (Phase 4, results & doses fidelity).
 *
 * Layered on the Phase-2/3 validators, this checks the parts of a measured value that harm a patient
 * when read wrong (roadmap §4.6/§4.4). It produces value-free {@link ValidationIssue}s for three things:
 *
 * 1. **UCUM shape.** A `Quantity` that declares the UCUM `system` but whose `code` is absent or
 *    malformed cannot be trusted for machine use → `UCUM_UNIT_UNRECOGNIZED` (`warning`). The value is
 *    preserved verbatim and **never converted**, the library bundles no UCUM content, so it asserts
 *    presence + shape, never membership. A quantity that declares no UCUM system is legal FHIR and is
 *    not flagged (no false error).
 * 2. **Vital-signs required units.** For an Observation (or component) that *is* a table-keyed vital
 *    sign, the FHIR vital-signs profile requires a specific UCUM `code`. A wrong code, or a non-UCUM
 *    `system`, is `VITAL_SIGN_UNIT_NONCONFORMANT` (`error`), compared on the UCUM **`code`**
 *    (case- and bracket-sensitive), never the `unit` string. A vital sign whose value is present but
 *    is **not** a Quantity is `VALUE_TYPE_UNEXPECTED` (`warning`).
 * 3. **Dose units.** `MedicationRequest`/`MedicationStatement` dose quantities are UCUM-shape-checked
 *    the same way (a wrong dose unit is a prescribing hazard).
 *
 * **Never a false error.** The vital-signs check fires only when the element declares the vital-signs
 * category (or the vital-signs profile) **and** its own LOINC code is in the closed required-unit
 * table; anything else is left unchecked rather than wrongly flagged. This layer surfaces and
 * enforces; it never converts a unit or evaluates a reference range (roadmap §4.6 known limitations).
 *
 * @packageDocumentation
 */

import { getProperty, isList, type FhirComplex } from "../model/index.js";
import { locateDoseQuantities } from "../quantity/dose.js";
import {
  LOINC_SYSTEM,
  OBSERVATION_CATEGORY_SYSTEM,
  readQuantity,
  requiredVitalSignUnits,
  UCUM_SYSTEM,
  validateUcumShape,
  VITAL_SIGNS_CATEGORY,
  VITAL_SIGNS_PROFILE,
  type Quantity,
} from "../quantity/ucum.js";
import { readObservationValue } from "../quantity/value.js";
import { codingsOf, hasCoding, primitiveString } from "../safety/codes.js";
import { ISSUE_SEVERITIES, validationIssue, type ValidationIssue } from "./issues.js";

/**
 * Collect every Quantity/UCUM finding for a resource: UCUM shape on Observation values / dose
 * quantities, and the vital-signs required-unit conformance.
 *
 * @param resource - The resource model.
 * @param rt - Its resolved `resourceType`.
 * @returns The value-free Quantity {@link ValidationIssue}s, in document order.
 * @example
 * ```ts
 * import { collectQuantityIssues, parseResource } from "@cosyte/fhir";
 * const { resource } = parseResource(
 *   '{"resourceType":"Observation","category":[{"coding":[{"system":"http://terminology.hl7.org/CodeSystem/observation-category","code":"vital-signs"}]}],' +
 *     '"code":{"coding":[{"system":"http://loinc.org","code":"8480-6"}]},' +
 *     '"valueQuantity":{"value":120,"system":"http://unitsofmeasure.org","code":"mmHg"}}',
 * );
 * collectQuantityIssues(resource, "Observation"); // → one VITAL_SIGN_UNIT_NONCONFORMANT ("mmHg" ≠ "mm[Hg]")
 * ```
 */
export function collectQuantityIssues(resource: FhirComplex, rt: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (rt === "Observation") {
    const vital = isVitalSign(resource);
    checkValueChoice(resource, rt, vital, issues);
    forEachComponent(resource, (component, path) => {
      checkValueChoice(component, path, vital, issues);
    });
    return issues;
  }

  if (rt === "MedicationRequest" || rt === "MedicationStatement") {
    for (const { node, path } of locateDoseQuantities(resource, rt)) {
      checkUcumShape(readQuantity(node), path, issues);
    }
  }

  return issues;
}

/** Whether an Observation declares the vital-signs category or the vital-signs profile. */
function isVitalSign(observation: FhirComplex): boolean {
  if (
    hasCoding(
      getProperty(observation, "category"),
      OBSERVATION_CATEGORY_SYSTEM,
      VITAL_SIGNS_CATEGORY,
    )
  ) {
    return true;
  }
  const meta = getProperty(observation, "meta");
  if (meta === undefined || meta.kind !== "complex") return false;
  const profile = getProperty(meta, "profile");
  if (profile === undefined) return false;
  const items = isList(profile) ? profile.items : [profile];
  return items.some((item) => primitiveString(item) === VITAL_SIGNS_PROFILE);
}

/** Invoke `fn` for each `Observation.component`, with its FHIRPath location. */
function forEachComponent(
  observation: FhirComplex,
  fn: (component: FhirComplex, path: string) => void,
): void {
  const node = getProperty(observation, "component");
  if (node === undefined) return;
  const items = isList(node) ? node.items : [node];
  items.forEach((item, i) => {
    if (item.kind === "complex") {
      fn(item, isList(node) ? `Observation.component[${String(i)}]` : "Observation.component");
    }
  });
}

/**
 * Check the `value[x]` of an Observation or component: UCUM shape on a Quantity value (any
 * observation), plus the vital-signs required-unit / expected-type checks when the element is a
 * table-keyed vital sign.
 */
function checkValueChoice(
  element: FhirComplex,
  path: string,
  vital: boolean,
  issues: ValidationIssue[],
): void {
  const value = readObservationValue(element);
  if (value === undefined) return; // no value[x], nothing to check (dataAbsentReason is obs-6).

  const valuePath = `${path}.${value.property}`;

  // UCUM shape on a Quantity value, every observation, warning-only, preserve-and-flag.
  if (value.type === "Quantity") checkUcumShape(value.quantity, valuePath, issues);

  if (!vital) return;

  // The vital-signs profile requires a specific UCUM code for this element's own LOINC code.
  const required = requiredUnitsFor(element);
  if (required === undefined) return; // not a table-keyed vital sign, left unchecked (no false error).

  if (value.type !== "Quantity") {
    // A vital sign whose value is present but not a Quantity, surface, do not read as a number.
    issues.push(validationIssue("VALUE_TYPE_UNEXPECTED", ISSUE_SEVERITIES.WARNING, valuePath));
    return;
  }

  const q = value.quantity;
  const conformant =
    q !== undefined &&
    q.system === UCUM_SYSTEM &&
    q.code !== undefined &&
    required.includes(q.code);
  if (!conformant) {
    issues.push(
      validationIssue("VITAL_SIGN_UNIT_NONCONFORMANT", ISSUE_SEVERITIES.ERROR, valuePath),
    );
  }
}

/** The vital-signs required UCUM units for an element's own LOINC `code`, or `undefined`. */
function requiredUnitsFor(element: FhirComplex): readonly string[] | undefined {
  for (const coding of codingsOf(getProperty(element, "code"))) {
    if (coding.system === LOINC_SYSTEM && coding.code !== undefined) {
      const units = requiredVitalSignUnits(coding.code);
      if (units !== undefined) return units;
    }
  }
  return undefined;
}

/** Warn when a UCUM-declared quantity's code is absent or shape-invalid (preserve-and-flag). */
function checkUcumShape(
  quantity: Quantity | undefined,
  valuePath: string,
  issues: ValidationIssue[],
): void {
  if (quantity === undefined || quantity.system !== UCUM_SYSTEM) return;
  if (quantity.code === undefined || validateUcumShape(quantity.code) === "invalid") {
    issues.push(
      validationIssue("UCUM_UNIT_UNRECOGNIZED", ISSUE_SEVERITIES.WARNING, `${valuePath}.code`),
    );
  }
}
