---
"@cosyte/fhir": patch
---

Profile validation now decides the `type` slicing discriminator where the document states the type, so its slices' own constraints are checked. Before, every such slicing was reported `PROFILE_SLICE_UNCHECKED` and nothing under its slices was checked.

This is a behaviour change: a document validated against a profile that slices by `type` can now draw findings it did not draw before, such as `PROFILE_SLICE_UNMATCHED` under a closed slicing, a slice's `CARDINALITY_MIN`, or a fixed, pattern or cardinality finding on a slice's member. US Core's smoking-status profile is one: it slices `Observation.effective[x]` (6.1.0) and `Observation.value[x]` (9.0.0) by type.

- A `type` discriminator is decided from the occurrence's concrete type: a choice element's suffix (`valueQuantity` is a `Quantity`) or a resource's `resourceType`, at the discriminator path or through a trailing `resolve()` over the resource's `contained` set or, when the resource is a Bundle, its entries. After `resolve()`, a slice's `targetProfile` names a type through the base R4 definitions or the `profiles` you pass.
- A discriminator path that selects more than one node in an occurrence decides nothing (`path-unsupported`), rather than matching when any one of them does.
- A `profile` discriminator is not decided yet: a slicing with one among its discriminators stays `PROFILE_SLICE_UNCHECKED`, with the reason `profile-discriminator`.
- A slicing that cannot be decided stays `PROFILE_SLICE_UNCHECKED`, and the finding now says why in `sliceReason`, one of the new `SLICE_UNCHECKED_REASONS`: a reference that leaves the closure (`target-unresolved`; no server is ever fetched), a target profile you did not supply (`profile-unavailable`), the R5 `position` discriminator (`discriminator-unsupported`), a `profile` discriminator (`profile-discriminator`), and the rest.

`matchSlices` takes an optional fourth argument, a `SliceContext` (each occurrence's choice type, reference resolution, and the type a target profile constrains), and its result carries `reason` when it is unchecked. `collectProfileIssues` and `collectInvariantIssues` take `profiles` in their options, and `validateResource` passes its own. `SliceDefinition` has an optional `types`, and `validationIssue` an optional sixth parameter, `sliceReason`.

What a caller must change: nothing to keep compiling. A pipeline that treats a profile-validated document as valid should expect new findings on profiles that slice by `type`.
