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
writer emitted one member per name, deliberately, at the time; that decision was **superseded
2026-08-08** and both writers now refuse ([`#the-shadowed-member`](#the-shadowed-member-2026-08-08)).
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
array) leaves no node to mark, so an array inside one is reported against the discarded sibling and
draws **no refusal**: `{"name":{...},"_name":[[...]]}` still reads `safeToSummarize: true`.
**WHICH code reports it is per member, not one code for all three** (corrected 2026-08-08,
`FHIR-README-ARRAY-WARNING-WRONG`): that `_name` example draws `MISPLACED_PRIMITIVE_EXTENSION`, as
does a `_`-sibling on a non-primitive array; only an unrecognised member of a `_`-sibling object
(`{"birthDate":"1980-01-01","_birthDate":{"foo":[["x"]]}}`) draws `UNKNOWN_PROPERTY`. The
underlying loss is
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
principle**, one branch over in the same function: _"Conservatism here means refusing to author a
value, not refusing to hand one back."_ The text is kept on the node (`FhirComplex.nonObjectSource`)
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
code rather than a new one: its published reason is that _the count_ changed and a single-value read
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

### `div` forges a negation (2026-08-07)

**THE `div` BRANCH NO LONGER SPLICES A STRING INTO THE DOCUMENT UNEXAMINED.** The item that carried
this defect forbade proposing a remedy before measuring one, because two earlier drafts had guessed
and both guesses were false. The measurement came first, and it changed the shape of the answer
twice, so the order is the point.

**▶ 🛑 THE STANDING CAVEAT, WHICH TRAVELS WITH EVERY NUMBER BELOW: this repo's XML corpus is 7
hand-authored fixtures plus mutations, NOT the FHIR R4 published-examples corpus.** The sweep here
is over generated `div` STRINGS, which is a third axis again, and is not corpus-wide either.

#### What was measured, before anything was proposed

A battery of 16 `div` strings through `parseResource` -> `serializeResourceXml` -> `parseResourceXml`
on `658a1f0`, recording emission, re-read issues, `validateResource`, and the whole safety readout at
both ends. What it established, and each line changed the remedy:

- The flagship forgery re-reads with `noKnownAllergy: true`, `negations: ["no-known-allergy"]`,
  `safeToSummarize: true` and an **empty issue list**, exactly as the item says. It also re-reads
  `validateResource().valid === false`, because the breakout leaves two `<text>` elements. **The item
  never claimed `valid: true` on the re-read and neither does anything here.**
- `{"resourceType":"Observation","div":"<status value=\"final\"/>"}` is **one perfectly well-formed
  element**. So the second wrong guess ("well-formedness does not close it") was wrong in the other
  direction too: well-formedness is not sufficient, not merely not necessary. A check that stopped at
  well-formedness would have left the status forgery wide open.
- **A shape nobody had recorded: `{"div":""}` is dropped in SILENCE.** Base emitted
  `<text><status value="generated"/></text>`, the property simply gone, empty issue list and
  `valid: true` at both ends. Of the three recorded shapes `{"div":"v"}` was the one said to fail
  safe; this fourth one does not fail at all.
- **Every `div` string the XML READER produces passes the check**, over 7 spellings (default and
  prefixed XHTML, no declaration, vendor namespace, empty element, a comment inside, an escaped `<`)
  and over the fixture corpus. `narrativeSource` serializes one element and materialises the
  namespace declarations it inherited, so the string it hands back is always one balanced element
  whose local name is `div`.

#### The remedy the measurement chose, and why it is at the write

`emitsOneDivElement` in `src/xml/write.ts`: the string is written only when `readRawXml` parses it as
a document with exactly one root element **and** that root's local name is `div`. It runs at the
branch that splices the string in, next to `tag()`, for the reason `tag()` gives: a pre-pass would
re-derive the writer's branching and be free to disagree with it. `refuseUnserializableDivMarkup`
raises `UNSERIALIZABLE_DIV_MARKUP` at the root once the walk is done, after the name refusal, so a
model tripping both keeps the code base already reported.

- **The same parser, over the same bytes, is what makes the STRUCTURE checkable.** `readRawXml` is
  what `parseResourceXml` re-reads the emitted document with, and the fragment is balanced, so the
  element structure it reports is the structure the re-read sees. **It settles the structure and
  nothing else, and the 2026-08-07 gate refuted the wider sentence that stood here.** `readRawXml`
  is depth-STATEFUL: this check spends the 256 budget from 0, the re-read spends it from the `div`'s
  depth in the document, so a `div` holding 254 nested elements is accepted and the emitted document
  raises `MAX_DEPTH_EXCEEDED` on re-read. Loud, byte-identical on base, and pinned by a test.
- **The local name, not the full name**, because `<h:div xmlns:h="…xhtml">` is a spelling this
  library reads and round-trips today and refusing it would withdraw a working round trip.
- **Not the namespace, and not whether a prefix is bound inside the string.** An unprefixed `<div>`
  under no declaration and a vendor-namespace one both reach `Narrative.div` on the read. **Only the
  vendor one comes back unchanged**: `<div>x</div>` re-reads as `<div xmlns="http://hl7.org/fhir">x</div>`
  with zero diagnostics, so the library inserts a declaration the sender never wrote and moves the
  narrative out of the namespace R4 names for it. Pre-existing, pinned by a test, and the reason the
  justification here is "both reach `Narrative.div`" and not "both round-trip unchanged". A root
  whose prefix nothing binds IS accepted, and the emitted document re-reads it as a property named
  `v:div`: that is the separately declared unbound-prefix residual reached through a value, not this
  defect, and folding it in would have made this slice the fix for a class it had not measured.
- **Refusing rather than repairing**, for the same reason as a name: escaping authors a text node
  where the sender wrote markup, splicing authors elements, and `serializeResource` carries the
  string as a string, so the capability is routed rather than lost.

#### The numbers, and the one instrument that could not grade this

**360,020 `div` strings** (a directed set of 20, 120,000 built from markup atoms, and 240,000 one-
and two-edit mutations of six strings this library reads back unchanged, which is where a false
positive would live). **107,807 accepted, 252,213 refused, and of the 65,464 whose BASE round trip
returned the string unchanged, 0 are refused: 0 false positives.** The sweep carries a negative
control that fires when the imported tree parses no FHIR resource at all; pointed at `@cosyte/hl7` it
exits 2 and prints that every number above it is meaningless, and against this package it is silent.

**▶ THE READ DIFFERENTIAL CANNOT GRADE THIS SLICE, AND SAYING SO IS THE HONEST RESULT.**
`pnpm differential:read` over 1,195 documents reports 0 readings moved, 0 newly throwing, 0 leaf
values missing, 0 diagnostics lost and the same 360 refusals as base. Those zeros are **expected by
construction**: no XML document this library can read produces a `div` string the check refuses, so
the harness has nothing to see. Two further facts, both `PRE-EXISTING` and neither introduced here:
its `CONTROL.moved` still names the merged `MIXED_XML_SPELLING` slice, so the negative control fires
on an **unmodified working tree** (verified by stashing and re-running), and its `whole()` compares
`json`/`valid`/`findings`/`issues`/safety but **not `xml`**, so it could not see an XML-writer-only
divergence in any case. Re-keying it needs a document THIS change moves and there is none.
**Do not report those zeros as a green control.**

#### What pinned it, and what pins it now

The three characterization tests in `test/xml-tag-name.test.ts` went **red on this change**, which is
the mechanism working, and were rewritten as the same shapes with their new outcome so the base-to-head
comparison stays readable in one place. Six refusal tests plus a block of what is still written; every
one was demonstrated red against a mutation of the behaviour it pins and against **only** that one
(the check forced to `true` reds five; swapping the two refusals' order reds the precedence test and
nothing else). The false-positive control is committed as a `fast-check` property that builds base's
output by hand, so a reviewer re-derives it rather than trusting a number here.

#### The gate refuted pass 1, and every finding was prose

**Two `INTRODUCED` majors, both claim width, neither a defect in the check.** The gate could not
break `emitsOneDivElement`: 55,677 accepted strings built from breakout atoms, none escaping the
invariant that the emitted document holds one `<text>` holding the `div`; 200,000 generated XML
documents read and re-serialized with **zero** refusals; and refusal-implies-base-did-not-round-trip
confirmed case by case against a base tree materialised with `git archive 658a1f0`.

**▶ 🛑 THAT MAKES SIX GATE PASSES RUNNING REFUTING A UNIVERSAL IN THIS AREA'S PROSE, AND THIS ONE
SHIPPED IN `dist/index.d.ts` AGAIN.** "`serializeResource` encodes every one of these correctly" is
false: `{"text":{"div":""},"name":[[{"family":"X"}]]}` is refused here and `serializeResource` emits
the array inside an array, which is one of that writer's own declared exceptions. The claim is now
"this refusal never reaches it and that route stays open", which is what was actually meant, and the
same sentence was narrowed on the NAME arm beside it, where it was `PRE-EXISTING` and identical. The
runtime error message carried it too, so it reached consumer logs. **The `#64` changelog entry and
its pending changeset still carry the wide wording and were deliberately not edited**: they are a
record of what that slice said.

**▶ AND THE NAME ARM IS ONLY PARTLY NARROWED, WHICH IS A BACKLOG LINE RATHER THAN A CLAIM.** Exactly
one site was touched there, its `SERIALIZE_ERROR_CODES` docblock. `refuseUnserializableNames`'s
runtime message and `breaksTag`'s docblock still say the JSON writer "encodes the model correctly",
byte-identical to base, and the same `name: [[{"family":"X"}]]` counterexample falsifies both. The
message reaches consumer logs. `PRE-EXISTING`, not folded in.

The second was the soundness sentence, corrected above. Three further `PRE-EXISTING` counterexamples
the gate produced are now asserted in tests rather than described: the depth boundary, the inserted
namespace declaration, and an **XML declaration**, which is not a processing instruction (XML 1.0
§2.6 reserves the `xml` target, §2.8 allows the declaration only at the start of an entity) but which
`skipMisc` swallows, so `<?xml version="1.0"?><div …/>` is accepted and the output is rejected by
expat while this library re-reads it clean.

_Provenance: every load-bearing fact in this section is measured against this codebase at `658a1f0`
and `45b42b5`, not cited. The XML 1.0 clauses above are the only external citations._

#### Left open deliberately

- The `_`-sibling whose value is not an object, the non-string `resourceType` tag substitution, and
  `escapeAttr` passing XML-illegal control characters. All `PRE-EXISTING`, all named on the item, all
  read-path or attribute-path rather than this branch. (True at this slice. The `resourceType` tag
  substitution was **CLOSED 2026-08-09**, `UNSERIALIZABLE_RESOURCE_TYPE`; the other two are open.)
- Comments and processing instructions beside the root are accepted and do not survive the re-read.
  Neither is an element, so neither can forge one; pinned by a test rather than argued.
- **The accepted-`div` round trip is not idempotent and the output is not always well-formed**, per
  the counterexamples above, and pass 2 added another of that class: `<div>]]></div>` is accepted and
  emitted, and `]]>` is excluded from `CharData` (XML 1.0 §2.4), so expat rejects the output while
  this library re-reads it. All `PRE-EXISTING`, none introduced by the check, none folded in: each is
  a different defect from the forgery this item names.
- **The pre-merge edits after pass 2 are UNGRADED**, and pass 2 said they needed no further pass: a
  definite article that read as a closed enumeration, an error code asserted in the depth test rather
  than a bare throw, and the name-arm scoping sentence above. ADR 0016's cap is not spent on them.

#### Open read-path losses, enumerated

_Relocated verbatim from `CLAUDE.md` on 2026-08-07 under the doc budget, nothing dropped. The rule it
qualifies stays there._

A **status** or a dose number written as XML element text is dropped (reported, and the writer
refuses, but the safety spine reads `negations: []`), which is the one that qualifies "never drops a
modifier, status or negation"; so are a scalar beside a nested array (**still not modeled**, but
since 2026-08-05 its text is preserved and handed back, so the finding survives a **JSON** round
trip; through the XML writer it is still `<name/>` and both the value and the finding go), a
`_`-sibling discarded whole, a foreign child of a valued primitive, character data at the three
`flagStrayText` sites, an unbound prefix, and a `<DIV>` wrapper.

### `FHIR-UNBOUND-PREFIX-ROUNDTRIP` (2026-08-07)

**THE DEFERRAL STANDS, AND MEASURING IT FOUND A STRICTLY WORSE DEFECT IN THE SAME FUNCTION.** The
item asked whether `#59`'s deferral of the unbound prefix still holds. It does, unchanged, on the
measurement below. What the same measurement turned up is that "a prefixed foreign property with the
prefix unbound" is one member of a class `serializeResourceXml` never checked at all, and another
member of that class **fabricates clinical content across one round trip**.

**▶ 🛑 THE STANDING CAVEAT, WHICH TRAVELS WITH EVERY NUMBER BELOW: this repo's XML corpus is 7
hand-authored fixtures plus mutations, NOT the FHIR R4 published-examples corpus.** The sweeps here
are over generated NAMES rather than over documents, which is a different axis and is stated as such
each time; neither is corpus-wide.

#### The deferral, re-measured

`#59` recorded two remedies: **(a) carry namespaces in the model**, or **(b) refuse any property
name with a colon**. Both still stand, and both are still larger than the defect:

- **(a)** needs a binding per OCCURRENCE, not per complex. The shape residual (iv) names is a prefix
  **rebound between siblings**, so one prefix carries two URIs among the children of one element. A
  prefix-to-URI map hung on the complex cannot represent that, and picking either binding would
  assert that the other occurrence was in a namespace it was not: the fabrication class. So (a) is a
  new model capability on the node, not an inert map beside it, and `test/model-edges.test.ts`
  polices that surface deliberately.
- **(b)** withdraws writing back a document that reads `valid: true`. Measured: a prefixed foreign
  property draws one `UNEXPECTED_XML_CONTENT` at **warning** severity, `validateResource` returns
  `valid: true`, and `serializeResourceXml` -> `parseResourceXml` returns the property unchanged.

**▶ 🩺 AND ONE THING THE BACKLOG SAID WAS NOT WHAT `#59` MEASURED.** The item reads "both remedies
withdraw a capability for a shape that reads `valid: true`". `#59`'s own sentence attaches the
withdrawal to **(b) alone** and then says "**Both are larger** decisions than the defect". Only (b)
withdraws anything; (a) adds. The compression matters because it makes (a) look disqualified when it
is merely expensive, and a future reader weighing the two should weigh the real pair.

#### What the measurement found instead

`serializeResourceXml` builds a start tag by interpolating a name the document supplied, with **no
check of any kind**. The model is schema-free and the JSON reader admits any member name, so the
tag position is reachable by arbitrary text. Measured over 2,350 sampled names (every code point
`U+0001`-`U+02FF` at three positions in a name, eight higher ones, plus a hand-written adversarial
set), the emitted markup falls into exactly three groups:

1. **It re-reads as the same one element.** `p:x`, `:x`, `a:b:c` (the named residual), and also
   `a&b`, `1abc`, `-lead`, `a"b`, `a\vb`, `a\fb`, `a b`. A conformant third-party parser
   rejects all of them. This library does not.
2. **It does not re-read at all.** A name containing XML's own whitespace (space, tab, CR, LF) or
   `/`, `>`, `=`, `<`, an empty name, or a name beginning `!` or `?` (which make `<` open a markup
   declaration or a processing instruction instead of an element).
3. **It re-reads as DIFFERENT elements, and a conformant parser ACCEPTS it.** The breakout:

```
in   : {"resourceType":"Observation","zz value=\"1\"/><status":"final"}
i1   : (no diagnostics) valid: true, readSafety().status: undefined
out  : <Observation xmlns="…fhir"><zz value="1"/><status value="final"/></Observation>
i2   : (no diagnostics) valid: true, readSafety().status: "final"   <- FORGED
```

**A clinical status the sender never wrote, asserted by our own writer, under `valid: true` at both
ends and with zero diagnostics on either side.** Same harm shape as the JSON writer authoring `{}`
for a value it never read (`#59` route 1), and worse than the item's own headline: the headline was
"a conformant parser rejects our output", and this is a conformant parser **accepting** it and
reading content that was never sent. The root `resourceType` is the same site
(`{"resourceType":"P xmlns=\"urn:evil\""}` emits a second `xmlns`).

#### The remedy, and why the line is where it is

Group 2 and group 3 are refused: a new `SERIALIZE_ERROR_CODES.UNSERIALIZABLE_ELEMENT_NAME`, thrown
by `serializeResourceXml` only. Group 1 keeps being written, which is `#59`'s deferral intact.

