---
"@cosyte/fhir": patch
---

Docs: the installation page's clone command uses the repository URL without a `.git` suffix.

docs.cosyte.com checks every link into a cosyte repository against the repositories it knows to be public, and it reads the suffixed form as a repository named `fhir.git`, which it does not know, so it would refuse to publish the page. `git clone` accepts the URL either way.

No runtime change: nothing under `src/` was touched and the public API is unchanged.
