---
"@cosyte/fhir": patch
---

`validateResource` and `parseResource` allocate less again, with every result unchanged. The validator's walks no longer build a location string at every element they pass: each carries the location as a list of steps and writes it out only when it reports a finding, so validating a resource that has nothing to report builds almost none. The safety, absence, `value[x]` and base-constraint walks, the `use` reads and the coding reads now loop without the per-element arrays, closures and iterators they made, and the base-constraint layer keeps its table of decided constraints only when a profile is supplied. The reader builds a plain string or boolean element without its location. No public API changes.
