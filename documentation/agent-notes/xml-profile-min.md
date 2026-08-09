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
  XML-sourced  profile  -> valid: true    (no finding at all)
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

The text recognised is exactly R4's `positiveInt` lexical space, `[1-9][0-9]*` (datatypes.html). No
sign, no leading zero, no whitespace, no decimal point, no exponent: `"+1"`, `"01"`, `"1.0"`, `"1."`,
`" 1"`, `"1 "`, `"1e2"`, `"-1"`, `"one"` and `""` state no bound.

## 🛑 THE `0` EXCLUSION IS THE WHOLE ADDITIVITY ARGUMENT. DO NOT "FINISH THE JOB" BY TAKING IT.

R4's `unsignedInt` space also admits `0`, and reading it looks like the obvious completion. It is the
`#79` retirement, one datatype over, and it was **measured** rather than argued:

```
base StructureDefinition (JSON):  Observation.subject min 1
derived differential:             Observation.subject min 0

  JSON differential -> generateSnapshot merges min = 0     (the obligation is gone)
  XML  differential -> generateSnapshot merges min = 1     (inherited, at 72cdee2 AND at head)
```

A lower bound of `0` imposes no obligation, so **every site that acts on one tests `min >= 1` and
cannot tell `0` from absent** - `validate-profile.ts` twice (element and slice), `slicing.ts` once.
**One site can tell them apart:** `mergeElement` in `snapshot.ts` treats an absent differential `min`
as *inherit* and a stated `0` as *override*. Taking `0` off XML would therefore let a differential
begin overwriting an inherited `1` and **retire a `CARDINALITY_MIN` the base emitted** - the exact
class `#79` drafted, measured and declined for `mustSupport`.

Excluding `0` keeps the widening **additive by construction**: the only transition `el.min` can make
is `undefined -> n, n >= 1`. Never `n -> m`, never `undefined -> 0`.

**The cost is declared, not hidden:** an XML `<min value="0"/>` and an XML element with no `min` load
identically, so the public model cannot tell a caller which the profile wrote. That was true at base
too, and it is pinned in `test/xml-profile-min.test.ts`.

## The consumer census, done before the widening rather than after

Six sites read `ElementDefinition.min`; `define-profile.ts` is the authoring path (its `min` is a
caller's JS number, never a node) and `validate/validate.ts:277` reads the built-in Phase-2 schema,
a different type, so neither is a consumer of this read.

| site | what it does with `min` | can `0` differ from absent? |
|---|---|---|
| `validate-profile.ts:150` | element `CARDINALITY_MIN` | no (`min >= 1`) |
| `validate-profile.ts:222` | slice `CARDINALITY_MIN` | no (`min >= 1`) |
| `slicing.ts:108` | builds an `exists` expectation | no (`min >= 1`) |
| `slicing.ts:117` | copies it onto `SliceDefinition` | no (only 222 reads it) |
| `snapshot.ts:63` | `mergeElement` overlay | **YES** - inherit vs override |
| `structure-definition.ts:325` | writes it onto the model | it is the write |

**`slicing.ts:108` is the second consumer and it is worth knowing about.** `discriminatorHolds`
returns `unevaluable` for an `exists` discriminator with no expectation, and `matchSlices` turns a
single `unevaluable` into `unchecked` for the **whole** slicing - so at base an XML-sourced sliced
profile came back `PROFILE_SLICE_UNCHECKED` (information) and **no slice constraint was checked at
all**. At head the expectations are built and the slicing is really evaluated. That information-level
placeholder giving way to real evaluation is the one finding this change can remove, and it is the
fail-safe marker whose whole meaning is *"I could not evaluate this"*.

## Measurements

- **Red-at-base 13 of 26**, in a real `72cdee2` worktree (`git worktree add`, this package's own
  `node_modules` symlinked). **0 of the 13 are symbol-only reds**: the change adds no export, so
  every symbol the new file imports already resolves at base. One of the 13 (`still reads no
  mustSupport and no slicing.ordered off an XML definition`) is red **only** through its co-located
  head assertion that `min` reads 1; its two residual assertions are green in both states. So the
  behavioural figure for the closure is **12**.
- **The 13 green-at-base tests are pins, named** so a reader need not re-derive which cleared
  nothing: the ten `reads %j as no bound at all` refusal cases (`+1`, `01`, `1.0`, `1.`, ` 1`, `1 `,
  `one`, ``, `-1`, `1e2`), `reads a min of 0 as no bound stated, so the snapshot merge keeps the
  inherited bound`, `leaves the JSON path's own handling of a stated 0 exactly where it was`, and
  `still reads a min of 0 as absent, so the loaded model does not say the profile stated it`.
- **Non-vacuity by mutation, seven mutations, each reddening a NAMED list** (never a count):
  1. accept `0` too (the full `unsignedInt` space) -> `reads a min of 0 as no bound stated…`,
     `still reads a min of 0 as absent…`
  2. drop the lexical guard entirely -> the nine refusal cases `+1` `01` `1.0` `1.` ` 1` `1 ` ``
     `-1` `1e2`, plus both `0` pins
  3. tolerate surrounding whitespace -> ` 1`, `1 `
  4. tolerate leading zeros -> `01`
  5. `Number.parseInt` instead of an exact match -> `+1` `01` `1.0` `1.` ` 1` `1 ` `1e2`
  6. remove the lexical route (revert the fix) -> all 13 behavioural reds
  7. route the JSON number through the lexical read too -> `leaves the JSON path's own handling of a
     stated 0 exactly where it was`
  **`"one"` is reddened by none of the seven** and is retained as documentation of the boundary, not
  as evidence. Said here rather than folded into a total.
- **Exactly one existing test moved** across the whole suite: the characterization test that pinned
  this gap, which the repo's own rule requires a closure to red. It is rewritten in place rather than
  deleted, so the closure is visible from where the gap was declared.
- **The `@cosyte/hl7` negative control is DEGENERATE and is reported as such rather than as a zero.**
  `hl7` is not a dependency of this package and has no `StructureDefinition` loader, so 0 of the
  symbols under measurement exist there and the control cannot fail. The control that can fail is
  mutation 7 above, which holds the JSON route down from inside.
- **Corpus caveat on every number here:** hand-authored XML and JSON fixtures, plus mutations and
  probes. **Not the R4 published-examples corpus.** Nothing here is corpus-wide.

## Declared open, each pinned in `test/xml-profile-min.test.ts`

Closing any of them MUST red its test, in the same change.

1. **An XML `<min value="0"/>` still reads as absent** - the declared cost of the additivity argument
   above.
2. **`ElementDefinition.mustSupport` and `slicing.ordered` are still unread from XML.** The argument
   that buys `min` is the `0` exclusion, which has **no counterpart on a boolean flag**: `false` is
   not "no flag stated". `#79`'s measured retirement stands.
3. **A non-conformant JSON `{"min": "1"}` is now read**, because the model records no provenance and
   the lexical read cannot be scoped to XML. Lenient on the read, unchanged on the write - the string
   is still what the writer hands back. The same collateral `#79` declared for `booleanOf`.
4. **FHIRPath `numberOf`** is the sibling from the same census and is **not** absorbed here: an
   XML-sourced number still falls through to string ordering, so `"9" < "10"` is false. Its own item.
