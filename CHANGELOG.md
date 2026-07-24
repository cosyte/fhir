# Changelog

All notable changes to `@cosyte/fhir` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project stays on the
**v0.0.x-until-first-alpha** ladder (meta-repo ADR 0001) until its first alpha.

## [Unreleased]

### Fixed

- **`differential` CI check red on `main`: 5 "FALSE VALID" invariant violations reconciled against the
  oracle (FHIR-DIFFERENTIAL-RED).** The non-required `differential` job (the `validator_cli.jar` oracle
  over the spec-clean + Tier-2 quirk corpora) was failing: on five fixtures the parser reported no
  errors while the oracle reported errors. Each was reconciled firsthand against the live oracle
  (`org.hl7.fhir.core`, R4 `4.0.1`, US Core `6.1.0`). The findings were **incomplete fixtures**, not a
  parser conformance gap, so the fix completes the fixtures to be genuinely spec-clean rather than
  weakening the comparison:
  - **`medicationrequest-dose.json`**: added the base-mandatory `MedicationRequest.subject` (R4
    cardinality **1..1**, medicationrequest.html). The dose `doseQuantity` (`5 mg`, UCUM `mg`) is
    unchanged; the existing dose-unit tests still pass.
  - **`observation-vitals-bp.json`**: added the vital-signs-profile-mandatory `subject` +
    `effectiveDateTime` (observation-vitalsigns.html: an Observation with a vital-signs LOINC SHALL
    conform to the vital-signs profile, which requires both). The systolic/diastolic `mm[Hg]`
    components are unchanged.
  - **`observation-decimals.json`** (+ its `.xml` twin): re-coded from the body-weight vital-sign
    LOINC `29463-7` (which makes the oracle auto-apply the body-weight profile and demand
    category/subject/effective) to the **non-vital lab LOINC `718-7`** (Hemoglobin). The fixture's job
    is decimal-precision preservation, not vital-signs conformance; a lab observation is not
    auto-profiled, so the four decimal edge values (`70.0`, `0.0000000010`, `9223372036854775807`,
    `0.010`) round-trip byte-for-byte exactly as before.
  - **`quirk-searchset-paging.json`**: completed the embedded heart-rate (`8867-4`) Observation with
    `category` (vital-signs) + `subject` + `effectiveDateTime` so it is spec-clean. The paging quirk
    under test (`Bundle.link[relation=next]` surviving the round-trip) is untouched.
  - **`quirk-uscore-extensions.json`**: the oracle's two findings were both oracle-side artifacts, not
    instance defects: (1) `us-core-race` "could not be found" because the harness ran the oracle
    **without US Core loaded**, and (2) an `example.org` identifier system the validator refuses. Fixed
    by loading the US Core IG in the harness (`differential.mjs` now passes `-ig hl7.fhir.us.core#6.1.0`,
    the roadmap's documented oracle configuration) and moving the synthetic MRN off `example.org`.
    The parser is correct to accept the resource (roadmap §10 fail-safe: unknown extensions are
    preserved-and-flagged, never rejected).

  Fixtures only (synthetic, CC0/spec-grounded values; the PHI sweep covers them) plus the one harness
  IG flag. No change to the published package surface, runtime behavior, or the zero runtime deps.

### Added

- **Security-scaffolding parity with the sibling parsers (FHIR-SCAFFOLD-GAPS).** Registering the 7
  back-filled repos in drift coverage surfaced three `fhir`-only gaps against `config`'s
  `drift-manifest.json` (`requiredScripts` / `requiredWorkflows`), now closed by mirroring what every
  other cosyte parser already ships:
  - **PHI commit-scanner** (`scripts/phi-scan.ts`, `pnpm phi-scan`): a zero-dependency,
    FHIR-shape-aware detective tripwire. It parses each synthetic fixture (JSON / NDJSON) or scans
    element/`value`-attribute pairs (XML) and inspects only PHI-bearing elements keyed by FHIR element
    name: HumanName `family` / `given` / `text` (recursing into `contained` / `entry.resource`),
    `birthDate` / `deceasedDateTime`, SSN- / 9-digit-shaped `identifier` / `telecom` values (and
    dashed SSNs anywhere), phones without the `555` convention, `Address.line` / `.text`, and
    emails, refusing any realistic-PHI-shaped token not declared synthetic in
    `scripts/phi-allow-list.txt`. A plain-string `name` (`Organization.name`) is a resource label and
    is never name-scanned; the XML `<value>` scan is scoped to `<telecom>` / `<identifier>` blocks so
    an overloaded `Quantity.value` is never misread. `src/` gets a conservative dashed-SSN + email
    pass. Runs at pre-commit (`simple-git-hooks --staged`) and in CI (`run-phi-scan: true`);
    `scripts/verify.sh` now reports `phi-scan ✓`. A whole-file bypass requires `--allow-fixture` plus
    an audit entry in `phi-scan-overrides.md`.
  - **`.github/workflows/codeql.yml`**: thin caller of the reusable `cosyte/.github` CodeQL workflow.
  - **`.github/workflows/scorecard.yml`**: thin caller of the reusable OpenSSF Scorecard workflow.

  Additive dev-tooling / CI only. No change to the published package surface or runtime behavior;
  the runtime-dependency count stays zero (`tsx` + `simple-git-hooks` are dev dependencies).

- **Tier-2 real-world quirk corpus + `validator_cli.jar` differential over it (Phase 10, half b;
  roadmap §3/§6/§10).** Unblocked by meta-repo **ADR 0018**: "real document" that grounds a quirk
  now explicitly includes **publicly available real artifacts** (FHIR published examples, the spec's
  normative rules, US Core, documented public interop defects), not only privately-supplied vendor
  feeds. The anti-invention rule is unchanged: a genuinely vendor-proprietary deviation absent from
  every public sample stays grounded-only and is deliberately not encoded.
  - **Five quirk fixtures** (`test/__fixtures__/quirk-*.json`), each grounded in and citing a public
    source (`test/quirk-corpus.test.ts` is the provenance record), values synthetic:
    - `quirk-resourcetype-last.json`: `resourceType` is not the first property (json.html: property
      order is not significant). Reads clean; strict-emit restores `resourceType` to the front.
    - `quirk-scientific-decimal.json`: a decimal in exponent notation `1.0e2` (Synthea #675; the R4
      decimal regex permits an exponent). Read as a valid decimal, flagged
      `DECIMAL_PRECISION_AT_RISK` (info, never an error), and **preserved byte-for-byte**. A naive
      `JSON.parse` would coerce it to `100` and destroy the recorded precision.
    - `quirk-primitive-extension-misaligned.json`: a repeating primitive whose `_`-sibling array
      length disagrees (HAPI #5738; json.html null-padding). **Fails closed**: a typed, value-free
      `FhirCodecError`/`PRIMITIVE_EXTENSION_MISALIGNED`, never guessing which value the metadata binds.
    - `quirk-searchset-paging.json`: a searchset Bundle with `link[relation=next]`
      (bundle-example.json; Epic/Cerner require following `Bundle.link[next]`). Reads clean; the
      paging link survives the round-trip (never silently truncates the record).
    - `quirk-uscore-extensions.json`: US Core race (complex, `ombCategory` OMB 2106-3 + text) and
      birthsex extensions on a base Patient. Reads clean; every extension and sub-extension is
      preserved through the round-trip.
  - **Differential wiring**: `scripts/differential.mjs` now runs this Tier-2 corpus through the JVM
    `validator_cli.jar` oracle alongside the spec-clean tier, under the same two invariants (never a
    false _valid_; no spurious error on clean input). A fail-closed reader throw is surfaced as a
    `fatal` finding. The `differential` CI job scope + comment updated. **Still CI-only**: the oracle
    is a JVM program with no Java in the dev container, so it has **not** been observed green here.
  - The two remaining roadmap-§3 quirks, _missing must-support_ (`MUST_SUPPORT_ABSENT`,
    info-never-error) and _US Core version drift_ (`PROFILE_VERSION_MISMATCH`), are already exercised
    by the Phase-6 profile suite; this corpus targets the read-path / codec / Bundle quirks those
    tests do not reach.
- **Conformance hardening: fuzz, PHI-leak, and type-level tiers (Phase 11, buildable portion;
  roadmap §6).** The layered accuracy strategy turned into gating tests, plus the read-path robustness
  fixes those tests surfaced. The JVM `validator_cli.jar` differential is **authored but CI-only**
  (there is no Java in the dev container, it has not been observed green here), and the highest-value
  real-vendor **quirk-corpus** differential is **deferred to `REAL-CORPUS`** (a quirk is encoded only
  when a real de-identified document grounds it (conventions §PHI) and none exists yet).
  - **JSON + XML fuzz tier** (`test/fuzz.test.ts`): adversarial JSON/XML/NDJSON at fuzz-scale run
    counts (CI-tunable via `FUZZ_RUNS`; a dedicated `fuzz` CI job raises it to 20 000): XXE /
    billion-laughs / undefined entities, deep nesting, `_element` misalignment, huge /
    scientific-notation numbers, `resourceType` games, prototype-chain keys, and truncation +
    structural mutation of the real corpus. The proven contract: adversarial input **never crashes /
    hangs / OOMs**. It becomes a _typed_ `FhirCodecError` / `FhirXmlError` with a registered fatal
    code, or a bounded rejection, never an untyped throw.
  - **PHI-leak test tier** (`test/phi-leak.test.ts`): the value-free-diagnostics contract (§7) as a
    gate: a corpus sweep plus an injected-sentinel battery assert no PHI-bearing input value ever
    reaches any `OperationOutcome` / issue / error output (a finding carries a coded reason and a
    FHIRPath location, never a value). Generalizes the hand-picked `phi.test.ts` cases to the whole
    corpus.
  - **Type-level tier** (`test/public-types.test.ts`): `expect-type` assertions on the public type
    surface (the `kind`/`type`-discriminated unions a consumer switches on, `PrimitiveValue` never
    being a JS `number`, the value-free `FhirIssue` shape), checked by `tsc`.
  - **New fatal `FATAL_CODES.MAX_DEPTH_EXCEEDED`**: the JSON reader now bounds nesting at 256
    (matching the XML reader) and refuses a pathological tower of `[[[[…]]]]` / `{"a":{…}}` with a
    typed, value-free fatal instead of a V8 stack overflow. Real FHIR nests far shallower and is
    unaffected.
  - **Differential harness** (`scripts/differential.mjs`) + a CI `differential` job that provisions the
    JVM oracle over the synthetic spec-clean corpus, enforcing "never a false _valid_" and "no spurious
    error on clean input" on issue presence / severity / location (never text, ours is PHI-redacted).
    Authored, not yet observed green locally.

### Fixed

- **Decimal DoS on the read path.** `FhirDecimal` quantity comparison aligned scales with
  `10n ** BigInt(scaleDiff)`; an adversarial literal such as `0e9999999999999999999` (finite as a
  double but of astronomical scale) made that exponentiation throw an untyped `RangeError` (or hang
  building a multi-gigabyte BigInt) via the codec's precision check. Comparison is now done in a
  canonical form (coefficient stripped of trailing factors of ten, zero collapsed) that **never
  exponentiates**; quantity- and precision-equality semantics are unchanged, verified against the
  existing decimal suite.
- **XML entity prototype-chain bypass.** The reader resolved a predefined entity with a bare
  `PREDEFINED[body]`, so `&constructor;` / `&toString;` / `&__proto__;` read through `Object.prototype`
  and bypassed the five-entity allowlist. Now guarded by `Object.hasOwn`: only the five predefined
  entities resolve; every other named entity is refused (`UNDEFINED_ENTITY`).
- **Validator DoS via a prototype-named property.** A resource whose property was literally named
  `constructor` / `toString` / `valueOf` / `hasOwnProperty` made the schema lookup read an inherited
  `Object.prototype` member and crash `validateResource` with an uncaught `TypeError`. Now guarded by
  `Object.hasOwn`: an adversarial resource can no longer fault the validator.

- **Profile growth loop: `defineProfile()` + a spec-grounded starter kit (Phase 10, half a;
  profiling.html).** The programmatic authoring front door for the profile engine, plus a publishable
  set of example profiles that dogfood it. Half b (the Tier-2 real-vendor **quirk** corpus and its
  oracle differential) is **deferred to `REAL-CORPUS`**: a quirk is encoded only when a real,
  de-identified vendor document grounds it, and none exists yet, so inventing one is forbidden.
  - **`defineProfile(spec)`** authors a `StructureDefinition` in code from an ergonomic `ProfileSpec` /
    `ProfileElementSpec` (author-friendly `max: number | "*"`, defaulted constraint `severity`, `id`
    defaulting to `path`, `sliceName` derived from the id) and returns the **exact same model** the
    engine already consumes, so `validateResource(resource, { profiles: [defineProfile(spec)] })` just
    works. It is proven byte-for-byte equal to `loadStructureDefinition(parseResource(equivalentJson))`
    for a valid spec: **one model, two authoring routes, no privileged internal shape.** As a
    conservative writer (Postel's Law, emit side) it throws a value-free `InvalidProfileError` on an
    author mistake (a missing `url` / `type` / element `path`, a negative or non-integer cardinality,
    a `max` below `min`) rather than degrading silently. It is idempotent on an already-normalized
    `ElementDefinition` (accepts `UNBOUNDED` as a numeric `max`).
  - **Profile starter kit**: `VITAL_SIGN_OBSERVATION_STARTER` (grounded in observation-vitalsigns.html
    and US Core Vital Signs: required `status`, must-support `code`, and a **sliced** `category`: a
    required `VSCat` slice pins the `vital-signs` coding while the **open** slicing still allows other
    categories, mirroring the real profile rather than a bare pattern that would reject a valid
    multi-category Observation) and `PATIENT_IDENTIFIER_STARTER`
    (grounded in US Core Patient §4.2: `identifier` / `.system` / `.value` required and must-support,
    deliberately **no** MRN slice and **no** `identifier.type` bind: the wrong-patient-merge hazard).
    Every starter is authored through the public `defineProfile()` (no blessed internal builder),
    self-contained (differential-only, no bundled base, roadmap §5), and clearly a _template_, not an
    authoritative vendor conformance statement. Exposed as `STARTER_PROFILES`, the named profiles,
    `starterProfile(url)`, and `STARTER_PROFILE_BASE_URL`.
  - **Deferred, discipline intact:** named real-vendor profiles + the Tier-2 quirk fixtures + the
    `validator_cli.jar` differential on the quirk corpus → `REAL-CORPUS` (no invented vendor behavior);
    profiles beyond the shipped starters + US Core are user-supplied.
- **Bundles, references, and Bulk NDJSON streaming (Phase 9, bundle.html / references.html / the Bulk
  Data Access IG).** The `Bundle` layer: the model, reference resolution with a DoS-safe cycle guard,
  and a streaming NDJSON reader, all value-free and zero-dependency.
  - **Bundle model + entry-processing semantics** (`readBundle`, `entryProcessing`, `isAtomicBundle`,
    `BUNDLE_TYPES`). Reads a `Bundle` into an explicit `BundleReadout` and classifies the one
    distinction a consumer must never blur: **`transaction` = all-or-nothing (`"atomic"`)** vs
    **`batch` = independent (`"independent"`)**; every other type carries no processing contract
    (`"none"`). `Bundle.total` is surfaced as its **lexical string**, never a JS `number`. The
    artifact and its semantics are modeled. **Transactions are not executed** (no server here; a
    stated non-goal).
  - **Reference resolution** (`resolveReference`, `buildBundleIndex`, `containedIndex`). Classifies
    and resolves relative / absolute / logical / `#fragment` references against a Bundle + `contained`
    closure, keyed version-free (`Type/id`, `/_history/{vid}` dropped) and by exact `fullUrl`. A local
    miss (a fragment naming an absent contained, a relative naming no entry) is `"unresolved"`; a
    reference to somewhere outside the closure is `"external"` and **never false-flagged**.
  - **DoS-safe cycle/depth guard** (`hasContainedCycle`, `MAX_REFERENCE_DEPTH`). An **iterative**
    (heap, not call-stack) three-color depth-first search over the `contained` fragment graph, bounded
    by a frontier cap. A reference cycle (`#a`→`#b`→`#a`, a self-cycle, a root↔contained loop) is
    **detected and reported, never followed**. It always terminates, and never false-positives on a
    legitimate acyclic (DAG) contained graph.
  - **Streaming Bulk NDJSON reader** (`streamNdjson`, `parseNdjsonLine`, `NDJSON_ERROR_CODES`).
    Consumes any (async or sync) iterable of `string` / `Uint8Array` chunks (a Node `Readable`, a web
    `ReadableStream`, a generator) and yields one `NdjsonRecord` per line as bytes arrive, **without
    loading the whole file** (only the current partial line is buffered; an adversarial unterminated
    line is cut off `LINE_TOO_LONG` and drained without accumulating memory across chunks). **Per-line
    error isolation**: a malformed line (`MALFORMED_JSON` / `NOT_A_RESOURCE`) yields an isolated,
    value-free error (reported by **line number, never line content**) and the stream continues.
    Each good line is read through the precision-preserving codec, so a decimal is never routed
    through a JS `number` (ADR 0001).
  - **New value-free diagnostics**, wired into `validateResource` for a `Bundle`: `REFERENCE_UNRESOLVED`
    (warning: the reference is **preserved**, never fatal; the target may live outside the closure),
    `CONTAINED_CYCLE` (error), and `FULLURL_ID_MISMATCH` (error: a RESTful `fullUrl` whose id
    disagrees with `resource.id`; a `urn:uuid` fullUrl is **exempt**, placing no constraint on the id).
    Every finding is a FHIRPath _location_, never a value, reference string, id, or fullUrl. Adds the
    R4 `not-found` `IssueType`.
  - **Deferred, fail-safe intact:** no transaction **execution**. The library models the Bundle
    artifact and its all-or-nothing vs independent semantics, not a server that applies them.

- **`docs-content/` producer surface (`DOCS-CONTENT-P8`).** A minimal, contract-compliant docs
  producer: `docs-content/intro.md` + `docs-content/sidebars.json`, plus the `pack:docs` script
  (`scripts/build-docs-artifacts.sh`) that builds the `docs-content.tar.gz` + `source.tar.gz` release
  artifacts the `cosyte/docs` chrome ingests. Deliberately a **Size-S scaffold stub**: the sidebar is
  the compliant Overview-only spine (`{"docs":["intro"]}`) and `intro.md` carries an **honest pre-alpha
  / Coming-Soon status posture**. It mirrors `dicom`/`x12`'s registered-but-disabled state, states
  what the parser does today and what is not yet here, and marks the full Diátaxis spine
  (Installation, Quickstart, Core Concepts, Guides, Troubleshooting) as deferred until the parser
  stabilizes. No invented placeholder categories, no unshipped-API claims; the docs grow with the
  parser.

- **XML codec + cross-format equivalence (Phase 8, xml.html).** A **zero-dependency** FHIR XML codec
  that reads and writes the **same schema-free model** as the JSON codec, plus the oracle that proves
  the two wire formats agree. The hand-written XML reader is **XXE- and billion-laughs-proof by
  refusal**, not by mitigation.
  - **Hardened raw reader** (`readRawXml` → `XmlElement` tree). It **refuses any `<!DOCTYPE`**
    (`DTD_FORBIDDEN`) before parsing a single element: a DTD is the only place XML can _declare_ an
    entity, so refusing it closes the external-entity (XXE) **and** nested-entity-expansion
    (billion-laughs) vectors at once. It **refuses any entity reference** beyond the five predefined
    names and numeric character references (`UNDEFINED_ENTITY`), an independent second guard so no
    entity is ever resolved, expanded, or fetched. It performs no I/O, resolves no URI, and bounds
    nesting depth (`MAX_DEPTH_EXCEEDED`): adversarial input yields a typed `FhirXmlError`, never a hang,
    OOM, fetch, or crash. New public surface: `FhirXmlError`, `XML_FATAL_CODES`, `readRawXml`, and the
    `XmlElement` / `XmlNode` / `XmlText` / `XmlAttribute` types.
  - **FHIR XML → model** (`parseResourceXml`) returns the shared `ReadResult` and the **same**
    `FhirNode` model as `parseResource`: the root/contained element name → a synthetic `resourceType`;
    a primitive's `value` attribute → its value (kept as the exact lexical **string**: schema-free, no
    datatype guessed, precision never routed through a `number`); `id`/`extension` co-located as an
    `id` attribute + child `<extension>`s (the XML form of the JSON `_`-sibling); `Element.id` /
    `Extension.url` attributes → `id` / `url` properties; repeated elements → a list; a resource-valued
    element unwrapped to the inner resource. **Narrative `Narrative.div` (XHTML) is carried opaquely as
    its full serialized string** (the representation FHIR JSON uses), so it round-trips as conformant
    `<div>…</div>`, never dropped or escaped into an attribute. Lenient (Postel): an unexpected namespace
    or stray character data is preserved-and-flagged (new value-free issue code `UNEXPECTED_XML_CONTENT`),
    never rejected.
  - **Model → FHIR XML** (`serializeResourceXml`). The spec-clean inverse: compact, canonical FHIR XML
    that round-trips a spec-clean document **byte-for-byte**. Decimals emit from exact lexical text
    (never a `number`, ADR 0001); `Resource.id` → child `<id>`, `Element.id` → attribute,
    `Extension.url` → `url` attribute; control characters escaped round-trip-safe.
  - **JSON↔XML equivalence** (`nodesEquivalent`): the "same resource in XML and JSON parses to the
    same model" oracle, defined **modulo** the two irreducible schema-free ambiguities and only those:
    primitive lexical form (native `true`/number tokens ≡ `value`-attribute strings) and singleton
    lists (an array-of-one ≡ a single repeated element). Property names/order, nesting, `id`, and
    extensions must otherwise match exactly.
  - **Deferred, fail-safe intact:** the XHTML **structure** inside `Narrative.div` is not modeled or
    validated (carried as an opaque string, the JSON codec's fidelity, never dropped); typed
    cross-format _transcoding_ (spec-clean JSON booleans/numbers from an XML-sourced model) needs the
    datatype schema and is out of this phase; an extension-only element with no value reads as a
    primitive (value-absent-primitive vs complex-with-only-an-extension is a schema-free ambiguity,
    documented on `nodesEquivalent`, the safe direction, no data lost); RDF/Turtle is out of scope; the
    XML-fuzz differential vs `validator_cli.jar` is Phase 11.

- **Invariants via a bounded, vendored FHIRPath subset (Phase 7).** The sixth-and-final validation
  layer: evaluate a profile's `constraint[]` (FHIRPath invariants) against an instance. Per ADR 0002
  this is a **capped, in-repo FHIRPath subset**: no runtime dependency, no full third-party engine.
  Every finding stays **value-free** (a code + a FHIRPath location + the constraint `key`, never an
  instance value).
  - **The engine**: a real lexer → parser → evaluator (`tokenize`, `parseFhirPath`, `evaluateInvariant`)
    over the generic model. It implements the FHIRPath the R4 / US Core invariant set actually uses:
    path navigation (including choice access, `value` → `valueQuantity`), `$this` / `%resource` /
    `%context`; `exists` / `empty` / `not` / `where` / `all` / `select` / `count` / `first` / `last` /
    `distinct` / `hasValue` / `children` / `extension` / `intersect`; three-valued `and` / `or` /
    `xor` / `implies`; `=` / `!=` / `<` / `>` / `<=` / `>=` / `in` / `contains` / `|`; and `is` / `as` /
    `ofType` on the System primitive types. A constraint is judged by the reference validator's
    boolean coercion (an empty result is a violation, never a silent pass). Public types: `Expr`,
    `Token`, `TokenType`, `FpItem`, `FpColl`, `InvariantResult`, plus `convertToBoolean`.
  - **Fail-safe is non-negotiable**: any construct outside the subset (arithmetic, string functions,
    `descendants()`, `resolve()`, a FHIR-type `is`/`as`, an unknown operator) raises
    `UnsupportedFhirPathError`, and the invariant is reported **`INVARIANT_UNCHECKED` (`information`)**:
    surfaced, **never assumed to pass** (roadmap §6). Lazy `where`/`select`/`all` criteria mean an
    unsupported sub-term over an empty collection (e.g. `dom-3` on a resource with no `contained`)
    never fires, so common base constraints still evaluate cleanly.
  - **Wired into validation**: `collectInvariantIssues` reads `constraint[]` off each supplied
    profile's snapshot (constraints now parsed by `loadStructureDefinition` and accumulated down the
    derivation chain by `generateSnapshot`), evaluates them against the resource (root-level) or each
    present occurrence (nested), and emits `INVARIANT_VIOLATED` (severity mirroring the constraint's
    `error` | `warning`) or `INVARIANT_UNCHECKED`. Runs inside `validateResource(resource, { profiles })`.
    New public code `INVARIANT_UNCHECKED`; new type `ElementConstraint`.
  - **Safety-layer division of labour**: the seven named safety invariants (`ait-1`/`ait-2`,
    `con-3`/`con-4`/`con-5`, `obs-6`/`obs-7`) remain owned by the always-on Phase-3 safety layer (they
    fire with or without a supplied profile); the generic engine skips those keys to avoid a duplicate
    finding and covers every **other** constraint (base `ele-1` / `dom-*`, `us-core-*`, vendor
    invariants). The engine's agreement with the reference validator on the named safety expressions is
    proven directly against `evaluateInvariant`.
  - **Deferred (still `PROFILE_SLICE_UNCHECKED`, fail-safe intact):** the `type` / `profile` slicing
    discriminators and reslicing (they need per-occurrence type carriage / recursive profile
    resolution); the bundled US Core IG corpus + `validator_cli.jar` differential (Phase 11).

- **StructureDefinition + US Core profile validation (Phase 6).** A StructureDefinition-driven profile
  layer: the sixth validation layer (structure → cardinality → value-domain → terminology →
  **profile** → invariant). Like the terminology layer it ships the **engine, not the content**: a
  caller supplies the US Core (or vendor) `StructureDefinition`s and **nothing is bundled**. Every
  finding stays **value-free** (a code + a FHIRPath location, never an instance value).
  - **StructureDefinition model + loader**: `loadStructureDefinition` reads a profile out of the
    generic model (identity, `derivation`, `baseDefinition`, `differential` / `snapshot`, and
    per-element cardinality, `mustSupport`, `type`, `binding`, `slicing`, `fixed[x]` / `pattern[x]`).
    Public types: `StructureDefinition`, `ElementDefinition`, `Slicing`, `Discriminator`,
    `DiscriminatorType`, `TypedValue`, and `DISCRIMINATOR_TYPES` (the R4 discriminator set, with
    **`position` R5-only and excluded**).
  - **Snapshot generation**: `generateSnapshot` / `snapshotElements` walk `baseDefinition` and merge
    the differential onto the base snapshot: matched elements tightened by id, slices inserted, base
    elements preserved in order. Fails closed with `FhirProfileError` on an unresolvable base or a
    `baseDefinition` cycle. A profile that already carries a snapshot is used as-is.
  - **Slicing**: `resolveSlices` / `matchSlices` assign each occurrence of a sliced element to a
    slice by its discriminators (`value` / `pattern` against the slice's `fixed`/`pattern`; `exists`
    against slice cardinality). What needs a FHIRPath engine (`type` / `profile` discriminators, R5
    `position`, empty/insufficient discriminators) is reported `PROFILE_SLICE_UNCHECKED`
    (`information`): **never silently passed**. An unmatched occurrence under `closed` slicing is
    `PROFILE_SLICE_UNMATCHED` (error); a missing required slice is `CARDINALITY_MIN`.
  - **`fixed[x]` vs `pattern[x]`**: `matchesFixed` (exact equality, nothing extra) vs `matchesPattern`
    (subset, extras allowed); decimals compared precision-exactly through `FhirDecimal`, never a
    float. Mismatches are `PROFILE_FIXED_MISMATCH` / `PROFILE_PATTERN_MISMATCH` (error).
  - **Must-support as a system obligation**: an absent must-support element is `MUST_SUPPORT_ABSENT`
    at **`information`, never an error** (the roadmap's load-bearing rule: must-support obliges the
    sender to be able to populate and the receiver to tolerate absence. It is **not** instance
    presence). A bounded path navigator (`resolvePath` / `pathExists`) resolves element/discriminator
    paths without the Phase-7 FHIRPath engine.
  - **Multi-version**: `PROFILE_VERSION_MISMATCH` (warning) when a `meta.profile` `canonical|version`
    pin is carried by the supplied profile set at a different version. `collectProfileIssues` /
    `collectProfileVersionIssues` run inside `validateResource(resource, { profiles, resolveBase })`.
    The new issue codes (`PROFILE_SLICE_UNMATCHED`, `PROFILE_SLICE_UNCHECKED`, `MUST_SUPPORT_ABSENT`,
    `PROFILE_VERSION_MISMATCH`, `PROFILE_FIXED_MISMATCH`, `PROFILE_PATTERN_MISMATCH`) and the
    `business-rule` `IssueType` are snapshot-pinned. A rename is breaking.
  - **Known limitations (deferred):** no bundled multi-version US Core IG corpus and no
    `validator_cli.jar` differential (a JVM dev/CI job, Phase 11); the `type` / `profile`
    discriminators, reslicing, and invariant `constraint`s need the FHIRPath subset (Phase 7);
    profile-declared bindings are covered by the Phase-5 terminology layer, not re-enforced here.
- **Terminology binding validation: strength-aware, content-free (Phase 5).** Validate the codes on
  **bound** elements by their `system` and binding **strength**, without vendoring any SNOMED / CPT /
  LOINC / RxNorm content (roadmap §5). Every finding stays **value-free**, and **no false error is
  ever raised without a terminology service** (roadmap §5 fail-safe).
  - **Frozen known-systems registry**: `KNOWN_SYSTEMS` / `isKnownSystem`, the roadmap §5 verified
    `system` URIs (LOINC, SNOMED CT, RxNorm, ICD-10-CM, ICD-9-CM, CPT, UCUM, NDC, CVX) as
    **identities, not content**. The open-question URIs (ICD-10-PCS, HCPCS; roadmap §10) are
    deliberately **omitted**: an unknown system reads as a safe, non-erroring degrade, never a guess.
  - **Binding-strength severity**: `required` → error, `extensible` → error-unless (error on a
    definitive not-in), `preferred` → warning, `example` → information (an example binding can
    **never** error: rebinding an example code cannot fail). `BindingStrength`,
    `TERMINOLOGY_BINDINGS`, `buildBindingRegistry`, `BINDING_STRENGTHS` are the public surface.
  - **Content-free system checks**: a **known** system the value set does not draw from is
    `CODE_SYSTEM_UNEXPECTED` (strength-scaled: a `warning` for extensible/preferred, since a code
    from another system may be a justified extension; an `error` for required); an **unknown** system
    is `CODE_SYSTEM_UNKNOWN` (`information`, never a defect: a local system is not invalid).
  - **Value-set identities + multi-system elements**: the roadmap-named bindings ship built in:
    `AllergyIntolerance.code` (extensible, **RxNorm + SNOMED**, both accepted on the one element,
    roadmap §4.3) and `MedicationRequest`/`MedicationStatement.medicationCodeableConcept` (extensible,
    **RxNorm**). `ALLERGY_SUBSTANCE_VALUESET` / `MEDICATION_VALUESET` name the VSAC value sets.
  - **Pluggable terminology-service interface**: `TerminologyService`, `CodeValidationRequest`,
    `CodeValidationResult`, `CodeMembership`: the one seam through which value-set **content** enters
    the library, and **none is bundled**. Membership (`CODE_NOT_IN_VALUESET`) is checked only when a
    service is supplied and definitively answers `not-in`; an `"unknown"` answer (or **no service at
    all**) emits nothing and degrades to the content-free system checks. The service receives only
    identities (value-set URL + `system` + `code`), never a resource or a value.
  - `collectTerminologyIssues` runs inside `validateResource`; `validateResource(resource, {
terminology, bindings })` supplies a service and/or extra bindings (mirroring Phase 2's `schemas`).
    The new issue codes `CODE_SYSTEM_UNKNOWN` / `CODE_SYSTEM_UNEXPECTED` / `CODE_NOT_IN_VALUESET` (all
    `code-invalid`) are snapshot-pinned. A rename is breaking. **Known limitation:** without a
    supplied terminology service there is **no code-validity / value-set-membership** guarantee beyond
    `system` + strength (no content is bundled, roadmap §5); per-element US Core binding coverage,
    profiles (Phase 6), FHIRPath invariants (Phase 7), and XML (Phase 8) remain deferred.
- **Quantity / UCUM fidelity: results & doses (Phase 4).** The third strand of the P0 safety spine
  (codec · status/negation · units): surface a measured value by the type it actually is, and its unit
  by the code that a machine may act on. Every finding stays **value-free**, and **no unit is ever
  converted** (roadmap §4.6/§4.4).
  - **`readObservationValue(observation)`** discriminates the **11-way `Observation.value[x]` choice**
    (`valueQuantity` · `valueCodeableConcept` · `valueString` · `valueBoolean` · `valueInteger` ·
    `valueRange` · `valueRatio` · `valueSampledData` · `valueTime` · `valueDateTime` · `valuePeriod`)
    by the variant actually present, **never assuming `valueQuantity`**. A `valueString` of `"POSITIVE"`
    or a titer `valueRatio` of `1:64` is returned as its real type with `quantity: undefined`, so it
    can never be read as a number. `OBSERVATION_VALUE_TYPES` is the pinned variant set. Works on a
    `component.value[x]` too (blood-pressure panels discriminate).
  - **The unit that matters is the UCUM `code`, not the `unit` string.** `readQuantity` keeps `code` /
    `system` / `unit` / `comparator` / (exact-decimal) `value` distinct; `validateUcumShape` checks a
    code's **shape** (case-preserving, bracket-balanced) without asserting membership (no UCUM content
    is bundled, roadmap §5). The **vital-signs required-unit table** (`VITAL_SIGN_UNITS`,
    `requiredVitalSignUnits`) is the FHIR profile's closed set (weight `g|kg|[lb_av]`, height/head-circ
    `cm|[in_i]`, temp `Cel|[degF]`, HR/RR `/min`, BP `mm[Hg]`, SpO2/O2-sat `%`, BMI `kg/m2`).
  - **Dose `Quantity`**: `readMedicationDoses` / `locateDoseQuantities` surface
    `Dosage.doseAndRate.doseQuantity` for `MedicationRequest` (`dosageInstruction`) and
    `MedicationStatement` (`dosage`), UCUM-shape-checked the same way (a wrong dose unit is a
    prescribing hazard).
  - **`interpretation` and `referenceRange` preserved and surfaced**: `readInterpretations` (the
    H/L/HH flags) and `readReferenceRanges` (population-qualified bounds as `Quantity`s). Surfaced,
    **never evaluated**: Phase 4 does not compute an abnormal flag from a value and a range.
  - **New issue vocabulary:** `UCUM_UNIT_UNRECOGNIZED` (`warning` / `value`: a UCUM-declared unit that
    is absent or malformed; preserved verbatim, never converted), `VITAL_SIGN_UNIT_NONCONFORMANT`
    (`error` / `code-invalid`: a vital-signs value whose UCUM `code` or `system` the profile forbids,
    compared on the **`code`**, never the display string), and `VALUE_TYPE_UNEXPECTED` (`warning` /
    `value`: a vital sign whose value is present but not a `Quantity`). `collectQuantityIssues` runs
    inside `validateResource`. The registries stay snapshot-pinned; a rename is breaking. **obs-6**
    (`dataAbsentReason` ⇔ `value[x]` mutual-exclusion) is already enforced by the Phase-3 safety layer.
  - **Never a false error.** The vital-signs check fires only when the element declares the vital-signs
    category (or the vital-signs profile) **and** its own LOINC code is in the closed table; a quantity
    that declares no UCUM system is legal FHIR and is not flagged. Per-directory ≥90 coverage extended
    to `src/quantity/`.
  - **Still deferred:** unit _conversion_ and reference-range _evaluation_ (surfaced, never computed);
    terminology binding (Phase 5), profile / US Core (Phase 6), the general FHIRPath engine (Phase 7),
    XML (Phase 8). A consumer can trust _reads_ after this phase.
- **Safety-critical status & negation model: the fail-closed core (Phase 3).** Surfaces FHIR's
  modifier (`?!`) elements so they can never be silently dropped or inverted, and enforces the
  invariants that harm a patient when read wrong (roadmap §4). All findings stay **value-free**.
  - **`readSafety(resource)`**: a never-droppable readout of the modifier / status / negation
    elements across the six safety resource types (AllergyIntolerance, Condition,
    MedicationRequest/Statement, Observation, Immunization, DiagnosticReport): `status`,
    `clinicalStatus`, `verificationStatus`, `doNotPerform`, `retracted`, and a classified `negations`
    list (`refuted`, `no-known-allergy`, `do-not-perform`, `not-taken`, `not-done`,
    `entered-in-error`). SNOMED CT **`716186003` "no known allergy"** is a first-class negation, not
    an absent resource (which is _unknown_), and not an allergy _to_ the code.
  - **Fail-closed on an unknown `modifierExtension`.** FHIR's `?!` rule requires rejecting an element
    whose modifier the consumer does not understand; the library understands none yet, so **any**
    `modifierExtension` anywhere in **any** resource is `UNHANDLED_MODIFIER_EXTENSION` (error). The
    read side refuses too: `assertSafeToSummarize` throws `FhirSafetyError` (value-free, locations
    only) rather than flatten such a resource, the "carries status **or refuses**" contract.
  - **Named invariants**, hand-evaluated from their exact R4 FHIRPath: **`ait-1`/`ait-2`**
    (AllergyIntolerance), **`con-3`/`con-4`/`con-5`** (Condition), **`obs-6`/`obs-7`** (Observation),
    emitted as `INVARIANT_VIOLATED` carrying the constraint key (surfaced in
    `OperationOutcome.issue.details.text`). Severities mirror the spec: all `error` except the
    best-practice **`con-3` (`warning`)**, whose literal R4 expression is effectively vacuous (the
    `category.select($this='problem-list-item')` type-mismatch); we surface its documented _intent_ as
    a warning so it can never flip `valid`. A general FHIRPath engine is deferred to Phase 7 (ADR 0002).
    This phase hand-codes only the safety-critical set.
  - **`entered-in-error` surfaced as `RETRACTED_RESOURCE`** (information): a retracted record is not
    data, and must never be silently missed.
  - **New issue vocabulary:** `UNHANDLED_MODIFIER_EXTENSION`, `RETRACTED_RESOURCE`,
    `INVARIANT_VIOLATED`, and R4 issue types `invariant` / `not-supported` (the registries stay
    snapshot-pinned; a rename is breaking). A `constraint` field on `ValidationIssue` carries the
    invariant key (a public spec identifier, never PHI). Per-directory ≥90 coverage extended to
    `src/safety/`.
  - **Still deferred:** Quantity / UCUM fidelity (Phase 4), terminology binding (Phase 5), profile /
    US Core (Phase 6), the general FHIRPath invariant engine (Phase 7), XML (Phase 8). This layer
    surfaces and enforces; it never reconciles contradictions or infers clinical meaning.
- **Structural & cardinality validation + `OperationOutcome` (Phase 2).** The first three validation
  layers over the Phase-1 model, each finding **value-free** (a stable code, an R4 `IssueType`, and a
  FHIRPath `expression` location, never the offending value).
  - **Layer 1, structure:** `UNKNOWN_ELEMENT` (an element the schema does not define),
    `RESOURCE_TYPE_UNKNOWN`, `TYPE_MISMATCH` (a node whose shape is wrong for its datatype), and
    `CHOICE_AMBIGUOUS` (more than one `choice[x]` variant present).
  - **Layer 2, cardinality:** `CARDINALITY_MIN` (a required element absent) and `CARDINALITY_MAX`
    (an element past its maximum).
  - **Layer 3, value-domain:** `PRIMITIVE_INVALID` against the FHIR R4 primitive datatype regexes
    (`date`, `dateTime`, `instant`, `time`, `code`, `id`, `uri`, `oid`, `uuid`, `base64Binary`, and
    the JSON-number family validated from exact lexical text, never a float), and `CODE_INVALID` for
    a value outside a **required-strength** enumerated binding. `validatePrimitiveValue` and
    `PRIMITIVE_TYPES` are public.
  - **`OperationOutcome` output** (`toOperationOutcome`): a serializable, value-free resource model
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
    / `baseSchema` / `resolveElement`, with `choice[x]` support): the seam Phase 6 will feed from real
    StructureDefinitions. Ships with the base `Resource`/`DomainResource` elements plus a worked
    `Patient` schema; callers supply others via `validateResource(resource, { schemas: [...] })`.
  - **Stable public contract:** the `VALIDATION_CODES`, `ISSUE_TYPES`, and `ISSUE_SEVERITIES`
    registries are snapshot-pinned (a rename is breaking), with a PHI sweep over every emitted
    `OperationOutcome`. Per-directory ≥90 coverage extended to `src/validate/`.
  - **Still deferred:** terminology binding beyond required-code enumeration (Phase 5); profile /
    US Core / slicing / must-support (Phase 6); FHIRPath invariants (Phase 7).
