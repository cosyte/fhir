/**
 * The write-path refusals, and the rule both of them are instances of: **a writer may decline to
 * hand a model back, but it may never author content of its own.**
 *
 * There are two, and they are refused at different scopes. {@link assertSerializable} runs in both
 * writers, because a dropped-character-data marker has no conformant encoding in either format.
 * {@link breaksTag} governs the XML writer only, because the harm is a name reaching a tag position,
 * and JSON escapes a member name so `serializeResource` encodes the same model correctly. Neither
 * refusal recognises anything new, invents a value, or changes a document that reads clean.
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
import type { FhirComplex } from "../model/node.js";
import { rootPath } from "../model/path.js";
import { typeOf } from "../safety/codes.js";
import { droppedText } from "../safety/status.js";

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
   * escapes a member name, so `serializeResource` encodes every one of these correctly and is the
   * route that stays open for such a model.
   *
   * See {@link breaksTag} for the exact predicate and for what is deliberately NOT refused.
   */
  UNSERIALIZABLE_ELEMENT_NAME: "UNSERIALIZABLE_ELEMENT_NAME",
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
 * fabrication class. Refusing invents nothing, and the JSON writer still encodes the model
 * correctly.
 *
 * **Unreachable from `parseResourceXml`, by construction rather than by measurement.** The raw
 * reader's tag scanner stops at exactly the {@link TAG_BREAKING} set, and refuses an empty name and
 * a `<!` / `<?` opener before a name is read at all, so no name it produces can satisfy this
 * predicate. Every model that reaches it came from JSON, or was built by hand.
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
 * `locations` never echoes the offending name: every name this refuses also fails the far narrower
 * `elementName` / `resourceTypeName` shapes that bound a location, so each one renders as
 * `WITHHELD`. That is asserted by a test rather than left to inspection, because the name is
 * document content and one of the shapes it takes here is a forgery.
 *
 * @param locations - The bounded locations whose name cannot be written, in walk order.
 * @throws {FhirSerializeError} With {@link SERIALIZE_ERROR_CODES.UNSERIALIZABLE_ELEMENT_NAME}.
 * @internal
 */
export function refuseUnserializableNames(locations: readonly string[]): never {
  throw new FhirSerializeError(
    `cannot serialize to XML: ${String(locations.length)} location(s) carry a name that cannot be written as an XML tag without changing which elements the document holds; serializeResource encodes this model correctly`,
    SERIALIZE_ERROR_CODES.UNSERIALIZABLE_ELEMENT_NAME,
    locations,
  );
}
