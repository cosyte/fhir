# phi-scan bypass log

This file logs every `--allow-fixture <path>` bypass invocation of
`scripts/phi-scan.ts`. The scanner refuses to honor a `--allow-fixture <path>`
flag UNLESS this file contains an entry referencing the same path. The committed
log is intentionally annoying: it discourages bypass and creates an audit
trail. Prefer extending `scripts/phi-allow-list.txt` (a token-level, reviewed
declaration) over a whole-file bypass.

## How the scanner detects PHI

`scripts/phi-scan.ts` is FHIR-shape-aware. It parses each synthetic fixture and
inspects only the elements that actually carry each PHI category, keyed by the
FHIR element name, not a blind text regex, which would trip on coded values and
resource labels. It runs the structured scan on files under `test/__fixtures__/`
by wire-format extension (`.json`, `.xml`, `.ndjson`); `src/` gets a conservative
dashed-SSN + email pass only, so a JSDoc `@example` embedding a
`{"resourceType":"Patient",…}` snippet with synthetic names is never parsed as a
resource. `test/*.ts` is not walked at all: the PHI-leak suite ships a sentinel
battery of deliberately PHI-shaped strings, and scanning it would flag the very
sentinels that exist to be flagged.

A key distinction keeps the name detector honest: FHIR `name` is a **HumanName**
(object / array) only on Patient / Practitioner / RelatedPerson / Person and the
`contact` backbone; on Organization / Location / StructureDefinition it is a
plain **string** resource label. The scanner name-scans only a HumanName
object/array: a string `name` is skipped, so `Organization.name`
("Good Health Clinic") never false-flags. The walk recurses into `contained`,
`entry.resource`, and every `value[x]`, so a name nested in a contained resource
or a Bundle entry is still reached.

| Category         | Where it looks                                                                         | Rule                                                                                                                                                                                                                                                   |
| ---------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Person names     | HumanName `family` / `given` / `text` (JSON); `<family>` / `<given>` value attrs (XML) | each significant name token must be in the `NAME` allow-list (case-insensitive). Single Latin initials are skipped; single CJK ideographs are kept; honorific / degree codes (MD, JR, …) are ignored. A string `name` (resource label) is not scanned. |
| Date of birth    | `birthDate`, `deceasedDateTime`                                                        | the normalized `YYYYMMDD` / `YYYYMM` / `YYYY` must be in the `DOB` allow-list. A DOB is indistinguishable from a real one by shape, so the allow-list is the only sound gate.                                                                          |
| SSN / identifier | `identifier.value`; `telecom.value`; dashed `\d{3}-\d{2}-\d{4}` anywhere               | a 9-digit (SSN-shaped) value must be in the `ID` allow-list; a dashed SSN anywhere is always a hit. Prefixed synthetic ids (`SYN-0001`) and resource references (`Patient/1`) are not 9-digit and pass.                                                |
| Phone            | `telecom.value` (ContactPoint)                                                         | a ≥10-digit number lacking the `555` fake-exchange convention is a hit.                                                                                                                                                                                |
| Address          | `Address.line` / `Address.text` (JSON); `<line>` value attrs (XML)                     | a `<number> <word>` street line must be in the `ADDR` allow-list. `city` / `postalCode` are quasi-identifiers and not gated here.                                                                                                                      |
| Email            | anywhere (`telecom.value` + free text)                                                 | an email whose domain is not an `EMAILDOMAIN` (reserved / test) domain is a hit.                                                                                                                                                                       |

## What the enumeration admits, and what refuses the scan

An **enumerated** in-scope entry that is **not a regular file refuses the scan**
(exit 2). "Enumerated" is load-bearing: this narrows what each route _admits_
from what that route already _lists_, so an entry a route never lists is not
reached by the refusal either. Within that, it
is never silently skipped, because both enumerating routes were blind to one in a
way that read as clean:

- the walk enumerates `Dirent.isFile()`, an **lstat** answer, so a symbolic link
  is neither a file nor a directory and fell out of the loop in silence.
  `isDirectory()` is an lstat answer too, so a linked **directory** took a whole
  subtree with it;
- `--staged` reads content with `git show :<path>`, and git stores a symbolic
  link as its **target path** under mode `120000`, so that route was handed the
  path text and never the target's bytes.

