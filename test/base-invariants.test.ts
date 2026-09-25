/**
 * The R4 4.0.1 base constraints of the eight modeled types, evaluated by `validateResource` with no
 * profile supplied, and reported once when a supplied profile repeats them.
 *
 * Every document here is synthetic: the values are placeholders, the references point at
 * `Patient/p1` or at a contained resource in the same document, and no value resembles a person.
 */

import { describe, expect, it } from "vitest";

import {
  collectInvariantIssues,
  defineProfile,
  diagnosticFor,
  parseResource,
  parseResourceXml,
  serializeResource,
  serializeResourceXml,
  validateResource,
  type ProfileConstraintSpec,
  type ValidateOptions,
  type ValidationIssue,
  type ValidationResult,
} from "../src/index.js";

type Doc = Readonly<Record<string, unknown>>;

/** The eight modeled types. */
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

/** The 19 constraint keys R4 4.0.1 declares on the eight types and their base. */
const ALL_KEYS: ReadonlySet<string> = new Set([
  "ait-1",
  "ait-2",
  "con-1",
  "con-2",
  "con-3",
  "con-4",
  "con-5",
  "dom-2",
  "dom-3",
  "dom-4",
  "dom-5",
  "dom-6",
  "ele-1",
  "ext-1",
  "imm-1",
  "obs-3",
  "obs-6",
  "obs-7",
  "pat-1",
]);

function validate(doc: Doc, options?: ValidateOptions): ValidationResult {
  return validateResource(parseResource(JSON.stringify(doc)).resource, options);
}

/** Every finding carrying `key`, as `[code, severity, location]`. */
function carrying(result: ValidationResult, key: string): [string, string, string][] {
  return result.issues
    .filter((i) => i.constraint === key)
    .map((i) => [i.code, i.severity, i.expression]);
}

/** The keys of every invariant finding. */
function keysOf(issues: readonly ValidationIssue[]): string[] {
  return issues.flatMap((i) => (i.constraint === undefined ? [] : [i.constraint]));
}

const PATIENT_REF = { reference: "Patient/p1" };
const EIE = "entered-in-error";

/** A minimal document of each type that validates clean with no profile. */
const MINIMAL: Readonly<Record<(typeof MODELED_TYPES)[number], Doc>> = {
  AllergyIntolerance: {
    resourceType: "AllergyIntolerance",
    clinicalStatus: {
      coding: [
        {
          system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical",
          code: "active",
        },
      ],
    },
    patient: PATIENT_REF,
  },
  Condition: { resourceType: "Condition", subject: PATIENT_REF },
  DiagnosticReport: {
    resourceType: "DiagnosticReport",
    status: "final",
    code: { text: "synthetic panel" },
  },
  Immunization: {
    resourceType: "Immunization",
    status: "completed",
    vaccineCode: { text: "synthetic vaccine" },
    patient: PATIENT_REF,
    occurrenceDateTime: "2020-01-01",
  },
  MedicationRequest: {
    resourceType: "MedicationRequest",
    status: "active",
    intent: "order",
    medicationCodeableConcept: { text: "synthetic medication" },
    subject: PATIENT_REF,
  },
  MedicationStatement: {
    resourceType: "MedicationStatement",
    status: "active",
    medicationCodeableConcept: { text: "synthetic medication" },
    subject: PATIENT_REF,
  },
  Observation: { resourceType: "Observation", status: "final", code: { text: "synthetic" } },
  Patient: { resourceType: "Patient" },
};

/** A contained Practitioner the containing resource references, carrying no meta. */
const CONTAINED_PRACTITIONER = { resourceType: "Practitioner", id: "pr1", active: true };

/** One contained entry that violates each DomainResource key. */
const DOMAIN_VIOLATIONS: Readonly<Record<"dom-2" | "dom-4" | "dom-5", Doc>> = {
  "dom-2": {
    contained: [
      {
        resourceType: "Practitioner",
        id: "pr1",
        contained: [{ resourceType: "Organization", id: "org1", active: true }],
      },
    ],
  },
  "dom-4": {
    contained: [
      { resourceType: "Practitioner", id: "pr1", meta: { lastUpdated: "2020-01-01T00:00:00Z" } },
    ],
  },
  "dom-5": {
    contained: [
      {
        resourceType: "Practitioner",
        id: "pr1",
        meta: { security: [{ system: "http://example.org/security", code: "synthetic" }] },
      },
    ],
  },
};

