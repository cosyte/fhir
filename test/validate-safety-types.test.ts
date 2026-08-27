/**
 * The resource types this library treats as SAFETY-CRITICAL, checked against their own elements.
 *
 * Two halves live here. The first is REGISTRY COMPLETENESS: every built-in element table graded
 * against the R4 4.0.1 element definitions rather than against the code that consumes it. The
 * second is the per-type BEHAVIOUR sweep at the bottom of the file: one conformant minimal document
 * per type drawing nothing at all, and one document per finding the layer can produce.
 *
 * WHY THIS FILE EXISTS AND WHY IT IS DATA-DRIVEN. The registry treats a registered type as FULLY
 * DESCRIBED: any property a table does not name draws `UNKNOWN_ELEMENT`, and any element it does not
 * carry is never cardinality-checked. So a table missing one row R4 defines manufactures an error on
 * a conformant document, and a table that invents an optional where R4 says mandatory turns an
 * invalid document valid. Both are fail-OPEN, and neither is visible from a suite that only asks
 * "does the validator check cardinality". The question here is only ever "is the TABLE right".
 *
 * THE EXPECTATION IS COMMITTED SPEC DATA, NOT PROSE. `test/__data__/r4-direct-elements.json` is a
 * FIELD-SUBSET PROJECTION of the published R4 4.0.1 StructureDefinitions, carrying every
 * `snapshot.element` UNFILTERED. Only fields were dropped, never rows: each entry keeps `path`,
 * `min`, `max`, the `type[].code` list, and `binding.strength` / `binding.valueSet`. It also carries
 * the enumerated code set behind each required-strength `code` binding, resolved from the published
 * `valuesets.json` bundle. Every source URL is recorded in the file's own `provenance` block.
 *
 * **Which elements are "direct" is decided HERE, by rule, not in the data.** The projection is
 * unfiltered precisely so that the "exactly one path segment below the resource root" rule is
 * applied by this test and can therefore be wrong in only one place instead of two. A row this test
 * forgets to look at is a row it fails to grade, and the counts below are asserted for that reason.
 *
 * TO RE-DERIVE the data, take each `provenance` URL, and for every member of `snapshot.element` keep
 * `path`, `min`, `max`, `type[].code`, and `binding.strength` / `binding.valueSet` where present; for
 * every value set a required-strength `code` binding names, resolve `compose.include` against the
 * bundle (an `include` carrying `concept` enumerates those codes; one carrying only a `system`
 * takes that CodeSystem's concepts depth-first, in document order).
 *
 * NOT GRADED HERE: `Patient`, which is not a safety-critical type, and `Observation`, whose own
 * table is graded element by element against the published definitions in
 * `test/validate-observation.test.ts` and whose StructureDefinition is not part of this data set.
 * Both are asserted REGISTERED below, which is the half of the contract this file owns for them.
 */

import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";

import {
  SAFETY_RESOURCE_TYPES,
  baseSchema,
  buildRegistry,
  parseResource,
  UNBOUNDED,
  validateResource,
  type ElementSchema,
} from "../src/index.js";

// -- the committed projection ---------------------------------------------------------------------

/** One `snapshot.element`, with only the fields the projection keeps. */
interface ProjectedElement {
  readonly path: string;
  readonly min: number;
  readonly max: string;
  readonly types?: readonly string[];
  readonly binding?: { readonly strength: string; readonly valueSet: string };
}

interface ProjectedType {
  readonly url: string;
  readonly version: string;
  readonly elements: readonly ProjectedElement[];
}

interface ProjectionFile {
  readonly fhirVersion: string;
  readonly provenance: Readonly<Record<string, string>>;
  readonly types: Readonly<Record<string, ProjectedType>>;
  readonly valueSets: Readonly<Record<string, { readonly codes: readonly string[] }>>;
}

const R4 = JSON.parse(
  readFileSync(new URL("./__data__/r4-direct-elements.json", import.meta.url), "utf8"),
) as ProjectionFile;

/** The six types the projection carries, in the order it carries them. */
const PROJECTED_TYPES = Object.keys(R4.types);

// -- the rule: what a direct element is, and what it is called ------------------------------------

/**
 * The element R4 defines at `<Type>.<name>`, expressed the way the registry keys it.
 *
 * `name` is the `[x]` BASE for a choice, because the registry resolves an instance property
 * `effectiveDateTime` against an element named `effective`. A table naming the instance-side
 * spelling resolves nothing and draws a false unknown-element finding on a conformant document.
 */
interface DirectElement {
  readonly name: string;
  readonly isChoice: boolean;
  readonly min: number;
  readonly max: number;
  readonly types: readonly string[];
  readonly binding?: { readonly strength: string; readonly valueSet: string };
}

/** Every element exactly one path segment below the resource root, by the rule stated above. */
function directElements(type: string): DirectElement[] {
  const prefix = `${type}.`;
  const projected = R4.types[type]?.elements;
  if (projected === undefined) throw new Error(`no projection for ${type}`);
  return projected
    .filter((element) => {
      if (!element.path.startsWith(prefix)) return false;
      return !element.path.slice(prefix.length).includes(".");
    })
    .map((element) => {
      const tail = element.path.slice(prefix.length);
      const isChoice = tail.endsWith("[x]");
      const row: DirectElement = {
        name: isChoice ? tail.slice(0, -"[x]".length) : tail,
        isChoice,
        min: element.min,
        max: element.max === "*" ? UNBOUNDED : Number(element.max),
        types: element.types ?? [],
      };
      return element.binding === undefined ? row : { ...row, binding: element.binding };
    });
}

