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
 * That last sentence is load-bearing wherever a document encodes an element in a shape FHIR does not
 * define, because then the element's value is not something this layer may pick. Two such shapes are
 * modeled, and they reach the **same** harm by different routes:
 *
 * - **A repeated property name.** FHIR JSON forbids it (json.html §2.6.2) and RFC 8259 §4 leaves the
 *   winner undefined, so the element genuinely holds two values.
 * - **An array around a `0..1` element.** FHIR JSON writes a single-valued element as a name/value
 *   pair and uses an array only for a repeating element (json.html §2.6.2.2), so `{"status":
 *   ["entered-in-error"]}` is not a `status` this library may read one-value-first-wins, and a
 *   single-value read finds no string in it at all. This is not an exotic input: array-wrapping every
 *   element is ordinary generic XML-to-JSON converter output, and that is precisely how a C-CDA or v2
 *   feed reaches a FHIR surface in practice.
 *
 * Two rules follow, and they apply to both shapes. Each negation read runs over **every** value
 * written for the element it reads, **including through an array wrapper** and including the type gate
 * itself, because a retraction the sender wrote must not go unreported. And the readout stops claiming
 * the resource is summarizable: `safeToSummarize` is `false` with the locations in
 * `shadowedProperties` / `arrayWrappedScalars`, so a caller gets a refusal rather than an affirmative
 * verdict computed over one arbitrary reading of the document.
 *
 * @packageDocumentation
 */

import {
  getAllProperties,
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
  primitiveBooleans,
  primitiveString,
  primitiveStrings,
  REFUTED,
  SAFETY_RESOURCE_TYPES,
  SAFETY_SCALAR_ELEMENTS,
  SNOMED_SCT,
  typesOf,
} from "./codes.js";

/**
 * `MedicationRequest.doNotPerform`, read across every value the document wrote for it and through an
 * array wrapper. A `true` anywhere wins: the element is an instruction *not* to give a medication, so
 * over-surfacing it is safe and missing it is not. Otherwise the first value written is surfaced
 * unchanged.
 */
function readDoNotPerform(resource: FhirComplex): boolean | undefined {
  const values = getAllProperties(resource, "doNotPerform");
  if (values.some((node) => primitiveBooleans(node).includes(true))) return true;
  return primitiveBooleans(values[0])[0];
}

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
 * fields (`resourceType` / `status` / `clinicalStatus` / `verificationStatus`) surface one value: the
 * *preferred*-system coding of a `CodeableConcept`, falling back to the first coding when the
 * standard one is absent (which may be a local/translation code), and the first member written when a
 * non-conformant document repeated a property name or wrapped the element in an array. The classified
 * `negations` are derived from **every** coding under any system and **every** value written for the
 * element each negation reads (`resourceType`, `status`, `verificationStatus`, `code`,
 * `doNotPerform`), including the ones a repeated property name shadowed and the ones inside an array
 * wrapper **around the element**, so a refutation or a retraction cannot hide in the value a
 * single-value lookup skipped, and the type gate cannot hide a type-scoped negation behind a type it
 * did not read. **One wrapper is not covered and is a known gap:** an array around a `Coding.system` /
 * `Coding.code` *inside* a `CodeableConcept` (see {@link arrayWrappedScalars}). Read a safety decision
 * off `negations` / `retracted`, not off the raw status string, and check `safeToSummarize` before
 * flattening anything.
 */
