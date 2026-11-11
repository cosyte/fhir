/**
 * A read from text makes its raw tree one part at a time, as it reads it, so a large Bundle's raw
 * entries are not all alive at once beside the model built from them. Read in full, that tree is the
 * tree `readRawJson` makes, and a malformed document throws what `readRawJson` throws, at the same
 * offset, before anything is made.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { hostileInput, resourceJson } from "../src/arbitraries/text.js";
import { readRawJsonLazily } from "../src/codec/raw-json.js";
import { FhirCodecError, parseResource, readRawJson, type RawJson } from "../src/index.js";
import { transactionBundle } from "../bench/shapes.mjs";

/** The tree read in full, as plain data. */
function plain(node: RawJson): unknown {
  if (node.t === "obj") {
    return { t: "obj", members: node.members.map((m) => ({ key: m.key, value: plain(m.value) })) };
  }
  if (node.t === "arr") return { t: "arr", items: node.items.map(plain) };
  return node;
}

/** What reading `text` throws, as a record, or `undefined`. */
function thrownBy(read: (text: string) => unknown, text: string): unknown {
  try {
    read(text);
    return undefined;
  } catch (error) {
    expect(error).toBeInstanceOf(FhirCodecError);
    const e = error as FhirCodecError;
    return { code: e.code, message: e.message, offset: e.offset, expression: e.expression };
  }
}

/** What a read of `text` comes to: its result, or what it throws. */
function outcome(read: () => unknown): unknown {
  try {
    return { result: read() };
  } catch (error) {
    const e = error as FhirCodecError;
    return {
      thrown: e.name,
      code: e.code,
      message: e.message,
      offset: e.offset,
      expression: e.expression,
    };
  }
}

const DOCUMENTS: readonly string[] = [
  '{"resourceType":"Patient","id":"p1"}',
  '{"a":0.010,"b":1e3,"c":-42,"d":-0.5E-7,"e":12345678901234567890}',
  '{"s":"a\\n\\t\\"\\\\\\/\\u0041\\b\\f\\r","k\\u0041":"v","":""}',
  `{"long":"${"x".repeat(70)}\\u0020${"y".repeat(70)}","tail":"end\\n","head":"\\nstart"}`,
  '{"a":{},"b":[],"c":[[],[{}]],"d":[true,false,null],"a":2,"_a":{"id":"m"}}',
  '  [ 1 , "two" , { "three" : [ 3 ] } ]  ',
  '"\\ud800 lone \\udc00"',
  "true",
  "null",
  "0",
  transactionBundle(7, 12),
];

const MALFORMED: readonly string[] = [
  "",
  "   ",
  "{",
  "[1,]",
  '{"a":}',
  '{"a" 1}',
  "{a:1}",
  "nul",
  "[1 2]",
  "-",
  "01",
  "1.",
  "1e",
  '"a\nb"',
  '"\\x"',
  '"abc\\',
  '"abc',
  '"\\u00zz"',
  '"\\u12"',
  "{} {}",
  '{"resourceType":"Patient","id":"ab\\n',
  '{"resourceType":"Patient","i',
  `${"[".repeat(300)}${"]".repeat(300)}`,
];

describe("readRawJsonLazily", () => {
  it.each(DOCUMENTS.map((text, i) => [i, text] as const))(
    "reads document %i, in full, as readRawJson does",
    (_i, text) => {
      expect(plain(readRawJsonLazily(text))).toEqual(plain(readRawJson(text)));
    },
  );

  it.each(MALFORMED.map((text) => [text.slice(0, 24), text] as const))(
    "throws on %j what readRawJson throws, at the same offset",
    (_label, text) => {
      const lazily = thrownBy(readRawJsonLazily, text);
      expect(lazily).toBeDefined();
      expect(lazily).toEqual(thrownBy(readRawJson, text));
    },
  );

  it("makes an object's members and an array's items only when they are read, then keeps them", () => {
    const root = readRawJsonLazily(transactionBundle(3, 4));
    if (root.t !== "obj") throw new Error("expected an object");
    // Nothing below the root is made until the root's members are read.
    expect(Object.getOwnPropertyNames(root)).toEqual(["t"]);
    const entry = root.members.find((m) => m.key === "entry")?.value;
    expect(root.members).toBe(root.members);
    if (entry?.t !== "arr") throw new Error("expected an array");
    expect(Object.getOwnPropertyNames(entry)).toEqual(["t"]);
    const items = entry.items;
    expect(items).toHaveLength(4);
    expect(entry.items).toBe(items);
    for (const item of items) expect(Object.getOwnPropertyNames(item)).toEqual(["t"]);
  });

  it("agrees with readRawJson, read in full or by parseResource, on messy and hostile text", () => {
    fc.assert(
      fc.property(fc.oneof(resourceJson(), hostileInput({ format: "json" })), (text) => {
        const lazily = outcome(() => plain(readRawJsonLazily(text)));
        expect(lazily).toEqual(outcome(() => plain(readRawJson(text))));
        if ("result" in (lazily as object)) {
          expect(outcome(() => parseResource(text))).toEqual(
            outcome(() => parseResource(readRawJson(text))),
          );
        }
      }),
      { numRuns: 300, seed: 7011 },
    );
  });

  it("reads one document after another, through refusals and growth, as each reads alone", () => {
    const texts = [...DOCUMENTS, ...MALFORMED, `[${"0,".repeat(5_000)}0]`];
    const alone = texts.map((text) => [
      outcome(() => plain(readRawJson(text))),
      outcome(() => parseResource(text)),
    ]);
    const kept = texts.map((text) => outcome(() => readRawJson(text)));
    const results = texts.map((text) => outcome(() => parseResource(text)));
    texts.forEach((text, i) => {
      const tree = kept[i] as { result?: RawJson };
      expect(tree.result === undefined ? kept[i] : { result: plain(tree.result) }).toEqual(
        alone[i]?.[0],
      );
      expect(results[i]).toEqual(alone[i]?.[1]);
      expect(outcome(() => plain(readRawJsonLazily(text)))).toEqual(alone[i]?.[0]);
    });
  });

  it("reads large documents one after another, reusing a tape, as each reads alone", () => {
    // Each grows past the reused tape; the second reuses the tape the first grew into, the third
    // is larger than that tape, and the lazy reads never take the reused tape at all.
    const large = transactionBundle(11, 200);
    const larger = transactionBundle(12, 600);
    const alone = [large, larger].map((text) => plain(readRawJsonLazily(text)));
    const read = [large, large, larger, large].map((text) => plain(readRawJson(text)));
    expect(read).toEqual([alone[0], alone[0], alone[1], alone[0]]);
    const parsed = [larger, large, larger].map((text) => parseResource(text));
    expect(parsed).toEqual([larger, large, larger].map((text) => parseResource(readRawJson(text))));
  });

  it("is what parseResource reads text through: the same model and issues as from readRawJson", () => {
    const text = transactionBundle(5, 30);
    expect(parseResource(text)).toEqual(parseResource(readRawJson(text)));
  });
});
