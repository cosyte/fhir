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
 * **This is the array-wrapper report's table, not the negation read's window.** The `doNotPerform`
 * negation is read at every resource root of every type ({@link ./status.js} `checkNegations`),
 * which needs no cardinality because reading a value can only add a negation. Reporting a wrapper is
 * an `error`, so it stays on the cardinalities above; a `ServiceRequest.doNotPerform` arriving
 * array-wrapped is therefore read through the wrapper and surfaced, and the wrapper itself is not
 * reported. That residual is declared, not overlooked.
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

/**
 * The subset of {@link SAFETY_SCALAR_ELEMENTS} that is `CodeableConcept`-valued, so a `Coding` sits
 * one level inside it and the `0..1` cardinality of `Coding.system` / `Coding.code` (datatypes.html)
 * is knowable there without a per-resource model.
 *
 * `status` is a `code` primitive and `doNotPerform` a `boolean`, so neither carries a `Coding`.
 * `clinicalStatus` / `verificationStatus` are `CodeableConcept` on AllergyIntolerance and Condition,
 * and `code` is `CodeableConcept` on every type that defines it here (AllergyIntolerance, Condition,
 * Observation, DiagnosticReport -- count them off the set, never off this sentence). Unlike the
 * element names themselves, this needs no further scoping to stay false-positive-free: `Coding` is a
 * datatype, and its `system` and `code` are `0..1` in every resource that uses it.
 *
 * **It is therefore not the whole of the `Coding`-level report, and must not be read as it.** This
 * set is the type-scoped half, riding the cardinality table. The un-gated half is
 * {@link NEGATION_CODE_READS}'s `codings` rows at every resource root of any type, which exists
 * because the negation reads are not type-scoped either; the same datatype cardinality licenses
 * both, and only the type-scoped half needs the element names to be scoped at all.
 */
