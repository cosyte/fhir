---
"@cosyte/fhir": patch
---

`parseResource`, `validateResource` and `serializeResource` allocate far less and run faster, with every result unchanged. The JSON reader takes a string between escapes in one slice instead of a character at a time, so a resource carrying a large base64 attachment no longer costs many times its size to read: a 4 MiB PDF in a DiagnosticReport reads about 25 times faster. The reader also builds each object without the maps and sets it made before. The validator walks the safety channels once per call instead of once per channel, decides `ele-1` and `ext-1` directly rather than through the FHIRPath engine at every element, and checks a location's names without a regular expression; validating a vital-signs Observation allocates about a third of what it did. `serializeResource` no longer runs the whole safety walk to find a repeated property name. Every parse result, issue, warning, error and written output is the same as before.
