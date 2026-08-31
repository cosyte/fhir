---
id: limits
title: Current limits
sidebar_position: 6
---

# Current limits

What the package does not do, in its own words. Everything here is a deliberate boundary, and each
one is stated because working around a limit you know about is cheap, while discovering one in
production is not.

## It is not on the public registry

`@cosyte/fhir` is pre-alpha and cannot be installed from npm today. The
[installation](./installation.md) page has the route that does work.

## No terminology content is bundled

The library knows code system identities, not their contents. There is no bundled SNOMED CT, LOINC,
CPT, RxNorm or ICD content, and there never will be: those are licensed distributions, and vendoring
them into a parser is both a licensing problem and a staleness problem.

What that means in practice:

- a coding is checked for a system this library recognises, and for the binding strength the element
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

## Two verdicts that say "not checked" rather than passing

Both of these are findings the validator emits rather than silently letting something through. If
you treat any non-error finding as a pass, you will misread them.

- `INVARIANT_UNCHECKED`: a profile constraint whose FHIRPath expression is outside the bounded
  expression subset this library evaluates. It is reported as informational, and it means the
  invariant was **not** evaluated, not that it held.
- `PROFILE_SLICE_UNCHECKED`: a slice whose discriminator this library cannot apply, including the
  `position` discriminator, which is not part of the R4 discriminator set. Again, it means the slice
  membership was not decided, not that it matched.

Both exist because the alternative, staying quiet, is indistinguishable from a pass to every
consumer downstream.

## R4 first

FHIR R4 (`4.0.1`) is the modeled target. R5 and DSTU2 documents can be read, because the model is
schema-free, but they are not validated against their own definitions. Treat cross-version reads as
data recovery, not conformance.

## Reported, not repaired

Several non-conformant shapes are read, reported, and deliberately not fixed. Character data written
directly on an element in XML is the clearest example: FHIR carries a value in an attribute, so text
in that position has no slot on the model and is dropped, with a finding. The package reports the
drop rather than guessing what the sender meant.

The same posture governs the writers. When a model cannot be spelled back into the target format
without inventing or losing content, the write is refused with a coded reason instead of emitting
something plausible. [Troubleshooting](./troubleshooting.md) covers what each refusal means.
