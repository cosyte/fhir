# @cosyte/fhir: Project Guide for Claude

## Project

**`@cosyte/fhir`**: a developer-focused FHIR parser + utility library for Node.js/TypeScript,
published under the Cosyte brand. Open-source (MIT). The FHIR member of the cosyte parser suite; it
mirrors the API shape of `@cosyte/hl7`, the reference parser.

**North star:** A developer can read a real-world FHIR resource, model it with correct primitive
semantics, and validate it against US Core, without reading the FHIR spec.

## Status

- **Pre-alpha, unpublished on npm.** No version of `@cosyte/fhir` has ever reached the registry:
  every publish attempt is rejected with `E403` by npm's name-similarity filter, on account of the
  unscoped `fhir` package (FHIR-NPM-NAME; support request filed 2026-07-23). `package.json`
  therefore runs ahead of the registry rather than behind it, so read the version there and never
  infer it from npm. **Phases 1–9 landed; P10 landed (halves a + b); P11 buildable
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
  bare string with no channel to say so. **Pass two (NOT REFUTED) filed two more `PRE-EXISTING` ones,
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
  **Left open, deliberately, each pinned by a test rather than a sentence:** (a) an array-wrapped
  `value[x]` draws **no** `ARRAY_WRAPPED_SCALAR` (outside the closed set; widening to every R4 `0..1`
  element _is_ the per-resource model), and `readObservationValue` still has no issue channel of its
  own, though it fails **safe** on this route (reports the present variant, `quantity: undefined`, so
  no wrong number is handed out); (b) the JSON reader still does not model a nested array **as an
  element**, and deliberately never will, but `[["x"]]` no longer loses the inner value: it is kept
  as text and read with `nestedArrayContent()` (`FHIR-NESTED-ARRAY-PRESERVATION`, above). (c) The
  read -> write -> read **laundering** is duplicate-key-only: the array route round-trips faithfully
  (the writer emits the list back), so the re-read reproduces the finding rather than losing it. That
  is now pinned, so a future writer change cannot quietly introduce the laundering. (d) `PRE-EXISTING`,
  filed by the same refuter pass: a **document-supplied `resourceType` reaches the diagnostic
  `expression` prefix** (`ARRAY_WRAPPED_SCALAR@<whatever the document put there>.resourceType`, and on
  into the `OperationOutcome`). Same class as `emit(ctx, "RESOURCE_NOT_MODELED", rt)` already on
  `main`, so not introduced here, though this slice's new early-return branch creates another
  instance. `resourceType` is a type discriminator so realistic PHI exposure is remote, but the
  value-free-diagnostics contract is stated without that qualification. Worth its own item.
  (e) `PRE-EXISTING`, and the one to pick up first: `serializeResourceXml` **normalizes a singleton
  wrapper away** (JSON `{"status":["entered-in-error"]}` -> `<status value="entered-in-error"/>` ->
  re-read `valid: true`, `safeToSummarize: true`). Clinical content survives (`retracted: true` on
  both sides) and XML genuinely cannot express a singleton wrapper, so this is a narrower laundering
  than the duplicate-key one, but it is a **cross-format** route by which the encoding complaint
  disappears. P2:
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

## Tech Stack (the shared `@cosyte/*` standard)

fhir inherits the canonical toolchain by depending on the published `@cosyte/*` config packages, not
by copying files. The source of truth is the meta-repo's `documentation/conventions.md`. This is a
summary.

- **Language:** TypeScript (strict, full rigor set incl. `noUncheckedIndexedAccess`) via
  `@cosyte/tsconfig`. **Target ES2023**, `NodeNext`.
- **Build:** dual ESM + CJS + `.d.ts` via `tsup` (`@cosyte/tsup-config`); `attw` is a publish gate.
- **Node:** **>= 22**.
- **Package manager:** `pnpm@10`.
- **Lint/format:** **ESLint 10** (`@cosyte/eslint-config`) + Prettier (`@cosyte/prettier-config`).
  Lint at `--max-warnings=0`.
- **Testing:** **Vitest 4** + v8 coverage (`@cosyte/vitest-config`). Per-directory >= 90 gates come
  online in Phase 1 when real code lands (P0 holds them at 0: there is no logic to cover yet).
- **CI/CD:** thin callers of the reusable `cosyte/.github` workflows.
- **Runtime deps:** **Zero.** Node stdlib only.
- **License:** MIT.

## The four architecture ADRs (read before writing any parser code)

Recorded in `documentation/decisions/` at bootstrap because they shape everything:

1. **`0001`: decimal / integer64 representation.** String-backed; MUST preserve lexical precision.
   `0.010` is not `0.01`. **Never** round-trip `decimal`/`integer64` through the JS `number` type.
   That is a silent-data-corruption hazard for doses, lab values, and identifiers.
2. **`0002`: FHIRPath posture.** Implement a bounded, vendored subset in-repo. No runtime
   dependency, no full third-party engine. Needed for invariants + slicing (Phase 7).
3. **`0003`: XML scope.** JSON-first; XML serialization deferred to Phase 8.
4. **`0004`: R4-first.** `4.0.1` is the modeled version (ONC HTI-1 / §170.315(g)(10) anchor). R5 /
   DSTU2 are read-tolerance only.

## Engineering Guardrails

- No `any`. No unjustified `as` casts. Use `unknown` and narrow.
- JSDoc (with `@example`) on every public export: feeds IntelliSense.
- Immutable by default. Mutation only via explicit methods.
- No `console.*` in library code. Throw typed errors or return results.
- Postel's Law: the reader is liberal (lenient default + warnings), the writer is conservative: it
  authors no value of its own, and emits spec-clean FHIR for every model FHIR can express. It is
  **not** unconditionally spec-clean, and the exceptions are named on `serializeResource` (an array
  inside an array, a non-string `resourceType`), because repairing either means inventing content or
  dropping it.
- **PHI discipline:** synthetic-only fixtures, redaction in logs. Never commit realistic PHI. A
  vendor quirk is encoded only when a real de-identified resource grounds it, never invented.

## Standing disciplines (every change)

Mirrors the three disciplines in the meta-repo's `documentation/conventions.md`. They bind here too:

1. **Documentation follows code**: a change to the public surface/stack/status isn't done until the
   docs are: this repo's docs, the meta-repo `documentation/repos/fhir.md`, and the
   `ecosystem-map.md` status table.
2. **Version + changelog**: a Changeset (`patch` on the `0.0.x` ladder) + a `CHANGELOG.md`
   `[Unreleased]` entry per meaningful change.
3. **Crew + knowledgebase loop**: if the public API changes, flag/update the matching `crew`
   healthcare skill (`fhir-resource-design`) + the KB product doc.
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
