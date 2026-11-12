# AGENTS.md

`@cosyte/fhir` is our FHIR R4 parser and utility library for Node.js and TypeScript, published to npm
under MIT from this repository. It reads FHIR JSON and XML into an immutable model that keeps every
`decimal` and `integer64` exactly as written, writes FHIR back or refuses to, and validates in
layers, with zero runtime dependencies.

## Build and test

Use Node.js 22.22.2 or later and pnpm 10.34.5, the version `packageManager` in `package.json` pins.
The package itself runs on Node.js 22.0.0 and later; the development tools need 22.22.2.

`build`, `test`, `lint`, `typecheck` and `format` run through `cosyte-process` from
`@cosyte/process`, which owns the tool versions. `cosyte-process.config.json` keeps one
repo-specific override: the `format` globs, which take `examples/` in and leave `scripts/` out, as
this repository's format check always has. `pnpm lint:examples` lints the examples after a build
with process's own eslint, through `scripts/process-tool.mjs`; `typescript` and `vitest` stay as
direct devDependencies, pinned to process's versions, for the scripts and tests that import them.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
```

## The gate

Run these from the repository root, in this order, before you push. CI runs them on Node.js 22, 24, and 26.

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm format:check
pnpm phi-scan
pnpm test
pnpm test:coverage
pnpm build
pnpm attw
FUZZ_RUNS=20000 pnpm vitest run test/fuzz.test.ts test/phi-leak.test.ts \
  test/safety-not-assessed.test.ts test/safety-resource-slots.test.ts \
  test/safety-stray-resource-type.test.ts test/safety-undefined-element.test.ts
pnpm typecheck:examples
pnpm lint:examples
pnpm examples
pnpm phi-scan:examples
pnpm check:readme
pnpm check:claude-card
pnpm check:catalog
pnpm check:process
pnpm check:docs-content
pnpm check:docs-reference
pnpm check:no-emdash
pnpm check:no-internal-refs
```

`docs-content/api/` is generated from the TSDoc of both entry points, `@cosyte/fhir` and
`@cosyte/fhir/arbitraries`. After a change to an export or its comment, run `pnpm docs:reference`
and commit the pages with it: `pnpm check:docs-reference` fails on a stale page or an export with no
TSDoc summary. The `version` script regenerates the pages, so a release carries its own version.

CI also runs the differential against the HL7 reference validator (`pnpm corpus:fetch`, then
`pnpm differential` and `pnpm differential:determinism`), which needs `java` and the pinned
`validator_cli.jar` at `VALIDATOR_CLI_JAR`.

CI also fetches the FHIR R4 and R4B definition files at a pinned commit and re-derives
`test/__data__/fhir-element-definitions.json` from them (`pnpm definitions:check`); the test suite
holds the safety readout's element table and resource positions to that file. After a change to
either, run `pnpm definitions:derive` (it fetches) and commit what it writes.

## Data

Synthetic data only: real patient data never enters this repository, in a fixture, a test, an
example, an issue, or a log.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
