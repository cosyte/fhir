/**
 * A zero-dependency, XXE- and billion-laughs-proof XML reader.
 *
 * This is the XML analogue of {@link ../codec/raw-json.js readRawJson}: a small recursive-descent
 * reader that turns XML text into a raw tree ({@link XmlNode}) preserving element order, attributes,
 * and text — with **no** external dependency and, by construction, **no** entity-expansion or
 * external-entity attack surface. The two hardening decisions live in {@link ./issues.js} and are
 * enforced here:
 *
 * 1. a `<!DOCTYPE …>` is refused (`DTD_FORBIDDEN`) before any element is parsed, so no entity — internal
 *    (billion-laughs) or external (XXE) — is ever *declared*; and
 * 2. any entity reference beyond the five predefined names and numeric character references is refused
 *    (`UNDEFINED_ENTITY`), so none is ever *resolved*.
 *
 * The reader performs no I/O, resolves no URI, and bounds nesting depth, so adversarial input yields a
 * typed {@link ./issues.js FhirXmlError}, never a hang, an OOM, a fetch, or a crash. It maps the FHIR
 * datatype layer no more than {@link ../codec/raw-json.js} maps FHIR JSON — that is the job of
 * {@link ./read.js}. Its only concern beyond well-formedness is to hand text and attribute values back
 * with the five predefined entities and numeric character references decoded, and everything else
 * verbatim.
 *
 * @packageDocumentation
 */

import { FhirXmlError, XML_FATAL_CODES } from "./issues.js";

/** A name/value attribute on an {@link XmlElement}. Values are already entity-decoded. */
export interface XmlAttribute {
  readonly name: string;
  readonly value: string;
}

/** An XML element node: a tag name, its attributes (source order), and its child nodes (source order). */
export interface XmlElement {
  readonly type: "element";
  readonly name: string;
  readonly attributes: readonly XmlAttribute[];
  readonly children: readonly XmlNode[];
}

/** An XML character-data node, already entity-decoded to its logical text. */
export interface XmlText {
  readonly type: "text";
  readonly value: string;
}

/** Any node in the raw XML tree. */
export type XmlNode = XmlElement | XmlText;

/**
 * The maximum element-nesting depth the reader will descend before refusing with
 * `MAX_DEPTH_EXCEEDED`. FHIR resources — even a Bundle of documents with contained resources — nest
 * far shallower than this; the bound exists only to turn a pathological adversarial document into a
 * typed error instead of a stack overflow.
 */
const MAX_DEPTH = 256;

/** The five entity names XML predefines; the only named entities a DTD-free document may reference. */
const PREDEFINED: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/** Whether a character (by code point) is XML whitespace. */
function isWs(c: string): boolean {
  return c === " " || c === "\t" || c === "\n" || c === "\r";
}

/**
 * A single-pass recursive-descent XML reader. One instance per parse; the public entry point is
 * {@link readRawXml}.
 *
 * @internal
 */
class RawXmlReader {
  readonly #src: string;
  #pos = 0;

  public constructor(src: string) {
    this.#src = src;
  }

  /** Parse the whole document: optional prolog, exactly one root element, optional trailing misc. */
  public parse(): XmlElement {
    this.skipProlog();
    if (this.#peek() !== "<") throw this.fail("Expected the root element");
    const root = this.parseElement(0);
    this.skipMisc();
    if (this.#pos < this.#src.length) {
      throw this.fail("Unexpected content after the root element");
    }
    return root;
  }

  #peek(offset = 0): string {
    const i = this.#pos + offset;
    return i < this.#src.length ? this.#src.charAt(i) : "";
  }

