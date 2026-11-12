/**
 * How a property in this suite takes its depth and its seed: from the shared property runner in
 * `@cosyte/test-utils`, so every property, whether it runs through `assertProperty` or through
 * `fc.assert`, reads the same `COSYTE_PROPERTY_RUNS`, `COSYTE_PROPERTY_SEED` and
 * `COSYTE_PROPERTY_PATH`.
 *
 * - **Depth.** A property states its own count for a pull request, through {@link propertyRun};
 *   `COSYTE_PROPERTY_RUNS` wins over it, which is how the nightly run takes every property to
 *   10,000 cases.
 * - **Seed.** A property states its own seed or none; `COSYTE_PROPERTY_SEED` wins, so the nightly
 *   run draws other cases than a pull request's fixed seed, and the seed it printed replays the
 *   night. `COSYTE_PROPERTY_PATH` beside it replays one failing case, already shrunk.
 * - A value that is set but malformed throws, so a job that typed its depth wrong cannot quietly
 *   run the default.
 */

import { resolvePropertyRun, type PropertyRunOptions } from "@cosyte/test-utils";

/** The fast-check parameters {@link propertyRun} returns. */
export interface PropertyParameters {
  readonly numRuns: number;
  readonly seed?: number;
  readonly path?: string;
  readonly endOnFailure?: boolean;
}

/**
 * A property's own count and seed, with the environment over both, as `fc.assert` parameters. A
 * replay (`COSYTE_PROPERTY_PATH`) stops at the case its path names, which is already shrunk.
 *
 * @throws {RangeError} When a variable is malformed, or a path is given without its seed.
 */
export function propertyRun(
  own: PropertyRunOptions,
  env: Readonly<Record<string, string | undefined>> = process.env,
): PropertyParameters {
  const run = resolvePropertyRun(own, env);
  return run.path === undefined ? run : { ...run, endOnFailure: true };
}

/**
 * The budget a case gets in a deep run. A FHIR case is heavier than an HL7 one: a Bundle case
 * generates, writes and reads several resources, and the lenient case reads, validates and writes
 * a JSON and an XML document. At 10,000 cases those took 15 to 16 ms a case on a loaded machine,
 * so 10 ms (hl7's figure) cut them off; 40 leaves room.
 */
export const MS_PER_CASE = 40;

/**
 * A test's time budget for a property at the resolved depth: the suite's 10 s floor, or
 * {@link MS_PER_CASE} a case, whichever is longer, so a deep run (`COSYTE_PROPERTY_RUNS=10000`) is
 * not cut off by the budget a 100-case run needs.
 */
export function propertyTimeout(
  env: Readonly<Record<string, string | undefined>> = process.env,
): number {
  return Math.max(10_000, resolvePropertyRun({}, env).numRuns * MS_PER_CASE);
}