/** A document violating each type-specific key the base-constraint layer and the safety layer own. */
const TYPE_KEY_VIOLATIONS: Readonly<Record<string, Doc>> = {
  "ait-1": { ...MINIMAL.AllergyIntolerance, clinicalStatus: undefined },
  "ait-2": {
    ...MINIMAL.AllergyIntolerance,
    verificationStatus: {
      coding: [
        {
          system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",
          code: EIE,
        },
      ],
    },
  },
  "con-1": { ...MINIMAL.Condition, stage: [{ type: { text: "synthetic" } }] },
  "con-2": {
    ...MINIMAL.Condition,
    evidence: [{ extension: [{ url: "http://example.org/e", valueString: "x" }] }],
  },
  "con-4": {
    ...MINIMAL.Condition,
    clinicalStatus: {
      coding: [
        { system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active" },
      ],
    },
    abatementDateTime: "2020-01-01",
  },
  "con-5": {
    ...MINIMAL.Condition,
    clinicalStatus: {
      coding: [
        { system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active" },
      ],
    },
    verificationStatus: {
      coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-ver-status", code: EIE }],
    },
  },
  "imm-1": { ...MINIMAL.Immunization, education: [{ publicationDate: "2020-01-01" }] },
  "obs-3": { ...MINIMAL.Observation, referenceRange: [{ type: { text: "synthetic" } }] },
  "obs-6": { ...MINIMAL.Observation, valueString: "x", dataAbsentReason: { text: "synthetic" } },
  "obs-7": {
    ...MINIMAL.Observation,
    code: { coding: [{ system: "http://loinc.org", code: "8867-4" }] },
    valueString: "x",
    component: [{ code: { coding: [{ system: "http://loinc.org", code: "8867-4" }] } }],
  },
  "pat-1": { ...MINIMAL.Patient, contact: [{ gender: "other" }] },
};

/** The error-severity keys each type declares of its own. */
const OWN_ERROR_KEYS: Readonly<Record<(typeof MODELED_TYPES)[number], readonly string[]>> = {
  AllergyIntolerance: ["ait-1", "ait-2"],
  Condition: ["con-1", "con-2", "con-4", "con-5"],
  DiagnosticReport: [],
  Immunization: ["imm-1"],
  MedicationRequest: [],
  MedicationStatement: [],
  Observation: ["obs-3", "obs-6", "obs-7"],
  Patient: ["pat-1"],
};

describe("the controls: each minimal document validates clean with no profile", () => {
  for (const type of MODELED_TYPES) {
    it(`AC-1: a minimal ${type} is valid and draws no invariant finding`, () => {
      const result = validate(MINIMAL[type]);
      expect(result.issues.filter((i) => i.code.startsWith("INVARIANT"))).toEqual([]);
      expect(result.valid).toBe(true);
    });
  }
});

describe("AC-1: each error-severity constraint on the type and on DomainResource is evaluated", () => {
  for (const type of MODELED_TYPES) {
    for (const key of ["dom-2", "dom-4", "dom-5"] as const) {
      it(`AC-1: ${key} is evaluated on a ${type} with no profile`, () => {
        const result = validate({ ...MINIMAL[type], ...DOMAIN_VIOLATIONS[key] });
        expect(carrying(result, key)).toEqual([["INVARIANT_VIOLATED", "error", type]]);
        expect(result.valid).toBe(false);
      });
    }

    it(`AC-1: dom-3 is reported on a ${type} carrying a contained resource, never assumed`, () => {
      const result = validate({ ...MINIMAL[type], contained: [CONTAINED_PRACTITIONER] });
      expect(carrying(result, "dom-3")).toEqual([["INVARIANT_UNCHECKED", "information", type]]);
    });

    for (const key of OWN_ERROR_KEYS[type]) {
      it(`AC-1: ${key} is evaluated on a ${type} with no profile`, () => {
        const result = validate(TYPE_KEY_VIOLATIONS[key] ?? {});
        expect(carrying(result, key).map(([code, severity]) => [code, severity])).toEqual([
          ["INVARIANT_VIOLATED", "error"],
        ]);
        expect(result.valid).toBe(false);
      });
    }
  }
});

describe("AC-2 / AC-7: dom-3, outside the subset with contained content, decided without", () => {
  it("AC-2: a constraint outside the subset is INVARIANT_UNCHECKED naming its key, never satisfied", () => {
    const result = validate({
      resourceType: "Patient",
      contained: [CONTAINED_PRACTITIONER],
      generalPractitioner: [{ reference: "#pr1" }],
    });
    const dom3 = result.issues.filter((i) => i.constraint === "dom-3");
    expect(dom3).toEqual([
      {
        code: "INVARIANT_UNCHECKED",
        severity: "information",
        type: "informational",
        expression: "Patient",
        constraint: "dom-3",
      },
    ]);
  });

  it("AC-7: a contained entry draws dom-3 unchecked and no dom-3 violation, referenced or not", () => {
    const unreferenced = validate({ resourceType: "Patient", contained: [CONTAINED_PRACTITIONER] });
    expect(carrying(unreferenced, "dom-3")).toEqual([
      ["INVARIANT_UNCHECKED", "information", "Patient"],
    ]);
  });

  it("AC-7: no contained entry draws no dom-3 finding", () => {
    expect(carrying(validate({ resourceType: "Patient" }), "dom-3")).toEqual([]);
    expect(carrying(validate({ resourceType: "Patient", contained: [] }), "dom-3")).toEqual([]);
    expect(
      carrying(
        validate({ resourceType: "Observation", status: "final", code: { text: "x" } }),
        "dom-3",
      ),
    ).toEqual([]);
  });
});

describe("AC-7: a type-matching profile whose snapshot carries R4's dom-3 as written", () => {
  /** R4 4.0.1 dom-3, verbatim: every R4-derived snapshot carries it at the root. */
  const DOM3 =
    "contained.where((('#'+id in (%resource.descendants().reference | %resource.descendants().as(canonical) | %resource.descendants().as(uri) | %resource.descendants().as(url))) or descendants().where(reference = '#').exists() or descendants().where(as(canonical) = '#').exists() or descendants().where(as(canonical) = '#').exists()).not()).trace('unmatched', id).empty()";

  function carryingDom3(type: string, expression: string): ReturnType<typeof defineProfile> {
    return defineProfile({
      url: `http://example.org/StructureDefinition/${type}-carries-dom-3`,
      type,
      snapshot: [{ path: type, constraint: [{ key: "dom-3", severity: "error", expression }] }],
    });
  }

  for (const type of MODELED_TYPES) {
    it(`AC-7: a ${type} with no contained entry draws no dom-3 finding under the profile`, () => {
      const profiles = [carryingDom3(type, DOM3)];
      expect(carrying(validate(MINIMAL[type], { profiles }), "dom-3")).toEqual([]);
      expect(
        carrying(validate({ ...MINIMAL[type], contained: [] }, { profiles }), "dom-3"),
      ).toEqual([]);
    });
  }

  it("AC-7: a contained entry still draws exactly one dom-3 INVARIANT_UNCHECKED under the profile", () => {
    const result = validate(
      {
        resourceType: "Patient",
        contained: [CONTAINED_PRACTITIONER],
        generalPractitioner: [{ reference: "#pr1" }],
      },
      { profiles: [carryingDom3("Patient", DOM3)] },
    );
    expect(carrying(result, "dom-3")).toEqual([["INVARIANT_UNCHECKED", "information", "Patient"]]);
  });

  it("AC-11: collectInvariantIssues, called directly, still reports the profile's dom-3 unchecked", () => {
    const resource = parseResource('{"resourceType":"Patient"}').resource;
    expect(collectInvariantIssues(resource, carryingDom3("Patient", DOM3))).toEqual([
      {
        code: "INVARIANT_UNCHECKED",
        severity: "information",
        type: "informational",
        expression: "Patient",
        constraint: "dom-3",
      },
    ]);
  });

  it("AC-2: a profile's dom-3 written otherwise, outside the subset, is still reported unchecked", () => {
    // Not R4's expression (this is the later spelling, `ofType` for `as`): the base layer's decision
    // is about R4's own dom-3, so a different expression under the key is never assumed to hold.
    const other = DOM3.replaceAll("as(", "ofType(");
    const result = validate(MINIMAL.Patient, { profiles: [carryingDom3("Patient", other)] });
    expect(carrying(result, "dom-3")).toEqual([["INVARIANT_UNCHECKED", "information", "Patient"]]);
  });
});

describe("AC-3: each listed key returns valid false at the violating occurrence", () => {
  const cases: readonly { key: string; doc: Doc; at: string }[] = [
    { key: "pat-1", doc: TYPE_KEY_VIOLATIONS["pat-1"] ?? {}, at: "Patient.contact[0]" },
    { key: "obs-3", doc: TYPE_KEY_VIOLATIONS["obs-3"] ?? {}, at: "Observation.referenceRange[0]" },
    { key: "con-1", doc: TYPE_KEY_VIOLATIONS["con-1"] ?? {}, at: "Condition.stage[0]" },
    { key: "con-2", doc: TYPE_KEY_VIOLATIONS["con-2"] ?? {}, at: "Condition.evidence[0]" },
    { key: "imm-1", doc: TYPE_KEY_VIOLATIONS["imm-1"] ?? {}, at: "Immunization.education[0]" },
    { key: "dom-2", doc: { ...MINIMAL.Patient, ...DOMAIN_VIOLATIONS["dom-2"] }, at: "Patient" },
    { key: "dom-4", doc: { ...MINIMAL.Patient, ...DOMAIN_VIOLATIONS["dom-4"] }, at: "Patient" },
    { key: "dom-5", doc: { ...MINIMAL.Patient, ...DOMAIN_VIOLATIONS["dom-5"] }, at: "Patient" },
    {
      key: "ext-1",
      doc: { resourceType: "Patient", extension: [{ url: "http://example.org/e" }] },
      at: "Patient.extension[0]",
    },
    {
      key: "ext-1",
      doc: {
        resourceType: "Patient",
        extension: [
          {
            url: "http://example.org/e",
            valueString: "x",
            extension: [{ url: "part", valueString: "y" }],
          },
        ],
      },
      at: "Patient.extension[0]",
    },
  ];
  for (const { key, doc, at } of cases) {
    it(`AC-3: ${key} is INVARIANT_VIOLATED at error, at ${at}`, () => {
      const result = validate(doc);
      expect(carrying(result, key)).toEqual([["INVARIANT_VIOLATED", "error", at]]);
      expect(result.valid).toBe(false);
    });
  }

  const good = {
    contact: { telecom: [{ system: "url", value: "http://example.org/contact" }] },
    referenceRange: { text: "synthetic range" },
    stage: { summary: { text: "synthetic" } },
    evidence: { code: [{ text: "synthetic" }] },
    education: { documentType: "synthetic" },
    extension: { url: "http://example.org/e", valueBoolean: true },
  };
  const bad = {
    contact: { gender: "other" },
    referenceRange: { type: { text: "synthetic" } },
    stage: { type: { text: "synthetic" } },
    evidence: { detail: [] as unknown[], id: "e1" },
    education: { publicationDate: "2020-01-01" },
    extension: { url: "http://example.org/e" },
  };
  const occurrenceCases: readonly {
    key: string;
    type: (typeof MODELED_TYPES)[number];
    element: keyof typeof good;
  }[] = [
    { key: "pat-1", type: "Patient", element: "contact" },
    { key: "obs-3", type: "Observation", element: "referenceRange" },
    { key: "con-1", type: "Condition", element: "stage" },
    { key: "con-2", type: "Condition", element: "evidence" },
    { key: "imm-1", type: "Immunization", element: "education" },
    { key: "ext-1", type: "Patient", element: "extension" },
  ];
  for (const { key, type, element } of occurrenceCases) {
    it(`AC-3: two violating ${element} occurrences draw two ${key} findings, the conformant one none`, () => {
      const result = validate({
        ...MINIMAL[type],
        [element]: [bad[element], good[element], bad[element]],
      });
      expect(carrying(result, key)).toEqual([
        ["INVARIANT_VIOLATED", "error", `${type}.${element}[0]`],
        ["INVARIANT_VIOLATED", "error", `${type}.${element}[2]`],
      ]);
    });
  }
});

describe("AC-4: a key the safety layer evaluates is reported exactly once", () => {
  const SAFETY_EXPRESSIONS: Readonly<Record<string, string>> = {
    "ait-1":
      "verificationStatus.coding.where(system = 'http://terminology.hl7.org/CodeSystem/allergyintolerance-verification' and code = 'entered-in-error').exists() or clinicalStatus.exists()",
    "ait-2":
      "verificationStatus.coding.where(system = 'http://terminology.hl7.org/CodeSystem/allergyintolerance-verification' and code = 'entered-in-error').empty() or clinicalStatus.empty()",
    "con-4":
      "abatement.empty() or clinicalStatus.coding.where(system='http://terminology.hl7.org/CodeSystem/condition-clinical' and (code='resolved' or code='remission' or code='inactive')).exists()",
    "con-5":
      "verificationStatus.coding.where(system='http://terminology.hl7.org/CodeSystem/condition-ver-status' and code='entered-in-error').empty() or clinicalStatus.empty()",
    "obs-6": "dataAbsentReason.empty() or value.empty()",
    "obs-7":
      "value.empty() or component.code.where(coding.intersect(%resource.code.coding).exists()).empty()",
  };
  const TYPE_OF: Readonly<Record<string, string>> = {
    "ait-1": "AllergyIntolerance",
    "ait-2": "AllergyIntolerance",
    "con-4": "Condition",
    "con-5": "Condition",
    "obs-6": "Observation",
    "obs-7": "Observation",
  };
  for (const [key, expression] of Object.entries(SAFETY_EXPRESSIONS)) {
    const type = TYPE_OF[key] ?? "";
    const doc = TYPE_KEY_VIOLATIONS[key] ?? {};
    it(`AC-4: ${key} is reported once with no profile`, () => {
      expect(carrying(validate(doc), key)).toHaveLength(1);
    });
    it(`AC-4: ${key} is reported once with a ${type} profile whose snapshot carries it`, () => {
      const profile = defineProfile({
        url: `http://example.org/StructureDefinition/carries-${key}`,
        type,
        snapshot: [{ path: type, constraint: [{ key, severity: "error", expression }] }],
      });
      expect(carrying(validate(doc, { profiles: [profile] }), key)).toHaveLength(1);
    });
  }
});

describe("AC-6: ele-1 and ext-1 at every depth outside contained", () => {
  const cases: readonly { name: string; key: string; doc: Doc; at: string }[] = [
    {
      name: "ele-1 at a datatype element (CodeableConcept)",
      key: "ele-1",
      doc: { resourceType: "Patient", maritalStatus: {} },
      at: "Patient.maritalStatus",
    },
    {
      name: "ele-1 at a datatype element (HumanName)",
      key: "ele-1",
      doc: { resourceType: "Patient", name: [{ id: "n1" }] },
      at: "Patient.name[0]",
    },
    {
      name: "ele-1 at a backbone element",
      key: "ele-1",
      doc: { resourceType: "Patient", communication: [{}] },
      at: "Patient.communication[0]",
    },
    {
      name: "ele-1 at a primitive's _-sibling extension",
      key: "ele-1",
      doc: {
        resourceType: "Patient",
        birthDate: "1970-01-01",
        _birthDate: { extension: [{ id: "x1" }] },
      },
      at: "Patient.birthDate.extension[0]",
    },
    {
      name: "ele-1 at an extension nested inside an extension",
      key: "ele-1",
      doc: {
        resourceType: "Patient",
        extension: [{ url: "http://example.org/outer", extension: [{ id: "x2" }] }],
      },
      at: "Patient.extension[0].extension[0]",
    },
    {
      name: "ele-1 at a modifierExtension",
      key: "ele-1",
      doc: { resourceType: "Patient", modifierExtension: [{ id: "x3" }] },
      at: "Patient.modifierExtension[0]",
    },
    {
      name: "ele-1 at a primitive with neither a value nor an extension",
      key: "ele-1",
      doc: { resourceType: "Patient", birthDate: null, _birthDate: { id: "b1" } },
      at: "Patient.birthDate",
    },
    {
      name: "ext-1 at a datatype element (HumanName)",
      key: "ext-1",
      doc: {
        resourceType: "Patient",
        name: [{ use: "official", extension: [{ url: "http://example.org/e" }] }],
      },
      at: "Patient.name[0].extension[0]",
    },
    {
      name: "ext-1 at a backbone element",
      key: "ext-1",
      doc: {
        resourceType: "Patient",
        contact: [
          {
            telecom: [{ system: "url", value: "http://example.org/contact" }],
            extension: [
              {
                url: "http://example.org/e",
                valueString: "x",
                extension: [{ url: "p", valueString: "y" }],
              },
            ],
          },
        ],
      },
      at: "Patient.contact[0].extension[0]",
    },
    {
      name: "ext-1 at a primitive's _-sibling extension",
      key: "ext-1",
      doc: {
        resourceType: "Patient",
        birthDate: "1970-01-01",
        _birthDate: { extension: [{ url: "http://example.org/e" }] },
      },
      at: "Patient.birthDate.extension[0]",
    },
    {
      name: "ext-1 at an extension nested inside an extension",
      key: "ext-1",
      doc: {
        resourceType: "Patient",
        extension: [{ url: "http://example.org/outer", extension: [{ url: "inner" }] }],
      },
      at: "Patient.extension[0].extension[0]",
    },
    {
      name: "ext-1 at a modifierExtension",
      key: "ext-1",
      doc: { resourceType: "Patient", modifierExtension: [{ url: "http://example.org/m" }] },
      at: "Patient.modifierExtension[0]",
    },
  ];
  for (const { name, key, doc, at } of cases) {
    it(`AC-6: ${name}`, () => {
      const result = validate(doc);
      expect(carrying(result, key)).toEqual([["INVARIANT_VIOLATED", "error", at]]);
      expect(result.valid).toBe(false);
    });
  }

  it("AC-6: an element or extension inside a contained resource is not evaluated", () => {
    const result = validate({
      resourceType: "Patient",
      contained: [
        {
          resourceType: "Practitioner",
          id: "pr1",
          extension: [{ url: "http://example.org/e" }],
          name: [{}],
        },
      ],
    });
    expect(carrying(result, "ele-1")).toEqual([]);
    expect(carrying(result, "ext-1")).toEqual([]);
  });
});

describe("AC-8: dom-6 is not evaluated with no profile", () => {
  for (const type of MODELED_TYPES) {
    it(`AC-8: a ${type} with no narrative draws no dom-6 finding and stays valid`, () => {
      const result = validate(MINIMAL[type]);
      expect(carrying(result, "dom-6")).toEqual([]);
      expect(result.valid).toBe(true);
    });
  }
});

/** An extension carrying a value, and one carrying only nested extensions. */
const VALUE_EXTENSION = {
  url: "http://example.org/fhir/StructureDefinition/synthetic-flag",
  valueBoolean: true,
};
const NESTED_EXTENSION = {
  url: "http://example.org/fhir/StructureDefinition/synthetic-complex",
  extension: [
    { url: "part-a", valueString: "synthetic" },
    { url: "part-b", valueCode: "synthetic" },
  ],
};
/**
 * A `_`-sibling carrying an `id` and an extension with a value: `ele-1` counts the `id` among the
 * primitive's children and against it, so the extension is what satisfies it.
 */
const PRIMITIVE_EXTENSION = {
  id: "synthetic-note",
  extension: [
    { url: "http://example.org/fhir/StructureDefinition/synthetic-note", valueString: "synthetic" },
  ],
};
const NARRATIVE = {
  status: "generated",
  div: '<div xmlns="http://www.w3.org/1999/xhtml"><p>Synthetic narrative</p></div>',
};
const COMMON = {
  text: NARRATIVE,
  contained: [CONTAINED_PRACTITIONER],
  extension: [VALUE_EXTENSION],
  // A value-absent primitive carrying an `id` and an extension, which R4 allows: ele-1 holds
  // because the extension is a child other than the `id`.
  _language: PRIMITIVE_EXTENSION,
};
const CONTAINED_REF = { reference: "#pr1" };

/**
 * A conformant document of each type, populating every anchor the type has: a root extension
 * carrying a value, an extension carrying only nested extensions, a primitive's `_`-sibling, a
 * contained resource it references, and the type's own anchors.
 *
 * The extension carrying only nested extensions sits one level below the root, on a backbone
 * element or a datatype. At the root, the XML reader models an extension-only element with no
 * value as a primitive (a declared schema-free residual of that reader), and the root schema then
 * reports it as a type mismatch whatever this layer does; one level down, the same reading draws
 * only the reader's warning about the `url` attribute, which the XML leg pins below.
 */
const CONFORMANT: Readonly<Record<(typeof MODELED_TYPES)[number], Doc>> = {
  AllergyIntolerance: {
    resourceType: "AllergyIntolerance",
    id: "ai1",
    ...COMMON,
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
          code: "confirmed",
        },
      ],
    },
    code: { text: "synthetic substance" },
    patient: PATIENT_REF,
    recordedDate: "2020-01-01",
    _recordedDate: PRIMITIVE_EXTENSION,
    recorder: CONTAINED_REF,
    reaction: [
      { manifestation: [{ text: "synthetic manifestation" }], extension: [NESTED_EXTENSION] },
    ],
  },
  Condition: {
    resourceType: "Condition",
    id: "c1",
    ...COMMON,
    clinicalStatus: {
      coding: [
        { system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active" },
      ],
    },
    verificationStatus: {
      coding: [
        { system: "http://terminology.hl7.org/CodeSystem/condition-ver-status", code: "confirmed" },
      ],
    },
    code: { text: "synthetic condition" },
    subject: PATIENT_REF,
    recordedDate: "2020-01-01",
    _recordedDate: PRIMITIVE_EXTENSION,
    recorder: CONTAINED_REF,
    stage: [{ summary: { text: "synthetic stage" }, extension: [NESTED_EXTENSION] }],
    evidence: [{ code: [{ text: "synthetic evidence" }] }],
  },
  DiagnosticReport: {
    resourceType: "DiagnosticReport",
    id: "dr1",
    ...COMMON,
    status: "final",
    _status: PRIMITIVE_EXTENSION,
    code: { text: "synthetic panel", extension: [NESTED_EXTENSION] },
    subject: PATIENT_REF,
    performer: [CONTAINED_REF],
    conclusion: "synthetic conclusion",
  },
  Immunization: {
    resourceType: "Immunization",
    id: "im1",
    ...COMMON,
    status: "completed",
    _status: PRIMITIVE_EXTENSION,
    vaccineCode: { text: "synthetic vaccine" },
    patient: PATIENT_REF,
    occurrenceDateTime: "2020-01-01",
    performer: [{ actor: CONTAINED_REF }],
    education: [
      {
        documentType: "synthetic-document",
        publicationDate: "2020-01-01",
        extension: [NESTED_EXTENSION],
      },
    ],
  },
  MedicationRequest: {
    resourceType: "MedicationRequest",
    id: "mr1",
    ...COMMON,
    status: "active",
    _status: PRIMITIVE_EXTENSION,
    intent: "order",
    medicationCodeableConcept: { text: "synthetic medication" },
    subject: PATIENT_REF,
    requester: CONTAINED_REF,
    dispenseRequest: { numberOfRepeatsAllowed: 1, extension: [NESTED_EXTENSION] },
    substitution: { allowedBoolean: true },
  },
  MedicationStatement: {
    resourceType: "MedicationStatement",
    id: "ms1",
    ...COMMON,
    status: "active",
    _status: PRIMITIVE_EXTENSION,
    medicationCodeableConcept: { text: "synthetic medication", extension: [NESTED_EXTENSION] },
    subject: PATIENT_REF,
    informationSource: CONTAINED_REF,
  },
  Observation: {
    resourceType: "Observation",
    id: "o1",
    ...COMMON,
    status: "final",
    _status: PRIMITIVE_EXTENSION,
    code: { coding: [{ system: "http://loinc.org", code: "2345-7" }], text: "synthetic" },
    subject: PATIENT_REF,
    performer: [CONTAINED_REF],
    valueString: "synthetic result",
    referenceRange: [{ text: "synthetic range" }],
    component: [
      {
        code: { coding: [{ system: "http://loinc.org", code: "8480-6" }] },
        valueString: "synthetic component",
        extension: [NESTED_EXTENSION],
      },
    ],
  },
  Patient: {
    resourceType: "Patient",
    id: "p1",
    ...COMMON,
    gender: "other",
    birthDate: "1970-01-01",
    _birthDate: PRIMITIVE_EXTENSION,
    contact: [
      {
        telecom: [{ system: "url", value: "http://example.org/contact" }],
        extension: [NESTED_EXTENSION],
      },
      { organization: CONTAINED_REF },
    ],
    generalPractitioner: [CONTAINED_REF],
  },
};

