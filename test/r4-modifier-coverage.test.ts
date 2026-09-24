/**
 * Every resource-level modifier element R4 defines on the eight types this library's safety layer
 * models reaches a channel of the safety readout.
 *
 * The table is `test/__data__/r4-modifier-elements.json`, a projection of the R4 4.0.1
 * StructureDefinitions whose header names each source URL, its sha256 and the projection rule. The
 * question asked of each row is the one a caller depends on: does a minimal document carrying the
 * element read differently from the same document without it? A row whose two readouts are
 * deep-equal is a modifier the readout cannot see, which is the class of gap this suite exists to
 * make impossible to reintroduce in silence.
 *
 * The projection is itself graded, so a lossy one cannot pass by dropping the row that would red:
 * its `path` set is compared against the 31 paths the specification lists, written out below
 * rather than derived from the file under test.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parseResource, readSafety, type SafetyReadout } from "../src/index.js";

interface ModifierRow {
  readonly type: string;
  readonly path: string;
  readonly isModifierReason: string | null;
}

interface Projection {
  readonly fhirVersion: string;
  readonly provenance: Readonly<Record<string, { readonly url: string; readonly sha256: string }>>;
  readonly elements: readonly ModifierRow[];
}

const PROJECTION = JSON.parse(
  readFileSync(new URL("./__data__/r4-modifier-elements.json", import.meta.url), "utf8"),
) as Projection;

/** The eight modeled types: the seven safety-critical resource types plus Patient. */
const MODELED_TYPES = [
  "AllergyIntolerance",
  "Condition",
  "DiagnosticReport",
  "Immunization",
  "MedicationRequest",
  "MedicationStatement",
  "Observation",
  "Patient",
] as const;

/**
 * The 31 resource-level isModifier paths of those eight types, written out independently of the
 * projection: `implicitRules` and `modifierExtension` on each type, plus fifteen type-specific ones.
 */
const EXPECTED_PATHS: readonly string[] = [
  ...MODELED_TYPES.flatMap((type) => [`${type}.implicitRules`, `${type}.modifierExtension`]),
  "AllergyIntolerance.clinicalStatus",
  "AllergyIntolerance.verificationStatus",
  "Condition.clinicalStatus",
  "Condition.verificationStatus",
  "DiagnosticReport.status",
  "Immunization.status",
  "Immunization.isSubpotent",
  "MedicationRequest.status",
  "MedicationRequest.intent",
  "MedicationRequest.doNotPerform",
  "MedicationStatement.status",
  "Observation.status",
  "Patient.active",
  "Patient.deceased[x]",
  "Patient.link",
];

/**
 * The members a probe document adds to `{"resourceType": <type>}`, keyed by the projected path. A
 * status gets a code the readout surfaces, a CodeableConcept status a coding from the preferred
 * system, `doNotPerform` `true`. Every value is synthetic.
 */
const PROBES: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  ...Object.fromEntries(
    MODELED_TYPES.flatMap((type) => [
      [`${type}.implicitRules`, { implicitRules: "http://example.org/implicit-rules" }],
      [`${type}.modifierExtension`, { modifierExtension: [{ url: "http://example.org/modifier" }] }],
    ]),
  ),
  "AllergyIntolerance.clinicalStatus": {
    clinicalStatus: {
      coding: [
        {
          system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical",
          code: "active",
        },
      ],
    },
  },
  "AllergyIntolerance.verificationStatus": {
    verificationStatus: {
      coding: [
        {
          system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",
          code: "confirmed",
        },
      ],
    },
  },
  "Condition.clinicalStatus": {
    clinicalStatus: {
      coding: [
        { system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active" },
      ],
    },
  },
  "Condition.verificationStatus": {
    verificationStatus: {
      coding: [
        { system: "http://terminology.hl7.org/CodeSystem/condition-ver-status", code: "confirmed" },
      ],
    },
  },
  "DiagnosticReport.status": { status: "final" },
  "Immunization.status": { status: "completed" },
  "Immunization.isSubpotent": { isSubpotent: true },
  "MedicationRequest.status": { status: "active" },
  "MedicationRequest.intent": { intent: "order" },
  "MedicationRequest.doNotPerform": { doNotPerform: true },
  "MedicationStatement.status": { status: "active" },
  "Observation.status": { status: "final" },
  "Patient.active": { active: true },
  "Patient.deceased[x]": { deceasedBoolean: true },
  "Patient.link": {
    link: [{ other: { reference: "Patient/example-other" }, type: "replaced-by" }],
  },
};

/** The readout of a JSON document built from `members` on a bare resource of `type`. */
function readoutOf(type: string, members: Readonly<Record<string, unknown>>): SafetyReadout {
  return readSafety(parseResource(JSON.stringify({ resourceType: type, ...members })).resource);
}

describe("AC-13: the projection is the R4 4.0.1 resource-level isModifier set, losslessly", () => {
  it("AC-13: projects exactly the 31 listed paths, verbatim, each once", () => {
    const paths = PROJECTION.elements.map((row) => row.path);
    expect(PROJECTION.fhirVersion).toBe("4.0.1");
    expect(paths).toHaveLength(EXPECTED_PATHS.length);
    expect([...paths].sort()).toEqual([...EXPECTED_PATHS].sort());
  });

  it("AC-13: names a source URL and sha256 for each of the eight types, and no other", () => {
    expect(Object.keys(PROJECTION.provenance).sort()).toEqual([...MODELED_TYPES].sort());
  });

  it("AC-13: defines a probe document for every projected element", () => {
    const unprobed = PROJECTION.elements
      .map((row) => row.path)
      .filter((path) => PROBES[path] === undefined);
    expect(unprobed, "projected elements with no probe document").toEqual([]);
  });
});

describe("AC-13: every resource-level modifier element reaches a readout channel", () => {
  for (const row of PROJECTION.elements) {
    it(`AC-13: ${row.path} changes the readout of a minimal ${row.type}`, () => {
      const members = PROBES[row.path];
      expect(members, `no probe document for ${row.path}`).toBeDefined();
      const carrying = readoutOf(row.type, members ?? {});
      const without = readoutOf(row.type, {});
      expect(carrying, `${row.path} reaches no readout channel`).not.toEqual(without);
    });
  }
});
