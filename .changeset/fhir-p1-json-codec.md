---
"@cosyte/fhir": patch
---

Phase 1 — JSON codec + typed primitive model (the no-data-loss core). Adds the first parsing code:
a precision-preserving JSON reader (`parseResource` / `readRawJson`) that never routes a number
through the JS `number` type, string-backed `FhirDecimal` / `FhirInteger64` primitives that preserve
exact lexical precision (`0.010` stays `0.010`; 64-bit integers stay exact — ADR 0001), a first-class
primitive-extension (`_`-sibling) model with null-padded array alignment that fails closed on a
length mismatch, an immutable generic element model (`FhirComplex` / `FhirList` / `FhirPrimitive`)
resolving `resourceType` in any position, a `parseReference` classifier, a spec-clean `serializeResource`
(byte-identical round-trip for spec-clean input), and value-free (PHI-safe) diagnostics
(`DECIMAL_PRECISION_AT_RISK`, `UNKNOWN_PROPERTY`, `MALFORMED_JSON`, `PRIMITIVE_EXTENSION_MISALIGNED`).
Validation, terminology, profiles, invariants, and XML remain deferred to later phases — Phase 1
parses and preserves, it does not validate.
