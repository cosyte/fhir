/**
 * The safety readout, a never-droppable surfacing of a resource's modifier / status / negation
 * elements. This is the read-side counterpart to the validator's fail-closed layer
 * ({@link ../validate/safety.js}).
 *
 * The fail-safe rule: the library "surfaces status / verification / clinical-status
 * / `doNotPerform` / `not-taken` / `not-done` prominently, any 'flatten/summary' helper carries them
 * or refuses." {@link readSafety} is that carry: it pulls
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
 * define, because then the element's value is not something this layer may pick. Five such
 * encodings are handled, and they reach the **same** harm by different routes:
 *
 * - **A repeated property name.** FHIR JSON forbids it (json.html §2.6.2) and RFC 8259 §4 leaves the
 *   winner undefined, so the element genuinely holds two values.
 * - **An array around a `0..1` element.** FHIR JSON writes a single-valued element as a name/value
 *   pair and uses an array only for a repeating element (json.html §2.6.2.2), so `{"status":
 *   ["entered-in-error"]}` is not a `status` this library may read one-value-first-wins, and a
 *   single-value read finds no string in it at all. This is not an exotic input: array-wrapping every
 *   element is ordinary generic XML-to-JSON converter output, and that is precisely how a C-CDA or v2
 *   feed reaches a FHIR surface in practice.
 * - **An array inside an array.** FHIR JSON uses an array for a repeating element and for nothing
 *   else, so a list of lists has no meaning anywhere and the codec does not model the inner one. This
 *   is the shape where the element's value is not merely ambiguous but **absent from the model**, and
 *   the model then looks exactly like an element the sender left out.
 * - **A primitive's value written as XML element text.** FHIR XML puts a primitive's value in the
 *   `value` attribute (xml.html §2.6.1), so `<status>entered-in-error</status>` carries no value
 *   this library may read: the reader drops the character data and the model holds a `status` with
 *   no value. This is the array-inside-an-array harm reached through the XML door, and the same two
 *   shapes are the ones this layer can do nothing about except decline to affirm.
 * - **A value outside its datatype's lexical space.** R4 spells a `boolean` as `true` or `false`
 *   (datatypes.html), so `<doNotPerform value="1"/>` (ordinary v2 / C-CDA converter output) is a
 *   value the sender wrote and this library may not read: `"1"` and `"Y"` mean opposite things on
 *   different wires, and picking one would author the instruction. Unlike the four above, the
 *   *shape* here is fine; it is the **value** the reader could not turn into the datatype. Reported
 *   at `unreadableBooleans`.
 *
 * Two rules follow, and they apply to all five encodings. Each negation read runs over **every** value
 * written for the element it reads, **including through an array wrapper** and including the type gate
 * itself, because a retraction the sender wrote must not go unreported. (Nothing can be read through
 * the third and fourth; there is no value there to read. The fifth has a value and this layer
 * declines it.) And the readout stops claiming the resource is summarizable: `safeToSummarize` is
 * `false` with the locations in `shadowedProperties` / `arrayWrappedScalars` / `nestedArrays` /
 * `droppedText` / `unreadableBooleans`, so a caller gets a refusal rather than an affirmative verdict
 * computed over one arbitrary reading of the document, or over content it never saw.
 *
 * @packageDocumentation
 */

import {
  childPath,
  getAllProperties,
  getProperty,
  isComplex,
  isList,
  isDroppedText,
  isNestedArray,
  isPrimitive,
  rootPath,
  type FhirComplex,
  type FhirNode,
  type FhirProperty,
} from "../model/index.js";
import {
  ALLERGY_CLINICAL_SYSTEM,
  ALLERGY_VERIFICATION_SYSTEM,
  CONDITION_CLINICAL_SYSTEM,
  CONDITION_VERIFICATION_SYSTEM,
  ENTERED_IN_ERROR,
  hasUnreadableBoolean,
  isRetracted,
  KNOWN_MODIFIER_EXTENSION_URLS,
  NO_KNOWN_ALLERGY,
  NOT_DONE,
  NOT_TAKEN,
  primitiveBooleans,
  primitiveString,
  primitiveStrings,
  REFUTED,
  SAFETY_CODEABLE_ELEMENTS,
  safetyCodeOf,
  safetyHasCodeAnySystem,
  safetyHasCoding,
  SAFETY_RESOURCE_TYPES,
  SAFETY_SCALAR_ELEMENTS,
  SNOMED_SCT,
  statusSpells,
  typesOf,
} from "./codes.js";

/**
 * `doNotPerform` on **this** node, read across every value the document wrote for it and through an
 * array wrapper. A `true` anywhere wins: the element is an instruction *not* to do the thing the
 * resource requests, so over-surfacing it is safe and missing it is not. Otherwise the first value
 * written is surfaced unchanged.
 *
 * **There is no resource-type gate, and its absence is the rule rather than an omission.** R4 flags
 * `doNotPerform` `?!` on more than one request resource (medicationrequest.html,
 * servicerequest.html, communicationrequest.html), and a modifier element is the one class a
 * consumer may never process as if it were absent. A type gate is a list of the types someone
 * remembered: the types it leaves out are not read *and not reported*, so the instruction is simply
 * never looked for, which is how a conformant `{"resourceType":"ServiceRequest","doNotPerform":
 * true}` came to read `negations: []` under `safeToSummarize: true`. The gate is dropped instead of
 * widened, because widening replaces a wrong list with a longer list of the same kind.
 *
 * What makes dropping it safe is the direction, not a census: this read can only **add** the
 * `do-not-perform` negation, never retire a finding, never flip `valid`, and never turn a refusal
 * into an affirmation. So a type nobody enumerated costs a caller a negation it can ignore, while a
 * type nobody enumerated under a gate costs a patient an instruction not to give a medication. It is
 * the same asymmetry that leaves `isRetracted` un-gated, and the opposite of `noKnownAllergy`, which
 * stays type-gated because it asserts something *positive* about a patient.
 *
 * The read goes through `primitiveBooleans`, which takes the boolean off either wire format's model,
 * so the lexical `true` the schema-free XML reader keeps as text is honored here. Before it did, this
 * element was lost across this package's own `serializeResourceXml` -> `parseResourceXml` round trip
 * and the readout affirmed `safeToSummarize` over a resource whose "do not give" had disappeared.
 *
 * **A value it cannot read leaves the read at `undefined` and is reported instead**, at
 * {@link unreadableBooleans}, the complement of this read rather than a widening of it. Nothing
 * here changes what is read: `"1"` and `"Y"` are not the R4 lexical space, they mean opposite things
 * on different wires, and reading them would author the instruction rather than surface it. The two
 * halves are decided in one place ({@link checkNegations}) so they cannot drift apart over which
 * documents they cover.
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
  /**
   * `doNotPerform = true`, an instruction to **not** do the thing the resource requests: not to give
   * the medication, not to perform the service, not to send the communication. R4 flags it `?!` on
   * each request resource that defines it, and this negation is read wherever it is written rather
   * than on a list of types (see `readDoNotPerform`).
   */
  | "do-not-perform"
  /**
   * `status = not-taken`, the medication was **not** consumed by the patient. R4 defines the code
   * only as a `MedicationStatement.status` value; it is read wherever a `status` spells it rather
   * than on a list of types (see `statusSpells`).
   */
  | "not-taken"
  /**
   * `status = not-done`, the event did **not** happen: the vaccine was not given, the procedure was
   * not performed, the medication was not administered. R4 carries the code on the `status` of
   * `Procedure`, `Communication`, `Media`, `MedicationAdministration` and `Immunization`, and it is
   * read wherever a `status` spells it rather than on a list of types (see `statusSpells`).
   */
  | "not-done"
  /** `entered-in-error` anywhere, the record is retracted, not data. */
  | "entered-in-error";

