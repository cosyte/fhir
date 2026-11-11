---
"@cosyte/fhir": patch
---

A new how-to guide, "Type a parsed resource with the community R4 types", shows how to give a resource you have read and checked the compile-time shape of the `@types/fhir` R4 types: write it back with `serializeResource`, parse that text into a plain object, and annotate it. It says plainly what the plain copy loses: a decimal becomes a JavaScript number, so `0.010` comes back as `0.01` and a long number is rounded, and it shows how to read the exact value from the parsed model instead. The "Current limits" page links it. No code changes and no public API changes.
