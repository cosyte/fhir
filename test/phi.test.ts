import { describe, expect, it } from "vitest";

import { FhirCodecError, parseResource } from "../src/index.js";
import { nth } from "./_util.js";

/**
 * PHI posture (roadmap §7): a FHIR resource is PHI by default and the codec's own diagnostics are
 * the leak vector. Every issue and every error the reader produces must be **value-free** — a coded
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
