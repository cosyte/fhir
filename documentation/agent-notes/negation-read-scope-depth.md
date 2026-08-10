# Every negation reaches every resource root (2026-08-09)

Base `3fa61aa`, closing the second residual of
[`negation-read-scope.md`](negation-read-scope.md) and the first of
[`negation-status-codes.md`](negation-status-codes.md): they were the same gap read from two sides.
Item `FHIR-NEGATION-READ-SCOPE-RESIDUALS`.

## The cursor

**Plain conformant JSON, in the container the standard defines for carrying resources:**

```
Bundle{ entry[0].resource = Observation{status:"entered-in-error"} }        -> negations: []
Bundle{ entry[0].resource = Procedure{status:"not-done"} }                  -> negations: []
Bundle{ entry[0].resource = MedicationStatement{status:"not-taken"} }       -> negations: []
Bundle{ entry[0].resource = AllergyIntolerance{verificationStatus refuted}} -> negations: []
Patient{ contained[0] = any of the above }                                  -> negations: []
```

each under `safeToSummarize: true` with `assertSafeToSummarize` clean, while the identical `Bundle`
carrying `doNotPerform: true` returned `negations: ["do-not-perform"]`: `#81` having moved that one
negation onto the walk and left the rest behind on purpose. **A retracted record read as data.**

## 🛑 What licenses reading a NESTED resource is the `?!` RULE, not the depth

The three element NAMES moved here are ones R4 flags `?!` on the types that define them (`status`,
`verificationStatus`, `doNotPerform`; citations on `checkNegations`), and
a consumer may never process a modifier element as if it were absent. **That is a claim about the
NAMES, not about every node the walk hands them.** The window is a property-name test (`resourceType`
is written here), inherited from `checkArrayWrapping`, not a proof that the node is a resource: R4
gives `ExampleScenario.instance` a `resourceType` element of its own. Additive either way, and
declared on the function rather than claimed away. **That obligation attaches to
the resource carrying it, not to the position the resource occupies in a document**: a `Bundle.entry`
order and a `contained` order are resources. Only _then_ does the direction argument apply, exactly
as at the entry root: the read can only ADD a negation, never retire a finding, never flip `valid`.

**Do not restate this as "read deeper is always safe."** It is a rule about which ELEMENTS carry an
obligation, which is why `no-known-allergy` does not move (below).

## 🛑 The read was NOT widened past its refusal, and here the check runs the OTHER WAY

`#81` paid for the rule that a read and its refusal move together. **Check the direction before
assuming you must move both.** Here the location channels that record a value this library could not
read (`droppedText` and `nestedArrays` at every node, `shadowedProperties` at every complex,
`unhandledModifierExtensions` at every property, `arrayWrappedScalars` and `unreadableBooleans` at
every resource root) **already covered at least every location this read moved into**, so the refusal window was and remains no narrower than the read. Nothing needed
widening; what was needed was the evidence, and it is a **pin at one nested location from both
sides**: `<status>not-done</status>` (character data the reader drops, xml.html §2.6.1) is reported
there and adds no negation, and `<status value="not-done"/>` at that same location is read.

**The reads themselves are byte-identical to the ones already performed at the entry root**
(`isRetracted`, `statusSpells`, `safetyHasCodeAnySystem`), called on more nodes rather than
rewritten. So **no document's reading moves; only the set of nodes the reading is applied to.**
`checkArrayWrapping` and `checkNegations` are now reached through one `checkResourceRoot`, so "which
nodes are a resource root" is decided in one place for the report and the reads together.

## 🔴 `no-known-allergy` DELIBERATELY does not move: it is the one whose ABSENCE is cautious

Two independent reasons, and the second is the one that generalises:

1. It is read off `AllergyIntolerance.code`, an element R4 does **not** flag `?!` at all. It is this
   library's own first-class concept, so the modifier rule above does not reach it.
2. **It runs the other way from every negation on the walk.** Surfacing a recorded "no known allergy"
   from somewhere inside a document can make a caller **less** careful about a patient; leaving it
   unsurfaced reads as _unknown_, which is the cautious answer. So the direction argument that
   licenses the others argues **against** this one.

Pinned in both states, so closing it later must red those. It is the same asymmetry the type gate
already encodes, seen from the scope side.

## Root vs document, and it is now a stated contract

**🛑 NAME THE SET. `negations` is not "the only field that covers the document" and a draft of this
slice shipped that universal into `dist/index.d.ts` before the gate cut it.** The readout has **two**
groups, and the line between them is not depth but **whether a value can say where it came from**:

- **Document-wide, and ALREADY WERE:** the location channels `unhandledModifierExtensions`,
  `shadowedProperties`, `arrayWrappedScalars`, `nestedArrays`, `droppedText`, `unreadableBooleans`,
  and the `safeToSummarize` derived from them. They carry FHIRPath locations, so a nested finding has
  an address, and **`assertSafeToSummarize` has always refused over a `Bundle`'s entries.** Untouched
  here: this is exactly why the refusal needed no widening.
- **Single-valued, and therefore root:** `resourceType`, `status`, `clinicalStatus`,
  `verificationStatus`, `doNotPerform`, `retracted`, `noKnownAllergy`. One value cannot say which
  resource it came from. A `Bundle` is not retracted when one of its entries is, so **`retracted`
  implies `entered-in-error` is on `negations`, never the other way round.**

`negations` is the read that crosses the line, and it can because it is a **set with no locations**
in a **fixed order** (`NEGATION_ORDER`): a kind says the same thing once however many resources
assert it, and entry order must not decide the order a caller sees.

