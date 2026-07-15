import { cosyteVitest } from "@cosyte/vitest-config";

/**
 * Vitest config for @cosyte/fhir from the shared @cosyte/vitest-config standard.
 *
 * P0 (repo bootstrap) ships the scaffold only — the source tree (`model/`, `codec/`, `validate/`,
 * `profiles/`, `helpers/`) is placeholder barrels with no logic yet, so there is nothing to cover.
 * The per-directory >= 90 coverage gates that every other `@cosyte/*` parser carries are therefore
 * held at 0 for this phase and come online in Phase 1 when the first real code lands (model + JSON
 * codec). This relaxation is deliberate and scoped: raising the floor back to 90 is a Phase-1 task,
 * not a silent drift. The `test` script (`vitest run`) is the P0 gate and must stay green.
 */
export default cosyteVitest({
  coverageThresholds: {
    lines: 0,
    branches: 0,
    functions: 0,
    statements: 0,
  },
  test: {
    globals: false,
    environment: "node",
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
});