/** The base-resource element names the registry merges into every table. */
const BASE_NAMES = new Set(Object.keys(baseSchema("x").elements));

/** A registered type's OWN elements: what the registry returns, less the merged-in base. */
function ownElements(type: string): Record<string, ElementSchema> {
  const schema = buildRegistry()(type);
  expect(schema, `${type} is not registered in the built-in schema set`).toBeDefined();
  return Object.fromEntries(
    Object.entries(schema?.elements ?? {}).filter(([name]) => !BASE_NAMES.has(name)),
  );
}

/**
 * The completeness verdict for one type: what R4 defines that the table omits, and what the table
 * names that R4 does not define. BOTH directions, because only one of them is the fail-safe one.
 */
function nameDelta(
  type: string,
  table: Readonly<Record<string, unknown>>,
): { readonly missing: string[]; readonly extra: string[] } {
  const defined = new Set(
    directElements(type)
      .map((element) => element.name)
      .filter((name) => !BASE_NAMES.has(name)),
  );
  const named = new Set(Object.keys(table));
  return {
    missing: [...defined].filter((name) => !named.has(name)).sort(),
    extra: [...named].filter((name) => !defined.has(name)).sort(),
  };
}

// -- the data is the data it says it is -----------------------------------------------------------

describe("the committed R4 projection", () => {
  it("carries the six StructureDefinitions this change models, at 4.0.1", () => {
    expect(R4.fhirVersion).toBe("4.0.1");
    expect(PROJECTED_TYPES.sort()).toEqual([
      "AllergyIntolerance",
      "Condition",
      "DiagnosticReport",
      "Immunization",
      "MedicationRequest",
      "MedicationStatement",
    ]);
    for (const type of PROJECTED_TYPES) {
      expect(R4.types[type]?.version, type).toBe("4.0.1");
      expect(R4.provenance[type], type).toContain("hl7.org/fhir/R4/");
    }
  });

  it("is UNFILTERED, so the direct-element rule is applied here and not in the data", () => {
    // Every type carries strictly more snapshot elements than it has direct ones, which is only
    // true because the backbone children and the datatype internals were kept.
    for (const type of PROJECTED_TYPES) {
      const all = R4.types[type]?.elements.length ?? 0;
      expect(all, type).toBeGreaterThan(directElements(type).length);
    }
  });

  it("counts the direct elements each type defines, base elements included", () => {
    // A count is the one assertion that reds when a ROW goes missing from the projection, which no
    // name-by-name comparison against a table derived from the same rows can catch.
    expect(Object.fromEntries(PROJECTED_TYPES.map((t) => [t, directElements(t).length]))).toEqual({
      DiagnosticReport: 26,
      Condition: 25,
      MedicationRequest: 40,
      AllergyIntolerance: 24,
      Immunization: 36,
      MedicationStatement: 25,
    });
  });

  it("defines every base-resource element the registry merges in, on every type", () => {
    // The other direction of the merge: a base element R4 did NOT define at this path would
    // suppress a true unknown-element finding on every registered type at once.
    for (const type of PROJECTED_TYPES) {
      const defined = new Set(directElements(type).map((element) => element.name));
      for (const name of BASE_NAMES) expect(defined.has(name), `${type}.${name}`).toBe(true);
    }
  });
});

// -- AC1 + AC3: every safety-critical type is registered ------------------------------------------

describe("the built-in schema registry over the safety-critical resource types", () => {
  it("names seven types, and the six modeled here are six of them", () => {
    expect(SAFETY_RESOURCE_TYPES.size).toBe(7);
    for (const type of PROJECTED_TYPES) {
      expect(SAFETY_RESOURCE_TYPES.has(type), type).toBe(true);
    }
    expect([...SAFETY_RESOURCE_TYPES].filter((t) => !PROJECTED_TYPES.includes(t))).toEqual([
      "Observation",
    ]);
  });

  it("returns a schema for every one of the seven, and for Patient", () => {
    const registry = buildRegistry();
    for (const type of [...SAFETY_RESOURCE_TYPES, "Patient"]) {
      expect(registry(type), `${type} is not registered`).toBeDefined();
    }
  });

  it("returns no schema for a type it has no table for, so that type degrades safely", () => {
    // The fail-safe half of the contract, and the reason an INCOMPLETE table must stay out of the
    // registry rather than go in partially: an unregistered type draws the informational note and
    // NO unknown-element finding for its own elements, which is strictly better than a table that
    // names some of them.
    const registry = buildRegistry();
    for (const type of ["Procedure", "ServiceRequest", "Encounter", "Device"]) {
      expect(registry(type), `${type} is unexpectedly registered`).toBeUndefined();
    }
    const result = validateResource(
      parseResource(
        '{"resourceType":"Procedure","status":"completed","code":{"text":"synthetic"},' +
          '"subject":{"reference":"Patient/synthetic-1"}}',
      ).resource,
      { mode: "strict" },
    );
    expect(result.issues.map((issue) => issue.code)).toEqual(["RESOURCE_NOT_MODELED"]);
    expect(result.valid).toBe(true);
  });
});

