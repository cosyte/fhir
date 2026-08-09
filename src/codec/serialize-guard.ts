/**
 * The write-path refusals: the places a writer declines to hand a model back rather than encode it
 * into something that re-reads as content nobody wrote.
 *
 * {@link assertSerializable} runs in both writers, because a dropped-character-data marker has no
 * conformant encoding in either format. {@link breaksTag} governs the XML writer only, because the
 * harm is a name reaching a tag position, and JSON escapes a member name so no name reaches this
 * refusal there. {@link refuseUnserializableDivMarkup} is raised by the XML writer for the same
 * reason, at its one raw-markup site: JSON carries the string as a string.
 * {@link assertXmlSerializable}, {@link assertXmlArrayWrapper} and {@link assertXmlResourceType} are
 * XML-only for the mirror-image reason: the shapes they refuse are ones the JSON writer writes, and
 * XML has no channel to write them into. {@link assertNoShadowedProperty} runs in **both** for the
 * first reason again: a
 * member a repeated property name shadowed falls outside both walks, which visit `properties` only,
 * and neither format has a spelling that re-reads as the ambiguity the model holds. No refusal here
 * recognises anything new,
 * invents a value, or changes a document that reads clean.
 *
 * **This module is a list of the refusals it implements, NOT a closed account of what a writer can
 * author.** Two of the predicates deliberately live somewhere else rather than being copied here,
 * because a copy would be free to disagree with the thing it copies: `emitsOneDivElement` sits in
 * `../xml/write.js` next to the code that emits the markup, and the cardinality window
 * {@link assertXmlArrayWrapper} refuses on is the safety layer's own walk in `../safety/status.js`,
 * the same walk that reports it to a caller.
 *
 * The rest of this comment is the first refusal.
 *
 * FHIR XML carries a primitive's value in the `value` attribute (xml.html §2.6.1, "values of
 * primitive types in a `value` attribute"), so character data written directly on a FHIR element is
 * not a value this library can read. The XML reader drops it and marks the node, which is what makes
 * `<status>entered-in-error</status>` report rather than affirm.
 *
 * **A marked model has no conformant serialization, in either wire format.** The character data is
 * not preserved -- recovering it would be a tolerance for a non-conformant encoding, which the
 * reporting half deliberately declined -- so neither writer has a value to emit. Left to themselves
 * they emit the element as though the sender had never filled it in: XML writes `<status/>`, which is
 * itself a violation of §2.6.1's "FHIR elements are never empty" SHALL, and JSON drops the member
 * outright. Re-reading either gives a clean document, so **the error-severity finding disappears
 * across one round trip** and the retraction that the model refused to summarize becomes a resource
 * that summarizes fine.
 *
 * So the writers refuse. That is a refusal, not a tolerance: nothing new is recognised, no value is
 * invented, and no document that reads clean today changes shape. It costs the round trip only for
 * models the library already reports as `valid: false` with `safeToSummarize: false`.
 */
import { isPrimitive, type FhirComplex, type FhirNode } from "../model/node.js";
import { childPath, rootPath } from "../model/path.js";
import { typeOf } from "../safety/codes.js";
import {
  collectMarked,
  droppedText,
  shadowedProperties,
  unspellableXmlWrappers,
} from "../safety/status.js";

