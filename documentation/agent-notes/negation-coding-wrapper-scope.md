# The `Coding` wrapper report moves to the negation read's own window

`FHIR-NEGATION-READ-SCOPE-RESIDUALS`, 2026-08-10. Base commit `5c575e5`. `conformance-refuter`
**REFUTED -> NOT REFUTED**, 2 passes.

**Provenance.** FHIR R4 `datatypes.html` (`Coding.system` and `Coding.code`, both `0..1` on the
`Coding` datatype) and `json.html` §2.6.2.2 (an array spells a repeating element and nothing else).
A profile may only constrain, never relax, so no profiled instance widens either cardinality. Both
were read, not recalled; nothing here rests on a claim about which resource types carry the element.

Closes the `Coding`-level half of the array-wrapper residual, filed by the depth slice's gate as
"the `Coding`-level twin of the same residual" and re-filed by the two slices after it. The
**element-level** half stays open on purpose; its reason is at the bottom.

## What was wrong, on plain conformant-shaped JSON

At `5c575e5`:

| document | at base |
|---|---|
| `{"resourceType":"ServiceRequest","verificationStatus":{"coding":[{"code":["refuted"]}]}}` | `negations: ["refuted"]`, `arrayWrappedScalars: []`, `safeToSummarize: true`, `valid: true` |
| `{"…","verificationStatus":{"coding":[{"code":["entered-in-error","x"]}]}}` | `negations: []`, `arrayWrappedScalars: []`, `safeToSummarize: true`, `valid: true` |

The first resolved a clinical code **through** a shape FHIR JSON does not define and handed it back
with no diagnostic anywhere. The second is the sharper one and runs the other way: a multi-position
wrapper is deliberately **left unread**, because `system` and `code` feed a cross-product and taking
more than one value on either side pairs values the sender wrote in different positions and asserts
a coding it never wrote -- one of which is a recorded "no known allergy", a *positive* clinical
assertion. So the retraction was **neither surfaced nor reported**, and the readout affirmed over a
value the library knowingly declined to read. Both held at every resource root, inside `contained`
and a `Bundle.entry`, and at an entry root carrying no readable type.

## 🛑 The read had escaped the report, and the module said the opposite about itself

