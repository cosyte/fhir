---
"@cosyte/fhir": patch
---

`parseResource` and `validateResource` allocate less on a small resource. A read of JSON text now builds the model straight from the tokens of the text for an object with no `_`-sibling and no repeated name, instead of making a raw node for every member first, and takes the element names a document writes most from one shared copy. On the 1.3 KiB vital-signs Observation of our benchmarks, one read went from about 25 times its input to about 12 times. Validation of that Observation allocates about a fifth less: the safety walk no longer makes a list for every member it checks, a set for every list it collapses, or a list for each `resourceType` and `status` it reads, and a FHIRPath step appends to one list instead of making one per item. The model, the issues and every finding are the same as before.
