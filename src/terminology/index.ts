/**
 * FHIR terminology, the content-free binding layer (Phase 5).
 *
 * Three pieces, all **identities, not content** (roadmap §5, no SNOMED/CPT/LOINC concept tables are
 * vendored): the frozen {@link ./systems.js known-systems registry}, the
 * {@link ./bindings.js element→value-set bindings} with their strengths, and the pluggable
 * {@link ./service.js terminology-service interface} through which a consumer supplies the value-set
 * content the library does not bundle. The validator that consumes them lives in
 * {@link ../validate/terminology.js}; absent a service it degrades to warnings and never false-errors.
 *
 * @packageDocumentation
 */

export {
  isKnownSystem,
  KNOWN_SYSTEMS,
  CPT_SYSTEM,
  CVX_SYSTEM,
  ICD9CM_SYSTEM,
  ICD10CM_SYSTEM,
  LOINC_SYSTEM,
  NDC_SYSTEM,
  RXNORM_SYSTEM,
  SNOMED_SCT,
  UCUM_SYSTEM,
} from "./systems.js";
export {
  buildBindingRegistry,
  ALLERGY_SUBSTANCE_VALUESET,
  BINDING_STRENGTHS,
  MEDICATION_VALUESET,
  TERMINOLOGY_BINDINGS,
} from "./bindings.js";
export type { BindingRegistry, BindingStrength, TerminologyBinding } from "./bindings.js";
export type {
  CodeMembership,
  CodeValidationRequest,
  CodeValidationResult,
  TerminologyService,
} from "./service.js";
