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
own `parseResourceXml` returned `valid: true` with no profile finding of any kind (both readings
carry an unrelated informational `RESOURCE_NOT_MODELED` from the built-in schema). `min` was read
through a match
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

The text recognised is exactly R4's `unsignedInt` lexical space, `[0]|([1-9][0-9]*)`
(datatypes.html), which is the datatype `ElementDefinition.min` declares (elementdefinition.html),
and nothing beside it. `"+1"`, `"01"`, `"1.0"`, `"1."`, `" 1"`, `"1 "`, `"1e2"`, `"-1"`, `"one"` and
the empty string state no bound, exactly as before. R4's `positiveInt` is a different space
(`+?[1-9][0-9]*`, a leading `+` admitted) and is not the one this read implements.

Snapshot generation is changed alongside it, and that change is what makes widening the read safe. A
profile derives by constraining (profiling.html): its `min` may raise the inherited one and may not
lower it, so a differential stating a smaller bound is an invalid profile rather than a relaxation to
honour. The differential's `min` was overlaid verbatim, which silently removed a `CARDINALITY_MIN`
the base element had earned and moved `valid` from `false` to `true`. It now takes the tighter of the
inherited and the stated bound, so a newly-read `min` can only raise the snapshot's bound or leave it
alone, whatever wire format spelled it. The malformed profile is not refused, since snapshot
generation has no channel to report it on; the instance verdict is the fail-safe one.

That closes a defect on the JSON path too, disclosed rather than absorbed quietly: a JSON
`{"min": 1}` under an inherited `min` of `2` already removed that finding before this change. The
direction is `valid: true` to `valid: false`.

The mirror on `max` is deliberately not taken. A differential stating a larger `max` than it inherits
still widens the upper bound, because no read feeding `max` moved here: FHIR spells `max` as a string
in both formats, so it was read from XML already. It is characterized by a test rather than changed.

A second consumer moves, disclosed rather than left to be found. A descendant `min` of 1 or more is
what an `exists` slicing discriminator needs, and a discriminator with no expectation makes the whole
slicing unevaluable, so at the base commit an XML-sourced sliced profile came back
`PROFILE_SLICE_UNCHECKED` and no slice constraint was checked at all. That information-level marker,
whose meaning is that the slicing could not be evaluated, is the one finding this change removes.

One collateral is declared rather than left to be found: the model records no provenance, so the
same lexical read applies to a non-conformant JSON document that spelled `{"min": "1"}`. FHIR JSON
spells `min` as a number, so that document is not conformant; the direction is lenient on the read
and unchanged on the write.

Still unread from XML and pinned: `ElementDefinition.mustSupport` and
`ElementDefinition.slicing.ordered`, whose measured retirement stands and which this change does not
license. What makes a widened `min` safe is that its one finding-retiring consumer now takes the
tighter of two bounds, and a boolean flag has no tighter-of-the-two, since `false` is not "no flag
stated". FHIRPath's number reads are likewise unchanged, an XML-sourced number still falling through
to string ordering.

The numbers here come from hand-authored XML and JSON fixtures plus mutations and probes, not from
the R4 published-examples corpus.
