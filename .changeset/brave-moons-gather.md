---
"@cosyte/fhir": patch
---

Read every negation at every resource root, instead of reading all but one only at the resource
handed in (`FHIR-NEGATION-READ-SCOPE-RESIDUALS`).

Measured at the base commit, on plain conformant JSON: a collection `Bundle` whose single entry is
`{"resourceType":"Observation","status":"entered-in-error"}` returned `negations: []` under
`safeToSummarize: true` with `assertSafeToSummarize` clean, and so did the same Bundle carrying a
`Procedure` with `status: "not-done"`, a `MedicationStatement` with `status: "not-taken"` or a
refuted `AllergyIntolerance`, and so did a `Patient` carrying any of them in `contained`. The
identical Bundle carrying an order with `doNotPerform: true` returned
`negations: ["do-not-perform"]`, that one negation having been moved onto the walk by the change
before this one. A retracted record and a procedure recorded as not performed read as a document with
nothing to say about them, and a `Bundle` is the container the standard defines for carrying
resources. This needs neither a non-conformant value nor a wire-format quirk: it is conformant JSON,
read wrong.

What licenses reading a nested resource is FHIR's modifier rule, not the depth. Every element moved
here is one R4 flags `?!` - `status` (the `entered-in-error` retraction and the `not-done` /
`not-taken` negations), `verificationStatus` (the retraction and `refuted`), and `doNotPerform` - and
a consumer may never process a modifier element as if it were absent. That obligation attaches to the
resource carrying it, not to the position the resource occupies in a document: a `Bundle.entry` order
and a `contained` order are resources. Only then does the direction argument apply, exactly as it
does at the entry root: the read can only ADD a negation, never retire a finding, never flip `valid`,
and never turn a refusal into an affirmation.

The read is not widened past its refusal. The four channels that record a safety value this library
could NOT read - dropped XML element text, an array inside an array, a shadowed property name, an
array-wrapped scalar - already covered at least every location this read moved into, so the refusal
window was and remains no narrower than the read. Both halves are pinned at one nested location: a
`<status>not-done</status>` whose character data the reader drops is reported there and adds no
negation, and a `<status value="not-done"/>` at that same location is read. The reads themselves are
unchanged and are the ones the readout already performed at the entry root, called on more nodes
rather than rewritten, so no document's reading moves - only the set of nodes the reading is applied
to. The cardinality report and the negation reads are now reached through one function, so "which
nodes are resource roots" is decided in one place for both.

What did not move, each pinned at its literal: `negations` is the only field that answers about the
whole document, and `retracted`, `status`, `doNotPerform` and `noKnownAllergy` stay root reads - a
`Bundle` is not retracted because one of its entries is, so `retracted` implies `entered-in-error` is
on `negations` and never the other way round. The classified list is a set in a fixed order, so a
kind appears once however many resources assert it and entry order does not decide the order. The
scope stops at resource roots, so a `status` on `Procedure.performer` and a `doNotPerform` on
`Dosage` are read by nothing. The array-wrapper report keeps its cardinality table, so a wrapped
`status` on a type outside the safety set is read through and surfaced at a nested location while the
wrapper draws no `ARRAY_WRAPPED_SCALAR`.

`no-known-allergy` deliberately does not move, and it is the one negation whose absence is the
cautious answer. It is read off `AllergyIntolerance.code`, an element R4 does not flag `?!` at all,
so the modifier rule does not reach it; and it runs the other way from every negation on the walk,
because surfacing a recorded "no known allergy" from somewhere inside a document can make a caller
LESS careful about a patient, while leaving it unsurfaced reads as unknown. It stays the root,
type-scoped read, declared and pinned in both states rather than claimed.

Measured: 21 of 31 new test cases red at the base commit in a real detached base worktree (31 of 31
at head), and the 10 that pass in both states are named in the test file rather than counted here.
Non-vacuity is by mutation, and is recorded as what is held down rather than as a total: the four
status and coding reads at the walk's window, the walk window itself, `retracted` staying the root
read, `no-known-allergy` staying off the walk, the fixed kind order, the de-duplication, the
resource-root boundary, the absence of a type gate on the nested read, and reading every written
member rather than the first. Two characterization tests over the gap this closes were re-keyed, and
the reason is recorded in each rather than the assertion quietly narrowed. The corpus is
hand-authored JSON and XML fixtures and hand-built probes, not the FHIR R4 published-examples corpus.
