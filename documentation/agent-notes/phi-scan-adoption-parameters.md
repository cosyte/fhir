# `PHI-SCAN-ADOPT` - `fhir`'s derived parameters, and what the shared engine must parameterize

**Status: DERIVATION ONLY. This branch MUST NOT BE MERGED.** It exists so the `cosyte/config` worker
has `fhir`'s parameters as measured data rather than as a prediction, and so the measurements below
can be re-run rather than believed.

Written against `@cosyte/script-utils@0.0.2` (verified installed; the installed `phi-scan.js` and
`phi-scan.d.ts` are byte-identical to `config`'s working copy). Base for every differential is
`origin/main` at `5f1a4e4`, whose `scripts/phi-scan.ts` is 2,160 lines (`wc -l` and `rg -c ''` agree).
The engine is 1,543 lines (both tools agree).

Every number below was produced by a `fhir`-namespaced harness that printed the md5 of the scanner it
ran, and **every one of them was re-run from a uniquely-named script** after the shared scratchpad was
found to be clobbering generically-named scripts between parallel workers mid-session. The harnesses
are session-scoped and are not committed; each measurement states its own shape so it can be rebuilt.
The scanner under measurement is this branch's `scripts/phi-scan.ts` at **md5 `cf1bc9068ce0`**; the
base is `origin/main`'s at **md5 `75ff52c26eab`**.

---

## 1. The five axes, derived

| axis | `fhir`'s value | how it was derived |
|---|---|---|
| 1. `exitCodes` | `{ clean: 0, hits: 1, refuse: 2 }` | verbatim from the exit contract in the replaced scanner's header. **Never ported in or out.** |
| 2. `scanRoots` | `["."]` | **NOT `["test", "src"]`** - see below. |
| 2. `excludedPaths` | `test/phi-leak.test.ts`, `test/scripts/phi-scan.test.ts`, `scripts/phi-scan.ts` | the replaced scanner's `SENTINEL_FILES`, unchanged. |
| 2. `isWalkReadable` | unset - the engine's shared Markdown exemption | the replaced scanner applied exactly that rule on **both** sweeping routes. |
| 3. `isStagedReadable` | `not .md` AND one of `test`, `test/**`, `src`, `src/**.ts` | the replaced scanner's `buildTargetsForStaged` filter, unchanged. |
| 4. `regularBlobModes` | unset - the engine's `100644`/`100755` | the replaced scanner used the same two. |
| 5. EOL normalization | no parameter | the replaced scanner deduped by content under git's `blob <len>\0` framing; the engine does too. Checked, not skipped. |

### Why `scanRoots` is `["."]` and NOT the old walk roots

**This is the axis most likely to be got wrong in this port, and taking the old walk roots would have
been a silent narrowing.** The replaced scanner had two *independently scoped* sweeping routes:

- the **walk** was rooted at `test` and `src`;
- the **index union** (`indexTargets`) had **no root filter at all** and read every in-scope tracked
  blob repo-wide.

So its effective corpus was `walk(test, src) ∪ every tracked non-markdown blob, anywhere`. The engine
keys **both** halves on one root set (`isUnderScanRoot` gates `unionCandidatePaths`), so
`scanRoots: ["test", "src"]` would have stopped reading `package.json`, `scripts/*.ts`,
`docs-content/`, `.github/`, `.changeset/` and the root manifests. That is not hypothetical: this
repo's allow-list carries an `EMAILDOMAIN cosyte.com` line whose own comment records that it became
necessary *when the sweep started reading `package.json`*.

`["."]` is not `./`-prefixed, so the pre-check-1 trap (a root that walks correctly while matching no
index path, silently emptying the union and both index refusals) does not apply - **and that was
measured positively rather than assumed**, see §3.

---

## 2. The detector half, derived as vocabulary

The five detector kinds are universal; only the vocabulary and the traversal differ. `fhir`'s:

| kind | vocabulary (the data) | check |
|---|---|---|
| NAME | JSON: `name` → HumanName `.family`, `.given[]`, `.text` (a **string** `name` is a resource label and is never name-scanned). XML: `<family value>`, `<given value>`. Source: `family:`, `given:` | Unicode token split; single Latin letter dropped as a middle initial, single CJK char kept; noise tokens `MD DO DR MR MRS MS MISS JR SR II III IV RN NP PA PHD DDS DMD ESQ PROF FNP APRN`; each token uppercased against `allow.names` |
| DOB | JSON/XML/source: `birthDate`, `deceasedDateTime` | reduce to `YYYYMMDD` / `YYYYMM` / `YYYY` digits, month 1..12, day 1..31; compare against `allow.dobs` **reduced the same way** |
| ADDRESS | JSON: `address` → `.line[]`, `.text`. XML: `<line value>`. Source: `line:` | must match `^\d+\s+\p{L}`; compared against a declared synthetic street line |
| ID | JSON: `identifier` → `.value`. XML: `<value>` **scoped inside** `<identifier>` | 9 digits → hit unless in `allow.ids` |
| PHONE/CONTACT | JSON: `telecom` → `.value`. XML: `<value>` **scoped inside** `<telecom>` | email shape → domain against `allow.emailDomains`; else ≥10 digits and no `555` fake-exchange marker → hit unless in `allow.ids` |

**Deliberate omissions, each measured, each of which reads as an oversight and is not:**

- `text` is **not** keyed in source. `HumanName.text` and `Address.text` are PHI, but a flat pass
  cannot tell them from `CodeableConcept.text`, `Narrative.text` or an assertion message.
- `identifier.value` / `telecom.value` are **not** keyed in source: bare `value` is FHIR's most
  overloaded name and source has no block boundary to scope it with. The XML pass only dares read
  `<value>` **inside** a `<telecom>`/`<identifier>` block, so `<value value="70.0"/>` on a Quantity is
  never misread as a phone.
- a `${…}` substitution and an XML entity reference are **blanked to a space**, never deleted and
  never read: blanking can split a token but cannot join two.
- TypeScript string escapes are decoded to a **bounded fixed point (3 rounds)**, because this suite
  routinely writes a JSON document inside a TypeScript string, which is two layers of escaping.

### The traversal, and the one thing that had to change

The replaced scanner chose its traversal **by the target's repo-relative path** (`test/__fixtures__/`
prefix plus a `.json`/`.ndjson`/`.xml` suffix). **The engine cannot support that**, and the reason is
structural rather than an oversight: `DetectContext` carries `path` = the *reported locus*, which for
a target read through the union half is decorated (`… (as git carries it)`). There is no undecorated
target path. Reconstructing one by stripping the engine's own decoration would be a local copy of an
engine-owned format, and it would fail in the one direction that matters - a fixture read through the
union half would stop matching `.json` and fall silently to the weaker pass.

