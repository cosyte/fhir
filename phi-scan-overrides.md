# phi-scan bypass log

This file logs every `--allow-fixture <path>` bypass invocation of
`scripts/phi-scan.ts`. The scanner refuses to honor a `--allow-fixture <path>`
flag UNLESS this file contains an entry referencing the same path. The committed
log is intentionally annoying — it discourages bypass and creates an audit
trail. Prefer extending `scripts/phi-allow-list.txt` (a token-level, reviewed
declaration) over a whole-file bypass.

## How the scanner detects PHI

`scripts/phi-scan.ts` is FHIR-shape-aware. It parses each synthetic fixture and
inspects only the elements that actually carry each PHI category, keyed by the
FHIR element name — not a blind text regex, which would trip on coded values and
resource labels. It runs the structured scan on files under `test/__fixtures__/`
by wire-format extension (`.json`, `.xml`, `.ndjson`); `src/` gets a conservative
dashed-SSN + email pass only, so a JSDoc `@example` embedding a
`{"resourceType":"Patient",…}` snippet with synthetic names is never parsed as a
resource. `test/*.ts` is not walked at all — the PHI-leak suite ships a sentinel
battery of deliberately PHI-shaped strings, and scanning it would flag the very
sentinels that exist to be flagged.

A key distinction keeps the name detector honest: FHIR `name` is a **HumanName**
(object / array) only on Patient / Practitioner / RelatedPerson / Person and the
`contact` backbone; on Organization / Location / StructureDefinition it is a
plain **string** resource label. The scanner name-scans only a HumanName
object/array — a string `name` is skipped, so `Organization.name`
("Good Health Clinic") never false-flags. The walk recurses into `contained`,
`entry.resource`, and every `value[x]`, so a name nested in a contained resource
or a Bundle entry is still reached.

| Category         | Where it looks                                                                         | Rule                                                                                                                                                                                                                                                   |
| ---------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Person names     | HumanName `family` / `given` / `text` (JSON); `<family>` / `<given>` value attrs (XML) | each significant name token must be in the `NAME` allow-list (case-insensitive). Single Latin initials are skipped; single CJK ideographs are kept; honorific / degree codes (MD, JR, …) are ignored. A string `name` (resource label) is not scanned. |
| Date of birth    | `birthDate`, `deceasedDateTime`                                                        | the normalized `YYYYMMDD` / `YYYYMM` / `YYYY` must be in the `DOB` allow-list. A DOB is indistinguishable from a real one by shape, so the allow-list is the only sound gate.                                                                          |
| SSN / identifier | `identifier.value`; `telecom.value`; dashed `\d{3}-\d{2}-\d{4}` anywhere               | a 9-digit (SSN-shaped) value must be in the `ID` allow-list; a dashed SSN anywhere is always a hit. Prefixed synthetic ids (`SYN-0001`) and resource references (`Patient/1`) are not 9-digit and pass.                                                |
| Phone            | `telecom.value` (ContactPoint)                                                         | a ≥10-digit number lacking the `555` fake-exchange convention is a hit.                                                                                                                                                                                |
| Address          | `Address.line` / `Address.text` (JSON); `<line>` value attrs (XML)                     | a `<number> <word>` street line must be in the `ADDR` allow-list. `city` / `postalCode` are quasi-identifiers and not gated here.                                                                                                                      |
| Email            | anywhere (`telecom.value` + free text)                                                 | an email whose domain is not an `EMAILDOMAIN` (reserved / test) domain is a hit.                                                                                                                                                                       |

## Documented limitations

- **Free-text PHI** in an opaque `Narrative.div` or an `Annotation.text` is
  covered only by the cross-cutting dashed-SSN + email pass — a bare name in
  narrative prose is not caught structurally (the same limitation the HL7 scanner
  documents for `OBX-5` / `NTE` free text). Keep narrative synthetic.
- **MRN detection** is deliberately limited to the 9-digit (SSN-strength) shape;
  short (6–8 digit) synthetic MRNs are common and numeric-noisy in FHIR, so they
  are not gated — declare a realistic MRN in the `ID` allow-list if a fixture
  needs one, or prefix it (`MRN-…`).
- The **XML** pass is regex-based over `<element value="…"/>` pairs (tolerant of
  the malformed fragment a leaked document arrives as); it does not build a DOM.

## Bypass entries

_None. Every fixture is covered by token-level `scripts/phi-allow-list.txt`
declarations; no whole-file bypass has been needed._
