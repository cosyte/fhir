/**
 * The safety-critical terminology and the primitive semantics for reading it out of the generic
 * model (the fail-closed status & negation spine).
 *
 * FHIR marks a handful of elements with the **modifier flag (`?!`)**, `status`, `clinicalStatus`,
 * `verificationStatus`, `doNotPerform`, and the `not-taken` / `not-done` / `entered-in-error` codes.
 * By FHIR's conformance rules a modifier element is **never an optional read**: a consumer that does
 * not understand it must *refuse* the element, not process it as if the modifier were absent.
 * This module holds the code-system URIs and the negation/retraction concepts those
 * elements carry, plus the small set of value-free readers that pull them out of a {@link FhirComplex}
 * without a typed per-resource model (those are not modeled yet).
 *
 * **No terminology content is bundled** (SNOMED/LOINC/RxNorm licensing). What ships here
 * is a *closed* set of spec-defined identifiers: the `entered-in-error` retraction code, the status
 * negation codes (`not-taken`, `not-done`), and SNOMED CT `716186003` "no known allergy", the one
 * positive negation modeled as a first-class concept (a recorded assertion of *no allergy*,
 * which is neither an absent resource nor an allergy *to* something). These are stable spec
 * identifiers, not licensed concept tables.
 *
 * @packageDocumentation
 */

import {
  getAllProperties,
  isComplex,
  isList,
  isPrimitive,
  resourceType,
  type FhirComplex,
  type FhirNode,
  type PrimitiveValue,
} from "../model/index.js";

/**
 * The elements this layer reads to reach a safety verdict, every one of which is **`0..1` or `1..1`
 * on every resource type this layer owns**, so an array is never a legitimate encoding of one:
 *
 * - `status`: Observation `1..1`, Immunization `1..1`, DiagnosticReport `1..1`,
 *   MedicationRequest `1..1`, MedicationStatement `1..1` (AllergyIntolerance / Condition carry none).
 * - `clinicalStatus`, `verificationStatus`: AllergyIntolerance `0..1`, Condition `0..1`.
 * - `doNotPerform`: MedicationRequest `0..1`.
 * - `code`: AllergyIntolerance `0..1`, Condition `0..1`, Observation `1..1`, DiagnosticReport `1..1`.
 *
 * This is deliberately **not** a per-resource model, and it must not grow into one. It is the
 * cardinality of the closed element set {@link ./status.js} already names, and it is scoped to the
 * {@link SAFETY_RESOURCE_TYPES} at a **resource root** for exactly that reason: R4 does define
 * repeating elements under these names elsewhere (`Questionnaire.code` and `ElementDefinition.code`
 * are both `0..*`), so a name-only, depth-free rule would emit a false error on a conformant
 * document, which the validator's fail-safe contract forbids.
 * *(observation.html, immunization.html, diagnosticreport.html, medicationrequest.html,
 * medicationstatement.html, allergyintolerance.html, condition.html)*
 */
export const SAFETY_SCALAR_ELEMENTS: ReadonlySet<string> = new Set([
  "status",
  "clinicalStatus",
  "verificationStatus",
  "doNotPerform",
  "code",
]);

/** The SNOMED CT `system` URI (`terminologies-systems.html`). */
export const SNOMED_SCT = "http://snomed.info/sct";

/**
 * SNOMED CT `716186003` "No known allergy", a **positive** record that the patient has no known
 * allergy. This is a first-class negation: it is *not* an absent AllergyIntolerance
 * (absence = *unknown*), and it must *not* be read as an allergy to code `716186003`. Other
 * "no known X allergy" substance-specific concepts (drug/food/environmental) are recognized by the
 * same mechanism when terminology work lands; only this concept is encoded here.
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
 * change widens deliberately, a URL is added here only alongside code that actually honors that
 * modifier's meaning. Widening it silently would re-introduce the exact hazard the FHIR `?!` rule
 * exists to prevent.
 */
export const KNOWN_MODIFIER_EXTENSION_URLS: ReadonlySet<string> = new Set<string>();

