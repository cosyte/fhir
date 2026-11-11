/**
 * The scaling gates for the JSON read, the validator and the JSON write, from
 * `@cosyte/test-utils/perf`, run by `pnpm test:perf` and never under coverage (see
 * `vitest.perf.config.ts`).
 *
 * Each asks one question: does the cost grow faster than the input? On the count axis, 4 times the
 * vital-signs Observations; on the size axis, transaction Bundles with 4 times the entries. Each
 * ratio must stay inside the band the shared contract fixes. A gate does not see a constant-factor
 * slowdown: a reader 10% slower everywhere passes, and always will. The base against head
 * comparison on a pull request (`bench/fhir.bench.mjs`) is the instrument for that.
 *
 * Each self-check proves its fixtures are large enough for its gate to fail: the same work reached
 * quadratically must clear the ceiling at exactly these sizes. For the read, every entry is found by
 * scanning the text from its start; for the validator and the writer, the Bundle's reference index
 * is rebuilt once for every entry instead of once for the Bundle. Every input is synthetic and built
 * in code by `bench/shapes.mjs`, the same code the benchmarks use.
 *
 * The read of one very long string has a gate of its own: a DiagnosticReport whose base64 PDF is 4
 * times as long on the size axis, 256 reports of a 64 KiB PDF on the count axis. The reader once
 * built a string a character at a time, and 4 times the payload took about 9 times as long. Its
 * self-check scans the text back to its start once for every 4 KiB of it, which is quadratic in the
 * payload's length.
 *
 * Every base phase must take 8 ms or more, twice the shared floor, so a fixture that a fast runner
 * would read under the floor fails here rather than skipping; each gate prints its ratios and both
 * phase times on a pass as well as a failure.
 */

import {
  assertScalingGateFires,
  scalingGate,
  type ScalingGateOptions,
} from "@cosyte/test-utils/perf";
import { describe, expect, it } from "vitest";

import {
  buildBundleIndex,
  getProperty,
  isList,
  isPrimitive,
  parseResource,
  serializeResource,
  validateResource,
  type FhirComplex,
  type ReadResult,
  type ValidationResult,
} from "../../src/index.js";
import { KIB, observation, reportWithAttachment, transactionBundle } from "../../bench/shapes.mjs";

/**
 * Observations on the count axis for the read and the write: enough that each base phase is well
 * above the 4 ms floor on a GitHub-hosted runner. At 250, the read's base phase there was 3.9 ms
 * and the gate skipped; at 1,000 it was 7.6 to 15.3 ms across runners, under the 8 ms this file
 * asserts on the fastest.
 */
const COUNT = 2_000;
/**
 * Observations on the count axis for the validator. It once cost several times what the read does
 * and 250 were enough; it now costs about what the read does, and at 250 its base phase fell under
 * the 4 ms floor and the gate skipped.
 */
const VALIDATE_COUNT = 1_000;
/** Entries in the size axis's base Bundle; the scaled phase has 4 times as many. */
const ENTRIES = 500;
/**
 * Entries in the read's size-axis base Bundle; the scaled Bundle has 4 times as many.
 *
 * The read's cost per entry steps up once, mostly where what one read keeps alive outgrows the
 * young generation: below that, a scavenge finds most of what it scans already dead; above it,
 * nearly all of it alive, so it copies it out and promotes it. `bench/scaling-trace.mjs` traces it.
 * The reader once kept its whole raw JSON tree alive beside the model (about 15 KiB an entry
 * together on a developer machine); it now makes that tree one entry at a time, so what stays alive
 * is mostly the model, about 6 KiB an entry, and the step is smaller but still there. The figures
 * below were read with the earlier reader.
 * On five GitHub-hosted runner reads (Node.js 22), the scavenge time per entry rose 6 to 10 times
 * between 1,000 and 2,000 entries a Bundle and at most 1.5 times more from there to 16,000. The
 * time outside collection rose too, by 7% to 48% across that step and by at most 19% from 2,000 to
 * 16,000, for a cause not yet found. No read showed a cost growing with the square of the size.
 *
 * A phase on each side of the step reads the step as growth. At 500 against 2,000 the gate read 9.1
 * to 12.0; at 1,000 against 4,000 it read 5.2 to 6.6 and once 8.03. Traced, the base phase's two
 * scavenges found little alive and cost 1.4 to 4.4 ms, while the scaled phase's dozen copied nearly
 * everything and cost 50 to 94 ms of its 116 to 195. The five runner reads put that fixture at
 * 6.36 to 8.81, and at 3.94 to 5.63 with collection taken out. 4,000 against 16,000 puts both
 * phases past the step, so each pays its share of collection: the same reads put it at 4.00 to
 * 4.35, and at 3.94 to 4.16 with collection taken out.
 */
