import { describe, expect, it } from "vitest";

import {
  collectProfileIssues,
  collectProfileVersionIssues,
  loadStructureDefinition,
  parseResource,
  validateResource,
  type StructureDefinition,
  type ValidationIssue,
} from "../src/index.js";
import { req } from "./_util.js";

function loadSd(obj: unknown): StructureDefinition {
  return req(loadStructureDefinition(parseResource(JSON.stringify(obj)).resource));
}

function parse(obj: unknown) {
  return parseResource(JSON.stringify(obj)).resource;
}

function codes(issues: readonly ValidationIssue[]): string[] {
  return issues.map((i) => i.code);
}

/** A US-Core-shaped AllergyIntolerance profile (snapshot form), must-support + required elements. */
const allergyProfile = loadSd({
  resourceType: "StructureDefinition",
  url: "http://hl7.org/fhir/us/core/StructureDefinition/us-core-allergyintolerance",
  version: "6.1.0",
  type: "AllergyIntolerance",
  derivation: "constraint",
  snapshot: {
    element: [
      { id: "AllergyIntolerance", path: "AllergyIntolerance" },
      {
        id: "AllergyIntolerance.clinicalStatus",
        path: "AllergyIntolerance.clinicalStatus",
        min: 0,
        max: "1",
        mustSupport: true,
      },
      {
        id: "AllergyIntolerance.verificationStatus",
        path: "AllergyIntolerance.verificationStatus",
        min: 0,
        max: "1",
        mustSupport: true,
      },
      {
        id: "AllergyIntolerance.code",
        path: "AllergyIntolerance.code",
        min: 1,
        max: "1",
        mustSupport: true,
      },
      {
        id: "AllergyIntolerance.patient",
        path: "AllergyIntolerance.patient",
        min: 1,
        max: "1",
        mustSupport: true,
      },
    ],
  },
});

describe("collectProfileIssues: must-support as a system obligation", () => {
  it("flags an absent must-support element as information, never an error", () => {
    const allergy = parse({
      resourceType: "AllergyIntolerance",
      clinicalStatus: { coding: [{ code: "active" }] },
      code: { coding: [{ code: "227493005" }] },
      patient: { reference: "Patient/1" },
    });
    const issues = collectProfileIssues(allergy, allergyProfile);
    const ms = issues.filter((i) => i.code === "MUST_SUPPORT_ABSENT");
    expect(ms).toHaveLength(1);
    expect(req(ms[0]).severity).toBe("information");
    expect(req(ms[0]).expression).toBe("AllergyIntolerance.verificationStatus");
    // Absent must-support must not push the resource invalid.
    expect(issues.every((i) => i.severity !== "error")).toBe(true);
  });

  it("does not flag a present must-support element", () => {
    const allergy = parse({
      resourceType: "AllergyIntolerance",
      clinicalStatus: { coding: [{ code: "active" }] },
      verificationStatus: { coding: [{ code: "confirmed" }] },
      code: { coding: [{ code: "227493005" }] },
      patient: { reference: "Patient/1" },
    });
    expect(codes(collectProfileIssues(allergy, allergyProfile))).not.toContain(
      "MUST_SUPPORT_ABSENT",
    );
  });

  it("enforces profile-tightened required cardinality", () => {
    const allergy = parse({
      resourceType: "AllergyIntolerance",
      code: { coding: [{ code: "x" }] },
    });
    const issues = collectProfileIssues(allergy, allergyProfile);
    const min = issues.filter((i) => i.code === "CARDINALITY_MIN");
    expect(min.map((i) => i.expression)).toContain("AllergyIntolerance.patient");
    expect(req(min[0]).severity).toBe("error");
  });

  it("returns nothing when the profile does not apply to the resource type", () => {
    expect(collectProfileIssues(parse({ resourceType: "Observation" }), allergyProfile)).toEqual(
      [],
    );
  });
});

