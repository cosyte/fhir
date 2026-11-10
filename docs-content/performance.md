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

- **Not a guarantee for every input.** Very large Bundles and adversarial documents are not
  characterized here beyond the bounds above.
- **Not a comparison with other libraries.** A comparison will be a separate suite with its own
  written method. Neither exists yet.
- **Not a behavior contract.** Nothing here changes how a resource is read or validated.

## Current numbers

The numbers for this section are measured on `main` at each release and filled in when the release
is built. They are never typed by hand.