/** Where each conformant document carries its extension that holds only nested extensions. */
const NESTED_EXTENSION_AT: Readonly<Record<(typeof MODELED_TYPES)[number], string>> = {
  AllergyIntolerance: "AllergyIntolerance.reaction.extension",
  Condition: "Condition.stage.extension",
  DiagnosticReport: "DiagnosticReport.code.extension",
  Immunization: "Immunization.education.extension",
  MedicationRequest: "MedicationRequest.dispenseRequest.extension",
  MedicationStatement: "MedicationStatement.medicationCodeableConcept.extension",
  Observation: "Observation.component.extension",
  Patient: "Patient.contact[0].extension",
};

describe("AC-9: a conformant document of each type validates clean, from JSON and from XML", () => {
  for (const type of MODELED_TYPES) {
    const json = JSON.stringify(CONFORMANT[type]);

    it(`AC-9: a conformant ${type} read from JSON is valid with no INVARIANT_VIOLATED`, () => {
      const read = parseResource(json);
      expect(read.issues).toEqual([]);
      const result = validateResource(read.resource);
      expect(result.issues.filter((i) => i.code === "INVARIANT_VIOLATED")).toEqual([]);
      expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
      expect(result.valid).toBe(true);
    });

    it(`AC-9: the same ${type} read from its XML spelling is valid with no INVARIANT_VIOLATED`, () => {
      const xml = serializeResourceXml(parseResource(json).resource);
      const read = parseResourceXml(xml);
      // The one reader warning is the declared schema-free residual: an extension holding only
      // nested extensions reads as a primitive, so its `url` attribute is reported unknown.
      expect(read.issues).toEqual([
        {
          code: "UNKNOWN_PROPERTY",
          severity: "warning",
          expression: `${NESTED_EXTENSION_AT[type]}.@url`,
        },
      ]);
      const result = validateResource(read.resource);
      expect(result.issues.filter((i) => i.code === "INVARIANT_VIOLATED")).toEqual([]);
      expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
      expect(result.valid).toBe(true);
    });
  }
});

