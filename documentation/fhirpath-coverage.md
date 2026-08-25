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
| evaluated | 148 | the engine produced an answer and it matches the corpus |
| unsupported | 752 | the engine itself raised `UnsupportedFhirPathError` |
| wrongly answered | 0 | the engine produced an answer that disagrees, or one the harness cannot compare |
| marked invalid by the corpus | 35 | the corpus expects a syntax / semantic / execution error, so the engine gets no credit |
| **total** | **935** | every live `<test>` element, each in exactly one bucket |

**The engine answers 15.8% of the whole corpus**, or **16.4%** of the cases the corpus expects to
evaluate at all (the same numerator over a denominator with the 35 invalid cases removed). Both
fractions are stated because they answer different questions, and quoting one as the other is how a
coverage number drifts.

```counts
corpus_repository: https://github.com/FHIR/fhir-test-cases
corpus_tag: 1.7.67
raw_test_tag_occurrences: 937
commented_out_cases: 2
total_cases: 935
evaluated: 148
unsupported: 752
wrong: 0
invalid: 35
answered_fraction: 15.8%
answered_fraction_of_valid: 16.4%
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
the engine never answers a shared case wrongly rather than refusing it, so `wrong` is zero and the
suite reds if it stops being.

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
document, the engine refuses its expression at the head of the path (`type-qualified path head
'Patient'`) before any focus item is read, and it is therefore counted `unsupported` on an observed
refusal like every other case in that bucket. The declaration is checked in both directions: an
undeclared document that stops loading fails the suite naming itself, and this document becoming
readable also fails the suite, so the exception cannot outlive its reason.

## Two engine corrections this measurement forced

Running the corpus for the first time surfaced 51 wrongly answered cases. Both causes were fixed at
the engine, and every one of the 51 is now either evaluated correctly, refused, or in the corpus's
own invalid bucket.

1. **A type-qualified path head is now refused.** FHIRPath lets a path be written
   `Patient.name.given`, where the leading segment names the type the path is rooted in. The engine
   was navigating it as an ordinary member, and since no resource has a property called `Patient`,
   `Patient.name.exists()` evaluated to `false` on a Patient that has a name: a wrong answer with no
   diagnostic. FHIR's naming rules make the two spellings disjoint (element names are lowerCamelCase,
   type names are UpperCamelCase), so the head of a path starting with an upper-case letter is a type
   qualifier and is now refused. The generic model carries no datatype name, which is the same reason
   FHIR type `is` / `as` is out of scope, so refusing is the only honest option.

2. **`is` / `as` sat one precedence level too loose.** The published FHIRPath precedence table binds
   `is` / `as` tighter than `|` and looser than `+`; this parser had it between equality and
   inequality. That re-associated `1 | 1 is Integer` into `(1 | 1) is Integer`, a different
   collection, and `1 > 2 is Boolean` into `(1 > 2) is Boolean`, which answers `true` where the
   language says the expression compares an Integer with a Boolean and errors. Both are wrong
   booleans out of a well-formed parse.

Neither change removes, re-severities or relocates a finding any shipped layer emits today: the
existing suite is green on both.

## Re-running the measurement

```sh
pnpm run test          # the whole suite, this measurement included
pnpm vitest run test/fhirpath-suite.test.ts
```

The counts are printed on every run.