The negation reads were dropped out of `SAFETY_RESOURCE_TYPES` (a gate that never looks reports
nothing, indistinguishably from a clean read). `checkCodingWrapping` was not: it ran only under
`clinical && isSafetyType`. So the un-gated read used `safetyCodingsOf`'s unwrap at roots the report
did not cover -- **exactly what `safetyCodingsOf`'s own JSDoc said must never happen** ("A read that
unwrapped outside that window would resolve a clinical code out of an encoding FHIR JSON does not
define and hand it to a caller with no diagnostic anywhere"), and what `CLAUDE.md`'s standing trap
says ("if you ever widen the coding unwrap, widen `checkCodingWrapping` first, **in the same
change**"). The widening happened in a later slice and the report did not follow.

## 🛑 The licence is DATATYPE cardinality, and it is the fourth distinct one in this arc

The three predecessors used **direction** (a read that can only add), an **R4 census** (which types
carry a status code), and the **`?!` modifier rule** (the obligation attaches to the resource, not
the position). **None of them licenses this one.** What does:

> `Coding` is a **datatype**. Its `system` and `code` are `0..1` *wherever a `Coding` appears*
> (datatypes.html). So an array at either is non-conformant whatever resource carries it and
> whatever the enclosing element's own cardinality is. No question about the enclosing resource
> arises, so no per-resource model is needed.

That is precisely what is **not** true one level up, where R4 defines repeating elements under the
same names (`Questionnaire.code`, `ElementDefinition.code`, both `0..*`). The element-level table
therefore keeps its type scoping, and the two halves are now stated as the **pair** they are rather
than blurred into one window -- the blurring is what let the gap survive three slices.

## The shape of the fix

- The read table (`NEGATION_CODE_READS`) gains a `codings` flag, beside `values` and `unread`. The
  report is decided **in the same loop over the same table**, so read scope and report scope cannot
  drift into covering different elements. `verificationStatus` carries it; `status` does not, its
  read being a primitive one.
- The de-duplicating `report` callback moved from inside `checkArrayWrapping` up to
  `checkResourceRoot`, and both halves share it. A safety type's `verificationStatus` is covered by
  **both** windows, and a location a caller can act on once must arrive once.
- **Nothing in the read moved.** Not one value reads differently; the diff is a report and prose.

## Measurement

- **11 of 25 new cases red at base**, in a real detached base worktree at `5c575e5`; 25/25 at head.
- **One further case is red at base only because the base table has no `codings` field** (the
  vacuity assertion over the derived element lists). Reported separately, **not counted** as
  behaviour. Every other assertion is written through fields the base commit has
  (`arrayWrappedScalars`, `safeToSummarize`, `valid`, the issue list, the XML write refusal), so it
  measures a behaviour rather than the presence of a symbol. **This slice exports no new symbol.**
- **12 both-states pins, named in the test file**, not counted in a total: the exactly-once
  de-duplication on `Condition`; a conformant document; `Questionnaire.code`; the `clinicalStatus`
  surviving gap in **both** directions (read through, and declined); a SNOMED "no known allergy"
  `code` on an off-table type; a `Coding` wrapper at a `code`-typed `status`; a `verificationStatus`
  below a resource root; the derived `status` row; and the three element-level residuals
  (`ServiceRequest.doNotPerform`, `Procedure.status`, an array-wrapped `verificationStatus` element).
- **Nine mutations, none surviving, named rather than totalled:** drop the `codings` flag; invert the
  flag test; re-gate the new report on resource type; give the negation half its own de-duplication
  sets; report only single-position wrappers; report only multi-position ones; drop the
  XML-unwritable half; read only the first written member; run the report for every table row
  regardless of the flag.
- Suite **72 files / 1,553 tests → 73 / 1,578**, exactly the new file, and the count is offered as
  *consistent with* no existing test moving rather than as proof: no existing test file was edited.
- **The pass-1 remedy is prose plus one test.** `src/` changed only inside comment blocks, and the
  transpiled `dist/index.mjs` / `.cjs` are **byte-identical (sha256) to the graded sha `e04a997`**,
  so nothing ungraded ships as behaviour and the mutation result above still stands.
- `differential:read`: **0 readings moved**, 0 `valid` false→true, 0 `safeToSummarize` false→true, 0
  negations / retractions / read diagnostics lost. **That 0 is vacuous by construction** and is
  reported as such: no corpus document carries an array-wrapped `Coding` member, so none reaches the
  changed code. The harness prints that caveat itself.
- **Corpus caveat:** hand-authored fixtures, mutations and probes -- **not** the R4 published-examples
  corpus.
- **The `@cosyte/hl7` negative control is DEGENERATE and is reported as such, not counted as a
  pass**: this slice adds no symbol, and every symbol the test file imports (`readSafety`,
  `arrayWrappedScalars`, `parseResource`, `validateResource`, `serializeResourceXml`,
  `assertSafeToSummarize`, `SERIALIZE_ERROR_CODES`, `FhirSafetyError`, `FhirSerializeError`,
  `NEGATION_CODE_READS`) is absent from that package, so the file cannot even load there. A control
  that cannot fail is not a control.

## 🛑 Pass 1's major, and it is this lineage's shape landing on the slice that was fixing it

**The slice's own licence sentence was false, published into five carriers, and it deleted the
accurate version of itself on the way past.** It claimed `clinicalStatus`'s read is type-scoped, so
its wrapper is reported wherever it is read. It is not. `readSafety` fills the `clinicalStatus`
convenience field with `safetyCodeOf(getProperty(resource, "clinicalStatus"), clinicalSystemFor(rt))`
and `clinicalSystemFor` chooses a **preferred system**; it gates nothing. Measured, identical at base
and head: `{"resourceType":"Bundle","clinicalStatus":{"coding":[{"code":["active"]}]}}` reads
`clinicalStatus: "active"` with `arrayWrappedScalars: []`, `safeToSummarize: true`, `valid: true`;
and the multi-position twin declines the value with no location either. **That is verbatim the harm
this slice's own headline uses to motivate itself, on the sibling element.**

Worse than the overclaim: the base text the slice edited to mark the residual closed
(`agent-notes.md`) **named `readSafety`'s `clinicalStatus` convenience read as one of the un-gated
callers.** The slice fixed the `verificationStatus` term of that enumeration and **dropped the
`clinicalStatus` term rather than carrying it forward**. The repo's own record named it; the edit
deleted the name and shipped the opposite.

**The behaviour is `PRE-EXISTING`** (byte-identical read path at `5c575e5`); what was `INTRODUCED`
was the claim. **Remedied by correcting the claim, not by growing the guard** -- marking
`clinicalStatus` `codings` would widen a report to rescue an overclaim, and it is not a negation read
at all. Carriers corrected: `README.md`, `CHANGELOG.md` and the pending changeset (all three ship, or
will), `safetyCodingsOf`'s note in `src/`, the `agent-notes.md` disclosure restored to its
half-closed form, and the both-states test pin **re-titled and given an assertion on
`SafetyReadout.clinicalStatus` itself** -- it previously asserted only `arrayWrappedScalars` and
`safeToSummarize`, so it never looked at the field that disproved its own title. A pin that cannot
see the thing it claims is not a pin.

Two `INTRODUCED` minors from the same pass, both prose: the `nearMissNegationCodes` readout field
said `arrayWrappedScalars` reaches every root for the `Coding` members of "those same elements" when
`status` is not one of them (it ships in `dist`), and `arrayWrappedScalars`' `@returns` still
promised **document order**, which the two halves running one after the other can violate at a root
that emits from both. Corrected rather than re-engineered; the ordering of a diagnostic list is not
load-bearing and sorting it would hide which half emitted what.

## The claim sweep, and what it caught

Three statements the package shipped **about itself** were false at base, all in the reassuring
direction (they described a discipline the code was not keeping):

1. `unreadableBooleans`' JSDoc -- "**The window is every resource root**, which is
   `arrayWrappedScalars`' window and is **the same window the negation read uses**". It was not:
   that report's element-level half is type-scoped and the negation read is not.
2. `nearMissNegationCodes`, in **both** its readout-field doc and its collector doc -- the same
   equality, stated twice.
3. `safetyCodingsOf`'s note -- "the reporting rule covers exactly one window … **Read scope must
   equal report scope** … every caller of this must be reading one of the windowed elements off a
   resource root". The negation read had been a caller outside that window for three slices.

Carriers checked, and the two that carried them: **`README.md`** (both #1 and, as a whole paragraph
headed *"One asymmetry is deliberate and worth stating rather than glossing"*, a defence of the
defect itself) and the generated **`dist/index.d.ts` / `.d.cts`** (#1 and #2 -- verified **0** at head
by grepping the built artifacts, not the source). Also checked and clean of these: the pending
changesets, `docs-content/`, the test comments (theirs are about the *element-level* residual and
stay true), and `CLAUDE.md` (its trap is the one this slice honours, and needs no edit -- it stands
at 27,997 / 28,000 untouched). **`CHANGELOG.md` carried the asymmetry paragraph in the present tense
under `[Unreleased]`, so it was cut by deletion rather than annotated** -- this package has never
published, so nothing there is a released record.

`safetyCodingsOf` is **not** exported from the package, so #3 never reached `dist`. Recorded because
"it is in `src`" and "it ships" are different questions and only the second was ever checked here.

## 🔴 Left open, with the reason

- **The element-level wrappers.** `{"resourceType":"ServiceRequest","doNotPerform":[true]}` and
  `{"resourceType":"Procedure","status":["not-done"]}` are still read through and surfaced with no
  `ARRAY_WRAPPED_SCALAR`, as is an array-wrapped `verificationStatus` element. Closing them needs the
  cardinality of the element **names** `status` / `doNotPerform` / `verificationStatus` at a resource
  root on every R4 type that defines them -- an R4 census, which is a different licence and its own
  change. Pinned in both states so it cannot move in silence.
- **A `Coding` wrapper at a `code`-typed `status`** draws nothing, and that is deliberate: nothing
  reads through it (a `CodeableConcept` at `status` is exempt from the unreadable-shape channel, its
  members all being ones FHIR spells somewhere), so reporting the wrapper would be a report *wider*
  than the read -- this slice's own defect inverted. Pinned. The silent read at that position is a
  separate, already-filed residual.
- **`no-known-allergy` stays root- and type-scoped**, read and report alike. It is the one negation
  whose surfacing makes a caller *less* careful, absence reading as *unknown* rather than *none*.
  Pinned, in both directions. Do not "finish the job".
- **The `clinicalStatus` convenience read is the surviving half of this very rule**, and it is the
  sharpest thing left open here: filled off **any** resource root, so on a type the cardinality table
  does not know it unwraps a single-position wrapper, or declines a multi-position one, with no
  location either way. It reaches that one field and nothing else: never `negations`, never `valid`,
  never `noKnownAllergy`, whose read *is* type-gated. Identical at base. **Closing it is a change to
  a convenience READ, not a widening of this report** -- `clinicalStatus` is not a negation and does
  not belong in the read table -- so it is its own slice. Both directions pinned in both states.
- **The validator's `RETRACTED_RESOURCE` is still root-scoped and type-gated.** A different layer
  with a different contract; untouched here rather than absorbed.