/**
 * The six resource types whose modifier/status/negation elements this library surfaces and whose
 * invariants it enforces. `MedicationStatement` rides alongside `MedicationRequest`.
 * Modifier-extension fail-closed is universal (every
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
 * Every scalar value a node holds, **reading through an array wrapper**: the node itself when it is a
 * primitive, or each item when a `0..1` element arrived wrapped in a JSON array (recursively, so a
 * doubly-wrapped value is reached too). Non-primitive items are skipped.
 *
 * This is the fail-safe counterpart to {@link primitiveString} / {@link primitiveBoolean}, which
 * return `undefined` for a list because a list is not a primitive. That is the right answer for a
 * convenience read and the wrong one for a safety read: a generic XML-to-JSON converter array-wraps
 * **every** element it emits, which is exactly how a C-CDA or v2 feed reaches a FHIR surface, so
 * `{"status":["entered-in-error"]}` is realistic input in which a single-value read finds nothing and
 * the retraction goes unreported. Over-surfacing a negation is safe; missing one is not.
 */
function scalarValues(node: FhirNode | undefined): PrimitiveValue[] {
  if (node === undefined) return [];
  if (isPrimitive(node)) return node.value === undefined ? [] : [node.value];
  if (isList(node)) return node.items.flatMap((item) => scalarValues(item));
  return [];
}

/**
 * Every string value a node holds, reading through an array wrapper. One value for a conformant
 * primitive, none when absent or non-string, and more than one only for a document that wrapped a
 * `0..1` element in an array.
 *
 * @param node - Any model node, or `undefined`.
 * @returns The string values, in document order.
 * @example
 * ```ts
 * import { list, primitive } from "@cosyte/fhir";
 * primitiveStrings(primitive("final"));                    // ["final"]
 * primitiveStrings(list([primitive("entered-in-error")])); // ["entered-in-error"]
 * ```
 */
export function primitiveStrings(node: FhirNode | undefined): readonly string[] {
  return scalarValues(node).filter((value): value is string => typeof value === "string");
}

/**
 * Every boolean value a node holds, reading through an array wrapper. The boolean counterpart to
 * {@link primitiveStrings}.
 *
 * @param node - Any model node, or `undefined`.
 * @returns The boolean values, in document order.
 * @example
 * ```ts
 * import { list, primitive } from "@cosyte/fhir";
 * primitiveBooleans(list([primitive(true)])); // [true]
 * ```
 */
export function primitiveBooleans(node: FhirNode | undefined): readonly boolean[] {
  return scalarValues(node).filter((value): value is boolean => typeof value === "boolean");
}

