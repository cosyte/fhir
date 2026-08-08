---
"@cosyte/fhir": patch
---

Correct which warning a discarded `_`-sibling draws, on every surface that stated it
(`FHIR-README-ARRAY-WARNING-WRONG`).

The documented gap around the nested-array rule said that a `_`-sibling the reader discards *whole*
leaves no node behind, "so an array inside one draws the unexpected-property warning for the
discarded sibling and no refusal". That sentence enumerated three members and gave them one code.
It is true for one of the three. An unrecognised member of a `_`-sibling object does draw
`UNKNOWN_PROPERTY`; a `_`-sibling on an object and a `_`-sibling on a non-primitive array draw
`MISPLACED_PRIMITIVE_EXTENSION` for the misplaced sibling and nothing besides. Those are different
codes with different contracts (`MISPLACED_PRIMITIVE_EXTENSION` says content was **not readable** at
the position), which is precisely the distinction a consumer keying on the warning would have lost.

No behaviour changed and no code moved: the reader has reported these positions this way since the
rule was written, and the existing test already pinned which code each member draws. What was wrong
was the prose describing it.

Documentation only, but it was **npm-facing on three surfaces, not one**: `README.md`, and the doc
comments on the nested-array safety readout and on the nested-array validation code, both of which
render into `dist/index.d.ts` and `dist/index.d.cts` and so reach a consumer's editor. Correcting
only the one that was reported would have left the claim shipping in the type declarations, which is
the failure mode this lineage has already paid for once.

Stated as a failing example rather than as a universal, and the characterization test that pins the
per-member codes now asserts the **exact** issue list rather than merely containing the expected
code, so the "and nothing besides" half of the sentence is pinned rather than asserted in prose.
