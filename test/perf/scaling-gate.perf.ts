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
 * times as long on the size axis, 64 reports of a 64 KiB PDF on the count axis. The reader once
 * built a string a character at a time, and 4 times the payload took about 9 times as long. Its
 * self-check scans the text back to its start once for every 4 KiB of it, which is quadratic in the
 * payload's length.
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
 * and the gate skipped.
 */
const COUNT = 1_000;
/**
 * Observations on the count axis for the validator. It once cost several times what the read does
 * and 250 were enough; it now costs about what the read does, and at 250 its base phase fell under
 * the 4 ms floor and the gate skipped.
 */
const VALIDATE_COUNT = 1_000;
/** Entries in the size axis's base Bundle; the scaled phase has 4 times as many. */
const ENTRIES = 500;
/** Bundles in each size-axis phase. */
const BUNDLES = 2;

const LINE_FEED = 10;

/**
 * The same read, reached the wrong way: each line of the text (one Bundle entry a line) is found by
 * scanning from the start of the text, so the cost grows with the square of the entry count. It
 * reads exactly the text `parseResource` reads, which the self-check confirms before it times
 * anything.
 */
function parseQuadratic(raw: string): ReadResult {
  let count = 1;
  for (let p = raw.indexOf("\n"); p !== -1; p = raw.indexOf("\n", p + 1)) count++;
  const lines: string[] = [];
  for (let i = 0; i < count; i++) {
    let start = 0;
    for (let seen = 0; seen < i; start++) if (raw.charCodeAt(start) === LINE_FEED) seen++;
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

/** Reports on the long-string count axis, each with a 64 KiB PDF. */
const REPORTS = 64;
/** The PDF's length in the long-string size axis's base phase; the scaled phase's is 4 times it. */
const PDF_BYTES = 256 * KIB;
/** Reports in each phase of the long-string size axis. */
const PDF_REPORTS = 8;
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
    size: { inputs: BUNDLES, size: ENTRIES, generate: (i, size) => transactionBundle(i, size) },
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
  size: { inputs: BUNDLES, size: ENTRIES, generate: bundleModel },
};

/** A skip is not a pass: a gate that could not measure says so here, rather than reading green. */
function expectMeasured(report: ReturnType<typeof scalingGate>): void {
  expect(report.count.status, report.count.diagnostic).toBe("measured");
  expect(report.size.status, report.size.diagnostic).toBe("measured");
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
