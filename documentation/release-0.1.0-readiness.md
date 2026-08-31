# Release readiness audit: `@cosyte/fhir` 0.1.0

**Verdict: NOT RELEASABLE from this tree.** The pending changeset set is well formed and, once
correctly classified, derives exactly `0.1.0`. What blocks the release is not the set: it is that
this repository's own committed statements say it stays on the `0.0.x` ladder, and one of them is a
test that reds the moment a `0.1.0` is written. Those are decisions somebody has to take, not defects
to fix here. Finding F1 below names who.

Measured on 2026-08-31 against the working tree at commit
`18ee8bae8b303bbcfd9389ada6af04ff7d48e167` plus the changes in this branch. Nothing here bumps a
version, runs `changeset version`, `changeset publish`, `pnpm run version` or `pnpm run release`,
tags anything, or publishes anything. Every changeset it classifies is still pending.

The machine-readable half of this document is
[`release-0.1.0-classification.json`](./release-0.1.0-classification.json), which
`scripts/release-readiness.mjs` reads and `test/release-readiness.test.ts` grades against the files.
This prose and that data are checked against each other by the suite, so they cannot drift apart in
silence.

---

## 1. Classification rule

The authority this audit applies, stated in full so no external source is needed to grade it.

- **`major` is not available.** The package is on a `0.x` line, and a `major` would derive `1.0.0`,
  which is a different release decision from the one this audit is about. A pending changeset
  declaring `major` is a finding, not a classification.
- **`minor`** when the changeset describes EITHER new public capability (a new export, a new optional
  member on a public type, an input the public API now accepts that it previously refused, a new
  published diagnostic code a consumer can switch on) OR any WITHDRAWAL or NARROWING of previously
  working public behavior (an output the library now refuses to produce, a document that now reports
  an error where it reported none, an export or member removed or renamed, a widened set of findings
  that can turn a previously `valid` document invalid).
- **`patch`** when the changeset describes only a fix that leaves every public observable identical,
  or a change with no effect on the published artifact at all (tests, harnesses, CI, in-repo
  documentation). "Nothing here ships in the published artifact" in a changeset's own text is
  evidence for `patch`, and this audit quotes it where it relies on it.
- **A withdrawal is `minor`, never `patch`, precisely because `major` is unavailable.** On a `0.x`
  package the minor position is the only place a break can be signalled at all, so a break candidate
  is `minor` at minimum AND is recorded as a break candidate in its own right.

## 2. The pending set, re-measured

`.changeset/` was re-read rather than taken on trust. At the pin it held **five** changesets beside
its two non-changeset files (`README.md` and `config.json`), which is what a reading dated 2026-08-25
recorded as **zero**: that reading is stale, and the count below is the tree's. This branch adds a
sixth for its own work, per this repository's standing rule that every change carries a changeset,
so the set under audit is **six**.

All five pre-existing changesets declared `patch`. **Three of them are not patches under the rule.**
Their declared levels have been corrected, editing the bump level line only; the prose of all five is
byte-identical to the pin, which the readiness check pins by SHA-256 of everything below the closing
`---` rather than by assertion.

| file | declared (at pin) | rule yields | now declares | break candidate | justification, from the changeset's own text |
|---|---|---|---|---|---|
| `brave-pandas-refuse.md` | `patch` | **`minor`** | `minor` | **yes** | It states its own cost: "This withdraws an XML round trip from a document that reads `valid: true`". It also adds the public export `isForeignRoot`, the model marker `FhirComplex.foreignRoot`, and a new published refusal code. A withdrawal of previously working public behavior is `minor` at minimum. |
| `lucky-moons-repeat.md` | `patch` | `patch` | `patch` | no | Its own closing sentence: "No library code changed, the pinned oracle release, the FHIR version and the loaded implementation guide are where they were, and **nothing here ships in the published artifact**." The whole change is the `validator_cli.jar` differential harness and its CI job. |
| `olive-donkeys-declare.md` | `patch` | **`minor`** | `minor` | no | "`CodeValidationResult` now carries an optional `systemVersion`", plus `ValidationIssue.codeSystemVersion` and the new `CODE_SYSTEM_VERSION_RECORD_CODES` / `CODE_SYSTEM_VERSION_RECORD_SYSTEM` exports. New public capability, and it declares itself "Additive throughout", so it is `minor` and not a break candidate. |
| `quick-moons-listen.md` | `patch` | **`minor`** | `minor` | **yes** | Six safety-critical types gain complete element tables where a caller previously "got an informational note saying the type had no element table, and no structural check of that resource's own elements at all". That is new capability AND a widened finding set that can turn a previously `valid` document invalid, which the rule names explicitly. |
| `tidy-cranes-measure.md` | `patch` | `patch` | `patch` | no | Its own closing sentence: "No library code changed; **nothing here ships in the published artifact**." The change is the differential corpus declaration, its fetch-and-verify path and the exclusion accounting. |
| `warm-pumas-audit.md` | `patch` (authored here) | `patch` | `patch` | no | This audit, the readiness check and the certified surface test. In-repo documentation, a script and tests; nothing here ships in the published artifact. |