// -- AC3: the element NAME set matches, in both directions ----------------------------------------

describe("each registered table names exactly the direct elements R4 defines", () => {
  for (const type of PROJECTED_TYPES) {
    it(`${type}: nothing R4 defines is missing, and nothing R4 does not define is named`, () => {
      const delta = nameDelta(type, ownElements(type));
      expect(delta.missing, `${type}: R4 defines these and the table omits them`).toEqual([]);
      expect(delta.extra, `${type}: the table names these and R4 does not define them`).toEqual([]);
    });

    it(`${type}: names every choice by its [x] base and no variant by its instance spelling`, () => {
      const named = new Set(Object.keys(ownElements(type)));
      for (const element of directElements(type)) {
        if (!element.isChoice) continue;
        expect(named.has(element.name), `${type}.${element.name}[x] is not named by its base`).toBe(
          true,
        );
        for (const datatype of element.types) {
          const variant = element.name + datatype.charAt(0).toUpperCase() + datatype.slice(1);
          expect(named.has(variant), `${type}.${variant} is named instance-side`).toBe(false);
        }
      }
    });
  }
});

// -- AC2: the check has teeth ---------------------------------------------------------------------

describe("the completeness check refuses a table that is not complete", () => {
  it("reports a dropped element as missing, in the direction that manufactures false findings", () => {
    // A truncated table is the failure this whole file exists to catch, so the comparison is run
    // against one. Without this the assertions above could be vacuously green.
    for (const type of PROJECTED_TYPES) {
      const table = ownElements(type);
      const [dropped] = Object.keys(table);
      const truncated = Object.fromEntries(
        Object.entries(table).filter(([name]) => name !== dropped),
      );
      const delta = nameDelta(type, truncated);
      expect(delta.missing, `${type}: dropping ${String(dropped)} was not reported`).toEqual([
        dropped,
      ]);
      expect(delta.extra).toEqual([]);
    }
  });

  it("reports an invented element as extra, the direction that suppresses a true finding", () => {
    for (const type of PROJECTED_TYPES) {
      const delta = nameDelta(type, { ...ownElements(type), nonesuch: { min: 0, max: 1 } });
      expect(delta.extra, type).toEqual(["nonesuch"]);
      expect(delta.missing, type).toEqual([]);
    }
  });

  it("stays green only because the tables really match: an empty table fails every type", () => {
    for (const type of PROJECTED_TYPES) {
      expect(nameDelta(type, {}).missing.length, type).toBeGreaterThan(0);
    }
  });
});

// -- AC3 + AC6 + AC7 + AC9: cardinality and datatypes, row by row ---------------------------------

describe("each registered table states the cardinality and datatypes R4 states", () => {
  for (const type of PROJECTED_TYPES) {
    it(`${type}: every row matches min, max and the full datatype list`, () => {
      const table = ownElements(type);
      for (const element of directElements(type)) {
        if (BASE_NAMES.has(element.name)) continue;
        const row = table[element.name];
        expect(row, `${type}.${element.name} is not in the table`).toBeDefined();
        expect(row?.min, `${type}.${element.name} min`).toBe(element.min);
        expect(row?.max, `${type}.${element.name} max`).toBe(element.max);
        expect(row?.types, `${type}.${element.name} datatypes`).toEqual(element.types);
      }
    });

    it(`${type}: reports the mandatory elements R4 marks mandatory, and no others`, () => {
      const mandatory = Object.entries(ownElements(type))
        .filter(([, element]) => element.min >= 1)
        .map(([name]) => name)
        .sort();
      const defined = directElements(type)
        .filter((element) => element.min >= 1 && !BASE_NAMES.has(element.name))
        .map((element) => element.name)
        .sort();
      expect(mandatory, type).toEqual(defined);
    });
  }

  it("states the mandatory sets a reader can check against the published pages", () => {
    // Spelled out rather than only derived, because this is the row that turns an invalid document
    // valid when it is wrong, and a derivation cannot be read at a glance.
    const mandatory = Object.fromEntries(
      PROJECTED_TYPES.map((type) => [
        type,
        Object.entries(ownElements(type))
          .filter(([, element]) => element.min >= 1)
          .map(([name]) => name)
          .sort(),
      ]),
    );
    expect(mandatory).toEqual({
      DiagnosticReport: ["code", "status"],
      Condition: ["subject"],
      MedicationRequest: ["intent", "medication", "status", "subject"],
      AllergyIntolerance: ["patient"],
      Immunization: ["occurrence", "patient", "status", "vaccineCode"],
      MedicationStatement: ["medication", "status", "subject"],
    });
  });
});

// -- AC8: required-strength bindings, on `code` primitives only -----------------------------------

