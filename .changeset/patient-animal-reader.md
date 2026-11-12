---
"@cosyte/fhir": patch
---

Read and require the R4 `patient-animal` extension on a veterinary Patient. `readPatientAnimal(resource)` returns the extension's `species`, `breed` and `genderStatus` as the CodeableConcept model nodes the document wrote, each `undefined` when absent, or `undefined` overall for a resource that is not a Patient or carries no such extension. A missing `species` (`1..1`) is reported as `CARDINALITY_MIN` at `Patient.extension[n].extension:species`; a part written twice, written without a value or in another type is not read and is reported instead. `PATIENT_ANIMAL_EXTENSION_URL` names the extension, and the type `PatientAnimal` describes the result.

`VETERINARY_PATIENT_STARTER` is a new starter profile that requires the extension on a Patient: one `animal` slice fixed to its URL, `species` required, `breed` and `genderStatus` allowed once each, with the extension's example bindings. It is not in `STARTER_PROFILES`, which applies to every Patient, so the kit validates a human Patient as before; pass it on its own or find it with `starterProfile`. The extension is draft, at maturity level 1, and its bindings are examples only, so no code is checked.

What a caller must change: nothing. These are additions, and no existing export behaves differently.