The `validator_cli.jar` differential gates that two of these changesets are about were **not run**.
They are CI-only and need a JVM this container does not have. Both were classified from their own
text, which is what the rule asks for, and both texts state plainly that no library code changed.

## 3. Break candidates

Two, and both are now `minor`. Each is a change that withdraws or narrows behavior a consumer could
previously rely on, so it is named here rather than left to be discovered after the fact.

### BC1. `brave-pandas-refuse.md` - the XML writer refuses a foreign-rooted resource

- **Observable.** `serializeResourceXml`, given a model the XML reader built from a root that
  resolved to a namespace other than the FHIR one, previously returned XML. It now throws instead of
  writing, and the withdrawal reaches every depth such a resource is composed into (a vendor-rooted
  resource dropped into a `Bundle.entry` included).
- **Published symbol a consumer sees.** `UNSERIALIZABLE_FOREIGN_ROOT`, a member of the published
  `SERIALIZE_ERROR_CODES`, carried on `FhirSerializeError.code`.
- **What it costs, in the changeset's own words.** "This withdraws an XML round trip from a document
  that reads `valid: true`", because the foreign-root flag is a warning and the document is still
  `valid` on the way in. The read is unchanged.
- **What it is bounded by.** A FHIR-rooted document still round-trips byte-identically; a root
  declaring no namespace at all is still read as FHIR and still written; an unbound-prefix root is
  still written; and `serializeResource` (the JSON writer) emits every one of them, this class
  included.

### BC2. `quick-moons-listen.md` - six safety-critical types become structurally checkable

- **Observable.** `validateResource` over an `AllergyIntolerance`, `Condition`, `DiagnosticReport`,
  `Immunization`, `MedicationRequest` or `MedicationStatement` previously reported no structural
  finding about that resource's own elements and could return `valid: true`. The same document can
  now draw a required-element, cardinality, datatype or required-binding error and return
  `valid: false`.
- **Published symbol a consumer sees.** `VALIDATION_CODES`. The finding vocabulary is unchanged (the
  changeset states "No new validation code and no new issue code"), so the codes a consumer switches
  on are the existing published members carried on `ValidationIssue.code`, reaching the caller
  through `ValidationResult.valid` and `toOperationOutcome()`.
- **Why it is a break candidate at all, given it only adds findings.** The rule names "a widened set
  of findings that can turn a previously `valid` document invalid" as a narrowing. A consumer whose
  pipeline branches on `ValidationResult.valid` sees documents move from accepted to rejected on a
  library upgrade alone. That is the right direction for a safety library and it is still a change to
  a public observable, so it is declared rather than shipped as a fix.

## 4. The derived version

`scripts/release-readiness.mjs`, run on this tree with no arguments:

```
release-readiness: classified 6 pending changeset(s); set level `minor`; derives 0.0.10 -> 0.1.0 (target 0.1.0); break candidates: brave-pandas-refuse.md, quick-moons-listen.md.
```

Changesets takes the maximum bump level over the pending set. With `brave-pandas-refuse.md`,
`olive-donkeys-declare.md` and `quick-moons-listen.md` at `minor`, the set's level is `minor`, and
`minor` applied to `0.0.10` is **`0.1.0`**.

**This equals the target. Nothing is missing from the set.** For contrast, the set as it stood at the
pin (all five `patch`) derived `0.0.11`: a `0.1.0` was not one decision away from that tree, it was
unreachable from it, and two withdrawals of previously working public behavior would have shipped
inside a patch.

## 5. Publish precondition chain, observed

Run in this container on 2026-08-31, on this branch, in this order. No JVM, no network access to a
registry, no npm credentials were needed by any of them.

| command | observed |
|---|---|
| `pnpm typecheck` | exit 0. `tsc --noEmit`, no diagnostics. |
| `pnpm lint` | exit 0. `eslint` over `src/`, `scripts/` and `test/` at `--max-warnings=0`. |
| `pnpm test` | exit 0. `vitest run`, 89 test files, 2426 tests, 0 failed. |
| `pnpm build` | exit 0. `tsup` emitted `dist/index.mjs`, `dist/index.cjs`, `dist/index.d.ts` and `dist/index.d.cts`. |
| `pnpm attw` | exit 0. `node scripts/attw.mjs`, the two-arm gate, no resolution problems. |

