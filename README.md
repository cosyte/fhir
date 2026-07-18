# @cosyte/fhir

> Developer-focused FHIR toolkit for Node.js and TypeScript — an **R4-first** resource model, a
> JSON **and XML** codec, and validation, with the same one-line ergonomics as the rest of the
> `@cosyte/*` parser suite.

**Status: pre-alpha (`0.0.0`, unpublished).** **Phases 1–9 have landed** — the no-data-loss core (a
precision-preserving JSON codec and typed primitive model), the first three validation layers
(structure, cardinality, and primitive/enumerated-`code` value-domain) with value-free
`OperationOutcome` output, the **safety-critical status & negation model** (`readSafety`,
fail-closed on unknown `modifierExtension`, the `ait`/`con`/`obs` invariants), **Quantity / UCUM
fidelity** (the 11-way `Observation.value[x]` discrimination, UCUM-`code` unit fidelity, vital-signs
required-unit conformance, dose quantities), **strength-aware, content-free terminology binding
validation** (a frozen known-systems registry, binding-strength severity, the multi-system allergy /
medication bindings, and a pluggable terminology-service interface — none bundled),
**StructureDefinition-driven profile validation** (snapshot generation, slicing, `fixed[x]` /
`pattern[x]`, and must-support as a system obligation — against caller-supplied US Core / vendor
profiles, none bundled), and **profile-invariant validation through a bounded, vendored FHIRPath
subset** (an in-repo lexer → parser → evaluator that evaluates a profile's `constraint[]`, reporting
anything outside the subset `INVARIANT_UNCHECKED` rather than passing it), and a **zero-dependency XML
codec** (`parseResourceXml` / `serializeResourceXml`) that reads and writes the same schema-free model
as the JSON codec — with a reader that is **XXE- and billion-laughs-proof by refusal** (any DTD or
non-predefined entity is refused loudly, never resolved or expanded) and a `nodesEquivalent` oracle for
JSON↔XML model equivalence, and **Bundles + references + Bulk NDJSON streaming** (`readBundle` with
**transaction = all-or-nothing vs batch = independent** semantics — modeled, never executed; reference
resolution for relative / absolute / logical / `#fragment` with a **DoS-safe cycle guard**; and a
`streamNdjson` reader with **per-line error isolation** and **no whole-file load**), and a
**programmatic profile-authoring API** (`defineProfile()` builds a `StructureDefinition` in code — the
same model `loadStructureDefinition` reads from JSON, one path with no privileged internal shape — plus
a spec-grounded **starter kit** of example profiles that dogfood it) — see
[What works today](#what-works-today). It **reads, round-trips,
structurally validates, never drops a modifier / status / negation, surfaces measured values by their
true type with the UCUM `code`** (never the display string, never converted), **validates code systems
and binding strength without vendoring any SNOMED / CPT / LOINC content, validates against US Core
profiles you supply, and evaluates their FHIRPath invariants** (failing safe to `INVARIANT_UNCHECKED`
on any unsupported expression); it does **not** yet do `type`·`profile` slicing discriminator or
reslicing validation (still `PROFILE_SLICE_UNCHECKED`, Phase 7 deferral), and it bundles **no** US Core
IG corpus or `validator_cli.jar` differential (Phase 11). The built-in structural schema set is the base-resource elements plus
`Patient` as a worked demonstrator; other resource types validate only against a caller-supplied schema
or profile. Without a supplied terminology service there is **no code-validity / value-set-membership**
guarantee beyond `system` + strength (no terminology content is bundled — licensing). Its XML codec is
schema-free like the JSON one, so an XML-sourced primitive is kept as its lexical string and **typed
cross-format transcoding** (emitting spec-clean JSON booleans/numbers from an XML model) needs the
datatype schema and is not yet done; the XHTML **structure** inside `Narrative.div` is not modeled or
validated (carried opaquely as a string — the JSON codec's fidelity — never dropped), and RDF/Turtle is
out of scope. It has no typed per-resource models
yet, and it **never converts a unit** or evaluates a reference range. See the roadmap in the meta-repo,
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
  exact R4 FHIRPath by the always-on safety layer. This layer surfaces and enforces — it
  never reconciles contradictions or infers clinical meaning. Every **other** profile `constraint[]`
  invariant is evaluated by the Phase-7 FHIRPath engine (below).

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

And StructureDefinition-driven **profile validation** (US Core the target) — snapshot generation,
slicing, `fixed[x]` / `pattern[x]`, and **must-support as a system obligation**. Like the terminology
layer it ships the _engine_, not the _content_: you supply the profiles (the published US Core /
vendor `StructureDefinition`s), and **nothing is bundled**.

```ts
import { loadStructureDefinition, parseResource, validateResource } from "@cosyte/fhir";

// Load a US Core profile (its published JSON) into a StructureDefinition.
const profile = loadStructureDefinition(parseResource(usCoreAllergyProfileJson).resource);

const { resource: allergy } = parseResource(
  '{"resourceType":"AllergyIntolerance",' +
    '"clinicalStatus":{"coding":[{"code":"active"}]},' +
    '"code":{"coding":[{"code":"227493005"}]},"patient":{"reference":"Patient/1"}}',
);

// verificationStatus is must-support and absent → information, NEVER an error (the resource stays valid).
const { issues, valid } = validateResource(allergy, { profiles: profile ? [profile] : [] });
valid; // → true
issues.map((i) => `${i.code}/${i.severity}`); // → ["MUST_SUPPORT_ABSENT/information", …]
```

- **Snapshot generation** (`generateSnapshot` / `snapshotElements`) walks `baseDefinition` and merges
  the differential onto the base snapshot — tightening matched elements by id, inserting slices, and
  failing closed (`FhirProfileError`) on an unresolvable base or a `baseDefinition` cycle. A caller
  supplies the base via a resolver; a profile that already ships a snapshot is used as-is.
- **Slicing** matches each occurrence of a sliced element to a slice by its discriminators. The R4
  set is `value | exists | pattern | type | profile` (**`position` is R5-only** and excluded). What
  needs a FHIRPath engine (`type` / `profile` discriminators, reslicing — Phase 7) is reported
  `PROFILE_SLICE_UNCHECKED` (`information`) — **never silently passed**. An unmatched occurrence under
  `closed` slicing is `PROFILE_SLICE_UNMATCHED` (error); a missing required slice is `CARDINALITY_MIN`.
- **`fixed[x]` vs `pattern[x]`** (`matchesFixed` / `matchesPattern`) — `fixed` is exact equality
  (nothing extra), `pattern` is a subset (extras allowed); decimals compared precision-exactly, never
  via a float. A mismatch is `PROFILE_FIXED_MISMATCH` / `PROFILE_PATTERN_MISMATCH` (error).
- **Must-support is a system obligation, not instance-presence** — an absent must-support element is
  `MUST_SUPPORT_ABSENT` at **`information`, never an error**. A strict client that rejects an absent
  must-support element is the classic interop bug this rule exists to prevent (roadmap §4/§8).
- **Multi-version** — a `meta.profile` `canonical|version` pin the supplied set carries at a different
  version is `PROFILE_VERSION_MISMATCH` (warning) rather than a silent best-effort validation.
- **Invariants** — the profile's `constraint[]` (FHIRPath) are evaluated by a **bounded, vendored
  FHIRPath engine** (`tokenize` / `parseFhirPath` / `evaluateInvariant`; ADR 0002 — no runtime
  dependency). A violated constraint is `INVARIANT_VIOLATED` (severity mirroring its `error` |
  `warning`); an expression outside the subset raises `UnsupportedFhirPathError` and is reported
  `INVARIANT_UNCHECKED` (`information`) — **surfaced, never assumed to pass**. The seven named safety
  invariants stay owned by the always-on safety layer; the engine covers every other constraint.
- **Deferred:** the bundled multi-version US Core IG corpus and the `validator_cli.jar` differential
  (a JVM dev/CI job — Phase 11); the `type` / `profile` slicing discriminators and reslicing (still
  `PROFILE_SLICE_UNCHECKED` — a genuine fail-safe deferral, they need per-occurrence type carriage /
  recursive profile resolution). Every finding is **value-free** (a code + a FHIRPath location).

```ts
import { evaluateInvariant, parseResource } from "@cosyte/fhir";

// The bounded FHIRPath engine, judged by the reference validator's boolean coercion.
const { resource } = parseResource(
  '{"resourceType":"Observation","valueString":"x","dataAbsentReason":{"text":"n"}}',
);
evaluateInvariant("dataAbsentReason.empty() or value.empty()", resource, resource);
// → { unchecked: false, satisfied: false }  (obs-6 violated: value AND dataAbsentReason both present)

evaluateInvariant("descendants().count() > 0", resource, resource);
// → { unchecked: true, satisfied: false }  (descendants() is outside the subset — never a false pass)
```

**Authoring a profile in code — `defineProfile()` (Phase 10, half a).** You don't have to hand-write
`StructureDefinition` JSON. `defineProfile(spec)` builds one from an ergonomic spec and returns the
**same model** `loadStructureDefinition` produces — so it flows straight into
`validateResource({ profiles })`. There is **one authoring path, no privileged internal shape**: the
built-in starter profiles are `defineProfile()` calls, exactly what you write. As a conservative
writer it throws a value-free `InvalidProfileError` on an author mistake (a missing `url` / `type` /
element `path`, a bad cardinality, a `max` below `min`).

```ts
import { defineProfile, parseResource, primitive, validateResource } from "@cosyte/fhir";

const finalOnly = defineProfile({
  url: "https://example.org/StructureDefinition/final-observation",
  type: "Observation",
  differential: [
    { path: "Observation.status", fixed: { type: "Code", value: primitive("final") } },
  ],
});

const { resource } = parseResource('{"resourceType":"Observation","status":"preliminary"}');
validateResource(resource, { profiles: [finalOnly] }).issues.map((i) => i.code);
// → ["PROFILE_FIXED_MISMATCH", …]
```

A publishable **profile starter kit** ships as worked examples / templates you extend —
`VITAL_SIGN_OBSERVATION_STARTER` (required `status`, must-support `code`, and a **sliced** `category`
— a required `VSCat` slice pins the `vital-signs` coding while the open slicing still allows other
categories, the way the real profile does) and `PATIENT_IDENTIFIER_STARTER` (`identifier` / `.system`
/ `.value` required + must-support, deliberately **no** MRN slice), plus `STARTER_PROFILES`,
`starterProfile(url)`, and `STARTER_PROFILE_BASE_URL`. Each is grounded in a public FHIR / US Core
spec page, self-contained (differential-only, no bundled base), and clearly a template — **not** an
authoritative vendor conformance statement.

```ts
import { STARTER_PROFILES, parseResource, validateResource } from "@cosyte/fhir";

const { resource } = parseResource(vitalSignObservationJson);
validateResource(resource, { profiles: [...STARTER_PROFILES] });
```

- **Deferred to `REAL-CORPUS`:** the Tier-2 real-vendor **quirk** corpus (Epic/Cerner/athena
  missing-must-support, vendor extensions, paging, version drift, scientific-notation decimals,
  `_element` misalignment) and its `validator_cli.jar` differential, and named real-vendor profiles. A
  quirk is encoded only when a **real de-identified vendor document** grounds it — none exists yet, so
  it is not invented. The synthetic spec-clean fixtures here exercise the API; they assert no vendor
  misbehavior.

### 8. XML codec + cross-format equivalence (Phase 8)

A **zero-dependency** FHIR XML codec that reads and writes the **same schema-free model** as the JSON
codec — so a resource is equivalent whichever wire format it arrived in. The hand-written reader is
**XXE- and billion-laughs-proof by refusal**: it refuses any `<!DOCTYPE` (a DTD is the only place XML
can declare an entity) and any entity reference beyond the five predefined names and numeric character
references, performs no I/O, resolves no URI, and bounds nesting depth — adversarial input is a typed
`FhirXmlError`, never a hang, OOM, fetch, or crash.

- **`parseResourceXml`** returns the same `ReadResult` (`{ resource, issues }`) as `parseResource`,
  mapping the FHIR XML conventions (element name → `resourceType`, `value` attribute → primitive value
  kept as its lexical string, `id`/`extension` co-located, repeated elements → a list, resource-valued
  elements unwrapped, narrative `Narrative.div` carried opaquely as its full XHTML string — the FHIR
  JSON representation — so it round-trips as conformant `<div>…</div>`, never dropped). Lenient: an
  unexpected namespace or stray text is preserved-and-flagged (`UNEXPECTED_XML_CONTENT`), never rejected.
- **`serializeResourceXml`** emits compact, spec-clean FHIR XML that round-trips a spec-clean document
  **byte-for-byte** (decimals byte-exact, never through a `number`).
- **`nodesEquivalent`** is the JSON↔XML equivalence oracle — equal _modulo_ the two irreducible
  schema-free ambiguities and only those: primitive lexical form (JSON `true`/number tokens ≡ XML
  `value`-attribute strings) and singleton lists (an array-of-one ≡ a single repeated element).

```ts
import {
  parseResource,
  parseResourceXml,
  serializeResourceXml,
  nodesEquivalent,
} from "@cosyte/fhir";

const xml =
  '<Patient xmlns="http://hl7.org/fhir"><active value="true"/>' +
  '<name><given value="Jane"/></name></Patient>';

const fromXml = parseResourceXml(xml).resource;
const fromJson = parseResource(
  '{"resourceType":"Patient","active":true,"name":[{"given":["Jane"]}]}',
).resource;
nodesEquivalent(fromXml, fromJson); // true — same model from either wire format
serializeResourceXml(fromXml) === xml; // true — spec-clean round-trip

// The reader refuses an XXE / entity-expansion attack loudly, never resolving or expanding it:
parseResourceXml('<!DOCTYPE x [ <!ENTITY e SYSTEM "file:///etc/passwd"> ]><Patient/>');
// throws FhirXmlError { code: "DTD_FORBIDDEN" }
```

### 9. Bundles, references, and Bulk NDJSON streaming (Phase 9)

Read a `Bundle` into an explicit readout with the one semantic distinction a consumer must never blur —
**`transaction` is all-or-nothing, `batch` is independent** — resolve the references inside it with a
**DoS-safe cycle guard**, and stream a Bulk Data `$export` line by line with **per-line error isolation
and no whole-file load**. The Bundle _artifact_ and its semantics are modeled; a transaction is **never
executed** (there is no server here).

- **`readBundle` / `entryProcessing` / `isAtomicBundle`** — the `Bundle.type` (`BUNDLE_TYPES`) and its
  entry-processing contract: `transaction` → `"atomic"` (all-or-nothing), `batch` → `"independent"`,
  everything else → `"none"`. `Bundle.total` is a lexical string, never a JS `number`.
- **`resolveReference` / `buildBundleIndex` / `containedIndex`** — resolve relative / absolute /
  logical / `#fragment` references against a Bundle + `contained` closure. A local miss is
  `"unresolved"` (flagged, preserved); an external target is `"external"` (never false-flagged).
- **`hasContainedCycle` / `MAX_REFERENCE_DEPTH`** — a bounded, iterative (heap-based) cycle guard: a
  `contained` reference cycle is **detected and reported, never followed** — no infinite loop, no stack
  blow-up, no false positive on a legitimate DAG.
- **`streamNdjson` / `parseNdjsonLine`** — a streaming `application/fhir+ndjson` reader over any chunk
  iterable, one resource per line, each read through the precision-preserving codec (a decimal never
  through a `number`). A malformed line is isolated (reported by **line number, never content**), the
  stream continues, and memory stays bounded (`LINE_TOO_LONG`).
- **New findings** (in `validateResource` for a `Bundle`): `REFERENCE_UNRESOLVED` (warning, preserved),
  `CONTAINED_CYCLE` (error), `FULLURL_ID_MISMATCH` (error — a `urn:uuid` fullUrl is exempt). All
  value-free (a FHIRPath location, never a value, reference, or id).

```ts
import { parseResource, readBundle, validateResource, streamNdjson } from "@cosyte/fhir";

const { resource } = parseResource(
  '{"resourceType":"Bundle","type":"transaction","entry":[' +
    '{"fullUrl":"urn:uuid:1","resource":{"resourceType":"Patient","id":"1"},' +
    '"request":{"method":"POST","url":"Patient"}}]}',
);

readBundle(resource).atomic; // true — a transaction is all-or-nothing (a batch would be false)

// A contained reference cycle is a bounded, typed finding — never an infinite loop:
const { issues } = validateResource(
  parseResource(
    '{"resourceType":"Bundle","type":"collection","entry":[{"resource":' +
      '{"resourceType":"Observation","id":"o","contained":[' +
      '{"resourceType":"Observation","id":"a","hasMember":[{"reference":"#b"}]},' +
      '{"resourceType":"Observation","id":"b","hasMember":[{"reference":"#a"}]}]}}]}',
  ).resource,
);
issues.some((i) => i.code === "CONTAINED_CYCLE"); // true

// Stream a Bulk NDJSON export without loading the file; a bad line is isolated, not fatal:
for await (const record of streamNdjson(readableChunks)) {
  if (record.error)
    console.warn("bad line", record.error.line); // line number, never content
  else handle(record.resource);
}
```

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
