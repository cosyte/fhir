---
"@cosyte/fhir": patch
---

The `validator_cli.jar` differential declares its terminology inputs, answers no terminology question
over a network, and proves it by running the comparison twice (`DIFF-DETERMINISM-1`).

A differential verdict is supposed to be a property of the document bytes and the identified oracle
artifact. It was also a property of the day it ran. The reference validator resolves coding displays
and code membership against a terminology server, its documented default is a public network
endpoint, and the harness never passed one, so the same commit over the same corpus put three
documents into the safety-critical false-valid bucket on one run and none on the next with no
document, no library change and no pinned artifact having moved. Pinning the oracle to a release and
identifying it by the jar's own bytes had not been enough.

Each run now declares its terminology inputs, spells both terminology options into the argv the
oracle is actually invoked with, and audits that argv before a single document is staged. What this
repository declares is no terminology source at all: both options carry the sentinel the pinned
release documents for running without terminology. The cache option is not a nicety; an omitted one
is a directory holding whatever some earlier run received from a network on a date nobody recorded.
No terminology content is pinned into this repository, which is the same decision that keeps the
corpus documents fetched rather than committed: content in git history is not undone by a revert, and
a pinned terminology cache would put a third party's code-system content there to answer questions
this library does not answer either. Pinned content is implemented and graded, because the refusal it
carries is part of the contract, and is declared by nothing here. If any terminology question would
remain answerable over a network, or if a declared input is absent, unreadable or the wrong digest,
the run compares no document, names the condition and exits non-zero, and substitutes no other
source.

Terminology disagreement stopped being a verdict and became an accounted class. This library
declaredly vendors no terminology content, so an oracle finding that exists only because the oracle
resolved terminology is a known delta and is now classified out of both differential invariants,
counted, and printed with the document it came from. The classifier keys on the validator's own
vocabulary and on nothing else: the terminology issue-type code system a message id is drawn from,
the issue code the validator emits when a code is not valid in what it was checked against, and a
message id that names terminology. The issue code for an unresolved definition is deliberately
excluded, because the validator also uses it for profile resolution and admitting it would classify a
non-terminology error out of the one direction that may never widen. An oracle error or fatal outside
the class, on a document this library reports clean, is still a false valid and still fails the run.
Where the oracle's only errors are terminology findings and this library reports an error of its own,
the document is recorded under the terminology class rather than becoming a violation the absence of
a terminology finding would have decided.

That replaced a snapshot with a rule, so six exclusions came back and the compared count rose from
173 to 179 of 266 declared, 169 of them third party. Those six had been held out with the terminology
issue code as their only recorded class, measured against what a remote service happened to answer on
one date; a document whose terminology finding appeared after that date was never on the list.
Exclusions naming any other class are untouched, the corpus suite fails if a terminology-only
exclusion ever reappears, and it pins that the compared count may rise and may not fall: determinism
bought by comparing less is not determinism.

Determinism is now measured rather than intended. Every run closes with a run record that is a pure
function of its inputs by construction, carrying the oracle identity, the terminology inputs, the
corpus and one line per document, and no wall-clock time, no staging path and no run ordinal. A new
command runs two comparisons of a declared subset against the same artifact under the same declared
inputs and passes only when the two records are byte-identical. It reports determinism not
demonstrated and exits non-zero for a missing artifact, an artifact it cannot identify, inputs it
cannot honour, no declared subset, or any document that yielded no readable outcome on either run:
two runs that both failed to obtain an answer are not two runs that agreed, and a silent skip would
make a green job mean "the oracle was absent" and "the oracle answered the same way twice"
interchangeably. It repeats a declared subset rather than the whole corpus because the CI job carries
a declared thirty minute bound, it prints every repeated document before it starts so the log says
what determinism was demonstrated over, and every declared document is still digest-verified on both
comparisons.

The gate remains CI-only and has still never been observed green in a container with no JVM. The
terminology refusals, the record's purity, the classification and the never-a-silent-skip rule are
graded by `test/differential-determinism.test.ts` beside the harness's existing suites, all of which
need no build, no Java and no network. No library code changed, the pinned oracle release, the FHIR
version and the loaded implementation guide are where they were, and nothing here ships in the
published artifact.
