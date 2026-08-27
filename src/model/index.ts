/**
 * FHIR resource model, the typed, immutable, wire-agnostic representation of FHIR resources and
 * datatypes.
 *
 * The **no-data-loss core**: the two precision-preserving primitives
 * ({@link FhirDecimal}, {@link FhirInteger64}) and a generic element tree
 * ({@link FhirNode}) that faithfully preserves structure, property order, and primitive metadata.
 * Typed per-resource models (Observation, Patient, …) are not part of the model yet; this barrel is
 * their foundation.
 */

export { FhirDecimal, decimal, wouldLosePrecisionAsDouble } from "./decimal.js";
export { FhirInteger64, integer64 } from "./integer64.js";
export {
  complex,
  getAllProperties,
  getProperty,
  isComplex,
  isList,
  isDroppedText,
  isForeignRoot,
  isNestedArray,
  isPrimitive,
  isUndefinedNull,
  list,
  nestedArrayContent,
  primitive,
  resourceType,
} from "./node.js";
export type {
  FhirComplex,
  FhirList,
  FhirNode,
  FhirPrimitive,
  FhirProperty,
  NestedArrayChannel,
  NestedArrayContent,
  PrimitiveMeta,
  PrimitiveValue,
} from "./node.js";
export { WITHHELD, childPath, rootPath, safeDerivedName } from "./path.js";
export type { DerivedNameKind } from "./path.js";
export { parseReference } from "./reference.js";
export type { ParsedReference, ReferenceKind } from "./reference.js";
