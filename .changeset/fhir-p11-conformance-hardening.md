---
"@cosyte/fhir": patch
---

Conformance hardening (Phase 11, buildable tiers; roadmap §6) — fuzz targets, a PHI-leak test tier,
type-level tests, and the three read-path robustness fixes those tiers surfaced. The JVM
`validator_cli.jar` differential is authored but runs only in CI (no Java in the dev container), and
the highest-value real-vendor **quirk-corpus** differential is deferred to `REAL-CORPUS` (a quirk is
encoded only when a real de-identified document grounds it — none exists, and inventing one is
forbidden).

- **JSON + XML fuzz tier (`test/fuzz.test.ts`).** Adversarial JSON/XML/NDJSON at fuzz-scale run counts
  (CI-tunable via `FUZZ_RUNS`): XXE / billion-laughs / undefined entities, deep nesting, `_element`
  misalignment, huge / scientific-notation numbers, `resourceType` games, prototype-chain keys,
  truncation and structural mutation of the real corpus. The proven contract: adversarial input never
  crashes / hangs / OOMs — it becomes a **typed** `FhirCodecError` / `FhirXmlError` with a registered
  fatal code, or a bounded rejection, never an untyped throw.
- **PHI-leak test tier (`test/phi-leak.test.ts`).** The value-free-diagnostics contract turned into a
  gate: a corpus sweep plus an injected-sentinel battery assert that no PHI-bearing input value ever
  reaches any `OperationOutcome` / issue / error output (findings carry a coded reason and a FHIRPath
  location, never a value).
- **Type-level tier (`test/public-types.test.ts`).** `expect-type` assertions pin the public type
  surface (the discriminated unions a consumer switches on, `PrimitiveValue` never being a JS
  `number`, the value-free `FhirIssue` shape), checked by `tsc`.
- **New fatal code `FATAL_CODES.MAX_DEPTH_EXCEEDED`.** The JSON reader now bounds nesting at 256 —
  matching the XML reader — and refuses a pathological tower of `[[[[…]]]]` / `{"a":{…}}` with this
  typed, value-free fatal instead of overflowing V8's stack with an untyped `RangeError`. Legitimate
  FHIR nests far shallower and is unaffected.

### Fixed (three read-path robustness defects the fuzz tier surfaced)

- **Decimal DoS.** `FhirDecimal` quantity comparison aligned scales with `10n ** BigInt(scaleDiff)`;
  an adversarial literal such as `0e9999999999999999999` (finite as a double but of astronomical
  scale) made that exponentiation throw an untyped `RangeError` — or hang building a multi-gigabyte
  BigInt — **on the read path**, via the codec's precision check. Comparison is now done in a
  canonical form that never exponentiates; quantity- and precision-equality semantics are unchanged.
- **XML entity prototype bypass.** The reader resolved a predefined entity with a bare
  `PREDEFINED[body]`, so `&constructor;` / `&toString;` / `&__proto__;` read through `Object.prototype`
  and **bypassed the five-entity allowlist**. Now guarded by `Object.hasOwn` — only the five predefined
  entities resolve; every other named entity is refused (`UNDEFINED_ENTITY`).
- **Validator DoS via a prototype-named property.** A resource whose property was literally named
  `constructor` / `toString` / `valueOf` / `hasOwnProperty` made the schema lookup read an inherited
  `Object.prototype` member and crash `validateResource` with an uncaught `TypeError`. Now guarded by
  `Object.hasOwn` — an adversarial resource can no longer fault the validator.
