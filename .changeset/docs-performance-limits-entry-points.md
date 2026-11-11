---
"@cosyte/fhir": patch
---

The documentation now matches the package. The README and the installation page name both entry points, `@cosyte/fhir` and `@cosyte/fhir/arbitraries`, where they said there was one. The README's "Not covered yet" and the "Current limits" page list the same gaps, and both say how an R4B document reads and validates today: as R4, with a type R4B added reported `RESOURCE_NOT_MODELED`. The performance page describes the benchmarks, the budgets, the scaling and cold import gates and how to run them, with the latest readings from a GitHub-hosted runner, and "Build a schema registry once" moves to a how-to guide of its own. No code changes and no public API changes.