**THE LINE IS "DOES THIS LIBRARY'S OWN ROUND TRIP SURVIVE IT", NOT "IS THIS A CONFORMANT XML NAME",
AND THAT CHOICE IS THE WHOLE DESIGN.** The tidier rule is the `Name` production (XML 1.0 §2.3), and
it was rejected on measurement: `a&b`, `1abc`, `-lead` and `a"b` all fail that production and all
round-trip through this library today, so refusing them would withdraw a working round trip from
models that read `valid: true`. That is precisely the cost `#59` declined to pay for the prefix, and
paying it here for the same class would be incoherent. Group 2 and 3 cost nothing, because nothing
works today: one fails, and the other was never the sender's document.

**Repairing was not available.** XML has no escape for an element name, so the alternatives to
refusing are mangling the name (authoring a name nobody wrote) or emitting the breakout (authoring
elements nobody wrote). Both are the fabrication class. Refusing invents nothing, and
`serializeResource` escapes a member name, so this refusal never reaches it and that route stays
open. That is what makes this a refusal and not a withdrawal. **Narrowed 2026-08-07 from
"`serializeResource` still encodes every one of these models correctly", the same wide claim `#65`
and `#66` closed at the other sites**: that is a claim about the whole model and it is false, because
a model refused here can carry one of the JSON writer's own declared exceptions and have it emitted. Pinned by a test rather than described
(`{"resourceType":"Observation","name":[[{"family":"X"}]],"zz value="1"/><status":1}` is refused here
and comes back out of `serializeResource` with the array inside an array intact).

**▶ THE CHECK RUNS AT THE EMISSION SITE, NOT IN A PRE-PASS WALKER.** A pre-pass would have to
re-derive the writer's own branching (which names become attributes, which become the tag, which are
dropped entirely) and that duplicate is free to drift. `tag()` is called from every site that writes
a name and from no other, which is the same discipline the reader uses for `isForeign`. It cost
threading a bounded path through four functions.

**▶ THE LOCATIONS CANNOT ECHO THE NAME, AND THAT IS ASSERTED RATHER THAN REASONED.** A refused name
is document content and one shape of it is a forgery built to look like markup. Every name this
refuses also fails the far narrower `elementName` / `resourceTypeName` shapes in `model/path.ts`, so
each renders `<withheld>`. Pinned, because the guarantee holds only while that containment does.

#### Reachability from XML: NEARLY none, and the "by construction" version was FALSE

**An earlier draft of this section said "no document `parseResourceXml` reads can reach this
refusal", derived it "by construction" from the raw reader's `parseName`, and used it to justify
skipping a verification step. Pass 2 of the gate broke it.** `parseName` does stop at exactly
`isWs(c) || "/" || ">" || "=" || "<"` and does refuse an empty name, so no **unprefixed** tag can
carry one. The proof overlooked **prefix stripping**: `modelNameOf` models a prefixed element under
its LOCAL part, so a `!` or `?` can end up at the front of a modeled name even though no tag may
start with one.

```
in : <Patient xmlns="…fhir" xmlns:a="…fhir"><a:!x value="1"/></Patient>
     issues [] , valid: true , properties ["resourceType", "!x"]
out: REFUSED (UNSERIALIZABLE_ELEMENT_NAME).  Base wrote `<!x value="1"/>`, which this
     library then could not re-read.
```

So the refusal IS better than base for that document, and it IS a document that used to serialize
and now does not. **Both halves are the honest statement; the first alone was the overclaim.** The
counterexample is now asserted in `test/xml-tag-name.test.ts` rather than left as prose, and the
fast-check property beside it is retitled to the unprefixed case it actually covers.

**▶ 🩺 `pnpm differential:read` WAS NOT RUN, AND THE REASON FIRST GIVEN FOR THAT WAS THE FALSE
CLAIM ABOVE.** The reason that survives is only the harness's own: it reads XML, and its control
docblock already says it "would NOT catch a base/head divergence confined to the XML writer", which
this slice is. **Record the evidence that actually stands in its place**, rather than the harness
zero: two fast-check properties in `test/xml-tag-name.test.ts`, and the two independent gate sweeps
(3,221 probes over every code point `U+0000`-`U+02FF` at four positions plus higher and adversarial
ones, cross-checked against **expat** as a conformant third-party parser, **0 false positives**).
Widening `whole()` and re-keying the control is still the right move for the next writer-side slice.

#### Every test proved red by mutation

Twelve mutations, each run against the new suite, each red, restored from a snapshot between runs:
dropping the leading-`!`/`?` arm; dropping `=`; dropping `/` (the fabrication character); widening
XML's `S` to the JavaScript `\s` class (which over-refuses `\v`, `\f`, `U+00A0`); dropping the
empty-name arm; over-refusing via the `Name` production; and stopping the check at each of the four
tag-writing sites, plus echoing the name instead of the location, dropping the dedup, and emitting
the markup anyway. **The first pass of this matrix left one mutation GREEN**: the wrapper tag of a
resource-valued element had no test, because the existing case exercised the inner `resourceType`
and the outer name happened to be `contained`. A test was added for it. That is the matrix earning
its keep, and it is the reason to run one rather than to reason about coverage.

**▶ 🛑 A PROCESS TRAP THIS SLICE PAID FOR, AND IT COST THE WHOLE IMPLEMENTATION ONCE. A MUTATION
HARNESS MUST RESTORE FROM A SNAPSHOT, NEVER FROM `git checkout --`.** The first version of the
matrix restored with `git checkout -- src/...` between runs. The slice was uncommitted at that
point, so the baseline run's restore discarded every source edit in it, silently and irreversibly,
and the whole implementation had to be redone from context. Snapshot to a scratch path first and
`cp` back. Untracked test files survive; tracked source does not.

#### The gate: pass 1 REFUTED, and what it was refuted for

**Pass 1 returned `REFUTED`, and every finding was about CLAIM WIDTH, not about the code.** It could
not break the refused set: 3,221 probes over every code point `U+0000`-`U+02FF` at four positions
plus higher and adversarial ones, cross-checked against **expat** as an independent conformant
parser, found **0 false positives** (nothing refused that base round-tripped) and no XML input that
reaches the refusal. Claims 1, 2, 3 and 7 above were verified rather than broken.

What it broke was three sentences, and one of them led straight to the `div` fabrication recorded
below: **"it will not author an element the sender never wrote"** on the write path, **"a writer may
decline to hand a model back, but it may never author content of its own"** on the guard, and **"A
name that would author ELEMENTS is refused"** in `CLAUDE.md`. Two of the three shipped to consumers
in `dist/index.d.ts`. Also refuted: a fast-check docblock claiming the property said **"not any"**
when its alphabet cannot spell `div`, the one name that breaks the invariant; and
`refuseUnserializableNames` claiming every location renders `WITHHELD`, which is false at a nested
resource's type (reported at the wrapping element's location, so there is no segment to withhold).
The remedy was claim-narrowing plus pinning the gap, and **the guard was deliberately not grown**:
growing it would have made this slice the fix for a class it had not measured.

**▶ 🛑 FIVE GATE PASSES RUNNING HAVE NOW REFUTED A UNIVERSAL IN THIS AREA'S PROSE, AND THIS ONE WAS
IN THE `.d.ts`.** The rule the repo already had ("name the set the code actually walks") extends to
the writer: **name the SITE, not the writer.** A sentence about "the writer" is a claim over every
branch it has, and `writeItem` has a branch that emits raw markup.

#### Pass 2 also REFUTED, and the pattern is the finding

**Pass 2 returned `REFUTED` too, on two `INTRODUCED` majors, and BOTH were sentences the pass-1
remedy had just written.** "Unreachable for a model read from XML" (false: prefix stripping) and
"well-formedness does not close the `div` gap" (false: `readRawXml` rejects the flagship value). It
also caught a fourth `div` test whose title claimed one thing while its single `toThrow()` assertion
stayed green under the very remedies it said were ruled out, and a "silently deletes" that is loud.

**▶ 🛑 THE PATTERN, WHICH MATTERS MORE THAN EITHER FINDING: EVERY REWRITE PRODUCED A FRESH FALSE
UNIVERSAL.** Pass 1 refuted three, and the prose written to fix them carried two more. Both passes
found nothing wrong with the code. **So the pass-2 remedy DELETED rather than reworded**, which is
this repo's own standing rule that a disclosure reworded twice is deleted, not reworded a third
time: the vacuous test is gone with a comment saying why, the remedy speculation about the `div` gap
is gone entirely, and the measurements are stated with no claim attached about what would close
them. Where a fact was still needed, it is a counterexample asserted in a test rather than a
sentence.

**The rule to carry forward: name the SITE, not the writer, and prefer a failing example to a
universal.** A sentence about "the writer" is a claim over every branch it has.

#### Left open deliberately, and NOT folded in

- **The named residual itself.** Group 1 above, `#59`'s deferral, unchanged. Pinned in
  `test/xml-tag-name.test.ts` ("declared gap, still written") as a characterization test over the
  gap, and still pinned in `test/xml.test.ts` for the rebound-prefix round trip. Closing it MUST red
  both.