/** A snapshot carrying the four base constraints AC-10 names, at the paths R4 carries them. */
function baseConstraintProfile(): ReturnType<typeof defineProfile> {
  const c = (key: string, expression: string): ProfileConstraintSpec[] => [
    { key, severity: "error", expression },
  ];
  return defineProfile({
    url: "http://example.org/StructureDefinition/patient-base-constraints",
    type: "Patient",
    snapshot: [
      { path: "Patient", constraint: c("dom-2", "contained.contained.empty()") },
      {
        path: "Patient.maritalStatus",
        constraint: c("ele-1", "hasValue() or (children().count() > id.count())"),
      },
      {
        path: "Patient.extension",
        constraint: c("ext-1", "extension.exists() != value.exists()"),
      },
      {
        path: "Patient.contact",
        constraint: c(
          "pat-1",
          "name.exists() or telecom.exists() or address.exists() or organization.exists()",
        ),
      },
    ],
  });
}

/** A Patient violating each of the four at exactly one occurrence. */
const VIOLATES_FOUR_ONCE: Doc = {
  resourceType: "Patient",
  contained: [
    {
      resourceType: "Practitioner",
      id: "pr1",
      contained: [{ resourceType: "Organization", id: "org1", active: true }],
    },
  ],
  maritalStatus: {},
  extension: [{ url: "http://example.org/e" }],
  contact: [{ gender: "other" }],
};

