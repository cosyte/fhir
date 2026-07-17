import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  parseResource,
  readInterpretations,
  readMedicationDoses,
  readObservationValue,
  readQuantity,
  readReferenceRanges,
  requiredVitalSignUnits,
  resourceType,
  serializeResource,
  validateUcumShape,
  OBSERVATION_VALUE_TYPES,
  type ObservationValueType,
} from "../src/index.js";

function fixture(name: string): string {
  return readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");
}

function load(name: string): ReturnType<typeof parseResource>["resource"] {
  return parseResource(fixture(name)).resource;
}

function obs(body: Record<string, unknown>): ReturnType<typeof parseResource>["resource"] {
  return parseResource(JSON.stringify({ resourceType: "Observation", ...body })).resource;
}

describe("readObservationValue — the 11-way value[x] discrimination (never assume Quantity)", () => {
  it("exposes exactly the eleven R4 value[x] variants, in declared order", () => {
    expect(OBSERVATION_VALUE_TYPES).toEqual([
      "Quantity",
      "CodeableConcept",
      "String",
      "Boolean",
      "Integer",
      "Range",
      "Ratio",
      "SampledData",
      "Time",
      "DateTime",
      "Period",
    ]);
  });

  it("discriminates a Quantity value and populates the parsed quantity", () => {
    const value = readObservationValue(
      obs({ valueQuantity: { value: 5.4, system: "http://unitsofmeasure.org", code: "mmol/L" } }),
    );
    expect(value?.type).toBe<ObservationValueType>("Quantity");
    expect(value?.property).toBe("valueQuantity");
    expect(value?.quantity?.code).toBe("mmol/L");
    expect(value?.quantity?.value?.toString()).toBe("5.4");
  });

  it("reads a non-numeric string result as a String, never a number", () => {
    const value = readObservationValue(obs({ valueString: "POSITIVE" }));
    expect(value?.type).toBe<ObservationValueType>("String");
    // Crucially: no quantity is fabricated for a non-Quantity value.
    expect(value?.quantity).toBeUndefined();
  });

  it("reads a titer as a Ratio, not a number", () => {
    const value = readObservationValue(
      obs({ valueRatio: { numerator: { value: 1 }, denominator: { value: 64 } } }),
    );
    expect(value?.type).toBe<ObservationValueType>("Ratio");
    expect(value?.quantity).toBeUndefined();
  });

  it("discriminates each primitive and complex variant by its present property", () => {
    const cases: readonly [Record<string, unknown>, ObservationValueType][] = [
      [{ valueCodeableConcept: { text: "x" } }, "CodeableConcept"],
      [{ valueBoolean: true }, "Boolean"],
      [{ valueInteger: 3 }, "Integer"],
      [{ valueRange: { low: { value: 1 } } }, "Range"],
      [{ valueSampledData: { origin: { value: 0 }, period: 1, dimensions: 1 } }, "SampledData"],
      [{ valueTime: "12:00:00" }, "Time"],
      [{ valueDateTime: "2021-01-01" }, "DateTime"],
      [{ valuePeriod: { start: "2021-01-01" } }, "Period"],
    ];
    for (const [body, type] of cases) {
      expect(readObservationValue(obs(body))?.type).toBe(type);
    }
  });

  it("returns undefined when there is no value[x] (e.g. dataAbsentReason only)", () => {
    expect(
      readObservationValue(obs({ dataAbsentReason: { coding: [{ code: "unknown" }] } })),
    ).toBeUndefined();
  });

  it("reports additional present variants as ambiguous (a 0..1 choice violated)", () => {
    const value = readObservationValue(obs({ valueQuantity: { value: 1 }, valueString: "x" }));
    // First in declared order wins; the extra is surfaced rather than silently dropped.
    expect(value?.type).toBe<ObservationValueType>("Quantity");
    expect(value?.ambiguous).toEqual<ObservationValueType[]>(["String"]);
  });

  it("does not mistake an unrelated property that merely starts with 'value'", () => {
    // `valueless` is not a value[x] variant (no upper-case type suffix boundary).
    expect(readObservationValue(obs({ valueless: true }))).toBeUndefined();
  });
});