`prepublishOnly` is `pnpm clean && pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm attw`,
so this is that chain with the `clean` at the front. It passes.

The three gates that are not in that chain but do run in CI were observed too, and are green with
every file this change adds:

| command | observed |
|---|---|
| `pnpm phi-scan` | exit 0, `OK, no hits`, with this change's files staged so the index half of the sweep sees them. No override entry and no allow-list token was added; both files are byte-identical to what they were. |
| `pnpm check:no-emdash` | exit 0, no em dash in any tracked file. |
| `pnpm check:no-internal-refs` | exit 0, over 4 public-surface files, the npm metadata and 62 source files. |
| `pnpm format:check` | exit 0. |

## 6. Docs release artifacts

`pnpm pack:docs` (which is `bash scripts/build-docs-artifacts.sh`) exit 0, and
`dist-artifacts/` held **both** declared artifacts:

```
built docs artifacts in dist-artifacts/:
-rw-r--r-- 1 claude claude   2070 Aug 31 14:46 docs-content.tar.gz
-rw-r--r-- 1 claude claude 260508 Aug 31 14:46 source.tar.gz
```

**The refusal was observed too**, in a temporary copy of the tree so the real one was never mutated.
Each of the script's five declared inputs was withheld in turn, and in every case the script exited
**1**, printed its error on stderr, and created **no** `dist-artifacts/` directory at all: it did not
report artifacts built, and it did not build one of the two and stop.

| input withheld | exit | message | artifacts |
|---|---|---|---|
| (control: all present) | 0 | `built docs artifacts in dist-artifacts/:` | `docs-content.tar.gz`, `source.tar.gz` |
| `docs-content/sidebars.json` | 1 | `error: docs-content/ must contain intro.md and sidebars.json` | none created |
| `docs-content/intro.md` | 1 | `error: docs-content/ must contain intro.md and sidebars.json` | none created |
| `src/` | 1 | `error: source bundle requires src/, package.json, and tsconfig.json at the package root` | none created |
| `package.json` | 1 | `error: source bundle requires src/, package.json, and tsconfig.json at the package root` | none created |
| `tsconfig.json` | 1 | `error: source bundle requires src/, package.json, and tsconfig.json at the package root` | none created |

See finding F4: the message names the input CONTRACT, not which member of it is missing.

## 7. The version ladder

`CHANGELOG.md`'s version-ladder sentence, quoted verbatim:

> All notable changes to `@cosyte/fhir` are documented here. The format follows
> [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project stays on the
> **v0.0.x-until-first-alpha** ladder (meta-repo ADR 0001) until its first alpha.

**It does not permit a `0.1.0` release.** `0.1.0` is not on the `v0.0.x` ladder, and the sentence
conditions leaving that ladder on the project's first alpha, which nothing in this tree records as
having happened. This audit does not edit that sentence and does not invent a policy this repository
has not adopted; it records the conflict as blocking finding **F1** and names who must decide.

## 8. Findings

### F1 (BLOCKING). The repository's committed version policy forbids the version the set derives.

Three committed statements in this tree say the same thing, and the release the set derives
contradicts all three:

1. `CHANGELOG.md`, quoted above: the project "stays on the **v0.0.x-until-first-alpha** ladder
   (meta-repo ADR 0001) until its first alpha".
2. `CONTRIBUTING.md`, "Opening a PR", step 3: "add a Changeset (`pnpm changeset`, pick **patch** on
   the pre-alpha `0.0.x` ladder)".
3. `CLAUDE.md`, "Standing disciplines (every change)", discipline 2: "a Changeset (`patch` on the
   `0.0.x` ladder) plus a `CHANGELOG.md` `[Unreleased]` entry".

**Who must decide.** The owner of the meta-repo decision the CHANGELOG sentence cites, which is the
only place the ladder is set. This audit deliberately does not fetch or interpret that decision; it
quotes the sentence in this tree and stops. Two outcomes are available and they are not equivalent:

- **The ladder holds.** Then `0.1.0` is not the release to take, the three `minor` classifications
  are still correct as classifications, and the release the set actually supports is the one the
  ladder permits. Note that this does NOT make the set a patch set: a `0.0.11` cut over the corrected
  levels would understate two withdrawals, which is the condition this audit exists to prevent.
- **The ladder is retired, or a first alpha is declared.** Then the three statements above and the
  test named in F2 are updated in the same change that takes the release, and `0.1.0` follows from
  the set with nothing else missing.