describe("AC-10: a profile carrying a base constraint does not double its finding", () => {
  for (const key of ["dom-2", "ele-1", "ext-1", "pat-1"]) {
    it(`AC-10: ${key} violated at one occurrence is reported once with the profile`, () => {
      const result = validate(VIOLATES_FOUR_ONCE, { profiles: [baseConstraintProfile()] });
      expect(
        result.issues.filter((i) => i.code === "INVARIANT_VIOLATED" && i.constraint === key),
      ).toHaveLength(1);
    });
  }

  it("AC-10: a lone occurrence written without an array is reported once too", () => {
    const result = validate(
      {
        resourceType: "Patient",
        contact: { gender: "other" },
        extension: { url: "http://example.org/e" },
      },
      { profiles: [baseConstraintProfile()] },
    );
    expect(carrying(result, "pat-1")).toEqual([["INVARIANT_VIOLATED", "error", "Patient.contact"]]);
    expect(carrying(result, "ext-1")).toEqual([
      ["INVARIANT_VIOLATED", "error", "Patient.extension"],
    ]);
  });

  it("AC-10: a profile constraint the base layer does not make is still reported", () => {
    const profile = defineProfile({
      url: "http://example.org/StructureDefinition/patient-local",
      type: "Patient",
      snapshot: [
        {
          path: "Patient",
          constraint: [{ key: "local-1", severity: "error", expression: "active.exists()" }],
        },
      ],
    });
    expect(
      carrying(validate({ resourceType: "Patient" }, { profiles: [profile] }), "local-1"),
    ).toEqual([["INVARIANT_VIOLATED", "error", "Patient"]]);
  });
});

