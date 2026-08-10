# A contradictory slice descendant assigns no occurrence (`resolveSlices`)

Written to the per-slice tier rather than appended to `agent-notes.md`, which is 7 bytes from its
archive budget. The cursor stays there; this is the whole record. Predecessor:
`documentation/agent-notes/xml-profile-min.md`.

**Provenance.** FHIR R4 `elementdefinition.html` (§slicing, and cardinality "constraining" under a
derived profile) for what a discriminator decides and what makes a derived profile invalid; this
package's own `src/profiles/slicing.ts` contract and `collectSlicingIssues` control flow for what a
report of `unchecked` costs. **No new spec clause is relied on**: R4 makes a `min 1 / max 0` profile
invalid and defines no instance behaviour for it, so the choice between "no" and "unevaluable" is
this library's fail-safe policy, not a conformance requirement. Everything numeric below is measured
in this repo, not cited.

## The defect

`resolveSlices` turns a slice descendant's cardinality into an `exists` expectation, and it read the
two bounds as an **ordered pair**:

```ts
if (desc.min !== undefined && desc.min >= 1) existsExpectations.set(rel, true);
else if (desc.max === 0) existsExpectations.set(rel, false);
```

`min` was consulted first, so a descendant stating **both** at once discarded the prohibition. An
unsatisfiable `min 1 / max 0` is not a hypothetical shape: it is exactly what the previous slice's
merge composes when a differential forbids with `0..0` an element the base makes required, and that
merge was deliberately left composing it after a clamp against `max` was tried there and reverted
for lowering the enforced bound below the inherited one.

The consequence is that every occurrence carrying the **forbidden** element was admitted into the
slice. Beneath a `closed` slicing that retired a `PROFILE_SLICE_UNMATCHED` and the slice's own
`CARDINALITY_MIN`: three errors before the previous slice, one after it.

## What shipped

A third state, kept **apart from** the boolean map rather than folded into it, because neither
boolean is true of a contradiction and picking one admits occurrences the profile forbids:

- `SliceDefinition.unsatisfiableExists: ReadonlySet<string>`, populated when a descendant states
  `min >= 1` beside `max === 0`.
- `discriminatorHolds` answers `"no"` for an `exists` discriminator on such a path.

**The answer is `"no"`, never `"unevaluable"`, and that is the whole design decision.**
`"unevaluable"` reports the entire slicing `unchecked`, and `collectSlicingIssues` **returns** on
`unchecked` before the unmatched-occurrence arm, the slice cardinality arms and the slice
must-support arm. Reporting `unchecked` would therefore have *retired* the very findings this case
exists to draw, while dressing the retirement as a fail-safe. It is not a guess either: no instance
has a path both present and absent. **`"no"` is not purely additive against the previous behaviour,
though, and the gate was right to press on that** - see the retirement classes below.

**Scoped to the discriminator path on purpose.** An unsatisfiable descendant does not make the slice
unmatchable in general. FHIR decides membership by the discriminators and then validates the
assigned occurrence, so an occurrence may legitimately be assigned to a slice it violates. Only a
contradiction **at** a discriminator path makes membership itself undecidable, and marking the whole
slice unmatchable would move genuine violations to "unmatched" and hide them.

**Scoped to the slice's OWN descendants (`sliceName === undefined`) too, and gate pass 1 is what
forced that.** The reason the narrowing cannot introduce a third defect is **not** the loose one
first written down ("it only moves toward base"); state the gate's version: for any descendant
failing the new first conjunct the remaining chain is **token-identical to base's**, and
`unsatisfiableExists` is read at **exactly one site**. Pass 2 confirmed it mechanically with a
1,349-case grid: this tree differs from base in **exactly 120 rows, every one of them carrying the
filed `own = {min >= 1, max "0"}` shape**, with **zero `valid: false -> true` rows**; the 104 extra
rows the first draft moved are all gone. This walk sweeps every element under the slice's id prefix, and a **re-slice** of a
descendant sits under that prefix and flattens onto the same relative path. Recording a re-slice's
contradiction made the satisfiable **outer** slice unmatchable and drew a `PROFILE_SLICE_UNMATCHED`
plus a slice `CARDINALITY_MIN` **on a conformant document**: it blamed the instance for a statement
belonging to a different slice. Re-slicing is a declared deferral of this module, so a contradiction
carried only by a re-slice is left reading as it did before rather than guessed at from the outer
slice's position. Pinned by `ignores a contradiction carried only by a RE-SLICE of the discriminator
path`.

**Scoped to `max === 0`, not to `max < min`.** `min 2 / max 1` is unsatisfiable by *count* and still
says something unambiguous about *existence*: `min 2` means present. Only `max 0` contradicts the
presence half. That row is pinned, and mutation M4 (widening the guard to `max < min`) reds it.

The merge is untouched. This is the remedy the predecessor predicted, at the site it named.

## Measurements

Re-measured after the accuracy gate's first pass, which refuted the slice and forced a scoping
change; every figure below is from the post-remedy tree. Suite `1538 -> 1553` (one test moved out of
`test/xml-profile-min.test.ts`, sixteen added in `test/profile-slice-contradiction.test.ts`). Every
repo gate green: `typecheck`, `lint`, `test`, `format:check`, `check:no-emdash`,
`check:no-internal-refs`, `phi-scan`, plus the umbrella's `scripts/verify.sh fhir`.

### Red-at-base, as a fraction, and split by kind

Measured against `4bc8780` in a tree extracted with `git archive` (file copy, never a checkout over
the working tree), the new file's own tests copied in:

**12 of 16 red at base. Only 5 of those are behavioural, and 2 of the 5 are costs.**

- **5 behavioural reds**, each an `AssertionError`:
  - `draws both findings the ordered read used to retire, under closed slicing` (1 issue -> 3)
  - `closes it through a differential and a base, the route the defect was filed at` (1 issue -> 3)
  - `does not report the slicing unchecked, which would return before those arms`
    (`['Missing']` -> `[undefined]`)
  - `retires a slice CARDINALITY_MAX that only fired on a wrongful admission` (3 -> 2) - **COST**
  - `retires a later slice's findings that existed only because a contradictory slice shadowed it`
    (3 -> 1) - **COST**
