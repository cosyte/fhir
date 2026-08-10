# Content written where a `code` belongs is disclosed, not read through

`FHIR-NEGATION-READ-SCOPE-RESIDUALS`, base `632f914`. Closes the `PRE-EXISTING` residual `#83` filed
and `#84` carried forward: **a `status` written as a JSON object read `negations: []` /
`safeToSummarize: true` / `valid: true` at both states.**

**This file exists because `documentation/agent-notes.md` had six bytes left of its archive budget
when this slice started, so it could not be appended to.** This is the per-slice tier, which carries
its own budget. `CLAUDE.md` was **not touched**, and the one correction this slice made to
`agent-notes.md` (retracting a now-closed entry) came out **net negative**. No ratchet was raised and
no trap was deleted or reworded to buy room. **The figures themselves are deliberately not written
down here**: derive them from the files and from `.claude/hooks/doc-budget.mjs`, because a number
copied into prose here is the one thing guaranteed to be stale when it is next read.

## What was wrong

At `632f914`, every one of these returned an empty negation list with **no location anywhere**:

```
{"resourceType":"Procedure","status":{"value":"not-done"}}           -> negations: []  safe: true
{"resourceType":"Observation","status":{"value":"entered-in-error"}} -> negations: []  safe: true
{"resourceType":"Procedure","status":[{"value":"not-done"}]}         -> negations: []  safe: true
{"resourceType":"Procedure","status":3}                              -> negations: []  safe: true
```

A `Bundle.entry` and a `contained` resource behaved the same way. `{"value":"not-done"}` is not an
exotic input: it is what a generic converter emits when it carries FHIR **XML**'s `value` attribute
across into JSON as a member, and it is the same class of converter output that motivated the array
wrapper reads already in this layer.

## The licence, and it did not transfer from any predecessor

Four slices, four different licences. `#81` dropped a type gate on **direction**; `#82` needed an
**R4 census** because a status code is not an element; `#83` used the **`?!` modifier rule**; `#84`
was a **decided direction** (disclose, do not normalise) over a value.

**This one is licensed by the ENCODING, and by nothing else.** FHIR JSON spells a `code` as a JSON
string (json.html §2.6.0) and a `CodeableConcept` as an object with `coding` / `text`; those are the
two datatypes a root `status` carries. A shape spellable as **neither** is one no version of FHIR
defines at that position, so descending into `{"value":"not-done"}` to recover the string would
resolve a negation out of an encoding **no specification defines**, and hand a caller an assertion
its sender never spelled in a form the sender could have spelled it. That is the laundering this
package refuses everywhere else, and it is why the remedy is a **disclosure** rather than a read.
**The gap closed is the silence, not the strictness** - the same disposition `#84` took on a value,
applied to a position.

**🩺 The licence was ARRIVED AT TWICE.** The first cut stated it as *"a `code` is a JSON string, so
anything the string read cannot take is unreadable"*, which is a statement about a **reader** rather
than about the **encoding**, and it was wrong for exactly the documents where the encoding is a
`CodeableConcept`. Gate pass 1 refuted it (below). The correct form is about what FHIR can spell at
the position, and only that form survives contact with the published R4 examples.

## The shape / value distinction, which is the whole finding

**Every other question this layer asks is about a WRITTEN VALUE, and a shape is invisible to all of
them.** `hasUnreadableBoolean` asks whether a value the read saw fell outside the boolean lexical
space; `isNearMissCode` asks whether a value spells a code bar its case or its whitespace. **An
object holds no value at all**, so both answer `false` about it, **truthfully**, and the element then
reads exactly like one the sender left out.

That is worth naming as its own shape, because it means the two existing channels were not "missing"
this case through an oversight in their predicates. They were answering a different question
correctly. `hasUnreadableBoolean`'s own docblock **already said so** at base ("It answers about a
value, not about a shape... those shapes are a separate gap"), and this slice does not widen it: an
object at `doNotPerform` still draws nothing, pinned in both states.

## Read and refusal move together, at one window

The trap this lineage paid for is that **a read and its refusal must be one function at one window**,
or widening the read alone reproduces `#80`'s STOP-THE-LINE on the newly-reachable locations.

