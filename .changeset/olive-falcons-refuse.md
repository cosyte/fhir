---
"@cosyte/fhir": patch
---

Surface the modifier ELEMENTS on the safety readout, so a caller who trusts `safeToSummarize` can no
longer be handed a bounded value as though it were a point value.

A modifier is not only a `modifierExtension`. R4 flags several ordinary base elements
`Is Modifier: true` because they change how the value beside them must be read, and
`Quantity.comparator` is the sharpest of them. At the previous release the safety spine failed closed
on modifier extensions and was blind to modifier elements, so
`{"resourceType":"Observation","valueQuantity":{"value":0.01,"comparator":"<","unit":"mg"}}` came back
`safeToSummarize: true`: a caller doing exactly what the readout tells it to do reported `0.01 mg` for
a result the sender wrote as `< 0.01 mg`.

`SafetyReadout.modifierElements` is the new channel, one `{ element, location }` entry per location,
with `modifierElements(resource)` as the standalone collector. Four elements reach it: `comparator`
and `implicitRules` wherever a node the safety walk reaches carries one, `active` on a `Patient` root,
and `use` on a `Practitioner`'s `identifier` entries. Each sets `safeToSummarize` to `false` and makes
`assertSafeToSummarize` throw.

Reporting only. Nothing is interpreted: no bound, no range, no inequality is read out of a
`comparator`, no unit is converted, no finding is retired, re-severitied or relocated, `valid` never
moves, and `unhandledModifierExtensions` is byte-identical to what it was. A modifier extension stays
on that channel and draws nothing here, so one of them is still one report.

Recognition is by key name, plus literal `resourceType` equality for the two path-gated elements. It
over-reports by construction, which is the trade taken rather than an oversight: a false positive
costs a caller a refusal, a false negative costs a patient a wrong clinical value. Presence of the key
is the trigger and readability of the value never is, so an out-of-set value, a wrong JSON type, a
`null` and the primitive-extension `_` form with no value sibling all report; a value and its `_`
sibling at one element are one report, not two.

A report carries the element and the location and nothing from the document. Every path segment goes
through the bound this package already ships, and a location roots at a resource type name only when
the name is one this library defines (`MODIFIER_ELEMENT_ROOT_TYPES`), so two unmodeled types emit
equal locations carrying neither type string.

What changes for a caller: an ordinary `Patient` carrying `active`, or a `Practitioner` carrying
`identifier.use`, is no longer `safeToSummarize`. Fail-closed on purpose, since deciding that
`active: true` is benign while `active: false` is not is a per-value judgement this package does not
yet have the model to make. Each report names its element and its location, so the reason is
actionable rather than only the flag.

Still open and stated rather than implied: three JSON-read-path shapes carry a modifier element the
safety walk does not reach (inside a primitive's `_`-sibling extension, inside an array-inside-an-array,
and inside a `_`-sibling misplaced on a complex element). Each is pinned by a characterization test and
recorded with this repo's declared read-path losses; none is closed here.
