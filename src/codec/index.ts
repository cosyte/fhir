/**
 * FHIR wire codec — read (parse) and write (serialize) between the wire format and the model.
 *
 * JSON-first (architecture ADR 0003; XML is Phase 8). Postel's Law: the reader is liberal (lenient,
 * preserving, warning) and the writer is conservative (spec-clean canonical JSON). The two
 * silent-data-loss hazards — decimal precision and primitive-extension (`_`-sibling) alignment —
 * are handled here (json.html, roadmap §4.1); a JSON number never routes through a JavaScript
 * `number`, and a broken `_`-alignment fails closed.
 */

export { parseResource } from "./read.js";
export type { ReadResult } from "./read.js";
export { serializeResource } from "./write.js";
export { readRawJson } from "./raw-json.js";
export type {
  RawArray,
  RawBool,
  RawJson,
  RawMember,
  RawNull,
  RawNumber,
  RawObject,
  RawString,
} from "./raw-json.js";
export {
  decimalPrecisionAtRisk,
  unexpectedXmlContent,
  unknownProperty,
  FATAL_CODES,
  FhirCodecError,
  ISSUE_CODES,
} from "./issues.js";
export type { FatalCode, FhirIssue, IssueCode, IssueSeverity } from "./issues.js";
