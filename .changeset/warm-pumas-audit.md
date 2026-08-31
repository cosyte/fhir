---
"@cosyte/fhir": patch
---

The pending release set is classified against a written rule, and a check refuses to report the tree
ready when the files disagree with it (`FHIR-RELEASE-PREP-1`).

The next version is not a decision anyone states; it is derived from the bump levels sitting in
`.changeset/`, and a set that is entirely `patch` derives a patch however the release notes read.
Five changesets were pending, all five declaring `patch`, and three of them are not patches under any
reading of what they changed: one withdraws an XML round trip from a document that reads
`valid: true`, one adds an optional member to a public type plus two new exports, and one widens the
finding set over six resource types the structural validator previously did not check at all. Left
alone the set would have derived a patch and shipped two withdrawals of previously working public
behavior inside it, undeclared.

Those three now declare `minor`, edited on the bump level line with their prose untouched. On a `0.x`
line the minor position is the only place a break can be signalled at all, which is why a withdrawal
is `minor` at minimum here rather than something a caller could read as a fix.

`scripts/release-readiness.mjs` reads the pending set and refuses rather than reports. An empty or
absent directory, a file with no parseable frontmatter, one naming another package, one declaring a
level outside the three, one declaring `major`, one nobody has classified, a classification whose
file is gone, a declared level that disagrees with the classification, and a break candidate riding
out as a patch are each named with the file and the defect and each exit non-zero. None is skipped,
counted anyway, or defaulted to a level. The classification itself is committed data rather than
inferred from prose, because deciding whether a paragraph describes a withdrawal is a judgement and a
keyword matcher would be a second place that judgement lives and the first place it is wrong.

The public surface a consumer may depend on is certified as data and pinned in both directions: a
certified name absent from the entry point fails, and an entry point export nobody certified fails
too, so neither a removal nor an uncertified addition passes silently. A name that changes between a
runtime value and a type-only export fails on the kind alone, because a consumer's `import` breaks on
that even though the name survives, and the `exports` subpath set is pinned beside it.

No library code changed and nothing here ships in the published artifact. No version was bumped, no
changeset was consumed and nothing was tagged or published: the version bump belongs to the release
pipeline, taken later, from the changesets this leaves correctly classified.
