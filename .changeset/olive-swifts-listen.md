---
"@cosyte/fhir": patch
---

Read a `doNotPerform` wherever a resource writes it, instead of only on a `MedicationRequest` root.

Measured at the base commit, on plain conformant JSON:
`{"resourceType":"ServiceRequest","doNotPerform":true}` and the same document as a
`CommunicationRequest` both returned `negations: []`, `doNotPerform: undefined`,
`safeToSummarize: true` and `assertSafeToSummarize` clean, while the identical `MedicationRequest`
returned `negations: ["do-not-perform"]`. R4 flags `doNotPerform` `?!` on each request resource that
defines it (`medicationrequest.html`, `servicerequest.html`, `communicationrequest.html`), and a
modifier element is the one class a consumer may never process as if it were absent. An instruction
not to perform a service read as no instruction at all, and the readout affirmed the record was safe
to summarise. This needed neither an XML round trip nor a value outside the datatype's lexical space,
which is what separates it from the two boolean defects before it: it is conformant JSON, read wrong.

The remedy is at the read, and the type gate is dropped rather than widened. A longer list of
remembered types is the same mechanism, and the mechanism is the defect: a gate does not merely fail
to read the types it omits, it never looks, so nothing is reported for them either. What makes
dropping it safe is the direction rather than a census of R4 - this read can only ADD the
`do-not-perform` negation, never retire a finding, never flip `valid`, and never turn a refusal into
an affirmation. It is the same asymmetry that already leaves the `entered-in-error` retraction and the
`refuted` verification status un-gated, and the opposite of `noKnownAllergy`, which stays type-gated
because it asserts something positive about a patient.

The second axis is the same blindness through depth. The read visited only the resource `readSafety`
was handed, so a conformant `MedicationRequest` in a `Bundle.entry` returned `negations: []` while its
unreadable twin at that same location was already reported: the library was strictly more honest about
a value it could not read than about one it could. The negation is now read at every resource root the
walk visits, which is the window that reports the unreadable half, so a `contained` or `Bundle.entry`
resource reaches `negations`. The read and the refusal are decided in one function, at one window, so
they cannot drift into a state where a sender's instruction is neither surfaced nor reported.

`safeToSummarize` does not move for a value that is read, and that is the contract rather than an
omission: a refusal is for a value this library cannot read, and a value it can read is surfaced on
`negations` with nothing lost. Where the value cannot be read the location is on `unreadableBooleans`
on the new types exactly as it already was on `MedicationRequest`.

What did not move, each pinned at its literal: `SafetyReadout.doNotPerform` stays the root read, like
`status` beside it, so a nested resource's instruction reaches `negations` and leaves that field
`undefined`; the array-wrapper report keeps its cardinality table, so a `ServiceRequest.doNotPerform`
arriving array-wrapped is read through the wrapper and surfaced while the wrapper itself is not
reported; the scope stops at resource roots, not backbone elements; and `not-taken` / `not-done` keep
their own type gates, where `not-done` is also a `Procedure` / `MedicationAdministration` status in R4,
so the same blindness exists there and is a declared gap rather than part of this change.

A count that was wrong in the same area is cut rather than corrected: `readSafety`, `SafetyReadout`,
`SAFETY_RESOURCE_TYPES`, the validator's safety layer and the README all said "the six safety resource
types" over a set holding seven, and three of those copies rendered into each of the published type
declaration files (measured at the base commit; zero at head). Derive it from the set; the number is
written down nowhere now.

Measured: 15 of 23 new assertions red at the base commit in a real base worktree (23 of 23 at head),
and non-vacuity proved by seven mutations of the fix, each reddening at least one. The 8 assertions
that pass in BOTH states clear nothing about the fix and are labelled as such in the test file rather
than counted here. The corpus is hand-authored JSON and XML fixtures
and hand-built probes, not the FHIR R4 published-examples corpus.
