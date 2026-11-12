/**
 * The mutation suite never judges a mutant by the text of `src/`.
 *
 * StrykerJS runs `vitest.mutation.config.ts` in a sandbox whose `src/` it has rewritten: every
 * mutable expression becomes a chain of ternaries over the mutant switch, so
 * `a.nonObjectSource === b.nonObjectSource` turns into text holding `nonObjectSource :`. A test
 * that reads `src/` as text there reads that rewrite, not the source, and a census over it fails the
 * first, unmutated run before any mutant runs. Such a test cannot kill a mutant either: every mutant
 * shares the one rewritten text. So the mutation config says the source is instrumented, and every
 * test file of that suite that reads `src/` from disk imports the flag that skips its source
 * readers there.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import mutationConfigModule from "../vitest.mutation.config.js";

/** The parts of the mutation config this file reads. */
interface MutationTestConfig {
  readonly test: {
    readonly exclude?: readonly string[];
    readonly env?: Readonly<Record<string, string>>;
  };
}

const mutationConfig = mutationConfigModule as MutationTestConfig;

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Every `.test.ts` file under `test/`, as a path relative to the repository. */
function testFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      return entry.name === "__fixtures__" || entry.name === "__data__" ? [] : testFiles(path);
    }
    return entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

/** A glob of the config's exclude list (`**`, `*` and literals only) as a whole-path pattern. */
function globPattern(glob: string): RegExp {
  const source = glob
    .split("**")
    .map((part) =>
      part
        .split("*")
        .map((literal) => literal.replace(/[.+?^${}()|[\]\\]/gu, "\\$&"))
        .join("[^/]*"),
    )
    .join(".*");
  return new RegExp(`^${source}$`, "u");
}

const EXCLUDED: readonly RegExp[] = (mutationConfig.test.exclude ?? [])
  .filter((glob) => glob.startsWith("test/"))
  .map(globPattern);

/** The test files StrykerJS runs. */
const MUTATION_SUITE = testFiles("test").filter((path) => !EXCLUDED.some((re) => re.test(path)));

/** Whether a file names `src/` as a place on disk: `new URL("../src/", ...)` or `join(x, "src")`. */
function readsSourceFromDisk(text: string): boolean {
  return /new URL\(\s*["']\.\.\/src\/|join\([^)]*,\s*["']src["']/u.test(text);
}

describe("the mutation suite never judges a mutant by the text of src/", () => {
  it("says the source is instrumented, so the suite's source readers stand aside", () => {
    expect(mutationConfig.test.env?.["COSYTE_SOURCE_INSTRUMENTED"]).toBe("1");
  });

  it("finds the suite's test files, so the census below covers something", () => {
    expect(MUTATION_SUITE.length).toBeGreaterThan(100);
    expect(MUTATION_SUITE).toContain("test/json-only-shape.test.ts");
    expect(MUTATION_SUITE).not.toContain("test/property-depth.test.ts");
  });

  it("skips every test of that suite that reads src/ from disk while the source is instrumented", () => {
    const unguarded = MUTATION_SUITE.filter((path) => {
      const text = readFileSync(join(ROOT, path), "utf8");
      return readsSourceFromDisk(text) && !/\bSOURCE_IS_INSTRUMENTED\b/u.test(text);
    });
    expect(unguarded).toEqual([]);
  });
});
