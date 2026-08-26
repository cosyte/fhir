#!/usr/bin/env bash
# scripts/check-no-internal-refs.sh
#
# Founder directive, 2026-07-27: NO INTERNAL PROJECT BOOKKEEPING ON A PUBLIC SURFACE.
# Anything a consumer reads (a GitHub release body, README.md, docs-content/, the npm
# package description, the JSDoc their editor renders on hover, the message text their log
# prints) describes what the software does and what changed. It must never carry our
# internal bookkeeping: item identifiers (`FHIR-P10`, `CCDA-P7`), "Phase 8" / "roadmap
# Phase K", sweep and programme names, ADR numbers, internal repo paths, or process
# commentary about how the artifact came to exist. Source of truth: the meta-repo's
# `documentation/conventions.md`, "No internal project bookkeeping on a public surface".
# The founder's words: "The releases should also not speak on anything regarding phases,
# etc. That has no relevance to the user consuming it. This goes for readmes and
# documentation as well."
#
# WHY THIS IS A GATE AND NOT A MEMORY NOTE. Founder, same day: "it needs to not just be
# a memory note, but something that is addressed in the workflow accordingly. This needs
# to not happen again." A one-time sweep regresses the first time someone writes
# `(Phase 12)` into a README. A documented rule governs whoever reads it; a gate governs
# everyone.
#
# WHERE THE IDENTIFIERS DO BELONG, and therefore what this gate deliberately does NOT
# scan: the changeset, CHANGELOG.md, commit messages, the PR title and body, CLAUDE.md,
# `documentation/decisions/`, source `//` comments, and the meta-repo. The traceability is
# real and worth keeping; it just belongs on the inside. So this is a translation at the
# boundary, not a deletion, and the boundary is what SCAN SURFACE below defines.
#
# ---------------------------------------------------------------------------
# WHAT IS LIFTED FROM WHERE, AND WHAT IS DELIBERATELY NOT.
#
#   * THE SHAPE is `hl7`'s `scripts/check-no-internal-refs.sh`
#     ([hl7#62](https://github.com/cosyte/hl7/pull/62), [hl7#64](https://github.com/cosyte/hl7/pull/64)),
#     which is the reference implementation the sibling parsers copy, taken by way of
#     `ncpdp`'s copy ([ncpdp#36](https://github.com/cosyte/ncpdp/pull/36)) because that one
#     already carries three fixes the hl7 original does not: the fourth pass over `src/`
#     STRING LITERALS, the plural stem in the phase rule, and `/` in the ADR separator
#     class. THE SHAPE, NOT THE FILE: the hl7 copy carries the `CSP` Clinical Study Phase
#     field names, the `PKG` Item Packaging segment and HL7 v2 table numbers written
#     `HL7-0396`; the ncpdp copy carries pharmacy field references (`439-E4`), the
#     `NCPDP-SCRIPT`/`NCPDP-TELECOM` designations and a `SYNTH` removal grounded in that
#     repo's example ids. None of that is reachable here. What is carried across verbatim
#     because it is genuinely cross-repo: the prefix list, the paragraph-join second pass,
#     the doc-comment third pass, the string-literal fourth pass, the silent-green route
#     closures, and the NEGATIVE self-tests. What is re-derived for FHIR: the scan surface,
#     the standards-designation exclusions, and every self-test sample. What is REMOVED,
#     with the measurement, is the `slice` rule: see THE ONE RULE THIS COPY DROPS below.
#
#   * THE DETECTION RULES ultimately come from `cosyte/.github`
#     `scripts/release-notes.mjs` (its `CONTENT_RULES`), which is validated against every
#     published release body across the org. This file transcribes the prefix-keyed set to
#     PCRE. THE REASONING IS KEPT WITH THEM ON PURPOSE. Every one of the traps recorded
#     here shipped a public defect before it was caught, and a reader who has not hit them
#     will tidy the guard away as over-complication.
#
# ---------------------------------------------------------------------------
# THE FOUR TRAPS THAT BREAK A NAIVE DETECTOR. All four are why this file is not a
# one-line grep. Do not "simplify" past them.
#
#   (1) KEY ON KNOWN PROJECT PREFIXES, NEVER ON THE `WORD-N` SHAPE. THIS REPO IS DENSE
#       WITH THE COLLISION, because the token being stripped is the name of the standard
#       the package implements and of the version line it targets. `FHIR-P10` is one of
#       our items; `FHIR-R4`, `FHIR-R4B` and `FHIR-R5` are the version designations a
#       consumer came here to read about, and the neighbourhood is full of look-alikes
#       that a shape rule destroys: `HL7-V2`, `HL7-CDA`, `HL7-FHIR`, `US-Core`,
#       `SMART-on-FHIR`, the ICD-10-CM code `T78.40XA` and its range `P00-P96`, the LOINC
#       code `8480-6`, the invariant ids `ait-1` / `con-3` / `obs-6`, and the FHIR codes
#       `no-known-allergy`, `entered-in-error` and `vital-signs`. The cost of keying on
#       prefixes is that a NEW PROGRAMME MEANS ADDING ITS PREFIX to the list below, and
#       nothing will catch it until someone does. That is the cheaper of the two mistakes.
#
#   (2) DECAPITATION, which is a rule for the person REMEDIATING a hit, not for the
#       scanner. Stripping an identifier off the FRONT leaves the fragment behind:
#       "Phase 7 (thirteenth slice): builder emits X (CCDA-P7)" became "(thirteenth
#       slice): builder emits X" across 17 lines of ccda's published release notes, which
#       is worse than the text it replaced. Repair the head: drop a leading orphan
#       parenthetical, strip leading punctuation, recapitalise. Same mid-sentence: "(of
#       the R4 capability arc)" reads worse than no parenthetical at all.
#
#   (3) CASE SENSITIVITY. The identifier rule is case-SENSITIVE and the segment after the
#       hyphen must start uppercase or with a digit, which is what lets `FHIR-bridge`,
#       `FHIR-native`, `HL7-defined` and `docs-content/` through. Leading digits are fine
#       too: `8480-6` is a LOINC code and `4.0.1` is the R4 version, so nothing here keys
#       on a leading number.
#
#   (4) PHASE PATTERNS NEED A LETTER SUFFIX (`Phase 5b`) AND A LETTER-ONLY FORM
#       (`Phase W`): a digits-only pattern misses both. Ordinal `slice` and `wave` are
#       ours too ("thirteenth slice", "second wave"): "slice" is our word for a unit of
#       work and a reader does not have it. In prose it should read "change".
#
# ---------------------------------------------------------------------------
# THE ONE RULE THIS COPY DROPS, AND THE MEASUREMENT BEHIND IT.
#
# hl7 and ncpdp carry a fifth rule for `slice`, our internal word for a unit of work,
# keyed on the determiner forms ("this slice", "the final slice") and excluding the DICOM
# imaging nouns. IT IS NOT CARRIED HERE, AND THIS IS THE ONE PLACE THIS FILE DIVERGES
# FROM ITS SIBLINGS ON A RULE RATHER THAN ON DATA.
#
# The reason is trap (1) arriving through a rule instead of through the prefix list.
# `slice` is not our jargon in a FHIR package: it is the standard's own noun.
# `ElementDefinition.slicing`, `sliceName`, `slicing.discriminator` and `slicing.rules`
# are normative R4 vocabulary, this package implements profile slicing, and its doc
# comments have to be able to say "the slice name", "the slice's minimum cardinality",
# "the matched slice name" and "the slices a sliced element introduces".
#
# MEASURED on the tree this gate landed on, with the sibling rule enabled: 41 matches
# across the public surface and `src/` doc comments. ONE was ours ("deliberately out of
# this slice", in `src/profiles/starter-kit.ts`, removed by hand alongside this gate).
# The other 40 were the standard's vocabulary or ordinary English ("no slice of the
# offending input, because that slice could be PHI", the value-free-diagnostics prose).
# A 1-in-41 rule does not raise the floor; it tells a remediator to rewrite reference
# material, which is the exact defect this whole file exists to prevent.
#
# NARROWING WAS TRIED ON PAPER AND IS NOT AVAILABLE. The sibling rule excludes the noun
# that FOLLOWS `slice`; the FHIR false positives are "the slice name", "the slice's ...",
# "the slice of a FHIR `ElementDefinition`", "that slice could be PHI". Excluding those
# leaves a rule that matches nothing, which is cutting it with extra steps. So it is CUT,
# per the item's own instruction: where a rule cannot be guarded, cut it rather than
# harden it.
#
# WHAT THIS COSTS, stated rather than discovered: "this slice" and "the final slice" in
# OUR sense now pass green here. That is a real hole and it is the reviewer's catch. The
# ORDINAL arm of the phase rule (`thirteenth slice`, `second wave`) is unaffected and
# still fires, because an ordinal never precedes a FHIR slice. DO NOT "resync with hl7"
# by pasting the rule back: re-measure first, and if the count has not changed, the
# reasoning has not either.
#
# ---------------------------------------------------------------------------
# SCAN SURFACE. This gate scans the PUBLIC surface only, which is the one substantive
# difference from check-no-emdash (that one scans every tracked file, because the em-dash
# ban has no inside/outside distinction: it covers commit messages too). Here the same
# identifier is REQUIRED on the inside and BANNED on the outside, so scanning every
# tracked file would red on CHANGELOG.md, `.changeset/`, CLAUDE.md and source comments,
# where the convention explicitly says the identifiers belong. A gate that reds on
# correct content is a gate someone deletes.
#
# In scope:
#   * README.md            the repo's front page, and shipped inside the npm tarball
#   * LICENSE              shipped inside the npm tarball
#   * docs-content/        every tracked file, including sidebars.json: this is the
#                          content published to docs.cosyte.com
#   * package.json         the npm-visible metadata ONLY (`description`, `keywords`),
#                          extracted and scanned as text. Named explicitly by the
#                          convention. The rest of package.json is not public prose, and
#                          scanning it whole would red on a future dependency or script
#                          name that happens to match.
#
# Out of scope, each for a stated reason:
#   * CHANGELOG.md         SHIPS INSIDE THE NPM TARBALL, so it is genuinely public surface,
#                          and it currently carries internal identifiers across its
#                          history. It is excluded anyway because the convention names
#                          CHANGELOG.md as one of the places identifiers BELONG, and
#                          because rewriting a released changelog's history destroys the
#                          traceability the same convention preserves. That is a live
#                          contradiction in the standard, it is ECOSYSTEM-WIDE (every
#                          parser has it), hl7 and ncpdp exclude it on exactly this
#                          reasoning, and it is not for one repo to settle alone. Recorded
#                          here, and queued on PUBLIC-SURFACE-HYGIENE in the meta-repo,
#                          rather than silently decided in either direction.
#   * documentation/decisions/
#                          THIS REPO'S OWN ARCHITECTURE DECISION RECORDS. Not in
#                          package.json `files`, not published to docs.cosyte.com (only
#                          `docs-content/` is), and an ADR is BY DEFINITION a record of how
#                          the artifact came to exist, which is the exact category the
#                          convention names as internal. Rule 3 bans ADR numbers on the
#                          public surface; scanning the ADR itself would red on a file
#                          whose whole job is to carry one.
#                          NOTE THE COLLISION, because it is this repo's alone: the path
#                          `documentation/decisions/` is ALSO the meta-repo path rule 4
#                          bans. That is not a bug. A README link to
#                          `documentation/decisions/0002-...md` is a dead link inside the
#                          npm tarball (README.md is in `files`, `documentation/` is not),
#                          so it should red either way; rule 4 is simply the arm that
#                          catches it here, where ncpdp needed `/` added to rule 3.
#   * phi-scan-overrides.md
#                          the audit log for fixture-level PHI-scan bypasses. Internal
#                          compliance bookkeeping, not consumer documentation.
#   * CONTRIBUTING.md      contributor-facing, not consumer-facing: not in `files`, not
#                          published to docs.cosyte.com, and its whole subject is our
#                          process. Excluded on the same ground as CLAUDE.md.
#   * CLAUDE.md, .github/, .changeset/, scripts/, test/
#                          internal by definition, or code rather than prose.
#   * src/ DOC COMMENTS    IN SCOPE, as a THIRD PASS at the bottom of this file, with its
#                          own rule array (SRC_RULE_PATTERN), its own self-tests, and its
#                          own extractor. `src/` JSDoc IS public: it is compiled into
#                          `dist/index.d.ts` and `dist/index.d.cts`, `dist` is the first
#                          entry in package.json's `files`, and it is what a consumer's
#                          editor shows on hover.
#   * src/ `//` COMMENTS   OUT of scope, because THE CONVENTION SAYS SO: it names source
#                          comments as one of the places identifiers BELONG. That is the
#                          whole reason, and it is deliberately the only one.
#                          DO NOT REASON ABOUT THIS BOUNDARY FROM WHAT REACHES `dist/`,
#                          AND DO NOT WRITE A REACH CLAIM BACK IN HERE TO REPLACE THE ONE
#                          THAT WAS CUT. Two drafts of the ncpdp copy tried and both were
#                          false, each caught by a refuter; the third is the one that
#                          shipped here, and it was false too. It said everything in `src/`
#                          is in the tarball. `pnpm build && npm pack` refutes that by
#                          example: the module docblock of `src/codec/index.ts` is in no
#                          file of the packed tarball, neither raw nor in a sourcemap's
#                          decoded `sourcesContent`. So the ground is DELETED rather than
#                          reworded a fourth time, and no replacement set is named.
#                          THE DIRECTION IS COUNTER-INTUITIVE, WHICH IS THE WHOLE REASON
#                          THIS PARAGRAPH IS STILL HERE: a wrong "this ships" costs a
#                          needless sweep, but a wrong "this does not ship" licenses
#                          writing bookkeeping into a file that does, and a published
#                          version is permanent. `src/terminology/service.ts` is the trap
#                          that proved it: it is in NEITHER sourcemap, and its docblock is
#                          in BOTH `.d.ts` files. So derive reach from a real `npm pack`,
#                          never from a grep over `src/`, and fold newlines and comment
#                          markers before matching, or a doc comment that wraps reads as
#                          absent. Re-derive it; do not trust this line for it.
#                          WHAT THIS GATE'S LINE IS: not what reaches the consumer's disk
#                          but WHAT THE CONSUMER IS SHOWN, i.e. JSDoc their editor renders
#                          on hover, and message text their log prints. Those are passes
#                          three and four. A comment they would have to go digging for is
#                          not.
#   * dist/                NOT SCANNED, and this is the gate's stated ceiling rather than a
#                          hole that has been closed. `dist/` is untracked build output:
#                          neither this script nor CI can read it without building first,
#                          and this script does not build. What the third pass gates is
#                          dist's SOURCE, which is a proxy that holds only because the dts
#                          build copies doc text verbatim. A build that began transforming
#                          comments would decouple the two silently.
#
# ---------------------------------------------------------------------------
# NO STDIN / PR-TEXT MODE, deliberately, and this is the other difference from
# check-no-emdash. That gate scans the PR title, body and commit messages because the
# brand rule names commit messages explicitly. This rule says the opposite: identifiers
# BELONG in the commit, the PR and the changeset. A PR-text half here would red on correct
# work. If you are looking for the half that keeps identifiers out of a published RELEASE
# BODY, it exists and it is not here: `cosyte/.github` `scripts/release-notes.mjs assert`
# runs inside the shared release pipeline and refuses to publish a violating body.
#
# ---------------------------------------------------------------------------
# DISCLOSED RESIDUALS. Known and stated rather than discovered later.
#
#   (i)    THE PREFIX LIST IS DUPLICATED across every copy of this gate and against
#          release-notes.mjs, because a bash gate inside a parser repo cannot import from
#          `cosyte/.github` and vendoring a 900-line Node script into 11 repos is worse. So
#          the copies can drift: a prefix added there does not appear here. The cross-repo
#          fix is one shared list (published as data by `cosyte/.github`, or as a
#          `@cosyte/*` package), and it is ONE fix across every copy rather than one per
#          repo. Do not patch this copy alone; a divergent variant is worse than a known
#          shared limit. This copy carries hl7's list unchanged, INCLUDING `SYNTH`, which
#          ncpdp removed for a reason that is specific to that repo (its runnable examples
#          use `SYNTH-MSG-0001` ids). Measured here: `SYNTH-` appears zero times on this
#          repo's public surface and in its `src/`, so keeping it costs nothing.
#   (ii)   THE ITEM-IDENTIFIER FORM THIS REPO ACTUALLY WRITES IS NOT FULLY CAUGHT, and
#          this is the largest known hole. Items here are written `FHIR-P10b` and, in
#          running prose, bare: `P9`, `P10`, `P10b`, `P11`. Rule 1 requires the segment
#          after the hyphen to be uppercase-or-digit to its end, so `FHIR-P10` matches but
#          `FHIR-P10b` does NOT (the trailing lowercase `b` breaks the word boundary), and
#          a bare `P10b` has no prefix to key on at all. BOTH ARE LEFT UNCAUGHT ON PURPOSE.
#          Closing the first needs a lowercase-suffix arm and closing the second needs a
#          single-letter prefix, and `P\d+` is exactly the shape that, in an earlier hl7
#          draft, deleted the ICD-10-CM codes out of "Map ICD-10 P07, P22 and P29 to
#          SNOMED CT" and truncated the code range "P00-P96". This package's README
#          carries ICD-10-CM codes today. A divergent widening in one copy is worse than a
#          limit every copy shares, so the widening belongs in the one shared list, not
#          here. Live instances were removed BY HAND alongside this gate (a `(P10b)` in
#          README.md among them); a future one will not red.
#   (iii)  The scan reads file CONTENTS, never file NAMES. A tracked path that itself
#          carries an identifier passes green. Shared with check-no-emdash.
#   (iv)   An identifier inside a fenced code block, a URL, or a link target is treated
#          exactly like prose. That is deliberate (a reader sees it either way), but it
#          means a legitimate quotation of an internal path in an example would have to be
#          rewritten rather than escaped.
#   (v)    This gate does not check the em dash. `scripts/check-no-emdash.sh` owns that
#          rule and scans a wider surface; duplicating it here would put the same red in
#          two places with two wordings.
#   (vi)   IT CATCHES IDENTIFIERS, NOT PROSE ABOUT OUR PROCESS. The founder's rule bans
#          both. On this tree the by-hand half was the larger half of the README: a status
#          line reading "Phases 1-9 have landed", section headings numbered by phase, and
#          sentences describing which half of which unit of work shipped a feature. No
#          pattern would have found the worst of them: they are ordinary English sentences
#          whose only fault is that they describe how the artifact came to exist. THE
#          BY-HAND HALF IS NOT CLAIMED COMPLETE, and should not be.
#   (vii)  `phase` AT THE END OF A CLAUSE IS NOT CAUGHT. Measured rather than assumed:
#          rule 2 DOES catch the running-prose forms, because it keys on `phase` plus a
#          following word, so `phase models`, `phase recognizes` and `phase opens` all red.
#          What escapes is `phase` with nothing after it but punctuation or a line end,
#          which is the shape of "the elements decoded this phase." and of a markdown
#          heading ending in the word. A rule for the determiner form was written, measured
#          and REMOVED in the hl7 copy because of what it cost in clinical phrasing ("the
#          phase of the clinical study", "the phase of illness"), and that verdict is
#          inherited rather than re-litigated. It is a reviewer's catch. The
#          paragraph-joined second pass narrows it: `phase` at a line end that is followed
#          by more prose in the same paragraph DOES red, because the join makes the next
#          word adjacent.
#   (viii) `D-NN`-STYLE SINGLE-LETTER INTERNAL LABELS ARE NOT CAUGHT, deliberately, for
#          the same reason as residual (ii): a single-letter prefix is the `WORD-N` trap
#          with a sharp edge in a clinical package. Legacy SNOMED RT codes are axis-
#          prefixed in exactly that shape (`D-13000`, `T-32000`, `M-80003`). This repo does
#          not use `D-NN` labels today; the non-catch is stated so a future one is a known
#          gap rather than a surprise.
#   (ix)   A VIOLATION SPLIT BY INLINE MARKUP REJOINS IN NEITHER PASS. `phase **8**` and
#          `phase [8](...)` put markup between the two tokens, and neither the line scan nor
#          the paragraph join strips it, so a multi-token rule does not match. Closing it
#          needs a markdown renderer, not a bigger regex. REACHABLE HERE: this repo's
#          README bolds its emphasis heavily.
#   (x)    THE THIRD PASS CANNOT SEE `dist/`, only its source. Stated at length in the pass
#          itself and in SCAN SURFACE above, and repeated here because it is the single most
#          important thing to know about what this gate does and does not prove.
#   (xi)   A DOC COMMENT THAT DOES NOT OPEN ITS OWN LINE IS INVISIBLE TO THE THIRD PASS. The
#          extractor enters a block only on `^[[:space:]]*/**`, so `const x = 1; /** ... */`
#          is scanned by neither pass 3 (never entered) nor pass 4 (not a string literal).
#          It is not fixed because entering mid-line means tracking whether the `/**` is
#          itself inside a string or a regex, which is a tokenizer. Prettier puts a doc
#          comment on its own line and `format:check` runs ahead of this gate on the ladder,
#          so the construct does not occur in this repo today.
#   (xii)  MEASURE ON THE REFLOWED TEXT, NOT LINE BY LINE, when you sweep by hand. hl7's
#          `Plan N` sweep was done with a line scan and reported itself complete while one
#          instance survived where `Plan` ended a line and `04` began the next; it shipped
#          into `dist/`. That is the same wrap blindness this gate's second and third passes
#          exist for, arriving in the REMEDIATION rather than in the detection. Also: QUOTE
#          A COUNT WITH THE TREE IT WAS TAKEN ON, OR NOT AT ALL.
#
# Run it locally with `pnpm check:no-internal-refs`.
set -euo pipefail

