import { describe, expect, it } from "vitest";

import {
  isComplex,
  isPrimitive,
  nodesEquivalent,
  parseResource,
  parseResourceXml,
  readSafety,
  serializeResource,
  serializeResourceXml,
  validateResource,
  type FhirComplex,
  type ValidationIssue,
} from "../src/index.js";

/**
 * An `<extension>` that holds only nested extensions, read from XML.
 *
 * Without a datatype schema the XML reader tells a primitive from a complex element by its content:
 * a `value` attribute, or nothing but `<extension>` children, reads as a primitive. An Extension that
 * carries only nested extensions (`ext-1` allows a value or nested extensions, never both) matched
 * the second test, so it read as a value-absent primitive. Its `url` attribute, which a primitive
 * does not have, was reported `UNKNOWN_PROPERTY` and left off the model, and both writers then wrote
 * the extension without it: the XML round trip lost the URL that says what the extension means. At a
 * resource's root the validator also reported a type mismatch. A US Core race or ethnicity extension
 * has exactly this shape.
 *
 * An element carrying a `url` attribute is now read as an Extension, a complex element, whatever its
 * children: FHIR XML gives a primitive only `value` and `id`. All values are synthetic.
 *
 * Found by the round-trip property on the generators at `@cosyte/fhir/arbitraries`.
 */

const NS = 'xmlns="http://hl7.org/fhir"';
const OUTER = "http://example.org/fhir/StructureDefinition/synthetic-complex";
const INNER = "http://example.org/fhir/StructureDefinition/synthetic-part";

const NESTED_JSON = {
  url: OUTER,
  extension: [
    { url: INNER, valueBoolean: true },
    { url: `${INNER}-b`, valueString: "synthetic" },
  ],
};

/** The one extension a model carries at `extension` (a single occurrence reads as one node). */
function onlyExtension(model: FhirComplex, name = "extension"): FhirComplex {
  const node = model.properties.find((p) => p.name === name)?.value;
  if (node === undefined || !isComplex(node)) throw new Error(`no complex ${name}`);
  return node;
}

describe("an extension holding only nested extensions, read from XML", () => {
  for (const [where, doc] of [
    ["at the root", { resourceType: "Patient", extension: [NESTED_JSON] }],
    [
      "one level down",
      {
        resourceType: "Patient",
        contact: [{ extension: [NESTED_JSON], name: { text: "synthetic" } }],
      },
    ],
  ] as const) {
    it(`${where}: reads as an Extension with its url, equivalent to the JSON read`, () => {
      const fromJson = parseResource(JSON.stringify(doc)).resource;
      const xml = serializeResourceXml(fromJson);
      const read = parseResourceXml(xml);
      expect(read.issues).toEqual([]);
      expect(nodesEquivalent(read.resource, fromJson)).toBe(true);
      // The same findings, each at the same location but for the index of a lone item: XML spells
      // a one-item repeat as one element, and the model holds it as one node, where JSON writes a
      // one-item array.
      const lone = (issues: readonly ValidationIssue[]) =>
        issues.map((i) => ({ ...i, expression: i.expression.replaceAll("[0]", "") }));
      expect(validateResource(read.resource, { mode: "strict" }).issues).toEqual(
        lone(validateResource(fromJson, { mode: "strict" }).issues),
      );
    });

    it(`${where}: writes back with its url, in XML and in JSON`, () => {
      const fromJson = parseResource(JSON.stringify(doc)).resource;
      const xml = serializeResourceXml(fromJson);
      const read = parseResourceXml(xml).resource;
      expect(serializeResourceXml(read)).toBe(xml);
      expect(serializeResource(read)).toContain(`"url":"${OUTER}"`);
    });
  }

  it("keeps the url on the model at the root", () => {
    const xml = `<Patient ${NS}><extension url="${OUTER}"><extension url="${INNER}"><valueBoolean value="true"/></extension></extension></Patient>`;
    const ext = onlyExtension(parseResourceXml(xml).resource);
    const url = ext.properties.find((p) => p.name === "url")?.value;
    expect(url !== undefined && isPrimitive(url) ? url.value : undefined).toBe(OUTER);
    expect(ext.properties.map((p) => p.name)).toEqual(["url", "extension"]);
  });

  it("reads an extension with a url and nothing else as an Extension, which ext-1 then reports", () => {
    const xml = `<Patient ${NS}><extension url="${OUTER}"/></Patient>`;
    const read = parseResourceXml(xml);
    expect(read.issues).toEqual([]);
    expect(serializeResource(read.resource)).toBe(
      `{"resourceType":"Patient","extension":{"url":"${OUTER}"}}`,
    );
    const issues = validateResource(read.resource).issues;
    expect(issues.map((i) => `${i.code} ${i.expression}`)).toEqual([
      "INVARIANT_VIOLATED Patient.extension",
      "EXTENSION_UNCHECKED Patient.extension",
    ]);
    expect(serializeResourceXml(read.resource)).toBe(xml);
  });

  it("still fails closed on a modifier extension holding only nested extensions", () => {
    const xml = `<Patient ${NS}><modifierExtension url="${OUTER}"><extension url="${INNER}"><valueBoolean value="true"/></extension></modifierExtension></Patient>`;
    const read = parseResourceXml(xml);
    expect(read.issues).toEqual([]);
    expect(onlyExtension(read.resource, "modifierExtension").properties[0]?.name).toBe("url");
    const result = validateResource(read.resource);
    expect(result.valid).toBe(false);
    expect(result.issues.map((i) => i.code)).toEqual(["UNHANDLED_MODIFIER_EXTENSION"]);
    expect(readSafety(read.resource).safeToSummarize).toBe(false);
  });

  it("leaves the declared residual alone: an element other than an extension, holding only an extension, still reads as a value-absent primitive", () => {
    const xml = `<Patient ${NS}><name><extension url="${INNER}"><valueBoolean value="true"/></extension></name></Patient>`;
    const name = parseResourceXml(xml).resource.properties.find((p) => p.name === "name")?.value;
    expect(name !== undefined && isPrimitive(name)).toBe(true);
  });
});
