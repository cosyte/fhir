---
"@cosyte/fhir": minor
---

`serializeResourceXml` no longer writes a model name carrying a colon with its prefix bound to
nothing. XML reads a colon in an element name as a namespace prefix, and the model carries no
namespace bindings, so the writer had nothing to declare one with and emitted, for example,
`<v:x value="1"/>`, `<:x/>` or a root read as `<v:Observation>` written back as
`<v:Observation xmlns="http://hl7.org/fhir">`. A conformant XML parser rejects each of those
documents. This library's own re-read accepted them, and lost a finding on the way: a prefix
rebound between siblings reads with `MIXED_XML_SPELLING`, and after one write and one re-read that
report was gone.

Such a model is now refused with a `FhirSerializeError` carrying the new
`SERIALIZE_ERROR_CODES.UNSERIALIZABLE_PREFIXED_NAME`, at every tag position and every depth,
including a resource composed into `contained` or `Bundle.entry.resource` after it was read. The
refusal's message and locations carry no name, no prefix, no namespace URI and no value. One
exemption: `xml:` followed by a local part with no colon in it is still written, because the `xml`
prefix is bound by definition.

This withdraws an XML write from some documents that read `valid: true`, such as a JSON property
named `p:x`. The JSON writer is unchanged and still writes those names. Every refusal the writer
already raised is raised first, so a model that drew one of them keeps its code, and
`UNSERIALIZABLE_ELEMENT_NAME` keeps its meaning. The read path is unchanged. Still written, and
still not namespace-well-formed: a name with no colon that is not a conformant XML name, and a
narrative `div` whose own markup carries an unbound prefix.
