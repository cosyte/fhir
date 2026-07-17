/**
 * The safety readout — a never-droppable surfacing of a resource's modifier / status / negation
 * elements (Phase 3). This is the read-side counterpart to the validator's fail-closed layer
 * ({@link ../validate/safety.js}).
 *
 * The roadmap's fail-safe rule (§4.8): the library "surfaces status / verification / clinical-status
 * / `doNotPerform` / `not-taken` / `not-done` prominently — any 'flatten/summary' helper carries them
 * or refuses." {@link readSafety} is that carry: given any of the six safety resource types it pulls
 * every modifier element into one explicit structure, classifies the **negations** (so a positive
 * summary can never silently swallow a "refuted" / "not-taken" / "not-done" / "do-not-perform" /
 * "no known allergy" / "entered-in-error"), and reports any **unhandled `modifierExtension`** that
 * makes the resource unsafe to simplify at all. {@link assertSafeToSummarize} is that refusal: it
 * throws rather than let a caller flatten a resource whose modifier it cannot honor.
 *
 * This layer **surfaces**; it does not reconcile. It never decides which of two contradictory statuses
 * is "right", never converts, never infers clinical meaning (roadmap §4, known limitations).
 *
 * @packageDocumentation
 */

import { getProperty, isComplex, isList, type FhirComplex, type FhirNode } from "../model/index.js";
import {
  ALLERGY_CLINICAL_SYSTEM,
  ALLERGY_VERIFICATION_SYSTEM,
  codeOf,
  CONDITION_CLINICAL_SYSTEM,
  CONDITION_VERIFICATION_SYSTEM,
  ENTERED_IN_ERROR,
  hasCodeAnySystem,
  hasCoding,
  isRetracted,
  KNOWN_MODIFIER_EXTENSION_URLS,
  NO_KNOWN_ALLERGY,
  NOT_DONE,
  NOT_TAKEN,
  primitiveBoolean,
  primitiveString,
  REFUTED,
  SNOMED_SCT,
  typeOf,
} from "./codes.js";

/** The `clinicalStatus` code system to prefer when surfacing a code, by resource type. */
function clinicalSystemFor(rt: string | undefined): string | undefined {
  if (rt === "AllergyIntolerance") return ALLERGY_CLINICAL_SYSTEM;
  if (rt === "Condition") return CONDITION_CLINICAL_SYSTEM;
  return undefined;
}

/** The `verificationStatus` code system to prefer when surfacing a code, by resource type. */
function verificationSystemFor(rt: string | undefined): string | undefined {
  if (rt === "AllergyIntolerance") return ALLERGY_VERIFICATION_SYSTEM;
  if (rt === "Condition") return CONDITION_VERIFICATION_SYSTEM;
  return undefined;
}

/**
 * A classified negation — an explicit *negative* assertion that must never collapse into its positive
 * on a summary or a round-trip. One value per distinct FHIR negation mechanism the phase covers.
 */
export type NegationKind =
  /** `verificationStatus = refuted` — asserted, after investigation, to be **not** present. */
  | "refuted"
  /** SNOMED CT `716186003` in `AllergyIntolerance.code` — a recorded "no known allergy". */
  | "no-known-allergy"
  /** `MedicationRequest.doNotPerform = true` — an instruction to **not** give the medication. */
  | "do-not-perform"
  /** `MedicationStatement.status = not-taken` — the medication was **not** taken. */
  | "not-taken"
  /** `Immunization.status = not-done` — the vaccine was **not** given. */
  | "not-done"
  /** `entered-in-error` anywhere — the record is retracted, not data. */
  | "entered-in-error";

/**
 * The complete, value-free safety readout of a resource. Every modifier element the six safety
 * resource types can carry has a slot here, present or `undefined` — so a consumer building a summary
 * reads them explicitly rather than forgetting one.
 *
 * **`negations` (and `retracted`) are the authoritative safety reads.** The single-code convenience
 * fields (`clinicalStatus` / `verificationStatus`) surface the *preferred*-system coding of a
 * `CodeableConcept` — on a multi-coding value whose standard coding is absent they fall back to the
 * first coding, which may be a local/translation code. The classified `negations` are derived from
 * **all** codings under any system, so a refutation / retraction can never hide there. Read a safety
 * decision off `negations` / `retracted`, not off the raw status string.
 */