So this derivation selects the traversal **from the bytes**, which every route carries identically:
whole-text `JSON.parse` → tree walk; else all-lines-parse → NDJSON; else leading `<` → XML; else the
source-literal recogniser. Measured consequences in §4.

---

## 3. The two mandated pre-checks, measured

Both were re-derived rather than taken from the survey.

**Pre-check 1 - no `./`-prefixed scan root, and the index-keyed rules are not silently empty.**
`scanRoots` is `["."]`, which `normalizeConfig` maps to the repository root and which sets
`wholeRepo`, so `isUnderScanRoot` is true for every path. Demonstrated **positively**, because "not
`./`-prefixed" is an argument and the trap is about behaviour:

- a tracked file whose working-tree copy is scrubbed clean is still reported -
  `[phi-scan] HIT: docs-content/leak.ts (as git carries it)`, exit 1. The union half fires, so the
  root matches index paths.
- the index **non-blob** refusal is reachable under the same root: a tracked symlink outside the old
  walk roots gives `refusing the scan: 1 index entry is not a regular blob - docs-content/link.ts (a
  symbolic link)`, exit 2.

**Pre-check 2 - `isStagedReadable` admits nothing outside `scanRoots`.** With the roots at the
repository, containment is total by construction, and the engine enforces it rather than assuming it.
The predicate, evaluated: `test` ✓, `test/a.ts` ✓, `test/__fixtures__/p.json` ✓, `src` ✓, `src/a.ts` ✓,
`src/a.json` ✗, `README.md` ✗, `test/x.md` ✗, `scripts/attw.mjs` ✗, `package.json` ✗,
`docs-content/a.ts` ✗. Every admitted path is under the root.

