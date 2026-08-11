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
by wire-format extension (`.json`, `.xml`, `.ndjson`). Everything else in scope
gets the **source pass**: the conservative dashed-SSN + email shape check, plus
the FHIR-keyed literal recogniser described below. A JSDoc `@example` embedding a
`{"resourceType":"Patient",…}` snippet is still never _parsed_ as a resource.

**The walk roots are `test/` and `src/`, not `test/__fixtures__/` and `src/`.**
Measured before that changed: 55 tracked files sat directly under `test/` and
were reached by **neither** route. Counted with this scanner's own key regex over
those 55 files: **87** object-literal `family` / `given` sites and **21**
`birthDate` sites, plus **33** more `family` / `given` and **3** `birthDate`
spelled as XML `value` attributes. The old
justification was the PHI-leak suite's sentinel battery, which is **two files**,
not the directory. Those two are now declared by exact path in the scanner's
`SENTINEL_FILES` and listed under **Bypass entries** below; every other file
under `test/` is in scope by default, and a new one is in scope the moment it is
written.

**Enumerating a source file buys the SSN / email floor and nothing else, so the
recogniser was widened in the same change.** The structured scanner assumes the
file **is** the document, and a test builds its resources as TypeScript object
literals, so a real surname typed as `family: "…"` inside a `.ts` file was read
by nothing: a dashed SSN and an email are neither a name, a date of birth nor a
street address. Measured on `.ts` carrying
`{ resourceType: "Patient", name: [{ family: "…", given: ["…"] }] }`: exit 0,
`OK, no hits`, both before the scope widening (never enumerated) and after it
with the recogniser absent (enumerated, unread).

A key distinction keeps the name detector honest: FHIR `name` is a **HumanName**
(object / array) only on Patient / Practitioner / RelatedPerson / Person and the
`contact` backbone; on Organization / Location / StructureDefinition it is a
plain **string** resource label. The scanner name-scans only a HumanName
object/array: a string `name` is skipped, so `Organization.name`
("Good Health Clinic") never false-flags. The walk recurses into `contained`,
`entry.resource`, and every `value[x]`, so a name nested in a contained resource
or a Bundle entry is still reached.

| Category         | Where it looks                                                                                                                             | Rule                                                                                                                                                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Person names     | HumanName `family` / `given` / `text` (JSON); `<family>` / `<given>` value attrs (XML)                                                     | each significant name token must be in the `NAME` allow-list (case-insensitive). Single Latin initials are skipped; single CJK ideographs are kept; honorific / degree codes (MD, JR, …) are ignored. A string `name` (resource label) is not scanned.     |
| Date of birth    | `birthDate`, `deceasedDateTime`                                                                                                            | the normalized `YYYYMMDD` / `YYYYMM` / `YYYY` must be in the `DOB` allow-list. A DOB is indistinguishable from a real one by shape, so the allow-list is the only sound gate.                                                                              |
| SSN / identifier | `identifier.value`; `telecom.value`; dashed `\d{3}-\d{2}-\d{4}` anywhere                                                                   | a 9-digit (SSN-shaped) value must be in the `ID` allow-list; a dashed SSN anywhere is always a hit. Prefixed synthetic ids (`SYN-0001`) and resource references (`Patient/1`) are not 9-digit and pass.                                                    |
| Phone            | `telecom.value` (ContactPoint)                                                                                                             | a ≥10-digit number lacking the `555` fake-exchange convention is a hit.                                                                                                                                                                                    |
| Address          | `Address.line` / `Address.text` (JSON); `<line>` value attrs (XML)                                                                         | a `<number> <word>` street line must be in the `ADDR` allow-list. `city` / `postalCode` are quasi-identifiers and not gated here.                                                                                                                          |
| Email            | anywhere (`telecom.value` + free text)                                                                                                     | an email whose domain is not an `EMAILDOMAIN` (reserved / test) domain is a hit.                                                                                                                                                                           |
| Source literals  | `family` / `given` / `birthDate` / `deceasedDateTime` / `line` as a key in a source file, followed by a string literal or an array of them | the value goes to the same detector the structured scanner uses. Escapes are decoded to a bounded fixed point (three rounds), because a resource is routinely written as a JSON document inside a TypeScript string and one decode leaves the wrong token. |

