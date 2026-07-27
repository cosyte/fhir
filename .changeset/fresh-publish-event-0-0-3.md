---
"@cosyte/fhir": patch
---

Patch bump to `0.0.3` to give npm support a fresh, never-attempted version to trace against the
`E403` name-similarity rejection of `@cosyte/fhir` (FHIR-NPM-NAME). There is no change to the
package surface: no new or removed exports, no behaviour change, no fixture change, no dependency
change. The only thing this version carries is a version number the registry has never seen.

Context: npm's name-similarity filter rejects the scoped name `@cosyte/fhir` because the unscoped
`fhir` package exists. A support request was filed 2026-07-23 and npm support asked for a fresh,
never-attempted version so they can trace the rejection end to end. `0.0.1` and `0.0.2` have both
already been attempted, so re-firing either would only add a second attempt at a version they have
already traced. This bump exists to produce that clean trace and nothing else.
