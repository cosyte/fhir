---
"@cosyte/fhir": patch
---

Profile validation now applies a slice's own constraints only to the occurrences the slicing assigned to that slice. Before this, an element under a slice, such as `Observation.component:SystolicBP.code`, was checked against every `component`, so each slice's fixed and pattern values, cardinalities and invariants landed on the other slices' members: a conformant blood-pressure Observation drew six errors. The sliced element's own constraints, such as `Observation.component.code`, still apply to every occurrence. A re-slice nests the same way: it is checked within its parent slice's members, and its fixed and pattern values still decide the parent slice's membership. A slicing reported `PROFILE_SLICE_UNCHECKED` assigns no occurrence, so its slices' own constraints are not checked either.

Profile and profile-invariant findings on an element nested more than one level deep now carry the index at the level that repeats, such as `Observation.component[1].code.coding`, where they used to read `Observation.component.code[1].coding`.
