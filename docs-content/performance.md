---
id: performance
title: Performance
sidebar_label: Performance
description: "What we will measure on @cosyte/fhir (throughput, latency, memory, import time and bundle size), the bounds the readers hold today, and where the numbers go."
---

# Performance

This page describes what we will measure on `@cosyte/fhir` and what the package does today to keep
its cost bounded. The shared method every Cosyte package will follow (throughput, latency
percentiles, memory, import time and bundle size, and how a pull request is compared with `main`)
will be written down in a performance standard among
[cosyte/config's decision records](https://github.com/cosyte/config/tree/main/documentation/decisions).
That standard is still in review and is not one of those records yet.
The numbers for the current release are in [Current numbers](#current-numbers) below.

## What we measure

We do not run a benchmark on this package yet, so this release has no measured numbers. When the
benchmarks land they will follow that standard and measure:

- **Throughput**: resources read and validated a second, from a small resource to a large Bundle.
- **Latency**: the 50th, 95th and 99th percentile time to read and to validate one resource.
- **Memory**: peak heap and allocations, and whether the heap stays flat over a long run, such as a
  large NDJSON export streamed end to end.
- **Import time and bundle size**: how long the package takes to load, and the size of what it
  ships.

Until then, the numbers below say "not measured for this release".

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

## What these numbers are not

- **Not a guarantee for every input.** Adversarial documents are not characterized here beyond
  the bounds above. Large Bundles have one measured limit, described in
  [Large Bundles cost more per entry](#large-bundles-cost-more-per-entry).
- **Not a comparison with other libraries.** A comparison will be a separate suite with its own
  written method. Neither exists yet.
- **Not a behavior contract.** Nothing here changes how a resource is read or validated.

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
10 ms. CI runs it on a GitHub-hosted runner after every build. On a pull request it also builds
the base and reads it in turns with the change, so both medians come from one runner at one time;
only the change's median is gated.

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

## Build a schema registry once

A `validateResource` call given `schemas` merges them with the built-in schemas into a new registry
on every call. To validate many resources against the same schemas, build the registry once with
`buildRegistry` and pass it as `registry`; every call then reads that one registry, and its
findings are the same as with `schemas`:

```ts runnable
import { buildRegistry, parseResource, validateResource } from "@cosyte/fhir";

// Once, where the schemas are made: here a made-up resource type with one required element.
const registry = buildRegistry([
  { type: "Widget", elements: { status: { min: 1, max: 1, types: ["code"] } } },
]);

const widgets = ['{"resourceType":"Widget","status":"on"}', '{"resourceType":"Widget"}'];
const results = widgets.map((text) =>
  validateResource(parseResource(text).resource, { mode: "lenient", registry }),
);
results.map((result) => result.valid); // => [true, false]
results[1]?.issues.map((issue) => issue.code); // => ["CARDINALITY_MIN"]
```

When a call passes both `registry` and `schemas`, the registry is used and `schemas` is not read.

What this saves is the time of the merge on every call and a little peak heap; what a call allocates
is about the same either way.

The built-in schemas a registry returns are frozen and shared by every registry. To change one,
copy it and its `elements` with a spread, change the copy, and register the copy with
`buildRegistry`.

## Current numbers

The numbers for this section are measured on `main` at each release and filled in when the release
is built. They are never typed by hand.
