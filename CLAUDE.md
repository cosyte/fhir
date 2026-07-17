# @cosyte/fhir — Project Guide for Claude

## Project

**`@cosyte/fhir`** — a developer-focused FHIR parser + utility library for Node.js/TypeScript,
published under the Cosyte brand. Open-source (MIT). The FHIR member of the cosyte parser suite; it
mirrors the API shape of `@cosyte/hl7`, the reference parser.

**North star:** A developer can read a real-world FHIR resource, model it with correct primitive
semantics, and validate it against US Core — without reading the FHIR spec.

## Status

- **Pre-alpha (`0.0.0`, unpublished).** **Phase 1 landed** the no-data-loss core: a
  precision-preserving JSON codec (`parseResource` / `serializeResource` / `readRawJson`), the
  string-backed `FhirDecimal` / `FhirInteger64` primitives (ADR 0001), the primitive-extension
  (`_`-sibling) model with null-padded array alignment, an immutable generic element model
  (`FhirComplex` / `FhirList` / `FhirPrimitive`), `parseReference`, and value-free diagnostics. Read
  and round-trip only — **no validation yet** (structural/terminology/profile/invariant land in
  P2·P5–P7), **JSON only** (XML is P8), and no typed per-resource models. The roadmap lives in the
  meta-repo: `operations/roadmaps/fhir.md` (P0…P11).

## Tech Stack (the shared `@cosyte/*` standard)

fhir inherits the canonical toolchain by depending on the published `@cosyte/*` config packages, not
by copying files. The source of truth is the meta-repo's `documentation/conventions.md` — this is a
summary.

- **Language:** TypeScript (strict, full rigor set incl. `noUncheckedIndexedAccess`) via
  `@cosyte/tsconfig`. **Target ES2023**, `NodeNext`.
- **Build:** dual ESM + CJS + `.d.ts` via `tsup` (`@cosyte/tsup-config`); `attw` is a publish gate.
- **Node:** **>= 22**.
- **Package manager:** `pnpm@10`.
- **Lint/format:** **ESLint 10** (`@cosyte/eslint-config`) + Prettier (`@cosyte/prettier-config`).
  Lint at `--max-warnings=0`.
- **Testing:** **Vitest 4** + v8 coverage (`@cosyte/vitest-config`). Per-directory >= 90 gates come
  online in Phase 1 when real code lands (P0 holds them at 0 — there is no logic to cover yet).
- **CI/CD:** thin callers of the reusable `cosyte/.github` workflows.
- **Runtime deps:** **Zero.** Node stdlib only.
- **License:** MIT.

## The four architecture ADRs (read before writing any parser code)

Recorded in `documentation/decisions/` at bootstrap because they shape everything:

1. **`0001` — decimal / integer64 representation.** String-backed; MUST preserve lexical precision.
   `0.010` is not `0.01`. **Never** round-trip `decimal`/`integer64` through the JS `number` type —
   that is a silent-data-corruption hazard for doses, lab values, and identifiers.
2. **`0002` — FHIRPath posture.** Implement a bounded, vendored subset in-repo. No runtime
   dependency, no full third-party engine. Needed for invariants + slicing (Phase 7).
3. **`0003` — XML scope.** JSON-first; XML serialization deferred to Phase 8.
4. **`0004` — R4-first.** `4.0.1` is the modeled version (ONC HTI-1 / §170.315(g)(10) anchor). R5 /
   DSTU2 are read-tolerance only.

## Engineering Guardrails

- No `any`. No unjustified `as` casts. Use `unknown` and narrow.
- JSDoc (with `@example`) on every public export — feeds IntelliSense.
- Immutable by default. Mutation only via explicit methods.
- No `console.*` in library code. Throw typed errors or return results.
- Postel's Law: the reader is liberal (lenient default + warnings), the writer is conservative
  (always emits spec-clean FHIR).
- **PHI discipline:** synthetic-only fixtures, redaction in logs. Never commit realistic PHI. A
  vendor quirk is encoded only when a real de-identified resource grounds it — never invented.

## Standing disciplines (every change)

Mirrors the three disciplines in the meta-repo's `documentation/conventions.md` — they bind here too:

1. **Documentation follows code** — a change to the public surface/stack/status isn't done until the
   docs are: this repo's docs, the meta-repo `documentation/repos/fhir.md`, and the
   `ecosystem-map.md` status table.
2. **Version + changelog** — a Changeset (`patch` on the `0.0.x` ladder) + a `CHANGELOG.md`
   `[Unreleased]` entry per meaningful change.
3. **Crew + knowledgebase loop** — if the public API changes, flag/update the matching `crew`
   healthcare skill (`fhir-resource-design`) + the KB product doc.
