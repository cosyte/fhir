/**
 * A precision-preserving JSON reader.
 *
 * `JSON.parse` is **non-conformant for FHIR** (architecture ADR 0001, json.html): it maps every JSON
 * number to an IEEE-754 double, so `0.010` becomes `0.01` and a 64-bit-range integer loses its
 * low-order digits *before* any FHIR-aware code runs. A reviver cannot recover this, it only sees
 * the already-corrupted `number`. So the reader here is a small recursive-descent JSON parser whose
 * only job beyond correctness is to hand every number token back as its **exact source text**.
 *
 * The output is a raw JSON tree ({@link RawJson}) that preserves member order (FHIR allows
 * `resourceType` in any position) and number literals verbatim. Malformed input throws a value-free
 * {@link FhirCodecError} carrying a byte offset, never a snippet (the snippet could be PHI).
 *
 * @packageDocumentation
 */

import { FATAL_CODES, FhirCodecError } from "./issues.js";

/** A member of a {@link RawObject}, preserving key and source order. */
export interface RawMember {
  readonly key: string;
  readonly value: RawJson;
}

/** A JSON object node, members in source order (duplicate keys preserved as separate members). */
export interface RawObject {
  readonly t: "obj";
  readonly members: readonly RawMember[];
}

/** A JSON array node. */
export interface RawArray {
  readonly t: "arr";
  readonly items: readonly RawJson[];
}

/** A JSON string node, already unescaped to its logical value. */
export interface RawString {
  readonly t: "str";
  readonly value: string;
}

/** A JSON number node, preserved as its **exact** source text, never a JavaScript `number`. */
export interface RawNumber {
  readonly t: "num";
  readonly raw: string;
}

/** A JSON boolean node. */
export interface RawBool {
  readonly t: "bool";
  readonly value: boolean;
}

/** A JSON null node. */
export interface RawNull {
  readonly t: "null";
}

/** Any node in the raw JSON tree. */
export type RawJson = RawObject | RawArray | RawString | RawNumber | RawBool | RawNull;

/**
 * The maximum object/array nesting depth the reader will descend before refusing with
 * `MAX_DEPTH_EXCEEDED`. FHIR resources, even a Bundle of documents with contained resources, nest
 * far shallower than this; the bound exists only to turn a pathological adversarial document (a tower
 * of `[[[[…]]]]` or `{"a":{"a":…}}`) into a typed error instead of a V8 stack overflow. Kept equal to
 * the XML reader's `MAX_DEPTH` (256) so the two codecs bound the same data model identically.
 */
const MAX_DEPTH = 256;

/** Character codes used by the tokenizer. Plain numeric constants (not an enum) so comparisons
 * against `charCodeAt()` results stay number-vs-number. */
const Code = {
  Tab: 9,
  LineFeed: 10,
  CarriageReturn: 13,
  Space: 32,
  Quote: 34,
  Plus: 43,
  Comma: 44,
  Minus: 45,
  Dot: 46,
  Slash: 47,
  Zero: 48,
  Nine: 57,
  Colon: 58,
  UpperE: 69,
  OpenBracket: 91,
  Backslash: 92,
  CloseBracket: 93,
  LowerB: 98,
  LowerE: 101,
  LowerF: 102,
  LowerN: 110,
  LowerR: 114,
  LowerT: 116,
  LowerU: 117,
  OpenBrace: 123,
  CloseBrace: 125,
} as const;

/**
 * A single-pass recursive-descent JSON reader. Instances are throwaway (one per parse); the public
 * entry point is {@link readRawJson}.
 *
 * @internal
 */
class RawJsonReader {
  readonly #src: string;
  #pos = 0;

  public constructor(src: string) {
    this.#src = src;
  }

