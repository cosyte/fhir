// The performance budgets, read from a reading that `pnpm bench:reading --out <file>` wrote:
//   node bench/budgets.mjs bench-results/reading.json [--summary <file.md>]
//
// Four budgets, each a proposal until a package's numbers show it can be held:
// - peak memory under 20 times the input for a dense shape (a resource or a Bundle of many elements);
// - peak memory under 3 times the input for a large opaque payload (the base64 PDF report and Binary);
// - a cold import under 10 ms, the budget `pnpm check:cold-import` holds in CI;
// - throughput, in bytes a second, not falling by more than half from a shape's smallest size to its
//   largest.
// The peak a memory budget reads is @cosyte/bench's `budgetPeakBytes`: for an input under
// `BENCH_CONTRACT.FLOOR_INPUT_BYTES` (64 KiB) the median call's peak above the empty-call floor,
// since the probe itself costs tens of KiB on its highest call, more than 20 times a 1.3 KiB
// Observation whatever the code does; for a larger input the highest call's raw peak.
// It prints a Markdown table and always exits 0 when it could read the reading: the budgets are
// advisory, and a finding is a number to act on, not a red check. It exits 2 when it cannot read it.

import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { BENCH_CONTRACT, budgetPeakBytes, readResults } from "@cosyte/bench";

const DENSE_PEAK_MULTIPLE = 20;
const OPAQUE_PEAK_MULTIPLE = 3;
const COLD_IMPORT_MS = 10;
const THROUGHPUT_KEPT = 0.5;

/** The shape a benchmark measures: the text after the operation's name. */
function shapeOf(benchmark) {
  const at = benchmark.indexOf(": ");
  return at === -1 ? benchmark : benchmark.slice(at + 2);
}

function isOpaque(benchmark) {
  const shape = shapeOf(benchmark);
  return shape.startsWith("DiagnosticReport") || shape.startsWith("Binary");
}

/**
 * Whether a benchmark's bytes a second count a payload the operation never reads: validation of a
 * base64 PDF checks the members around it and not the payload, so its bytes a second grow with the
 * payload and say nothing about the validator.
 */
function skipsPayload(benchmark) {
  return benchmark.startsWith("validateResource") && isOpaque(benchmark);
}

/** A case's bytes a second, or why there is none. */
function bytesPerSecond(c) {
  if (c.throughput.status !== "measured") return `skipped (${c.throughput.reason})`;
  return c.throughput.bytesPerSecond ?? "no byte count";
}

