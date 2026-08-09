# The untaggable `resourceType` (2026-08-09, `#77`)

Split out of `documentation/agent-notes.md` under the meta-repo's `decisions/0023-doc-budgets.md`:
that file is at its 250,000-byte archive cap, and a later slice needed the room. **Relocated
verbatim, nothing dropped**: the heading below is this section's original one. The cursor stays in
`agent-notes.md`.

## The untaggable `resourceType` (2026-08-09)

`FHIR-XML-WRITE-RESIDUALS`, the non-string-`resourceType` residual `#74`, `#75` and `#76` each
declared open. `SERIALIZE_ERROR_CODES.UNSERIALIZABLE_RESOURCE_TYPE`, raised **last** in the XML
writer, as a whole-model pre-pass. XML only.

### The defect, measured against `63b05fc`

FHIR XML has no `resourceType` element: the type IS the tag (xml.html). `writeElement`'s skip is
`if (name === "resourceType") continue;`, unconditional on the name, and `resourceTypeOf` returns a
string or nothing, so `serializeResourceXml` fell back to `tagName = rt ?? "Resource"`. Where the
value was not a string, the property was deleted and the element was named a type nobody wrote.

| in                                                                                         | reads                                         | XML out                                                     | re-read                                                                         |
| ------------------------------------------------------------------------------------------ | --------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `{"resourceType":42,"status":"entered-in-error"}`                                          | `RESOURCE_TYPE_UNKNOWN`/error, `valid: false` | `<Resource …><status value="entered-in-error"/></Resource>` | `[]`, `valid: true`                                                             |
| `{"resourceType":{"modifierExtension":[{"url":"http://example.org/x"}]},"status":"final"}` | `valid: false`, `safeToSummarize: false`      | `<Resource …><status value="final"/></Resource>`            | `[]`, `valid: true`, `safeToSummarize: true`, `unhandledModifierExtensions: []` |
| `{"resourceType":"Patient","contained":[{"resourceType":42,"status":"entered-in-error"}]}` | `valid: true`                                 | `<contained><status value="entered-in-error"/></contained>` | a `contained` backbone element, not a contained resource                        |
| `{"_resourceType":{"id":"q"},"status":"final"}`                                            | `RESOURCE_TYPE_UNKNOWN`/error                 | `<Resource …><status value="final"/></Resource>`            | the `id` gone                                                                   |

**The second row is the whole point of taking this leg.** `safeToSummarize` moves because the deleted
property takes its **entire subtree** with it, and a `modifierExtension` -- FHIR's `?!` rule, the one
thing a reader may never ignore -- is among the things that subtree can hold. That is the same shape
`#74`, `#75` and `#76` each closed through a different door: a format change that **upgrades** a
document's own trustworthiness claim.

### The predicate, and why it is element-level rather than property-level

`lacksTaggableResourceType`: the element wrote a `resourceType`, and **the first one it wrote** is not
a string primitive. Both halves are load-bearing and the second took three attempts.

- **THE QUANTIFIER MUST BE THE WRITER'S OWN, AND `ANY` IS NOT IT. Gate pass 1 refuted the draft that
  asked whether ANY value written there is a string.** `resourceTypeOf` in `src/xml/write.ts` is a
  `find`, and `typeOf` goes through `getProperty`, which is first-wins as well. So with a non-string
  first and a string second the writer read no type, named the element `Resource`, deleted **both**
  properties and took the modifier extension with the subtree -- and an `any`-quantified predicate
  answered `false` and refused nothing. **The defect, unrefused, inside the slice that claimed to
  close it**, and the claim that the shape was safe had reached five carriers. Neither reader emits
  that order, so it is hand-built and pinned that way; the general rule is that **a guard that answers
  for a property the writer never consults is not guarding the writer.**
