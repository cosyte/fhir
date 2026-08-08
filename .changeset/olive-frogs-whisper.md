---
"@cosyte/fhir": patch
---

Refuse a member a repeated property name shadowed, in both writers, instead of dropping it.

FHIR JSON requires unique property names (json.html §2.6.2) and RFC 8259 §4 leaves the winner
undefined, so this library reads first-wins, keeps the shadowed member on `FhirComplex.duplicates`,
raises an error-severity `DUPLICATE_PROPERTY` in validation and refuses to affirm `safeToSummarize`.
**All three are findings about the input.** Each writer walks the surviving members only, so each
emitted one member per name and that output was a different document carrying none of them.

Measured at the base commit,
`{"resourceType":"Observation","status":"final","status":"entered-in-error"}` emitted
`{"resourceType":"Observation","status":"final"}` and
`<Observation xmlns="http://hl7.org/fhir"><status value="final"/></Observation>`. Both re-read with
an empty issue list, `valid` and `safeToSummarize` both moving `false` to `true`, and
`negations: ["entered-in-error"]` becoming `[]`. The retraction is in neither output, and which
member is lost depends only on the order the sender wrote them in. That is the duplicate-key
retraction defect this library already closed on the read path, re-opened one layer later.

Both writers now raise a new `SERIALIZE_ERROR_CODES.UNSERIALIZABLE_SHADOWED_PROPERTY`, value-free and
carrying bounded locations, as a whole-model pre-pass.

Refusing rather than handing both members back, and that is measured rather than argued: `JSON.parse`
resolves a repeated name last-wins where this library reads first-wins, so on the mirror spelling
`{"status":"entered-in-error","status":"final"}` the model holds the retraction and `JSON.parse`
returns `"final"`. Emitting both members would hand every other consumer the member this one calls
shadowed, which is the writer authoring a different clinical answer. FHIR XML can repeat an element,
but two repeated elements re-read as a list, a repeating element the sender never wrote.

The window is `shadowedProperties`, the same call `validateResource` raises its error from and the
same one `readSafety` requires empty, rather than a second traversal that could drift from either. So
a model refused here already reads `valid: false` with `safeToSummarize: false`: nothing that reads
clean stops serializing. Raised last in both writers, so a model that trips two keeps the code it
already reported.

The location's root SEGMENT is derived per call site and is not shared, a pre-existing and
already-declared divergence that is not this window's to close.

Deliberately not closed, and measured rather than implied. A repeated name inside a primitive's
`_`-sibling is not modeled at all, so there is nothing to refuse. One inside a complex sitting in a
primitive's `extension` is modeled and is still dropped by both writers; it is left rather than
refused because that document reads `valid: true` with `safeToSummarize: true`, so refusing it would
withdraw a round trip from a model this library reports as clean.

The axis of each count, because one is vacuous by construction: 0 of 1,195 readings moved is the XML
read differential, which cannot grade this class at all, since the XML reader has no duplicates
mechanism and no document in that corpus carries a shadowed member; 0 of 33 fixtures newly refused is
this repo's 26 JSON and 7 XML hand-authored fixtures through both writers; and 0 false positives over
2,480 documents is a generated grammar of 8 root pairs by 10 value shapes by 3 placements, which is
not the whole window. None is the FHIR R4 published-examples corpus.
