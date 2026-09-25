---
"@cosyte/fhir": minor
---

**This is 0.1.0, the first release of `@cosyte/fhir` whose public API we treat as settled.**

What is covered, and what you can build against:

- Reading and writing FHIR R4 (4.0.1) JSON into an immutable model that keeps every `decimal` and
  `integer64` exactly as written, never through a JavaScript number, with diagnostics that carry a
  code and a location and never a value.
- An XML codec that reads and writes the same model and refuses any DTD, and any entity beyond
  XML's five predefined ones, instead of resolving it, plus `nodesEquivalent` to compare a JSON read
  with an XML read.
- Validation in layers: structure, cardinality, primitive and required-code value domains, the
  constraints R4 itself declares on the eight modeled resource types, Quantity and UCUM checks,
  binding strength against a registry of known code systems, and profiles you supply as
  `StructureDefinition`s or author in code with `defineProfile`, including their FHIRPath
  invariants.
- The safety readout: `readSafety` and `assertSafeToSummarize` surface every status, negation,
  modifier element and unknown `modifierExtension` that changes what a record means, and refuse a
  summary when something in the document cannot be read.
- Bundles, references and Bulk Data NDJSON: `transaction` read as all-or-nothing and `batch` as
  independent, reference resolution with a bounded cycle guard, and a streaming NDJSON reader that
  isolates a malformed line by its number.

What the version promises. The exported names, options, result shapes and issue codes are the
surface we keep stable. While the package is below 1.0, a breaking change bumps the minor version
(0.1 to 0.2) and is called out in the changelog; new capability also ships in a minor, and a fix
that changes no public observable ships as a patch. Upgrading from 0.0.10, the last version on npm,
changes verdicts: `validateResource` now evaluates R4's own constraints with no profile supplied, so
a document that read valid can read invalid, and a `use` outside its R4 value set on an identifier,
name, address or contact point now stops a summary. The entries below say what moved.

What is not covered yet. There are no typed per-resource models, and the built-in structural schemas
cover the base elements plus `Patient`. `type` and `profile` slicing discriminators and reslicing are
reported `PROFILE_SLICE_UNCHECKED`, and a FHIRPath expression outside the supported subset is
reported `INVARIANT_UNCHECKED`, never passed. No terminology content (SNOMED CT, LOINC, RxNorm) and no
US Core profiles are bundled, so value-set membership needs a terminology service you supply. A
model read from XML keeps each primitive as its lexical string, so writing it out as spec-clean JSON
is not done yet. R5 and DSTU2 are read-tolerant only, no unit is ever converted, and a transaction
Bundle is modeled, never executed.
