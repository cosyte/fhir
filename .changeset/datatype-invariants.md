---
"@cosyte/fhir": patch
---

`validateResource` now evaluates the error-severity constraints R4 declares on its datatypes, with no profile supplied, and its result says whether every rule that applies was checked. An Observation whose `valueQuantity` has a `code` and no `system`, a Period that starts after it ends, or a `referenceRange.low` with a `comparator` used to read `valid: true` with nothing said. Each new finding:

- `INVARIANT_VIOLATED` (error), carrying the key, at every occurrence at any depth (backbone elements, extensions, a primitive's own extensions, contained resources and Bundle entries) for the ten resource types the element model describes: `qty-3` on Quantity, Age, Count, Distance and Duration; `sqty-1` where R4 types an element `SimpleQuantity` (a reference range bound, a Range bound, a dose or rate quantity, a maximum dose, a dispense quantity, `Immunization.doseQuantity`, `SampledData.origin`), whatever a profile lists; `age-1`, `dis-1`, `drt-1`, `att-1`, `cpt-2`, `per-1`, `rng-2`, `rat-1`, `ref-1`, `exp-1`, `drq-1`, `drq-2`, `tim-1`, `tim-2`, `tim-4` to `tim-10`, `trd-1` and `trd-2`. The list is generated from the R4 definitions and held to them by a test.
- `INVARIANT_UNCHECKED` (information) where a constraint could not be evaluated: `cnt-3` on every Count and `trd-3` on every TriggerDefinition, `rng-2` on a Range whose bounds carry different units or no value, and `ref-1` on a bare `#` reference.
- `EXTENSION_UNCHECKED` (information, new code) at every outermost `extension`: no extension definition is applied, so its content is checked only as a base Extension.
- `PROFILE_UNCHECKED` (information, new code) at every `meta.profile` claim that no supplied profile of the resource's type carries.
- A narrative finding that breaches `txt-1` or `txt-2` now carries that key as its `constraint`.

`ValidationResult` gains `fullyChecked`: `true` only for an `AllergyIntolerance`, `Condition`, `DiagnosticReport`, `Immunization`, `MedicationRequest`, `MedicationStatement`, `Observation` or `Patient` with a schema, no `contained` resource, and no finding that says something was left unchecked or unread. It does not count value set membership without a terminology service. FHIRPath evaluation answers `%ucum`.

What a caller sees change: a document that broke a datatype constraint was `valid: true` and is now `valid: false`; a document with an extension or a `meta.profile` claim now carries informational findings that do not change `valid`. A caller that treats every finding as a failure should filter on `severity`; a caller that switches over every `ValidationCode` adds the two new codes. Nothing a caller passes has to change.
