---
"@cosyte/fhir": patch
---

Resolve XML namespace prefixes, and keep English prose out of a diagnostic's FHIRPath `expression`.

FHIR XML is defined in the `http://hl7.org/fhir` namespace, and XML lets a document bind that
namespace to a prefix instead of making it the default, so `<f:Patient xmlns:f="http://hl7.org/fhir">`
and `<Patient xmlns="http://hl7.org/fhir">` are the same resource. The XML reader modeled the raw tag
name, so the first read to properties literally named `f:active` under a `resourceType` of
`f:Patient`. It now tracks the in-scope declarations as it descends and models the local name. Over
the package's seven XML fixtures, each re-spelled with a prefix and compared to the default-namespace
original on the whole read, 0 of 7 matched before and 7 of 7 match now. The defect silently dropped
primitive extensions, re-emitted XML that was not well-formed, and let a document validate `valid:
true` on a reading in which no element had been recognized; a prefixed `Observation` carrying
`status="entered-in-error"` read `retracted: false`, and now reads the retraction. An unresolvable
prefix is flagged and its tag kept exactly as written rather than guessed at, and a namespace
declaration is no longer reported as an unknown attribute.

Every element the reader **models** is now tested once for being in a namespace other than its
parent's, and reported `UNEXPECTED_XML_CONTENT` when it is. A **prefixed** one additionally keeps its
tag exactly as written, and because no FHIR element can be spelled `v:code`, that is what stops it
from joining a FHIR element's occurrences, being promoted into a primitive's extensions, being
unwrapped as a contained resource, or being stored as the narrative. Foreign content reached by a
**default** declaration (`<extension xmlns="urn:vendor">`) has no prefix to keep, so it is spelled
exactly like the FHIR element and is modeled as one; it is reported rather than separated, and that
is unchanged from before prefixes were resolved at all.

Two limits of that sentence, both unchanged from the previous release and both worth knowing. A
child element written beside a `value` attribute is not modeled at all: it is discarded and reported
`UNKNOWN_PROPERTY`, so a foreign one there draws no namespace report. And a narrative `<div>` written
with a prefix (`<h:div xmlns:h="http://www.w3.org/1999/xhtml">`) is not read as `Narrative.div`, so
the narrative text is not carried; only the unprefixed spelling is expected in the XHTML namespace
and left unflagged for being there.

Two prefixes bound to the same namespace are two spellings of one name, so an element written twice
that way is read as the repeat it genuinely is, and the model and every verdict over it match the
same document spelled one way. What changes is the number of occurrences, and a check that reads a
`0..1` element as a single value gets nothing from a repeat, so that element now carries new
`ISSUE_CODES.MIXED_XML_SPELLING` (warning) with a `mixedXmlSpelling` factory, raised once per
element. Nothing is lost and the reading is the correct one; the code exists so a widened count is
never silent.

R4 defines `OperationOutcome.issue.expression` as a FHIRPath subset that resolves to a node, and the
JSON reader built two of them as sentences: `Patient.name (unexpected _-sibling on an object)`. The
reason a finding was raised belongs in its code, so it moved there: new
`ISSUE_CODES.MISPLACED_PRIMITIVE_EXTENSION` (warning) with a `misplacedPrimitiveExtension` factory,
raised at the bare location of the element. It is a new code rather than the `UNKNOWN_PROPERTY` those
positions used to raise, because `UNKNOWN_PROPERTY` promises nothing was lost and these two positions
discard the `_`-sibling whole; a consumer matching on `UNKNOWN_PROPERTY` there must match the new code
instead.
