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
organization (the readout does not assess that resource at all, as the next section shows), and an
ended `period` on an entry whose `use` is current.

## A resource type the readout does not model

The statuses that withdraw or cancel a record differ by resource type: `revoked` on a service
request, `cancelled` on an encounter, `inactive` on a nutrition product. The safety readout knows
what they mean for the types it models, which are `AllergyIntolerance`, `Condition`,
`DiagnosticReport`, `Immunization`, `MedicationRequest`, `MedicationStatement`, `Observation`,
`Patient`, `Practitioner`, and `Bundle` as a container whose entries are each judged. For any other
type it cannot tell a current record from a withdrawn one, so it does not assess it: the resource's
location is on `notAssessed` and the resource is never safe to summarize, whatever status it carries.
That holds wherever the resource sits: at the root, in `contained`, in a Bundle entry or a Bundle
entry's `response.outcome`, or in a `Parameters` parameter. A resource at one of those positions
that names no type at all is not assessed either, so a Bundle entry with no `resourceType` and a
status of `entered-in-error` is never safe to summarize. What is a resource is decided by position
alone: a `resourceType` written anywhere else, such as on a Bundle entry itself, does not make that
node a resource and does not hide the entry's resource, and the node that carries it is listed on
`notAssessed` too.

```ts runnable
import { parseResource, readSafety } from "@cosyte/fhir";

const request = readSafety(
  parseResource('{"resourceType":"ServiceRequest","status":"revoked","intent":"order"}').resource,
);

request.status; // => "revoked"
request.notAssessed; // => ["ServiceRequest"]
request.safeToSummarize; // => false

const bundle = readSafety(
  parseResource(
    '{"resourceType":"Bundle","type":"collection","entry":[' +
      '{"resource":{"resourceType":"Observation","status":"final","code":{"text":"synthetic"}}},' +
      '{"resource":{"resourceType":"Encounter","status":"cancelled"}}]}',
  ).resource,
);

bundle.notAssessed; // => ["Bundle.entry[1].resource"]
bundle.safeToSummarize; // => false
```

The reads that need no type still run on such a resource, so an `entered-in-error` or `not-done`
status there is still on `negations`. An empty `negations` beside a non-empty `notAssessed` means
nothing was looked for, not that nothing was found. To summarize a type the readout does not model,
read its status yourself against that type's definition first.

## An element the format does not define

A resource of a type the readout assesses is read element by element against what the FHIR R4 and
R4B definitions say may be written there, at every depth: its own members, its backbone elements,
its datatypes, its extensions and the extensions on its primitive values. An element neither release
defines (`entry` on a `Patient`, `Entry` or `Contained` in the wrong case, an extra key on a Bundle
entry or a coding, a member of an object written where a primitive value belongs, a `resourceType`
on a Bundle entry) is listed on `notAssessed` by its own location, and the resource is never safe to
summarize. So is an XML element in a namespace other than its parent's, however the namespace is
declared: `<status xmlns="urn:vendor" value="final"/>` is spelled like the FHIR `status` and is not
one, and neither is an element under `xmlns=""`. Only the narrative `div` in the XHTML namespace is
exempt. No valid document carries one, but the reader keeps it, and a summary that walked the whole
model would read whatever sits under it, a retraction included. `validateResource` reports the same
elements as `UNKNOWN_ELEMENT`, a warning when lenient and an error when strict.

A value written where the definitions put a complex type (`"code": "x"` on an `Observation`, or
`<code value="x"/>`) is listed on `notAssessed` too, since a summary would read the string as the
element. `validateResource` does not report it as `UNKNOWN_ELEMENT`: the element name is defined.

```ts runnable
import { parseResource, readSafety, validateResource } from "@cosyte/fhir";

const { resource } = parseResource(
  JSON.stringify({
    resourceType: "Bundle",
    type: "collection",
    entry: [
      {
        resource: { resourceType: "Patient", id: "syn-pt-0001" },
        note: { status: "entered-in-error" },
      },
    ],
  }),
);

const safety = readSafety(resource);
safety.notAssessed; // => ["Bundle.entry[0].note"]
safety.safeToSummarize; // => false

const unknown = validateResource(resource, { mode: "strict" }).issues.filter(
  (issue) => issue.code === "UNKNOWN_ELEMENT",
);
unknown.map((issue) => issue.expression); // => ["Bundle.entry[0].note"]
```

A name either release defines is defined, so an R4B document is read as it is written. Below a
resource of a type the readout does not assess, nothing is checked: that resource is listed as a
whole.

## Refuse instead of warn

When a summary must refuse rather than warn, `assertSafeToSummarize` is the executable form of the
same rule: it throws a `FhirSafetyError` for an unhandled modifier, a value the document left
ambiguous, a resource the readout does not assess, an element the definitions do not define, and
the other shapes that make an affirmative
summary unsafe. The error carries the
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