const READ_ENTRIES = 4_000;
/**
 * Bundles in each phase of the read's size axis, so each timed pass and each warmup batch reads two.
 *
 * With one Bundle a pass, the reader that makes its raw tree one entry at a time warmed unstably on
 * 3 of 10 runner runs: single passes of the 4,000-entry Bundle alternated between about 71 and 85
 * ms, with a 130 to 138 ms pass every 8 or 9, and a pass over 50 ms is a warmup batch of its own,
 * so three batches in a row within 5% of their median rarely came inside the 5 s bound. Two Bundles
 * a pass puts one of each alternating read in every batch. The ratio compares the same sizes, 4,000
 * against 16,000 entries a Bundle, and the base phase is about twice the 40 ms or more one Bundle
 * took, well over the 8 ms this file asserts.
 */
const READ_BUNDLES = 2;
/** Bundles in each size-axis phase. */
const BUNDLES = 2;
/**
 * Bundles in each phase of the write's size axis. At 2 its base phase was 8.6 to 18.7 ms across
 * runners, too near the 8 ms this file asserts; the entries per Bundle, which set the ratio, stay.
 */
const SERIALIZE_BUNDLES = 4;

/**
 * The same read, reached the wrong way: each line of the text (one Bundle entry a line) is found by
 * stepping from the start of the text one line at a time, so the cost grows with the square of the
 * entry count. It reads exactly the text `parseResource` reads, which the self-check confirms before
 * it times anything. Each step is a native search for the next line break rather than a loop over
 * every character, so at the read's 16,000 entries a pass stays short enough for the self-check to
 * finish well inside its timeout. At 4,000 entries the stepping alone costs about 3 times the read,
 * so one pass is enough: on a GitHub-hosted runner the self-check's signal was 11.9 against the
 * ceiling of 8.
 */
function parseQuadratic(raw: string): ReadResult {
  let count = 1;
  for (let p = raw.indexOf("\n"); p !== -1; p = raw.indexOf("\n", p + 1)) count++;
  const lines: string[] = [];
  for (let i = 0; i < count; i++) {
    let start = 0;
    for (let seen = 0; seen < i; seen++) start = raw.indexOf("\n", start) + 1;
    const end = raw.indexOf("\n", start);
    lines.push(raw.slice(start, end === -1 ? raw.length : end));
  }
  return parseResource(lines.join("\n"));
}

/** The `fullUrl` of every entry of a Bundle model. */
function fullUrls(bundle: FhirComplex): string[] {
  const entries = getProperty(bundle, "entry");
  if (entries === undefined || !isList(entries)) return [];
  return entries.items.flatMap((entry) => {
    if (entry.kind !== "complex") return [];
    const url = getProperty(entry, "fullUrl");
    return url !== undefined && isPrimitive(url) && typeof url.value === "string"
      ? [url.value]
      : [];
  });
}

/**
 * Resolve every entry through a reference index rebuilt for that entry: the walk over a Bundle
 * reached the wrong way, quadratic in the entry count. Throws if an entry does not resolve, so the
 * work is used and cannot be skipped.
 */
function resolveEachEntryQuadratically(bundle: FhirComplex): void {
  for (const url of fullUrls(bundle)) {
    if (!buildBundleIndex(bundle).byFullUrl.has(url)) throw new Error("an entry did not resolve");
  }
}

/**
 * Reports on the long-string count axis, each with a 64 KiB PDF. At 64 the base phase was 3.2 to
 * 7.3 ms across runners and skipped under the 4 ms floor on the fastest.
 */
const REPORTS = 256;
/** The PDF's length in the long-string size axis's base phase; the scaled phase's is 4 times it. */
const PDF_BYTES = 256 * KIB;
/**
 * Reports in each phase of the long-string size axis. At 8 the base phase fell to 3.99 ms, under
 * the 4 ms floor, once the reader crossed a long run with one search; at 16 it was 3.0 to 7.1 ms
 * across runners. The PDF's length, which sets the ratio, stays.
 */
const PDF_REPORTS = 64;
/** How far apart the regressed read starts each scan of the text. */
const SCAN_STEP = 4 * KIB;

/**
 * The read of a long string reached the wrong way: before reading the text, scan it back to its start
 * once for every 4 KiB of it, so the cost grows with the square of its length. Throws if the scan
 * finds what a JSON document cannot hold, so the work is used and cannot be skipped.
 */
function parseScanningQuadratically(raw: string): ReadResult {
  for (let end = SCAN_STEP; end < raw.length; end += SCAN_STEP) {
    if (raw.lastIndexOf("\u0000", end) !== -1) throw new Error("a NUL in the document");
  }
  return parseResource(raw);
}

/** The long-string read: every phase, and its self-check, use exactly these fixtures. */
function longStringOptions(): ScalingGateOptions<string, ReadResult> {
  return {
    name: "@cosyte/fhir parseResource, a base64 attachment",
    parse: (raw) => parseResource(raw),
    weigh: (result) => result.issues.length + 1,
    count: { n: REPORTS, generate: (i) => reportWithAttachment(i, 64 * KIB) },
    size: {
      inputs: PDF_REPORTS,
      size: PDF_BYTES,
      generate: (i, size) => reportWithAttachment(i, size),
    },
  };
}

