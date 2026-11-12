/**
 * `validateResource` with no options, over the five documents a review found reading `valid: true`
 * with nothing said about what went unchecked, and the `fullyChecked` bit that says whether `valid`
 * is a verdict over every rule that applies.
 *
 * Every document is synthetic: placeholder codes and texts, `example.org` URLs, no value that
 * resembles a person.
 */

import { describe, expect, it } from "vitest";

import {
  defineProfile,
  parseResource,
  validateResource,
  type ValidateOptions,
  type ValidationResult,
} from "../src/index.js";
import { LEAVES_UNCHECKED } from "../src/validate/unchecked.js";

type Doc = Readonly<Record<string, unknown>>;

function validate(doc: Doc, options?: ValidateOptions): ValidationResult {
  return validateResource(parseResource(JSON.stringify(doc)).resource, options);
}

/** Each finding as `CODE key at location`, the key only where the finding carries one. */
function findings(result: ValidationResult): string[] {
  return result.issues.map(
    (i) => `${i.code}${i.constraint === undefined ? "" : ` ${i.constraint}`} at ${i.expression}`,
  );
}

const OBSERVATION = {
  resourceType: "Observation",
  status: "final",
  code: { text: "Synthetic test" },
} as const;

describe("the five reviewed documents", () => {
  it("a valueQuantity with a code and no system is invalid, breaking qty-3", () => {
    const result = validate({ ...OBSERVATION, valueQuantity: { value: 1, code: "mg" } });
    expect(result.valid).toBe(false);
    expect(findings(result)).toContain("INVARIANT_VIOLATED qty-3 at Observation.valueQuantity");
    expect(result.fullyChecked).toBe(true);
  });

  it("a Period that starts after it ends is invalid, breaking per-1", () => {
    const result = validate({
      ...OBSERVATION,
      effectivePeriod: { start: "2020-02-01", end: "2020-01-01" },
    });
    expect(result.valid).toBe(false);
    expect(findings(result)).toEqual(["INVARIANT_VIOLATED per-1 at Observation.effectivePeriod"]);
    expect(result.fullyChecked).toBe(true);
  });

  it("a referenceRange.low with a comparator is invalid, breaking sqty-1", () => {
    const result = validate({
      ...OBSERVATION,
      valueQuantity: { value: 1, unit: "mg", system: "http://unitsofmeasure.org", code: "mg" },
      referenceRange: [
        {
          low: {
            value: 1,
            comparator: ">",
            unit: "mg",
            system: "http://unitsofmeasure.org",
            code: "mg",
          },
        },
      ],
    });
    expect(result.valid).toBe(false);
    expect(findings(result)).toEqual([
      "INVARIANT_VIOLATED sqty-1 at Observation.referenceRange[0].low",
    ]);
    expect(result.fullyChecked).toBe(true);
  });

  it("an extension whose url has no definition supplied is reported not checked", () => {
    const result = validate({
      ...OBSERVATION,
      extension: [{ url: "http://example.org/fhir/StructureDefinition/fake", valueString: "x" }],
    });
    expect(result.valid).toBe(true);
    expect(findings(result)).toEqual(["EXTENSION_UNCHECKED at Observation.extension[0]"]);
    expect(result.issues[0]?.severity).toBe("information");
    expect(result.fullyChecked).toBe(false);
  });

  it("a meta.profile claim with no matching profile supplied is reported not checked", () => {
    const result = validate({
      ...OBSERVATION,
      meta: { profile: ["http://example.org/fhir/StructureDefinition/fake-observation"] },
    });
    expect(result.valid).toBe(true);
    expect(findings(result)).toEqual(["PROFILE_UNCHECKED at Observation.meta.profile[0]"]);
    expect(result.issues[0]?.severity).toBe("information");
    expect(result.fullyChecked).toBe(false);
  });
});