# LOCALE PIN, load-bearing, and inherited from check-no-emdash for the same measured
# reason: `grep -P` compiles PCRE in UTF-8 mode only when the locale says so. Under
# LC_CTYPE=POSIX (a bare container, cron, `sh -c`) GNU grep's handling of non-ASCII in the
# input and of `\w` in the pattern changes, and the docs scanned here contain non-ASCII
# (the en dash in "Phases 6-7", `§`, curly quotes). A gate whose matching depends on an
# inherited environment is a gate that reports green somewhere and red elsewhere.
export LC_ALL=C.UTF-8

# ---------------------------------------------------------------------------
# THE BANNED SET, transcribed from release-notes.mjs CONTENT_RULES
# ---------------------------------------------------------------------------

# Known project and programme prefixes. THE KEYING IS ON THESE, NEVER ON THE `WORD-N`
# SHAPE: see trap (1) above. Order matters only for readability. Kept in the same order as
# the source list so a diff between the copies is legible.
#
# ONE PREFIX IS DELIBERATELY ABSENT and is present in the source list: `PKG`, absent for
# hl7's reason rather than one of ours (`PKG-1` and `PKG-4` are HL7 v2 Chapter 17 Item
# Packaging segment-field references). Kept absent here so the copies stay diffable, and
# because it has never been minted as an item anywhere.
#
# `SYNTH` IS PRESENT HERE AND ABSENT FROM ncpdp's COPY, and that is deliberate rather than
# a stale paste. ncpdp removed it because every runnable example in that package uses
# `SYNTH-MSG-0001`-style synthetic message ids, which the rule would red on. Measured on
# this tree: `SYNTH-` appears zero times on this repo's public surface and in `src/`, so
# keeping hl7's list unchanged costs nothing and keeps this copy diffable against the
# reference. Re-measure before removing it.
PROJECT_PREFIXES='PARSERS-PUBLIC|DOCS-CONTENT|KNOWLEDGEBASE|TERMINOLOGY|PATHWAYS|TRANSFORM|WEBSITE|STAGING|SUPPLY|NCPDP|ASSETS|EMDASH|README|CONFIG|DICOM|SYNTH|DEID|CCDA|ASTM|MLLP|FHIR|CREW|DOCS|PERF|SYNC|VERSION|PUBLIC|HL7|X12|IAC|CLI|KB|PW|PUB|CI|REAL|TERM|WF|VERIFY'

