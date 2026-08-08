---
"@cosyte/fhir": patch
---

Name the writer whose exception list the `UNSERIALIZABLE_ELEMENT_NAME` `@throws` is about
(`FHIR-CHANGESET-DIV-STALE`).

`serializeResourceXml`'s `@throws` for `UNSERIALIZABLE_ELEMENT_NAME` closes by qualifying the route
it has just said stays open: "which is not the same as saying the JSON output is spec-clean: this
function's own exception list still applies to the rest of the model". The clause sits inside
`serializeResourceXml`'s own doc comment, so "this function" resolves to the XML writer, and the XML
writer's exception list does not govern the JSON output. The list that does is `serializeResource`'s,
the JSON writer named one clause earlier. So the qualification on the route a consumer had just been
pointed at named the wrong writer, in the declarations their editor reads.

It now names `serializeResource`. The claim already read that way where it is written elsewhere in
the module: the `SERIALIZE_ERROR_CODES.UNSERIALIZABLE_ELEMENT_NAME` docblock and
`refuseUnserializableNames` both scope it to the JSON writer, and `test/xml-tag-name.test.ts`'s suite
docblock has "not a claim that the JSON output is spec-clean, which that writer's own exception list
governs". Each was opened and read rather than cited. **No total is given**, because a complete set
of sites is the shape this lineage keeps getting wrong.

Documentation only: that sentence renders into the shipped type declarations, where a consumer's
editor shows it. No behaviour changed, no predicate moved, and no executable byte moved.

One more site of the same shape is named rather than folded in: `emitsOneDivElement`'s docblock calls
an unbound prefix "the separately declared residual on this function's own output", and that function
returns a boolean rather than a document. It renders into neither declaration file, so it is not
shown at any call site a consumer reaches. Pre-existing.
