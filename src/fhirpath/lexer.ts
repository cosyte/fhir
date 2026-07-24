/**
 * The FHIRPath tokenizer (Phase 7, the bounded invariant engine, ADR 0002).
 *
 * FHIR resource `constraint`s (invariants) are expressed in **FHIRPath**, a collection-oriented
 * expression language. Evaluating them needs a real lexer → parser → evaluator; this module is the
 * first stage, turning an expression string into a flat token stream. It is deliberately a **bounded
 * subset** (ADR 0002: implement-a-vendored-subset, no runtime dependency, no full third-party engine):
 * it recognises the token classes the R4 / US Core invariant set uses, path identifiers, string /
 * number / boolean literals, environment variables (`%resource`), special variables (`$this`), and the
 * operator/punctuation symbols, and **refuses anything it does not recognise** by throwing
 * {@link ./errors.js UnsupportedFhirPathError}, so a construct outside the subset can never be
 * silently mis-tokenised into a wrong parse (the roadmap §6 fail-safe: unevaluable → *unchecked*,
 * never a false pass).
 *
 * @packageDocumentation
 */

import { UnsupportedFhirPathError } from "./errors.js";

/** The kind of a lexed {@link Token}. */
export type TokenType =
  | "string" // a `'...'` string literal (value is the unescaped content)
  | "number" // a numeric literal (value is the lexical text)
  | "identifier" // a path segment or keyword operator (`and`, `is`, `true`, …)
  | "envvar" // an environment variable, `%name` or `%'name'` (value excludes the `%`)
  | "special" // a special variable, `$this` / `$index` / `$total` (value excludes the `$`)
  | "symbol"; // an operator or punctuation symbol (`.`, `(`, `=`, `!=`, `|`, …)

/** One lexical token: its {@link TokenType}, its text/value, and its start offset (for diagnostics). */
export interface Token {
  readonly type: TokenType;
  readonly value: string;
  readonly pos: number;
}

/** Multi-character operator symbols, longest first so `!=` beats `!`, `<=` beats `<`. */
const MULTI_SYMBOLS: readonly string[] = ["!=", "!~", "<=", ">="];

/** Single-character punctuation / operator symbols the subset recognises. */
const SINGLE_SYMBOLS: ReadonlySet<string> = new Set([
  ".",
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  ",",
  "=",
  "~",
  "<",
  ">",
  "+",
  "-",
  "*",
  "/",
  "&",
  "|",
]);

/** Whether `ch` can start an identifier (letter or underscore). */
function isIdentStart(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
}

/** Whether `ch` can continue an identifier (letter, digit, or underscore). */
function isIdentPart(ch: string): boolean {
  return isIdentStart(ch) || (ch >= "0" && ch <= "9");
}

/** Whether `ch` is an ASCII digit. */
function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

