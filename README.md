# @cosyte/fhir

> Developer-focused FHIR toolkit for Node.js and TypeScript — an **R4-first** resource model, a
> JSON codec, and validation, with the same one-line ergonomics as the rest of the `@cosyte/*`
> parser suite.

**Status: pre-alpha (`0.0.0`, unpublished).** **Phases 1–5 have landed** — the no-data-loss core (a
precision-preserving JSON codec and typed primitive model), the first three validation layers
(structure, cardinality, and primitive/enumerated-`code` value-domain) with value-free
`OperationOutcome` output, the **safety-critical status & negation model** (`readSafety`,
fail-closed on unknown `modifierExtension`, the `ait`/`con`/`obs` invariants), **Quantity / UCUM
fidelity** (the 11-way `Observation.value[x]` discrimination, UCUM-`code` unit fidelity, vital-signs
required-unit conformance, dose quantities), and **strength-aware, content-free terminology binding
validation** (a frozen known-systems registry, binding-strength severity, the multi-system allergy /
medication bindings, and a pluggable terminology-service interface — none bundled — see
[What works today](#what-works-today)). It **reads, round-trips, structurally validates, never drops
a modifier / status / negation, surfaces measured values by their true type with the UCUM `code`
(never the display string, never converted), and validates code systems and binding strength without
vendoring any SNOMED / CPT / LOINC content**; it does **not** yet do profile / US Core / slicing
(Phase 6) or general FHIRPath invariant (Phase 7) validation — and the built-in structural schema set
is the base-resource elements plus `Patient` as a worked demonstrator; other resource types validate
only against a caller-supplied schema. Without a supplied terminology service there is **no
code-validity / value-set-membership** guarantee beyond `system` + strength (no terminology content is
bundled — licensing). It is **JSON-only** (XML is Phase 8), with no typed per-resource models yet, and
it **never converts a unit** or evaluates a reference range. See the roadmap in the meta-repo,
`operations/roadmaps/fhir.md`. Do not depend on this package.

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

And Quantity / UCUM fidelity — read a measured value by the type it actually is, and its unit by the
UCUM **`code`** a machine may act on (never the display string, and **never converted**):

```ts
import { parseResource, readObservationValue, validateResource } from "@cosyte/fhir";

// value[x] is an 11-way choice — a non-numeric result is never read as a number.
const { resource: titer } = parseResource(
  '{"resourceType":"Observation","status":"final","valueString":"POSITIVE"}',
);
const v = readObservationValue(titer);
v?.type; // → "String"     (NOT "Quantity")
v?.quantity; // → undefined (no number is fabricated)

// A vital sign's unit is checked on the UCUM code, case- and bracket-exact: "mmHg" is not "mm[Hg]".
const { resource: bp } = parseResource(
  '{"resourceType":"Observation","status":"final",' +
    '"category":[{"coding":[{"system":"http://terminology.hl7.org/CodeSystem/observation-category","code":"vital-signs"}]}],' +
    '"code":{"coding":[{"system":"http://loinc.org","code":"8480-6"}]},' +
    '"valueQuantity":{"value":120,"unit":"mmHg","system":"http://unitsofmeasure.org","code":"mmHg"}}',
);
validateResource(bp).issues.map((i) => i.code); // → ["VITAL_SIGN_UNIT_NONCONFORMANT"]  (should be "mm[Hg]")
```

- **`readObservationValue`** discriminates the 11 `value[x]` variants (`Quantity`, `CodeableConcept`,
  `String`, `Boolean`, `Integer`, `Range`, `Ratio`, `SampledData`, `Time`, `DateTime`, `Period`) by
  the one present — `quantity` is populated **only** for a `Quantity`. `readQuantity` keeps the coded
  unit (`code`/`system`) distinct from the human `unit`; `validateUcumShape` checks a code's shape.
- **Vital-signs required-unit** conformance (`VITAL_SIGN_UNIT_NONCONFORMANT`, error) against the FHIR
  profile's closed table, compared on the UCUM `code`; a UCUM-declared unit that is absent or malformed
  is `UCUM_UNIT_UNRECOGNIZED` (warning, preserved verbatim); a vital sign whose value is not a Quantity
  is `VALUE_TYPE_UNEXPECTED` (warning).
- **Dose `Quantity`** (`readMedicationDoses`) for MedicationRequest/Statement, and
  `interpretation` / `referenceRange` surfaced (`readInterpretations` / `readReferenceRanges`) —
  **never** used to auto-convert a unit or compute an abnormal flag.

And terminology binding validation — strength-aware and **content-free**: validate a coding's code
`system` and its binding **strength** without bundling any SNOMED / CPT / LOINC concept tables, and
never raise a false error when no terminology service is configured:

```ts
import { parseResource, validateResource, type TerminologyService } from "@cosyte/fhir";

// AllergyIntolerance.code binds extensibly to a multi-system value set (RxNorm + SNOMED). An
// ICD-10-CM code is a KNOWN but unexpected system for this binding → a warning, never an error.
const { resource: allergy } = parseResource(
  '{"resourceType":"AllergyIntolerance",' +
    '"clinicalStatus":{"coding":[{"system":"http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical","code":"active"}]},' +
    '"code":{"coding":[{"system":"http://hl7.org/fhir/sid/icd-10-cm","code":"T78.40XA"}]}}',
);
validateResource(allergy).issues.map((i) => `${i.code}/${i.severity}`);
// → ["RESOURCE_NOT_MODELED/information", "CODE_SYSTEM_UNEXPECTED/warning"]  (valid stays true)

// Value-set membership needs content the library does not bundle — supply a terminology service.
const svc: TerminologyService = {
  validateCode: ({ code }) => ({ membership: code === "7980" ? "in" : "not-in" }),
};
validateResource(allergy, { terminology: svc }); // now membership is checked against your service
```

- **Frozen known-systems registry** (`KNOWN_SYSTEMS`, `isKnownSystem`) — the verified §5 `system`
  URIs (LOINC, SNOMED, RxNorm, ICD-10-CM/9-CM, CPT, UCUM, NDC, CVX) as **identities, not content**.
  An unrecognized system is `CODE_SYSTEM_UNKNOWN` (`information`) — not a defect, just unvalidatable.
- **Binding-strength severity:** `required` → error, `extensible` → error-unless, `preferred` →
  warning, `example` → information (an example binding **never** errors). A known system outside a
  binding's value set is `CODE_SYSTEM_UNEXPECTED` (strength-scaled); a service's definitive `not-in`
  is `CODE_NOT_IN_VALUESET`. Built-in **multi-system** bindings: allergy substance (RxNorm + SNOMED),
  medication (RxNorm).
- **Pluggable terminology service** (`TerminologyService`) — the one seam for value-set content, and
  **none is bundled** (licensing). With none supplied, checks degrade to the content-free system
  level and **never false-error**; the service receives only identities, never a resource value.

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
