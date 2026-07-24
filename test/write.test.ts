import { describe, expect, it } from "vitest";

import {
  complex,
  decimal,
  list,
  parseResource,
  primitive,
  serializeResource,
  type FhirComplex,
} from "../src/index.js";

/** Build a minimal resource-shaped complex with a resourceType and the given extra properties. */
function resource(
  type: string,
  extra: readonly { name: string; value: FhirComplex["properties"][number]["value"] }[],
): FhirComplex {
  return complex([{ name: "resourceType", value: primitive(type) }, ...extra]);
}

describe("serializeResource: the write path", () => {
  it("emits resourceType first even when it is not first in the model", () => {
    const model = complex([
      { name: "id", value: primitive("1") },
      { name: "resourceType", value: primitive("Patient") },
    ]);
    expect(serializeResource(model)).toBe('{"resourceType":"Patient","id":"1"}');
  });

  it("emits a decimal from its exact lexical text, unquoted", () => {
    const model = resource("Observation", [{ name: "v", value: primitive(decimal("0.010")) }]);
    expect(serializeResource(model)).toBe('{"resourceType":"Observation","v":0.010}');
  });

  it("emits booleans and strings correctly", () => {
    const model = resource("Patient", [
      { name: "active", value: primitive(true) },
      { name: "gender", value: primitive("male") },
    ]);
    expect(serializeResource(model)).toBe(
      '{"resourceType":"Patient","active":true,"gender":"male"}',
    );
  });

  it("splits primitive metadata back into a _sibling, value key first", () => {
    const model = resource("Patient", [
      {
        name: "birthDate",
        value: primitive("1970-01-01", {
          id: "bd",
          extension: [complex([{ name: "url", value: primitive("u") }])],
        }),
      },
    ]);
    expect(serializeResource(model)).toBe(
      '{"resourceType":"Patient","birthDate":"1970-01-01","_birthDate":{"id":"bd","extension":[{"url":"u"}]}}',
    );
  });

  it("emits only the _sibling for a value-absent primitive", () => {
    const model = resource("Observation", [
      {
        name: "valueString",
        value: primitive(undefined, {
          extension: [complex([{ name: "url", value: primitive("u") }])],
        }),
      },
    ]);
    expect(serializeResource(model)).toBe(
      '{"resourceType":"Observation","_valueString":{"extension":[{"url":"u"}]}}',
    );
  });

  it("null-pads a repeating primitive's value and _sibling arrays to equal length", () => {
    const model = resource("Patient", [
      {
        name: "given",
        value: list([primitive("A"), primitive("B", { id: "g2" }), primitive("C")]),
      },
    ]);
    expect(serializeResource(model)).toBe(
      '{"resourceType":"Patient","given":["A","B","C"],"_given":[null,{"id":"g2"},null]}',
    );
  });

  it("omits the _sibling array when no item carries metadata", () => {
    const model = resource("Patient", [
      { name: "given", value: list([primitive("A"), primitive("B")]) },
    ]);
    expect(serializeResource(model)).toBe('{"resourceType":"Patient","given":["A","B"]}');
  });

  it("omits empty lists (FHIR forbids empty arrays)", () => {
    const model = resource("Patient", [{ name: "given", value: list([]) }]);
    expect(serializeResource(model)).toBe('{"resourceType":"Patient"}');
  });

  it("emits a complex list of objects", () => {
    const model = resource("Patient", [
      {
        name: "name",
        value: list([complex([{ name: "family", value: primitive("Doe") }])]),
      },
    ]);
    expect(serializeResource(model)).toBe('{"resourceType":"Patient","name":[{"family":"Doe"}]}');
  });

  it("emits a heterogeneous list (nested list and bare primitive among complexes)", () => {
    // A hand-built model that is not all-primitive, exercising the bare-node emit path for each kind.
    const model = resource("X", [
      {
        name: "mixed",
        value: list([
          complex([{ name: "k", value: primitive("v") }]),
          list([primitive("a"), primitive("b")]),
          primitive("c"),
        ]),
      },
    ]);
    expect(serializeResource(model)).toBe('{"resourceType":"X","mixed":[{"k":"v"},["a","b"],"c"]}');
  });

  it("escapes strings and keys via canonical JSON escaping", () => {
    const model = resource("X", [{ name: "note", value: primitive('a"b\n') }]);
    // The value is round-tripped through the reader to confirm canonical escaping.
    const out = serializeResource(model);
    expect(parseResource(out).resource).toBeDefined();
    expect(out).toContain('"note":"a\\"b\\n"');
  });
});
