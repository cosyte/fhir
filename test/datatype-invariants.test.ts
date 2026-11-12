/**
 * The R4 4.0.1 datatype constraints, evaluated by `validateResource` at every occurrence of a
 * datatype at any depth, with no profile supplied.
 *
 * The table in `src/validate/datatype-invariants.ts` is held, entry for entry, to the projection in
 * `test/__data__/fhir-element-definitions.json`, which CI re-derives from the R4 definition files
 * pinned by digest. Then every key the projection lists is probed: a document breaking it draws a
 * finding carrying the key, `INVARIANT_VIOLATED` or, where the engine cannot evaluate it,
 * `INVARIANT_UNCHECKED`.
 *
 * Every document is synthetic: placeholder codes and texts, `example.org` URLs, no value that
 * resembles a person.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  defineProfile,
  evaluateInvariant,
  parseResource,
  parseResourceXml,
  validateResource,
  type ValidateOptions,
} from "../src/index.js";
import { evaluate, type FpColl } from "../src/fhirpath/evaluate.js";
import { parseFhirPath } from "../src/fhirpath/parser.js";
import { FhirDecimal } from "../src/model/decimal.js";
import { complex, primitive } from "../src/model/node.js";
import {
  DATATYPE_CONSTRAINTS,
  DATATYPE_CONSTRAINTS_ELSEWHERE,
  TYPE_PROFILES,
} from "../src/validate/datatype-invariants.js";
import { LEAVES_UNCHECKED } from "../src/validate/unchecked.js";
import { VALIDATION_CODES } from "../src/validate/issues.js";

type Doc = Readonly<Record<string, unknown>>;

interface Projection {
  readonly datatypeConstraints: {
    readonly r4: Readonly<Record<string, readonly (readonly [string, string])[]>>;
  };
  readonly typeProfiles: { readonly r4: Readonly<Record<string, string>> };
}

const PROJECTION = JSON.parse(
  readFileSync(new URL("./__data__/fhir-element-definitions.json", import.meta.url), "utf8"),
) as Projection;

/** Each invariant finding as `CODE key at location`. */
function invariants(doc: Doc, options?: ValidateOptions): string[] {
  const { resource } = parseResource(JSON.stringify(doc));
  return validateResource(resource, options)
    .issues.filter((i) => i.code === "INVARIANT_VIOLATED" || i.code === "INVARIANT_UNCHECKED")
    .map((i) => `${i.code} ${i.constraint ?? ""} at ${i.expression}`);
}

const UCUM = "http://unitsofmeasure.org";
const OBS = { resourceType: "Observation", status: "final", code: { text: "Synthetic" } };
/** A Patient carrying one extension with the given value member. */
const inExtension = (value: Doc): Doc => ({
  resourceType: "Patient",
  extension: [{ url: "http://example.org/e", ...value }],
});
/** A Patient carrying one timing in an extension, `repeat` as given. */
const repeat = (r: Doc): Doc => inExtension({ valueTiming: { repeat: r } });

describe("the table is the definitions' own", () => {
  it("lists exactly the projected constraints, with the narrative's left to the narrative layer", () => {
    const projected = PROJECTION.datatypeConstraints.r4;
    const table = DATATYPE_CONSTRAINTS();
    const elsewhere = Object.entries(projected)
      .filter(([at]) => table[at] === undefined)
      .flatMap(([at, rows]) => rows.map(([key]) => `${at} ${key}`));
    expect(elsewhere).toEqual(["Narrative.div txt-1", "Narrative.div txt-2"]);
    expect(Object.keys(DATATYPE_CONSTRAINTS_ELSEWHERE).sort()).toEqual(["txt-1", "txt-2"]);
    const { ["Narrative.div"]: _narrative, ...rest } = projected;
    expect(table).toEqual(rest);
  });

  it("lists exactly the projected type profiles", () => {
    expect(TYPE_PROFILES()).toEqual(PROJECTION.typeProfiles.r4);
  });

  it("classifies every validation code as leaving something unchecked or not", () => {
    expect(Object.keys(LEAVES_UNCHECKED()).sort()).toEqual(Object.keys(VALIDATION_CODES).sort());
  });
});

