import { describe, expect, it } from "vitest";

import {
  FhirProfileError,
  generateSnapshot,
  loadStructureDefinition,
  parseResource,
  snapshotElements,
  type BaseResolver,
  type StructureDefinition,
} from "../src/index.js";
import { req } from "./_util.js";

function loadSd(obj: unknown): StructureDefinition {
  return req(loadStructureDefinition(parseResource(JSON.stringify(obj)).resource));
}

const base = loadSd({
  resourceType: "StructureDefinition",
  url: "http://hl7.org/fhir/StructureDefinition/Observation",
  type: "Observation",
  kind: "resource",
  derivation: "specialization",
  snapshot: {
    element: [
      { id: "Observation", path: "Observation" },
      { id: "Observation.status", path: "Observation.status", min: 1, max: "1" },
      { id: "Observation.category", path: "Observation.category", min: 0, max: "*" },
      { id: "Observation.code", path: "Observation.code", min: 1, max: "1" },
    ],
  },
});

const profile = loadSd({
  resourceType: "StructureDefinition",
  url: "http://example.org/StructureDefinition/vitals",
  version: "1.0.0",
  type: "Observation",
  derivation: "constraint",
  baseDefinition: base.url,
  differential: {
    element: [
      {
        id: "Observation.category",
        path: "Observation.category",
        min: 1,
        slicing: { discriminator: [{ type: "pattern", path: "$this" }], rules: "open" },
      },
      {
        id: "Observation.category:VSCat",
        path: "Observation.category",
        sliceName: "VSCat",
        min: 1,
        patternCodeableConcept: { coding: [{ code: "vital-signs" }] },
      },
      { id: "Observation.status", path: "Observation.status", mustSupport: true },
    ],
  },
});

const resolve: BaseResolver = (url) => (url === base.url ? base : undefined);

describe("generateSnapshot — differential merged onto the base snapshot", () => {
  const snapshot = generateSnapshot(profile, resolve);

  it("tightens a matched base element in place (status gains mustSupport)", () => {
    const status = req(snapshot.find((e) => e.id === "Observation.status"));
    expect(status.mustSupport).toBe(true);
    expect(status.min).toBe(1); // base cardinality preserved
  });

  it("applies constraints to the sliced element and keeps base fields", () => {
    const category = req(
      snapshot.find((e) => e.id === "Observation.category" && e.sliceName === undefined),
    );
    expect(category.min).toBe(1); // tightened
    expect(category.slicing?.discriminator[0]).toEqual({ type: "pattern", path: "$this" });
  });

  it("inserts a new slice element right after its sliced base element", () => {
    const catIdx = snapshot.findIndex((e) => e.id === "Observation.category");
    const sliceIdx = snapshot.findIndex((e) => e.id === "Observation.category:VSCat");
    expect(sliceIdx).toBe(catIdx + 1);
    expect(req(snapshot[sliceIdx]).sliceName).toBe("VSCat");
  });

  it("leaves untouched base elements present and in order", () => {
    expect(snapshot.map((e) => e.id)).toEqual([
      "Observation",
      "Observation.status",
      "Observation.category",
      "Observation.category:VSCat",
      "Observation.code",
    ]);
  });
});

describe("snapshotElements", () => {
  it("prefers a profile's own snapshot when present (no resolver needed)", () => {
    const snapshotted = loadSd({
      resourceType: "StructureDefinition",
      url: "http://x",
      type: "Observation",
      snapshot: {
        element: [{ id: "Observation.status", path: "Observation.status", min: 1, max: "1" }],
      },
    });
    expect(snapshotElements(snapshotted).map((e) => e.id)).toEqual(["Observation.status"]);
  });

  it("generates when the profile carries only a differential", () => {
    expect(
      snapshotElements(profile, resolve).some((e) => e.id === "Observation.category:VSCat"),
    ).toBe(true);
  });
});

describe("generateSnapshot — fail-safe", () => {
  it("throws FhirProfileError when the base cannot be resolved", () => {
    expect(() => generateSnapshot(profile, () => undefined)).toThrow(FhirProfileError);
  });

  it("throws FhirProfileError on a baseDefinition cycle", () => {
    const a = loadSd({
      resourceType: "StructureDefinition",
      url: "http://a",
      type: "Observation",
      baseDefinition: "http://b",
      differential: { element: [] },
    });
    const b = loadSd({
      resourceType: "StructureDefinition",
      url: "http://b",
      type: "Observation",
      baseDefinition: "http://a",
      differential: { element: [] },
    });
    const cyclic: BaseResolver = (url) =>
      url === "http://a" ? a : url === "http://b" ? b : undefined;
    expect(() => generateSnapshot(a, cyclic)).toThrow(/cycle/);
  });

  it("treats a specialization root with no base as its own differential", () => {
    const root = loadSd({
      resourceType: "StructureDefinition",
      url: "http://root",
      type: "Basic",
      differential: { element: [{ id: "Basic.code", path: "Basic.code", min: 1, max: "1" }] },
    });
    expect(generateSnapshot(root, () => undefined).map((e) => e.id)).toEqual(["Basic.code"]);
  });
});
