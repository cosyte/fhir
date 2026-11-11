/**
 * A read from text lets each item of its own raw tree go once the item is built. A tree a caller
 * hands in is the caller's: it has to come back unchanged, and read the same model the text does.
 */

import { describe, expect, it } from "vitest";

import { parseResource, readRawJson, serializeResource } from "../src/index.js";

const TEXT = JSON.stringify({
  resourceType: "Bundle",
  type: "collection",
  entry: [
    { resource: { resourceType: "Patient", name: [{ family: "Roe", given: ["SYNTHGIVEN"] }] } },
    { resource: { resourceType: "Observation", status: "final", component: [{ id: "c1" }] } },
    [{ nested: true }],
  ],
});

describe("a read from a raw tree", () => {
  it("leaves the caller's tree as it was and reads what the text reads", () => {
    const tree = readRawJson(TEXT);
    const before = JSON.stringify(tree);
    const fromTree = parseResource(tree);
    expect(JSON.stringify(tree)).toBe(before);
    const fromText = parseResource(TEXT);
    expect(fromTree).toEqual(fromText);
    expect(serializeResource(fromText.resource)).toBe(serializeResource(fromTree.resource));
  });

  it("reads a tree again after a read from text, and a text after a refused one", () => {
    expect(() =>
      parseResource('{"resourceType":"Patient","name":[{"given":["a"],"_given":[]}]}'),
    ).toThrow();
    const tree = readRawJson(TEXT);
    parseResource(TEXT);
    const before = JSON.stringify(tree);
    parseResource(tree);
    expect(JSON.stringify(tree)).toBe(before);
  });
});
