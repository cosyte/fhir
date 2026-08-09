# The XML boolean, read (2026-08-09, `FHIR-XML-BOOLEAN-NEGATION-LOST`)

Split out of `documentation/agent-notes.md` under the meta-repo's `decisions/0023-doc-budgets.md`
(that file is at its 250,000-byte archive cap, and `CLAUDE.md` is at its own). The cursor stays
there; this is the narrative. Sibling: [`xml-magnitude.md`](xml-magnitude.md), the same root class
one datatype over.

## What it was

Filed as a **STOP-THE-LINE**, and reproduced three times before any code moved (by `#78`'s author
outside its slice, by the coordinator at `4eb444f`, and by this slice's own probe at the same
commit). All three agree:

```
{"resourceType":"MedicationRequest","status":"active","intent":"order","doNotPerform":true, …}

  JSON            -> negations: ["do-not-perform"]  doNotPerform: true
  XML round trip  -> negations: []                  doNotPerform: undefined
                     issues: []   safeToSummarize: true   assertSafeToSummarize PASSES CLEAN
```

The round trip is **this package's own** `serializeResourceXml` then `parseResourceXml`. **The
writer is correct**: it emits `<doNotPerform value="true"/>`. The reader yields
`{kind:"primitive", value:"true"}`, the **string**, because FHIR XML carries every primitive as
attribute text and this reader is schema-free by design. `readDoNotPerform` read via
`primitiveBooleans`, which accepted only a JS `boolean`, **and a failed match reads as absence.**

**Why it outranked the other residuals of its class:** `#78`'s Quantity defect degraded a _value_;
this one **inverts an instruction**.

## THE CENSUS IS THE LESSON, AND SO IS WHAT IT DID NOT LICENSE

The item said _census every boolean_. The census found three sites. **Only one was changed, and the
gate is why.**

| Site                                                                 | Via                 | Read from XML | Disposition               |
| -------------------------------------------------------------------- | ------------------- | ------------- | ------------------------- |
| `MedicationRequest.doNotPerform` (`safety/status.ts`)                | `primitiveBooleans` | LOST          | **FIXED**                 |
| `ElementDefinition.mustSupport` (`profiles/structure-definition.ts`) | `primitiveBoolean`  | LOST          | **left standing, pinned** |
| `ElementDefinition.slicing.ordered` (same file)                      | `primitiveBoolean`  | LOST          | **left standing, pinned** |

**The first draft widened both helpers, and `conformance-refuter` pass 1 REFUTED it with a measured
BEHAVIOURAL counterexample.** `src/profiles/snapshot.ts` merges a differential flag only when it is
not `undefined`, so an XML `<mustSupport value="false"/>` that base read as `undefined` began
**overwriting an inherited `true` and RETIRING a `MUST_SUPPORT_ABSENT` the base emitted.** The same
held for a non-conformant JSON `{"mustSupport":"false"}`. That is the exact retirement class `#78`
measured at `validatePrimitiveValue` and declined, reopened one layer over and unmeasured.

**THE RULE THIS BOUGHT, AND IT IS NOT "CENSUS EVERY BOOLEAN":
A SAFETY READ AND A CONVENIENCE READ CANNOT SHARE A WIDENING.** `primitiveBooleans` feeds
`negations`, where a newly-read value can only **add**. `primitiveBoolean` feeds callers that treat
`undefined` as **inherit**, where the same newly-read value **removes** a finding. The helpers look
interchangeable and the direction of harm is opposite. **Additivity was argued from the helper's
export status; it is a property of its CONSUMERS.** Check every consumer for an
`undefined`-means-inherit merge before widening anything. `snapshot.ts` `mergeElement` has eight such
lines. **The split is left in the tree deliberately**, both helpers being package-private, each
read by exactly one module (`primitiveBoolean` from two call sites in `structure-definition.ts`,
`primitiveBooleans` from one in `status.ts`) and documented at each site; the standing hazard is that **two near-identically-named
readers of one datatype now accept different text, so if either is ever exported the split must be
resolved rather than shipped.**

