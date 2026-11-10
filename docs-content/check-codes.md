---
id: check-codes
title: Check codes without a terminology server
sidebar_label: Check codes
description: "Check that a coding names a known code system and respects its binding strength, and plug in a terminology service when you need membership answers."
---

# Check codes without a terminology server

Terminology checks are content-free by default. The library knows code system identities, not their
contents, so with no service supplied it verifies that a coding names a system it recognizes and
that a binding's strength is respected, and it never invents a membership answer:

```ts runnable
import { isKnownSystem, LOINC_SYSTEM } from "@cosyte/fhir";

isKnownSystem(LOINC_SYSTEM); // => true
isKnownSystem("http://example.org/not-a-code-system"); // => false
```

A coding whose system the library does not recognize draws an informational finding, located at
its `system`, and leaves the verdict alone:

```ts runnable
import { parseResource, validateResource } from "@cosyte/fhir";

const { resource } = parseResource(
  '{"resourceType":"MedicationRequest","status":"active","intent":"order","subject":{"reference":"Patient/syn-0001"},"medicationCodeableConcept":{"coding":[{"system":"http://example.org/local-drugs","code":"X1"}]}}',
);

const outcome = validateResource(resource);

outcome.valid; // => true
outcome.issues.map((issue) => [issue.code, issue.severity]); // => [["CODE_SYSTEM_UNKNOWN", "information"]]
outcome.issues.map((issue) => issue.expression); // => ["MedicationRequest.medicationCodeableConcept.coding[0].system"]
```

## Plug in a terminology service

Supply a terminology service through the validation options when you need real membership answers.
The service receives only the value set, the system and the code, never the resource, and answers
`"in"`, `"not-in"` or `"unknown"`. Without a service, the same document draws no membership finding
at all: silence about membership is not a claim that the code is in the value set.

```ts runnable
import { parseResource, RXNORM_SYSTEM, validateResource } from "@cosyte/fhir";
import type { TerminologyService } from "@cosyte/fhir";

// A stand-in for a real terminology server: it knows one invented code and nothing else.
const service: TerminologyService = {
  validateCode({ system, code }) {
    if (system !== RXNORM_SYSTEM) return { membership: "unknown" };
    return { membership: code === "1000001" ? "in" : "not-in", systemVersion: "2026-08-04" };
  },
};

const request = (code: string) =>
  parseResource(
    `{"resourceType":"MedicationRequest","status":"active","intent":"order","subject":{"reference":"Patient/syn-0001"},"medicationCodeableConcept":{"coding":[{"system":"${RXNORM_SYSTEM}","code":"${code}"}]}}`,
  ).resource;

validateResource(request("1000001"), { terminology: service }).valid; // => true

const outcome = validateResource(request("1000002"), { terminology: service });

outcome.valid; // => false
outcome.issues.map((issue) => issue.code); // => ["CODE_NOT_IN_VALUESET"]
outcome.issues.map((issue) => issue.codeSystemVersion); // => [{ declared: true, version: "2026-08-04" }]

validateResource(request("1000002")).issues; // => []
```

A service should answer `"unknown"` when it cannot decide, never throw or guess. A finding that came
from a service carries the code system release the service declared, exactly as it declared it, so a
verdict can be re-read later against the release that produced it; a service that declares none is
recorded as undeclared.

## Reference

- [`isKnownSystem`](./api/README.md#isknownsystem), [`KNOWN_SYSTEMS`](./api/README.md#known_systems)
  and the system constants such as [`LOINC_SYSTEM`](./api/README.md#loinc_system).
- [`TerminologyService`](./api/README.md#terminologyservice), the interface a service of your own
  implements, passed as `terminology` in [`ValidateOptions`](./api/README.md#validateoptions), and
  the [`CodeValidationResult`](./api/README.md#codevalidationresult) it returns.
- [`TERMINOLOGY_BINDINGS`](./api/README.md#terminology_bindings), the bindings the validator checks
  without being told, and `bindings` in `ValidateOptions` to add your own.
- [Current limits](./limits.md#no-terminology-content-is-bundled) explains why no terminology
  content ships with the package.
