import { describe, expect, it } from "vitest";

import {
  FhirSerializeError,
  parseResource,
  parseResourceXml,
  readSafety,
  SERIALIZE_ERROR_CODES,
  serializeResource,
  serializeResourceXml,
  validateResource,
  type FhirComplex,
} from "../src/index.js";

/**
 * A `resourceType` with no string in it, which the XML writer used to delete while naming the
 * element `Resource`.
 *
 * FHIR XML has no `resourceType` element: the type IS the tag (xml.html). So the writer skips that
 * property at every element it walks and takes the tag from the property's string value, and where
 * there is no string to take the root fell back to `Resource`. The property, and everything its
 * value carried, left the document with no diagnostic at either end.
 *
 * Measured at `63b05fc`: `{"resourceType":{"modifierExtension":[{"url":"http://example.org/x"}]},
 * "status":"final"}` reads `RESOURCE_TYPE_UNKNOWN` at error severity with `valid: false`, and
 * `safeToSummarize: false` for the unhandled modifier extension the type gate carries. It emitted
 * `<Resource xmlns="http://hl7.org/fhir"><status value="final"/></Resource>`, which re-reads with an
 * empty issue list, `valid: true` and `safeToSummarize: true`.
 *
 * `serializeResource` emits such a value through its ordinary path, so the JSON route stays open and
 * is pinned here beside every refusal.
 *
 * All values are synthetic.
 */

/** Serialize, returning the refusal rather than throwing. */
function refusal(
  write: (node: FhirComplex) => string,
  resource: FhirComplex,
): FhirSerializeError | undefined {
  try {
    write(resource);
    return undefined;
  } catch (err) {
    if (err instanceof FhirSerializeError) return err;
    throw err;
  }
}

/** Read a JSON document and take both writers' verdicts on it. */
function fromJson(json: string): {
  resource: FhirComplex;
  viaXml: FhirSerializeError | undefined;
  viaJson: FhirSerializeError | undefined;
} {
  const { resource } = parseResource(json);
  return {
    resource,
    viaXml: refusal(serializeResourceXml, resource),
    viaJson: refusal(serializeResource, resource),
  };
}

