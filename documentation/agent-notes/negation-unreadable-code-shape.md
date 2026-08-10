# Content written where a `code` belongs is disclosed, not read through

`FHIR-NEGATION-READ-SCOPE-RESIDUALS`, base `632f914`. Closes the `PRE-EXISTING` residual `#83` filed
and `#84` carried forward: **a `status` written as a JSON object read `negations: []` /
`safeToSummarize: true` / `valid: true` at both states.**

**This file exists because `documentation/agent-notes.md` is at 249,994 of its 250,000 archive
budget: six bytes, so the next slice cannot append.** It is the per-slice tier, its own 90,000-byte
budget. `CLAUDE.md` was **not touched** and stands at 27,997 of its 28,000 ratchet (three bytes). No
ratchet was raised and no trap was deleted or reworded to buy room. Derive all three figures; never
write one down as current.

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
string (json.html §2.6.0). There is no version of FHIR in which a JSON `code` is an object, so
descending into `{"value":"not-done"}` to recover the string would resolve a negation out of an
encoding **no specification defines**, and hand a caller an assertion its sender never spelled in a
form the sender could have spelled it. That is the laundering this package refuses everywhere else,
and it is why the remedy is a **disclosure** rather than a read. **The gap closed is the silence, not
the strictness** - the same disposition `#84` took on a value, applied to a position.

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

The window is **every resource root**, inherited from `checkResourceRoot` exactly as `negations`,
`arrayWrappedScalars` and `nearMissNegationCodes` are. No new walk was added.

## ⚖️ `verificationStatus` is deliberately outside it, and the reason is a VERSION

The shape complement of a `CodeableConcept` read is a **primitive** at the element. Applying it would
report `{"resourceType":"Condition","verificationStatus":"refuted"}`.

**`Condition.verificationStatus` IS a `code` in DSTU2**, and this library declares DSTU2
read-tolerance (`documentation/decisions/0004-r4-first-version-strategy.md`). So the same predicate
that reports a non-conformant R4 document reports a **conformant DSTU2** one, and this reader carries
no version discriminator at the point the predicate runs. **That is the `#84` pass-1 shape** (a
disclosure firing on a conformant document, the first behavioural refusal in this lineage), and
taking it on the strength of the R4 half alone would have walked straight into it.

**`status` carries no such hazard**: it is a `code` in every version this reader accepts, so the
complement is safe there for a reason that is checked rather than assumed.

Filed, not absorbed, and **pinned in both directions**.

## ⚖️ `no-known-allergy` and `AllergyIntolerance.code` stay where they are

Untouched, on purpose, for the reason `#83` recorded: absence there reads as **UNKNOWN, not NONE**,
so surfacing it more widely makes a caller **less** careful. This slice does not "finish the job".

## Measurement

Every figure below is derived; the named lists are the claim, and no total stands in for one.

- **Red at base: 13 of 29**, in a real **detached base worktree** at `632f914`; 34 of 34 at head.
  - **Five further cases name a symbol the base commit does not have** (`unreadableNegationCodes`,
    `hasUnreadableCode`, the table's `unread` field). They are **skipped, not counted as red**:
    a pin asserted through a symbol the base lacks measures the symbol, not the behaviour. That is
    `#84`'s published self-correction, applied here from the start rather than after a gate found it.
  - The whole file runs at base by substituting **one accessor** (`disclosed`), which returns the
    reading a caller had before the channel existed. Every other line is byte-identical, so the
    comparison is of behaviour.
- **16 both-states pins, NAMED in the test file itself**, not counted in a total: the nine conformant
  documents (plain `status`; a `status` that IS a negation; the value-absent `data-absent-reason`
  sibling; a resource with no `status`; a `CodeableConcept` `verificationStatus`; a
  `verificationStatus` carrying only `text`, which R4 permits; a Bundle of conformant entries; and
  two conformant **XML** shapes, one with `id` + `extension` children beside the value and one with
  no value at all), "reads no deeper than a resource root", and the six declared limits
  (bare-string `verificationStatus`; bare-string `AllergyIntolerance.code`; an object at
  `doNotPerform`; an object at `clinicalStatus`; `validateResource` still `valid: true`; an empty
  array at `status`).
- **Non-vacuity by mutation, named rather than totalled.** Each of these reddened at least one case:
  ignoring a non-string written value; dropping the value-absent guard so the conformant
  `data-absent-reason` shape reports; not walking the array wrapper; reading a complex as clean;
  removing the `status` row's `unread`; **giving `verificationStatus` the complement the DSTU2 limit
  declines**; reporting the resource root instead of the element; `some` becoming `every` so a
  shadowed member hides the shape; `safeToSummarize` no longer consulting the channel; and
  `assertSafeToSummarize` no longer consulting it.
- **Suite 70 files / 1,495 tests -> 71 / 1,529**, exactly the new file, so **no existing test moved**
  except the refusal-message string pin in `test/xml-unreadable-boolean.test.ts`, which this slice
  legitimately extends and therefore rewrites.
- **`differential:read`: 0 readings moved, 0 regressions - and that 0 is VACUOUS BY CONSTRUCTION.**
  The harness prints its own caveat that it cannot distinguish "nothing moved" from "no document in
  the corpus reaches the changed code", and no corpus fixture carries an object at `status`. Reported
  as a non-measurement, not as a clean sheet.
- **🩺 The negative control against `@cosyte/hl7` is DEGENERATE and is reported as such.** **0 of the
  9 symbols** this test file names exist on that package, so every assertion would fail for a
  missing-symbol reason and none for a behavioural one. **A control that cannot fail is not a
  control**, and counting it as a pass would be the third repeat of a shape this run has already
  published twice.
- **Corpus caveat:** hand-authored fixtures, mutations and probes. **Not** the R4 published-examples
  corpus.

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
