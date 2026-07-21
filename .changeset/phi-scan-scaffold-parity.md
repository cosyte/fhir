---
"@cosyte/fhir": patch
---

Close three security-scaffolding parity gaps that every other cosyte parser already has
(FHIR-SCAFFOLD-GAPS), surfaced when the 7 back-filled repos were registered in drift coverage —
`config`'s `drift-manifest.json` requires the `phi-scan` script plus the `codeql.yml` / `scorecard.yml`
workflows, and `fhir` was missing all three.

- **PHI commit-scanner** (`scripts/phi-scan.ts`, `pnpm phi-scan`). A zero-dependency, FHIR-shape-aware
  scanner refuses synthetic fixtures (and a conservative dashed-SSN + email text pass over `src/`)
  that carry real-looking PHI, so a developer cannot commit a real resource by accident. It parses
  each fixture (JSON / NDJSON) or scans element/`value`-attribute pairs (XML) and inspects only the
  elements that carry each category, keyed by the FHIR element name — person names (HumanName
  `family` / `given` / `text`, recursing into `contained` / `entry.resource`), dates of birth
  (`birthDate` / `deceasedDateTime`), SSN- / 9-digit-shaped `identifier` / `telecom` values (plus
  dashed SSNs anywhere), phones (`telecom` without the `555` convention), addresses (`Address.line` /
  `.text`), and emails — rather than a blind text regex. Crucially a plain-string `name`
  (`Organization.name`, `StructureDefinition.name`) is a resource label and is never name-scanned,
  and the XML `<value>` scan is scoped to `<telecom>` / `<identifier>` blocks so an overloaded
  `Quantity.value` measurement is never misread as a phone / SSN. Synthetic fixtures are declared in
  `scripts/phi-allow-list.txt`; a whole-file bypass requires `--allow-fixture` plus an audit entry in
  `phi-scan-overrides.md`. Runs at pre-commit (`simple-git-hooks --staged`) and in CI
  (`run-phi-scan: true`); `scripts/verify.sh` now reports `phi-scan ✓`.
- **`.github/workflows/codeql.yml`** — thin caller of the reusable `cosyte/.github` CodeQL workflow.
- **`.github/workflows/scorecard.yml`** — thin caller of the reusable OpenSSF Scorecard workflow.

Additive dev-tooling / CI scaffolding only — no change to the published package surface, exports, or
runtime behavior. Adds `tsx` + `simple-git-hooks` dev dependencies (the runtime-dependency count stays
zero).