/** Every reason a writer refuses to serialize a model. */
export const SERIALIZE_ERROR_CODES = {
  /**
   * The model carries character data the XML reader dropped, at one or more locations. There is no
   * conformant encoding of it in either wire format, and emitting the element as unfilled would
   * launder the `DROPPED_ELEMENT_TEXT` finding across a round trip.
   */
  DROPPED_ELEMENT_TEXT: "DROPPED_ELEMENT_TEXT",
  /**
   * The model carries a name that cannot occupy the `Name` slot of an XML start tag, so writing it
   * would emit markup that does not re-read as the element the model holds. **XML only**: JSON
   * escapes a member name, so this refusal never reaches it and that route stays open. **Narrowed
   * 2026-08-07 from "encodes every one of these correctly", which was false and shipped**: a model
   * refused here can carry one of `serializeResource`'s own declared exceptions and emit that.
   *
   * See {@link breaksTag} for the exact predicate and for what is deliberately NOT refused.
   */
  UNSERIALIZABLE_ELEMENT_NAME: "UNSERIALIZABLE_ELEMENT_NAME",
  /**
   * A `div` property carries a string the XML writer would emit as raw markup, and that string does
   * not contribute exactly one element named `div` to the document. **XML only**: `serializeResource`
   * carries the string as a string, so this refusal never reaches it and that route stays open.
   *
   * **That is a statement about the `div` string, not about the whole model.** `serializeResource`
   * has its own declared non-spec-clean exceptions, so a model refused here can still route through
   * it and emit one of those: `{"text":{"div":""},"name":[[{"family":"X"}]]}` is refused here and
   * `serializeResource` emits the array inside an array unchanged.
   *
   * See `emitsOneDivElement` in `../xml/write.js` for the exact predicate and what it does not cover.
   */
  UNSERIALIZABLE_DIV_MARKUP: "UNSERIALIZABLE_DIV_MARKUP",
  /**
   * The model carries, at one or more locations, a shape the JSON reader marked because FHIR JSON
   * gives that position no meaning: an array inside an array, a scalar or `null` where FHIR JSON has
   * an object (a complex element's own position or a primitive's `_`-sibling), or a `null` in a
   * primitive's value channel that padded nothing. **XML only**: this refusal does not reach
   * `serializeResource`, which writes these back from the text the reader preserved at every position
   * that writer walks. **It does not walk a member a repeated property name shadowed, and this
   * refusal does reach one** -- `serializeResource` refuses that model on
   * {@link SERIALIZE_ERROR_CODES.UNSERIALIZABLE_SHADOWED_PROPERTY} rather than emitting it, so it is
   * still not a route the shape survives. The XML writer keeps reporting THIS code on such a model,
   * because this one is raised first. See {@link assertXmlSerializable}.
   *
   * XML has no array-of-arrays, no `_`-sibling and no `null`, so the XML writer has nowhere to put
   * any of it and emits the element the reader was left holding: an empty one, or none. That output
   * re-reads with an empty issue list, so the finding the reader raised is gone after one trip.
   *
   * See {@link assertXmlSerializable} for the exact set of markers and for what it does NOT cover.
   */
  UNSERIALIZABLE_JSON_ONLY_SHAPE: "UNSERIALIZABLE_JSON_ONLY_SHAPE",
  /**
   * The model carries, at a location this library already reports as an array-wrapped `0..1` safety
   * element, a wrapper FHIR XML has no repetition to spell back: one holding fewer than two items,
   * or any wrapper at all on `resourceType`. **XML only**: `serializeResource` writes the list back
   * and the re-read reports the same location, so that route stays open.
   *
   * XML spells a repeat by repeating the element and has no other mark for one, so a wrapper of
   * fewer than two items emits at most one element and re-reads as an ordinary single-valued
   * element. The encoding complaint the reader raised is then gone, and with it an `error`-severity
   * `ARRAY_WRAPPED_SCALAR` and a `safeToSummarize: false`.
   *
   * See {@link assertXmlArrayWrapper} for the exact predicate and for what it deliberately leaves.
   */
  UNSERIALIZABLE_ARRAY_WRAPPER: "UNSERIALIZABLE_ARRAY_WRAPPER",
  /**
   * The model carries, at one or more object elements, a member a repeated property name shadowed
   * ({@link ../model/node.js} `duplicates`). **Both writers**, unlike the four refusals above it:
   * each walks `properties` only, so each wrote one member per name and the second value left the
   * document with no diagnostic on it.
   *
   * See {@link assertNoShadowedProperty} for the window, the two routes weighed, and what it leaves.
   */
  UNSERIALIZABLE_SHADOWED_PROPERTY: "UNSERIALIZABLE_SHADOWED_PROPERTY",
  /**
   * The model carries, at one or more elements, a `resourceType` that is not a string. FHIR XML has
   * no `resourceType` element at all -- the type IS the tag -- so the XML writer skipped the
   * property, and with no string to name the tag it wrote `Resource` instead: the member deleted and
   * the element named something the sender never wrote. **XML only**: `serializeResource` emits a
   * non-string `resourceType` through its ordinary path, so this refusal never reaches it and that
   * route stays open.
   *
   * See {@link assertXmlResourceType} for the window and for what it deliberately leaves.
   */
  UNSERIALIZABLE_RESOURCE_TYPE: "UNSERIALIZABLE_RESOURCE_TYPE",
} as const;

/** Discriminant union of every {@link SERIALIZE_ERROR_CODES} value. */
export type SerializeErrorCode = (typeof SERIALIZE_ERROR_CODES)[keyof typeof SERIALIZE_ERROR_CODES];

/**
 * Thrown by a writer asked to serialize a model it cannot encode without losing a finding.
 *
 * Value-free like every other diagnostic in this library: `locations` carries bounded FHIRPath
 * expressions, never the content that was dropped.
 *
 * @example
 * ```ts
 * import { serializeResourceXml, FhirSerializeError, SERIALIZE_ERROR_CODES } from "@cosyte/fhir";
 * try {
 *   serializeResourceXml(resource);
 * } catch (err) {
 *   if (err instanceof FhirSerializeError && err.code === SERIALIZE_ERROR_CODES.DROPPED_ELEMENT_TEXT) {
 *     console.error("cannot re-emit; text was dropped at", err.locations);
 *   }
 * }
 * ```
 */
export class FhirSerializeError extends Error {
  /** Which refusal this is. */
  readonly code: SerializeErrorCode;

  /** The bounded FHIRPath locations the refusal is about, in walk order. Never document content. */
  readonly locations: readonly string[];

  /**
   * @param message - A value-free description of the refusal.
   * @param code - Which refusal this is.
   * @param locations - The bounded FHIRPath locations it is about.
   */
  constructor(message: string, code: SerializeErrorCode, locations: readonly string[]) {
    super(message);
    this.name = "FhirSerializeError";
    this.code = code;
    this.locations = locations;
  }
}