- **🔴 A `div` PROPERTY IS WRITTEN BACK AS RAW MARKUP, AND IT IS A FABRICATION ROUTE STRICTLY WORSE
  THAN THE ONE THIS SLICE CLOSED. `PRE-EXISTING`, byte-identical at `e2e5965`, STOP-THE-LINE, its own
  item.** Found by the pass-1 gate while refuting this slice's prose, which had claimed the writer
  "will not author an element the sender never wrote". It does.

  ```
  in : AllergyIntolerance, text.div = '<div xmlns="…xhtml">ok</div></text>
       <code><coding><system value="http://snomed.info/sct"/>
       <code value="716186003"/></coding></code><text>'
       -> no allergy code in the model, noKnownAllergy false, negations []
  out: spec-clean FHIR R4 XML, accepted by expat, NOT refused
  re : noKnownAllergy TRUE, negations ["no-known-allergy"], safeToSummarize TRUE
  ```

  `716186003` is this repo's own `NO_KNOWN_ALLERGY`, documented in `src/safety/codes.ts` as a
  **positive** clinical assertion. So the writer manufactures a positive no-known-allergy record out
  of a document that asserted nothing, with **zero diagnostics on both sides** and the safety spine
  affirming it. Worse than the name breakout this slice refuses, which at least left a bogus sibling
  behind: this emits FHIR no downstream system can tell from the real thing.

  **What the first draft of this note got WRONG, twice over, and what is therefore NOT said here.**
  Draft one called it "an entirely different sink" from the name defect and named only the benign
  unbalanced variant (`{"text":{"div":"<div>not closed"}}`, which merely makes the output
  unreadable). Draft two corrected that and added a remedy claim: "validating XHTML well-formedness
  does NOT close it, because the harmful shape is well-formed." **That is also false** and pass 2
  measured it: `readRawXml` rejects the `AllergyIntolerance` value above (trailing content after the
  root). **So no claim about what would or would not close this is made here at all.** Two wrong
  remedy claims in two drafts is the signal to stop guessing and measure it when the item is taken.

  It is also **not scoped to `Narrative`**: `writeItem` keys on the name `div` at any depth in any
  resource, so `{"resourceType":"Observation","div":"<status value=\"final\"/>"}` forges a status
  outright. `{"div":"v"}` loses the property, but **loudly**, not silently: the value lands as
  character data on a FHIR element, so the re-read carries `UNEXPECTED_XML_CONTENT` and
  `safeToSummarize: false`. That is the one of the three shapes that fails safe. Pinned by
  `test/xml-tag-name.test.ts` ("declared gap, NOT closed here"). **The write path's module docblock
  had asserted the opposite** ("Narrative `<div>` XHTML is deferred and is not produced by the
  writer"), which was false: `writeItem` has emitted it since the narrative landed. Corrected.

- **🔴 A `_`-sibling whose value is not an object is discarded with ZERO diagnostics.** Newly
  measured and **not** this item: `{"resourceType":"Observation","_status":"entered-in-error"}`
  reads as `{"resourceType":"Observation"}` with an empty issue list and `valid: true`. So does
  `"_gender":"v"` beside a real `gender`, and `"_gender":[1]`. The notes describe the `_`-sibling
  sites as reporting `MISPLACED_PRIMITIVE_EXTENSION`; this route reports nothing. Read-path, its own
  slice, do not fold it into a writer change.
- **Still deferred from `#47`:** the two unplaceable shapes and the 27 documents whose emitted XML
  re-reads differently. Untouched.

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
   whole reason. **Do not justify this boundary from what reaches `dist/`** (`dist` is `files[0]`,
   there is no `.npmignore`, and `dist/*.map` carries source text in `sourcesContent`). The line is
   what a consumer is **shown**, not what lands on their disk. Also: **removing a doc comment to
   satisfy the gate is a regression**, not a fix.
   **▶ THE PARENTHESIS USED TO SAY "everything in `src/` does"**, which is wider than what a build
   produces (2026-08-08). The **warning** is unchanged and still right; only its over-wide ground was
   cut, and **no replacement set is named here on purpose**.
   The same sentence in `scripts/check-no-internal-refs.sh` and the same clause in `CLAUDE.md` were
   **cut the same way** on 2026-08-08, and the gate script now carries the method instead of the
   claim: [tarball reach, derived from a real `npm pack`](#tarball-reach-derived-from-a-real-npm-pack).
   Prior drafts and why a narrower replacement is still a new claim:
   [where it ships, answered wrong four times](#the-stale-div-disclosure-deleted-2026-08-08-fhir-changeset-div-stale).

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

## The README lockup link, and what npm does with it (2026-08-06)

The `<picture>` lockup at the top of `README.md` is now wrapped in `<a href="https://cosyte.com">`.
The block inside it did not change. This section records **what was measured, and how to re-measure
it**, because the same markup is expected to spread across the other cosyte READMEs and **the answer
is not the same on the two surfaces it has to survive.**

### The question

`<picture>` on npm was already known to degrade safely: npm passes the tag through, npm package pages
have no dark mode, and so the on-light `<img>` fallback is both what renders there and the correct cut
for a permanently white page. **Whether an anchor wrapping a `<picture>` survives is a separate
question, and that earlier finding does not answer it.**

### The one-command discriminator, and it is the useful part of this note

GitHub's markdown API renders the **same input** two different ways, and the two ways are exactly the
two surfaces. Run both against this repo's block:

```bash
# What github.com does: anchor kept, <img> stays a direct child of <picture>.
gh api -X POST /markdown -f mode=gfm -f context=cosyte/fhir -f text="$(cat block.html)"

# What an npm package page does: the anchor collides and the <img> is lifted out.
gh api -X POST /markdown/raw -H "Content-Type: text/x-markdown" --input block.html
```

**Name the mode whenever you record this.** The discriminator is `mode: gfm` against
`mode: markdown`, and **not** the `context` argument: `gfm` preserves the anchor with or without a
`context`. The API's **default** `mode: markdown`, and `/markdown/raw`, both return the collided
structure instead. A worker who runs "GitHub's markdown renderer" the obvious way gets the opposite
result and will read an unqualified record as false.

### What was measured

**On GitHub the anchor works, and the colour-scheme switch keeps working.** Under `mode: gfm`:

```html
<a href="https://cosyte.com" rel="nofollow">
  <themed-picture data-catalyst-inline="true"
    ><picture>
      <source
        media="(prefers-color-scheme: dark)"
        srcset="https://camo.githubusercontent.com/..."
      />
      <img alt="Cosyte: ..." src="https://camo.githubusercontent.com/..." /> </picture
  ></themed-picture>
</a>
```

The `<a>` is kept, and the `<img>` is still a **direct child** of `<picture>`, which is the condition
the HTML spec puts on `<source>` applying at all: source selection runs only when the `img` element's
**parent** is a `picture` element. Image URLs are proxied through `camo.githubusercontent.com`. This
was also read off the live `github.com` rendering of a third-party README carrying the same shape, so
it is not an artifact of the API.

**On an npm package page the anchor is lost.** The renderer wraps a README `<img>` in **its own**
anchor pointing at the image file. An `<a>` nested inside another `<a>` is not representable in HTML,
so the parser closes the author's anchor early:

```html
<a href="https://cosyte.com" rel="nofollow"
  ><themed-picture
    ><picture>
      <source media="(prefers-color-scheme: dark)" srcset="..." /> </picture></themed-picture></a
><a target="_blank" rel="noopener noreferrer nofollow" href="...image file..."
  ><img ... style="max-width: 100%;"
/></a>
```

The author's anchor ends up wrapping a `<picture>` with **no `<img>` in it**, which renders nothing,
and the image is a **sibling**, linked to the image file rather than to `cosyte.com`.

**Named sources, so the next reader can re-check rather than take it on trust.** Both are archived
npm package pages, fetched with the Wayback `id_` suffix that returns the original bytes:

| Shape                                  | Package                                    | Snapshot         | What npm served                                                                      |
| -------------------------------------- | ------------------------------------------ | ---------------- | ------------------------------------------------------------------------------------ |
| Author anchor around `<picture>`       | `tsup` (its `chromatic.com` sponsor block) | `20241217195415` | The collided structure above: empty anchor, image a sibling linked to the image file |
| **Bare** `<picture>`, no author anchor | `@biomejs/biome` (its top banner)          | `20250508123852` | npm's anchor inserted **inside** the `<picture>`, around the `<img>`                 |

The second row is the other half of the same mechanism: with no author anchor to collide with, npm's
anchor still takes the `<img>` out of the direct-child position, so **the `<source>` is inert on npm
either way.** `/markdown/raw` reproduces both structures on demand, including `target="_blank"`,
`rel="noopener noreferrer nofollow"` and `style="max-width: 100%;"`. It is a GitHub API call, not a
local computation, so it needs network and a token like any other.

**Do not cite `turbo` for the bare case.** Its README wraps its `<picture>` in an author anchor, so
that page is the **collision** case, not the bare one.

**The mechanism was reproduced rather than inferred, and the input matters.** Parse the renderer's
**pre-collision** emission, that is the author's anchor still wrapping a `<picture>` whose `<img>` the
renderer has just wrapped in a second anchor, and an HTML parser yields exactly the structure npm
serves: two sibling anchors, `img.parentElement` is the anchor the renderer added, the picture has no
`img` descendant, and the author's anchor has empty text content. **Parsing the already-collided
served bytes instead proves nothing**, because that is the output, not the input.

### The disposition

**The anchor is kept.** On GitHub it does what the requirement asked for. On npm it silently does
nothing, and that outcome takes nothing away: the image npm renders is the same on-light fallback it
rendered before the anchor existed.

**Three things to state honestly rather than smooth over.**

1. **There is a cost, small and real.** On npm the markup leaves an empty `<a href="https://cosyte.com">`
   with no accessible name beside the image (WCAG 2.4.4 / 4.1.2, Level A). **Do not repeat the earlier
   "no failure mode" phrasing**; this shape has one, it is minor, and it lives on npm only. It is
   unreachable for this package, which has no npm page, and it lands on live pages only when the
   wave copies the markup, or when this package's own publish block lifts.
2. **The alt text is now doing double duty as the link's accessible name**, and it describes the
   artwork rather than the destination, which is what the base chose **because the image was not a
   link**. It is borderline against WCAG 2.4.4 rather than a clear failure, since the name begins with
   "Cosyte". **Do not add "and the context supplies the purpose" as a second reason**: this block is the
   first thing in the document, in its own HTML block with no enclosing paragraph, list item, table cell
   or heading, so there is essentially no programmatically determined context for 2.4.4 to draw on and
   the accessible name is carrying the purpose alone. It was **deliberately not changed here**: the alt
   string is byte-identical across the sibling READMEs on purpose, so re-wording it is a decision for
   the wave, not for one repo to take unilaterally.
3. **npm ignoring `<picture>` remains the GOOD outcome, not merely the tolerable one**, and nothing
   here should be "improved" in a direction that depends on npm honouring it. A package page is white
   whatever the reader's system preference says, while `prefers-color-scheme` reports the **reader's
   OS**, not the page's ground. If npm ever honoured the tag, a dark-mode reader would be served the
   on-dark cut on a white page. No gate anywhere can see that.

### Bounds on the measurement

The npm half rests on **archived** package pages plus the `/markdown/raw` reproduction, not on
a live npm page: `npmjs.com` sits behind a challenge this container cannot pass, from `curl` or from a
headless browser. **Both snapshots are over a year old** (`20241217195415` for the shape this README
carries, `20250508123852` for the bare one), so the archived half is the dated half; the
`/markdown/raw` reproduction is what is re-runnable today. The GitHub half is live and was taken twice,
once through the markdown API on this repo's exact block and once off a rendered `github.com` page.
**This package has no npm page today**,
so nothing here is currently observable on npm for `@cosyte/fhir` specifically. Re-measure against a
live package page when the publish block lifts.

## A control that cleared nothing, and the half-narrowed claim beside it (2026-08-07)

`FHIR-XML-WRITE-RESIDUALS`, the two halves the `div` slice filed and did not fix. Both were
`PRE-EXISTING`. Neither changes a runtime read.

### The control was red on a clean tree AND on a changed one, so it cleared neither

The read differential's negative control keyed on `CONTROL.moved`, a hand-written document whose
reading "the slice being measured" was required to move, with a comment instructing the next author
to re-key it. It was re-keyed once (2026-08-05, off `FHIR-ELEMENT-TEXT-RECOVERY`, which had merged)
and it went stale again immediately: the re-key named `MIXED_XML_SPELLING`, which merged in the same
slice that wrote it.

**The consequence is the part worth keeping.** A stale `CONTROL.moved` makes base and head agree on
that document, so the control fires. It fires whether the working tree is changed or not. Verified
both ways on 2026-08-07 at `df99f54`: with a clean tree it printed the same problem the `div` slice
had reported from a modified one. **Red in both states is a constant, not an alarm.** It could not
distinguish a tree it should clear from one it should refuse, so it cleared neither, and every zero
this harness has ever reported stood behind it. Those zeros are inadmissible as evidence, which is
how the `div` slice reported its own and the right call.

It also compared less than the report it was clearing. `whole()` read seven fields; `fold()` compared
the entire `Reading`. Missing from `whole()`: `xml`, `leaves`, `reread` and `thrown` -- so a
difference confined to the XML writer was invisible to the control while being fully visible to the
tally. That is exactly the axis the two preceding slices changed.

**The remedy deletes the hand-keyed document rather than rewording it a third time**, on the ground
that a control whose correctness depends on a human remembering to edit a string literal for the next
slice has one failure mode and has hit it every time it has been looked at. `scripts/differential-control.ts`
replaces it with three arms, and only the third is slice-relative:

1. **The two trees really are two trees**, decided by hashing every file under the materialized base
   `src/` and under the working tree `src/` and comparing the manifests. Over the bytes that were
   imported, not over a ref name, so a materialization that picked up the working tree is caught.
   **It refuses exactly one case, byte-identical, and the first draft of its docblock claimed more
   than that and was refuted:** the comparison is symmetric, so it cannot order the two trees, and a
   base that already carries the change is green the moment anything else differs. The differing-file
   COUNT is what catches that, and it is printed for the reader rather than asserted on.
2. **The comparison can see a change.** Five deliberately perturbed copies of the head codec, one per
   method the XML reading is built from, each of which must be visible to the comparison the report
   scores with. Two gaps are declared rather than closed: `parseResource` feeds the JSON-fixtures
   section, which scores with a different comparison; and every mutant perturbs a **successful**
   emit, so **which refusal a writer raises is not covered** -- `emit()` collapses every
   `FhirSerializeError` to one sentinel and a `Reading` carries no refusal code, so swapping one
   refusal for another moves nothing. Closing that would red the arm on every run for a
   `PRE-EXISTING` blindness this change does not fix, which is the permanent-false-red shape being
   replaced. It is named on the report instead.
3. **A conformant narrative has not moved.** A bar, not a key; a slice that intends to move it is
   expected to red this and say so, not to re-key it.

There is now **one** comparison, `sameReading`, used by both `fold()` and the control, so the control
can never again be narrower than the thing it clears.

**Arm 2 is the one that makes it prove it can fail.** A control that has never been observed red on a
tree it should be red on has not cleared any tree -- the same never-pointed-at-its-input shape this
ecosystem keeps finding. It is exercised from `test/scripts/read-differential.test.ts`, which asserts
both polarities and, separately, reconstructs the deleted `whole()` field for field and asserts that
it goes **red naming `serializeResourceXml`**. The blindness is a failing assertion now, not a
sentence in a changelog.

**Measured at `df99f54`.** Clean tree (`src/` restored to `origin/main`, harness changes kept): 0
differing source files, control RED, exit 1. Working tree: 1 differing source file, control GREEN,
exit 0. Against `658a1f0`, a base before a genuinely writer-only slice: 2 differing source files,
control GREEN. All three ran 1,195 documents and moved 0 readings, which is now printed with an
annotation that names the candidate causes and picks none of them, rather than left as a bare zero.
(That sentence said "the sentence that says which case it is" until the gate withdrew exactly that
claim three paragraphs below; swept post-pass-2 and therefore UNGRADED.)

**What none of this promises is that a reading moved, and the first attempt to say so was itself a
false claim.** The report originally annotated a zero with "no document in this corpus reaches the
changed code", which the gate falsified in one run: change which refusal `assertSerializable` raises,
one line, and 0 readings move while **360 documents execute that line**. The harness cannot tell the
two causes apart, so the annotation now names both and picks neither -- no document reaches the
changed code, **or** the change is of a shape the comparison does not carry, the live example being
refusal identity. **A zero on that line is not evidence that a change is safe.** The lesson is the one
this whole section is about, arriving one level up: replacing a bare zero with a wrong reason closes a
question the bare zero left open. **The standing corpus caveat is unchanged: 7 hand-authored XML
fixtures plus mutations, not the FHIR R4 published-examples corpus.**

### The name arm's wide claim, finished

`FHIR-UNBOUND-PREFIX-ROUNDTRIP` shipped "serializeResource encodes this model correctly" at three
sites. The `div` slice narrowed one, the `SERIALIZE_ERROR_CODES` docblock, and left two, because
leaving a _pair_ contradictory was worse than leaving all three wide. The two are closed here:
`refuseUnserializableNames`' runtime message, which reaches consumer logs, and `breaksTag`'s
docblock.

**The counterexample, measured rather than argued.**
`{"resourceType":"Observation","name":[[{"family":"X"}]],"zz value="1"/><status":1}` reads with
`UNKNOWN_PROPERTY` and `NESTED_ARRAY`, is refused by `serializeResourceXml` with
`UNSERIALIZABLE_ELEMENT_NAME`, and comes back out of `serializeResource` with
`"name":[[{"family":"X"}]]` intact. An array inside an array is the first entry on that writer's own
declared exception list, so "encodes this model correctly" is false about the model it is asserted
over. Both sites now say only what the refusal does not reach, which is the wording the `div` refusal
beside them already carried, and a test falsifies the old sentence rather than describing the fix.

**`breaksTag` does not reach `dist/index.d.ts`** (it is not re-exported from `src/index.ts`), so that
site never shipped to consumers; the runtime message did, through `err.message`.

**Two copies of the same wide sentence are NOT edited here and one of them is a live exposure.**
`CHANGELOG.md`'s `[Unreleased]` copy IS corrected in place, marked as narrowed rather than silently
rewritten, because `CHANGELOG.md` is in `package.json`'s `files` and therefore ships in the tarball.
**`.changeset/gentle-pugs-attack.md` still carries it**, and that is the site that matters: once a
Version PR consumes a changeset its text is frozen into a published `CHANGELOG.md` and the release
body, and neither is retractable under ADR 0001. It was left alone on instruction, not on judgement.
The window is open only while the changeset is pending -- the same cheap moment the 2026-08-06
changeset correction turned on. **Raise it before the next Version PR, not after.**

## The changeset window, closed (2026-08-07, `FHIR-CHANGESET-WINDOW`)

`conformance-refuter` **NOT REFUTED**, 1 pass. Zero executable bytes: two `.md` files.
`scripts/verify.sh` green, all 11 steps audited from its `ran:` list, 56 files / 1,090 tests,
97.86% stmt / 94.67% branch, all unchanged from `e6f97f7` as a claim correction must leave them.

**The site the section above named is closed.** `.changeset/gentle-pugs-attack.md` no longer says
`serializeResource` "escapes a member name and encodes every one of these models correctly". It now
says only that the JSON route stays open, names the limit, and gives the counterexample already
pinned by `test/xml-tag-name.test.ts`. **A second live copy turned up in this file** and is narrowed
in place with the old wording quoted: the `#64` narrative's "Repairing was not available" paragraph
asserted the wide claim as its own design rationale. An archive records what was believed, so the
sentence is annotated rather than deleted.

**▶ WHAT WAS MEASURED BEFORE ANY WORD WAS REWRITTEN.** All 13 names the refusal covers are refused by
`serializeResourceXml` and written by `serializeResource` with the member name intact, so the narrow
half of the sentence is true. Three of that writer's declared exceptions reach it beside a refused
name (an array inside an array, a scalar where FHIR JSON has an object, a non-string `resourceType`),
so the wide half is not. **The two unplaceable shapes this lineage defers do NOT falsify it**, which
is worth writing down because assuming they did would have been another guess: beside a refused name,
`{"resourceType":"Patient","name":[{"given":[["Peter"],"James"]}],"a b":1}` and
`{"resourceType":"Patient","_given":[[1]],"a b":1}` both come back out of `serializeResource`
byte-identical to their input. The 27 documents whose emitted XML re-reads differently are a
`serializeResourceXml` measurement and do not bear on a sentence about the JSON writer.

**▶ 🔴 A `null` AT A PRIMITIVE POSITION IS READ WITH ZERO DIAGNOSTICS AND THEN DELETED BY THE WRITER.
`PRE-EXISTING`, NOT CLOSED HERE, AND IT IS ITS OWN ITEM.** Found while measuring the sentence above,
widened by the gate, and reproduced first-hand at `1577cf3` on `dist/`:

```
in : {"resourceType":"Patient","identifier":[{"system":"http://hospital.example/mrn","value":null}]}
     parse [] , validateResource valid:true issues [] , readSafety safeToSummarize:true
out: {"resourceType":"Patient","identifier":[{"system":"http://hospital.example/mrn"}]}   <- value GONE

in : {"resourceType":"Observation","status":"final","code":{"text":"x"},
      "valueQuantity":{"value":null,"unit":"mg","system":"http://unitsofmeasure.org","code":"mg"}}
     readSafety safeToSummarize:true
out: ..."valueQuantity":{"unit":"mg","system":"...","code":"mg"}    <- MAGNITUDE gone, unit kept

in : {"resourceType":"Observation","status":null,"code":{"text":"x"}}
out: {"resourceType":"Observation","code":{"text":"x"}}             <- status GONE, no diagnostic
```

`src/codec/read.ts` returns `undefined` for a JSON `null` and pushes no issue; the writer then omits
a value-absent primitive. **Non-conformant input is laundered into a clean conformant document with
the member missing, and every layer affirms.** `json.html` §2.6.2.3 sanctions `null` only as
array-alignment padding, and this repo already cites that rule in `src/safety/codes.ts`.
**README's declared exception list does not cover this**: "a scalar or `null` where FHIR JSON has an
object" is the object case, which is preserved and flagged (`nonObjectSource`); the primitive case is
dropped and silent. A dose magnitude and a patient identifier are both in the blast radius, so this
is the safety spine's own subject matter, not a tidiness item.

**▶ THE `div` PARAGRAPH AT THE FOOT OF `gentle-pugs-attack.md` IS LEFT ALONE, DELIBERATELY.** It says
the `div` route is "pre-existing and NOT closed here" and walks through the `no-known-allergy`
forgery. That is accurate about `#64` and stale about the release, because `quiet-moons-repeat.md`
closes it in the same Version PR and "here" has no referent in a release body. Not folded in: the
item was one sentence and time-boxed, and growing a claim correction is how the last one got wide.
**Settle it before the Version PR runs.**
**SETTLED 2026-08-08, still before the Version PR, by DELETION rather than a reword:
[the stale disclosure, deleted](#the-stale-div-disclosure-deleted-2026-08-08-fhir-changeset-div-stale).**

**This section and the residual above were written AFTER the gate returned its verdict, so they are
UNGRADED**, in the same shape `#65` and `#66` recorded their post-verdict edits.

## Relocated out of `CLAUDE.md` on 2026-08-07 to make genuine room for a trap

`FHIR-NULL-PRIMITIVE-LAUNDERED` needed a trap line and `CLAUDE.md` was at **27,979 of its 28,000-byte
budget**, twenty-one bytes, which is why the preceding unit could not record its residual there at
all. The three blocks below moved here **verbatim and in their original order**, exactly as the
2026-08-04 relocation moved everything above them. **Nothing was deleted and no trap was touched**;
`CLAUDE.md` keeps a one-line cursor pointing at each. The budget entry itself lives in the meta-repo
and was **not** raised: `doc-budget.mjs` states the rule in its own comment, lower on shrink, and a
rising entry is a rubber stamp.

### The shipped envelope, P1 through P11

- **Phases 1-9 landed; P10 landed (halves a + b); P11's buildable tiers landed.** The package reads,
  round-trips and structurally validates R4 JSON **and** XML into one schema-free model;
  preserves decimal/`integer64` lexical precision; never drops a modifier, status or negation;
  validates code systems, binding strength, caller-supplied `StructureDefinition`s and
  `constraint[]` invariants; and models Bundles, reference resolution and streaming NDJSON.
  **Not** done: `type`/`profile` slicing discriminators and reslicing (`PROFILE_SLICE_UNCHECKED`),
  a bundled US Core IG corpus, the `validator_cli.jar` differential (authored, **CI-only**, never
  observed green in this container), value-set membership without a supplied terminology service,
  typed per-resource models, and transaction **execution** (a stated non-goal).
  **This is not a no-data-loss claim over the whole package, and the sentence above is base's own
  wording, not a fresh one**: read-path losses remain open and declared, and the one that qualifies
  "never drops a modifier, status or negation" is a **status** or a dose number written as XML
  element text (dropped and reported, the writer refuses, but the safety spine reads `negations: []`).

### Tech Stack (the shared `@cosyte/*` standard)

fhir inherits the canonical toolchain by depending on the published `@cosyte/*` config packages, not
by copying files. Source of truth: the meta-repo's `documentation/conventions.md`.

- **Language:** TypeScript (strict, full rigor set incl. `noUncheckedIndexedAccess`) via
  `@cosyte/tsconfig`. **ES2023**, `NodeNext`.
- **Build:** dual ESM + CJS + `.d.ts` via `tsup` (`@cosyte/tsup-config`); `attw` is a publish gate,
  run through `scripts/attw.mjs` (trap above).
- **Node >= 22, pnpm@10.** **Runtime deps: zero.**
- **Lint/format:** **ESLint 10** + Prettier (`@cosyte/eslint-config`, `@cosyte/prettier-config`),
  at `--max-warnings=0`.
- **Testing:** **Vitest 4** + v8 coverage (`@cosyte/vitest-config`), per-dir >= 90 gates.
- **CI/CD:** thin `cosyte/.github` callers. **License:** MIT.

### The four architecture ADRs (read before writing any parser code)

The text is in `documentation/decisions/`, which is the source of truth; these are the cursors.
**`0001`** decimal / `integer64` are string-backed and MUST preserve lexical precision (the trap is
stated in full above). **`0002`** FHIRPath is a bounded subset vendored in-repo, no runtime
dependency, no third-party engine; needed for invariants + slicing. **`0003`** JSON-first, XML came
later. **`0004`** R4-first: `4.0.1` is modeled (ONC HTI-1 / §170.315(g)(10) anchor), R5 / DSTU2 are
read-tolerance only.

### Deliberate omissions

Verbatim from `CLAUDE.md`'s Engineering Guardrails. Every one of these is still **named** there, as a
trap with a pointer here; what moved is the reasoning behind each.

- **Deliberate omissions, each of which reads as an oversight and is not.** `markNestedArray` and
  `markDroppedText` are reader-internal and **deliberately not exported**. `typeOf` stays the strict
  single-value read, because a structural verdict should **reject** an unreadable type, not guess
  one (only `readSafety` considers every type the document names).
  The element-text refusal fires even when
  text sits beside a value that arrived, and **do not justify that arm with "content the sender
  wrote is still missing"** (the gate broke that sentence in one query with
  `<status value="final">final</status>`); the honest reason is that the rule keys on the reader
  dropping character data and never compares text to value. The two defensive `rootPath` calls in
  the terminology layer and the dose locator are provably the identity where observable, and the
  gate **deliberately does not pretend to cover them**.

`markUndefinedNull` joined the unexported set on 2026-08-07, for the same reason and one more: that
marker decides what the writer emits, so a consumer able to set it could make the writer emit a
`null` no document ever carried. Closure pinned by `test/model-edges.test.ts`.

### `FHIR-NPM-NAME`: the evidence, which was duplicated

The retraction sub-bullet in `CLAUDE.md` carried three evidence clauses that are stated at greater
length in [`#publish-state-fhir-npm-name`](#publish-state-fhir-npm-name) above: provenance is signed
and in rekor **before** the refusal, so it is not a signing failure; scope-level creation works
(`transform`, `synth` and `cli` created 2026-07-29, `deid` 2026-07-30, all after the first refusal);
and the refusal is identical across publish paths and account sessions. The trap keeps its headline
in `CLAUDE.md` and the evidence lives here. **The item itself is unchanged and still blocked on npm:
do not re-derive, re-trace, re-fire or rename anything on the strength of this paragraph.**

## The `null` laundering, closed (2026-08-07)

`FHIR-NULL-PRIMITIVE-LAUNDERED`.

The sharpest defect the drain run surfaced. `#67`'s gate rated it stop-the-line and the coordinator
reproduced it independently against `78f8da9`'s own `dist/`, so it was not taken on report.

**What it was.** `src/codec/read.ts` mapped a JSON `null` to a value-absent primitive and pushed no
issue; `src/codec/write.ts` omits a value-absent primitive. So a non-conformant document was read
with zero diagnostics and written back **clean, conformant, and missing the member**, and every layer
affirmed it (`issues: []`, `valid: true`, `safeToSummarize: true`). **Nothing was lost in the
ordinary sense**, because a `null` carries no content, and that is exactly what made it invisible:
the output could not be told apart from a document whose sender had legitimately omitted the element.

**The measured extent, probed at the base commit, JSON read path only. The list is what was probed,
not a claim that it is every shape.** Laundered
silently: a singleton primitive slot (`"status":null`), a primitive inside a complex
(`identifier[].value`), a quantity magnitude (`{"value":null,"unit":"mg"}` lost the magnitude and
**kept the unit**, the worst shape of it), a dose magnitude three levels down in
`MedicationRequest.dosageInstruction[].doseAndRate[].doseQuantity.value`, an
`AllergyIntolerance.clinicalStatus.coding[].code`, a value inside a primitive's own `extension`, a
`resourceType`, a bare `null` at an object slot (`"identifier":null`), an all-`null` array at an
object slot (`"identifier":[null]`), and an all-value-absent repeating primitive
(`{"given":[null]}` re-emitted as `{}`, losing the member outright). Already reported and already
round-tripping, so untouched: a `null` **beside** an object in an array, and a `null` inside a
`_`-sibling's `extension` array, both `UNKNOWN_PROPERTY` with the text handed back from
`nonObjectSource`. Conformant and untouched: §2.6.2.3 null padding, both channels.

**The asymmetry was the trap.** The README's declared exception list covered the **object** case
(preserved and flagged) and not the **primitive** case (dropped and silent), so the docs read as
though the whole class were handled. Both are now named.

**The answer chosen: a diagnostic and a faithful hand-back, NOT a refusal.** A `null` is a
non-conformant encoding of an _absent_ value, not content the reader could not read, so nothing was
unreadable at the position and the fatal tier and the content-was-unreadable refusals
(`NESTED_ARRAY`, `DROPPED_ELEMENT_TEXT`) are the wrong instrument; refusing would also have withdrawn
round trips that work today, which is the reason several sibling residuals are deferred. The
laundering, which is the actual harm, is closed on the **write**: the `null` goes back where the
sender wrote it, which is the rule `serializeResource` **already applied one branch over** at the
complex position. That makes the writer uniform rather than introducing a philosophy.

**The rule keys on §2.6.2.3, not on "the document wrote `null`", AND IT HAS TWO CONDITIONS. The gate
refuted a first draft that checked only one, and the miss was not academic: it left every headline
shape in the item still laundering.** FHIR JSON forbids `null` outright (§2.6.2.1, "properties never
have null values (except for a special case documented below)") and carves out one exception, and the
exception is about a **repeating** primitive: the value array and the `_`-sibling array are padded so
they align index-by-index. So both of these must hold for a `null` to be the exception.

- **(a) It sat inside a repeating primitive's value array.** The first draft tested only the metadata,
  which exempted a **singleton** `null` beside any `_`-sibling. §2.6.2.3 states the singleton encoding
  positively ("If the primitive has an id attribute or extension, but no value, only the property with
  the `_` is rendered"), so `{"value":null,"_value":{"id":"q1"},"unit":"mg"}` is not the padded form of
  anything, and the draft laundered it into a conformant unit-only `Quantity` with zero diagnostics:
  the item's own named worst shape, surviving its own remedy.
- **(b) The slot carries an `id` or a NON-EMPTY `extension`. This predicate must match `hasMeta` in
  `codec/write.ts` exactly, and the two disagreeing is a laundering bug rather than a cosmetic one.**
  `readMeta` sets `extension: []` for `"extension":[]`, so a draft testing `extension !== undefined`
  exempted the slot on the read while the writer, which requires `length > 0`, emitted neither the
  value nor the `_`-sibling and deleted the member. That reproduced **all three** of the item's shapes
  (`status`, `identifier[].value`, and the quantity magnitude with the unit kept) verbatim past the
  fix. It also made the diagnostic unstable across the package's own round trip: the writer normalizes
  the empty `_`-sibling away, so read 1 affirmed and read 2 flagged the writer's own output, an
  inconsistency the base did not have. An empty array is not metadata in any case (§2.6.2.1: "JSON
  objects and arrays are never empty").

Both conditions are pinned by tests that walk a matrix rather than by these sentences. `{"given":
[null,null],"_given":[{"id":"a"},null]}` reports index 1 and not index 0, so an `id` pads exactly as a
non-empty `extension` does.

**The set the code walks is what the READER read as a primitive, not what FHIR types as one.** The
model is schema-free, so a bare `null` at any **singleton** property reaches the primitive branch
whatever the element's FHIR type would be: `{"subject":null}` on an `Observation` draws the code even
though `Observation.subject` is a `Reference`. Only an array item, and an item of a `_`-sibling's
`extension` array, reach the complex branch. **Never write "in a primitive's value channel" as if it
were a claim about FHIR types**, which is what the first draft's shipped `.d.ts` said.

**And the citation was wrong in the first draft, in eight places including three that ship into
`dist/index.d.ts`.** It said `json.html §2.6.1`. There is no such section: json.html is §2.6.2 with
subsections §2.6.2.1 to §2.6.2.6, and `§2.6.1` is **xml.html**, which this repo's own README already
uses it to mean. The base's existing citations corroborate it (`json.html §2.6.2.3` is already cited
for the `_`-sibling carrier on `MISPLACED_PRIMITIVE_EXTENSION`). A wrong section number inside a trap
is worse than none, because the next reader trusts it.

**No case moved onto the new code**, which is the cross-package rule a sibling repo paid a gate pass
for: a widening that reroutes a case onto a new code silently breaks every consumer predicate written
against the old one, and the package's own docs are such a consumer. The two positions that already
reported still report exactly what they reported, pinned by a test that asserts the whole issue list
rather than a membership check.

**No round trip was withdrawn to buy any of this, which is the constraint several sibling residuals
are deferred under.** The conformant spelling of a value-absent primitive carries no `null` at all, so
it is never marked and is emitted exactly as before. Every shape that changed was one the writer
previously **deleted**; each now round-trips byte-identically.

**Deliberately not done, characterized by tests rather than left implicit.** `validateResource` and
`safeToSummarize` are unchanged. The `_`-sibling that is itself not an object (`"_status":null`)
stayed a separately declared open gap here and was **closed the next unit** (see
[the `_`-sibling channel, closed](#the-_-sibling-channel-closed-2026-08-07)).
`serializeResourceXml` is untouched: XML has no `null`, so no
XML-read document is ever marked, and the value-absent primitive still emits `<status/>`, which is
its own declared deferral. **A `JSON -> XML -> JSON` trip therefore still launders the shape**: the
marker has nothing to write in XML, so re-reading that XML yields `issues: []` again. Identical at
base, disclosed in the README rather than claimed closed, and a backlog line rather than a claim.

**What could not grade this.** The read differential (`pnpm differential:read`) is an XML harness and
XML cannot express a `null`, so it does not reach this change at all. Its `moved` count is separately
blind to refusal identity, which is declared in four places; no zero from it is quoted here as
evidence. **The standing corpus caveat holds:** this lineage's fixtures are 7 hand-authored XML
files plus mutations, not the FHIR R4 published-examples corpus, and the probes above are a
hand-authored JSON axis, which is a third axis again. None of them is corpus-wide.

_Provenance: every measurement above was run against this codebase, the base figures against a clean
`78f8da9` and the head figures against the committed branch; the spec clauses are quoted from
`hl7.org/fhir/R4/json.html` §2.6.2.1 and §2.6.2.3, which the conformance gate fetched rather than
recalled after the first draft cited a section that does not exist._

## The `_`-sibling channel, closed (2026-08-07)

`FHIR-UNDERSCORE-SIBLING-LAUNDERED`. The same laundering class as the entry above, one channel over.
Raised by that slice's own pass 2, which asked for it as an item **now** rather than after the next
gate found it. Base was `42d17c6`.

**What it was.** FHIR JSON gives a primitive's `_`-sibling an `Element` object and nothing else
(json.html §2.6.2.3 puts "the `id` and/or `extension`" there; §2.6.2 gives an element an object). So
`readMeta` reads metadata out of an object and had **none to read** from a string, a number, a
boolean or a `null`, and returned `{}` silently; `write.ts`'s `hasMeta` emits a `_`-sibling only for
metadata the model holds. The member was therefore deleted, and the document came back conformant
with it gone. The shape of the harm is the one that makes this class hard to see: **nothing was lost
in the ordinary sense**, so the output could not be told apart from a document whose sender wrote no
metadata there at all, and every layer affirmed it.

### The measured extent, at `42d17c6`

Hand-authored JSON probes, base vs head, each parsed, re-emitted and **re-read**. All of the
following read `issues: []`, `valid: true`, `safeToSummarize: true` at base and came back with the
sibling deleted; all now draw `UNKNOWN_PROPERTY` at the element's position and round-trip
**byte-identically**, with the re-read reproducing the finding:

- **Singleton `_` slot:** `{"_status":null}`, `{"_status":"x"}`, `{"_status":1}`, `{"_status":true}`,
  and each of those beside a value (`{"status":"final","_status":null}`).
- **Clinically load-bearing depth:** a dose magnitude's own metadata channel three levels down in
  `MedicationRequest.dosageInstruction[].doseAndRate[].doseQuantity` (`"_value":"junk"`), and
  `AllergyIntolerance.clinicalStatus.coding[].code`'s `_code`.
- **The hoisted `resourceType`:** `{"_resourceType":"x"}`.
- **`_`-array slots:** `{"_given":["x"]}` (whole `_given` lost), `{"given":["a"],"_given":["x"]}`,
  `{"given":["a"],"_given":[7]}`, and the sharpest one,
  `{"given":["a","b"],"_given":[{"id":"q"},"junk"]}`, which came back `[{"id":"q"},null]`: **the
  writer authoring a padding `null` the sender never wrote**.
- **Both channels at one slot:** `{"given":[null],"_given":["x"]}` reported the value-channel `null`
  at base and lost the sibling; it now reports both, and both survive the trip.

**Conformant controls, unchanged and silent at base and head:** §2.6.2.3 padding
(`{"given":["a","b"],"_given":[null,{"id":"q"}]}`), a value-absent singleton (`{"_status":{"id":"q1"}}`),
a primitive `extension`, and a precision-critical `valueQuantity`.

### Why `UNKNOWN_PROPERTY` and not a new code, or the value channel's code

**A consumer must need to act differently for a new code to earn its place**, and here it does not.
This is the observation the reader already makes one branch over, where a scalar or `null` arrives at
a **complex** position, which FHIR JSON also gives an object: nothing is modeled, the text is
preserved, the writer hands it back. `UNDEFINED_JSON_NULL` would have been wrong on its face for
`{"_status":"x"}`, which is not a `null` at all, and the `CLAUDE.md` trap already forbids moving the
complex branch onto it.

**The widening is additive and provably so:** these positions drew **nothing** before, so no case
moved from one code to another and no predicate written against either code changes meaning. That is
the `x12#83` refutation shape, avoided the way `#84` avoided it. The package's own docs are such a
consumer and were swept: `issues.ts` (which ships into `dist/index.d.ts` and `.d.cts`), the
`UNKNOWN_PROPERTY` docblock, `read.ts`'s and `write.ts`'s module comments, `README.md` in three
places, and the characterization test in `undefined-json-null.test.ts` that asserted the old gap.

### Three write branches, and the one a read-side remedy never reaches

**A gate refuted this section's own heading when it said two.** Pass 2 of the `_`-sibling slice
found the count corrected in `CHANGELOG.md` and left standing in `write.ts`'s module comment, in
`CLAUDE.md`'s trap line, and here. It reverted `emitMeta`'s one line while leaving `hasMeta` and the
hoist exactly as those three sentences described them, which is the fix an agent following them would
write, and got `{"_birthDate":null}` back as `{"_birthDate":{}}`: an `Element` object no sender wrote,
emitted in flat contradiction of that comment's own "it never authors a value of its own", re-reading clean
because an empty `_`-sibling is the declared-open residual, so the laundering completes on the next
trip. **The third branch is `emitMeta`**, which hands the preserved text back in place of the object.

**`hasMeta` was not enough either.** `emitComplex` hoists a string `resourceType` to the front and then
`continue`d past the property, so `{"_resourceType":"x"}` laundered **past** a fix that only added a
disjunct to `hasMeta`. That branch is the local instance of the rule the previous slice paid a gate
pass for: a remedy that closes the reported symptom is not the same as one that closes the class, and
the only way to know which one you have is to re-run your own reproduction against your own fix, for
every shape you name. Both rounds are in this repo's history as the `measure` probes; the head run is
what the extent table above reports. The same three lines also stop a pre-existing silent drop of a
`_resourceType` carrying real `id` metadata.

**The `hasMeta`/`carriesMetadata` pairing cannot drift from this change.** The laundering direction is
the read exempting a `null` as §2.6.2.3 padding while `hasMeta` declines to emit the `_`-sibling. The
mark added here is a **new disjunct** in `hasMeta` and `carriesMetadata` is untouched, so `hasMeta`
only ever becomes more true and that direction cannot be reopened. Pinned by a test that walks both
halves of the exemption, the `id` one and the **empty-`extension`** one that produced the false fix.

### Declared open, not closed

- An **empty** `_`-sibling object or array (`{"_status":{}}`, `{"_status":{"extension":[]}}`,
  `{"_given":[]}`) is a different spec clause (§2.6.2.1's "JSON objects and arrays are never empty"),
  the sibling **is** an object, and it is still deleted with zero diagnostics.
- A `_`-sibling object's own unreadable **member** (`{"_status":{"foo":1}}`), the minor named on the
  item. **Measured, and it is NOT the same mechanism:** the reader **does** report there, and what is
  lost is that the report does not survive emit. Closing it means putting preserved text in front of
  a channel the model already holds (`{"_status":{"id":"q","foo":1}}` carries a real `id`), which is
  a change to how the writer treats modeled metadata rather than the hand-back this rule performs
  where the model holds nothing. Deliberately left, and pinned by a test so it cannot move in silence.
- `MISPLACED_PRIMITIVE_EXTENSION` (a `_`-sibling beside a non-primitive) is still lost across a round
  trip. Unchanged and out of scope.
- **`JSON -> XML -> JSON` still launders**, because XML has no `_`-sibling channel: a primitive's
  metadata is co-located as an `id` attribute and child `<extension>` elements, so the preserved text
  has nowhere to go and the XML writer drops it. Carried forward from the entry above, its own question.

### What could not grade this

**The XML read differential cannot grade this class at all**: it is an XML harness, and the whole
defect lives in a JSON-only channel. No zero of its is quoted here. **The standing corpus caveat
holds:** the numbers above are a hand-authored JSON axis (probes plus the conformant controls), and
this lineage's XML fixtures are 7 hand-authored files plus mutations. **Neither is the FHIR R4
published-examples corpus**, and nothing here is corpus-wide.

_Provenance: every figure above was produced by running one probe script against a clean `42d17c6`
and then against the head tree, not recalled; the spec clauses are quoted from
`hl7.org/fhir/R4/json.html` §2.6.2, §2.6.2.1 and §2.6.2.3._

## The stale `div` disclosure, deleted (2026-08-08, `FHIR-CHANGESET-DIV-STALE`)

Closes the deferral recorded at the foot of the changeset-window section above, inside the window it
named. Two carriers of a claim, one behaviour-free change, no executable byte moved.

### The disclosure, and why deletion rather than a reword

`gentle-pugs-attack.md` (`#64`, the name refusal) closed with a paragraph disclosing the `div` route
as **"pre-existing and NOT closed here"**, walking through the `no-known-allergy` forgery.
`quiet-moons-repeat.md` (`#65`) closes exactly that route, and **both changesets are unconsumed**:
`changeset status` at `a48e4e2` bumps `@cosyte/fhir` once, at patch, so one Version PR consumes both
and one release body carries both. "Here" has no referent in a release body, and a reader meets the
closure and the "not closed" disclosure in the same document.

**Measured before a word was changed**, against the built `dist/` at `a48e4e2`, with the exact shape
the paragraph describes:

```
D  = {"resourceType":"AllergyIntolerance","text":{"div":
      "<div xmlns=\"...xhtml\">ok</div></text><code><coding>...716186003...</coding></code><text>"}}

parseResource(D)                  -> issues []
serializeResourceXml(D)           -> REFUSED UNSERIALIZABLE_DIV_MARKUP ["AllergyIntolerance.text.div"]
serializeResource(D)              -> writes it, so the JSON route the changeset claims stays open does

X  = the document base's UNCHECKED splice used to emit for D
readSafety(parseResourceXml(X))   -> noKnownAllergy true , negations ["no-known-allergy"]
```

**`readSafety` on `D` itself is `noKnownAllergy: false` with `negations: []`**, and its JSON round
trip is byte-identical. The forgery is a property of `X`, the emitted XML, and of nothing else; an
earlier draft of this block ran the two probes together in a way that read as though the negation
attached to `serializeResource`, and the gate measured it and said so.

So the paragraph is **accurate about base and false about the release**. Negative control: the same
two probes against `@cosyte/hl7` and `@cosyte/ccda` find neither `serializeResourceXml` nor
`UNSERIALIZABLE_DIV_MARKUP`, so the measurement cannot pass against the wrong package.

**DELETED, NOT REWORDED**, which is this repo's settled remedy once a disclosure has been corrected
once already (`#67` corrected this same file's wide-completeness half). **The first draft of this
change substituted a fresh sentence about the unbound prefix and was reverted before it was
committed**: that is the exact shape three rounds of this lineage have been refuted for, a fresh
claim written inside the correction of the previous one, and the second sentence would have asserted
what a conformant third-party parser does without this slice having measured it.

**One sentence is KEPT, verbatim and unedited**: "This governs names, and it is not a guarantee that
the writer emits only elements the sender wrote." It is a **disclaimer of a guarantee**, the
fail-safe direction, so it needs no example to be safe; and its grounding never came from the `div`
paragraph but from the unbound prefix two paragraphs above it, which is still open and still stated
there (`<v:x/>` is written with nothing to bind `v`, re-read here at `Patient.v:x` with
`UNEXPECTED_XML_CONTENT`).

### The second carrier the item did not name

The item named the changeset and `dist/index.d.ts`. The sweep, keyed on the **enumeration**
(`716186003`, `noKnownAllergy`, `no-known-allergy`, `UNSERIALIZABLE_DIV_MARKUP`) rather than on the
phrase "NOT closed here", and run with newlines folded because the phrase wraps, found the identical
paragraph in the **`[Unreleased]` `CHANGELOG.md` mirror of the same `#64` bullet** -- which **ships in
the tarball** (`files` is `dist`, `README.md`, `LICENSE`, `CHANGELOG.md`). It sits about thirty lines
below the `#65` bullet that records the closure, so the two contradicted each other in one file
already on `main`. Deleted the same way. `changelog: false` in `.changeset/config.json`, so that
mirror is hand-maintained and the changeset text does not flow into it; they are two independent
carriers, which is why correcting one would have left the other shipping.

Every other enumeration hit was checked and is **not** a carrier: `README.md`'s and `CHANGELOG.md`'s
other "not closed here" lines are about `_`-siblings, and every other pending changeset
(`quiet-moons-repeat`, `olive-donkeys-shine`, `brave-otters-listen`, `tidy-hounds-gather`,
`eager-pandas-report`) was read in full and carries no `div` disclosure.

### The `@throws` referent, which shipped in the declarations

`serializeResourceXml`'s `@throws` for `UNSERIALIZABLE_ELEMENT_NAME` ended: "(which is not the same
as saying the JSON output is spec-clean: **this function's own** exception list still applies to the
rest of the model)". The clause is inside `serializeResourceXml`'s own doc comment, so "this
function" resolves to the XML writer, and **the XML writer's exception list does not govern the JSON
output**, which is what the clause qualifies. The list that does is `serializeResource`'s, named one
clause earlier. Now names `serializeResource`. Elsewhere in the module the claim already scoped
itself to the JSON writer without the ambiguity -- the
`SERIALIZE_ERROR_CODES.UNSERIALIZABLE_ELEMENT_NAME` docblock and `refuseUnserializableNames` both
name `serializeResource`, and `test/xml-tag-name.test.ts`'s suite docblock says "which **that
writer's** own exception list governs", which is unambiguous by position rather than by naming it.
Each was opened and read rather than cited. **No count of sites is given**: the draft that gave one
said "the four sites" in `CHANGELOG.md` and named a different pair in the changeset, and the gate
caught the disagreement.

**WHERE IT SHIPS WAS ANSWERED WRONG TWICE AND IS NOW NOT ANSWERED AT ALL. THIS IS THE ENTRY TO READ
BEFORE WRITING ANY SENTENCE ABOUT WHAT REACHES A CONSUMER.**

- **Draft one** said the sentence renders into `dist/index.d.ts` and `dist/index.d.cts` "and nowhere
  else", reasoned from the JS bundles being byte-identical. **Pass 1 refuted it**: `dist/*.map` carry
  source text in `sourcesContent` and both ship (`npm pack --dry-run` lists ten files). `sourcemap:
true` is the shared `@cosyte/tsup-config` default, so it is systematic rather than a local flag.
- **Draft two extended the sentence to name the two sourcemaps "which carry every source byte in
  `sourcesContent`". Pass 2 refuted THAT**: the maps do not carry every source file.
- **Draft three deleted the sentence from both frozen carriers, and then said in THIS note which
  files "reach no tarball artifact at all". Pass 3 refuted the replacement**, and its own probe was
  the fault: the DTS rollup strips the `export` keyword, so grepping for `export interface X {`
  returned a false negative for a module whose text does render into both declaration files. **A
  type-only module is exactly the class whose text lands ONLY in the declarations**, which is the
  opposite of what the sentence concluded.
- **Draft four states no reach and no count at all**, which is where this should have stopped after
  pass 1. **THE ITEM ASKED FOR THE REFERENT, NOT FOR WHERE THE SENTENCE SHIPS.** Cutting a claim is
  the remedy; a narrower replacement is still a new claim, and this slice produced three of them in a
  row before that took.

**▶ SO: DO NOT WRITE A SENTENCE HERE ABOUT WHICH `src/` FILES REACH WHICH BUILT ARTIFACT.** Four
drafts tried, three were measurably false, and the surviving true statement is the one that describes
no set: the corrected `@throws` renders into the shipped type declarations, where an editor shows it.
If a future slice genuinely needs the mapping, it is a measurement to run then, per file, against a
fresh build -- not a fact to carry in prose.

**▶ `scripts/check-no-internal-refs.sh:191-197` IS WHERE THE BAD INFERENCE WAS IMPORTED FROM, AND ITS
OWN VERSION IS ALSO FALSE.** It states in capitals that `dist/*.map` "carries every tracked source
byte in `sourcesContent`. SO EVERYTHING IN `src/` IS IN THE TARBALL." The warning it draws from that
(do not reason about the doc-comment boundary from what reaches `dist/`) is sound and should be kept;
its stated ground is wider than what a build produces. `PRE-EXISTING` at `a48e4e2`, **not corrected
here** because it errs conservative -- it claims more ships than does, so the gate is not made unsafe,
and the gate's behaviour does not read it (`check:no-internal-refs` scans all 60 source files either
way) -- and because correcting a gate's rationale is its own slice. **Whoever takes it should note
that the OPPOSITE error is the unsafe one**: a sentence claiming less ships than does would license
writing internal bookkeeping into a file that renders straight into the declarations. That is the
error draft three made, one surface over.
**▶ TAKEN AND CLOSED 2026-08-08**, cut rather than reworded, and the remaining carrier in `CLAUDE.md`
was cut with it: [tarball reach, derived from a real `npm pack`](#tarball-reach-derived-from-a-real-npm-pack).

**No claim is made here that `serializeResourceXml` has no declared gaps of its own** -- it does, in
its "What this output is NOT guaranteed to be" section. A draft of this note said the JSON writer was
"the only one of the two that has a declared exception list"; that is false, it would have made the
original sentence defensible rather than wrong, and it was cut. The defect is the referent, not the
existence of the list.

### Declared, not folded in

`emitsOneDivElement`'s docblock calls an unbound prefix "the separately declared residual on **this
function's own output**", and that function returns a boolean, not a document. Same shape as the
defect above. **`PRE-EXISTING`.** The function is file-internal, is not exported, and renders into
neither declaration file, so no consumer is _shown_ it at a call site. **A draft said "so it reaches
no consumer"; that is a different and wider claim, it was not measured, and it was cut** -- the
phrase is in both sourcemaps. Left rather than widen a time-boxed claim correction, in the same shape
`#70` left `scripts/read-differential.ts:440`.

The `#64` narrative above cites `test/xml-tag-name.test.ts` ("declared gap, NOT closed here") for the
`{"div":"v"}` shape. `#65` renamed that block to "declared gap, still written: a name this library
round-trips and XML does not admit" and made both `div` shapes refusals, so the citation names a
block that no longer exists. **Archive text, recording what was believed at `#64`**, internal only
(`documentation/` is not in `files`), and left for the reason `#67` gave for leaving its own.

**Gate: `conformance-refuter` REFUTED, REFUTED, REFUTED -- the full ADR 0016 allowance of three
passes, spent, and NOT converged.** Every refutation was claim-width in this note and in the two
frozen carriers; **no pass broke the code, and `src/` is one comment line**. Passes 1 and 2 were
remedied and re-graded. **Pass 3's finding was remedied by DELETION, as pass 3 itself prescribed, and
that final edit is therefore UNGRADED** -- the same shape `#65`, `#66` and `#67` recorded their
post-verdict edits in. It removes prose and adds no claim, which is the only kind of post-verdict
edit that is safe to make with the cap spent.

_Provenance: every figure that remains above was produced by running probe scripts against the built
`dist/` at `a48e4e2` and against the head tree, plus a fold-newline sweep over every tracked file and
over the built artifacts, not recalled. **No artifact count and no set of files is given here on
purpose: three drafts gave one and all three were wrong.**_

## Tarball reach, derived from a real `npm pack`

`FHIR-TARBALL-REACH-CLAIM`, 2026-08-08. `scripts/check-no-internal-refs.sh` asserted, in capitals,
_"SO EVERYTHING IN `src/` IS IN THE TARBALL"_, and `CLAUDE.md` carried the same universal as
_"everything in `src/` does"_. **Both are cut. Neither is reworded, and no replacement set is named.**
Nothing here changes gate behaviour: `check:no-internal-refs` reads the sentence nowhere.

### 🛑 The direction, which is counter-intuitive and is the reason the slice exists

A wrong **"this ships"** costs a needless sweep. A wrong **"this does not ship"** licenses writing
internal bookkeeping into a file that renders straight into the declarations, and a published version
is permanent. So the over-wide claim that was here was the **safe** error, and any correction of it
is written in the **unsafe** direction. That is why the remedy is deletion plus a method, and why the
only positive statement kept is a single failing example.

### The method, and it is the command rather than the inference

```
pnpm build && npm pack --pack-destination <scratch> && tar -xzf <scratch>/cosyte-fhir-*.tgz -C <scratch>/x
```

Then search **every byte-carrier the tarball actually has**: each packed file raw, **plus every
decoded `sourcesContent` entry of every `.map`**. Normalise needle and haystack **identically**: fold
newlines first, then strip a leading `*`, `*/` or `//` comment marker from each line. That
normalisation is deliberately generous, so it can only produce **more** matches, which is the safe
direction for a question phrased as "does this reach anything".

**Both halves of that normalisation are load-bearing, and the second was learned the hard way in this
very slice.** A first probe folded whitespace only. Asked whether `emitsOneDivElement`'s docblock
reaches the tarball it answered **no**, because the clause wraps across `*`-prefixed comment lines
and the packed bytes keep the markers. Marker-stripped, the same clause is found in both sourcemaps.
**That is the identical class of mis-specified probe that `#71`'s pass 3 was refuted for**, reproduced
here against a different transformation, which is the argument for never trusting a reach answer that
was not run in both polarities.

### Controls, run in both polarities

- **Positive, declaration carrier.** `src/xml/write.ts`'s module docblock is found in `index.d.ts`
  and `index.d.cts`, so the probe reads the declarations.
- **Positive, sourcemap carrier.** A `//` comment in `src/codec/read.ts` is found in both sourcemaps'
  decoded `sourcesContent`, so the probe reads the maps and not only the plain files.
- **Negative, synthetic.** A string present in no source is found nowhere.
- **Negative, wrong package.** The identical probe, run with this repo's `src/` against the published
  `@cosyte/hl7` tarball, reports **every** probed file as reaching nothing. So a "no hit" verdict is
  produced by the tarball under test rather than by the working tree.

### The failing example, and the trap that sets the direction

- **Failing example.** The module docblock of `src/codec/index.ts` is in **no file of the packed
  tarball**, neither raw nor in a decoded `sourcesContent`. It is a barrel of pure re-exports: the
  bundler elides it, so it contributes no mapped source, and it declares nothing of its own, so the
  DTS rollup emits none of its text. **One example is asserted and no set is named**, because the set
  is a property of a build and this file is exactly where such a set has gone stale before.
- **The trap.** `src/terminology/service.ts` is in **neither** sourcemap and its docblock is in
  **both** `.d.ts` files. A type-only module compiles to no JavaScript, so nothing maps it, while its
  interfaces are precisely what the declarations carry. Anyone deriving reach from the bundles or the
  maps alone will call it unreachable and be wrong in the unsafe direction. This is the same module
  class that refuted `#71`.

### The carrier the phrase-keyed sweep would have missed

`#71` cut the parenthesis from this file and left the identical universal in `CLAUDE.md`, one
sentence over from the warning it was grounding. A sweep **keyed on the enumeration** (tarball,
`sourcesContent`, sourcemap, `.npmignore`, `files[0]`, `npm pack`, "everything in `src/`", "reaches
`dist/`") **with newlines folded first** found it; a sweep keyed on the gate script's wording would
not have. Same lesson as `#70`, found again here rather than cited.

### Considered and deliberately left

- **`emitsOneDivElement`'s docblock referent**, which the item lists beside this one. **Not folded
  in, and the ground is measured rather than assumed.** Its reach is _not_ what the item supposed:
  the docblock is in neither declaration file, but it **is** in the tarball, in both sourcemaps'
  decoded `sourcesContent`. So the two defects do not even share a surface. More decisively, naming
  the right referent means settling which artifact the unbound-prefix residual lands on, which is
  `FHIR-XML-WRITE-RESIDUALS` material and needs `test/xml.test.ts` opened rather than cited. A
  referent correction that has to import another item's verification is a second unit, not this one.
- **The `dist/` bullet's "the dts build copies doc text verbatim"**, immediately below the cut. Left:
  where the DTS rollup carries a docblock at all it carries the text verbatim, which the positive
  control above exercises, and where it carries none the third pass scans **more** than reaches
  `dist/`. That is over-inclusive, which the bullet already declares as the gate's ceiling, and it is
  the safe direction. Widening the slice to reword it would be writing a fresh reach claim inside the
  correction of a reach claim, which is the failure this lineage keeps paying for.

### 🛑 Two gate passes refuted this slice for doing the very thing it was correcting

**Every finding across both passes was `INTRODUCED` by this slice rather than `PRE-EXISTING`.**
Recorded here because the lesson is that writing the rule down is not the same as obeying it, and
this note is where the next reader looks for that.

**Pass 1**, two findings:

- **A fresh universal, written inside the correction of the old universal, in the same paragraph that
  said it named no set.** Draft one added, after the failing example: _"Every `src/**/index.ts` barrel
  here answers the same way, and each answers all-or-nothing across its whole docblock."_ Pass 1
  falsified it under both available readings, with `src/fhirpath/index.ts` on the glob reading and
  `src/quantity/index.ts` on the charitable pure-barrel reading. **Deleted, not narrowed.** Narrowing
  is what produced it.
- **A `files` claim about the slice itself, in three carriers, one of which ships.** Draft one said
  _"nothing this touches is listed in `files`, so none of it reaches an installed copy"_ in the
  changeset (which freezes into a release body), in `CHANGELOG.md`, and here. `CHANGELOG.md` **is** in
  `files`, and pass 1 unpacked a real tarball and found the sentence inside it. Base's own prose has
  this right in both places, so it was a regression, not `PRE-EXISTING`. **The whole clause is
  deleted rather than qualified**, which leaves the slice claiming no reach for itself at all.

**▶ AND THE PROBE HAD A BLIND SPOT THIS NOTE OWES THE NEXT READER.** The method above matches at
**line granularity**, so prose that ships with a `{@link …}` tail rewritten or dropped is invisible to
it. Pass 1's own probe is the one to reuse: drop all non-alphanumerics, then slide a fixed-width
normalised window across the whole docblock. It is strictly more generous, and it is what surfaced
the partial hits the line-granular probe could not see.

**▶ PASS 2 THEN REFUTED THE CONTROL SECTION ITSELF.**
It called `src/xml/write.ts`'s docblock a **transformed** carrier, "text the DTS rollup has rewrapped
and re-emitted". It is not. That docblock is byte-identical in `dist/index.d.ts` and
`dist/index.d.cts`, indentation included, which anyone can check with a substring test in two lines.
So a section headed as controls in both polarities carried no transformed positive at all, inside a
slice whose entire subject is false statements about what a build produces. **The transformation
framing is deleted** and each positive control is now named for the artifact it reads. Two smaller
deletions went with it: a closing line setting a probe standard the wrong-package control had not
been run to, and a count of how many times this lineage has paid for the same failure.

## The `JSON -> XML -> JSON` laundering, closed (2026-08-08, `FHIR-JSON-ONLY-SHAPE-LAUNDERED`)

The last leg of the laundering lineage, and the one the two entries above each declared open at their
own foot. Base was `5ced746`.

**What it was.** The JSON reader marks four positions FHIR JSON gives no meaning to and keeps what
the sender wrote at them, so `serializeResource` hands the text back and a re-read reproduces the
finding: an array inside an array (`nestedArray` + `nestedArraySource`), a scalar or `null` where
FHIR JSON has an object (`nonObjectSource`), that same shape in a primitive's `_`-sibling
(`nonObjectMetaSource`, `nestedArrayMetaSource`), and a `null` in a primitive's value channel that
padded nothing (`undefinedNull`). **XML has none of those channels** -- no array of arrays, no
`_`-sibling (a primitive's metadata is co-located as an `id` attribute and child `<extension>`
elements), and no `null` at all. So `serializeResourceXml` emitted the node the reader was left
holding, an empty element or none, and that output re-reads with an **empty issue list**. Three of
the four also re-read `valid: true`; the array-inside-an-array one emits `<name/>`, which re-reads
`issues: []` and `valid: false`. **Not because it is empty, and not because it repeats**, which is
what a first draft of this sentence said and the gate measured false: `<coding/>` is equally empty
and equally repeating and re-reads `valid: true`, while a `0..1` `<maritalStatus/>` re-reads
`valid: false`. What decides it is the modeled datatype: the element re-reads as a value-absent
primitive where the schema types a complex one, and the validator draws `TYPE_MISMATCH`. The finding
is gone in all four, which is the property that matters here.

The shape of the harm is this lineage's own: **nothing is lost in the ordinary sense**, so the output
cannot be told apart from a document whose sender wrote the conformant thing, and every layer
affirms it.

### The measured extent, at `5ced746`

Hand-authored JSON probes, base vs head, each parsed, written to XML and **re-read**. The middle
column is the document base put on the wire; the right column is what re-reading that document gave.

| in                                                                                            | base emitted                 | re-read                                                             |
| --------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------- |
| `{"valueQuantity":{"value":null,"unit":"mg"}}` (`UNDEFINED_JSON_NULL`)                        | `<value/><unit value="mg"/>` | `issues: []`, back to `{"unit":"mg"}`: a unit with **no magnitude** |
| `{"status":"final","_status":null}` (`UNKNOWN_PROPERTY`)                                      | `<status value="final"/>`    | `issues: []`, the member gone                                       |
| `{"_status":"x"}` (`UNKNOWN_PROPERTY`)                                                        | `<status/>`                  | `issues: []`, the member gone                                       |
| `{"coding":[{"code":"active"},"junk"]}` (`UNKNOWN_PROPERTY`)                                  | `<coding/>` for item 1       | `issues: []`, the item back as `null`                               |
| `{"name":[[{"family":"Roe"}]]}` (`UNKNOWN_PROPERTY`+`NESTED_ARRAY`, `safeToSummarize: false`) | `<name/>`                    | `issues: []`, **`safeToSummarize: true`**                           |
| `{"name":[{"given":[["a"]]}]}` (same pair)                                                    | `<given/>`                   | `issues: []`, `safeToSummarize: true`                               |
| `doseQuantity` three levels down with `"_value":"junk"`                                       | the dose element, clean      | `issues: []`                                                        |

The first row is the harm the value-channel rule exists for, arriving through the other door. The
`name` rows are the sharper ones: a **refusal to summarize turned into an affirmation**.

**Conformant controls, unchanged and silent at base and head:** §2.6.2.3 padding
(`{"given":["a","b"],"_given":[null,{"id":"q"}]}`), a value-absent singleton
(`{"_issued":{"id":"q1"}}`), a primitive `extension`, a precision-critical `valueQuantity`, and every
XML fixture, which still round-trips byte-for-byte.

### Why a refusal, when the two entries above chose a report and a hand-back

Because there is nothing to hand back **into**. Those two closed a channel that exists in the format
being written; here the format has no channel at all, and the three options are exhaustive: emit the
empty element (which is the laundering), invent an XML spelling (which authors markup nobody wrote,
the fabrication class `UNSERIALIZABLE_ELEMENT_NAME` and `UNSERIALIZABLE_DIV_MARKUP` already exist
for), or refuse. It is the same instrument `DROPPED_ELEMENT_TEXT` already is, one format over: that
marker has no encoding in **either** wire format and both writers refuse it; these have one in JSON
and none in XML, so only the XML writer does.

**No round trip that works is withdrawn, and this is mechanical rather than argued.** Every marker is
set by the JSON reader alone. A census over `src/` asserts it (`markUndefinedNull`,
`markNonObjectMeta` and `markNestedArray` are referenced only by `codec/read.ts` and `model/node.ts`;
`nonObjectSource` is assigned only in `codec/read.ts`), which is a stronger statement than the
7-fixture sweep beside it because it does not depend on the corpus. So no document read from XML can
reach the refusal, and no conformant JSON document carries a marker either.
**What that census is, exactly, because pass 1 read it wider than it is:** it is a grep over `src/`
for the marking helpers by name and for a `nonObjectSource:` assignment. A helper renamed, or the
field set by object shorthand, would evade the patterns. It reds when a new file starts setting one
**the way the reader does today**; it is not a proof about every spelling.

### A whole-model pre-pass, deliberately, where the two refusals beside it check at their site

`tag()` and `emitsOneDivElement` are checked **at** the site that writes, because their answer depends
on the writer's branching: which name becomes a tag, which becomes an attribute, which is dropped. A
pre-pass would have to re-derive that and would be free to disagree. **This question does not depend
on the branching at all** -- no branch of the XML writer can express any of these shapes, wherever
the node sits -- so the pre-pass cannot drift, and it reaches three positions a site-local check
would each have to be repeated at: the `div` branch, which returns before the primitive is written;
the `id`/`url`/`resourceType` properties, which are consumed as attributes or skipped and never reach
`writeItem`; and a member a repeated property name shadowed, which the writer's own walk never
visits. The walk is `collectMarked`'s, shared with `droppedText` and `nestedArrays` rather than
copied, so a refusal cannot come to visit a different part of a document than a report of the same
kind does.

**Raised last**, after the name and `div` refusals. A model can trip two, and base's answer must not
move: `{"zz value=\"1\"/><status":1,"issued":null}` keeps `UNSERIALIZABLE_ELEMENT_NAME`, a bad `div`
beside a marker keeps `UNSERIALIZABLE_DIV_MARKUP`, and dropped character data keeps
`DROPPED_ELEMENT_TEXT`. All three orderings are pinned by tests. **No case moved onto the new code**,
because these positions raised no serialize error at all before.

### Declared open, not closed, and pinned so none of it reads as covered

- **An array-wrapped `0..1` element still launders across this boundary.** No node is marked: the
  model holds a genuine list of one, and XML spells a repeating element by repeating it, so one
  occurrence is exactly what comes back. Closing it needs a cardinality decision on the **write**
  path, which is a different change; `array-wrapped-scalar.test.ts` owns it and still pins it.
- **A repeated property name is dropped by BOTH writers**, so there is no hand-back for XML to be
  missing. `DUPLICATE_PROPERTY` and the safety refusal carry it instead. Not this class.
- **A JSON decimal comes back from XML as a string**, because XML carries no JSON type. The lexical
  value survives byte-exact and no magnitude changes, but the `DECIMAL_PRECISION_AT_RISK`
  information-severity finding is not reproduced on the re-read. Pre-existing, and named here only so
  the closure above is not read as covering it.
- **A non-string `resourceType` still launders the same way, and it is the closest residual to this
  closure, so it is named here rather than left to the item.** (True at this slice. **CLOSED
  2026-08-09**, `UNSERIALIZABLE_RESOURCE_TYPE`. The example below is stale in one respect from `#75`
  onward: the array spelling has raised `UNSERIALIZABLE_ARRAY_WRAPPER` since `914c03a`, and it is a
  scalar or object type gate that reached the substitution after that.)
  `{"resourceType":["Observation"],"status":"final"}` reads `valid: false` / `safeToSummarize: false`,
  emits `<Resource xmlns="http://hl7.org/fhir"><status value="final"/></Resource>`, and that document
  re-reads `issues: []` / `valid: true` / `safeToSummarize: true`. Identical harm shape to the `name`
  row above. It is **not** a marked node: the writer substitutes the tag rather than the reader
  marking the position, so closing it is a decision about what the writer does with an unreadable
  `resourceType`, not about a channel XML lacks. `PRE-EXISTING`, reproduces on `5ced746`, and declared
  deferred in the backlog item. Raised by the conformance gate's pass 1.
- The residuals the two entries above declared in their own channel are untouched: an **empty**
  `_`-sibling object or array, a `_`-sibling object's own unreadable member, and
  `MISPLACED_PRIMITIVE_EXTENSION` beside a non-primitive.

### What could not grade this

**The read differential cannot grade this class at all.** It is an XML harness, and every marker here
is set by the JSON reader; its 0-of-1,195 moved readings is by construction, not evidence, and the
harness prints that caveat itself. Its `moved` count is separately blind to refusal identity, which
is declared in four places. No zero of its is quoted as evidence here. **The standing corpus caveat
holds:** the figures above are a hand-authored JSON probe axis plus this repo's JSON fixtures, and
this lineage's XML fixtures are 7 hand-authored files plus mutations. **Neither is the FHIR R4
published-examples corpus**, and nothing here is corpus-wide.

### What the gate moved, and the two claims it refuted

Pass 1 found **no defect in the code** and two `INTRODUCED` majors, both claim width, which is the
shape this lineage keeps paying for.

1. **"`serializeResource` writes all four back BYTE-IDENTICALLY" is false for three of the four
   families**, and it was the sentence justifying the withdrawal, shipped in `README.md`,
   `CHANGELOG.md`, the changeset and the guard's own docblock. The preserved text is **value-exact,
   not byte-exact**, which `FhirComplex.nonObjectSource` already states on the field:
   `{"performer":[{"reference":"Practitioner/1"},"Practitioner\/2"]}` comes back spelling the second
   member `"Practitioner/2"`. Only `undefinedNull` is byte-identical, because a `null` has no
   escaping to lose. **The test beside the claim did not ground it**: its four rows carry no JSON
   escape, so it was green while the sentence was false. The claim is corrected everywhere and a
   failing example is now pinned beside the four rows.
2. **The runtime message promised a route that does not carry one case the refusal deliberately
   reaches.** It ended "serializeResource writes it back, so this refusal never reaches it", and for
   a marker inside a member a repeated property name shadowed that writer **drops** it. The message
   now says only what the refusal does not reach, which is the wording the two refusals beside it
   were narrowed to on 2026-08-07. The location caveat is stated with it: FHIRPath cannot address a
   shadowed member, so the location resolves to the surviving one.

Two minors moved with them: each disjunct of the predicate is now pinned by a hand-built node (the
suite was green with any single clause deleted, because the reader always sets `nestedArray` beside
`nestedArraySource`), and the census claim is scoped to what it greps.

_Provenance: every figure above was produced by running one probe script against a clean `5ced746`
and then against the head tree, not recalled; the spec clauses are `hl7.org/fhir/R4/json.html`
§2.6.2, §2.6.2.1 and §2.6.2.3 for the JSON channels and `xml.html` §2.6.1 for the XML one. The two
corrections above are the conformance gate's pass 1 against `a608731`._

## The array wrapper laundering, closed (2026-08-08)

The residual `#74` ranked first among what it left, and the one that needed a **product call** rather
than a parser fix: closing it meant deciding what a writer does about cardinality.

### The defect, measured against `8a91d29`

FHIR JSON writes a single-valued element as a name/value pair and reserves the array for a repeating
one (json.html §2.6.2.2), so `{"status":["entered-in-error"]}` is a shape the spec does not define.
The safety layer already reported it (`ARRAY_WRAPPED_SCALAR`, error severity) and declined to affirm
`safeToSummarize` over it, because a single-value read finds no string in it at all.

FHIR XML spells a repeat by **repeating the element** (xml.html) and carries no other mark for one.
So a wrapper of fewer than two items emitted at most one element and the complaint had nowhere to go:

| in                                                                | reported             | XML out                              | re-read                                      |
| ----------------------------------------------------------------- | -------------------- | ------------------------------------ | -------------------------------------------- |
| `{"resourceType":"Observation","status":["entered-in-error"]}`    | `Observation.status` | `<status value="entered-in-error"/>` | `[]`, `valid: true`, `safeToSummarize: true` |
| `{"resourceType":"Observation","status":[]}`                      | `Observation.status` | element absent                       | `[]`, `valid: true`                          |
| `{"resourceType":["MedicationStatement"],"status":["not-taken"]}` | both                 | `<Resource>`                         | no negation readable at all                  |

The second row is the one worth keeping in view: an **empty** wrapper leaves nothing behind at all.
The third is the sharper half, because a wrapped type gate suppresses every type-scoped negation
behind it, and array-wrapping every element is ordinary generic converter output.

### The cardinality decision, and the alternatives weighed

**A writer cannot decide cardinality in general, and this one does not try.** There is no
per-resource model here and there must not be one (`SAFETY_SCALAR_ELEMENTS` is the cardinality of a
closed set, not a model); a name-only, depth-free rule emits a false error on a conformant document,
because `Questionnaire.code` and `ElementDefinition.code` are `0..*` in R4.

Four routes were on the table:

1. **Refuse every list at a reported location, arity-blind.** Rejected on measurement, not taste: an
   XML document CAN put a list at a reported location by repeating the element, and
   `<status value="a"/><status value="b"/>` round-trips **byte-exact today with the finding read on
   both sides**. Refusing it withdraws a working round trip and buys nothing, which is exactly the
   cost the unbound-prefix residual was deferred rather than pay.
2. **Refuse only what XML cannot spell back as a wrapper.** Taken. Fewer than two items, plus **any**
   wrapper on `resourceType`, where the type is the tag and a tag cannot be repeated. The
   `resourceType` clause is a fact about XML, not about this writer's branching, and it is measured
   at arities 0, 1, 2 and 3.
3. **Report instead of refuse.** Not available: the XML writer returns a string and has no
   diagnostics channel, the same fork `assertXmlSerializable` reached.
4. **Invent an XML spelling for a wrapper.** Rejected: it authors markup the sender never wrote,
   which is the fabrication class two refusals beside it already exist for.

**Where the cardinality comes from is the load-bearing half.** The write path takes it from the one
window that already has one, the locations `arrayWrappedScalars` reports, by narrowing the safety
layer's **own walk** (`unspellableXmlWrappers`) rather than adding a second traversal with its own
element table. A copy would be free to drift from the window this library reports to a caller, and
the read window and the report window must be the same window. It narrows and never widens, so it
can never name a location `arrayWrappedScalars` does not.

`SERIALIZE_ERROR_CODES.UNSERIALIZABLE_ARRAY_WRAPPER`, **raised last** so no case moves onto it.

### Two things the predicate answers that a location-level one would get wrong

- **Per written MEMBER, not per location.** A `Coding` whose `system` is a singleton and whose `code`
  holds two keeps the location reported after the trip, while the `system` wrapper is gone. The
  member that vanishes is the question, so the quantifier is `some`.
- **The two sets de-duplicate independently.** A repeated property name puts two wrappers at one
  location; sharing the de-duplication would hide `{"status":["b","c"],"status":["a"]}`'s singleton
  behind the writable wrapper that arrived first. Pinned in both orders.

### What it does NOT cover, measured rather than implied

- **A writable wrapper only a SHADOWED member carried still launders.**
  `{"status":"final","status":["a","b"]}` reports `Observation.status` and comes back reporting
  nothing. It is not this class: the wrapper is writable, what drops it is the repeated property
  name, and `serializeResource` drops it **identically** (`{"resourceType":"Observation",
"status":"final"}`, `safeToSummarize` `false -> true` on that route too). The repeated name is its
  own declared-open residual.
- **`Observation.value[x]`**, a `0..1` choice, is outside the window and its wrapper still launders.
  Widening means the per-resource model this library does not have.

### The axis of every "0" and every count reported here

- **"0 readings moved of 1,195"** is the XML read differential, over 7 hand-authored XML fixtures
  plus mutations. It **cannot grade this class**: the refusal fires on wrappers of fewer than two
  items, and a single XML element reads as a primitive, not a list. That zero is by construction. The
  harness prints the caveat itself, and `leaf values not compared (head refused to serialize)` is
  `0`, so no document base serialized is refused at head.
- **"732 two- and three-item wrappers, 0 laundered"** and **"60 arity-0/1 wrappers, 60 laundered"**
  are a generated grammar, and the arithmetic is stated in full because the first draft of this line
  did not reconcile: 6 `(resource type, element)` root pairs x 10 item shapes in **each of two array
  positions** x arities 2 and 3 gave 1,200 candidates, of which 732 produced a reported wrapper the
  writer still emits; the same roots x 11 shapes at arities 0 and 1 gave 66 candidates, of which 60
  were emitted, and all 60 laundered. **6 root pairs is not the whole window**, which is scoped to
  `SAFETY_RESOURCE_TYPES` at a resource root. Not a corpus.
- **The 14 `_`-sibling shapes measured 14/14 byte-exact** below is this repo's own probe list.

**None is the FHIR R4 published-examples corpus. Nothing here is corpus-wide.**

### Mutation coverage, both polarities

Ten mutations run against the three suites that own this: dropping the `resourceType` disjunct (2
red), dropping the arity clause (18), widening arity to `< 3` (9), narrowing to `< 1` (13), sharing
the de-duplication set (22), `some -> every` on the `Coding` quantifier (1), raising the refusal
first instead of last (2), removing it entirely (22), the `isList` guard returning `true` (1), and
the predicate made dead (23). Every clause is load-bearing.

### The falsified "byte-identically" claim beside it, graded per carrier

`#74` recorded the `_`-sibling changeset's "byte-identically" as falsified and owed a deletion.
**Re-measured before editing, and it is half right, which is why it was measured:**

- `.changeset/tidy-hounds-gather.md` said "so **the shape** round-trips byte-identically", a
  universal over the shape class, and it is **false**: `{"_status":"Practitioner\/2"}` returns
  `{"_status":"Practitioner/2"}`, `{"_status":"aAb"}` returns `{"_status":"aAb"}`, and even
  insignificant whitespace before the value is lost. The preserved text is re-rendered, not sliced.
  **Deleted, never reworded** (a changeset freezes permanently).
- `CHANGELOG.md` said "so **every shape above** round-trips byte-identically", scoped to its own
  enumeration, and **all 14 enumerated shapes measure byte-exact**. It was true as scoped. It was
  deleted anyway, for a different and stated reason: the same release body carries `#74`'s correction
  ("value-exact, not byte-exact ... only the value-channel `null` family is byte-identical") ninety
  lines above it, and the `_`-sibling channel is one of the families that correction names. Two
  statements that contradict each other in one release body is what a reader acts on.
- `documentation/agent-notes.md`'s two uses are enumerations too, and both measure true. **Left
  alone**: deleting a true claim is its own defect.

`src/xml/index.ts`'s summary was stale on both halves and is corrected. Measured: "emits spec-clean
XML" is false (`<v:x value="1"/>`, `<a&b/>`, `<1abc/>` are all emitted), and "round-tripping
byte-for-byte" is false unqualified (`<div>x</div>` comes back as
`<div xmlns="http://hl7.org/fhir">x</div>`).

**The first attempt at that sweep opened the two carriers a consumer cannot see and left the one it
can**, which is this lineage's own trap reproducing verbatim. `src/index.ts:277` is a `//` comment and
`src/xml/index.ts`'s `@packageDocumentation` does not render either (`grep -c "Zero-dependency and
hardened" dist/index.d.ts` is `0`), while `src/xml/write.ts:2` and `:16` carry the identical two
halves and DO render, at `dist/index.d.ts:4766` and `:4780`. Worse, the corrected
`src/xml/index.ts` ends "read them there rather than from a summary here", pointing the reader
straight into the unswept header. Both are corrected now. **Measure reach; never grep for it.**

_Provenance: every figure above was produced by running probe scripts against a clean `8a91d29` and
then against the head tree, not recalled. Spec clauses: `hl7.org/fhir/R4/json.html` §2.6.2.2 for the
JSON array rule and `xml.html` for XML's repeated-element spelling._

### The gate, pass 1

`a4c...`/`4487063` **`REFUTED`**, two `INTRODUCED` majors and one `INTRODUCED` minor, **and not one
of them a defect in the code** -- the ninth consecutive slice in this repo with that shape. An
independent sweep of 420 element-level and 1,050 `Coding` documents found 0 launderings among the 567
wrappers the guard lets through, and confirmed every arity-0/1 and every `resourceType` wrapper
refused, all 180 refusals landing on documents already `valid: false`.

1. **The "sweep" claim was false**, corrected above: it named `src/index.ts` as the second carrier
   while `src/xml/write.ts` was the one rendering into `dist/index.d.ts`.
2. **A new universal shipped into `dist/index.d.ts`**: _"a wrapper of two or more items elsewhere is
   written as repeated elements and re-reads as a list"_, unscoped. The predicate counts **items**
   while every docblock justifying it reasons about **emitted elements**, and the two part on a
   hand-built `list([list([]), list([])])`, which holds two items and emits none. The laundering is
   `PRE-EXISTING`; the universal asserting it cannot happen was this slice's. **Scoped, not fixed by
   widening the guard**: widening would refuse arity-2 wrappers and withdraw the round trip the arity
   rule exists to protect.
3. **The sweep arithmetic did not reconcile** and the docblock said "six resource types" where the
   window covers seven. Both corrected; the conclusion was unaffected.

Three `PRE-EXISTING` findings are backlog lines, not folded in: the refusal's root segment is
`Resource.*` where the readout says `MedicationStatement.*` (pinned, deliberate, `typeOf` is the
strict read); the repo-wide prose says "the six resource types" over a set of **seven**
(`src/safety/codes.ts`, and it reaches `dist/index.d.ts`); and a single `<resourceType value="…"/>`
child element is dropped by `serializeResourceXml` under `issues: []`, since only the list form is
refused.

### The gate, pass 2, and the sentence the remedy itself got wrong

Pass 2 re-checked pass 1's three findings and confirmed all three remedied, then **`REFUTED` on one
`INTRODUCED` major sitting inside the remedy** -- which is the fail-to-converge signal, and the reason
the answer was **deletion rather than another paragraph**.

**The remedy answered pass 1's closing worry with a false mechanism.** It said the arity gap is
unreachable from the wire because `UNSERIALIZABLE_JSON_ONLY_SHAPE` "refuses first, which is
load-bearing ordering rather than a coincidence", and titled a test after it. **Measured: reversing
the two guard calls leaves every assertion in that test passing.** The ordering is observable only in
WHICH code a model tripping both reports, and that is already pinned by the "raised last" block. What
actually holds the gap shut is that **the JSON reader models a nested array as a marked COMPLEX**, so
`{"status":[["a"],["b"]]}` is `list([complex, complex])` and the item count this refusal reads is 2
under any ordering; the guard beside it refusing **at all** is the other half. A maintainer trusting
the shipped sentence would have preserved an inert line order while the two real protections could be
narrowed silently.

The claim was deleted from `src/xml/write.ts`'s `@throws`, `src/codec/serialize-guard.ts` and the
test's own comment, the test retitled to what it asserts, and the model shape it rests on asserted
directly. Two minors with it: the README said a namespace-less `<div>` "comes back with one inserted"
where the inserted one is the **FHIR** namespace, not the XHTML one a reader would assume; and this
slice's own `PRE-EXISTING`, refuter vocabulary with no referent for a consumer, was rendering into
`dist/index.d.ts`. **One `PRE-EXISTING` occurrence still renders there from base's `emitsOneDivElement`
docblock; that is a backlog line, not this slice's.**

**The standing lesson, and it is the one this repo keeps paying for: the code survived two passes with
no defect found, and both refutations were sentences. The pressure that creates is to write a longer
sentence to survive the gate, and a longer sentence is what produced the false ordering claim. The
shortest correct remedy is fewer words.**

### The gate, pass 3, the cap, and the pattern worth escalating

**`REFUTED`, and the ADR 0016 cap is spent. There is no pass 4.** The refuter's own instruction was
to apply the remedy and ship rather than open another round, because it is a grep-verifiable deletion.

**The finding: the false ordering claim survived in two carriers the pass-2 remedy never opened, and
both reach consumers** -- `CHANGELOG.md` (in `package.json` `files`, so it ships in the tarball) and
`.changeset/quick-melons-refuse.md`, which freezes into the release body. Deleted in both, never
reworded. Neither existed at `8a91d29`, so both were this slice's.

One minor with it, and it is the same shape one level down: **"the JSON reader models a nested array
as a marked COMPLEX" is itself an over-generalization.** Measured: `{"status":[["a"],["b"]]}` is
`list([complex, complex])`, but `{"status":["a",["b"]]}` and `{"_status":[["x"],["y"]]}` are
`list([primitive, primitive])` -- the marker lands on a primitive, and which of the two it is depends
on the spelling. The safety-bearing conclusion is unaffected and is what the prose now says: **every
list the JSON reader constructs holds primitives or complexes, never lists.**

**▶ ESCALATED RATHER THAN ABSORBED: this slice's gate caught the SAME failure three times** -- pass 1
finding 1, pass 2's implied scope, and pass 3 -- always "fixed the site it was reported at, missed the
carriers a consumer sees". Three different carrier classes: `dist/index.d.ts`, then the npm tarball's
`CHANGELOG.md`, then a pending changeset. **A sweep here is not done until it has enumerated the
CARRIERS, not the sentences**, and the carrier list is at least: `src/` doc comments that render,
`README.md`, `CHANGELOG.md`, `.changeset/*`, and `documentation/`. The code itself survived three
passes with **no defect found at any of them**, which is now the tenth consecutive slice in this repo
with that shape, and it is the argument for cutting a slice back rather than hardening it further.

## The shadowed member (2026-08-08)

`FHIR-XML-WRITE-RESIDUALS`, the repeated-property-name residual `#74` and `#75` both declared open.
`SERIALIZE_ERROR_CODES.UNSERIALIZABLE_SHADOWED_PROPERTY`, raised **last** in both writers, as a
whole-model pre-pass.

### The defect, measured against `914c03a`

The reader keeps the member a repeated name shadowed (`FhirComplex.duplicates`), `validateResource`
raises an **error**-severity `DUPLICATE_PROPERTY` over it and `readSafety` refuses to affirm
`safeToSummarize`. **All three are findings about the input.** Each writer walks `properties` only,
so each emitted one member per name, and that output is a different document carrying none of them.

`{"resourceType":"Observation","status":"final","status":"entered-in-error"}` emitted
`{"resourceType":"Observation","status":"final"}` and
`<Observation xmlns="http://hl7.org/fhir"><status value="final"/></Observation>`. Both re-read with
an empty issue list, `valid` `false -> true`, `safeToSummarize` `false -> true`, and
`negations: ["entered-in-error"] -> []`. **The retraction is in neither output.** Which member is
lost depends only on the order the sender wrote them in.

This is `#fhir-duplicate-key-retraction-2026-07-28` arriving one layer later: that slice closed the
**read**, and the write path re-opened the same verdict.

### Refusing rather than handing both back, which is the decision worth keeping

Handing both back is the route the four JSON-only shapes take, and here it is the worse of the two,
**measured**: FHIR JSON requires unique names (json.html §2.6.2), RFC 8259 §4 leaves the winner
undefined, and `JSON.parse` resolves such a name **last-wins** where this library reads
**first-wins**. On the mirror spelling `{"status":"entered-in-error","status":"final"}` the model
holds the retraction and `JSON.parse` returns `"final"` -- so emitting both members hands every other
consumer the member this one calls shadowed. That is the writer authoring a different clinical
answer, the fabrication class the refusals beside it exist for.

FHIR XML *can* repeat an element, so the format is not the obstacle there. But two repeated elements
re-read as a **list** -- a repeating element the sender never wrote, and a different model from the
ambiguity the document held.

### The window, which is not a second table

`shadowedProperties`: the same call `validateResource` raises its error from and the same one
`readSafety` requires empty. So **a model refused here already reads `valid: false` with
`safeToSummarize: false`** -- the bound every refusal beside it kept, held by construction rather
than by measurement. Nothing that reads clean stops serializing.

**It does NOT follow that the location string matches, and pass 1 refuted the draft that said so.**
The root SEGMENT is derived per call site, not shared. Measured on
`{"status":"final","status":"entered-in-error"}` (no readable `resourceType`): the guard reports
`Resource.status`, `readSafety` reports `$this.status`, and `validateResource` raises **no**
`DUPLICATE_PROPERTY` at all, because it returns before the safety collector when no type is readable.
`valid` is still `false` there, so the bound above survives; the location agreement does not. The
root-segment divergence is `#75`'s declared `Resource.*` vs `MedicationStatement.*` residual and is
**PRE-EXISTING** -- the remedy is the sentence, never growing the guard.

### What it does not cover, and why the bound is the reason

- A repeated name inside a **primitive's `_`-sibling** is not modeled at all (an R4 `Element` is
  `id` and `extension`; `read.js` flags it and carries no shadowed member), so there is nothing to
  refuse.
- A repeated name inside a complex sitting in a **primitive's `extension`** IS modeled and is still
  dropped by both writers: `{"_status":{"extension":[{"url":"u","valueString":"x",
  "valueString":"y"}]}}` loses `"y"` on both paths. `shadowedProperties` does not descend a
  primitive's metadata, and that document reads `valid: true` with `safeToSummarize: true` -- so
  refusing it would withdraw a round trip from a model this library reports as clean, the one cost
  none of these refusals pays. **Declared, and pinned by a test in the state that makes it a gap.**

### The axis of every "0"

- **"0 of 1,195 readings moved" / "0 newly throwing"** -- the XML read differential, which **cannot
  grade this class at all**: the XML reader has no `duplicates` mechanism, so no document in that
  corpus carries a shadowed member. That zero is by construction, **not evidence**.
- **"0 of 33 fixtures newly refused"** -- this repo's 26 hand-authored JSON and 7 hand-authored XML
  fixtures, each through both writers.
- **"0 false positives over 2,480 generated documents"** -- a grammar of 8 `(resource type, element)`
  root pairs x 10 value shapes x 3 placements (root, one level down, inside a Bundle entry), with
  and without the repeated name. 2,400 refused on the new code, 18 kept an earlier code (which is
  the raised-last rule measured), 62 emitted, and **no document without a shadowed member reached
  the new code**. A generated grammar, 8 root pairs, **not the whole window**.

**None of these is the FHIR R4 published-examples corpus. Nothing here is corpus-wide.**

### The sweep, and the carriers it opened

The falsified claim was "the writer emits one member per repeated name", plus every restatement of
"dropped by both writers" that `#74` and `#75` wrote as a declared-open residual. Enumerated by
**carrier**, rooted at `/workspace/fhir` rather than by phrase: `src/` doc comments that render
(`codec/write.ts` module + `serializeResource`, `codec/serialize-guard.ts` module + three docblocks +
the code table, `xml/write.ts` `@throws`), `README.md`, `CHANGELOG.md`, `.changeset/*`, `CLAUDE.md`,
`documentation/`, and the tests that pinned the gap. Two pending changesets carried it; per
ADR 0001 the falsified clause was **deleted, never reworded**.

**🛑 AND THE SWEEP STILL MISSED SITES PASS 1 FOUND, THIS FILE AMONG THEM.** `agent-notes.md` was in the
enumerated carrier list and was still swept by PHRASE, so the claim survived twice here -- once in
**§ Deliberate omissions, whose own contract line says it is verbatim from `CLAUDE.md`**, the very
line the same commit corrected, and once inside the section `CLAUDE.md`'s duplicate-property trap
points at. Plus a comment in `test/array-wrapped-scalar.test.ts`, and a `CHANGELOG.md` entry further
down the file. **A relocated copy is a carrier of
the thing it copies**, and correcting the original without it leaves the next agent reading the new
refusal as a regression against a documented deliberate choice.

### Budget

`fhir/CLAUDE.md` ends at 27,990 of 28,000. The trap was funded by relocation only: an enumeration
sitting on the line that says "never a count or an enumeration here", a vendor-quirk sentence stated
twice in one file, an evidence summary whose own sentence says it had already moved to these notes,
and one line of brand narrative. **No trap was deleted**, and the falsified omission was a
correction rather than a saving.

## The untaggable `resourceType` (2026-08-09)

`FHIR-XML-WRITE-RESIDUALS`, the non-string-`resourceType` residual `#74`, `#75` and `#76` each
declared open. `SERIALIZE_ERROR_CODES.UNSERIALIZABLE_RESOURCE_TYPE`, raised **last** in the XML
writer, as a whole-model pre-pass. XML only.

### The defect, measured against `63b05fc`

FHIR XML has no `resourceType` element: the type IS the tag (xml.html). `writeElement`'s skip is
`if (name === "resourceType") continue;`, unconditional on the name, and `resourceTypeOf` returns a
string or nothing, so `serializeResourceXml` fell back to `tagName = rt ?? "Resource"`. Where the
value was not a string, the property was deleted and the element was named a type nobody wrote.

| in | reads | XML out | re-read |
| --- | --- | --- | --- |
| `{"resourceType":42,"status":"entered-in-error"}` | `RESOURCE_TYPE_UNKNOWN`/error, `valid: false` | `<Resource …><status value="entered-in-error"/></Resource>` | `[]`, `valid: true` |
| `{"resourceType":{"modifierExtension":[{"url":"http://example.org/x"}]},"status":"final"}` | `valid: false`, `safeToSummarize: false` | `<Resource …><status value="final"/></Resource>` | `[]`, `valid: true`, `safeToSummarize: true`, `unhandledModifierExtensions: []` |
| `{"resourceType":"Patient","contained":[{"resourceType":42,"status":"entered-in-error"}]}` | `valid: true` | `<contained><status value="entered-in-error"/></contained>` | a `contained` backbone element, not a contained resource |
| `{"_resourceType":{"id":"q"},"status":"final"}` | `RESOURCE_TYPE_UNKNOWN`/error | `<Resource …><status value="final"/></Resource>` | the `id` gone |

**The second row is the whole point of taking this leg.** `safeToSummarize` moves because the deleted
property takes its **entire subtree** with it, and a `modifierExtension` -- FHIR's `?!` rule, the one
thing a reader may never ignore -- is among the things that subtree can hold. That is the same shape
`#74`, `#75` and `#76` each closed through a different door: a format change that **upgrades** a
document's own trustworthiness claim.

### The predicate, and why it is element-level rather than property-level

`lacksTaggableResourceType`: the element wrote a `resourceType`, and **the first one it wrote** is not
a string primitive. Both halves are load-bearing and the second took three attempts.

- **THE QUANTIFIER MUST BE THE WRITER'S OWN, AND `ANY` IS NOT IT. Gate pass 1 refuted the draft that
  asked whether ANY value written there is a string.** `resourceTypeOf` in `src/xml/write.ts` is a
  `find`, and `typeOf` goes through `getProperty`, which is first-wins as well. So with a non-string
  first and a string second the writer read no type, named the element `Resource`, deleted **both**
  properties and took the modifier extension with the subtree -- and an `any`-quantified predicate
  answered `false` and refused nothing. **The defect, unrefused, inside the slice that claimed to
  close it**, and the claim that the shape was safe had reached five carriers. Neither reader emits
  that order, so it is hand-built and pinned that way; the general rule is that **a guard that answers
  for a property the writer never consults is not guarding the writer.**
- **A property-level predicate ("this `resourceType` is not a string") is WRONG, and the counterexample
  comes from XML rather than from JSON.** The XML reader has no `duplicates` mechanism and pushes the
  type synthesized from the tag first, so a `resourceType` CHILD element lands as a second property of
  that name beside it: `<Patient xmlns="http://hl7.org/fhir"><resourceType><a value="1"/></resourceType></Patient>`
  reads as two `resourceType` properties in one `FhirComplex`, `issues: []`, `valid: true`,
  `safeToSummarize: true`. The tag there is named correctly, so this defect's substitution never
  happens; what drops is the repeated-property-name case, which both writers do and which is declared
  separately. A property-level predicate refused it, and **the cost of that is withdrawing
  serialization from a model this library reports as clean.** Do not write it up as "the one cost
  none of the refusals beside this one pays", which this note did and which is FALSE: `breaksTag`
  pays it too, on `<a:!x xmlns:a="http://hl7.org/fhir" value="1"/>`. **Rarity was never the argument;
  the cost is.** Gate pass 2 caught the idiom, tagged it `PRE-EXISTING` because it is verbatim at
  `63b05fc`, and it is cut here at the three carriers this slice authored. **Two base-owned carriers
  are LEFT, on purpose and named so the next reader does not have to find them:**
  `src/codec/serialize-guard.ts` (the `assertNoShadowedProperty` docblock) and
  `test/shadowed-property-write.test.ts`. They belong to `#76`'s slice, not this one.
- **An ABSENT `resourceType` is left alone.** `serializeResourceXml` accepts any `FhirComplex` and
  names a typeless one `Resource` by documented fallback, so refusing there would withdraw a route
  from every model that never had a type -- and nothing is deleted in that case. **The line this
  refusal draws is "the writer drops a property the sender did write", not "the verdict moved".**

### The bound, which is structural and holds only at the root as a verdict

At the **root**, this costs a round trip only for a model already reported `valid: false`: `typeOf` is
the strict single-value read, so exactly the values refused here draw an error-severity
`RESOURCE_TYPE_UNKNOWN`. **Deeper it does not hold, it is not claimed, and a document read from XML
reaches it.** `{"resourceType":"Patient","contained":[{"resourceType":42,…}]}` and
`<Patient xmlns="http://hl7.org/fhir"><name><resourceType><a value="1"/></resourceType></name></Patient>`
both read `valid: true` with an empty issue list, because no layer here checks a nested element's type.

**So the bound that IS claimed is structural, and it is by construction rather than by sampling**:
the writer's skip is unconditional on the name, so at every location this refuses base dropped a
property the sender wrote and emitted no element for it, with no diagnostic at either end. What is
withdrawn is a deletion, never a round trip that reproduced the input.

### Raised last, and nothing moved onto it

Last in the chain, after `UNSERIALIZABLE_ELEMENT_NAME`, `UNSERIALIZABLE_DIV_MARKUP`,
`UNSERIALIZABLE_JSON_ONLY_SHAPE`, `UNSERIALIZABLE_ARRAY_WRAPPER` and `UNSERIALIZABLE_SHADOWED_PROPERTY`.
Measured, one document per code, each an untaggable type gate spelled a different way:
`{"resourceType":null,…}` keeps `UNSERIALIZABLE_JSON_ONLY_SHAPE`, `{"resourceType":["Observation"],…}`
and `{"resourceType":[],…}` keep `UNSERIALIZABLE_ARRAY_WRAPPER`,
`{"resourceType":42,"resourceType":"Observation",…}` keeps `UNSERIALIZABLE_SHADOWED_PROPERTY`, and an
XML document with dropped element text keeps `DROPPED_ELEMENT_TEXT`. **No case moved onto the new
code.** Pinned by `test/xml-resource-type.test.ts`, "raised last, so no case moves onto the new code".

The walk is `collectMarked`'s, shared with `droppedText` / `nestedArrays` / `assertXmlSerializable`
rather than copied, and it selects **elements**; the location appends the `resourceType` segment with
`childPath`, which is how the array wrapper on the same property already reports it
(`Resource.resourceType`, `Patient.contained[0].resourceType`).
**`collectMarked`'s signature was left alone.** A first draft widened its predicate to receive the
property name so the walk could answer property-level questions; that draft was reverted with the
property-level predicate it existed for, and the shared walk is unchanged in this slice.

### Both polarities, on the test rather than on a harness

`test/xml-resource-type.test.ts` **fails 13 of 25 against the base source tree** (the two `src/` files
stashed) and passes 25 of 25 at head. A control asserted in one state only clears nothing here; this
one is asserted in both.

**IT USED TO READ 7 OF 23, AND THE MISSING SIX WERE VACUOUS GREENS. A GREEN IN BOTH STATES CLEARS
NOTHING EITHER.** Those cases asserted `viaXml?.code` against
`SERIALIZE_ERROR_CODES.UNSERIALIZABLE_RESOURCE_TYPE`, and against a base tree **both sides are
`undefined`**, so `expect(undefined).toBe(undefined)` passed and the four scalar spellings the
CHANGELOG leans on discriminated nothing in the polarity that matters. They now assert a **string
literal**, with the enum member pinned once on its own. Raised by gate pass 1 as an observation rather
than a finding, which is why it is written down here.

The out-of-tree harness carried its own negative control: pointed at `@cosyte/hl7` instead of this
package it exits non-zero on the missing `serializeResourceXml` rather than reporting green.

### Not closed by it, named rather than implied

- **A JSON decimal comes back from XML as a string**, because XML carries no JSON type.
- **`Observation.value[x]`** is outside the array-wrapper window and its wrapper still launders.
- **A `resourceType` CHILD element read from XML is still dropped by both writers**, silently, and
  that document reads `valid: true`. It is the repeated-property-name case reached through a door the
  reader's missing `duplicates` mechanism opens, not this one, and refusing it would pay the cost
  named above. `<Patient xmlns="http://hl7.org/fhir"><resourceType value="Observation"/></Patient>`
  comes back as `<Patient xmlns="http://hl7.org/fhir"/>`. Pinned as a characterization test.
- **The XML reader putting two properties of one name in one `FhirComplex`** is the underlying gap
  behind that row, and it is a READ-path decision, not this branch.

### The axis of every "0" here

**None of the numbers above is the FHIR R4 published-examples corpus.** They are 7 hand-authored XML
fixtures plus mutations plus this repo's hand-authored JSON fixtures, plus the hand-built documents in
`test/xml-resource-type.test.ts`. The read differential cannot grade this class: the substitution is a
WRITE-path branch, no XML document produces the marker, and its own control is stale on a clean tree.
No zero of its is quoted as evidence here.

### What the gate found (pass 1, `52472c2`)

`REFUTED`, and **the first `fhir` slice in eleven where the gate found a defect in the code rather
than only in a sentence.** The escalated process finding above -- ten consecutive slices refuted on
prose, and the pressure that creates to write a longer sentence -- ends here on the opposite outcome:
the remedy was a **quantifier**, and the prose shrank around it.

1. **`INTRODUCED` major, and it is the item's own leg.** `some` in the guard against `find` in the
   writer, above. Remedied in the predicate, not in the claim: aligning it refuses nothing either
   reader can build, and it makes the root-level bound (`typeOf` is first-wins, so exactly the values
   refused draw an error-severity `RESOURCE_TYPE_UNKNOWN`) true as written instead of nearly true.
2. **`INTRODUCED` minor: the thrown message stated a counterfactual false at every depth it reports.**
   *"...which this writer would delete while naming the element `Resource`"* -- but at depth the tag
   comes from the property name, and the message is emitted for `Patient.contained[0].resourceType`.
   **Cut to what is true everywhere: "which this writer would delete."** The `Resource` substitution
   is a root fact and is stated where it is true.
3. **`PRE-EXISTING` minor, taken anyway because this slice edits the paragraph and widens it.** The
   module comment's *"No refusal here recognises anything new, invents a value, or changes a document
   that reads clean"* was already false at base -- `breaksTag` names a zero-issue document it refuses,
   and so does the `div` forgery. **Only the false clause is cut**; the two true ones are kept, which
   is the `#76` rule. One carrier, so cutting it there is the whole sweep: `dist/` is generated, and
   no pending changeset carries the sentence.

What the gate could **not** grade, in its own words: every "measured at `63b05fc`" number, because its
Bash is `git diff`/`log`/`show` only. Those were re-measured by hand against a `63b05fc` worktree
before the pass and again after the remedy.
