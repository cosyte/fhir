---
"@cosyte/fhir": patch
---

**The PHI commit-gate now scans the tracked files under `test/` that its markdown and sentinel rules
do not exempt, reads the FHIR identifiers written as source literals, and refuses to report clean
over a corpus it never opened.**

Three things were true of `scripts/phi-scan.ts` and each made `OK, no hits` mean less than it read.

**A tracked file directly under `test/` was reached by neither route.** The all-mode walk was rooted
at `test/__fixtures__` and `src`, and `--staged` was scoped to the same two prefixes. Measured here:
101 tracked files were scanned by neither, 55 of them under `test/`. Counted with the scanner's own
key regex over those 55 files: 87 object-literal `family` / `given` sites and 21 `birthDate` sites,
plus 33 more `family` / `given` and 3 `birthDate` spelled as XML `value` attributes. The roots are
`test` and `src` now, on both routes. The old exclusion had a stated reason, the PHI-leak suite's
deliberately PHI-shaped sentinels, and that reason covers two files rather than a directory: those
two are declared by exact path, subtracted from the sweeping routes only, announced when skipped,
and still scanned when named on the command line.

**Enumerating a source file buys the dashed-SSN and email floor and nothing else.** The structured
scanner assumes the file is the document and runs only over a fixture with a FHIR wire-format
extension, but a test builds its resources as TypeScript object literals, so a real surname typed as
`family: "…"` was read by nothing: an SSN and an email are neither a name, a date of birth nor a
street address. Measured at exit 0 both before the widening (never enumerated) and after it with the
recogniser absent (enumerated, unread). So `family`, `given`, `birthDate`, `deceasedDateTime` and
`line` are now read in source and sent to the same detectors the structured scanner uses, in
addition to the shape pass rather than instead of it, in both wire formats this package's tests
write, with string escapes decoded to a bounded fixed point because a resource is routinely written
as a JSON document inside a TypeScript string. Within XML that is the double-quoted attribute only;
a single-quoted attribute and XML element text are unread and declared.
`text`, `identifier.value` and `telecom.value` are deliberately not read there, and why is
documented.

**A sweep that opened nothing still reported clean.** An emptied or deleted walk root printed
`OK, no hits` and exited 0 over a corpus still wholly present in the index. A count of scanned files
does not detect that, because it counts the roots that did exist. The sweep now reconciles against
the index and names every in-scope path it did not open, and refuses outright when it opened no file
at all.

Adding the scope surfaced one false positive, this package's own `IssueCode@FHIRPath` diagnostic
form, which is one `@` between two dotted tokens and so indistinguishable from an address by shape.
The first remedy for it was a widening that was "instead of" rather than "in addition to", and it
made the gate detect less than the one it replaced: a shape exclusion scoped in intent to source
files in fact reached any fixture whose extension is not `.json` / `.xml` / `.ndjson`, and a fixture
carrying a capitalised-domain address went from reported to unreported. It is reverted, and one
declared email domain covers the single live occurrence instead. The allow-list additions the widening forced are all reviewed, token-level
declarations. No behaviour of the published package changes; this is the commit gate that guards it.