### F2 (BLOCKING, and mechanical). `test/sanity.test.ts` refuses a `0.1.0` outright.

```ts
it("starts on the v0.0.x pre-alpha ladder", () => {
  expect(VERSION).toMatch(/^0\.0\.\d+$/);
});
```

`pnpm run version` runs `changeset version && node scripts/sync-version.mjs`, so the `VERSION` export
becomes `0.1.0` in the same commit as `package.json`. That assertion then fails, `pnpm test` fails,
and `prepublishOnly` (which runs `pnpm test`) fails, so **the publish would not complete**. This is
not a hypothetical: it is the current, committed enforcement of F1, and it is a good thing that it
exists. It means the release cannot be taken by accident. It also means F1 cannot be resolved by
deciding quietly: whoever decides has to edit this test, in the open, in the same change.

### F3 (BLOCKING for a publish, pre-existing, not created here). The package cannot be published today.

`CLAUDE.md`'s Status section records that `@cosyte/fhir` is "**Pre-alpha, unpublished on npm**",
that "Every publish attempt is refused by npm with a bare `E403` on the scoped `PUT`", that the
support request has been open since 2026-07-23, and that "there is no git tag and no GitHub release".
That is flatly inconsistent with the premise that the package "is published at `0.0.10`":
`package.json` reads `0.0.10` and `CLAUDE.md` says to "read the version from `package.json`, never
infer it from npm", because the file "runs ahead of the registry".

The consequence for this audit is narrow and worth stating plainly: **`0.0.10` is what this
repository declares, not necessarily what a consumer can install**, and the derived `0.1.0` is
derived from `package.json` for that reason. It is also a standing human gate that no amount of
readiness work here clears. `CLAUDE.md` says to leave it blocked, and this audit does.

### F4 (non-blocking observation). The docs artifact build names the contract, not the member.

Every withheld-input case in section 6 refused correctly: non-zero, on stderr, with no artifacts
built. The message names the input SET (`docs-content/ must contain intro.md and sidebars.json`,
`source bundle requires src/, package.json, and tsconfig.json`) rather than which member of it was
missing, so the two `docs-content/` cases are indistinguishable from each other in the log, as are
the three source-bundle cases. The refusal is correct and fail-fast; only the message could be
sharper. Sharpening it is a separate change and is not made here.

### F5 (non-blocking observation). The `[Unreleased]` section already describes the set correctly.

`CHANGELOG.md`'s `[Unreleased]` section is maintained by hand (`.changeset/config.json` sets
`changelog: false`, so Changesets writes no entry), and it already carries an entry per pending
change, including the sentence "**This withdraws an XML round trip from a document that reads
`valid: true`**" for BC1. The prose was already honest about the withdrawal; only the machine-read
bump level was not. That is exactly the gap this audit closes, and it is worth recording that
reviewing the notes would never have caught it: the number Changesets reads was never in them.

## 9. What was deliberately not done

- **Nothing was published, versioned or tagged.** No `changeset version`, no `changeset publish`, no
  `pnpm run version`, no `pnpm run release`, no `npm publish`, no git tag. `package.json` still reads
  `0.0.10` and the `VERSION` export still agrees with it, both asserted by
  `test/release-readiness.test.ts`. Every classified changeset is still pending.
- **No library behavior changed.** Nothing under `src/` was touched. The certified surface inventory
  certifies what is there; it adds nothing to it.
- **The `validator_cli.jar` differential gates were not run** (CI-only, no JVM here). The two
  changesets about them were classified from their own text.
- **`README.md`, `docs-content/` and `package.json`'s `description` were not touched.** Each is owned
  by a separate item in flight; this audit says nothing about their content.
- **The version-ladder sentence was not rewritten.** See F1.
- **No PHI-scan override or allow-list token was added.** `pnpm phi-scan` is clean over this tree
  with every file this change adds in it, and both `phi-scan-overrides.md` and
  `scripts/phi-allow-list.txt` are byte-identical to what they were.

## 10. Verdict

**NOT RELEASABLE as `0.1.0` from this tree**, on F1 and F2. Not because the set is wrong: the set is
now right, it is well formed, every member is classified against a written rule, both withdrawals are
declared, and it derives exactly `0.1.0`. It is not releasable because this repository has committed,
in three places and one test, to staying on the `0.0.x` ladder, and leaving that ladder is a decision
that has not been taken. F3 says a publish would be refused by the registry today in any case.

What this tree IS: a pending set whose bump levels now mean what semantic versioning says they mean,
with its two break candidates named and pinned, its public surface certified and guarded in both
directions, and its publish preconditions observed green. The remaining distance to a release is one
decision, recorded in one place, by the owner named in F1.
