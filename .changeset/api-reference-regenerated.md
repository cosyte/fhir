---
"@cosyte/fhir": patch
---

The API reference is regenerated from the source and now has a page for each entry point: `@cosyte/fhir` and `@cosyte/fhir/arbitraries`, which had no reference page before. The old page named version 0.1.7 and missed the note that a string read by `parseResource` keeps its input alive. Links into the reference move to the new pages. CI now fails when the committed reference differs from the source, and each release regenerates it. No code changes and no public API changes.