/** The escape sequences a FHIRPath string literal may carry, mapped to their character. */
const STRING_ESCAPES: Readonly<Record<string, string>> = {
  "'": "'",
  '"': '"',
  "`": "`",
  "\\": "\\",
  "/": "/",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

/** Read a `'...'` string literal starting at `start` (the opening quote); returns value + next index. */
function readString(input: string, start: number): { value: string; next: number } {
  let out = "";
  let i = start + 1;
  while (i < input.length) {
    const ch = input.charAt(i);
    if (ch === "'") return { value: out, next: i + 1 };
    if (ch === "\\") {
      const esc = input.charAt(i + 1);
      if (esc === "u") {
        const hex = input.slice(i + 2, i + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
          throw new UnsupportedFhirPathError(`invalid unicode escape at position ${String(i)}`);
        }
        out += String.fromCharCode(Number.parseInt(hex, 16));
        i += 6;
        continue;
      }
      const mapped = STRING_ESCAPES[esc];
      if (mapped === undefined) {
        throw new UnsupportedFhirPathError(`unsupported string escape \\${esc}`);
      }
      out += mapped;
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  throw new UnsupportedFhirPathError("unterminated string literal");
}

/** Read a delimited `` `...` `` identifier starting at `start` (the opening backtick). */
function readDelimitedIdentifier(input: string, start: number): { value: string; next: number } {
  let out = "";
  let i = start + 1;
  while (i < input.length) {
    const ch = input.charAt(i);
    if (ch === "`") return { value: out, next: i + 1 };
    if (ch === "\\") throw new UnsupportedFhirPathError("escapes in delimited identifiers");
    out += ch;
    i += 1;
  }
  throw new UnsupportedFhirPathError("unterminated delimited identifier");
}

/** Read a numeric literal (integer or decimal, no exponent, FHIRPath number literals have none). */
function readNumber(input: string, start: number): { value: string; next: number } {
  let i = start;
  while (i < input.length && isDigit(input.charAt(i))) i += 1;
  if (input.charAt(i) === "." && isDigit(input.charAt(i + 1))) {
    i += 1;
    while (i < input.length && isDigit(input.charAt(i))) i += 1;
  }
  return { value: input.slice(start, i), next: i };
}

/**
 * Tokenise a FHIRPath expression into a flat {@link Token} stream.
 *
 * @param input - The FHIRPath expression source.
 * @returns The tokens, in order (no end-of-input sentinel, the parser tracks its own position).
 * @throws UnsupportedFhirPathError on any character the bounded subset does not recognise, so an
 *   out-of-subset construct fails loudly rather than mis-lexing into a wrong parse.
 * @example
 * ```ts
 * import { tokenize } from "@cosyte/fhir";
 * tokenize("clinicalStatus.exists()").map((t) => t.value); // ["clinicalStatus", ".", "exists", "(", ")"]
 * ```
 */
export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input.charAt(i);
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i += 1;
      continue;
    }
    if (ch === "'") {
      const { value, next } = readString(input, i);
      tokens.push({ type: "string", value, pos: i });
      i = next;
      continue;
    }
    if (ch === "`") {
      const { value, next } = readDelimitedIdentifier(input, i);
      tokens.push({ type: "identifier", value, pos: i });
      i = next;
      continue;
    }
    if (ch === "%") {
      if (input.charAt(i + 1) === "'") {
        const { value, next } = readString(input, i + 1);
        tokens.push({ type: "envvar", value, pos: i });
        i = next;
        continue;
      }
      let j = i + 1;
      while (j < input.length && isIdentPart(input.charAt(j))) j += 1;
      if (j === i + 1) throw new UnsupportedFhirPathError("malformed environment variable");
      tokens.push({ type: "envvar", value: input.slice(i + 1, j), pos: i });
      i = j;
      continue;
    }
    if (ch === "$") {
      let j = i + 1;
      while (j < input.length && isIdentPart(input.charAt(j))) j += 1;
      if (j === i + 1) throw new UnsupportedFhirPathError("malformed special variable");
      tokens.push({ type: "special", value: input.slice(i + 1, j), pos: i });
      i = j;
      continue;
    }
    if (isDigit(ch)) {
      const { value, next } = readNumber(input, i);
      tokens.push({ type: "number", value, pos: i });
      i = next;
      continue;
    }
    if (isIdentStart(ch)) {
      let j = i + 1;
      while (j < input.length && isIdentPart(input.charAt(j))) j += 1;
      tokens.push({ type: "identifier", value: input.slice(i, j), pos: i });
      i = j;
      continue;
    }
    const two = input.slice(i, i + 2);
    if (MULTI_SYMBOLS.includes(two)) {
      tokens.push({ type: "symbol", value: two, pos: i });
      i += 2;
      continue;
    }
    if (SINGLE_SYMBOLS.has(ch)) {
      tokens.push({ type: "symbol", value: ch, pos: i });
      i += 1;
      continue;
    }
    throw new UnsupportedFhirPathError(`unexpected character '${ch}' at position ${String(i)}`);
  }
  return tokens;
}
