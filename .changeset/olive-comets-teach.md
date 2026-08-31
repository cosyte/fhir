---
"@cosyte/fhir": patch
---

The published documentation is a full set rather than a single overview page: installation, a
quickstart, core concepts, guides, current limits and troubleshooting, each reachable from the
sidebar and each written against the package as it exists at this commit.

A reader can now install the package, parse a resource, read a clinically meaningful value off it
and get a validation verdict without leaving the documentation. Core concepts covers the
schema-free model, why `decimal` and `integer64` are kept as exact lexical text rather than
JavaScript numbers, the JSON and XML codecs including the XML reader's refusal of any `DOCTYPE` or
non-predefined entity, the validation layers, and the value-free `OperationOutcome` contract, under
which a finding carries a coded reason and a location but never the value it was raised over.
Current limits states what the package does not do: no bundled terminology or profile content, US
Core and vendor profiles supplied by the caller, no typed per-resource models, and the two verdicts
that report "not checked" rather than passing quietly. Troubleshooting gives every documented
refusal and degraded reading an entry naming the coded reason it carries and the action to take.

The set is now graded on every test run, so it cannot drift back into a stub or away from the code
in silence. The gate covers brace safety for the documentation site's build, links and sidebar
entries, agreement with `package.json` on the package name, module format, supported Node range and
registry availability, a declared synthetic identifier behind every example value, the absence of
any claim that a part of the set is missing while it is present, coded reasons that the package
really defines, and compilation plus the stated result of every TypeScript sample.

No runtime change: nothing under `src/` was touched and the public API is unchanged.
