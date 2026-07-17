import { describe, expect, it } from "vitest";

import {
  complex,
  list,
  parseResource,
  primitive,
  UNBOUNDED,
  validateResource,
  type ResourceSchema,
  type ValidationCode,
} from "../src/index.js";

/** Parse then validate — the common path. */
function check(
  json: string,
  options?: Parameters<typeof validateResource>[1],
): ReturnType<typeof validateResource> {
  return validateResource(parseResource(json).resource, options);
}

/** The set of codes present in a result, for order-independent assertions. */
function codes(result: ReturnType<typeof validateResource>): ValidationCode[] {
  return result.issues.map((i) => i.code);
}

/** A synthetic resource schema exercising min-cardinality, a required binding, and a choice. */
const VITALS: ResourceSchema = {
  type: "Vitals",
  elements: {
    status: {
      min: 1,
      max: 1,
      types: ["code"],
      binding: { strength: "required", codes: ["final", "preliminary"] },
    },
    value: { min: 0, max: 1, types: ["boolean", "integer"] },
    note: { min: 0, max: UNBOUNDED, types: ["string"] },
  },
};

describe("validateResource — layer 1 (structure)", () => {
  it("flags a resource with no resourceType and stops", () => {
    const result = check('{"id":"1"}');
    expect(codes(result)).toEqual(["RESOURCE_TYPE_UNKNOWN"]);
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.expression).toBe("$this");
  });

  it("warns (lenient) on an unknown element and preserves it, errors (strict)", () => {
    const lenient = check('{"resourceType":"Patient","wibble":1}');
    expect(codes(lenient)).toEqual(["UNKNOWN_ELEMENT"]);
    expect(lenient.issues[0]?.severity).toBe("warning");
    expect(lenient.issues[0]?.expression).toBe("Patient.wibble");
    expect(lenient.valid).toBe(true); // a warning does not fail

    const strict = check('{"resourceType":"Patient","wibble":1}', { mode: "strict" });
    expect(strict.issues[0]?.severity).toBe("error");
    expect(strict.valid).toBe(false);
  });

  it("degrades safely on an unmodeled resource type — info, not false errors", () => {
    const result = check('{"resourceType":"Device","serialNumber":"abc","status":"active"}');
    // No schema for Device → one informational note, and its own elements are NOT flagged unknown.
    expect(codes(result)).toEqual(["RESOURCE_NOT_MODELED"]);
    expect(result.issues[0]?.severity).toBe("information");
    expect(result.valid).toBe(true);
  });

  it("still validates the universal base elements on an unmodeled resource", () => {
    const result = check('{"resourceType":"Device","id":"bad id with spaces"}');
    // id is a base element on every resource; its lexical form is checked even when unmodeled.
    expect(codes(result)).toEqual(["RESOURCE_NOT_MODELED", "PRIMITIVE_INVALID"]);
    expect(result.issues[1]?.expression).toBe("Device.id");
  });

  it("reports a datatype-shape mismatch (primitive where a complex datatype belongs, and vice versa)", () => {
    const nameAsString = check('{"resourceType":"Patient","name":"Smith"}');
    expect(codes(nameAsString)).toContain("TYPE_MISMATCH");
    expect(nameAsString.issues[0]?.expression).toBe("Patient.name");

    const birthDateAsObject = check('{"resourceType":"Patient","birthDate":{"foo":"bar"}}');
    expect(codes(birthDateAsObject)).toContain("TYPE_MISMATCH");
  });
});

describe("validateResource — layer 2 (cardinality)", () => {
  it("flags a missing required element", () => {
    const result = check('{"resourceType":"Vitals","note":["ok"]}', { schemas: [VITALS] });
    expect(codes(result)).toContain("CARDINALITY_MIN");
    const min = result.issues.find((i) => i.code === "CARDINALITY_MIN");
    expect(min?.expression).toBe("Vitals.status");
    expect(min?.type).toBe("required");
  });

  it("flags an element that exceeds its maximum", () => {
    const result = check('{"resourceType":"Patient","active":[true,false]}');
    expect(codes(result)).toContain("CARDINALITY_MAX");
    expect(result.issues.find((i) => i.code === "CARDINALITY_MAX")?.expression).toBe(
      "Patient.active",
    );
  });

  it("accepts an unbounded element repeated", () => {
    const result = check('{"resourceType":"Vitals","status":"final","note":["a","b","c"]}', {
      schemas: [VITALS],
    });
    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
  });
});

