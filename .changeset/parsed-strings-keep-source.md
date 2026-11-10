---
"@cosyte/fhir": patch
---

Documented that a parsed resource can keep the parsed text in memory while it lives, because strings of 13 or more characters are slices of the input. Copy what you keep, for example with `structuredClone` or a JSON round trip of the resource, or let the parsed result go. The `parseResource` documentation and the performance page say so; no behavior changes.