/**
 * Refuse to serialize a model whose reader recorded dropped character data.
 *
 * Runs at the root of both writers, over the same marker set `droppedText` reports, so a writer can
 * never be quieter than the validator about the same document.
 *
 * @param node - The model about to be serialized.
 * @throws {FhirSerializeError} With {@link SERIALIZE_ERROR_CODES.DROPPED_ELEMENT_TEXT} if any node
 *   is marked. Never throws for a model read from JSON, which has no character-data channel, nor for
 *   any conformant XML document. Text the reader drops WITHOUT marking (character data that is
 *   `String.trim()`-empty) leaves no marker, so it is not covered here either.
 * @internal
 */
export function assertSerializable(node: FhirComplex): void {
  const locations = droppedText(node, rootPath(typeOf(node) ?? "Resource"));
  if (locations.length === 0) return;
  throw new FhirSerializeError(
    `cannot serialize: the reader dropped character data at ${String(locations.length)} location(s), which this model cannot encode`,
    SERIALIZE_ERROR_CODES.DROPPED_ELEMENT_TEXT,
    locations,
  );
}

/**
 * Whether this node carries one of the shapes only the JSON reader can produce: a marker it set, or
 * text it preserved, at a position FHIR JSON gives no meaning to.
 *
 * **This is the literal union of the fields, not a rule about them**, because each is a separate
 * field the writer would otherwise walk straight past. `nestedArray` and `nestedArraySource` travel
 * together out of the reader today; both are tested rather than one inferred from the other, so a
 * node built by hand cannot slip between them. A {@link FhirList} carries none of them: the markers
 * hang on the empty element or the value-absent primitive the reader produced, never on the list
 * around it.
 *
 * Every one of these is documented on its field as absent from any document read from XML, and
 * {@link FhirComplex.droppedText} is deliberately NOT here: it is the XML reader's own marker and
 * {@link assertSerializable} already refuses it, in both writers.
 */
function carriesJsonOnlyShape(node: FhirNode): boolean {
  if (node.kind === "list") return false;
  if (node.nestedArray === true || node.nestedArraySource !== undefined) return true;
  if (node.kind === "complex") return node.nonObjectSource !== undefined;
  return (
    node.undefinedNull === true ||
    node.nonObjectMetaSource !== undefined ||
    node.nestedArrayMetaSource !== undefined
  );
}

/**
 * Refuse to serialize **to XML** a model carrying a shape only FHIR JSON can spell, which the XML
 * writer would drop.
 *
 * The JSON reader marks four positions FHIR JSON gives no meaning to and preserves what the sender
 * wrote at them, so `serializeResource` can hand it back and a re-read reproduces the finding: an
 * array inside an array, a scalar or `null` where FHIR JSON has an object, that same shape in a
 * primitive's `_`-sibling, and a `null` in a primitive's value channel that padded nothing. **XML has
 * no channel for any of them** -- no array of arrays, no `_`-sibling (a primitive's metadata is
 * co-located as an `id` attribute and child `<extension>` elements), and no `null` at all -- so the
 * XML writer emitted the node the reader was left holding and the finding did not survive the trip.
 *
 * **Measured at `5ced746`, base, one shape per marker, each read then written to XML then re-read:**
 *
 * | in | read | XML out | re-read |
 * | --- | --- | --- | --- |
 * | `{"valueQuantity":{"value":null,"unit":"mg"}}` | `UNDEFINED_JSON_NULL` | `<value/><unit value="mg"/>` | `[]`, back to `{"unit":"mg"}` |
 * | `{"status":"final","_status":null}` | `UNKNOWN_PROPERTY` | `<status value="final"/>` | `[]` |
 * | `{"name":[{"family":"a"},"junk"]}` | `UNKNOWN_PROPERTY` | `<name/>` for item 1 | `[]` |
 * | `{"name":[[{"family":"Roe"}]]}` | `UNKNOWN_PROPERTY`+`NESTED_ARRAY`, `safeToSummarize: false` | `<name/>` | `[]`, `safeToSummarize: true` |
 *
 * The first is the shape this library already records as the harm the value-channel rule exists for:
 * a `Quantity` that comes back carrying a unit and **no magnitude**, clean at every layer. The last
 * turns a refusal to summarize into an affirmation.
 *
 * **Refusing, because there is nothing to hand back to.** Emitting the empty element is what
 * launders; inventing an XML spelling for a JSON-only shape would author markup the sender never
 * wrote, which is the fabrication class two refusals beside this one already exist for. Nothing that
 * works is withdrawn: this fires only on a model the JSON reader marked, so **no document read from
 * XML ever reaches it** and no conformant JSON document does either. The capability is routed rather
 * than lost: `serializeResource` writes all four back and the re-read reproduces the finding.
 *
 * **That is value-exact, NOT byte-exact, and the difference is not cosmetic enough to leave
 * implicit.** The preserved text is the value re-rendered the way this library renders every JSON
 * value, so `{"performer":[{"reference":"Practitioner/1"},"Practitioner\/2"]}` comes back with the
 * second member spelled `"Practitioner/2"`: the same string, different bytes, and a caller diffing
 * the output against the input sees it. {@link FhirComplex.nonObjectSource} states the same limit on
 * the field itself. Only the `undefinedNull` family is byte-identical, because a `null` has no
 * escaping to lose.
 *
 * **And "that route stays open" is a statement about these shapes, not about the whole model.** A
 * model refused here can carry one of that writer's own declared exceptions and have it emitted, and
 * a marker sitting in a member a repeated property name shadowed sends that writer to
 * {@link assertNoShadowedProperty} instead (see the walk, below).
 *
 * **Raised last**, after the name and `div` refusals, so a model that trips two keeps the code it
 * already reported and no case moves onto this one.
 *
 * **The set walked is `collectMarked`'s**, the same walk {@link droppedText} and `nestedArrays` use:
 * every node at every depth, a primitive's `extension` metadata, and members a repeated property
 * name shadowed. That last one is wider than the XML writer's own walk, which visits `properties`
 * only, so `{"name":[[{"family":"Roe"}]],"name":[{"family":"Roe"}]}` is refused for a marker sitting
 * in a member the writer would never have reached. Wider in the direction that refuses more, and
 * {@link assertNoShadowedProperty} refuses that same model in the JSON writer -- **so it is the one
 * case where neither writer carries the shape, and the message must not point at a route that keeps
 * it.** The location it reports is the property, and a consumer resolving that location
 * reaches the **surviving** member rather than the shadowed one, because FHIRPath cannot address a
 * shadowed member at all: the same reason `collectMarked` de-duplicates two markers at one location.
 *
 * @param node - The model about to be serialized to XML.
 * @throws {FhirSerializeError} With {@link SERIALIZE_ERROR_CODES.UNSERIALIZABLE_JSON_ONLY_SHAPE}.
 * @internal
 */