/** Every phase, and each self-check, use exactly these fixtures. */
function textOptions(): ScalingGateOptions<string, ReadResult> {
  return {
    name: "@cosyte/fhir parseResource",
    parse: (raw) => parseResource(raw),
    weigh: (result) => result.issues.length + 1,
    count: { n: COUNT, generate: (i) => observation(i) },
    size: {
      inputs: READ_BUNDLES,
      size: READ_ENTRIES,
      generate: (i, size) => transactionBundle(i, size),
    },
  };
}

/** The models the validator and the writer are timed on, read once outside every timed phase. */
const observationModel = (i: number): FhirComplex => parseResource(observation(i)).resource;
const bundleModel = (i: number, size: number): FhirComplex =>
  parseResource(transactionBundle(i, size)).resource;

const validateOptions: ScalingGateOptions<FhirComplex, ValidationResult> = {
  name: "@cosyte/fhir validateResource",
  parse: (model) => validateResource(model),
  weigh: (result) => result.issues.length + 1,
  count: { n: VALIDATE_COUNT, generate: observationModel },
  size: { inputs: BUNDLES, size: ENTRIES, generate: bundleModel },
};

const serializeOptions: ScalingGateOptions<FhirComplex, string> = {
  name: "@cosyte/fhir serializeResource",
  parse: (model) => serializeResource(model),
  weigh: (text) => text.length,
  count: { n: COUNT, generate: observationModel },
  size: { inputs: SERIALIZE_BUNDLES, size: ENTRIES, generate: bundleModel },
};

/**
 * The least a base phase may take here, well above the shared 4 ms floor: a fixture whose base phase
 * reads under it on a fast runner is one runner away from skipping, so it fails here instead, and the
 * fixture is grown. Each fixture above is sized for 10 ms or more on a GitHub-hosted runner.
 */
const LEAST_BASE_PHASE_MS = 8;

/** A skip is not a pass: a gate that could not measure says so here, rather than reading green. */
function expectMeasured(report: ReturnType<typeof scalingGate>): void {
  // The ratio and both phase times, on a pass as well as a failure, so a run that passes still
  // leaves its reading in the log.
  process.stderr.write(`${report.count.diagnostic}\n`);
  process.stderr.write(`${report.size.diagnostic}\n`);
  for (const axis of [report.count, report.size]) {
    expect(axis.status, axis.diagnostic).toBe("measured");
    if (axis.status !== "measured") continue;
    process.stderr.write(
      `${report.name}, ${axis.axis} axis: ratio ${axis.ratio.toFixed(3)}, base ${axis.base.min.toFixed(2)} ms, scaled ${axis.scaled.min.toFixed(2)} ms\n`,
    );
    expect(
      axis.base.min,
      `${report.name}, ${axis.axis} axis: base phase ${axis.base.min.toFixed(2)} ms, under ${String(LEAST_BASE_PHASE_MS)} ms`,
    ).toBeGreaterThanOrEqual(LEAST_BASE_PHASE_MS);
  }
}

describe("the scaling gate: parseResource", () => {
  it("has not acquired a complexity regression on either axis", () => {
    expectMeasured(scalingGate(textOptions()));
  });

  it("has fixtures large enough for that gate to fail", () => {
    const report = assertScalingGateFires(textOptions(), {
      regressedParse: parseQuadratic,
      equals: (a, b) =>
        a.issues.length === b.issues.length &&
        serializeResource(a.resource) === serializeResource(b.resource),
    });
    expect(report.margin).toBeGreaterThan(1);
  });
});

describe("the scaling gate: parseResource on a long string", () => {
  it("has not acquired a complexity regression on either axis", () => {
    expectMeasured(scalingGate(longStringOptions()));
  });

  it("has fixtures large enough for that gate to fail", () => {
    const report = assertScalingGateFires(longStringOptions(), {
      regressedParse: parseScanningQuadratically,
      equals: (a, b) =>
        a.issues.length === b.issues.length &&
        serializeResource(a.resource) === serializeResource(b.resource),
    });
    expect(report.margin).toBeGreaterThan(1);
  });
});

describe("the scaling gate: validateResource", () => {
  it("has not acquired a complexity regression on either axis", () => {
    expectMeasured(scalingGate(validateOptions));
  });

  it("has fixtures large enough for that gate to fail", () => {
    const report = assertScalingGateFires(validateOptions, {
      regressedParse: (model) => {
        resolveEachEntryQuadratically(model);
        return validateResource(model);
      },
    });
    expect(report.margin).toBeGreaterThan(1);
  });
});

describe("the scaling gate: serializeResource", () => {
  it("has not acquired a complexity regression on either axis", () => {
    expectMeasured(scalingGate(serializeOptions));
  });

  it("has fixtures large enough for that gate to fail", () => {
    const report = assertScalingGateFires(serializeOptions, {
      regressedParse: (model) => {
        resolveEachEntryQuadratically(model);
        return serializeResource(model);
      },
    });
    expect(report.margin).toBeGreaterThan(1);
  });
});
