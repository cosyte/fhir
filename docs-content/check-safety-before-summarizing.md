---
id: check-safety-before-summarizing
title: Decide whether a resource is safe to summarize
sidebar_label: Check safety before summarizing
description: "Read the statuses, negations and modifiers that change what a record means, and refuse a resource that cannot be summarized honestly."
---

# Decide whether a resource is safe to summarize

Before a resource is rolled into a summary, a card, or a feed, ask whether anything in it changes the
meaning of what you are about to show. `readSafety` answers that in one call, over the whole
document rather than its root alone:

```ts runnable
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

## Read modifier elements and intents

Some elements change the meaning of a record without being a status. A patient recorded as deceased,
a patient record replaced by another (`link`), and a subpotent immunization dose are each reported on
`modifierElements` with their location, whatever value they carry, and each makes the resource unsafe
to summarize. A medication request's `intent` is mandatory, so it is surfaced instead: `intents`
pairs the code with its location, and only an `intent` that is not one of the eight R4 codes refuses.

```ts runnable
import { parseResource, readSafety } from "@cosyte/fhir";

const patient = readSafety(
  parseResource('{"resourceType":"Patient","deceasedBoolean":true}').resource,
);

patient.modifierElements; // => [{ element: "deceased", location: "Patient.deceasedBoolean" }]
patient.safeToSummarize; // => false

const request = readSafety(
  parseResource('{"resourceType":"MedicationRequest","status":"active","intent":"proposal"}')
    .resource,
);

request.intents; // => [{ code: "proposal", location: "MedicationRequest.intent" }]
request.safeToSummarize; // => true
```

## Read the use of identifiers, names and addresses

An identifier, a name, an address, or a contact point can be marked `old` or `temp`, and FHIR treats
that `use` as a modifier: an old address is not where the patient lives now. `datatypeUses` pairs each
`use` with its location, on every `identifier` of the resource types the safety readout models and
on a patient's `name`, `telecom`, and `address`, including those of each `contact`. A readable code
leaves the resource safe to summarize, `old` included, because which entry to show is your decision:
nothing is filtered, reordered, or marked current for you. A `use` that is not one of the codes FHIR
defines for that datatype, such as `"OLD"` or `"maiden"` on an identifier, is located on
`unreadableDatatypeUses` instead and the resource is not safe to summarize.

```ts runnable
import { parseResource, readSafety } from "@cosyte/fhir";

const person = readSafety(
  parseResource('{"resourceType":"Patient","address":[{"use":"old","city":"Nowhere"}]}').resource,
);

person.datatypeUses; // => [{ code: "old", location: "Patient.address[0].use" }]
person.safeToSummarize; // => true

const unreadable = readSafety(
  parseResource('{"resourceType":"Patient","identifier":[{"use":"OLD","value":"SYN-0001"}]}').resource,
);

unreadable.unreadableDatatypeUses; // => ["Patient.identifier[0].use"]
unreadable.safeToSummarize; // => false
```

What this does not read: a practitioner's identifiers, names, and addresses (a practitioner's
identifier `use` is reported on `modifierElements` instead, whatever its value), a `use` carried in an
extension value, a contained resource of a type the safety readout does not model, such as an
organization, and an ended `period` on an entry whose `use` is current.

## Refuse instead of warn

When a summary must refuse rather than warn, `assertSafeToSummarize` is the executable form of the
same rule: it throws a `FhirSafetyError` for an unhandled modifier, a value the document left
ambiguous, and the other shapes that make an affirmative summary unsafe. The error carries the
locations that forced the refusal and never a value:

```ts runnable
import { assertSafeToSummarize, FhirSafetyError, parseResource } from "@cosyte/fhir";

const { resource } = parseResource(
  '{"resourceType":"Observation","status":"final","modifierExtension":[{"url":"http://example.org/local-flag","valueBoolean":true}]}',
);

const refusedAt = (): readonly string[] => {
  try {
    assertSafeToSummarize(resource);
    return [];
  } catch (err) {
    if (err instanceof FhirSafetyError) return err.locations;
    throw err;
  }
};

refusedAt(); // => ["Observation.modifierExtension[0]"]
```

Call it first in any helper that flattens a resource into a summary, so an unknown modifier stops
the summary instead of disappearing from it.

## Reference

- [`readSafety`](./api/@cosyte/fhir.md#readsafety) and the fields of
  [`SafetyReadout`](./api/@cosyte/fhir.md#safetyreadout).
- [`assertSafeToSummarize`](./api/@cosyte/fhir.md#assertsafetosummarize) and
  [`FhirSafetyError`](./api/@cosyte/fhir.md#fhirsafetyerror).
- [Troubleshooting](./troubleshooting.md#a-resource-carries-a-modifierextension-the-library-does-not-know)
  covers the unknown `modifierExtension` case and what to do about it.
