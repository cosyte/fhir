---
"@cosyte/fhir": patch
---

`serializeResourceXml` no longer splices a `div` string into the document unexamined
(`FHIR-DIV-FORGES-A-NEGATION`).

`Narrative.div` is carried as an opaque XHTML string and written back verbatim, so whatever the
string spells became markup in the output. It is the one branch of the writer that puts a **value**
into markup position rather than a name, and the name refusal shipped beside it did not cover it.

A `div` on an `AllergyIntolerance` spelled
`<div xmlns="…xhtml">ok</div></text><code><coding>…716186003…</coding></code><text>` emitted
spec-clean FHIR XML that re-read with `noKnownAllergy: true` and a `no-known-allergy` negation over a
record that had asserted nothing, with `readSafety` affirming it and no diagnostic at either end.
SNOMED CT `716186003` is a **positive** clinical assertion, so this manufactured a record of a fact
nobody stated.

The string is now checked at that branch, before it is spliced in: it is written only when it parses
as exactly one element whose **local name is `div`**, using the same reader the document is re-read
with, over the same bytes. Anything else raises a new
`SERIALIZE_ERROR_CODES.UNSERIALIZABLE_DIV_MARKUP`, value-free and carrying bounded locations, never
the markup. Well-formedness alone does not settle it, and assuming it did was one of two wrong
guesses recorded against this defect: `<status value="final"/>` is one perfectly well-formed element,
and writing it for a property named `div` authors a status the sender never wrote. The branch keys on
the name `div` at any depth in any resource, so the check is on the branch and not on a resource
type.

Refusing rather than repairing, for the same reason as a name: escaping would author a text node
where the sender wrote markup, and splicing authors elements. The capability is routed rather than
lost, since `serializeResource` carries the string as a string and this refusal never reaches it.
That is a statement about the `div` string and not about the whole model, which can still carry one
of that writer's own declared exceptions.

Nothing that worked was withdrawn, measured rather than asserted: every `div` string the XML reader
itself produces passes, over the fixture corpus and over seven spellings pinned by tests, and across
360,020 generated and mutated `div` strings the refusal has 0 false positives against the 65,464
whose base round trip returned them unchanged. The read differential over 1,195 documents moves 0
readings, expected by construction rather than a surprise: no XML document this library can read
produces a `div` string the check refuses. Every count here is bounded by the same caveat this
lineage carries: the corpus is 7 hand-authored XML fixtures plus mutations, and the 360,020 sweep is
over generated `div` strings. Neither is the FHIR R4 published-examples corpus.

Passing the check is not a claim that the round trip is lossless, or that the output is well-formed,
from there, and the counterexamples are pinned by tests rather than described: a root whose prefix
nothing binds re-reads as a different property; a comment beside the root does not survive the
re-read; a `div` holding 254 nested elements is accepted and the emitted document raises
`MAX_DEPTH_EXCEEDED` on re-read, because the check spends the depth budget from a different starting
depth; `<div>x</div>` comes back carrying a namespace the sender never wrote; and an XML declaration
is accepted and makes the output one a conformant third-party parser rejects. All are pre-existing.

Two shapes base handled worse than recorded are closed by this too: `{"div":""}` emitted a `<text>`
with the property simply gone, with an empty issue list and `valid: true` at both ends, and
`{"div":"v"}` lost the property loudly. Both are refusals now.
