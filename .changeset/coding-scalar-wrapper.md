---
"@cosyte/fhir": patch
---

An array around a `Coding.system` or `Coding.code` inside a `CodeableConcept` read as absent, so a refuted allergy read as active, a recorded "no known allergy" read as an allergy to SNOMED `716186003`, and a retracted Condition read as live.

`Coding.system` and `Coding.code` are `0..1` (datatypes.html), so a generic XML-to-JSON converter
array-wraps them exactly as it wraps the element above them. The previous release closed the
element-level wrapper but left this one, and it lands on the three sharpest reads in the library:
`{"resourceType":"AllergyIntolerance","code":{"coding":[{"system":"http://snomed.info/sct","code":["716186003"]}]}}`
is a recorded absence of allergy that read back as an allergy **to** that code.

**The read now sees through the wrapper, but only where it holds exactly one array position**, and
that restriction is the whole safety property rather than caution. `Coding.system` and `Coding.code`
feed `codingsOf`'s `system` x `code` cross-product, so any rule yielding more than one value on
either side would pair a `system` the sender wrote in one position with a `code` it wrote in another
and **assert a coding the sender never wrote**. One coding matched here is the recorded "no known
allergy", which is a *positive* clinical assertion: inventing it claims a patient has no known
allergy over a record that names an allergen. Missing a retraction withholds information; asserting
an absence of allergy does not, so the two directions are not equally safe.

At most one value per written member is what satisfies both at once. The cross-product keeps exactly
the arity it had when a wrapper read as nothing, so unwrapping can only fill in a value and can never
add a pair. Equivalently, and this is the property the tests pin: a single-position wrapper is
**transparent**, yielding the same codings as the same document with the wrapper removed. Reading a
wrapper therefore decides nothing on its own. Where a document also repeats a property name inside a
`Coding`, the pre-existing cross-product over the repeated name can still produce a combination the
sender did not write, exactly as it does with no wrapper present; that document is reported with a
duplicate-property error and is never affirmed as summarizable.

"One position" counts **array positions, not string values**. A JSON `null` inside a primitive array
is a real position whose value is absent and whose `_`-sibling may still carry an extension, not
padding, so `["716186003", null]` is two positions and is not read.

**A wrapper that is not read is reported instead.** Every array wrapper on a `Coding.system` /
`Coding.code` inside a `CodeableConcept`-valued safety element (`clinicalStatus`,
`verificationStatus`, `code` on a safety resource type) now draws an `ARRAY_WRAPPED_SCALAR` error
with its location in `SafetyReadout.arrayWrappedScalars`, and `safeToSummarize` is `false`. That
holds for the single-position case too: the encoding is a shape FHIR JSON does not define, so an
affirmative verdict over it is not this library's to give. Without it, a multi-position wrapper would
be a negation the library declined to read and then affirmed over anyway.

Unlike the element level, this needs no per-resource cardinality model and cannot report a conformant
document as broken: `Coding` is a datatype whose `system` and `code` are `0..1` wherever it appears.

**Scope.** This covers the codings of `clinicalStatus`, `verificationStatus` and `code`, the elements
a safety verdict is read out of. A `Coding` anywhere else, including `category`, `interpretation`,
`referenceRange.type`, a `component`'s own `code`, and anything `codingsOf` is pointed at directly, is
read exactly as before, without the wrapper. Reading a wrapper that is not also reported would resolve
a clinical code out of an encoding FHIR JSON does not define and return it with no diagnostic
anywhere, which can retire a true finding rather than a false one.

One asymmetry is deliberate: the `ARRAY_WRAPPED_SCALAR` location is emitted only on a resource of one
of the safety types, whereas the retraction and refutation reads are not restricted by resource type.
So on another resource type a wrapped `verificationStatus.coding.code` is read without a location
being reported. That is the fail-safe direction: such a read can only add a retraction or a negation,
never withhold one, and no type-scoped verdict is reached for that resource anyway. Restricting the
read to match would make retractions go unreported that are caught today.

Reading a wrapper can now retire an invariant finding the unread version emitted (`ait-1`, `con-4`),
and in those cases the retired finding was **false**: the sender did write the code the invariant
asked for. It can never make a document valid, because the wrapper that made the value readable is
itself an error on the same `Coding`.

No public API is added or changed. A conformant document reads exactly as before.
