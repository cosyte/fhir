import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  parseResource,
  serializeResource,
  validateResource,
  type ValidationCode,
  type ValidationIssue,
} from "../src/index.js";

function fixture(name: string): string {
  return readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");
}

/** Parse + validate (strict does not matter for safety findings, which are mode-independent). */
function check(json: string): ReturnType<typeof validateResource> {
  return validateResource(parseResource(json).resource);
}

function codes(result: ReturnType<typeof validateResource>): ValidationCode[] {
  return result.issues.map((i) => i.code);
}

/** The invariant issue for a given constraint key, if present. */
function invariant(
  result: ReturnType<typeof validateResource>,
  key: string,
): ValidationIssue | undefined {
  return result.issues.find((i) => i.code === "INVARIANT_VIOLATED" && i.constraint === key);
}

describe("fail-closed on an unknown modifierExtension (the FHIR ?! rule)", () => {
  it("rejects any resource carrying a modifierExtension we do not understand", () => {
    const result = check(fixture("unknown-modifier.json"));
    const mod = result.issues.find((i) => i.code === "UNHANDLED_MODIFIER_EXTENSION");
    expect(mod).toBeDefined();
    expect(mod?.severity).toBe("error");
    expect(mod?.type).toBe("not-supported");
    expect(mod?.expression).toBe("Observation.modifierExtension[0]");
    expect(result.valid).toBe(false);
  });

  it("applies to every resource type, not only the six safety resources", () => {
    const result = check(
      '{"resourceType":"Patient","modifierExtension":[{"url":"http://example.org/x"}]}',
    );
    expect(codes(result)).toContain("UNHANDLED_MODIFIER_EXTENSION");
    expect(result.valid).toBe(false);
  });

  it("does not fire on a plain (non-modifier) extension", () => {
    const result = check(
      '{"resourceType":"Patient","extension":[{"url":"http://example.org/x","valueString":"ok"}]}',
    );
    expect(codes(result)).not.toContain("UNHANDLED_MODIFIER_EXTENSION");
  });
});

describe("entered-in-error is surfaced as a retraction (information)", () => {
  it("surfaces a retracted AllergyIntolerance via verificationStatus", () => {
    const result = check(fixture("allergy-entered-in-error.json"));
    const retracted = result.issues.find((i) => i.code === "RETRACTED_RESOURCE");
    expect(retracted?.severity).toBe("information");
    expect(retracted?.expression).toBe("AllergyIntolerance.verificationStatus");
    // Information does not fail validity.
    expect(result.valid).toBe(true);
  });

  it("surfaces a retracted resource via a status primitive", () => {
    const result = check('{"resourceType":"DiagnosticReport","status":"entered-in-error"}');
    const retracted = result.issues.find((i) => i.code === "RETRACTED_RESOURCE");
    expect(retracted?.expression).toBe("DiagnosticReport.status");
  });
});

describe("AllergyIntolerance invariants ait-1 / ait-2", () => {
  it("ait-1: clinicalStatus SHALL be present unless verificationStatus is entered-in-error", () => {
    // No clinicalStatus, not entered-in-error → ait-1 fires (error).
    const bad = check('{"resourceType":"AllergyIntolerance","patient":{"reference":"Patient/1"}}');
    expect(invariant(bad, "ait-1")?.severity).toBe("error");
    expect(bad.valid).toBe(false);

    // clinicalStatus present → ait-1 satisfied.
    const good = check(fixture("allergy-no-known.json"));
    expect(invariant(good, "ait-1")).toBeUndefined();
  });

  it("ait-2: clinicalStatus SHALL NOT be present when verificationStatus is entered-in-error", () => {
    // entered-in-error and NO clinicalStatus → ait-2 satisfied, ait-1 not triggered.
    const ok = check(fixture("allergy-entered-in-error.json"));
    expect(invariant(ok, "ait-2")).toBeUndefined();
    expect(invariant(ok, "ait-1")).toBeUndefined();

    // entered-in-error WITH clinicalStatus → ait-2 fires.
    const bad = check(
      JSON.stringify({
        resourceType: "AllergyIntolerance",
        clinicalStatus: {
          coding: [
            {
              system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical",
              code: "active",
            },
          ],
        },
        verificationStatus: {
          coding: [
            {
              system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",
              code: "entered-in-error",
            },
          ],
        },
      }),
    );
    expect(invariant(bad, "ait-2")?.severity).toBe("error");
  });
});

