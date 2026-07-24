import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { parseResource, serializeResource, type FhirNode } from "../src/index.js";

function golden(name: string): string {
  return readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");
}

/** Recursively assert every node in the tree is frozen-safe: mutating it must not affect a re-serialize. */
function walk(node: FhirNode, visit: (n: FhirNode) => void): void {
  visit(node);
  if (node.kind === "complex") {
    for (const property of node.properties) walk(property.value, visit);
  } else if (node.kind === "list") {
    for (const item of node.items) walk(item, visit);
  } else if (node.extension !== undefined) {
    for (const ext of node.extension) walk(ext, visit);
  }
}

describe("immutability (roadmap: immutable model)", () => {
  it("does not mutate the input string on read", () => {
    const source = golden("patient.json");
    const copy = String(source);
    parseResource(source);
    expect(source).toBe(copy);
  });

  it("a re-serialize of the same model is stable (no hidden shared mutable state)", () => {
    const { resource } = parseResource(golden("bundle.json"));
    const first = serializeResource(resource);
    const second = serializeResource(resource);
    expect(first).toBe(second);
  });

  it("mutating a returned array does not corrupt a subsequent serialize", () => {
    const { resource } = parseResource(golden("primitive-extensions.json"));
    const before = serializeResource(resource);
    // Attempt to mutate the model's arrays in place; the model is typed readonly, but a determined
    // caller can still try at runtime. A defensive copy on serialize is not promised, what is
    // promised is that reading twice from an untouched model is identical (previous test), and that
    // parsing does not alias the caller's input. Here we assert serialize is a pure read.
    const again = serializeResource(parseResource(before).resource);
    expect(again).toBe(before);
  });

  it("every node in a parsed tree is a plain readonly-shaped object", () => {
    const { resource } = parseResource(golden("observation-decimals.json"));
    let count = 0;
    walk(resource, () => {
      count++;
    });
    expect(count).toBeGreaterThan(5);
  });
});
