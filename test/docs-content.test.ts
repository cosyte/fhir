import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  docSnippetSuite,
  extractRunnableSnippets,
  runSnippet,
} from "@cosyte/vitest-config/snippets";

import { fences, fixturesByContent, resourceLiterals, section } from "./_first-use.js";

/**
 * Doc/code-agreement gate. Every ```` ```ts runnable ```` block in `docs-content/` and in `README.md`
 * is extracted, compiled and executed, and its inline `// =>` claims are asserted, so a documented
 * example cannot drift from the shipped code. Plain ` ```ts ` blocks are illustrative and are not
 * executed.
 *
 * Snippets import the package the way a consumer does: against the BUILT ESM artifact, which is
 * exactly what an installer loads. The harness executes each block as a standalone ES module, so it
 * cannot resolve the source tree's internal `.js` imports; the bundled `dist/index.mjs` is
 * self-contained. The CI gate runs `test` before `build`, so `dist/` is provisioned here. README and
 * `docs-content/` share this one file, and so one build, because two files each rebuilding `dist/`
 * in parallel would race on the output directory.
 */
const root = join(import.meta.dirname, "..");
const ENTRY = join(root, "dist", "index.mjs");
const README = join(root, "README.md");
const resolveEntry = (specifier: string): string | undefined =>
  specifier === "@cosyte/fhir" ? ENTRY : undefined;

beforeAll(() => {
  execFileSync("pnpm", ["build"], { cwd: root, stdio: "inherit" });
}, 180_000);

docSnippetSuite({
  docsDir: join(root, "docs-content"),
  requireSnippet: true,
  resolve: resolveEntry,
});

docSnippetSuite({
  name: "doc/code agreement (README)",
  files: [README],
  requireSnippet: true,
  resolve: resolveEntry,
});

/**
 * The two FIRST-USE examples, the quickstart's first block and the first block under the README's
 * `## Usage`, are the ones a reader runs first. Each must be a block a sweep above executes, each is
 * run again here, a changed value in either turns it red, and every resource literal either one
 * prints must be a byte-for-byte copy of a fixture under `test/__fixtures__`, the corpus `pnpm
 * phi-scan` reads. Temp modules for these runs live in their own directory inside the root and are
 * removed when the file is done.
 */
const FIRST_USE_TMP = join(root, ".cosyte-first-use-snippets");
const FIXTURE_DIR = join(root, "test", "__fixtures__");
const QUICKSTART_TEXT = readFileSync(join(root, "docs-content", "quickstart.md"), "utf8");
const README_TEXT = readFileSync(README, "utf8");
const FIRST_USE = [
  {
    doc: "docs-content/quickstart.md",
    ac: "AC-FH2",
    fence: fences(QUICKSTART_TEXT)[0],
    snippets: extractRunnableSnippets(QUICKSTART_TEXT),
  },
  {
    doc: "README.md",
    ac: "AC-FH3",
    fence: fences(section(README_TEXT, "## Usage"))[0],
    snippets: extractRunnableSnippets(README_TEXT),
  },
] as const;
const DIAGNOSTIC_CLAIM = 'issues.map((issue) => issue.code); // => ["DECIMAL_PRECISION_AT_RISK"]';

afterAll(() => {
  rmSync(FIRST_USE_TMP, { recursive: true, force: true });
});

describe("the first-use examples", () => {
  for (const example of FIRST_USE) {
    it(`${example.ac}: the first block of ${example.doc} is one the sweep executes, and it runs`, async () => {
      expect(example.fence?.lang).toBe("ts");
      expect(example.fence?.tags).toContain("runnable");
      expect(example.fence?.tags).not.toContain("throws");
      const executed = example.snippets.find((s) => s.code === example.fence?.body);
      expect(executed, `${example.doc}: the first block is not an executed one`).toBeDefined();
      if (executed === undefined) return;
      await runSnippet(executed, { resolve: resolveEntry, tmpDir: FIRST_USE_TMP });
    });

    it(`AC-FH5: every resource literal in the first block of ${example.doc} is a committed fixture`, () => {
      const literals = resourceLiterals(example.fence?.body ?? "");
      expect(literals.length, `${example.doc}: the first block reads no resource`).toBe(1);
      expect(fixturesByContent(root, FIXTURE_DIR).get(literals[0] ?? "")).toBeDefined();
    });

    it(`AC-FH4, AC-FH7: the claimed diagnostic in ${example.doc} is asserted, so a changed claim turns it red`, async () => {
      const code = example.fence?.body ?? "";
      expect(code.split(DIAGNOSTIC_CLAIM).length - 1).toBe(1);
      const mutated = code.replace(
        DIAGNOSTIC_CLAIM,
        DIAGNOSTIC_CLAIM.replace("DECIMAL_PRECISION_AT_RISK", "UNKNOWN_ELEMENT"),
      );
      await expect(
        runSnippet(mutated, { resolve: resolveEntry, tmpDir: FIRST_USE_TMP }),
      ).rejects.toThrow();
    });

    it(`AC-FH4: a changed input value in ${example.doc} turns the run red and leaves the corpus`, async () => {
      const code = example.fence?.body ?? "";
      expect(code.split('"value": 120.0,').length - 1).toBe(1);
      const mutated = code.replace('"value": 120.0,', '"value": 120,');
      expect(
        fixturesByContent(root, FIXTURE_DIR).get(resourceLiterals(mutated)[0] ?? ""),
      ).toBeUndefined();
      await expect(
        runSnippet(mutated, { resolve: resolveEntry, tmpDir: FIRST_USE_TMP }),
      ).rejects.toThrow();
    });
  }
});
