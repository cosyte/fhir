---
"@cosyte/fhir": patch
---

Refuse an array wrapper the XML writer would flatten away, instead of emitting a document the finding
does not survive.

FHIR JSON writes a single-valued element as a name/value pair and reserves the array for a repeating
one (json.html §2.6.2.2), so `{"status":["entered-in-error"]}` is a shape the spec does not define.
The safety layer reports it as an error-severity `ARRAY_WRAPPED_SCALAR` and declines to affirm
`safeToSummarize` over it, because a single-value read finds no string in it at all. FHIR XML spells a
repeat by repeating the element (xml.html) and carries no other mark for one, so a wrapper of fewer
than two items emitted at most one element and the complaint had nowhere to go: that document emitted
`<Observation xmlns="http://hl7.org/fhir"><status value="entered-in-error"/></Observation>` and came
back with `arrayWrappedScalars: []`, `safeToSummarize: true`, `valid: true` and an empty issue list.
Array-wrapping every element is ordinary generic converter output, so the wrapper usually sits on
`resourceType` too, and a wrapped type gate suppresses every type-scoped negation behind it.

The cardinality decision this takes on the write path, stated because it is the whole change: a writer
cannot decide cardinality in general and this one does not try. There is no per-resource model here,
and a name-only rule would emit a false error on a conformant document (`Questionnaire.code` and
`ElementDefinition.code` are `0..*` in R4). So the write path takes its cardinality from the one
window that already has one, the locations the safety layer reports, and raises a new
`SERIALIZE_ERROR_CODES.UNSERIALIZABLE_ARRAY_WRAPPER` inside that window for the wrappers XML cannot
write back as a wrapper: fewer than two items, plus **any** wrapper on `resourceType`, where the type
is the tag and a tag cannot be repeated. A wrapper of two or more items elsewhere is left alone,
because a model read from JSON writes it as repeated elements that re-read as a list, and refusing it
would withdraw a round trip that works today **and keeps the finding**. That is a statement about a
model a reader produced, not about every `FhirComplex` the writer accepts: the check counts items
while the reasoning is about emitted elements, and a hand-built `list([list([]), list([])])` holds two
items and emits none.

Refused rather than reported, because the XML writer returns a string and has no diagnostics channel;
refused rather than repaired, because inventing an XML spelling would author markup nobody wrote.
Raised last, after the refusals beside it, so no case moves onto the new code. `serializeResource`
writes the wrapper back and is the route that stays open.

Still open and stated rather than implied: a wrapper that only a **shadowed** member carried is
dropped by **both** writers, which is the repeated-property-name gap rather than this one; and the
window does not reach `Observation.value[x]`, a `0..1` choice whose wrapper still launders, because
widening it means the per-resource model this library deliberately does not have.
