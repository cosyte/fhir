---
"@cosyte/fhir": patch
---

Report a code that spells a negation bar its case or its surrounding whitespace, instead of declining
it in silence (`FHIR-NEGATION-READ-SCOPE-RESIDUALS`).

Measured at the base commit: `{"resourceType":"Procedure","status":"NOT-DONE"}` and the same document
with `" not-done"` returned `negations: []` under `safeToSummarize: true`, with
`assertSafeToSummarize` clean and nothing on any channel to say a value had been looked at and
declined. The same held for a case-varied or padded `entered-in-error`, `not-taken` and `refuted`, on
`status` and on a `verificationStatus` coding, at every resource root each of them is read at.

The exact match is correct and is unchanged. FHIR `code` is case-sensitive and the datatype's lexical
space has no room for surrounding whitespace (`[^\s]+(\s[^\s]+)*`), so `"NOT-DONE"` and
`" not-done"` are not the code `not-done`. Coercing them would accept a non-conformant document as
though it were conformant and hand a caller a negation the sender never spelled.

The defect was the silence, not the strictness. A caller doing exactly what this readout instructs,
branching on `negations` rather than on the raw status string, read a procedure recorded as
`"NOT-DONE"` as a procedure with nothing to say about it. So the value is disclosed rather than
normalised: its element's FHIRPath location now appears in the new
`SafetyReadout.nearMissNegationCodes`, `safeToSummarize` is `false`, and `assertSafeToSummarize`
throws. `nearMissNegationCodes(resource, path)` is exported beside the other collectors.

Nothing is coerced, trimmed or case-folded, and unlike the readout's other location channels nothing
is dropped at parse time either: the value is in the model at the element the location names, and
what the library declines is the classification. That is not a promise the value reaches a
convenience field. `status` and `verificationStatus` are root-scoped and preferred-system-first while
this channel is document-wide, so a near miss inside `contained` or a `Bundle.entry`, or in a second
coding, is not what they show. Walk the model at the location.

A near miss is suppressed where the same element also spells that code exactly, since the negation is
then classified and the caller has it. R4 permits translation codings beside the one from a required
binding's value set (terminologies.html), so a `verificationStatus` carrying `refuted` from the
standard system and `REFUTED` from a local one is conformant and draws nothing. The suppression is
per code, so a near miss of a different code at that element still reports.

The elements are the `code`-valued ones the negation read looks at, `status` and
`verificationStatus`, at every resource root, which is the negation read's own window. The pairs are
taken from the same table the matches themselves are made from, so the report cannot cover a pair the
read does not, nor miss one it does.

`AllergyIntolerance.code` is deliberately outside it. SNOMED `716186003` "no known allergy" is a
*positive* clinical assertion whose read is root- and type-scoped, and disclosing a near miss at
every resource root would report the miss where an exact hit is read by nothing.

Whitespace is R4's own four-character class rather than JavaScript's, so a no-break space or a
byte-order mark inside an otherwise conformant `code` is left alone. The channel raises no
`ValidationIssue`, so `valid` does not move in either direction on any document.

Empty on every conformant document read from JSON, bar one shape admitted rather than claimed away: a
`CodeableConcept` may carry translation codings beside the one a required binding's value set
supplies, and R4 asks only that one coding come from that set (terminologies.html), so a translation
whose code differs from a negation code only by case is conformant under that reading and is
disclosed. Only the case half can be: a surrounding-whitespace value is outside `code`'s lexical
space whatever coding carries it. Over-disclosure is the fail-safe direction.

In XML the whitespace half is a further declared limit
rather than a claim: R4 derives `code` from `xs:token` (fhir-base.xsd), whose `whiteSpace=collapse`
facet strips surrounding whitespace before validation, so `<status value=" not-done"/>` is
schema-valid and a schema-validating consumer reads it as the code. This reader is schema-free and
does not collapse, so it discloses rather than reads, which is the fail-safe direction.

`do-not-perform`, the one boolean negation, already had this disclosure: `value="TRUE"` and
`value=" true"` have landed on `unreadableBooleans` under `safeToSummarize: false` since that channel
shipped. What had no complement was the `code`-valued half.
