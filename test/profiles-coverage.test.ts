import { describe, expect, it } from "vitest";

import {
  collectProfileIssues,
  collectProfileVersionIssues,
  complex,
  generateSnapshot,
  list,
  loadStructureDefinition,
  matchSlices,
  parseResource,
  primitive,
  resolvePath,
  resolveSlices,
  type BaseResolver,
  type StructureDefinition,
} from "../src/index.js";
import { req } from "./_util.js";

function loadSd(obj: unknown): StructureDefinition {
  return req(loadStructureDefinition(parseResource(JSON.stringify(obj)).resource));
}

function parse(obj: unknown) {
  return parseResource(JSON.stringify(obj)).resource;
}

describe("loadStructureDefinition — remaining branches", () => {
  it("reads type profiles, a strength-only binding, and drops an unknown derivation / bad max / non-int min", () => {
    const sd = loadSd({
      resourceType: "StructureDefinition",
      url: "http://x",
      type: "Observation",
      derivation: "unknown-derivation",
      differential: {
        element: [
          {
            id: "Observation.value[x]",
            path: "Observation.value[x]",
            min: 1.5, // non-integer → parseMin returns undefined
            max: "not-a-number", // parseMax returns undefined
            type: [
              { code: "Quantity", profile: ["http://p"], targetProfile: ["http://t"] },
              {}, // no code → skipped
            ],
            binding: { strength: "required" }, // no valueSet
          },
          { id: "Observation.hasMember", path: "Observation.hasMember", min: true }, // boolean min → undefined
          { path: "Observation.code" }, // no id → id defaults to path; no min/max
          { id: "no-path-here" }, // no path → element skipped entirely
        ],
      },
    });
    expect(sd.derivation).toBeUndefined();
    const value = req(sd.differential?.[0]);
    expect(value.min).toBeUndefined();
    expect(value.max).toBeUndefined();
    expect(req(value.type)[0]).toEqual({
      code: "Quantity",
      profile: ["http://p"],
      targetProfile: ["http://t"],
    });
    expect(req(value.binding)).toEqual({ strength: "required" });
    expect(req(sd.differential?.[1]).min).toBeUndefined();
    expect(req(sd.differential?.[2]).id).toBe("Observation.code");
    expect(sd.differential).toHaveLength(3); // the id-only element with no path was dropped
  });

  it("reads a single (non-list) discriminator and drops a discriminator missing type or path", () => {
    const sd = loadSd({
      resourceType: "StructureDefinition",
      url: "http://x",
      type: "Observation",
      differential: {
        element: [
          {
            id: "Observation.category",
            path: "Observation.category",
            slicing: {
              discriminator: { type: "pattern", path: "$this" }, // single object, not a list
              rules: "closed",
            },
          },
        ],
      },
    });
    const slicing = req(req(sd.differential?.[0]).slicing);
    expect(slicing.discriminator).toEqual([{ type: "pattern", path: "$this" }]);
    expect(slicing.rules).toBe("closed");
  });
});

