import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { buildRegistry } from "../src/index.js";

/**
 * The value set each built-in element table names on a required binding. A profile's binding to
 * that value set counts as checked by the structure layer's enumeration, so a wrong name would let
 * a nested profile check affirm a binding nobody checked. The tables are built once, when the
 * module loads, so the mutation runner cannot judge an edit to them; this test pins every entry
 * instead, against the R4 4.0.1 definitions this repository vendors, and fails when any entry is
 * changed, added or removed.
 */

interface Projection {
  readonly types: Readonly<
    Record<
      string,
      {
        readonly elements: readonly {
          readonly path: string;
          readonly types?: readonly string[];
          readonly binding?: { readonly strength: string; readonly valueSet: string };
        }[];
      }
    >
  >;
}

const read = (name: string): Projection =>
  JSON.parse(readFileSync(new URL(`./__data__/${name}`, import.meta.url), "utf8")) as Projection;

const VENDORED = [read("r4-direct-elements.json"), read("r4-direct-elements-exchange.json")];

/**
 * The two built-in types the vendored projections do not carry, as R4 4.0.1 binds them
 * (patient.html, observation.html): each has one required binding on a `code` element.
 */
const NOT_VENDORED: Readonly<Record<string, string>> = {
  "Patient.gender": "http://hl7.org/fhir/ValueSet/administrative-gender",
  "Observation.status": "http://hl7.org/fhir/ValueSet/observation-status",
};

/** Every built-in type, in the order the registry's table lists them. */
const BUILT_IN = [
  "Patient",
  "Observation",
  "DiagnosticReport",
  "Condition",
  "MedicationRequest",
  "AllergyIntolerance",
  "Immunization",
  "MedicationStatement",
  "Encounter",
  "Procedure",
  "DocumentReference",
];

/** What R4 binds at required strength on a direct `code` element, by `Type.element`, unversioned. */
function expected(): Record<string, string> {
  const out: Record<string, string> = { ...NOT_VENDORED };
  for (const projection of VENDORED) {
    for (const [type, { elements }] of Object.entries(projection.types)) {
      for (const element of elements) {
        const tail = element.path.slice(type.length + 1);
        if (!element.path.startsWith(`${type}.`) || tail.includes(".")) continue;
        if (element.binding?.strength !== "required") continue;
        if (!(element.types ?? []).includes("code")) continue;
        out[element.path] = element.binding.valueSet.replace(/\|4\.0\.1$/u, "");
      }
    }
  }
  return out;
}

describe("the value set each built-in required binding names", () => {
  it("is the one R4 binds there, for every bound element of every built-in table", () => {
    const registry = buildRegistry();
    const actual: Record<string, string | undefined> = {};
    for (const type of BUILT_IN) {
      const schema = registry(type);
      expect(schema, `${type}: no built-in table`).toBeDefined();
      for (const [name, element] of Object.entries(schema?.elements ?? {})) {
        if (element.binding !== undefined) actual[`${type}.${name}`] = element.binding.valueSet;
      }
    }
    const want = expected();
    // Nine projected types and the two above, fifteen bindings in all at R4 4.0.1.
    expect(Object.keys(want)).toHaveLength(15);
    expect(actual).toEqual(want);
  });
});
