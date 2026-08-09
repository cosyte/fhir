# The `not-done` / `not-taken` type gates were dropped, after a census (2026-08-09)

Relocated narrative for the `agent-notes.md` section of the same name. Base commit `f8d7213`, the
head of the slice that dropped the `doNotPerform` type gate
([`negation-read-scope.md`](negation-read-scope.md)). Closes the first of that slice's declared
residuals.

## What was measured, before anything was changed

Plain conformant JSON, on the base commit:

```
{"resourceType":"Immunization",            "status":"not-done"}  ->  negations: ["not-done"]
{"resourceType":"Procedure",               "status":"not-done"}  ->  negations: []  safeToSummarize: true
{"resourceType":"Communication",           "status":"not-done"}  ->  negations: []  safeToSummarize: true
{"resourceType":"Media",                   "status":"not-done"}  ->  negations: []  safeToSummarize: true
{"resourceType":"MedicationAdministration","status":"not-done"}  ->  negations: []  safeToSummarize: true
{"resourceType":"MedicationAdministration","status":"not-taken"} ->  negations: []  safeToSummarize: true
```

Every one of the four blind rows is a **conformant R4 document**: `not-done` is in the required
value set bound to that resource's `status`. A procedure recorded as **not performed** read as a
procedure with nothing to say about it, under an affirmative `safeToSummarize`.

## 🛑 The argument that licensed the previous drop DOES NOT TRANSFER, and that was the whole slice

`doNotPerform` is an **element**. No R4 type defines it as anything but an instruction not to act, so
reading it on a type nobody enumerated cannot mis-read it, and the direction alone (a read that can
only **add** a negation) licenses dropping the gate.

`not-done` is a **value of `status`**: one element name whose value set R4 defines **per resource
type**. "Which types carry this code" is therefore a real question with a real answer, and the
direction argument answers a different one. So the gate was not dropped by analogy. It was dropped
after a census, and the census is what the drop rests on.

## The census, and how to re-run it

Source: the published R4 definitions, `hl7.org/fhir/R4/valuesets.json` (sha256
`8d8fd0894624163296aa84e93c47cbead9b805fd83ec22ac71d45b7e25a86758`) and
`profiles-resources.json` (sha256
`d062516a420265da6d248e1d2b5d2a4aa9709c3c637807fe48e278054dffa114`), `fhirVersion` **4.0.1**. Method:
every `CodeSystem` in the bundle whose concept tree defines the code, then every element in every
resource `StructureDefinition` whose binding names a value set that includes it (following
`compose.include`, whole-system includes and nested `valueSet` references).

| | `not-done` | `not-taken` |
|---|---|---|
| R4 code systems defining it | `event-status`, `medication-admin-status` | `medication-statement-status` |
| R4 elements bound to a value set containing it | `Procedure.status`, `Communication.status`, `Media.status`, `MedicationAdministration.status`, `Immunization.status` | `MedicationStatement.status` |
| binding strength / cardinality | `required`, `1..1`, every one | `required`, `1..1` |
| what this library read | `Immunization` only | `MedicationStatement` only |

Three facts came out of it, and together they are the licence:

1. **Each code is spelled only as a `status` value.** No R4 element outside `status` binds a value
   set containing either code, so a wider read cannot meet the code doing a different job elsewhere.
2. **Every code system that defines the code defines it as the negation**: "terminated prior to any
   activity beyond preparation" (`event-status`), "terminated prior to any impact on the subject"
   (`medication-admin-status`), "the medication was not consumed by the patient"
   (`medication-statement-status`). So reading the code on a type nobody enumerated cannot *mis*-read
   it; it can only surface it somewhere a census did not predict.
3. **A gate is short, and version-scoped.** R4 carries `not-done` on five types where this library
   read one. The same census against R5 (`5.0.0`) returns a different set again: it adds
   `ClinicalImpression`, `NutritionIntake` and `DeviceUsage`, has no `Media` resource at all, and
   **drops `not-taken` from `MedicationStatement.status` entirely**: on documents a reader with R5
   read-tolerance is still handed. A list keyed to one published version is blind by construction.

Only then does the direction argument apply, exactly as it did to the element: the read can only add
a negation, never retire a finding, and never flip `valid` (nothing in the validator reads
`negations`). A document spelling the code on a type whose value set excludes it is **already
non-conformant**, and the fail-safe move over one is to surface the negation the sender plainly
wrote, not to read the record as live.

**⚠ Two nuances the census turned up, disclosed rather than smoothed over. Both are R5, and both are
why the claim in the code is scoped to R4:**

