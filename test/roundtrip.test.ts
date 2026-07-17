import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { parseResource, serializeResource } from "../src/index.js";

/** Load a golden fixture as its exact text (fixtures carry no trailing newline). */
function golden(name: string): string {
  return readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");
}

/**
 * Round-trip golden files (roadmap §6 tier (c)). Each is a spec-clean, canonical R4 resource; parse
 * then serialize must reproduce it **byte-for-byte**, which is the no-data-loss acceptance bar for
 * Phase 1 — decimals with trailing zeros, values past 2^53, primitive extensions with null-padded
 * `_`-sibling alignment, and value-absent (extension-only) primitives all survive.
 */
describe("byte-identical round-trip (golden files)", () => {
  const files = [
    "patient.json",
    "observation-decimals.json",
    "primitive-extensions.json",
    "value-absent.json",
    "extension-only-list.json",
    "bundle.json",
  ];

  it.each(files)("round-trips %s byte-for-byte", (file) => {
    const source = golden(file);
    const { resource } = parseResource(source);
    expect(serializeResource(resource)).toBe(source);
  });

  it("is idempotent (a second round-trip changes nothing)", () => {
    for (const file of files) {
      const once = serializeResource(parseResource(golden(file)).resource);
      const twice = serializeResource(parseResource(once).resource);
      expect(twice).toBe(once);
    }
  });

  it("preserves decimal trailing zeros and 64-bit magnitude specifically", () => {
    const out = serializeResource(parseResource(golden("observation-decimals.json")).resource);
    expect(out).toContain('"value":70.0');
    expect(out).toContain('"value":0.010');
    expect(out).toContain('"value":0.0000000010');
    expect(out).toContain('"value":9223372036854775807');
  });
});
