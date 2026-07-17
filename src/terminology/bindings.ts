/**
 * Terminology **bindings** — the map from an element to the value set it draws from and the strength
 * of that binding (Phase 5).
 *
 * A FHIR element binds to a value set at one of four strengths (terminologies.html), and the strength
 * governs how severe a non-conforming code is:
 *
 * - **required** — the code SHALL be from the value set (a violation is an `error`).
 * - **extensible** — the code SHALL be from the value set *unless* no code in it covers the concept
 *   (a violation is an `error` unless justified — roadmap's "error-unless").
 * - **preferred** — the code SHOULD be from the value set (a violation is a `warning`).
 * - **example** — the value set is illustrative only (a non-member is `information` at most, and
 *   **never** an error — rebinding an example code must not fail).
 *
 * This module encodes **identities, not content**: each binding names a value set (its canonical
 * URL/OID) and, where the value set draws from a known closed set of code systems, those `systems`.
 * The `systems` allow-list is what makes a **content-free** check possible — without any terminology
 * service, the library can still tell that an AllergyIntolerance substance coded in ICD-10-CM is in
 * the wrong system for a value set built from RxNorm + SNOMED, even though it cannot confirm the code
 * itself is a member (that needs {@link ./service.js}).
 *
 * **The built-in set is intentionally the roadmap-named multi-system elements only** — allergy
 * substance (RxNorm + SNOMED) and medication (RxNorm). Full per-element US Core binding coverage is a
 * profile concern (Phase 6); a consumer supplies more bindings via `validateResource(resource, {
 * bindings: [...] })`, exactly as Phase 2 takes extra `schemas`.
 *
 * @packageDocumentation
 */

import { RXNORM_SYSTEM, SNOMED_SCT } from "./systems.js";

/** The four FHIR binding strengths (terminologies.html), strongest to weakest. */
export type BindingStrength = "required" | "extensible" | "preferred" | "example";

/** The set of {@link BindingStrength} values, for validation/iteration. */
export const BINDING_STRENGTHS: readonly BindingStrength[] = [
  "required",
  "extensible",
  "preferred",
  "example",
];

/** A binding from an element path to a value set, at a given strength. */
export interface TerminologyBinding {
  /**
   * The element's FHIRPath from the resource root, e.g. `"AllergyIntolerance.code"` or
   * `"MedicationRequest.medicationCodeableConcept"` (the concrete `medication[x]` choice variant).
   */
  readonly path: string;
  /** The bound value set's canonical identity (URL / OID form) — passed to a terminology service. */
  readonly valueSet: string;
  /** The binding strength — governs the severity of a non-conforming code. */
  readonly strength: BindingStrength;
  /**
   * The closed set of code `system`s the value set draws from, when it is known. Present enables the
   * content-free "wrong system for this binding" check; absent, only a terminology service can judge
   * conformance. For an **extensible** binding a code from another system may be a legitimate
   * extension, so a system outside this set is a `warning`, never an `error` (see the layer).
   */
  readonly systems?: readonly string[];
}

/**
 * US Core AllergyIntolerance substance value set — VSAC `2.16.840.1.113762.1.4.1186.8`, an
 * **extensible** binding drawing from **RxNorm** (drug) **+ SNOMED CT** (food/environmental and the
 * "no known allergy" negation concepts). The multi-system composition the roadmap §4.3 calls out:
 * the validator must accept *both* systems on this one element. *(US Core AllergyIntolerance)*
 */
export const ALLERGY_SUBSTANCE_VALUESET =
  "http://cts.nlm.nih.gov/fhir/ValueSet/2.16.840.1.113762.1.4.1186.8";

/**
 * US Core medication value set — VSAC `2.16.840.1.113762.1.4.1010.4`, an **extensible** binding to
 * **RxNorm**. Bound on `MedicationRequest`/`MedicationStatement` `medicationCodeableConcept`.
 * *(US Core MedicationRequest §4.4)*
 */
export const MEDICATION_VALUESET =
  "http://cts.nlm.nih.gov/fhir/ValueSet/2.16.840.1.113762.1.4.1010.4";

/**
 * The built-in bindings — the roadmap-named multi-system elements. Deliberately minimal: broad US
 * Core element coverage is Phase 6 (profiles). Each is **extensible**, so a code outside its systems
 * is a `warning` (a possible legitimate extension), never a false `error`.
 */
export const TERMINOLOGY_BINDINGS: readonly TerminologyBinding[] = [
  {
    path: "AllergyIntolerance.code",
    valueSet: ALLERGY_SUBSTANCE_VALUESET,
    strength: "extensible",
    systems: [RXNORM_SYSTEM, SNOMED_SCT],
  },
  {
    path: "MedicationRequest.medicationCodeableConcept",
    valueSet: MEDICATION_VALUESET,
    strength: "extensible",
    systems: [RXNORM_SYSTEM],
  },
  {
    path: "MedicationStatement.medicationCodeableConcept",
    valueSet: MEDICATION_VALUESET,
    strength: "extensible",
    systems: [RXNORM_SYSTEM],
  },
];

/** A resolver from an element path to its {@link TerminologyBinding}, or `undefined`. */
export type BindingRegistry = (path: string) => TerminologyBinding | undefined;

/**
 * Build a {@link BindingRegistry} from the built-in bindings plus any caller-supplied ones. A
 * caller binding for a path replaces the built-in for that path, so a consumer can override or add
 * element bindings (Phase 6 feeds these from real profiles).
 *
 * @param extra - Additional bindings to register (override built-ins by path).
 * @returns A resolver from element path to its binding.
 * @example
 * ```ts
 * import { buildBindingRegistry } from "@cosyte/fhir";
 * const registry = buildBindingRegistry();
 * registry("AllergyIntolerance.code")?.strength; // "extensible"
 * registry("Patient.gender");                    // undefined — not a terminology binding here
 * ```
 */
export function buildBindingRegistry(extra: readonly TerminologyBinding[] = []): BindingRegistry {
  const byPath = new Map<string, TerminologyBinding>();
  for (const binding of TERMINOLOGY_BINDINGS) byPath.set(binding.path, binding);
  for (const binding of extra) byPath.set(binding.path, binding);
  return (path: string): TerminologyBinding | undefined => byPath.get(path);
}
