import { describe, expect, it } from "vitest";

import {
  buildBindingRegistry,
  isKnownSystem,
  ALLERGY_SUBSTANCE_VALUESET,
  BINDING_STRENGTHS,
  CPT_SYSTEM,
  CVX_SYSTEM,
  ICD9CM_SYSTEM,
  ICD10CM_SYSTEM,
  KNOWN_SYSTEMS,
  LOINC_SYSTEM,
  MEDICATION_VALUESET,
  NDC_SYSTEM,
  RXNORM_SYSTEM,
  SNOMED_SCT,
  TERMINOLOGY_BINDINGS,
  UCUM_SYSTEM,
  type CodeValidationRequest,
  type TerminologyService,
} from "../src/index.js";

/**
 * The known-systems registry is a **frozen set of identities** (roadmap §5) — verified URIs only, no
 * content. These pin which systems are recognized and confirm the open-question ones (ICD-10-PCS,
 * HCPCS — roadmap §10) are deliberately absent rather than guessed.
 */
describe("known-systems registry (identities only, verified URIs)", () => {
  it("recognizes every roadmap §5 verified system URI", () => {
    for (const uri of [
      LOINC_SYSTEM,
      SNOMED_SCT,
      RXNORM_SYSTEM,
      ICD10CM_SYSTEM,
      ICD9CM_SYSTEM,
      CPT_SYSTEM,
      UCUM_SYSTEM,
      NDC_SYSTEM,
      CVX_SYSTEM,
    ]) {
      expect(isKnownSystem(uri)).toBe(true);
      expect(KNOWN_SYSTEMS.has(uri)).toBe(true);
    }
  });

  it("pins the exact system URIs (a change is a public-contract change)", () => {
    expect(RXNORM_SYSTEM).toBe("http://www.nlm.nih.gov/research/umls/rxnorm");
    expect(ICD10CM_SYSTEM).toBe("http://hl7.org/fhir/sid/icd-10-cm");
    expect(CVX_SYSTEM).toBe("http://hl7.org/fhir/sid/cvx");
    expect(NDC_SYSTEM).toBe("http://hl7.org/fhir/sid/ndc");
  });

  it("does NOT guess the open-question URIs (ICD-10-PCS, HCPCS — roadmap §10)", () => {
    // Absence reads as 'unknown' — a safe non-erroring degrade, never a false identity.
    expect(isKnownSystem("http://hl7.org/fhir/sid/icd-10-pcs")).toBe(false);
    expect(isKnownSystem("urn:oid:2.16.840.1.113883.6.285")).toBe(false); // HCPCS OID
  });

  it("treats an unrecognized (local/proprietary) system as unknown, not invalid", () => {
    expect(isKnownSystem("http://example.org/local-codes")).toBe(false);
  });
});

/** The binding registry — the roadmap-named multi-system elements, plus caller overrides. */
describe("terminology bindings (identities + strength, extensible built-ins)", () => {
  it("binds AllergyIntolerance.code extensibly to the multi-system substance value set", () => {
    const binding = buildBindingRegistry()("AllergyIntolerance.code");
    expect(binding?.strength).toBe("extensible");
    expect(binding?.valueSet).toBe(ALLERGY_SUBSTANCE_VALUESET);
    // The roadmap §4.3 multi-system requirement: RxNorm (drug) + SNOMED (food/env + negations).
    expect(binding?.systems).toEqual([RXNORM_SYSTEM, SNOMED_SCT]);
  });

  it("binds both medication resource variants extensibly to the RxNorm value set", () => {
    const registry = buildBindingRegistry();
    for (const path of [
      "MedicationRequest.medicationCodeableConcept",
      "MedicationStatement.medicationCodeableConcept",
    ]) {
      const binding = registry(path);
      expect(binding?.strength).toBe("extensible");
      expect(binding?.valueSet).toBe(MEDICATION_VALUESET);
      expect(binding?.systems).toEqual([RXNORM_SYSTEM]);
    }
  });

  it("returns undefined for an element with no registered binding", () => {
    expect(buildBindingRegistry()("Patient.gender")).toBeUndefined();
  });

  it("lets a caller add and override bindings by path", () => {
    const registry = buildBindingRegistry([
      { path: "Observation.method", valueSet: "http://x/vs", strength: "example" },
      {
        path: "AllergyIntolerance.code",
        valueSet: "http://x/override",
        strength: "required",
        systems: [SNOMED_SCT],
      },
    ]);
    expect(registry("Observation.method")?.strength).toBe("example");
    expect(registry("AllergyIntolerance.code")?.strength).toBe("required");
    expect(registry("AllergyIntolerance.code")?.valueSet).toBe("http://x/override");
  });

  it("pins the strength ladder and the built-in binding count", () => {
    expect(BINDING_STRENGTHS).toEqual(["required", "extensible", "preferred", "example"]);
    expect(TERMINOLOGY_BINDINGS).toHaveLength(3);
  });
});

/**
 * The terminology-service interface is the one content seam; the library bundles none. A conformant
 * implementation is value-free (identities only) and can always answer "unknown".
 */
describe("terminology-service interface (pluggable, none bundled)", () => {
  it("is satisfiable by a small fail-safe stub that receives only identities", () => {
    const seen: CodeValidationRequest[] = [];
    const service: TerminologyService = {
      validateCode(request) {
        seen.push(request);
        if (request.valueSet !== MEDICATION_VALUESET) return { membership: "unknown" };
        return { membership: request.code === "1049502" ? "in" : "not-in" };
      },
    };
    expect(
      service.validateCode({
        valueSet: MEDICATION_VALUESET,
        system: RXNORM_SYSTEM,
        code: "1049502",
      }),
    ).toEqual({ membership: "in" });
    expect(
      service.validateCode({ valueSet: "http://other", system: RXNORM_SYSTEM, code: "x" }),
    ).toEqual({ membership: "unknown" });
    // The request carries only identities — never a resource or a patient value.
    expect(Object.keys(seen[0] ?? {}).sort()).toEqual(["code", "system", "valueSet"]);
  });
});
