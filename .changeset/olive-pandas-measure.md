---
"@cosyte/fhir": patch
---

Measure the bounded FHIRPath engine against HL7's shared R4 conformance suite, and fix the two
constructs it was answering wrongly.

`src/fhirpath/` has always been a deliberately capped subset whose declared fallback is
`INVARIANT_UNCHECKED`, but nothing in this repo had ever counted how big that cap is against a suite
neither side wrote. HL7's shared FHIRPath corpus is now vendored under
`test/__fixtures__/fhirpath-suite/` with its upstream Apache-2.0 licence beside it, and
`test/fhirpath-suite.test.ts` runs all 935 cases on every `pnpm test`, putting each in exactly one
bucket and printing the counts. `documentation/fhirpath-coverage.md` records them, and a run that
disagrees with that file fails the build naming both numbers. Measured at corpus tag `1.7.67`:
**148 evaluated, 752 refused as unsupported, 0 answered wrongly, 35 the corpus itself marks
invalid**, so the engine answers 15.8% of the corpus.

A large refusal count is the measurement, not a defect: the corpus grades the whole language, and
arithmetic, string functions, temporal arithmetic, `descendants()`, `resolve()`, aggregates and FHIR
type reflection are outside this engine's scope on purpose. What the run is a gate on is the other
number: **a case answered wrongly fails the suite rather than being recorded as unsupported.** A case
counts as refused only where `UnsupportedFhirPathError` was actually raised, and a result the harness
cannot compare counts as wrong, so the number can never be flattered by the harness's own gaps.

The first run surfaced 51 wrongly answered cases, from two causes, both now fixed at the engine:

- **A type-qualified path head is refused instead of navigated.** FHIRPath lets a path be written
  `Patient.name.given`, where the leading segment names the type the path is rooted in. This engine
  was navigating it as an ordinary member, and no resource has a property called `Patient`, so
  `Patient.name.exists()` evaluated to `false` on a Patient that has a name: a wrong answer with no
  diagnostic. FHIR's naming rules make the two spellings disjoint (element names are lowerCamelCase,
  type names UpperCamelCase), so an upper-case first letter at the head of a path is a type qualifier
  and now raises `UnsupportedFhirPathError`, which a caller sees as `INVARIANT_UNCHECKED`. The
  generic model carries no datatype name, the same reason FHIR type `is` / `as` is out of scope, so
  refusing is the only honest option. Scoped to the head of a path: `ofType(Boolean)` and
  `x is System.String` read their type name off the parse tree and are untouched.
- **`is` / `as` bound one precedence level too loose.** The published precedence table puts them
  tighter than `|` and looser than `+`; this parser had them between equality and inequality. That
  re-associated `1 | 1 is Integer` into `(1 | 1) is Integer`, a different collection, and
  `1 > 2 is Boolean` into `(1 > 2) is Boolean`, which answers `true` where the language says the
  expression compares an Integer with a Boolean and errors. Both are wrong booleans out of a
  well-formed parse.

Neither change removes, re-severities or relocates a finding any already-shipped layer emits: the
existing suite is green on both, and the only behaviour that moves is an expression the engine was
previously mis-evaluating in silence.

No public export is added or removed, and no runtime dependency: the corpus is read with the
`readRawXml` reader the package already ships.

One of the eleven input documents the corpus names, `r4/patient-name-extensions.json`, is refused by
this package's JSON reader with `PRIMITIVE_EXTENSION_MISALIGNED`, and correctly: the published
example writes a two-slot value array beside a one-slot `_`-sibling array, which json.html §2.6.2.3
does not allow and this reader fails closed on rather than re-index or drop a position. The single
case naming it is not skipped, it is asked with no document and refused at the head of its path
before any focus item is read, and the exception is declared by name so that an undeclared document
going unreadable, or this one becoming readable, both fail the suite.
