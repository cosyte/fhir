---
id: limits
title: Current limits
sidebar_position: 6
description: What @cosyte/fhir deliberately does not do, such as bundle terminology or profiles or offer typed per-resource models, and the findings that mean a check did not run.
---

# Current limits

What the package does not do, in its own words. Everything here is a deliberate boundary, and each
one is stated because working around a limit you know about is cheap, while discovering one in
production is not.

## No terminology content is bundled

The library knows code system identities, not their contents. There is no bundled SNOMED CT, LOINC,
CPT, RxNorm, or ICD content, and there never will be: those are licensed distributions, and vendoring
them into a parser is both a licensing problem and a staleness problem.

What that means in practice:

- a coding is checked for a system this library recognizes, and for the binding strength the element
  declares;
- membership of a code in a value set is not answered unless you supply a terminology service;
- with no service supplied, the checks degrade to that content-free level and never produce a false
  error. Silence about membership is not a claim of validity.

## No profile content is bundled

US Core and vendor `StructureDefinition`s are caller-supplied. The package validates against
whatever profiles you hand it, with snapshot generation, slicing, fixed and pattern values, and
must-support treated as a system obligation rather than an instance requirement.

The consequence to plan for: "validated" here means "validated against the profiles you supplied".
The library never asserts conformance to a version of US Core you did not pass in, because the
alternative is a claim about an implementation guide release that may not be the one your trading
partner is on.

## No typed per-resource models

There is no generated TypeScript interface per resource type, and no `Patient` or `Observation`
class. The model is schema-free, and elements are reached by name through small helpers.

This is the cost side of the trade that makes a lenient read safe: a schema-free tree cannot drop an
element it has no field for, but it also cannot offer compile-time completions for a resource's
elements. If you want typed access to a handful of elements, wrap the helpers in your own accessors
at the edge of your program.

## Verdicts that say "not checked" rather than passing

Each of these is a finding the validator emits rather than silently letting something through. If
you treat any non-error finding as a pass, you will misread them.

- `INVARIANT_UNCHECKED`: a constraint whose FHIRPath expression is outside the bounded expression
  subset this library evaluates, whether a profile supplied it or R4 declares it on the resource
  type. It is reported as informational, and it means the invariant was **not** evaluated, not that
  it held. With no profile, the one base constraint reported this way is `dom-3` on a resource that
  carries a contained resource: checking that every contained resource is referenced needs
  reference resolution the subset does not have. With nothing contained, `dom-3` holds by its own
  terms and nothing is reported, also when a supplied profile carries R4's `dom-3` as written. A
  profile's constraint under that key written any other way is its own expression, and is reported
  unchecked like any other the subset cannot evaluate.
- `PROFILE_SLICE_UNCHECKED`: a slice whose discriminator this library cannot apply: a `type` or
  `profile` discriminator, or the `position` discriminator, which is not part of the R4 discriminator
  set. Again, it means the slice membership was not decided, not that it matched. A slice's own
  constraints apply only to the occurrences assigned to it, so under an undecided slicing they are
  not checked either.
- `PROFILE_SLICE_NO_SLICING`: a profile naming a slice (`Observation.component:coded`) under an
  element that declares no `slicing`, or that is missing from the snapshot. Nothing in the profile
  says which occurrences belong to the slice, so none is assigned to it, and the slice's own
  constraints are not checked. It is reported at information, once per present parent.

All of them exist because the alternative, staying quiet, is indistinguishable from a pass to every
consumer downstream.

## R4 first

FHIR R4 (`4.0.1`) is the modeled target. R5 and DSTU2 documents can be read, because the model is
schema-free, but they are not validated against their own definitions. Treat cross-version reads as
data recovery, not conformance.

## Reported, not repaired

Several non-conformant shapes are read, reported, and deliberately not fixed. Character data written
directly on an element in XML is the clearest example. FHIR carries a primitive's value in an
attribute, so text in that position is non-conformant. On a primitive element the reader takes the
text as the value, so the safety readout still sees a status or a dose written that way, and the
read is reported: validation raises an error, the resource is not safe to summarize, and both
writers refuse it. On a complex element the text has no slot in the model and is dropped, with a
finding. Either way the package reports the shape rather than guessing what the sender meant.

The same posture governs the writers. When a model cannot be spelled back into the target format
without inventing or losing content, the write is refused with a coded reason instead of emitting
something plausible. [Troubleshooting](./troubleshooting.md) covers what each refusal means.
