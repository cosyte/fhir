---
"@cosyte/fhir": patch
---

Fix the non-required `differential` CI check (FHIR-DIFFERENTIAL-RED): reconcile the 5 "FALSE VALID"
invariant violations against the `validator_cli.jar` oracle (R4 4.0.1 + US Core 6.1.0). All five were
under-specified fixtures, not a parser conformance gap, so the fix completes them to be genuinely
spec-clean rather than weakening the comparison — `medicationrequest-dose` gains the base-mandatory
`subject` (1..1), `observation-vitals-bp` and the `quirk-searchset-paging` embedded Observation gain
the vital-signs-mandatory `subject` + `effective[x]`, `observation-decimals` is re-coded to a non-vital
lab LOINC (its decimal edge values round-trip byte-for-byte unchanged), and `quirk-uscore-extensions`
moves its synthetic MRN off `example.org` while the harness now loads the US Core IG
(`-ig hl7.fhir.us.core#6.1.0`) so `us-core-*` extension definitions resolve. Fixtures + one harness
flag only — no change to the published package surface or runtime behavior.
