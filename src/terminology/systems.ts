/**
 * The frozen **known-systems registry** (Phase 5, content-free terminology binding).
 *
 * A code lives in a `(system, code)` tuple. This module holds the closed set of code-`system` URIs
 * the library recognizes, the identities from the roadmap §5 table, verified against
 * `terminologies-systems.html`. It is a registry of **identities, not content**: knowing that
 * `http://loinc.org` is LOINC lets the validator reason about *which* system a code claims, but the
 * library bundles **no** LOINC / SNOMED / RxNorm / CPT concept tables (roadmap §5 licensing). Whether
 * a code is actually a *member* of a value set is a question only a pluggable terminology service can
 * answer ({@link ./service.js}); absent one, terminology checks degrade to the system level.
 *
 * **Only verified URIs are encoded.** ICD-10-PCS and HCPCS have open-question canonical R4 `system`
 * URIs (roadmap §10 items 5); rather than guess one, they are **omitted**, an omitted system reads
 * as "unknown", which is a safe, non-erroring degrade, never a false identity.
 *
 * The `system` constants shared with earlier phases are re-exported from their owning modules
 * ({@link ../quantity/ucum.js} for LOINC/UCUM, {@link ../safety/codes.js} for SNOMED) so there is one
 * source of truth per URI.
 *
 * @packageDocumentation
 */

import { LOINC_SYSTEM, UCUM_SYSTEM } from "../quantity/ucum.js";
import { SNOMED_SCT } from "../safety/codes.js";

export { LOINC_SYSTEM, UCUM_SYSTEM } from "../quantity/ucum.js";
export { SNOMED_SCT } from "../safety/codes.js";

/** RxNorm `system` URI, NLM, medications (roadmap §5). */
export const RXNORM_SYSTEM = "http://www.nlm.nih.gov/research/umls/rxnorm";

/** ICD-10-CM `system` URI, NCHS/CMS, encounter diagnosis / billing (roadmap §5). */
export const ICD10CM_SYSTEM = "http://hl7.org/fhir/sid/icd-10-cm";

/** ICD-9-CM `system` URI, legacy, crosswalk only (roadmap §5). */
export const ICD9CM_SYSTEM = "http://hl7.org/fhir/sid/icd-9-cm";

/** CPT `system` URI, AMA, procedures/billing. **License-restricted**: identity only, no content (roadmap §5). */
export const CPT_SYSTEM = "http://www.ama-assn.org/go/cpt";

/** NDC `system` URI, FDA, drug product/package (roadmap §5). */
export const NDC_SYSTEM = "http://hl7.org/fhir/sid/ndc";

/** CVX `system` URI, CDC NCIRD, vaccines (roadmap §5). */
export const CVX_SYSTEM = "http://hl7.org/fhir/sid/cvx";

/**
 * The frozen known-systems registry: each recognized code-`system` URI mapped to its short steward
 * name. This is a **closed set of identities** (like the Phase-3 status codes and the Phase-4
 * vital-signs table), not a licensed terminology table, it says *which* system a URI names, never
 * *what codes* it contains. A URI absent from this map is "unknown": the validator cannot reason
 * about its codes, and degrades to a non-erroring informational note rather than a false rejection
 * (roadmap §5 fail-safe). It is the seam a later phase widens as verified URIs are confirmed
 * (ICD-10-PCS / HCPCS remain open, roadmap §10).
 */
export const KNOWN_SYSTEMS: ReadonlyMap<string, string> = new Map<string, string>([
  [LOINC_SYSTEM, "LOINC"],
  [SNOMED_SCT, "SNOMED CT"],
  [RXNORM_SYSTEM, "RxNorm"],
  [ICD10CM_SYSTEM, "ICD-10-CM"],
  [ICD9CM_SYSTEM, "ICD-9-CM"],
  [CPT_SYSTEM, "CPT"],
  [UCUM_SYSTEM, "UCUM"],
  [NDC_SYSTEM, "NDC"],
  [CVX_SYSTEM, "CVX"],
]);

/**
 * Whether a code-`system` URI is in the frozen {@link KNOWN_SYSTEMS} registry. An **unknown** system
 * is not an error, it may be a legitimate local/proprietary system, it merely means the library
 * cannot reason about codes drawn from it (roadmap §5 fail-safe).
 *
 * @param system - A code-system URI.
 * @returns `true` when the URI is a recognized code system.
 * @example
 * ```ts
 * import { isKnownSystem } from "@cosyte/fhir";
 * isKnownSystem("http://loinc.org");        // true
 * isKnownSystem("http://example.org/local"); // false, unknown, not invalid
 * ```
 */
export function isKnownSystem(system: string): boolean {
  return KNOWN_SYSTEMS.has(system);
}
