# Changelog

All notable changes to `@cosyte/fhir` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project stays on the
**v0.0.x-until-first-alpha** ladder (meta-repo ADR 0001) until its first alpha.

## [Unreleased]

### Added

- **Repository bootstrap (P0).** Scaffolded `@cosyte/fhir` from the shared cosyte engineering
  standard, mirroring the `hl7` reference layout: dual ESM + CJS + `.d.ts` build via `tsup`
  (`@cosyte/tsup-config`), ESLint 10 (`@cosyte/eslint-config`), Vitest 4 with v8 coverage
  (`@cosyte/vitest-config`), TypeScript 5.9 (`@cosyte/tsconfig`), Prettier
  (`@cosyte/prettier-config`), Node >= 22, ES2023, **zero runtime dependencies**, Changesets, and
  the thin CI/Release workflows that call the shared `cosyte/.github` pipelines.
- **Placeholder source tree.** `src/model/`, `src/codec/`, `src/validate/`, `src/profiles/`, and
  `src/helpers/` barrels, plus the `VERSION` export and its `package.json` drift guard
  (`scripts/sync-version.mjs` + `test/sanity.test.ts`). No parse code in this phase — all parsing is
  deferred to Phase 1 and beyond (see `operations/roadmaps/fhir.md` in the meta-repo).
- **Four architecture ADRs** under `documentation/decisions/`:
  - `0001` — `decimal` / `integer64` are string-backed and MUST preserve lexical precision; they
    never round-trip through the JS `number` type.
  - `0002` — FHIRPath dependency posture: implement a bounded, vendored subset in-repo; no runtime
    dependency, no full third-party engine.
  - `0003` — JSON-first; XML serialization is deferred to Phase 8.
  - `0004` — R4 (`4.0.1`) is the modeled version (the ONC HTI-1 / §170.315(g)(10) anchor); R5 and
    DSTU2 are read-tolerance only.

[Unreleased]: https://github.com/cosyte/fhir/commits/main