describe("collectProfileIssues: cardinality is per parent, not root-flattened", () => {
  // A backbone (0..*) with a required (1..*/1..1) child: cardinality is relative to the parent.
  const nested = loadSd({
    resourceType: "StructureDefinition",
    url: "http://x/nested",
    type: "Observation",
    snapshot: {
      element: [
        { id: "Observation", path: "Observation" },
        { id: "Observation.component", path: "Observation.component", min: 0, max: "*" },
        { id: "Observation.component.code", path: "Observation.component.code", min: 1, max: "1" },
        { id: "Observation.reaction", path: "Observation.reaction", min: 0, max: "*" },
        {
          id: "Observation.reaction.manifestation",
          path: "Observation.reaction.manifestation",
          min: 1,
          max: "*",
        },
      ],
    },
  });

  it("does not false-error a required child when its optional parent is absent", () => {
    const obs = parse({ resourceType: "Observation", status: "final" }); // no component, no reaction
    expect(codes(collectProfileIssues(obs, nested))).not.toContain("CARDINALITY_MIN");
  });

  it("does not false-error CARDINALITY_MAX when each parent holds one child (not N total)", () => {
    const obs = parse({
      resourceType: "Observation",
      component: [{ code: { text: "a" } }, { code: { text: "b" } }, { code: { text: "c" } }],
    });
    expect(codes(collectProfileIssues(obs, nested))).not.toContain("CARDINALITY_MAX");
  });

  it("still flags a required child missing within a present parent", () => {
    const obs = parse({
      resourceType: "Observation",
      component: [{ code: { text: "a" } }, { valueString: "x" }],
    });
    const issues = collectProfileIssues(obs, nested);
    const min = issues.filter((i) => i.code === "CARDINALITY_MIN");
    expect(min).toHaveLength(1);
    expect(req(min[0]).expression).toBe("Observation.component[1].code"); // second component lacks code
  });
});

describe("collectProfileIssues: fixed[x] and pattern[x]", () => {
  const fixedStatus = loadSd({
    resourceType: "StructureDefinition",
    url: "http://x/fixed-status",
    type: "Observation",
    snapshot: {
      element: [
        { id: "Observation", path: "Observation" },
        { id: "Observation.status", path: "Observation.status", fixedCode: "final" },
      ],
    },
  });

  it("errors when a value is not exactly the fixed value", () => {
    const bad = collectProfileIssues(
      parse({ resourceType: "Observation", status: "preliminary" }),
      fixedStatus,
    );
    expect(codes(bad)).toContain("PROFILE_FIXED_MISMATCH");
    expect(req(bad.find((i) => i.code === "PROFILE_FIXED_MISMATCH")).severity).toBe("error");
  });

  it("passes when the value matches the fixed value", () => {
    expect(
      codes(
        collectProfileIssues(parse({ resourceType: "Observation", status: "final" }), fixedStatus),
      ),
    ).not.toContain("PROFILE_FIXED_MISMATCH");
  });

  const patternCategory = loadSd({
    resourceType: "StructureDefinition",
    url: "http://x/pattern-category",
    type: "Observation",
    snapshot: {
      element: [
        { id: "Observation", path: "Observation" },
        {
          id: "Observation.category",
          path: "Observation.category",
          min: 1,
          max: "1",
          patternCodeableConcept: { coding: [{ code: "vital-signs" }] },
        },
      ],
    },
  });

  it("errors when an element does not match the pattern (subset), passing when it does with extras", () => {
    const ok = parse({
      resourceType: "Observation",
      category: [{ coding: [{ system: "http://s", code: "vital-signs", display: "Vitals" }] }],
    });
    const bad = parse({
      resourceType: "Observation",
      category: [{ coding: [{ code: "laboratory" }] }],
    });
    expect(codes(collectProfileIssues(ok, patternCategory))).not.toContain(
      "PROFILE_PATTERN_MISMATCH",
    );
    expect(codes(collectProfileIssues(bad, patternCategory))).toContain("PROFILE_PATTERN_MISMATCH");
  });
});

describe("collectProfileIssues: slicing", () => {
  const vitalsProfile = loadSd({
    resourceType: "StructureDefinition",
    url: "http://x/vitals",
    type: "Observation",
    snapshot: {
      element: [
        { id: "Observation", path: "Observation" },
        {
          id: "Observation.category",
          path: "Observation.category",
          min: 1,
          max: "*",
          slicing: { discriminator: [{ type: "pattern", path: "$this" }], rules: "closed" },
        },
        {
          id: "Observation.category:VSCat",
          path: "Observation.category",
          sliceName: "VSCat",
          min: 1,
          max: "1",
          patternCodeableConcept: {
            coding: [
              {
                system: "http://terminology.hl7.org/CodeSystem/observation-category",
                code: "vital-signs",
              },
            ],
          },
        },
      ],
    },
  });

  it("matches a conformant vital-signs category with no slice findings", () => {
    const obs = parse({
      resourceType: "Observation",
      category: [
        {
          coding: [
            {
              system: "http://terminology.hl7.org/CodeSystem/observation-category",
              code: "vital-signs",
            },
          ],
        },
      ],
    });
    const issues = codes(collectProfileIssues(obs, vitalsProfile));
    expect(issues).not.toContain("PROFILE_SLICE_UNMATCHED");
    expect(issues).not.toContain("CARDINALITY_MIN");
  });

  it("flags an unmatched occurrence under closed slicing and the missing required slice", () => {
    const obs = parse({
      resourceType: "Observation",
      category: [{ coding: [{ code: "laboratory" }] }],
    });
    const issues = collectProfileIssues(obs, vitalsProfile);
    expect(codes(issues)).toContain("PROFILE_SLICE_UNMATCHED");
    const min = issues.find(
      (i) => i.code === "CARDINALITY_MIN" && i.expression === "Observation.category:VSCat",
    );
    expect(min).toBeDefined();
  });

  it("reports slice membership unchecked for an unsupported discriminator (never silently passes)", () => {
    const typeSliced = loadSd({
      resourceType: "StructureDefinition",
      url: "http://x/typesliced",
      type: "Observation",
      snapshot: {
        element: [
          { id: "Observation", path: "Observation" },
          {
            id: "Observation.value[x]",
            path: "Observation.value[x]",
            slicing: { discriminator: [{ type: "type", path: "$this" }], rules: "open" },
          },
          {
            id: "Observation.value[x]:valueQuantity",
            path: "Observation.value[x]",
            sliceName: "valueQuantity",
          },
        ],
      },
    });
    const obs = parse({ resourceType: "Observation", valueString: "POSITIVE" });
    const issues = collectProfileIssues(obs, typeSliced);
    expect(codes(issues)).toContain("PROFILE_SLICE_UNCHECKED");
    expect(codes(issues)).not.toContain("PROFILE_SLICE_UNMATCHED");
  });
});

