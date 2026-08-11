# The bytes git carries, as a union with the walk (2026-08-11)

`PHI-SCAN`. **A walk reads the WORKING TREE, and that is not what a commit contains.**

Relocated out of `agent-notes.md`, which is at its own budget. The cursor there points here.

## The premise this slice was dispatched on was wrong, and the measurement is the finding

The coordinator's survey scored this copy at **2 `ls-files` + 1 `reconcile`**, "the thinnest
reconciliation of the eight remaining copies". Re-measured in-repo: the two `ls-files` occurrences
are one comment and one call, and the word `reconcile` appears only in prose: the mechanism is
named `trackedInScope` / `refuseUnobserved`. **A text census scores the vocabulary, not the
mechanism.** Measured against the four escape shapes a sibling reproduced at `exit 0`, this copy was
one of the STRONGEST, not the thinnest:

| shape                                                        | base result                                                                |
| ------------------------------------------------------------ | -------------------------------------------------------------------------- |
| a tracked path occupied by a **directory** of decoys         | **exit 2**, already closed                                                 |
| a whole walk root swapped for a decoy directory              | **exit 2**, already closed                                                 |
| **most** tracked files absent from the working tree          | **exit 2**, already closed (no floor-of-one to fool)                       |
| a **gitlink** under a walk root whose working tree is absent | **exit 2**, already closed                                                 |
| a path under the walk's skip rule (`.md`) at any depth       | **exit 0**, the exemption, applied symmetrically to both routes, by design |
| `--staged` over an **unmerged** path                         | **exit 2**, already closed, keyed on status `U`                            |

**The unmerged axis, which broke a sibling's draft, was already closed here** and needed no port.
**Reproducing a state space and reporting "already closed" is the result**; the temptation is to
credit a route with a state it did not close.

## The two states that WERE open, both measured

1. **A fixture `git add`ed and then scrubbed in the working tree scanned clean at `exit 0`**, while
   `git commit` would have committed the staged blob. The sweep only ever read the working tree.
2. **33 tracked non-markdown files sit outside `test/` and `src/` altogether**: `scripts/`,
   `.github/`, `docs-content/`, `.changeset/`, the root manifests. Neither the walk nor
   `refuseUnobserved` mentioned them, because that reconciliation's pathspec is limited to the walk
   roots. **Two of the 33 carried bytes this scanner's own recognisers report.** Real unscanned
   corpus, and this is the `astm` shape rather than the `ccda` one.

## The remedy, and the two things it is not

`all` mode enumerates **both** routes. **Union, never replacement:** the walk alone sees
**untracked** working-tree content; the index alone sees what is **staged** and what lives **outside
the roots**. **WALK_ROOTS did not move**, and no refusal was retired: the floor-of-one stays keyed
on the walk, because the state it names is "no repository to ask and nothing on disk either", and an
index route that happened to find blobs would make it unreachable in exactly the case it exists for.

**Dedup is by CONTENT under git's `blob <len>\0` framing, never by path.** Measured on a clean
checkout at the commit that closed this: **202** in-scope index entries, **167** already scanned by
the walk, **35 fetched**, so a clean checkout SCANS nothing twice. Convert one tracked file's working
copy to CRLF and the fetch count goes **35 to 36**, both copies scanned. **That is the EOL axis**,
and a path-keyed dedup would have picked one of the two byte streams and called it the corpus.
**THESE NUMBERS MOVED ONCE ALREADY, INSIDE THIS SLICE, AND THAT IS WHY THEY ARE SPELLED OUT.** The
first draft measured 169 scanned and 33 fetched; excluding declared paths from the observed set
(below) drops two files out of "scanned" and adds their blobs to "fetched", and the corrected slice
left the old pair standing in four carriers until a gate caught it. **Re-derive, never copy.** Note
also that `cat-file` IS invoked on a clean checkout, for the out-of-root blobs; the property is that
nothing is scanned twice, not that git is never asked. The object-id algorithm is **asked
for** (`git rev-parse --show-object-format`), never assumed: a SHA-256 repository would match nothing
and quietly scan everything twice.

**THE KEY IS THE OBJECT ID _AND_ THE DETECTOR, AND THE FIRST DRAFT SHIPPED WITHOUT THE SECOND HALF.**
A gate found two states against an oid-only key, **both at exit 0**, and both are worth carrying:

- **The detector is a property of the PATH, not of the bytes.** `scanTarget` sends a fixture to the
  structured FHIR scan and a `.ts` file to the source pass, and the source pass deliberately does not
  key `identifier.value` or `telecom.value`. One payload committed at `test/__fixtures__/leak.json`
  and at `src/decoy.ts` was "observed" at the weaker path, so the fixture blob carrying an
  SSN-shaped `identifier.value` was never fetched. **An oid-only key silently applies the WEAKEST
  detector any path holding those bytes gets.**
- **An exempt path's bytes were never scanned at all.** A `SENTINEL_FILES` entry is walked but
  dropped before any detector runs, and it is exempt precisely BECAUSE it carries
  realistic-PHI-shaped strings. Hashing it into the observed set let it vouch for an identical copy
  at a path with no exemption, and **that one is not even convergent** -- a sentinel is never fixed.

