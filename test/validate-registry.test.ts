/**
 * A prebuilt schema registry handed to `validateResource` as `registry`: built once by
 * `buildRegistry`, reused across calls, and read exactly as the `schemas` it was built from.
 */

import { describe, expect, it } from "vitest";

import {
  buildRegistry,
  parseResource,
  parseResourceXml,
  UNBOUNDED,
  validateResource,
  type FhirComplex,
  type ResourceSchema,
  type SchemaRegistry,
  type ValidateOptions,
} from "../src/index.js";
import { outputCorpus } from "./_output-corpus.js";

/** A synthetic type this package does not model, with a required element and a required binding. */
const WIDGET: ResourceSchema = {
  type: "Widget",
  elements: {
    status: {
      min: 1,
      max: 1,
      types: ["code"],
      binding: { strength: "required", codes: ["on", "off"] },
    },
    reading: { min: 0, max: 1, types: ["integer", "string"] },
    note: { min: 0, max: UNBOUNDED, types: ["string"] },
  },
};

/** A caller schema that replaces a built-in one, so the override path is read too. */
const STRICT_OBSERVATION: ResourceSchema = {
  type: "Observation",
  elements: {
    status: { min: 1, max: 1, types: ["code"] },
    code: { min: 1, max: 1, types: ["CodeableConcept"] },
    subject: { min: 1, max: 1, types: ["Reference"] },
  },
};

/** A caller schema for a type that appears in the corpus but is not built in. */
const BASIC: ResourceSchema = {
  type: "Basic",
  elements: { code: { min: 1, max: 1, types: ["CodeableConcept"] } },
};

const SCHEMAS: readonly ResourceSchema[] = [WIDGET, STRICT_OBSERVATION, BASIC];

function model(json: string): FhirComplex {
  return parseResource(json).resource;
}

/** What a caller can observe of one validation. */
function observed(resource: FhirComplex, options: ValidateOptions): unknown {
  const result = validateResource(resource, options);
  return { issues: result.issues, valid: result.valid, outcome: result.toOperationOutcome() };
}

describe("validateResource: a prebuilt registry", () => {
  it("validates against the schemas the registry was built from", () => {
    const registry = buildRegistry([WIDGET]);
    const result = validateResource(model('{"resourceType":"Widget","status":"sideways"}'), {
      registry,
    });
    expect(result.issues.map((issue) => [issue.code, issue.expression])).toEqual([
      ["CODE_INVALID", "Widget.status"],
    ]);
    expect(result.valid).toBe(false);
  });

  it("reports a missing required element from a registry schema", () => {
    const registry = buildRegistry([WIDGET]);
    const result = validateResource(model('{"resourceType":"Widget","note":["n"]}'), { registry });
    expect(result.issues.map((issue) => [issue.code, issue.expression])).toEqual([
      ["CARDINALITY_MIN", "Widget.status"],
    ]);
  });

  it("asks the registry once per call, and the same registry serves every call", () => {
    const built = buildRegistry([WIDGET]);
    const asked: string[] = [];
    const registry: SchemaRegistry = (type) => {
      asked.push(type);
      return built(type);
    };
    const widget = model('{"resourceType":"Widget","status":"on"}');
    for (let i = 0; i < 3; i++) {
      expect(validateResource(widget, { registry }).issues).toEqual([]);
    }
    expect(asked).toEqual(["Widget", "Widget", "Widget"]);
  });

  it("reads a type the registry does not model as not modeled, as the built-ins do", () => {
    const result = validateResource(model('{"resourceType":"Gadget","id":"g1"}'), {
      registry: buildRegistry([WIDGET]),
    });
    expect(result.issues.map((issue) => issue.code)).toEqual(["RESOURCE_NOT_MODELED"]);
  });

  it("takes the registry over `schemas` when a call passes both", () => {
    const widget = model('{"resourceType":"Widget","status":"on"}');
    const result = validateResource(widget, {
      registry: buildRegistry(),
      schemas: [WIDGET],
    });
    expect(result.issues.map((issue) => issue.code)).toEqual(["RESOURCE_NOT_MODELED"]);
  });
});

describe("buildRegistry", () => {
  it("gives every registry the same built-in schemas, base elements merged in", () => {
    const first = buildRegistry();
    const second = buildRegistry([WIDGET]);
    expect(second("Patient")).toEqual(first("Patient"));
    expect(first("Patient")?.elements["id"]).toEqual({ min: 0, max: 1, types: ["id"] });
    expect(first("Widget")).toBeUndefined();
    expect(second("Widget")?.elements["status"]?.min).toBe(1);
    expect(second("Widget")?.elements["meta"]).toEqual(first("Patient")?.elements["meta"]);
  });

  it("keeps one registry's schemas out of another", () => {
    const withOverride = buildRegistry([STRICT_OBSERVATION]);
    const plain = buildRegistry();
    expect(withOverride("Observation")?.elements["effective"]).toBeUndefined();
    expect(plain("Observation")?.elements["effective"]).toBeDefined();
  });

  it("hands out built-in schemas no caller can change under another", () => {
    const schema = buildRegistry()("Patient");
    expect(Object.isFrozen(schema)).toBe(true);
    expect(Object.isFrozen(schema?.elements)).toBe(true);
  });
});

describe("a registry validates exactly as the schemas it was built from, over the output corpus", () => {
  const corpus = outputCorpus();
  const models: { readonly name: string; readonly resource: FhirComplex }[] = [];
  for (const doc of corpus) {
    try {
      const read = doc.format === "json" ? parseResource(doc.text) : parseResourceXml(doc.text);
      models.push({ name: doc.name, resource: read.resource });
    } catch {
      // A document the reader refuses has no model to validate.
    }
  }

  it("reads models from the corpus", () => {
    expect(models.length).toBeGreaterThan(100);
  });

  it("matches `schemas` with caller schemas, in both modes", { timeout: 120_000 }, () => {
    const registry = buildRegistry(SCHEMAS);
    const differing = models
      .filter(({ resource }) =>
        (["lenient", "strict"] as const).some(
          (mode) =>
            JSON.stringify(observed(resource, { mode, schemas: SCHEMAS })) !==
            JSON.stringify(observed(resource, { mode, registry })),
        ),
      )
      .map(({ name }) => name);
    expect(differing).toEqual([]);
  });

  it("matches the default with the built-ins alone, in both modes", { timeout: 120_000 }, () => {
    const registry = buildRegistry();
    const differing = models
      .filter(({ resource }) =>
        (["lenient", "strict"] as const).some(
          (mode) =>
            JSON.stringify(observed(resource, { mode })) !==
            JSON.stringify(observed(resource, { mode, registry })),
        ),
      )
      .map(({ name }) => name);
    expect(differing).toEqual([]);
  });
});
