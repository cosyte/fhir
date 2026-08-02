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
so it reaches the narrative slot rather than being separated, exactly as before namespaces were
resolved at all: carried there and reported `UNEXPECTED_XML_CONTENT`. Unchanged here, and no claim
says otherwise.

The opaque string now carries the namespace declarations the element inherited (only those the
fragment uses and does not itself declare, only with the URI in scope where the document wrote it),
so `Narrative.div` is the self-contained XHTML fragment it is supposed to be. The document's own
spelling is preserved rather than rewritten, so a prefixed narrative is namespace-equivalent to the
default spelling, not byte-identical to it. The same fix repairs a broken fragment for an
_unprefixed_ narrative using a prefix declared on an ancestor. One escaper serves both the element's
own attributes and the added declarations, because a namespace URI can carry a `<` (the raw reader
refuses a literal one but decodes `&lt;`) and the writer emits this string verbatim.

**The yardstick is the same document spelled with a default `xmlns`, not the previous release.**
Carrying the element as a string necessarily stops modelling anything inside it as FHIR, so a
`<modifierExtension>` written inside a prefixed narrative no longer draws
`UNHANDLED_MODIFIER_EXTENSION` and such a document reads `valid: true` where it read `valid: false`.
That finding existed only because a prefixed narrative was not recognised as one; the unprefixed twin
has read `valid: true` all along, and nothing inside `Narrative.div` is a FHIR modifier extension.
Measured: over 176 documents carrying a prefixed narrative, head's reading of the prefixed spelling
equals base's reading of the default-`xmlns` twin in 172, and in the other 4 head raises one
_additional_ warning (`MIXED_XML_SPELLING`, that fixture already carrying a narrative, so the
document then holds the narrative under both spellings). In none of the 176 is head's reading weaker:
the only way it reads differently at all is louder.

Differential vs `3747f62` over 941 documents, both trees in one process, every walker at every node:
446 readings moved; **0** retractions or negations lost, **0** newly throwing. Of the 5,699 leaf
values base read, **0** are missing at head (2 are no longer separate leaves because they sit inside
the opaque narrative string that carries the subtree they came from, verified by containment). 32
documents go `valid: false` to `true` and 36 go `safeToSummarize: false` to `true`, all the shape
above, and in all 32 base already read the default-`xmlns` twin as `valid: true`. 160 outputs are
shorter, 156 byte-verified as nothing but a prefixed property name resolving to its local name, the
other 4 that plus two spellings of one element grouping into one property with both values kept. 656
read diagnostics disappear and **all 656 are at a `<withheld>` location**, **0** at a location that
resolves; 480 of those are on documents where the narrative is now kept and 176 on documents where it
is not, those being the capitalized-child shape the companion changeset recovers. 40 validation
findings disappear: 36 the
modifier-extension shape above, 4 the two-spellings shape compensated by `MIXED_XML_SPELLING`. 752
read and 104 validation locations improve from `<withheld>` to resolvable; none worsens. Of 836
documents carrying a narrative, base preserved it in 278 and head preserves it in 478. The 27 JSON
fixtures read identically.

Not recovered here, and what happened to it: a `<div>` holding exactly one capitalized child was
still read as a contained resource and lost its prose, and prose written _beside_ such a child
(`<div xmlns="…xhtml">Take 5 mg<BR/></div>`) was destroyed with zero diagnostics under `valid: true`.
Reordering the two branches is a separate decision with its own blast radius, so it was made and
measured on its own terms in the companion changeset rather than folded in here. A foreign child of a
valued primitive is still discarded whole under `UNKNOWN_PROPERTY` (`PRE-EXISTING`, pinned by a test).
