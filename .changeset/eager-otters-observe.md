---
"@cosyte/fhir": patch
---

Model `Observation` (`MODEL-OBSERVATION-1`), so `validateResource` checks its own elements instead of reporting that it has none.

Until now the built-in schema set held exactly one resource type, `Patient`. Everything else,
`Observation` included, degraded to a single informational `RESOURCE_NOT_MODELED` at the resource
root and had its own elements left unchecked: the safe degrade, and the right default for a type
with no element table, because a partial table manufactures false unknown-element findings on a
conformant document. `Observation` is the type US Core's USCDI mapping ranks first by regulated data
element count, so a caller validating a lab result got nothing back about the document itself.

`Observation` now ships a full R4 4.0.1 DIRECT element table (twenty-four elements, verified row by
row against `observation.html`), which turns the existing generic checks on for it:

- `status` is `1..1` and carries the required-strength `ObservationStatus` binding over the eight
  codes the published value set expands to (`registered`, `preliminary`, `final`, `amended`,
  `corrected`, `cancelled`, `entered-in-error`, `unknown`). A code outside that set is a
  `CODE_INVALID` error **with no terminology service supplied**: the set is enumerated in the
  element table, not fetched.
- `code` is `1..1`. Those two are the only mandatory direct elements, and a document carrying
  neither draws exactly two `CARDINALITY_MIN` findings.
- `value[x]` is a choice over its eleven variants and `effective[x]` over its four, so a document
  writing more than one variant of either draws one `CHOICE_AMBIGUOUS` at the `[x]` path rather than
  a spurious cardinality error.
- An element name R4 does not define on `Observation` is now reported, as a warning when reading
  leniently and an error when reading strictly. An element it DOES define never is.

**Nothing is retired, re-severitied or relocated.** Every finding the safety, quantity, bundle and
terminology layers emitted for an `Observation` before, they emit now, at the same severity and the
same location: those layers key off the resource model directly and were never gated on the
structural schema. The one finding that disappears is the informational `RESOURCE_NOT_MODELED` note
at an `Observation` root, whose removal is the point. A document's verdict may move `valid: true` to
`false` where the new table catches something real; it never moves the other way. All of that is
pinned by the base-versus-head readout differential, whose declared allowance is now exactly those
two shapes and nothing else.

**Deliberately still unmodeled, and each for a reason.** `component` and `referenceRange` are
modeled as backbone elements and checked for cardinality and node shape only, exactly as
`Patient.contact` and `Patient.link` are; their children, `component.value[x]` included, are not
entered, so nothing inside one draws a finding. The weaker bindings on `category`, `code`,
`interpretation`, `dataAbsentReason`, `bodySite` and `method` are the terminology layer's and are
untouched, since this layer enforces `required` strength only. The two FHIRPath invariants on this
type stay with the layers that already own them. Every other resource type still degrades to
`RESOURCE_NOT_MODELED` with its own elements unchecked, which is unchanged and stays that way until
each gets a table verified the same way.

No public export, option or issue code changed: every finding described here is one an already
shipped code already names.
