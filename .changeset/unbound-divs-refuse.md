---
"@cosyte/fhir": patch
---

`serializeResourceXml` now throws on a narrative `div` string whose own markup names a namespace
prefix that nothing inside the string binds, instead of writing it verbatim. A `div` is written back
as its raw string, so `{"resourceType":"Patient","text":{"status":"generated","div":"<v:div>x</v:div>"}}`
used to come back as `…<text><status value="generated"/><v:div>x</v:div></text>…`. A conformant XML
parser rejects that document, and this library's own re-read turned the narrative into a property
named `v:div`: the narrative was gone after one write and one read, with no diagnostic.

The cost a consumer sees: some models that read `valid: true` with an empty issue list no longer get
an XML document back. They get a `FhirSerializeError` carrying the new
`SERIALIZE_ERROR_CODES.UNSERIALIZABLE_DIV_PREFIX` instead, with the `div`'s location, at every depth,
including a resource composed into `contained` or `Bundle.entry.resource` after it was read. An
unbound prefix on an inner element (`<div xmlns="…xhtml"><v:p>x</v:p></div>`) or on an attribute is
refused as well as one on the root. The message and the locations carry no part of the string and no
prefix. Still written: a `div` that binds every prefix it uses inside itself, one that uses only the
`xml` prefix, and a narrative whose prefix a conformant document bound on an ancestor of the `div`,
because the reader carries that declaration into the string.

Every refusal the writer already raised is raised first, so a model that drew one of them keeps its
code and locations, and a `div` that fails the existing one-element check keeps
`UNSERIALIZABLE_DIV_MARKUP`. The JSON writer and the read path are unchanged. Still written, and
still not namespace-well-formed: a name with no colon that is not a conformant XML name.
