# An XML-sourced profile's required elements are enforced (`ElementDefinition.min`)

Relocated out of `agent-notes.md` at write time (that file is at its archive budget). The cursor
stays there; this is the whole record.

## The defect, reproduced at `72cdee2` before it was touched

FHIR XML carries every primitive as the text of its `value` attribute (`xml.html` §2.6.1) and this
reader is **schema-free by design**, so `<min value="1"/>` reaches the model as the string `"1"`
where FHIR JSON's `"min": 1` reaches it as a number. `parseMin` matched **only** the number
(`instanceof FhirDecimal`), and a failed match reads as absence.

So an XML-sourced `StructureDefinition` declared its required elements and this library enforced
**none** of them, with nothing on any diagnostic channel to say so. The same profile, spelled the two
ways:

```
snapshot: Observation.subject 1..1, Observation.performer 2..*     instance: neither present

  JSON-sourced profile  -> valid: false   CARDINALITY_MIN @Observation.subject, @Observation.performer
  XML-sourced  profile  -> valid: true    no profile finding of any kind

both readings also carry `information: RESOURCE_NOT_MODELED @Observation`, which is the built-in
schema speaking and is unrelated; an earlier draft said "no finding at all" and was one finding out.
```

**The XML in that run is this package's own `serializeResourceXml` output, read back by its own
`parseResourceXml`.** A caller who changed format inside this library got a profile that had stopped
enforcing anything, and a verdict that moved `valid: false -> true`: a format change **upgrading** a
document's trustworthiness claim, which is the harm shape this lineage was opened for.

**The asymmetry that made it invisible: `max` was fine.** FHIR spells `max` as a *string* in both
formats, so `parseMax` goes through `primitiveString` and reads. Upper bounds enforced, lower bounds
silently not.

## Where the fix went, and why not one layer down

**At `parseMin`, in `src/profiles/structure-definition.ts` - never in the XML reader.** A
schema-free reader cannot know that `value` spells an `unsignedInt` rather than a `code`, and
coercing there turns the text into a number that `serializeResource` then emits as one: **authoring
a value the sender did not spell and laundering it across a format change**, the move `#74` refused
and `#78`/`#79`/`#80` each declined again. Same level as `#79`'s `booleanOf` and `#78`'s
`decimalValue`.

The text recognised is exactly R4's `unsignedInt` lexical space, `[0]|([1-9][0-9]*)`
(datatypes.html), which is the datatype `ElementDefinition.min` declares (elementdefinition.html). No
sign, no leading zero, no whitespace, no decimal point, no exponent: `"+1"`, `"01"`, `"1.0"`, `"1."`,
`" 1"`, `"1 "`, `"1e2"`, `"-1"`, `"one"` and `""` state no bound.

**🩺 `positiveInt` IS A DIFFERENT SPACE AND AN EARLIER DRAFT CITED IT WRONGLY.** R4 publishes
`positiveInt` as `+?[1-9][0-9]*`, a **leading `+` admitted**; gate pass 1 checked it against
`datatypes.html` and caught the citation. `min` is an `unsignedInt`, `+1` states no bound, and the
sentence now names the datatype the element actually declares. (`src/validate/primitives.ts` carries
the same `positiveInt` drift in `PATTERNS`, `PRE-EXISTING` and identical at `72cdee2`; left alone,
because no read in this slice reaches it.)

## 🛑 THE ADDITIVITY GUARANTEE IS AT THE MERGE, NOT AT THE READ. A GATE PASS PAID FOR THAT.

**The first attempt (`0dda6d0`) put it at the read** and excluded `0` from the lexical space,
arguing that a bound of `0` is the only value `mergeElement` could tell from absent. **Gate pass 1
REFUTED that on a measured behavioural counterexample, and it was right.** `mergeElement` is an
unconditional override, not a tighten:

```ts
if (diff.min !== undefined) merged.min = diff.min;   // no comparison against base.min
```

so the retirement is reachable for **any** stated bound below the inherited one, not only for `0`.
Measured in real worktrees, base snapshot `Observation.performer 2..*`, differential stating `min 1`,
instance carrying **one** performer:

| differential | `72cdee2` | `0dda6d0` (refuted) | remedy |
|---|---|---|---|
| XML `<min value="1"/>` | min 2, `CARDINALITY_MIN` | **min 1, no finding** | min 2, `CARDINALITY_MIN` |
| JSON `{"min":"1"}` | min 2, `CARDINALITY_MIN` | **min 1, no finding** | min 2, `CARDINALITY_MIN` |
| JSON `{"min":1}` | min 1, no finding | min 1, no finding | min 2, `CARDINALITY_MIN` |
| XML, no `min` (control) | min 2, `CARDINALITY_MIN` | same | same |
| XML `<min value="0"/>` (control) | min 2, `CARDINALITY_MIN` | same | same |

