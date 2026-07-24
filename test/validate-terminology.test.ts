import { describe, expect, it } from "vitest";

import {
  parseResource,
  serializeResource,
  validateResource,
  ICD10CM_SYSTEM,
  MEDICATION_VALUESET,
  RXNORM_SYSTEM,
  SNOMED_SCT,
  type TerminologyBinding,
  type TerminologyService,
  type ValidationCode,
} from "../src/index.js";

function check(json: string, options?: Parameters<typeof validateResource>[1]) {
  return validateResource(parseResource(json).resource, options);
}
function codes(result: ReturnType<typeof validateResource>): ValidationCode[] {
  return result.issues.map((i) => i.code);
}

/** A stub terminology service that answers only for the value sets it is told about. */
function stubService(map: Record<string, "in" | "not-in" | "unknown">): TerminologyService {
  return {
    validateCode({ code }) {
      return { membership: map[code ?? ""] ?? "unknown" };
    },
  };
}

describe("content-free system checks (no terminology service needed)", () => {
  it("passes a SNOMED-coded allergy substance (an expected system for the extensible binding)", () => {
    const result = check(
      '{"resourceType":"AllergyIntolerance","clinicalStatus":{"coding":[{"system":"http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical","code":"active"}]},' +
        '"code":{"coding":[{"system":"http://snomed.info/sct","code":"227493005"}]}}',
    );
    expect(codes(result)).not.toContain("CODE_SYSTEM_UNEXPECTED");
    expect(codes(result)).not.toContain("CODE_SYSTEM_UNKNOWN");
    expect(result.valid).toBe(true);
  });

  it("passes an RxNorm-coded allergy substance (the other expected system: multi-system accepted)", () => {
    const result = check(
      '{"resourceType":"AllergyIntolerance","clinicalStatus":{"coding":[{"system":"http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical","code":"active"}]},' +
        '"code":{"coding":[{"system":"http://www.nlm.nih.gov/research/umls/rxnorm","code":"7980"}]}}',
    );
    expect(codes(result)).not.toContain("CODE_SYSTEM_UNEXPECTED");
    expect(result.valid).toBe(true);
  });

  it("accepts BOTH systems present at once on the one element (RxNorm + SNOMED)", () => {
    const result = check(
      '{"resourceType":"AllergyIntolerance","clinicalStatus":{"coding":[{"system":"http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical","code":"active"}]},' +
        '"code":{"coding":[{"system":"http://www.nlm.nih.gov/research/umls/rxnorm","code":"7980"},' +
        '{"system":"http://snomed.info/sct","code":"7336002"}]}}',
    );
    expect(codes(result)).not.toContain("CODE_SYSTEM_UNEXPECTED");
    expect(codes(result)).not.toContain("CODE_SYSTEM_UNKNOWN");
  });

  it("warns (not errors) on a KNOWN but unexpected system for an extensible binding", () => {
    const result = check(
      '{"resourceType":"AllergyIntolerance","clinicalStatus":{"coding":[{"system":"http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical","code":"active"}]},' +
        `"code":{"coding":[{"system":"${ICD10CM_SYSTEM}","code":"T78.40XA"}]}}`,
    );
    const finding = result.issues.find((i) => i.code === "CODE_SYSTEM_UNEXPECTED");
    expect(finding?.severity).toBe("warning");
    expect(finding?.type).toBe("code-invalid");
    expect(finding?.expression).toBe("AllergyIntolerance.code.coding[0].system");
    // A warning never flips validity, an extensible binding may use another system if justified.
    expect(result.valid).toBe(true);
  });

  it("notes (information) an UNKNOWN system: a local system is not a defect", () => {
    const result = check(
      '{"resourceType":"MedicationRequest","status":"active","intent":"order",' +
        '"medicationCodeableConcept":{"coding":[{"system":"http://example.org/local-drugs","code":"XYZ"}]}}',
    );
    const finding = result.issues.find((i) => i.code === "CODE_SYSTEM_UNKNOWN");
    expect(finding?.severity).toBe("information");
    expect(finding?.expression).toBe(
      "MedicationRequest.medicationCodeableConcept.coding[0].system",
    );
    expect(result.valid).toBe(true);
  });

  it("emits no terminology finding for a systemless coding", () => {
    const result = check(
      '{"resourceType":"MedicationRequest","status":"active","intent":"order",' +
        '"medicationCodeableConcept":{"coding":[{"code":"7980"}]}}',
    );
    expect(codes(result)).not.toContain("CODE_SYSTEM_UNKNOWN");
    expect(codes(result)).not.toContain("CODE_SYSTEM_UNEXPECTED");
    expect(codes(result)).not.toContain("CODE_NOT_IN_VALUESET");
  });

  it("walks a list-valued bound element (a repeating CodeableConcept), locating each coding", () => {
    const bindings: TerminologyBinding[] = [
      {
        path: "Observation.category",
        valueSet: "http://x/vs",
        strength: "extensible",
        systems: [SNOMED_SCT],
      },
    ];
    const result = check(
      '{"resourceType":"Observation","status":"final",' +
        `"category":[{"coding":[{"system":"${ICD10CM_SYSTEM}","code":"Z00"}]}]}`,
      { bindings },
    );
    const finding = result.issues.find((i) => i.code === "CODE_SYSTEM_UNEXPECTED");
    expect(finding?.expression).toBe("Observation.category[0].coding[0].system");
    expect(finding?.severity).toBe("warning");
  });

  it("notes an unknown system under a binding that declares no system allow-list", () => {
    const bindings: TerminologyBinding[] = [
      { path: "Observation.method", valueSet: "http://x/vs", strength: "preferred" },
    ];
    const result = check(
      '{"resourceType":"Observation","status":"final",' +
        '"method":{"coding":[{"system":"http://example.org/local","code":"m1"}]}}',
      { bindings },
    );
    expect(codes(result)).toContain("CODE_SYSTEM_UNKNOWN");
    expect(result.valid).toBe(true);
  });

  it("errors on a wrong known system for a REQUIRED binding (content-free certainty)", () => {
    // A required binding whose value set draws only from SNOMED: an RxNorm code is definitively out.
    const bindings: TerminologyBinding[] = [
      {
        path: "Condition.code",
        valueSet: "http://example.org/vs/snomed-problems",
        strength: "required",
        systems: [SNOMED_SCT],
      },
    ];
    const result = check(
      '{"resourceType":"Condition","clinicalStatus":{"coding":[{"system":"http://terminology.hl7.org/CodeSystem/condition-clinical","code":"active"}]},' +
        `"code":{"coding":[{"system":"${RXNORM_SYSTEM}","code":"7980"}]}}`,
      { bindings },
    );
    const finding = result.issues.find((i) => i.code === "CODE_SYSTEM_UNEXPECTED");
    expect(finding?.severity).toBe("error");
    expect(result.valid).toBe(false);
  });
});