export const SAFETY_CODEABLE_ELEMENTS: ReadonlySet<string> = new Set([
  "clinicalStatus",
  "verificationStatus",
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

/**
 * The `not-taken` status code, a negation: "the medication was not consumed by the patient". R4
 * spells it **only** as a `status` value and defines it in **only** the `MedicationStatement.status`
 * code system (`medication-statement-status`), where that sentence is the code's own definition. Read
 * off `status` on any resource type, for the reasons on {@link statusSpells}.
 */
export const NOT_TAKEN = "not-taken";

/**
 * The `not-done` status code, a negation: the event did not happen. R4 spells it **only** as a
 * `status` value and defines it in the `event-status` and `medication-admin-status` code systems,
 * which define it as "terminated prior to any activity beyond preparation" and "terminated prior to
 * any impact on the subject". The R4 resources whose `status` binds a value set containing it are
 * `Procedure`, `Communication`, `Media`, `MedicationAdministration` and `Immunization`. Read off
 * `status` on any resource type, for the reasons on {@link statusSpells}.
 */
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
 * The resource types whose **type-scoped** modifier/status/negation elements this library surfaces
 * and whose invariants it enforces. `MedicationStatement` rides alongside `MedicationRequest`.
 * Count them off the set, never off a sentence: a written-down count here read "six" over a set of
 * seven for days, and reached `dist/` saying so.
 *
 * Several reads are deliberately **not** scoped by it, because they can only add a finding: the
 * `modifierExtension` fail-closed check, the `entered-in-error` retraction, the `refuted`
 * verification status, the `doNotPerform` instruction, and the `not-done` / `not-taken` status
 * negations ({@link statusSpells}). `doNotPerform` used to be
 * gated on `MedicationRequest` alone, and `not-done` on `Immunization` alone; the types each gate
 * left out were neither read nor reported, so a conformant `ServiceRequest` carrying an instruction
 * *not* to perform the service, and a conformant `Procedure` recording that it was **not** done, both
 * read as carrying no negation at all. Those same reads run at **every resource root** the document
 * carries ({@link ./status.js} `checkNegations`), not only the resource handed in.
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
 * The boolean a primitive value spells, whichever reader built the model, or `undefined` when it
 * spells none.
 *
 * The JSON reader hands over a JS `boolean`; the XML reader is schema-free and hands over the exact
 * text of the `value` attribute, because FHIR XML carries no datatype for it to key on (a
 * primitive's value travels in that attribute, `xml.html` §2.6.1). Both spell the same boolean, so
 * both are read here.
 *
 * Reading only the first shape made `undefined` mean two different things: "the document wrote no
 * boolean here" and "the boolean is right there and I did not read it". The second one lost a
 * `MedicationRequest.doNotPerform` across this package's own XML round trip, so an instruction *not*
 * to give a medication read as absent under an empty issue list.
 *
 * **The text recognised is exactly `true` and `false`**, the whole of the R4 `boolean` lexical space
 * (`datatypes.html`) and nothing beside it. `"TRUE"`, `"1"`, `"yes"` and `" true"` read as no
 * boolean, because coercing them would author a value the sender did not spell, and `"1"` / `"Y"`
 * arrive on the wire meaning both a boolean's `true` and, elsewhere, its opposite. **That refusal is
 * no longer silent** where the safety layer makes it: {@link hasUnreadableBoolean} is its exact
 * complement, and the caller reports the element's location so the value's presence survives the
 * read that could not use it. The refusal is still silent for {@link primitiveBoolean}'s callers.
 *
 * The model records no provenance, so a JSON document that spelled `{"doNotPerform":"true"}` is read
 * the same way; FHIR JSON says a boolean is a JSON boolean, so that document is non-conformant
 * either way.
 *
 * **Only {@link primitiveBooleans}, the safety read, goes through this.** {@link primitiveBoolean},
 * the convenience read, deliberately still matches a JS `boolean` alone, and the asymmetry is the
 * point: a safety read can only *add* a negation with a value it did not have before, while the
 * convenience read reaches `ElementDefinition.mustSupport`, whose snapshot merge treats `undefined`
 * as *inherit from the base element*, so reading a value that was previously absent lets a
 * differential's `false` **remove** a `MUST_SUPPORT_ABSENT` the base raised. That was measured, not
 * feared. It is the same safety-versus-convenience split that already separates
 * {@link primitiveStrings} from {@link primitiveString}.
 */
function booleanOf(value: PrimitiveValue): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

/**
 * The boolean value of a primitive node, or `undefined` when it is not a boolean primitive.
 *
 * **The convenience read, and it matches a JS `boolean` alone.** It does *not* read the lexical
 * `true` / `false` the schema-free XML reader keeps as text; {@link primitiveBooleans}, the safety
 * read, does. {@link booleanOf} states why the two differ, and it is not an oversight: this read
 * reaches `ElementDefinition.mustSupport`, where `undefined` means *inherit*, so filling in a value
 * here can **remove** a finding, the one direction a fail-safe layer must not move in without
 * measuring it. Two package-private readers of one datatype accepting different text is a hazard in
 * itself: **if either is ever exported, resolve the split rather than shipping both.**
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
 * {@link primitiveStrings}, and **the safety read**: unlike {@link primitiveBoolean} it takes the
 * boolean off either wire format's model, a JS `boolean` from the JSON codec or the lexical `true` /
 * `false` the schema-free XML reader keeps as text ({@link booleanOf} states what text is
 * deliberately *not* recognised, and why the two reads differ).
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
  return scalarValues(node).flatMap((value) => {
    const bool = booleanOf(value);
    return bool === undefined ? [] : [bool];
  });
}

/**
 * Whether a node holds a **written value** that {@link primitiveBooleans} looked at and could not
 * read as a boolean.
 *
 * The exact complement of the read: it walks the same values through the same array wrapper and asks
 * of each one the same question, so a `true` here means at least one value the safety read saw is
 * missing from what it returned. That coupling is the point: the caller reports a location for
 * precisely the values the read declined, and cannot drift from it by growing a second rule.
 *
 * **It is value-free**: the answer is a `boolean`, never the text, so a caller building a diagnostic
 * out of it has no document content to echo.
 *
 * **A value must be written for this to be `true`.** A primitive carrying only `id` / `extension`
 * metadata has no value (`value` is `undefined`, json.html §2.6.2.3), and a `0..1` element the
 * sender left out has no node, so neither answers `true`. R4 spells a `boolean` as `true` or `false`
 * (datatypes.html), so this is `false` for every conformant document.
 *
 * **It answers about a value, not about a shape.** A `boolean` element written as an object or as an
 * empty array holds no value at all, so it is not reported here; those shapes are a separate gap,
 * pinned in `test/xml-unreadable-boolean.test.ts`.
 *
 * @param node - Any model node, or `undefined`.
 * @returns `true` when at least one written value there is outside the boolean lexical space.
 * @example
 * ```ts
 * import { primitive } from "@cosyte/fhir";
 * hasUnreadableBoolean(primitive("1"));    // true  (R4 spells a boolean `true` / `false`)
 * hasUnreadableBoolean(primitive("true")); // false (read, so nothing was left over)
 * ```
 */
export function hasUnreadableBoolean(node: FhirNode | undefined): boolean {
  return scalarValues(node).some((value) => booleanOf(value) === undefined);
}

/**
 * The members a `CodeableConcept` defines (`coding`, `text`, datatypes.html) beside the two every
 * element carries (`id`, `extension`). **This is not a datatype model and must not grow into one**:
 * it is the smallest question that separates a `CodeableConcept` a sender wrote from a shape no
 * datatype FHIR spells at a `status`.
 */
const CODEABLE_CONCEPT_MEMBERS: ReadonlySet<string> = new Set([
  "coding",
  "text",
  "id",
  "extension",
]);

/**
 * Whether an element holds **content at a position no datatype FHIR spells there can hold**: a
 * primitive whose written value is not a string, or a complex carrying any member outside
 * `{coding, text, id, extension}` or no member at all. Read through an array wrapper, position by position, exactly as the string read
 * walks it.
 *
 * **Two datatypes reach a root `status`, and the refusal has to clear both.** R4 spells it a `code`
 * on the overwhelming majority of types, and a **`CodeableConcept`** on
 * `MedicinalProductAuthorization` and `SubstanceSpecification`; R5 adds `ClinicalUseDefinition`,
 * `DeviceAssociation` (`1..1`, mandatory), `MedicinalProductDefinition`, `PackagedProductDefinition`,
 * `RegulatedAuthorization` and `SubstanceDefinition`; DSTU2 spells every one of them a `code`. A rule
 * keyed on "the string read took nothing" therefore **refuses a conformant document**, because a
 * conformant `CodeableConcept` yields no string to a `code` read, and a `CodeableConcept` carrying
 * only `text` yields nothing to a coding read either. That was measured on the published R4
 * `MedicinalProductAuthorization` example, not feared.
 *
 * **So the question asked here is about the SHAPE, not about which reader succeeded.** A complex
 * **all of whose members** are ones FHIR spells at this position (`coding`, `text`, `id`,
 * `extension`) is left alone, whether or not any code came out of it. A complex carrying **any**
 * member outside that set (`{"value":"not-done"}`, the member a generic converter makes of FHIR
 * XML's `value` attribute, and `{"id":"s1","value":"not-done"}` where it carried the primitive's own
 * metadata across beside it) is spellable as neither datatype, so no reading of it was declined:
 * there was nothing there either datatype could hold. **The polarity is load-bearing**: exempting a
 * shape for carrying *one* legal member would exempt exactly those converter outputs. An empty
 * complex is reported too, `ele-1` forbidding an element with no value, children or extension.
 *
 * **The direction of the scoping is the point.** An unscoped rule flips a conformant document from
 * summarizable to refused, which is the one direction a fail-safe layer must not move in without
 * evidence. That is why this is scoped where the negation *read* beside it deliberately is not: a
 * read can only **add** a negation, so widening it is free, while a refusal raised over a document
 * this library read correctly and completely costs a caller a summary it was entitled to.
 *
 * **A declared limit in the safe direction:** if some version spells a root `status` as a third
 * datatype whose members are none of these, a conformant document of that type would be reported.
 * The census above found none in R4, R5 or DSTU2. A shape **all of whose members** are ones FHIR
 * spells here is conversely never reported, even where the type spells `status` a `code`, so a code
 * buried
 * under `{"coding":{...}}` at a `Procedure` stays silent. Both are pinned rather than described.
 *
 * **A primitive carrying no value is not reported**, because it is not content the read stepped over:
 * a `code` whose value is absent while its `_`-sibling carries a `data-absent-reason` extension is
 * conformant (json.html §2.6.2.3), and both readers model it as a primitive with an `undefined`
 * value. The XML reader models a `value` attribute beside `id` / `extension` children as a primitive
 * too, so a conformant `<status value="not-done"><extension …/></status>` is read, not reported.
 *
 * **It reports; nothing anywhere reads through it.** Descending into the object to find a string
 * would author a reading FHIR JSON does not define. `code` is a JSON string (json.html §2.6.0), and
 * `{"value":"…"}` is the *XML* spelling of a primitive, not a JSON one, so a reader that resolved it
 * would hand a caller a negation out of an encoding no version of FHIR spells. The gap this closes
 * is the **silence**, not the strictness, which is the same disposition {@link isNearMissCode} takes
 * on the case and whitespace near misses.
 *
 * @param node - Any model node, or `undefined`.
 * @returns `true` when at least one position there holds content no datatype FHIR spells can hold.
 * @example
 * ```ts
 * import { complex, primitive } from "@cosyte/fhir";
 * const written = complex([{ name: "value", value: primitive("not-done") }]);
 * hasUnreadableCode(written);               // true  (spellable as neither datatype)
 * hasUnreadableCode(primitive("not-done")); // false (read, so nothing was stepped over)
 * ```
 * @internal
 */
export function hasUnreadableCode(node: FhirNode | undefined): boolean {
  if (node === undefined) return false;
  // Position by position, so a wrapped shape is reached exactly as `scalarValues` reaches a wrapped
  // primitive. An empty wrapper holds no position and therefore no content, and says `false`.
  if (isList(node)) return node.items.some((item) => hasUnreadableCode(item));
  if (isPrimitive(node)) return node.value !== undefined && typeof node.value !== "string";
  if (isComplex(node)) {
    // ANY member outside the set, not "none inside it". The other polarity exempts a shape as soon
    // as it carries one legal member, so `{"id":"s1","value":"not-done"}` and
    // `{"value":"not-done","extension":[...]}` - the very converter output this reports, with the
    // primitive's own `id` / `extension` metadata carried across beside the value - would read as
    // clean. A conformant `CodeableConcept` has NO member outside the set, so this is empty on one
    // whatever else it carries.
    //
    // `properties` alone is the whole document here, so a duplicate key cannot hide a member: a
    // repeated name keeps its FIRST member in `properties` and puts only the later ones in
    // `duplicates`, so every name in `duplicates` is present here too. Scanning both was written
    // first and measured DEAD, so it is not shipped: an unreachable branch is one a mutation cannot
    // red and a reader cannot check.
    if (node.properties.some((property) => !CODEABLE_CONCEPT_MEMBERS.has(property.name)))
      return true;
    // No member at all is a shape FHIR spells nowhere either: an element present in a resource SHALL
    // carry a value, children defined for its type, or an extension (ele-1). That grounds THIS arm
    // only; it is not a general ele-1 check, and `{"id":"s1"}` / `{"coding":[]}` violate ele-1 too
    // and are deliberately left alone, their members being ones FHIR spells here.
    return node.properties.length === 0;
  }
  // Any shape the model gains later reports rather than reading as clean.
  return true;
}

/**
 * The one value a `Coding.system` / `Coding.code` member holds, **reading through a single-position
 * array wrapper** and returning `undefined` for anything else.
 *
 * `Coding.system` and `Coding.code` are `0..1` (datatypes.html), so a generic XML-to-JSON converter
 * array-wraps them exactly as it wraps the element above them, and a plain {@link primitiveString}
 * read finds no string in the wrapper at all. That is how a refuted allergy, a recorded "no known
 * allergy" and a retracted Condition all read as live.
 *
 * **This is deliberately not the recursive, every-value read {@link primitiveStrings} performs**, and
 * the asymmetry is the whole point. These two values feed {@link codingsOf}'s `system` x `code`
 * cross-product, so a rule yielding more than one value on either side would pair a `system` the
 * sender wrote in one array position with a `code` it wrote in another and **manufacture a pair the
 * sender never wrote**. One pair matched downstream is SNOMED `716186003` "no known allergy", a
 * *positive* clinical assertion, so inventing it claims a patient has no known allergy over a record
 * naming an allergen. Missing a retraction withholds information; asserting an absence of allergy does
 * not, so the two directions are not equally safe.
 *
 * The rule that keeps both directions safe at once is **at most one value per written member**: the
 * cross-product's arity stays exactly what it is for an unwrapped document (one value per member of
 * each name), so unwrapping cannot add a pair, only fill in a value that was `undefined`. A pair this
 * yields is a `system` and a `code` the sender wrote in **the same, only** position of the same
 * `Coding`, which is the pair it wrote.
 *
 * "One value" therefore counts **array positions, not strings**. A FHIR JSON `null` inside a primitive
 * array is a real position whose value is absent and whose `_`-sibling may still carry an extension
 * (json.html §2.6.2.3), not padding to be ignored, so `["716186003", null]` is two positions and is
 * refused here. Counting the strings instead would read it as single-valued and pair `716186003` with
 * a system written in a different position, which is exactly the invented pair.
 *
 * A wrapper this refuses is not silently dropped: the element is reported to the caller at
 * `SafetyReadout.arrayWrappedScalars` and as an `ARRAY_WRAPPED_SCALAR` error, so the resource is
 * never affirmed as summarizable over a value this could not read.
 */
function codingScalar(node: FhirNode | undefined): string | undefined {
  if (node === undefined) return undefined;
  if (isList(node)) return node.items.length === 1 ? codingScalar(node.items[0]) : undefined;
  return primitiveString(node);
}

/**
 * Every `Coding` reachable from a node that is a `CodeableConcept` (or a list of them). Flattens a
 * repeating element (e.g. `Condition.category`) and tolerates a `CodeableConcept` with no `coding`.
 *
 * Read across **every** value a non-conformant document wrote: all `coding` members, and every
 * `system` x `code` combination inside one `Coding` that repeated either name. A conformant `Coding`
 * has one `system` and one `code`, so it yields exactly one pair and this is a no-op there.
 *
 * Each `system` / `code` member contributes **at most one value** ({@link codingScalar}), read through
 * a single-position array wrapper but never through a multi-position one. That bound is what makes the
 * wrapper safe to read at all: it holds the cross-product to one pair per (`system` member, `code`
 * member) combination, so this **never invents a `(system, code)` pair the sender did not write**. A
 * multi-position wrapper is left unread on purpose, and reported instead.
 *
 * Precisely: **a single-position wrapper is transparent.** The pairs this yields for a document are
 * exactly the pairs it yields for the same document with those wrappers removed. So unwrapping decides
 * nothing on its own; it restores the reading the sender's pre-conversion document had.
 *
 * Two consequences, both confined to a document that repeated a name, which is a document
 * {@link ../validate/safety.js} already reports invalid and {@link ./status.js} already refuses to
 * summarize. **(a)** Repeating a name only ever *adds* pairs, so a check asking "is this code present"
 * (a retraction, a refutation) over-reports rather than misses, which is the direction the safety layer
 * wants. A check asking the opposite, "is the required code absent" (`con-3`, `con-4`, `ait-1`), can
 * therefore be *suppressed* by an added pair. **(b)** When a `Coding` repeated **both** names the
 * pairing is genuinely unrecoverable, so a combination the sender never wrote can appear, and
 * {@link codeOf} with a preferred system may select it. Neither is a silent read: the caller already
 * has the `DUPLICATE_PROPERTY` location. Transparency means a wrapper adds no *new* case here: a
 * wrapped repeated name reads as the unwrapped repeated name already did, and the invention is the
 * repetition's, not the wrapper's.
 *
 * Reading a wrapper can also *remove* a finding, and that is the same effect from the other side: a
 * `verificationStatus` of `entered-in-error` written inside a wrapper satisfies `ait-1` and it is the
 * unread version that emitted the false error. It cannot turn a document valid, because the wrapper
 * that made the value readable here is itself an `ARRAY_WRAPPED_SCALAR` error on the very same
 * `Coding` ({@link ./status.js} `arrayWrappedScalars`).
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
  return collectCodings(node, false);
}

/**
 * {@link codingsOf}, reading each `Coding.system` / `Coding.code` through a **single-position** array
 * wrapper ({@link codingScalar}).
 *
 * **Module-internal on purpose, and it is not exported from the package.** The unwrap is only sound
 * where the wrapper is also *reported*. **Read scope must equal report scope.** A read that unwrapped
 * where nothing reports would resolve a clinical code out of an encoding FHIR JSON does not define
 * and hand it to a caller with no diagnostic anywhere, which is how an earlier revision of this
 * change **retired a true `VITAL_SIGN_UNIT_NONCONFORMANT` error and flipped a document from
 * `valid: false` to `valid: true`**: `requiredUnitsFor` reads `Observation.component[i].code`, which
 * is a backbone element that nothing reports, and the newly-readable first `Coding` won the "first
 * LOINC coding with a units entry" race.
 *
 * **The report is in two halves and they are scoped differently, because they are grounded
 * differently**, so this is stated as the pair it is rather than as one window:
 *
 * - The **type-scoped** half, `clinicalStatus` / `verificationStatus` / `code`
 *   ({@link SAFETY_CODEABLE_ELEMENTS}) on a {@link SAFETY_RESOURCE_TYPES} resource root, which is
 *   where the type-gated root reads and the invariant checks look.
 * - The **un-gated** half, every element {@link NEGATION_CODE_READS} marks `codings`, at **every**
 *   resource root of **any** type, which is where the negation reads look. Those reads are not
 *   type-scoped, so their report is not either; what licenses that is `Coding` being a *datatype*,
 *   with `system` and `code` `0..1` wherever a `Coding` appears, so no cardinality question about
 *   the enclosing resource arises at all.
 *
 * **One caller is still outside both halves, and it is named rather than claimed away:**
 * {@link ./status.js} `readSafety` fills its `clinicalStatus` convenience field from here on **any**
 * resource root, because `clinicalSystemFor` chooses a *preferred system* and gates nothing. So a
 * `clinicalStatus` on a type the cardinality table does not know is unwrapped where nothing reports,
 * and a multi-position wrapper there is declined where nothing reports either. It reaches only that
 * one convenience field: never {@link ./status.js} `SafetyReadout.negations`, never `valid`, and
 * never `noKnownAllergy`, whose read *is* type-gated. That is the surviving half of this rule's
 * original gap and it is an open residual, not a property of the design.
 *
 * Every other coding read in the library stays on {@link codingsOf} and behaves exactly as it did
 * before this rule existed. That under-reads a wrapper nothing reports, which is the safe direction
 * and the pre-existing behaviour; widening it means widening the report first, in the same change.
 *
 * @param node - A `CodeableConcept` node, a list of them, or `undefined`.
 * @returns The `(system, code)` pairs, in document order.
 * @example
 * ```ts
 * // internal to this package; `verificationStatus` is a windowed element
 * safetyCodingsOf(getProperty(condition, "verificationStatus"));
 * ```
 */
export function safetyCodingsOf(node: FhirNode | undefined): Coded[] {
  return collectCodings(node, true);
}

/**
 * The shared engine behind {@link codingsOf} and {@link safetyCodingsOf}. `unwrap` selects whether a
 * `Coding.system` / `Coding.code` member is read through a single-position array wrapper or, as
 * before this rule, only as a bare primitive.
 */
function collectCodings(node: FhirNode | undefined, unwrap: boolean): Coded[] {
  if (node === undefined) return [];
  if (isList(node)) return node.items.flatMap((item) => collectCodings(item, unwrap));
  if (!isComplex(node)) return [];
  const read = unwrap ? codingScalar : primitiveString;
  const codings = getAllProperties(node, "coding").flatMap((coding) =>
    isList(coding) ? [...coding.items] : [coding],
  );
  const out: Coded[] = [];
  for (const item of codings) {
    if (!isComplex(item)) continue;
    // FHIR-CODING-SCALAR-WRAPPER. These read through an array wrapper, but ONLY a single-position
    // one, and the restriction is the whole safety argument rather than caution. `Coding.system` and
    // `Coding.code` feed the `system` x `code` CROSS-PRODUCT below, so a rule yielding more than one
    // value on either side manufactures a pair the sender never wrote, and one pair matched
    // downstream is a recorded "no known allergy", a POSITIVE clinical assertion. `codingScalar`
    // returns AT MOST ONE value per written member, so these two arrays have exactly the lengths they
    // had when a wrapper read as `undefined`: the cross-product cannot grow, and unwrapping can only
    // fill in a value, never add a pair. Two earlier attempts were refuted for breaking exactly that
    // bound; the second counted strings rather than array positions, and a FHIR JSON `null` is a real
    // position marker, not padding, so `["716186003", null]` unwrapped wrongly. `codingScalar` counts
    // positions. The property is pinned in `test/array-wrapped-scalar.test.ts`.
    const systems = getAllProperties(item, "system").map((n) => read(n));
    const codes = getAllProperties(item, "code").map((n) => read(n));
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
  return pickCode(codingsOf(node), preferredSystem);
}

/** Choose the surfaced code from a set of codings, preferring `preferredSystem` when one is given. */
function pickCode(codings: readonly Coded[], preferredSystem?: string): string | undefined {
  if (preferredSystem !== undefined) {
    const preferred = codings.find((c) => c.system === preferredSystem && c.code !== undefined);
    if (preferred?.code !== undefined) return preferred.code;
  }
  return codings.find((c) => c.code !== undefined)?.code;
}

/**
 * {@link hasCoding} over {@link safetyCodingsOf}. Module-internal; only for a windowed element (see
 * {@link safetyCodingsOf} for why the window is not optional).
 *
 * @param node - A `CodeableConcept` node (or list), or `undefined`.
 * @param system - The code system URI to match.
 * @param code - The code to match.
 * @returns `true` when a coding with that exact system and code is present.
 * @example
 * ```ts
 * safetyHasCoding(getProperty(allergy, "code"), SNOMED_SCT, NO_KNOWN_ALLERGY);
 * ```
 */
export function safetyHasCoding(node: FhirNode | undefined, system: string, code: string): boolean {
  return safetyCodingsOf(node).some((c) => c.system === system && c.code === code);
}

/**
 * {@link hasCodeAnySystem} over {@link safetyCodingsOf}. Module-internal, windowed elements only.
 *
 * @param node - A `CodeableConcept` node (or list), or `undefined`.
 * @param code - The code to match, regardless of system.
 * @returns `true` when any coding carries that code.
 * @example
 * ```ts
 * safetyHasCodeAnySystem(getProperty(condition, "verificationStatus"), ENTERED_IN_ERROR);
 * ```
 */
export function safetyHasCodeAnySystem(node: FhirNode | undefined, code: string): boolean {
  return safetyCodingsOf(node).some((c) => c.code === code);
}

/**
 * {@link codeOf} over {@link safetyCodingsOf}. Module-internal, windowed elements only.
 *
 * @param node - A `CodeableConcept` node (or list), or `undefined`.
 * @param preferredSystem - A system to prefer a coding from, when several are present.
 * @returns The chosen code, or `undefined` when there is none.
 * @example
 * ```ts
 * safetyCodeOf(getProperty(condition, "clinicalStatus"), CONDITION_CLINICAL_SYSTEM);
 * ```
 */
export function safetyCodeOf(
  node: FhirNode | undefined,
  preferredSystem?: string,
): string | undefined {
  return pickCode(safetyCodingsOf(node), preferredSystem);
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
 * Whether the resource's own `status` element spells `code`, across **every** value the document
 * wrote for it: a member a repeated property name shadowed, and a value inside an array wrapper
 * ({@link primitiveStrings}): because a negation must not become invisible by arriving second under
 * a duplicate key or inside a wrapper a single-value read finds no string in.
 *
 * **There is no resource-type gate on this read, and its absence is grounded per code rather than
 * inherited.** The argument that drops a gate on an *element* (`doNotPerform`, which no R4 type
 * defines as anything but an instruction not to act) does not carry over for free to a *status code*,
 * because `status` is one element name whose value set is defined per resource type, so "which types
 * carry this code" is a real question with a real answer. It was answered against the published R4
 * definitions rather than by analogy, and both codes this layer classifies answer it the same way:
 *
 * - **Each code is defined only as a `status` value.** No R4 element outside `status` binds a value
 *   set containing `not-done` or `not-taken`, so a wider read cannot meet the code doing a different
 *   job somewhere else.
 * - **Every R4 code system that defines the code defines it as the negation.** `not-done` is defined
 *   in `event-status` and `medication-admin-status`, `not-taken` in `medication-statement-status`, and
 *   each definition says the thing did not happen. So reading the code on a type nobody enumerated
 *   cannot *mis*-read it; it can only surface it somewhere a census did not predict.
 * - **A gate would be short, and measurably so.** `not-done` is carried by the `status` of `Procedure`,
 *   `Communication`, `Media`, `MedicationAdministration` and `Immunization` in R4: this library gated
 *   it on `Immunization` alone, so four conformant resource types read as carrying no negation at all.
 * - **A census is a fact about one published version, and this reader tolerates others.** The set is
 *   not the same in R5 (which carries the code on types R4 has no such resource for, and drops
 *   `not-taken` from `MedicationStatement.status` entirely), so a list keyed to R4 is blind on a
 *   document this library will still read.
 *
 * The direction argument then applies exactly as it does to the element-scoped reads: this can only
 * **add** a negation, never retire a finding, never flip `valid` (no validator reads `negations`),
 * and never turn a refusal into an affirmation. A document spelling the code on a type whose value set
 * excludes it is already non-conformant, and the fail-safe move over a non-conformant document is to
 * surface the negation the sender plainly wrote, not to read the record as live.
 *
 * **This is the read {@link isRetracted} already performs for `entered-in-error`**, which is the same
 * shape of code on the same element, and it is one function rather than three copies so the three
 * cannot drift apart over which values of `status` they see.
 *
 * **It answers about the resource it is handed, and the safety walk applies it at every resource
 * root** ({@link ./status.js} `checkNegations`), so a `Procedure` recorded as not performed inside a
 * `contained` array or a `Bundle.entry` reaches `SafetyReadout.negations`. **What that walk calls a
 * resource root is stated there and is not restated here**: it is a property-name test, not a proof
 * that the node is a resource, and writing down a universal over it has been wrong twice in this
 * slice alone.
 *
 * **`noKnownAllergy` is the opposite direction and stays type-gated**: it asserts something *positive*
 * about a patient, so a wider read would invent an assertion rather than find one.
 *
 * @internal
 */
export function statusSpells(resource: FhirComplex, code: string): boolean {
  return getAllProperties(resource, "status").some((node) => primitiveStrings(node).includes(code));
}

/**
 * The whitespace R4's own `code` regex recognises, and nothing else: space, tab, line feed and
 * carriage return. `code` is spelled `[^\s]+(\s[^\s]+)*` (datatypes.html), where `\s` is XML
 * Schema's four-character class, so a value with any of these at either end is **outside the
 * datatype's lexical space** before it is anything else.
 *
 * Deliberately **not** JavaScript's `\s`, which also matches a no-break space, a byte-order mark and
 * the Unicode space separators. Those are ordinary characters inside a conformant `code`, so
 * treating one as padding here would call a value non-conformant that R4 accepts.
 */
const CODE_WHITESPACE = /^[ \t\n\r]+|[ \t\n\r]+$/g;

/**
 * Whether a written value differs from `code` **only** by letter case, by surrounding whitespace, or
 * by both, so the exact-string match every negation read performs declined it.
 *
 * **This decides a diagnostic, never a reading.** It is asked *after* the exact match has already
 * failed and its answer is a `boolean` that reaches a location channel; nothing anywhere turns the
 * value it describes into the code it resembles. Coercing would be the opposite move and a much
 * larger one: FHIR `code` is case-sensitive (datatypes.html), so a reader that folded `"NOT-DONE"`
 * into `not-done` would accept a non-conformant document **as if it were conformant** and hand a
 * caller a negation the sender did not spell. The gap this closes is the *silence*, not the
 * strictness.
 *
 * `code` is expected already folded: lower-case, with no surrounding whitespace. Every code
 * {@link NEGATION_CODE_READS} names is, and that is pinned by a test rather than assumed here.
 *
 * @param value - A value the document wrote.
 * @param code - A negation code this layer matches exactly.
 * @returns `true` when the two differ only by case or surrounding whitespace.
 * @internal
 */
export function isNearMissCode(value: string, code: string): boolean {
  const folded = value.replace(CODE_WHITESPACE, "").toLowerCase();
  return folded !== value && folded === code;
}

/**
 * The `code`-valued elements the negation read looks at, the codes it matches on each **exactly**,
 * and the reader it sees them through. One entry per element, not per code, because the reader is a
 * property of the element.
 *
 * **The near-miss disclosure is derived from this same table**, so it cannot cover a pair the read
 * does not, nor miss one the read covers: read scope and report scope are the same scope because
 * they are the same table. The readers are the ones {@link statusSpells} and
 * {@link safetyHasCodeAnySystem} already use, not copies of them, so the disclosure sees exactly the
 * values the classification saw, through the same array wrappers and the same shadowed members.
 *
 * `test/negation-code-spelling.test.ts` asserts of every entry that the exact code **is** classified
 * as a negation at that element, so the table cannot drift into describing a read that is not there.
 *
 * **`unread` is the third thing an entry carries and it is the shape complement of `values`**: the
 * positions at that element from which the entry's own reader can take nothing, so a code sitting in
 * one is invisible to the classification. It lives in the row beside the reader it complements for
 * the same reason the reader lives here at all: a read and its refusal that share a table cannot
 * come to disagree about which elements they cover.
 *
 * **`codings` is the fourth, and it is the wrapper complement of the same reader.** Where `values`
 * goes through {@link safetyCodingsOf}, an array at `Coding.system` / `Coding.code` is the shape
 * that decided what came out: a single position is read through, more than one is refused. Marking
 * it here rather than at the report keeps the wrapper's window and the read's window the same
 * window by construction, which is the thing the type-scoped cardinality table cannot do for a read
 * that is not type-scoped.
 *
 * **`AllergyIntolerance.code` is deliberately absent**, and it is the same boundary that keeps
 * `no-known-allergy` off the walk ({@link ./status.js} `checkNegations`). Adding it here would put a
 * near-miss disclosure at every resource root while an *exact* SNOMED `716186003` at a nested root
 * is read by nothing, so the library would report the miss more loudly than the hit. Stated as a
 * limit, and pinned in both directions, rather than quietly widened.
 *
 * @internal
 */
export const NEGATION_CODE_READS: readonly {
  /** The property name the read looks under. */
  readonly element: string;
  /** The codes matched exactly at that element. */
  readonly codes: readonly string[];
  /** The values the negation read sees at that element, in document order. */
  readonly values: (node: FhirNode) => readonly string[];
  /**
   * Whether the element holds content at a position `values` cannot take anything from, so a code
   * inside it is invisible to the read. Absent where the shape complement is not settled; see the
   * `verificationStatus` entry.
   */
  readonly unread?: (node: FhirNode) => boolean;
  /**
   * Whether `values` resolves the code out of a `Coding` through {@link safetyCodingsOf}, so an
   * array wrapper at `Coding.system` / `Coding.code` under this element is a shape the read either
   * went **through** (a single array position) or **refused** (more than one). Either way the
   * wrapper decided what the read returned, so it is reported at this element's own window
   * ({@link ./status.js} `checkNegations`) and not only at the type-scoped cardinality table's.
   */
  readonly codings?: boolean;
}[] = [
  {
    element: "status",
    codes: [ENTERED_IN_ERROR, NOT_TAKEN, NOT_DONE],
    values: (node) => primitiveStrings(node),
    unread: hasUnreadableCode,
  },
  {
    // No `unread` here, and it is a declared limit rather than an oversight. The shape complement of
    // a `CodeableConcept` read is a *primitive* at the element, and `Condition.verificationStatus`
    // **is** a `code` in DSTU2, which ADR 0004 says this library reads tolerantly, so the same
    // predicate that reports a non-conformant R4 document would report a conformant DSTU2 one.
    // Deciding that needs a version this reader does not have. Filed, and pinned in both directions,
    // rather than taken here on the strength of the R4 half.
    element: "verificationStatus",
    codes: [ENTERED_IN_ERROR, REFUTED],
    values: (node) => safetyCodingsOf(node).flatMap((c) => (c.code === undefined ? [] : [c.code])),
    codings: true,
  },
];

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
 * That includes an array around a `Coding.system` / `Coding.code` *inside* a `CodeableConcept`, which
 * is the same converter shape one level down. It is read where the wrapper holds a single array
 * position, which is the only shape in which the value the sender wrote is recoverable without
 * inventing a `(system, code)` pair; a multi-position wrapper is reported rather than guessed at. See
 * {@link codingsOf}.
 *
 * **It answers about the resource it is handed, never about one nested inside it.** A `Bundle` whose
 * entry is retracted is not itself retracted, so this stays `false` there; the safety walk applies
 * this same read at every resource root and puts `entered-in-error` on `SafetyReadout.negations`
 * ({@link ./status.js} `checkNegations`), which is the read that covers a whole document.
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
  if (statusSpells(resource, ENTERED_IN_ERROR)) return true;
  return getAllProperties(resource, "verificationStatus").some((node) =>
    safetyHasCodeAnySystem(node, ENTERED_IN_ERROR),
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
 * should reject an unreadable type rather than guess one. This is the read every **type-scoped**
 * safety read uses. A type-scoped read (AllergyIntolerance's "no known allergy", and the
 * type-preferred `clinicalStatus` / `verificationStatus` code systems) is only reached once the type
 * gate says the resource is of that type, so a single-value type read makes the gate the narrowest
 * hole left in the safety claim: an `AllergyIntolerance` whose type arrived behind a repeated property
 * name or inside an array wrapper reports **no "no known allergy" at all** when the type is read
 * one-value-first-wins. Considering every named type over-surfaces on a document that is already
 * reported non-conformant, which is the safe direction.
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
