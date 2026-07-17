import { describe, expect, it } from "vitest";

import {
  DISCRIMINATOR_TYPES,
  UNBOUNDED,
  isPrimitive,
  loadStructureDefinition,
  parseResource,
} from "../src/index.js";
import { req } from "./_util.js";

/** Load a StructureDefinition from a plain object literal (round-tripped through the codec). */
function loadSd(obj: unknown) {
  return loadStructureDefinition(parseResource(JSON.stringify(obj)).resource);
}

describe("loadStructureDefinition", () => {
  it("reads identity, derivation, and element lists", () => {
    const sd = req(
      loadSd({
        resourceType: "StructureDefinition",
        url: "http://example.org/StructureDefinition/us-core-allergy",
        version: "6.1.0",
        name: "USCoreAllergy",
        type: "AllergyIntolerance",
        kind: "resource",
        derivation: "constraint",
        baseDefinition: "http://hl7.org/fhir/StructureDefinition/AllergyIntolerance",
        differential: {
          element: [
            {
              id: "AllergyIntolerance.clinicalStatus",
              path: "AllergyIntolerance.clinicalStatus",
              min: 1,
              max: "1",
              mustSupport: true,
            },
          ],
        },
      }),
    );
    expect(sd.url).toBe("http://example.org/StructureDefinition/us-core-allergy");
    expect(sd.version).toBe("6.1.0");
    expect(sd.name).toBe("USCoreAllergy");
    expect(sd.type).toBe("AllergyIntolerance");
    expect(sd.kind).toBe("resource");
    expect(sd.derivation).toBe("constraint");
    expect(sd.baseDefinition).toContain("AllergyIntolerance");
    const el = req(sd.differential?.[0]);
    expect(el).toMatchObject({ min: 1, max: 1, mustSupport: true });
  });

  it("parses max '*' to UNBOUNDED and numeric max to a number", () => {
    const sd = req(
      loadSd({
        resourceType: "StructureDefinition",
        url: "http://x",
        type: "Observation",
        snapshot: {
          element: [
            { id: "Observation.category", path: "Observation.category", min: 0, max: "*" },
            { id: "Observation.status", path: "Observation.status", min: 1, max: "1" },
          ],
        },
      }),
    );
    expect(req(sd.snapshot?.[0]).max).toBe(UNBOUNDED);
    expect(req(sd.snapshot?.[1]).max).toBe(1);
  });

  it("reads slicing (discriminator + rules), types, binding, and fixed/pattern", () => {
    const sd = req(
      loadSd({
        resourceType: "StructureDefinition",
        url: "http://x",
        type: "Observation",
        differential: {
          element: [
            {
              id: "Observation.category",
              path: "Observation.category",
              slicing: {
                discriminator: [{ type: "pattern", path: "$this" }],
                rules: "open",
                ordered: false,
              },
              binding: { strength: "extensible", valueSet: "http://vs" },
              type: [{ code: "CodeableConcept" }],
            },
            {
              id: "Observation.category:VSCat",
              path: "Observation.category",
              sliceName: "VSCat",
              patternCodeableConcept: { coding: [{ system: "http://s", code: "vital-signs" }] },
            },
            {
              id: "Observation.status",
              path: "Observation.status",
              fixedCode: "final",
            },
          ],
        },
      }),
    );
    const category = req(sd.differential?.[0]);
    expect(req(category.slicing).discriminator[0]).toEqual({ type: "pattern", path: "$this" });
    expect(req(category.slicing).rules).toBe("open");
    expect(req(category.slicing).ordered).toBe(false);
    expect(category.binding).toEqual({ strength: "extensible", valueSet: "http://vs" });
    expect(req(category.type)[0]?.code).toBe("CodeableConcept");

    const slice = req(sd.differential?.[1]);
    expect(slice.sliceName).toBe("VSCat");
    expect(req(slice.pattern).type).toBe("CodeableConcept");

    const status = req(sd.differential?.[2]);
    const fixed = req(status.fixed);
    expect(fixed.type).toBe("Code");
    expect(isPrimitive(fixed.value) && fixed.value.value).toBe("final");
  });

  it("derives a sliceName from the element id when sliceName is absent", () => {
    const sd = req(
      loadSd({
        resourceType: "StructureDefinition",
        url: "http://x",
        type: "Observation",
        differential: {
          element: [{ id: "Observation.category:VSCat", path: "Observation.category" }],
        },
      }),
    );
    expect(req(sd.differential?.[0]).sliceName).toBe("VSCat");
  });

  it("defaults slicing rules to open and drops an unknown rules value", () => {
    const sd = req(
      loadSd({
        resourceType: "StructureDefinition",
        url: "http://x",
        type: "Observation",
        differential: {
          element: [
            {
              id: "Observation.category",
              path: "Observation.category",
              slicing: { discriminator: [{ type: "value", path: "code" }], rules: "nonsense" },
            },
          ],
        },
      }),
    );
    expect(req(req(sd.differential?.[0]).slicing).rules).toBe("open");
  });

  it("returns undefined for a non-StructureDefinition or one missing url/type", () => {
    expect(loadSd({ resourceType: "Patient" })).toBeUndefined();
    expect(loadSd({ resourceType: "StructureDefinition", type: "Patient" })).toBeUndefined();
    expect(loadSd({ resourceType: "StructureDefinition", url: "http://x" })).toBeUndefined();
  });

  it("exposes the R4 discriminator-type set without the R5-only 'position'", () => {
    expect([...DISCRIMINATOR_TYPES]).toEqual(["value", "exists", "pattern", "type", "profile"]);
    expect(DISCRIMINATOR_TYPES).not.toContain("position");
  });
});
