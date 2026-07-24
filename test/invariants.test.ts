import { describe, expect, it } from "vitest";

import {
  collectInvariantIssues,
  generateSnapshot,
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

describe("loadStructureDefinition: constraint parsing", () => {
  it("reads key / severity / human / expression, defaulting severity to error", () => {
    const sd = loadSd({
      resourceType: "StructureDefinition",
      url: "http://x/p",
      type: "Observation",
      snapshot: {
        element: [
          {
            id: "Observation",
            path: "Observation",
            constraint: [
              {
                key: "x-1",
                severity: "warning",
                human: "must have a code",
                expression: "code.exists()",
              },
              { key: "x-2", expression: "status.exists()" },
              { key: "bad", human: "no expression" }, // dropped: no expression
            ],
          },
        ],
      },
    });
    const root = req(sd.snapshot?.[0]);
    expect(root.constraint?.map((c) => c.key)).toEqual(["x-1", "x-2"]);
    expect(req(root.constraint?.[0]).severity).toBe("warning");
    expect(req(root.constraint?.[1]).severity).toBe("error"); // defaulted
  });
});

describe("generateSnapshot: invariants accumulate down the derivation chain", () => {
  it("merges base + differential constraints by key (differential wins)", () => {
    const base = loadSd({
      resourceType: "StructureDefinition",
      url: "http://x/base",
      type: "Observation",
      snapshot: {
        element: [
          {
            id: "Observation",
            path: "Observation",
            constraint: [{ key: "ele-1", severity: "error", expression: "hasValue()" }],
          },
        ],
      },
    });
    const profile = loadSd({
      resourceType: "StructureDefinition",
      url: "http://x/profile",
      type: "Observation",
      baseDefinition: "http://x/base",
      differential: {
        element: [
          {
            id: "Observation",
            path: "Observation",
            constraint: [{ key: "us-core-1", severity: "error", expression: "code.exists()" }],
          },
        ],
      },
    });
    const snap = generateSnapshot(profile, (url) => (url === base.url ? base : undefined));
    expect(req(snap[0]).constraint?.map((c) => c.key)).toEqual(["ele-1", "us-core-1"]);
  });
});

describe("collectInvariantIssues", () => {
  const profile = loadSd({
    resourceType: "StructureDefinition",
    url: "http://x/patient",
    type: "Patient",
    snapshot: {
      element: [
        {
          id: "Patient",
          path: "Patient",
          constraint: [
            {
              key: "us-core-6",
              severity: "error",
              expression: "name.exists() or telecom.exists()",
            },
            { key: "warn-1", severity: "warning", expression: "gender.exists()" },
          ],
        },
      ],
    },
  });

  it("emits INVARIANT_VIOLATED (error) for a violated required constraint", () => {
    const issues = collectInvariantIssues(parse({ resourceType: "Patient" }), profile);
    const violated = issues.filter((i) => i.code === "INVARIANT_VIOLATED");
    expect(violated.map((i) => i.constraint)).toContain("us-core-6");
    const us = req(violated.find((i) => i.constraint === "us-core-6"));
    expect(us.severity).toBe("error");
    expect(us.expression).toBe("Patient");
  });

  it("mirrors a warning-severity constraint as a warning", () => {
    const issues = collectInvariantIssues(
      parse({ resourceType: "Patient", name: [{ family: "X" }] }),
      profile,
    );
    const warn = req(issues.find((i) => i.constraint === "warn-1"));
    expect(warn.code).toBe("INVARIANT_VIOLATED");
    expect(warn.severity).toBe("warning");
  });

  it("emits nothing when every constraint is satisfied", () => {
    const ok = parse({ resourceType: "Patient", name: [{ family: "X" }], gender: "female" });
    expect(collectInvariantIssues(ok, profile)).toEqual([]);
  });

  it("returns nothing when the profile does not apply to the resource type", () => {
    expect(collectInvariantIssues(parse({ resourceType: "Observation" }), profile)).toEqual([]);
  });

  it("reports an unevaluable expression as INVARIANT_UNCHECKED, never a violation", () => {
    const unsupported = loadSd({
      resourceType: "StructureDefinition",
      url: "http://x/uns",
      type: "Patient",
      snapshot: {
        element: [
          {
            id: "Patient",
            path: "Patient",
            constraint: [
              {
                key: "hard-1",
                severity: "error",
                expression: "link.other.resolve().active.exists()",
              },
            ],
          },
        ],
      },
    });
    const issues = collectInvariantIssues(parse({ resourceType: "Patient" }), unsupported);
    expect(codes(issues)).toEqual(["INVARIANT_UNCHECKED"]);
    expect(req(issues[0]).severity).toBe("information");
    expect(req(issues[0]).constraint).toBe("hard-1");
  });

  it("skips the seven safety-owned keys (the Phase-3 safety layer owns them)", () => {
    const withAit = loadSd({
      resourceType: "StructureDefinition",
      url: "http://x/allergy",
      type: "AllergyIntolerance",
      snapshot: {
        element: [
          {
            id: "AllergyIntolerance",
            path: "AllergyIntolerance",
            constraint: [
              {
                key: "ait-1",
                severity: "error",
                expression:
                  "verificationStatus.coding.where(system = 'http://terminology.hl7.org/CodeSystem/allergyintolerance-verification' and code = 'entered-in-error').exists() or clinicalStatus.exists()",
              },
            ],
          },
        ],
      },
    });
    // A resource that *violates* ait-1 (no clinicalStatus, not entered-in-error) draws nothing from
    // the invariant engine, the safety layer is authoritative for it.
    const issues = collectInvariantIssues(parse({ resourceType: "AllergyIntolerance" }), withAit);
    expect(issues).toEqual([]);
  });

  it("generates a snapshot from a differential via the supplied base resolver", () => {
    const base = loadSd({
      resourceType: "StructureDefinition",
      url: "http://x/base-patient",
      type: "Patient",
      snapshot: { element: [{ id: "Patient", path: "Patient" }] },
    });
    const diff = loadSd({
      resourceType: "StructureDefinition",
      url: "http://x/diff-patient",
      type: "Patient",
      baseDefinition: "http://x/base-patient",
      differential: {
        element: [
          {
            id: "Patient",
            path: "Patient",
            constraint: [{ key: "d-1", severity: "error", expression: "name.exists()" }],
          },
        ],
      },
    });
    const issues = collectInvariantIssues(parse({ resourceType: "Patient" }), diff, {
      resolve: (url) => (url === base.url ? base : undefined),
    });
    expect(issues.map((i) => i.constraint)).toEqual(["d-1"]);
  });

  it("skips a constraint whose element is absent, primitive-typed, or slice-scoped", () => {
    const sd = loadSd({
      resourceType: "StructureDefinition",
      url: "http://x/skips",
      type: "Patient",
      snapshot: {
        element: [
          { id: "Patient", path: "Patient" },
          {
            id: "Patient.contact",
            path: "Patient.contact", // absent in the instance → skipped
            constraint: [{ key: "c-1", severity: "error", expression: "name.exists()" }],
          },
          {
            id: "Patient.gender",
            path: "Patient.gender", // a primitive occurrence → no complex focus to anchor on
            constraint: [{ key: "g-1", severity: "error", expression: "exists()" }],
          },
          {
            id: "Patient.identifier:mrn",
            path: "Patient.identifier",
            sliceName: "mrn", // slice-scoped constraint → deferred, skipped here
            constraint: [{ key: "s-1", severity: "error", expression: "system.exists()" }],
          },
        ],
      },
    });
    expect(
      collectInvariantIssues(parse({ resourceType: "Patient", gender: "female" }), sd),
    ).toEqual([]);
  });

  it("evaluates a nested element constraint per occurrence, locating each", () => {
    const nested = loadSd({
      resourceType: "StructureDefinition",
      url: "http://x/nested",
      type: "Patient",
      snapshot: {
        element: [
          { id: "Patient", path: "Patient" },
          {
            id: "Patient.contact",
            path: "Patient.contact",
            constraint: [
              { key: "pat-1", severity: "error", expression: "name.exists() or telecom.exists()" },
            ],
          },
        ],
      },
    });
    const patient = parse({
      resourceType: "Patient",
      contact: [{ name: { family: "Ok" } }, { relationship: [{ text: "kin" }] }],
    });
    const issues = collectInvariantIssues(patient, nested);
    expect(issues).toHaveLength(1);
    expect(req(issues[0]).expression).toBe("Patient.contact[1]"); // second contact violates pat-1
  });
});

describe("validateResource: Phase 7 invariant layer wiring", () => {
  const profile = loadSd({
    resourceType: "StructureDefinition",
    url: "http://x/obs",
    type: "Observation",
    snapshot: {
      element: [
        {
          id: "Observation",
          path: "Observation",
          constraint: [
            { key: "us-core-obs-1", severity: "error", expression: "code.exists()" },
            { key: "info-1", severity: "error", expression: "text.div.matches('.*').exists()" },
          ],
        },
      ],
    },
  });

  it("flips valid to false on an error-severity invariant violation, and surfaces UNCHECKED as info", () => {
    const obs = parse({ resourceType: "Observation", status: "final" }); // no code → us-core-obs-1 violated
    const result = validateResource(obs, { profiles: [profile] });
    expect(codes(result.issues)).toContain("INVARIANT_VIOLATED");
    expect(codes(result.issues)).toContain("INVARIANT_UNCHECKED"); // matches() is outside the subset
    expect(result.valid).toBe(false);
    // The UNCHECKED finding is information, it must never itself flip validity.
    const unchecked = req(result.issues.find((i) => i.code === "INVARIANT_UNCHECKED"));
    expect(unchecked.severity).toBe("information");
  });

  it("does not run the invariant layer when no profiles are supplied", () => {
    const obs = parse({ resourceType: "Observation", status: "final" });
    const result = validateResource(obs);
    expect(codes(result.issues)).not.toContain("INVARIANT_VIOLATED");
    expect(codes(result.issues)).not.toContain("INVARIANT_UNCHECKED");
  });
});
