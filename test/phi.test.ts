import { describe, expect, it } from "vitest";

import {
  FhirCodecError,
  parseResource,
  serializeResource,
  validateResource,
} from "../src/index.js";
import { nth } from "./_util.js";

/**
 * PHI posture (roadmap §7): a FHIR resource is PHI by default and the codec's own diagnostics are
 * the leak vector. Every issue and every error the reader produces must be **value-free**, a coded
 * reason plus a FHIRPath location or a byte offset, never the offending value. These synthetic
 * "PHI-like" markers must appear nowhere in any emitted diagnostic.
 */
const SYNTHETIC_MARKERS = ["Chalmers", "1974-12-25", "555-0100", "99999999"] as const;

describe("no PHI in diagnostics", () => {
  it("keeps decimal-precision issues value-free (location only, not the number)", () => {
    const { issues } = parseResource(
      '{"resourceType":"Observation","valueQuantity":{"value":99999999.010}}',
    );
    const serialized = JSON.stringify(issues);
    expect(serialized).not.toContain("99999999");
    // It still points at where, via a FHIRPath expression.
    expect(nth(issues, 0).expression).toBe("Observation.valueQuantity.value");
  });

  it("keeps a misalignment error value-free", () => {
    let error: FhirCodecError | undefined;
    try {
      parseResource(
        '{"resourceType":"Patient","name":[{"family":"Chalmers"}],"given":["Peter","James"],"_given":[null]}',
      );
    } catch (err) {
      error = err as FhirCodecError;
    }
    expect(error).toBeInstanceOf(FhirCodecError);
    for (const marker of SYNTHETIC_MARKERS) {
      expect(error?.message).not.toContain(marker);
      expect(error?.expression ?? "").not.toContain(marker);
    }
  });

  it("keeps a malformed-JSON error to an offset, with no data snippet", () => {
    let error: FhirCodecError | undefined;
    try {
      // A truncated resource whose visible bytes include a synthetic name.
      parseResource('{"resourceType":"Patient","family":"Chalmers"');
    } catch (err) {
      error = err as FhirCodecError;
    }
    expect(error).toBeInstanceOf(FhirCodecError);
    expect(error?.message).not.toContain("Chalmers");
    expect(typeof error?.offset).toBe("number");
  });

  it("never leaks values through issue expressions on a well-formed but quirky resource", () => {
    const { issues } = parseResource(
      '{"resourceType":"Patient","phone":"555-0100","_phone":{"unexpected":"555-0100"}}',
    );
    const serialized = JSON.stringify(issues);
    expect(serialized).not.toContain("555-0100");
  });
});

/**
 * The redaction chokepoint lands in Phase 2: a validation `OperationOutcome` must carry the location
 * and the coded reason, never the offending value. Sweep the whole outcome, issues object and the
 * serialized resource, for the synthetic markers that triggered each finding.
 */
describe("no PHI in validation output (the Phase-2 redaction chokepoint)", () => {
  it("keeps a bad-code finding value-free (the offending code never reaches diagnostics)", () => {
    const { resource } = parseResource('{"resourceType":"Patient","gender":"99999999"}');
    const result = validateResource(resource);
    const outcomeJson = serializeResource(result.toOperationOutcome());
    expect(JSON.stringify(result.issues)).not.toContain("99999999");
    expect(outcomeJson).not.toContain("99999999");
    // It still points at where, via a FHIRPath expression.
    expect(nth(result.issues, 0).expression).toBe("Patient.gender");
  });

  it("keeps a malformed primitive finding to a location, not the value", () => {
    const { resource } = parseResource(
      '{"resourceType":"Patient","birthDate":"1974-12-25-BADXYZ"}',
    );
    const result = validateResource(resource);
    const outcomeJson = serializeResource(result.toOperationOutcome());
    for (const marker of SYNTHETIC_MARKERS) {
      expect(JSON.stringify(result.issues)).not.toContain(marker);
      expect(outcomeJson).not.toContain(marker);
    }
    expect(nth(result.issues, 0).expression).toBe("Patient.birthDate");
  });

  it("keeps safety findings (modifier / invariant) value-free: only the constraint key surfaces", () => {
    // A retracted Observation with an unknown modifierExtension and a value: several safety findings,
    // all of which must carry only locations + coded reasons, never the synthetic marker values.
    const { resource } = parseResource(
      '{"resourceType":"Observation","status":"final",' +
        '"code":{"coding":[{"system":"http://loinc.org","code":"718-7"}]},' +
        '"dataAbsentReason":{"coding":[{"code":"unknown"}]},' +
        '"valueQuantity":{"value":99999999.010,"unit":"555-0100"},' +
        '"modifierExtension":[{"url":"http://example.org/99999999"}]}',
    );
    const result = validateResource(resource);
    const outcomeJson = serializeResource(result.toOperationOutcome());
    const issuesJson = JSON.stringify(result.issues);
    for (const marker of SYNTHETIC_MARKERS) {
      expect(issuesJson).not.toContain(marker);
      expect(outcomeJson).not.toContain(marker);
    }
    // The invariant key IS surfaced (a public spec identifier, not PHI).
    expect(outcomeJson).toContain("obs-6");
  });

  it("keeps a terminology finding value-free: the offending code never reaches diagnostics", () => {
    // A bound medication coding a service reports is not a member; the code value is the marker.
    const service = {
      validateCode: () => ({ membership: "not-in" as const }),
    };
    const { resource } = parseResource(
      '{"resourceType":"MedicationRequest","status":"active","intent":"order",' +
        '"medicationCodeableConcept":{"coding":[{"system":"http://www.nlm.nih.gov/research/umls/rxnorm","code":"99999999"}]}}',
    );
    const result = validateResource(resource, { terminology: service });
    const outcomeJson = serializeResource(result.toOperationOutcome());
    expect(JSON.stringify(result.issues)).not.toContain("99999999");
    expect(outcomeJson).not.toContain("99999999");
    const finding = result.issues.find((i) => i.code === "CODE_NOT_IN_VALUESET");
    expect(finding?.expression).toContain("MedicationRequest.medicationCodeableConcept.coding");
  });
});
