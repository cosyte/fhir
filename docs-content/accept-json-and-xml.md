---
id: accept-json-and-xml
title: Accept JSON and XML without writing the code twice
sidebar_label: Accept JSON and XML
description: Read FHIR JSON and FHIR XML into the same model, so the wire format is decided once at the edge of your program and nowhere else.
---

# Accept JSON and XML without writing the code twice

Both codecs produce the same model, so the format belongs at the edge of your program and nowhere
else. Sniff it once, and everything downstream is format-blind:

```ts runnable
import { parseResource, parseResourceXml, readSafety } from "@cosyte/fhir";
import type { ReadResult } from "@cosyte/fhir";

const read = (payload: string): ReadResult =>
  payload.trimStart().startsWith("<") ? parseResourceXml(payload) : parseResource(payload);

const fromJson = read('{"resourceType":"Observation","status":"final"}');
const fromXml = read('<Observation xmlns="http://hl7.org/fhir"><status value="final"/></Observation>');

readSafety(fromJson.resource).status; // => "final"
readSafety(fromXml.resource).status; // => "final"
```

Both readers hand back diagnostics on the same channel, `issues` on the read result, so one logging
path covers both.

## Check that two reads agree

`nodesEquivalent` compares a model read from one format with a model read from the other, so a test
or a migration can confirm that the JSON and the XML of a resource say the same thing:

```ts runnable
import { nodesEquivalent, parseResource, parseResourceXml } from "@cosyte/fhir";

const fromJson = parseResource('{"resourceType":"Observation","status":"final"}').resource;
const fromXml = parseResourceXml(
  '<Observation xmlns="http://hl7.org/fhir"><status value="final"/></Observation>',
).resource;

nodesEquivalent(fromJson, fromXml); // => true
```

## Write either format back out

`serializeResource` writes JSON and `serializeResourceXml` writes XML, from either read:

```ts runnable
import { parseResourceXml, serializeResource, serializeResourceXml } from "@cosyte/fhir";

const xml = '<Observation xmlns="http://hl7.org/fhir"><status value="final"/></Observation>';
const { resource } = parseResourceXml(xml);

serializeResource(resource); // => '{"resourceType":"Observation","status":"final"}'
serializeResourceXml(resource) === xml; // => true
```

A writer refuses, with a coded `FhirSerializeError`, rather than write something the model cannot
spell faithfully in the target format. [Troubleshooting](./troubleshooting.md#the-writer-refuses-to-serialize-a-resource)
lists what it refuses.

## Reference

- [`parseResource`](./api/@cosyte/fhir.md#parseresource) and
  [`parseResourceXml`](./api/@cosyte/fhir.md#parseresourcexml), which both return a
  [`ReadResult`](./api/@cosyte/fhir.md#readresult).
- [`serializeResource`](./api/@cosyte/fhir.md#serializeresource),
  [`serializeResourceXml`](./api/@cosyte/fhir.md#serializeresourcexml) and
  [`FhirSerializeError`](./api/@cosyte/fhir.md#fhirserializeerror).
- [`nodesEquivalent`](./api/@cosyte/fhir.md#nodesequivalent).
- [Core concepts](./core-concepts.md#two-codecs-one-model) explains why the two codecs share one
  model and why the XML reader refuses a `DOCTYPE`.
