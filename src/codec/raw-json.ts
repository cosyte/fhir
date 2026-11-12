/**
 * A precision-preserving JSON reader.
 *
 * `JSON.parse` is **non-conformant for FHIR** (json.html): it maps every JSON
 * number to an IEEE-754 double, so `0.010` becomes `0.01` and a 64-bit-range integer loses its
 * low-order digits *before* any FHIR-aware code runs. A reviver cannot recover this, it only sees
 * the already-corrupted `number`. So the reader here is a small recursive-descent JSON parser whose
 * only job beyond correctness is to hand every number token back as its **exact source text**.
 *
 * The output is a raw JSON tree ({@link RawJson}) that preserves member order (FHIR allows
 * `resourceType` in any position) and number literals verbatim. Malformed input throws a value-free
 * {@link FhirCodecError} carrying an offset, never a snippet (the snippet could be PHI).
 *
 * The document is checked and read first into a flat list of tokens ({@link JsonTape}), and the
 * tree is made from that list: all at once by {@link readRawJson}, or one part at a time as it is
 * read by {@link readRawJsonLazily}, which is how `parseResource` reads text without holding the
 * whole raw tree alive beside the model it builds.
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
 * Render a raw JSON tree back to compact JSON text, exactly as it was read: member order preserved,
 * every member of a repeated key kept, and number tokens emitted from their verbatim source text so
 * a decimal never passes through a JavaScript `number`.
 *
 * Total over {@link RawJson} and bounded by the reader's own depth limit, so it terminates on
 * anything the reader accepted. Strings are re-escaped canonically by `JSON.stringify`, which is the
 * same normalization the FHIR writer applies to every other string it emits.
 *
 * @internal
 */
export function rawJsonText(node: RawJson): string {
  switch (node.t) {
    case "str":
      return JSON.stringify(node.value);
    case "num":
      return node.raw;
    case "bool":
      return node.value ? "true" : "false";
    case "null":
      return "null";
    case "arr":
      return `[${node.items.map(rawJsonText).join(",")}]`;
    case "obj":
      return `{${node.members
        .map((member) => `${JSON.stringify(member.key)}:${rawJsonText(member.value)}`)
        .join(",")}}`;
  }
}

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
  Underscore: 95,
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
 * The characters a string's text stops at: the closing quote, an escape, and an unescaped control
 * character, which is malformed. Searched from `lastIndex` (the `g` flag); without the `u` flag it
 * reads UTF-16 code units, as `charCodeAt` does.
 */