describe("required-strength bindings are carried for code primitives and for nothing else", () => {
  /** The direct elements R4 binds at required strength, split by whether they are `code`-typed. */
  function requiredBindings(type: string): {
    readonly onCode: DirectElement[];
    readonly onComplex: DirectElement[];
  } {
    const required = directElements(type).filter(
      (element) => element.binding?.strength === "required" && !BASE_NAMES.has(element.name),
    );
    return {
      onCode: required.filter((element) => element.types.includes("code")),
      onComplex: required.filter((element) => !element.types.includes("code")),
    };
  }

  for (const type of PROJECTED_TYPES) {
    it(`${type}: binds exactly the required-strength code elements, over the published code set`, () => {
      const table = ownElements(type);
      const bound = Object.entries(table)
        .filter(([, element]) => element.binding !== undefined)
        .map(([name]) => name)
        .sort();
      const { onCode } = requiredBindings(type);
      expect(bound, `${type}: bound elements`).toEqual(onCode.map((e) => e.name).sort());

      for (const element of onCode) {
        const codes = R4.valueSets[element.binding?.valueSet ?? ""]?.codes;
        expect(codes, `${type}.${element.name}: no resolved value set`).toBeDefined();
        expect(table[element.name]?.binding, `${type}.${element.name}`).toEqual({
          strength: "required",
          codes,
        });
      }
    });

    it(`${type}: leaves a required binding on a NON-code element to the terminology layer`, () => {
      // `Condition.clinicalStatus` and `AllergyIntolerance.verificationStatus` are `required` in R4
      // and `CodeableConcept`-valued. This layer enforces an enumeration against a `code` primitive
      // and cannot decide membership of a `Coding` inside a complex datatype, so it carries the
      // element with its cardinality and datatype and carries NO binding. Asserting the absence is
      // the point: a binding here would be enforced against a value that is never a `code`.
      const table = ownElements(type);
      for (const element of requiredBindings(type).onComplex) {
        expect(table[element.name], `${type}.${element.name}`).toBeDefined();
        expect(table[element.name]?.binding, `${type}.${element.name} carries a binding`).toBe(
          undefined,
        );
      }
    });
  }

  it("covers both halves: some type has a code-bound element and some type a complex-bound one", () => {
    const onCode = PROJECTED_TYPES.flatMap((t) => requiredBindings(t).onCode);
    const onComplex = PROJECTED_TYPES.flatMap((t) => requiredBindings(t).onComplex);
    expect(onCode.length, "no required code binding is exercised").toBeGreaterThan(0);
    expect(onComplex.length, "no required complex binding is exercised").toBeGreaterThan(0);
  });

  it("reaches no binding below a direct element, however strongly R4 binds it", () => {
    // `AllergyIntolerance.reaction.severity` is `required` in R4 and lives one level down. Backbone
    // children are modeled for cardinality and node shape only, so the registry carries `reaction`
    // as a BackboneElement with no binding and nothing inside one is decided from this layer.
    const reaction = ownElements("AllergyIntolerance")["reaction"];
    expect(reaction?.types).toEqual(["BackboneElement"]);
    expect(reaction?.binding).toBe(undefined);
    const deep = R4.types["AllergyIntolerance"]?.elements.find(
      (element) => element.path === "AllergyIntolerance.reaction.severity",
    );
    expect(deep?.binding?.strength, "the fixture for this assertion moved").toBe("required");
  });
});

// -- the per-type behaviour sweep -----------------------------------------------------------------

/** Parse then validate, the common path. */
function check(
  json: string,
  options?: Parameters<typeof validateResource>[1],
): ReturnType<typeof validateResource> {
  return validateResource(parseResource(json).resource, options);
}

/** The findings at exactly one location, as `code/severity` strings. */
function at(result: ReturnType<typeof validateResource>, expression: string): string[] {
  return result.issues
    .filter((issue) => issue.expression === expression)
    .map((issue) => `${issue.code}/${issue.severity}`);
}

/** A document of `type` from a comma-joined property list. */
function document(type: string, properties: string): string {
  return `{"resourceType":${JSON.stringify(type)},${properties}}`;
}

/** Every instance property name an element can appear under: one, or one per choice variant. */
function instanceNames(element: DirectElement): string[] {
  if (!element.isChoice) return [element.name];
  return element.types.map(
    (datatype) => element.name + datatype.charAt(0).toUpperCase() + datatype.slice(1),
  );
}

/** One lexically valid synthetic value per primitive datatype the six tables use. */
const PRIMITIVE_SAMPLES: Readonly<Record<string, string>> = {
  boolean: "true",
  string: '"synthetic"',
  code: '"synthetic-code"',
  uri: '"http://example.org/synthetic"',
  canonical: '"http://example.org/synthetic"',
  date: '"2026-01-01"',
  dateTime: '"2026-01-01"',
  instant: '"2026-01-01T09:00:00Z"',
};

/**
 * A shape-correct synthetic value for one occurrence of `element` at `datatype`. Only the node SHAPE
 * has to be right: the sweeps below grade whether a NAME resolves, and a wrong-shaped value would
 * draw TYPE_MISMATCH rather than the UNKNOWN_ELEMENT they are looking for. A complex datatype gets
 * an empty object, which is a complex node and nothing more, because this layer never enters one.
 */
function sampleFor(element: DirectElement, datatype: string): string {
  const one = PRIMITIVE_SAMPLES[datatype] ?? "{}";
  return element.max === UNBOUNDED ? `[${one}]` : one;
}

