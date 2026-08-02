---
"@cosyte/fhir": patch
---

Read a narrative `<div>` as XHTML rather than as a wrapper around a resource, so prose written beside
a capitalized child is no longer destroyed under a `valid: true` verdict (`FHIR-UNPLACEABLE-SHAPES`,
the residual `#46` filed and pinned, queued ahead of the item's own headline because silent data
destruction under a passing verdict outranks an unplaceable shape).

`<div xmlns="http://www.w3.org/1999/xhtml">Take 5 mg<BR/></div>` read as a contained `BR` **resource**.
The div's own text nodes are never inspected once the child is taken, so "Take 5 mg" was gone, the
reading raised **no issue at all**, `validateResource` returned `valid: true` with zero findings, and
`serializeResourceXml` re-emitted the `<div>` stripped of the XHTML namespace, so the re-read came
back clean and the loss laundered. Identical for every spelling of the XHTML namespace and for a
document that declares none. HTML-4-era generators emit `<BR>`, `<TABLE>`, `<P>`, and a medication
narrative is exactly where a dose is written.

**The cause was a FHIR-vocabulary heuristic applied to XHTML.** The reader unwraps a resource-valued
element (`<contained><Patient>…</Patient></contained>`) by testing whether its one child's name is
UpperCamelCase, which is how a FHIR resource type is spelled. Inside `Narrative.div` the vocabulary
is XHTML, where that test means nothing: `<BR/>` and `<br/>` are the same element and neither is a
resource. The narrative is now recognised **before** the resource-valued unwrap. Nothing is shadowed
by the order: `div` names exactly one element in R4, the only one of the 7,696 element paths in
`profiles-types.json` + `profiles-resources.json` whose name is `div`. **No field is added to the
model** (the narrative was already an opaque string, so `test/model-edges.test.ts` is untouched and
unaffected) and no walker gains an edge.

The resource-valued unwrap is otherwise untouched: `contained` and `entry.resource` still unwrap, so
a retraction inside a contained resource is still read. What changed there is that character data
written beside the child (discarded by the unwrap with no diagnostic) now draws
`UNEXPECTED_XML_CONTENT`, and only where that position was otherwise silent, so it never doubles a
report the previous release already made there. That is a property of this one site and not of the
code: an element that is both in another vocabulary and carrying character data still draws the code
twice at one expression elsewhere, exactly as it did before. The text is still **not** preserved at
that position: there is no slot on the model for it, and minting one is a separate decision.

**`UNEXPECTED_XML_CONTENT`'s own documentation is corrected to the width of the code.** It reports
two different observations, and only one of them preserves anything: an element from another
vocabulary **is** modeled, but non-whitespace character data written directly on a FHIR element is
**dropped at every position it can appear** (on a complex element, on a primitive, and beside the one
resource child of a resource-valued element), because a FHIR element carries its value in the `value`
attribute. The guarantee on offer is that the drop is not silent, and nothing more. The previous text
said the content survived, which was never true of that half.

**The yardstick is the same document spelled the other way, not the previous release.** Reading a
narrative as a narrative necessarily stops modelling its insides as FHIR, so a `<modifierExtension>`
written inside one the reader used to model as FHIR no longer draws `UNHANDLED_MODIFIER_EXTENSION`,
and such a document reads `valid: true` where it read `valid: false`. That finding existed only
because `<Table>` was read as a FHIR resource type; the lowercase twin has read `valid: true` all
along, and nothing inside `Narrative.div` is a FHIR modifier extension. Measured over **396 twin
pairs** (every shape with a spelling the reader already recognised, at every element position of
every XML fixture): head's reading of the newly-recognised spelling equals base's reading of the twin
in **394**, in **2** it raises one _additional_ warning (`MIXED_XML_SPELLING`, that fixture already
carrying a narrative, so the document then holds two spellings of one element), and in **0** is it
weaker.

Differential vs `09b2805` over **1,195 documents**, both trees in one process (every XML fixture ×
27 narrative and resource-wrapper shapes at every element position): 560 readings moved; **0**
`valid: true -> false`, **0** retractions lost, **0** negations lost, **0** newly throwing, **0**
emitting XML that no longer re-reads, **0**
outputs shorter in either format. Of the 16,036 leaf values base read, **0** are missing at head; 520
are no longer separate leaves because they sit inside the opaque narrative string that carries the
subtree they came from, verified by containment. 32 documents go `valid: false` to `true` and 36 go
`safeToSummarize: false` to `true`, **all** the modifier-extension shape above. 280 read diagnostics
disappear (240 `UNEXPECTED_XML_CONTENT`, 40 `UNKNOWN_PROPERTY`), every one base complaining about
content it was mis-modelling inside a narrative it then destroyed; 120 are gained. 36 validation
findings disappear, all the same shape. Of 836 documents carrying a narrative, base preserved it in
**318** and head preserves it in **758**; the remaining 78 are two shapes neither release recovers,
both unchanged here (see the residuals below). The 27 JSON fixtures read identically.

**The differential harness is committed** (`scripts/read-differential.ts`, `pnpm differential:read`).
The three reader slices before this one measured themselves with an uncommitted harness, so their
headline numbers were not reviewer-reproducible; this one is. It materializes `src/` at any ref into
a temp directory via `git archive`, imports it alongside the working tree in one process, **re-reads
what each tree emits rather than only what it was given** (the last real defect a gate found in this
reader was output that was not well-formed and threw on re-read, which a differential that only
parses its input cannot see), and refuses to report if its own tallies do not reconcile against
independently derived totals, if the corpus was not built from this package's fixtures, or if the
base tree it loaded does not behave like base.

`PRE-EXISTING` and unchanged, each pinned by a test or by the harness rather than by this sentence:
a foreign child of a valued primitive (including a `<div>`) is discarded whole under
`UNKNOWN_PROPERTY`; an uppercase `<DIV>` wrapper is a different expanded name from `{xhtml}div`, so
it is not the narrative and still loses its prose (reported, not silent). The realism argument for
`<BR>` is the same argument for `<DIV>`, and recovering it means matching an element name
case-insensitively, which is a decision about the whole reader; an **unprefixed** `<div>` in a vendor
namespace is spelled exactly like the FHIR one, so it reaches `Narrative.div` and is reported
`UNEXPECTED_XML_CONTENT` rather than separated (it now carries its prose there instead of losing it,
but it is still not separated); the narrative is carried with whatever namespace was in scope, so a
document that wrote `<div>` under a FHIR or absent default declaration gets a `Narrative.div` that is
not in the XHTML namespace the datatype names; and 27 of the 1,195 corpus documents emit XML whose
re-read moves, all of them a `<contained>` holding two element children, where `Resource.id` written
as a child element re-reads as the `Element.id` attribute the writer emitted. Identical on the
previous release, and surfaced by the new harness check rather than by argument.

One more `PRE-EXISTING` finding, byte-identical on the previous release and left for its own change
because it is wider than this one: **a FHIR primitive whose value is written as element text rather
than in the `value` attribute is dropped, and the safety readout affirms over the loss.**
`<Observation …><status>entered-in-error</status></Observation>` reads `retracted: false`,
`safeToSummarize: true`, `negations: []` and `valid: true`; an `AllergyIntolerance` whose
`verificationStatus.coding.code` is written that way loses the `refuted`; and
`<doseQuantity><value>5</value><unit value="mg"/></doseQuantity>` loses the dose number while the
unit and the UCUM code survive. It is reported (`UNEXPECTED_XML_CONTENT`), so it is not silent, and
it is in this release's differential corpus so it stays measured.
