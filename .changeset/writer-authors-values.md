---
"@cosyte/fhir": patch
---

The JSON writer no longer emits an object at a position where nothing was read, and the XML reader
no longer merges two different elements into one name in silence.

**A scalar written where FHIR JSON has an object was replaced with `{}` on the way out.** The reader
has no element to build from a string, number, boolean or `null` at a complex position, so it
reports `UNKNOWN_PROPERTY` and the model holds an empty element there. The writer then emitted that
element, and `{}` is a **conformant** empty element: the warning was gone the moment the output was
read back, and the document came back clean. `{"name":[{"family":"Roe"},"James"]}` went in and
`{"name":[{"family":"Roe"},{}]}` came out, with the finding at `name[1]` gone with it. That is a
value the writer authored and presented as read, at a position where it had read nothing at all,
which is the one thing the conservative half of Postel's Law may never do.

`serializeResource` now writes the value the sender wrote, so the finding survives the round trip
instead of laundering away. This is the treatment an array inside an array already had, one branch
over in the same function, and it is deliberately **not** a decision to model the scalar as a
primitive: putting it in the tree would make it visible to every walker at a position walkers read
as a complex element, which redefines the model rather than preserving the document. The text hangs
off the node (`FhirComplex.nonObjectSource`), where only the writer reads it, and the node stays the
empty element it has always been. Such output is deliberately not spec-clean, which is now the third
named exception on `serializeResource` alongside an array inside an array and a non-string
`resourceType`. `serializeResourceXml` does not carry the text and still emits the empty element,
the same as it does for an array inside an array.

**`MIXED_XML_SPELLING` now compares the expanded name, not the tag alone.** An element's occurrences
can share one tag and carry two different namespaces (Namespaces in XML 1.0 §6.1), and a tag-only
comparison had nothing to compare, so the merge was silent. The rule is the comparison rather than a
list of shapes; two routes are worth naming because a document can reach them while otherwise reading
as conformant, and neither needs a prefix spelled two ways: a prefix rebound between siblings
(`<p:x xmlns:p="urn:a"/>` beside `<p:x xmlns:p="urn:b"/>`), and a `<div/>` in the FHIR namespace
landing in `Narrative.div` beside the real XHTML narrative, because the narrative is modeled as `div`
under every spelling of the XHTML namespace. An element reached by a default `xmlns` re-declaration
groups with its FHIR namesake the same way, and there the group already carried
`UNEXPECTED_XML_CONTENT`. The narrative case is the costliest: `Narrative.div` is `0..1`, so an otherwise conformant
document read back with two occurrences, no diagnostics and `valid: true`, and a single-value read
of the narrative yields nothing. The merge itself is unchanged, because dropping the grouping would
be a silent first-wins loss (the XML reader has no `duplicates` mechanism); what changed is that it
is no longer invisible. A conformant document reaches the comparison only with occurrences that
share both halves, so it stays silent there.
