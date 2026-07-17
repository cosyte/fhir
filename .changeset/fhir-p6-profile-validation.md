---
"@cosyte/fhir": patch
---

Phase 6 — StructureDefinition + US Core profile validation. A StructureDefinition-driven **profile
layer** (structure → cardinality → value-domain → terminology → **profile** → invariant). Ships the
**engine, not the content**: a caller supplies the US Core (or vendor) `StructureDefinition`s and
**nothing is bundled**. Every finding is **value-free** (a code + a FHIRPath location).

- **StructureDefinition model + loader** (`loadStructureDefinition`) — identity, `derivation`,
  `baseDefinition`, `differential` / `snapshot`, and per-element cardinality, `mustSupport`, `type`,
  `binding`, `slicing`, `fixed[x]` / `pattern[x]`. `DISCRIMINATOR_TYPES` is the R4 set
  `value|exists|pattern|type|profile` — **`position` is R5-only and excluded**.
- **Snapshot generation** (`generateSnapshot` / `snapshotElements`) — walk `baseDefinition`, merge the
  differential onto the base snapshot (tighten matched elements by id, insert slices, preserve base
  order). Fails closed (`FhirProfileError`) on an unresolvable base or a `baseDefinition` cycle.
- **Slicing** (`resolveSlices` / `matchSlices`) — match each occurrence of a sliced element to a slice
  by its discriminators (`value`/`pattern` against the slice's fixed/pattern, `exists` against slice
  cardinality). Anything needing a FHIRPath engine (`type` / `profile` / R5 `position` / insufficient
  discriminators) is `PROFILE_SLICE_UNCHECKED` — **never silently passed**. Closed-slicing miss →
  `PROFILE_SLICE_UNMATCHED`; missing required slice → `CARDINALITY_MIN`.
- **`fixed[x]` vs `pattern[x]`** (`matchesFixed` exact / `matchesPattern` subset) — decimals compared
  precision-exactly, never via float. `PROFILE_FIXED_MISMATCH` / `PROFILE_PATTERN_MISMATCH` (error).
- **Must-support as a system obligation** — an absent must-support element is `MUST_SUPPORT_ABSENT` at
  **`information`, never an error** (not instance presence). `resolvePath` / `pathExists` is a bounded
  path navigator (the Phase-7 FHIRPath engine is not needed for element/discriminator paths).
- **Multi-version** — `PROFILE_VERSION_MISMATCH` (warning) for a `meta.profile` `canonical|version`
  pin the supplied set carries at a different version. `collectProfileIssues` /
  `collectProfileVersionIssues` run inside `validateResource(resource, { profiles, resolveBase })`.
  New issue codes and the `business-rule` `IssueType` are snapshot-pinned; a rename is breaking.

Still deferred: the bundled multi-version US Core IG corpus and the `validator_cli.jar` differential
(a JVM dev/CI job — Phase 11); the `type` / `profile` discriminators, reslicing, and invariant
`constraint`s (need the FHIRPath subset — Phase 7); XML (Phase 8).
