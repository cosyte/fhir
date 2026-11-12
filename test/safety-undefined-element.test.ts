/**
 * An element the FHIR definitions do not define is never read as safe.
 *
 * A document can carry an element its resource does not define: `entry` on a Patient, a key in the
 * wrong case (`Entry`, `Contained`), an extra key on a Bundle entry or a Coding, a member of an
 * object written where a primitive belongs, an XML element in a namespace other than its parent's
 * however declared. No valid document carries
 * one, but the reader keeps it in the model, and a caller that flattens the whole tree would
 * summarize what sits there, a retraction included. So `readSafety` lists it on `notAssessed`, by
 * location, and declines; `validateResource` reports it as `UNKNOWN_ELEMENT` at every depth.
 *
 * The model is the R4 and R4B definitions of the ten resource types the readout assesses and of
 * everything below them (`test/element-definitions.test.ts` holds it to the definition files).
 *
 * The fixed cases are the reported ones, in JSON and XML; the properties plant an undefined element
 * on a random node of a random synthetic document at random depth, in JSON and XML, and check the
 * converse on the same documents with nothing planted.
 *
 * FIXTURES ARE SYNTHETIC: made-up ids, codes and text, and no person, name, date of birth or
 * address.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  assertSafeToSummarize,
  FhirSafetyError,
  parseResource,
  parseResourceXml,
  readSafety,
  validateResource,
  type FhirComplex,
  type ValidationResult,
} from "../src/index.js";
import { childPath } from "../src/model/path.js";
import { ELEMENT_DEFINITIONS } from "../src/safety/element-definitions.js";

const NS = ' xmlns="http://hl7.org/fhir"';

function json(document: unknown): FhirComplex {
  return parseResource(JSON.stringify(document)).resource;
}

function xml(text: string): FhirComplex {
  return parseResourceXml(text).resource;
}

/** The locations `validateResource` reports as `UNKNOWN_ELEMENT`, with their severity. */
function unknownIn(result: ValidationResult): (readonly [string, string])[] {
  return result.issues
    .filter((issue) => issue.code === "UNKNOWN_ELEMENT")
    .map((issue) => [issue.expression ?? "", issue.severity] as const);
}

/** Assert the readout declines with exactly `notAssessed`, and the refusal carries them. */
function expectDeclined(resource: FhirComplex, notAssessed: readonly string[]): void {
  const safety = readSafety(resource);
  expect(safety.notAssessed).toEqual(notAssessed);
  expect(safety.safeToSummarize).toBe(false);
  let locations: readonly string[] = [];
  try {
    assertSafeToSummarize(resource);
  } catch (error) {
    expect(error).toBeInstanceOf(FhirSafetyError);
    locations = (error as FhirSafetyError).locations;
  }
  for (const location of notAssessed) expect(locations).toContain(location);
}

const RETRACTED = { resourceType: "Observation", status: "entered-in-error", code: { text: "x" } };

