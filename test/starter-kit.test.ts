import { describe, expect, it } from "vitest";

import {
  defineProfile,
  parseResource,
  starterProfile,
  validateResource,
  ISSUE_SEVERITIES,
  PATIENT_IDENTIFIER_STARTER,
  STARTER_PROFILE_BASE_URL,
  STARTER_PROFILES,
  VETERINARY_PATIENT_STARTER,
  VITAL_SIGN_OBSERVATION_STARTER,
  type ValidationIssue,
} from "../src/index.js";

/** A synthetic (non-PHI) spec-clean vital-sign Observation. */
const CLEAN_VITAL = JSON.stringify({
  resourceType: "Observation",
  status: "final",
  category: [
    {
      coding: [
        {
          system: "http://terminology.hl7.org/CodeSystem/observation-category",
          code: "vital-signs",
        },
      ],
    },
  ],
  code: { coding: [{ system: "http://loinc.org", code: "8867-4" }] },
});

/** A synthetic Observation whose only category is laboratory, the required VSCat slice is absent. */
const LAB_CATEGORY = JSON.stringify({
  resourceType: "Observation",
  status: "final",
  category: [
    {
      coding: [
        {
          system: "http://terminology.hl7.org/CodeSystem/observation-category",
          code: "laboratory",
        },
      ],
    },
  ],
  code: { coding: [{ system: "http://loinc.org", code: "8867-4" }] },
});

/**
 * A synthetic vital-sign Observation that *also* carries a laboratory category, a conformant instance
 * the sliced (not bare-pattern) profile must accept. A bare pattern on the repeating element would
 * wrongly reject the extra category; the VSCat slice + open slicing allows it.
 */
const MULTI_CATEGORY = JSON.stringify({
  resourceType: "Observation",
  status: "final",
  category: [
    {
      coding: [
        {
          system: "http://terminology.hl7.org/CodeSystem/observation-category",
          code: "vital-signs",
        },
      ],
    },
    {
      coding: [
        {
          system: "http://terminology.hl7.org/CodeSystem/observation-category",
          code: "laboratory",
        },
      ],
    },
  ],
  code: { coding: [{ system: "http://loinc.org", code: "8867-4" }] },
});

