import { fileURLToPath } from "node:url";

import { cosyteStryker } from "@cosyte/vitest-config/stryker";

// Mutation testing for @cosyte/fhir, on the shared StrykerJS config: per-test coverage, static
// mutants ignored, the JSON report at reports/mutation/mutation.json, and no score threshold of its
// own (quality-floor.json decides).
//
//   pnpm mutate:full                           every source file; its score is the floor's
//   pnpm mutate changed --base origin/main     only the source files a change touched
//   pnpm quality:mutation [--base origin/main] the score against quality-floor.json
//
// The files mutated are the shared default: every `.ts` file under `src/` but tests, declarations
// and barrels. The shared config reads each file to tell a barrel (nothing but re-exports) from
// code, so `src/index.ts` and the `index.ts` of each folder that only re-exports are left out, and
// an `index.ts` that holds code of its own is mutated. A new file needs no entry here.
//
// On a pull request CI sets MUTATE_CHANGED_LINES_BASE to the ref the ratchet judges against, and
// the run then tests only the mutants that touch a changed line, the ones the ratchet judges: the
// `changed-lines` ignorer in scripts/stryker-changed-lines.mjs ignores every other mutant of the
// changed files, which Stryker then neither places nor runs. Unset, as in the weekly full run and
// `pnpm mutate:full`, nothing below changes.
const config = cosyteStryker({
  // The suite without the tests that cannot judge a mutant (see that file).
  vitestConfig: "vitest.mutation.config.ts",
  stryker: {
    // StrykerJS writes `// @ts-nocheck` into every source file of its sandbox by default. Vitest
    // never type-checks, so the comment changes nothing a test runs, only the bytes a test that
    // reads the source would see.
    disableTypeChecks: false,
    // A mutant times out when a test takes longer than timeoutFactor times its first, unmutated
    // run plus timeoutMS. At StrykerJS's defaults (1.5 and 5,000 ms) a mutant near that line can be
    // a timeout on one run and a survivor on the next, which moves a full score the ratchet
    // compares exactly. A wider margin lets a slow mutant that still finishes finish every time,
    // so only a mutant that never ends times out. Our other libraries measured this margin.
    timeoutFactor: 3,
    timeoutMS: 10_000,
  },
});

const changedLinesBase = process.env.MUTATE_CHANGED_LINES_BASE;
if (changedLinesBase !== undefined && changedLinesBase !== "") {
  config.plugins = [
    ...config.plugins,
    fileURLToPath(new URL("scripts/stryker-changed-lines.mjs", import.meta.url)),
  ];
  config.ignorers = ["changed-lines"];
}

export default config;