describe("the reported cases decline, in JSON", () => {
  it("entry on a Patient, holding a retracted resource", () => {
    const resource = json({
      resourceType: "Patient",
      id: "syn-pt-0001",
      entry: [{ resource: RETRACTED }],
    });
    // `entry` is no element of Patient; the resource below it is not at a resource position, so its
    // `resourceType` is a stray key.
    expectDeclined(resource, ["Patient.entry", "Patient.entry[0].resource"]);
    expect(unknownIn(validateResource(resource))).toEqual([["Patient.entry", "warning"]]);
  });

  it("Entry and Contained, in the wrong case", () => {
    const bundle = json({
      resourceType: "Bundle",
      type: "collection",
      Entry: [{ resource: { resourceType: "Patient", id: "syn-pt-0002" } }],
    });
    expectDeclined(bundle, ["Bundle.<withheld>", "Bundle.<withheld>[0].resource"]);
    // Bundle has no schema in the registry; its members are checked against the definitions.
    expect(unknownIn(validateResource(bundle))).toEqual([["Bundle.<withheld>", "warning"]]);
    const patient = json({ resourceType: "Patient", Contained: [RETRACTED] });
    expectDeclined(patient, ["Patient.<withheld>", "Patient.<withheld>[0]"]);
  });

  it("an extra key on a Bundle entry, at any depth of Bundle", () => {
    const inner = {
      resourceType: "Bundle",
      type: "collection",
      entry: [
        {
          fullUrl: "urn:uuid:syn-0003",
          synNote: { status: "entered-in-error" },
          resource: { resourceType: "Patient", id: "syn-pt-0003" },
        },
      ],
    };
    const resource = json({
      resourceType: "Bundle",
      type: "collection",
      entry: [{ resource: inner }],
    });
    expectDeclined(resource, ["Bundle.entry[0].resource.entry[0].synNote"]);
    for (const mode of ["lenient", "strict"] as const) {
      expect(unknownIn(validateResource(resource, { mode }))).toEqual([
        ["Bundle.entry[0].resource.entry[0].synNote", mode === "strict" ? "error" : "warning"],
      ]);
    }
  });

  it("an undefined member of a datatype, a backbone and a contained resource", () => {
    const resource = json({
      resourceType: "Observation",
      status: "final",
      code: { coding: [{ system: "http://example.org/syn", code: "syn-1", Display: "x" }] },
      component: [{ code: { text: "syn part" }, valueString: "x", interpretation2: "y" }],
      contained: [{ resourceType: "Practitioner", id: "syn-pr-1", nickname: "syn" }],
    });
    expectDeclined(resource, [
      "Observation.code.coding[0].<withheld>",
      "Observation.component[0].interpretation2",
      "Observation.contained[0].nickname",
    ]);
    expect(unknownIn(validateResource(resource, { mode: "strict" }))).toEqual([
      ["Observation.code.coding[0].<withheld>", "error"],
      ["Observation.component[0].interpretation2", "error"],
      ["Observation.contained[0].nickname", "error"],
    ]);
  });

  it("an object where a primitive belongs, and an undefined member of a primitive's extension", () => {
    const resource = json({
      resourceType: "Patient",
      birthDate: { value: "2000-01-01", status: "entered-in-error" },
      gender: "unknown",
      _gender: { extension: [{ url: "http://example.org/syn", valueString: "x", note: "y" }] },
    });
    expectDeclined(resource, [
      "Patient.birthDate.value",
      "Patient.birthDate.status",
      "Patient.gender.extension[0].note",
    ]);
    expect(unknownIn(validateResource(resource)).map(([location]) => location)).toEqual([
      "Patient.birthDate.value",
      "Patient.birthDate.status",
      "Patient.gender.extension[0].note",
    ]);
  });

  it("an undefined member of an extension nested in a primitive's extension", () => {
    const resource = json({
      resourceType: "Patient",
      gender: "unknown",
      _gender: {
        extension: [
          {
            url: "http://example.org/syn-outer",
            extension: [
              { url: "http://example.org/syn-a", valueString: "x" },
              { url: "http://example.org/syn-b", valueString: "y", note: "z" },
            ],
          },
        ],
      },
    });
    expectDeclined(resource, ["Patient.gender.extension[0].extension[1].note"]);
  });

  it("contained below the root is no resource position, and no element there either", () => {
    // `contained` is a resource position only on a resource itself. On a backbone element it is
    // an element the definitions do not define, and the resource under it is not read as one: its
    // `resourceType` is a stray key.
    const resource = json({
      resourceType: "Observation",
      status: "final",
      code: { text: "x" },
      component: [{ code: { text: "y" }, contained: [RETRACTED] }],
    });
    expectDeclined(resource, [
      "Observation.component[0].contained",
      "Observation.component[0].contained[0]",
    ]);
    expect(readSafety(resource).negations).toEqual([]);
  });

  it("an extension's own value[x] variants are defined, an invented one is not", () => {
    const resource = json({
      resourceType: "Condition",
      subject: { reference: "Patient/syn-pt-0004" },
      extension: [
        { url: "http://example.org/syn-a", valueCodeableConcept: { text: "x" } },
        { url: "http://example.org/syn-b", valueSynthetic: "x" },
      ],
    });
    expectDeclined(resource, ["Condition.extension[1].valueSynthetic"]);
  });

  it("an element R4B alone defines is defined, so an R4B document is read as written", () => {
    // `Extension.valueCodeableReference` is R4B's; `Extension.valueMeta` is R4's.
    const resource = json({
      resourceType: "Patient",
      extension: [
        { url: "http://example.org/syn-a", valueCodeableReference: { concept: { text: "x" } } },
        { url: "http://example.org/syn-b", valueMeta: { versionId: "1" } },
      ],
    });
    expect(readSafety(resource).notAssessed).toEqual([]);
    expect(readSafety(resource).safeToSummarize).toBe(true);
    expect(unknownIn(validateResource(resource))).toEqual([]);
  });

  it("a resource of a type the readout does not assess is not checked below its root", () => {
    // The Encounter is listed as a whole; its own members are not looked at, and the validator,
    // which has no model of it, says nothing about them.
    const resource = json({
      resourceType: "Bundle",
      type: "collection",
      entry: [{ resource: { resourceType: "Encounter", status: "cancelled", synNote: "x" } }],
    });
    expectDeclined(resource, ["Bundle.entry[0].resource"]);
    expect(unknownIn(validateResource(resource))).toEqual([]);
  });

  it("a caller's own schema still decides the members of the resource handed in", () => {
    const resource = json({
      resourceType: "Patient",
      synTag: "x",
      name: [{ family: "Synthfamily" }],
    });
    const schemas = [
      {
        type: "Patient",
        elements: {
          synTag: { min: 0, max: 1, types: ["string"] },
          name: { min: 0, max: Number.POSITIVE_INFINITY, types: ["HumanName"] },
        },
      },
    ];
    expect(unknownIn(validateResource(resource, { schemas }))).toEqual([]);
    // The readout has no such schema: the definitions do not define `synTag` on a Patient.
    expectDeclined(resource, ["Patient.synTag"]);
  });
});

