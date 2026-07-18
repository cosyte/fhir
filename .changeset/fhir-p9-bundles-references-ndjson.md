---
"@cosyte/fhir": patch
---

Bundles, references, and Bulk NDJSON streaming (Phase 9, bundle.html / references.html / the Bulk Data
Access IG). The `Bundle` model with explicit **entry-processing semantics** — `readBundle` /
`entryProcessing` / `isAtomicBundle` keep **transaction = all-or-nothing (atomic)** genuinely distinct
from **batch = independent**, over the full R4 `Bundle.type` set (`BUNDLE_TYPES`). The artifact and its
semantics are modeled; transactions are **not executed** (there is no server here — a stated non-goal).
Reference resolution (`resolveReference`, `buildBundleIndex`, `containedIndex`) classifies and resolves
relative / absolute / logical / `#fragment` references against a Bundle + contained closure, reporting
a local miss honestly (`unresolved`) while never false-flagging a legitimately-external reference. A
**DoS-safe cycle guard** (`hasContainedCycle`) runs an iterative, three-color, heap-based DFS bounded by
`MAX_REFERENCE_DEPTH`, so a contained reference cycle is detected and reported — never an infinite loop
or a stack blow-up. And a **streaming `application/fhir+ndjson` reader** (`streamNdjson`,
`parseNdjsonLine`) with **per-line error isolation** (a malformed line yields an isolated, value-free
error and the stream continues) and **no whole-file load** (only the current partial line is buffered;
an adversarial unterminated line is cut off `LINE_TOO_LONG` and drained without accumulating), reading
each line through the precision-preserving codec so a decimal is never routed through a JS `number`.

New value-free diagnostics (wired into `validateResource` for a `Bundle`): `REFERENCE_UNRESOLVED`
(warning — preserved, never fatal), `CONTAINED_CYCLE` (error), and `FULLURL_ID_MISMATCH` (error, and
correctly exempting a `urn:uuid` fullUrl, which places no constraint on `resource.id`). Zero runtime
dependencies. **Deferred (stated, not built):** no transaction *execution* — the library models the
Bundle artifact and its all-or-nothing vs independent semantics, not a server that applies them.
