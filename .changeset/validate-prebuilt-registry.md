---
"@cosyte/fhir": patch
---

`validateResource` takes a prebuilt schema registry as a new `registry` option. A call given `schemas` merges them with the built-in schemas into a new registry every time; build the registry once with `buildRegistry(schemas)` and pass it as `registry` to every call instead, with the same findings. When a call passes both, the registry is used and `schemas` is not read. `buildRegistry` itself now shares the built-in schemas, base elements merged in, across every registry it builds rather than merging them again each time, and those shared schemas are frozen. A caller that passes `schemas` needs no change; to stop the per-call build, replace `{ schemas }` with `{ registry }` where the registry is built once.
