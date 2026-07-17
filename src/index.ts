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
  unknownProperty,
  FATAL_CODES,
  FhirCodecError,
  ISSUE_CODES,
} from "./codec/issues.js";
export type { FatalCode, FhirIssue, IssueCode, IssueSeverity } from "./codec/issues.js";
