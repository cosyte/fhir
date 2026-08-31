---
id: guides
title: Guides
sidebar_position: 5
---

# Guides

The tasks readers actually arrive with, each one end to end.

## Accept JSON and XML without writing the code twice

Both codecs produce the same model, so the format belongs at the edge of your program and nowhere
else. Sniff it once, and everything downstream is format-blind:

```ts
import { parseResource, parseResourceXml, readSafety } from "@cosyte/fhir";
import type { ReadResult } from "@cosyte/fhir";

const read = (payload: string): ReadResult =>
  payload.trimStart().startsWith("<") ? parseResourceXml(payload) : parseResource(payload);

const fromJson = read('{"resourceType":"Observation","status":"final"}');
const fromXml = read('<Observation xmlns="http://hl7.org/fhir"><status value="final"/></Observation>');

readSafety(fromJson.resource).status; // => "final"
readSafety(fromXml.resource).status; // => "final"
```

Both readers hand back diagnostics on the same channel, so one logging path covers both.

## Decide whether a resource is safe to summarize

Before a resource is rolled into a summary, a card or a feed, ask whether anything in it changes the
meaning of what you are about to show. `readSafety` answers that in one call, over the whole
document rather than its root alone:

```ts
import { parseResource, readSafety } from "@cosyte/fhir";

const { resource } = parseResource(
  '{"resourceType":"Observation","status":"entered-in-error","code":{"text":"synthetic"}}',
);

const safety = readSafety(resource);

safety.status; // => "entered-in-error"
safety.retracted; // => true
safety.negations; // => ["entered-in-error"]
```

`negations` is the authoritative field. The single-valued conveniences beside it, such as `status`
and `retracted`, describe the resource you handed in, while `negations` covers every resource inside
it too, so a retracted entry in a Bundle is visible there and nowhere else.

When a summary must refuse rather than warn, `assertSafeToSummarize` is the executable form of the
same rule: it throws for an unhandled modifier, a value the document left ambiguous, and the other
shapes that make an affirmative summary unsafe.

## Validate against your own profiles

No profile content is bundled. US Core and vendor profiles are supplied by the caller, which means
the library never claims conformance to a version of a profile you did not choose. Load a published
`StructureDefinition` with `loadStructureDefinition`, or author one in code:

```ts
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

A starter kit of small, specification-grounded profiles ships with the package as worked examples.
They are built through the same public authoring call you would use, so there is nothing privileged
about them:

```ts
import { STARTER_PROFILES, parseResource, validateResource } from "@cosyte/fhir";

const { resource } = parseResource(
  '{"resourceType":"Observation","status":"final","code":{"text":"synthetic"}}',
);

const outcome = validateResource(resource, { profiles: [...STARTER_PROFILES] });

outcome.issues.some((issue) => issue.code === "CARDINALITY_MIN"); // => true
```

## Check codes without a terminology server

Terminology checks are content-free by default. The library knows code system identities, not their
contents, so with no service supplied it verifies that a coding names a system it recognises and
that a binding's strength is respected, and it never invents a membership answer:

```ts
import { isKnownSystem, LOINC_SYSTEM } from "@cosyte/fhir";

isKnownSystem(LOINC_SYSTEM); // => true
isKnownSystem("http://example.org/not-a-code-system"); // => false
```

Supply a terminology service through the validation options when you need real membership answers.
Findings that came from a service can carry the code system release the answer was made against, so
a verdict can be re-read later against the version that produced it.

## Preserve what you cannot interpret

A read is lenient and a write is conservative, which together give a useful property: a document you
do not fully understand still round-trips. An element the reader did not expect is preserved and
reported rather than dropped:

```ts
import { parseResource, serializeResource, validateResource } from "@cosyte/fhir";

const source =
  '{"resourceType":"Observation","status":"final","code":{"text":"synthetic"},"vendorField":"kept"}';
const { resource } = parseResource(source);

validateResource(resource).issues.map((issue) => issue.code); // => ["UNKNOWN_ELEMENT"]
serializeResource(resource) === source; // => true
```

`UNKNOWN_ELEMENT` is a warning on a lenient read and an error in strict mode, which is the mode to
use when you are the one emitting a document rather than the one receiving it.

If the write cannot be done without inventing or losing content, it is refused with a coded reason
instead. [Troubleshooting](./troubleshooting.md) lists the refusals and what each one means.
