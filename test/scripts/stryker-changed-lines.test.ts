/**
 * Tests for the `changed-lines` ignorer (`scripts/stryker-changed-lines.mjs`), which keeps CI's
 * mutation run on a pull request to the mutants the ratchet judges.
 *
 * The bar is agreement with the ratchet, asserted on Stryker's own instrumenter rather than argued:
 * over a whole file with no ignorer, the mutants whose lines touch a changed line (the ratchet's
 * test) are exactly the mutants left unignored when the ignorer runs. That includes a mutant that
 * spans a changed line but starts before it, which a Stryker line range would never make.
 *
 * And it fails closed: a file the change does not name, or a node with no file name, stops the run.
 */

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import {
  BASE_VARIABLE,
  IGNORER_NAME,
  changedLinesByPath,
  createChangedLinesIgnorer,
  ignorerFromEnvironment,
  strykerPlugins,
  touchesChangedLine,
} from "../../scripts/stryker-changed-lines.mjs";

/** A mutant as Stryker's instrumenter returns it: lines 0-based. */
interface ApiMutant {
  readonly mutatorName: string;
  readonly replacement: string;
  readonly location: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
  readonly status?: string;
  readonly statusReason?: string;
}

interface InstrumenterModule {
  Instrumenter: new (logger: unknown) => {
    instrument(
      files: { name: string; content: string; mutate: true }[],
      options: Record<string, unknown>,
    ): Promise<{ mutants: ApiMutant[] }>;
  };
}

/** Stryker's instrumenter, resolved from the core package that depends on it. */
async function loadInstrumenter(): Promise<InstrumenterModule> {
  const fromRoot = createRequire(import.meta.url);
  const fromCore = createRequire(fromRoot.resolve("@stryker-mutator/core"));
  const entry = fromCore.resolve("@stryker-mutator/instrumenter");
  return (await import(pathToFileURL(entry).href)) as InstrumenterModule;
}

const quiet = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  trace: () => undefined,
  isDebugEnabled: () => false,
  isTraceEnabled: () => false,
};

/** A small synthetic source: a function whose body spans many lines, two branches, a condition. */
const SOURCE = [
  "export function grade(score: number, strict: boolean): string {", // 1
  "  if (score > 90 &&", // 2
  "      strict) {", // 3
  '    return "high";', // 4
  "  }", // 5
  "  const half = score / 2;", // 6
  "  if (half >= 10) {", // 7
  '    return "mid";', // 8
  "  }", // 9
  '  return "low";', // 10
  "}", // 11
  "", // 12
].join("\n");

// Absolute on every platform: on Windows `resolve` adds the drive, as Stryker's file names have.
const FILE = resolve("/synthetic", "src", "grade.ts");

async function instrument(ignorers: unknown[]): Promise<ApiMutant[]> {
  const { Instrumenter } = await loadInstrumenter();
  const result = await new Instrumenter(quiet).instrument(
    [{ name: FILE, content: SOURCE, mutate: true }],
    { ignorers, excludedMutations: [], plugins: null, noHeader: true },
  );
  return result.mutants;
}

/** The ratchet's test of a mutant, on 1-based lines. */
function ratchetJudges(mutant: ApiMutant, changed: ReadonlySet<number>): boolean {
  const first = mutant.location.start.line + 1;
  const last = mutant.location.end.line + 1;
  return [...changed].some((n) => n >= first && n <= last);
}

const key = (m: ApiMutant): string =>
  `${m.mutatorName} ${m.location.start.line}:${m.location.start.column}-${m.location.end.line}:${m.location.end.column} ${m.replacement}`;

describe("touchesChangedLine", () => {
  const span = { start: { line: 3 }, end: { line: 5 } };
  it("is true when a changed line is the first, a middle or the last line", () => {
    expect(touchesChangedLine(span, new Set([3]))).toBe(true);
    expect(touchesChangedLine(span, new Set([4]))).toBe(true);
    expect(touchesChangedLine(span, new Set([5]))).toBe(true);
  });
  it("is false when every changed line is outside, or none changed", () => {
    expect(touchesChangedLine(span, new Set([2, 6]))).toBe(false);
    expect(touchesChangedLine(span, new Set())).toBe(false);
  });
});

describe("changedLinesByPath", () => {
  it("keys each file by its absolute path under the root", () => {
    const lines = new Set([2]);
    const out = changedLinesByPath({
      root: "/synthetic",
      files: new Map([["src/grade.ts", lines]]),
    });
    expect([...out.keys()]).toEqual([FILE]);
    expect(out.get(FILE)).toBe(lines);
  });
});

