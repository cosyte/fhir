---
"@cosyte/fhir": patch
---

The XML reader now normalizes attribute values as XML 1.0 section 3.3.3 requires of every XML processor: a literal tab, line feed or carriage return in an attribute value reads as a space (a CR LF pair as one space), and a character reference such as `&#10;` still reads as the character it names. Before this, a literal line break in a `value` attribute reached the model unchanged, where any other XML reader sees a space. Nothing is trimmed or collapsed, the JSON reader is unchanged, and our XML writer already writes these characters as references, so a round trip keeps them. A narrative `<div>` read from XML now carries a tab, line feed or carriage return in its attributes as a character reference.

Corrected two documentation claims. Reslicing is not reported `PROFILE_SLICE_UNCHECKED`: a re-slice's fixed and pattern values decide its parent slice's membership, as in the R4 blood-pressure profile. And `unreadableBooleans` is not empty for every schema-valid document: `<doNotPerform value=" true"/>` is valid against the R4 schema, this reader does not trim it, and it is reported there rather than read.
