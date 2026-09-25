/**
 * The US Core 6.1.0 and 9.0.0 constraint projection, how the bounded FHIRPath subset classifies it,
 * and what the profile layer now decides from it.
 *
 * Every constraint expression used below is read out of the committed projection
 * (`test/__data__/uscore-constraints.json`) by its (version, profile, element, key), never retyped,
 * so a test exercises US Core's expression exactly as published.
 *
 * FIXTURES ARE SYNTHETIC throughout: coded values from the public LOINC, SNOMED CT and UCUM
 * vocabularies, reserved `example.org` hosts, and no person, name, date of birth or address.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  classifyProjection,
  EXPECTATION_PATH,
  loadProjection,
  reportLines,
  totalsOf,
  type ClassificationExpectation,
  type ProjectedConstraint,
} from "../scripts/uscore-classify.js";
import {
  evaluateInvariant,
  getProperty,
  isComplex,
  isList,
  loadStructureDefinition,
  parseResource,
  validateResource,
  type FhirComplex,
  type StructureDefinition,
} from "../src/index.js";
import { req } from "./_util.js";

const PROJECTION = loadProjection();

function parse(obj: unknown): FhirComplex {
  return parseResource(JSON.stringify(obj)).resource;
}

/** The one projected row with this identity; throws rather than matching nothing or two. */
function row(version: string, profile: string, element: string, key: string): ProjectedConstraint {
  const found = PROJECTION.constraints.filter(
    (r) => r.version === version && r.profile === profile && r.element === element && r.key === key,
  );
  if (found.length !== 1) {
    throw new Error(`the projection carries ${String(found.length)} row(s) for ${key}, expected 1`);
  }
  return found[0] as ProjectedConstraint;
}

/** A caller-supplied profile carrying exactly the given projected rows, at their own elements. */
function profileFrom(rows: readonly ProjectedConstraint[]): StructureDefinition {
  const first = req(rows[0]);
  const elements = new Map<string, { id: string; path: string; constraint: unknown[] }>([
    [first.type, { id: first.type, path: first.type, constraint: [] }],
  ]);
  for (const r of rows) {
    const element = elements.get(r.element) ?? { id: r.element, path: r.path, constraint: [] };
    element.constraint.push({
      key: r.key,
      severity: r.severity,
      human: "projected",
      expression: r.expression,
    });
    elements.set(r.element, element);
  }
  return req(
    loadStructureDefinition(
      parse({
        resourceType: "StructureDefinition",
        url: `http://example.org/StructureDefinition/${first.profile}-${first.version}`,
        type: first.type,
        snapshot: { element: [...elements.values()] },
      }),
    ),
  );
}

/** `[code, severity]` of every finding carrying `key`. */
function findingsFor(resource: FhirComplex, profile: StructureDefinition, key: string) {
  return validateResource(resource, { profiles: [profile] })
    .issues.filter((i) => i.constraint === key)
    .map((i) => [i.code, i.severity]);
}

const UCUM = "http://unitsofmeasure.org";

function observation(extra: Record<string, unknown>): FhirComplex {
  return parse({
    resourceType: "Observation",
    status: "final",
    code: { coding: [{ system: "http://loinc.org", code: "2339-0" }] },
    ...extra,
  });
}

