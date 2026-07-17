import { describe, expect, it } from "vitest";

import { complex, decimal, list, matchesFixed, matchesPattern, primitive } from "../src/index.js";

/** A `CodeableConcept`-shaped node with the given coding fields. */
function coding(fields: Record<string, string>) {
  return complex([
    {
      name: "coding",
      value: list([
        complex(Object.entries(fields).map(([name, v]) => ({ name, value: primitive(v) }))),
      ]),
    },
  ]);
}

describe("matchesFixed — exact equality", () => {
  it("compares primitives by value", () => {
    expect(matchesFixed(primitive("active"), primitive("active"))).toBe(true);
    expect(matchesFixed(primitive("inactive"), primitive("active"))).toBe(false);
    expect(matchesFixed(primitive(true), primitive(true))).toBe(true);
  });

  it("is false when the element is absent", () => {
    expect(matchesFixed(undefined, primitive("x"))).toBe(false);
  });

  it("requires the same content with nothing extra on a complex value", () => {
    const fixed = coding({ system: "http://s", code: "vital-signs" });
    const exact = coding({ system: "http://s", code: "vital-signs" });
    const extra = coding({ system: "http://s", code: "vital-signs", display: "Vitals" });
    expect(matchesFixed(exact, fixed)).toBe(true);
    expect(matchesFixed(extra, fixed)).toBe(false); // extra `display` → not exact
  });

  it("ignores primitive metadata-only siblings on the instance side", () => {
    const fixed = complex([{ name: "code", value: primitive("x") }]);
    const withMeta = complex([
      { name: "code", value: primitive("x") },
      { name: "id", value: primitive(undefined, { id: "n1" }) },
    ]);
    // The metadata-only property carries no value, so it does not count as "extra content".
    expect(matchesFixed(withMeta, fixed)).toBe(true);
  });

  it("compares lists element-wise and length-sensitively", () => {
    const fixed = list([primitive("a"), primitive("b")]);
    expect(matchesFixed(list([primitive("a"), primitive("b")]), fixed)).toBe(true);
    expect(matchesFixed(list([primitive("a")]), fixed)).toBe(false);
    expect(matchesFixed(primitive("a"), fixed)).toBe(false);
  });

  it("compares decimals precision-exactly", () => {
    expect(matchesFixed(primitive(decimal("0.010")), primitive(decimal("0.010")))).toBe(true);
    expect(matchesFixed(primitive(decimal("0.01")), primitive(decimal("0.010")))).toBe(false);
    expect(matchesFixed(primitive("0.010"), primitive(decimal("0.010")))).toBe(false);
  });
});

describe("matchesPattern — subset match", () => {
  it("allows extra content the pattern does not name", () => {
    const pattern = coding({ code: "vital-signs" });
    const instance = coding({ system: "http://s", code: "vital-signs", display: "Vitals" });
    expect(matchesPattern(instance, pattern)).toBe(true);
  });

  it("fails when a named property is missing or differs", () => {
    const pattern = coding({ system: "http://s", code: "vital-signs" });
    expect(matchesPattern(coding({ code: "vital-signs" }), pattern)).toBe(false);
    expect(matchesPattern(coding({ system: "http://s", code: "lab" }), pattern)).toBe(false);
  });

  it("treats a list pattern as an each-pattern-item-matched subset", () => {
    const pattern = list([coding({ code: "vital-signs" })]);
    const instance = list([coding({ code: "lab" }), coding({ code: "vital-signs", display: "V" })]);
    expect(matchesPattern(instance, pattern)).toBe(true);
    expect(matchesPattern(list([coding({ code: "lab" })]), pattern)).toBe(false);
  });

  it("matches a single instance against a single-item list pattern", () => {
    const pattern = list([primitive("a")]);
    expect(matchesPattern(primitive("a"), pattern)).toBe(true);
  });

  it("is false for an absent element and for a scalar/complex mismatch", () => {
    expect(matchesPattern(undefined, primitive("x"))).toBe(false);
    expect(matchesPattern(primitive("x"), complex([{ name: "code", value: primitive("x") }]))).toBe(
      false,
    );
  });
});
