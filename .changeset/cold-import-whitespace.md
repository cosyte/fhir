---
"@cosyte/fhir": patch
---

The package imports faster. The published files leave out whitespace, so they are smaller and Node.js compiles them sooner, and the validator's tables (the element table of each modeled resource type, the base constraints, the patterns of the primitive types, and each validation code's issue type and diagnostic line) are made on the first validation that needs them rather than at import. Only whitespace goes: every function keeps its name, so a stack trace into the package still names its functions, at a column on one of a few long lines rather than on a line of its own. No source map is published. Exports, types, reads, validations and every finding are the same as before; nothing changes for a caller.
