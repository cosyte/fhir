---
id: installation
title: Installation
sidebar_label: Installation
description: Install @cosyte/fhir from npm, with its Node.js and TypeScript requirements and its ESM and CommonJS entry points.
---

# Installation

## Requirements

- **Node.js 22 or later, tested on 22, 24, and 26.** The package declares `>=22.0.0` in its `engines`
  field. Older runtimes are not supported and are not tested against.
- **A package manager.** The repository uses **pnpm**, and the instructions below are written for it.
  npm and yarn work the same way.
- **TypeScript 5 or newer**, if you consume the types. The package ships its own declarations, so
  there is no separate types package to install.

## Availability

`@cosyte/fhir` is installable from the public npm registry today:

```sh
pnpm add @cosyte/fhir
```

npm and yarn work the same way: `npm install @cosyte/fhir` or `yarn add @cosyte/fhir`. While the
package is below 1.0, every release is a patch version, a breaking change included, and the
changelog entry for a breaking change says what changed and what a caller must do. A caret or
tilde range such as `^0.1.0` or `~0.1.0` can therefore take a breaking change: pin an exact version
and read the changelog before you move it.

To build it from source instead, clone the repository and depend on the checkout:

```sh
git clone https://github.com/cosyte/fhir
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

```ts runnable
import { parseResource } from "@cosyte/fhir";
```

A **CommonJS** build is published beside it, reached through the `require` condition of the same
`exports` map:

```js no-run the samples run as ES modules where require is not defined
const { parseResource } = require("@cosyte/fhir");
```

Types are shipped for both: a `.d.ts` for the ESM entry and a `.d.cts` for the CommonJS one, so a
project on either module system gets the same editor completions.

## The public surface is two entry points

The `exports` map offers exactly three paths: the package itself, `@cosyte/fhir/arbitraries`, and
the package's `package.json`. Everything in this documentation but one guide is reached from the
package itself:

```ts runnable
import { parseResource, readSafety, validateResource } from "@cosyte/fhir";
```

`@cosyte/fhir/arbitraries` holds the fast-check generators for
[property-testing your own code](./property-test-your-code.md). It needs `fast-check` installed
beside it, and the main entry point never loads it, so a project that does not import it does not
need `fast-check`.

There is no other supported deep import. Reaching past these specifiers into a build path is
unsupported and will break without notice.

## Check the install

Put this in a file and run it. It reads a minimal resource and asserts nothing went wrong:

```ts runnable
import { VERSION, parseResource } from "@cosyte/fhir";

typeof VERSION; // => "string"

const read = parseResource('{"resourceType":"Patient","id":"syn-0001"}');
read.resource.kind; // => "complex"
read.issues; // => []
```

If that runs clean, go to the [quickstart](./quickstart.md), which takes a resource from an
unparsed document to a validation verdict.
