---
id: troubleshooting
title: Troubleshooting
sidebar_label: Troubleshooting
description: Every refusal and degraded reading, the coded reason it carries, and what to do about it.
---

# Troubleshooting

Every refusal and every degraded reading in this library carries a coded reason. Look the code up
here: each entry says what you are seeing, why the library behaves that way, and what to do about
it.

A fatal read is thrown as a typed error carrying a code. A non-fatal finding is returned, either on
the read result or in the validation findings, and is never thrown.

Each code below is listed, with what it means, in the API reference:
[`FATAL_CODES`](./api/@cosyte/fhir.md#fatal_codes) for the JSON reader's refusals,
[`XML_FATAL_CODES`](./api/@cosyte/fhir.md#xml_fatal_codes) for the XML reader's,
[`ISSUE_CODES`](./api/@cosyte/fhir.md#issue_codes) for the findings a read returns,
[`VALIDATION_CODES`](./api/@cosyte/fhir.md#validation_codes) for the findings validation returns,
[`SERIALIZE_ERROR_CODES`](./api/@cosyte/fhir.md#serialize_error_codes) for a refused write, and
[`NDJSON_ERROR_CODES`](./api/@cosyte/fhir.md#ndjson_error_codes) for a line of an NDJSON export that did not
read.

## The XML reader refuses a document carrying a DOCTYPE

You get a thrown error whose code is `DTD_FORBIDDEN`, and nothing is parsed.

The reader refuses every document type declaration outright. Resolving one is how external entity
attacks read files off the machine running the parser, and how a small document expands into
gigabytes of memory. Refusing is not configurable, because a switch to turn it off is a switch an
attacker only has to find once.

```ts runnable
import { FhirXmlError, XML_FATAL_CODES, parseResourceXml } from "@cosyte/fhir";

const readXml = (input: string): string => {
  try {
    parseResourceXml(input);
    return "read";
  } catch (err) {
    return err instanceof FhirXmlError ? err.code : "unknown";
  }
};

readXml('<!DOCTYPE Observation><Observation xmlns="http://hl7.org/fhir"/>'); // => XML_FATAL_CODES.DTD_FORBIDDEN
```

**What to do**: strip the declaration upstream. A FHIR XML resource has no legitimate use for a DTD,
so a sender that emits one has a serialization bug worth reporting back to them. Do not attempt to
pre-expand entities yourself before handing the document over: that reintroduces the exact exposure
the refusal exists to close.

## The XML reader refuses an entity it does not define

You get a thrown error whose code is `UNDEFINED_ENTITY`.

Only the five predefined XML entities and numeric character references are accepted. Anything else
would have to be looked up, and a lookup is either a local definition (which arrives in a DTD, see
above) or a fetch.

**What to do**: have the sender emit numeric character references or the literal characters. An
accented name spelled with a numeric reference reads fine.

## A document is refused for depth

You get a thrown error whose code is `MAX_DEPTH_EXCEEDED`, from either codec.

Both readers stop at a fixed nesting bound. Without one, a deeply nested document is a denial of
service that arrives as a stack overflow deep inside the runtime, untyped and impossible to handle
cleanly.

**What to do**: treat it as hostile or broken input rather than as a document to be recovered. If a
legitimate sender trips it, the shape of what they are sending is worth a conversation.

## The JSON reader refuses the input outright

You get a thrown error whose code is `MALFORMED_JSON`, carrying an offset into the input string (in
UTF-16 code units, not bytes) and no slice of the input.

**What to do**: check the transport before the document. Truncation at a proxy, a doubled response
body, and a mis-set encoding all arrive looking like this. The offset tells you where the reader
stopped, and the absence of a quoted fragment is deliberate: the bytes around a parse failure are as
likely to be patient data as anything else in the document.

## A property appears twice in one JSON object

You get a `DUPLICATE_PROPERTY` finding at warning severity. The document is still read.

FHIR requires unique property names and expresses repetition with an array, so a repeated name has
no defined winner. The reader keeps the first value as the element's value, keeps the shadowed one
rather than discarding it, and reports the position:

```ts runnable
import { parseResource } from "@cosyte/fhir";

const { issues } = parseResource('{"resourceType":"Patient","gender":"male","gender":"female"}');

issues.map((issue) => issue.code); // => ["DUPLICATE_PROPERTY"]
issues.map((issue) => issue.expression); // => ["Patient.gender"]
```

**What to do**: do not resolve it yourself by picking a side, and be careful about summarizing the
resource at all. A repeated property is a sender bug, and the two values can differ in ways that
matter clinically. Report the location back to the sender, and treat any single-value read of that
element as arbitrary until they fix it. Note also that a resource carrying one cannot be written
back out unchanged: the writers refuse rather than silently pick a winner.

## A resource carries a modifierExtension the library does not know

You get an `UNHANDLED_MODIFIER_EXTENSION` finding at error severity, so `valid` is false.

A modifier extension changes the meaning of the element it sits on. An unknown one cannot be
ignored, because ignoring it means processing the resource as though the modifier were not there,
which is how a negation or a retraction gets lost.

```ts runnable
import { parseResource, readSafety, validateResource } from "@cosyte/fhir";

const { resource } = parseResource(
  '{"resourceType":"Patient","modifierExtension":[{"url":"http://example.org/local-flag","valueBoolean":true}]}',
);

validateResource(resource).issues.map((issue) => issue.code); // => ["UNHANDLED_MODIFIER_EXTENSION"]
readSafety(resource).safeToSummarize; // => false
```

**What to do**: stop the automated path and route the resource to a human, or teach your integration
what that specific URL means and handle it explicitly. Do not filter the finding out to get a green
verdict. If your code summarizes resources, call `assertSafeToSummarize` first so this case throws
instead of quietly producing a summary that omits a modifier.

## A profile constraint was not evaluated

You get an `INVARIANT_UNCHECKED` finding at informational severity, carrying the constraint key.

The library evaluates FHIRPath through a bounded, in-repository subset rather than a full engine.
An expression outside that subset is reported as unchecked instead of being assumed to pass:

```ts runnable
import { defineProfile, parseResource, validateResource } from "@cosyte/fhir";

const profile = defineProfile({
  url: "http://example.org/StructureDefinition/local-observation",
  name: "LocalObservation",
  type: "Observation",
  differential: [
    {
      path: "Observation",
      constraint: [
        { key: "local-1", severity: "error", expression: "subject.resolve() is Patient" },
      ],
    },
  ],
});

const { resource } = parseResource(
  '{"resourceType":"Observation","status":"final","code":{"text":"synthetic"}}',
);

const outcome = validateResource(resource, { profiles: [profile] });

outcome.issues.map((issue) => issue.code); // => ["INVARIANT_UNCHECKED"]
outcome.issues.map((issue) => issue.constraint); // => ["local-1"]
```

**What to do**: read it as "unknown", never as "passed". If the constraint matters to you, evaluate
it yourself for now, and keep the finding in your logs so the gap is visible rather than assumed
away. Informational severity leaves `valid` true, so a pipeline that only checks `valid` will not
see it: check the findings.

## A profile slice was not decided

You get a `PROFILE_SLICE_UNCHECKED` finding at informational severity.

The slicing on that element could not be decided, and the finding's `sliceReason` says why. The
common ones: a `profile` discriminator, which this library does not decide yet
(`profile-discriminator`); a `position` discriminator, which is not part of the R4 discriminator set
(`discriminator-unsupported`); a `resolve()` whose reference points outside the resource's
`contained` set and, for a Bundle, its entries (`target-unresolved`); a slice whose `targetProfile`
names a profile you did not pass in `profiles` (`profile-unavailable`). The diagnostic text says "an
unsupported discriminator" whatever the reason, so read `sliceReason`. The
[current limits](./limits.md#verdicts-that-say-not-checked-rather-than-passing) list every reason.

**What to do**: the same as the previous entry. It means the slice membership was not decided, not
that it matched. A slice's own constraints (its fixed and pattern values, cardinalities and
invariants) apply only to the occurrences assigned to it, so none of them were checked either. For
`profile-unavailable`, pass the profile the slice's `targetProfile` names in `profiles`. For
`target-unresolved`, validate the Bundle that holds the target, or contain it. If the profile is
yours, an equivalent slice expressed with a value, pattern, or exists discriminator will be
evaluated.

## A profile slice has no slicing over it

You get a `PROFILE_SLICE_NO_SLICING` finding at informational severity.

The profile names a slice, such as `Observation.component:coded`, but the element it slices
(`Observation.component`) declares no `slicing`, or is missing from the snapshot. Without a slicing
there is no discriminator to decide which occurrences belong to the slice, so none is assigned to
it, and the slice's own constraints (its cardinality and everything under it) were not checked.

**What to do**: read it as "unknown", never as "passed". If the profile is yours, declare the
slicing on the sliced element, with a value, pattern, or exists discriminator, and the slice will
be evaluated. If it came from someone else, check that its snapshot was generated in full.

## An element is not in the base definition

You get an `UNKNOWN_ELEMENT` finding: a warning on a lenient read, an error in strict mode.

The element was preserved, not dropped. Lenient is the right default for reading somebody else's
document, and strict is the right mode for checking your own before you send it.

**What to do**: on a read, look at whether the element is a vendor extension you should be handling.
On a write, treat it as an error and fix the element before sending.

## Text written directly on an XML element

You get an `UNEXPECTED_XML_CONTENT` finding on the read. On a primitive element, validation also
raises `DROPPED_ELEMENT_TEXT` at error severity.

FHIR XML carries a primitive's value in a `value` attribute, so character data written directly on
an element is non-conformant. On a primitive element the reader takes the text as the value, so the
safety readout still sees a status, a negation, or a dose written that way, and it reports the
shape: the resource is not safe to summarize, and both writers refuse it. On a complex element the
text has no slot in the model and is dropped, with the same finding.

**What to do**: fix the sender. In the meantime, treat a resource carrying this finding as
incomplete rather than as read successfully, and do not compare it against the same document in
JSON expecting agreement.

## The writer refuses to serialize a resource

You get a thrown error whose code is one of `SERIALIZE_ERROR_CODES`.

The writers author no value of their own. When a model carries something the target format cannot
spell back, the choice is to invent content, drop content, or refuse, and the library refuses. The
duplicate property above is one such case, and so is a resource type that cannot be written as an
XML tag. An element or a root the XML reader read from a namespace other than FHIR's is another:
neither format can spell that namespace, so both writers refuse it with
`UNSERIALIZABLE_FOREIGN_NAMESPACE` or `UNSERIALIZABLE_FOREIGN_ROOT`.

**What to do**: read the code to find out which shape stopped it, and fix the model rather than the
writer. In almost every case the underlying document was already non-conformant on the read, and the
finding raised there names the same position.