# STANDARDS DESIGNATIONS THAT COLLIDE WITH THE PREFIX LIST, excluded explicitly. Nine of
# the prefixes above (`NCPDP`, `HL7`, `X12`, `DICOM`, `FHIR`, `CCDA`, `ASTM`, `MLLP`,
# `TERM`) are the names of standards this ecosystem parses as well as the names of our
# projects. `FHIR` IS THE ONE THAT MATTERS HERE: this is the package whose own standard is
# named by the token the identifier rule strips, so `FHIR-R4`, `FHIR-R4B` and `FHIR-R5`
# have to survive while `FHIR-P10` does not. There is no shape that separates them, so the
# separation is an explicit, reviewable exclusion list, which is the same bargain as keying
# on prefixes in the first place: it must be extended by hand, and that is the cheaper
# mistake. Every entry here is asserted in this rule's NEGATIVE sample.
#
# `FHIR-R\d[A-Z]?` IS THE ARM THAT DOES THE WORK, and it is inherited unchanged: it covers
# `FHIR-R4`, `FHIR-R4B` and `FHIR-R5`. `FHIR-DSTU2` and `FHIR-STU3` are NOT exempted, and
# that is measured rather than assumed: this repo writes those version names bare (`DSTU2`,
# `STU3`, R4-first per its own decision record), and `FHIR-DSTU2` appears zero times across
# the public surface and `src/`. Adding an arm for a spelling the repo does not use would
# widen the exemption for nothing. If that spelling ever lands, add it here with the
# NEGATIVE sample updated in the same change.
#
# HL7's `HL7-\d{3,4}` ARM IS DELIBERATELY DROPPED, as ncpdp dropped it. In the hl7 copy it
# exempts HL7 v2 table numbers (Table 0396, Table 0003) written with a hyphen, which are
# reference material an HL7 v2 parser's docs cannot do without. A FHIR package has no such
# table convention: measured on this tree, `HL7-` followed by digits appears zero times on
# the public surface and in `src/` doc comments (`HL7-V2` and the `http://hl7.org/fhir`
# URIs are the only `HL7` forms here, and the first is exempted by name). Carrying the arm
# would exempt a shape this repo never writes and would weaken the rule against a real
# `HL7-<digits>` item identifier leaking in from a sibling repo's release note. That is
# porting the FILE rather than the SHAPE.
STANDARDS_DESIGNATION='FHIR-R\d[A-Z]?|HL7-(?:V2|V3|CDA|FHIR|OMG)|NCPDP-(?:SCRIPT|TELECOM|D\.\d)|DICOM-(?:SR|RT|SEG|DIR|PS\d)|X12-\d{3}[A-Z]?|X12-\d{6}|CCDA-R\d(?:\.\d)?|ASTM-E\d+'

# Rule 1: internal project identifier. CASE SENSITIVE, and the segment after the hyphen
# must start with an uppercase letter or a digit, which is what lets `FHIR-bridge`,
# `NCPDP-copyrighted` and `HL7-defined` through (trap 3). The second alternative is our
# internal priority label, and it matches its own trailing word rather than looking ahead
# for one: an earlier version keyed on `P\d+` followed by end-of-string or a comma, which
# is the shape rule this file exists to avoid. It deleted the ICD-10-CM code in "Map
# ICD-10 P07, P22 and P29 to SNOMED CT" and truncated the code range "P00-P96". Corrupting
# a diagnosis code to remove an internal label is not a trade worth making.
#
# The collisions this rule has to survive in a FHIR package are not hypothetical, and the
# ICD-10-CM one above is LIVE ON THIS REPO'S README (`T78.40XA`, and the `P00-P96` range in
# the sibling copies' own samples). Add the LOINC codes written `8480-6`, the R4 invariant
# ids `ait-1` / `con-3` / `obs-6`, the hyphenated FHIR codes `no-known-allergy`,
# `entered-in-error`, `do-not-perform` and `vital-signs`, and the version designations
# `FHIR-R4` / `HL7-V2` / `US-Core`, and a shape rule destroys the reference material it was
# added to protect. Nothing here keys on a leading number, and the uppercase requirement
# after the hyphen is what keeps every lowercase FHIR code out. All are asserted in
# NEGATIVE[0] so a later "simplification" cannot quietly drop them.
#
# WHAT THIS RULE DOES NOT CATCH IN THIS REPO is stated at residual (ii) and is the largest
# known hole in the file: `FHIR-P10b` (a trailing lowercase suffix breaks the word
# boundary) and the bare `P9` / `P10b` forms this repo writes in running prose. Both need a
# widening that trap (1) makes unsafe, and the widening belongs in the one shared list
# rather than in a divergent copy.
RULE_NAME[0]='internal project identifier'
RULE_PATTERN[0]='\b(?!(?:'"$STANDARDS_DESIGNATION"')\b)(?:'"$PROJECT_PREFIXES"')(?:-[A-Z0-9][A-Z0-9.]*)+\b|\bP\d+ (?:safety|documentation)\b'

# Rule 2: phase and wave language. CASE INSENSITIVE via the inline `(?i)`, because the
# rules do not share a case policy and one `grep -i` for all of them would break trap (3).
# `Phase 5b` and `Phase W` are both covered (trap 4). The negative lookahead keeps ordinary
# English off the list, so "in phase with the source system" and "out of phase" survive.
#
# THE CLINICAL LOOKBEHINDS ARE KEPT AND THE HL7 FIELD-NAME LOOKAHEAD IS DROPPED, and the
# split is deliberate rather than a partial copy.
#
#   KEPT: `study|clinical|trial` and the ordinary clinical senses
#   (`acute|chronic|luteal|follicular|liquid|gas`), plus the clinical-trial roman numerals
#   when followed by trial vocabulary. A FHIR package models clinical data directly:
#   `ResearchStudy.phase` is an R4 element, an acute-phase reactant is an ordinary
#   `Observation`, hormone therapy is dosed against the luteal and follicular phases, and a
#   `Specimen` genuinely has a liquid phase. A bare `Phase III` is still flagged, because it
#   is genuinely ambiguous with an internal single-letter item and a loud red on a rare line
#   beats a silent hole.
#
#   DROPPED: `identifier|start|end|evaluability` from the lookahead. In hl7 those exempt
#   the field names of the Chapter 7 `CSP` Clinical Study Phase segment (`CSP-1 Study Phase
#   Identifier`, `CSP-2 Study Phase Start Date/Time`, ...), which is HL7 v2 vocabulary with
#   no FHIR counterpart: `ResearchStudy.phase` is a single `CodeableConcept`, not a
#   segment of named subfields, and measured on this tree those four phrases appear zero
#   times. Carrying them would exempt a construction this repo cannot write while widening
#   the hole in residual (vii). `number` is dropped with them for the same reason.
#
# `phase[ -]` rather than `phase ` is kept: `Phase-L` was live in hl7's docs and slipped a
# space-only rule, and this repo's `src/` doc comments write `Phase-2`, `Phase-6`, `Phase-7`
# and `Phase-9` with a hyphen throughout, which a space-only rule walks straight past.
#
# `phases?` RATHER THAN `phase` IS AN NCPDP ADDITION, carried here because this repo needs
# it too. hl7's copy matches the singular only, and this README's status line read
# "Phases 1-9 have landed" while docs-content carried "phase-by-phase". Widening the stem
# rather than bolting on a second alternative keeps the clinical lookbehinds and the
# ordinary-English lookahead applied to the plural too, so "the phases of the trial" and
# "clinical phases" still survive; a separate `phases \d+` arm would have had neither
# guard. Asserted in both directions: POSITIVE[1] carries "Phases 6 and 7", NEGATIVE[1]
# carries the clinical plural.
ORDINAL='(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|twenty-first|twenty-second|twenty-third|twenty-fourth|\d+(?:st|nd|rd|th))'
PHASE_NOT_CLINICAL='(?<!study )(?<!clinical )(?<!trial )(?<!acute )(?<!chronic )(?<!luteal )(?<!follicular )(?<!liquid )(?<!gas )'
PHASE_NOT_ENGLISH='(?!of\b|with\b|in\b|out\b|the\b|and\b|is\b|for\b|to\b|(?:I{1,3}|IV)\s+(?:trial|stud|clinical|oncolog))'
RULE_NAME[1]='phase or wave language'
RULE_PATTERN[1]='(?i)\b(?:roadmap phases?\b[ ]?[A-Za-z0-9]*|'"$PHASE_NOT_CLINICAL"'phases?[ -]'"$PHASE_NOT_ENGLISH"'[A-Za-z0-9]+[a-z]?\b|wave \d+\b|the \w+ and final phase\b|documentation residual\b|'"$ORDINAL"' (?:slice|wave)\b)'

# Rule 3: ADR references. An ADR number is a pointer into a decision record the reader did
# not come here for. This repo HAS four of its own, in `documentation/decisions/`, which is
# exactly why the rule is kept rather than dropped as hl7-shaped: the temptation to cite
# them by number is live, and it was live in `src/` doc comments (ADR 0001, 0002, 0003 and
# 0018 were cited across the JSDoc a consumer's editor renders). Cite what the decision
# WAS, not the number it has.
#
# `/` IS KEPT IN THE SEPARATOR CLASS, inherited from ncpdp's copy, even though THIS repo
# never writes an ADR path as `adr/0001`: it files them under `documentation/decisions/`,
# which rule 4 catches instead. The arm is carried unchanged so the copies stay diffable
# and so a page copied in from a sibling brings its citation into a rule that can see it.
# It costs nothing: `adr/0001` has no legitimate reading in a FHIR parser's docs, and the
# NEGATIVE sample keeps `0015` alone and a bare `ADR` off the rule.
#
# THE `\d{3,4}` FLOOR IS INHERITED AND IS A KNOWN GAP: `ADR 7` and `ADR-12` are not
# caught. Left as hl7 has it rather than fixed here, because every ADR in this ecosystem is
# written four-digit and lowering the floor to `\d{1,4}` would start matching ordinary
# two-digit numbers after any three letters that happen to spell `adr`.
RULE_NAME[2]='ADR reference'
RULE_PATTERN[2]='(?i)\bADR[ \-/]?\d{3,4}\b'

