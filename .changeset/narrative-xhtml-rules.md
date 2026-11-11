---
"@cosyte/fhir": patch
---

`validateResource` now checks `Narrative.div` against the R4 narrative rules. Before, the narrative was carried as a string and never checked, so a `script` element, an `onclick` handler or a `<form>` in a narrative passed validation. The narrative of the resource is checked, and so is the narrative of every resource it carries in `contained`, a Bundle entry or a Parameters parameter. Seven new findings, each an `error` at the location of the `div` (`Patient.text.div`), each reported at most once per narrative, and none naming anything written inside it:

- `NARRATIVE_UNREADABLE`: the `div` is not a string, not well-formed XML, or uses a DTD, an entity other than the five XML predefines (`&nbsp;` included), a CDATA section, or nesting deeper than 256 elements.
- `NARRATIVE_ROOT_INVALID`: the root is not a `div` in the XHTML namespace.
- `NARRATIVE_ELEMENT_ILLEGAL`: an element outside the basic HTML formatting set R4 allows, or outside the XHTML namespace.
- `NARRATIVE_ATTRIBUTE_ILLEGAL`: an attribute R4 does not allow on that element.
- `NARRATIVE_ACTIVE_CONTENT`: a `script`, `iframe`, `frame`, `frameset`, `object`, `embed` or `applet` element, an `on...` event handler, or a `javascript:` or `vbscript:` URL. It carries the new R4 issue type `security` (`ISSUE_TYPES.SECURITY`).
- `NARRATIVE_BLOCK_IN_PARAGRAPH`: a `div`, `blockquote`, `table`, `ol`, `ul` or `p` inside a `p`.
- `NARRATIVE_EMPTY`: no content other than whitespace and no image.

The string is kept exactly as written and both writers emit it unchanged. A document whose narrative breaks one of these rules was `valid: true` and is now `valid: false`; the HL7 reference validator reports the same documents. A caller that switches over every `ValidationCode` or `IssueType` gains the new members. The R4 example `eventdefinition-example.json`, held out of the differential because the reference validator reported its empty narrative and this library did not, is compared again.
