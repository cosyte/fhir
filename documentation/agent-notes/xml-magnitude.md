# The XML magnitude, read (2026-08-09, `FHIR-XML-WRITE-RESIDUALS`)

Split out of `documentation/agent-notes.md` under the meta-repo's `decisions/0023-doc-budgets.md`
(that file is at its 250,000-byte archive cap). The cursor stays there; this is the narrative.

## The filed line was half right, and the halves disagree

*"A JSON decimal returns from XML as a string"* is a **declared limit** at the model, not a defect.
FHIR XML carries every primitive as the text of its `value` attribute and the reader is schema-free
by design: with no `StructureDefinition` in hand it never guesses a datatype. Precision survives on
both paths (no `number` is involved either way), and `nodesEquivalent` already accounts for it.

**But `readQuantity` accepted only the JSON reader's shape.** Measured at `b60e720`, an XML
`MedicationRequest` whose dose is written `<value value="5"/><code value="mg"/>` read back as
`{ value: undefined, code: "mg" }` under `issues: []`, and the same held for
`readObservationValue().quantity` and both `readReferenceRanges` bounds. `undefined` is this API's
documented word for *no magnitude*, so a document that carried one came back as the **bare-unit
shape**. Now read from either reader's model, recognised against the R4 `decimal` lexical space, text
carried through unchanged.

**NO DIAGNOSTIC MOVED, MEASURED RATHER THAN ARGUED:** nothing in `src/validate/` branches on
`Quantity.value` (both UCUM checks read `system` and `code`), and `scripts/read-differential.ts`
reads no quantities. Confirmed independently by the gate: `validateResource` output is byte-identical
base vs head across every probe.

**COLLATERAL, DECLARED: the model records no provenance**, so a JSON document that spelled its
magnitude as a string is read the same way. Upheld by the gate as *not* the ADR 0018 tolerance this
repo refused for element-text recovery: that one invents a value slot FHIR XML does not define; this
one reads a magnitude written **at** `Quantity.value` in a form R4's own regex defines.

## Four residuals, pinned by `test/xml-quantity-magnitude.test.ts`

Each is a characterization test over a gap. Closing one MUST red it, in the same change.

1. Re-serializing an XML-sourced decimal to JSON **quotes** it (`"1.50"`, not `1.50`). Text
   byte-exact, JSON type not.
2. `validatePrimitiveValue` reads the JSON reader's model shape as **the** model shape, so a
   conformant `<active value="true"/>` draws `TYPE_MISMATCH` and flips `valid` where the JSON twin
   validates clean. **The in-place lexical fix RETIRES A REAL mismatch on `{"active":"true"}` and
   nothing separates the two: a decision, not a patch.** The gate found no safe in-place remedy
   either, and recorded one safe out-of-place one for a future slice: provenance need not live in the
   model, because `parseResourceXml` already returns a `ReadResult`, so a caller-supplied validate
   option separates them without touching the JSON rule.
3. `matchesFixed` compares model shapes, so a profile's `fixed[x]` decimal never matches XML.
4. **The bare-unit shape is NARROWED, NOT RETIRED, and it is still silent.** `+5`, `05`, `.5`, `5.`
   and `" 5"` are outside R4's `decimal` space, so they read `undefined` beside a unit that reads
   fine, with nothing on any diagnostic channel. Refusing to read them is right (coercing would
   author a magnitude the sender did not spell); the residual is that the refusal is silent.

## What the gate caught, pass 1 (`9a6f0dc`, `REFUTED`, two `INTRODUCED` majors, both deletion-shaped)

- **A universal written INTO the remedy.** *"It never means 'present but unread'"* was false at
  residual 4, in **five carriers** (two in `src/quantity/ucum.ts`, `CHANGELOG.md`, the changeset, the
  commit). The pressure this lineage keeps naming, arriving on the pass that finally had code to
  report: a guarantee is a longer sentence than a measurement.
- **A phrase sweep is not a carrier sweep, third slice running.** *"Four false 'same model' sites
  cut"* was itself false: `agent-notes.md`'s `#p2-p3-and-what-the-package-does-today` carried the same
  universal, and `documentation/` is on the written carrier list. **Five.** **NO COUNT IS GIVEN FOR
  WHAT IS LEFT**, and that is the pass-2 lesson: the "two weaker sites, seen and left" census written
  here was itself short, and named a line number already stale. Weaker, mostly self-disclosing forms
  survive across `src/`, `README.md`, `CHANGELOG.md` and `documentation/`. Cutting them is its own
  slice. **Sweep by carrier, never by phrase, and do not replace a bad census with a better one.**
- **`instanceof` bought nothing and lost a magnitude base read.** The base predicate was duck-typed
  (`typeof node.value === "object"`); `instanceof FhirDecimal` fails the brand check for a decimal
  built by a second copy of the module graph, which is the bare-unit shape again. Reverted to the
  duck type, which narrows identically in TypeScript.
- `JSON_NUMBER` was documented as a **strict superset** of the R4 `decimal` space. They are equal,
  character for character, and the new docblock in the same file said so: cut.

Upheld on every measurement: the R4 space and nothing wider (`5`, `-0`, `0.010`, `1.0E2`, `1e+2`,
`9223372036854775807`, `&#53;` read; `+5`, `05`, `5.`, `.5`, `1_000`, `0x10`, `Infinity`, `NaN`,
Arabic-Indic digits refused, nothing coerced or normalised); polarity re-derived independently at
**7 failed / 10 passed of 17**, no `expect(undefined).toBe(undefined)` shape anywhere.

## What the gate caught, pass 2 (`cb28b8b`, `REFUTED`, two `INTRODUCED` majors, both deletion-shaped)

**▶ 🛑 THE HEADLINE, AND IT IS A RULE ABOUT REMEDIES: BOTH FINDINGS WERE THE PASS-1 REMEDY ITSELF,
RECOMMITTING THE DEFECT IT FIXED, ONE STEP NARROWER EACH TIME.** No pass has refuted the code.

- **A false UNIVERSAL was replaced by a false MODULO.** *"`nodesEquivalent` defines cross-format
  equivalence modulo exactly this"* and *"the difference is a primitive's lexical form"* name **one**
  of the **two** irreducible differences `src/xml/equivalence.ts` itself enumerates: the other is the
  **singleton list** (JSON `name` is a `list` node, XML `name` a `complex` one). Seven carriers.
  **THE REMEDY IS DELETION, NOT ENUMERATION** -- adding "and singleton lists" would still be short,
  because `equivalence.ts` names two further corner cases below its numbered pair. What ships asserts
  **non-identity** and points at the oracle, which is what that file already told a reader to do.
- **The census of what was LEFT was itself short**, and cited a line number already stale. Hence: no
  count anywhere, and the rule instead of the number.
- **A commit message is a carrier that cannot be cut.** `9a6f0dc`'s body still carries the refuted
  guarantee in weaker words, and `scripts/ship.sh` squash-merges. **So the squash body is written by
  hand rather than filled from the branch**, and this is the standing reason.

## The pass ledger

`9a6f0dc` `REFUTED` -> `cb28b8b` `REFUTED` -> the pass-2 remedy. **Cumulative: 2 graded passes**, both
claim-width, **neither touching behaviour**. Any further pass is restricted to the remedy diff, and
there is no fourth.

## The axis of every number here

7 hand-authored XML fixtures plus mutations, this repo's hand-authored JSON fixtures, and hand-built
probes. **None of it is the FHIR R4 published-examples corpus.** Nothing here is corpus-wide.
