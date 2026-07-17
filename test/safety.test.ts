import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  assertSafeToSummarize,
  FhirSafetyError,
  parseResource,
  readSafety,
  serializeResource,
  type NegationKind,
} from "../src/index.js";

/** Load a synthetic fixture's text. */
function fixture(name: string): string {
  return readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");
}

/** Parse a fixture into a resource model. */
function load(name: string): ReturnType<typeof parseResource>["resource"] {
  return parseResource(fixture(name)).resource;
}

describe("readSafety — surfacing the modifier / status / negation elements", () => {
  it("surfaces 'no known allergy' (SNOMED 716186003) as a first-class negation, not an allergy", () => {
    const safety = readSafety(load("allergy-no-known.json"));
    expect(safety.noKnownAllergy).toBe(true);
    expect(safety.negations).toContain<NegationKind>("no-known-allergy");
    expect(safety.retracted).toBe(false);
    // clinicalStatus is surfaced (present → satisfies ait-1).
    expect(safety.clinicalStatus).toBe("active");
  });

  it("surfaces a refuted allergy", () => {
    const safety = readSafety(load("allergy-refuted.json"));
    expect(safety.verificationStatus).toBe("refuted");
    expect(safety.negations).toContain<NegationKind>("refuted");
  });

  it("never drops 'refuted' when verificationStatus carries more than one coding (any position)", () => {
    // A local/translation coding first, the standard 'refuted' second — normal FHIR, not malformed.
    // Reading only the first coding would silently lose the refutation and read the record positive.
    const condition = readSafety(
      parseResource(
        JSON.stringify({
          resourceType: "Condition",
          clinicalStatus: {
            coding: [
              {
                system: "http://terminology.hl7.org/CodeSystem/condition-clinical",
                code: "active",
              },
            ],
          },
          verificationStatus: {
            coding: [
              { system: "http://example.org/local-verify", code: "local-code" },
              {
                system: "http://terminology.hl7.org/CodeSystem/condition-ver-status",
                code: "refuted",
              },
            ],
          },
        }),
      ).resource,
    );
    expect(condition.negations).toContain<NegationKind>("refuted");
    // The surfaced code prefers the standard system's coding, not the first (local) one.
    expect(condition.verificationStatus).toBe("refuted");

    const allergy = readSafety(
      parseResource(
        JSON.stringify({
          resourceType: "AllergyIntolerance",
          clinicalStatus: {
            coding: [
              {
                system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical",
                code: "inactive",
              },
            ],
          },
          verificationStatus: {
            coding: [
              { system: "http://example.org/local", code: "x" },
              {
                system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",
                code: "refuted",
              },
            ],
          },
        }),
      ).resource,
    );
    expect(allergy.negations).toContain<NegationKind>("refuted");
  });

  it("surfaces entered-in-error as retraction on both a status primitive and a verificationStatus", () => {
    const viaStatus = readSafety(load("observation-dataabsent-and-value.json"));
    expect(viaStatus.retracted).toBe(false); // status is 'final'

    const viaVerification = readSafety(load("allergy-entered-in-error.json"));
    expect(viaVerification.retracted).toBe(true);
    expect(viaVerification.negations).toContain<NegationKind>("entered-in-error");

    const eieStatus = readSafety(
      parseResource('{"resourceType":"DiagnosticReport","status":"entered-in-error"}').resource,
    );
    expect(eieStatus.retracted).toBe(true);
  });

  it("surfaces MedicationRequest.doNotPerform = true as a do-not-perform negation", () => {
    const safety = readSafety(load("medicationrequest-donotperform.json"));
    expect(safety.doNotPerform).toBe(true);
    expect(safety.negations).toContain<NegationKind>("do-not-perform");
  });

  it("surfaces MedicationStatement not-taken and Immunization not-done as negations", () => {
    expect(
      readSafety(load("medicationstatement-not-taken.json")).negations,
    ).toContain<NegationKind>("not-taken");
    expect(readSafety(load("immunization-not-done.json")).negations).toContain<NegationKind>(
      "not-done",
    );
  });

  it("does not read not-taken / not-done on the wrong resource type", () => {
    // A completed Observation whose status happens to be a non-negation value carries no negation.
    const obs = readSafety(load("observation-dataabsent-and-value.json"));
    expect(obs.negations).toEqual([]);
    // 'not-taken' only counts on MedicationStatement, 'not-done' only on Immunization.
    const notARealNegation = readSafety(
      parseResource('{"resourceType":"Observation","status":"not-done"}').resource,
    );
    expect(notARealNegation.negations).toEqual([]);
  });

  it("leaves modifier slots undefined for a non-safety resource type", () => {
    const safety = readSafety(parseResource('{"resourceType":"Patient","active":true}').resource);
    expect(safety.resourceType).toBe("Patient");
    expect(safety.status).toBeUndefined();
    expect(safety.clinicalStatus).toBeUndefined();
    expect(safety.negations).toEqual([]);
    expect(safety.safeToSummarize).toBe(true);
  });
});

