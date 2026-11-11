/**
 * The cold import gate: how long a fresh Node.js process takes to import the built package, held
 * to a budget.
 *
 *   pnpm build && pnpm check:cold-import
 *
 * Each run starts a new `node` process that times `await import()` of `dist/index.mjs` with
 * `performance.now()`, the same reading `pnpm bench:reading` reports as the cold import. Runs of
 * an empty module are interleaved with them, so a slow machine shows up as a slow empty import
 * rather than as a mystery. The gate fails when the median of the package's runs is over the
 * budget. CI runs it on a GitHub-hosted runner after the build; on a loaded developer machine the
 * reading is context, not a verdict.
 *
 *   pnpm check:cold-import --base <another build's index.mjs>
 *
 * also reads another build, the base of a pull request in CI, in turns with this one and the empty
 * module, and prints its median beside this build's, so the two are compared on one machine at one
 * time. The base's reading never fails the gate.
 *
 * Plain JavaScript run by plain `node`, so nothing but Node.js itself sits between the clock and
 * the import.
 */

import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The most a cold import of the package may take, in milliseconds: the median of the runs. */
export const BUDGET_MS = 10;

/** Fresh processes per module, as many as `@cosyte/bench` takes for its reading. */
export const RUNS = 20;

/**
 * The child program: `@cosyte/bench`'s own importer, which sits beside its entry point. Using it
 * rather than a copy keeps this gate's number the number `pnpm bench:reading` reports: what the
 * child loads before its clock starts moves an empty import by milliseconds.
 */
const CHILD = fileURLToPath(new URL("./import-entry.mjs", import.meta.resolve("@cosyte/bench")));

/** One cold import of `file` in a new process, in milliseconds. */
function oneImport(file, dir) {
  const env = { ...process.env };
  // A loader in NODE_OPTIONS (tsx, a coverage hook) would be timed with the import.
  delete env.NODE_OPTIONS;
  const out = path.join(dir, "reading.json");
  rmSync(out, { force: true });
  execFileSync(process.execPath, [CHILD, "time", file, out], { env, stdio: "inherit" });
  const { ms } = JSON.parse(readFileSync(out, "utf8"));
  if (typeof ms !== "number" || !Number.isFinite(ms)) {
    throw new Error(`cold import: no reading from ${file}`);
  }
  return ms;
}

/** The median of a non-empty list of numbers. */
export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Read `target` and an empty module `runs` times each, and `base` too when given, interleaved: each
 * round starts at a different one of them, so none of them always runs first.
 */
export function readColdImport(target, runs = RUNS, base = undefined) {
  const dir = mkdtempSync(path.join(tmpdir(), "fhir-cold-import-"));
  try {
    const empty = path.join(dir, "empty.mjs");
    writeFileSync(empty, "export {};\n");
    const files = base === undefined ? [target, empty] : [target, base, empty];
    const readings = new Map(files.map((file) => [file, []]));
    for (let i = 0; i < runs; i++) {
      const start = i % files.length;
      const order = [...files.slice(start), ...files.slice(0, start)];
      for (const file of order) readings.get(file).push(oneImport(file, dir));
    }
    return {
      medianMs: median(readings.get(target)),
      emptyMedianMs: median(readings.get(empty)),
      baseMedianMs: base === undefined ? undefined : median(readings.get(base)),
      runs,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The file after `--base`, or `undefined` when the flag is absent; throws on a bare flag. */
function baseArgument(argv) {
  const at = argv.indexOf("--base");
  if (at === -1) return undefined;
  const file = argv[at + 1];
  if (file === undefined || file === "") throw new Error("--base needs a file");
  return path.resolve(file);
}

/** Run the gate; returns the exit code. */
function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const target = path.join(root, "dist", "index.mjs");
  if (!existsSync(target)) {
    process.stderr.write("check:cold-import: dist/index.mjs is missing; run pnpm build first\n");
    return 2;
  }
  const base = baseArgument(process.argv.slice(2));
  if (base !== undefined && !existsSync(base)) {
    process.stderr.write("check:cold-import: the --base file is missing\n");
    return 2;
  }
  const { medianMs, emptyMedianMs, baseMedianMs, runs } = readColdImport(target, RUNS, base);
  const over = medianMs > BUDGET_MS;
  const lines = [
    `cold import of dist/index.mjs: median ${medianMs.toFixed(2)} ms over ${String(runs)} runs ` +
      `(an empty module: ${emptyMedianMs.toFixed(2)} ms); budget ${String(BUDGET_MS)} ms: ` +
      `${over ? "over" : "within"}`,
  ];
  if (baseMedianMs !== undefined) {
    lines.push(
      `cold import of the base build, in turns with it: median ${baseMedianMs.toFixed(2)} ms ` +
        `over ${String(runs)} runs (context, not gated)`,
    );
  }
  const text = lines.map((line) => `${line}\n`).join("");
  process.stdout.write(text);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary !== undefined && summary !== "") appendFileSync(summary, text);
  return over ? 1 : 0;
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = main();
}