- **7 symbol-only reds**, every one `TypeError: slice.unsatisfiableExists is not iterable`. The
  member does not exist at base, so these rows cannot be behavioural evidence. **Reported as
  symbol-only rather than banked**, which is the opposite of the predecessor's figure: that slice
  added no export and had 0 symbol-only reds, this one adds an interface member and has 7.

**Both cost rows are red because HEAD IS WORSE THERE.** So the **behavioural closure figure is 3.**

### Green at base, named, so a reader need not re-derive which cleared nothing

Four rows. Each touches no new member, so each genuinely runs at base:

- `still reports unchecked when no descendant pins the discriminator path` - the pre-existing
  fail-safe, unchanged, and deliberately not reused for this case.
- `does not move a verdict to valid through a re-slice the element check never sees` - green at base
  **and** at head, which is the point: the remedy restores the base reading. It is **not** vacuous;
  M9 (the pre-remedy tree) reds it, which is the gate's own finding made executable.
- `leaves an error standing when the forbidden element is present`
- `leaves an error standing when the forbidden element is absent`

### Non-vacuity by mutation: 9 mutations, each reddening a NAMED list

| # | mutation | reds (new rows unless marked pre-existing) |
|---|---|---|
| M1 | guard removed (the base ordered read) | `records the contradiction…`, `draws both findings…`, `does not report the slicing unchecked…`, `reads the same contradiction out of the XML spelling…`, `closes it through a differential and a base…`, `retires a slice CARDINALITY_MAX…`, `retires a later slice's findings…` |
| M2 | answer `"unevaluable"` instead of `"no"` | the six above bar `records the contradiction…`, plus `leaves an error standing when the forbidden element is present` / `…is absent` |
| M3 | guard widened to `max === 0` alone | `still expects absence from a plainly prohibited descendant`, `ignores a contradiction carried only by a RE-SLICE…`, `does not move a verdict to valid…`, plus pre-existing `matchSlices handles an 'expect absent' (max 0) exists discriminator` |
| M4 | guard widened to `max < min` | `still expects presence from min 2 / max 1…` |
| M5 | populate the set but drop the check in `discriminatorHolds` | the same eight as M2 |
| M6 | record the contradiction AFTER setting the expectation | `records the contradiction apart from the expectations…` |
| M7 | guard widened to `min >= 1` alone | `still expects presence from a plainly required descendant`, `still expects presence from min 2 / max 1…`, `ignores a contradiction carried only by a RE-SLICE…`, `retires a later slice's findings…`, plus 3 pre-existing rows in `slicing.test.ts` and `xml-profile-min.test.ts` |
| M8 | every descendant recorded unsatisfiable | all five neighbour rows, `still reports unchecked when no descendant pins…`, `retires a later slice's findings…`, plus 4 pre-existing rows |
| M9 | **the pre-remedy tree**: drop the `sliceName === undefined` scoping | `ignores a contradiction carried only by a RE-SLICE…`, `does not move a verdict to valid through a re-slice…` |

**16 of 16 new rows are reddened by at least one mutation. There is no documentation-only row** -
the predecessor had one (`"one"`, reddened by none of its ten) and said so; this slice has none.
M3, M4, M7 and M8 are what make the symbol-only neighbour rows admissible, since their base
comparison cannot run. **M9 is the gate's own counterexample turned into a regression pin**, and it
is the reason `does not move a verdict to valid…` is not just a both-states decoration.

