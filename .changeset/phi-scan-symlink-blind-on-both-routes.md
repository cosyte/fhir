---
"@cosyte/fhir": patch
---

Refuse a non-regular entry under a PHI scan root, instead of reading a symbolic link as clean on
both enumerating routes (`PHI-SCAN-SYMLINK-BLIND-ON-BOTH-ROUTES`, the shipped `terminology` fix
ported here and re-measured).

**Reproduced on `810eec9` with a synthetic, name-bearing payload** held outside the walk roots and
linked from `src/leak.ts`: the all-mode sweep printed `OK, no hits` and exited **0**, `--staged`
after `git add` did the same, and naming the target explicitly exited **1** with both hits. The
payload was always detectable. Neither sweeping route ever looked at it.

Two mechanisms, blind in two different ways. `walk()` enumerates `Dirent.isFile()`, which is an
lstat answer, so a symbolic link is neither a file nor a directory and fell out of the loop in
silence; `isDirectory()` is an lstat answer too, so a linked **directory** took a whole subtree with
it (measured: a link to a directory holding the same payload, exit 0). And `--staged` reads content
with `git show :<path>`, while git stores a symbolic link as its **target path** under mode
`120000`, so that route was handed a few dozen bytes of path text and never the target's bytes. That
route is this package's pre-commit hook. It is also where the FHIR-aware structured scan runs, so a
link staged at `test/__fixtures__/patient.json` was handed path text, failed `JSON.parse`, and fell
through to the conservative pass over the path (measured, exit 0).

**Neither route is made to follow the link.** Following would read bytes the enumeration does not
control (outside the repo, a loop, a device, a FIFO that blocks the gate forever), and git does not
carry those bytes anyway, so a hit on them would be a claim about something no commit contains. The
enumeration is narrowed instead: an **enumerated** in-scope entry that is not a regular file
**refuses the scan** (exit 2), naming **every** offender rather than the first. "Enumerated" is
load-bearing rather than decoration: this narrows what each route _admits_ from what that route
already _lists_, so an entry a route never lists is not reached by the refusal either, which the
rename residual below spells out. `--staged` now reads
`git diff --cached --raw -z` so the destination mode is visible, and refuses mode `120000` and
`160000` before any read.

A refusal names the entry's own repo-relative path and an engine-owned token for its kind. **It
never reports the link target**, which is working-tree text that can itself carry PHI: a target path
of the shape `../patients/<surname>-<given>-<dob>.txt` is the whole reason, and the shape is written
out rather than shown because a diagnostic about a PHI leak is itself a PHI surface.

**The one-letter hole in the filter, and the reason `T` is in it.** `--diff-filter=AM` drops status
`T`. Replacing a **tracked** regular file with a link is neither an add nor a modify: git raises
`:100644 120000 <sha> <sha> T`, so the record died before any mode could be read and the hook passed
a mode-`120000` blob green (measured on `810eec9`: `git diff --cached --raw --diff-filter=AM` prints
nothing for that staging, and the scan exited 0). Admitting `T` also closes the reverse typechange, a
tracked link replaced by a real file carrying PHI, which the same letter dropped (measured, exit 0 on
base, exit 1 now). Typechange carries a single path, exactly like `A` and `M`, so admitting it costs
the record stride nothing.

**"In scope" is each route's own existing boundary, not a new one.** The walk still excludes a
gitignored entry, the same rule that already excluded a gitignored file, so links get no second and
stricter boundary of their own; `--staged` still looks only at `test/__fixtures__/**` and
`src/**.ts`. This narrows what those scopes admit and does not widen the scopes. A path named
explicitly on the command line is deliberately unchanged and still followed: that is the caller's own
request to read whatever is there, and it errs toward scanning more.

**One behaviour improves rather than changes.** A staged **gitlink** already refused on base, but by
way of an uncontrolled `git show` failure (`fatal: bad object`) that named no kind. The mode is read
first now, so the refusal is the scanner's own and says what it found.

`test/scripts/phi-scan.test.ts` is new: 30 cases, **14 red on `810eec9`**, each running against a
throwaway git repository rather than this one. The payload carries a person name, a date of birth,
an SSN shape and an email, because a payload with no name proves nothing about a claim that names do
not leak, and every refusal case asserts those tokens are absent from the message.

**Two residuals, disclosed rather than fixed, and pinned as behaviour rather than prose.** A staged
**rename** is not enumerated by the `--staged` route at all: `R` and `C` are the only statuses
carrying a second path and both are excluded, which is identical to the `--name-only --diff-filter=AM`
this replaces. Admitting them needs the two-path record shape handled, a scope decision rather than
this one; a record that fails to parse refuses rather than being skipped. Reachability depends on
git's own rename detection, which is on by default for `git diff` (git 2.39.5): a rename staying
above the similarity threshold is reported `R` and vanishes, while one below it is reported as a
delete plus an add and the **add is scanned normally**. Both halves are asserted.

**And that residual's cost is not only unscanned content**, which is worth stating because the
obvious wording understates it: a record this route never lists cannot reach the new mode check
either, so an **already-tracked symbolic link moved from outside the scope to inside it** (`git mv`,
raised `R100` with mode `120000` on both sides) lands in scope and is not refused on this route.
Measured here, and identical before this change. It is bounded in the direction that matters: git
does not pair a deleted regular file with an **added** link even at an identical blob oid (that
stays `A`, and is refused), so a _new_ link cannot arrive this way, and the all-mode walk refuses
the resulting working tree (measured, exit 2).

Separately, this
package has never carried a sibling's rule refusing an all-mode sweep that observed **no** files;
nothing was softened, the rule was simply never here, and it is now pinned so the gap is a measured
fact.

**The enumerate-then-read window is deliberately left alone.** In this package a file that vanishes
between enumeration and read makes the scan **refuse** (exit 2), which is the safe direction, so it
is an availability question rather than a PHI-safety one. The sibling defect that motivated closing
it elsewhere was a build transient at the repository root, and this package's walk roots are `src/`
and `test/__fixtures__/`: the transient was measured landing at the repository root
(`tsup.config.bundled_<hash>.mjs`), outside both. Closing it would mean adding tolerance to a PHI
gate in the same change that narrows one, which is the wrong two things at once.
