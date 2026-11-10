---
"@cosyte/fhir": patch
---

The XML reader now reads an extension that holds only nested extensions, such as a US Core race or ethnicity extension, as an Extension with its `url`. It read as a value-absent primitive before: its `url` was reported as an unknown property and left off the model, so `serializeResourceXml` and `serializeResource` wrote the extension without the URL that says what it means, and at a resource's root the validator also reported a type mismatch. An element with a `url` attribute and nothing else now reads as an Extension too, which `ext-1` reports. A document read from JSON is unaffected.