/**
 * One row per newly modeled type: a conformant minimal document, and one document per finding this
 * layer can produce for it. Each document is written out rather than derived, so what is being
 * validated is readable at the point the assertion is read.
 *
 * WHAT "MINIMAL" MEANS HERE, because it is the one row that is a reading rather than a lookup. It is
 * the resource type plus the direct elements R4 makes mandatory for a CONFORMANT instance. For five
 * of the six that is exactly the `min >= 1` set. `AllergyIntolerance` also carries `clinicalStatus`,
 * which is `0..1` by cardinality and made mandatory by the R4 invariant `ait-1` (clinicalStatus
 * SHALL be present unless verificationStatus is `entered-in-error`), enforced by the always-on
 * safety layer. A document without it is not conformant, so leaving it out would have graded this
 * row against a document R4 itself rejects.
 *
 * Every value is SYNTHETIC: coded values from published code systems, `text`-only CodeableConcepts,
 * and reference strings naming a resource type and a coined id. No person name, date of birth,
 * address, identifier or contact value appears anywhere in this file.
 */
interface TypeCase {
  readonly type: string;
  /** The comma-joined properties R4 makes mandatory, so a variant can be composed from them. */
  readonly required: string;
  /** `required` less one mandatory element, and the location the omission is reported at. */
  readonly missingMandatory: readonly [properties: string, location: string];
  /** A `0..1` element of this type, and a shape-correct value for it. */
  readonly singleton: readonly [name: string, value: string];
  /** A `0..*` element of this type, and a shape-correct value for it. */
  readonly repeating: readonly [name: string, value: string];
  /** An element whose datatype is complex, so a bare primitive there is a shape contradiction. */
  readonly complexElement: string;
  /** A `code` element with a required binding and an out-of-set value, or `undefined` for none. */
  readonly badCode: readonly [property: string, value: string] | undefined;
  /** Two variants of one `choice[x]`, and the `[x]` location the ambiguity is reported at. */
  readonly twoVariants: readonly [properties: string, location: string];
}

const AI_CLINICAL =
  '"clinicalStatus":{"coding":[{"system":"http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical","code":"active"}]}';
const SUBJECT = '"subject":{"reference":"Patient/synthetic-1"}';
const PATIENT = '"patient":{"reference":"Patient/synthetic-1"}';

const TYPE_CASES: readonly TypeCase[] = [
  {
    type: "DiagnosticReport",
    required: '"status":"final","code":{"text":"synthetic panel"}',
    missingMandatory: ['"status":"final"', "DiagnosticReport.code"],
    singleton: ["issued", '"2026-01-01T09:00:00Z"'],
    repeating: ["result", '{"reference":"Observation/synthetic-1"}'],
    complexElement: "presentedForm",
    badCode: ["status", '"complete"'],
    twoVariants: [
      '"effectiveDateTime":"2026-01-01","effectivePeriod":{"start":"2026-01-01"}',
      "DiagnosticReport.effective[x]",
    ],
  },
  {
    type: "Condition",
    required: SUBJECT,
    missingMandatory: ['"recordedDate":"2026-01-01"', "Condition.subject"],
    singleton: ["recordedDate", '"2026-01-01"'],
    repeating: ["note", '{"text":"synthetic annotation"}'],
    complexElement: "note",
    // R4 binds NOTHING on Condition at required strength over a `code` primitive: its two required
    // bindings (`clinicalStatus`, `verificationStatus`) are CodeableConcept-valued and belong to
    // the terminology layer. Asserted as a deliberate absence below rather than skipped.
    badCode: undefined,
    twoVariants: [
      '"onsetDateTime":"2026-01-01","onsetString":"synthetic onset"',
      "Condition.onset[x]",
    ],
  },
  {
    type: "MedicationRequest",
    required: `"status":"active","intent":"order","medicationCodeableConcept":{"text":"synthetic drug"},${SUBJECT}`,
    missingMandatory: [
      '"status":"active","intent":"order","medicationCodeableConcept":{"text":"synthetic drug"}',
      "MedicationRequest.subject",
    ],
    singleton: ["authoredOn", '"2026-01-01"'],
    repeating: ["insurance", '{"reference":"Coverage/synthetic-1"}'],
    complexElement: "note",
    badCode: ["intent", '"ordered"'],
    twoVariants: [
      '"reportedBoolean":true,"reportedReference":{"reference":"Practitioner/synthetic-1"}',
      "MedicationRequest.reported[x]",
    ],
  },
  {
    type: "AllergyIntolerance",
    required: `${AI_CLINICAL},${PATIENT}`,
    missingMandatory: [AI_CLINICAL, "AllergyIntolerance.patient"],
    singleton: ["lastOccurrence", '"2026-01-01"'],
    repeating: ["note", '{"text":"synthetic annotation"}'],
    complexElement: "note",
    badCode: ["criticality", '"severe"'],
    twoVariants: [
      '"onsetDateTime":"2026-01-01","onsetRange":{"low":{"value":1}}',
      "AllergyIntolerance.onset[x]",
    ],
  },
  {
    type: "Immunization",
    required: `"status":"completed","vaccineCode":{"text":"synthetic vaccine"},${PATIENT},"occurrenceDateTime":"2026-01-01"`,
    missingMandatory: [
      `"status":"completed","vaccineCode":{"text":"synthetic vaccine"},${PATIENT}`,
      "Immunization.occurrence[x]",
    ],
    singleton: ["lotNumber", '"SYN-LOT-1"'],
    repeating: ["reasonCode", '{"text":"synthetic reason"}'],
    complexElement: "note",
    badCode: ["status", '"final"'],
    // The choice here is the MANDATORY one, so the second variant is added rather than paired.
    twoVariants: ['"occurrenceString":"synthetic occurrence"', "Immunization.occurrence[x]"],
  },
  {
    type: "MedicationStatement",
    required: `"status":"active","medicationCodeableConcept":{"text":"synthetic drug"},${SUBJECT}`,
    missingMandatory: [
      '"status":"active","medicationCodeableConcept":{"text":"synthetic drug"}',
      "MedicationStatement.subject",
    ],
    singleton: ["dateAsserted", '"2026-01-01"'],
    repeating: ["derivedFrom", '{"reference":"MedicationRequest/synthetic-1"}'],
    complexElement: "note",
    // `taken` is the STU3 spelling R4 replaced, so it is the near miss a migrated feed writes.
    badCode: ["status", '"taken"'],
    twoVariants: [
      '"effectiveDateTime":"2026-01-01","effectivePeriod":{"start":"2026-01-01"}',
      "MedicationStatement.effective[x]",
    ],
  },
];