const STRING_STOP = /["\\\u0000-\u001f]/g;

/** After this many plain characters in one run, the rest of the run is found by {@link STRING_STOP}. */
const LONG_RUN = 32;

/** The kinds of token a {@link JsonTape} holds, each in 3 bits. */
const Tok = {
  Null: 0,
  /** An object: its member count, and the index of the token after its last member. */
  Obj: 1,
  /** An array: its item count, and the index of the token after its last item. */
  Arr: 2,
  /** A string with no escape: where its text starts and ends in the source. */
  Str: 3,
  /** A string with at least one escape: where its text starts and ends in the source. */
  EscStr: 4,
  /** A number: where its text starts and ends in the source. */
  Num: 5,
  True: 6,
  False: 7,
} as const;

/**
 * The words a token takes on a tape. The first holds the token's kind in its low 3 bits and its
 * first number above them (`a * 8 + kind`); the second holds its second number. The first number is
 * a source offset or a count, both under 2^29 because a JavaScript string is (V8 caps a string's
 * length below 2^29), so it fits in 29 bits.
 */
const WORDS = 2;

/** The reused tape's length, in words; a read that needs more grows out of it into its own. */
const SCRATCH_WORDS = WORDS * 8192;

/** The tape reused by one read at a time (see {@link readJsonTape}), made on first use. */
let scratch: Uint32Array | undefined;

/** Whether {@link scratch} is free to be taken. */
let scratchFree = true;

/**
 * The last tape a read that took {@link scratch} grew out of it into, held weakly so the collector
 * can take it back. A read of a large document after another one reuses it instead of making a
 * tape of several MiB each time, memory outside the heap the collector would otherwise count
 * towards its next full collection. Only the read holding {@link scratch} uses it.
 */
let spare: WeakRef<Uint32Array> | undefined;

/**
 * A JSON document read into a flat list of tokens, in source order: an object or an array is one
 * token followed by its members' or items' tokens, an object member is its key's string token
 * followed by its value's tokens. A string or a number is kept as where its text lies in the source,
 * so the tape holds no string of its own. The tokens are plain numbers in one typed array, which the
 * garbage collector does not trace, so a tape of a large document costs it nothing to keep alive.
 *
 * @internal
 */
export interface JsonTape {
  readonly src: string;
  readonly tokens: Uint32Array;
  /** Whether the read took the reused tape, which it holds until it is handed back. */
  readonly borrowed: boolean;
}

/** A token's kind. */
function kindAt(tokens: Uint32Array, index: number): number {
  return (tokens[WORDS * index] as number) & 7;
}

/** A token's first number: a container's count, or where a string or number starts. */
function firstAt(tokens: Uint32Array, index: number): number {
  return (tokens[WORDS * index] as number) >>> 3;
}

/** A token's second number: the token after a container, or where a string or number ends. */
function secondAt(tokens: Uint32Array, index: number): number {
  return tokens[WORDS * index + 1] as number;
}

/** About one token for every 8 characters of a typical document; a tape grows if it needs more. */
function estimatedTokens(src: string): number {
  return (src.length >> 3) + 16;
}

/**
 * A single-pass recursive-descent JSON reader that writes a {@link JsonTape}. Instances are
 * throwaway (one per parse); the entry points are {@link readRawJson} and {@link readRawJsonLazily}.
 *
 * @internal
 */
class JsonTokenizer {
  readonly #src: string;
  #pos = 0;
  #tokens: Uint32Array;
  /** Tokens written so far. */
  #count = 0;
  /**
   * Whether this read took the reused tape. It holds it until the tape is handed back, even after
   * it has grown out of it into a tape of its own.
   */
  readonly #borrowed: boolean;

  public constructor(src: string, mayUseScratch: boolean) {
    this.#src = src;
    // The reused tape when it is free, whatever the document's size: a large document with few
    // tokens (a base64 attachment) then needs no tape of its own, and one with many grows out of it.
    this.#borrowed = mayUseScratch && scratchFree;
    if (this.#borrowed) {
      scratchFree = false;
      this.#tokens = scratch ??= new Uint32Array(SCRATCH_WORDS);
    } else {
      this.#tokens = new Uint32Array(WORDS * estimatedTokens(src));
    }
  }

  /** Read the whole input as a single JSON value; reject trailing non-whitespace. */
  public tokenize(): JsonTape {
    try {
      this.skipWhitespace();
      if (this.#pos >= this.#src.length) {
        throw this.fail("Unexpected end of input: the document is empty");
      }
      this.parseValue(0);
      this.skipWhitespace();
      if (this.#pos < this.#src.length) {
        throw this.fail("Unexpected trailing content after the top-level JSON value");
      }
    } catch (error) {
      releaseJsonTape(this.#tape());
      throw error;
    }
    return this.#tape();
  }

  #tape(): JsonTape {
    return { src: this.#src, tokens: this.#tokens, borrowed: this.#borrowed };
  }

  /** Write one token; returns its index. */
  #emit(kind: number, a: number, b: number): number {
    let tokens = this.#tokens;
    const index = this.#count;
    const slot = WORDS * index;
    if (slot + WORDS > tokens.length) tokens = this.#grow();
    tokens[slot] = a * 8 + kind;
    tokens[slot + 1] = b;
    this.#count = index + 1;
    return index;
  }

  /** Move the tape to a longer one, the spare when this read holds the reused tape and it is long enough. */
  #grow(): Uint32Array {
    const tokens = this.#tokens;
    const tokensNow = tokens.length / WORDS;
    const words = WORDS * Math.max(tokensNow + (tokensNow >> 1), estimatedTokens(this.#src));
    const kept = this.#borrowed ? spare?.deref() : undefined;
    let grown: Uint32Array;
    if (kept !== undefined && kept.length >= words) {
      grown = kept;
    } else {
      grown = new Uint32Array(words);
      if (this.#borrowed) spare = new WeakRef(grown);
    }
    grown.set(tokens);
    this.#tokens = grown;
    return grown;
  }

  /** Close the object or array token at `index`: its count, and the index of the token after it. */
  #close(index: number, kind: number, count: number): void {
    const slot = WORDS * index;
    this.#tokens[slot] = count * 8 + kind;
    this.#tokens[slot + 1] = this.#count;
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

  private parseValue(depth: number): void {
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
        this.parseObject(depth);
        return;
      case Code.OpenBracket:
        this.parseArray(depth);
        return;
      case Code.Quote:
        this.parseString();
        return;
      case Code.LowerT:
        this.parseLiteral("true", Tok.True);
        return;
      case Code.LowerF:
        this.parseLiteral("false", Tok.False);
        return;
      case Code.LowerN:
        this.parseLiteral("null", Tok.Null);
        return;
      default:
        if (c === Code.Minus || (c >= Code.Zero && c <= Code.Nine)) {
          this.parseNumber();
          return;
        }
        throw this.fail("Unexpected character where a JSON value was expected");
    }
  }

  private parseLiteral(word: string, kind: number): void {
    if (this.#src.startsWith(word, this.#pos)) {
      this.#pos += word.length;
      this.#emit(kind, 0, 0);
      return;
    }
    throw this.fail(`Invalid literal: expected "${word}"`);
  }

  private parseObject(depth: number): void {
    this.#pos++; // consume '{'
    const index = this.#emit(Tok.Obj, 0, 0);
    this.skipWhitespace();
    if (this.#peek() === Code.CloseBrace) {
      this.#pos++;
      this.#close(index, Tok.Obj, 0);
      return;
    }
    let count = 0;
    for (;;) {
      this.skipWhitespace();
      if (this.#peek() !== Code.Quote) throw this.fail("Expected a string key in object");
      this.parseString();
      this.skipWhitespace();
      if (this.#peek() !== Code.Colon) throw this.fail("Expected ':' after object key");
      this.#pos++;
      this.skipWhitespace();
      this.parseValue(depth + 1);
      count++;
      this.skipWhitespace();
      const c = this.#peek();
      if (c === Code.Comma) {
        this.#pos++;
        continue;
      }
      if (c === Code.CloseBrace) {
        this.#pos++;
        this.#close(index, Tok.Obj, count);
        return;
      }
      throw this.fail("Expected ',' or '}' in object");
    }
  }

  private parseArray(depth: number): void {
    this.#pos++; // consume '['
    const index = this.#emit(Tok.Arr, 0, 0);
    this.skipWhitespace();
    if (this.#peek() === Code.CloseBracket) {
      this.#pos++;
      this.#close(index, Tok.Arr, 0);
      return;
    }
    let count = 0;
    for (;;) {
      this.skipWhitespace();
      this.parseValue(depth + 1);
      count++;
      this.skipWhitespace();
      const c = this.#peek();
      if (c === Code.Comma) {
        this.#pos++;
        continue;
      }
      if (c === Code.CloseBracket) {
        this.#pos++;
        this.#close(index, Tok.Arr, count);
        return;
      }
      throw this.fail("Expected ',' or ']' in array");
    }
  }

  /**
   * Read a string token: check it and write where its text lies. The text itself is taken from the
   * source only when a value is built from the token ({@link decodeString}). Plain characters are
   * crossed a run at a time, and the checks and the offsets a malformed string reports are the same
   * as reading a character at a time.
   */
  private parseString(): void {
    const src = this.#src;
    const end = src.length;
    const start = this.#pos + 1; // past the opening '"'
    let pos = start;
    let runStart = pos;
    let escaped = false;
    for (;;) {
      if (pos >= end) {
        this.#pos = pos;
        throw this.fail("Unterminated string");
      }
      const c = src.charCodeAt(pos);
      if (c === Code.Quote) {
        this.#pos = pos + 1;
        this.#emit(escaped ? Tok.EscStr : Tok.Str, start, pos);
        return;
      }
      if (c === Code.Backslash) {
        this.#pos = pos;
        this.skipEscape();
        pos = this.#pos;
        runStart = pos;
        escaped = true;
        continue;
      }
      if (c < Code.Space) {
        this.#pos = pos;
        throw this.fail("Unescaped control character in string");
      }
      pos++;
      // A run longer than a few characters (a base64 attachment) is crossed by the regular
      // expression engine, which finds the next character this loop would stop at much faster
      // than a character at a time. Either way the loop resumes at that character, or at the end.
      if (pos - runStart === LONG_RUN) {
        STRING_STOP.lastIndex = pos;
        pos = STRING_STOP.test(src) ? STRING_STOP.lastIndex - 1 : end;
      }
    }
  }

  /** Check one escape sequence and step past it. */
  private skipEscape(): void {
    this.#pos++; // consume '\'
    if (this.#pos >= this.#src.length) throw this.fail("Unterminated escape sequence");
    const c = this.#src.charCodeAt(this.#pos);
    this.#pos++;
    switch (c) {
      case Code.Quote:
      case Code.Backslash:
      case Code.Slash:
      case Code.LowerB:
      case Code.LowerF:
      case Code.LowerN:
      case Code.LowerR:
      case Code.LowerT:
        return;
      case Code.LowerU: {
        const hex = this.#src.slice(this.#pos, this.#pos + 4);
        if (hex.length !== 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) {
          throw this.fail("Invalid \\u escape: expected four hex digits");
        }
        this.#pos += 4;
        return;
      }
      default:
        throw this.fail("Invalid escape sequence in string");
    }
  }

  private parseNumber(): void {
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

    this.#emit(Tok.Num, start, this.#pos);
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
 * The logical value of a string the tokenizer checked and found to hold escapes: its text from
 * `start` up to the closing quote at `end`. The text between escapes is taken a run at a time with
 * one `slice`.
 */
function decodeString(src: string, start: number, end: number): string {
  let out = "";
  let runStart = start;
  let pos = src.indexOf("\\", start);
  while (pos !== -1 && pos < end) {
    if (pos > runStart) out += src.slice(runStart, pos);
    const c = src.charCodeAt(pos + 1);
    pos += 2;
    switch (c) {
      case Code.Quote:
        out += '"';
        break;
      case Code.Backslash:
        out += "\\";
        break;
      case Code.Slash:
        out += "/";
        break;
      case Code.LowerB:
        out += "\b";
        break;
      case Code.LowerF:
        out += "\f";
        break;
      case Code.LowerN:
        out += "\n";
        break;
      case Code.LowerR:
        out += "\r";
        break;
      case Code.LowerT:
        out += "\t";
        break;
      default:
        // The tokenizer let no other escape through: this is `\u` and its four hex digits.
        out += String.fromCharCode(Number.parseInt(src.slice(pos, pos + 4), 16));
        pos += 4;
    }
    runStart = pos;
    pos = src.indexOf("\\", pos);
  }
  return runStart === end ? out : out + src.slice(runStart, end);
}

/** The string a string token stands for. */
function stringAt(tape: JsonTape, index: number): string {
  const { src, tokens } = tape;
  const start = firstAt(tokens, index);
  const end = secondAt(tokens, index);
  return kindAt(tokens, index) === Tok.EscStr
    ? decodeString(src, start, end)
    : src.slice(start, end);
}

/** The index of the token after the value that starts at `index`. */
function after(tokens: Uint32Array, index: number): number {
  const kind = kindAt(tokens, index);
  return kind === Tok.Obj || kind === Tok.Arr ? secondAt(tokens, index) : index + 1;
}

/** The node of a scalar token. */
function scalarAt(tape: JsonTape, index: number): RawJson {
  const tokens = tape.tokens;
  const kind = kindAt(tokens, index);
  if (kind === Tok.Num) {
    return { t: "num", raw: tape.src.slice(firstAt(tokens, index), secondAt(tokens, index)) };
  }
  if (kind === Tok.True) return { t: "bool", value: true };
  if (kind === Tok.False) return { t: "bool", value: false };
  if (kind === Tok.Null) return { t: "null" };
  return { t: "str", value: stringAt(tape, index) };
}

/** The whole tree of the value at `index`, built at once. */
function treeAt(tape: JsonTape, index: number): RawJson {
  const tokens = tape.tokens;
  const kind = kindAt(tokens, index);
  if (kind === Tok.Obj) {
    const count = firstAt(tokens, index);
    // Made at its exact length: an array grown a member at a time holds spare capacity, and a
    // document is mostly small objects.
    const members = new Array<RawMember>(count);
    let at = index + 1;
    for (let m = 0; m < count; m++) {
      members[m] = { key: stringAt(tape, at), value: treeAt(tape, at + 1) };
      at = after(tokens, at + 1);
    }
    return { t: "obj", members };
  }
  if (kind === Tok.Arr) {
    const count = firstAt(tokens, index);
    const items = new Array<RawJson>(count);
    let at = index + 1;
    for (let i = 0; i < count; i++) {
      items[i] = treeAt(tape, at);
      at = after(tokens, at);
    }
    return { t: "arr", items };
  }
  return scalarAt(tape, index);
}

/** The kinds of value a tape token stands for, as {@link RawJson} names them. */
const TYPE_OF_KIND: readonly RawJson["t"][] = [
  "null",
  "obj",
  "arr",
  "str",
  "str",
  "num",
  "bool",
  "bool",
];

/**
 * What a reader that builds straight from a tape reads of it, without a {@link RawJson} node for
 * every value: a token's type, its count of members or items, the token after it, and a member's
 * name and a scalar's value. An object's members are its key token and value token in turn; an
 * array's items follow one another. A builder hands any part it does not read this way to
 * {@link lazyAt}, which makes the same tree the rest of the reader takes.
 *
 * @internal
 */
export const tapeReader = {
  /** The type of the value whose token is at `index`. */
  type: (tape: JsonTape, index: number): RawJson["t"] =>
    TYPE_OF_KIND[kindAt(tape.tokens, index)] as RawJson["t"],
  /** How many members an object, or items an array, at `index` has. */
  count: (tape: JsonTape, index: number): number => firstAt(tape.tokens, index),
  /** The index of the token after the value at `index`. */
  after: (tape: JsonTape, index: number): number => after(tape.tokens, index),
  /** The member name of the key token at `index`. */
  key: stringAt,
  /** The string a string token at `index` stands for. */
  string: stringAt,
  /** The value of a boolean token at `index`. */
  isTrue: (tape: JsonTape, index: number): boolean => kindAt(tape.tokens, index) === Tok.True,
  /**
   * Whether the object at `index` writes its members one for one: at most
   * {@link PLAIN_MEMBERS} of them, none named with a leading `_` (and more), and no name twice.
   * Decided on the source text, making no string; a name written with an escape is not decided
   * here, and the object is not plain.
   */
  isPlainObject: (tape: JsonTape, index: number): boolean => {
    const { src, tokens } = tape;
    const count = firstAt(tokens, index);
    if (count > PLAIN_MEMBERS) return false;
    let at = index + 1;
    for (let m = 0; m < count; m++) {
      if (kindAt(tokens, at) !== Tok.Str) return false;
      const start = firstAt(tokens, at);
      const length = secondAt(tokens, at) - start;
      if (length > 1 && src.charCodeAt(start) === Code.Underscore) return false;
      for (let e = 0; e < m; e++) {
        if (nameLengths[e] === length && sameText(src, nameStarts[e] as number, start, length)) {
          return false;
        }
      }
      nameStarts[m] = start;
      nameLengths[m] = length;
      at = after(tokens, at + 1);
    }
    return true;
  },
} as const;

/**
 * The most members an object `tapeReader.isPlainObject` decides can have: an object with more is
 * not plain, and is read from the raw tree, which builds the same model.
 */
const PLAIN_MEMBERS = 16;

/**
 * Where each member name of the object `tapeReader.isPlainObject` is reading starts, and how long
 * it is: kept from call to call, since the check never runs inside another one.
 */
const nameStarts = new Int32Array(PLAIN_MEMBERS);
const nameLengths = new Int32Array(PLAIN_MEMBERS);

/** Whether the `length` characters of `src` at `a` are those at `b`. */
function sameText(src: string, a: number, b: number, length: number): boolean {
  for (let i = 0; i < length; i++) {
    if (src.charCodeAt(a + i) !== src.charCodeAt(b + i)) return false;
  }
  return true;
}

/**
 * An object of a tape whose members are made when they are first read, and kept from then on. A
 * tree of these is built only as far as it is read, and a part of it that is let go once read takes
 * the members made for it along.
 */
class LazyObject implements RawObject {
  public readonly t = "obj";
  readonly #tape: JsonTape;
  readonly #index: number;
  #members: readonly RawMember[] | undefined;

  public constructor(tape: JsonTape, index: number) {
    this.#tape = tape;
    this.#index = index;
  }

  public get members(): readonly RawMember[] {
    if (this.#members !== undefined) return this.#members;
    const tape = this.#tape;
    const tokens = tape.tokens;
    const count = firstAt(tokens, this.#index);
    const members = new Array<RawMember>(count);
    let at = this.#index + 1;
    for (let m = 0; m < count; m++) {
      members[m] = { key: stringAt(tape, at), value: lazyAt(tape, at + 1) };
      at = after(tokens, at + 1);
    }
    return (this.#members = members);
  }
}

/** An array of a tape whose items are made when they are first read (see {@link LazyObject}). */
class LazyArray implements RawArray {
  public readonly t = "arr";
  readonly #tape: JsonTape;
  readonly #index: number;
  #items: readonly RawJson[] | undefined;

  public constructor(tape: JsonTape, index: number) {
    this.#tape = tape;
    this.#index = index;
  }

  public get items(): readonly RawJson[] {
    if (this.#items !== undefined) return this.#items;
    const tape = this.#tape;
    const tokens = tape.tokens;
    const count = firstAt(tokens, this.#index);
    const items = new Array<RawJson>(count);
    let at = this.#index + 1;
    for (let i = 0; i < count; i++) {
      items[i] = lazyAt(tape, at);
      at = after(tokens, at);
    }
    return (this.#items = items);
  }
}

/**
 * The value at `index` of a tape, its objects and arrays made only when they are first read.
 *
 * @internal
 */
export function lazyAt(tape: JsonTape, index: number): RawJson {
  const kind = kindAt(tape.tokens, index);
  if (kind === Tok.Obj) return new LazyObject(tape, index);
  if (kind === Tok.Arr) return new LazyArray(tape, index);
  return scalarAt(tape, index);
}

/**
 * Read a JSON document onto a {@link JsonTape}. Throws as {@link readRawJson} does.
 *
 * With `mayUseScratch`, a small document is read onto one tape kept for reuse, which saves making a
 * typed array for every small read. The caller must then hand it back with {@link releaseJsonTape}
 * once nothing will read the tape or a tree made from it again, and must not keep either past that.
 *
 * @internal
 */
export function readJsonTape(src: string, mayUseScratch = false): JsonTape {
  return new JsonTokenizer(src, mayUseScratch).tokenize();
}

/**
 * Hand back a tape from {@link readJsonTape}, so its words can be reused when it is the reused one.
 *
 * @internal
 */
export function releaseJsonTape(tape: JsonTape): void {
  if (tape.borrowed) scratchFree = true;
}

/**
 * Read a JSON document into a {@link RawJson} tree whose objects and arrays are made only when they
 * are first read. The whole document is checked first, so it throws exactly what
 * {@link readRawJson} throws, at the same offset; read in full, the tree is the same. A reader that
 * builds from one part of the tree at a time and lets each part go holds only that part, not the
 * whole tree.
 *
 * @internal
 */
export function readRawJsonLazily(src: string): RawJson {
  return lazyAt(readJsonTape(src), 0);
}

/**
 * Parse a JSON document into a {@link RawJson} tree that preserves number literals verbatim and
 * member order. Throws {@link FhirCodecError} (`MALFORMED_JSON`) on invalid input, or
 * (`MAX_DEPTH_EXCEEDED`) when nesting passes the reader's fixed depth bound, both value-free, with a
 * `offset` and no snippet.
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
  const tape = readJsonTape(src, true);
  try {
    return treeAt(tape, 0);
  } finally {
    releaseJsonTape(tape);
  }
}