- R5 defines `not-done` in `consent-state-codes` with the display **"Abandoned"** ("the consent
  development has been terminated prior to completion"). Still not-happened, so still the safe
  direction, but it is the one place where the code's *display* is not a negation on its face.
- **The "only as a `status` value" half is version-scoped too, exactly as the type list is.** In R5,
  `DeviceUsage.usageStatus` binds a value set containing `not-done` and is not named `status`, so it
  is the one element outside `status` that carries the code anywhere in either version. This read
  does not look there, which is an **under**-read (the safe direction, a negation not surfaced rather
  than one invented), and it is stated here rather than left as an implication of an R4-only census.

## `not-taken` is the narrower half, and is reported as such rather than dressed up

The census returns exactly one R4 element for `not-taken`, which is the type the gate already named.
**So the old gate was complete for every conformant document, and dropping it changes nothing on
one.** What it changes is the non-conformant document the item quoted -
`{"resourceType":"MedicationAdministration","status":"not-taken"}`, where R4's conformant spelling is
`not-done`. That is the case this library exists to be honest about: a sender who wrote "not taken"
on a medication administration, and a readout that called the record live.

Dropping it also removes the last reason to keep two mechanisms. The read is now
`codes.ts` `statusSpells`, **the read `isRetracted` already performed for `entered-in-error`** (the
same shape of code, on the same element, at the same root scope), so the three cannot drift apart
over which values of `status` they see.

## Measurement

- **Red-at-base 11 of 22** in a real detached base worktree at `f8d7213`; 22 of 22 at head. **11
  both-states pins**, named in the test file itself rather than in a commit message.
- **Non-vacuity by mutation, stated as WHAT IS PINNED rather than as a total.** Method: mutate one
  real behaviour of the read away, run the whole suite, and require at least one assertion to red.
  Held down this way, each named: the type gate on `not-done` (reds 11); the type gate on `not-taken`
  (2); reading every written member rather than only the first (9); reading through an array wrapper
  (9); the order the two negations are pushed in (1); code equality rather than a prefix match (1);
  the retraction's `status` arm, which is the refactor's cover (25); and **the element scope, which
  needed two rounds and is the reason a total is not the claim here.**
  **🛑 A MUTATION TOTAL OVERSTATES WHAT IT MEASURES, AND DID.** "8 of 8" was published while the
  element-scope assertions used `CodeableConcept` values only: they discriminated a widening through
  the *coding* reader, so the whole primitive widening
  (`["status","code","statusReason","category"]` inside `statusSpells`) passed the entire suite. The
  gate found it. The primitive-shaped twins were added, and the minimal one-token widening
  (`["status","code"]`) now reds. **Name the list, not the count** - the count was wider than the
  thing it measured, which is this repo's recurring error in a new place.
- Suite 66 files / 1,369 tests -> 67 / 1,391: the new file, and **no existing test moved except the
  three characterization pins over the old gate**, which this closes and therefore rewrites.
- Negative control: all 22 assertions **fail** against `@cosyte/hl7`.

## 🛑 Two tests were re-keyed, and the two reasons are DIFFERENT

Both proved the fail-safe type read with a `not-taken` behind a wrapped or duplicated `resourceType`,
and that negation is no longer type-scoped, so neither document grades that mechanism any more. What
each did about it was not the same, and the distinction was got wrong once here before the gate
corrected it:

- `test/xml-array-wrapper.test.ts` was **falsified outright**: it asserted `negations: []` for a
  laundered `<Resource><status value="not-taken"/></Resource>`, which now reads `["not-taken"]`. It
  was red at head, not vacuous.
- `test/array-wrapped-scalar.test.ts` stayed **green**, but its *negation* assertion no longer
  depended on the type read; the `resourceType` and `arrayWrappedScalars` assertions beside it still
  did, so the test was partly hollowed rather than wholly vacated.

Both are re-keyed to `no-known-allergy`, the negation that **is** still type-gated, and both red
again under a `typesOf` reduced to a strict single-value read. Leaving them keyed to a status code
would have left green tests claiming to grade a mechanism they no longer touch, which is the failure
mode this repo has hit from the other direction twice.

## Declared, NOT folded in - each its own slice

- **Still root-only.** `{"resourceType":"Bundle",…,"entry":[{"resource":{"resourceType":"Procedure",
  "status":"not-done"}}]}` leaves the Bundle's `negations` empty, exactly as a nested retraction
  does. Only `doNotPerform` reads at every resource root. Pinned.
- **The array-wrapper report keeps its cardinality table.** `{"resourceType":"Procedure","status":
  ["not-done"]}` is read through the wrapper and the negation surfaced, but the wrapper draws no
  `ARRAY_WRAPPED_SCALAR` on a type outside `SAFETY_RESOURCE_TYPES`. Strictly better than base, which
  read nothing and reported nothing. Pinned, with the `Immunization` half as the both-states control.
- **The read is at the resource root, not a backbone element.** `Procedure.performer[0].status`
  reads nothing. Pinned.
- **No value-set validation.** This library surfaces the code; it does not check the code against the
  binding, so it does not *report* `{"resourceType":"Patient","status":"not-done"}` as
  non-conformant, it merely surfaces the negation. Making that a diagnostic needs the per-resource
  model this layer must not grow.
- `PRE-EXISTING`, untouched: `src/safety/codes.ts` still publishes a **set size** into
  `dist/index.d.ts`.

**CORPUS CAVEAT on every zero above:** the fixtures are hand-authored plus mutations and probes, not
the R4 published-examples corpus. The census is over the published R4 *definitions*, which is a
different artifact from a corpus of instances.