describe("the reported cases decline, in XML", () => {
  it("entry on a Patient, and an extra element on a Bundle entry", () => {
    const patient = xml(
      `<Patient${NS}><id value="syn-pt-0005"/><entry><resource><Observation>` +
        `<status value="entered-in-error"/></Observation></resource></entry></Patient>`,
    );
    expectDeclined(patient, ["Patient.entry", "Patient.entry.resource"]);
    const bundle = xml(
      `<Bundle${NS}><type value="collection"/><entry><fullUrl value="urn:uuid:syn-0006"/>` +
        `<synNote><status value="entered-in-error"/></synNote>` +
        `<resource><Patient><id value="syn-pt-0006"/></Patient></resource></entry></Bundle>`,
    );
    expectDeclined(bundle, ["Bundle.entry.synNote"]);
    expect(unknownIn(validateResource(bundle))).toEqual([["Bundle.entry.synNote", "warning"]]);
  });

  it("a Basic placed directly under entry, alone and beside another element", () => {
    // Alone, the reader takes the tag as the entry's type, a stray `resourceType`, and the Basic's
    // members land on the entry: `id` is one an entry defines, `code` is not.
    expectDeclined(
      xml(
        `<Bundle${NS}><type value="collection"/><entry><Basic><id value="syn-b"/>` +
          `<code><text value="x"/></code></Basic></entry></Bundle>`,
      ),
      ["Bundle.entry", "Bundle.entry.code"],
    );
    // Beside `fullUrl`, it stays an element of the entry, which the definitions do not define.
    const beside = xml(
      `<Bundle${NS}><type value="collection"/><entry><fullUrl value="urn:uuid:syn-0007"/>` +
        `<Basic><id value="syn-b"/></Basic></entry></Bundle>`,
    );
    expectDeclined(beside, ["Bundle.entry.<withheld>"]);
    expect(unknownIn(validateResource(beside))).toEqual([["Bundle.entry.<withheld>", "warning"]]);
  });

  it("an undefined member of a datatype and of a contained resource", () => {
    const resource = xml(
      `<Observation${NS}><contained><Practitioner><id value="syn-pr-2"/>` +
        `<nickname value="syn"/></Practitioner></contained><status value="final"/>` +
        `<code><coding><system value="http://example.org/syn"/><code value="syn-2"/>` +
        `<display value="x"/><displayText value="y"/></coding></code></Observation>`,
    );
    expectDeclined(resource, [
      "Observation.contained.nickname",
      "Observation.code.coding.displayText",
    ]);
    expect(unknownIn(validateResource(resource, { mode: "strict" }))).toEqual([
      ["Observation.contained.nickname", "error"],
      ["Observation.code.coding.displayText", "error"],
    ]);
  });

  it("an undefined member of a primitive's extension", () => {
    const resource = xml(
      `<Patient${NS}><gender value="unknown"><extension url="http://example.org/syn">` +
        `<valueString value="x"/><note value="y"/></extension></gender></Patient>`,
    );
    expectDeclined(resource, ["Patient.gender.extension[0].note"]);
  });
});

