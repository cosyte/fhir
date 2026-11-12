/**
 * `readPatientAnimal` reads the R4 `patient-animal` extension (extension-patient-animal.html):
 * a complex extension on Patient, `0..1`, with the sub-extensions `species` (`1..1`), `breed`
 * (`0..1`) and `genderStatus` (`0..1`), each carrying a `valueCodeableConcept`. Every fixture here
 * is synthetic: the codes, systems and names are plainly made up.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  complex,
  getProperty,
  isPrimitive,
  list,
  parseResource,
  parseResourceXml,
  PATIENT_ANIMAL_EXTENSION_URL,
  primitive,
  readPatientAnimal,
  serializeResourceXml,
  type FhirComplex,
  type FhirNode,
} from "../src/index.js";
import { resource as resourceArbitrary } from "../src/arbitraries/index.js";
import { propertyRun } from "./_property-run.js";

const ANIMAL_URL = "http://hl7.org/fhir/StructureDefinition/patient-animal";
const SYSTEM = "http://example.org/fhir/CodeSystem/synthetic-animal";

/** A synthetic CodeableConcept. */
function concept(code: string): Record<string, unknown> {
  return { coding: [{ system: SYSTEM, code }], text: `text-${code}` };
}

/** A sub-extension of the animal extension. */
function sub(url: string, code: string): Record<string, unknown> {
  return { url, valueCodeableConcept: concept(code) };
}

/** A Patient carrying the given patient-level extensions. */
function patient(extension: unknown, extra: Record<string, unknown> = {}): FhirComplex {
  return parseResource(JSON.stringify({ resourceType: "Patient", ...extra, extension })).resource;
}

/** The `text` of a CodeableConcept read back, or `undefined`. */
function textOf(node: FhirNode | undefined): string | undefined {
  if (node === undefined || node.kind !== "complex") return undefined;
  const text = getProperty(node, "text");
  return text !== undefined && isPrimitive(text) && typeof text.value === "string"
    ? text.value
    : undefined;
}

const FULL = [
  { url: "http://example.org/fhir/StructureDefinition/synthetic-other", valueString: "syn" },
  {
    url: ANIMAL_URL,
    extension: [
      sub("species", "syn-species-1"),
      sub("breed", "syn-breed-1"),
      sub("genderStatus", "syn-gender-status-1"),
    ],
  },
];

