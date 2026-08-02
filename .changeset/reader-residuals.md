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
original on the whole read, 0 of 7 matched before and 7 of 7 match now. A prefix is dropped only for
an element in its parent's namespace: an expanded name is a namespace and a local name, so content
from another vocabulary keeps its tag exactly as written and can never join a FHIR element's
occurrences, be promoted into a primitive's extensions, be unwrapped as a contained resource, or be
stored as the narrative. The defect silently dropped
primitive extensions, re-emitted XML that was not well-formed, and let a document validate `valid:
true` on a reading in which no element had been recognized; a prefixed `Observation` carrying
`status="entered-in-error"` read `retracted: false`, and now reads the retraction. An unresolvable
prefix is flagged and its tag kept exactly as written rather than guessed at, and a namespace
declaration is no longer reported as an unknown attribute.

R4 defines `OperationOutcome.issue.expression` as a FHIRPath subset that resolves to a node, and the
JSON reader built two of them as sentences: `Patient.name (unexpected _-sibling on an object)`. The
reason a finding was raised belongs in its code, so it moved there: new
`ISSUE_CODES.MISPLACED_PRIMITIVE_EXTENSION` (warning) with a `misplacedPrimitiveExtension` factory,
raised at the bare location of the element. It is a new code rather than the `UNKNOWN_PROPERTY` those
positions used to raise, because `UNKNOWN_PROPERTY` promises nothing was lost and these two positions
discard the `_`-sibling whole; a consumer matching on `UNKNOWN_PROPERTY` there must match the new code
instead.
