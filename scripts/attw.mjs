#!/usr/bin/env node
/**
 * scripts/attw.mjs. The `attw` publish gate, wrapped so that it can report its own failure.
 *
 * WHY THIS WRAPPER EXISTS. `attw` prints "This package does not contain types." and then exits
 * 0. That is not a bug in `attw`: an untyped package is a perfectly legal npm package, so the
 * CLI treats "no types at all" as a description of the tarball rather than as a problem with
 * it. From `@arethetypeswrong/cli@0.18.4`, `node_modules/@arethetypeswrong/cli/dist/getExitCode.js`,
 * first statement:
 *
 *     export function getExitCode(analysis, opts) {
 *         var _a, _b;
 *         if (!analysis.types) {
 *             return 0;
 *         }
 *
 * `analysis.problems` is consulted only after that early return, so no `--profile`,
 * `--ignore-rules` or config setting can reach it. For a package that ships declarations,
 * "does not contain types" does not mean "fine, untyped". It means THE DECLARATIONS WERE NOT IN
 * THE TARBALL, which is a broken publish. The gate said so in prose and then handed its caller a
 * 0, and a caller reads the status.
 *
 * REPRODUCED ON THIS PACKAGE, WITH NO CONCURRENCY, ON A QUIET BOX. Both states, against
 * `@cosyte/fhir` at `edb75df`:
 *
 *     rm -rf dist && pnpm attw                      -> "does not contain types", exit 0
 *     rm -f dist/index.d.ts dist/index.d.cts        -> "does not contain types", exit 0
 *       && pnpm attw
 *
 * The second is the state a real build passes through. `tsup` emits the JS bundles in one pass
 * and the declarations in a later one, so every build of this package has an interval in which
 * `dist/` holds `index.mjs` and `index.cjs` and no `.d.ts`. Measured over four clean builds here
 * (mtime of `dist/index.d.ts` minus mtime of `dist/index.mjs`): 1.86 s, 2.03 s, 2.29 s, 2.46 s.
 * Anything that lands `attw` inside that interval, a second build or a `pnpm clean` in the same
 * working tree, produces the exit 0 above.
 *
 * SO THE ANSWER IS NOT A LOCK, A LEASE, OR A BUILD QUEUE. Concurrency only supplies the
 * condition. The defect is that the gate cannot tell you its own inputs were missing, and it
 * should be able to say that whatever removed them.
 *
 * TWO NETS. They catch different things, so keep both:
 *
 *   1. PREFLIGHT, structural, no string matching. Every relative artifact path `package.json`
 *      promises (`main`, `module`, `types`, `typings`, and every string leaf of `exports`) must
 *      exist and be non-empty before `attw` runs. This is the net that catches the build window
 *      above, and it names the missing file rather than leaving the reader to infer it.
 *
 *   2. POST-CHECK. If `attw` still reports an untyped package, fail. The preflight cannot see
 *      this case: the declarations can be present on disk and still be absent from the tarball,
 *      because `files` or `.npmignore` left them out. No instance of that has been observed in
 *      this repo. It is precisely the case `attw --pack` exists to catch, and the point here is
 *      that it catches it silently.
 *
 * The post-check matches `attw`'s untyped sentence, which `dist/render/untyped.js` returns as a
 * plain unstyled string. That makes the net blindable, so the arguments and config that blind it
 * are REFUSED rather than tolerated. See BLINDING below. `test/scripts/attw-gate.test.ts` pins
 * both nets against the real binary, so an `attw` upgrade that fixes the exit code or rewords the
 * sentence reds the suite and sends someone back to this file, instead of letting the net go
 * quietly slack.
 *
 * BLINDING. Four routes were measured on this package, each restoring the exact false green by
 * making the untyped sentence absent from what this script can read. All four were run against a
 * `dist/` with its two `.d.ts` files deleted, and all four exited 0:
 *
 *     attw --pack . --quiet                            prints nothing at all
 *     attw --pack . --format json                      the JSON render omits the sentence
 *     ./.attw.json = {"quiet": true}                    readConfig() applies it after argv
 *     attw --pack . --config-path <elsewhere>.json     same config, out of this script's view
 *
 * All four are refused below. Bare `attw` exits 0 in every one of those cases too, so refusing
 * them is not a regression against the old bare invocation. It is the difference between a gate
 * and a gate-shaped thing.
 *
 * THE REFUSAL IS BY OPTION NAME, WHOLESALE, NOT BY VALUE. `--format table-flipped` still prints
 * the sentence and blinds nothing, and is refused anyway. That is a deliberate trade: parsing the
 * values would add a third moving part to the guard, and being over-strict about an argument
 * nobody passes to a repo's own publish gate costs less than leaving a route back to a false
 * green.
 *
 * Every other argument is forwarded, so `--profile node16`, `--ignore-rules`, and
 * `--no-definitely-typed` still work.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ATTW_BIN = fileURLToPath(new URL("../node_modules/.bin/attw", import.meta.url));
const UNTYPED = "This package does not contain types.";
const DECLARATION = /\.d\.[cm]?ts$/;
const args = process.argv.slice(2);

const die = (msg) => {
  process.stderr.write(`\n✗ attw gate: ${msg}\n`);
  process.exit(1);
};

// ---- Refuse what would blind the post-check --------------------------------
const BLINDING = new Set(["-q", "--quiet", "-f", "--format", "--config-path"]);
const blinding = args.filter((a) => BLINDING.has(a.split("=")[0]));
if (blinding.length > 0) {
  die(
    `${blinding.join(", ")} is refused wholesale, by option name and not by value.\n` +
      `  This gate reads attw's printed output, attw exits 0 on an untyped package,\n` +
      `  and some values of these options hide that output. Run it without them.`,
  );
}
try {
  const config = JSON.parse(readFileSync(".attw.json", "utf8"));
  const set = ["quiet", "format"].filter((k) => k in config);
  if (set.length > 0) {
    die(
      `.attw.json sets ${set.join(", ")}. These keys are refused wholesale, by name and\n` +
        `  not by value: readConfig() applies them after argv, this gate reads attw's\n` +
        `  printed output, and attw exits 0 on an untyped package.`,
    );
  }
} catch {
  // No .attw.json, or unreadable/invalid. attw itself reports the latter.
}

/** Every relative path `package.json` promises to ship, deduped. */
function declaredArtifacts(pkg) {
  const found = new Set();
  const add = (v) => {
    if (typeof v !== "string") return;
    // Skip wildcard subpath patterns (they name a set, not a file) and the manifest itself,
    // which is in the tarball by definition.
    if (!v.startsWith(".") || v.includes("*") || v === "./package.json") return;
    found.add(v);
  };
  for (const key of ["main", "module", "types", "typings"]) add(pkg[key]);
  const walk = (node) => {
    if (typeof node === "string") add(node);
    else if (node && typeof node === "object") for (const v of Object.values(node)) walk(v);
  };
  walk(pkg.exports);
  return [...found];
}

