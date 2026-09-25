/**
 * Read the same resource from JSON and from XML into one model, and see a DTD refused.
 *
 * Both codecs produce the same schema-free model, so everything after the read is format-blind.
 * The inputs are a synthetic Observation committed in both wire formats as
 * `test/__fixtures__/observation-decimals.json` and `.xml`. Its decimals are chosen to break a
 * reader that goes through a JavaScript number: `70.0`, `0.0000000010`, `0.010` and
 * `9223372036854775807`.
 *
 * Run from the repository root after `pnpm build`:
 *
 *     pnpm tsx examples/json-and-xml.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  FhirXmlError,
  nodesEquivalent,
  parseResource,
  parseResourceXml,
  readObservationValue,
  serializeResourceXml,
} from "@cosyte/fhir";

const fixture = (name: string): string =>
  readFileSync(new URL(`../test/__fixtures__/${name}`, import.meta.url), "utf8");

const xmlText = fixture("observation-decimals.xml");
const fromJson = parseResource(fixture("observation-decimals.json")).resource;
const fromXml = parseResourceXml(xmlText).resource;

const equivalent = nodesEquivalent(fromJson, fromXml);
console.log("JSON and XML read to equivalent models:", equivalent);

const magnitude = readObservationValue(fromXml)?.quantity?.value?.raw;
console.log("Magnitude read from XML:", magnitude);

// Written back to XML, the document comes out byte for byte as it went in.
const rewritten = serializeResourceXml(fromXml);
console.log("XML round trip is byte-exact:", rewritten === xmlText);

// The XML reader refuses any DTD rather than resolving or expanding an entity, so an XXE or
// billion-laughs payload is a typed error, never a file read or a hang.
const hostile =
  '<?xml version="1.0"?><!DOCTYPE Patient [<!ENTITY x "synthetic">]>' +
  '<Patient xmlns="http://hl7.org/fhir"><id value="&x;"/></Patient>';
let refusal = "";
try {
  parseResourceXml(hostile);
} catch (error) {
  if (!(error instanceof FhirXmlError)) throw error;
  refusal = error.code;
}
console.log("A document with a DTD is refused:", refusal);

assert.equal(equivalent, true);
assert.equal(magnitude, "70.0");
assert.equal(rewritten, xmlText);
assert.equal(refusal, "DTD_FORBIDDEN");
console.log("json-and-xml: ok");
