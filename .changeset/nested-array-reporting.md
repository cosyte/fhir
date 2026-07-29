---
"@cosyte/fhir": patch
---

Stop affirming a safety verdict over an array inside an array (`FHIR-NESTED-ARRAY-REPORTING`).

FHIR JSON uses an array for a repeating element and for nothing else (json.html §2.6.2.2), so a list
of lists has no meaning at any position. The reader does not model the inner array, so content the
sender wrote is genuinely missing from the model at that position, and the model then looks exactly
like an element the sender legitimately left out. Measured on `main` at `8a5245a`: a **refuted**
`AllergyIntolerance` and a **resolved** `Condition` whose coding sat one level down inside a
`CodeableConcept` both read back `valid: true`, `safeToSummarize: true`, `negations: []`; a whole
resource inside a `Bundle.entry` went missing the same way with the same clean verdict; and a nested
array inside a primitive's `_`-sibling drew **no diagnostic at all**. Pre-existing, declared as a gap
by the two preceding array slices (`FHIR-ARRAY-WRAPPED-SCALAR`, `FHIR-CODING-SCALAR-WRAPPER`).

This is the **reporting** half of `FHIR-NESTED-ARRAY-DATA-LOSS`, split from the preserving half by
founder decision after the conformance gate refuted the combined change twice. New
`ISSUE_CODES.NESTED_ARRAY` (warning, on the read), `VALIDATION_CODES.NESTED_ARRAY` (**error**, in
`validateResource`), `SafetyReadout.nestedArrays` + `nestedArrays()` (public, mirroring
`shadowedProperties` / `arrayWrappedScalars`), `isNestedArray()` on the model, and
`safeToSummarize: false` with `assertSafeToSummarize` throwing. Because the shape is meaningless
at every position, the rule needs no cardinality table and no element list and cannot fire on a
conformant document, so it runs at every position the model has a node for, at every depth,
including a primitive's `extension` metadata, a `contained` resource, a Bundle entry, and a member a
repeated property name shadowed. **The rule is bounded by what the reader modeled, and the
conformance gate refuted an earlier draft of this text for claiming otherwise:** a `_`-sibling the
reader discards _whole_ because it is misplaced or unrecognised (one sitting on an object or a
non-primitive array, or a member of a `_`-sibling object that is neither an `id` _string_ nor an
`extension`
array) leaves no node to report against, so an array inside one draws the unexpected-property warning
for the discarded sibling and no refusal. Unchanged from before this slice, now stated on every
public surface and pinned by a test.

**The inner array is still not read, and that boundary is the point of the split.** A list holds
exactly the items it held before, of the same kinds, with the same contents, so nothing that walks a
repeating element sees anything new: `codingsOf`, the FHIRPath engine, the profile path navigator and
the terminology walker all behave exactly as they did. Modeling the inner array is what refuted the
combined attempt twice, because at least nine sites flatten a list into its items without
distinguishing a nested one, so producing a nested list silently redefines what a list means for
every consumer; the deferred half is tracked as `FHIR-NESTED-ARRAY-PRESERVATION`.

**No existing finding is suppressed**, which is the direction that matters when a safety fix adds a
diagnostic. The `UNKNOWN_PROPERTY` warning the reader already raised at those positions is kept and
the new code is raised **alongside** it, never instead of it. Differential over **1,639** documents
(every JSON fixture, one mutation per path per mutation kind, plus a hand-built element-level corpus
covering the `CodeableConcept` element itself and not only its members): **0** read diagnostics lost,
**0** validation findings lost, **0** `valid: false -> true`, **0** `safeToSummarize: false -> true`,
**0** negations / retractions / no-known-allergy reads lost, **0** locations lost from
`unhandledModifierExtensions` / `shadowedProperties` / `arrayWrappedScalars`, every convenience field
identical, and every one of the 1,639 documents serialized byte-for-byte identically. What it bought:
**819** documents now report the shape, of which **626** were previously `valid: true`, **694** were
previously `safeToSummarize: true`, and **24** previously read with zero diagnostics of any kind.

Both report channels name the same FHIRPath position where the nested array is the element or is
the extension item itself, including inside a primitive's `extension` metadata where the reader's
older warnings use a `_`-prefixed path that is not FHIRPath. One level _inside_ an extension the
older convention is back on the reader's path, so the two channels name that position with two
different strings; neither is silent and neither is wrong, and that residual is pinned by a test.

`nodesEquivalent` now compares the marker, so the cross-format oracle can no longer call a lost
element the same as an element that really was empty. That can only ever return `false` where it
returned `true`, and only for a document carrying the shape.

**Known limitation, pinned by a test rather than described:** the writer emits the empty element the
model holds, so writing such a resource back out and reading it again produces a clean document. It
belongs to the preserving half; the complaint is on the read, which is where a consumer of a document
they did not write sees it.
