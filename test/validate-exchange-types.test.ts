/**
 * `Encounter`, `Procedure` and `DocumentReference`, the three types a US Core exchange carries beside
 * the safety-critical ones, validated structurally with no schema supplied.
 *
 * Three halves live here. The first is REGISTRY COMPLETENESS: each built-in element table graded
 * against the R4 4.0.1 element definitions rather than against the code that consumes it, by the
 * same rule `test/validate-safety-types.test.ts` grades the safety-critical tables. The second is a
 * per-type BEHAVIOUR sweep: one conformant minimal document per type drawing nothing at all, and one
 * document per finding the structural layer can produce. The third is what the other layers do
 * with the three types now that they are modeled: the R4 base constraints run, and a `status` of
 * `entered-in-error` is reported as a retraction.
 *
 * WHY A TABLE IS GRADED BOTH WAYS. The registry treats a registered type as FULLY DESCRIBED: any
 * property a table does not name draws `UNKNOWN_ELEMENT`, and any element it does not carry is never
 * cardinality-checked. So a table missing one row R4 defines manufactures an error on a conformant
 * document, and a table that invents an optional where R4 says mandatory turns an invalid document
 * valid.
 *
 * THE EXPECTATION IS COMMITTED SPEC DATA, NOT PROSE. `test/__data__/r4-direct-elements-exchange.json`
 * is a FIELD-SUBSET PROJECTION of the published R4 4.0.1 StructureDefinitions of the three types,
 * carrying every `snapshot.element` UNFILTERED: each entry keeps `path`, `min`, `max`, the
 * `type[].code` list, and `binding.strength` / `binding.valueSet`. It also carries the enumerated
 * code set behind each required-strength `code` binding, resolved from the published
 * `valuesets.json` bundle. Every source URL is recorded in the file's own `provenance` block.
 *
 * TO RE-DERIVE the data, take each `provenance` URL, and for every member of `snapshot.element` keep
 * `path`, `min`, `max`, `type[].code`, and `binding.strength` / `binding.valueSet` where present; for
 * every value set a required-strength `code` binding names, at any depth, resolve `compose.include`
 * against the bundle (an `include` carrying `concept` enumerates those codes; one carrying only a
 * `system` takes that CodeSystem's concepts depth-first, in document order). The same rule applied
 * to the six types of `test/__data__/r4-direct-elements.json` reproduces that file exactly.
 *
 * **Which elements are "direct" is decided HERE, by rule, not in the data**: exactly one path
 * segment below the resource root.
 *
 * R4 4.0.1 declares NO constraint of its own on any of the three types, so the base constraints
 * that reach them are the `DomainResource`, `Element` and `Extension` ones alone.
 *
 * Every value in this file is synthetic: codes from published code systems, `text`-only
 * CodeableConcepts, and references naming a resource type and a coined id.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  baseSchema,
  buildRegistry,
  parseResource,
  readSafety,
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
  readonly binding?: { readonly strength: string; readonly valueSet?: string };
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
  readFileSync(new URL("./__data__/r4-direct-elements-exchange.json", import.meta.url), "utf8"),
) as ProjectionFile;

/** The three types the projection carries, in the order it carries them. */
const PROJECTED_TYPES = Object.keys(R4.types);

/** The element R4 defines at `<Type>.<name>`, keyed the way the registry keys it. */
interface DirectElement {
  readonly name: string;
  readonly isChoice: boolean;
  readonly min: number;
  readonly max: number;
  readonly types: readonly string[];
  readonly binding?: { readonly strength: string; readonly valueSet?: string };
}

/** Every element exactly one path segment below the resource root. */
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

/** What R4 defines that the table omits, and what the table names that R4 does not define. */
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