**Neither route follows the link, and that is deliberate.** Following would read
bytes the enumeration does not control (outside the repo, a loop, a device, a
FIFO that blocks the gate forever), and git does not carry those bytes anyway, so
a hit on them would be a claim about something no commit contains. Refusing
states the only true thing available: there is an entry here the scan cannot
account for, so the scan is not clean.

A refusal names the entry's own repo-relative path and a token for its kind from
a closed set the scanner owns. **It never reports the link target**, which is
working-tree text that can itself carry PHI. Every offender is named, not just
the first.

`--staged` reads `git diff --cached --raw -z --no-renames --diff-filter=AMTU` so
the destination mode is visible before any read, and refuses `120000` (symbolic
link) and `160000` (gitlink). **`T` is in that filter on purpose:** replacing a
_tracked_ regular file with a link is neither an add nor a modify, so
`--diff-filter=AM` deleted the record before any mode could be read. It also
covers the reverse typechange, a tracked link replaced by a real file carrying
PHI.

**`--no-renames` is there for the same reason, and the filter alone was not
enough.** `R` and `C` are returned by neither `AM` nor `AMT`, and git's rename
detection is **on by default**, so `git mv <link> test/__fixtures__/<name>`
staged as `:120000 120000 <sha> <sha> R100` with two paths and the filter deleted
the record outright: an ordinary `git mv` put a mode-`120000` entry under a scan
root and this route printed `OK, no hits`. A rename that also **substitutes a
real name** into the moved file passed identically, because a record this route
never lists is never scanned either. **The copy half is real too:** under
`diff.renames=copies` a PHI-bearing file copied from outside the scope into a
scan root stages as a genuine `C100`, also two-path, and was dropped exactly as a
rename was. With detection off the destination arrives as an ordinary single-path
`A` and the source as a `D` the filter drops, so it needs no two-path record
shape.

**The enumeration is EQUAL or LARGER, not a strict superset.** The two
enumerations are **equal** whenever nothing is renamed or copied, which is the
ordinary commit, and larger only when something is; "strict superset" claims it
always grows, and that is false for almost every commit this gate sees. The
property relied on is the one-directional half: nothing that **was** enumerated
stops being enumerated. It also makes the two-field stride **structural**: no `R` or `C`
record can be produced whatever the caller's `diff.renames` or `diff.renameLimit`
say (verified under `true`, `copies`, `false`, `1`, and `renameLimit=1`).

**`U` is in the filter so the scan can refuse over it.** An unmerged path is
recorded at stages 1/2/3 and at no stage 0, so there is no single staged blob to
read; it was returned by neither `AM` nor `AMT`, so a conflicted in-scope path was
simply absent from the list and the route reported `OK, no hits` over an index it
had not read. Git itself will not commit while a path is unmerged, so this was
never a route to a committed leak; what it was is a gate attesting clean over a
state it never observed, and `pnpm phi-scan --staged` is run by hand and from
scripts as well as from the hook. It is **refused**, not scanned.

**"In scope" is each route's own existing boundary.** The walk still excludes a
gitignored entry, the same rule that already excluded a gitignored file, so links
get no second and stricter boundary of their own; `--staged` still looks only at
`test/__fixtures__/**` and `src/**.ts`. A path named explicitly on the command
line is still **followed**: that is the caller's own request to read whatever is
there, and it errs toward scanning more.

**Two places that boundary moved**, called out rather than folded into
"narrowing", because both admit _more_ than before: rename detection is off, so a
rename destination now arrives as an ordinary add; and **each scan root's own
path** is in scope as well as its contents. A `--raw` **record** at exactly
`test/__fixtures__` or `src` is never a directory, because this invocation emits
no record for one, so it is a scan root replaced by a blob, a link or a gitlink,
and the prefix test alone let that through (measured: exit 0 over a staged
mode-`120000` `test/__fixtures__`, and the same for `src`). **The claim is scoped
to the record, not to the index:** a sparse index does hold a directory entry
(`040000 <sha> 0 src/`), which carries a trailing slash, matches neither `===`,
and produces no record here. What admitting the path buys is the **mode check**,
which is the whole of the link and gitlink case; a regular blob there is a
disclosed gap, below.

