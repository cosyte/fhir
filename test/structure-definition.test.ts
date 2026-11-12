import { describe, expect, it } from "vitest";

import {
  DISCRIMINATOR_TYPES,
  UNBOUNDED,
  isPrimitive,
  loadStructureDefinition,
  parseResource,
} from "../src/index.js";
import { req } from "./_util.js";

/** Load a StructureDefinition from a plain object literal (round-tripped through the codec). */
function loadSd(obj: unknown) {
  return loadStructureDefinition(parseResource(JSON.stringify(obj)).resource);
}

describe("loadStructureDefinition", () => {
  it("reads identity, derivation, and element lists", () => {
    const sd = req(
      loadSd({
        resourceType: "StructureDefinition",
        url: "http://example.org/StructureDefinition/us-core-allergy",
        version: "6.1.0",
        name: "USCoreAllergy",
        type: "AllergyIntolerance",
        kind: "resource",
        derivation: "constraint",
        baseDefinition: "http://hl7.org/fhir/StructureDefinition/AllergyIntolerance",
        differential: {
          element: [
            {
              id: "AllergyIntolerance.clinicalStatus",
              path: "AllergyIntolerance.clinicalStatus",
              min: 1,
              max: "1",
              mustSupport: true,
            },
          ],
        },
      }),
    );
    expect(sd.url).toBe("http://example.org/StructureDefinition/us-core-allergy");
    expect(sd.version).toBe("6.1.0");
    expect(sd.name).toBe("USCoreAllergy");
    expect(sd.type).toBe("AllergyIntolerance");
    expect(sd.kind).toBe("resource");
    expect(sd.derivation).toBe("constraint");
    expect(sd.baseDefinition).toContain("AllergyIntolerance");
    const el = req(sd.differential?.[0]);
    expect(el).toMatchObject({ min: 1, max: 1, mustSupport: true });
  });

  it("parses max '*' to UNBOUNDED and numeric max to a number", () => {
    const sd = req(
      loadSd({
        resourceType: "StructureDefinition",
        url: "http://x",
        type: "Observation",
        snapshot: {
          element: [
            { id: "Observation.category", path: "Observation.category", min: 0, max: "*" },
            { id: "Observation.status", path: "Observation.status", min: 1, max: "1" },
          ],
        },
      }),
    );
    expect(req(sd.snapshot?.[0]).max).toBe(UNBOUNDED);
    expect(req(sd.snapshot?.[1]).max).toBe(1);
  });

  it("reads slicing (discriminator + rules), types, binding, and fixed/pattern", () => {
    const sd = req(
      loadSd({
        resourceType: "StructureDefinition",
        url: "http://x",
        type: "Observation",
        differential: {
          element: [
            {
              id: "Observation.category",
              path: "Observation.category",
              slicing: {
                discriminator: [{ type: "pattern", path: "$this" }],
                rules: "open",
                ordered: false,
              },
              binding: { strength: "extensible", valueSet: "http://vs" },
              type: [{ code: "CodeableConcept" }],
            },
            {
              id: "Observation.category:VSCat",
              path: "Observation.category",
              sliceName: "VSCat",
              patternCodeableConcept: { coding: [{ system: "http://s", code: "vital-signs" }] },
            },
            {
              id: "Observation.status",
              path: "Observation.status",
              fixedCode: "final",
            },
          ],
        },
      }),
    );
    const category = req(sd.differential?.[0]);
    expect(req(category.slicing).discriminator[0]).toEqual({ type: "pattern", path: "$this" });
    expect(req(category.slicing).rules).toBe("open");
    expect(req(category.slicing).ordered).toBe(false);
    expect(category.binding).toEqual({ strength: "extensible", valueSet: "http://vs" });
    expect(req(category.type)[0]?.code).toBe("CodeableConcept");

    const slice = req(sd.differential?.[1]);
    expect(slice.sliceName).toBe("VSCat");
    expect(req(slice.pattern).type).toBe("CodeableConcept");

    const status = req(sd.differential?.[2]);
    const fixed = req(status.fixed);
    expect(fixed.type).toBe("Code");
    expect(isPrimitive(fixed.value) && fixed.value.value).toBe("final");
  });

  it("derives a sliceName from the element id when sliceName is absent", () => {
    const sd = req(
      loadSd({
        resourceType: "StructureDefinition",
        url: "http://x",
        type: "Observation",
        differential: {
          element: [{ id: "Observation.category:VSCat", path: "Observation.category" }],
        },
      }),
    );
    expect(req(sd.differential?.[0]).sliceName).toBe("VSCat");
  });

  it("defaults slicing rules to open and drops an unknown rules value", () => {
    const sd = req(
      loadSd({
        resourceType: "StructureDefinition",
        url: "http://x",
        type: "Observation",
        differential: {
          element: [
            {
              id: "Observation.category",
              path: "Observation.category",
              slicing: { discriminator: [{ type: "value", path: "code" }], rules: "nonsense" },
            },
          ],
        },
      }),
    );
    expect(req(req(sd.differential?.[0]).slicing).rules).toBe("open");
  });

  it("returns undefined for a non-StructureDefinition or one missing url/type", () => {
    expect(loadSd({ resourceType: "Patient" })).toBeUndefined();
    expect(loadSd({ resourceType: "StructureDefinition", type: "Patient" })).toBeUndefined();
    expect(loadSd({ resourceType: "StructureDefinition", url: "http://x" })).toBeUndefined();
  });

  it("exposes the R4 discriminator-type set without the R5-only 'position'", () => {
    expect([...DISCRIMINATOR_TYPES]).toEqual(["value", "exists", "pattern", "type", "profile"]);
    expect(DISCRIMINATOR_TYPES).not.toContain("position");
  });
});

