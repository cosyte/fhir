---
"@cosyte/fhir": patch
---

Keep the contents of an array inside an array, and stop the writer inventing an element there
(`FHIR-NESTED-ARRAY-PRESERVATION`).

FHIR JSON uses an array for a repeating element and for nothing else (json.html §2.6.2.2), so a list
of lists is not an element and the reader has nothing to make of it. `FHIR-NESTED-ARRAY-REPORTING`
(#37, `b2c5ee7`) closed the affirming half of that: such a position can no longer sit under a clean
verdict. **The data loss itself was untouched, and this closes it.** `[["x"]]` dropped the inner
value outright, against the package's stated no-data-loss claim, and the writer then emitted `[{}]`
for the empty element the model held, fabricating an object the sender never wrote and laundering the
finding away on a re-read.

**The array's exact JSON text is now preserved on the node** and handed back by the new
`nestedArrayContent()`, which returns it per JSON channel (`value` / `metadata`), because a repeating
primitive can nest in its value array, in its `_`-sibling array, or in both at one position. New
model fields `FhirComplex.nestedArraySource`, `FhirPrimitive.nestedArraySource` and
`FhirPrimitive.nestedArrayMetaSource`, and the exported types `NestedArrayChannel` /
`NestedArrayContent`. A decimal inside a preserved array keeps its exact lexical text, so ADR 0001
holds at a position the model cannot place. `serializeResource` writes the array back, which is the one
place the writer emits something it would not author: emitting the empty element fabricates content
and omitting the position drops it, and writing it back is what makes the finding reproduce on a
re-read instead of vanishing. The preserved text is the array re-rendered compactly (member order,
repeated keys and every number's exact source survive; insignificant whitespace does not, and strings
are re-escaped canonically), so it is value-exact rather than byte-exact, and such output is
deliberately not spec-clean. The public doc comments on `serializeResource` and the README's
Postel's-Law bullet are corrected to state that bound rather than claim spec-clean output
unconditionally. `nodesEquivalent` compares the preserved text, so two
documents that nested _different_ content are no longer equivalent.

**The preserved content is text, not an element, and that is the whole design.** Two graded attempts
to model the inner array were refuted, both because modelling it made it transparent to every walker:
one erased a true `VITAL_SIGN_UNIT_NONCONFORMANT` and asserted `noKnownAllergy: true` over a record
naming an allergen, the other retired an `error`-severity profile invariant. A string carries no edge
in the node graph, so no walk can reach it: the reader still never puts a list inside a list, and
every consumer that flattens a repeating element sees exactly what it saw before.

**Two more fixes in the same mechanism.** The writer **dropped a `resourceType` it could not hoist**
(anything that is not a string primitive), silently losing whatever the sender wrote at the loudest
position in the document; it is now emitted through the ordinary path, which means it keeps its
position in the document rather than being hoisted, and the `@returns` on `serializeResource` says
so. And the reader now names a
primitive's `id` / `extension` metadata in **FHIRPath form at every depth** (`birthDate.id`,
`birthDate.extension[0].url[0]`) rather than the JSON encoding's `_`-prefixed form, so a read
diagnostic and a safety location for the same position are the same string. That replaces a
single-call-site path override with one convention for the whole reader; 25 distinct diagnostic
expressions change shape, none is added or removed.

**Left open, deliberately, and pinned by tests rather than prose:** a scalar written beside a nested
array in the same array (`"given":[["Peter"],"James"]`) lands where an object was expected and is
still dropped, a different unplaceable shape with its own model surface; and a `_`-sibling the reader
discards whole still leaves no node to carry either the marker or the text.

**The audit, measured at `b2c5ee7`:** 57 `.items` sites across 21 files, 5 of them `RawArray` rather
than `FhirList`; 3 flatten with no kind check at all; 21 check the kind and then silently drop what
is not it, ten of those toward a false `valid: true`; exactly one fails closed. This change adds two sites
under the same count: one `RawArray` (`codec/raw-json.ts::rawJsonText`) and one inside a JSDoc
`@example` on `nestedArrayContent`, which flattens nothing. The conclusion is carried by
`test/model-edges.test.ts` rather than by those counts.

**Measured against `b2c5ee7` over 2,622 documents**, both source trees loaded into one process and
every walker exercised at every node: 0 read diagnostics lost, 0 validation findings lost, 0
`valid: false → true`, 0 `safeToSummarize: false → true`, 0 negations or retractions lost, 0
locations lost from any location list, 0 documents that newly throw. Every serialization change is
accounted for: 982 documents carrying a nested array and 128 carrying a `resourceType` the writer
used to drop, 0 from any other cause, and **0 outputs got shorter**. Of the 982, all 982 laundered
the finding away on a write and a re-read before this change and **0 do now**, with 875 written back
byte-identical to the input.