/** A document breaking each projected key, and the finding it draws. */
const PROBES: Readonly<Record<string, readonly [Doc, string]>> = {
  "qty-3": [
    { ...OBS, valueQuantity: { value: 1, code: "mg" } },
    "INVARIANT_VIOLATED qty-3 at Observation.valueQuantity",
  ],
  "sqty-1": [
    { ...OBS, referenceRange: [{ high: { value: 1, comparator: "<" } }] },
    "INVARIANT_VIOLATED sqty-1 at Observation.referenceRange[0].high",
  ],
  "age-1": [
    {
      resourceType: "Condition",
      subject: { reference: "Patient/p1" },
      onsetAge: { value: 0, system: UCUM, code: "a" },
    },
    "INVARIANT_VIOLATED age-1 at Condition.onsetAge",
  ],
  "att-1": [
    { resourceType: "Patient", photo: [{ data: "AAAA" }] },
    "INVARIANT_VIOLATED att-1 at Patient.photo[0]",
  ],
  "cpt-2": [
    { resourceType: "Patient", telecom: [{ value: "fake" }] },
    "INVARIANT_VIOLATED cpt-2 at Patient.telecom[0]",
  ],
  "cnt-3": [
    inExtension({ valueCount: { value: 1 } }),
    "INVARIANT_UNCHECKED cnt-3 at Patient.extension[0].valueCount",
  ],
  "drq-1": [
    inExtension({
      valueDataRequirement: {
        type: "Patient",
        codeFilter: [{ valueSet: "http://example.org/vs" }],
      },
    }),
    "INVARIANT_VIOLATED drq-1 at Patient.extension[0].valueDataRequirement.codeFilter[0]",
  ],
  "drq-2": [
    inExtension({
      valueDataRequirement: { type: "Patient", dateFilter: [{ valueDateTime: "2020" }] },
    }),
    "INVARIANT_VIOLATED drq-2 at Patient.extension[0].valueDataRequirement.dateFilter[0]",
  ],
  "dis-1": [
    inExtension({ valueDistance: { value: 1, system: "http://example.org/units", code: "x" } }),
    "INVARIANT_VIOLATED dis-1 at Patient.extension[0].valueDistance",
  ],
  "drt-1": [
    repeat({ boundsDuration: { value: 1, code: "d" } }),
    "INVARIANT_VIOLATED drt-1 at Patient.extension[0].valueTiming.repeat.boundsDuration",
  ],
  "exp-1": [
    inExtension({ valueExpression: { language: "text/fhirpath" } }),
    "INVARIANT_VIOLATED exp-1 at Patient.extension[0].valueExpression",
  ],
  "per-1": [
    {
      resourceType: "Patient",
      name: [{ text: "Fake", period: { start: "2020-02-01", end: "2020-01-01" } }],
    },
    "INVARIANT_VIOLATED per-1 at Patient.name[0].period",
  ],
  "rng-2": [
    { ...OBS, valueRange: { low: { value: 5 }, high: { value: 1 } } },
    "INVARIANT_VIOLATED rng-2 at Observation.valueRange",
  ],
  "rat-1": [
    { ...OBS, valueRatio: { numerator: { value: 1 } } },
    "INVARIANT_VIOLATED rat-1 at Observation.valueRatio",
  ],
  "ref-1": [
    { ...OBS, subject: { reference: "#missing" } },
    "INVARIANT_VIOLATED ref-1 at Observation.subject",
  ],
  "tim-1": [
    repeat({ duration: 1 }),
    "INVARIANT_VIOLATED tim-1 at Patient.extension[0].valueTiming.repeat",
  ],
  "tim-2": [
    repeat({ period: 1 }),
    "INVARIANT_VIOLATED tim-2 at Patient.extension[0].valueTiming.repeat",
  ],
  "tim-4": [
    repeat({ duration: -1, durationUnit: "h" }),
    "INVARIANT_VIOLATED tim-4 at Patient.extension[0].valueTiming.repeat",
  ],
  "tim-5": [
    repeat({ period: -1, periodUnit: "h" }),
    "INVARIANT_VIOLATED tim-5 at Patient.extension[0].valueTiming.repeat",
  ],
  "tim-6": [
    repeat({ periodMax: 2 }),
    "INVARIANT_VIOLATED tim-6 at Patient.extension[0].valueTiming.repeat",
  ],
  "tim-7": [
    repeat({ durationMax: 2 }),
    "INVARIANT_VIOLATED tim-7 at Patient.extension[0].valueTiming.repeat",
  ],
  "tim-8": [
    repeat({ countMax: 2 }),
    "INVARIANT_VIOLATED tim-8 at Patient.extension[0].valueTiming.repeat",
  ],
  "tim-9": [
    repeat({ offset: 10, when: ["C"] }),
    "INVARIANT_VIOLATED tim-9 at Patient.extension[0].valueTiming.repeat",
  ],
  "tim-10": [
    repeat({ timeOfDay: ["08:00:00"], when: ["MORN"] }),
    "INVARIANT_VIOLATED tim-10 at Patient.extension[0].valueTiming.repeat",
  ],
  "trd-1": [
    inExtension({
      valueTriggerDefinition: {
        type: "periodic",
        timingDate: "2020-01-01",
        data: [{ type: "Patient" }],
      },
    }),
    "INVARIANT_VIOLATED trd-1 at Patient.extension[0].valueTriggerDefinition",
  ],
  "trd-2": [
    inExtension({
      valueTriggerDefinition: {
        type: "named-event",
        name: "x",
        condition: { language: "text/fhirpath", expression: "true" },
      },
    }),
    "INVARIANT_VIOLATED trd-2 at Patient.extension[0].valueTriggerDefinition",
  ],
  "trd-3": [
    inExtension({ valueTriggerDefinition: { type: "named-event" } }),
    "INVARIANT_UNCHECKED trd-3 at Patient.extension[0].valueTriggerDefinition",
  ],
};