/**
 * The order {@link SafetyReadout.negations} lists the kinds in. Fixed rather than the order the walk
 * met them, because the walk visits every resource root a document carries and a caller's list must
 * not depend on which `Bundle.entry` happened to come first. It is the order the readout has always
 * used, kept so a negation read at a new window cannot reorder the ones already there.
 */
const NEGATION_ORDER: readonly NegationKind[] = [
  "entered-in-error",
  "refuted",
  "no-known-allergy",
  "do-not-perform",
  "not-taken",
  "not-done",
];

/**
 * The complete, value-free safety readout of a resource. Every modifier element the safety resource
 * types can carry has a slot here, present or `undefined`, so a consumer building a summary
 * reads them explicitly rather than forgetting one.
 *
 * **`negations` is the authoritative safety read, and it is collected at every resource root** the
 * document carries, so a retracted `Observation`, a not-performed `Procedure` or an order marked "do
 * not give" inside `contained` or a `Bundle.entry` reaches it. The one negation not collected from
 * the walk is `no-known-allergy`, which stays the root, type-scoped read on its own field for the
 * reasons given there.
 *
 * **Two groups of fields, and the difference is which question they answer.** The location channels
 * (`unhandledModifierExtensions`, `shadowedProperties`, `arrayWrappedScalars`, `nestedArrays`,
 * `droppedText`, `unreadableBooleans`) and the `safeToSummarize` derived from them are **document-wide
 * and always were**: they carry FHIRPath locations, so a nested finding has an address to name, and
 * `assertSafeToSummarize` refuses over a `Bundle`'s entries. The **single-valued** fields
 * (`resourceType` / `status` / `clinicalStatus` / `verificationStatus` / `doNotPerform` / `retracted`
 * / `noKnownAllergy`) answer about **the resource handed in** and nothing nested inside it, because
 * one value cannot say which resource it came from. `negations` is the read that crosses that line:
 * it is a document-wide **set** with no locations. Branch on it, not on the single-valued fields,
 * whenever the resource may carry others.
 *
 * The single-code convenience fields (`resourceType` / `status` / `clinicalStatus` /
 * `verificationStatus`) surface one value: the
 * *preferred*-system coding of a `CodeableConcept`, falling back to the first coding when the
 * standard one is absent (which may be a local/translation code), and the first member written when a
 * non-conformant document repeated a property name or wrapped the element in an array. The classified
 * `negations` are derived from **every** coding under any system and **every** value written for the
 * element each negation reads (`resourceType`, `status`, `verificationStatus`, `code`,
 * `doNotPerform`), including the ones a repeated property name shadowed and the ones inside an array
 * wrapper **around the element**, so a refutation or a retraction cannot hide in the value a
 * single-value lookup skipped, and the type gate cannot hide a type-scoped negation behind a type it
 * did not read. That extends **one level down**, to an array around a `Coding.system` / `Coding.code`
 * inside a `CodeableConcept`, where the wrapper holds a single array position; a multi-position one is
 * reported rather than read, because pairing a `system` from one position with a `code` from another
 * would assert a coding the sender never wrote (see {@link arrayWrappedScalars}). Read a safety
 * decision off `negations`, not off the raw status string, and check `safeToSummarize` before
 * flattening anything.
 */
