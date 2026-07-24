/**
 * The safety-critical terminology and the primitive semantics for reading it out of the generic
 * model (Phase 3, the fail-closed status & negation spine).
 *
 * FHIR marks a handful of elements with the **modifier flag (`?!`)**, `status`, `clinicalStatus`,
 * `verificationStatus`, `doNotPerform`, and the `not-taken` / `not-done` / `entered-in-error` codes.
 * By FHIR's conformance rules a modifier element is **never an optional read**: a consumer that does
 * not understand it must *refuse* the element, not process it as if the modifier were absent
 * (roadmap §4.8). This module holds the code-system URIs and the negation/retraction concepts those
 * elements carry, plus the small set of value-free readers that pull them out of a {@link FhirComplex}
 * without a typed per-resource model (those arrive in a later phase).
 *
 * **No terminology content is bundled** (roadmap §5, SNOMED/LOINC/RxNorm licensing). What ships here
 * is a *closed* set of spec-defined identifiers: the `entered-in-error` retraction code, the status
 * negation codes (`not-taken`, `not-done`), and SNOMED CT `716186003` "no known allergy", the one
 * positive negation the roadmap names as a first-class concept (a recorded assertion of *no allergy*,
 * which is neither an absent resource nor an allergy *to* something). These are stable spec
 * identifiers, not licensed concept tables.
 *
 * @packageDocumentation
 */

import {
  getProperty,
  isComplex,
  isList,
  isPrimitive,
  resourceType,
  type FhirComplex,
  type FhirNode,
} from "../model/index.js";

/** The SNOMED CT `system` URI (`terminologies-systems.html`). */
export const SNOMED_SCT = "http://snomed.info/sct";

/**
 * SNOMED CT `716186003` "No known allergy", a **positive** record that the patient has no known
 * allergy. Per roadmap §4.3 this is a first-class negation: it is *not* an absent AllergyIntolerance
 * (absence = *unknown*), and it must *not* be read as an allergy to code `716186003`. Other
 * "no known X allergy" substance-specific concepts (drug/food/environmental) are recognized by the
 * same mechanism when terminology work lands; only the roadmap-named concept is encoded here.
 */
export const NO_KNOWN_ALLERGY = "716186003";

/** The `entered-in-error` code, the universal "this record is retracted, not data" value. */
export const ENTERED_IN_ERROR = "entered-in-error";

/** `MedicationStatement.status = not-taken`, a negation: the medication was **not** taken. */
export const NOT_TAKEN = "not-taken";

/** `Immunization.status = not-done`, a negation: the vaccine was **not** given. */
export const NOT_DONE = "not-done";

/** AllergyIntolerance `clinicalStatus` code system (`allergyintolerance.html`). */
export const ALLERGY_CLINICAL_SYSTEM =
  "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical";
/** AllergyIntolerance `verificationStatus` code system, the system ait-1/ait-2 pin. */
export const ALLERGY_VERIFICATION_SYSTEM =
  "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification";
/** Condition `clinicalStatus` code system (`condition.html`), the system con-4 pins. */
export const CONDITION_CLINICAL_SYSTEM = "http://terminology.hl7.org/CodeSystem/condition-clinical";
/** Condition `verificationStatus` code system, the system con-3/con-5 pin. */
export const CONDITION_VERIFICATION_SYSTEM =
  "http://terminology.hl7.org/CodeSystem/condition-ver-status";
/** Condition `category` code system carrying `problem-list-item` (the con-3 trigger). */
export const CONDITION_CATEGORY_SYSTEM = "http://terminology.hl7.org/CodeSystem/condition-category";

/** `refuted`, an AllergyIntolerance/Condition asserted to be *not* present after investigation. */
export const REFUTED = "refuted";

/**
 * The `modifierExtension` URLs this library understands. It is **empty**: no standard
 * `modifierExtension` is handled yet, so *every* `modifierExtension` an instance carries is unknown
 * and the validator fails closed on it ({@link ../validate/safety.js}). The set exists as the seam a
 * later phase widens deliberately, a URL is added here only alongside code that actually honors that
 * modifier's meaning. Widening it silently would re-introduce the exact hazard the FHIR `?!` rule
 * exists to prevent.
 */
export const KNOWN_MODIFIER_EXTENSION_URLS: ReadonlySet<string> = new Set<string>();

