/**
 * The peak memory of one read of a small resource, held to the dense-shape budget the bench reading
 * judges (`bench/budgets.mjs`): under 20 times the input's bytes, above what an empty call costs.
 *
 * Measured the way the reading measures it: the heap settled by full collections until it stops
 * shrinking, one call, and the growth of the used heap read straight after, the median of many
 * calls on the 1.3 KiB vital-signs Observation of `bench/shapes.mjs`, less the median of an empty
 * call measured the same way. A read that small finishes with no collection on the way, so the
 * growth is what the call allocated. The read was at 25 times its input before it built its model
 * straight from the tokens of the text; it is well under 20 times now, so this fails on a change
 * that takes most of that back.
 *
 * Run by `pnpm test:perf`, never under coverage, which compiles a counter into every function and
 * allocates for it.
 */

import { getHeapStatistics, setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

import { parseResource } from "../../src/index.js";
import { observation } from "../../bench/shapes.mjs";

/** The dense-shape peak budget, as a multiple of the input's bytes. */
const BUDGET = 20;
/** Calls measured for each median. */
const CALLS = 41;
/** Calls run first, so the measured ones run the optimized code a long-running reader runs. */
const WARMUP = 5_000;
/** A settled heap shrinks by less than this in a full collection. */
const SETTLED_BYTES = 64 * 1024;

/** A full collection, exposed for this process alone. */
function collector(): () => void {
  setFlagsFromString("--expose-gc");
  return runInNewContext("gc") as () => void;
}

/** Collect until two collections in a row free less than {@link SETTLED_BYTES}, at most seven. */
function settle(gc: () => void): number {
  let before = getHeapStatistics().used_heap_size;
  let quiet = 0;
  for (let round = 0; round < 7; round++) {
    gc();
    const after = getHeapStatistics().used_heap_size;
    quiet = before - after < SETTLED_BYTES ? quiet + 1 : 0;
    before = after;
    if (quiet >= 2) break;
  }
  return before;
}

/** The median growth of the used heap over one call of `call`, each from a settled heap. */
function medianGrowth(gc: () => void, call: (i: number) => void): number {
  const growth: number[] = [];
  for (let i = 0; i < CALLS; i++) {
    const start = settle(gc);
    call(i);
    growth.push(getHeapStatistics().used_heap_size - start);
  }
  growth.sort((a, b) => a - b);
  return growth[Math.floor(growth.length / 2)] as number;
}

describe("the peak memory of a read of a small resource", () => {
  it("stays under 20 times the input above an empty call", () => {
    const gc = collector();
    const texts = Array.from({ length: 64 }, (_v, i) => observation(i));
    const bytes = Buffer.byteLength(texts[0] as string);
    let sink = 0;
    const read = (i: number): void => {
      sink += parseResource(texts[i % texts.length] as string).issues.length + 1;
    };
    for (let i = 0; i < WARMUP; i++) read(i);
    const floor = medianGrowth(gc, () => {
      sink += 1;
    });
    const peak = medianGrowth(gc, read) - floor;
    const multiple = peak / bytes;
    const reading = `parseResource, vital-signs Observation of ${String(bytes)} B: ${String(peak)} B above the floor, ${multiple.toFixed(1)}x`;
    process.stdout.write(`${reading}\n`);
    expect(sink).toBeGreaterThan(0);
    expect(multiple, reading).toBeLessThan(BUDGET);
  });
});