export interface SafetyReadout {
  /**
   * The first `resourceType` the document names, read through a repeated name or an array wrapper,
   * **bounded** to the published form of a resource type name, or `undefined` if the resource names
   * none. Every R4 type is returned exactly as written; anything that is not shaped like a type name
   * reads as the {@link WITHHELD} marker, `"<withheld>"`, because this is the one identifier on this readout
   * that a caller would interpolate to describe a location, and a location is not a place to echo
   * whatever a sender wrote. Convenience only: the type-scoped negation reads consider **every**
   * type named, not just this one, and they read it unbounded.
   */
  readonly resourceType: string | undefined;
  /** The `status` code (Observation / Immunization / DiagnosticReport / MedicationRequest·Statement). */
  readonly status: string | undefined;
  /** The `clinicalStatus` code, preferred-system-first (AllergyIntolerance / Condition). Convenience only. */
  readonly clinicalStatus: string | undefined;
  /** The `verificationStatus` code, preferred-system-first (AllergyIntolerance / Condition). Convenience only. */
  readonly verificationStatus: string | undefined;
  /**
   * `doNotPerform` **on the resource handed to {@link readSafety}**, whatever its type, read off
   * either wire format's model: the JSON codec's `boolean`, or the lexical `true` / `false` the
   * schema-free XML reader keeps as the text of the `value` attribute. Text outside that two-word
   * lexical space (`"TRUE"`, `"1"`) still reads as `undefined` (coercing it would author a value the
   * sender did not spell) but no longer silently: the element's location is on
   * {@link unreadableBooleans} and the resource is not `safeToSummarize`. So `undefined` here means
   * *either* "no boolean was written" or "one was written and could not be read", and the two are
   * told apart by that channel, never by this field.
   *
   * **Convenience only, and root-scoped like `status` beside it.** A `doNotPerform` written on a
   * resource *inside* this one, in `contained` or a Bundle `entry`, leaves this field `undefined`
   * and still puts `do-not-perform` on {@link negations}, which is the authoritative read. Branch on
   * `negations`, never on this field, when the resource may carry others.
   */
  readonly doNotPerform: boolean | undefined;
  /**
   * Whether **the resource handed to {@link readSafety}** is marked `entered-in-error` (retracted,
   * not data), read off its own `status` or `verificationStatus`.
   *
   * **Root-scoped, like `status` beside it.** A retracted resource in `contained` or a `Bundle.entry`
   * leaves this `false` (a Bundle is not retracted because one of its entries is) and still puts
   * `entered-in-error` on {@link negations}, which is the read that covers the whole document. So
   * `retracted` implies `entered-in-error` is on `negations`, never the other way round.
   */
  readonly retracted: boolean;
  /**
   * Whether **the resource handed to {@link readSafety}** is a recorded "no known allergy" (SNOMED
   * `716186003` on an `AllergyIntolerance.code`), not an allergy *to* that code.
   *
   * **Root-scoped and type-scoped, and alone among the negations in being both.** Every other
   * negation is read off an element R4 flags `?!`, where a consumer may not process the element as if
   * it were absent and surfacing one can only make a caller more careful. This one is a *positive*
   * clinical assertion read off an element R4 does not flag at all, and surfacing it from somewhere
   * inside a document could make a caller **less** careful about a patient, while leaving it
   * unsurfaced reads as *unknown*. So a nested `AllergyIntolerance` recording it reaches neither this
   * field nor {@link negations}: a declared gap in the fail-safe direction, not an oversight.
   */
  readonly noKnownAllergy: boolean;
  /**
   * Every negation asserted **anywhere in the document** (from all codings, any system), the
   * authoritative safety read: at the resource handed in and at every resource root inside it, so a
   * `contained` or `Bundle.entry` resource's retraction, refutation, `not-done` / `not-taken` status
   * or "do not perform" instruction is here. Value-free and **unlocated**, so a kind appears once
   * however many resources assert it, in a fixed order that does not depend on entry order.
   * `no-known-allergy` is the one exception and is root-scoped; see {@link noKnownAllergy}.
   */
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
   * FHIRPath locations where the document wrote an array inside an array, a shape FHIR JSON gives no
   * meaning at any position. Unlike every other location here the content at these is **not
   * readable**: the codec does not model an inner array, so this is the record that something was
   * written where the model now shows an empty element. Whole resources have been lost this way
   * inside a Bundle entry. Empty on every conformant document.
   */
  readonly nestedArrays: readonly string[];
  /**
   * FHIRPath locations where an XML document wrote **character data directly on a FHIR element**,
   * which has no slot for it: a primitive's value travels in the `value` attribute (xml.html
   * §2.6.1), so the reader drops the text. Like `nestedArrays` the content at these locations is
   * **not readable**, and the element then looks exactly like one the sender left out, which is how
   * `<status>entered-in-error</status>` came to read as a live record. Empty on every conformant
   * document and on every document read from JSON.
   */
  readonly droppedText: readonly string[];
  /**
   * FHIRPath locations where a `boolean`-valued safety element carries a **written value outside the
   * R4 `boolean` lexical space** (`true` / `false`, datatypes.html), so the element is present, the
   * sender filled it in, and the read still returns `undefined`. `<doNotPerform value="1"/>` and
   * `value="Y"` are ordinary v2 / C-CDA converter output and land here; without the location they
   * read exactly like `value="0"`, and a "do not administer" is indistinguishable from its opposite.
   * The channel is the third one on this readout whose content is **not readable**, beside
   * {@link nestedArrays} and {@link droppedText}, and like them it carries locations and no values.
   * The element read is `doNotPerform`, at any resource root, on any type; it is the only `boolean`
   * this readout takes off a document at all, since `retracted` and `noKnownAllergy` come from codes
   * and codings. Empty on every conformant document.
   */
  readonly unreadableBooleans: readonly string[];
  /**
   * `false` when the resource must not be flattened: an unhandled `modifierExtension` is present, a
   * repeated property name left an element with more than one value, a `0..1` safety element
   * arrived array-wrapped, an array inside an array left content the codec could not read, XML
   * character data on an element was dropped, or a boolean-valued safety element carries a written
   * value this layer cannot read. Each is a case where a summary would have to assert something this
   * library cannot establish, so it declines instead.
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
 * on a {@link ../safety/codes.js} `SAFETY_RESOURCE_TYPES` root) plus `resourceType` on **any** root,
 * **and one level down, `Coding.system` / `Coding.code` inside those of them that are
 * `CodeableConcept`-valued** (`SAFETY_CODEABLE_ELEMENTS`). The element-level scoping is not timidity:
 * R4 defines repeating elements under these names elsewhere (`Questionnaire.code`,
 * `ElementDefinition.code`, both `0..*`), so a name-only rule would emit a false error on a conformant
 * document. The `Coding` level needs no such care, because `Coding` is a datatype whose `system` and
 * `code` are `0..1` wherever it appears. Deciding cardinality anywhere else needs a per-resource
 * model, which this library does not have and this layer must not grow.
 *
 * **Why the `Coding` level is reported even though it is now read:** {@link ../safety/codes.js}
 * `codingsOf` reads through such a wrapper only where it holds a *single array position*, since
 * `system` and `code` feed its `system` x `code` cross-product and a rule yielding more than one value
 * on either side would pair values from different positions and **assert a coding the sender never
 * wrote**, one of which is a recorded "no known allergy", a *positive* clinical assertion. So a
 * multi-position wrapper is deliberately unread, and its location is the only thing standing between
 * that and a `safeToSummarize: true` over a value the library declined to read. The single-position
 * case is reported for the same reason the element-level wrapper is when its value *is* read: FHIR
 * JSON does not define the shape, so an affirmative verdict over it is not this library's to give.
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

/**
 * The subset of {@link arrayWrappedScalars} whose wrapper FHIR XML has no repetition to spell back,
 * so writing the model to XML would emit a document the wrapper cannot be read out of again.
 *
 * **Same walk, same window, one call.** This is deliberately not a second traversal with its own
 * element table: a copy would be free to drift from the window this layer reports, and the read
 * window and the report window must be the same window. It narrows that window (`unspellableInXml`)
 * and never widens it, so it can never name a location `arrayWrappedScalars` does not.
 *
 * The XML write path is its only consumer; it is not part of the public surface.
 *
 * @param resource - The resource model.
 * @param path - The FHIRPath prefix for the resource root (usually its `resourceType`).
 * @returns Those locations, in the same document order, each once.
 * @internal
 */
export function unspellableXmlWrappers(resource: FhirComplex, path: string): string[] {
  return walkSafety(resource, path).unspellableInXml;
}

/**
 * Collect the FHIRPath locations where the document wrote an **array inside an array**, a deep walk
 * of the whole resource.
 *
 * FHIR JSON uses an array for one thing, a repeating element (json.html §2.6.2.2), so no element is
 * ever a list of lists and this shape has no meaning at any position. That is what makes this rule
 * different from the two above it and simpler than either: it needs **no cardinality table and no
 * element list**, because there is no position in a conformant document where it can fire.
 *
 * **Scope: every node the model has.** Every element at every depth, a primitive's `extension`
 * metadata, a resource nested in `contained` or a Bundle entry, and a member a repeated property
 * name shadowed. It is bounded by what the reader modeled rather than by an element list, which is
 * the one qualification worth stating plainly: a `_`-sibling the reader discards *whole* as
 * misplaced or unrecognised (one sitting on an object or on a non-primitive array, or a member of a
 * `_`-sibling object that is neither an `id` **string** nor an `extension` array) leaves no node
 * behind, so an
 * array inside one is reported by the reader against the discarded sibling and is **not** refused
 * here. **Which warning the reader draws is per member, not one code for all three:** an
 * unrecognised member of a `_`-sibling object draws `UNKNOWN_PROPERTY`
 * (`{"birthDate":"1980-01-01","_birthDate":{"foo":[["x"]]}}`, at `Patient.birthDate.foo`), while a
 * `_`-sibling on an object or on a non-primitive array draws `MISPLACED_PRIMITIVE_EXTENSION` for the
 * misplaced sibling and nothing besides. Reaching it would mean reading raw JSON the codec does not
 * model.
 *
 * **This layer reports these; it does not read them.** The codec does not model an inner array, so
 * whatever the sender wrote inside one is not recoverable here, and this location is the only thing
 * that distinguishes such a position from an element that really was empty on the wire. Without it a
 * refuted allergy, a resolved condition, or a whole retracted resource inside a Bundle entry reads
 * back as an ordinary absent element and the readout affirms `safeToSummarize` over content it never
 * saw. Reporting is deliberately the entire remedy: making the inner array readable would change
 * what a repeating element *contains* for every consumer that walks one, which is a much larger and
 * riskier change than declining to affirm.
 *
 * Empty for every conformant document, and for every document read from XML, which has no way to
 * write the shape.
 *
 * @param resource - The resource model.
 * @param path - The FHIRPath prefix for the resource root (usually its `resourceType`).
 * @returns The locations of the nested arrays, in walk order (an element's own properties before any
 *   member a repeated name shadowed, which is not the document order that member had), each location
 *   once however many marked nodes sit at it. Two elements whose names are both withheld
 *   ({@link ../model/path.js}) share a location and therefore collapse into one entry, on the same
 *   reasoning as a repeated name: a location nobody can address twice says nothing twice. The
 *   verdict does not move, `safeToSummarize` is `false` either way.
 * @example
 * ```ts
 * import { nestedArrays, parseResource } from "@cosyte/fhir";
 * const { resource } = parseResource('{"resourceType":"Patient","name":[[{"family":"Roe"}]]}');
 * nestedArrays(resource, "Patient"); // ["Patient.name[0]"]
 * ```
 */
export function nestedArrays(resource: FhirComplex, path: string): string[] {
  return collectMarked(resource, path, isNestedArray);
}

/**
 * The locations where an XML document wrote **character data directly on a FHIR element**, which the
 * reader drops: a primitive's value travels in the `value` attribute (xml.html §2.6.1), so text
 * written as element content has no slot on the model. A deep walk of the whole resource, so text on
 * an element inside a backbone element or a contained resource is caught too.
 *
 * **This layer reports these; it does not read them.** The dropped text is not kept anywhere, and
 * this location is the only thing that distinguishes such a position from an element the sender
 * genuinely wrote without a value. Without it `<status>entered-in-error</status>` reads back as an
 * ordinary absent `status` and the readout affirms over a retracted record. Reporting is deliberately
 * the entire remedy: reading the text as the element's value would be a **tolerance for a
 * non-conformant encoding**, a decision about what this reader accepts, which is a much larger change
 * than declining to affirm.
 *
 * Empty for every conformant document, and for every document read from JSON, which has no
 * character-data channel.
 *
 * @param resource - The resource model.
 * @param path - The FHIRPath prefix for the resource root (usually its `resourceType`).
 * @returns The locations of the dropped text, in walk order, each location once however many marked
 *   nodes sit at it, on the same reasoning as {@link nestedArrays}.
 * @example
 * ```ts
 * import { droppedText, parseResourceXml } from "@cosyte/fhir";
 * const { resource } = parseResourceXml(
 *   '<Observation xmlns="http://hl7.org/fhir"><status>entered-in-error</status></Observation>',
 * );
 * droppedText(resource, "Observation"); // ["Observation.status"]
 * ```
 */
export function droppedText(resource: FhirComplex, path: string): string[] {
  return collectMarked(resource, path, isDroppedText);
}

/**
 * The locations where a `boolean`-valued safety element carries a **written value this layer could
 * not read as a boolean**, so the element is present, the sender filled it in, and the read returned
 * `undefined` all the same.
 *
 * R4 spells a `boolean` as `true` or `false` and nothing else (datatypes.html), so
 * `<doNotPerform value="1"/>` and `<doNotPerform value="Y"/>` (ordinary output from a v2 or C-CDA
 * converter, which is how a great deal of data reaches a FHIR surface) carry no boolean this library
 * may read. Coercing them would author a value the sender did not spell, and `"1"` and `"Y"` also
 * appear on the wire meaning the opposite of what a naive reading gives them. So the value stays
 * unread, and **this is the record that it was there**: without it, `value="1"` and `value="0"` read
 * identically, and a prescriber's "yes, do not administer" is indistinguishable from "no" with
 * nothing anywhere to say a choice was made.
 *
 * **Value-free, like every location on this readout**: the text that failed to read is not carried
 * here or anywhere else, only the FHIRPath of the element that held it.
 *
 * **The element is `doNotPerform`**, the only `boolean` {@link readSafety} takes off a document, and
 * there is no resource-type gate on it. **The window is every resource root** (so a `contained` or
 * Bundle-`entry` resource is covered), which is `arrayWrappedScalars`' window and is **the same
 * window the negation read uses**: the two are decided together, in one pass, so neither can cover a
 * document the other does not.
 * It is **not** a report of every unreadable value in a document: the profile booleans, the
 * `ElementDefinition.min` integer and a `Quantity` magnitude's lexical forms are read elsewhere and
 * are still lost silently.
 *
 * Empty for every conformant document, in either wire format.
 *
 * @param resource - The resource model.
 * @param path - The FHIRPath prefix for the resource root (usually its `resourceType`).
 * @returns The locations of the unreadable boolean values, in walk order.
 * @example
 * ```ts
 * import { parseResourceXml, unreadableBooleans } from "@cosyte/fhir";
 * const { resource } = parseResourceXml(
 *   '<MedicationRequest xmlns="http://hl7.org/fhir"><doNotPerform value="1"/></MedicationRequest>',
 * );
 * unreadableBooleans(resource, "MedicationRequest"); // ["MedicationRequest.doNotPerform"]
 * ```
 */
export function unreadableBooleans(resource: FhirComplex, path: string): string[] {
  return walkSafety(resource, path).unreadableBoolean;
}

/**
 * The locations of every node the reader marked with `marked`, de-duplicated.
 *
 * A repeated property name can put two marked nodes at the same FHIRPath location, and FHIRPath
 * cannot address the individual members, so a second identical location would say nothing new. The
 * shadowed-name and array-wrapper reports already collapse theirs for the same reason.
 *
 * Shared with the write-path guard rather than copied, so a refusal cannot come to visit a different
 * part of a document than a report of the same kind does.
 *
 * @internal
 */
export function collectMarked(
  resource: FhirComplex,
  path: string,
  marked: (node: FhirNode) => boolean,
): string[] {
  const out: string[] = [];
  collectNested(resource, path, out, marked);
  return [...new Set(out)];
}

/**
 * Walk every node in the tree, recording each one `marked` selects. Deliberately a **separate**
 * walk from {@link walkSafety} rather than another finding folded into it: this one visits strictly
 * more of the document (primitives and their `extension` metadata, which the other walk has a stated
 * reason to skip), and keeping them apart is what guarantees the new report cannot change, reorder,
 * or suppress any finding the existing walk already made.
 *
 * One walk serves both markers: the traversal is the same question ("where in this document is a
 * node the reader could not fill in"), and sharing it is what keeps the two location lists from
 * drifting apart over which parts of a document they visit.
 */
function collectNested(
  node: FhirNode,
  path: string,
  out: string[],
  marked: (node: FhirNode) => boolean,
): void {
  if (marked(node)) out.push(path);
  if (isList(node)) {
    node.items.forEach((item, index) =>
      collectNested(item, `${path}[${String(index)}]`, out, marked),
    );
    return;
  }
  if (isPrimitive(node)) {
    // A primitive's `id`/`extension` metadata is part of the document too, and an extension can
    // carry clinical content, so a loss in there is a loss like any other.
    (node.extension ?? []).forEach((ext, index) =>
      collectNested(ext, `${path}.extension[${String(index)}]`, out, marked),
    );
    return;
  }
  for (const property of node.properties)
    collectNested(property.value, childPath(path, property.name), out, marked);
  // Members a repeated property name shadowed are part of the document, so a loss cannot be made
  // invisible by hiding it behind a duplicate key.
  for (const property of node.duplicates ?? []) {
    collectNested(property.value, childPath(path, property.name), out, marked);
  }
}

/** The fail-closed findings a single walk of the resource collects. */
interface SafetyWalk {
  readonly modifiers: string[];
  readonly shadowed: string[];
  readonly arrayWrapped: string[];
  /** The subset of {@link SafetyWalk.arrayWrapped} FHIR XML has no repetition to spell back. */
  readonly unspellableInXml: string[];
  /**
   * Every negation kind read at **any** resource root the walk visited, the entry node included.
   * Internal: what reaches the readout is the classified list, which carries no location, so the set
   * is de-duplicated here rather than at the caller. It is built by the same pass, at the same
   * window, as the refusal below.
   */
  readonly negations: Set<NegationKind>;
  /** Boolean-valued safety elements whose written value the boolean read could not read. */
  readonly unreadableBoolean: string[];
}

/**
 * Walk the whole resource once, collecting unhandled modifiers, shadowed property names, and
 * array-wrapped `0..1` safety elements. The entry node is a resource root by construction, whether or
 * not it carries a readable `resourceType`.
 */
function walkSafety(resource: FhirComplex, path: string): SafetyWalk {
  const out: SafetyWalk = {
    modifiers: [],
    shadowed: [],
    arrayWrapped: [],
    unspellableInXml: [],
    negations: new Set<NegationKind>(),
    unreadableBoolean: [],
  };
  walkComplex(resource, path, out, true);
  return out;
}

/**
 * Whether a wrapper the safety layer reports is one FHIR XML has no way to write back as a wrapper.
 *
 * FHIR XML spells a repeat by **repeating the element** (xml.html) and has no other mark for one, so
 * what survives a trip through XML is a wrapper that emits two or more elements: the re-read groups
 * them into a list and this layer reports the location again. A wrapper holding fewer than two items
 * emits at most one element, which re-reads as an ordinary single-valued element, and the report is
 * gone.
 *
 * **`resourceType` is the exception at every arity, and it is a fact about XML rather than about
 * this library's writer**: FHIR XML has no `resourceType` element at all, the type IS the tag, and a
 * tag cannot be repeated. So no wrapper there has a spelling, however many entries it holds.
 *
 * This is a predicate about which wrappers a format can carry. It is deliberately **not** a claim
 * that every wrapper it lets through survives; see the write-path refusal that consumes it.
 */
function unspellableInXml(name: string, value: FhirNode): boolean {
  if (!isList(value)) return false;
  return name === "resourceType" || value.items.length < 2;
}

/**
 * Record every `0..1` safety element this node wrote as an array. Runs only on a resource root: a
 * nested backbone element or datatype has its own cardinalities, which this library does not model.
 */
function checkArrayWrapping(node: FhirComplex, path: string, out: SafetyWalk): void {
  const types = typesOf(node);
  const isSafetyType = types.some((type) => SAFETY_RESOURCE_TYPES.has(type));
  const reported = new Set<string>();
  const unspellable = new Set<string>();
  // The two sets are de-duplicated INDEPENDENTLY on purpose. A repeated property name puts two
  // wrappers at one location, and if only the first were considered, `{"status":["b","c"],
  // "status":["a"]}` would hide the unwritable one behind the writable one that arrived first.
  const report = (location: string, unwritable: boolean): void => {
    if (!reported.has(location)) {
      reported.add(location);
      out.arrayWrapped.push(location);
    }
    if (unwritable && !unspellable.has(location)) {
      unspellable.add(location);
      out.unspellableInXml.push(location);
    }
  };
  for (const property of [...node.properties, ...(node.duplicates ?? [])]) {
    const clinical = SAFETY_SCALAR_ELEMENTS.has(property.name);
    // `resourceType` is a JSON string on every resource, not an element with a cardinality, so it is
    // checked whatever the type says, and it is checked first: an array-wrapped type gate is what
    // makes the clinical scoping below unreachable in the first place.
    if (property.name !== "resourceType" && !(clinical && isSafetyType)) continue;
    const at = childPath(path, property.name);
    if (isList(property.value)) report(at, unspellableInXml(property.name, property.value));
    // The same converter shape one level down, on a `Coding` inside a CodeableConcept-valued element.
    if (clinical && isSafetyType && SAFETY_CODEABLE_ELEMENTS.has(property.name)) {
      checkCodingWrapping(property.value, at, report);
    }
  }
}

/**
 * Record every array wrapper around a `Coding.system` / `Coding.code` inside a CodeableConcept-valued
 * safety element. `Coding` is a datatype and both are `0..1` on it (datatypes.html), so unlike the
 * element names one level up this needs no per-resource cardinality and cannot false-positive.
 *
 * Reporting these is what keeps the read of them honest. {@link ../safety/codes.js} `codingsOf` reads
 * through a **single-position** wrapper, because that is the only shape whose value is recoverable
 * without pairing a `system` from one array position with a `code` from another and inventing a
 * `(system, code)` pair the sender never wrote. A **multi-position** wrapper is therefore left unread,
 * and a negation inside one is not surfaced: without this location the library would affirm
 * `safeToSummarize` over a value it knowingly declined to read, which is the exact defect the
 * element-level half of this rule exists to prevent. A single-position wrapper is reported too, for
 * the same reason the element-level one is even when its value is read: the encoding is a shape FHIR
 * JSON does not define, and a positive verdict over it is not this library's to give.
 *
 * The location names the `Coding`, not the individual member, exactly as the element-level rule names
 * the element: FHIRPath cannot address "the second `code` member", so a `Coding` that repeated the
 * name reports once. An element that is **itself** array-wrapped *is* indexed, though
 * (`<element>[i].coding[j].code`), because it then holds several `CodeableConcept`s and without the
 * index the second one's wrapper would have no address at all, the element-level location having
 * already been emitted unindexed.
 */
function checkCodingWrapping(
  value: FhirNode,
  path: string,
  report: (location: string, unspellable: boolean) => void,
): void {
  const concepts = isList(value) ? value.items : [value];
  concepts.forEach((concept, conceptIndex) => {
    if (!isComplex(concept)) return;
    // An element that is itself array-wrapped holds several CodeableConcepts, and each needs its own
    // address or the second one's wrapper has no location at all. A bare element is not indexed,
    // since there is no array there to index into.
    const base = isList(value) ? `${path}[${String(conceptIndex)}]` : path;
    for (const member of getAllProperties(concept, "coding")) {
      const codings = isList(member) ? member.items : [member];
      codings.forEach((coding, index) => {
        if (!isComplex(coding)) return;
        const at = isList(member) ? `${base}.coding[${String(index)}]` : `${base}.coding`;
        for (const name of CODING_SCALAR_ELEMENTS) {
          const members = getAllProperties(coding, name);
          if (members.some((scalar) => isList(scalar))) {
            // Per WRITTEN MEMBER, not per location: a `Coding` whose `system` is a singleton and
            // whose `code` holds two entries loses the `system` wrapper on the way through XML even
            // though the `code` wrapper keeps the location reported. The member that vanishes is
            // what this answers, so `some` is the right quantifier.
            report(
              `${at}.${name}`,
              members.some((scalar) => unspellableInXml(name, scalar)),
            );
          }
        }
      });
    }
  });
}

/** The `0..1` scalars on a `Coding` this layer reads a safety verdict out of (datatypes.html). */
const CODING_SCALAR_ELEMENTS = ["system", "code"] as const;

/**
 * Read every negation this resource root asserts, and record the `doNotPerform` value the boolean
 * read could not read. **One pass decides the reads and the refusal**, and that is the point of the
 * function: whatever a document has to be for this to look at it, it is the same for the values that
 * are read and for the value that is refused, so the two can never drift into a window where a
 * sender's instruction is neither surfaced nor reported. Widening a read without moving its refusal
 * alongside it is how a value goes from *not looked for* to *looked for and silently dropped*, which
 * is the same defect wearing the fix's clothes.
 *
 * **The window is every resource root**, which is {@link checkArrayWrapping}'s window: the entry node
 * plus every node carrying its own `resourceType`, so a `MedicationRequest` inside `contained` or a
 * Bundle `entry` is read here and reported here. The two are called from one place
 * ({@link checkResourceRoot}) so that "which nodes are resource roots" is decided once.
 *
 * **What licenses reading these at a nested root is FHIR's modifier rule, not the depth.** The three
 * element names read here are ones R4 flags `?!` on the types that define them: `status` (the
 * `entered-in-error` retraction and the `not-done` / `not-taken` negations; observation.html,
 * procedure.html, immunization.html, medicationstatement.html, medicationadministration.html),
 * `verificationStatus` (the retraction and `refuted`; allergyintolerance.html, condition.html), and
 * `doNotPerform` (medicationrequest.html, servicerequest.html, communicationrequest.html). A consumer
 * may never process a modifier element as if it were absent, and that obligation attaches to the
 * resource that carries it, not to the position the resource happens to occupy in a document: a
 * `contained` order and a `Bundle.entry` order are resources. A readout that
 * affirms over a nested resource's "do not give" costs a patient a medication, and one that affirms
 * over a nested `entered-in-error` reports a retracted record as data.
 *
 * **That is a statement about the three NAMES, not about every node this runs on.** The window below
 * is a property-name test (`resourceType` is written here), which is not a proof that the node is a
 * resource: R4 gives `ExampleScenario.instance` a `resourceType` element of its own, so a backbone
 * element can land in it. The window is inherited from {@link checkArrayWrapping} rather than derived
 * here, and it is a declared limit in both directions: it reads no deeper than a resource root, and
 * on a non-conformant document it can reach one node too many. Both are additive - a node that
 * defines none of the three names contributes nothing, and a node that spells one gets a negation
 * surfaced rather than a finding retired.
 *
 * The direction argument holds for all of them exactly as it does at the entry root: each read can
 * only **add** a negation, never retire a finding, never flip `valid` (no validator reads
 * `negations`), and never turn a refusal into an affirmation.
 *
 * **`no-known-allergy` is deliberately not here, and it is the one negation whose absence is the
 * cautious answer.** It is read off `AllergyIntolerance.code`, which R4 does **not** flag `?!`.
 * It is not a modifier element at all, but this library's own first-class concept, so the rule above
 * does not reach it. It also runs the other way from every negation here: surfacing a recorded "no
 * known allergy" from somewhere inside a document can make a caller *less* careful about a patient,
 * where an unsurfaced one reads as *unknown*, which is the fail-safe answer. It stays the root,
 * type-scoped read in {@link readSafety}, declared and pinned rather than claimed.
 *
 * **The reads are the very ones {@link readSafety} already performed at the entry root**
 * ({@link ../safety/codes.js} `isRetracted`, `statusSpells`, `safetyHasCodeAnySystem`), called on
 * more nodes rather than rewritten. So no document's *reading* changes here; only the set of nodes
 * the reading is applied to.
 *
 * **Not a backbone element or a datatype**, and that boundary is a limit rather than a rule these
 * reads derive. The direction argument above would license going deeper, since reading more can only
 * add a negation; what stops it is that {@link checkArrayWrapping}'s walk delivers resource roots and
 * this rides it. So `MedicationRequest.dosageInstruction[0].doNotPerform` and a `status` inside
 * `Procedure.performer` are read by nothing. R4 defines neither element there, so no conformant
 * document sits at either, but that is a declared gap and not a claim that none can: both are pinned
 * in `test/negation-read-scope.test.ts` and `test/negation-status-codes.test.ts`.
 *
 * **Why the refusal is decided here and not in the reader.** FHIR XML carries every primitive as the
 * text of its `value` attribute (xml.html §2.6.1) and this reader is schema-free, so nothing at parse
 * time knows the text spells a `boolean` rather than a `code`: `<doNotPerform value="1"/>` and
 * `<status value="1"/>` are the same node to the codec. This layer is the first one that knows the
 * datatype **unconditionally**, and that is the narrow, measured reason the finding raises no
 * `ValidationIssue` of its own: these types have **no built-in schema**, so the validator is silent
 * about this element's **datatype** unless a caller supplies one, and this readout has to hold either
 * way. (The shape channels above are not scoped that way: an array-wrapped or duplicated
 * `doNotPerform` still draws `ARRAY_WRAPPED_SCALAR` / `DUPLICATE_PROPERTY` with no schema at all.)
 * Both paths are pinned in `test/xml-unreadable-boolean.test.ts` and
 * `test/negation-read-scope.test.ts`.
 */
function checkNegations(node: FhirComplex, path: string, out: SafetyWalk): void {
  // Across every member a repeated property name left, exactly as `readDoNotPerform` reads them: a
  // value must not become invisible, read or unread, by arriving second under a duplicate key. One
  // location however many members, because FHIRPath cannot address an individual member.
  const written = getAllProperties(node, "doNotPerform");
  if (written.length > 0) {
    const at = childPath(path, "doNotPerform");
    if (written.some((value) => primitiveBooleans(value).includes(true))) {
      out.negations.add("do-not-perform");
    }
    if (written.some(hasUnreadableBoolean)) out.unreadableBoolean.push(at);
  }
  if (isRetracted(node)) out.negations.add(ENTERED_IN_ERROR);
  if (
    getAllProperties(node, "verificationStatus").some((v) => safetyHasCodeAnySystem(v, REFUTED))
  ) {
    out.negations.add(REFUTED);
  }
  if (statusSpells(node, NOT_TAKEN)) out.negations.add(NOT_TAKEN);
  if (statusSpells(node, NOT_DONE)) out.negations.add(NOT_DONE);
}

/**
 * Everything this layer decides **at a resource root**, called from the one place that decides what a
 * resource root is. The cardinality report ({@link checkArrayWrapping}) and the negation reads with
 * their refusal ({@link checkNegations}) share that window by construction rather than by two copies
 * of the same condition, which is what stops a later change from widening one and leaving the other
 * behind.
 */
function checkResourceRoot(node: FhirComplex, path: string, out: SafetyWalk): void {
  checkArrayWrapping(node, path, out);
  checkNegations(node, path, out);
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
    checkResourceRoot(node, path, out);
  }
  for (const property of node.properties) visitProperty(property, path, out);
  const reported = new Set<string>();
  for (const property of node.duplicates ?? []) {
    // One location per element, however many members shadowed it: FHIRPath cannot address the
    // individual members, so repeating the same path would be noise a caller cannot act on.
    if (!reported.has(property.name)) {
      reported.add(property.name);
      out.shadowed.push(childPath(path, property.name));
    }
    visitProperty(property, path, out);
  }
}

