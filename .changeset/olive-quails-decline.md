---
"@cosyte/fhir": patch
---

Slice resolution no longer discards a prohibition it also holds a requirement for, so a profile that
forbids what it requires stops admitting the occurrences it excludes (`FHIR-XML-WRITE-RESIDUALS`).

An `exists` discriminator decides slice membership by whether a path is present, and slice
resolution derives that expectation from the slice descendant's cardinality: required means present,
prohibited means absent. The two bounds were read as an ordered pair with `min` first, so a
descendant stating `min 1` beside `max 0` never reached the prohibition at all.

That pair is not a hypothetical shape. It is what snapshot generation composes when a differential
forbids with `0..0` an element the base resource makes required, taking the tighter of the two lower
bounds. Snapshot generation is deliberately left composing it: a clamp of the tightened bound
against `max` was tried there and reverted, because it lowered the enforced bound below the
inherited one whenever the differential's own `max` sat under it, which reaches ordinary profile
mistakes rather than only contradictory ones.

Measured before the change, against a profile slicing `Observation.component` on an `exists`
discriminator over `dataAbsentReason`, with a `Missing` slice requiring at least one occurrence and
a descendant composed to `min 1 / max 0`, validating an `Observation` whose single component carries
`dataAbsentReason`: one error came back, a `CARDINALITY_MAX` at the element. The occurrence carrying
the forbidden element had been assigned to the slice, which under `closed` slicing retired a
`PROFILE_SLICE_UNMATCHED` and, because the slice then counted as satisfied, its own
`CARDINALITY_MIN`. Three errors come back now.

The contradiction is recorded rather than resolved. `SliceDefinition` carries a new
`unsatisfiableExists` set beside `existsExpectations`, holding the relative paths a slice fixes as
present and absent at once, and an `exists` discriminator on such a path assigns no occurrence to
that slice. Keeping it apart from the boolean map is the point rather than an implementation detail:
neither boolean is true of a contradiction, and picking one admits documents the profile forbids.

The answer is "no", not "unevaluable", and the difference is the whole decision. An unevaluable
discriminator reports the slicing unchecked, and that report returns before the unmatched-occurrence
and slice-cardinality checks run, so it would have retired the very findings this case exists to
draw while looking like a fail-safe. It is not a guess either: no instance has a path both present
and absent.

The change is scoped to a contradiction at a discriminator path, and to a `max` of zero alone. A
slice whose descendant is unsatisfiable is not unmatchable in general, because membership is decided
by the discriminators and an occurrence may legitimately be assigned to a slice it then violates;
marking the whole slice unmatchable would move real violations to "unmatched" and hide them. And a
descendant stating `min 2` beside `max 1` is unsatisfiable by count while still saying something
unambiguous about presence, so it keeps its existing expectation, as do a plainly required
descendant, a plainly prohibited one, and one stating no bound at all.

It is scoped to the slice's own descendants too. This walk sweeps every element under the slice's id
prefix, and a re-slice of a descendant sits under that prefix and flattens onto the same relative
path, so recording its contradiction made the satisfiable outer slice unmatchable and drew two
errors on a conformant document: it blamed the instance for a statement belonging to a different
slice. Re-slicing is a declared deferral of this module, so a contradiction carried only by a
re-slice is left reading as it did before.

Findings are retired as well as drawn, and the classes are named rather than counted. An occurrence
that is no longer wrongly admitted stops counting toward the slice, so a slice-level
`CARDINALITY_MAX` fired by that count is gone; and because the match loop stops at the first
matching slice, refusing the admission also de-shadows the slices after it, and whatever they then
do, match, or turn out unevaluable and take the whole slicing to unchecked, the findings their
emptiness had earned go with it. In the unevaluable case that is not confined to one slice's codes:
every slice arm for that slicing is skipped, so a third slice's `CARDINALITY_MAX` goes too and an
evaluated slicing becomes an unevaluated one, reported as the usual `PROFILE_SLICE_UNCHECKED`. Each
retired finding existed only because of the wrongful admission, and no verdict moves to valid
through any of them, but they are disclosed rather than left to be found.

Where the contradiction sits on the slice's own descendant, that descendant is also checked at
element level and is unsatisfiable for every count, so an error stands on each present parent
occurrence whichever way the instance goes. That is not a general bound and is not offered as one:
slice elements are skipped by the element-level walk, so a contradiction carried only by a re-slice
would not have been checked anywhere, which is why the record is scoped to the slice's own
descendants.

Deliberately unchanged. Snapshot generation still overlays a differential `max` verbatim, which is
the mirror of this defect and what composes the pair in the first place;
`ElementDefinition.mustSupport` and `ElementDefinition.slicing.ordered` are still unread from XML;
the `type`, `profile` and R5 `position` discriminators still report the slicing unchecked, since
nothing here widened what can be evaluated without a FHIRPath engine; and re-slicing remains
deferred, a re-slice's own constraints reaching neither membership nor the element-level walk.

The figures here come from hand-authored JSON and XML fixtures plus mutations and probes, not from
the R4 published-examples corpus.
