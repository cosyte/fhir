import { describe, expect, it } from "vitest";

import { integer64 } from "../src/index.js";

describe("FhirInteger64 (ADR 0001)", () => {
  it("preserves the exact lexical text and exposes an exact BigInt", () => {
    const n = integer64("9223372036854775807");
    expect(n.toString()).toBe("9223372036854775807");
    expect(n.toBigInt()).toBe(9223372036854775807n);
  });

  it("caches the BigInt view (same value on repeated access)", () => {
    const n = integer64("42");
    expect(n.toBigInt()).toBe(42n);
    expect(n.toBigInt()).toBe(42n);
  });

  it("handles the signed 64-bit minimum", () => {
    expect(integer64("-9223372036854775808").toBigInt()).toBe(-9223372036854775808n);
  });

  it("compares by value", () => {
    expect(integer64("100").equals(integer64("100"))).toBe(true);
    expect(integer64("100").equals(integer64("101"))).toBe(false);
  });

  it("rejects non-integer grammar", () => {
    expect(() => integer64("1.5")).toThrow(TypeError);
    expect(() => integer64("abc")).toThrow(TypeError);
    expect(() => integer64("01")).toThrow(TypeError);
  });

  it("rejects values outside the signed 64-bit range", () => {
    expect(() => integer64("9223372036854775808")).toThrow(RangeError);
    expect(() => integer64("-9223372036854775809")).toThrow(RangeError);
  });
});
