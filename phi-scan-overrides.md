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
reached by the refusal either (see the rename limitation below). Within that, it
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

`--staged` reads `git diff --cached --raw -z --diff-filter=AMT` so the
destination mode is visible before any read, and refuses `120000` (symbolic link)
and `160000` (gitlink). **`T` is in that filter on purpose:** replacing a
_tracked_ regular file with a link is neither an add nor a modify, so
`--diff-filter=AM` deleted the record before any mode could be read. It also
covers the reverse typechange, a tracked link replaced by a real file carrying
PHI.

**"In scope" is each route's own existing boundary, not a new one.** The walk
still excludes a gitignored entry, the same rule that already excluded a
gitignored file, so links get no second and stricter boundary of their own;
`--staged` still looks only at `test/__fixtures__/**` and `src/**.ts`. A path
named explicitly on the command line is still **followed**: that is the caller's
own request to read whatever is there, and it errs toward scanning more.

Pinned in `test/scripts/phi-scan.test.ts`, which runs every case against a
throwaway git repository rather than this one.

## Documented limitations

- **A staged rename is not enumerated** by the `--staged` route. `R` and `C` are
  the only statuses carrying a second path in a `--raw` record and both are
  excluded, so a rename that also appends PHI passes that route. Reachability
  depends on git's own rename detection, which is on by default for `git diff`: a
  rename staying above the similarity threshold is reported `R` and vanishes,
  while one below it is reported as a delete plus an add and the **add is scanned
  normally**. Admitting `R`/`C` needs the two-path record shape handled.
  **The cost is not only unscanned content.** A record this route never lists
  cannot reach the mode check either, so an **already-tracked symbolic link moved
  from outside the scope to inside it** (`git mv`, raised `R100` with mode
  `120000` on both sides) lands in scope and is **not refused** on this route.
  Measured, and identical before this change. It is bounded in the direction that
  matters: git does not pair a deleted regular file with an **added** link even at
  an identical blob oid (that stays `A`, and is refused), so a _new_ link cannot
  arrive this way, and the all-mode walk refuses the resulting working tree
  (measured, exit 2). The all-mode sweep reads the resulting working-tree entry
  either way.
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
