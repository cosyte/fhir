---
"@cosyte/fhir": patch
---

The `validator_cli.jar` differential compares 173 documents from three corpora instead of
ten in-tree fixtures, prints the count it compared and the identity of the oracle it compared
against, and fails rather than reporting success over a smaller corpus (`DIFF-CORPUS-2`).

At the base commit the gate ran over two arrays inside `scripts/differential.mjs`: five synthetic
spec-clean fixtures and five Tier-2 quirk fixtures, ten documents, all ten written here. A consumer
could be told the gate existed and could not be told what it covered. The corpus is now declared in
`corpus/corpus.json` and is three corpora, of which only the first was authored in this repository:
those same ten fixtures, kept in full; `FHIR/fhir-test-cases` at tag `1.7.67`, commit
`0d7196d75a85626383d697d34825bcd33f541b87`, Apache-2.0, which is the corpus the reference
validator's own build pins itself against; and the FHIR R4 `4.0.1` specification's own published
examples, CC0-1.0. 266 documents are declared, 173 are compared and 163 of those 173 are third
party, so the floor of one hundred is cleared without counting a single self-authored document.
Nothing was hand-authored to reach it: every document traces to a real, publicly cited artifact,
which is the anti-invention rule and not a preference.

The third-party documents are fetched and digest-verified rather than vendored. `pnpm corpus:fetch`
retrieves them into a git-ignored directory and refuses any document whose SHA-256 is not the one
the declaration records; the archive one corpus is published in is refused on its own digest before
a single entry is read. That is a safety decision before a licensing one. Real FHIR examples spell
`family`, `given`, `birthDate` and `line`; the PHI scanner sweeps what git carries repo-wide and
gives anything outside the fixture directory its source pass; and its allow-lists are declarations
about self-authored synthetic fixtures. Vendoring would have forced a token-level entry per name and
per date of birth in someone else's corpus, permanently, because content committed into git history
is not undone by a revert. The layout changed instead of the safety control: `scripts/phi-allow-list.txt`
and `phi-scan-overrides.md` are byte-identical to what they were, and the scan is clean with the
whole corpus on disk. Each third-party corpus's licence text and the attribution it requires are
carried beside the declaration that names it.

The oracle is obtained at a fixed release rather than from `releases/latest`, and the identity
recorded beside every result is derived from the jar's own bytes, so substituting a different
artifact changes the record even when the configured version string does not. An oracle whose
identity cannot be established is refused rather than compared against: no path, no file, a
directory, an empty file and an unreadable file are all "not identified". The CI job carries a
declared time limit rather than the runner's default, so a corpus that cannot finish fails visibly.

A missing answer is never agreement. A document is counted as compared only when both the oracle's
outcome and this library's own findings were obtained; a crash, a timeout, output that does not
parse, output that is not an outcome, and an outcome that cannot be attributed to exactly one
document all leave it uncounted and, separately, not clean. Attribution is by the file name the
validator records, or by finding exactly one staged name in the outcome; two matches is ambiguity
and is resolved as "no outcome" rather than by guessing. Below the declared floor of one hundred the
run exits non-zero and names the shortfall.

93 of the 266 declared documents are excluded, every one with its reason recorded and printed on
every run, and the exclusion rate is part of the result rather than a footnote to it. Two are
principled from the start: one the corpus itself ships as a negative case, and one that exposes a
modifier extension this library declines to affirm and the reference implementation resolves. The
other 91 were measured against the reference implementation at the pinned release and each reason
records the release, the date, the error count, the class breakdown by issue code and the first
locations. The classes are almost entirely one thing: the reference implementation resolves
canonical URLs and checks display strings and code membership against terminology content, and this
library does neither and has always said so. A handful sit outside that class and their codes say
so. None of the 93 was answered by relaxing what this library reports, and the reference
implementation was not reconfigured to report less; the exclusion mechanism refuses a label in place
of a reason. Both invariants are unchanged and still enforced hard, the fail-closed parse-refusal
exemption to the second included, and it is still scoped to a reader refusal and not to a validation
error.

What the number buys is bounded and the documentation says so rather than letting the count imply
more. Only `Patient` has a built-in structural schema, so over most resource types the library emits
an informational finding and no error: agreement at scale mostly means no error was invented on a
real document the reference implementation finds clean. The safety-critical direction, never
reporting clean what the reference implementation errors on, is what a corpus this size makes harder
to satisfy by accident. The shared corpus labels its own R4 half unmaintained, so breadth there is
not currency.

The gate remains CI-only and has still never been observed green in the dev container, which has no
JVM. Run with no oracle configured it prints the corpus and the exclusions it would compare and
skips, and the accounting itself is graded by three new test files that need no build, no Java and
no network. No library code changed; nothing here ships in the published artifact.
