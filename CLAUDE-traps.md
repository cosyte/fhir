# @cosyte/fhir: the traps

The trap list [`CLAUDE.md`](CLAUDE.md) points at. It lives here because that file is held to a
300-line ceiling and these do not fit under it; none of it is optional reading for a change to this
package. The narrative behind each trap is in
[`documentation/agent-notes.md`](documentation/agent-notes.md), which is where a relative link below
resolves from this file exactly as it did from `CLAUDE.md`. **Never delete a trap to save bytes.
Move narrative there and leave the one-liner here.**

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
  recognises nothing and invents nothing.
  [`#fhir-primitive-as-element-text-2026-08-03`](documentation/agent-notes.md#fhir-primitive-as-element-text-2026-08-03)
  - **The element-text tolerance is now TAKEN, and it is TAKEN AT ONE POSITION.** A primitive
    carrying no `value` attribute reads its own character data as its lexical value; nothing else
    does. **DO NOT WIDEN IT** to a complex element or to the resource-valued unwrap (neither has a
    value slot, so reading there would model content at a position FHIR spells nothing at), and **do
    not let it reach an element that DID carry a `value`**: the attribute wins outright and the text
    beside it is never read, merged or compared against it, which is the arm
    `<status value="final">final</status>` broke a previous claim on. **Two separated text runs read
    as NO value**, because joining them mints a token the document does not contain. And the value
    is handed to the safety layer exactly as written: **never case-folded, trimmed into or coerced
    towards a code it nearly spells** - a near miss stays a near miss.
  - **The tolerance changes NOTHING about the report.** `UNEXPECTED_XML_CONTENT` still fires, the
    marker still lands, `DROPPED_ELEMENT_TEXT` is still an error, `safeToSummarize` is still false
    and **both writers still refuse**. A change that makes a recovered value summarisable or
    emittable has reopened the laundering, not finished the job.
- **A refusal is scored BASE-VS-HEAD, never on the twin arm**: the twin section requires
  `valid`/`safeToSummarize` to match, so a document head reads exactly as the twin **plus** a
  non-conformance it refuses over is scored _weaker_ for doing the right thing.
  `primitive-text-not-value` declares a twin and sits in that bucket on purpose. Read
  `weaker ONLY by refusing what the twin affirmed` beside it: it is a SUBSET of the weaker count,
  derived from the readings, and when it equals the weaker count nothing was lost against a twin.
  **Do not "fix" the weaker count by relaxing the louder arm** - that is the one number a real
  suppression would land in.
- **The control was RED on a clean tree AND a changed one, so it cleared neither: its zeros are
  inadmissible.** `CONTROL.moved` DELETED; **four** arms, ONE comparison (`sameReading`). **Never
  re-key a document in.** Arm 4 (`refusalBlindSpots`) is the one that keys the current slice and it
  does it by **DIFFERENCING THE TWO TREES' OWN `SERIALIZE_ERROR_CODES`**, so it names nothing once
  the slice merges: derive a key, never write one down.
- **If you add a writer refusal, check what the harness does with it before you trust a zero**: it
  reported 5,159 phantom leaf losses, and the leaf comparison now **skips** a refused document. **A
  slice that changes the reader _and_ adds a refusal has a real blind spot there**; measure the
  reader change separately. Arm 4 now PRINTS that, keyed to the codes the run introduced, but
  printing a limit does not remove it: **a zero on a line a refusal narrows is a floor.** And a
  refusal no corpus document reaches scores `readings moved 0` truthfully, which is not evidence.
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
  namespace. Closed for the READ; `serializeResourceXml` still has no bindings to write, so since
  2026-09-24 it **refuses** that write (`UNSERIALIZABLE_PREFIXED_NAME`) rather than lose the report.
  [`#fhir-writer-authors-values-2026-08-05`](documentation/agent-notes.md#fhir-writer-authors-values-2026-08-05)
- **Declared open residuals**, among others recorded in the notes. Do not fold one into an unrelated
  slice, and do not restate a gap as a claim. **Pinned by a test:** the **empty** `_`-sibling and a
  `_`-object's unreadable member,
  the `<DIV>` wrapper, `.@name`, the §2.6.1
  value-absent primitive (`test/xml.test.ts`, "declared residuals, pinned so they cannot move in
  silence"). **Each of those is a characterization test over a gap:
  CLOSING one MUST red it, in the same change.** Not theoretical: every closure below red one.
  **"Pinned by a test" is load-bearing prose, so never write it without opening the test**: such
  sentences have been false for days here, and the next reader does not re-check.
  - **CLOSED 2026-08-05:** the scalar beside a nested array, and the prefix rebound between siblings
    **on the read**. The rebound prefix kept a characterization test over the half left open (the
    report did not survive `serializeResourceXml`, which drops the binding), and that half CLOSED
    2026-09-24 by refusing the write: the test went red and was rewritten, in the same change.
  - **CLOSED 2026-08-07: the `div` FORGERY.** A `div` string is written only when it spells exactly
    one element named `div`, checked at the branch splicing it in. **THE CHECK IS ON THE WRITE; the
    reader is unchanged, so no XML document reaches it and the read differential cannot grade it**
    (its own control is stale, firing on a clean tree). **DO NOT WIDEN IT** to the namespace or a
    prefix bound in the string: it passes an unbound-prefix root on purpose, and that residual is
    refused by a SECOND check at the same branch, on its own code (CLOSED 2026-09-24, below).
    [`#div-forges-a-negation`](documentation/agent-notes.md#div-forges-a-negation-2026-08-07)
  - **CLOSED 2026-08-08: the array-wrapped `0..1` laundering** (`UNSERIALIZABLE_ARRAY_WRAPPER`).
    **THE WRITE PATH TAKES ITS CARDINALITY FROM `arrayWrappedScalars`' OWN WALK, NEVER A SECOND
    TABLE**, and refuses only what XML cannot spell back: **fewer than 2 items, plus ANY wrapper on
    `resourceType`** (the type is the tag). **DO NOT MAKE IT ARITY-BLIND**: two repeated elements
    re-read as a list, so refusing them withdraws a byte-exact round trip that KEEPS the finding. Per
    written MEMBER (`some`, not `every`), and the two dedupe sets are INDEPENDENT or a short wrapper
    hides behind a long one at one location.
    [`#the-array-wrapper-laundering`](documentation/agent-notes.md#the-array-wrapper-laundering-closed-2026-08-08)
  - **CLOSED 2026-09-22: the array-wrapped `value[x]` laundering** (`ARRAY_WRAPPED_CHOICE` on the
    read, `UNSERIALIZABLE_CHOICE_WRAPPER` on the write). **THAT IS A SECOND REFUSAL, NOT A WIDER
    WINDOW ON THE ONE ABOVE**, and the distinction is the whole design: `arrayWrappedScalars` is
    UNCHANGED, still says nothing here, and `safeToSummarize` does not move, because widening its
    element table to every R4 `0..1` element IS the per-resource model. **THE NEW REFUSAL TAKES ITS
    CARDINALITY FROM THE VALUE READOUT'S OWN WALK, NEVER A SECOND TABLE** -- the eleven `value[x]`
    variant names at the two positions R4 spells that choice (`Observation.value[x]`,
    `Observation.component.value[x]`, both `0..1`), at every Observation resource root. **ONE
    WINDOW** for the validator code, `ObservationValue.encodingIssue` and the refusal. **DO NOT MAKE
    IT ARITY-BLIND** (same reason: two items round-trip byte-exact AND keep the report), do not read
    anything out of the wrapper (picking a member authors a DOSE), and it is raised **LAST** of the
    seven. `serializeResource` is untouched.
    [`#left-open-deliberately-a-through-e`](documentation/agent-notes.md#left-open-deliberately-a-through-e)
  - **CLOSED 2026-08-08: the SHADOWED member, BOTH writers** (`UNSERIALIZABLE_SHADOWED_PROPERTY`,
    window `shadowedProperties`). **DO NOT hand both back**: `JSON.parse` is last-wins, this is
    first-wins. [`#shadowed-member`](documentation/agent-notes.md#the-shadowed-member-2026-08-08)
  - **CLOSED 2026-08-27: the FOREIGN-ROOT laundering** (`UNSERIALIZABLE_FOREIGN_ROOT`, marker
    `FhirComplex.foreignRoot`). The model carries a **marker, never the namespace**: the URI is the
    document content this residual is about, and a marker cannot leak it. **XML ONLY, and that is not
    a claim the JSON channel keeps the flag** - it does not, `serializeResource` is byte-identical to
    base, and that leg is declared open. **DO NOT WIDEN IT** to the other arm of `rootIsForeign`: a
    **no-namespace** root is accepted on purpose and stays written, and an **unbound**-prefix root is
    outside this refusal too: its write is refused since 2026-09-24, but at the TAG SITES on
    `UNSERIALIZABLE_PREFIXED_NAME` (below), never through the marker. It **withdraws a round trip
    from a document that reads `valid: true`**, the third
    refusal to pay that (`breaksTag` and the untaggable type are the others), and it is raised
    **last** so nothing that already reported another code moves onto it.
    [`#foreign-root-laundering`](documentation/agent-notes.md#the-foreign-root-laundering-closed-2026-08-27)
  - **CLOSED 2026-09-24: the unbound-prefix round trip AT THE TAG SITES**
    (`UNSERIALIZABLE_PREFIXED_NAME`). The deferral RE-MEASURED 2026-08-07 held until then, and only
    ONE of its two remedies withdraws a capability: that one, (b) refuse the shape, is what shipped;
    (a) model the binding is NOT taken (it cannot close an unbound root without AUTHORING a namespace)
    and stays available. **ANY colon at a tag position, ONE exemption: `xml:` + a colon-free local
    part** (bound by definition); `xmlns:x`, `:x`, `a:b:c` are refused. **A NEW CODE, NOT A WIDER
    `UNSERIALIZABLE_ELEMENT_NAME`**, whose line below is untouched. **CHECKED IN `tag()`, NEVER A
    PRE-PASS; RAISED LAST OF ALL**, so nothing that drew a code before moves onto it (`a b:c` stays
    the name code). It **withdraws a write from `valid: true` models**, the fourth refusal to pay
    that. Read path and `serializeResource` untouched.
    [`#unbound-prefix-closed`](documentation/agent-notes.md#the-unbound-prefix-round-trip-closed-at-the-tag-sites-2026-09-24)
  - **CLOSED 2026-09-24: the same residual through a `div` VALUE** (`UNSERIALIZABLE_DIV_PREFIX`).
    The `div` branch writes a string, not a name, so `tag()` never saw `<v:div>x</v:div>`, which was
    written and re-read as a property named `v:div`. The branch now asks a SECOND question of the
    parse `emitsOneDivElement` already made (`bindsEveryPrefix`): every element and attribute prefix
    bound by a declaration INSIDE the string, `xml` exempt, `xmlns`/`xmlns:*` attributes being
    declarations. **NOT folded into the tag-site check, and NOT a wider `UNSERIALIZABLE_DIV_MARKUP`
    or `UNSERIALIZABLE_PREFIXED_NAME`** (the first is raised second, so reusing it moves codes; the
    second means a tag position). Asked only of a string the one-element check passed, and **RAISED
    LAST OF ALL**, after the tag-site colon code. An inner-element or attribute prefix is refused too,
    so it **withdraws a write from `valid: true` models this library round-tripped**, the fifth
    refusal to pay that. **An ANCESTOR-bound prefix is NOT refused, and that rests on the READER**,
    which writes the inherited declarations into the `div` string: change that and this refusal
    starts withdrawing conformant round trips.
    [`#unbound-prefix-div-value-closed`](documentation/agent-notes.md#the-unbound-prefix-round-trip-closed-through-a-div-value-2026-09-24)
  - **STILL OPEN: a colon-free non-name** (`a&b`, `1abc`) is still written, and is a separate gap
    from the one closed above. **Beside it,
    `UNSERIALIZABLE_ELEMENT_NAME` now refuses a name that BREAKS the tag** (one shape re-read as
    **different elements** and forged a `status`). **The line is "does OUR round trip survive it",
    NOT the XML `Name` production. DO NOT WIDEN IT:** `a&b`, `1abc` round-trip today; `p:x` did too,
    and is refused on its OWN code (above), not this one.
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
- **R4 base constraints run with NO profile (`validate/base-invariants.ts`): `dom-3` is DECIDED when
  nothing is contained (a profile's VERBATIM copy too) and UNCHECKED otherwise, never skipped; `dom-6`
  is NOT evaluated; a contained resource's own content is a DECLARED GAP, via `dom-2` to `dom-5`.**
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
