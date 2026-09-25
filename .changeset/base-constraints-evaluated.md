---
"@cosyte/fhir": patch
---

`validateResource` now evaluates the constraints R4 itself declares on the eight modeled resource
types, with no profile supplied. Until now those constraints were checked only when a caller passed
a profile carrying them, so a `Patient` whose `contact` had no name, telecom, address or
organization, an extension carrying both a value and nested extensions, or an element with no value
and no children validated `valid: true` with no finding at all.

- On an `AllergyIntolerance`, `Condition`, `DiagnosticReport`, `Immunization`, `MedicationRequest`,
  `MedicationStatement`, `Observation` or `Patient`, a violation of `pat-1`, `obs-3`, `con-1`,
  `con-2`, `imm-1`, `dom-2`, `dom-4`, `dom-5`, `ele-1` or `ext-1` is an `INVARIANT_VIOLATED` finding
  at `error`, carrying the constraint key and located at the violating occurrence. A document that
  breaks one of them, and that used to read `valid: true`, now reads `valid: false`. No finding the
  validator already made moves, and no new code is added.
- `dom-3` holds by its own terms on a resource with nothing contained and draws nothing there. On a
  resource that carries a contained resource it is an `INVARIANT_UNCHECKED` finding at `information`,
  because checking that every contained resource is referenced needs reference resolution the
  bounded FHIRPath subset does not have. A supplied profile whose snapshot carries R4's `dom-3` as
  written, which every R4-derived snapshot does, used to draw that `INVARIANT_UNCHECKED` on every
  resource; with nothing contained it now draws nothing, because the constraint was decided. A
  profile's own expression under that key, written any other way, is still reported unchecked.
- `dom-6` (a narrative SHOULD be present) is a `warning` and is not evaluated without a profile. A
  contained resource is checked only through `dom-2` to `dom-5`. Any other resource type draws none
  of these findings.
- A supplied profile whose snapshot repeats one of these constraints is reported once per
  occurrence, not twice. `collectInvariantIssues`, called directly, returns exactly what it returned
  before.
- FHIRPath `children()` over a primitive now counts the primitive's `id` as well as its extensions,
  matching `id` navigation on the same primitive, so `ele-1` holds on a value-absent primitive that
  carries an `id` and an extension.
