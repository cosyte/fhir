/**
 * The JSON reader crosses a long run of plain characters with a regular expression rather than a
 * character at a time. Every string it reads, and every malformed one it refuses with the offset it
 * reports, has to be what the character-at-a-time reader gave: the reference below is that reader,
 * and the drawn strings put quotes, escapes and control characters on both sides of the run length
 * where the search takes over, and at the very end of the text.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { FhirCodecError, readRawJson } from "../src/index.js";

type Outcome = { readonly value: string } | { readonly message: string; readonly offset: number };

const ESCAPES: Record<string, string> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

/** The string token at the start of `text`, read a character at a time. */
function reference(text: string): Outcome {
  let pos = 1;
  let out = "";
  const fail = (message: string): Outcome => ({
    message: `Malformed JSON: ${message}`,
    offset: pos,
  });
  for (;;) {
    if (pos >= text.length) return fail("Unterminated string");
    const c = text.charCodeAt(pos);
    if (c === 34) {
      if (pos + 1 < text.length) {
        pos++;
        return fail("Unexpected trailing content after the top-level JSON value");
      }
      return { value: out };
    }
    if (c === 92) {
      pos++;
      if (pos >= text.length) return fail("Unterminated escape sequence");
      const e = text.charAt(pos);
      pos++;
      if (e === "u") {
        const hex = text.slice(pos, pos + 4);
        if (!/^[0-9a-fA-F]{4}$/.test(hex))
          return fail("Invalid \\u escape: expected four hex digits");
        out += String.fromCharCode(Number.parseInt(hex, 16));
        pos += 4;
        continue;
      }
      const decoded = ESCAPES[e];
      if (decoded === undefined) {
        pos--;
        return { message: "Malformed JSON: Invalid escape sequence in string", offset: pos + 1 };
      }
      out += decoded;
      continue;
    }
    if (c < 32) return fail("Unescaped control character in string");
    out += text.charAt(pos);
    pos++;
  }
}

function read(text: string): Outcome {
  try {
    const node = readRawJson(text);
    if (node.t !== "str") throw new Error("not a string");
    return { value: node.value };
  } catch (error) {
    if (!(error instanceof FhirCodecError)) throw error;
    return { message: error.message, offset: error.offset ?? -1 };
  }
}

/** One piece of a string's body: a run of plain characters, or one character the scan stops at. */
const piece = fc.oneof(
  { weight: 4, arbitrary: fc.string({ unit: "grapheme-ascii", minLength: 0, maxLength: 80 }) },
  fc.constantFrom(
    '\\"',
    "\\\\",
    "\\n",
    "\\u00e9",
    "\\uD83D\\uDE00",
    "\\x",
    "\\u12",
    "\n",
    "\u0001",
  ),
  fc.string({ unit: "binary", maxLength: 6 }),
);

describe("the string scan", () => {
  it("reads and refuses every drawn string as the character-at-a-time reader did", () => {
    fc.assert(
      fc.property(fc.array(piece, { maxLength: 8 }), fc.boolean(), (pieces, closed) => {
        const body = pieces.join("").replaceAll('"', "");
        const text = `"${body}${closed ? '"' : ""}`;
        expect(read(text)).toEqual(reference(text));
      }),
      { seed: 20261111, numRuns: 3000 },
    );
  });

  it("finds a stop exactly at, before and after the run length the search takes over at", () => {
    for (let length = 28; length <= 40; length++) {
      const run = "A".repeat(length);
      for (const stop of ['"', "\\n", "\u0002", "\\q", ""]) {
        for (const tail of ["BBBB", ""]) {
          const text = `"${run}${stop}${tail}"`;
          expect(read(text)).toEqual(reference(text));
          const open = `"${run}${stop}${tail}`;
          expect(read(open)).toEqual(reference(open));
        }
      }
    }
  });
});