The escape this check exists for - a staged **mode-120000** entry enumerated, read, its target path
handed to the detector as content, reported `OK: no hits` at exit 0 - is refused:
`refusing the scan: 1 entry is not a regular file - test/fixtures/p.json (a symbolic link)`, exit 2,
**and the link target's name appears zero times in the diagnostic.**

---

## 4. What the derived parameters actually do to this corpus

**Corpus differential.** A mirror of all 251 tracked paths, a unique floor-detectable payload at
every one, both scanners, stderr to a file (never a pipe - see §6):

```
tracked=251   origin/main reads 199   derived parameters read 199
ONLY-OLD (a path that stops being read):  (none)
ONLY-NEW (a path that starts being read): (none)
silent in both: scripts/phi-scan.ts, test/phi-leak.test.ts, test/scripts/phi-scan.test.ts  (+ every .md)
```

The corpus is identical, path for path. The three silent paths are exactly `excludedPaths`.

**Detector differential**, same probe resource through every route:

| probe | origin/main | derived | delta |
|---|---|---|---|
| `test/__fixtures__/p.json` | 6 hits | 6, identical | none |
| `test/__fixtures__/p.xml` | 6 hits | 6, identical | none |
| `src/probe.ts` | 6 hits | 6, identical | none |
| `test/__fixtures__/p.ndjson` | 12 hits, locus `…ndjson:1` | 12 hits, `line 1:` in the **segment** | reporting shape only - the engine owns the locus |
| `test/__fixtures__/p.txt` (a resource under an unexpected extension) | 4 (source pass) | 6 (structured) | **stronger** |
| `docs-content/p.json` (a resource outside the fixture dir) | 4 (source pass) | 6 (structured) | **stronger** |
| `test/__fixtures__/broken.json` (fragmentary resource: name, DOB, address, no SSN, no email) | **0 hits, exit 0** | 4 hits, exit 1 | **stronger** |

🩺 **That last row is a live escape in the shipped scanner, found by this derivation and not
previously recorded:** `scanJsonText` fell back to `scanCommonShapes` alone on a `JSON.parse` failure,
so a **fragmentary or truncated FHIR resource carrying a patient name, a date of birth and a street
address scans clean at exit 0** when it happens to carry no dashed SSN and no email. Content-driven
traversal selection closes it as a side effect. It is not a reason to merge this branch; it is a
reason the engine's format selection must fall back to the *weaker structured* pass rather than to
the floor.

**The `pnpm drift` capability probe, called directly against each version's scanner** (criterion 1 -
`pnpm drift` grades the working tree, so a repo with this branch checked out would report as passing
and prove nothing). The probe plants **this repo's own installed** `@cosyte/script-utils`, which is
what makes it an adoption check:

```
origin/main (5f1a4e4)  [md5 75ff52c26eab]: drift  - reported only its HITS code (1) over a run that
                                                    withdrew a target after enumerating it
branch working tree    [md5 9e29c6a25387]: ok     - REFUSED (exit 2)
```

---

## 5. What the engine must parameterize before this can be adopted

Ordered by whether it blocks. **Do not fix any of these in this repo.**

### E1 - format selection belongs to the engine (BLOCKING under the parameterize-everything rule)

*What it must express:* which traversal reads these bytes. `fhir` needs four: a JSON tree walk, an
NDJSON per-line walk, an XML attribute/block reader, and a keyed-literal reader for hand-written
source. The **decision** is process; the **key→category map** is `fhir`'s vocabulary (§2).

*Why a default cannot cover it:* the decision cannot be delegated back to the caller through
`DetectContext` as it stands, because that context carries only the decorated locus. Either the
engine selects the format, or it must expose `DetectContext.targetPath: string` (the undecorated,
repo-relative target path, `default` n/a, purely additive). **The second is the smaller change and
the first is the one the parameterize-everything rule asks for.** If only one lands, `targetPath`
unblocks `fhir` immediately.

### E2 - `AllowList.addresses` (BLOCKING for a faithful port)

*Proposed:* `addresses: Set<string>` on `AllowList`, lower-cased, parsed from an `ADDR <street line>`
tag. *Default:* empty set. *What it must express:* the positive declaration that a street line is
synthetic.

