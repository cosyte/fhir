import { fileURLToPath } from "node:url";

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
const config = cosyteVitest({
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
    "src/arbitraries/**": FULL,
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
    "arbitraries",
  ],
  test: {
    globals: false,
    environment: "node",
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    testTimeout: 10_000,
    hookTimeout: 10_000,
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
