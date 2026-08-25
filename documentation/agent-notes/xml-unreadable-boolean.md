# The unreadable boolean, reported (2026-08-09, `FHIR-XML-UNREADABLE-BOOLEAN-IS-SILENT`)

Split out of `documentation/agent-notes.md` under the meta-repo's `decisions/0023-doc-budgets.md`
(that file is at its 250,000-byte archive cap, and `CLAUDE.md` is at its own). The cursor stays
there; this is the narrative. Siblings: [`xml-lexical-booleans.md`](xml-lexical-booleans.md), the
slice immediately before this one, and [`xml-magnitude.md`](xml-magnitude.md), the same root class
one datatype over.

## What it was

Filed as a **STOP-THE-LINE** by `#79`'s own gate, outside its slice, and reproduced independently by
the coordinator at `05ecc5a` and again by this slice's probe at the same commit. All agree:

```
<doNotPerform value="true"/>   negations: ["do-not-perform"]   issues: []  safeToSummarize: true  assert clean
<doNotPerform value="1"/>      negations: []                   issues: []  safeToSummarize: true  assert clean
<doNotPerform value="Y"/>      negations: []                   issues: []  safeToSummarize: true  assert clean
<doNotPerform value="0"/>      negations: []                   issues: []  safeToSummarize: true  assert clean
<doNotPerform value="N"/>      negations: []                   issues: []  safeToSummarize: true  assert clean
```

`#79` closed the `"true"` row. **`"1"` and `"Y"` are ordinary v2 and C-CDA converter output for a
boolean**, and R4's `boolean` lexical space is `true|false` (`datatypes.html`), so they are **not
readable** rather than false. **The reading is indistinguishable from `"0"` / `"N"`**: an author who
wrote _"yes, do not administer"_ got the same answer as one who wrote _"no"_, with nothing recorded
anywhere.

**The structural gap was the item, not the site.** `SafetyReadout` had location channels for content
the codec **could not read** (`nestedArrays`, `droppedText`) and **none for "value written, not
readable"**: against `codes.ts`'s own stated `?!` contract.

## 🛑 THE TRAP, WHICH ALREADY REFUTED A PREDECESSOR: DO NOT WIDEN `booleanOf`

**Accepting `"1"` / `"Y"` is the OPPOSITE of what this item asked, and it is a worse defect than the
one it fixes.** It invents a reading R4 does not license, and it turns `<doNotPerform value="0"/>`
and `value="N"` into a JS `false` that `serializeResource` then emits, **authoring a value and
laundering it across a format change**, exactly what `#74` refused. `"1"` and `"Y"` also arrive on
real wires meaning a boolean's `true` _and_, elsewhere, its opposite: there is no safe direction to
guess in.

**What was missing was a REPORT, not a wider read.** `booleanOf` is byte-identical to `#79`'s. The
value stays unread; what changed is that its presence is recorded.

## The remedy

`SafetyReadout.unreadableBooleans`, a third **not-readable** location channel beside `nestedArrays`
and `droppedText`, plus `unreadableBooleans(resource, path)` exported beside them. It feeds
`safeToSummarize` and `assertSafeToSummarize`.

Detection is `hasUnreadableBoolean`, the **exact complement** of the read: it walks the same values
through the same array wrapper (`scalarValues`) and asks `booleanOf` the same question, so a location
is emitted for precisely the values `primitiveBooleans` declined. That coupling is deliberate and is
the reason it cannot false-fire, **it cannot report a value the read did not look at, and it cannot
miss one the read dropped.** A second rule with its own shape could do both.

**It is decided in the safety layer, not the reader, and not the validator.** The reader is
schema-free: `<doNotPerform value="1"/>` and `<status value="1"/>` are the same node to the codec, so
nothing at parse time knows the text should spell a `boolean`. The safety layer is the first place
that knows the datatype.

## 🛑 THE ADDITIVITY ARGUMENT, FROM THE CONSUMERS, AND IT IS THE WHOLE GATE

`#79` paid a refuted pass for the rule that **additivity is a property of the CONSUMERS, not the
helper**: its pass 1 measured an XML `<mustSupport value="false"/>` overwriting an inherited `true`
and **retiring** a `MUST_SUPPORT_ABSENT`.

**That class is unreachable here by construction, and the reason is the strongest form available:
THIS SLICE WIDENS NO READ AT ALL.** No value that was `undefined` becomes defined anywhere, so
nothing that treats `undefined` as _inherit_ or _absent_ ever sees a new value. The consumers, in
full:

| what is added                                                  | who reads it                                                          | can it remove anything                                                                        |
| -------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `SafetyReadout.unreadableBooleans`                             | nothing in tree before this slice                                     | new field; no prior consumer                                                                  |
| `safeToSummarize`                                              | `assertSafeToSummarize` only (every other mention in `src/` is prose) | a conjunction of empty-list tests, one term added: monotone `true → false`, never the reverse |
| `assertSafeToSummarize` locations                              | `FhirSafetyError.locations`                                           | appended last; no existing location is dropped or reordered                                   |
| the read (`booleanOf`, `readDoNotPerform`, `primitiveBoolean`) | unchanged                                                             | **nothing added at all**                                                                      |

