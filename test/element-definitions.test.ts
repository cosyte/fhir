/**
 * The safety readout's model of FHIR is held to the FHIR R4 and R4B definitions, so it cannot go
 * stale in silence.
 *
 * The expectation is `test/__data__/fhir-element-definitions.json`, a projection of the R4 4.0.1
 * and R4B 4.3.0 StructureDefinition bundles (`profiles-resources.xml`, `profiles-types.xml`) made by
 * `scripts/element-definitions.mjs` from files pinned by SHA-256. CI fetches those files and
 * re-derives the projection (`pnpm definitions:check`), so the file here is the definitions' own
 * answer, and these tests ask the source the same questions:
 *
 * - the list of resource positions (`RESOURCE_POSITIONS`, `REPEATED_DEFINITIONS`) is exactly the
 *   elements the definitions type as `Resource`, in both releases;
 * - the element table (`ELEMENT_DEFINITIONS`) is exactly the union of what the two releases define
 *   for the ten assessed types and everything below them.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  ELEMENT_DEFINITIONS,
  PRIMITIVE_TARGET,
  RESOURCE_TARGET,
} from "../src/safety/element-definitions.js";
import { REPEATED_DEFINITIONS, RESOURCE_POSITIONS } from "../src/safety/status.js";

type Release = "r4" | "r4b";

interface Projection {
  readonly sources: Record<Release, { readonly version: string }>;
  readonly assessedTypes: readonly string[];
  readonly resourcePositions: Record<Release, readonly string[]>;
  readonly contentReferences: Record<Release, readonly (readonly [string, string])[]>;
  readonly elements: Record<Release, Record<string, Record<string, readonly string[]>>>;
}

const PROJECTION = JSON.parse(
  readFileSync(new URL("./__data__/fhir-element-definitions.json", import.meta.url), "utf8"),
) as Projection;

const RELEASES: readonly Release[] = ["r4", "r4b"];

/** The element table read back into context, name, and the sorted targets in the projection's terms. */
function sourceTable(): Record<string, Record<string, readonly string[]>> {
  const out: Record<string, Record<string, readonly string[]>> = {};
  for (const [context, names] of Object.entries(ELEMENT_DEFINITIONS)) {
    const members: Record<string, readonly string[]> = {};
    for (const token of names.split(" ")) {
      const colon = token.indexOf(":");
      const name = colon < 0 ? token : token.slice(0, colon);
      expect(members[name], `${context}.${name} listed twice`).toBeUndefined();
      const targets = colon < 0 ? [PRIMITIVE_TARGET] : token.slice(colon + 1).split("|");
      members[name] = targets
        .map((target) =>
          target === PRIMITIVE_TARGET
            ? "primitive"
            : target === RESOURCE_TARGET
              ? "Resource"
              : target,
        )
        .sort();
    }
    out[context] = members;
  }
  return out;
}

/** The union of both releases' element tables, targets sorted. */
function projectedUnion(): Record<string, Record<string, readonly string[]>> {
  const out: Record<string, Record<string, string[]>> = {};
  for (const release of RELEASES) {
    for (const [context, members] of Object.entries(PROJECTION.elements[release])) {
      const into = (out[context] ??= {});
      for (const [name, targets] of Object.entries(members)) {
        const list = (into[name] ??= []);
        for (const target of targets) if (!list.includes(target)) list.push(target);
        list.sort();
      }
    }
  }
  return out;
}

describe("the projection the source is checked against", () => {
  it("covers R4 4.0.1 and R4B 4.3.0, from the ten assessed types", () => {
    expect(PROJECTION.sources.r4.version).toBe("4.0.1");
    expect(PROJECTION.sources.r4b.version).toBe("4.3.0");
    expect(PROJECTION.assessedTypes).toEqual([
      "AllergyIntolerance",
      "Bundle",
      "Condition",
      "DiagnosticReport",
      "Immunization",
      "MedicationRequest",
      "MedicationStatement",
      "Observation",
      "Patient",
      "Practitioner",
    ]);
    for (const release of RELEASES) {
      // The projection is graded too, so a lossy one cannot pass by dropping what would red: these
      // facts are read from the specification pages, not from the file.
      const elements = PROJECTION.elements[release];
      expect(elements["Bundle.entry"]?.["resource"], release).toEqual(["Resource"]);
      expect(elements["Bundle.entry.response"]?.["outcome"], release).toEqual(["Resource"]);
      expect(elements["Patient"]?.["contained"], release).toEqual(["Resource"]);
      expect(elements["Observation"]?.["valueQuantity"], release).toEqual(["Quantity"]);
      expect(elements["Observation.component"]?.["code"], release).toEqual(["CodeableConcept"]);
      expect(elements["Patient"]?.["entry"], release).toBeUndefined();
      expect(PROJECTION.resourcePositions[release], release).toContain(
        "Parameters.parameter.resource",
      );
    }
  });
});

describe("the resource positions match the R4 and R4B definitions", () => {
  for (const release of RELEASES) {
    it(`every element ${release} types as Resource, and nothing else`, () => {
      const projected = PROJECTION.resourcePositions[release];
      // Every `contained` the definitions list is the one each resource type inherits from
      // `DomainResource`, which the source names once.
      const contained = projected.filter((position) => position.endsWith(".contained"));
      expect(contained).toContain("DomainResource.contained");
      for (const position of contained) expect(position.split(".")).toHaveLength(2);
      const others = projected.filter((position) => !position.endsWith(".contained"));
      expect([...RESOURCE_POSITIONS].sort()).toEqual(
        [...others, "DomainResource.contained"].sort(),
      );
    });

    it(`every ${release} element that repeats one holding a resource position`, () => {
      expect(REPEATED_DEFINITIONS.map(([from, to]) => [from, to])).toEqual(
        PROJECTION.contentReferences[release].map(([from, to]) => [from, to]),
      );
    });
  }
});

describe("the element table matches the R4 and R4B definitions", () => {
  it("lists exactly what either release defines, for every context", () => {
    const source = sourceTable();
    const union = projectedUnion();
    expect(Object.keys(source).sort()).toEqual(Object.keys(union).sort());
    for (const context of Object.keys(union)) {
      expect(source[context], context).toEqual(union[context]);
    }
  });

  it("puts a resource below exactly the positions the definitions type as Resource", () => {
    const source = sourceTable();
    const positions = new Set(RELEASES.flatMap((release) => PROJECTION.resourcePositions[release]));
    for (const [context, members] of Object.entries(source)) {
      for (const [name, targets] of Object.entries(members)) {
        expect(targets.includes("Resource"), `${context}.${name}`).toBe(
          positions.has(`${context}.${name}`),
        );
      }
    }
  });
});
