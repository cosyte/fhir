// Benchmarks for @cosyte/fhir, on @cosyte/bench, against the built entry a consumer imports.
//
// A reading of this build (throughput, latency p50/p95/p99, allocations, peak heap, a long run for
// leaks, and the cold import with every file it loads and its gzip size):
//   pnpm build && pnpm bench:reading --out bench-results/reading.json
// One benchmark or one case only (as `<benchmark> / <size>` in the results):
//   pnpm bench:reading --only "parseResource: transaction Bundle"
// A base against head comparison, the base built in another checkout:
//   pnpm bench:compare --base <base checkout>/dist/index.mjs --head dist/index.mjs
// The budgets and the CPU and heap profile of the hottest paths:
//   node bench/budgets.mjs bench-results/reading.json
//   node bench/profile.mjs dist/index.mjs
// On a pull request CI runs the comparison in its bench-compare job, and the bench-reading workflow
// takes a reading and a profile on a GitHub-hosted runner. Both are advisory: they post their numbers
// and fail nothing.
//
// The suite is handed the module under test rather than importing it, so one file measures both
// builds. Every input is synthetic and built in code by bench/shapes.mjs: no file is read.

import { defineBenchmark, defineSuite } from "@cosyte/bench";

import {
  KIB,
  binaryResource,
  containedPatient,
  observation,
  reportWithAttachment,
  searchsetBundle,
  transactionBundle,
} from "./shapes.mjs";

// Six shapes, each at the size real traffic has and at a size well past it. The pull request
// comparison runs only the small Observation, the 100 entry transaction and the report with a 64 KiB
// PDF (a long string, which the reader once built a character at a time), for each operation: a
// comparison runs every case 24 times in fresh processes, and its budget is 600 seconds. A reading
// measures every size.
const SHAPES = [
  {
    name: "Observation",
    sizes: [
      // The resource a feed carries all day. 64 of them, so a pass is not one string repeated.
      { label: "vital signs, 1.3 KiB", inputs: 64, build: (i) => observation(i), compare: true },
    ],
  },
  {
    name: "transaction Bundle",
    sizes: [
      {
        label: "100 entries, 89 KiB",
        inputs: 4,
        build: (i) => transactionBundle(i, 100),
        compare: true,
      },
      { label: "1,000 entries, 0.9 MiB", inputs: 1, build: (i) => transactionBundle(i, 1_000) },
      { label: "5,000 entries, 4.4 MiB", inputs: 1, build: (i) => transactionBundle(i, 5_000) },
    ],
  },
  {
    name: "searchset Bundle",
    sizes: [
      { label: "50 matches, 60 KiB", inputs: 4, build: (i) => searchsetBundle(i, 50) },
      { label: "1,000 matches, 1 MiB", inputs: 1, build: (i) => searchsetBundle(i, 1_000) },
    ],
  },
  {
    name: "Patient, deep and wide",
    sizes: [
      { label: "30 contained, 53 KiB", inputs: 4, build: (i) => containedPatient(i, 30) },
      { label: "300 contained, 0.4 MiB", inputs: 1, build: (i) => containedPatient(i, 300) },
    ],
  },
  {
    name: "DiagnosticReport, base64 PDF",
    sizes: [
      {
        label: "64 KiB PDF, 86 KiB",
        inputs: 4,
        build: (i) => reportWithAttachment(i, 64 * KIB),
        compare: true,
      },
      { label: "4 MiB PDF, 5.3 MiB", inputs: 1, build: (i) => reportWithAttachment(i, 4096 * KIB) },
    ],
  },
  {
    // The document a server hands back on its own: one base64 payload and three short members.
    name: "Binary, base64 PDF",
    sizes: [
      { label: "64 KiB PDF, 85 KiB", inputs: 4, build: (i) => binaryResource(i, 64 * KIB) },
      { label: "8 MiB PDF, 10.7 MiB", inputs: 1, build: (i) => binaryResource(i, 8192 * KIB) },
    ],
  },
];

/**
 * One input: its JSON text, and a slot the validate and serialize benchmarks keep its parsed model
 * in. Each is an object, so a model is cached against the input, never against a string.
 */
function input(text) {
  return { text };
}

/** The sizes of a shape as @cosyte/bench takes them: each corpus built in code, with its bytes. */
function sizes(shape) {
  return shape.sizes.map((size) => ({
    label: size.label,
    compare: size.compare ?? false,
    build: () => {
      const inputs = Array.from({ length: size.inputs }, (_v, i) => input(size.build(i)));
      return { inputs, bytes: inputs.reduce((n, x) => n + Buffer.byteLength(x.text), 0) };
    },
  }));
}

/**
 * The parsed model of an input, read once and kept, so validate and serialize time only themselves.
 * The first call on each input also parses it; the warmup runs every input many times before any
 * sample is taken, so no sample includes that parse.
 */
function modelOf(fhir, models) {
  return (x) => {
    let model = models.get(x);
    if (model === undefined) {
      model = fhir.parseResource(x.text).resource;
      models.set(x, model);
    }
    return model;
  };
}

const benchmarks = [];
for (const shape of SHAPES) {
  benchmarks.push(
    defineBenchmark({
      // The lenient JSON read every caller starts with: text to the immutable model.
      name: `parseResource: ${shape.name}`,
      sizes: sizes(shape),
      bind: (fhir) => (x) => fhir.parseResource(x.text),
      weigh: (result) => result.issues.length + 1,
    }),
    defineBenchmark({
      // Every layer validateResource runs with no profile and no terminology service: structure,
      // cardinality, value domain, safety, quantity, Bundle integrity, terminology and base
      // invariants.
      name: `validateResource: ${shape.name}`,
      sizes: sizes(shape),
      bind: (fhir) => {
        const model = modelOf(fhir, new WeakMap());
        return (x) => fhir.validateResource(model(x));
      },
      weigh: (result) => result.issues.length + 1,
    }),
    defineBenchmark({
      // The JSON write: the model back to text, with every guard that refuses an unfaithful write.
      name: `serializeResource: ${shape.name}`,
      sizes: sizes(shape),
      bind: (fhir) => {
        const model = modelOf(fhir, new WeakMap());
        return (x) => fhir.serializeResource(model(x));
      },
      weigh: (text) => text.length,
    }),
  );
}

export default defineSuite({ name: "@cosyte/fhir", benchmarks });