/** `required` with one property's value replaced, or the property appended when it is absent. */
function withProperty(row: TypeCase, property: string, value: string): string {
  const key = `"${property}":`;
  if (!row.required.includes(key)) return `${row.required},${key}${value}`;
  const start = row.required.indexOf(key) + key.length;
  const end = row.required.indexOf(",", start);
  return row.required.slice(0, start) + value + (end === -1 ? "" : row.required.slice(end));
}

describe("the behaviour sweep covers every newly modeled type", () => {
  it("has one row per type the projection carries, and no other", () => {
    expect(TYPE_CASES.map((row) => row.type).sort()).toEqual([...PROJECTED_TYPES].sort());
  });

  it("names a singleton, a repeating element and a complex one that R4 really defines that way", () => {
    for (const row of TYPE_CASES) {
      const table = ownElements(row.type);
      expect(table[row.singleton[0]]?.max, `${row.type}.${row.singleton[0]}`).toBe(1);
      expect(table[row.repeating[0]]?.max, `${row.type}.${row.repeating[0]}`).toBe(UNBOUNDED);
      const complexTypes = table[row.complexElement]?.types ?? [];
      expect(complexTypes.length, `${row.type}.${row.complexElement}`).toBe(1);
      expect(
        PRIMITIVE_SAMPLES[complexTypes[0] ?? ""],
        `${row.type}.${row.complexElement} is a primitive`,
      ).toBe(undefined);
    }
  });
});

// -- AC1 + AC4: a conformant minimal document draws nothing at all --------------------------------

describe("a conformant minimal document of a newly modeled type", () => {
  for (const row of TYPE_CASES) {
    const minimal = document(row.type, row.required);

    it(`${row.type}: draws no issue at all, from any layer`, () => {
      const parsed = parseResource(minimal);
      expect(parsed.issues, `${row.type}: the reader reported something`).toEqual([]);
      const result = validateResource(parsed.resource);
      expect(result.issues, `${row.type}: a conformant document drew a finding`).toEqual([]);
      expect(result.valid).toBe(true);
    });

    it(`${row.type}: draws nothing in strict mode either`, () => {
      expect(check(minimal, { mode: "strict" }).issues, row.type).toEqual([]);
    });

    it(`${row.type}: is not reported as unmodeled, however wrong the instance is`, () => {
      // The note is gone because the TYPE is modeled, not because this instance happens to be clean.
      for (const json of [
        minimal,
        document(row.type, '"wibble":1'),
        document(row.type, '"id":"x"'),
      ]) {
        expect(
          check(json).issues.map((issue) => issue.code),
          json,
        ).not.toContain("RESOURCE_NOT_MODELED");
      }
    });
  }
});

// -- AC5: a property R4 does not define is an unknown element -------------------------------------

describe("a property the R4 StructureDefinition does not define", () => {
  for (const row of TYPE_CASES) {
    it(`${row.type}: is UNKNOWN_ELEMENT at that property, warning then error`, () => {
      const json = document(row.type, `${row.required},"wibble":1`);
      const lenient = check(json);
      expect(at(lenient, `${row.type}.wibble`)).toEqual(["UNKNOWN_ELEMENT/warning"]);
      expect(lenient.valid, "a warning does not fail a document").toBe(true);
      const strict = check(json, { mode: "strict" });
      expect(at(strict, `${row.type}.wibble`)).toEqual(["UNKNOWN_ELEMENT/error"]);
      expect(strict.valid).toBe(false);
    });

    it(`${row.type}: is NOT reported for any element R4 does define`, () => {
      // The fail-OPEN direction, swept over every direct element and every choice variant rather
      // than a sample: a table missing a row R4 defines manufactures this finding on a conformant
      // document, which is the failure the completeness rule exists to prevent.
      let swept = 0;
      for (const element of directElements(row.type)) {
        if (BASE_NAMES.has(element.name)) continue;
        const names = instanceNames(element);
        for (const [index, property] of names.entries()) {
          const datatype = element.isChoice
            ? (element.types[index] ?? "")
            : (element.types[0] ?? "");
          const json = document(
            row.type,
            `${JSON.stringify(property)}:${sampleFor(element, datatype)}`,
          );
          const codes = check(json, { mode: "strict" }).issues.map((issue) => issue.code);
          expect(codes, `${row.type}.${property} was reported unknown`).not.toContain(
            "UNKNOWN_ELEMENT",
          );
          swept += 1;
        }
      }
      expect(swept, `${row.type}: the sweep reached no element`).toBeGreaterThan(15);
    });
  }
});