describe("profile starter kit", () => {
  it("is authored through the public defineProfile path (dogfood check)", () => {
    // Re-running defineProfile against a starter's own reconstructed spec yields the same object,
    // i.e. a starter is nothing more than a defineProfile call, no privileged internal builder.
    for (const p of STARTER_PROFILES) {
      expect(p.url.startsWith(STARTER_PROFILE_BASE_URL)).toBe(true);
      expect(typeof p.type).toBe("string");
      // An ElementDefinition is directly assignable as a ProfileElementSpec (its `max` is already a
      // number), so re-authoring a starter from its own normalized differential must be idempotent.
      const rebuilt = defineProfile({
        url: p.url,
        type: p.type,
        ...(p.name === undefined ? {} : { name: p.name }),
        ...(p.differential === undefined ? {} : { differential: p.differential }),
      });
      expect(rebuilt).toEqual(p);
    }
  });

  it("looks a starter up by url and misses cleanly", () => {
    expect(starterProfile(VITAL_SIGN_OBSERVATION_STARTER.url)).toBe(VITAL_SIGN_OBSERVATION_STARTER);
    expect(starterProfile(PATIENT_IDENTIFIER_STARTER.url)).toBe(PATIENT_IDENTIFIER_STARTER);
    expect(starterProfile("http://nope")).toBeUndefined();
  });

  it("passes a spec-clean vital-sign Observation with no profile errors", () => {
    const { resource } = parseResource(CLEAN_VITAL);
    const { issues } = validateResource(resource, { profiles: [VITAL_SIGN_OBSERVATION_STARTER] });
    const profileErrors = issues.filter(
      (i) =>
        i.severity === ISSUE_SEVERITIES.ERROR &&
        (i.code === "PROFILE_PATTERN_MISMATCH" ||
          i.code === "PROFILE_FIXED_MISMATCH" ||
          i.code === "CARDINALITY_MIN" ||
          i.code === "CARDINALITY_MAX"),
    );
    expect(profileErrors).toEqual([]);
  });

  it("flags an Observation missing the required vital-signs category slice", () => {
    const { resource } = parseResource(LAB_CATEGORY);
    const { issues } = validateResource(resource, { profiles: [VITAL_SIGN_OBSERVATION_STARTER] });
    // The VSCat slice is required (min 1); with only a laboratory category it is absent → CARDINALITY_MIN
    // on the slice. The slicing is open, so the laboratory entry itself is NOT flagged as unmatched.
    expect(
      issues.some(
        (i) => i.code === "CARDINALITY_MIN" && i.expression === "Observation.category:VSCat",
      ),
    ).toBe(true);
    expect(issues.some((i) => i.code === "PROFILE_SLICE_UNMATCHED")).toBe(false);
  });

  it("accepts a vital-sign Observation that also carries another category (sliced, not bare pattern)", () => {
    const { resource } = parseResource(MULTI_CATEGORY);
    const { issues } = validateResource(resource, { profiles: [VITAL_SIGN_OBSERVATION_STARTER] });
    // The regression the refuter caught: a bare pattern on repeating `category` would false-flag the
    // extra `laboratory` entry. With a VSCat slice + open slicing, the multi-category instance is clean.
    const profileErrors = issues.filter(
      (i) =>
        i.severity === ISSUE_SEVERITIES.ERROR &&
        (i.code === "PROFILE_PATTERN_MISMATCH" ||
          i.code === "PROFILE_SLICE_UNMATCHED" ||
          i.code === "CARDINALITY_MIN" ||
          i.code === "CARDINALITY_MAX"),
    );
    expect(profileErrors).toEqual([]);
  });

  it("treats a missing must-support identifier field as information, never an error", () => {
    // A Patient with an identifier that carries a value but no system: `identifier.system` is
    // must-support-absent (information, the load-bearing rule) and cardinality-min (error).
    const { resource } = parseResource(
      JSON.stringify({
        resourceType: "Patient",
        identifier: [{ value: "synthetic-123" }],
      }),
    );
    const { issues } = validateResource(resource, { profiles: [PATIENT_IDENTIFIER_STARTER] });
    const mustSupport = issues.filter((i) => i.code === "MUST_SUPPORT_ABSENT");
    expect(mustSupport.length).toBeGreaterThan(0);
    for (const i of mustSupport) expect(i.severity).toBe(ISSUE_SEVERITIES.INFORMATION);
    expect(
      issues.some(
        (i) => i.code === "CARDINALITY_MIN" && i.expression === "Patient.identifier.system",
      ),
    ).toBe(true);
  });

  it("passes a Patient carrying a full (system,value) identifier", () => {
    const { resource } = parseResource(
      JSON.stringify({
        resourceType: "Patient",
        identifier: [{ system: "http://hospital.example.org/mrn", value: "synthetic-123" }],
      }),
    );
    const { issues } = validateResource(resource, { profiles: [PATIENT_IDENTIFIER_STARTER] });
    expect(issues.some((i) => i.code === "MUST_SUPPORT_ABSENT")).toBe(false);
    expect(issues.some((i) => i.code === "CARDINALITY_MIN")).toBe(false);
  });
});

const ANIMAL = "http://hl7.org/fhir/StructureDefinition/patient-animal";

/** A synthetic sub-extension of patient-animal, with a made-up code. */
function animalPart(url: string, code: string): Record<string, unknown> {
  return {
    url,
    valueCodeableConcept: {
      coding: [{ system: "http://example.org/fhir/CodeSystem/synthetic-animal", code }],
    },
  };
}

/** The issues the veterinary starter draws on a synthetic Patient with these extensions. */
function veterinaryIssues(extension: unknown): [string, string, string][] {
  const { resource } = parseResource(JSON.stringify({ resourceType: "Patient", extension }));
  const { issues } = validateResource(resource, { profiles: [VETERINARY_PATIENT_STARTER] });
  return issues.map((i: ValidationIssue) => [i.code, i.severity, i.expression]);
}

