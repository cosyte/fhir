import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  parseResource,
  serializeResource,
  validateResource,
  type ValidationCode,
} from "../src/index.js";

function fixture(name: string): string {
  return readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");
}

function check(json: string): ReturnType<typeof validateResource> {
  return validateResource(parseResource(json).resource);
}

function checkFixture(name: string): ReturnType<typeof validateResource> {
  return check(fixture(name));
}

function codes(result: ReturnType<typeof validateResource>): ValidationCode[] {
  return result.issues.map((i) => i.code);
}

const VITAL_CATEGORY = {
  coding: [
    { system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "vital-signs" },
  ],
};

describe("vital-signs required-unit conformance (compared on the UCUM code, not the unit string)", () => {
  it("passes a blood-pressure panel whose components carry mm[Hg]", () => {
    const result = checkFixture("observation-vitals-bp.json");
    expect(codes(result)).not.toContain("VITAL_SIGN_UNIT_NONCONFORMANT");
    expect(result.valid).toBe(true);
  });

  it("flags a weight in 'lb' (should be [lb_av]) as nonconformant (error)", () => {
    const result = checkFixture("observation-vitals-weight-bad-unit.json");
    const bad = result.issues.find((i) => i.code === "VITAL_SIGN_UNIT_NONCONFORMANT");
    expect(bad?.severity).toBe("error");
    expect(bad?.type).toBe("code-invalid");
    expect(bad?.expression).toBe("Observation.valueQuantity");
    expect(result.valid).toBe(false);
  });

  it("flags a systolic BP component in the wrong unit (per-component code lookup)", () => {
    const result = check(
      JSON.stringify({
        resourceType: "Observation",
        status: "final",
        category: [VITAL_CATEGORY],
        code: { coding: [{ system: "http://loinc.org", code: "85354-9" }] },
        component: [
          {
            code: { coding: [{ system: "http://loinc.org", code: "8480-6" }] },
            valueQuantity: { value: 120, system: "http://unitsofmeasure.org", code: "mmHg" },
          },
        ],
      }),
    );
    const bad = result.issues.find((i) => i.code === "VITAL_SIGN_UNIT_NONCONFORMANT");
    expect(bad?.expression).toBe("Observation.component[0].valueQuantity");
  });

  it("flags a vital sign whose unit uses a non-UCUM system", () => {
    const result = check(
      JSON.stringify({
        resourceType: "Observation",
        status: "final",
        category: [VITAL_CATEGORY],
        code: { coding: [{ system: "http://loinc.org", code: "8867-4" }] },
        valueQuantity: {
          value: 72,
          unit: "/min",
          system: "http://example.org/units",
          code: "/min",
        },
      }),
    );
    expect(codes(result)).toContain("VITAL_SIGN_UNIT_NONCONFORMANT");
  });

  it("warns VALUE_TYPE_UNEXPECTED when a vital sign's value is present but not a Quantity", () => {
    const result = check(
      JSON.stringify({
        resourceType: "Observation",
        status: "final",
        category: [VITAL_CATEGORY],
        code: { coding: [{ system: "http://loinc.org", code: "8867-4" }] },
        valueString: "fast",
      }),
    );
    const warn = result.issues.find((i) => i.code === "VALUE_TYPE_UNEXPECTED");
    expect(warn?.severity).toBe("warning");
    expect(warn?.expression).toBe("Observation.valueString");
    // A warning never flips validity.
    expect(result.valid).toBe(true);
  });

  it("triggers on the vital-signs profile via meta.profile too", () => {
    const result = check(
      JSON.stringify({
        resourceType: "Observation",
        status: "final",
        meta: { profile: ["http://hl7.org/fhir/StructureDefinition/vitalsigns"] },
        code: { coding: [{ system: "http://loinc.org", code: "29463-7" }] },
        valueQuantity: { value: 70, system: "http://unitsofmeasure.org", code: "lb" },
      }),
    );
    expect(codes(result)).toContain("VITAL_SIGN_UNIT_NONCONFORMANT");
  });

  it("does not fire on a vital sign whose value is absent (dataAbsentReason)", () => {
    const result = check(
      JSON.stringify({
        resourceType: "Observation",
        status: "final",
        category: [VITAL_CATEGORY],
        code: { coding: [{ system: "http://loinc.org", code: "8867-4" }] },
        dataAbsentReason: { coding: [{ code: "unknown" }] },
      }),
    );
    expect(codes(result)).not.toContain("VITAL_SIGN_UNIT_NONCONFORMANT");
    expect(codes(result)).not.toContain("VALUE_TYPE_UNEXPECTED");
  });

  it("leaves an unlisted vital-signs LOINC code unchecked (no false error)", () => {
    const result = check(
      JSON.stringify({
        resourceType: "Observation",
        status: "final",
        category: [VITAL_CATEGORY],
        code: { coding: [{ system: "http://loinc.org", code: "99999-9" }] },
        valueQuantity: { value: 1, system: "http://unitsofmeasure.org", code: "somethingodd" },
      }),
    );
    expect(codes(result)).not.toContain("VITAL_SIGN_UNIT_NONCONFORMANT");
    expect(result.valid).toBe(true);
  });
});

