---
"@cosyte/fhir": patch
---

Phase 7 — invariants via a bounded, vendored FHIRPath subset (the sixth-and-final validation layer).
Adds an in-repo FHIRPath engine (lexer → parser → evaluator; `tokenize` / `parseFhirPath` /
`evaluateInvariant`, ADR 0002 — no runtime dependency, no full third-party engine) that evaluates a
profile's `constraint[]` (FHIRPath invariants) against an instance. The subset covers what the R4 /
US Core invariant set uses — path/choice navigation, `$this` / `%resource` / `%context`, existence &
filtering (`exists` / `empty` / `not` / `where` / `all` / `select` / `count` / `first` / `last` /
`distinct` / `hasValue` / `children` / `extension` / `intersect`), three-valued `and` / `or` / `xor` /
`implies`, `=` / `!=` / `<` / `>` / `<=` / `>=` / `in` / `contains` / `|`, and System-type `is` / `as` /
`ofType` — judged by the reference validator's boolean coercion (an empty result is a violation, never
a silent pass). `collectInvariantIssues` (wired into `validateResource({ profiles })`) emits
`INVARIANT_VIOLATED` (severity mirroring the constraint's `error` | `warning`) or, for any expression
outside the subset, `INVARIANT_UNCHECKED` (`information`) — surfaced, **never assumed to pass**
(roadmap §6 fail-safe, via `UnsupportedFhirPathError`). `loadStructureDefinition` now parses
`constraint[]` (new `ElementConstraint` type) and `generateSnapshot` accumulates invariants down the
derivation chain. The seven named safety invariants (`ait`/`con`/`obs`) stay owned by the always-on
Phase-3 safety layer; the engine covers every other constraint. New public code `INVARIANT_UNCHECKED`.
Deferred (fail-safe intact): the `type`/`profile` slicing discriminators and reslicing (still
`PROFILE_SLICE_UNCHECKED`), and the bundled US Core IG corpus + `validator_cli.jar` differential
(Phase 11).