# RULE 4 IN THE SIBLING COPIES IS `slice`, AND IT IS NOT CARRIED HERE. The measurement and
# the reasoning are at THE ONE RULE THIS COPY DROPS in the header: 41 matches on this tree
# with the sibling rule enabled, exactly ONE of them ours. `slice` is R4 vocabulary in this
# package (`ElementDefinition.slicing`, `sliceName`), so the rule tells a remediator to
# rewrite reference material. The ORDINAL arm of rule 2 still catches "thirteenth slice".
# Do not paste the rule back without re-measuring; if the count has not changed, neither
# has the reasoning.
#
# Rule 4: internal repo paths. A docs page carries citations, and a reader who installs
# @cosyte/fhir has no meta-repo and no such file. Keyed on the known meta-repo paths, not
# on a `dir/file.md` shape, for exactly the reason trap (1) gives: this package's own pages
# legitimately cite `docs-content/intro.md`, which a shape rule would take with it.
#
# IN THIS REPO IT IS ALSO THE ADR-PATH ARM, and that is a genuine double duty rather than a
# coincidence to tidy away. `documentation/decisions/` is BOTH the meta-repo path this rule
# was written for AND this repo's own ADR directory. A README link to
# `documentation/decisions/0002-...md` is a dead link inside the npm tarball, because
# README.md is in package.json `files` and `documentation/` is not, so it must red either
# way. Four such links were live in the README's decision table when this gate landed.
RULE_NAME[3]='internal repo path'
RULE_PATTERN[3]='\boperations/(?:BACKLOG\.md|roadmaps/|plans/)|\bdocumentation/(?:decisions/|ecosystem-map\.md|conventions\.md)|\bBACKLOG\.md\b'

# Rule 5: internal traceability markers. Bracketed spec-trace tags that key into a roadmap
# traceability table, and "Open-question #12" pointers into a decision log the reader
# cannot open. Zero instances measured on this tree (the `[S-` shape does not occur here); the rule is carried because the
# convention that produces them is shared across the parsers and a page copied from a
# sibling would bring them along. Both are DELIMITER-ANCHORED rather than shape-keyed,
# which is the only reason they are safe: the tag rule requires a literal `[S-` opening
# bracket and at least two characters after it, so a documented character range like
# `[S-Z]` does not match, and neither does a value set written `[SNOMED]`.
RULE_NAME[4]='internal traceability marker'
RULE_PATTERN[4]='\[S-[A-Z][A-Z0-9]+(?:-[A-Z0-9]+)*\]|(?i:\bopen[- ]question #?\d+\b)'

RULE_COUNT=5

# ---------------------------------------------------------------------------
# THE `src/` DOC-COMMENT RULE SET, deliberately a SEPARATE ARRAY
# ---------------------------------------------------------------------------
#
# WHY A SECOND SURFACE EXISTS AT ALL. The block above scans markdown a reader browses.
# This one scans the JSDoc a consumer's EDITOR renders: `src/` doc comments are compiled
# into `dist/index.d.ts` and `dist/index.d.cts` by tsup, `dist` is the first entry in
# package.json's `files`, and every `npm i @cosyte/fhir` receives them. It is BY FAR the
# LARGER of the two surfaces in this repo, not an afterthought: measured on the base commit
# of the change that added this pass, 58 tracked `src/**/*.ts` files carried 255 matching
# doc-comment lines against 23 on the whole public markdown surface, an 11:1 split. Every
# module header opened with the unit of work that built it ("Bundles, references, and Bulk
# NDJSON streaming (Phase 9)"), which tells a consumer nothing except that we build in
# phases.
#
# WHY A SEPARATE ARRAY RATHER THAN REUSING RULE_PATTERN. Code comments are not markdown.
# The two surfaces have different collision profiles (TypeScript prose says `.slice()` and
# names R4 elements inline; markdown says "the thirteenth slice"), different wrap
# shapes, and different self-test material. Sharing one array would mean a fix for one
# surface silently retunes the other, and the negative self-test that caught it would be in
# the wrong file's language. They START identical. They are ALLOWED to diverge, and when
# they do, each side's NEGATIVE sample is what stops the divergence from being a widening.
#
# WHAT IS SCANNED, precisely: only text inside `/** ... */` blocks. NOT `//` line comments
# and NOT `/* */` block comments, and that boundary is the whole point rather than a
# convenience. `/** */` is what the dts build carries into `dist`; `//` is not. The
# convention names source comments as a place identifiers BELONG. So the line this draws is
# exactly the founder's line: what a CONSUMER receives is public and is swept; what only a
# maintainer reads stays internal.
#
# REMOVING A DOC COMMENT TO SATISFY THIS PASS IS A REGRESSION, NOT A FIX. JSDoc with an
# `@example` on every public export is a hard guardrail in CLAUDE.md and the JSDoc lint
# rule is an error, but neither lint nor coverage notices prose deleted from the middle of
# a block. Rewrite the sentence to say what the software does.
SRC_RULE_NAME[0]="${RULE_NAME[0]}"; SRC_RULE_PATTERN[0]="${RULE_PATTERN[0]}"
SRC_RULE_NAME[1]="${RULE_NAME[1]}"; SRC_RULE_PATTERN[1]="${RULE_PATTERN[1]}"
SRC_RULE_NAME[2]="${RULE_NAME[2]}"; SRC_RULE_PATTERN[2]="${RULE_PATTERN[2]}"
SRC_RULE_NAME[3]="${RULE_NAME[3]}"; SRC_RULE_PATTERN[3]="${RULE_PATTERN[3]}"
SRC_RULE_NAME[4]="${RULE_NAME[4]}"; SRC_RULE_PATTERN[4]="${RULE_PATTERN[4]}"
SRC_RULE_COUNT=5

# ---------------------------------------------------------------------------
# THE `src/` STRING-LITERAL RULE SET: the fourth pass, and the one hl7 does not have
# ---------------------------------------------------------------------------
#
# WHY IT EXISTS, AND WHY hl7's COPY DOES NOT HAVE IT. A parser's most widely read text is
# not its README and not its JSDoc: it is its diagnostic messages. Every issue this library
# raises can surface as text a consumer prints to a log, shows in a UI, or pastes into a
# support ticket. Those strings are neither markdown nor doc comments, so the three passes
# above walk straight past them. In ncpdp, where this pass was first written, SIX runtime
# warning messages were carrying "this phase" into a consumer's log when it landed.
#
# MEASURED ON THIS TREE, and the honest answer is different from ncpdp's: ZERO of the
# 1,729 double-quoted and backtick literals in the 58 tracked `src/` files matched any of
# the five rules, on the base commit AND on the remediated tree. This package's diagnostics
# are value-free by contract (an `IssueCode` constant plus a FHIRPath expression, never
# prose about a value), so there is very little message text here to contaminate in the
# first place. That measurement is the reason the pass is carried rather than a reason to
# drop it: a surface with no gate on it regresses silently, and the contract that keeps it
# clean is a convention, not a compiler rule. It also means the pass has NO positive
# finding on this repo to point at, so do not read a green fourth pass as evidence the
# extractor works: the refusal on an empty extraction below is what proves that.
#
# THE FALSE-POSITIVE RISK WAS MEASURED BEFORE THE PASS WAS KEPT, because a rule over code
# strings is the obvious place for one. Zero matches across all 1,729 literals: the
# `UPPER_SNAKE` issue-code constants (underscored, so rule 1's hyphen requirement never
# fires), the relative import specifiers, the `http://hl7.org/fhir` system URIs, the FHIR
# codes (`no-known-allergy`, `vital-signs`, lowercase, so rule 1's uppercase requirement
# never fires) and the UCUM unit strings all pass cleanly. The rules are therefore reused
# whole rather than trimmed: a narrowed copy would have no measurement behind it.
#
# WHAT IS SCANNED, precisely: double-quoted and backtick literals on lines that are NOT
# whole-line comments. Three boundaries, each deliberate:
#   * WHOLE-LINE COMMENTS ARE SKIPPED (`//`, `/*`, `/**`, and a continuation ` *`). Pass
#     three owns doc comments, and `//` comments are deliberately out of scope for the
#     whole gate: the convention names source comments as a place identifiers BELONG.
#     Without this skip, a `//` comment that happens to contain a backticked
#     symbol would be scanned as a string and the stated boundary would quietly move.
#   * A TRAILING COMMENT ON A CODE LINE IS STILL SCANNED. Accepted rather than solved:
#     splitting a trailing comment off needs a tokenizer, and the failure mode is an
#     over-report on a line a maintainer can read in one second.
#   * SINGLE-QUOTED LITERALS ARE NOT SCANNED. Prettier (`@cosyte/prettier-config`) emits
#     double quotes, `format:check` runs ahead of this gate on the verify ladder, and
#     tracked `src/` contains no single-quoted string. Including `'` would instead capture
#     comment prose between two apostrophes, which would drag `//` comments into scope
#     through the back door.
#   * A MULTI-LINE TEMPLATE LITERAL IS SCANNED PER LINE, so a violation split across its
#     line breaks is missed. Under-reports rather than over-reports. There is no reflow
#     pass here because a reflow would have to model template continuation, and the fix
#     for a missed one is the same as for any residual: the reviewer.
STR_RULE_NAME[0]="${RULE_NAME[0]}"; STR_RULE_PATTERN[0]="${RULE_PATTERN[0]}"
STR_RULE_NAME[1]="${RULE_NAME[1]}"; STR_RULE_PATTERN[1]="${RULE_PATTERN[1]}"
STR_RULE_NAME[2]="${RULE_NAME[2]}"; STR_RULE_PATTERN[2]="${RULE_PATTERN[2]}"
STR_RULE_NAME[3]="${RULE_NAME[3]}"; STR_RULE_PATTERN[3]="${RULE_PATTERN[3]}"
STR_RULE_NAME[4]="${RULE_NAME[4]}"; STR_RULE_PATTERN[4]="${RULE_PATTERN[4]}"
STR_RULE_COUNT=5

# ---------------------------------------------------------------------------
# SELF-TESTS. A gate is believed only after it has shown it can still see.
# ---------------------------------------------------------------------------
#
# Two halves, and the second is the one that is unusual. POSITIVE samples prove each rule
# still matches what it bans (the check-no-emdash property: refuse to report a clean tree
# from a scanner that cannot see). NEGATIVE samples prove each rule still lets through the
# reference material it was most likely to destroy, which is trap (1) turned into an
# assertion: if someone "simplifies" the identifier rule to a `WORD-N` shape, the negative
# self-test reds here instead of silently deleting `FHIR-R4`, `US-Core` and the ICD-10-CM
# code `T78.40XA` from a FHIR parser's docs on the next sweep. Both halves run on every
# invocation, local and CI, and both refuse rather than warn.

