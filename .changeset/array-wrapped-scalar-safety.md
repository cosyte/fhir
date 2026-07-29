---
"@cosyte/fhir": patch
---

A single-valued element wrapped in a JSON array read as absent, so a retraction or negation encoded that way went unreported and the resource read back as live and safe to summarize.

`{"resourceType":"Observation","status":["entered-in-error"]}` read back `retracted: false`,
`safeToSummarize: true`, `valid: true` and an empty issue list. FHIR JSON writes a `0..1` element as
a name/value pair and reserves the array for a repeating element, so a single-value read asked the
list for its string value, got nothing, and never reported the retraction the sender wrote. This is
not an exotic input: array-wrapping every element is ordinary generic XML-to-JSON converter output,
which is how a C-CDA or v2 feed commonly reaches a FHIR surface.

Three changes, all in the fail-safe direction, none affecting a conformant document:

- **The negation reads see through the wrapper.** `isRetracted` and every classified negation in
  `readSafety` now read each value written for the element they read, whether it is a bare primitive
  or wrapped in an array. `SafetyReadout.status` and `SafetyReadout.resourceType` read through it too.

- **The type gate is read fail-safe.** A type-scoped negation (`not-taken`, `not-done`, "no known
  allergy") is looked for only once the gate names the type, so a `resourceType` that is array-wrapped
  or written twice used to suppress the negation entirely. Every type the document names is now
  considered. `{"resourceType":["MedicationStatement"],"status":["not-taken"]}` and
  `{"resourceType":"Observation","resourceType":"MedicationStatement","status":"not-taken"}` both
  report `not-taken`.
- **The library stops affirming.** A new `ARRAY_WRAPPED_SCALAR` validation issue (`error`,
  `structure`) is raised for an array around `resourceType` or around one of the single-valued safety
  elements (`status`, `clinicalStatus`, `verificationStatus`, `doNotPerform`, `code`) on a resource
  root, so `validateResource` cannot return `valid` for such a document. `readSafety` reports the same
  locations on the new `SafetyReadout.arrayWrappedScalars`, sets `safeToSummarize` to `false`, and
  `assertSafeToSummarize` throws.

The check is scoped to those elements on a resource root deliberately: R4 does define repeating
elements under the same names elsewhere (`Questionnaire.code`, `ElementDefinition.code` are both
`0..*`), and flagging those would be a false error on a conformant document. Deciding cardinality
anywhere else needs a per-resource model, which this library does not have.

One wrapper is deliberately not covered: an array around a `Coding.system` / `Coding.code` inside a
`CodeableConcept`. Those are `0..1` too, so a negation written inside one is still missed and no
location is reported for it. Unlike the element-level wrapper, those values feed a `system` x `code`
cross-product, so any rule that yields more than one value on either side invents a pair the sender
never wrote, and one of the pairs matched there is a recorded "no known allergy", a positive clinical
assertion. Missing a retraction withholds information; asserting an absence of allergy does not. That
read is unchanged, and the bound is pinned by test.

`SafetyReadout` gains a field and `safeToSummarize` now returns `false` for these documents, where it
previously returned `true`. No conformant resource changes behaviour, and the codec, the element
model, and `parseResource` / `serializeResource` are untouched.
