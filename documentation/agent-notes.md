# @cosyte/fhir agent notes

The narrative half of this repo's `CLAUDE.md`, relocated here on 2026-08-04 under `CLAUDE-MD-AUDIT`
(the 2026-08-04 amendment to the meta-repo's `documentation/decisions/0023-doc-budgets.md`).

**Nothing was deleted and nothing was rewritten.** Every paragraph below is the verbatim text that
used to sit in `CLAUDE.md`, in its original order, with headings added so it can be found.
`CLAUDE.md` keeps the cursor, the rules, and every trap as a one-line imperative pointing at the
section here that carries the incident it came from. These are clinical-safety lessons that each
cost a defect or a refuted gate pass to learn: **relocate them, never delete them.**

## Publish state (`FHIR-NPM-NAME`)

- **Pre-alpha, unpublished on npm.** No version of `@cosyte/fhir` has ever reached the registry, and
  the repo carries no git tag and no GitHub release, because the release job never gets past the
  publish. Every attempt is refused by npm with a bare `E403` on
  `PUT https://registry.npmjs.org/@cosyte%2ffhir` (FHIR-NPM-NAME; support request filed 2026-07-23,
  still open). `package.json` runs ahead of the registry rather than behind it, so read the
  version there and never infer it from npm.
  - **The "name-similarity" reading is RETRACTED. Do not rename or rescope the package on it.** npm
    has never named similarity or the unscoped `fhir` package in anything it returned; the only body
    it sends is its generic "forbidden by your security policy, or on a server you do not have
    access to" boilerplate. npm confirmed an unrelated incident and it was **not** the cause: retried
    after the fix, still `E403`.
  - **What is actually measured**, most recently on the `0.0.8` attempt of 2026-08-04 (run
    [30915771713](https://github.com/cosyte/fhir/actions/runs/30915771713), `PUT` refused
    `2026-08-04T13:52:56Z`):
    - The provenance statement is signed and **reaches the sigstore transparency log before the
      registry answers** (`0.0.8` = logIndex `2340587080`, `0.0.7` = `2335029918`, both verified
      present in rekor and decoding to `pkg:npm/%40cosyte/fhir@<version>`). So the refusal is
      registry-side name or permission policy, **not** a signing or provenance failure.
    - The `PUT` is refused in ~45ms with no response body, matching the ~72ms refusal of a local
      publish from a logged-in session. Same failure independent of publish path (OIDC vs classic
      token) and of account session.
    - Brand-new `@cosyte` packages were created on the registry successfully on **2026-07-29**
      (`transform`, `synth`, `cli`) and **2026-07-30** (`deid`), which is after the first `fhir`
      `E403`. Scope-level package creation therefore works, and only this one name is refused.
  - **Do not re-fire a version npm has already traced:** `0.0.2` (logIndex `2228360533`), `0.0.3`
    (`2259690084`), `0.0.7` (`2335029918`), `0.0.8` (`2340587080`).
  - The failing run uploads the npm debug log as an artifact (`npm-debug-log-cosyte-fhir-*`), which
    is what npm support asked for. It is redacted and gated in `cosyte/.github`, and the `0.0.7` and
    `0.0.8` artifacts were both checked by hand: npm 10.9.8 records config file **paths** only, never
    their contents, and no `Authorization` header, so no credential material is present. **This repo
    is public and the artifact is downloadable, so re-check that before ever linking one.**

## Shipped-phase history, P11 back to P1

- **Phases 1–9 landed; P10 landed (halves a + b); P11 buildable
  tiers landed.** P11 (buildable portion; roadmap §6): conformance hardening as gating tests: a
  **JSON+XML+NDJSON fuzz tier** (`test/fuzz.test.ts`, `FUZZ_RUNS`-tunable, a dedicated `fuzz` CI job)
  proving adversarial input never crashes/hangs/OOMs: only a **typed** `FhirCodecError`/`FhirXmlError`
  with a registered fatal, or a bounded rejection; a **PHI-leak tier** (`test/phi-leak.test.ts`, corpus
  sweep + sentinel battery) gating the value-free-diagnostics contract; a **type-level tier**
  (`test/public-types.test.ts`, `expect-type`). The fuzz tier surfaced three read-path robustness
  defects, now fixed: a **decimal DoS** (`0e9999999999999999999` made `FhirDecimal` quantity comparison
  do `10n ** astronomical-scale` → untyped `RangeError`/hang on the read path: now canonical-form
  comparison, no exponentiation, semantics unchanged); an **XML entity prototype-chain bypass**
  (`&constructor;`/`&__proto__;` resolved through `Object.prototype`, bypassing the five-entity
  allowlist: now `Object.hasOwn`-guarded); and a **validator DoS** (a resource property named
  `constructor`/`toString` crashed `validateResource` with an uncaught `TypeError`: now
  `Object.hasOwn`-guarded). New public fatal `FATAL_CODES.MAX_DEPTH_EXCEEDED` (JSON reader bounds
  nesting at 256, matching the XML reader). **Deferred:** the JVM `validator_cli.jar` differential is
  **authored but CI-only** (`scripts/differential.mjs` + a `differential` CI job: no Java in this
  container, not observed green here); as of **P10b** it runs over **both** the synthetic spec-clean
  tier **and** the Tier-2 quirk corpus. P10 (half a):
  the profile growth loop (profiling.html): `defineProfile()` authors a `StructureDefinition` in code
  from an ergonomic `ProfileSpec`/`ProfileElementSpec` and returns the **same model**
  `loadStructureDefinition` produces from JSON (proven byte-for-byte equal for a valid spec: one
  path, **no privileged internal shape**), flowing straight into `validateResource({ profiles })`; a
  conservative writer that throws a value-free `InvalidProfileError` on an author mistake. A
  publishable, spec-grounded **starter kit** (`VITAL_SIGN_OBSERVATION_STARTER`,
  `PATIENT_IDENTIFIER_STARTER`, `STARTER_PROFILES`, `starterProfile`, `STARTER_PROFILE_BASE_URL`)
  dogfoods it: each starter is a `defineProfile()` call, self-contained (differential-only, no bundled
  base), a _template_ not an authoritative vendor conformance statement. **Half (b): the Tier-2
  real-world _quirk_ corpus + the `validator_cli.jar` differential over it, landed (ADR 0018):** five
  quirk fixtures (`test/__fixtures__/quirk-*.json`), each **grounded in a public artifact** and cited
  in `test/quirk-corpus.test.ts` (the provenance record): a non-first `resourceType` (json.html), a
  scientific-notation decimal (Synthea #675, preserved byte-exact + `DECIMAL_PRECISION_AT_RISK`), a
  primitive-extension `_`-sibling misalignment that **fails closed** (HAPI #5738), a searchset Bundle
  `link[next]` that survives the round-trip (bundle-example.json), and US Core race + birthsex
  extensions preserved on a base Patient. Values are synthetic; the PHI-leak sweep auto-covers them.
  ADR 0018 redefined the anti-invention rule's "real document" to include public artifacts, unblocking
  this from `REAL-CORPUS`. A genuinely vendor-**proprietary** deviation absent from every public sample
  stays grounded-only (still forbidden to invent, conventions §PHI); missing-must-support
  (`MUST_SUPPORT_ABSENT`) and version-drift (`PROFILE_VERSION_MISMATCH`) quirks are already covered by
  the Phase-6 profile suite. `scripts/differential.mjs` runs this corpus through the oracle in the
  `differential` CI job (still JVM-only, not observed green here). P9: Bundles, references, Bulk NDJSON
  streaming (bundle.html / references.html / Bulk Data IG): the `Bundle` model + entry-processing
  semantics (`readBundle` / `entryProcessing` / `isAtomicBundle` / `BUNDLE_TYPES`) that keep
  **transaction = all-or-nothing (`"atomic"`) genuinely distinct from batch = independent
  (`"independent"`)**: the artifact + semantics are modeled, transactions are **never executed** (no
  server; stated non-goal); reference resolution (`resolveReference` / `buildBundleIndex` /
  `containedIndex`) for relative / absolute / logical / `#fragment` against a Bundle + `contained`
  closure (a local miss → `"unresolved"`, an out-of-closure target → `"external"`, never
  false-flagged), keyed version-free; a **DoS-safe cycle guard** (`hasContainedCycle` /
  `MAX_REFERENCE_DEPTH`): an iterative, heap-based, three-color DFS that detects and reports a
  contained reference cycle rather than looping (terminates always, no false positive on a DAG); and a
  **streaming `application/fhir+ndjson` reader** (`streamNdjson` / `parseNdjsonLine` /
  `NDJSON_ERROR_CODES`) with **per-line error isolation** (malformed line → isolated value-free error,
  stream continues, reported by line number never content) and **no whole-file load** (only the current
  partial line buffered; an unterminated line cut off `LINE_TOO_LONG` and drained without accumulating),
  each line read through the precision-preserving codec (a decimal never through a JS `number`). New
  value-free findings wired into `validateResource` for a `Bundle`: `REFERENCE_UNRESOLVED` (warning,
  preserved), `CONTAINED_CYCLE` (error), `FULLURL_ID_MISMATCH` (error, `urn:uuid` fullUrl exempt); adds
  the R4 `not-found` `IssueType`. Deferred, fail-safe intact: no transaction **execution**. P8: XML codec + cross-format equivalence
  (xml.html): a **zero-dependency** FHIR XML codec that reads/writes the **same schema-free model** as
  the JSON codec. `parseResourceXml` (→ shared `ReadResult`) / `serializeResourceXml` (spec-clean,
  byte-for-byte round-trip), a hardened raw reader `readRawXml` (→ `XmlElement` tree) that is **XXE- and
  billion-laughs-proof by refusal**: it refuses any `<!DOCTYPE` (`DTD_FORBIDDEN`, closing the XXE and
  billion-laughs vectors at once) and any entity beyond the five predefined + numeric character
  references (`UNDEFINED_ENTITY`), does no I/O, resolves no URI, and bounds depth (`MAX_DEPTH_EXCEEDED`),
  via `FhirXmlError` / `XML_FATAL_CODES`. Mapping: root/contained element name → synthetic
  `resourceType`; `value` attribute → primitive value **kept as its lexical string** (schema-free, no
  datatype guessed, precision never through a `number`); `id`/`extension` co-located (`id` attr + child
  `<extension>`s, the XML `_`-sibling); `Element.id`/`Extension.url` attrs → `id`/`url` props; repeated
  elements → list; resource-valued element unwrapped; narrative `Narrative.div` carried **opaquely** as
  its full XHTML string (the FHIR JSON representation) → round-trips as conformant `<div>…</div>`, never
  dropped/escaped. `nodesEquivalent` is the JSON↔XML equivalence oracle: equal **modulo** primitive
  lexical form and singleton lists (array-of-one ≡ one element), and only those. Lenient reads
  preserve-and-flag an unexpected namespace / stray text (new value-free issue code
  `UNEXPECTED_XML_CONTENT`). Deferred, fail-safe intact: XHTML **structure** inside `div` not
  modeled/validated (carried opaque, never dropped); typed cross-format transcoding (spec-clean JSON
  booleans/numbers from an XML model) needs the datatype schema; an extension-only element with no value
  reads as a primitive (schema-free ambiguity, documented on `nodesEquivalent`, safe direction);
  RDF/Turtle out of scope; XML-fuzz differential vs `validator_cli.jar` (Phase 11). P7:
  invariants via a bounded, vendored
  FHIRPath subset (the sixth-and-final validation layer, ADR 0002): an in-repo FHIRPath **lexer →
  parser → evaluator** (`tokenize` / `parseFhirPath` / `evaluateInvariant`; no runtime dependency, no
  full third-party engine) that evaluates a profile's `constraint[]` against an instance. The subset
  covers the R4 / US Core invariant surface: path/choice navigation, `$this`/`%resource`/`%context`,
  `exists`/`empty`/`not`/`where`/`all`/`select`/`count`/`first`/`last`/`distinct`/`hasValue`/`children`/
  `extension`/`intersect`, three-valued `and`/`or`/`xor`/`implies`, `=`/`!=`/`<`/`>`/`<=`/`>=`/`in`/
  `contains`/`|`, and System-type `is`/`as`/`ofType`, judged by the reference validator's boolean
  coercion (empty → violation, never a silent pass). `collectInvariantIssues` (wired into
  `validateResource({ profiles })`) emits `INVARIANT_VIOLATED` (severity mirrors the constraint's
  `error`|`warning`) or, for **any** expression outside the subset, `INVARIANT_UNCHECKED` (information)
  via `UnsupportedFhirPathError`: surfaced, **never assumed to pass** (roadmap §6 fail-safe).
  `loadStructureDefinition` now parses `constraint[]` (`ElementConstraint`); `generateSnapshot`
  accumulates invariants down the derivation chain. The seven named safety invariants
  (`ait`/`con`/`obs`) stay owned by the always-on Phase-3 safety layer (the engine skips those keys and
  covers every other constraint). Deferred, fail-safe intact: `type`/`profile` slicing discriminators
  and reslicing (still `PROFILE_SLICE_UNCHECKED`); bundled US Core IG corpus + `validator_cli.jar`
  differential (Phase 11). P6: StructureDefinition + US Core
  profile validation (the sixth layer): `loadStructureDefinition`; **snapshot generation** from a
  differential (`generateSnapshot` walks `baseDefinition`, merges/tightens by id, inserts slices, fails
  closed with `FhirProfileError` on an unresolvable base / cycle); **slicing** (`resolveSlices` /
  `matchSlices`: R4 discriminators `value|exists|pattern|type|profile`, **`position` R5-only and
  excluded**; unsupported/insufficient discriminators → `PROFILE_SLICE_UNCHECKED`, never silently
  passed); **`fixed[x]` (exact) vs `pattern[x]` (subset)** via `matchesFixed` / `matchesPattern`
  (decimals precision-exact); **must-support as a system obligation** (`MUST_SUPPORT_ABSENT` is
  **information, never error**, not instance-presence); multi-version `PROFILE_VERSION_MISMATCH`
  against `meta.profile` pins; a bounded path navigator (`resolvePath` / `pathExists`). Runs inside
  `validateResource(resource, { profiles, resolveBase })`; **no profile content is bundled** (US
  Core/vendor SDs are supplied by the caller). Deferred: bundled US Core IG corpus + `validator_cli.jar`
  differential (Phase 11); `type`/`profile` discriminators, reslicing, invariant `constraint`s (Phase
  7 FHIRPath). P5: Terminology binding validation
  (strength-aware, content-free): a frozen **known-systems registry** (`KNOWN_SYSTEMS` /
  `isKnownSystem`, the verified §5 `system` URIs as identities: no SNOMED/CPT/LOINC content vendored,
  ICD-10-PCS/HCPCS deliberately omitted per §10); **binding-strength severity** (`required` → error,
  `extensible` → error-unless, `preferred` → warning, `example` → info and never an error) via
  `TERMINOLOGY_BINDINGS` / `buildBindingRegistry`; content-free system checks (`CODE_SYSTEM_UNEXPECTED`
  for a known system outside the binding's value set, `CODE_SYSTEM_UNKNOWN` info for an unrecognized
  one); the roadmap-named **multi-system** bindings (allergy substance RxNorm + SNOMED, medication
  RxNorm); and a **pluggable terminology-service interface** (`TerminologyService`, none bundled) that
  gates the only membership finding (`CODE_NOT_IN_VALUESET`). With no service, checks degrade to the
  content-free system level and never false-error (roadmap §5). `collectTerminologyIssues` runs inside
  `validateResource(resource, { terminology, bindings })`. P4: Quantity / UCUM fidelity (results
  & doses): `readObservationValue` discriminates the **11-way `Observation.value[x]` choice** (branch
  on the present type: a `"POSITIVE"` string or a `1:64` titer is never read as a number); the
  machine-actionable unit is the UCUM **`code`** (not the `unit` string), shape-checked
  (`validateUcumShape`) but never converted; **vital-signs required-unit** conformance
  (`VITAL_SIGN_UNIT_NONCONFORMANT`) against the profile's closed table; UCUM shape warnings
  (`UCUM_UNIT_UNRECOGNIZED`) and `VALUE_TYPE_UNEXPECTED`; dose `Quantity` for
  MedicationRequest/Statement; `interpretation`/`referenceRange` surfaced but never evaluated. P1:
  the no-data-loss core: a
  precision-preserving JSON codec (`parseResource` / `serializeResource` / `readRawJson`), the
  string-backed `FhirDecimal` / `FhirInteger64` primitives (ADR 0001), the primitive-extension
  (`_`-sibling) model with null-padded array alignment, an immutable generic element model
  (`FhirComplex` / `FhirList` / `FhirPrimitive`), `parseReference`, and value-free diagnostics.

## `FHIR-DUPLICATE-KEY-RETRACTION` (2026-07-28)

**`FHIR-DUPLICATE-KEY-RETRACTION` (2026-07-28) closed a silent, unsafe-direction defect in this
core:** a duplicate JSON property name dropped the later value (first-wins, no issue), so
`{"status":"final",…,"status":"entered-in-error"}` lost the retraction and `readSafety` reported
`retracted: false, safeToSummarize: true`. Of the three separable decisions, **which value wins is
deliberately unchanged** (still first-wins: RFC 8259 §4 leaves it undefined, FHIR json.html forbids
duplicates outright, and last-wins would only move the blind spot); what changed is that the
shadowed member is now **kept** (`FhirComplex.duplicates`, read via `getAllProperties`) and
**reported** (`ISSUE_CODES.DUPLICATE_PROPERTY` warning on read, `VALIDATION_CODES.DUPLICATE_PROPERTY`
**error** in `validateResource`), and that `readSafety` **stops affirming**: **all six** negation reads
now run over every value written for the element each reads (`status`, `verificationStatus`, `code`,
`doNotPerform`), and `codingsOf` reads every `coding` plus every `system`x`code` pair inside a repeated
`Coding` name, so the reported case reads `retracted: true` and a retraction nested one level inside a
`CodeableConcept` is caught too; and any repeated name anywhere sets `safeToSummarize: false` with the
locations in `SafetyReadout.shadowedProperties` (`assertSafeToSummarize` throws). The `_`-sibling was
**last**-wins and silent; it is now first-wins + flagged like everywhere else (its shadowed member is
not modeled: an R4 `Element` carries `id`/`extension` only, so it cannot make a verdict wrong). The
writer still emits one member per name, deliberately: both would be invalid FHIR.
**Refuter pass one (`conformance-refuter`, REFUTED) drove all of that**; it also left two
`PRE-EXISTING` majors/minors as backlog lines, NOT fixed here: `readObservationValue` still returns
one of two written `valueQuantity` values with no signal on its own surface (no issue channel), and
read -> write -> read **launders** the defect (the writer emits the conformant survivor, so the
re-read is `valid: true`, `safeToSummarize: true`); `serializeResource`/`serializeResourceXml` return a
bare string with no channel to say so.

## `FHIR-ARRAY-WRAPPED-SCALAR` (2026-07-28)

**Pass two (NOT REFUTED) filed two more `PRE-EXISTING` ones,
  the first worth queuing ahead of the next slice** -- and **`FHIR-ARRAY-WRAPPED-SCALAR`
  (2026-07-28) closed BOTH of them.** They were: an **array-wrapped `0..1` element** reaching that
  item's exact harm shape with no duplicate key at all (`{"resourceType":"Observation","status":
["entered-in-error"]}` -> `retracted: false`, `negations: []`, `safeToSummarize: true`,
  `valid: true`, zero issues, because `primitiveString` returns `undefined` for a list and there is no
  cardinality check without a per-resource model, and array-wrapping every element is realistic
  generic XML->JSON converter output); and a **duplicated `resourceType` shadowing the type gate**,
  since `typeOf` is a first-wins single-value read (`{"resourceType":"Observation","resourceType":
"MedicationStatement","status":"not-taken"}` -> `negations: []`). **Both are one defect** once you
  see it: the type gate is what every type-scoped negation hangs off, so a single-value read of it is
  the narrowest hole in the whole safety claim, and an array wrapper and a duplicate name are just two
  ways to reach it. The fix has three parts. **(1)** The negation reads read _through_ an array
  wrapper as well as across every written value (`primitiveStrings`/`primitiveBooleans`, internal,
  recursive); `SafetyReadout.status`/`.resourceType` do too. **(2)** `readSafety` considers **every**
  type the document names (`typesOf`, internal); `typeOf` is deliberately **unchanged** and still the
  strict single-value read, because a _structural_ verdict should reject an unreadable type, not guess
  one. **(3)** New `VALIDATION_CODES.ARRAY_WRAPPED_SCALAR` (**error**, `structure`) +
  `SafetyReadout.arrayWrappedScalars` + `arrayWrappedScalars()` (public, mirroring
  `shadowedProperties`), so the library **stops affirming**: `safeToSummarize` is `false` and
  `assertSafeToSummarize` throws. `validateResource` also no longer returns early on an unreadable
  `resourceType` without running the safety layer.
  **The cardinality table is scoped ON PURPOSE and must not be widened casually**
  (`SAFETY_SCALAR_ELEMENTS` = `status`/`clinicalStatus`/`verificationStatus`/`doNotPerform`/`code`, on
  a **resource root** of a `SAFETY_RESOURCE_TYPES` type, plus `resourceType` on any root). It is the
  cardinality of the closed set the safety layer already reads, **not** a per-resource model. A
  name-only, depth-free rule emits a **false error on a conformant document**: `Questionnaire.code`
  and `ElementDefinition.code` are both `0..*` in R4. That bound is pinned by tests in
  `test/array-wrapped-scalar.test.ts` (25 assertions), not asserted in prose.
  **The `conformance-refuter` REFUTED this slice THREE times, and the scope it ended at is narrower
  than the scope it started at. Read this before touching `codingsOf`.** Pass one: the fix covered the
  wrapper around the _element_ but `codingsOf` still read `Coding.system` / `Coding.code` with the
  single-value `primitiveString`, and **those are `0..1` too** (datatypes.html), so one pair of
  brackets around an inner `Coding.code` still produced the item's exact verdict on the three worst
  reads in the library: a **refuted** allergy read as active, a recorded **"no known allergy"** read as
  an allergy _to_ `716186003`, and a retracted Condition read as live. Pass one also caught two factual
  errors, both corrected: the citation (the array rule is json.html **§2.6.2.2**, not §2.1) and
  `MedicationRequest.status` (**`1..1`**, not `0..1`).
  **Pass two and pass three then refuted two successive attempts to close that inner read**, and the
  reason is worth keeping: `Coding.system` and `Coding.code` feed `codingsOf`'s `system` x `code`
  **CROSS-PRODUCT**, so any rule yielding more than one value on either side **manufactures a
  `(system, code)` pair the sender never wrote** -- and `NO_KNOWN_ALLERGY` is the one negation that is
  a **positive clinical assertion**, so inventing it claims a patient has no known allergy over a
  record that names an allergen. Missing a retraction withholds information; asserting an absence of
  allergy does not. **The two directions are not equally safe, which is why the obvious fix is not.**
  Attempt one read every value and manufactured the pair outright. Attempt two read only a
  "single-valued" wrapper and **still** did, because it counted _strings_ rather than _array
  positions_, and a FHIR JSON `null` is a real position marker, not padding (`["716186003", null]` is
  two entries), so `[null, "...sct"]` x `["716186003", null]` still produced `(sct, 716186003)`.
  **So `codingsOf` was reverted to its `main` behaviour and the inner wrapper was left a DECLARED GAP,
  not a claim.** That was the ADR 0016 termination call: the same sub-problem had failed to converge
  twice, there is no fourth pass, and a pure revert ships no ungraded behaviour. Everything that slice
  shipped is element-level and was graded green.

## `FHIR-CODING-SCALAR-WRAPPER` (2026-07-29)

**`FHIR-CODING-SCALAR-WRAPPER` (2026-07-29) then closed it, on the third grading.** The predicate
that held is **at most one value per written member**: `codingScalar` (private, in `src/safety/codes.ts`)
reads a wrapper only where it holds **exactly one ARRAY POSITION**, so `systems` and `codes` have
precisely the lengths they had when a wrapper read as `undefined` and **the cross-product cannot
grow** -- unwrapping can only fill in a value, never add a pair. The clean statement of that, and
what the tests pin, is **transparency**: a single-position wrapper yields the same codings as the
same document with the wrapper removed, so unwrapping decides nothing on its own and any invention
that remains is the pre-existing duplicate-name cross-product's, not the wrapper's. Positions, not
strings, is what killed attempt two, and `codingScalar` counts `items.length`. The second half is
**the refusal to affirm**: `SAFETY_CODEABLE_ELEMENTS` (`clinicalStatus`/`verificationStatus`/`code`)
drives a `Coding`-level check in `checkArrayWrapping`, so **every** wrapper there (read or unread)
reports `<element>.coding[i].{system,code}` as `ARRAY_WRAPPED_SCALAR` and sets
`safeToSummarize: false`. That is what makes leaving the multi-position case unread safe rather than
silent. It needs no per-resource cardinality (`Coding` is a datatype, its `system`/`code` are `0..1`
everywhere), so unlike the element-level rule it cannot false-positive. **No public API changed.**
One direction to know: reading a wrapper can now retire an `ait-1`/`con-4` finding the unread version
emitted, and those were **false** findings; it can never turn a document `valid`, because the wrapper
is itself an error on the same `Coding`.
**The refuter REFUTED pass one of this slice too, and the finding is the one to remember: THE READ
WINDOW AND THE REPORT WINDOW MUST BE THE SAME WINDOW.** Pass one put `codingScalar` inside
`codingsOf` itself -- which every coding consumer calls -- while reporting only the windowed
elements. `requiredUnitsFor` reads `Observation.component[i].code` (a backbone element, outside the
window) and takes the FIRST LOINC coding with a vital-signs units entry, so making a wrapped
`8867-4` readable let it beat the `8480-6` beside it, a **true** `VITAL_SIGN_UNIT_NONCONFORMANT`
error disappeared, and the document went from `valid: false` to **`valid: true` with zero
diagnostics**. A false valid is the one direction the fail-safe contract forbids, and it was
`INTRODUCED`, not pre-existing. The fix was to CUT THE READ BACK, not to grow the guard: the unwrap
now lives in module-internal `safetyCodingsOf` / `safetyHasCoding` / `safetyHasCodeAnySystem` /
`safetyCodeOf` (none exported from the package), used only for `clinicalStatus` / `verificationStatus`
/ `code` on a safety root. `codingsOf` is back to its exact `main` behaviour, and `category`,
`interpretation`, `referenceRange.type` and `component.code` are untouched. **If you ever widen the
unwrap, widen `checkCodingWrapping` first, in the same change.** Pinned in
`test/array-wrapped-scalar.test.ts` (now 45 tests), including the refuter's exact document.
**Pass two came back NOT REFUTED**, with two `INTRODUCED` **minors**, both documentation-accuracy and
both fixed by correcting prose rather than code (the refuter's own call: a code change here would
reduce fail-safety). (i) The read window is **not** exactly the report window: `checkArrayWrapping`
gates the coding-level report on `isSafetyType`, but `isRetracted`'s `verificationStatus` scan and
`readSafety`'s `clinicalStatus`/`verificationStatus` convenience + `REFUTED` reads are **not**
type-gated, so a `Patient` carrying a wrapped `verificationStatus.coding.code` reads the retraction
with **no** location. Measured 3/380 in its randomized differential, every one **adding** a negation,
and `collectSafetyIssues` returns before every type-scoped verdict for a non-safety type, so it can
never retire a finding or flip `valid`. **Do not "fix" this by type-gating `isRetracted`.** (ii) The
`checkCodingWrapping` JSDoc still claimed a wrapped element is not indexed, which the pass-one
finding-3 fix had already changed. Pass two measured, and could not break: no `valid: false -> true`
flip (0/380), no negation lost, no `safeToSummarize` weakened, all 26 fixtures byte-identical to
base, and `codingsOf`/`codeOf`/`hasCoding`/`hasCodeAnySystem` **bit-identical to base** over 600
generated documents.

## `FHIR-NESTED-ARRAY-REPORTING` (2026-07-29)

**`FHIR-NESTED-ARRAY-REPORTING` (2026-07-29) closed the affirming half of (b) below.** The item it
came from, `FHIR-NESTED-ARRAY-DATA-LOSS`, was **split by founder call** after the conformance gate
REFUTED the combined change twice (PR #35, a green-but-unmerged draft, closed unmerged). **Only the
REPORTING half shipped. The preserving half is deferred as `FHIR-NESTED-ARRAY-PRESERVATION` and you
must not fold it back in.** The measurement that motivated it: a **refuted** `AllergyIntolerance`
and a **resolved** `Condition` whose coding sat one level down inside a `CodeableConcept` both read
`valid: true`, `safeToSummarize: true`, `negations: []`; an entire resource inside a `Bundle.entry`
vanished with the same clean verdict; and a nested array inside a primitive's `_`-sibling drew **no
diagnostic at all**. What shipped: `ISSUE_CODES.NESTED_ARRAY` (warning, read), a `NESTED_ARRAY`
validation **error**, `SafetyReadout.nestedArrays` + public `nestedArrays()`, `isNestedArray()` on
the model (`markNestedArray` is reader-internal, deliberately NOT exported), `safeToSummarize: false`,
and a marker-sensitive `nodesEquivalent`.
**The rule needs no cardinality table and no element list**, unlike both array rules before it: FHIR
JSON gives a list of lists no meaning at ANY position (json.html §2.6.2.2), so it cannot false-fire
on a conformant document, and it runs at **every position the model has a node for** (every depth,
primitive `extension` metadata, `contained`, Bundle entries, and members a repeated name shadowed).
It is collected by a **separate walk** from `walkSafety` on purpose: it visits strictly more of the
document, and keeping them apart is what guarantees the new report cannot perturb an existing
finding.
**The gate REFUTED pass one, on exactly one thing, and it is the lesson to carry: the rule is NOT
total, and the first draft said it was, in five shipped surfaces including a `dist`-rendered
fail-safe sentence.** A `_`-sibling the reader discards WHOLE (one on an object or a non-primitive
array, or a member of a `_`-sibling object that is neither an `id` **string** nor an `extension`
array) leaves no node to mark, so an array inside one draws `UNKNOWN_PROPERTY` and **no refusal**:
`{"name":{...},"_name":[[...]]}` still reads `safeToSummarize: true`. The underlying loss is
`PRE-EXISTING` and identical on `main`; the **overclaim** was `INTRODUCED`. **The remedy taken was
the refuter's own: correct the claim and pin the gap with a test, NOT grow the guard** -- marking
inside those discard paths means reading raw JSON the codec does not model, which is new ungraded
read-path behaviour and belongs to the preserving half. A PARTIAL close would be worse than either:
it would report on the read channel with no node for the safety channel to see, which is exactly the
read/report asymmetry that refuted `#34` pass one. Pass one also filed three minors, all fixed: the
two channels disagreed on the path form for a primitive's `extension` (reader `._extension[0]` vs
safety `.extension[0]`, now both FHIRPath for the extension ITEM, with the reader's older warnings
left on their pre-existing `_`-form so no existing diagnostic string moved; one level INSIDE an
extension they still differ, pinned as a residual, because the durable fix is one path convention
for the whole reader rather than a deeper override); `nestedArrays()` could emit the same location
twice and its `@returns` claimed document order; and `markNestedArray` was publicly exported while
documented as reader-internal.
**The line that must hold: reporting is additive to diagnostics, preserving is a change to the data
model, and only the second carries the risk.** The inner array is still unread and unmodeled; the
node is the same empty complex / value-absent primitive it always was, carrying only an inert
`nestedArray?: true` marker, so `codingsOf`, `fhirpath/evaluate.ts::wrap`, `profiles/navigate.ts::step`
and `validate/terminology.ts::locatedCodings` all behave EXACTLY as before. **That is precisely what
refuted the combined attempt twice**: 19 files touch `.items` and at least 9 flatten a list into its
items without distinguishing a nested one, so producing a nested list silently redefines what a list
MEANS for every consumer; attempt one erased a true `VITAL_SIGN_UNIT_NONCONFORMANT` and asserted
`noKnownAllergy: true` over a record naming an allergen, attempt two retired an `error`-severity
profile invariant. **If your change makes a nested array visible to any walker, you have crossed the
line.**
**Evidence that no existing diagnostic was suppressed** (the mirror-image risk of `#34`'s refuted
pass one, and the thing to reproduce if you touch this): the reader's `UNKNOWN_PROPERTY` warning is
KEPT at those positions and `NESTED_ARRAY` is raised **alongside** it, never instead. Differential
over **1,639** documents (every JSON fixture x one mutation per path per mutation kind, plus a
hand-built corpus covering the `CodeableConcept` **ELEMENT** and not only its members, which is the
gap the previous attempt's own differential had): 0 read diagnostics lost, 0 validation findings
lost, 0 `valid: false -> true`, 0 `safeToSummarize: false -> true`, 0 negations/retractions lost, 0
locations lost from the three existing location lists, every convenience field identical, all 1,639
serialized byte-for-byte identical. Bought: 819 documents now report, 626 previously `valid: true`,
694 previously `safeToSummarize: true`, 24 previously **totally silent**.
**Evidence that no existing diagnostic was suppressed** (the mirror-image risk of `#34`'s refuted
pass one, and the thing to reproduce if you touch this): the reader's `UNKNOWN_PROPERTY` warning is
KEPT at those positions and `NESTED_ARRAY` is raised **alongside** it, never instead. Differential
over **1,639** documents (every JSON fixture x one mutation per path per mutation kind, plus a
hand-built corpus covering the `CodeableConcept` **ELEMENT** and not only its members, which is the
gap the previous attempt's own differential had): 0 read diagnostics lost, 0 validation findings
lost, 0 `valid: false -> true`, 0 `safeToSummarize: false -> true`, 0 negations/retractions lost, 0
locations lost from the three existing location lists, every convenience field identical, all 1,639
serialized byte-for-byte identical. Bought: 819 documents now report, 626 previously `valid: true`,
694 previously `safeToSummarize: true`, 24 previously **totally silent**.
**Walker inertness was MEASURED, not asserted**: a harness imports `origin/main` sources and head
sources into one process and runs both over 603 documents, exercising every walker at EVERY node
(**220,137** individual observations): the stripped model, `codingsOf`/`codeOf`/`hasCoding`, the
FHIRPath engine (9 expressions x every complex node), the profile navigator (12 paths x every node),
`collectTerminologyIssues`, `isRetracted`, `resourceType`, `serializeResource`. **0 differences**,
except `readObservationValue` in 38 documents where the inert marker is echoed through its
pass-through `node` field: 0 differ once the marker alone is removed, and 0 differ in any value it
reads. A caller-supplied `TerminologyService` also receives an identical call sequence on both
sides, so no `Coding` from inside a nested array reaches caller code.

## `FHIR-NESTED-ARRAY-PRESERVATION` (2026-07-29)

**`FHIR-NESTED-ARRAY-PRESERVATION` (2026-07-29) then closed the preserving half, on the third
grading of the underlying problem, and the shape of the fix is the whole lesson.** The two REFUTED
attempts both tried to model the inner array as an element, which made it **transparent to every
walker**. This one does not model it at all: the array's **exact JSON text** is kept on the node
(`FhirComplex.nestedArraySource`, `FhirPrimitive.nestedArraySource` /
`.nestedArrayMetaSource`, one per JSON channel because a repeating primitive can nest in either or
both at one position) and handed back by public `nestedArrayContent()`. **A string carries no edge
in the node graph**, so no walk can reach it, and the reader still never puts a `FhirList` inside a
`FhirList`. `serializeResource` writes the array back instead of emitting `[{}]`, so the finding
reproduces on a re-read rather than laundering; `nodesEquivalent` compares the text. The text is the
array re-rendered compactly, so it is **value**-exact, not byte-exact (whitespace goes, strings are
re-escaped), and such output is deliberately **not** spec-clean.
**Read `test/model-edges.test.ts` before you add a field to the model.** It derives the edge set
**mechanically** from the three interfaces of the closed `FhirNode` union rather than by grepping,
so it cannot miss a case: exactly four node-valued members (`FhirComplex.properties` /
`.duplicates`, `FhirList.items`, `FhirPrimitive.extension`), the preserved fields typed `string`,
and a census of the whole of `src/` pinning which files may touch them. **A node-valued field added
to the model now fails a test** instead of silently redefining what a repeating element contains.
**The audit was the deliverable, not the evidence** (founder call), measured at `b2c5ee7`: 57
`.items` sites across 21 files, 5 of them `RawArray` not `FhirList`; **3 flatten with no kind check at all**
(`profiles/validate-profile.ts::occurrencesOf`, `validate/validate.ts::occurrences`,
`quantity/dose.ts::asItems`, the first two counting a nested list as **one** occurrence for
`CARDINALITY_MIN`/`MAX`); **21 check the kind and then silently drop what is not it**, ten of those
toward a false `valid: true`; exactly **one** fails closed
(`safety/status.ts::checkModifierExtension`). All 57 are unaffected because nothing in `src/`
constructs a list of lists and this change does not start. The slice adds two sites under the same
count: one `RawArray` (`codec/raw-json.ts::rawJsonText`) and one inside a JSDoc `@example` on
`nestedArrayContent`, which flattens nothing. Those counts are a snapshot and the conclusion is
carried by the edge-set test, not by them.
**Two fixes in the same mechanism landed with it.** The writer **dropped a `resourceType` it could
not hoist** (anything but a string primitive), losing content at the loudest position in the
document (it now keeps its document position rather than being hoisted, which the `@returns` says);
and the reader now names a primitive's metadata in **FHIRPath form at every depth**
(`birthDate.id`, `birthDate.extension[0].url[0]`), which retires the `nestedPath` override in
favour of one convention for the whole reader. 25 distinct diagnostic expressions changed shape;
none was added or removed.
**Differential vs `b2c5ee7` over 2,622 documents**, both trees in one process, every walker at
every node: **0** read diagnostics lost, **0** validation findings lost, **0** `valid: false ->
true`, **0** `safeToSummarize: false -> true`, **0** negations/retractions lost, **0** locations
lost, **0** newly throwing. `readObservationValue` moved in 43 documents purely because its
pass-through `node` field echoes the inert marker (0 differ stripped, 0 in any value it reads).
Serialization changes are fully accounted for: 982 nested-array documents + 128 `resourceType`
ones, **0 from any other cause**, **0 outputs shorter**. All 982 laundered before, **0 do now**,
875 byte-identical to the input.
**Still open after it, each pinned by a test:** a **scalar written beside a nested array in the
same array** (`"given":[["Peter"],"James"]`) lands where an object was expected and is still
dropped (a different unplaceable shape, needing its own preserved form and public surface); and a
`_`-sibling the reader discards **whole** still leaves no node to carry either the marker or the
text, so the five shapes below are unchanged.

## Left open deliberately, a through e

**Left open, deliberately, each pinned by a test rather than a sentence:** (a) an array-wrapped
`value[x]` draws **no** `ARRAY_WRAPPED_SCALAR` (outside the closed set; widening to every R4 `0..1`
element _is_ the per-resource model), and `readObservationValue` still has no issue channel of its
own, though it fails **safe** on this route (reports the present variant, `quantity: undefined`, so
no wrong number is handed out); (b) the JSON reader still does not model a nested array **as an
element**, and deliberately never will, but `[["x"]]` no longer loses the inner value: it is kept
as text and read with `nestedArrayContent()` (`FHIR-NESTED-ARRAY-PRESERVATION`, above). (c) The
**THE ARRAY ROUTE** does not launder read -> write -> read **through the JSON writer**: the writer
emits the list back, so the re-read reproduces the finding rather than losing it. That is pinned, so
a future writer change cannot quietly introduce it. **This line used to say the laundering was
"duplicate-key-only", and THAT IS RETRACTED: it was another universal written wider than the code,
and narrowing it to "within JSON" in the 2026-08-05 slice was still wrong.** Three counter-routes,
each reproduced at that date: the same array model through `serializeResourceXml` DOES launder,
because XML cannot spell a singleton wrapper at all (residual (e) below, pinned 2026-08-05); a
`_`-sibling the reader discards whole re-emits without it, so
`MISPLACED_PRIMITIVE_EXTENSION@Patient.name` reads on the way in and the re-read is **clean**; and
`{"given":[["Peter"],"James"]}` re-emits as `[["Peter"],{}]`, so the `UNKNOWN_PROPERTY` at `given[1]`
disappears while the two findings at `given[0]` survive. The last two are pre-existing, unpinned, and
belong to the residuals they come from, not to this one. **Do not restate the "only" here in any
form; state what is pinned.**

### `PHI-WARNING-MESSAGE-LEAK` (2026-08-02)

(d) **CLOSED by
`PHI-WARNING-MESSAGE-LEAK` (2026-08-02), and it was the wider half of the problem, not the narrow
one it was filed as.** It was filed as a `resourceType` reaching the `expression` prefix
(`ARRAY_WRAPPED_SCALAR@<whatever the document put there>.resourceType`, and on into the
`OperationOutcome`). Re-enumerating the sites found the **property name** is the same defect on a
far wider surface: 25 construction sites across the JSON reader, the XML reader, the validator, the
safety walk, terminology, dose, Bundle references and the profile layers, plus
`SafetyReadout.resourceType` on the model. Measured on named documents so the numbers can be
re-derived: `{"resourceType":"Patient","<1e6 b>":[["x"]]}` gave a **1,000,011-byte** `expression`
(21 on head), and `{"resourceType":"<1e6 b>","status":"final"}` gave a **1,000,222-byte**
serialized `OperationOutcome` (232 on head) and a 1,000,000-byte `SafetyReadout.resourceType`
(10 on head).
**The bound is a shape test, not a truncation**, and the mechanism is written down in
`src/model/path.ts` and nowhere else, so every other surface states only the consumer-facing
property. A name is echoed when it matches the published form it claims
(`elementdefinition.html` `eld-19`, a Rule, caps a path segment at 64 characters; `eld-20`, a
Warning, gives the two alphanumeric arms), and is replaced by a fixed marker otherwise. The
resource-type arm is tighter than `eld-20`'s and the tightening is **measured**, not assumed: all
148 codes in the R4 `resource-types` code system are letters only with an initial capital, 4 to 33
characters. The element arm is measured against R4's own definitions: of the 1,423 distinct
non-root segments across the 7,696 element paths in `profiles-resources.json` /
`profiles-types.json`, the only 74 failures are `choice[x]` _definition_ spellings, whose stems all
pass and which never appear as a JSON property name. Every conformant document reports exactly the locations it reported before, which is
what the 759 pre-existing tests passing unchanged demonstrates.
**Three things it does not do, none of them negotiable by wording.** A forgery genuinely shaped
like a FHIR name is still echoed, so the claim to make is that the echo is bounded, not that a
location carries no document content. `FhirComplex.properties[].name` stays exactly as the
document wrote it: the `hl7`/`deid` model-level lesson does **not** transfer, because those names
are content the writer reproduces byte for byte and bounding them would be data loss;
`SafetyReadout.resourceType`, the one derived identifier the model surfaces, **is** bounded. And
the four low-level location functions take their root prefix as a parameter, so a caller that
hands one an unbounded string gets it back, which is caller-supplied input rather than
document-derived. All three are pinned by tests in `test/derived-names.test.ts`, not by this
paragraph.
**Measured red on `origin/main` one slot at a time** (the shared `@cosyte/test-utils@0.0.2` runner
aborts on the first violation): 13 of 13 declared slots, 7 of 7 name sentinels, over **twelve**
distinct positions (two slots reach the expression root through different document shapes). Two
further `rootPath` calls, in the terminology layer and the dose locator, are provably the identity
wherever they are observable and are kept as defensive calls, named as such in the source; the
gate deliberately does not pretend to cover them. The reason the
package's own PHI tier never caught it: `phi-leak.test.ts` swept leaf **values** only, so no
sentinel it planted could land in a name.
**Provenance for every spec claim above, fetched 2026-08-02, not recalled:**
`hl7.org/fhir/R4/elementdefinition.html` (`eld-19`, `eld-20`),
`hl7.org/fhir/R4/codesystem-resource-types.json` (148 codes),
`hl7.org/fhir/R4/profiles-resources.json` + `profiles-types.json` (7,696 paths, 1,423 segments).
The conformance gate re-derived all four independently and found them exact.
**The refuter's pass-one measurements, worth keeping:** 2,912 official R4 JSON examples and 1,138
XML ones read byte-identically on base and head, with **zero** containing a withheld marker; a
4,000-document randomized differential moved no `valid`, `safeToSummarize`, `retracted` or
negation; the only tally that moved anywhere was the declared `nestedArrays` collapse (145 of
6,000). It also measured head **6 to 8% slower** on a loaded box, which matters only because the
two `fast-check` property tests sit near the 10,000 ms `testTimeout`.

### `FHIR-READER-RESIDUALS` (2026-08-02)

**Two `PRE-EXISTING` residuals it filed, neither introduced there and neither blocking, BOTH NOW
CLOSED by `FHIR-READER-RESIDUALS` (2026-08-02).** They were: the JSON reader emitting English prose
inside an `expression` (`" (unexpected _-sibling on an object)"`), never valid FHIRPath on any
input; and the XML reader not supporting namespace **prefixes**, so `<f:Patient xmlns:f="...">`
yielded properties literally named `f:active`.
**The XML half was far the larger of the two, and the measurement is the thing to keep.** Each of
the seven XML fixtures re-spelled with a prefix, compared to its default-namespace original on the
whole read (issues, serialized JSON, re-emitted XML, `valid` + findings, safety readout):
**0 of 7 matched on `cf16767`, 7 of 7 match now.** Three consequences, all measured on `patient.xml`
re-spelled: a **primitive extension was silently dropped** (`<f:extension>` failed the reader's
`extension` test), 337 serialized bytes down to **216**; the re-emitted XML was **not well-formed**
(`<f:Patient xmlns="http://hl7.org/fhir">`, `f:` bound to nothing, because the writer wrote raw
names back under a default-namespace declaration); and the document read **`valid: true` with no
element recognized at all**, a false green that now reports what the identical unprefixed document
reports. **The clinical shape: a prefixed `Observation` with `status="entered-in-error"` read
`status: undefined`, `retracted: false`, `isRetracted: false`.** It reads the retraction now.
The mechanism is a scope map threaded down the descent (`extendScope` / `resolveName` /
`ScopedElement` in `src/xml/read.ts`), with the implicit `xml` prefix pre-bound.
**🔴 THE GATE REFUTED PASS ONE ON EXACTLY THIS, AND IT IS THE THING TO REMEMBER: AN EXPANDED NAME IS
A NAMESPACE _AND_ A LOCAL NAME (Namespaces in XML 1.0 §6.1), SO GROUPING ON THE LOCAL NAME ALONE
MERGES FOREIGN CONTENT INTO THE FHIR ELEMENT BESIDE IT.** Pass one dropped the prefix from every
element it could resolve, so `<v:code xmlns:v="urn:vendor">` joined `code`'s occurrences. Measured
by the refuter, none reproducing on base: a **true `VITAL_SIGN_UNIT_NONCONFORMANT` error erased and
`valid` flipped `false -> true`**; **`noKnownAllergy` asserted `true` over a record naming an
allergen** (the one negation that is a positive clinical assertion, and the third time this repo has
reached that exact shape); a **retraction lost**; a foreign `<v:extension>` promoted into
`_birthDate.extension`; and `serializeResourceXml` **laundering** the whole thing, re-emitting the
vendor element as conformant FHIR so a re-read came back clean. **The remedy was the refuter's own
and it is a NARROWING, not a bigger guard:** one predicate, `isForeign`, governs **both naming and
flagging**: an element in its parent's namespace gets its local name and no flag, anything else
keeps its **tag verbatim** and is flagged, which is exactly what base did for every prefixed
element. That single predicate also fixes the `extension` test, the `div` test and the
resource-unwrap. **If you ever make a resolved local name reachable without comparing the namespace
it came from, you have reopened this.**
**🔴 PASS TWO THEN REFUTED THE PASS-ONE REMEDY, AND THE REASON IS THE ONE TO CARRY: "FOREIGN
CONTENT KEEPS ITS TAG VERBATIM" ONLY SEPARATES ANYTHING WHEN THE TAG CARRIES A PREFIX.** Reached by
a **default** `xmlns`, `<extension xmlns="urn:vendor">` and `<Patient xmlns="urn:vendor">` inside
`<contained>` have no prefix to keep, so the verbatim tag **is** the FHIR spelling: they group with
a FHIR sibling, satisfy the `extension` test, read as a resource name and read as the narrative
`div`, exactly as they did before namespaces were resolved at all. Worse, the pass-one code
**lost the diagnostic** on two of those routes: `readComplex` was called directly from the
extension branch and the resource-unwrap branch, both of which **bypass `buildSingle`, the only
place `flagForeign` ran**, so base emitted `UNEXPECTED_XML_CONTENT` and head emitted **nothing**
while still modelling the content as FHIR. Reproduced before designing the fix, not taken on
trust. **The remedy is two things and neither is a bigger guard.** (1) Both branches route through
`readNested`, which flags and then reads, so **every element the reader models is tested by
`isForeign` exactly once**; parity with base is restored on both routes. (2) **Every "never" claim
is scoped to PREFIXED foreign content** in the source, the tests, the changeset, `CHANGELOG.md` and
the README, because the claim was false for the unprefixed half on all four counts. The separation
covers prefixed content; the FLAG is what covers the unprefixed half.
**The unprefixed case is a residual, not a regression** (identical on base), pinned by its own
`describe` block in `test/xml.test.ts`.
**🔴 PASS THREE REFUTED THE REPLACEMENT SENTENCE, AND THIS IS THE THIRD TIME IN ONE SLICE THAT A
UNIVERSAL WAS WRITTEN WIDER THAN THE CODE. It refuted the CLAIMS, not the code: it could not break
the behaviour** (its own independent 283-document differential plus 34 adversarial documents found
0 `valid: false -> true`, 0 `safeToSummarize: false -> true`, 0 retractions or negations lost, 0
new throws, and it reproduced the 0/7 -> 7/7 headline and the 337 -> 216 byte drop with its own
re-speller). **The remedy it prescribed, and the one taken, is a TEXT correction in five files, not
another code round.** Two counterexamples, both reproduced here before editing, both **identical on
`cf16767`**: (1) **"every element in a namespace other than its parent's is reported"** is false,
because a child element beside a `value` attribute is **never modeled** at all: the primitive
branch of `buildSingle` discards it whole under `UNKNOWN_PROPERTY`, so a foreign child there never
reaches `isForeign`. The scope that IS true is **"every element the reader MODELS"**, and that is
now the wording everywhere. (2) **"the narrative `<div>` is not flagged for being there"** is false
for the **prefixed** spelling: `narrativeDiv` keys on `modelName === "div"`, a spelling test that a
prefixed tag can never satisfy, so `<h:div xmlns:h="...xhtml">` is flagged, is not read as
`Narrative.div`, and re-emits with `h:` unbound. Scoped to the unprefixed spelling.
**The lesson to carry out of all three passes is one lesson: in this reader, "every element" is
never the right subject of a sentence. Name the set the code actually walks.**
**The root is the one element with its own rule**, because it has no parent to take a vocabulary
from: it is always modeled by its local name, and it is flagged only when it _declares_ a namespace
that is not FHIR's. A document declaring **no namespace at all** is still read as FHIR and still
unflagged, exactly as before; do not "tighten" that into a refusal.
**A foreign namespace is flagged where the document LEAVES its parent's, not once per descendant**,
an element that merely inherits says nothing its ancestor did not. That is what keeps the existing
default-namespace behaviour byte-identical; do not "fix" it into a per-element flag.
**What reading the document correctly COSTS, and the gate's third demand: REPORT THE WIDENED READ
WINDOW OR DROP THE GROUPING.** Two prefixes both bound to the FHIR namespace are two spellings of
one name, so an element written twice that way is the repeat it genuinely is, and the MODEL and
every verdict over it match the same document spelled one way (`test/xml.test.ts` pins that). What
changes is the **count**, and a `0..1` check that reads a single value gets nothing from a list.
**Measured, and this is the case that decided it:** a `Reference.reference` written under two
spellings loses the `REFERENCE_UNRESOLVED` its one-spelling twin raises, with **no** compensating
diagnostic anywhere. **Reporting was taken, not dropping**, because dropping means two properties
of the same model name in one `FhirComplex`, and the XML reader has **no `duplicates` mechanism**
(that lives in the JSON reader), so it would be a silent first-wins loss: strictly worse. New
`ISSUE_CODES.MIXED_XML_SPELLING` (warning) + `mixedXmlSpelling`, raised in `reportMixedSpelling`
once per element whose group holds more than one literal tag. **Only a group in the parent's own
namespace can**, because anything else is modeled under its verbatim tag and lands in its own
group, so this cannot fire on foreign content and cannot fire on a single-spelling repeat.
At safety-scoped elements the repeat is **additionally** reported (`ARRAY_WRAPPED_SCALAR`, error),
so a retraction written through a second spelling is caught where the raw-tag read missed it.
**A sink that must NOT be answered by widening the cardinality table**: a duplicate reaching the
vital-signs unit check through `category.coding`. It is reachable today by writing the element
twice with ONE spelling, and CLAUDE.md already records why the table stays closed
(`Questionnaire.code` and `ElementDefinition.code` are `0..*`, so a name-only rule false-errors on
a conformant document).
**The `_`-sibling half is a REPORTING change, not a preserving one**, and the distinction is the
same one `FHIR-NESTED-ARRAY-REPORTING` turned on: new `ISSUE_CODES.MISPLACED_PRIMITIVE_EXTENSION`
(warning) + `misplacedPrimitiveExtension`, raised at the bare element location. It replaces the
`UNKNOWN_PROPERTY` those two sites raised **on purpose**: `UNKNOWN_PROPERTY`'s documented contract
is that a shape was tolerated and **nothing was lost**, and these two sites discard the `_`-sibling
**whole**, so the old code was making a false promise as well as carrying prose. The sibling's
content is **still not modeled** and this slice does not start; the five discard shapes above are
unchanged.
**Differential vs `cf16767` over 564 documents** (every XML fixture x six mutations at every
element position: a FHIR-prefixed, a foreign-prefixed and a foreign-DEFAULT-namespace duplicate
sibling, plus the element itself re-spelled into each of those three). 468 moved, and of those:
**0 `valid: false -> true`, 0 `safeToSummarize: false -> true`, 0 retractions lost, 0 negations
lost, 0 newly throwing.** 32 diagnostics disappear and **all 32 are at a `<withheld>` location** --
base complaining about a name like `f:active` it could not resolve and head reads correctly --
with **0** disappearing at a location that resolves. **The 7 XML fixtures unmutated: 0 moved.**
The foreign-default-namespace mutation is the one the previous differential did not have, and it
is what pass two used to refute; it is in the harness now precisely so it cannot be missed again.
**`test/expression-grammar.test.ts` is the gate that keeps prose out**, sweeping every reader
diagnostic the JSON and XML corpora produce against a location grammar.
**THE CLAIM IS SCOPED AND MUST STAY SCOPED. It is that the JSON reader's `expression` no longer
carries prose, NOT that every `expression` is resolvable FHIRPath.** Two forms deliberately are not,
and the grammar **admits** them rather than hiding them: a `<withheld>` segment, and the XML
reader's `.@name` attribute form. **`.@name` is a live residual**: an unmodeled XML attribute has
no FHIRPath address at all, and choosing one for it (the element? nothing?) is a separate decision
from removing a sentence, so it was left alone rather than folded in.
**Four `PRE-EXISTING` findings pass three filed, to pick up rather than fix here, none blocking and
every one identical on `cf16767`:** (i) a **prefixed narrative `<div>`** loses the narrative text
and still reads `valid: true` with zero findings, re-emitting `h:` unbound (finding 2 above, the
one worth queuing first, since it destroys clinical prose on a document that is legal XML)
-- **CLOSED, in two halves.** The spelling half went first: the narrative is recognised by its
**expanded name** `{http://www.w3.org/1999/xhtml}div`, so every spelling of the XHTML namespace
reaches `Narrative.div`. The **ordering** half followed, and it is the one to read before touching
`buildSingle`: `isResourceName` is a FHIR-vocabulary heuristic (UpperCamelCase names a resource
type) and the content of `Narrative.div` is XHTML, where it means nothing, so applied there it read
`<div xmlns="…xhtml">Take 5 mg<BR/></div>` as a contained `BR` resource and **destroyed the prose
with ZERO diagnostics under `valid: true`**, re-emitting the div stripped of its namespace so the
loss laundered on a re-read. HTML-4-era generators emit `<BR>`, `<TABLE>`, `<P>`. The narrative is
taken **before** the resource-valued unwrap now; `div` names exactly one of R4's 7,696 element
paths, so the order shadows nothing, and **no field was added to the model** either time.
**The cost, and the yardstick that settles it: reading a narrative as a narrative stops modelling
its insides as FHIR**, so `UNHANDLED_MODIFIER_EXTENSION` raised from inside one goes and such a
document flips `valid: false -> true` (32 of 1,019 in the differential). Measured against the
previous release that looks like suppression; measured against **the same document spelled the
other way** (a lowercase child, a default `xmlns`) nothing is lost: 394 of 396 twin pairs read
identically, 2 louder, **0 weaker**. **Re-run that comparison if you touch this branch; "did a
finding disappear" is the wrong question here.** The differential harness is
**committed** (`scripts/read-differential.ts`, `pnpm differential:read`), which the three reader
slices before it were not; it self-checks its tallies and refuses to report if the base tree it
loaded does not behave like base. The **resource-valued unwrap** is otherwise unchanged, except
that character data it discards beside the child now draws `UNEXPECTED_XML_CONTENT` instead of
vanishing in silence (reported, **not** preserved: there is no slot for it).
**`UNEXPECTED_XML_CONTENT` REPORTS TWO DIFFERENT OBSERVATIONS AND ONLY ONE OF THEM PRESERVES
ANYTHING**, which its shipped JSDoc now says. A foreign-vocabulary element **is** modeled;
character data written directly on a FHIR element is **dropped at every one of the three
`flagStrayText` sites**, because a FHIR element carries its value in `value=` (xml.html). The
first draft of that correction said only the unwrap site was lossy, which was a **new, precise,
checkable, false universal** shipped in `.d.ts`, and the gate broke it in one query. **In this
reader, count the call sites before you write "one" or "everywhere else".**
The new report is raised **only where its own location is otherwise silent**
(`unexpectedXmlContentAt`), because the foreign flag, the child's own stray text and the wrapper's
all land at one path and base emitted one there. **THAT SCOPE IS ONE CALL SITE, AND SAYING IT WAS
THE READER'S RULE IS WHAT REFUTED PASS THREE.** Elsewhere the code does land twice at one
expression when an element is both foreign and carrying text, unchanged from base and from every
release that has had this code. **This slice was refuted TWICE for the same thing: writing a new,
precise, checkable universal about this one code that the call sites do not support.** The first
said only one site was lossy (three are); the second said the code is once-per-location (one site
of four checks). **Count the call sites, then write the sentence, then check the sentence against
the count again.** The de-dup itself was first written against only one of the three, so the
**unprefixed foreign wrapper** still doubled: that is the same default-`xmlns` shape that refuted
`#44` pass two, and it is now in the corpus and pinned by a test.
**Five `PRE-EXISTING` residuals the gate filed on this slice, none blocking, every one reproduced
on `09b2805`:** an uppercase **`<DIV>` wrapper** is a different expanded name from `{xhtml}div`, so
it is not the narrative and still loses its prose (reported, not silent) -- the realism argument for
`<BR>` is the same argument for `<DIV>`, and recovering it means matching an element name
case-insensitively, a decision about the whole reader; the narrative is carried with whatever
namespace was in scope, so a `<div>` written under a FHIR or **absent** default declaration yields
a `Narrative.div` that is not in the XHTML namespace the datatype names, and
`serializeResourceXml`'s "conformant `<div xmlns=…>`" claim is wider than that; an **empty**
self-closing narrative round-trips as `<div xmlns="…"/>`, which has no characters between the
first `>` and the last `<`; and **25 of 1,107** corpus documents emit XML whose re-read moves, all
of them a `<contained>` holding **two** element children (so the unwrap does not apply), where
`Resource.id` written as a child element re-reads as the `Element.id` attribute the writer emitted.
That last one is worth keeping for a different reason: **the harness found it, and only because the
harness re-reads what each tree EMITS rather than only what it was given.** A differential that
parses its input alone cannot see output that is not well-formed, which is exactly the defect
`#46`'s pass one caught by hand.

### `FHIR-PRIMITIVE-AS-ELEMENT-TEXT` (2026-08-03)

**🔴 AND ONE `PRE-EXISTING` MAJOR THE GATE FILED, A CANDIDATE STOP-THE-LINE WITH ITS OWN ITEM, NOT
A BLOCKER HERE: A FHIR PRIMITIVE WHOSE VALUE IS WRITTEN AS ELEMENT TEXT RATHER THAN `value=` IS
DROPPED, AND THE SAFETY SPINE AFFIRMS OVER THE LOSS.** Byte-identical on `09b2805` and head, and in
the differential corpus (`primitive-text-not-value`, 0 of 44 moved) so it stays measured.
`<Observation …><status>entered-in-error</status></Observation>` reads `retracted: false`,
`safeToSummarize: true`, `negations: []`, `valid: true`, and `assertSafeToSummarize` does **not**
throw; an `AllergyIntolerance` whose `verificationStatus.coding.code` is written as text loses the
`refuted`; `<doseQuantity><value>5</value><unit value="mg"/></doseQuantity>` loses the **dose
number** while the unit and UCUM code survive. It is `UNEXPECTED_XML_CONTENT`-reported, so it is not
silent, but this is the `FHIR-ARRAY-WRAPPED-SCALAR` / `FHIR-CODING-SCALAR-WRAPPER` harm shape
reached through the XML door. Realism is **argued** (naive generators, generic JSON-to-XML
converters), not grounded in a public artifact: **grounding it per ADR 0018 belongs to filing the
item**, not to inventing a fixture
-- **CLOSED IN ITS REPORTING HALF ONLY (`FHIR-PRIMITIVE-AS-ELEMENT-TEXT`, 2026-08-03), AND THE
SPLIT IS THE WHOLE POINT: THE ADR 0018 GROUNDING GATE HALTED THE OTHER HALF.**
**▶ READ THIS BEFORE YOU TRY TO "FINISH" IT.** There are two separable changes here and only one of
them is a quirk. **Recovering the value** (reading the element text back as the primitive's value)
is a **TOLERANCE for a non-conformant encoding**, and ADR 0018 forbids encoding one without a real
publicly-cited document showing the shape. A search found the spec text (xml.html §2.6.1, "values of
primitive types in a `value` attribute") and one library-side serializer bug, **no real document**.
So the recovery half was NOT built, and **"not grounded, halted" was the correct outcome for it.**
**Refusing to affirm** is not a quirk at all: nothing new is recognised, no tolerance is added, no
value is invented, and the reader's report is byte-identical. It needs no vendor grounding, exactly
as `FHIR-NESTED-ARRAY-REPORTING`'s synthetic list-of-lists corpus needed none. **Do not cite ADR
0018 to block a refusal; cite it to block a tolerance.**
What shipped: `VALIDATION_CODES.DROPPED_ELEMENT_TEXT` (error, `structure`),
`SafetyReadout.droppedText` + public `droppedText()`, public `isDroppedText()` on the model,
`safeToSummarize: false`, `assertSafeToSummarize` throws, and a marker-sensitive `nodesEquivalent`.
`markDroppedText` is reader-internal and deliberately NOT exported, like `markNestedArray`.
**The marker is an inert `droppedText?: true` that carries NO CONTENT AT ALL**, which is a stronger
position than `nestedArraySource`: there is no preserved text here for a walker to reach or a
diagnostic to leak. `test/model-edges.test.ts` still derives exactly four node-valued members.
**THE MARKER LANDS AT ALL THREE SITES WHERE THE READER DROPS CHARACTER DATA**, counted in the source
(`readComplex`, the resource-valued unwrap, the primitive branch of `buildSingle`) and pinned by a
test each, because this reader has been refuted TWICE for writing a universal the call sites did not
support. **No new read-time issue code was added**: `UNEXPECTED_XML_CONTENT` already reported at
every one of them, which is exactly why this defect was loud and still harmful, and
`DROPPED_ELEMENT_TEXT` is raised ALONGSIDE it.
**The comparand was chosen deliberately and the twin section of the harness was NOT used.** That
section scores head against BASE's reading of the twin, and its "louder" branch requires `valid` and
`safeToSummarize` to MATCH the twin; a refusal moves both, so a declared twin would have scored this
slice **WEAKER** for doing exactly the right thing. The right bar for a refusal is base-vs-head
(head must report strictly more, never less), plus the conformant twin being unmoved base-to-head,
and both are in the main tally. **Do not declare a twin for a shape the reader still does not read.**
**Differential vs `6689239`, 1,195 documents:** 0 `valid: false -> true`, 0
`safeToSummarize: false -> true`, 0 retractions or negations lost, 0 read diagnostics lost, 0
validation findings lost, 0 newly throwing, 0 outputs shorter, **0 of 15,956 leaf values missing**,
narrative preservation unmoved at 758 of 836. Bought: **360 documents now report, 312 previously
`valid: true`.** The 27 re-read movers are `PRE-EXISTING`, 0 stable on base.
**🔴 AND THE HARNESS'S OWN NEGATIVE CONTROL WAS A PERMANENT FALSE RED, FOUND BY RUNNING IT.**
`negativeControl()` was hard-coded to `#47`'s capitalized-child narrative. `#47` then merged, so
`origin/main` carries it, base reads it exactly as head does, and the control fired on EVERY run
afterwards: "every zero below is meaningless" printed under a report whose zeros were fine. A false
alarm on the only alarm is worse than no alarm, because the next reader learns to scroll past it.
**The control now names the change under measurement** (a `CONTROL` constant a reader-slice updates,
with the rule written on it), **and compares the WHOLE reading, not just `json`** -- this slice moves
what the safety layer and validator SAY without moving any value, so a `json`-only control would
have passed on base and reported a comfortable zero. **If it fires, suspect it first.**

### `FHIR-ELEMENT-TEXT-RECOVERY` (2026-08-03)

**THE LAUNDERING IS CLOSED BY `FHIR-ELEMENT-TEXT-RECOVERY` (2026-08-03), AND THE SHAPE OF THE FIX
IS THE LESSON: IT IS A WRITER REFUSAL, NOT THE RECOVERY HALF.** The note here used to say closing
it "needs the grounding the recovery half needs". **That was wrong, and the precedent three lines
above says why: do not cite ADR 0018 to block a refusal, cite it to block a tolerance.** Only
_emitting the text back_ needs grounding; _declining to emit at all_ invents nothing. Both writers
now throw `FhirSerializeError` / `SERIALIZE_ERROR_CODES.DROPPED_ELEMENT_TEXT` on a marked model
(`src/codec/serialize-guard.ts`, shared by the JSON and XML writers).
**AND THE JSON WRITER WAS THE WORSE OF THE TWO AND WAS NOT RECORDED ANYWHERE.** This note named
only `serializeResourceXml` emitting `<status/>`; `serializeResource` emitted
`{"resourceType":"Observation"}`, dropping the member entirely, so a retracted `Observation`
re-read as one that never named a status. **Count the writers before you write the sentence** --
the same lesson this file already records for the reader's call sites, now paid on the write path.
**A fresh ADR 0018 grounding search was run and FAILED AGAIN, and the negative result is worth
keeping so it is not re-run blind.** GitHub code search for FHIR-namespaced XML carrying
element-text primitives returns: pre-2013 draft-era documents (`<LabReport>`, `<Document>`, Atom
feeds -- resource types R4 does not have, from when element text WAS the format); non-FHIR
namespaces; `data-absent-reason` extension children, which are CONFORMANT under §2.6.1's third arm
and are false positives; and one hand-authored library test fixture. `<Patient>` + `<gender>male</gender>`
returns **zero**. **None of that grounds a tolerance in an R4 reader**, so the recovery half stays
unbuilt.
**The wider §2.6.1 residual is NOT closed and must not be folded in**: a value-absent primitive
carrying no extension still emits `<status/>`, and the `id`-only case (`<given id="b"/>`, the only
such element in the fixture corpus) is still a violation. Refusing those would break a round trip
that works today, and is a separate decision; it is pinned by a test, not by this sentence.
**The differential harness had to be fixed to measure this at all**: it wrapped serialization in
the same `try` as the reading, so a refusal collapsed the whole reading and reported **5,159
phantom leaf losses** on the first run. A refusal is now its own `reread` state with its own tally,
excluded from "output shorter", "no longer re-reads" and the leaf comparison. **If you add a
writer refusal, check what the harness does with it before you trust a zero** -- and know the two
bar lines it narrows: **"newly throwing" no longer counts a refusal** (read it together with the
refusals line beneath it), and **the leaf comparison SKIPS a refused document** (5,159 of 15,956
leaves here). That exclusion is provably harmless only because this slice touches no reader file. **A
slice that changes the READER and adds a refusal has a real blind spot there**; measure the reader
change separately, against a base with no refusals in it.
**Still open, deliberately, pinned by a test:** text beside a value that DID arrive
(`<status value="final">entered-in-error</status>`) draws the same refusal, which is deliberate
rather than an oversight. **Do NOT justify that arm with "content the sender wrote is still
missing": the gate broke that sentence in one query** with `<status value="final">final</status>`,
where nothing is missing and it refuses anyway. The honest reason is that the rule keys on the
reader DROPPING character data and never compares the text to the value, and deciding the
duplicate case is harmless would mean READING the text, which is the tolerance this half declines;

### Residuals ii to iv, and three more left open

(ii) a **foreign child of a valued primitive** is discarded whole under `UNKNOWN_PROPERTY`, whose
documented contract is that nothing was lost, so that code is making a false promise at that site
exactly as it was at the two `_`-sibling sites this slice moved to
`MISPLACED_PRIMITIVE_EXTENSION`; (iii) a **foreign root launders** into conformant FHIR across one
round trip (`<v:Observation xmlns:v="urn:vendor">` re-emits as a FHIR `Observation` that re-parses
clean), pre-existing for the default spelling and extended to the prefixed one here; (iv) two
**distinct expanded names merge** when one prefix is rebound between siblings
(`<p:x xmlns:p="urn:a"/><p:x xmlns:p="urn:b"/>` -> one property), both flagged foreign, which the
`isForeign` / `groupChildren` expanded-name argument does not cover.
**(iv) IS CLOSED FOR THE READ (2026-08-05), AND NOT FOR THE ROUND TRIP:** `reportMixedSpelling` now
compares the expanded name, so the merge is reported rather than silent, but `serializeResourceXml`
drops the bindings and the report is gone on the re-read. The merge itself still happens,
deliberately; see
[`#fhir-writer-authors-values-2026-08-05`](#fhir-writer-authors-values-2026-08-05).
**(iii) AND (iv) WERE PINNED BY TESTS (2026-08-05), AND THE REASON THEY NEEDED TO BE IS THE
LESSON.** An audit of this file against the test tree found three residuals whose prose said
"pinned by a test" or read as though it did, with no test anywhere: (iv) here, (iii) here (only the
**flag** was pinned, never the round trip), and the singleton-wrapper laundering below. A false
"pinned" is worse than a plain gap, because the next reader stops checking. They live in
`test/xml.test.ts` ("declared residuals, pinned so they cannot move in silence") and
`test/array-wrapped-scalar.test.ts`, they are characterization tests over the gap rather than
claims that the reading is right, and each was demonstrated **red** against a mutation of the
behaviour it pins before it was allowed to go green: expanded-name grouping in `groupChildren` for
the merge, a namespace arm in `reportMixedSpelling` for the silence, a marked model for the
foreign-root round trip, and a writer refusal for the wrapper.
**Three more residuals left open deliberately, each pinned by a test:** an **unbound** prefix
(`<f:active/>` with no `xmlns:f` in scope) is flagged and its tag kept **verbatim**, so it does
**not** read as a FHIR element and a retraction spelled that way is still not seen by the safety
spine. The fix covers **bound** prefixes, which is what "supports namespace prefixes" means and
no more; `serializeResourceXml` emits the default-namespace spelling only, so a prefixed input
round-trips **equivalently, not byte-for-byte** (the conservative writer, working as intended); and
the `_`-sibling content is still discarded, as above.
**And the limit `#43` was right not to paper over is INHERITED, not undone: a forgery genuinely
shaped like a FHIR name is still echoed, so no claim is made anywhere that a location never
carries document content. Do not add one.**

### `FHIR-WRITER-AUTHORS-VALUES` (2026-08-05)

Three `PRE-EXISTING` laundering routes the `FHIR-RESIDUALS-NOT-PINNED` gate found while pinning
other residuals. **Two closed here, one deferred, and the scope call is the interesting part.**

**1. The JSON writer authored a value that was never read. CLOSED.** `readComplex` produces an empty
element for anything that is not an object at a complex position, and the writer emitted that
element as `{}`. `{}` is a **conformant** empty element, so the `UNKNOWN_PROPERTY` the reader raised
was gone the moment the output was read back:
`{"name":[{"family":"Roe"},"James"]}` -> `{"name":[{"family":"Roe"},{}]}` -> no diagnostics. **This
is the fabrication class**, the same harm shape as a silent zero default: a confident value
presented as read at a position where nothing was read at all.

**The surface is wider than the item stated, and that is what decided the remedy.** The item named
"a scalar beside a nested array", where the document already reads `valid: false` on the
`NESTED_ARRAY`. Measured, the same branch is reached by any non-object beside an object in a complex
list (`{"name":[{"family":"Roe"},"James"]}`, `…,null]`, `…,42]`, `…,true]`), and **those documents
read `valid: true` with one warning** and came back with none. So a **refusal** was the wrong
instrument: the existing `DROPPED_ELEMENT_TEXT` refusal is explicitly scoped to models the library
already reports `valid: false` / `safeToSummarize: false`, and refusing here would remove the ability
to write back documents that read clean. The remedy taken is the writer's **own already-documented
principle**, one branch over in the same function: *"Conservatism here means refusing to author a
value, not refusing to hand one back."* The text is kept on the node (`FhirComplex.nonObjectSource`)
and written back, so the re-read reproduces the finding. The text is **value-exact, not byte-exact**,
the same caveat `NestedArrayContent` already carries: a number's exact source survives, a string's
escaping does not (`"Jamés"` returns as `"Jamés"`, `"a\/b"` as `"a/b"`). Both denote the same
string, so this is a re-render, not a loss, and the round trip is byte-identical for every input that
was already canonically escaped.

**Modeling the scalar as a primitive was considered and rejected**, and it is the cheaper-looking
fix, so it is written down: it would put a live value at a position every walker reads as a complex
element, and `codingsOf` / the safety spine would then see values they do not see today. That is the
line `FHIR-NESTED-ARRAY-PRESERVATION` drew ("if your change makes a nested array visible to any
walker, you have crossed the line"), and it applies verbatim. A **new** field rather than a reuse of
`nestedArraySource`: reusing it would set `nestedArray: true`, which drives a `NESTED_ARRAY`
validation error the document never earned, and would make the public `nestedArrayContent` return a
non-array.

**2. `serializeResourceXml` emits a prefixed foreign property with the prefix unbound. DEFERRED,
with the reason.** Measured: `<v:x xmlns:v="urn:vendor" value="1"/>` re-emits as `<v:x value="1"/>`,
which is **not namespace-well-formed**, so a conformant parser rejects the writer's own output. The
binding was never modeled, so the remedies are (a) carry namespaces in the model or (b) refuse any
property name with a colon, which withdraws a capability for a shape that reads `valid: true`. Both
are larger decisions than the defect, and this item's standing instruction was not to let the remedy
outgrow it. **Still open.**

**AND IT REOPENS THE REBOUND-PREFIX HALF, RESIDUAL (iv), ACROSS ONE ROUND TRIP. NOT ROUTE 3, WHICH
SURVIVES.** Measured: the narrative `div` is carried opaquely by `narrativeSource`, which
materialises each `xmlns` on the fragment, so both divs are re-emitted with their namespaces and the
re-read reproduces `MIXED_XML_SPELLING@Patient.text.div` unchanged. Only the rebound prefix loses it,
because only a prefix needs a binding the model does not carry. **This is why the first draft of this
section was wrong.** That draft said "what is lost is the binding, not the diagnostic", measured on a **single**
`<v:x/>`, where the unbound prefix still satisfies `isForeign` and `UNEXPECTED_XML_CONTENT` is raised
again. On the shape residual (iv) actually names, a **rebound** prefix, the writer drops both
bindings, so the two occurrences become one expanded name and the `MIXED_XML_SPELLING` this very
slice added is **gone on the re-read**:

```
in   : <Observation xmlns="…fhir"><p:x xmlns:p="urn:a" value="1"/><p:x xmlns:p="urn:b" value="2"/></Observation>
i1   : MIXED_XML_SPELLING@Observation.<withheld> + UNEXPECTED_XML_CONTENT x2
out1 : <Observation xmlns="…fhir"><p:x value="1"/><p:x value="2"/></Observation>
i2   : UNEXPECTED_XML_CONTENT x2                      <- the merge report is gone
```

So **(iv) is closed for the READ and not for the round trip**, and the round-trip half is a declared
residual of route 2, not of route 3. It is pinned by `test/xml.test.ts` so it cannot move in silence.
Route 2 is the thing that has to close before that report can survive a write, which is the honest
reason it is the next item rather than a nice-to-have.

**3. A FHIR-namespace `<div/>` merges into `Narrative.div` with zero diagnostics. CLOSED, one line.**
`modelNameOf` tests `isNarrativeDiv` first and models the narrative as `div` under every spelling of
the XHTML namespace, so `{http://hl7.org/fhir}div` joins `{http://www.w3.org/1999/xhtml}div` in one
group. `reportMixedSpelling` compared **literal tags**, both are `div`, and the document read back
with zero issues and `valid: true` while `Narrative.div` (`0..1`) had become a two-item list.
Comparing the **expanded name** closes it, and closes residual (iv) with it, because a prefix rebound
between siblings is the same defect with a different route in. `MIXED_XML_SPELLING` is the right
code rather than a new one: its published reason is that *the count* changed and a single-value read
of a repeat yields nothing, which is exactly the harm in both. The grouping itself is untouched, per
the standing "report it or drop the grouping" trap: dropping means two properties of one model name
and the XML reader has no `duplicates` mechanism, so it would be a silent first-wins loss.

**The scope call, stated.** Routes 1 and 3 were taken, route 2 deferred. 1 and 3 are each a change of
a few lines at the site that decides, with the harm and the remedy in the same sentence. 2 requires a
new model capability or a new refusal before anything can be written at all.

**Every test added or changed was demonstrated RED by mutation first**, nine of them, because
`FHIR-RESIDUALS-NOT-PINNED` closed exactly the defect of a test that cannot fail. Three of the
mutations were unnecessary in the end: the pre-existing characterization tests for the scalar route
and the rebound prefix, and the `model-edges` enumeration, all went red on their own the moment
`src/` changed, which is what those tests exist to do.

**Measured over this repo's 7 hand-authored XML fixtures plus mutations (1,195 documents), NOT the
FHIR R4 published-examples corpus.** 4 readings moved, all 4 read diagnostics **gained**, 0 lost, 0
validation findings moved either way, 0 `valid`/`safeToSummarize` flips, 0 retractions or negations
lost, 0 leaf values missing, 393 of 396 twin pairs identical with 3 **louder** and 0 weaker.
**The differential's negative control fired on the first run**, exactly as its own trap says it
would: `CONTROL.moved` still described the `FHIR-ELEMENT-TEXT-RECOVERY` slice, which had merged, so
base and head agreed and every zero was meaningless. Re-keyed to this slice's own document. **Re-key
it every time**, and note that the control reads XML only, so the JSON half of this slice is outside
it and is covered by `test/nested-array.test.ts` instead.

### Singleton-wrapper laundering

(e) `PRE-EXISTING`, and the one to pick up first: `serializeResourceXml` **normalizes a singleton
wrapper away** (JSON `{"status":["entered-in-error"]}` -> `<status value="entered-in-error"/>` ->
re-read `valid: true`, `safeToSummarize: true`). Clinical content survives (`retracted: true` on
both sides) and XML genuinely cannot express a singleton wrapper, so this is a narrower laundering
than the duplicate-key one, but it is a **cross-format** route by which the encoding complaint
disappears. **Pinned 2026-08-05** in `test/array-wrapped-scalar.test.ts`, beside the JSON-route test
that pins the opposite behaviour, so the two routes are read together. Before that date this section
was cited as pinned and no test existed.

## P2, P3, and what the package does today

P2:
the first three validation layers (`validateResource`: structure, cardinality, primitive /
enumerated-`code` value-domain) with a value-free `OperationOutcome` and the PHI redaction
chokepoint. P3: the safety-critical status & negation spine (`readSafety`, fail-closed on an
unknown `modifierExtension`, `entered-in-error` retraction, and the `ait`/`con`/`obs` invariants).
Reads, round-trips, structurally validates, never drops a modifier / status / negation, and now
surfaces measured values by their true `value[x]` type with UCUM-`code` unit fidelity (P4, never
converting a unit), and validates code `system`s + binding strength content-free (P5, no
terminology content vendored), and validates resources against caller-supplied US Core / vendor
`StructureDefinition`s (snapshot generation, slicing, fixed/pattern, must-support-as-obligation,
P6, no profile content bundled) and evaluates profile `constraint[]` invariants through a bounded
in-repo FHIRPath engine, reporting anything outside the subset `INVARIANT_UNCHECKED` rather than
passing it (P7), and reads & writes **FHIR XML** into the same model as JSON (the two wire formats
proven equivalent, the reader XXE/billion-laughs-proof by refusal, P8) but with **no** `type`·`profile`
slicing discriminators / reslicing (still `PROFILE_SLICE_UNCHECKED`), no bundled US Core IG corpus or
`validator_cli.jar` differential (P11), no code-validity / value-set-membership guarantee without a supplied
terminology service, and no typed per-resource models. The roadmap lives in
the meta-repo: `operations/roadmaps/fhir.md` (P0…P11).

## `ATTW-FALSE-GREEN-PORT`

**The `attw` script is `node scripts/attw.mjs`, NOT the bare CLI, and it must stay that way
(`ATTW-FALSE-GREEN-PORT`, ported from `terminology`).** `@arethetypeswrong/cli@0.18.4`
`dist/getExitCode.js` opens with `if (!analysis.types) return 0`, so it prints "This package does
not contain types." and exits **0**, before the problem list is read. An untyped npm package is
legal, so that is a description for `attw`; for a package that ships declarations it means the
tarball did not carry them, which is a broken publish reported as a pass. No `--profile`,
`--ignore-rules` or config setting reaches that early return.
**Reproduced here with zero concurrency, at `edb75df`:** `rm -rf dist && pnpm attw` and
`rm -f dist/index.d.ts dist/index.d.cts && pnpm attw` both print the sentence and exit 0.
Concurrency only supplies the condition; **`tsup` is what creates it**, emitting the JS bundles
before the declarations. Measured over four clean builds of this package (mtime of
`dist/index.d.ts` minus `dist/index.mjs`): **1.86 s, 2.03 s, 2.29 s, 2.46 s**, an interval in
every build where `dist/` holds `.mjs`/`.cjs` and no `.d.ts`. **So the answer is not a lock, a
lease or a build queue** (ADR 0015): the gate has to be able to say its inputs were missing,
whatever removed them.
The wrapper carries **two nets that catch different things**: a structural preflight that every
relative path `package.json` promises (`main`, `module`, `types`, `typings`, every string leaf of
`exports`) exists and is non-empty, which catches the build window and **names the missing file**;
and a post-check on the untyped sentence, which catches what the preflight cannot, declarations
present on disk but excluded from the tarball by `files`/`.npmignore`. No instance of that second
case is on record in this repo.
**The post-check reads a string, so the routes that hide the string are refused, not tolerated.
Six were MEASURED here** against a `dist/` with both `.d.ts` files deleted, each exiting 0 with
the sentence unreadable: `--quiet`, `--format json`, `-fjson`, `-Pfjson`, `./.attw.json` setting
`quiet` (`readConfig()` applies it after argv), and `--config-path` pointing at that same config
elsewhere. The refusal is **by option name, wholesale, not by value**: `--format table-flipped`
blinds nothing and is refused anyway, which is the deliberate trade against value-parsing them.
**▶ IT TAKES TWO ARMS, AND A NAME MATCH ALONE IS NOT ENOUGH.** commander lets a short option carry
its value attached and lets short booleans bundle ahead of it, so `-fjson` and `-Pfjson` both mean
`--format json` and carry no `=` for a name match to split on. The refuter found exactly that hole
in pass one. The short-cluster arm refuses any single-dash cluster containing `q` or `f`, which is
sound because `-f` is the only short option here that takes a value, so everything after either
letter is that value. **Do not simplify it back to the name set.**
`test/scripts/attw-gate.test.ts` pins both nets against the real binary, **including the upstream
exit-0 itself**, so an `attw` upgrade that fixes the exit code or rewords the sentence reds the
suite instead of letting the net go slack. It also pins a negative control on a well-formed
package and that a real `attw` failure still fails: a gate that only ever fails is not a gate, and
one that swallows the status is not one either. **Mutation-checked**: reverting `scripts/attw.mjs`
to the bare `attw --pack .` reds **15 of its 24 cases**, and the 9 that stay green are exactly the
ones asserting upstream `attw` behaviour and the transparency controls.
**The preflight normalizes a bare `main`/`module`/`types`/`typings` path** (`dist/index.cjs`, no
`./`), which those four keys may legally be written as. A string leaf of `exports` may not, so
that arm still requires the prefix. Skipping the bare spelling would have been this script's own
failure mode, a promise the preflight quietly does not check.
**Two residuals the gate filed and neither is fixed here, both failing in the SAFE direction.**
An **extension-less `"main": "lib/index"`**, legal for CJS resolution, reds as missing; that is
pre-existing for the `./`-prefixed spelling and cannot fire on this manifest, where every artifact
carries its extension. And a tarball carrying the **declarations but not the JS entry points**
passes both nets with "No problems found", identical on base: the preflight only reads disk and
the post-check is scoped to declarations. **The short-cluster arm is keyed to `0.18.4`'s option
set**, so a future `attw` adding a short alias for `--config-path`, or a second value-taking short
option, reopens the route with no test going red. `@arethetypeswrong/cli` is pinned exactly, and
the four "bare attw really is blinded by X" cases are what would notice an upgrade; re-read this
paragraph when you bump it.
**`scripts/verify.sh` in the meta-repo needs no change and must not be touched**; it already fails
on any non-zero step, and it lists `attw` as a REQUIRED script, so the script name stays `attw`.

## No internal project bookkeeping on a public surface

4. **No internal project bookkeeping on a public surface** (founder directive, 2026-07-27). What a
   consumer reads (`README.md`, `docs-content/`, the npm `description`, a release body, the JSDoc
   their editor renders, the text their log prints) says what the software does and what changed.
   Item identifiers (`FHIR-P10`), phase and wave language, ADR numbers, meta-repo paths and "how
   this got built" commentary belong in the changeset, `CHANGELOG.md`, the commit, the PR and the
   roadmap. It is a **translation** at the boundary, not a deletion, and when you strip an
   identifier off the front of a line, repair the head: a fragment reads worse than the text it
   replaced. Gated by `pnpm check:no-internal-refs` (`.github/workflows/no-internal-refs.yml`, job
   id `no-internal-refs`). The gate keys on known project prefixes, so **a new programme prefix has
   to be added to it by hand**; and it catches identifiers, not English sentences about our process,
   so the reviewer still owns half the rule.

   **Three source surfaces, three different answers.** `/** */` doc comments compile into
   `dist/*.d.ts` and render in a consumer's editor, so they are **gated** (they were the larger half
   here by an order of magnitude: 255 hits against 23 on the whole public markdown surface). String
   literals reach a consumer as message text, so they are **gated too** (measured zero hits here,
   because this library's diagnostics are value-free by contract, an `IssueCode` plus a FHIRPath
   expression). `//` and plain `/* */` comments are **not gated** and identifiers are **welcome** in
   them, because **the convention says source comments are a place identifiers belong**. That is the
   whole reason. **Do not justify this boundary from what reaches `dist/`** (everything in `src/`
   does: `dist` is `files[0]`, there is no `.npmignore`, and `dist/*.map` carries every tracked
   source byte in `sourcesContent`). The line is what a consumer is **shown**, not what lands on
   their disk. Also: **removing a doc comment to satisfy the gate is a regression**, not a fix.

   **This copy of the gate diverges from `hl7`/`ncpdp` in exactly one place, and the divergence is a
   REMOVAL: there is no `slice` rule here.** `slice` is R4 vocabulary in this package
   (`ElementDefinition.slicing`, `sliceName`), not our jargon. Measured with the sibling rule
   enabled: **41 matches, one of them ours.** A 1-in-41 rule tells a remediator to rewrite reference
   material, which is the defect the whole gate exists to prevent, and no lookahead narrows it
   because the collision is with the head noun. The ordinal arm of the phase rule
   ("thirteenth slice") still fires. **Do not paste the rule back without re-measuring.**

   **Two holes worth knowing, both left open on purpose.** (a) The identifier form this repo
   actually writes, `FHIR-P10b`, is **not** caught: the trailing lowercase suffix breaks the word
   boundary, and the bare `P10b` / `P9` forms have no prefix to key on. Closing either needs a
   `P\d+`-shaped rule, which in an earlier `hl7` draft corrupted the ICD-10-CM codes in
   "Map ICD-10 P07, P22 and P29" and truncated the range "P00-P96"; this README carries ICD-10-CM
   codes today. The widening belongs in the one shared prefix list, not in a divergent copy.
   (b) `phase` at the end of a clause ("decoded this phase.") is not caught, inherited from `hl7`
   for the clinical-English collision. Both are the reviewer's catch.

   **`CHANGELOG.md` is deliberately NOT scanned even though it ships inside the npm tarball.** The
   convention names it as one of the places identifiers belong, and rewriting a released changelog's
   history destroys the traceability that same convention preserves. That contradiction is
   ecosystem-wide, `hl7` and `ncpdp` exclude it on identical reasoning, and it is **recorded, not
   decided** here.

## PHI scan scope (2026-08-05)

`PHI-SCAN-WALK-ROOT-SCOPE` and `PHI-SCAN-OBSERVED-NOTHING-IS-GLOBAL`.

Two holes in `scripts/phi-scan.ts`, closed together because closing either alone ships a gate that
reads green over what it did not read.

### The scope, re-derived for this package rather than ported

The walk roots were `test/__fixtures__` and `src`, and `--staged` was scoped to the same two
prefixes, so **a tracked file directly under `test/` was reached by neither route**. Measured here:
**101 tracked files** were scanned by neither route, **55 of them under `test/`**. Counted with the
scanner's own key regex over those 55 files: **87** object-literal `family` / `given` sites and
**21** `birthDate` sites, plus **33** more `family` / `given` and **3** `birthDate` spelled as XML
`value` attributes. The roots are `test` and `src` now, on **both** routes; keeping them different is what let the
hole sit unnoticed.

**The exclusion had a stated reason and the reason covered two files, not a directory.** The old
comment said `test/*.ts` is not walked because the PHI-leak suite ships deliberately PHI-shaped
sentinels. True of `test/phi-leak.test.ts` and `test/scripts/phi-scan.test.ts`; not true of the
other 53. Those two are declared by exact path in `SENTINEL_FILES`, subtracted from the **sweeping**
routes only, **announced** when skipped, and still scanned when named on the command line. They are
not `--allow-fixture`: that needs a flag, CI passes none, so a command-line-only bypass would leave
them unscanned in the one route that matters.

**Nothing was ported.** Sibling residuals were checked and refuted against this tree: `ncpdp`'s 115
test-directory files is **55** here, and `terminology`'s exit **1** on a regular-file walk root is
exit **2** here. Both of the "pre-existing minors" carried over from siblings were measured
**already closed** here before this change: `loadAllowList()` throwing exits **2** (it sits inside
`main`'s handler), and an unmerged `U` entry is in the `--diff-filter=AMTU` list and refused with
**2**.

### Enumerating the files buys the SSN / email floor and nothing else

This is the half that a scope widening on its own silently omits. The structured scanner assumes
**the file is the document** and is reached only for a fixture with a FHIR wire-format extension. A
test builds its resources as TypeScript object literals, so a real surname typed as `family: "…"`
inside a `.ts` file was read by nothing: a dashed SSN and an email are neither a name, a date of
birth nor a street address. Measured on `.ts` carrying
`{ resourceType: "Patient", name: [{ family: "…", given: ["…"] }] }`: exit 0, `OK, no hits`, **both**
before the widening (never enumerated) **and** after it with the recogniser absent (enumerated,
unread).

So `family`, `given`, `birthDate`, `deceasedDateTime` and `line` are keyed in source and dispatched
to the same detectors the structured scanner uses, **in addition to** the shape pass, never instead
of it. **Do not key `text`, `identifier.value` or `telecom.value` there.** `HumanName.text` and
`Address.text` are PHI but a flat pass cannot tell them from `CodeableConcept.text` or an assertion
message; bare `value` is FHIR's most overloaded name (`Quantity.value`, `Extension.value[x]`, every
primitive) and the XML scanner only dares read it inside a `<telecom>` / `<identifier>` block, a
boundary TypeScript source does not have. A gate that false-errors on conformant test code is a gate
someone switches off.

**IN BOTH WIRE FORMATS, AND "FORMATS" IS NOT "SPELLINGS".** This package reads JSON and XML and its
tests write both, so the same `xmlValues` extractor the fixture scanner uses runs over source too;
keying only the object literal left 33 `family` / `given` and 3 `birthDate` XML `value` attributes
unread in the 55 files the widening admitted, and the standing trap ("compare the same document
spelled the other way") is the one that catches that. But the XML arm covers **one of the three ways
this suite spells an XML value**: the double-quoted attribute. A single-quoted attribute
(`value='…'`) and XML **element text** (`<given>…</given>`) are unread, measured at exit 0. The
element-text case has a live site, and it is in `dropped-element-text.test.ts`, the suite whose whole
purpose is element text: on the pre-rename line the `value=`-attribute half reported and the
element-text half did not, so **the scanner forced only half of that rename** and the other half was
done by hand. Declared in `phi-scan-overrides.md` rather than guarded.

Escapes are decoded to a **bounded fixed point (three rounds)**, because this suite routinely writes
a JSON document inside a TypeScript string, so such a value carries two layers of escaping and one
decode leaves a backslash-u sequence whose only surviving name token is `Ro`, which nobody wrote. A
fourth layer is not decoded, and that fails toward reporting: the residue still tokenizes and still
has to clear the allow-list.

Entity references are blanked to a space before tokenizing, which is what stops entity NAMES (`amp`,
`xxe`, `secret`) being reported as person names. Blanking can only split a token apart, never join
two, but **splitting is not the failure there, deletion is**: any letter run between an `&` and a
`;` goes with it, so `Smith&Rodriguez;Jones` reports `Smith` and `Jones` and loses `Rodriguez`.
State that residual as the run, not as "a name spelled entirely as character references".

The widened scan surfaced one false positive and it is this package's own diagnostic form: the email
recogniser cannot tell `UNKNOWN_PROPERTY@Patient.name` from an address, because both are one `@`
between two dotted tokens and `.name` is a real top-level domain.

**THE FIRST REMEDY FOR IT WAS A WIDENING THAT WAS "INSTEAD OF" RATHER THAN "IN ADDITION TO", AND IT
MADE THE GATE DETECT LESS THAN THE ONE IT REPLACED.** This is the single most important thing in the
slice, and it happened in the same change that quotes the rule. A shape exclusion keyed on an
all-caps underscore-joined local part plus a capitalised first domain label, scoped **in intent** to
source files, in fact reached any fixture whose extension is not `.json` / `.xml` / `.ndjson`,
because `scanTarget` routes those down the SAME branch as source. Measured: a fixture carrying
`JOHN_SMITH@Mercy.org` was exit 1 on base and exit 0 with the exclusion. **A PHI gate that detects
less than its predecessor is worse than the defect it was closing.** The refuter found it; the local
suite was green.

It is **reverted**, and the residual it carried is gone with it: that address now reports. One
`EMAILDOMAIN` line covers the single live occurrence with a blast radius of one domain. Enumerated
across the scanned corpus, independently: four distinct email-shaped domains, three only inside the
sentinel-exempt scanner test, **exactly one live**, so the declaration is minimal and sufficient, and
a future one reds loud with a one-line reviewed remedy. **Declare a domain, never a shape rule.**

### Existence is not observation

`walk` returned silently when its root did not exist and yielded nothing when the root was an empty
directory, so an **emptied or deleted** `test/__fixtures__` printed `OK, no hits` and exited **0**
over a corpus still wholly present in the index (measured, both cases).

**A denominator does not detect this and shipping one as the remedy was refuted elsewhere**: a count
counts the roots that DID exist, so the surviving root supplies a healthy-looking number.

Two arms, and they cover different failures. The sharp one **reconciles against the index**: every
path `git ls-files -- test src` names, minus the markdown the walk exempts, must have been opened by
the sweep or the scan refuses with **2** and names every offender. The blunt one is the floor
underneath it: **a sweep that opened zero files refuses whatever the index said**, which covers a
copy of this tree with no repository of its own. **State what that arm covers, which is the
zero-files case and not the general one**: with no usable index and only SOME roots emptied, the
surviving root still yields targets, the arm does not fire, and that state is reported clean. It is
a declared residual, not a covered case. **`git rev-parse --is-inside-work-tree` cannot be
the test, because it answers for the ENCLOSING repository** and returns `true` for a nested copy
whose files git has never heard of; the pathspec is scoped to the scan roots for the same reason, so
a nested copy yields `null` and the walk rather than a list belonging to the wrong tree.

The reconciliation also refuses over a tracked file deleted from the working tree. It cannot tell
that from a vanished root, and refusing is the safe direction of the two.

### What this closed, and what it left open

Three characterization tests went **red on the spot** and were rewritten to the new behaviour, which
is that mechanism working: the observed-nothing gap, the scan-root's-**parent**-as-a-link gap (now
refused on both routes, by different mechanisms), and three quarters of the regular-blob-at-the-
fixture-root gap. **Still open, pinned:** at exactly `test/__fixtures__`, `identifier.value` and
`telecom.value` are read by nothing, because `isFixture` tests a trailing slash and the remaining fix
belongs to `scanTarget`'s dispatch. Full residual list, and the reviewed allow-list additions the
widening forced, are in `phi-scan-overrides.md`.
