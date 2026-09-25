/**
 * Every constraint R4 4.0.1 declares on the eight modeled types, and on the DomainResource, Element
 * and Extension definitions they inherit, is either evaluated or reported unchecked when a resource
 * is validated with no profile.
 *
 * The table is `test/__data__/r4-base-constraints.json`, a projection of the R4 4.0.1
 * StructureDefinitions whose header names each source URL, its sha256 and the projection rule. The
 * question asked of each row is the one a caller depends on: does a document violating the
 * constraint draw a finding carrying its key? A row whose probe draws nothing is a constraint the
 * validator neither checks nor admits to leaving unchecked, which is the gap this suite exists to
 * make impossible to reintroduce in silence.
 *
 * The projection is itself graded, so a lossy one cannot pass by dropping the row that would red:
 * its key set and each key's severity are compared against the 19 keys written out below rather
 * than derived from the file under test. One key is excluded by name, `dom-6`, and the exclusion is
 * held to its reason: it is a `warning`, so it cannot move `valid`, and the projection must keep
 * saying so or this suite goes red.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parseResource, validateResource } from "../src/index.js";

interface ConstraintRow {
  readonly key: string;
  readonly severity: string;
  readonly declaredOn: readonly string[];
  readonly anchors: readonly string[];
  readonly expression: string;
}

interface Projection {
  readonly fhirVersion: string;
  readonly provenance: Readonly<Record<string, { readonly url: string; readonly sha256: string }>>;
  readonly constraints: readonly ConstraintRow[];
}

const PROJECTION = JSON.parse(
  readFileSync(new URL("./__data__/r4-base-constraints.json", import.meta.url), "utf8"),
) as Projection;

/** The eight modeled types plus the three base definitions they inherit constraints from. */
const PROVENANCE_NAMES = [
  "AllergyIntolerance",
  "Condition",
  "DiagnosticReport",
  "Immunization",
  "MedicationRequest",
  "MedicationStatement",
  "Observation",
  "Patient",
  "DomainResource",
  "Element",
  "Extension",
] as const;

/**
 * The 19 keys and their R4 4.0.1 severities, written out independently of the projection: 17 at
 * `error`, `con-3` and `dom-6` at `warning`.
 */
const EXPECTED_SEVERITIES: Readonly<Record<string, "error" | "warning">> = {
  "ait-1": "error",
  "ait-2": "error",
  "con-1": "error",
  "con-2": "error",
  "con-3": "warning",
  "con-4": "error",
  "con-5": "error",
  "dom-2": "error",
  "dom-3": "error",
  "dom-4": "error",
  "dom-5": "error",
  "dom-6": "warning",
  "ele-1": "error",
  "ext-1": "error",
  "imm-1": "error",
  "obs-3": "error",
  "obs-6": "error",
  "obs-7": "error",
  "pat-1": "error",
};

/** The seven keys the always-on safety layer hand-evaluates. */
const SAFETY_OWNED = ["ait-1", "ait-2", "con-3", "con-4", "con-5", "obs-6", "obs-7"] as const;

/** The eleven keys the base-constraint layer evaluates. */
const BASE_EVALUATED = [
  "pat-1",
  "obs-3",
  "con-1",
  "con-2",
  "imm-1",
  "dom-2",
  "dom-3",
  "dom-4",
  "dom-5",
  "ele-1",
  "ext-1",
] as const;

/** The one declared exclusion: a `warning` that cannot move `valid` (see AC-8). */
const EXCLUDED = "dom-6";

const PATIENT_REF = { reference: "Patient/p1" };
const EIE = "entered-in-error";

/**
 * A violating document per key, every value synthetic. The `dom-3` probe carries a `contained`
 * entry, because without one the constraint holds by its own semantics and draws nothing.
 */
const PROBES: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  "ait-1": { resourceType: "AllergyIntolerance", patient: PATIENT_REF },
  "ait-2": {
    resourceType: "AllergyIntolerance",
    patient: PATIENT_REF,
    clinicalStatus: {
      coding: [
        {
          system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical",
          code: "active",
        },
      ],
    },
    verificationStatus: {
      coding: [
        {
          system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",
          code: EIE,
        },
      ],
    },
  },
  "con-3": {
    resourceType: "Condition",
    subject: PATIENT_REF,
    category: [
      {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/condition-category",
            code: "problem-list-item",
          },
        ],
      },
    ],
  },
  "con-4": {
    resourceType: "Condition",
    subject: PATIENT_REF,
    clinicalStatus: {
      coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active" }],
    },
    abatementDateTime: "2020-01-01",
  },
  "con-5": {
    resourceType: "Condition",
    subject: PATIENT_REF,
    clinicalStatus: {
      coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active" }],
    },
    verificationStatus: {
      coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-ver-status", code: EIE }],
    },
  },
  "obs-6": {
    resourceType: "Observation",
    status: "final",
    code: { text: "synthetic" },
    valueString: "synthetic",
    dataAbsentReason: { text: "synthetic" },
  },
  "obs-7": {
    resourceType: "Observation",
    status: "final",
    code: { coding: [{ system: "http://loinc.org", code: "8867-4" }] },
    valueString: "synthetic",
    component: [{ code: { coding: [{ system: "http://loinc.org", code: "8867-4" }] } }],
  },
  "pat-1": { resourceType: "Patient", contact: [{ gender: "other" }] },
  "obs-3": {
    resourceType: "Observation",
    status: "final",
    code: { text: "synthetic" },
    referenceRange: [{ type: { text: "synthetic" } }],
  },
  "con-1": { resourceType: "Condition", subject: PATIENT_REF, stage: [{ type: { text: "x" } }] },
  "con-2": {
    resourceType: "Condition",
    subject: PATIENT_REF,
    evidence: [{ extension: [{ url: "http://example.org/e", valueString: "x" }] }],
  },
  "imm-1": {
    resourceType: "Immunization",
    status: "completed",
    vaccineCode: { text: "synthetic" },
    patient: PATIENT_REF,
    occurrenceDateTime: "2020-01-01",
    education: [{ publicationDate: "2020-01-01" }],
  },
  "dom-2": {
    resourceType: "Patient",
    contained: [
      {
        resourceType: "Practitioner",
        id: "c1",
        contained: [{ resourceType: "Organization", id: "c2" }],
      },
    ],
  },
  "dom-3": {
    resourceType: "Patient",
    contained: [{ resourceType: "Practitioner", id: "c1" }],
    generalPractitioner: [{ reference: "#c1" }],
  },
  "dom-4": {
    resourceType: "Patient",
    contained: [{ resourceType: "Practitioner", id: "c1", meta: { versionId: "2" } }],
  },
  "dom-5": {
    resourceType: "Patient",
    contained: [
      {
        resourceType: "Practitioner",
        id: "c1",
        meta: { security: [{ system: "http://example.org/s", code: "x" }] },
      },
    ],
  },
  "ele-1": { resourceType: "Patient", maritalStatus: {} },
  "ext-1": { resourceType: "Patient", extension: [{ url: "http://example.org/e" }] },
};

