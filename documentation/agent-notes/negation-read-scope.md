# The negation read was blind by scope (2026-08-09): STOP-THE-LINE

Relocated narrative for the `agent-notes.md` section of the same name. Base commit `f0289a2`.

## What was measured, before anything was changed

Plain conformant JSON. No XML, no round trip, no value outside a datatype's lexical space.

```
{"resourceType":"MedicationRequest",   "doNotPerform":true}  ->  negations: ["do-not-perform"]
{"resourceType":"ServiceRequest",      "doNotPerform":true}  ->  negations: []  safeToSummarize: true
{"resourceType":"CommunicationRequest","doNotPerform":true}  ->  negations: []  safeToSummarize: true
```

`assertSafeToSummarize` clean on all three. **That is what makes this one sharper than the two
before it**: the first needed the XML round trip, the second needed `value="1"`. This needed neither.

The unreadable twin measured the same way, and the asymmetry is the finding:

```
{"resourceType":"ServiceRequest","doNotPerform":"1"}  ->  unreadableBooleans: []   safeToSummarize: true
{"resourceType":"MedicationRequest","doNotPerform":"1"} -> unreadableBooleans: [.] safeToSummarize: false
Bundle.entry[0].resource = MedicationRequest doNotPerform:true  ->  negations: []
Bundle.entry[0].resource = MedicationRequest doNotPerform:"1"   ->  reported at that exact location
```

**The library was strictly more honest about a value it could not read than about one it could.**

## Why the gate was DROPPED and not WIDENED

The tempting fix is `DO_NOT_PERFORM_TYPES = {MedicationRequest, ServiceRequest,
CommunicationRequest, ...}`. **It is the same mechanism that produced the defect.** A type gate does
not merely fail to *read* the types it omits: nothing looks at them, so nothing is *reported* for
them either, and a gate is a list of the types somebody remembered. A fifth type reproduces the whole
finding, silently, and the census would have to be re-grounded every R4 reading.

**What licenses dropping it is the DIRECTION, not a census of R4.** This read can only ADD the
`do-not-perform` negation. It can never retire a finding, never flip `valid`, never turn a refusal
into an affirmation. So a type nobody enumerated costs a caller a negation it can ignore, where a
type nobody enumerated *under a gate* costs a patient an instruction not to give a medication. This
is the same asymmetry `CLAUDE.md` already records for `isRetracted` and the `refuted` read, and it is
**the exact opposite** of `noKnownAllergy`, which asserts something *positive* about a patient and
therefore stays type-gated. Un-gating that one would claim "no known allergy" over a `Condition` that
merely carries SNOMED `716186003`. Both directions are pinned in the new test.

**Do not reason from "no conformant document reaches it".** That is a universal over R4 and this repo
has been refuted three times for exactly that shape of sentence. The argument above needs no such
claim, and the one place a universal would be load-bearing (the refusal half, which *can* flip
`safeToSummarize` to `false`) is answered narrowly instead: a type that defines no `doNotPerform`
makes the document non-conformant *by writing the element at all*, so declining to affirm over it is
the fail-safe direction rather than a false error.

## The two halves are ONE function, and that is the design

`checkDoNotPerform` does the read and its complement in one pass at one window. The predecessor
(`checkUnreadableBooleans`) carried the docblock "the element name is type-gated the way the read
is" - a sentence that was true only as long as somebody kept it true by hand. **Widen the read
without the report and `<doNotPerform value="1"/>` on a `ServiceRequest` is exactly as invisible as
`value="true"` was before this slice**: the previous STOP-THE-LINE, reproduced on a new type by the
fix to this one. Structure beats the sentence: they cannot drift now.

## Axis 2 in one line

The negation comes from the walk (`SafetyWalk.doNotPerform`), which visits the entry node **plus
every node carrying its own `resourceType`** - the same window `checkArrayWrapping` and the
unreadable report already use. `readDoNotPerform` stays the root read behind the **convenience**
field, exactly as `status` beside it is root-only. **`readSafety(bundle).doNotPerform` is therefore
`undefined` while `negations` holds `do-not-perform`, on purpose**; the readout's own contract says
branch on `negations`.

