import { describe, expect, it } from "vitest";

import {
  complex,
  list,
  loadStructureDefinition,
  matchSlices,
  parseResource,
  primitive,
  resolveSlices,
  type StructureDefinition,
} from "../src/index.js";
import { req } from "./_util.js";

function loadSd(obj: unknown): StructureDefinition {
  return req(loadStructureDefinition(parseResource(JSON.stringify(obj)).resource));
}

/** A `category`-style CodeableConcept occurrence with one coding. */
function cc(code: string, system?: string) {
  const fields = [{ name: "code", value: primitive(code) }];
  if (system !== undefined) fields.unshift({ name: "system", value: primitive(system) });
  return complex([{ name: "coding", value: list([complex(fields)]) }]);
}

const sd = loadSd({
  resourceType: "StructureDefinition",
  url: "http://x",
  type: "Observation",
  snapshot: {
    element: [
      {
        id: "Observation.category",
        path: "Observation.category",
        min: 1,
        max: "*",
        slicing: { discriminator: [{ type: "pattern", path: "$this" }], rules: "open" },
      },
      {
        id: "Observation.category:VSCat",
        path: "Observation.category",
        sliceName: "VSCat",
        min: 1,
        max: "1",
        patternCodeableConcept: { coding: [{ code: "vital-signs" }] },
      },
    ],
  },
});

const category = req(sd.snapshot?.find((e) => e.id === "Observation.category"));
const slices = resolveSlices(req(sd.snapshot), category);

describe("resolveSlices", () => {
  it("reads a slice's pattern constraint at $this", () => {
    expect(slices).toHaveLength(1);
    const vscat = req(slices[0]);
    expect(vscat.sliceName).toBe("VSCat");
    expect(vscat.min).toBe(1);
    expect(req(vscat.constraints[0])).toMatchObject({ path: "$this", kind: "pattern" });
  });

  it("collects a descendant fixed constraint and its existence expectation", () => {
    const withChild = loadSd({
      resourceType: "StructureDefinition",
      url: "http://y",
      type: "Observation",
      snapshot: {
        element: [
          {
            id: "Observation.category",
            path: "Observation.category",
            slicing: { discriminator: [{ type: "value", path: "coding.code" }], rules: "open" },
          },
          { id: "Observation.category:Lab", path: "Observation.category", sliceName: "Lab" },
          {
            id: "Observation.category:Lab.coding.code",
            path: "Observation.category.coding.code",
            min: 1,
            fixedCode: "laboratory",
          },
        ],
      },
    });
    const sliced = req(withChild.snapshot?.[0]);
    const lab = req(resolveSlices(req(withChild.snapshot), sliced)[0]);
    expect(req(lab.constraints[0])).toMatchObject({ path: "coding.code", kind: "fixed" });
    expect(lab.existsExpectations.get("coding.code")).toBe(true);
  });
});

describe("matchSlices", () => {
  const discriminators = [{ type: "pattern", path: "$this" }];

  it("assigns occurrences that match a slice's pattern and leaves others unmatched", () => {
    const result = matchSlices(
      [cc("vital-signs", "http://s"), cc("laboratory")],
      slices,
      discriminators,
    );
    expect(result.unchecked).toBe(false);
    expect(result.assignments).toEqual(["VSCat", undefined]);
  });

  it("reports unchecked for an empty discriminator set", () => {
    expect(matchSlices([cc("vital-signs")], slices, []).unchecked).toBe(true);
  });

  it("reports unchecked for an unsupported discriminator type (type / profile / R5 position)", () => {
    for (const type of ["type", "profile", "position"]) {
      expect(matchSlices([cc("vital-signs")], slices, [{ type, path: "$this" }]).unchecked).toBe(
        true,
      );
    }
  });

  it("reports unchecked when a slice pins no value at the discriminator path", () => {
    // Discriminator names `coding.code`, but the slice's only constraint is at `$this`.
    const result = matchSlices([cc("vital-signs")], slices, [
      { type: "value", path: "coding.code" },
    ]);
    expect(result.unchecked).toBe(true);
  });

  it("evaluates an exists discriminator against a slice's existence expectation", () => {
    const existsSd = loadSd({
      resourceType: "StructureDefinition",
      url: "http://z",
      type: "Observation",
      snapshot: {
        element: [
          {
            id: "Observation.category",
            path: "Observation.category",
            slicing: { discriminator: [{ type: "exists", path: "coding" }], rules: "open" },
          },
          { id: "Observation.category:Has", path: "Observation.category", sliceName: "Has" },
          { id: "Observation.category:Has.coding", path: "Observation.category.coding", min: 1 },
        ],
      },
    });
    const sliced = req(existsSd.snapshot?.[0]);
    const existsSlices = resolveSlices(req(existsSd.snapshot), sliced);
    const withCoding = cc("x");
    const withoutCoding = complex([{ name: "text", value: primitive("free") }]);
    const result = matchSlices([withCoding, withoutCoding], existsSlices, [
      { type: "exists", path: "coding" },
    ]);
    expect(result.assignments).toEqual(["Has", undefined]);
  });
});