- **A property-level predicate ("this `resourceType` is not a string") is WRONG, and the counterexample
  comes from XML rather than from JSON.** The XML reader has no `duplicates` mechanism and pushes the
  type synthesized from the tag first, so a `resourceType` CHILD element lands as a second property of
  that name beside it: `<Patient xmlns="http://hl7.org/fhir"><resourceType><a value="1"/></resourceType></Patient>`
  reads as two `resourceType` properties in one `FhirComplex`, `issues: []`, `valid: true`,
  `safeToSummarize: true`. The tag there is named correctly, so this defect's substitution never
  happens; what drops is the repeated-property-name case, which both writers do and which is declared
  separately. A property-level predicate refused it, and **the cost of that is withdrawing
  serialization from a model this library reports as clean.** Do not write it up as "the one cost
  none of the refusals beside this one pays", which this note did and which is FALSE: `breaksTag`
  pays it too, on `<a:!x xmlns:a="http://hl7.org/fhir" value="1"/>`. **Rarity was never the argument;
  the cost is.** Gate pass 2 caught the idiom, tagged it `PRE-EXISTING` because it is verbatim at
  `63b05fc`, and it is cut here at the three carriers this slice authored. **Two base-owned carriers
  are LEFT, on purpose and named so the next reader does not have to find them:**
  `src/codec/serialize-guard.ts` (the `assertNoShadowedProperty` docblock) and
  `test/shadowed-property-write.test.ts`. They belong to `#76`'s slice, not this one.
- **An ABSENT `resourceType` is left alone.** `serializeResourceXml` accepts any `FhirComplex` and
  names a typeless one `Resource` by documented fallback, so refusing there would withdraw a route
  from every model that never had a type -- and nothing is deleted in that case. **The line this
  refusal draws is "the writer drops a property the sender did write", not "the verdict moved".**

### The bound, which is structural and holds only at the root as a verdict

At the **root**, this costs a round trip only for a model already reported `valid: false`: `typeOf` is
the strict single-value read, so exactly the values refused here draw an error-severity
`RESOURCE_TYPE_UNKNOWN`. **Deeper it does not hold, it is not claimed, and a document read from XML
reaches it.** `{"resourceType":"Patient","contained":[{"resourceType":42,…}]}` and
`<Patient xmlns="http://hl7.org/fhir"><name><resourceType><a value="1"/></resourceType></name></Patient>`
both read `valid: true` with an empty issue list, because no layer here checks a nested element's type.

**So the bound that IS claimed is structural, and it is by construction rather than by sampling**:
the writer's skip is unconditional on the name, so at every location this refuses base dropped a
property the sender wrote and emitted no element for it, with no diagnostic at either end. What is
withdrawn is a deletion, never a round trip that reproduced the input.

### Raised last, and nothing moved onto it

Last in the chain, after `UNSERIALIZABLE_ELEMENT_NAME`, `UNSERIALIZABLE_DIV_MARKUP`,
`UNSERIALIZABLE_JSON_ONLY_SHAPE`, `UNSERIALIZABLE_ARRAY_WRAPPER` and `UNSERIALIZABLE_SHADOWED_PROPERTY`.
Measured, one document per code, each an untaggable type gate spelled a different way:
`{"resourceType":null,…}` keeps `UNSERIALIZABLE_JSON_ONLY_SHAPE`, `{"resourceType":["Observation"],…}`
and `{"resourceType":[],…}` keep `UNSERIALIZABLE_ARRAY_WRAPPER`,
`{"resourceType":42,"resourceType":"Observation",…}` keeps `UNSERIALIZABLE_SHADOWED_PROPERTY`, and an
XML document with dropped element text keeps `DROPPED_ELEMENT_TEXT`. **No case moved onto the new
code.** Pinned by `test/xml-resource-type.test.ts`, "raised last, so no case moves onto the new code".

The walk is `collectMarked`'s, shared with `droppedText` / `nestedArrays` / `assertXmlSerializable`
rather than copied, and it selects **elements**; the location appends the `resourceType` segment with
`childPath`, which is how the array wrapper on the same property already reports it
(`Resource.resourceType`, `Patient.contained[0].resourceType`).
**`collectMarked`'s signature was left alone.** A first draft widened its predicate to receive the
property name so the walk could answer property-level questions; that draft was reverted with the
property-level predicate it existed for, and the shared walk is unchanged in this slice.

### Both polarities, on the test rather than on a harness