describe("AC-1: the committed projection of the US Core constraints", () => {
  // Written here independently of the file: what the two packages carry, counted by hand from the
  // resource profiles' differentials. The projection is graded against this, never trusted.
  const EXPECTED: Readonly<Record<string, { rows: number; keys: readonly string[] }>> = {
    "6.1.0": {
      rows: 29,
      keys: [
        "pd-1",
        "provenance-1",
        "us-core-1",
        "us-core-10",
        "us-core-13",
        "us-core-14",
        "us-core-15",
        "us-core-16",
        "us-core-17",
        "us-core-18",
        "us-core-19",
        "us-core-2",
        "us-core-20",
        "us-core-21",
        "us-core-3",
        "us-core-4",
        "us-core-5",
        "us-core-6",
        "us-core-7",
        "us-core-8",
        "us-core-9",
      ],
    },
    "9.0.0": {
      rows: 34,
      keys: [
        "pd-1",
        "provenance-1",
        "us-core-1",
        "us-core-10",
        "us-core-13",
        "us-core-14",
        "us-core-15",
        "us-core-16",
        "us-core-17",
        "us-core-18",
        "us-core-19",
        "us-core-2",
        "us-core-20",
        "us-core-21",
        "us-core-22",
        "us-core-24",
        "us-core-25",
        "us-core-26",
        "us-core-27",
        "us-core-3",
        "us-core-4",
        "us-core-5",
        "us-core-6",
        "us-core-7",
        "us-core-8",
        "us-core-9",
      ],
    },
  };

  it("names each package by URL and sha256, and the licence the packages carry", () => {
    expect(PROJECTION.packages).toEqual({
      "6.1.0": {
        url: "https://packages.fhir.org/hl7.fhir.us.core/6.1.0",
        bytes: 1606342,
        sha256: "ec096f29bc4ce8f04117dfc4ef82e7289c67a7e2188892e86288c45389d158d9",
      },
      "9.0.0": {
        url: "https://packages.fhir.org/hl7.fhir.us.core/9.0.0",
        bytes: 2749959,
        sha256: "d7b54d2ec2a48cea94ffea5d939ad67a681f80b94d69594a08cebac36da9e059",
      },
    });
    expect(PROJECTION.licence).toBe("CC0-1.0");
    expect(PROJECTION.fhirVersion).toBe("4.0.1");
    expect(PROJECTION.note).toContain("never shipped");
    expect(PROJECTION.rule).toContain("derivation 'constraint'");
  });

  for (const [version, expected] of Object.entries(EXPECTED)) {
    it(`carries ${String(expected.rows)} rows for ${version}, with exactly the expected key set`, () => {
      const rows = PROJECTION.constraints.filter((r) => r.version === version);
      expect(rows.length).toBe(expected.rows);
      expect([...new Set(rows.map((r) => r.key))].sort()).toEqual([...expected.keys].sort());
    });
  }

  it("carries one row per (version, profile, element, key), each with key, severity and expression", () => {
    const ids = PROJECTION.constraints.map(
      (r) => `${r.version}|${r.profile}|${r.element}|${r.key}`,
    );
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of PROJECTION.constraints) {
      expect(["error", "warning"]).toContain(r.severity);
      expect(r.expression.length).toBeGreaterThan(0);
    }
    expect(PROJECTION.constraints.length).toBe(63);
  });

  it("holds the expressions byte-identical to the published profiles, as quoted from them", () => {
    // Quoted from the published US Core profile JSON, independently of the projection file.
    expect(
      row("6.1.0", "us-core-observation-clinical-result", "Observation.value[x]", "us-core-3")
        .expression,
    ).toBe(
      "value.ofType(Quantity).system.empty() or value.ofType(Quantity).system = 'http://unitsofmeasure.org'",
    );
    expect(
      row("9.0.0", "us-core-observation-clinical-result", "Observation.value[x]", "us-core-3")
        .expression,
    ).toBe(
      "ofType(Quantity).system.empty() or ofType(Quantity).system = 'http://unitsofmeasure.org'",
    );
    expect(
      row("6.1.0", "us-core-observation-clinical-result", "Observation.effective[x]", "us-core-1")
        .expression,
    ).toBe("$this is DateTime implies $this.toString().length() >= 10");
    expect(
      row("9.0.0", "us-core-observation-clinical-result", "Observation.effective[x]", "us-core-1")
        .expression,
    ).toBe("$this is dateTime implies $this.toString().length() >= 10");
    const smoking24 = row("9.0.0", "us-core-smokingstatus", "Observation", "us-core-24");
    expect([smoking24.severity, smoking24.expression]).toEqual([
      "error",
      "code.coding.where(code in '72166-2'|'11367-0').exists() implies value.is(CodeableConcept)",
    ]);
    const smoking25 = row("9.0.0", "us-core-smokingstatus", "Observation", "us-core-25");
    expect([smoking25.severity, smoking25.expression]).toEqual([
      "warning",
      "code.coding.where(code in '401201003'|'782516008').exists() implies value.is(Quantity)",
    ]);
    expect(
      row("9.0.0", "us-core-organization", "Organization.identifier:NPI", "us-core-16").expression,
    ).toBe("value.matches('^[0-9]{10}$')");
    expect(
      row("9.0.0", "us-core-organization", "Organization.identifier:CLIA", "us-core-18").expression,
    ).toBe("value.matches('^[0-9]{2}D[0-9]{7}$')");
    expect(
      row("9.0.0", "us-core-organization", "Organization.identifier:NAIC", "us-core-19").expression,
    ).toBe("value.matches('^[0-9]{5}$')");
    expect(
      row("9.0.0", "us-core-practitioner", "Practitioner.identifier:NCSBNID", "us-core-27")
        .expression,
    ).toBe("value.matches('^[0-8]{8}$')");
  });
});

