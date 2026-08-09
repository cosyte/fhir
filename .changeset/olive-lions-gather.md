---
"@cosyte/fhir": patch
---

`readSafety` reads a `doNotPerform` the XML reader kept as lexical text, instead of reporting it
absent (`FHIR-XML-BOOLEAN-NEGATION-LOST`).

FHIR XML carries every primitive as the text of its `value` attribute, and the reader is schema-free
by design: with no `StructureDefinition` in hand it never guesses a datatype, so
`<doNotPerform value="true"/>` lands as the string `"true"` where the JSON reader builds `true`. That
much is a declared limit and it is not what changed.

What changed is the read. Measured at the base commit, a `MedicationRequest` carrying
`"doNotPerform":true` went through this package's own `serializeResourceXml` (which emits
`<doNotPerform value="true"/>`, correctly) and back through `parseResourceXml`, and `readSafety`
returned `doNotPerform: undefined`, `negations: []`, `issues: []` and `safeToSummarize: true`, with
`assertSafeToSummarize` passing clean, where the JSON original reads `negations: ["do-not-perform"]`.
The read matched only a JS `boolean`, and a failed match reads as absence, so an explicit instruction
not to give a medication disappeared while the safety spine affirmed the result was safe to
summarize. A lost `doNotPerform` does not degrade a value; it inverts an instruction.

One read is widened, and only one: `primitiveBooleans`, the safety-layer read, whose sole caller is
`readDoNotPerform`. It is deliberately not widened in the XML reader. The model still holds the
lexical string, `nodesEquivalent` still accounts for the difference, and nothing about re-emission
changes: a schema-free reader cannot know the datatype, and coercing there would author a value the
sender did not spell.

The text recognised is exactly `true` and `false`, the whole of the R4 `boolean` lexical space and
nothing beside it. `"TRUE"`, `"True"`, `"1"`, `"yes"`, `"Y"`, `" true"` and the empty string still
read as no boolean. That refusal was silent as this change shipped it; the `unreadableBooleans`
change released alongside it reports the element instead, for the safety read.

The census that turned up the defect is reported rather than acted on, and that is a finding rather
than a shortfall. Two more boolean reads have the same defect and are left standing:
`ElementDefinition.mustSupport` and `ElementDefinition.slicing.ordered`, both through
`primitiveBoolean`, the convenience read. Widening them was drafted and then measured to retire a
diagnostic: the snapshot merge treats an absent differential flag as "inherit", so an XML
`<mustSupport value="false"/>` that previously read `undefined` would begin overwriting an inherited
`true` and remove a `MUST_SUPPORT_ABSENT` the base emitted. Adding a negation is safe; removing a
finding needs its own measurement. FHIRPath's
`convertToBoolean` / `toTrit` / `systemTypeOf` are the same root class, censused and unchanged.
`validatePrimitiveValue` is untouched and still reads a conformant `<active value="true"/>` as
`TYPE_MISMATCH`; that trade is recorded with the `Quantity` residuals and is not reopened here.

No diagnostic moves, measured base-vs-head rather than argued: `collectProfileIssues` over an
XML-sourced profile and `validateResource` over the round-tripped `MedicationRequest` are identical
on both trees. The only thing that moves is `readSafety`'s `doNotPerform` and `negations`. One
collateral is declared rather than left to be found: the model records no provenance, so the same
lexical read applies to a JSON document that spelled `{"doNotPerform":"true"}`. FHIR JSON says a
boolean is a JSON boolean, so that document is non-conformant either way. `negations` is monotone
across the change: this read can only add the `do-not-perform` negation, never retire it.
`SafetyReadout.doNotPerform` itself moves further than that, and the difference is measured rather
than glossed: besides `undefined` becoming `true` or `false`, it moves `false` to `true` where any
value spells the negation a JS `boolean` elsewhere in the element contradicts. That is the
documented "a `true` anywhere wins" rule doing its job, and it is pinned.

Residuals stay open and are pinned by a test rather than implied, the two profile reads among them.
`safeToSummarize` was unmoved in both directions by this change. For a value that reads, that is
right: `negations` now carries the instruction, and refusing to summarize was never the remedy. For a
value that does not read (`"1"`, ordinary converter output) the element was present, its value
unread, nothing recorded it, and the readout still affirmed. That second direction is closed by the
`unreadableBooleans` change released alongside this one, which adds the channel `SafetyReadout` was
missing.

The corpus is hand-authored XML fixtures, mutations and hand-built probes, not the FHIR R4
published-examples corpus. Nothing here is corpus-wide.
