/**
 * `readSafety` over a resource type the safety layer does not model: an explicit not-assessed
 * result, never `safeToSummarize: true`.
 *
 * The status codes that withdraw or cancel a record differ by type (`revoked` on a ServiceRequest,
 * `cancelled` on an Encounter, `inactive` on a NutritionProduct), and the layer reads those meanings
 * only for the types it models. For any other type it cannot say the record is current, so it says
 * so: the resource root is listed on `notAssessed` and the readout declines to affirm. That holds at
 * every resource root the document carries, a `contained` resource and a Bundle entry included,
 * because `safeToSummarize` speaks for the whole document.
 *
 * FIXTURES ARE SYNTHETIC: made-up ids, codes and text, and no person, name, date of birth or
 * address. The R4B documents use types R4B added; nothing tells the package a document's version,
 * so they read as R4 and land here as unmodeled.
 */
import { describe, expect, it } from "vitest";

import {
  assertSafeToSummarize,
  complex,
  FhirSafetyError,
  parseResource,
  parseResourceXml,
  primitive,
  readSafety,
  type FhirComplex,
} from "../src/index.js";

function parse(obj: unknown): FhirComplex {
  return parseResource(JSON.stringify(obj)).resource;
}

describe("an unmodeled R4 type is not assessed, never safe", () => {
  it("a revoked ServiceRequest is not affirmed", () => {
    const safety = readSafety(
      parse({
        resourceType: "ServiceRequest",
        id: "syn-sr-0001",
        status: "revoked",
        intent: "order",
        subject: { reference: "Patient/syn-pt-0001" },
      }),
    );
    expect(safety.notAssessed).toEqual(["ServiceRequest"]);
    expect(safety.safeToSummarize).toBe(false);
    // The convenience read is still made; the verdict is what changes.
    expect(safety.status).toBe("revoked");
  });

  it("a cancelled Encounter is not affirmed, and the refusal names its root", () => {
    const resource = parse({
      resourceType: "Encounter",
      id: "syn-enc-0001",
      status: "cancelled",
      class: { system: "http://example.org/syn-class", code: "SYN" },
    });
    expect(readSafety(resource).safeToSummarize).toBe(false);
    expect(() => assertSafeToSummarize(resource)).toThrow(FhirSafetyError);
    try {
      assertSafeToSummarize(resource);
    } catch (error) {
      expect((error as FhirSafetyError).locations).toEqual(["Encounter"]);
    }
  });

  it("is not assessed whatever the status, a conformant current one included", () => {
    for (const status of ["active", "completed", "not-a-status"]) {
      const safety = readSafety(
        parse({ resourceType: "Procedure", id: "syn-proc-0001", status, subject: {} }),
      );
      expect(safety.notAssessed).toEqual(["Procedure"]);
      expect(safety.safeToSummarize).toBe(false);
    }
  });

  it("reads the same from XML", () => {
    const { resource } = parseResourceXml(
      '<Encounter xmlns="http://hl7.org/fhir"><id value="syn-enc-0002"/>' +
        '<status value="cancelled"/></Encounter>',
    );
    const safety = readSafety(resource);
    expect(safety.notAssessed).toEqual(["Encounter"]);
    expect(safety.safeToSummarize).toBe(false);
  });
});

describe("an R4B type is not assessed, never safe", () => {
  it("a NutritionProduct with any status is not affirmed", () => {
    for (const status of ["active", "inactive", "entered-in-error", "not-a-status"]) {
      const safety = readSafety(
        parse({
          resourceType: "NutritionProduct",
          id: "syn-np-0001",
          status,
          code: { text: "Synthetic formula" },
        }),
      );
      expect(safety.notAssessed).toEqual(["NutritionProduct"]);
      expect(safety.safeToSummarize).toBe(false);
    }
  });

  it("an R4B Ingredient is not affirmed", () => {
    const safety = readSafety(
      parse({
        resourceType: "Ingredient",
        id: "syn-ing-0001",
        status: "retired",
        role: { text: "Synthetic role" },
        substance: { code: { concept: { text: "Synthetic substance" } } },
      }),
    );
    expect(safety.notAssessed).toEqual(["Ingredient"]);
    expect(safety.safeToSummarize).toBe(false);
  });
});

