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
module docblock's "shapes FHIR does not define" - it is not one of them. (That docblock's count was
removed 2026-08-10 when a further encoding joined the list; derive the set, never cite a number.)

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

**Whitespace is R4's own four-character class (`[^\s]+(\s[^\s]+)*`, XML Schema's `\s`), NOT
JavaScript's.** A no-break space and a byte-order mark are ordinary characters inside a conformant
`code`, so trimming one would call a value non-conformant that R4 accepts. Pinned in both states, and
widening it to `/\s/` reds a test.

## 🛑 PASS 1 REFUTED IT, and the finding was a FALSE POSITIVE ON A CONFORMANT DOCUMENT

The gate's sharpest finding was **not** a claim defect but a behavioural one, and it is the shape to
remember: **R4 permits TRANSLATION CODINGS beside the one a required binding's value set supplies**
(`terminologies.html`: at least one Coding SHALL be from the value set, "text can be provided as
well", additional codings permitted). So

```json
{"resourceType":"Condition","verificationStatus":{"coding":[
  {"system":"http://terminology.hl7.org/CodeSystem/condition-ver-status","code":"refuted"},
  {"system":"http://acme.example.org/legacy","code":"REFUTED"}]}}
```

is **conformant**, its negation **is** classified, and the first draft disclosed anyway and set
`safeToSummarize: false`. **A disclosure channel that fires on a document the library read correctly
and completely is a false positive, and it falsified the shipped sentence "Empty for every conformant
document".**

Closed by suppressing a near miss of code C at element E **where E also spells C exactly**. **Per
CODE, never per element** - `refuted` exact beside `ENTERED-IN-ERROR` must still report, because
nothing classified the retraction. Both directions are pinned, and both a per-element suppression and
no suppression at all red a test.

**The control that missed it exercised SINGLE-CODING conformant documents only**, so it discriminated
a narrower claim than the one shipped - the same shape `#82` pass 1 was refuted for. The both-states
control now carries the multi-coding document.

## 🛑 THE OTHER TWO PASS-1 MAJORS WERE BOTH CLAIMS IN THE REASSURING DIRECTION

**1. "the value is not lost, it is surfaced on `status` / `verificationStatus` exactly as written"
was FALSE three ways**, and it was the load-bearing sentence justifying treating this channel
differently from the loss channels. `status` and `verificationStatus` are **root-scoped and
preferred-system-first**; this channel is **document-wide**. So a near miss in `contained` leaves
`status` showing the ROOT's value (measured: `"active"` while the near miss was `"NOT-DONE"` one
level down), a nested one in a `Bundle.entry` leaves it `undefined`, and a second-coding near miss is
not the code `verificationStatus` shows. **The true claim is narrower: the codec KEPT the value, at
the element the location names. Walk the model there. It is not a promise the value reaches a
convenience field.** Corrected in `status.ts` (x3), `README.md`, `CHANGELOG.md`, the changeset and
this note.

**2. The `code` lexical-space argument is JSON-ONLY and was stated for "either wire format".** R4
derives `code` **in XML** from `xs:token` (`fhir-base.xsd`, `code-primitive`), and `xs:token` carries
`whiteSpace=collapse`, which strips surrounding whitespace **before** validation - so
`<status value=" not-done"/>` is schema-valid R4 and **is** the code for a schema-validating
consumer. Independently, XML 1.0 §3.3.3 attribute-value normalization turns a literal tab/LF/CR in
any attribute value into a space for every conformant processor. **This reader is schema-free and
does not collapse**, so it discloses rather than reads: fail-safe, and now a **declared limit** in
every carrier rather than a conformance claim. **Do not "fix" this by collapsing in the XML reader** -
that is the normalisation the whole slice refuses.

Minor, also corrected: the regex was quoted as `[^\s]+([\s][^\s]+)*` where R4 spells it
`[^\s]+(\s[^\s]+)*` (equivalent, but it was cited as verbatim, in ~7 carriers including
`dist/index.d.ts`); and the first remedy for `#83`'s stale channel enumeration **reversed `#83` pass
1's own fix** (naming the set WAS that fix), so the falsifiable clause was **deleted outright** from
both `CHANGELOG.md` and the pending changeset instead.

## Pass 2: NOT REFUTED, and the two minors it still found were both mine

Graded the remedy diff only. All six pass-1 findings confirmed closed, the suppression invariant
`suppressed(C at E) => C in negations` verified by brute force over 1,200 generated documents with
**0 violations**, and the note's red-at-base figures reproduced to the test.

Its two `INTRODUCED` minors, both corrected here and both the same shape as everything else in this
arc: **an absolute claim.** *"Empty for every conformant document read from JSON"* shipped in five
carriers while **the slice's own new test pinned a counterexample** - a `verificationStatus` carrying
`confirmed` from the standard system beside a local `REFUTED`. That satisfies `terminologies.html`
§4.1.5.1 (one coding SHALL come from the value set) and is non-conformant only under
`datatypes.html`'s descriptive "each coding is a representation of the concept", which carries **no
SHALL**. **The remedy used the permissive reading to justify the suppression and then asserted a
claim that survives only under the restrictive one.** The sentence is now qualified in all five
carriers; the guard was **not** grown, because over-disclosure is the fail-safe direction. The other
minor was a stale count in this file, in a paragraph the remedy itself re-counted.

