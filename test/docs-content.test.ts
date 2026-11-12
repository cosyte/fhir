import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, rmSync } from "node:fs";
import { join, relative } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  docSnippetSuite,
  extractRunnableSnippets,
  runSnippet,
} from "@cosyte/vitest-config/snippets";

import {
  compileEachErrors,
  compileErrors,
  fences,
  fixturesByContent,
  resourceLiterals,
  section,
} from "./_first-use.js";
import { IS_WINDOWS } from "./_runtime.js";

/**
 * Doc/code-agreement gate. Every TypeScript and JavaScript sample on a hand-written page of
 * `docs-content/`, and every ```` ```ts runnable ```` block in `README.md`, is extracted, compiled and
 * executed, and its inline `// =>` claims are asserted, so a documented example cannot drift from the
 * shipped code. A sample that cannot run says why in its fence (` ```js no-run <reason> `), and the
 * test below the suites refuses a sample on a page that does neither.
 *
 * The pages under `docs-content/api/` are generated from the TSDoc comments in `src/` by
 * `cosyte-docs-reference`, and their `@example` blocks are fragments written for an editor's tooltip
 * (many use a variable they never declare), so they are not part of this suite: only the top-level
 * pages are passed in.
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
const ARBITRARIES = join(root, "dist", "arbitraries.mjs");
const README = join(root, "README.md");
const DOCS_DIR = join(root, "docs-content");
const resolveEntry = (specifier: string): string | undefined =>
  specifier === "@cosyte/fhir"
    ? ENTRY
    : specifier === "@cosyte/fhir/arbitraries"
      ? ARBITRARIES
      : undefined;

beforeAll(() => {
  // On Windows `pnpm` is a `.cmd` file, which only a shell starts; the arguments are fixed.
  execFileSync("pnpm", ["build"], { cwd: root, stdio: "inherit", shell: IS_WINDOWS });
}, 180_000);

/** The hand-written pages: every `.md` file at the top of `docs-content/`, not the generated `api/`. */
const PAGES = readdirSync(DOCS_DIR)
  .filter((name) => name.endsWith(".md"))
  .sort()
  .map((name) => join(DOCS_DIR, name));

/**
 * `every` runs each TypeScript and JavaScript sample whether or not it is tagged `runnable`, and
 * lists a `no-run` sample as skipped with its reason. It reaches the runner as a variable rather
 * than a literal so the line compiles against a `@cosyte/vitest-config` that predates the option;
 * such a runner ignores it and runs the `runnable` blocks, which is every sample that can run here,
 * as the test below holds.
 */
const docsSuite = { files: PAGES, every: true, requireSnippet: true, resolve: resolveEntry };
docSnippetSuite(docsSuite);

docSnippetSuite({
  name: "doc/code agreement (README)",
  files: [README],
  requireSnippet: true,
  resolve: resolveEntry,
});

/** The fence languages that make a block a code sample. */
const SAMPLE_LANGS = new Set(["ts", "typescript", "tsx", "js", "javascript", "mjs"]);

describe("every sample on a hand-written page", () => {
  it("runs, or names in its fence why it cannot", () => {
    const unaccounted: string[] = [];
    for (const path of PAGES) {
      for (const fence of fences(readFileSync(path, "utf8"))) {
        if (!SAMPLE_LANGS.has(fence.lang)) continue;
        const noRun = fence.tags.indexOf("no-run");
        const reason = noRun === -1 ? "" : fence.tags.slice(noRun + 1).join(" ");
        if (fence.tags.includes("runnable") ? noRun !== -1 : reason === "") {
          unaccounted.push(`${relative(DOCS_DIR, path)}: ${fence.lang} ${fence.tags.join(" ")}`);
        }
      }
    }
    expect(unaccounted).toEqual([]);
  });
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
const QUICKSTART_TEXT = readFileSync(join(DOCS_DIR, "quickstart.md"), "utf8");
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
/**
 * The snippet harness strips types without checking them, so compiling is checked separately, the
 * way a reader's new TypeScript project compiles a block, against the source entry point the
 * bundler compiles into the published types. A program over the source takes seconds to check, so
 * these cases state their own budget.
 */
const SOURCE_PATHS = { "@cosyte/fhir": join(root, "src", "index.ts") };
const COMPILE_TIMEOUT = 60_000;

afterAll(() => {
  rmSync(FIRST_USE_TMP, { recursive: true, force: true });
});

describe("every runnable-tagged block on a hand-written page compiles", () => {
  it(
    "AC-FH1: each one compiles in a new TypeScript project against the package's types",
    () => {
      const blocks = PAGES.flatMap((file) =>
        extractRunnableSnippets(readFileSync(file, "utf8")).map((s) => ({
          file: relative(DOCS_DIR, file),
          code: s.code,
        })),
      );
      expect(blocks.length, "docs-content/ carries no runnable-tagged block").toBeGreaterThan(0);
      const errors = compileEachErrors(
        root,
        SOURCE_PATHS,
        blocks.map((block) => block.code),
      );
      expect(
        blocks.flatMap((block, index) =>
          (errors[index] ?? []).map((error) => `${block.file}: ${error}`),
        ),
      ).toEqual([]);
    },
    COMPILE_TIMEOUT,
  );
});

describe("the first-use examples", () => {
  for (const example of FIRST_USE) {
    it(
      `${example.ac}: the first block of ${example.doc} compiles in a new TypeScript project`,
      () => {
        expect(compileErrors(root, SOURCE_PATHS, example.fence?.body ?? "")).toEqual([]);
      },
      COMPILE_TIMEOUT,
    );

    it(
      `${example.ac}: a first block of ${example.doc} that does not compile is reported, so it turns this suite red`,
      () => {
        const code = example.fence?.body ?? "";
        expect(code.split(DIAGNOSTIC_CLAIM).length - 1).toBe(1);
        const broken = DIAGNOSTIC_CLAIM.replace("issue.code)", "issue.codes)");
        expect(compileErrors(root, SOURCE_PATHS, code.replace(DIAGNOSTIC_CLAIM, broken))).toEqual([
          expect.stringMatching(/TS2551|TS2339/),
        ]);
      },
      COMPILE_TIMEOUT,
    );

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
