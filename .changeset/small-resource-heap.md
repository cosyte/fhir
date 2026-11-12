---
"@cosyte/fhir": patch
---

`parseResource` and `validateResource` allocate less on a small resource. A read of JSON text now builds the model straight from the tokens of the text for an object with no `_`-sibling, no repeated name and at most 16 members, instead of making a raw node for every member first. Validation no longer makes a list for every member the safety walk checks, a set for every list it collapses, or a list for each `resourceType` and `status` it reads, and a FHIRPath step appends to one list instead of making one per item. On the 1.3 KiB vital-signs Observation of our benchmarks, on a GitHub-hosted runner, one read's peak memory went from 25.3 times its input (commit 36f6632) to 12.8 to 13.3 times (commits f7786cf, 9d6d139 and 005acb6) and one validation's from 42.1 times to 24.3 to 24.4 times. The readings are in `docs-content/performance.md`; validation is still over its 20 times budget. The model, the issues and every finding are the same as before.
