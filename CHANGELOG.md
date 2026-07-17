# Changelog

All notable changes to `@cosyte/fhir` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project stays on the
**v0.0.x-until-first-alpha** ladder (meta-repo ADR 0001) until its first alpha.

## [Unreleased]

### Added

- **Structural & cardinality validation + `OperationOutcome` (Phase 2).** The first three validation
  layers over the Phase-1 model, each finding **value-free** (a stable code, an R4 `IssueType`, and a
  FHIRPath `expression` location — never the offending value).
  - **Layer 1 — structure:** `UNKNOWN_ELEMENT` (an element the schema does not define),
    `RESOURCE_TYPE_UNKNOWN`, `TYPE_MISMATCH` (a node whose shape is wrong for its datatype), and
    `CHOICE_AMBIGUOUS` (more than one `choice[x]` variant present).
  - **Layer 2 — cardinality:** `CARDINALITY_MIN` (a required element absent) and `CARDINALITY_MAX`
    (an element past its maximum).
  - **Layer 3 — value-domain:** `PRIMITIVE_INVALID` against the FHIR R4 primitive datatype regexes
    (`date`, `dateTime`, `instant`, `time`, `code`, `id`, `uri`, `oid`, `uuid`, `base64Binary`, and
    the JSON-number family validated from exact lexical text — never a float), and `CODE_INVALID` for
    a value outside a **required-strength** enumerated binding. `validatePrimitiveValue` and
    `PRIMITIVE_TYPES` are public.
  - **`OperationOutcome` output** (`toOperationOutcome`) — a serializable, value-free resource model
    with `severity` (R4 `fatal|error|warning|information`; no R5 `success`), `code` (R4 `IssueType`),
    `expression`, and a `diagnostics` line derived **only** from the code. This one chokepoint is the
    **PHI redaction boundary** the roadmap places in Phase 2: no instance value can reach a diagnostic.
  - **Lenient read vs strict emit (Postel's Law):** an unknown element is a `warning` in the default
    `"lenient"` mode and an `error` under `mode: "strict"`; every other finding is an error regardless.
  - **Fail-safe / no false errors:** the validator never rejects a whole resource for one recoverable
    field, and a resource type with no schema degrades to a single informational `RESOURCE_NOT_MODELED`
    (its own elements left unchecked rather than wrongly flagged). Complex-datatype internals are left
    to Phase 6.
  - **Compact, non-`StructureDefinition` schema** (`ResourceSchema` / `ElementSchema` / `buildRegistry`
    / `baseSchema` / `resolveElement`, with `choice[x]` support) — the seam Phase 6 will feed from real
    StructureDefinitions. Ships with the base `Resource`/`DomainResource` elements plus a worked
    `Patient` schema; callers supply others via `validateResource(resource, { schemas: [...] })`.
  - **Stable public contract:** the `VALIDATION_CODES`, `ISSUE_TYPES`, and `ISSUE_SEVERITIES`
    registries are snapshot-pinned (a rename is breaking), with a PHI sweep over every emitted
    `OperationOutcome`. Per-directory ≥90 coverage extended to `src/validate/`.
  - **Still deferred:** terminology binding beyond required-code enumeration (Phase 5); profile /
    US Core / slicing / must-support (Phase 6); FHIRPath invariants (Phase 7).
- **JSON codec + typed primitive model — the no-data-loss core (Phase 1).** The first parsing code:
  a precision-preserving JSON reader, an immutable resource model, and a spec-clean serializer.
  - **`decimal` / `integer64` lexical precision (ADR 0001).** `FhirDecimal` and `FhirInteger64` are
    string-backed and never route a value through the JS `number` type. `0.010` stays `0.010`; a
    64-bit-range integer stays exact. `FhirDecimal` exposes precision-sensitive `equals` (the FHIR
    default: `0.010 ≠ 0.01`) alongside quantity-only `equalsValue`, plus `toBigInt` / `toNumber`
    (the latter deliberately lossy). The reader tokenizes JSON itself (`readRawJson`) because
    `JSON.parse` is non-conformant for FHIR decimals — it would corrupt them before any of our code
    runs.
  - **Primitive-extension (`_`-sibling) model with null-padded array alignment.** A primitive's
    value and its `id`/`extension` metadata are merged into one first-class `FhirPrimitive` node
    (modeled as a concept, not a literal `_`-key, so the Phase-8 XML codec inherits it — ADR 0003).
    Repeating primitives round-trip their value array and `_`-array index-aligned with `null`
    placeholders. A length mismatch **fails closed** (`PRIMITIVE_EXTENSION_MISALIGNED`) rather than
    guess which value an extension belongs to.
  - **Generic element model** (`FhirComplex` / `FhirList` / `FhirPrimitive`), immutable and
    wire-agnostic, preserving property order and resolving `resourceType` in any position. Plus
    `meta`/`contained` (preserved structurally) and a `parseReference` classifier
    (relative / absolute / logical / fragment).
  - **Value-free diagnostics (PHI-safe).** Issue codes `DECIMAL_PRECISION_AT_RISK` (information) and
    `UNKNOWN_PROPERTY` (warning), and fatal codes `MALFORMED_JSON` / `PRIMITIVE_EXTENSION_MISALIGNED`
    (`FhirCodecError`), all carrying a FHIRPath location or byte offset — never a resource value.
  - **Accuracy gate:** byte-identical round-trip golden files (trailing-zero decimals, values past
    2^53, primitive extensions, value-absent primitives), property-based round-trip + decimal-
    preservation suites (`fast-check`), immutability, a stable issue/fatal-code snapshot, and a
    PHI-in-diagnostics sweep. Per-directory ≥90 coverage gates (held at 0 during P0) are restored.
  - **Deferred to later phases (read-only surface today):** structural / cardinality / terminology /
    profile / invariant **validation** (P2, P5–P7) — Phase 1 parses and preserves, it does not
    validate; XML (P8); Bundle/reference **resolution** and Bulk NDJSON (P9); typed per-resource
    models and schema-driven `integer64` typing.
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