describe("AC-2 / AC-3: every projected row classified, against a committed expectation", () => {
  const rows = classifyProjection(PROJECTION);
  const expectation = JSON.parse(
    readFileSync(EXPECTATION_PATH, "utf8"),
  ) as ClassificationExpectation;

  it("AC-2: classifies every row exactly as the committed expectation records, so no key moves in silence", () => {
    expect(rows).toEqual(expectation.rows);
    expect(Object.fromEntries(totalsOf(rows))).toEqual(expectation.totals);
  });

  it("AC-2: reports one line per row naming version, profile, key and the classification, then per-version totals", () => {
    const lines = reportLines(rows);
    expect(lines.length).toBe(PROJECTION.constraints.length + 3);
    PROJECTION.constraints.forEach((r, i) => {
      const line = req(lines[i]);
      expect(line.startsWith(`${r.version}  ${r.profile}  `)).toBe(true);
      expect(line).toMatch(new RegExp(`  ${r.key}  (evaluated|declined: \\S.*)$`));
    });
    expect(lines.slice(-3)).toEqual([
      "totals",
      "6.1.0: 24 of 29 evaluated, 5 declined (the engine at the pin: 16 of 29)",
      "9.0.0: 29 of 34 evaluated, 5 declined (the engine at the pin: 19 of 34)",
    ]);
  });

  it("AC-3: evaluates every row whose only obstacle at the pin was a FHIR-type test, matches() or is()", () => {
    const newlyEvaluated = rows.filter((r) =>
      ["ofType(Quantity)", "ofType(CodeableConcept)", "matches()", "is()"].some(
        (construct) => r.pin === `declined: ${construct}`,
      ),
    );
    expect(newlyEvaluated.every((r) => r.head === "evaluated")).toBe(true);
    expect(newlyEvaluated.filter((r) => r.version === "6.1.0").length).toBe(8);
    expect(newlyEvaluated.filter((r) => r.version === "9.0.0").length).toBe(10);
  });

  it("AC-3: still declines us-core-1, us-core-17 and provenance-1, naming the construct", () => {
    const declined = rows.filter((r) => r.head !== "evaluated");
    expect([...new Set(declined.map((r) => r.key))].sort()).toEqual([
      "provenance-1",
      "us-core-1",
      "us-core-17",
    ]);
    expect(new Set(declined.map((r) => r.head))).toEqual(
      new Set(["declined: toString()", "declined: substring()", "declined: resolve()"]),
    );
  });

  it("AC-3: reports evaluated totals strictly above the pin engine's over the same projection", () => {
    const totals = totalsOf(rows);
    // The pin engine's totals over this projection equal the roadmap's own measurement (16 of 29
    // and 19 of 34), because the projection's row counts are that measurement's 29 and 34.
    expect(req(totals.get("6.1.0"))).toEqual({ rows: 29, evaluated: 24, pinEvaluated: 16 });
    expect(req(totals.get("9.0.0"))).toEqual({ rows: 34, evaluated: 29, pinEvaluated: 19 });
    for (const t of totals.values()) expect(t.evaluated).toBeGreaterThan(t.pinEvaluated);
  });
});

describe("AC-4: US Core 9.0.0 us-core-3 on Observation.value[x] is decided over a valueQuantity", () => {
  const profile = profileFrom([
    row("9.0.0", "us-core-observation-clinical-result", "Observation.value[x]", "us-core-3"),
  ]);

  it("draws no us-core-3 finding for a UCUM system", () => {
    const obs = observation({
      valueQuantity: { value: 95, unit: "mg/dL", system: UCUM, code: "mg/dL" },
    });
    expect(findingsFor(obs, profile, "us-core-3")).toEqual([]);
  });

  it("draws no us-core-3 finding when the system is absent", () => {
    const obs = observation({ valueQuantity: { value: 95, unit: "mg/dL" } });
    expect(findingsFor(obs, profile, "us-core-3")).toEqual([]);
  });

  it("draws INVARIANT_VIOLATED at error, carrying us-core-3, for any other system", () => {
    const obs = observation({
      valueQuantity: {
        value: 95,
        unit: "mg/dL",
        system: "http://example.org/local-units",
        code: "mgdl",
      },
    });
    expect(findingsFor(obs, profile, "us-core-3")).toEqual([["INVARIANT_VIOLATED", "error"]]);
  });
});