describe("fullyChecked", () => {
  it("reads true over a clean document of a fully checked type", () => {
    const result = validate({
      ...OBSERVATION,
      valueQuantity: { value: 1, unit: "mg", system: "http://unitsofmeasure.org", code: "mg" },
    });
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.fullyChecked).toBe(true);
  });

  it("reads true when the claimed profile is supplied, whatever version the claim pins", () => {
    const url = "http://example.org/fhir/StructureDefinition/fake-observation";
    const profile = defineProfile({ url, type: "Observation" });
    const claimed = { ...OBSERVATION, meta: { profile: [url] } };
    expect(validate(claimed, { profiles: [profile] }).fullyChecked).toBe(true);
    expect(findings(validate(claimed, { profiles: [profile] }))).toEqual([]);
    const pinned = { ...OBSERVATION, meta: { profile: [`${url}|9.9.9`] } };
    expect(findings(validate(pinned, { profiles: [profile] }))).toEqual([]);
  });

  it("reports a claim whose supplied profile is of another type, and each claim at its index", () => {
    const url = "http://example.org/fhir/StructureDefinition/fake-patient";
    const profile = defineProfile({ url, type: "Patient" });
    const result = validate(
      { ...OBSERVATION, meta: { profile: [url, "http://example.org/other"] } },
      { profiles: [profile] },
    );
    expect(findings(result)).toEqual([
      "PROFILE_UNCHECKED at Observation.meta.profile[0]",
      "PROFILE_UNCHECKED at Observation.meta.profile[1]",
    ]);
  });

  it("reads false for a type outside the eight, a contained resource, or no type", () => {
    expect(validate({ resourceType: "Practitioner" }).fullyChecked).toBe(false);
    expect(validate({ resourceType: "Basic", code: { text: "x" } }).fullyChecked).toBe(false);
    expect(validate({ resourceType: "Bundle", type: "collection" }).fullyChecked).toBe(false);
    expect(validate({ status: "final" }).fullyChecked).toBe(false);
    const contained = validate({
      resourceType: "Patient",
      contained: [{ resourceType: "Practitioner", id: "c1" }],
      generalPractitioner: [{ reference: "#c1" }],
    });
    expect(contained.fullyChecked).toBe(false);
    expect(validate({ resourceType: "Patient", active: true }).fullyChecked).toBe(true);
  });

  it("reads false when the registry has no schema for the type, a caller's schemas aside", () => {
    const registry = () => undefined;
    expect(validate({ resourceType: "Patient", active: true }, { registry }).fullyChecked).toBe(
      false,
    );
  });

  it("reads false over a constraint the engine could not evaluate", () => {
    const result = validate({
      resourceType: "Patient",
      active: true,
      extension: [{ url: "http://example.org/e", valueCount: { value: 1 } }],
    });
    expect(findings(result)).toContain(
      "INVARIANT_UNCHECKED cnt-3 at Patient.extension[0].valueCount",
    );
    expect(result.fullyChecked).toBe(false);
  });

  it("reads false over an element the definitions do not define", () => {
    const result = validate({ resourceType: "Patient", active: true, fake: "x" });
    expect(result.fullyChecked).toBe(false);
  });

  it("reads true over findings that leave nothing unchecked", () => {
    const result = validate({ resourceType: "Patient", gender: "fake" });
    expect(result.valid).toBe(false);
    expect(result.fullyChecked).toBe(true);
  });
});

