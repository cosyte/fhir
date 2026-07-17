import { describe, expect, it } from "vitest";

import {
  complex,
  getProperty,
  isComplex,
  isList,
  isPrimitive,
  list,
  parseResource,
  primitive,
  resourceType,
} from "../src/index.js";

describe("model node constructors and guards", () => {
  it("primitive omits absent optional keys (exactOptionalPropertyTypes)", () => {
    const p = primitive("x");
    expect(Object.prototype.hasOwnProperty.call(p, "id")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(p, "extension")).toBe(false);
  });

  it("primitive keeps supplied metadata", () => {
    const ext = [complex([{ name: "url", value: primitive("u") }])];
    const p = primitive("x", { id: "i", extension: ext });
    expect(p.id).toBe("i");
    expect(p.extension).toBe(ext);
  });

  it("type guards discriminate the three node kinds", () => {
    expect(isPrimitive(primitive("x"))).toBe(true);
    expect(isComplex(complex([]))).toBe(true);
    expect(isList(list([]))).toBe(true);
    expect(isPrimitive(complex([]))).toBe(false);
    expect(isList(primitive("x"))).toBe(false);
    expect(isComplex(list([]))).toBe(false);
  });

  it("getProperty returns the first match or undefined", () => {
    const node = complex([
      { name: "a", value: primitive("1") },
      { name: "b", value: primitive("2") },
    ]);
    expect(getProperty(node, "b")).toEqual(primitive("2"));
    expect(getProperty(node, "missing")).toBeUndefined();
  });

  it("resourceType returns undefined when absent or non-string", () => {
    expect(resourceType(complex([]))).toBeUndefined();
    const { resource } = parseResource('{"resourceType":"Patient"}');
    expect(resourceType(resource)).toBe("Patient");
  });
});