describe("AC-5: US Core 9.0.0 us-core-3 over a complex value that is not a Quantity", () => {
  const profile = profileFrom([
    row("9.0.0", "us-core-observation-clinical-result", "Observation.value[x]", "us-core-3"),
  ]);

  it("reports nothing over a valueCodeableConcept", () => {
    const obs = observation({
      valueCodeableConcept: { coding: [{ system: "http://snomed.info/sct", code: "10828004" }] },
    });
    expect(findingsFor(obs, profile, "us-core-3")).toEqual([]);
  });

  it("reports nothing over a valueRange, whose bounds are Quantities but which is not one", () => {
    const obs = observation({
      valueRange: {
        low: { value: 1, system: "http://example.org/local-units", code: "x" },
        high: { value: 2, system: "http://example.org/local-units", code: "x" },
      },
    });
    expect(findingsFor(obs, profile, "us-core-3")).toEqual([]);
  });
});

describe("AC-6: US Core 6.1.0 us-core-3, evaluated faithfully as published", () => {
  // THIS IS US CORE 6.1.0's EXPRESSION EVALUATED FAITHFULLY, NOT A UCUM CHECK. Anchored on
  // Observation.value[x], the focus is the Quantity itself, so `value` selects the decimal
  // `Quantity.value`, which is never a Quantity: `value.ofType(Quantity)` is empty for every
  // `system`, and the constraint holds whatever unit system the Quantity names.
  const profile = profileFrom([
    row("6.1.0", "us-core-observation-clinical-result", "Observation.value[x]", "us-core-3"),
  ]);

  for (const system of [UCUM, "http://example.org/local-units"]) {
    it(`reports neither INVARIANT_VIOLATED nor INVARIANT_UNCHECKED for us-core-3 with system ${system}`, () => {
      const obs = observation({ valueQuantity: { value: 95, unit: "mg/dL", system, code: "x" } });
      expect(findingsFor(obs, profile, "us-core-3")).toEqual([]);
    });
  }
});

describe("AC-7: US Core 9.0.0 us-core-24 / us-core-25 are decided from the value[x] variant present", () => {
  const profile = profileFrom([
    row("9.0.0", "us-core-smokingstatus", "Observation", "us-core-24"),
    row("9.0.0", "us-core-smokingstatus", "Observation", "us-core-25"),
  ]);
  const smoking = (code: Record<string, unknown>, value: Record<string, unknown>) =>
    parse({ resourceType: "Observation", status: "final", code: { coding: [code] }, ...value });
  const smokingStatus = { system: "http://loinc.org", code: "72166-2" };
  const packYears = { system: "http://snomed.info/sct", code: "401201003" };
  const quantity = {
    valueQuantity: { value: 10, unit: "{PackYears}", system: UCUM, code: "{PackYears}" },
  };
  const concept = {
    valueCodeableConcept: { coding: [{ system: "http://snomed.info/sct", code: "8517006" }] },
  };

  it("72166-2 with a valueQuantity draws INVARIANT_VIOLATED at error for us-core-24", () => {
    const obs = smoking(smokingStatus, quantity);
    expect(findingsFor(obs, profile, "us-core-24")).toEqual([["INVARIANT_VIOLATED", "error"]]);
    expect(findingsFor(obs, profile, "us-core-25")).toEqual([]);
  });

  it("72166-2 with a valueCodeableConcept draws nothing for either key", () => {
    const obs = smoking(smokingStatus, concept);
    expect(findingsFor(obs, profile, "us-core-24")).toEqual([]);
    expect(findingsFor(obs, profile, "us-core-25")).toEqual([]);
  });

  it("401201003 with a valueCodeableConcept draws INVARIANT_VIOLATED at warning for us-core-25", () => {
    const obs = smoking(packYears, concept);
    expect(findingsFor(obs, profile, "us-core-25")).toEqual([["INVARIANT_VIOLATED", "warning"]]);
    expect(findingsFor(obs, profile, "us-core-24")).toEqual([]);
  });

  it("401201003 with a valueQuantity draws nothing for either key", () => {
    const obs = smoking(packYears, quantity);
    expect(findingsFor(obs, profile, "us-core-24")).toEqual([]);
    expect(findingsFor(obs, profile, "us-core-25")).toEqual([]);
  });
});