describe("every projected key draws a finding carrying it, with no profile", () => {
  const keys = [
    ...new Set(
      Object.values(PROJECTION.datatypeConstraints.r4).flatMap((rows) => rows.map(([key]) => key)),
    ),
  ];

  it("has a probe for every key the layer evaluates", () => {
    const owned = keys.filter((key) => DATATYPE_CONSTRAINTS_ELSEWHERE[key] === undefined);
    expect(Object.keys(PROBES).sort()).toEqual(owned.sort());
  });

  for (const [key, [doc, finding]] of Object.entries(PROBES)) {
    it(`${key}: ${finding}`, () => {
      expect(invariants(doc)).toContain(finding);
    });
  }

  it("txt-1 and txt-2 ride on the narrative layer's findings", () => {
    const narrative = (div: string) =>
      validateResource(
        parseResource(
          JSON.stringify({ resourceType: "Patient", text: { status: "generated", div } }),
        ).resource,
      ).issues.map((i) => `${i.code} ${i.constraint ?? "-"}`);
    const xhtml = (inner: string) => `<div xmlns="http://www.w3.org/1999/xhtml">${inner}</div>`;
    expect(narrative(xhtml(""))).toEqual(["NARRATIVE_EMPTY txt-2"]);
    expect(narrative(xhtml("<font>x</font>"))).toEqual(["NARRATIVE_ELEMENT_ILLEGAL txt-1"]);
    expect(narrative(xhtml('<p foo="1">x</p>'))).toEqual(["NARRATIVE_ATTRIBUTE_ILLEGAL txt-1"]);
    expect(narrative(xhtml("<script>1</script>x"))).toEqual(["NARRATIVE_ACTIVE_CONTENT txt-1"]);
    expect(narrative("<p>x</p>")).toEqual(["NARRATIVE_ROOT_INVALID -"]);
  });
});

