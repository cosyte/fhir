import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { VERSION } from "../src/index.js";

/**
 * P0 bootstrap sanity gate, the "empty-but-present" test the scaffold requires to be green.
 *
 * It asserts two things that must hold from the very first commit:
 *  1. The package is resolvable through its entry point and exports a `VERSION` string.
 *  2. That `VERSION` export matches `package.json#version`, the drift guard for
 *     `scripts/sync-version.mjs`. If a Changesets bump ever forgets to re-run sync-version, this
 *     goes red instead of publishing a lying constant.
 */
describe("@cosyte/fhir scaffold", () => {
  it("exports a VERSION string", () => {
    expect(typeof VERSION).toBe("string");
    expect(VERSION.length).toBeGreaterThan(0);
  });

  it("keeps VERSION in sync with package.json", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      version: string;
    };
    expect(VERSION).toBe(pkg.version);
  });

  it("starts on the v0.0.x pre-alpha ladder", () => {
    expect(VERSION).toMatch(/^0\.0\.\d+$/);
  });
});