export interface SafetyReadout {
  /** The `resourceType`, or `undefined` if the resource carries none. */
  readonly resourceType: string | undefined;
  /** The `status` code (Observation / Immunization / DiagnosticReport / MedicationRequest·Statement). */
  readonly status: string | undefined;
  /** The `clinicalStatus` code, preferred-system-first (AllergyIntolerance / Condition). Convenience only. */
  readonly clinicalStatus: string | undefined;
  /** The `verificationStatus` code, preferred-system-first (AllergyIntolerance / Condition). Convenience only. */
  readonly verificationStatus: string | undefined;
  /** `MedicationRequest.doNotPerform`, when present. */
  readonly doNotPerform: boolean | undefined;
  /** Whether the resource is marked `entered-in-error` (retracted, not data) — authoritative. */
  readonly retracted: boolean;
  /** Whether this is a recorded "no known allergy" (SNOMED `716186003`), not an allergy *to* it. */
  readonly noKnownAllergy: boolean;
  /** Every negation the resource asserts (from all codings, any system) — the authoritative safety read. */
  readonly negations: readonly NegationKind[];
  /** FHIRPath locations of `modifierExtension`s this library does not understand (fail-closed). */
  readonly unhandledModifierExtensions: readonly string[];
  /** `false` when an unhandled `modifierExtension` is present — the resource must not be flattened. */
  readonly safeToSummarize: boolean;
}

/**
 * Collect the FHIRPath locations of every `modifierExtension` whose URL this library cannot honor —
 * a deep walk of the whole resource, so a modifier nested in a backbone element or a contained
 * resource is caught too.
 *
 * @param resource - The resource model.
 * @param path - The FHIRPath prefix for the resource root (usually its `resourceType`).
 * @returns The locations of unhandled `modifierExtension`s, in document order.
 * @example
 * ```ts
 * import { parseResource, unhandledModifierExtensions } from "@cosyte/fhir";
 * const { resource } = parseResource(
 *   '{"resourceType":"Patient","modifierExtension":[{"url":"http://example.org/x"}]}',
 * );
 * unhandledModifierExtensions(resource, "Patient"); // ["Patient.modifierExtension[0]"]
 * ```
 */
export function unhandledModifierExtensions(resource: FhirComplex, path: string): string[] {
  const out: string[] = [];
  walkComplex(resource, path, out);
  return out;
}

/** Walk a complex node: check its `modifierExtension` property, then descend into every child. */
function walkComplex(node: FhirComplex, path: string, out: string[]): void {
  for (const property of node.properties) {
    if (property.name === "modifierExtension") checkModifierExtension(property.value, path, out);
    descend(property.value, `${path}.${property.name}`, out);
  }
}

/** Record every unhandled modifier in a `modifierExtension` element (a single Extension or a list). */
function checkModifierExtension(value: FhirNode, path: string, out: string[]): void {
  const items = isList(value) ? value.items : [value];
  items.forEach((ext, index) => {
    const url = isComplex(ext) ? primitiveString(getProperty(ext, "url")) : undefined;
    if (url === undefined || !KNOWN_MODIFIER_EXTENSION_URLS.has(url)) {
      out.push(
        isList(value) ? `${path}.modifierExtension[${String(index)}]` : `${path}.modifierExtension`,
      );
    }
  });
}

/** Descend into a node's children (complex → walk; list → each item) to catch nested modifiers. */
function descend(node: FhirNode, path: string, out: string[]): void {
  if (isComplex(node)) walkComplex(node, path, out);
  else if (isList(node))
    node.items.forEach((item, index) => descend(item, `${path}[${String(index)}]`, out));
}

/**
 * Read the safety-critical modifier / status / negation elements out of a resource, never dropping
 * one. Works for the six safety resource types (roadmap §4.3–4.8); for any other type the modifier
 * slots are `undefined` and only the universal retraction / modifier-extension reads apply.
 *
 * @param resource - The resource model (typically from `parseResource`).
 * @returns The complete {@link SafetyReadout}.
 * @example
 * ```ts
 * import { parseResource, readSafety } from "@cosyte/fhir";
 * const { resource } = parseResource(
 *   '{"resourceType":"MedicationRequest","status":"active","doNotPerform":true,' +
 *     '"medicationCodeableConcept":{"text":"amoxicillin"}}',
 * );
 * const safety = readSafety(resource);
 * safety.doNotPerform;  // true
 * safety.negations;     // ["do-not-perform"]
 * ```
 */