describe("Condition invariants con-3 / con-4 / con-5", () => {
  it("con-3 (warning): a problem-list-item with no clinicalStatus and not entered-in-error", () => {
    const result = check(fixture("condition-problem-no-status.json"));
    const con3 = invariant(result, "con-3");
    expect(con3?.severity).toBe("warning");
    // A warning never flips validity.
    expect(result.valid).toBe(true);
  });

  it("con-3 does not fire once a clinicalStatus is present", () => {
    const result = check(
      JSON.stringify({
        resourceType: "Condition",
        category: [
          {
            coding: [
              {
                system: "http://terminology.hl7.org/CodeSystem/condition-category",
                code: "problem-list-item",
              },
            ],
          },
        ],
        clinicalStatus: {
          coding: [
            { system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active" },
          ],
        },
      }),
    );
    expect(invariant(result, "con-3")).toBeUndefined();
  });

  it("con-4 (error): an abated condition whose clinicalStatus is not inactive/resolved/remission", () => {
    const bad = check(
      JSON.stringify({
        resourceType: "Condition",
        clinicalStatus: {
          coding: [
            { system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active" },
          ],
        },
        abatementDateTime: "2021-01-01",
      }),
    );
    expect(invariant(bad, "con-4")?.severity).toBe("error");

    const good = check(
      JSON.stringify({
        resourceType: "Condition",
        clinicalStatus: {
          coding: [
            {
              system: "http://terminology.hl7.org/CodeSystem/condition-clinical",
              code: "resolved",
            },
          ],
        },
        abatementDateTime: "2021-01-01",
      }),
    );
    expect(invariant(good, "con-4")).toBeUndefined();
  });

  it("con-5 (error): clinicalStatus SHALL NOT be present when verificationStatus is entered-in-error", () => {
    const bad = check(
      JSON.stringify({
        resourceType: "Condition",
        clinicalStatus: {
          coding: [
            { system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active" },
          ],
        },
        verificationStatus: {
          coding: [
            {
              system: "http://terminology.hl7.org/CodeSystem/condition-ver-status",
              code: "entered-in-error",
            },
          ],
        },
      }),
    );
    expect(invariant(bad, "con-5")?.severity).toBe("error");
  });
});

describe("Observation invariants obs-6 / obs-7", () => {
  it("obs-6 (error): dataAbsentReason present alongside a value[x]", () => {
    const result = check(fixture("observation-dataabsent-and-value.json"));
    expect(invariant(result, "obs-6")?.severity).toBe("error");
    expect(invariant(result, "obs-6")?.expression).toBe("Observation.dataAbsentReason");
    expect(result.valid).toBe(false);
  });

  it("obs-6 does not fire with a value[x] and no dataAbsentReason", () => {
    const result = check(
      '{"resourceType":"Observation","status":"final","valueQuantity":{"value":1}}',
    );
    expect(invariant(result, "obs-6")).toBeUndefined();
  });

  it("obs-7 (error): a component repeats the Observation's own code while value[x] is present", () => {
    const result = check(
      JSON.stringify({
        resourceType: "Observation",
        status: "final",
        code: { coding: [{ system: "http://loinc.org", code: "8480-6" }] },
        valueQuantity: { value: 120 },
        component: [
          {
            code: { coding: [{ system: "http://loinc.org", code: "8480-6" }] },
            valueQuantity: { value: 120 },
          },
        ],
      }),
    );
    expect(invariant(result, "obs-7")?.severity).toBe("error");
  });

  it("obs-7 handles a single-object component and ignores a non-complex component entry", () => {
    // A single (non-array) component object that repeats the Observation code → obs-7 fires.
    const single = check(
      JSON.stringify({
        resourceType: "Observation",
        status: "final",
        code: { coding: [{ system: "http://loinc.org", code: "8480-6" }] },
        valueQuantity: { value: 120 },
        component: {
          code: { coding: [{ system: "http://loinc.org", code: "8480-6" }] },
          valueQuantity: { value: 120 },
        },
      }),
    );
    expect(invariant(single, "obs-7")?.severity).toBe("error");

    // A component list carrying a non-complex entry is simply skipped (no crash, no obs-7).
    const malformed = check(
      JSON.stringify({
        resourceType: "Observation",
        status: "final",
        code: { coding: [{ system: "http://loinc.org", code: "8480-6" }] },
        valueQuantity: { value: 120 },
        component: ["not-an-object"],
      }),
    );
    expect(invariant(malformed, "obs-7")).toBeUndefined();
  });

  it("obs-7 does not fire when the component code differs from the Observation code", () => {
    const result = check(
      JSON.stringify({
        resourceType: "Observation",
        status: "final",
        code: { coding: [{ system: "http://loinc.org", code: "85354-9" }] },
        valueQuantity: { value: 120 },
        component: [
          {
            code: { coding: [{ system: "http://loinc.org", code: "8480-6" }] },
            valueQuantity: { value: 120 },
          },
        ],
      }),
    );
    expect(invariant(result, "obs-7")).toBeUndefined();
  });
});

describe("safety findings reach a value-free OperationOutcome with the constraint key", () => {
  it("renders the invariant key as issue.details.text (a spec id, not a value)", () => {
    const result = check(fixture("observation-dataabsent-and-value.json"));
    const outcome = serializeResource(result.toOperationOutcome());
    expect(outcome).toContain("obs-6");
    expect(outcome).toContain("invariant");
    // No resource value leaks (the value was 7.2 g/dL).
    expect(outcome).not.toContain("7.2");
    expect(outcome).not.toContain("718-7");
  });
});
