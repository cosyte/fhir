import { configDefaults } from "vitest/config";

import config from "./vitest.config.js";

/**
 * The Vitest run StrykerJS uses for mutation testing (`stryker.config.mjs`): the suite of
 * `vitest.config.ts`, without the tests that cannot judge a mutant.
 *
 * - `test/scripts/`, the differential tests, the bench budget table, the release checks and the
 *   docs-set gate: these test this repository's own tooling in `scripts/`, `bench/` and
 *   `.github/workflows/` (the PHI scan, the differential harness and its oracle doubles, the
 *   release readiness report), not the library, so no mutant of `src/` is ever killed there.
 * - `test/docs-content.test.ts`: it builds the package and runs every docs sample against the
 *   built `dist/`. Code a build or a child process runs is not the instrumented source.
 * - `test/property/runner.test.ts`, `test/property-depth.test.ts` and
 *   `test/mutation-suite.test.ts`: they test the suite's own property helper and hold the test
 *   files to reading the shared depth and to the rule below, not the library.
 *
 * StrykerJS runs this suite against a `src/` it has rewritten into its mutant switches, so a test
 * that reads `src/` as text would read the rewrite: `COSYTE_SOURCE_INSTRUMENTED` tells the tests
 * that do (the censuses of where a name appears, the model's declared members, the fast-check
 * import rule) to stand aside through `SOURCE_IS_INSTRUMENTED` in `test/_runtime.ts`. The rest of
 * their files runs.
 *
 * The instrumented code runs several times slower than the plain build, so a test's budget here is
 * 60 s rather than 10 s. StrykerJS sets each mutant's own timeout from the time the test took in
 * its first run (`stryker.config.mjs`), so this budget does not slow the mutant runs.
 */
export default {
  ...config,
  test: {
    ...config.test,
    exclude: [
      ...configDefaults.exclude,
      ...(config.test?.exclude ?? []),
      "test/scripts/**",
      "test/differential-*.test.ts",
      "test/bench-budgets.test.ts",
      "test/release-caller-permissions.test.ts",
      "test/release-readiness.test.ts",
      "test/docs-set.test.ts",
      "test/docs-content.test.ts",
      "test/property/runner.test.ts",
      "test/property-depth.test.ts",
      "test/mutation-suite.test.ts",
    ],
    env: { ...config.test?.env, COSYTE_SOURCE_INSTRUMENTED: "1" },
    testTimeout: 60_000,
  },
};