/** Check one property for an unhandled modifier, then descend into it. */
function visitProperty(property: FhirProperty, path: string, out: SafetyWalk): void {
  if (property.name === "modifierExtension") {
    checkModifierExtension(property.value, path, out.modifiers);
  }
  descend(property.value, childPath(path, property.name), out);
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
 * one. The type-scoped slots are filled for the types `SAFETY_RESOURCE_TYPES` names; for any other
 * type they are `undefined` and only the un-gated reads apply, which are the retraction, the
 * refutation, `doNotPerform`, the `not-done` / `not-taken` status negations, and the
 * modifier-extension check. `noKnownAllergy` is the one negation that stays type-gated, because it
 * asserts something *positive* about a patient.
 *
 * **The un-gated negation reads run at every resource root**, so a `contained` or `Bundle.entry`
 * resource's retraction, refutation, `not-done` / `not-taken` status or "do not perform" instruction
 * is classified on {@link SafetyReadout.negations}, while the **single-valued** fields (`status`,
 * `retracted`, `doNotPerform`, `noKnownAllergy` and the rest) stay root reads. The readout's location
 * channels and `safeToSummarize` were already document-wide and are unchanged. Branch on `negations`
 * rather than on a single-valued field when the resource may carry others.
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
  const clinicalStatus = safetyCodeOf(
    getProperty(resource, "clinicalStatus"),
    clinicalSystemFor(rt),
  );
  const verificationStatus = safetyCodeOf(
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
  const prefix = rt === undefined ? "$this" : rootPath(rt);
  const walk = walkSafety(resource, prefix);

  // The two convenience-shaped fields are root reads, exactly as `status` beside them is: they answer
  // about the resource handed in. The classified `negations` below are the walk's, so they answer
  // about every resource the document carries.
  const doNotPerform = readDoNotPerform(resource);
  const retracted = isRetracted(resource);
  // The one negation that is NOT on the walk. It is read off `AllergyIntolerance.code`, an element
  // R4 does not flag `?!`, and it is the one negation a caller can act on by being LESS careful, so
  // neither the modifier rule nor the direction argument licenses reading it from a nested resource.
  // Its type gate is the same asymmetry seen from the other side. Declared and pinned, not claimed.
  const noKnownAllergy =
    isType("AllergyIntolerance") &&
    getAllProperties(resource, "code").some((node) =>
      safetyHasCoding(node, SNOMED_SCT, NO_KNOWN_ALLERGY),
    );

  // Classified in a fixed order rather than in the order the walk met them, so that the list a
  // caller sees does not depend on how a Bundle happened to order its entries. De-duplicated for the
  // same reason it is unlocated: two resources asserting one negation say the same thing once.
  const found = new Set(walk.negations);
  if (noKnownAllergy) found.add("no-known-allergy");
  const negations = NEGATION_ORDER.filter((kind) => found.has(kind));

  const { modifiers, shadowed, arrayWrapped, unreadableBoolean } = walk;
  const nested = nestedArrays(resource, prefix);
  const dropped = droppedText(resource, prefix);

  return {
    resourceType: rt === undefined ? undefined : rootPath(rt),
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
    nestedArrays: nested,
    droppedText: dropped,
    unreadableBooleans: unreadableBoolean,
    safeToSummarize:
      modifiers.length === 0 &&
      shadowed.length === 0 &&
      arrayWrapped.length === 0 &&
      nested.length === 0 &&
      dropped.length === 0 &&
      unreadableBoolean.length === 0,
  };
}

/**
 * A refusal raised when a caller tries to flatten or summarize a resource this library cannot
 * summarize honestly: it carries a `modifierExtension` we do not understand (FHIR's `?!` rule forbids
 * ignoring one), a repeated property name left an element holding several values with no rule for
 * choosing between them, a `0..1` safety element arrived wrapped in a JSON array, an array inside
 * an array left content the codec could not read at all, XML character data written on an element
 * was dropped, or a boolean-valued safety element carries a written value outside the datatype's
 * lexical space. Every way the safe move is to **refuse**, value-free, carrying only the locations.
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
        "name, an array-wrapped single-valued element, an array inside an array, dropped XML " +
        "element text, or a boolean value this library cannot read leaves an " +
        `element this library must not flatten (${String(locations.length)} location(s)).`,
    );
    this.name = "FhirSafetyError";
    this.locations = locations;
  }
}

/**
 * Assert a resource is safe to flatten/summarize, throwing {@link FhirSafetyError} when it carries an
 * unhandled `modifierExtension`, a repeated property name, an array-wrapped single-valued element, an
 * array inside an array, dropped XML element text, or a boolean-valued safety element holding a
 * written value outside the datatype's lexical space. This is the executable form of "carries status
 * **or refuses**": a summary helper calls it first, and never silently drops a modifier it cannot
 * honor, nor summarizes an element whose value the document left ambiguous or whose content the codec
 * could not read.
 *
 * @param resource - The resource (or a readout already computed for it).
 * @throws FhirSafetyError when any of those six shapes is present.
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
    ...readout.nestedArrays,
    ...readout.droppedText,
    ...readout.unreadableBooleans,
  ];
  if (locations.length > 0) throw new FhirSafetyError(locations);
}
