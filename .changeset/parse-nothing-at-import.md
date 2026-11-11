---
"@cosyte/fhir": patch
---

Importing `@cosyte/fhir` no longer parses the FHIRPath expressions of the base constraints. `validateResource` parses them on its first call, once, and keeps them, so an import does less work and the first validation does a little more. Every finding is the same as before. If one of those parses fails for a reason other than the expression itself, such as the stack running out, that call reports the constraint `INVARIANT_UNCHECKED` and the next call parses it again, where before the failure would have been kept for the life of the process. No public API changes.