// -- AC6: a missing mandatory element is a min-cardinality finding ---------------------------------

describe("a document omitting an element R4 gives a minimum of one", () => {
  for (const row of TYPE_CASES) {
    it(`${row.type}: is CARDINALITY_MIN at that element`, () => {
      const [properties, location] = row.missingMandatory;
      const result = check(document(row.type, properties));
      expect(at(result, location), row.type).toEqual(["CARDINALITY_MIN/error"]);
      expect(result.issues.find((issue) => issue.expression === location)?.type).toBe("required");
      expect(result.valid).toBe(false);
    });

    it(`${row.type}: reports exactly the mandatory set for a bare resourceType`, () => {
      const result = check(document(row.type, '"id":"synthetic-1"'));
      const reported = result.issues
        .filter((issue) => issue.code === "CARDINALITY_MIN")
        .map((issue) => issue.expression)
        .sort();
      const expected = directElements(row.type)
        .filter((element) => element.min >= 1 && !BASE_NAMES.has(element.name))
        .map((element) => `${row.type}.${element.name}${element.isChoice ? "[x]" : ""}`)
        .sort();
      expect(reported, row.type).toEqual(expected);
      expect(expected.length, `${row.type} has no mandatory element to omit`).toBeGreaterThan(0);
    });
  }
});

// -- AC7: a repeated singleton is a max-cardinality finding ---------------------------------------

describe("a document repeating an element R4 gives a maximum of one", () => {
  for (const row of TYPE_CASES) {
    const [name, value] = row.singleton;

    it(`${row.type}: is CARDINALITY_MAX at that element`, () => {
      const json = document(
        row.type,
        `${row.required},${JSON.stringify(name)}:[${value},${value}]`,
      );
      const result = check(json);
      expect(at(result, `${row.type}.${name}`), row.type).toContain("CARDINALITY_MAX/error");
      expect(result.valid).toBe(false);
    });

    it(`${row.type}: leaves a genuinely repeating element alone`, () => {
      const [listName, listValue] = row.repeating;
      const json = document(
        row.type,
        `${row.required},${JSON.stringify(listName)}:[${listValue},${listValue}]`,
      );
      expect(
        check(json).issues.map((issue) => issue.code),
        `${row.type}.${listName}`,
      ).not.toContain("CARDINALITY_MAX");
    });
  }
});

// -- AC8: a code outside a required-strength binding ----------------------------------------------

describe("a code outside the enumerated set of a required-strength binding", () => {
  for (const row of TYPE_CASES) {
    if (row.badCode === undefined) {
      it(`${row.type}: has no code-typed required binding, and that is R4's doing, not an omission`, () => {
        const bound = Object.entries(ownElements(row.type)).filter(
          ([, element]) => element.binding !== undefined,
        );
        expect(
          bound.map(([name]) => name),
          `${row.type} unexpectedly binds something`,
        ).toEqual([]);
        const requiredInR4 = directElements(row.type)
          .filter((element) => element.binding?.strength === "required")
          .map((element) => element.name)
          .sort();
        expect(requiredInR4, `${row.type}: R4's required bindings moved`).toEqual([
          "clinicalStatus",
          "verificationStatus",
        ]);
      });
      continue;
    }
    const [property, value] = row.badCode;
    const location = `${row.type}.${property}`;

    it(`${location}: an out-of-set code is CODE_INVALID at that element`, () => {
      const result = check(document(row.type, withProperty(row, property, value)));
      expect(at(result, location), row.type).toEqual(["CODE_INVALID/error"]);
      expect(result.issues.find((issue) => issue.expression === location)?.type).toBe(
        "code-invalid",
      );
      expect(result.valid).toBe(false);
    });

    it(`${location}: errors the same way in strict mode, so the binding is not mode-sensitive`, () => {
      const json = document(row.type, withProperty(row, property, value));
      expect(at(check(json, { mode: "strict" }), location)).toEqual(["CODE_INVALID/error"]);
    });

    it(`${location}: accepts every code the published value set lists`, () => {
      // The other direction: a code set with a member MISSING errors on a conformant document, and
      // for a status element that is a document the sender wrote correctly being called invalid.
      const codes = ownElements(row.type)[property]?.binding?.codes ?? [];
      expect(codes.length, `${location} carries no code set`).toBeGreaterThan(0);
      for (const code of codes) {
        const json = document(row.type, withProperty(row, property, JSON.stringify(code)));
        expect(at(check(json), location), `${location} rejected ${code}`).not.toContain(
          "CODE_INVALID/error",
        );
      }
    });
  }

  it("reaches a code-typed required binding on five of the six types", () => {
    expect(
      TYPE_CASES.filter((row) => row.badCode !== undefined)
        .map((row) => row.type)
        .sort(),
    ).toEqual([
      "AllergyIntolerance",
      "DiagnosticReport",
      "Immunization",
      "MedicationRequest",
      "MedicationStatement",
    ]);
  });

  it("checks a REPEATING code binding per occurrence, not once for the element", () => {
    // `AllergyIntolerance.category` is `0..*` and required-bound, the only such element in the six.
    const result = check(
      document("AllergyIntolerance", `${AI_CLINICAL},${PATIENT},"category":["food","drug"]`),
    );
    expect(at(result, "AllergyIntolerance.category[1]")).toEqual(["CODE_INVALID/error"]);
    expect(at(result, "AllergyIntolerance.category[0]")).toEqual([]);
  });
});

