---
"@cosyte/fhir": patch
---

Measure the bounded FHIRPath engine against HL7's shared R4 conformance suite, and fix the four
constructs it was answering wrongly.

`src/fhirpath/` has always been a deliberately capped subset whose declared fallback is
`INVARIANT_UNCHECKED`, but nothing in this repo had ever counted how big that cap is against a suite
neither side wrote. HL7's shared FHIRPath corpus is now vendored under
`test/__fixtures__/fhirpath-suite/` with its upstream Apache-2.0 licence beside it, and
`test/fhirpath-suite.test.ts` runs all 935 cases on every `pnpm test`, putting each in exactly one
bucket and printing the counts. `documentation/fhirpath-coverage.md` records them, and a run that
disagrees with that file fails the build naming both numbers. Measured at corpus tag `1.7.67`:
**190 evaluated, 710 refused as unsupported, 0 answered wrongly, 35 the corpus itself marks
invalid**, so the engine answers 20.3% of the corpus.

A large refusal count is the measurement, not a defect: the corpus grades the whole language, and
arithmetic, string functions, temporal arithmetic, `descendants()`, `resolve()`, aggregates and FHIR
type reflection are outside this engine's scope on purpose. What the run is a gate on is the other
number: **a case answered wrongly fails the suite rather than being recorded as unsupported.** A case
counts as refused only where `UnsupportedFhirPathError` was actually raised, and a result the harness
cannot compare counts as wrong, so the number can never be flattered by the harness's own gaps.

The run surfaced wrongly answered cases in four constructs, all now fixed at the engine:

- **A type-qualified path head resolves against the resource it names, instead of being navigated
  as a member.** FHIRPath lets a path be written `Patient.name.given`, where the leading segment
  names the type the path is rooted in, and most published constraint text is written that way. This
  engine was navigating that head as an ordinary member, and no resource has a property called
  `Patient`, so `Patient.name.exists()` evaluated to `false` on a Patient that has a name: a wrong
  answer with no diagnostic. It now resolves where the model can check it, at a resource root whose
  `resourceType` the qualifier names, and raises `UnsupportedFhirPathError` for any focus it cannot
  check, which a caller sees as `INVARIANT_UNCHECKED`. Refusing it unconditionally was tried and
  withdrawn: it turned a violated `Patient.name.exists()` invariant from `INVARIANT_VIOLATED` at
  error into `INVARIANT_UNCHECKED` at information, and `validateResource` returned `valid: true` for
  a resource it rejects today. Scoped to the head of a path: `ofType(Boolean)` and
  `x is System.String` read their type name off the parse tree and are untouched.
- **`is` / `as` bound one precedence level too loose.** The published precedence table puts them
  tighter than `|` and looser than `+`; this parser had them between equality and inequality. That
  re-associated `1 | 1 is Integer` into `(1 | 1) is Integer`, a different collection, and
  `1 > 2 is Boolean` into `(1 > 2) is Boolean`, which answers `true` where the language says the
  expression compares an Integer with a Boolean and errors. Both are wrong booleans out of a
  well-formed parse.
- **A type test outside the System primitives is refused rather than answered `false`.**
  `Observation.issued is instant` and `Patient.gender.ofType(code)` were being answered from the
  System type of the value, which is not the question: a generic model carries no FHIR datatype
  name, so `code` and `instant` cannot be tested for at all and `false` only looked like a
  determination. Any type name outside `Boolean` / `String` / `Integer` / `Decimal` now raises
  `UnsupportedFhirPathError`. Separately `{} is T` is now the empty collection rather than `false`,
  which is what FHIRPath says; the two coerce alike, so no constraint's verdict moves with it.
- **An ordering comparison no longer orders a model value lexically.** A string-valued primitive is
  the FHIR lexical form of an element whose type the model does not carry, so comparing it with `<`
  answered `Observation.value.value < 'test'` (a decimal against a word, an execution error in
  FHIRPath) with `true`, and answered the `per-1` period constraint's `start <= end` over a
  day-precision date and a second-precision dateTime with `true` where FHIRPath says the comparison
  is indeterminate. Where either side is a model value the two must now read as temporal values of
  the same family, compared by FHIRPath's precision rules, and anything else is refused. Values the
  engine computed itself still order as System Strings, and a JSON-read decimal still orders as a
  number, so `start <= end` keeps answering for the same-precision dates it always answered for.

None of the four removes, re-severities or relocates a finding an already-shipped layer emits.
That is checked at the layer where a finding is decided, not inferred from a green suite:
`test/profile-invariant-type-qualified.test.ts` pins the issue code, the severity and `valid` for a
type-qualified constraint in both the satisfied and the violated direction, the ordering change is
pinned against `per-1` in both the answered and the indeterminate direction, and every test that
predates this measurement is green unchanged.

No public export is added or removed, and no runtime dependency: the corpus is read with the
`readRawXml` reader the package already ships.

One of the eleven input documents the corpus names, `r4/patient-name-extensions.json`, is refused by
this package's JSON reader with `PRIMITIVE_EXTENSION_MISALIGNED`, and correctly: the published
example writes a two-slot value array beside a one-slot `_`-sibling array, which json.html §2.6.2.3
does not allow and this reader fails closed on rather than re-index or drop a position. The single
case naming it is not skipped: it is asked with no document, refused at the head of its path
(an empty focus is nothing to check a type qualifier against) and counted declined. That placement
is conservative rather than measured, since the refusal is caused by the absent document, so it can
only make the coverage number smaller than the engine deserves. The exception is declared by name so
that an undeclared document going unreadable, or this one becoming readable, both fail the suite.

Two of the 935 cases, `testPolymorphismB` and `testPolymorphicsB`, are marked invalid by the corpus
only under the **strict** mode of choice-element access its own schema defines
(`Observation.value` rather than `Observation.valueQuantity`); the corpus's own comment notes that
lenient engines allow the direct spelling. This engine is lenient there and cannot be otherwise
without FHIR resource definitions it deliberately does not carry, so both are declared by name,
pinned to their expression and to the exact answer this engine gives, and counted in the corpus's
invalid bucket rather than credited as evaluated.