describe("veterinary Patient starter", () => {
  it("is authored through defineProfile and looked up by url, but is not in the kit", () => {
    expect(VETERINARY_PATIENT_STARTER.url).toBe(
      `${STARTER_PROFILE_BASE_URL}/starter-veterinary-patient`,
    );
    expect(VETERINARY_PATIENT_STARTER.type).toBe("Patient");
    const rebuilt = defineProfile({
      url: VETERINARY_PATIENT_STARTER.url,
      type: VETERINARY_PATIENT_STARTER.type,
      name: "StarterVeterinaryPatient",
      differential: VETERINARY_PATIENT_STARTER.differential ?? [],
    });
    expect(rebuilt).toEqual(VETERINARY_PATIENT_STARTER);
    expect(starterProfile(VETERINARY_PATIENT_STARTER.url)).toBe(VETERINARY_PATIENT_STARTER);
    // In the kit it would report every human Patient as missing the extension.
    expect(STARTER_PROFILES).not.toContain(VETERINARY_PATIENT_STARTER);
  });

  it("pins the extension url and the three parts the extension defines", () => {
    const byId = new Map(
      (VETERINARY_PATIENT_STARTER.differential ?? []).map((e) => [e.id, e] as const),
    );
    const url = byId.get("Patient.extension:animal.url")?.fixed?.value;
    expect(url?.kind === "primitive" ? url.value : undefined).toBe(ANIMAL);
    expect(byId.get("Patient.extension:animal")).toMatchObject({ min: 1, max: 1 });
    expect(byId.get("Patient.extension:animal.extension:species")).toMatchObject({
      min: 1,
      max: 1,
    });
    for (const [part, valueSet] of [
      ["species", "http://hl7.org/fhir/ValueSet/animal-species"],
      ["breed", "http://hl7.org/fhir/ValueSet/animal-breeds"],
      ["genderStatus", "http://hl7.org/fhir/ValueSet/animal-genderstatus"],
    ] as const) {
      const value = byId.get(`Patient.extension:animal.extension:${part}.value[x]`);
      expect(value?.binding).toEqual({ strength: "example", valueSet });
      expect(value?.type).toEqual([{ code: "CodeableConcept" }]);
      expect(value?.min).toBe(1);
    }
    for (const part of ["breed", "genderStatus"]) {
      expect(byId.get(`Patient.extension:animal.extension:${part}`)).toMatchObject({
        min: 0,
        max: 1,
      });
    }
  });

  it("passes a veterinary Patient carrying species, breed and gender status", () => {
    expect(
      veterinaryIssues([
        {
          url: ANIMAL,
          extension: [
            animalPart("species", "syn-species"),
            animalPart("breed", "syn-breed"),
            animalPart("genderStatus", "syn-gender-status"),
          ],
        },
        { url: "http://example.org/fhir/StructureDefinition/synthetic", valueString: "syn" },
      ]),
    ).toEqual([]);
  });

  it("requires the animal extension", () => {
    expect(veterinaryIssues(undefined)).toEqual([
      ["MUST_SUPPORT_ABSENT", "information", "Patient.extension:animal"],
      ["CARDINALITY_MIN", "error", "Patient.extension:animal"],
    ]);
  });

  it("requires species inside it", () => {
    expect(
      veterinaryIssues([{ url: ANIMAL, extension: [animalPart("breed", "syn-breed")] }]),
    ).toContainEqual(["CARDINALITY_MIN", "error", "Patient.extension.extension:species"]);
  });

  it("allows the animal extension once, and breed once", () => {
    const once = { url: ANIMAL, extension: [animalPart("species", "syn-species")] };
    expect(veterinaryIssues([once, once])).toContainEqual([
      "CARDINALITY_MAX",
      "error",
      "Patient.extension:animal",
    ]);
    expect(
      veterinaryIssues([
        {
          url: ANIMAL,
          extension: [
            animalPart("species", "syn-species"),
            animalPart("breed", "syn-breed"),
            animalPart("breed", "syn-breed"),
          ],
        },
      ]),
    ).toContainEqual(["CARDINALITY_MAX", "error", "Patient.extension.extension:breed"]);
  });
});