describe("readQuantity — the coded UCUM unit is distinct from the display string", () => {
  it("keeps code and unit separate and the value as an exact decimal", () => {
    const q = readQuantity(
      parseResource(
        '{"resourceType":"Observation","valueQuantity":{"value":0.010,"unit":"units","system":"http://unitsofmeasure.org","code":"U"}}',
      ).resource.properties.find((p) => p.name === "valueQuantity")?.value,
    );
    expect(q?.unit).toBe("units");
    expect(q?.code).toBe("U");
    expect(q?.system).toBe("http://unitsofmeasure.org");
    // Trailing-zero precision preserved (ADR 0001 — never through a JS number).
    expect(q?.value?.toString()).toBe("0.010");
  });

  it("surfaces a comparator bound with no value", () => {
    const q = readQuantity(
      parseResource(
        '{"resourceType":"Observation","valueQuantity":{"comparator":"<","value":0.01,"code":"mg"}}',
      ).resource.properties.find((p) => p.name === "valueQuantity")?.value,
    );
    expect(q?.comparator).toBe("<");
  });

  it("returns undefined for a non-complex node", () => {
    expect(readQuantity(undefined)).toBeUndefined();
  });

  it("returns an undefined value for a quantity that carries only a unit", () => {
    const q = readQuantity(
      parseResource(
        '{"resourceType":"Observation","valueQuantity":{"unit":"widgets"}}',
      ).resource.properties.find((p) => p.name === "valueQuantity")?.value,
    );
    expect(q?.value).toBeUndefined();
    expect(q?.unit).toBe("widgets");
  });
});

describe("validateUcumShape — structural (case/brackets), never membership", () => {
  it("accepts well-formed UCUM codes including brackets, slashes, and annotations", () => {
    for (const code of [
      "mm[Hg]",
      "kg/m2",
      "/min",
      "[lb_av]",
      "Cel",
      "%",
      "10*3/uL",
      "mg/dL",
      "{RBC}",
    ]) {
      expect(validateUcumShape(code)).toBe("ok");
    }
  });

  it("rejects whitespace, empty, and unbalanced brackets", () => {
    for (const code of ["", "mm Hg", "[lb_av", "kg m2", "mg)", "{unterminated"]) {
      expect(validateUcumShape(code)).toBe("invalid");
    }
  });

  it("is case-sensitive-preserving — it does not normalize, it only checks shape", () => {
    // Both are shape-valid; distinguishing Cel from a wrong-case variant is the caller's unit check.
    expect(validateUcumShape("Cel")).toBe("ok");
    expect(validateUcumShape("cel")).toBe("ok");
  });
});

describe("vital-signs required-unit table", () => {
  it("maps the roadmap-named vital signs to their required UCUM codes", () => {
    expect(requiredVitalSignUnits("29463-7")).toEqual(["g", "kg", "[lb_av]"]); // weight
    expect(requiredVitalSignUnits("8480-6")).toEqual(["mm[Hg]"]); // systolic BP
    expect(requiredVitalSignUnits("8310-5")).toEqual(["Cel", "[degF]"]); // temperature
    expect(requiredVitalSignUnits("39156-5")).toEqual(["kg/m2"]); // BMI
  });

  it("returns undefined for an unlisted LOINC code (clean degrade)", () => {
    expect(requiredVitalSignUnits("2339-0")).toBeUndefined(); // glucose (a lab, not a vital)
  });
});

