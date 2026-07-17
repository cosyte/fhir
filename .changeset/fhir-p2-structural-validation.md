---
"@cosyte/fhir": patch
---

Phase 2 — structural & cardinality validation + `OperationOutcome`. Adds the first three validation
layers over the Phase-1 model (`validateResource`), each finding value-free (a stable code, an R4
`IssueType`, and a FHIRPath `expression` — never the offending value): layer 1 structure
(`UNKNOWN_ELEMENT`, `RESOURCE_TYPE_UNKNOWN`, `TYPE_MISMATCH`, `CHOICE_AMBIGUOUS`), layer 2 cardinality
(`CARDINALITY_MIN` / `CARDINALITY_MAX`), and layer 3 value-domain (`PRIMITIVE_INVALID` against the R4
primitive datatype regexes — the JSON-number family validated from exact lexical text, never a float —
and `CODE_INVALID` for required-strength enumerated bindings). Emits a serializable, value-free
`OperationOutcome` (`toOperationOutcome`) with R4 `severity` / `code` / `expression` and a
`diagnostics` line derived only from the code — the single PHI redaction chokepoint. Lenient read
(unknown element → warning + preserve) vs strict emit (→ error); fail-safe with no false errors (an
unmodeled resource type degrades to one informational `RESOURCE_NOT_MODELED`). Ships a compact,
non-`StructureDefinition` schema (`ResourceSchema` / `buildRegistry` / `resolveElement`, with
`choice[x]` support) seeded with the base-resource elements + a worked `Patient` schema; callers
supply others. Terminology binding beyond required-code enumeration (Phase 5), profile / US Core /
slicing (Phase 6), and FHIRPath invariants (Phase 7) remain deferred.