export function assertXmlSerializable(node: FhirComplex): void {
  const locations = collectMarked(node, rootPath(typeOf(node) ?? "Resource"), carriesJsonOnlyShape);
  if (locations.length === 0) return;
  throw new FhirSerializeError(
    // Says only what this refusal does NOT reach, which is the wording the two refusals beside it
    // were narrowed to. It deliberately does not promise that `serializeResource` writes the shape
    // back: it does for every position that writer walks, and a marked node inside a member a
    // repeated property name shadowed is dropped by it as well.
    `cannot serialize to XML: ${String(locations.length)} location(s) carry a shape only FHIR JSON can spell, which XML has no channel for; this refusal does not reach serializeResource`,
    SERIALIZE_ERROR_CODES.UNSERIALIZABLE_JSON_ONLY_SHAPE,
    locations,
  );
}

/**
 * Refuse to serialize **to XML** a model carrying an array wrapper around a `0..1` element that XML
 * has no repetition to spell back, which the XML writer would flatten away.
 *
 * ## The cardinality decision this implements, and what it is scoped to
 *
 * FHIR JSON writes a single-valued element as a name/value pair and reserves the array for a
 * repeating one (json.html §2.6.2.2), so `{"status":["entered-in-error"]}` is a shape the spec does
 * not define; the safety layer reports it as `ARRAY_WRAPPED_SCALAR`, an **error**, and refuses to
 * affirm `safeToSummarize` over it. FHIR XML spells a repeat by **repeating the element**
 * (xml.html) and carries no other mark for one, so the writer emitted the single element it held and
 * the encoding complaint had nowhere to go: `{"resourceType":"Observation",
 * "status":["entered-in-error"]}` came back as `<status value="entered-in-error"/>`, re-read with an
 * empty issue list, and moved `valid` and `safeToSummarize` both from `false` to `true`.
 *
 * **A writer cannot decide cardinality in general and this one does not try.** This library has no
 * per-resource model, and a name-only rule false-errors on a conformant document (`Questionnaire.code`
 * and `ElementDefinition.code` are `0..*` in R4). So the write path takes its cardinality from the
 * one window that already has one: the locations `arrayWrappedScalars` reports. Outside that
 * window the writer keeps saying nothing, `Observation.valueQuantity` included -- a `0..1` choice
 * whose wrapper still launders here, declared rather than implied.
 *
 * ## Which wrappers inside that window, and why not all of them
 *
 * Only the ones XML cannot write back as a wrapper: fewer than two items, plus **any** wrapper on
 * `resourceType`, where the type is the tag and a tag cannot be repeated (a three-entry one is
 * flattened exactly as a singleton is). A wrapper of two or more items elsewhere emits repeated
 * elements, the re-read groups them into a list, and the location is reported again -- so refusing
 * it would withdraw a round trip that works today **and keeps the finding**, which is the cost the
 * unbound-prefix residual was deferred rather than pay.
 *
 * **This counts ITEMS, and the sentence above reasons about EMITTED ELEMENTS. They are the same
 * number for a model a reader produced and not in general**, which is the limit to read this on: a
 * hand-built `list([list([]), list([])])` holds two items and emits none. No parsed document reaches
 * the gap: every list the JSON reader constructs holds primitives or complexes, never lists, and XML
 * cannot spell the shape at all.
 *
 * That is a statement about which wrappers this refuses, **not** a claim that every wrapper it lets
 * through survives. What is measured, stated as the axis rather than as a total: 6
 * `(resource type, element)` root pairs x 10 item shapes in each of two array positions x arities 2
 * and 3 gave 1,200 candidates, of which 732 produced a reported wrapper this still emits, and none
 * laundered; the same roots x 11 shapes at arities 0 and 1 gave 66 candidates, of which 60 were
 * emitted and **all 60** laundered. A generated grammar, **not** the FHIR R4 published-examples
 * corpus, and 6 root pairs is not the whole window.
 *
 * ## Refusing rather than reporting or repairing
 *
 * The XML writer returns a string and has no diagnostics channel, and XML has no shape to hand a
 * wrapper back into, so the two routes {@link assertXmlSerializable} weighed are the two here.
 * Inventing an XML spelling would author markup the sender never wrote. Refusing recognises nothing
 * and invents nothing, and it costs a round trip only for models this library already reports as
 * `valid: false` with `safeToSummarize: false`, the same bound {@link assertSerializable} accepted.
 *
 * **Raised last**, after the name, `div` and JSON-only-shape refusals, so a model that trips two
 * keeps the code it already reported and no case moves onto this one.
 *
 * **Reached from XML in principle rather than never**: an XML document CAN put a list at a reported
 * location, by repeating the element -- but two repeated elements are two items, which this leaves
 * alone. The shapes it refuses are ones a single element does not produce.
 *
 * **The window walked includes a member a repeated property name shadowed**, which the XML writer
 * itself never visits, so `{"status":["b","c"],"status":["a"]}` is refused for a wrapper the writer
 * would have dropped either way. Wider in the direction that refuses more, and the same choice
 * {@link assertXmlSerializable} made at the same fork; the shadowed member is refused by both
 * writers ({@link assertNoShadowedProperty}), so do not read this refusal as pointing at a route
 * that keeps it.
 *
 * @param node - The model about to be serialized to XML.
 * @throws {FhirSerializeError} With {@link SERIALIZE_ERROR_CODES.UNSERIALIZABLE_ARRAY_WRAPPER}.
 * @internal
 */