describe("the committed R4 projection of the three exchange types", () => {
  it("carries the three StructureDefinitions, at 4.0.1", () => {
    expect(R4.fhirVersion).toBe("4.0.1");
    expect([...PROJECTED_TYPES].sort()).toEqual(["DocumentReference", "Encounter", "Procedure"]);
    for (const type of PROJECTED_TYPES) {
      expect(R4.types[type]?.version, type).toBe("4.0.1");
      expect(R4.provenance[type], type).toContain("hl7.org/fhir/R4/");
    }
  });

  it("is UNFILTERED, so the direct-element rule is applied here and not in the data", () => {
    for (const type of PROJECTED_TYPES) {
      const all = R4.types[type]?.elements.length ?? 0;
      expect(all, type).toBeGreaterThan(directElements(type).length);
    }
  });

  it("counts the direct elements each type defines, base elements included", () => {
    expect(Object.fromEntries(PROJECTED_TYPES.map((t) => [t, directElements(t).length]))).toEqual({
      Encounter: 31,
      Procedure: 36,
      DocumentReference: 24,
    });
  });

  it("defines every base-resource element the registry merges in, on every type", () => {
    for (const type of PROJECTED_TYPES) {
      const defined = new Set(directElements(type).map((element) => element.name));
      for (const name of BASE_NAMES) expect(defined.has(name), `${type}.${name}`).toBe(true);
    }
  });
});

// -- the registry ---------------------------------------------------------------------------------

describe("the built-in schema registry carries the three exchange types", () => {
  it("returns a schema for each of them with no schema supplied", () => {
    const registry = buildRegistry();
    for (const type of PROJECTED_TYPES) {
      expect(registry(type), `${type} is not registered`).toBeDefined();
    }
  });
});

describe("each exchange table names exactly the direct elements R4 defines", () => {
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
        expect(named.has(element.name), `${type}.${element.name}[x]`).toBe(true);
        for (const datatype of element.types) {
          const variant = element.name + datatype.charAt(0).toUpperCase() + datatype.slice(1);
          expect(named.has(variant), `${type}.${variant} is named instance-side`).toBe(false);
        }
      }
    });

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

    it(`${type}: binds exactly the required-strength code elements, over the published code set`, () => {
      const table = ownElements(type);
      const bound = Object.entries(table)
        .filter(([, element]) => element.binding !== undefined)
        .map(([name]) => name)
        .sort();
      const onCode = directElements(type).filter(
        (element) =>
          element.binding?.strength === "required" &&
          element.types.includes("code") &&
          !BASE_NAMES.has(element.name),
      );
      expect(bound, `${type}: bound elements`).toEqual(onCode.map((e) => e.name).sort());
      for (const element of onCode) {
        const codes = R4.valueSets[element.binding?.valueSet ?? ""]?.codes;
        expect(codes, `${type}.${element.name}: no resolved value set`).toBeDefined();
        // The value set is named as R4 names it, without the `|4.0.1` version pin.
        expect(table[element.name]?.binding, `${type}.${element.name}`).toEqual({
          strength: "required",
          codes,
          valueSet: element.binding?.valueSet?.split("|")[0],
        });
      }
    });
  }

  it("states the mandatory and the bound sets a reader can check against the published pages", () => {
    const summary = Object.fromEntries(
      PROJECTED_TYPES.map((type) => {
        const table = Object.entries(ownElements(type));
        return [
          type,
          {
            mandatory: table
              .filter(([, element]) => element.min >= 1)
              .map(([name]) => name)
              .sort(),
            bound: table
              .filter(([, element]) => element.binding !== undefined)
              .map(([name]) => name)
              .sort(),
            choices: table
              .filter(([, element]) => element.types.length > 1)
              .map(([name]) => name)
              .sort(),
          },
        ];
      }),
    );
    expect(summary).toEqual({
      Encounter: { mandatory: ["class", "status"], bound: ["status"], choices: [] },
      Procedure: { mandatory: ["status", "subject"], bound: ["status"], choices: ["performed"] },
      DocumentReference: {
        mandatory: ["content", "status"],
        bound: ["docStatus", "status"],
        choices: [],
      },
    });
  });

  it("refuses a truncated table and an invented row, so the comparison has teeth", () => {
    for (const type of PROJECTED_TYPES) {
      const table = ownElements(type);
      const [dropped] = Object.keys(table);
      const truncated = Object.fromEntries(
        Object.entries(table).filter(([name]) => name !== dropped),
      );
      expect(nameDelta(type, truncated).missing, type).toEqual([dropped]);
      expect(nameDelta(type, { ...table, nonesuch: {} }).extra, type).toEqual(["nonesuch"]);
    }
  });
});

