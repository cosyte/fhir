---
"@cosyte/fhir": patch
---

Restore the README and the changelog to the published tarball, reverting the narrowed shape that
`0.0.10` shipped as a diagnostic probe (`FHIR-NPM-NAME`).

`0.0.10` published on 2026-08-26 with `files` narrowed to the four runtime artifacts and `README.md`
cut to a 234-byte stub, to answer npm support's request for a sanitized publish. It succeeded, with
no `E403`, so the month-long publish block is over. A published version is permanent, so `0.0.10`
keeps that stub for good; this restores `dist`, `README.md`, `LICENSE` and `CHANGELOG.md` as the
tarball's contents, and `scripts/check-no-internal-refs.sh` returns to the exclusion set it had
before the probe.

What that success does NOT establish is that the tarball's contents were ever the cause. One publish
changed the contents AND followed a month of support escalation, and nothing separates those two. So
the narrowing is reverted rather than kept as a remedy, and if a publish is ever refused again the
sanitized shape should be re-run as a control before anything is concluded from it.

Worth recording for whoever meets this next: stripping the sourcemaps, which were 1.2 MB of the
tarball and carried the complete original TypeScript through `sourcesContent`, removed only about a
quarter of the security vocabulary in the shipped bytes. The rest is JSDoc compiled into the
declaration rollups, and reaching zero would mean stripping the public declarations of their
documentation.