export function assertXmlArrayWrapper(node: FhirComplex): void {
  const locations = unspellableXmlWrappers(node, rootPath(typeOf(node) ?? "Resource"));
  if (locations.length === 0) return;
  throw new FhirSerializeError(
    // Says what this refusal does not reach, in the wording the three refusals beside it were
    // narrowed to. `serializeResource` does write these wrappers back -- pinned by the JSON half of
    // the same test -- with the shadowed-member limit stated in the docblock rather than here.
    `cannot serialize to XML: ${String(locations.length)} location(s) carry an array wrapper around a 0..1 element that XML has no repeated element to spell back; this refusal does not reach serializeResource`,
    SERIALIZE_ERROR_CODES.UNSERIALIZABLE_ARRAY_WRAPPER,
    locations,
  );
}

/**
 * Refuse to serialize, **in either format**, a model carrying a member a repeated property name
 * shadowed. Both writers walk `properties` only, so both wrote one member per name and the other
 * value left the document.
 *
 * ## The site, measured at `914c03a`
 *
 * `{"resourceType":"Observation","status":"final","status":"entered-in-error"}` reads first-wins with
 * `DUPLICATE_PROPERTY`, keeps the second value on `duplicates`, and reads `valid: false` with
 * `safeToSummarize: false` and `entered-in-error` in `negations`. `serializeResource` emitted
 * `{"resourceType":"Observation","status":"final"}` and `serializeResourceXml` emitted
 * `<status value="final"/>`; **both re-read with an empty issue list, `valid: true` and
 * `safeToSummarize: true`, and the retraction is not in the output at all.** Which value is lost
 * depends on the order the sender wrote them in, not on anything the writer knows.
 *
 * ## Refusing rather than handing both back
 *
 * Handing both back is the route the four JSON-only shapes take one module over, and here it is the
 * worse of the two, **measured rather than argued**: FHIR JSON requires unique names (json.html
 * §2.6.2) and RFC 8259 §4 leaves the winner undefined, and `JSON.parse` resolves such a name
 * **last-wins** where this library reads **first-wins**. On the mirror spelling
 * `{"status":"entered-in-error","status":"final"}` the model holds the retraction and `JSON.parse`
 * returns `"final"`, so emitting both members hands every other consumer the member this one calls
 * shadowed -- the writer authoring a different clinical answer, which is the fabrication class the
 * refusals above it exist for. FHIR XML *can* repeat an element, but two repeated elements re-read
 * as a **list**, a repeating element the sender never wrote. Refusing invents nothing.
 *
 * ## The window, which is not a second table
 *
 * `shadowedProperties` -- the same call `validateResource` raises its **error**-severity
 * `DUPLICATE_PROPERTY` from and the same one `readSafety` requires empty before it affirms
 * `safeToSummarize`. So a model refused here already reads `valid: false` with
 * `safeToSummarize: false`: the bound every refusal beside it kept, held by construction rather than
 * by measurement.
 *
 * **Raised last** in both writers, after every refusal above it, so a model that trips two keeps the
 * code it already reported and no case moves onto this one.
 *
 * ## What it does not cover, and why that is the same bound rather than an oversight
 *
 * A repeated name inside a **primitive's `_`-sibling** is not modeled at all (`./read.js`: an R4
 * `Element` is `id` and `extension`, and the shadowed member is not carried), so there is nothing
 * here to refuse. A repeated name inside a complex sitting in a primitive's `extension` **is**
 * modeled and is still dropped by both writers:
 * `{"_status":{"extension":[{"url":"u","valueString":"x","valueString":"y"}]}}` loses `"y"` on both
 * paths. It is left rather than refused because that document reads `valid: true` with
 * `safeToSummarize: true`, so refusing it would withdraw a round trip from a model this library
 * reports as clean -- the one cost none of these refusals pays.
 *
 * @param node - The model about to be serialized, in either format.
 * @throws {FhirSerializeError} With {@link SERIALIZE_ERROR_CODES.UNSERIALIZABLE_SHADOWED_PROPERTY}.
 * @internal
 */
