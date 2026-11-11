/**
 * The JSON writer joins a long run of output by concatenation rather than by `join` (one copy of a
 * large attachment instead of one per level of nesting). The text it returns has to be the same,
 * byte for byte, on both sides of the threshold and at every place a run is joined: an object's
 * members, a list of complexes, a list of primitives, a nested list and a primitive's extensions.
 */

import { describe, expect, it } from "vitest";

import { parseResource, serializeResource } from "../src/index.js";

/** A synthetic base64-shaped payload of `length` characters. */
function payload(length: number, seed: number): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let text = "";
  let x = seed + 1;
  for (let i = 0; i < length; i++) {
    x = (x * 1103515245 + 12345) % 2147483648;
    text += alphabet[x % 64];
  }
  return text;
}

/** A canonical document whose long values sit at every kind of position the writer joins. */
function document(length: number): string {
  return JSON.stringify({
    resourceType: "DiagnosticReport",
    id: "DR-000001",
    status: "final",
    code: { text: payload(length, 1) },
    presentedForm: [
      { contentType: "application/pdf", data: payload(length, 2), title: "Synthetic report" },
      { contentType: "text/plain", data: payload(16, 3) },
    ],
    conclusion: payload(length, 4),
    _conclusion: {
      extension: [{ url: "http://example.org/fhir/note", valueString: payload(length, 5) }],
    },
    identifier: [{ value: "a" }, { value: payload(length, 6) }],
  });
}

describe("serializeResource on long values", () => {
  for (const length of [1, 1000, 4095, 4096, 4097, 70_000]) {
    it(`writes a document with ${String(length)} character values back byte for byte`, () => {
      const text = document(length);
      const { resource, issues } = parseResource(text);
      expect(issues).toEqual([]);
      expect(serializeResource(resource)).toBe(text);
    });
  }

  it("writes a list of long primitives and a nested list as it read them", () => {
    const long = payload(5000, 7);
    const text = JSON.stringify({
      resourceType: "Patient",
      name: [{ given: [long, "Ann", long] }],
      extension: [{ url: "http://example.org/fhir/x", valueString: long }],
    });
    expect(serializeResource(parseResource(text).resource)).toBe(text);
    const nested = `{"resourceType":"Patient","name":[[{"family":"${long}"}],[{"family":"Roe"}]]}`;
    expect(serializeResource(parseResource(nested).resource)).toBe(nested);
  });
});
