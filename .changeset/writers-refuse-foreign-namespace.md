---
"@cosyte/fhir": patch
---

Both writers now refuse a model holding an element the XML reader read from another vocabulary, so a write and a re-read can no longer make it read safe. `readSafety` declines an XML element in a namespace other than its parent's (`<status xmlns="urn:vendor" value="final"/>` inside a FHIR resource), but `serializeResource` wrote it as `"status":"final"` and `serializeResourceXml` wrote it in the FHIR namespace, and either re-read had `safeToSummarize: true`. Both writers now throw `FhirSerializeError` with the new code `UNSERIALIZABLE_FOREIGN_NAMESPACE` at the element's location, the way they refuse dropped text. A root in a namespace other than FHIR's was refused only by `serializeResourceXml`; `serializeResource` now refuses it too, with `UNSERIALIZABLE_FOREIGN_ROOT`. The narrative `div` in the XHTML namespace is not affected, and a document whose elements are all in the FHIR namespace is written as before.

What a caller must change: a call to `serializeResource` on a model read from XML with a vendor namespace used to return JSON and now throws. Catch `FhirSerializeError` and check `code`, or decide what the vendor element means before writing the resource as FHIR. A `switch` over `SERIALIZE_ERROR_CODES` gains one case.

`FhirSafetyError.locations` from `assertSafeToSummarize` now lists each location once. A location named by two readout channels, such as an element with dropped text that is also undefined, was listed twice.