`test/xml-resource-type.test.ts` **fails 13 of 25 against the base source tree** (the two `src/` files
stashed) and passes 25 of 25 at head. A control asserted in one state only clears nothing here; this
one is asserted in both.

**IT USED TO READ 7 OF 23, AND THE MISSING SIX WERE VACUOUS GREENS. A GREEN IN BOTH STATES CLEARS
NOTHING EITHER.** Those cases asserted `viaXml?.code` against
`SERIALIZE_ERROR_CODES.UNSERIALIZABLE_RESOURCE_TYPE`, and against a base tree **both sides are
`undefined`**, so `expect(undefined).toBe(undefined)` passed and the four scalar spellings the
CHANGELOG leans on discriminated nothing in the polarity that matters. They now assert a **string
literal**, with the enum member pinned once on its own. Raised by gate pass 1 as an observation rather
than a finding, which is why it is written down here.

The out-of-tree harness carried its own negative control: pointed at `@cosyte/hl7` instead of this
package it exits non-zero on the missing `serializeResourceXml` rather than reporting green.

### Not closed by it, named rather than implied

- **A JSON decimal comes back from XML as a string**, because XML carries no JSON type.
- **`Observation.value[x]`** is outside the array-wrapper window and its wrapper still launders.
- **A `resourceType` CHILD element read from XML is still dropped by both writers**, silently, and
  that document reads `valid: true`. It is the repeated-property-name case reached through a door the
  reader's missing `duplicates` mechanism opens, not this one, and refusing it would pay the cost
  named above. `<Patient xmlns="http://hl7.org/fhir"><resourceType value="Observation"/></Patient>`
  comes back as `<Patient xmlns="http://hl7.org/fhir"/>`. Pinned as a characterization test.
- **The XML reader putting two properties of one name in one `FhirComplex`** is the underlying gap
  behind that row, and it is a READ-path decision, not this branch.

### The axis of every "0" here

**None of the numbers above is the FHIR R4 published-examples corpus.** They are 7 hand-authored XML
fixtures plus mutations plus this repo's hand-authored JSON fixtures, plus the hand-built documents in
`test/xml-resource-type.test.ts`. The read differential cannot grade this class: the substitution is a
WRITE-path branch, no XML document produces the marker, and its own control is stale on a clean tree.
No zero of its is quoted as evidence here.

### What the gate found (pass 1, `52472c2`)

`REFUTED`, and **the first `fhir` slice in eleven where the gate found a defect in the code rather
than only in a sentence.** The escalated process finding above -- ten consecutive slices refuted on
prose, and the pressure that creates to write a longer sentence -- ends here on the opposite outcome:
the remedy was a **quantifier**, and the prose shrank around it.

1. **`INTRODUCED` major, and it is the item's own leg.** `some` in the guard against `find` in the
   writer, above. Remedied in the predicate, not in the claim: aligning it refuses nothing either
   reader can build, and it makes the root-level bound (`typeOf` is first-wins, so exactly the values
   refused draw an error-severity `RESOURCE_TYPE_UNKNOWN`) true as written instead of nearly true.
2. **`INTRODUCED` minor: the thrown message stated a counterfactual false at every depth it reports.**
   _"...which this writer would delete while naming the element `Resource`"_ -- but at depth the tag
   comes from the property name, and the message is emitted for `Patient.contained[0].resourceType`.
   **Cut to what is true everywhere: "which this writer would delete."** The `Resource` substitution
   is a root fact and is stated where it is true.
3. **`PRE-EXISTING` minor, taken anyway because this slice edits the paragraph and widens it.** The
   module comment's _"No refusal here recognises anything new, invents a value, or changes a document
   that reads clean"_ was already false at base -- `breaksTag` names a zero-issue document it refuses,
   and so does the `div` forgery. **Only the false clause is cut**; the two true ones are kept, which
   is the `#76` rule. One carrier, so cutting it there is the whole sweep: `dist/` is generated, and
   no pending changeset carries the sentence.

What the gate could **not** grade, in its own words: every "measured at `63b05fc`" number, because its
Bash is `git diff`/`log`/`show` only. Those were re-measured by hand against a `63b05fc` worktree
before the pass and again after the remedy.
