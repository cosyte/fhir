/**
 * The typed, unrecoverable fatals of the XML reader, and, above all, the **safety refusals** that
 * make the zero-dependency reader XXE- and billion-laughs-proof (roadmap §6).
 *
 * FHIR is transported as text, so the fuzz/attack surface of an XML codec is entity expansion and
 * external-entity resolution, not byte framing. The reader here is hardened by **refusing** the two
 * constructs those attacks need, loudly and up front, rather than by trying to bound their blast
 * radius after the fact:
 *
 * - **No DTD.** A `<!DOCTYPE …>` declaration is the only place an XML document can *define* an entity:
 *   a nested internal entity (the billion-laughs / exponential-expansion DoS) or an external one
 *   (`SYSTEM "file:///…"` / a URL, the XXE information-disclosure and SSRF vector). The reader
 *   refuses **any** DOCTYPE with {@link XML_FATAL_CODES.DTD_FORBIDDEN} before parsing a single
 *   element, so no entity is ever declared, and therefore none can be expanded or resolved.
 * - **No entities beyond the five predefined + numeric character references.** With DTDs refused, the
 *   only legal entity references are `&amp; &lt; &gt; &quot; &apos;` and `&#…;` / `&#x…;`. Any other
 *   `&name;` is, by construction, undefined, the reader refuses it with
 *   {@link XML_FATAL_CODES.UNDEFINED_ENTITY} rather than resolve, expand, or silently drop it. This
 *   is a second, independent guard: even a reference to an entity a (refused) DTD might have declared
 *   never resolves. Numeric character references do not nest, so no expansion bomb is possible.
 *
 * The reader never performs I/O and never resolves a URI, so there is no external fetch to disable,
 * the design simply gives it nothing to fetch. A pathologically deep element nesting is bounded by
 * {@link XML_FATAL_CODES.MAX_DEPTH_EXCEEDED} so adversarial input yields a typed error, never a stack
 * overflow.
 *
 * Every message is **value-free** (roadmap §7): it carries a coded reason and a byte `offset`, never
 * a slice of the offending document, because that slice could be PHI.
 *
 * @packageDocumentation
 */

/**
 * Stable string codes for the XML reader's unrecoverable fatals. The first two are the safety
 * refusals (see the module doc); the last two are ordinary well-formedness / DoS bounds.
 */
export const XML_FATAL_CODES = {
  /** The input is not well-formed XML (bad tag, mismatched close, unterminated string, …). */
  MALFORMED_XML: "MALFORMED_XML",
  /**
   * A `<!DOCTYPE …>` declaration was present. Refused unconditionally: a DTD is where entities are
   * declared, so refusing it closes the XXE **and** billion-laughs vectors at once (module doc).
   */
  DTD_FORBIDDEN: "DTD_FORBIDDEN",
  /**
   * An entity reference other than the five predefined (`&amp; &lt; &gt; &quot; &apos;`) or a
   * numeric character reference. Undefined by construction (DTDs are refused), so it is refused
   * rather than resolved, never expanded, never fetched, never dropped.
   */
  UNDEFINED_ENTITY: "UNDEFINED_ENTITY",
  /** Element nesting deeper than the reader's fixed bound, refused as a DoS guard, never a crash. */
  MAX_DEPTH_EXCEEDED: "MAX_DEPTH_EXCEEDED",
} as const;

/** Discriminant union of every {@link XML_FATAL_CODES} value. */
export type XmlFatalCode = (typeof XML_FATAL_CODES)[keyof typeof XML_FATAL_CODES];

/**
 * Thrown by the XML reader on an unrecoverable failure, a well-formedness error, a **refused** DTD
 * or entity (the safety refusals), or nesting past the depth bound. Carries the coded reason and a
 * byte `offset`, and, by design, **no** slice of the offending input, because that slice could be
 * PHI (roadmap §7).
 *
 * @example
 * ```ts
 * import { parseResourceXml, FhirXmlError, XML_FATAL_CODES } from "@cosyte/fhir";
 * try {
 *   parseResourceXml('<!DOCTYPE x [ <!ENTITY a "boom"> ]><Patient/>');
 * } catch (err) {
 *   if (err instanceof FhirXmlError && err.code === XML_FATAL_CODES.DTD_FORBIDDEN) {
 *     // the DTD was refused before any entity could be declared or expanded
 *   }
 * }
 * ```
 */
export class FhirXmlError extends Error {
  public readonly code: XmlFatalCode;
  /** Byte offset into the input where the failure was detected. */
  public readonly offset: number;

  /**
   * @param code - The fatal reason.
   * @param message - A PHI-safe description, must not embed any input value.
   * @param offset - The byte offset where the failure was detected.
   * @internal
   */
  public constructor(code: XmlFatalCode, message: string, offset: number) {
    super(message);
    this.name = "FhirXmlError";
    this.code = code;
    this.offset = offset;
  }
}
