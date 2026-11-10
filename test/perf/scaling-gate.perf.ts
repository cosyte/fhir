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
 * Not gated here: the read of one very long string (a base64 attachment) grows faster than its
 * length today, which a reading of the bench records. Its gate comes with its fix.
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
import { observation, transactionBundle } from "../../bench/shapes.mjs";

/** Observations on the count axis: enough that each phase is well above the 4 ms floor. */
const COUNT = 250;
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
  count: { n: COUNT, generate: observationModel },
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