describe("generateSnapshot — mergeElement overrides every stated field", () => {
  it("overlays max, mustSupport, slicing, type, fixed, pattern, and binding onto a matched base element", () => {
    const base = loadSd({
      resourceType: "StructureDefinition",
      url: "http://base",
      type: "Observation",
      snapshot: {
        element: [
          { id: "Observation", path: "Observation" },
          { id: "Observation.category", path: "Observation.category", min: 0, max: "1" },
        ],
      },
    });
    const profile = loadSd({
      resourceType: "StructureDefinition",
      url: "http://profile",
      type: "Observation",
      baseDefinition: "http://base",
      differential: {
        element: [
          {
            id: "Observation.category",
            path: "Observation.category",
            max: "*",
            mustSupport: true,
            slicing: { discriminator: [{ type: "value", path: "coding.code" }], rules: "open" },
            type: [{ code: "CodeableConcept" }],
            patternCodeableConcept: { coding: [{ code: "vital-signs" }] },
            binding: { strength: "extensible", valueSet: "http://vs" },
          },
        ],
      },
    });
    const resolve: BaseResolver = (url) => (url === "http://base" ? base : undefined);
    const merged = req(
      generateSnapshot(profile, resolve).find((e) => e.id === "Observation.category"),
    );
    expect(merged.max).toBe(Number.POSITIVE_INFINITY);
    expect(merged.mustSupport).toBe(true);
    expect(merged.slicing?.rules).toBe("open");
    expect(req(merged.type)[0]?.code).toBe("CodeableConcept");
    expect(merged.pattern?.type).toBe("CodeableConcept");
    expect(merged.binding).toEqual({ strength: "extensible", valueSet: "http://vs" });
  });

  it("appends a new differential element with no locatable anchor", () => {
    const base = loadSd({
      resourceType: "StructureDefinition",
      url: "http://base0",
      type: "Basic",
      snapshot: { element: [{ id: "Basic", path: "Basic" }] },
    });
    const profile = loadSd({
      resourceType: "StructureDefinition",
      url: "http://profile0",
      type: "Basic",
      baseDefinition: "http://base0",
      differential: { element: [{ id: "Unanchored", path: "Unanchored" }] }, // no dot, no path sibling → append
    });
    const resolve: BaseResolver = (url) => (url === "http://base0" ? base : undefined);
    expect(generateSnapshot(profile, resolve).map((e) => e.id)).toEqual(["Basic", "Unanchored"]);
  });

  it("overlays fixed and sliceName onto a matched base element", () => {
    const base = loadSd({
      resourceType: "StructureDefinition",
      url: "http://base3",
      type: "Observation",
      snapshot: {
        element: [
          { id: "Observation", path: "Observation" },
          { id: "Observation.status", path: "Observation.status", min: 1, max: "1" },
        ],
      },
    });
    const profile = loadSd({
      resourceType: "StructureDefinition",
      url: "http://profile3",
      type: "Observation",
      baseDefinition: "http://base3",
      differential: {
        element: [
          {
            id: "Observation.status",
            path: "Observation.status",
            sliceName: "s",
            fixedCode: "final",
          },
        ],
      },
    });
    const resolve: BaseResolver = (url) => (url === "http://base3" ? base : undefined);
    const merged = req(
      generateSnapshot(profile, resolve).find((e) => e.id === "Observation.status"),
    );
    expect(merged.sliceName).toBe("s");
    expect(merged.fixed?.type).toBe("Code");
  });

  it("places a new descendant element after its parent group when no path sibling exists", () => {
    const base = loadSd({
      resourceType: "StructureDefinition",
      url: "http://b2",
      type: "Observation",
      snapshot: {
        element: [
          { id: "Observation", path: "Observation" },
          { id: "Observation.component", path: "Observation.component", min: 0, max: "*" },
        ],
      },
    });
    const profile = loadSd({
      resourceType: "StructureDefinition",
      url: "http://p2",
      type: "Observation",
      baseDefinition: "http://b2",
      differential: {
        element: [
          {
            id: "Observation.component.code",
            path: "Observation.component.code",
            min: 1,
            max: "1",
          },
        ],
      },
    });
    const resolve: BaseResolver = (url) => (url === "http://b2" ? base : undefined);
    const ids = generateSnapshot(profile, resolve).map((e) => e.id);
    expect(ids).toEqual(["Observation", "Observation.component", "Observation.component.code"]);
  });
});

