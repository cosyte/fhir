/**
 * Public entry point for the `@cosyte/fhir` package.
 *
 * The full public API (resource model, JSON codec, validation, profiles, helpers) is populated in
 * subsequent phases — see `operations/roadmaps/fhir.md` in the meta-repo. P0 ships the scaffold and
 * the four architecture ADRs only; there is no parse code in this phase. This entry keeps the module
 * resolvable and typed so the tooling (tsup, vitest, tsc, attw) can verify the build/typecheck
 * pipeline end-to-end.
 */

/**
 * Library version string, synced with `package.json#version` at build time by
 * `scripts/sync-version.mjs` (wired into the Changesets `version` script). Exported now so
 * consumers — and the type-check pipeline — have at least one symbol to resolve through the
 * `exports` map.
 *
 * @example
 * ```ts
 * import { VERSION } from "@cosyte/fhir";
 * console.log(VERSION);
 * ```
 */
export const VERSION: string = "0.0.0";

// Phase 1 — the no-data-loss core: precision-preserving primitives + generic model.
export { FhirDecimal, decimal, wouldLosePrecisionAsDouble } from "./model/decimal.js";
export { FhirInteger64, integer64 } from "./model/integer64.js";
export {
  complex,
  getProperty,
  isComplex,
  isList,
  isPrimitive,
  list,
  primitive,
  resourceType,
} from "./model/node.js";
export type {
  FhirComplex,
  FhirList,
  FhirNode,
  FhirPrimitive,
  FhirProperty,
  PrimitiveMeta,
  PrimitiveValue,
} from "./model/node.js";
export { parseReference } from "./model/reference.js";
export type { ParsedReference, ReferenceKind } from "./model/reference.js";

// Phase 1 — the JSON codec: precision-preserving read, spec-clean write, value-free diagnostics.
export { parseResource } from "./codec/read.js";
export type { ReadResult } from "./codec/read.js";
export { serializeResource } from "./codec/write.js";
export { readRawJson } from "./codec/raw-json.js";
export type {
  RawArray,
  RawBool,
  RawJson,
  RawMember,
  RawNull,
  RawNumber,
  RawObject,
  RawString,
} from "./codec/raw-json.js";
export {
  decimalPrecisionAtRisk,
  unexpectedXmlContent,
  unknownProperty,
  FATAL_CODES,
  FhirCodecError,
  ISSUE_CODES,
} from "./codec/issues.js";
export type { FatalCode, FhirIssue, IssueCode, IssueSeverity } from "./codec/issues.js";

// Phase 2 — structural / cardinality / value-domain validation + value-free OperationOutcome.
export { validateResource } from "./validate/validate.js";
export type { ValidateOptions, ValidationMode, ValidationResult } from "./validate/validate.js";
export { toOperationOutcome } from "./validate/operation-outcome.js";
export {
  diagnosticFor,
  validationIssue,
  ISSUE_SEVERITIES,
  ISSUE_TYPES,
  VALIDATION_CODES,
} from "./validate/issues.js";
export type {
  IssueType,
  ValidationCode,
  ValidationIssue,
  ValidationSeverity,
} from "./validate/issues.js";
export { isPrimitiveType, validatePrimitiveValue, PRIMITIVE_TYPES } from "./validate/primitives.js";
export type { PrimitiveType } from "./validate/primitives.js";
export {
  baseSchema,
  buildRegistry,
  isChoice,
  resolveElement,
  UNBOUNDED,
} from "./validate/schema.js";
export type {
  ElementSchema,
  RequiredBinding,
  ResourceSchema,
  SchemaRegistry,
} from "./validate/schema.js";
export { collectSafetyIssues } from "./validate/safety.js";

// Phase 3 — the safety spine: never-droppable status/negation surfacing + fail-closed modifiers.
export {
  assertSafeToSummarize,
  FhirSafetyError,
  readSafety,
  unhandledModifierExtensions,
} from "./safety/status.js";
export type { NegationKind, SafetyReadout } from "./safety/status.js";
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
} from "./safety/codes.js";
export type { Coded } from "./safety/codes.js";