describe("an XML element in a namespace other than its parent's declines, however declared", () => {
  // A default declaration keeps the tag spelled as the FHIR element, so the model holds it under
  // that name; the reader marks it, and the readout and the validator read the marker.
  const FINAL_CODE = `<code><text value="syn"/></code>`;

  it("a status in a vendor namespace by default declaration", () => {
    const resource = xml(
      `<Observation${NS}><status xmlns="urn:syn-vendor" value="final"/>${FINAL_CODE}</Observation>`,
    );
    expectDeclined(resource, ["Observation.status"]);
    expect(unknownIn(validateResource(resource))).toEqual([["Observation.status", "warning"]]);
    expect(unknownIn(validateResource(resource, { mode: "strict" }))).toEqual([
      ["Observation.status", "error"],
    ]);
  });

  it('a status in no namespace at all (xmlns="")', () => {
    const resource = xml(
      `<Observation${NS}><status xmlns="" value="final"/>${FINAL_CODE}</Observation>`,
    );
    expectDeclined(resource, ["Observation.status"]);
    expect(unknownIn(validateResource(resource))).toEqual([["Observation.status", "warning"]]);
  });

  it("a gender in a vendor namespace on a Patient", () => {
    const resource = xml(
      `<Patient${NS}><id value="syn-pt-0200"/><gender xmlns="urn:syn-vendor" value="female"/>` +
        `</Patient>`,
    );
    expectDeclined(resource, ["Patient.gender"]);
    expect(unknownIn(validateResource(resource))).toEqual([["Patient.gender", "warning"]]);
  });

  it("a Bundle entry's resource wrapper in a vendor namespace, around a FHIR resource", () => {
    const resource = xml(
      `<Bundle${NS}><type value="collection"/><entry><resource xmlns="urn:syn-vendor">` +
        `<Observation${NS}><status value="final"/>${FINAL_CODE}</Observation>` +
        `</resource></entry></Bundle>`,
    );
    expectDeclined(resource, ["Bundle.entry.resource"]);
    expect(unknownIn(validateResource(resource))).toEqual([["Bundle.entry.resource", "warning"]]);
  });

  it("a contained resource, a primitive's extension and a repeat beside a FHIR one", () => {
    const resource = xml(
      `<Observation${NS}><contained><Practitioner xmlns="urn:syn-vendor"><id value="syn-pr-3"/>` +
        `</Practitioner></contained><status value="final">` +
        `<extension xmlns="urn:syn-vendor" url="http://example.org/syn"><valueString value="x"/>` +
        `</extension></status>${FINAL_CODE}` +
        `<category><text value="syn-a"/></category><category xmlns=""><text value="syn-b"/>` +
        `</category></Observation>`,
    );
    expectDeclined(resource, [
      "Observation.contained",
      "Observation.status.extension[0]",
      "Observation.category[1]",
    ]);
  });

  it("a narrative div in a vendor namespace, while the XHTML one reads safe", () => {
    const vendor = xml(
      `<Observation${NS}><text><status value="generated"/>` +
        `<div xmlns="urn:syn-vendor">syn</div></text><status value="final"/>${FINAL_CODE}` +
        `</Observation>`,
    );
    expectDeclined(vendor, ["Observation.text.div"]);
    const xhtml = xml(
      `<Observation${NS}><text><status value="generated"/>` +
        `<div xmlns="http://www.w3.org/1999/xhtml">syn</div></text><status value="final"/>` +
        `${FINAL_CODE}</Observation>`,
    );
    expect(readSafety(xhtml).notAssessed).toEqual([]);
    expect(readSafety(xhtml).safeToSummarize).toBe(true);
  });

  it("a root in a vendor namespace, by default declaration or by prefix", () => {
    const body = `<status value="final"/><code><text value="syn"/></code>`;
    expectDeclined(xml(`<Observation xmlns="urn:syn-vendor">${body}</Observation>`), [
      "Observation",
    ]);
    expectDeclined(
      xml(
        `<v:Observation xmlns:v="urn:syn-vendor"><v:status value="final"/>` +
          `<v:code><v:text value="syn"/></v:code></v:Observation>`,
      ),
      ["Observation"],
    );
    // A root in no namespace at all is read as FHIR, as it always has been.
    expect(readSafety(xml(`<Observation>${body}</Observation>`)).safeToSummarize).toBe(true);
  });

  it("a prefixed foreign element is listed once, not once per occurrence", () => {
    const resource = xml(
      `<Observation${NS}><status value="final"/>${FINAL_CODE}` +
        `<v:status xmlns:v="urn:syn-vendor" value="a"/><v:status xmlns:v="urn:syn-vendor" value="b"/>` +
        `</Observation>`,
    );
    expectDeclined(resource, ["Observation.<withheld>"]);
  });
});

