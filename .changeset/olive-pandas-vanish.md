---
"@cosyte/fhir": patch
---

`serializeResourceXml` no longer emits an empty element for a shape only FHIR JSON can spell
(`FHIR-JSON-ONLY-SHAPE-LAUNDERED`).

The JSON reader marks four positions FHIR JSON gives no meaning to and keeps what the sender wrote at
them, so `serializeResource` hands it back and re-reading the output reproduces the finding: an array
inside an array, a scalar or `null` where FHIR JSON has an object, that same shape in a primitive's
`_`-sibling, and a `null` in a primitive's value channel that padded nothing.

XML has none of those channels. No array of arrays, no `_`-sibling (a primitive's metadata is
co-located as an `id` attribute and child `<extension>` elements), and no `null` at all. So the XML
writer emitted the node the reader was left holding, an empty element or none, and that output
re-reads with an **empty issue list**: the finding is gone and the shape is erased. Not always fully
conformant, and the difference is pinned rather than smoothed over: three of the four emitted
documents re-read `valid: true`, while the array-inside-an-array one emits `<name/>`, which re-reads
`issues: []` and `valid: false` because an empty repeating element is invalid on its own terms. The
finding is gone in all four. Measured
one shape per marker, each read, written to XML and re-read. `{"value":null,"unit":"mg"}` came back as
a `Quantity` carrying a unit and **no magnitude** under an empty issue list, which is the harm the
value-channel rule exists for arriving through the other door. `{"status":"final","_status":null}`
came back with the member gone. `{"name":[[{"family":"Roe"}]]}` came back with the name gone and
**`safeToSummarize` flipped from `false` to `true`**, turning a refusal to summarize into an
affirmation.

The writer now raises a new `SERIALIZE_ERROR_CODES.UNSERIALIZABLE_JSON_ONLY_SHAPE`, value-free and
carrying bounded locations, never the content. Refusing rather than repairing, because there is
nothing to hand back into: emitting the empty element is what laundered, and inventing an XML
spelling for a JSON-only shape would author markup the sender never wrote, the fabrication class the
two refusals beside it already exist for.

Nothing that works is withdrawn, and that is mechanical rather than argued. The markers are set by the
JSON reader alone, asserted by a census over `src/` that names the file each marking helper and each
`nonObjectSource` assignment appears in, so a new one anywhere else reds a test (a helper renamed, or
a field set by shorthand, would evade the patterns, which is why the sweep is over `src/` and not a
claim about every possible spelling). So no document read from XML can reach the refusal; the XML
fixture corpus still round-trips
byte-for-byte, and the read differential moves 0 of 1,195 readings, by construction rather than as a
surprise. `serializeResource` writes all four shapes back and the re-read reproduces the finding.
**Value-exact, not byte-exact**, which is the limit the preserved text already carried and is stated
here rather than left to the reader: `{"performer":[{"reference":"Practitioner/1"},"Practitioner\/2"]}`
comes back spelling the second member `"Practitioner/2"`, the same string in different bytes, and only
the value-channel `null` family is byte-identical. **That the route stays open is a statement about
these shapes, not about the whole model**: a model refused here can carry one of that writer's own
declared exceptions and have it emitted, and a marker inside a member a repeated property name
shadowed is dropped by that writer as well, which is why the runtime message names only what the
refusal does not reach instead of promising a route.

Raised **last**, after the name and `div` refusals, so a model that trips two keeps the code it
already reported and no case moved onto the new one. Pinned by tests on all three orderings, the
dropped-character-data refusal included.

Deliberately not closed, pinned rather than implied so none of it reads as covered. An array-wrapped
`0..1` element still launders across this boundary: no node is marked, XML spells a repeating element
by repeating it, and one occurrence is exactly what comes back. A repeated property name is still
dropped by **both** writers, so there is no hand-back for XML to be missing. And a JSON decimal comes
back from XML as a string, because XML carries no JSON type; the lexical value survives byte-exact.

Every count is bounded by the caveat this area carries throughout: the corpus is 7 hand-authored XML
fixtures plus mutations, plus this repo's hand-authored JSON fixtures and probes. Neither is the FHIR
R4 published-examples corpus, and nothing here is corpus-wide.