describe("each constraint holds where the datatype is conformant", () => {
  it("draws nothing over conformant datatypes", () => {
    const doc = {
      ...OBS,
      valueQuantity: { value: 1, comparator: "<", unit: "mg", system: UCUM, code: "mg" },
      effectivePeriod: { start: "2020-01-01", end: "2020-01-02" },
      referenceRange: [{ low: { value: 1 }, high: { value: 1 } }],
      subject: { reference: "Patient/p1" },
      performer: [{ display: "Fake" }],
    };
    expect(invariants(doc)).toEqual([]);
    expect(
      invariants({ ...OBS, valueRatio: { numerator: { value: 1 }, denominator: { value: 2 } } }),
    ).toEqual([]);
    expect(
      invariants({
        ...OBS,
        valueRange: {
          low: { value: 1, code: "mg", system: UCUM },
          high: { value: 2, code: "mg", system: UCUM },
        },
      }),
    ).toEqual([]);
    expect(invariants({ ...OBS, valueRange: { low: { value: 1 } } })).toEqual([]);
    expect(
      invariants({
        resourceType: "Condition",
        subject: { reference: "Patient/p1" },
        onsetAge: { value: 2, system: UCUM, code: "a" },
      }),
    ).toEqual([]);
    expect(invariants(repeat({ boundsDuration: { value: 1, system: UCUM, code: "d" } }))).toEqual(
      [],
    );
  });

  it("decides age-1 by %ucum: another system breaks it", () => {
    expect(
      invariants({
        resourceType: "Condition",
        subject: { reference: "Patient/p1" },
        onsetAge: { value: 2, system: "http://example.org/u", code: "a" },
      }),
    ).toEqual(["INVARIANT_VIOLATED age-1 at Condition.onsetAge"]);
    expect(
      evaluateInvariant(
        "%ucum = 'http://unitsofmeasure.org'",
        parseResource('{"resourceType":"Basic"}').resource,
        parseResource('{"resourceType":"Basic"}').resource,
      ),
    ).toEqual({ unchecked: false, satisfied: true });
  });

  it("applies sqty-1 only where R4 types the element SimpleQuantity", () => {
    expect(invariants({ ...OBS, valueQuantity: { value: 1, comparator: "<" } })).toEqual([]);
    expect(invariants({ ...OBS, valueRange: { low: { value: 1, comparator: "<" } } })).toEqual([
      "INVARIANT_VIOLATED sqty-1 at Observation.valueRange.low",
    ]);
    expect(
      invariants({
        ...OBS,
        component: [
          { code: { text: "x" }, referenceRange: [{ low: { value: 1, comparator: "<" } }] },
        ],
      }),
    ).toEqual(["INVARIANT_VIOLATED sqty-1 at Observation.component[0].referenceRange[0].low"]);
  });
});

