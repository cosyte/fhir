---
"@cosyte/fhir": patch
---

The comparison against the reference FHIR validator now covers US Core's own constraints on real
documents. Published US Core 6.1.0 and 9.0.0 example documents are validated by this package against
exactly the US Core profiles each one declares, and by `validator_cli` with the same US Core version
loaded, and the run fails on any document this package reports clean that the reference validator
errors on, or the reverse. Over the 34 examples it compares today (19 from 9.0.0, 15 from 6.1.0) the
two agree on every one. No library code changed: the package's own validation behaviour is
unchanged, and nothing here ships in the published artifact.

- For each constraint the FHIRPath subset newly decides, the run prints how many compared documents
  reach it, or that none does and why, so a constraint no real document exercised is never read as
  agreement. A document on which this package could only report a constraint unchecked is printed
  as such and not counted as agreement either. US Core 9.0.0's UCUM rule (`us-core-3` over a
  `valueQuantity`) is decided on seven of the compared documents, and a run in which no compared
  document exercises it fails.
- The examples and the packages they come from are downloaded and checked against a recorded byte
  count and SHA-256 at run time. None of their content is part of this package or its repository.

Limits, in the same place as the capability:

- A profile constraint on a slice, such as US Core's identifier-format rules `us-core-16` to
  `us-core-19` and `us-core-27`, is still not evaluated by `validateResource`, so the comparison
  reports those constraints as not reached rather than as agreement.
- A constraint on a primitive occurrence is still not evaluated by `validateResource`: `us-core-1`
  on an `effectiveDateTime`, and `us-core-3` on a `valueString`, draw no finding. The comparison
  prints such a document as not evaluated for that constraint and does not count it as agreement.
