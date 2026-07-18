/**
 * Bundles, references, and Bulk NDJSON streaming (Phase 9). The internal barrel for the `bundle/`
 * layer: the `Bundle` model + entry-processing semantics, reference resolution + the DoS-safe cycle
 * guard, and the streaming `application/fhir+ndjson` reader. Re-exported from the package root.
 *
 * @packageDocumentation
 */

export {
  BUNDLE_TYPES,
  entryProcessing,
  isAtomicBundle,
  readBundle,
  type BundleEntry,
  type BundleReadout,
  type BundleType,
  type EntryProcessing,
} from "./types.js";
export {
  buildBundleIndex,
  containedIndex,
  eachReference,
  hasContainedCycle,
  resolveReference,
  MAX_REFERENCE_DEPTH,
  type BundleIndex,
  type ContainedIndex,
  type ReferenceResolution,
} from "./references.js";
export {
  parseNdjsonLine,
  streamNdjson,
  NDJSON_ERROR_CODES,
  type NdjsonError,
  type NdjsonErrorCode,
  type NdjsonOptions,
  type NdjsonRecord,
} from "./ndjson.js";