Here nothing about the **read** widened at all. What was added is the read's **shape complement**,
carried as a third field (`unread`) in the **same `NEGATION_CODE_READS` row** as the reader it
complements, and applied in the **same loop over the same table** that makes the exact matches and
the near-miss disclosure. So the disclosure cannot come to cover an element the classification does
not, nor miss one it does, **by construction rather than by a second copy of a condition**. That is
pinned mechanically (the covered element list is derived from the table in the test, never written
down) rather than described.

**🛑 But "one window" is a claim about the ELEMENT dimension only, and gate pass 1 named the
dimension it does not cover.** Report scope is genuinely *wider* than read scope in the
**resource-type** dimension: the read runs at every root of every type on purpose, and the refusal
initially did too, which is how it reached a `CodeableConcept`-typed `status`. **A derivation over
element names is structurally blind to that**, so the element-name pin is not the guarantee it looks
like. What bounds the refusal now is the datatype-shape question, pinned by conformant fixtures of
the types that exposed it rather than by a derivation.

The window is **every resource root**, inherited from `checkResourceRoot` exactly as `negations`,
`arrayWrappedScalars` and `nearMissNegationCodes` are. No new walk was added.

## 🛑 Gate pass 1's BLOCKER, and it is the shape this lineage keeps producing

The first cut asked **"did the string read take anything?"** and refused where it did not. That
**refuses a conformant document**, because **R4 spells a root `status` a `CodeableConcept` on
`MedicinalProductAuthorization` and `SubstanceSpecification`**, R5 adds more (including a
**mandatory** `DeviceAssociation.status`), and a conformant `CodeableConcept` yields no string to a
`code` read. Reproduced by the gate on the **unmodified HL7-published R4
`medicinalproductauthorization-example.json`**: clean at base, `safeToSummarize: false` at head, with
`assertSafeToSummarize` throwing. That is `#84` pass 1's shape exactly, one slice later.

**Worse than the behaviour was the claim.** The slice had published *"`status` carries no such
hazard: it is a `code` in every version this reader accepts"* into `dist/index.d.ts`, `.d.cts`,
`README.md`, `CHANGELOG.md`, a pending changeset and this note, and had described the reasoning as
*"checked rather than assumed"* when nothing in the diff checked it. **The slice reasoned correctly
about the element it DECLINED (`verificationStatus`) and asserted without checking about the element
it SHIPPED.** That asymmetry is the finding worth keeping.

**Remedy: ask about the SHAPE, not about which reader succeeded.** A complex carrying `coding`,
`text`, `id` or `extension` is something FHIR spells at a root `status` and is left alone, whether or
not a code came out of it. `{"value":"not-done"}` carries none of them and is spellable as neither
datatype, so nothing was declined there: there was nothing either datatype could hold.

**The direction of the scoping is the whole argument, and it does NOT contradict "the type gate was
DROPPED, not widened".** That rule governs a **read**, which can only *add* a negation, so widening
is free. This is a **refusal**, and an ungated refusal flips a conformant document from summarizable
to refused, which is the one direction a fail-safe layer must not move without evidence. The sibling
`checkArrayWrapping` is type-scoped for exactly this reason and says so in its own docblock.

**Converse declared limit, taken knowingly:** a shape **all of whose members** are ones FHIR spells
here is never reported, so a code buried under `{"status":{"coding":{...}}}` at a `Procedure` stays
silent. **One member outside the set is enough to report**, so the limit is narrower than "carries a
`CodeableConcept` member". Pinned as the exact document above, not as the universal.

## ⚖️ `verificationStatus` is deliberately outside it, and the reason is a VERSION

The shape complement of a `CodeableConcept` read is a **primitive** at the element. Applying it would
report `{"resourceType":"Condition","verificationStatus":"refuted"}`.

**`Condition.verificationStatus` IS a `code` in DSTU2**, and this library declares DSTU2
read-tolerance (`documentation/decisions/0004-r4-first-version-strategy.md`). So the same predicate
that reports a non-conformant R4 document reports a **conformant DSTU2** one, and this reader carries
no version discriminator at the point the predicate runs. **That is the `#84` pass-1 shape** (a
disclosure firing on a conformant document, the first behavioural refusal in this lineage), and
taking it on the strength of the R4 half alone would have walked straight into it.

**And unlike the first cut, this is now checked rather than asserted**: DSTU2 `Condition.
verificationStatus` is `code [1..1]` where R4 and R5 spell it `CodeableConcept [0..1]`, confirmed
against the published definitions by the gate.