**A scan that failed anywhere inside `main()` exits 2, not 1.** Node exits 1 on
an uncaught throw and 1 is this gate's code for **hits found**, so a failure that
was not an `InvocationError` was reported to CI and to the developer as a
finding. Two were measured exiting 1: a missing or unreadable allow-list
(`loadAllowList()` sat outside every handler), and `readdirSync` refusing a walk
root (`ENOTDIR` on a root that is not a directory, `EACCES` on one it cannot
list). Both now refuse with 2, and a process-level net catches the rest.
**That net wraps the call to `main()`, so it covers everything inside it and
nothing before it:** a throw at module load, or a failure in the `tsx` / `node`
runner itself, still exits 1, and no wrapper placed there could change it.

Pinned in `test/scripts/phi-scan.test.ts`, which runs every case against a
throwaway git repository rather than this one.

## Documented limitations

- **A regular blob staged at a scan root's OWN path gets the conservative shape
  pass only, never the FHIR-aware scan.** `scanTarget` computes `isFixture` from
  `startsWith("test/__fixtures__/")`, with a trailing slash, so the root's own
  path cannot reach the structured branch: a resource written at exactly
  `test/__fixtures__` has its `name`, `birthDate`, `address` and `telecom` read
  by nothing, and the scan exits 0. Measured. It is **not** a regression, since
  the path was not admitted at all before, and it is **not** the safe direction,
  so it is recorded here rather than described as one. The fix belongs to
  `scanTarget`'s dispatch rather than to the `--staged` scope filter. What
  admitting the path does buy is the mode check, which covers the link and
  gitlink cases entirely.
- **A scan root's PARENT staged as a link defeats both routes.** `test` staged as
  a mode-`120000` symlink is out of scope for `--staged` (neither `===` matches
  and neither prefix does), and the all-mode walk returns silently because
  `existsSync(test/__fixtures__)` is false, so the whole fixture corpus can leave
  the index with both routes reporting `OK`. Measured, exit 0 on both routes, and
  identical before this change. It is the same shape as the root's own path, one
  directory up.
- **The all-mode walk FOLLOWS a symlinked scan root.** `existsSync` and
  `readdirSync` both follow, so with `test/__fixtures__` pointing at an external
  directory the sweep reads and **reports the content** of files outside the
  repository. Fail-safe in exit code (it is a hit, exit 1), but the diagnostic
  echoes off-repo bytes, which is the surface the refusal wording is otherwise
  careful about. Identical before this change.
- **A staged deletion is not enumerated**, and that is deliberate: `D` has no
  staged blob to scan. Beyond it, the only statuses git documents are `B` (a
  broken pairing, which needs `-B` and is not passed) and `X` (git's own "this is
  a bug" marker), so `A`/`M`/`T`/`U` plus `D` accounts for every record this
  invocation can produce.
- **An all-mode sweep that observed no files still reports `OK`.** A sibling
  scanner refuses that case; this one has never carried the rule.
- **The enumerate-then-read window is not closed.** A file that vanishes between
  enumeration and read makes the scan refuse (exit 2), which is the safe
  direction, so it is an availability question rather than a PHI-safety one. The
  walk roots here are `src/` and `test/__fixtures__/`, and the build transient
  that motivates closing this elsewhere lands at the repository root, outside
  both.
- **Free-text PHI** in an opaque `Narrative.div` or an `Annotation.text` is
  covered only by the cross-cutting dashed-SSN + email pass: a bare name in
  narrative prose is not caught structurally (the same limitation the HL7 scanner
  documents for `OBX-5` / `NTE` free text). Keep narrative synthetic.
- **MRN detection** is deliberately limited to the 9-digit (SSN-strength) shape;
  short (6–8 digit) synthetic MRNs are common and numeric-noisy in FHIR, so they
  are not gated. Declare a realistic MRN in the `ID` allow-list if a fixture
  needs one, or prefix it (`MRN-…`).
- The **XML** pass is regex-based over `<element value="…"/>` pairs (tolerant of
  the malformed fragment a leaked document arrives as); it does not build a DOM.

## Bypass entries

_None. Every fixture is covered by token-level `scripts/phi-allow-list.txt`
declarations; no whole-file bypass has been needed._