// -- the behaviour sweep --------------------------------------------------------------------------

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

/** One lexically valid synthetic value per primitive datatype the three tables use. */
const PRIMITIVE_SAMPLES: Readonly<Record<string, string>> = {
  string: '"synthetic"',
  code: '"synthetic-code"',
  uri: '"http://example.org/synthetic"',
  canonical: '"http://example.org/synthetic"',
  dateTime: '"2026-01-01"',
  instant: '"2026-01-01T09:00:00Z"',
};

/** A shape-correct synthetic value for one occurrence of `element` at `datatype`. */
function sampleFor(element: DirectElement, datatype: string): string {
  const one = PRIMITIVE_SAMPLES[datatype] ?? "{}";
  return element.max === UNBOUNDED ? `[${one}]` : one;
}

interface TypeCase {
  readonly type: string;
  /** The comma-joined properties R4 makes mandatory. */
  readonly required: string;
  /** `required` less one mandatory element, and the location the omission is reported at. */
  readonly missingMandatory: readonly [properties: string, location: string];
  /** A `0..1` element of this type, and a shape-correct value for it. */
  readonly singleton: readonly [name: string, value: string];
  /** A `0..*` element of this type, and a shape-correct value for it. */
  readonly repeating: readonly [name: string, value: string];
  /** An element whose datatype is complex. */
  readonly complexElement: string;
  /** A required-bound `code` element and an out-of-set value. */
  readonly badCode: readonly [property: string, value: string];
}

const SUBJECT = '"subject":{"reference":"Patient/synthetic-1"}';
const ENCOUNTER_CLASS =
  '"class":{"system":"http://terminology.hl7.org/CodeSystem/v3-ActCode","code":"AMB"}';
const CONTENT = '"content":[{"attachment":{"contentType":"text/plain"}}]';