describe("readPatientAnimal", () => {
  it("names the canonical URL of the extension", () => {
    expect(PATIENT_ANIMAL_EXTENSION_URL).toBe(ANIMAL_URL);
  });

  it("reads species, breed and genderStatus as CodeableConcepts", () => {
    const animal = readPatientAnimal(patient(FULL));
    expect(animal).toBeDefined();
    expect(textOf(animal?.species)).toBe("text-syn-species-1");
    expect(textOf(animal?.breed)).toBe("text-syn-breed-1");
    expect(textOf(animal?.genderStatus)).toBe("text-syn-gender-status-1");
    expect(animal?.issues).toEqual([]);
    // The concept is the model node itself, coding and all.
    const coding =
      animal?.species === undefined ? undefined : getProperty(animal.species, "coding");
    expect(coding?.kind).toBe("list");
  });

  it("returns undefined for a Patient without the extension", () => {
    expect(readPatientAnimal(patient(undefined))).toBeUndefined();
    expect(readPatientAnimal(patient([FULL[0]]))).toBeUndefined();
  });

  it("returns undefined for a resource that is not a Patient", () => {
    const { resource } = parseResource(
      JSON.stringify({ resourceType: "Observation", extension: [FULL[1]] }),
    );
    expect(readPatientAnimal(resource)).toBeUndefined();
  });

  it("leaves the optional parts undefined when they are absent", () => {
    const animal = readPatientAnimal(
      patient([{ url: ANIMAL_URL, extension: [sub("species", "syn-a")] }]),
    );
    expect(textOf(animal?.species)).toBe("text-syn-a");
    expect(animal?.breed).toBeUndefined();
    expect(animal?.genderStatus).toBeUndefined();
    expect(animal?.issues).toEqual([]);
    // Every part is a property of the readout, present even when it holds nothing.
    expect(Object.keys(animal ?? {})).toEqual(["species", "breed", "genderStatus", "issues"]);
  });

  it("reports a coded issue when the extension lacks species (1..1)", () => {
    const animal = readPatientAnimal(
      patient([FULL[0], { url: ANIMAL_URL, extension: [sub("breed", "syn-b")] }]),
    );
    expect(animal?.species).toBeUndefined();
    expect(textOf(animal?.breed)).toBe("text-syn-b");
    expect(animal?.issues).toEqual([
      {
        code: "CARDINALITY_MIN",
        severity: "error",
        type: "required",
        expression: "Patient.extension[1].extension:species",
      },
    ]);
  });

  it("reports a missing species on an extension that carries no sub-extension at all", () => {
    const animal = readPatientAnimal(patient({ url: ANIMAL_URL }));
    expect(animal).toBeDefined();
    expect(animal?.issues.map((i) => [i.code, i.expression])).toEqual([
      ["CARDINALITY_MIN", "Patient.extension[0].extension:species"],
    ]);
  });

  it("refuses to pick between two animal extensions (0..1)", () => {
    const animal = readPatientAnimal(patient([FULL[1], FULL[0], FULL[1]]));
    expect(animal?.species).toBeUndefined();
    expect(animal?.breed).toBeUndefined();
    expect(animal?.genderStatus).toBeUndefined();
    expect(animal?.issues.map((i) => [i.code, i.expression])).toEqual([
      ["CARDINALITY_MAX", "Patient.extension[2]"],
    ]);
  });

  it("refuses to pick between two species", () => {
    const animal = readPatientAnimal(
      patient([
        {
          url: ANIMAL_URL,
          extension: [sub("species", "syn-a"), sub("breed", "syn-b"), sub("species", "syn-c")],
        },
      ]),
    );
    expect(animal?.species).toBeUndefined();
    expect(textOf(animal?.breed)).toBe("text-syn-b");
    expect(animal?.issues.map((i) => [i.code, i.expression])).toEqual([
      ["CARDINALITY_MAX", "Patient.extension[0].extension[2]"],
    ]);
  });

  it("reports a sub-extension with no value and reads nothing from it", () => {
    const animal = readPatientAnimal(
      patient([{ url: ANIMAL_URL, extension: [sub("species", "syn-a"), { url: "genderStatus" }] }]),
    );
    expect(animal?.genderStatus).toBeUndefined();
    expect(animal?.issues.map((i) => [i.code, i.expression])).toEqual([
      ["CARDINALITY_MIN", "Patient.extension[0].extension[1].value[x]"],
    ]);
  });

  it("reports a value of another type and does not read it as a CodeableConcept", () => {
    const animal = readPatientAnimal(
      patient([
        {
          url: ANIMAL_URL,
          extension: [{ url: "species", valueCoding: { system: SYSTEM, code: "syn-a" } }],
        },
      ]),
    );
    expect(animal?.species).toBeUndefined();
    expect(animal?.issues.map((i) => [i.code, i.expression])).toEqual([
      ["TYPE_MISMATCH", "Patient.extension[0].extension[0].value[x]"],
    ]);
  });

  it("reports a CodeableConcept written as a string", () => {
    const animal = readPatientAnimal(
      patient([
        { url: ANIMAL_URL, extension: [{ url: "species", valueCodeableConcept: "syn-a" }] },
      ]),
    );
    expect(animal?.species).toBeUndefined();
    expect(animal?.issues.map((i) => [i.code, i.expression])).toEqual([
      ["TYPE_MISMATCH", "Patient.extension[0].extension[0].valueCodeableConcept"],
    ]);
  });

  it("reports a CodeableConcept beside another value variant as ambiguous", () => {
    const animal = readPatientAnimal(
      patient([
        {
          url: ANIMAL_URL,
          extension: [{ ...sub("species", "syn-a"), valueString: "syn-b" }],
        },
      ]),
    );
    expect(animal?.species).toBeUndefined();
    expect(animal?.issues.map((i) => [i.code, i.expression])).toEqual([
      ["CHOICE_AMBIGUOUS", "Patient.extension[0].extension[0].value[x]"],
    ]);
  });

  it("refuses a sub-extension whose value property is repeated", () => {
    const text = `{"resourceType":"Patient","extension":[{"url":"${ANIMAL_URL}","extension":[{"url":"species","valueCodeableConcept":{"text":"syn-a"},"valueCodeableConcept":{"text":"syn-b"}}]}]}`;
    const animal = readPatientAnimal(parseResource(text).resource);
    expect(animal?.species).toBeUndefined();
    expect(animal?.issues.map((i) => [i.code, i.expression])).toEqual([
      ["DUPLICATE_PROPERTY", "Patient.extension[0].extension[0].valueCodeableConcept"],
    ]);
  });

  it("refuses a sub-extension whose url is repeated", () => {
    const text = `{"resourceType":"Patient","extension":[{"url":"${ANIMAL_URL}","extension":[{"url":"species","url":"breed","valueCodeableConcept":{"text":"syn-a"}}]}]}`;
    const animal = readPatientAnimal(parseResource(text).resource);
    expect(animal?.species).toBeUndefined();
    expect(animal?.breed).toBeUndefined();
    expect(animal?.issues.map((i) => [i.code, i.expression])).toEqual([
      ["DUPLICATE_PROPERTY", "Patient.extension[0].extension[0].url"],
    ]);
  });

  it("says nothing of a repeated url on a sub-extension that names no part", () => {
    const text = `{"resourceType":"Patient","extension":[{"url":"${ANIMAL_URL}","extension":[{"url":"http://example.org/a","url":"http://example.org/b","valueString":"syn"},${JSON.stringify(sub("species", "syn-a"))}]}]}`;
    const animal = readPatientAnimal(parseResource(text).resource);
    expect(textOf(animal?.species)).toBe("text-syn-a");
    expect(animal?.issues).toEqual([]);
  });

  it("refuses an animal extension whose url is repeated", () => {
    const text = `{"resourceType":"Patient","extension":[{"url":"${ANIMAL_URL}","url":"http://example.org/fhir/synthetic","extension":[${JSON.stringify(sub("species", "syn-a"))}]}]}`;
    const animal = readPatientAnimal(parseResource(text).resource);
    expect(animal?.species).toBeUndefined();
    expect(animal?.issues.map((i) => [i.code, i.expression])).toEqual([
      ["DUPLICATE_PROPERTY", "Patient.extension[0].url"],
    ]);
  });

  it("refuses an animal extension whose extension property is repeated", () => {
    const text = `{"resourceType":"Patient","extension":[{"url":"${ANIMAL_URL}","extension":[${JSON.stringify(sub("species", "syn-a"))}],"extension":[${JSON.stringify(sub("species", "syn-b"))}]}]}`;
    const animal = readPatientAnimal(parseResource(text).resource);
    expect(animal?.species).toBeUndefined();
    expect(animal?.issues.map((i) => [i.code, i.expression])).toEqual([
      ["DUPLICATE_PROPERTY", "Patient.extension[0].extension"],
    ]);
  });

  it("refuses when the Patient's extension property is repeated around an animal extension", () => {
    const text = `{"resourceType":"Patient","extension":[${JSON.stringify(FULL[1])}],"extension":[${JSON.stringify(FULL[0])}]}`;
    const animal = readPatientAnimal(parseResource(text).resource);
    expect(animal?.species).toBeUndefined();
    expect(animal?.issues.map((i) => [i.code, i.expression])).toEqual([
      ["DUPLICATE_PROPERTY", "Patient.extension"],
    ]);
  });

  it("reads past sub-extensions it does not name", () => {
    const animal = readPatientAnimal(
      patient([
        {
          url: ANIMAL_URL,
          extension: [
            { url: "http://example.org/fhir/synthetic-sub", valueString: "syn" },
            sub("species", "syn-a"),
          ],
        },
      ]),
    );
    expect(textOf(animal?.species)).toBe("text-syn-a");
    expect(animal?.issues).toEqual([]);
  });

  it("reads past a member that is not an element, at either level", () => {
    // The JSON reader does not hand a primitive to an extension list beside an object, so the
    // model is built directly here.
    const species = complex([
      { name: "url", value: primitive("species") },
      { name: "valueCodeableConcept", value: complex([{ name: "text", value: primitive("syn") }]) },
    ]);
    const node = complex([
      { name: "resourceType", value: primitive("Patient") },
      {
        name: "extension",
        value: list([
          primitive("syn-not-an-element"),
          complex([
            { name: "url", value: primitive(ANIMAL_URL) },
            { name: "extension", value: list([primitive("syn-not-an-element"), species]) },
          ]),
        ]),
      },
    ]);
    const animal = readPatientAnimal(node);
    expect(textOf(animal?.species)).toBe("syn");
    expect(animal?.issues).toEqual([]);
  });

  it("keeps every value out of every issue", () => {
    const animal = readPatientAnimal(
      patient([
        {
          url: ANIMAL_URL,
          extension: [{ url: "species", valueCodeableConcept: "syn-secret-value" }],
        },
      ]),
    );
    for (const issue of animal?.issues ?? []) {
      expect(JSON.stringify(issue)).not.toContain("syn-secret");
    }
  });
});