/**
 * Every `Coding` reachable from a node that is a `CodeableConcept` (or a list of them). Flattens a
 * repeating element (e.g. `Condition.category`) and tolerates a `CodeableConcept` with no `coding`.
 *
 * Read across **every** value a non-conformant document wrote: all `coding` members, and every
 * `system` x `code` combination inside one `Coding` that repeated either name. A conformant `Coding`
 * has one `system` and one `code`, so it yields exactly one pair and this is a no-op there.
 *
 * **Known gap:** a `system` or `code` wrapped in a JSON array is **not** read (they are `0..1`, so the
 * wrapper is non-conformant, and a negation inside one is missed). Unlike the element-level wrapper,
 * reading it feeds this cross-product and risks manufacturing a `(system, code)` pair the sender never
 * wrote. See the note on the reads themselves.
 *
 * Two consequences, both confined to a document that repeated a name, which is a document
 * {@link ../validate/safety.js} already reports invalid and {@link ./status.js} already refuses to
 * summarize. **(a)** This only ever *adds* pairs, so a check asking "is this code present" (a
 * retraction, a refutation) over-reports rather than misses, which is the direction the safety layer
 * wants. A check asking the opposite, "is the required code absent" (`con-3`, `con-4`, `ait-1`), can
 * therefore be *suppressed* by an added pair. **(b)** When a `Coding` repeated **both** names the
 * pairing is genuinely unrecoverable, so a combination the sender never wrote can appear, and
 * {@link codeOf} with a preferred system may select it. Neither is a silent read: the caller already
 * has the `DUPLICATE_PROPERTY` location.
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
  const codings = getAllProperties(node, "coding").flatMap((coding) =>
    isList(coding) ? [...coding.items] : [coding],
  );
  const out: Coded[] = [];
  for (const item of codings) {
    if (!isComplex(item)) continue;
    // These stay SINGLE-VALUE reads, deliberately, and it is a known gap rather than an oversight.
    // `Coding.system` and `Coding.code` are `0..1` (datatypes.html), so a generic converter wraps them
    // in an array exactly as it wraps the element above them, and a single-value read misses a
    // negation sitting inside that wrapper. Reading through it here is NOT the same change as reading
    // through it on the element, because these two values feed the `system` x `code` CROSS-PRODUCT
    // below: any rule that yields more than one value on either side manufactures a pair the sender
    // never wrote, and one of the pairs this library matches on is a recorded "no known allergy", a
    // POSITIVE clinical assertion. Two attempts at a safe predicate were refuted here (the second
    // still unwrapped `["716186003", null]`, because a FHIR JSON `null` is a real position marker,
    // not padding). The gap is real, its shape is understood, and it needs its own slice with its own
    // grading rather than a third guess bolted onto this one. The bound is pinned in
    // `test/array-wrapped-scalar.test.ts`.
    const systems = getAllProperties(item, "system").map((n) => primitiveString(n));
    const codes = getAllProperties(item, "code").map((n) => primitiveString(n));
    for (const system of systems.length > 0 ? systems : [undefined]) {
      for (const code of codes.length > 0 ? codes : [undefined]) out.push({ system, code });
    }
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
 * active data. Read fail-safe: a `status` primitive of `entered-in-error` (Observation,
 * Immunization, DiagnosticReport, MedicationRequest/Statement) **or** a `verificationStatus` carrying
 * `entered-in-error` under any system (AllergyIntolerance, Condition). Over-surfacing a retraction is
 * safe; missing one is not.
 *
 * "Fail-safe" is read across **every** value the document wrote for those elements, not just the one
 * a single-value lookup returns, and **through an array wrapper around the element**
 * ({@link primitiveStrings}). Three documents motivate that and they are one hazard: a `CodeableConcept`
 * legitimately carries several codings and the retraction may not be in the first; a non-conformant
 * document may write `status` twice and put the retraction in the one that lost; and a generic
 * XML-to-JSON converter wraps the `0..1` `status` in an array, where a single-value read finds no
 * string at all. Each ends the same way: reading one of several written values, or none, and
 * reporting the record as live.
 *
 * **The one wrapper this does not see through** is an array around a `Coding.system` / `Coding.code`
 * *inside* a `CodeableConcept`. A retraction written there is missed. See {@link codingsOf}.
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
  const retractedStatus = getAllProperties(resource, "status").some((node) =>
    primitiveStrings(node).includes(ENTERED_IN_ERROR),
  );
  if (retractedStatus) return true;
  return getAllProperties(resource, "verificationStatus").some((node) =>
    hasCodeAnySystem(node, ENTERED_IN_ERROR),
  );
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

/**
 * Every resource type the document names, the **fail-safe** read of the type gate: all `resourceType`
 * members (including one a repeated name shadowed) and, for each, every value inside an array
 * wrapper. Returns one entry for a conformant resource, none when `resourceType` is absent, and more
 * than one only for a document FHIR JSON already forbids.
 *
 * {@link typeOf} is the strict single-value read and stays that way, because a structural verdict
 * should reject an unreadable type rather than guess one. This is the read a **negation** check uses.
 * A type-scoped negation (`MedicationStatement.status = not-taken`, `Immunization.status = not-done`,
 * AllergyIntolerance's "no known allergy") is only looked for once the type gate says the resource is
 * of that type, so a single-value type read makes the gate the narrowest hole in the whole safety
 * claim: `{"resourceType":"Observation","resourceType":"MedicationStatement","status":"not-taken"}`
 * and `{"resourceType":["MedicationStatement"],"status":["not-taken"]}` both report **no negation at
 * all** when the type is read one-value-first-wins. Considering every named type over-surfaces a
 * negation on a document that is already reported non-conformant, which is the safe direction.
 *
 * @param resource - The resource model.
 * @returns The resource type names the document wrote, in document order.
 * @example
 * ```ts
 * import { parseResource } from "@cosyte/fhir";
 * const { resource } = parseResource('{"resourceType":["MedicationStatement"],"status":"not-taken"}');
 * typesOf(resource); // ["MedicationStatement"], where `typeOf` reads `undefined`
 * ```
 */
export function typesOf(resource: FhirComplex): readonly string[] {
  return getAllProperties(resource, "resourceType").flatMap((node) => [...primitiveStrings(node)]);
}
