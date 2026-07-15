/**
 * FHIR validation — structural, cardinality, terminology-binding, and (later) invariant checks.
 *
 * FHIRPath is required for invariants and profile slicing (Phase 7); the dependency posture is
 * decided up front in `documentation/decisions/0002-fhirpath-dependency-posture.md` so it does not
 * become an accidental runtime dependency. Structural validation lands earlier; FHIRPath-backed
 * invariants arrive with the profile engine.
 *
 * This barrel is an intentional placeholder for the P0 bootstrap: no parse code this phase.
 */
export {};