export interface SafetyReadout {
  /**
   * The first `resourceType` the document names, read through a repeated name or an array wrapper, or
   * `undefined` if the resource names none. Convenience only: the type-scoped negation reads consider
   * **every** type named, not just this one.
   */
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
   * FHIRPath locations where a `0..1` safety element (or `resourceType`) arrived wrapped in a JSON
   * array, the shape a generic XML-to-JSON converter emits for every element. Empty on every
   * conformant document, since FHIR JSON uses an array only for a repeating element.
   */
  readonly arrayWrappedScalars: readonly string[];
  /**
   * `false` when the resource must not be flattened: an unhandled `modifierExtension` is present, a
   * repeated property name left an element with more than one value, or a `0..1` safety element
   * arrived array-wrapped. Each is a case where a summary would have to assert something this library
   * cannot establish, so it declines instead.
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
 * walk of the whole resource. FHIR JSON requires unique property names (json.html §2.6.2: "Property
 * names SHALL be unique") and expresses repetition with an array, so this is empty for every
 * conformant document; a non-empty result means an element carries several values and RFC 8259 §4
 * gives no rule for choosing between them.
 *
 * The location names the element, not the individual member: FHIRPath has no way to address "the
 * second `status` member", so one object element reports its path once however many members shadowed
 * the name there. Two *different* objects that each repeat the same name still report separately, and
 * where those objects are themselves duplicates of each other the two locations read identically, for
 * the same reason: the path is all FHIRPath can say.
 *
 * **Scope: object elements.** A repeated name inside a primitive's `_`-sibling (its R4 `Element`
 * metadata, which is `id` and `extension`, never `modifierExtension`) is reported by the reader as a
 * `DUPLICATE_PROPERTY` issue but does not appear here: nothing in that metadata feeds a safety
 * verdict, so it cannot make one wrong.
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

/**
 * Collect the FHIRPath locations where a `0..1` safety element arrived wrapped in a JSON array, a
 * deep walk of the whole resource (so a resource inside `contained` or a Bundle `entry` is covered).
 *
 * FHIR JSON represents a `0..1` element as a name/value pair and a repeating element as an array
 * (json.html §2.6.2.2), so an array here is non-conformant. It matters far more than that sounds:
 * array-wrapping **every** element is ordinary generic XML-to-JSON converter output, which is exactly
 * the route a C-CDA or v2 feed takes to a FHIR surface, and a single-value read of
 * `{"status":["entered-in-error"]}` finds no string at all. The negation reads now see through the
 * wrapper ({@link ../safety/codes.js} `primitiveStrings`), so the retraction is no longer missed; this
 * is the second half, the **refusal to affirm** a positive verdict over a document whose safety-bearing
 * element the sender encoded in a shape FHIR does not define.
 *
 * **Scope: a resource root, and the closed element set this layer reads** (`SAFETY_SCALAR_ELEMENTS`,
 * on a {@link ../safety/codes.js} `SAFETY_RESOURCE_TYPES` root) plus `resourceType` on **any** root.
 * The scoping is not timidity: R4 defines repeating elements under these names elsewhere
 * (`Questionnaire.code`, `ElementDefinition.code`, both `0..*`), so a name-only rule would emit a
 * false error on a conformant document. Deciding cardinality anywhere else needs a per-resource model,
 * which this library does not have and this layer must not grow.
 *
 * **The wrapper this does NOT cover, stated plainly because it is the same defect one level down:**
 * an array around a `Coding.system` / `Coding.code` *inside* a `CodeableConcept`. Those are `0..1`
 * too, a negation written inside one is missed, and no location is reported for it. It is left open
 * on purpose rather than by oversight: unlike the element-level wrapper, those two values feed
 * {@link ../safety/codes.js} `codingsOf`'s `system` x `code` cross-product, so any rule that yields
 * more than one value on either side **manufactures a pair the sender never wrote**, and one of the
 * pairs matched there is a recorded "no known allergy", a *positive* clinical assertion. Missing a
 * retraction withholds information; asserting an absence of allergy does not. It needs its own slice,
 * and the bound is pinned by test rather than left to be rediscovered.
 *
 * @param resource - The resource model.
 * @param path - The FHIRPath prefix for the resource root (usually its `resourceType`).
 * @returns The locations of the array-wrapped scalar elements, in document order.
 * @example
 * ```ts
 * import { arrayWrappedScalars, parseResource } from "@cosyte/fhir";
 * const { resource } = parseResource('{"resourceType":"Observation","status":["entered-in-error"]}');
 * arrayWrappedScalars(resource, "Observation"); // ["Observation.status"]
 * ```
 */
export function arrayWrappedScalars(resource: FhirComplex, path: string): string[] {
  return walkSafety(resource, path).arrayWrapped;
}

/** The three fail-closed findings a single walk of the resource collects. */
interface SafetyWalk {
  readonly modifiers: string[];
  readonly shadowed: string[];
  readonly arrayWrapped: string[];
}

/**
 * Walk the whole resource once, collecting unhandled modifiers, shadowed property names, and
 * array-wrapped `0..1` safety elements. The entry node is a resource root by construction, whether or
 * not it carries a readable `resourceType`.
 */
function walkSafety(resource: FhirComplex, path: string): SafetyWalk {
  const out: SafetyWalk = { modifiers: [], shadowed: [], arrayWrapped: [] };
  walkComplex(resource, path, out, true);
  return out;
}

/**
 * Record every `0..1` safety element this node wrote as an array. Runs only on a resource root: a
 * nested backbone element or datatype has its own cardinalities, which this library does not model.
 */
function checkArrayWrapping(node: FhirComplex, path: string, out: SafetyWalk): void {
  const types = typesOf(node);
  const isSafetyType = types.some((type) => SAFETY_RESOURCE_TYPES.has(type));
  const reported = new Set<string>();
  for (const property of [...node.properties, ...(node.duplicates ?? [])]) {
    const clinical = SAFETY_SCALAR_ELEMENTS.has(property.name);
    // `resourceType` is a JSON string on every resource, not an element with a cardinality, so it is
    // checked whatever the type says, and it is checked first: an array-wrapped type gate is what
    // makes the clinical scoping below unreachable in the first place.
    if (property.name !== "resourceType" && !(clinical && isSafetyType)) continue;
    if (!isList(property.value) || reported.has(property.name)) continue;
    reported.add(property.name);
    out.arrayWrapped.push(`${path}.${property.name}`);
  }
}

/**
 * Walk a complex node: check its `modifierExtension` property, then descend into every child.
 *
 * A member shadowed by a repeated property name is walked too. It is part of the document, so a
 * `modifierExtension` sitting inside it has to fail closed exactly as one on the surviving member
 * does; skipping it would make an unhandled modifier hideable behind a duplicate key.
 */
function walkComplex(node: FhirComplex, path: string, out: SafetyWalk, isRoot = false): void {
  // A resource root is the entry node, or any nested node that carries its own `resourceType` (a
  // `contained` resource, a Bundle `entry.resource`). Only there does this library know a cardinality.
  if (isRoot || getAllProperties(node, "resourceType").length > 0) {
    checkArrayWrapping(node, path, out);
  }
  for (const property of node.properties) visitProperty(property, path, out);
  const reported = new Set<string>();
  for (const property of node.duplicates ?? []) {
    // One location per element, however many members shadowed it: FHIRPath cannot address the
    // individual members, so repeating the same path would be noise a caller cannot act on.
    if (!reported.has(property.name)) {
      reported.add(property.name);
      out.shadowed.push(`${path}.${property.name}`);
    }
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
  // The type gate is read fail-safe: every `resourceType` the document names, including one a
  // repeated name shadowed and one inside an array wrapper. A type-scoped negation is only looked
  // for once the gate says the resource is of that type, so a single-value gate is the narrowest hole
  // in the whole safety claim, and both non-conformant shapes reach it. `rt` (first named) stays the
  // convenience surface and the FHIRPath prefix.
  const types = typesOf(resource);
  const rt = types[0];
  const isType = (type: string): boolean => types.includes(type);
  // The convenience fields surface one value: the first written, and for a CodeableConcept the
  // preferred-system coding. The negation reads below never go through them.
  const status = primitiveStrings(getProperty(resource, "status"))[0];
  const clinicalStatus = codeOf(getProperty(resource, "clinicalStatus"), clinicalSystemFor(rt));
  const verificationStatus = codeOf(
    getProperty(resource, "verificationStatus"),
    verificationSystemFor(rt),
  );

  // Every negation is read across *all* the values the document wrote for its element, and (via
  // `codingsOf`) across all the codings inside each. Two documents motivate this and they are the
  // same hazard: a CodeableConcept legitimately carries several codings and the negation may not be
  // in the first, and a non-conformant document may write an element's name twice and put the
  // negation in the member a single-value lookup skips. Reading one of several written values and
  // reporting the record as positive is the exact harm this layer exists to prevent. Over-surfacing
  // a negation is safe; missing one is not.
  const anyValue = (name: string, match: (node: FhirNode) => boolean): boolean =>
    getAllProperties(resource, name).some(match);

  const doNotPerform = isType("MedicationRequest") ? readDoNotPerform(resource) : undefined;
  const noKnownAllergy =
    isType("AllergyIntolerance") &&
    anyValue("code", (node) => hasCoding(node, SNOMED_SCT, NO_KNOWN_ALLERGY));
  const retracted = isRetracted(resource);

  const negations: NegationKind[] = [];
  if (retracted) negations.push(ENTERED_IN_ERROR);
  if (anyValue("verificationStatus", (node) => hasCodeAnySystem(node, REFUTED))) {
    negations.push(REFUTED);
  }
  if (noKnownAllergy) negations.push("no-known-allergy");
  if (doNotPerform === true) negations.push("do-not-perform");
  if (
    isType("MedicationStatement") &&
    anyValue("status", (n) => primitiveStrings(n).includes(NOT_TAKEN))
  ) {
    negations.push(NOT_TAKEN);
  }
  if (isType("Immunization") && anyValue("status", (n) => primitiveStrings(n).includes(NOT_DONE))) {
    negations.push(NOT_DONE);
  }

  const { modifiers, shadowed, arrayWrapped } = walkSafety(resource, rt ?? "$this");

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
    arrayWrappedScalars: arrayWrapped,
    safeToSummarize: modifiers.length === 0 && shadowed.length === 0 && arrayWrapped.length === 0,
  };
}

/**
 * A refusal raised when a caller tries to flatten or summarize a resource this library cannot
 * summarize honestly: it carries a `modifierExtension` we do not understand (FHIR's `?!` rule forbids
 * ignoring one), a repeated property name left an element holding several values with no rule for
 * choosing between them, or a `0..1` safety element arrived wrapped in a JSON array. Every way the
 * safe move is to **refuse**, value-free, carrying only the locations.
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
      "Resource cannot be safely summarized: an unhandled modifierExtension, a repeated property " +
        "name, or an array-wrapped single-valued element leaves an element this library must not " +
        `flatten (${String(locations.length)} location(s)).`,
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
  const locations = [
    ...readout.unhandledModifierExtensions,
    ...readout.shadowedProperties,
    ...readout.arrayWrappedScalars,
  ];
  if (locations.length > 0) throw new FhirSafetyError(locations);
}
