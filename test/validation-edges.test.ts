/**
 * The validator at its edges: terminology over every shape a coded element arrives in, supplied
 * profiles of another type or needing their base, the base-constraint walk past a type marker, and
 * a caller schema element that names no type.
 *
 * FIXTURES ARE SYNTHETIC: made-up codes, references and values, and no person, name, date of birth
 * or address.
 */
import { describe, expect, it } from "vitest";

import {
  collectTerminologyIssues,
  complex,
  ICD10CM_SYSTEM,
  list,
  loadStructureDefinition,
  parseResource,
  primitive,
  resolveElement,
  RXNORM_SYSTEM,
  validateResource,
  type FhirComplex,
  type StructureDefinition,
} from "../src/index.js";
import { req } from "./_util.js";

function parse(obj: unknown): FhirComplex {
  return parseResource(JSON.stringify(obj)).resource;
}

function loadSd(obj: unknown): StructureDefinition {
  return req(loadStructureDefinition(parse(obj)));
}

function allergy(code: FhirComplex | ReturnType<typeof primitive>): FhirComplex {
  return complex([
    { name: "resourceType", value: primitive("AllergyIntolerance") },
    { name: "code", value: code },
  ]);
}

function coding(system: string, code: string): FhirComplex {
  return complex([
    { name: "system", value: primitive(system) },
    { name: "code", value: primitive(code) },
  ]);
}

describe("terminology over every shape a coded element arrives in", () => {
  it("locates a single coding object without an index", () => {
    const issues = collectTerminologyIssues(
      allergy(complex([{ name: "coding", value: coding(ICD10CM_SYSTEM, "T78.40") }])),
      "AllergyIntolerance",
    );
    expect(issues.map((i) => [i.code, i.severity, i.expression])).toEqual([
      ["CODE_SYSTEM_UNEXPECTED", "warning", "AllergyIntolerance.code.coding.system"],
    ]);
  });

  it("skips a coding entry that is not an object and indexes the rest", () => {
    const issues = collectTerminologyIssues(
      allergy(
        complex([
          { name: "coding", value: list([primitive("stray"), coding(ICD10CM_SYSTEM, "T78.40")]) },
        ]),
      ),
      "AllergyIntolerance",
    );
    expect(issues.map((i) => i.expression)).toEqual(["AllergyIntolerance.code.coding[1].system"]);
  });

  it("reads nothing from a coded element written as a bare string", () => {
    expect(collectTerminologyIssues(allergy(primitive("T78.40")), "AllergyIntolerance")).toEqual(
      [],
    );
  });

  it("asks the service only about an expected system, and records its answer", () => {
    const asked: string[] = [];
    const issues = collectTerminologyIssues(
      allergy(complex([{ name: "coding", value: coding(RXNORM_SYSTEM, "0000000") }])),
      "AllergyIntolerance",
      {
        terminology: {
          validateCode: ({ code }) => {
            asked.push(code);
            return { membership: "not-in" };
          },
        },
      },
    );
    expect(asked).toEqual(["0000000"]);
    expect(issues.map((i) => [i.code, i.severity, i.expression])).toEqual([
      ["CODE_NOT_IN_VALUESET", "error", "AllergyIntolerance.code.coding"],
    ]);
  });
});

describe("supplied profiles: type gating and base resolution", () => {
  const base = loadSd({
    resourceType: "StructureDefinition",
    url: "http://example.org/StructureDefinition/obs-base",
    type: "Observation",
    snapshot: {
      element: [
        { id: "Observation", path: "Observation" },
        { id: "Observation.issued", path: "Observation.issued" },
      ],
    },
  });
  const needsIssued = loadSd({
    resourceType: "StructureDefinition",
    url: "http://example.org/StructureDefinition/obs-issued",
    type: "Observation",
    baseDefinition: base.url,
    differential: { element: [{ id: "Observation.issued", path: "Observation.issued", min: 1 }] },
  });
  const patientProfile = loadSd({
    resourceType: "StructureDefinition",
    url: "http://example.org/StructureDefinition/pat",
    type: "Patient",
    snapshot: {
      element: [
        { id: "Patient", path: "Patient" },
        { id: "Patient.gender", path: "Patient.gender", min: 1 },
      ],
    },
  });
  const observation = parse({
    resourceType: "Observation",
    status: "final",
    code: { text: "synthetic" },
  });

  it("applies a differential-only profile through resolveBase, and skips a profile of another type", () => {
    const result = validateResource(observation, {
      profiles: [patientProfile, needsIssued],
      resolveBase: (url) => (url === base.url ? base : undefined),
    });
    expect(result.issues.map((i) => [i.code, i.expression])).toEqual([
      ["CARDINALITY_MIN", "Observation.issued"],
    ]);
  });
});

describe("the base-constraint walk past a type marker", () => {
  it("does not hold a resourceType member inside an element to ele-1, as it does any other member", () => {
    const marker = parse({
      resourceType: "Observation",
      status: "final",
      code: { text: "synthetic", _resourceType: { id: "r1" } },
    });
    expect(validateResource(marker).issues).toEqual([]);

    const other = parse({
      resourceType: "Observation",
      status: "final",
      code: { text: "synthetic", _other: { id: "r1" } },
    });
    expect(validateResource(other).issues.map((i) => [i.code, i.expression, i.constraint])).toEqual(
      [["INVARIANT_VIOLATED", "Observation.code.other", "ele-1"]],
    );
  });
});

describe("resolveElement over a caller schema element that names no type", () => {
  it("resolves the element with an empty datatype rather than failing", () => {
    const resolved = resolveElement({ note: { min: 0, max: 1, types: [] } }, "note");
    expect(resolved).toEqual({
      element: { min: 0, max: 1, types: [] },
      datatype: "",
      base: "note",
    });
  });
});
