import { describe, expect, it } from "vitest";

import { FATAL_CODES, FhirCodecError, readRawJson, type RawJson } from "../src/index.js";
import { nth } from "./_util.js";

/** Narrow a raw node to a given tag or fail the test loudly. */
function expectTag<T extends RawJson["t"]>(node: RawJson, tag: T): Extract<RawJson, { t: T }> {
  expect(node.t).toBe(tag);
  return node as Extract<RawJson, { t: T }>;
}

describe("readRawJson: precision-preserving JSON reader", () => {
  it("keeps number literals as exact source text", () => {
    const obj = expectTag(readRawJson('{"a":0.010,"b":1e3,"c":-42}'), "obj");
    expect(expectTag(nth(obj.members, 0).value, "num").raw).toBe("0.010");
    expect(expectTag(nth(obj.members, 1).value, "num").raw).toBe("1e3");
    expect(expectTag(nth(obj.members, 2).value, "num").raw).toBe("-42");
  });

  it("preserves member order (resourceType can appear anywhere)", () => {
    const obj = expectTag(readRawJson('{"id":"1","resourceType":"Patient"}'), "obj");
    expect(obj.members.map((m) => m.key)).toEqual(["id", "resourceType"]);
  });

  it("parses strings with escapes into their logical values", () => {
    const obj = expectTag(readRawJson('{"s":"a\\n\\t\\"\\\\\\/\\u0041\\b\\f\\r"}'), "obj");
    expect(expectTag(nth(obj.members, 0).value, "str").value).toBe('a\n\t"\\/A\b\f\r');
  });

  it("parses arrays, booleans, and null", () => {
    const arr = expectTag(readRawJson("[true,false,null]"), "arr");
    expect(arr.items.map((i) => i.t)).toEqual(["bool", "bool", "null"]);
  });

  it("parses nested structures and empty containers", () => {
    const obj = expectTag(readRawJson('{"a":{},"b":[]}'), "obj");
    expect(expectTag(nth(obj.members, 0).value, "obj").members).toEqual([]);
    expect(expectTag(nth(obj.members, 1).value, "arr").items).toEqual([]);
  });

  it("keeps duplicate keys as separate members (lenient)", () => {
    const obj = expectTag(readRawJson('{"a":1,"a":2}'), "obj");
    expect(obj.members).toHaveLength(2);
  });

  describe("malformed input rejected with a typed fatal carrying an offset", () => {
    const cases: readonly [string, string][] = [
      ["", "empty"],
      ["{", "unterminated object"],
      ["[1,]", "trailing comma"],
      ['{"a":}', "missing value"],
      ['{"a" 1}', "missing colon"],
      ["{a:1}", "unquoted key"],
      ["nul", "bad literal"],
      ["[1 2]", "missing comma in array"],
      ["-", "bare minus"],
      ["-x", "minus with no digits"],
      ["01", "leading zero"],
      ["1.", "missing fraction"],
      ["1e", "missing exponent"],
      ['"a\nb"', "unescaped control char"],
      ['"\\x"', "bad escape"],
      ['"\\u00zz"', "bad unicode escape"],
      ["{} {}", "trailing content"],
    ];
    it.each(cases)("rejects %j (%s)", (input) => {
      let thrown: unknown;
      try {
        readRawJson(input);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(FhirCodecError);
      const error = thrown as FhirCodecError;
      expect(error.code).toBe(FATAL_CODES.MALFORMED_JSON);
      expect(typeof error.offset).toBe("number");
    });
  });
});