let pkg;
try {
  pkg = JSON.parse(readFileSync("package.json", "utf8"));
} catch (err) {
  die(`cannot read ./package.json from ${process.cwd()}: ${err.message}`);
}

// ---- Net 1: preflight -------------------------------------------------------
const broken = [];
for (const rel of declaredArtifacts(pkg)) {
  let size;
  try {
    size = statSync(rel).size;
  } catch {
    broken.push({ rel, why: "missing" });
    continue;
  }
  if (size === 0) broken.push({ rel, why: "empty" });
}
if (broken.length > 0) {
  // Only claim the exit-0 counterfactual when a DECLARATION file is among the casualties. With
  // the declarations intact and only JS missing, attw reports no problems at all and still exits
  // 0, which is a different silence from this one.
  const declarationsHit = broken.some(({ rel }) => DECLARATION.test(rel));
  die(
    `package.json promises files the build has not produced:\n` +
      broken.map(({ rel, why }) => `    ${rel} (${why})\n`).join("") +
      `\n  Run the build first. If you DID build, something removed or truncated the\n` +
      `  output underneath this run. A concurrent build or \`clean\` in the same working\n` +
      `  tree will do it, and \`tsup\` writes the JS bundles about two seconds before the\n` +
      `  declarations, so there is a window in every build where the .d.ts files do not\n` +
      `  exist yet.\n` +
      (declarationsHit
        ? `  attw would have reported "${UNTYPED}" and EXITED 0 on this tree.\n`
        : `  attw does not gate these: it analyses types, and exits 0 here.\n`),
  );
}

// ---- Run attw ---------------------------------------------------------------
const res = spawnSync(ATTW_BIN, ["--pack", ".", ...args], {
  encoding: "utf8",
  stdio: ["inherit", "pipe", "pipe"],
});
if (res.error) die(`could not run ${ATTW_BIN}: ${res.error.message}`);
const output = `${res.stdout ?? ""}${res.stderr ?? ""}`;
process.stdout.write(res.stdout ?? "");
process.stderr.write(res.stderr ?? "");
if (res.status !== 0) process.exit(res.status ?? 1);

// ---- Net 2: post-check ------------------------------------------------------
// An empty transcript means the post-check read nothing, by some route not listed under BLINDING
// above. Treat that as a failure rather than as a pass: this gate is only as good as the output
// it got to see.
if (output.trim() === "") {
  die(`attw exited 0 but printed nothing, so nothing was checked.`);
}
if (output.includes(UNTYPED)) {
  die(
    `attw reported "${UNTYPED}" and exited 0.\n` +
      `  This package ships declarations, so that means the tarball did not carry them.\n` +
      `  Check the "files" field and .npmignore. Reported as a failure here because attw's\n` +
      `  own exit code cannot: getExitCode() returns 0 whenever the analysis found no types\n` +
      `  at all, before it ever looks at the problem list.`,
  );
}