describe("AC-11: collectInvariantIssues, called directly, still reports every base key its profile carries", () => {
  it("AC-11: reports dom-2, ele-1, ext-1 and pat-1 exactly as the profile layer evaluates them", () => {
    const resource = parseResource(JSON.stringify(VIOLATES_FOUR_ONCE)).resource;
    const issues = collectInvariantIssues(resource, baseConstraintProfile());
    expect(issues).toEqual([
      {
        code: "INVARIANT_VIOLATED",
        severity: "error",
        type: "invariant",
        expression: "Patient",
        constraint: "dom-2",
      },
      {
        code: "INVARIANT_VIOLATED",
        severity: "error",
        type: "invariant",
        expression: "Patient.maritalStatus",
        constraint: "ele-1",
      },
      {
        code: "INVARIANT_VIOLATED",
        severity: "error",
        type: "invariant",
        expression: "Patient.extension",
        constraint: "ext-1",
      },
      {
        code: "INVARIANT_VIOLATED",
        severity: "error",
        type: "invariant",
        expression: "Patient.contact",
        constraint: "pat-1",
      },
    ]);
  });
});

describe("AC-12: a type outside the eight, or an unreadable type, draws none of the 19 keys", () => {
  const violations = {
    extension: [{ url: "http://example.org/e" }],
    contact: [{ gender: "other" }],
    maritalStatus: {},
    contained: [{ resourceType: "Practitioner", id: "pr1", meta: { versionId: "2" } }],
  };
  for (const resourceType of ["Practitioner", "SyntheticUnmodeled"]) {
    it(`AC-12: ${resourceType} draws no base-constraint finding and stays RESOURCE_NOT_MODELED`, () => {
      const result = validate({ resourceType, ...violations });
      expect(keysOf(result.issues).filter((key) => ALL_KEYS.has(key))).toEqual([]);
      expect(result.issues.map((i) => i.code)).toContain("RESOURCE_NOT_MODELED");
    });
  }
  const unreadable: readonly [string, Doc][] = [
    ["an array-wrapped type", { resourceType: ["Patient"], ...violations }],
    ["no type at all", { ...violations }],
    ["a number for a type", { resourceType: 7, ...violations }],
  ];
  for (const [name, doc] of unreadable) {
    it(`AC-12: ${name} draws no base-constraint finding`, () => {
      expect(keysOf(validate(doc).issues).filter((key) => ALL_KEYS.has(key))).toEqual([]);
    });
  }
});

