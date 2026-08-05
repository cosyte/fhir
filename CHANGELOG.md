# Changelog

All notable changes to `@cosyte/fhir` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project stays on the
**v0.0.x-until-first-alpha** ladder (meta-repo ADR 0001) until its first alpha.

## [Unreleased]

### Fixed

- **`serializeResource` no longer substitutes `{}` for a scalar it never read (`FHIR-WRITER-AUTHORS-VALUES`).**
  A string, number, boolean or `null` written where FHIR JSON has an object is content the reader has
  no element to make of it, so it reports `UNKNOWN_PROPERTY` and the model holds an empty element
  there. The writer emitted that element, and `{}` is a **conformant** empty element, so the warning
  was gone the moment the output was read back: `{"name":[{"family":"Roe"},"James"]}` in,
  `{"name":[{"family":"Roe"},{}]}` out, and the finding at `name[1]` gone with it. **That is the
  fabrication class**: a value the writer authored and presented as read, at a position where nothing
  was read at all. The writer now hands the value back, which is the treatment an array inside an
  array already had one branch over in the same function, and the finding survives the round trip
  instead of laundering away. Both of the reader's call sites are covered, including a `_`-sibling's
  `extension` items. The scalar is deliberately **not** modeled as a primitive: putting it in the
  tree would make it visible to every walker at a position walkers read as a complex element, which
  is a redefinition of the model rather than a preservation of the document. It hangs off the node
  (`FhirComplex.nonObjectSource`, new, string, absent on every conformant document and on every
  document read from XML) where only the writer reads it, and `nodesEquivalent` compares it, so the
  cross-format oracle cannot call two documents the same over content neither could place. Such
  output is deliberately not spec-clean, and it is now the **third** named exception on
  `serializeResource`, alongside an array inside an array and a non-string `resourceType`.
  `serializeResourceXml` does not carry the text and still emits the empty element, unchanged and
  the same as it does for an array inside an array.
- **`MIXED_XML_SPELLING` compares the expanded name, not the tag alone (`FHIR-WRITER-AUTHORS-VALUES`).**
  An element's occurrences can share one tag and carry two different namespaces (Namespaces in XML
  1.0 §6.1), and a tag-only comparison had nothing to compare, so those merges were silent. Two
  routes reach it and neither needs a prefix spelled two ways: a prefix **rebound between siblings**
  (`<p:x xmlns:p="urn:a"/>` beside `<p:x xmlns:p="urn:b"/>`), and a **`<div/>` in the FHIR namespace**
  landing in `Narrative.div` beside the real XHTML narrative, because the narrative is modeled as
  `div` under every spelling of the XHTML namespace. The second is the costlier: `Narrative.div` is
  `0..1`, so an otherwise conformant document read back as two occurrences with **zero** diagnostics
  and `valid: true`, and a single-value read of the narrative yields nothing rather than the prose.
  The merge itself is unchanged, because dropping the grouping would be a silent first-wins loss (the
  XML reader has no `duplicates` mechanism); what changed is that it is no longer invisible. The
  comparison can only ever add a report, never retire one, and a conformant document reaches it only
  with occurrences that share both halves, so it stays silent there. Measured over this repo's 7
  hand-authored XML fixtures plus mutations (1,195 documents), **not** the FHIR R4 published-examples
  corpus: 4 readings moved, all 4 read diagnostics **gained** and 0 lost, 0 validation findings
  moved in either direction, 0 `valid` or `safeToSummarize` flips, 0 retractions or negations lost,
  0 leaf values missing, and of 396 twin pairs 393 identical, 3 louder, **0 weaker**.
- **The PHI scanner's `--staged` route no longer reports clean over a staged rename, and an ordinary
  `git mv` of a tracked symbolic link into a scan root is refused (`PHI-SCAN-RENAME-BLIND-AT-PRECOMMIT`).**
  `R` and `C` are returned by neither `--diff-filter=AM` nor `AMT`, and git's rename detection is
  **on by default**, so `git mv <link> test/__fixtures__/<name>` staged as
  `:120000 120000 <sha> <sha> R100` with two paths and the filter deleted the record outright: the
  route printed `OK, no hits` (exit 0) over a mode-`120000` entry sitting under a scan root. **The
  cost was not only the mode check.** A record the route never lists is never scanned either, so a
  rename that also **substituted a real-looking name** into the moved file passed the same way. The
  remedy is `--no-renames`, not handling a two-path record: the destination then arrives as an
  ordinary single-path `A` and the source as a `D` the filter already drops, the two-field stride
  becomes **structural** rather than conditional, and no `R`/`C` record can be produced whatever the
  caller's config says. Verified under `diff.renames=true|copies|false|1` and `diff.renameLimit=1`.
  **The copy half is real, not a theoretical arm:** under `diff.renames=copies` a PHI-bearing file
  copied from outside the scope into a scan root stages as a genuine `C100`, also two-path, and was
  dropped exactly as a rename was (measured: exit 0 before, exit 1 after). **The enumeration is equal
  or larger, NOT a strict superset:** the two enumerations are **equal** whenever nothing is renamed
  or copied, which is the ordinary commit, and larger only when something is. The property relied on
  is the one-directional half, that nothing which **was** enumerated stops being enumerated. This is
  a change to the commit gate only: **no package surface, runtime behavior, build output or
  dependency changes.**
- **An unmerged in-scope path is refused instead of passing unobserved.** `U` was returned by
  neither `AM` nor `AMT`, so a conflicted path under a scan root was simply absent from the list and
  the route reported `OK, no hits` over an index it had not read. An unmerged path is recorded at
  stages 1/2/3 and at no stage 0, so `git show :<path>` fails outright and there is no one staged
  blob to scan; it now refuses (exit 2) naming the path. Git itself will not commit while a path is
  unmerged, so this was never a route to a committed leak; what it was is a gate attesting clean
  over a state it never observed, and `pnpm phi-scan --staged` is run by hand and from scripts as
  well as from the hook.
- **Each scan root's own path is in scope as well as its contents.** A `--raw` record at exactly
  `test/__fixtures__` or `src` is never a directory, because this invocation emits no record for one,
  so it is a scan root replaced by a blob, a link or a gitlink, and the prefix test alone let that
  through (measured: exit 0 over a staged mode-`120000` `test/__fixtures__`, and the same for `src`).
  The claim is scoped to the **record**, not to the index: a sparse index does hold a directory entry
  (`040000 <sha> 0 src/`), which carries a trailing slash, matches neither test, and produces no
  record here. What admitting the path buys is the **mode check**, which covers the link and gitlink
  cases entirely. A regular **blob** at either path reaches only the conservative shape pass and not
  the FHIR-aware scan, because `isFixture` tests a trailing slash, so a resource written there has
  its `name`, `birthDate`, `address` and `telecom` read by nothing. That is a **disclosed gap**
  recorded in `phi-scan-overrides.md` and pinned by a test, **not** a safe direction, and it is not a
  regression: the path was not admitted at all before.
- **A scan that failed anywhere inside `main()` now exits 2, not 1.** Node exits 1 on an uncaught throw and 1 is
  this gate's code for **hits found**, so a failure that was not an `InvocationError` was reported
  to CI and to the developer as a finding. Two were measured exiting 1: a missing or unreadable
  allow-list (`loadAllowList()` sat outside every handler) and `readdirSync` refusing a walk root
  (`ENOTDIR` on a root that is not a directory, `EACCES` on one it cannot list). Both refuse with 2
  now, and a process-level net reports the rest as the invocation error they are rather than
  impersonating a finding. **The net wraps the call to `main()`**, so it covers everything inside it
  and nothing before it: a throw at module load, or a failure in the `tsx` / `node` runner itself,
  still exits 1 and no wrapper placed there could change that.

### Changed

- **Corrected the recorded cause of the `E403` that keeps this package off npm (`FHIR-NPM-NAME`).**
  No change to the package surface, runtime behavior, build output or dependencies; this is a
  documentation correction only. `CLAUDE.md` stated as fact that npm rejects the scoped name via a
  **name-similarity filter, on account of the unscoped `fhir` package**. That reading is
  **RETRACTED**: npm has never named similarity or the unscoped package in anything it returned, and
  the reading is harmful because it implies renaming or rescoping where the evidence implies a
  support ticket. Replaced with what is measured, re-derived on the `0.0.8` attempt of 2026-08-04
  (run `30915771713`, `PUT` refused `2026-08-04T13:52:56Z`): the provenance statement is signed and
  reaches the sigstore transparency log **before** the registry answers (logIndex `2340587080`,
  verified present in rekor and decoding to `pkg:npm/%40cosyte/fhir@0.0.8`), so the refusal is
  registry-side name or permission policy and not a signing failure; the `PUT` is refused in ~45ms
  with no response body, independent of publish path and account session; and new `@cosyte` packages
  were created successfully on 2026-07-29 and 2026-07-30, after the first `fhir` `E403`, so
  scope-level package creation works and only this one name is refused. Also records the traced
  sigstore logIndexes so a refused version is not re-fired, and notes that the failing run now
  uploads the redacted npm debug log npm support asked for. The `0.0.7` and `0.0.8` artifacts were
  inspected by hand and contain **no credential material**: npm 10.9.8 logs config file paths only,
  never their contents, and no `Authorization` header.

### Fixed

- **A dropped-character-data finding disappeared across a write-and-re-read; both writers now refuse
  the model instead (`FHIR-ELEMENT-TEXT-RECOVERY`).** The reporting half of
  `FHIR-PRIMITIVE-AS-ELEMENT-TEXT` made `<status>entered-in-error</status>` report rather than
  affirm, but left the finding laundering: `serializeResourceXml` emitted `<status/>` and a re-read of
  that output came back `valid: true`, `safeToSummarize: true`, with `droppedText` empty. Measured on
  `6c5bb02`, the JSON writer was **worse and was not previously recorded**: `serializeResource`
  emitted `{"resourceType":"Observation"}`, dropping the member outright, so a retracted `Observation`
  re-read as one that had never named a status at all. Both routes are closed.
  `serializeResource` and `serializeResourceXml` now throw the new `FhirSerializeError`
  (`SERIALIZE_ERROR_CODES.DROPPED_ELEMENT_TEXT`) when asked to emit a model the reader marked, rather
  than emit an element the sender appears never to have filled in. The error is value-free and carries
  the bounded FHIRPath `locations` it refused over, never the text it could not encode; it is swept by
  the derived-name gate like the read-path fatal beside it.
  **This is a REFUSAL, not the recovery half.** The text is still not read back as the element's
  value: that remains a _tolerance_ for a non-conformant encoding, which is encoded only when a real
  publicly-cited document shows the shape (meta-repo ADR 0018). A fresh search found none, so the
  recovery half stays unbuilt and deliberately so. Nothing new is recognised and no value is invented.
  `<status/>` was never a neutral fallback: xml.html §2.6.1 says _"FHIR elements are never empty. If
  an element is present in the resource, it SHALL have either a value attribute, child elements as
  defined for its type, or 1 or more extensions"_, so emitting it violated that SHALL.
  **Scoped to a model the reader MARKED and nothing else.** A document read from JSON has no
  character-data channel and is untouched; a conformant XML document still round-trips byte-for-byte.
  Say "marked", not "whose text was dropped": character data that is `String.trim()`-empty is dropped
  with no flag, no marker and no finding, so a `<status>` holding only whitespace still emits
  `<status/>` and still re-reads clean. That gap is pre-existing and unchanged here.
  The wider §2.6.1 residual is explicitly **not** addressed: a value-absent primitive carrying no
  extension still emits `<status/>`, and the `id`-only case (`<given id="b"/>`) is still a violation,
  left as the separate decision it is and pinned by a test.
  **Differential vs `6c5bb02` over 1,195 documents**, both trees in one process: 0 `valid false ->
true`, 0 `valid true -> false`, 0 `safeToSummarize false -> true`, 0 retractions lost, 0 negations
  lost, 0 read diagnostics lost or gained, 0 validation findings lost or gained, 0 newly throwing, 0
  outputs shorter, 0 of 10,797 compared leaf values missing, narrative preservation unmoved at 758 of
  836, and the twin comparand 394 identical / 2 louder / **0 weaker**. Bought: **360 serializations
  refused** that previously emitted a document which re-read clean.
  The committed differential harness (`pnpm differential:read`) was fixed in the same change: it
  wrapped serialization in the same `try` as the reading, so a refusal collapsed the whole reading and
  reported every value base read as lost (5,159 phantom losses on the first run). A refusal specifically
  is now caught before that `try`'s `catch` sees it (any OTHER writer throw still collapses the whole
  reading, exactly as before), a refusal is its own `reread` state and its own tally line, and the tallies that
  would misread it as a loss -- "output shorter", "no longer re-reads", the leaf comparison -- exclude
  it explicitly.

- **A FHIR primitive whose value was written as XML element text was dropped, and the safety spine
  affirmed over the loss (`FHIR-PRIMITIVE-AS-ELEMENT-TEXT`).** FHIR XML carries a primitive's value in
  the `value` attribute (xml.html §2.6.1), so `<status>entered-in-error</status>` writes a code where
  the model has no slot for one. The reader drops the character data, and the element left behind is
  indistinguishable from one the sender never filled in, which is what let an affirmative verdict be
  computed over it.
  Measured on `6689239`, byte-identical on `09b2805` where the gate filed it:
  `<Observation><status>entered-in-error</status></Observation>` read `retracted: false`,
  `safeToSummarize: true`, `negations: []`, `valid: true`, and `assertSafeToSummarize` did **not**
  throw; an `AllergyIntolerance` whose `verificationStatus.coding.code` was written as text lost the
  `refuted`; and a `doseQuantity` lost the **dose number** while its `mg` unit and UCUM code survived,
  so the resource read complete. It was `UNEXPECTED_XML_CONTENT`-reported throughout, so never silent,
  but a retraction that reads as an affirmation is the sharpest form of this harm.
  **This is the REPORTING half**, split on the same line `FHIR-NESTED-ARRAY-REPORTING` was split on.
  The text is **not** read back as the element's value: recovering it would be a _tolerance_ for a
  non-conformant encoding, and a tolerance is encoded only when a real document grounds the shape
  (meta-repo ADR 0018). No public artifact has been shown emitting it, so the preserving half is
  deliberately not shipped.
  Adds `VALIDATION_CODES.DROPPED_ELEMENT_TEXT` (error, `structure`), `SafetyReadout.droppedText` plus
  public `droppedText()`, public `isDroppedText()`, `safeToSummarize: false`, and a marker-sensitive
  `nodesEquivalent`. `markDroppedText` is reader-internal and not exported. The marker is an inert
  `droppedText?: true` carrying **no content**, so the model's edge set is still exactly four
  node-valued members and every walker (`codingsOf`, the FHIRPath engine, the profile navigator, the
  terminology walker) is unchanged.
  **No existing diagnostic is suppressed and no new read-time code is added.** `DROPPED_ELEMENT_TEXT`
  is raised **in addition to** the existing `UNEXPECTED_XML_CONTENT` warning, never instead of it. The
  marker is applied at all **three** sites where the reader observes and discards character data
  (`readComplex`, the resource-valued unwrap, the primitive branch of `buildSingle`), counted in the
  source rather than asserted.
  **Differential vs `6689239` over 1,195 documents**, both trees in one process
  (`pnpm differential:read`): **0** `valid: false -> true`, **0** `safeToSummarize: false -> true`,
  **0** retractions lost, **0** negations lost, **0** read diagnostics lost, **0** validation findings
  lost, **0** newly throwing, **0** outputs shorter, **0 of 15,956** leaf values missing, narrative
  preservation unmoved at 758 of 836. Bought: 360 documents now report, 312 previously `valid: true`.
  The 27 documents whose emitted XML re-reads differently are `PRE-EXISTING`, **0** stable on base.
  **The differential harness's own negative control is fixed in the same change.** It was hard-coded
  to the _previous_ slice's change; that slice merged, `origin/main` began carrying it, and the
  control fired on every run afterwards, a permanent false red on the harness's only alarm. It now
  names the change under measurement, compares the whole reading rather than only the serialized JSON
  (this change moves what the safety layer _says_ without moving any value), and tells the next reader
  to suspect it first.
  **Three limits, pinned by tests rather than prose, each a scope the conformance gate broke a first
  draft of.** (i) The finding **launders on a write-and-re-read**, and `<status/>` is not a neutral
  fallback but itself a violation of xml.html §2.6.1's "FHIR elements are never empty" SHALL,
  `PRE-EXISTING`, and scoped precisely: it holds for a value-absent primitive carrying **no
  extension**, since §2.6.1's third arm ("or 1 or more extensions") is satisfied by
  `<status><extension url="..."/></status>`, the shape a `data-absent-reason` emits; an `id`-only
  primitive (`<status id="s1"/>`) still violates it. Tracked separately. (ii) Text beside a value
  that _did_ arrive (`<status value="final">entered-in-error</status>`) draws the same refusal, and
  the reason is **not** "content is still missing" (`<status value="final">final</status>` refuses
  too, and nothing is missing there): the rule keys on the reader _dropping_ character data and never
  compares the text to the value, because comparing them would mean reading it. (iii) The scope of
  both the flag and the marker is `hasStrayText`, which tests JS `String.trim()` and so treats
  a set wider than XML's S production and spanning several Unicode categories (U+00A0 and Zs, U+2028,
  U+2029, U+FEFF, VT, FF) as whitespace, so character data made only of those is dropped with
  neither a flag nor a marker, `PRE-EXISTING` and identical on base. No sentence here says "wherever
  text is dropped".

