import { cosyteVitest } from "@cosyte/vitest-config";

/** Every metric at 100. */
const FULL = { lines: 100, branches: 100, functions: 100, statements: 100 };

/**
 * Vitest config for @cosyte/fhir from the shared @cosyte/vitest-config standard.
 *
 * The shared config gates the whole package and each listed `src/` directory at >= 90. We hold
 * ourselves to more: each threshold below is the coverage this package has reached, rounded down to
 * a whole percent, and a threshold only ever rises. A line that truly cannot be reached carries an
 * inline `v8 ignore` comment naming its reason rather than lowering a number. Barrels (`index.ts`)
 * are excluded by the shared config, so re-export files do not dilute the number.
 */
export default cosyteVitest({
  coverageThresholds: {
    ...FULL,
    "src/model/**": FULL,
    "src/codec/**": FULL,
    "src/validate/**": FULL,
    "src/safety/**": FULL,
    "src/quantity/**": FULL,
    "src/terminology/**": FULL,
    "src/profiles/**": FULL,
    "src/fhirpath/**": FULL,
    "src/xml/**": FULL,
    "src/bundle/**": FULL,
  },
  coverageDirs: [
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
  ],
  test: {
    globals: false,
    environment: "node",
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
});
