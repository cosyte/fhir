---
"@cosyte/fhir": patch
---

Docs: the quickstart's first example and a new README usage example are now executed by the test suite, read straight out of the page they are printed on.

No runtime change: nothing under `src/` was touched and the public API is unchanged. The quickstart's first step now reads its synthetic Observation in a runnable block, with the diagnostic it claims asserted, and the README gains a usage example over the same document. That document is committed byte for byte as a test fixture, so the PHI scan reads it. A changed value in either example fails the suite, and the install command the installation page prints is checked against the package's own name.