*Why:* the engine parses `NAME` / `DOB` / `ID` / `EMAILDOMAIN` and **silently drops every other tag**.
`fhir`'s allow-list documents an `ADDR` tag and its replaced scanner parsed it. Address is one of the
five PHI categories the engine's own docs name as the caller's, so the engine provides an allow-list
set for four of the five kinds it asks the caller to implement. Without it an address detector
**consults nothing and therefore has no remedy at all**, which the template's own docblock names as a
defect, because the `--allow-fixture` bypass is closed. Re-reading the allow-list in this repo to
recover the tag would be exactly the machinery this item deletes.

*This repo's exposure today is zero verdicts:* `scripts/phi-allow-list.txt` currently has **no `ADDR`
line**, so what is lost is the remedy, not a current pass. The derivation on this branch bridges it by
consulting `allow.ids` and says so at the call site; **that bridge should be deleted when E2 lands**,
not shipped.

### E3 - `AllowList.dobs` normalization (NON-BLOCKING, but it will bite every sibling)

The engine stores `DOB` values **verbatim** and documents them as being "in whatever form the caller's
detector normalises to", so every consumer must re-derive the reduction over the declared set on every
target. *Proposed:* the engine reduces both sides (`YYYYMMDD`/`YYYYMM`/`YYYY` digits) and documents
it, or exports the reducer. *Default:* the reduction above.

### E4 - excluded paths are dropped in silence (NON-BLOCKING, a real behaviour loss)

`origin/main` printed `skipping 3 declared sentinel file(s): …` on the sweeping routes, on the
argument that an exemption nobody sees is the same shape of blind spot the gate exists to refuse. The
engine drops `excludedPaths` silently. *Proposed:* the engine announces the excluded paths a run
would otherwise have enumerated (it is the only component that knows the set). *Default:* announce.
It cannot be reimplemented here without a local copy of the engine's enumeration bookkeeping.

### E5 - the CLI tail: `PHI-SCAN-EXIT-WRITE`. See §6.

---

## 6. `PHI-SCAN-EXIT-WRITE`: adoption does **not** close it

**Measured against the adopted shape** (the shared engine plus a thin tail), not against the replaced
2,160-line scanner. The engine returns a code and never calls `process.exit` - but **the report is
written inside the engine** (`reportHits`, and the refusal writes in `run()`), and the
`process.exit(...)` that discards it is in the per-repo tail **that the template ships and all
thirteen repos will copy**. Adoption therefore *relocates* the defect from thirteen bespoke files into
one shared tail. It does not close it, and the closure is engine-side by construction.

### Measurements (2,000 hits; `EXIT_CODES` = 0/1/2)

**Defect A - does the report survive?** Consumer attaches to the stderr pipe and never drains it:

| tail | exit | true HIT lines | delivered | summary line | termination |
|---|---|---|---|---|---|
| `process.exit(...)` (template) | 1 | 2000 | **86** | **no** | self-exits ~773 ms |
| `process.exitCode = ...` | - | 2000 | 851 | no | **HUNG, killed at 8 s** |
| `process.exitCode` + EPIPE guard | - | 2000 | 856 | no | **HUNG, killed at 8 s** |

**Defect B - a CLEAN run whose stdout reader goes away** (true answer `0`):

| tail | exit |
|---|---|
| `process.exit(...)` | `0` ✅ |
| `process.exitCode = ...` | **`1`, uncaught `write EPIPE`** - and `1` is this gate's HITS code |
| `process.exitCode` + EPIPE guard | `0` ✅ |

**Control - a run WITH hits, stdout reader gone** (true answer `1`): all three tails give `1`, so the
guard does not mask a real hits code.

**Second consumer shape - stderr piped to `head -1`, which exits, so the pipe is CLOSED rather than
merely undrained:** all three tails terminate and give `1`. **The hang is specific to an open,
never-drained pipe, not to a broken one.**

### ⚖️ One measurement diverges from the filed evidence, and I did not reproduce that setup

`documentation/repos/fhir/phi-scan-exit-write.md` records *"A consumer that never reads stderr still
exits in 453 ms: no hang."* With a consumer that **attaches to the stderr pipe and never drains it**,
`process.exitCode` did not exit within 8 s. Both can be true of different consumers - an inherited or
`/dev/null` stderr drains, a closed pipe raises `EPIPE`, and only an *open and unread* pipe blocks -
and **I did not reproduce the doc's exact setup, so this is a second data point rather than a
correction.** It matters because **a hang in a pre-commit hook is a worse failure than a truncated
report**, and the two-half remedy as filed does not address it. Pin both consumer shapes.