export function assertNoShadowedProperty(node: FhirComplex): void {
  const locations = shadowedProperties(node, rootPath(typeOf(node) ?? "Resource"));
  if (locations.length === 0) return;
  throw new FhirSerializeError(
    // Names both writers, because both drop it: there is no route here that keeps the member, and a
    // message pointing at one would point an operator at a silent drop. That is the wording the four
    // refusals above were narrowed to, at the one refusal where the answer is "neither".
    `cannot serialize: ${String(locations.length)} location(s) carry a member a repeated property name shadowed, which neither serializeResource nor serializeResourceXml can write`,
    SERIALIZE_ERROR_CODES.UNSERIALIZABLE_SHADOWED_PROPERTY,
    locations,
  );
}

/**
 * Whether this element wrote a `resourceType` and the XML writer has no string in it to name the tag
 * with.
 *
 * **Both halves are load-bearing, and the second is what keeps a working round trip.** An element
 * with no `resourceType` at all answers `false`: nothing is deleted there and
 * {@link serializeResourceXml} names a typeless complex `Resource` by documented fallback, so
 * refusing would withdraw a route from every model that never had a type. An element with a string
 * one BESIDE a non-string one answers `false` too: the tag is named correctly, so this defect's
 * substitution does not happen, and the drop that does happen there is the repeated-property-name
 * one, which both writers do and which is declared separately. **That shape is reachable, and not
 * from JSON**: the XML reader has no `duplicates` mechanism, so
 * `<Patient xmlns="http://hl7.org/fhir"><resourceType><a value="1"/></resourceType></Patient>` reads
 * as two `resourceType` properties in one element, `valid: true` and `safeToSummarize: true`.
 * Refusing that would be this refusal paying the one cost none of the refusals beside it pays.
 */
function lacksTaggableResourceType(node: FhirNode): boolean {
  if (node.kind !== "complex") return false;
  const written = node.properties.filter((property) => property.name === "resourceType");
  if (written.length === 0) return false;
  return !written.some(
    (property) => isPrimitive(property.value) && typeof property.value.value === "string",
  );
}

/**
 * Refuse to serialize **to XML** an element whose `resourceType` is not a string, which the XML
 * writer would delete while naming the element something the sender never wrote.
 *
 * ## The site, measured at `63b05fc`
 *
 * FHIR XML has no `resourceType` element: the type IS the tag (xml.html). So the writer skips that
 * property at every element it walks and takes the tag from the property's string value -- and where
 * there is no string to take, the root fell back to `Resource`.
 * `{"resourceType":{"modifierExtension":[{"url":"http://example.org/x"}]},"status":"final"}` reads
 * `RESOURCE_TYPE_UNKNOWN` at **error** severity with `valid: false`, and `safeToSummarize: false` for
 * the unhandled modifier extension the type gate carries. It emitted
 * `<Resource xmlns="http://hl7.org/fhir"><status value="final"/></Resource>`, which re-reads with an
 * empty issue list, `valid: true` and `safeToSummarize: true`. The property is gone from the output
 * and the element claims a type nobody wrote.
 *
 * That is the harm shape of every refusal above it: a format change that **upgrades** a document's
 * own trustworthiness claim. It reaches `safeToSummarize` because the deleted property takes its
 * whole subtree with it, and a `modifierExtension` -- FHIR's `?!` rule, the one thing a reader may
 * never ignore -- is among the things that subtree can hold.
 *
 * ## Refusing rather than repairing
 *
 * Neither repair is available. Writing `<Resource>` is what launders today, and it authors a type:
 * the type gate is what every type-scoped safety read runs behind, so substituting one changes which
 * negations are readable at all. Coercing the value to a string authors a **different** type out of
 * content the sender wrote at another shape. Refusing recognises nothing and invents nothing.
 *
 * ## The window, and the bound it holds only at the root
 *
 * `collectMarked`'s walk -- every node at every depth, a primitive's `extension` metadata, and
 * members a repeated property name shadowed -- selecting the elements {@link lacksTaggableResourceType}
 * picks out. Depth matters: a `contained` resource and a `Bundle.entry` resource each name their own
 * element, so each has a tag to lose.
 *
 * **At the root, this costs a round trip only for a model already reported `valid: false`**, the
 * bound the refusals beside it hold: `typeOf` is the strict single-value read, so exactly the values
 * refused here draw an error-severity `RESOURCE_TYPE_UNKNOWN`. **Deeper, that bound does not hold, it
 * is not claimed, and a document read from XML reaches it** -- so the narrower, structural bound is
 * the one to read this on. `{"resourceType":"Patient","contained":[{"resourceType":42,"status":
 * "entered-in-error"}]}` and `<Patient xmlns="http://hl7.org/fhir"><name><resourceType><a value="1"/>
 * </resourceType></name></Patient>` both read `valid: true` with an empty issue list, because no
 * layer here checks a nested element's type.
 *
 * **What is withdrawn at every location this refuses is a deletion, not a round trip, and that is by
 * construction rather than by sampling**: the writer's skip is unconditional on the name, so at each
 * of these locations it dropped a property the sender wrote and emitted no element for it, with no
 * diagnostic at either end. The `contained` pair above came back as
 * `<contained><status value="entered-in-error"/></contained>`, which re-reads as a `contained`
 * backbone element rather than as a contained resource; the `name` pair came back as `<name/>`.
 *
 * **Raised last**, after every refusal above it in both writers, so a model that trips two keeps the
 * code it already reported and no case moves onto this one. The array-wrapped and the `null`
 * spellings of an untaggable type each trip an earlier one and keep it.
 *
 * @param node - The model about to be serialized to XML.
 * @throws {FhirSerializeError} With {@link SERIALIZE_ERROR_CODES.UNSERIALIZABLE_RESOURCE_TYPE}.
 * @internal
 */
