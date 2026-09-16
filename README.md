<a href="https://cosyte.com">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://cosyte.com/tile/cosyte-lockup-tile-on-dark-1200x300.png">
    <img alt="Cosyte: a plus mark set in two overlapping rounded squares, one solid and one outlined, beside the Cosyte wordmark" src="https://cosyte.com/tile/cosyte-lockup-tile-on-light-1200x300.png">
  </picture>
</a>

# @cosyte/fhir

> Developer-focused FHIR toolkit for Node.js and TypeScript: an **R4-first** resource model, a
> JSON **and XML** codec, and validation, with the same one-line ergonomics as the rest of the
> `@cosyte/*` parser suite.

**Status: pre-alpha, unpublished.** What is built: the no-data-loss core (a
precision-preserving JSON codec and typed primitive model), the first three validation layers
(structure, cardinality, and primitive/enumerated-`code` value-domain) with value-free
`OperationOutcome` output, the **safety-critical status & negation model** (`readSafety`,
fail-closed on unknown `modifierExtension`, the `ait`/`con`/`obs` invariants), **Quantity / UCUM
fidelity** (the 11-way `Observation.value[x]` discrimination, UCUM-`code` unit fidelity, vital-signs
required-unit conformance, dose quantities), **strength-aware, content-free terminology binding
validation** (a frozen known-systems registry, binding-strength severity, the multi-system allergy /
medication bindings, and a pluggable terminology-service interface, none bundled),
**StructureDefinition-driven profile validation** (snapshot generation, slicing, `fixed[x]` /
`pattern[x]`, and must-support as a system obligation, against caller-supplied US Core / vendor
profiles, none bundled), and **profile-invariant validation through a bounded, vendored FHIRPath
subset** (an in-repo lexer → parser → evaluator that evaluates a profile's `constraint[]`, reporting
anything outside the subset `INVARIANT_UNCHECKED` rather than passing it), and a **zero-dependency XML
codec** (`parseResourceXml` / `serializeResourceXml`) that reads and writes the same schema-free model
as the JSON codec, with a reader that is **XXE- and billion-laughs-proof by refusal** (any DTD or
non-predefined entity is refused loudly, never resolved or expanded) and a `nodesEquivalent` oracle for
JSON↔XML model equivalence, and **Bundles + references + Bulk NDJSON streaming** (`readBundle` with
**transaction = all-or-nothing vs batch = independent** semantics: modeled, never executed; reference
resolution for relative / absolute / logical / `#fragment` with a **DoS-safe cycle guard**; and a
`streamNdjson` reader with **per-line error isolation** and **no whole-file load**), and a
**programmatic profile-authoring API** (`defineProfile()` builds a `StructureDefinition` in code: the
same model `loadStructureDefinition` reads from JSON, one path with no privileged internal shape, plus
a spec-grounded **starter kit** of example profiles that dogfood it), and **conformance hardening**:
JSON + XML + NDJSON **fuzz targets** proving adversarial input never
crashes / hangs / OOMs (only a _typed_ error or a bounded rejection; the JSON reader now bounds nesting
with a `MAX_DEPTH_EXCEEDED` fatal, matching the XML reader), a **PHI-leak test tier** gating the
value-free-diagnostics contract, and **type-level (`expect-type`) tests** on the public surface. See
[What works today](#what-works-today). It **reads, round-trips,
structurally validates, never drops a modifier / status / negation, surfaces measured values by their
true type with the UCUM `code`** (never the display string, never converted), **validates code systems
and binding strength without vendoring any SNOMED / CPT / LOINC content, validates against US Core
profiles you supply, and evaluates their FHIRPath invariants** (failing safe to `INVARIANT_UNCHECKED`
on any unsupported expression); it does **not** yet do `type`·`profile` slicing discriminator or
reslicing validation (still `PROFILE_SLICE_UNCHECKED`), and it bundles **no** US Core
IG corpus. The `validator_cli.jar` **differential is authored but CI-only** (a JVM oracle job: there is
no Java in the dev container, so it has not been observed green there) and now runs over **both** the
synthetic spec-clean corpus **and** the real-world quirk corpus. The built-in structural schema set is the base-resource elements plus
`Patient` as a worked demonstrator; other resource types validate only against a caller-supplied schema
or profile. Without a supplied terminology service there is **no code-validity / value-set-membership**
guarantee beyond `system` + strength (no terminology content is bundled: licensing). Its XML codec is
schema-free like the JSON one, so an XML-sourced primitive is kept as its lexical string and **typed
cross-format transcoding** (emitting spec-clean JSON booleans/numbers from an XML model) needs the
datatype schema and is not yet done; the XHTML **structure** inside `Narrative.div` is not modeled or
validated (carried opaquely as a string (the JSON codec's fidelity), never dropped), and RDF/Turtle is
out of scope. It has no typed per-resource models
yet, and it **never converts a unit** or evaluates a reference range. Do not depend on this package.

## What works today

The capability readout is long enough to read better on its own page.
[What the package does today](documentation/what-works-today.md) covers the no-data-loss
core, the first three validation layers, the safety and negation spine, Quantity and UCUM
fidelity, content-free terminology binding validation, StructureDefinition-driven profile
validation with its bounded FHIRPath invariant subset, the profile starter kit, and the
real-world quirk corpus and differential.

### XML codec and cross-format equivalence

A zero-dependency FHIR XML codec that reads and writes the same schema-free model as the
JSON codec, with a reader that is XXE- and billion-laughs-proof by refusal.
[Read the XML codec readout](documentation/xml-codec-and-cross-format-equivalence.md).

### Bundles, references, and Bulk NDJSON streaming

`readBundle` with transaction as all-or-nothing and batch as independent, reference
resolution behind a DoS-safe cycle guard, and a `streamNdjson` reader with per-line error
isolation and no whole-file load.
[Read the Bundle and streaming readout](documentation/bundles-references-and-ndjson-streaming.md).

## What this will be

FHIR is HL7's modern, resource-oriented interoperability standard, the format behind the US
regulatory push (ONC HTI-1 binds §170.315(g)(10) to **FHIR R4 + US Core + SMART on FHIR**).
`@cosyte/fhir` is the FHIR member of the cosyte parser family: a small, zero-runtime-dependency
TypeScript library that reads and writes FHIR, models its resources with correct primitive
semantics, and validates against structural rules and US Core profiles, mirroring the API shape of
[`@cosyte/hl7`](https://github.com/cosyte/hl7), the reference parser.

## Architecture decisions

The decisions that shape everything downstream:

- `decimal` / `integer64` are **string-backed** and preserve lexical precision. `0.010` is never
  silently normalized to `0.01`, and these primitives never round-trip through JS `number`.
- **FHIRPath**: a bounded, vendored subset in-repo, no runtime dependency, no full third-party
  engine.
- **R4-first** (`4.0.1`), the US regulatory anchor. R5 and DSTU2 are **read-tolerance only**.

## Tech stack

Inherited from the shared `@cosyte/*` standard, by depending on the published `@cosyte/*` config
packages, not by copying files:

- **TypeScript** (strict) via `@cosyte/tsconfig`, target **ES2023**, `NodeNext`.
- **Dual ESM + CJS + `.d.ts`** build via `tsup` (`@cosyte/tsup-config`); `attw` is a publish gate,
  run through `scripts/attw.mjs`. The wrapper is there because the `attw` CLI prints "This package
  does not contain types." and then exits **0**, so a tarball that lost its declarations passed the
  gate. It checks that every artifact path `package.json` promises exists before the run, and
  treats an untyped report afterwards as a failure.
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