**`negations` is monotone across the change** (a JS `boolean` `true` still yields `true`, so the
negation can never be retired), **but `SafetyReadout.doNotPerform` moves further than `undefined` to
a value**: it also moves `false` to `true` where **any** value spells the negation a JS `boolean`
**elsewhere in the element** contradicts (the ordering is not the point, and a draft that said
_later_ / _earlier_ was falsified by `{"doNotPerform":["true",false]}`), which is the documented
"a `true` anywhere wins" rule and is pinned at
`test/xml-lexical-boolean.test.ts`. **Gate pass 2 refuted a sentence saying the read "can only fill
in a value that was `undefined`" using this slice's own fixture: the third generation of one
universal.** Say _adds a negation, never retires one_, which is the only form that measures true.

**Censused and deliberately unchanged**, each a decision:

- **`validatePrimitiveValue`'s `boolean` branch** (`validate/primitives.ts`): still reads a
  conformant `<active value="true"/>` as `TYPE_MISMATCH` and flips `valid`. `#78` measured that an
  in-place fix **retires a real mismatch** on JSON `{"active":"true"}`. **Not reopened here.**
- **FHIRPath `convertToBoolean`** (`fhirpath/evaluate.ts`, and it **is** a public export feeding
  `InvariantResult.satisfied`, an error-severity verdict): a single non-Boolean item is `true` by the
  reference singleton-evaluation rule, so an XML-sourced `<doNotPerform value="false"/>` judges an
  invariant `true`. Fixing it changes FHIRPath typing for genuinely string-valued elements, so it can
  **retire** a finding. Pinned.
- **`toTrit`** (same file): throws `UnsupportedFhirPathError` on a string operand. **Fail-loud**,
  surfacing as `INVARIANT_UNCHECKED`. Left as is.
- **`systemTypeOf`** (same file): an XML-sourced boolean answers `"String"`, so `is Boolean` is
  false. Same trade.
- **The writers** (`xml/write.ts`, `codec/write.ts`, `xml/equivalence.ts`): they _emit_ and already
  render a string unchanged, so the round trip is byte-exact either way.

**The wider sweep the item asked for, over consumers matching on the JSON reader's TYPE rather than
just booleans.** `decimalValue` closed by `#78`. **OPEN: `parseMin`** (`structure-definition.ts`),
`min` being an `unsignedInt` read through an `instanceof FhirDecimal` match, so **a profile handed
over in XML declares required elements this library enforces none of**, silently (`max` is fine, FHIR
spells it a string in both formats). **OPEN: `numberOf`** (`fhirpath/evaluate.ts`), where an
XML-sourced number falls through to **string** ordering, so `"9" < "10"` is false. `lexicalOf`
(`bundle/types.ts`), `resourceTypeOf` (`model/node.ts`) and `lacksTaggableResourceType`
(`codec/serialize-guard.ts`) read strings and are correct on both paths.

## Where the fix went, and why not one layer down

**At the safety read helper, `src/safety/codes.ts`, not in the XML reader.** A new `booleanOf`
recognises **exactly `true` and `false`**, the whole of R4's `boolean` lexical space, and
`primitiveBooleans` routes through it. This is the level `#78` used for the identical remedy
(`decimalValue` inside `readQuantity`).

**Reader-level coercion was rejected, and the reason is not timidity.** The reader is schema-free by
design: with no `StructureDefinition` it cannot know `value` spells a `boolean` rather than a `code`,
so coercing there turns `<name value="true"/>` on a string element into a JS boolean and
`serializeResource` then emits `true`, **authoring a value the sender did not spell and laundering it
across a format change**, the exact move `#74` refused. The gate confirmed the reader has no
conformant-input hole under this choice: namespace prefixes resolve and `&#116;rue` decodes, so no
legal XML spelling of `true` escapes the helper.

## What moves, measured base-vs-head

**No diagnostic moves at all.** `collectProfileIssues` over an XML-sourced profile and
`validateResource` over the round-tripped `MedicationRequest` are identical on `4eb444f` and at head.
The only thing that moves is `readSafety`'s `doNotPerform` and `negations`.

## Residuals, each pinned in `test/xml-lexical-boolean.test.ts`

Closing any of them MUST red its test, in the same change.

