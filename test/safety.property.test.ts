import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { parseResource, readSafety, serializeResource, type NegationKind } from "../src/index.js";

/**
 * The property the roadmap names for Phase 3: **a negation never collapses to its positive on a
 * round-trip.** For each FHIR negation mechanism we build the minimal resource that carries it,
 * round-trip it through the codec, and assert the negation is still surfaced afterward, never
 * silently dropped, never flipped to an empty (positive-reading) safety readout.
 */

/** Build the minimal synthetic resource JSON that asserts a given negation. */
function resourceFor(negation: NegationKind): string {
  switch (negation) {
    case "no-known-allergy":
      return JSON.stringify({
        resourceType: "AllergyIntolerance",
        clinicalStatus: {
          coding: [
            {
              system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical",
              code: "active",
            },
          ],
        },
        code: { coding: [{ system: "http://snomed.info/sct", code: "716186003" }] },
      });
    case "refuted":
      return JSON.stringify({
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
            {
              system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",
              code: "refuted",
            },
          ],
        },
      });
    case "entered-in-error":
      return JSON.stringify({
        resourceType: "Observation",
        status: "entered-in-error",
      });
    case "do-not-perform":
      return JSON.stringify({
        resourceType: "MedicationRequest",
        status: "active",
        doNotPerform: true,
      });
    case "not-taken":
      return JSON.stringify({ resourceType: "MedicationStatement", status: "not-taken" });
    case "not-done":
      return JSON.stringify({ resourceType: "Immunization", status: "not-done" });
    default:
      throw new Error(`unhandled negation ${negation as string}`);
  }
}

const NEGATIONS: readonly NegationKind[] = [
  "no-known-allergy",
  "refuted",
  "entered-in-error",
  "do-not-perform",
  "not-taken",
  "not-done",
];

describe("property: a negation survives a round-trip and never collapses to positive", () => {
  it("every negation kind is preserved through parse → serialize → parse", () => {
    fc.assert(
      fc.property(fc.constantFrom(...NEGATIONS), (negation) => {
        const json = resourceFor(negation);
        const before = readSafety(parseResource(json).resource);
        expect(before.negations).toContain(negation);

        const after = readSafety(
          parseResource(serializeResource(parseResource(json).resource)).resource,
        );
        // The negation is still there, and the negation set never shrinks to empty (a positive read).
        expect(after.negations).toContain(negation);
        expect(after.negations.length).toBeGreaterThan(0);
        expect([...after.negations].sort()).toEqual([...before.negations].sort());
      }),
      { numRuns: 60 },
    );
  });
});
