/**
 * FHIR resource model — the typed, in-memory representation of FHIR resources and datatypes.
 *
 * Populated from Phase 1 onward (R4 `4.0.1` datatypes + a first resource slice). Two decisions
 * bind this module's shape and are recorded as ADRs before any code lands:
 *
 * - `decimal` / `integer64` MUST preserve lexical precision — see
 *   `documentation/decisions/0001-decimal-integer64-representation.md`. `0.010` is not `0.01`;
 *   these primitives never round-trip through the JS `number` type.
 * - R4 (`4.0.1`) is the modeled version; R5 / DSTU2 are read-tolerance only — see
 *   `documentation/decisions/0004-r4-first-version-strategy.md`.
 *
 * This barrel is an intentional placeholder for the P0 bootstrap: no parse code this phase.
 */
export {};
