---
"@cosyte/fhir": patch
---

Stop affirming a safety verdict over a FHIR primitive whose value was written as XML element text
(`FHIR-PRIMITIVE-AS-ELEMENT-TEXT`).

FHIR XML carries a primitive's value in the `value` attribute (xml.html §2.6.1: "values of primitive
types in a `value` attribute"), so `<status>entered-in-error</status>` writes a code where the model
has no slot for one. The reader drops the character data, and the element it leaves behind is then
indistinguishable from one the sender legitimately never filled in. That is what let an affirmative
verdict be computed over it.

Measured on `6689239`, and reproduced byte-identically on `09b2805` where the gate first filed it:
`<Observation><status>entered-in-error</status></Observation>` read `retracted: false`,
`safeToSummarize: true`, `negations: []`, `valid: true`, and `assertSafeToSummarize` did **not**
throw; an `AllergyIntolerance` whose `verificationStatus.coding.code` was written as text lost the
`refuted`; and `<doseQuantity><value>5</value><unit value="mg"/><code value="mg"/></doseQuantity>`
lost the **dose number** while its unit and UCUM code survived, so the resource read complete. The
loss was reported (`UNEXPECTED_XML_CONTENT`), so it was never silent, but a retraction that reads as
an affirmation is the sharpest form of this harm.

This is the **REPORTING** half, split on the same line `FHIR-NESTED-ARRAY-REPORTING` was split on: the
text is **not** read back as the element's value. Recovering it would be a _tolerance_ for a
non-conformant encoding, and this project encodes a tolerance only when a real document grounds the
shape (meta-repo ADR 0018). None does, so the preserving half is deliberately not shipped here.

Adds `VALIDATION_CODES.DROPPED_ELEMENT_TEXT` (error, `structure`), `SafetyReadout.droppedText` plus
public `droppedText()`, public `isDroppedText()` on the model, `safeToSummarize: false`, and a
marker-sensitive `nodesEquivalent`. `markDroppedText` is reader-internal and deliberately not
exported. The marker is an inert `droppedText?: true`, carries no content and adds no node-valued
member, so `codingsOf`, the FHIRPath engine, the profile navigator and the terminology walker are
unchanged: the model's edge set is still exactly four members and `test/model-edges.test.ts` derives
that mechanically rather than by grepping.

The reader's own diagnostics are untouched. `DROPPED_ELEMENT_TEXT` is raised **in addition to** the
existing `UNEXPECTED_XML_CONTENT` warning, never instead of it, and no new read-time issue code is
added: the read channel already reported at these positions, which is exactly why this defect was
loud and still harmful. The marker is applied at all **three** sites where the reader observes and
discards character data (`readComplex`, the resource-valued unwrap, the primitive branch of
`buildSingle`), counted in the source and not asserted, because two previous refutations of this
reader were for writing a universal the call sites did not support.

Differential vs `6689239` over **1,195** documents, both trees in one process
(`pnpm differential:read`): **0** `valid: false -> true`, **0** `safeToSummarize: false -> true`,
**0** retractions lost, **0** negations lost, **0**
read diagnostics lost, **0** validation findings lost, **0** newly throwing, **0** outputs shorter,
**0 of 15,956** leaf values missing, and narrative preservation unmoved at 758 of 836. Bought: 360
documents now report, 312 of them previously `valid: true`. The 27 documents whose emitted XML
re-reads differently are `PRE-EXISTING` and unchanged (**0** stable on base).

Also fixes the differential harness's own negative control, which was hard-coded to the _previous_
slice's change. That slice merged, so `origin/main` began carrying it and the control fired on every
run afterwards: a permanent false red on the harness's only alarm, which is worse than no alarm. The
control now names the change under measurement, compares the whole reading rather than only the
serialized JSON (this change moves what the safety layer _says_ without moving any value), and says
in its own text to suspect itself first when it fires.

Known and pinned by tests rather than prose: the finding **launders on a write-and-re-read**, because
`serializeResourceXml` has no conformant way to emit character data on a FHIR element and emits
`<status/>`; and text written beside a value that _did_ arrive
(`<status value="final">entered-in-error</status>`) draws the same refusal, since content the sender
wrote is still missing from the model.
