---
"@cosyte/fhir": patch
---

`readQuantity` reads a magnitude the XML reader kept as lexical text, instead of reporting it absent
(`FHIR-XML-WRITE-RESIDUALS`).

FHIR XML carries every primitive as the text of its `value` attribute, and the reader is schema-free
by design: with no `StructureDefinition` in hand it never guesses a datatype, so `<value value="5"/>`
lands as the string `"5"` where the JSON reader builds a `FhirDecimal`. That much is a declared limit
and it is not what changed. The text is never routed through a `number`, so precision survives on
both paths, and `nodesEquivalent` already defines cross-format equivalence modulo exactly this.

What changed is that `readQuantity` accepted only the JSON reader's shape. Measured at the base
commit, a `MedicationRequest` whose dose is written
`<doseQuantity><value value="5"/><code value="mg"/></doseQuantity>` read back as
`{ value: undefined, code: "mg" }` under an empty issue list, and the same held for
`readObservationValue().quantity` and both `readReferenceRanges` bounds. `undefined` is this API's
documented reading for "this quantity carries no magnitude", so a document that carried one came back
as a unit with no number: the bare-unit shape, which is the harm the value-channel `null` rule already
exists for, arriving through a different door.

`readQuantity` now reads the magnitude from either reader's model, recognising the R4 `decimal`
lexical space and carrying the text through unchanged, so no float is involved and `0.010` stays
`0.010`. Anything outside that space (`"abc"`, `"true"`, `"1,5"`, `" 5 "`, `"+5"`, the empty string)
is still `undefined`, which keeps that word meaning only "no magnitude here".

No diagnostic can move, and that is measured rather than argued: nothing in the validation layer
branches on `Quantity.value` (the UCUM shape check reads `system` and `code`, and so does the
vital-signs required-unit check), and the read differential does not read quantities at all. One
collateral is declared rather than left to be found: the model records no provenance, so the same
lexical read applies to a JSON document that spelled its magnitude as a string. FHIR JSON says a
decimal is a number, so that document is non-conformant, and reporting its magnitude absent was the
worse of the two readings.

Three residuals stay open and are pinned by a test rather than implied. An XML-sourced decimal still
re-serializes to JSON as a string, `"1.50"` and not `1.50`, the text byte-exact and the JSON type not.
`validatePrimitiveValue` still reads the JSON reader's model shape as the model shape, so a conformant
`<active value="true"/>` draws `TYPE_MISMATCH` and flips `valid` where the JSON twin validates clean;
accepting the lexical form there would retire a real mismatch on a JSON document that spelled a
boolean as a string, and the model cannot tell the two apart. And a profile's `fixed[x]` decimal never
matches the same magnitude read from XML.

Four claims were false at their own sites and are corrected rather than reworded around: the XML
codec's package doc and the read module's header both said the reader produces the same model as the
JSON reader; `parseResourceXml`'s own example said `serializeResource` returns "the same model as the
JSON form" when it returns `{"resourceType":"Patient","active":"true"}`; and the README annotated
`nodesEquivalent` as "same model from either wire format". The scoped statements beside them measure
true and were left alone.

The corpus is 7 hand-authored XML fixtures plus mutations and this repo's hand-authored JSON fixtures
and probes, not the FHIR R4 published-examples corpus. Nothing here is corpus-wide.
