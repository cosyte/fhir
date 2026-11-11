---
id: read-bundles-and-references
title: Read Bundles and resolve references
sidebar_label: Read Bundles and references
description: "Tell a transaction from a batch without executing either, read a Bundle's entries, and resolve the references inside a Bundle or a contained set."
---

# Read Bundles and resolve references

A `Bundle` is read like any other resource, with `parseResource` or `parseResourceXml`. These
helpers read what the Bundle says about its entries and resolve the references between them. None
of them executes anything: a transaction is described, never applied.

## Tell a transaction from a batch

`readBundle` reports the Bundle's `type`, the processing that type implies, and one entry per
`Bundle.entry`. `atomic` is `true` only for a `transaction`, whose entries succeed or fail together;
a `batch` is `independent`, each entry on its own:

```ts runnable
import { parseResource, readBundle } from "@cosyte/fhir";

const transaction = readBundle(
  parseResource(
    '{"resourceType":"Bundle","type":"transaction","entry":[{"fullUrl":"urn:uuid:a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5","resource":{"resourceType":"Patient","id":"syn-0001"},"request":{"method":"POST","url":"Patient"}}]}',
  ).resource,
);

transaction.atomic; // => true
transaction.processing; // => "atomic"
transaction.entries.map((entry) => [entry.resourceType, entry.requestMethod, entry.requestUrl]); // => [["Patient", "POST", "Patient"]]

const batch = readBundle(parseResource('{"resourceType":"Bundle","type":"batch"}').resource);

batch.atomic; // => false
batch.processing; // => "independent"
```

A Bundle with no `type`, or an entry missing its parts, still reads: the missing values come back
`undefined` rather than throwing, so the shape of what arrived is visible.

## Resolve a reference inside a Bundle

`buildBundleIndex` keys every entry by its `fullUrl` and, where it can be derived, by `Type/id`, so a
relative, absolute or logical reference can find it. `resolveReference` then answers one of three
ways:

- `resolved`, with the `target` resource, when the reference names an entry in the Bundle;
- `unresolved`, when a relative reference names a resource the Bundle does not carry;
- `external`, when an absolute reference points outside the Bundle, which is not a defect.

```ts runnable
import { buildBundleIndex, parseResource, resolveReference } from "@cosyte/fhir";

const { resource } = parseResource(
  '{"resourceType":"Bundle","type":"collection","entry":[{"fullUrl":"https://fhir.example.org/Patient/syn-0001","resource":{"resourceType":"Patient","id":"syn-0001","managingOrganization":{"reference":"Organization/syn-org-1"}}}]}',
);

const index = buildBundleIndex(resource);

resolveReference("Patient/syn-0001", { bundle: index }).status; // => "resolved"
resolveReference("https://fhir.example.org/Patient/syn-0001", { bundle: index }).status; // => "resolved"
resolveReference("Organization/syn-org-1", { bundle: index }).status; // => "unresolved"
resolveReference("https://other.example.org/fhir/Patient/9", { bundle: index }).status; // => "external"
```

`validateResource` reports the same unresolved reference on the Bundle, by location and never by
value, at warning severity:

```ts runnable
import { parseResource, validateResource } from "@cosyte/fhir";

const { resource } = parseResource(
  '{"resourceType":"Bundle","type":"collection","entry":[{"fullUrl":"https://fhir.example.org/Patient/syn-0001","resource":{"resourceType":"Patient","id":"syn-0001","managingOrganization":{"reference":"Organization/syn-org-1"}}}]}',
);

const unresolved = validateResource(resource).issues.filter(
  (issue) => issue.code === "REFERENCE_UNRESOLVED",
);

unresolved.map((issue) => [issue.severity, issue.expression]); // => [["warning", "Bundle.entry[0].resource.managingOrganization.reference"]]
```

## Resolve a reference to a contained resource

A `#fragment` reference resolves only among the resource's own `contained` resources. Index them with
`containedIndex` and pass that instead of a Bundle index:

```ts runnable
import { containedIndex, parseResource, resolveReference } from "@cosyte/fhir";

const { resource } = parseResource(
  '{"resourceType":"Observation","status":"final","code":{"text":"synthetic"},"contained":[{"resourceType":"Patient","id":"p1"}],"subject":{"reference":"#p1"}}',
);

const contained = containedIndex(resource);

resolveReference("#p1", { contained }).status; // => "resolved"
resolveReference("#p2", { contained }).status; // => "unresolved"
```

## Reference

- [`readBundle`](./api/@cosyte/fhir.md#readbundle), [`BundleReadout`](./api/@cosyte/fhir.md#bundlereadout) and
  [`BundleEntry`](./api/@cosyte/fhir.md#bundleentry).
- [`buildBundleIndex`](./api/@cosyte/fhir.md#buildbundleindex),
  [`containedIndex`](./api/@cosyte/fhir.md#containedindex) and
  [`resolveReference`](./api/@cosyte/fhir.md#resolvereference), which returns a
  [`ReferenceResolution`](./api/@cosyte/fhir.md#referenceresolution).
- [`parseReference`](./api/@cosyte/fhir.md#parsereference), to split a reference string into its parts.
- [Stream a Bulk Data export](./stream-ndjson-exports.md) for NDJSON, the other way FHIR moves many
  resources at once.
