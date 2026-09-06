---
"@cosyte/fhir": patch
---

The PHI commit-gate no longer reports on a file it never opened. `scripts/phi-scan.ts` records the
targets a run enumerated, records the ones it actually read, and refuses the scan when the two
differ, naming every offender. The gap it closes had the shape of a feature: `--allow-fixture`
withdrew a target from the sweep and the run then returned its ordinary exit code over whatever was
left, so the same invocation over a corpus whose only violator was the withdrawn file exited clean
about a file nothing had read. Hits found before the refusal are still reported, and a refusal takes
the invocation-error code rather than the code reserved for findings, so a caller that branches on
the two still reads them apart. An ordinary run, which is what the pre-commit hook and CI both make,
is unaffected: the declared sentinel files are announced and subtracted before the enumeration is
taken.

The repository also declares a publication cooldown of 24 hours and a no-downgrade trust policy for
its own installs, and moves its build-time `js-yaml` resolution onto `4.3.0` to cover the full
advisory range.

No runtime change: nothing under `src/` was touched and the public API is unchanged.