- **A symbolic link under a PHI scan root read clean on BOTH enumerating routes
  (`PHI-SCAN-SYMLINK-BLIND-ON-BOTH-ROUTES`).** Reproduced on `810eec9` with a synthetic,
  name-bearing payload held outside the walk roots and linked from `src/leak.ts`: the all-mode sweep
  printed `OK, no hits` and exited **0**, `--staged` after `git add` did the same, and naming the
  target explicitly exited **1** with both hits. The payload was always detectable; the two sweeping
  routes never looked at it.
  Two mechanisms. `walk()` enumerates `Dirent.isFile()`, an lstat answer, so a link is neither a file
  nor a directory and fell out of the loop in silence, and `isDirectory()` is an lstat answer too, so
  a linked **directory** took a whole subtree with it (measured, exit 0). `--staged` reads content
  with `git show :<path>`, and git stores a link as its **target path** under mode `120000`, so that
  route was handed path text rather than the target's bytes. That route is this package's pre-commit
  hook, and it is where the FHIR-aware structured scan runs: a link staged at
  `test/__fixtures__/patient.json` was handed path text, failed `JSON.parse`, and fell through to the
  conservative pass over the path.
  **Neither route follows the link.** Following would read bytes the enumeration does not control
  (outside the repo, a loop, a device, a FIFO that blocks the gate forever), and git does not carry
  those bytes anyway, so a hit on them would be a claim about something no commit contains. The
  enumeration is narrowed instead: an **enumerated** in-scope entry that is not a regular file
  **refuses the scan** (exit 2), naming **every** offender. "Enumerated" is load-bearing: this
  narrows what each route admits from what that route already lists, and an entry a route never
  lists is not reached by the refusal either. `--staged` reads `git diff --cached --raw -z` so the
  destination mode is visible, and refuses `120000` and `160000` before any read. A refusal names the
  entry's own repo-relative path and an engine-owned kind token, and **never the link target**, which
  is working-tree text that can itself carry PHI.
  **`T` is in the filter, and leaving it out was a one-letter hole.** `--diff-filter=AM` drops
  typechange, so replacing a **tracked** file with a link (`:100644 120000 <sha> <sha> T`) deleted
  the record before any mode was read and the hook passed the link green. Admitting `T` also closes
  the reverse typechange, a tracked link replaced by a real file carrying PHI, which the same letter
  dropped.
  **The scopes are unchanged.** The walk still excludes a gitignored entry, by the same rule that
  already excluded a gitignored file; `--staged` still looks only at `test/__fixtures__/**` and
  `src/**.ts`. This narrows what those scopes admit rather than widening them. A path named
  explicitly on the command line is still followed, deliberately: that is the caller's own request.
  A staged **gitlink** already refused on base, but by way of an uncontrolled `git show` failure
  (`fatal: bad object`) naming no kind; the mode is read first now, so the refusal is the scanner's
  own.
  `test/scripts/phi-scan.test.ts` is new: 30 cases, **14 red on `810eec9`**, each against a throwaway
  git repository. **Disclosed rather than fixed:** a staged **rename** is not enumerated by
  `--staged` at all (`R`/`C` are the only two-path statuses and both are excluded, identical to the
  `--name-only --diff-filter=AM` this replaces), and the cost is not only unscanned content: an
  already-tracked link `git mv`d from outside the scope to inside it is raised `R100` at mode
  `120000` and so never reaches the mode check on that route (measured, identical before this
  change; a _new_ link cannot arrive that way, and the all-mode walk refuses the resulting tree).
  And this package has never carried a sibling's rule refusing an all-mode sweep that observed no
  files. Both are pinned by tests. The
  enumerate-then-read window is left alone on purpose: here a vanished file makes the scan refuse,
  which is the safe direction.

- **The `attw` publish gate exited 0 on a tarball that carried no type declarations
  (`ATTW-FALSE-GREEN-PORT`).** `package.json` ran `attw --pack .`, and
  `@arethetypeswrong/cli@0.18.4`'s `dist/getExitCode.js` opens with `if (!analysis.types) return 0`,
  returning before the problem list is read. So the CLI printed "This package does not contain
  types." and handed its caller a **0**. An untyped npm package is legal, so that is a description
  as far as `attw` is concerned; for a package that ships `.d.ts` files it means the declarations
  were not in the tarball, which is a broken publish reported as a pass. A false red costs an hour;
  **a false green merges.** No `--profile`, `--ignore-rules` or config setting reaches that early
  return, so the fix could not be a different invocation.
  **Reproduced on this package with zero concurrency**, at `edb75df`: `rm -rf dist && pnpm attw`
  and `rm -f dist/index.d.ts dist/index.d.cts && pnpm attw` both printed the sentence and exited 0.
  The second is the state a real build passes through. `tsup` emits the JS bundles in one pass and
  the declarations in a later one, so every build here has an interval where `dist/` holds
  `index.mjs`/`index.cjs` and no `.d.ts`: measured at **1.86 s, 2.03 s, 2.29 s and 2.46 s** over
  four clean builds (mtime of `dist/index.d.ts` minus `dist/index.mjs`). Concurrency only supplies
  the condition, so this is **not** answered with a lock, a lease or a build queue. The gate has to
  be able to report that its own inputs were missing, whatever removed them.
  **`attw` is now `node scripts/attw.mjs`**, a wrapper ported from `@cosyte/terminology` with two
  nets. A **preflight** requires every relative artifact path `package.json` promises (`main`,
  `module`, `types`, `typings`, and every string leaf of `exports`) to exist and be non-empty before
  `attw` runs, and names the missing file; a **post-check** promotes an untyped report to a failure,
  which is what catches declarations that are present on disk but excluded from the tarball by
  `files` or `.npmignore`. The preflight reads the four top-level keys in either legal spelling,
  with or without a leading `./`. The post-check reads a printed string, so the routes that hide
  that string are refused wholesale by option name: `--quiet`, `--format`, `--config-path`, and an
  `.attw.json` setting `quiet` or `format`. That takes two arms rather than a name match, because
  commander also accepts a short option's value attached to it and short booleans bundled ahead of
  that, so `-fjson` and `-Pfjson` mean `--format json` and carry no `=` to split on. All six
  spellings were measured to restore the exact false green here. Everything else, including
  `--profile` and `--ignore-rules`, is forwarded unchanged.
  **`test/scripts/attw-gate.test.ts` pins both nets against the real binary, and pins the upstream
  exit 0 itself**, so an `attw` upgrade that fixes the exit code or rewords the sentence reds the
  suite rather than letting the net go slack. It also holds a negative control (the wrapper is
  transparent on a well-formed package) and asserts that a genuine `attw` failure still fails with
  `attw`'s own status. Reverting the script to the bare invocation reds **15 of its 24 cases**.
  **No library code changed**, and no public API moved. This is a packaging gate only.

- **Prose written beside a capitalized child of a narrative `<div>` was DESTROYED with zero
  diagnostics under `valid: true` (`FHIR-UNPLACEABLE-SHAPES`).** `<div xmlns="…xhtml">Take 5 mg<BR/></div>`
  read as a contained `BR` **resource**: the div's own text was never inspected once the child was
  taken, so "Take 5 mg" was gone, the reading raised **no issue at all**, `validateResource` returned
  `valid: true` with zero findings, and the writer re-emitted the `<div>` stripped of the XHTML
  namespace so the re-read came back clean. Uppercase element names in a narrative are not exotic:
  HTML-4-era generators emit `<BR>`, `<TABLE>`, `<P>`, and a medication narrative is exactly where a
  dose is written. It happened identically for every spelling of the XHTML namespace, and for a
  document that declares none.
  **The cause was a FHIR-vocabulary heuristic applied to XHTML.** The reader unwraps a
  resource-valued element (`<contained><Patient>…</Patient></contained>`) by testing whether its one
  child's name is UpperCamelCase, which is how a FHIR resource type is spelled. The content of
  `Narrative.div` is XHTML, where that test means nothing: `<BR/>` and `<br/>` are the same element,
  and neither is a resource. **The narrative is now recognised before the resource-valued unwrap**,
  so its full XHTML content reaches `Narrative.div` under every spelling and round-trips with the
  namespace it was written in. Nothing is shadowed by the order: `div` names exactly one element in
  R4, the only one of the 7,696 element paths in `profiles-types.json` + `profiles-resources.json`
  whose name is `div`. **No field is added to the model** (the narrative was already an opaque
  string) and no walker gains an edge.
  **The yardstick is the same document spelled the other way, not the previous release, and it is
  the same distinction the prefixed-narrative fix turned on.** Reading a narrative as a narrative
  necessarily stops modelling its insides as FHIR, so a `<modifierExtension>` written inside one the
  reader used to model as FHIR no longer draws `UNHANDLED_MODIFIER_EXTENSION`, and such a document
  reads `valid: true` where it read `valid: false`. That finding existed only because `<Table>` was
  read as a FHIR resource type; the lowercase twin has read `valid: true` all along, and nothing
  inside `Narrative.div` is a FHIR modifier extension. **Measured over 396 twin pairs** (every shape
  that has a spelling the reader already recognised, at every element position of every XML fixture):
  this release's reading of the newly-recognised spelling equals the previous release's reading of
  the twin in **394**, in **2** it raises one _additional_ warning (`MIXED_XML_SPELLING`, that fixture
  already carrying a narrative, so the document then holds two spellings of one element), and in
  **0** is it weaker.
  **The same silent destruction reached through the elements that genuinely do wrap a resource is now
  reported.** `<contained>Take 5 mg<Observation>…</Observation></contained>` discarded the character
  data beside the child with no diagnostic; it draws `UNEXPECTED_XML_CONTENT` at that element now,
  and only where that position was otherwise silent, so it never doubles a report the previous
  release already made there. That is a property of this one site, not of the code: an element that
  is both in another vocabulary and carrying character data still draws the code twice at one
  expression elsewhere, exactly as it did before.
  The text is still **not** preserved there: there is no slot on the model for it, and minting one is
  a separate decision. **`UNEXPECTED_XML_CONTENT`'s own documentation is corrected to match**: it
  reports two different observations, and only the vocabulary one preserves anything. Character data
  written directly on a FHIR element is **dropped at every position it can appear**, because a FHIR
  element carries its value in the `value` attribute, and the guarantee on offer is that the drop is
  not silent. The previous text said the content survived, which was never true of that half.
  **Differential against the previous release over 1,195 documents**, both trees in one process
  (every XML fixture × 27 narrative and resource-wrapper shapes at every element position): 560
  readings moved. **0** go `valid: true` to `false`, **0** lose a retraction, **0** lose a negation,
  **0** newly throw, **0** emit XML that no longer re-reads, and **0** outputs are shorter in either
  format. Of the **16,036** leaf values the
  previous release read, **0** are missing here; 520 are no longer separate leaves because they now
  sit inside the opaque narrative string that carries the subtree they came from, verified by
  containment rather than assumed. 32 documents go `valid: false` to `true` and 36 go
  `safeToSummarize: false` to `true`; **all** are the modifier-extension shape above. 280 read
  diagnostics disappear (240 `UNEXPECTED_XML_CONTENT`, 40 `UNKNOWN_PROPERTY`) and every one is the
  previous release complaining about content it was mis-modelling inside a narrative it then
  destroyed; 120 are gained. 36 validation findings disappear, all the same shape. What it buys: of
  the 836 documents carrying a narrative, the previous release preserved it in **318** and this one
  preserves it in **758**; the remaining 78 are two shapes neither release recovers, both unchanged
  here: a `<div>` written beside a `value` attribute, which the reader discards whole under
  `UNKNOWN_PROPERTY`, and an uppercase `<DIV>` wrapper, which is a different expanded name.
  The 27 JSON fixtures read **identically**.
  **The harness is committed this time** (`pnpm differential:read`), so every number above can be
  re-derived rather than taken. It materializes `src/` at any ref into a temp directory, imports it
  alongside the working tree in one process, re-reads what each tree emits rather than only what it
  was given, and refuses to report if its own tallies do not reconcile, if the corpus was not built
  from this package's fixtures, or if the base tree it loaded does not behave like base.
