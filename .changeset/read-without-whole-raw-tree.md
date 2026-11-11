---
"@cosyte/fhir": patch
---

`parseResource` reading JSON text no longer holds the whole intermediate JSON tree in memory beside the model it builds. It checks the text first into a compact list of tokens kept outside the JavaScript heap, then makes the intermediate tree one part at a time as it builds, and lets each Bundle entry's part go once that entry is built. Every parse result, issue, warning, error and offset is the same as before, and `readRawJson` returns the same tree. No public API changes.
