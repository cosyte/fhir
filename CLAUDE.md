# @cosyte/fhir: Project Guide for Claude

**▶ The narrative lives in [`documentation/agent-notes.md`](documentation/agent-notes.md)**: every
incident, every refuted gate pass, every shipped-phase history, verbatim and re-headed. This file
keeps the cursor, the rules, and every trap; each trap below points at the section there that
explains what it cost. Relocated 2026-08-04 (`CLAUDE-MD-AUDIT`, the 2026-08-04 amendment to the
meta-repo's `documentation/decisions/0023-doc-budgets.md`). **Never delete a trap to save bytes.
Move it there and leave the one-liner here.**

## Project

**`@cosyte/fhir`**: a developer-focused FHIR parser + utility library for Node.js/TypeScript,
published under the Cosyte brand. Open-source (MIT). The FHIR member of the cosyte parser suite; it
mirrors the API shape of `@cosyte/hl7`, the reference parser.

**North star:** A developer can read a real-world FHIR resource, model it with correct primitive
semantics, and validate it against US Core, without reading the FHIR spec.

## Status

- **Pre-alpha, unpublished on npm, and that is not missing work.** Every publish attempt is refused
  by npm with a bare `E403` on `PUT https://registry.npmjs.org/@cosyte%2ffhir` (`FHIR-NPM-NAME`,
  support request filed 2026-07-23, still open), so there is no git tag and no GitHub release.
  **Read the version from `package.json`, never infer it from npm**: it runs ahead of the registry.
  Why: [`agent-notes.md#publish-state-fhir-npm-name`](documentation/agent-notes.md#publish-state-fhir-npm-name)
  - **The "name-similarity" reading is RETRACTED. DO NOT RENAME OR RESCOPE THE PACKAGE ON IT.** npm
    has never named similarity or the unscoped `fhir` package in anything it returned. Provenance is
    signed and in rekor before the refusal, so it is not a signing failure; scope-level creation
    works (`transform`, `synth` and `cli` were created 2026-07-29 and `deid` 2026-07-30, all _after_
    the first refusal); and the refusal is identical across publish paths and account sessions.
  - **It is a HUMAN GATE, not work you can pick up.** The debug trace npm asked for is captured and
    hand-checked free of credential material; the only remaining step is the founder sending it.
  - **Do not generalise the error code across the three affected packages.** `E403` is `fhir`'s
    **publish** refusal, at policy, after CI is green and after provenance reaches the transparency
    log. `transform`'s is an **install** failure (`E404`); `synth`'s is an **install** failure
    (`ERESOLVE`), and it fails **despite** the peer being declared optional, so never re-derive from
    `peerDependenciesMeta` that it cannot. `deid` and `cli` are not blocked. **Publish state and
    installability are independent.**
  - **Never re-fire a version npm has already traced:** `0.0.2`, `0.0.3`, `0.0.7`, `0.0.8`.
  - **This repo is public and the uploaded npm debug-log artifact is downloadable**: re-check it by
    hand before ever linking one.
- **Phases 1–9 landed; P10 landed (halves a + b); P11's buildable tiers landed.** The package reads,
  round-trips and structurally validates R4 JSON **and** XML into one schema-free model;
  preserves decimal/`integer64` lexical precision; never drops a modifier, status or negation;
  surfaces measured values by their true `value[x]` type with UCUM-`code` fidelity; validates code
  systems and binding strength content-free; validates against caller-supplied
  `StructureDefinition`s (snapshot, slicing, fixed/pattern, must-support-as-obligation); evaluates
  `constraint[]` invariants through a bounded in-repo FHIRPath engine; models Bundles, reference
  resolution and streaming NDJSON; and gates itself with fuzz, PHI-leak and type-level test tiers.
  **Not** done: `type`/`profile` slicing discriminators and reslicing (`PROFILE_SLICE_UNCHECKED`),
  a bundled US Core IG corpus, the `validator_cli.jar` differential (authored, **CI-only**, never
  observed green in this container), value-set membership without a supplied terminology service,
  typed per-resource models, and transaction **execution** (a stated non-goal).
  **This is not a no-data-loss claim over the whole package, and the sentence above is base's own
  wording, not a fresh one**: read-path losses remain open and declared. A **status** or a dose
  number written as XML element text is dropped (reported, and the writer refuses, but the safety
  spine reads `negations: []`), which is the one that qualifies "never drops a modifier, status or
  negation"; so are a scalar beside a nested array (**still not modeled**, but since 2026-08-05 its
  text is preserved and handed back, so the finding survives a **JSON** round trip; through the XML
  writer it is still `<name/>` and both the value and the finding go), a `_`-sibling discarded
  whole, a foreign child
  of a valued primitive, character data at the three `flagStrayText` sites, an unbound prefix, and a
  `<DIV>` wrapper. See
  [`#left-open-deliberately-a-through-e`](documentation/agent-notes.md#left-open-deliberately-a-through-e)
  and [`#residuals-ii-to-iv-and-three-more-left-open`](documentation/agent-notes.md#residuals-ii-to-iv-and-three-more-left-open).
  Per-phase detail: [`#shipped-phase-history-p11-back-to-p1`](documentation/agent-notes.md#shipped-phase-history-p11-back-to-p1).
  Today's envelope, stated precisely: [`#p2-p3-and-what-the-package-does-today`](documentation/agent-notes.md#p2-p3-and-what-the-package-does-today).
- Roadmap: the meta-repo's `operations/roadmaps/fhir.md` (P0…P11).

## Traps

Every line here cost a defect or a refuted gate pass. The pointer is to
[`documentation/agent-notes.md`](documentation/agent-notes.md), which carries the measurement.

### The model and the safety spine

- **Never round-trip `decimal`/`integer64` through a JS `number`** (ADR 0001): silent corruption of
  doses, lab values and identifiers. `0.010` is not `0.01`.
- **A duplicate JSON property is first-wins ON PURPOSE. Do not "fix" it to last-wins**, which only
  moves the blind spot. The shadowed member is _kept_ (`FhirComplex.duplicates`) and _reported_, and
  `readSafety` **stops affirming** rather than picking better. It once lost an
  `entered-in-error` retraction and reported `safeToSummarize: true`.
  [`#fhir-duplicate-key-retraction-2026-07-28`](documentation/agent-notes.md#fhir-duplicate-key-retraction-2026-07-28)
- **Never widen `SAFETY_SCALAR_ELEMENTS` casually.** It is the cardinality of the closed set the
  safety layer already reads, **not** a per-resource model; a name-only, depth-free rule emits a
  false error on a conformant document (`Questionnaire.code` and `ElementDefinition.code` are `0..*`
  in R4). Pinned by `test/array-wrapped-scalar.test.ts`, not by prose.
  [`#fhir-array-wrapped-scalar-2026-07-28`](documentation/agent-notes.md#fhir-array-wrapped-scalar-2026-07-28)
- **THE READ WINDOW AND THE REPORT WINDOW MUST BE THE SAME WINDOW. If you ever widen the coding
  unwrap, widen `checkCodingWrapping` first, in the same change.** Unwrapping inside `codingsOf`
  erased a true `VITAL_SIGN_UNIT_NONCONFORMANT` and flipped a document to `valid: true` with zero
  diagnostics: the one direction the fail-safe contract forbids.
  [`#fhir-coding-scalar-wrapper-2026-07-29`](documentation/agent-notes.md#fhir-coding-scalar-wrapper-2026-07-29)
- **Never let any rule yield more than one value on either side of `codingsOf`'s `system`×`code`
  cross-product**: it manufactures a pair the sender never wrote, and `NO_KNOWN_ALLERGY` is the one
  negation that is a _positive clinical assertion_. Count array **positions**, not strings: a FHIR
  JSON `null` is a real position. Two attempts were refuted for exactly this.
  [`#fhir-array-wrapped-scalar-2026-07-28`](documentation/agent-notes.md#fhir-array-wrapped-scalar-2026-07-28) ·
  [`#fhir-coding-scalar-wrapper-2026-07-29`](documentation/agent-notes.md#fhir-coding-scalar-wrapper-2026-07-29)
- **Do not "fix" the un-type-gated `isRetracted`/`readSafety` reads by type-gating them**: they can
  only _add_ a negation, never retire a finding or flip `valid`.
  [`#fhir-coding-scalar-wrapper-2026-07-29`](documentation/agent-notes.md#fhir-coding-scalar-wrapper-2026-07-29)
- **Reporting is additive to diagnostics; preserving is a change to the data model, and only the
  second carries the risk. If your change makes a nested array visible to any walker, you have
  crossed the line.** Measured at `b2c5ee7`: 57 `.items` sites across 21 files, 3 flattening with no
  kind check at all and 21 checking the kind then silently dropping what is not it; exactly one fails
  closed. The combined attempt was refuted twice (it erased a true error and asserted
  `noKnownAllergy`). The inner array is kept as inert **text** (`nestedArraySource`), never modeled
  as an element.
  [`#fhir-nested-array-reporting-2026-07-29`](documentation/agent-notes.md#fhir-nested-array-reporting-2026-07-29) ·
  [`#fhir-nested-array-preservation-2026-07-29`](documentation/agent-notes.md#fhir-nested-array-preservation-2026-07-29)
- **Read `test/model-edges.test.ts` before you add a field to the model.** It derives the node-valued
  edge set mechanically from the three interfaces of the `FhirNode` union (exactly four node-valued
  members), so a new node-valued field
  reds a test instead of silently redefining what a repeating element contains.
- **Bounding a derived name is a shape test, not a truncation**, and the mechanism lives in
  `src/model/path.ts` and nowhere else. `FhirComplex.properties[].name` stays exactly as the document
  wrote it. **The `hl7`/`deid` model-level lesson does NOT transfer**, because bounding those
  would be data loss. **No claim is made anywhere that a location never carries document content; do not
  add one.** A forgery shaped like a FHIR name is still echoed.
  [`#phi-warning-message-leak-2026-08-02`](documentation/agent-notes.md#phi-warning-message-leak-2026-08-02)
- **A PHI sweep over leaf values is not a PHI sweep.** `phi-leak.test.ts` swept values only, which is
  why a 1,000,000-byte property name, which produced a 1,000,011-byte `expression`, survived it.
  Sentinels must cover names.

### The XML reader

Unless noted, all of these are
[`#fhir-reader-residuals-2026-08-02`](documentation/agent-notes.md#fhir-reader-residuals-2026-08-02).

- **AN EXPANDED NAME IS A NAMESPACE _AND_ A LOCAL NAME (Namespaces in XML 1.0 §6.1). Never make a
  resolved local name reachable without comparing the namespace it came from.** Grouping on the
  local name merged vendor content into the FHIR element beside it: a true error erased and `valid`
  flipped `false → true`, `noKnownAllergy` asserted over a record naming an allergen, a retraction
  lost, and the whole thing laundered on re-emit.
- **"Foreign content keeps its tag verbatim" only separates anything when the tag carries a prefix.**
  A default `xmlns` has no prefix to keep. The _separation_ covers prefixed content; the **flag** is
  what covers the unprefixed half. Every element the reader **models** must be tested by `isForeign`
  exactly once: route new branches through `readNested`.
- **In this reader, "every element" is never the right subject of a sentence. Name the set the code
  actually walks.** Three passes of one slice were refuted for a universal written wider than the
  code, one of them shipped in `.d.ts`.
- **Count the call sites, and the writers, before you write "one" or "everywhere else."** Refuted
  twice on the reader (`UNEXPECTED_XML_CONTENT` is three lossy sites, not one; the de-dup is one call
  site of four) and once on the write path (the JSON writer was the worse of the two and was
  unrecorded). [`#fhir-element-text-recovery-2026-08-03`](documentation/agent-notes.md#fhir-element-text-recovery-2026-08-03)
- **The root is the one element with its own rule**: a document declaring **no** namespace is still
  read as FHIR and still unflagged. **Do not "tighten" that into a refusal**, and do not "fix" the
  leaves-its-parent's-namespace flag into a per-element one.
- **Take the narrative before the resource-valued unwrap.** `isResourceName` is FHIR vocabulary and
  means nothing inside XHTML; applied there it read `<BR/>` as a contained resource and **destroyed
  clinical prose with zero diagnostics under `valid: true`**, laundering on re-read. The narrative is
  recognised by its **expanded** name `{http://www.w3.org/1999/xhtml}div`.
- **On the narrative branch, "did a finding disappear" is the wrong question.** Compare the same
  document spelled the other way (394 of 396 twin pairs identical, 2 louder, **0 weaker**). Re-run
  `pnpm differential:read` (`scripts/read-differential.ts`) if you touch it.
- **Do not answer a duplicate reaching the vital-signs unit check via `category.coding` by widening
  the cardinality table**. See the closed-table trap above.
- **Do not cite ADR 0018 to block a refusal; cite it to block a tolerance.** Refusing to affirm
  recognises nothing and invents nothing. _Recovering_ element text as a primitive value is a
  tolerance for a non-conformant encoding, and **two grounding searches have now failed**, so it
  stays unbuilt. Do not re-run that search blind; read the negative result first.
  [`#fhir-primitive-as-element-text-2026-08-03`](documentation/agent-notes.md#fhir-primitive-as-element-text-2026-08-03)
- **Do not declare a differential twin for a shape the reader still does not read**: the twin
  section requires `valid`/`safeToSummarize` to match, so it scores a refusal as _weaker_ for doing
  the right thing. Score a refusal base-vs-head.
- **If the harness's negative control fires, suspect it first.** It was a permanent false red once,
  hard-coded to a change that had merged. It must name the change under measurement and compare the
  **whole** reading, not just `json`.
- **If you add a writer refusal, check what the harness does with it before you trust a zero**: it
  reported 5,159 phantom leaf losses, and the leaf comparison now **skips** a refused document. **A
  slice that changes the reader _and_ adds a refusal has a real blind spot there**; measure the
  reader change separately.
- **Two prefixes bound to the FHIR namespace are two spellings of one name, and reading them as one
  element WIDENS the read window: report it or drop the grouping.** Reporting was taken
  (`MIXED_XML_SPELLING`, plus `ARRAY_WRAPPED_SCALAR` at a safety-scoped element), because dropping
  means two properties of one model name in one `FhirComplex` and **the XML reader has no
  `duplicates` mechanism**, so it would be a silent first-wins loss: strictly worse.
- **That report compares the EXPANDED NAME, not the tag alone** (2026-08-05). **Do not write down how
  many shapes reach it**: that docblock said "two routes" while its own corpus exercised four. The
  rule is the comparison. Two read as conformant: a prefix rebound between siblings, and a `<div/>`
  in the FHIR namespace joining `Narrative.div`. The second used to read back with **zero**
  diagnostics and `valid: true` over a `0..1` slot; it now draws this report, and no other. **Do not
  narrow it back to `element.name`**, and **state the predicate, not which documents come out of
  it**: three gate passes running refuted a summary of that set, which depends on the parent's
  namespace. Closed for the READ only: `serializeResourceXml` drops the bindings.
  [`#fhir-writer-authors-values-2026-08-05`](documentation/agent-notes.md#fhir-writer-authors-values-2026-08-05)
- **Declared open residuals**, among others recorded in the notes. Do not fold one into an unrelated
  slice, and do not restate a gap as a claim. **Pinned by a test:** the `_`-sibling discarded whole,
  the **unbound** prefix, the `<DIV>` wrapper, `.@name`, the array-wrapped `value[x]`, the §2.6.1
  value-absent primitive, the foreign-root laundering (`test/xml.test.ts`, "declared residuals,
  pinned so they cannot move in silence"), and the cross-format singleton-wrapper laundering
  (`test/array-wrapped-scalar.test.ts`). **Each of those is a characterization test over a gap:
  CLOSING one MUST red it, in the same change.** Not theoretical: the closures below red three of
  them on the spot, which is the mechanism working.
  **"Pinned by a test" is load-bearing prose, so never write it without opening the test**: three
  such sentences were false for days, and the next reader does not re-check.
  - **CLOSED 2026-08-05:** the scalar beside a nested array, and the prefix rebound between siblings
    **on the read**. The rebound prefix keeps a characterization test over the half still open: the
    report does not survive `serializeResourceXml`, which drops the binding.
  - **STILL OPEN, deliberately deferred:** `serializeResourceXml` emits a prefixed foreign property
    with the prefix **unbound**, so the output is not namespace-well-formed and the binding is lost.
    It was never modeled, so the remedies are to model it or to refuse a shape that reads `valid:
true` today. Both are larger than the defect.
    [`#residuals-ii-to-iv-and-three-more-left-open`](documentation/agent-notes.md#residuals-ii-to-iv-and-three-more-left-open) ·
    [`#singleton-wrapper-laundering`](documentation/agent-notes.md#singleton-wrapper-laundering) ·
    [`#left-open-deliberately-a-through-e`](documentation/agent-notes.md#left-open-deliberately-a-through-e)
- The raw XML reader is **XXE- and billion-laughs-proof by refusal**: any `<!DOCTYPE` is
  `DTD_FORBIDDEN`, any entity beyond the five predefined + numeric character references is
  `UNDEFINED_ENTITY`, no I/O, no URI resolution, bounded depth. **Do not relax that into resolution.**

### Terminology, profiles, invariants

The layer-by-layer detail behind all of these, including the full binding-strength severity table
and the 11-way `Observation.value[x]` choice, is in
[`#shipped-phase-history-p11-back-to-p1`](documentation/agent-notes.md#shipped-phase-history-p11-back-to-p1).

- **No terminology content is vendored.** `KNOWN_SYSTEMS` holds the verified `system` URIs as
  _identities_ only (ICD-10-PCS/HCPCS deliberately omitted). With no `TerminologyService` supplied,
  checks degrade to the content-free system level and **never false-error**.
- **Binding strength drives severity**: `required` error, `extensible` error-unless, `preferred`
  warning, **`example` information and never an error.**
- **`MUST_SUPPORT_ABSENT` is information, never error**: must-support is a system obligation, not
  instance presence.
- **The `position` discriminator is R5-only and excluded.** An unsupported or insufficient
  discriminator emits `PROFILE_SLICE_UNCHECKED`, **never a silent pass.**
- **Any FHIRPath expression outside the vendored subset emits `INVARIANT_UNCHECKED`**: surfaced,
  **never assumed to pass.** The seven named safety invariants (`ait`/`con`/`obs`) stay owned by the
  always-on Phase-3 safety layer.
- **The machine-actionable unit is the UCUM `code`, not the `unit` string**, shape-checked but
  **never converted**. `readObservationValue` branches on the present `value[x]` type: a
  `"POSITIVE"` string or a `1:64` titer is never read as a number.
- **No profile content is bundled**; US Core / vendor `StructureDefinition`s are caller-supplied.
- **A vendor quirk is encoded only when a real, publicly-cited artifact grounds it** (ADR 0018). A
  genuinely proprietary deviation absent from every public sample stays grounded-only. Never invent
  a fixture.

### Tooling and process

- **`attw` must stay `node scripts/attw.mjs`, never the bare CLI** (`ATTW-FALSE-GREEN-PORT`, ported
  from `terminology`). `@arethetypeswrong/cli@0.18.4` prints "This package does not contain types."
  and exits **0** before reading the problem list, turning a broken publish into a pass, and `tsup`
  opens a measured 1.86–2.46 s window in every build where `dist/` holds JS and no `.d.ts`. **The
  gate takes two arms and a name match alone is not enough** (`-fjson` / `-Pfjson` carry their value
  attached); **do not simplify the short-cluster arm back to the name set.** Re-read the section when
  you bump the pin. **`scripts/verify.sh` in the meta-repo needs no change and must not be touched.**
  [`#attw-false-green-port`](documentation/agent-notes.md#attw-false-green-port)
- **Two refuter passes max, then one narrow third against the remedy diff only. No fourth**
  (ADR 0016). A sub-problem that fails to converge twice gets **reverted and declared a gap**: a
  pure revert ships no ungraded behaviour, and a declared gap is not a claim.
- **The gates run on the strongest model**, always (ADR 0009/0024). Never set
  `CLAUDE_CODE_SUBAGENT_MODEL`: it silently overrides every refuter pin.

## Tech Stack (the shared `@cosyte/*` standard)

fhir inherits the canonical toolchain by depending on the published `@cosyte/*` config packages, not
by copying files. The source of truth is the meta-repo's `documentation/conventions.md`. This is a
summary.

- **Language:** TypeScript (strict, full rigor set incl. `noUncheckedIndexedAccess`) via
  `@cosyte/tsconfig`. **Target ES2023**, `NodeNext`.
- **Build:** dual ESM + CJS + `.d.ts` via `tsup` (`@cosyte/tsup-config`); `attw` is a publish gate.
  It runs through `scripts/attw.mjs`. See the trap above.
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
  inside an array, **a scalar or `null` where FHIR JSON has an object**, a non-string `resourceType`),
  because repairing any of them means inventing content or dropping it. The middle one was the
  **fabrication** route, closed 2026-08-05: the writer emitted `{}`, which re-reads clean, so the
  `UNKNOWN_PROPERTY` was gone after one round trip. Hand the value back
  (`FhirComplex.nonObjectSource`); **never model it as a primitive**, which would show it to every
  walker at a complex position.
  [`#fhir-writer-authors-values-2026-08-05`](documentation/agent-notes.md#fhir-writer-authors-values-2026-08-05)
- Diagnostics are **value-free by contract**: an `IssueCode` plus a FHIRPath expression. **That is
  not a claim that a location carries no document content** (a name is echoed when it matches the
  bounded published form). See the derived-name trap above, and do not widen it into one. **The
  other half of that claim is scoped too and must stay scoped**: the JSON reader's `expression` no
  longer carries English prose, NOT that every `expression` is resolvable FHIRPath. A `<withheld>`
  segment and the XML reader's `.@name` attribute form are deliberately **admitted** by
  `test/expression-grammar.test.ts` rather than hidden.
- **Deliberate omissions, each of which reads as an oversight and is not.** `markNestedArray` and
  `markDroppedText` are reader-internal and **deliberately not exported**. `typeOf` stays the strict
  single-value read, because a structural verdict should **reject** an unreadable type, not guess
  one (only `readSafety` considers every type the document names). The writer emits **one member per
  repeated name**, deliberately, because emitting both members a duplicated name wrote would be
  invalid FHIR
  ([`#fhir-duplicate-key-retraction-2026-07-28`](documentation/agent-notes.md#fhir-duplicate-key-retraction-2026-07-28)).
  The element-text refusal fires even when
  text sits beside a value that arrived, and **do not justify that arm with "content the sender
  wrote is still missing"** (the gate broke that sentence in one query with
  `<status value="final">final</status>`); the honest reason is that the rule keys on the reader
  dropping character data and never compares text to value. The two defensive `rootPath` calls in
  the terminology layer and the dose locator are provably the identity where observable, and the
  gate **deliberately does not pretend to cover them**.
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
4. **No internal project bookkeeping on a public surface** (founder directive, 2026-07-27). Item
   identifiers (`FHIR-P10`), phase/wave language, ADR numbers and meta-repo paths belong in the
   changeset, `CHANGELOG.md`, the commit, the PR and the roadmap, never in what a consumer is
   _shown_. It is a **translation** at the boundary, not a deletion: repair the head of a line you
   strip an identifier off. Gated by `pnpm check:no-internal-refs`. Why, and what the gate does not
   cover:
   [`#no-internal-project-bookkeeping-on-a-public-surface`](documentation/agent-notes.md#no-internal-project-bookkeeping-on-a-public-surface)
   - Doc comments and string literals are **gated** (they reach the consumer's editor and logs);
     `//` and `/* */` comments are **not**, and identifiers **belong** there. **Do not justify that
     boundary from what reaches `dist/`**: everything in `src/` does. **Removing a doc comment to
     satisfy the gate is a regression, not a fix.**
   - **There is deliberately no `slice` rule in this copy**: `slice` is R4 vocabulary here
     (`ElementDefinition.slicing`), measured at 41 matches with one of them ours. **Do not paste the
     sibling rule back without re-measuring.**
   - Two holes are open on purpose (`FHIR-P10b`-style suffixes; trailing `phase`) and `CHANGELOG.md`
     is deliberately not scanned. The reviewer owns half the rule.