self_test_fail() {
  echo "ERROR: check-no-internal-refs - SELF-TEST FAILED: $1" >&2
  echo "       The scanner is not behaving as specified, so no result from it can be" >&2
  echo "       believed. Refusing to report on the tree." >&2
  exit 1
}

# rule index -> text that MUST match. Every sample is written in THIS repo's own
# vocabulary, so a reader can tell what the rule is for without opening another package.
POSITIVE[0]='Item FHIR-P10 is done, FHIR-NPM-NAME is open, and CCDA-P7 with it'
POSITIVE[1]='Phase 5b closes it (Phase W, Phase-L and the thirteenth slice landed earlier, in wave 2), and Phases 6 and 7 preceded it'
POSITIVE[2]='Decided in ADR 0015, restated in ADR-0021, and recorded in docs/adr/0001-x.md'
POSITIVE[3]='Roadmap operations/roadmaps/fhir.md and documentation/decisions/0015-x.md'
POSITIVE[4]='Repeating [S-SIG], and Open-question #12 resolves the direction'

# rule index -> text that must NOT match. Every entry is real reference material from a
# FHIR, HL7 or terminology context, real example data from this package's own README, or
# ordinary English that collides with our jargon.
NEGATIVE[0]='FHIR-R4, FHIR-R4B and FHIR-R5, HL7-V2 and HL7-CDA and HL7-FHIR, HL7-defined tables, FHIR-bridge stability, FHIR-native shapes, docs-content/ layout, US-Core profiles, SMART-on-FHIR launch, ICD-10-CM T78.40XA and the range P00-P96, LOINC 8480-6, the invariants ait-1 and con-3 and obs-6, the negation codes no-known-allergy and entered-in-error and do-not-perform, the category vital-signs, mm[Hg] and mg, NCPDP-SCRIPT, DICOM-SR, X12-837P and X12-005010, CCDA-R2.1'
NEGATIVE[1]='A Phase III oncology trial and a Phase II study; the clinical phases of a drug programme; the acute phase reactant; luteal phase dosing and follicular phase dosing; the liquid phase of a specimen; the reader stays in phase with the source system and is out of phase'
NEGATIVE[2]='ADR is not a segment identifier, and 0015 alone is a value'
NEGATIVE[3]='FHIR operations are documented in the README, and documentation for the API is generated'
NEGATIVE[4]='A character range like [S-Z], a value set written [SNOMED], and open questions about the feed'

# TWO ARMS GET THEIR OWN ASSERTIONS, separate from the array loop, because the array
# samples cannot prove either one. An array sample carries several forms at once, so it
# still matches when one arm is removed: it proves the RULE works, not that the rule still
# has the ARM. Each of these is therefore asserted ALONE, with nothing else in the sample
# for the rule to match on.
#
# (a) RULE 3'S `/` SEPARATOR ARM. hl7's copy has `[ -]` and ncpdp widened it to `[ \-/]`
#     after a refuter found three live ADR citations written as PATHS that the narrower
#     class walked past. THIS repo does not write `adr/0001` (it files decision records
#     under `documentation/decisions/`, caught by rule 4 instead), so the arm is carried
#     for cross-copy fidelity rather than for a form measured here. Asserted anyway: a
#     "resync with hl7" that reverts RULE_PATTERN[2] should red loudly rather than silently
#     narrow a rule this repo shares with its siblings.
ADR_PATH_SAMPLE='Ratified in docs/adr/0001-decimal.md'
if ! printf '%s\n' "$ADR_PATH_SAMPLE" | grep -qP -e "${RULE_PATTERN[2]}"; then
  self_test_fail "rule 'ADR reference' no longer matches an ADR cited as a PATH ('docs/adr/0001-...'). This repo does not write that form, but its siblings do and a page copied in from one would carry it. Do not drop '/' from the separator class."
fi

# (b) RULE 4'S `documentation/decisions/` ARM, which in THIS repo does double duty: it is
#     both the meta-repo path the rule was written for and the directory this repo keeps
#     its own ADRs in. Four README links of exactly this shape were live when the gate
#     landed, and each was a dead link inside the npm tarball (README.md is in
#     package.json `files`; `documentation/` is not). Asserted alone so that trimming the
#     rule down to `operations/` reds here instead of quietly reopening it.
OWN_ADR_PATH_SAMPLE='See documentation/decisions/0002-fhirpath-dependency-posture.md'
if ! printf '%s\n' "$OWN_ADR_PATH_SAMPLE" | grep -qP -e "${RULE_PATTERN[3]}"; then
  self_test_fail "rule 'internal repo path' no longer matches 'documentation/decisions/...', which is BOTH the meta-repo ADR path and this repo's own. A README link of that shape is a dead link inside the npm tarball. Do not trim the rule to 'operations/' alone."
fi

i=0
while [ "$i" -lt "$RULE_COUNT" ]; do
  if ! printf '%s\n' "${POSITIVE[$i]}" | grep -qP -e "${RULE_PATTERN[$i]}"; then
    self_test_fail "rule '${RULE_NAME[$i]}' no longer matches its own positive sample."
  fi
  if printf '%s\n' "${NEGATIVE[$i]}" | grep -qP -e "${RULE_PATTERN[$i]}"; then
    hit=$(printf '%s\n' "${NEGATIVE[$i]}" | grep -oP -e "${RULE_PATTERN[$i]}" | head -1)
    self_test_fail "rule '${RULE_NAME[$i]}' now matches legitimate reference material (matched: '${hit}'). This is the WORD-N trap: it destroys the version designations and coded values a FHIR parser's docs exist to provide."
  fi
  i=$((i + 1))
done

# The `src/` set gets its OWN self-tests, in the language of the surface it guards. The
# NEGATIVE samples are built from material that is actually present in this package's
# source: the R4 version designations, the invariant ids (`ait-1`, `con-3`, `obs-6`), the
# hyphenated FHIR codes and the terminology system URIs, all of which appear in doc
# comments on exported symbols. If someone widens the `src` rules into the WORD-N shape,
# this reds instead of deleting `FHIR-R4` and `no-known-allergy` from an exported
# function's IntelliSense on the next sweep.
SRC_POSITIVE[0]='Item FHIR-P10 is done, FHIR-NPM-NAME is open, and CCDA-P7 with it'
SRC_POSITIVE[1]='Phase 5b closes it (Phase W, Phase-L and the thirteenth slice landed earlier, in wave 2), and Phases 6 and 7 preceded it'
SRC_POSITIVE[2]='Decided in ADR 0015, restated in ADR-0021, and recorded in docs/adr/0001-x.md'
SRC_POSITIVE[3]='Roadmap operations/roadmaps/fhir.md and documentation/decisions/0015-x.md'
SRC_POSITIVE[4]='Repeating [S-SIG], and Open-question #12 resolves the direction'

SRC_NEGATIVE[0]='FHIR-R4 and FHIR-R4B and FHIR-R5, HL7-V2 and HL7-CDA and HL7-FHIR, HL7-defined tables, FHIR-bridge stability, US-Core profiles, ICD-10-CM T78.40XA and the range P00-P96, LOINC 8480-6, the invariants ait-1 and con-3 and obs-6, the negation codes no-known-allergy and entered-in-error, the category vital-signs, mm[Hg], NCPDP-SCRIPT, DICOM-SR, X12-837P'
SRC_NEGATIVE[1]='A Phase III oncology trial and a Phase II study; the clinical phases of a drug programme; the acute phase reactant; luteal phase dosing; the liquid phase of a specimen; the reader stays in phase with the source system and is out of phase'
SRC_NEGATIVE[2]='ADR is not a segment identifier, and 0015 alone is a value'
SRC_NEGATIVE[3]='FHIR operations are documented in the README, and documentation for the API is generated'
SRC_NEGATIVE[4]='A character range like [S-Z], a value set written [SNOMED], and open questions about the feed'

# The STRING-LITERAL set gets its own samples too, in the language of a diagnostic message.
# The POSITIVE ones are what the rules DO catch in a message string. THEY ARE INVENTED,
# not lifted: this pass found nothing on this tree (see the measurement at STR_RULE_NAME),
# so there is no real hit to quote, and asserting a sample the rule cannot match is how a
# gate ends up believed for the wrong reason. The NEGATIVE ones ARE real strings from this
# package's source: the underscored issue-code constants (which must never look like an
# identifier), a relative import specifier, the system URIs and the coded values, so a
# widening that starts flagging correct diagnostics reds here instead of on the next pull
# request.
STR_POSITIVE[0]='FHIR-P10 shipped this reader'
STR_POSITIVE[1]='Added in Phase 9 and reworked in phase 10b'
STR_POSITIVE[2]='Behaviour fixed by ADR 0001, recorded in docs/adr/0001-x.md'
STR_POSITIVE[3]='See operations/roadmaps/fhir.md'
STR_POSITIVE[4]='Traced as [S-SIG]'

STR_NEGATIVE[0]='UNHANDLED_MODIFIER_EXTENSION and PROFILE_SLICE_UNCHECKED and VITAL_SIGN_UNIT_NONCONFORMANT and MAX_DEPTH_EXCEEDED, ./lexer.js and ../model/decimal.js, http://hl7.org/fhir and http://hl7.org/fhir/sid/icd-10-cm, FHIR-R4, HL7-V2, the invariants ait-1 and con-3 and obs-6, the codes no-known-allergy and entered-in-error and vital-signs, mm[Hg]'
STR_NEGATIVE[1]='Resource type is not modeled by this library; validated structurally only. A Phase III trial and the acute phase reactant are out of scope, and the reader stays in phase with the source system.'
STR_NEGATIVE[2]='ADR is not a segment identifier, and 0001 alone is a value'
STR_NEGATIVE[3]='FHIR operations are documented in the README, and documentation for the API is generated'
STR_NEGATIVE[4]='A character range like [S-Z], a value set written [SNOMED], and open questions about the feed'

i=0
while [ "$i" -lt "$STR_RULE_COUNT" ]; do
  if ! printf '%s\n' "${STR_POSITIVE[$i]}" | grep -qP -e "${STR_RULE_PATTERN[$i]}"; then
    self_test_fail "string-literal rule '${STR_RULE_NAME[$i]}' no longer matches its own positive sample."
  fi
  if printf '%s\n' "${STR_NEGATIVE[$i]}" | grep -qP -e "${STR_RULE_PATTERN[$i]}"; then
    hit=$(printf '%s\n' "${STR_NEGATIVE[$i]}" | grep -oP -e "${STR_RULE_PATTERN[$i]}" | head -1)
    self_test_fail "string-literal rule '${STR_RULE_NAME[$i]}' now matches a legitimate runtime string (matched: '${hit}'). A warning message a consumer reads must survive this gate; only our bookkeeping must not."
  fi
  i=$((i + 1))
done