**Measured, not argued.** Over a 33-document corpus in a real `05ecc5a` worktree, comparing every
`SafetyReadout` field that exists on both trees, both writers' output, the parse issues, the
`ValidationIssue` list and `valid`: **13 documents move, and in every one the ONLY field that moves
is `safeToSummarize`, `true → false`.** The other 20 are identical on every channel. **No diagnostic
moves anywhere.**

## `safeToSummarize` DOES move, and that is the answer rather than a side effect

Its stated contract is that the library declines when a summary would have to assert something it
cannot establish. An unreadable negation is precisely that. `value="1"` and `value="0"` are
indistinguishable to a reader with no licence to guess, so **affirming over either is affirming over
a coin flip**: and the coin decides whether a medication is given. Both now refuse. Note the
direction that makes this honest: the fix does **not** make `"Y"` and `"N"` read differently; they
still read alike, because they _are_ alike to this library. What changed is that the shared answer is
a refusal instead of an affirmation.

## The census: the class is WIDER than the channel, and the channel says so

**Booleans the safety spine reads out of a document: exactly one.** `MedicationRequest.doNotPerform`.
`retracted` and `noKnownAllergy` are derived from codes and codings, not from a `boolean` element. So
the channel is **complete for its own layer** and for nothing beyond it, and that limit is written
into its docblock rather than left to be discovered.

| site                                          | read via                         | unreadable value at head | disposition              |
| --------------------------------------------- | -------------------------------- | ------------------------ | ------------------------ |
| `MedicationRequest.doNotPerform`              | `primitiveBooleans` (safety)     | **REPORTED**             | **FIXED**                |
| `ElementDefinition.mustSupport`               | `primitiveBoolean` (convenience) | silent                   | standing, pinned         |
| `ElementDefinition.slicing.ordered`           | `primitiveBoolean` (convenience) | silent                   | standing, pinned         |
| `ElementDefinition.min` (`unsignedInt`)       | `parseMin`                       | silent                   | narrowed 2026-08-09      |
| `Quantity` magnitude (`+5`, `05`, `.5`, `5.`) | `readQuantity`                   | silent                   | standing, `#78`'s pin    |
| FHIRPath `numberOf`                           | FHIRPath                         | silent                   | standing, `#79`'s census |

**The `min` row narrowed on 2026-08-09 and the row is scoped, not retired.** `parseMin` now reads
R4's **`unsignedInt`** lexical space off XML (`[0]|([1-9][0-9]*)`, `min`'s own datatype), so a stated
bound is enforced and `<min value="0"/>` reads faithfully as `0`; a `min` written **outside** that
space (`+1`, `01`, `1.0`, `" 1"`, `1e2`) is still unread and still silent, which is what this table's
column measures. [`xml-profile-min.md`](xml-profile-min.md).

**The two profile booleans are not merely unfixed here, they have nowhere to go.** A
`StructureDefinition` is not a safety resource and has no `SafetyReadout`, so reporting them needs a
home this slice does not build, a second reason on top of `#79`'s measured retirement.

## The one deliberate asymmetry: NO `ValidationIssue` OF ITS OWN

**On the default path this is the first place on the readout where `safeToSummarize: false` sits
beside `valid: true`.** Stated rather than glossed, because it is new.

**🛑 THE REASON IS AVAILABILITY, AND TWO STRONGER-SOUNDING VERSIONS OF IT ARE FALSE. THE GATE
REFUTED BOTH, ONE PER PASS, IN THIS PARAGRAPH.**

**Pass 1 killed** _"the validator is schema-free and every rule it carries is about a shape FHIR gives
no meaning to at any position"_. It is not schema-free: `validateResource` takes `{ schemas }`,
`validate.ts` resolves a datatype from the registry, and `validate/primitives.ts` decides `boolean`
on it.

**Pass 2 killed the replacement**, _"supply a schema and it draws `TYPE_MISMATCH` on the conformant
`value="true"` too, so it does not separate readable from unreadable"_. The three rows behind that
were all **XML**, and the conclusion was drawn unscoped over a channel whose own docblock says "in
either wire format". On the **JSON** wire it is plainly false: `validatePrimitiveValue` shape-checks
`typeof value === "boolean"`, so a conformant `{"doNotPerform":true}` validates **clean** with a
schema supplied while `{"doNotPerform":"Y"}` draws `TYPE_MISMATCH`. The package's own pending
`olive-comets-listen` changeset already said so.