So the observed set holds `<oid>\0<detector>` for the files that were actually SCANNED, `scanKindOf`
is the ONE dispatch table (`scanTarget` reads it too, so the key cannot drift from what runs), and a
declared path contributes nothing. It is still ENUMERATED by both routes and dropped by `main`, so
the exemption is still announced -- **deduped**, since a declared path can now arrive twice.

**The lesson generalises past this scanner: a dedup is only as sound as its notion of "already
done", and "already read" is not "already scanned".**

**The unmerged case keys on the ABSENCE OF STAGE 0, and that is not how `--staged` spots one.**
`git diff --cached --raw` gives status `U` and destination mode `000000`; **`git ls-files -s` gives
stages 1/2/3 with ORDINARY blob modes and no `U` anywhere**, so a reader that takes the first record
gets **the merge base** and reports on it as what git carries. Every stage is read and labelled with
its own number. Pinned by a case whose payload lives **only in stage 3**, and by a second whose
payload lives only in stage 1 and must be labelled as such.

**A mode the index carries that is not a regular blob refuses the scan (exit 2), repo-wide.** That
is the half covering a link or a gitlink **outside** the walk roots, which no route reached before
(measured, exit 0 on base for both).

## The two hits the wider corpus produced, and why neither was answered with a rule

- `hello@cosyte.com` in `package.json` → **`EMAILDOMAIN cosyte.com`**. Not a reserved domain: it is
  ours, which is the reason it is declarable, and the blast radius is one domain.
- `JOHN_SMITH@Mercy.org` in this scanner's own docblock → **`scripts/phi-scan.ts` declared in
  `SENTINEL_FILES`**, by literal path, logged in `phi-scan-overrides.md`. **The token-level remedy
  was measured worse:** an allow-list entry is global and route-blind, so `EMAILDOMAIN mercy.org`
  would admit a plausible real hospital domain in a fixture. **Exclude a literal path; never infer a
  class.** The file sits outside every walk root, so no route opened it before: a newly _declared_
  blind spot, not a newly _created_ one. Its cost: a change to that file is reviewed by a human and
  not by the gate it implements.

## The positive control, which is the part worth copying

A gate never seen red is indistinguishable from one that cannot go red. So the control is built from
**this repository's own tracked path list**: same paths, same directory shapes, same extensions,
same in-root / outside-root split, with placeholder bytes so no fixture is copied anywhere. It
asserts the mirror **clears** (so a hit is the payload and not the shape), then plants a payload in
**every** non-exempt path at once and asserts **every one of them is named in a single run**, with
the markdown and sentinel paths silent. **The payload is made unique per path on purpose**: one
payload written to every path is ONE blob under content-keying, scanned once, and the case would then
assert nothing about the rest. A third arm plants the payload only in an **index blob** at a path
outside every walk root and scrubs the working copy, so only the new route can find it.

The mirror sets `core.hooksPath` to a path that does not exist. It reproduces every tracked path,
`.npmrc` among them, and a developer machine or CI image may carry a global pre-commit hook with an
opinion about such a filename, which is an opinion about the environment, not about this scanner.

## Declared, not closed

The `.md` exemption still hides a payload at any depth, on **both** routes, and that is the design
("docs may legitimately describe violator values"). Grounded rather than assumed: **every tracked
markdown file that carries a violator string is documentation ABOUT this scanner.** Dropping the
exemption would red the gate on exactly the files that explain it.

**STATE THAT PREDICATE, NEVER THE LIST OR THE COUNT, AND BOTH MISTAKES WERE MADE HERE IN ONE SLICE.**
A draft quoted "46 tracked markdown files, 3 carrying violator strings" -- the BASE measurement,
already false at the commit that shipped it, because the slice adds markdown files of its own. Its
replacement named the files instead and was short by one within the same slice, for the same reason.
A count or a list that moves with the commit stating it is a claim nobody can keep true; the
predicate is stable, checkable in one command, and does not go stale.

Identical bytes at two in-scope paths **that dispatch to the same detector** are one object, so a
payload in both is reported at whichever the sweep read first. The exit code is unaffected, and
fixing the reported copy leaves the other object unobserved, so the next run names it, which is
pinned. **The three qualifiers are the whole sentence**: drop any one of them and this is the claim a
gate falsified, above.

**Untracked content outside the walk roots remains invisible to both routes.** The index cannot see
it because it is untracked, and the walk cannot because it is outside the roots. Unchanged by this
slice, and stated because the union closes the tracked half of that sentence and not the other.

**`all` MODE IS NOW REPO-WIDE AND `--staged` IS NOT, SO THE TWO ROUTES DISAGREE BY 33 TRACKED
FILES.** Measured: a staged `docs-content/leak.json` carrying a dashed SSN is exit 0 on the hook and
exit 1 in CI (on base both were 0). The direction is the safe one, CI stricter than the hook, and it
is the inverse of the shape that comment was written about, which was CI blind where the hook
reported. **But do not read that as agreeing with the comment**, which carries a second argument
that is direction-blind: "keeping the two routes on different scopes would mean the hook and CI
disagree about what the corpus is, which is the state that let the hole sit unnoticed". By that
argument this divergence is a real cost, and it is being ACCEPTED rather than argued away.
**It is left open deliberately**: widening `--staged` is a HOOK decision
that changes what a commit is BLOCKED on, declined three times across this suite with the cost
measured, and taking it as a side effect of a scan widening is exactly how it would arrive ungraded.
