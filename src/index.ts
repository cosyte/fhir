/**
 * Public entry point for the `@cosyte/fhir` package.
 *
 * The full public API (resource model, JSON codec, validation, profiles, helpers) is populated in
 * subsequent phases — see `operations/roadmaps/fhir.md` in the meta-repo. P0 ships the scaffold and
 * the four architecture ADRs only; there is no parse code in this phase. This entry keeps the module
 * resolvable and typed so the tooling (tsup, vitest, tsc, attw) can verify the build/typecheck
 * pipeline end-to-end.
 */

export {};

/**
 * Library version string, synced with `package.json#version` at build time by
 * `scripts/sync-version.mjs` (wired into the Changesets `version` script). Exported now so
 * consumers — and the type-check pipeline — have at least one symbol to resolve through the
 * `exports` map.
 *
 * @example
 * ```ts
 * import { VERSION } from "@cosyte/fhir";
 * console.log(VERSION);
 * ```
 */
export const VERSION: string = "0.0.0";