function mib(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

/** The highest raw peak of a measured case: the heap and external memory together. */
function rawPeak(peak) {
  return peak.peakTotalBytes ?? peak.peakHeapBytes;
}

/**
 * The budgets tables, as Markdown, for the body of a reading.
 *
 * @param {import("@cosyte/bench").ReadingBody} reading
 * @returns {string}
 */
export function budgetsMarkdown(reading) {
  const { cases, importCost } = reading;
  const floor = reading.memoryFloor ?? null;
  const lines = [
    "### Budgets",
    "",
    `Peak memory is one call's peak of the V8 heap and external memory together, above what was in use before it, over one input's bytes; the budget is ${String(DENSE_PEAK_MULTIPLE)} times for a dense shape and ${String(OPAQUE_PEAK_MULTIPLE)} times for the base64 PDF report and Binary. For an input under ${mib(BENCH_CONTRACT.FLOOR_INPUT_BYTES)} the budget reads the median call's peak above the empty-call floor, what the probe itself costs; for any other input, the highest call's peak.`,
    "",
  ];
  if (floor !== null && floor.status === "measured") {
    lines.push(
      `Empty-call floor: median call ${mib(floor.medianPeakTotalBytes ?? floor.medianPeakHeapBytes)}, highest ${mib(rawPeak(floor))}.`,
      "",
    );
  } else {
    lines.push(
      "Empty-call floor: not measured in this reading, so every case reads its highest raw peak.",
      "",
    );
  }
  lines.push(
    "| Benchmark | Size | Input | Highest peak | Peak read | Read as | Multiple | Budget | Within |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const c of cases) {
    if (c.peak === null || c.peak.status !== "measured" || c.bytesPerPass === null) continue;
    const perInput = c.bytesPerPass / c.inputsPerPass;
    const read = budgetPeakBytes(c);
    const raw = rawPeak(c.peak);
    const aboveFloor =
      perInput < BENCH_CONTRACT.FLOOR_INPUT_BYTES &&
      c.peak.medianPeakTotalAboveFloorBytes !== undefined;
    const multiple = read / perInput;
    const budget = isOpaque(c.benchmark) ? OPAQUE_PEAK_MULTIPLE : DENSE_PEAK_MULTIPLE;
    lines.push(
      `| ${c.benchmark} | ${c.size} | ${mib(perInput)} | ${mib(raw)} | ${mib(read)} | ${aboveFloor ? "median above floor" : "highest"} | ${multiple.toFixed(1)}x | ${String(budget)}x | ${multiple < budget ? "yes" : "**no**"} |`,
    );
  }

  lines.push(
    "",
    `Throughput from a shape's smallest size to its largest; the budget keeps at least ${String(THROUGHPUT_KEPT * 100)}% of it.`,
    "",
    "| Benchmark | Smallest | Largest | Bytes/s, smallest | Bytes/s, largest | Kept | Within |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  );
  const byBenchmark = new Map();
  for (const c of cases) {
    const list = byBenchmark.get(c.benchmark) ?? [];
    list.push(c);
    byBenchmark.set(c.benchmark, list);
  }
  for (const [benchmark, list] of byBenchmark) {
    if (list.length < 2) continue;
    const first = list[0];
    const last = list[list.length - 1];
    if (skipsPayload(benchmark)) {
      // Bytes a second here count a payload validation never reads: a ratio of them is no budget.
      const cell = "payload skipped";
      lines.push(
        `| ${benchmark} | ${first.size} | ${last.size} | ${cell} | ${cell} | n/a | not judged: validation skips the base64 payload |`,
      );
      continue;
    }
    const small = bytesPerSecond(first);
    const large = bytesPerSecond(last);
    if (typeof small === "string" || typeof large === "string") {
      // A skip is not a pass: the row says what could not be measured.
      const cell = (v) => (typeof v === "string" ? v : `${mib(v)}/s`);
      lines.push(
        `| ${benchmark} | ${first.size} | ${last.size} | ${cell(small)} | ${cell(large)} | n/a | not measured |`,
      );
      continue;
    }
    const kept = large / small;
    lines.push(
      `| ${benchmark} | ${first.size} | ${last.size} | ${mib(small)}/s | ${mib(large)}/s | ${(kept * 100).toFixed(0)}% | ${kept >= THROUGHPUT_KEPT ? "yes" : "**no**"} |`,
    );
  }

  if (importCost !== null) {
    const own = importCost.medianMs - importCost.emptyMedianMs;
    lines.push(
      "",
      `Cold import: median ${importCost.medianMs.toFixed(2)} ms, ${own.toFixed(2)} ms above an empty module's ${importCost.emptyMedianMs.toFixed(2)} ms; budget ${String(COLD_IMPORT_MS)} ms: ${importCost.medianMs < COLD_IMPORT_MS ? "within" : "**over**"}. Loaded ${String(importCost.files.length)} file(s), ${mib(importCost.totalBytes)}, ${mib(importCost.totalGzipBytes)} gzipped.`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function main(argv) {
  const file = argv[0];
  if (file === undefined) {
    process.stderr.write("usage: node bench/budgets.mjs <reading.json> [--summary <file.md>]\n");
    return 2;
  }
  const summaryAt = argv.indexOf("--summary");
  const summary = summaryAt === -1 ? undefined : argv[summaryAt + 1];
  let doc;
  try {
    doc = readResults(readFileSync(file, "utf8"));
  } catch (error) {
    process.stderr.write(
      `could not read ${file}: ${error instanceof Error ? error.name : "error"}\n`,
    );
    return 2;
  }
  if (doc.kind !== "reading") {
    process.stderr.write(`${file} is a ${doc.kind}, not a reading\n`);
    return 2;
  }
  const text = budgetsMarkdown(doc.reading);
  process.stdout.write(text);
  if (summary !== undefined) writeFileSync(summary, text);
  return 0;
}

// Run as a script, not when a test imports the tables.
if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