describe("fail-safe: no terminology service → never a false membership error", () => {
  it("does NOT emit CODE_NOT_IN_VALUESET for an expected-system code with no service", () => {
    // RxNorm system is expected; without a service we cannot (and must not) judge membership.
    const result = check(
      '{"resourceType":"MedicationRequest","status":"active","intent":"order",' +
        '"medicationCodeableConcept":{"coding":[{"system":"http://www.nlm.nih.gov/research/umls/rxnorm","code":"not-a-real-code"}]}}',
    );
    expect(codes(result)).not.toContain("CODE_NOT_IN_VALUESET");
    expect(result.valid).toBe(true);
  });
});

describe("membership checks (terminology service supplied)", () => {
  const service = stubService({ "1049502": "in", "0000000": "not-in", "9999999": "unknown" });

  it("errors on an extensible not-in verdict from the service", () => {
    const result = check(
      '{"resourceType":"MedicationRequest","status":"active","intent":"order",' +
        '"medicationCodeableConcept":{"coding":[{"system":"http://www.nlm.nih.gov/research/umls/rxnorm","code":"0000000"}]}}',
      { terminology: service },
    );
    const finding = result.issues.find((i) => i.code === "CODE_NOT_IN_VALUESET");
    expect(finding?.severity).toBe("error");
    expect(finding?.expression).toBe("MedicationRequest.medicationCodeableConcept.coding[0]");
    expect(result.valid).toBe(false);
  });

  it("passes an in-set verdict cleanly", () => {
    const result = check(
      '{"resourceType":"MedicationRequest","status":"active","intent":"order",' +
        '"medicationCodeableConcept":{"coding":[{"system":"http://www.nlm.nih.gov/research/umls/rxnorm","code":"1049502"}]}}',
      { terminology: service },
    );
    expect(codes(result)).not.toContain("CODE_NOT_IN_VALUESET");
    expect(result.valid).toBe(true);
  });

  it("degrades on an 'unknown' service answer: no finding (never guess)", () => {
    const result = check(
      '{"resourceType":"MedicationRequest","status":"active","intent":"order",' +
        '"medicationCodeableConcept":{"coding":[{"system":"http://www.nlm.nih.gov/research/umls/rxnorm","code":"9999999"}]}}',
      { terminology: service },
    );
    expect(codes(result)).not.toContain("CODE_NOT_IN_VALUESET");
    expect(result.valid).toBe(true);
  });

  it("passes the value-set identity to the service, never a resource value", () => {
    const seen: string[] = [];
    const spy: TerminologyService = {
      validateCode(req) {
        seen.push(req.valueSet);
        return { membership: "unknown" };
      },
    };
    check(
      '{"resourceType":"MedicationRequest","status":"active","intent":"order",' +
        '"medicationCodeableConcept":{"coding":[{"system":"http://www.nlm.nih.gov/research/umls/rxnorm","code":"1049502"}]}}',
      { terminology: spy },
    );
    expect(seen).toEqual([MEDICATION_VALUESET]);
  });
});