describe("loadStructureDefinition: shapes it reads leniently and parts it leaves out", () => {
  function element(extra: Record<string, unknown>) {
    const sd = req(
      loadSd({
        resourceType: "StructureDefinition",
        url: "http://example.org/StructureDefinition/shapes",
        type: "Observation",
        differential: { element: [{ id: "Observation.code", path: "Observation.code", ...extra }] },
      }),
    );
    return req(sd.differential?.[0]);
  }

  it("reads a single type, profile and constraint object as a one-item list", () => {
    const el = element({
      type: { code: "CodeableConcept", profile: "http://example.org/StructureDefinition/cc" },
      constraint: { key: "x-1", expression: "coding.exists()" },
    });
    expect(el.type).toEqual([
      { code: "CodeableConcept", profile: ["http://example.org/StructureDefinition/cc"] },
    ]);
    expect(el.constraint).toEqual([
      { key: "x-1", severity: "error", expression: "coding.exists()" },
    ]);
  });

  it("drops type, profile, constraint and discriminator entries that are not objects or strings", () => {
    const el = element({
      type: ["CodeableConcept"],
      constraint: ["x-1"],
      slicing: { discriminator: ["value"], rules: "closed" },
    });
    expect(el.type).toBeUndefined();
    expect(el.constraint).toBeUndefined();
    expect(el.slicing).toEqual({ discriminator: [], rules: "closed" });
  });

  it("drops a type with no code, and a profile list with no string in it", () => {
    expect(element({ type: [{ profile: ["http://example.org/p"] }] }).type).toBeUndefined();
    expect(element({ type: [{ code: "Quantity", profile: [1, true] }] }).type).toEqual([
      { code: "Quantity" },
    ]);
  });

  it("drops a discriminator missing its path, and reads slicing with no discriminator at all", () => {
    const el = element({
      slicing: { discriminator: [{ type: "value" }, { type: "pattern", path: "$this" }] },
    });
    expect(el.slicing).toEqual({
      discriminator: [{ type: "pattern", path: "$this" }],
      rules: "open",
    });
    expect(element({ slicing: { rules: "openAtEnd" } }).slicing).toEqual({
      discriminator: [],
      rules: "openAtEnd",
    });
  });

  it("drops a binding with no strength", () => {
    expect(element({ binding: { valueSet: "http://example.org/vs" } }).binding).toBeUndefined();
    expect(element({ binding: { strength: "required" } }).binding).toEqual({
      strength: "required",
    });
  });

  it("reads fixed[x] and pattern[x] only under a type-suffixed name", () => {
    const el = element({ fixed: "x", patternless: "y", fixedCode: "final" });
    expect(el.fixed?.type).toBe("Code");
    expect(el.pattern).toBeUndefined();
  });

  it("skips an element entry that is not an object, and reads a snapshot with no element as absent", () => {
    const sd = req(
      loadSd({
        resourceType: "StructureDefinition",
        url: "http://example.org/StructureDefinition/sparse",
        type: "Observation",
        differential: { element: ["Observation.code"] },
        snapshot: {},
      }),
    );
    expect(sd.differential).toEqual([]);
    expect(sd.snapshot).toBeUndefined();
  });

  it("reads a single element object as a one-element list", () => {
    const sd = req(
      loadSd({
        resourceType: "StructureDefinition",
        url: "http://example.org/StructureDefinition/one",
        type: "Observation",
        snapshot: { element: { id: "Observation", path: "Observation" } },
      }),
    );
    expect(sd.snapshot).toEqual([{ id: "Observation", path: "Observation" }]);
  });
});