describe("rng-2 and ref-1, decided by code written for them", () => {
  const range = (low: Doc, high: Doc) => invariants({ ...OBS, valueRange: { low, high } });

  it("compares two bounds in the same unit, and leaves any other pair unchecked", () => {
    expect(range({ value: 2, unit: "mg" }, { value: 1, unit: "mg" })).toEqual([
      "INVARIANT_VIOLATED rng-2 at Observation.valueRange",
    ]);
    expect(
      range({ value: 2, system: UCUM, code: "mg" }, { value: 2.0, system: UCUM, code: "mg" }),
    ).toEqual([]);
    expect(
      range({ value: 1, system: UCUM, code: "mg" }, { value: 2, system: UCUM, code: "g" }),
    ).toEqual(["INVARIANT_UNCHECKED rng-2 at Observation.valueRange"]);
    expect(range({ value: 1, code: "mg" }, { value: 2, system: UCUM, code: "mg" })).toContain(
      "INVARIANT_UNCHECKED rng-2 at Observation.valueRange",
    );
    expect(range({ value: 1, unit: "mg" }, { value: 2, unit: "g" })).toEqual([
      "INVARIANT_UNCHECKED rng-2 at Observation.valueRange",
    ]);
    expect(range({ unit: "mg" }, { value: 2, unit: "mg" })).toEqual([
      "INVARIANT_UNCHECKED rng-2 at Observation.valueRange",
    ]);
    expect(range({ value: 1, unit: "mg" }, { unit: "mg" })).toEqual([
      "INVARIANT_UNCHECKED rng-2 at Observation.valueRange",
    ]);
  });

  it("reads a bound from XML as it reads one from JSON", () => {
    const xml =
      '<Observation xmlns="http://hl7.org/fhir"><status value="final"/><code><text value="x"/></code>' +
      '<valueRange><low><value value="2"/></low><high><value value="1"/></high></valueRange></Observation>';
    const issues = validateResource(parseResourceXml(xml).resource).issues;
    expect(issues.filter((i) => i.constraint === "rng-2").map((i) => i.code)).toEqual([
      "INVARIANT_VIOLATED",
    ]);
  });

  it("holds over a range with one bound, and leaves a bound that is no quantity unchecked", () => {
    expect(invariants({ ...OBS, valueRange: { high: { value: 1 } } })).toEqual([]);
    expect(invariants({ ...OBS, valueRange: { low: "fake", high: { value: 1 } } })).toEqual([
      "INVARIANT_UNCHECKED rng-2 at Observation.valueRange",
    ]);
  });

  it("leaves a value that is no decimal literal unchecked", () => {
    const bound = (raw: string) =>
      complex([{ name: "value", value: primitive(new FhirDecimal(raw)) }]);
    const observation = complex([
      { name: "resourceType", value: primitive("Observation") },
      { name: "status", value: primitive("final") },
      { name: "code", value: complex([{ name: "text", value: primitive("x") }]) },
      {
        name: "valueRange",
        value: complex([
          { name: "low", value: bound("fake") },
          { name: "high", value: bound("1") },
        ]),
      },
    ]);
    expect(
      validateResource(observation)
        .issues.filter((i) => i.constraint === "rng-2")
        .map((i) => i.code),
    ).toEqual(["INVARIANT_UNCHECKED"]);
  });

  it("resolves a #id against the root resource's contained ids", () => {
    const contained = [{ resourceType: "Patient", id: "p1" }];
    expect(invariants({ ...OBS, contained, subject: { reference: "#p1" } })).not.toContain(
      "INVARIANT_VIOLATED ref-1 at Observation.subject",
    );
    expect(invariants({ ...OBS, contained, subject: { reference: "#p2" } })).toContain(
      "INVARIANT_VIOLATED ref-1 at Observation.subject",
    );
    expect(
      invariants({
        ...OBS,
        contained: [{ resourceType: "Basic" }, ...contained],
        subject: { reference: "#p1" },
      }),
    ).not.toContain("INVARIANT_VIOLATED ref-1 at Observation.subject");
    expect(
      invariants({
        ...OBS,
        contained: { resourceType: "Patient", id: "p1" },
        subject: { reference: "#p1" },
      }),
    ).not.toContain("INVARIANT_VIOLATED ref-1 at Observation.subject");
    expect(invariants({ ...OBS, contained: ["p1"], subject: { reference: "#p1" } })).toContain(
      "INVARIANT_VIOLATED ref-1 at Observation.subject",
    );
  });

  it("leaves a bare # and an unreadable reference unchecked, and passes a non-local one", () => {
    expect(invariants({ ...OBS, subject: { reference: "#" } })).toEqual([
      "INVARIANT_UNCHECKED ref-1 at Observation.subject",
    ]);
    expect(invariants({ ...OBS, subject: { reference: { a: 1 } } })).toContain(
      "INVARIANT_UNCHECKED ref-1 at Observation.subject",
    );
    expect(invariants({ ...OBS, subject: { reference: "Patient/p1" } })).toEqual([]);
    expect(invariants({ ...OBS, subject: { identifier: { value: "x" } } })).toEqual([]);
  });

  it("reads a contained resource's #id against its container, and a Bundle entry as its own root", () => {
    const patient = {
      resourceType: "Patient",
      contained: [
        { resourceType: "Practitioner", id: "pr1" },
        {
          resourceType: "Observation",
          status: "final",
          code: { text: "x" },
          performer: [{ reference: "#pr1" }],
        },
      ],
    };
    expect(invariants(patient).filter((f) => f.includes("ref-1"))).toEqual([]);
    const bundle = {
      resourceType: "Bundle",
      type: "collection",
      entry: [
        { fullUrl: "urn:uuid:fake-1", resource: { ...OBS, subject: { reference: "#pr1" } } },
        {
          fullUrl: "urn:uuid:fake-2",
          resource: {
            resourceType: "Practitioner",
            id: "pr1",
            contained: [{ resourceType: "Patient", id: "x" }],
          },
        },
      ],
    };
    expect(invariants(bundle)).toContain(
      "INVARIANT_VIOLATED ref-1 at Bundle.entry[0].resource.subject",
    );
  });
});