- **A narrative written with a namespace prefix was DESTROYED, and the resource still read
  `valid: true` (`FHIR-UNPLACEABLE-SHAPES`).** `Narrative.div` is the patient-facing prose of a
  resource: the human-readable account a clinician reads when nothing else in the document is
  understood. XML lets the XHTML namespace be bound to a prefix as legitimately as it lets it
  be the default. The reader recognized the narrative by the literal spelling `div`, a test a
  prefixed tag can never satisfy, so `<h:div xmlns:h="http://www.w3.org/1999/xhtml">` was treated as
  content from a foreign vocabulary: read as an empty element, or, when it held only text,
  **dropped from the model entirely**. Nothing in the resulting reading said so: the two warnings
  it drew were both at a `<withheld>` location that did not even name the position, and
  `validateResource` returned `valid: true` with zero findings. The re-emitted XML carried `h:`
  bound to nothing, so the output was not well-formed XML at all.
  **The narrative is now recognised by its expanded name**, `{http://www.w3.org/1999/xhtml}div`
  (Namespaces in XML 1.0 §6.1), under every spelling, so a prefixed narrative reads as the identical
  document written with a default `xmlns` reads, to a model differing only in the narrative string's
  own spelling. The one documented exception is **louder, never quieter**: a document holding the
  narrative under both spellings at once is one element written twice, so it draws
  `MIXED_XML_SPELLING` where the all-default twin draws nothing. It is the
  one element FHIR _requires_ in a namespace other than its parent's, and it is the only place a
  resolved local name is taken from a namespace other than the parent's: the namespace is compared
  against a single fixed URI, and what the reader does with the result is carry an **opaque string**,
  never model FHIR structure from it.
  **What that separates, stated at the width of the code and no wider.** Like every other name rule
  in this reader, it separates only a spelling that carries a **prefix**: a `<v:div xmlns:v="urn:vendor">`
  keeps its tag and cannot reach `Narrative.div`. An **unprefixed** `<div xmlns="urn:vendor">` is
  spelled exactly like the FHIR one, so it reaches the narrative slot rather than being separated,
  exactly as it did before namespaces were resolved at all: carried there and reported
  `UNEXPECTED_XML_CONTENT`. That is unchanged here and is not a claim this release makes go away.
  **The string a narrative is carried as now includes the namespace declarations it inherited.**
  `Narrative.div` is a self-contained XHTML fragment, and lifting an element out of the document
  that declared its namespaces leaves a fragment whose prefixes bind to nothing. Only bindings the
  fragment actually uses and does not itself declare are added, and only with the URI that was in
  scope where the document wrote the element, so nothing is invented; a prefix nothing binds is left
  exactly as written. The document's own spelling is preserved rather than rewritten to the default
  form, so a prefixed narrative is namespace-**equivalent** to the default spelling and not
  byte-identical to it. This also repairs the same broken-fragment defect for an _unprefixed_
  narrative that used a prefix declared on an ancestor. One escaper serves the element's own
  attributes and the added declarations, because a namespace URI can carry a `<` (the raw reader
  refuses a literal one but decodes `&lt;`), and the writer emits this string verbatim.
  **The yardstick is the same document spelled with a default `xmlns`, not the previous release, and
  that distinction decides the whole change.** Carrying the element as a string necessarily stops
  modelling anything inside it as FHIR, so findings the reader used to raise from in there go: a
  `<modifierExtension>` written inside a prefixed narrative no longer draws
  `UNHANDLED_MODIFIER_EXTENSION`, and such a document reads `valid: true` where it read `valid: false`.
  Those findings existed only because a prefixed narrative was not recognised as one; the unprefixed
  twin has read `valid: true` all along, and nothing inside `Narrative.div` is a FHIR modifier
  extension. **Measured, not argued: over 176 documents carrying a prefixed narrative (every XML
  fixture, four narrative shapes at every element position), this release's reading of the prefixed
  spelling equals the previous release's reading of the default-`xmlns` twin in 172, and in the other
  4 it raises one _additional_ warning (`MIXED_XML_SPELLING`, because that fixture already carries a
  narrative, so the document then holds two spellings of one element). In none of the 176 is the
  reading weaker.**
  **Differential against the previous release over 941 documents**, both trees in one process, every
  walker at every node (every XML fixture × twenty-one mutations at every element position, plus ten
  adversarial documents covering the safety spine): 446 readings moved. **0** lose a retraction, **0**
  lose a negation, **0** newly throw. Of the **5,699** leaf values the previous release read, **0** are
  missing here; 2 are no longer separate leaves because they now sit inside the opaque narrative string
  that carries the subtree they came from, verified by containment rather than assumed. 32 documents go
  `valid: false` to `true` and 36 go `safeToSummarize: false` to `true`; **all** are the shape above, and
  in **all 32** the previous release already read the default-`xmlns` twin as `valid: true`. 160 outputs
  are shorter, and **156 are byte-verified as nothing but a prefixed property name resolving to its local
  name** (`"h:div"` to `"div"`); the other 4 are that plus two spellings of one element grouping into a
  single property, both values kept in order and `MIXED_XML_SPELLING` raised. 656 read diagnostics
  disappear and **all 656 are at a `<withheld>` location**, never at one that resolves; **480** of those
  are on documents where the narrative is now kept, and the other **176** are on documents where it is
  not, because they are the capitalized-child shape the entry above recovers and the warning that
  goes was about the element's vocabulary rather than its prose. 40 validation findings disappear: 36 the
  `UNHANDLED_MODIFIER_EXTENSION` shape above, and 4 where two spellings of the narrative at a resource
  root drew one `UNKNOWN_ELEMENT` per property and now draw one per element, because they are one element
  written twice, with `MIXED_XML_SPELLING` raised so the widened count is not silent. **752 read
  locations and 104 validation locations improve from `<withheld>` to a resolvable expression; none
  worsens.** What it buys: of the 836 documents carrying a narrative, the previous release preserved it
  in **278** and this one preserves it in **478**. The 27 JSON fixtures read **identically**: no
  JSON-reader behaviour is touched, and no field is added to the model.
  **What this half deliberately did not recover, and what happened to it.** A `<div>` holding
  exactly one capitalized child (`<div xmlns="…xhtml"><Table>5 mg</Table></div>`) was still read as a
  contained `Table` **resource** and lost its prose, and prose written _beside_ such a child was
  destroyed with **zero** diagnostics: that reordering is a separate decision with its own blast
  radius, and it is the entry above, made and measured on its own terms rather than folded in here.
  A foreign child of a valued primitive is still discarded whole under `UNKNOWN_PROPERTY`
  (`PRE-EXISTING`, pinned by a test), so a narrative written there is still lost.
- **The XML reader did not resolve namespace prefixes, so a prefixed FHIR document was misread
  whole (`FHIR-READER-RESIDUALS`).** FHIR XML is defined in the `http://hl7.org/fhir` namespace, and
  XML lets a document bind that namespace to a prefix rather than making it the default, so
  `<f:Patient xmlns:f="http://hl7.org/fhir">` and `<Patient xmlns="http://hl7.org/fhir">` are the
  same resource. The reader modeled the raw tag, so the first read to properties literally named
  `f:active` under a `resourceType` of `f:Patient`. The reader now tracks the in-scope declarations
  as it descends (including a prefix rebound partway down and the implicit `xml` binding) and models
  the **local** name.
  **A prefix is dropped only for an element in its parent's namespace.** An expanded name is a
  namespace _and_ a local name (Namespaces in XML 1.0 §6.1), so `{urn:vendor}code` and
  `{http://hl7.org/fhir}code` are different names.
  **Every element the reader MODELS is tested once for being in a namespace other than its parent's,
  and reported `UNEXPECTED_XML_CONTENT` when it is; that report, not the name, is what covers the
  unprefixed case.** A **prefixed** one
  additionally keeps its tag exactly as written, and since no FHIR element can be spelled `v:code`,
  that is what stops it joining a FHIR element's occurrences, being promoted into a primitive's
  `extension`, being unwrapped as a contained resource, or being stored as `Narrative.div`.
  **Foreign content reached by a _default_ declaration has no prefix to keep, so it does all four.**
  `<extension xmlns="urn:vendor">` is spelled exactly like the FHIR `extension` and is modeled as
  one; it is reported, not separated. That is unchanged from before prefixes were resolved at all, so
  it is a residual of the lenient read and not a regression, and the scope of the separation is
  stated here rather than claimed wider than it is.
  **Two limits of "every element the reader models", both unchanged from the previous release.** A
  child element written beside a `value` attribute is not modeled at all: it is discarded whole and
  reported `UNKNOWN_PROPERTY`, so a foreign one there draws no namespace report. And a narrative
  `<div>` written with a prefix is not read as `Narrative.div` at all, so the narrative text is not
  carried; only the unprefixed spelling is. **That second limit is closed by the narrative entry
  above; the first is not.**
  **Measured over the package's seven XML fixtures, each re-spelled with a prefix and compared to the
  default-namespace original** on the full read: issues, serialized JSON, re-emitted XML, validity
  and findings, safety readout. **Before: 0 of 7 read identically. After: 7 of 7.**
  Three consequences worth naming separately, all measured on `patient.xml` re-spelled with a prefix.
  A **primitive extension was silently dropped**, because `<f:extension>` did not match the reader's
  `extension` test, taking the serialized JSON from **337 bytes to 216**. The re-emitted XML was
  **not well-formed**: the reader wrote the raw names back while declaring a default namespace,
  producing `<f:Patient xmlns="http://hl7.org/fhir">` with `f:` bound to nothing. And the document
  validated `valid: true` on a reading in which no element had been recognized at all, which is a
  false green; it now reports the same findings as the identical unprefixed document.
  **The safety consequence, stated plainly:** a prefixed `Observation` carrying
  `status="entered-in-error"` read `status: undefined`, `retracted: false`, `isRetracted: false`.
  It now reads the retraction. A prefix bound to a namespace that is not the FHIR one, and a prefix
  no declaration in scope binds, are both flagged `UNEXPECTED_XML_CONTENT`; an unresolvable prefix
  keeps the tag exactly as written rather than guessing a binding for it. A namespace declaration is
  no longer reported as an unknown attribute, which retires a false positive on the legal
  re-declaration of the namespace an element is already in. An **unprefixed** narrative `<div>` is
  expected in the XHTML namespace and is not flagged for being there.
  **What reading a document correctly costs, stated rather than left to be found, and now reported.**
  Two prefixes bound to one namespace are two spellings of one name, so an element written twice that
  way is the repeat it genuinely is; the model and every verdict over it match the same document
  spelled one way. What changes is the **count**, and a check that reads a `0..1` element as a single
  value gets nothing from a repeat. Measured: a `Reference.reference` written under two spellings
  loses the `REFERENCE_UNRESOLVED` its one-spelling twin raises. So that element now carries new
  `ISSUE_CODES.MIXED_XML_SPELLING` (warning) with a `mixedXmlSpelling` factory, raised once per
  element, never per occurrence, and only where a group actually holds more than one spelling.
  Nothing is lost and the reading is the correct one; the code exists so that a widened count is
  never silent. At safety-scoped elements the repeat is additionally reported
  (`ARRAY_WRAPPED_SCALAR`, error), so a retraction written through a second spelling is **caught**
  where a raw-tag read missed it entirely.
  **Differential against the previous release over 564 documents** (every XML fixture, six mutations
  at every element position: a FHIR-prefixed and a foreign-prefixed and a foreign-default-namespace
  duplicate sibling, and the element itself re-spelled into each of those three): 468 read
  differently, and of those **0** go `valid: false` to `true`, **0** go `safeToSummarize: false` to
  `true`, **0** lose a retraction, **0** lose a negation, and **0** newly throw. 32 diagnostics
  disappear and **all 32** are at a `<withheld>` location, which is the previous release complaining
  about a name like `f:active` that it could not resolve and this one reads correctly; **0** disappear
  at a location that resolves. The seven fixtures unmutated read **identically** on both.
- **The JSON reader emitted English prose inside a FHIRPath `expression` (`FHIR-READER-RESIDUALS`).**
  Two locations were built as `Patient.name (unexpected _-sibling on an object)` and
  `Patient.contact (unexpected _-sibling on a non-primitive array)`. R4 defines
  `OperationOutcome.issue.expression` as a FHIRPath subset that resolves to a node, so a sentence
  there is a conformance defect and not a cosmetic one: a consumer evaluating it gets a parse error.
  The reason a finding was raised is what the `code` field is for, so the reason moved there. New
  public `ISSUE_CODES.MISPLACED_PRIMITIVE_EXTENSION` (warning) with the factory
  `misplacedPrimitiveExtension`, raised at the bare location of the element (`Patient.name`,
  `Patient.contact`). It is a **new code rather than the previous `UNKNOWN_PROPERTY`** because the
  two make different promises: `UNKNOWN_PROPERTY` says a shape was tolerated and nothing was lost,
  and these two positions discard the `_`-sibling whole. A consumer matching on `UNKNOWN_PROPERTY`
  at those two positions must match the new code instead. `test/expression-grammar.test.ts` is the
  gate that keeps prose out, sweeping every reader diagnostic the JSON and XML corpora produce
  against a location grammar; it admits, rather than papers over, the two forms that are deliberately
  not resolvable FHIRPath: a `<withheld>` segment, and the XML reader's `.@name` attribute form.

- **A name the document supplied reached a diagnostic location unbounded (`PHI-WARNING-MESSAGE-LEAK`,
  the `fhir` slice).** A finding carries a FHIRPath `expression` instead of a value, and that
  expression is assembled out of the document's own `resourceType` and its own JSON property names.
  On a conformant resource those are element names, which is why the value-free-diagnostics contract
  reads as satisfied. On anything else they are whatever the sender wrote, at whatever length.
  Measured on two documents, each named so the numbers are re-derivable. With a 1,000,000-byte
  property name, `{"resourceType":"Patient","<1e6 b>":[["x"]]}`, the longest `expression` went from
  **1,000,011 bytes to 21**. With a 1,000,000-byte type, `{"resourceType":"<1e6 b>","status":"final"}`,
  the serialized `OperationOutcome` went from **1,000,222 bytes to 232** and
  `SafetyReadout.resourceType` from **1,000,000 to 10**. The ecosystem audit
  classified this package **prevented by construction** on the strength of `diagnosticFor(code)`
  taking no value parameter, and that stays true: this is the one gap it named.
  **The bound is a shape test, not a truncation**, because truncating still emits the first N bytes
  of whatever was there. A name is echoed when it matches the published form it claims
  (`elementdefinition.html` `eld-19`, a Rule, caps a path segment at 64 characters; `eld-20`, a
  Warning, gives the two alphanumeric arms), and is replaced by a fixed marker otherwise. The
  resource-type arm is tighter than `eld-20`'s and the tightening is **measured**: all 148 codes in
  the R4 `resource-types` code system are letters only with an initial capital. The element arm is
  measured too, against R4's own definitions: of the 1,423 distinct non-root segments in the 7,696
  element paths of `profiles-resources.json` and `profiles-types.json`, the only 74 that fail it are
  `choice[x]` _definition_ spellings, whose stems all pass and which are never JSON property names.
  **Every conformant document reports exactly the locations it reported before**, which is why the
  759 pre-existing tests were untouched by the change.
  **Three things it does not do, each stated rather than glossed.** First, a shape test cannot tell
  a real element name from a forgery shaped like one, so such a forgery is still echoed; the claim
  to make is that the echo is bounded rather than that a location carries no document content, and
  that residue is pinned by live tests. Second, **`FhirComplex.properties[].name` is deliberately left exactly as
  written**, which is the one place the model-level lesson from `hl7`/`deid` does not transfer:
  those names are document content the writer reproduces byte for byte, so bounding them would be
  data loss rather than redaction, and a consumer that builds its own location out of the model
  inherits that. The one derived identifier the model does surface, `SafetyReadout.resourceType`,
  **is** bounded. Third, the four low-level location functions (`unhandledModifierExtensions`, `shadowedProperties`,
  `arrayWrappedScalars`, `nestedArrays`) take their root prefix as a **parameter**, so a caller that
  hands one an unbounded string gets it back in the locations. That is caller-supplied input, not
  document-derived, and bounding it would break a caller legitimately rooting at a Bundle entry.
  `readSafety` and `validateResource`, the two entry points that read the prefix off the document
  themselves, bound it.
  **One behaviour moves on a non-conformant document, and it is stated rather than found later.**
  Two sibling elements whose names both withhold now share a location, so `nestedArrays()` collapses
  them into one entry, exactly as it already collapses a repeated name. No verdict moves:
  `safeToSummarize` stays `false` and the resource stays `valid: false`. Pinned by a test.
  **Measured red on `origin/main` before the fix existed**, one slot at a time because the shared
  runner aborts on the first violation: **13 of 13 declared slots and 7 of 7 name sentinels**. The
  thirteen slots cover **twelve** distinct positions: two of them reach the expression root through
  different document shapes. The bound is also applied at two sites where it is provably the
  identity (the terminology layer's root, reachable only once a binding matched, and the dose root,
  computed after the non-medication early return); they are kept as defensive calls and are named as
  such in the source rather than counted as covered positions. The
  audit's finding about this package's own PHI suite is why the slots exist at all: it swept only
  leaf _values_, so no sentinel it planted could ever land in a name, and a green run said nothing
  about the one string that reaches an `expression`.