// -- AC9: a shape contradiction, and two variants of one choice -----------------------------------

describe("a value whose node shape contradicts the datatype R4 states", () => {
  for (const row of TYPE_CASES) {
    it(`${row.type}: an object where a primitive belongs is TYPE_MISMATCH`, () => {
      const json = document(
        row.type,
        `${row.required},${JSON.stringify(row.singleton[0])}:{"nonesuch":1}`,
      );
      const result = check(json);
      expect(at(result, `${row.type}.${row.singleton[0]}`), row.type).toEqual([
        "TYPE_MISMATCH/error",
      ]);
      expect(result.valid).toBe(false);
    });

    it(`${row.type}: a bare primitive where a complex datatype belongs is TYPE_MISMATCH`, () => {
      const json = document(
        row.type,
        `${row.required},${JSON.stringify(row.complexElement)}:"synthetic"`,
      );
      expect(at(check(json), `${row.type}.${row.complexElement}`), row.type).toContain(
        "TYPE_MISMATCH/error",
      );
    });
  }
});

describe("two variants of the same choice[x] present at once", () => {
  for (const row of TYPE_CASES) {
    it(`${row.type}: is CHOICE_AMBIGUOUS once, at the [x] path, never a cardinality max`, () => {
      const [properties, location] = row.twoVariants;
      const result = check(document(row.type, `${row.required},${properties}`));
      const ambiguous = result.issues.filter((issue) => issue.code === "CHOICE_AMBIGUOUS");
      expect(
        ambiguous.map((issue) => issue.expression),
        row.type,
      ).toEqual([location]);
      expect(
        result.issues.map((issue) => issue.code),
        row.type,
      ).not.toContain("CARDINALITY_MAX");
      expect(result.valid).toBe(false);
    });

    it(`${row.type}: says nothing about a choice with exactly one variant, whichever it is`, () => {
      // Bare documents on purpose: the only question here is whether ONE variant is ever read as
      // two, so the mandatory set is irrelevant and its absence must not colour the result.
      for (const element of directElements(row.type)) {
        if (!element.isChoice || BASE_NAMES.has(element.name)) continue;
        for (const [index, property] of instanceNames(element).entries()) {
          const json = document(
            row.type,
            `${JSON.stringify(property)}:${sampleFor(element, element.types[index] ?? "")}`,
          );
          expect(
            check(json).issues.map((issue) => issue.code),
            `${row.type}.${property} alone`,
          ).not.toContain("CHOICE_AMBIGUOUS");
        }
      }
    });
  }
});

// -- AC11: a caller-supplied schema replaces the built-in table -----------------------------------

describe("a caller-supplied schema for a safety-critical type", () => {
  /** `identifier` is a direct element of all seven built-in tables, so it is the probe. */
  const PROBE = '"identifier":[{"system":"http://example.org/synthetic-ids"}]';

  for (const type of [...SAFETY_RESOURCE_TYPES].sort()) {
    const schemas = [{ type, elements: { onlyThis: { min: 1, max: 1, types: ["string"] } } }];

    it(`${type}: the caller's table is validated against, in place of the built-in one`, () => {
      const json = document(type, `${PROBE},"onlyThis":"synthetic"`);

      // Built-in: `identifier` resolves and `onlyThis` does not.
      const builtIn = check(json, { mode: "strict" }).issues.filter(
        (issue) => issue.code === "UNKNOWN_ELEMENT",
      );
      expect(
        builtIn.map((issue) => issue.expression),
        type,
      ).toEqual([`${type}.onlyThis`]);

      // Caller-supplied: exactly the other way round, so the caller's table REPLACED the built-in
      // one rather than being merged under it.
      const supplied = check(json, { mode: "strict", schemas }).issues.filter(
        (issue) => issue.code === "UNKNOWN_ELEMENT",
      );
      expect(
        supplied.map((issue) => issue.expression),
        type,
      ).toEqual([`${type}.identifier`]);
    });

    it(`${type}: the caller's cardinality is the one enforced`, () => {
      const result = check(document(type, PROBE), { schemas });
      const min = result.issues.filter((issue) => issue.code === "CARDINALITY_MIN");
      expect(
        min.map((issue) => issue.expression),
        type,
      ).toEqual([`${type}.onlyThis`]);
    });

    it(`${type}: the base elements are still merged into the caller's table`, () => {
      const result = check(document(type, '"id":"bad id with spaces","onlyThis":"synthetic"'), {
        schemas,
        mode: "strict",
      });
      expect(at(result, `${type}.id`), type).toEqual(["PRIMITIVE_INVALID/error"]);
    });
  }
});
