---
id: type-resources-with-r4-types
title: Type a parsed resource with the community R4 types
sidebar_label: Use the community R4 types
description: "Give a resource you have read and checked the compile-time shape of the @types/fhir R4 types, and know what a plain JSON copy gives up."
---

# Type a parsed resource with the community R4 types

We do not generate a TypeScript type per resource ([Current limits](./limits.md#no-typed-per-resource-models)
says why). When part of your program wants the compile-time shape of a `Patient`, for code that
reads names, telecoms, codes and dates, you can take a plain JSON copy of a resource you have read
and checked, and type that copy with the R4 types from the community `@types/fhir` package. The
copy is not the model: its numbers are JavaScript numbers, so it gives up exact decimals. Read
numbers from the model, as the last section shows.

## Install the types

`@types/fhir` is a community package from DefinitelyTyped, not ours, and `@cosyte/fhir` does not
depend on it. Its R4 types are in the module `fhir/r4`:

```sh
npm install --save-dev @types/fhir
```

## Read, check and copy the resource

Read the text with `parseResource`, check what the read and the validator report, and confirm the
resource type before you claim one. Then write the model back with `serializeResource`, the public
writer, and parse that text into a plain object:

```js runnable
import { parseResource, resourceType, serializeResource, validateResource } from "@cosyte/fhir";

const source =
  '{"resourceType":"Patient","id":"syn-0001","name":[{"family":"Synthfamily","given":["Synthgiven"]}],"gender":"unknown","birthDate":"1970-01-01"}';

const { resource, issues } = parseResource(source);

issues; // => []
validateResource(resource).valid; // => true
resourceType(resource); // => "Patient"

/** @type {import("fhir/r4").Patient} */
const patient = JSON.parse(serializeResource(resource));

patient.name?.[0]?.family; // => "Synthfamily"
patient.gender; // => "unknown"
patient.birthDate; // => "1970-01-01"
```

In TypeScript, import the `Patient` type from `fhir/r4` with `import type`, and the same step is
`const patient: Patient = JSON.parse(serializeResource(resource));`.

Two things to know about that annotation:

- This sample runs as JavaScript, and this repository does not install `@types/fhir`, so the
  `@type` comment above is not type-checked here. It shows where the annotation goes.
- It is a claim, not a check. `JSON.parse` returns `any`, and nothing at run time confirms that the
  copy has the shape the type names. That is why the sample checks `resourceType` and the
  validator's verdict first. For a clinical resource, also read
  [Check safety before summarizing](./check-safety-before-summarizing.md) before you act on the copy.

`serializeResource` refuses a model it cannot write back faithfully, such as one that repeated a
property name, and throws a `FhirSerializeError` instead of returning a copy.
[Troubleshooting](./troubleshooting.md#the-writer-refuses-to-serialize-a-resource) says what each
refusal means.

## Know what the copy loses

The writer emits every decimal from the exact text the sender wrote. `JSON.parse` then turns it into
a JavaScript number, a binary double, and the R4 types describe a decimal as a `number` too, so the
copy cannot hold what the model holds:

```js runnable
import { parseResource, serializeResource } from "@cosyte/fhir";

// 2 to the power 53, plus 1: the first whole number a double cannot hold.
const large = String(2n ** 53n + 1n);

const source =
  '{"resourceType":"Patient","id":"syn-0002","extension":[' +
  '{"url":"http://example.com/fhir/StructureDefinition/synthetic-score","valueDecimal":0.010},' +
  '{"url":"http://example.com/fhir/StructureDefinition/synthetic-count","valueDecimal":' +
  large +
  '}],"name":[{"family":"Synthfamily"}]}';

const { resource, issues } = parseResource(source);
const text = serializeResource(resource);

text === source; // => true
issues.map((issue) => issue.code); // => ["DECIMAL_PRECISION_AT_RISK", "DECIMAL_PRECISION_AT_RISK"]

/** @type {import("fhir/r4").Patient} */
const patient = JSON.parse(text);

patient.extension?.[0]?.valueDecimal; // => 0.01
String(patient.extension?.[1]?.valueDecimal) === large; // => false
patient.extension?.[1]?.valueDecimal === 2 ** 53; // => true
```

What that means, plainly:

- **Trailing zeros are gone.** `0.010` becomes `0.01`. In FHIR the trailing zero records how
  precisely a value was measured, so the copy states less than the sender did.
- **Long numbers are rounded.** A number with more digits than a double holds, about 15 to 17
  significant digits, comes back changed in its last digits: 2 to the power 53, plus 1, comes back
  as 2 to the power 53. That holds for any number written as a JSON number, a whole number included.
- **Nothing in the copy says so.** The read reported `DECIMAL_PRECISION_AT_RISK` for both values;
  the copy carries no finding, and a typed `number` looks the same whether or not it was rounded.

An `integer64` is a different case. FHIR JSON writes it as a string, so it stays a string in the
copy, and the R4 types have no `integer64`, a type FHIR added in R5.

## Read exact numbers from the model

Use the typed copy for the elements a number does not reach, and read every number from the parsed
model, where a decimal is a `FhirDecimal` that keeps the sender's text:

```ts runnable
import { FhirDecimal, getProperty, isComplex, isList, isPrimitive, parseResource } from "@cosyte/fhir";

const { resource } = parseResource(
  '{"resourceType":"Patient","id":"syn-0002","extension":[{"url":"http://example.com/fhir/StructureDefinition/synthetic-score","valueDecimal":0.010}]}',
);

const extensions = getProperty(resource, "extension");
const first = extensions !== undefined && isList(extensions) ? extensions.items[0] : undefined;
const score = first !== undefined && isComplex(first) ? getProperty(first, "valueDecimal") : undefined;
const value = score !== undefined && isPrimitive(score) ? score.value : undefined;

value instanceof FhirDecimal ? value.raw : undefined; // => "0.010"
```

For an Observation's value, a dose or a reference range, the readers in
[Read measured values and their units](./read-measured-values.md) do this walk for you.

## Reference

- [`parseResource`](./api/README.md#parseresource),
  [`validateResource`](./api/README.md#validateresource) and
  [`resourceType`](./api/README.md#resourcetype).
- [`serializeResource`](./api/README.md#serializeresource) and
  [`FhirSerializeError`](./api/README.md#fhirserializeerror).
- [`getProperty`](./api/README.md#getproperty), [`isList`](./api/README.md#islist),
  [`isComplex`](./api/README.md#iscomplex) and [`isPrimitive`](./api/README.md#isprimitive).
- [`FhirDecimal`](./api/README.md#fhirdecimal).
- [Core concepts](./core-concepts.md#numbers-stay-exactly-as-they-were-written) explains why a
  decimal is never a JavaScript number in the model.
