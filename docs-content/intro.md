---
id: intro
title: Getting started
sidebar_position: 1
---

# @cosyte/fhir

A developer-focused **FHIR** toolkit for Node.js and TypeScript: an **R4-first** resource model, a
JSON **and** XML codec, and layered validation, with the same one-line ergonomics as the rest of the
`@cosyte/*` parser suite. It is the FHIR member of that suite and mirrors the API shape of
[`@cosyte/hl7`](https://github.com/cosyte/hl7), the reference parser.

What it is for, in one sentence: read a real-world FHIR resource, model it with correct primitive
semantics, and validate it against US Core, without reading the FHIR specification first.

## Status

`@cosyte/fhir` is pre-alpha and sits on the `0.0.x` version line. It is not installable from npm
today, and [installation](./installation.md) covers the route that does work. What the package does
not do is listed in [current limits](./limits.md), which is worth reading before you plan around it.

## Start here

- **[Installation](./installation.md)**: runtime requirements, module formats, and how to get the
  package today.
- **[Quickstart](./quickstart.md)**: an unparsed document to a parsed resource, a clinical value and
  a validation verdict, in four steps.
- **[Core concepts](./core-concepts.md)**: the schema-free model, exact primitives, the two codecs
  and the validation layers.
- **[Guides](./guides.md)**: the tasks readers arrive with, from accepting both wire formats to
  validating against your own profiles.
- **[Current limits](./limits.md)**: the deliberate boundaries, including what is checked and what
  is only reported as unchecked.
- **[Troubleshooting](./troubleshooting.md)**: every refusal and degraded reading, with the coded
  reason it carries and the action to take.

## What it does

Against FHIR R4 (`4.0.1`), the package can already:

- **Read and round-trip** a resource through a precision-preserving JSON codec and a
  zero-dependency XML codec that share one schema-free model. A `decimal` or `integer64` value is
  kept as its exact lexical text and never routed through a JavaScript number, so a dose or an
  identifier cannot be silently corrupted. The XML reader refuses any `DOCTYPE` or non-predefined
  entity rather than resolving it.
- **Validate** across structural, cardinality and value-domain layers, emitting a value-free
  `OperationOutcome`: a finding carries a coded reason and a location, never the value it was raised
  over.
- **Surface the safety-critical status and negation model**: it fails closed on an unknown
  `modifierExtension` and does not drop a status, a modifier or a negation on the paths it reads.
- **Report measured values by their true type** with UCUM unit fidelity, never the display string
  and never converted, validate code systems and binding strength without vendoring any terminology
  content, validate against caller-supplied US Core or vendor profiles, and evaluate their FHIRPath
  invariants through a bounded, in-repository expression subset, reporting anything outside that
  subset as `INVARIANT_UNCHECKED` rather than passing it.

Every one of those has a page behind it. The [quickstart](./quickstart.md) is the shortest way to
see the whole flow working.
