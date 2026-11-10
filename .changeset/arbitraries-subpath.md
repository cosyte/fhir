---
"@cosyte/fhir": patch
---

New `@cosyte/fhir/arbitraries` entry point: fast-check generators for FHIR R4, so you can property-test your own code on generated resources. `resource()` gives parsed, spec-clean resources of the eight types the library validates in full, which validate with no error, with decimals that outrun a double, strings JSON and XML must escape, and extensions on primitives; `bundle()` gives collections and search sets of them; `resourceJson()` and `resourceXml()` give messy JSON and XML text the readers accept; `hostileInput()` gives text a reader may refuse; and `resourceType()`, `decimalText()` and `stringValue()` give the parts. Every generated value is synthetic and random. `fast-check` (4.x) is an optional peer dependency: install it to use this entry point. The main entry point never loads it, so nothing changes for code that only imports `@cosyte/fhir`.
