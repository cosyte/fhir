/**
 * Where the suite runs. CI runs it on Linux, Windows and macOS under Node, and on Linux under Bun
 * and under Deno. A test that cannot run in one of those places is skipped there by name, with
 * the reason beside the skip, through the checks below.
 */

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
