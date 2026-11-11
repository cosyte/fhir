// The read's size axis with garbage collection traced:
//   pnpm build && node bench/scaling-trace.mjs dist/index.mjs [--summary <file.md>] [--label <name>]
//
// Three readings, each with the collector's own account of every collection (node:v8 GCProfiler:
// the kind of each collection, its cost, and the heap before and after it), so time the read spends
// collecting is told apart from time it spends reading.
//
// 0. The heap of one read of a large Bundle: the most the heap held while the read ran, above what
//    it held before, the same for memory outside the heap (typed arrays), and what the result keeps
//    once the read has returned. A peak is seen only at each collection and at the end, so it is a
//    lower bound. Read first, before the process has read anything large.
// 1. Cost per entry by Bundle size. Each size reads the same number of entries in all, so a cost per
//    entry that grows with the size is a cost that grows faster than the input. Split into the time
//    outside any collection, scavenges (the young generation) and mark-compacts (the old one).
// 2. The scaling gate's size axis as test/perf/scaling-gate.perf.ts times it: a warmed base phase
//    and a scaled phase of 4 times the entries, 5 repetitions each, the ratio of the fastest of
//    each. Each fixture is read three times over, with the collection time inside the fastest
//    repetition of each phase, and the ratio with that time taken out.
//
// The inputs are the bench's own transaction Bundles from bench/shapes.mjs: synthetic, built in code.

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { GCProfiler, setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";

import { transactionBundle } from "./shapes.mjs";

/** Entries read at each Bundle size in the first reading, whatever the size. */
const TOTAL_ENTRIES = 64_000;
const SIZES = [250, 500, 1_000, 2_000, 4_000, 8_000, 16_000];
/** The gate's contract: repetitions a phase, and how many times the scaled phase's entries are. */
const REPS = 5;
const STEP = 4;
const WARMUP_MS = 500;
const ROUNDS = 3;
/** Bundle sizes the heap reading reads once each. */
const HEAP_SIZES = [1_000, 4_000, 16_000];
const MIB = 1024 * 1024;
/** The size axis fixtures: the one the gate used, and the one it uses now. */
const FIXTURES = [
  { label: "2 Bundles, 1,000 against 4,000 entries", bundles: 2, entries: 1_000 },
  { label: "1 Bundle, 4,000 against 16,000 entries", bundles: 1, entries: 4_000 },
];

function args(argv) {
  const out = { target: argv[0], summary: undefined, label: undefined };
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === "--summary") out.summary = argv[++i];
    else if (argv[i] === "--label") out.label = argv[++i];
  }
  return out;
}

/** The collections a profile saw, summed by kind. */
function collections(profile) {
  const out = { scavenges: 0, scavengeMs: 0, marks: 0, markMs: 0, survivedBytes: 0 };
  for (const gc of profile.statistics) {
    const ms = gc.cost / 1000;
    if (gc.gcType === "Scavenge") {
      out.scavenges++;
      out.scavengeMs += ms;
      const young = gc.afterGC.heapSpaceStatistics.find((s) => s.spaceName === "new_space");
      out.survivedBytes += young?.spaceUsedSize ?? 0;
    } else {
      out.marks++;
      out.markMs += ms;
    }
  }
  return out;
}

/** Read every input once; returns a weight so the work is used. */
function pass(parse, corpus) {
  let weight = 0;
  for (const text of corpus) weight += parse(text).issues.length + 1;
  return weight;
}

/** Time `fn` with the collector traced. */
function traced(fn) {
  const profiler = new GCProfiler();
  profiler.start();
  const start = performance.now();
  const weight = fn();
  const ms = performance.now() - start;
  const profile = profiler.stop();
  if (weight < 0) throw new Error("unreachable");
  return { ms, gc: collections(profile ?? { statistics: [] }) };
}

/** A full collection, through the `gc` function the `--expose-gc` flag makes. */
function collector() {
  setFlagsFromString("--expose-gc");
  const gc = runInNewContext("gc");
  return () => {
    gc();
    gc();
  };
}

/** One read of each heap size, after a full collection, with the heap traced. */
function heap(parse) {
  const gc = collector();
  const rows = [];
  for (const size of HEAP_SIZES) {
    const text = transactionBundle(3, size);
    pass(parse, [transactionBundle(4, 100)]);
    gc();
    const before = process.memoryUsage();
    const profiler = new GCProfiler();
    profiler.start();
    let result = parse(text);
    const end = process.memoryUsage();
    const profile = profiler.stop() ?? { statistics: [] };
    let peakHeap = end.heapUsed;
    let peakExternal = end.external;
    for (const event of profile.statistics) {
      const stats = event.beforeGC.heapStatistics;
      peakHeap = Math.max(peakHeap, stats.usedHeapSize);
      peakExternal = Math.max(peakExternal, stats.externalMemory);
    }
    gc();
    const kept = process.memoryUsage().heapUsed - before.heapUsed;
    if (result.issues.length < 0) throw new Error("unreachable");
    result = undefined;
    rows.push({
      size,
      textMiB: text.length / MIB,
      peakHeapMiB: (peakHeap - before.heapUsed) / MIB,
      peakExternalMiB: (peakExternal - before.external) / MIB,
      keptMiB: kept / MIB,
      collections: profile.statistics.length,
    });
  }
  return rows;
}

