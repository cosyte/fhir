# The differential corpus

`corpus/corpus.json` is the declaration the `validator_cli.jar` differential runs over. It is not
ten in-tree fixtures any more. It is **three corpora, and only the first was written here**:

| corpus                 | version                          | licence      | authored    | declared | compared |
| ---------------------- | -------------------------------- | ------------ | ----------- | -------- | -------- |
| `cosyte-fhir-fixtures` | in-tree at the commit under test | `MIT`        | this repo   | 10       | 10       |
| `fhir-test-cases`      | tag `1.7.67` (`0d7196d7`)        | `Apache-2.0` | third party | 73       | 43       |
| `hl7-fhir-r4-examples` | FHIR R4 `4.0.1`                  | `CC0-1.0`    | third party | 183      | 126      |

**266 declared, 179 compared, 87 excluded**, and 169 of the 179 are third party, so the floor of one
hundred clears without counting a single document written here. Every declared document records
which corpus it came from, that corpus's exact pinned version, that corpus's licence identifier, its
byte count and its SHA-256. Licence texts and the attribution each corpus requires are in
`licences/`.

## The exclusion rate is the honest headline

**87 of 266 declared documents are excluded, and every one carries the reason it was excluded**,
printed on every run. They are not noise and they are not a convenience: they were each measured
against `validator_cli` 6.10.2, and the reason records the release, the date, the error count, the
class breakdown by `OperationOutcome.issue.code`, and the first locations.

The classes are almost entirely one thing: **URL and canonical resolution**. The reference validator
resolves `identifier.system`, `url`, `instantiatesUri`, `library`, `relatedArtifact.resource` and
`Attachment.url`, and this library does not, says so, and has always said so. A handful of
exclusions sit outside that class and their codes say so (`structure`, `invariant`, `business-rule`,
`not-found`, `unknown`).

**Six exclusions came back, and terminology is now a rule instead of a snapshot.** Six documents were
held out because the reference validator reported `code-invalid` and nothing else: a code checked
against terminology content this library declaredly does not vendor. An exclusion measured on one
date against what a remote terminology service happened to answer is a snapshot, not an invariant,
and a document whose terminology finding appeared after that date was never on the list. So those six
are compared, and a terminology-attributable finding is classified out of both differential
invariants under a recorded `terminology` class, counted and printed per document. The class keys on
the validator's own vocabulary and on nothing else, and an oracle error or fatal outside it, on a
document this library reports clean, is still a false valid and still fails the run. Exclusions
naming any non-terminology class are untouched, and `test/differential-corpus.test.ts` fails if an
exclusion whose only recorded class is `code-invalid` ever reappears.

So the number a consumer can quote is **179 real documents from three public corpora on which this
library and the reference validator were shown to agree, within a recorded terminology delta**, next
to **87 on which they did not, each with the disagreement recorded**. Reading only the first number
is reading half of this file.

## The terminology inputs are declared, and the verdict is repeatable

A differential verdict is supposed to be a property of the document bytes and the identified oracle
artifact. It was also a property of the weather: the reference validator's terminology server option
defaults to the public `https://tx.fhir.org`, so the same commit over the same corpus produced three
`FALSE VALID` verdicts on one day and none on another with nothing having moved.

Each run now DECLARES its terminology inputs (`scripts/differential/terminology.mjs`), spells both
terminology options into the oracle's argv, and audits that argv before a single document is staged.
What this repository declares is **`source: "none"`**: `-tx n/a` and `-txCache n/a`, the sentinels the
pinned release documents for "run without terminology". No terminology content is pinned here, which
matches what the library itself does and keeps a third party's code-system content out of a history a
revert does not reach. If any terminology question would remain answerable over a network, or if the
declared inputs cannot be honoured exactly, the run compares nothing, names the condition and exits
non-zero. It never substitutes another terminology source.

`pnpm differential:determinism` then MEASURES it: two comparisons of the declared subset
(`determinismSubset` in `corpus/corpus.json`) against the same artifact under the same inputs, passing
only when the two run records are byte-identical. A run record carries the oracle identity, the
terminology inputs, the corpus and one line per document, and no wall-clock time, no staging path and
no run ordinal. The check reports **determinism NOT demonstrated** and exits non-zero for every
condition it cannot rule out, including a missing jar and a document that yielded no readable outcome;
there is no silent skip. It repeats a subset rather than the corpus because the differential job
carries a declared thirty minute bound, and it prints every repeated document id so the log says what
determinism was demonstrated over.

## The documents are fetched, never committed

`pnpm corpus:fetch` retrieves the third-party documents into `corpus/documents/`, which is
git-ignored, and verifies every one against the digest the declaration records. Nothing under
`corpus/documents/` ever enters this repository's history.

**That is a safety decision before it is a licensing one.** Real FHIR examples spell `family`,
`given`, `birthDate` and `line`; this repository's PHI scanner sweeps what git carries repo-wide and
gives anything outside `test/__fixtures__/` the source pass, so vendoring the documents would force a
token-level allow-list entry per name and date in someone else's corpus. The allow-lists are
declarations about **self-authored synthetic fixtures**, and widening them to swallow third-party
document content would weaken a live control permanently, because content committed into git history
is not undone by a revert. **The layout changed instead of the safety control**: `scripts/phi-allow-list.txt`
and `phi-scan-overrides.md` are byte-identical to what they were before this corpus existed.

## Adding or removing a document

Edit `corpus/corpus.json`. A document needs `id`, `corpus`, `path`, `bytes` and `sha256`; a document
that is declared but must not be compared needs an `exclude` string saying **why**, which is printed
on every run and never counts toward the compared count. A label is refused; the reason has to be a
reason. `determinismSubset` names the documents `pnpm differential:determinism` repeats, and every id
on it must be a document the differential compares. `test/differential-corpus.test.ts` grades the
declaration's shape, its provenance, its floor and that subset.

**Do not close a disagreement by loosening what the validator reports.** If a document exposes a
finding this library cannot currently resolve, exclude it with the reason recorded and make the
shortfall up elsewhere. And do not hand-author a document to reach the floor: ADR 0018 requires a
real, publicly cited artifact behind every fixture, and a hand-written corpus would satisfy the count
while destroying its meaning.

**Do not exclude a document to make a run deterministic, either.** Determinism bought by comparing
less is not determinism; the compared count may rise and may not fall, which is what
`test/differential-corpus.test.ts` pins. A terminology finding is a recorded class, not grounds for
an exclusion: an exclusion whose only recorded class is `code-invalid` fails that suite.

## What the number buys, stated narrowly

Over resource types this library does not model it emits an informational `RESOURCE_NOT_MODELED` and
no error, so agreement at scale mostly means "we invented no error on a real document the oracle
finds clean". The safety-critical direction, **never a false valid**, is what the corpus makes harder
to satisfy by accident, and it stays enforced hard. The shared corpus labels its own `r4` half "not
maintained": breadth there is not currency.
