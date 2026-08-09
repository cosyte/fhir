---
"@cosyte/fhir": patch
---

Report a `doNotPerform` value this library cannot read, instead of returning the same answer as its
opposite (`FHIR-XML-UNREADABLE-BOOLEAN-IS-SILENT`, a STOP-THE-LINE filed under meta-repo ADR 0016).

R4 spells a `boolean` as `true` or `false` and nothing else, so `<doNotPerform value="1"/>` and
`value="Y"`, ordinary v2 and C-CDA converter output, which is how a great deal of data reaches a
FHIR surface, carry no boolean this library may read. Measured at the base commit `05ecc5a`, all
five of `value="true"`, `"1"`, `"Y"`, `"0"` and `"N"` returned `issues: []` and
`safeToSummarize: true` with `assertSafeToSummarize` clean, and the last four returned
`negations: []`. An author who wrote _"yes, do not administer"_ got the same answer as one who wrote
_"no"_, and nothing on any channel recorded that a value had been written and dropped.

**The remedy is a report, not a wider read.** Accepting `"1"` / `"Y"` would invent a reading the spec
does not license, and it would turn `value="0"` and `value="N"` into a JS `false` that
`serializeResource` then emits, authoring a value and laundering it across a format change. So the
read is untouched: `doNotPerform` still comes back `undefined`, and the new
`SafetyReadout.unreadableBooleans` carries the element's FHIRPath location, `safeToSummarize` is
`false`, and `assertSafeToSummarize` throws. `unreadableBooleans(resource, path)` is exported beside
`nestedArrays` and `droppedText`, the readout's two existing channels for content the codec could not
read. The report is value-free: the text that failed to read reaches neither the locations nor the
error message.

Additivity is established from the consumers and measured, not argued. This slice widens no read, so
no value that was `undefined` becomes defined and a newly-read value cannot retire a finding. Across
a 33-document corpus in a real base worktree, 13 documents move and the only field that moves in any
of them is `safeToSummarize`, `true → false`; no parse issue, no `ValidationIssue`, no `valid`, no
`negations`, and neither writer's output moves anywhere. One public surface moves outside that
measurement: `FhirSafetyError` names this sixth shape in its message, so the message string changes
for every refusal it raises, including the five that already refused. Its `locations` are unchanged.

`doNotPerform` is the only `boolean` the safety spine reads out of a document, so
the channel is complete for that layer and for nothing beyond it. `ElementDefinition.mustSupport`,
`slicing.ordered`, a `Quantity` magnitude's `+5` / `05` / `.5` / `5.` and
FHIRPath `numberOf` are the same class elsewhere, still silent, each pinned and each its own item.

This raises no `ValidationIssue` of its own, for a narrow measured reason rather than a general one:
the request resources that define it have no built-in schema, so the validator is silent about this element's DATATYPE
unless a caller supplies one, and the readout has to hold either way. The safety layer knows the datatype
unconditionally, which is why the report lives there.