describe("validateResource — layer 3 (value-domain)", () => {
  it("flags a primitive that fails its datatype pattern", () => {
    const result = check('{"resourceType":"Patient","birthDate":"2013-13-40"}');
    expect(codes(result)).toEqual(["PRIMITIVE_INVALID"]);
    expect(result.issues[0]?.expression).toBe("Patient.birthDate");
    expect(result.issues[0]?.type).toBe("value");
  });

  it("flags a code outside a required-strength binding", () => {
    const result = check('{"resourceType":"Patient","gender":"masculine"}');
    expect(codes(result)).toEqual(["CODE_INVALID"]);
    expect(result.issues[0]?.expression).toBe("Patient.gender");
    expect(result.issues[0]?.type).toBe("code-invalid");
  });

  it("accepts a code that is in the binding", () => {
    const result = check('{"resourceType":"Patient","gender":"female"}');
    expect(result.issues).toEqual([]);
  });

  it("validates the JSON-number family by exact lexical text", () => {
    const bad = check('{"resourceType":"Vitals","status":"final","valueInteger":1.5}', {
      schemas: [VITALS],
    });
    expect(codes(bad)).toEqual(["PRIMITIVE_INVALID"]);
    expect(bad.issues[0]?.expression).toBe("Vitals.valueInteger");

    const good = check('{"resourceType":"Vitals","status":"final","valueInteger":3}', {
      schemas: [VITALS],
    });
    expect(good.issues).toEqual([]);
  });

  it("skips a metadata-only primitive (extension without a value)", () => {
    const result = check('{"resourceType":"Patient","birthDate":null,"_birthDate":{"id":"bd"}}');
    // No value to lexically validate — must not produce a PRIMITIVE_INVALID.
    expect(codes(result)).not.toContain("PRIMITIVE_INVALID");
    expect(result.valid).toBe(true);
  });
});

describe("validateResource — choice[x]", () => {
  it("resolves a choice variant and validates its chosen datatype", () => {
    const result = check('{"resourceType":"Patient","deceasedBoolean":true}');
    expect(result.issues).toEqual([]);
  });

  it("flags an ambiguous choice once — not also as a spurious cardinality-max", () => {
    const result = check(
      '{"resourceType":"Patient","deceasedBoolean":true,"deceasedDateTime":"2020"}',
    );
    // The two-variant choice is one logical problem: exactly CHOICE_AMBIGUOUS, no CARDINALITY_MAX.
    expect(codes(result)).toEqual(["CHOICE_AMBIGUOUS"]);
    expect(result.issues[0]?.expression).toBe("Patient.deceased[x]");
  });

  it("still flags a single choice variant repeated as an array as a real max violation", () => {
    const result = check('{"resourceType":"Patient","deceasedBoolean":[true,false]}');
    expect(codes(result)).toContain("CARDINALITY_MAX");
    expect(result.issues.find((i) => i.code === "CARDINALITY_MAX")?.expression).toBe(
      "Patient.deceasedBoolean",
    );
  });

  it("reports a missing required choice at the [x] path", () => {
    const schema: ResourceSchema = {
      type: "Widget",
      elements: { onset: { min: 1, max: 1, types: ["dateTime", "string"] } },
    };
    const result = check('{"resourceType":"Widget"}', { schemas: [schema] });
    expect(result.issues.find((i) => i.code === "CARDINALITY_MIN")?.expression).toBe(
      "Widget.onset[x]",
    );
  });
});

describe("validateResource — model edge cases and OperationOutcome", () => {
  it("recurses into a nested list occurrence", () => {
    // Hand-build a model whose element value is a list-of-lists (defensive path in the walk).
    const resource = complex([
      { name: "resourceType", value: primitive("Vitals") },
      { name: "status", value: primitive("final") },
      { name: "note", value: list([list([primitive("nested ok")])]) },
    ]);
    const result = validateResource(resource, { schemas: [VITALS] });
    expect(result.issues).toEqual([]);
  });

  it("renders findings as a value-free OperationOutcome resource model", () => {
    const result = check('{"resourceType":"Patient","gender":"masculine"}');
    const oo = result.toOperationOutcome();
    expect(oo.properties[0]).toEqual({
      name: "resourceType",
      value: primitive("OperationOutcome"),
    });
    // Exactly one issue, carrying severity / code / diagnostics / expression.
    const issue = oo.properties.find((p) => p.name === "issue");
    expect(issue?.value.kind).toBe("list");
  });

  it("a caller schema overrides the built-in for a type", () => {
    const stricterPatient: ResourceSchema = {
      type: "Patient",
      elements: { gender: { min: 1, max: 1, types: ["code"] } },
    };
    const result = check('{"resourceType":"Patient"}', { schemas: [stricterPatient] });
    // The override made gender required (and dropped the enumerated binding).
    expect(codes(result)).toContain("CARDINALITY_MIN");
  });
});
