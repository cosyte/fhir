# @cosyte/fhir — Project Guide for Claude

## Project

**`@cosyte/fhir`** — a developer-focused FHIR parser + utility library for Node.js/TypeScript,
published under the Cosyte brand. Open-source (MIT). The FHIR member of the cosyte parser suite; it
mirrors the API shape of `@cosyte/hl7`, the reference parser.

**North star:** A developer can read a real-world FHIR resource, model it with correct primitive
semantics, and validate it against US Core — without reading the FHIR spec.

## Status

- **Pre-alpha (`0.0.0`, unpublished).** **Phases 1–7 landed.** P7 — invariants via a bounded, vendored
  FHIRPath subset (the sixth-and-final validation layer, ADR 0002): an in-repo FHIRPath **lexer →
  parser → evaluator** (`tokenize` / `parseFhirPath` / `evaluateInvariant`; no runtime dependency, no
  full third-party engine) that evaluates a profile's `constraint[]` against an instance. The subset
  covers the R4 / US Core invariant surface — path/choice navigation, `$this`/`%resource`/`%context`,
  `exists`/`empty`/`not`/`where`/`all`/`select`/`count`/`first`/`last`/`distinct`/`hasValue`/`children`/
  `extension`/`intersect`, three-valued `and`/`or`/`xor`/`implies`, `=`/`!=`/`<`/`>`/`<=`/`>=`/`in`/
  `contains`/`|`, and System-type `is`/`as`/`ofType` — judged by the reference validator's boolean
  coercion (empty → violation, never a silent pass). `collectInvariantIssues` (wired into
  `validateResource({ profiles })`) emits `INVARIANT_VIOLATED` (severity mirrors the constraint's
  `error`|`warning`) or, for **any** expression outside the subset, `INVARIANT_UNCHECKED` (information)
  via `UnsupportedFhirPathError` — surfaced, **never assumed to pass** (roadmap §6 fail-safe).
  `loadStructureDefinition` now parses `constraint[]` (`ElementConstraint`); `generateSnapshot`
  accumulates invariants down the derivation chain. The seven named safety invariants
  (`ait`/`con`/`obs`) stay owned by the always-on Phase-3 safety layer (the engine skips those keys and
  covers every other constraint). Deferred, fail-safe intact: `type`/`profile` slicing discriminators
  and reslicing (still `PROFILE_SLICE_UNCHECKED`); bundled US Core IG corpus + `validator_cli.jar`
  differential (Phase 11). P6 — StructureDefinition + US Core
  profile validation (the sixth layer): `loadStructureDefinition`; **snapshot generation** from a
  differential (`generateSnapshot` walks `baseDefinition`, merges/tightens by id, inserts slices, fails
  closed with `FhirProfileError` on an unresolvable base / cycle); **slicing** (`resolveSlices` /
  `matchSlices` — R4 discriminators `value|exists|pattern|type|profile`, **`position` R5-only and
  excluded**; unsupported/insufficient discriminators → `PROFILE_SLICE_UNCHECKED`, never silently
  passed); **`fixed[x]` (exact) vs `pattern[x]` (subset)** via `matchesFixed` / `matchesPattern`
  (decimals precision-exact); **must-support as a system obligation** (`MUST_SUPPORT_ABSENT` is
  **information, never error** — not instance-presence); multi-version `PROFILE_VERSION_MISMATCH`
  against `meta.profile` pins; a bounded path navigator (`resolvePath` / `pathExists`). Runs inside
  `validateResource(resource, { profiles, resolveBase })`; **no profile content is bundled** (US
  Core/vendor SDs are supplied by the caller). Deferred: bundled US Core IG corpus + `validator_cli.jar`
  differential (Phase 11); `type`/`profile` discriminators, reslicing, invariant `constraint`s (Phase
  7 FHIRPath). P5 — Terminology binding validation
  (strength-aware, content-free): a frozen **known-systems registry** (`KNOWN_SYSTEMS` /
  `isKnownSystem`, the verified §5 `system` URIs as identities — no SNOMED/CPT/LOINC content vendored,
  ICD-10-PCS/HCPCS deliberately omitted per §10); **binding-strength severity** (`required` → error,
  `extensible` → error-unless, `preferred` → warning, `example` → info and never an error) via
  `TERMINOLOGY_BINDINGS` / `buildBindingRegistry`; content-free system checks (`CODE_SYSTEM_UNEXPECTED`
  for a known system outside the binding's value set, `CODE_SYSTEM_UNKNOWN` info for an unrecognized
  one); the roadmap-named **multi-system** bindings (allergy substance RxNorm + SNOMED, medication
  RxNorm); and a **pluggable terminology-service interface** (`TerminologyService`, none bundled) that
  gates the only membership finding (`CODE_NOT_IN_VALUESET`) — with no service, checks degrade to the
  content-free system level and never false-error (roadmap §5). `collectTerminologyIssues` runs inside
  `validateResource(resource, { terminology, bindings })`. P4 — Quantity / UCUM fidelity (results
  & doses): `readObservationValue` discriminates the **11-way `Observation.value[x]` choice** (branch
  on the present type — a `"POSITIVE"` string or a `1:64` titer is never read as a number); the
  machine-actionable unit is the UCUM **`code`** (not the `unit` string), shape-checked
  (`validateUcumShape`) but never converted; **vital-signs required-unit** conformance
  (`VITAL_SIGN_UNIT_NONCONFORMANT`) against the profile's closed table; UCUM shape warnings
  (`UCUM_UNIT_UNRECOGNIZED`) and `VALUE_TYPE_UNEXPECTED`; dose `Quantity` for
  MedicationRequest/Statement; `interpretation`/`referenceRange` surfaced but never evaluated. P1 —
  the no-data-loss core: a
  precision-preserving JSON codec (`parseResource` / `serializeResource` / `readRawJson`), the
  string-backed `FhirDecimal` / `FhirInteger64` primitives (ADR 0001), the primitive-extension
  (`_`-sibling) model with null-padded array alignment, an immutable generic element model
  (`FhirComplex` / `FhirList` / `FhirPrimitive`), `parseReference`, and value-free diagnostics. P2 —
  the first three validation layers (`validateResource`: structure, cardinality, primitive /
  enumerated-`code` value-domain) with a value-free `OperationOutcome` and the PHI redaction
  chokepoint. P3 — the safety-critical status & negation spine (`readSafety`, fail-closed on an
  unknown `modifierExtension`, `entered-in-error` retraction, and the `ait`/`con`/`obs` invariants).
  Reads, round-trips, structurally validates, never drops a modifier / status / negation, and now
  surfaces measured values by their true `value[x]` type with UCUM-`code` unit fidelity (P4, never
  converting a unit), and validates code `system`s + binding strength content-free (P5, no
  terminology content vendored), and validates resources against caller-supplied US Core / vendor
  `StructureDefinition`s — snapshot generation, slicing, fixed/pattern, must-support-as-obligation
  (P6, no profile content bundled) — and evaluates profile `constraint[]` invariants through a bounded
  in-repo FHIRPath engine, reporting anything outside the subset `INVARIANT_UNCHECKED` rather than
  passing it (P7) — but with **no** `type`·`profile` slicing discriminators / reslicing (still
  `PROFILE_SLICE_UNCHECKED`) or XML (P8) yet, no bundled US Core IG corpus or `validator_cli.jar`
  differential (P11), no code-validity / value-set-membership guarantee without a supplied
  terminology service, and no typed per-resource models. The roadmap lives in
  the meta-repo: `operations/roadmaps/fhir.md` (P0…P11).

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