/** Which parts one generated extension carries, and in what order. */
interface Arrangement {
  readonly before: number;
  readonly after: number;
  readonly species: string | undefined;
  readonly breed: string | undefined;
  readonly genderStatus: string | undefined;
  readonly others: number;
  readonly order: readonly number[];
}

const code = fc.stringMatching(/^syn-[a-z0-9]{1,12}$/);

const arrangement: fc.Arbitrary<Arrangement> = fc.record({
  before: fc.nat({ max: 3 }),
  after: fc.nat({ max: 3 }),
  species: fc.option(code, { nil: undefined }),
  breed: fc.option(code, { nil: undefined }),
  genderStatus: fc.option(code, { nil: undefined }),
  others: fc.nat({ max: 3 }),
  order: fc.shuffledSubarray([0, 1, 2, 3, 4, 5, 6, 7], { minLength: 8, maxLength: 8 }),
});

/** The Patient JSON an arrangement describes. */
function patientJson(a: Arrangement): string {
  const other = (i: number): Record<string, unknown> => ({
    url: `http://example.org/fhir/StructureDefinition/synthetic-${String(i)}`,
    valueString: "syn",
  });
  const subs: Record<string, unknown>[] = [];
  if (a.species !== undefined) subs.push(sub("species", a.species));
  if (a.breed !== undefined) subs.push(sub("breed", a.breed));
  if (a.genderStatus !== undefined) subs.push(sub("genderStatus", a.genderStatus));
  for (let i = 0; i < a.others; i++) subs.push(other(100 + i));
  const ordered = a.order
    .filter((i) => i < subs.length)
    .map((i) => subs[i] as Record<string, unknown>);
  const extension = [
    ...Array.from({ length: a.before }, (_, i) => other(i)),
    ordered.length === 0 ? { url: ANIMAL_URL } : { url: ANIMAL_URL, extension: ordered },
    ...Array.from({ length: a.after }, (_, i) => other(10 + i)),
  ];
  return JSON.stringify({ resourceType: "Patient", extension });
}

