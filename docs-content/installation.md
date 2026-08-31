---
id: installation
title: Installation
sidebar_position: 2
---

# Installation

## Requirements

- **Node `>=22.0.0`**, the range the package declares in its `engines` field. Older runtimes are not
  supported and are not tested against.
- **A package manager.** The repository uses **pnpm**, and the instructions below are written for it.
  npm and yarn work the same way.
- **TypeScript 5 or newer**, if you consume the types. The package ships its own declarations, so
  there is no separate types package to install.

## Availability

`@cosyte/fhir` is not installable from the public npm registry today. The package is pre-alpha, sits
on the `0.0.x` version line, and no release has reached the registry, so a plain install resolves
nothing:

```sh
pnpm add @cosyte/fhir   # this is the command once the package is published
```

Until then, build it from a checkout and depend on that:

```sh
git clone https://github.com/cosyte/fhir.git
cd fhir
pnpm install
pnpm build
```

Then, from your own project:

```sh
pnpm add file:../fhir
```

The built output is what the package publishes: an ESM bundle, a CommonJS bundle, and one
declaration file for each. `pnpm build` is required before the local dependency resolves, because
the repository tracks source, not build output.

## Module formats

The package is **ESM** first. Its `package.json` declares `"type": "module"`, and the ESM build is
what the `import` condition of its `exports` map resolves to:

```ts
import { parseResource } from "@cosyte/fhir";
```

A **CommonJS** build is published beside it, reached through the `require` condition of the same
`exports` map:

```js
const { parseResource } = require("@cosyte/fhir");
```

Types are shipped for both: a `.d.ts` for the ESM entry and a `.d.cts` for the CommonJS one, so a
project on either module system gets the same editor completions.

## The public surface is one entry point

The `exports` map offers exactly two paths: the package itself, and its `package.json`. There is no
supported deep import, so everything in this documentation is reached from a single specifier:

```ts
import { parseResource, readSafety, validateResource } from "@cosyte/fhir";
```

Reaching past that specifier into a build path is unsupported and will break without notice.

## Check the install

Put this in a file and run it. It reads a minimal resource and asserts nothing went wrong:

```ts
import { VERSION, parseResource } from "@cosyte/fhir";

typeof VERSION; // => "string"

const read = parseResource('{"resourceType":"Patient","id":"syn-0001"}');
read.resource.kind; // => "complex"
read.issues; // => []
```

If that runs clean, go to the [quickstart](./quickstart.md), which takes a real resource from an
unparsed document to a validation verdict.
