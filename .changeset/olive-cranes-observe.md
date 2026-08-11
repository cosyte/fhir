---
"@cosyte/fhir": patch
---

The PHI commit-gate reads the bytes git carries as a union with its working-tree walk, so a staged
blob and a tracked file outside the walk roots are no longer reported clean over (`PHI-SCAN`).

Two states were measured at the base commit, and neither is exotic. A fixture `git add`ed and then
scrubbed in the working tree scanned clean and exited 0, while `git commit` would have committed the
staged blob: the sweep only ever read the working tree, and a working tree is not what a commit
contains. And 33 tracked non-markdown files sit outside `test/` and `src/` altogether -- `scripts/`,
`.github/`, `docs-content/`, `.changeset/`, the root manifests -- so neither the walk nor the index
reconciliation mentioned them, that reconciliation's pathspec being limited to the walk roots. Two
of the 33 carried bytes the scanner's own recognisers report.

The sweep now enumerates both routes, as a union and never a replacement. The walk alone can see
untracked working-tree content; the index alone can see what is staged and what lives outside the
roots. The walk roots did not move and no refusal was retired: the floor that refuses a sweep which
opened nothing stays keyed on the walk, because the state it names is "no repository to ask and
nothing on disk either", and an index route that happened to find blobs would make it unreachable in
exactly the case it exists for.

Dedup is by content under git's own `blob <len>\0` framing rather than by path. On a clean checkout
every index blob hashes to bytes the walk already read, so nothing is scanned twice and `git
cat-file` is never asked for them (202 in-scope index entries, 169 already observed, 33 fetched).
Where the two copies of one path differ, both are scanned: with `core.autocrlf` or a
`.gitattributes` `text` attribute the working file is CRLF and the blob is LF, so they are two byte
streams and a hit in one is not evidence about the other. Converting one tracked file's working copy
to CRLF moves the fetch count from 33 to 34. The object-id algorithm is asked for rather than
assumed, because a SHA-256 repository would match nothing and quietly scan the whole corpus twice.

The dedup key is the object id and the detector the path dispatches to, and neither half is
optional, because the detector is a property of the path rather than of the bytes. `scanTarget`
sends a fixture to the structured FHIR scan and a `.ts` file to the source pass, and the source pass
deliberately does not read `identifier.value` or `telecom.value`; an object-id-only key therefore
let an identical `src/decoy.ts` vouch for a fixture blob carrying an SSN-shaped identifier, and let
a declared sentinel file -- exempt precisely because it carries PHI-shaped strings, and never
"fixed" -- vouch for an identical copy at a path with no exemption. Both states printed `OK, no
hits` at exit 0 and both are now pinned by tests. The dispatch lives in one function that the
scanner and the dedup key both read, so the key cannot drift from what really runs. A declared path
contributes nothing to the observed set, is still enumerated by both routes, and its exemption is
still announced, once. What remains, narrowly: identical bytes at two in-scope paths with the same
detector are one object, reported at whichever the sweep read first, with the exit code unaffected
and the next run naming the other.

An unmerged path is keyed on the absence of stage 0, which is not how the `--staged` route spots
one. `git diff --cached --raw` reports it as status `U` with destination mode `000000`; `git
ls-files -s` reports the same path at stages 1, 2 and 3 with ordinary blob modes and no `U`
anywhere, so a reader that takes the first record it sees gets the merge base and reports on it as
though it were what git carries. Every stage is read and every stage is labelled with its own
number. The `--staged` route still refuses over such a path, unchanged, because that route has to
name one blob and there is none.

A mode the index carries that is not a regular blob refuses the scan repo-wide: for mode 120000 the
object is the link's target path and for 160000 there is no object in this repository at all. That
covers a link or a gitlink outside the walk roots, which no route reached before (measured, exit 0
at the base commit for both).

Four escape shapes a sibling scanner reproduced at exit 0 were measured here and were already
closed: a tracked path occupied by a directory of decoys, a whole walk root swapped for a decoy
directory, most tracked files absent from the working tree, and a gitlink under a walk root whose
working tree is absent. All four refuse with exit 2 at the base commit. The unmerged axis was
already closed too. Reproducing the state space and reporting what was already shut is the result;
nothing was widened to manufacture a gap.

The wider corpus produced two hits and neither was answered with a rule. `hello@cosyte.com` in
`package.json` is declared as an allowed email domain: it is this package's own contact address, not
a reserved domain, which is precisely what makes it declarable, and the blast radius is one domain.
The scanner's own source is declared as a sentinel file by exact path, because its docblocks must
spell out the violator values they explain and one of them is a capitalised hospital-shaped domain;
the token-level remedy would have been an allow-listed domain, which is global and route-blind and
would admit that domain in a fixture too. Exclude a literal path, never infer a class. That file
sits outside every walk root, so no route opened it before this change.

A positive control is added, built from this repository's own tracked path list rather than a
hand-written sample: same paths, same directory shapes, same extensions, same in-root and
outside-root split, with placeholder bytes so no fixture is copied anywhere. It asserts the mirror
clears, then plants a payload in every non-exempt path at once and asserts every one of them is
named in a single run, with the markdown and sentinel paths silent. The payload is made unique per
path deliberately: one payload written to every path is a single blob under content-keying, scanned
once, and the case would then assert nothing about the rest.

Declared and not closed: the markdown exemption still hides a payload at any depth on both routes,
which is the design, and every tracked markdown file carrying a violator string is documentation
about this scanner. No count is written down for that, deliberately: a draft quoted one measured at
the base commit, which the slice's own new markdown files falsified before it shipped, and a count
that moves with the commit stating it is a claim nobody can keep true. Untracked content outside the
walk roots remains invisible to both routes. And `all` mode is now repo-wide while `--staged` is
not, so the hook and CI disagree about the corpus by 33 tracked files: the safe direction, CI
stricter than the hook, and left open because widening `--staged` is a hook decision about what a
commit is blocked on, declined three times across this suite with the cost measured, and not one to
take as a side effect of a scan widening.

No library code changed. The scanner is a repository gate and ships in no published artifact.