describe("binding-strength severity ladder (required→error, extensible→error, preferred→warn, example→info)", () => {
  const notInService = stubService({ BAD: "not-in" });

  function ladder(strength: TerminologyBinding["strength"]) {
    const bindings: TerminologyBinding[] = [
      { path: "Observation.method", valueSet: "http://x/vs", strength, systems: [SNOMED_SCT] },
    ];
    return check(
      '{"resourceType":"Observation","status":"final",' +
        '"code":{"coding":[{"system":"http://loinc.org","code":"718-7"}]},' +
        '"method":{"coding":[{"system":"http://snomed.info/sct","code":"BAD"}]}}',
      { bindings, terminology: notInService },
    );
  }

  it("required not-in → error", () => {
    const r = ladder("required");
    expect(r.issues.find((i) => i.code === "CODE_NOT_IN_VALUESET")?.severity).toBe("error");
    expect(r.valid).toBe(false);
  });

  it("extensible not-in → error (error-unless-justified)", () => {
    const r = ladder("extensible");
    expect(r.issues.find((i) => i.code === "CODE_NOT_IN_VALUESET")?.severity).toBe("error");
    expect(r.valid).toBe(false);
  });

  it("preferred not-in → warning (never flips validity)", () => {
    const r = ladder("preferred");
    expect(r.issues.find((i) => i.code === "CODE_NOT_IN_VALUESET")?.severity).toBe("warning");
    expect(r.valid).toBe(true);
  });

  it("example not-in → information, NEVER an error (rebinding an example code cannot fail)", () => {
    const r = ladder("example");
    expect(r.issues.find((i) => i.code === "CODE_NOT_IN_VALUESET")?.severity).toBe("information");
    expect(r.valid).toBe(true);
  });

  it("example with a wrong system → no finding at all (illustrative only)", () => {
    const bindings: TerminologyBinding[] = [
      {
        path: "Observation.method",
        valueSet: "http://x/vs",
        strength: "example",
        systems: [SNOMED_SCT],
      },
    ];
    const r = check(
      '{"resourceType":"Observation","status":"final",' +
        `"method":{"coding":[{"system":"${ICD10CM_SYSTEM}","code":"Z00"}]}}`,
      { bindings },
    );
    expect(codes(r)).not.toContain("CODE_SYSTEM_UNEXPECTED");
    expect(r.valid).toBe(true);
  });
});

describe("terminology findings reach a value-free OperationOutcome", () => {
  it("never leaks the offending code into the outcome (only location + coded reason)", () => {
    const service = stubService({ "99999999": "not-in" });
    const result = check(
      '{"resourceType":"MedicationRequest","status":"active","intent":"order",' +
        '"medicationCodeableConcept":{"coding":[{"system":"http://www.nlm.nih.gov/research/umls/rxnorm","code":"99999999"}]}}',
      { terminology: service },
    );
    const outcome = serializeResource(result.toOperationOutcome());
    expect(outcome).toContain("code-invalid");
    expect(outcome).toContain("MedicationRequest.medicationCodeableConcept.coding[0]");
    expect(outcome).not.toContain("99999999");
    expect(JSON.stringify(result.issues)).not.toContain("99999999");
  });
});
