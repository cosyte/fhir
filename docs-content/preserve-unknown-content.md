---
id: preserve-unknown-content
title: Keep what you cannot interpret
sidebar_label: Keep unknown content
description: "Read a resource you do not fully understand without losing anything: unknown elements are kept and reported, and a write that would lose content is refused."
---

# Keep what you cannot interpret

A read is lenient and a write is conservative, which together give a useful property: a document you
do not fully understand still round-trips. An element the reader did not expect is preserved and
reported rather than dropped:

```ts runnable
import { parseResource, serializeResource, validateResource } from "@cosyte/fhir";

const source =
  '{"resourceType":"Observation","status":"final","code":{"text":"synthetic"},"vendorField":"kept"}';
const { resource } = parseResource(source);

validateResource(resource).issues.map((issue) => issue.code); // => ["UNKNOWN_ELEMENT"]
serializeResource(resource) === source; // => true
```

`UNKNOWN_ELEMENT` is a warning on a lenient read and an error in strict mode, which is the mode to
use when you are the one emitting a document rather than the one receiving it.

An array that mixes objects with strings, numbers or `null`s is kept the same way, whichever member
comes first. Each object is read as an element with all its members, each member the element cannot
hold is reported at its own position and kept as written, and the write hands every member back:

```ts runnable
import { parseResource, serializeResource } from "@cosyte/fhir";

const mixed =
  '{"resourceType":"Patient","extension":["x",{"url":"http://example.com/syn-ext","valueString":"syn"}]}';
const { resource, issues } = parseResource(mixed);

issues.map((issue) => issue.expression); // => ["Patient.extension[0]"]
serializeResource(resource) === mixed; // => true
```

If the write cannot be done without inventing or losing content, it is refused with a coded reason
instead. [Troubleshooting](./troubleshooting.md) lists the refusals and what each one means.

## Reference

- [`parseResource`](./api/@cosyte/fhir.md#parseresource) and
  [`serializeResource`](./api/@cosyte/fhir.md#serializeresource).
- [`validateResource`](./api/@cosyte/fhir.md#validateresource) and its `mode` option in
  [`ValidateOptions`](./api/@cosyte/fhir.md#validateoptions).
- [`SERIALIZE_ERROR_CODES`](./api/@cosyte/fhir.md#serialize_error_codes), every reason a write is refused.
