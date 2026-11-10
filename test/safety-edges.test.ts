/**
 * The safety and quantity readers at their edges: one report per thing said at one location, the
 * fail-safe coding helpers over every shape a `CodeableConcept` arrives in, and dose and value reads
 * over entries that are not objects.
 *
 * FIXTURES ARE SYNTHETIC: made-up codes, references and quantities, and no person, name, date of
 * birth or address.
 */
import { describe, expect, it } from "vitest";

import {
  absenceMarkers,
  codeOf,
  codingsOf,
  complex,
  DATA_ABSENT_REASON_URL,
  decimal,
  getProperty,
  hasCodeAnySystem,
  list,
  locateDoseQuantities,
  parseResource,
  primitive,
  readMedicationDoses,
  readSafety,
  validateResource,
  type FhirComplex,
} from "../src/index.js";

function parse(obj: unknown): FhirComplex {
  return parseResource(JSON.stringify(obj)).resource;
}

function coding(system: string | undefined, code: string): FhirComplex {
  return complex([
    ...(system === undefined ? [] : [{ name: "system", value: primitive(system) }]),
    { name: "code", value: primitive(code) },
  ]);
}

describe("hasCodeAnySystem and codeOf: the fail-safe coding reads", () => {
  const concept = complex([
    {
      name: "coding",
      value: list([
        coding("http://example.org/a", "first"),
        coding(undefined, "entered-in-error"),
        coding("http://example.org/b", "preferred"),
      ]),
    },
  ]);

  it("finds a code under any system, the system-less coding included", () => {
    expect(hasCodeAnySystem(concept, "entered-in-error")).toBe(true);
    expect(hasCodeAnySystem(concept, "preferred")).toBe(true);
    expect(hasCodeAnySystem(concept, "absent")).toBe(false);
    expect(hasCodeAnySystem(undefined, "entered-in-error")).toBe(false);
  });

  it("surfaces the first code, or the first in a preferred system when one is given", () => {
    expect(codeOf(concept)).toBe("first");
    expect(codeOf(concept, "http://example.org/b")).toBe("preferred");
    expect(codeOf(concept, "http://example.org/none")).toBe("first");
    expect(codeOf(undefined)).toBeUndefined();
    expect(codeOf(complex([{ name: "text", value: primitive("free text only") }]))).toBeUndefined();
  });

  it("reads a list of concepts, and skips a coding entry that is not an object", () => {
    const withStray = complex([
      { name: "coding", value: list([primitive("stray"), coding("http://example.org/a", "kept")]) },
    ]);
    expect(codingsOf(withStray)).toEqual([{ system: "http://example.org/a", code: "kept" }]);
    expect(codingsOf(list([withStray, concept])).map((c) => c.code)).toEqual([
      "kept",
      "first",
      "entered-in-error",
      "preferred",
    ]);
    expect(codingsOf(primitive("not-a-concept"))).toEqual([]);
  });
});

describe("one report per thing said at one location", () => {
  it("reports two markers spelling the same absence reason at one element once", () => {
    const patient = parse({
      resourceType: "Patient",
      _birthDate: {
        extension: [
          { url: DATA_ABSENT_REASON_URL, valueCode: "unknown" },
          { url: DATA_ABSENT_REASON_URL, valueCode: "unknown" },
          { url: DATA_ABSENT_REASON_URL, valueCode: "asked-declined" },
        ],
      },
    });
    expect(absenceMarkers(patient, "Patient")).toEqual([
      { code: "unknown", location: "Patient.birthDate" },
      { code: "asked-declined", location: "Patient.birthDate" },
    ]);
  });

  it("surfaces an intent a repeated property name walks twice at one location once", () => {
    const request = (intent: string) =>
      `{"resourceType":"MedicationRequest","status":"active","intent":"${intent}",` +
      `"subject":{"reference":"Patient/1"},"medicationCodeableConcept":{"text":"synthetic"}}`;
    const bundle = (a: string, b: string) =>
      parseResource(
        `{"resourceType":"Bundle","type":"collection","entry":[{"resource":${request(a)},"resource":${request(b)}}]}`,
      ).resource;

    expect(readSafety(bundle("order", "order")).intents).toEqual([
      { code: "order", location: "Bundle.entry[0].resource.intent" },
    ]);
    // Two different codes at one location genuinely differ, and both stay.
    expect(readSafety(bundle("order", "plan")).intents).toEqual([
      { code: "order", location: "Bundle.entry[0].resource.intent" },
      { code: "plan", location: "Bundle.entry[0].resource.intent" },
    ]);
  });
});

describe("dose and value reads over entries that are not objects", () => {
  it("skips a doseAndRate entry that is not an object and keeps the next one's index", () => {
    const dose = complex([
      { name: "value", value: primitive(decimal("5")) },
      { name: "code", value: primitive("mg") },
    ]);
    const request = complex([
      { name: "resourceType", value: primitive("MedicationRequest") },
      {
        name: "dosageInstruction",
        value: list([
          complex([
            {
              name: "doseAndRate",
              value: list([primitive("stray"), complex([{ name: "doseQuantity", value: dose }])]),
            },
          ]),
        ]),
      },
    ]);
    expect(locateDoseQuantities(request, "MedicationRequest").map((d) => d.path)).toEqual([
      "MedicationRequest.dosageInstruction[0].doseAndRate[1].doseQuantity",
    ]);
    expect(readMedicationDoses(request, "MedicationRequest").map((q) => q.code)).toEqual(["mg"]);
  });

  it("reports an array-wrapped value choice once, however many repeated members carry a wrapper", () => {
    const { resource } = parseResource(
      '{"resourceType":"Observation","status":"final","code":{"text":"synthetic"},' +
        '"valueQuantity":[{"value":1}],"valueQuantity":[{"value":2}]}',
    );
    const wrapped = validateResource(resource).issues.filter(
      (i) => i.code === "ARRAY_WRAPPED_CHOICE",
    );
    expect(wrapped.map((i) => i.expression)).toEqual(["Observation.valueQuantity"]);
  });

  it("reads the vital-signs profile when meta.profile is a single canonical, not a list", () => {
    const observation = parse({
      resourceType: "Observation",
      status: "final",
      meta: { profile: "http://hl7.org/fhir/StructureDefinition/vitalsigns" },
      code: { coding: [{ system: "http://loinc.org", code: "8867-4" }] },
      valueQuantity: {
        value: 72,
        unit: "beats",
        system: "http://unitsofmeasure.org",
        code: "beats",
      },
    });
    expect(
      validateResource(observation)
        .issues.filter((i) => i.code === "VITAL_SIGN_UNIT_NONCONFORMANT")
        .map((i) => i.expression),
    ).toEqual(["Observation.valueQuantity"]);
    expect(getProperty(observation, "category")).toBeUndefined();
  });
});