**`safeToSummarize` does NOT move for a value that IS read**, and that is not an oversight: the
refusal channel is for values this library cannot read. Reading it and surfacing it loses nothing.

## Declared, NOT folded in - each its own slice

- **`not-done` is also a `Procedure` / `MedicationAdministration` status in R4**, and both read
  `negations: []` today. Same class, different element; each status gate needs its own grounding of
  which types carry that code. Pinned in both states.
- **Every negation except `doNotPerform` is still root-only.** A retracted `Observation` inside a
  `Bundle.entry` leaves the Bundle's `negations` empty. Pinned.
- **The array-wrapper report keeps its cardinality table.** `{"resourceType":"ServiceRequest",
  "doNotPerform":[true]}` is now read through the wrapper and the negation surfaced, but the wrapper
  itself draws no `ARRAY_WRAPPED_SCALAR`, because reporting one is an `error` and that stays where a
  cardinality is known. Strictly better than base (which surfaced nothing), and pinned as a residual.
- **Scope stops at resource roots**, not backbone elements: `MedicationRequest.dosageInstruction[0]
  .doNotPerform` reads nothing. Pinned.

## The count, and the sweep

`status.ts` (x3, not the x2 the item named), `codes.ts`, `validate/safety.ts` (x2),
`validate/validate.ts`, `test/validate-safety.test.ts` and `README.md` all said **"the six safety
resource types"** over a set holding **seven**, and `codes.ts`'s copy rendered into
`dist/index.d.ts`. **Cut, not corrected to "seven"** - a number written down here was wrong for days
and the next reader does not re-check. `dist/index.d.ts` and `dist/index.d.cts` verified at 0
occurrences after the build.

**The sweep also caught two carriers the item did not name and the site-only fix would have missed:**
the live `CHANGELOG.md` `[Unreleased]` entry and the **pending changeset**
`.changeset/olive-herons-report.md`, both of which said the read's element is
`MedicationRequest.doNotPerform`. Both are unreleased prose describing today's behaviour, so both are
corrected rather than preserved. The historical `CHANGELOG.md` release entry for the Phase-3 layer is
left alone: it *enumerates* its six groups and is true at its own site.

## Measurement

- **Red at base: 15 of 23** new assertions, in a real detached base worktree at `f0289a2`; **23 of 23
  at head.** The 8 that pass in both states are deliberate pins, named in the test file: the
  `MedicationRequest` pair that already worked (the control that says nothing broke), the negation
  ordering, the absent element, `noKnownAllergy`'s gate, the status-code gates, the other negations'
  root-only scope, and the backbone-element boundary.
- **Non-vacuity by mutation, 7 of 7 red at least one test:** re-gate the root read (5); re-gate the
  walk (10); gate **only** the report half, i.e. the drift this design forbids (2); undo axis 2 (5);
  negate on a written `false` (1); run the check past resource roots (1); make the convenience field
  deep (3).
- **Suite: 65 files / 1,346 tests at base -> 66 / 1,369 at head**, and 1,369 - 1,346 = 23 is exactly
  the new file, so **no existing test moved** except the two characterization pins over the type gate
  (`xml-lexical-boolean.test.ts`, `xml-unreadable-boolean.test.ts`), which this closes and therefore
  rewrites. Closing a pinned gap MUST red its pin, and both did.
- **`verify.sh fhir` green**, `ran:` audited at 11 steps (`licenses typecheck lint format:check
  phi-scan check:no-emdash check:no-internal-refs test:coverage build attw`) with zero `(FAIL)`.
  `pnpm differential:read`: **0 readings moved, 0 regressions.**
- Corpus caveat, as on every slice here: hand-authored JSON/XML fixtures, mutations and hand-built
  probes, **not** the R4 published-examples corpus.
