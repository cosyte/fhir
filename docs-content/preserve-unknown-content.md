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

If the write cannot be done without inventing or losing content, it is refused with a coded reason
instead. [Troubleshooting](./troubleshooting.md) lists the refusals and what each one means.

## Reference

- [`parseResource`](./api/README.md#parseresource) and
  [`serializeResource`](./api/README.md#serializeresource).
- [`validateResource`](./api/README.md#validateresource) and its `mode` option in
  [`ValidateOptions`](./api/README.md#validateoptions).
- [`SERIALIZE_ERROR_CODES`](./api/README.md#serialize_error_codes), every reason a write is refused.
