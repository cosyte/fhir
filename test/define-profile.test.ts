import { describe, expect, it } from "vitest";

import {
  defineProfile,
  InvalidProfileError,
  UNBOUNDED,
  complex,
  list,
  loadStructureDefinition,
  parseResource,
  primitive,
  validateResource,
  type ProfileSpec,
} from "../src/index.js";
import { req } from "./_util.js";

describe("defineProfile: authoring", () => {
  it("builds a StructureDefinition the engine consumes", () => {
    const sd = defineProfile({
      url: "http://example.org/StructureDefinition/final-observation",
      type: "Observation",
      differential: [
        { path: "Observation.status", fixed: { type: "Code", value: primitive("final") } },
      ],
    });
    expect(sd.url).toBe("http://example.org/StructureDefinition/final-observation");
    expect(sd.type).toBe("Observation");
    const el = req(sd.differential?.[0]);
    expect(el.path).toBe("Observation.status");
    expect(el.id).toBe("Observation.status"); // id defaults to path
    expect(req(el.fixed).type).toBe("Code");
  });

  it("normalizes max '*' to UNBOUNDED and a numeric max verbatim", () => {
    const sd = defineProfile({
      url: "http://x",
      type: "Observation",
      differential: [
        { path: "Observation.category", min: 1, max: "*" },
        { path: "Observation.status", min: 1, max: 1 },
      ],
    });
    expect(req(sd.differential?.[0]).max).toBe(UNBOUNDED);
    expect(req(sd.differential?.[1]).max).toBe(1);
  });

  it("derives a sliceName from the element id and defaults a constraint severity to error", () => {
    const sd = defineProfile({
      url: "http://x",
      type: "Observation",
      differential: [
        { path: "Observation.category", id: "Observation.category:VSCat" },
        {
          path: "Observation.status",
          constraint: [{ key: "obs-x", expression: "status.exists()" }],
        },
      ],
    });
    expect(req(sd.differential?.[0]).sliceName).toBe("VSCat");
    expect(req(req(sd.differential?.[1]).constraint)[0]).toEqual({
      key: "obs-x",
      severity: "error",
      expression: "status.exists()",
    });
  });

  it("throws InvalidProfileError on a malformed spec (the conservative-writer guard)", () => {
    expect(() => defineProfile({ url: "", type: "Patient" })).toThrow(InvalidProfileError);
    expect(() => defineProfile({ url: "http://x", type: "" })).toThrow(InvalidProfileError);
    expect(() =>
      defineProfile({ url: "http://x", type: "Patient", differential: [{ path: "" }] }),
    ).toThrow(InvalidProfileError);
    expect(() =>
      defineProfile({
        url: "http://x",
        type: "Patient",
        differential: [{ path: "Patient.name", min: -1 }],
      }),
    ).toThrow(/non-negative integer/);
    expect(() =>
      defineProfile({
        url: "http://x",
        type: "Patient",
        differential: [{ path: "Patient.name", min: 2, max: 1 }],
      }),
    ).toThrow(/below its min/);
    expect(() =>
      defineProfile({
        url: "http://x",
        type: "Patient",
        differential: [{ path: "Patient.name", max: 1.5 }],
      }),
    ).toThrow(/non-negative integer/);
  });

  it("keeps its diagnostics value-free (profile metadata only)", () => {
    try {
      defineProfile({
        url: "http://x",
        type: "Patient",
        differential: [{ path: "Patient.name", min: 2, max: 1 }],
      });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidProfileError);
      expect((e as InvalidProfileError).message).toContain("Patient.name");
    }
  });
});

describe("defineProfile: dogfoods the public path (no privileged internal shape)", () => {
  it("produces the same model as loadStructureDefinition on the equivalent JSON", () => {
    // One profile authored two ways: programmatically, and as raw StructureDefinition JSON read back
    // through the codec. They must converge on an identical StructureDefinition, the whole point of
    // the growth loop is that a built-in profile and a user's profile are the same kind of object.
    const spec: ProfileSpec = {
      url: "http://example.org/StructureDefinition/example",
      version: "1.2.3",
      name: "Example",
      type: "Observation",
      kind: "resource",
      derivation: "constraint",
      baseDefinition: "http://hl7.org/fhir/StructureDefinition/Observation",
      differential: [
        { path: "Observation.status", min: 1, max: 1, mustSupport: true },
        {
          path: "Observation.category",
          min: 1,
          max: "*",
          slicing: { discriminator: [{ type: "pattern", path: "$this" }], rules: "open" },
          binding: { strength: "extensible", valueSet: "http://vs" },
          type: [{ code: "CodeableConcept" }],
        },
        {
          path: "Observation.category",
          id: "Observation.category:VSCat",
          pattern: {
            type: "CodeableConcept",
            value: complex([
              {
                name: "coding",
                value: list([
                  complex([
                    { name: "system", value: primitive("http://s") },
                    { name: "code", value: primitive("vital-signs") },
                  ]),
                ]),
              },
            ]),
          },
        },
        {
          path: "Observation.code",
          fixed: {
            type: "CodeableConcept",
            value: complex([{ name: "text", value: primitive("BP") }]),
          },
        },
        {
          path: "Observation.value[x]",
          constraint: [
            {
              key: "ex-1",
              severity: "warning",
              human: "must have a value",
              expression: "value.exists()",
            },
          ],
        },
      ],
    };

    const authored = defineProfile(spec);

    const json = {
      resourceType: "StructureDefinition",
      url: "http://example.org/StructureDefinition/example",
      version: "1.2.3",
      name: "Example",
      type: "Observation",
      kind: "resource",
      derivation: "constraint",
      baseDefinition: "http://hl7.org/fhir/StructureDefinition/Observation",
      differential: {
        element: [
          {
            id: "Observation.status",
            path: "Observation.status",
            min: 1,
            max: "1",
            mustSupport: true,
          },
          {
            id: "Observation.category",
            path: "Observation.category",
            min: 1,
            max: "*",
            slicing: { discriminator: [{ type: "pattern", path: "$this" }], rules: "open" },
            binding: { strength: "extensible", valueSet: "http://vs" },
            type: [{ code: "CodeableConcept" }],
          },
          {
            id: "Observation.category:VSCat",
            path: "Observation.category",
            patternCodeableConcept: { coding: [{ system: "http://s", code: "vital-signs" }] },
          },
          {
            id: "Observation.code",
            path: "Observation.code",
            fixedCodeableConcept: { text: "BP" },
          },
          {
            id: "Observation.value[x]",
            path: "Observation.value[x]",
            constraint: [
              {
                key: "ex-1",
                severity: "warning",
                human: "must have a value",
                expression: "value.exists()",
              },
            ],
          },
        ],
      },
    };
    const loaded = req(loadStructureDefinition(parseResource(JSON.stringify(json)).resource));

    expect(authored).toEqual(loaded);
  });
});

describe("defineProfile: flows into validateResource", () => {
  it("a fixed[x] authored in code flags a mismatching instance", () => {
    const profile = defineProfile({
      url: "http://x",
      type: "Observation",
      differential: [
        { path: "Observation.status", fixed: { type: "Code", value: primitive("final") } },
      ],
    });
    const { resource } = parseResource(
      '{"resourceType":"Observation","status":"preliminary","code":{"text":"x"}}',
    );
    const { issues } = validateResource(resource, { profiles: [profile] });
    expect(issues.some((i) => i.code === "PROFILE_FIXED_MISMATCH")).toBe(true);
  });
});
