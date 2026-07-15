---
"@cosyte/fhir": patch
---

Bootstrap the `@cosyte/fhir` repository from the shared cosyte engineering standard: dual ESM+CJS
tsup build, ESLint 10 / Vitest 4 / TypeScript 5.9 / Node >= 22 / ES2023, zero runtime dependencies,
Changesets, and the placeholder source tree (`model/`, `codec/`, `validate/`, `profiles/`,
`helpers/`). Includes the four architecture ADRs that shape the parser — decimal/integer64 lexical
precision, FHIRPath dependency posture, JSON-first (XML deferred), and R4-first with R5/DSTU2
read-tolerance. No parse code in this phase; all parsing is deferred to Phase 1+.
