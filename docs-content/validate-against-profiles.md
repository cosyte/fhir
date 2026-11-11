---
id: validate-against-profiles
title: Validate against your own profiles
sidebar_label: Validate against profiles
description: "Validate a resource against US Core, vendor or your own StructureDefinitions, which you supply, alongside the constraints R4 itself declares."
---

# Validate against your own profiles

No profile content is bundled. US Core and vendor profiles are supplied by the caller, which means
the library never claims conformance to a version of a profile you did not choose. Load a published
`StructureDefinition` with `loadStructureDefinition`, or author one in code:

```ts runnable
import { defineProfile, parseResource, validateResource } from "@cosyte/fhir";

const localObservation = defineProfile({
  url: "http://example.org/StructureDefinition/local-observation",
  name: "LocalObservation",
  type: "Observation",
  differential: [{ path: "Observation.subject", min: 1, max: 1, mustSupport: true }],
});

const { resource } = parseResource(
  '{"resourceType":"Observation","status":"final","code":{"text":"synthetic"}}',
);

const outcome = validateResource(resource, { profiles: [localObservation] });

outcome.valid; // => false
outcome.issues.map((issue) => issue.code); // => ["MUST_SUPPORT_ABSENT", "CARDINALITY_MIN"]
```

Two things to read off that result. Must-support is reported as informational, because must-support
is an obligation on a system, not a requirement that an instance carry the element. The cardinality
finding is the error, and it is the one that moves the verdict.

## Rely on the constraints R4 declares

You do not need a profile for the constraints R4 itself declares. On the eight modeled resource
types, `validateResource` evaluates them with no options at all: a patient contact with no name,
telecom, address, or organization breaks `pat-1`, an extension with both a value and nested
extensions breaks `ext-1`, and an element with no value and no children breaks `ele-1`:

```ts runnable
import { parseResource, validateResource } from "@cosyte/fhir";

const { resource } = parseResource('{"resourceType":"Patient","contact":[{"gender":"other"}]}');

const outcome = validateResource(resource);

outcome.valid; // => false
outcome.issues.map((issue) => issue.constraint); // => ["pat-1"]
```

A profile that carries one of those constraints again does not double the finding: each violation
is reported once per occurrence. And a profile carrying R4's `dom-3` as written, as every R4-derived
snapshot does, draws no finding for it on a resource with nothing contained, because that
constraint holds there by its own terms.

## Start from the starter profiles

A starter kit of small, specification-grounded profiles ships with the package as worked examples.
They are built through the same public authoring call you would use, so there is nothing privileged
about them:

```ts runnable
import { STARTER_PROFILES, parseResource, validateResource } from "@cosyte/fhir";

const { resource } = parseResource(
  '{"resourceType":"Observation","status":"final","code":{"text":"synthetic"}}',
);

const outcome = validateResource(resource, { profiles: [...STARTER_PROFILES] });

outcome.issues.some((issue) => issue.code === "CARDINALITY_MIN"); // => true
```

## Reference

- [`validateResource`](./api/@cosyte/fhir.md#validateresource), its
  [`ValidateOptions`](./api/@cosyte/fhir.md#validateoptions) and the
  [`ValidationResult`](./api/@cosyte/fhir.md#validationresult) it returns.
- [`defineProfile`](./api/@cosyte/fhir.md#defineprofile) and
  [`loadStructureDefinition`](./api/@cosyte/fhir.md#loadstructuredefinition).
- [`STARTER_PROFILES`](./api/@cosyte/fhir.md#starter_profiles) and
  [`VALIDATION_CODES`](./api/@cosyte/fhir.md#validation_codes), which lists every code a finding can carry.
- [Current limits](./limits.md#verdicts-that-say-not-checked-rather-than-passing) explains the
  findings that mean a constraint or a slice was not checked.