  /** Parse the whole input as a single JSON value; reject trailing non-whitespace. */
  public parse(): RawJson {
    this.skipWhitespace();
    if (this.#pos >= this.#src.length) {
      throw this.fail("Unexpected end of input: the document is empty");
    }
    const value = this.parseValue(0);
    this.skipWhitespace();
    if (this.#pos < this.#src.length) {
      throw this.fail("Unexpected trailing content after the top-level JSON value");
    }
    return value;
  }

  #peek(): number {
    return this.#pos < this.#src.length ? this.#src.charCodeAt(this.#pos) : -1;
  }

  private skipWhitespace(): void {
    while (this.#pos < this.#src.length) {
      const c = this.#src.charCodeAt(this.#pos);
      if (c === Code.Space || c === Code.Tab || c === Code.LineFeed || c === Code.CarriageReturn) {
        this.#pos++;
      } else {
        break;
      }
    }
  }

  private parseValue(depth: number): RawJson {
    // Refuse pathological nesting as a DoS guard, before descending, a typed fatal instead of a V8
    // stack overflow (mirrors the XML reader's MAX_DEPTH bound over the same data model).
    if (depth > MAX_DEPTH) {
      throw new FhirCodecError(
        FATAL_CODES.MAX_DEPTH_EXCEEDED,
        `JSON nesting exceeded the reader's depth bound (${String(MAX_DEPTH)}); refused as a DoS guard.`,
        { offset: this.#pos },
      );
    }
    const c = this.#peek();
    switch (c) {
      case Code.OpenBrace:
        return this.parseObject(depth);
      case Code.OpenBracket:
        return this.parseArray(depth);
      case Code.Quote:
        return { t: "str", value: this.parseString() };
      case Code.LowerT:
        return this.parseLiteral("true", { t: "bool", value: true });
      case Code.LowerF:
        return this.parseLiteral("false", { t: "bool", value: false });
      case Code.LowerN:
        return this.parseLiteral("null", { t: "null" });
      default:
        if (c === Code.Minus || (c >= Code.Zero && c <= Code.Nine)) return this.parseNumber();
        throw this.fail("Unexpected character where a JSON value was expected");
    }
  }

  private parseLiteral(word: string, node: RawJson): RawJson {
    if (this.#src.startsWith(word, this.#pos)) {
      this.#pos += word.length;
      return node;
    }
    throw this.fail(`Invalid literal: expected "${word}"`);
  }

  private parseObject(depth: number): RawObject {
    this.#pos++; // consume '{'
    const members: RawMember[] = [];
    this.skipWhitespace();
    if (this.#peek() === Code.CloseBrace) {
      this.#pos++;
      return { t: "obj", members };
    }
    for (;;) {
      this.skipWhitespace();
      if (this.#peek() !== Code.Quote) throw this.fail("Expected a string key in object");
      const key = this.parseString();
      this.skipWhitespace();
      if (this.#peek() !== Code.Colon) throw this.fail("Expected ':' after object key");
      this.#pos++;
      this.skipWhitespace();
      members.push({ key, value: this.parseValue(depth + 1) });
      this.skipWhitespace();
      const c = this.#peek();
      if (c === Code.Comma) {
        this.#pos++;
        continue;
      }
      if (c === Code.CloseBrace) {
        this.#pos++;
        return { t: "obj", members };
      }
      throw this.fail("Expected ',' or '}' in object");
    }
  }

  private parseArray(depth: number): RawArray {
    this.#pos++; // consume '['
    const items: RawJson[] = [];
    this.skipWhitespace();
    if (this.#peek() === Code.CloseBracket) {
      this.#pos++;
      return { t: "arr", items };
    }
    for (;;) {
      this.skipWhitespace();
      items.push(this.parseValue(depth + 1));
      this.skipWhitespace();
      const c = this.#peek();
      if (c === Code.Comma) {
        this.#pos++;
        continue;
      }
      if (c === Code.CloseBracket) {
        this.#pos++;
        return { t: "arr", items };
      }
      throw this.fail("Expected ',' or ']' in array");
    }
  }

  private parseString(): string {
    this.#pos++; // consume opening '"'
    let out = "";
    for (;;) {
      if (this.#pos >= this.#src.length) throw this.fail("Unterminated string");
      const c = this.#src.charCodeAt(this.#pos);
      if (c === Code.Quote) {
        this.#pos++;
        return out;
      }
      if (c === Code.Backslash) {
        out += this.parseEscape();
        continue;
      }
      if (c < Code.Space) throw this.fail("Unescaped control character in string");
      out += this.#src[this.#pos];
      this.#pos++;
    }
  }

  private parseEscape(): string {
    this.#pos++; // consume '\'
    if (this.#pos >= this.#src.length) throw this.fail("Unterminated escape sequence");
    const c = this.#src.charCodeAt(this.#pos);
    this.#pos++;
    switch (c) {
      case Code.Quote:
        return '"';
      case Code.Backslash:
        return "\\";
      case Code.Slash:
        return "/";
      case Code.LowerB:
        return "\b";
      case Code.LowerF:
        return "\f";
      case Code.LowerN:
        return "\n";
      case Code.LowerR:
        return "\r";
      case Code.LowerT:
        return "\t";
      case Code.LowerU:
        return this.parseUnicodeEscape();
      default:
        throw this.fail("Invalid escape sequence in string");
    }
  }

  private parseUnicodeEscape(): string {
    const hex = this.#src.slice(this.#pos, this.#pos + 4);
    if (hex.length !== 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) {
      throw this.fail("Invalid \\u escape: expected four hex digits");
    }
    this.#pos += 4;
    return String.fromCharCode(Number.parseInt(hex, 16));
  }

  private parseNumber(): RawNumber {
    const start = this.#pos;
    if (this.#peek() === Code.Minus) this.#pos++;

    // Integer part: a single 0, or a nonzero digit followed by more digits.
    if (this.#peek() === Code.Zero) {
      this.#pos++;
    } else if (this.isDigit(this.#peek())) {
      while (this.isDigit(this.#peek())) this.#pos++;
    } else {
      throw this.fail("Invalid number: missing integer digits");
    }

    // Fraction.
    if (this.#peek() === Code.Dot) {
      this.#pos++;
      if (!this.isDigit(this.#peek())) throw this.fail("Invalid number: missing fraction digits");
      while (this.isDigit(this.#peek())) this.#pos++;
    }

    // Exponent.
    const e = this.#peek();
    if (e === Code.LowerE || e === Code.UpperE) {
      this.#pos++;
      const sign = this.#peek();
      if (sign === Code.Plus || sign === Code.Minus) this.#pos++;
      if (!this.isDigit(this.#peek())) throw this.fail("Invalid number: missing exponent digits");
      while (this.isDigit(this.#peek())) this.#pos++;
    }

    return { t: "num", raw: this.#src.slice(start, this.#pos) };
  }

  private isDigit(c: number): boolean {
    return c >= Code.Zero && c <= Code.Nine;
  }

  private fail(message: string): FhirCodecError {
    return new FhirCodecError(FATAL_CODES.MALFORMED_JSON, `Malformed JSON: ${message}`, {
      offset: this.#pos,
    });
  }
}

/**
 * Parse a JSON document into a {@link RawJson} tree that preserves number literals verbatim and
 * member order. Throws {@link FhirCodecError} (`MALFORMED_JSON`) on invalid input, or
 * (`MAX_DEPTH_EXCEEDED`) when nesting passes the reader's fixed depth bound, both value-free, with a
 * byte `offset` and no snippet.
 *
 * @param src - The JSON text.
 * @example
 * ```ts
 * import { readRawJson } from "@cosyte/fhir";
 * const tree = readRawJson('{"v":0.010}');
 * // the number node carries raw === "0.010", the trailing zero is intact
 * ```
 */
export function readRawJson(src: string): RawJson {
  return new RawJsonReader(src).parse();
}