describe("a resourceType XML has no tag to name", () => {
  describe("the defect, both halves of it", () => {
    it("refuses the shape whose emitted document upgraded valid AND safeToSummarize", () => {
      const doc =
        '{"resourceType":{"modifierExtension":[{"url":"http://example.org/x"}]},"status":"final"}';
      const { resource, viaXml, viaJson } = fromJson(doc);

      // The input, as this library reports it.
      const before = validateResource(resource);
      expect(before.valid).toBe(false);
      expect(before.issues.map((issue) => issue.code)).toContain("RESOURCE_TYPE_UNKNOWN");
      expect(readSafety(resource).safeToSummarize).toBe(false);

      expect(viaXml?.code).toBe(SERIALIZE_ERROR_CODES.UNSERIALIZABLE_RESOURCE_TYPE);
      expect(viaXml?.locations).toEqual(["Resource.resourceType"]);
      // The JSON route is the one that stays open, and it is byte-identical here.
      expect(viaJson).toBeUndefined();
      expect(serializeResource(resource)).toBe(doc);
    });

    it("what base emitted for it, which is the half a refusal cannot show", () => {
      // Written as the document base produced, so this pins the harm rather than the remedy: the
      // type gate and the modifier extension it carried are both absent, and every layer affirms.
      const laundered = parseResourceXml(
        '<Resource xmlns="http://hl7.org/fhir"><status value="final"/></Resource>',
      );
      expect(laundered.issues).toEqual([]);
      expect(validateResource(laundered.resource).valid).toBe(true);
      expect(readSafety(laundered.resource).safeToSummarize).toBe(true);
      expect(readSafety(laundered.resource).unhandledModifierExtensions).toEqual([]);
    });

    it.each([
      ["a number", "42"],
      ["a boolean", "true"],
      ["a decimal", "1.50"],
      ["an object", '{"x":1}'],
    ])("refuses %s type gate and serializeResource writes it back", (_label, value) => {
      const doc = `{"resourceType":${value},"status":"entered-in-error"}`;
      const { resource, viaXml, viaJson } = fromJson(doc);
      expect(viaXml?.code).toBe(SERIALIZE_ERROR_CODES.UNSERIALIZABLE_RESOURCE_TYPE);
      expect(viaJson).toBeUndefined();
      expect(serializeResource(resource)).toBe(doc);
    });

    it("refuses a value-absent type gate carried only by its `_`-sibling", () => {
      // The reader models `_resourceType` as the primitive's metadata, so the property exists with
      // no value at all. The writer deleted it and the `id` went with it.
      const doc = '{"_resourceType":{"id":"q"},"status":"final"}';
      const { resource, viaXml } = fromJson(doc);
      expect(viaXml?.code).toBe(SERIALIZE_ERROR_CODES.UNSERIALIZABLE_RESOURCE_TYPE);
      expect(validateResource(resource).valid).toBe(false);
      expect(serializeResource(resource)).toBe(doc);
    });
  });

  describe("the window reaches every depth, because every one of them names an element", () => {
    it.each([
      [
        "contained",
        '{"resourceType":"Patient","contained":[{"resourceType":42,"status":"entered-in-error"}]}',
        "Patient.contained[0].resourceType",
      ],
      [
        "a Bundle entry",
        '{"resourceType":"Bundle","entry":[{"resource":{"resourceType":42,"status":"entered-in-error"}}]}',
        "Bundle.entry[0].resource.resourceType",
      ],
      [
        "an ordinary element",
        '{"resourceType":"Patient","name":{"resourceType":42,"family":"Roe"}}',
        "Patient.name.resourceType",
      ],
    ])("refuses one at %s", (_label, doc, location) => {
      const { resource, viaXml, viaJson } = fromJson(doc);
      expect(viaXml?.code).toBe(SERIALIZE_ERROR_CODES.UNSERIALIZABLE_RESOURCE_TYPE);
      expect(viaXml?.locations).toEqual([location]);
      expect(viaJson).toBeUndefined();
      expect(serializeResource(resource)).toBe(doc);
    });

    it("names every such element once, in walk order", () => {
      const { viaXml } = fromJson(
        '{"resourceType":42,"contained":[{"resourceType":{"a":1}},{"resourceType":true}]}',
      );
      expect(viaXml?.locations).toEqual([
        "Resource.resourceType",
        "Resource.contained[0].resourceType",
        "Resource.contained[1].resourceType",
      ]);
    });
  });

  describe("what it deliberately does not refuse", () => {
    it("leaves an element that wrote no resourceType at all", () => {
      // `serializeResourceXml` accepts any complex and names a typeless one `Resource` by documented
      // fallback. Nothing is deleted there, so refusing would withdraw a route rather than a loss.
      const { resource, viaXml } = fromJson('{"status":"entered-in-error"}');
      expect(viaXml).toBeUndefined();
      expect(serializeResourceXml(resource)).toBe(
        '<Resource xmlns="http://hl7.org/fhir"><status value="entered-in-error"/></Resource>',
      );
    });

    it("leaves a conformant string type gate, byte-for-byte", () => {
      const { resource, viaXml } = fromJson(
        '{"resourceType":"Observation","status":"entered-in-error"}',
      );
      expect(viaXml).toBeUndefined();
      expect(serializeResourceXml(resource)).toBe(
        '<Observation xmlns="http://hl7.org/fhir"><status value="entered-in-error"/></Observation>',
      );
    });

    it.each([
      ["an object beside the tag's own string", '<resourceType><a value="1"/></resourceType>'],
      ["an empty element beside it", "<resourceType/>"],
      ["a second string beside it", '<resourceType value="Observation"/>'],
    ])(
      "leaves %s, which is the repeated-property-name case rather than this one",
      (_label, child) => {
        // The XML reader has no `duplicates` mechanism, so a `resourceType` CHILD element lands as a
        // second property of that name beside the one synthesized from the tag. The tag is named
        // correctly, so this defect's substitution never happens; the drop that does happen is the
        // one both writers make on a repeated name, declared separately. That document reads clean,
        // and refusing it would be the one cost none of the refusals beside this one pays.
        const { resource, issues } = parseResourceXml(
          `<Patient xmlns="http://hl7.org/fhir">${child}</Patient>`,
        );
        expect(issues).toEqual([]);
        expect(validateResource(resource).valid).toBe(true);
        expect(readSafety(resource).safeToSummarize).toBe(true);
        expect(refusal(serializeResourceXml, resource)).toBeUndefined();
        expect(serializeResourceXml(resource)).toBe('<Patient xmlns="http://hl7.org/fhir"/>');
      },
    );
  });

  describe("raised last, so no case moves onto the new code", () => {
    it.each([
      [
        "a null type gate",
        '{"resourceType":null,"status":"final"}',
        SERIALIZE_ERROR_CODES.UNSERIALIZABLE_JSON_ONLY_SHAPE,
      ],
      [
        "an array-wrapped type gate",
        '{"resourceType":["Observation"],"status":"final"}',
        SERIALIZE_ERROR_CODES.UNSERIALIZABLE_ARRAY_WRAPPER,
      ],
      [
        "an empty wrapper on it",
        '{"resourceType":[],"status":"final"}',
        SERIALIZE_ERROR_CODES.UNSERIALIZABLE_ARRAY_WRAPPER,
      ],
      [
        "a shadowed type gate",
        '{"resourceType":42,"resourceType":"Observation","status":"final"}',
        SERIALIZE_ERROR_CODES.UNSERIALIZABLE_SHADOWED_PROPERTY,
      ],
    ])("%s keeps the code base already reported", (_label, doc, code) => {
      expect(fromJson(doc).viaXml?.code).toBe(code);
    });

    it("a dropped-element-text marker beside one keeps its own code", () => {
      const { resource } = parseResourceXml(
        '<Observation xmlns="http://hl7.org/fhir"><status>final</status></Observation>',
      );
      expect(refusal(serializeResourceXml, resource)?.code).toBe(
        SERIALIZE_ERROR_CODES.DROPPED_ELEMENT_TEXT,
      );
    });
  });

  describe("the refusal itself", () => {
    it("carries no document content in its message or its locations", () => {
      const { viaXml } = fromJson('{"resourceType":{"Mrs Roe 1980-01-01":"secret"},"id":"x"}');
      expect(viaXml?.message).not.toContain("Roe");
      expect(viaXml?.message).not.toContain("secret");
      expect(viaXml?.locations.join(" ")).not.toContain("Roe");
      expect(viaXml?.locations).toEqual(["Resource.resourceType"]);
    });

    it("is a FhirSerializeError with the new code on the public surface", () => {
      expect(SERIALIZE_ERROR_CODES.UNSERIALIZABLE_RESOURCE_TYPE).toBe(
        "UNSERIALIZABLE_RESOURCE_TYPE",
      );
      const { viaXml } = fromJson('{"resourceType":42}');
      expect(viaXml).toBeInstanceOf(FhirSerializeError);
      expect(viaXml?.name).toBe("FhirSerializeError");
    });
  });
});
