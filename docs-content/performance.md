---
id: performance
title: Performance
sidebar_label: Performance
description: "What we measure on @cosyte/fhir and how: the benchmarks, the budgets, the scaling and cold import gates, the latest runner readings, and how to run them."
---

# Performance

This page describes what we measure on `@cosyte/fhir`, how we measure it, and how to run the
benchmarks yourself. The shared method every Cosyte package follows (throughput, latency
percentiles, memory, import time and bundle size, and how a pull request is compared with `main`)
is written down in the performance standard and the performance budgets standard among
[cosyte/config's decision records](https://github.com/cosyte/config/tree/main/documentation/decisions).
The numbers for the current release are in [Current numbers](#current-numbers) below.

Four things run today:

- **The benchmarks** (`bench/fhir.bench.mjs`): a reading of every case on each push to `main`, and
  a base against head comparison on every pull request. Both are advisory.
- **The budgets** (`bench/budgets.mjs`): four limits read from each reading. Advisory too.
- **The scaling gates** (`test/perf/scaling-gate.perf.ts`): fail a pull request when the cost of a
  read, a validation or a write grows faster than its input.
- **The cold import gate** (`scripts/check-cold-import.mjs`): fails a pull request when importing
  the package takes more than 10 ms.

## The benchmarks

`bench/fhir.bench.mjs` is our benchmark suite, run by the shared `@cosyte/bench` tool against the
built `dist/index.mjs`, the entry a consumer imports. It times `parseResource`, `validateResource`
(every layer it runs with no profile and no terminology service) and `serializeResource` on six
shapes, each at the size real traffic has and at a size well past it:

| Shape                        | Sizes                                    |
| ---------------------------- | ---------------------------------------- |
| Observation, vital signs     | 1.3 KiB                                  |
| transaction Bundle           | 100 entries (89 KiB), 1,000 (0.9 MiB), 5,000 (4.4 MiB) |
| searchset Bundle             | 50 matches (60 KiB), 1,000 (1 MiB)       |
| Patient, deep and wide       | 30 contained (53 KiB), 300 (0.4 MiB)     |
| DiagnosticReport, base64 PDF | 64 KiB PDF (86 KiB), 4 MiB PDF (5.3 MiB) |
| Binary, base64 PDF           | 64 KiB PDF (85 KiB), 8 MiB PDF (10.7 MiB) |

Two more benchmarks validate the Observation against caller schemas, once merging them on every
call and once with a registry built once, so a reading shows what
[building the registry once](./validate-many-resources-with-one-registry.md) saves. Every input is
synthetic and built in code by `bench/shapes.mjs`; no file is read.

- **A reading** measures one build: throughput in operations and bytes a second, latency at p50,
  p95 and p99, allocations per call, the peak memory of one call, whether the heap stays flat over a
  long run, and the cold import with the size of what it loads, raw and gzipped. The `Bench reading`
  workflow takes one on a GitHub-hosted runner on every push to `main`, with the budgets, a CPU and
  heap profile of the hottest paths (`bench/profile.mjs`), and the read's size axis with garbage
  collection traced (`bench/scaling-trace.mjs`). It keeps them as the run's `bench-reading`
  artifact.
- **A comparison** times the base build against the head build, interleaved in fresh processes on
  one runner. CI's `bench-compare` job runs it on every pull request over the Observation, the
  100 and 1,000 entry transaction Bundles and the report with a 64 KiB PDF. It is advisory: it
  reports what it finds on the run's page and never fails the pull request.

## Run the benchmarks yourself

From a clone of [cosyte/fhir](https://github.com/cosyte/fhir), with Node.js 22.22.2 or later and
pnpm 10:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm bench:reading --out bench-results/reading.json --summary bench-results/reading.md
node bench/budgets.mjs bench-results/reading.json
```

A full reading takes several minutes; `pnpm bench:reading --only "parseResource: transaction Bundle"`
reads one benchmark. To compare two builds, build the other one in a second checkout and run
`pnpm bench:compare --base <other checkout>/dist/index.mjs --head dist/index.mjs`. The scaling
gates run with `pnpm test:perf`, and the cold import gate with `pnpm check:cold-import` after a
build. On a busy developer machine, read the numbers as context: other work moves them by more than
the differences a comparison looks for.

## The budgets

`bench/budgets.mjs` reads four budgets from a reading. Each is a proposal until our numbers show it
can be held, and none fails a check: an exceeded budget is a number to act on.

- **Peak memory for a dense shape** under 20 times the input. For an input under 64 KiB the budget
  reads the median call's peak above the empty call's (what the probe itself costs); for a larger
  input, the highest call's peak.
- **Peak memory for a large opaque payload** (the base64 PDF report and the Binary) under 3 times
  the input.
- **The cold import** under 10 ms, the budget the cold import gate holds.
- **Throughput** in bytes a second keeping at least half from a shape's smallest size to its
  largest. Validation of a base64 payload is not judged: it checks the members around the payload
  and never reads the payload, so its bytes a second say nothing about the validator.

## The scaling gates

`pnpm test:perf` runs `test/perf/scaling-gate.perf.ts` in CI's `scaling-gate` job on every pull
request and push, never under coverage. Each gate times one workload at a base size and at four
times that size in one process, five times each, and fails when the ratio of the fastest scaled
time to the fastest base time is outside 1.5 to 8, the band the shared measurement contract fixes.
A cost that grows with the input reads about 4; one that grows with its square reads well above 8.

The gates cover `parseResource`, `validateResource` and `serializeResource`, each on two axes: four
times as many vital-signs Observations, and transaction Bundles with four times the entries. The
read of one long string has a gate of its own, a DiagnosticReport whose base64 PDF is four times as
long. Each gate has a self-check that runs the same work reached the wrong way, with a cost that
grows with the square of the input, and fails unless that clears the ceiling at the same sizes, so
the fixtures are known to be large enough for the gate to fail.

A gate does not see a constant-factor slowdown: a reader 10% slower everywhere passes. The
comparison above is the instrument for that.

## The latest readings

These are the two most recent readings of `main` on a GitHub-hosted runner, written here by hand
with their method. They are not the release's numbers, which are in
[Current numbers](#current-numbers).

- **Where and when:** the `Bench reading` workflow's runs on the pushes of commits `7a7a3ab` and
  `8d066a3` to `main`, on 2026-11-11. The second commit changed only documentation, so both read the
  same code.
- **The runner:** `ubuntu-latest`, 4 logical CPUs (an AMD EPYC 9V45 in the first run, a 9V74 in the
  second), Node.js 22.23.4, `@cosyte/bench` 0.1.5.
- **The method:** throughput is the median of three fresh processes; latency is per call, by nearest
  rank; peak memory is one call's peak of the V8 heap and external memory together, above what was
  in use before it. Where the two runs differ, the table gives both as a range, lower first.

| Benchmark           | Input                              | Time a call, median | p50                  | p95                 | p99                  | Peak memory     |
| ------------------- | ---------------------------------- | ------------------- | -------------------- | ------------------- | -------------------- | --------------- |
| `parseResource`     | Observation, 1.3 KiB               | 7.89 to 10.84 us    | 8.44 to 10.19 us     | 12.22 to 12.59 us   | 21.96 to 22 us       | 44.6 KiB        |
| `validateResource`  | Observation, 1.3 KiB               | 15.57 to 21.18 us   | 14.75 to 20.66 us    | 22.74 to 23.06 us   | 32.81 to 38.69 us    | 48.3 to 48.4 KiB |
| `serializeResource` | Observation, 1.3 KiB               | 9.67 to 13.05 us    | 9.66 to 12.53 us     | 10.34 to 14.06 us   | 22.75 to 28.13 us    | 34.6 KiB        |
| `parseResource`     | transaction Bundle, 100 entries    | 0.53 to 0.72 ms     | 0.50 to 0.68 ms      | 0.76 to 1.07 ms     | 0.81 to 1.15 ms      | 1.59 to 1.6 MiB |
| `validateResource`  | transaction Bundle, 100 entries    | 0.82 to 1.13 ms     | 0.82 to 1.1 ms       | 0.99 to 1.28 ms     | 1.34 to 1.59 ms      | 1.11 MiB        |
| `serializeResource` | transaction Bundle, 100 entries    | 0.71 to 0.93 ms     | 0.68 to 0.90 ms      | 0.82 to 1.05 ms     | 0.91 to 1.09 ms      | 1.56 MiB        |
| `parseResource`     | transaction Bundle, 5,000 entries  | 56.2 to 66.6 ms     | 56.8 to 60.3 ms      | not measured        | not measured         | 40.09 to 42.03 MiB |
| `validateResource`  | transaction Bundle, 5,000 entries  | 99.5 to 106.6 ms    | 98.6 to 104.4 ms     | not measured        | not measured         | 18.35 to 18.36 MiB |
| `serializeResource` | transaction Bundle, 5,000 entries  | 59.8 to 64.6 ms     | 58.3 to 63.0 ms      | not measured        | not measured         | 18.53 MiB       |

A call to the 5,000 entry Bundle outlasts a batch of the standard warmup, so `@cosyte/bench` reads it
under its large-case plan, which takes too few calls for a p95 or a p99.

What the two readings found against the budgets:

- **Memory, small inputs:** over budget in both. The vital-signs Observation peaks at 24.8 to 24.9
  times its size to read, 28.2 to 28.3 times to validate, against 20 times; the two caller-schema
  validations at 28.8 to 30.8 times. Every other memory budget was within in both.
- **Throughput:** within in the second reading. In the first, three Bundle cases kept less than half
  their bytes a second from the smallest size to the largest: `parseResource` on the transaction
  Bundle (47%) and the searchset Bundle (49%), and `validateResource` on the transaction Bundle
  (39%). In the second the same three kept 54%, 65% and 57%. The same code read both ways, so we
  read this budget as not yet held on this runner.
- **The cold import:** 6.28 and 6.63 ms, within 10 ms. The package loads one file of 329.6 KiB,
  81.8 KiB gzipped.
- **The long run:** the heap stayed flat for every case in this table in both readings but two, which
  each grew in one reading and stayed flat in the other: `validateResource` on the Observation
  (0.73 bytes a call over 138,240 calls) and on the 100 entry Bundle (55 bytes a call over 3,480
  calls).

The scaling gates in the CI workflow's `scaling-gate` job, on the pushes of the same two commits,
read these ratios, against the band of 1.5 to 8:

| Gate                                | Count axis     | Size axis      |
| ----------------------------------- | -------------- | -------------- |
| `parseResource`                     | 3.925 to 3.929 | 4.136 to 4.436 |
| `parseResource` on a long string    | 4.018 to 4.030 | 3.954 to 4.003 |
| `validateResource`                  | 3.917 to 4.571 | 4.572 to 5.234 |
| `serializeResource`                 | 4.079 to 4.533 | 4.478 to 5.428 |

The cold import gate in the same two CI runs read medians of 8.77 and 5.77 ms, each over twenty
fresh processes, within its 10 ms budget.

### A small resource, read and validated with less memory

Since those readings, a read of JSON text builds the model straight from the tokens of the text for
an object with no `_`-sibling, no repeated name and at most 16 members, and validation makes fewer
lists, sets and scope objects on its walks. These are the peak memory budget's readings of the
vital-signs Observation (1.3 KiB), above the empty call's floor, in the `Bench reading` run of
`main` at commit `36f6632` just before the change (run 43136596065) and in the runs of the change on
its pull request (run 43168663384, commit `f7786cf`):

| Benchmark                                         | Before | After  | Budget |
| ------------------------------------------------- | ------ | ------ | ------ |
| `parseResource`                                   | 25.3x  | 13.3x  | 20x    |
| `validateResource`                                | 42.1x  | 24.3x  | 20x    |
| `validateResource`, caller schemas on each call   | 44.6x  | 26.8x  | 20x    |
| `validateResource`, a registry built once         | 42.1x  | 24.2x  | 20x    |
| `serializeResource`                               | 17.9x  | 17.9x  | 20x    |

The read is now within its budget. Validation is not yet: the walks of its layers still make a
list or an object at most of the elements they pass. `test/perf/small-resource-heap.perf.ts` holds
the read under 20 times in CI's `scaling-gate` job, measured the way the reading measures it.

## The cold import

Importing the package costs a process time before it reads anything, which matters most to a
short-lived process and to a package that imports this one. Importing `@cosyte/fhir` parses no
FHIRPath expression: the expressions of the base constraints that `validateResource` evaluates are
parsed on the first validation, once, and kept. If a parse fails for a reason other than the
expression itself, such as the stack running out, that validation reports the constraint
`INVARIANT_UNCHECKED`, nothing is kept, and the next validation parses it again.

`pnpm check:cold-import` starts a new Node.js process twenty times, each timing one
`await import()` of the built `dist/index.mjs` with `performance.now()`, interleaved with imports
of an empty module so a slow runner shows as a slow empty import, and fails when the median is over
10 ms. CI's `cold-import` job runs it on a GitHub-hosted runner with Node.js 22 on every pull
request and push. On a pull request it also builds the base and reads it in turns with the change,
so both medians come from one runner at one time; only the change's median is gated.

## The bounds the readers hold today

These are properties of the code, not measurements. Each one keeps a hostile or very large input
from costing more than a fixed amount.

- **Nesting is bounded.** Both readers stop at a fixed nesting depth and refuse the document with
  `MAX_DEPTH_EXCEEDED`, so a deeply nested document is a typed error rather than a stack overflow.
  The fuzz tests feed both readers deeply nested documents to hold this.
- **Entities are never expanded.** The XML reader refuses a `DOCTYPE` and any entity it does not
  define, so a small document cannot expand into gigabytes of memory.
- **An NDJSON export is streamed.** `streamNdjson` holds only the part of the current line that has
  no newline yet, bounded by `maxLineBytes` (16 MiB by default), so memory does not grow with the
  size of the export. [Stream a Bulk Data export](./stream-ndjson-exports.md) shows the bound at
  work.
- **The contained-resource cycle guard is bounded.** The check for a cycle among a resource's
  `contained` resources holds at most `MAX_REFERENCE_DEPTH` (512) entries on its frontier, and
  reports a deeper graph as a cycle rather than walking it.
- **Nothing is fetched.** The package has no runtime dependencies, opens no socket and resolves no
  URI, so no read or validation waits on a network unless you pass in a terminology service of your
  own.

## Large Bundles cost more per entry

`parseResource` costs about twice as much per entry on a large Bundle as on a small one. We measured
this with `bench/scaling-trace.mjs` on a GitHub-hosted runner (Node.js 22), reading synthetic
transaction Bundles of about 0.9 KiB an entry, in eighteen runs, each beside a run of the previous
reader on the same runner (the pull request that changed the reader lists every run):

- Up to 1,000 entries a Bundle: 5.8 to 12.5 us an entry (the previous reader: 7.0 to 15.1).
- From 2,000 entries a Bundle up to 16,000: 14.2 to 24.3 us an entry (the previous reader: 16.6
  to 30.3).

The times differ from run to run with the runner; the step between them is there in every run.

Most of the step comes from garbage collection. A read keeps the model it builds alive until it
returns, about 6 KiB an entry for these Bundles. Below the step, that fits in V8's young
generation, and a collection finds most of what it scans already dead. Above the step it no longer
fits, so the collector copies the model and moves it to the old generation. Across the step, the
time in young-generation collections rose from 0.5 to 2.0 us an entry to 6.1 to 9.9 us, and
old-generation collections added 0.2 to 3.1 us more.

The previous reader also kept the whole raw JSON tree it read first alive beside the model. The
reader now checks the text into a compact list of tokens kept outside the JavaScript heap and makes
the raw tree from it one part at a time as it builds, letting each Bundle entry's part go once that
entry is built. In the same eighteen runs:

- The peak heap of one read of a 16,000-entry Bundle (13.8 MiB of text) fell from 168 to 170 MiB
  to about 118 MiB, plus 13.8 MiB of tokens outside the heap while the read runs. At 4,000 entries it fell
  from 48 MiB to 37 MiB, plus 3.5 MiB. The model a read returns is the same size as before: 96 MiB
  at 16,000 entries.
- Past the step, the time outside collection fell from 8.3 to 15.1 us an entry to 6.4 to 12.6 us, and
  the total at 16,000 entries fell by 13% to 31% against the previous reader in the same run.
- The step itself did not move, and did not shrink by much: the model is most of what the
  collector copies, and a caller keeps it.

The time outside collection still rises across the step, by up to 21% between 1,000 and 2,000
entries, depending on the run, and by at most 7% more from 2,000 to 16,000. We have not found the
cause of that part. From 2,000 to 16,000 entries, the total cost per entry rose by 7% to 22%. None
of this is a cost that grows with the square of the size: at 4,000 against 16,000 entries, four
times the entries cost 3.9 to 4.9 times as long in each of those runs, and 4.0 to 4.8 times in each
run of the scaling gate that measured it.

Where the step falls depends on the size of the young generation. On the runner it is between
1,000 and 2,000 entries a Bundle. On a developer machine running Node.js 26, with the previous
reader, it was between 2,000 and 4,000; we have not measured it there since.

If you read very large Bundles:

- Read in smaller units where you control the shape: Bundles of a few hundred entries, or an NDJSON
  export read one resource a line with `streamNdjson`, which keeps each read below the step.
- Node.js's `--max-semi-space-size` option makes the young generation larger, which should move
  the step up. We have not measured that.

## Parsed strings can keep the input alive

To save copies, the JSON reader returns a string of 13 or more characters as a slice of the input text. A resource you keep can therefore hold the whole parsed text in memory for as long as it lives: parse a large Bundle, keep one small resource, and the Bundle's text stays too. Copy what you keep, for example with `structuredClone` or a JSON round trip of the resource, or let the parsed result go once you are done with it.

## What these numbers are not

- **Not a guarantee for every input.** Adversarial documents are not characterized here beyond
  the bounds above. Large Bundles have one measured limit, described in
  [Large Bundles cost more per entry](#large-bundles-cost-more-per-entry).
- **Not a comparison with other libraries.** A comparison will be a separate suite with its own
  written method. Neither exists yet.
- **Not a behavior contract.** Nothing here changes how a resource is read or validated.

## Current numbers

The numbers for this section are measured on `main` at each release and filled in when the release
is built. They are never typed by hand.