describe("what an element definition states that the model does not read", () => {
  const elementOf = (element: Record<string, unknown>) =>
    req(
      loadSd({
        resourceType: "StructureDefinition",
        url: "http://example.org/StructureDefinition/fake-unmodeled",
        type: "Patient",
        snapshot: { element: [{ id: "Patient.x", path: "Patient.x", ...element }] },
      })?.snapshot?.[0],
    );

  it("records nothing for what it reads and what only documents an element", () => {
    const el = elementOf({
      short: "fake",
      definition: "fake",
      comment: "fake",
      requirements: "fake",
      alias: ["fake"],
      base: { path: "Patient.x", min: 0, max: "1" },
      mapping: [{ identity: "fake", map: "fake" }],
      isModifier: false,
      isSummary: true,
      condition: ["fake-1"],
      representation: ["xmlAttr"],
      label: "fake",
      code: [{ code: "fake" }],
      sliceIsConstraining: false,
      meaningWhenMissing: "fake",
      orderMeaning: "fake",
      isModifierReason: "fake",
      example: [{ label: "fake", valueString: "fake" }],
      min: 0,
      max: "1",
      mustSupport: true,
      fixedString: "fake",
      patternString: "fake",
      constraint: [{ key: "fake-1", severity: "error", expression: "true" }],
      extension: [
        { url: "http://hl7.org/fhir/StructureDefinition/elementdefinition-translatable" },
        { url: "http://hl7.org/fhir/us/core/StructureDefinition/uscdi-requirement" },
      ],
      binding: {
        strength: "required",
        valueSet: "http://example.org/ValueSet/fake",
        description: "fake",
        extension: [
          { url: "http://hl7.org/fhir/StructureDefinition/elementdefinition-bindingName" },
        ],
      },
      type: [
        {
          code: "string",
          profile: ["http://example.org/StructureDefinition/fake"],
          extension: [
            { url: "http://hl7.org/fhir/StructureDefinition/structuredefinition-fhir-type" },
          ],
        },
      ],
    });
    expect(el.unmodeled).toBeUndefined();
  });

  it("records every other member, extension and part of a binding or a type, once", () => {
    const el = elementOf({
      maxLength: 3,
      minValueInteger: 1,
      fixedlower: 1,
      fixed: 1,
      prefixedFake: 1,
      contentReference: "#Patient.y",
      extension: [
        { url: "http://example.org/StructureDefinition/fake-rule" },
        { url: "http://example.org/StructureDefinition/fake-rule" },
        { valueString: "no url" },
      ],
      modifierExtension: [{ url: "http://example.org/StructureDefinition/fake-modifier" }],
      binding: {
        strength: "extensible",
        extension: [
          { url: "http://hl7.org/fhir/StructureDefinition/elementdefinition-maxValueSet" },
        ],
        additional: true,
      },
      type: [
        { code: "Reference", aggregation: ["contained"] },
        { code: "Reference", versioning: "specific", patternFake: 1 },
      ],
    });
    expect(el.unmodeled).toEqual([
      "maxLength",
      "minValueInteger",
      "fixedlower",
      "fixed",
      "prefixedFake",
      "contentReference",
      "extension:http://example.org/StructureDefinition/fake-rule",
      "extension:",
      "modifierExtension",
      "binding.extension:http://hl7.org/fhir/StructureDefinition/elementdefinition-maxValueSet",
      "binding.additional",
      "type.aggregation",
      "type.versioning",
      "type.patternFake",
    ]);
  });

  it("records a binding or an invariant it could not read", () => {
    expect(
      elementOf({ binding: { valueSet: "http://example.org/ValueSet/fake" } }).unmodeled,
    ).toEqual(["binding:unread"]);
    expect(
      elementOf({
        constraint: [
          { key: "fake-1", severity: "error", expression: "true" },
          { key: "fake-2", severity: "error", xpath: "true()" },
        ],
      }).unmodeled,
    ).toEqual(["constraint:unread"]);
    expect(
      elementOf({ constraint: { key: "fake-1", expression: "true" } }).unmodeled,
    ).toBeUndefined();
  });

  it("reads past a binding or a type that is not an object", () => {
    expect(elementOf({ type: ["fake"] }).unmodeled).toBeUndefined();
    // A binding that is not an object is stated, and not read.
    expect(elementOf({ binding: "fake" }).unmodeled).toEqual(["binding:unread"]);
  });

  it("reads one extension written bare, and one that is not an object, as unrecognised", () => {
    const el = elementOf({
      extension: { url: "http://example.org/StructureDefinition/fake-single" },
      binding: { strength: "required", extension: ["fake"] },
    });
    expect(el.unmodeled).toEqual([
      "extension:http://example.org/StructureDefinition/fake-single",
      "binding.extension:",
    ]);
  });
});
