---
"@cosyte/fhir": patch
---

The FHIRPath invariant engine now decides more of the constraints US Core carries, where it used to
report them `INVARIANT_UNCHECKED`. Of the constraints on the US Core 6.1.0 resource profiles it now
evaluates 24 of 29 (16 before), and of those on US Core 9.0.0, 29 of 34 (19 before).

- **FHIR-type tests** (`is`, `as` and `ofType`, and the `is()` / `as()` functions) are answered where
  the resource itself establishes the element's type: a choice element such as `valueQuantity` on an
  Observation is a `Quantity`, the resource is the type its `resourceType` names, and a primitive
  value is never a complex type (so `gender is Quantity` is `false`). `Age`, `Count`, `Distance` and
  `Duration` count as a `Quantity`. So US Core 9.0.0's `us-core-3` now reports a `valueQuantity`
  whose `system` is not UCUM as `INVARIANT_VIOLATED`, and its smoking-status rules `us-core-24` and
  `us-core-25` are decided from the value present.
- **`matches()`** is answered over a single string and a pattern made of literal characters, `.`,
  `^` and `$`, character classes and ranges, groups, alternation and the greedy quantifiers. A value
  followed by a line feed does not match a pattern ending in `$`.

Limits, in the same place as the capability:

- Everything else is still reported `INVARIANT_UNCHECKED`, never treated as passing: a type test on
  an element that is not a choice element of the resource (`Observation.issued is instant`), on a
  choice inside `component` or an extension, between two different primitive types, or naming a type
  this package does not know; a `matches()` pattern using `\d`, `\w`, `\s`, `\b`, back-references,
  lookaround, flags, lazy quantifiers or a quantified group that itself repeats; and `toString()`,
  `substring()`, `toInteger()`, `iif()`, arithmetic and `resolve()`, so US Core's `us-core-1`,
  `us-core-17` and `provenance-1` stay unchecked.
- A profile constraint on a slice, such as US Core's identifier-format rules on
  `Organization.identifier:NPI`, and a constraint on a primitive element, such as `us-core-1` on
  `effectiveDateTime`, are not evaluated by `validateResource` at all. `evaluateInvariant` decides
  the identifier patterns when called directly.
- US Core 6.1.0's `us-core-3`, evaluated as published, does not check the unit system: from the
  Quantity it is anchored on, `value` selects the number, which is never a Quantity, so it holds for
  every `system`. US Core 9.0.0's version of the rule is the one that checks it.
- A constraint that is now decided can report a finding where it used to report `INVARIANT_UNCHECKED`,
  including over an absent element: `deceased.is(boolean)` on a Patient with no `deceased[x]` is not
  satisfied. No finding the validator reported before is withdrawn or changes severity.
