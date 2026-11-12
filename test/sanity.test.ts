import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

/**
 * The `VERSION` of a fresh import of the package source. A static import would run
 * `src/index.ts` while the file loads, before any case starts, and the mutation run cannot tell
 * which case a mutant in that module-level line belongs to. Importing it inside the case that
 * asserts on it ties the line to that case.
 */
async function freshVersion(): Promise<string> {
  vi.resetModules();
  const { VERSION } = await import("../src/index.js");
  return VERSION;
}

/**
 * P0 bootstrap sanity gate, the "empty-but-present" test the scaffold requires to be green.
 *
 * It asserts two things that must hold from the very first commit:
 *  1. The package is resolvable through its entry point and exports a `VERSION` string.
 *  2. That `VERSION` export matches `package.json#version`, the drift guard for
 *     `cosyte-process sync-version`. If a Changesets bump ever forgets to re-run sync-version, this
 *     goes red instead of publishing a lying constant.
 */
describe("@cosyte/fhir scaffold", () => {
  it("exports a VERSION string", async () => {
    const VERSION = await freshVersion();
    expect(typeof VERSION).toBe("string");
    expect(VERSION.length).toBeGreaterThan(0);
  });

  it("keeps VERSION in sync with package.json", async () => {
    const VERSION = await freshVersion();
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      version: string;
    };
    expect(VERSION).toBe(pkg.version);
  });

  it("stays on the 0.x line, where every release is a patch", async () => {
    const VERSION = await freshVersion();
    // Every package moved to 0.1.x, so the ladder this pins is the 0.x one: a plain
    // `0.minor.patch`, never a 1.0, a major or a prerelease. Below 1.0 a break ships as a patch,
    // and the classification rule in `test/release-readiness.test.ts` refuses one whose changeset
    // does not say what a caller must do.
    expect(VERSION).toMatch(/^0\.\d+\.\d+$/);
  });
});
