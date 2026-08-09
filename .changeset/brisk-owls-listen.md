---
"@cosyte/fhir": patch
---

Refuse a `resourceType` with no string in it instead of deleting it and naming the element
`Resource`.

FHIR XML has no `resourceType` element: the type IS the tag (xml.html). So `serializeResourceXml`
skips that property at every element it walks and takes the tag from the property's string value, and
where there was no string to take the root fell back to `Resource`.

Measured at the base commit,
`{"resourceType":{"modifierExtension":[{"url":"http://example.org/x"}]},"status":"final"}` reads
`RESOURCE_TYPE_UNKNOWN` at error severity with `valid: false`, and `safeToSummarize: false` for the
unhandled modifier extension the type gate carries. It came back as
`<Resource xmlns="http://hl7.org/fhir"><status value="final"/></Resource>`, which re-reads with an
empty issue list, `valid` and `safeToSummarize` both moving `false` to `true`, and
`unhandledModifierExtensions` becoming `[]`. The property is gone from the output, the modifier
extension went with it, and the element claims a type nobody wrote.

A new `SERIALIZE_ERROR_CODES.UNSERIALIZABLE_RESOURCE_TYPE`, value-free and carrying bounded
locations, is raised as a whole-model pre-pass at the end of the chain, so no model that already
reported one of the five refusals above it moves onto this code. The array-wrapped and the `null`
spellings of an untaggable type each keep their own.

Neither repair was available. Writing `<Resource>` is what laundered, and it authors a type gate,
which is what every type-scoped safety read runs behind; coercing the value to a string authors a
different type out of content the sender wrote at another shape. Refusing recognises nothing and
invents nothing.

Two shapes are left alone, and each is the line rather than an oversight. An element that wrote **no**
`resourceType` is untouched, because `serializeResourceXml` accepts any complex and names a typeless
one `Resource` by documented fallback and nothing is deleted there. And an element that wrote a
**string beside** a non-string keeps its tag, so this defect's substitution never happens; what drops
there is the repeated-property-name case, and that shape is reachable only from XML, whose reader has
no duplicates mechanism.

The bound is structural rather than a verdict. At the root this costs a round trip only for a model
already reported `valid: false`, but deeper no layer checks a nested element's type and a document
read from XML reaches it. What is withdrawn at every refused location is a deletion rather than a
round trip, by construction: the writer's skip is unconditional on the name, so at each of them it
dropped a property the sender wrote and emitted no element for it, with no diagnostic at either end.

`serializeResource` emits a non-string `resourceType` through its ordinary path, so this refusal does
not reach it and that route stays open.
