<a href="https://cosyte.com">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://cosyte.com/tile/cosyte-lockup-tile-on-dark-1200x300.png">
    <img alt="The Cosyte logo on its own white ground: the icon beside the word Cosyte." src="https://cosyte.com/tile/cosyte-lockup-tile-on-light-1200x300.png">
  </picture>
</a>

# @cosyte/fhir

> Read, validate and write FHIR R4 without losing a dose, a status or a retraction.

[![npm version](https://img.shields.io/npm/v/%40cosyte%2Ffhir.svg)](https://www.npmjs.com/package/@cosyte/fhir)
[![CI](https://github.com/cosyte/fhir/actions/workflows/ci.yml/badge.svg)](https://github.com/cosyte/fhir/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/cosyte/fhir/blob/main/LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org/en/download)

Developer-focused FHIR toolkit for Node.js and TypeScript, R4-first resource model, JSON and XML codec, and layered validation. Pre-alpha.

- [Why this exists](#why-this-exists)
- [Status](#status)
- [Install](#install)
- [Usage](#usage)
- [PHI and safety](#phi-and-safety)
- [API](#api)
- [Compatibility](#compatibility)
- [Contributing](#contributing)
- [License](#license)

## Why this exists

A team wiring an EHR or a FHIR server into a TypeScript service normally reaches for `JSON.parse`, and then finds out what it costs: a dose of `0.010` comes back as `0.01`, a repeated property quietly replaces the value it shadows, and a resource the sender marked `entered-in-error` reads exactly like one that is still true. This library removes that whole class of bug by keeping every primitive as the exact text the sender wrote, never routing a `decimal` or an `integer64` through a JavaScript number, and surfacing the status and negation elements as a first-class read rather than leaving them for a caller to remember. The nearest alternative is the official HL7 reference validator, a Java command line tool that this project runs as its own correctness oracle. It is authoritative and it is the wrong shape for a request path: it grades documents and hands back a report, where this hands back a model you can work with.

## Status

**Version 0.1.0.** The public API is settled and safe to depend on: the exports listed under [API](#api) are the contract, and a breaking change to any of them takes a major version.

Named rather than left to be discovered, these surfaces are still moving:

- **The read path does not yet guarantee that nothing is dropped.** A small, enumerated set of non-conformant encodings is still read lossily. The worth-knowing case: a status or a dose written as XML element text instead of as a `value` attribute is not read as a value. It is dropped, a diagnostic says so, and serializing that model back out is refused rather than emitting a document with the value silently missing, but the safety read reports no negation for it. Each open case is held by a test, so none of them can move without notice.
- **The package is not available from the public npm registry.** [Install](#install) has the route that works today.
- **No terminology or profile content is bundled.** Code validity beyond the `system` URI and the binding strength needs a terminology service you supply, and US Core or vendor profiles are caller-supplied. Neither degrades into a false error when it is absent, but neither is a guarantee this package makes on its own.
- **There are no typed per-resource models.** The model is schema-free and the same shape for every resource type, which is what lets it round-trip a document it does not recognise.

## Install

`@cosyte/fhir` is **not yet available from the public npm registry.** The command below is the one to use once it is published, and it will not resolve before then:

```sh
npm install @cosyte/fhir
```

The route that works today is to build from source and install the tarball:

```sh
git clone https://github.com/cosyte/fhir.git
cd fhir
pnpm install
pnpm build
npm pack
```

`npm pack` writes a tarball into the current directory. Install that path in your own project (`npm install ../fhir/cosyte-fhir-<version>.tgz`), or use `pnpm link` against the built checkout.

- **Node `>=22.0.0`.** Older runtimes are not supported.
- **Dual ESM and CJS.** Both `import` and `require` resolve, each against its own type declarations.
- **No runtime dependencies.** Nothing is installed alongside it.

## Usage

Read a resource, keep its precision, and see what the safety layer makes of it:

```ts
import { getProperty, parseResource, readQuantity, readSafety } from "@cosyte/fhir";

const { resource, issues } = parseResource(`{
  "resourceType": "Observation",
  "id": "example",
  "status": "entered-in-error",
  "code": { "coding": [{ "system": "http://loinc.org", "code": "718-7" }] },
  "valueQuantity": { "value": 0.010, "unit": "g/L", "system": "http://unitsofmeasure.org", "code": "g/L" }
}`);

// The magnitude keeps the exact lexical form the sender wrote. No JavaScript number is
// involved, so the trailing zero that carries the reported precision is still there.
const quantity = readQuantity(getProperty(resource, "valueQuantity"));
console.log(quantity?.value?.toString(), quantity?.code);
// 0.010 g/L

// Findings are coded and located, never a copy of the value they were raised over.
console.log(issues.map((issue) => issue.code));
// [ 'DECIMAL_PRECISION_AT_RISK' ]

// The retraction is surfaced rather than summarised away.
const safety = readSafety(resource);
console.log(safety.retracted, safety.negations);
// true [ 'entered-in-error' ]
```

## PHI and safety

FHIR resources carry patient data by design, so this library is built to touch as little of it as it can.

- **It does not log.** The library makes no `console` call and takes no logger. Nothing a resource contains is written to any stream by this package.
- **It does not retain.** Reading returns a model and holds no global state, no cache and no registry keyed on anything a document said. Drop the model and the data is gone with it.
- **It does not write to disk, and it opens nothing.** There is no file, network or URI access on any path. The XML reader in particular resolves no external reference: a document that asks it to is refused rather than expanded, so a resource can never pull in something you did not hand it.
- **A diagnostic carries a coded reason and a location, and never the value it was raised over.** A finding is an issue code plus a FHIRPath expression, which makes it safe to log, to paste into a support ticket and to render in a user interface. The location can name an element the document named, bounded to the published form of a FHIR name; anything not shaped like one prints as the `WITHHELD` marker instead of being echoed.

What you still own:

- **Your own logs.** If you print a resource, or a value you read out of one, that is your log line and nothing here can redact it for you.
- **De-identification.** Nothing here de-identifies anything. A resource in is a resource out, complete.
- **Transport and storage.** Where the bytes go once you have them is your system's problem, not this library's.
- **Your fixtures.** Every value in the examples above is synthetic and drawn from this repository's own test data.

## API

[`src/index.ts`](https://github.com/cosyte/fhir/blob/main/src/index.ts) is the single entry point and the full list. The functions most callers start from:

- Codec: `parseResource`, `serializeResource`, `parseResourceXml`, `serializeResourceXml`, `nodesEquivalent`
- Model: `getProperty`, `getAllProperties`, `isComplex`, `isPrimitive`, `isList`, `resourceType`, `decimal`, `integer64`, `parseReference`
- Validation: `validateResource`, `toOperationOutcome`
- Status and negation: `readSafety`, `assertSafeToSummarize`
- Quantities and units: `readQuantity`, `readObservationValue`, `validateUcumShape`
- Profiles and invariants: `loadStructureDefinition`, `defineProfile`, `generateSnapshot`, `collectProfileIssues`, `evaluateInvariant`
- Bundles and streaming: `readBundle`, `resolveReference`, `streamNdjson`

Every export carries a documented example in its type declarations, so an editor shows the call shape on hover.

## Compatibility

- **FHIR R4 (`4.0.1`) is the modeled target.** R5 and DSTU2 documents are read tolerantly into the same model, but validation is against R4 and nothing else.
- **JSON and XML, with one model behind both.** A resource read from either format produces the same tree, and `nodesEquivalent` compares the two directly.
- **All five R4 slicing discriminators** (`value`, `exists`, `pattern`, `type`, `profile`) are evaluated. The R5 `position` discriminator is not, and an unsupported or insufficient discriminator is reported as unchecked rather than passed.
- **A bounded FHIRPath subset** evaluates profile invariants. An expression outside that subset is reported as unchecked, never assumed to hold.

Known gaps, stated rather than implied:

- No bundled terminology content, and no bundled US Core or vendor profiles.
- No typed per-resource model classes.
- A vendor quirk is handled only where a real published artifact grounds it, so an undocumented proprietary deviation is not covered.

## Contributing

Pull requests are accepted. Ask a question or report a quirk on the [issue tracker](https://github.com/cosyte/fhir/issues), and read [CONTRIBUTING.md](https://github.com/cosyte/fhir/blob/main/CONTRIBUTING.md) before opening one.

A contribution clears the same gates every commit does: `pnpm typecheck`, `pnpm lint` at zero warnings, `pnpm test` with per-directory coverage at 90 percent or better, `pnpm build`, and the brand and PHI gates. Reduce a bug to the smallest resource that reproduces it, and use synthetic identifiers only: this repository is public and its fixtures ship inside it.

## License

MIT, Copyright (c) 2026 Cosyte. Full text in [LICENSE](https://github.com/cosyte/fhir/blob/main/LICENSE).