const TYPE_CASES: readonly TypeCase[] = [
  {
    type: "Encounter",
    required: `"status":"finished",${ENCOUNTER_CLASS}`,
    missingMandatory: ['"status":"finished"', "Encounter.class"],
    singleton: ["period", '{"start":"2026-01-01"}'],
    repeating: ["reasonCode", '{"text":"synthetic reason"}'],
    complexElement: "period",
    // `completed` is the event-status spelling, the near miss for an encounter that has ended.
    badCode: ["status", '"completed"'],
  },
  {
    type: "Procedure",
    required: `"status":"completed",${SUBJECT}`,
    missingMandatory: ['"status":"completed"', "Procedure.subject"],
    singleton: ["code", '{"text":"synthetic procedure"}'],
    repeating: ["bodySite", '{"text":"synthetic site"}'],
    complexElement: "note",
    badCode: ["status", '"done"'],
  },
  {
    type: "DocumentReference",
    required: `"status":"current",${CONTENT}`,
    missingMandatory: ['"status":"current"', "DocumentReference.content"],
    singleton: ["description", '"synthetic description"'],
    repeating: ["author", '{"reference":"Practitioner/synthetic-1"}'],
    complexElement: "custodian",
    badCode: ["docStatus", '"draft"'],
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

describe("the exchange-type behaviour sweep covers every projected type", () => {
  it("has one row per type the projection carries, and no other", () => {
    expect(TYPE_CASES.map((row) => row.type).sort()).toEqual([...PROJECTED_TYPES].sort());
  });
});

describe("a conformant minimal document of an exchange type", () => {
  for (const row of TYPE_CASES) {
    const minimal = document(row.type, row.required);

    it(`${row.type}: draws no issue at all, from any layer, in either mode`, () => {
      const parsed = parseResource(minimal);
      expect(parsed.issues, `${row.type}: the reader reported something`).toEqual([]);
      const result = validateResource(parsed.resource);
      expect(result.issues, `${row.type}: a conformant document drew a finding`).toEqual([]);
      expect(result.valid).toBe(true);
      expect(check(minimal, { mode: "strict" }).issues, row.type).toEqual([]);
    });

    it(`${row.type}: is no longer reported as unmodeled`, () => {
      for (const json of [minimal, document(row.type, '"wibble":1')]) {
        expect(
          check(json).issues.map((issue) => issue.code),
          json,
        ).not.toContain("RESOURCE_NOT_MODELED");
      }
    });
  }
});

describe("element findings on an exchange type, with no schema supplied", () => {
  for (const row of TYPE_CASES) {
    it(`${row.type}: a property R4 does not define is UNKNOWN_ELEMENT, warning then error`, () => {
      const json = document(row.type, `${row.required},"wibble":1`);
      expect(at(check(json), `${row.type}.wibble`)).toEqual(["UNKNOWN_ELEMENT/warning"]);
      const strict = check(json, { mode: "strict" });
      expect(at(strict, `${row.type}.wibble`)).toEqual(["UNKNOWN_ELEMENT/error"]);
      expect(strict.valid).toBe(false);
    });

    it(`${row.type}: no element R4 defines is reported unknown, every choice variant included`, () => {
      let swept = 0;
      for (const element of directElements(row.type)) {
        if (BASE_NAMES.has(element.name)) continue;
        for (const [index, property] of instanceNames(element).entries()) {
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
      expect(swept, `${row.type}: the sweep reached too few elements`).toBeGreaterThan(15);
    });

    it(`${row.type}: an omitted mandatory element is CARDINALITY_MIN`, () => {
      const [properties, location] = row.missingMandatory;
      const result = check(document(row.type, properties));
      expect(at(result, location), row.type).toEqual(["CARDINALITY_MIN/error"]);
      expect(result.valid).toBe(false);
    });

    it(`${row.type}: a bare resourceType reports exactly the mandatory set`, () => {
      const reported = check(document(row.type, '"id":"synthetic-1"'))
        .issues.filter((issue) => issue.code === "CARDINALITY_MIN")
        .map((issue) => issue.expression)
        .sort();
      const expected = directElements(row.type)
        .filter((element) => element.min >= 1 && !BASE_NAMES.has(element.name))
        .map((element) => `${row.type}.${element.name}${element.isChoice ? "[x]" : ""}`)
        .sort();
      expect(reported, row.type).toEqual(expected);
    });

    it(`${row.type}: a repeated singleton is CARDINALITY_MAX, a repeating element is not`, () => {
      const [name, value] = row.singleton;
      const twice = check(
        document(row.type, `${row.required},${JSON.stringify(name)}:[${value},${value}]`),
      );
      expect(at(twice, `${row.type}.${name}`), row.type).toContain("CARDINALITY_MAX/error");
      const [listName, listValue] = row.repeating;
      const list = check(
        document(
          row.type,
          `${row.required},${JSON.stringify(listName)}:[${listValue},${listValue}]`,
        ),
      );
      expect(list.issues.map((issue) => issue.code)).not.toContain("CARDINALITY_MAX");
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

    const [property, value] = row.badCode;
    it(`${row.type}.${property}: an out-of-set code is CODE_INVALID, every listed code is not`, () => {
      const location = `${row.type}.${property}`;
      const result = check(document(row.type, withProperty(row, property, value)));
      expect(at(result, location), row.type).toEqual(["CODE_INVALID/error"]);
      expect(result.valid).toBe(false);
      for (const element of Object.keys(ownElements(row.type))) {
        const codes = ownElements(row.type)[element]?.binding?.codes ?? [];
        for (const code of codes) {
          const json = document(row.type, withProperty(row, element, JSON.stringify(code)));
          expect(at(check(json), `${row.type}.${element}`), `${element} ${code}`).not.toContain(
            "CODE_INVALID/error",
          );
        }
      }
    });
  }

  it("Procedure: two variants of performed[x] are CHOICE_AMBIGUOUS once, at the [x] path", () => {
    const result = check(
      document(
        "Procedure",
        `"status":"completed",${SUBJECT},"performedDateTime":"2026-01-01","performedString":"synthetic"`,
      ),
    );
    expect(
      result.issues
        .filter((issue) => issue.code === "CHOICE_AMBIGUOUS")
        .map((issue) => issue.expression),
    ).toEqual(["Procedure.performed[x]"]);
    expect(result.valid).toBe(false);
  });

  it("a caller-supplied schema still replaces the built-in table for these types", () => {
    for (const type of PROJECTED_TYPES) {
      const schemas = [{ type, elements: { onlyThis: { min: 1, max: 1, types: ["string"] } } }];
      const json = document(type, '"onlyThis":"synthetic"');
      const supplied = check(json, { mode: "strict", schemas });
      expect(supplied.issues, type).toEqual([]);
      const builtIn = check(json, { mode: "strict" });
      expect(at(builtIn, `${type}.onlyThis`), type).toEqual(["UNKNOWN_ELEMENT/error"]);
    }
  });
});

// -- the base constraints -------------------------------------------------------------------------

describe("the R4 base constraints run on the exchange types with no profile supplied", () => {
  for (const row of TYPE_CASES) {
    it(`${row.type}: an element with no value and no children violates ele-1`, () => {
      const result = check(document(row.type, `${row.required},"meta":{}`));
      expect(
        result.issues
          .filter((issue) => issue.code === "INVARIANT_VIOLATED")
          .map((issue) => `${issue.expression} ${issue.constraint ?? ""}`),
      ).toEqual([`${row.type}.meta ele-1`]);
      expect(result.valid).toBe(false);
    });

    it(`${row.type}: an extension with neither a value nor extensions violates ext-1`, () => {
      const result = check(
        document(row.type, `${row.required},"extension":[{"url":"http://example.org/synthetic"}]`),
      );
      expect(at(result, `${row.type}.extension[0]`)).toContain("INVARIANT_VIOLATED/error");
      expect(
        result.issues.find((issue) => issue.expression === `${row.type}.extension[0]`)?.constraint,
      ).toBe("ext-1");
    });

    it(`${row.type}: a contained resource with its own contained violates dom-2`, () => {
      const nested =
        '"contained":[{"resourceType":"Patient","id":"c1","contained":[{"resourceType":"Patient","id":"c2"}]}]';
      const result = check(document(row.type, `${row.required},${nested}`));
      const keys = result.issues
        .filter((issue) => issue.expression === row.type)
        .map((issue) => `${issue.code}/${issue.constraint ?? ""}`);
      expect(keys).toContain("INVARIANT_VIOLATED/dom-2");
      // dom-3 needs reference resolution the subset does not have: unchecked, never assumed held.
      expect(keys).toContain("INVARIANT_UNCHECKED/dom-3");
    });
  }
});

// -- the retraction -------------------------------------------------------------------------------

describe("a status of entered-in-error on an exchange type is a retraction", () => {
  for (const row of TYPE_CASES) {
    const retracted = document(row.type, withProperty(row, "status", '"entered-in-error"'));

    it(`${row.type}: the validator reports RETRACTED_RESOURCE at status and stays valid`, () => {
      const result = check(retracted);
      expect(
        result.issues.map((issue) => `${issue.code}/${issue.severity} ${issue.expression}`),
      ).toEqual([`RETRACTED_RESOURCE/information ${row.type}.status`]);
      expect(result.valid).toBe(true);
    });

    it(`${row.type}: the safety readout carries the retraction`, () => {
      const readout = readSafety(parseResource(retracted).resource);
      expect(readout.retracted).toBe(true);
      expect(readout.negations).toContain("entered-in-error");
      expect(readout.safeToSummarize).toBe(false);
    });
  }

  it("DocumentReference: docStatus entered-in-error is the document's status, not a retraction", () => {
    // R4 flags `DocumentReference.status` as the modifier and leaves `docStatus` unflagged, so the
    // binding accepts the code there and no retraction is reported for it.
    const result = check(
      document("DocumentReference", `"status":"current","docStatus":"entered-in-error",${CONTENT}`),
    );
    expect(result.issues).toEqual([]);
  });

  it("Procedure: not-done stays a readable negation under the new binding", () => {
    const json = document("Procedure", `"status":"not-done",${SUBJECT}`);
    expect(check(json).issues).toEqual([]);
    expect(readSafety(parseResource(json).resource).negations).toContain("not-done");
  });
});
