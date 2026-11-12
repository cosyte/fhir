// A StrykerJS ignorer plugin that keeps a pull request's mutation run to the lines it changed.
//
// WHY. CI's `mutation` job mutates the source files a pull request changed, and `cosyte-ratchet`
// then judges only the mutants that touch a changed line. Mutating a large file whole tests every
// other mutant in it too: a change to `src/codec/read.ts` and `src/safety/status.ts` came to 1,369
// mutants and hit the job's 60-minute limit with 663 tested, so the check said nothing.
//
// WHAT. With `MUTATE_CHANGED_LINES_BASE` set to the ref the ratchet judges against,
// `stryker.config.mjs` registers this plugin and names its ignorer. The ignorer reads the change
// with `readChanges` from `@cosyte/script-utils/changes`, the reading the ratchet uses, and ignores
// every node that touches no changed line. Stryker places no ignored mutant and runs no test for
// one; it lists each in the report as `Ignored` with the reason below.
//
// WHY AN IGNORER AND NOT A LINE RANGE. Stryker's `file:start-end` form keeps only the mutants that
// lie wholly inside a range, so a mutant that spans a changed line but starts or ends outside it
// (the body of the function the line is in, a condition over two lines) would not be made at all,
// and the ratchet, which judges every mutant whose lines touch a changed line, would never see it.
// The ignorer keeps exactly the mutants the ratchet judges: a node is kept when a changed line lies
// between its first and last line, the same test the ratchet applies to a mutant's location, and a
// node that touches no changed line has no descendant that does.
//
// FAIL CLOSED. A file Stryker instruments that the change does not name, or a node whose file the
// ignorer cannot tell, stops the run with an error rather than being read as unchanged: a run that
// ignored everything would pass with nothing tested.

import { resolve } from "node:path";

import { readChanges } from "@cosyte/script-utils/changes";

/** The variable naming the base ref; unset, `stryker.config.mjs` does not load this plugin. */
export const BASE_VARIABLE = "MUTATE_CHANGED_LINES_BASE";

/** The name `stryker.config.mjs` lists under `ignorers`. */
export const IGNORER_NAME = "changed-lines";

/**
 * Whether a node's lines touch a changed line: some changed line lies between its first and last
 * line, both 1-based and inclusive.
 *
 * @param {{ start: { line: number }, end: { line: number } }} loc The node's location.
 * @param {ReadonlySet<number>} lines The file's changed lines, 1-based.
 * @returns {boolean} True when a changed line is inside the node's lines.
 */
export function touchesChangedLine(loc, lines) {
  for (const line of lines) {
    if (line >= loc.start.line && line <= loc.end.line) return true;
  }
  return false;
}

/**
 * The changed lines of each file, keyed by absolute path, from what `readChanges` returns.
 *
 * @param {{ root: string, files: Map<string, Set<number>> }} change The change.
 * @returns {Map<string, Set<number>>} Absolute path to its changed lines.
 */
export function changedLinesByPath(change) {
  const out = new Map();
  for (const [file, lines] of change.files) out.set(resolve(change.root, file), lines);
  return out;
}

/**
 * An ignorer that ignores every node touching no changed line.
 *
 * @param {object} input The inputs.
 * @param {() => Map<string, Set<number>>} input.changes Returns absolute path to changed lines;
 *   called once, on the first node.
 * @param {string} input.base The base ref, for the messages.
 * @returns {{ shouldIgnore(path: any): string | undefined }} The ignorer.
 */
export function createChangedLinesIgnorer({ changes, base }) {
  /** @type {Map<string, Set<number>> | undefined} */
  let byPath;
  const reason = `Ignored because no line of it changed against ${base}`;
  return {
    shouldIgnore(path) {
      byPath ??= changes();
      const filename = path?.hub?.file?.opts?.filename;
      if (typeof filename !== "string" || filename === "") {
        throw new Error(
          `${IGNORER_NAME}: a node came with no file name, so its changed lines cannot be told`,
        );
      }
      const lines = byPath.get(resolve(filename));
      if (lines === undefined) {
        throw new Error(
          `${IGNORER_NAME}: ${filename} is mutated but did not change against ${base}; ` +
            `unset ${BASE_VARIABLE} for a run over whole files`,
        );
      }
      const loc = path.node?.loc;
      // A node with no location cannot be placed against a line; keeping it costs a test run,
      // ignoring it could hide a mutant the ratchet judges.
      if (loc === null || loc === undefined) return undefined;
      return touchesChangedLine(loc, lines) ? undefined : reason;
    },
  };
}

/**
 * The ignorer for the base in {@link BASE_VARIABLE}, reading the change on first use. Loading
 * this module reads nothing, so a Stryker worker process that loads the plugin does no git work.
 *
 * @param {Record<string, string | undefined>} [env] Where the base is read.
 * @param {typeof readChanges} [read] Reads the change; replaced in tests.
 * @returns {{ shouldIgnore(path: any): string | undefined }} The ignorer.
 */
export function ignorerFromEnvironment(env = process.env, read = readChanges) {
  const base = env[BASE_VARIABLE] ?? "";
  return createChangedLinesIgnorer({
    base,
    changes: () => {
      if (base === "") {
        throw new Error(`${IGNORER_NAME}: ${BASE_VARIABLE} is not set, so there is no change`);
      }
      return changedLinesByPath(read({ base, cwd: process.cwd() }));
    },
  });
}

/** The plugin, in the shape `declareValuePlugin(PluginKind.Ignore, ...)` makes. */
export const strykerPlugins = [
  { kind: "Ignore", name: IGNORER_NAME, value: ignorerFromEnvironment() },
];