1. **The two profile booleans**, above: unread from XML, and the retirement is why.
2. **`ElementDefinition.min` unread from XML**, silently. Same root class, different datatype.
3. **FHIRPath `convertToBoolean` reads an XML `false` as `true`.**
4. **`safeToSummarize` IS UNMOVED IN BOTH DIRECTIONS, AND THE SECOND DIRECTION IS A REAL GAP.**
   For a value that reads, unmoved is right: `negations` carries the instruction and refusing to
   summarize was never the remedy. For a value that does **not** read (`"1"`, `"0"`, `"Y"`, ordinary
   v2- and C-CDA-to-FHIR converter output) **the element is present, its value is unread, nothing
   records that, and the readout affirms**: the exact shape this item was filed over, surviving one
   spelling over. `codes.ts` states the contract it sits against, that a consumer which does not
   understand a modifier must **refuse** it rather than process it as absent. `SafetyReadout` has
   location channels for content the codec could not read (`nestedArrays`, `droppedText`) and **none
   for "value written, not readable"**. Base did this for `true` too, so it is strictly improved and
   did not block. **Do not let "declared residual" absorb it: it wants its own item.**
   **▶ 🟢 IT GOT ONE AND IT IS CLOSED**, `FHIR-XML-UNREADABLE-BOOLEAN-IS-SILENT`:
   [`xml-unreadable-boolean.md`](xml-unreadable-boolean.md). The remedy was the missing channel
   (`unreadableBooleans`), **not** a wider read: the read is byte-identical to what this slice left.
   Its half of the pin above moved out of `test/xml-lexical-boolean.test.ts` accordingly; residuals
   1-3 stay there, unchanged.

The lexical space itself is the fifth: `"TRUE"`, `"True"`, `"1"`, `"yes"`, `"Y"`, `" true"` and `""`
read as no boolean. Refusing them is right, because coercing would author a value the sender did not
spell. **The refusal being SILENT was the gap, and it is closed for the safety read only** (above):
`primitiveBoolean`'s callers still refuse the same text with nothing on any channel.

## Measurements

**Red-at-base 6-of-22** against a real `4eb444f` worktree (22-of-22 at head). The other **16 are
green in both states on purpose and are named**: seven lexical-space negative controls, the
`doNotPerform`-on-`Patient` type gate, the decimal-form control, the JSON-reader control, the three
profile-census pins, and the three residual pins. Non-vacuity was established by mutation, not
asserted: a case/whitespace-insensitive `booleanOf` reds 3, dropping the `false` arm reds 1,
accepting `"1"` reds 1.

**The gate: `conformance-refuter` REFUTED -> REFUTED -> NOT REFUTED, cumulative 3** (`4b67787`,
`1d9953d`, `27cb42c`; the first two were amended away). **Pass 1's finding was BEHAVIOURAL** (the
`mustSupport` retirement above), which is why **ADR 0027 is NOT available to this slice** and was not
invoked: its route requires that no pass refuted the code. The gate converged instead. **One commit
after `27cb42c` applies pass 3's two advisories and is UNGRADED**, disclosed here, in its own message
and in the PR: it deletes an over-specified _later_ / _earlier_ ordering from the `doNotPerform`
transition sentence at three sites, and corrects "single-consumer" to name the call sites. Both are
documentation, neither adds a guarantee.

**Suite 64 files / 1,316 tests**, which is `#78`'s 1,294 plus this file's 22 exactly, so **no
existing test moved**. **Corpus caveat, standing:** hand-authored XML fixtures plus mutations and
hand-built probes, **not** the FHIR R4 published-examples corpus. Nothing here is corpus-wide.

**Claims deliberately left standing, because this slice cannot grade them:** the _"same schema-free
model"_ universals at `README.md` (x2), `src/index.ts` and `src/xml/read.ts`; _"never drops a status,
modifier, or negation"_ at `README.md` and `docs-content/intro.md`, still qualified by a status
written as XML **element text**, a different channel; and the `@example` blocks on `primitiveString`
/ `primitiveBoolean` (`codes.ts`) that `import` them from `@cosyte/fhir` although neither is
exported, byte-identical at `4eb444f` and reaching no declaration file.