describe("UCUM shape — warn on a UCUM-declared unit that is absent or malformed", () => {
  it("warns when a UCUM-system quantity's code is malformed (whitespace)", () => {
    const result = check(
      '{"resourceType":"Observation","status":"final","valueQuantity":{"value":1,"unit":"mm Hg","system":"http://unitsofmeasure.org","code":"mm Hg"}}',
    );
    const warn = result.issues.find((i) => i.code === "UCUM_UNIT_UNRECOGNIZED");
    expect(warn?.severity).toBe("warning");
    expect(warn?.expression).toBe("Observation.valueQuantity.code");
  });

  it("warns when a UCUM-system quantity carries no code at all", () => {
    const result = check(
      '{"resourceType":"Observation","status":"final","valueQuantity":{"value":1,"system":"http://unitsofmeasure.org"}}',
    );
    expect(codes(result)).toContain("UCUM_UNIT_UNRECOGNIZED");
  });

  it("does NOT warn on a quantity that declares no UCUM system (legal FHIR, no false error)", () => {
    const result = check(
      '{"resourceType":"Observation","status":"final","valueQuantity":{"value":1,"unit":"widgets"}}',
    );
    expect(codes(result)).not.toContain("UCUM_UNIT_UNRECOGNIZED");
    expect(result.valid).toBe(true);
  });

  it("does NOT warn on a well-formed UCUM code", () => {
    const result = check(
      '{"resourceType":"Observation","status":"final","valueQuantity":{"value":1,"system":"http://unitsofmeasure.org","code":"10*3/uL"}}',
    );
    expect(codes(result)).not.toContain("UCUM_UNIT_UNRECOGNIZED");
  });

  it("warns on a malformed dose unit in a MedicationRequest", () => {
    const result = check(
      JSON.stringify({
        resourceType: "MedicationRequest",
        status: "active",
        intent: "order",
        dosageInstruction: [
          {
            doseAndRate: [
              {
                doseQuantity: { value: 5, system: "http://unitsofmeasure.org", code: "m g" },
              },
            ],
          },
        ],
      }),
    );
    const warn = result.issues.find((i) => i.code === "UCUM_UNIT_UNRECOGNIZED");
    expect(warn?.expression).toBe(
      "MedicationRequest.dosageInstruction[0].doseAndRate[0].doseQuantity.code",
    );
  });

  it("passes a well-formed MedicationRequest dose unit", () => {
    const result = checkFixture("medicationrequest-dose.json");
    expect(codes(result)).not.toContain("UCUM_UNIT_UNRECOGNIZED");
  });
});

describe("non-vital observations get UCUM shape but no vital-signs checks", () => {
  it("a lab observation with a string value draws neither a vital check nor a UCUM warning", () => {
    const result = check(
      JSON.stringify({
        resourceType: "Observation",
        status: "final",
        category: [
          {
            coding: [
              {
                system: "http://terminology.hl7.org/CodeSystem/observation-category",
                code: "laboratory",
              },
            ],
          },
        ],
        code: { coding: [{ system: "http://loinc.org", code: "5195-3" }] },
        valueString: "Non-reactive",
      }),
    );
    expect(codes(result)).not.toContain("VITAL_SIGN_UNIT_NONCONFORMANT");
    expect(codes(result)).not.toContain("VALUE_TYPE_UNEXPECTED");
    expect(codes(result)).not.toContain("UCUM_UNIT_UNRECOGNIZED");
  });
});

describe("quantity findings reach a value-free OperationOutcome", () => {
  it("emits the nonconformant unit as a coded, PHI-free issue (no value, no unit string)", () => {
    const result = checkFixture("observation-vitals-weight-bad-unit.json");
    const outcome = serializeResource(result.toOperationOutcome());
    // The R4 IssueType and the FHIRPath location are present …
    expect(outcome).toContain("code-invalid");
    expect(outcome).toContain("Observation.valueQuantity");
    // … but the offending unit code and the measured value never leak into the outcome.
    expect(outcome).not.toContain('"70"');
    expect(outcome).not.toContain("pounds");
    expect(outcome).not.toContain('"lb"');
  });
});