describe("every resource root the document carries is judged", () => {
  it("an unmodeled Bundle entry withdraws the verdict, at the entry's location", () => {
    const safety = readSafety(
      parse({
        resourceType: "Bundle",
        type: "collection",
        entry: [
          {
            resource: {
              resourceType: "Observation",
              status: "final",
              code: { text: "Synthetic reading" },
            },
          },
          { resource: { resourceType: "Encounter", status: "cancelled" } },
        ],
      }),
    );
    expect(safety.notAssessed).toEqual(["Bundle.entry[1].resource"]);
    expect(safety.safeToSummarize).toBe(false);
  });

  it("an unmodeled contained resource withdraws the verdict", () => {
    const safety = readSafety(
      parse({
        resourceType: "MedicationRequest",
        status: "active",
        intent: "order",
        contained: [{ resourceType: "Medication", id: "syn-med", status: "inactive" }],
        medicationReference: { reference: "#syn-med" },
        subject: { reference: "Patient/syn-pt-0001" },
      }),
    );
    expect(safety.notAssessed).toEqual(["MedicationRequest.contained[0]"]);
    expect(safety.safeToSummarize).toBe(false);
  });

  it("names a root a repeated property name wrote twice once", () => {
    const safety = readSafety(
      parseResource(
        '{"resourceType":"Bundle","type":"collection","entry":[{' +
          '"resource":{"resourceType":"Encounter","status":"cancelled"},' +
          '"resource":{"resourceType":"Encounter","status":"finished"}}]}',
      ).resource,
    );
    expect(safety.shadowedProperties).toEqual(["Bundle.entry[0].resource"]);
    expect(safety.notAssessed).toEqual(["Bundle.entry[0].resource"]);
  });

  it("a root with no readable type is not assessed", () => {
    const safety = readSafety(complex([{ name: "status", value: primitive("active") }]));
    expect(safety.notAssessed).toEqual(["$this"]);
    expect(safety.safeToSummarize).toBe(false);
  });

  it("a root naming a modeled and an unmodeled type is not assessed", () => {
    const safety = readSafety(
      parse({ resourceType: ["Observation", "Encounter"], status: "final", code: {} }),
    );
    expect(safety.notAssessed).toEqual(["Observation"]);
    expect(safety.safeToSummarize).toBe(false);
  });
});

describe("the modeled types are still assessed", () => {
  it("affirms each of the types the safety layer models, and a Bundle of them", () => {
    const documents: unknown[] = [
      { resourceType: "Patient", id: "syn-pt-0001" },
      { resourceType: "Practitioner", id: "syn-pr-0001" },
      { resourceType: "Observation", status: "final", code: { text: "Synthetic reading" } },
      { resourceType: "DiagnosticReport", status: "final", code: { text: "Synthetic report" } },
      { resourceType: "Condition", subject: { reference: "Patient/syn-pt-0001" } },
      { resourceType: "AllergyIntolerance", patient: { reference: "Patient/syn-pt-0001" } },
      { resourceType: "Immunization", status: "completed", vaccineCode: { text: "Synthetic" } },
      { resourceType: "MedicationRequest", status: "active", intent: "order" },
      { resourceType: "MedicationStatement", status: "active" },
      {
        resourceType: "Bundle",
        type: "collection",
        entry: [{ resource: { resourceType: "Patient", id: "syn-pt-0002" } }],
      },
    ];
    for (const document of documents) {
      const safety = readSafety(parse(document));
      expect(safety.notAssessed).toEqual([]);
      expect(safety.safeToSummarize).toBe(true);
    }
  });
});
