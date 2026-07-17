---
"@cosyte/fhir": patch
---

Phase 3 — safety-critical status & negation model (the fail-closed core). Surfaces FHIR's modifier
(`?!`) elements so a consumer can never silently drop or invert them, and enforces the safety
invariants that harm a patient when read wrong (roadmap §4).

- **`readSafety(resource)`** — a never-droppable readout of the modifier / status / negation elements
  across the six safety resource types (AllergyIntolerance, Condition, MedicationRequest·Statement,
  Observation, Immunization, DiagnosticReport): `status`, `clinicalStatus`, `verificationStatus`,
  `doNotPerform`, retraction, and a classified `negations` list (`refuted`, `no-known-allergy`,
  `do-not-perform`, `not-taken`, `not-done`, `entered-in-error`). SNOMED CT `716186003` "no known
  allergy" is surfaced as a first-class negation (≠ an absent resource, ≠ an allergy *to* the code).
- **Fail-closed on an unknown `modifierExtension`.** By FHIR's `?!` rule a consumer that does not
  understand a `modifierExtension` MUST reject the element; the library understands none yet, so any
  `modifierExtension` anywhere in any resource is `UNHANDLED_MODIFIER_EXTENSION` (error). The read
  side refuses too: `assertSafeToSummarize` throws `FhirSafetyError` (value-free) rather than flatten
  such a resource.
- **Named invariants**, hand-evaluated from their exact R4 FHIRPath: `ait-1`/`ait-2`
  (AllergyIntolerance), `con-3`/`con-4`/`con-5` (Condition), `obs-6`/`obs-7` (Observation), emitted as
  `INVARIANT_VIOLATED` with the constraint key on the issue (and in `OperationOutcome.issue.details`).
  Severities mirror the spec: all `error` except the best-practice `con-3` (`warning`). `entered-in-error`
  is surfaced as `RETRACTED_RESOURCE` (information) — retracted, not data.
- New issue vocabulary (`UNHANDLED_MODIFIER_EXTENSION`, `RETRACTED_RESOURCE`, `INVARIANT_VIOLATED`) and
  R4 issue types (`invariant`, `not-supported`); every finding stays value-free (a coded reason, a
  FHIRPath location, and — for an invariant — the public constraint key, never an instance value).

Still deferred: a general FHIRPath engine (Phase 7 — this phase hand-codes only the safety-critical
invariant set, ADR 0002), Quantity/UCUM fidelity (Phase 4), terminology binding (Phase 5), profiles
(Phase 6), and XML (Phase 8). This layer surfaces and enforces; it never reconciles contradictions or
infers clinical meaning.
