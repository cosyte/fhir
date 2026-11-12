import { describe, expect, it } from "vitest";

import {
  parseResource,
  parseResourceXml,
  serializeResourceXml,
  validateResource,
} from "../src/index.js";

/**
 * A KNOWN GAP, PINNED: a narrative `div` that declares no namespace changes namespace when the XML
 * writer writes it.
 *
 * The XML writer splices a narrative's `div` string into a document whose default namespace is
 * FHIR's. A `div` string that declares its own default namespace (as R4 requires: the XHTML one)
 * keeps it. One that declares none is in no namespace where it was read, and takes on the FHIR
 * namespace where it is written:
 *
 * - From XML: a document that binds FHIR's namespace to a prefix and writes `<div>` with no
 *   namespace reads with `UNEXPECTED_XML_CONTENT` at the narrative. Written back, the `div` sits in
 *   the FHIR default namespace, and the re-read raises nothing, so the finding is gone after one
 *   round trip. The next read records the inherited declaration in the `div` string, so the first
 *   rewrite is not a fixed point of the XML normalizer.
 * - From JSON: `"div":"<div><p>...</p></div>"` reads with no finding and is written to XML in the
 *   FHIR namespace. Validation does report it: the narrative layer finds the root outside the XHTML
 *   namespace (`NARRATIVE_ROOT_INVALID`), so the document is not `valid`, but the writer still moves
 *   it into the FHIR namespace.
 *
 * Found by the idempotent-normalize property on `hostileInput({ format: "xml" })`, which skips this
 * one shape until it is closed. When a change closes the gap these assertions red: rewrite them to
 * the new behavior and drop the skip in `test/property/standard.property.test.ts`. All values are
 * synthetic.
 */

const PREFIXED =
  '<f:Patient xmlns:f="http://hl7.org/fhir"><f:text><f:status value="generated"/><div><p>synthetic</p></div></f:text></f:Patient>';

describe("pinned gap: a narrative div with no namespace, written as XML", () => {
  it("from XML: the finding is reported on the first read and gone after one round trip", () => {
    const first = parseResourceXml(PREFIXED);
    expect(first.issues.map((i) => `${i.code} ${i.expression}`)).toEqual([
      "UNEXPECTED_XML_CONTENT Patient.text.div",
    ]);
    const once = serializeResourceXml(first.resource);
    expect(once).toBe(
      '<Patient xmlns="http://hl7.org/fhir"><text><status value="generated"/><div><p>synthetic</p></div></text></Patient>',
    );
    const second = parseResourceXml(once);
    expect(second.issues).toEqual([]);
    const twice = serializeResourceXml(second.resource);
    expect(twice).not.toBe(once);
    expect(twice).toContain('<div xmlns="http://hl7.org/fhir"><p>synthetic</p></div>');
    expect(serializeResourceXml(parseResourceXml(twice).resource)).toBe(twice);
  });

  it("from JSON: a div with no namespace reads with no finding and is written in the FHIR namespace", () => {
    const read = parseResource(
      '{"resourceType":"Patient","text":{"status":"generated","div":"<div><p>synthetic</p></div>"}}',
    );
    expect(read.issues).toEqual([]);
    const validation = validateResource(read.resource);
    expect(validation.valid).toBe(false);
    expect(validation.issues.map((i) => `${i.code} ${i.expression}`)).toContain(
      "NARRATIVE_ROOT_INVALID Patient.text.div",
    );
    expect(serializeResourceXml(read.resource)).toBe(
      '<Patient xmlns="http://hl7.org/fhir"><text><status value="generated"/><div><p>synthetic</p></div></text></Patient>',
    );
  });
});
