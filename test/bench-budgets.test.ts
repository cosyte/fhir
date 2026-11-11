import type { CaseReading, PeakReport, ReadingBody } from "@cosyte/bench";
import { describe, expect, it } from "vitest";

import { budgetsMarkdown } from "../bench/budgets.mjs";

const KIB = 1024;

/** A case with one input of `bytes` bytes and the peak given; every other figure is a stand-in. */
function caseOf(
  benchmark: string,
  size: string,
  bytes: number,
  peak: CaseReading["peak"],
  bytesPerSecond = 50 * KIB * KIB,
): CaseReading {
  return {
    benchmark,
    size,
    inputsPerPass: 64,
    bytesPerPass: bytes * 64,
    throughput: {
      status: "measured",
      processes: [{ samplesMsPerOp: [0.01], medianMsPerOp: 0.01 }],
      medianMsPerOp: 0.01,
      opsPerSecond: 100_000,
      bytesPerSecond,
    },
    latency: null,
    allocations: null,
    peak,
    longRun: null,
  };
}

/** A row of the Markdown whose first cell is `benchmark` and whose second is `size`. */
function rowOf(markdown: string, benchmark: string, size: string): string[] {
  const row = markdown.split("\n").find((line) => line.startsWith(`| ${benchmark} | ${size} |`));
  expect(row, `${benchmark} / ${size}`).toBeDefined();
  return (row as string)
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());
}

// A synthetic 1.3 KiB case shaped like the runner's: its highest call is mostly the probe (about 40
// KiB, 30 times the input), its median call 16 KiB above the empty-call floor.
const small = caseOf("parseResource: Observation", "vital signs, 1.3 KiB", 1331, {
  status: "measured",
  calls: 20,
  peakHeapBytes: 40 * KIB,
  medianPeakHeapBytes: 19 * KIB,
  peakTotalBytes: 40 * KIB,
  medianPeakTotalBytes: 19 * KIB,
  peakTotalAboveFloorBytes: 37 * KIB,
  medianPeakTotalAboveFloorBytes: 16 * KIB,
});

const floor: PeakReport = {
  status: "measured",
  calls: 20,
  peakHeapBytes: 28 * KIB,
  medianPeakHeapBytes: 3 * KIB,
  peakTotalBytes: 28 * KIB,
  medianPeakTotalBytes: 3 * KIB,
};

function reading(cases: CaseReading[], memoryFloor: PeakReport | null = floor): ReadingBody {
  return { processes: 3, cases, memoryFloor, importCost: null };
}

describe("bench/budgets.mjs", () => {
  it("judges an input under 64 KiB on its median call above the empty-call floor", () => {
    const row = rowOf(budgetsMarkdown(reading([small])), small.benchmark, small.size);
    // Input, highest raw peak, peak read, read as, multiple, budget, within.
    expect(row.slice(2)).toEqual([
      "1.3 KiB",
      "40.0 KiB",
      "16.0 KiB",
      "median above floor",
      "12.3x",
      "20x",
      "yes",
    ]);
  });

  it("prints the floor the small cases were read above", () => {
    expect(budgetsMarkdown(reading([small]))).toContain(
      "Empty-call floor: median call 3.0 KiB, highest 28.0 KiB.",
    );
  });

  it("judges an input of 64 KiB or more on its highest call, external memory included", () => {
    const large = caseOf("serializeResource: Binary, base64 PDF", "8 MiB PDF", 8 * KIB * KIB, {
      status: "measured",
      calls: 20,
      peakHeapBytes: 1 * KIB * KIB,
      medianPeakHeapBytes: 1 * KIB * KIB,
      peakTotalBytes: 30 * KIB * KIB,
      medianPeakTotalBytes: 9 * KIB * KIB,
      peakTotalAboveFloorBytes: 30 * KIB * KIB,
      medianPeakTotalAboveFloorBytes: 9 * KIB * KIB,
    });
    const row = rowOf(budgetsMarkdown(reading([large])), large.benchmark, large.size);
    expect(row.slice(3)).toEqual(["30.00 MiB", "30.00 MiB", "highest", "3.8x", "3x", "**no**"]);
  });

  it("reads a reading with no floor on its highest raw peak", () => {
    // A run that measured no floor gives no figure above it.
    const noFloor = caseOf(small.benchmark, small.size, 1331, {
      status: "measured",
      calls: 20,
      peakHeapBytes: 40 * KIB,
      medianPeakHeapBytes: 19 * KIB,
      peakTotalBytes: 40 * KIB,
      medianPeakTotalBytes: 19 * KIB,
    });
    const markdown = budgetsMarkdown(reading([noFloor], null));
    expect(markdown).toContain("Empty-call floor: not measured in this reading");
    const row = rowOf(markdown, small.benchmark, small.size);
    expect(row.slice(4)).toEqual(["40.0 KiB", "highest", "30.8x", "20x", "**no**"]);
  });

  it("says validation skips a base64 payload instead of printing a throughput ratio", () => {
    const peak = null;
    const markdown = budgetsMarkdown(
      reading([
        caseOf("validateResource: Binary, base64 PDF", "64 KiB PDF", 64 * KIB, peak, 2 * KIB * KIB),
        caseOf(
          "validateResource: Binary, base64 PDF",
          "8 MiB PDF",
          8 * KIB * KIB,
          peak,
          900 * KIB * KIB,
        ),
        caseOf("parseResource: Binary, base64 PDF", "64 KiB PDF", 64 * KIB, peak, 700 * KIB * KIB),
        caseOf(
          "parseResource: Binary, base64 PDF",
          "8 MiB PDF",
          8 * KIB * KIB,
          peak,
          650 * KIB * KIB,
        ),
      ]),
    );
    expect(rowOf(markdown, "validateResource: Binary, base64 PDF", "64 KiB PDF").slice(3)).toEqual([
      "payload skipped",
      "payload skipped",
      "n/a",
      "not judged: validation skips the base64 payload",
    ]);
    // A parse reads the payload, so its throughput is still judged.
    expect(rowOf(markdown, "parseResource: Binary, base64 PDF", "64 KiB PDF").slice(5)).toEqual([
      "93%",
      "yes",
    ]);
  });
});