Filed, not absorbed, and **pinned in both directions**.

## ⚖️ `no-known-allergy` and `AllergyIntolerance.code` stay where they are

Untouched, on purpose, for the reason `#83` recorded: absence there reads as **UNKNOWN, not NONE**,
so surfacing it more widely makes a caller **less** careful. This slice does not "finish the job".

## 🛑 Gate pass 2's finding: the remedy's exemption had the WRONG POLARITY

The pass-1 remedy exempted a complex that carried **any** member of a `CodeableConcept`. So
`{"status":{"id":"s1","value":"not-done"}}` and `{"status":{"value":"not-done","extension":[...]}}`
read as **clean** - and those are the *same* generic-converter output the whole slice is built on,
the converter having carried the primitive's own `id` / `extension` metadata across beside the value.
The item's residual was still open for them, unnamed and unpinned, while `dist/index.d.ts` asserted
that a complex carrying one of those members "is something FHIR spells here".

**Corrected polarity: report when ANY member is outside the set.** A conformant `CodeableConcept` has
**no** member outside it, so the channel stays empty on one whatever else it carries; a converter
output carrying `value` is reported however much legal metadata sits beside it. The empty complex is
reported by its own arm, `ele-1` forbidding an element with no value, children or extension.

**Both polarities are now pinned**, and the wrong one is a named mutation.

## Measurement

Every figure below is derived; the named lists are the claim, and no total stands in for one. **All
of it was re-measured after the pass-2 remedy**, not carried over from either earlier cut.

- **Red at base: 13 of 38** for a **behavioural** difference, in a real **detached base worktree** at
  `632f914`; **43 of 43 at head**.
  - **Five further cases name a symbol the base commit does not have** (`unreadableNegationCodes`,
    `hasUnreadableCode`, the table's `unread` field). They are **skipped, not counted as red**: a pin
    asserted through a symbol the base lacks measures the symbol, not the behaviour. That is `#84`'s
    published self-correction.
  - **The base copy differs from the shipped file in exactly three documented ways** and in nothing
    else: the `disclosed` accessor returns the reading a caller had before the channel existed, two
    base-absent imports are dropped, and the five cases above are `.skip`ped. **Nothing is deleted**,
    and the copy asserts its own case count against the shipped file so the two cannot drift.
    🩺 **Gate pass 2 caught an earlier copy that had silently lost a case**, which is why the count
    is now asserted rather than eyeballed.
- **25 both-states pins, NAMED in the test file itself**, not counted in a total. The conformant
  documents: a plain `status`; a `status` that IS a negation; the value-absent `data-absent-reason`
  sibling; a resource with no `status`; a `CodeableConcept` `verificationStatus`; a
  `verificationStatus` carrying only `text`; a Bundle of conformant entries; **the R4
  `MedicinalProductAuthorization` and `SubstanceSpecification` shapes, whose `status` IS a
  `CodeableConcept`**; a `CodeableConcept` `status` carrying only `text`; one carrying only an
  `extension`; one carrying `coding` beside `id`, `text` and `extension`; **the R5
  `DeviceAssociation` shape**; a `CodeableConcept` `status` inside a Bundle entry; and two conformant
  **XML** shapes, one with `id` + `extension` children beside the value and one with no value at all.
  Plus "reads no deeper than a resource root", "a duplicate key cannot hide a `CodeableConcept`
  member", and the seven declared limits (bare-string `verificationStatus`; bare-string
  `AllergyIntolerance.code`; an object at `doNotPerform`; an object at `clinicalStatus`;
  `validateResource` still `valid: true`; an empty array at `status`; and a code buried under a
  `CodeableConcept` member at a `code`-typed `status`).
- **Non-vacuity by mutation: NONE SURVIVED, and they are named rather than totalled.** Each reddened
  at least one case: ignoring a non-string written value; dropping the value-absent guard so the
  conformant `data-absent-reason` shape reports; not walking the array wrapper; **dropping the
  datatype scoping, which is pass 1's blocker**; **exempting a shape that carries any one legal
  member, which is pass 2's polarity defect**; reading every complex as clean; dropping the
  empty-complex arm; forgetting `text`; forgetting `id` / `extension`; removing the `status` row's
  `unread`; **giving `verificationStatus` the complement the DSTU2 limit declines**; reporting the
  resource root instead of the element; `some` becoming `every`; `safeToSummarize` no longer
  consulting the channel; and `assertSafeToSummarize` no longer consulting it.