### 🩺 Two degenerate rows of my own, both caught by a mutation before being trusted

1. `does not report the slicing unchecked` first passed the whole `Observation` to `matchSlices`,
   which takes the sliced element's **occurrences**. `dataAbsentReason` does not resolve at an
   `Observation` root, so the occurrence went unmatched **however the contradiction was resolved**.
   M1 failing to red it is what exposed it. It now passes the `component` node and asserts the
   occurrence count. The sibling row `still reports unchecked when no descendant pins…` had the same
   shape and was repaired with it, on the gate's prompting.
2. `does not move a verdict to valid through a re-slice…` was **first written with a fixture that
   could not reproduce the gate's finding at all** - a second element made the issue list identical
   in both trees, so no mutation reddened it. It was rebuilt until M9 reds it. **A row written to
   pin a gate finding that the gate's own counterexample does not red is decoration**, and it was
   one mutation away from shipping as such.

Also corrected on the gate's prompting: `reads the same contradiction out of the XML spelling`
compared the XML reading to the JSON reading, which agreed at base too. Both its assertions now
state a literal.

### The zero that is vacuous, and why

`pnpm differential:read`: **0 readings moved of 1,195 documents**, every no-suppression bar 0
(`valid F->T` 0, `safeToSummarize F->T` 0, retractions lost 0, negations lost 0, read diagnostics
lost 0, 18 emitted-XML re-read differences of which **0 stable on base**, so 0 regressions).

**That zero is VACUOUS BY CONSTRUCTION and is not evidence.** It is vacuous more strongly than the
predecessor's was: that slice at least sat on a read the harness exercises and merely lacked a
fixture carrying a `min`. This change is in the **profile-validation layer**, which the read
differential never invokes at all - the harness compares reader and writer readings and does not
call `collectProfileIssues` or `resolveSlices` on any document. The harness prints its own caveat
that a 0 on that line is not evidence the change is safe, and it is right here.

**Corpus caveat on every figure above: hand-authored JSON and XML fixtures plus mutations and
probes, NOT the R4 published-examples corpus.**

## ⚖️ What is retired, enumerated rather than counted

The first draft of this slice said "one finding is retired" and bounded it with a general claim. The
accuracy gate refuted both halves. The corrected account:

**Retirement 1 - a slice `CARDINALITY_MAX` fired by the wrongful count.** An occurrence no longer
admitted stops counting toward the slice, so a `CARDINALITY_MAX` that only fired because of the
admission goes.

**Retirement 2 - a LATER slice's `CARDINALITY_MIN` and `MUST_SUPPORT_ABSENT`, through de-shadowing.**
`matchSlices` breaks at the first matching slice, so an occurrence wrongly admitted to a
contradictory slice never reached the slices after it. Refusing the admission de-shadows them, and
whatever they then do - match, or turn out **unevaluable** and take the whole slicing to `unchecked`
- the findings their emptiness had earned go with them. **This class was missed entirely in the
first draft** and was found by gate pass 1.

