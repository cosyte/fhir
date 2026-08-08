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

It now names `serializeResource` outright. That is the wording the same claim already carried at the
other sites it is written: the `SERIALIZE_ERROR_CODES.UNSERIALIZABLE_ELEMENT_NAME` docblock, and the
suite docblock in `test/xml-tag-name.test.ts` ("not a claim that the JSON output is spec-clean, which
that writer's own exception list governs"). Both were opened and read rather than cited.

Documentation only and npm-facing: that sentence renders into `dist/index.d.ts` and
`dist/index.d.cts` and into no other built artifact, which is the whole reason it was worth
correcting. No behaviour changed, no predicate moved, and no executable byte moved.

One more site of the same shape is named rather than folded in, because it reaches no consumer:
`emitsOneDivElement`'s docblock calls an unbound prefix "the separately declared residual on this
function's own output", and that function returns a boolean rather than a document. It is
file-internal, is not exported, and renders into neither declaration file. Pre-existing.
