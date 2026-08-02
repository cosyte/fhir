---
"@cosyte/fhir": patch
---

Bound the names a document supplies before they reach a diagnostic location.

A finding carries a FHIRPath `expression` rather than a value, and that expression is built out of
the document's own `resourceType` and its own property names. A conformant resource supplies element
names there; anything else supplies whatever the sender wrote, at any length. Those names are now
echoed only when they match the published form of a FHIR name, and replaced by a fixed marker
otherwise, so a location cannot carry unbounded document content. Every conformant document reports
exactly the locations it reported before. `SafetyReadout.resourceType` is bounded the same way; the
property names on the element model are not, because the writer reproduces them byte for byte.
