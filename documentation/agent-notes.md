# @cosyte/fhir agent notes

The narrative half of this repo's `CLAUDE.md`, relocated here on 2026-08-04 under `CLAUDE-MD-AUDIT`
so that `CLAUDE.md` stays a short card that every session reads in full.

**Nothing was deleted and nothing was rewritten.** Every paragraph below is the verbatim text that
used to sit in `CLAUDE.md`, in its original order, with headings added so it can be found.
`CLAUDE.md` keeps the cursor, the rules, and every trap as a one-line imperative pointing at the
section here that carries the incident it came from. These are clinical-safety lessons that each
cost a defect or a refuted gate pass to learn: **relocate them, never delete them.**

The sections headed "Narrative:" at the end were separate files until 2026-11-07, when the notes
became this one file; they are folded in as written, so where one says "this file" it means the
file it was then.

## The card in full (2026-11-07)

On 2026-11-07 `CLAUDE.md` became a card of at most 60 lines, 100 characters a line, and 5,120
bytes (the card spec, `documentation/claude-card.md` in cosyte/config). Its gate notes and its
sixteen rules, as they stood that day, are kept here as written; the card keeps a short form of
each rule.

### The gate notes

From the repo root, in this order, with pnpm 10.34.5 (the `packageManager` pin). Where `pnpm --version` prints another major, put the pinned one first on PATH, since pnpm 12 refuses the frozen install and a test shells out to bare `pnpm`: `mkdir -p ~/.pnpm10 && corepack enable --install-directory ~/.pnpm10 pnpm && export PATH="$HOME/.pnpm10:$PATH"`.

The first nine are the shared `cosyte/.github` CI ladder, run on Node 22 and 24; the fuzz line and the four examples lines are the `fuzz` and `examples` jobs in `.github/workflows/ci.yml`. CI also loads `dist/` as ESM and as CJS, runs actionlint and CodeQL, packs the tree and installs the tarball into a clean directory, and runs the `differential` job (`pnpm corpus:fetch`, then `pnpm differential` and `pnpm differential:determinism`), which needs `java` and the pinned `validator_cli.jar` at `VALIDATOR_CLI_JAR`; CI provides both.

### The sixteen rules

- A repeated JSON property stays first-wins, is kept on `FhirComplex.duplicates` and reported, and stops `readSafety` affirming. Never switch to last-wins, which only moves the blind spot: a second `status` hid an `entered-in-error` retraction under `safeToSummarize: true` (#32).
- A read and its report widen together, at one window, in one change: an unwrap inside `codingsOf` that nothing reported erased a true `VITAL_SIGN_UNIT_NONCONFORMANT` and flipped a document to `valid: true`. Count array positions, not strings, and yield at most one value per written member into the `system` x `code` cross-product, since one invented pair is a recorded "no known allergy" (#34).
- Negation reads take no resource-type gate and run at every resource root: gated reads returned `negations: []` and `safeToSummarize: true` for a conformant `doNotPerform` ServiceRequest, a `not-done` Procedure and a retraction inside a Bundle (#81, #82, #83). `noKnownAllergy` stays gated, because it asserts something positive.
- Content the model cannot place (an array inside an array, a `_`-sibling that is not an object, a JSON `null` at a primitive) draws a diagnostic and is handed back as inert text, never modeled as an element and never dropped: modeling it erased a true error and asserted `noKnownAllergy`, and dropping it wrote non-conformant documents back clean (#37, #38, #68, #69).
- The writers author nothing and repair nothing. A model they cannot write faithfully is refused with a code from `SERIALIZE_ERROR_CODES` (read the list there, never from a copy): they once invented a `{}` (#59), authored elements out of a name (#64) and forged a negation out of a `div` (#65).
- The XML reader compares expanded names (namespace and local name), never a tag or a local name alone: a prefixed FHIR document read as properties named `f:active` (#44), and two spellings of one name merged in silence (#59).
- Take the narrative by its expanded name `{http://www.w3.org/1999/xhtml}div` before the resource-valued unwrap: `<BR/>` read as a contained resource and deleted the prose beside it under `valid: true` (#46, #47).
- Diagnostics carry an `IssueCode` and a FHIRPath location, never a value, and a name the document supplies is bounded in `src/model/path.ts` before it reaches a location: a 1 MB property name reached `expression` whole (#43).
- The PHI scan's scope and its recogniser change together, and it sweeps the git index as well as the tree, so re-run `pnpm phi-scan` after `git add`: a symlink, a staged rename, files under `test/` and a fixture staged then scrubbed each read clean (#50, #56, #60, #90).
- The differential's oracle answers no terminology over a network (`-tx n/a -txCache n/a`, declared in `scripts/differential/terminology.mjs`), and a disagreement is closed by fixing a fixture or the library, never by loosening the comparison: the default server moved three documents in and out of FALSE VALID (#104), and five FALSE VALIDs on main were incomplete fixtures (#20).
- A declared gap pinned by a characterization test reds when it closes, so rewrite that test in the same change, and never write "pinned by a test" without opening the test: three such claims had none (#58).
- `pnpm attw` stays `node scripts/attw.mjs`, never bare `attw` (`node_modules/.bin`, from the `@arethetypeswrong/cli` devDependency): the bare CLI exits 0 on a pack with no types (#49).
- A change under `src/` adds a changeset, whose summary the release writes into `CHANGELOG.md`; never hand-edit that file. Pick `minor` for new capability or anything that withdraws or narrows working behaviour (a new write refusal does), `patch` only when every public observable is unchanged: two breaks shipped as `patch` (#111).
- A changeset's text becomes the permanent release body: keep its first sentence short, and keep out internal identifiers and any claim a sibling changeset makes stale. The release refused such notes and published nothing (#39, #100), and two stale claims nearly froze into a body (#67, #71).
- `README.md`, `docs-content/` and the `/** */` comments and string literals in `src/` carry no item identifiers, phase language, ADR numbers or private paths. Translate the line; never delete a doc comment to pass `pnpm check:no-internal-refs` (#31).
- npm refuses new `@cosyte/fhir` versions with a bare `E403` (0.0.11, 0.1.0) and accepted only the narrowed 0.0.10, and the cause is not settled. Keep `files` to the runtime artifacts and the README slim (#134), never rename or rescope the package (#55), read the version from `package.json`, and do not call a publish settled from one result (#107, #109) or failed from a 404 seconds after it (`documentation/agent-notes.md#publish-state-fhir-npm-name`).

## A name that is not an XML 1.0 `Name` and a character outside `Char`, closed at the XML writer (2026-09-25)

### The defect, measured at `18567b9`

`serializeResourceXml` wrote `<a&b value="v"/>`, `<1abc/>`, `<-x/>` and a tag carrying U+0000 as
element tags, and this library's own reader read each back; a U+0000 inside a string value went raw
into its `value` attribute. A conforming XML 1.0 processor rejects every one of those documents as a
fatal error. The tag-breaking refusal never reached them because its line is this library's own
round trip, and that round trip survived.

### The remedy, and where the line is

**The XML 1.0 (Fifth Edition) productions, [5] `Name` and [2] `Char`**, as two new codes rather than
a wider `UNSERIALIZABLE_ELEMENT_NAME`, so a caller can tell a bad key from a bad value without reading
a location. `isXmlName` is the third question `tag()` asks at every tag site, after `breaksTag` and
`carriesUndeclarablePrefix`, a name recorded under the first it fails, so `a b` stays the element-name
code and `1a:b` the colon code. A name carrying a non-`Char` is not a `Name` and draws the name code.
`carriesNonXmlCharacter` is asked at every site that writes an attribute value (`attributeValue()`:
a primitive's `value`, an `id` written as an attribute, an `Extension.url`) and of a `div` string
that passed both `div` checks, over the raw string and over the code point each numeric character
reference its parse decoded refers to, one reference at a time, so `&#0;` is refused as a raw U+0000
is (the Legal Character constraint); a reference inside a comment is never decoded and is written.
The question is asked of each reference and never of the decoded text, because the parse decodes
with `String.fromCodePoint` and `&#xD83D;&#xDE00;`, two references to unpaired surrogates, decodes to
the same well-formed pair as `&#x1F600;`; `readRawXmlReferences` is `readRawXml` over the same parse,
also handing back each reference's code point. `writeElement` now settles its `id` and `url` attributes
before walking its children, which is the order the output spells them in, so the locations come out
in walk order; the bytes written are unchanged. The name code is raised after
`UNSERIALIZABLE_DIV_PREFIX` and the character code last of all. Refused, never repaired: no name is
mangled, and no character is escaped into a reference (itself a fatal error), replaced or dropped.

### What it costs

**It withdraws an XML write from models that read `valid: true`**, the sixth refusal to pay that:
`{"resourceType":"Patient","1abc":"v"}` reads with an empty issue list. `serializeResource` is
byte-identical to the pin on every graded model and is the route that stays open.

### Still open, and not folded in

- **`xml:1abc`**: a `Name` that is not namespace-well-formed, still written.
- **A non-`Name` element or attribute name inside a `div` string** (`<1p>`): the string is asked the
  `Char` question only, because the `div` criterion routes every non-`Char` in the string to the
  character code, and the `Name` question is asked at tag positions only. Still written.
- **The three `div` `PRE-EXISTING` counterexamples** (depth budget, inserted declaration, an XML
  declaration inside the string): none is a name or a character matter.
- **The reader** still reads `<1abc>` and `<a&b>` back, and **`validateResource`** still returns
  `valid: true` for a `string` carrying U+0000: separate surfaces, left to their own decisions.

### What graded it

A committed capture of the pin (`scripts/capture-xml-wellformed.ts`, `git archive` of `src/` at
`18567b9`, `test/__data__/xml-wellformed-base.json`): every named model and both writers' outcome
for it, the readout corpus, and 1,000 models drawn from `Name` and `Char` with a fixed seed, each
recorded beside the pin's output. `test/xml-wellformed.test.ts` grades the refusals and
`test/xml-wellformed-base.test.ts` what must not move; against the pin's `src/` the new suites red in
253 of 570 tests, every refusal grade, and the preservation grades pass there. The characterization
tests in `test/xml-tag-name.test.ts` that pinned the names as written went red and were rewritten
over the same names.

## The unbound-prefix round trip, closed through a `div` value (2026-09-24)

The route of the unbound-prefix residual that the tag-site closure below left declared open: a
narrative `div` VALUE whose own markup names a prefix nothing in the string binds. Closed by a write
refusal on a code of its own, `UNSERIALIZABLE_DIV_PREFIX`. The colon-free non-name gap beside it is
a different gap and is not touched.

### The defect, measured at `da87697` before anything was changed

`serializeResourceXml` splices a `div` string in verbatim once it passes the one-`div`-element
check (`emitsOneDivElement`), and that check compares the root's local name only. So:

    in  {"resourceType":"Patient","text":{"status":"generated","div":"<v:div>x</v:div>"}}
    out <Patient xmlns="…fhir"><text><status value="generated"/><v:div>x</v:div></text></Patient>

A conformant parser rejects that document, because `v` is bound to nothing, and this library's own
re-read of it carries a property named `v:div` under `text` where `Narrative.div` was: the narrative
gone after one write and one read, with no diagnostic at either end.
`<div xmlns="…xhtml"><v:p>x</v:p></div>` and `<div xmlns="…xhtml"><p v:a="1">x</p></div>` were
written the same way; this library's re-read returned each string unchanged, and a conformant parser
rejects each output. All three read with an empty issue list, `valid: true` and
`safeToSummarize: true`. The inner-prefix string read from XML
(`<Patient xmlns="…fhir"><text><status value="generated"/><div xmlns="…xhtml"><v:p>x</v:p></div></text></Patient>`,
zero issues) was written back verbatim as well.

### The remedy, and where the line is

**Namespace-well-formedness of the spliced markup, the line the tag-site closure drew.** Namespaces
in XML 1.0 §5 (a prefix other than `xml` or `xmlns` MUST have been declared on the element or an
ancestor), §7 (zero or one colon), §3 (`xml` bound by definition; no element name with the prefix
`xmlns`). The ancestors that count are the ones INSIDE the string, because the string is all the
branch splices in and the skeleton the writer authors around it declares no prefix.
`bindsEveryPrefix` in `src/xml/write.ts` walks the tree `readRawXml` already parsed for the
one-element check, which now hands that root back instead of a boolean so the string is parsed once:
every element and attribute name carrying a colon must split at its one colon into a non-empty local
part and a prefix that is `xml` or that an `xmlns:p` attribute on that element or an enclosing one
binds. `xmlns` and `xmlns:*` attributes are declarations and are not asked. A declaration with an
empty value binds nothing (1.0 forbids it, 1.1 reads it as undeclaring), `xmlns` is never accepted as
a prefix even when declared, and an empty prefix, an empty local part or a second colon is refused.
An unbound prefix on an inner element or an attribute is refused as well as one on the root.

**Asked only of a string that already passed the one-element check.** `<v:div>x</v:div><x/>` and
`<v:p>x</v:p>` stay `UNSERIALIZABLE_DIV_MARKUP` at `Patient.text.div`, exactly as at the pin.

**A new code, raised last of all.** Reusing `UNSERIALIZABLE_DIV_MARKUP` would move models onto an
earlier code (it is raised second), and `UNSERIALIZABLE_PREFIXED_NAME`'s published meaning is a
name at a tag position, which a published code may not stop meaning. The locations are collected at
the `div` branch during the same walk and raised after the tag-site colon refusal, so every model
that drew a code at the pin keeps it with the same locations: measured at the pin and asserted at
head beside a colon-bearing name, a tag-breaking name, a second failing `div`, a JSON-only shape, an
array wrapper, an untaggable type, a foreign root in the same Bundle and a `value[x]` wrapper, each
with all three unbound strings. The message and the locations carry no colon, no `<`, no `>` and no
part of the string; a location is the `div`'s bounded path, deduplicated, in walk order.

### What it costs

**It withdraws an XML write from models that read `valid: true`**, the fifth refusal to pay that
(`breaksTag`, the untaggable type, the foreign root and the tag-site colon are the others), and for
the inner-element and attribute spellings from models this library itself round-tripped. **An
ANCESTOR-bound prefix is NOT withdrawn, and that rests on the reader**: `parseResourceXml` writes
the declarations the `div` inherited and uses into the string it hands back, so
`<Patient xmlns="…fhir" xmlns:h="…xhtml"><text><status value="generated"/><h:div>ok</h:div></text></Patient>`
reads to `<h:div xmlns:h="…xhtml">ok</h:div>`, which binds its own prefix and is written and re-read
as `Narrative.div`. Measured the same for a prefix an ancestor binds and an inner element or an
attribute uses. **Change that reader behaviour and this refusal starts withdrawing conformant round
trips.** `serializeResource` is byte-identical to the pin on every model above and is the route that
stays open. The read path, validation, safety, profiles and terminology are untouched:
`git diff --stat da87697 -- src/xml/read.ts src/validate src/safety src/profiles src/terminology`
prints nothing.

### Still open, and not folded in

- **A colon-free name that is not a conformant XML name** (`a&b`, `1abc`, and the rest of that list
  below), and the local part after `xml:` (`xml:1abc`). A different gap, still written;
  `UNSERIALIZABLE_ELEMENT_NAME` is not widened onto it. **Closed since** for the colon-free name, on
  `UNSERIALIZABLE_XML_NAME`: the section above. `xml:1abc` is a `Name` and is still written.
- **The other accepted-is-not-lossless counterexamples of the `div` check**: the depth budget, the
  inserted `xmlns` on an undeclared `<div>`, an XML declaration, a comment beside the root. Each is
  written exactly as at the pin.
- **What the new check does not ask**: whether a bound prefix names the namespace the sender meant,
  two attributes expanding to one name (§6.3), a malformed declaration (`xmlns:` alone), and a local
  part beyond its being non-empty and colon-free.
- **Modeling namespace bindings on the model** (remedy (a)) is not taken, and **the JSON leg of the
  foreign-root laundering** stays declared open.

### What graded it

The two characterization tests that pinned this route as written, in `test/xml-tag-name.test.ts`,
were rewritten over the same documents: "AC-7(d): writes every div string in this block exactly as
the pin did" keeps every row but `<v:div>x</v:div>`, which it now asserts refused, and "accepts a
root whose prefix nothing binds, which re-reads as a different property" now asserts the refusal. No
other test pinned an unbound-prefix `div` as written: the full suite was green at head with no
further rewrite. Head's tests run over `da87697`'s `src/` in a scratch tree: **28 red**, exactly the
two rewritten tests and the 26 added refusal and location tests (15 for the refusal, 11 for the
locations). The 195 others pass there, including all 65 pin-comparison tests (the admitted set, the
ancestor-bound read and write, the one-element-check precedence, the 24 precedence rows and the JSON
byte-identity rows). A mutation matrix of 18 edits (the check removed, children or attributes not
walked, raised before the tag-site or the JSON-only refusal, routed onto the markup code, asked
before the local-name check, no dedup, no `xml` exemption, declarations ignored or not inherited, a
colon in the message, the string in a location, an empty declaration binding, and each of the four
name-shape guards) reddens the suite for all 18. The empty-declaration and empty-prefix mutations
each survived a first run, and are graded by the test over the spellings no declaration can bind.

`pnpm differential:read --base da87697`: 1195 documents, `readings moved 0`, `valid false -> true`
0, `safeToSummarize false -> true` 0, retractions, negations, read diagnostics and validation
findings lost 0, newly throwing 0. The same run with `--json` reports `refusalsIntroduced` as
`["UNSERIALIZABLE_DIV_PREFIX"]`, and the text report's arm 4 prints `this run introduces 1 writer
refusal(s): UNSERIALIZABLE_DIV_PREFIX`. **Those zeros are floors, not proof.** `readings moved 0`
says no corpus document the pin wrote is refused at head, so the new refusal reaches none of them.
The corpus does carry prefixed narratives (`escape-lt-in-uri` binds `V` on the root and uses it
inside the `div`); the reader carries each binding into the string, so each is written as before,
which is corpus evidence for the cost section above and not for the refusal. The corpus says nothing
about how often a real vendor feed will draw this refusal.

## The unbound-prefix round trip, closed at the tag sites (2026-09-24)

The last residual `test/xml.test.ts` still pinned as open under "declared residuals, pinned so they
cannot move in silence", closed on its **tag-site** route by a write refusal,
`UNSERIALIZABLE_PREFIXED_NAME`. Its **`div`-value** route is not closed and stays declared open
(below). **Closed since, on a code of its own: the section above.** Remedy (b) of the two
`FHIR-UNBOUND-PREFIX-ROUNDTRIP` re-measured; (a) is not taken.

### The defect, measured at `49364a3` before anything was changed

`serializeResourceXml` wrote a model name carrying a colon verbatim, with nothing declaring the
prefix. Every one of these was returned as a document, and a conformant parser rejects each:

    D1  <Observation xmlns="…fhir"><status value="final"/>
        <p:x xmlns:p="urn:a" value="1"/><p:x xmlns:p="urn:b" value="2"/></Observation>
    out <Observation xmlns="…fhir"><status value="final"/><p:x value="1"/><p:x value="2"/></Observation>
    D2  <v:Observation><v:id value="o1"/><v:status value="final"/></v:Observation>
    out <v:Observation xmlns="…fhir"><v:id value="o1"/><v:status value="final"/></v:Observation>
    D3  <Observation xmlns="…fhir"><status value="final"/><v:x xmlns:v="urn:vendor" value="1"/></Observation>
    out <Observation xmlns="…fhir"><status value="final"/><v:x value="1"/></Observation>

plus `{"resourceType":"Patient","p:x":"v"}`, `":x"`, `"a:b:c"` and `"xmlns:x"`, a colon-bearing
name inside a backbone element, on an extension, inside a `contained` resource, as the wrapper name
of a resource-valued element, as a `contained` resource's type, and inside a resource composed into
`Bundle.entry.resource` after parsing. D1 is the one that lost a finding: it reads with
`MIXED_XML_SPELLING` at `Observation.<withheld>`, and re-reading its output drops that report,
because the two occurrences now share one (unbound) expanded name.

### The remedy, and where the line is

**Any colon at a tag position, with one exemption.** Namespaces in XML 1.0 (Third Edition) §7:
"All element and attribute names contain either zero or one colon"; §5: "The namespace prefix,
unless it is xml or xmlns, MUST have been declared"; §3: "The prefix xml is by definition bound" and
"Element names MUST NOT have the prefix xmlns". The model carries no bindings, so every colon the
writer emits is undeclared except under `xml`: `xml:` followed by a non-empty, colon-free local part
is written (`<xml:x value="v"/>`), and everything else carrying a colon is refused, `xmlns:x`
included.

**A new code, not a wider `UNSERIALIZABLE_ELEMENT_NAME`.** That code's published line is "does this
library's own round trip survive it", and `p:x` does survive it; widening it would change a
published code's meaning. `SERIALIZE_ERROR_CODES` gains one member, raised by
`serializeResourceXml` only.

**Checked at the tag sites, never in a pre-pass.** `tag()` in `src/xml/write.ts` asks two questions
of every name and records it under the first it fails: `breaksTag`, then
`carriesUndeclarablePrefix`. The locations are collected during the walk and raised **after every
refusal the writer already raised**, so no model that drew a code at `49364a3` moves onto the new
one. Measured there and asserted at head, each beside a colon-bearing name:
`{"a b":"1","contact":[{"p:x":"2"}]}` and `a b:c` stay `UNSERIALIZABLE_ELEMENT_NAME` at
`Patient.<withheld>`; a refused `div` stays `UNSERIALIZABLE_DIV_MARKUP`; dropped element text stays
`DROPPED_ELEMENT_TEXT`; and the JSON-only shape, array wrapper, shadowed member, untaggable type,
foreign root and `value[x]` wrapper each keep their own code and locations.

**Why (a), modeling the binding, is not taken.** It cannot close D2: the source binds `v` to nothing,
so writing any binding authors a namespace the sender never sent. And it puts a vendor URI on the
model within reach of every walker and diagnostic, the reason the foreign-root closure chose a marker
over the vocabulary. It is not refuted, and stays available to a later change that wants the
bound-prefix XML round trip back.

**What it costs.** It withdraws an XML write from models that read `valid: true`:
`{"resourceType":"Patient","p:x":"v"}` reads with an empty issue list and validates `valid: true`
(one `UNKNOWN_ELEMENT` warning), and D2 validates `valid: true`. The fourth refusal to pay that
(`breaksTag`, the untaggable type and the foreign root are the others). `serializeResource` is
byte-identical to `49364a3` on every model above and is the route that stays open. The read path is
unchanged: D1, D2, D3 and the JSON documents read with the same issues, validation and `readSafety`
readout as at `49364a3`, asserted in `test/xml.test.ts`.

**The message carries no colon at all, and the locations none either.** Every refused name carries
a colon, which neither `elementName` nor `resourceTypeName` admits, so its own segment is
`<withheld>`; a `contained` resource's type is reported at the element wrapping it. D2 reports
`<withheld>` and `<withheld>.<withheld>`, deduplicated.

### Still open, and not folded in

- **The same residual through a `div` VALUE.** `<v:div>x</v:div>` is written by the `div` branch,
  which splices a string rather than writing a name at a tag position, so the colon refusal does not
  reach it; it re-reads as a property named `v:div`. Pinned in `test/xml-tag-name.test.ts` ("accepts
  a root whose prefix nothing binds", and the `AC-7(d)` row), byte-identical to `49364a3`. **Closed
  since**, on `UNSERIALIZABLE_DIV_PREFIX`, and both tests rewritten: the section above.
- **A colon-free name that is not a conformant XML name** (`a&b`, `1abc`, `-lead`, `.lead`, `a"b`,
  `a'b`, `\v`, `\f`, `U+00A0`), and the local part after `xml:`. A different gap, still written.
  **Closed since** for every one of those names, on `UNSERIALIZABLE_XML_NAME`: the first section of
  this file. The local part after `xml:` is still written.
- **The JSON leg of the foreign-root laundering**, declared open by that closure; untouched.

### What graded it, and what could not

The characterization tests red at head against the pin's copies of `test/xml.test.ts` and
`test/xml-tag-name.test.ts`: "loses that report through the XML writer, because the bindings are
not modeled", "leaves an unbound-prefix root exactly as it is, deferral and all", "writes %s
verbatim" for `p:x`, `:x` and `a:b:c`, and "emits a prefixed foreign property with the prefix still
unbound", each rewritten over the same document. One more pin test reds, and it is the same shape:
the generated-alphabet property "either refuses, or its output re-reads as the same property names"
expected only `UNSERIALIZABLE_ELEMENT_NAME` over an alphabet that spells `:`. The new tests were
observed red in 37 assertions against the unchanged `src/`. A mutation matrix of 14 edits (the check
removed at each tag site, colon names routed onto the name code, the refusal raised before the name
or foreign-root refusal, no dedup, no exemption, an exemption widened to `xmlns`, a colon in the
message, the name in a location, and a refusal widened into the colon-free gap) reddened the suite
for 13; the fourteenth, echoing the bounded locations in the message, is not a leak and stays green.

`pnpm differential:read --base 49364a3`: 1195 documents, `readings moved 0`, `valid false -> true`
0, `safeToSummarize false -> true` 0, retractions, negations, read diagnostics and validation
findings lost 0, newly throwing 0, and arm 4 prints `this run introduces 1 writer refusal(s):
UNSERIALIZABLE_PREFIXED_NAME`. **Those zeros are floors, not proof.** `readings moved 0` says no
corpus document the base wrote is refused at head, so the new refusal reaches none of them: the
XML corpus is FHIR-rooted, and the one mutation that carries a colon-bearing name
(`vendor-div-prefixed`) is refused at both ends on `DROPPED_ELEMENT_TEXT`, which is raised first.
The corpus says nothing about how often a real vendor feed will draw this refusal.

## The foreign root laundering, closed (2026-08-27)

The third of the three residuals `test/xml.test.ts` pins under "declared residuals, pinned so they
cannot move in silence", and the last one in that block whose closure was not parked behind a
decision this repo had already recorded. Closed by a **write refusal**,
`UNSERIALIZABLE_FOREIGN_ROOT`, in the shape of the dropped-text one.

### The defect, measured at `2ac2d72` before anything was changed

    <v:Observation xmlns:v="urn:vendor"><v:id value="o1"/>
    <v:status value="entered-in-error"/><v:code><v:text value="synthetic"/></v:code></v:Observation>

Four observations, taken in that order from that document:

1. the first read reports **exactly one** issue, `UNEXPECTED_XML_CONTENT`, severity `warning`, at
   `Observation`;
2. `validateResource(...).valid` is `true`, because the flag is a warning: the flag is the whole of
   what the reading says about the vocabulary;
3. `serializeResourceXml` emitted
   `<Observation xmlns="http://hl7.org/fhir"><id value="o1"/><status value="entered-in-error"/><code><text value="synthetic"/></code></Observation>`,
   containing no trace of `urn:vendor`;
4. the re-read of that output carried an issue list of `[]`, `valid: true`, and re-emitted
   **byte-identically**. One write and one re-read, and the vendor document was indistinguishable
   from FHIR authored as FHIR.

The **default-declaration** spelling (`<Observation xmlns="urn:vendor">`) laundered identically and
had never been pinned; the bound-prefix spelling was the one the test named.

### Why the model carries a MARKER and not the vocabulary

Two routes were open and the repo's own notes named both without disqualifying either: carry the
root's namespace in the model and write it back, or refuse the write. **The refusal shipped.**
Carrying the namespace is a model change that preserves document content on the node, so a vendor
URI would then sit within reach of every walker and every diagnostic, on a model whose edge set is
policed deliberately (`test/model-edges.test.ts`); the URI is exactly the content this residual is
about, and a marker cannot leak content. `FhirComplex.foreignRoot` is therefore a literal `true`,
set by `markForeignRoot` from `parseResourceXml` and nowhere else, read by the public
`isForeignRoot`, and the two-file closure is asserted in `test/model-edges.test.ts` like the three
markers beside it. The recovery route is not refuted, only not taken; it stays available and it
would restore the round trip this withdraws.

### It withdraws a round trip from a document that reads `valid: true`, and that is the cost

Most of the refusals beside it cost the round trip only for models already reported `valid: false`
with `safeToSummarize: false`. **This one does not, because the root flag is a warning**, and the
module docblock's own sentence already covers the case: `breaksTag` and `assertXmlResourceType` each
name a document of their own that reads with zero issues and is refused anyway. This is the third.
The cost is bounded to the class and the bound is pinned: a FHIR-rooted document still round-trips
byte-identically, a root declaring **no** namespace is still read as FHIR and still written, an
**unbound**-prefix root is still modeled under its verbatim tag and was still written (its write is
refused since 2026-09-24, on `UNSERIALIZABLE_PREFIXED_NAME` at the tag sites and never by this
refusal), and `serializeResource` emits every one of them, this class included.

### The class, which is one of the two arms of the root's own flag

`rootVocabularyIsForeign` fires when the root RESOLVED to a namespace that is neither FHIR's nor
none at all, by a default declaration or a bound prefix. It deliberately does not cover the other
arm of `rootIsForeign`, the unbound prefix: that root reads differently in every respect and closing
its round trip is `FHIR-UNBOUND-PREFIX-ROUNDTRIP`, whose deferral held until 2026-09-24, when its
tag-site route closed and its own pins went red in the same change (the section above this one).
**The read is untouched.** Nothing was widened: the marker records, on the model, a
position the reader was already reporting, so the read window and the report window are still the
same window.

The refusal is raised **last** in `serializeResourceXml`, after every refusal above it, so a vendor
root that also carries dropped character data still reports `DROPPED_ELEMENT_TEXT` and no existing
case moves onto the new code. Its walk is `collectMarked`'s, so a vendor-rooted resource composed
into a `Bundle.entry` or a `contained` is refused at its own bounded location rather than only at a
document root: parse-then-compose is ordinary use of the public API and it launders the same way.

### `serializeResource` is untouched, and that is NOT a claim the JSON channel keeps the flag

It does not. `{"resourceType":"Observation","id":"o1","status":"entered-in-error",...}` is what that
writer emitted at base and what it emits now, and re-reading it gives an empty issue list, so the
JSON leg of the same trip still launders. That half is **declared open**, not closed here, and the
refusal's message says only what it does not reach rather than promising a route that keeps the
flag. The XML leg is what the pinned characterization test was about and what this closes.

### What could not grade this

`pnpm differential:read --base 2ac2d72` reports `readings moved 0` across 6 differing source files,
with `valid false -> true 0`, `safeToSummarize false -> true 0`, `read diagnostics lost 0`,
`validation findings lost 0`, `retractions lost 0`, `negations lost 0` and `JSON fixtures moved 0`.
**Those zeros are a floor and not a proof of this change**, and the reason is structural: every XML
fixture in the corpus is FHIR-rooted, so no document in front of the harness has a foreign root and
none reaches the new refusal at all. Beside that, the harness's two standing limits both apply here
-- `emit()` records every refusal as one sentinel, so `sameReading` cannot see WHICH refusal fired,
and the leaf comparison SKIPS a refused document.

So the control was extended rather than the numbers trusted. **Arm 4, `refusalBlindSpots`, is
DERIVED and not keyed**: it differences the two trees' own published `SERIALIZE_ERROR_CODES` and
names the refusals the run introduces, so it names this change while it is current and names nothing
once it has merged. That is the one property the deleted hand-keyed `CONTROL.moved` could not hold,
and both polarities are asserted in `test/scripts/read-differential.test.ts`. The run prints
`this run introduces 1 writer refusal(s): UNSERIALIZABLE_FOREIGN_ROOT` under `WHAT THIS RUN CANNOT
GRADE`, above the lines that refusal turns into floors. **A foreign-rooted document was deliberately
NOT added to `test/__fixtures__/` to make the number move**: the corpus is shared by every later
slice and the scanner sweeps it, so the honest move was to declare the floor rather than to
manufacture a figure. What DOES grade the change is `test/xml.test.ts`, whose rewritten block was
observed **red in 8 assertions** against the unchanged tree before it was made green.

## A pinned release was not a pinned oracle (2026-08-27)

**READ THIS BEFORE ANY PARAGRAPH BELOW THAT DESCRIBES THE DIFFERENTIAL, INCLUDING THE NEXT SECTION.**
The section below is the corpus as of 2026-08-25 and it is right about everything except two counts
and one assumption. The counts: **266 declared, 179 compared, 87 excluded**, 169 of the 179 third
party, because six exclusions came back (below). The assumption: that pinning the oracle to a release
and identifying it by the jar's own bytes made a verdict reproducible. It did not.

**The reference validator's `-tx` option defaults to the public `https://tx.fhir.org`**, and the
harness never passed one. So the oracle resolved `Coding.display` and code membership over a network
whose content and availability move under the harness's feet, and a differential verdict was a
function of the day it ran. That is what put three documents into the safety-critical `FALSE VALID`
bucket in one CI run with **no document, no library change and no pinned artifact having moved**, and
why a downstream change could not land: a gate that answers differently on a re-run clears nothing.
The corpus carried the same symptom one level up, in a block of exclusions whose recorded reason was
a disagreement "measured against validator_cli 6.10.2 on 2026-08-25". An exclusion list derived from
what a remote service answered on a date is a snapshot, not an invariant, and a document whose
terminology finding appeared after that date was never on it.

**TWO PROPERTIES WERE BOUGHT AND THEY ARE NOT THE SAME PROPERTY.** The first alone would still fail
the same documents on every run; the second alone would still let a network outage change what the
oracle returned.

- **The oracle cannot be influenced by a remote service.** Every run DECLARES its terminology inputs
  in `scripts/differential/terminology.mjs`. What this repository declares is **`source: "none"`**:
  `-tx n/a` and `-txCache n/a`, both sentinels documented by the pinned release. **`-txCache` is not
  a nicety**: an omitted one is a directory of whatever some earlier run got back from a network on a
  date nobody recorded, which is the same non-determinism one indirection away. **Terminology content
  was deliberately NOT pinned into this repository**: the library vendors none, the corpus documents
  are fetched rather than committed precisely because git history is not undone by a revert, and a
  pinned terminology cache would put a third party's code-system content into that same history to
  answer questions this library does not answer either. `source: "pinned"` exists, is graded, and is
  declared by nothing here.
- **THE AUDIT IS ON THE ARGV, NOT ON THE CONSTANT, AND IT RUNS BEFORE A DOCUMENT IS STAGED.** A
  constant somebody hopes is used is not a property of the run. `auditTerminologyArgv` reads the argv
  the oracle is about to be invoked with and refuses an absent `-tx` (the default IS the network), a
  `-tx` or `-txCache` naming a network location, an option spelled twice, and a cache directory the
  run did not declare. Every refusal compares **no document**, names the condition and exits
  non-zero, and **substitutes no other terminology source** when a declared input is absent,
  unreadable or the wrong digest.
- **A terminology finding is a RECORDED CLASS, never a verdict.** `compare.mjs` classifies a
  terminology-attributable oracle finding out of **both** invariants, counts it and prints it per
  document. **This is not a weakening**: the corpus already granted those documents the same relief
  by hand, through exclusions measured on one date, and a rule beats a snapshot.
- **THE CLASSIFIER KEYS ON THE VALIDATOR'S OWN VOCABULARY AND ON NOTHING ELSE**: the `tx-issue-type`
  code system a message id is drawn from, the R4 issue code `code-invalid`, and a message id that
  NAMES terminology (`Terminology_*`, `tx-*`). **`not-found` IS DELIBERATELY ABSENT**: the validator
  also uses it for a definition it could not resolve in its own loaded packages, which is profile
  resolution, and the corpus records exclusions under exactly that reading. Admitting it on the code
  alone would classify a non-terminology error out of Invariant 1, the one direction that may never
  widen. `invalid` is out for the same reason. **An oracle error or fatal outside the class, on a
  document this library reports clean, is still a false valid and still fails the run.**
- **THE DIRECTION THAT IS EASY TO GET WRONG.** When the oracle's only errors are terminology findings
  and this library reports an error of its own, the old accounting called that agreement. Stripping
  the finding naively turns it into a SPURIOUS ERROR, which is a violation the **absence** of a
  terminology finding decided, and the whole point is that such a finding decides neither direction.
  That document is `terminology-delta`: **not a violation, still COMPARED, still counted.**
- **Six exclusions came back and the compared count ROSE.** Six documents were held out with
  `code-invalid` as their only recorded class. They are compared now, under the class above.
  Determinism bought by comparing less is not determinism: the compared count may rise and may not
  fall, `test/differential-corpus.test.ts` pins that, and it also fails if an exclusion whose only
  recorded class is `code-invalid` ever reappears. Exclusions naming any other class are untouched.
- **DETERMINISM IS MEASURED, NOT INTENDED.** A configuration that intends determinism and a run that
  exhibits it are different claims. `pnpm differential:determinism` runs **two** comparisons of the
  DECLARED `determinismSubset` against the same artifact under the same inputs and passes only when
  the two **run records** are byte-identical. A run record is a pure function of the run's inputs by
  construction (named fields only), so **no wall-clock time, no staging path and no run ordinal** can
  reach it, and the documents are keyed by their declared id and sorted.
- **IT NEVER SKIPS, AND NEVER GIVE IT A SKIP BRANCH.** A missing jar, an unidentifiable artifact,
  inputs it cannot honour, no declared subset, or **any document that yielded no readable outcome**
  all report **determinism NOT demonstrated** and exit non-zero. Two runs that both failed to obtain
  an answer produce identical records, and reading that as agreement would let a permanently broken
  oracle certify its own determinism. A silent skip would make a green job mean "the oracle was
  absent" and "the oracle answered the same way twice" interchangeably.
- **It repeats a SUBSET because the job's bound is real**, not because the corpus is optional. The
  differential job declares thirty minutes and 179 documents do not go through a JVM oracle three
  times inside it. The subset is DECLARED in `corpus/corpus.json` rather than sampled (a check that
  chose its own documents each run would measure a different thing each run), every repeated id is
  printed before the first comparison, and **every declared document is still digest-verified on both
  comparisons**: `only` narrows what is handed back, never what is verified.

## The differential corpus is no longer ten fixtures (2026-08-25)

**READ THIS BEFORE ANY PARAGRAPH BELOW THAT DESCRIBES THE DIFFERENTIAL CORPUS.** The phase-history
entries further down say the `validator_cli.jar` differential runs over the synthetic spec-clean tier
plus the Tier-2 quirk corpus. That was true, it was **ten documents, five of them written here**, and
it is now superseded. Those paragraphs are history and stay verbatim; this is the current state.
**The counts in this section are themselves superseded by the section above** (2026-08-27): 179
compared and 87 excluded, not 173 and 93.

- **The corpus is declared in `corpus/corpus.json`**, not in two arrays inside
  `scripts/differential.mjs`. It is **three corpora, and only the first was written here**: this
  repository's own spec-clean + quirk fixtures (kept in full, MIT), `FHIR/fhir-test-cases` at tag
  `1.7.67` (Apache-2.0), and the FHIR R4 `4.0.1` specification's own published examples (CC0-1.0).
  **266 declared, 173 compared, 93 excluded**, 163 of the 173 third party. Every declared document
  records its corpus, that corpus's exact pinned version, that corpus's licence identifier, its byte
  count and a SHA-256.
- **THE EXCLUSION RATE IS PART OF THE RESULT AND MUST BE QUOTED WITH THE COUNT.** 93 of 266 are held
  out, each with a reason measured against `validator_cli` 6.10.2 on 2026-08-25 and printed every
  run. The classes are almost entirely one thing: the oracle resolves canonical URLs
  (`identifier.system`, `url`, `instantiatesUri`, `library`, `relatedArtifact.resource`,
  `Attachment.url`) and checks `coding.display` and code membership against terminology content, and
  this library does neither and has always said so. **A few sit outside that class** and their codes
  record it (`structure`, `invariant`, `business-rule`, `not-found`, `unknown`); the largest single
  one is a `Questionnaire` in a Bundle with 50 `structure` findings. **Do not report "173 documents
  agree" without "93 do not, here is why".**
- **The third-party documents are FETCHED, NEVER COMMITTED** (`pnpm corpus:fetch` into the
  git-ignored `corpus/documents/`). That is a **safety** decision before a licensing one: real FHIR
  examples spell `family`, `given`, `birthDate` and `line`, the PHI scanner sweeps what git carries
  repo-wide and gives anything outside `test/__fixtures__/` the source pass, and its allow-lists are
  declarations about **self-authored synthetic fixtures**. Vendoring would have forced a token-level
  entry per name and date in someone else's corpus, permanently, because content committed into git
  history is not undone by a revert. **The layout changed instead of the safety control:**
  `scripts/phi-allow-list.txt` and `phi-scan-overrides.md` are byte-identical to what they were.
- **The oracle is pinned to a release**, not `releases/latest`, and its identity is derived from the
  **jar's own bytes**: substituting a different artifact changes the recorded identity even when the
  configured version string does not. No identity, no comparison.
- **A missing answer is never agreement.** A document counts as compared only when BOTH sides
  produced a readable answer; a crash, a timeout, unparseable output or an outcome that cannot be
  attributed to exactly one document leaves it uncounted and NOT clean. Below the declared floor the
  run exits non-zero and names the shortfall.
- **An exclusion needs a reason, and the reason is printed every run.** Two documents are excluded
  today and both reasons are in `corpus/corpus.json`. **Do not close a disagreement by loosening what
  the validator reports**: exclude with the reason recorded and make the shortfall up elsewhere. And
  **do not hand-author a document to reach the floor** (ADR 0018): that satisfies the count and
  destroys its meaning.
- **What the number buys is bounded, and saying so is not modesty.** The built-in structural schemas
  are `Patient` plus the safety-critical types, and **read that set off `BUILTIN_SCHEMAS`, never off
  this line**: it said "only `Patient`" for weeks after `Observation` joined it. Over every OTHER
  resource type this library still emits an informational `RESOURCE_NOT_MODELED` and no error, so
  agreement at scale mostly means "we invented no error on a real document the oracle finds clean".
  The safety-critical direction, never a false valid, is what the corpus makes harder to satisfy by
  accident, and it is exactly where the modeled set now is. The shared corpus labels its own `r4`
  half "not maintained": breadth there is not currency.
- **Still CI-only, still never observed green here.** No JVM in this container. Run
  `node scripts/differential.mjs` with no `VALIDATOR_CLI_JAR` and it prints the corpus and the
  exclusions it WOULD compare, then skips; that is what makes the accounting reviewable locally.
  The accounting itself is graded by `test/differential-{corpus,oracle,harness}.test.ts`, which need
  no build, no Java and no network.

## Gate discipline

Relocated VERBATIM to make room in `CLAUDE.md` for a PHI-scanner trap; nothing dropped, and the
umbrella's own always-read `CLAUDE.md` and the `work-on` skill state both of these every session.

- **Two refuter passes, then up to two narrow ones on the remedy diff. FOUR is the cap**
  (ADR 0016). A sub-problem that fails to converge twice gets **reverted and declared a gap**: a
  pure revert ships no ungraded behaviour, and a declared gap is not a claim.
- **The gates run on the strongest model**, always (ADR 0009/0024). Never set
  `CLAUDE_CODE_SUBAGENT_MODEL`: it silently overrides every refuter pin.

## Publish state (`FHIR-NPM-NAME`)

- **`0.1.0` WAS REFUSED ON 2026-09-25, AND THE NARROWED SHAPE IS RESTORED FOR THE NEXT ATTEMPT AS THE
  CONTROL THE ENTRY BELOW CALLS FOR.** The shared Release run
  [36193551694](https://github.com/cosyte/fhir/actions/runs/36193551694) staged `@cosyte/fhir@0.1.0`
  with `npm stage publish` (npm 11.19.0) and drew `E403` on
  `POST https://registry.npmjs.org/-/stage/package/@cosyte%2ffhir`, the provenance statement reaching
  rekor first (logIndex `2962104147`), exactly as before. Nothing was published and `0.1.0` is
  unused. That tarball was the full one: 10 files, 1.2 MB packed, 4.6 MB unpacked, with the README
  at 99.6 KB, the changelog at 316.9 KB and both sourcemaps.
  - **The shape now on `main`.** `files` names `dist/index.mjs`, `dist/index.cjs`, `dist/index.d.ts`,
    `dist/index.d.cts` and `LICENSE`, so the maps and `CHANGELOG.md` stay out: 7 files, 416.4 KB
    packed, 1.5 MB unpacked, the same file list `0.0.10` shipped. The README is NOT a stub this time:
    it is a slim page (about 10 KB) with the install block and the executed quickstart, and it
    carries none of `XXE`, `billion laughs`, `ENTITY`, `DOCTYPE`, `exploit`, `payload`, `attack` or
    `malicious`, the XML reader being described as accepting plain XML only. The full capability
    readout moved to `documentation/capabilities.md`, which does not ship. Counted over the packed
    bytes, the two bundles and the two declaration rollups carry the SAME whole-word counts as
    `0.0.10`'s did (per rollup 7 `XXE`, 7 `billion-laughs`, 20 `entity`, 5 `DOCTYPE`; per bundle 3,
    3, 7 and 5), because that vocabulary is in `src/` doc comments and one error message, and
    stripping it is a regression that was not done.
  - **What the next attempt separates, and what it does not.** `0.0.10` was a direct `PUT` that
    created the package; `0.0.11` a direct `PUT` adding a version; `0.1.0` a staged `POST` adding a
    version. If the narrowed staged publish is accepted, the contents are the variable for adding a
    version through this path. If it is refused, the contents alone are not the cause, and the
    operation (adding a version, or staging it) is the live question. Either way it is ONE
    observation: the rule below about single publishes still binds.
- **NOT RESOLVED. `0.0.10` PUBLISHED, `0.0.11` WAS REFUSED, AND THIS ENTRY PREVIOUSLY SAID
  "RESOLVED".** That is the first thing to read here, because the wrong version of this paragraph
  was written from a single successful publish and the very next publish refuted it inside 48
  hours. `@cosyte/fhir@0.0.10` is on the registry, `latest`, tagged, with provenance, published
  2026-08-26 with a deliberately NARROWED tarball. `0.0.11`, which restored the README, the
  changelog and the sourcemaps, drew the identical bare `E403` on
  `PUT https://registry.npmjs.org/@cosyte%2ffhir` on 2026-08-28
  (run [33177512959](https://github.com/cosyte/fhir/actions/runs/33177512959), provenance in rekor
  at logIndex `2626322912` BEFORE the refusal, matching every earlier attempt). `package.json` runs
  ahead of the registry at `0.0.11`, unpublished, no tag.
  - **THE TWO ATTEMPTS, AND WHAT THEY DO AND DO NOT SEPARATE.** `0.0.10` shipped 7 files and
    782 KB packed with `files` narrowed to the four runtime artifacts, no sourcemaps, no changelog
    and a 234-byte README, and it SUCCEEDED. `0.0.11` shipped 10 files and 2.4 MB unpacked with the
    README at 84,818 bytes, the changelog at 281 KB and both sourcemaps back, and it was REFUSED.
    Same account, same pipeline, same shared workflow, two days apart. **That makes the contents the
    leading hypothesis, which REVERSES what the previous version of this entry said.**
  - **THE CONFOUND, WHICH IS REAL AND MUST NOT BE DROPPED.** `0.0.10` CREATED the package;
    `0.0.11` ADDED A VERSION to a package that now exists. Those are different registry operations
    with different policy paths, and both the contents AND the operation changed between the two
    attempts. **Neither hypothesis is established.** The control that separates them is a NARROWED
    republish now that the package exists: if a narrowed `0.0.12` succeeds, contents is the variable;
    if it is refused, the create-vs-add distinction is.
  - **DO NOT CONCLUDE FROM ONE PUBLISH.** This whole entry is the worked example. A month of `E403`
    ended in one success, that success was written up here as resolution, and the next publish
    restored the block. Publishes at this registry for this name are not repeatable enough to
    support a single-observation conclusion.
  - **What the publish that succeeded actually carried.** npm support wrote on 2026-08-26 asking
    for a sanitized publish: a `files` allowlist, a simplified README, no `*.spec.js`, and no
    strings readable as exploit content. Three of those five were already true. The allowlist
    existed, no `*.spec.js` could ship under it, and the version was already past the `0.0.9` they
    suggested. What their list did not mention was the sourcemaps: `files` named `dist` as a
    DIRECTORY, so `index.mjs.map` and `index.cjs.map` shipped, and each embeds `sourcesContent`,
    the complete original TypeScript of all 47 source files, 613 KB per map. Since the XML reader
    is hardened by refusal rather than by resolution, that source names what it refuses, and a
    count over the shipped bytes returned 104 `entity`, 37 `ENTITY`, 29 `XXE`, 28 `billion-laughs`
    and 26 `DOCTYPE`. The probe narrowed `files` to the four runtime artifacts, dropped
    `CHANGELOG.md`, and cut `README.md` to a stub, and `0.0.10` published with no `E403`.
  - **THAT CAUTION WAS WRITTEN BEFORE `0.0.11` AND ITS INSTRUCTION HAS NOW COME DUE.** It said the
    narrowing was never established as load-bearing and that a future refusal should be answered by
    re-running the sanitized shape as a control. `0.0.11` was refused, so **that control is the next
    experiment**, not an optional one.
  - **Stripping the sourcemaps did NOT zero the security vocabulary**, and this is worth keeping:
    80 `entity`, 26 `ENTITY`, 20 `XXE`, 20 `billion-laughs` and 18 `DOCTYPE` survived in the
    shipped bytes, about three quarters of the original count, all of it JSDoc compiled into the
    two declaration rollups. Going to zero means stripping JSDoc from the public declarations,
    which is a regression, and was not done.
  - **The post-publish window is real and the pipeline reads it wrong.** `changeset publish`
    returned `success` and created the tag while
    `GET https://registry.npmjs.org/@cosyte%2ffhir` was still `404`, with
    `/@cosyte%2ffhir/0.0.10` and the tarball already `200` and sibling scope packages `200`. The
    shared pipeline's post-publish install probe fired inside that window and failed the run with
    `verdict: uninstallable`. It resolved without intervention. **A 404 on the package document
    taken seconds after a publish is not evidence of anything**; re-read it before concluding, and
    that probe's verdict is not authoritative on its own.
  - **`0.0.10`'s tarball is not the intended package shape, and it is still what installs.** It
    carries a 234-byte README and no changelog. A published version is permanent, so it cannot be
    withdrawn, and the restoration merged but never published, so a consumer running
    `npm install @cosyte/fhir` today still gets the stub. Three feature PRs (#103, #105, #106) also
    landed while the README was a stub, so the restored README predates them and owes them their
    documentation.

### The block, as it stood from 2026-07-23 to 2026-08-26 (history)

- Every attempt was refused by npm with a bare `E403` on
  `PUT https://registry.npmjs.org/@cosyte%2ffhir` (FHIR-NPM-NAME; support request filed 2026-07-23).
  No version reached the registry and the repo carried no tag and no GitHub release.
  - **The "name-similarity" reading is RETRACTED. Do not rename or rescope the package on it.** npm
    has never named similarity or the unscoped `fhir` package in anything it returned; the only body
    it sends is its generic "forbidden by your security policy, or on a server you do not have
    access to" boilerplate. npm confirmed an unrelated incident and it was **not** the cause: retried
    after the fix, still `E403`.
  - **What is actually measured**, most recently on the `0.0.8` attempt of 2026-08-04 (run
    [30915771713](https://github.com/cosyte/fhir/actions/runs/30915771713), `PUT` refused
    `2026-08-04T13:52:56Z`):
    - The provenance statement is signed and **reaches the sigstore transparency log before the
      registry answers** (`0.0.8` = logIndex `2340587080`, `0.0.7` = `2335029918`, both verified
      present in rekor and decoding to `pkg:npm/%40cosyte/fhir@<version>`). So the refusal is
      registry-side name or permission policy, **not** a signing or provenance failure.
    - The `PUT` is refused in ~45ms with no response body, matching the ~72ms refusal of a local
      publish from a logged-in session. Same failure independent of publish path (OIDC vs classic
      token) and of account session.
    - Brand-new `@cosyte` packages were created on the registry successfully on **2026-07-29**
      (`transform`, `synth`, `cli`) and **2026-07-30** (`deid`), which is after the first `fhir`
      `E403`. Scope-level package creation therefore works, and only this one name is refused.
  - **Do not generalise the error code across the three affected packages.** Relocated VERBATIM from
    `CLAUDE.md` on 2026-08-11 to make room there for a PHI-scanner trap; nothing dropped, and the
    umbrella's own always-read `CLAUDE.md` carries the same clauses. `E403` is `fhir`'s **publish**
    refusal, at policy, after CI is green and after provenance reaches the transparency log.
    `transform`'s is an **install** failure (`E404`); `synth`'s is an **install** failure
    (`ERESOLVE`), and it fails **despite** the peer being declared optional, so never re-derive from
    `peerDependenciesMeta` that it cannot. `deid` and `cli` are not blocked. **Publish state and
    installability are independent.**
  - **Do not re-fire a version npm has already traced:** `0.0.2` (logIndex `2228360533`), `0.0.3`
    (`2259690084`), `0.0.7` (`2335029918`), `0.0.8` (`2340587080`).
  - The failing run uploads the npm debug log as an artifact (`npm-debug-log-cosyte-fhir-*`), which
    is what npm support asked for. It is redacted and gated in `cosyte/.github`, and the `0.0.7` and
    `0.0.8` artifacts were both checked by hand: npm 10.9.8 records config file **paths** only, never
    their contents, and no `Authorization` header, so no credential material is present. **This repo
    is public and the artifact is downloadable, so re-check that before ever linking one.**

## Shipped-phase history, P11 back to P1

- **Phases 1 to 9 landed; P10 landed (halves a + b); P11 buildable
  tiers landed.** P11 (buildable portion; roadmap §6): conformance hardening as gating tests: a
  **JSON+XML+NDJSON fuzz tier** (`test/fuzz.test.ts`, `FUZZ_RUNS`-tunable, a dedicated `fuzz` CI job)
  proving adversarial input never crashes/hangs/OOMs: only a **typed** `FhirCodecError`/`FhirXmlError`
  with a registered fatal, or a bounded rejection; a **PHI-leak tier** (`test/phi-leak.test.ts`, corpus
  sweep + sentinel battery) gating the value-free-diagnostics contract; a **type-level tier**
  (`test/public-types.test.ts`, `expect-type`). The fuzz tier surfaced three read-path robustness
  defects, now fixed: a **decimal DoS** (`0e9999999999999999999` made `FhirDecimal` quantity comparison
  do `10n ** astronomical-scale` → untyped `RangeError`/hang on the read path: now canonical-form
  comparison, no exponentiation, semantics unchanged); an **XML entity prototype-chain bypass**
  (`&constructor;`/`&__proto__;` resolved through `Object.prototype`, bypassing the five-entity
  allowlist: now `Object.hasOwn`-guarded); and a **validator DoS** (a resource property named
  `constructor`/`toString` crashed `validateResource` with an uncaught `TypeError`: now
  `Object.hasOwn`-guarded). New public fatal `FATAL_CODES.MAX_DEPTH_EXCEEDED` (JSON reader bounds
  nesting at 256, matching the XML reader). **Deferred:** the JVM `validator_cli.jar` differential is
  **authored but CI-only** (`scripts/differential.mjs` + a `differential` CI job: no Java in this
  container, not observed green here); as of **P10b** it runs over **both** the synthetic spec-clean
  tier **and** the Tier-2 quirk corpus. P10 (half a):
  the profile growth loop (profiling.html): `defineProfile()` authors a `StructureDefinition` in code
  from an ergonomic `ProfileSpec`/`ProfileElementSpec` and returns the **same model**
  `loadStructureDefinition` produces from JSON (proven byte-for-byte equal for a valid spec: one
  path, **no privileged internal shape**), flowing straight into `validateResource({ profiles })`; a
  conservative writer that throws a value-free `InvalidProfileError` on an author mistake. A
  publishable, spec-grounded **starter kit** (`VITAL_SIGN_OBSERVATION_STARTER`,
  `PATIENT_IDENTIFIER_STARTER`, `STARTER_PROFILES`, `starterProfile`, `STARTER_PROFILE_BASE_URL`)
  dogfoods it: each starter is a `defineProfile()` call, self-contained (differential-only, no bundled
  base), a _template_ not an authoritative vendor conformance statement. **Half (b): the Tier-2
  real-world _quirk_ corpus + the `validator_cli.jar` differential over it, landed (ADR 0018):** five
  quirk fixtures (`test/__fixtures__/quirk-*.json`), each **grounded in a public artifact** and cited
  in `test/quirk-corpus.test.ts` (the provenance record): a non-first `resourceType` (json.html), a
  scientific-notation decimal (Synthea #675, preserved byte-exact + `DECIMAL_PRECISION_AT_RISK`), a
  primitive-extension `_`-sibling misalignment that **fails closed** (HAPI #5738), a searchset Bundle
  `link[next]` that survives the round-trip (bundle-example.json), and US Core race + birthsex
  extensions preserved on a base Patient. Values are synthetic; the PHI-leak sweep auto-covers them.
  ADR 0018 redefined the anti-invention rule's "real document" to include public artifacts, unblocking
  this from `REAL-CORPUS`. A genuinely vendor-**proprietary** deviation absent from every public sample
  stays grounded-only (still forbidden to invent, conventions §PHI); missing-must-support
  (`MUST_SUPPORT_ABSENT`) and version-drift (`PROFILE_VERSION_MISMATCH`) quirks are already covered by
  the Phase-6 profile suite. `scripts/differential.mjs` runs this corpus through the oracle in the
  `differential` CI job (still JVM-only, not observed green here). P9: Bundles, references, Bulk NDJSON
  streaming (bundle.html / references.html / Bulk Data IG): the `Bundle` model + entry-processing
  semantics (`readBundle` / `entryProcessing` / `isAtomicBundle` / `BUNDLE_TYPES`) that keep
  **transaction = all-or-nothing (`"atomic"`) genuinely distinct from batch = independent
  (`"independent"`)**: the artifact + semantics are modeled, transactions are **never executed** (no
  server; stated non-goal); reference resolution (`resolveReference` / `buildBundleIndex` /
  `containedIndex`) for relative / absolute / logical / `#fragment` against a Bundle + `contained`
  closure (a local miss → `"unresolved"`, an out-of-closure target → `"external"`, never
  false-flagged), keyed version-free; a **DoS-safe cycle guard** (`hasContainedCycle` /
  `MAX_REFERENCE_DEPTH`): an iterative, heap-based, three-color DFS that detects and reports a
  contained reference cycle rather than looping (terminates always, no false positive on a DAG); and a
  **streaming `application/fhir+ndjson` reader** (`streamNdjson` / `parseNdjsonLine` /
  `NDJSON_ERROR_CODES`) with **per-line error isolation** (malformed line → isolated value-free error,
  stream continues, reported by line number never content) and **no whole-file load** (only the current
  partial line buffered; an unterminated line cut off `LINE_TOO_LONG` and drained without accumulating),
  each line read through the precision-preserving codec (a decimal never through a JS `number`). New
  value-free findings wired into `validateResource` for a `Bundle`: `REFERENCE_UNRESOLVED` (warning,
  preserved), `CONTAINED_CYCLE` (error), `FULLURL_ID_MISMATCH` (error, `urn:uuid` fullUrl exempt); adds
  the R4 `not-found` `IssueType`. Deferred, fail-safe intact: no transaction **execution**. P8: XML codec + cross-format equivalence
  (xml.html): a **zero-dependency** FHIR XML codec that reads/writes the **same schema-free model** as
  the JSON codec. `parseResourceXml` (→ shared `ReadResult`) / `serializeResourceXml` (spec-clean,
  byte-for-byte round-trip), a hardened raw reader `readRawXml` (→ `XmlElement` tree) that is **XXE- and
  billion-laughs-proof by refusal**: it refuses any `<!DOCTYPE` (`DTD_FORBIDDEN`, closing the XXE and
  billion-laughs vectors at once) and any entity beyond the five predefined + numeric character
  references (`UNDEFINED_ENTITY`), does no I/O, resolves no URI, and bounds depth (`MAX_DEPTH_EXCEEDED`),
  via `FhirXmlError` / `XML_FATAL_CODES`. Mapping: root/contained element name → synthetic
  `resourceType`; `value` attribute → primitive value **kept as its lexical string** (schema-free, no
  datatype guessed, precision never through a `number`); `id`/`extension` co-located (`id` attr + child
  `<extension>`s, the XML `_`-sibling); `Element.id`/`Extension.url` attrs → `id`/`url` props; repeated
  elements → list; resource-valued element unwrapped; narrative `Narrative.div` carried **opaquely** as
  its full XHTML string (the FHIR JSON representation) → round-trips as conformant `<div>…</div>`, never
  dropped/escaped. `nodesEquivalent` is the JSON↔XML equivalence oracle: equal **modulo** primitive
  lexical form and singleton lists (array-of-one ≡ one element), and only those. Lenient reads
  preserve-and-flag an unexpected namespace / stray text (new value-free issue code
  `UNEXPECTED_XML_CONTENT`). Deferred, fail-safe intact: XHTML **structure** inside `div` not
  modeled/validated (carried opaque, never dropped); typed cross-format transcoding (spec-clean JSON
  booleans/numbers from an XML model) needs the datatype schema; an extension-only element with no value
  reads as a primitive (schema-free ambiguity, documented on `nodesEquivalent`, safe direction);
  RDF/Turtle out of scope; XML-fuzz differential vs `validator_cli.jar` (Phase 11). P7:
  invariants via a bounded, vendored
  FHIRPath subset (the sixth-and-final validation layer, ADR 0002): an in-repo FHIRPath **lexer →
  parser → evaluator** (`tokenize` / `parseFhirPath` / `evaluateInvariant`; no runtime dependency, no
  full third-party engine) that evaluates a profile's `constraint[]` against an instance. The subset
  covers the R4 / US Core invariant surface: path/choice navigation, `$this`/`%resource`/`%context`,
  `exists`/`empty`/`not`/`where`/`all`/`select`/`count`/`first`/`last`/`distinct`/`hasValue`/`children`/
  `extension`/`intersect`, three-valued `and`/`or`/`xor`/`implies`, `=`/`!=`/`<`/`>`/`<=`/`>=`/`in`/
  `contains`/`|`, and System-type `is`/`as`/`ofType`, judged by the reference validator's boolean
  coercion (empty → violation, never a silent pass). `collectInvariantIssues` (wired into
  `validateResource({ profiles })`) emits `INVARIANT_VIOLATED` (severity mirrors the constraint's
  `error`|`warning`) or, for **any** expression outside the subset, `INVARIANT_UNCHECKED` (information)
  via `UnsupportedFhirPathError`: surfaced, **never assumed to pass** (roadmap §6 fail-safe).
  `loadStructureDefinition` now parses `constraint[]` (`ElementConstraint`); `generateSnapshot`
  accumulates invariants down the derivation chain. The seven named safety invariants
  (`ait`/`con`/`obs`) stay owned by the always-on Phase-3 safety layer (the engine skips those keys and
  covers every other constraint). Deferred, fail-safe intact: `type`/`profile` slicing discriminators
  and reslicing (still `PROFILE_SLICE_UNCHECKED`); bundled US Core IG corpus + `validator_cli.jar`
  differential (Phase 11). P6: StructureDefinition + US Core
  profile validation (the sixth layer): `loadStructureDefinition`; **snapshot generation** from a
  differential (`generateSnapshot` walks `baseDefinition`, merges/tightens by id, inserts slices, fails
  closed with `FhirProfileError` on an unresolvable base / cycle); **slicing** (`resolveSlices` /
  `matchSlices`: R4 discriminators `value|exists|pattern|type|profile`, **`position` R5-only and
  excluded**; unsupported/insufficient discriminators → `PROFILE_SLICE_UNCHECKED`, never silently
  passed); **`fixed[x]` (exact) vs `pattern[x]` (subset)** via `matchesFixed` / `matchesPattern`
  (decimals precision-exact); **must-support as a system obligation** (`MUST_SUPPORT_ABSENT` is
  **information, never error**, not instance-presence); multi-version `PROFILE_VERSION_MISMATCH`
  against `meta.profile` pins; a bounded path navigator (`resolvePath` / `pathExists`). Runs inside
  `validateResource(resource, { profiles, resolveBase })`; **no profile content is bundled** (US
  Core/vendor SDs are supplied by the caller). Deferred: bundled US Core IG corpus + `validator_cli.jar`
  differential (Phase 11); `type`/`profile` discriminators, reslicing, invariant `constraint`s (Phase
  7 FHIRPath). P5: Terminology binding validation
  (strength-aware, content-free): a frozen **known-systems registry** (`KNOWN_SYSTEMS` /
  `isKnownSystem`, the verified §5 `system` URIs as identities: no SNOMED/CPT/LOINC content vendored,
  ICD-10-PCS/HCPCS deliberately omitted per §10); **binding-strength severity** (`required` → error,
  `extensible` → error-unless, `preferred` → warning, `example` → info and never an error) via
  `TERMINOLOGY_BINDINGS` / `buildBindingRegistry`; content-free system checks (`CODE_SYSTEM_UNEXPECTED`
  for a known system outside the binding's value set, `CODE_SYSTEM_UNKNOWN` info for an unrecognized
  one); the roadmap-named **multi-system** bindings (allergy substance RxNorm + SNOMED, medication
  RxNorm); and a **pluggable terminology-service interface** (`TerminologyService`, none bundled) that
  gates the only membership finding (`CODE_NOT_IN_VALUESET`). With no service, checks degrade to the
  content-free system level and never false-error (roadmap §5). `collectTerminologyIssues` runs inside
  `validateResource(resource, { terminology, bindings })`. P4: Quantity / UCUM fidelity (results
  & doses): `readObservationValue` discriminates the **11-way `Observation.value[x]` choice** (branch
  on the present type: a `"POSITIVE"` string or a `1:64` titer is never read as a number); the
  machine-actionable unit is the UCUM **`code`** (not the `unit` string), shape-checked
  (`validateUcumShape`) but never converted; **vital-signs required-unit** conformance
  (`VITAL_SIGN_UNIT_NONCONFORMANT`) against the profile's closed table; UCUM shape warnings
  (`UCUM_UNIT_UNRECOGNIZED`) and `VALUE_TYPE_UNEXPECTED`; dose `Quantity` for
  MedicationRequest/Statement; `interpretation`/`referenceRange` surfaced but never evaluated. P1:
  the no-data-loss core: a
  precision-preserving JSON codec (`parseResource` / `serializeResource` / `readRawJson`), the
  string-backed `FhirDecimal` / `FhirInteger64` primitives (ADR 0001), the primitive-extension
  (`_`-sibling) model with null-padded array alignment, an immutable generic element model
  (`FhirComplex` / `FhirList` / `FhirPrimitive`), `parseReference`, and value-free diagnostics.

## `FHIR-DUPLICATE-KEY-RETRACTION` (2026-07-28)

**`FHIR-DUPLICATE-KEY-RETRACTION` (2026-07-28) closed a silent, unsafe-direction defect in this
core:** a duplicate JSON property name dropped the later value (first-wins, no issue), so
`{"status":"final",…,"status":"entered-in-error"}` lost the retraction and `readSafety` reported
`retracted: false, safeToSummarize: true`. Of the three separable decisions, **which value wins is
deliberately unchanged** (still first-wins: RFC 8259 §4 leaves it undefined, FHIR json.html forbids
duplicates outright, and last-wins would only move the blind spot); what changed is that the
shadowed member is now **kept** (`FhirComplex.duplicates`, read via `getAllProperties`) and
**reported** (`ISSUE_CODES.DUPLICATE_PROPERTY` warning on read, `VALIDATION_CODES.DUPLICATE_PROPERTY`
**error** in `validateResource`), and that `readSafety` **stops affirming**: **all six** negation reads
now run over every value written for the element each reads (`status`, `verificationStatus`, `code`,
`doNotPerform`), and `codingsOf` reads every `coding` plus every `system`x`code` pair inside a repeated
`Coding` name, so the reported case reads `retracted: true` and a retraction nested one level inside a
`CodeableConcept` is caught too; and any repeated name anywhere sets `safeToSummarize: false` with the
locations in `SafetyReadout.shadowedProperties` (`assertSafeToSummarize` throws). The `_`-sibling was
**last**-wins and silent; it is now first-wins + flagged like everywhere else (its shadowed member is
not modeled: an R4 `Element` carries `id`/`extension` only, so it cannot make a verdict wrong). The
writer emitted one member per name, deliberately, at the time; that decision was **superseded
2026-08-08** and both writers now refuse ([`#the-shadowed-member`](#the-shadowed-member-2026-08-08)).
**Refuter pass one (`conformance-refuter`, REFUTED) drove all of that**; it also left two
`PRE-EXISTING` majors/minors as backlog lines, NOT fixed here: `readObservationValue` still returns
one of two written `valueQuantity` values with no signal on its own surface (no issue channel), and
read -> write -> read **launders** the defect (the writer emits the conformant survivor, so the
re-read is `valid: true`, `safeToSummarize: true`); `serializeResource`/`serializeResourceXml` return a
bare string with no channel to say so.

## `FHIR-ARRAY-WRAPPED-SCALAR` (2026-07-28)

**Pass two (NOT REFUTED) filed two more `PRE-EXISTING` ones,
the first worth queuing ahead of the next slice** -- and **`FHIR-ARRAY-WRAPPED-SCALAR`
(2026-07-28) closed BOTH of them.** They were: an **array-wrapped `0..1` element** reaching that
item's exact harm shape with no duplicate key at all (`{"resourceType":"Observation","status":
["entered-in-error"]}` -> `retracted: false`, `negations: []`, `safeToSummarize: true`,
`valid: true`, zero issues, because `primitiveString` returns `undefined` for a list and there is no
cardinality check without a per-resource model, and array-wrapping every element is realistic
generic XML->JSON converter output); and a **duplicated `resourceType` shadowing the type gate**,
since `typeOf` is a first-wins single-value read (`{"resourceType":"Observation","resourceType":
"MedicationStatement","status":"not-taken"}` -> `negations: []`). **Both are one defect** once you
see it: the type gate is what every type-scoped negation hangs off, so a single-value read of it is
the narrowest hole in the whole safety claim, and an array wrapper and a duplicate name are just two
ways to reach it. The fix has three parts. **(1)** The negation reads read _through_ an array
wrapper as well as across every written value (`primitiveStrings`/`primitiveBooleans`, internal,
recursive); `SafetyReadout.status`/`.resourceType` do too. **(2)** `readSafety` considers **every**
type the document names (`typesOf`, internal); `typeOf` is deliberately **unchanged** and still the
strict single-value read, because a _structural_ verdict should reject an unreadable type, not guess
one. **(3)** New `VALIDATION_CODES.ARRAY_WRAPPED_SCALAR` (**error**, `structure`) +
`SafetyReadout.arrayWrappedScalars` + `arrayWrappedScalars()` (public, mirroring
`shadowedProperties`), so the library **stops affirming**: `safeToSummarize` is `false` and
`assertSafeToSummarize` throws. `validateResource` also no longer returns early on an unreadable
`resourceType` without running the safety layer.
**The cardinality table is scoped ON PURPOSE and must not be widened casually**
(`SAFETY_SCALAR_ELEMENTS` = `status`/`clinicalStatus`/`verificationStatus`/`doNotPerform`/`code`, on
a **resource root** of a `SAFETY_RESOURCE_TYPES` type, plus `resourceType` on any root). It is the
cardinality of the closed set the safety layer already reads, **not** a per-resource model. A
name-only, depth-free rule emits a **false error on a conformant document**: `Questionnaire.code`
and `ElementDefinition.code` are both `0..*` in R4. That bound is pinned by tests in
`test/array-wrapped-scalar.test.ts` (25 assertions), not asserted in prose.
**The `conformance-refuter` REFUTED this slice THREE times, and the scope it ended at is narrower
than the scope it started at. Read this before touching `codingsOf`.** Pass one: the fix covered the
wrapper around the _element_ but `codingsOf` still read `Coding.system` / `Coding.code` with the
single-value `primitiveString`, and **those are `0..1` too** (datatypes.html), so one pair of
brackets around an inner `Coding.code` still produced the item's exact verdict on the three worst
reads in the library: a **refuted** allergy read as active, a recorded **"no known allergy"** read as
an allergy _to_ `716186003`, and a retracted Condition read as live. Pass one also caught two factual
errors, both corrected: the citation (the array rule is json.html **§2.6.2.2**, not §2.1) and
`MedicationRequest.status` (**`1..1`**, not `0..1`).
**Pass two and pass three then refuted two successive attempts to close that inner read**, and the
reason is worth keeping: `Coding.system` and `Coding.code` feed `codingsOf`'s `system` x `code`
**CROSS-PRODUCT**, so any rule yielding more than one value on either side **manufactures a
`(system, code)` pair the sender never wrote** -- and `NO_KNOWN_ALLERGY` is the one negation that is
a **positive clinical assertion**, so inventing it claims a patient has no known allergy over a
record that names an allergen. Missing a retraction withholds information; asserting an absence of
allergy does not. **The two directions are not equally safe, which is why the obvious fix is not.**
Attempt one read every value and manufactured the pair outright. Attempt two read only a
"single-valued" wrapper and **still** did, because it counted _strings_ rather than _array
positions_, and a FHIR JSON `null` is a real position marker, not padding (`["716186003", null]` is
two entries), so `[null, "...sct"]` x `["716186003", null]` still produced `(sct, 716186003)`.
**So `codingsOf` was reverted to its `main` behaviour and the inner wrapper was left a DECLARED GAP,
not a claim.** That was the ADR 0016 termination call: the same sub-problem had failed to converge
twice, there is no fourth pass, and a pure revert ships no ungraded behaviour. Everything that slice
shipped is element-level and was graded green.

## `FHIR-CODING-SCALAR-WRAPPER` (2026-07-29)

**`FHIR-CODING-SCALAR-WRAPPER` (2026-07-29) then closed it, on the third grading.** The predicate
that held is **at most one value per written member**: `codingScalar` (private, in `src/safety/codes.ts`)
reads a wrapper only where it holds **exactly one ARRAY POSITION**, so `systems` and `codes` have
precisely the lengths they had when a wrapper read as `undefined` and **the cross-product cannot
grow** -- unwrapping can only fill in a value, never add a pair. The clean statement of that, and
what the tests pin, is **transparency**: a single-position wrapper yields the same codings as the
same document with the wrapper removed, so unwrapping decides nothing on its own and any invention
that remains is the pre-existing duplicate-name cross-product's, not the wrapper's. Positions, not
strings, is what killed attempt two, and `codingScalar` counts `items.length`. The second half is
**the refusal to affirm**: `SAFETY_CODEABLE_ELEMENTS` (`clinicalStatus`/`verificationStatus`/`code`)
drives a `Coding`-level check in `checkArrayWrapping`, so **every** wrapper there (read or unread)
reports `<element>.coding[i].{system,code}` as `ARRAY_WRAPPED_SCALAR` and sets
`safeToSummarize: false`. That is what makes leaving the multi-position case unread safe rather than
silent. It needs no per-resource cardinality (`Coding` is a datatype, its `system`/`code` are `0..1`
everywhere), so unlike the element-level rule it cannot false-positive. **No public API changed.**
One direction to know: reading a wrapper can now retire an `ait-1`/`con-4` finding the unread version
emitted, and those were **false** findings; it can never turn a document `valid`, because the wrapper
is itself an error on the same `Coding`.
**The refuter REFUTED pass one of this slice too, and the finding is the one to remember: THE READ
WINDOW AND THE REPORT WINDOW MUST BE THE SAME WINDOW.** Pass one put `codingScalar` inside
`codingsOf` itself -- which every coding consumer calls -- while reporting only the windowed
elements. `requiredUnitsFor` reads `Observation.component[i].code` (a backbone element, outside the
window) and takes the FIRST LOINC coding with a vital-signs units entry, so making a wrapped
`8867-4` readable let it beat the `8480-6` beside it, a **true** `VITAL_SIGN_UNIT_NONCONFORMANT`
error disappeared, and the document went from `valid: false` to **`valid: true` with zero
diagnostics**. A false valid is the one direction the fail-safe contract forbids, and it was
`INTRODUCED`, not pre-existing. The fix was to CUT THE READ BACK, not to grow the guard: the unwrap
now lives in module-internal `safetyCodingsOf` / `safetyHasCoding` / `safetyHasCodeAnySystem` /
`safetyCodeOf` (none exported from the package), used only for `clinicalStatus` / `verificationStatus`
/ `code` on a safety root. `codingsOf` is back to its exact `main` behaviour, and `category`,
`interpretation`, `referenceRange.type` and `component.code` are untouched. **If you ever widen the
unwrap, widen `checkCodingWrapping` first, in the same change.** Pinned in
`test/array-wrapped-scalar.test.ts` (now 45 tests), including the refuter's exact document.
**Pass two came back NOT REFUTED**, with two `INTRODUCED` **minors**, both documentation-accuracy and
both fixed by correcting prose rather than code (the refuter's own call: a code change here would
reduce fail-safety). (i) The read window is **not** the report window: `checkArrayWrapping` gated the
coding-level report on `isSafetyType` while `isRetracted`'s `verificationStatus` scan and
`readSafety`'s `clinicalStatus`/`verificationStatus` convenience reads are **not** type-gated. **The
`verificationStatus` terms are CLOSED 2026-08-10**
([the `Coding` wrapper narrative](#narrative-the-coding-wrapper-report-moves-to-the-negation-reads-own-window)). **`clinicalStatus`
IS STILL OPEN and a gate caught a slice claiming otherwise**: `clinicalSystemFor` picks a preferred
system, gating nothing, so that field alone unwraps at any root with no location. **Do not "fix" a
window gap by type-gating `isRetracted`.** (ii) The
`checkCodingWrapping` JSDoc still claimed a wrapped element is not indexed, which the pass-one
finding-3 fix had already changed. Pass two measured, and could not break: no `valid: false -> true`
flip (0/380), no negation lost, no `safeToSummarize` weakened, all 26 fixtures byte-identical to
base, and `codingsOf`/`codeOf`/`hasCoding`/`hasCodeAnySystem` **bit-identical to base** over 600
generated documents.

## `FHIR-NESTED-ARRAY-REPORTING` (2026-07-29)

**`FHIR-NESTED-ARRAY-REPORTING` (2026-07-29) closed the affirming half of (b) below.** The item it
came from, `FHIR-NESTED-ARRAY-DATA-LOSS`, was **split by founder call** after the conformance gate
REFUTED the combined change twice (PR #35, a green-but-unmerged draft, closed unmerged). **Only the
REPORTING half shipped. The preserving half is deferred as `FHIR-NESTED-ARRAY-PRESERVATION` and you
must not fold it back in.** The measurement that motivated it: a **refuted** `AllergyIntolerance`
and a **resolved** `Condition` whose coding sat one level down inside a `CodeableConcept` both read
`valid: true`, `safeToSummarize: true`, `negations: []`; an entire resource inside a `Bundle.entry`
vanished with the same clean verdict; and a nested array inside a primitive's `_`-sibling drew **no
diagnostic at all**. What shipped: `ISSUE_CODES.NESTED_ARRAY` (warning, read), a `NESTED_ARRAY`
validation **error**, `SafetyReadout.nestedArrays` + public `nestedArrays()`, `isNestedArray()` on
the model (`markNestedArray` is reader-internal, deliberately NOT exported), `safeToSummarize: false`,
and a marker-sensitive `nodesEquivalent`.
**The rule needs no cardinality table and no element list**, unlike both array rules before it: FHIR
JSON gives a list of lists no meaning at ANY position (json.html §2.6.2.2), so it cannot false-fire
on a conformant document, and it runs at **every position the model has a node for** (every depth,
primitive `extension` metadata, `contained`, Bundle entries, and members a repeated name shadowed).
It is collected by a **separate walk** from `walkSafety` on purpose: it visits strictly more of the
document, and keeping them apart is what guarantees the new report cannot perturb an existing
finding.
**The gate REFUTED pass one, on exactly one thing, and it is the lesson to carry: the rule is NOT
total, and the first draft said it was, in five shipped surfaces including a `dist`-rendered
fail-safe sentence.** A `_`-sibling the reader discards WHOLE (one on an object or a non-primitive
array, or a member of a `_`-sibling object that is neither an `id` **string** nor an `extension`
array) leaves no node to mark, so an array inside one is reported against the discarded sibling and
draws **no refusal**: `{"name":{...},"_name":[[...]]}` still reads `safeToSummarize: true`.
**WHICH code reports it is per member, not one code for all three** (corrected 2026-08-08,
`FHIR-README-ARRAY-WARNING-WRONG`): that `_name` example draws `MISPLACED_PRIMITIVE_EXTENSION`, as
does a `_`-sibling on a non-primitive array; only an unrecognised member of a `_`-sibling object
(`{"birthDate":"1980-01-01","_birthDate":{"foo":[["x"]]}}`) draws `UNKNOWN_PROPERTY`. The
underlying loss is
`PRE-EXISTING` and identical on `main`; the **overclaim** was `INTRODUCED`. **The remedy taken was
the refuter's own: correct the claim and pin the gap with a test, NOT grow the guard** -- marking
inside those discard paths means reading raw JSON the codec does not model, which is new ungraded
read-path behaviour and belongs to the preserving half. A PARTIAL close would be worse than either:
it would report on the read channel with no node for the safety channel to see, which is exactly the
read/report asymmetry that refuted `#34` pass one. Pass one also filed three minors, all fixed: the
two channels disagreed on the path form for a primitive's `extension` (reader `._extension[0]` vs
safety `.extension[0]`, now both FHIRPath for the extension ITEM, with the reader's older warnings
left on their pre-existing `_`-form so no existing diagnostic string moved; one level INSIDE an
extension they still differ, pinned as a residual, because the durable fix is one path convention
for the whole reader rather than a deeper override); `nestedArrays()` could emit the same location
twice and its `@returns` claimed document order; and `markNestedArray` was publicly exported while
documented as reader-internal.
**The line that must hold: reporting is additive to diagnostics, preserving is a change to the data
model, and only the second carries the risk.** The inner array is still unread and unmodeled; the
node is the same empty complex / value-absent primitive it always was, carrying only an inert
`nestedArray?: true` marker, so `codingsOf`, `fhirpath/evaluate.ts::wrap`, `profiles/navigate.ts::step`
and `validate/terminology.ts::locatedCodings` all behave EXACTLY as before. **That is precisely what
refuted the combined attempt twice**: 19 files touch `.items` and at least 9 flatten a list into its
items without distinguishing a nested one, so producing a nested list silently redefines what a list
MEANS for every consumer; attempt one erased a true `VITAL_SIGN_UNIT_NONCONFORMANT` and asserted
`noKnownAllergy: true` over a record naming an allergen, attempt two retired an `error`-severity
profile invariant. **If your change makes a nested array visible to any walker, you have crossed the
line.**
**Evidence that no existing diagnostic was suppressed** (the mirror-image risk of `#34`'s refuted
pass one, and the thing to reproduce if you touch this): the reader's `UNKNOWN_PROPERTY` warning is
KEPT at those positions and `NESTED_ARRAY` is raised **alongside** it, never instead. Differential
over **1,639** documents (every JSON fixture x one mutation per path per mutation kind, plus a
hand-built corpus covering the `CodeableConcept` **ELEMENT** and not only its members, which is the
gap the previous attempt's own differential had): 0 read diagnostics lost, 0 validation findings
lost, 0 `valid: false -> true`, 0 `safeToSummarize: false -> true`, 0 negations/retractions lost, 0
locations lost from the three existing location lists, every convenience field identical, all 1,639
serialized byte-for-byte identical. Bought: 819 documents now report, 626 previously `valid: true`,
694 previously `safeToSummarize: true`, 24 previously **totally silent**.
**Evidence that no existing diagnostic was suppressed** (the mirror-image risk of `#34`'s refuted
pass one, and the thing to reproduce if you touch this): the reader's `UNKNOWN_PROPERTY` warning is
KEPT at those positions and `NESTED_ARRAY` is raised **alongside** it, never instead. Differential
over **1,639** documents (every JSON fixture x one mutation per path per mutation kind, plus a
hand-built corpus covering the `CodeableConcept` **ELEMENT** and not only its members, which is the
gap the previous attempt's own differential had): 0 read diagnostics lost, 0 validation findings
lost, 0 `valid: false -> true`, 0 `safeToSummarize: false -> true`, 0 negations/retractions lost, 0
locations lost from the three existing location lists, every convenience field identical, all 1,639
serialized byte-for-byte identical. Bought: 819 documents now report, 626 previously `valid: true`,
694 previously `safeToSummarize: true`, 24 previously **totally silent**.
**Walker inertness was MEASURED, not asserted**: a harness imports `origin/main` sources and head
sources into one process and runs both over 603 documents, exercising every walker at EVERY node
(**220,137** individual observations): the stripped model, `codingsOf`/`codeOf`/`hasCoding`, the
FHIRPath engine (9 expressions x every complex node), the profile navigator (12 paths x every node),
`collectTerminologyIssues`, `isRetracted`, `resourceType`, `serializeResource`. **0 differences**,
except `readObservationValue` in 38 documents where the inert marker is echoed through its
pass-through `node` field: 0 differ once the marker alone is removed, and 0 differ in any value it
reads. A caller-supplied `TerminologyService` also receives an identical call sequence on both
sides, so no `Coding` from inside a nested array reaches caller code.

## `FHIR-NESTED-ARRAY-PRESERVATION` (2026-07-29)

**`FHIR-NESTED-ARRAY-PRESERVATION` (2026-07-29) then closed the preserving half, on the third
grading of the underlying problem, and the shape of the fix is the whole lesson.** The two REFUTED
attempts both tried to model the inner array as an element, which made it **transparent to every
walker**. This one does not model it at all: the array's **exact JSON text** is kept on the node
(`FhirComplex.nestedArraySource`, `FhirPrimitive.nestedArraySource` /
`.nestedArrayMetaSource`, one per JSON channel because a repeating primitive can nest in either or
both at one position) and handed back by public `nestedArrayContent()`. **A string carries no edge
in the node graph**, so no walk can reach it, and the reader still never puts a `FhirList` inside a
`FhirList`. `serializeResource` writes the array back instead of emitting `[{}]`, so the finding
reproduces on a re-read rather than laundering; `nodesEquivalent` compares the text. The text is the
array re-rendered compactly, so it is **value**-exact, not byte-exact (whitespace goes, strings are
re-escaped), and such output is deliberately **not** spec-clean.
**Read `test/model-edges.test.ts` before you add a field to the model.** It derives the edge set
**mechanically** from the three interfaces of the closed `FhirNode` union rather than by grepping,
so it cannot miss a case: exactly four node-valued members (`FhirComplex.properties` /
`.duplicates`, `FhirList.items`, `FhirPrimitive.extension`), the preserved fields typed `string`,
and a census of the whole of `src/` pinning which files may touch them. **A node-valued field added
to the model now fails a test** instead of silently redefining what a repeating element contains.
**The audit was the deliverable, not the evidence** (founder call), measured at `b2c5ee7`: 57
`.items` sites across 21 files, 5 of them `RawArray` not `FhirList`; **3 flatten with no kind check at all**
(`profiles/validate-profile.ts::occurrencesOf`, `validate/validate.ts::occurrences`,
`quantity/dose.ts::asItems`, the first two counting a nested list as **one** occurrence for
`CARDINALITY_MIN`/`MAX`); **21 check the kind and then silently drop what is not it**, ten of those
toward a false `valid: true`; exactly **one** fails closed
(`safety/status.ts::checkModifierExtension`). All 57 are unaffected because nothing in `src/`
constructs a list of lists and this change does not start. The slice adds two sites under the same
count: one `RawArray` (`codec/raw-json.ts::rawJsonText`) and one inside a JSDoc `@example` on
`nestedArrayContent`, which flattens nothing. Those counts are a snapshot and the conclusion is
carried by the edge-set test, not by them.
**Two fixes in the same mechanism landed with it.** The writer **dropped a `resourceType` it could
not hoist** (anything but a string primitive), losing content at the loudest position in the
document (it now keeps its document position rather than being hoisted, which the `@returns` says);
and the reader now names a primitive's metadata in **FHIRPath form at every depth**
(`birthDate.id`, `birthDate.extension[0].url[0]`), which retires the `nestedPath` override in
favour of one convention for the whole reader. 25 distinct diagnostic expressions changed shape;
none was added or removed.
**Differential vs `b2c5ee7` over 2,622 documents**, both trees in one process, every walker at
every node: **0** read diagnostics lost, **0** validation findings lost, **0** `valid: false ->
true`, **0** `safeToSummarize: false -> true`, **0** negations/retractions lost, **0** locations
lost, **0** newly throwing. `readObservationValue` moved in 43 documents purely because its
pass-through `node` field echoes the inert marker (0 differ stripped, 0 in any value it reads).
Serialization changes are fully accounted for: 982 nested-array documents + 128 `resourceType`
ones, **0 from any other cause**, **0 outputs shorter**. All 982 laundered before, **0 do now**,
875 byte-identical to the input.
**Still open after it, each pinned by a test:** a **scalar written beside a nested array in the
same array** (`"given":[["Peter"],"James"]`) lands where an object was expected and is still
dropped (a different unplaceable shape, needing its own preserved form and public surface); and a
`_`-sibling the reader discards **whole** still leaves no node to carry either the marker or the
text, so the five shapes below are unchanged.

## Left open deliberately, a through e

**Left open, deliberately, each pinned by a test rather than a sentence:** (a) **CLOSED
2026-09-22 (`ARRAY_WRAPPED_CHOICE` + `UNSERIALIZABLE_CHOICE_WRAPPER`), and the closure red the
characterization test that pinned it, in `array-wrapped-scalar.test.ts` and
`xml-array-wrapper.test.ts` both.** What it used to pin: an array-wrapped `value[x]` drew **no**
code at all, `readObservationValue` had no issue channel of its own (it failed **safe** -- present
variant, `quantity: undefined`, so no wrong number was handed out -- but silently), and the XML
writer normalized the wrapper away, so `{"status":"final","valueQuantity":[{"value":5,"system":
"http://unitsofmeasure.org","code":"mg"}]}` came back from one write and one re-read as an
unambiguous **5 mg** under `valid: true` and an empty issue list. **THE SENTENCE THAT IS STILL TRUE
IS THE ONE ABOUT THE SAFETY LAYER**: `arrayWrappedScalars` is UNCHANGED, still draws nothing here,
and `safeToSummarize` does not move -- widening that closed set to every R4 `0..1` element _is_ the
per-resource model, and that is not what closed this. The cardinality came from the **value
readout's own walk** over the eleven `value[x]` variant names, at the two positions R4 spells that
choice (`Observation.value[x]` and `Observation.component.value[x]`, both `0..1`, observation.html),
at every Observation resource root including a `contained` or `Bundle.entry` one. **ONE WINDOW**:
the validator's code, `ObservationValue.encodingIssue` and the write refusal all read that single
call, never a table each. **DO NOT MAKE THE REFUSAL ARITY-BLIND** for the same reason the
element-level one is not: two items write as two elements, the re-read groups them into a list and
the report is raised again, so refusing them would withdraw a round trip that works AND keeps the
finding. The refusal is raised **last** of the seven, so nothing that already reported another code
moves onto it. **`readObservationValue` still reads nothing out of the wrapper**, and that is the
remedy, not a limitation: picking a member is authoring a dose. `serializeResource` is untouched and
that route stays open. The phase's **unbound-prefix** residual was NOT touched by this; its
tag-site route CLOSED 2026-09-24 with its own remedy (`UNSERIALIZABLE_PREFIXED_NAME`,
[`#the-unbound-prefix-round-trip-closed-at-the-tag-sites-2026-09-24`](#the-unbound-prefix-round-trip-closed-at-the-tag-sites-2026-09-24))
and its `div`-value route CLOSED after it (`UNSERIALIZABLE_DIV_PREFIX`,
[`#the-unbound-prefix-round-trip-closed-through-a-div-value-2026-09-24`](#the-unbound-prefix-round-trip-closed-through-a-div-value-2026-09-24)); (b) the JSON reader still does not model a nested array **as an
element**, and deliberately never will, but `[["x"]]` no longer loses the inner value: it is kept
as text and read with `nestedArrayContent()` (`FHIR-NESTED-ARRAY-PRESERVATION`, above). (c) The
**THE ARRAY ROUTE** does not launder read -> write -> read **through the JSON writer**: the writer
emits the list back, so the re-read reproduces the finding rather than losing it. That is pinned, so
a future writer change cannot quietly introduce it. **This line used to say the laundering was
"duplicate-key-only", and THAT IS RETRACTED: it was another universal written wider than the code,
and narrowing it to "within JSON" in the 2026-08-05 slice was still wrong.** Three counter-routes,
each reproduced at that date: the same array model through `serializeResourceXml` DOES launder,
because XML cannot spell a singleton wrapper at all (residual (e) below, pinned 2026-08-05); a
`_`-sibling the reader discards whole re-emits without it, so
`MISPLACED_PRIMITIVE_EXTENSION@Patient.name` reads on the way in and the re-read is **clean**; and
`{"given":[["Peter"],"James"]}` re-emits as `[["Peter"],{}]`, so the `UNKNOWN_PROPERTY` at `given[1]`
disappears while the two findings at `given[0]` survive. The last two are pre-existing, unpinned, and
belong to the residuals they come from, not to this one. **Do not restate the "only" here in any
form; state what is pinned.**

### `PHI-WARNING-MESSAGE-LEAK` (2026-08-02)

(d) **CLOSED by
`PHI-WARNING-MESSAGE-LEAK` (2026-08-02), and it was the wider half of the problem, not the narrow
one it was filed as.** It was filed as a `resourceType` reaching the `expression` prefix
(`ARRAY_WRAPPED_SCALAR@<whatever the document put there>.resourceType`, and on into the
`OperationOutcome`). Re-enumerating the sites found the **property name** is the same defect on a
far wider surface: 25 construction sites across the JSON reader, the XML reader, the validator, the
safety walk, terminology, dose, Bundle references and the profile layers, plus
`SafetyReadout.resourceType` on the model. Measured on named documents so the numbers can be
re-derived: `{"resourceType":"Patient","<1e6 b>":[["x"]]}` gave a **1,000,011-byte** `expression`
(21 on head), and `{"resourceType":"<1e6 b>","status":"final"}` gave a **1,000,222-byte**
serialized `OperationOutcome` (232 on head) and a 1,000,000-byte `SafetyReadout.resourceType`
(10 on head).
**The bound is a shape test, not a truncation**, and the mechanism is written down in
`src/model/path.ts` and nowhere else, so every other surface states only the consumer-facing
property. A name is echoed when it matches the published form it claims
(`elementdefinition.html` `eld-19`, a Rule, caps a path segment at 64 characters; `eld-20`, a
Warning, gives the two alphanumeric arms), and is replaced by a fixed marker otherwise. The
resource-type arm is tighter than `eld-20`'s and the tightening is **measured**, not assumed: all
148 codes in the R4 `resource-types` code system are letters only with an initial capital, 4 to 33
characters. The element arm is measured against R4's own definitions: of the 1,423 distinct
non-root segments across the 7,696 element paths in `profiles-resources.json` /
`profiles-types.json`, the only 74 failures are `choice[x]` _definition_ spellings, whose stems all
pass and which never appear as a JSON property name. Every conformant document reports exactly the locations it reported before, which is
what the 759 pre-existing tests passing unchanged demonstrates.
**Three things it does not do, none of them negotiable by wording.** A forgery genuinely shaped
like a FHIR name is still echoed, so the claim to make is that the echo is bounded, not that a
location carries no document content. `FhirComplex.properties[].name` stays exactly as the
document wrote it: the `hl7`/`deid` model-level lesson does **not** transfer, because those names
are content the writer reproduces byte for byte and bounding them would be data loss;
`SafetyReadout.resourceType`, the one derived identifier the model surfaces, **is** bounded. And
the four low-level location functions take their root prefix as a parameter, so a caller that
hands one an unbounded string gets it back, which is caller-supplied input rather than
document-derived. All three are pinned by tests in `test/derived-names.test.ts`, not by this
paragraph.
**Measured red on `origin/main` one slot at a time** (the shared `@cosyte/test-utils@0.0.2` runner
aborts on the first violation): 13 of 13 declared slots, 7 of 7 name sentinels, over **twelve**
distinct positions (two slots reach the expression root through different document shapes). Two
further `rootPath` calls, in the terminology layer and the dose locator, are provably the identity
wherever they are observable and are kept as defensive calls, named as such in the source; the
gate deliberately does not pretend to cover them. The reason the
package's own PHI tier never caught it: `phi-leak.test.ts` swept leaf **values** only, so no
sentinel it planted could land in a name.
**Provenance for every spec claim above, fetched 2026-08-02, not recalled:**
`hl7.org/fhir/R4/elementdefinition.html` (`eld-19`, `eld-20`),
`hl7.org/fhir/R4/codesystem-resource-types.json` (148 codes),
`hl7.org/fhir/R4/profiles-resources.json` + `profiles-types.json` (7,696 paths, 1,423 segments).
The conformance gate re-derived all four independently and found them exact.
**The refuter's pass-one measurements, worth keeping:** 2,912 official R4 JSON examples and 1,138
XML ones read byte-identically on base and head, with **zero** containing a withheld marker; a
4,000-document randomized differential moved no `valid`, `safeToSummarize`, `retracted` or
negation; the only tally that moved anywhere was the declared `nestedArrays` collapse (145 of
6,000). It also measured head **6 to 8% slower** on a loaded box, which matters only because the
two `fast-check` property tests sit near the 10,000 ms `testTimeout`.

### `FHIR-READER-RESIDUALS` (2026-08-02)

**Two `PRE-EXISTING` residuals it filed, neither introduced there and neither blocking, BOTH NOW
CLOSED by `FHIR-READER-RESIDUALS` (2026-08-02).** They were: the JSON reader emitting English prose
inside an `expression` (`" (unexpected _-sibling on an object)"`), never valid FHIRPath on any
input; and the XML reader not supporting namespace **prefixes**, so `<f:Patient xmlns:f="...">`
yielded properties literally named `f:active`.
**The XML half was far the larger of the two, and the measurement is the thing to keep.** Each of
the seven XML fixtures re-spelled with a prefix, compared to its default-namespace original on the
whole read (issues, serialized JSON, re-emitted XML, `valid` + findings, safety readout):
**0 of 7 matched on `cf16767`, 7 of 7 match now.** Three consequences, all measured on `patient.xml`
re-spelled: a **primitive extension was silently dropped** (`<f:extension>` failed the reader's
`extension` test), 337 serialized bytes down to **216**; the re-emitted XML was **not well-formed**
(`<f:Patient xmlns="http://hl7.org/fhir">`, `f:` bound to nothing, because the writer wrote raw
names back under a default-namespace declaration); and the document read **`valid: true` with no
element recognized at all**, a false green that now reports what the identical unprefixed document
reports. **The clinical shape: a prefixed `Observation` with `status="entered-in-error"` read
`status: undefined`, `retracted: false`, `isRetracted: false`.** It reads the retraction now.
The mechanism is a scope map threaded down the descent (`extendScope` / `resolveName` /
`ScopedElement` in `src/xml/read.ts`), with the implicit `xml` prefix pre-bound.
**🔴 THE GATE REFUTED PASS ONE ON EXACTLY THIS, AND IT IS THE THING TO REMEMBER: AN EXPANDED NAME IS
A NAMESPACE _AND_ A LOCAL NAME (Namespaces in XML 1.0 §6.1), SO GROUPING ON THE LOCAL NAME ALONE
MERGES FOREIGN CONTENT INTO THE FHIR ELEMENT BESIDE IT.** Pass one dropped the prefix from every
element it could resolve, so `<v:code xmlns:v="urn:vendor">` joined `code`'s occurrences. Measured
by the refuter, none reproducing on base: a **true `VITAL_SIGN_UNIT_NONCONFORMANT` error erased and
`valid` flipped `false -> true`**; **`noKnownAllergy` asserted `true` over a record naming an
allergen** (the one negation that is a positive clinical assertion, and the third time this repo has
reached that exact shape); a **retraction lost**; a foreign `<v:extension>` promoted into
`_birthDate.extension`; and `serializeResourceXml` **laundering** the whole thing, re-emitting the
vendor element as conformant FHIR so a re-read came back clean. **The remedy was the refuter's own
and it is a NARROWING, not a bigger guard:** one predicate, `isForeign`, governs **both naming and
flagging**: an element in its parent's namespace gets its local name and no flag, anything else
keeps its **tag verbatim** and is flagged, which is exactly what base did for every prefixed
element. That single predicate also fixes the `extension` test, the `div` test and the
resource-unwrap. **If you ever make a resolved local name reachable without comparing the namespace
it came from, you have reopened this.**
**🔴 PASS TWO THEN REFUTED THE PASS-ONE REMEDY, AND THE REASON IS THE ONE TO CARRY: "FOREIGN
CONTENT KEEPS ITS TAG VERBATIM" ONLY SEPARATES ANYTHING WHEN THE TAG CARRIES A PREFIX.** Reached by
a **default** `xmlns`, `<extension xmlns="urn:vendor">` and `<Patient xmlns="urn:vendor">` inside
`<contained>` have no prefix to keep, so the verbatim tag **is** the FHIR spelling: they group with
a FHIR sibling, satisfy the `extension` test, read as a resource name and read as the narrative
`div`, exactly as they did before namespaces were resolved at all. Worse, the pass-one code
**lost the diagnostic** on two of those routes: `readComplex` was called directly from the
extension branch and the resource-unwrap branch, both of which **bypass `buildSingle`, the only
place `flagForeign` ran**, so base emitted `UNEXPECTED_XML_CONTENT` and head emitted **nothing**
while still modelling the content as FHIR. Reproduced before designing the fix, not taken on
trust. **The remedy is two things and neither is a bigger guard.** (1) Both branches route through
`readNested`, which flags and then reads, so **every element the reader models is tested by
`isForeign` exactly once**; parity with base is restored on both routes. (2) **Every "never" claim
is scoped to PREFIXED foreign content** in the source, the tests, the changeset, `CHANGELOG.md` and
the README, because the claim was false for the unprefixed half on all four counts. The separation
covers prefixed content; the FLAG is what covers the unprefixed half.
**The unprefixed case is a residual, not a regression** (identical on base), pinned by its own
`describe` block in `test/xml.test.ts`.
**🔴 PASS THREE REFUTED THE REPLACEMENT SENTENCE, AND THIS IS THE THIRD TIME IN ONE SLICE THAT A
UNIVERSAL WAS WRITTEN WIDER THAN THE CODE. It refuted the CLAIMS, not the code: it could not break
the behaviour** (its own independent 283-document differential plus 34 adversarial documents found
0 `valid: false -> true`, 0 `safeToSummarize: false -> true`, 0 retractions or negations lost, 0
new throws, and it reproduced the 0/7 -> 7/7 headline and the 337 -> 216 byte drop with its own
re-speller). **The remedy it prescribed, and the one taken, is a TEXT correction in five files, not
another code round.** Two counterexamples, both reproduced here before editing, both **identical on
`cf16767`**: (1) **"every element in a namespace other than its parent's is reported"** is false,
because a child element beside a `value` attribute is **never modeled** at all: the primitive
branch of `buildSingle` discards it whole under `UNKNOWN_PROPERTY`, so a foreign child there never
reaches `isForeign`. The scope that IS true is **"every element the reader MODELS"**, and that is
now the wording everywhere. (2) **"the narrative `<div>` is not flagged for being there"** is false
for the **prefixed** spelling: `narrativeDiv` keys on `modelName === "div"`, a spelling test that a
prefixed tag can never satisfy, so `<h:div xmlns:h="...xhtml">` is flagged, is not read as
`Narrative.div`, and re-emits with `h:` unbound. Scoped to the unprefixed spelling.
**The lesson to carry out of all three passes is one lesson: in this reader, "every element" is
never the right subject of a sentence. Name the set the code actually walks.**
**The root is the one element with its own rule**, because it has no parent to take a vocabulary
from: it is always modeled by its local name, and it is flagged only when it _declares_ a namespace
that is not FHIR's. A document declaring **no namespace at all** is still read as FHIR and still
unflagged, exactly as before; do not "tighten" that into a refusal.
**A foreign namespace is flagged where the document LEAVES its parent's, not once per descendant**,
an element that merely inherits says nothing its ancestor did not. That is what keeps the existing
default-namespace behaviour byte-identical; do not "fix" it into a per-element flag.
**What reading the document correctly COSTS, and the gate's third demand: REPORT THE WIDENED READ
WINDOW OR DROP THE GROUPING.** Two prefixes both bound to the FHIR namespace are two spellings of
one name, so an element written twice that way is the repeat it genuinely is, and the MODEL and
every verdict over it match the same document spelled one way (`test/xml.test.ts` pins that). What
changes is the **count**, and a `0..1` check that reads a single value gets nothing from a list.
**Measured, and this is the case that decided it:** a `Reference.reference` written under two
spellings loses the `REFERENCE_UNRESOLVED` its one-spelling twin raises, with **no** compensating
diagnostic anywhere. **Reporting was taken, not dropping**, because dropping means two properties
of the same model name in one `FhirComplex`, and the XML reader has **no `duplicates` mechanism**
(that lives in the JSON reader), so it would be a silent first-wins loss: strictly worse. New
`ISSUE_CODES.MIXED_XML_SPELLING` (warning) + `mixedXmlSpelling`, raised in `reportMixedSpelling`
once per element whose group holds more than one literal tag. **Only a group in the parent's own
namespace can**, because anything else is modeled under its verbatim tag and lands in its own
group, so this cannot fire on foreign content and cannot fire on a single-spelling repeat.
At safety-scoped elements the repeat is **additionally** reported (`ARRAY_WRAPPED_SCALAR`, error),
so a retraction written through a second spelling is caught where the raw-tag read missed it.
**A sink that must NOT be answered by widening the cardinality table**: a duplicate reaching the
vital-signs unit check through `category.coding`. It is reachable today by writing the element
twice with ONE spelling, and CLAUDE.md already records why the table stays closed
(`Questionnaire.code` and `ElementDefinition.code` are `0..*`, so a name-only rule false-errors on
a conformant document).
**The `_`-sibling half is a REPORTING change, not a preserving one**, and the distinction is the
same one `FHIR-NESTED-ARRAY-REPORTING` turned on: new `ISSUE_CODES.MISPLACED_PRIMITIVE_EXTENSION`
(warning) + `misplacedPrimitiveExtension`, raised at the bare element location. It replaces the
`UNKNOWN_PROPERTY` those two sites raised **on purpose**: `UNKNOWN_PROPERTY`'s documented contract
is that a shape was tolerated and **nothing was lost**, and these two sites discard the `_`-sibling
**whole**, so the old code was making a false promise as well as carrying prose. The sibling's
content is **still not modeled** and this slice does not start; the five discard shapes above are
unchanged.
**Differential vs `cf16767` over 564 documents** (every XML fixture x six mutations at every
element position: a FHIR-prefixed, a foreign-prefixed and a foreign-DEFAULT-namespace duplicate
sibling, plus the element itself re-spelled into each of those three). 468 moved, and of those:
**0 `valid: false -> true`, 0 `safeToSummarize: false -> true`, 0 retractions lost, 0 negations
lost, 0 newly throwing.** 32 diagnostics disappear and **all 32 are at a `<withheld>` location** --
base complaining about a name like `f:active` it could not resolve and head reads correctly --
with **0** disappearing at a location that resolves. **The 7 XML fixtures unmutated: 0 moved.**
The foreign-default-namespace mutation is the one the previous differential did not have, and it
is what pass two used to refute; it is in the harness now precisely so it cannot be missed again.
**`test/expression-grammar.test.ts` is the gate that keeps prose out**, sweeping every reader
diagnostic the JSON and XML corpora produce against a location grammar.
**THE CLAIM IS SCOPED AND MUST STAY SCOPED. It is that the JSON reader's `expression` no longer
carries prose, NOT that every `expression` is resolvable FHIRPath.** Two forms deliberately are not,
and the grammar **admits** them rather than hiding them: a `<withheld>` segment, and the XML
reader's `.@name` attribute form. **`.@name` is a live residual**: an unmodeled XML attribute has
no FHIRPath address at all, and choosing one for it (the element? nothing?) is a separate decision
from removing a sentence, so it was left alone rather than folded in.
**Four `PRE-EXISTING` findings pass three filed, to pick up rather than fix here, none blocking and
every one identical on `cf16767`:** (i) a **prefixed narrative `<div>`** loses the narrative text
and still reads `valid: true` with zero findings, re-emitting `h:` unbound (finding 2 above, the
one worth queuing first, since it destroys clinical prose on a document that is legal XML)
-- **CLOSED, in two halves.** The spelling half went first: the narrative is recognised by its
**expanded name** `{http://www.w3.org/1999/xhtml}div`, so every spelling of the XHTML namespace
reaches `Narrative.div`. The **ordering** half followed, and it is the one to read before touching
`buildSingle`: `isResourceName` is a FHIR-vocabulary heuristic (UpperCamelCase names a resource
type) and the content of `Narrative.div` is XHTML, where it means nothing, so applied there it read
`<div xmlns="…xhtml">Take 5 mg<BR/></div>` as a contained `BR` resource and **destroyed the prose
with ZERO diagnostics under `valid: true`**, re-emitting the div stripped of its namespace so the
loss laundered on a re-read. HTML-4-era generators emit `<BR>`, `<TABLE>`, `<P>`. The narrative is
taken **before** the resource-valued unwrap now; `div` names exactly one of R4's 7,696 element
paths, so the order shadows nothing, and **no field was added to the model** either time.
**The cost, and the yardstick that settles it: reading a narrative as a narrative stops modelling
its insides as FHIR**, so `UNHANDLED_MODIFIER_EXTENSION` raised from inside one goes and such a
document flips `valid: false -> true` (32 of 1,019 in the differential). Measured against the
previous release that looks like suppression; measured against **the same document spelled the
other way** (a lowercase child, a default `xmlns`) nothing is lost: 394 of 396 twin pairs read
identically, 2 louder, **0 weaker**. **Re-run that comparison if you touch this branch; "did a
finding disappear" is the wrong question here.** The differential harness is
**committed** (`scripts/read-differential.ts`, `pnpm differential:read`), which the three reader
slices before it were not; it self-checks its tallies and refuses to report if the base tree it
loaded does not behave like base. The **resource-valued unwrap** is otherwise unchanged, except
that character data it discards beside the child now draws `UNEXPECTED_XML_CONTENT` instead of
vanishing in silence (reported, **not** preserved: there is no slot for it).
**`UNEXPECTED_XML_CONTENT` REPORTS TWO DIFFERENT OBSERVATIONS AND ONLY ONE OF THEM PRESERVES
ANYTHING**, which its shipped JSDoc now says. A foreign-vocabulary element **is** modeled;
character data written directly on a FHIR element is **dropped at every one of the three
`flagStrayText` sites**, because a FHIR element carries its value in `value=` (xml.html). The
first draft of that correction said only the unwrap site was lossy, which was a **new, precise,
checkable, false universal** shipped in `.d.ts`, and the gate broke it in one query. **In this
reader, count the call sites before you write "one" or "everywhere else".**
The new report is raised **only where its own location is otherwise silent**
(`unexpectedXmlContentAt`), because the foreign flag, the child's own stray text and the wrapper's
all land at one path and base emitted one there. **THAT SCOPE IS ONE CALL SITE, AND SAYING IT WAS
THE READER'S RULE IS WHAT REFUTED PASS THREE.** Elsewhere the code does land twice at one
expression when an element is both foreign and carrying text, unchanged from base and from every
release that has had this code. **This slice was refuted TWICE for the same thing: writing a new,
precise, checkable universal about this one code that the call sites do not support.** The first
said only one site was lossy (three are); the second said the code is once-per-location (one site
of four checks). **Count the call sites, then write the sentence, then check the sentence against
the count again.** The de-dup itself was first written against only one of the three, so the
**unprefixed foreign wrapper** still doubled: that is the same default-`xmlns` shape that refuted
`#44` pass two, and it is now in the corpus and pinned by a test.
**Five `PRE-EXISTING` residuals the gate filed on this slice, none blocking, every one reproduced
on `09b2805`:** an uppercase **`<DIV>` wrapper** is a different expanded name from `{xhtml}div`, so
it is not the narrative and still loses its prose (reported, not silent) -- the realism argument for
`<BR>` is the same argument for `<DIV>`, and recovering it means matching an element name
case-insensitively, a decision about the whole reader; the narrative is carried with whatever
namespace was in scope, so a `<div>` written under a FHIR or **absent** default declaration yields
a `Narrative.div` that is not in the XHTML namespace the datatype names, and
`serializeResourceXml`'s "conformant `<div xmlns=…>`" claim is wider than that; an **empty**
self-closing narrative round-trips as `<div xmlns="…"/>`, which has no characters between the
first `>` and the last `<`; and **25 of 1,107** corpus documents emit XML whose re-read moves, all
of them a `<contained>` holding **two** element children (so the unwrap does not apply), where
`Resource.id` written as a child element re-reads as the `Element.id` attribute the writer emitted.
That last one is worth keeping for a different reason: **the harness found it, and only because the
harness re-reads what each tree EMITS rather than only what it was given.** A differential that
parses its input alone cannot see output that is not well-formed, which is exactly the defect
`#46`'s pass one caught by hand.

### `FHIR-PRIMITIVE-AS-ELEMENT-TEXT` (2026-08-03)

**🔴 AND ONE `PRE-EXISTING` MAJOR THE GATE FILED, A CANDIDATE STOP-THE-LINE WITH ITS OWN ITEM, NOT
A BLOCKER HERE: A FHIR PRIMITIVE WHOSE VALUE IS WRITTEN AS ELEMENT TEXT RATHER THAN `value=` IS
DROPPED, AND THE SAFETY SPINE AFFIRMS OVER THE LOSS.** Byte-identical on `09b2805` and head, and in
the differential corpus (`primitive-text-not-value`, 0 of 44 moved) so it stays measured.
`<Observation …><status>entered-in-error</status></Observation>` reads `retracted: false`,
`safeToSummarize: true`, `negations: []`, `valid: true`, and `assertSafeToSummarize` does **not**
throw; an `AllergyIntolerance` whose `verificationStatus.coding.code` is written as text loses the
`refuted`; `<doseQuantity><value>5</value><unit value="mg"/></doseQuantity>` loses the **dose
number** while the unit and UCUM code survive. It is `UNEXPECTED_XML_CONTENT`-reported, so it is not
silent, but this is the `FHIR-ARRAY-WRAPPED-SCALAR` / `FHIR-CODING-SCALAR-WRAPPER` harm shape
reached through the XML door. Realism is **argued** (naive generators, generic JSON-to-XML
converters), not grounded in a public artifact: **grounding it per ADR 0018 belongs to filing the
item**, not to inventing a fixture
-- **CLOSED IN ITS REPORTING HALF ONLY (`FHIR-PRIMITIVE-AS-ELEMENT-TEXT`, 2026-08-03), AND THE
SPLIT IS THE WHOLE POINT: THE ADR 0018 GROUNDING GATE HALTED THE OTHER HALF.**
**▶ READ THIS BEFORE YOU TRY TO "FINISH" IT.** There are two separable changes here and only one of
them is a quirk. **Recovering the value** (reading the element text back as the primitive's value)
is a **TOLERANCE for a non-conformant encoding**, and ADR 0018 forbids encoding one without a real
publicly-cited document showing the shape. A search found the spec text (xml.html §2.6.1, "values of
primitive types in a `value` attribute") and one library-side serializer bug, **no real document**.
So the recovery half was NOT built, and **"not grounded, halted" was the correct outcome for it.**
**Refusing to affirm** is not a quirk at all: nothing new is recognised, no tolerance is added, no
value is invented, and the reader's report is byte-identical. It needs no vendor grounding, exactly
as `FHIR-NESTED-ARRAY-REPORTING`'s synthetic list-of-lists corpus needed none. **Do not cite ADR
0018 to block a refusal; cite it to block a tolerance.**
What shipped: `VALIDATION_CODES.DROPPED_ELEMENT_TEXT` (error, `structure`),
`SafetyReadout.droppedText` + public `droppedText()`, public `isDroppedText()` on the model,
`safeToSummarize: false`, `assertSafeToSummarize` throws, and a marker-sensitive `nodesEquivalent`.
`markDroppedText` is reader-internal and deliberately NOT exported, like `markNestedArray`.
**The marker is an inert `droppedText?: true` that carries NO CONTENT AT ALL**, which is a stronger
position than `nestedArraySource`: there is no preserved text here for a walker to reach or a
diagnostic to leak. `test/model-edges.test.ts` still derives exactly four node-valued members.
**THE MARKER LANDS AT ALL THREE SITES WHERE THE READER DROPS CHARACTER DATA**, counted in the source
(`readComplex`, the resource-valued unwrap, the primitive branch of `buildSingle`) and pinned by a
test each, because this reader has been refuted TWICE for writing a universal the call sites did not
support. **No new read-time issue code was added**: `UNEXPECTED_XML_CONTENT` already reported at
every one of them, which is exactly why this defect was loud and still harmful, and
`DROPPED_ELEMENT_TEXT` is raised ALONGSIDE it.
**The comparand was chosen deliberately and the twin section of the harness was NOT used.** That
section scores head against BASE's reading of the twin, and its "louder" branch requires `valid` and
`safeToSummarize` to MATCH the twin; a refusal moves both, so a declared twin would have scored this
slice **WEAKER** for doing exactly the right thing. The right bar for a refusal is base-vs-head
(head must report strictly more, never less), plus the conformant twin being unmoved base-to-head,
and both are in the main tally. **Do not declare a twin for a shape the reader still does not read.**
**Differential vs `6689239`, 1,195 documents:** 0 `valid: false -> true`, 0
`safeToSummarize: false -> true`, 0 retractions or negations lost, 0 read diagnostics lost, 0
validation findings lost, 0 newly throwing, 0 outputs shorter, **0 of 15,956 leaf values missing**,
narrative preservation unmoved at 758 of 836. Bought: **360 documents now report, 312 previously
`valid: true`.** The 27 re-read movers are `PRE-EXISTING`, 0 stable on base.
**🔴 AND THE HARNESS'S OWN NEGATIVE CONTROL WAS A PERMANENT FALSE RED, FOUND BY RUNNING IT.**
`negativeControl()` was hard-coded to `#47`'s capitalized-child narrative. `#47` then merged, so
`origin/main` carries it, base reads it exactly as head does, and the control fired on EVERY run
afterwards: "every zero below is meaningless" printed under a report whose zeros were fine. A false
alarm on the only alarm is worse than no alarm, because the next reader learns to scroll past it.
**The control now names the change under measurement** (a `CONTROL` constant a reader-slice updates,
with the rule written on it), **and compares the WHOLE reading, not just `json`** -- this slice moves
what the safety layer and validator SAY without moving any value, so a `json`-only control would
have passed on base and reported a comfortable zero. **If it fires, suspect it first.**

### `FHIR-ELEMENT-TEXT-RECOVERY` (2026-08-03)

**THE LAUNDERING IS CLOSED BY `FHIR-ELEMENT-TEXT-RECOVERY` (2026-08-03), AND THE SHAPE OF THE FIX
IS THE LESSON: IT IS A WRITER REFUSAL, NOT THE RECOVERY HALF.** The note here used to say closing
it "needs the grounding the recovery half needs". **That was wrong, and the precedent three lines
above says why: do not cite ADR 0018 to block a refusal, cite it to block a tolerance.** Only
_emitting the text back_ needs grounding; _declining to emit at all_ invents nothing. Both writers
now throw `FhirSerializeError` / `SERIALIZE_ERROR_CODES.DROPPED_ELEMENT_TEXT` on a marked model
(`src/codec/serialize-guard.ts`, shared by the JSON and XML writers).
**AND THE JSON WRITER WAS THE WORSE OF THE TWO AND WAS NOT RECORDED ANYWHERE.** This note named
only `serializeResourceXml` emitting `<status/>`; `serializeResource` emitted
`{"resourceType":"Observation"}`, dropping the member entirely, so a retracted `Observation`
re-read as one that never named a status. **Count the writers before you write the sentence** --
the same lesson this file already records for the reader's call sites, now paid on the write path.
**A fresh ADR 0018 grounding search was run and FAILED AGAIN, and the negative result is worth
keeping so it is not re-run blind.** GitHub code search for FHIR-namespaced XML carrying
element-text primitives returns: pre-2013 draft-era documents (`<LabReport>`, `<Document>`, Atom
feeds -- resource types R4 does not have, from when element text WAS the format); non-FHIR
namespaces; `data-absent-reason` extension children, which are CONFORMANT under §2.6.1's third arm
and are false positives; and one hand-authored library test fixture. `<Patient>` + `<gender>male</gender>`
returns **zero**. **None of that grounds a tolerance in an R4 reader**, so the recovery half stays
unbuilt.
**The wider §2.6.1 residual is NOT closed and must not be folded in**: a value-absent primitive
carrying no extension still emits `<status/>`, and the `id`-only case (`<given id="b"/>`, the only
such element in the fixture corpus) is still a violation. Refusing those would break a round trip
that works today, and is a separate decision; it is pinned by a test, not by this sentence.
**The differential harness had to be fixed to measure this at all**: it wrapped serialization in
the same `try` as the reading, so a refusal collapsed the whole reading and reported **5,159
phantom leaf losses** on the first run. A refusal is now its own `reread` state with its own tally,
excluded from "output shorter", "no longer re-reads" and the leaf comparison. **If you add a
writer refusal, check what the harness does with it before you trust a zero** -- and know the two
bar lines it narrows: **"newly throwing" no longer counts a refusal** (read it together with the
refusals line beneath it), and **the leaf comparison SKIPS a refused document** (5,159 of 15,956
leaves here). That exclusion is provably harmless only because this slice touches no reader file. **A
slice that changes the READER and adds a refusal has a real blind spot there**; measure the reader
change separately, against a base with no refusals in it.
**Still open, deliberately, pinned by a test:** text beside a value that DID arrive
(`<status value="final">entered-in-error</status>`) draws the same refusal, which is deliberate
rather than an oversight. **Do NOT justify that arm with "content the sender wrote is still
missing": the gate broke that sentence in one query** with `<status value="final">final</status>`,
where nothing is missing and it refuses anyway. The honest reason is that the rule keys on the
reader DROPPING character data and never compares the text to the value, and deciding the
duplicate case is harmless would mean READING the text, which is the tolerance this half declines;

### Residuals ii to iv, and three more left open

(ii) a **foreign child of a valued primitive** is discarded whole under `UNKNOWN_PROPERTY`, whose
documented contract is that nothing was lost, so that code is making a false promise at that site
exactly as it was at the two `_`-sibling sites this slice moved to
`MISPLACED_PRIMITIVE_EXTENSION`; (iii) a **foreign root launders** into conformant FHIR across one
round trip (`<v:Observation xmlns:v="urn:vendor">` re-emits as a FHIR `Observation` that re-parses
clean), pre-existing for the default spelling and extended to the prefixed one here; (iv) two
**distinct expanded names merge** when one prefix is rebound between siblings
(`<p:x xmlns:p="urn:a"/><p:x xmlns:p="urn:b"/>` -> one property), both flagged foreign, which the
`isForeign` / `groupChildren` expanded-name argument does not cover.
**(iii) IS CLOSED (2026-08-27), FOR THE XML ROUND TRIP AND NOT FOR THE JSON ONE:** the reader marks a
root that RESOLVED to another vocabulary and `serializeResourceXml` refuses it
(`UNSERIALIZABLE_FOREIGN_ROOT`), both spellings, so there is no emitted document left to re-read
clean. `serializeResource` is unchanged and the JSON leg still launders, which is declared rather
than claimed closed; the **unbound**-prefix root is a different arm and is untouched. See
[`#the-foreign-root-laundering-closed-2026-08-27`](#the-foreign-root-laundering-closed-2026-08-27).
**(iv) IS CLOSED FOR THE READ (2026-08-05), AND NOT FOR THE ROUND TRIP:** `reportMixedSpelling` now
compares the expanded name, so the merge is reported rather than silent, but `serializeResourceXml`
drops the bindings and the report is gone on the re-read. The merge itself still happens,
deliberately; see
[`#fhir-writer-authors-values-2026-08-05`](#fhir-writer-authors-values-2026-08-05). **The round
trip CLOSED 2026-09-24**: that write is refused on `UNSERIALIZABLE_PREFIXED_NAME`, so no output is
left to re-read without the report
([`#the-unbound-prefix-round-trip-closed-at-the-tag-sites-2026-09-24`](#the-unbound-prefix-round-trip-closed-at-the-tag-sites-2026-09-24)).
**(iii) AND (iv) WERE PINNED BY TESTS (2026-08-05), AND THE REASON THEY NEEDED TO BE IS THE
LESSON.** An audit of this file against the test tree found three residuals whose prose said
"pinned by a test" or read as though it did, with no test anywhere: (iv) here, (iii) here (only the
**flag** was pinned, never the round trip), and the singleton-wrapper laundering below. A false
"pinned" is worse than a plain gap, because the next reader stops checking. They live in
`test/xml.test.ts` ("declared residuals, pinned so they cannot move in silence") and
`test/array-wrapped-scalar.test.ts`, they are characterization tests over the gap rather than
claims that the reading is right, and each was demonstrated **red** against a mutation of the
behaviour it pins before it was allowed to go green: expanded-name grouping in `groupChildren` for
the merge, a namespace arm in `reportMixedSpelling` for the silence, a marked model for the
foreign-root round trip, and a writer refusal for the wrapper.
**Three more residuals left open deliberately, each pinned by a test:** an **unbound** prefix
(`<f:active/>` with no `xmlns:f` in scope) is flagged and its tag kept **verbatim**, so it does
**not** read as a FHIR element and a retraction spelled that way is still not seen by the safety
spine. The fix covers **bound** prefixes, which is what "supports namespace prefixes" means and
no more; `serializeResourceXml` emits the default-namespace spelling only, so a prefixed input
round-trips **equivalently, not byte-for-byte** (the conservative writer, working as intended); and
the `_`-sibling content is still discarded, as above.
**And the limit `#43` was right not to paper over is INHERITED, not undone: a forgery genuinely
shaped like a FHIR name is still echoed, so no claim is made anywhere that a location never
carries document content. Do not add one.**

### `FHIR-WRITER-AUTHORS-VALUES` (2026-08-05)

Three `PRE-EXISTING` laundering routes the `FHIR-RESIDUALS-NOT-PINNED` gate found while pinning
other residuals. **Two closed here, one deferred, and the scope call is the interesting part.**

**1. The JSON writer authored a value that was never read. CLOSED.** `readComplex` produces an empty
element for anything that is not an object at a complex position, and the writer emitted that
element as `{}`. `{}` is a **conformant** empty element, so the `UNKNOWN_PROPERTY` the reader raised
was gone the moment the output was read back:
`{"name":[{"family":"Roe"},"James"]}` -> `{"name":[{"family":"Roe"},{}]}` -> no diagnostics. **This
is the fabrication class**, the same harm shape as a silent zero default: a confident value
presented as read at a position where nothing was read at all.

**The surface is wider than the item stated, and that is what decided the remedy.** The item named
"a scalar beside a nested array", where the document already reads `valid: false` on the
`NESTED_ARRAY`. Measured, the same branch is reached by any non-object beside an object in a complex
list (`{"name":[{"family":"Roe"},"James"]}`, `…,null]`, `…,42]`, `…,true]`), and **those documents
read `valid: true` with one warning** and came back with none. So a **refusal** was the wrong
instrument: the existing `DROPPED_ELEMENT_TEXT` refusal is explicitly scoped to models the library
already reports `valid: false` / `safeToSummarize: false`, and refusing here would remove the ability
to write back documents that read clean. The remedy taken is the writer's **own already-documented
principle**, one branch over in the same function: _"Conservatism here means refusing to author a
value, not refusing to hand one back."_ The text is kept on the node (`FhirComplex.nonObjectSource`)
and written back, so the re-read reproduces the finding. The text is **value-exact, not byte-exact**,
the same caveat `NestedArrayContent` already carries: a number's exact source survives, a string's
escaping does not (`"Jamés"` returns as `"Jamés"`, `"a\/b"` as `"a/b"`). Both denote the same
string, so this is a re-render, not a loss, and the round trip is byte-identical for every input that
was already canonically escaped.

**Modeling the scalar as a primitive was considered and rejected**, and it is the cheaper-looking
fix, so it is written down: it would put a live value at a position every walker reads as a complex
element, and `codingsOf` / the safety spine would then see values they do not see today. That is the
line `FHIR-NESTED-ARRAY-PRESERVATION` drew ("if your change makes a nested array visible to any
walker, you have crossed the line"), and it applies verbatim. A **new** field rather than a reuse of
`nestedArraySource`: reusing it would set `nestedArray: true`, which drives a `NESTED_ARRAY`
validation error the document never earned, and would make the public `nestedArrayContent` return a
non-array.

**2. `serializeResourceXml` emits a prefixed foreign property with the prefix unbound. DEFERRED,
with the reason.** Measured: `<v:x xmlns:v="urn:vendor" value="1"/>` re-emits as `<v:x value="1"/>`,
which is **not namespace-well-formed**, so a conformant parser rejects the writer's own output. The
binding was never modeled, so the remedies are (a) carry namespaces in the model or (b) refuse any
property name with a colon, which withdraws a capability for a shape that reads `valid: true`. Both
are larger decisions than the defect, and this item's standing instruction was not to let the remedy
outgrow it. **Still open.** (**CLOSED 2026-09-24 by (b)**, on a code of its own,
`UNSERIALIZABLE_PREFIXED_NAME`:
[`#the-unbound-prefix-round-trip-closed-at-the-tag-sites-2026-09-24`](#the-unbound-prefix-round-trip-closed-at-the-tag-sites-2026-09-24).
(a) is not taken.)

**AND IT REOPENS THE REBOUND-PREFIX HALF, RESIDUAL (iv), ACROSS ONE ROUND TRIP. NOT ROUTE 3, WHICH
SURVIVES.** Measured: the narrative `div` is carried opaquely by `narrativeSource`, which
materialises each `xmlns` on the fragment, so both divs are re-emitted with their namespaces and the
re-read reproduces `MIXED_XML_SPELLING@Patient.text.div` unchanged. Only the rebound prefix loses it,
because only a prefix needs a binding the model does not carry. **This is why the first draft of this
section was wrong.** That draft said "what is lost is the binding, not the diagnostic", measured on a **single**
`<v:x/>`, where the unbound prefix still satisfies `isForeign` and `UNEXPECTED_XML_CONTENT` is raised
again. On the shape residual (iv) actually names, a **rebound** prefix, the writer drops both
bindings, so the two occurrences become one expanded name and the `MIXED_XML_SPELLING` this very
slice added is **gone on the re-read**:

```
in   : <Observation xmlns="…fhir"><p:x xmlns:p="urn:a" value="1"/><p:x xmlns:p="urn:b" value="2"/></Observation>
i1   : MIXED_XML_SPELLING@Observation.<withheld> + UNEXPECTED_XML_CONTENT x2
out1 : <Observation xmlns="…fhir"><p:x value="1"/><p:x value="2"/></Observation>
i2   : UNEXPECTED_XML_CONTENT x2                      <- the merge report is gone
```

So **(iv) is closed for the READ and not for the round trip**, and the round-trip half is a declared
residual of route 2, not of route 3. It is pinned by `test/xml.test.ts` so it cannot move in silence.
Route 2 is the thing that has to close before that report can survive a write, which is the honest
reason it is the next item rather than a nice-to-have.

**3. A FHIR-namespace `<div/>` merges into `Narrative.div` with zero diagnostics. CLOSED, one line.**
`modelNameOf` tests `isNarrativeDiv` first and models the narrative as `div` under every spelling of
the XHTML namespace, so `{http://hl7.org/fhir}div` joins `{http://www.w3.org/1999/xhtml}div` in one
group. `reportMixedSpelling` compared **literal tags**, both are `div`, and the document read back
with zero issues and `valid: true` while `Narrative.div` (`0..1`) had become a two-item list.
Comparing the **expanded name** closes it, and closes residual (iv) with it, because a prefix rebound
between siblings is the same defect with a different route in. `MIXED_XML_SPELLING` is the right
code rather than a new one: its published reason is that _the count_ changed and a single-value read
of a repeat yields nothing, which is exactly the harm in both. The grouping itself is untouched, per
the standing "report it or drop the grouping" trap: dropping means two properties of one model name
and the XML reader has no `duplicates` mechanism, so it would be a silent first-wins loss.

**The scope call, stated.** Routes 1 and 3 were taken, route 2 deferred. 1 and 3 are each a change of
a few lines at the site that decides, with the harm and the remedy in the same sentence. 2 requires a
new model capability or a new refusal before anything can be written at all.

**Every test added or changed was demonstrated RED by mutation first**, nine of them, because
`FHIR-RESIDUALS-NOT-PINNED` closed exactly the defect of a test that cannot fail. Three of the
mutations were unnecessary in the end: the pre-existing characterization tests for the scalar route
and the rebound prefix, and the `model-edges` enumeration, all went red on their own the moment
`src/` changed, which is what those tests exist to do.

**Measured over this repo's 7 hand-authored XML fixtures plus mutations (1,195 documents), NOT the
FHIR R4 published-examples corpus.** 4 readings moved, all 4 read diagnostics **gained**, 0 lost, 0
validation findings moved either way, 0 `valid`/`safeToSummarize` flips, 0 retractions or negations
lost, 0 leaf values missing, 393 of 396 twin pairs identical with 3 **louder** and 0 weaker.
**The differential's negative control fired on the first run**, exactly as its own trap says it
would: `CONTROL.moved` still described the `FHIR-ELEMENT-TEXT-RECOVERY` slice, which had merged, so
base and head agreed and every zero was meaningless. Re-keyed to this slice's own document. **Re-key
it every time**, and note that the control reads XML only, so the JSON half of this slice is outside
it and is covered by `test/nested-array.test.ts` instead.

### `div` forges a negation (2026-08-07)

**THE `div` BRANCH NO LONGER SPLICES A STRING INTO THE DOCUMENT UNEXAMINED.** The item that carried
this defect forbade proposing a remedy before measuring one, because two earlier drafts had guessed
and both guesses were false. The measurement came first, and it changed the shape of the answer
twice, so the order is the point.

**▶ 🛑 THE STANDING CAVEAT, WHICH TRAVELS WITH EVERY NUMBER BELOW: this repo's XML corpus is 7
hand-authored fixtures plus mutations, NOT the FHIR R4 published-examples corpus.** The sweep here
is over generated `div` STRINGS, which is a third axis again, and is not corpus-wide either.

#### What was measured, before anything was proposed

A battery of 16 `div` strings through `parseResource` -> `serializeResourceXml` -> `parseResourceXml`
on `658a1f0`, recording emission, re-read issues, `validateResource`, and the whole safety readout at
both ends. What it established, and each line changed the remedy:

- The flagship forgery re-reads with `noKnownAllergy: true`, `negations: ["no-known-allergy"]`,
  `safeToSummarize: true` and an **empty issue list**, exactly as the item says. It also re-reads
  `validateResource().valid === false`, because the breakout leaves two `<text>` elements. **The item
  never claimed `valid: true` on the re-read and neither does anything here.**
- `{"resourceType":"Observation","div":"<status value=\"final\"/>"}` is **one perfectly well-formed
  element**. So the second wrong guess ("well-formedness does not close it") was wrong in the other
  direction too: well-formedness is not sufficient, not merely not necessary. A check that stopped at
  well-formedness would have left the status forgery wide open.
- **A shape nobody had recorded: `{"div":""}` is dropped in SILENCE.** Base emitted
  `<text><status value="generated"/></text>`, the property simply gone, empty issue list and
  `valid: true` at both ends. Of the three recorded shapes `{"div":"v"}` was the one said to fail
  safe; this fourth one does not fail at all.
- **Every `div` string the XML READER produces passes the check**, over 7 spellings (default and
  prefixed XHTML, no declaration, vendor namespace, empty element, a comment inside, an escaped `<`)
  and over the fixture corpus. `narrativeSource` serializes one element and materialises the
  namespace declarations it inherited, so the string it hands back is always one balanced element
  whose local name is `div`.

#### The remedy the measurement chose, and why it is at the write

`emitsOneDivElement` in `src/xml/write.ts`: the string is written only when `readRawXml` parses it as
a document with exactly one root element **and** that root's local name is `div`. It runs at the
branch that splices the string in, next to `tag()`, for the reason `tag()` gives: a pre-pass would
re-derive the writer's branching and be free to disagree with it. `refuseUnserializableDivMarkup`
raises `UNSERIALIZABLE_DIV_MARKUP` at the root once the walk is done, after the name refusal, so a
model tripping both keeps the code base already reported.

- **The same parser, over the same bytes, is what makes the STRUCTURE checkable.** `readRawXml` is
  what `parseResourceXml` re-reads the emitted document with, and the fragment is balanced, so the
  element structure it reports is the structure the re-read sees. **It settles the structure and
  nothing else, and the 2026-08-07 gate refuted the wider sentence that stood here.** `readRawXml`
  is depth-STATEFUL: this check spends the 256 budget from 0, the re-read spends it from the `div`'s
  depth in the document, so a `div` holding 254 nested elements is accepted and the emitted document
  raises `MAX_DEPTH_EXCEEDED` on re-read. Loud, byte-identical on base, and pinned by a test.
- **The local name, not the full name**, because `<h:div xmlns:h="…xhtml">` is a spelling this
  library reads and round-trips today and refusing it would withdraw a working round trip.
- **Not the namespace, and not whether a prefix is bound inside the string.** An unprefixed `<div>`
  under no declaration and a vendor-namespace one both reach `Narrative.div` on the read. **Only the
  vendor one comes back unchanged**: `<div>x</div>` re-reads as `<div xmlns="http://hl7.org/fhir">x</div>`
  with zero diagnostics, so the library inserts a declaration the sender never wrote and moves the
  narrative out of the namespace R4 names for it. Pre-existing, pinned by a test, and the reason the
  justification here is "both reach `Narrative.div`" and not "both round-trip unchanged". A root
  whose prefix nothing binds IS accepted, and the emitted document re-reads it as a property named
  `v:div`: that is the separately declared unbound-prefix residual reached through a value, not this
  defect, and folding it in would have made this slice the fix for a class it had not measured.
  (That residual CLOSED 2026-09-24 by a SECOND check at the same branch, on its own code, never by
  widening this one:
  [`#the-unbound-prefix-round-trip-closed-through-a-div-value-2026-09-24`](#the-unbound-prefix-round-trip-closed-through-a-div-value-2026-09-24).)
- **Refusing rather than repairing**, for the same reason as a name: escaping authors a text node
  where the sender wrote markup, splicing authors elements, and `serializeResource` carries the
  string as a string, so the capability is routed rather than lost.

#### The numbers, and the one instrument that could not grade this

**360,020 `div` strings** (a directed set of 20, 120,000 built from markup atoms, and 240,000 one-
and two-edit mutations of six strings this library reads back unchanged, which is where a false
positive would live). **107,807 accepted, 252,213 refused, and of the 65,464 whose BASE round trip
returned the string unchanged, 0 are refused: 0 false positives.** The sweep carries a negative
control that fires when the imported tree parses no FHIR resource at all; pointed at `@cosyte/hl7` it
exits 2 and prints that every number above it is meaningless, and against this package it is silent.

**▶ THE READ DIFFERENTIAL CANNOT GRADE THIS SLICE, AND SAYING SO IS THE HONEST RESULT.**
`pnpm differential:read` over 1,195 documents reports 0 readings moved, 0 newly throwing, 0 leaf
values missing, 0 diagnostics lost and the same 360 refusals as base. Those zeros are **expected by
construction**: no XML document this library can read produces a `div` string the check refuses, so
the harness has nothing to see. Two further facts, both `PRE-EXISTING` and neither introduced here:
its `CONTROL.moved` still names the merged `MIXED_XML_SPELLING` slice, so the negative control fires
on an **unmodified working tree** (verified by stashing and re-running), and its `whole()` compares
`json`/`valid`/`findings`/`issues`/safety but **not `xml`**, so it could not see an XML-writer-only
divergence in any case. Re-keying it needs a document THIS change moves and there is none.
**Do not report those zeros as a green control.**

#### What pinned it, and what pins it now

The three characterization tests in `test/xml-tag-name.test.ts` went **red on this change**, which is
the mechanism working, and were rewritten as the same shapes with their new outcome so the base-to-head
comparison stays readable in one place. Six refusal tests plus a block of what is still written; every
one was demonstrated red against a mutation of the behaviour it pins and against **only** that one
(the check forced to `true` reds five; swapping the two refusals' order reds the precedence test and
nothing else). The false-positive control is committed as a `fast-check` property that builds base's
output by hand, so a reviewer re-derives it rather than trusting a number here.

#### The gate refuted pass 1, and every finding was prose

**Two `INTRODUCED` majors, both claim width, neither a defect in the check.** The gate could not
break `emitsOneDivElement`: 55,677 accepted strings built from breakout atoms, none escaping the
invariant that the emitted document holds one `<text>` holding the `div`; 200,000 generated XML
documents read and re-serialized with **zero** refusals; and refusal-implies-base-did-not-round-trip
confirmed case by case against a base tree materialised with `git archive 658a1f0`.

**▶ 🛑 THAT MAKES SIX GATE PASSES RUNNING REFUTING A UNIVERSAL IN THIS AREA'S PROSE, AND THIS ONE
SHIPPED IN `dist/index.d.ts` AGAIN.** "`serializeResource` encodes every one of these correctly" is
false: `{"text":{"div":""},"name":[[{"family":"X"}]]}` is refused here and `serializeResource` emits
the array inside an array, which is one of that writer's own declared exceptions. The claim is now
"this refusal never reaches it and that route stays open", which is what was actually meant, and the
same sentence was narrowed on the NAME arm beside it, where it was `PRE-EXISTING` and identical. The
runtime error message carried it too, so it reached consumer logs. **The `#64` changelog entry and
its pending changeset still carry the wide wording and were deliberately not edited**: they are a
record of what that slice said.

**▶ AND THE NAME ARM IS ONLY PARTLY NARROWED, WHICH IS A BACKLOG LINE RATHER THAN A CLAIM.** Exactly
one site was touched there, its `SERIALIZE_ERROR_CODES` docblock. `refuseUnserializableNames`'s
runtime message and `breaksTag`'s docblock still say the JSON writer "encodes the model correctly",
byte-identical to base, and the same `name: [[{"family":"X"}]]` counterexample falsifies both. The
message reaches consumer logs. `PRE-EXISTING`, not folded in.

The second was the soundness sentence, corrected above. Three further `PRE-EXISTING` counterexamples
the gate produced are now asserted in tests rather than described: the depth boundary, the inserted
namespace declaration, and an **XML declaration**, which is not a processing instruction (XML 1.0
§2.6 reserves the `xml` target, §2.8 allows the declaration only at the start of an entity) but which
`skipMisc` swallows, so `<?xml version="1.0"?><div …/>` is accepted and the output is rejected by
expat while this library re-reads it clean.

_Provenance: every load-bearing fact in this section is measured against this codebase at `658a1f0`
and `45b42b5`, not cited. The XML 1.0 clauses above are the only external citations._

#### Left open deliberately

- The `_`-sibling whose value is not an object, the non-string `resourceType` tag substitution, and
  `escapeAttr` passing XML-illegal control characters. All `PRE-EXISTING`, all named on the item, all
  read-path or attribute-path rather than this branch. (True at this slice. The `resourceType` tag
  substitution was **CLOSED 2026-08-09**, `UNSERIALIZABLE_RESOURCE_TYPE`; the other two are open.)
- Comments and processing instructions beside the root are accepted and do not survive the re-read.
  Neither is an element, so neither can forge one; pinned by a test rather than argued.
- **The accepted-`div` round trip is not idempotent and the output is not always well-formed**, per
  the counterexamples above, and pass 2 added another of that class: `<div>]]></div>` is accepted and
  emitted, and `]]>` is excluded from `CharData` (XML 1.0 §2.4), so expat rejects the output while
  this library re-reads it. All `PRE-EXISTING`, none introduced by the check, none folded in: each is
  a different defect from the forgery this item names.
- **The pre-merge edits after pass 2 are UNGRADED**, and pass 2 said they needed no further pass: a
  definite article that read as a closed enumeration, an error code asserted in the depth test rather
  than a bare throw, and the name-arm scoping sentence above. ADR 0016's cap is not spent on them.

#### Open read-path losses, enumerated

_Relocated verbatim from `CLAUDE.md` on 2026-08-07 under the doc budget, nothing dropped. The rule it
qualifies stays there._

**CLOSED: a status or a dose number written as XML element text.** It used to be the loss that
qualified "never drops a modifier, status or negation" - dropped, reported, both writers refusing,
and the safety spine reading `negations: []` over a retracted record. The reader now reads the value
out of the character data at **one** position, a primitive element carrying no `value` attribute, so
the retraction, the negation and the dose reach the readout. Everything the reporting half bought is
untouched: the encoding is still non-conformant, `UNEXPECTED_XML_CONTENT` still fires at the
position, the marker still lands, `safeToSummarize` is still false and both writers still refuse.
The bound is the tolerance's own: a `value` attribute always wins and the text beside it is never
read, merged or compared against it; two text runs separated by a child element read as no value
rather than as a joined token; and a spelling the negation layer cannot classify stays on
`nearMissNegationCodes` / `unreadableNegationCodes` rather than being folded into a code. **The other
two `flagStrayText` sites are unchanged and still drop**: a complex element has no value slot, and
the resource-valued unwrap models the wrapped resource and nothing beside it.

Still open, and none of them moved here: a scalar beside a nested array (**still not modeled**, but
since 2026-08-05 its text is preserved and handed back, so the finding survives a **JSON** round
trip; through the XML writer it is still `<name/>` and both the value and the finding go), a
`_`-sibling discarded whole, a foreign child of a valued primitive, character data at the two
`flagStrayText` sites that have no value slot, an unbound prefix (still read under its verbatim tag;
since 2026-09-24 its XML write is refused at the tag sites rather than emitted unbound, and the
`div`-value route of it is still written), and a `<DIV>` wrapper. The
`String.trim()` whitespace gap is unchanged too: character data made only of U+00A0, U+FEFF and
their neighbours is still dropped with neither a flag nor a marker, so nothing here reads it either.

**Added 2026-08-09** (raised by the negation-read-scope-depth gate, `PRE-EXISTING`, filed rather than
absorbed): **a `status` written as a JSON OBJECT was invisible on every safety channel.**
`{"resourceType":"Observation","status":{"value":"entered-in-error"},"code":{"text":"x"}}` read
`retracted: false`, `negations: []`, `safeToSummarize: true` and `valid: true`, at the root and
nested alike. **Scoped, because gate pass 3 measured the qualifier:** `valid: true` holds **with no
caller-supplied schema, and none is bundled for `Observation`** (`BUILTIN_SCHEMAS` carries `Patient`,
which has no `status`); hand `validateResource` a `ResourceSchema` typing `Observation.status` and it
returns `valid: false` with `TYPE_MISMATCH`, in both modes. The only diagnostic in the default
configuration is an `information: RESOURCE_NOT_MODELED`, emitted identically for the conformant
document, so it carries no signal about the loss. It is another of the encodings `src/safety/status.ts` enumerates,
and it is what a generic FHIR-XML to JSON converter makes of `<status value="entered-in-error"/>`,
the same traffic that docblock cites. CLOSED 2026-08-10 bar `valid`; wrapped-`status` residual open.

  **The `valid` half CLOSED 2026-08-25 by `MODEL-OBSERVATION-1`**, and the qualifier gate pass 3
  measured is what closed it: the schema is no longer caller-supplied-only, because `Observation` is
  now in `BUILTIN_SCHEMAS` beside `Patient` with `status` typed `code` at `1..1`. So the default
  path returns `valid: false` with `TYPE_MISMATCH @Observation.status` in both modes, which is
  exactly what the paragraph above says a supplied `ResourceSchema` used to be needed for. The
  reading is unchanged on every safety channel: nothing is read through the object, `retracted` is
  still `false` and the disclosure still carries it. Pinned by `test/validate-observation.test.ts`
  ("Observation.status present as an object"), which also refuses a required-binding verdict on a
  value that never became a readable code. The sentence above is left as it was taken.

**Added 2026-08-21 by the modifier-ELEMENT channel (`SAFETY-MODIFIER-2`), filed rather than
absorbed, and none of them closed here.** The channel reports the four elements at every node the
safety walk reaches, so its reach IS that walk's reach and nothing was widened to feed it. Three
JSON-read-path shapes carry a Scope modifier element the walk does not reach, plus a fourth the codec
reads as a primitive list, and the first is fail-OPEN, which is why it leads. **Each is pinned by its
own characterization test in `test/modifier-elements.test.ts` ("declared non-reach residuals on the
JSON read path"), so closing one MUST red a test in the same change.**

- **A modifier element inside a PRIMITIVE's `_`-sibling extension is not reached, and the document
  reads `safeToSummarize: true`.** `{"resourceType":"Patient","gender":"male","_gender":
  {"extension":[{"url":"http://x","valueQuantity":{"value":1,"comparator":"<"}}]}}` reports nothing.
  The safety walk descends complex nodes and lists; a primitive's own `id`/`extension` metadata is a
  SEPARATE walk (`collectNested`), kept separate on purpose so a new report cannot reorder or
  suppress a finding the first walk already makes. R4 puts an extension's value in a `value[x]`, and
  a `valueQuantity` there can carry a `comparator`, so this is a real shape and not a contrived one.
  **Fail-open, and the only one of the three that is**, which is what makes it the first candidate if
  the reach is ever widened.
- **A modifier element inside an array-inside-an-array is not reached.** The codec models no inner
  array (the standing `nestedArrays` loss), so there is no node to reach. The document is already
  refused, by the channel that reports the unreadable content itself, so this one is fail-CLOSED.
- **A modifier element inside a `_`-sibling misplaced on a COMPLEX element is not reached**, and the
  document reads `safeToSummarize: true`. The reader discards such a sibling whole (the standing
  "`_`-sibling discarded whole" loss above), so the modifier never reaches the model at all. Nothing
  new: this is that residual seen through this channel.
- **A `use` inside a MIXED array whose first entry is a scalar is not reached.**
  `{"resourceType":"Practitioner","identifier":["x",{"use":"official"}]}` reads the whole array as a
  repeating primitive, so the object beside the scalar becomes a value-absent slot and there is no
  complex node to reach. Unlike the first residual the position IS reported, as
  `UNKNOWN_PROPERTY` at `Practitioner.identifier[1]`, so the loss is not silent; what does not happen
  is that this channel reports it, and `safeToSummarize` does not move. The complementary order
  (object first, scalar second) IS read as a complex list and IS reported, and both directions are
  pinned.

**The XML read path has NO residual of its own here, which was measured rather than assumed:** all
four elements reach the safety walk from XML and are reported, including the element-text spelling
whose VALUE this reader drops (`<comparator>&lt;</comparator>` still reports the modifier, because
presence of the KEY is the trigger). Pinned per element in `test/modifier-elements-xml.test.ts`.

### `FHIR-UNBOUND-PREFIX-ROUNDTRIP` (2026-08-07)

**Superseded on both routes, 2026-09-24:** the deferral below held until then; the tag-site route is
now refused on `UNSERIALIZABLE_PREFIXED_NAME` (remedy (b)),
[`#the-unbound-prefix-round-trip-closed-at-the-tag-sites-2026-09-24`](#the-unbound-prefix-round-trip-closed-at-the-tag-sites-2026-09-24),
and the `div`-value route on `UNSERIALIZABLE_DIV_PREFIX`,
[`#the-unbound-prefix-round-trip-closed-through-a-div-value-2026-09-24`](#the-unbound-prefix-round-trip-closed-through-a-div-value-2026-09-24).
What follows is left as it was taken.

**THE DEFERRAL STANDS, AND MEASURING IT FOUND A STRICTLY WORSE DEFECT IN THE SAME FUNCTION.** The
item asked whether `#59`'s deferral of the unbound prefix still holds. It does, unchanged, on the
measurement below. What the same measurement turned up is that "a prefixed foreign property with the
prefix unbound" is one member of a class `serializeResourceXml` never checked at all, and another
member of that class **fabricates clinical content across one round trip**.

**▶ 🛑 THE STANDING CAVEAT, WHICH TRAVELS WITH EVERY NUMBER BELOW: this repo's XML corpus is 7
hand-authored fixtures plus mutations, NOT the FHIR R4 published-examples corpus.** The sweeps here
are over generated NAMES rather than over documents, which is a different axis and is stated as such
each time; neither is corpus-wide.

#### The deferral, re-measured

`#59` recorded two remedies: **(a) carry namespaces in the model**, or **(b) refuse any property
name with a colon**. Both still stand, and both are still larger than the defect:

- **(a)** needs a binding per OCCURRENCE, not per complex. The shape residual (iv) names is a prefix
  **rebound between siblings**, so one prefix carries two URIs among the children of one element. A
  prefix-to-URI map hung on the complex cannot represent that, and picking either binding would
  assert that the other occurrence was in a namespace it was not: the fabrication class. So (a) is a
  new model capability on the node, not an inert map beside it, and `test/model-edges.test.ts`
  polices that surface deliberately.
- **(b)** withdraws writing back a document that reads `valid: true`. Measured: a prefixed foreign
  property draws one `UNEXPECTED_XML_CONTENT` at **warning** severity, `validateResource` returns
  `valid: true`, and `serializeResourceXml` -> `parseResourceXml` returns the property unchanged.

**▶ 🩺 AND ONE THING THE BACKLOG SAID WAS NOT WHAT `#59` MEASURED.** The item reads "both remedies
withdraw a capability for a shape that reads `valid: true`". `#59`'s own sentence attaches the
withdrawal to **(b) alone** and then says "**Both are larger** decisions than the defect". Only (b)
withdraws anything; (a) adds. The compression matters because it makes (a) look disqualified when it
is merely expensive, and a future reader weighing the two should weigh the real pair.

#### What the measurement found instead

`serializeResourceXml` builds a start tag by interpolating a name the document supplied, with **no
check of any kind**. The model is schema-free and the JSON reader admits any member name, so the
tag position is reachable by arbitrary text. Measured over 2,350 sampled names (every code point
`U+0001`-`U+02FF` at three positions in a name, eight higher ones, plus a hand-written adversarial
set), the emitted markup falls into exactly three groups:

1. **It re-reads as the same one element.** `p:x`, `:x`, `a:b:c` (the named residual), and also
   `a&b`, `1abc`, `-lead`, `a"b`, `a\vb`, `a\fb`, `a b`. A conformant third-party parser
   rejects all of them. This library does not.
2. **It does not re-read at all.** A name containing XML's own whitespace (space, tab, CR, LF) or
   `/`, `>`, `=`, `<`, an empty name, or a name beginning `!` or `?` (which make `<` open a markup
   declaration or a processing instruction instead of an element).
3. **It re-reads as DIFFERENT elements, and a conformant parser ACCEPTS it.** The breakout:

```
in   : {"resourceType":"Observation","zz value=\"1\"/><status":"final"}
i1   : (no diagnostics) valid: true, readSafety().status: undefined
out  : <Observation xmlns="…fhir"><zz value="1"/><status value="final"/></Observation>
i2   : (no diagnostics) valid: true, readSafety().status: "final"   <- FORGED
```

**A clinical status the sender never wrote, asserted by our own writer, under `valid: true` at both
ends and with zero diagnostics on either side.** Same harm shape as the JSON writer authoring `{}`
for a value it never read (`#59` route 1), and worse than the item's own headline: the headline was
"a conformant parser rejects our output", and this is a conformant parser **accepting** it and
reading content that was never sent. The root `resourceType` is the same site
(`{"resourceType":"P xmlns=\"urn:evil\""}` emits a second `xmlns`).

#### The remedy, and why the line is where it is

Group 2 and group 3 are refused: a new `SERIALIZE_ERROR_CODES.UNSERIALIZABLE_ELEMENT_NAME`, thrown
by `serializeResourceXml` only. Group 1 keeps being written, which is `#59`'s deferral intact.

**THE LINE IS "DOES THIS LIBRARY'S OWN ROUND TRIP SURVIVE IT", NOT "IS THIS A CONFORMANT XML NAME",
AND THAT CHOICE IS THE WHOLE DESIGN.** The tidier rule is the `Name` production (XML 1.0 §2.3), and
it was rejected on measurement: `a&b`, `1abc`, `-lead` and `a"b` all fail that production and all
round-trip through this library today, so refusing them would withdraw a working round trip from
models that read `valid: true`. That is precisely the cost `#59` declined to pay for the prefix, and
paying it here for the same class would be incoherent. Group 2 and 3 cost nothing, because nothing
works today: one fails, and the other was never the sender's document.

**Repairing was not available.** XML has no escape for an element name, so the alternatives to
refusing are mangling the name (authoring a name nobody wrote) or emitting the breakout (authoring
elements nobody wrote). Both are the fabrication class. Refusing invents nothing, and
`serializeResource` escapes a member name, so this refusal never reaches it and that route stays
open. That is what makes this a refusal and not a withdrawal. **Narrowed 2026-08-07 from
"`serializeResource` still encodes every one of these models correctly", the same wide claim `#65`
and `#66` closed at the other sites**: that is a claim about the whole model and it is false, because
a model refused here can carry one of the JSON writer's own declared exceptions and have it emitted. Pinned by a test rather than described
(`{"resourceType":"Observation","name":[[{"family":"X"}]],"zz value="1"/><status":1}` is refused here
and comes back out of `serializeResource` with the array inside an array intact).

**▶ THE CHECK RUNS AT THE EMISSION SITE, NOT IN A PRE-PASS WALKER.** A pre-pass would have to
re-derive the writer's own branching (which names become attributes, which become the tag, which are
dropped entirely) and that duplicate is free to drift. `tag()` is called from every site that writes
a name and from no other, which is the same discipline the reader uses for `isForeign`. It cost
threading a bounded path through four functions.

**▶ THE LOCATIONS CANNOT ECHO THE NAME, AND THAT IS ASSERTED RATHER THAN REASONED.** A refused name
is document content and one shape of it is a forgery built to look like markup. Every name this
refuses also fails the far narrower `elementName` / `resourceTypeName` shapes in `model/path.ts`, so
each renders `<withheld>`. Pinned, because the guarantee holds only while that containment does.

#### Reachability from XML: NEARLY none, and the "by construction" version was FALSE

**An earlier draft of this section said "no document `parseResourceXml` reads can reach this
refusal", derived it "by construction" from the raw reader's `parseName`, and used it to justify
skipping a verification step. Pass 2 of the gate broke it.** `parseName` does stop at exactly
`isWs(c) || "/" || ">" || "=" || "<"` and does refuse an empty name, so no **unprefixed** tag can
carry one. The proof overlooked **prefix stripping**: `modelNameOf` models a prefixed element under
its LOCAL part, so a `!` or `?` can end up at the front of a modeled name even though no tag may
start with one.

```
in : <Patient xmlns="…fhir" xmlns:a="…fhir"><a:!x value="1"/></Patient>
     issues [] , valid: true , properties ["resourceType", "!x"]
out: REFUSED (UNSERIALIZABLE_ELEMENT_NAME).  Base wrote `<!x value="1"/>`, which this
     library then could not re-read.
```

So the refusal IS better than base for that document, and it IS a document that used to serialize
and now does not. **Both halves are the honest statement; the first alone was the overclaim.** The
counterexample is now asserted in `test/xml-tag-name.test.ts` rather than left as prose, and the
fast-check property beside it is retitled to the unprefixed case it actually covers.

**▶ 🩺 `pnpm differential:read` WAS NOT RUN, AND THE REASON FIRST GIVEN FOR THAT WAS THE FALSE
CLAIM ABOVE.** The reason that survives is only the harness's own: it reads XML, and its control
docblock already says it "would NOT catch a base/head divergence confined to the XML writer", which
this slice is. **Record the evidence that actually stands in its place**, rather than the harness
zero: two fast-check properties in `test/xml-tag-name.test.ts`, and the two independent gate sweeps
(3,221 probes over every code point `U+0000`-`U+02FF` at four positions plus higher and adversarial
ones, cross-checked against **expat** as a conformant third-party parser, **0 false positives**).
Widening `whole()` and re-keying the control is still the right move for the next writer-side slice.

#### Every test proved red by mutation

Twelve mutations, each run against the new suite, each red, restored from a snapshot between runs:
dropping the leading-`!`/`?` arm; dropping `=`; dropping `/` (the fabrication character); widening
XML's `S` to the JavaScript `\s` class (which over-refuses `\v`, `\f`, `U+00A0`); dropping the
empty-name arm; over-refusing via the `Name` production; and stopping the check at each of the four
tag-writing sites, plus echoing the name instead of the location, dropping the dedup, and emitting
the markup anyway. **The first pass of this matrix left one mutation GREEN**: the wrapper tag of a
resource-valued element had no test, because the existing case exercised the inner `resourceType`
and the outer name happened to be `contained`. A test was added for it. That is the matrix earning
its keep, and it is the reason to run one rather than to reason about coverage.

**▶ 🛑 A PROCESS TRAP THIS SLICE PAID FOR, AND IT COST THE WHOLE IMPLEMENTATION ONCE. A MUTATION
HARNESS MUST RESTORE FROM A SNAPSHOT, NEVER FROM `git checkout --`.** The first version of the
matrix restored with `git checkout -- src/...` between runs. The slice was uncommitted at that
point, so the baseline run's restore discarded every source edit in it, silently and irreversibly,
and the whole implementation had to be redone from context. Snapshot to a scratch path first and
`cp` back. Untracked test files survive; tracked source does not.

#### The gate: pass 1 REFUTED, and what it was refuted for

**Pass 1 returned `REFUTED`, and every finding was about CLAIM WIDTH, not about the code.** It could
not break the refused set: 3,221 probes over every code point `U+0000`-`U+02FF` at four positions
plus higher and adversarial ones, cross-checked against **expat** as an independent conformant
parser, found **0 false positives** (nothing refused that base round-tripped) and no XML input that
reaches the refusal. Claims 1, 2, 3 and 7 above were verified rather than broken.

What it broke was three sentences, and one of them led straight to the `div` fabrication recorded
below: **"it will not author an element the sender never wrote"** on the write path, **"a writer may
decline to hand a model back, but it may never author content of its own"** on the guard, and **"A
name that would author ELEMENTS is refused"** in `CLAUDE.md`. Two of the three shipped to consumers
in `dist/index.d.ts`. Also refuted: a fast-check docblock claiming the property said **"not any"**
when its alphabet cannot spell `div`, the one name that breaks the invariant; and
`refuseUnserializableNames` claiming every location renders `WITHHELD`, which is false at a nested
resource's type (reported at the wrapping element's location, so there is no segment to withhold).
The remedy was claim-narrowing plus pinning the gap, and **the guard was deliberately not grown**:
growing it would have made this slice the fix for a class it had not measured.

**▶ 🛑 FIVE GATE PASSES RUNNING HAVE NOW REFUTED A UNIVERSAL IN THIS AREA'S PROSE, AND THIS ONE WAS
IN THE `.d.ts`.** The rule the repo already had ("name the set the code actually walks") extends to
the writer: **name the SITE, not the writer.** A sentence about "the writer" is a claim over every
branch it has, and `writeItem` has a branch that emits raw markup.

#### Pass 2 also REFUTED, and the pattern is the finding

**Pass 2 returned `REFUTED` too, on two `INTRODUCED` majors, and BOTH were sentences the pass-1
remedy had just written.** "Unreachable for a model read from XML" (false: prefix stripping) and
"well-formedness does not close the `div` gap" (false: `readRawXml` rejects the flagship value). It
also caught a fourth `div` test whose title claimed one thing while its single `toThrow()` assertion
stayed green under the very remedies it said were ruled out, and a "silently deletes" that is loud.

**▶ 🛑 THE PATTERN, WHICH MATTERS MORE THAN EITHER FINDING: EVERY REWRITE PRODUCED A FRESH FALSE
UNIVERSAL.** Pass 1 refuted three, and the prose written to fix them carried two more. Both passes
found nothing wrong with the code. **So the pass-2 remedy DELETED rather than reworded**, which is
this repo's own standing rule that a disclosure reworded twice is deleted, not reworded a third
time: the vacuous test is gone with a comment saying why, the remedy speculation about the `div` gap
is gone entirely, and the measurements are stated with no claim attached about what would close
them. Where a fact was still needed, it is a counterexample asserted in a test rather than a
sentence.

**The rule to carry forward: name the SITE, not the writer, and prefer a failing example to a
universal.** A sentence about "the writer" is a claim over every branch it has.

#### Left open deliberately, and NOT folded in

- **The named residual itself.** Group 1 above, `#59`'s deferral, unchanged. Pinned in
  `test/xml-tag-name.test.ts` ("declared gap, still written") as a characterization test over the
  gap, and still pinned in `test/xml.test.ts` for the rebound-prefix round trip. Closing it MUST red
  both. **CLOSED 2026-09-24 for the names in group 1 that carry a colon (`p:x`, `:x`, `a:b:c`), and
  both went red in that change**: those rows moved out of "declared gap, still written" and are
  asserted refused on `UNSERIALIZABLE_PREFIXED_NAME`, and the rebound-prefix test is rewritten over
  the same document. The colon-free rows of group 1 are still written and still pinned.
- **🔴 A `div` PROPERTY IS WRITTEN BACK AS RAW MARKUP, AND IT IS A FABRICATION ROUTE STRICTLY WORSE
  THAN THE ONE THIS SLICE CLOSED. `PRE-EXISTING`, byte-identical at `e2e5965`, STOP-THE-LINE, its own
  item.** Found by the pass-1 gate while refuting this slice's prose, which had claimed the writer
  "will not author an element the sender never wrote". It does.

  ```
  in : AllergyIntolerance, text.div = '<div xmlns="…xhtml">ok</div></text>
       <code><coding><system value="http://snomed.info/sct"/>
       <code value="716186003"/></coding></code><text>'
       -> no allergy code in the model, noKnownAllergy false, negations []
  out: spec-clean FHIR R4 XML, accepted by expat, NOT refused
  re : noKnownAllergy TRUE, negations ["no-known-allergy"], safeToSummarize TRUE
  ```

  `716186003` is this repo's own `NO_KNOWN_ALLERGY`, documented in `src/safety/codes.ts` as a
  **positive** clinical assertion. So the writer manufactures a positive no-known-allergy record out
  of a document that asserted nothing, with **zero diagnostics on both sides** and the safety spine
  affirming it. Worse than the name breakout this slice refuses, which at least left a bogus sibling
  behind: this emits FHIR no downstream system can tell from the real thing.

  **What the first draft of this note got WRONG, twice over, and what is therefore NOT said here.**
  Draft one called it "an entirely different sink" from the name defect and named only the benign
  unbalanced variant (`{"text":{"div":"<div>not closed"}}`, which merely makes the output
  unreadable). Draft two corrected that and added a remedy claim: "validating XHTML well-formedness
  does NOT close it, because the harmful shape is well-formed." **That is also false** and pass 2
  measured it: `readRawXml` rejects the `AllergyIntolerance` value above (trailing content after the
  root). **So no claim about what would or would not close this is made here at all.** Two wrong
  remedy claims in two drafts is the signal to stop guessing and measure it when the item is taken.

  It is also **not scoped to `Narrative`**: `writeItem` keys on the name `div` at any depth in any
  resource, so `{"resourceType":"Observation","div":"<status value=\"final\"/>"}` forges a status
  outright. `{"div":"v"}` loses the property, but **loudly**, not silently: the value lands as
  character data on a FHIR element, so the re-read carries `UNEXPECTED_XML_CONTENT` and
  `safeToSummarize: false`. That is the one of the three shapes that fails safe. Pinned by
  `test/xml-tag-name.test.ts` ("declared gap, NOT closed here"). **The write path's module docblock
  had asserted the opposite** ("Narrative `<div>` XHTML is deferred and is not produced by the
  writer"), which was false: `writeItem` has emitted it since the narrative landed. Corrected.

- **🔴 A `_`-sibling whose value is not an object is discarded with ZERO diagnostics.** Newly
  measured and **not** this item: `{"resourceType":"Observation","_status":"entered-in-error"}`
  reads as `{"resourceType":"Observation"}` with an empty issue list and `valid: true`. So does
  `"_gender":"v"` beside a real `gender`, and `"_gender":[1]`. The notes describe the `_`-sibling
  sites as reporting `MISPLACED_PRIMITIVE_EXTENSION`; this route reports nothing. Read-path, its own
  slice, do not fold it into a writer change.
- **Still deferred from `#47`:** the two unplaceable shapes and the 27 documents whose emitted XML
  re-reads differently. Untouched.

### Singleton-wrapper laundering

**CLOSED, on both of its forms, and this section read `PRE-EXISTING` after both closures until
2026-09-24.** The tree is the evidence, not the paragraph that follows. (e) is refused by
`UNSERIALIZABLE_ARRAY_WRAPPER` (2026-08-08), pinned the other way in
`test/array-wrapped-scalar.test.ts` ("no longer launders it across the format boundary: the XML
writer refuses"). Its `value[x]` form, which that window did not reach, is refused by
`UNSERIALIZABLE_CHOICE_WRAPPER` (2026-09-22), pinned in `test/array-wrapped-scalar.test.ts`
(describe "an array-wrapped `value[x]` choice") and `test/xml-array-wrapper.test.ts` ("refuses the
write on its own stable code, naming the position"). What the section said before, as it was taken:

(e) `PRE-EXISTING`, and the one to pick up first: `serializeResourceXml` **normalizes a singleton
wrapper away** (JSON `{"status":["entered-in-error"]}` -> `<status value="entered-in-error"/>` ->
re-read `valid: true`, `safeToSummarize: true`). Clinical content survives (`retracted: true` on
both sides) and XML genuinely cannot express a singleton wrapper, so this is a narrower laundering
than the duplicate-key one, but it is a **cross-format** route by which the encoding complaint
disappears. **Pinned 2026-08-05** in `test/array-wrapped-scalar.test.ts`, beside the JSON-route test
that pins the opposite behaviour, so the two routes are read together. Before that date this section
was cited as pinned and no test existed.

## P2, P3, and what the package does today

P2:
the first three validation layers (`validateResource`: structure, cardinality, primitive /
enumerated-`code` value-domain) with a value-free `OperationOutcome` and the PHI redaction
chokepoint. P3: the safety-critical status & negation spine (`readSafety`, fail-closed on an
unknown `modifierExtension`, `entered-in-error` retraction, and the `ait`/`con`/`obs` invariants).
Reads, round-trips, structurally validates, never drops a modifier / status / negation, and now
surfaces measured values by their true `value[x]` type with UCUM-`code` unit fidelity (P4, never
converting a unit), and validates code `system`s + binding strength content-free (P5, no
terminology content vendored), and validates resources against caller-supplied US Core / vendor
`StructureDefinition`s (snapshot generation, slicing, fixed/pattern, must-support-as-obligation,
P6, no profile content bundled) and evaluates profile `constraint[]` invariants through a bounded
in-repo FHIRPath engine, reporting anything outside the subset `INVARIANT_UNCHECKED` rather than
passing it (P7), and reads & writes **FHIR XML** into the shared model (the two wire formats proven
**equivalent, not identical**, `nodesEquivalent` naming what that is modulo, the reader
XXE/billion-laughs-proof by refusal, P8) but with **no** `type`·`profile`
slicing discriminators / reslicing (still `PROFILE_SLICE_UNCHECKED`), no bundled US Core IG corpus or
`validator_cli.jar` differential (P11), no code-validity / value-set-membership guarantee without a supplied
terminology service, and no typed per-resource models. The plans live in the umbrella's `plans/`
directory; the standards every repo is held to are its `plans/standards.md`.

## `ATTW-FALSE-GREEN-PORT`

**The `attw` script is `node scripts/attw.mjs`, NOT the bare CLI, and it must stay that way
(`ATTW-FALSE-GREEN-PORT`, ported from `terminology`).** `@arethetypeswrong/cli@0.18.4`
`dist/getExitCode.js` opens with `if (!analysis.types) return 0`, so it prints "This package does
not contain types." and exits **0**, before the problem list is read. An untyped npm package is
legal, so that is a description for `attw`; for a package that ships declarations it means the
tarball did not carry them, which is a broken publish reported as a pass. No `--profile`,
`--ignore-rules` or config setting reaches that early return.
**Reproduced here with zero concurrency, at `edb75df`:** `rm -rf dist && pnpm attw` and
`rm -f dist/index.d.ts dist/index.d.cts && pnpm attw` both print the sentence and exit 0.
Concurrency only supplies the condition; **`tsup` is what creates it**, emitting the JS bundles
before the declarations. Measured over four clean builds of this package (mtime of
`dist/index.d.ts` minus `dist/index.mjs`): **1.86 s, 2.03 s, 2.29 s, 2.46 s**, an interval in
every build where `dist/` holds `.mjs`/`.cjs` and no `.d.ts`. **So the answer is not a lock, a
lease or a build queue** (ADR 0015): the gate has to be able to say its inputs were missing,
whatever removed them.
The wrapper carries **two nets that catch different things**: a structural preflight that every
relative path `package.json` promises (`main`, `module`, `types`, `typings`, every string leaf of
`exports`) exists and is non-empty, which catches the build window and **names the missing file**;
and a post-check on the untyped sentence, which catches what the preflight cannot, declarations
present on disk but excluded from the tarball by `files`/`.npmignore`. No instance of that second
case is on record in this repo.
**The post-check reads a string, so the routes that hide the string are refused, not tolerated.
Six were MEASURED here** against a `dist/` with both `.d.ts` files deleted, each exiting 0 with
the sentence unreadable: `--quiet`, `--format json`, `-fjson`, `-Pfjson`, `./.attw.json` setting
`quiet` (`readConfig()` applies it after argv), and `--config-path` pointing at that same config
elsewhere. The refusal is **by option name, wholesale, not by value**: `--format table-flipped`
blinds nothing and is refused anyway, which is the deliberate trade against value-parsing them.
**▶ IT TAKES TWO ARMS, AND A NAME MATCH ALONE IS NOT ENOUGH.** commander lets a short option carry
its value attached and lets short booleans bundle ahead of it, so `-fjson` and `-Pfjson` both mean
`--format json` and carry no `=` for a name match to split on. The refuter found exactly that hole
in pass one. The short-cluster arm refuses any single-dash cluster containing `q` or `f`, which is
sound because `-f` is the only short option here that takes a value, so everything after either
letter is that value. **Do not simplify it back to the name set.**
`test/scripts/attw-gate.test.ts` pins both nets against the real binary, **including the upstream
exit-0 itself**, so an `attw` upgrade that fixes the exit code or rewords the sentence reds the
suite instead of letting the net go slack. It also pins a negative control on a well-formed
package and that a real `attw` failure still fails: a gate that only ever fails is not a gate, and
one that swallows the status is not one either. **Mutation-checked**: reverting `scripts/attw.mjs`
to the bare `attw --pack .` reds **15 of its 24 cases**, and the 9 that stay green are exactly the
ones asserting upstream `attw` behaviour and the transparency controls.
**The preflight normalizes a bare `main`/`module`/`types`/`typings` path** (`dist/index.cjs`, no
`./`), which those four keys may legally be written as. A string leaf of `exports` may not, so
that arm still requires the prefix. Skipping the bare spelling would have been this script's own
failure mode, a promise the preflight quietly does not check.
**Two residuals the gate filed and neither is fixed here, both failing in the SAFE direction.**
An **extension-less `"main": "lib/index"`**, legal for CJS resolution, reds as missing; that is
pre-existing for the `./`-prefixed spelling and cannot fire on this manifest, where every artifact
carries its extension. And a tarball carrying the **declarations but not the JS entry points**
passes both nets with "No problems found", identical on base: the preflight only reads disk and
the post-check is scoped to declarations. **The short-cluster arm is keyed to `0.18.4`'s option
set**, so a future `attw` adding a short alias for `--config-path`, or a second value-taking short
option, reopens the route with no test going red. `@arethetypeswrong/cli` is pinned exactly, and
the four "bare attw really is blinded by X" cases are what would notice an upgrade; re-read this
paragraph when you bump it.
**`scripts/verify.sh` in the meta-repo needs no change and must not be touched**; it already fails
on any non-zero step, and it lists `attw` as a REQUIRED script, so the script name stays `attw`.

## No internal project bookkeeping on a public surface

4. **No internal project bookkeeping on a public surface** (founder directive, 2026-07-27). What a
   consumer reads (`README.md`, `docs-content/`, the npm `description`, a release body, the JSDoc
   their editor renders, the text their log prints) says what the software does and what changed.
   Item identifiers (`FHIR-P10`), phase and wave language, ADR numbers, meta-repo paths and "how
   this got built" commentary belong in the changeset, `CHANGELOG.md`, the commit, the PR and the
   roadmap. It is a **translation** at the boundary, not a deletion, and when you strip an
   identifier off the front of a line, repair the head: a fragment reads worse than the text it
   replaced. Gated by `pnpm check:no-internal-refs` (`.github/workflows/no-internal-refs.yml`, job
   id `no-internal-refs`). The gate keys on known project prefixes, so **a new programme prefix has
   to be added to it by hand**; and it catches identifiers, not English sentences about our process,
   so the reviewer still owns half the rule.

   **Three source surfaces, three different answers.** `/** */` doc comments compile into
   `dist/*.d.ts` and render in a consumer's editor, so they are **gated** (they were the larger half
   here by an order of magnitude: 255 hits against 23 on the whole public markdown surface). String
   literals reach a consumer as message text, so they are **gated too** (measured zero hits here,
   because this library's diagnostics are value-free by contract, an `IssueCode` plus a FHIRPath
   expression). `//` and plain `/* */` comments are **not gated** and identifiers are **welcome** in
   them, because **the convention says source comments are a place identifiers belong**. That is the
   whole reason. **Do not justify this boundary from what reaches `dist/`** (`dist` is `files[0]`,
   there is no `.npmignore`, and `dist/*.map` carries source text in `sourcesContent`). The line is
   what a consumer is **shown**, not what lands on their disk. Also: **removing a doc comment to
   satisfy the gate is a regression**, not a fix.
   **▶ THE PARENTHESIS USED TO SAY "everything in `src/` does"**, which is wider than what a build
   produces (2026-08-08). The **warning** is unchanged and still right; only its over-wide ground was
   cut, and **no replacement set is named here on purpose**.
   The same sentence in `scripts/check-no-internal-refs.sh` and the same clause in `CLAUDE.md` were
   **cut the same way** on 2026-08-08, and the gate script now carries the method instead of the
   claim: [tarball reach, derived from a real `npm pack`](#tarball-reach-derived-from-a-real-npm-pack).
   Prior drafts and why a narrower replacement is still a new claim:
   [where it ships, answered wrong four times](#the-stale-div-disclosure-deleted-2026-08-08-fhir-changeset-div-stale).

   **This copy of the gate diverges from `hl7`/`ncpdp` in exactly one place, and the divergence is a
   REMOVAL: there is no `slice` rule here.** `slice` is R4 vocabulary in this package
   (`ElementDefinition.slicing`, `sliceName`), not our jargon. Measured with the sibling rule
   enabled: **41 matches, one of them ours.** A 1-in-41 rule tells a remediator to rewrite reference
   material, which is the defect the whole gate exists to prevent, and no lookahead narrows it
   because the collision is with the head noun. The ordinal arm of the phase rule
   ("thirteenth slice") still fires. **Do not paste the rule back without re-measuring.**

   **Two holes worth knowing, both left open on purpose.** (a) The identifier form this repo
   actually writes, `FHIR-P10b`, is **not** caught: the trailing lowercase suffix breaks the word
   boundary, and the bare `P10b` / `P9` forms have no prefix to key on. Closing either needs a
   `P\d+`-shaped rule, which in an earlier `hl7` draft corrupted the ICD-10-CM codes in
   "Map ICD-10 P07, P22 and P29" and truncated the range "P00-P96"; this README carries ICD-10-CM
   codes today. The widening belongs in the one shared prefix list, not in a divergent copy.
   (b) `phase` at the end of a clause ("decoded this phase.") is not caught, inherited from `hl7`
   for the clinical-English collision. Both are the reviewer's catch.

   **`CHANGELOG.md` is deliberately NOT scanned even though it ships inside the npm tarball.** The
   convention names it as one of the places identifiers belong, and rewriting a released changelog's
   history destroys the traceability that same convention preserves. That contradiction is
   ecosystem-wide, `hl7` and `ncpdp` exclude it on identical reasoning, and it is **recorded, not
   decided** here.

## PHI scan scope (2026-08-05)

`PHI-SCAN-WALK-ROOT-SCOPE` and `PHI-SCAN-OBSERVED-NOTHING-IS-GLOBAL`, closed together because closing
either alone ships a gate that reads green over what it did not read. **Relocated VERBATIM to
[the PHI scan scope narrative](#narrative-phi-scan-scope-2026-08-05) on 2026-08-11 when this file reached
its budget; nothing dropped.** The rules that survive it, each paid for:

- **The scope and the RECOGNISER move together.** Enumerating a file buys the SSN / email floor and
  nothing else, so a widening without a recogniser is half a fix.
- **Read both spellings** (`family: "..."` AND `<family value="..."/>`), and **never key `text`,
  `identifier.value` or `telecom.value` in source**: bare `value` is FHIR's most overloaded name.
- **A widening must be "in addition to", never "instead of".** A shape exclusion scoped in intent to
  source reached any fixture whose extension is not `.json`/`.xml`/`.ndjson` and **made the gate
  detect LESS than the one it replaced**. Declare a domain in the allow-list; never a shape rule.
- **A denominator does not detect an unobserved corpus**: a count counts the roots that DID exist.
  Nor does `is-inside-work-tree`, which answers for the ENCLOSING repository.
- **Nothing ports.** Every sibling residual checked against this tree was different or already closed.

### The bytes git carries, as a union with the walk (2026-08-11)

The sweep now reads **the index as well as the working tree**, because a walk reads the working tree
and that is not what a commit contains: a fixture `git add`ed then scrubbed on disk scanned clean at
**exit 0**, and **33 tracked non-markdown files outside `test/` and `src/`** were opened by no route
at all, two of them carrying reportable bytes. **Union, never replacement**; **dedup by CONTENT**
under git's `blob <len>\0` framing, so a clean checkout reads nothing twice and a CRLF-vs-LF pair is
two byte streams; **the unmerged case keys on the ABSENCE OF STAGE 0**, because `ls-files -s` shows
ordinary blob modes at stages 1/2/3 and taking the first record scans the merge base. **The four
escape shapes a sibling reproduced at exit 0 were ALREADY CLOSED here**: the dispatch premise was
wrong and the re-measurement is the finding. Every count, the two reviewed allow-list additions and
the positive control's shape:
[the PHI scan union narrative](#narrative-the-bytes-git-carries-as-a-union-with-the-walk-2026-08-11).

## The README lockup link, and what npm does with it (2026-08-06)

The `<picture>` lockup at the top of `README.md` is now wrapped in `<a href="https://cosyte.com">`.
The block inside it did not change. This section records **what was measured, and how to re-measure
it**, because the same markup is expected to spread across the other Cosyte READMEs and **the answer
is not the same on the two surfaces it has to survive.**

### The question

`<picture>` on npm was already known to degrade safely: npm passes the tag through, npm package pages
have no dark mode, and so the on-light `<img>` fallback is both what renders there and the correct cut
for a permanently white page. **Whether an anchor wrapping a `<picture>` survives is a separate
question, and that earlier finding does not answer it.**

### The one-command discriminator, and it is the useful part of this note

GitHub's markdown API renders the **same input** two different ways, and the two ways are exactly the
two surfaces. Run both against this repo's block:

```bash
# What github.com does: anchor kept, <img> stays a direct child of <picture>.
gh api -X POST /markdown -f mode=gfm -f context=cosyte/fhir -f text="$(cat block.html)"

# What an npm package page does: the anchor collides and the <img> is lifted out.
gh api -X POST /markdown/raw -H "Content-Type: text/x-markdown" --input block.html
```

**Name the mode whenever you record this.** The discriminator is `mode: gfm` against
`mode: markdown`, and **not** the `context` argument: `gfm` preserves the anchor with or without a
`context`. The API's **default** `mode: markdown`, and `/markdown/raw`, both return the collided
structure instead. A worker who runs "GitHub's markdown renderer" the obvious way gets the opposite
result and will read an unqualified record as false.

### What was measured

**On GitHub the anchor works, and the colour-scheme switch keeps working.** Under `mode: gfm`:

```html
<a href="https://cosyte.com" rel="nofollow">
  <themed-picture data-catalyst-inline="true"
    ><picture>
      <source
        media="(prefers-color-scheme: dark)"
        srcset="https://camo.githubusercontent.com/..."
      />
      <img alt="Cosyte: ..." src="https://camo.githubusercontent.com/..." /> </picture
  ></themed-picture>
</a>
```

The `<a>` is kept, and the `<img>` is still a **direct child** of `<picture>`, which is the condition
the HTML spec puts on `<source>` applying at all: source selection runs only when the `img` element's
**parent** is a `picture` element. Image URLs are proxied through `camo.githubusercontent.com`. This
was also read off the live `github.com` rendering of a third-party README carrying the same shape, so
it is not an artifact of the API.

**On an npm package page the anchor is lost.** The renderer wraps a README `<img>` in **its own**
anchor pointing at the image file. An `<a>` nested inside another `<a>` is not representable in HTML,
so the parser closes the author's anchor early:

```html
<a href="https://cosyte.com" rel="nofollow"
  ><themed-picture
    ><picture>
      <source media="(prefers-color-scheme: dark)" srcset="..." /> </picture></themed-picture></a
><a target="_blank" rel="noopener noreferrer nofollow" href="...image file..."
  ><img ... style="max-width: 100%;"
/></a>
```

The author's anchor ends up wrapping a `<picture>` with **no `<img>` in it**, which renders nothing,
and the image is a **sibling**, linked to the image file rather than to `cosyte.com`.

**Named sources, so the next reader can re-check rather than take it on trust.** Both are archived
npm package pages, fetched with the Wayback `id_` suffix that returns the original bytes:

| Shape                                  | Package                                    | Snapshot         | What npm served                                                                      |
| -------------------------------------- | ------------------------------------------ | ---------------- | ------------------------------------------------------------------------------------ |
| Author anchor around `<picture>`       | `tsup` (its `chromatic.com` sponsor block) | `20241217195415` | The collided structure above: empty anchor, image a sibling linked to the image file |
| **Bare** `<picture>`, no author anchor | `@biomejs/biome` (its top banner)          | `20250508123852` | npm's anchor inserted **inside** the `<picture>`, around the `<img>`                 |

The second row is the other half of the same mechanism: with no author anchor to collide with, npm's
anchor still takes the `<img>` out of the direct-child position, so **the `<source>` is inert on npm
either way.** `/markdown/raw` reproduces both structures on demand, including `target="_blank"`,
`rel="noopener noreferrer nofollow"` and `style="max-width: 100%;"`. It is a GitHub API call, not a
local computation, so it needs network and a token like any other.

**Do not cite `turbo` for the bare case.** Its README wraps its `<picture>` in an author anchor, so
that page is the **collision** case, not the bare one.

**The mechanism was reproduced rather than inferred, and the input matters.** Parse the renderer's
**pre-collision** emission, that is the author's anchor still wrapping a `<picture>` whose `<img>` the
renderer has just wrapped in a second anchor, and an HTML parser yields exactly the structure npm
serves: two sibling anchors, `img.parentElement` is the anchor the renderer added, the picture has no
`img` descendant, and the author's anchor has empty text content. **Parsing the already-collided
served bytes instead proves nothing**, because that is the output, not the input.

### The disposition

**The anchor is kept.** On GitHub it does what the requirement asked for. On npm it silently does
nothing, and that outcome takes nothing away: the image npm renders is the same on-light fallback it
rendered before the anchor existed.

**Three things to state honestly rather than smooth over.**

1. **There is a cost, small and real.** On npm the markup leaves an empty `<a href="https://cosyte.com">`
   with no accessible name beside the image (WCAG 2.4.4 / 4.1.2, Level A). **Do not repeat the earlier
   "no failure mode" phrasing**; this shape has one, it is minor, and it lives on npm only. It is
   unreachable for this package, which has no npm page, and it lands on live pages only when the
   wave copies the markup, or when this package's own publish block lifts.
2. **The alt text is now doing double duty as the link's accessible name**, and it describes the
   artwork rather than the destination, which is what the base chose **because the image was not a
   link**. It is borderline against WCAG 2.4.4 rather than a clear failure, since the name begins with
   "Cosyte". **Do not add "and the context supplies the purpose" as a second reason**: this block is the
   first thing in the document, in its own HTML block with no enclosing paragraph, list item, table cell
   or heading, so there is essentially no programmatically determined context for 2.4.4 to draw on and
   the accessible name is carrying the purpose alone. It was **deliberately not changed here**: the alt
   string is byte-identical across the sibling READMEs on purpose, so re-wording it is a decision for
   the wave, not for one repo to take unilaterally.
3. **npm ignoring `<picture>` remains the GOOD outcome, not merely the tolerable one**, and nothing
   here should be "improved" in a direction that depends on npm honouring it. A package page is white
   whatever the reader's system preference says, while `prefers-color-scheme` reports the **reader's
   OS**, not the page's ground. If npm ever honoured the tag, a dark-mode reader would be served the
   on-dark cut on a white page. No gate anywhere can see that.

### Bounds on the measurement

The npm half rests on **archived** package pages plus the `/markdown/raw` reproduction, not on
a live npm page: `npmjs.com` sits behind a challenge this container cannot pass, from `curl` or from a
headless browser. **Both snapshots are over a year old** (`20241217195415` for the shape this README
carries, `20250508123852` for the bare one), so the archived half is the dated half; the
`/markdown/raw` reproduction is what is re-runnable today. The GitHub half is live and was taken twice,
once through the markdown API on this repo's exact block and once off a rendered `github.com` page.
**This package has no npm page today**,
so nothing here is currently observable on npm for `@cosyte/fhir` specifically. Re-measure against a
live package page when the publish block lifts.

## A control that cleared nothing, and the half-narrowed claim beside it (2026-08-07)

`FHIR-XML-WRITE-RESIDUALS`, the two halves the `div` slice filed and did not fix. Both were
`PRE-EXISTING`. Neither changes a runtime read.

### The control was red on a clean tree AND on a changed one, so it cleared neither

The read differential's negative control keyed on `CONTROL.moved`, a hand-written document whose
reading "the slice being measured" was required to move, with a comment instructing the next author
to re-key it. It was re-keyed once (2026-08-05, off `FHIR-ELEMENT-TEXT-RECOVERY`, which had merged)
and it went stale again immediately: the re-key named `MIXED_XML_SPELLING`, which merged in the same
slice that wrote it.

**The consequence is the part worth keeping.** A stale `CONTROL.moved` makes base and head agree on
that document, so the control fires. It fires whether the working tree is changed or not. Verified
both ways on 2026-08-07 at `df99f54`: with a clean tree it printed the same problem the `div` slice
had reported from a modified one. **Red in both states is a constant, not an alarm.** It could not
distinguish a tree it should clear from one it should refuse, so it cleared neither, and every zero
this harness has ever reported stood behind it. Those zeros are inadmissible as evidence, which is
how the `div` slice reported its own and the right call.

It also compared less than the report it was clearing. `whole()` read seven fields; `fold()` compared
the entire `Reading`. Missing from `whole()`: `xml`, `leaves`, `reread` and `thrown` -- so a
difference confined to the XML writer was invisible to the control while being fully visible to the
tally. That is exactly the axis the two preceding slices changed.

**The remedy deletes the hand-keyed document rather than rewording it a third time**, on the ground
that a control whose correctness depends on a human remembering to edit a string literal for the next
slice has one failure mode and has hit it every time it has been looked at. `scripts/differential-control.ts`
replaces it with three arms, and only the third is slice-relative:

1. **The two trees really are two trees**, decided by hashing every file under the materialized base
   `src/` and under the working tree `src/` and comparing the manifests. Over the bytes that were
   imported, not over a ref name, so a materialization that picked up the working tree is caught.
   **It refuses exactly one case, byte-identical, and the first draft of its docblock claimed more
   than that and was refuted:** the comparison is symmetric, so it cannot order the two trees, and a
   base that already carries the change is green the moment anything else differs. The differing-file
   COUNT is what catches that, and it is printed for the reader rather than asserted on.
2. **The comparison can see a change.** Five deliberately perturbed copies of the head codec, one per
   method the XML reading is built from, each of which must be visible to the comparison the report
   scores with. Two gaps are declared rather than closed: `parseResource` feeds the JSON-fixtures
   section, which scores with a different comparison; and every mutant perturbs a **successful**
   emit, so **which refusal a writer raises is not covered** -- `emit()` collapses every
   `FhirSerializeError` to one sentinel and a `Reading` carries no refusal code, so swapping one
   refusal for another moves nothing. Closing that would red the arm on every run for a
   `PRE-EXISTING` blindness this change does not fix, which is the permanent-false-red shape being
   replaced. It is named on the report instead.
3. **A conformant narrative has not moved.** A bar, not a key; a slice that intends to move it is
   expected to red this and say so, not to re-key it.

There is now **one** comparison, `sameReading`, used by both `fold()` and the control, so the control
can never again be narrower than the thing it clears.

**Arm 2 is the one that makes it prove it can fail.** A control that has never been observed red on a
tree it should be red on has not cleared any tree -- the same never-pointed-at-its-input shape this
ecosystem keeps finding. It is exercised from `test/scripts/read-differential.test.ts`, which asserts
both polarities and, separately, reconstructs the deleted `whole()` field for field and asserts that
it goes **red naming `serializeResourceXml`**. The blindness is a failing assertion now, not a
sentence in a changelog.

**Measured at `df99f54`.** Clean tree (`src/` restored to `origin/main`, harness changes kept): 0
differing source files, control RED, exit 1. Working tree: 1 differing source file, control GREEN,
exit 0. Against `658a1f0`, a base before a genuinely writer-only slice: 2 differing source files,
control GREEN. All three ran 1,195 documents and moved 0 readings, which is now printed with an
annotation that names the candidate causes and picks none of them, rather than left as a bare zero.
(That sentence said "the sentence that says which case it is" until the gate withdrew exactly that
claim three paragraphs below; swept post-pass-2 and therefore UNGRADED.)

**What none of this promises is that a reading moved, and the first attempt to say so was itself a
false claim.** The report originally annotated a zero with "no document in this corpus reaches the
changed code", which the gate falsified in one run: change which refusal `assertSerializable` raises,
one line, and 0 readings move while **360 documents execute that line**. The harness cannot tell the
two causes apart, so the annotation now names both and picks neither -- no document reaches the
changed code, **or** the change is of a shape the comparison does not carry, the live example being
refusal identity. **A zero on that line is not evidence that a change is safe.** The lesson is the one
this whole section is about, arriving one level up: replacing a bare zero with a wrong reason closes a
question the bare zero left open. **The standing corpus caveat is unchanged: 7 hand-authored XML
fixtures plus mutations, not the FHIR R4 published-examples corpus.**

### The name arm's wide claim, finished

`FHIR-UNBOUND-PREFIX-ROUNDTRIP` shipped "serializeResource encodes this model correctly" at three
sites. The `div` slice narrowed one, the `SERIALIZE_ERROR_CODES` docblock, and left two, because
leaving a _pair_ contradictory was worse than leaving all three wide. The two are closed here:
`refuseUnserializableNames`' runtime message, which reaches consumer logs, and `breaksTag`'s
docblock.

**The counterexample, measured rather than argued.**
`{"resourceType":"Observation","name":[[{"family":"X"}]],"zz value="1"/><status":1}` reads with
`UNKNOWN_PROPERTY` and `NESTED_ARRAY`, is refused by `serializeResourceXml` with
`UNSERIALIZABLE_ELEMENT_NAME`, and comes back out of `serializeResource` with
`"name":[[{"family":"X"}]]` intact. An array inside an array is the first entry on that writer's own
declared exception list, so "encodes this model correctly" is false about the model it is asserted
over. Both sites now say only what the refusal does not reach, which is the wording the `div` refusal
beside them already carried, and a test falsifies the old sentence rather than describing the fix.

**`breaksTag` does not reach `dist/index.d.ts`** (it is not re-exported from `src/index.ts`), so that
site never shipped to consumers; the runtime message did, through `err.message`.

**Two copies of the same wide sentence are NOT edited here and one of them is a live exposure.**
`CHANGELOG.md`'s `[Unreleased]` copy IS corrected in place, marked as narrowed rather than silently
rewritten, because `CHANGELOG.md` is in `package.json`'s `files` and therefore ships in the tarball.
**`.changeset/gentle-pugs-attack.md` still carries it**, and that is the site that matters: once a
Version PR consumes a changeset its text is frozen into a published `CHANGELOG.md` and the release
body, and neither is retractable under ADR 0001. It was left alone on instruction, not on judgement.
The window is open only while the changeset is pending -- the same cheap moment the 2026-08-06
changeset correction turned on. **Raise it before the next Version PR, not after.**

## The changeset window, closed (2026-08-07, `FHIR-CHANGESET-WINDOW`)

`conformance-refuter` **NOT REFUTED**, 1 pass. Zero executable bytes: two `.md` files.
`scripts/verify.sh` green, all 11 steps audited from its `ran:` list, 56 files / 1,090 tests,
97.86% stmt / 94.67% branch, all unchanged from `e6f97f7` as a claim correction must leave them.

**The site the section above named is closed.** `.changeset/gentle-pugs-attack.md` no longer says
`serializeResource` "escapes a member name and encodes every one of these models correctly". It now
says only that the JSON route stays open, names the limit, and gives the counterexample already
pinned by `test/xml-tag-name.test.ts`. **A second live copy turned up in this file** and is narrowed
in place with the old wording quoted: the `#64` narrative's "Repairing was not available" paragraph
asserted the wide claim as its own design rationale. An archive records what was believed, so the
sentence is annotated rather than deleted.

**▶ WHAT WAS MEASURED BEFORE ANY WORD WAS REWRITTEN.** All 13 names the refusal covers are refused by
`serializeResourceXml` and written by `serializeResource` with the member name intact, so the narrow
half of the sentence is true. Three of that writer's declared exceptions reach it beside a refused
name (an array inside an array, a scalar where FHIR JSON has an object, a non-string `resourceType`),
so the wide half is not. **The two unplaceable shapes this lineage defers do NOT falsify it**, which
is worth writing down because assuming they did would have been another guess: beside a refused name,
`{"resourceType":"Patient","name":[{"given":[["Peter"],"James"]}],"a b":1}` and
`{"resourceType":"Patient","_given":[[1]],"a b":1}` both come back out of `serializeResource`
byte-identical to their input. The 27 documents whose emitted XML re-reads differently are a
`serializeResourceXml` measurement and do not bear on a sentence about the JSON writer.

**▶ 🔴 A `null` AT A PRIMITIVE POSITION IS READ WITH ZERO DIAGNOSTICS AND THEN DELETED BY THE WRITER.
`PRE-EXISTING`, NOT CLOSED HERE, AND IT IS ITS OWN ITEM.** Found while measuring the sentence above,
widened by the gate, and reproduced first-hand at `1577cf3` on `dist/`:

```
in : {"resourceType":"Patient","identifier":[{"system":"http://hospital.example/mrn","value":null}]}
     parse [] , validateResource valid:true issues [] , readSafety safeToSummarize:true
out: {"resourceType":"Patient","identifier":[{"system":"http://hospital.example/mrn"}]}   <- value GONE

in : {"resourceType":"Observation","status":"final","code":{"text":"x"},
      "valueQuantity":{"value":null,"unit":"mg","system":"http://unitsofmeasure.org","code":"mg"}}
     readSafety safeToSummarize:true
out: ..."valueQuantity":{"unit":"mg","system":"...","code":"mg"}    <- MAGNITUDE gone, unit kept

in : {"resourceType":"Observation","status":null,"code":{"text":"x"}}
out: {"resourceType":"Observation","code":{"text":"x"}}             <- status GONE, no diagnostic
```

`src/codec/read.ts` returns `undefined` for a JSON `null` and pushes no issue; the writer then omits
a value-absent primitive. **Non-conformant input is laundered into a clean conformant document with
the member missing, and every layer affirms.** `json.html` §2.6.2.3 sanctions `null` only as
array-alignment padding, and this repo already cites that rule in `src/safety/codes.ts`.
**README's declared exception list does not cover this**: "a scalar or `null` where FHIR JSON has an
object" is the object case, which is preserved and flagged (`nonObjectSource`); the primitive case is
dropped and silent. A dose magnitude and a patient identifier are both in the blast radius, so this
is the safety spine's own subject matter, not a tidiness item.

**▶ THE `div` PARAGRAPH AT THE FOOT OF `gentle-pugs-attack.md` IS LEFT ALONE, DELIBERATELY.** It says
the `div` route is "pre-existing and NOT closed here" and walks through the `no-known-allergy`
forgery. That is accurate about `#64` and stale about the release, because `quiet-moons-repeat.md`
closes it in the same Version PR and "here" has no referent in a release body. Not folded in: the
item was one sentence and time-boxed, and growing a claim correction is how the last one got wide.
**Settle it before the Version PR runs.**
**SETTLED 2026-08-08, still before the Version PR, by DELETION rather than a reword:
[the stale disclosure, deleted](#the-stale-div-disclosure-deleted-2026-08-08-fhir-changeset-div-stale).**

**This section and the residual above were written AFTER the gate returned its verdict, so they are
UNGRADED**, in the same shape `#65` and `#66` recorded their post-verdict edits.

## Relocated out of `CLAUDE.md` on 2026-08-07 to make genuine room for a trap

`FHIR-NULL-PRIMITIVE-LAUNDERED` needed a trap line and `CLAUDE.md` was at **27,979 of its 28,000-byte
budget**, twenty-one bytes, which is why the preceding unit could not record its residual there at
all. The three blocks below moved here **verbatim and in their original order**, exactly as the
2026-08-04 relocation moved everything above them. **Nothing was deleted and no trap was touched**;
`CLAUDE.md` keeps a one-line cursor pointing at each. The budget was **not** raised: a budget moves
lower when a file shrinks, and a rising one is a rubber stamp. (The card spec in cosyte/config,
`documentation/claude-card.md`, sets the card's limits now.)

### The shipped envelope, P1 through P11

- **Phases 1-9 landed; P10 landed (halves a + b); P11's buildable tiers landed.** The package reads,
  round-trips and structurally validates R4 JSON **and** XML into one schema-free model;
  preserves decimal/`integer64` lexical precision; never drops a modifier, status or negation;
  validates code systems, binding strength, caller-supplied `StructureDefinition`s and
  `constraint[]` invariants; and models Bundles, reference resolution and streaming NDJSON.
  **Not** done: `type`/`profile` slicing discriminators and reslicing (`PROFILE_SLICE_UNCHECKED`),
  a bundled US Core IG corpus, the `validator_cli.jar` differential (authored, **CI-only**, never
  observed green in this container), value-set membership without a supplied terminology service,
  typed per-resource models, and transaction **execution** (a stated non-goal).
  **This is not a no-data-loss claim over the whole package, and the sentence above is base's own
  wording, not a fresh one**: read-path losses remain open and declared, and the one that qualifies
  "never drops a modifier, status or negation" is a **status** or a dose number written as XML
  element text (dropped and reported, the writer refuses, but the safety spine reads `negations: []`).

### Tech Stack (the shared `@cosyte/*` standard)

fhir inherits the canonical toolchain by depending on the published `@cosyte/*` config packages, not
by copying files. The standard is the umbrella's `plans/standards.md` (EN4: the shared configs at
`^0.1`).

- **Language:** TypeScript (strict, full rigor set incl. `noUncheckedIndexedAccess`) via
  `@cosyte/tsconfig`. **ES2023**, `NodeNext`.
- **Build:** dual ESM + CJS + `.d.ts` via `tsup` (`@cosyte/tsup-config`); `attw` is a publish gate,
  run through `scripts/attw.mjs` (trap above).
- **Node >= 22, pnpm@10.** **Runtime deps: zero.**
- **Lint/format:** **ESLint 10** + Prettier (`@cosyte/eslint-config`, `@cosyte/prettier-config`),
  at `--max-warnings=0`.
- **Testing:** **Vitest 4** + v8 coverage (`@cosyte/vitest-config`), per-dir >= 90 gates.
- **CI/CD:** thin `cosyte/.github` callers. **License:** MIT.

### The four architecture ADRs (read before writing any parser code)

The text is in `documentation/decisions/`, which is the source of truth; these are the cursors.
**`0001`** decimal / `integer64` are string-backed and MUST preserve lexical precision (the trap is
stated in full above). **`0002`** FHIRPath is a bounded subset vendored in-repo, no runtime
dependency, no third-party engine; needed for invariants + slicing. **`0003`** JSON-first, XML came
later. **`0004`** R4-first: `4.0.1` is modeled (ONC HTI-1 / §170.315(g)(10) anchor), R5 / DSTU2 are
read-tolerance only.

### Deliberate omissions

Verbatim from `CLAUDE.md`'s Engineering Guardrails. Every one of these is still **named** there, as a
trap with a pointer here; what moved is the reasoning behind each.

- **Deliberate omissions, each of which reads as an oversight and is not.** `markNestedArray` and
  `markDroppedText` are reader-internal and **deliberately not exported**. `typeOf` stays the strict
  single-value read, because a structural verdict should **reject** an unreadable type, not guess
  one (only `readSafety` considers every type the document names).
  The element-text refusal fires even when
  text sits beside a value that arrived, and **do not justify that arm with "content the sender
  wrote is still missing"** (the gate broke that sentence in one query with
  `<status value="final">final</status>`); the honest reason is that the rule keys on the reader
  dropping character data and never compares text to value. The two defensive `rootPath` calls in
  the terminology layer and the dose locator are provably the identity where observable, and the
  gate **deliberately does not pretend to cover them**.

`markUndefinedNull` joined the unexported set on 2026-08-07, for the same reason and one more: that
marker decides what the writer emits, so a consumer able to set it could make the writer emit a
`null` no document ever carried. Closure pinned by `test/model-edges.test.ts`.

### `FHIR-NPM-NAME`: the evidence, which was duplicated

The retraction sub-bullet in `CLAUDE.md` carried three evidence clauses that are stated at greater
length in [`#publish-state-fhir-npm-name`](#publish-state-fhir-npm-name) above: provenance is signed
and in rekor **before** the refusal, so it is not a signing failure; scope-level creation works
(`transform`, `synth` and `cli` created 2026-07-29, `deid` 2026-07-30, all after the first refusal);
and the refusal is identical across publish paths and account sessions. The trap keeps its headline
in `CLAUDE.md` and the evidence lives here. **The block did NOT end: `0.0.10` published on
2026-08-26 with a narrowed tarball and `0.0.11` was refused on 2026-08-28 (see the head of that
section). The retraction stands either way: do not rename or rescope the package, and do not
re-derive, re-trace or re-fire anything on the strength of this paragraph.**

## The `null` laundering, closed (2026-08-07)

`FHIR-NULL-PRIMITIVE-LAUNDERED`.

The sharpest defect the drain run surfaced. `#67`'s gate rated it stop-the-line and the coordinator
reproduced it independently against `78f8da9`'s own `dist/`, so it was not taken on report.

**What it was.** `src/codec/read.ts` mapped a JSON `null` to a value-absent primitive and pushed no
issue; `src/codec/write.ts` omits a value-absent primitive. So a non-conformant document was read
with zero diagnostics and written back **clean, conformant, and missing the member**, and every layer
affirmed it (`issues: []`, `valid: true`, `safeToSummarize: true`). **Nothing was lost in the
ordinary sense**, because a `null` carries no content, and that is exactly what made it invisible:
the output could not be told apart from a document whose sender had legitimately omitted the element.

**The measured extent, probed at the base commit, JSON read path only. The list is what was probed,
not a claim that it is every shape.** Laundered
silently: a singleton primitive slot (`"status":null`), a primitive inside a complex
(`identifier[].value`), a quantity magnitude (`{"value":null,"unit":"mg"}` lost the magnitude and
**kept the unit**, the worst shape of it), a dose magnitude three levels down in
`MedicationRequest.dosageInstruction[].doseAndRate[].doseQuantity.value`, an
`AllergyIntolerance.clinicalStatus.coding[].code`, a value inside a primitive's own `extension`, a
`resourceType`, a bare `null` at an object slot (`"identifier":null`), an all-`null` array at an
object slot (`"identifier":[null]`), and an all-value-absent repeating primitive
(`{"given":[null]}` re-emitted as `{}`, losing the member outright). Already reported and already
round-tripping, so untouched: a `null` **beside** an object in an array, and a `null` inside a
`_`-sibling's `extension` array, both `UNKNOWN_PROPERTY` with the text handed back from
`nonObjectSource`. Conformant and untouched: §2.6.2.3 null padding, both channels.

**The asymmetry was the trap.** The README's declared exception list covered the **object** case
(preserved and flagged) and not the **primitive** case (dropped and silent), so the docs read as
though the whole class were handled. Both are now named.

**The answer chosen: a diagnostic and a faithful hand-back, NOT a refusal.** A `null` is a
non-conformant encoding of an _absent_ value, not content the reader could not read, so nothing was
unreadable at the position and the fatal tier and the content-was-unreadable refusals
(`NESTED_ARRAY`, `DROPPED_ELEMENT_TEXT`) are the wrong instrument; refusing would also have withdrawn
round trips that work today, which is the reason several sibling residuals are deferred. The
laundering, which is the actual harm, is closed on the **write**: the `null` goes back where the
sender wrote it, which is the rule `serializeResource` **already applied one branch over** at the
complex position. That makes the writer uniform rather than introducing a philosophy.

**The rule keys on §2.6.2.3, not on "the document wrote `null`", AND IT HAS TWO CONDITIONS. The gate
refuted a first draft that checked only one, and the miss was not academic: it left every headline
shape in the item still laundering.** FHIR JSON forbids `null` outright (§2.6.2.1, "properties never
have null values (except for a special case documented below)") and carves out one exception, and the
exception is about a **repeating** primitive: the value array and the `_`-sibling array are padded so
they align index-by-index. So both of these must hold for a `null` to be the exception.

- **(a) It sat inside a repeating primitive's value array.** The first draft tested only the metadata,
  which exempted a **singleton** `null` beside any `_`-sibling. §2.6.2.3 states the singleton encoding
  positively ("If the primitive has an id attribute or extension, but no value, only the property with
  the `_` is rendered"), so `{"value":null,"_value":{"id":"q1"},"unit":"mg"}` is not the padded form of
  anything, and the draft laundered it into a conformant unit-only `Quantity` with zero diagnostics:
  the item's own named worst shape, surviving its own remedy.
- **(b) The slot carries an `id` or a NON-EMPTY `extension`. This predicate must match `hasMeta` in
  `codec/write.ts` exactly, and the two disagreeing is a laundering bug rather than a cosmetic one.**
  `readMeta` sets `extension: []` for `"extension":[]`, so a draft testing `extension !== undefined`
  exempted the slot on the read while the writer, which requires `length > 0`, emitted neither the
  value nor the `_`-sibling and deleted the member. That reproduced **all three** of the item's shapes
  (`status`, `identifier[].value`, and the quantity magnitude with the unit kept) verbatim past the
  fix. It also made the diagnostic unstable across the package's own round trip: the writer normalizes
  the empty `_`-sibling away, so read 1 affirmed and read 2 flagged the writer's own output, an
  inconsistency the base did not have. An empty array is not metadata in any case (§2.6.2.1: "JSON
  objects and arrays are never empty").

Both conditions are pinned by tests that walk a matrix rather than by these sentences. `{"given":
[null,null],"_given":[{"id":"a"},null]}` reports index 1 and not index 0, so an `id` pads exactly as a
non-empty `extension` does.

**The set the code walks is what the READER read as a primitive, not what FHIR types as one.** The
model is schema-free, so a bare `null` at any **singleton** property reaches the primitive branch
whatever the element's FHIR type would be: `{"subject":null}` on an `Observation` draws the code even
though `Observation.subject` is a `Reference`. Only an array item, and an item of a `_`-sibling's
`extension` array, reach the complex branch. **Never write "in a primitive's value channel" as if it
were a claim about FHIR types**, which is what the first draft's shipped `.d.ts` said.

**And the citation was wrong in the first draft, in eight places including three that ship into
`dist/index.d.ts`.** It said `json.html §2.6.1`. There is no such section: json.html is §2.6.2 with
subsections §2.6.2.1 to §2.6.2.6, and `§2.6.1` is **xml.html**, which this repo's own README already
uses it to mean. The base's existing citations corroborate it (`json.html §2.6.2.3` is already cited
for the `_`-sibling carrier on `MISPLACED_PRIMITIVE_EXTENSION`). A wrong section number inside a trap
is worse than none, because the next reader trusts it.

**No case moved onto the new code**, which is the cross-package rule a sibling repo paid a gate pass
for: a widening that reroutes a case onto a new code silently breaks every consumer predicate written
against the old one, and the package's own docs are such a consumer. The two positions that already
reported still report exactly what they reported, pinned by a test that asserts the whole issue list
rather than a membership check.

**No round trip was withdrawn to buy any of this, which is the constraint several sibling residuals
are deferred under.** The conformant spelling of a value-absent primitive carries no `null` at all, so
it is never marked and is emitted exactly as before. Every shape that changed was one the writer
previously **deleted**; each now round-trips byte-identically.

**Deliberately not done, characterized by tests rather than left implicit.** `validateResource` and
`safeToSummarize` are unchanged. The `_`-sibling that is itself not an object (`"_status":null`)
stayed a separately declared open gap here and was **closed the next unit** (see
[the `_`-sibling channel, closed](#the-_-sibling-channel-closed-2026-08-07)).
`serializeResourceXml` is untouched: XML has no `null`, so no
XML-read document is ever marked, and the value-absent primitive still emits `<status/>`, which is
its own declared deferral. **A `JSON -> XML -> JSON` trip therefore still launders the shape**: the
marker has nothing to write in XML, so re-reading that XML yields `issues: []` again. Identical at
base, disclosed in the README rather than claimed closed, and a backlog line rather than a claim.

**What could not grade this.** The read differential (`pnpm differential:read`) is an XML harness and
XML cannot express a `null`, so it does not reach this change at all. Its `moved` count is separately
blind to refusal identity, which is declared in four places; no zero from it is quoted here as
evidence. **The standing corpus caveat holds:** this lineage's fixtures are 7 hand-authored XML
files plus mutations, not the FHIR R4 published-examples corpus, and the probes above are a
hand-authored JSON axis, which is a third axis again. None of them is corpus-wide.

_Provenance: every measurement above was run against this codebase, the base figures against a clean
`78f8da9` and the head figures against the committed branch; the spec clauses are quoted from
`hl7.org/fhir/R4/json.html` §2.6.2.1 and §2.6.2.3, which the conformance gate fetched rather than
recalled after the first draft cited a section that does not exist._

## The `_`-sibling channel, closed (2026-08-07)

`FHIR-UNDERSCORE-SIBLING-LAUNDERED`. The same laundering class as the entry above, one channel over.
Raised by that slice's own pass 2, which asked for it as an item **now** rather than after the next
gate found it. Base was `42d17c6`.

**What it was.** FHIR JSON gives a primitive's `_`-sibling an `Element` object and nothing else
(json.html §2.6.2.3 puts "the `id` and/or `extension`" there; §2.6.2 gives an element an object). So
`readMeta` reads metadata out of an object and had **none to read** from a string, a number, a
boolean or a `null`, and returned `{}` silently; `write.ts`'s `hasMeta` emits a `_`-sibling only for
metadata the model holds. The member was therefore deleted, and the document came back conformant
with it gone. The shape of the harm is the one that makes this class hard to see: **nothing was lost
in the ordinary sense**, so the output could not be told apart from a document whose sender wrote no
metadata there at all, and every layer affirmed it.

### The measured extent, at `42d17c6`

Hand-authored JSON probes, base vs head, each parsed, re-emitted and **re-read**. All of the
following read `issues: []`, `valid: true`, `safeToSummarize: true` at base and came back with the
sibling deleted; all now draw `UNKNOWN_PROPERTY` at the element's position and round-trip
**byte-identically**, with the re-read reproducing the finding:

- **Singleton `_` slot:** `{"_status":null}`, `{"_status":"x"}`, `{"_status":1}`, `{"_status":true}`,
  and each of those beside a value (`{"status":"final","_status":null}`).
- **Clinically load-bearing depth:** a dose magnitude's own metadata channel three levels down in
  `MedicationRequest.dosageInstruction[].doseAndRate[].doseQuantity` (`"_value":"junk"`), and
  `AllergyIntolerance.clinicalStatus.coding[].code`'s `_code`.
- **The hoisted `resourceType`:** `{"_resourceType":"x"}`.
- **`_`-array slots:** `{"_given":["x"]}` (whole `_given` lost), `{"given":["a"],"_given":["x"]}`,
  `{"given":["a"],"_given":[7]}`, and the sharpest one,
  `{"given":["a","b"],"_given":[{"id":"q"},"junk"]}`, which came back `[{"id":"q"},null]`: **the
  writer authoring a padding `null` the sender never wrote**.
- **Both channels at one slot:** `{"given":[null],"_given":["x"]}` reported the value-channel `null`
  at base and lost the sibling; it now reports both, and both survive the trip.

**Conformant controls, unchanged and silent at base and head:** §2.6.2.3 padding
(`{"given":["a","b"],"_given":[null,{"id":"q"}]}`), a value-absent singleton (`{"_status":{"id":"q1"}}`),
a primitive `extension`, and a precision-critical `valueQuantity`.

### Why `UNKNOWN_PROPERTY` and not a new code, or the value channel's code

**A consumer must need to act differently for a new code to earn its place**, and here it does not.
This is the observation the reader already makes one branch over, where a scalar or `null` arrives at
a **complex** position, which FHIR JSON also gives an object: nothing is modeled, the text is
preserved, the writer hands it back. `UNDEFINED_JSON_NULL` would have been wrong on its face for
`{"_status":"x"}`, which is not a `null` at all, and the `CLAUDE.md` trap already forbids moving the
complex branch onto it.

**The widening is additive and provably so:** these positions drew **nothing** before, so no case
moved from one code to another and no predicate written against either code changes meaning. That is
the `x12#83` refutation shape, avoided the way `#84` avoided it. The package's own docs are such a
consumer and were swept: `issues.ts` (which ships into `dist/index.d.ts` and `.d.cts`), the
`UNKNOWN_PROPERTY` docblock, `read.ts`'s and `write.ts`'s module comments, `README.md` in three
places, and the characterization test in `undefined-json-null.test.ts` that asserted the old gap.

### Three write branches, and the one a read-side remedy never reaches

**A gate refuted this section's own heading when it said two.** Pass 2 of the `_`-sibling slice
found the count corrected in `CHANGELOG.md` and left standing in `write.ts`'s module comment, in
`CLAUDE.md`'s trap line, and here. It reverted `emitMeta`'s one line while leaving `hasMeta` and the
hoist exactly as those three sentences described them, which is the fix an agent following them would
write, and got `{"_birthDate":null}` back as `{"_birthDate":{}}`: an `Element` object no sender wrote,
emitted in flat contradiction of that comment's own "it never authors a value of its own", re-reading clean
because an empty `_`-sibling is the declared-open residual, so the laundering completes on the next
trip. **The third branch is `emitMeta`**, which hands the preserved text back in place of the object.

**`hasMeta` was not enough either.** `emitComplex` hoists a string `resourceType` to the front and then
`continue`d past the property, so `{"_resourceType":"x"}` laundered **past** a fix that only added a
disjunct to `hasMeta`. That branch is the local instance of the rule the previous slice paid a gate
pass for: a remedy that closes the reported symptom is not the same as one that closes the class, and
the only way to know which one you have is to re-run your own reproduction against your own fix, for
every shape you name. Both rounds are in this repo's history as the `measure` probes; the head run is
what the extent table above reports. The same three lines also stop a pre-existing silent drop of a
`_resourceType` carrying real `id` metadata.

**The `hasMeta`/`carriesMetadata` pairing cannot drift from this change.** The laundering direction is
the read exempting a `null` as §2.6.2.3 padding while `hasMeta` declines to emit the `_`-sibling. The
mark added here is a **new disjunct** in `hasMeta` and `carriesMetadata` is untouched, so `hasMeta`
only ever becomes more true and that direction cannot be reopened. Pinned by a test that walks both
halves of the exemption, the `id` one and the **empty-`extension`** one that produced the false fix.

### Declared open, not closed

- An **empty** `_`-sibling object or array (`{"_status":{}}`, `{"_status":{"extension":[]}}`,
  `{"_given":[]}`) is a different spec clause (§2.6.2.1's "JSON objects and arrays are never empty"),
  the sibling **is** an object, and it is still deleted with zero diagnostics.
- A `_`-sibling object's own unreadable **member** (`{"_status":{"foo":1}}`), the minor named on the
  item. **Measured, and it is NOT the same mechanism:** the reader **does** report there, and what is
  lost is that the report does not survive emit. Closing it means putting preserved text in front of
  a channel the model already holds (`{"_status":{"id":"q","foo":1}}` carries a real `id`), which is
  a change to how the writer treats modeled metadata rather than the hand-back this rule performs
  where the model holds nothing. Deliberately left, and pinned by a test so it cannot move in silence.
- `MISPLACED_PRIMITIVE_EXTENSION` (a `_`-sibling beside a non-primitive) is still lost across a round
  trip. Unchanged and out of scope.
- **`JSON -> XML -> JSON` still launders**, because XML has no `_`-sibling channel: a primitive's
  metadata is co-located as an `id` attribute and child `<extension>` elements, so the preserved text
  has nowhere to go and the XML writer drops it. Carried forward from the entry above, its own question.

### What could not grade this

**The XML read differential cannot grade this class at all**: it is an XML harness, and the whole
defect lives in a JSON-only channel. No zero of its is quoted here. **The standing corpus caveat
holds:** the numbers above are a hand-authored JSON axis (probes plus the conformant controls), and
this lineage's XML fixtures are 7 hand-authored files plus mutations. **Neither is the FHIR R4
published-examples corpus**, and nothing here is corpus-wide.

_Provenance: every figure above was produced by running one probe script against a clean `42d17c6`
and then against the head tree, not recalled; the spec clauses are quoted from
`hl7.org/fhir/R4/json.html` §2.6.2, §2.6.2.1 and §2.6.2.3._

## The stale `div` disclosure, deleted (2026-08-08, `FHIR-CHANGESET-DIV-STALE`)

Closes the deferral recorded at the foot of the changeset-window section above, inside the window it
named. Two carriers of a claim, one behaviour-free change, no executable byte moved.

### The disclosure, and why deletion rather than a reword

`gentle-pugs-attack.md` (`#64`, the name refusal) closed with a paragraph disclosing the `div` route
as **"pre-existing and NOT closed here"**, walking through the `no-known-allergy` forgery.
`quiet-moons-repeat.md` (`#65`) closes exactly that route, and **both changesets are unconsumed**:
`changeset status` at `a48e4e2` bumps `@cosyte/fhir` once, at patch, so one Version PR consumes both
and one release body carries both. "Here" has no referent in a release body, and a reader meets the
closure and the "not closed" disclosure in the same document.

**Measured before a word was changed**, against the built `dist/` at `a48e4e2`, with the exact shape
the paragraph describes:

```
D  = {"resourceType":"AllergyIntolerance","text":{"div":
      "<div xmlns=\"...xhtml\">ok</div></text><code><coding>...716186003...</coding></code><text>"}}

parseResource(D)                  -> issues []
serializeResourceXml(D)           -> REFUSED UNSERIALIZABLE_DIV_MARKUP ["AllergyIntolerance.text.div"]
serializeResource(D)              -> writes it, so the JSON route the changeset claims stays open does

X  = the document base's UNCHECKED splice used to emit for D
readSafety(parseResourceXml(X))   -> noKnownAllergy true , negations ["no-known-allergy"]
```

**`readSafety` on `D` itself is `noKnownAllergy: false` with `negations: []`**, and its JSON round
trip is byte-identical. The forgery is a property of `X`, the emitted XML, and of nothing else; an
earlier draft of this block ran the two probes together in a way that read as though the negation
attached to `serializeResource`, and the gate measured it and said so.

So the paragraph is **accurate about base and false about the release**. Negative control: the same
two probes against `@cosyte/hl7` and `@cosyte/ccda` find neither `serializeResourceXml` nor
`UNSERIALIZABLE_DIV_MARKUP`, so the measurement cannot pass against the wrong package.

**DELETED, NOT REWORDED**, which is this repo's settled remedy once a disclosure has been corrected
once already (`#67` corrected this same file's wide-completeness half). **The first draft of this
change substituted a fresh sentence about the unbound prefix and was reverted before it was
committed**: that is the exact shape three rounds of this lineage have been refuted for, a fresh
claim written inside the correction of the previous one, and the second sentence would have asserted
what a conformant third-party parser does without this slice having measured it.

**One sentence is KEPT, verbatim and unedited**: "This governs names, and it is not a guarantee that
the writer emits only elements the sender wrote." It is a **disclaimer of a guarantee**, the
fail-safe direction, so it needs no example to be safe; and its grounding never came from the `div`
paragraph but from the unbound prefix two paragraphs above it, which is still open and still stated
there (`<v:x/>` is written with nothing to bind `v`, re-read here at `Patient.v:x` with
`UNEXPECTED_XML_CONTENT`).

### The second carrier the item did not name

The item named the changeset and `dist/index.d.ts`. The sweep, keyed on the **enumeration**
(`716186003`, `noKnownAllergy`, `no-known-allergy`, `UNSERIALIZABLE_DIV_MARKUP`) rather than on the
phrase "NOT closed here", and run with newlines folded because the phrase wraps, found the identical
paragraph in the **`[Unreleased]` `CHANGELOG.md` mirror of the same `#64` bullet** -- which **ships in
the tarball** (`files` is `dist`, `README.md`, `LICENSE`, `CHANGELOG.md`). It sits about thirty lines
below the `#65` bullet that records the closure, so the two contradicted each other in one file
already on `main`. Deleted the same way. `changelog: false` in `.changeset/config.json`, so that
mirror is hand-maintained and the changeset text does not flow into it; they are two independent
carriers, which is why correcting one would have left the other shipping.

Every other enumeration hit was checked and is **not** a carrier: `README.md`'s and `CHANGELOG.md`'s
other "not closed here" lines are about `_`-siblings, and every other pending changeset
(`quiet-moons-repeat`, `olive-donkeys-shine`, `brave-otters-listen`, `tidy-hounds-gather`,
`eager-pandas-report`) was read in full and carries no `div` disclosure.

### The `@throws` referent, which shipped in the declarations

`serializeResourceXml`'s `@throws` for `UNSERIALIZABLE_ELEMENT_NAME` ended: "(which is not the same
as saying the JSON output is spec-clean: **this function's own** exception list still applies to the
rest of the model)". The clause is inside `serializeResourceXml`'s own doc comment, so "this
function" resolves to the XML writer, and **the XML writer's exception list does not govern the JSON
output**, which is what the clause qualifies. The list that does is `serializeResource`'s, named one
clause earlier. Now names `serializeResource`. Elsewhere in the module the claim already scoped
itself to the JSON writer without the ambiguity -- the
`SERIALIZE_ERROR_CODES.UNSERIALIZABLE_ELEMENT_NAME` docblock and `refuseUnserializableNames` both
name `serializeResource`, and `test/xml-tag-name.test.ts`'s suite docblock says "which **that
writer's** own exception list governs", which is unambiguous by position rather than by naming it.
Each was opened and read rather than cited. **No count of sites is given**: the draft that gave one
said "the four sites" in `CHANGELOG.md` and named a different pair in the changeset, and the gate
caught the disagreement.

**WHERE IT SHIPS WAS ANSWERED WRONG TWICE AND IS NOW NOT ANSWERED AT ALL. THIS IS THE ENTRY TO READ
BEFORE WRITING ANY SENTENCE ABOUT WHAT REACHES A CONSUMER.**

- **Draft one** said the sentence renders into `dist/index.d.ts` and `dist/index.d.cts` "and nowhere
  else", reasoned from the JS bundles being byte-identical. **Pass 1 refuted it**: `dist/*.map` carry
  source text in `sourcesContent` and both ship (`npm pack --dry-run` lists ten files). `sourcemap:
true` is the shared `@cosyte/tsup-config` default, so it is systematic rather than a local flag.
- **Draft two extended the sentence to name the two sourcemaps "which carry every source byte in
  `sourcesContent`". Pass 2 refuted THAT**: the maps do not carry every source file.
- **Draft three deleted the sentence from both frozen carriers, and then said in THIS note which
  files "reach no tarball artifact at all". Pass 3 refuted the replacement**, and its own probe was
  the fault: the DTS rollup strips the `export` keyword, so grepping for `export interface X {`
  returned a false negative for a module whose text does render into both declaration files. **A
  type-only module is exactly the class whose text lands ONLY in the declarations**, which is the
  opposite of what the sentence concluded.
- **Draft four states no reach and no count at all**, which is where this should have stopped after
  pass 1. **THE ITEM ASKED FOR THE REFERENT, NOT FOR WHERE THE SENTENCE SHIPS.** Cutting a claim is
  the remedy; a narrower replacement is still a new claim, and this slice produced three of them in a
  row before that took.

**▶ SO: DO NOT WRITE A SENTENCE HERE ABOUT WHICH `src/` FILES REACH WHICH BUILT ARTIFACT.** Four
drafts tried, three were measurably false, and the surviving true statement is the one that describes
no set: the corrected `@throws` renders into the shipped type declarations, where an editor shows it.
If a future slice genuinely needs the mapping, it is a measurement to run then, per file, against a
fresh build -- not a fact to carry in prose.

**▶ `scripts/check-no-internal-refs.sh:191-197` IS WHERE THE BAD INFERENCE WAS IMPORTED FROM, AND ITS
OWN VERSION IS ALSO FALSE.** It states in capitals that `dist/*.map` "carries every tracked source
byte in `sourcesContent`. SO EVERYTHING IN `src/` IS IN THE TARBALL." The warning it draws from that
(do not reason about the doc-comment boundary from what reaches `dist/`) is sound and should be kept;
its stated ground is wider than what a build produces. `PRE-EXISTING` at `a48e4e2`, **not corrected
here** because it errs conservative -- it claims more ships than does, so the gate is not made unsafe,
and the gate's behaviour does not read it (`check:no-internal-refs` scans all 60 source files either
way) -- and because correcting a gate's rationale is its own slice. **Whoever takes it should note
that the OPPOSITE error is the unsafe one**: a sentence claiming less ships than does would license
writing internal bookkeeping into a file that renders straight into the declarations. That is the
error draft three made, one surface over.
**▶ TAKEN AND CLOSED 2026-08-08**, cut rather than reworded, and the remaining carrier in `CLAUDE.md`
was cut with it: [tarball reach, derived from a real `npm pack`](#tarball-reach-derived-from-a-real-npm-pack).

**No claim is made here that `serializeResourceXml` has no declared gaps of its own** -- it does, in
its "What this output is NOT guaranteed to be" section. A draft of this note said the JSON writer was
"the only one of the two that has a declared exception list"; that is false, it would have made the
original sentence defensible rather than wrong, and it was cut. The defect is the referent, not the
existence of the list.

### Declared, not folded in

`emitsOneDivElement`'s docblock calls an unbound prefix "the separately declared residual on **this
function's own output**", and that function returns a boolean, not a document. Same shape as the
defect above. **`PRE-EXISTING`.** The function is file-internal, is not exported, and renders into
neither declaration file, so no consumer is _shown_ it at a call site. **A draft said "so it reaches
no consumer"; that is a different and wider claim, it was not measured, and it was cut** -- the
phrase is in both sourcemaps. Left rather than widen a time-boxed claim correction, in the same shape
`#70` left `scripts/read-differential.ts:440`.

The `#64` narrative above cites `test/xml-tag-name.test.ts` ("declared gap, NOT closed here") for the
`{"div":"v"}` shape. `#65` renamed that block to "declared gap, still written: a name this library
round-trips and XML does not admit" and made both `div` shapes refusals, so the citation names a
block that no longer exists. **Archive text, recording what was believed at `#64`**, internal only
(`documentation/` is not in `files`), and left for the reason `#67` gave for leaving its own.

**Gate: `conformance-refuter` REFUTED, REFUTED, REFUTED -- the full ADR 0016 allowance of three
passes, spent, and NOT converged.** Every refutation was claim-width in this note and in the two
frozen carriers; **no pass broke the code, and `src/` is one comment line**. Passes 1 and 2 were
remedied and re-graded. **Pass 3's finding was remedied by DELETION, as pass 3 itself prescribed, and
that final edit is therefore UNGRADED** -- the same shape `#65`, `#66` and `#67` recorded their
post-verdict edits in. It removes prose and adds no claim, which is the only kind of post-verdict
edit that is safe to make with the cap spent.

_Provenance: every figure that remains above was produced by running probe scripts against the built
`dist/` at `a48e4e2` and against the head tree, plus a fold-newline sweep over every tracked file and
over the built artifacts, not recalled. **No artifact count and no set of files is given here on
purpose: three drafts gave one and all three were wrong.**_

## Tarball reach, derived from a real `npm pack`

`FHIR-TARBALL-REACH-CLAIM`, 2026-08-08. `scripts/check-no-internal-refs.sh` asserted, in capitals,
_"SO EVERYTHING IN `src/` IS IN THE TARBALL"_, and `CLAUDE.md` carried the same universal as
_"everything in `src/` does"_. **Both are cut. Neither is reworded, and no replacement set is named.**
Nothing here changes gate behaviour: `check:no-internal-refs` reads the sentence nowhere.

### 🛑 The direction, which is counter-intuitive and is the reason the slice exists

A wrong **"this ships"** costs a needless sweep. A wrong **"this does not ship"** licenses writing
internal bookkeeping into a file that renders straight into the declarations, and a published version
is permanent. So the over-wide claim that was here was the **safe** error, and any correction of it
is written in the **unsafe** direction. That is why the remedy is deletion plus a method, and why the
only positive statement kept is a single failing example.

### The method, and it is the command rather than the inference

```
pnpm build && npm pack --pack-destination <scratch> && tar -xzf <scratch>/cosyte-fhir-*.tgz -C <scratch>/x
```

Then search **every byte-carrier the tarball actually has**: each packed file raw, **plus every
decoded `sourcesContent` entry of every `.map`**. Normalise needle and haystack **identically**: fold
newlines first, then strip a leading `*`, `*/` or `//` comment marker from each line. That
normalisation is deliberately generous, so it can only produce **more** matches, which is the safe
direction for a question phrased as "does this reach anything".

**Both halves of that normalisation are load-bearing, and the second was learned the hard way in this
very slice.** A first probe folded whitespace only. Asked whether `emitsOneDivElement`'s docblock
reaches the tarball it answered **no**, because the clause wraps across `*`-prefixed comment lines
and the packed bytes keep the markers. Marker-stripped, the same clause is found in both sourcemaps.
**That is the identical class of mis-specified probe that `#71`'s pass 3 was refuted for**, reproduced
here against a different transformation, which is the argument for never trusting a reach answer that
was not run in both polarities.

### Controls, run in both polarities

- **Positive, declaration carrier.** `src/xml/write.ts`'s module docblock is found in `index.d.ts`
  and `index.d.cts`, so the probe reads the declarations.
- **Positive, sourcemap carrier.** A `//` comment in `src/codec/read.ts` is found in both sourcemaps'
  decoded `sourcesContent`, so the probe reads the maps and not only the plain files.
- **Negative, synthetic.** A string present in no source is found nowhere.
- **Negative, wrong package.** The identical probe, run with this repo's `src/` against the published
  `@cosyte/hl7` tarball, reports **every** probed file as reaching nothing. So a "no hit" verdict is
  produced by the tarball under test rather than by the working tree.

### The failing example, and the trap that sets the direction

- **Failing example.** The module docblock of `src/codec/index.ts` is in **no file of the packed
  tarball**, neither raw nor in a decoded `sourcesContent`. It is a barrel of pure re-exports: the
  bundler elides it, so it contributes no mapped source, and it declares nothing of its own, so the
  DTS rollup emits none of its text. **One example is asserted and no set is named**, because the set
  is a property of a build and this file is exactly where such a set has gone stale before.
- **The trap.** `src/terminology/service.ts` is in **neither** sourcemap and its docblock is in
  **both** `.d.ts` files. A type-only module compiles to no JavaScript, so nothing maps it, while its
  interfaces are precisely what the declarations carry. Anyone deriving reach from the bundles or the
  maps alone will call it unreachable and be wrong in the unsafe direction. This is the same module
  class that refuted `#71`.

### The carrier the phrase-keyed sweep would have missed

`#71` cut the parenthesis from this file and left the identical universal in `CLAUDE.md`, one
sentence over from the warning it was grounding. A sweep **keyed on the enumeration** (tarball,
`sourcesContent`, sourcemap, `.npmignore`, `files[0]`, `npm pack`, "everything in `src/`", "reaches
`dist/`") **with newlines folded first** found it; a sweep keyed on the gate script's wording would
not have. Same lesson as `#70`, found again here rather than cited.

### Considered and deliberately left

- **`emitsOneDivElement`'s docblock referent**, which the item lists beside this one. **Not folded
  in, and the ground is measured rather than assumed.** Its reach is _not_ what the item supposed:
  the docblock is in neither declaration file, but it **is** in the tarball, in both sourcemaps'
  decoded `sourcesContent`. So the two defects do not even share a surface. More decisively, naming
  the right referent means settling which artifact the unbound-prefix residual lands on, which is
  `FHIR-XML-WRITE-RESIDUALS` material and needs `test/xml.test.ts` opened rather than cited. A
  referent correction that has to import another item's verification is a second unit, not this one.
- **The `dist/` bullet's "the dts build copies doc text verbatim"**, immediately below the cut. Left:
  where the DTS rollup carries a docblock at all it carries the text verbatim, which the positive
  control above exercises, and where it carries none the third pass scans **more** than reaches
  `dist/`. That is over-inclusive, which the bullet already declares as the gate's ceiling, and it is
  the safe direction. Widening the slice to reword it would be writing a fresh reach claim inside the
  correction of a reach claim, which is the failure this lineage keeps paying for.

### 🛑 Two gate passes refuted this slice for doing the very thing it was correcting

**Every finding across both passes was `INTRODUCED` by this slice rather than `PRE-EXISTING`.**
Recorded here because the lesson is that writing the rule down is not the same as obeying it, and
this note is where the next reader looks for that.

**Pass 1**, two findings:

- **A fresh universal, written inside the correction of the old universal, in the same paragraph that
  said it named no set.** Draft one added, after the failing example: _"Every `src/**/index.ts` barrel
  here answers the same way, and each answers all-or-nothing across its whole docblock."_ Pass 1
  falsified it under both available readings, with `src/fhirpath/index.ts` on the glob reading and
  `src/quantity/index.ts` on the charitable pure-barrel reading. **Deleted, not narrowed.** Narrowing
  is what produced it.
- **A `files` claim about the slice itself, in three carriers, one of which ships.** Draft one said
  _"nothing this touches is listed in `files`, so none of it reaches an installed copy"_ in the
  changeset (which freezes into a release body), in `CHANGELOG.md`, and here. `CHANGELOG.md` **is** in
  `files`, and pass 1 unpacked a real tarball and found the sentence inside it. Base's own prose has
  this right in both places, so it was a regression, not `PRE-EXISTING`. **The whole clause is
  deleted rather than qualified**, which leaves the slice claiming no reach for itself at all.

**▶ AND THE PROBE HAD A BLIND SPOT THIS NOTE OWES THE NEXT READER.** The method above matches at
**line granularity**, so prose that ships with a `{@link …}` tail rewritten or dropped is invisible to
it. Pass 1's own probe is the one to reuse: drop all non-alphanumerics, then slide a fixed-width
normalised window across the whole docblock. It is strictly more generous, and it is what surfaced
the partial hits the line-granular probe could not see.

**▶ PASS 2 THEN REFUTED THE CONTROL SECTION ITSELF.**
It called `src/xml/write.ts`'s docblock a **transformed** carrier, "text the DTS rollup has rewrapped
and re-emitted". It is not. That docblock is byte-identical in `dist/index.d.ts` and
`dist/index.d.cts`, indentation included, which anyone can check with a substring test in two lines.
So a section headed as controls in both polarities carried no transformed positive at all, inside a
slice whose entire subject is false statements about what a build produces. **The transformation
framing is deleted** and each positive control is now named for the artifact it reads. Two smaller
deletions went with it: a closing line setting a probe standard the wrong-package control had not
been run to, and a count of how many times this lineage has paid for the same failure.

## The `JSON -> XML -> JSON` laundering, closed (2026-08-08, `FHIR-JSON-ONLY-SHAPE-LAUNDERED`)

The last leg of the laundering lineage, and the one the two entries above each declared open at their
own foot. Base was `5ced746`.

**What it was.** The JSON reader marks four positions FHIR JSON gives no meaning to and keeps what
the sender wrote at them, so `serializeResource` hands the text back and a re-read reproduces the
finding: an array inside an array (`nestedArray` + `nestedArraySource`), a scalar or `null` where
FHIR JSON has an object (`nonObjectSource`), that same shape in a primitive's `_`-sibling
(`nonObjectMetaSource`, `nestedArrayMetaSource`), and a `null` in a primitive's value channel that
padded nothing (`undefinedNull`). **XML has none of those channels** -- no array of arrays, no
`_`-sibling (a primitive's metadata is co-located as an `id` attribute and child `<extension>`
elements), and no `null` at all. So `serializeResourceXml` emitted the node the reader was left
holding, an empty element or none, and that output re-reads with an **empty issue list**. Three of
the four also re-read `valid: true`; the array-inside-an-array one emits `<name/>`, which re-reads
`issues: []` and `valid: false`. **Not because it is empty, and not because it repeats**, which is
what a first draft of this sentence said and the gate measured false: `<coding/>` is equally empty
and equally repeating and re-reads `valid: true`, while a `0..1` `<maritalStatus/>` re-reads
`valid: false`. What decides it is the modeled datatype: the element re-reads as a value-absent
primitive where the schema types a complex one, and the validator draws `TYPE_MISMATCH`. The finding
is gone in all four, which is the property that matters here.

The shape of the harm is this lineage's own: **nothing is lost in the ordinary sense**, so the output
cannot be told apart from a document whose sender wrote the conformant thing, and every layer
affirms it.

### The measured extent, at `5ced746`

Hand-authored JSON probes, base vs head, each parsed, written to XML and **re-read**. The middle
column is the document base put on the wire; the right column is what re-reading that document gave.

| in                                                                                            | base emitted                 | re-read                                                             |
| --------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------- |
| `{"valueQuantity":{"value":null,"unit":"mg"}}` (`UNDEFINED_JSON_NULL`)                        | `<value/><unit value="mg"/>` | `issues: []`, back to `{"unit":"mg"}`: a unit with **no magnitude** |
| `{"status":"final","_status":null}` (`UNKNOWN_PROPERTY`)                                      | `<status value="final"/>`    | `issues: []`, the member gone                                       |
| `{"_status":"x"}` (`UNKNOWN_PROPERTY`)                                                        | `<status/>`                  | `issues: []`, the member gone                                       |
| `{"coding":[{"code":"active"},"junk"]}` (`UNKNOWN_PROPERTY`)                                  | `<coding/>` for item 1       | `issues: []`, the item back as `null`                               |
| `{"name":[[{"family":"Roe"}]]}` (`UNKNOWN_PROPERTY`+`NESTED_ARRAY`, `safeToSummarize: false`) | `<name/>`                    | `issues: []`, **`safeToSummarize: true`**                           |
| `{"name":[{"given":[["a"]]}]}` (same pair)                                                    | `<given/>`                   | `issues: []`, `safeToSummarize: true`                               |
| `doseQuantity` three levels down with `"_value":"junk"`                                       | the dose element, clean      | `issues: []`                                                        |

The first row is the harm the value-channel rule exists for, arriving through the other door. The
`name` rows are the sharper ones: a **refusal to summarize turned into an affirmation**.

**Conformant controls, unchanged and silent at base and head:** §2.6.2.3 padding
(`{"given":["a","b"],"_given":[null,{"id":"q"}]}`), a value-absent singleton
(`{"_issued":{"id":"q1"}}`), a primitive `extension`, a precision-critical `valueQuantity`, and every
XML fixture, which still round-trips byte-for-byte.

### Why a refusal, when the two entries above chose a report and a hand-back

Because there is nothing to hand back **into**. Those two closed a channel that exists in the format
being written; here the format has no channel at all, and the three options are exhaustive: emit the
empty element (which is the laundering), invent an XML spelling (which authors markup nobody wrote,
the fabrication class `UNSERIALIZABLE_ELEMENT_NAME` and `UNSERIALIZABLE_DIV_MARKUP` already exist
for), or refuse. It is the same instrument `DROPPED_ELEMENT_TEXT` already is, one format over: that
marker has no encoding in **either** wire format and both writers refuse it; these have one in JSON
and none in XML, so only the XML writer does.

**No round trip that works is withdrawn, and this is mechanical rather than argued.** Every marker is
set by the JSON reader alone. A census over `src/` asserts it (`markUndefinedNull`,
`markNonObjectMeta` and `markNestedArray` are referenced only by `codec/read.ts` and `model/node.ts`;
`nonObjectSource` is assigned only in `codec/read.ts`), which is a stronger statement than the
7-fixture sweep beside it because it does not depend on the corpus. So no document read from XML can
reach the refusal, and no conformant JSON document carries a marker either.
**What that census is, exactly, because pass 1 read it wider than it is:** it is a grep over `src/`
for the marking helpers by name and for a `nonObjectSource:` assignment. A helper renamed, or the
field set by object shorthand, would evade the patterns. It reds when a new file starts setting one
**the way the reader does today**; it is not a proof about every spelling.

### A whole-model pre-pass, deliberately, where the two refusals beside it check at their site

`tag()` and `emitsOneDivElement` are checked **at** the site that writes, because their answer depends
on the writer's branching: which name becomes a tag, which becomes an attribute, which is dropped. A
pre-pass would have to re-derive that and would be free to disagree. **This question does not depend
on the branching at all** -- no branch of the XML writer can express any of these shapes, wherever
the node sits -- so the pre-pass cannot drift, and it reaches three positions a site-local check
would each have to be repeated at: the `div` branch, which returns before the primitive is written;
the `id`/`url`/`resourceType` properties, which are consumed as attributes or skipped and never reach
`writeItem`; and a member a repeated property name shadowed, which the writer's own walk never
visits. The walk is `collectMarked`'s, shared with `droppedText` and `nestedArrays` rather than
copied, so a refusal cannot come to visit a different part of a document than a report of the same
kind does.

**Raised last**, after the name and `div` refusals. A model can trip two, and base's answer must not
move: `{"zz value=\"1\"/><status":1,"issued":null}` keeps `UNSERIALIZABLE_ELEMENT_NAME`, a bad `div`
beside a marker keeps `UNSERIALIZABLE_DIV_MARKUP`, and dropped character data keeps
`DROPPED_ELEMENT_TEXT`. All three orderings are pinned by tests. **No case moved onto the new code**,
because these positions raised no serialize error at all before.

### Declared open, not closed, and pinned so none of it reads as covered

- **An array-wrapped `0..1` element still launders across this boundary.** No node is marked: the
  model holds a genuine list of one, and XML spells a repeating element by repeating it, so one
  occurrence is exactly what comes back. Closing it needs a cardinality decision on the **write**
  path, which is a different change; `array-wrapped-scalar.test.ts` owns it and still pins it.
- **A repeated property name is dropped by BOTH writers**, so there is no hand-back for XML to be
  missing. `DUPLICATE_PROPERTY` and the safety refusal carry it instead. Not this class.
- **A JSON decimal comes back from XML as a string**, because XML carries no JSON type. The lexical
  value survives byte-exact and no magnitude changes, but the `DECIMAL_PRECISION_AT_RISK`
  information-severity finding is not reproduced on the re-read. Pre-existing, and named here only so
  the closure above is not read as covering it.
- **A non-string `resourceType` still launders the same way, and it is the closest residual to this
  closure, so it is named here rather than left to the item.** (True at this slice. **CLOSED
  2026-08-09**, `UNSERIALIZABLE_RESOURCE_TYPE`. The example below is stale in one respect from `#75`
  onward: the array spelling has raised `UNSERIALIZABLE_ARRAY_WRAPPER` since `914c03a`, and it is a
  scalar or object type gate that reached the substitution after that.)
  `{"resourceType":["Observation"],"status":"final"}` reads `valid: false` / `safeToSummarize: false`,
  emits `<Resource xmlns="http://hl7.org/fhir"><status value="final"/></Resource>`, and that document
  re-reads `issues: []` / `valid: true` / `safeToSummarize: true`. Identical harm shape to the `name`
  row above. It is **not** a marked node: the writer substitutes the tag rather than the reader
  marking the position, so closing it is a decision about what the writer does with an unreadable
  `resourceType`, not about a channel XML lacks. `PRE-EXISTING`, reproduces on `5ced746`, and declared
  deferred in the backlog item. Raised by the conformance gate's pass 1.
- The residuals the two entries above declared in their own channel are untouched: an **empty**
  `_`-sibling object or array, a `_`-sibling object's own unreadable member, and
  `MISPLACED_PRIMITIVE_EXTENSION` beside a non-primitive.

### What could not grade this

**The read differential cannot grade this class at all.** It is an XML harness, and every marker here
is set by the JSON reader; its 0-of-1,195 moved readings is by construction, not evidence, and the
harness prints that caveat itself. Its `moved` count is separately blind to refusal identity, which
is declared in four places. No zero of its is quoted as evidence here. **The standing corpus caveat
holds:** the figures above are a hand-authored JSON probe axis plus this repo's JSON fixtures, and
this lineage's XML fixtures are 7 hand-authored files plus mutations. **Neither is the FHIR R4
published-examples corpus**, and nothing here is corpus-wide.

### What the gate moved, and the two claims it refuted

Pass 1 found **no defect in the code** and two `INTRODUCED` majors, both claim width, which is the
shape this lineage keeps paying for.

1. **"`serializeResource` writes all four back BYTE-IDENTICALLY" is false for three of the four
   families**, and it was the sentence justifying the withdrawal, shipped in `README.md`,
   `CHANGELOG.md`, the changeset and the guard's own docblock. The preserved text is **value-exact,
   not byte-exact**, which `FhirComplex.nonObjectSource` already states on the field:
   `{"performer":[{"reference":"Practitioner/1"},"Practitioner\/2"]}` comes back spelling the second
   member `"Practitioner/2"`. Only `undefinedNull` is byte-identical, because a `null` has no
   escaping to lose. **The test beside the claim did not ground it**: its four rows carry no JSON
   escape, so it was green while the sentence was false. The claim is corrected everywhere and a
   failing example is now pinned beside the four rows.
2. **The runtime message promised a route that does not carry one case the refusal deliberately
   reaches.** It ended "serializeResource writes it back, so this refusal never reaches it", and for
   a marker inside a member a repeated property name shadowed that writer **drops** it. The message
   now says only what the refusal does not reach, which is the wording the two refusals beside it
   were narrowed to on 2026-08-07. The location caveat is stated with it: FHIRPath cannot address a
   shadowed member, so the location resolves to the surviving one.

Two minors moved with them: each disjunct of the predicate is now pinned by a hand-built node (the
suite was green with any single clause deleted, because the reader always sets `nestedArray` beside
`nestedArraySource`), and the census claim is scoped to what it greps.

_Provenance: every figure above was produced by running one probe script against a clean `5ced746`
and then against the head tree, not recalled; the spec clauses are `hl7.org/fhir/R4/json.html`
§2.6.2, §2.6.2.1 and §2.6.2.3 for the JSON channels and `xml.html` §2.6.1 for the XML one. The two
corrections above are the conformance gate's pass 1 against `a608731`._

## The array wrapper laundering, closed (2026-08-08)

The residual `#74` ranked first among what it left, and the one that needed a **product call** rather
than a parser fix: closing it meant deciding what a writer does about cardinality.

### The defect, measured against `8a91d29`

FHIR JSON writes a single-valued element as a name/value pair and reserves the array for a repeating
one (json.html §2.6.2.2), so `{"status":["entered-in-error"]}` is a shape the spec does not define.
The safety layer already reported it (`ARRAY_WRAPPED_SCALAR`, error severity) and declined to affirm
`safeToSummarize` over it, because a single-value read finds no string in it at all.

FHIR XML spells a repeat by **repeating the element** (xml.html) and carries no other mark for one.
So a wrapper of fewer than two items emitted at most one element and the complaint had nowhere to go:

| in                                                                | reported             | XML out                              | re-read                                                                                                                                                                                                    |
| ----------------------------------------------------------------- | -------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `{"resourceType":"Observation","status":["entered-in-error"]}`    | `Observation.status` | `<status value="entered-in-error"/>` | `[]`, `valid: true`, `safeToSummarize: true`                                                                                                                                                               |
| `{"resourceType":"Observation","status":[]}`                      | `Observation.status` | element absent                       | `[]`, `valid: true`                                                                                                                                                                                        |
| `{"resourceType":["MedicationStatement"],"status":["not-taken"]}` | both                 | `<Resource>`                         | the type gone, and with it every type-scoped read (at the time, that included this negation; the status-code gates were dropped 2026-08-09, so today the same launder is graded with a `no-known-allergy`) |

The second row is the one worth keeping in view: an **empty** wrapper leaves nothing behind at all.
The third is the sharper half, because a wrapped type gate suppresses every type-scoped negation
behind it, and array-wrapping every element is ordinary generic converter output.

### The cardinality decision, and the alternatives weighed

**A writer cannot decide cardinality in general, and this one does not try.** There is no
per-resource model here and there must not be one (`SAFETY_SCALAR_ELEMENTS` is the cardinality of a
closed set, not a model); a name-only, depth-free rule emits a false error on a conformant document,
because `Questionnaire.code` and `ElementDefinition.code` are `0..*` in R4.

Four routes were on the table:

1. **Refuse every list at a reported location, arity-blind.** Rejected on measurement, not taste: an
   XML document CAN put a list at a reported location by repeating the element, and
   `<status value="a"/><status value="b"/>` round-trips **byte-exact today with the finding read on
   both sides**. Refusing it withdraws a working round trip and buys nothing, which is exactly the
   cost the unbound-prefix residual was deferred rather than pay.
2. **Refuse only what XML cannot spell back as a wrapper.** Taken. Fewer than two items, plus **any**
   wrapper on `resourceType`, where the type is the tag and a tag cannot be repeated. The
   `resourceType` clause is a fact about XML, not about this writer's branching, and it is measured
   at arities 0, 1, 2 and 3.
3. **Report instead of refuse.** Not available: the XML writer returns a string and has no
   diagnostics channel, the same fork `assertXmlSerializable` reached.
4. **Invent an XML spelling for a wrapper.** Rejected: it authors markup the sender never wrote,
   which is the fabrication class two refusals beside it already exist for.

**Where the cardinality comes from is the load-bearing half.** The write path takes it from the one
window that already has one, the locations `arrayWrappedScalars` reports, by narrowing the safety
layer's **own walk** (`unspellableXmlWrappers`) rather than adding a second traversal with its own
element table. A copy would be free to drift from the window this library reports to a caller, and
the read window and the report window must be the same window. It narrows and never widens, so it
can never name a location `arrayWrappedScalars` does not.

`SERIALIZE_ERROR_CODES.UNSERIALIZABLE_ARRAY_WRAPPER`, **raised last** so no case moves onto it.

### Two things the predicate answers that a location-level one would get wrong

- **Per written MEMBER, not per location.** A `Coding` whose `system` is a singleton and whose `code`
  holds two keeps the location reported after the trip, while the `system` wrapper is gone. The
  member that vanishes is the question, so the quantifier is `some`.
- **The two sets de-duplicate independently.** A repeated property name puts two wrappers at one
  location; sharing the de-duplication would hide `{"status":["b","c"],"status":["a"]}`'s singleton
  behind the writable wrapper that arrived first. Pinned in both orders.

### What it does NOT cover, measured rather than implied

- **A writable wrapper only a SHADOWED member carried still launders.**
  `{"status":"final","status":["a","b"]}` reports `Observation.status` and comes back reporting
  nothing. It is not this class: the wrapper is writable, what drops it is the repeated property
  name, and `serializeResource` drops it **identically** (`{"resourceType":"Observation",
"status":"final"}`, `safeToSummarize` `false -> true` on that route too). The repeated name is its
  own declared-open residual.
- **`Observation.value[x]`**, a `0..1` choice, is outside THIS window and always will be: widening
  the safety layer's element table to it means the per-resource model this library does not have.
  Its wrapper no longer launders all the same, on a **second** refusal taking its cardinality from
  the value readout's own walk (`UNSERIALIZABLE_CHOICE_WRAPPER`, 2026-09-22, "Left open
  deliberately, a through e" residual (a)). So the sentence that is still true here is about this
  refusal's window, not about the wrapper's fate.

### The axis of every "0" and every count reported here

- **"0 readings moved of 1,195"** is the XML read differential, over 7 hand-authored XML fixtures
  plus mutations. It **cannot grade this class**: the refusal fires on wrappers of fewer than two
  items, and a single XML element reads as a primitive, not a list. That zero is by construction. The
  harness prints the caveat itself, and `leaf values not compared (head refused to serialize)` is
  `0`, so no document base serialized is refused at head.
- **"732 two- and three-item wrappers, 0 laundered"** and **"60 arity-0/1 wrappers, 60 laundered"**
  are a generated grammar, and the arithmetic is stated in full because the first draft of this line
  did not reconcile: 6 `(resource type, element)` root pairs x 10 item shapes in **each of two array
  positions** x arities 2 and 3 gave 1,200 candidates, of which 732 produced a reported wrapper the
  writer still emits; the same roots x 11 shapes at arities 0 and 1 gave 66 candidates, of which 60
  were emitted, and all 60 laundered. **6 root pairs is not the whole window**, which is scoped to
  `SAFETY_RESOURCE_TYPES` at a resource root. Not a corpus.
- **The 14 `_`-sibling shapes measured 14/14 byte-exact** below is this repo's own probe list.

**None is the FHIR R4 published-examples corpus. Nothing here is corpus-wide.**

### Mutation coverage, both polarities

Ten mutations run against the three suites that own this: dropping the `resourceType` disjunct (2
red), dropping the arity clause (18), widening arity to `< 3` (9), narrowing to `< 1` (13), sharing
the de-duplication set (22), `some -> every` on the `Coding` quantifier (1), raising the refusal
first instead of last (2), removing it entirely (22), the `isList` guard returning `true` (1), and
the predicate made dead (23). Every clause is load-bearing.

### The falsified "byte-identically" claim beside it, graded per carrier

`#74` recorded the `_`-sibling changeset's "byte-identically" as falsified and owed a deletion.
**Re-measured before editing, and it is half right, which is why it was measured:**

- `.changeset/tidy-hounds-gather.md` said "so **the shape** round-trips byte-identically", a
  universal over the shape class, and it is **false**: `{"_status":"Practitioner\/2"}` returns
  `{"_status":"Practitioner/2"}`, `{"_status":"aAb"}` returns `{"_status":"aAb"}`, and even
  insignificant whitespace before the value is lost. The preserved text is re-rendered, not sliced.
  **Deleted, never reworded** (a changeset freezes permanently).
- `CHANGELOG.md` said "so **every shape above** round-trips byte-identically", scoped to its own
  enumeration, and **all 14 enumerated shapes measure byte-exact**. It was true as scoped. It was
  deleted anyway, for a different and stated reason: the same release body carries `#74`'s correction
  ("value-exact, not byte-exact ... only the value-channel `null` family is byte-identical") ninety
  lines above it, and the `_`-sibling channel is one of the families that correction names. Two
  statements that contradict each other in one release body is what a reader acts on.
- `documentation/agent-notes.md`'s two uses are enumerations too, and both measure true. **Left
  alone**: deleting a true claim is its own defect.

`src/xml/index.ts`'s summary was stale on both halves and is corrected. Measured: "emits spec-clean
XML" is false (`<v:x value="1"/>`, `<a&b/>`, `<1abc/>` are all emitted), and "round-tripping
byte-for-byte" is false unqualified (`<div>x</div>` comes back as
`<div xmlns="http://hl7.org/fhir">x</div>`).

**The first attempt at that sweep opened the two carriers a consumer cannot see and left the one it
can**, which is this lineage's own trap reproducing verbatim. `src/index.ts:277` is a `//` comment and
`src/xml/index.ts`'s `@packageDocumentation` does not render either (`grep -c "Zero-dependency and
hardened" dist/index.d.ts` is `0`), while `src/xml/write.ts:2` and `:16` carry the identical two
halves and DO render, at `dist/index.d.ts:4766` and `:4780`. Worse, the corrected
`src/xml/index.ts` ends "read them there rather than from a summary here", pointing the reader
straight into the unswept header. Both are corrected now. **Measure reach; never grep for it.**

_Provenance: every figure above was produced by running probe scripts against a clean `8a91d29` and
then against the head tree, not recalled. Spec clauses: `hl7.org/fhir/R4/json.html` §2.6.2.2 for the
JSON array rule and `xml.html` for XML's repeated-element spelling._

### The gate, pass 1

`a4c...`/`4487063` **`REFUTED`**, two `INTRODUCED` majors and one `INTRODUCED` minor, **and not one
of them a defect in the code** -- the ninth consecutive slice in this repo with that shape. An
independent sweep of 420 element-level and 1,050 `Coding` documents found 0 launderings among the 567
wrappers the guard lets through, and confirmed every arity-0/1 and every `resourceType` wrapper
refused, all 180 refusals landing on documents already `valid: false`.

1. **The "sweep" claim was false**, corrected above: it named `src/index.ts` as the second carrier
   while `src/xml/write.ts` was the one rendering into `dist/index.d.ts`.
2. **A new universal shipped into `dist/index.d.ts`**: _"a wrapper of two or more items elsewhere is
   written as repeated elements and re-reads as a list"_, unscoped. The predicate counts **items**
   while every docblock justifying it reasons about **emitted elements**, and the two part on a
   hand-built `list([list([]), list([])])`, which holds two items and emits none. The laundering is
   `PRE-EXISTING`; the universal asserting it cannot happen was this slice's. **Scoped, not fixed by
   widening the guard**: widening would refuse arity-2 wrappers and withdraw the round trip the arity
   rule exists to protect.
3. **The sweep arithmetic did not reconcile** and the docblock said "six resource types" where the
   window covers seven. Both corrected; the conclusion was unaffected.

Three `PRE-EXISTING` findings are backlog lines, not folded in: the refusal's root segment is
`Resource.*` where the readout says `MedicationStatement.*` (pinned, deliberate, `typeOf` is the
strict read); the repo-wide prose says "the six resource types" over a set of **seven**
(`src/safety/codes.ts`, and it reaches `dist/index.d.ts`); and a single `<resourceType value="…"/>`
child element is dropped by `serializeResourceXml` under `issues: []`, since only the list form is
refused.

### The gate, pass 2, and the sentence the remedy itself got wrong

Pass 2 re-checked pass 1's three findings and confirmed all three remedied, then **`REFUTED` on one
`INTRODUCED` major sitting inside the remedy** -- which is the fail-to-converge signal, and the reason
the answer was **deletion rather than another paragraph**.

**The remedy answered pass 1's closing worry with a false mechanism.** It said the arity gap is
unreachable from the wire because `UNSERIALIZABLE_JSON_ONLY_SHAPE` "refuses first, which is
load-bearing ordering rather than a coincidence", and titled a test after it. **Measured: reversing
the two guard calls leaves every assertion in that test passing.** The ordering is observable only in
WHICH code a model tripping both reports, and that is already pinned by the "raised last" block. What
actually holds the gap shut is that **the JSON reader models a nested array as a marked COMPLEX**, so
`{"status":[["a"],["b"]]}` is `list([complex, complex])` and the item count this refusal reads is 2
under any ordering; the guard beside it refusing **at all** is the other half. A maintainer trusting
the shipped sentence would have preserved an inert line order while the two real protections could be
narrowed silently.

The claim was deleted from `src/xml/write.ts`'s `@throws`, `src/codec/serialize-guard.ts` and the
test's own comment, the test retitled to what it asserts, and the model shape it rests on asserted
directly. Two minors with it: the README said a namespace-less `<div>` "comes back with one inserted"
where the inserted one is the **FHIR** namespace, not the XHTML one a reader would assume; and this
slice's own `PRE-EXISTING`, refuter vocabulary with no referent for a consumer, was rendering into
`dist/index.d.ts`. **One `PRE-EXISTING` occurrence still renders there from base's `emitsOneDivElement`
docblock; that is a backlog line, not this slice's.**

**The standing lesson, and it is the one this repo keeps paying for: the code survived two passes with
no defect found, and both refutations were sentences. The pressure that creates is to write a longer
sentence to survive the gate, and a longer sentence is what produced the false ordering claim. The
shortest correct remedy is fewer words.**

### The gate, pass 3, the cap, and the pattern worth escalating

**`REFUTED`, and the ADR 0016 cap is spent. There is no pass 4.** The refuter's own instruction was
to apply the remedy and ship rather than open another round, because it is a grep-verifiable deletion.

**The finding: the false ordering claim survived in two carriers the pass-2 remedy never opened, and
both reach consumers** -- `CHANGELOG.md` (in `package.json` `files`, so it ships in the tarball) and
`.changeset/quick-melons-refuse.md`, which freezes into the release body. Deleted in both, never
reworded. Neither existed at `8a91d29`, so both were this slice's.

One minor with it, and it is the same shape one level down: **"the JSON reader models a nested array
as a marked COMPLEX" is itself an over-generalization.** Measured: `{"status":[["a"],["b"]]}` is
`list([complex, complex])`, but `{"status":["a",["b"]]}` and `{"_status":[["x"],["y"]]}` are
`list([primitive, primitive])` -- the marker lands on a primitive, and which of the two it is depends
on the spelling. The safety-bearing conclusion is unaffected and is what the prose now says: **every
list the JSON reader constructs holds primitives or complexes, never lists.**

**▶ ESCALATED RATHER THAN ABSORBED: this slice's gate caught the SAME failure three times** -- pass 1
finding 1, pass 2's implied scope, and pass 3 -- always "fixed the site it was reported at, missed the
carriers a consumer sees". Three different carrier classes: `dist/index.d.ts`, then the npm tarball's
`CHANGELOG.md`, then a pending changeset. **A sweep here is not done until it has enumerated the
CARRIERS, not the sentences**, and the carrier list is at least: `src/` doc comments that render,
`README.md`, `CHANGELOG.md`, `.changeset/*`, and `documentation/`. The code itself survived three
passes with **no defect found at any of them**, which is now the tenth consecutive slice in this repo
with that shape, and it is the argument for cutting a slice back rather than hardening it further.

## The shadowed member (2026-08-08)

`FHIR-XML-WRITE-RESIDUALS`, the repeated-property-name residual `#74` and `#75` both declared open.
`SERIALIZE_ERROR_CODES.UNSERIALIZABLE_SHADOWED_PROPERTY`, raised **last** in both writers, as a
whole-model pre-pass.

### The defect, measured against `914c03a`

The reader keeps the member a repeated name shadowed (`FhirComplex.duplicates`), `validateResource`
raises an **error**-severity `DUPLICATE_PROPERTY` over it and `readSafety` refuses to affirm
`safeToSummarize`. **All three are findings about the input.** Each writer walks `properties` only,
so each emitted one member per name, and that output is a different document carrying none of them.

`{"resourceType":"Observation","status":"final","status":"entered-in-error"}` emitted
`{"resourceType":"Observation","status":"final"}` and
`<Observation xmlns="http://hl7.org/fhir"><status value="final"/></Observation>`. Both re-read with
an empty issue list, `valid` `false -> true`, `safeToSummarize` `false -> true`, and
`negations: ["entered-in-error"] -> []`. **The retraction is in neither output.** Which member is
lost depends only on the order the sender wrote them in.

This is `#fhir-duplicate-key-retraction-2026-07-28` arriving one layer later: that slice closed the
**read**, and the write path re-opened the same verdict.

### Refusing rather than handing both back, which is the decision worth keeping

Handing both back is the route the four JSON-only shapes take, and here it is the worse of the two,
**measured**: FHIR JSON requires unique names (json.html §2.6.2), RFC 8259 §4 leaves the winner
undefined, and `JSON.parse` resolves such a name **last-wins** where this library reads
**first-wins**. On the mirror spelling `{"status":"entered-in-error","status":"final"}` the model
holds the retraction and `JSON.parse` returns `"final"` -- so emitting both members hands every other
consumer the member this one calls shadowed. That is the writer authoring a different clinical
answer, the fabrication class the refusals beside it exist for.

FHIR XML _can_ repeat an element, so the format is not the obstacle there. But two repeated elements
re-read as a **list** -- a repeating element the sender never wrote, and a different model from the
ambiguity the document held.

### The window, which is not a second table

`shadowedProperties`: the same call `validateResource` raises its error from and the same one
`readSafety` requires empty. So **a model refused here already reads `valid: false` with
`safeToSummarize: false`** -- the bound every refusal beside it kept, held by construction rather
than by measurement. Nothing that reads clean stops serializing.

**It does NOT follow that the location string matches, and pass 1 refuted the draft that said so.**
The root SEGMENT is derived per call site, not shared. Measured on
`{"status":"final","status":"entered-in-error"}` (no readable `resourceType`): the guard reports
`Resource.status`, `readSafety` reports `$this.status`, and `validateResource` raises **no**
`DUPLICATE_PROPERTY` at all, because it returns before the safety collector when no type is readable.
`valid` is still `false` there, so the bound above survives; the location agreement does not. The
root-segment divergence is `#75`'s declared `Resource.*` vs `MedicationStatement.*` residual and is
**PRE-EXISTING** -- the remedy is the sentence, never growing the guard.

### What it does not cover, and why the bound is the reason

- A repeated name inside a **primitive's `_`-sibling** is not modeled at all (an R4 `Element` is
  `id` and `extension`; `read.js` flags it and carries no shadowed member), so there is nothing to
  refuse.
- A repeated name inside a complex sitting in a **primitive's `extension`** IS modeled and is still
  dropped by both writers: `{"_status":{"extension":[{"url":"u","valueString":"x",
"valueString":"y"}]}}` loses `"y"` on both paths. `shadowedProperties` does not descend a
  primitive's metadata, and that document reads `valid: true` with `safeToSummarize: true` -- so
  refusing it would withdraw a round trip from a model this library reports as clean, the one cost
  none of these refusals pays. **Declared, and pinned by a test in the state that makes it a gap.**

### The axis of every "0"

- **"0 of 1,195 readings moved" / "0 newly throwing"** -- the XML read differential, which **cannot
  grade this class at all**: the XML reader has no `duplicates` mechanism, so no document in that
  corpus carries a shadowed member. That zero is by construction, **not evidence**.
- **"0 of 33 fixtures newly refused"** -- this repo's 26 hand-authored JSON and 7 hand-authored XML
  fixtures, each through both writers.
- **"0 false positives over 2,480 generated documents"** -- a grammar of 8 `(resource type, element)`
  root pairs x 10 value shapes x 3 placements (root, one level down, inside a Bundle entry), with
  and without the repeated name. 2,400 refused on the new code, 18 kept an earlier code (which is
  the raised-last rule measured), 62 emitted, and **no document without a shadowed member reached
  the new code**. A generated grammar, 8 root pairs, **not the whole window**.

**None of these is the FHIR R4 published-examples corpus. Nothing here is corpus-wide.**

### The sweep, and the carriers it opened

The falsified claim was "the writer emits one member per repeated name", plus every restatement of
"dropped by both writers" that `#74` and `#75` wrote as a declared-open residual. Enumerated by
**carrier**, rooted at `/workspace/fhir` rather than by phrase: `src/` doc comments that render
(`codec/write.ts` module + `serializeResource`, `codec/serialize-guard.ts` module + three docblocks +
the code table, `xml/write.ts` `@throws`), `README.md`, `CHANGELOG.md`, `.changeset/*`, `CLAUDE.md`,
`documentation/`, and the tests that pinned the gap. Two pending changesets carried it; per
ADR 0001 the falsified clause was **deleted, never reworded**.

**🛑 AND THE SWEEP STILL MISSED SITES PASS 1 FOUND, THIS FILE AMONG THEM.** `agent-notes.md` was in the
enumerated carrier list and was still swept by PHRASE, so the claim survived twice here -- once in
**§ Deliberate omissions, whose own contract line says it is verbatim from `CLAUDE.md`**, the very
line the same commit corrected, and once inside the section `CLAUDE.md`'s duplicate-property trap
points at. Plus a comment in `test/array-wrapped-scalar.test.ts`, and a `CHANGELOG.md` entry further
down the file. **A relocated copy is a carrier of
the thing it copies**, and correcting the original without it leaves the next agent reading the new
refusal as a regression against a documented deliberate choice.

### Budget

`fhir/CLAUDE.md` ends at 27,990 of 28,000. The trap was funded by relocation only: an enumeration
sitting on the line that says "never a count or an enumeration here", a vendor-quirk sentence stated
twice in one file, an evidence summary whose own sentence says it had already moved to these notes,
and one line of brand narrative. **No trap was deleted**, and the falsified omission was a
correction rather than a saving.

## The untaggable `resourceType` (2026-08-09)

**Narrative relocated** (cap): [the untaggable `resourceType` narrative](#narrative-the-untaggable-resourcetype-2026-08-09-77).
Cursor: a `resourceType` with **no string to name a tag with** was DELETED by the XML writer rather
than refused. Closed by `UNSERIALIZABLE_RESOURCE_TYPE`. Read the file before touching `typeOf` or
either writer's root branch.

## The XML magnitude, read (2026-08-09)

**Narrative relocated** (this file is at its archive cap):
[the XML magnitude narrative](#narrative-the-xml-magnitude-read-2026-08-09-fhir-xml-write-residuals). The cursors, so you need not open it:
_"a JSON decimal returns from XML as a string"_ is a **declared limit**, but **`readQuantity` read
only the JSON shape**, so an XML dose surfaced as the **bare-unit shape** under `issues: []`. Fixed.
**FOUR residuals pinned by `test/xml-quantity-magnitude.test.ts`**, one of them **the narrowed
bare-unit shape itself** (`+5`, `05`, `.5` are outside R4's `decimal` space, still silent). **Do not
write a guarantee where you measured a narrowing** and **a phrase sweep is not a carrier sweep**:
the gate refuted both, and `#p2-p3` above was the fifth carrier a phrase sweep missed.

## The XML boolean, read (2026-08-09): STOP-THE-LINE

**Narrative relocated** (cap): [the XML boolean narrative](#narrative-the-xml-boolean-read-2026-08-09-fhir-xml-boolean-negation-lost).
Cursors: an XML `<doNotPerform value="true"/>` read as **absence**, so a negation vanished across
**our own** round trip under `issues: []`. Fixed at `primitiveBooleans`, the **safety** read, never
the reader. **3 booleans found, 1 changed: widening the CONVENIENCE read RETIRED a
`MUST_SUPPORT_ABSENT`** (`snapshot.ts` reads `undefined` as _inherit_). **ADDITIVITY IS A PROPERTY
OF THE CONSUMERS.**

## The unreadable boolean, reported (2026-08-09): STOP-THE-LINE

**Narrative relocated** (cap): [the unreadable boolean narrative](#narrative-the-unreadable-boolean-reported-2026-08-09-fhir-xml-unreadable-boolean-is-silent).
Cursors: `<doNotPerform value="1"/>` and `="Y"` (**ordinary v2/C-CDA converter output**) read
**identically to `="0"` / `="N"`** under `issues: []` and `safeToSummarize: true`. **🛑 DO NOT WIDEN
`booleanOf` TO ACCEPT THEM**: that authors a value and launders `="0"` to a JS `false` the writer
emits (`#74`). **THE MISSING THING WAS A CHANNEL, NOT A READ**: `unreadableBooleans`, beside
`nestedArrays` / `droppedText`, feeding `safeToSummarize`. **Additivity holds in its strongest form
BECAUSE THE SLICE WIDENS NO READ**: 13 of 33 documents move and `safeToSummarize` `true → false` is
the only field that does (plus `FhirSafetyError.message`, which names the sixth shape). **No
`ValidationIssue` of its own, and the GENERAL reason is FALSE**: the validator is not schema-free, it
just has no built-in `MedicationRequest` schema, and with one supplied it draws `TYPE_MISMATCH` on
the conformant `value="true"` too.

## The negation read, blind by SCOPE (2026-08-09): STOP-THE-LINE

**Narrative relocated** (cap): [the negation read scope narrative](#narrative-the-negation-read-was-blind-by-scope-2026-08-09-stop-the-line).
Cursors: **plain conformant JSON** `{"resourceType":"ServiceRequest","doNotPerform":true}` read
`negations: []` / `safeToSummarize: true` / assert clean, same for `CommunicationRequest` - **both
`?!` modifier elements, neither type in `SAFETY_RESOURCE_TYPES`, so the instruction was NEVER LOOKED
FOR.** **🛑 THE GATE IS DROPPED, NOT WIDENED** - a longer list of remembered types is the same
mechanism. **What licenses that is the DIRECTION, not a census of R4**: this read can only ADD a
negation. **The opposite of `noKnownAllergy`, which stays gated because it asserts something POSITIVE
about a patient.** **THE READ AND ITS REFUSAL ARE NOW ONE FUNCTION AT ONE WINDOW** - widen the read
alone and `value="1"` on a `ServiceRequest` is exactly as invisible as `value="true"` was, the
previous STOP-THE-LINE reproduced by the fix to this one. **Axis 2, folded in: the read was
ROOT-ONLY**, so a `Bundle.entry` `MedicationRequest` affirmed while its unreadable twin at that same
location was reported; the negation now comes from the WALK, the convenience field stays root-scoped
like `status`. **`safeToSummarize` does NOT move for a value that IS read.** **The count was CUT, not
corrected**: "the six safety resource types" over a set of SEVEN, at more tracked sites than the 3
the item named, **3 of them rendered into `dist/index.d.ts` and `dist/index.d.cts`** (0 at head).
**Plus FOUR carriers a site-only fix misses: the live `[Unreleased]` entry, a PENDING CHANGESET, and
the two scope sentences on the EXPORTED `unreadableBooleans` docblock and in `README.md` that the
fix itself falsified - the gate found those two, not the sweep.** Derive the sites, never count them
in prose: this note said "8" and was off by one. Red-at-base **15 of 23**, 8 both-states pins named,
**7 of 7 mutations red**.

## The `not-done` / `not-taken` type gates, dropped after a CENSUS (2026-08-09)

**Narrative relocated** (cap):
[the negation status codes narrative](#narrative-the-not-done--not-taken-type-gates-were-dropped-after-a-census-2026-08-09). Base `f8d7213`,
closing the first residual of the section above. Cursors: **plain conformant JSON**
`{"resourceType":"Procedure","status":"not-done"}` read `negations: []` / `safeToSummarize: true`,
same for `Communication`, `Media` and `MedicationAdministration` - **four conformant R4 types, and
only `Immunization` was gated in.** **🛑 THE PREVIOUS SLICE'S DIRECTION ARGUMENT DOES NOT TRANSFER.**
`doNotPerform` is an ELEMENT no R4 type defines as anything else; `not-done` is a VALUE of `status`,
whose value set R4 defines PER RESOURCE TYPE, so **"which types carry this code" is a real question
and it was answered by CENSUS of the published R4 definitions** (`valuesets.json` +
`profiles-resources.json`, `4.0.1`, sha256s in the note), never by analogy. What the census bought:
the code is spelled **only** on `status`; **every** R4 code system defining it defines it as the
negation; and the list is **five types in R4 and a different set in R5**, so a gate is blind by
construction on a reader with R5 read-tolerance. **Only then** does the direction argument apply.
**`not-taken` is the NARROWER half and is reported as such**: the census returns ONE R4 element, so
the old gate was already complete on conformant documents and only the **non-conformant** one moves
(`MedicationAdministration` + `not-taken`, where R4 spells it `not-done`). **The read is now the one
`isRetracted` already performed for `entered-in-error`** (`statusSpells`), one function, not three.
**🛑 TWO EXISTING TESTS WERE RE-KEYED BECAUSE THE FIX MADE THEM VACUOUS** - they proved the fail-safe
type read with a `not-taken`, which is no longer type-scoped, and now use `no-known-allergy`, which
is. Red-at-base **11 of 22**, 11 both-states pins named, **8 of 8 mutations red - and mutation 8
found a hole**: widening the read off `status` onto `code` red nothing until an assertion was added,
so the element scope was written down and unpinned.

## Every negation reaches every resource root (2026-08-09)

**Narrative relocated** (cap):
[the negation depth narrative](#narrative-every-negation-reaches-every-resource-root-2026-08-09). Base
`3fa61aa`, closing the SECOND residual of the scope section above and the FIRST of the census
section, which were **one gap read from two sides**. Cursor: **plain conformant JSON**, a collection
`Bundle` whose single entry is `{"resourceType":"Observation","status":"entered-in-error"}` read
`negations: []` / `safeToSummarize: true` / assert clean, same for a nested `not-done` `Procedure`, a
`not-taken` `MedicationStatement`, a refuted `AllergyIntolerance`, and each of them in `contained`:
**a retracted record read as data, in the container the standard defines for carrying resources.**
**🛑 WHAT LICENSES READING A NESTED RESOURCE IS THE `?!` RULE, NOT THE DEPTH:** every element moved is
one R4 flags `?!`, and **that obligation attaches to the RESOURCE, not to the position it occupies in
a document.** Do not restate it as "deeper is always safe". **🛑 CHECK THE DIRECTION BEFORE ASSUMING
YOU MUST MOVE BOTH HALVES:** here the four unreadable-value channels **already covered every location
the read moved into**, so nothing needed widening. What was needed was the EVIDENCE, pinned at ONE
nested location from both sides (`<status>not-done</status>` reported and unread;
`<status value="not-done"/>` read). **The reads are byte-identical to the entry-root ones**, called
on more nodes, so no document's _reading_ moves. **🔴 `no-known-allergy` DELIBERATELY DOES NOT MOVE**:
it is read off an element R4 does **not** flag `?!`, and it is **the one negation whose absence is
the cautious answer** (surfacing it can make a caller LESS careful; unsurfaced reads as _unknown_),
so the direction argument argues **against** it. **`retracted` implies `entered-in-error` is on
`negations`, NEVER the other way round.** **🛑 NAME THE SET: a draft shipped "`negations` is the ONLY
field covering the document" into `dist/index.d.ts`, and PASS 1 CUT IT** - the location channels and
`safeToSummarize` were ALREADY document-wide (a FHIRPath location names its resource; a single value
cannot), which is exactly why no refusal needed widening. Red-at-base **21 of 32**, 11 both-states
pins named in the test file, **9 of 9 mutations red**, negative control 32/32 failing against
`@cosyte/hl7`.
`CLAUDE.md` untouched at 28,000/28,000: its existing trap already generalises.

### The `null` / `_`-sibling laundering: the CLAUDE.md cursor, relocated VERBATIM 2026-08-09

Moved out of `CLAUDE.md` under its byte budget to make genuine room for the negation-read-scope trap
(the remedy for a full card is relocation, never deletion). Nothing is changed; the cursor left behind
points here. See also
[`#the-null-laundering-closed-2026-08-07`](#the-null-laundering-closed-2026-08-07) and
[`#the-_-sibling-channel-closed-2026-08-07`](#the-_-sibling-channel-closed-2026-08-07).

- **A `null` IS NOT A LOSS, WHICH IS WHY IT WAS INVISIBLE: READ SILENTLY, THEN DELETED ON EMIT, SO A
  NON-CONFORMANT DOCUMENT CAME BACK CLEAN WITH THE MEMBER GONE.** `{"value":null,"unit":"mg"}` lost
  the magnitude and **KEPT THE UNIT**, under `issues: []` / `valid: true` / `safeToSummarize: true`.
  Closed 2026-08-07 by a **diagnostic plus a hand-back, NEVER a refusal** (`UNDEFINED_JSON_NULL`,
  `isUndefinedNull`, writer hands it back as it **already did one branch over**).
  **THE §2.6.2.3 EXEMPTION HAS TWO CONDITIONS AND A GATE REFUTED A DRAFT CHECKING ONE: (a) INSIDE a
  repeating primitive's value ARRAY** (a singleton is NEVER padding, so `{"value":null,"_value":
{"id":"q1"}}` IS reported) **and (b) an `id` or a NON-EMPTY `extension` in the slot, WHICH MUST
  MATCH `hasMeta` IN `write.ts`** (`"extension":[]` read as metadata but wrote as none, so the read
  affirmed and the writer deleted the member: all three headline shapes came back, past the fix).
  **Do not widen to every `null`** (false-errors on conformant padding). **The complex branch stays
  `UNKNOWN_PROPERTY` from `nonObjectSource`; do not move it onto the new code. The set walked is what
  the READER read, not what FHIR types** (`{"subject":null}` is reported).
  `valid`/`safeToSummarize` are deliberately open and pinned.
  **THE `_`-SIBLING CHANNEL IS THE SAME LAUNDERING, CLOSED 2026-08-07 ON `UNKNOWN_PROPERTY`: NOT a
  new code, NOT this one** (it drew NONE before, so nothing moved between codes). Padding is **PER
  CHANNEL**. **THREE write branches decide it: `emitMeta` (else `{}`), `hasMeta`, AND THE
  `resourceType` HOIST**, which skipped the property outright, so a `hasMeta`-only fix launders past
  itself.
  [`#the-null-laundering-closed-2026-08-07`](#the-null-laundering-closed-2026-08-07) ·
  [`#the-_-sibling-channel-closed-2026-08-07`](#the-_-sibling-channel-closed-2026-08-07)

## The XML profile `min`, read (2026-08-09)

[the XML profile `min` narrative](#narrative-an-xml-sourced-profiles-required-elements-are-enforced-elementdefinitionmin). Cursor: an XML-sourced profile
declared required elements and this library enforced **none**. Fixed at `parseMin`, not the reader.
**🛑 SAFE ONLY BECAUSE `mergeElement` NOW TAKES THE TIGHTER `min`**: it overlaid verbatim, retiring
a `CARDINALITY_MIN`.

## Declared absence, read (2026-08-25)

Cursor: `MISSING-DATA-1`. US Core's Missing Data rule forbids omitting an element whose minimum
cardinality is greater than zero, so a source system with no data for one writes it **present, with
no value**, carrying the R4 DataAbsentReason EXTENSION and a reason code. Measured at `ecba960`: this
package read that into a value-absent primitive, so the element counted as present, no
`CARDINALITY_MIN` fired, and every value reader returned the same `undefined` an element nobody wrote
returns. **"We asked and nobody knows" and "we never sent this" were one answer**, recoverable only
by re-reading the wire document. `SafetyReadout.absenceMarkers` is the read that separates them, one
`{ code, location }` per declared absence, with `unreadableAbsenceMarkers` and
`conflictingAbsenceMarkers` beside it. The predicate and the closed value set live in
`src/safety/absence.ts`; the walk is that module's own, not the safety walk's.

### The four decisions this channel turns on, none of them forced by the code

- **A readable, non-conflicting marker does NOT lower `safeToSummarize`, and it is the only
  location-bearing channel on that readout that does not.** Every other one marks something the codec
  could not read or the layer could not rank; this one marks a declaration the sender made on purpose
  and the caller can now read, so refusing over it would withdraw an affirmation from a **conformant**
  document, the one direction the fail-safe contract forbids. Pinned in both directions, and three
  suites that already asserted `safeToSummarize: true` over a conformant `data-absent-reason` shape
  (`xml-unreadable-boolean`, `negation-unreadable-code-shape`, and the fixture `value-absent.json` in
  the base-versus-head corpus) are the independent evidence that the choice was the compatible one.
- **A conflicting marker appears on `absenceMarkers` AND on `conflictingAbsenceMarkers`.** Dropping
  it from the first would leave the value readable and the declaration invisible, which IS silently
  preferring the value: exactly what the finding exists to stop. Both survive; neither is ranked.
- **Recognition reads `url` across every member a repeated name left; the REASON does not.**
  Recognising a marker is additive, so a fail-safe read there can only add a disclosure. Choosing
  among two written `valueCode`s would rank values the sender left unranked, so **exactly one**
  written `valueCode`, holding a string that is a member of the closed set, is readable, and every
  other shape is disclosed as unreadable.
- **`resourceType` is excluded from the "carries a value" test for a sharper reason than `id`,
  `url`, `extension` and `modifierExtension` are.** Those four are an element's identity or metadata.
  `resourceType` is how FHIR **JSON** names the type where FHIR XML spells it as the tag, so counting
  it as content would make the two wire formats disagree about one instance, which is the property
  the cross-format axis exists to hold.

### What is deliberately NOT a marker, both pinned

- **The same concepts as a `Coding` inside a coded element** (`system` = the DataAbsentReason CODE
  SYSTEM, `code` = `unknown`) is a present, conformant coded VALUE. Reading it as an absent element
  is a different question with a different failure mode and is not answered here.
- **The `Observation.dataAbsentReason` ELEMENT**, an ordinary `CodeableConcept` with its own `obs-6`
  invariant, unchanged: it still fires exactly once beside a `value[x]` and never arrives alongside an
  absence finding. **The element is not the extension.**
- **The two URIs are close enough that one published IG page confuses them.** The US Core Missing
  Data section's non-coded JSON example writes the extension's `url` as the code system URI. That is
  an error on that page; `Extension.url` is fixed by the extension definition, and the canonical is
  the only string matched. Do not implement against the example.

### Declared limits, not closed here

- **The `valueCode` read is single-valued and un-wrapped.** An array-wrapped `valueCode` (ordinary
  generic XML-to-JSON converter output) reads as unreadable and is disclosed rather than read
  through. Reading through the wrapper would need the same wrapper report beside it, and the report
  window and the read window must be the same window: a widening here without one is the defect
  wearing the fix's clothes.
- **The conflict test for a complex element is by member name, not by datatype.** It has no element
  table to consult, so it asks R4's own question (`ele-1`: a value, or children) with the four
  metadata names and `resourceType` subtracted. A vendor element that reused one of those five names
  for content would be read as carrying none.

## Narrative: PHI scan scope (2026-08-05)

Relocated VERBATIM out of `agent-notes.md` on 2026-08-11 when that file reached its budget
(`PHI-SCAN`), nothing dropped. The cursor there points here.

`PHI-SCAN-WALK-ROOT-SCOPE` and `PHI-SCAN-OBSERVED-NOTHING-IS-GLOBAL`.

Two holes in `scripts/phi-scan.ts`, closed together because closing either alone ships a gate that
reads green over what it did not read.

### The scope, re-derived for this package rather than ported

The walk roots were `test/__fixtures__` and `src`, and `--staged` was scoped to the same two
prefixes, so **a tracked file directly under `test/` was reached by neither route**. Measured here:
**101 tracked files** were scanned by neither route, **55 of them under `test/`**. Counted with the
scanner's own key regex over those 55 files: **87** object-literal `family` / `given` sites and
**21** `birthDate` sites, plus **33** more `family` / `given` and **3** `birthDate` spelled as XML
`value` attributes. The roots are `test` and `src` now, on **both** routes; keeping them different is what let the
hole sit unnoticed.

**The exclusion had a stated reason and the reason covered two files, not a directory.** The old
comment said `test/*.ts` is not walked because the PHI-leak suite ships deliberately PHI-shaped
sentinels. True of `test/phi-leak.test.ts` and `test/scripts/phi-scan.test.ts`; not true of the
other 53. Those two are declared by exact path in `SENTINEL_FILES`, subtracted from the **sweeping**
routes only, **announced** when skipped, and still scanned when named on the command line. They are
not `--allow-fixture`: that needs a flag, CI passes none, so a command-line-only bypass would leave
them unscanned in the one route that matters.

**Nothing was ported.** Sibling residuals were checked and refuted against this tree: `ncpdp`'s 115
test-directory files is **55** here, and `terminology`'s exit **1** on a regular-file walk root is
exit **2** here. Both of the "pre-existing minors" carried over from siblings were measured
**already closed** here before this change: `loadAllowList()` throwing exits **2** (it sits inside
`main`'s handler), and an unmerged `U` entry is in the `--diff-filter=AMTU` list and refused with
**2**.

### Enumerating the files buys the SSN / email floor and nothing else

This is the half that a scope widening on its own silently omits. The structured scanner assumes
**the file is the document** and is reached only for a fixture with a FHIR wire-format extension. A
test builds its resources as TypeScript object literals, so a real surname typed as `family: "…"`
inside a `.ts` file was read by nothing: a dashed SSN and an email are neither a name, a date of
birth nor a street address. Measured on `.ts` carrying
`{ resourceType: "Patient", name: [{ family: "…", given: ["…"] }] }`: exit 0, `OK, no hits`, **both**
before the widening (never enumerated) **and** after it with the recogniser absent (enumerated,
unread).

So `family`, `given`, `birthDate`, `deceasedDateTime` and `line` are keyed in source and dispatched
to the same detectors the structured scanner uses, **in addition to** the shape pass, never instead
of it. **Do not key `text`, `identifier.value` or `telecom.value` there.** `HumanName.text` and
`Address.text` are PHI but a flat pass cannot tell them from `CodeableConcept.text` or an assertion
message; bare `value` is FHIR's most overloaded name (`Quantity.value`, `Extension.value[x]`, every
primitive) and the XML scanner only dares read it inside a `<telecom>` / `<identifier>` block, a
boundary TypeScript source does not have. A gate that false-errors on conformant test code is a gate
someone switches off.

**IN BOTH WIRE FORMATS, AND "FORMATS" IS NOT "SPELLINGS".** This package reads JSON and XML and its
tests write both, so the same `xmlValues` extractor the fixture scanner uses runs over source too;
keying only the object literal left 33 `family` / `given` and 3 `birthDate` XML `value` attributes
unread in the 55 files the widening admitted, and the standing trap ("compare the same document
spelled the other way") is the one that catches that. But the XML arm covers **one of the three ways
this suite spells an XML value**: the double-quoted attribute. A single-quoted attribute
(`value='…'`) and XML **element text** (`<given>…</given>`) are unread, measured at exit 0. The
element-text case has a live site, and it is in `dropped-element-text.test.ts`, the suite whose whole
purpose is element text: on the pre-rename line the `value=`-attribute half reported and the
element-text half did not, so **the scanner forced only half of that rename** and the other half was
done by hand. Declared in `phi-scan-overrides.md` rather than guarded.

Escapes are decoded to a **bounded fixed point (three rounds)**, because this suite routinely writes
a JSON document inside a TypeScript string, so such a value carries two layers of escaping and one
decode leaves a backslash-u sequence whose only surviving name token is `Ro`, which nobody wrote. A
fourth layer is not decoded, and that fails toward reporting: the residue still tokenizes and still
has to clear the allow-list.

Entity references are blanked to a space before tokenizing, which is what stops entity NAMES (`amp`,
`xxe`, `secret`) being reported as person names. Blanking can only split a token apart, never join
two, but **splitting is not the failure there, deletion is**: any letter run between an `&` and a
`;` goes with it, so `Smith&Rodriguez;Jones` reports `Smith` and `Jones` and loses `Rodriguez`.
State that residual as the run, not as "a name spelled entirely as character references".

The widened scan surfaced one false positive and it is this package's own diagnostic form: the email
recogniser cannot tell `UNKNOWN_PROPERTY@Patient.name` from an address, because both are one `@`
between two dotted tokens and `.name` is a real top-level domain.

**THE FIRST REMEDY FOR IT WAS A WIDENING THAT WAS "INSTEAD OF" RATHER THAN "IN ADDITION TO", AND IT
MADE THE GATE DETECT LESS THAN THE ONE IT REPLACED.** This is the single most important thing in the
slice, and it happened in the same change that quotes the rule. A shape exclusion keyed on an
all-caps underscore-joined local part plus a capitalised first domain label, scoped **in intent** to
source files, in fact reached any fixture whose extension is not `.json` / `.xml` / `.ndjson`,
because `scanTarget` routes those down the SAME branch as source. Measured: a fixture carrying
`JOHN_SMITH@Mercy.org` was exit 1 on base and exit 0 with the exclusion. **A PHI gate that detects
less than its predecessor is worse than the defect it was closing.** The refuter found it; the local
suite was green.

It is **reverted**, and the residual it carried is gone with it: that address now reports. One
`EMAILDOMAIN` line covers the live occurrence with a blast radius of one domain. **The enumeration
that stood here (four domains, three sentinel-only, exactly one live) was true of the corpus THIS
slice scanned and is no longer true of the corpus; it is superseded by the re-measurement in
[the PHI scan union narrative](#narrative-the-bytes-git-carries-as-a-union-with-the-walk-2026-08-11) and in `phi-scan-overrides.md`, not softened.** **Declare a domain, never a shape rule.**

### Existence is not observation

`walk` returned silently when its root did not exist and yielded nothing when the root was an empty
directory, so an **emptied or deleted** `test/__fixtures__` printed `OK, no hits` and exited **0**
over a corpus still wholly present in the index (measured, both cases).

**A denominator does not detect this and shipping one as the remedy was refuted elsewhere**: a count
counts the roots that DID exist, so the surviving root supplies a healthy-looking number.

Two arms, and they cover different failures. The sharp one **reconciles against the index**: every
path `git ls-files -- test src` names, minus the markdown the walk exempts, must have been opened by
the sweep or the scan refuses with **2** and names every offender. The blunt one is the floor
underneath it: **a sweep that opened zero files refuses whatever the index said**, which covers a
copy of this tree with no repository of its own. **State what that arm covers, which is the
zero-files case and not the general one**: with no usable index and only SOME roots emptied, the
surviving root still yields targets, the arm does not fire, and that state is reported clean. It is
a declared residual, not a covered case. **`git rev-parse --is-inside-work-tree` cannot be
the test, because it answers for the ENCLOSING repository** and returns `true` for a nested copy
whose files git has never heard of; the pathspec is scoped to the scan roots for the same reason, so
a nested copy yields `null` and the walk rather than a list belonging to the wrong tree.

The reconciliation also refuses over a tracked file deleted from the working tree. It cannot tell
that from a vanished root, and refusing is the safe direction of the two.

### What this closed, and what it left open

Three characterization tests went **red on the spot** and were rewritten to the new behaviour, which
is that mechanism working: the observed-nothing gap, the scan-root's-**parent**-as-a-link gap (now
refused on both routes, by different mechanisms), and three quarters of the regular-blob-at-the-
fixture-root gap. **Still open, pinned:** at exactly `test/__fixtures__`, `identifier.value` and
`telecom.value` are read by nothing, because `isFixture` tests a trailing slash and the remaining fix
belongs to `scanTarget`'s dispatch. Full residual list, and the reviewed allow-list additions the
widening forced, are in `phi-scan-overrides.md`.

## Narrative: The bytes git carries, as a union with the walk (2026-08-11)

`PHI-SCAN`. **A walk reads the WORKING TREE, and that is not what a commit contains.**

Relocated out of `agent-notes.md`, which is at its own budget. The cursor there points here.

### The premise this slice was dispatched on was wrong, and the measurement is the finding

The coordinator's survey scored this copy at **2 `ls-files` + 1 `reconcile`**, "the thinnest
reconciliation of the eight remaining copies". Re-measured in-repo: the two `ls-files` occurrences
are one comment and one call, and the word `reconcile` appears only in prose: the mechanism is
named `trackedInScope` / `refuseUnobserved`. **A text census scores the vocabulary, not the
mechanism.** Measured against the four escape shapes a sibling reproduced at `exit 0`, this copy was
one of the STRONGEST, not the thinnest:

| shape                                                        | base result                                                                |
| ------------------------------------------------------------ | -------------------------------------------------------------------------- |
| a tracked path occupied by a **directory** of decoys         | **exit 2**, already closed                                                 |
| a whole walk root swapped for a decoy directory              | **exit 2**, already closed                                                 |
| **most** tracked files absent from the working tree          | **exit 2**, already closed (no floor-of-one to fool)                       |
| a **gitlink** under a walk root whose working tree is absent | **exit 2**, already closed                                                 |
| a path under the walk's skip rule (`.md`) at any depth       | **exit 0**, the exemption, applied symmetrically to both routes, by design |
| `--staged` over an **unmerged** path                         | **exit 2**, already closed, keyed on status `U`                            |

**The unmerged axis, which broke a sibling's draft, was already closed here** and needed no port.
**Reproducing a state space and reporting "already closed" is the result**; the temptation is to
credit a route with a state it did not close.

### The two states that WERE open, both measured

1. **A fixture `git add`ed and then scrubbed in the working tree scanned clean at `exit 0`**, while
   `git commit` would have committed the staged blob. The sweep only ever read the working tree.
2. **33 tracked non-markdown files sit outside `test/` and `src/` altogether**: `scripts/`,
   `.github/`, `docs-content/`, `.changeset/`, the root manifests. Neither the walk nor
   `refuseUnobserved` mentioned them, because that reconciliation's pathspec is limited to the walk
   roots. **Two of the 33 carried bytes this scanner's own recognisers report.** Real unscanned
   corpus, and this is the `astm` shape rather than the `ccda` one.

### The remedy, and the two things it is not

`all` mode enumerates **both** routes. **Union, never replacement:** the walk alone sees
**untracked** working-tree content; the index alone sees what is **staged** and what lives **outside
the roots**. **WALK_ROOTS did not move**, and no refusal was retired: the floor-of-one stays keyed
on the walk, because the state it names is "no repository to ask and nothing on disk either", and an
index route that happened to find blobs would make it unreachable in exactly the case it exists for.

**Dedup is by CONTENT under git's `blob <len>\0` framing, never by path.** Measured on a clean
checkout at the commit that closed this: **202** in-scope index entries, **167** already scanned by
the walk, **35 fetched**, so a clean checkout SCANS nothing twice. Convert one tracked file's working
copy to CRLF and the fetch count goes **35 to 36**, both copies scanned. **That is the EOL axis**,
and a path-keyed dedup would have picked one of the two byte streams and called it the corpus.
**THESE NUMBERS MOVED ONCE ALREADY, INSIDE THIS SLICE, AND THAT IS WHY THEY ARE SPELLED OUT.** The
first draft measured 169 scanned and 33 fetched; excluding declared paths from the observed set
(below) drops two files out of "scanned" and adds their blobs to "fetched", and the corrected slice
left the old pair standing in four carriers until a gate caught it. **Re-derive, never copy.** Note
also that `cat-file` IS invoked on a clean checkout, for the out-of-root blobs; the property is that
nothing is scanned twice, not that git is never asked. The object-id algorithm is **asked
for** (`git rev-parse --show-object-format`), never assumed: a SHA-256 repository would match nothing
and quietly scan everything twice.

**THE KEY IS THE OBJECT ID _AND_ THE DETECTOR, AND THE FIRST DRAFT SHIPPED WITHOUT THE SECOND HALF.**
A gate found two states against an oid-only key, **both at exit 0**, and both are worth carrying:

- **The detector is a property of the PATH, not of the bytes.** `scanTarget` sends a fixture to the
  structured FHIR scan and a `.ts` file to the source pass, and the source pass deliberately does not
  key `identifier.value` or `telecom.value`. One payload committed at `test/__fixtures__/leak.json`
  and at `src/decoy.ts` was "observed" at the weaker path, so the fixture blob carrying an
  SSN-shaped `identifier.value` was never fetched. **An oid-only key silently applies the WEAKEST
  detector any path holding those bytes gets.**
- **An exempt path's bytes were never scanned at all.** A `SENTINEL_FILES` entry is walked but
  dropped before any detector runs, and it is exempt precisely BECAUSE it carries
  realistic-PHI-shaped strings. Hashing it into the observed set let it vouch for an identical copy
  at a path with no exemption, and **that one is not even convergent** -- a sentinel is never fixed.

So the observed set holds `<oid>\0<detector>` for the files that were actually SCANNED, `scanKindOf`
is the ONE dispatch table (`scanTarget` reads it too, so the key cannot drift from what runs), and a
declared path contributes nothing. It is still ENUMERATED by both routes and dropped by `main`, so
the exemption is still announced -- **deduped**, since a declared path can now arrive twice.

**The lesson generalises past this scanner: a dedup is only as sound as its notion of "already
done", and "already read" is not "already scanned".**

**The unmerged case keys on the ABSENCE OF STAGE 0, and that is not how `--staged` spots one.**
`git diff --cached --raw` gives status `U` and destination mode `000000`; **`git ls-files -s` gives
stages 1/2/3 with ORDINARY blob modes and no `U` anywhere**, so a reader that takes the first record
gets **the merge base** and reports on it as what git carries. Every stage is read and labelled with
its own number. Pinned by a case whose payload lives **only in stage 3**, and by a second whose
payload lives only in stage 1 and must be labelled as such.

**A mode the index carries that is not a regular blob refuses the scan (exit 2), across the
NON-MARKDOWN index.** That is the half covering a link or a gitlink **outside** the walk roots,
which no route reached before (measured, exit 0 on base for both).

**IT SAID "REPO-WIDE", AND A GATE FALSIFIED THAT IN THE EXACT WAY THE SCANNER'S OWN BANNER FORBIDS**
("an entry a route never lists is not reached by the refusal either -- do not restate this as *every*
non-regular entry"). The `.md` filter runs **before** the mode check, so a gitlink at
`vendor/sub.md` or a link at `docs-content/NOTES.md` pointing outside the repository is **exit 0**,
while the same entry without the suffix is **exit 2**. **The walk refuses by MODE regardless of
name** -- "a link's name is no evidence at all about what is on the other side" -- so the two routes
really do differ. Left as it is and **declared**: matching them changes what the gate REFUSES over,
not what it scans, and it is a sub-case of the `.md` exemption below reached by mode instead of by
content. **That is one more claim-defect-in-a-prose-carrier in this lineage, and the code was right
again.** No ordinal is written down: an ordinal is a count, this class's own rule forbids one, and
the pass that found this finding also found four more.

### The two hits the wider corpus produced, and why neither was answered with a rule

- `hello@cosyte.com` in `package.json` → **`EMAILDOMAIN cosyte.com`**. Not a reserved domain: it is
  ours, which is the reason it is declarable, and the blast radius is one domain.
- `JOHN_SMITH@Mercy.org` in this scanner's own docblock → **`scripts/phi-scan.ts` declared in
  `SENTINEL_FILES`**, by literal path, logged in `phi-scan-overrides.md`. **The token-level remedy
  was measured worse:** an allow-list entry is global and route-blind, so `EMAILDOMAIN mercy.org`
  would admit a plausible real hospital domain in a fixture. **Exclude a literal path; never infer a
  class.** The file sits outside every walk root, so no route opened it before: a newly _declared_
  blind spot, not a newly _created_ one. Its cost: a change to that file is reviewed by a human and
  not by the gate it implements.

### The positive control, which is the part worth copying

A gate never seen red is indistinguishable from one that cannot go red. So the control is built from
**this repository's own tracked path list**: same paths, same directory shapes, same extensions,
same in-root / outside-root split, with placeholder bytes so no fixture is copied anywhere. It
asserts the mirror **clears** (so a hit is the payload and not the shape), then plants a payload
across **every** non-exempt path and asserts **every one of them is named**, with the markdown and
sentinel paths payload-bearing and silent. **The payload is made unique per path on purpose**: one
payload written to every path is ONE blob under content-keying, scanned once, and the case would then
assert nothing about the rest. A third arm plants the payload only in an **index blob** at a path
outside every walk root and scrubs the working copy, so only the new route can find it.

The mirror sets `core.hooksPath` to a path that does not exist. It reproduces every tracked path,
`.npmrc` among them, and a developer machine or CI image may carry a global pre-commit hook with an
opinion about such a filename, which is an opinion about the environment, not about this scanner.

### The control reads its answer through a PIPE, so it sweeps in BOUNDED BATCHES

**THE REPORT IS A SECOND VARIABLE, AND IT ONCE ANSWERED FOR THE SWEEP.** `process.exit()` discards
writes still pending on a pipe, and stderr is a pipe, so a report large enough to outrun its reader
loses its **tail** -- and a missing tail is the same string, to a case asking "is this path named",
as a sweep that stopped early. Measured: with the payload at every non-exempt path at once the report
runs to tens of kilobytes, and this control came back **129 of 199 paths named on the Node 24 CI
runner while the Node 22 runner at the same commit, and every local run, were green**. The shape read
as "the walk stopped partway through `src/`". The walk had not stopped. The write had.

So the control sweeps the corpus in **bounded batches**. One run plants the payload at a bounded
number of non-exempt paths, plus **every** exempt path -- those cost the report nothing, and carrying
them in every run is what keeps "silent" meaning "silent _while_ the scanner is reporting" -- and the
batches cover the whole non-exempt set. **Nothing is sampled and nothing left the expected set.** A
**per-run ceiling on the report's byte length is asserted**, so the bound is enforced and not merely
intended: widen the payload or the per-hit output far enough and the case reds instead of going
flaky again. The ceiling is one page, the smallest buffer Linux hands a pipe under memory pressure.

**THE MARGIN IS THINNER THAN THAT CEILING MAKES IT LOOK, AND A GATE CORRECTED A DRAFT WHICH SAID THE
WIDEST BATCH WAS "WELL UNDER HALF" OF IT.** It is 2,065 bytes against 4,096, which is just **over**
half, and what makes a batch the widest is **composition, not width**: an `.ndjson` fixture reports
several times what a `.json` one does, so eight of them in one batch would compute near the ceiling.
The direction is a red rather than a false green, and the fix when it fires is to **lower the batch
width, never to raise the ceiling**. Two things one run no longer exercises, stated here so they are
not discovered as a surprise: the whole corpus through a single `report()`, and through a single
`git cat-file --batch`. There is no cap on hits reported today; if one is ever added, this case is
not what catches it.

⚖️ **DO NOT READ ANY OF THIS AS "`spawnSync` CANNOT SEE THE TRUNCATION" OR AS "A CONTROL BUILT ON IT
WOULD BE VACUOUS". BOTH ARE FALSE, AND A DRAFT OF THIS FILE ASSERTED THEM.** This control runs on
`spawnSync` (`runIn`) and it is precisely what caught the defect. What such a reader sees under the
race is **non-deterministic**, which is a reason to bound the report here and no reason at all to
weaken the control or to reach for a different spawn.

🛑 **THE TRUNCATION ITSELF IS NOT FIXED HERE, AND `process.exit(exitCode)` STAYS.** So `pnpm
phi-scan` read by a consumer that does not drain can still print a **prefix** of its own findings:
that is an open gap of the shipped gate, not only of this control. **The exit code is unaffected**
(hits 1, refusal 2), so it blocks either way and no false green follows from it. Assigning
`process.exitCode` instead does fix the report, measured (445 of 2,000 hit lines to 2,000 of 2,000 --
a **single sample of a racy quantity**; another run of the same corpus survived 379 of 2,000, and
neither number is a constant), but it also drops the `EPIPE` swallowing `process.exit()` was doing
for free: with a consumer that
closes stdout early (`pnpm phi-scan | head -1`) a **clean** run then exits **1**, which is this
gate's code for HITS FOUND, and prints a stack trace where the report belongs -- measured 5 of 5,
plain `node` and through `tsx`. The assignment **and** a `process.stdout.on("error", ...)` guard are
one pair, filed as their own item with their own gate passes. **Do not reintroduce half of it here.**

**Two measured corrections for whoever takes that item.** The pin written for it -- reverted out of
this tree with the rest of that change, so do not go looking for it here -- spawned the scanner with
a reader that stays PAUSED until the pipe has filled, and red at 9,776 bytes of a 130,000-byte report
with `process.exit` in place. Its draft justified calling `pause()` a second time, after the `data`
listener is attached, by claiming that without it the case drains from the start and passes over the
defect it exists to catch: **that is false, falsified 3 of 3** -- with the second call deleted the
mutation still reds at the identical 9,776 bytes. The second `pause()` is determinism hardening, not
what makes the case able to fail. And the fix arrived at the FOURTH pass of a four-pass cap, so its
own regression had no pass left to grade a repair. **That shape, not the defect, is why this branch
was cut back.**

### Declared, not closed

The `.md` exemption still hides a payload at any depth, on **both** routes, and that is the design
("docs may legitimately describe violator values"). Dropping the exemption would red the gate on the
files that explain it.

**NO PREDICATE IS STATED ABOUT WHAT THE EXEMPT FILES CONTAIN, AND THAT IS THE THIRD SHAPE OF THE SAME
MISTAKE, ALL THREE MADE IN THIS ONE SLICE.** A draft quoted a **count**; its replacement named the
**files**; the third tried a class-membership **predicate** -- "every tracked markdown file that
carries a violator string is documentation ABOUT this scanner" -- and a gate falsified that in the
one command it offered as proof. `pnpm exec tsx scripts/phi-scan.ts $(git ls-files '*.md')` names
`documentation/agent-notes.md`, whose hit is `MIXED_XML_SPELLING@Patient.text.div`: an **XML-reader
diagnostic form** that merely parses as an email, in a note about something else entirely. **A
count, a list and a predicate all move with the commit that states them.** Run the command; it is
the ground truth precisely because it is a command and not a sentence, and some of what it names is
not a violator at all.

The two earlier shapes, kept because the sequence is the lesson: a draft quoted "46 tracked markdown
files, 3 carrying violator strings" -- the BASE measurement,
already false at the commit that shipped it, because the slice adds markdown files of its own. Its
replacement named the files instead and was short by one within the same slice, for the same reason.
A count or a list that moves with the commit stating it is a claim nobody can keep true; the
predicate is stable, checkable in one command, and does not go stale.

Identical bytes at two in-scope paths **that dispatch to the same detector**, **exactly one of them
read by the WALK**, are one object, so a payload in both is reported at whichever the sweep read
first. The exit code is unaffected, and fixing the reported copy leaves the other object unobserved,
so the next run names it, which is pinned. **The FOUR qualifiers are the whole sentence**: drop any
one of them and this is the claim a gate falsified, above.

**THIS SENTENCE SAID "THREE QUALIFIERS", A GATE ADDED A FOURTH, AND THE NEXT PASS FALSIFIED THE
FOURTH.** The first repair said "at least one read by the walk" and that is still false: `scanned` is
consulted **only** by `indexTargets`, so the dedup happens once, at the SEAM between the two routes,
and nowhere within either. All three cases measured with one dashed SSN at two paths:

| the two copies | reported |
| --- | --- |
| walk x walk (`test/aa.ts`, `src/bb.ts`) | **both** |
| index x index (`docs-content/b.ts`, `docs-content/c.ts`) | **both** |
| walk x index | **one** |

So it is **exactly** one, not at least one. **The lesson is the one this slice keeps re-learning: a
narrowing sentence is a claim, a claim falsified once is not thereby correct, and the repair needs
the same measurement the original needed.** Note the supporting paragraph of the first repair was
itself true and carried the fact that falsified its own qualifier.

**Untracked content outside the walk roots remains invisible to both routes.** The index cannot see
it because it is untracked, and the walk cannot because it is outside the roots. Unchanged by this
slice, and stated because the union closes the tracked half of that sentence and not the other.

**`all` MODE IS NOW REPO-WIDE (LESS THE MARKDOWN EXEMPTION) AND `--staged` IS NOT, SO THE TWO
ROUTES DISAGREE BY 33 TRACKED
FILES.** Measured: a staged `docs-content/leak.json` carrying a dashed SSN is exit 0 on the hook and
exit 1 in CI (on base both were 0). The direction is the safe one, CI stricter than the hook, and it
is the inverse of the shape that comment was written about, which was CI blind where the hook
reported. **But do not read that as agreeing with the comment**, which carries a second argument
that is direction-blind: "keeping the two routes on different scopes would mean the hook and CI
disagree about what the corpus is, which is the state that let the hole sit unnoticed". By that
argument this divergence is a real cost, and it is being ACCEPTED rather than argued away.
**It is left open deliberately**: widening `--staged` is a HOOK decision
that changes what a commit is BLOCKED on, declined three times across this suite with the cost
measured, and taking it as a side effect of a scan widening is exactly how it would arrive ungraded.

## Narrative: The `Coding` wrapper report moves to the negation read's own window

`FHIR-NEGATION-READ-SCOPE-RESIDUALS`, 2026-08-10. Base commit `5c575e5`. `conformance-refuter`
**REFUTED -> NOT REFUTED**, 2 passes.

**Provenance.** FHIR R4 `datatypes.html` (`Coding.system` and `Coding.code`, both `0..1` on the
`Coding` datatype) and `json.html` §2.6.2.2 (an array spells a repeating element and nothing else).
A profile may only constrain, never relax, so no profiled instance widens either cardinality. Both
were read, not recalled; nothing here rests on a claim about which resource types carry the element.

Closes the `Coding`-level half of the array-wrapper residual, filed by the depth slice's gate as
"the `Coding`-level twin of the same residual" and re-filed by the two slices after it. The
**element-level** half stays open on purpose; its reason is at the bottom.

### What was wrong, on plain conformant-shaped JSON

At `5c575e5`:

| document | at base |
|---|---|
| `{"resourceType":"ServiceRequest","verificationStatus":{"coding":[{"code":["refuted"]}]}}` | `negations: ["refuted"]`, `arrayWrappedScalars: []`, `safeToSummarize: true`, `valid: true` |
| `{"…","verificationStatus":{"coding":[{"code":["entered-in-error","x"]}]}}` | `negations: []`, `arrayWrappedScalars: []`, `safeToSummarize: true`, `valid: true` |

The first resolved a clinical code **through** a shape FHIR JSON does not define and handed it back
with no diagnostic anywhere. The second is the sharper one and runs the other way: a multi-position
wrapper is deliberately **left unread**, because `system` and `code` feed a cross-product and taking
more than one value on either side pairs values the sender wrote in different positions and asserts
a coding it never wrote -- one of which is a recorded "no known allergy", a *positive* clinical
assertion. So the retraction was **neither surfaced nor reported**, and the readout affirmed over a
value the library knowingly declined to read. Both held at every resource root, inside `contained`
and a `Bundle.entry`, and at an entry root carrying no readable type.

### 🛑 The read had escaped the report, and the module said the opposite about itself

The negation reads were dropped out of `SAFETY_RESOURCE_TYPES` (a gate that never looks reports
nothing, indistinguishably from a clean read). `checkCodingWrapping` was not: it ran only under
`clinical && isSafetyType`. So the un-gated read used `safetyCodingsOf`'s unwrap at roots the report
did not cover -- **exactly what `safetyCodingsOf`'s own JSDoc said must never happen** ("A read that
unwrapped outside that window would resolve a clinical code out of an encoding FHIR JSON does not
define and hand it to a caller with no diagnostic anywhere"), and what `CLAUDE.md`'s standing trap
says ("if you ever widen the coding unwrap, widen `checkCodingWrapping` first, **in the same
change**"). The widening happened in a later slice and the report did not follow.

### 🛑 The licence is DATATYPE cardinality, and it is the fourth distinct one in this arc

The three predecessors used **direction** (a read that can only add), an **R4 census** (which types
carry a status code), and the **`?!` modifier rule** (the obligation attaches to the resource, not
the position). **None of them licenses this one.** What does:

> `Coding` is a **datatype**. Its `system` and `code` are `0..1` *wherever a `Coding` appears*
> (datatypes.html). So an array at either is non-conformant whatever resource carries it and
> whatever the enclosing element's own cardinality is. No question about the enclosing resource
> arises, so no per-resource model is needed.

That is precisely what is **not** true one level up, where R4 defines repeating elements under the
same names (`Questionnaire.code`, `ElementDefinition.code`, both `0..*`). The element-level table
therefore keeps its type scoping, and the two halves are now stated as the **pair** they are rather
than blurred into one window -- the blurring is what let the gap survive three slices.

### The shape of the fix

- The read table (`NEGATION_CODE_READS`) gains a `codings` flag, beside `values` and `unread`. The
  report is decided **in the same loop over the same table**, so read scope and report scope cannot
  drift into covering different elements. `verificationStatus` carries it; `status` does not, its
  read being a primitive one.
- The de-duplicating `report` callback moved from inside `checkArrayWrapping` up to
  `checkResourceRoot`, and both halves share it. A safety type's `verificationStatus` is covered by
  **both** windows, and a location a caller can act on once must arrive once.
- **Nothing in the read moved.** Not one value reads differently; the diff is a report and prose.

### Measurement

- **11 of 25 new cases red at base**, in a real detached base worktree at `5c575e5`; 25/25 at head.
- **One further case is red at base only because the base table has no `codings` field** (the
  vacuity assertion over the derived element lists). Reported separately, **not counted** as
  behaviour. Every other assertion is written through fields the base commit has
  (`arrayWrappedScalars`, `safeToSummarize`, `valid`, the issue list, the XML write refusal), so it
  measures a behaviour rather than the presence of a symbol. **This slice exports no new symbol.**
- **12 both-states pins, named in the test file**, not counted in a total: the exactly-once
  de-duplication on `Condition`; a conformant document; `Questionnaire.code`; the `clinicalStatus`
  surviving gap in **both** directions (read through, and declined); a SNOMED "no known allergy"
  `code` on an off-table type; a `Coding` wrapper at a `code`-typed `status`; a `verificationStatus`
  below a resource root; the derived `status` row; and the three element-level residuals
  (`ServiceRequest.doNotPerform`, `Procedure.status`, an array-wrapped `verificationStatus` element).
- **Nine mutations, none surviving, named rather than totalled:** drop the `codings` flag; invert the
  flag test; re-gate the new report on resource type; give the negation half its own de-duplication
  sets; report only single-position wrappers; report only multi-position ones; drop the
  XML-unwritable half; read only the first written member; run the report for every table row
  regardless of the flag.
- Suite **72 files / 1,553 tests → 73 / 1,578**, exactly the new file, and the count is offered as
  *consistent with* no existing test moving rather than as proof: no existing test file was edited.
- **The pass-1 remedy is prose plus one test.** `src/` changed only inside comment blocks, and the
  transpiled `dist/index.mjs` / `.cjs` are **byte-identical (sha256) to the graded sha `e04a997`**,
  so nothing ungraded ships as behaviour and the mutation result above still stands.
- `differential:read`: **0 readings moved**, 0 `valid` false→true, 0 `safeToSummarize` false→true, 0
  negations / retractions / read diagnostics lost. **That 0 is vacuous by construction** and is
  reported as such: no corpus document carries an array-wrapped `Coding` member, so none reaches the
  changed code. The harness prints that caveat itself.
- **Corpus caveat:** hand-authored fixtures, mutations and probes -- **not** the R4 published-examples
  corpus.
- **The `@cosyte/hl7` negative control is DEGENERATE and is reported as such, not counted as a
  pass**: this slice adds no symbol, and every symbol the test file imports (`readSafety`,
  `arrayWrappedScalars`, `parseResource`, `validateResource`, `serializeResourceXml`,
  `assertSafeToSummarize`, `SERIALIZE_ERROR_CODES`, `FhirSafetyError`, `FhirSerializeError`,
  `NEGATION_CODE_READS`) is absent from that package, so the file cannot even load there. A control
  that cannot fail is not a control.

### 🛑 Pass 1's major, and it is this lineage's shape landing on the slice that was fixing it

**The slice's own licence sentence was false, published into five carriers, and it deleted the
accurate version of itself on the way past.** It claimed `clinicalStatus`'s read is type-scoped, so
its wrapper is reported wherever it is read. It is not. `readSafety` fills the `clinicalStatus`
convenience field with `safetyCodeOf(getProperty(resource, "clinicalStatus"), clinicalSystemFor(rt))`
and `clinicalSystemFor` chooses a **preferred system**; it gates nothing. Measured, identical at base
and head: `{"resourceType":"Bundle","clinicalStatus":{"coding":[{"code":["active"]}]}}` reads
`clinicalStatus: "active"` with `arrayWrappedScalars: []`, `safeToSummarize: true`, `valid: true`;
and the multi-position twin declines the value with no location either. **That is verbatim the harm
this slice's own headline uses to motivate itself, on the sibling element.**

Worse than the overclaim: the base text the slice edited to mark the residual closed
(`agent-notes.md`) **named `readSafety`'s `clinicalStatus` convenience read as one of the un-gated
callers.** The slice fixed the `verificationStatus` term of that enumeration and **dropped the
`clinicalStatus` term rather than carrying it forward**. The repo's own record named it; the edit
deleted the name and shipped the opposite.

**The behaviour is `PRE-EXISTING`** (byte-identical read path at `5c575e5`); what was `INTRODUCED`
was the claim. **Remedied by correcting the claim, not by growing the guard** -- marking
`clinicalStatus` `codings` would widen a report to rescue an overclaim, and it is not a negation read
at all. Carriers corrected: `README.md`, `CHANGELOG.md` and the pending changeset (all three ship, or
will), `safetyCodingsOf`'s note in `src/`, the `agent-notes.md` disclosure restored to its
half-closed form, and the both-states test pin **re-titled and given an assertion on
`SafetyReadout.clinicalStatus` itself** -- it previously asserted only `arrayWrappedScalars` and
`safeToSummarize`, so it never looked at the field that disproved its own title. A pin that cannot
see the thing it claims is not a pin.

Two `INTRODUCED` minors from the same pass, both prose: the `nearMissNegationCodes` readout field
said `arrayWrappedScalars` reaches every root for the `Coding` members of "those same elements" when
`status` is not one of them (it ships in `dist`), and `arrayWrappedScalars`' `@returns` still
promised **document order**, which the two halves running one after the other can violate at a root
that emits from both. Corrected rather than re-engineered; the ordering of a diagnostic list is not
load-bearing and sorting it would hide which half emitted what.

### ⚠ Pass 2's two minors were FIXED rather than filed, and are recorded UNGRADED

Pass 2 returned **NOT REFUTED** with two `INTRODUCED` minors, and said in terms that neither should
open a pass 3. Both are prose, both are fixed, and **the transpile is byte-identical (sha256) to the
graded sha `1ee0c6e`**, so nothing ungraded ships as behaviour:

1. **The replacement `@returns` on `arrayWrappedScalars` asserted a new universal that is false.**
   *"That is document order for every document where one root emits from only one of the two"* --
   not so: `checkArrayWrapping` walks surviving properties then shadowed members, so a document
   whose later property is unwrapped and whose earlier one is shadowed emits out of document order
   from the cardinality half alone. **This was the third attempt at that sentence.** It now claims
   walk order and explicitly disclaims document order, rather than trying to be precise about when
   the two coincide. `unspellableXmlWrappers`' sibling `@returns` (a `PRE-EXISTING` copy of the same
   overclaim) is pointed at it rather than left inconsistent.
2. **The residual's blast-radius enumeration understated it in the reassuring direction.** *"never
   `negations`, never `valid`, never `noKnownAllergy`"* omitted the thing a consumer actually
   branches on: **`safeToSummarize` stays `true`** over the value the library declined. The brief and
   both pins said so; the three consumer-facing carriers did not. Added to all of them.

Two `PRE-EXISTING` minors pass 2 raised are **filed, not absorbed**: `safetyCodeOf` /
`safetyHasCodeAnySystem` / `safetyHasCoding` still say *"windowed elements only"*, which the
corrected `safetyCodingsOf` note now contradicts; and `unspellableXmlWrappers`' order claim was
already false at base. Both identical at `5c575e5`.

### The claim sweep, and what it caught

Three statements the package shipped **about itself** were false at base, all in the reassuring
direction (they described a discipline the code was not keeping):

1. `unreadableBooleans`' JSDoc -- "**The window is every resource root**, which is
   `arrayWrappedScalars`' window and is **the same window the negation read uses**". It was not:
   that report's element-level half is type-scoped and the negation read is not.
2. `nearMissNegationCodes`, in **both** its readout-field doc and its collector doc -- the same
   equality, stated twice.
3. `safetyCodingsOf`'s note -- "the reporting rule covers exactly one window … **Read scope must
   equal report scope** … every caller of this must be reading one of the windowed elements off a
   resource root". The negation read had been a caller outside that window for three slices.

Carriers checked, and the two that carried them: **`README.md`** (both #1 and, as a whole paragraph
headed *"One asymmetry is deliberate and worth stating rather than glossing"*, a defence of the
defect itself) and the generated **`dist/index.d.ts` / `.d.cts`** (#1 and #2 -- verified **0** at head
by grepping the built artifacts, not the source). Also checked and clean of these: the pending
changesets, `docs-content/`, the test comments (theirs are about the *element-level* residual and
stay true), and `CLAUDE.md` (its trap is the one this slice honours, and needs no edit -- it stands
at 27,997 / 28,000 untouched). **`CHANGELOG.md` carried the asymmetry paragraph in the present tense
under `[Unreleased]`, so it was cut by deletion rather than annotated** -- this package has never
published, so nothing there is a released record.

`safetyCodingsOf` is **not** exported from the package, so #3 never reached `dist`. Recorded because
"it is in `src`" and "it ships" are different questions and only the second was ever checked here.

### 🔴 Left open, with the reason

- **The element-level wrappers.** `{"resourceType":"ServiceRequest","doNotPerform":[true]}` and
  `{"resourceType":"Procedure","status":["not-done"]}` are still read through and surfaced with no
  `ARRAY_WRAPPED_SCALAR`, as is an array-wrapped `verificationStatus` element. Closing them needs the
  cardinality of the element **names** `status` / `doNotPerform` / `verificationStatus` at a resource
  root on every R4 type that defines them -- an R4 census, which is a different licence and its own
  change. Pinned in both states so it cannot move in silence.
- **A `Coding` wrapper at a `code`-typed `status`** draws nothing, and that is deliberate: nothing
  reads through it (a `CodeableConcept` at `status` is exempt from the unreadable-shape channel, its
  members all being ones FHIR spells somewhere), so reporting the wrapper would be a report *wider*
  than the read -- this slice's own defect inverted. Pinned. The silent read at that position is a
  separate, already-filed residual.
- **`no-known-allergy` stays root- and type-scoped**, read and report alike. It is the one negation
  whose surfacing makes a caller *less* careful, absence reading as *unknown* rather than *none*.
  Pinned, in both directions. Do not "finish the job".
- **The `clinicalStatus` convenience read is the surviving half of this very rule**, and it is the
  sharpest thing left open here: filled off **any** resource root, so on a type the cardinality table
  does not know it unwraps a single-position wrapper, or declines a multi-position one, with no
  location either way. It reaches that one field and nothing else: never `negations`, never `valid`,
  never `noKnownAllergy`, whose read *is* type-gated. Identical at base. **Closing it is a change to
  a convenience READ, not a widening of this report** -- `clinicalStatus` is not a negation and does
  not belong in the read table -- so it is its own slice. Both directions pinned in both states.
- **The validator's `RETRACTED_RESOURCE` is still root-scoped and type-gated.** A different layer
  with a different contract; untouched here rather than absorbed.

## Narrative: The untaggable `resourceType` (2026-08-09, `#77`)

Split out of `documentation/agent-notes.md` when that file was at the 250,000-byte cap it was then
held to, and a later slice needed the room. **Relocated
verbatim, nothing dropped**: the heading below is this section's original one. The cursor stays in
`agent-notes.md`.

### The untaggable `resourceType` (2026-08-09)

`FHIR-XML-WRITE-RESIDUALS`, the non-string-`resourceType` residual `#74`, `#75` and `#76` each
declared open. `SERIALIZE_ERROR_CODES.UNSERIALIZABLE_RESOURCE_TYPE`, raised **last** in the XML
writer, as a whole-model pre-pass. XML only.

#### The defect, measured against `63b05fc`

FHIR XML has no `resourceType` element: the type IS the tag (xml.html). `writeElement`'s skip is
`if (name === "resourceType") continue;`, unconditional on the name, and `resourceTypeOf` returns a
string or nothing, so `serializeResourceXml` fell back to `tagName = rt ?? "Resource"`. Where the
value was not a string, the property was deleted and the element was named a type nobody wrote.

| in                                                                                         | reads                                         | XML out                                                     | re-read                                                                         |
| ------------------------------------------------------------------------------------------ | --------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `{"resourceType":42,"status":"entered-in-error"}`                                          | `RESOURCE_TYPE_UNKNOWN`/error, `valid: false` | `<Resource …><status value="entered-in-error"/></Resource>` | `[]`, `valid: true`                                                             |
| `{"resourceType":{"modifierExtension":[{"url":"http://example.org/x"}]},"status":"final"}` | `valid: false`, `safeToSummarize: false`      | `<Resource …><status value="final"/></Resource>`            | `[]`, `valid: true`, `safeToSummarize: true`, `unhandledModifierExtensions: []` |
| `{"resourceType":"Patient","contained":[{"resourceType":42,"status":"entered-in-error"}]}` | `valid: true`                                 | `<contained><status value="entered-in-error"/></contained>` | a `contained` backbone element, not a contained resource                        |
| `{"_resourceType":{"id":"q"},"status":"final"}`                                            | `RESOURCE_TYPE_UNKNOWN`/error                 | `<Resource …><status value="final"/></Resource>`            | the `id` gone                                                                   |

**The second row is the whole point of taking this leg.** `safeToSummarize` moves because the deleted
property takes its **entire subtree** with it, and a `modifierExtension` -- FHIR's `?!` rule, the one
thing a reader may never ignore -- is among the things that subtree can hold. That is the same shape
`#74`, `#75` and `#76` each closed through a different door: a format change that **upgrades** a
document's own trustworthiness claim.

#### The predicate, and why it is element-level rather than property-level

`lacksTaggableResourceType`: the element wrote a `resourceType`, and **the first one it wrote** is not
a string primitive. Both halves are load-bearing and the second took three attempts.

- **THE QUANTIFIER MUST BE THE WRITER'S OWN, AND `ANY` IS NOT IT. Gate pass 1 refuted the draft that
  asked whether ANY value written there is a string.** `resourceTypeOf` in `src/xml/write.ts` is a
  `find`, and `typeOf` goes through `getProperty`, which is first-wins as well. So with a non-string
  first and a string second the writer read no type, named the element `Resource`, deleted **both**
  properties and took the modifier extension with the subtree -- and an `any`-quantified predicate
  answered `false` and refused nothing. **The defect, unrefused, inside the slice that claimed to
  close it**, and the claim that the shape was safe had reached five carriers. Neither reader emits
  that order, so it is hand-built and pinned that way; the general rule is that **a guard that answers
  for a property the writer never consults is not guarding the writer.**
- **A property-level predicate ("this `resourceType` is not a string") is WRONG, and the counterexample
  comes from XML rather than from JSON.** The XML reader has no `duplicates` mechanism and pushes the
  type synthesized from the tag first, so a `resourceType` CHILD element lands as a second property of
  that name beside it: `<Patient xmlns="http://hl7.org/fhir"><resourceType><a value="1"/></resourceType></Patient>`
  reads as two `resourceType` properties in one `FhirComplex`, `issues: []`, `valid: true`,
  `safeToSummarize: true`. The tag there is named correctly, so this defect's substitution never
  happens; what drops is the repeated-property-name case, which both writers do and which is declared
  separately. A property-level predicate refused it, and **the cost of that is withdrawing
  serialization from a model this library reports as clean.** Do not write it up as "the one cost
  none of the refusals beside this one pays", which this note did and which is FALSE: `breaksTag`
  pays it too, on `<a:!x xmlns:a="http://hl7.org/fhir" value="1"/>`. **Rarity was never the argument;
  the cost is.** Gate pass 2 caught the idiom, tagged it `PRE-EXISTING` because it is verbatim at
  `63b05fc`, and it is cut here at the three carriers this slice authored. **Two base-owned carriers
  are LEFT, on purpose and named so the next reader does not have to find them:**
  `src/codec/serialize-guard.ts` (the `assertNoShadowedProperty` docblock) and
  `test/shadowed-property-write.test.ts`. They belong to `#76`'s slice, not this one.
- **An ABSENT `resourceType` is left alone.** `serializeResourceXml` accepts any `FhirComplex` and
  names a typeless one `Resource` by documented fallback, so refusing there would withdraw a route
  from every model that never had a type -- and nothing is deleted in that case. **The line this
  refusal draws is "the writer drops a property the sender did write", not "the verdict moved".**

#### The bound, which is structural and holds only at the root as a verdict

At the **root**, this costs a round trip only for a model already reported `valid: false`: `typeOf` is
the strict single-value read, so exactly the values refused here draw an error-severity
`RESOURCE_TYPE_UNKNOWN`. **Deeper it does not hold, it is not claimed, and a document read from XML
reaches it.** `{"resourceType":"Patient","contained":[{"resourceType":42,…}]}` and
`<Patient xmlns="http://hl7.org/fhir"><name><resourceType><a value="1"/></resourceType></name></Patient>`
both read `valid: true` with an empty issue list, because no layer here checks a nested element's type.

**So the bound that IS claimed is structural, and it is by construction rather than by sampling**:
the writer's skip is unconditional on the name, so at every location this refuses base dropped a
property the sender wrote and emitted no element for it, with no diagnostic at either end. What is
withdrawn is a deletion, never a round trip that reproduced the input.

#### Raised last, and nothing moved onto it

Last in the chain, after `UNSERIALIZABLE_ELEMENT_NAME`, `UNSERIALIZABLE_DIV_MARKUP`,
`UNSERIALIZABLE_JSON_ONLY_SHAPE`, `UNSERIALIZABLE_ARRAY_WRAPPER` and `UNSERIALIZABLE_SHADOWED_PROPERTY`.
Measured, one document per code, each an untaggable type gate spelled a different way:
`{"resourceType":null,…}` keeps `UNSERIALIZABLE_JSON_ONLY_SHAPE`, `{"resourceType":["Observation"],…}`
and `{"resourceType":[],…}` keep `UNSERIALIZABLE_ARRAY_WRAPPER`,
`{"resourceType":42,"resourceType":"Observation",…}` keeps `UNSERIALIZABLE_SHADOWED_PROPERTY`, and an
XML document with dropped element text keeps `DROPPED_ELEMENT_TEXT`. **No case moved onto the new
code.** Pinned by `test/xml-resource-type.test.ts`, "raised last, so no case moves onto the new code".

The walk is `collectMarked`'s, shared with `droppedText` / `nestedArrays` / `assertXmlSerializable`
rather than copied, and it selects **elements**; the location appends the `resourceType` segment with
`childPath`, which is how the array wrapper on the same property already reports it
(`Resource.resourceType`, `Patient.contained[0].resourceType`).
**`collectMarked`'s signature was left alone.** A first draft widened its predicate to receive the
property name so the walk could answer property-level questions; that draft was reverted with the
property-level predicate it existed for, and the shared walk is unchanged in this slice.

#### Both polarities, on the test rather than on a harness

`test/xml-resource-type.test.ts` **fails 13 of 25 against the base source tree** (the two `src/` files
stashed) and passes 25 of 25 at head. A control asserted in one state only clears nothing here; this
one is asserted in both.

**IT USED TO READ 7 OF 23, AND THE MISSING SIX WERE VACUOUS GREENS. A GREEN IN BOTH STATES CLEARS
NOTHING EITHER.** Those cases asserted `viaXml?.code` against
`SERIALIZE_ERROR_CODES.UNSERIALIZABLE_RESOURCE_TYPE`, and against a base tree **both sides are
`undefined`**, so `expect(undefined).toBe(undefined)` passed and the four scalar spellings the
CHANGELOG leans on discriminated nothing in the polarity that matters. They now assert a **string
literal**, with the enum member pinned once on its own. Raised by gate pass 1 as an observation rather
than a finding, which is why it is written down here.

The out-of-tree harness carried its own negative control: pointed at `@cosyte/hl7` instead of this
package it exits non-zero on the missing `serializeResourceXml` rather than reporting green.

#### Not closed by it, named rather than implied

- **A JSON decimal comes back from XML as a string**, because XML carries no JSON type.
- **`Observation.value[x]`** is outside the array-wrapper window and its wrapper still launders.
- **A `resourceType` CHILD element read from XML is still dropped by both writers**, silently, and
  that document reads `valid: true`. It is the repeated-property-name case reached through a door the
  reader's missing `duplicates` mechanism opens, not this one, and refusing it would pay the cost
  named above. `<Patient xmlns="http://hl7.org/fhir"><resourceType value="Observation"/></Patient>`
  comes back as `<Patient xmlns="http://hl7.org/fhir"/>`. Pinned as a characterization test.
- **The XML reader putting two properties of one name in one `FhirComplex`** is the underlying gap
  behind that row, and it is a READ-path decision, not this branch.

#### The axis of every "0" here

**None of the numbers above is the FHIR R4 published-examples corpus.** They are 7 hand-authored XML
fixtures plus mutations plus this repo's hand-authored JSON fixtures, plus the hand-built documents in
`test/xml-resource-type.test.ts`. The read differential cannot grade this class: the substitution is a
WRITE-path branch, no XML document produces the marker, and its own control is stale on a clean tree.
No zero of its is quoted as evidence here.

#### What the gate found (pass 1, `52472c2`)

`REFUTED`, and **the first `fhir` slice in eleven where the gate found a defect in the code rather
than only in a sentence.** The escalated process finding above -- ten consecutive slices refuted on
prose, and the pressure that creates to write a longer sentence -- ends here on the opposite outcome:
the remedy was a **quantifier**, and the prose shrank around it.

1. **`INTRODUCED` major, and it is the item's own leg.** `some` in the guard against `find` in the
   writer, above. Remedied in the predicate, not in the claim: aligning it refuses nothing either
   reader can build, and it makes the root-level bound (`typeOf` is first-wins, so exactly the values
   refused draw an error-severity `RESOURCE_TYPE_UNKNOWN`) true as written instead of nearly true.
2. **`INTRODUCED` minor: the thrown message stated a counterfactual false at every depth it reports.**
   _"...which this writer would delete while naming the element `Resource`"_ -- but at depth the tag
   comes from the property name, and the message is emitted for `Patient.contained[0].resourceType`.
   **Cut to what is true everywhere: "which this writer would delete."** The `Resource` substitution
   is a root fact and is stated where it is true.
3. **`PRE-EXISTING` minor, taken anyway because this slice edits the paragraph and widens it.** The
   module comment's _"No refusal here recognises anything new, invents a value, or changes a document
   that reads clean"_ was already false at base -- `breaksTag` names a zero-issue document it refuses,
   and so does the `div` forgery. **Only the false clause is cut**; the two true ones are kept, which
   is the `#76` rule. One carrier, so cutting it there is the whole sweep: `dist/` is generated, and
   no pending changeset carries the sentence.

What the gate could **not** grade, in its own words: every "measured at `63b05fc`" number, because its
Bash is `git diff`/`log`/`show` only. Those were re-measured by hand against a `63b05fc` worktree
before the pass and again after the remedy.

## Narrative: The XML magnitude, read (2026-08-09, `FHIR-XML-WRITE-RESIDUALS`)

Split out of `documentation/agent-notes.md` when that file was at the 250,000-byte cap it was then
held to. The cursor stays there; this is the narrative.

### The filed line was half right, and the halves disagree

*"A JSON decimal returns from XML as a string"* is a **declared limit** at the model, not a defect.
FHIR XML carries every primitive as the text of its `value` attribute and the reader is schema-free
by design: with no `StructureDefinition` in hand it never guesses a datatype. Precision survives on
both paths (no `number` is involved either way), and `nodesEquivalent` already accounts for it.

**But `readQuantity` accepted only the JSON reader's shape.** Measured at `b60e720`, an XML
`MedicationRequest` whose dose is written `<value value="5"/><code value="mg"/>` read back as
`{ value: undefined, code: "mg" }` under `issues: []`, and the same held for
`readObservationValue().quantity` and both `readReferenceRanges` bounds. `undefined` is this API's
documented word for *no magnitude*, so a document that carried one came back as the **bare-unit
shape**. Now read from either reader's model, recognised against the R4 `decimal` lexical space, text
carried through unchanged.

**NO DIAGNOSTIC MOVED, MEASURED RATHER THAN ARGUED:** nothing in `src/validate/` branches on
`Quantity.value` (both UCUM checks read `system` and `code`), and `scripts/read-differential.ts`
reads no quantities. Confirmed independently by the gate: `validateResource` output is byte-identical
base vs head across every probe.

**COLLATERAL, DECLARED: the model records no provenance**, so a JSON document that spelled its
magnitude as a string is read the same way. Upheld by the gate as *not* the ADR 0018 tolerance this
repo refused for element-text recovery: that one invents a value slot FHIR XML does not define; this
one reads a magnitude written **at** `Quantity.value` in a form R4's own regex defines.

### Four residuals, pinned by `test/xml-quantity-magnitude.test.ts`

Each is a characterization test over a gap. Closing one MUST red it, in the same change.

1. Re-serializing an XML-sourced decimal to JSON **quotes** it (`"1.50"`, not `1.50`). Text
   byte-exact, JSON type not.
2. `validatePrimitiveValue` reads the JSON reader's model shape as **the** model shape, so a
   conformant `<active value="true"/>` draws `TYPE_MISMATCH` and flips `valid` where the JSON twin
   validates clean. **The in-place lexical fix RETIRES A REAL mismatch on `{"active":"true"}` and
   nothing separates the two: a decision, not a patch.** The gate found no safe in-place remedy
   either, and recorded one safe out-of-place one for a future slice: provenance need not live in the
   model, because `parseResourceXml` already returns a `ReadResult`, so a caller-supplied validate
   option separates them without touching the JSON rule.
3. `matchesFixed` compares model shapes, so a profile's `fixed[x]` decimal never matches XML.
4. **The bare-unit shape is NARROWED, NOT RETIRED, and it is still silent.** `+5`, `05`, `.5`, `5.`
   and `" 5"` are outside R4's `decimal` space, so they read `undefined` beside a unit that reads
   fine, with nothing on any diagnostic channel. Refusing to read them is right (coercing would
   author a magnitude the sender did not spell); the residual is that the refusal is silent.

### What the gate caught, pass 1 (`9a6f0dc`, `REFUTED`, two `INTRODUCED` majors, both deletion-shaped)

- **A universal written INTO the remedy.** *"It never means 'present but unread'"* was false at
  residual 4, in **five carriers** (two in `src/quantity/ucum.ts`, `CHANGELOG.md`, the changeset, the
  commit). The pressure this lineage keeps naming, arriving on the pass that finally had code to
  report: a guarantee is a longer sentence than a measurement.
- **A phrase sweep is not a carrier sweep, third slice running.** *"Four false 'same model' sites
  cut"* was itself false: `agent-notes.md`'s `#p2-p3-and-what-the-package-does-today` carried the same
  universal, and `documentation/` is on the written carrier list. **Five.** **Sweep the carrier list
  `agent-notes.md` already writes down, never a phrase.**
- **`instanceof` bought nothing and lost a magnitude base read.** The base predicate was duck-typed
  (`typeof node.value === "object"`); `instanceof FhirDecimal` fails the brand check for a decimal
  built by a second copy of the module graph, which is the bare-unit shape again. Reverted to the
  duck type, which narrows identically in TypeScript.
- `JSON_NUMBER` was documented as a **strict superset** of the R4 `decimal` space. They are equal,
  character for character, and the new docblock in the same file said so: cut.

Upheld on every measurement: the R4 space and nothing wider (`5`, `-0`, `0.010`, `1.0E2`, `1e+2`,
`9223372036854775807`, `&#53;` read; `+5`, `05`, `5.`, `.5`, `1_000`, `0x10`, `Infinity`, `NaN`,
Arabic-Indic digits refused, nothing coerced or normalised); polarity re-derived independently at
**7 failed / 10 passed of 17**, no `expect(undefined).toBe(undefined)` shape anywhere.

### What the gate caught, pass 2 (`cb28b8b`, `REFUTED`, two `INTRODUCED` majors, both deletion-shaped)

**▶ 🛑 THE HEADLINE, AND IT IS A RULE ABOUT REMEDIES: BOTH FINDINGS WERE THE PASS-1 REMEDY ITSELF,
RECOMMITTING THE DEFECT IT FIXED, ONE STEP NARROWER EACH TIME.** No pass has refuted the code.

- **A false UNIVERSAL was replaced by a false MODULO.** *"`nodesEquivalent` defines cross-format
  equivalence modulo exactly this"* and *"the difference is a primitive's lexical form"* name **one**
  of the **two** irreducible differences `src/xml/equivalence.ts` itself enumerates: the other is the
  **singleton list** (JSON `name` is a `list` node, XML `name` a `complex` one). Seven carriers.
  **THE REMEDY IS DELETION, NOT ENUMERATION** -- adding "and singleton lists" would still be short,
  because `equivalence.ts` names two further corner cases below its numbered pair. What ships asserts
  **non-identity** and points at the oracle, which is what that file already told a reader to do.
- **The census of what was LEFT was itself short**, and cited a line number already stale. Hence: no
  count anywhere, and the rule instead of the number. Pass 3 then found the deleted census had
  carried a **second** falsehood: the site it called self-disclosing continues with a **stronger**
  universal, not a qualifier.
- **`PRE-EXISTING`, and the reason the two `src/xml/read.ts` edits exist:** that docblock called the
  singleton case *"**the one** irreducible schema-free ambiguity"* while the bullet above it defined
  equivalence *"modulo lexical form"*. Two one-sided quantifiers, both since before this slice, both
  cut with the finding above.
- **A commit message is a carrier that cannot be cut.** `9a6f0dc`'s body still carries the refuted
  guarantee in weaker words, and `scripts/ship.sh` squash-merges. **So the squash body is written by
  hand rather than filled from the branch**, and this is the standing reason.

### The pass ledger

`9a6f0dc` `REFUTED` -> `cb28b8b` `REFUTED` -> `c09dd23` **`NOT REFUTED`**. **Cumulative: 3 graded
passes, none of which refuted the CODE** -- every finding in all three was claim width.

**▶ ⚠ THE COMMIT AFTER `c09dd23` IS UNGRADED BY THE GATE AND SAYS SO IN ITS OWN MESSAGE AND IN THE
PR.** It applies pass 3's four `INTRODUCED` **minors**, which are all record-accuracy in this file and
in `CHANGELOG.md` plus one comment in the test file, and it is deletion-dominant. **It does NOT ride
on ADR 0027**, whose conditions pass 3 measured as unmet (that route needs a deletion-only remedy, and
this one adds sentences). It rides on the verdict: no blocker, no major, and no behaviour touched.
**Do not copy a pass ceiling out of this file.** ADR 0016's last amendment (2026-08-02) says four and
ADR 0027 says three; they conflict, unresolved, and two agents have already halted a slice early by
reading only the first number they met. Read the ADR, both of them, top to bottom.

### The axis of every number here

7 hand-authored XML fixtures plus mutations, this repo's hand-authored JSON fixtures, and hand-built
probes. **None of it is the FHIR R4 published-examples corpus.** Nothing here is corpus-wide.

## Narrative: The XML boolean, read (2026-08-09, `FHIR-XML-BOOLEAN-NEGATION-LOST`)

Split out of `documentation/agent-notes.md` when that file was at the 250,000-byte cap it was then
held to, and `CLAUDE.md` at its own. The cursor stays
there; this is the narrative. Sibling: [the XML magnitude narrative](#narrative-the-xml-magnitude-read-2026-08-09-fhir-xml-write-residuals), the same root class
one datatype over.

### What it was

Filed as a **STOP-THE-LINE**, and reproduced three times before any code moved (by `#78`'s author
outside its slice, by the coordinator at `4eb444f`, and by this slice's own probe at the same
commit). All three agree:

```
{"resourceType":"MedicationRequest","status":"active","intent":"order","doNotPerform":true, …}

  JSON            -> negations: ["do-not-perform"]  doNotPerform: true
  XML round trip  -> negations: []                  doNotPerform: undefined
                     issues: []   safeToSummarize: true   assertSafeToSummarize PASSES CLEAN
```

The round trip is **this package's own** `serializeResourceXml` then `parseResourceXml`. **The
writer is correct**: it emits `<doNotPerform value="true"/>`. The reader yields
`{kind:"primitive", value:"true"}`, the **string**, because FHIR XML carries every primitive as
attribute text and this reader is schema-free by design. `readDoNotPerform` read via
`primitiveBooleans`, which accepted only a JS `boolean`, **and a failed match reads as absence.**

**Why it outranked the other residuals of its class:** `#78`'s Quantity defect degraded a _value_;
this one **inverts an instruction**.

### THE CENSUS IS THE LESSON, AND SO IS WHAT IT DID NOT LICENSE

The item said _census every boolean_. The census found three sites. **Only one was changed, and the
gate is why.**

| Site                                                                 | Via                 | Read from XML | Disposition               |
| -------------------------------------------------------------------- | ------------------- | ------------- | ------------------------- |
| `MedicationRequest.doNotPerform` (`safety/status.ts`)                | `primitiveBooleans` | LOST          | **FIXED**                 |
| `ElementDefinition.mustSupport` (`profiles/structure-definition.ts`) | `primitiveBoolean`  | LOST          | **left standing, pinned** |
| `ElementDefinition.slicing.ordered` (same file)                      | `primitiveBoolean`  | LOST          | **left standing, pinned** |

**The first draft widened both helpers, and `conformance-refuter` pass 1 REFUTED it with a measured
BEHAVIOURAL counterexample.** `src/profiles/snapshot.ts` merges a differential flag only when it is
not `undefined`, so an XML `<mustSupport value="false"/>` that base read as `undefined` began
**overwriting an inherited `true` and RETIRING a `MUST_SUPPORT_ABSENT` the base emitted.** The same
held for a non-conformant JSON `{"mustSupport":"false"}`. That is the exact retirement class `#78`
measured at `validatePrimitiveValue` and declined, reopened one layer over and unmeasured.

**THE RULE THIS BOUGHT, AND IT IS NOT "CENSUS EVERY BOOLEAN":
A SAFETY READ AND A CONVENIENCE READ CANNOT SHARE A WIDENING.** `primitiveBooleans` feeds
`negations`, where a newly-read value can only **add**. `primitiveBoolean` feeds callers that treat
`undefined` as **inherit**, where the same newly-read value **removes** a finding. The helpers look
interchangeable and the direction of harm is opposite. **Additivity was argued from the helper's
export status; it is a property of its CONSUMERS.** Check every consumer for an
`undefined`-means-inherit merge before widening anything. `snapshot.ts` `mergeElement` has eight such
lines. **The split is left in the tree deliberately**, both helpers being package-private, each
read by exactly one module (`primitiveBoolean` from two call sites in `structure-definition.ts`,
`primitiveBooleans` from one in `status.ts`) and documented at each site; the standing hazard is that **two near-identically-named
readers of one datatype now accept different text, so if either is ever exported the split must be
resolved rather than shipped.**

**`negations` is monotone across the change** (a JS `boolean` `true` still yields `true`, so the
negation can never be retired), **but `SafetyReadout.doNotPerform` moves further than `undefined` to
a value**: it also moves `false` to `true` where **any** value spells the negation a JS `boolean`
**elsewhere in the element** contradicts (the ordering is not the point, and a draft that said
_later_ / _earlier_ was falsified by `{"doNotPerform":["true",false]}`), which is the documented
"a `true` anywhere wins" rule and is pinned at
`test/xml-lexical-boolean.test.ts`. **Gate pass 2 refuted a sentence saying the read "can only fill
in a value that was `undefined`" using this slice's own fixture: the third generation of one
universal.** Say _adds a negation, never retires one_, which is the only form that measures true.

**Censused and deliberately unchanged**, each a decision:

- **`validatePrimitiveValue`'s `boolean` branch** (`validate/primitives.ts`): still reads a
  conformant `<active value="true"/>` as `TYPE_MISMATCH` and flips `valid`. `#78` measured that an
  in-place fix **retires a real mismatch** on JSON `{"active":"true"}`. **Not reopened here.**
- **FHIRPath `convertToBoolean`** (`fhirpath/evaluate.ts`, and it **is** a public export feeding
  `InvariantResult.satisfied`, an error-severity verdict): a single non-Boolean item is `true` by the
  reference singleton-evaluation rule, so an XML-sourced `<doNotPerform value="false"/>` judges an
  invariant `true`. Fixing it changes FHIRPath typing for genuinely string-valued elements, so it can
  **retire** a finding. Pinned.
- **`toTrit`** (same file): throws `UnsupportedFhirPathError` on a string operand. **Fail-loud**,
  surfacing as `INVARIANT_UNCHECKED`. Left as is.
- **`systemTypeOf`** (same file): an XML-sourced boolean answers `"String"`, so `is Boolean` is
  false. Same trade.
- **The writers** (`xml/write.ts`, `codec/write.ts`, `xml/equivalence.ts`): they _emit_ and already
  render a string unchanged, so the round trip is byte-exact either way.

**The wider sweep the item asked for, over consumers matching on the JSON reader's TYPE rather than
just booleans.** `decimalValue` closed by `#78`. **`parseMin`** (`structure-definition.ts`),
`min` being an `unsignedInt` read through an `instanceof FhirDecimal` match, so **a profile handed
over in XML declares required elements this library enforces none of**, silently (`max` is fine, FHIR
spells it a string in both formats). **CLOSED 2026-08-09, and the widening is safe ONLY because
`mergeElement` now takes the TIGHTER of the inherited and stated bound**: it overlaid the
differential's verbatim, so any newly-read bound below the inherited one retired a `CARDINALITY_MIN`
under `valid: false -> true`. A gate pass paid for that. `max` is the unguarded mirror:
[the XML profile `min` narrative](#narrative-an-xml-sourced-profiles-required-elements-are-enforced-elementdefinitionmin). **OPEN: `numberOf`** (`fhirpath/evaluate.ts`), where an
XML-sourced number falls through to **string** ordering, so `"9" < "10"` is false. `lexicalOf`
(`bundle/types.ts`), `resourceTypeOf` (`model/node.ts`) and `lacksTaggableResourceType`
(`codec/serialize-guard.ts`) read strings and are correct on both paths.

### Where the fix went, and why not one layer down

**At the safety read helper, `src/safety/codes.ts`, not in the XML reader.** A new `booleanOf`
recognises **exactly `true` and `false`**, the whole of R4's `boolean` lexical space, and
`primitiveBooleans` routes through it. This is the level `#78` used for the identical remedy
(`decimalValue` inside `readQuantity`).

**Reader-level coercion was rejected, and the reason is not timidity.** The reader is schema-free by
design: with no `StructureDefinition` it cannot know `value` spells a `boolean` rather than a `code`,
so coercing there turns `<name value="true"/>` on a string element into a JS boolean and
`serializeResource` then emits `true`, **authoring a value the sender did not spell and laundering it
across a format change**, the exact move `#74` refused. The gate confirmed the reader has no
conformant-input hole under this choice: namespace prefixes resolve and `&#116;rue` decodes, so no
legal XML spelling of `true` escapes the helper.

### What moves, measured base-vs-head

**No diagnostic moves at all.** `collectProfileIssues` over an XML-sourced profile and
`validateResource` over the round-tripped `MedicationRequest` are identical on `4eb444f` and at head.
The only thing that moves is `readSafety`'s `doNotPerform` and `negations`.

### Residuals, each pinned in `test/xml-lexical-boolean.test.ts`

Closing any of them MUST red its test, in the same change.

1. **The two profile booleans**, above: unread from XML, and the retirement is why.
2. **`ElementDefinition.min` unread from XML**, silently. Same root class, different datatype.
   **CLOSED 2026-08-09** ([the XML profile `min` narrative](#narrative-an-xml-sourced-profiles-required-elements-are-enforced-elementdefinitionmin)); the pin here was rewritten in
   place rather than deleted. What stays open is the unguarded `max` mirror in `mergeElement`.
3. **FHIRPath `convertToBoolean` reads an XML `false` as `true`.**
4. **`safeToSummarize` IS UNMOVED IN BOTH DIRECTIONS, AND THE SECOND DIRECTION IS A REAL GAP.**
   For a value that reads, unmoved is right: `negations` carries the instruction and refusing to
   summarize was never the remedy. For a value that does **not** read (`"1"`, `"0"`, `"Y"`, ordinary
   v2- and C-CDA-to-FHIR converter output) **the element is present, its value is unread, nothing
   records that, and the readout affirms**: the exact shape this item was filed over, surviving one
   spelling over. `codes.ts` states the contract it sits against, that a consumer which does not
   understand a modifier must **refuse** it rather than process it as absent. `SafetyReadout` has
   location channels for content the codec could not read (`nestedArrays`, `droppedText`) and **none
   for "value written, not readable"**. Base did this for `true` too, so it is strictly improved and
   did not block. **Do not let "declared residual" absorb it: it wants its own item.**
   **▶ 🟢 IT GOT ONE AND IT IS CLOSED**, `FHIR-XML-UNREADABLE-BOOLEAN-IS-SILENT`:
   [the unreadable boolean narrative](#narrative-the-unreadable-boolean-reported-2026-08-09-fhir-xml-unreadable-boolean-is-silent). The remedy was the missing channel
   (`unreadableBooleans`), **not** a wider read: the read is byte-identical to what this slice left.
   Its half of the pin above moved out of `test/xml-lexical-boolean.test.ts` accordingly; residuals
   1-3 stay there, unchanged.

The lexical space itself is the fifth: `"TRUE"`, `"True"`, `"1"`, `"yes"`, `"Y"`, `" true"` and `""`
read as no boolean. Refusing them is right, because coercing would author a value the sender did not
spell. **The refusal being SILENT was the gap, and it is closed for the safety read only** (above):
`primitiveBoolean`'s callers still refuse the same text with nothing on any channel.

### Measurements

**Red-at-base 6-of-22** against a real `4eb444f` worktree (22-of-22 at head). The other **16 are
green in both states on purpose and are named**: seven lexical-space negative controls, the
`doNotPerform`-on-`Patient` type gate, the decimal-form control, the JSON-reader control, the three
profile-census pins, and the three residual pins. Non-vacuity was established by mutation, not
asserted: a case/whitespace-insensitive `booleanOf` reds 3, dropping the `false` arm reds 1,
accepting `"1"` reds 1.

**The gate: `conformance-refuter` REFUTED -> REFUTED -> NOT REFUTED, cumulative 3** (`4b67787`,
`1d9953d`, `27cb42c`; the first two were amended away). **Pass 1's finding was BEHAVIOURAL** (the
`mustSupport` retirement above), which is why **ADR 0027 is NOT available to this slice** and was not
invoked: its route requires that no pass refuted the code. The gate converged instead. **One commit
after `27cb42c` applies pass 3's two advisories and is UNGRADED**, disclosed here, in its own message
and in the PR: it deletes an over-specified _later_ / _earlier_ ordering from the `doNotPerform`
transition sentence at three sites, and corrects "single-consumer" to name the call sites. Both are
documentation, neither adds a guarantee.

**Suite 64 files / 1,316 tests**, which is `#78`'s 1,294 plus this file's 22 exactly, so **no
existing test moved**. **Corpus caveat, standing:** hand-authored XML fixtures plus mutations and
hand-built probes, **not** the FHIR R4 published-examples corpus. Nothing here is corpus-wide.

**Claims deliberately left standing, because this slice cannot grade them:** the _"same schema-free
model"_ universals at `README.md` (x2), `src/index.ts` and `src/xml/read.ts`; _"never drops a status,
modifier, or negation"_ at `README.md` and `docs-content/intro.md`, still qualified by a status
written as XML **element text**, a different channel; and the `@example` blocks on `primitiveString`
/ `primitiveBoolean` (`codes.ts`) that `import` them from `@cosyte/fhir` although neither is
exported, byte-identical at `4eb444f` and reaching no declaration file.

## Narrative: The unreadable boolean, reported (2026-08-09, `FHIR-XML-UNREADABLE-BOOLEAN-IS-SILENT`)

Split out of `documentation/agent-notes.md` when that file was at the 250,000-byte cap it was then
held to, and `CLAUDE.md` at its own. The cursor stays
there; this is the narrative. Siblings: [the XML boolean narrative](#narrative-the-xml-boolean-read-2026-08-09-fhir-xml-boolean-negation-lost), the
slice immediately before this one, and [the XML magnitude narrative](#narrative-the-xml-magnitude-read-2026-08-09-fhir-xml-write-residuals), the same root class
one datatype over.

### What it was

Filed as a **STOP-THE-LINE** by `#79`'s own gate, outside its slice, and reproduced independently by
the coordinator at `05ecc5a` and again by this slice's probe at the same commit. All agree:

```
<doNotPerform value="true"/>   negations: ["do-not-perform"]   issues: []  safeToSummarize: true  assert clean
<doNotPerform value="1"/>      negations: []                   issues: []  safeToSummarize: true  assert clean
<doNotPerform value="Y"/>      negations: []                   issues: []  safeToSummarize: true  assert clean
<doNotPerform value="0"/>      negations: []                   issues: []  safeToSummarize: true  assert clean
<doNotPerform value="N"/>      negations: []                   issues: []  safeToSummarize: true  assert clean
```

`#79` closed the `"true"` row. **`"1"` and `"Y"` are ordinary v2 and C-CDA converter output for a
boolean**, and R4's `boolean` lexical space is `true|false` (`datatypes.html`), so they are **not
readable** rather than false. **The reading is indistinguishable from `"0"` / `"N"`**: an author who
wrote _"yes, do not administer"_ got the same answer as one who wrote _"no"_, with nothing recorded
anywhere.

**The structural gap was the item, not the site.** `SafetyReadout` had location channels for content
the codec **could not read** (`nestedArrays`, `droppedText`) and **none for "value written, not
readable"**: against `codes.ts`'s own stated `?!` contract.

### 🛑 THE TRAP, WHICH ALREADY REFUTED A PREDECESSOR: DO NOT WIDEN `booleanOf`

**Accepting `"1"` / `"Y"` is the OPPOSITE of what this item asked, and it is a worse defect than the
one it fixes.** It invents a reading R4 does not license, and it turns `<doNotPerform value="0"/>`
and `value="N"` into a JS `false` that `serializeResource` then emits, **authoring a value and
laundering it across a format change**, exactly what `#74` refused. `"1"` and `"Y"` also arrive on
real wires meaning a boolean's `true` _and_, elsewhere, its opposite: there is no safe direction to
guess in.

**What was missing was a REPORT, not a wider read.** `booleanOf` is byte-identical to `#79`'s. The
value stays unread; what changed is that its presence is recorded.

### The remedy

`SafetyReadout.unreadableBooleans`, a third **not-readable** location channel beside `nestedArrays`
and `droppedText`, plus `unreadableBooleans(resource, path)` exported beside them. It feeds
`safeToSummarize` and `assertSafeToSummarize`.

Detection is `hasUnreadableBoolean`, the **exact complement** of the read: it walks the same values
through the same array wrapper (`scalarValues`) and asks `booleanOf` the same question, so a location
is emitted for precisely the values `primitiveBooleans` declined. That coupling is deliberate and is
the reason it cannot false-fire, **it cannot report a value the read did not look at, and it cannot
miss one the read dropped.** A second rule with its own shape could do both.

**It is decided in the safety layer, not the reader, and not the validator.** The reader is
schema-free: `<doNotPerform value="1"/>` and `<status value="1"/>` are the same node to the codec, so
nothing at parse time knows the text should spell a `boolean`. The safety layer is the first place
that knows the datatype.

### 🛑 THE ADDITIVITY ARGUMENT, FROM THE CONSUMERS, AND IT IS THE WHOLE GATE

`#79` paid a refuted pass for the rule that **additivity is a property of the CONSUMERS, not the
helper**: its pass 1 measured an XML `<mustSupport value="false"/>` overwriting an inherited `true`
and **retiring** a `MUST_SUPPORT_ABSENT`.

**That class is unreachable here by construction, and the reason is the strongest form available:
THIS SLICE WIDENS NO READ AT ALL.** No value that was `undefined` becomes defined anywhere, so
nothing that treats `undefined` as _inherit_ or _absent_ ever sees a new value. The consumers, in
full:

| what is added                                                  | who reads it                                                          | can it remove anything                                                                        |
| -------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `SafetyReadout.unreadableBooleans`                             | nothing in tree before this slice                                     | new field; no prior consumer                                                                  |
| `safeToSummarize`                                              | `assertSafeToSummarize` only (every other mention in `src/` is prose) | a conjunction of empty-list tests, one term added: monotone `true → false`, never the reverse |
| `assertSafeToSummarize` locations                              | `FhirSafetyError.locations`                                           | appended last; no existing location is dropped or reordered                                   |
| the read (`booleanOf`, `readDoNotPerform`, `primitiveBoolean`) | unchanged                                                             | **nothing added at all**                                                                      |

**Measured, not argued.** Over a 33-document corpus in a real `05ecc5a` worktree, comparing every
`SafetyReadout` field that exists on both trees, both writers' output, the parse issues, the
`ValidationIssue` list and `valid`: **13 documents move, and in every one the ONLY field that moves
is `safeToSummarize`, `true → false`.** The other 20 are identical on every channel. **No diagnostic
moves anywhere.**

### `safeToSummarize` DOES move, and that is the answer rather than a side effect

Its stated contract is that the library declines when a summary would have to assert something it
cannot establish. An unreadable negation is precisely that. `value="1"` and `value="0"` are
indistinguishable to a reader with no licence to guess, so **affirming over either is affirming over
a coin flip**: and the coin decides whether a medication is given. Both now refuse. Note the
direction that makes this honest: the fix does **not** make `"Y"` and `"N"` read differently; they
still read alike, because they _are_ alike to this library. What changed is that the shared answer is
a refusal instead of an affirmation.

### The census: the class is WIDER than the channel, and the channel says so

**Booleans the safety spine reads out of a document: exactly one.** `MedicationRequest.doNotPerform`.
`retracted` and `noKnownAllergy` are derived from codes and codings, not from a `boolean` element. So
the channel is **complete for its own layer** and for nothing beyond it, and that limit is written
into its docblock rather than left to be discovered.

| site                                          | read via                         | unreadable value at head | disposition              |
| --------------------------------------------- | -------------------------------- | ------------------------ | ------------------------ |
| `MedicationRequest.doNotPerform`              | `primitiveBooleans` (safety)     | **REPORTED**             | **FIXED**                |
| `ElementDefinition.mustSupport`               | `primitiveBoolean` (convenience) | silent                   | standing, pinned         |
| `ElementDefinition.slicing.ordered`           | `primitiveBoolean` (convenience) | silent                   | standing, pinned         |
| `ElementDefinition.min` (`unsignedInt`)       | `parseMin`                       | silent                   | narrowed 2026-08-09      |
| `Quantity` magnitude (`+5`, `05`, `.5`, `5.`) | `readQuantity`                   | silent                   | standing, `#78`'s pin    |
| FHIRPath `numberOf`                           | FHIRPath                         | silent                   | standing, `#79`'s census |

**The `min` row narrowed on 2026-08-09 and the row is scoped, not retired.** `parseMin` now reads
R4's **`unsignedInt`** lexical space off XML (`[0]|([1-9][0-9]*)`, `min`'s own datatype), so a stated
bound is enforced and `<min value="0"/>` reads faithfully as `0`; a `min` written **outside** that
space (`+1`, `01`, `1.0`, `" 1"`, `1e2`) is still unread and still silent, which is what this table's
column measures. [the XML profile `min` narrative](#narrative-an-xml-sourced-profiles-required-elements-are-enforced-elementdefinitionmin).

**The two profile booleans are not merely unfixed here, they have nowhere to go.** A
`StructureDefinition` is not a safety resource and has no `SafetyReadout`, so reporting them needs a
home this slice does not build, a second reason on top of `#79`'s measured retirement.

### The one deliberate asymmetry: NO `ValidationIssue` OF ITS OWN

**On the default path this is the first place on the readout where `safeToSummarize: false` sits
beside `valid: true`.** Stated rather than glossed, because it is new.

**🛑 THE REASON IS AVAILABILITY, AND TWO STRONGER-SOUNDING VERSIONS OF IT ARE FALSE. THE GATE
REFUTED BOTH, ONE PER PASS, IN THIS PARAGRAPH.**

**Pass 1 killed** _"the validator is schema-free and every rule it carries is about a shape FHIR gives
no meaning to at any position"_. It is not schema-free: `validateResource` takes `{ schemas }`,
`validate.ts` resolves a datatype from the registry, and `validate/primitives.ts` decides `boolean`
on it.

**Pass 2 killed the replacement**, _"supply a schema and it draws `TYPE_MISMATCH` on the conformant
`value="true"` too, so it does not separate readable from unreadable"_. The three rows behind that
were all **XML**, and the conclusion was drawn unscoped over a channel whose own docblock says "in
either wire format". On the **JSON** wire it is plainly false: `validatePrimitiveValue` shape-checks
`typeof value === "boolean"`, so a conformant `{"doNotPerform":true}` validates **clean** with a
schema supplied while `{"doNotPerform":"Y"}` draws `TYPE_MISMATCH`. The package's own pending
`olive-comets-listen` changeset already said so.

**What survives unscoped is availability, not discrimination.** `MedicationRequest` has **no built-in
schema** (`BUILTIN_SCHEMAS` was `[Patient]` when this was written and is `[Patient, Observation]`
from 2026-08-25; `MedicationRequest` is in neither list, so the claim is unchanged, and read the set
off the module rather than off this parenthesis), so the validator is silent about this element's
**datatype** unless a caller supplies one (the shape channels, `ARRAY_WRAPPED_SCALAR` and
`DUPLICATE_PROPERTY`, still fire at this element with no schema at all: pass 3's one-word finding), and a readout that has to hold on every document cannot be built on a diagnostic
that only exists when a caller opts in. The safety layer knows the datatype **unconditionally**, which
is why the report lives there. Pinned on the default path and with a schema supplied.

**🛑 A CORRECTED CLAIM IS A NEW CLAIM, AND THIS PARAGRAPH PRODUCED THREE, EACH STILL A LITTLE WIDE.**
Pass 3 graded the third **NOT REFUTED** but found it wide by one word (_"silent about this element"_
where only its **datatype** is silent), which is the narrowing above. Every one of the three was the
_reason_ reaching further than the _measurement_, and every remedy was a deletion or a narrowing.
**Measure both wires, and both the datatype channel and the shape channels, before writing a general
sentence here.**

**Also raised by pass 3, `PRE-EXISTING` and advisory:** `readDoNotPerform` is **root-only**, so a
`Bundle` whose `entry[0].resource` is a **conformant** `MedicationRequest` with `doNotPerform: true`
reads `negations: []` and `safeToSummarize: true`, while the _unreadable_ spelling at the same
location **is** reported by this channel. Identical at `05ecc5a`. Pass 3's disposition, adopted: fold
it into the `ServiceRequest` item below rather than opening a second one, since both are the spine's
read scope rather than a report.

**And `FhirSafetyError.message` moves, outside the corpus measurement above**: it now names this
sixth shape, so the string changes for **every** refusal it raises, including the five that already
refused. `locations`, the class and the thrown type are unchanged. Named because the measurement
enumerates readout fields, parse issues, `ValidationIssue`, `valid`, `negations` and both writers,
and a public-observable string that moves outside that set has to be said out loud.

### Measurements

- **Red-at-base 18-of-30**, 30-of-30 at head, derived in a **real `05ecc5a` worktree** with a
  base shim that supplies the new surface with **base's own semantics** (an always-empty channel,
  because base reports nothing), so each test measures behaviour rather than a missing export. The 12
  both-states pins, named: the two conformant spellings `true` / `false`, the absent element, the
  value-less primitive carrying only metadata, the non-MedicationRequest type gate, the conformant
  JSON `MedicationRequest`, this package's own XML round trip, the no-`ValidationIssue` pin, the
  object/empty-array shape, the JSON `null`, the two profile booleans, and the non-boolean datatype.
- **Non-vacuity by mutation, seven of them, each reds at least one pin:** dropping the
  `MedicationRequest` type gate reds 1; stopping `hasUnreadableBoolean` reading through the array
  wrapper reds 2; firing it on a value-less primitive reds 2; dropping the new term from
  `safeToSummarize` reds 13; accepting `"1"` in `booleanOf` reds 1; reading only `node.properties`
  and not the shadowed `duplicates` reds 1; dropping the channel from `assertSafeToSummarize`'s
  location list reds 1.
- **Suite 65 files / 1,346 tests** = `#79`'s 1,316 + this file's 30, so **no existing test moved**.
  One existing test was **rewritten rather than added to**: `#79`'s pin _"still affirms
  safeToSummarize over a doNotPerform this reader cannot read"_ looped over `["true", "1"]` and the
  `"1"` arm is what this slice closes, so the pin now covers the `"true"` arm only and names where
  the other half went. That is the pin discipline working, not a test being weakened.
- Verify green: 11 `==>` step headers, 11 `ran:` entries, zero `(FAIL)`, no unladdered-script warning.

### 🛑 RAISED BY PASS 1, OUTSIDE THIS SLICE: `ServiceRequest.doNotPerform` IS NOT READ AT ALL

`PRE-EXISTING`, identical at `05ecc5a`, so it did not block. **It is a sharper shape than the item
this slice closed**, and it needs its own item.

R4 marks `ServiceRequest.doNotPerform` (and `CommunicationRequest.doNotPerform`) a `?!` **boolean
modifier element**, exactly as `MedicationRequest.doNotPerform` is. `readSafety` gates the read on
`isType("MedicationRequest")` and `ServiceRequest` is not in `SAFETY_RESOURCE_TYPES`, so a
**conformant JSON** `{"resourceType":"ServiceRequest","doNotPerform":true}` reads `negations: []`,
`unreadableBooleans: []`, `safeToSummarize: true`, `assertSafeToSummarize` clean. **This one is not
an unreadable value: the document is conformant and the instruction is simply not looked for.**

**Do not fold it into a channel slice.** The remedy is a question about the spine's type scope
(`SAFETY_RESOURCE_TYPES` and `NegationKind`), not about a report, and widening the spine touches
every type-gated read at once.

### Corpus caveat

Hand-authored XML and JSON fixtures, mutations and hand-built probes, **not** the FHIR R4
published-examples corpus. Nothing here is corpus-wide.

## Narrative: The negation read was blind by scope (2026-08-09): STOP-THE-LINE

Relocated narrative for the `agent-notes.md` section of the same name. Base commit `f0289a2`.

### What was measured, before anything was changed

Plain conformant JSON. No XML, no round trip, no value outside a datatype's lexical space.

```
{"resourceType":"MedicationRequest",   "doNotPerform":true}  ->  negations: ["do-not-perform"]
{"resourceType":"ServiceRequest",      "doNotPerform":true}  ->  negations: []  safeToSummarize: true
{"resourceType":"CommunicationRequest","doNotPerform":true}  ->  negations: []  safeToSummarize: true
```

`assertSafeToSummarize` clean on all three. **That is what makes this one sharper than the two
before it**: the first needed the XML round trip, the second needed `value="1"`. This needed neither.

The unreadable twin measured the same way, and the asymmetry is the finding:

```
{"resourceType":"ServiceRequest","doNotPerform":"1"}  ->  unreadableBooleans: []   safeToSummarize: true
{"resourceType":"MedicationRequest","doNotPerform":"1"} -> unreadableBooleans: [.] safeToSummarize: false
Bundle.entry[0].resource = MedicationRequest doNotPerform:true  ->  negations: []
Bundle.entry[0].resource = MedicationRequest doNotPerform:"1"   ->  reported at that exact location
```

**The library was strictly more honest about a value it could not read than about one it could.**

### Why the gate was DROPPED and not WIDENED

The tempting fix is `DO_NOT_PERFORM_TYPES = {MedicationRequest, ServiceRequest,
CommunicationRequest, ...}`. **It is the same mechanism that produced the defect.** A type gate does
not merely fail to *read* the types it omits: nothing looks at them, so nothing is *reported* for
them either, and a gate is a list of the types somebody remembered. A fifth type reproduces the whole
finding, silently, and the census would have to be re-grounded every R4 reading.

**What licenses dropping it is the DIRECTION, not a census of R4.** This read can only ADD the
`do-not-perform` negation. It can never retire a finding, never flip `valid`, never turn a refusal
into an affirmation. So a type nobody enumerated costs a caller a negation it can ignore, where a
type nobody enumerated *under a gate* costs a patient an instruction not to give a medication. This
is the same asymmetry `CLAUDE.md` already records for `isRetracted` and the `refuted` read, and it is
**the exact opposite** of `noKnownAllergy`, which asserts something *positive* about a patient and
therefore stays type-gated. Un-gating that one would claim "no known allergy" over a `Condition` that
merely carries SNOMED `716186003`. Both directions are pinned in the new test.

**Do not reason from "no conformant document reaches it".** That is a universal over R4 and this repo
has been refuted three times for exactly that shape of sentence. The argument above needs no such
claim, and the one place a universal would be load-bearing (the refusal half, which *can* flip
`safeToSummarize` to `false`) is answered narrowly instead: a type that defines no `doNotPerform`
makes the document non-conformant *by writing the element at all*, so declining to affirm over it is
the fail-safe direction rather than a false error.

### The two halves are ONE function, and that is the design

`checkDoNotPerform` does the read and its complement in one pass at one window. The predecessor
(`checkUnreadableBooleans`) carried the docblock "the element name is type-gated the way the read
is" - a sentence that was true only as long as somebody kept it true by hand. **Widen the read
without the report and `<doNotPerform value="1"/>` on a `ServiceRequest` is exactly as invisible as
`value="true"` was before this slice**: the previous STOP-THE-LINE, reproduced on a new type by the
fix to this one. Structure beats the sentence: they cannot drift now.

### Axis 2 in one line

The negation comes from the walk (`SafetyWalk.doNotPerform`), which visits the entry node **plus
every node carrying its own `resourceType`** - the same window `checkArrayWrapping` and the
unreadable report already use. `readDoNotPerform` stays the root read behind the **convenience**
field, exactly as `status` beside it is root-only. **`readSafety(bundle).doNotPerform` is therefore
`undefined` while `negations` holds `do-not-perform`, on purpose**; the readout's own contract says
branch on `negations`.

**`safeToSummarize` does NOT move for a value that IS read**, and that is not an oversight: the
refusal channel is for values this library cannot read. Reading it and surfacing it loses nothing.

### Declared, NOT folded in - each its own slice

- **`not-done` is also a `Procedure` / `MedicationAdministration` status in R4**, and both read
  `negations: []` today. Same class, different element; each status gate needs its own grounding of
  which types carry that code. Pinned in both states.
  **CLOSED 2026-08-09** by the next slice, which did that grounding: an R4 census, not this slice's
  direction argument, which does not transfer to a status *code*:
  [the negation status codes narrative](#narrative-the-not-done--not-taken-type-gates-were-dropped-after-a-census-2026-08-09).
- **Every negation except `doNotPerform` is still root-only.** A retracted `Observation` inside a
  `Bundle.entry` leaves the Bundle's `negations` empty. Pinned.
  **CLOSED 2026-08-09** by the slice after next, on FHIR's `?!` modifier rule rather than on this
  slice's direction argument alone: [the negation depth narrative](#narrative-every-negation-reaches-every-resource-root-2026-08-09).
  `no-known-allergy` stays root-scoped there, and that is now the declared residual.
- **The array-wrapper report keeps its cardinality table.** `{"resourceType":"ServiceRequest",
  "doNotPerform":[true]}` is now read through the wrapper and the negation surfaced, but the wrapper
  itself draws no `ARRAY_WRAPPED_SCALAR`, because reporting one is an `error` and that stays where a
  cardinality is known. Strictly better than base (which surfaced nothing), and pinned as a residual.
- **Scope stops at resource roots**, not backbone elements: `MedicationRequest.dosageInstruction[0]
  .doNotPerform` reads nothing. Pinned.

### The count, and the sweep

`status.ts` (x3, not the x2 the item named), `codes.ts`, `validate/safety.ts` (x2),
`validate/validate.ts`, `test/validate-safety.test.ts` and `README.md` all said **"the six safety
resource types"** over a set holding **seven**, and copies of it rendered into `dist/index.d.ts` and
`dist/index.d.cts` (**0 at head**). **Cut, not corrected to "seven"** - a number written down here was wrong for days
and the next reader does not re-check. **And do not write the CARRIER count down either. FOUR attempts, four different
answers, every one of them defended at the time**: "8" tracked sites, then "3" dist occurrences,
then the gate's "6" reasoned from the export list, then a measured "5" - and pass 3 showed that last
one low too, because the grep that produced it could not match a phrase the JSDoc had wrapped.
**THE COUNT IS NOT WRITTEN HERE, AND THAT IS THE WHOLE FINDING.** The only number that survives is
**0 at head**, checked wrap-tolerantly in both declaration files. **Grep wrap-tolerantly or do not
grep**: normalise newlines AND the JSDoc ` * ` continuation before matching, or the phrase that
wraps mid-sentence reads as absent, which is fail-open and is exactly the defect the count exists to
catch. That is how `README.md`'s copy hid from the first sweep.

**Four carriers beyond the sites the item named. The sweep found two; THE GATE FOUND THE OTHER TWO,
AND THEY WERE THE WORSE PAIR.** The sweep found the live `CHANGELOG.md` `[Unreleased]` entry and the
**pending changeset** `.changeset/olive-herons-report.md`, both saying the read's element is
`MedicationRequest.doNotPerform`; both are unreleased prose describing today's behaviour, so both
were corrected rather than preserved. **What the sweep missed is the pair the fix itself falsified**:
the JSDoc on the **exported** `unreadableBooleans` (which renders into `dist/index.d.ts`) and the
same paragraph on `README.md`, the npm front page, each stating that the report window is
*deliberately wider than the read* - true at base, false the moment the read widened, and a direct
contradiction of `CLAUDE.md`'s own "the read window and the report window must be the same window".
**The lesson is sharper than "sweep wider": grep for the sentences your change makes FALSE, not only
for the sentence the item quoted.** A file being edited by the slice is no protection - `README.md`
was edited, 200 lines above the stale paragraph. Both were CUT, not qualified. The historical `CHANGELOG.md` release entry for the Phase-3 layer is
left alone: it *enumerates* its six groups and is true at its own site.

### Measurement

- **Red at base: 15 of 23** new assertions, in a real detached base worktree at `f0289a2`; **23 of 23
  at head.** The 8 that pass in both states are deliberate pins, named **in the test file itself**,
  five under their own `describe` and three commented in place: the
  `MedicationRequest` pair that already worked (the control that says nothing broke), the negation
  ordering, the absent element, `noKnownAllergy`'s gate, the status-code gates, the root-scoped
  convenience fields, and the backbone-element boundary. (That sixth pin read "the other negations
  are root-only" until the slice that closed it re-keyed it; the re-key is recorded in the test.)
- **Non-vacuity by mutation, 7 of 7 red at least one test:** re-gate the root read (5); re-gate the
  walk (10); gate **only** the report half, i.e. the drift this design forbids (2); undo axis 2 (5);
  negate on a written `false` (1); run the check past resource roots (1); make the convenience field
  deep (3).
- **Suite: 65 files / 1,346 tests at base -> 66 / 1,369 at head**, and 1,369 - 1,346 = 23 is exactly
  the new file, so **no existing test moved** except the two characterization pins over the type gate
  (`xml-lexical-boolean.test.ts`, `xml-unreadable-boolean.test.ts`), which this closes and therefore
  rewrites. Closing a pinned gap MUST red its pin, and both did.
- **`verify.sh fhir` green**, `ran:` audited at 11 steps (`licenses typecheck lint format:check
  phi-scan check:no-emdash check:no-internal-refs test:coverage build attw`) with zero `(FAIL)`.
  `pnpm differential:read`: **0 readings moved, 0 regressions.**
- Corpus caveat, as on every slice here: hand-authored JSON/XML fixtures, mutations and hand-built
  probes, **not** the R4 published-examples corpus.

---

## The case/whitespace gap: DISCLOSE, DO NOT NORMALISE (2026-08-09)

Base commit `fa5bfd8`. The last residual `#82` filed against this arc, and the one that needed a
direction call before it could be built at all, because **the behaviour it complains about is
spec-correct.**

### 🛑 THE TRAP, AND IT IS THE ONE A FUTURE READER WILL WANT TO BREAK

**Never coerce, trim or case-fold a value into a negation code.** `isNearMissCode` decides a
**diagnostic**, never a reading; it is asked only *after* the exact match has already failed, and
nothing anywhere turns the value it describes into the code it resembles. Making the read tolerant
would be the **laundering class this package refuses everywhere else**: a non-conformant document
accepted as though it were conformant, and a negation handed to a caller that its sender never
spelled. Fix at the READ, never the reader. The sibling precedents are `x12`, which leaves
whitespace-only control numbers padded **by design** because "trimming is a normalisation rule and no
source states one", and `dicom`, which ships **a disclosure, not a bound**.

**The silence was the defect. The strictness is not, and must not be "finished".**

### The census WAS the slice, and the filed line understated the class again

The item named `"NOT-DONE"`, `" not-done"` and `entered-in-error`. Measured over the codes derived
from `src/`, at every element and every resource root each is read at, every case variant and every
surrounding-whitespace form was **SILENT** - no negation, `safeToSummarize: true`, nothing on any
channel. So the class was every `?!`-modifier-element negation code this layer classifies, on
`status` **and** on a `verificationStatus` coding, at the entry root, in `Bundle.entry` and in
`contained`, over space / tab / LF / CR / leading / trailing / both / any case.

**One axis does not exist and inventing it would be wrong:** SNOMED `716186003` is digits, so case
cannot vary it at all. Derive the codes from `src/`; never write the set down.

### 🛑 THE CLAIM THAT WOULD HAVE BEEN FALSE, in `#83`'s "understating" direction

**`do-not-perform`, the one BOOLEAN negation, ALREADY had this disclosure.** `<doNotPerform
value="TRUE"/>` and `value=" true"` have landed on `unreadableBooleans` under
`safeToSummarize: false` since that channel shipped. So *"this is the first time the package records
a negation value it declined"* is **false**, and it is false in the flattering-to-caution direction
that `#83` pass 1 was refuted for. The true, narrower claim is the one shipped: **the `code`-valued
reads had no complement; the boolean one did.** Pinned in both states in the test file so the claim
cannot drift back.

### Why the two halves are not the same shape, stated rather than blurred

The `unreadableBooleans` channel is about a value that could not be read **at all** - `doNotPerform`
reads `undefined`, which is what an absent element reads too. This one is about a value that **is**
read and **is** surfaced on `status` / `verificationStatus` unchanged; what fails is the
**classification**. Nothing is lost. Do not describe it as a data loss, and do not fold it into the
module docblock's "shapes FHIR does not define" - it is not one of them. (That docblock's count was
removed 2026-08-10 when a further encoding joined the list; derive the set, never cite a number.)

### ⚖️ `no-known-allergy` is OUTSIDE the disclosure, and the reason is architectural, not timidity

`AllergyIntolerance.code` is deliberately absent from `NEGATION_CODE_READS`. Adding it would put a
near-miss disclosure at **every resource root** while an *exact* SNOMED `716186003` at a nested root
is read by **nothing at all** - so the library would **report the miss more loudly than the hit**.
That is the same boundary that keeps `no-known-allergy` off the walk: it is a *positive* assertion,
the one negation whose surfacing can make a caller **less** careful, where an absent one reads as
*unknown*. Pinned in both directions. **Do not "finish the job" by adding it.**

### Read scope and report scope are the same scope BECAUSE THEY ARE THE SAME TABLE

`NEGATION_CODE_READS` holds the element, the codes matched exactly on it, **and the reader** - the
same `primitiveStrings` / `safetyCodingsOf` the matches themselves go through. The disclosure is
derived from it, inside `checkNegations`, so it inherits that function's window by construction
rather than by a second copy of the condition. A test iterates the table and asserts of every entry
that the exact code **is** classified there, so the table cannot drift into describing a read that is
not there.

**Whitespace is R4's own four-character class (`[^\s]+(\s[^\s]+)*`, XML Schema's `\s`), NOT
JavaScript's.** A no-break space and a byte-order mark are ordinary characters inside a conformant
`code`, so trimming one would call a value non-conformant that R4 accepts. Pinned in both states, and
widening it to `/\s/` reds a test.

### 🛑 PASS 1 REFUTED IT, and the finding was a FALSE POSITIVE ON A CONFORMANT DOCUMENT

The gate's sharpest finding was **not** a claim defect but a behavioural one, and it is the shape to
remember: **R4 permits TRANSLATION CODINGS beside the one a required binding's value set supplies**
(`terminologies.html`: at least one Coding SHALL be from the value set, "text can be provided as
well", additional codings permitted). So

```json
{"resourceType":"Condition","verificationStatus":{"coding":[
  {"system":"http://terminology.hl7.org/CodeSystem/condition-ver-status","code":"refuted"},
  {"system":"http://acme.example.org/legacy","code":"REFUTED"}]}}
```

is **conformant**, its negation **is** classified, and the first draft disclosed anyway and set
`safeToSummarize: false`. **A disclosure channel that fires on a document the library read correctly
and completely is a false positive, and it falsified the shipped sentence "Empty for every conformant
document".**

Closed by suppressing a near miss of code C at element E **where E also spells C exactly**. **Per
CODE, never per element** - `refuted` exact beside `ENTERED-IN-ERROR` must still report, because
nothing classified the retraction. Both directions are pinned, and both a per-element suppression and
no suppression at all red a test.

**The control that missed it exercised SINGLE-CODING conformant documents only**, so it discriminated
a narrower claim than the one shipped - the same shape `#82` pass 1 was refuted for. The both-states
control now carries the multi-coding document.

### 🛑 THE OTHER TWO PASS-1 MAJORS WERE BOTH CLAIMS IN THE REASSURING DIRECTION

**1. "the value is not lost, it is surfaced on `status` / `verificationStatus` exactly as written"
was FALSE three ways**, and it was the load-bearing sentence justifying treating this channel
differently from the loss channels. `status` and `verificationStatus` are **root-scoped and
preferred-system-first**; this channel is **document-wide**. So a near miss in `contained` leaves
`status` showing the ROOT's value (measured: `"active"` while the near miss was `"NOT-DONE"` one
level down), a nested one in a `Bundle.entry` leaves it `undefined`, and a second-coding near miss is
not the code `verificationStatus` shows. **The true claim is narrower: the codec KEPT the value, at
the element the location names. Walk the model there. It is not a promise the value reaches a
convenience field.** Corrected in `status.ts` (x3), `README.md`, `CHANGELOG.md`, the changeset and
this note.

**2. The `code` lexical-space argument is JSON-ONLY and was stated for "either wire format".** R4
derives `code` **in XML** from `xs:token` (`fhir-base.xsd`, `code-primitive`), and `xs:token` carries
`whiteSpace=collapse`, which strips surrounding whitespace **before** validation - so
`<status value=" not-done"/>` is schema-valid R4 and **is** the code for a schema-validating
consumer. Independently, XML 1.0 §3.3.3 attribute-value normalization turns a literal tab/LF/CR in
any attribute value into a space for every conformant processor. **This reader is schema-free and
does not collapse**, so it discloses rather than reads: fail-safe, and now a **declared limit** in
every carrier rather than a conformance claim. **Do not "fix" this by collapsing in the XML reader** -
that is the normalisation the whole slice refuses.

Minor, also corrected: the regex was quoted as `[^\s]+([\s][^\s]+)*` where R4 spells it
`[^\s]+(\s[^\s]+)*` (equivalent, but it was cited as verbatim, in ~7 carriers including
`dist/index.d.ts`); and the first remedy for `#83`'s stale channel enumeration **reversed `#83` pass
1's own fix** (naming the set WAS that fix), so the falsifiable clause was **deleted outright** from
both `CHANGELOG.md` and the pending changeset instead.

### Pass 2: NOT REFUTED, and the two minors it still found were both mine

Graded the remedy diff only. All six pass-1 findings confirmed closed, the suppression invariant
`suppressed(C at E) => C in negations` verified by brute force over 1,200 generated documents with
**0 violations**, and the note's red-at-base figures reproduced to the test.

Its two `INTRODUCED` minors, both corrected here and both the same shape as everything else in this
arc: **an absolute claim.** *"Empty for every conformant document read from JSON"* shipped in five
carriers while **the slice's own new test pinned a counterexample** - a `verificationStatus` carrying
`confirmed` from the standard system beside a local `REFUTED`. That satisfies `terminologies.html`
§4.1.5.1 (one coding SHALL come from the value set) and is non-conformant only under
`datatypes.html`'s descriptive "each coding is a representation of the concept", which carries **no
SHALL**. **The remedy used the permissive reading to justify the suppression and then asserted a
claim that survives only under the restrictive one.** The sentence is now qualified in all five
carriers; the guard was **not** grown, because over-disclosure is the fail-safe direction. The other
minor was a stale count in this file, in a paragraph the remedy itself re-counted.

**"FHIR `code` is case-sensitive" is imprecise and is deliberately left**: R4 says codes are case
sensitive *unless the code system specifies otherwise*. It bites only for a `Coding` from a caller's
own case-insensitive `CodeSystem`, and correcting it would push toward the coercion the direction
forbids.

### Passes 3 and 4: NOT REFUTED, and both found only my own prose

**Pass 3** caught the qualification added for pass 2 being **one notch WIDER than the truth, in the
cautious direction**: it admitted "a translation whose code *near-misses* a negation" as conformant,
but a near miss is case **or** surrounding whitespace, and the whitespace half is never conformant
JSON. **Only the case half can be.** Narrowed at all five carriers. **That is the understating shape
again** - the third time in this arc a claim erred toward caution and was still false.

It also caught the same edit leaving **unmatched `**` closers**: the rendered `CHANGELOG.md` entry
carried three stray literal asterisks and **lost the bold on the `do-not-perform` sentence**, and
`status.ts` carried one that ships verbatim into `dist/index.d.ts` / `.d.cts` and so into a
consumer's hover. **Prettier had ESCAPED one closer to `disclosure\*\*`, which is exactly why
`format:check` passed.** 🩺 **Nothing in CI reads rendered markdown, so the next such residue will
also ship.** Repaired with real openers, never another escape.

**Pass 4** (the cap) confirmed both closed at source **and in the built `dist/index.d.*`**, verified
the transpile byte-identical across the remedy, and exercised the narrowed claim against the built
library: every conformant-JSON firing observed is the case-only translation coding, and
`"refu ted"`, `"not- done"` and an NBSP-padded code are all conformant and all silent. The anchored
`CODE_WHITESPACE` is what stops internal whitespace manufacturing a second firing shape.

### 🔴 `PRE-EXISTING`, raised by the gate, filed not absorbed

**The XML reader performs no XML 1.0 §3.3.3 attribute-value normalization.**
`<status value="&#x9;not-done"/>` and a literal tab both reach the model as `"\tnot-done"`.
Unchanged at base, unchanged here, and its own item.

**`fhir/CLAUDE.md` still says "Two refuter passes max ... **No fourth** (ADR 0016)"**, which
contradicts the founder-settled cap of **FOUR** (2026-08-09). Not corrected here: that file is at
**exactly 28,000 / 28,000** and any edit moves the ratchet. Its own item.

**The BOOLEAN channel carries the identical un-scoped claim this slice just retired for `code`.**
`unreadableBooleans` says *"Empty for every conformant document, in either wire format"*
(`src/safety/status.ts`, shipped in `dist/index.d.*`) and `README.md` says it *"cannot fire on a
conformant document in either wire format"*. But `fhir-base.xsd` restricts `boolean-primitive` to
`xs:boolean`, whose `whiteSpace=collapse` facet is applied **before** the pattern, so
`<doNotPerform value=" true"/>` is schema-valid R4 XML and lands on `unreadableBooleans` under
`safeToSummarize: false`. **Verbatim at `fa5bfd8`, so it cannot gate this slice**, and the direction
is over-disclosure rather than a mis-read. Its own item; **do not fold it in.**

### 🛑 Measurement, and the shape of the count that was ALMOST published

**32 of 40 red at base**, in a real detached base worktree at `fa5bfd8`; 41/41 at head (the 41st is a
direct unit pin on the predicate, base-independent). **Of those 32, six are red only because the
symbol or channel they name does not exist at base** (the two table-integrity tests, the three
head-only channel-name pins, and the suppression case, whose base behaviour already matched), so
**26 of 40 are red for a behavioural difference.** Reported that way on purpose.

**The first draft of this test file measured 31 of 35, and that figure was wrong in the flattering
direction** - the both-states pins were written as `expect(...nearMissNegationCodes).toEqual([])`,
which goes red at base for the trivial reason that the field reads `undefined`, pinning **nothing**.
They were rewritten onto `safeToSummarize` and `negations`, which both states have and which are
`true` / empty only if the channel is empty. **A both-states pin asserted through a field the base
commit does not have is not a both-states pin.** This is the second time in this arc a count
overstated what was held down; the remedy both times was to restructure the tests, not the prose.

**8 both-states pins, named in the test file** under their own `describe` with the reason written
there: the non-negation padded code, the not-quite-a-negation value, the R4-vs-JS whitespace set,
every conformant document, the backbone-element boundary, `no-known-allergy`'s two directions, the
boolean negation's existing channel, and `valid` not moving.

**Non-vacuity by mutation - what is held down, named, never a total:** widen the whitespace set to
JavaScript's `\s`; drop the case fold; drop the whitespace strip; drop the exact-value guard so an
exact code also reports; remove the channel from `safeToSummarize`; remove it from
`assertSafeToSummarize`'s refusal; narrow the disclosure to the entry root; drop `verificationStatus`
from the table; narrow the `status` reader to one value so a wrapper and a shadowed member are
missed; add `AllergyIntolerance.code` to the table; remove the per-code suppression so a conformant
translated coding fires; widen that suppression to per element so a different code's near miss is
hidden. **Every one reddened at least one test; none survived.**

**One SURVIVED after the pass-1 remedy and was closed rather than explained away.** The per-code
suppression made the predicate's own `folded !== value` guard redundant *at its call site*: a value
equal to the code is a value the element spells exactly, so it is suppressed regardless. The guard
stays, because it is what the word "near" means, and it is now pinned by a direct unit test on
`isNearMissCode` instead of by a document. **A guard nothing checks is a guard that rots.**

**Negative control is DEGENERATE here and is reported as such**: `@cosyte/hl7` provides **0 of the 13
symbols** this file imports, so every assertion in it fails at import for a reason that discriminates
nothing about behaviour. The red-at-base fraction and the mutations are the real evidence. Do not
quote an hl7 control on this repo as though it graded anything.

**Corpus caveat:** hand-authored fixtures, mutations and probes - **not** the R4 published-examples
corpus.

### Residual raised by the work, filed not absorbed

`{"resourceType":"Procedure","status":["NOT-DONE"]}` gets the near-miss location but **no
`ARRAY_WRAPPED_SCALAR`**, because `arrayWrappedScalars` is scoped to a cardinality table on the
safety resource types and `Procedure` is not one. Unchanged at both states, already filed against the
array-wrapper rule by `#82`. Head is **strictly better** than base there, not complete. Pinned.

## Narrative: The `not-done` / `not-taken` type gates were dropped, after a census (2026-08-09)

Relocated narrative for the `agent-notes.md` section of the same name. Base commit `f8d7213`, the
head of the slice that dropped the `doNotPerform` type gate
([the negation read scope narrative](#narrative-the-negation-read-was-blind-by-scope-2026-08-09-stop-the-line)). Closes the first of that slice's declared
residuals.

### What was measured, before anything was changed

Plain conformant JSON, on the base commit:

```
{"resourceType":"Immunization",            "status":"not-done"}  ->  negations: ["not-done"]
{"resourceType":"Procedure",               "status":"not-done"}  ->  negations: []  safeToSummarize: true
{"resourceType":"Communication",           "status":"not-done"}  ->  negations: []  safeToSummarize: true
{"resourceType":"Media",                   "status":"not-done"}  ->  negations: []  safeToSummarize: true
{"resourceType":"MedicationAdministration","status":"not-done"}  ->  negations: []  safeToSummarize: true
{"resourceType":"MedicationAdministration","status":"not-taken"} ->  negations: []  safeToSummarize: true
```

Every one of the four blind rows is a **conformant R4 document**: `not-done` is in the required
value set bound to that resource's `status`. A procedure recorded as **not performed** read as a
procedure with nothing to say about it, under an affirmative `safeToSummarize`.

### 🛑 The argument that licensed the previous drop DOES NOT TRANSFER, and that was the whole slice

`doNotPerform` is an **element**. No R4 type defines it as anything but an instruction not to act, so
reading it on a type nobody enumerated cannot mis-read it, and the direction alone (a read that can
only **add** a negation) licenses dropping the gate.

`not-done` is a **value of `status`**: one element name whose value set R4 defines **per resource
type**. "Which types carry this code" is therefore a real question with a real answer, and the
direction argument answers a different one. So the gate was not dropped by analogy. It was dropped
after a census, and the census is what the drop rests on.

### The census, and how to re-run it

Source: the published R4 definitions, `hl7.org/fhir/R4/valuesets.json` (sha256
`8d8fd0894624163296aa84e93c47cbead9b805fd83ec22ac71d45b7e25a86758`) and
`profiles-resources.json` (sha256
`d062516a420265da6d248e1d2b5d2a4aa9709c3c637807fe48e278054dffa114`), `fhirVersion` **4.0.1**. Method:
every `CodeSystem` in the bundle whose concept tree defines the code, then every element in every
resource `StructureDefinition` whose binding names a value set that includes it (following
`compose.include`, whole-system includes and nested `valueSet` references).

| | `not-done` | `not-taken` |
|---|---|---|
| R4 code systems defining it | `event-status`, `medication-admin-status` | `medication-statement-status` |
| R4 elements bound to a value set containing it | `Procedure.status`, `Communication.status`, `Media.status`, `MedicationAdministration.status`, `Immunization.status` | `MedicationStatement.status` |
| binding strength / cardinality | `required`, `1..1`, every one | `required`, `1..1` |
| what this library read | `Immunization` only | `MedicationStatement` only |

Three facts came out of it, and together they are the licence:

1. **Each code is spelled only as a `status` value.** No R4 element outside `status` binds a value
   set containing either code, so a wider read cannot meet the code doing a different job elsewhere.
2. **Every code system that defines the code defines it as the negation**: "terminated prior to any
   activity beyond preparation" (`event-status`), "terminated prior to any impact on the subject"
   (`medication-admin-status`), "the medication was not consumed by the patient"
   (`medication-statement-status`). So reading the code on a type nobody enumerated cannot *mis*-read
   it; it can only surface it somewhere a census did not predict.
3. **A gate is short, and version-scoped.** R4 carries `not-done` on five types where this library
   read one. The same census against R5 (`5.0.0`) returns a different set again: it adds
   `ClinicalImpression`, `NutritionIntake` and `DeviceUsage`, has no `Media` resource at all, and
   **drops `not-taken` from `MedicationStatement.status` entirely**: on documents a reader with R5
   read-tolerance is still handed. A list keyed to one published version is blind by construction.

Only then does the direction argument apply, exactly as it did to the element: the read can only add
a negation, never retire a finding, and never flip `valid` (nothing in the validator reads
`negations`). A document spelling the code on a type whose value set excludes it is **already
non-conformant**, and the fail-safe move over one is to surface the negation the sender plainly
wrote, not to read the record as live.

**⚠ Two nuances the census turned up, disclosed rather than smoothed over. Both are R5, and both are
why the claim in the code is scoped to R4:**

- R5 defines `not-done` in `consent-state-codes` with the display **"Abandoned"** ("the consent
  development has been terminated prior to completion"). Still not-happened, so still the safe
  direction, but it is the one place where the code's *display* is not a negation on its face.
- **The "only as a `status` value" half is version-scoped too, exactly as the type list is.** In R5,
  `DeviceUsage.usageStatus` binds a value set containing `not-done` and is not named `status`, so it
  is the one element outside `status` that carries the code anywhere in either version. This read
  does not look there, which is an **under**-read (the safe direction, a negation not surfaced rather
  than one invented), and it is stated here rather than left as an implication of an R4-only census.

### `not-taken` is the narrower half, and is reported as such rather than dressed up

The census returns exactly one R4 element for `not-taken`, which is the type the gate already named.
**So the old gate was complete for every conformant document, and dropping it changes nothing on
one.** What it changes is the non-conformant document the item quoted -
`{"resourceType":"MedicationAdministration","status":"not-taken"}`, where R4's conformant spelling is
`not-done`. That is the case this library exists to be honest about: a sender who wrote "not taken"
on a medication administration, and a readout that called the record live.

Dropping it also removes the last reason to keep two mechanisms. The read is now
`codes.ts` `statusSpells`, **the read `isRetracted` already performed for `entered-in-error`** (the
same shape of code, on the same element, at the same root scope), so the three cannot drift apart
over which values of `status` they see.

### Measurement

- **Red-at-base 11 of 22** in a real detached base worktree at `f8d7213`; 22 of 22 at head. **11
  both-states pins**, named in the test file itself rather than in a commit message.
- **Non-vacuity by mutation, stated as WHAT IS PINNED rather than as a total.** Method: mutate one
  real behaviour of the read away, run the whole suite, and require at least one assertion to red.
  Held down this way, each named: the type gate on `not-done` (reds 11); the type gate on `not-taken`
  (2); reading every written member rather than only the first (9); reading through an array wrapper
  (9); the order the two negations are pushed in (1); code equality rather than a prefix match (1);
  the retraction's `status` arm, which is the refactor's cover (25); and **the element scope, which
  needed two rounds and is the reason a total is not the claim here.**
  **🛑 A MUTATION TOTAL OVERSTATES WHAT IT MEASURES, AND DID.** "8 of 8" was published while the
  element-scope assertions used `CodeableConcept` values only: they discriminated a widening through
  the *coding* reader, so the whole primitive widening
  (`["status","code","statusReason","category"]` inside `statusSpells`) passed the entire suite. The
  gate found it. The primitive-shaped twins were added, and the minimal one-token widening
  (`["status","code"]`) now reds. **Name the list, not the count** - the count was wider than the
  thing it measured, which is this repo's recurring error in a new place.
- Suite 66 files / 1,369 tests -> 67 / 1,391: the new file, and **no existing test moved except the
  three characterization pins over the old gate**, which this closes and therefore rewrites.
- Negative control: all 22 assertions **fail** against `@cosyte/hl7`.

### 🛑 Two tests were re-keyed, and the two reasons are DIFFERENT

Both proved the fail-safe type read with a `not-taken` behind a wrapped or duplicated `resourceType`,
and that negation is no longer type-scoped, so neither document grades that mechanism any more. What
each did about it was not the same, and the distinction was got wrong once here before the gate
corrected it:

- `test/xml-array-wrapper.test.ts` was **falsified outright**: it asserted `negations: []` for a
  laundered `<Resource><status value="not-taken"/></Resource>`, which now reads `["not-taken"]`. It
  was red at head, not vacuous.
- `test/array-wrapped-scalar.test.ts` stayed **green**, but its *negation* assertion no longer
  depended on the type read; the `resourceType` and `arrayWrappedScalars` assertions beside it still
  did, so the test was partly hollowed rather than wholly vacated.

Both are re-keyed to `no-known-allergy`, the negation that **is** still type-gated, and both red
again under a `typesOf` reduced to a strict single-value read. Leaving them keyed to a status code
would have left green tests claiming to grade a mechanism they no longer touch, which is the failure
mode this repo has hit from the other direction twice.

### Declared, NOT folded in - each its own slice

- **Still root-only.** `{"resourceType":"Bundle",…,"entry":[{"resource":{"resourceType":"Procedure",
  "status":"not-done"}}]}` leaves the Bundle's `negations` empty, exactly as a nested retraction
  does. Only `doNotPerform` reads at every resource root. Pinned.
  **CLOSED 2026-08-09**, together with the retraction and the refutation:
  [the negation depth narrative](#narrative-every-negation-reaches-every-resource-root-2026-08-09). Its pin here was re-keyed to the
  element-and-root scope, which is what survives.
- **The array-wrapper report keeps its cardinality table.** `{"resourceType":"Procedure","status":
  ["not-done"]}` is read through the wrapper and the negation surfaced, but the wrapper draws no
  `ARRAY_WRAPPED_SCALAR` on a type outside `SAFETY_RESOURCE_TYPES`. Strictly better than base, which
  read nothing and reported nothing. Pinned, with the `Immunization` half as the both-states control.
- **The read is at the resource root, not a backbone element.** `Procedure.performer[0].status`
  reads nothing. Pinned.
- **No value-set validation.** This library surfaces the code; it does not check the code against the
  binding, so it does not *report* `{"resourceType":"Patient","status":"not-done"}` as
  non-conformant, it merely surfaces the negation. Making that a diagnostic needs the per-resource
  model this layer must not grow.
- `PRE-EXISTING`, untouched: `src/safety/codes.ts` still publishes a **set size** into
  `dist/index.d.ts`.

**CORPUS CAVEAT on every zero above:** the fixtures are hand-authored plus mutations and probes, not
the R4 published-examples corpus. The census is over the published R4 *definitions*, which is a
different artifact from a corpus of instances.

## Narrative: Every negation reaches every resource root (2026-08-09)

Base `3fa61aa`, closing the second residual of
[the negation read scope narrative](#narrative-the-negation-read-was-blind-by-scope-2026-08-09-stop-the-line) and the first of
[the negation status codes narrative](#narrative-the-not-done--not-taken-type-gates-were-dropped-after-a-census-2026-08-09): they were the same gap read from two sides.
Item `FHIR-NEGATION-READ-SCOPE-RESIDUALS`.

### The cursor

**Plain conformant JSON, in the container the standard defines for carrying resources:**

```
Bundle{ entry[0].resource = Observation{status:"entered-in-error"} }        -> negations: []
Bundle{ entry[0].resource = Procedure{status:"not-done"} }                  -> negations: []
Bundle{ entry[0].resource = MedicationStatement{status:"not-taken"} }       -> negations: []
Bundle{ entry[0].resource = AllergyIntolerance{verificationStatus refuted}} -> negations: []
Patient{ contained[0] = any of the above }                                  -> negations: []
```

each under `safeToSummarize: true` with `assertSafeToSummarize` clean, while the identical `Bundle`
carrying `doNotPerform: true` returned `negations: ["do-not-perform"]`: `#81` having moved that one
negation onto the walk and left the rest behind on purpose. **A retracted record read as data.**

### 🛑 What licenses reading a NESTED resource is the `?!` RULE, not the depth

The three element NAMES moved here are ones R4 flags `?!` on the types that define them (`status`,
`verificationStatus`, `doNotPerform`; citations on `checkNegations`), and
a consumer may never process a modifier element as if it were absent. **That is a claim about the
NAMES, not about every node the walk hands them.** The window is a property-name test (`resourceType`
is written here), inherited from `checkArrayWrapping`, not a proof that the node is a resource: R4
gives `ExampleScenario.instance` a `resourceType` element of its own. Additive either way, and
declared on the function rather than claimed away. **That obligation attaches to
the resource carrying it, not to the position the resource occupies in a document**: a `Bundle.entry`
order and a `contained` order are resources. Only _then_ does the direction argument apply, exactly
as at the entry root: the read can only ADD a negation, never retire a finding, never flip `valid`.

**Do not restate this as "read deeper is always safe."** It is a rule about which ELEMENTS carry an
obligation, which is why `no-known-allergy` does not move (below).

### 🛑 The read was NOT widened past its refusal, and here the check runs the OTHER WAY

`#81` paid for the rule that a read and its refusal move together. **Check the direction before
assuming you must move both.** Here the location channels that record a value this library could not
read (`droppedText` and `nestedArrays` at every node, `shadowedProperties` at every complex,
`unhandledModifierExtensions` at every property, `arrayWrappedScalars` and `unreadableBooleans` at
every resource root) **already covered at least every location this read moved into**, so the refusal window was and remains no narrower than the read. Nothing needed
widening; what was needed was the evidence, and it is a **pin at one nested location from both
sides**: `<status>not-done</status>` (character data the reader drops, xml.html §2.6.1) is reported
there and adds no negation, and `<status value="not-done"/>` at that same location is read.

**The reads themselves are byte-identical to the ones already performed at the entry root**
(`isRetracted`, `statusSpells`, `safetyHasCodeAnySystem`), called on more nodes rather than
rewritten. So **no document's reading moves; only the set of nodes the reading is applied to.**
`checkArrayWrapping` and `checkNegations` are now reached through one `checkResourceRoot`, so "which
nodes are a resource root" is decided in one place for the report and the reads together.

### 🔴 `no-known-allergy` DELIBERATELY does not move: it is the one whose ABSENCE is cautious

Two independent reasons, and the second is the one that generalises:

1. It is read off `AllergyIntolerance.code`, an element R4 does **not** flag `?!` at all. It is this
   library's own first-class concept, so the modifier rule above does not reach it.
2. **It runs the other way from every negation on the walk.** Surfacing a recorded "no known allergy"
   from somewhere inside a document can make a caller **less** careful about a patient; leaving it
   unsurfaced reads as _unknown_, which is the cautious answer. So the direction argument that
   licenses the others argues **against** this one.

Pinned in both states, so closing it later must red those. It is the same asymmetry the type gate
already encodes, seen from the scope side.

### Root vs document, and it is now a stated contract

**🛑 NAME THE SET. `negations` is not "the only field that covers the document" and a draft of this
slice shipped that universal into `dist/index.d.ts` before the gate cut it.** The readout has **two**
groups, and the line between them is not depth but **whether a value can say where it came from**:

- **Document-wide, and ALREADY WERE:** the location channels `unhandledModifierExtensions`,
  `shadowedProperties`, `arrayWrappedScalars`, `nestedArrays`, `droppedText`, `unreadableBooleans`,
  and the `safeToSummarize` derived from them. They carry FHIRPath locations, so a nested finding has
  an address, and **`assertSafeToSummarize` has always refused over a `Bundle`'s entries.** Untouched
  here: this is exactly why the refusal needed no widening.
- **Single-valued, and therefore root:** `resourceType`, `status`, `clinicalStatus`,
  `verificationStatus`, `doNotPerform`, `retracted`, `noKnownAllergy`. One value cannot say which
  resource it came from. A `Bundle` is not retracted when one of its entries is, so **`retracted`
  implies `entered-in-error` is on `negations`, never the other way round.**

`negations` is the read that crosses the line, and it can because it is a **set with no locations**
in a **fixed order** (`NEGATION_ORDER`): a kind says the same thing once however many resources
assert it, and entry order must not decide the order a caller sees.

### Measurement

- **Red at base: 21 of 32** new test cases, in a real detached base worktree at `3fa61aa`; **32 of 32
  at head.** The 11 both-states pins are named **in the test file**, five under their own `describe`,
  three commented in place, three in the declared-gap section.
- **Non-vacuity by mutation, 9 of 9 red at least one test.** Recorded as WHAT IS HELD DOWN, never as
  a total: the four status/coding reads at the walk's window; the walk window itself (`isRoot` only);
  `retracted` staying the root read; `no-known-allergy` staying off the walk; the fixed kind order;
  the de-duplication; the resource-root boundary (run past it onto every complex); the absence of a
  type gate on the nested read; reading every written member rather than the first.
- **Suite: 67 files / 1,391 tests -> 68 / 1,423**, and 1,423 - 1,391 = 32 is exactly the new file, so
  **no existing test moved**: the two characterization pins over the gap were re-keyed in place, one
  test each.
- **Negative control: all 32 cases fail** against `@cosyte/hl7` 0.0.10 in a separate scratch package.
- **CORPUS CAVEAT on every zero here:** the fixtures are hand-authored plus mutations and probes, not
  the R4 published-examples corpus.

### The sweep, and what it corrected BY DELETION

Sentences the fix **falsified**, not just the sites the item quoted:

- `README.md`: _"`doNotPerform` goes further and is read at any resource root"_: true of one negation
  when written, false as a distinction the moment the others joined it.
- `SafetyReadout`'s docblock: _"`negations` (and `retracted`) are the authoritative safety reads"_:
  the two now answer different questions, so the pairing was cut.
- **The live `CHANGELOG.md` `[Unreleased]` entry AND the pending changeset `tame-pears-shake.md`**,
  both stating a `Procedure` in a `Bundle` entry still leaves `negations` empty. **Corrected by
  DELETING the clause, never by rewording it**: a changeset freezes into `CHANGELOG.md`.
- Verified **0** in `dist/index.d.ts` and `dist/index.d.cts`, grepped wrap-tolerantly (normalise
  newlines and the JSDoc `*` continuation, or a wrapped phrase reads as absent, which is fail-open).

### Declared, NOT folded in: each its own slice

- **`no-known-allergy` stays root-scoped** (above). The residual this slice creates on purpose.
- **The array-wrapper report keeps its cardinality table**, now reachable at one more location: a
  nested `{"resourceType":"Procedure","status":["not-done"]}` surfaces the negation and draws no
  `ARRAY_WRAPPED_SCALAR`. Strictly better than base, which surfaced neither. Pinned, with the
  `Observation` half as the both-states control.
  **Gate pass 1 found the `Coding`-level twin of the same residual** -- **CLOSED 2026-08-10, see
  [the `Coding` wrapper narrative](#narrative-the-coding-wrapper-report-moves-to-the-negation-reads-own-window); the element-level half
  above is still open.** As found: a nested `FamilyMemberHistory` with
  `verificationStatus.coding[0].code: ["refuted"]` reads `negations: ["refuted"]` at head (`[]` at
  base) with `arrayWrappedScalars: []`, because `safetyCodingsOf`'s single-position unwrap now fires
  at a resource root whose type is outside `SAFETY_RESOURCE_TYPES`, where `checkCodingWrapping` does
  not report. Additive only (a negation appears; nothing is retired), same mechanism, one level down.
- **Exact-string matching still drops `"NOT-DONE"` / `" not-done"` silently**, at every window.
  Spec-correct (FHIR `code` is case-sensitive) but a Postel's-Law gap in a SAFETY read. Its own item.
- **The validator's `RETRACTED_RESOURCE` is still root-scoped AND type-gated**
  (`src/validate/safety.ts`), so a retracted entry inside a `Bundle` raises no issue even though the
  readout now classifies it. A different layer and a different contract (an issue is a report, not a
  read); untouched here rather than absorbed.
- `PRE-EXISTING`, raised by gate pass 1 and filed rather than absorbed: **a `status` written as a
  JSON OBJECT was invisible on every channel.** `{"resourceType":"Observation","status":
  {"value":"entered-in-error"},"code":{"text":"x"}}` read `retracted: false`, `negations: []`,
  `safeToSummarize: true`, `valid: true`, zero diagnostics, **identical at `3fa61aa`**. It is another
  of the encodings `src/safety/status.ts` enumerates, and it is what a generic FHIR-XML to JSON
  converter makes of `<status value="entered-in-error"/>`, the same traffic that docblock cites.
  Not `STOP-THE-LINE` (non-conformant input, and the value survives in the model).
  **🟢 CLOSED 2026-08-10**, `documentation/agent-notes.md#narrative-content-written-where-a-code-belongs-is-disclosed-not-read-through`: it draws
  `unreadableNegationCodes` and `safeToSummarize: false`. **`valid: true` is UNCHANGED and stays
  open** - the safety layer was that slice's window and it raised no `ValidationIssue`.
- `PRE-EXISTING`, untouched: `src/safety/codes.ts` still publishes a **set size** into
  `dist/index.d.ts`; and _"the negation read"_ stays **ambiguous** between the walk-scoped `negations`
  and the root-scoped convenience fields wherever it appears unqualified.

### ⚠ Budget

`CLAUDE.md` is at **28,000 / 28,000** and **was not touched**. No trap was needed: its existing
type-gate trap already says _"the read runs at **every resource root**; the convenience field stays
root-scoped like `status`"_ and _"`noKnownAllergy` is the opposite and stays gated"_, both of which
this slice makes true of every negation rather than one. **Do not add a line here to celebrate that.**

## Narrative: Content written where a `code` belongs is disclosed, not read through

`FHIR-NEGATION-READ-SCOPE-RESIDUALS`, base `632f914`. Closes the `PRE-EXISTING` residual `#83` filed
and `#84` carried forward: **a `status` written as a JSON object read `negations: []` /
`safeToSummarize: true` / `valid: true` at both states.**

**This file exists because `documentation/agent-notes.md` had six bytes left of its archive budget
when this slice started, so it could not be appended to.** This is the per-slice tier, which carries
its own budget. `CLAUDE.md` was **not touched**, and the one correction this slice made to
`agent-notes.md` (retracting a now-closed entry) came out **net negative**. No ratchet was raised and
no trap was deleted or reworded to buy room. **The figures themselves are deliberately not written
down here**: derive them from the files, because a number copied into prose here is the one thing
guaranteed to be stale when it is next read.

### What was wrong

At `632f914`, every one of these returned an empty negation list with **no location anywhere**:

```
{"resourceType":"Procedure","status":{"value":"not-done"}}           -> negations: []  safe: true
{"resourceType":"Observation","status":{"value":"entered-in-error"}} -> negations: []  safe: true
{"resourceType":"Procedure","status":[{"value":"not-done"}]}         -> negations: []  safe: true
{"resourceType":"Procedure","status":3}                              -> negations: []  safe: true
```

A `Bundle.entry` and a `contained` resource behaved the same way. `{"value":"not-done"}` is not an
exotic input: it is what a generic converter emits when it carries FHIR **XML**'s `value` attribute
across into JSON as a member, and it is the same class of converter output that motivated the array
wrapper reads already in this layer.

### The licence, and it did not transfer from any predecessor

Four slices, four different licences. `#81` dropped a type gate on **direction**; `#82` needed an
**R4 census** because a status code is not an element; `#83` used the **`?!` modifier rule**; `#84`
was a **decided direction** (disclose, do not normalise) over a value.

**This one is licensed by the ENCODING, and by nothing else.** FHIR JSON spells a `code` as a JSON
string (json.html §2.6.0) and a `CodeableConcept` as an object with `coding` / `text`; those are the
two datatypes a root `status` carries. A shape spellable as **neither** is one no version of FHIR
defines at that position, so descending into `{"value":"not-done"}` to recover the string would
resolve a negation out of an encoding **no specification defines**, and hand a caller an assertion
its sender never spelled in a form the sender could have spelled it. That is the laundering this
package refuses everywhere else, and it is why the remedy is a **disclosure** rather than a read.
**The gap closed is the silence, not the strictness** - the same disposition `#84` took on a value,
applied to a position.

**🩺 The licence was ARRIVED AT TWICE.** The first cut stated it as *"a `code` is a JSON string, so
anything the string read cannot take is unreadable"*, which is a statement about a **reader** rather
than about the **encoding**, and it was wrong for exactly the documents where the encoding is a
`CodeableConcept`. Gate pass 1 refuted it (below). The correct form is about what FHIR can spell at
the position, and only that form survives contact with the published R4 examples.

### The shape / value distinction, which is the whole finding

**Every other question this layer asks is about a WRITTEN VALUE, and a shape is invisible to all of
them.** `hasUnreadableBoolean` asks whether a value the read saw fell outside the boolean lexical
space; `isNearMissCode` asks whether a value spells a code bar its case or its whitespace. **An
object holds no value at all**, so both answer `false` about it, **truthfully**, and the element then
reads exactly like one the sender left out.

That is worth naming as its own shape, because it means the two existing channels were not "missing"
this case through an oversight in their predicates. They were answering a different question
correctly. `hasUnreadableBoolean`'s own docblock **already said so** at base ("It answers about a
value, not about a shape... those shapes are a separate gap"), and this slice does not widen it: an
object at `doNotPerform` still draws nothing, pinned in both states.

### Read and refusal move together, at one window

The trap this lineage paid for is that **a read and its refusal must be one function at one window**,
or widening the read alone reproduces `#80`'s STOP-THE-LINE on the newly-reachable locations.

Here nothing about the **read** widened at all. What was added is the read's **shape complement**,
carried as a third field (`unread`) in the **same `NEGATION_CODE_READS` row** as the reader it
complements, and applied in the **same loop over the same table** that makes the exact matches and
the near-miss disclosure. So the disclosure cannot come to cover an element the classification does
not, nor miss one it does, **by construction rather than by a second copy of a condition**. That is
pinned mechanically (the covered element list is derived from the table in the test, never written
down) rather than described.

**🛑 But "one window" is a claim about the ELEMENT dimension only, and gate pass 1 named the
dimension it does not cover.** Report scope is genuinely *wider* than read scope in the
**resource-type** dimension: the read runs at every root of every type on purpose, and the refusal
initially did too, which is how it reached a `CodeableConcept`-typed `status`. **A derivation over
element names is structurally blind to that**, so the element-name pin is not the guarantee it looks
like. What bounds the refusal now is the datatype-shape question, pinned by conformant fixtures of
the types that exposed it rather than by a derivation.

The window is **every resource root**, inherited from `checkResourceRoot` exactly as `negations`,
`arrayWrappedScalars` and `nearMissNegationCodes` are. No new walk was added.

### 🛑 Gate pass 1's BLOCKER, and it is the shape this lineage keeps producing

The first cut asked **"did the string read take anything?"** and refused where it did not. That
**refuses a conformant document**, because **R4 spells a root `status` a `CodeableConcept` on
`MedicinalProductAuthorization` and `SubstanceSpecification`**, R5 adds more (including a
**mandatory** `DeviceAssociation.status`), and a conformant `CodeableConcept` yields no string to a
`code` read. Reproduced by the gate on the **unmodified HL7-published R4
`medicinalproductauthorization-example.json`**: clean at base, `safeToSummarize: false` at head, with
`assertSafeToSummarize` throwing. That is `#84` pass 1's shape exactly, one slice later.

**Worse than the behaviour was the claim.** The slice had published *"`status` carries no such
hazard: it is a `code` in every version this reader accepts"* into `dist/index.d.ts`, `.d.cts`,
`README.md`, `CHANGELOG.md`, a pending changeset and this note, and had described the reasoning as
*"checked rather than assumed"* when nothing in the diff checked it. **The slice reasoned correctly
about the element it DECLINED (`verificationStatus`) and asserted without checking about the element
it SHIPPED.** That asymmetry is the finding worth keeping.

**Remedy: ask about the SHAPE, not about which reader succeeded.** `{"value":"not-done"}` is
spellable as neither datatype, so nothing was declined there: there was nothing either datatype could
hold. **⚠ The pass-1 remedy phrased that exemption as "a complex carrying `coding`, `text`, `id` or
`extension` is left alone", and THAT PHRASING IS THE PASS-2 DEFECT below** - recorded here only so
the two sections are not read as agreeing. The shipped rule is the one in §"Gate pass 2's finding":
**all** of a complex's members must be ones FHIR spells here for it to be left alone.

**The direction of the scoping is the whole argument, and it does NOT contradict "the type gate was
DROPPED, not widened".** That rule governs a **read**, which can only *add* a negation, so widening
is free. This is a **refusal**, and an ungated refusal flips a conformant document from summarizable
to refused, which is the one direction a fail-safe layer must not move without evidence. The sibling
`checkArrayWrapping` is type-scoped for exactly this reason and says so in its own docblock.

**Converse declared limit, taken knowingly:** a shape **all of whose members** are ones FHIR spells
here is never reported, so a code buried under `{"status":{"coding":{...}}}` at a `Procedure` stays
silent. **One member outside the set is enough to report**, so the limit is narrower than "carries a
`CodeableConcept` member". Pinned as the exact document above, not as the universal.

### ⚖️ `verificationStatus` is deliberately outside it, and the reason is a VERSION

The shape complement of a `CodeableConcept` read is a **primitive** at the element. Applying it would
report `{"resourceType":"Condition","verificationStatus":"refuted"}`.

**`Condition.verificationStatus` IS a `code` in DSTU2**, and this library declares DSTU2
read-tolerance (`documentation/decisions/0004-r4-first-version-strategy.md`). So the same predicate
that reports a non-conformant R4 document reports a **conformant DSTU2** one, and this reader carries
no version discriminator at the point the predicate runs. **That is the `#84` pass-1 shape** (a
disclosure firing on a conformant document, the first behavioural refusal in this lineage), and
taking it on the strength of the R4 half alone would have walked straight into it.

**And unlike the first cut, this is now checked rather than asserted**: DSTU2 `Condition.
verificationStatus` is `code [1..1]` where R4 and R5 spell it `CodeableConcept [0..1]`, confirmed
against the published definitions by the gate.

Filed, not absorbed, and **pinned in both directions**.

### ⚖️ `no-known-allergy` and `AllergyIntolerance.code` stay where they are

Untouched, on purpose, for the reason `#83` recorded: absence there reads as **UNKNOWN, not NONE**,
so surfacing it more widely makes a caller **less** careful. This slice does not "finish the job".

### 🛑 Gate pass 2's finding: the remedy's exemption had the WRONG POLARITY

The pass-1 remedy exempted a complex that carried **any** member of a `CodeableConcept`. So
`{"status":{"id":"s1","value":"not-done"}}` and `{"status":{"value":"not-done","extension":[...]}}`
read as **clean** - and those are the *same* generic-converter output the whole slice is built on,
the converter having carried the primitive's own `id` / `extension` metadata across beside the value.
The item's residual was still open for them, unnamed and unpinned, while `dist/index.d.ts` asserted
that a complex carrying one of those members "is something FHIR spells here".

**Corrected polarity: report when ANY member is outside the set.** A conformant `CodeableConcept` has
**no** member outside it, so the channel stays empty on one whatever else it carries; a converter
output carrying `value` is reported however much legal metadata sits beside it. The empty complex is
reported by its own arm, `ele-1` forbidding an element with no value, children or extension.

**Both polarities are now pinned**, and the wrong one is a named mutation.

### Measurement

Every figure below is derived; the named lists are the claim, and no total stands in for one. **All
of it was re-measured after the pass-2 remedy**, not carried over from either earlier cut.

- **Red at base: 13 of 38** for a **behavioural** difference, in a real **detached base worktree** at
  `632f914`; **43 of 43 at head**.
  - **Five further cases name a symbol the base commit does not have** (`unreadableNegationCodes`,
    `hasUnreadableCode`, the table's `unread` field). They are **skipped, not counted as red**: a pin
    asserted through a symbol the base lacks measures the symbol, not the behaviour. That is `#84`'s
    published self-correction.
  - **The base copy differs from the shipped file in exactly three documented ways** and in nothing
    else: the `disclosed` accessor returns the reading a caller had before the channel existed, two
    base-absent imports are dropped, and the five cases above are `.skip`ped. **Nothing is deleted**,
    and the copy asserts its own case count against the shipped file so the two cannot drift.
    🩺 **Gate pass 2 caught an earlier copy that had silently lost a case**, which is why the count
    is now asserted rather than eyeballed.
- **25 both-states pins, NAMED in the test file itself**, not counted in a total. The conformant
  documents: a plain `status`; a `status` that IS a negation; the value-absent `data-absent-reason`
  sibling; a resource with no `status`; a `CodeableConcept` `verificationStatus`; a
  `verificationStatus` carrying only `text`; a Bundle of conformant entries; **the R4
  `MedicinalProductAuthorization` and `SubstanceSpecification` shapes, whose `status` IS a
  `CodeableConcept`**; a `CodeableConcept` `status` carrying only `text`; one carrying only an
  `extension`; one carrying `coding` beside `id`, `text` and `extension`; **the R5
  `DeviceAssociation` shape**; a `CodeableConcept` `status` inside a Bundle entry; and two conformant
  **XML** shapes, one with `id` + `extension` children beside the value and one with no value at all.
  Plus "reads no deeper than a resource root", "a duplicate key cannot hide a `CodeableConcept`
  member", and the seven declared limits (bare-string `verificationStatus`; bare-string
  `AllergyIntolerance.code`; an object at `doNotPerform`; an object at `clinicalStatus`;
  `validateResource` still `valid: true`; an empty array at `status`; and a code buried under a
  `CodeableConcept` member at a `code`-typed `status`).
- **Non-vacuity by mutation: NONE SURVIVED, and they are named rather than totalled.** Each reddened
  at least one case: ignoring a non-string written value; dropping the value-absent guard so the
  conformant `data-absent-reason` shape reports; not walking the array wrapper; **dropping the
  datatype scoping, which is pass 1's blocker**; **exempting a shape that carries any one legal
  member, which is pass 2's polarity defect**; reading every complex as clean; dropping the
  empty-complex arm; forgetting `text`; forgetting `id` / `extension`; removing the `status` row's
  `unread`; **giving `verificationStatus` the complement the DSTU2 limit declines**; reporting the
  resource root instead of the element; `some` becoming `every`; `safeToSummarize` no longer
  consulting the channel; and `assertSafeToSummarize` no longer consulting it.
- **🩺 One mutation survived an earlier cut and was closed by DELETING THE BRANCH, not by adding a
  test.** Scanning `duplicates` alongside `properties` could not change any answer: a repeated name
  keeps its **first** member in `properties` and puts only later ones in `duplicates`, so every name
  in `duplicates` is present in `properties` too, measured on a document rather than assumed. **Dead
  code**, and an unreachable branch is one no mutation can red and no reader can check. The invariant
  it relied on is now pinned by a test.
- **Suite 70 files / 1,495 tests -> 71 / 1,538.** **The count alone does not establish that no
  existing test moved, and it is not offered as if it did** (gate pass 1's point, and the same shape
  as this repo's own "a scanned-file COUNT cannot detect a sweep that opened nothing"). **Three
  existing test files were edited, named here:** `test/xml-unreadable-boolean.test.ts` (the
  refusal-message string pin, which this slice legitimately extends and therefore rewrites), and
  `test/derived-names.test.ts` and `test/phi-diagnostic-surface.test.ts`, whose collected-location
  lists were extended to include the new channel so it is swept for name echo. No other test file is
  touched, and `git diff 632f914..HEAD -- test/` is the derivation.
- **`differential:read`: 0 readings moved, 0 regressions - and that 0 is VACUOUS BY CONSTRUCTION.**
  The harness prints its own caveat that it cannot distinguish "nothing moved" from "no document in
  the corpus reaches the changed code", and no corpus fixture carries an unspellable shape at
  `status`. Reported as a non-measurement, not as a clean sheet.
- **🩺 The negative control against `@cosyte/hl7` is DEGENERATE and is reported as such.** **0 of the
  9 symbols** this test file names exist on that package, so every assertion would fail for a
  missing-symbol reason and none for a behavioural one. **A control that cannot fail is not a
  control**, and counting it as a pass would repeat a shape this run has already published twice.
- **Corpus caveat:** hand-authored fixtures, mutations and probes. **Not** the R4 published-examples
  corpus - **and pass 1 showed that caveat cutting the other way**: its blocker was visible in the R4
  published-examples corpus this slice does not run, and pass 2 cleared the remedy against the
  published R4 and R5 example corpora. The fixtures added afterwards are hand-authored copies of
  those shapes, not the published files.

### 🛑 Gate pass 4 (the CAP) and the UNGRADED pre-merge edits

**`NOT REFUTED` at pass 4 of 4.** It cleared the behaviour independently: the empty-complex arm is
real and reachable, the corrected polarity holds, `ele-1` is quoted correctly against the published
R4 and R5 `StructureDefinition`s, the old phrasings return **zero** hits across `src/`, `test/`,
`README.md`, `CHANGELOG.md`, all pending changesets and both `dist/index.d.*`, and the pass-3 diff
was **provably behaviour-neutral** (comment-stripped transpile byte-identical).

It left **three minors and two nits, all prose**, and judged the right disposition to be landing
them as a residual rather than spending a fifth pass. **They were fixed instead of filed**, because
each is a sentence the gate itself quoted and gave the true form of, and two of them ship in
`dist/index.d.ts`:

- the exported `unreadableNegationCodes()` docblock omitted the empty-complex arm, and its universal
  was **vacuously wrong** for `{"status":{}}` (zero members, so "all of them legal" holds, yet it
  reports);
- the readout field's defining sentence said the element is "present **and filled in**", which the
  no-member arm contradicts;
- `ele-1` was cited as *the* ground in a way that invites "ele-1 violations at `status` are
  reported", which is **untrue**: `{"id":"s1"}` and `{"coding":[]}` violate it and are deliberately
  left alone;
- this file's own pass-1 narrative still stated the pass-2 wrong polarity as "the Remedy";
- a test comment carried a hard line reference that goes stale on any insertion above it.

**🛑 THESE EDITS ARE UNGRADED, and that is stated rather than glossed.** ADR 0016's cap is four and
it is spent. They are prose only and the **comment-stripped transpile of both changed source files
is byte-identical**, measured, so nothing ungraded is shipping as behaviour. A future reader should
treat these five sentences, and only these, as never having faced a refuter.

### 🔴 Deferred, filed rather than absorbed

1. **`verificationStatus`'s shape complement**, above. Needs a version discriminator or a decision to
   accept reporting conformant DSTU2. Pinned in both directions.
2. **`validateResource` still reports `valid: true`** on every document this channel discloses.
   Raising an issue code needs a window decision of its own (which types, and what the validator
   knows about a datatype with no caller-supplied profile), and the safety layer is this slice's
   window. Pinned as a both-states limit.
3. **An empty array at `status` draws nothing** - no position, so no content the read stepped over.
   Pinned.
4. **The array-wrapped `Procedure.status` still draws no `ARRAY_WRAPPED_SCALAR`**, unchanged from
   `#84`: that report is scoped to the safety resource types at a resource root. A wrapped object now
   draws *this* channel, so the wrapper case is strictly better than base, but the wrapper itself is
   still unreported.
5. `PRE-EXISTING`, untouched: `src/safety/codes.ts` still publishes a **set size** into
   `dist/index.d.ts`; *"the negation read"* remains **ambiguous** between the walk-scoped `negations`
   and the root-scoped convenience field wherever it appears unqualified; the case-sensitivity gap;
   and the historical *"no negation readable at all"* sentence in `CHANGELOG.md`, which stays under
   its explicit *"Measured at the base commit"* framing and is **deliberately left**.

### Process

- **The repo's own `format` script was used**, never a wider glob. `git status` after it showed only
  this slice's own files: no cross-cutting write, which is the failure `#83` recorded.
- **`git add` before believing a gate.** `check:no-emdash` scans `git ls-files`, so it reported OK
  over a new test file it had never opened. Staging first turned it red on seven real em dashes.
  The same run, `check:no-internal-refs` caught an ADR number in a **doc comment**, which compiles
  into `dist/` and renders in a consumer's editor; it was translated at the boundary, not deleted.

## Narrative: An XML-sourced profile's required elements are enforced (`ElementDefinition.min`)

Relocated out of `agent-notes.md` at write time (that file is at its archive budget). The cursor
stays there; this is the whole record.

### The defect, reproduced at `72cdee2` before it was touched

FHIR XML carries every primitive as the text of its `value` attribute (`xml.html` §2.6.1) and this
reader is **schema-free by design**, so `<min value="1"/>` reaches the model as the string `"1"`
where FHIR JSON's `"min": 1` reaches it as a number. `parseMin` matched **only** the number
(`instanceof FhirDecimal`), and a failed match reads as absence.

So an XML-sourced `StructureDefinition` declared its required elements and this library enforced
**none** of them, with nothing on any diagnostic channel to say so. The same profile, spelled the two
ways:

```
snapshot: Observation.subject 1..1, Observation.performer 2..*     instance: neither present

  JSON-sourced profile  -> valid: false   CARDINALITY_MIN @Observation.subject, @Observation.performer
  XML-sourced  profile  -> valid: true    no profile finding of any kind

both readings also carry `information: RESOURCE_NOT_MODELED @Observation`, which is the built-in
schema speaking and is unrelated; an earlier draft said "no finding at all" and was one finding out.
```

**As of 2026-08-25 that third finding is gone**, and its disappearance is as unrelated to this
lineage as its presence was: `MODEL-OBSERVATION-1` put `Observation` in `BUILTIN_SCHEMAS`, so the
type is modeled and the informational note it used to draw is not emitted. The instance in the run
above carries both mandatory elements, so the built-in table adds nothing in its place and the two
profile findings are now the whole list. The asymmetry this note is about is untouched. Reading left
as it was taken, with the correction beside it rather than in it.

**The XML in that run is this package's own `serializeResourceXml` output, read back by its own
`parseResourceXml`.** A caller who changed format inside this library got a profile that had stopped
enforcing anything, and a verdict that moved `valid: false -> true`: a format change **upgrading** a
document's trustworthiness claim, which is the harm shape this lineage was opened for.

**The asymmetry that made it invisible: `max` was fine.** FHIR spells `max` as a *string* in both
formats, so `parseMax` goes through `primitiveString` and reads. Upper bounds enforced, lower bounds
silently not.

### Where the fix went, and why not one layer down

**At `parseMin`, in `src/profiles/structure-definition.ts` - never in the XML reader.** A
schema-free reader cannot know that `value` spells an `unsignedInt` rather than a `code`, and
coercing there turns the text into a number that `serializeResource` then emits as one: **authoring
a value the sender did not spell and laundering it across a format change**, the move `#74` refused
and `#78`/`#79`/`#80` each declined again. Same level as `#79`'s `booleanOf` and `#78`'s
`decimalValue`.

The text recognised is exactly R4's `unsignedInt` lexical space, `[0]|([1-9][0-9]*)`
(datatypes.html), which is the datatype `ElementDefinition.min` declares (elementdefinition.html). No
sign, no leading zero, no whitespace, no decimal point, no exponent: `"+1"`, `"01"`, `"1.0"`, `"1."`,
`" 1"`, `"1 "`, `"1e2"`, `"-1"`, `"one"` and `""` state no bound.

**🩺 `positiveInt` IS A DIFFERENT SPACE AND AN EARLIER DRAFT CITED IT WRONGLY.** R4 publishes
`positiveInt` as `+?[1-9][0-9]*`, a **leading `+` admitted**; gate pass 1 checked it against
`datatypes.html` and caught the citation. `min` is an `unsignedInt`, `+1` states no bound, and the
sentence now names the datatype the element actually declares. (`src/validate/primitives.ts` carries
the same `positiveInt` drift in `PATTERNS`, `PRE-EXISTING` and identical at `72cdee2`; left alone,
because no read in this slice reaches it.)

### 🛑 THE ADDITIVITY GUARANTEE IS AT THE MERGE, NOT AT THE READ. A GATE PASS PAID FOR THAT.

**The first attempt (`0dda6d0`) put it at the read** and excluded `0` from the lexical space,
arguing that a bound of `0` is the only value `mergeElement` could tell from absent. **Gate pass 1
REFUTED that on a measured behavioural counterexample, and it was right.** `mergeElement` is an
unconditional override, not a tighten:

```ts
if (diff.min !== undefined) merged.min = diff.min;   // no comparison against base.min
```

so the retirement is reachable for **any** stated bound below the inherited one, not only for `0`.
Measured in real worktrees, base snapshot `Observation.performer 2..*`, differential stating `min 1`,
instance carrying **one** performer:

| differential | `72cdee2` | `0dda6d0` (refuted) | remedy |
|---|---|---|---|
| XML `<min value="1"/>` | min 2, `CARDINALITY_MIN` | **min 1, no finding** | min 2, `CARDINALITY_MIN` |
| JSON `{"min":"1"}` | min 2, `CARDINALITY_MIN` | **min 1, no finding** | min 2, `CARDINALITY_MIN` |
| JSON `{"min":1}` | min 1, no finding | min 1, no finding | min 2, `CARDINALITY_MIN` |
| XML, no `min` (control) | min 2, `CARDINALITY_MIN` | same | same |
| XML `<min value="0"/>` (control) | min 2, `CARDINALITY_MIN` | same | same |

**Row 2 is what made it a blocker rather than a claim defect.** `{"min":"1"}` is a JSON document, so
that row is an in-format regression on the reference path: base called it non-conformant, the refuted
head called it conformant. The `0` exclusion was not wrong, it was **insufficient**, and six
artifacts (one of them the tarball's `CHANGELOG.md`) asserted the class was impossible by
construction.

**The remedy is the predicate, not the claim.** `mergeElement` now takes the **tighter** of the
inherited and the stated bound:

```ts
if (diff.min !== undefined) merged.min = Math.max(base.min ?? 0, diff.min);
```

**Grounded, not preferred:** a profile derives by *constraining* (profiling.html), so its `min` may
raise the inherited one and may not lower it. A differential stating a smaller bound is an **invalid
profile**, not a relaxation to honour. Taking the maximum is lenient on the malformed profile (it is
not refused, and `generateSnapshot` has no diagnostics channel to report it on) and fail-safe on the
instance.

With the guarantee at the merge, **excluding `0` from the read bought nothing and was dropped**: the
read is now exactly R4's `unsignedInt` space, `[0]|([1-9][0-9]*)`, which is `min`'s own datatype, and
`<min value="0"/>` loads faithfully as `0`. One mechanism, one place.

**▶ Row 3 is a `PRE-EXISTING` defect this remedy closes as a consequence, and that is disclosed
rather than absorbed quietly.** A JSON `{"min": 1}` under an inherited `2` already retired that
`CARDINALITY_MIN` at `72cdee2`. It could not be left standing: the read cannot know the inherited
bound, so the only place to fix the `INTRODUCED` blocker is the merge, and fixing it there fixes both.
The direction is `valid: true -> false`, the fail-safe one.

**▶ 🛑 A CLAMP AGAINST `max` WAS TRIED AND REVERTED. TWO GATE PASSES PAID FOR THIS PARAGRAPH.**

**Pass 2** found the bare `Math.max` composes an unsatisfiable pair. Beneath a base element that is
required, a differential forbidding it with `0..0` gives `min 1` beside `max 0`. `resolveSlices`
reads a descendant's cardinality as an existence expectation and resolves that contradiction toward
*present*, so beneath an `exists` discriminator a `PROFILE_SLICE_UNMATCHED` and a slice
`CARDINALITY_MIN` are lost: 3 errors at `72cdee2`, 1 at `5afc602`. Rated **major, not blocker**,
because every trigger needs an invalid profile and no document is mis-read.

**Pass 3 then refuted the clamp that answered it**, and the counterexample is worse than the defect
it fixed. `Math.min(tightened, effectiveMax)` discards the inherited bound whenever the
differential's own `max` sits below it, so the enforced bound goes DOWN. Measured across all three
trees, base `Observation.performer 2..*`, one performer on the instance:

| differential | `72cdee2` | `5afc602` (bare max) | `e03f179` (clamp) |
|---|---|---|---|
| XML `min 3`, `max 1` | `{2,1}` error | `{3,1}` error | **`{1,1}` no finding** |
| JSON `{min:2,max:"1"}` | `{2,1}` error | `{2,1}` error | **`{1,1}` no finding** |
| XML `min 1`, `max 1` | `{2,1}` error | `{2,1}` error | **`{1,1}` no finding** |
| XML `min 1`, `max *` | `{2,*}` error | `{2,*}` error | `{2,*}` error |
| JSON `{min:1,max:"*"}` | `{1,*}` **no finding** | `{2,*}` error | `{2,*}` error |

The clamp reaches an **ordinary** profile mistake (`1..1` under `2..*`), not only a contradictory
one, and on the pure JSON path. The bare guard loses nothing relative to base on any row.

**▶ ⚖️ SO THE CLAMP WAS REVERTED AND PASS 2's FINDING IS DECLARED OPEN INSTEAD, WHICH IS THIS
REPO'S OWN WRITTEN RULE**: a sub-problem that fails to converge twice gets reverted and declared a
gap, because a pure revert ships no ungraded behaviour and a declared gap is not a claim. Pass 2 and
pass 3 both rated their finding `major` rather than `blocker`, and only an `INTRODUCED` blocker gates
a ship. **The remedy belongs at `resolveSlices`**, which resolves a contradictory cardinality toward
*present* where its own contract says report the slicing `unchecked`, and it is its own slice. Pinned
by `still loses two slice findings when a contradictory profile meets an exists discriminator` (RENAMED AND MOVED: it is now `closes it through a differential and a base, the route the defect was filed at` in `test/profile-slice-contradiction.test.ts`), which
is RED at base and pins the DEFECT rather than the fix: closing it must red that test.

**▶ 🟢 THAT SLICE WAS TAKEN NEXT AND THE PREDICTION HELD**: the remedy went to `resolveSlices`, the
merge was left composing the unsatisfiable pair, and the pin red on the first run. The test named
above no longer exists under that name; it was rewritten as the closure and moved to
`test/profile-slice-contradiction.test.ts`. Everything above this line is the `#86` record and is
left as it was written, except that each quote of the retired test name below carries the same
parenthetical: a reader following the old name would otherwise find nothing.

**▶ 🛑 `max` IS THE MIRROR AND IS DELIBERATELY NOT TAKEN.** `mergeElement` still overlays `max`
verbatim, so a differential stating a **larger** `max` widens an upper bound and retires a
`CARDINALITY_MAX`. It is left standing because **no read feeding it moved**: FHIR spells `max` as a
string in both formats, so `parseMax` read it from XML at base too, and tightening it would be a
change to the JSON path with no defect in this slice forcing it. Pinned by a characterization test.

### The consumer census, done before the widening rather than after

Six sites read `ElementDefinition.min`; `define-profile.ts` is the authoring path (its `min` is a
caller's JS number, never a node) and `validate/validate.ts:277` reads the built-in Phase-2 schema,
a different type, so neither is a consumer of this read.

**🛑 THE QUESTION THE FIRST CENSUS ASKED WAS THE WRONG ONE**, and it is the standing "additivity is a
property of the CONSUMERS" trap hit at the one consumer that matters. It asked *can `0` differ from
absent?*; what governs additivity is *can any newly-read value differ from absent in a
finding-retiring direction?*

| site | what it does with `min` | can a newly-read value retire a finding? |
|---|---|---|
| `validate-profile.ts:150` | element `CARDINALITY_MIN` | no (`min >= 1`, and a larger bound only adds) |
| `validate-profile.ts:222` | slice `CARDINALITY_MIN` | no (same) |
| `slicing.ts:108` | builds an `exists` expectation | no (`min >= 1`; see below) |
| `slicing.ts:117` | copies it onto `SliceDefinition` | no (only 222 reads it) |
| `snapshot.ts:63` | `mergeElement` overlay | **YES at `0dda6d0`, for ANY bound below the inherited one. Guarded in the remedy.** |
| `structure-definition.ts:325` | writes it onto the model | it is the write |

**`slicing.ts:108` is the second consumer and it is worth knowing about.** `discriminatorHolds`
returns `unevaluable` for an `exists` discriminator with no expectation, and `matchSlices` turns a
single `unevaluable` into `unchecked` for the **whole** slicing - so at base an XML-sourced sliced
profile came back `PROFILE_SLICE_UNCHECKED` (information) and **no slice constraint was checked at
all**. At head the expectations are built and the slicing is really evaluated. That information-level
placeholder giving way to real evaluation is the one finding this change can remove, and it is the
fail-safe marker whose whole meaning is *"I could not evaluate this"*.

### Measurements

All of these are **post-remedy**, at the head this slice ships.

- **Red-at-base 20 of 32**, in a real `72cdee2` worktree (`git worktree add`, this package's own
  `node_modules` symlinked). The denominator is the tests this slice adds or rewrites: 31 in
  `test/xml-profile-min.test.ts` plus the one rewritten in `test/xml-lexical-boolean.test.ts`.
  **The 20 are not 20 closures, and the two that are not are separated out rather than banked:**
  - **0 are symbol-only reds.** The change adds no export (`src/index.ts` is byte-identical across
    `72cdee2..HEAD`), so every symbol the new file imports already resolves at base and every red is
    behavioural.
  - `still reads no mustSupport and no slicing.ordered off an XML definition` is red **only** through
    its co-located head assertion that `min` reads 1; its two residual assertions are green in both
    states.
  - `still loses two slice findings when a contradictory profile meets an exists discriminator` (RENAMED AND MOVED: it is now `closes it through a differential and a base, the route the defect was filed at` in `test/profile-slice-contradiction.test.ts`) is
    red because **head is WORSE there than base**. It pins the declared gap, so it is a cost, not a
    capability, and it must not be counted as evidence for the slice.
  - **So the behavioural figure for the closure is 18.**
- **The 12 green-at-base tests are pins, named** so a reader need not re-derive which cleared
  nothing: the ten `reads %j as no bound at all` refusal cases (`+1`, `01`, `1.0`, `1.`, ` 1`, `1 `,
  `one`, ``, `-1`, `1e2`), `leaves an element the differential states no min for exactly as the base
  had it` (the merge control), and `still overlays a differential max verbatim, so an upper bound CAN
  be relaxed` (the `max` residual).
- **Non-vacuity by mutation, ten mutations, each reddening a NAMED list** (never a count):
  1. drop the merge guard (overlay verbatim) -> `keeps the inherited bound when an XML differential
     states a smaller one`, `…when a JSON differential states a smaller one`, `keeps the inherited
     bound for a min of 0, whichever format spelled it`, `still loses two slice findings…` (renamed and moved, see above)
  2. over-guard the merge (always inherit when the base states one) -> `still takes a differential
     bound that tightens, which is the whole point of a profile`, `never lowers the enforced bound,
     even when the differential's own max sits under it`
  3. re-add the REVERTED clamp against `max` -> `never lowers the enforced bound…`, `still loses two
     slice findings…` (renamed and moved, see above)
  4. close the declared gap at `resolveSlices` (refuse to resolve a contradictory cardinality) ->
     `still loses two slice findings when a contradictory profile meets an exists discriminator` (RENAMED AND MOVED: it is now `closes it through a differential and a base, the route the defect was filed at` in `test/profile-slice-contradiction.test.ts`).
     This is the repo's own rule made executable: closing a declared gap MUST red its pin. (That
     mutation stopped being hypothetical in the next slice, and the pin red exactly here.)
  5. drop the lexical guard entirely -> the nine refusal cases `+1` `01` `1.0` `1.` ` 1` `1 ` ``
     `-1` `1e2`
  6. tolerate surrounding whitespace -> ` 1`, `1 `
  7. tolerate leading zeros -> `01`
  8. use `positiveInt`'s real space, a leading `+` admitted -> `+1`
  9. `Number.parseInt` instead of an exact match -> `+1` `01` `1.0` `1.` ` 1` `1 ` `-1` `1e2`
  10. remove the lexical route (revert the read fix) -> 18 tests, and the membership is NOT the 18
      behavioural reds even though the count coincides. Named, because the count is what a reader
      would otherwise infer: the seven headline closures, the five `reads N as the bound N` cases
      (`0` `1` `2` `10` `999`), `keeps the inherited bound when an XML differential states a smaller
      one`, `keeps the inherited bound for a min of 0, whichever format spelled it`, `still takes a
      differential bound that tightens…`, `never lowers the enforced bound…`, `still reads no
      mustSupport and no slicing.ordered off an XML definition`, and `reads a min a non-conformant
      JSON document spelled as a string…`. It **includes** the `mustSupport` test that this note
      separates out as not-evidence, and **excludes** `keeps the inherited bound when a JSON
      differential states a smaller one`, which the merge guard closes rather than the read, so a
      string-route removal cannot reach it.
  **Mutations 1, 2 and 3 are three polarities of the merge guard**, so it cannot pass by refusing
  every differential `min` and cannot pass with the reverted clamp back in. **`"one"` is reddened by
  none of the ten** and is retained as documentation of the boundary, not as evidence. Said here
  rather than folded into a total.
- **Exactly one existing test moved** across the whole suite: the characterization test that pinned
  this gap, which the repo's own rule requires a closure to red. It is rewritten in place rather than
  deleted, so the closure is visible from where the gap was declared. Suite **70 files / 1495 tests**
  from base's **69 / 1464**, and 1464 + 31 = 1495, so nothing else moved.
- **The `@cosyte/hl7` negative control is DEGENERATE and is reported as such rather than as a zero.**
  `hl7` is not a dependency of this package and has no `StructureDefinition` loader, so 0 of the
  symbols under measurement exist there and the control cannot fail. The controls that CAN fail are
  the three merge-guard polarities above and the two both-states pins named in the list.
- **The committed read differential (`pnpm differential:read`) moves 0 of 1,195 readings and 0 of 27
  JSON fixtures, and that zero is VACUOUS BY CONSTRUCTION for this class** rather than evidence:
  checked by hand, **no corpus fixture carries a `min` at all**, and the reading runs no profile
  validation (profiles are caller-supplied and none is supplied). What the zero does say is that the
  reader, the writers and the safety spine are untouched, which is worth having and is all it says.
- **Corpus caveat on every number here:** hand-authored XML and JSON fixtures, plus mutations and
  probes. **Not the R4 published-examples corpus.** Nothing here is corpus-wide.

### The gate

`conformance-refuter` **`REFUTED` -> `REFUTED` -> `REFUTED` -> `NOT REFUTED`**, four passes, the
ADR 0016 cap spent and no fifth. Pass 1 found the `INTRODUCED` blocker at `mergeElement`; pass 2
found the bare guard composes an unsatisfiable pair; pass 3 refuted the clamp that answered pass 2
with a counterexample worse than the defect; pass 4 graded the cut-back `NOT REFUTED`, finding no
`INTRODUCED` blocker.

**The last commit on the branch is UNGRADED and says so**: pass 4's one documentation minor, entry
10 of the mutation ledger above, whose count was right and whose membership was wrong. It changes no
executable line (`git diff` over `src/` and `test/` is empty). Applied rather than deferred because
the carrier is this note, which is the record a later slice reads. No sha is named here on purpose:
the branch squash-merges, so a branch sha would be dead the moment it landed.

**Pass 4 also asked that the declared gap be filed as its own backlog item immediately.** It is a
`resolveSlices` defect, not a `parseMin` one, and it is outside this item's bar.

### Declared open, each pinned in `test/xml-profile-min.test.ts`

Closing any of them MUST red its test, in the same change.

1. ~~**A contradictory profile loses two slice findings.**~~ **CLOSED by the next slice**, at
   `resolveSlices` exactly as this entry predicted, and NOT at the merge: the contradiction is
   recorded as unsatisfiable instead of resolved toward either side, so an `exists` discriminator on
   such a path assigns no occurrence and both findings are drawn. Its pin red as required and its
   tests moved to `test/profile-slice-contradiction.test.ts`. The whole record, including the one
   finding the closure RETIRES and the bound on it:
   `documentation/agent-notes.md#narrative-a-contradictory-slice-descendant-assigns-no-occurrence-resolveslices`. The merge is unchanged, so entry 2
   below still composes the pair.
2. **`mergeElement` still overlays a differential `max` verbatim**, so an upper bound can be widened
   and a `CARDINALITY_MAX` retired. The mirror of what this slice fixed, left standing because no
   read feeding `max` moved. Both-states pin.
3. **`ElementDefinition.mustSupport` and `slicing.ordered` are still unread from XML.** What makes a
   widened `min` safe is that its one finding-retiring consumer now takes the tighter of two bounds;
   a boolean flag has **no tighter-of-the-two**, since `false` is not "no flag stated". `#79`'s
   measured retirement stands.
4. **A non-conformant JSON `{"min": "1"}` is now read**, because the model records no provenance and
   the lexical read cannot be scoped to XML. Lenient on the read, unchanged on the write - the string
   is still what the writer hands back. The same collateral `#79` declared for `booleanOf`.
5. **FHIRPath `numberOf`** is the sibling from the same census and is **not** absorbed here: an
   XML-sourced number still falls through to string ordering, so `"9" < "10"` is false. Its own item.

## Narrative: A contradictory slice descendant assigns no occurrence (`resolveSlices`)

Written to the per-slice tier rather than appended to `agent-notes.md`, which is 7 bytes from its
archive budget. The cursor stays there; this is the whole record. Predecessor:
`documentation/agent-notes.md#narrative-an-xml-sourced-profiles-required-elements-are-enforced-elementdefinitionmin`.

**Provenance.** FHIR R4 `elementdefinition.html` (§slicing, and cardinality "constraining" under a
derived profile) for what a discriminator decides and what makes a derived profile invalid; this
package's own `src/profiles/slicing.ts` contract and `collectSlicingIssues` control flow for what a
report of `unchecked` costs. **No new spec clause is relied on**: R4 makes a `min 1 / max 0` profile
invalid and defines no instance behaviour for it, so the choice between "no" and "unevaluable" is
this library's fail-safe policy, not a conformance requirement. Everything numeric below is measured
in this repo, not cited.

### The defect

`resolveSlices` turns a slice descendant's cardinality into an `exists` expectation, and it read the
two bounds as an **ordered pair**:

```ts
if (desc.min !== undefined && desc.min >= 1) existsExpectations.set(rel, true);
else if (desc.max === 0) existsExpectations.set(rel, false);
```

`min` was consulted first, so a descendant stating **both** at once discarded the prohibition. An
unsatisfiable `min 1 / max 0` is not a hypothetical shape: it is exactly what the previous slice's
merge composes when a differential forbids with `0..0` an element the base makes required, and that
merge was deliberately left composing it after a clamp against `max` was tried there and reverted
for lowering the enforced bound below the inherited one.

The consequence is that every occurrence carrying the **forbidden** element was admitted into the
slice. Beneath a `closed` slicing that retired a `PROFILE_SLICE_UNMATCHED` and the slice's own
`CARDINALITY_MIN`: three errors before the previous slice, one after it.

### What shipped

A third state, kept **apart from** the boolean map rather than folded into it, because neither
boolean is true of a contradiction and picking one admits occurrences the profile forbids:

- `SliceDefinition.unsatisfiableExists: ReadonlySet<string>`, populated when a descendant states
  `min >= 1` beside `max === 0`.
- `discriminatorHolds` answers `"no"` for an `exists` discriminator on such a path.

**The answer is `"no"`, never `"unevaluable"`, and that is the whole design decision.**
`"unevaluable"` reports the entire slicing `unchecked`, and `collectSlicingIssues` **returns** on
`unchecked` before the unmatched-occurrence arm, the slice cardinality arms and the slice
must-support arm. Reporting `unchecked` would therefore have *retired* the very findings this case
exists to draw, while dressing the retirement as a fail-safe. It is not a guess either: no instance
has a path both present and absent. **`"no"` is not purely additive against the previous behaviour,
though, and the gate was right to press on that** - see the retirement classes below.

**Scoped to the discriminator path on purpose.** An unsatisfiable descendant does not make the slice
unmatchable in general. FHIR decides membership by the discriminators and then validates the
assigned occurrence, so an occurrence may legitimately be assigned to a slice it violates. Only a
contradiction **at** a discriminator path makes membership itself undecidable, and marking the whole
slice unmatchable would move genuine violations to "unmatched" and hide them.

**Scoped to the slice's OWN descendants (`sliceName === undefined`) too, and gate pass 1 is what
forced that.** The reason the narrowing cannot introduce a third defect is **not** the loose one
first written down ("it only moves toward base"); state the gate's version: for any descendant
failing the new first conjunct the remaining chain is **token-identical to base's**, and
`unsatisfiableExists` is read at **exactly one site**. Pass 2 confirmed it mechanically with a
1,349-case grid: this tree differs from base in **exactly 120 rows, every one of them carrying the
filed `own = {min >= 1, max "0"}` shape**, with **zero `valid: false -> true` rows**; the 104 extra
rows the first draft moved are all gone. This walk sweeps every element under the slice's id prefix, and a **re-slice** of a
descendant sits under that prefix and flattens onto the same relative path. Recording a re-slice's
contradiction made the satisfiable **outer** slice unmatchable and drew a `PROFILE_SLICE_UNMATCHED`
plus a slice `CARDINALITY_MIN` **on a conformant document**: it blamed the instance for a statement
belonging to a different slice. Re-slicing is a declared deferral of this module, so a contradiction
carried only by a re-slice is left reading as it did before rather than guessed at from the outer
slice's position. Pinned by `ignores a contradiction carried only by a RE-SLICE of the discriminator
path`.

**Scoped to `max === 0`, not to `max < min`.** `min 2 / max 1` is unsatisfiable by *count* and still
says something unambiguous about *existence*: `min 2` means present. Only `max 0` contradicts the
presence half. That row is pinned, and mutation M4 (widening the guard to `max < min`) reds it.

The merge is untouched. This is the remedy the predecessor predicted, at the site it named.

### Measurements

Re-measured after the accuracy gate's first pass, which refuted the slice and forced a scoping
change; every figure below is from the post-remedy tree. Suite `1538 -> 1553` (one test moved out of
`test/xml-profile-min.test.ts`, sixteen added in `test/profile-slice-contradiction.test.ts`). Every
repo gate green: `typecheck`, `lint`, `test`, `format:check`, `check:no-emdash`,
`check:no-internal-refs`, `phi-scan`, plus the umbrella's `scripts/verify.sh fhir`.

#### Red-at-base, as a fraction, and split by kind

Measured against `4bc8780` in a tree extracted with `git archive` (file copy, never a checkout over
the working tree), the new file's own tests copied in:

**12 of 16 red at base. Only 5 of those are behavioural, and 2 of the 5 are costs.**

- **5 behavioural reds**, each an `AssertionError`:
  - `draws both findings the ordered read used to retire, under closed slicing` (1 issue -> 3)
  - `closes it through a differential and a base, the route the defect was filed at` (1 issue -> 3)
  - `does not report the slicing unchecked, which would return before those arms`
    (`['Missing']` -> `[undefined]`)
  - `retires a slice CARDINALITY_MAX that only fired on a wrongful admission` (3 -> 2) - **COST**
  - `retires a later slice's findings that existed only because a contradictory slice shadowed it`
    (3 -> 1) - **COST**
- **7 symbol-only reds**, every one `TypeError: slice.unsatisfiableExists is not iterable`. The
  member does not exist at base, so these rows cannot be behavioural evidence. **Reported as
  symbol-only rather than banked**, which is the opposite of the predecessor's figure: that slice
  added no export and had 0 symbol-only reds, this one adds an interface member and has 7.

**Both cost rows are red because HEAD IS WORSE THERE.** So the **behavioural closure figure is 3.**

#### Green at base, named, so a reader need not re-derive which cleared nothing

Four rows. Each touches no new member, so each genuinely runs at base:

- `still reports unchecked when no descendant pins the discriminator path` - the pre-existing
  fail-safe, unchanged, and deliberately not reused for this case.
- `does not move a verdict to valid through a re-slice the element check never sees` - green at base
  **and** at head, which is the point: the remedy restores the base reading. It is **not** vacuous;
  M9 (the pre-remedy tree) reds it, which is the gate's own finding made executable.
- `leaves an error standing when the forbidden element is present`
- `leaves an error standing when the forbidden element is absent`

#### Non-vacuity by mutation: 9 mutations, each reddening a NAMED list

| # | mutation | reds (new rows unless marked pre-existing) |
|---|---|---|
| M1 | guard removed (the base ordered read) | `records the contradiction…`, `draws both findings…`, `does not report the slicing unchecked…`, `reads the same contradiction out of the XML spelling…`, `closes it through a differential and a base…`, `retires a slice CARDINALITY_MAX…`, `retires a later slice's findings…` |
| M2 | answer `"unevaluable"` instead of `"no"` | the six above bar `records the contradiction…`, plus `leaves an error standing when the forbidden element is present` / `…is absent` |
| M3 | guard widened to `max === 0` alone | `still expects absence from a plainly prohibited descendant`, `ignores a contradiction carried only by a RE-SLICE…`, `does not move a verdict to valid…`, plus pre-existing `matchSlices handles an 'expect absent' (max 0) exists discriminator` |
| M4 | guard widened to `max < min` | `still expects presence from min 2 / max 1…` |
| M5 | populate the set but drop the check in `discriminatorHolds` | the same eight as M2 |
| M6 | record the contradiction AFTER setting the expectation | `records the contradiction apart from the expectations…` |
| M7 | guard widened to `min >= 1` alone | `still expects presence from a plainly required descendant`, `still expects presence from min 2 / max 1…`, `ignores a contradiction carried only by a RE-SLICE…`, `retires a later slice's findings…`, plus 3 pre-existing rows in `slicing.test.ts` and `xml-profile-min.test.ts` |
| M8 | every descendant recorded unsatisfiable | all five neighbour rows, `still reports unchecked when no descendant pins…`, `retires a later slice's findings…`, plus 4 pre-existing rows |
| M9 | **the pre-remedy tree**: drop the `sliceName === undefined` scoping | `ignores a contradiction carried only by a RE-SLICE…`, `does not move a verdict to valid through a re-slice…` |

**16 of 16 new rows are reddened by at least one mutation. There is no documentation-only row** -
the predecessor had one (`"one"`, reddened by none of its ten) and said so; this slice has none.
M3, M4, M7 and M8 are what make the symbol-only neighbour rows admissible, since their base
comparison cannot run. **M9 is the gate's own counterexample turned into a regression pin**, and it
is the reason `does not move a verdict to valid…` is not just a both-states decoration.

#### 🩺 Two degenerate rows of my own, both caught by a mutation before being trusted

1. `does not report the slicing unchecked` first passed the whole `Observation` to `matchSlices`,
   which takes the sliced element's **occurrences**. `dataAbsentReason` does not resolve at an
   `Observation` root, so the occurrence went unmatched **however the contradiction was resolved**.
   M1 failing to red it is what exposed it. It now passes the `component` node and asserts the
   occurrence count. The sibling row `still reports unchecked when no descendant pins…` had the same
   shape and was repaired with it, on the gate's prompting.
2. `does not move a verdict to valid through a re-slice…` was **first written with a fixture that
   could not reproduce the gate's finding at all** - a second element made the issue list identical
   in both trees, so no mutation reddened it. It was rebuilt until M9 reds it. **A row written to
   pin a gate finding that the gate's own counterexample does not red is decoration**, and it was
   one mutation away from shipping as such.

Also corrected on the gate's prompting: `reads the same contradiction out of the XML spelling`
compared the XML reading to the JSON reading, which agreed at base too. Both its assertions now
state a literal.

#### The zero that is vacuous, and why

`pnpm differential:read`: **0 readings moved of 1,195 documents**, every no-suppression bar 0
(`valid F->T` 0, `safeToSummarize F->T` 0, retractions lost 0, negations lost 0, read diagnostics
lost 0, 18 emitted-XML re-read differences of which **0 stable on base**, so 0 regressions).

**That zero is VACUOUS BY CONSTRUCTION and is not evidence.** It is vacuous more strongly than the
predecessor's was: that slice at least sat on a read the harness exercises and merely lacked a
fixture carrying a `min`. This change is in the **profile-validation layer**, which the read
differential never invokes at all - the harness compares reader and writer readings and does not
call `collectProfileIssues` or `resolveSlices` on any document. The harness prints its own caveat
that a 0 on that line is not evidence the change is safe, and it is right here.

**Corpus caveat on every figure above: hand-authored JSON and XML fixtures plus mutations and
probes, NOT the R4 published-examples corpus.**

### ⚖️ What is retired, enumerated rather than counted

The first draft of this slice said "one finding is retired" and bounded it with a general claim. The
accuracy gate refuted both halves. The corrected account:

**Retirement 1 - a slice `CARDINALITY_MAX` fired by the wrongful count.** An occurrence no longer
admitted stops counting toward the slice, so a `CARDINALITY_MAX` that only fired because of the
admission goes.

**Retirement 2 - a LATER slice's `CARDINALITY_MIN` and `MUST_SUPPORT_ABSENT`, through de-shadowing.**
`matchSlices` breaks at the first matching slice, so an occurrence wrongly admitted to a
contradictory slice never reached the slices after it. Refusing the admission de-shadows them, and
whatever they then do - match, or turn out **unevaluable** and take the whole slicing to `unchecked`
- the findings their emptiness had earned go with them. **This class was missed entirely in the
first draft** and was found by gate pass 1.

**Retirement 3 - the unevaluable half of retirement 2, which is NOT confined to one slice's codes.**
`matchSlices` returns `unchecked()` on the **first** `unevaluable` verdict, so if a de-shadowed
slice pins nothing at the discriminator path, **every** slice arm for that slicing is skipped: a
third slice's `CARDINALITY_MAX` goes too, and an evaluated slicing becomes an unevaluated one, which
is the very outcome the design section above says `"no"` was chosen to avoid. It surfaces as the
library's honest `information` marker `PROFILE_SLICE_UNCHECKED`, `valid` does not move (0 flips
across the gate's 1,349-case grid), and a `PROFILE_SLICE_UNMATCHED` can never be retired this way.
**Found by gate pass 2, after the first draft of retirement 2 was written too narrowly** ("a later
slice that now matches"). Disclosure width, not a safety defect.

**🛑 Carried forward for whoever opens this module next.** Every retirement above rests on the same
two properties of `matchSlices`: **break-at-first-match**, and an **all-or-nothing `unchecked`**.
This slice was bitten by that control flow **twice, from two directions** - once as de-shadowing and
once as the unevaluable collapse. The gate's closing words were that the next slice into this module
should expect it a third time.

In every case measured the head reading is the more correct one, because each retired finding was an
artefact of the wrongful admission. That is a reason to disclose them, not a reason to omit them.

**The bound, stated at the width it actually holds.** Where the contradiction sits on the slice's
**own** descendant, that descendant is also checked at element level, and `min 1 / max 0` is
unsatisfiable for every count (0 draws `CARDINALITY_MIN`, 1 or more draws `CARDINALITY_MAX`), so an
error stands on each present parent occurrence whichever way the instance goes. Both polarities are
asserted.

**🛑 That is NOT a general bound, and the first draft wrongly wrote it as one.**
`collectProfileIssues` **skips slice elements**, so a contradiction carried by a **re-slice** is
never element-checked at all, and nothing stands behind a retirement on that route. The gate
reproduced a `valid: false -> true` move through the public `validateResource` there. The answer was
not to re-word the bound but to **narrow the record away from re-slices**, which closes the route:
`does not move a verdict to valid through a re-slice the element check never sees` pins it, and M9
reds it.

### Carriers swept, not just the site

The predecessor's changeset and `CHANGELOG.md` entry both asserted this gap was open and "pinned by
a test". Fixing only the code would have shipped a release body contradicting itself.

- `.changeset/olive-badgers-enforce.md` - the falsified paragraph **DELETED, not reworded**: a
  changeset freezes permanently.
- `CHANGELOG.md` - the same paragraph deleted from the `[Unreleased]` entry.
- `documentation/agent-notes.md#narrative-an-xml-sourced-profiles-required-elements-are-enforced-elementdefinitionmin` - the "Declared open" entry marked closed, the
  forward-looking sentence answered, and the **test name it quotes corrected**: that test was
  rewritten as the closure and moved, so a reader following the old name would have found nothing.
- `src/profiles/snapshot.ts` - the `mergeElement` docblock, which named this as its own slice.
- `test/xml-profile-min.test.ts` - the residuals block's own count corrected from four to three.
- `documentation/agent-notes.md` is **not** a carrier (it names `resolveSlices` only in a layer
  description), so the 7-byte-from-budget file was not touched. Neither was `fhir/CLAUDE.md`, which
  is 3 bytes from its own.

**Owed, and deliberately not done here:** the meta-repo's `documentation/repos/fhir/xml-profile-min.md`
carries the same "🔴 Open" entry, and `operations/BACKLOG.md` still lists this gap as the item's
first open leg. This session was scoped to the submodule and told not to touch either.

### The gate

`conformance-refuter`, **`REFUTED` -> `NOT REFUTED`, 2 passes of the ADR 0016 cap of 4.**

| pass | verdict | finding |
|---|---|---|
| 1 | `REFUTED` | **two `INTRODUCED` majors.** The bound was false (`collectProfileIssues` skips slice elements, so a **re-slice**'s contradiction is never element-checked and a `valid: false -> true` moved through the public `validateResource`); and the guard was mis-scoped WIDE, a contradictory re-slice making the satisfiable **outer** slice unmatchable and **false-erroring a conformant document**. Plus five minors. |
| 2 | **`NOT REFUTED`** | Both majors **closed in code and verified mechanically, not argued** - a 1,349-case differential grid over three trees. One `INTRODUCED` **minor** survivor (the retirement enumeration still too narrow), remedied by a **cut**. |

**Both majors were answered in CODE, by one narrowing, not by re-wording the claim** - which is the
right answer to the predecessor's history of two consecutive remedies each introducing a defect. The
pass-2 prose cut is applied here and is **UNGRADED**: the cap was not spent (2 of 4), and the cut is
the refuter's own prescribed wording, strictly narrowing a claim.

**🩺 Two findings this slice reported against itself**, both recorded because a probe that cannot
fail is not a probe: the probe-D fixture that could not reproduce the gate's own counterexample and
was reddened by no mutation until rebuilt, and an annotation in the predecessor note that named a
successor test **which did not exist**.

### Owed elsewhere, filed rather than absorbed

- **`README.md` and `docs-content/intro.md` promise re-slicing is announced as
  `PROFILE_SLICE_UNCHECKED`, and it is not** (`README.md` ~601-603 and ~619-620,
  `docs-content/intro.md` ~58). Measured false at `4bc8780` as well as here, so `PRE-EXISTING`. The
  cause is untouched by this slice: `resolveSlices` still pushes a **re-slice's `fixed`/`pattern`
  into the outer slice's `constraints` with no `sliceName` filter**, so a `value`/`pattern`
  discriminator can still be decided by a re-slice. The `exists` record is the only half scoped here,
  deliberately. **The backlog line is "re-slice content participates in outer-slice membership at
  all", and the README claim goes with it.** Not deleted here: this slice cannot grade that site.
- The meta-repo's `documentation/repos/fhir/xml-profile-min.md` "🔴 Open" entry and
  `operations/BACKLOG.md`'s first open leg for this item both still describe the gap as open. This
  session was scoped to the submodule and told to touch neither.

### Still open, unchanged by this slice

- **`mergeElement` still overlays `max` verbatim** - the mirror, and the composer of the very pair
  this slice handles. Both-states pin.
- `ElementDefinition.mustSupport` and `slicing.ordered` still unread from XML.
- FHIRPath `numberOf` - an XML-sourced number still falls through to string ordering.
- A non-conformant JSON `{"min": "1"}` is read, no provenance available to scope it.
- The `type` / `profile` / R5 `position` discriminators still report `unchecked`; nothing here
  widened what this module can evaluate.