describe("interpretation & referenceRange are surfaced and preserved (not evaluated)", () => {
  it("surfaces interpretation flags and reference-range bounds", () => {
    const glucose = load("observation-lab-refrange.json");
    expect(readInterpretations(glucose).map((c) => c.code)).toEqual(["N"]);
    const ranges = readReferenceRanges(glucose);
    expect(ranges).toHaveLength(1);
    expect(ranges[0]?.low?.value?.toString()).toBe("70");
    expect(ranges[0]?.high?.value?.toString()).toBe("99");
    expect(ranges[0]?.type.map((c) => c.code)).toEqual(["normal"]);
  });

  it("reads a single (non-array) referenceRange and skips a non-complex entry", () => {
    const single = readReferenceRanges(
      obs({ referenceRange: { low: { value: 1, code: "mg/dL" } } }),
    );
    expect(single).toHaveLength(1);
    expect(single[0]?.low?.code).toBe("mg/dL");

    // A malformed non-object entry in the list is skipped rather than crashing.
    const malformed = readReferenceRanges(obs({ referenceRange: ["nope"] }));
    expect(malformed).toEqual([]);
  });

  it("returns [] when there is no referenceRange and [] interpretations when absent", () => {
    const bare = obs({ valueQuantity: { value: 1 } });
    expect(readReferenceRanges(bare)).toEqual([]);
    expect(readInterpretations(bare)).toEqual([]);
  });

  it("preserves value[x], interpretation and referenceRange across parse → serialize → parse", () => {
    const before = load("observation-lab-refrange.json");
    const after = parseResource(serializeResource(before)).resource;
    expect(readObservationValue(after)?.quantity?.code).toBe("mg/dL");
    expect(readInterpretations(after).map((c) => c.code)).toEqual(["N"]);
    expect(readReferenceRanges(after)[0]?.high?.value?.toString()).toBe("99");
  });
});

describe("readMedicationDoses — dose Quantity surfaced with its coded unit", () => {
  it("reads MedicationRequest dosageInstruction doseQuantity", () => {
    const rx = load("medicationrequest-dose.json");
    const doses = readMedicationDoses(rx, resourceType(rx));
    expect(doses).toHaveLength(1);
    expect(doses[0]?.code).toBe("mg");
    expect(doses[0]?.value?.toString()).toBe("5");
  });

  it("reads MedicationStatement dosage doseQuantity", () => {
    const ms = parseResource(
      JSON.stringify({
        resourceType: "MedicationStatement",
        status: "active",
        dosage: [
          {
            doseAndRate: [
              { doseQuantity: { value: 10, system: "http://unitsofmeasure.org", code: "mL" } },
            ],
          },
        ],
      }),
    ).resource;
    expect(readMedicationDoses(ms, resourceType(ms))[0]?.code).toBe("mL");
  });

  it("returns [] for a non-medication resource and for an undefined resourceType", () => {
    expect(readMedicationDoses(obs({ valueQuantity: { value: 1 } }), "Observation")).toEqual([]);
    expect(readMedicationDoses(obs({}), undefined)).toEqual([]);
  });

  it("reads a single (non-array) dosage and doseAndRate, and ignores a doseRange (no doseQuantity)", () => {
    const single = parseResource(
      JSON.stringify({
        resourceType: "MedicationRequest",
        status: "active",
        intent: "order",
        dosageInstruction: {
          doseAndRate: {
            doseQuantity: { value: 2, system: "http://unitsofmeasure.org", code: "mg" },
          },
        },
      }),
    ).resource;
    expect(readMedicationDoses(single, resourceType(single))[0]?.code).toBe("mg");

    const range = parseResource(
      JSON.stringify({
        resourceType: "MedicationRequest",
        status: "active",
        intent: "order",
        dosageInstruction: [
          { doseAndRate: [{ doseRange: { low: { value: 1 }, high: { value: 2 } } }] },
        ],
      }),
    ).resource;
    expect(readMedicationDoses(range, resourceType(range))).toEqual([]);
  });

  it("skips malformed non-complex dosage / doseAndRate entries without crashing", () => {
    const malformed = parseResource(
      JSON.stringify({
        resourceType: "MedicationRequest",
        status: "active",
        intent: "order",
        dosageInstruction: ["nope", { doseAndRate: ["also-nope"] }],
      }),
    ).resource;
    expect(readMedicationDoses(malformed, resourceType(malformed))).toEqual([]);
  });
});