export function assertXmlResourceType(node: FhirComplex): void {
  const elements = collectMarked(
    node,
    rootPath(typeOf(node) ?? "Resource"),
    lacksTaggableResourceType,
  );
  if (elements.length === 0) return;
  // The location names the property rather than the element carrying it, matching how the array
  // wrapper on the same property is already reported. `collectMarked` selects elements because the
  // question needs the siblings, and `childPath` bounds the segment exactly as every other
  // write-path location is bounded.
  const locations = elements.map((element) => childPath(element, "resourceType"));
  throw new FhirSerializeError(
    // Says what this refusal does not reach, in the wording the refusals beside it were narrowed to.
    // `serializeResource` emits a non-string `resourceType` through its ordinary path -- pinned by
    // the JSON half of the same test -- which is a statement about this shape, not about the rest of
    // the model: that writer's own declared exceptions still apply to everything else it carries.
    `cannot serialize to XML: ${String(locations.length)} location(s) carry a resourceType with no string to name a tag with, which this writer would delete while naming the element Resource; this refusal does not reach serializeResource`,
    SERIALIZE_ERROR_CODES.UNSERIALIZABLE_RESOURCE_TYPE,
    locations,
  );
}

/**
 * The characters that end or restructure a start tag, so a name containing one cannot occupy the
 * `Name` slot of `STag` / `EmptyElemTag` (XML 1.0 5th ed. §3.1). `S` is XML's own four whitespace
 * characters (§2.3), not a wider Unicode class: `\v`, `\f` and `U+00A0` sit inside a tag name
 * without ending it, and this library round-trips them today.
 */
const TAG_BREAKING = /[ \t\n\r/>=<]/u;

/**
 * The characters that, at the FRONT of a name, make `<` open something other than an element:
 * `<?` a processing instruction (§2.6) and `<!` a comment or markup declaration (§2.5, §2.8).
 * Neither is positional anywhere else, which is why this is a first-character test and not a
 * membership test like {@link TAG_BREAKING}.
 */
const TAG_OPENER_STEALING = new Set(["!", "?"]);

