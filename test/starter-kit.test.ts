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
  VITAL_SIGN_OBSERVATION_STARTER,
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

/** A synthetic Observation whose only category is laboratory — the required VSCat slice is absent. */
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
 * A synthetic vital-sign Observation that *also* carries a laboratory category — a conformant instance
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
    // Re-running defineProfile against a starter's own reconstructed spec yields the same object —
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
    // must-support-absent (information — the load-bearing rule) and cardinality-min (error).
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
