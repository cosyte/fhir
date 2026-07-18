/**
 * FHIR profiles — StructureDefinition-driven conformance (Phase 6).
 *
 * The profile engine, in dependency order: load a `StructureDefinition`
 * ({@link ./structure-definition.js}), generate its snapshot from a differential
 * ({@link ./snapshot.js}), compare `fixed[x]` / `pattern[x]` constraints ({@link ./fixed-pattern.js}),
 * navigate element paths ({@link ./navigate.js}), match slices ({@link ./slicing.js}), and validate a
 * resource against a profile ({@link ./validate-profile.js}). US Core is the primary target (the
 * R4 + US Core + SMART regulatory anchor, ADR 0004), but **no StructureDefinition content is
 * bundled** — a caller supplies the profiles to validate against, exactly as the terminology layer
 * takes a terminology service.
 *
 * @packageDocumentation
 */

export { DISCRIMINATOR_TYPES, loadStructureDefinition } from "./structure-definition.js";
export type {
  Derivation,
  Discriminator,
  DiscriminatorType,
  ElementBinding,
  ElementConstraint,
  ElementDefinition,
  ElementType,
  Slicing,
  SlicingRules,
  StructureDefinition,
  TypedValue,
} from "./structure-definition.js";

export { FhirProfileError, generateSnapshot, snapshotElements } from "./snapshot.js";
export type { BaseResolver } from "./snapshot.js";

export { matchesFixed, matchesPattern } from "./fixed-pattern.js";
export { pathExists, resolvePath } from "./navigate.js";

export { matchSlices, resolveSlices } from "./slicing.js";
export type { SliceConstraint, SliceDefinition, SliceMatchResult } from "./slicing.js";

export { collectProfileIssues, collectProfileVersionIssues } from "./validate-profile.js";
export type { ProfileOptions } from "./validate-profile.js";

export { collectInvariantIssues } from "./invariants.js";
export type { InvariantOptions } from "./invariants.js";
