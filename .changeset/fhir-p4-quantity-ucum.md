---
"@cosyte/fhir": patch
---

Phase 4 — Quantity / UCUM fidelity (results & doses). Surface a measured value by the type it actually
is, and its unit by the code a machine may act on. All findings value-free; **no unit is ever
converted** (roadmap §4.6/§4.4).

- **`readObservationValue(observation)`** discriminates the 11-way `Observation.value[x]` choice
  (`valueQuantity` … `valuePeriod`) by the present variant — **never assuming `valueQuantity`**. A
  `valueString` `"POSITIVE"` or a titer `valueRatio` `1:64` is returned as its real type with
  `quantity: undefined`, so it can never be read as a number. `OBSERVATION_VALUE_TYPES` pins the set;
  the reader also works on a `component.value[x]`.
- **The UCUM `code`, not the `unit` string, is the machine unit.** `readQuantity` keeps `code`/`system`/
  `unit`/`comparator`/(exact-decimal) `value` distinct; `validateUcumShape` checks a code's shape
  (case-preserving, bracket-balanced) without asserting membership (no UCUM content bundled). The
  vital-signs required-unit table (`VITAL_SIGN_UNITS`, `requiredVitalSignUnits`) is the FHIR profile's
  closed set.
- **Dose `Quantity`** — `readMedicationDoses` / `locateDoseQuantities` surface
  `Dosage.doseAndRate.doseQuantity` for `MedicationRequest`/`MedicationStatement`, UCUM-shape-checked.
- **`interpretation` and `referenceRange`** preserved and surfaced (`readInterpretations`,
  `readReferenceRanges`) — never used to compute an abnormal flag.
- New issue codes: `UCUM_UNIT_UNRECOGNIZED` (warning — absent/malformed UCUM unit, preserved verbatim),
  `VITAL_SIGN_UNIT_NONCONFORMANT` (error — a vital-signs value whose UCUM code/system the profile forbids,
  compared on the `code`), `VALUE_TYPE_UNEXPECTED` (warning — a vital sign whose value is present but not
  a `Quantity`). `collectQuantityIssues` runs inside `validateResource`. `obs-6` mutual-exclusion is
  already enforced by the Phase-3 safety layer. The vital-signs check fires only for a declared vital
  sign whose LOINC is in the closed table, so it never false-errors legal FHIR.

Still deferred: unit conversion and reference-range evaluation (surfaced, never computed), terminology
binding (Phase 5), profiles (Phase 6), the general FHIRPath engine (Phase 7), XML (Phase 8). A consumer
can trust reads after this phase.