describe("AC-14: no finding echoes a value from a violating instance", () => {
  let n = 0;
  const sentinels: string[] = [];
  /** A fresh sentinel, distinct from every other and from anything a location can spell. */
  const s = (): string => {
    n += 1;
    const value = `QZSENTINEL${String(n)}QZ`;
    sentinels.push(value);
    return value;
  };
  const ext = (): Doc => ({ url: `http://example.org/${s()}`, valueString: s() });
  const containedWith = (extra: Doc): Doc => ({
    resourceType: "Practitioner",
    id: s(),
    extension: [ext()],
    ...extra,
  });
  const documents: readonly Doc[] = [
    {
      resourceType: "Patient",
      id: s(),
      extension: [ext()],
      contact: [{ gender: s(), extension: [ext()] }],
      telecom: [{ system: "url", value: s() }],
    },
    {
      resourceType: "Observation",
      id: s(),
      status: s(),
      code: { text: s(), coding: [{ system: `http://example.org/${s()}`, code: s() }] },
      subject: { reference: `Patient/${s()}` },
      referenceRange: [{ type: { text: s() }, extension: [ext()] }],
    },
    {
      resourceType: "Condition",
      id: s(),
      subject: { reference: `Patient/${s()}` },
      stage: [{ type: { text: s() } }],
      evidence: [{ extension: [ext()] }],
    },
    {
      resourceType: "Immunization",
      id: s(),
      status: s(),
      patient: { reference: `Patient/${s()}` },
      education: [{ publicationDate: s(), extension: [ext()] }],
    },
    {
      resourceType: "Patient",
      id: s(),
      generalPractitioner: [{ reference: `#${s()}` }],
      contained: [
        containedWith({ contained: [{ resourceType: "Organization", id: s(), name: s() }] }),
        containedWith({ meta: { versionId: s(), lastUpdated: "2020-01-01T00:00:00Z" } }),
        containedWith({ meta: { security: [{ system: `http://example.org/${s()}`, code: s() }] } }),
      ],
    },
    {
      resourceType: "Patient",
      id: s(),
      extension: [
        { url: `http://example.org/${s()}` },
        { url: `http://example.org/${s()}`, valueString: s(), extension: [ext()] },
      ],
      _gender: { extension: [{ url: `http://example.org/${s()}` }] },
      gender: "other",
    },
  ];

  it("AC-14: every listed key is violated somewhere in the sweep", () => {
    const keys = new Set(
      documents.flatMap((doc) =>
        validate(doc)
          .issues.filter((i) => i.code === "INVARIANT_VIOLATED")
          .map((i) => i.constraint),
      ),
    );
    for (const key of [
      "pat-1",
      "obs-3",
      "con-1",
      "con-2",
      "imm-1",
      "dom-2",
      "dom-4",
      "dom-5",
      "ext-1",
    ]) {
      expect(keys.has(key), `${key} is not violated by any sweep document`).toBe(true);
    }
  });

  it("AC-14: no expression, diagnostic or OperationOutcome carries a sentinel", () => {
    for (const doc of documents) {
      const result = validate(doc);
      const outcome = serializeResource(result.toOperationOutcome());
      for (const issue of result.issues) {
        const surfaces = [issue.expression, diagnosticFor(issue.code), issue.constraint ?? ""];
        for (const sentinel of sentinels) {
          for (const surface of surfaces) expect(surface).not.toContain(sentinel);
        }
      }
      for (const sentinel of sentinels) expect(outcome).not.toContain(sentinel);
    }
  });
});

