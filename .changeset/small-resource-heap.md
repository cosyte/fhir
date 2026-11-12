---
"@cosyte/fhir": patch
---

`parseResource` and `validateResource` allocate less on a small resource. A read of JSON text now builds the model straight from the tokens of the text for an object with no `_`-sibling, no repeated name and at most 16 members, instead of making a raw node for every member first. Validation no longer makes a list for every member the safety walk checks, a set for every list it collapses, or a list for each `resourceType` and `status` it reads, and a FHIRPath step appends to one list instead of making one per item. The model, the issues and every finding are the same as before.
