/**
 * The write-path refusal that stops a dropped-character-data finding from laundering.
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
