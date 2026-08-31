---
"@cosyte/fhir": minor
---

A terminology service can declare which code-system release an answer was made against, and the
membership finding records it, or records that none was declared (`FHIR-VOCAB-VERSION-1`).

The library vendors no value-set content, so membership is answered by a caller-supplied
`TerminologyService`. That service could say `in`, `not-in` or `unknown` and nothing else: the
release of the code system it consulted was not expressible, not recorded and did not reach the
caller. A `not-in` for an RxNorm code therefore read as a timeless fact when it was really an answer
against one monthly RxNorm drop, and a consumer reconciling a validation report months later had no
way to tell whether the answer was stale.

`CodeValidationResult` now carries an optional `systemVersion`, declared **per answer** because that
is the granularity at which the fact is true: one service can answer out of several code systems and
can be re-pointed at a new release between two calls. It is carried onto the `CODE_NOT_IN_VALUESET`
finding as `ValidationIssue.codeSystemVersion` and onto the `OperationOutcome` as `issue.details`.
The declared string is preserved exactly, never trimmed, case-folded, parsed, truncated or
substituted: it is the caller's own assertion and the library verifies nothing about it.

An answer that declares no release is marked **undeclared** rather than left silent, because a
missing field reads as "not applicable" and this question is applicable and unanswered. The record
has three distinguishable states: a declared release, an explicit undeclared marker, and no record
at all on a finding no service produced. A declaration that is absent, empty, whitespace-only or,
from untyped JavaScript, not a string at all degrades to undeclared without throwing, without
emitting an empty release, and without substituting any default, latest or "current" release.

On the wire the marker rides on `details.coding` (a two-concept vocabulary,
`CODE_SYSTEM_VERSION_RECORD_CODES`, under this library's own canonical
`CODE_SYSTEM_VERSION_RECORD_SYSTEM`) and the release itself on `details.text`, so no release a
service could declare can be mistaken for the marker. `diagnostics` is untouched and stays derived
from the finding code alone through the single redaction chokepoint.

Additive throughout: an existing service that declares nothing compiles unedited and behaves exactly
as before, membership severities and the fail-safe degrade are unchanged, the content-free system
checks carry no release record because no service was consulted to produce them, and the
known-systems registry stays a frozen set of identities with no release recorded on it. A resource's
own `Coding.version` is still read by nothing: the only release a finding may record is the one the
caller's service declared.
