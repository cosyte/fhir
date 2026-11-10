---
id: property-test-your-code
title: Property-test your own code with generated resources
sidebar_label: Property-test your code
description: "Test your own FHIR code on generated resources, messy JSON and XML, and hostile input with the fast-check generators at @cosyte/fhir/arbitraries."
---

# Property-test your own code with generated resources

A test written by hand checks the resources its author thought of. A property-based test states a
rule, such as "this never throws" or "what I write reads back", and checks it on as many generated
inputs as you ask for. `@cosyte/fhir/arbitraries` exports the generators we use to test this
library, built on [fast-check](https://fast-check.dev), so you can point them at code you build on
it.

Every generated value is synthetic and random: a name is random letters, an identifier a random
token under `example.org`, a date a random day. Nothing in one belongs to a patient, so a failing
case is safe to paste into an issue.

## Install fast-check

```bash
npm install --save-dev fast-check
```

fast-check is an optional peer dependency of `@cosyte/fhir`. Only `@cosyte/fhir/arbitraries` loads
it; the main entry point never does, so code that only reads and writes FHIR does not need it.

## Check that your code handles any resource

`resource()` generates a parsed resource model: one of the eight types the library validates in
full (Patient, Observation, DiagnosticReport, Condition, AllergyIntolerance, MedicationRequest,
MedicationStatement and Immunization), with every element its type requires and statuses that keep
the type's invariants, so it validates with no error. Its values lean toward what a codec gets
wrong: decimals with trailing zeros, more digits than a double holds and exponents, strings with
characters JSON and XML escape, and extensions on primitives. State the rule your code must keep,
and let fast-check look for a resource that breaks it.

```ts runnable
import fc from "fast-check";
import { readSafety, type FhirComplex } from "@cosyte/fhir";
import { resource } from "@cosyte/fhir/arbitraries";

// Your code: the label a list view shows for a resource.
function label(model: FhirComplex): string {
  const safety = readSafety(model);
  if (safety.retracted) return "entered in error";
  return safety.resourceType ?? "unknown";
}

// The rule: every resource gets a label, and none is "unknown".
fc.assert(
  fc.property(resource(), (model) => label(model) !== "unknown"),
  { numRuns: 50 },
);

const [sample] = fc.sample(resource({ types: ["Observation"] }), { numRuns: 1, seed: 1 });
sample?.properties[0]?.name; // => "resourceType"
```

Each case is a new model, so your code may change the one it is given. `bundle()` does the same for
a collection or search set of such resources.

## Check that what you write reads back

Pair `resource()` with `stringValue()`, which generates the text of a FHIR string, including the
characters JSON and XML have to escape, tab, line feed and characters outside ASCII. The rule here
is the one that matters most for code that writes FHIR: what you put in comes back out, in either
format.

```ts runnable
import fc from "fast-check";
import {
  complex,
  getProperty,
  isList,
  list,
  parseResource,
  parseResourceXml,
  primitive,
  serializeResource,
  serializeResourceXml,
  type FhirComplex,
} from "@cosyte/fhir";
import { resource, stringValue } from "@cosyte/fhir/arbitraries";

const SOURCE = "http://example.org/fhir/StructureDefinition/source-system";

// Your code: record which system a resource came from, as an extension at its root.
function tagSource(model: FhirComplex, source: string): FhirComplex {
  const tag = complex([
    { name: "url", value: primitive(SOURCE) },
    { name: "valueString", value: primitive(source) },
  ]);
  const existing = getProperty(model, "extension");
  const items = existing === undefined ? [] : isList(existing) ? existing.items : [existing];
  const rest = model.properties.filter((p) => p.name !== "extension");
  return complex([...rest, { name: "extension", value: list([...items, tag]) }]);
}

// Your code: read it back.
function sourceOf(model: FhirComplex): unknown {
  const node = getProperty(model, "extension");
  const items = node === undefined ? [] : isList(node) ? node.items : [node];
  for (const item of items) {
    if (item.kind !== "complex") continue;
    const url = getProperty(item, "url");
    const value = getProperty(item, "valueString");
    if (url?.kind === "primitive" && url.value === SOURCE && value?.kind === "primitive") {
      return value.value;
    }
  }
  return undefined;
}

fc.assert(
  fc.property(resource(), stringValue(), (model, source) => {
    const tagged = tagSource(model, source);
    const fromJson = parseResource(serializeResource(tagged)).resource;
    const fromXml = parseResourceXml(serializeResourceXml(tagged)).resource;
    return sourceOf(fromJson) === source && sourceOf(fromXml) === source;
  }),
  { numRuns: 50 },
);

sourceOf(tagSource(parseResource('{"resourceType":"Patient"}').resource, "lab-a")); // => "lab-a"
```

## Feed your code messy and hostile input

Three generators produce raw text rather than parsed models:

- `resourceJson()` is JSON a real sender might write: pretty-printed or on one line, `\r\n` line
  endings, spaces around colons, `\u` escapes, `/` written as `\/`, `resourceType` last, a `_`
  sibling before its value, and sometimes an element no schema defines, an empty array, a bare
  `null` or an array inside an array. The reader accepts all of it, and reports each `null` and
  nested array it finds.
- `resourceXml()` is FHIR XML with an XML declaration, FHIR's namespace bound to a prefix,
  indentation, comments between elements, single-quoted attributes and character references. The
  reader accepts all of it with no issue.
- `hostileInput()` is random text, documents cut short or with text inserted and deleted, nesting
  deeper than the readers allow, repeated property names, numbers past a double's range, DTDs,
  entity expansion and undefined entities. A reader may refuse these with one of its documented
  fatal errors, and throws nothing else. Pass `format: "json"` or `format: "xml"` to aim it at one
  reader.

```ts runnable
import fc from "fast-check";
import { FhirCodecError, parseResource, readSafety } from "@cosyte/fhir";
import { hostileInput, resourceJson } from "@cosyte/fhir/arbitraries";

// Your code: read the resource type off an incoming document without ever crashing the listener.
function typeOf(text: string): string | undefined {
  try {
    return readSafety(parseResource(text).resource).resourceType;
  } catch (err) {
    if (err instanceof FhirCodecError) return undefined;
    throw err;
  }
}

// Messy JSON always reads, so its type is always there.
fc.assert(
  fc.property(resourceJson(), (text) => typeOf(text) !== undefined),
  { numRuns: 50 },
);

// Hostile input may be refused, but never crashes the reader.
fc.assert(
  fc.property(hostileInput({ format: "json" }), (text) => {
    typeOf(text);
  }),
  { numRuns: 50 },
);

typeOf("not a document"); // => undefined
```

## Pick the generators

| Generator | Generates | Options |
| --- | --- | --- |
| `resource()` | a parsed, spec-clean resource model of one of `RESOURCE_TYPES` that validates with no error | `types`, `extensions`, `narrative`, `maxRepeats` |
| `bundle()` | a parsed collection or search set of such resources, each with a unique `urn:uuid` full URL | the same, and `maxEntries` |
| `resourceType()` | one of `RESOURCE_TYPES`, such as `"Condition"` | none |
| `resourceJson()` | messy JSON text the reader accepts | the same as `resource()` |
| `resourceXml()` | messy FHIR XML text the reader accepts with no issue | the same as `resource()` |
| `hostileInput()` | text a reader may refuse | `maxLength`, `format` |
| `decimalText()` | the text of a FHIR decimal, such as `1.50` or `1.0e-7`, often with more digits than a double holds | `negative`, `exponent` |
| `stringValue()` | the text of a FHIR string | `minLength`, `maxLength` |

Pass `extensions: false` to leave out extensions and the `_` siblings that carry them, and
`narrative: false` to leave out the generated `text`.

## Replay a failure

When a rule fails, fast-check shrinks the case to a small one and reports the seed and path that
produced it. A failing resource prints as the `parseResource(...)` call that rebuilds it.

```ts runnable
import fc from "fast-check";
import { getProperty } from "@cosyte/fhir";
import { resource } from "@cosyte/fhir/arbitraries";

// A rule that is wrong: a Patient has no status.
const everyResourceHasAStatus = fc.property(
  resource(),
  (model) => getProperty(model, "status") !== undefined,
);

let report = "";
try {
  fc.assert(everyResourceHasAStatus, { seed: 42 });
} catch (err) {
  report = String(err);
}
report.includes("seed: 42"); // => true
report.includes('Counterexample: [parseResource("'); // => true
```

Pass the reported `seed` and `path` back to `fc.assert` to run that one case again, already shrunk,
while you fix it. A test in CI can run more cases than one on a laptop: set `numRuns` from an
environment variable, as we do with `COSYTE_PROPERTY_RUNS`.

## Reference

- [`parseResource`](./api/README.md#parseresource),
  [`serializeResource`](./api/README.md#serializeresource),
  [`parseResourceXml`](./api/README.md#parseresourcexml),
  [`serializeResourceXml`](./api/README.md#serializeresourcexml),
  [`nodesEquivalent`](./api/README.md#nodesequivalent) and
  [`readSafety`](./api/README.md#readsafety).
- The generators' options are in their TSDoc comments, which an editor shows on hover.
- [Testing and quality](./testing-and-quality.md) says how we use these generators on this
  library, and [Accept JSON and XML](./accept-json-and-xml.md) explains what each reader accepts
  and what it refuses.