/**
 * The six resource types whose modifier/status/negation elements this phase surfaces and whose
 * invariants it enforces (roadmap §4.3–4.8). `MedicationStatement` rides alongside `MedicationRequest`
 * (the roadmap's "MedicationRequest·Statement"). Modifier-extension fail-closed is universal (every
 * resource); retraction and the named invariants are scoped to these types.
 */
export const SAFETY_RESOURCE_TYPES: ReadonlySet<string> = new Set([
  "AllergyIntolerance",
  "Condition",
  "MedicationRequest",
  "MedicationStatement",
  "Observation",
  "Immunization",
  "DiagnosticReport",
]);

/** A (system, code) pair read out of a `Coding`, either half may be absent on a quirky instance. */
export interface Coded {
  readonly system: string | undefined;
  readonly code: string | undefined;
}

/**
 * The string value of a primitive node, or `undefined` for a non-string / non-primitive node.
 *
 * @param node - Any model node, or `undefined`.
 * @returns The string value, or `undefined`.
 * @example
 * ```ts
 * import { getProperty, parseResource, primitiveString } from "@cosyte/fhir";
 * const { resource } = parseResource('{"resourceType":"Observation","status":"final"}');
 * primitiveString(getProperty(resource, "status")); // "final"
 * ```
 */
export function primitiveString(node: FhirNode | undefined): string | undefined {
  if (node !== undefined && isPrimitive(node) && typeof node.value === "string") return node.value;
  return undefined;
}

/**
 * The boolean value of a primitive node, or `undefined` when it is not a boolean primitive.
 *
 * @param node - Any model node, or `undefined`.
 * @returns The boolean value, or `undefined`.
 * @example
 * ```ts
 * import { getProperty, parseResource, primitiveBoolean } from "@cosyte/fhir";
 * const { resource } = parseResource('{"resourceType":"MedicationRequest","doNotPerform":true}');
 * primitiveBoolean(getProperty(resource, "doNotPerform")); // true
 * ```
 */
export function primitiveBoolean(node: FhirNode | undefined): boolean | undefined {
  if (node !== undefined && isPrimitive(node) && typeof node.value === "boolean") return node.value;
  return undefined;
}

/**
 * Every `Coding` reachable from a node that is a `CodeableConcept` (or a list of them). Flattens a
 * repeating element (e.g. `Condition.category`) and tolerates a `CodeableConcept` with no `coding`.
 *
 * @param node - A `CodeableConcept` node, a list of them, or `undefined`.
 * @returns The `(system, code)` pairs, in document order.
 * @example
 * ```ts
 * import { codingsOf, getProperty, parseResource } from "@cosyte/fhir";
 * const { resource } = parseResource(
 *   '{"resourceType":"Condition","clinicalStatus":{"coding":[{"system":"s","code":"active"}]}}',
 * );
 * codingsOf(getProperty(resource, "clinicalStatus")); // [{ system: "s", code: "active" }]
 * ```
 */
export function codingsOf(node: FhirNode | undefined): Coded[] {
  if (node === undefined) return [];
  if (isList(node)) return node.items.flatMap((item) => codingsOf(item));
  if (!isComplex(node)) return [];
  const coding = getProperty(node, "coding");
  const codings = coding === undefined ? [] : isList(coding) ? coding.items : [coding];
  const out: Coded[] = [];
  for (const item of codings) {
    if (!isComplex(item)) continue;
    out.push({
      system: primitiveString(getProperty(item, "system")),
      code: primitiveString(getProperty(item, "code")),
    });
  }
  return out;
}

/**
 * Whether a `CodeableConcept` node carries the given `(system, code)` coding exactly.
 *
 * @param node - A `CodeableConcept` node (or list), or `undefined`.
 * @param system - The code system URI to match.
 * @param code - The code to match.
 * @returns `true` when a coding with that exact system and code is present.
 * @example
 * ```ts
 * import { getProperty, hasCoding, parseResource, SNOMED_SCT } from "@cosyte/fhir";
 * const { resource } = parseResource(
 *   '{"resourceType":"AllergyIntolerance","code":{"coding":[{"system":"http://snomed.info/sct","code":"716186003"}]}}',
 * );
 * hasCoding(getProperty(resource, "code"), SNOMED_SCT, "716186003"); // true
 * ```
 */
export function hasCoding(node: FhirNode | undefined, system: string, code: string): boolean {
  return codingsOf(node).some((c) => c.system === system && c.code === code);
}