/** The constraint keys a probe draws as INVARIANT_VIOLATED or INVARIANT_UNCHECKED. */
function keysDrawnBy(document: Readonly<Record<string, unknown>>): string[] {
  const { resource } = parseResource(JSON.stringify(document));
  return validateResource(resource)
    .issues.filter((i) => i.code === "INVARIANT_VIOLATED" || i.code === "INVARIANT_UNCHECKED")
    .map((i) => i.constraint ?? "");
}

describe("AC-5: the projection is the R4 4.0.1 constraint set of the eight types, losslessly", () => {
  it("AC-5: projects exactly the 19 listed keys, each once", () => {
    const keys = PROJECTION.constraints.map((row) => row.key);
    expect(PROJECTION.fhirVersion).toBe("4.0.1");
    expect(keys).toHaveLength(19);
    expect([...keys].sort()).toEqual(Object.keys(EXPECTED_SEVERITIES).sort());
  });

  it("AC-5: projects each key at the severity R4 4.0.1 declares for it", () => {
    const mismatched = PROJECTION.constraints
      .filter((row) => row.severity !== EXPECTED_SEVERITIES[row.key])
      .map((row) => `${row.key}: ${row.severity}`);
    expect(mismatched, "projected severity differs from the written-out table").toEqual([]);
  });

  it("AC-5: names a source URL and sha256 for each of the eleven definitions, and no other", () => {
    expect(Object.keys(PROJECTION.provenance).sort()).toEqual([...PROVENANCE_NAMES].sort());
  });

  it("AC-5: classifies every key exactly once: safety-owned, base-evaluated, or the one exclusion", () => {
    const classified = [...SAFETY_OWNED, ...BASE_EVALUATED, EXCLUDED];
    expect(new Set(classified).size).toBe(classified.length);
    expect([...classified].sort()).toEqual(Object.keys(EXPECTED_SEVERITIES).sort());
  });

  it("AC-5: defines a probe document for every projected key but the declared exclusion", () => {
    const unprobed = PROJECTION.constraints
      .map((row) => row.key)
      .filter((key) => key !== EXCLUDED && PROBES[key] === undefined);
    expect(unprobed, "projected keys with no probe document").toEqual([]);
  });
});

describe("AC-5 / AC-8: the one exclusion is dom-6, held to its reason", () => {
  it("AC-5: dom-6 is projected, and at warning, which is why it may go unevaluated", () => {
    const row = PROJECTION.constraints.find((r) => r.key === EXCLUDED);
    expect(row, "dom-6 is missing from the projection").toBeDefined();
    expect(row?.severity, "dom-6 is excluded only because it cannot move valid").toBe("warning");
  });
});

describe("AC-5: every projected key but dom-6 draws a finding carrying it with no profile", () => {
  for (const row of PROJECTION.constraints) {
    if (row.key === EXCLUDED) continue;
    it(`AC-5: a document violating ${row.key} draws INVARIANT_VIOLATED or INVARIANT_UNCHECKED`, () => {
      const probe = PROBES[row.key];
      expect(probe, `no probe document for ${row.key}`).toBeDefined();
      expect(keysDrawnBy(probe ?? {}), `${row.key} is neither evaluated nor unchecked`).toContain(
        row.key,
      );
    });
  }

  it("AC-5: the dom-3 probe carries a contained entry, and draws dom-3 unchecked", () => {
    const probe = PROBES["dom-3"] ?? {};
    expect(Array.isArray(probe["contained"]) && probe["contained"].length > 0).toBe(true);
    const { resource } = parseResource(JSON.stringify(probe));
    const dom3 = validateResource(resource).issues.filter((i) => i.constraint === "dom-3");
    expect(dom3.map((i) => [i.code, i.severity])).toEqual([["INVARIANT_UNCHECKED", "information"]]);
  });
});