describe("readSafety — carries status or refuses (the fail-closed contract)", () => {
  it("flags an unhandled modifierExtension and marks the resource unsafe to summarize", () => {
    const safety = readSafety(load("unknown-modifier.json"));
    expect(safety.safeToSummarize).toBe(false);
    expect(safety.unhandledModifierExtensions).toEqual(["Observation.modifierExtension[0]"]);
  });

  it("assertSafeToSummarize refuses (throws) on an unhandled modifierExtension — value-free", () => {
    const resource = load("unknown-modifier.json");
    let error: FhirSafetyError | undefined;
    try {
      assertSafeToSummarize(resource);
    } catch (err) {
      error = err as FhirSafetyError;
    }
    expect(error).toBeInstanceOf(FhirSafetyError);
    expect(error?.locations).toEqual(["Observation.modifierExtension[0]"]);
    // The refusal names locations only — never a resource value.
    expect(error?.message).not.toContain("7.2");
    expect(error?.message).not.toContain("718-7");
  });

  it("assertSafeToSummarize passes when there is no unhandled modifier, and accepts a readout", () => {
    const resource = load("allergy-no-known.json");
    expect(() => assertSafeToSummarize(resource)).not.toThrow();
    expect(() => assertSafeToSummarize(readSafety(resource))).not.toThrow();
  });

  it("detects a modifierExtension nested inside a backbone element / contained resource", () => {
    const nested = parseResource(
      JSON.stringify({
        resourceType: "Observation",
        status: "final",
        component: [
          {
            code: { coding: [{ system: "http://loinc.org", code: "1" }] },
            modifierExtension: [{ url: "http://example.org/made-up" }],
          },
        ],
      }),
    ).resource;
    const safety = readSafety(nested);
    expect(safety.safeToSummarize).toBe(false);
    expect(safety.unhandledModifierExtensions).toEqual([
      "Observation.component[0].modifierExtension[0]",
    ]);
  });

  it("treats a plain (non-modifier) extension as safe — only modifierExtension fails closed", () => {
    const withExtension = parseResource(
      JSON.stringify({
        resourceType: "Condition",
        clinicalStatus: { coding: [] },
        extension: [{ url: "http://example.org/anything", valueString: "ok" }],
      }),
    ).resource;
    expect(readSafety(withExtension).safeToSummarize).toBe(true);
  });
});

describe("readSafety — edge cases", () => {
  it("leaves doNotPerform undefined for a MedicationRequest that omits it", () => {
    const safety = readSafety(
      parseResource('{"resourceType":"MedicationRequest","status":"active","intent":"order"}')
        .resource,
    );
    expect(safety.doNotPerform).toBeUndefined();
    expect(safety.negations).toEqual([]);
  });

  it("handles a resource with no resourceType (path falls back to $this)", () => {
    const safety = readSafety(
      parseResource('{"id":"x","modifierExtension":[{"url":"http://example.org/x"}]}').resource,
    );
    expect(safety.resourceType).toBeUndefined();
    expect(safety.unhandledModifierExtensions).toEqual(["$this.modifierExtension[0]"]);
  });

  it("flags a single-object (non-array) modifierExtension and one with no url", () => {
    const singleObject = readSafety(
      parseResource('{"resourceType":"Patient","modifierExtension":{"url":"http://example.org/x"}}')
        .resource,
    );
    expect(singleObject.unhandledModifierExtensions).toEqual(["Patient.modifierExtension"]);

    const noUrl = readSafety(
      parseResource('{"resourceType":"Patient","modifierExtension":[{"valueBoolean":true}]}')
        .resource,
    );
    expect(noUrl.unhandledModifierExtensions).toEqual(["Patient.modifierExtension[0]"]);
  });
});

describe("negation never collapses to positive across a round-trip", () => {
  const cases: readonly { readonly file: string; readonly negation: NegationKind }[] = [
    { file: "allergy-no-known.json", negation: "no-known-allergy" },
    { file: "allergy-refuted.json", negation: "refuted" },
    { file: "allergy-entered-in-error.json", negation: "entered-in-error" },
    { file: "medicationrequest-donotperform.json", negation: "do-not-perform" },
    { file: "medicationstatement-not-taken.json", negation: "not-taken" },
    { file: "immunization-not-done.json", negation: "not-done" },
  ];

  for (const { file, negation } of cases) {
    it(`preserves ${negation} through parse → serialize → parse`, () => {
      const before = readSafety(load(file));
      expect(before.negations).toContain(negation);
      const roundTripped = readSafety(parseResource(serializeResource(load(file))).resource);
      expect(roundTripped.negations).toContain(negation);
      // The negation set is identical — nothing added, nothing dropped.
      expect([...roundTripped.negations].sort()).toEqual([...before.negations].sort());
    });
  }
});
