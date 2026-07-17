# @cosyte/fhir

> Developer-focused FHIR toolkit for Node.js and TypeScript — an **R4-first** resource model, a
> JSON codec, and validation, with the same one-line ergonomics as the rest of the `@cosyte/*`
> parser suite.

**Status: pre-alpha (`0.0.0`, unpublished).** **Phases 1–3 have landed** — the no-data-loss core (a
precision-preserving JSON codec and typed primitive model), the first three validation layers
(structure, cardinality, and primitive/enumerated-`code` value-domain) with value-free
`OperationOutcome` output, and the **safety-critical status & negation model** (`readSafety`,
fail-closed on unknown `modifierExtension`, the `ait`/`con`/`obs` invariants — see
[What works today](#what-works-today)). It **reads, round-trips, structurally validates, and never
drops a modifier / status / negation**; it does **not** yet do UCUM/Quantity fidelity (Phase 4),
terminology-binding (Phase 5), profile / US Core / slicing (Phase 6), or general FHIRPath invariant
(Phase 7) validation — and the built-in structural schema set is the base-resource elements plus
`Patient` as a worked demonstrator; other resource types validate only against a caller-supplied
schema. It is **JSON-only** (XML is Phase 8), with no typed per-resource models yet. See the roadmap
in the meta-repo, `operations/roadmaps/fhir.md`. Do not depend on this package.

## What works today

The no-data-loss core: read FHIR R4 JSON into an immutable model and serialize it back, **without
ever losing a decimal, a primitive extension, or an exact 64-bit value**.

```ts
import { parseResource, serializeResource } from "@cosyte/fhir";

const { resource, issues } = parseResource(
  '{"resourceType":"Observation","valueQuantity":{"value":0.010,"unit":"mg"}}',
);

// The trailing zero survives — a naive JSON.parse would have made this 0.01.
serializeResource(resource); // → {"resourceType":"Observation","valueQuantity":{"value":0.010,"unit":"mg"}}

// Diagnostics are value-free (PHI-safe): a code + a FHIRPath location, never the value.
issues; // → [{ code: "DECIMAL_PRECISION_AT_RISK", severity: "information", expression: "Observation.valueQuantity.value" }]
```

- **`decimal` / `integer64`** are string-backed (`FhirDecimal`, `FhirInteger64`) and never routed
  through the JS `number` type. `FhirDecimal.equals` is precision-sensitive (`0.010 ≠ 0.01`);
  `.equalsValue` compares quantity only.
- **Primitive extensions** (the `_element` sibling) are modeled first-class with **null-padded array
  alignment**; a misaligned value/`_`-array **fails closed** rather than mis-attaching an extension.
- **Lenient read, spec-clean write** (Postel's Law), `resourceType` resolvable in any position, and a
  `parseReference` classifier (relative / absolute / logical / fragment).

And the first three validation layers — structure, cardinality, and primitive/enumerated-`code`
value-domain — with a value-free `OperationOutcome`:

```ts
import { parseResource, validateResource, serializeResource } from "@cosyte/fhir";

const { resource } = parseResource('{"resourceType":"Patient","gender":"masculine","wibble":1}');
const { issues, valid } = validateResource(resource); // lenient (read) mode by default

valid; // → false
issues;
// → [
//   { code: "UNKNOWN_ELEMENT", severity: "warning",  type: "structure",    expression: "Patient.wibble" },
//   { code: "CODE_INVALID",    severity: "error",    type: "code-invalid", expression: "Patient.gender" },
// ]

// Render an OperationOutcome — the diagnostics are value-free (a coded reason + a location, never
// the offending value "masculine"), the Phase-2 PHI redaction chokepoint.
serializeResource(validateResource(resource).toOperationOutcome());
```

- **Layered, severity-tagged** (validation.html): structure (`UNKNOWN_ELEMENT`, `TYPE_MISMATCH`,
  `CHOICE_AMBIGUOUS`), cardinality (`CARDINALITY_MIN`/`_MAX`), value-domain (`PRIMITIVE_INVALID` with
  the R4 datatype regexes, `CODE_INVALID` for required-strength enumerations). Terminology, profile,
  and invariant layers land in later phases.
- **Lenient vs strict:** an unknown element is a `warning` on read and an `error` under `mode: "strict"`.
- **Fail-safe:** never a false error — a resource type with no schema degrades to one informational
  `RESOURCE_NOT_MODELED`, not a wall of false unknowns. Built-in schemas: base-resource elements +
  `Patient`; supply your own via `validateResource(resource, { schemas: [...] })`.

And the safety spine — FHIR's modifier (`?!`) elements, surfaced so they can never be silently dropped
or inverted, and the invariants that harm a patient when read wrong:

```ts
import { parseResource, readSafety, validateResource } from "@cosyte/fhir";

const { resource } = parseResource(
  '{"resourceType":"AllergyIntolerance",' +
    '"clinicalStatus":{"coding":[{"system":"http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical","code":"active"}]},' +
    '"code":{"coding":[{"system":"http://snomed.info/sct","code":"716186003"}]}}',
);

readSafety(resource).negations; // → ["no-known-allergy"]  (a recorded "no allergy", not an allergy TO it)

// An unknown modifierExtension fails closed — the resource cannot be safely processed.
const { resource: quirky } = parseResource(
  '{"resourceType":"Observation","status":"final","modifierExtension":[{"url":"http://vendor.example/x"}]}',
);
validateResource(quirky).issues.map((i) => i.code); // → ["UNHANDLED_MODIFIER_EXTENSION"]
```

- **Never-droppable status/negation:** `readSafety` carries `status` / `clinicalStatus` /
  `verificationStatus` / `doNotPerform` / retraction and a classified `negations` list (`refuted`,
  `no-known-allergy`, `do-not-perform`, `not-taken`, `not-done`, `entered-in-error`) across the six
  safety resource types. `assertSafeToSummarize` **refuses** (throws) rather than flatten past an
  unhandled modifier.
- **Fail-closed on an unknown `modifierExtension`** (`UNHANDLED_MODIFIER_EXTENSION`, error) — FHIR's
  `?!` rule; and **`entered-in-error` surfaced** as `RETRACTED_RESOURCE` (retracted, not data).
- **Invariants** `ait-1`/`ait-2`, `con-3`/`con-4`/`con-5`, `obs-6`/`obs-7`, hand-evaluated from their
  exact R4 FHIRPath (a general FHIRPath engine is Phase 7). This layer surfaces and enforces — it
  never reconciles contradictions or infers clinical meaning.

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