### The specification for the engine

Four obligations are riding on the single call `process.exit(code)`, which is why every partial fix
has moved the failure somewhere else:

1. it sets the process status;
2. it **abandons node's pending write queue** - Defect A;
3. it **silently swallows `EPIPE`** from a write to a closed pipe - Defect B is what happens when that
   is removed without replacement;
4. it **forces termination** even when a write is blocked - the hang above is what happens when *that*
   is removed without replacement.

**Why writing the report and returning the correct code are not in tension once `process.exit` is out
of the picture:** the tension is manufactured entirely by (1) and (2) being the same call. The exit
code is computed from `hits.length` **before** anything is written, so the code has never depended on
the report reaching anyone; separating the status assignment from the queue teardown lets the report
drain to completion while the status is already correct. Obligations (3) and (4) then have to be
restored **explicitly**, because they were side effects nobody chose.

*Proposed minimal API:*

```ts
/** Run the scan as a CLI: broken-pipe handling, the exit status, and termination. */
export declare function runPhiScanCli(config: PhiScanConfig): void;
```

so that every repo's tail is exactly `runPhiScanCli({ ...axes });` and no repo carries process
handling at all. It must:

- install `error` handlers on **both** `process.stdout` and `process.stderr` **before the first
  write**, swallowing `EPIPE` / `ERR_STREAM_DESTROYED` and rethrowing anything else;
- set `process.exitCode` from `runPhiScan`'s return, and never call `process.exit` on the success
  path;
- **guarantee termination** for a consumer that never drains. This arm is unmeasured as to remedy and
  must not be shipped on reasoning: the choices are a bounded flush window followed by an explicit
  `process.exit(code)`, or accepting the hang and documenting it. Pin it before shipping.

*Reproducing cases for the pin:*

- **A:** 2,000 files each carrying a distinct dashed-SSN-shaped violator; spawn with
  `stdio: ["ignore","ignore","pipe"]`, attach a `data` listener and immediately `pause()` the stream;
  assert every `HIT:` line **and the summary line** arrive once resumed, and assert the child exits
  within a bound. The mutation pin already recorded in the evidence doc still applies: restoring
  `process.exit` reds it.
- **B:** a clean corpus, `phi-scan | head -0`; assert `PIPESTATUS[0]` is `exitCodes.clean`.
- **Control:** the same argv over a corpus with hits; assert `exitCodes.hits`, so a guard that
  swallowed too much would red.

---

## 7. State of this branch, disclosed

- `scripts/phi-scan.ts` is the derivation **in executable form** - it is what produced every number
  above and it is how they can be re-run. It is **not** the shipping answer: it still carries ~600
  lines of detector traversal that the parameterize-everything rule moves into the engine as kinds
  plus vocabulary.
- `test/scripts/phi-scan.test.ts` is **NOT migrated**: 48 of its 93 cases fail on this branch. The
  failures are the expected ones - `OK, no hits` → `OK: no hits`, `element=` → `segment=`, the
  dropped sentinel announcement (E4), and cases whose throwaway repo has an empty index, which the
  engine now refuses. Migrating it before the engine's final parameter shape exists would be work
  done twice. The split it needs: the cases under *"the all-mode walk refuses…"*, *"the --staged
  route refuses…"*, *"a staged rename is enumerated"*, *"an unmerged path…"*, *"the sweep reads the
  bytes git carries…"* and *"a sweep refuses to report clean over what it never opened"* are **engine
  property tests** and belong in `config`; the cases under *"the FHIR-keyed literal recogniser"*,
  *"the markdown exemption"*, *"tracked files directly under test/"* and *"the positive control fires
  on this repository's own corpus shape"* are **this repo's parameter tests** and stay.
- **No changeset and no `CHANGELOG.md` entry**, deliberately: a changeset on a branch that must not
  merge is an invitation to release it.
- `@cosyte/script-utils@^0.0.2` is a **devDependency** and will need editing to whatever version the
  engine change publishes. On the `0.0.x` ladder `^0.0.2` resolves to `0.0.2` only.
