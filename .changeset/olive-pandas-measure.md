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
**190 evaluated, 710 refused as unsupported, 2 answered wrongly, 33 the corpus marks invalid and the
engine does not answer**, so the engine answers 20.3% of the corpus.

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
  the same family, each taken as the interval of instants its written precision denotes, at its own
  timezone offset: they order when the intervals are disjoint, are equal when the intervals coincide,
  and are indeterminate (`{}`) when they overlap without coinciding. A value written with no
  designator is read at the evaluation context's offset, which FHIRPath leaves to the engine and
  which this engine declares to be UTC. Anything not temporal is refused. Values the engine computed
  itself still order as System Strings, and a JSON-read decimal still orders as a number.

What the four move, precisely, and each claim checked at the layer where a finding is decided rather
than inferred from a green suite:

- **Nothing is removed, re-severitied or relocated.** `test/profile-invariant-type-qualified.test.ts`
  pins the issue code, the severity and `valid` for a type-qualified constraint in both the satisfied
  and the violated direction, and `test/profile-invariant-ordering.test.ts` does the same for `per-1`
  over an inverted period written with two different timezone offsets, with one, and with none, plus
  the conformant orderings. Every test that predates this measurement is green unchanged.
- **A false positive is removed**, which is the correction the first fix exists for: a conformant
  Patient was reported `INVARIANT_VIOLATED` because the type-qualified head selected nothing.
- **A finding is added**, in one shape: where the two ends of a period are written at different
  precisions the comparison is indeterminate, `evaluateInvariant` coerces empty to "not satisfied"
  as it has always documented, and the profile layer reports `INVARIANT_VIOLATED` at the
  constraint's severity for a document the lexical comparison passed. The corpus is what requires it.
- **An answer is withdrawn**, in one shape: an ordering comparison over a model value that is not
  temporal is now `INVARIANT_UNCHECKED`. That answer was unsound for anything numeric.

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
without FHIR resource definitions it deliberately does not carry. **They are the two cases counted
wrongly answered**: a case the corpus marks invalid that the engine answers is a disagreement however
well explained, so it is counted as one, and the suite is red over exactly those two rather than
excusing them into the invalid bucket. Both are named and pinned to their expression and answer, so
an engine that starts refusing them, or an upstream edit to either, fails the suite and asks for the
line to be re-made deliberately.
