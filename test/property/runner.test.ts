/**
 * How a property here takes its depth and seed (`../_property-run.ts`): a property's own count and
 * seed, with `COSYTE_PROPERTY_RUNS`, `COSYTE_PROPERTY_SEED` and `COSYTE_PROPERTY_PATH` over both,
 * the values it refuses, and a budget that scales with the depth. The runner itself is the shared
 * one in `@cosyte/test-utils`, tested there.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { MS_PER_CASE, propertyRun, propertyTimeout } from "../_property-run.js";

describe("propertyRun", () => {
  it("runs a property's own count and seed, and the environment over both", () => {
    expect(propertyRun({ numRuns: 7, seed: 3 }, {})).toEqual({ numRuns: 7, seed: 3 });
    expect(propertyRun({}, {})).toEqual({ numRuns: 100 });
    expect(
      propertyRun(
        { numRuns: 7, seed: 3 },
        { COSYTE_PROPERTY_RUNS: "10000", COSYTE_PROPERTY_SEED: "-9" },
      ),
    ).toEqual({ numRuns: 10000, seed: -9 });
  });

  it("stops a replay at the case its path names", () => {
    expect(
      propertyRun({ numRuns: 7 }, { COSYTE_PROPERTY_SEED: "5", COSYTE_PROPERTY_PATH: "3:0:1" }),
    ).toEqual({ numRuns: 7, seed: 5, path: "3:0:1", endOnFailure: true });
  });

  it("refuses a malformed value rather than running the property's own count", () => {
    expect(() => propertyRun({ numRuns: 7 }, { COSYTE_PROPERTY_RUNS: "10k" })).toThrow(RangeError);
    expect(() => propertyRun({ numRuns: 7 }, { COSYTE_PROPERTY_PATH: "1:2" })).toThrow(
      /needs its seed/u,
    );
  });

  it("replays through fc.assert the case a failure printed, already shrunk", () => {
    const failing = fc.property(fc.nat(), (n) => n < 50);
    const first = fc.check(failing, propertyRun({ numRuns: 100, seed: 1 }, {}));
    expect(first.failed).toBe(true);
    const replay = fc.check(
      failing,
      propertyRun(
        {},
        {
          COSYTE_PROPERTY_SEED: String(first.seed),
          COSYTE_PROPERTY_PATH: first.counterexamplePath ?? "",
        },
      ),
    );
    expect(replay.failed).toBe(true);
    expect(replay.numRuns).toBe(1);
    expect(replay.counterexample).toEqual([50]);
  });
});

describe("propertyTimeout", () => {
  it("scales a test's budget with the depth", () => {
    expect(propertyTimeout({})).toBe(10_000);
    expect(propertyTimeout({ COSYTE_PROPERTY_RUNS: "10000" })).toBe(10_000 * MS_PER_CASE);
    expect(propertyTimeout({ COSYTE_PROPERTY_RUNS: "250" })).toBe(10_000);
  });
});