describe("navigate + slicing — remaining branches", () => {
  it("resolvePath returns nothing when stepping into a non-complex leaf", () => {
    const { resource } = parseResource('{"resourceType":"Patient","active":true}');
    expect(resolvePath(resource, "active.value")).toEqual([]);
  });

  it("matchSlices evaluates a fixed-kind discriminator and an 'expect absent' exists discriminator", () => {
    const sd = loadSd({
      resourceType: "StructureDefinition",
      url: "http://s",
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
    const sliced = req(sd.snapshot?.[0]);
    const slices = resolveSlices(req(sd.snapshot), sliced);
    const lab = complex([
      {
        name: "coding",
        value: list([complex([{ name: "code", value: primitive("laboratory") }])]),
      },
    ]);
    const other = complex([
      {
        name: "coding",
        value: list([complex([{ name: "code", value: primitive("social-history") }])]),
      },
    ]);
    const result = matchSlices([lab, other], slices, [{ type: "value", path: "coding.code" }]);
    expect(result.assignments).toEqual(["Lab", undefined]);
  });

  it("reports unchecked when an exists discriminator has no existence expectation on the slice", () => {
    const sd = loadSd({
      resourceType: "StructureDefinition",
      url: "http://s3",
      type: "Observation",
      snapshot: {
        element: [
          {
            id: "Observation.category",
            path: "Observation.category",
            slicing: { discriminator: [{ type: "exists", path: "text" }], rules: "open" },
          },
          { id: "Observation.category:Any", path: "Observation.category", sliceName: "Any" }, // no descendant min/max at `text`
        ],
      },
    });
    const sliced = req(sd.snapshot?.[0]);
    const slices = resolveSlices(req(sd.snapshot), sliced);
    const occ = complex([{ name: "text", value: primitive("free") }]);
    expect(matchSlices([occ], slices, [{ type: "exists", path: "text" }]).unchecked).toBe(true);
  });

  it("matchSlices handles an 'expect absent' (max 0) exists discriminator", () => {
    const sd = loadSd({
      resourceType: "StructureDefinition",
      url: "http://s2",
      type: "Observation",
      snapshot: {
        element: [
          {
            id: "Observation.category",
            path: "Observation.category",
            slicing: { discriminator: [{ type: "exists", path: "text" }], rules: "open" },
          },
          { id: "Observation.category:NoText", path: "Observation.category", sliceName: "NoText" },
          { id: "Observation.category:NoText.text", path: "Observation.category.text", max: "0" },
        ],
      },
    });
    const sliced = req(sd.snapshot?.[0]);
    const slices = resolveSlices(req(sd.snapshot), sliced);
    const noText = complex([
      { name: "coding", value: list([complex([{ name: "code", value: primitive("x") }])]) },
    ]);
    const hasText = complex([{ name: "text", value: primitive("free") }]);
    const result = matchSlices([noText, hasText], slices, [{ type: "exists", path: "text" }]);
    expect(result.assignments).toEqual(["NoText", undefined]);
  });
});

describe("validate-profile — remaining branches", () => {
  it("indexes the FHIRPath location of a mismatch only on a repeating element", () => {
    const profile = loadSd({
      resourceType: "StructureDefinition",
      url: "http://x/patcat",
      type: "Observation",
      snapshot: {
        element: [
          { id: "Observation", path: "Observation" },
          {
            id: "Observation.category",
            path: "Observation.category",
            min: 0,
            max: "*",
            patternCodeableConcept: { coding: [{ code: "vital-signs" }] },
          },
        ],
      },
    });
    const obs = parse({
      resourceType: "Observation",
      category: [{ coding: [{ code: "vital-signs" }] }, { coding: [{ code: "laboratory" }] }],
    });
    const issues = collectProfileIssues(obs, profile).filter(
      (i) => i.code === "PROFILE_PATTERN_MISMATCH",
    );
    expect(issues).toHaveLength(1);
    expect(req(issues[0]).expression).toBe("Observation.category[1]");
  });

  it("flags a profile max exceeded and an indexed fixed mismatch on a repeating element", () => {
    const profile = loadSd({
      resourceType: "StructureDefinition",
      url: "http://x/fixedcat",
      type: "Observation",
      snapshot: {
        element: [
          { id: "Observation", path: "Observation" },
          {
            id: "Observation.category",
            path: "Observation.category",
            min: 0,
            max: "1",
            fixedCode: "vital-signs",
          },
        ],
      },
    });
    // Two occurrences (exceeds max 1); the second value is not the fixed one.
    const obs = parse({ resourceType: "Observation", category: ["vital-signs", "laboratory"] });
    const issues = collectProfileIssues(obs, profile);
    expect(issues.map((i) => i.code)).toContain("CARDINALITY_MAX");
    const fixed = issues.filter((i) => i.code === "PROFILE_FIXED_MISMATCH");
    expect(fixed.map((i) => i.expression)).toEqual(["Observation.category[1]"]);
  });

  it("does not raise an unmatched finding under open slicing, and honors slice max + present must-support", () => {
    const profile = loadSd({
      resourceType: "StructureDefinition",
      url: "http://x/openslice",
      type: "Observation",
      snapshot: {
        element: [
          { id: "Observation", path: "Observation" },
          {
            id: "Observation.category",
            path: "Observation.category",
            min: 0,
            max: "*",
            slicing: { discriminator: [{ type: "pattern", path: "$this" }], rules: "open" },
          },
          {
            id: "Observation.category:VSCat",
            path: "Observation.category",
            sliceName: "VSCat",
            min: 0,
            max: "1",
            mustSupport: true,
            patternCodeableConcept: { coding: [{ code: "vital-signs" }] },
          },
        ],
      },
    });
    // Two vital-signs occurrences (slice max 1 exceeded) plus one unmatched — open rules allow the unmatched.
    const obs = parse({
      resourceType: "Observation",
      category: [
        { coding: [{ code: "vital-signs" }] },
        { coding: [{ code: "vital-signs" }] },
        { coding: [{ code: "laboratory" }] },
      ],
    });
    const issues = collectProfileIssues(obs, profile);
    expect(issues.map((i) => i.code)).not.toContain("PROFILE_SLICE_UNMATCHED"); // open slicing
    expect(issues.map((i) => i.code)).not.toContain("MUST_SUPPORT_ABSENT"); // VSCat present
    const max = issues.find(
      (i) => i.code === "CARDINALITY_MAX" && i.expression === "Observation.category:VSCat",
    );
    expect(max).toBeDefined();
  });

  it("reads meta.profile given as a single canonical string (not a list)", () => {
    const obs = parse({
      resourceType: "Observation",
      meta: {
        profile: "http://hl7.org/fhir/us/core/StructureDefinition/us-core-observation|3.1.1",
      },
    });
    const supplied: StructureDefinition = {
      url: "http://hl7.org/fhir/us/core/StructureDefinition/us-core-observation",
      version: "6.1.0",
      type: "Observation",
    };
    const issues = collectProfileVersionIssues(obs, [supplied]);
    expect(issues.map((i) => i.code)).toEqual(["PROFILE_VERSION_MISMATCH"]);
  });
});
