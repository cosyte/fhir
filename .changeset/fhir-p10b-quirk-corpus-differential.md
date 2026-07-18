---
"@cosyte/fhir": patch
---

Add the Tier-2 real-world quirk corpus and wire the JVM `validator_cli.jar` differential over it
(FHIR-P10b, unblocked by meta-repo ADR 0018). Five quirk fixtures — each grounded in a **public**
artifact (FHIR published examples, the spec's normative rules, US Core, documented public interop
defects), no invented quirks — reproduce the cross-vendor quirks that bite (roadmap §3): a
non-first `resourceType` (json.html), a scientific-notation decimal (Synthea #675 + the R4 decimal
regex), a primitive-extension `_`-sibling misalignment that fails closed (HAPI #5738), a searchset
Bundle whose `link[next]` must survive the round-trip (bundle-example.json), and US Core race +
birthsex extensions preserved on a base Patient. `test/quirk-corpus.test.ts` asserts the exact
value-free issue set for each and records the per-fixture provenance; `scripts/differential.mjs`
(the `differential` CI job) now runs this corpus through the oracle alongside the spec-clean tier.
The differential remains **CI-only** (JVM oracle; not observed green in the dev container).
