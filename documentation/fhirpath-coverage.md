# FHIRPath coverage against the shared R4 conformance suite

This package ships a **bounded** FHIRPath engine. An expression it cannot lex, parse or evaluate
raises `UnsupportedFhirPathError`, and the validator reports `INVARIANT_UNCHECKED` rather than a
pass, so a constraint the engine cannot evaluate is surfaced and never silently satisfied.

What this file records is how big that bound actually is, measured against a suite neither side
wrote: HL7's own shared FHIRPath conformance corpus, the one the reference validator is graded on.
Before this measurement existed the size of the subset was asserted in prose and had never been
counted.

**Every number below is re-derived by `test/fhirpath-suite.test.ts` on each run, and a run that
disagrees with this file fails the build**, naming both the recorded and the measured value. This is
a checked record, not a snapshot someone has to remember to update.

> **The suite is currently RED, and the two cases below say why.** The engine answers two cases the
> corpus marks invalid, and the harness counts a case like that wrongly answered without exception,
> so `wrong` is 2 rather than 0 and the run fails naming both. Making it green means the engine
> refusing `Observation.valueQuantity`, which needs FHIR definitional knowledge this package does not
> carry; see [the two cases](#two-cases-the-corpus-writes-for-a-mode-this-engine-does-not-run-in).
> The number is published as measured rather than adjusted to reach zero.

## The corpus

- **Repository**: `https://github.com/FHIR/fhir-test-cases`
- **Tag measured**: `1.7.67`
- **Licence**: Apache-2.0. The upstream licence text travels with the vendored bytes at
  `test/__fixtures__/fhirpath-suite/LICENSE.txt`. This package's own licence is MIT and is unchanged.
- **Vendored at**: `test/__fixtures__/fhirpath-suite/`

The suite file is `r4/fhirpath/tests-fhir-r4.xml`, which is a distribution copy of the corpus's R5
original; the R5 suite and the r4b corpus are out of scope here. `r5/fhirpath/testSchema.xsd` is
vendored beside it because it is the authority for the file format the harness reads: which
attributes a `<test>` carries, what an `<expression invalid="…">` value means, and that an `<output>`
with no `type` carries "the string representation of a literal".

### Vendored files and their sha256

Each digest is checked against the file on disk every run.

| upstream path | vendored as | bytes | sha256 |
|---|---|---|---|
| `LICENSE.txt` | `LICENSE.txt` | 11357 | `c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4` |
| `r4/appointment-examplereq.json` | `appointment-examplereq.json` | 2222 | `0bc59eff908363c1183932e15738e288e1fb7dabb643dcdea6cf62e1d9478864` |
| `r4/codesystem-example.xml` | `codesystem-example.xml` | 2460 | `da56c88f1e329359b9e7eb376c84ddcd70abe97f0f932ee8a7b8b20cb55e8363` |
| `r4/explanationofbenefit-example.json` | `explanationofbenefit-example.json` | 785 | `fb6cdaca18a18e2c2b26e93cbe16709c0ff5ca9a15b7725531fa576d5034f899` |
| `r4/fhirpath/tests-fhir-r4.xml` | `tests-fhir-r4.xml` | 163425 | `408c2dd0de2766534f38058da3490799f344d7b75335348b700ead696a9b1bfe` |
| `r4/observation-example.xml` | `observation-example.xml` | 3872 | `80a32392067c65612f0fbffcd94e3832d5f21c356cf1ff7a61ded1c8032ff360` |
| `r4/parameters-example-types.xml` | `parameters-example-types.xml` | 659 | `38dc7daa23a7bc6117b59008a47daa737a9e031ecdccf01d9190e5697d62baff` |
| `r4/patient-container-example.json` | `patient-container-example.json` | 276 | `cec75206b31d2090285908050ab8c8bd11237008bcc36d8a6e6326b9ced4b884` |
| `r4/patient-example-period.xml` | `patient-example-period.xml` | 3913 | `3d02211271484cf069fb4c2ca72ad27a9179b24e60d7b3d292825ff097bd27cd` |
| `r4/patient-example.xml` | `patient-example.xml` | 3874 | `606695d227a8669dc6ef2669957b1684990b2e127a82592008642c50359324fd` |
| `r4/patient-name-extensions.json` | `patient-name-extensions.json` | 458 | `25d3b1fa540fc4586bee49d5b56106a967d6339461a802fb5e0fa5bb8469b827` |
| `r4/questionnaire-example.xml` | `questionnaire-example.xml` | 4129 | `06e56aa1ab4c206fad6159f5fa8321b7d8a7666ce682ac5be128ff5ac6113048` |
| `r4/valueset-example-expansion.xml` | `valueset-example-expansion.xml` | 6873 | `2fd28a9377eedfe9c0ff17a5d1756c40bc88b393a889853b75b883283a75919d` |
| `r5/fhirpath/testSchema.xsd` | `testSchema.xsd` | 13245 | `50408d5ca3d317f3001f8abfcfa65e7faaaf9b9af4c0f98875e0e9201ca52fa0` |

### How many cases the corpus carries

`grep -c '<test '` over the suite file counts **937** occurrences. Two of them sit inside XML
comments (a parked `testMatchesUnicodeCharacters` case, and an unnamed leftover in a commented-out
`testDollarResource` group), so no XML reader yields them and no engine is ever asked to answer them.
The corpus therefore carries **935** cases, and that is the number the buckets below sum to. The
suite asserts all three numbers, so neither the byte count nor the live count can drift unnoticed.

## The counts, measured at tag 1.7.67

| bucket | cases | what it means |
|---|---|---|
| evaluated | 190 | the engine produced an answer and it matches the corpus |
| unsupported | 710 | the engine itself raised `UnsupportedFhirPathError` |
| wrongly answered | 2 | the engine produced an answer that disagrees, or one the harness cannot compare |
| marked invalid by the corpus | 33 | the corpus expects a syntax / semantic / execution error and the engine did not answer, so it gets no credit |
| **total** | **935** | every live `<test>` element, each in exactly one bucket |

The corpus marks **35** cases invalid. Thirty-three of them the engine declines or answers with
nothing, and they sit in the invalid bucket; the other two it answers, which is a disagreement with
the corpus however well explained, so they are counted `wrongly answered` and the suite reds.

**The engine answers 20.3% of the whole corpus** (190 of 935), or **21.1%** of the cases it is
expected to evaluate at all (190 of 902: the same numerator over a denominator with the 33 cases in
the invalid bucket removed). Both fractions are stated because they answer different questions, and
quoting one as the other is how a coverage number drifts.

```counts
corpus_repository: https://github.com/FHIR/fhir-test-cases
corpus_tag: 1.7.67
raw_test_tag_occurrences: 937
commented_out_cases: 2
total_cases: 935
evaluated: 190
unsupported: 710
wrong: 2
invalid: 33
answered_fraction: 20.3%
answered_fraction_of_valid: 21.1%
```

## How to read the number

**A large unsupported bucket is the measurement, not a defect.** The engine's declared scope is
navigation and choice access, `$this`, `%resource` / `%context`, existence and filtering, three
valued logic, comparison, membership, union, and type tests on the System primitives. The shared
corpus is a conformance suite for the whole language, so it spends most of its cases on arithmetic,
string functions, date and time arithmetic, `descendants()`, `resolve()`, aggregates, and FHIR type
reflection, all of which are outside the bound on purpose. A refusal there is the engine behaving as
designed.

**A wrongly answered case is a defect, and the suite fails on one.** The bar this file holds is that
the engine never answers a shared case wrongly rather than refusing it. `wrong` is **2** today and
the suite is red over exactly those two, which is the bar working rather than the bar being missed:
the two are named, explained and left in the count instead of being moved out of it.

**Growing the evaluated count is not the goal of this file.** Widening the subset is a separate
decision with its own trade-offs; this file only says where the boundary is today.

## One input document this package refuses

The corpus names eleven input documents. Ten load. The eleventh,
`r4/patient-name-extensions.json`, is refused by this package's JSON reader with
`PRIMITIVE_EXTENSION_MISALIGNED`, and that refusal is correct: the published example writes

```json
"given": [null, "James"],
"_given": [{ "extension": [ … ] }]
```

a two-slot value array beside a one-slot `_`-sibling array. FHIR json.html §2.6.2.3 fills out **both**
arrays so that each `id` / `extension` lines up index by index with its value, so the alignment is
broken and cannot be recovered without re-indexing or dropping a position, which this reader refuses
to do by design.

One case names that document, `testPrimitiveExtensions`. It is **not skipped**: it is asked with no
document, and the engine refuses its expression at the head of the path (`type-qualified path head
'Patient'`, because an empty focus is nothing to check a type qualifier against), so it is counted
`unsupported` on an observed refusal like every other case in that bucket.

**That placement is conservative, and it is not a measurement of this case.** The refusal is *caused
by* the absent document: handed the Patient the corpus meant, the engine would resolve the qualifier
and answer. So one case in 935 is counted declined while the engine's real coverage of it is
unknown, which can only make the evaluated count **smaller** than the engine deserves, never larger.
The alternatives are worse: crediting it as evaluated would claim an answer nobody has seen, and
counting it wrong would attribute a correct reader refusal to the evaluator and red the suite
permanently over this package behaving as designed. The declaration is checked in both directions:
an undeclared document that stops loading fails the suite naming itself, and this document becoming
readable also fails the suite, so the exception cannot outlive its reason.

## Two cases the corpus writes for a mode this engine does not run in

The corpus's vendored schema defines a `mode` attribute as whether a test is to be evaluated with
**strict** (`Patient.deceased`) as opposed to **lenient** (`Patient.deceasedBoolean`) semantics for
choice-valued elements, and the comment above the corpus's own `polymorphics` group says the direct
spelling "is not technical conformant. For this reason, some engines have a non-strict mode where
this is allowed". This engine is one of those: it takes the element a document actually wrote before
it tries a `[x]` choice variant, so `Observation.valueQuantity` selects the Quantity and
`Observation.value` selects it too.

Two cases turn on that, `testPolymorphismB` (`Observation.valueQuantity.unit`, which carries
`mode="strict"`) and `testPolymorphicsB` (`Observation.valueQuantity.exists()`). Both are marked
`invalid="semantic"`, and this engine answers them, `lbs` and `true`. It cannot currently do
otherwise: telling a choice element spelled with its type (`valueQuantity`) from an ordinary element
that is also lowerCamelCase with an internal capital (`birthDate`, `managingOrganization`) needs the
FHIR *definition* of the resource. The deliberately generic model carries none, and the built-in
element schema in `src/validate/schema.ts` models `Patient` alone, so it cannot answer the question
for `Observation` either. Refusing every internally-capitalised member name instead would withdraw
`Patient.birthDate` and `Extension.valueString` from every caller-supplied invariant that uses them,
which is the direction the fail-safe contract forbids.

**Both engine remedies were built and measured, and each is worse than the red suite.**

- **Refusing the spelling.** `src/validate/schema.ts` does model `Observation.value[x]` as an
  eleven-way choice, so the engine can ask `resolveElement` whether a member name is a choice variant
  and refuse where it is, with no name-shape guessing. Built, it makes both cases refuse and the
  corpus reads `190 / 710 / 0 / 35` with nothing moving out of `evaluated`. It also **withdraws a
  finding a shipped layer emits today**: on
  `{"resourceType":"Observation","valueQuantity":{"value":9,"unit":"mg"}}`, a caller-supplied
  invariant `valueQuantity.value < 2` goes from `INVARIANT_VIOLATED` at **error** with
  `validateResource(...).valid === false` to `INVARIANT_UNCHECKED` at **information** with
  `valid === true`. Two tests that predate this measurement red on it
  (`test/fhirpath.test.ts`, "compares a decimal element to a numeric literal precisely" and
  "!= operator, decimal comparison, and Decimal type of a decimal element"), which is the existing
  suite doing its job: it is the tripwire for exactly this movement, and it fired.
- **Correcting the answer**, i.e. selecting nothing for the non-conformant spelling, matches both
  corpus expectations, and is worse still: it turns `Observation.valueQuantity.empty()` and
  `...exists().not()` into a **silent pass** for a caller who wrote the spelling FHIR documents
  everywhere, which is the one outcome `UnsupportedFhirPathError` exists to prevent.

So the disagreement is left standing and counted.

**These two are what `wrong` counts, and the suite is red because of them.** They are named in
`LENIENT_POLYMORPHIC_CASES` and pinned by expression **and** by the exact answer the engine gives,
but naming a case buys it nothing: `classifyCase` counts a non-empty answer to a case the corpus
marks invalid as wrongly answered whether or not it is named. An earlier revision of this work did
exclude them, which made `wrong` read zero; that is what a headline number stops meaning anything if
it is allowed to do, so the exclusion is gone and the disagreement is in the count where a reader can
see it. The naming is a tripwire in both directions: an upstream edit to either expression, a case
that stops being marked invalid, or an engine that starts refusing or answering differently each
fails the suite and asks for the line to be re-made deliberately. The last of those is what closing
this gap looks like.

## Four engine corrections this measurement forced

Running the corpus surfaced wrongly answered cases in four constructs. Each was fixed at the engine
by the narrower of the two options available, refusing the construct or correcting an answer the
subset already claims to give. The two cases in the section above are the ones neither option
reaches.

1. **A type-qualified path head now resolves against the resource it names.** FHIRPath lets a path
   be written `Patient.name.given`, where the leading segment names the type the path is rooted in
   (127 of the 935 cases are written that way, and so is most published FHIR constraint text). The
   engine was navigating that head as an ordinary member, and since no resource has a property
   called `Patient`, `Patient.name.exists()` evaluated to `false` on a Patient that has a name: a
   wrong answer with no diagnostic. It now resolves where the model can check it, at a **resource
   root whose `resourceType` the qualifier names**, and refuses everywhere else, which is any focus
   the generic model carries no type for. Refusing it *unconditionally* was tried and withdrawn: on
   a Patient with no name, a caller-supplied `Patient.name.exists()` invariant went from
   `INVARIANT_VIOLATED` at error to `INVARIANT_UNCHECKED` at information and `validateResource`
   returned `valid: true` for a document it rejects today. Withdrawing a true finding is not a safe
   default. `test/profile-invariant-type-qualified.test.ts` pins both directions at the layer that
   decides an issue code, a severity and `valid`.

2. **`is` / `as` sat one precedence level too loose.** The published FHIRPath precedence table binds
   `is` / `as` tighter than `|` and looser than `+`; this parser had it between equality and
   inequality. That re-associated `1 | 1 is Integer` into `(1 | 1) is Integer`, a different
   collection, and `1 > 2 is Boolean` into `(1 > 2) is Boolean`, which answers `true` where the
   language says the expression compares an Integer with a Boolean and errors. Both are wrong
   booleans out of a well-formed parse.

3. **A type test outside the System primitives is now refused, and an empty operand yields empty.**
   `Observation.issued is instant` and `Patient.gender.ofType(code)` were answered `false` and `{}`,
   which look like determinations and are not: the model carries no FHIR datatype name, so `code`
   and `instant` are questions this engine cannot answer at all. It now refuses any type name
   outside `Boolean` / `String` / `Integer` / `Decimal`. Separately, `{} is T` is the empty
   collection rather than `false`, which is what FHIRPath says and what the corpus reads; both
   coerce alike, so no invariant's verdict moves with it.

4. **An ordering comparison no longer orders a model value lexically.** The model is generic, so a
   string-valued primitive is the FHIR lexical form of an element whose type it does not carry: a
   `string`, a `code`, a `date`, or, read from XML, a `decimal`. Comparing lexically answered
   `Observation.value.value < 'test'` (a decimal against a word, which FHIRPath makes an execution
   error) with `true`, and answered `per-1`'s `start <= end` over a day-precision date and a
   second-precision dateTime with `true` where FHIRPath says the comparison is indeterminate and the
   value is `{}`. Where either side is a model value, both must now read as temporal values of the
   same family, and each is read as the **interval of instants** its written precision denotes and
   compared at its own timezone offset. Two values order when their intervals are disjoint, are equal
   when the intervals coincide, and are indeterminate (`{}`) when they overlap without coinciding,
   which is FHIRPath's precision rule and its offset rule stated once. A value written with no
   designator is read at the evaluation context's offset, which FHIRPath leaves to the engine and
   which this engine declares to be UTC: the frame the previous lexical comparison used implicitly on
   every value. Anything not temporal is refused. Two values the engine computed itself are System
   Strings by construction and still order as Strings, and a JSON-read decimal still orders as a
   number.

   An earlier revision of this remedy **refused** any pair carrying different timezone designators
   rather than normalising them, which withdrew a true finding: `13:00:00+02:00` is `11:00:00Z`, so a
   period ending at `10:00:00Z` is genuinely inverted, and `per-1` over it went from
   `INVARIANT_VIOLATED` at error to `INVARIANT_UNCHECKED` at information with
   `validateResource(...).valid` flipping to `true`. Normalising is the correction that owed;
   refusing was not a safe default.

### What these four move, and what they do not

Two of the four move findings, and this section is the honest statement of which, replacing an
earlier sentence here that said none of them did while one was doing it.

- **Nothing is removed, re-severitied or relocated.** Both directions of remedy 1 are pinned at the
  layer that decides an issue code, a severity and `valid`, in `test/profile-invariant-type-qualified.test.ts`
  (4 tests over `collectInvariantIssues` / `validateResource` with a caller-supplied profile).
  Remedy 4's are pinned the same way in `test/profile-invariant-ordering.test.ts` (8 tests over the
  same two entry points, using R4's `per-1` expression verbatim): an inverted period written with two
  different offsets, with one, and with none is reported `INVARIANT_VIOLATED` at error with
  `valid: false` in every spelling, and a conformant one reports nothing. Remedies 2 and 3 move no
  verdict by construction, since `{}` and `false` coerce alike through `convertToBoolean` and the
  re-associations they fix were parse errors rather than answers.
- **Remedy 1 removes a false positive**, which is the permitted correction, not a withdrawal: a
  conformant Patient was reported `INVARIANT_VIOLATED` for `Patient.name.exists()` because the head
  selected nothing. The same test file pins that it now reports nothing.
- **Remedy 4 adds a finding**, in one shape, and it is not optional: where the two ends of a period
  are written at different precisions the comparison is indeterminate, `evaluateInvariant` coerces
  empty to "not satisfied" (its documented, shipped behaviour, matching the reference validator), and
  the profile layer makes that `INVARIANT_VIOLATED` at the constraint's own severity. The lexical
  comparison answered `true` and reported nothing for such a document. The corpus is what forces it:
  `testPeriodInvariantOld` grades `per-1` over exactly this document and expects `false`.
  `test/profile-invariant-ordering.test.ts` pins the added error, and its severity, at the deciding
  layer rather than leaving it to be discovered.
- **Remedy 4 also costs an answer**: an ordering comparison over a model value that is not temporal
  is refused, so a caller who ordered a `string`-valued element against a literal now gets
  `INVARIANT_UNCHECKED` at information where they got a lexical answer before. That answer was
  unsound for anything numeric, which is what the corpus caught. Pinned at the deciding layer too.

Every one of the 1730 tests that predate this measurement is green unchanged; that is a necessary
condition and, as the withdrawal above proved, not a sufficient one, which is why each claim here
names the test that checks it at the layer that decides.

## Re-running the measurement

```sh
pnpm run test          # the whole suite, this measurement included
pnpm vitest run test/fhirpath-suite.test.ts
```

The counts are printed on every run.
