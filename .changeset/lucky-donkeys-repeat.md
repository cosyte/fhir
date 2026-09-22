---
"@cosyte/fhir": patch
---

An array wrapper around an `Observation.value[x]` choice is reported on a stable code and refused by
the XML writer, so a dose that reads as unreadable in JSON is no longer laundered into a confident
number by one write and one re-read.

The shape is ordinary generic XML-to-JSON converter output, which is how a C-CDA or v2 feed reaches
a FHIR surface in practice, so it is not exotic input.
`{"resourceType":"Observation","status":"final","valueQuantity":[{"value":5,"system":"http://unitsofmeasure.org","code":"mg"}]}`
read with the variant reported and `quantity` undefined, which fails safe as far as it goes: no
wrong number was handed out. What was missing was any record that the position held content nothing
would read, and a present variant with no magnitude is indistinguishable from a `valueQuantity` that
carried no `value` at all. Written as FHIR XML and read back, it was an unambiguous 5 mg under
`valid: true` with an empty issue list.

Three things close it, and they share one window. `validateResource` raises `ARRAY_WRAPPED_CHOICE`,
a new published validation code, at error severity and at the choice's own location.
`readObservationValue` carries that same code on the new `ObservationValue.encodingIssue` field, the
issue channel the value readout did not have, so a caller switching on the readout and a caller
reading the issue list see one vocabulary. `serializeResourceXml` refuses on
`UNSERIALIZABLE_CHOICE_WRAPPER`, a new serialize error code, rather than emitting a document whose
re-read is missing the report.

The cardinality comes from the value readout's own walk over the eleven `value[x]` variant names, at
the two positions R4 spells that choice, `Observation.value[x]` and `Observation.component.value[x]`,
both `0..1` (observation.html), at every Observation resource root including one in `contained` or a
`Bundle.entry`. That is not a wider window on the existing element-level wrapper rule and not a
per-resource cardinality table: `arrayWrappedScalars` is unchanged, still reports nothing here, and
`safeToSummarize` does not move. One call produces the locations and all three consumers read it, so
the report, the readout's channel and the refusal cannot drift apart.

Two bounds are deliberate. A wrapper of two or more items is written, not refused: FHIR XML spells a
repeat by repeating the element, so it round-trips byte-exactly and the re-read raises the report
again, and refusing it would withdraw a round trip that works and keeps the finding. And nothing is
read out of the wrapper, at any arity: picking a member would author a magnitude the sender spelled
ambiguously, which is inventing content rather than tolerating form. The refusal is raised last of
the seven, so a document that already trips another keeps the code it had.

`serializeResource` is untouched and that route stays open. The unbound-prefix round-trip residual
this phase also covers is not taken here and stays open with its own remedy.