**What survives unscoped is availability, not discrimination.** `MedicationRequest` has **no built-in
schema** (`BUILTIN_SCHEMAS` was `[Patient]` when this was written and is `[Patient, Observation]`
from 2026-08-25; `MedicationRequest` is in neither list, so the claim is unchanged, and read the set
off the module rather than off this parenthesis), so the validator is silent about this element's
**datatype** unless a caller supplies one (the shape channels, `ARRAY_WRAPPED_SCALAR` and
`DUPLICATE_PROPERTY`, still fire at this element with no schema at all: pass 3's one-word finding), and a readout that has to hold on every document cannot be built on a diagnostic
that only exists when a caller opts in. The safety layer knows the datatype **unconditionally**, which
is why the report lives there. Pinned on the default path and with a schema supplied.

**🛑 A CORRECTED CLAIM IS A NEW CLAIM, AND THIS PARAGRAPH PRODUCED THREE, EACH STILL A LITTLE WIDE.**
Pass 3 graded the third **NOT REFUTED** but found it wide by one word (_"silent about this element"_
where only its **datatype** is silent), which is the narrowing above. Every one of the three was the
_reason_ reaching further than the _measurement_, and every remedy was a deletion or a narrowing.
**Measure both wires, and both the datatype channel and the shape channels, before writing a general
sentence here.**

**Also raised by pass 3, `PRE-EXISTING` and advisory:** `readDoNotPerform` is **root-only**, so a
`Bundle` whose `entry[0].resource` is a **conformant** `MedicationRequest` with `doNotPerform: true`
reads `negations: []` and `safeToSummarize: true`, while the _unreadable_ spelling at the same
location **is** reported by this channel. Identical at `05ecc5a`. Pass 3's disposition, adopted: fold
it into the `ServiceRequest` item below rather than opening a second one, since both are the spine's
read scope rather than a report.

**And `FhirSafetyError.message` moves, outside the corpus measurement above**: it now names this
sixth shape, so the string changes for **every** refusal it raises, including the five that already
refused. `locations`, the class and the thrown type are unchanged. Named because the measurement
enumerates readout fields, parse issues, `ValidationIssue`, `valid`, `negations` and both writers,
and a public-observable string that moves outside that set has to be said out loud.

## Measurements

- **Red-at-base 18-of-30**, 30-of-30 at head, derived in a **real `05ecc5a` worktree** with a
  base shim that supplies the new surface with **base's own semantics** (an always-empty channel,
  because base reports nothing), so each test measures behaviour rather than a missing export. The 12
  both-states pins, named: the two conformant spellings `true` / `false`, the absent element, the
  value-less primitive carrying only metadata, the non-MedicationRequest type gate, the conformant
  JSON `MedicationRequest`, this package's own XML round trip, the no-`ValidationIssue` pin, the
  object/empty-array shape, the JSON `null`, the two profile booleans, and the non-boolean datatype.
- **Non-vacuity by mutation, seven of them, each reds at least one pin:** dropping the
  `MedicationRequest` type gate reds 1; stopping `hasUnreadableBoolean` reading through the array
  wrapper reds 2; firing it on a value-less primitive reds 2; dropping the new term from
  `safeToSummarize` reds 13; accepting `"1"` in `booleanOf` reds 1; reading only `node.properties`
  and not the shadowed `duplicates` reds 1; dropping the channel from `assertSafeToSummarize`'s
  location list reds 1.
- **Suite 65 files / 1,346 tests** = `#79`'s 1,316 + this file's 30, so **no existing test moved**.
  One existing test was **rewritten rather than added to**: `#79`'s pin _"still affirms
  safeToSummarize over a doNotPerform this reader cannot read"_ looped over `["true", "1"]` and the
  `"1"` arm is what this slice closes, so the pin now covers the `"true"` arm only and names where
  the other half went. That is the pin discipline working, not a test being weakened.
- Verify green: 11 `==>` step headers, 11 `ran:` entries, zero `(FAIL)`, no unladdered-script warning.

## 🛑 RAISED BY PASS 1, OUTSIDE THIS SLICE: `ServiceRequest.doNotPerform` IS NOT READ AT ALL

`PRE-EXISTING`, identical at `05ecc5a`, so it did not block. **It is a sharper shape than the item
this slice closed**, and it needs its own item.

R4 marks `ServiceRequest.doNotPerform` (and `CommunicationRequest.doNotPerform`) a `?!` **boolean
modifier element**, exactly as `MedicationRequest.doNotPerform` is. `readSafety` gates the read on
`isType("MedicationRequest")` and `ServiceRequest` is not in `SAFETY_RESOURCE_TYPES`, so a
**conformant JSON** `{"resourceType":"ServiceRequest","doNotPerform":true}` reads `negations: []`,
`unreadableBooleans: []`, `safeToSummarize: true`, `assertSafeToSummarize` clean. **This one is not
an unreadable value: the document is conformant and the instruction is simply not looked for.**

**Do not fold it into a channel slice.** The remedy is a question about the spine's type scope
(`SAFETY_RESOURCE_TYPES` and `NegationKind`), not about a report, and widening the spine touches
every type-gated read at once.

## Corpus caveat

Hand-authored XML and JSON fixtures, mutations and hand-built probes, **not** the FHIR R4
published-examples corpus. Nothing here is corpus-wide.
