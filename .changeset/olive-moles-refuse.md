---
"@cosyte/fhir": patch
---

Report content written where a `code` belongs, instead of reading the element as absent
(`FHIR-NEGATION-READ-SCOPE-RESIDUALS`).

Measured at the base commit: `{"resourceType":"Procedure","status":{"value":"not-done"}}` returned
`negations: []` under `safeToSummarize: true`, with `assertSafeToSummarize` clean and nothing on any
channel to say the element had been looked at. The same held for an object at `Observation.status`
carrying `entered-in-error`, for the same object inside an array wrapper, and for a `status` written
as a number or a boolean, at every resource root each is read at.

This is a **shape**, and that is why no existing channel caught it. Every other question this layer
asks is about a *written value*: `unreadableBooleans` reports a value outside the boolean lexical
space, and `nearMissNegationCodes` reports a value that spells a code bar its case or its whitespace.
An object holds no value at all, so both answer "no" about it, truthfully, and the element ends up
reading exactly like one the sender left out. A procedure recorded as not done was indistinguishable
from one that was carried out.

Nothing is read through. `{"value":"not-done"}` is FHIR XML's spelling of a primitive (xml.html
§2.6.1); FHIR JSON spells a `code` as a JSON string (json.html §2.6.0). Descending into the object to
recover the code would resolve a negation out of an encoding no version of FHIR defines for JSON,
which is the laundering this library refuses everywhere else. So the position is disclosed rather
than resolved: its element's FHIRPath location appears in the new
`SafetyReadout.unreadableNegationCodes`, `safeToSummarize` is `false`, and `assertSafeToSummarize`
throws. `unreadableNegationCodes(resource, path)` is exported beside the other collectors.

The element is `status`, at every resource root, which is the negation read's own window, so a
`Bundle.entry` or `contained` resource is covered. The complement is carried in the same table the
matches themselves are made from and is applied in the same loop, so the report cannot cover an
element the read does not, nor miss one it does.

Two datatypes reach a root `status`, and the question asked is about the shape rather than about
which read succeeded, so that both are cleared. R4 spells `status` a `code` on the overwhelming
majority of types and a `CodeableConcept` on `MedicinalProductAuthorization` and
`SubstanceSpecification`; R5 adds several more, including a mandatory `DeviceAssociation.status`;
DSTU2 spells every one a `code`. A complex all of whose members FHIR spells at this position
(`coding`, `text`, `id`, `extension`) is left alone, whether or not a code came out of it, while any
member outside that set is reported, as is an object with no member at all (`ele-1` requires an
element present in a resource to carry a value, children defined for its type, or an extension). The polarity is load-bearing: exempting a shape for carrying one
legal member would read `{"status":{"id":"s1","value":"not-done"}}` as clean, and that is the same
converter output this channel exists to report. Keyed
instead on "the string read took nothing", this would refuse the published R4
`MedicinalProductAuthorization` example, which was measured rather than feared. The converse is a
declared limit: a shape all of whose members are ones FHIR spells here is never reported, so a code
buried under `{"status":{"coding":{...}}}` at a type whose `status` is a `code` stays silent.

`verificationStatus` is deliberately outside it, and that is a declared limit rather than an
oversight. Its shape complement is a *primitive* at the element, and `Condition.verificationStatus`
is a `code` in DSTU2, a version this reader ingests tolerantly, so the same predicate would report a
conformant DSTU2 document. `AllergyIntolerance.code` is outside it for the reason that keeps "no
known allergy" root- and type-scoped, its absence being the cautious reading rather than the
incomplete one.

Value-free: only the FHIRPath of the element is carried, never the content at the position nor
anything read out of it. The channel raises no `ValidationIssue`, so `valid` does not move in either
direction on any document.

Empty on every conformant document this library has been measured against, in either wire format,
with the limit declared rather than claimed away: a version spelling a root `status` as a datatype
whose members are none of the above would be reported, and the census found none in R4, R5 or DSTU2.
The XML reader models a `value` attribute beside `id` and `extension` children as a primitive, so a
conformant `<status value="not-done"><extension …/></status>` is read rather than reported. A
primitive whose value is *absent* is not reported either: that is the conformant
`data-absent-reason` shape (json.html §2.6.2.3), and it is content the read never stepped over.