**Two omissions from that last row are deliberate.** `text` is not keyed:
`HumanName.text` and `Address.text` are PHI, but a flat text pass cannot tell
them from `CodeableConcept.text`, `Narrative.text` or an assertion message, all
ordinary in this suite, and a gate that false-errors on conformant test code is a
gate someone switches off. `identifier.value` and `telecom.value` are not keyed
for the same reason and more sharply: bare `value` is the most overloaded key in
FHIR (`Quantity.value`, `Extension.value[x]`, every primitive), and the XML
scanner only dares read it inside a `<telecom>` / `<identifier>` block, a
boundary that does not exist in TypeScript source. So the source pass covers
**names, dates of birth and street addresses**, and a 9-digit identifier written
inline still reaches only the dashed-SSN arm. Put a resource that needs full
coverage in `test/__fixtures__/`.

## The bytes git carries, as a union with the walk

**A walk reads the working tree, and that is not what a commit contains.** Two
halves, both measured on this repository before the index route existed:

- a fixture `git add`ed and then **scrubbed in the working tree** scanned clean
  and exited **0**, while `git commit` would have committed the staged blob;
- **33 tracked non-markdown files sit outside `test/` and `src/` altogether**
  (`scripts/`, `.github/`, `docs-content/`, `.changeset/`, the root manifests),
  so neither the walk nor the index reconciliation above (whose pathspec is
  limited to the walk roots) ever mentioned them. **Two of the 33 carried bytes
  these recognisers report** (`hello@cosyte.com` in `package.json`, and this
  scanner's own `JOHN_SMITH@Mercy.org` docblock example); both are addressed
  below rather than by widening a rule.

So `all` mode enumerates **both** routes. **Union, never replacement:** the walk
alone can see **untracked** working-tree content, and the index alone can see
what is **staged** and what lives **outside the roots**. The walk keeps its roots
and every refusal it already had; nothing that was enumerated stops being
enumerated.

**Dedup is by CONTENT, under git's own `blob <len>\0` framing, not by path.** On
an ordinary clean checkout every index blob hashes to bytes the walk already
read, so nothing is scanned twice and `git cat-file` is never even asked for them
(measured: 202 in-scope index entries, 169 already observed, **33 fetched**).
Where the two copies of one path **differ**, **both** are scanned: with
`core.autocrlf` or a `.gitattributes` `text` attribute the working-tree file is
CRLF and the blob is LF, so they are two byte streams and a hit in one is not
evidence about the other (measured: the fetch count goes 33 → 34 when one tracked
file's working copy is converted to CRLF). The object-id algorithm is **asked
for** (`git rev-parse --show-object-format`) rather than assumed, because a
SHA-256 repository would match nothing and quietly scan the whole corpus twice.

**A mode the index carries that is not a regular blob refuses the scan (exit 2),
repo-wide.** For mode `120000` the object **is** the link's target path and for
`160000` there is no object in this repository at all, so reading either proves
nothing. This is the half that covers a link or a gitlink **outside** the walk
roots, which no route reached before (measured, exit 0 on base for both).

**An unmerged path is keyed on the ABSENCE OF STAGE 0, and that is not how
`--staged` spots one.** `git diff --cached --raw` reports it as status `U` with
destination mode `000000`; **`git ls-files -s` reports the same path at stages
1/2/3 with ordinary blob modes and no `U` anywhere**, so a reader that takes the
first record it sees gets **stage 1, the merge base**, and reports on it as
though it were what git carries. Every stage is read and **every stage is
labelled with its own number**, so none can be silently promoted to "the" index
copy. The `--staged` route still **refuses** over such a path, unchanged: that
route has to name one blob and there is none.

**DECLARED RESIDUAL: `all` MODE IS NOW REPO-WIDE AND `--staged` IS NOT, SO THE
TWO ROUTES DISAGREE ABOUT THE CORPUS BY 33 TRACKED FILES.** Measured: a staged
`docs-content/leak.json` carrying a dashed SSN is **exit 0** on the hook and
**exit 1** in CI (at the base commit both were 0). The direction is the safe one,
CI stricter than the hook, and it is **not** the shape the paragraph on "in
scope" above warns about, which was CI blind where the hook reported. It is
**not closed here on purpose**: widening `--staged` is a **hook decision** that
changes what a commit is BLOCKED on, it has been declined three times across this
suite with the cost measured, and taking it as a side effect of a scan widening
is exactly how it would arrive ungraded.

**A hit found in the index is labelled `<path> (as git carries it)`**, or
`<path> (index stage <n>)` for a conflicted one. The label is for **reporting
only**: the dispatch, `SENTINEL_FILES` and `--allow-fixture` all key on the plain
path, so a declared exemption covers both routes rather than one.

**The dedup key is the object id AND the detector the path dispatches to, and
neither half is optional.** Two states were constructed against an oid-only key
and **both printed `OK, no hits` at exit 0**:

- **The detector is a property of the PATH, not of the bytes.** `scanTarget`
  sends `test/__fixtures__/x.json` to the structured FHIR scan and `src/x.ts` to
  the source pass, and the source pass **deliberately does not key
  `identifier.value` or `telecom.value`** (see the two omissions above). So one
  payload committed at both paths was "observed" at the weaker one, and the
  fixture blob carrying an SSN-shaped `identifier.value` was never fetched. An
  oid-only key silently applies the **weakest** detector any path holding those
  bytes gets.
- **An exempt path's bytes were never scanned in the first place.** A declared
  `SENTINEL_FILES` entry is walked, and it is exempt precisely **because** it
  carries realistic-PHI-shaped strings, so hashing it into the observed set let
  it vouch for an identical copy at a path with no exemption. That one is **not
  even convergent**: a sentinel is never "fixed", so the other copy would be
  deduped away on every future run.

So the observed set holds `<oid>\0<detector>` for the walked files that were
actually **scanned**, and a declared path contributes nothing to it. `scanKindOf`
is the **one** dispatch table and `scanTarget` reads it too, so the key cannot
drift from what really runs. A declared path is still **enumerated** by both
routes and dropped by `main`, so the exemption is still **announced** (once,
deduped) rather than performed in silence.

**The consequence that remains, stated narrowly:** two paths that hold identical
bytes **and** dispatch to the same detector **and** are both in scope are one
object, so a payload at both is reported at whichever the sweep read first. The
exit code is unaffected, and fixing the reported copy leaves the other object
unobserved, so the next run names it. Both halves are pinned by tests.

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
get no second and stricter boundary of their own; `--staged` looks at `test/**`
and `src/**.ts`, **minus `.md`, which is the walk's own exemption applied to both
routes**. Leaving that exemption on one route made them disagree in both
directions: a tracked `test/notes.md` carrying a dashed SSN was never opened by
the sweep while the hook reported it as a hit (measured, exit 1 against exit 0).
**Keeping the two routes on different scopes is what let the original hole sit
unnoticed**, so they moved together. A path named explicitly on the command line is still **followed**: that is the caller's own request to read whatever is
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

- **A regular blob staged at a scan root's OWN path still misses the
  STRUCTURED-ONLY detectors.** `scanTarget` computes `isFixture` from
  `startsWith("test/__fixtures__/")`, with a trailing slash, so the root's own
  path cannot reach the FHIR-aware branch, and it still cannot. **Three quarters
  of this gap is gone**: the non-fixture branch now runs the source recogniser,
  so a `name`, `birthDate` or `address.line` written at exactly
  `test/__fixtures__` IS read (measured, exit 1). What is still unread there is
  what only the structured scanner reads, `identifier.value` and `telecom.value`
  (measured, exit 0). The remaining fix belongs to `scanTarget`'s dispatch rather
  than to the `--staged` scope filter. Both halves are pinned.
- **CLOSED: a scan root's PARENT staged as a link.** `test` staged as a
  mode-`120000` symlink used to be out of scope for `--staged` (neither `===`
  matched and neither prefix did) while the all-mode walk returned silently
  because `existsSync(test/__fixtures__)` was false, so the whole fixture corpus
  could leave the index with both routes reporting `OK` (measured, exit 0 on
  both). `test` is the scan root now: `--staged` refuses it on its mode (exit 2),
  and the all-mode walk refuses too, by a different mechanism, because
  `readdirSync` follows the link to a non-directory and raises `ENOTDIR`.
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
- **CLOSED: an all-mode sweep that observed nothing.** It used to print
  `OK, no hits` and exit 0 having opened no file at all. Two arms close it, and
  they are not redundant. The sharp one **reconciles against the index**: every
  path `git ls-files -- test src` names, minus markdown, must have been opened by
  the sweep, or the scan refuses (exit 2) and names every offender. That is what
  catches the case this rule is really about, an **emptied or deleted walk root
  whose corpus is still tracked**, which reported clean over a corpus fully
  present in the index (measured, exit 0, both emptied and removed). **A scanned
  file COUNT does not detect that**: the count counts the roots that DID exist,
  and the surviving root supplies a healthy-looking number. The blunt one is the
  floor underneath it: **a sweep that opened zero files refuses whatever the
  index said**, which covers a copy of this tree with no repository of its own.
  **State what that arm covers, which is the ZERO-FILES case and not the general
  one**: with no usable index and only SOME roots emptied, the surviving root
  still yields targets, the arm does not fire, and that state is reported clean.
  It is a declared residual, not a covered case.
  `git rev-parse --is-inside-work-tree` is no help there, because it **answers
  for the enclosing repository** and returns `true` for a nested copy whose files
  git has never heard of; the pathspec is scoped to the scan roots for the same
  reason, so a nested copy gets `null` and the walk rather than a list belonging
  to the wrong tree. **That scoping is a property of this REFUSAL, not of the
  scan**: refusing over a path no route would open is a gate nobody can get
  green, whereas the index route above feeds a SCAN and is therefore
  deliberately unscoped. Both arms stay keyed on the walk, so the union widens
  what is scanned without retiring a refusal.
- **The XML arm reads ONE of the three ways this suite spells an XML value, and
  "reads both spellings" is a claim about FORMATS, not about spellings within the
  XML format.** It covers the DOUBLE-QUOTED ATTRIBUTE, `<family value="…"/>`,
  because `xmlValues` matches `value="([^"]*)"`. Two spellings are unread and
  both are measured at exit 0:
  - a SINGLE-QUOTED attribute, `<family value='…'/>`, which XML 1.0 admits
    equally and which is the natural spelling inside a double-quoted TypeScript
    string. No live site today.
  - XML ELEMENT TEXT, `<given>…</given>`. **One live site**, and it is in the
    suite whose whole purpose is element text: on the pre-rename line in
    `test/dropped-element-text.test.ts` the `value=`-attribute half reported and
    the element-text half did not, so **the scanner forced only half of that
    rename**. The other half was renamed by hand.
- **Entity blanking deletes any letter run between an `&` and a `;`, anywhere in
  a source file.** `XML_ENTITY_REF` blanks `&<alnum>;` spans before tokenizing,
  which is what stops entity NAMES (`amp`, `xxe`, `secret`) being reported as
  person names. Blanking to a space can only split a token apart and never join
  two, but **splitting is not the failure here, deletion is**: measured,
  `<family value="Smith&Rodriguez;Jones"/>` reports `Smith` and `Jones` and loses
  `Rodriguez`, where the same value spelled with spaces reports all three. The
  residual is that run, not merely "a name spelled entirely as character
  references".
- **Two source shapes the recogniser reads nothing in**, both measured at exit 0
  and neither with a live site: a NESTED-BRACE template substitution
  (`` `${ ({a:1}).a }` ``), which `\$\{[^{}]*\}` does not blank, and a COMPUTED
  KEY (`{ ["family"]: "…" }`), which the key regex does not match.
- **The value reader's 200k character budget fails TOWARD reporting**, which is
  the inverse of the fixed 4 KB window it replaced. Measured on a 390 KB file
  with a 30,000-member array: 15,385 values returned including the planted name,
  where the window returned none. The largest scanned source file here is 75 KB.
- **A tracked file deleted from the working tree refuses the sweep.** The
  reconciliation cannot tell "you deleted this" from "the root vanished", and
  refusing is the safe direction of the two. The message names the paths and the
  remedy (restore it, or remove it from the index). It is an availability
  nuisance, not a PHI-safety one.
- **The `IssueCode@FHIRPath` false positive is handled by a DECLARED DOMAIN, not
  by a shape rule, and the shape rule that was tried is why.** This package's
  diagnostics are an issue code joined to a FHIRPath expression by `@`, and the
  email recogniser cannot tell `UNKNOWN_PROPERTY@Patient.name` from an address by
  shape: both are one `@` between two dotted tokens, and `.name` is a real
  top-level domain, so no TLD test separates them. A shape exclusion keyed on an
  all-caps local part plus a capitalised first domain label was written, measured
  and **reverted**: it silently covered every capitalised domain
  (`JOHN_SMITH@Mercy.org`) in every source target, and because `scanTarget`
  routes a fixture whose extension is not `.json` / `.xml` / `.ndjson` down the
  SAME branch as source, **it also lost a hit this scanner already had**
  (measured: exit 1 on base, exit 0 with the exclusion). A gate that detects less
  than the one it replaces is worse than the defect it was closing. One
  `EMAILDOMAIN` line has a blast radius of one domain. **The enumeration that
  used to be quoted here was scoped to a corpus that no longer is the corpus, so
  it is re-measured rather than softened:** with the sweep reading the bytes git
  carries repo-wide, two further email-shaped domains became reachable:
  `cosyte.com`, this package's own contact address in `package.json`, now
  declared; and `Mercy.org`, which is the example in the paragraph above and
  lives in this scanner's own source, now covered by a declared sentinel path
  rather than by a domain. **A domain would have been the wrong instrument for
  the second one**: an allow-list entry is global and route-blind, so
  `EMAILDOMAIN mercy.org` would have admitted a plausible real hospital domain in
  a fixture. A future one reds loud.
- **The enumerate-then-read window is not closed.** A file that vanishes between
  enumeration and read makes the scan refuse (exit 2), which is the safe
  direction, so it is an availability question rather than a PHI-safety one. The
  walk roots here are `src/` and `test/`, and the build transient that motivates
  closing this elsewhere lands at the repository root, outside both.
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

_No `--allow-fixture` bypass has ever been needed. Every fixture is covered by
token-level `scripts/phi-allow-list.txt` declarations._

**Declared sentinel files, which are a different mechanism and are recorded here
because they have the same effect.** Each exists to carry realistic-PHI-shaped
strings, so scanning it would flag the very sentinels that exist to be flagged.
They are named by exact path in the scanner's `SENTINEL_FILES` and subtracted
from the **sweeping** routes only; naming one on the command line still scans it,
and the sweep **announces** the skip rather than performing it in silence.

### test/phi-leak.test.ts

The redaction-contract sentinel battery. Its whole subject is strings that must
never reach a diagnostic, so it spells them out.

### test/scripts/phi-scan.test.ts

This scanner's own test. It must spell out the values the scanner is meant to
catch, including a dashed SSN, a non-test email domain and a date of birth.

### scripts/phi-scan.ts

This scanner's own source, declared when the index route brought it into scope:
it sits outside every walk root, so **no route opened it before**, which makes
this a newly _declared_ blind spot rather than a newly _created_ one. Its
docblocks have to spell out the violator values they explain, and one of them is
`JOHN_SMITH@Mercy.org`, the example recording why a shape-based email exclusion
was measured and reverted. **The token-level remedy would have been worse:**
`EMAILDOMAIN mercy.org` is global and route-blind, so it would admit a plausible
real hospital domain in a fixture too. A literal path is the narrower of the two.
**The cost, stated twice over:** a real value pasted into this file is not swept,
so a change to it is reviewed by a human and not by the gate it implements -- and
the `Mercy.org` token that motivated the declaration now lives in the one file
the sweep never opens. It is a fabricated local part on a domain nobody here is
recorded at, so it identifies no one; it is named because a token whose home is
the gate's blind spot is worth a reader knowing about, not because it is a leak.

**Why this is not `--allow-fixture`.** That mechanism is a caller's per-run
bypass and needs a flag. CI runs the scan with no flags, so a bypass that existed
only on the command line would leave both files unscanned in exactly the route
that matters. **Adding to `SENTINEL_FILES` means adding a subsection here**, and
it is a whole-file exemption, so prefer a token-level allow-list declaration
every time one will do.