describe("EXTENSION_UNCHECKED", () => {
  it("reports each outermost extension at any depth, a primitive's own included, never a nested one", () => {
    const ext = (extra: Doc = {}) => ({ url: "http://example.org/e", ...extra });
    const result = validate({
      resourceType: "Patient",
      extension: [ext({ extension: [ext({ valueString: "x" })] })],
      _birthDate: { extension: [ext({ valueString: "x" })] },
      birthDate: "1970-01-01",
      name: [{ text: "Fake", extension: [ext({ valueString: "x" })] }],
      contained: [{ resourceType: "Basic", id: "c1", extension: [ext({ valueString: "x" })] }],
    });
    expect(
      result.issues.filter((i) => i.code === "EXTENSION_UNCHECKED").map((i) => i.expression),
    ).toEqual([
      "Patient.extension[0]",
      "Patient.birthDate.extension[0]",
      "Patient.name[0].extension[0]",
      "Patient.contained[0].extension[0]",
    ]);
  });

  it("reports an extension inside the value of another extension", () => {
    const result = validate({
      resourceType: "Patient",
      extension: [
        {
          url: "http://example.org/outer",
          valueCodeableConcept: {
            text: "x",
            extension: [{ url: "http://example.org/inner", valueString: "x" }],
          },
        },
      ],
    });
    expect(
      result.issues.filter((i) => i.code === "EXTENSION_UNCHECKED").map((i) => i.expression),
    ).toEqual(["Patient.extension[0]", "Patient.extension[0].valueCodeableConcept.extension[0]"]);
  });

  it("does not report a modifierExtension, which is refused as unhandled", () => {
    const result = validate({
      resourceType: "Patient",
      modifierExtension: [{ url: "http://example.org/m", valueString: "x" }],
    });
    expect(result.issues.map((i) => i.code)).not.toContain("EXTENSION_UNCHECKED");
    expect(result.issues.map((i) => i.code)).toContain("UNHANDLED_MODIFIER_EXTENSION");
    expect(result.fullyChecked).toBe(false);
  });
});

describe("what fullyChecked counts", () => {
  it("counts exactly these codes as leaving something unchecked or unread", () => {
    expect(
      Object.entries(LEAVES_UNCHECKED())
        .filter(([, leaves]) => leaves)
        .map(([code]) => code)
        .sort(),
    ).toEqual([
      "ABSENCE_MARKER_UNREADABLE",
      "ARRAY_WRAPPED_CHOICE",
      "CONTAINED_ID_DUPLICATE",
      "DROPPED_ELEMENT_TEXT",
      "DUPLICATE_PROPERTY",
      "EXTENSION_UNCHECKED",
      "INVARIANT_UNCHECKED",
      "NARRATIVE_UNREADABLE",
      "NESTED_ARRAY",
      "PROFILE_CONSTRAINT_UNCHECKED",
      "PROFILE_SLICE_NO_SLICING",
      "PROFILE_SLICE_UNCHECKED",
      "PROFILE_UNCHECKED",
      "PROFILE_VERSION_MISMATCH",
      "RESOURCE_NOT_MODELED",
      "RESOURCE_TYPE_UNKNOWN",
      "UNHANDLED_MODIFIER_EXTENSION",
      "UNKNOWN_ELEMENT",
    ]);
  });

  it("can read true for each of the eight types, and never for another modeled one", () => {
    for (const resourceType of [
      "AllergyIntolerance",
      "Condition",
      "DiagnosticReport",
      "Immunization",
      "MedicationRequest",
      "MedicationStatement",
      "Observation",
      "Patient",
    ]) {
      expect(validate({ resourceType }).fullyChecked, resourceType).toBe(true);
    }
    for (const resourceType of ["Encounter", "Procedure", "DocumentReference"]) {
      expect(validate({ resourceType }).fullyChecked, resourceType).toBe(false);
    }
  });
});

describe("PROFILE_UNCHECKED over the shapes meta can take", () => {
  const claims = (meta: unknown) =>
    findings(validate({ ...OBSERVATION, meta })).filter((f) => f.startsWith("PROFILE_UNCHECKED"));

  it("reads a lone claim at index 0, and passes over a meta that holds no claim it can read", () => {
    expect(claims({ profile: "http://example.org/fake" })).toEqual([
      "PROFILE_UNCHECKED at Observation.meta.profile[0]",
    ]);
    expect(claims("fake")).toEqual([]);
    expect(claims({ versionId: "1" })).toEqual([]);
    expect(claims({ profile: [{ a: 1 }] })).toEqual([]);
  });

  it("reports an extension written as something other than an object, and reads past it", () => {
    const result = validate({ resourceType: "Patient", extension: ["fake"] });
    expect(
      result.issues.filter((i) => i.code === "EXTENSION_UNCHECKED").map((i) => i.expression),
    ).toEqual(["Patient.extension[0]"]);
  });
});