**"FHIR `code` is case-sensitive" is imprecise and is deliberately left**: R4 says codes are case
sensitive *unless the code system specifies otherwise*. It bites only for a `Coding` from a caller's
own case-insensitive `CodeSystem`, and correcting it would push toward the coercion the direction
forbids.

## Passes 3 and 4: NOT REFUTED, and both found only my own prose

**Pass 3** caught the qualification added for pass 2 being **one notch WIDER than the truth, in the
cautious direction**: it admitted "a translation whose code *near-misses* a negation" as conformant,
but a near miss is case **or** surrounding whitespace, and the whitespace half is never conformant
JSON. **Only the case half can be.** Narrowed at all five carriers. **That is the understating shape
again** - the third time in this arc a claim erred toward caution and was still false.

It also caught the same edit leaving **unmatched `**` closers**: the rendered `CHANGELOG.md` entry
carried three stray literal asterisks and **lost the bold on the `do-not-perform` sentence**, and
`status.ts` carried one that ships verbatim into `dist/index.d.ts` / `.d.cts` and so into a
consumer's hover. **Prettier had ESCAPED one closer to `disclosure\*\*`, which is exactly why
`format:check` passed.** 🩺 **Nothing in CI reads rendered markdown, so the next such residue will
also ship.** Repaired with real openers, never another escape.

**Pass 4** (the cap) confirmed both closed at source **and in the built `dist/index.d.*`**, verified
the transpile byte-identical across the remedy, and exercised the narrowed claim against the built
library: every conformant-JSON firing observed is the case-only translation coding, and
`"refu ted"`, `"not- done"` and an NBSP-padded code are all conformant and all silent. The anchored
`CODE_WHITESPACE` is what stops internal whitespace manufacturing a second firing shape.

## 🔴 `PRE-EXISTING`, raised by the gate, filed not absorbed

**The XML reader performs no XML 1.0 §3.3.3 attribute-value normalization.**
`<status value="&#x9;not-done"/>` and a literal tab both reach the model as `"\tnot-done"`.
Unchanged at base, unchanged here, and its own item.

**`fhir/CLAUDE.md` still says "Two refuter passes max ... **No fourth** (ADR 0016)"**, which
contradicts the founder-settled cap of **FOUR** (2026-08-09). Not corrected here: that file is at
**exactly 28,000 / 28,000** and any edit moves the ratchet. Its own item.

**The BOOLEAN channel carries the identical un-scoped claim this slice just retired for `code`.**
`unreadableBooleans` says *"Empty for every conformant document, in either wire format"*
(`src/safety/status.ts`, shipped in `dist/index.d.*`) and `README.md` says it *"cannot fire on a
conformant document in either wire format"*. But `fhir-base.xsd` restricts `boolean-primitive` to
`xs:boolean`, whose `whiteSpace=collapse` facet is applied **before** the pattern, so
`<doNotPerform value=" true"/>` is schema-valid R4 XML and lands on `unreadableBooleans` under
`safeToSummarize: false`. **Verbatim at `fa5bfd8`, so it cannot gate this slice**, and the direction
is over-disclosure rather than a mis-read. Its own item; **do not fold it in.**

## 🛑 Measurement, and the shape of the count that was ALMOST published

**32 of 40 red at base**, in a real detached base worktree at `fa5bfd8`; 41/41 at head (the 41st is a
direct unit pin on the predicate, base-independent). **Of those 32, six are red only because the
symbol or channel they name does not exist at base** (the two table-integrity tests, the three
head-only channel-name pins, and the suppression case, whose base behaviour already matched), so
**26 of 40 are red for a behavioural difference.** Reported that way on purpose.

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
missed; add `AllergyIntolerance.code` to the table; remove the per-code suppression so a conformant
translated coding fires; widen that suppression to per element so a different code's near miss is
hidden. **Every one reddened at least one test; none survived.**

**One SURVIVED after the pass-1 remedy and was closed rather than explained away.** The per-code
suppression made the predicate's own `folded !== value` guard redundant *at its call site*: a value
equal to the code is a value the element spells exactly, so it is suppressed regardless. The guard
stays, because it is what the word "near" means, and it is now pinned by a direct unit test on
`isNearMissCode` instead of by a document. **A guard nothing checks is a guard that rots.**

**Negative control is DEGENERATE here and is reported as such**: `@cosyte/hl7` provides **0 of the 13
symbols** this file imports, so every assertion in it fails at import for a reason that discriminates
nothing about behaviour. The red-at-base fraction and the mutations are the real evidence. Do not
quote an hl7 control on this repo as though it graded anything.

**Corpus caveat:** hand-authored fixtures, mutations and probes - **not** the R4 published-examples
corpus.

## Residual raised by the work, filed not absorbed

`{"resourceType":"Procedure","status":["NOT-DONE"]}` gets the near-miss location but **no
`ARRAY_WRAPPED_SCALAR`**, because `arrayWrappedScalars` is scoped to a cardinality table on the
safety resource types and `Procedure` is not one. Unchanged at both states, already filed against the
array-wrapper rule by `#82`. Head is **strictly better** than base there, not complete. Pinned.
