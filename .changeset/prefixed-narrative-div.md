---
"@cosyte/fhir": patch
---

Carry a narrative `<div>` written with a namespace prefix, instead of destroying it under a
`valid: true` verdict (`FHIR-UNPLACEABLE-SHAPES`, the first of the six `PRE-EXISTING` reader
residuals filed by `#44`, queued ahead of the item's own headline because silent data destruction
under a passing verdict outranks an unplaceable shape).

`Narrative.div` is the human-readable prose of a resource, and XML lets the XHTML namespace be bound
to a prefix as legitimately as it lets it be the default. The reader recognized the narrative by the
literal spelling `div`, which a prefixed tag can never satisfy, so
`<h:div xmlns:h="http://www.w3.org/1999/xhtml">` was read as foreign content: an empty element, or,
when it held only text, dropped from the model entirely. The reading said nothing useful about it:
both warnings landed at a `<withheld>` location, and `validateResource` returned `valid: true` with
zero findings. The re-emitted XML left `h:` bound to nothing, so it was not well-formed.

The narrative is now recognised by its **expanded name**, `{http://www.w3.org/1999/xhtml}div`
(Namespaces in XML 1.0 §6.1), under every spelling. This is the only place a resolved local name is
taken from a namespace other than the parent's, and it is safe for two reasons that must both hold:
the namespace is compared against a single fixed URI, and the result is carried as an **opaque
string** rather than modeled as FHIR structure. A `div` in any other namespace is still not the
narrative, so a vendor cannot supply a patient's prose. No field is added to the model and no walker
gains an edge.

The opaque string now carries the namespace declarations the element inherited (only those the
fragment uses and does not itself declare, only with the URI in scope where the document wrote it),
so `Narrative.div` is the self-contained XHTML fragment it is supposed to be. The document's own
spelling is preserved rather than rewritten, so a prefixed narrative is namespace-equivalent to the
default spelling, not byte-identical to it. The same fix repairs a broken fragment for an
_unprefixed_ narrative using a prefix declared on an ancestor.

A second route to the same loss goes with it: a narrative holding one capitalized child
(`<div xmlns="…xhtml"><Table>5 mg</Table></div>`) was read as a contained `Table` **resource**,
destroying the prose and re-emitting it stripped of the XHTML namespace so the re-read came back
clean. The narrative is taken before the resource-valued branch now, which shadows nothing: `div`
names exactly one element in R4 (`Narrative.div`, the only one of the 7,696 element paths in
`profiles-types.json` + `profiles-resources.json` whose name is `div`).

Differential vs `3747f62` over 545 documents, both trees in one process, every walker at every node:
268 readings moved, **0** `valid: false → true`, **0** `safeToSummarize: false → true`, **0**
retractions or negations lost, **0** newly throwing, **0** outputs shorter. 376 read diagnostics
disappear: 336 at a `<withheld>` location and 40 `UNEXPECTED_XML_CONTENT` on a narrative whose prose
base dropped and head keeps; **0** at a resolvable location for any other reason. 4 validation
findings disappear, all the two-spellings shape, compensated by `MIXED_XML_SPELLING`. 344 read and 16
validation locations improve from `<withheld>` to resolvable; none worsens. Of 256 documents carrying
a narrative, base preserved it in 88 and head preserves it in 248. The 27 JSON fixtures read
identically.

Not fixed, unchanged and still `PRE-EXISTING`: a foreign child of a **valued primitive** is discarded
whole under `UNKNOWN_PROPERTY` (the 8 narratives above that are still lost); a `div` in a genuinely
foreign namespace has its text dropped like any other foreign element; and a `<contained>` holding a
second child re-reads with a `_`-prefixed resource name, which reproduces with a mutation containing
no `div` at all.
