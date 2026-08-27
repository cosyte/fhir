---
"@cosyte/fhir": patch
---

Every resource type this library treats as safety-critical is now checked against its own elements.
`AllergyIntolerance`, `Condition`, `DiagnosticReport`, `Immunization`, `MedicationRequest` and
`MedicationStatement` each gain a complete direct-element table in the built-in schema registry, so
the seven types the safety layer already gates are seven types the structural validator can also
check, rather than one of seven.

Before this change a caller handing `validateResource` any of those six got an informational note
saying the type had no element table, and no structural check of that resource's own elements at
all: no required element, no cardinality, no datatype, no required-binding code check. `Patient` and
`Observation` got all of it. That asymmetry is what closes here, and it closes in the direction that
only ever adds a finding.

The tables are derived from the published R4 4.0.1 StructureDefinitions, and completeness is the
property that matters rather than coverage. The registry treats a registered type as fully
described, so a table missing one element R4 defines would manufacture an unknown-element finding on
a conformant document, and a table stating an optional where R4 states mandatory would turn an
invalid document valid. Both are fail-open. `test/validate-safety-types.test.ts` therefore grades
every table row by row against committed projections of those StructureDefinitions
(`test/__data__/r4-direct-elements.json`, carrying every `snapshot.element` with its cardinality,
datatypes and binding, plus each required-strength code set resolved from the published value-set
bundle): the name set must match in both directions, every minimum, maximum and datatype list must
match, and a deliberately truncated table is asserted to fail the same check. A `choice[x]` is
carried under its `[x]` base with every datatype the choice allows, which is what lets an instance
property `effectiveDateTime` resolve at all.

Nine `code`-typed elements gain their required-strength enumerated binding: `status` on
`DiagnosticReport`, `Immunization`, `MedicationRequest` and `MedicationStatement`, `intent` and
`priority` on `MedicationRequest`, and `type`, `category` and `criticality` on `AllergyIntolerance`.
A `required` binding on a `CodeableConcept` is deliberately NOT carried here.
`Condition.clinicalStatus`, `AllergyIntolerance.verificationStatus` and their siblings are
`required` in R4 and complex-valued, so their membership is a question about a `Coding` inside a
datatype and belongs to the terminology layer; the element is carried with its cardinality and
datatype and its binding is left alone. Elements below a resource's own direct elements are
unchanged too: a backbone element is still checked for cardinality and node shape only, so
`AllergyIntolerance.reaction.severity` keeps its required binding in R4 and draws nothing here.

The base-versus-head read differential moved with it. Its allowance was keyed to `Observation` by
name and is now keyed to the safety-critical set itself, with that set's size and membership
asserted so a type added to it reds the suite rather than silently widening what may move. Neither
direction of its bar moved: no finding may be withdrawn, relocated or reduced in severity, and
`valid` may still go true to false and never false to true. Both halves of the allowance are still
asserted actually exercised, and the corpus gains a `DiagnosticReport` document because it had none,
which would have left one seventh of the widened allowance declared and unreached.

No new validation code and no new issue code: this reports through the vocabulary that already
exists. The safety spine, the set of safety-critical types, and what `readSafety` reports are all
untouched.