- **JSON codec + typed primitive model: the no-data-loss core (Phase 1).** The first parsing code:
  a precision-preserving JSON reader, an immutable resource model, and a spec-clean serializer.
  - **`decimal` / `integer64` lexical precision (ADR 0001).** `FhirDecimal` and `FhirInteger64` are
    string-backed and never route a value through the JS `number` type. `0.010` stays `0.010`; a
    64-bit-range integer stays exact. `FhirDecimal` exposes precision-sensitive `equals` (the FHIR
    default: `0.010 ≠ 0.01`) alongside quantity-only `equalsValue`, plus `toBigInt` / `toNumber`
    (the latter deliberately lossy). The reader tokenizes JSON itself (`readRawJson`) because
    `JSON.parse` is non-conformant for FHIR decimals: it would corrupt them before any of our code
    runs.
  - **Primitive-extension (`_`-sibling) model with null-padded array alignment.** A primitive's
    value and its `id`/`extension` metadata are merged into one first-class `FhirPrimitive` node
    (modeled as a concept, not a literal `_`-key, so the Phase-8 XML codec inherits it, ADR 0003).
    Repeating primitives round-trip their value array and `_`-array index-aligned with `null`
    placeholders. A length mismatch **fails closed** (`PRIMITIVE_EXTENSION_MISALIGNED`) rather than
    guess which value an extension belongs to.
  - **Generic element model** (`FhirComplex` / `FhirList` / `FhirPrimitive`), immutable and
    wire-agnostic, preserving property order and resolving `resourceType` in any position. Plus
    `meta`/`contained` (preserved structurally) and a `parseReference` classifier
    (relative / absolute / logical / fragment).
  - **Value-free diagnostics (PHI-safe).** Issue codes `DECIMAL_PRECISION_AT_RISK` (information) and
    `UNKNOWN_PROPERTY` (warning), and fatal codes `MALFORMED_JSON` / `PRIMITIVE_EXTENSION_MISALIGNED`
    (`FhirCodecError`), all carrying a FHIRPath location or byte offset, never a resource value.
  - **Accuracy gate:** byte-identical round-trip golden files (trailing-zero decimals, values past
    2^53, primitive extensions, value-absent primitives), property-based round-trip + decimal-
    preservation suites (`fast-check`), immutability, a stable issue/fatal-code snapshot, and a
    PHI-in-diagnostics sweep. Per-directory ≥90 coverage gates (held at 0 during P0) are restored.
  - **Deferred to later phases (read-only surface today):** structural / cardinality / terminology /
    profile / invariant **validation** (P2, P5–P7): Phase 1 parses and preserves, it does not
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
  (`scripts/sync-version.mjs` + `test/sanity.test.ts`). No parse code in this phase: all parsing is
  deferred to Phase 1 and beyond (see `operations/roadmaps/fhir.md` in the meta-repo).
- **Four architecture ADRs** under `documentation/decisions/`:
  - `0001`: `decimal` / `integer64` are string-backed and MUST preserve lexical precision; they
    never round-trip through the JS `number` type.
  - `0002`: FHIRPath dependency posture: implement a bounded, vendored subset in-repo; no runtime
    dependency, no full third-party engine.
  - `0003`: JSON-first; XML serialization is deferred to Phase 8.
  - `0004`: R4 (`4.0.1`) is the modeled version (the ONC HTI-1 / §170.315(g)(10) anchor); R5 and
    DSTU2 are read-tolerance only.

[Unreleased]: https://github.com/cosyte/fhir/commits/main
