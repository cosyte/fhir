/**
 * The safety spine — never-droppable surfacing of FHIR's modifier / status / negation elements
 * (Phase 3). The read side ({@link ./status.js}) carries the modifiers into an explicit readout and
 * refuses to summarize past an unhandled `modifierExtension`; the terminology ({@link ./codes.js})
 * is the closed set of spec-defined status / negation / retraction identifiers the readout speaks.
 *
 * The matching *validation* side (fail-closed on an unknown `modifierExtension`, the ait/con/obs
 * invariants, and the `entered-in-error` retraction issue) lives in {@link ../validate/safety.js}
 * and is reached through `validateResource`.
 */

export {
  assertSafeToSummarize,
  FhirSafetyError,
  readSafety,
  unhandledModifierExtensions,
} from "./status.js";
export type { NegationKind, SafetyReadout } from "./status.js";
export {
  codeOf,
  codingsOf,
  hasCodeAnySystem,
  hasCoding,
  isRetracted,
  ALLERGY_CLINICAL_SYSTEM,
  ALLERGY_VERIFICATION_SYSTEM,
  CONDITION_CATEGORY_SYSTEM,
  CONDITION_CLINICAL_SYSTEM,
  CONDITION_VERIFICATION_SYSTEM,
  ENTERED_IN_ERROR,
  KNOWN_MODIFIER_EXTENSION_URLS,
  NO_KNOWN_ALLERGY,
  NOT_DONE,
  NOT_TAKEN,
  REFUTED,
  SAFETY_RESOURCE_TYPES,
  SNOMED_SCT,
} from "./codes.js";
export type { Coded } from "./codes.js";