export function readSafety(resource: FhirComplex): SafetyReadout {
  const rt = typeOf(resource);
  const status = primitiveString(getProperty(resource, "status"));
  const clinicalStatus = codeOf(getProperty(resource, "clinicalStatus"), clinicalSystemFor(rt));
  const verificationStatusNode = getProperty(resource, "verificationStatus");
  const verificationStatus = codeOf(verificationStatusNode, verificationSystemFor(rt));
  const doNotPerform =
    rt === "MedicationRequest"
      ? primitiveBoolean(getProperty(resource, "doNotPerform"))
      : undefined;
  const noKnownAllergy =
    rt === "AllergyIntolerance" &&
    hasCoding(getProperty(resource, "code"), SNOMED_SCT, NO_KNOWN_ALLERGY);
  const retracted = isRetracted(resource);

  const negations: NegationKind[] = [];
  if (retracted) negations.push(ENTERED_IN_ERROR);
  // Detect `refuted` from *any* coding on verificationStatus, not the single surfaced code — a
  // CodeableConcept legitimately carries several codings (a local/translation coding alongside the
  // standard one), and `refuted` may not be first. Reading only the first coding would silently drop
  // the refutation and read the record as positive, the exact harm this layer exists to prevent.
  if (hasCodeAnySystem(verificationStatusNode, REFUTED)) negations.push(REFUTED);
  if (noKnownAllergy) negations.push("no-known-allergy");
  if (doNotPerform === true) negations.push("do-not-perform");
  if (rt === "MedicationStatement" && status === NOT_TAKEN) negations.push(NOT_TAKEN);
  if (rt === "Immunization" && status === NOT_DONE) negations.push(NOT_DONE);

  const modifiers = unhandledModifierExtensions(resource, rt ?? "$this");

  return {
    resourceType: rt,
    status,
    clinicalStatus,
    verificationStatus,
    doNotPerform,
    retracted,
    noKnownAllergy,
    negations,
    unhandledModifierExtensions: modifiers,
    safeToSummarize: modifiers.length === 0,
  };
}

/**
 * A refusal raised when a caller tries to flatten or summarize a resource that carries a
 * `modifierExtension` this library does not understand. FHIR's `?!` rule forbids ignoring an
 * unhandled modifier, so the safe move is to **refuse** — value-free, carrying only the locations.
 *
 * @example
 * ```ts
 * import { assertSafeToSummarize, FhirSafetyError, parseResource } from "@cosyte/fhir";
 * const { resource } = parseResource(
 *   '{"resourceType":"Patient","modifierExtension":[{"url":"http://example.org/x"}]}',
 * );
 * try {
 *   assertSafeToSummarize(resource);
 * } catch (err) {
 *   if (err instanceof FhirSafetyError) err.locations; // ["Patient.modifierExtension[0]"]
 * }
 * ```
 */
export class FhirSafetyError extends Error {
  /** FHIRPath locations of the unhandled `modifierExtension`s that forced the refusal. */
  readonly locations: readonly string[];
  /**
   * @param locations - The FHIRPath locations of the unhandled `modifierExtension`s (value-free).
   */
  constructor(locations: readonly string[]) {
    super(
      "Resource carries an unhandled modifierExtension and cannot be safely summarized " +
        `(${String(locations.length)} location(s)).`,
    );
    this.name = "FhirSafetyError";
    this.locations = locations;
  }
}

/**
 * Assert a resource is safe to flatten/summarize, throwing {@link FhirSafetyError} when it carries an
 * unhandled `modifierExtension`. This is the executable form of "carries status **or refuses**": a
 * summary helper calls it first, and never silently drops a modifier it cannot honor.
 *
 * @param resource - The resource (or a readout already computed for it).
 * @throws FhirSafetyError when an unhandled `modifierExtension` is present.
 * @example
 * ```ts
 * import { assertSafeToSummarize, parseResource } from "@cosyte/fhir";
 * const { resource } = parseResource('{"resourceType":"Condition","clinicalStatus":{}}');
 * assertSafeToSummarize(resource); // ok — no unhandled modifier
 * ```
 */
export function assertSafeToSummarize(resource: FhirComplex | SafetyReadout): void {
  const locations =
    "unhandledModifierExtensions" in resource
      ? resource.unhandledModifierExtensions
      : readSafety(resource).unhandledModifierExtensions;
  if (locations.length > 0) throw new FhirSafetyError(locations);
}
