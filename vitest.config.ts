import { cosyteVitest } from "@cosyte/vitest-config";

/**
 * Vitest config for @cosyte/fhir from the shared @cosyte/vitest-config standard.
 *
 * Phase 1 (the no-data-loss core: precision-preserving primitives + JSON codec) lands the first real
 * code, so the per-directory >= 90 coverage gates that every other `@cosyte/*` parser carries come
 * online here — restored from the P0 bootstrap's temporary 0 floor (which existed only because the
 * scaffold had no logic to cover). `model/` and `codec/` each carry their own >= 90 gate on top of
 * the global one. Barrels (`index.ts`) are excluded by the shared config, so re-export files do not
 * dilute the number.
 */
export default cosyteVitest({
  coverageDirs: ["model", "codec", "validate"],
  test: {
    globals: false,
    environment: "node",
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
});