describe("the changed-lines ignorer on Stryker's instrumenter", () => {
  for (const changed of [[3], [6], [2, 10], [12], []]) {
    it(`keeps exactly the mutants the ratchet judges when lines ${JSON.stringify(changed)} changed`, async () => {
      const lines = new Set(changed);
      const whole = await instrument([]);
      expect(whole.length).toBeGreaterThan(5);
      expect(whole.every((m) => m.status === undefined)).toBe(true);

      const ignorer = createChangedLinesIgnorer({
        base: "origin/main",
        changes: () => new Map([[FILE, lines]]),
      });
      const kept = await instrument([ignorer]);

      // The same mutants are made either way; only their status differs.
      expect(kept.map(key).sort()).toEqual(whole.map(key).sort());
      const judged = whole
        .filter((m) => ratchetJudges(m, lines))
        .map(key)
        .sort();
      const unignored = kept
        .filter((m) => m.status !== "Ignored")
        .map(key)
        .sort();
      expect(unignored).toEqual(judged);
      for (const m of kept.filter((x) => x.status === "Ignored")) {
        expect(m.statusReason).toBe("Ignored because no line of it changed against origin/main");
      }
    });
  }

  it("keeps a mutant that spans a changed line but starts before it", async () => {
    const lines = new Set([3]);
    const ignorer = createChangedLinesIgnorer({
      base: "origin/main",
      changes: () => new Map([[FILE, lines]]),
    });
    const kept = (await instrument([ignorer])).filter((m) => m.status !== "Ignored");
    // The function body (lines 1 to 11) and the condition over lines 2 and 3.
    expect(
      kept.some((m) => m.mutatorName === "BlockStatement" && m.location.start.line === 0),
    ).toBe(true);
    expect(
      kept.some((m) => m.mutatorName === "LogicalOperator" && m.location.start.line === 1),
    ).toBe(true);
  });

  it("stops the run on a file the change does not name", async () => {
    const ignorer = createChangedLinesIgnorer({
      base: "origin/main",
      changes: () => new Map([[resolve("/synthetic", "src", "other.ts"), new Set([1])]]),
    });
    await expect(instrument([ignorer])).rejects.toThrow(/did not change against origin\/main/);
  });
});

describe("createChangedLinesIgnorer", () => {
  it("stops on a node with no file name", () => {
    const ignorer = createChangedLinesIgnorer({ base: "b", changes: () => new Map() });
    expect(() =>
      ignorer.shouldIgnore({ node: { loc: { start: { line: 1 }, end: { line: 1 } } } }),
    ).toThrow(/no file name/);
  });

  it("keeps a node with no location", () => {
    const ignorer = createChangedLinesIgnorer({
      base: "b",
      changes: () => new Map([[FILE, new Set<number>()]]),
    });
    expect(
      ignorer.shouldIgnore({ hub: { file: { opts: { filename: FILE } } }, node: {} }),
    ).toBeUndefined();
  });

  it("reads the change once", () => {
    let reads = 0;
    const ignorer = createChangedLinesIgnorer({
      base: "b",
      changes: () => {
        reads += 1;
        return new Map([[FILE, new Set([1])]]);
      },
    });
    const node = {
      hub: { file: { opts: { filename: FILE } } },
      node: { loc: { start: { line: 2 }, end: { line: 2 } } },
    };
    expect(ignorer.shouldIgnore(node)).toMatch(/^Ignored because/);
    expect(ignorer.shouldIgnore(node)).toMatch(/^Ignored because/);
    expect(reads).toBe(1);
  });
});

describe("ignorerFromEnvironment", () => {
  const node = {
    hub: { file: { opts: { filename: FILE } } },
    node: { loc: { start: { line: 4 }, end: { line: 4 } } },
  };

  it("reads the change against the base in the variable", () => {
    const bases: string[] = [];
    const ignorer = ignorerFromEnvironment({ [BASE_VARIABLE]: "origin/main" }, (opts) => {
      bases.push(opts.base);
      return {
        root: "/synthetic",
        base: opts.base,
        mergeBase: "0".repeat(40),
        files: new Map([["src/grade.ts", new Set([4])]]),
      };
    });
    expect(ignorer.shouldIgnore(node)).toBeUndefined();
    expect(bases).toEqual(["origin/main"]);
  });

  it("stops when the variable is unset", () => {
    const ignorer = ignorerFromEnvironment({}, () => {
      throw new Error("not reached");
    });
    expect(() => ignorer.shouldIgnore(node)).toThrow(/MUTATE_CHANGED_LINES_BASE is not set/);
  });
});

describe("the plugin and its wiring", () => {
  it("declares one Ignore plugin under the name the config lists", () => {
    expect(strykerPlugins.map((p) => [p.kind, p.name])).toEqual([["Ignore", IGNORER_NAME]]);
    expect(typeof strykerPlugins[0]?.value.shouldIgnore).toBe("function");
  });

  it("is registered by stryker.config.mjs only when the base is set", () => {
    const text = readFileSync(new URL("../../stryker.config.mjs", import.meta.url), "utf8");
    expect(text).toContain("process.env.MUTATE_CHANGED_LINES_BASE");
    expect(text).toContain('"scripts/stryker-changed-lines.mjs"');
    expect(text).toContain(`config.ignorers = ["${IGNORER_NAME}"]`);
  });

  it("is switched on by CI's mutation job, which fails a run that hits its limit", () => {
    const text = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
    // The shared job mutates whole files; this repository's own job replaces it.
    expect(text).toMatch(/^\s+run-mutation: false$/m);
    expect(text).toMatch(/^ {2}mutation:$/m);
    expect(text).toContain("MUTATE_CHANGED_LINES_BASE: ${{ env.MUTATION_BASE }}");
    expect(text).toContain("did not finish inside its");
  });
});