- **An array inside an array lost its contents, and the writer then invented an element there
  (`FHIR-NESTED-ARRAY-PRESERVATION`).** FHIR JSON uses an array for a repeating element and for
  nothing else (json.html §2.6.2.2), so a list of lists is not an element and the reader has nothing
  to make of it. `FHIR-NESTED-ARRAY-REPORTING` closed the affirming half: such a position can no
  longer sit under a clean verdict. **The data loss itself was untouched, and this closes it.**
  `[["x"]]` dropped the inner value outright, against the package's stated no-data-loss claim, and
  the writer emitted `[{}]` for the empty element the model held, fabricating an object the sender
  never wrote and laundering the finding away on a re-read.
  **The array's exact JSON text is now preserved on the node** and handed back by the new
  `nestedArrayContent()`, per JSON channel (`value` / `metadata`), because a repeating primitive can
  nest in its value array, in its `_`-sibling array, or in both at one position. New model fields
  `FhirComplex.nestedArraySource`, `FhirPrimitive.nestedArraySource`,
  `FhirPrimitive.nestedArrayMetaSource`; new exported types `NestedArrayChannel` /
  `NestedArrayContent`. A decimal inside a preserved array keeps its exact lexical text, so ADR 0001
  holds at a position the model cannot place. `serializeResource` writes the array back, and
  `nodesEquivalent` compares the preserved text, so two documents that nested _different_ content are
  no longer equivalent. The preserved text is the array re-rendered compactly (member order, repeated
  keys and every number's exact source survive; insignificant whitespace does not, and strings are
  re-escaped canonically), so it is **value**-exact rather than byte-exact. Such output is
  deliberately **not** spec-clean, and the public doc comments on `serializeResource` plus the
  README's Postel's-Law bullet are corrected to say so rather than claim spec-clean output
  unconditionally.
  **The preserved content is text, not an element, and that is the whole design.** Two graded
  attempts to model the inner array were REFUTED, both because modelling it made it transparent to
  every walker: one erased a true `VITAL_SIGN_UNIT_NONCONFORMANT` and asserted `noKnownAllergy: true`
  over a record naming an allergen, the other retired an `error`-severity profile invariant. A string
  carries no edge in the node graph, so no walk can reach it. **That is now a gating test rather than
  an argument** (`test/model-edges.test.ts`): the model's edge set is derived mechanically from the
  three interfaces that make up `FhirNode`, which is a closed union, so the enumeration cannot miss a
  case; it comes back as exactly four node-valued members (`FhirComplex.properties`,
  `FhirComplex.duplicates`, `FhirList.items`, `FhirPrimitive.extension`), the preserved fields are
  typed `string`, and a census of the whole of `src/` pins which files may touch them. Adding a
  node-valued field to the model now fails a test instead of silently redefining what a repeating
  element contains.
  **The audit the founder asked for, since it is the deliverable and not the evidence, measured at
  `b2c5ee7`:** 57 `.items` sites across 21 files, of which 5 are `RawArray` not `FhirList`; 3 flatten with no kind check at
  all (`profiles/validate-profile.ts::occurrencesOf`, `validate/validate.ts::occurrences`,
  `quantity/dose.ts::asItems`, the first two counting a nested list as exactly **one** occurrence for
  `CARDINALITY_MIN`/`MAX`); 21 check the kind and then **silently drop** what is not the kind they
  expect, ten of those toward a false `valid: true` (`validate/safety.ts` obs-7,
  `profiles/invariants.ts`, `validate/terminology.ts`, `validate/quantity.ts`, `safety/codes.ts`,
  `safety/status.ts`); and exactly one fails closed (`safety/status.ts::checkModifierExtension`).
  Nothing in `src/` constructs a list whose items hold a list, and this change does not start: that
  is what makes all 57 sites unaffected, and it is asserted rather than argued. This change itself
  adds two sites under the same count: one `RawArray` (`codec/raw-json.ts::rawJsonText`) and one
  inside a JSDoc `@example` on `nestedArrayContent`, which flattens nothing. Those counts are a
  snapshot, and the conclusion is carried by `test/model-edges.test.ts` rather than by them.
  **Two more fixes in the same mechanism.** The writer **dropped a `resourceType` it could not
  hoist** (anything that is not a string primitive), silently losing whatever the sender wrote at the
  loudest position in the document; it is now emitted through the ordinary path, so it keeps its
  position rather than being hoisted, which the `@returns` on `serializeResource` now states. And the
  reader names
  a primitive's `id` / `extension` metadata in **FHIRPath form at every depth** (`birthDate.id`,
  `birthDate.extension[0].url[0]`) rather than the JSON encoding's `_`-prefixed form, so a read
  diagnostic and a safety location for the same position are the same string. That replaces the
  single-call-site path override `FHIR-NESTED-ARRAY-REPORTING` left behind with one convention for
  the whole reader; 25 distinct diagnostic expressions change shape, none is added or removed.
  **Left open, deliberately, each pinned by a test rather than a sentence:** (a) a scalar written
  beside a nested array in the same array (`"given":[["Peter"],"James"]`) lands where an object was
  expected and is still dropped. It is a different unplaceable shape (a scalar where a complex
  belongs), it reproduces identically without this change, and closing it needs a second preserved
  form with its own public surface. (b) A `_`-sibling the reader discards **whole** still leaves no
  node to carry either the marker or the text, so the five shapes pinned by
  `FHIR-NESTED-ARRAY-REPORTING` are unchanged.
  **Measured against `b2c5ee7` over 2,622 documents** (every JSON fixture x one mutation per path per
  mutation kind, plus a hand-built corpus), both source trees loaded into one process and every
  walker exercised at every node: **0** read diagnostics lost, **0** validation findings lost, **0**
  `valid: false -> true`, **0** `safeToSummarize: false -> true`, **0** negations or retractions
  lost, **0** locations lost from any location list, **0** documents that newly throw. The only
  walker whose output moved is `readObservationValue`, in 43 documents, and only because its
  pass-through `node` field echoes the inert marker: 0 differ once the marker is stripped and 0
  differ in any value it reads. Every serialization change is accounted for: 982 documents carrying a
  nested array, 128 carrying a `resourceType` the writer used to drop, **0 from any other cause**,
  and **0 outputs got shorter**. Of the 982, **all 982** laundered the finding away on a write and a
  re-read before this change and **0** do now, with 875 written back byte-identical to the input.

