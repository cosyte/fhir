import { describe, expect, it } from "vitest";

import {
  collectInvariantIssues,
  collectProfileIssues,
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

/**
 * A re-slice is read, not reported unchecked.
 *
 * The documentation used to say reslicing is reported `PROFILE_SLICE_UNCHECKED`. It is not: a
 * slice's `fixed[x]` / `pattern[x]` constraints are collected from every element under its id, a
 * re-slice's included, so a `value` discriminator can be decided by a re-slice. That is the shape of
 * the R4 blood-pressure profile (`bp.profile.json`), where the component slicing discriminates on
 * `code.coding.code` and `code.coding.system`, and only the required `SBPCode` / `DBPCode` re-slices
 * fix those values. Reporting it unchecked would stop the library telling the two components apart.
 *
 * The re-slice is also checked within its parent slice's members alone: `SBPCode` constrains the
 * codings of the component assigned to `SystolicBP`, never the diastolic one. A conformant
 * blood-pressure Observation draws no finding at all, where it used to draw six errors, each slice's
 * fixed values and re-slice cardinality applied to the other slice's component.
 */
describe("a re-slice decides its parent slice's membership", () => {
  /** One blood-pressure component slice, with the `code.coding` re-slice that fixes its code. */
  function component(slice: string, reslice: string, code: string): unknown[] {
    const id = `Observation.component:${slice}`;
    return [
      { id, path: "Observation.component", sliceName: slice, min: 1, max: "1" },
      { id: `${id}.code`, path: "Observation.component.code", min: 1, max: "1" },
      {
        id: `${id}.code.coding`,
        path: "Observation.component.code.coding",
        slicing: {
          discriminator: [
            { type: "value", path: "code" },
            { type: "value", path: "system" },
          ],
          rules: "open",
        },
      },
      {
        id: `${id}.code.coding:${reslice}`,
        path: "Observation.component.code.coding",
        sliceName: reslice,
        min: 1,
        max: "1",
      },
      {
        id: `${id}.code.coding:${reslice}.system`,
        path: "Observation.component.code.coding.system",
        min: 1,
        max: "1",
        fixedUri: "http://loinc.org",
      },
      {
        id: `${id}.code.coding:${reslice}.code`,
        path: "Observation.component.code.coding.code",
        min: 1,
        max: "1",
        fixedCode: code,
      },
    ];
  }

  const componentElement = {
    id: "Observation.component",
    path: "Observation.component",
    min: 2,
    max: "*",
    slicing: {
      discriminator: [
        { type: "value", path: "code.coding.code" },
        { type: "value", path: "code.coding.system" },
      ],
      rules: "open",
    },
  };
  const bp = loadSd({
    resourceType: "StructureDefinition",
    url: "http://example.org/StructureDefinition/bp-shape",
    type: "Observation",
    kind: "resource",
    derivation: "constraint",
    snapshot: {
      element: [
        { id: "Observation", path: "Observation" },
        componentElement,
        ...component("SystolicBP", "SBPCode", "8480-6"),
        ...component("DiastolicBP", "DBPCode", "8462-4"),
      ],
    },
  });
  const snapshot = req(bp.snapshot);
  const sliced = req(snapshot.find((e) => e.id === "Observation.component"));
  const discriminators = req(sliced.slicing).discriminator;

  /** A component whose code carries one LOINC coding. */
  function loinc(code: string) {
    return complex([{ name: "code", value: cc(code, "http://loinc.org") }]);
  }

  it("collects the re-slice's fixed values at the discriminator paths", () => {
    const systolic = req(resolveSlices(snapshot, sliced).find((s) => s.sliceName === "SystolicBP"));

    expect(systolic.constraints.map((c) => [c.path, c.kind])).toEqual([
      ["code.coding.system", "fixed"],
      ["code.coding.code", "fixed"],
    ]);
  });

  it("assigns each component by the value its re-slice fixes, and is not unchecked", () => {
    const result = matchSlices(
      [loinc("8480-6"), loinc("8462-4"), loinc("1111-1")],
      resolveSlices(snapshot, sliced),
      discriminators,
    );

    expect(result.unchecked).toBe(false);
    expect(result.assignments).toEqual(["SystolicBP", "DiastolicBP", undefined]);
  });

  /** A blood-pressure Observation whose components carry these LOINC codings, one list each. */
  function bpObservation(...codings: string[][]) {
    return req(
      parseResource(
        JSON.stringify({
          resourceType: "Observation",
          status: "final",
          code: { text: "blood pressure" },
          component: codings.map((codes) => ({
            code: { coding: codes.map((code) => ({ system: "http://loinc.org", code })) },
          })),
        }),
      ).resource,
    );
  }

  it("draws no finding at all on a conformant blood-pressure Observation", () => {
    expect(collectProfileIssues(bpObservation(["8480-6"], ["8462-4"]), bp)).toEqual([]);
  });

  it("checks a re-slice's cardinality within its parent slice's member, once", () => {
    const findings = collectProfileIssues(bpObservation(["8480-6", "8480-6"], ["8462-4"]), bp);

    expect(findings.map((f) => [f.code, f.expression])).toEqual([
      ["CARDINALITY_MAX", "Observation.component[0].code.coding:SBPCode"],
    ]);
  });

  it("reports a required slice whose member is missing at that slice", () => {
    const findings = collectProfileIssues(bpObservation(["8480-6"], ["1111-1"]), bp);

    expect(findings.map((f) => [f.code, f.expression])).toEqual([
      ["CARDINALITY_MIN", "Observation.component:DiastolicBP"],
    ]);
  });
});

/**
 * A slice's own constraints apply to its members alone.
 *
 * Every element under a slice's id (`Observation.component:S.code`, and a re-slice's elements under
 * it) constrains only the occurrences the slicing assigned to that slice. The elements of the
 * sliced element itself (`Observation.component.code`) still apply to every occurrence. Applying a
 * slice's elements to every occurrence put each slice's fixed and pattern values on the other
 * slices' members, so a conformant two-component Observation drew a `PROFILE_PATTERN_MISMATCH` per
 * component.
 */
describe("a slice's constraints apply only to the occurrences assigned to it", () => {
  const LOINC = "http://loinc.org";
  const UCUM = "http://unitsofmeasure.org";

  /** One component slice, discriminated by a `code` pattern, whose value must be in mm[Hg]. */
  function patternSlice(slice: string, code: string): unknown[] {
    const id = `Observation.component:${slice}`;
    return [
      { id, path: "Observation.component", sliceName: slice, min: 1, max: "1" },
      {
        id: `${id}.code`,
        path: "Observation.component.code",
        min: 1,
        max: "1",
        patternCodeableConcept: { coding: [{ system: LOINC, code }] },
      },
      {
        id: `${id}.value[x]`,
        path: "Observation.component.value[x]",
        min: 1,
        max: "1",
        patternQuantity: { system: UCUM, code: "mm[Hg]" },
      },
      {
        id: `${id}.value[x].value`,
        path: "Observation.component.value[x].value",
        min: 1,
        max: "1",
      },
    ];
  }

  const twoSlices = loadSd({
    resourceType: "StructureDefinition",
    url: "http://example.org/StructureDefinition/two-component",
    type: "Observation",
    kind: "resource",
    derivation: "constraint",
    snapshot: {
      element: [
        { id: "Observation", path: "Observation" },
        {
          id: "Observation.component",
          path: "Observation.component",
          min: 2,
          max: "*",
          slicing: { discriminator: [{ type: "pattern", path: "code" }], rules: "open" },
        },
        { id: "Observation.component.code", path: "Observation.component.code", min: 1, max: "1" },
        ...patternSlice("S", "8480-6"),
        ...patternSlice("D", "8462-4"),
      ],
    },
  });

  /** A component with one LOINC coding and, unless `unit` is `null`, a Quantity value. */
  function comp(code: string, unit: string | null = "mm[Hg]", value = 120): unknown {
    const c: Record<string, unknown> = { code: { coding: [{ system: LOINC, code }] } };
    if (unit !== null) c["valueQuantity"] = { value, system: UCUM, code: unit };
    return c;
  }

  function observation(...components: unknown[]) {
    return req(
      parseResource(
        JSON.stringify({
          resourceType: "Observation",
          status: "final",
          code: { text: "blood pressure" },
          component: components,
        }),
      ).resource,
    );
  }

  function findings(resource: ReturnType<typeof observation>, profile: StructureDefinition) {
    return collectProfileIssues(resource, profile).map((f) => [f.code, f.expression]);
  }

  it("draws nothing on a conformant two-component Observation", () => {
    expect(findings(observation(comp("8480-6"), comp("8462-4", "mm[Hg]", 80)), twoSlices)).toEqual(
      [],
    );
  });

  it("reports a member's wrong value once, at that member", () => {
    expect(findings(observation(comp("8480-6"), comp("8462-4", "kPa", 10)), twoSlices)).toEqual([
      ["PROFILE_PATTERN_MISMATCH", "Observation.component[1].value[x]"],
    ]);
  });

  it("reports a member's missing required descendant at that member", () => {
    expect(findings(observation(comp("8480-6", null), comp("8462-4")), twoSlices)).toEqual([
      ["CARDINALITY_MIN", "Observation.component[0].value[x]"],
    ]);
  });

  it("reports a required slice with no member at the slice", () => {
    expect(findings(observation(comp("8462-4"), comp("9999-9")), twoSlices)).toEqual([
      ["CARDINALITY_MIN", "Observation.component:S"],
    ]);
  });

  it("still applies the sliced element's own constraints to every occurrence", () => {
    const noCode = observation(comp("8480-6"), comp("8462-4"), { valueString: "free text" });
    expect(findings(noCode, twoSlices)).toEqual([
      ["CARDINALITY_MIN", "Observation.component[2].code"],
    ]);
  });

  it("does not apply a slice's descendants when the slicing is unchecked", () => {
    const unchecked = loadSd({
      resourceType: "StructureDefinition",
      url: "http://example.org/StructureDefinition/unchecked",
      type: "Observation",
      snapshot: {
        element: [
          { id: "Observation", path: "Observation" },
          {
            id: "Observation.component",
            path: "Observation.component",
            slicing: { discriminator: [{ type: "type", path: "value[x]" }], rules: "open" },
          },
          ...patternSlice("S", "8480-6"),
        ],
      },
    });
    expect(findings(observation(comp("8462-4", "kPa", 10)), unchecked)).toEqual([
      ["PROFILE_SLICE_UNCHECKED", "Observation.component"],
    ]);
  });

  it("evaluates a slice descendant's invariant on that slice's members alone", () => {
    const withInvariant = loadSd({
      resourceType: "StructureDefinition",
      url: "http://example.org/StructureDefinition/slice-invariant",
      type: "Observation",
      snapshot: {
        element: [
          { id: "Observation", path: "Observation" },
          {
            id: "Observation.component",
            path: "Observation.component",
            slicing: { discriminator: [{ type: "pattern", path: "code" }], rules: "open" },
          },
          ...patternSlice("S", "8480-6").map((e: unknown) =>
            (e as { id: string }).id === "Observation.component:S.value[x]"
              ? {
                  ...(e as object),
                  constraint: [{ key: "sys-1", severity: "error", expression: "value > 100" }],
                }
              : e,
          ),
        ],
      },
    });
    const ok = observation(comp("8480-6", "mm[Hg]", 120), comp("8462-4", "mm[Hg]", 80));
    expect(collectInvariantIssues(ok, withInvariant)).toEqual([]);

    const low = observation(comp("8480-6", "mm[Hg]", 90), comp("8462-4", "mm[Hg]", 80));
    expect(
      collectInvariantIssues(low, withInvariant).map((f) => [f.code, f.expression, f.constraint]),
    ).toEqual([["INVARIANT_VIOLATED", "Observation.component[0].value[x]", "sys-1"]]);
  });
});