i=0
while [ "$i" -lt "$SRC_RULE_COUNT" ]; do
  if ! printf '%s\n' "${SRC_POSITIVE[$i]}" | grep -qP -e "${SRC_RULE_PATTERN[$i]}"; then
    self_test_fail "src rule '${SRC_RULE_NAME[$i]}' no longer matches its own positive sample."
  fi
  if printf '%s\n' "${SRC_NEGATIVE[$i]}" | grep -qP -e "${SRC_RULE_PATTERN[$i]}"; then
    hit=$(printf '%s\n' "${SRC_NEGATIVE[$i]}" | grep -oP -e "${SRC_RULE_PATTERN[$i]}" | head -1)
    self_test_fail "src rule '${SRC_RULE_NAME[$i]}' now matches legitimate reference material (matched: '${hit}'). This is the WORD-N trap, arriving through the source-comment surface: it destroys the version designations and coded values a FHIR parser's IntelliSense exists to provide."
  fi
  i=$((i + 1))
done

# ---------------------------------------------------------------------------
# Refusals. Anything the scanner writes to stderr means it did not read everything it was
# given, and an incomplete scan must never print OK. Exit status cannot carry that signal:
# grep exits 1 on "no match", which xargs reports as 123, so "clean" and "died part way
# through the batch" are indistinguishable by code. A match inside input grep classifies
# as binary also arrives on stderr with empty stdout.
# ---------------------------------------------------------------------------
ERRLOG=$(mktemp)
FILELIST=$(mktemp)
SCANLIST=$(mktemp)
NPMBUF=$(mktemp)
REFLOWBUF=$(mktemp)
RAWBUF=$(mktemp)
SRCLIST=$(mktemp)
SRCSCAN=$(mktemp)
DOCLINES=$(mktemp)
DOCMAP=$(mktemp)
DOCFLOW=$(mktemp)
DOCFLOWMAP=$(mktemp)
STRLINES=$(mktemp)
STRMAP=$(mktemp)
trap 'rm -f "$ERRLOG" "$FILELIST" "$SCANLIST" "$NPMBUF" "$REFLOWBUF" "$RAWBUF" \
      "$SRCLIST" "$SRCSCAN" "$DOCLINES" "$DOCMAP" "$DOCFLOW" "$DOCFLOWMAP" \
      "$STRLINES" "$STRMAP"' EXIT

refuse_if_incomplete() {
  [ -s "$ERRLOG" ] || return 0
  cat "$ERRLOG" >&2
  echo "" >&2
  # GNU grep >= 3.5 prints "grep: FILE: binary file matches" on STDERR with nothing on
  # stdout, so a match in input it cannot read as text arrives here rather than in the hit
  # list. Name that case, or the run reds blaming an I/O failure that never happened and
  # sends a reader hunting it. This branch only chooses the wording; every path exits 1.
  if grep -qi 'binary file' "$ERRLOG"; then
    echo "ERROR: check-no-internal-refs - the input named above MATCHED a banned pattern," >&2
    echo "       but grep classifies it as binary, so the hit has no line number. Treat it" >&2
    echo "       as a real violation, and repair the file's encoding (it should be UTF-8)." >&2
  fi
  if grep -qiv 'binary file' "$ERRLOG"; then
    echo "ERROR: check-no-internal-refs - the scan reported errors, so it did not read all" >&2
    echo "       of its input. Refusing to report green from an incomplete scan." >&2
  fi
  exit 1
}

fail_with_hits() {
  local what="$1" hits="$2"
  echo "$hits" >&2
  echo "" >&2
  echo "ERROR: check-no-internal-refs - internal project bookkeeping found in ${what}." >&2
  echo "       A consumer reads this surface. Item identifiers, phase and wave language," >&2
  echo "       ADR numbers and meta-repo paths belong in the changeset, CHANGELOG.md, the" >&2
  echo "       commit, the PR and the roadmap. Translate at the boundary: say what the" >&2
  echo "       software does and what changed." >&2
  echo "       When you strip an identifier off the FRONT of a line, repair the head too:" >&2
  echo "       drop a leading orphan parenthetical, strip leading punctuation, recapitalise." >&2
  echo "       Leaving the fragment behind is worse than the text it replaced." >&2
  echo "       Rule: documentation/conventions.md, 'No internal project bookkeeping on a" >&2
  echo "       public surface'." >&2
  exit 1
}

# ---------------------------------------------------------------------------
# Build the scan list
# ---------------------------------------------------------------------------
#
# `git ls-files` is relative to the working directory, so from a subdirectory it lists a
# subtree and the scan would report OK having skipped the rest of the surface. Anchor at
# the top level.
cd "$(git rev-parse --show-toplevel)"

# The public surface, as paths. Each is justified in the SCAN SURFACE note at the top.
SURFACE_PATHS=(README.md LICENSE docs-content)

# Every named surface path must still be tracked. Without this, renaming or deleting
# README.md makes the gate scan less and still print OK, which is the same silent-green
# failure the routes below close, arriving through the file list instead of through grep.
for p in "${SURFACE_PATHS[@]}"; do
  if [ -z "$(git ls-files -- "$p")" ]; then
    echo "ERROR: check-no-internal-refs - the public surface path '$p' is not tracked." >&2
    echo "       Either it was renamed or removed (update SURFACE_PATHS in this script," >&2
    echo "       deliberately), or the scan is about to cover less than it claims." >&2
    echo "       Refusing to report green from a shrunken surface." >&2
    exit 1
  fi
done

