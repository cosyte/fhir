import { describe, expect, it } from "vitest";

import {
  FATAL_CODES,
  FhirDecimal,
  ISSUE_CODES,
  getProperty,
  isComplex,
  isList,
  isPrimitive,
  parseResource,
  resourceType,
  serializeResource,
  type FhirCodecError,
  type FhirList,
  type FhirPrimitive,
} from "../src/index.js";
import { nth } from "./_util.js";

describe("parseResource — the read path", () => {
  it("resolves resourceType from any position", () => {
    const { resource } = parseResource('{"id":"1","active":true,"resourceType":"Patient"}');
    expect(resourceType(resource)).toBe("Patient");
  });

  it("reads a number as a FhirDecimal, never a JS number", () => {
    const { resource } = parseResource('{"resourceType":"X","v":0.010}');
    const v = getProperty(resource, "v");
    expect(v && isPrimitive(v)).toBe(true);
    const value = (v as FhirPrimitive).value;
    expect(value).toBeInstanceOf(FhirDecimal);
    expect((value as FhirDecimal).toString()).toBe("0.010");
  });

  it("merges a single primitive with its _sibling id and extension", () => {
    const { resource } = parseResource(
      '{"resourceType":"Patient","birthDate":"1970-01-01","_birthDate":{"id":"bd","extension":[{"url":"u","valueString":"s"}]}}',
    );
    const bd = getProperty(resource, "birthDate") as FhirPrimitive;
    expect(bd.value).toBe("1970-01-01");
    expect(bd.id).toBe("bd");
    expect(bd.extension).toHaveLength(1);
  });

  it("aligns a repeating primitive with its null-padded _sibling array", () => {
    const { resource } = parseResource(
      '{"resourceType":"Patient","given":["A","B"],"_given":[null,{"id":"g2"}]}',
    );
    const given = getProperty(resource, "given") as FhirList;
    expect(isList(given)).toBe(true);
    const items = given.items as readonly FhirPrimitive[];
    const g0 = nth(items, 0);
    const g1 = nth(items, 1);
    expect(g0.value).toBe("A");
    expect(g0.id).toBeUndefined();
    expect(g1.value).toBe("B");
    expect(g1.id).toBe("g2");
  });

  it("reads a value-absent primitive (extension-only) with value undefined", () => {
    const { resource } = parseResource(
      '{"resourceType":"Observation","_valueString":{"extension":[{"url":"u","valueCode":"masked"}]}}',
    );
    const vs = getProperty(resource, "valueString") as FhirPrimitive;
    expect(vs.value).toBeUndefined();
    expect(vs.extension).toHaveLength(1);
  });

  it("keeps complex arrays and nested complexes as structured nodes", () => {
    const { resource } = parseResource(
      '{"resourceType":"Patient","name":[{"family":"Doe","given":["Jane"]}]}',
    );
    const name = getProperty(resource, "name") as FhirList;
    expect(isList(name)).toBe(true);
    expect(isComplex(nth(name.items, 0))).toBe(true);
  });

  it("tolerates an object item inside a primitive array (malformed) as value-absent", () => {
    const { resource } = parseResource('{"resourceType":"P","a":["x",{"k":1}],"_a":[null,null]}');
    const a = getProperty(resource, "a") as FhirList;
    const items = a.items as readonly FhirPrimitive[];
    expect(nth(items, 0).value).toBe("x");
    expect(nth(items, 1).value).toBeUndefined();
  });

  it("tolerates a non-object item inside a complex array (malformed) and flags it", () => {
    const { resource, issues } = parseResource(
      '{"resourceType":"P","name":[{"family":"Doe"},"oops"]}',
    );
    const name = getProperty(resource, "name") as FhirList;
    expect(isComplex(nth(name.items, 0))).toBe(true);
    expect(isComplex(nth(name.items, 1))).toBe(true); // coerced to an empty complex
    expect(issues.some((i) => i.code === ISSUE_CODES.UNKNOWN_PROPERTY)).toBe(true);
  });

  it("preserves a complex array that carries a stray _sibling, flagging the sibling (no silent loss)", () => {
    // Regression: a `_`-sibling on a complex array must not misroute the objects to the primitive
    // path and delete them — they are preserved and the stray sibling is flagged.
    const { resource, issues } = parseResource(
      '{"resourceType":"Patient","contact":[{"name":{"text":"X"}}],"_contact":[{"id":"z"}]}',
    );
    const contact = getProperty(resource, "contact") as FhirList;
    expect(isList(contact)).toBe(true);
    expect(isComplex(nth(contact.items, 0))).toBe(true);
    expect(serializeResource(resource)).toBe(
      '{"resourceType":"Patient","contact":[{"name":{"text":"X"}}]}',
    );
    expect(issues.some((i) => i.code === ISSUE_CODES.UNKNOWN_PROPERTY)).toBe(true);
  });

  it("flags a non-scalar item embedded in a primitive array instead of dropping it silently", () => {
    const { issues } = parseResource('{"resourceType":"P","a":["x",{"k":1}],"_a":[null,null]}');
    expect(
      issues.some((i) => i.code === ISSUE_CODES.UNKNOWN_PROPERTY && i.expression === "P.a[1]"),
    ).toBe(true);
  });

  it("accepts an already-parsed RawJson tree as input", () => {
    const { resource } = parseResource({
      t: "obj",
      members: [{ key: "resourceType", value: { t: "str", value: "Patient" } }],
    });
    expect(resourceType(resource)).toBe("Patient");
  });

  describe("issues (value-free)", () => {
    it("raises DECIMAL_PRECISION_AT_RISK for a value a double would corrupt, at its location", () => {
      const { issues } = parseResource(
        '{"resourceType":"Observation","valueQuantity":{"value":0.010}}',
      );
      expect(issues).toHaveLength(1);
      expect(nth(issues, 0).code).toBe(ISSUE_CODES.DECIMAL_PRECISION_AT_RISK);
      expect(nth(issues, 0).expression).toBe("Observation.valueQuantity.value");
    });

    it("does not raise it for a double-safe value", () => {
      const { issues } = parseResource(
        '{"resourceType":"Observation","valueQuantity":{"value":0.5}}',
      );
      expect(issues).toHaveLength(0);
    });

    it("raises UNKNOWN_PROPERTY for a misplaced _sibling on an object", () => {
      const { issues } = parseResource(
        '{"resourceType":"Patient","name":{"x":1},"_name":{"id":"z"}}',
      );
      expect(issues.some((i) => i.code === ISSUE_CODES.UNKNOWN_PROPERTY)).toBe(true);
    });

    it("flags unexpected keys inside a _sibling object", () => {
      const { issues } = parseResource('{"resourceType":"P","a":"x","_a":{"id":"i","bogus":1}}');
      expect(issues.some((i) => i.code === ISSUE_CODES.UNKNOWN_PROPERTY)).toBe(true);
    });
  });

  describe("fail-closed structural fatals", () => {
    it("throws PRIMITIVE_EXTENSION_MISALIGNED on a length mismatch", () => {
      expect(() =>
        parseResource('{"resourceType":"P","given":["A","B"],"_given":[null]}'),
      ).toThrowError(expect.objectContaining({ code: FATAL_CODES.PRIMITIVE_EXTENSION_MISALIGNED }));
    });

    it("throws when a single primitive has an array _sibling", () => {
      expect(() => parseResource('{"resourceType":"P","a":"x","_a":[null]}')).toThrowError(
        expect.objectContaining({ code: FATAL_CODES.PRIMITIVE_EXTENSION_MISALIGNED }),
      );
    });

    it("throws when a primitive array has a scalar _sibling", () => {
      expect(() => parseResource('{"resourceType":"P","a":["x"],"_a":{"id":"z"}}')).toThrowError(
        expect.objectContaining({ code: FATAL_CODES.PRIMITIVE_EXTENSION_MISALIGNED }),
      );
    });

    it("rejects a non-object top-level as malformed", () => {
      expect(() => parseResource("[1,2,3]")).toThrowError(
        expect.objectContaining({ code: FATAL_CODES.MALFORMED_JSON }),
      );
    });

    it("carries a FHIRPath expression, never a value, on a misalignment", () => {
      let error: FhirCodecError | undefined;
      try {
        parseResource('{"resourceType":"Patient","given":["A","B"],"_given":[null]}');
      } catch (err) {
        error = err as FhirCodecError;
      }
      expect(error?.expression).toBe("Patient.given");
      expect(error?.message).not.toContain("A");
    });
  });
});
