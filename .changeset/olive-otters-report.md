---
"@cosyte/fhir": patch
---

Report a `Coding` array wrapper wherever the negation read decided on one, instead of only on the
resource types the cardinality table knows.

Measured at the base commit, on plain JSON:
`{"resourceType":"ServiceRequest","verificationStatus":{"coding":[{"code":["refuted"]}]}}` resolved
`refuted` **through** the single-position array wrapper -- a shape FHIR JSON does not define -- and
handed it back under `arrayWrappedScalars: []`, `safeToSummarize: true`, `valid: true`, with no
diagnostic anywhere saying the value had come out of one. The multi-position twin is the sharper
half and runs the other way:
`{"…","verificationStatus":{"coding":[{"code":["entered-in-error","x"]}]}}` is deliberately left
**unread**, because `system` and `code` feed a cross-product and taking more than one value on
either side would pair values the sender wrote in different positions and assert a coding it never
wrote. So the retraction was neither surfaced nor reported, and the readout affirmed
`safeToSummarize: true` over a value the library knowingly declined to read. Both hold at every
resource root, inside `contained` and a `Bundle.entry`, and at an entry root carrying no readable
type at all.

The read had escaped the report. The negation reads are not type-scoped -- a gate that never looks
reports nothing, indistinguishably from a clean read -- while the `Coding`-level wrapper report was
still riding the type-scoped cardinality table. The library's own rule is that the read window and
the report window are one window, and the module said so about itself while it was not true.

The remedy is at the report, not at the read: not one value read differently, and nothing narrowed.
The wrapper report for the elements the negation read resolves through a `Coding` now runs at every
resource root of any type, decided in the same loop over the same table the read is made from, so
the two cannot come to cover different elements. Both halves that decide a wrapper at a root now
share one de-duplicating callback, so a location a caller can act on once still arrives once. The
locations reach `SafetyReadout.arrayWrappedScalars`, `arrayWrappedScalars()`, an
`ARRAY_WRAPPED_SCALAR` error, `safeToSummarize: false`, `assertSafeToSummarize` throwing, and the
XML writer's refusal to spell back a wrapper it cannot write.

What licenses dropping the type scoping here is **datatype** cardinality, and it is a different
argument from the three that preceded it in this area, none of which transfers: `Coding` is a
datatype whose `system` and `code` are `0..1` *wherever a `Coding` appears*, so an array at either is
non-conformant whatever resource carries it and whatever the enclosing element's own cardinality is.
No question about the enclosing resource arises, so no per-resource model is needed and none is
grown. That is exactly what is **not** true of the element names one level up, where R4 really does
define repeating elements under the same names (`Questionnaire.code`, `ElementDefinition.code`, both
`0..*`), which is why that half keeps its type scoping.

What did not move, each pinned at its literal in both states rather than described: the element-level
wrappers stay on the cardinality table, so `{"resourceType":"ServiceRequest","doNotPerform":[true]}`
and `{"resourceType":"Procedure","status":["not-done"]}` are still read through and surfaced with no
`ARRAY_WRAPPED_SCALAR` -- reporting one is an `error`, and closing it needs a cardinality for those
element names on the types outside the table, which is a different question and gets its own change.
A `Coding` wrapper at a `code`-typed `status` draws nothing, because nothing reads through it and a
report wider than the read is this defect inverted. `clinicalStatus` and a "no known allergy" `code`
on a type outside the table draw nothing, their reads being type-scoped; `no-known-allergy` stays
root- and type-scoped on purpose, being the one negation whose surfacing makes a caller *less*
careful. `Questionnaire.code` is untouched. A `verificationStatus` below a resource root is untouched.
A conformant document reads exactly as before, and no public API is added or changed.

Three prose claims the package shipped about itself were false and are corrected rather than
qualified: `unreadableBooleans` and `nearMissNegationCodes` each stated their window "is
`arrayWrappedScalars`' window", which it was not while that report was type-scoped and they were not,
and the `Coding` unwrap's own note asserted read scope already equalled report scope. An older entry
claiming the resulting asymmetry "survives on purpose" is cut, not annotated.

Measured: **11 of 24 new cases red at the base commit** in a real detached base worktree, 24 of 24 at
head; one further case is red at base only because the read table has no `codings` field there, and
is reported separately rather than counted as behaviour. **11 both-states pins, named in the test
file**, not counted in a total. Nine mutations, none surviving, named rather than totalled: dropping
the table flag, inverting it, re-gating the report on resource type, giving the negation half its own
de-duplication, reporting only single-position wrappers, reporting only multi-position ones, dropping
the XML-unwritable half, reading only the first written member, and running the report for every row
regardless of the flag. The read differential moved 0 readings with 0 `valid` false-to-true and 0
`safeToSummarize` false-to-true, and that 0 is **vacuous by construction**: no corpus document
carries an array-wrapped `Coding` member, so none reaches the changed code. The fixtures are
hand-authored, plus mutations and probes -- **not** the R4 published-examples corpus. All values are
synthetic.
