import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { DEFAULT_NUM_RUNS, resolvePropertyRun } from "@cosyte/test-utils";
import { cosyteVitest } from "@cosyte/vitest-config";

/** The coverage metrics `quality-floor.json` holds, each a percentage. */
interface CoverageFloor {
  readonly lines: number;
  readonly branches: number;
  readonly functions: number;
  readonly statements: number;
}

/**
 * The coverage floor, read from `quality-floor.json`, the one place it is written. `cosyte-ratchet`
 * holds the same file in CI, where a floor only rises: a pull request that lowers or removes one
 * fails. A line that truly cannot be reached carries an inline `v8 ignore` comment naming its
 * reason rather than lowering a number.
 */
const FLOOR: CoverageFloor = (
  JSON.parse(readFileSync(new URL("quality-floor.json", import.meta.url), "utf8")) as {
    packages: { ".": { coverage: CoverageFloor } };
  }
).packages["."].coverage;

/**
 * The `src/` directories held to the floor each on its own, beside the whole package, so a
 * well-covered directory cannot carry a poorly covered one. Barrels (`index.ts`) are excluded by
 * the shared config, so re-export files do not dilute the number.
 */
const COVERAGE_DIRS = [
  "model",
  "codec",
  "validate",
  "safety",
  "quantity",
  "terminology",
  "profiles",
  "fhirpath",
  "xml",
  "bundle",
  "arbitraries",
];

/**
 * How many times deeper than a pull request this run takes every property: 1 by default, 100 when
 * the nightly job sets `COSYTE_PROPERTY_RUNS` to 10,000. A value that is not a whole number of
 * cases throws here, before any test runs.
 */
const propertyDepth = Math.max(1, resolvePropertyRun({}).numRuns / DEFAULT_NUM_RUNS);

/**
 * Tests skipped by name on Windows, each with its reason. Every other skip sits beside its test
 * (`test/_runtime.ts`); this one cannot, because its file is the PHI scan's own test, which spells
 * out the values the scan must catch, and a change to it is refused by the PHI check that runs
 * before a push.
 *
 * - `test/scripts/phi-scan.test.ts`, the case that runs the scan under tsx: it starts
 *   `node_modules/.bin/tsx`, a shell script, which Windows starts only through a shell. Every other
 *   case in the file runs the scan under Node, on Windows too.
 */
const WINDOWS_SKIPS: readonly string[] = [
  "the `tsx` entry point `pnpm phi-scan` uses agrees byte-for-byte with the `node` runner",
];

/** A name pattern that runs every test but those named, or undefined when none is named. */
function skipByName(names: readonly string[]): RegExp | undefined {
  if (names.length === 0) return undefined;
  const escaped = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"));
  return new RegExp(`^(?!.*(?:${escaped.join("|")})).*$`, "u");
}

const testNamePattern = process.platform === "win32" ? skipByName(WINDOWS_SKIPS) : undefined;

/** Vitest config for @cosyte/fhir from the shared @cosyte/vitest-config standard. */
const config = cosyteVitest({
  coverageThresholds: {
    ...FLOOR,
    ...Object.fromEntries(COVERAGE_DIRS.map((dir) => [`src/${dir}/**`, { ...FLOOR }])),
  },
  coverageDirs: COVERAGE_DIRS,
  test: {
    globals: false,
    environment: "node",
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    // A deeper property run scales the budget with its depth, so the nightly run is not cut off by
    // a budget set for a pull request's cases.
    testTimeout: 10_000 * propertyDepth,
    hookTimeout: 10_000,
    ...(testNamePattern === undefined ? {} : { testNamePattern }),
  },
});

const srcEntry = fileURLToPath(new URL("src/index.ts", import.meta.url));
const distDir = fileURLToPath(new URL("dist/", import.meta.url));

/**
 * `src/arbitraries/` imports the library by its package name, as the published subpath must (see
 * `tsup.config.ts`). Under test that name resolves to the source entry point, the mapping `paths`
 * gives the type checker, so the tests and coverage run against `src/`. Imported from the built
 * subpath (`dist/arbitraries.mjs`, which the docs samples load), it resolves to the built entry
 * point beside it, as it does for a consumer, so a sample never mixes built and source classes.
 */
const ownPackageName = {
  name: "cosyte-fhir-own-package-name",
  enforce: "pre" as const,
  resolveId(source: string, importer: string | undefined): string | null {
    if (source !== "@cosyte/fhir") return null;
    return importer?.startsWith(distDir) === true ? `${distDir}index.mjs` : srcEntry;
  },
};

export default { ...config, plugins: [ownPackageName] };
