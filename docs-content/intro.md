---
id: intro
title: Getting started
sidebar_label: Getting started
description: What @cosyte/fhir is, what it covers against FHIR R4, what it does not do, and where to start reading.
---

# @cosyte/fhir

Our **FHIR** toolkit for Node.js and TypeScript: an **R4-first** resource model, a JSON **and** XML
codec, and layered validation, with the same one-line ergonomics as the rest of the `@cosyte/*`
parser suite. It is the FHIR member of that suite and mirrors the API shape of
[`@cosyte/hl7`](https://docs.cosyte.com/hl7), our HL7 v2 parser.

What it is for, in one sentence: read a real-world FHIR resource, model it with correct primitive
semantics, and validate it against the profiles you supply, such as US Core, without reading the FHIR
specification first.

It is for developers who receive FHIR from servers and EHRs they do not control and need to read it
without losing or inventing anything. It is not a FHIR server, a client, a terminology server, or a
typed model per resource type; [current limits](./limits.md) lists what it deliberately leaves out.

## Status

`@cosyte/fhir` is on the `0.1` line and installs from npm; [installation](./installation.md) has the
command. While the package is below 1.0, every release is a patch version, a breaking change
included, and the changelog entry for a breaking change says what changed and what a caller must
do. What the package does not do is listed in [current limits](./limits.md), which is
worth reading before you plan around it.

## Start here

- **[Installation](./installation.md)**: runtime requirements, module formats, and how to get the
  package.
- **[Quickstart](./quickstart.md)**: an unparsed document to a parsed resource, a clinical value,
  and a validation verdict, in three steps.
- **How-to guides**, one task each: [accept JSON and XML](./accept-json-and-xml.md),
  [read measured values](./read-measured-values.md),
  [decide whether a resource is safe to summarize](./check-safety-before-summarizing.md),
  [validate against your own profiles](./validate-against-profiles.md),
  [check codes](./check-codes.md), [read Bundles and references](./read-bundles-and-references.md),
  [stream a Bulk Data export](./stream-ndjson-exports.md), and
  [keep what you cannot interpret](./preserve-unknown-content.md).
- **[Core concepts](./core-concepts.md)**: the schema-free model, exact primitives, the two codecs,
  and the validation layers.
- **[Current limits](./limits.md)**: the deliberate boundaries, including what is checked and what
  is only reported as unchecked.
- **[Troubleshooting](./troubleshooting.md)**: every refusal and degraded reading, with the coded
  reason it carries and the action to take.
- **[API reference](./api/README.md)**: every export, generated from the TSDoc comments in the
  source.
- **[Testing and quality](./testing-and-quality.md)** and **[Performance](./performance.md)**: how
  we test the package and what we measure.

## What it does

Against FHIR R4 (`4.0.1`), the package can:

- **Read and round-trip** a resource through a precision-preserving JSON codec and a
  zero-dependency XML codec that share one schema-free model. A `decimal` or `integer64` value is
  kept as its exact lexical text and never routed through a JavaScript number, so a dose or an
  identifier cannot be silently corrupted. The XML reader refuses any `DOCTYPE` or non-predefined
  entity rather than resolving it.
- **Validate** across structural, cardinality, and value-domain layers, emitting a value-free
  `OperationOutcome`: a finding carries a coded reason and a location, never the value it was raised
  over.
- **Surface the safety-critical status and negation model**: it fails closed on an unknown
  `modifierExtension` and does not drop a status, a modifier, or a negation on the paths it reads.
- **Report measured values by their true type** with UCUM unit fidelity, never the display string
  and never converted, validate code systems and binding strength without vendoring any terminology
  content, validate against caller-supplied US Core or vendor profiles, and evaluate their FHIRPath
  invariants through a bounded, in-repository expression subset, reporting anything outside that
  subset as `INVARIANT_UNCHECKED` rather than passing it.
- **Read Bundles and Bulk Data exports**: tell a transaction from a batch without executing either,
  resolve references inside a Bundle, and stream NDJSON a line at a time.

The [quickstart](./quickstart.md) is the shortest way to see the whole flow working.
