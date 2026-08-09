---
"@cosyte/fhir": patch
---

Read a `status` of `not-done` / `not-taken` wherever a resource writes it, instead of only on an
`Immunization` or a `MedicationStatement`.

Measured at the base commit, on plain conformant JSON:
`{"resourceType":"Procedure","status":"not-done"}` returned `negations: []` and
`safeToSummarize: true`, and so did the same document as a `Communication`, a `Media` and a
`MedicationAdministration`, while the identical `Immunization` returned `negations: ["not-done"]`.
Each of those four is conformant: `not-done` is in the required value set bound to that resource's
`status` in R4. A procedure recorded as not performed read as a procedure with nothing to say about
it.

The gate is dropped rather than widened, and what licenses that is a census rather than the argument
that dropped the previous one. `doNotPerform` is an element no R4 type defines as anything but an
instruction not to act, so reading it anywhere cannot mis-read it. `not-done` is a value of `status`,
one element name whose value set R4 defines per resource type, so "which types carry this code" is a
real question and the direction argument answers a different one. It was answered against the
published R4 definitions (`valuesets.json` and `profiles-resources.json`, `fhirVersion` `4.0.1`):
each code is spelled only as a `status` value and appears in no other binding; every R4 code system
that defines it defines it as the negation (`event-status` and `medication-admin-status` for
`not-done`, `medication-statement-status` for `not-taken`); and the R4 list is `Procedure`,
`Communication`, `Media`, `MedicationAdministration` and `Immunization`, where this library read one.
The same census against R5 returns a different set again and drops `not-taken` entirely, so a list
keyed to one published version is blind by construction on a reader that tolerates others. Only then
does the direction argument apply: the read can only add a negation, never retire a finding and never
flip `valid`. A document spelling the code on a type whose value set excludes it is already
non-conformant, and the fail-safe move over one is to surface the negation the sender plainly wrote
rather than read the record as live.

`not-taken` is the narrower half and is reported as such. The census returns exactly one R4 element
for it, `MedicationStatement.status`, so the old gate was already complete for every conformant
document and dropping it changes nothing on one. What it changes is the non-conformant document -
`{"resourceType":"MedicationAdministration","status":"not-taken"}`, where R4 spells the negation
`not-done`: which is the case this library exists to be honest about. The read is now the one the
retraction already performed, `entered-in-error` off `status` at any type, in one shared function
rather than three copies.

What did not move, each pinned at its literal: the read stays on `status` and on no other element,
and at a resource root rather than a backbone element; the array-wrapper report keeps its
cardinality table, so a wrapped `status` on a type outside the safety set is read through and
surfaced while the wrapper draws no `ARRAY_WRAPPED_SCALAR`; and `noKnownAllergy` stays type-gated,
because it asserts something positive about a patient.

Non-vacuity is by mutation and is recorded as what is held down rather than as a count: each type
gate, reading every written member rather than the first, reading through an array wrapper, the order
the two negations are pushed in, code equality rather than a prefix match, the retraction's `status`
arm, and the element scope. The count is deliberately not the claim, because it overstated what it
measured once already: the first element-scope assertions used `CodeableConcept` values only, so a
widening of the read onto other element names through the same primitive read passed the whole suite.

Two existing tests were re-keyed. Both proved the fail-safe type read with a `not-taken` behind a
wrapped or duplicated `resourceType`, a document that no longer grades that mechanism; one was
falsified outright by this change and the other stayed green with only its negation assertion
hollowed out. Both are keyed to `no-known-allergy` instead, the negation that is still type-scoped,
and both red again under a single-value type read.