**Row 2 is what made it a blocker rather than a claim defect.** `{"min":"1"}` is a JSON document, so
that row is an in-format regression on the reference path: base called it non-conformant, the refuted
head called it conformant. The `0` exclusion was not wrong, it was **insufficient**, and six
artifacts (one of them the tarball's `CHANGELOG.md`) asserted the class was impossible by
construction.

**The remedy is the predicate, not the claim.** `mergeElement` now takes the **tighter** of the
inherited and the stated bound:

```ts
if (diff.min !== undefined) merged.min = Math.max(base.min ?? 0, diff.min);
```

**Grounded, not preferred:** a profile derives by *constraining* (profiling.html), so its `min` may
raise the inherited one and may not lower it. A differential stating a smaller bound is an **invalid
profile**, not a relaxation to honour. Taking the maximum is lenient on the malformed profile (it is
not refused, and `generateSnapshot` has no diagnostics channel to report it on) and fail-safe on the
instance.

With the guarantee at the merge, **excluding `0` from the read bought nothing and was dropped**: the
read is now exactly R4's `unsignedInt` space, `[0]|([1-9][0-9]*)`, which is `min`'s own datatype, and
`<min value="0"/>` loads faithfully as `0`. One mechanism, one place.

**▶ Row 3 is a `PRE-EXISTING` defect this remedy closes as a consequence, and that is disclosed
rather than absorbed quietly.** A JSON `{"min": 1}` under an inherited `2` already retired that
`CARDINALITY_MIN` at `72cdee2`. It could not be left standing: the read cannot know the inherited
bound, so the only place to fix the `INTRODUCED` blocker is the merge, and fixing it there fixes both.
The direction is `valid: true -> false`, the fail-safe one.

**▶ 🛑 A CLAMP AGAINST `max` WAS TRIED AND REVERTED. TWO GATE PASSES PAID FOR THIS PARAGRAPH.**

**Pass 2** found the bare `Math.max` composes an unsatisfiable pair. Beneath a base element that is
required, a differential forbidding it with `0..0` gives `min 1` beside `max 0`. `resolveSlices`
reads a descendant's cardinality as an existence expectation and resolves that contradiction toward
*present*, so beneath an `exists` discriminator a `PROFILE_SLICE_UNMATCHED` and a slice
`CARDINALITY_MIN` are lost: 3 errors at `72cdee2`, 1 at `5afc602`. Rated **major, not blocker**,
because every trigger needs an invalid profile and no document is mis-read.

**Pass 3 then refuted the clamp that answered it**, and the counterexample is worse than the defect
it fixed. `Math.min(tightened, effectiveMax)` discards the inherited bound whenever the
differential's own `max` sits below it, so the enforced bound goes DOWN. Measured across all three
trees, base `Observation.performer 2..*`, one performer on the instance:

| differential | `72cdee2` | `5afc602` (bare max) | `e03f179` (clamp) |
|---|---|---|---|
| XML `min 3`, `max 1` | `{2,1}` error | `{3,1}` error | **`{1,1}` no finding** |
| JSON `{min:2,max:"1"}` | `{2,1}` error | `{2,1}` error | **`{1,1}` no finding** |
| XML `min 1`, `max 1` | `{2,1}` error | `{2,1}` error | **`{1,1}` no finding** |
| XML `min 1`, `max *` | `{2,*}` error | `{2,*}` error | `{2,*}` error |
| JSON `{min:1,max:"*"}` | `{1,*}` **no finding** | `{2,*}` error | `{2,*}` error |

The clamp reaches an **ordinary** profile mistake (`1..1` under `2..*`), not only a contradictory
one, and on the pure JSON path. The bare guard loses nothing relative to base on any row.

**▶ ⚖️ SO THE CLAMP WAS REVERTED AND PASS 2's FINDING IS DECLARED OPEN INSTEAD, WHICH IS THIS
REPO'S OWN WRITTEN RULE**: a sub-problem that fails to converge twice gets reverted and declared a
gap, because a pure revert ships no ungraded behaviour and a declared gap is not a claim. Pass 2 and
pass 3 both rated their finding `major` rather than `blocker`, and only an `INTRODUCED` blocker gates
a ship. **The remedy belongs at `resolveSlices`**, which resolves a contradictory cardinality toward
*present* where its own contract says report the slicing `unchecked`, and it is its own slice. Pinned
by `still loses two slice findings when a contradictory profile meets an exists discriminator`, which
is RED at base and pins the DEFECT rather than the fix: closing it must red that test.

**▶ 🛑 `max` IS THE MIRROR AND IS DELIBERATELY NOT TAKEN.** `mergeElement` still overlays `max`
verbatim, so a differential stating a **larger** `max` widens an upper bound and retires a
`CARDINALITY_MAX`. It is left standing because **no read feeding it moved**: FHIR spells `max` as a
string in both formats, so `parseMax` read it from XML at base too, and tightening it would be a
change to the JSON path with no defect in this slice forcing it. Pinned by a characterization test.

## The consumer census, done before the widening rather than after

Six sites read `ElementDefinition.min`; `define-profile.ts` is the authoring path (its `min` is a
caller's JS number, never a node) and `validate/validate.ts:277` reads the built-in Phase-2 schema,
a different type, so neither is a consumer of this read.

**🛑 THE QUESTION THE FIRST CENSUS ASKED WAS THE WRONG ONE**, and it is the standing "additivity is a
property of the CONSUMERS" trap hit at the one consumer that matters. It asked *can `0` differ from
absent?*; what governs additivity is *can any newly-read value differ from absent in a
finding-retiring direction?*

| site | what it does with `min` | can a newly-read value retire a finding? |
|---|---|---|
| `validate-profile.ts:150` | element `CARDINALITY_MIN` | no (`min >= 1`, and a larger bound only adds) |
| `validate-profile.ts:222` | slice `CARDINALITY_MIN` | no (same) |
| `slicing.ts:108` | builds an `exists` expectation | no (`min >= 1`; see below) |
| `slicing.ts:117` | copies it onto `SliceDefinition` | no (only 222 reads it) |
| `snapshot.ts:63` | `mergeElement` overlay | **YES at `0dda6d0`, for ANY bound below the inherited one. Guarded in the remedy.** |
| `structure-definition.ts:325` | writes it onto the model | it is the write |

**`slicing.ts:108` is the second consumer and it is worth knowing about.** `discriminatorHolds`
returns `unevaluable` for an `exists` discriminator with no expectation, and `matchSlices` turns a
single `unevaluable` into `unchecked` for the **whole** slicing - so at base an XML-sourced sliced
profile came back `PROFILE_SLICE_UNCHECKED` (information) and **no slice constraint was checked at
all**. At head the expectations are built and the slicing is really evaluated. That information-level
placeholder giving way to real evaluation is the one finding this change can remove, and it is the
fail-safe marker whose whole meaning is *"I could not evaluate this"*.

## Measurements

All of these are **post-remedy**, at the head this slice ships.

- **Red-at-base 20 of 32**, in a real `72cdee2` worktree (`git worktree add`, this package's own
  `node_modules` symlinked). The denominator is the tests this slice adds or rewrites: 31 in
  `test/xml-profile-min.test.ts` plus the one rewritten in `test/xml-lexical-boolean.test.ts`.
  **The 20 are not 20 closures, and the two that are not are separated out rather than banked:**
  - **0 are symbol-only reds.** The change adds no export (`src/index.ts` is byte-identical across
    `72cdee2..HEAD`), so every symbol the new file imports already resolves at base and every red is
    behavioural.
  - `still reads no mustSupport and no slicing.ordered off an XML definition` is red **only** through
    its co-located head assertion that `min` reads 1; its two residual assertions are green in both
    states.
  - `still loses two slice findings when a contradictory profile meets an exists discriminator` is
    red because **head is WORSE there than base**. It pins the declared gap, so it is a cost, not a
    capability, and it must not be counted as evidence for the slice.
  - **So the behavioural figure for the closure is 18.**
- **The 12 green-at-base tests are pins, named** so a reader need not re-derive which cleared
  nothing: the ten `reads %j as no bound at all` refusal cases (`+1`, `01`, `1.0`, `1.`, ` 1`, `1 `,
  `one`, ``, `-1`, `1e2`), `leaves an element the differential states no min for exactly as the base
  had it` (the merge control), and `still overlays a differential max verbatim, so an upper bound CAN
  be relaxed` (the `max` residual).
- **Non-vacuity by mutation, ten mutations, each reddening a NAMED list** (never a count):
  1. drop the merge guard (overlay verbatim) -> `keeps the inherited bound when an XML differential
     states a smaller one`, `…when a JSON differential states a smaller one`, `keeps the inherited
     bound for a min of 0, whichever format spelled it`, `still loses two slice findings…`
  2. over-guard the merge (always inherit when the base states one) -> `still takes a differential
     bound that tightens, which is the whole point of a profile`, `never lowers the enforced bound,
     even when the differential's own max sits under it`
  3. re-add the REVERTED clamp against `max` -> `never lowers the enforced bound…`, `still loses two
     slice findings…`
  4. close the declared gap at `resolveSlices` (refuse to resolve a contradictory cardinality) ->
     `still loses two slice findings when a contradictory profile meets an exists discriminator`.
     This is the repo's own rule made executable: closing a declared gap MUST red its pin.
  5. drop the lexical guard entirely -> the nine refusal cases `+1` `01` `1.0` `1.` ` 1` `1 ` ``
     `-1` `1e2`
  6. tolerate surrounding whitespace -> ` 1`, `1 `
  7. tolerate leading zeros -> `01`
  8. use `positiveInt`'s real space, a leading `+` admitted -> `+1`
  9. `Number.parseInt` instead of an exact match -> `+1` `01` `1.0` `1.` ` 1` `1 ` `-1` `1e2`
  10. remove the lexical route (revert the read fix) -> all 18 behavioural reds
  **Mutations 1, 2 and 3 are three polarities of the merge guard**, so it cannot pass by refusing
  every differential `min` and cannot pass with the reverted clamp back in. **`"one"` is reddened by
  none of the ten** and is retained as documentation of the boundary, not as evidence. Said here
  rather than folded into a total.
- **Exactly one existing test moved** across the whole suite: the characterization test that pinned
  this gap, which the repo's own rule requires a closure to red. It is rewritten in place rather than
  deleted, so the closure is visible from where the gap was declared. Suite **70 files / 1495 tests**
  from base's **69 / 1464**, and 1464 + 31 = 1495, so nothing else moved.
- **The `@cosyte/hl7` negative control is DEGENERATE and is reported as such rather than as a zero.**
  `hl7` is not a dependency of this package and has no `StructureDefinition` loader, so 0 of the
  symbols under measurement exist there and the control cannot fail. The controls that CAN fail are
  the three merge-guard polarities above and the two both-states pins named in the list.
- **The committed read differential (`pnpm differential:read`) moves 0 of 1,195 readings and 0 of 27
  JSON fixtures, and that zero is VACUOUS BY CONSTRUCTION for this class** rather than evidence:
  checked by hand, **no corpus fixture carries a `min` at all**, and the reading runs no profile
  validation (profiles are caller-supplied and none is supplied). What the zero does say is that the
  reader, the writers and the safety spine are untouched, which is worth having and is all it says.
- **Corpus caveat on every number here:** hand-authored XML and JSON fixtures, plus mutations and
  probes. **Not the R4 published-examples corpus.** Nothing here is corpus-wide.

## Declared open, each pinned in `test/xml-profile-min.test.ts`

Closing any of them MUST red its test, in the same change.

1. **A contradictory profile loses two slice findings.** Where the base element is required and the
   differential forbids it with `0..0`, the merge composes an unsatisfiable `min 1 / max 0` and
   `resolveSlices` resolves that toward *present*, so beneath an `exists` discriminator a
   `PROFILE_SLICE_UNMATCHED` and a slice `CARDINALITY_MIN` are lost. RED at base: head is worse
   there. Raised by gate pass 2, rated `major` not `blocker` by it and by pass 3, and DECLARED rather
   than remedied after the clamp that answered it was itself refuted. The remedy belongs at
   `resolveSlices`.
2. **`mergeElement` still overlays a differential `max` verbatim**, so an upper bound can be widened
   and a `CARDINALITY_MAX` retired. The mirror of what this slice fixed, left standing because no
   read feeding `max` moved. Both-states pin.
3. **`ElementDefinition.mustSupport` and `slicing.ordered` are still unread from XML.** What makes a
   widened `min` safe is that its one finding-retiring consumer now takes the tighter of two bounds;
   a boolean flag has **no tighter-of-the-two**, since `false` is not "no flag stated". `#79`'s
   measured retirement stands.
4. **A non-conformant JSON `{"min": "1"}` is now read**, because the model records no provenance and
   the lexical read cannot be scoped to XML. Lenient on the read, unchanged on the write - the string
   is still what the writer hands back. The same collateral `#79` declared for `booleanOf`.
5. **FHIRPath `numberOf`** is the sibling from the same census and is **not** absorbed here: an
   XML-sourced number still falls through to string ordering, so `"9" < "10"` is false. Its own item.