/**
 * Whether emitting `name` in an XML tag position would produce markup that does not re-read as the
 * one element the model holds.
 *
 * **The line is "does this library's own round trip survive it", not "is this a conformant XML
 * name", and the difference is the whole reason this refusal is narrow.** The strictly tidier rule
 * would be the `Name` production (XML 1.0 §2.3), but `a&b`, `1abc`, `-lead` and `a"b` all fail that
 * production while `serializeResourceXml` -> `parseResourceXml` returns them **unchanged today**.
 * Refusing those would withdraw a working round trip from models that read `valid: true`, which is
 * the cost the unbound-prefix residual was deferred rather than pay. So they are NOT refused here,
 * and they remain part of the same declared gap: a conformant third-party parser rejects them, and
 * this library keeps writing them.
 *
 * **What IS refused is the subset where nothing works today**, measured over 2,350 sampled names
 * (every code point `U+0001`-`U+02FF` at three positions, plus eight higher ones and a hand-written
 * adversarial set): the emitted markup either fails to re-read at all, or re-reads as a DIFFERENT
 * set of elements. The second is the one that decided the remedy. A JSON property name spelled
 * `zz value="1"/><status` reads with zero diagnostics and no `status`, and emits
 * `<zz value="1"/><status value="final"/>`, which a conformant parser accepts and this library
 * re-reads as an `Observation` **whose status is `final`**. That is a clinical value fabricated
 * across one round trip under `valid: true` on both sides, the same harm shape as the JSON writer
 * authoring `{}` for a value it never read.
 *
 * **Repairing rather than refusing is not available.** XML has no escape for an element name, so
 * the only alternatives to refusing are mangling the name (authoring a name the sender never
 * wrote) or emitting the breakout (authoring elements the sender never wrote). Both are the
 * fabrication class. Refusing invents nothing, and `serializeResource` escapes a member name, so
 * this refusal never reaches it and that route stays open. **Narrowed 2026-08-07 from "the JSON
 * writer still encodes the model correctly", which was false and had shipped**: that is a claim
 * about the whole model, and `serializeResource` has its own declared exceptions, so a model refused
 * here can carry one and emit it. Measured, not argued:
 * `{"resourceType":"Observation","name":[[{"family":"X"}]],"zz value=\"1\"/><status":1}` reads with
 * `UNKNOWN_PROPERTY` and `NESTED_ARRAY`, is refused here, and `serializeResource` emits it with
 * `"name":[[{"family":"X"}]]` intact -- an array inside an array, which is the first entry on that
 * writer's own exception list.
 *
 * **Nearly unreachable from `parseResourceXml`, and the exception is worth knowing because an
 * earlier draft of this comment claimed "unreachable, by construction" and that was false.** The raw
 * reader's tag scanner stops at exactly the {@link TAG_BREAKING} set and refuses an empty name, so
 * no tag it reads carries one of those. But a prefixed name has its prefix STRIPPED, which can move
 * a `!` or `?` to the front of the modeled name: `<a:!x xmlns:a="http://hl7.org/fhir" value="1"/>`
 * reads with zero issues and is refused here. Base wrote it as `<!x value="1"/>`, which this library
 * then could not re-read, so the refusal is the better of the two. It is still a document that used
 * to serialize and now does not.
 *
 * @param name - The tag name about to be written.
 * @returns `true` when the name must be refused.
 * @internal
 */
export function breaksTag(name: string): boolean {
  return name === "" || TAG_BREAKING.test(name) || TAG_OPENER_STEALING.has(name.slice(0, 1));
}

/**
 * Refuse to serialize a model whose tag positions hold names XML cannot spell.
 *
 * **`locations` never echoes the offending name**, which is the property that matters, because the
 * name is document content and one of the shapes it takes here is a forgery. Every name this refuses
 * also fails the far narrower `elementName` / `resourceTypeName` shapes that bound a location.
 *
 * **It does not follow that every location CONTAINS a `WITHHELD` segment, and that stronger sentence
 * was wrong.** A nested resource's type is reported at the location of the element wrapping it, so
 * a bad `resourceType` inside `contained` reports `Patient.contained[0]`: no withheld segment,
 * because the refused name never reached a segment at all. Both readings are safe; only the weaker
 * one is true.
 *
 * **The message says what this refusal does NOT reach, not that the model is fine elsewhere**, and
 * the difference is the whole correction. It used to end "serializeResource encodes this model
 * correctly", which is a claim about the whole model and is false: that writer has its own declared
 * exceptions and a model refused here can carry one. Narrowed 2026-08-07 to match the wording the
 * `div` refusal beside it already used, so the pair no longer contradicts each other in a consumer's
 * log.
 *
 * @param locations - The bounded locations whose name cannot be written, in walk order.
 * @throws {FhirSerializeError} With {@link SERIALIZE_ERROR_CODES.UNSERIALIZABLE_ELEMENT_NAME}.
 * @internal
 */
export function refuseUnserializableNames(locations: readonly string[]): never {
  throw new FhirSerializeError(
    `cannot serialize to XML: ${String(locations.length)} location(s) carry a name that cannot be written as an XML tag without changing which elements the document holds; serializeResource escapes a member name, so this refusal never reaches it`,
    SERIALIZE_ERROR_CODES.UNSERIALIZABLE_ELEMENT_NAME,
    locations,
  );
}

/**
 * Refuse to serialize a model whose `div` property carries markup the XML writer cannot emit as the
 * one element the model names.
 *
 * **`locations` never echoes the string**, for the same reason the name refusal never echoes the
 * name: it is document content, and one of the shapes it takes here is a forgery of a clinical
 * assertion. A `div` location is built from names the model already carries, so it is bounded by
 * `childPath` exactly as every other write-path location is.
 *
 * @param locations - The bounded locations whose `div` markup is refused, in walk order.
 * @throws {FhirSerializeError} With {@link SERIALIZE_ERROR_CODES.UNSERIALIZABLE_DIV_MARKUP}.
 * @internal
 */
export function refuseUnserializableDivMarkup(locations: readonly string[]): never {
  throw new FhirSerializeError(
    `cannot serialize to XML: ${String(locations.length)} div location(s) carry markup that would not be written as the one div element the model names; serializeResource carries the string as a string`,
    SERIALIZE_ERROR_CODES.UNSERIALIZABLE_DIV_MARKUP,
    locations,
  );
}
