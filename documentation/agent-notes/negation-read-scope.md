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
  **CLOSED 2026-08-09** by the next slice, which did that grounding: an R4 census, not this slice's
  direction argument, which does not transfer to a status *code*:
  [`negation-status-codes.md`](negation-status-codes.md).
- **Every negation except `doNotPerform` is still root-only.** A retracted `Observation` inside a
  `Bundle.entry` leaves the Bundle's `negations` empty. Pinned.
  **CLOSED 2026-08-09** by the slice after next, on FHIR's `?!` modifier rule rather than on this
  slice's direction argument alone: [`negation-read-scope-depth.md`](negation-read-scope-depth.md).
  `no-known-allergy` stays root-scoped there, and that is now the declared residual.
- **The array-wrapper report keeps its cardinality table.** `{"resourceType":"ServiceRequest",
  "doNotPerform":[true]}` is now read through the wrapper and the negation surfaced, but the wrapper
  itself draws no `ARRAY_WRAPPED_SCALAR`, because reporting one is an `error` and that stays where a
  cardinality is known. Strictly better than base (which surfaced nothing), and pinned as a residual.
- **Scope stops at resource roots**, not backbone elements: `MedicationRequest.dosageInstruction[0]
  .doNotPerform` reads nothing. Pinned.

## The count, and the sweep

`status.ts` (x3, not the x2 the item named), `codes.ts`, `validate/safety.ts` (x2),
`validate/validate.ts`, `test/validate-safety.test.ts` and `README.md` all said **"the six safety
resource types"** over a set holding **seven**, and copies of it rendered into `dist/index.d.ts` and
`dist/index.d.cts` (**0 at head**). **Cut, not corrected to "seven"** - a number written down here was wrong for days
and the next reader does not re-check. **And do not write the CARRIER count down either. FOUR attempts, four different
answers, every one of them defended at the time**: "8" tracked sites, then "3" dist occurrences,
then the gate's "6" reasoned from the export list, then a measured "5" - and pass 3 showed that last
one low too, because the grep that produced it could not match a phrase the JSDoc had wrapped.
**THE COUNT IS NOT WRITTEN HERE, AND THAT IS THE WHOLE FINDING.** The only number that survives is
**0 at head**, checked wrap-tolerantly in both declaration files. **Grep wrap-tolerantly or do not
grep**: normalise newlines AND the JSDoc ` * ` continuation before matching, or the phrase that
wraps mid-sentence reads as absent, which is fail-open and is exactly the defect the count exists to
catch. That is how `README.md`'s copy hid from the first sweep.

**Four carriers beyond the sites the item named. The sweep found two; THE GATE FOUND THE OTHER TWO,
AND THEY WERE THE WORSE PAIR.** The sweep found the live `CHANGELOG.md` `[Unreleased]` entry and the
**pending changeset** `.changeset/olive-herons-report.md`, both saying the read's element is
`MedicationRequest.doNotPerform`; both are unreleased prose describing today's behaviour, so both
were corrected rather than preserved. **What the sweep missed is the pair the fix itself falsified**:
the JSDoc on the **exported** `unreadableBooleans` (which renders into `dist/index.d.ts`) and the
same paragraph on `README.md`, the npm front page, each stating that the report window is
*deliberately wider than the read* - true at base, false the moment the read widened, and a direct
contradiction of `CLAUDE.md`'s own "the read window and the report window must be the same window".
**The lesson is sharper than "sweep wider": grep for the sentences your change makes FALSE, not only
for the sentence the item quoted.** A file being edited by the slice is no protection - `README.md`
was edited, 200 lines above the stale paragraph. Both were CUT, not qualified. The historical `CHANGELOG.md` release entry for the Phase-3 layer is
left alone: it *enumerates* its six groups and is true at its own site.

## Measurement

