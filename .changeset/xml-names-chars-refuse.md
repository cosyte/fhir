---
"@cosyte/fhir": patch
---

`serializeResourceXml` now throws on a tag name that is not an XML 1.0 `Name`, and on a character
outside XML 1.0 `Char`, instead of writing a document a conforming XML processor must reject. It used
to write `<a&b value="v"/>`, `<1abc/>`, `<-x/>` and a tag carrying U+0000 as element tags, and to
write a U+0000 in a string value raw into its `value` attribute. This library's own reader read those
documents back; a third-party parser rejects every one.

The cost a consumer sees: some models that read `valid: true` with an empty issue list, such as a
JSON property named `1abc` or a string value carrying U+0000, no longer get an XML document back.
They get a `FhirSerializeError` carrying one of two new codes. `UNSERIALIZABLE_XML_NAME` is raised
for a name at any tag position and any depth, a `resourceType` that names a root or a nested
resource included. `UNSERIALIZABLE_XML_CHARACTER` is raised for a code point outside `Char` in a
primitive's `value`, an `id` written as an attribute, an `Extension.url`, or a narrative `div`
string, where a numeric character reference such as `&#0;` counts as the raw character does. Nothing
is repaired: no name is changed, and no character is escaped, replaced or dropped. The message and
the locations carry no name, no value and no character. The discouraged code points XML still allows
(U+007F to U+009F, U+FDD0 to U+FDEF) are written as before.

Every refusal the writer already raised is raised first, so a model that drew one of them keeps its
code and locations, and a model carrying both a bad name and a bad character gets the name code.
`serializeResource` and the read path are unchanged. Still written: `xml:1abc`, a name that is valid
XML but not namespace-well-formed, and an element or attribute name inside a `div` string that is not
a valid XML name.
