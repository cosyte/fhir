# @cosyte/fhir

> Developer-focused FHIR toolkit for Node.js and TypeScript — an **R4-first** resource model, a
> JSON codec, and validation, with the same one-line ergonomics as the rest of the `@cosyte/*`
> parser suite.

**Status: pre-alpha scaffold (`0.0.0`, unpublished).** This repository currently holds the
engineering scaffold and the architecture decisions that shape the parser. **There is no parse code
yet** — the resource model, JSON codec, validation, and profile engine land in subsequent phases
(see the roadmap in the meta-repo, `operations/roadmaps/fhir.md`). Do not depend on this package.

## What this will be

FHIR is HL7's modern, resource-oriented interoperability standard — the format behind the US
regulatory push (ONC HTI-1 binds §170.315(g)(10) to **FHIR R4 + US Core + SMART on FHIR**).
`@cosyte/fhir` is the FHIR member of the cosyte parser family: a small, zero-runtime-dependency
TypeScript library that reads and writes FHIR, models its resources with correct primitive
semantics, and validates against structural rules and US Core profiles — mirroring the API shape of
[`@cosyte/hl7`](https://github.com/cosyte/hl7), the reference parser.

## Architecture decisions

The four decisions that shape everything downstream are recorded as ADRs before any code lands:

| ADR                                                                        | Decision                                                                                                                                                                                  |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`0001`](documentation/decisions/0001-decimal-integer64-representation.md) | `decimal` / `integer64` are **string-backed** and preserve lexical precision — `0.010` is never silently normalized to `0.01`, and these primitives never round-trip through JS `number`. |
| [`0002`](documentation/decisions/0002-fhirpath-dependency-posture.md)      | **FHIRPath**: implement a bounded, vendored subset in-repo — no runtime dependency, no full third-party engine. Needed for invariants and slicing (Phase 7).                              |
| [`0003`](documentation/decisions/0003-xml-scope-deferred.md)               | **JSON-first.** XML serialization is deferred to Phase 8.                                                                                                                                 |
| [`0004`](documentation/decisions/0004-r4-first-version-strategy.md)        | **R4-first** (`4.0.1`) — the US regulatory anchor. R5 and DSTU2 are **read-tolerance only**.                                                                                              |

## Tech stack

Inherited from the shared `@cosyte/*` standard (the meta-repo's `documentation/conventions.md` is the
source of truth), by depending on the published `@cosyte/*` config packages — not by copying files:

- **TypeScript** (strict) via `@cosyte/tsconfig`, target **ES2023**, `NodeNext`.
- **Dual ESM + CJS + `.d.ts`** build via `tsup` (`@cosyte/tsup-config`); `attw` is a publish gate.
- **Node >= 22**; package manager **pnpm 10**.
- **ESLint 10** (`@cosyte/eslint-config`) + **Prettier** (`@cosyte/prettier-config`), lint at
  `--max-warnings=0`.
- **Vitest 4** + v8 coverage (`@cosyte/vitest-config`).
- **Zero runtime dependencies.**
- **License:** MIT.

## Development

```bash
pnpm install
pnpm build       # dual ESM + CJS + .d.ts
pnpm typecheck
pnpm lint
pnpm test
```

Every meaningful change gets a Changeset (`pnpm changeset`, `patch` on the `0.0.x` ladder) and a
`CHANGELOG.md` `[Unreleased]` entry. See [`CONTRIBUTING.md`](CONTRIBUTING.md).

## License

[MIT](LICENSE) © Cosyte
