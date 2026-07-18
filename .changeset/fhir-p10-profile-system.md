---
"@cosyte/fhir": patch
---

Profile growth loop (FHIR-P10, half a): `defineProfile()` + a spec-grounded profile starter kit.

`defineProfile(spec)` is the programmatic authoring front door for the Phase-6 profile engine — it
takes an ergonomic `ProfileSpec` / `ProfileElementSpec` (author-friendly `max: number | "*"`,
defaulted constraint `severity`, `id` defaulting to `path`, `sliceName` derived from the id) and
returns the **same `StructureDefinition` model the engine already consumes**, so
`validateResource(resource, { profiles: [defineProfile(spec)] })` works with no new path. It is proven
byte-for-byte equal to `loadStructureDefinition(parseResource(equivalentJson))` for a valid spec —
one model, two authoring routes, no privileged internal shape — and, as a conservative writer, throws
a value-free `InvalidProfileError` on an author mistake (missing `url`/`type`/element `path`, a bad
cardinality, a `max` below `min`).

The publishable **starter kit** dogfoods it: `VITAL_SIGN_OBSERVATION_STARTER` and
`PATIENT_IDENTIFIER_STARTER` (plus `STARTER_PROFILES`, `starterProfile(url)`,
`STARTER_PROFILE_BASE_URL`) are each authored through the public `defineProfile()`, self-contained
(differential-only, no bundled base), and grounded in public FHIR / US Core spec pages already cited
in the roadmap — templates a consumer extends, not authoritative conformance statements.

**Half b is deferred to `REAL-CORPUS`.** The Tier-2 real-vendor **quirk** fixtures (Epic/Cerner/athena
missing-must-support, vendor extensions, paging, version drift, scientific-notation decimals,
`_element` misalignment) and the `validator_cli.jar` differential over them are gated on a real,
de-identified vendor corpus — a quirk is encoded only when a real document grounds it (conventions
§PHI), and none exists yet, so inventing one is forbidden. Named real-vendor profiles are deferred for
the same reason. Synthetic spec-clean fixtures exercise the profile API here; no vendor misbehavior is
asserted.
