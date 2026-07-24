/**
 * Quantity / UCUM fidelity for results and doses (Phase 4, the P0 safety spine's third strand).
 *
 * Three things a machine can silently get wrong on a measured value, surfaced here so it cannot:
 *
 * - **`Observation.value[x]` is an 11-way choice.** {@link readObservationValue} branches on the
 *   variant actually present ({@link ./value.js}), never assuming `valueQuantity`, so a
 *   `valueString` of `"POSITIVE"` or a titer `valueRatio` is not read as a number.
 * - **The unit that matters is the UCUM `code`, not the `unit` string.** {@link readQuantity} keeps
 *   them distinct and {@link validateUcumShape} shape-checks the code ({@link ./ucum.js}); the
 *   **vital-signs required-unit table** ({@link VITAL_SIGN_UNITS}) is the spec's closed set. No unit is
 *   ever converted.
 * - **Doses carry the same hazard.** {@link readMedicationDoses} surfaces `Dosage.doseAndRate.doseQuantity`
 *   for `MedicationRequest`/`MedicationStatement` ({@link ./dose.js}).
 *
 * The matching *validation* side ({@link ../validate/quantity.js}, reached through `validateResource`)
 * emits `UCUM_UNIT_UNRECOGNIZED`, `VITAL_SIGN_UNIT_NONCONFORMANT`, and `VALUE_TYPE_UNEXPECTED`.
 */

export {
  LOINC_SYSTEM,
  OBSERVATION_CATEGORY_SYSTEM,
  readQuantity,
  requiredVitalSignUnits,
  UCUM_SYSTEM,
  validateUcumShape,
  VITAL_SIGN_UNITS,
  VITAL_SIGNS_CATEGORY,
  VITAL_SIGNS_PROFILE,
} from "./ucum.js";
export type { Quantity, UcumShapeVerdict } from "./ucum.js";
export {
  OBSERVATION_VALUE_TYPES,
  readInterpretations,
  readObservationValue,
  readReferenceRanges,
} from "./value.js";
export type { ObservationReferenceRange, ObservationValue, ObservationValueType } from "./value.js";
export { locateDoseQuantities, readMedicationDoses } from "./dose.js";
export type { LocatedDoseQuantity } from "./dose.js";
