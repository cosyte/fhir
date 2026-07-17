/**
 * FHIR resource model — the typed, immutable, wire-agnostic representation of FHIR resources and
 * datatypes.
 *
 * Phase 1 lands the **no-data-loss core**: the two precision-preserving primitives
 * ({@link FhirDecimal}, {@link FhirInteger64}, architecture ADR 0001) and a generic element tree
 * ({@link FhirNode}) that faithfully preserves structure, property order, and primitive metadata
 * (architecture ADR 0003). Typed per-resource models (Observation, Patient, …) arrive in later
 * phases; this barrel is their foundation.
 */

export { FhirDecimal, decimal, wouldLosePrecisionAsDouble } from "./decimal.js";
export { FhirInteger64, integer64 } from "./integer64.js";
export {
  complex,
  getProperty,
  isComplex,
  isList,
  isPrimitive,
  list,
  primitive,
  resourceType,
} from "./node.js";
export type {
  FhirComplex,
  FhirList,
  FhirNode,
  FhirPrimitive,
  FhirProperty,
  PrimitiveMeta,
  PrimitiveValue,
} from "./node.js";
export { parseReference } from "./reference.js";
export type { ParsedReference, ReferenceKind } from "./reference.js";