**Retirement 3 - the unevaluable half of retirement 2, which is NOT confined to one slice's codes.**
`matchSlices` returns `unchecked()` on the **first** `unevaluable` verdict, so if a de-shadowed
slice pins nothing at the discriminator path, **every** slice arm for that slicing is skipped: a
third slice's `CARDINALITY_MAX` goes too, and an evaluated slicing becomes an unevaluated one, which
is the very outcome the design section above says `"no"` was chosen to avoid. It surfaces as the
library's honest `information` marker `PROFILE_SLICE_UNCHECKED`, `valid` does not move (0 flips
across the gate's 1,349-case grid), and a `PROFILE_SLICE_UNMATCHED` can never be retired this way.
**Found by gate pass 2, after the first draft of retirement 2 was written too narrowly** ("a later
slice that now matches"). Disclosure width, not a safety defect.

**🛑 Carried forward for whoever opens this module next.** Every retirement above rests on the same
two properties of `matchSlices`: **break-at-first-match**, and an **all-or-nothing `unchecked`**.
This slice was bitten by that control flow **twice, from two directions** - once as de-shadowing and
once as the unevaluable collapse. The gate's closing words were that the next slice into this module
should expect it a third time.

In every case measured the head reading is the more correct one, because each retired finding was an
artefact of the wrongful admission. That is a reason to disclose them, not a reason to omit them.

**The bound, stated at the width it actually holds.** Where the contradiction sits on the slice's
**own** descendant, that descendant is also checked at element level, and `min 1 / max 0` is
unsatisfiable for every count (0 draws `CARDINALITY_MIN`, 1 or more draws `CARDINALITY_MAX`), so an
error stands on each present parent occurrence whichever way the instance goes. Both polarities are
asserted.

**🛑 That is NOT a general bound, and the first draft wrongly wrote it as one.**
`collectProfileIssues` **skips slice elements**, so a contradiction carried by a **re-slice** is
never element-checked at all, and nothing stands behind a retirement on that route. The gate
reproduced a `valid: false -> true` move through the public `validateResource` there. The answer was
not to re-word the bound but to **narrow the record away from re-slices**, which closes the route:
`does not move a verdict to valid through a re-slice the element check never sees` pins it, and M9
reds it.

## Carriers swept, not just the site

The predecessor's changeset and `CHANGELOG.md` entry both asserted this gap was open and "pinned by
a test". Fixing only the code would have shipped a release body contradicting itself.

- `.changeset/olive-badgers-enforce.md` - the falsified paragraph **DELETED, not reworded**: a
  changeset freezes permanently.
- `CHANGELOG.md` - the same paragraph deleted from the `[Unreleased]` entry.
- `documentation/agent-notes/xml-profile-min.md` - the "Declared open" entry marked closed, the
  forward-looking sentence answered, and the **test name it quotes corrected**: that test was
  rewritten as the closure and moved, so a reader following the old name would have found nothing.
- `src/profiles/snapshot.ts` - the `mergeElement` docblock, which named this as its own slice.
- `test/xml-profile-min.test.ts` - the residuals block's own count corrected from four to three.
- `documentation/agent-notes.md` is **not** a carrier (it names `resolveSlices` only in a layer
  description), so the 7-byte-from-budget file was not touched. Neither was `fhir/CLAUDE.md`, which
  is 3 bytes from its own.

**Owed, and deliberately not done here:** the meta-repo's `documentation/repos/fhir/xml-profile-min.md`
carries the same "🔴 Open" entry, and `operations/BACKLOG.md` still lists this gap as the item's
first open leg. This session was scoped to the submodule and told not to touch either.

## The gate

`conformance-refuter`, **`REFUTED` -> `NOT REFUTED`, 2 passes of the ADR 0016 cap of 4.**

| pass | verdict | finding |
|---|---|---|
| 1 | `REFUTED` | **two `INTRODUCED` majors.** The bound was false (`collectProfileIssues` skips slice elements, so a **re-slice**'s contradiction is never element-checked and a `valid: false -> true` moved through the public `validateResource`); and the guard was mis-scoped WIDE, a contradictory re-slice making the satisfiable **outer** slice unmatchable and **false-erroring a conformant document**. Plus five minors. |
| 2 | **`NOT REFUTED`** | Both majors **closed in code and verified mechanically, not argued** - a 1,349-case differential grid over three trees. One `INTRODUCED` **minor** survivor (the retirement enumeration still too narrow), remedied by a **cut**. |

**Both majors were answered in CODE, by one narrowing, not by re-wording the claim** - which is the
right answer to the predecessor's history of two consecutive remedies each introducing a defect. The
pass-2 prose cut is applied here and is **UNGRADED**: the cap was not spent (2 of 4), and the cut is
the refuter's own prescribed wording, strictly narrowing a claim.

**🩺 Two findings this slice reported against itself**, both recorded because a probe that cannot
fail is not a probe: the probe-D fixture that could not reproduce the gate's own counterexample and
was reddened by no mutation until rebuilt, and an annotation in the predecessor note that named a
successor test **which did not exist**.

## Owed elsewhere, filed rather than absorbed

- **`README.md` and `docs-content/intro.md` promise re-slicing is announced as
  `PROFILE_SLICE_UNCHECKED`, and it is not** (`README.md` ~601-603 and ~619-620,
  `docs-content/intro.md` ~58). Measured false at `4bc8780` as well as here, so `PRE-EXISTING`. The
  cause is untouched by this slice: `resolveSlices` still pushes a **re-slice's `fixed`/`pattern`
  into the outer slice's `constraints` with no `sliceName` filter**, so a `value`/`pattern`
  discriminator can still be decided by a re-slice. The `exists` record is the only half scoped here,
  deliberately. **The backlog line is "re-slice content participates in outer-slice membership at
  all", and the README claim goes with it.** Not deleted here: this slice cannot grade that site.
- The meta-repo's `documentation/repos/fhir/xml-profile-min.md` "🔴 Open" entry and
  `operations/BACKLOG.md`'s first open leg for this item both still describe the gap as open. This
  session was scoped to the submodule and told to touch neither.

## Still open, unchanged by this slice

- **`mergeElement` still overlays `max` verbatim** - the mirror, and the composer of the very pair
  this slice handles. Both-states pin.
- `ElementDefinition.mustSupport` and `slicing.ordered` still unread from XML.
- FHIRPath `numberOf` - an XML-sourced number still falls through to string ordering.
- A non-conformant JSON `{"min": "1"}` is read, no provenance available to scope it.
- The `type` / `profile` / R5 `position` discriminators still report `unchecked`; nothing here
  widened what this module can evaluate.
