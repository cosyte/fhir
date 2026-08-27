# @cosyte/fhir: Project Guide for Claude

**▶ The narrative lives in [`documentation/agent-notes.md`](documentation/agent-notes.md)**, verbatim
and re-headed (2026-08-04, `CLAUDE-MD-AUDIT`, amending the meta-repo's `decisions/0023-doc-budgets.md`).
Every trap here points at the section there that explains what it cost. **Never delete a trap to save
bytes. Move narrative there and leave the one-liner here.**

## Project

**`@cosyte/fhir`**: a developer-focused FHIR parser + utility library for Node.js/TypeScript.
The FHIR member of the cosyte parser suite; it mirrors the API shape of `@cosyte/hl7`, the
reference parser.

**North star:** A developer can read a real-world FHIR resource, model it with correct primitive
semantics, and validate it against US Core, without reading the FHIR spec.

## Status

- **Pre-alpha, unpublished on npm, and that is not missing work.** Every publish attempt is refused
  by npm with a bare `E403` on the scoped `PUT` (`FHIR-NPM-NAME`, support request open since
  2026-07-23), so there is no git tag and no GitHub release.
  **Read the version from `package.json`, never infer it from npm**: it runs ahead of the registry.
  Why: [`agent-notes.md#publish-state-fhir-npm-name`](documentation/agent-notes.md#publish-state-fhir-npm-name)
  - **The "name-similarity" reading is RETRACTED. DO NOT RENAME OR RESCOPE THE PACKAGE ON IT.** npm
    has never named similarity or the unscoped `fhir` package in anything it returned. The three
    evidence clauses moved to the notes 2026-08-07, and are not summarised again here:
    [`#fhir-npm-name-the-evidence-which-was-duplicated`](documentation/agent-notes.md#fhir-npm-name-the-evidence-which-was-duplicated).
  - **It is a HUMAN GATE, not work you can pick up.** The trace npm asked for was hand-checked free
    of credential material and sent 2026-08-05, so it waits on npm. **Leave it blocked.**
  - **Do not generalise the error code across the three affected packages; publish state and
    installability are independent.** Verbatim:
    [`#publish-state-fhir-npm-name`](documentation/agent-notes.md#publish-state-fhir-npm-name)
  - **Never re-fire a version npm has already traced:** `0.0.2`, `0.0.3`, `0.0.7`, `0.0.8`.
  - **This repo is public and the uploaded npm debug-log artifact is downloadable**: re-check it by
    hand before ever linking one.
- **Phases 1–9 landed; P10 landed (halves a + b); P11's buildable tiers landed.**
  **▶ IT IS NOT A NO-DATA-LOSS CLAIM OVER THE WHOLE PACKAGE**: read-path losses remain open and
  declared, and the one that qualifies "never drops a modifier, status or negation" is a **status**
  or a dose number written as XML element text (dropped and reported, the writer refuses, but the
  safety spine reads `negations: []`). The envelope, today's precisely, the losses, what is left open
  and the per-phase history, all in `agent-notes.md`:
  [`#the-shipped-envelope-p1-through-p11`](documentation/agent-notes.md#the-shipped-envelope-p1-through-p11) ·
  [`#p2-p3-and-what-the-package-does-today`](documentation/agent-notes.md#p2-p3-and-what-the-package-does-today) ·
  [`#open-read-path-losses-enumerated`](documentation/agent-notes.md#open-read-path-losses-enumerated) ·
  [`#left-open-deliberately-a-through-e`](documentation/agent-notes.md#left-open-deliberately-a-through-e) ·
  [`#shipped-phase-history-p11-back-to-p1`](documentation/agent-notes.md#shipped-phase-history-p11-back-to-p1)
- Roadmap: the meta-repo's `operations/roadmaps/fhir.md` (P0…P11).

## Traps

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
- **A TYPE GATE ON A NEGATION READ IS ITSELF THE DEFECT: IT NEVER LOOKS, SO IT REPORTS NOTHING
  EITHER.** Never re-gate an un-gated read: such a read only _adds_, never retires a finding or
  flips `valid`. `doNotPerform` gated on `MedicationRequest`, `not-done` on `Immunization`: each read
  `negations: []`/`safeToSummarize: true` on a **conformant** doc (both closed 2026-08-09). **DROP
  the gate, never widen it** (a longer list is the same mechanism). **A status CODE IS NOT AN
  ELEMENT: `doNotPerform` = direction ALONE; `not-done`/`not-taken` = R4 CENSUS FIRST** (only on
  `status`; the negation in EVERY system defining it) **- read SCOPED to `status`**.
  **`noKnownAllergy` is the opposite
  and stays gated: it asserts something POSITIVE about a patient.** **A read and its refusal are ONE
  function at ONE window**, or the fix reproduces the previous STOP-THE-LINE on the new types. The
  read runs at **every resource root**; the convenience field stays root-scoped like `status`; and
  **`safeToSummarize` does NOT move for a value that IS read.** What stays gated, and why:
  [`#fhir-coding-scalar-wrapper-2026-07-29`](documentation/agent-notes.md#fhir-coding-scalar-wrapper-2026-07-29) ·
  [`agent-notes/negation-read-scope.md`](documentation/agent-notes/negation-read-scope.md)
- **Reporting is additive to diagnostics; preserving is a change to the data model, and only the
  second carries the risk. If your change makes a nested array visible to any walker, you have
  crossed the line.** The combined attempt was refuted twice (it erased a true error and asserted
  `noKnownAllergy`). The inner array is kept as inert **text** (`nestedArraySource`), never modeled
  as an element.
  [`#fhir-nested-array-reporting-2026-07-29`](documentation/agent-notes.md#fhir-nested-array-reporting-2026-07-29) ·
  [`#fhir-nested-array-preservation-2026-07-29`](documentation/agent-notes.md#fhir-nested-array-preservation-2026-07-29)
- **Read `test/model-edges.test.ts` before you add a field to the model.** It derives the node-valued
  edge set mechanically from the three interfaces of the `FhirNode` union (exactly four node-valued
  members), so a new node-valued field
  reds a test instead of silently redefining what a repeating element contains.
- **Bounding a derived name is a shape test, not a truncation**; the mechanism lives in
  `src/model/path.ts` and nowhere else. `FhirComplex.properties[].name` stays exactly as the document
  wrote it. **The `hl7`/`deid` model-level lesson does NOT transfer**, because bounding those
  would be data loss. **No claim is made anywhere that a location never carries document content; do not
  add one.** A forgery shaped like a FHIR name is still echoed.
  [`#phi-warning-message-leak-2026-08-02`](documentation/agent-notes.md#phi-warning-message-leak-2026-08-02)
- **A `null` IS NOT A LOSS, WHICH IS WHY IT WAS INVISIBLE: READ SILENTLY, THEN DELETED ON EMIT, SO A
  NON-CONFORMANT DOCUMENT CAME BACK CLEAN WITH THE MEMBER GONE** (`{"value":null,"unit":"mg"}` lost
  the magnitude and **KEPT THE UNIT**, under `valid: true` / `safeToSummarize: true`). Closed
  2026-08-07 by a **diagnostic plus a hand-back, NEVER a refusal**. **THE §2.6.2.3 EXEMPTION HAS TWO
  CONDITIONS AND A GATE REFUTED A DRAFT CHECKING ONE**, the second of which **MUST MATCH `hasMeta` IN
  `write.ts`**; **do not widen to every `null`**; the `_`-sibling channel is the same laundering and
  stays on `UNKNOWN_PROPERTY`, **NOT a new code**; and **THREE write branches decide it**, so a
  `hasMeta`-only fix launders past itself. **Every clause, verbatim, before you touch any of it:**
  [`#the-null--_-sibling-laundering-the-claudemd-cursor-relocated-verbatim-2026-08-09`](documentation/agent-notes.md#the-null--_-sibling-laundering-the-claudemd-cursor-relocated-verbatim-2026-08-09)
- **A PHI sweep over leaf values is not a PHI sweep.** `phi-leak.test.ts` swept values only, so a
  megabyte-long property name survived it. Sentinels must cover names.

### The XML reader

Unless noted:
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
  actually walks.** Refuted three times for a universal wider than the code, one shipped in `.d.ts`.
- **Count the call sites, and the writers, before you write "one" or "everywhere else."** Refuted
  twice on the reader and once on the write path (the JSON writer was the worse of the two and was
  unrecorded). [`#fhir-element-text-recovery-2026-08-03`](documentation/agent-notes.md#fhir-element-text-recovery-2026-08-03)
- **The root is the one element with its own rule**: a document declaring **no** namespace is still
  read as FHIR and still unflagged. **Do not "tighten" that into a refusal**, and do not "fix" the
  leaves-its-parent's-namespace flag into a per-element one.
- **Take the narrative before the resource-valued unwrap.** `isResourceName` is FHIR vocabulary and
  means nothing inside XHTML; applied there it read `<BR/>` as a contained resource and **destroyed
  clinical prose with zero diagnostics under `valid: true`**, laundering on re-read. The narrative is
  recognised by its **expanded** name `{http://www.w3.org/1999/xhtml}div`.
- **On the narrative branch, "did a finding disappear" is the wrong question.** Compare the same
  document spelled the other way. Re-run
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
- **The control was RED on a clean tree AND a changed one, so it cleared neither: its zeros are
  inadmissible.** `CONTROL.moved` DELETED; three arms, ONE comparison (`sameReading`). **Never
  re-key a document in.**
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
  rule is the comparison, and this line used to break it with an enumeration of its own. **Do not
  narrow it back to `element.name`**, and **state the predicate, not which documents come out of
  it**: three gate passes running refuted a summary of that set, which depends on the parent's
  namespace. Closed for the READ only: `serializeResourceXml` drops the bindings.
  [`#fhir-writer-authors-values-2026-08-05`](documentation/agent-notes.md#fhir-writer-authors-values-2026-08-05)
- **Declared open residuals**, among others recorded in the notes. Do not fold one into an unrelated
  slice, and do not restate a gap as a claim. **Pinned by a test:** the **empty** `_`-sibling and a
  `_`-object's unreadable member,
  the **unbound** prefix, the `<DIV>` wrapper, `.@name`, the array-wrapped `value[x]`, the §2.6.1
  value-absent primitive, the foreign-root laundering (`test/xml.test.ts`, "declared residuals,
  pinned so they cannot move in silence"). **Each of those is a characterization test over a gap:
  CLOSING one MUST red it, in the same change.** Not theoretical: every closure below red one.
  **"Pinned by a test" is load-bearing prose, so never write it without opening the test**: such
  sentences have been false for days here, and the next reader does not re-check.
  - **CLOSED 2026-08-05:** the scalar beside a nested array, and the prefix rebound between siblings
    **on the read**. The rebound prefix keeps a characterization test over the half still open: the
    report does not survive `serializeResourceXml`, which drops the binding.
  - **CLOSED 2026-08-07: the `div` FORGERY.** A `div` string is written only when it spells exactly
    one element named `div`, checked at the branch splicing it in. **THE CHECK IS ON THE WRITE; the
    reader is unchanged, so no XML document reaches it and the read differential cannot grade it**
    (its own control is stale, firing on a clean tree). **DO NOT WIDEN IT** to the namespace or a
    prefix bound in the string: an unbound-prefix root is accepted on purpose, the same residual
    through a value. [`#div-forges-a-negation`](documentation/agent-notes.md#div-forges-a-negation-2026-08-07)
  - **CLOSED 2026-08-08: the array-wrapped `0..1` laundering** (`UNSERIALIZABLE_ARRAY_WRAPPER`).
    **THE WRITE PATH TAKES ITS CARDINALITY FROM `arrayWrappedScalars`' OWN WALK, NEVER A SECOND
    TABLE**, and refuses only what XML cannot spell back: **fewer than 2 items, plus ANY wrapper on
    `resourceType`** (the type is the tag). **DO NOT MAKE IT ARITY-BLIND**: two repeated elements
    re-read as a list, so refusing them withdraws a byte-exact round trip that KEEPS the finding. Per
    written MEMBER (`some`, not `every`), and the two dedupe sets are INDEPENDENT or a short wrapper
    hides behind a long one at one location.
    [`#the-array-wrapper-laundering`](documentation/agent-notes.md#the-array-wrapper-laundering-closed-2026-08-08)
  - **CLOSED 2026-08-08: the SHADOWED member, BOTH writers** (`UNSERIALIZABLE_SHADOWED_PROPERTY`,
    window `shadowedProperties`). **DO NOT hand both back**: `JSON.parse` is last-wins, this is
    first-wins. [`#shadowed-member`](documentation/agent-notes.md#the-shadowed-member-2026-08-08)
  - **STILL OPEN; deferral RE-MEASURED 2026-08-07 and it HOLDS.** Only ONE of the two remedies
    withdraws a capability. **Beside it,
    `UNSERIALIZABLE_ELEMENT_NAME` now refuses a name that BREAKS the tag** (one shape re-read as
    **different elements** and forged a `status`). **The line is "does OUR round trip survive it",
    NOT the XML `Name` production. DO NOT WIDEN IT:** `p:x`, `a&b`, `1abc` round-trip today.
    **"Unreachable from XML" is FALSE: a stripped prefix fronts a `!`.**
    [`#fhir-unbound-prefix-roundtrip-2026-08-07`](documentation/agent-notes.md#fhir-unbound-prefix-roundtrip-2026-08-07) ·
    [`#residuals-ii-to-iv-and-three-more-left-open`](documentation/agent-notes.md#residuals-ii-to-iv-and-three-more-left-open) ·
    [`#singleton-wrapper-laundering`](documentation/agent-notes.md#singleton-wrapper-laundering) ·
    [`#left-open-deliberately-a-through-e`](documentation/agent-notes.md#left-open-deliberately-a-through-e)
- The raw XML reader is **XXE- and billion-laughs-proof by refusal**: any `<!DOCTYPE` is
  `DTD_FORBIDDEN`, any entity beyond the five predefined + numeric character references is
  `UNDEFINED_ENTITY`, no I/O, no URI resolution, bounded depth. **Do not relax that into resolution.**

### Terminology, profiles, invariants

Layer-by-layer detail, incl. the binding-strength severity table and the 11-way
`Observation.value[x]` choice:
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

- **`attw` must stay `node scripts/attw.mjs`, never the bare CLI** (`ATTW-FALSE-GREEN-PORT`). The
  bare CLI turns a broken publish into a pass during `tsup`'s JS-without-`.d.ts` window. **The gate
  takes two arms and a name match alone is not enough**; **do not simplify the short-cluster arm
  back to the name set.** Re-read the section when you bump the pin. **`scripts/verify.sh` in the
  meta-repo needs no change and must not be touched.**
  [`#attw-false-green-port`](documentation/agent-notes.md#attw-false-green-port)
- **The differential corpus is DECLARED (`corpus/corpus.json`), FETCHED, and never committed.** It
  is no longer ten in-tree fixtures; it is three corpora and only one of them was written here. **Do
  not vendor third-party documents to make them handy**: real FHIR examples spell `family` /
  `given` / `birthDate` / `line`, the scanner sweeps what git carries repo-wide, and its allow-lists
  are declarations about OUR synthetic fixtures. **CHANGE THE LAYOUT, NEVER THE ALLOW-LISTS**, and
  remember git history is not undone by a revert. **An exclusion needs a REASON and it is printed
  every run; a disagreement is NEVER closed by loosening what the validator reports**, and a
  hand-authored document to reach the floor is forbidden (ADR 0018). **A missing answer is not
  agreement**: no readable oracle outcome means uncounted AND not clean. The oracle is pinned to a
  release and identified by the **jar's own bytes**, so a substituted artifact shows.
  [`#the-differential-corpus-is-no-longer-ten-fixtures-2026-08-25`](documentation/agent-notes.md#the-differential-corpus-is-no-longer-ten-fixtures-2026-08-25)
- **A PINNED RELEASE WAS NOT A PINNED ORACLE: `-tx` DEFAULTS TO `https://tx.fhir.org` AND THE
  VERDICT WAS A FUNCTION OF THE WEATHER** (three documents in the `FALSE VALID` bucket on one run
  and not the next, nothing having moved). The run DECLARES its terminology inputs
  (`scripts/differential/terminology.mjs`, **`source: "none"`** = `-tx n/a` + `-txCache n/a`),
  spells both options into the argv, and **AUDITS THE ARGV, not the constant, BEFORE a document is
  staged** ([`#a-pinned-release-was-not-a-pinned-oracle-2026-08-27`](documentation/agent-notes.md#a-pinned-release-was-not-a-pinned-oracle-2026-08-27)):
  network-answerable, unhonourable or absent inputs compare NOTHING and exit non-zero,
  substituting no other source. **`-txCache` is not optional**: an omitted one is a directory of
  someone's earlier network answers. **TWO PROPERTIES, NOT ONE.** The second is that a
  terminology-attributable finding is a RECORDED CLASS out of BOTH invariants, counted and printed,
  never a verdict. **The classifier keys on the VALIDATOR'S OWN vocabulary** (`code-invalid`, the
  `tx-issue-type` system, `Terminology_*` message ids) and **`not-found` is DELIBERATELY OUT**: it
  is also an unresolved definition, and admitting it would classify a non-terminology error out of
  the one direction that may never widen. Stripping the finding naively flips agreement into a
  SPURIOUS ERROR, so such a document is `terminology-delta`, **not a violation and still COMPARED**.
  **Determinism is MEASURED, not intended**: `pnpm differential:determinism` runs two comparisons of
  the DECLARED `determinismSubset` and compares byte-identical run records (**no clock, no staging
  path, no ordinal**). It reports **determinism NOT demonstrated** and exits non-zero for a missing
  jar, unhonourable inputs, or any document with no readable outcome. **NEVER give it a skip
  branch**, and never buy determinism by excluding a document: the compared count may rise, not fall.
- **The PHI scan's SCOPE and its RECOGNISER move together, never one alone.** Enumerating buys the
  SSN + email floor only. **Read both spellings** (`family: "…"` AND `<family value="…"/>`); **never
  key `text` / `identifier.value` / `telecom.value` in source.** A weakening scoped to "source" also
  hits a fixture whose extension is not `.json` / `.xml` / `.ndjson`, so **declare a domain in the
  allow-list, never a shape rule**. And **a scanned-file COUNT cannot detect a sweep that opened
  nothing** (it counts the roots that DID exist), nor can **`is-inside-work-tree`**, which answers
  for the ENCLOSING repo. Residuals: `phi-scan-overrides.md`
  [`#phi-scan-scope-2026-08-05`](documentation/agent-notes.md#phi-scan-scope-2026-08-05)
- **THE SWEEP READS THE INDEX, NOT JUST THE WORKING TREE, SO RE-RUN IT AFTER `git add`.** **UNION,
  never replacement**; **dedup BY CONTENT** (`blob <len>\0`: CRLF-vs-LF is two streams, both
  scanned); **the unmerged case keys on the ABSENCE OF STAGE 0** - `ls-files -s` gives ordinary blob
  modes at stages 1/2/3, so the 1st record is the merge base.
  [`phi-scan-union.md`](documentation/agent-notes/phi-scan-union.md)
- **FOUR refuter passes is the cap; a sub-problem that fails to converge twice is REVERTED and
  declared a gap. The gates run on the strongest model and you never set
  `CLAUDE_CODE_SUBAGENT_MODEL`.** Verbatim:
  [`#gate-discipline`](documentation/agent-notes.md#gate-discipline)

## Tech stack and the four architecture ADRs

**Relocated 2026-08-07:**
[`#relocated-out-of-claudemd-on-2026-08-07-to-make-genuine-room-for-a-trap`](documentation/agent-notes.md#relocated-out-of-claudemd-on-2026-08-07-to-make-genuine-room-for-a-trap).
The toolchain is **inherited** from the published `@cosyte/*` config packages, never copied: read
the versions off those, never off a copy here. **RUNTIME DEPS ZERO**, TS strict, dual ESM+CJS via
tsup, per-dir coverage >= 90, MIT. The four ADRs are in `documentation/decisions/`, their source of
truth: **`0001`** string-backed decimal/`integer64`, **`0002`** a bounded in-repo FHIRPath subset (no
third-party engine), **`0003`** JSON-first, **`0004`** R4-first (`4.0.1` modeled; R5/DSTU2
read-tolerance only).

## Engineering Guardrails

- No `any`. No unjustified `as` casts. Use `unknown` and narrow.
- JSDoc (with `@example`) on every public export: feeds IntelliSense.
- Immutable by default. Mutation only via explicit methods.
- No `console.*` in library code. Throw typed errors or return results.
- Postel's Law: the reader is liberal (lenient default + warnings), the writer is conservative: it
  authors no value of its own, and emits spec-clean FHIR for every model FHIR can express. It is
  **not** unconditionally spec-clean; its exceptions are named on `serializeResource`. **Read them
  there, never from a copy**: this line's copy listed three and had been two short since the `null`
  and `_`-sibling closures. Repairing one means inventing content or dropping it. Hand a value back
  (`FhirComplex.nonObjectSource`); **never model it as a primitive**, which would show it to every
  walker at a complex position. **Every write refusal is EITHER checked AT the site that writes the
  thing OR a WHOLE-MODEL PRE-PASS RAISED LAST, and two of them run in BOTH writers. Read the list
  off `SERIALIZE_ERROR_CODES`, never a count or an enumeration here.**
  [`#div-forges-a-negation`](documentation/agent-notes.md#div-forges-a-negation-2026-08-07)
- Diagnostics are **value-free by contract**: an `IssueCode` plus a FHIRPath expression. **That is
  not a claim that a location carries no document content** (a name is echoed when it matches the
  bounded published form). See the derived-name trap above, and do not widen it into one. **The
  other half of that claim is scoped too and must stay scoped**: the JSON reader's `expression` no
  longer carries English prose, NOT that every `expression` is resolvable FHIRPath. A `<withheld>`
  segment and the XML reader's `.@name` attribute form are deliberately **admitted** by
  `test/expression-grammar.test.ts` rather than hidden.
- **Deliberate omissions, each of which reads as an oversight and is not.** `markNestedArray`,
  `markDroppedText` and `markUndefinedNull` are reader-internal and **not exported**; `typeOf` stays
  the strict single-value read (**reject** an unreadable type, never guess);
  the element-text refusal fires even beside a value that arrived, and
  **do not justify that arm with "content the sender wrote is still missing"** (the gate broke that
  sentence with `<status value="final">final</status>`) since the rule keys on dropped character data
  and never compares text to value; and the two defensive `rootPath` calls in the terminology layer
  and the dose locator are the identity where observable, which the gate **does not pretend to
  cover**. Each reason, relocated 2026-08-07:
  [`#deliberate-omissions`](documentation/agent-notes.md#deliberate-omissions).
- **PHI discipline:** synthetic-only fixtures, redaction in logs. Never commit realistic PHI. The
  vendor-quirk grounding rule is stated once, under "Terminology, profiles, invariants".

## Standing disciplines (every change)

Disciplines **1 to 3 are the meta-repo's own**, in `documentation/conventions.md`, and bind here
unchanged; only what is fhir-specific is repeated. **1** docs follow code: this repo's docs, the
meta-repo's `documentation/repos/fhir.md`, and the `ecosystem-map.md` status table. **2** a Changeset
(`patch` on the `0.0.x` ladder) plus a `CHANGELOG.md` `[Unreleased]` entry. **3** the crew skill is
`fhir-resource-design`, plus the KB product doc. The fourth is this repo's own:

4. **No internal project bookkeeping on a public surface** (founder directive, 2026-07-27). Item
   identifiers (`FHIR-P10`), phase/wave language, ADR numbers and meta-repo paths belong in the
   changeset, `CHANGELOG.md`, the commit, the PR and the roadmap, never in what a consumer is
   _shown_. It is a **translation** at the boundary, not a deletion: repair the head of a line you
   strip an identifier off. Gated by `pnpm check:no-internal-refs`. Why, and what the gate does not
   cover:
   [`#no-internal-project-bookkeeping-on-a-public-surface`](documentation/agent-notes.md#no-internal-project-bookkeeping-on-a-public-surface)
   - Doc comments and string literals are **gated** (they reach the consumer's editor and logs);
     `//` and `/* */` comments are **not**, and identifiers **belong** there. **Do not justify that
     boundary from what reaches `dist/`**; measure reach, never grep it. **Removing a doc comment to
     satisfy the gate is a regression, not a fix.**
   - **There is deliberately no `slice` rule in this copy**: `slice` is R4 vocabulary here
     (`ElementDefinition.slicing`), measured at 41 matches with one of them ours. **Do not paste the
     sibling rule back without re-measuring.**
   - Two holes are open on purpose (`FHIR-P10b`-style suffixes; trailing `phase`) and `CHANGELOG.md`
     is deliberately not scanned. The reviewer owns half the rule.