function bySize(parse) {
  const rows = [];
  for (const size of SIZES) {
    const corpus = [transactionBundle(0, size), transactionBundle(1, size)];
    const passes = TOTAL_ENTRIES / (2 * size);
    const warmEnd = performance.now() + WARMUP_MS;
    while (performance.now() < warmEnd) pass(parse, corpus);
    const { ms, gc } = traced(() => {
      let weight = 0;
      for (let i = 0; i < passes; i++) weight += pass(parse, corpus);
      return weight;
    });
    const us = (x) => (1000 * x) / TOTAL_ENTRIES;
    rows.push({
      size,
      totalUs: us(ms),
      outsideUs: us(ms - gc.scavengeMs - gc.markMs),
      scavengeUs: us(gc.scavengeMs),
      markUs: us(gc.markMs),
      scavenges: gc.scavenges,
      marks: gc.marks,
      survivedKib: gc.scavenges === 0 ? 0 : gc.survivedBytes / gc.scavenges / 1024,
    });
  }
  return rows;
}

/** One phase: `REPS` timed passes; the fastest, with the collection time inside it. */
function phase(parse, corpus) {
  const reps = [];
  for (let r = 0; r < REPS; r++) reps.push(traced(() => pass(parse, corpus)));
  const fastest = reps.reduce((a, b) => (b.ms < a.ms ? b : a));
  return {
    min: fastest.ms,
    gcInMin: fastest.gc.scavengeMs + fastest.gc.markMs,
    scavengesInMin: fastest.gc.scavenges,
    samples: reps.map((r) => r.ms),
  };
}

function gateAxis(parse) {
  const rows = [];
  for (const fixture of FIXTURES) {
    const make = (entries) =>
      Array.from({ length: fixture.bundles }, (_v, i) => transactionBundle(i, entries));
    const base = make(fixture.entries);
    const scaled = make(fixture.entries * STEP);
    for (let round = 0; round < ROUNDS; round++) {
      const warmEnd = performance.now() + WARMUP_MS;
      while (performance.now() < warmEnd) pass(parse, base);
      const b = phase(parse, base);
      const s = phase(parse, scaled);
      rows.push({
        fixture: fixture.label,
        round: round + 1,
        base: b,
        scaled: s,
        ratio: s.min / b.min,
        ratioOutsideGc: (s.min - s.gcInMin) / (b.min - b.gcInMin),
      });
    }
  }
  return rows;
}

const f2 = (x) => x.toFixed(2);

function markdown(label, heapRows, sizes, axis) {
  const lines = [
    `## parseResource size axis, garbage collection traced (Node.js ${process.version})${label === undefined ? "" : `: ${label}`}`,
    "",
    "Heap of one read of a Bundle, after a full collection, above what was in use before it:",
    "",
    "| Entries a Bundle | Text MiB | Peak heap MiB | Peak outside the heap MiB | Kept by the result MiB | Collections during the read |",
    "| ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const r of heapRows) {
    lines.push(
      `| ${r.size.toLocaleString("en-US")} | ${f2(r.textMiB)} | ${f2(r.peakHeapMiB)} | ${f2(r.peakExternalMiB)} | ${f2(r.keptMiB)} | ${String(r.collections)} |`,
    );
  }
  lines.push(
    "",
    `Cost per entry by Bundle size, ${TOTAL_ENTRIES.toLocaleString("en-US")} entries read at each size, warmed:`,
    "",
    "| Entries a Bundle | Total us/entry | Outside GC us/entry | Scavenge us/entry | Mark-compact us/entry | Scavenges | Mark-compacts | Young generation left per scavenge |",
    "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  );
  for (const r of sizes) {
    lines.push(
      `| ${r.size.toLocaleString("en-US")} | ${f2(r.totalUs)} | ${f2(r.outsideUs)} | ${f2(r.scavengeUs)} | ${f2(r.markUs)} | ${String(r.scavenges)} | ${String(r.marks)} | ${r.survivedKib.toFixed(0)} KiB |`,
    );
  }
  lines.push(
    "",
    `The gate's size axis, fastest of ${String(REPS)} repetitions a phase, ${String(ROUNDS)} rounds a fixture:`,
    "",
    "| Fixture | Round | Base ms (GC in it, scavenges) | Scaled ms (GC in it, scavenges) | Ratio | Ratio outside GC |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
  );
  for (const r of axis) {
    lines.push(
      `| ${r.fixture} | ${String(r.round)} | ${f2(r.base.min)} (${f2(r.base.gcInMin)}, ${String(r.base.scavengesInMin)}) | ${f2(r.scaled.min)} (${f2(r.scaled.gcInMin)}, ${String(r.scaled.scavengesInMin)}) | ${r.ratio.toFixed(3)} | ${r.ratioOutsideGc.toFixed(3)} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const options = args(process.argv.slice(2));
  if (options.target === undefined) {
    process.stderr.write(
      "usage: node bench/scaling-trace.mjs <dist/index.mjs> [--summary <file.md>] [--label <name>]\n",
    );
    return 2;
  }
  const fhir = await import(pathToFileURL(resolve(options.target)).href);
  const parse = (text) => fhir.parseResource(text);
  // The heap is read first, in a process that has read nothing large yet.
  const heapRows = heap(parse);
  const text = markdown(options.label, heapRows, bySize(parse), gateAxis(parse));
  process.stdout.write(text);
  if (options.summary !== undefined) writeFileSync(options.summary, text);
  return 0;
}

process.exitCode = await main();
