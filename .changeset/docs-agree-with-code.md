---
"@cosyte/fhir": patch
---

Corrected README, docs and doc comment statements that disagreed with the code.

The built-in structural schemas cover eight resource types, not `Patient` alone; an error `offset` is a string index in UTF-16 code units, not a byte offset; `type` and `profile` slicing discriminators are reported unchecked; and `resolvePath` returns a repeating last segment as its list node. No code, type or behaviour changes.
