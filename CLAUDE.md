# @cosyte/fhir: Project Guide for Claude

**▶ The narrative lives in [`documentation/agent-notes.md`](documentation/agent-notes.md)**, verbatim
and re-headed (2026-08-04, `CLAUDE-MD-AUDIT`, amending the meta-repo's `decisions/0023-doc-budgets.md`).
Every trap here points at the section there that explains what it cost. **Never delete a trap to save
bytes. Move narrative there and leave the one-liner here.**

## Project

**`@cosyte/fhir`**: a developer-focused FHIR parser + utility library for Node.js/TypeScript.
The FHIR member of the cosyte parser suite; it mirrors the API shape of `@cosyte/hl7`, the
reference parser.

**North star:** A developer can read a real-world FHIR resource, model it with correct primitive
semantics, and validate it against US Core, without reading the FHIR spec.

## Status

- **`0.0.10` IS ON NPM. `0.0.11` WAS REFUSED. `FHIR-NPM-NAME` IS NOT CLEARED, AND A PRIOR VERSION OF
  THIS LINE SAYING IT WAS IS THE MISTAKE TO LEARN FROM.** `0.0.10` published 2026-08-26 with a
  deliberately NARROWED tarball and is `latest`, tagged, with provenance. `0.0.11` restored the
  README, the changelog and the sourcemaps, and on 2026-08-28 it drew the identical bare `E403` on
  `PUT https://registry.npmjs.org/@cosyte%2ffhir`, provenance signed into rekor first
  (logIndex `2626322912`) exactly as every refusal before it. Still pre-alpha.
  **Read the version from `package.json`, never infer it from npm**: it runs ahead again, at `0.0.11`
  unpublished with no tag.
  - **THE CONTENTS ARE NOW THE LEADING HYPOTHESIS, WHICH IS A REVERSAL, AND IT IS STILL NOT PROVEN.**
    The one publish that succeeded is the one that stripped the tarball; the next one restored it and
    was refused. **The confound is that `0.0.10` CREATED the package and `0.0.11` ADDED A VERSION to
    an existing one, which is a different operation**, so contents and operation both changed. Do not
    write this up as settled in either direction. The control that separates them is a narrowed
    republish now that the package exists.
  - **Do not conclude from one publish.** This trap exists because that is what happened here: the
    success was written up as the block being over, and the very next publish refuted it.
    The full sequence and what each attempt controlled for:
    [`agent-notes.md#publish-state-fhir-npm-name`](documentation/agent-notes.md#publish-state-fhir-npm-name)
  - **The "name-similarity" reading is RETRACTED. DO NOT RENAME OR RESCOPE THE PACKAGE ON IT.** npm
    has never named similarity or the unscoped `fhir` package in anything it returned. The three
    evidence clauses moved to the notes 2026-08-07, and are not summarised again here:
    [`#fhir-npm-name-the-evidence-which-was-duplicated`](documentation/agent-notes.md#fhir-npm-name-the-evidence-which-was-duplicated).
  - **A SUCCESSFUL PUBLISH IS NOT VISIBLE THE MOMENT IT SUCCEEDS, AND A 404 INSIDE THAT WINDOW IS
    NOT A FAILURE.** `0.0.10` returned `success` while the PACKAGE document was still `404` and the
    VERSION document and the tarball were already `200`. The pipeline's own post-publish probe fired
    inside that window and marked the run failed with `verdict: uninstallable`, which was wrong. It
    resolved on its own. **Re-check the package document before reading anything into a 404**, and
    do not act on a single reading taken seconds after a publish.
  - **Do not generalise the error code across the three affected packages; publish state and
    installability are independent.** Verbatim:
    [`#publish-state-fhir-npm-name`](documentation/agent-notes.md#publish-state-fhir-npm-name)
  - **A PUBLISHED VERSION IS PERMANENT AND CAN NEVER BE RE-FIRED.** `0.0.10` is out and is the floor.
    The versions npm refused, none of which reached the registry, are `0.0.2`, `0.0.3`, `0.0.7`,
    `0.0.8` and now `0.0.11`.
  - **`0.0.10` SHIPPED A 234-BYTE STUB README AND NO CHANGELOG**, because it was a deliberately
    narrowed diagnostic tarball, and a published version cannot be withdrawn. The restoration is
    written and merged but **`0.0.11` never published**, so that stub is what a consumer installs
    today. **Do not read `0.0.10`'s tarball as the intended package shape.**
  - **This repo is public and the uploaded npm debug-log artifact is downloadable**: re-check it by
    hand before ever linking one.
- **Phases 1–9 landed; P10 landed (halves a + b); P11's buildable tiers landed.**
  **▶ IT IS NOT A NO-DATA-LOSS CLAIM OVER THE WHOLE PACKAGE**: read-path losses remain open and
  declared, and the one that qualifies "never drops a modifier, status or negation" is a **status**
  or a dose number written as XML element text (dropped and reported, the writer refuses, but the
  safety spine reads `negations: []`). The envelope, today's precisely, the losses, what is left open
  and the per-phase history, all in `agent-notes.md`:
  [`#the-shipped-envelope-p1-through-p11`](documentation/agent-notes.md#the-shipped-envelope-p1-through-p11) ·
  [`#p2-p3-and-what-the-package-does-today`](documentation/agent-notes.md#p2-p3-and-what-the-package-does-today) ·
  [`#open-read-path-losses-enumerated`](documentation/agent-notes.md#open-read-path-losses-enumerated) ·
  [`#left-open-deliberately-a-through-e`](documentation/agent-notes.md#left-open-deliberately-a-through-e) ·
  [`#shipped-phase-history-p11-back-to-p1`](documentation/agent-notes.md#shipped-phase-history-p11-back-to-p1)
- Roadmap: the meta-repo's `operations/roadmaps/fhir.md` (P0…P11).

## Traps

**▶ The traps live in [`CLAUDE-traps.md`](CLAUDE-traps.md)**, one file over and moved verbatim,
because this file is held to a 300-line ceiling and they do not fit under it. Read them before you
touch the model, the safety spine, either codec, the terminology layer, the PHI scan or the
differential harness. **Nothing was dropped to make room; every line of them is still there.**

## Tech Stack and the four architecture ADRs

**Relocated 2026-08-07:**
[`#relocated-out-of-claudemd-on-2026-08-07-to-make-genuine-room-for-a-trap`](documentation/agent-notes.md#relocated-out-of-claudemd-on-2026-08-07-to-make-genuine-room-for-a-trap).
The toolchain is **inherited** from the published `@cosyte/*` config packages, never copied: read
the versions off those, never off a copy here. **RUNTIME DEPS ZERO**, TS strict, dual ESM+CJS via
tsup, per-dir coverage >= 90, MIT. The four ADRs are in `documentation/decisions/`, their source of
truth: **`0001`** string-backed decimal/`integer64`, **`0002`** a bounded in-repo FHIRPath subset (no
third-party engine), **`0003`** JSON-first, **`0004`** R4-first (`4.0.1` modeled; R5/DSTU2
read-tolerance only).

## Engineering Guardrails

- No `any`. No unjustified `as` casts. Use `unknown` and narrow.
- JSDoc (with `@example`) on every public export: feeds IntelliSense.
- Immutable by default. Mutation only via explicit methods.
- No `console.*` in library code. Throw typed errors or return results.
- Postel's Law: the reader is liberal (lenient default + warnings), the writer is conservative: it
  authors no value of its own, and emits spec-clean FHIR for every model FHIR can express. It is
  **not** unconditionally spec-clean; its exceptions are named on `serializeResource`. **Read them
  there, never from a copy**: this line's copy listed three and had been two short since the `null`
  and `_`-sibling closures. Repairing one means inventing content or dropping it. Hand a value back
  (`FhirComplex.nonObjectSource`); **never model it as a primitive**, which would show it to every
  walker at a complex position. **Every write refusal is EITHER checked AT the site that writes the
  thing OR a WHOLE-MODEL PRE-PASS RAISED LAST, and two of them run in BOTH writers. Read the list
  off `SERIALIZE_ERROR_CODES`, never a count or an enumeration here.**
  [`#div-forges-a-negation`](documentation/agent-notes.md#div-forges-a-negation-2026-08-07)
- Diagnostics are **value-free by contract**: an `IssueCode` plus a FHIRPath expression. **That is
  not a claim that a location carries no document content** (a name is echoed when it matches the
  bounded published form). See the derived-name trap above, and do not widen it into one. **The
  other half of that claim is scoped too and must stay scoped**: the JSON reader's `expression` no
  longer carries English prose, NOT that every `expression` is resolvable FHIRPath. A `<withheld>`
  segment and the XML reader's `.@name` attribute form are deliberately **admitted** by
  `test/expression-grammar.test.ts` rather than hidden.
- **Deliberate omissions, each of which reads as an oversight and is not.** `markNestedArray`,
  `markDroppedText` and `markUndefinedNull` are reader-internal and **not exported**; `typeOf` stays
  the strict single-value read (**reject** an unreadable type, never guess);
  the element-text refusal fires even beside a value that arrived, and
  **do not justify that arm with "content the sender wrote is still missing"** (the gate broke that
  sentence with `<status value="final">final</status>`) since the rule keys on dropped character data
  and never compares text to value; and the two defensive `rootPath` calls in the terminology layer
  and the dose locator are the identity where observable, which the gate **does not pretend to
  cover**. Each reason, relocated 2026-08-07:
  [`#deliberate-omissions`](documentation/agent-notes.md#deliberate-omissions).
- **PHI discipline:** synthetic-only fixtures, redaction in logs. Never commit realistic PHI. The
  vendor-quirk grounding rule is stated once, under "Terminology, profiles, invariants".

## Standing disciplines (every change)

Disciplines **1 to 3 are the meta-repo's own**, in `documentation/conventions.md`, and bind here
unchanged; only what is fhir-specific is repeated. **1** docs follow code: this repo's docs, the
meta-repo's `documentation/repos/fhir.md`, and the `ecosystem-map.md` status table. **2** a Changeset
(`patch` on the `0.0.x` ladder) plus a `CHANGELOG.md` `[Unreleased]` entry. **3** the crew skill is
`fhir-resource-design`, plus the KB product doc. The fourth is this repo's own:

4. **No internal project bookkeeping on a public surface** (founder directive, 2026-07-27). Item
   identifiers (`FHIR-P10`), phase/wave language, ADR numbers and meta-repo paths belong in the
   changeset, `CHANGELOG.md`, the commit, the PR and the roadmap, never in what a consumer is
   _shown_. It is a **translation** at the boundary, not a deletion: repair the head of a line you
   strip an identifier off. Gated by `pnpm check:no-internal-refs`. Why, and what the gate does not
   cover:
   [`#no-internal-project-bookkeeping-on-a-public-surface`](documentation/agent-notes.md#no-internal-project-bookkeeping-on-a-public-surface)
   - Doc comments and string literals are **gated** (they reach the consumer's editor and logs);
     `//` and `/* */` comments are **not**, and identifiers **belong** there. **Do not justify that
     boundary from what reaches `dist/`**; measure reach, never grep it. **Removing a doc comment to
     satisfy the gate is a regression, not a fix.**
   - **There is deliberately no `slice` rule in this copy**: `slice` is R4 vocabulary here
     (`ElementDefinition.slicing`), measured at 41 matches with one of them ours. **Do not paste the
     sibling rule back without re-measuring.**
   - Two holes are open on purpose (`FHIR-P10b`-style suffixes; trailing `phase`) and `CHANGELOG.md`
     is deliberately not scanned. The reviewer owns half the rule.
