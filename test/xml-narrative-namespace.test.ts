import { describe, expect, it } from "vitest";

import {
  FhirSerializeError,
  parseResource,
  parseResourceXml,
  SERIALIZE_ERROR_CODES,
  serializeResource,
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
 * - From XML, under a FHIR parent: a document that binds FHIR's namespace to a prefix and writes
 *   `<div>` with no namespace reads with `UNEXPECTED_XML_CONTENT` at the narrative. The `div` used
 *   to be written into the FHIR default namespace with the finding gone; it is now marked as read
 *   from another namespace, and both writers refuse it. That half is closed.
 * - From XML, under a root in no namespace: the `div` shares its parent's namespace and is not
 *   marked. Written back, it sits in the FHIR default namespace, and the next read records the
 *   inherited declaration in the `div` string, so the first rewrite is not a fixed point of the XML
 *   normalizer.
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

const UNSCOPED_ROOT =
  '<Patient><text><status value="generated"/><div><p>synthetic</p></div></text></Patient>';

describe("pinned gap: a narrative div with no namespace, written as XML", () => {
  it("from XML, under a FHIR parent: the finding is reported, and both writers refuse", () => {
    // This half was a pinned gap: the XML writer put the `div` in the FHIR default namespace and the
    // re-read raised nothing. The reader marks a `div` in a namespace other than its parent's, and
    // both writers now refuse a model carrying that mark, so there is no output to re-read.
    const first = parseResourceXml(PREFIXED);
    expect(first.issues.map((i) => `${i.code} ${i.expression}`)).toEqual([
      "UNEXPECTED_XML_CONTENT Patient.text.div",
    ]);
    for (const write of [serializeResourceXml, serializeResource]) {
      let refused: unknown;
      try {
        write(first.resource);
      } catch (err) {
        refused = err;
      }
      expect(refused).toBeInstanceOf(FhirSerializeError);
      expect((refused as FhirSerializeError).code).toBe(
        SERIALIZE_ERROR_CODES.UNSERIALIZABLE_FOREIGN_NAMESPACE,
      );
      expect((refused as FhirSerializeError).locations).toEqual(["Patient.text.div"]);
    }
  });

  it("from XML, under a root in no namespace: the div is not marked, and the first rewrite is not a fixed point", () => {
    // A root that declares no namespace is read as FHIR, and the `div` beside it shares its parent's
    // (empty) namespace, so nothing marks it. The writer puts it in the FHIR default namespace, and
    // the next read records that declaration in the `div` string. Still open.
    const first = parseResourceXml(UNSCOPED_ROOT);
    const once = serializeResourceXml(first.resource);
    expect(once).toBe(
      '<Patient xmlns="http://hl7.org/fhir"><text><status value="generated"/><div><p>synthetic</p></div></text></Patient>',
    );
    const twice = serializeResourceXml(parseResourceXml(once).resource);
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
