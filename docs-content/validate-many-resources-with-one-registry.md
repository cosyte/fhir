---
id: validate-many-resources-with-one-registry
title: Validate many resources against one schema registry
sidebar_label: Validate with one registry
description: "Build the schema registry once with buildRegistry and pass it to every validateResource call, rather than merging the same schemas on each call."
---

# Validate many resources against one schema registry

A `validateResource` call given `schemas` merges them with the built-in schemas into a new registry
on every call. To validate many resources against the same schemas, build the registry once with
`buildRegistry` and pass it as `registry`. Every call then reads that one registry, and its findings
are the same as with `schemas`.

## Build the registry once

Build it where the schemas are made, and keep it for as long as the schemas do not change. Here the
schema is a made-up resource type with one required element:

```ts runnable
import { buildRegistry, parseResource, validateResource } from "@cosyte/fhir";

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

## Pass the registry, not the schemas

When a call passes both `registry` and `schemas`, the registry is used and `schemas` is not read.
Pass one or the other, so that a reader of the call sees which schemas it validates against.

## Change a built-in schema

The built-in schemas a registry returns are frozen and shared by every registry. To change one,
copy it and its `elements` with a spread, change the copy, and register the copy with
`buildRegistry`:

```ts runnable
import { buildRegistry, parseResource, validateResource } from "@cosyte/fhir";

const builtIn = buildRegistry()("Patient");
const registry = buildRegistry([
  {
    type: "Patient",
    elements: {
      ...builtIn?.elements,
      birthDate: { min: 1, max: 1, types: ["date"] },
    },
  },
]);

const { resource } = parseResource('{"resourceType":"Patient","id":"syn-0001"}');
validateResource(resource, { registry }).issues.map((issue) => issue.code); // => ["CARDINALITY_MIN"]
validateResource(resource).valid; // => true
```

## What it saves

It saves the merge on every call, and a little peak heap. What a call allocates is about the same
either way. The benchmark suite reads the two side by side on the vital-signs Observation, as
`validateResource with caller schemas each call` and `validateResource with a registry built once`;
[Performance](./performance.md#the-latest-readings) gives the latest readings.

## Reference

- [`buildRegistry`](./api/README.md#buildregistry) and the
  [`ResourceSchema`](./api/README.md#resourceschema) each schema is written as.
- [`validateResource`](./api/README.md#validateresource), and `registry`, `schemas` and `mode` in
  [`ValidateOptions`](./api/README.md#validateoptions).
- [Validate against your own profiles](./validate-against-profiles.md), for constraints a schema does
  not hold.