describe("readPatientAnimal properties", () => {
  it("reads each part written, leaves each absent part undefined, and reports a missing species", () => {
    fc.assert(
      fc.property(arrangement, (a) => {
        const animal = readPatientAnimal(parseResource(patientJson(a)).resource);
        expect(animal).toBeDefined();
        expect(textOf(animal?.species)).toBe(
          a.species === undefined ? undefined : `text-${a.species}`,
        );
        expect(textOf(animal?.breed)).toBe(a.breed === undefined ? undefined : `text-${a.breed}`);
        expect(textOf(animal?.genderStatus)).toBe(
          a.genderStatus === undefined ? undefined : `text-${a.genderStatus}`,
        );
        expect(animal?.issues).toEqual(
          a.species === undefined
            ? [
                {
                  code: "CARDINALITY_MIN",
                  severity: "error",
                  type: "required",
                  expression: `Patient.extension[${String(a.before)}].extension:species`,
                },
              ]
            : [],
        );
      }),
      propertyRun({ numRuns: 200, seed: 479 }),
    );
  });

  it("reads the same parts from the XML form of the same Patient", () => {
    fc.assert(
      fc.property(arrangement, (a) => {
        const json = parseResource(patientJson(a)).resource;
        const xml = parseResourceXml(serializeResourceXml(json)).resource;
        // XML does not say whether a lone `coding` was an array, so the parts are compared by what
        // both forms carry: the concept's text, and the issues.
        const fromJson = readPatientAnimal(json);
        const fromXml = readPatientAnimal(xml);
        for (const part of ["species", "breed", "genderStatus"] as const) {
          expect(textOf(fromXml?.[part])).toBe(textOf(fromJson?.[part]));
        }
        expect(fromXml?.issues).toEqual(fromJson?.issues);
      }),
      propertyRun({ numRuns: 100, seed: 4790 }),
    );
  });

  it("never throws on a generated resource, and answers only for a Patient", () => {
    fc.assert(
      fc.property(resourceArbitrary(), (node) => {
        const animal = readPatientAnimal(node);
        const type = getProperty(node, "resourceType");
        const isPatient = type !== undefined && isPrimitive(type) && type.value === "Patient";
        if (!isPatient) expect(animal).toBeUndefined();
      }),
      propertyRun({ numRuns: 100, seed: 4791 }),
    );
  });
});