## Measurement

- **Red at base: 21 of 32** new test cases, in a real detached base worktree at `3fa61aa`; **32 of 32
  at head.** The 11 both-states pins are named **in the test file**, five under their own `describe`,
  three commented in place, three in the declared-gap section.
- **Non-vacuity by mutation, 9 of 9 red at least one test.** Recorded as WHAT IS HELD DOWN, never as
  a total: the four status/coding reads at the walk's window; the walk window itself (`isRoot` only);
  `retracted` staying the root read; `no-known-allergy` staying off the walk; the fixed kind order;
  the de-duplication; the resource-root boundary (run past it onto every complex); the absence of a
  type gate on the nested read; reading every written member rather than the first.
- **Suite: 67 files / 1,391 tests -> 68 / 1,423**, and 1,423 - 1,391 = 32 is exactly the new file, so
  **no existing test moved**: the two characterization pins over the gap were re-keyed in place, one
  test each.
- **Negative control: all 32 cases fail** against `@cosyte/hl7` 0.0.10 in a separate scratch package.
- **CORPUS CAVEAT on every zero here:** the fixtures are hand-authored plus mutations and probes, not
  the R4 published-examples corpus.

## The sweep, and what it corrected BY DELETION

Sentences the fix **falsified**, not just the sites the item quoted:

- `README.md`: _"`doNotPerform` goes further and is read at any resource root"_: true of one negation
  when written, false as a distinction the moment the others joined it.
- `SafetyReadout`'s docblock: _"`negations` (and `retracted`) are the authoritative safety reads"_:
  the two now answer different questions, so the pairing was cut.
- **The live `CHANGELOG.md` `[Unreleased]` entry AND the pending changeset `tame-pears-shake.md`**,
  both stating a `Procedure` in a `Bundle` entry still leaves `negations` empty. **Corrected by
  DELETING the clause, never by rewording it**: a changeset freezes into `CHANGELOG.md`.
- Verified **0** in `dist/index.d.ts` and `dist/index.d.cts`, grepped wrap-tolerantly (normalise
  newlines and the JSDoc `*` continuation, or a wrapped phrase reads as absent, which is fail-open).

## Declared, NOT folded in: each its own slice

- **`no-known-allergy` stays root-scoped** (above). The residual this slice creates on purpose.
- **The array-wrapper report keeps its cardinality table**, now reachable at one more location: a
  nested `{"resourceType":"Procedure","status":["not-done"]}` surfaces the negation and draws no
  `ARRAY_WRAPPED_SCALAR`. Strictly better than base, which surfaced neither. Pinned, with the
  `Observation` half as the both-states control.
  **Gate pass 1 found the `Coding`-level twin of the same residual** -- **CLOSED 2026-08-10, see
  [`negation-coding-wrapper-scope.md`](negation-coding-wrapper-scope.md); the element-level half
  above is still open.** As found: a nested `FamilyMemberHistory` with
  `verificationStatus.coding[0].code: ["refuted"]` reads `negations: ["refuted"]` at head (`[]` at
  base) with `arrayWrappedScalars: []`, because `safetyCodingsOf`'s single-position unwrap now fires
  at a resource root whose type is outside `SAFETY_RESOURCE_TYPES`, where `checkCodingWrapping` does
  not report. Additive only (a negation appears; nothing is retired), same mechanism, one level down.
- **Exact-string matching still drops `"NOT-DONE"` / `" not-done"` silently**, at every window.
  Spec-correct (FHIR `code` is case-sensitive) but a Postel's-Law gap in a SAFETY read. Its own item.
- **The validator's `RETRACTED_RESOURCE` is still root-scoped AND type-gated**
  (`src/validate/safety.ts`), so a retracted entry inside a `Bundle` raises no issue even though the
  readout now classifies it. A different layer and a different contract (an issue is a report, not a
  read); untouched here rather than absorbed.
- `PRE-EXISTING`, raised by gate pass 1 and filed rather than absorbed: **a `status` written as a
  JSON OBJECT was invisible on every channel.** `{"resourceType":"Observation","status":
  {"value":"entered-in-error"},"code":{"text":"x"}}` read `retracted: false`, `negations: []`,
  `safeToSummarize: true`, `valid: true`, zero diagnostics, **identical at `3fa61aa`**. It is another
  of the encodings `src/safety/status.ts` enumerates, and it is what a generic FHIR-XML to JSON
  converter makes of `<status value="entered-in-error"/>`, the same traffic that docblock cites.
  Not `STOP-THE-LINE` (non-conformant input, and the value survives in the model).
  **🟢 CLOSED 2026-08-10**, `agent-notes/negation-unreadable-code-shape.md`: it draws
  `unreadableNegationCodes` and `safeToSummarize: false`. **`valid: true` is UNCHANGED and stays
  open** - the safety layer was that slice's window and it raised no `ValidationIssue`.
- `PRE-EXISTING`, untouched: `src/safety/codes.ts` still publishes a **set size** into
  `dist/index.d.ts`; and _"the negation read"_ stays **ambiguous** between the walk-scoped `negations`
  and the root-scoped convenience fields wherever it appears unqualified.

## ⚠ Budget

`CLAUDE.md` is at **28,000 / 28,000** and **was not touched**. No trap was needed: its existing
type-gate trap already says _"the read runs at **every resource root**; the convenience field stays
root-scoped like `status`"_ and _"`noKnownAllergy` is the opposite and stays gated"_, both of which
this slice makes true of every negation rather than one. **Do not add a line here to celebrate that.**
