import { describe, expect, it } from "vitest";

import { parseResource, pathExists, resolvePath, isPrimitive } from "../src/index.js";
import { nth } from "./_util.js";

describe("resolvePath — bounded element-path navigation", () => {
  const { resource } = parseResource(
    JSON.stringify({
      resourceType: "Observation",
      status: "final",
      category: [
        { coding: [{ system: "http://x", code: "vital-signs" }] },
        { coding: [{ code: "lab" }, { code: "extra" }] },
      ],
      valueQuantity: { value: 1, unit: "kg" },
    }),
  );

  it("selects a direct element", () => {
    const [status] = resolvePath(resource, "status");
    expect(status !== undefined && isPrimitive(status) && status.value).toBe("final");
  });

  it("$this and empty path select the node itself", () => {
    expect(resolvePath(resource, "$this")).toEqual([resource]);
    expect(resolvePath(resource, "")).toEqual([resource]);
  });

  it("flattens repeating elements across a dotted path", () => {
    const codes = resolvePath(resource, "category.coding.code")
      .map((n) => (isPrimitive(n) ? n.value : undefined))
      .filter((v): v is string => typeof v === "string");
    expect(codes).toEqual(["vital-signs", "lab", "extra"]);
  });

  it("matches a [x] choice variant", () => {
    const values = resolvePath(resource, "value[x]");
    expect(values).toHaveLength(1);
    const unit = resolvePath(nth(values, 0), "unit");
    expect(unit.map((n) => (isPrimitive(n) ? n.value : undefined))).toEqual(["kg"]);
  });

  it("returns nothing for an absent path", () => {
    expect(resolvePath(resource, "note.text")).toEqual([]);
    expect(resolvePath(resource, "component[x]")).toEqual([]);
  });

  it("pathExists reflects selection", () => {
    expect(pathExists(resource, "value[x]")).toBe(true);
    expect(pathExists(resource, "effective[x]")).toBe(false);
    expect(pathExists(resource, "category.coding.code")).toBe(true);
  });
});