describe("AC-16: an anchor the evaluation cannot read as an element never validates clean", () => {
  const anchors: readonly {
    type: (typeof MODELED_TYPES)[number];
    element: string;
    conformant: Doc;
  }[] = [
    {
      type: "Patient",
      element: "contact",
      conformant: { telecom: [{ system: "url", value: "http://example.org/c" }] },
    },
    { type: "Observation", element: "referenceRange", conformant: { text: "synthetic range" } },
    { type: "Condition", element: "stage", conformant: { summary: { text: "synthetic" } } },
    { type: "Condition", element: "evidence", conformant: { code: [{ text: "synthetic" }] } },
    { type: "Immunization", element: "education", conformant: { documentType: "synthetic" } },
  ];
  for (const { type, element, conformant } of anchors) {
    it(`AC-16: the ${type}.${element} control, a conformant occurrence, is valid`, () => {
      expect(validate({ ...MINIMAL[type], [element]: [conformant] }).valid).toBe(true);
    });
    const shapes: readonly [string, unknown][] = [
      ["a JSON string", "synthetic"],
      ["a JSON number", 5],
      ["a JSON null", null],
      ["a JSON string in the array", ["synthetic"]],
      ["a JSON number in the array", [5]],
      ["a JSON null in the array", [null]],
      ["a string beside a conformant occurrence", [conformant, "synthetic"]],
      ["a conformant occurrence wrapped in a nested array", [[conformant]]],
    ];
    for (const [name, value] of shapes) {
      it(`AC-16: ${type}.${element} as ${name} is not valid`, () => {
        expect(validate({ ...MINIMAL[type], [element]: value }).valid).toBe(false);
      });
    }
  }
});
