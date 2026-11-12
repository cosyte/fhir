---
"@cosyte/fhir": patch
---

Importing the package builds less. The JSON reader's member-name buffers, the table of common resource types the safety walk answers from, and the set of resource types with a resource position below their top level are now made on the first read or validation that needs them, not when the package is imported, and the reader's tape helpers are plain functions rather than an object made at import. Reads, validations and every finding are the same as before.
