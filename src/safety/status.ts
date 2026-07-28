/**
 * The safety readout, a never-droppable surfacing of a resource's modifier / status / negation
 * elements. This is the read-side counterpart to the validator's fail-closed layer
 * ({@link ../validate/safety.js}).
 *
 * The fail-safe rule: the library "surfaces status / verification / clinical-status
 * / `doNotPerform` / `not-taken` / `not-done` prominently, any 'flatten/summary' helper carries them
 * or refuses." {@link readSafety} is that carry: given any of the six safety resource types it pulls
 * every modifier element into one explicit structure, classifies the **negations** (so a positive
 * summary can never silently swallow a "refuted" / "not-taken" / "not-done" / "do-not-perform" /
 * "no known allergy" / "entered-in-error"), and reports any **unhandled `modifierExtension`** that
 * makes the resource unsafe to simplify at all. {@link assertSafeToSummarize} is that refusal: it
 * throws rather than let a caller flatten a resource whose modifier it cannot honor.
 *
 * This layer **surfaces**; it does not reconcile. It never decides which of two contradictory statuses
 * is "right", never converts, never infers clinical meaning (known limitations).
 *
 * That last sentence is load-bearing where a document wrote a property name twice. FHIR JSON forbids
 * that (json.html) and RFC 8259 §4 leaves the winner undefined, so the element genuinely holds two
 * values and picking one would be exactly the reconciliation this layer does not do. Two rules follow.
 * The negation reads run over **all** of them, because a retraction the sender wrote must not go
 * unreported. And the readout stops claiming the resource is summarizable: `safeToSummarize` is
 * `false` with the locations in `shadowedProperties`, so a caller gets a refusal rather than an
 * affirmative verdict computed over one arbitrary half of the document.
 *
 * @packageDocumentation
 */

import {
  getProperty,
  isComplex,
  isList,
  type FhirComplex,
  type FhirNode,
  type FhirProperty,
} from "../model/index.js";
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
 * A classified negation, an explicit *negative* assertion that must never collapse into its positive
 * on a summary or a round-trip. One value per distinct FHIR negation mechanism this library covers.
 */
export type NegationKind =
  /** `verificationStatus = refuted`, asserted, after investigation, to be **not** present. */
  | "refuted"
  /** SNOMED CT `716186003` in `AllergyIntolerance.code`, a recorded "no known allergy". */
  | "no-known-allergy"
  /** `MedicationRequest.doNotPerform = true`, an instruction to **not** give the medication. */
  | "do-not-perform"
  /** `MedicationStatement.status = not-taken`, the medication was **not** taken. */
  | "not-taken"
  /** `Immunization.status = not-done`, the vaccine was **not** given. */
  | "not-done"
  /** `entered-in-error` anywhere, the record is retracted, not data. */
  | "entered-in-error";

/**
 * The complete, value-free safety readout of a resource. Every modifier element the six safety
 * resource types can carry has a slot here, present or `undefined`, so a consumer building a summary
 * reads them explicitly rather than forgetting one.
 *
 * **`negations` (and `retracted`) are the authoritative safety reads.** The single-code convenience
 * fields (`status` / `clinicalStatus` / `verificationStatus`) surface one value: the
 * *preferred*-system coding of a `CodeableConcept`, falling back to the first coding when the
 * standard one is absent (which may be a local/translation code), and the first member written when a
 * non-conformant document repeated a property name. The classified `negations` are derived from
 * **all** codings under any system and **all** members written under a repeated name, so a refutation
 * or a retraction can never hide there. Read a safety decision off `negations` / `retracted`, not off
 * the raw status string, and check `safeToSummarize` before flattening anything.
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
  /** Whether the resource is marked `entered-in-error` (retracted, not data), authoritative. */
  readonly retracted: boolean;
  /** Whether this is a recorded "no known allergy" (SNOMED `716186003`), not an allergy *to* it. */
  readonly noKnownAllergy: boolean;
  /** Every negation the resource asserts (from all codings, any system), the authoritative safety read. */
  readonly negations: readonly NegationKind[];
  /** FHIRPath locations of `modifierExtension`s this library does not understand (fail-closed). */
  readonly unhandledModifierExtensions: readonly string[];
  /**
   * FHIRPath locations where the document wrote a property name more than once, so the element has
   * several values and no rule says which one the sender meant (fail-closed). Empty on every
   * conformant document, since FHIR JSON requires unique property names.
   */
  readonly shadowedProperties: readonly string[];
  /**
   * `false` when the resource must not be flattened: an unhandled `modifierExtension` is present, or
   * a repeated property name left an element with more than one value. Both are cases where a
   * summary would have to assert something this library cannot establish, so it declines instead.
   */
  readonly safeToSummarize: boolean;
}

/**
 * Collect the FHIRPath locations of every `modifierExtension` whose URL this library cannot honor,
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
  return walkSafety(resource, path).modifiers;
}

/**
 * Collect the FHIRPath locations where the document wrote a property name more than once, a deep
 * walk of the whole resource. FHIR JSON requires unique property names (json.html: "Property names
 * SHALL be unique") and expresses repetition with an array, so this is empty for every conformant
 * document; a non-empty result means an element carries several values and RFC 8259 §4 gives no rule
 * for choosing between them.
 *
 * The location names the element, not the individual member: FHIRPath has no way to address "the
 * second `status` member", so a name written twice reports its element's path once.
 *
 * @param resource - The resource model.
 * @param path - The FHIRPath prefix for the resource root (usually its `resourceType`).
 * @returns The locations of the shadowed members, in document order.
 * @example
 * ```ts
 * import { parseResource, shadowedProperties } from "@cosyte/fhir";
 * const { resource } = parseResource(
 *   '{"resourceType":"Observation","status":"final","status":"entered-in-error"}',
 * );
 * shadowedProperties(resource, "Observation"); // ["Observation.status"]
 * ```
 */
