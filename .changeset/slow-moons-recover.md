---
"@cosyte/fhir": patch
---

The XML reader now reads a primitive's value back when the document wrote it as the element's own
character data instead of in a `value` attribute, so a retraction, a negation or a dose spelled
`<status>entered-in-error</status>` reaches the safety readout with the same retraction, the same
negations and the same dose its conformant twin gets. Before this, such a document was reported and
refused but the value itself was unreadable: `readSafety` answered `retracted: false` with
`negations: []` over a retracted record, and a dose number was gone while its unit and UCUM code
survived, which made the resource look complete.

Nothing about the report moves. R4 is unambiguous that the encoding is wrong (xml.html: a primitive
type's value travels in a `value` attribute, and an element present in a resource SHALL have either
a value attribute, child elements defined for its type, or one or more extensions), so this is a
reader tolerance and not a conformance claim: `UNEXPECTED_XML_CONTENT` still fires at the position
the text occupied, the node is still marked, `DROPPED_ELEMENT_TEXT` is still an error,
`safeToSummarize` stays `false`, and both writers still refuse to emit the model. What changed is
that the refusal now arrives beside the retraction rather than instead of it.

The tolerance is bounded, and the bounds are the difference between recovering what a sender wrote
and authoring something they did not. A `value` attribute always wins, and text beside one is never
read, merged into it or compared against it. Only a primitive element reads its text: a complex
element and the resource-valued unwrap have no value slot, so text there is still dropped, still
reported and still refused. Two text runs separated by a child element read as no value at all
rather than as a joined token. The value is handed on exactly as written, so a spelling the negation
layer cannot classify is still disclosed on `nearMissNegationCodes` or `unreadableNegationCodes`
rather than folded into the code it nearly spells, and a decimal keeps the precision the document
gave it. Documents read from JSON are untouched, JSON having no character-data channel.

Measured against the base pin with `pnpm differential:read` over its 1195-document corpus: no
validation finding and no read diagnostic withdrawn, relocated or re-severitied, no `valid` or
`safeToSummarize` flip from false to true, no retraction or negation lost, no leaf value lost, and
no JSON fixture moved. The `primitive-text-not-value` shape now declares its `value=` twin so the
shape this change moves is measured on the twin arm rather than skipped by it, and the twin report
gained a derived line separating the pairs that read weaker only by refusing what the twin affirmed
from any that read weaker by carrying less.

Closes the element-text read-path residual (`fhir#XML-RESIDUAL-1`, one of the three that phase
covers); `test/dropped-element-text.test.ts` is updated in the same change. The singleton-wrapper
laundering and unbound-prefix round-trip residuals are untouched and stay pinned.
