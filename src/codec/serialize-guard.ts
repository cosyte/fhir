/**
 * The write-path refusals: the places a writer declines to hand a model back rather than encode it
 * into something that re-reads as content nobody wrote.
 *
 * {@link assertSerializable} runs in both writers, because a dropped-character-data marker has no
 * conformant encoding in either format. {@link breaksTag} governs the XML writer only, because the
 * harm is a name reaching a tag position, and JSON escapes a member name so no name reaches this
 * refusal there. {@link refuseUnserializableDivMarkup} is raised by the XML writer for the same
 * reason, at its one raw-markup site: JSON carries the string as a string.
 * {@link assertXmlSerializable} is XML-only for the mirror-image reason: the shapes it refuses are
 * ones the JSON writer hands back, and XML has no channel to hand them back into. No refusal here
 * recognises anything new, invents a value, or changes a document that reads clean.
 *
 * **This module is a list of the refusals it implements, NOT a closed account of what a writer can
 * author.** The predicate behind the third one lives at its site in `../xml/write.js`, next to the
 * code that emits the markup, because a copy here would be free to disagree with it.
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
import type { FhirComplex, FhirNode } from "../model/node.js";
import { rootPath } from "../model/path.js";
import { typeOf } from "../safety/codes.js";
import { collectMarked, droppedText } from "../safety/status.js";

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
   * refusal does reach one**, so read that as the refusal's own limit rather than as a route the
   * shape always survives. See {@link assertXmlSerializable}.
   *
   * XML has no array-of-arrays, no `_`-sibling and no `null`, so the XML writer has nowhere to put
   * any of it and emits the element the reader was left holding: an empty one, or none. That output
   * re-reads with an empty issue list, so the finding the reader raised is gone after one trip.
   *
   * See {@link assertXmlSerializable} for the exact set of markers and for what it does NOT cover.
   */
  UNSERIALIZABLE_JSON_ONLY_SHAPE: "UNSERIALIZABLE_JSON_ONLY_SHAPE",
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
 * a marker sitting in a member a repeated property name shadowed is dropped by that writer too (see
 * the walk, below).
 *
 * **Raised last**, after the name and `div` refusals, so a model that trips two keeps the code it
 * already reported and no case moves onto this one.
 *
 * **The set walked is `collectMarked`'s**, the same walk {@link droppedText} and `nestedArrays` use:
 * every node at every depth, a primitive's `extension` metadata, and members a repeated property
 * name shadowed. That last one is wider than the XML writer's own walk, which visits `properties`
 * only, so `{"name":[[{"family":"Roe"}]],"name":[{"family":"Roe"}]}` is refused for a marker sitting
 * in a member the writer would never have reached. Wider in the direction that refuses more, and the
 * JSON writer drops that member too, so it is not a loss this refusal invented -- **but it is the one
 * case where neither writer carries the shape, so do not read the message as pointing at a route
 * that keeps it.** The location it reports is the property, and a consumer resolving that location
 * reaches the **surviving** member rather than the shadowed one, because FHIRPath cannot address a
 * shadowed member at all: the same reason `collectMarked` de-duplicates two markers at one location.
 * `DUPLICATE_PROPERTY` and the safety refusal are what carry that document.
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