describe("where the layer walks", () => {
  it("reaches a datatype at any depth: a backbone, a list, an extension, a primitive's extension", () => {
    const bad = { value: 1, code: "mg" };
    const findings = invariants({
      resourceType: "MedicationRequest",
      status: "active",
      intent: "order",
      subject: { reference: "Patient/p1" },
      medicationCodeableConcept: { text: "x" },
      dosageInstruction: [{ doseAndRate: [{ doseQuantity: bad }] }],
      dispenseRequest: { quantity: bad },
      _authoredOn: { extension: [{ url: "http://example.org/e", valueQuantity: bad }] },
      authoredOn: "2020-01-01",
    });
    expect(findings).toEqual([
      "INVARIANT_VIOLATED qty-3 at MedicationRequest.dosageInstruction[0].doseAndRate[0].doseQuantity",
      "INVARIANT_VIOLATED qty-3 at MedicationRequest.dispenseRequest.quantity",
      "INVARIANT_VIOLATED qty-3 at MedicationRequest.authoredOn.extension[0].valueQuantity",
    ]);
  });

  it("reaches a contained resource and a Bundle entry of a walked type, and no other", () => {
    const bad = { value: 1, code: "mg" };
    expect(
      invariants({
        resourceType: "Patient",
        contained: [{ ...OBS, id: "o1", valueQuantity: bad }],
      }),
    ).toContain("INVARIANT_VIOLATED qty-3 at Patient.contained[0].valueQuantity");
    expect(
      invariants({
        resourceType: "Patient",
        contained: [
          {
            resourceType: "Basic",
            id: "b1",
            extension: [{ url: "http://example.org/e", valueQuantity: bad }],
          },
        ],
      }).filter((f) => f.includes("qty-3")),
    ).toEqual([]);
    expect(
      invariants({
        resourceType: "Bundle",
        type: "collection",
        entry: [{ fullUrl: "urn:uuid:fake-1", resource: { ...OBS, valueQuantity: bad } }],
      }),
    ).toEqual(["INVARIANT_VIOLATED qty-3 at Bundle.entry[0].resource.valueQuantity"]);
    expect(
      invariants({
        resourceType: "Basic",
        extension: [{ url: "http://example.org/e", valueQuantity: bad }],
      }),
    ).toEqual([]);
    expect(
      invariants({
        resourceType: "Patient",
        contained: [{ id: "c1", telecom: [{ value: "x" }] }],
      }).filter((f) => f.includes("cpt-2")),
    ).toEqual([]);
  });

  it("walks no member the definitions do not define, and no value of the wrong shape", () => {
    expect(invariants({ ...OBS, fakeQuantity: { value: 1, code: "mg" } })).toEqual([]);
    expect(invariants({ ...OBS, valueQuantity: "fake" })).toEqual([]);
    expect(invariants({ ...OBS, status: { value: 1, code: "mg" } })).toEqual([]);
  });

  it("reports a violation a supplied profile repeats at the same node once", () => {
    const profile = defineProfile({
      url: "http://example.org/fhir/StructureDefinition/fake-qty",
      type: "Observation",
      snapshot: [
        { path: "Observation" },
        {
          path: "Observation.value[x]",
          constraint: [
            {
              key: "qty-3",
              severity: "error",
              human: "x",
              expression: "code.empty() or system.exists()",
            },
          ],
        },
      ],
    });
    expect(
      invariants({ ...OBS, valueQuantity: { value: 1, code: "mg" } }, { profiles: [profile] }),
    ).toEqual(["INVARIANT_VIOLATED qty-3 at Observation.valueQuantity"]);
  });
});

describe("names a context defines are navigated exactly", () => {
  const evalExact = (expression: string, node: Doc): FpColl => {
    const focus = parseResource(JSON.stringify({ resourceType: "Basic", ...node })).resource;
    const at: FpColl = [{ t: "node", node: focus }];
    return evaluate(parseFhirPath(expression), at, {
      resource: focus,
      context: at,
      exact: () => true,
    });
  };

  it("selects only the property of exactly that name from a complex node", () => {
    expect(evalExact("period.exists()", { periodMax: 2 })).toEqual([{ t: "bool", value: false }]);
    expect(evalExact("period.exists()", { period: 2 })).toEqual([{ t: "bool", value: true }]);
  });

  it("navigates a primitive's extensions as ever, and nothing from a computed value", () => {
    expect(
      evalExact("period.extension.exists()", {
        period: 2,
        _period: { extension: [{ url: "http://example.org/e", valueString: "x" }] },
      }),
    ).toEqual([{ t: "bool", value: true }]);
    expect(evalExact("('x').period.exists()", {})).toEqual([{ t: "bool", value: false }]);
  });
});
