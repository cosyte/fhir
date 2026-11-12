---
id: testing-and-quality
title: Testing and quality
sidebar_label: Testing and quality
description: "How we test @cosyte/fhir: unit tests, corpora, a differential against the HL7 validator, property tests, fuzzing and the PHI checks, and what each misses."
---

# Testing and quality

This page describes how we test `@cosyte/fhir`, what each technique catches, and what it cannot.
The shared rules every Cosyte package follows (the coverage and mutation floors, the property-based
runners, what a pull request must prove) are written down in the testing standard in
[cosyte/config's decision records](https://github.com/cosyte/config/tree/main/documentation/decisions).
The numbers for the current release are in [Current numbers](#current-numbers) below.

The failure we test hardest against is the quiet one: a read or a write that drops, merges or
invents content and still reports the resource valid. A retraction lost, a "no known allergy"
asserted that the sender never wrote, a dose changed in its last digit. So most of what follows
checks values and verdicts, not only that nothing threw.

## What we run, and what each technique catches

| Technique | What it catches | What it cannot catch |
| --- | --- | --- |
| Unit tests | each documented behavior and each failure path of every module, run against the source | an input nobody thought to write down |
| Fixture corpus | a regression on a known document shape: synthetic resources in JSON and XML under `test/__fixtures__`, including the quirks real servers send, such as a scientific-notation decimal, a `resourceType` written last and a misaligned primitive extension | a shape the corpus does not hold; behavior on real traffic, since every fixture is synthetic |
| Differential testing | a verdict that disagrees with the HL7 reference validator: the corpus declares 325 documents from four corpora (our fixtures, HL7's shared `fhir-test-cases`, the R4 specification's examples and the US Core 6.1.0 and 9.0.0 examples), holds out 89 of them with the reason recorded for each (most because the validator resolves a URL or canonical reference that we do not; the [corpus README](https://github.com/cosyte/fhir/blob/main/corpus/README.md) has the breakdown), and validates the other 236 with both; the run fails if the validator finds an error in a document we call clean, or if we report an error in a document it finds clean (our refusal to read a broken structure is the one exemption) | a bug both validators share; the content of a terminology finding, since both run with no terminology server and those findings are counted, not compared |
| FHIRPath conformance suite | a wrong answer from the bounded FHIRPath engine on HL7's shared R4 FHIRPath cases; a case the engine cannot evaluate is counted as declined, and a wrong answer fails the suite, apart from two cases the suite declares by name because they differ only in a strictness mode the engine does not implement | an expression the shared suite does not hold |
| Property-based tests | a whole class of input breaking a stated rule: a model survives writing and reading back in JSON and in XML, writing what was read a second time changes nothing the first pass did not, a reader never throws on hostile input except with a documented fatal error, a negation is never lost on a round trip, a model name at an XML tag position is written as a well-formed tag | a rule nobody stated; a case outside the cases run; a gap in what the generators produce |
| Fuzzing | a crash, a hang or an untyped throw on hostile input: truncation, deep nesting, `_element` games, huge and scientific numbers, `resourceType` games, for XML a DTD, entity expansion and undefined entities, and narrative XHTML carrying script, entities and deep nesting; each must end in a typed error or a bounded rejection | a wrong but plausible result, unless a property states what right is |
| PHI-leak tests | a diagnostic that carries a value: every fixture and a battery of resources seeded with distinctive values in every identifying position run through reading, validation and the `OperationOutcome`, and no seeded value may appear in any finding or error | a value in a position the battery does not seed |
| Coverage gate | code no test runs: lines, branches, functions and statements, held at the floor in `quality-floor.json` (100 on each) on the package and on each source directory, with each line that cannot be reached marked with its reason; a pull request must also run every changed line coverage counts | a test that runs code without checking what it returns |
| Mutation testing | a test that runs code but would not notice it changing: StrykerJS changes the source one small way at a time and counts the changes no test noticed, and the score is held to the floor in `quality-floor.json` | a change that behaves the same as the original (an equivalent mutant); code that runs once when a module loads (a table of patterns, a frozen map), whose mutants are left out of the score because each would need the whole suite again |
| Doc samples | a documentation sample that no longer matches the code: every TypeScript sample on these pages is compiled against the package's types and run against the built package, and its `// =>` values are checked | prose that is wrong beside a sample that is right |
| PHI scan | a realistic patient identifier in a fixture, an example or a staged file, checked against a declared allow-list of synthetic values; the docs pages are checked the same way, element by element | anything outside the elements and formats it knows; it detects after a write, it does not prevent one |

## How each one runs

- **Unit tests, the corpus, the FHIRPath suite, properties, fuzzing, the PHI-leak tests and the doc
  samples** run in one Vitest suite on every pull request and on `main`, on Node.js 22, 24 and 26
  on Linux, Windows and macOS, and again under Bun and under Deno. A test that cannot run on one of
  them is skipped there by name, with its reason beside the skip.
  The 18 fuzz properties share one fixed seed, so a failure replays exactly; 15 of them run 1,000
  cases by default, which a separate CI job raises to 20,000, and three run 50 or 100, each with
  the reason beside it. The other property tests run 60 to 5,000 cases each, some from a fixed seed
  and some from a fresh one, and fast-check prints the seed when one fails.
- **Every property at depth, nightly.** Every property takes its count and seed through one helper
  that reads `COSYTE_PROPERTY_RUNS` and `COSYTE_PROPERTY_SEED`, and a test fails when a property
  does not. Each night a CI job runs the whole suite with every property at 10,000 cases, from a
  seed it prints first, so the night draws other cases than a pull request does and can be
  replayed; a failure also prints the seed and path that replay its one case.
- **The safety readout's properties** plant what the readout must never call safe at random depth
  in random synthetic documents, in JSON and XML: a resource of no type or of a type it does not
  assess, a stray `resourceType`, and an element the FHIR definitions do not define. Each runs 1,000
  cases with a fixed seed in the suite, and the same CI job that raises the fuzz properties runs
  them at 20,000, on every pull request and nightly. A separate CI job fetches the R4 and R4B
  definition files at a pinned commit, checks their SHA-256, and re-derives the element table the
  readout is held to.
- **The three properties every Cosyte parser proves** run on the generators we publish at
  `@cosyte/fhir/arbitraries`, in ten checks. Round trip: in JSON, a resource read back from
  what the writer wrote is the same model, every decimal by its exact text, and writing it again
  gives the same bytes; in XML, where the reader keeps every value as text, the model read back is
  equivalent under `nodesEquivalent`, and writing it again gives the same bytes. Idempotent
  normalize: writing what was read, twice, gives what writing it once gave, for messy and hostile
  JSON and XML. Never throws: hostile input becomes a model with registered issue codes, or a
  documented fatal error, and nothing else. A further check holds the generator to account: every
  generated resource reads with no repair and validates with no error in strict mode. Each runs
  100 cases from a fresh seed, `COSYTE_PROPERTY_RUNS` sets a deeper run, and a failure prints the
  seed and path that replay it. [Property-test your code](./property-test-your-code.md) shows those
  generators on code of your own.
- **The coverage gate** runs with the suite, and `cosyte-ratchet` holds it to `quality-floor.json`
  in its own CI job. A floor that is not met fails the pull request, and so does a change that
  lowers or removes one: a floor only rises.
- **Mutation testing** runs on every pull request over the source files it changes, and every
  mutant in the changed lines must be killed or carry a comment naming why it cannot be. Twice a
  week a CI job mutates every source file, split across sixteen runners, and fails if the score is
  below its floor.
- **Differential testing** runs as its own CI job on every pull request and on `main`. It pins the
  reference validator to one release and fetches the third-party corpora with a checksum for each
  document, so a run is repeatable; a second step compares a declared subset twice and fails unless
  both runs agree byte for byte.
- **The PHI scan** runs on every commit (a pre-commit hook) and in CI.
- **The examples** under `examples/` are built, type-checked and run in CI, and each checks its own
  output.

## Run them yourself

```bash
pnpm install --frozen-lockfile
pnpm test               # unit tests, corpus, FHIRPath suite, properties, fuzzing and doc samples
pnpm test:coverage      # the same suite with the coverage gate
pnpm phi-scan           # the PHI scan over the repository
pnpm quality:check      # coverage against quality-floor.json, after test:coverage
pnpm mutate changed --base origin/main   # mutate the source files a change touched
pnpm quality:mutation --base origin/main # and judge their mutants
COSYTE_PROPERTY_RUNS=10000 pnpm test     # every property at the nightly depth
```

`pnpm mutate:full` mutates every source file, the run CI splits across sixteen runners twice a week.

The differential needs Java and the reference validator's jar, which it finds through an environment
variable; `pnpm corpus:fetch` fetches the third-party corpora, and the `differential` job in the
repository's [CI workflow](https://github.com/cosyte/fhir/blob/main/.github/workflows/ci.yml) shows
every step, including how the fuzz job raises its case count.

## Current numbers

The numbers for this section are measured on `main` at each release and filled in when the release
is built. They are never typed by hand.