- **🩺 One mutation survived an earlier cut and was closed by DELETING THE BRANCH, not by adding a
  test.** Scanning `duplicates` alongside `properties` could not change any answer: a repeated name
  keeps its **first** member in `properties` and puts only later ones in `duplicates`, so every name
  in `duplicates` is present in `properties` too, measured on a document rather than assumed. **Dead
  code**, and an unreachable branch is one no mutation can red and no reader can check. The invariant
  it relied on is now pinned by a test.
- **Suite 70 files / 1,495 tests -> 71 / 1,538.** **The count alone does not establish that no
  existing test moved, and it is not offered as if it did** (gate pass 1's point, and the same shape
  as this repo's own "a scanned-file COUNT cannot detect a sweep that opened nothing"). **Three
  existing test files were edited, named here:** `test/xml-unreadable-boolean.test.ts` (the
  refusal-message string pin, which this slice legitimately extends and therefore rewrites), and
  `test/derived-names.test.ts` and `test/phi-diagnostic-surface.test.ts`, whose collected-location
  lists were extended to include the new channel so it is swept for name echo. No other test file is
  touched, and `git diff 632f914..HEAD -- test/` is the derivation.
- **`differential:read`: 0 readings moved, 0 regressions - and that 0 is VACUOUS BY CONSTRUCTION.**
  The harness prints its own caveat that it cannot distinguish "nothing moved" from "no document in
  the corpus reaches the changed code", and no corpus fixture carries an unspellable shape at
  `status`. Reported as a non-measurement, not as a clean sheet.
- **🩺 The negative control against `@cosyte/hl7` is DEGENERATE and is reported as such.** **0 of the
  9 symbols** this test file names exist on that package, so every assertion would fail for a
  missing-symbol reason and none for a behavioural one. **A control that cannot fail is not a
  control**, and counting it as a pass would repeat a shape this run has already published twice.
- **Corpus caveat:** hand-authored fixtures, mutations and probes. **Not** the R4 published-examples
  corpus - **and pass 1 showed that caveat cutting the other way**: its blocker was visible in the R4
  published-examples corpus this slice does not run, and pass 2 cleared the remedy against the
  published R4 and R5 example corpora. The fixtures added afterwards are hand-authored copies of
  those shapes, not the published files.

## 🔴 Deferred, filed rather than absorbed

1. **`verificationStatus`'s shape complement**, above. Needs a version discriminator or a decision to
   accept reporting conformant DSTU2. Pinned in both directions.
2. **`validateResource` still reports `valid: true`** on every document this channel discloses.
   Raising an issue code needs a window decision of its own (which types, and what the validator
   knows about a datatype with no caller-supplied profile), and the safety layer is this slice's
   window. Pinned as a both-states limit.
3. **An empty array at `status` draws nothing** - no position, so no content the read stepped over.
   Pinned.
4. **The array-wrapped `Procedure.status` still draws no `ARRAY_WRAPPED_SCALAR`**, unchanged from
   `#84`: that report is scoped to the safety resource types at a resource root. A wrapped object now
   draws *this* channel, so the wrapper case is strictly better than base, but the wrapper itself is
   still unreported.
5. `PRE-EXISTING`, untouched: `src/safety/codes.ts` still publishes a **set size** into
   `dist/index.d.ts`; *"the negation read"* remains **ambiguous** between the walk-scoped `negations`
   and the root-scoped convenience field wherever it appears unqualified; the case-sensitivity gap;
   and the historical *"no negation readable at all"* sentence in `CHANGELOG.md`, which stays under
   its explicit *"Measured at the base commit"* framing and is **deliberately left**.

## Process

- **The repo's own `format` script was used**, never a wider glob. `git status` after it showed only
  this slice's own files: no cross-cutting write, which is the failure `#83` recorded.
- **`git add` before believing a gate.** `check:no-emdash` scans `git ls-files`, so it reported OK
  over a new test file it had never opened. Staging first turned it red on seven real em dashes.
  The same run, `check:no-internal-refs` caught an ADR number in a **doc comment**, which compiles
  into `dist/` and renders in a consumer's editor; it was translated at the boundary, not deleted.