- **Red at base: 15 of 23** new assertions, in a real detached base worktree at `f0289a2`; **23 of 23
  at head.** The 8 that pass in both states are deliberate pins, named **in the test file itself**,
  five under their own `describe` and three commented in place: the
  `MedicationRequest` pair that already worked (the control that says nothing broke), the negation
  ordering, the absent element, `noKnownAllergy`'s gate, the status-code gates, the root-scoped
  convenience fields, and the backbone-element boundary. (That sixth pin read "the other negations
  are root-only" until the slice that closed it re-keyed it; the re-key is recorded in the test.)
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

---

# The case/whitespace gap: DISCLOSE, DO NOT NORMALISE (2026-08-09)

Base commit `fa5bfd8`. The last residual `#82` filed against this arc, and the one that needed a
direction call before it could be built at all, because **the behaviour it complains about is
spec-correct.**

## 🛑 THE TRAP, AND IT IS THE ONE A FUTURE READER WILL WANT TO BREAK

**Never coerce, trim or case-fold a value into a negation code.** `isNearMissCode` decides a
**diagnostic**, never a reading; it is asked only *after* the exact match has already failed, and
nothing anywhere turns the value it describes into the code it resembles. Making the read tolerant
would be the **laundering class this package refuses everywhere else**: a non-conformant document
accepted as though it were conformant, and a negation handed to a caller that its sender never
spelled. Fix at the READ, never the reader. The sibling precedents are `x12`, which leaves
whitespace-only control numbers padded **by design** because "trimming is a normalisation rule and no
source states one", and `dicom`, which ships **a disclosure, not a bound**.

**The silence was the defect. The strictness is not, and must not be "finished".**

## The census WAS the slice, and the filed line understated the class again

The item named `"NOT-DONE"`, `" not-done"` and `entered-in-error`. Measured over the codes derived
from `src/`, at every element and every resource root each is read at, every case variant and every
surrounding-whitespace form was **SILENT** - no negation, `safeToSummarize: true`, nothing on any
channel. So the class was every `?!`-modifier-element negation code this layer classifies, on
`status` **and** on a `verificationStatus` coding, at the entry root, in `Bundle.entry` and in
`contained`, over space / tab / LF / CR / leading / trailing / both / any case.

**One axis does not exist and inventing it would be wrong:** SNOMED `716186003` is digits, so case
cannot vary it at all. Derive the codes from `src/`; never write the set down.

## 🛑 THE CLAIM THAT WOULD HAVE BEEN FALSE, in `#83`'s "understating" direction

**`do-not-perform`, the one BOOLEAN negation, ALREADY had this disclosure.** `<doNotPerform
value="TRUE"/>` and `value=" true"` have landed on `unreadableBooleans` under
`safeToSummarize: false` since that channel shipped. So *"this is the first time the package records
a negation value it declined"* is **false**, and it is false in the flattering-to-caution direction
that `#83` pass 1 was refuted for. The true, narrower claim is the one shipped: **the `code`-valued
reads had no complement; the boolean one did.** Pinned in both states in the test file so the claim
cannot drift back.

## Why the two halves are not the same shape, stated rather than blurred

The `unreadableBooleans` channel is about a value that could not be read **at all** - `doNotPerform`
reads `undefined`, which is what an absent element reads too. This one is about a value that **is**
read and **is** surfaced on `status` / `verificationStatus` unchanged; what fails is the
**classification**. Nothing is lost. Do not describe it as a data loss, and do not fold it into the
module docblock's five "shapes FHIR does not define" - it is not one of them.

## ⚖️ `no-known-allergy` is OUTSIDE the disclosure, and the reason is architectural, not timidity

`AllergyIntolerance.code` is deliberately absent from `NEGATION_CODE_READS`. Adding it would put a
near-miss disclosure at **every resource root** while an *exact* SNOMED `716186003` at a nested root
is read by **nothing at all** - so the library would **report the miss more loudly than the hit**.
That is the same boundary that keeps `no-known-allergy` off the walk: it is a *positive* assertion,
the one negation whose surfacing can make a caller **less** careful, where an absent one reads as
*unknown*. Pinned in both directions. **Do not "finish the job" by adding it.**

## Read scope and report scope are the same scope BECAUSE THEY ARE THE SAME TABLE

`NEGATION_CODE_READS` holds the element, the codes matched exactly on it, **and the reader** - the
same `primitiveStrings` / `safetyCodingsOf` the matches themselves go through. The disclosure is
derived from it, inside `checkNegations`, so it inherits that function's window by construction
rather than by a second copy of the condition. A test iterates the table and asserts of every entry
that the exact code **is** classified there, so the table cannot drift into describing a read that is
not there.

**Whitespace is R4's own four-character class (`[^\s]+([\s][^\s]+)*`, XML Schema's `\s`), NOT
JavaScript's.** A no-break space and a byte-order mark are ordinary characters inside a conformant
`code`, so trimming one would call a value non-conformant that R4 accepts. Pinned in both states, and
widening it to `/\s/` reds a test.

## 🛑 Measurement, and the shape of the count that was ALMOST published

**27 of 35 red at base**, in a real detached base worktree at `fa5bfd8`; 35/35 at head. **Of those
27, five are red only because the symbol they name does not exist at base** (the two table-integrity
tests and the three head-only channel-name pins), so **22 of 35 are red for a behavioural
difference.** Reported that way on purpose.

**The first draft of this test file measured 31 of 35, and that figure was wrong in the flattering
direction** - the both-states pins were written as `expect(...nearMissNegationCodes).toEqual([])`,
which goes red at base for the trivial reason that the field reads `undefined`, pinning **nothing**.
They were rewritten onto `safeToSummarize` and `negations`, which both states have and which are
`true` / empty only if the channel is empty. **A both-states pin asserted through a field the base
commit does not have is not a both-states pin.** This is the second time in this arc a count
overstated what was held down; the remedy both times was to restructure the tests, not the prose.

**8 both-states pins, named in the test file** under their own `describe` with the reason written
there: the non-negation padded code, the not-quite-a-negation value, the R4-vs-JS whitespace set,
every conformant document, the backbone-element boundary, `no-known-allergy`'s two directions, the
boolean negation's existing channel, and `valid` not moving.

**Non-vacuity by mutation - what is held down, named, never a total:** widen the whitespace set to
JavaScript's `\s`; drop the case fold; drop the whitespace strip; drop the exact-value guard so an
exact code also reports; remove the channel from `safeToSummarize`; remove it from
`assertSafeToSummarize`'s refusal; narrow the disclosure to the entry root; drop `verificationStatus`
from the table; narrow the `status` reader to one value so a wrapper and a shadowed member are
missed; add `AllergyIntolerance.code` to the table. **Every one reddened at least one test; none
survived.**

**Negative control is DEGENERATE here and is reported as such**: `@cosyte/hl7` provides **0 of the 13
symbols** this file imports, so all 35 assertions fail at import for a reason that discriminates
nothing about behaviour. The red-at-base fraction and the mutations are the real evidence. Do not
quote an hl7 control on this repo as though it graded anything.

**Corpus caveat:** hand-authored fixtures, mutations and probes - **not** the R4 published-examples
corpus.

## Residual raised by the work, filed not absorbed

`{"resourceType":"Procedure","status":["NOT-DONE"]}` gets the near-miss location but **no
`ARRAY_WRAPPED_SCALAR`**, because `arrayWrappedScalars` is scoped to a cardinality table on the
safety resource types and `Procedure` is not one. Unchanged at both states, already filed against the
array-wrapper rule by `#82`. Head is **strictly better** than base there, not complete. Pinned.