- **An array inside an array was affirmed over, so a refuted allergy, a resolved condition and a
  whole resource inside a `Bundle.entry` all read back clean (`FHIR-NESTED-ARRAY-REPORTING`).**
  FHIR JSON uses an array for a repeating element and for nothing else (json.html §2.6.2.2), so a
  list of lists has no meaning at any position. The reader does not model the inner array, so content
  the sender wrote is genuinely missing from the model there, and **the model then looks exactly like
  an element the sender legitimately left out**, which is what let an affirmative verdict be computed
  over it. Measured on `main` at `8a5245a`: a **refuted** `AllergyIntolerance` and a **resolved**
  `Condition` whose coding sat one level down inside a `CodeableConcept` both read `valid: true`,
  `safeToSummarize: true`, `negations: []`; an entire resource inside a `Bundle.entry` disappeared
  with the same clean verdict; and a nested array inside a primitive's `_`-sibling drew **no
  diagnostic at all**. Pre-existing, declared as a gap by both preceding array slices.
  **This is the reporting half of the item, split from the preserving half by founder decision**
  after the conformance gate refuted the combined change twice. New `ISSUE_CODES.NESTED_ARRAY`
  (warning, on the read), `VALIDATION_CODES.NESTED_ARRAY` (**error**, in `validateResource`),
  `SafetyReadout.nestedArrays` + `nestedArrays()` (public, mirroring `shadowedProperties` /
  `arrayWrappedScalars`), `isNestedArray()` on the model, and `safeToSummarize: false` with
  `assertSafeToSummarize` throwing.
  **The rule needs no cardinality table and no element list**, unlike the two array rules before it,
  because the shape is meaningless at _every_ position rather than at some of them, so it cannot fire
  on a conformant document and it runs at every position the model has a node for, at every depth: a
  primitive's `extension` metadata, a `contained` resource, a Bundle entry, and a member a repeated
  property name shadowed.
  **It is bounded by what the reader modeled, and that bound is stated rather than implied**, because
  the conformance gate refuted an earlier draft of this change for documenting the rule as total when
  it is not. A `_`-sibling the reader discards _whole_ because it is misplaced or unrecognised (one
  sitting on an object or a non-primitive array, or a member of a `_`-sibling object that is neither
  an `id` _string_ nor an `extension` array) leaves no node to report against, so an array inside
  one draws the
  unexpected-property warning for the discarded sibling and no refusal. That behaviour is unchanged
  from before this slice; what changed is that it is now stated on every public surface and pinned by
  a test. Both report channels also name the same FHIRPath position where the nested array is the
  element or is the extension item itself, including inside a primitive's `extension` metadata where
  the reader's older warnings use a `_`-prefixed path that is not FHIRPath. One level _inside_ an
  extension the older convention is back on the reader's path, so the two channels name that position
  with two different strings; neither is silent and neither is wrong, and the residual is pinned by a
  test rather than described, because the durable fix is one path convention for the whole reader.
  **The inner array is still not read, and that boundary is the whole point of the split.** A list
  holds exactly the items it held before, of the same kinds, with the same contents, so nothing that
  walks a repeating element sees anything new: `codingsOf`, the FHIRPath engine, the profile path
  navigator and the terminology walker behave exactly as they did. Modeling the inner array is what
  refuted the combined attempt twice, because at least nine sites flatten a list into its items
  without distinguishing a nested one, so producing a nested list silently redefines what a list means
  for every consumer in the package. The preserving half is deferred as
  `FHIR-NESTED-ARRAY-PRESERVATION` and **is not shipped here**.
  **No existing finding is suppressed**, which is the direction that matters when a safety fix adds a
  diagnostic: the `UNKNOWN_PROPERTY` warning the reader already raised at those positions is kept, and
  the new code is raised **alongside** it, never instead of it. Differential over **1,639** documents
  (every JSON fixture, one mutation per path per mutation kind, plus a hand-built element-level corpus
  covering the `CodeableConcept` **element** and not only its members, which is what the previous
  attempt's own corpus missed): **0** read diagnostics lost, **0** validation findings lost, **0**
  `valid: false -> true`, **0** `safeToSummarize: false -> true`, **0** negations / retractions /
  no-known-allergy reads lost, **0** locations lost from `unhandledModifierExtensions` /
  `shadowedProperties` / `arrayWrappedScalars`, every convenience field identical, and all 1,639
  documents serialized byte-for-byte identically. What it bought: **819** documents now report the
  shape, of which **626** were previously `valid: true`, **694** were previously
  `safeToSummarize: true`, and **24** previously read with zero diagnostics of any kind.
  `nodesEquivalent` now compares the marker, so the cross-format oracle can no longer call a lost
  element the same as one that really was empty; that can only ever return `false` where it returned
  `true`, and only for a document carrying the shape.
  **Known limitation, pinned by a test rather than described:** the writer emits the empty element the
  model holds, so a write and a re-read produce a clean document. That laundering belongs to the
  preserving half; the complaint is on the read, which is where a consumer of a document they did not
  write sees it.
- **An array around a `Coding.system` / `Coding.code` _inside_ a `CodeableConcept` was still read as
  absent, and it landed on the three sharpest reads in the library (`FHIR-CODING-SCALAR-WRAPPER`).**
  A **refuted** allergy read as active, a recorded **"no known allergy"** read as an allergy _to_
  SNOMED `716186003`, and a **retracted** Condition read as live. `Coding.system` and `Coding.code`
  are `0..1` (datatypes.html), so a generic XML-to-JSON converter array-wraps them exactly as it
  wraps the element above them, and `codingsOf` read them with the single-value `primitiveString`.
  `FHIR-ARRAY-WRAPPED-SCALAR` closed the element-level wrapper and declared this one a gap after the
  conformance gate refuted two attempts at it; this is the follow-up slice it named. Pre-existing,
  reproduced on `main` at `14397bf`.
  **The read now sees through the wrapper, but only where it holds exactly one array position.** That
  restriction is the safety property, not caution. These two values feed `codingsOf`'s `system` x
  `code` **cross-product**, so any rule yielding more than one value on either side pairs a `system`
  the sender wrote in one position with a `code` it wrote in another and **asserts a coding the sender
  never wrote**, and one coding matched there is the recorded "no known allergy", a **positive
  clinical assertion**. Missing a retraction withholds information; asserting an absence of allergy
  does not, so the two directions are not equally safe. **At most one value per written member**
  satisfies both: the cross-product keeps exactly the arity it had when a wrapper read as `undefined`,
  so unwrapping can only fill in a value and can never add a pair. Stated as the property the tests
  pin, a single-position wrapper is **transparent**, yielding the same codings as the same document
  with the wrapper removed.
  **"One position" counts array positions, not string values** (this is what refuted attempt two): a
  FHIR JSON `null` in a primitive array is a real position whose value is absent and whose `_`-sibling
  may carry an extension, not padding, so `["716186003", null]` is two positions and is not read.
  **A wrapper that is not read is reported instead, so nothing is affirmed over it.** Every array
  wrapper on a `Coding.system` / `Coding.code` inside a `CodeableConcept`-valued safety element
  (`clinicalStatus` / `verificationStatus` / `code` on a safety resource type) draws an
  `ARRAY_WRAPPED_SCALAR` **error** with its location in `SafetyReadout.arrayWrappedScalars`, and
  `safeToSummarize` is `false`.
  **The read window and the report window are the SAME window, and that is the correctness argument,
  not a scoping detail.** The first revision of this change unwrapped inside `codingsOf` itself, which
  every coding consumer in the library calls, while reporting only the elements above. The
  conformance gate refuted it with a synthetic vital-signs Observation: `requiredUnitsFor` reads
  `Observation.component[i].code`, a backbone element nobody reports, and takes the **first** LOINC
  coding carrying a units entry, so making a wrapped `8867-4` readable let it win over the `8480-6`
  written beside it and a **true** `VITAL_SIGN_UNIT_NONCONFORMANT` error against a `/min` value
  vanished, flipping the document from `valid: false` to **`valid: true` with no diagnostic at all**.
  A false valid is the one direction the fail-safe contract forbids. The unwrap is therefore confined
  to a module-internal read used only for the windowed elements; `codingsOf` and every out-of-window
  coding (`category`, `interpretation`, `referenceRange.type`, `component.code`) keep their previous
  behaviour exactly. Pinned by that document as a regression test.
  **One asymmetry survives on purpose:** the `ARRAY_WRAPPED_SCALAR` location is emitted only on a
  resource of a safety type, while `isRetracted` and the refutation read are not type-gated, so on
  another resource type a wrapped `verificationStatus.coding.code` is read with no location reported.
  Those reads can only **add** a retraction or a negation and no type-scoped verdict is reached there,
  so narrowing the read to match the report would only make `isRetracted` miss retractions it catches
  today. Recorded rather than smoothed over, after the gate measured it. That includes the single-position case that _is_ read, for the same
  reason the element-level wrapper is reported when its value is read: FHIR JSON does not define the
  shape. Without it, a multi-position wrapper would be a negation the library declined to read and
  then affirmed over anyway. Unlike the element level this needs no per-resource cardinality model and
  cannot false-positive, because `Coding` is a datatype whose `system` and `code` are `0..1` wherever
  it appears.
  **One direction worth knowing:** reading a wrapper can now _retire_ an invariant finding the unread
  version emitted (`ait-1`, `con-4`), and in those cases the retired finding was **false**, the sender
  did write the code the invariant asked for. It cannot turn a document `valid`, because the wrapper
  that made the value readable is itself an error on the same `Coding`. **No public API is added or
  changed**, and a conformant document reads exactly as before.

- **An array-wrapped `0..1` element reached the same harm as the duplicate-key defect, with no
  duplicate key at all (`FHIR-ARRAY-WRAPPED-SCALAR`).**
  `{"resourceType":"Observation","status":["entered-in-error"]}` read back `retracted: false`,
  `negations: []`, `safeToSummarize: true`, `valid: true` and an **empty issue list**. FHIR JSON
  writes a `0..1` element as a name/value pair and reserves the array for a repeating element
  (json.html §2.6.2.2), so `primitiveString` asked the list for its string value, got `undefined`, and
  the retraction the sender wrote was never reported. `FHIR-DUPLICATE-KEY-RETRACTION` closed the
  duplicate-key route to that verdict; this route was still open, and the safety claim was only as
  strong as its narrowest hole. Pre-existing, filed by the pass-two refuter on that slice and
  reproduced on `main` at `9c372f2`.
  **This is not an exotic input**, which is why it was queued ahead of the next slice: array-wrapping
  every element is ordinary generic XML-to-JSON converter output, and that is exactly how a C-CDA or
  v2 feed reaches a FHIR surface in practice. In that shape the wrapper sits on `resourceType` too.
  **Three changes, all in the fail-safe direction, none of which touches a conformant document.**
  1. **The negation reads see through the wrapper.** `isRetracted` and every classified negation in
     `readSafety` already ran over _every value written_ for the element they read (the duplicate-key
     fix); they now also read _through an array wrapper_ on each of those values, recursively. The
     convenience fields `SafetyReadout.status` and `SafetyReadout.resourceType` read through it too,
     so they no longer report `undefined` for an element the document plainly carries.
  2. **The type gate is read fail-safe, which also closes the duplicated-`resourceType` sibling.** A
     type-scoped negation (`not-taken`, `not-done`, `no-known-allergy`) is only looked for once the
     gate names the type, so a single-value gate was the narrowest hole in the whole safety claim.
     Both non-conformant shapes reached it: `{"resourceType":["MedicationStatement"],"status":
["not-taken"]}` and `{"resourceType":"Observation","resourceType":"MedicationStatement",
"status":"not-taken"}` each reported `negations: []`. `readSafety` now considers **every** type
     the document names (a new internal `typesOf`); both report `not-taken`. `typeOf` is unchanged
     and still the strict single-value read, because a _structural_ verdict should reject an
     unreadable type rather than guess one.
  3. **The library stops affirming.** A new `ARRAY_WRAPPED_SCALAR` validation code (**error**,
     `structure`) is raised for an array around `resourceType`, or around one of the single-valued
     safety elements (`status`, `clinicalStatus`, `verificationStatus`, `doNotPerform`, `code`), on a
     resource root, so `validateResource` cannot return `valid` for such a document. `readSafety`
     reports the same locations on the new `SafetyReadout.arrayWrappedScalars`, sets
     `safeToSummarize` to `false`, and `assertSafeToSummarize` throws, exactly as for a repeated
     property name. `validateResource` also no longer returns early on an unreadable `resourceType`
     without running the safety layer: it runs it against the type the document names, so an
     array-wrapped type gate no longer draws a bare `RESOURCE_TYPE_UNKNOWN` and says nothing about
     the retraction in the document.
     **The cardinality check is scoped, deliberately and not timidly**, to that closed element set on a
     resource root of a safety resource type (plus `resourceType` on any root). R4 defines repeating
     elements under the same names elsewhere (`Questionnaire.code` and `ElementDefinition.code` are both
     `0..*`), so a name-only, depth-free rule would emit a **false error on a conformant document**,
     which the validator's fail-safe contract forbids. Deciding cardinality anywhere else needs a
     per-resource model, which this library does not have and this layer must not become; that bound is
     pinned by tests rather than asserted in prose.
     **One wrapper is deliberately NOT covered, and it is the same defect one level down:** an array
     around a `Coding.system` / `Coding.code` _inside_ a `CodeableConcept`. Those are `0..1` too
     (datatypes.html), so a negation written inside one is still missed, and no location is reported
     for it. It is left open on purpose rather than by oversight. Unlike the element-level wrapper,
     those two values feed `codingsOf`'s `system` x `code` **cross-product**, so any rule that yields
     more than one value on either side **manufactures a `(system, code)` pair the sender never
     wrote**, and one of the pairs matched there is SNOMED `716186003` "no known allergy", a
     **positive clinical assertion** that would then be made over a record naming an allergen.
     Missing a retraction withholds information; asserting an absence of allergy does not, so the two
     directions are not equally safe and the obvious fix is not obviously right. Two candidate
     predicates were written and both were refuted by the conformance gate during this change, the
     second because it counted strings rather than array positions and a FHIR JSON `null` is a real
     position marker. That read is therefore **unchanged from before this release**, and the bound is
     pinned by test rather than described in prose.
     **Superseded within this same unreleased block by `FHIR-CODING-SCALAR-WRAPPER` (the entry above),
     which closed that wrapper.** This paragraph is kept as written because it records why two attempts
     were refuted and what the third had to satisfy; read it as the statement of the problem, not as
     the shipped behaviour.
     **Behaviour change worth reading before upgrading:** `SafetyReadout` gains a field, and
     `safeToSummarize` is now `false` where it was `true` for these documents. That is the point of the
     fix, but a caller that treats `safeToSummarize` as a gate will now refuse input it previously
     accepted. The codec, the element model, and `parseResource` / `serializeResource` are **untouched**.
     **Two related defects were left alone on purpose**, both pinned by tests so a future change to them
     is deliberate: `readObservationValue` still has no issue channel of its own (it fails safe on this
     route, reporting the present variant and no `quantity`, so no wrong number is handed out), and the
     JSON reader still does not model a _nested_ array (`[["x"]]` reads as a list holding an empty
     object, flagged `UNKNOWN_PROPERTY`; the document is refused, never affirmed).

- **A duplicate JSON property name silently dropped the later value, and `readSafety` then affirmed
  the wrong answer (FHIR-DUPLICATE-KEY-RETRACTION).**
  `{"resourceType":"Observation","status":"final",…,"status":"entered-in-error"}` lost the
  retraction: the reader's first-wins grouping discarded the second member, and the safety readout
  reported `retracted: false, safeToSummarize: true` with an **empty issue list**. A retracted
  observation was presented as safe to summarise, and the caller's only signal was a clean return.
  Pre-existing, found by the `PUBLIC-SURFACE-HYGIENE` refuter and reproduced on `main` at `d72c554`.
  **Three separable decisions, only two of them changed.**
  1. **Which value wins is UNCHANGED: still first-wins.** RFC 8259 §4 leaves duplicate names
     undefined ("the behavior of software that receives such an object is unpredictable"), FHIR
     forbids them outright (json.html §2.6.2: "Property names SHALL be unique"), and neither position is
     more authoritative: with `status` written twice the retraction can sit on either side, so
     flipping to last-wins would have moved the blind spot rather than closed it, while silently
     changing what every existing caller reads. Ranking the members is the reconciliation this
     library does not do.
  2. **A duplicate name is now reported** rather than tolerated in silence, on every path: a
     `DUPLICATE_PROPERTY` read issue (warning) at the element's FHIRPath location. On an **object**
     element it is also a `DUPLICATE_PROPERTY` validation issue (**error**, `structure`), so
     `validateResource` cannot return `valid` for such a document, and the shadowed member is
     **kept** rather than discarded, on the new `FhirComplex.duplicates`, so the information is no
     longer lost between the raw tree and the model. Inside a **primitive's `_`-sibling** the read
     issue is the whole of it: that metadata is an R4 `Element` (`id` and `extension`, never
     `modifierExtension`), so nothing there feeds a verdict, and validation and the safety readout
     are deliberately unaffected.
  3. **`readSafety` no longer asserts a verdict over a value it did not rank.** **All six** negation
     kinds are now read across **every** value the document wrote for the element each one reads, the
     same fail-safe rule already applied across a multi-coding `CodeableConcept`: `entered-in-error`
     and `not-taken` / `not-done` over every `status`, `entered-in-error` / `refuted` over every
     `verificationStatus`, `no-known-allergy` over every `code`, `do-not-perform` over every
     `doNotPerform` (a `true` anywhere wins, and is what `SafetyReadout.doNotPerform` surfaces), and
     `codingsOf` reads every `coding` member plus every `system` x `code` pair inside a `Coding` that
     repeated one, so a retraction one level down inside a `CodeableConcept` is caught too. The
     reported document now reads
     `retracted: true` with `entered-in-error` in `negations`. And any repeated property name on any
     **object** element in the resource sets `safeToSummarize: false` with the locations in the new
     `shadowedProperties`, so a caller gets a refusal instead of an affirmative answer computed from
     one arbitrary half of the document. `assertSafeToSummarize` throws on it. Those reads can only
     ever **add** a negation. The one place that cuts the other way is a `Coding` that repeated
     **both** `system` and `code`, where no pairing is recoverable and `codingsOf` therefore
     enumerates every combination: a check built on the _absence_ of a match (`con-3`, `con-4`,
     `ait-1`) can be suppressed by a pair nobody wrote. That is accepted deliberately, because such a
     document is already `valid: false` and `safeToSummarize: false`, and because catching a
     retraction is worth more than an abatement-consistency warning on an invalid document.

- **Four consequences of the above, named because each is a behaviour change in its own right.** A
  repeated name can no longer hide an unhandled `modifierExtension`, because the fail-closed walk now
  descends into shadowed members. A repeated name inside a primitive's `_`-sibling used to resolve
  **last**-wins and drop the loser in silence; it is now first-wins like everywhere else and raises
  `DUPLICATE_PROPERTY`, so the codec no longer resolves a duplicate two different ways (the shadowed
  member is not carried on the model there: a primitive's metadata is an R4 `Element`, `id` and
  `extension` only, so nothing in it can make a safety verdict wrong, and `shadowedProperties` says
  so). The JSON/XML equivalence oracle no longer calls a document carrying a shadowed member
  equivalent to one without it. And the writer continues to emit one member per name, which is now a
  **deliberate** narrowing rather than a silent one: emitting both would produce invalid FHIR, and
  emit is the wrong place to resolve an ambiguity the reader already reported.

### Changed

- **No internal project bookkeeping on any surface a consumer reads (PUBLIC-SURFACE-HYGIENE, founder
  directive 2026-07-27).** `README.md`, `docs-content/`, the npm `description`, and every `/** */`
  doc comment that compiles into `dist/index.d.ts` are swept of item identifiers, phase and wave
  language, ADR numbers, meta-repo paths and "how this got built" commentary. **The gate below
  catches identifiers, not English**, so the by-hand half of that sweep is not claimed complete: a
  sentence whose only fault is that it describes how the artifact came to exist reads like ordinary
  prose and stays a reviewer's catch. A consumer's editor
  hover and the package front page now describe what the software does; the traceability stays where
  the convention puts it, in this file, the commits, the PRs and the roadmap. **No behaviour change,
  no API change:** no export was added, removed or renamed, and no doc comment was deleted (JSDoc
  with `@example` on every public export is a hard guardrail; the sentences were translated, not
  dropped). Two consumer-visible corrections came out of the sweep: the README's status line
  claimed version `0.0.0` (the package has never been `0.0.0`, and npm is the only source of truth
  for the version), and the "Architecture decisions" table asserted that XML serialization was
  deferred, which the shipped XML codec had already made false. Measured against the gate below, on
  this tree: public surface **23 -> 0**, `src/` doc comments **255 -> 0**, `src/` string literals
  **0 -> 0**, `dist/index.d.ts` **134 -> 0**. The npm `description` also drops the word "scaffold"
  and now names the XML codec and the layered validation the package actually ships.

### Added

- **The README opens with the Cosyte brand lockup, which follows the reader's light or dark colour
  scheme.** A `<picture>` element sits above the `# @cosyte/fhir` heading: a `<source>` carrying the
  on-dark cut behind `prefers-color-scheme: dark`, and an `<img>` carrying the on-light cut as the
  fallback, so a renderer that drops `<source>` still shows the mark rather than a broken image. The
  alt text describes the artwork (a plus mark set in two overlapping rounded squares, one solid and
  one outlined, beside the Cosyte wordmark) rather than the package, because it is what a screen
  reader announces and what stands in when the image does not load. The markup was copied
  programmatically out of `hl7/README.md` and diffed byte-for-byte against it (341 bytes, identical),
  since a mistyped URL here is a broken image on a public page; both tiles were re-checked with
  `curl -I` immediately before push and returned `200 image/png`. **GitHub is the only surface this
  renders on today**, because `@cosyte/fhir` has never reached npm and so has no package page
  (`FHIR-NPM-NAME`, the `E403` name-similarity rejection); the markup is the same one the published
  siblings carry, so it is already correct for the day the name clears. No factual claim on the page
  moved: the heading, the "pre-alpha, unpublished" summary and every code sample are unchanged, and
  no resource model, `IssueCode`, validation verdict, codec output or value-free diagnostic differs.
- **Public surface for the duplicate-name work above:** `getAllProperties(node, name)` (every value
  written under a name, in document order, the fail-safe counterpart to `getProperty`),
  `shadowedProperties(resource, path)` (the FHIRPath locations of members a repeated name shadowed),
  `duplicateProperty(expression)` (the read-issue factory), `ISSUE_CODES.DUPLICATE_PROPERTY`,
  `VALIDATION_CODES.DUPLICATE_PROPERTY`, the optional `FhirComplex.duplicates` field (absent on every
  conformant document), an optional second argument to `complex()`, and
  `SafetyReadout.shadowedProperties`. `FhirSafetyError` now also covers the repeated-name refusal, so
  its `locations` and message are no longer modifier-extension-specific.
- **`scripts/check-no-internal-refs.sh` + a `no-internal-refs` CI job, so the sweep above cannot
  regress.** Ported from `hl7`'s reference gate (hl7#62, hl7#64) by way of `ncpdp`'s copy
  (ncpdp#36), which carries three fixes the original does not: a fourth pass over `src/` string
  literals, a plural stem in the phase rule, and `/` in the ADR separator class. Run it with
  `pnpm check:no-internal-refs`; it is also on the meta-repo's `scripts/verify.sh fhir` ladder. Five
  rules over four surfaces (public markdown, npm metadata, `src/` doc comments, `src/` string
  literals), each scanned line by line **and** paragraph-joined so a violation that straddles a line
  wrap cannot hide. The script self-tests before it reports, in both directions: every rule must
  still match its own positive sample **and** must still let through the reference material it is
  most likely to destroy (`FHIR-R4`, `HL7-V2`, `US-Core`, ICD-10-CM `T78.40XA`, the range `P00-P96`,
  LOINC `8480-6`, the `ait-1` / `con-3` / `obs-6` invariant ids, the `no-known-allergy` and
  `vital-signs` codes, a Phase III oncology trial). It refuses to print OK from a scan that did not
  read all of its input.
  - **`CHANGELOG.md` is deliberately not scanned**, even though it ships inside the npm tarball: the
    convention names it as one of the places identifiers belong, and rewriting a released
    changelog's history would destroy the traceability that same convention preserves. That
    contradiction is ecosystem-wide; it is recorded here, not decided here.
  - **The sibling copies' `slice` rule is deliberately not carried.** `slice` is normative R4
    vocabulary in this package (`ElementDefinition.slicing`, `sliceName`), not internal jargon:
    measured with the rule enabled, 41 matches, exactly one of them ours. A rule that is wrong 40
    times out of 41 tells a remediator to rewrite the reference material the gate exists to protect.
  - **Two stated holes:** the `FHIR-P10b` identifier form (a trailing lowercase suffix) and the bare
    `P10b` / `P9` forms are not caught, because closing them needs a `P\d+`-shaped rule of the kind
    that has previously corrupted ICD-10-CM codes; and `phase` at the end of a clause is not caught,
    inherited from `hl7` for its collision with ordinary clinical English. Both are stated rather
    than discovered later.

- **Patch bump to `0.0.3` purely to give npm support a fresh, never-attempted version to trace
  (FHIR-NPM-NAME).** This entry carries **no change to the package surface**: no new or removed
  exports, no behaviour change, no fixture change, no dependency change. `@cosyte/fhir` has never
  reached the registry, because npm's name-similarity filter rejects the scoped name with `E403` on
  account of the unscoped `fhir` package. A support request was filed 2026-07-23 and npm support
  asked for a version that has never been attempted, so they can trace the rejection end to end.
  `0.0.1` and `0.0.2` have both already been attempted (the most recent, run `30043979616` on
  2026-07-23), so re-firing either would only add a second attempt at a version already traced.
  `0.0.3` exists to produce that clean trace, and for no other reason.

### Fixed

- **`differential` CI check red on `main`: 5 "FALSE VALID" invariant violations reconciled against the
  oracle (FHIR-DIFFERENTIAL-RED).** The non-required `differential` job (the `validator_cli.jar` oracle
  over the spec-clean + Tier-2 quirk corpora) was failing: on five fixtures the parser reported no
  errors while the oracle reported errors. Each was reconciled firsthand against the live oracle
  (`org.hl7.fhir.core`, R4 `4.0.1`, US Core `6.1.0`). The findings were **incomplete fixtures**, not a
  parser conformance gap, so the fix completes the fixtures to be genuinely spec-clean rather than
  weakening the comparison:
  - **`medicationrequest-dose.json`**: added the base-mandatory `MedicationRequest.subject` (R4
    cardinality **1..1**, medicationrequest.html). The dose `doseQuantity` (`5 mg`, UCUM `mg`) is
    unchanged; the existing dose-unit tests still pass.
  - **`observation-vitals-bp.json`**: added the vital-signs-profile-mandatory `subject` +
    `effectiveDateTime` (observation-vitalsigns.html: an Observation with a vital-signs LOINC SHALL
    conform to the vital-signs profile, which requires both). The systolic/diastolic `mm[Hg]`
    components are unchanged.
  - **`observation-decimals.json`** (+ its `.xml` twin): re-coded from the body-weight vital-sign
    LOINC `29463-7` (which makes the oracle auto-apply the body-weight profile and demand
    category/subject/effective) to the **non-vital lab LOINC `718-7`** (Hemoglobin). The fixture's job
    is decimal-precision preservation, not vital-signs conformance; a lab observation is not
    auto-profiled, so the four decimal edge values (`70.0`, `0.0000000010`, `9223372036854775807`,
    `0.010`) round-trip byte-for-byte exactly as before.
  - **`quirk-searchset-paging.json`**: completed the embedded heart-rate (`8867-4`) Observation with
    `category` (vital-signs) + `subject` + `effectiveDateTime` so it is spec-clean. The paging quirk
    under test (`Bundle.link[relation=next]` surviving the round-trip) is untouched.
  - **`quirk-uscore-extensions.json`**: the oracle's two findings were both oracle-side artifacts, not
    instance defects: (1) `us-core-race` "could not be found" because the harness ran the oracle
    **without US Core loaded**, and (2) an `example.org` identifier system the validator refuses. Fixed
    by loading the US Core IG in the harness (`differential.mjs` now passes `-ig hl7.fhir.us.core#6.1.0`,
    the roadmap's documented oracle configuration) and moving the synthetic MRN off `example.org`.
    The parser is correct to accept the resource (roadmap §10 fail-safe: unknown extensions are
    preserved-and-flagged, never rejected).

  Fixtures only (synthetic, CC0/spec-grounded values; the PHI sweep covers them) plus the one harness
  IG flag. No change to the published package surface, runtime behavior, or the zero runtime deps.

### Added

- **Em-dash CI gate (EMDASH-CONFORMANCE, part 1).** The cosyte brand rule bans `U+2014` outright
  (founder directive 2026-07-24; knowledgebase `06-brand/voice-and-tone.md`), and names commit
  messages explicitly. It was enforced in CI in only three repos of ten; this repo was clean but
  ungated, so nothing stopped it regressing. Ported `knowledgebase`'s scanner
  (`scripts/check-no-emdash.sh`) and wired it into a dedicated `no-emdash` workflow that checks every
  tracked file plus the PR title, PR body, and branch commit messages. Nothing else changes: no
  source, fixture, or public-surface change, and no content churn (measured at the port: 175 tracked
  files, 0 hits, no binaries).
  - **The scanner refuses to report green from a scan it did not complete**, which is the point of
    copying this variant rather than writing a fresh one. It pins `LC_ALL=C.UTF-8` (under an unset or
    non-UTF-8 locale GNU grep 3.8 aborts on a `\x{NNNN}` pattern, and the naive shape discards that on
    stderr and prints OK over a real violation); self-tests against a known em dash before believing a
    clean result; builds the file list as its own command so a failed `git ls-files` stops the run;
    refuses an empty file list; reads `git ls-files -z` through `xargs -0` so a C-quoted non-ASCII
    path is never mistaken for a filename; passes `-e` and `--` so a tracked file named `-q` cannot
    silence a batch; anchors at the repo top level so a run from a subdirectory cannot under-report;
    and fails if the scan writes anything to stderr. Two residuals are inherited from the source
    script and left in parity with it on purpose, rather than fixed in this repo alone: the stderr
    capture binds to the scanning `grep`, not to the exclusion filter ahead of it in the pipeline
    (no realistic trigger found), and the script necessarily excludes itself, since it has to name
    the encodings it bans. The encoded-form matching is literal, so it is a floor: an unusual casing
    or a dropped semicolon can pass the gate and still breaks the rule.
  - **The gate is a separate workflow, not a step in `ci.yml`.** The message half needs the
    non-default `edited` pull_request trigger (an em dash added to a PR description after the last
    push otherwise lands unseen through the squash-merge subject), and `ci.yml` carries a Node matrix,
    a 20,000-iteration fuzz job, and a JVM differential that are far too heavy to re-run on every
    description edit.

- **Security-scaffolding parity with the sibling parsers (FHIR-SCAFFOLD-GAPS).** Registering the 7
  back-filled repos in drift coverage surfaced three `fhir`-only gaps against `config`'s
  `drift-manifest.json` (`requiredScripts` / `requiredWorkflows`), now closed by mirroring what every
  other cosyte parser already ships:
  - **PHI commit-scanner** (`scripts/phi-scan.ts`, `pnpm phi-scan`): a zero-dependency,
    FHIR-shape-aware detective tripwire. It parses each synthetic fixture (JSON / NDJSON) or scans
    element/`value`-attribute pairs (XML) and inspects only PHI-bearing elements keyed by FHIR element
    name: HumanName `family` / `given` / `text` (recursing into `contained` / `entry.resource`),
    `birthDate` / `deceasedDateTime`, SSN- / 9-digit-shaped `identifier` / `telecom` values (and
    dashed SSNs anywhere), phones without the `555` convention, `Address.line` / `.text`, and
    emails, refusing any realistic-PHI-shaped token not declared synthetic in
    `scripts/phi-allow-list.txt`. A plain-string `name` (`Organization.name`) is a resource label and
    is never name-scanned; the XML `<value>` scan is scoped to `<telecom>` / `<identifier>` blocks so
    an overloaded `Quantity.value` is never misread. `src/` gets a conservative dashed-SSN + email
    pass. Runs at pre-commit (`simple-git-hooks --staged`) and in CI (`run-phi-scan: true`);
    `scripts/verify.sh` now reports `phi-scan ✓`. A whole-file bypass requires `--allow-fixture` plus
    an audit entry in `phi-scan-overrides.md`.
  - **`.github/workflows/codeql.yml`**: thin caller of the reusable `cosyte/.github` CodeQL workflow.
  - **`.github/workflows/scorecard.yml`**: thin caller of the reusable OpenSSF Scorecard workflow.

  Additive dev-tooling / CI only. No change to the published package surface or runtime behavior;
  the runtime-dependency count stays zero (`tsx` + `simple-git-hooks` are dev dependencies).

- **Tier-2 real-world quirk corpus + `validator_cli.jar` differential over it (Phase 10, half b;
  roadmap §3/§6/§10).** Unblocked by meta-repo **ADR 0018**: "real document" that grounds a quirk
  now explicitly includes **publicly available real artifacts** (FHIR published examples, the spec's
  normative rules, US Core, documented public interop defects), not only privately-supplied vendor
  feeds. The anti-invention rule is unchanged: a genuinely vendor-proprietary deviation absent from
  every public sample stays grounded-only and is deliberately not encoded.
  - **Five quirk fixtures** (`test/__fixtures__/quirk-*.json`), each grounded in and citing a public
    source (`test/quirk-corpus.test.ts` is the provenance record), values synthetic:
    - `quirk-resourcetype-last.json`: `resourceType` is not the first property (json.html: property
      order is not significant). Reads clean; strict-emit restores `resourceType` to the front.
    - `quirk-scientific-decimal.json`: a decimal in exponent notation `1.0e2` (Synthea #675; the R4
      decimal regex permits an exponent). Read as a valid decimal, flagged
      `DECIMAL_PRECISION_AT_RISK` (info, never an error), and **preserved byte-for-byte**. A naive
      `JSON.parse` would coerce it to `100` and destroy the recorded precision.
    - `quirk-primitive-extension-misaligned.json`: a repeating primitive whose `_`-sibling array
      length disagrees (HAPI #5738; json.html null-padding). **Fails closed**: a typed, value-free
      `FhirCodecError`/`PRIMITIVE_EXTENSION_MISALIGNED`, never guessing which value the metadata binds.
    - `quirk-searchset-paging.json`: a searchset Bundle with `link[relation=next]`
      (bundle-example.json; Epic/Cerner require following `Bundle.link[next]`). Reads clean; the
      paging link survives the round-trip (never silently truncates the record).
    - `quirk-uscore-extensions.json`: US Core race (complex, `ombCategory` OMB 2106-3 + text) and
      birthsex extensions on a base Patient. Reads clean; every extension and sub-extension is
      preserved through the round-trip.
  - **Differential wiring**: `scripts/differential.mjs` now runs this Tier-2 corpus through the JVM
    `validator_cli.jar` oracle alongside the spec-clean tier, under the same two invariants (never a
    false _valid_; no spurious error on clean input). A fail-closed reader throw is surfaced as a
    `fatal` finding. The `differential` CI job scope + comment updated. **Still CI-only**: the oracle
    is a JVM program with no Java in the dev container, so it has **not** been observed green here.
  - The two remaining roadmap-§3 quirks, _missing must-support_ (`MUST_SUPPORT_ABSENT`,
    info-never-error) and _US Core version drift_ (`PROFILE_VERSION_MISMATCH`), are already exercised
    by the Phase-6 profile suite; this corpus targets the read-path / codec / Bundle quirks those
    tests do not reach.
- **Conformance hardening: fuzz, PHI-leak, and type-level tiers (Phase 11, buildable portion;
  roadmap §6).** The layered accuracy strategy turned into gating tests, plus the read-path robustness
  fixes those tests surfaced. The JVM `validator_cli.jar` differential is **authored but CI-only**
  (there is no Java in the dev container, it has not been observed green here), and the highest-value
  real-vendor **quirk-corpus** differential is **deferred to `REAL-CORPUS`** (a quirk is encoded only
  when a real de-identified document grounds it (conventions §PHI) and none exists yet).
  - **JSON + XML fuzz tier** (`test/fuzz.test.ts`): adversarial JSON/XML/NDJSON at fuzz-scale run
    counts (CI-tunable via `FUZZ_RUNS`; a dedicated `fuzz` CI job raises it to 20 000): XXE /
    billion-laughs / undefined entities, deep nesting, `_element` misalignment, huge /
    scientific-notation numbers, `resourceType` games, prototype-chain keys, and truncation +
    structural mutation of the real corpus. The proven contract: adversarial input **never crashes /
    hangs / OOMs**. It becomes a _typed_ `FhirCodecError` / `FhirXmlError` with a registered fatal
    code, or a bounded rejection, never an untyped throw.
  - **PHI-leak test tier** (`test/phi-leak.test.ts`): the value-free-diagnostics contract (§7) as a
    gate: a corpus sweep plus an injected-sentinel battery assert no PHI-bearing input value ever
    reaches any `OperationOutcome` / issue / error output (a finding carries a coded reason and a
    FHIRPath location, never a value). Generalizes the hand-picked `phi.test.ts` cases to the whole
    corpus.
  - **Type-level tier** (`test/public-types.test.ts`): `expect-type` assertions on the public type
    surface (the `kind`/`type`-discriminated unions a consumer switches on, `PrimitiveValue` never
    being a JS `number`, the value-free `FhirIssue` shape), checked by `tsc`.
  - **New fatal `FATAL_CODES.MAX_DEPTH_EXCEEDED`**: the JSON reader now bounds nesting at 256
    (matching the XML reader) and refuses a pathological tower of `[[[[…]]]]` / `{"a":{…}}` with a
    typed, value-free fatal instead of a V8 stack overflow. Real FHIR nests far shallower and is
    unaffected.
  - **Differential harness** (`scripts/differential.mjs`) + a CI `differential` job that provisions the
    JVM oracle over the synthetic spec-clean corpus, enforcing "never a false _valid_" and "no spurious
    error on clean input" on issue presence / severity / location (never text, ours is PHI-redacted).
    Authored, not yet observed green locally.

### Fixed

- **Decimal DoS on the read path.** `FhirDecimal` quantity comparison aligned scales with
  `10n ** BigInt(scaleDiff)`; an adversarial literal such as `0e9999999999999999999` (finite as a
  double but of astronomical scale) made that exponentiation throw an untyped `RangeError` (or hang
  building a multi-gigabyte BigInt) via the codec's precision check. Comparison is now done in a
  canonical form (coefficient stripped of trailing factors of ten, zero collapsed) that **never
  exponentiates**; quantity- and precision-equality semantics are unchanged, verified against the
  existing decimal suite.
- **XML entity prototype-chain bypass.** The reader resolved a predefined entity with a bare
  `PREDEFINED[body]`, so `&constructor;` / `&toString;` / `&__proto__;` read through `Object.prototype`
  and bypassed the five-entity allowlist. Now guarded by `Object.hasOwn`: only the five predefined
  entities resolve; every other named entity is refused (`UNDEFINED_ENTITY`).
- **Validator DoS via a prototype-named property.** A resource whose property was literally named
  `constructor` / `toString` / `valueOf` / `hasOwnProperty` made the schema lookup read an inherited
  `Object.prototype` member and crash `validateResource` with an uncaught `TypeError`. Now guarded by
  `Object.hasOwn`: an adversarial resource can no longer fault the validator.

- **Profile growth loop: `defineProfile()` + a spec-grounded starter kit (Phase 10, half a;
  profiling.html).** The programmatic authoring front door for the profile engine, plus a publishable
  set of example profiles that dogfood it. Half b (the Tier-2 real-vendor **quirk** corpus and its
  oracle differential) is **deferred to `REAL-CORPUS`**: a quirk is encoded only when a real,
  de-identified vendor document grounds it, and none exists yet, so inventing one is forbidden.
  - **`defineProfile(spec)`** authors a `StructureDefinition` in code from an ergonomic `ProfileSpec` /
    `ProfileElementSpec` (author-friendly `max: number | "*"`, defaulted constraint `severity`, `id`
    defaulting to `path`, `sliceName` derived from the id) and returns the **exact same model** the
    engine already consumes, so `validateResource(resource, { profiles: [defineProfile(spec)] })` just
    works. It is proven byte-for-byte equal to `loadStructureDefinition(parseResource(equivalentJson))`
    for a valid spec: **one model, two authoring routes, no privileged internal shape.** As a
    conservative writer (Postel's Law, emit side) it throws a value-free `InvalidProfileError` on an
    author mistake (a missing `url` / `type` / element `path`, a negative or non-integer cardinality,
    a `max` below `min`) rather than degrading silently. It is idempotent on an already-normalized
    `ElementDefinition` (accepts `UNBOUNDED` as a numeric `max`).
  - **Profile starter kit**: `VITAL_SIGN_OBSERVATION_STARTER` (grounded in observation-vitalsigns.html
    and US Core Vital Signs: required `status`, must-support `code`, and a **sliced** `category`: a
    required `VSCat` slice pins the `vital-signs` coding while the **open** slicing still allows other
    categories, mirroring the real profile rather than a bare pattern that would reject a valid
    multi-category Observation) and `PATIENT_IDENTIFIER_STARTER`
    (grounded in US Core Patient §4.2: `identifier` / `.system` / `.value` required and must-support,
    deliberately **no** MRN slice and **no** `identifier.type` bind: the wrong-patient-merge hazard).
    Every starter is authored through the public `defineProfile()` (no blessed internal builder),
    self-contained (differential-only, no bundled base, roadmap §5), and clearly a _template_, not an
    authoritative vendor conformance statement. Exposed as `STARTER_PROFILES`, the named profiles,
    `starterProfile(url)`, and `STARTER_PROFILE_BASE_URL`.
  - **Deferred, discipline intact:** named real-vendor profiles + the Tier-2 quirk fixtures + the
    `validator_cli.jar` differential on the quirk corpus → `REAL-CORPUS` (no invented vendor behavior);
    profiles beyond the shipped starters + US Core are user-supplied.
- **Bundles, references, and Bulk NDJSON streaming (Phase 9, bundle.html / references.html / the Bulk
  Data Access IG).** The `Bundle` layer: the model, reference resolution with a DoS-safe cycle guard,
  and a streaming NDJSON reader, all value-free and zero-dependency.
  - **Bundle model + entry-processing semantics** (`readBundle`, `entryProcessing`, `isAtomicBundle`,
    `BUNDLE_TYPES`). Reads a `Bundle` into an explicit `BundleReadout` and classifies the one
    distinction a consumer must never blur: **`transaction` = all-or-nothing (`"atomic"`)** vs
    **`batch` = independent (`"independent"`)**; every other type carries no processing contract
    (`"none"`). `Bundle.total` is surfaced as its **lexical string**, never a JS `number`. The
    artifact and its semantics are modeled. **Transactions are not executed** (no server here; a
    stated non-goal).
  - **Reference resolution** (`resolveReference`, `buildBundleIndex`, `containedIndex`). Classifies
    and resolves relative / absolute / logical / `#fragment` references against a Bundle + `contained`
    closure, keyed version-free (`Type/id`, `/_history/{vid}` dropped) and by exact `fullUrl`. A local
    miss (a fragment naming an absent contained, a relative naming no entry) is `"unresolved"`; a
    reference to somewhere outside the closure is `"external"` and **never false-flagged**.
  - **DoS-safe cycle/depth guard** (`hasContainedCycle`, `MAX_REFERENCE_DEPTH`). An **iterative**
    (heap, not call-stack) three-color depth-first search over the `contained` fragment graph, bounded
    by a frontier cap. A reference cycle (`#a`→`#b`→`#a`, a self-cycle, a root↔contained loop) is
    **detected and reported, never followed**. It always terminates, and never false-positives on a
    legitimate acyclic (DAG) contained graph.
  - **Streaming Bulk NDJSON reader** (`streamNdjson`, `parseNdjsonLine`, `NDJSON_ERROR_CODES`).
    Consumes any (async or sync) iterable of `string` / `Uint8Array` chunks (a Node `Readable`, a web
    `ReadableStream`, a generator) and yields one `NdjsonRecord` per line as bytes arrive, **without
    loading the whole file** (only the current partial line is buffered; an adversarial unterminated
    line is cut off `LINE_TOO_LONG` and drained without accumulating memory across chunks). **Per-line
    error isolation**: a malformed line (`MALFORMED_JSON` / `NOT_A_RESOURCE`) yields an isolated,
    value-free error (reported by **line number, never line content**) and the stream continues.
    Each good line is read through the precision-preserving codec, so a decimal is never routed
    through a JS `number` (ADR 0001).
  - **New value-free diagnostics**, wired into `validateResource` for a `Bundle`: `REFERENCE_UNRESOLVED`
    (warning: the reference is **preserved**, never fatal; the target may live outside the closure),
    `CONTAINED_CYCLE` (error), and `FULLURL_ID_MISMATCH` (error: a RESTful `fullUrl` whose id
    disagrees with `resource.id`; a `urn:uuid` fullUrl is **exempt**, placing no constraint on the id).
    Every finding is a FHIRPath _location_, never a value, reference string, id, or fullUrl. Adds the
    R4 `not-found` `IssueType`.
  - **Deferred, fail-safe intact:** no transaction **execution**. The library models the Bundle
    artifact and its all-or-nothing vs independent semantics, not a server that applies them.

- **`docs-content/` producer surface (`DOCS-CONTENT-P8`).** A minimal, contract-compliant docs
  producer: `docs-content/intro.md` + `docs-content/sidebars.json`, plus the `pack:docs` script
  (`scripts/build-docs-artifacts.sh`) that builds the `docs-content.tar.gz` + `source.tar.gz` release
  artifacts the `cosyte/docs` chrome ingests. Deliberately a **Size-S scaffold stub**: the sidebar is
  the compliant Overview-only spine (`{"docs":["intro"]}`) and `intro.md` carries an **honest pre-alpha
  / Coming-Soon status posture**. It mirrors `dicom`/`x12`'s registered-but-disabled state, states
  what the parser does today and what is not yet here, and marks the full Diátaxis spine
  (Installation, Quickstart, Core Concepts, Guides, Troubleshooting) as deferred until the parser
  stabilizes. No invented placeholder categories, no unshipped-API claims; the docs grow with the
  parser.

- **XML codec + cross-format equivalence (Phase 8, xml.html).** A **zero-dependency** FHIR XML codec
  that reads and writes the **same schema-free model** as the JSON codec, plus the oracle that proves
  the two wire formats agree. The hand-written XML reader is **XXE- and billion-laughs-proof by
  refusal**, not by mitigation.
  - **Hardened raw reader** (`readRawXml` → `XmlElement` tree). It **refuses any `<!DOCTYPE`**
    (`DTD_FORBIDDEN`) before parsing a single element: a DTD is the only place XML can _declare_ an
    entity, so refusing it closes the external-entity (XXE) **and** nested-entity-expansion
    (billion-laughs) vectors at once. It **refuses any entity reference** beyond the five predefined
    names and numeric character references (`UNDEFINED_ENTITY`), an independent second guard so no
    entity is ever resolved, expanded, or fetched. It performs no I/O, resolves no URI, and bounds
    nesting depth (`MAX_DEPTH_EXCEEDED`): adversarial input yields a typed `FhirXmlError`, never a hang,
    OOM, fetch, or crash. New public surface: `FhirXmlError`, `XML_FATAL_CODES`, `readRawXml`, and the
    `XmlElement` / `XmlNode` / `XmlText` / `XmlAttribute` types.
  - **FHIR XML → model** (`parseResourceXml`) returns the shared `ReadResult` and the **same**
    `FhirNode` model as `parseResource`: the root/contained element name → a synthetic `resourceType`;
    a primitive's `value` attribute → its value (kept as the exact lexical **string**: schema-free, no
    datatype guessed, precision never routed through a `number`); `id`/`extension` co-located as an
    `id` attribute + child `<extension>`s (the XML form of the JSON `_`-sibling); `Element.id` /
    `Extension.url` attributes → `id` / `url` properties; repeated elements → a list; a resource-valued
    element unwrapped to the inner resource. **Narrative `Narrative.div` (XHTML) is carried opaquely as
    its full serialized string** (the representation FHIR JSON uses), so it round-trips as conformant
    `<div>…</div>`, never dropped or escaped into an attribute. Lenient (Postel): an unexpected namespace
    or stray character data is preserved-and-flagged (new value-free issue code `UNEXPECTED_XML_CONTENT`),
    never rejected.
  - **Model → FHIR XML** (`serializeResourceXml`). The spec-clean inverse: compact, canonical FHIR XML
    that round-trips a spec-clean document **byte-for-byte**. Decimals emit from exact lexical text
    (never a `number`, ADR 0001); `Resource.id` → child `<id>`, `Element.id` → attribute,
    `Extension.url` → `url` attribute; control characters escaped round-trip-safe.
  - **JSON↔XML equivalence** (`nodesEquivalent`): the "same resource in XML and JSON parses to the
    same model" oracle, defined **modulo** the two irreducible schema-free ambiguities and only those:
    primitive lexical form (native `true`/number tokens ≡ `value`-attribute strings) and singleton
    lists (an array-of-one ≡ a single repeated element). Property names/order, nesting, `id`, and
    extensions must otherwise match exactly.
  - **Deferred, fail-safe intact:** the XHTML **structure** inside `Narrative.div` is not modeled or
    validated (carried as an opaque string, the JSON codec's fidelity, never dropped); typed
    cross-format _transcoding_ (spec-clean JSON booleans/numbers from an XML-sourced model) needs the
    datatype schema and is out of this phase; an extension-only element with no value reads as a
    primitive (value-absent-primitive vs complex-with-only-an-extension is a schema-free ambiguity,
    documented on `nodesEquivalent`, the safe direction, no data lost); RDF/Turtle is out of scope; the
    XML-fuzz differential vs `validator_cli.jar` is Phase 11.

- **Invariants via a bounded, vendored FHIRPath subset (Phase 7).** The sixth-and-final validation
  layer: evaluate a profile's `constraint[]` (FHIRPath invariants) against an instance. Per ADR 0002
  this is a **capped, in-repo FHIRPath subset**: no runtime dependency, no full third-party engine.
  Every finding stays **value-free** (a code + a FHIRPath location + the constraint `key`, never an
  instance value).
  - **The engine**: a real lexer → parser → evaluator (`tokenize`, `parseFhirPath`, `evaluateInvariant`)
    over the generic model. It implements the FHIRPath the R4 / US Core invariant set actually uses:
    path navigation (including choice access, `value` → `valueQuantity`), `$this` / `%resource` /
    `%context`; `exists` / `empty` / `not` / `where` / `all` / `select` / `count` / `first` / `last` /
    `distinct` / `hasValue` / `children` / `extension` / `intersect`; three-valued `and` / `or` /
    `xor` / `implies`; `=` / `!=` / `<` / `>` / `<=` / `>=` / `in` / `contains` / `|`; and `is` / `as` /
    `ofType` on the System primitive types. A constraint is judged by the reference validator's
    boolean coercion (an empty result is a violation, never a silent pass). Public types: `Expr`,
    `Token`, `TokenType`, `FpItem`, `FpColl`, `InvariantResult`, plus `convertToBoolean`.
  - **Fail-safe is non-negotiable**: any construct outside the subset (arithmetic, string functions,
    `descendants()`, `resolve()`, a FHIR-type `is`/`as`, an unknown operator) raises
    `UnsupportedFhirPathError`, and the invariant is reported **`INVARIANT_UNCHECKED` (`information`)**:
    surfaced, **never assumed to pass** (roadmap §6). Lazy `where`/`select`/`all` criteria mean an
    unsupported sub-term over an empty collection (e.g. `dom-3` on a resource with no `contained`)
    never fires, so common base constraints still evaluate cleanly.
  - **Wired into validation**: `collectInvariantIssues` reads `constraint[]` off each supplied
    profile's snapshot (constraints now parsed by `loadStructureDefinition` and accumulated down the
    derivation chain by `generateSnapshot`), evaluates them against the resource (root-level) or each
    present occurrence (nested), and emits `INVARIANT_VIOLATED` (severity mirroring the constraint's
    `error` | `warning`) or `INVARIANT_UNCHECKED`. Runs inside `validateResource(resource, { profiles })`.
    New public code `INVARIANT_UNCHECKED`; new type `ElementConstraint`.
  - **Safety-layer division of labour**: the seven named safety invariants (`ait-1`/`ait-2`,
    `con-3`/`con-4`/`con-5`, `obs-6`/`obs-7`) remain owned by the always-on Phase-3 safety layer (they
    fire with or without a supplied profile); the generic engine skips those keys to avoid a duplicate
    finding and covers every **other** constraint (base `ele-1` / `dom-*`, `us-core-*`, vendor
    invariants). The engine's agreement with the reference validator on the named safety expressions is
    proven directly against `evaluateInvariant`.
  - **Deferred (still `PROFILE_SLICE_UNCHECKED`, fail-safe intact):** the `type` / `profile` slicing
    discriminators and reslicing (they need per-occurrence type carriage / recursive profile
    resolution); the bundled US Core IG corpus + `validator_cli.jar` differential (Phase 11).

- **StructureDefinition + US Core profile validation (Phase 6).** A StructureDefinition-driven profile
  layer: the sixth validation layer (structure → cardinality → value-domain → terminology →
  **profile** → invariant). Like the terminology layer it ships the **engine, not the content**: a
  caller supplies the US Core (or vendor) `StructureDefinition`s and **nothing is bundled**. Every
  finding stays **value-free** (a code + a FHIRPath location, never an instance value).
  - **StructureDefinition model + loader**: `loadStructureDefinition` reads a profile out of the
    generic model (identity, `derivation`, `baseDefinition`, `differential` / `snapshot`, and
    per-element cardinality, `mustSupport`, `type`, `binding`, `slicing`, `fixed[x]` / `pattern[x]`).
    Public types: `StructureDefinition`, `ElementDefinition`, `Slicing`, `Discriminator`,
    `DiscriminatorType`, `TypedValue`, and `DISCRIMINATOR_TYPES` (the R4 discriminator set, with
    **`position` R5-only and excluded**).
  - **Snapshot generation**: `generateSnapshot` / `snapshotElements` walk `baseDefinition` and merge
    the differential onto the base snapshot: matched elements tightened by id, slices inserted, base
    elements preserved in order. Fails closed with `FhirProfileError` on an unresolvable base or a
    `baseDefinition` cycle. A profile that already carries a snapshot is used as-is.
  - **Slicing**: `resolveSlices` / `matchSlices` assign each occurrence of a sliced element to a
    slice by its discriminators (`value` / `pattern` against the slice's `fixed`/`pattern`; `exists`
    against slice cardinality). What needs a FHIRPath engine (`type` / `profile` discriminators, R5
    `position`, empty/insufficient discriminators) is reported `PROFILE_SLICE_UNCHECKED`
    (`information`): **never silently passed**. An unmatched occurrence under `closed` slicing is
    `PROFILE_SLICE_UNMATCHED` (error); a missing required slice is `CARDINALITY_MIN`.
  - **`fixed[x]` vs `pattern[x]`**: `matchesFixed` (exact equality, nothing extra) vs `matchesPattern`
    (subset, extras allowed); decimals compared precision-exactly through `FhirDecimal`, never a
    float. Mismatches are `PROFILE_FIXED_MISMATCH` / `PROFILE_PATTERN_MISMATCH` (error).
  - **Must-support as a system obligation**: an absent must-support element is `MUST_SUPPORT_ABSENT`
    at **`information`, never an error** (the roadmap's load-bearing rule: must-support obliges the
    sender to be able to populate and the receiver to tolerate absence. It is **not** instance
    presence). A bounded path navigator (`resolvePath` / `pathExists`) resolves element/discriminator
    paths without the Phase-7 FHIRPath engine.
  - **Multi-version**: `PROFILE_VERSION_MISMATCH` (warning) when a `meta.profile` `canonical|version`
    pin is carried by the supplied profile set at a different version. `collectProfileIssues` /
    `collectProfileVersionIssues` run inside `validateResource(resource, { profiles, resolveBase })`.
    The new issue codes (`PROFILE_SLICE_UNMATCHED`, `PROFILE_SLICE_UNCHECKED`, `MUST_SUPPORT_ABSENT`,
    `PROFILE_VERSION_MISMATCH`, `PROFILE_FIXED_MISMATCH`, `PROFILE_PATTERN_MISMATCH`) and the
    `business-rule` `IssueType` are snapshot-pinned. A rename is breaking.
  - **Known limitations (deferred):** no bundled multi-version US Core IG corpus and no
    `validator_cli.jar` differential (a JVM dev/CI job, Phase 11); the `type` / `profile`
    discriminators, reslicing, and invariant `constraint`s need the FHIRPath subset (Phase 7);
    profile-declared bindings are covered by the Phase-5 terminology layer, not re-enforced here.
- **Terminology binding validation: strength-aware, content-free (Phase 5).** Validate the codes on
  **bound** elements by their `system` and binding **strength**, without vendoring any SNOMED / CPT /
  LOINC / RxNorm content (roadmap §5). Every finding stays **value-free**, and **no false error is
  ever raised without a terminology service** (roadmap §5 fail-safe).
  - **Frozen known-systems registry**: `KNOWN_SYSTEMS` / `isKnownSystem`, the roadmap §5 verified
    `system` URIs (LOINC, SNOMED CT, RxNorm, ICD-10-CM, ICD-9-CM, CPT, UCUM, NDC, CVX) as
    **identities, not content**. The open-question URIs (ICD-10-PCS, HCPCS; roadmap §10) are
    deliberately **omitted**: an unknown system reads as a safe, non-erroring degrade, never a guess.
  - **Binding-strength severity**: `required` → error, `extensible` → error-unless (error on a
    definitive not-in), `preferred` → warning, `example` → information (an example binding can
    **never** error: rebinding an example code cannot fail). `BindingStrength`,
    `TERMINOLOGY_BINDINGS`, `buildBindingRegistry`, `BINDING_STRENGTHS` are the public surface.
  - **Content-free system checks**: a **known** system the value set does not draw from is
    `CODE_SYSTEM_UNEXPECTED` (strength-scaled: a `warning` for extensible/preferred, since a code
    from another system may be a justified extension; an `error` for required); an **unknown** system
    is `CODE_SYSTEM_UNKNOWN` (`information`, never a defect: a local system is not invalid).
  - **Value-set identities + multi-system elements**: the roadmap-named bindings ship built in:
    `AllergyIntolerance.code` (extensible, **RxNorm + SNOMED**, both accepted on the one element,
    roadmap §4.3) and `MedicationRequest`/`MedicationStatement.medicationCodeableConcept` (extensible,
    **RxNorm**). `ALLERGY_SUBSTANCE_VALUESET` / `MEDICATION_VALUESET` name the VSAC value sets.
  - **Pluggable terminology-service interface**: `TerminologyService`, `CodeValidationRequest`,
    `CodeValidationResult`, `CodeMembership`: the one seam through which value-set **content** enters
    the library, and **none is bundled**. Membership (`CODE_NOT_IN_VALUESET`) is checked only when a
    service is supplied and definitively answers `not-in`; an `"unknown"` answer (or **no service at
    all**) emits nothing and degrades to the content-free system checks. The service receives only
    identities (value-set URL + `system` + `code`), never a resource or a value.
  - `collectTerminologyIssues` runs inside `validateResource`; `validateResource(resource, {
terminology, bindings })` supplies a service and/or extra bindings (mirroring Phase 2's `schemas`).
    The new issue codes `CODE_SYSTEM_UNKNOWN` / `CODE_SYSTEM_UNEXPECTED` / `CODE_NOT_IN_VALUESET` (all
    `code-invalid`) are snapshot-pinned. A rename is breaking. **Known limitation:** without a
    supplied terminology service there is **no code-validity / value-set-membership** guarantee beyond
    `system` + strength (no content is bundled, roadmap §5); per-element US Core binding coverage,
    profiles (Phase 6), FHIRPath invariants (Phase 7), and XML (Phase 8) remain deferred.
- **Quantity / UCUM fidelity: results & doses (Phase 4).** The third strand of the P0 safety spine
  (codec · status/negation · units): surface a measured value by the type it actually is, and its unit
  by the code that a machine may act on. Every finding stays **value-free**, and **no unit is ever
  converted** (roadmap §4.6/§4.4).
  - **`readObservationValue(observation)`** discriminates the **11-way `Observation.value[x]` choice**
    (`valueQuantity` · `valueCodeableConcept` · `valueString` · `valueBoolean` · `valueInteger` ·
    `valueRange` · `valueRatio` · `valueSampledData` · `valueTime` · `valueDateTime` · `valuePeriod`)
    by the variant actually present, **never assuming `valueQuantity`**. A `valueString` of `"POSITIVE"`
    or a titer `valueRatio` of `1:64` is returned as its real type with `quantity: undefined`, so it
    can never be read as a number. `OBSERVATION_VALUE_TYPES` is the pinned variant set. Works on a
    `component.value[x]` too (blood-pressure panels discriminate).
  - **The unit that matters is the UCUM `code`, not the `unit` string.** `readQuantity` keeps `code` /
    `system` / `unit` / `comparator` / (exact-decimal) `value` distinct; `validateUcumShape` checks a
    code's **shape** (case-preserving, bracket-balanced) without asserting membership (no UCUM content
    is bundled, roadmap §5). The **vital-signs required-unit table** (`VITAL_SIGN_UNITS`,
    `requiredVitalSignUnits`) is the FHIR profile's closed set (weight `g|kg|[lb_av]`, height/head-circ
    `cm|[in_i]`, temp `Cel|[degF]`, HR/RR `/min`, BP `mm[Hg]`, SpO2/O2-sat `%`, BMI `kg/m2`).
  - **Dose `Quantity`**: `readMedicationDoses` / `locateDoseQuantities` surface
    `Dosage.doseAndRate.doseQuantity` for `MedicationRequest` (`dosageInstruction`) and
    `MedicationStatement` (`dosage`), UCUM-shape-checked the same way (a wrong dose unit is a
    prescribing hazard).
  - **`interpretation` and `referenceRange` preserved and surfaced**: `readInterpretations` (the
    H/L/HH flags) and `readReferenceRanges` (population-qualified bounds as `Quantity`s). Surfaced,
    **never evaluated**: Phase 4 does not compute an abnormal flag from a value and a range.
  - **New issue vocabulary:** `UCUM_UNIT_UNRECOGNIZED` (`warning` / `value`: a UCUM-declared unit that
    is absent or malformed; preserved verbatim, never converted), `VITAL_SIGN_UNIT_NONCONFORMANT`
    (`error` / `code-invalid`: a vital-signs value whose UCUM `code` or `system` the profile forbids,
    compared on the **`code`**, never the display string), and `VALUE_TYPE_UNEXPECTED` (`warning` /
    `value`: a vital sign whose value is present but not a `Quantity`). `collectQuantityIssues` runs
    inside `validateResource`. The registries stay snapshot-pinned; a rename is breaking. **obs-6**
    (`dataAbsentReason` ⇔ `value[x]` mutual-exclusion) is already enforced by the Phase-3 safety layer.
  - **Never a false error.** The vital-signs check fires only when the element declares the vital-signs
    category (or the vital-signs profile) **and** its own LOINC code is in the closed table; a quantity
    that declares no UCUM system is legal FHIR and is not flagged. Per-directory ≥90 coverage extended
    to `src/quantity/`.
  - **Still deferred:** unit _conversion_ and reference-range _evaluation_ (surfaced, never computed);
    terminology binding (Phase 5), profile / US Core (Phase 6), the general FHIRPath engine (Phase 7),
    XML (Phase 8). A consumer can trust _reads_ after this phase.
- **Safety-critical status & negation model: the fail-closed core (Phase 3).** Surfaces FHIR's
  modifier (`?!`) elements so they can never be silently dropped or inverted, and enforces the
  invariants that harm a patient when read wrong (roadmap §4). All findings stay **value-free**.
  - **`readSafety(resource)`**: a never-droppable readout of the modifier / status / negation
    elements across the six safety resource types (AllergyIntolerance, Condition,
    MedicationRequest/Statement, Observation, Immunization, DiagnosticReport): `status`,
    `clinicalStatus`, `verificationStatus`, `doNotPerform`, `retracted`, and a classified `negations`
    list (`refuted`, `no-known-allergy`, `do-not-perform`, `not-taken`, `not-done`,
    `entered-in-error`). SNOMED CT **`716186003` "no known allergy"** is a first-class negation, not
    an absent resource (which is _unknown_), and not an allergy _to_ the code.
  - **Fail-closed on an unknown `modifierExtension`.** FHIR's `?!` rule requires rejecting an element
    whose modifier the consumer does not understand; the library understands none yet, so **any**
    `modifierExtension` anywhere in **any** resource is `UNHANDLED_MODIFIER_EXTENSION` (error). The
    read side refuses too: `assertSafeToSummarize` throws `FhirSafetyError` (value-free, locations
    only) rather than flatten such a resource, the "carries status **or refuses**" contract.
  - **Named invariants**, hand-evaluated from their exact R4 FHIRPath: **`ait-1`/`ait-2`**
    (AllergyIntolerance), **`con-3`/`con-4`/`con-5`** (Condition), **`obs-6`/`obs-7`** (Observation),
    emitted as `INVARIANT_VIOLATED` carrying the constraint key (surfaced in
    `OperationOutcome.issue.details.text`). Severities mirror the spec: all `error` except the
    best-practice **`con-3` (`warning`)**, whose literal R4 expression is effectively vacuous (the
    `category.select($this='problem-list-item')` type-mismatch); we surface its documented _intent_ as
    a warning so it can never flip `valid`. A general FHIRPath engine is deferred to Phase 7 (ADR 0002).
    This phase hand-codes only the safety-critical set.
  - **`entered-in-error` surfaced as `RETRACTED_RESOURCE`** (information): a retracted record is not
    data, and must never be silently missed.
  - **New issue vocabulary:** `UNHANDLED_MODIFIER_EXTENSION`, `RETRACTED_RESOURCE`,
    `INVARIANT_VIOLATED`, and R4 issue types `invariant` / `not-supported` (the registries stay
    snapshot-pinned; a rename is breaking). A `constraint` field on `ValidationIssue` carries the
    invariant key (a public spec identifier, never PHI). Per-directory ≥90 coverage extended to
    `src/safety/`.
  - **Still deferred:** Quantity / UCUM fidelity (Phase 4), terminology binding (Phase 5), profile /
    US Core (Phase 6), the general FHIRPath invariant engine (Phase 7), XML (Phase 8). This layer
    surfaces and enforces; it never reconciles contradictions or infers clinical meaning.
- **Structural & cardinality validation + `OperationOutcome` (Phase 2).** The first three validation
  layers over the Phase-1 model, each finding **value-free** (a stable code, an R4 `IssueType`, and a
  FHIRPath `expression` location, never the offending value).
  - **Layer 1, structure:** `UNKNOWN_ELEMENT` (an element the schema does not define),
    `RESOURCE_TYPE_UNKNOWN`, `TYPE_MISMATCH` (a node whose shape is wrong for its datatype), and
    `CHOICE_AMBIGUOUS` (more than one `choice[x]` variant present).
  - **Layer 2, cardinality:** `CARDINALITY_MIN` (a required element absent) and `CARDINALITY_MAX`
    (an element past its maximum).
  - **Layer 3, value-domain:** `PRIMITIVE_INVALID` against the FHIR R4 primitive datatype regexes
    (`date`, `dateTime`, `instant`, `time`, `code`, `id`, `uri`, `oid`, `uuid`, `base64Binary`, and
    the JSON-number family validated from exact lexical text, never a float), and `CODE_INVALID` for
    a value outside a **required-strength** enumerated binding. `validatePrimitiveValue` and
    `PRIMITIVE_TYPES` are public.
  - **`OperationOutcome` output** (`toOperationOutcome`): a serializable, value-free resource model
    with `severity` (R4 `fatal|error|warning|information`; no R5 `success`), `code` (R4 `IssueType`),
    `expression`, and a `diagnostics` line derived **only** from the code. This one chokepoint is the
    **PHI redaction boundary** the roadmap places in Phase 2: no instance value can reach a diagnostic.
  - **Lenient read vs strict emit (Postel's Law):** an unknown element is a `warning` in the default
    `"lenient"` mode and an `error` under `mode: "strict"`; every other finding is an error regardless.
  - **Fail-safe / no false errors:** the validator never rejects a whole resource for one recoverable
    field, and a resource type with no schema degrades to a single informational `RESOURCE_NOT_MODELED`
    (its own elements left unchecked rather than wrongly flagged). Complex-datatype internals are left
    to Phase 6.
  - **Compact, non-`StructureDefinition` schema** (`ResourceSchema` / `ElementSchema` / `buildRegistry`
    / `baseSchema` / `resolveElement`, with `choice[x]` support): the seam Phase 6 will feed from real
    StructureDefinitions. Ships with the base `Resource`/`DomainResource` elements plus a worked
    `Patient` schema; callers supply others via `validateResource(resource, { schemas: [...] })`.
  - **Stable public contract:** the `VALIDATION_CODES`, `ISSUE_TYPES`, and `ISSUE_SEVERITIES`
    registries are snapshot-pinned (a rename is breaking), with a PHI sweep over every emitted
    `OperationOutcome`. Per-directory ≥90 coverage extended to `src/validate/`.
  - **Still deferred:** terminology binding beyond required-code enumeration (Phase 5); profile /
    US Core / slicing / must-support (Phase 6); FHIRPath invariants (Phase 7).
- **JSON codec + typed primitive model: the no-data-loss core (Phase 1).** The first parsing code:
  a precision-preserving JSON reader, an immutable resource model, and a spec-clean serializer.
  - **`decimal` / `integer64` lexical precision (ADR 0001).** `FhirDecimal` and `FhirInteger64` are
    string-backed and never route a value through the JS `number` type. `0.010` stays `0.010`; a
    64-bit-range integer stays exact. `FhirDecimal` exposes precision-sensitive `equals` (the FHIR
    default: `0.010 ≠ 0.01`) alongside quantity-only `equalsValue`, plus `toBigInt` / `toNumber`
    (the latter deliberately lossy). The reader tokenizes JSON itself (`readRawJson`) because
    `JSON.parse` is non-conformant for FHIR decimals: it would corrupt them before any of our code
    runs.
  - **Primitive-extension (`_`-sibling) model with null-padded array alignment.** A primitive's
    value and its `id`/`extension` metadata are merged into one first-class `FhirPrimitive` node
    (modeled as a concept, not a literal `_`-key, so the Phase-8 XML codec inherits it, ADR 0003).
    Repeating primitives round-trip their value array and `_`-array index-aligned with `null`
    placeholders. A length mismatch **fails closed** (`PRIMITIVE_EXTENSION_MISALIGNED`) rather than
    guess which value an extension belongs to.
  - **Generic element model** (`FhirComplex` / `FhirList` / `FhirPrimitive`), immutable and
    wire-agnostic, preserving property order and resolving `resourceType` in any position. Plus
    `meta`/`contained` (preserved structurally) and a `parseReference` classifier
    (relative / absolute / logical / fragment).
  - **Value-free diagnostics (PHI-safe).** Issue codes `DECIMAL_PRECISION_AT_RISK` (information) and
    `UNKNOWN_PROPERTY` (warning), and fatal codes `MALFORMED_JSON` / `PRIMITIVE_EXTENSION_MISALIGNED`
    (`FhirCodecError`), all carrying a FHIRPath location or byte offset, never a resource value.
  - **Accuracy gate:** byte-identical round-trip golden files (trailing-zero decimals, values past
    2^53, primitive extensions, value-absent primitives), property-based round-trip + decimal-
    preservation suites (`fast-check`), immutability, a stable issue/fatal-code snapshot, and a
    PHI-in-diagnostics sweep. Per-directory ≥90 coverage gates (held at 0 during P0) are restored.
  - **Deferred to later phases (read-only surface today):** structural / cardinality / terminology /
    profile / invariant **validation** (P2, P5–P7): Phase 1 parses and preserves, it does not
    validate; XML (P8); Bundle/reference **resolution** and Bulk NDJSON (P9); typed per-resource
    models and schema-driven `integer64` typing.
- **Repository bootstrap (P0).** Scaffolded `@cosyte/fhir` from the shared cosyte engineering
  standard, mirroring the `hl7` reference layout: dual ESM + CJS + `.d.ts` build via `tsup`
  (`@cosyte/tsup-config`), ESLint 10 (`@cosyte/eslint-config`), Vitest 4 with v8 coverage
  (`@cosyte/vitest-config`), TypeScript 5.9 (`@cosyte/tsconfig`), Prettier
  (`@cosyte/prettier-config`), Node >= 22, ES2023, **zero runtime dependencies**, Changesets, and
  the thin CI/Release workflows that call the shared `cosyte/.github` pipelines.
- **Placeholder source tree.** `src/model/`, `src/codec/`, `src/validate/`, `src/profiles/`, and
  `src/helpers/` barrels, plus the `VERSION` export and its `package.json` drift guard
  (`scripts/sync-version.mjs` + `test/sanity.test.ts`). No parse code in this phase: all parsing is
  deferred to Phase 1 and beyond (see `operations/roadmaps/fhir.md` in the meta-repo).
- **Four architecture ADRs** under `documentation/decisions/`:
  - `0001`: `decimal` / `integer64` are string-backed and MUST preserve lexical precision; they
    never round-trip through the JS `number` type.
  - `0002`: FHIRPath dependency posture: implement a bounded, vendored subset in-repo; no runtime
    dependency, no full third-party engine.
  - `0003`: JSON-first; XML serialization is deferred to Phase 8.
  - `0004`: R4 (`4.0.1`) is the modeled version (the ONC HTI-1 / §170.315(g)(10) anchor); R5 and
    DSTU2 are read-tolerance only.

[Unreleased]: https://github.com/cosyte/fhir/commits/main
