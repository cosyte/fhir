---
"@cosyte/fhir": patch
---

Refuse to serialize a model whose character data the XML reader dropped, so the
`DROPPED_ELEMENT_TEXT` finding can no longer disappear across a write-and-re-read
(`FHIR-ELEMENT-TEXT-RECOVERY`).

The reporting half (`FHIR-PRIMITIVE-AS-ELEMENT-TEXT`) made `<status>entered-in-error</status>` report
rather than affirm, but left the finding laundering. Measured on `6c5bb02`: `serializeResourceXml`
emitted `<status/>`, whose re-read came back `valid: true`, `safeToSummarize: true`, `droppedText`
empty; and `serializeResource` was worse and had not been recorded at all, emitting
`{"resourceType":"Observation"}` so that a retracted `Observation` re-read as one that had never named
a status. Both writers now throw the new `FhirSerializeError` with
`SERIALIZE_ERROR_CODES.DROPPED_ELEMENT_TEXT`, carrying the bounded FHIRPath `locations` and never the
text it could not encode.

This is a REFUSAL, not the recovery half. Reading the text back as the element's value is a tolerance
for a non-conformant encoding, which meta-repo ADR 0018 permits only when a real publicly-cited
document grounds the shape. A fresh search found the spec text, historical pre-2013 FHIR draft
documents whose format genuinely differed, one hand-authored library test fixture, and no real R4
artifact -- so the recovery half stays unbuilt, and "not grounded, halted" remains the correct outcome
for it.

Scoped to a marked model and nothing else: JSON input has no character-data channel and is untouched,
and a conformant XML document still round-trips byte-for-byte. The wider xml.html §2.6.1 residual is
deliberately not addressed -- a value-absent primitive carrying no extension still emits `<status/>`,
and the `id`-only case is still a violation -- and is pinned by a test rather than a sentence.

Differential vs `6c5bb02` over 1,195 documents: 0 `valid false -> true`, 0 `safeToSummarize false ->
true`, 0 retractions or negations lost, 0 read diagnostics or validation findings lost, 0 newly
throwing, 0 outputs shorter, 0 of 10,797 compared leaf values missing, twin comparand 0 weaker. Bought
360 refusals. The committed differential harness was fixed in the same change: it wrapped
serialization in the reading's own `try`, so a refusal collapsed the whole reading and reported 5,159
phantom leaf losses on the first run.
