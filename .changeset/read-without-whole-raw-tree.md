---
"@cosyte/fhir": patch
---

`parseResource` reading JSON text no longer holds the whole intermediate JSON tree in memory beside the model it builds. It checks the text first into a compact list of tokens kept outside the JavaScript heap, then makes the intermediate tree one part at a time as it builds, and lets each Bundle entry's part go once that entry is built. On a GitHub-hosted runner, the peak heap of one read of a 16,000-entry Bundle fell from about 168 MiB to 118 MiB (plus about 14 MiB of tokens outside the heap while the read runs), and a read of that Bundle cost 13% to 24% less time than before in the same run. Large Bundles still cost about twice as much per entry as small ones, because the model the read returns outgrows V8's young generation; the performance guide has the numbers. Every parse result, issue, warning, error and offset is the same as before, and `readRawJson` returns the same tree. No public API changes.
