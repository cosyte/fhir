---
"@cosyte/fhir": patch
---

Profile validation now reports a slice whose sliced element declares no `slicing`, or is missing from the snapshot, as `PROFILE_SLICE_NO_SLICING` at information severity, at the slice's location (such as `Observation.component:coded`), once per present parent. Nothing in such a profile says which occurrences belong to the slice, so none is assigned to it and its own constraints are not checked. Before this, the slice and everything under it were skipped with no finding at all, so a required element under the slice could be missing and `collectProfileIssues` returned nothing. `PROFILE_SLICE_NO_SLICING` is a new member of `VALIDATION_CODES`.