export function shadowedProperties(resource: FhirComplex, path: string): string[] {
  return walkSafety(resource, path).shadowed;
}

/** The two fail-closed findings a single walk of the resource collects. */
interface SafetyWalk {
  readonly modifiers: string[];
  readonly shadowed: string[];
}

/** Walk the whole resource once, collecting unhandled modifiers and shadowed property names. */
function walkSafety(resource: FhirComplex, path: string): SafetyWalk {
  const out: SafetyWalk = { modifiers: [], shadowed: [] };
  walkComplex(resource, path, out);
  return out;
}

/**
 * Walk a complex node: check its `modifierExtension` property, then descend into every child.
 *
 * A member shadowed by a repeated property name is walked too. It is part of the document, so a
 * `modifierExtension` sitting inside it has to fail closed exactly as one on the surviving member
 * does; skipping it would make an unhandled modifier hideable behind a duplicate key.
 */
function walkComplex(node: FhirComplex, path: string, out: SafetyWalk): void {
  for (const property of node.properties) visitProperty(property, path, out);
  for (const property of node.duplicates ?? []) {
    out.shadowed.push(`${path}.${property.name}`);
    visitProperty(property, path, out);
  }
}

/** Check one property for an unhandled modifier, then descend into it. */
function visitProperty(property: FhirProperty, path: string, out: SafetyWalk): void {
  if (property.name === "modifierExtension") {
    checkModifierExtension(property.value, path, out.modifiers);
  }
  descend(property.value, `${path}.${property.name}`, out);
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

/** Descend into a node's children (complex → walk; list → each item) to catch nested findings. */
function descend(node: FhirNode, path: string, out: SafetyWalk): void {
  if (isComplex(node)) walkComplex(node, path, out);
  else if (isList(node))
    node.items.forEach((item, index) => descend(item, `${path}[${String(index)}]`, out));
}

/**
 * Read the safety-critical modifier / status / negation elements out of a resource, never dropping
 * one. Works for the six safety resource types; for any other type the modifier
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
  // Detect `refuted` from *any* coding on verificationStatus, not the single surfaced code, a
  // CodeableConcept legitimately carries several codings (a local/translation coding alongside the
  // standard one), and `refuted` may not be first. Reading only the first coding would silently drop
  // the refutation and read the record as positive, the exact harm this layer exists to prevent.
  if (hasCodeAnySystem(verificationStatusNode, REFUTED)) negations.push(REFUTED);
  if (noKnownAllergy) negations.push("no-known-allergy");
  if (doNotPerform === true) negations.push("do-not-perform");
  if (rt === "MedicationStatement" && status === NOT_TAKEN) negations.push(NOT_TAKEN);
  if (rt === "Immunization" && status === NOT_DONE) negations.push(NOT_DONE);

  const { modifiers, shadowed } = walkSafety(resource, rt ?? "$this");

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
    shadowedProperties: shadowed,
    safeToSummarize: modifiers.length === 0 && shadowed.length === 0,
  };
}

/**
 * A refusal raised when a caller tries to flatten or summarize a resource this library cannot
 * summarize honestly: it carries a `modifierExtension` we do not understand (FHIR's `?!` rule forbids
 * ignoring one), or a repeated property name left an element holding several values with no rule for
 * choosing between them. Either way the safe move is to **refuse**, value-free, carrying only the
 * locations.
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
  /** FHIRPath locations that forced the refusal (value-free). */
  readonly locations: readonly string[];
  /**
   * @param locations - The FHIRPath locations that forced the refusal (value-free).
   */
  constructor(locations: readonly string[]) {
    super(
      "Resource cannot be safely summarized: an unhandled modifierExtension or a repeated " +
        `property name leaves an element this library must not flatten (${String(locations.length)} location(s)).`,
    );
    this.name = "FhirSafetyError";
    this.locations = locations;
  }
}

/**
 * Assert a resource is safe to flatten/summarize, throwing {@link FhirSafetyError} when it carries an
 * unhandled `modifierExtension` or a repeated property name. This is the executable form of "carries
 * status **or refuses**": a summary helper calls it first, and never silently drops a modifier it
 * cannot honor, nor summarizes an element whose value the document left ambiguous.
 *
 * @param resource - The resource (or a readout already computed for it).
 * @throws FhirSafetyError when an unhandled `modifierExtension` or a repeated property name is present.
 * @example
 * ```ts
 * import { assertSafeToSummarize, parseResource } from "@cosyte/fhir";
 * const { resource } = parseResource('{"resourceType":"Condition","clinicalStatus":{}}');
 * assertSafeToSummarize(resource); // ok, no unhandled modifier
 * ```
 */
export function assertSafeToSummarize(resource: FhirComplex | SafetyReadout): void {
  const readout = "unhandledModifierExtensions" in resource ? resource : readSafety(resource);
  const locations = [...readout.unhandledModifierExtensions, ...readout.shadowedProperties];
  if (locations.length > 0) throw new FhirSafetyError(locations);
}