  #startsWith(s: string): boolean {
    return this.#src.startsWith(s, this.#pos);
  }

  private skipWhitespace(): void {
    while (this.#pos < this.#src.length && isWs(this.#peek())) this.#pos++;
  }

  /**
   * Skip the document prolog: whitespace, an optional XML declaration, comments and processing
   * instructions — and refuse a DTD. This is the first line of the safety guarantee: a `<!DOCTYPE`
   * is refused here, before any element (and hence any entity) is seen.
   */
  private skipProlog(): void {
    this.skipMisc();
  }

  /** Skip inter-element "misc": whitespace, comments, PIs, XML declaration. Refuse DTD / CDATA-at-top. */
  private skipMisc(): void {
    for (;;) {
      this.skipWhitespace();
      if (this.#startsWith("<?")) {
        this.skipProcessingInstruction();
      } else if (this.#startsWith("<!--")) {
        this.skipComment();
      } else if (this.#startsWith("<!DOCTYPE") || this.#startsWith("<!doctype")) {
        throw new FhirXmlError(
          XML_FATAL_CODES.DTD_FORBIDDEN,
          "A <!DOCTYPE …> declaration is refused: a DTD is the only place XML can declare an " +
            "entity, so refusing it closes the XXE and billion-laughs vectors at once.",
          this.#pos,
        );
      } else if (this.#startsWith("<!")) {
        // Any other markup declaration at this level (a stray CDATA, an entity/element decl) is
        // either a DTD fragment or unsupported — refuse rather than guess.
        throw new FhirXmlError(
          XML_FATAL_CODES.DTD_FORBIDDEN,
          "An unsupported markup declaration (<!…>) is refused outside of element content.",
          this.#pos,
        );
      } else {
        return;
      }
    }
  }

  private skipProcessingInstruction(): void {
    const end = this.#src.indexOf("?>", this.#pos + 2);
    if (end === -1) throw this.fail("Unterminated processing instruction");
    this.#pos = end + 2;
  }

  private skipComment(): void {
    const end = this.#src.indexOf("-->", this.#pos + 4);
    if (end === -1) throw this.fail("Unterminated comment");
    this.#pos = end + 3;
  }

  /** Parse one element (`<name …>…</name>` or `<name …/>`), starting at the `<`. */
  private parseElement(depth: number): XmlElement {
    if (depth >= MAX_DEPTH) {
      throw new FhirXmlError(
        XML_FATAL_CODES.MAX_DEPTH_EXCEEDED,
        `Element nesting exceeded the reader's depth bound (${String(MAX_DEPTH)}); refused as a DoS guard.`,
        this.#pos,
      );
    }
    this.#pos++; // consume '<'
    const name = this.parseName();
    if (name === "") throw this.fail("Expected an element name after '<'");
    const attributes = this.parseAttributes();

    if (this.#startsWith("/>")) {
      this.#pos += 2;
      return { type: "element", name, attributes, children: [] };
    }
    if (this.#peek() !== ">") throw this.fail("Expected '>' or '/>' to close the start tag");
    this.#pos++; // consume '>'

    const children = this.parseContent(name, depth);
    return { type: "element", name, attributes, children };
  }

  /** Parse an element's content up to and including its matching end tag; return its child nodes. */
  private parseContent(name: string, depth: number): XmlNode[] {
    const children: XmlNode[] = [];
    for (;;) {
      if (this.#pos >= this.#src.length) throw this.fail(`Unclosed element <${name}>`);
      if (this.#startsWith("</")) {
        this.#pos += 2;
        const closeName = this.parseName();
        this.skipWhitespace();
        if (this.#peek() !== ">") throw this.fail("Expected '>' to close the end tag");
        this.#pos++;
        if (closeName !== name) {
          throw this.fail(`Mismatched end tag </${closeName}> for <${name}>`);
        }
        return children;
      }
      if (this.#startsWith("<!--")) {
        this.skipComment();
        continue;
      }
      if (this.#startsWith("<![CDATA[")) {
        // CDATA carries no entity-expansion risk but FHIR does not use it (narrative is XHTML, and
        // deferred in Phase 8); refuse rather than partially model it.
        throw this.fail("CDATA sections are not supported");
      }
      if (this.#startsWith("<?")) {
        this.skipProcessingInstruction();
        continue;
      }
      if (this.#startsWith("<!")) {
        throw new FhirXmlError(
          XML_FATAL_CODES.DTD_FORBIDDEN,
          "A markup declaration (<!…>) inside element content is refused.",
          this.#pos,
        );
      }
      if (this.#peek() === "<") {
        children.push(this.parseElement(depth + 1));
        continue;
      }
      // Character data up to the next '<'.
      children.push(this.parseText());
    }
  }

  /** Parse an XML Name (letters, digits, and `_ - . :`), stopping at whitespace, `/`, `>`, or `=`. */
  private parseName(): string {
    const start = this.#pos;
    while (this.#pos < this.#src.length) {
      const c = this.#peek();
      if (isWs(c) || c === "/" || c === ">" || c === "=" || c === "<") break;
      this.#pos++;
    }
    return this.#src.slice(start, this.#pos);
  }

  /** Parse zero or more attributes after the element name, leaving `#pos` at `>` or `/`. */
  private parseAttributes(): XmlAttribute[] {
    const attributes: XmlAttribute[] = [];
    const seen = new Set<string>();
    for (;;) {
      this.skipWhitespace();
      const c = this.#peek();
      if (c === ">" || c === "/" || c === "") break;
      const name = this.parseName();
      if (name === "") throw this.fail("Expected an attribute name");
      this.skipWhitespace();
      if (this.#peek() !== "=") throw this.fail(`Expected '=' after attribute ${name}`);
      this.#pos++;
      this.skipWhitespace();
      const value = this.parseAttributeValue();
      if (seen.has(name)) throw this.fail(`Duplicate attribute ${name}`);
      seen.add(name);
      attributes.push({ name, value });
    }
    return attributes;
  }

  /** Parse a quoted attribute value, decoding entities. */
  private parseAttributeValue(): string {
    const quote = this.#peek();
    if (quote !== '"' && quote !== "'") throw this.fail("Expected a quoted attribute value");
    this.#pos++; // consume opening quote
    let out = "";
    for (;;) {
      if (this.#pos >= this.#src.length) throw this.fail("Unterminated attribute value");
      const c = this.#peek();
      if (c === quote) {
        this.#pos++;
        return out;
      }
      if (c === "<") throw this.fail("'<' is not allowed in an attribute value");
      if (c === "&") {
        out += this.parseEntity();
        continue;
      }
      out += c;
      this.#pos++;
    }
  }

  /** Parse character data up to the next `<`, decoding entities. */
  private parseText(): XmlText {
    let out = "";
    while (this.#pos < this.#src.length && this.#peek() !== "<") {
      const c = this.#peek();
      if (c === "&") {
        out += this.parseEntity();
        continue;
      }
      out += c;
      this.#pos++;
    }
    return { type: "text", value: out };
  }

  /**
   * Decode one entity reference at `#pos`. Accepts only the five predefined names and numeric
   * character references; **refuses** anything else with `UNDEFINED_ENTITY`. A named entity cannot
   * be legally defined (DTDs are refused), so refusing here means the reader never resolves, expands,
   * or fetches — the core of the XXE / billion-laughs guarantee.
   */
  private parseEntity(): string {
    const start = this.#pos;
    this.#pos++; // consume '&'
    const semi = this.#src.indexOf(";", this.#pos);
    // Bound the search so a lone '&' cannot scan the whole document.
    if (semi === -1 || semi - this.#pos > 32) {
      throw new FhirXmlError(
        XML_FATAL_CODES.UNDEFINED_ENTITY,
        "An '&' that does not begin a valid entity or character reference is refused.",
        start,
      );
    }
    const body = this.#src.slice(this.#pos, semi);
    this.#pos = semi + 1;
    if (body.startsWith("#")) {
      return this.decodeNumericReference(body, start);
    }
    // `Object.hasOwn` guard, not a bare `PREDEFINED[body]`: a bare index read would find inherited
    // `Object.prototype` members (`&constructor;`, `&toString;`, `&__proto__;`, …) and wrongly treat
    // them as "defined", resolving an entity the five-name allowlist never declared. Own-property only.
    const replacement = Object.hasOwn(PREDEFINED, body) ? PREDEFINED[body] : undefined;
    if (replacement === undefined) {
      throw new FhirXmlError(
        XML_FATAL_CODES.UNDEFINED_ENTITY,
        "An entity reference other than the five predefined XML entities or a numeric character " +
          "reference is undefined (DTDs are refused); refused, never resolved or expanded.",
        start,
      );
    }
    return replacement;
  }

  /** Decode a numeric character reference body (`#1234` or `#x1A`) to its code point. */
  private decodeNumericReference(body: string, start: number): string {
    const isHex = body.startsWith("#x") || body.startsWith("#X");
    const digits = isHex ? body.slice(2) : body.slice(1);
    const valid = isHex ? /^[0-9a-fA-F]+$/.test(digits) : /^[0-9]+$/.test(digits);
    if (!valid || digits.length === 0 || digits.length > 8) {
      throw new FhirXmlError(
        XML_FATAL_CODES.UNDEFINED_ENTITY,
        "A malformed numeric character reference is refused.",
        start,
      );
    }
    const code = Number.parseInt(digits, isHex ? 16 : 10);
    if (code > 0x10ffff) {
      throw new FhirXmlError(
        XML_FATAL_CODES.UNDEFINED_ENTITY,
        "A numeric character reference outside the Unicode range is refused.",
        start,
      );
    }
    return String.fromCodePoint(code);
  }

  private fail(message: string): FhirXmlError {
    return new FhirXmlError(XML_FATAL_CODES.MALFORMED_XML, `Malformed XML: ${message}`, this.#pos);
  }
}

/**
 * Parse an XML document into a raw {@link XmlElement} tree, preserving element/attribute order and
 * decoding the five predefined entities and numeric character references. **Refuses** any DTD
 * (`DTD_FORBIDDEN`) or non-predefined entity (`UNDEFINED_ENTITY`), and bounds nesting depth — so it
 * is XXE- and billion-laughs-safe and never crashes on adversarial input. Throws
 * {@link FhirXmlError} on any refusal or well-formedness error, with a byte `offset` and no snippet.
 *
 * @param src - The XML text.
 * @example
 * ```ts
 * import { readRawXml } from "@cosyte/fhir";
 * const root = readRawXml('<Patient xmlns="http://hl7.org/fhir"><active value="true"/></Patient>');
 * root.name; // "Patient"
 * ```
 */
export function readRawXml(src: string): XmlElement {
  return new RawXmlReader(src).parse();
}
