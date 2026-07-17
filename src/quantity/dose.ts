/**
 * Medication **dose `Quantity`** surfacing (Phase 4). A prescribed or reported dose lives in
 * `Dosage.doseAndRate.dose[x]` — a choice of `doseQuantity` (an amount) or `doseRange`. The
 * `doseQuantity`'s UCUM unit is the same fidelity problem as an Observation value's (roadmap §4.4/§4.6):
 * the machine-actionable unit is the **`code`**, and a wrong or dropped dose unit is a direct
 * prescribing hazard. This module locates the dose quantities so they can be surfaced and UCUM-checked;
 * it **never** converts a dose unit.
 *
 * The `Dosage` list is `dosageInstruction` on `MedicationRequest` and `dosage` on
 * `MedicationStatement` — both are the `Dosage` datatype, so both are walked.
 *
 * @packageDocumentation
 */

import { getProperty, isList, type FhirComplex, type FhirNode } from "../model/index.js";
import { readQuantity, type Quantity } from "./ucum.js";

/** The `Dosage`-list property for each medication resource type (`Dosage` is the shared datatype). */
function dosageProperty(rt: string | undefined): string | undefined {
  if (rt === "MedicationRequest") return "dosageInstruction";
  if (rt === "MedicationStatement") return "dosage";
  return undefined;
}

/** A located `doseQuantity` node: the complex value and its FHIRPath expression for a value-free issue. */
export interface LocatedDoseQuantity {
  /** The `doseQuantity` complex node. */
  readonly node: FhirComplex;
  /** The FHIRPath location, e.g. `MedicationRequest.dosageInstruction[0].doseAndRate[0].doseQuantity`. */
  readonly path: string;
}

/** The node's items when it is a list, the single node wrapped, or `[]` when absent. */
function asItems(node: FhirNode | undefined): readonly FhirNode[] {
  if (node === undefined) return [];
  return isList(node) ? node.items : [node];
}

/**
 * Locate every `doseAndRate.doseQuantity` on a medication resource, with its FHIRPath location.
 * Returns `[]` for a non-medication resource or one carrying no dose quantity. Used by the validator
 * to UCUM-check dose units and by {@link readMedicationDoses} to surface them.
 *
 * @param resource - The resource model.
 * @param rt - Its resolved `resourceType`.
 * @returns The located dose quantities, in document order.
 * @example
 * ```ts
 * import { locateDoseQuantities, parseResource } from "@cosyte/fhir";
 * const { resource } = parseResource(
 *   '{"resourceType":"MedicationRequest","dosageInstruction":[{"doseAndRate":[{"doseQuantity":{"value":5,"code":"mg"}}]}]}',
 * );
 * locateDoseQuantities(resource, "MedicationRequest")[0]?.path;
 * // "MedicationRequest.dosageInstruction[0].doseAndRate[0].doseQuantity"
 * ```
 */
export function locateDoseQuantities(resource: FhirComplex, rt: string): LocatedDoseQuantity[] {
  const property = dosageProperty(rt);
  if (property === undefined) return [];
  const out: LocatedDoseQuantity[] = [];
  asItems(getProperty(resource, property)).forEach((dosage, di) => {
    if (dosage.kind !== "complex") return;
    asItems(getProperty(dosage, "doseAndRate")).forEach((dar, ri) => {
      if (dar.kind !== "complex") return;
      const dose = getProperty(dar, "doseQuantity");
      if (dose !== undefined && dose.kind === "complex") {
        out.push({
          node: dose,
          path: `${rt}.${property}[${String(di)}].doseAndRate[${String(ri)}].doseQuantity`,
        });
      }
    });
  });
  return out;
}

/**
 * Surface every medication **dose `Quantity`** as a {@link Quantity} — the coded UCUM unit kept
 * distinct from the display string, the value an exact decimal. Reads `MedicationRequest`
 * (`dosageInstruction`) and `MedicationStatement` (`dosage`).
 *
 * @param resource - The resource model.
 * @returns The dose quantities in document order (`[]` when none / not a medication resource).
 * @example
 * ```ts
 * import { parseResource, readMedicationDoses, resourceType } from "@cosyte/fhir";
 * const { resource } = parseResource(
 *   '{"resourceType":"MedicationRequest","dosageInstruction":[{"doseAndRate":[{"doseQuantity":{"value":5,"system":"http://unitsofmeasure.org","code":"mg"}}]}]}',
 * );
 * readMedicationDoses(resource, resourceType(resource))[0]?.code; // "mg"
 * ```
 */
export function readMedicationDoses(resource: FhirComplex, rt: string | undefined): Quantity[] {
  if (rt === undefined) return [];
  const doses: Quantity[] = [];
  for (const { node } of locateDoseQuantities(resource, rt)) {
    const q = readQuantity(node);
    if (q !== undefined) doses.push(q);
  }
  return doses;
}
