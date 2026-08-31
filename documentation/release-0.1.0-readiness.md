# Release readiness for `0.1.0`

An audit of whether `@cosyte/fhir` can be released as `0.1.0` from this tree, what would be in that
release, and what stands in the way. Measured on the working tree at branch point
`013364d77413f35bb5661d6a875ba43a8f181976`, the tip of `main` at the time of writing.

**Verdict: NOT RELEASABLE as `0.1.0`.** Two independent blockers, either one sufficient:

1. **The pending set is empty.** `.changeset/` holds zero changesets, so Changesets derives no
   version at all. There is nothing to release, let alone a `0.1.0`.
2. **The repository's own version ladder does not permit a `0.1.0`.** `CHANGELOG.md` states the
   project stays on the `v0.0.x-until-first-alpha` ladder, `CONTRIBUTING.md` and
   `.changeset/README.md` repeat it, and `test/sanity.test.ts` pins it with an assertion that a
   `0.1.0` would turn red. This is a policy question this audit records rather than answers. See
   [The version ladder](#the-version-ladder).

A third finding is not a blocker on `0.1.0` but is the substantive result of the audit: **the
release that already shipped, `0.0.11`, carried two changes this repository's own release
classification rule scores as breaks, both declared `patch`.** See
[What already shipped as a patch](#what-already-shipped-as-a-patch).

---

## The pending changeset set, as measured

`.changeset/` on this tree:

| file | is a changeset | declared level | rule level | justification |
| --- | --- | --- | --- | --- |
| `README.md` | no | n/a | n/a | one of the two files in the directory that are not changesets |
| `config.json` | no | n/a | n/a | the Changesets configuration |

**Zero pending changesets.** The table above is complete: there is no file in `.changeset/` other
than those two.

### Why this differs from the reading this work was commissioned against

The work item recorded "0 pending changesets" measured on 2026-08-25, and the specification recorded
FIVE, measured at pin `18ee8bae8b303bbcfd9389ada6af04ff7d48e167`. Neither is what is here now, and
the difference is not drift in the measurement. It is a release:

- `18ee8bae` (the pin) did hold five changesets, every one declaring `patch`, with `package.json` at
  `0.0.10`.
- `e04f0ee` added a sixth, `restore-tarball-documentation.md`, also `patch`.
- `5fc7ca5`, the merge titled `Version Packages (#108)` on 2026-08-28, **consumed all six**, deleted
  them, and bumped `package.json` and the `VERSION` export from `0.0.10` to `0.0.11` in one commit,
  which is what `pnpm run version` does by design.

So the button this audit exists to get ahead of was pushed while the specification was being
written. The pending set is empty because it was spent.

### What `0.0.11` is, and is not

`package.json` and `src/index.ts` both read `0.0.11` on this tree. **That version is not on npm.**
The repository's own status note records that the `0.0.11` publish drew an `E403` from the registry
on 2026-08-28 and never landed, so `0.0.10` remains `latest` and `0.0.11` is a version number that
exists only here, with no tag. That does not soften finding 3 below: the classification was made,
the version was derived from it, and the only reason it did not reach a consumer is an unrelated
registry refusal. Read the version from `package.json`, never from npm.

## How a pending changeset is classified, and when the check refuses

The classification rule is applied by `test/release-readiness.test.ts`, which runs under `pnpm test`
with no build, no JVM, no network and no credentials. A level can be established through exactly two
channels, and a changeset neither channel reads is **refused, never scored `patch`**.

**Channel (a): the changeset's own text.** A narrow phrase recogniser carries the idiom this
repository has actually used, so it recognises a withdrawal stated in those words, new capability
stated in those words, and the "nothing here ships in the published artifact" that this rule names
as evidence for `patch`. It is narrow, and **narrow means it misses**: ordinary changeset prose
spelling any of the cases the rule names in general terms goes unrecognised. A miss is therefore
worth nothing in either direction. What the recogniser buys is one thing: it can RAISE a level and
name a break an author declared too low.

**Channel (b): the audit's classification register**, `test/__data__/changeset-classification.json`.
This document writes it and the check reads it, keyed by file name inside `.changeset/`, each entry
carrying the level, whether it is a break candidate, the observable a consumer would see, and the
reason. It exists because the criterion this audit answers to speaks of *a changeset the audit
classifies as a break candidate*, and a check whose only authority is its own keyword list gives
that phrase no input at all. An entry may raise a level and name a break; it can never lower a level
the changeset's own text established, nor clear a break that text described, so the effective level
is the higher of the two readings and an entry cannot talk a break down into a fix. A register entry
that names a break candidate without its observable, or assigns a level other than `patch` or
`minor`, or carries no reason, is itself a refusal.

**When neither channel speaks the whole set is refused.** The check reports NOT RELEASABLE, names
the file, derives no version, and counts nothing classified. That is the same fail-closed shape a
malformed changeset already gets, and it is the reason a set carrying an undeclared break cannot be
reported ready: the report never rests on a level nobody established. The register is empty on this
tree because the pending set is empty; the refusal is exercised by fixtures, including the four
cases the classification rule names in general terms, and each of those was observed passing under a
silent `patch` default before this behaviour existed.

**This is not answered by a longer phrase list.** A longer list has the same shape and the same
blind spot one paraphrase further out. The register is the channel for a reading a keyword cannot
make.

## The derived version

With zero pending changesets there is no highest level to resolve and **Changesets derives no new
version**. `0.0.11` stays `0.0.11`.

This does not equal `0.1.0`. What is missing, stated concretely: **at least one pending changeset
declaring `minor`**. From `0.0.11`, a single `minor` derives `0.1.0` exactly. No number of `patch`
changesets ever will; they derive `0.0.12`, `0.0.13`, and so on along the same ladder.

That is the mechanical answer. It is not permission, because the ladder question below is unresolved.

## The version ladder

`CHANGELOG.md` opens with the sentence this audit is required to quote verbatim. It reads, in full
and unedited:

> All notable changes to `@cosyte/fhir` are documented here. The format follows
> [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project stays on the
> **v0.0.x-until-first-alpha** ladder (meta-repo ADR 0001) until its first alpha.

**It does not permit a `0.1.0` release.** A `0.1.0` is by definition off the `v0.0.x` ladder, and the
sentence conditions leaving that ladder on the project's first alpha, which has not been declared
anywhere in this repository.

This is recorded as a **blocking finding**, not resolved here. Three further statements in the tree
say the same thing, so this is a settled repository policy and not a stray line:

- `CONTRIBUTING.md`: "add a Changeset (`pnpm changeset`, pick **patch** on the pre-alpha `0.0.x`
  ladder)".
- `.changeset/README.md`: "During pre-alpha, pick **patch**: that keeps the package on the `0.0.x`
  ladder until its first alpha."
- `test/sanity.test.ts` asserts `VERSION` matches `/^0\.0\.\d+$/` under the name "starts on the
  v0.0.x pre-alpha ladder". **A `0.1.0` turns that test red.** The policy is executable, not
  advisory, and shipping `0.1.0` means deliberately editing that assertion.

**Who must decide.** The sentence attributes the ladder to **meta-repo ADR 0001**, which is outside
this repository. The decision to leave the `v0.0.x` ladder therefore belongs to **the owner of that
ADR**, which for this repository's purposes is its owner of record, **noah**. Two things are needed
from that decision before a `0.1.0` can proceed, and neither is this audit's to make:

1. A declaration that the first alpha has been reached, or an amendment to the ladder itself.
2. A consequential update to `CHANGELOG.md`, `CONTRIBUTING.md`, `.changeset/README.md` and the
   `test/sanity.test.ts` assertion, in one change, so that the four do not disagree.

This audit deliberately edits none of those. Inventing the policy locally is precisely the failure
mode the requirement to quote the sentence exists to prevent.

## What already shipped as a patch

The six changesets `Version Packages (#108)` consumed are re-read here against the classification
rule, from their own text. This is retrospective: none of these files is pending, and nothing in
this audit can change what they produced. It is recorded because the question the work item asked
("classify the pending set so `0.1.0` means what it says") has a real answer, and the answer is that
the set was misclassified before it was spent.

The rule applied, in brief: `major` is unavailable on a `0.x` line; `minor` for new public capability
OR any withdrawal or narrowing of previously working public behaviour; `patch` only for a fix leaving
every public observable identical, or a change that does not reach the published artifact at all. A
withdrawal is `minor` at minimum because on a `0.x` package the minor position is the only place a
break can be signalled. The full rule is restated in the header of `test/release-readiness.test.ts`,
where the check applies it.

| changeset | declared | rule | break candidate | justification, from its own text |
| --- | --- | --- | --- | --- |
| `brave-pandas-refuse.md` | `patch` | **`minor`** | **yes** | "**This withdraws an XML round trip from a document that reads `valid: true`**". It also adds the `isForeignRoot` export and the `UNSERIALIZABLE_FOREIGN_ROOT` code, so it is `minor` on the capability arm too. |
| `quick-moons-listen.md` | `patch` | **`minor`** | **yes** | Six resource types "each gain a complete direct-element table", where before "a caller ... got an informational note ... and no structural check of that resource's own elements at all". It says the change "closes in the direction that only ever adds a finding", which is a widened finding set that can turn a previously `valid` document invalid. |
| `olive-donkeys-declare.md` | `patch` | **`minor`** | no | "`CodeValidationResult` now carries an optional `systemVersion`", plus the new `CODE_SYSTEM_VERSION_RECORD_CODES` and `CODE_SYSTEM_VERSION_RECORD_SYSTEM` exports. Its own word for itself is "**Additive throughout**": new public capability, nothing withdrawn. |
| `lucky-moons-repeat.md` | `patch` | `patch` | no | "**No library code changed, ... and nothing here ships in the published artifact.**" |
| `tidy-cranes-measure.md` | `patch` | `patch` | no | "**No library code changed; nothing here ships in the published artifact.**" |
| `restore-tarball-documentation.md` | `patch` | `patch` | no | Restores `README.md` and `CHANGELOG.md` to the tarball's `files`. It changes what the tarball carries, adds nothing to the API and withdraws nothing; every public observable of the library is identical. |

**Had the rule been applied at pin `18ee8bae`, the highest level in the set would have been `minor`,
and Changesets would have derived `0.1.0` from `0.0.10` exactly.** The `0.1.0` this batch is asking
for was reachable at that pin, from those changesets, and shipping the set as six patches is what
foreclosed it. That is the single most useful sentence in this audit.

### The break candidates, with their observables

Both are stated as observables a consumer can reproduce, not as summaries, and both are pinned by
assertions in `test/release-readiness.test.ts` so they cannot quietly stop being true.

**1. A safety-critical resource type that was structurally unchecked is now checked.**

- Published symbols a consumer sees: `validateResource`, `ValidationResult.valid`, and the
  `VALIDATION_CODES` members `CARDINALITY_MIN`, `UNKNOWN_ELEMENT`, `TYPE_MISMATCH`, `CODE_INVALID`
  and `CHOICE_AMBIGUOUS`.
- Before: `validateResource` on `{"resourceType":"MedicationRequest","id":"..."}` returned
  `valid: true` with a single informational `RESOURCE_NOT_MODELED`.
- Observed on this tree: the same document returns **`valid: false`**, carrying `CARDINALITY_MIN`
  errors, and `RESOURCE_NOT_MODELED` is gone.
- Why it is a break and not an improvement: a consumer's feed that validated clean before now fails,
  after taking what was labelled a patch. The change is right; its version signal was not.
- Control: `Procedure`, still outside the registry, is unchanged at `valid: true` with
  `RESOURCE_NOT_MODELED` alone, so this is the registry widening rather than a global tightening.

**2. An XML document that reads `valid` can no longer be written back.**

- Published symbols a consumer sees: `serializeResourceXml`, `FhirSerializeError`, and
  `SERIALIZE_ERROR_CODES.UNSERIALIZABLE_FOREIGN_ROOT`.
- Before: a resource read from an XML root in a vendor namespace was written back as authoritative
  FHIR.
- Observed on this tree: the read is unchanged and still reports `valid: true`, and
  `serializeResourceXml` now **throws** `FhirSerializeError` with code
  `UNSERIALIZABLE_FOREIGN_ROOT`.
- Why it is a break and not an improvement: the refusal is the correct behaviour, and it still
  withdraws a round trip that used to succeed on a document nothing rejects.
- Control: the same document rooted in the FHIR namespace still serializes.

### The finding this leaves open

`0.0.11` was derived in this repository as a patch over a set containing two breaks. It never
reached npm and carries no tag, so **no consumer has yet been given a break labelled as a patch**.
Deciding what to do with that, republish the same content under a `minor` once the ladder question
is settled, or let `0.0.11` stand, belongs with the ladder decision above and to the same decider.
It is recorded here rather than acted on.

A second, smaller consistency defect is recorded rather than fixed. `changelog: false` in
`.changeset/config.json` means Changesets writes no changelog entry, so `CHANGELOG.md` is maintained
by hand, and its `## [Unreleased]` section still carries the entries for changes that
`Version Packages (#108)` consumed into `0.0.11`. Those entries are no longer unreleased in the
repository's sense, though `0.0.11` is also not on npm, and that ambiguity is exactly why this audit
does not resolve it: writing a `## [0.0.11]` heading would assert a release state that is true of
the repository and false of the registry. It needs the same decision as the ladder, and this audit
carries **no** pending changeset whose entry would need adding.

## The certified public surface

`test/__data__/public-surface-0.1.0.json` is the committed inventory of what a consumer may depend
on: every name the entry point exports, split by whether it survives to runtime or is erased by the
type system, plus the subpaths `package.json` publishes. Counts as measured:

| | count |
| --- | --- |
| runtime value exports | 170 |
| type-only exports | 102 |
| `exports` subpaths | 2 (`.` and `./package.json`) |

`test/release-readiness.test.ts` compares the inventory against the entry point in both directions,
so neither a removal nor an uncertified addition passes silently, and it compares export KINDS as
well as names, because `import { X }` breaks when a runtime value becomes type-only even though the
name survives. Each direction was observed failing against a deliberately mutated inventory before
being relied on; the mutations and their results are recorded in the implementation notes.

## Publish preconditions, as observed

Every command below was run on this tree, with the new test file and inventory in place. These are
observed results, not expectations.

| command | observed |
| --- | --- |
| `pnpm typecheck` | pass, exit 0, no diagnostics |
| `pnpm lint` | pass, exit 0, no errors or warnings |
| `pnpm test` | pass, exit 0. **89 files, 2454 tests**, up from 88 and 2390 before this change |
| `pnpm build` | pass, exit 0. ESM 250.99 KB, CJS 255.50 KB, `index.d.ts` 392.74 KB |
| `pnpm attw` | pass, exit 0. "No problems found", green on node10, node16 CJS, node16 ESM and bundler |
| `pnpm pack:docs` | pass, exit 0. Produced **both** `dist-artifacts/docs-content.tar.gz` and `dist-artifacts/source.tar.gz` |
| `pnpm phi-scan` | pass, exit 0, "OK, no hits", with no new overrides entry and no new allow-list token |
| `pnpm check:no-emdash` | pass, exit 0 |
| `pnpm check:no-internal-refs` | pass, exit 0 |

The `validator_cli.jar` differential gates are **not run here**. They are CI-only and need a JVM this
container does not have. Two of the six changesets classified above are about those gates, and both
were classified from their own text, which is what the rule asks for.

### The docs artifact build refuses a withheld input

`scripts/build-docs-artifacts.sh` declares five inputs: `docs-content/intro.md`,
`docs-content/sidebars.json`, `src/`, `package.json` and `tsconfig.json`. Both of its guards were
exercised by withholding an input and running the real script. Observed:

| input withheld | observed exit | observed message |
| --- | --- | --- |
| `tsconfig.json` | **1** | `error: source bundle requires src/, package.json, and tsconfig.json at the package root` |
| `docs-content/intro.md` | **1** | `error: docs-content/ must contain intro.md and sidebars.json` |

In both cases **no artifact was reported built** and the run stopped before `tar` was reached. Each
input was restored immediately afterwards and the tree confirmed byte-identical with `git status`,
which reported no modification to any tracked file.

## What this audit did not touch

- **Nothing was published and nothing was made inevitable.** No `changeset version`, no
  `changeset publish`, no `pnpm run version`, no `pnpm run release`, no tag, no npm publish.
  `package.json` still reads `0.0.11`, the `VERSION` export still agrees with it, `.changeset/`
  still holds its two non-changeset files and no `pre.json`, and running the check consumes
  nothing. All of it is asserted in `test/release-readiness.test.ts`. What is deliberately **not**
  asserted there is that the pending set is EMPTY: that is a fact about this tree's release state
  rather than about publication, and asserting it would turn every changeset a later change
  legitimately adds into a red suite, including the one step 2 below recommends. What is asserted
  instead is that the pending set is CLASSIFIED, which is the property that keeps this audit honest.
- **No changeset was reclassified**, because none is pending. The corrections the rule would have
  made are recorded above against files that no longer exist.
- `README.md`, `docs-content/` and `package.json`'s `description` field are each owned by another
  item in this batch and are untouched here.
- `CHANGELOG.md`'s version-ladder sentence is quoted above and deliberately not edited.
- No library behaviour changed. Nothing under `src/` was modified.
- **This change adds no changeset of its own, deliberately.** The repository's standing discipline is
  a changeset per change, and the reason one is withheld here is that this audit's headline
  measurement is the size of the pending set: adding a changeset would make the set non-empty, so
  the document would be reporting on a condition it had itself created, and the readiness check
  would be grading its own entry. A changeset is also an input to the release machinery, and this
  work is scoped to leave that machinery exactly where it found it. The contents of this change,
  one test file and two documents, reach no consumer: nothing here ships in the published artifact,
  which is the same ground on which two of the six changesets above are classified `patch`. If the
  ladder decision above is taken and a release is prepared, the changeset written then should
  describe the breaks, not this audit.

## If the ladder question is answered "yes, go to 0.1.0"

Recorded so the next reader does not have to re-derive it. This is a sequence, not a recommendation.

1. Settle the ladder in `documentation/`, and update `CHANGELOG.md`, `CONTRIBUTING.md`,
   `.changeset/README.md` and the `test/sanity.test.ts` assertion together.
2. Add one changeset declaring `minor`, whose prose names the two breaks recorded above so they
   appear in the release notes as breaks rather than as fixes, and classify it in
   `test/__data__/changeset-classification.json` unless its own prose already says the cost in
   words the recogniser carries. An unclassified pending changeset is a refusal, by design.
3. Re-run the readiness check. From `0.0.11` a single `minor` derives `0.1.0`.
4. Re-run the precondition chain and `pnpm pack:docs`.
5. Re-certify the public surface inventory if any export moved in the meantime; the test reds if it
   did.
