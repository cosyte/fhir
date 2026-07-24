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

:::note Status: pre-alpha, docs are a growing stub

`@cosyte/fhir` is **pre-alpha (`0.0.0`) and not yet published to npm.** It is **registered in the docs
site but disabled** until it cuts its first release: the same lifecycle the other parsers passed
through before they went live.

This page is a deliberately **minimal scaffold**. The full documentation spine (Installation,
Quickstart, Core Concepts, Guides, and Troubleshooting) is **not written yet**; it lands as the
parser stabilizes toward its first alpha, so the docs grow *with* the library rather than ahead of
it. Until then, the [repository README](https://github.com/cosyte/fhir#readme) and its
`CHANGELOG.md` are the authoritative, always-current account of what the parser does.

:::

## What exists today

The library is further along than this stub documents. As of the current pre-alpha it can already,
against **FHIR R4 (`4.0.1`)**:

- **Read and round-trip** a resource through a **precision-preserving JSON codec** and a
  **zero-dependency XML codec** that share one schema-free model: `decimal` / `integer64` values
  are kept as their exact lexical strings and are never routed through a JavaScript `number` (no
  silent dose or identifier corruption). The XML reader is **XXE- and billion-laughs-proof by
  refusal**: it rejects any `<!DOCTYPE` or non-predefined entity rather than resolving it.
- **Validate** a resource across structural, cardinality, and primitive/enumerated value-domain
  layers, emitting a **value-free `OperationOutcome`** (no PHI in diagnostics).
- Preserve the **safety-critical status & negation model**: it fails closed on an unknown
  `modifierExtension` and never drops a status, modifier, or negation.
- Surface measured values by their **true `value[x]` type** with **UCUM `code`** unit fidelity
  (never the display string, never converted), validate code `system`s and binding **strength**
  without vendoring any SNOMED / CPT / LOINC content, validate against **caller-supplied US Core /
  vendor `StructureDefinition`s** (snapshot generation, slicing, `fixed[x]` / `pattern[x]`,
  must-support as an obligation), and evaluate their FHIRPath **invariants** through a bounded,
  in-repo FHIRPath subset, reporting anything outside that subset as `INVARIANT_UNCHECKED` rather
  than passing it.

## What is not here yet

Honestly, and by design for a pre-alpha:

- **No published package**: it is not yet installable from npm, and the docs site keeps it disabled
  until the first release.
- **No bundled terminology or profile content**: there is no code-validity / value-set-membership
  guarantee beyond `system` + binding strength unless you supply a terminology service, and no US
  Core IG corpus is bundled (US Core / vendor profiles are caller-supplied).
- **No typed per-resource models**, no `type`·`profile` slicing-discriminator or reslicing
  validation (`PROFILE_SLICE_UNCHECKED`), and no `validator_cli.jar` differential yet.
- **No narrative or full-guide documentation**: see the status note above.

For the precise, phase-by-phase record of what has landed and what is deferred, read the
[repository README](https://github.com/cosyte/fhir#readme) and `CHANGELOG.md`. This page will be
expanded into the canonical documentation spine once the parser reaches that milestone.