describe("AC-12: a US Core expression still outside the subset is reported unchecked, never satisfied", () => {
  it("6.1.0 us-core-1 over an effectivePeriod is INVARIANT_UNCHECKED at information", () => {
    const profile = profileFrom([
      row("6.1.0", "us-core-observation-clinical-result", "Observation.effective[x]", "us-core-1"),
    ]);
    const obs = observation({
      effectivePeriod: { start: "2020-01-01T08:00:00Z", end: "2020-01-01T09:00:00Z" },
    });
    expect(findingsFor(obs, profile, "us-core-1")).toEqual([
      ["INVARIANT_UNCHECKED", "information"],
    ]);
  });

  it("us-core-17 over an NPI identifier is unchecked, not satisfied", () => {
    const org = parse({
      resourceType: "Organization",
      identifier: [{ system: "http://hl7.org/fhir/sid/us-npi", value: "1234567893" }],
    });
    const identifiers = req(getProperty(org, "identifier"));
    const npi = isList(identifiers) ? req(identifiers.items[0]) : identifiers;
    if (!isComplex(npi)) throw new Error("expected an Identifier");
    const us17 = row("9.0.0", "us-core-organization", "Organization.identifier:NPI", "us-core-17");
    expect(evaluateInvariant(us17.expression, npi, org)).toEqual({
      unchecked: true,
      satisfied: false,
    });
  });

  it("provenance-1 over an agent with a who is unchecked, not satisfied", () => {
    const provenance = parse({
      resourceType: "Provenance",
      target: [{ reference: "Observation/syn-1" }],
      recorded: "2020-01-01T08:00:00Z",
      agent: [{ who: { reference: "Practitioner/syn-2" } }],
    });
    const agents = req(getProperty(provenance, "agent"));
    const agent = isList(agents) ? req(agents.items[0]) : agents;
    if (!isComplex(agent)) throw new Error("expected an agent");
    const p1 = row("9.0.0", "us-core-provenance", "Provenance.agent", "provenance-1");
    expect(evaluateInvariant(p1.expression, agent, provenance)).toEqual({
      unchecked: true,
      satisfied: false,
    });
  });
});

describe("differential pass AC-3: every declined row the profile layer reaches is INVARIANT_UNCHECKED through validateResource", () => {
  // The occurrence the profile layer reaches for each declined key: a complex occurrence of the
  // element the row anchors on. A slice-scoped row (us-core-17) is not reached by that layer at
  // all, and a primitive effectiveDateTime is not an occurrence it anchors on; both limits are
  // declared, and neither is an occurrence this criterion is about.
  const reaching: Readonly<Record<string, () => FhirComplex>> = {
    "Observation.effective[x]": () =>
      observation({
        effectivePeriod: { start: "2020-01-01T08:00:00Z", end: "2020-01-01T09:00:00Z" },
      }),
    "Provenance.agent": () =>
      parse({
        resourceType: "Provenance",
        target: [{ reference: "Observation/syn-1" }],
        recorded: "2020-01-01T08:00:00Z",
        agent: [{ who: { reference: "Practitioner/syn-2" } }],
      }),
  };
  const declined = classifyProjection(PROJECTION).filter((r) => r.head !== "evaluated");
  const reached = declined.filter((r) => !r.element.includes(":"));

  it("names an occurrence for every declined row that is not slice-scoped", () => {
    expect(new Set(declined.filter((r) => r.element.includes(":")).map((r) => r.key))).toEqual(
      new Set(["us-core-17"]),
    );
    for (const r of reached) expect(reaching[r.element], r.element).toBeDefined();
    expect(reached.length).toBeGreaterThan(0);
  });

  for (const r of reached) {
    it(`${r.version} ${r.profile} ${r.key} draws INVARIANT_UNCHECKED at information, never satisfied`, () => {
      const make = reaching[r.element];
      if (make === undefined) throw new Error(`no occurrence for ${r.element}`);
      const profile = profileFrom([row(r.version, r.profile, r.element, r.key)]);
      expect(findingsFor(make(), profile, r.key)).toEqual([["INVARIANT_UNCHECKED", "information"]]);
    });
  }
});
