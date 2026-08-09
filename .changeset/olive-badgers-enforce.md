---
"@cosyte/fhir": patch
---

The profile loader reads an `ElementDefinition.min` the XML reader kept as lexical text, so an
XML-sourced profile's required elements are enforced instead of silently ignored
(`FHIR-XML-WRITE-RESIDUALS`).

FHIR XML carries every primitive as the text of its `value` attribute (`xml.html` 2.6.1), and the
reader is schema-free by design: with no `StructureDefinition` in hand it never guesses a datatype,
so `<min value="1"/>` lands as the string `"1"` where FHIR JSON's `"min": 1` lands as a number. That
much is a declared limit and it is not what changed.

What changed is the read. Measured at the base commit against a profile whose snapshot states
`Observation.subject 1..1` and `Observation.performer 2..*`, and an `Observation` carrying neither:
the JSON spelling of that profile returned `valid: false` with a `CARDINALITY_MIN` at each element,
while the same profile put through this package's own `serializeResourceXml` and read back by its
own `parseResourceXml` returned `valid: true` with no finding at all. `min` was read through a match
on the number alone, and a failed match reads as absence, so a profile handed over in XML declared
its required elements and this library enforced none of them, with nothing on any diagnostic channel
to say so. A change of format upgraded a document's trustworthiness claim. The asymmetry that hid it
is that `max` was fine: FHIR spells `max` as a string in both formats, so upper bounds were enforced
and lower bounds were not.

One read is widened, and it is the profile loader's own, not the XML reader's. A schema-free reader
cannot know that `value` spells an `unsignedInt` rather than a `code`, and coercing there would turn
the text into a number that the writer then emits as one: authoring a value the sender did not spell
and laundering it across a format change. The model still holds the lexical string and nothing about
re-emission changes.

The text recognised is exactly R4's `positiveInt` lexical space, `[1-9][0-9]*` (datatypes.html), and
nothing beside it. `"+1"`, `"01"`, `"1.0"`, `"1."`, `" 1"`, `"1 "`, `"1e2"`, `"-1"`, `"one"` and the
empty string state no bound, exactly as before.

A `min` of `0` is deliberately excluded, and that exclusion is what makes the widening safe. R4's
`unsignedInt` space admits `0`, but a lower bound of `0` imposes no obligation, so every site that
acts on one tests `min >= 1` and cannot tell `0` from absent. One site can: snapshot generation
treats an absent differential `min` as inherit and a stated `0` as override, so taking `0` off XML
would let a differential begin overwriting an inherited `1` and remove a `CARDINALITY_MIN` the base
emitted. That is the retirement class the sibling `mustSupport` read was measured into and declined.
Excluding `0` keeps the only transition this change can make from absent to a bound of 1 or more,
never one bound to another and never absent to `0`. The cost is declared rather than hidden: an XML
`<min value="0"/>` and an XML element with no `min` load identically, and the loaded model cannot
tell a caller which the profile wrote.

A second consumer moves, disclosed rather than left to be found. A descendant `min` of 1 or more is
what an `exists` slicing discriminator needs, and a discriminator with no expectation makes the whole
slicing unevaluable, so at the base commit an XML-sourced sliced profile came back
`PROFILE_SLICE_UNCHECKED` and no slice constraint was checked at all. That information-level marker,
whose meaning is that the slicing could not be evaluated, is the one finding this change removes.

One collateral is declared rather than left to be found: the model records no provenance, so the
same lexical read applies to a non-conformant JSON document that spelled `{"min": "1"}`. FHIR JSON
spells `min` as a number, so that document is not conformant; the direction is lenient on the read
and unchanged on the write.

Still unread from XML and pinned: `ElementDefinition.mustSupport` and `ElementDefinition.slicing.ordered`, whose
measured retirement stands and which the `0` argument above does not license, since `false` is not
"no flag stated"; and FHIRPath's number reads, where an XML-sourced number still falls through to
string ordering.

The numbers here come from hand-authored XML and JSON fixtures plus mutations and probes, not from
the R4 published-examples corpus.
