---
"@cosyte/fhir": patch
---

The `UNSERIALIZABLE_ELEMENT_NAME` refusal no longer tells the caller that the JSON writer encodes the
model correctly.

The runtime message ended "serializeResource encodes this model correctly", and it reached consumer
logs. That is a claim about the whole model and it is false: `serializeResource` has its own declared
exceptions, so a model refused for a name it cannot write as a tag can still carry one of them.
Measured rather than argued:
`{"resourceType":"Observation","name":[[{"family":"X"}]],"zz value="1"/><status":1}` reads with
`UNKNOWN_PROPERTY` and `NESTED_ARRAY`, is refused by `serializeResourceXml`, and comes back out of
`serializeResource` with `"name":[[{"family":"X"}]]` intact, which is an array inside an array and the
first entry on that writer's own exception list.

The message now says only what the refusal does not reach: `serializeResource` escapes a member name,
so this refusal never reaches it and that route stays open. That is the wording the `div` refusal
beside it already carried, so a caller no longer gets two contradictory accounts of the same
situation from the same module. The predicate's own documentation carried the same wide sentence and
is corrected with it; a test now falsifies the old wording rather than describing the correction.

Development tooling in the same change, with no runtime effect. The base-vs-head read differential's
negative control could not distinguish a changed tree from a clean one. It keyed on a hand-written
document whose reading "this slice moves", to be re-keyed every slice; it was re-keyed once and went
stale twice, and both times the slice it named had already merged, so base and head agreed on that
document and the control fired on a modified tree and on an unmodified one alike. Red in both states
is a constant rather than an alarm, and it cleared neither, so every zero measured behind it was
inadmissible. It also compared a narrower reading than the report it was clearing, leaving out the
emitted XML, the leaf values, the re-read outcome and whether the document threw, which is precisely
the axis the two preceding changes moved.

The hand-keyed document is deleted rather than reworded a third time, and three arms replace it: the
two trees are compared over the bytes actually imported rather than over a ref name, one perturbed
copy of the codec per method must be visible to the comparison the report scores with, and a
conformant narrative must not move. Only the third is slice-relative, so nothing here needs re-keying
for the next change. The comparison is now shared with the report, so the control can never again be
narrower than the thing it clears, and its polarity is asserted on both sides by tests: red on a
clean tree, green on a changed one, and red for a change confined to the XML writer under the
comparison the old control used.

Two gaps are declared rather than closed, because closing either would make the control red on every
run for a blindness this change does not fix. The JSON-fixtures section of the report scores with a
comparison this control is not handed. And every perturbation is exercised on a document whose writes
succeed, so a change to which refusal a writer raises is not covered: the harness records every refusal as one sentinel
and its reading carries no refusal code, so swapping one for another moves nothing. Both are named
where a reader meets them, and the report no longer attributes a zero to a cause it cannot know.

Every count this area reports remains bounded by the same caveat it has carried throughout: the
corpus is hand-authored XML fixtures plus mutations, not the FHIR R4 published-examples corpus.