describe("collectProfileVersionIssues: meta.profile version pins", () => {
  it("flags a declared canonical|version whose canonical is supplied at a different version", () => {
    const obs = parse({
      resourceType: "AllergyIntolerance",
      meta: {
        profile: [
          "http://hl7.org/fhir/us/core/StructureDefinition/us-core-allergyintolerance|3.1.1",
        ],
      },
      code: { coding: [{ code: "x" }] },
      patient: { reference: "Patient/1" },
    });
    const issues = collectProfileVersionIssues(obs, [allergyProfile]); // supplied is 6.1.0
    expect(codes(issues)).toEqual(["PROFILE_VERSION_MISMATCH"]);
    expect(req(issues[0]).severity).toBe("warning");
    expect(req(issues[0]).expression).toBe("AllergyIntolerance.meta.profile[0]");
  });

  it("does not flag a matching version, an unpinned canonical, or an unsupplied canonical", () => {
    const matching = parse({
      resourceType: "AllergyIntolerance",
      meta: {
        profile: [
          "http://hl7.org/fhir/us/core/StructureDefinition/us-core-allergyintolerance|6.1.0",
        ],
      },
    });
    const unpinned = parse({
      resourceType: "AllergyIntolerance",
      meta: {
        profile: ["http://hl7.org/fhir/us/core/StructureDefinition/us-core-allergyintolerance"],
      },
    });
    const other = parse({
      resourceType: "AllergyIntolerance",
      meta: { profile: ["http://example.org/other|1.0.0"] },
    });
    expect(collectProfileVersionIssues(matching, [allergyProfile])).toEqual([]);
    expect(collectProfileVersionIssues(unpinned, [allergyProfile])).toEqual([]);
    expect(collectProfileVersionIssues(other, [allergyProfile])).toEqual([]);
  });

  it("returns nothing when the resource carries no meta.profile", () => {
    expect(
      collectProfileVersionIssues(parse({ resourceType: "AllergyIntolerance" }), [allergyProfile]),
    ).toEqual([]);
  });
});

describe("validateResource: Phase 6 profile layer wiring", () => {
  it("runs the profile layer only when profiles are supplied", () => {
    // clinicalStatus present (satisfies the Phase-3 ait-1 invariant); verificationStatus is the one
    // absent must-support element, an info finding that must not push the resource invalid.
    const allergy = parse({
      resourceType: "AllergyIntolerance",
      clinicalStatus: { coding: [{ code: "active" }] },
      code: { coding: [{ code: "x" }] },
      patient: { reference: "Patient/1" },
    });
    const withoutProfiles = validateResource(allergy);
    expect(codes(withoutProfiles.issues)).not.toContain("MUST_SUPPORT_ABSENT");

    const withProfiles = validateResource(allergy, { profiles: [allergyProfile] });
    expect(codes(withProfiles.issues).filter((c) => c === "MUST_SUPPORT_ABSENT")).toHaveLength(1);
    expect(withProfiles.valid).toBe(true);
  });

  it("surfaces a profile version mismatch and a required-cardinality error through validateResource", () => {
    const allergy = parse({
      resourceType: "AllergyIntolerance",
      meta: {
        profile: [
          "http://hl7.org/fhir/us/core/StructureDefinition/us-core-allergyintolerance|3.1.1",
        ],
      },
      code: { coding: [{ code: "x" }] },
    });
    const result = validateResource(allergy, { profiles: [allergyProfile] });
    expect(codes(result.issues)).toContain("PROFILE_VERSION_MISMATCH");
    expect(codes(result.issues)).toContain("CARDINALITY_MIN"); // patient min 1, absent
    expect(result.valid).toBe(false);
  });
});
