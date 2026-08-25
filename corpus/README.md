# The differential corpus

`corpus/corpus.json` is the declaration the `validator_cli.jar` differential runs over. It is not
ten in-tree fixtures any more. It is **three corpora, and only the first was written here**:

| corpus                 | version                                     | licence      | authored    |
| ---------------------- | ------------------------------------------- | ------------ | ----------- |
| `cosyte-fhir-fixtures` | in-tree at the commit under test            | `MIT`        | this repo   |
| `fhir-test-cases`      | tag `1.7.67` (`0d7196d7…`)                  | `Apache-2.0` | third party |
| `hl7-fhir-r4-examples` | FHIR R4 `4.0.1`                             | `CC0-1.0`    | third party |

Every declared document records which corpus it came from, that corpus's exact pinned version, that
corpus's licence identifier, its byte count and its SHA-256. Licence texts and the attribution each
corpus requires are in `licences/`.

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
reason. `test/differential-corpus.test.ts` grades the declaration's shape, its provenance and its
floor.

**Do not close a disagreement by loosening what the validator reports.** If a document exposes a
finding this library cannot currently resolve, exclude it with the reason recorded and make the
shortfall up elsewhere. And do not hand-author a document to reach the floor: ADR 0018 requires a
real, publicly cited artifact behind every fixture, and a hand-written corpus would satisfy the count
while destroying its meaning.

## What the number buys, stated narrowly

Over resource types this library does not model it emits an informational `RESOURCE_NOT_MODELED` and
no error, so agreement at scale mostly means "we invented no error on a real document the oracle
finds clean". The safety-critical direction, **never a false valid**, is what the corpus makes harder
to satisfy by accident, and it stays enforced hard. The shared corpus labels its own `r4` half "not
maintained": breadth there is not currency.
