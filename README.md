<a href="https://cosyte.com">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://cosyte.com/tile/cosyte-lockup-tile-on-dark-1200x300.png">
    <img alt="Cosyte: a plus mark set in two overlapping rounded squares, one solid and one outlined, beside the Cosyte wordmark" src="https://cosyte.com/tile/cosyte-lockup-tile-on-light-1200x300.png">
  </picture>
</a>

# @cosyte/fhir

> Read real-world FHIR R4, keep every value exactly as it was written, and validate it against your
> profiles.

[![npm version](https://img.shields.io/npm/v/@cosyte/fhir.svg)](https://www.npmjs.com/package/@cosyte/fhir)
[![CI](https://img.shields.io/github/actions/workflow/status/cosyte/fhir/ci.yml?branch=main&label=CI)](https://github.com/cosyte/fhir/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](https://nodejs.org)

FHIR R4 for Node.js and TypeScript: a resource model that keeps every value exactly as written, JSON and XML codecs, layered validation, and a safety readout for status and negation.

## Why this exists

Reading FHIR correctly takes more than a JSON parse: a `decimal` written `0.010` has to stay
`0.010`, an `integer64` has to keep every digit, and a status, a modifier or a negation must never be
skipped, because a missed `refuted` reads as its opposite. We built `@cosyte/fhir` for the engineer
who reads FHIR R4 from a server or an EHR (the format ONC HTI-1 binds §170.315(g)(10) to, with US
Core and SMART on FHIR) and has to get those values right without reading the specification first.
Type definitions alone describe a resource's shape and check nothing at run time, and `JSON.parse`
turns `0.010` into the number `0.01` and knows nothing about modifiers. This library reads, writes
and validates FHIR R4 with zero runtime dependencies, and tells you with a coded reason what it could
not read safely.

## Status

**The 0.1 line.** From 0.1 the public API is settled: the exported names, options, result shapes and
issue codes are the surface we keep stable. While the package is below 1.0, a breaking change ships
in a minor version and is called out in the
[changelog](https://github.com/cosyte/fhir/blob/main/CHANGELOG.md). Upgrading from 0.0.10 changes
verdicts: R4's own constraints are now evaluated with no profile supplied, so a document that read
valid can read invalid. The changelog sets out each change.

What it covers, against FHIR R4 (`4.0.1`): reading and writing JSON and XML into one immutable
model; validation in layers (structure, cardinality, value domains, R4's own constraints on the
eight modeled resource types, Quantity and UCUM, binding strength, and profiles you supply or author
with `defineProfile`, including their FHIRPath invariants); the `readSafety` and
`assertSafeToSummarize` safety readout; and Bundles, references and streaming Bulk Data NDJSON. R5
and DSTU2 documents can be read, since the model is schema-free, but they are not validated against
their own definitions.

Not covered yet: typed per-resource models (the built-in structural schemas cover the base elements
plus `Patient`), `type` and `profile` slicing discriminators and reslicing (reported
`PROFILE_SLICE_UNCHECKED`), FHIRPath outside the supported subset (reported `INVARIANT_UNCHECKED`,
never passed), bundled terminology or US Core content, spec-clean JSON written from a model read out
of XML, unit conversion, and executing a transaction Bundle.

## Install

```bash
# pnpm (recommended). Also works with: npm install @cosyte/fhir  |  yarn add @cosyte/fhir
pnpm add @cosyte/fhir
```

Requires Node `>=22.0.0`. The package ships dual ESM and CommonJS builds with type declarations for
both, so `import` and `require` both work and neither needs a compatibility shim. There are zero
runtime dependencies, and it imports no Node built-in.

## Usage

Read a document, keep its exact values, and get a verdict. The Observation below is synthetic: every
value in it is fabricated, and the same document is committed as a test fixture in this repository.

```ts runnable
import { parseResource, readObservationValue, validateResource } from "@cosyte/fhir";

const document = `{
  "resourceType": "Observation",
  "id": "syn-0001",
  "status": "final",
  "code": { "coding": [{ "system": "http://loinc.org", "code": "8480-6" }] },
  "subject": { "reference": "Patient/syn-0001" },
  "effectiveDateTime": "2026-01-05",
  "valueQuantity": {
    "value": 120.0,
    "unit": "mmHg",
    "system": "http://unitsofmeasure.org",
    "code": "mm[Hg]"
  }
}`;

const { resource, issues } = parseResource(document);

// The magnitude was written 120.0: the read keeps that exact form and says the protection mattered.
issues.map((issue) => issue.code); // => ["DECIMAL_PRECISION_AT_RISK"]

// Branch on the value[x] type before touching a magnitude, and compare on the UCUM code.
const reading = readObservationValue(resource);
reading?.type; // => "Quantity"
reading?.quantity?.value?.raw; // => "120.0"
reading?.quantity?.code; // => "mm[Hg]"

validateResource(resource).valid; // => true
```

The quickstart on [docs.cosyte.com/fhir](https://docs.cosyte.com/fhir) walks the same document step
by step, and [`examples/`](https://github.com/cosyte/fhir/tree/main/examples) holds four runnable
programs: read and validate, the safety readout, JSON and XML, and Bundles with Bulk Data NDJSON.

## API

Everything ships from one entry point; there are no subpath imports.

- **Read and write.** `parseResource` and `serializeResource` for JSON, `parseResourceXml` and
  `serializeResourceXml` for XML, over one schema-free model, and `nodesEquivalent` to compare a
  model read from one format with a model read from the other. A `decimal` or an `integer64` keeps
  its exact text (`FhirDecimal`, `FhirInteger64`) and never passes through a JavaScript number.
- **Validate.** `validateResource` returns `valid`, the issues, and `toOperationOutcome()` to render
  them as an `OperationOutcome`. Pass the `profiles` you load with `loadStructureDefinition` or
  author with `defineProfile`, and a `terminology` service of your own for code validity.
- **Read status and negation.** `readSafety` surfaces status, modifiers and negations.
  `assertSafeToSummarize` throws `FhirSafetyError`, carrying locations only, when a resource holds
  something it cannot summarize honestly, such as a `modifierExtension` it does not understand.
- **Read measured values.** `readObservationValue` branches on the `value[x]` type and keeps the
  UCUM `code`, and `readMedicationDoses` reads dose quantities. No unit is ever converted.
- **Bundles and NDJSON.** `readBundle` tells a transaction (all or nothing) from a batch and
  executes neither, `resolveReference` resolves relative, absolute, logical and `#fragment`
  references, and `streamNdjson` reads a Bulk Data export line by line, reporting a malformed line
  and carrying on.

## PHI and safety

FHIR resources carry protected health information, so treat every document you hand this library
as PHI.

- **It works in memory.** It reads, validates and writes in memory and nothing else. It opens no
  socket, writes nothing to disk and fetches nothing at run time; it has zero runtime dependencies,
  imports no Node built-in, and calls no terminology service unless you pass one in.
- **Diagnostics carry no values.** An issue is a code and a FHIRPath location, never the value it
  was raised over. A location can repeat an element name the document supplied when that name has
  the published form of a FHIR name, so treat a location as derived from the document.
- **The XML reader accepts plain XML only.** Anything else is refused with a typed `FhirXmlError`
  that carries a code and a byte offset, never a slice of the document. The reader performs no I/O
  and resolves no URI. The troubleshooting pages on
  [docs.cosyte.com/fhir](https://docs.cosyte.com/fhir) list each refusal and its code.
- **Nesting is bounded.** Both readers stop at a fixed depth with a typed error, so a deeply nested
  document fails cleanly rather than exhausting the stack.
- **A status or a negation is not skipped silently.** `assertSafeToSummarize` refuses a resource
  carrying a `modifierExtension` it does not understand, and each other shape it cannot summarize
  honestly, rather than letting a summary walk past it.
- **What you still own.** Transport, storage, retention, access control, audit logging, and every
  log line your own code writes. This library makes no compliance claim on your behalf.

## Documentation

- [docs.cosyte.com/fhir](https://docs.cosyte.com/fhir): installation, the quickstart, core
  concepts, guides, current limits and troubleshooting.
- [`documentation/capabilities.md`](https://github.com/cosyte/fhir/blob/main/documentation/capabilities.md):
  the full capability readout, layer by layer, with what each one checks and what it leaves open.
- [`documentation/`](https://github.com/cosyte/fhir/tree/main/documentation) in the repository: the
  capability readout, the FHIRPath coverage measured against the shared R4 conformance suite, and
  the architecture decisions.
- [`CHANGELOG.md`](https://github.com/cosyte/fhir/blob/main/CHANGELOG.md): every change, with the
  breaking ones called out.

## Contributing

Questions, bug reports and FHIR quirks from the servers and EHRs you connect to all belong in
[GitHub issues](https://github.com/cosyte/fhir/issues). Pull requests are welcome; every fixture
must be synthetic, never a real patient's data.

```bash
pnpm install
pnpm build       # dual ESM + CJS + .d.ts
pnpm typecheck
pnpm lint
pnpm test
```

Every meaningful change gets a Changeset (`pnpm changeset`: `minor` for new capability or a breaking
change while the version is below 1.0, `patch` for a fix) and a `CHANGELOG.md` `[Unreleased]`
entry. See [`CONTRIBUTING.md`](https://github.com/cosyte/fhir/blob/main/CONTRIBUTING.md).

## License

MIT, copyright Cosyte. See [LICENSE](./LICENSE).
