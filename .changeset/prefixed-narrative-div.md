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
taken from a namespace other than the parent's, and it is safe only because both halves hold: the
namespace is compared against a single fixed URI, and the result is carried as an **opaque string**
rather than modeled as FHIR structure. No field is added to the model and no walker gains an edge.

**Scope, at the width of the code.** Like every other name rule in this reader it separates only a
spelling that carries a **prefix**: `<v:div xmlns:v="urn:vendor">` keeps its tag and cannot reach
`Narrative.div`. An **unprefixed** `<div xmlns="urn:vendor">` is spelled exactly like the FHIR one,
so it is stored in `Narrative.div` and reported `UNEXPECTED_XML_CONTENT` rather than separated,
exactly as before namespaces were resolved at all. Unchanged here, and no claim says otherwise.

The opaque string now carries the namespace declarations the element inherited (only those the
fragment uses and does not itself declare, only with the URI in scope where the document wrote it),
so `Narrative.div` is the self-contained XHTML fragment it is supposed to be. The document's own
spelling is preserved rather than rewritten, so a prefixed narrative is namespace-equivalent to the
default spelling, not byte-identical to it. The same fix repairs a broken fragment for an
_unprefixed_ narrative using a prefix declared on an ancestor. One escaper serves both the element's
own attributes and the added declarations, because a namespace URI can carry a `<` (the raw reader
refuses a literal one but decodes `&lt;`) and the writer emits this string verbatim.

Differential vs `3747f62` over 765 documents, both trees in one process, every walker at every node:
358 readings moved; **0** `valid: false` to `true`, **0** `safeToSummarize: false` to `true`, **0**
retractions or negations lost, **0** newly throwing. Of the 4,559 leaf values base read, **0** are
missing at head (2 are no longer separate leaves because they sit inside the opaque narrative string
that carries the subtree they came from, verified by containment). 80 outputs are shorter, 78
byte-verified as nothing but a prefixed property name resolving to its local name, the other 2 that
plus two spellings of one element grouping into one property with both values kept. 496 read
diagnostics disappear and **all 496 are at a `<withheld>` location**; **0** at a location that
resolves. 4 validation findings disappear, all the two-spellings shape, compensated by
`MIXED_XML_SPELLING`. 588 read and 60 validation locations improve from `<withheld>` to resolvable;
none worsens. Of 346 documents carrying a narrative, base preserved it in 134 and head preserves it
in 294. The 27 JSON fixtures read identically.

Deliberately not recovered, both `PRE-EXISTING` and both pinned by a test: a `<div>` holding exactly
one capitalized child is still read as a contained resource and loses its prose, identically for
every spelling (taking the narrative first would also retire an `UNHANDLED_MODIFIER_EXTENSION`
**error** raised from inside it and flip a document to `valid: true` with nothing in its place, which
the fail-safe contract does not allow, so it is a separate decision); and a foreign child of a valued
primitive is still discarded whole under `UNKNOWN_PROPERTY`.