# DRIFT TRIPWIRE on the npm tarball. `files` in package.json decides what a consumer
# actually receives, so anything added there is new public surface this gate would not know
# about. Rather than let that pass silently, refuse until someone puts it in SURFACE_PATHS
# or names it below as deliberately excluded.
#
# EVERY entry is checked, not just the prose-looking ones. Filtering `files` down to
# `*.md`/`LICENSE` first would discard `dist` before checking, and so structurally could
# not see the tarball's largest prose payload: the compiled JSDoc in `dist/index.d.ts`. A
# tripwire that cannot see the thing it was built to catch is not a tripwire. The two
# standing exclusions are named with their reasons in SCAN SURFACE above: `CHANGELOG.md`
# (contested, queued) and `dist` (untracked build output this script cannot read; its
# SOURCE is gated by the third pass instead).
#
# The `dist` exclusion is spelled BOTH ways on purpose. As of the FHIR-NPM-NAME sanitized
# publish probe (2026-08-26), `files` names the four build artifacts one by one instead of
# the `dist` directory, so that the two sourcemaps stay out of the tarball. Those four
# paths are the SAME untracked build output the `dist` entry always stood for, excluded
# for the identical reason and gated at the same place: their source, by the third pass.
# Naming them changes what npm packs, and nothing about what this gate reads. Should
# `files` go back to naming the directory, the `dist` entry is still here and still works.
command -v node >/dev/null || {
  echo "ERROR: check-no-internal-refs - node is required (to read package.json) and is not" >&2
  echo "       on PATH. Refusing to skip the npm-surface half of this gate." >&2
  exit 1
}
UNKNOWN_TARBALL_DOCS=$(node -e '
  const pkg = JSON.parse(require("fs").readFileSync("package.json", "utf8"));
  // Scanned by this gate:            README.md, LICENSE
  // Excluded deliberately, reasons in SCAN SURFACE: CHANGELOG.md, dist (as the directory,
  // or as the four build artifacts named one by one; same untracked output either way)
  const known = new Set([
    "README.md",
    "LICENSE",
    "CHANGELOG.md",
    "dist",
    "dist/index.mjs",
    "dist/index.cjs",
    "dist/index.d.ts",
    "dist/index.d.cts",
  ]);
  process.stdout.write((pkg.files ?? []).filter((f) => !known.has(f)).join(" "));
')
if [ -n "$UNKNOWN_TARBALL_DOCS" ]; then
  echo "ERROR: check-no-internal-refs - package.json 'files' ships something this gate does" >&2
  echo "       not cover: $UNKNOWN_TARBALL_DOCS" >&2
  echo "       That is public surface a consumer receives in the tarball. Add it to" >&2
  echo "       SURFACE_PATHS, or record it as a deliberate exclusion in this script." >&2
  exit 1
fi

git ls-files -z -- "${SURFACE_PATHS[@]}" > "$FILELIST"

if [ ! -s "$FILELIST" ]; then
  echo "ERROR: check-no-internal-refs - no tracked public-surface files to scan. Refusing" >&2
  echo "       to report green from a scan that read nothing." >&2
  exit 1
fi

# THE SILENT-GREEN ROUTES, all closed here. This list is NOT a claim of exhaustiveness:
# route (9) was found by a refuter against an hl7 copy whose own comment implied it was
# already complete.
#
#   (1) THE SCANNER CANNOT SEE. Closed by the locale pin and the positive self-tests
#       above, plus the negative self-tests, which are stronger than the em-dash gate's
#       single sample: they also catch a rule widened into the trap (1) shape.
#   (2) AN EMPTY FILE LIST. `xargs` without `-r` runs grep anyway, and grep with no file
#       operand reads STDIN, finds nothing, and exits 0. Closed by `-r` AND by refusing an
#       empty list outright, above and again after the loop.
#   (3) `git ls-files` FAILS (unreadable or corrupt index) AND ITS STATUS IS ERASED. The
#       list is built as its OWN command, not as the head of the pipeline: piped, its
#       status is swallowed by the `|| true` the no-match case needs, and the scan reports
#       OK over an empty list.
#   (4) A PATH THE SCANNER NEVER RECEIVES. `git ls-files` C-quotes any path holding a
#       space, a quote or a non-ASCII byte, so unseparated, grep is handed a name no file
#       has. Closed by `-z` here and `-0` on xargs.
#   (5) A FILENAME PARSED AS AN OPTION. A tracked file named `-q` would silence the whole
#       batch and the gate would print OK. Closed by `-e` before the pattern and `--`
#       after it.
#   (6) A FILENAME READ AS STANDARD INPUT, which `--` does NOT close. `--` stops `-` being
#       parsed as an OPTION; grep then reads the bare operand `-` as STDIN, and xargs
#       points its child's stdin at /dev/null, so a tracked file literally named `-` (a
#       `cmd > -` typo, which `git add -A` stages without complaint) is NEVER OPENED and
#       the gate prints OK and exits 0 over a live violation. Closed by `./`-prefixing
#       every path AS THE LIST IS BUILT, in the loop below rather than through `sed -z`, so
#       the scan stays a single command with the stderr capture bound to all of it and
#       there is no GNU-only stage that has no self-test of its own.
#       BE PRECISE ABOUT REACHABILITY: grep treats only a BARE `-` operand as stdin, and
#       every path this gate scans is emitted by `git ls-files` under a listed surface
#       path. None of those is the repo root today, so the worst a file named `-` can
#       produce is `docs-content/-`, which grep opens normally. The route becomes live the
#       moment SURFACE_PATHS gains a root-level glob or `.`. The prefix is therefore kept
#       as the thing that makes widening the surface safe, not as decoration.
#   (7) AN UNREAD ENTRY THAT IS NOT A MISSED MATCH. `-d skip` silently skips a tracked
#       symlink to a directory: no stderr, so nothing refuses, and the gate goes green
#       having never opened it. `-d skip` is NOT used. The loop refuses a tracked entry
#       that is not a regular file BY NAME instead, which is louder. The `! -L` guard
#       matters: `-d` follows symlinks, so a symlink to a directory tests true and would
#       be skipped as if it were a gitlink.
#   (8) A SCAN THAT DIED PART WAY THROUGH AND REPORTED CLEAN. grep's exit status cannot
#       distinguish that from no-match. Closed by capturing stderr and refusing on any of
#       it; see refuse_if_incomplete.
#   (9) A VIOLATION THAT STRADDLES A LINE WRAP. Not inherited from the em-dash family at
#       all: that gate matches a single character, so line anchoring costs it nothing.
#       Every rule here except the bare identifier is multi-token, and this repo hard-wraps
#       its markdown, so a phase sentence broken across two lines reads perfectly on the
#       rendered page and is invisible to a line scan. Closed by the paragraph-joined
#       second pass at the bottom of this file.
#
# Also, and not a route so much as a standing choice: NO `-I`. `-I` skips anything grep's
# heuristic calls binary, which includes a genuine TEXT file with a broken encoding, so a
# violation inside one would be skipped in silence. This repo's public surface is markdown
# and JSON with no binaries (checked: no tracked file under it holds a NUL byte), so losing
# `-I` makes a future binary a loud red instead of a silent miss. Fail closed, not open.
# `-H` is set so every hit carries its filename: grep omits the name when handed exactly
# one file, which an xargs batch boundary can produce.
: > "$SCANLIST"
gitlinks=0
scanned=0
while IFS= read -r -d '' f; do
  if [ -d "$f" ] && [ ! -L "$f" ]; then
    gitlinks=$((gitlinks + 1))
    continue
  fi
  if [ ! -r "$f" ]; then
    echo "ERROR: check-no-internal-refs - tracked file is not readable: $f" >&2
    echo "       Refusing to report green from a scan that could not open its input." >&2
    exit 1
  fi
  if [ ! -f "$f" ]; then
    echo "ERROR: check-no-internal-refs - tracked entry is not a regular file: $f" >&2
    echo "       Refusing to report green from a scan that skipped one of its inputs." >&2
    exit 1
  fi
  printf './%s\0' "$f" >> "$SCANLIST"
  scanned=$((scanned + 1))
done < "$FILELIST"

if [ ! -s "$SCANLIST" ]; then
  echo "ERROR: check-no-internal-refs - no public-surface files survived list building." >&2
  echo "       Refusing to report green from a scan that read nothing." >&2
  exit 1
fi

# The npm metadata is public surface that is not a file of its own. Extract the two fields
# the convention names and scan them as text. Written with a real newline between fields so
# a hit reports a usable line number.
node -e '
  const pkg = JSON.parse(require("fs").readFileSync("package.json", "utf8"));
  const lines = ["description: " + (pkg.description ?? ""), "keywords: " + (pkg.keywords ?? []).join(", ")];
  process.stdout.write(lines.join("\n") + "\n");
' > "$NPMBUF"
if [ ! -s "$NPMBUF" ]; then
  echo "ERROR: check-no-internal-refs - could not read the npm metadata from package.json." >&2
  echo "       Refusing to report green from a scan that read nothing." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Scan, one rule at a time so a hit can name the rule it broke
# ---------------------------------------------------------------------------
#
# Each rule is its own single command with its own stderr capture, rather than one merged
# pattern: a merged pattern cannot report WHICH rule fired, and "phase language" and
# "internal identifier" want different remediation advice. The cost is N passes over a
# handful of markdown files, which is nothing.
ALL_HITS=""
i=0
while [ "$i" -lt "$RULE_COUNT" ]; do
  : > "$ERRLOG"
  HITS=$(xargs -0 -r grep -H -nP -e "${RULE_PATTERN[$i]}" -- < "$SCANLIST" 2>>"$ERRLOG" || true)
  refuse_if_incomplete

  : > "$ERRLOG"
  NPM_HITS=$(grep -H -nP -e "${RULE_PATTERN[$i]}" -- "$NPMBUF" 2>>"$ERRLOG" || true)
  refuse_if_incomplete
  # Report the npm metadata under a name a reader can act on, not a temp path.
  [ -n "$NPM_HITS" ] && NPM_HITS=$(printf '%s\n' "$NPM_HITS" | sed "s|^${NPMBUF}|package.json (npm metadata)|")

  for block in "$HITS" "$NPM_HITS"; do
    [ -n "$block" ] || continue
    ALL_HITS="${ALL_HITS}[${RULE_NAME[$i]}]"$'\n'"${block}"$'\n'
  done
  i=$((i + 1))
done

# ---------------------------------------------------------------------------
# Second pass: the same rules over PARAGRAPH-JOINED text
# ---------------------------------------------------------------------------
#
# WHY THIS EXISTS. Every rule above except the bare identifier is MULTI-TOKEN (`phase X`,
# `wave N`, `this slice`, `roadmap phase K`), grep matches within a line, and this repo
# hard-wraps its markdown by house style. So a violation that happens to straddle a wrap is
# invisible to the line scan, while a reader of the rendered page sees it plainly, because
# markdown folds a soft line break into a space. In the hl7 copy this was not hypothetical:
# a spec-notes page read "... A future phase" / "may add opt-in decode ...", and the gate
# printed OK over it.
#
# So the file is joined the way markdown renders it (consecutive non-blank lines in a
# paragraph become one line, blank lines stay blank) and scanned again. Line numbers are
# lost by construction, so this pass reports the FILE and the MATCHED TEXT, and it reports
# only matches the line pass did not already produce, which keeps a wrapped hit from being
# printed twice in the same run.
#
# It cannot replace the line pass: that one gives line numbers, which is what a remediator
# actually needs. It is additive, and its cost is a second grep per file per rule over a
# handful of markdown files.
while IFS= read -r -d '' f; do
  # WHITESPACE IS SQUEEZED, and that is the whole difference between this pass working and
  # this pass looking as though it works. Joining lines verbatim leaves the continuation
  # line's own indentation in the joined text: an indented wrap produces `phase   may`, and
  # every rule here is written with single spaces, so it does not match. Indented
  # continuations are the DOMINANT wrap shape in this corpus, because the pages are mostly
  # bulleted, so the pass would miss the very case it was added for while reporting that it
  # had run. Squeezing runs of whitespace to one space is also what markdown itself does to
  # a paragraph, so this models the rendered page rather than approximating it.
  : > "$ERRLOG"
  awk '
    /^[[:space:]]*$/ { print ""; next }
    { line = $0; gsub(/[[:space:]]+/, " ", line); sub(/^ /, "", line); printf "%s ", line }
    END { print "" }
  ' "$f" > "$REFLOWBUF" 2>>"$ERRLOG"
  refuse_if_incomplete

  i=0
  while [ "$i" -lt "$RULE_COUNT" ]; do
    : > "$ERRLOG"
    grep -oP -e "${RULE_PATTERN[$i]}" -- "$f" > "$RAWBUF" 2>>"$ERRLOG" || true
    refuse_if_incomplete

    : > "$ERRLOG"
    FLOW_HITS=$(grep -oP -e "${RULE_PATTERN[$i]}" -- "$REFLOWBUF" 2>>"$ERRLOG" || true)
    refuse_if_incomplete

    if [ -n "$FLOW_HITS" ]; then
      # Only what the line pass could not see. An empty RAWBUF means no line-pass match, and
      # `grep -f` with no patterns selects nothing, so -v then keeps every wrapped hit.
      EXTRA=$(printf '%s\n' "$FLOW_HITS" | grep -Fxv -f "$RAWBUF" | sort -u || true)
      if [ -n "$EXTRA" ]; then
        while IFS= read -r m; do
          [ -n "$m" ] || continue
          ALL_HITS="${ALL_HITS}[${RULE_NAME[$i]} / wrapped across lines]"$'\n'"${f}: ${m}"$'\n'
        done <<< "$EXTRA"
      fi
    fi
    i=$((i + 1))
  done
done < "$SCANLIST"

# ---------------------------------------------------------------------------
# THIRD PASS: `src/` DOC COMMENTS, the prose that compiles into `dist/`
# ---------------------------------------------------------------------------
#
# THE CEILING, STATED FIRST, because it is the honest frame for everything below.
# `dist/` is UNTRACKED BUILD OUTPUT. No checked-in gate can scan it without building
# first, and this script deliberately does not build. So the thing a consumer actually
# receives is NOT what is checked here. What is checked is its SOURCE: the `/** */`
# blocks the dts build copies verbatim. That is a PROXY, and it is a good one only
# because the copy is verbatim -- tsup rewrites declarations, not doc text. A rewrite of
# the build that started transforming comments would silently decouple the two, and
# nothing here would notice. This pass therefore raises the floor on `dist/`; it does not
# observe `dist/`.
#
# Two consequences worth naming rather than discovering:
#   * A doc comment that never reaches an exported declaration is swept anyway. That is
#     deliberate: which comments survive the dts rollup is a property of the BUILD, not of
#     the source, and gating on it would make the gate's answer depend on tsup's inlining
#     decisions. This package has ONE entry point (`src/index.ts`, per tsup.config.ts), so
#     the question is a single one here, but the answer is still the build's to give and
#     not the source's.
#   * `dist/*.d.cts` is the same text as `dist/*.d.ts`, so one clean source covers both
#     conditions.

# The `src/` surface must still be tracked, for the same reason SURFACE_PATHS is checked:
# a rename that empties this list must red, not shrink the scan in silence.
git ls-files -z -- 'src/*.ts' 'src/**/*.ts' > "$SRCLIST"
if [ ! -s "$SRCLIST" ]; then
  echo "ERROR: check-no-internal-refs - no tracked src/*.ts files to scan for doc" >&2
  echo "       comments. Either the source moved (update this pass, deliberately) or the" >&2
  echo "       scan is about to cover less than it claims. Refusing to report green." >&2
  exit 1
fi

# Same list-building discipline as the public-surface pass: `./`-prefixed as the list is
# built (route 6), a non-regular-file entry refused by name rather than skipped (route 7),
# an unreadable entry refused (not silently missed).
: > "$SRCSCAN"
src_scanned=0
while IFS= read -r -d '' f; do
  if [ -d "$f" ] && [ ! -L "$f" ]; then continue; fi
  if [ ! -r "$f" ]; then
    echo "ERROR: check-no-internal-refs - tracked source file is not readable: $f" >&2
    echo "       Refusing to report green from a scan that could not open its input." >&2
    exit 1
  fi
  if [ ! -f "$f" ]; then
    echo "ERROR: check-no-internal-refs - tracked source entry is not a regular file: $f" >&2
    echo "       Refusing to report green from a scan that skipped one of its inputs." >&2
    exit 1
  fi
  printf './%s\0' "$f" >> "$SRCSCAN"
  src_scanned=$((src_scanned + 1))
done < "$SRCLIST"

if [ ! -s "$SRCSCAN" ]; then
  echo "ERROR: check-no-internal-refs - no source files survived list building." >&2
  echo "       Refusing to report green from a scan that read nothing." >&2
  exit 1
fi

# EXTRACT THE DOC COMMENTS. Two buffers per pass, and the reason for the second one is
# line numbers: the rules must run over doc text ALONE (so a rule cannot match a line
# number, a path, or the code on the far side of a `*/`), which means the location has to
# travel beside the text rather than inside it. DOCLINES holds one doc line of text per
# line; DOCMAP holds `file:lineno` at the SAME line index. A hit at index N in one is
# located by index N in the other.
#
# The leaders are stripped the way an IDE strips them: `/**`, a leading `*`, and `*/`
# disappear, because none of them is part of what the reader sees on hover. `//` and
# plain `/* */` are NOT extracted -- see the boundary argument at SRC_RULE_NAME above.
: > "$DOCLINES"; : > "$DOCMAP"; : > "$DOCFLOW"; : > "$DOCFLOWMAP"
: > "$ERRLOG"
while IFS= read -r -d '' f; do
  awk -v file="$f" -v dl="$DOCLINES" -v dm="$DOCMAP" -v df="$DOCFLOW" -v dfm="$DOCFLOWMAP" '
    function emit() {
      gsub(/[[:space:]]+/, " ", joined); sub(/^ /, "", joined); sub(/ $/, "", joined)
      if (joined != "") { print joined >> df; print file ":" blockstart >> dfm }
      joined = ""
    }
    # End of a paragraph inside a block: emit it, keep the block open, keep reporting the
    # location as the block start (a paragraph index would be a number no reader can use).
    function flush2() { if (blockstart > 0) emit() }
    # End of the block.
    function flush() { if (blockstart > 0) emit(); blockstart = 0 }
    {
      line = $0
      if (!indoc) {
        if (line !~ /^[[:space:]]*\/\*\*/) { next }
        indoc = 1; blockstart = FNR; joined = ""
        sub(/^[[:space:]]*\/\*\*/, "", line)
      }
      # THE TERMINATOR IS TESTED BEFORE THE LEADER IS STRIPPED, and that ordering is the
      # whole correctness of this extractor. Stripping first turns a closing " */" into
      # "/" (the leader pattern eats the asterisk of the terminator), the block never
      # closes, and every `//` comment and line of CODE after it is scanned as doc text.
      # That is not hypothetical: it is what the first draft of the hl7 pass did, and it
      # reported 60 violations that were all real bookkeeping sitting in `//` comments
      # this surface deliberately does not cover. A gate that over-reports is not "safe":
      # it would have forced a sweep of the wrong lines.
      # TESTING THE TERMINATOR AGAINST DOC TEXT IS CORRECT, NOT A SHORTCUT: a doc comment
      # whose prose contains `*/` (a glob like `src/**/*.ts`, a regex ending `*/`) would
      # close the block early and drop the rest of it from the scan. THE CONSTRUCT IS
      # UNREACHABLE IN VALID TYPESCRIPT: block comments do not nest and cannot contain
      # `*/`, so the compiler ends the comment at exactly the same character this does,
      # and `typecheck` runs ahead of this gate on the ladder. The extractor mirrors the
      # language; it does not approximate it.
      closed = 0
      if (line ~ /\*\//) { closed = 1; sub(/\*\/.*$/, "", line) }
      # Exactly ONE leading asterisk, never `\*+`: a greedy leader would swallow the
      # opening `**` of markdown bold ("* **Fail-safe:**") and alter the scanned text.
      sub(/^[[:space:]]*\*[[:space:]]?/, "", line)
      sub(/^[[:space:]]+/, "", line)
      # The LINE pass sees the doc text with its location beside it.
      print line >> dl; print file ":" FNR >> dm
      # The FLOW pass accumulates a PARAGRAPH, not the whole block, and squeezes it the way
      # a tooltip reflows one. A BLANK doc line is a paragraph break and ends the run, for
      # the same reason the markdown pass above prints an empty line rather than joining
      # through it: a list item ending "(this module)" followed by a blank line and a new
      # sentence starting "The ..." is not the text "(this module) The ...", and joining
      # through the break invents adjacencies that no reader ever sees. Left unbroken, a
      # doc line ending in "phase" followed by a blank line and a paragraph opening with a
      # capital letter would red as "phase X". That is an over-report rather than a silent
      # green, but a gate that reds on correct content is a gate someone deletes.
      if (line ~ /^[[:space:]]*$/) { flush2() } else { joined = joined " " line }
      if (closed) { flush(); indoc = 0 }
    }
    END { if (indoc) flush() }
  ' "$f" 2>>"$ERRLOG"
done < "$SRCSCAN"
refuse_if_incomplete

# An extraction that produced nothing from a non-empty, JSDoc-heavy source tree means the
# extractor broke, not that the tree is clean. Same class as the empty-file-list refusal.
if [ ! -s "$DOCLINES" ]; then
  echo "ERROR: check-no-internal-refs - extracted no doc-comment text from ${src_scanned}" >&2
  echo "       tracked source file(s). Every public export in this package carries JSDoc," >&2
  echo "       so an empty extraction means the extractor is broken, not that the source" >&2
  echo "       is clean. Refusing to report green from a scan that read nothing." >&2
  exit 1
fi

# SCAN. Line pass first (it can name a file and a line), then the reflowed pass for
# violations that straddle a wrap. Wraps are not hypothetical here either: this package's
# doc comments are wrapped at the same column as its markdown, and a sentence ending
# "... this" / "phase models" is exactly as invisible to a line scan in JSDoc as it is in
# markdown. The reflow models a hover tooltip: whitespace squeezed, `*` leaders already
# gone.
SRC_HITS=""
i=0
while [ "$i" -lt "$SRC_RULE_COUNT" ]; do
  : > "$ERRLOG"
  LINE_IDX=$(grep -nP -e "${SRC_RULE_PATTERN[$i]}" -- "$DOCLINES" 2>>"$ERRLOG" | cut -d: -f1 || true)
  refuse_if_incomplete
  if [ -n "$LINE_IDX" ]; then
    while IFS= read -r n; do
      [ -n "$n" ] || continue
      loc=$(sed -n "${n}p" "$DOCMAP")
      txt=$(sed -n "${n}p" "$DOCLINES")
      SRC_HITS="${SRC_HITS}[${SRC_RULE_NAME[$i]} / src doc comment]"$'\n'"${loc}: ${txt}"$'\n'
    done <<< "$LINE_IDX"
  fi

  : > "$ERRLOG"
  FLOW_IDX=$(grep -nP -e "${SRC_RULE_PATTERN[$i]}" -- "$DOCFLOW" 2>>"$ERRLOG" | cut -d: -f1 || true)
  refuse_if_incomplete
  if [ -n "$FLOW_IDX" ]; then
    while IFS= read -r n; do
      [ -n "$n" ] || continue
      # Report only what the line pass could not see, so a wrapped hit is not printed
      # twice. A block whose violation is on one line is already reported above.
      blockloc=$(sed -n "${n}p" "$DOCFLOWMAP")
      # DELIMITED, not a bare substring. An unanchored `*"$blockloc"*` makes
      # `./src/x.ts:1` a substring of an existing hit at `./src/x.ts:12`, so a real wrapped
      # violation in the block starting at line 1 is suppressed by an unrelated hit at
      # line 12. It never loses the RED (SRC_HITS is non-empty either way) but it loses the
      # REPORT, which is the line a remediator needs. The trailing ':' is what a location
      # is always followed by in SRC_HITS.
      case "$SRC_HITS" in
        *"${blockloc}: "*|*"${blockloc} (block): "*) continue ;;
      esac
      m=$(sed -n "${n}p" "$DOCFLOW" | grep -oP -e "${SRC_RULE_PATTERN[$i]}" | head -1)
      SRC_HITS="${SRC_HITS}[${SRC_RULE_NAME[$i]} / src doc comment, wrapped across lines]"$'\n'"${blockloc} (block): ${m}"$'\n'
    done <<< "$FLOW_IDX"
  fi
  i=$((i + 1))
done

# ---------------------------------------------------------------------------
# FOURTH PASS: `src/` STRING LITERALS, the prose that reaches a consumer's LOG
# ---------------------------------------------------------------------------
#
# The argument for this pass, the measurement behind it, and its four stated boundaries
# are at STR_RULE_NAME above. In short: a parser's warning messages are read more often
# than its README, they are neither markdown nor doc comments, and six of them carried
# "this phase" into a consumer's log until this pass was written.
#
# The extractor keeps text ONLY, never the quotes, and records `file:line` beside each
# extracted line in the same index-aligned way the doc-comment pass does. Several literals
# on one source line are joined with a space, which is safe because a rule that matched
# across the join would have to span two adjacent literals in one expression; measured
# zero such matches, and an over-report there is a maintainer reading one line.
: > "$STRLINES"; : > "$STRMAP"
: > "$ERRLOG"
while IFS= read -r -d '' f; do
  awk -v file="$f" -v sl="$STRLINES" -v sm="$STRMAP" '
    # Whole-line comments are skipped: the doc-comment pass owns `/** */`, and `//` is
    # deliberately out of scope for this gate. Matches `//`, `/*`, `/**` and a ` *`
    # continuation line.
    /^[[:space:]]*(\/\/|\/\*|\*)/ { next }
    {
      line = $0
      out = ""
      while (match(line, /"([^"\\]|\\.)*"|`([^`\\]|\\.)*`/)) {
        out = out " " substr(line, RSTART + 1, RLENGTH - 2)
        line = substr(line, RSTART + RLENGTH)
      }
      if (out != "") { print out >> sl; print file ":" FNR >> sm }
    }
  ' "$f" 2>>"$ERRLOG"