describe("a value written where the definitions put a complex type declines", () => {
  it("a string at a CodeableConcept and at a Coding, in JSON", () => {
    expectDeclined(json({ resourceType: "Observation", status: "final", code: "syn-code" }), [
      "Observation.code",
    ]);
    expectDeclined(
      json({
        resourceType: "Observation",
        status: "final",
        code: { coding: ["syn-code"] },
        category: ["syn-category"],
      }),
      ["Observation.code.coding[0]", "Observation.category[0]"],
    );
  });

  it("a value attribute at a CodeableConcept, in XML", () => {
    expectDeclined(
      xml(`<Observation${NS}><status value="final"/><code value="syn-code"/></Observation>`),
      ["Observation.code"],
    );
  });

  it("an element holding only an extension carries no value, and reads safe", () => {
    // The XML reader reads a complex element holding only `<extension>` as a value-absent
    // primitive; there is no string there for a flatten to read.
    const resource = xml(
      `<Observation${NS}><status value="final"/><code><extension url="http://example.org/syn">` +
        `<valueString value="x"/></extension></code></Observation>`,
    );
    expect(readSafety(resource).notAssessed).toEqual([]);
    expect(readSafety(resource).safeToSummarize).toBe(true);
  });
});

describe("the validator reports a resource tag placed directly under entry", () => {
  it("as an element of the entry the definitions do not define", () => {
    const bundle = xml(
      `<Bundle${NS}><type value="collection"/><entry><Basic><id value="syn-b"/></Basic>` +
        `</entry></Bundle>`,
    );
    expectDeclined(bundle, ["Bundle.entry"]);
    expect(unknownIn(validateResource(bundle))).toEqual([["Bundle.entry.resourceType", "warning"]]);
  });

  it("and a resourceType key on a JSON entry the same way", () => {
    const bundle = json({
      resourceType: "Bundle",
      type: "collection",
      entry: [{ resourceType: "Basic", id: "syn-b" }],
    });
    expectDeclined(bundle, ["Bundle.entry[0]"]);
    expect(unknownIn(validateResource(bundle))).toEqual([
      ["Bundle.entry[0].resourceType", "warning"],
    ]);
  });
});

