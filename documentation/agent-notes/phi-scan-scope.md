# PHI scan scope (2026-08-05)

Relocated VERBATIM out of `agent-notes.md` on 2026-08-11 when that file reached its budget
(`PHI-SCAN`), nothing dropped. The cursor there points here.

`PHI-SCAN-WALK-ROOT-SCOPE` and `PHI-SCAN-OBSERVED-NOTHING-IS-GLOBAL`.

Two holes in `scripts/phi-scan.ts`, closed together because closing either alone ships a gate that
reads green over what it did not read.

## The scope, re-derived for this package rather than ported

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

## Enumerating the files buys the SSN / email floor and nothing else

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
"The bytes git carries" below, not softened.** **Declare a domain, never a shape rule.**

## Existence is not observation

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

## What this closed, and what it left open

Three characterization tests went **red on the spot** and were rewritten to the new behaviour, which
is that mechanism working: the observed-nothing gap, the scan-root's-**parent**-as-a-link gap (now
refused on both routes, by different mechanisms), and three quarters of the regular-blob-at-the-
fixture-root gap. **Still open, pinned:** at exactly `test/__fixtures__`, `identifier.value` and
`telecom.value` are read by nothing, because `isFixture` tests a trailing slash and the remaining fix
belongs to `scanTarget`'s dispatch. Full residual list, and the reviewed allow-list additions the
widening forced, are in `phi-scan-overrides.md`.
