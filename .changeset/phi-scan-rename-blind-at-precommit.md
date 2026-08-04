---
"@cosyte/fhir": patch
---

An ordinary `git mv` of a tracked symbolic link into a PHI scan root staged as a rename the commit
gate did not enumerate, so it reported clean over the link and over any substituted name.

`R` and `C` are returned by neither `--diff-filter=AM` nor `AMT`, and git's rename detection is on
by default, so `git mv <link> test/__fixtures__/<name>` staged as `:120000 120000 <sha> <sha> R100`
with two paths and the filter deleted the record outright. The `--staged` route printed `OK, no
hits` (exit 0) over a mode-`120000` entry sitting under a scan root. The cost was not only the mode
check: a record the route never lists is never scanned either, so a rename that also substituted a
real-looking name into the moved file passed the same way.

The remedy is `--no-renames`, not handling a two-path record. The destination then arrives as an
ordinary single-path `A` and the source as a `D` the filter already drops, the two-field stride
becomes structural rather than conditional, and no `R`/`C` record can be produced whatever the
caller's configuration says. Verified under `diff.renames=true|copies|false|1` and
`diff.renameLimit=1`.

The copy half is real, not a theoretical arm: under `diff.renames=copies` a PHI-bearing file copied
from outside the scope into a scan root stages as a genuine `C100`, also two-path, and was dropped
exactly as a rename was. And the enumeration is equal or larger, not a strict superset: the two
enumerations are equal whenever nothing is renamed or copied, which is the ordinary commit, and
larger only when something is. The property relied on is that nothing which was enumerated stops
being enumerated.

Three more holes in the same route closed with it. An unmerged (`U`) in-scope path was returned by
neither `AM` nor `AMT`, so a conflicted path under a scan root was absent from the list and the
route reported clean over an index it had not read; it now refuses, because an unmerged path is
recorded at stages 1/2/3 and at no stage 0 and there is no one staged blob to scan. Each scan root's
own path is now in scope as well as its contents, since a `--raw` record at exactly
`test/__fixtures__` or `src` is never a directory and is therefore that root replaced by a blob, a
link or a gitlink; what that buys is the mode check, and a regular blob at either path reaching only
the conservative shape pass is a disclosed gap, recorded and pinned by a test rather than described
as safe. And a scan that failed anywhere inside `main()` now exits 2 rather than 1, the code this
gate reserves for hits found: a missing allow-list and a walk root that is not a directory were both
measured reporting a failure to start as a finding.

This is a change to the commit gate only. No package surface, runtime behavior, build output or
dependency changes.