describe("a conformant document is unaffected", () => {
  it("a Bundle of every assessed type, with backbones, datatypes and extensions, reads safe", () => {
    for (const document of RESOURCES.map((build) => build(0))) {
      const type = document["resourceType"] as string;
      const bundle = {
        resourceType: "Bundle",
        type: "collection",
        entry: [{ resource: document }],
      };
      const fromJson = json(bundle);
      expect(readSafety(fromJson).notAssessed, type).toEqual([]);
      expect(readSafety(fromJson).safeToSummarize, type).toBe(true);
      expect(unknownIn(validateResource(fromJson, { mode: "strict" }))).toEqual([]);
      const fromXml = xml(toXml(bundle));
      expect(readSafety(fromXml).notAssessed, type).toEqual([]);
      expect(readSafety(fromXml).safeToSummarize, type).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// The properties.

/**
 * Cases per property. The default keeps the ordinary suite quick; the fuzz depth (`FUZZ_RUNS`, 20000
 * in the CI fuzz job, `.github/workflows/ci.yml`, which the nightly run runs too) is the one to
 * judge the design at.
 */
const FUZZ_RUNS = Number.parseInt(process.env["FUZZ_RUNS"] ?? "", 10);
const RUNS = Number.isFinite(FUZZ_RUNS) && FUZZ_RUNS > 0 ? FUZZ_RUNS : 1000;
/**
 * Each property's time limit, raised with its case count: at the fuzz depth one property takes
 * longer than the suite's default limit on a GitHub runner, and a case count that cannot finish is
 * no deeper check.
 */
const TIMEOUT = Math.max(10_000, RUNS * 10);

type Json = string | number | boolean | JsonObject | Json[];
interface JsonObject {
  [name: string]: Json;
}

const CODING = { system: "http://example.org/syn-codes", code: "syn-1", display: "Synthetic" };
const CONCEPT = { coding: [CODING], text: "Synthetic concept" };
const SUBJECT = { reference: "Patient/syn-pt-0100", display: "Synthetic subject" };
const EXTENSION = {
  url: "http://example.org/syn-extension",
  valueCodeableConcept: { coding: [CODING] },
};

/**
 * One synthetic resource of each assessed type, each with backbone elements, datatypes and an
 * extension, and no modifier element the readout declines on. `depth` above 0 nests: a contained
 * resource, or (for the Bundle) entries of other resources, each one level shallower.
 */
const RESOURCES: readonly ((depth: number) => JsonObject)[] = [
  (depth) => ({
    resourceType: "Patient",
    id: "syn-pt-0100",
    extension: [EXTENSION],
    identifier: [{ system: "http://example.org/syn-mrn", value: "SYN-0100" }],
    name: [{ use: "official", family: "Synthfamily", given: ["Synthgiven"] }],
    telecom: [{ system: "phone", value: "555-0100", use: "home" }],
    gender: "unknown",
    contact: [{ relationship: [CONCEPT], name: { family: "Synthfamily" } }],
    communication: [{ language: CONCEPT, preferred: false }],
    ...(depth > 0 ? { contained: [nest(depth - 1, 1)] } : {}),
  }),
  (depth) => ({
    resourceType: "Observation",
    status: "final",
    category: [CONCEPT],
    code: CONCEPT,
    subject: SUBJECT,
    valueQuantity: {
      value: 72,
      unit: "beats/min",
      system: "http://unitsofmeasure.org",
      code: "/min",
    },
    referenceRange: [{ low: { value: 60 }, high: { value: 100 }, text: "Synthetic range" }],
    component: [
      { code: CONCEPT, valueString: "Synthetic part", extension: [EXTENSION] },
      { code: CONCEPT, valueCodeableConcept: CONCEPT },
    ],
    note: [{ text: "Synthetic note" }],
    ...(depth > 0 ? { contained: [nest(depth - 1, 2)] } : {}),
  }),
  () => ({
    resourceType: "Condition",
    clinicalStatus: {
      coding: [
        { system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active" },
      ],
    },
    code: CONCEPT,
    subject: SUBJECT,
    stage: [{ summary: CONCEPT }],
    evidence: [{ code: [CONCEPT] }],
  }),
  () => ({
    resourceType: "AllergyIntolerance",
    patient: SUBJECT,
    code: CONCEPT,
    reaction: [{ manifestation: [CONCEPT], severity: "mild", note: [{ text: "Synthetic" }] }],
  }),
  () => ({
    resourceType: "MedicationRequest",
    status: "active",
    intent: "order",
    medicationCodeableConcept: CONCEPT,
    subject: SUBJECT,
    dosageInstruction: [
      {
        text: "Synthetic dose",
        timing: { repeat: { frequency: 1, period: 1, periodUnit: "d" } },
        doseAndRate: [{ type: CONCEPT, doseQuantity: { value: 1, unit: "tablet" } }],
      },
    ],
    dispenseRequest: { numberOfRepeatsAllowed: 1, quantity: { value: 30 } },
  }),
  () => ({
    resourceType: "Immunization",
    status: "completed",
    vaccineCode: CONCEPT,
    patient: SUBJECT,
    occurrenceDateTime: "2020-01-01",
    performer: [{ actor: { display: "Synthetic" } }],
    protocolApplied: [{ doseNumberPositiveInt: 1 }],
  }),
  () => ({
    resourceType: "DiagnosticReport",
    status: "final",
    code: CONCEPT,
    subject: SUBJECT,
    media: [{ comment: "Synthetic", link: { reference: "Media/syn-m" } }],
  }),
  () => ({
    resourceType: "MedicationStatement",
    status: "active",
    medicationCodeableConcept: CONCEPT,
    subject: SUBJECT,
    dosage: [{ text: "Synthetic", route: CONCEPT }],
  }),
  () => ({
    resourceType: "Practitioner",
    name: [{ family: "Synthfamily" }],
    qualification: [{ code: CONCEPT, period: { start: "2020-01-01" } }],
  }),
  (depth) => ({
    resourceType: "Bundle",
    type: "collection",
    link: [{ relation: "self", url: "http://example.org/syn-bundle" }],
    entry: [
      { fullUrl: "urn:uuid:syn-0101", resource: nest(Math.max(depth - 1, 0), 3) },
      {
        fullUrl: "urn:uuid:syn-0102",
        resource: nest(Math.max(depth - 1, 0), 4),
        search: { mode: "match" },
      },
    ],
  }),
];

/** A resource `depth` levels deep, its type picked by `seed`; a Bundle only while depth remains. */
function nest(depth: number, seed: number): JsonObject {
  const pool = depth > 0 ? RESOURCES : RESOURCES.slice(0, -1);
  return (pool[seed % pool.length] as (depth: number) => JsonObject)(depth);
}

/** Where a node of the JSON tree sits: its location in JSON and in XML, which writes no `[0]` alone. */
interface Spot {
  readonly node: JsonObject;
  readonly json: string;
  readonly xml: string;
}

/** Every object node of a document, the root and every resource, backbone and datatype below it. */
function spots(root: JsonObject): Spot[] {
  const out: Spot[] = [];
  const visit = (node: JsonObject, at: string, atXml: string): void => {
    out.push({ node, json: at, xml: atXml });
    for (const [name, value] of Object.entries(node)) {
      const items = Array.isArray(value) ? value : [value];
      items.forEach((item, index) => {
        if (typeof item !== "object" || Array.isArray(item)) return;
        const suffix = Array.isArray(value) ? `[${String(index)}]` : "";
        const xmlSuffix = Array.isArray(value) && value.length > 1 ? `[${String(index)}]` : "";
        visit(item, `${childPath(at, name)}${suffix}`, `${childPath(atXml, name)}${xmlSuffix}`);
      });
    }
  };
  const type = root["resourceType"] as string;
  visit(root, type, type);
  return out;
}

/** The elements FHIR XML writes as a resource wrapped in its type's tag. */
const RESOURCE_POSITION_NAMES = new Set(["contained", "resource", "outcome"]);

/** A member whose every element is written in another namespace, by default declaration. */
interface ForeignTarget {
  readonly node: JsonObject;
  readonly name: string;
  readonly namespace: string;
}

/** FHIR XML for a JSON document of the shapes {@link RESOURCES} builds. */
function toXml(root: JsonObject, foreign?: ForeignTarget): string {
  const type = root["resourceType"] as string;
  return `<${type}${NS}>${content(root, foreign)}</${type}>`;
}

function escape(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

/** `source` is the builder's node `node` was copied from, which a {@link ForeignTarget} names. */
function content(node: JsonObject, foreign?: ForeignTarget, source: JsonObject = node): string {
  let out = "";
  for (const [name, value] of Object.entries(node)) {
    if (name === "resourceType") continue;
    const ns =
      foreign !== undefined && foreign.node === source && foreign.name === name
        ? ` xmlns="${foreign.namespace}"`
        : "";
    for (const item of Array.isArray(value) ? value : [value]) {
      if (Array.isArray(item)) throw new Error("the builders write no array inside an array");
      if (typeof item !== "object") {
        out += `<${name}${ns} value="${escape(String(item))}"/>`;
        continue;
      }
      const url = item["url"];
      if (RESOURCE_POSITION_NAMES.has(name) && typeof item["resourceType"] === "string") {
        out += `<${name}${ns}>${toXml(item, foreign).replace(NS, "")}</${name}>`;
      } else if (
        typeof url === "string" &&
        (name === "extension" || name === "modifierExtension")
      ) {
        const rest = Object.fromEntries(Object.entries(item).filter(([key]) => key !== "url"));
        out += `<${name}${ns} url="${escape(url)}">${content(rest, foreign, item)}</${name}>`;
      } else {
        out += `<${name}${ns}>${content(item, foreign)}</${name}>`;
      }
    }
  }
  return out;
}

/**
 * Names no context of the model defines: invented ones, a case variant, and a choice variant of a
 * type that does not exist. Lower case at the front, so XML keeps each as an element rather than
 * reading it as a resource's tag. Checked against the table below rather than assumed.
 */
const UNDEFINED_NAMES = [
  "synNote",
  "nonesuch",
  "valueSynthetic",
  "fullurl",
  "resourcetype",
  "entrys",
];
/** JSON only: a name in the wrong case at the front, which no element name ever is. */
const WRONG_CASE = ["Entry", "Contained", "Status", "Code", "Resource", "Extension"];

/** What the planted element holds: a value, a retraction, or a list holding a retracted resource. */
const PLANTED_VALUE: fc.Arbitrary<Json> = fc.constantFrom<Json>(
  "syn-value",
  { status: "entered-in-error" },
  [{ resourceType: "Observation", status: "entered-in-error" }],
);

const DOCUMENT = fc
  .tuple(fc.integer({ min: 0, max: 3 }), fc.nat({ max: RESOURCES.length - 1 }))
  .map(([depth, seed]) => nest(depth, seed));

/**
 * A copy of `document` with `name` holding `value` planted on its node at `pick`, and that node's
 * spot. The builders share their datatype objects, so the plant is made on a copy.
 */
function plant(
  document: JsonObject,
  pick: number,
  name: string,
  value: Json,
): { readonly planted: JsonObject; readonly spot: Spot } {
  const planted = structuredClone(document);
  const all = spots(planted);
  const spot = all[pick % all.length] as Spot;
  spot.node[name] = value;
  return { planted, spot };
}

function expectPlanted(resource: FhirComplex, location: string): void {
  const safety = readSafety(resource);
  expect(safety.notAssessed).toContain(location);
  expect(safety.safeToSummarize).toBe(false);
  expect(() => assertSafeToSummarize(resource)).toThrow(FhirSafetyError);
  expect(unknownIn(validateResource(resource, { mode: "strict" }))).toContainEqual([
    location,
    "error",
  ]);
  expect(unknownIn(validateResource(resource))).toContainEqual([location, "warning"]);
}

describe("property: an undefined element planted at random depth always declines", () => {
  it("the planted names are defined nowhere in the model", () => {
    const defined = new Set(
      Object.values(ELEMENT_DEFINITIONS).flatMap((names) =>
        names.split(" ").map((token) => token.split(":")[0]),
      ),
    );
    for (const name of [...UNDEFINED_NAMES, ...WRONG_CASE])
      expect(defined.has(name), name).toBe(false);
  });

  it(`JSON, ${String(RUNS)} cases`, { timeout: TIMEOUT }, () => {
    fc.assert(
      fc.property(
        DOCUMENT,
        fc.nat(),
        fc.constantFrom(...UNDEFINED_NAMES, ...WRONG_CASE),
        PLANTED_VALUE,
        (document, pick, name, value) => {
          const { planted, spot } = plant(document, pick, name, value);
          expectPlanted(json(planted), childPath(spot.json, name));
        },
      ),
      { numRuns: RUNS, seed: 20261111 },
    );
  });

  it(`XML, ${String(RUNS)} cases`, { timeout: TIMEOUT }, () => {
    fc.assert(
      fc.property(
        DOCUMENT,
        fc.nat(),
        fc.constantFrom(...UNDEFINED_NAMES),
        PLANTED_VALUE,
        (document, pick, name, value) => {
          const { planted, spot } = plant(document, pick, name, value);
          expectPlanted(xml(toXml(planted)), childPath(spot.xml, name));
        },
      ),
      { numRuns: RUNS, seed: 20261111 },
    );
  });

  it(
    `XML, an element moved to another namespace by default declaration, ${String(RUNS)} cases`,
    {
      timeout: TIMEOUT,
    },
    () => {
      fc.assert(
        fc.property(
          DOCUMENT,
          fc.nat(),
          fc.nat(),
          fc.constantFrom("urn:syn-vendor", ""),
          (document, pick, member, namespace) => {
            const all = spots(document);
            const spot = all[pick % all.length] as Spot;
            // An extension's `url` is an attribute in XML, not an element, so it has no namespace.
            const isExtension = /\.(?:modifierE|e)xtension(?:\[\d+\])?$/.test(spot.xml);
            const names = Object.keys(spot.node).filter(
              (name) => name !== "resourceType" && !(isExtension && name === "url"),
            );
            const name = names[member % names.length] as string;
            const value = spot.node[name] as Json;
            const count = Array.isArray(value) ? value.length : 1;
            const at = childPath(spot.xml, name);
            const locations =
              count > 1 ? Array.from({ length: count }, (_, i) => `${at}[${String(i)}]`) : [at];
            const resource = xml(toXml(document, { node: spot.node, name, namespace }));
            for (const location of locations) expectPlanted(resource, location);
          },
        ),
        { numRuns: RUNS, seed: 20261111 },
      );
    },
  );

  it(
    `converse: the same documents with nothing planted read safe (${String(RUNS)} cases)`,
    { timeout: TIMEOUT },
    () => {
      fc.assert(
        fc.property(DOCUMENT, fc.boolean(), (document, asXml) => {
          const resource = asXml ? xml(toXml(document)) : json(document);
          const safety = readSafety(resource);
          expect(safety.notAssessed).toEqual([]);
          expect(safety.safeToSummarize).toBe(true);
          expect(() => assertSafeToSummarize(resource)).not.toThrow();
          expect(unknownIn(validateResource(resource, { mode: "strict" }))).toEqual([]);
        }),
        { numRuns: RUNS, seed: 20261111 },
      );
    },
  );
});