/**
 * Whether a `CodeableConcept` node carries the given `code` under **any** system (fail-safe read).
 *
 * @param node - A `CodeableConcept` node (or list), or `undefined`.
 * @param code - The code to match, regardless of system.
 * @returns `true` when any coding carries that code.
 * @example
 * ```ts
 * import { ENTERED_IN_ERROR, getProperty, hasCodeAnySystem, parseResource } from "@cosyte/fhir";
 * const { resource } = parseResource(
 *   '{"resourceType":"Condition","verificationStatus":{"coding":[{"code":"entered-in-error"}]}}',
 * );
 * hasCodeAnySystem(getProperty(resource, "verificationStatus"), ENTERED_IN_ERROR); // true
 * ```
 */
export function hasCodeAnySystem(node: FhirNode | undefined, code: string): boolean {
  return codingsOf(node).some((c) => c.code === code);
}

/**
 * The first `code` on a `CodeableConcept` node, preferring a coding in `preferredSystem` when one is
 * given. Used to surface a `clinicalStatus` / `verificationStatus` value without a typed model.
 *
 * @param node - A `CodeableConcept` node (or list), or `undefined`.
 * @param preferredSystem - A system to prefer a coding from, when several are present.
 * @returns The chosen code, or `undefined` when there is none.
 * @example
 * ```ts
 * import { codeOf, getProperty, parseResource } from "@cosyte/fhir";
 * const { resource } = parseResource(
 *   '{"resourceType":"Condition","clinicalStatus":{"coding":[{"code":"active"}]}}',
 * );
 * codeOf(getProperty(resource, "clinicalStatus")); // "active"
 * ```
 */
export function codeOf(node: FhirNode | undefined, preferredSystem?: string): string | undefined {
  const codings = codingsOf(node);
  if (preferredSystem !== undefined) {
    const preferred = codings.find((c) => c.system === preferredSystem && c.code !== undefined);
    if (preferred?.code !== undefined) return preferred.code;
  }
  return codings.find((c) => c.code !== undefined)?.code;
}

/**
 * Whether a `choice[x]` element is present by any of its type variants, e.g. `choicePresent(obs,
 * "value")` is `true` for `valueQuantity`, `valueString`, … A variant is `<base>` immediately
 * followed by an upper-case letter, so `value` never matches an unrelated `valueless`-style name.
 *
 * @param resource - The resource (or complex) to inspect.
 * @param base - The choice base name (e.g. `"value"`, `"abatement"`).
 * @returns `true` when any `<base><Type>` variant property is present.
 * @example
 * ```ts
 * import { choicePresent, parseResource } from "@cosyte/fhir";
 * const { resource } = parseResource('{"resourceType":"Observation","valueQuantity":{"value":1}}');
 * choicePresent(resource, "value"); // true
 * ```
 */
export function choicePresent(resource: FhirComplex, base: string): boolean {
  return resource.properties.some((property) => {
    if (!property.name.startsWith(base)) return false;
    const rest = property.name.slice(base.length);
    const first = rest.charAt(0);
    return first >= "A" && first <= "Z";
  });
}

/**
 * Whether a resource is **retracted**, marked `entered-in-error` and therefore not to be treated as
 * active data (roadmap §4.8). Read fail-safe: a `status` primitive of `entered-in-error` (Observation,
 * Immunization, DiagnosticReport, MedicationRequest/Statement) **or** a `verificationStatus` carrying
 * `entered-in-error` under any system (AllergyIntolerance, Condition). Over-surfacing a retraction is
 * safe; missing one is not.
 *
 * @param resource - The resource model.
 * @returns `true` when the resource is marked entered-in-error.
 * @example
 * ```ts
 * import { isRetracted, parseResource } from "@cosyte/fhir";
 * const { resource } = parseResource('{"resourceType":"Observation","status":"entered-in-error"}');
 * isRetracted(resource); // true
 * ```
 */
export function isRetracted(resource: FhirComplex): boolean {
  if (primitiveString(getProperty(resource, "status")) === ENTERED_IN_ERROR) return true;
  return hasCodeAnySystem(getProperty(resource, "verificationStatus"), ENTERED_IN_ERROR);
}

/**
 * The `resourceType` of a resource, re-exported through the safety surface for convenience.
 *
 * @param resource - The resource model.
 * @returns The `resourceType` string, or `undefined`.
 * @example
 * ```ts
 * import { parseResource } from "@cosyte/fhir";
 * import { typeOf } from "@cosyte/fhir";
 * typeOf(parseResource('{"resourceType":"Patient"}').resource); // "Patient"
 * ```
 */
export function typeOf(resource: FhirComplex): string | undefined {
  return resourceType(resource);
}
