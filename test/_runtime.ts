/**
 * Where the suite runs. CI runs it on Linux, Windows and macOS under Node, and on Linux under Bun
 * and under Deno. A test that cannot run in one of those places is skipped there by name, with
 * the reason beside the skip, through the checks below.
 */

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** True on Windows. */
export const IS_WINDOWS = process.platform === "win32";

/**
 * True under Bun. Bun runs JavaScriptCore, whose own error messages (the text of a `TypeError` a
 * built-in raises) are worded differently from V8's, which Node and Deno run.
 */
export const IS_BUN = "Bun" in globalThis;

/**
 * True under Deno. The `deno` job takes Node off `PATH` and runs the suite with Deno alone, so a
 * test that starts Node, `tsx` or a Node-only command line cannot run there.
 */
export const IS_DENO = "Deno" in globalThis;

/**
 * True in the mutation run. StrykerJS runs `vitest.mutation.config.ts`, which sets
 * `COSYTE_SOURCE_INSTRUMENTED`, in a sandbox whose `src/` it has rewritten into its mutant switches,
 * so a test that reads `src/` as text there reads the rewrite, not the source: a census of where a
 * name appears finds it in new places (`a.x === b.x` becomes text holding `x :`). Such a test
 * cannot kill a mutant either, since every mutant shares the one rewritten text, so it is skipped
 * there. `test/mutation-suite.test.ts` holds every test file of that suite that reads `src/` from
 * disk to this flag.
 */
export const SOURCE_IS_INSTRUMENTED = process.env["COSYTE_SOURCE_INSTRUMENTED"] === "1";

const require = createRequire(import.meta.url);

/**
 * tsx's own command-line entry file. `node_modules/.bin/tsx` is a shell script on Linux and macOS
 * and a `.cmd` file on Windows, which Node cannot start without a shell; the entry file is
 * JavaScript, which this Node starts on every system.
 */
export const TSX_CLI = join(dirname(require.resolve("tsx/package.json")), "dist", "cli.mjs");

/**
 * The command and arguments that run `args` under tsx, to pass to `spawnSync` as they are, with
 * no shell. On Windows that is this Node, tsx's entry file, then `args`; elsewhere it is the
 * `node_modules/.bin/tsx` shim, as before, which Bun and Deno run through their own `node`.
 *
 * @example
 * const [command, argv] = tsx(["scripts/phi-scan.ts"]);
 * spawnSync(command, argv, { encoding: "utf8" });
 */
export function tsx(args: readonly string[]): [string, string[]] {
  if (IS_WINDOWS) return [process.execPath, [TSX_CLI, ...args]];
  return [
    join(fileURLToPath(new URL("..", import.meta.url)), "node_modules", ".bin", "tsx"),
    [...args],
  ];
}