done < "$SRCSCAN"
refuse_if_incomplete

# A source tree this size cannot contain zero string literals. An empty extraction means
# the extractor broke, not that the tree is clean; same class as every other refusal here.
if [ ! -s "$STRLINES" ]; then
  echo "ERROR: check-no-internal-refs - extracted no string literals from ${src_scanned}" >&2
  echo "       tracked source file(s). This package's warning messages, warning codes and" >&2
  echo "       import specifiers are all string literals, so an empty extraction means the" >&2
  echo "       extractor is broken, not that the source is clean. Refusing to report green" >&2
  echo "       from a scan that read nothing." >&2
  exit 1
fi

STR_HITS=""
i=0
while [ "$i" -lt "$STR_RULE_COUNT" ]; do
  : > "$ERRLOG"
  STR_IDX=$(grep -nP -e "${STR_RULE_PATTERN[$i]}" -- "$STRLINES" 2>>"$ERRLOG" | cut -d: -f1 || true)
  refuse_if_incomplete
  if [ -n "$STR_IDX" ]; then
    while IFS= read -r n; do
      [ -n "$n" ] || continue
      loc=$(sed -n "${n}p" "$STRMAP")
      txt=$(sed -n "${n}p" "$STRLINES")
      STR_HITS="${STR_HITS}[${STR_RULE_NAME[$i]} / src string literal]"$'\n'"${loc}:${txt}"$'\n'
    done <<< "$STR_IDX"
  fi
  i=$((i + 1))
done

[ -n "$ALL_HITS" ] && fail_with_hits "the public surface listed above" "$ALL_HITS"
[ -n "$SRC_HITS" ] && fail_with_hits "src/ doc comments, which compile into dist/ and render in every consumer's editor" "$SRC_HITS"
[ -n "$STR_HITS" ] && fail_with_hits "src/ string literals, which reach a consumer as warning and error message text" "$STR_HITS"

echo "check-no-internal-refs: OK (${scanned} public-surface file(s) and the npm metadata scanned against ${RULE_COUNT} rules, line by line and paragraph-joined; ${src_scanned} source file(s) scanned against ${SRC_RULE_COUNT} rules for doc-comment bookkeeping, line by line and paragraph-reflowed, and against ${STR_RULE_COUNT} rules for string-literal bookkeeping; ${gitlinks} gitlink(s) skipped)"