// Phase 4 — Quantity / UCUM fidelity: value[x] discrimination, UCUM code shape, vital-signs units,
// dose quantities. Never converts a unit.
export {
  LOINC_SYSTEM,
  OBSERVATION_CATEGORY_SYSTEM,
  readQuantity,
  requiredVitalSignUnits,
  UCUM_SYSTEM,
  validateUcumShape,
  VITAL_SIGN_UNITS,
  VITAL_SIGNS_CATEGORY,
  VITAL_SIGNS_PROFILE,
} from "./quantity/ucum.js";
export type { Quantity, UcumShapeVerdict } from "./quantity/ucum.js";
export {
  OBSERVATION_VALUE_TYPES,
  readInterpretations,
  readObservationValue,
  readReferenceRanges,
} from "./quantity/value.js";
export type {
  ObservationReferenceRange,
  ObservationValue,
  ObservationValueType,
} from "./quantity/value.js";
export { locateDoseQuantities, readMedicationDoses } from "./quantity/dose.js";
export type { LocatedDoseQuantity } from "./quantity/dose.js";
export { collectQuantityIssues } from "./validate/quantity.js";

// Phase 5 — terminology binding validation: strength-aware, content-free. Known-systems registry,
// element→value-set bindings, and a pluggable terminology-service interface (none bundled — §5).
export {
  isKnownSystem,
  KNOWN_SYSTEMS,
  CPT_SYSTEM,
  CVX_SYSTEM,
  ICD9CM_SYSTEM,
  ICD10CM_SYSTEM,
  NDC_SYSTEM,
  RXNORM_SYSTEM,
} from "./terminology/systems.js";
export {
  buildBindingRegistry,
  ALLERGY_SUBSTANCE_VALUESET,
  BINDING_STRENGTHS,
  MEDICATION_VALUESET,
  TERMINOLOGY_BINDINGS,
} from "./terminology/bindings.js";
export type {
  BindingRegistry,
  BindingStrength,
  TerminologyBinding,
} from "./terminology/bindings.js";
export type {
  CodeMembership,
  CodeValidationRequest,
  CodeValidationResult,
  TerminologyService,
} from "./terminology/service.js";
export { collectTerminologyIssues } from "./validate/terminology.js";
export type { TerminologyOptions } from "./validate/terminology.js";

// Phase 6 — StructureDefinition + US Core profile validation: snapshot generation from a differential,
// slicing (R4 discriminators value|exists|pattern|type|profile — position is R5-only), fixed[x] vs
// pattern[x], and must-support as a system obligation (never instance-presence). No profile content
// is bundled — a caller supplies the US Core (or vendor) StructureDefinitions.
export { DISCRIMINATOR_TYPES, loadStructureDefinition } from "./profiles/structure-definition.js";
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
} from "./profiles/structure-definition.js";
export { FhirProfileError, generateSnapshot, snapshotElements } from "./profiles/snapshot.js";
export type { BaseResolver } from "./profiles/snapshot.js";
export { matchesFixed, matchesPattern } from "./profiles/fixed-pattern.js";
export { pathExists, resolvePath } from "./profiles/navigate.js";
export { matchSlices, resolveSlices } from "./profiles/slicing.js";
export type { SliceConstraint, SliceDefinition, SliceMatchResult } from "./profiles/slicing.js";
export { collectProfileIssues, collectProfileVersionIssues } from "./profiles/validate-profile.js";
export type { ProfileOptions } from "./profiles/validate-profile.js";
export { collectInvariantIssues } from "./profiles/invariants.js";
export type { InvariantOptions } from "./profiles/invariants.js";

// Phase 7 — invariants via a bounded, vendored FHIRPath subset (ADR 0002). A lexer → parser → evaluator
// that evaluates `constraint[]` expressions; an expression outside the subset is reported UNCHECKED,
// never a silent pass. No runtime dependency, no full third-party engine.
export {
  convertToBoolean,
  evaluateInvariant,
  parseFhirPath,
  tokenize,
  UnsupportedFhirPathError,
} from "./fhirpath/index.js";
export type { Expr, FpColl, FpItem, InvariantResult, Token, TokenType } from "./fhirpath/index.js";

// Phase 8 — the XML codec + cross-format equivalence (xml.html). A zero-dependency, XXE- and
// billion-laughs-proof XML reader (refuses any DTD / non-predefined entity), a spec-clean writer that
// round-trips byte-for-byte, and `nodesEquivalent` — the JSON↔XML model-equivalence oracle. The reader
// produces the same schema-free model as the JSON codec; primitive values are kept as lexical strings.
export { readRawXml } from "./xml/raw-xml.js";
export type { XmlAttribute, XmlElement, XmlNode, XmlText } from "./xml/raw-xml.js";
export { FhirXmlError, XML_FATAL_CODES } from "./xml/issues.js";
export type { XmlFatalCode } from "./xml/issues.js";
export { FHIR_XML_NAMESPACE, parseResourceXml, XHTML_NAMESPACE } from "./xml/read.js";
export { serializeResourceXml } from "./xml/write.js";
export { nodesEquivalent } from "./xml/equivalence.js";
