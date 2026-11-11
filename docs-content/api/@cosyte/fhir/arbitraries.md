# @cosyte/fhir/arbitraries

fast-check generators for FHIR R4, at `@cosyte/fhir/arbitraries`: spec-clean resources and
Bundles, messy JSON and XML text the readers accept, hostile input, and the values a codec gets
wrong (decimals and strings). We use them to test this library, and you can use them to test
code you build on it.

`fast-check` is an optional peer dependency: install it to use this entry point. The main entry
point, `@cosyte/fhir`, never loads it.

Every generated value is synthetic and random. Nothing in one looks like a patient's name, date
of birth, address or identifier.

## Example

```ts
import fc from "fast-check";
import { parseResource, serializeResource } from "@cosyte/fhir";
import { resource } from "@cosyte/fhir/arbitraries";

fc.assert(
  fc.property(resource(), (model) => {
    const text = serializeResource(model);
    return serializeResource(parseResource(text).resource) === text;
  }),
);
```

## Interfaces

### BundleOptions

Options for [bundle](#bundle).

#### Extends

- [`ResourceOptions`](#resourceoptions)

#### Properties

##### extensions?

> `readonly` `optional` **extensions?**: `boolean`

Whether to add extensions: on elements, and on primitives through their `_` sibling, where a
repeating primitive's metadata array lines up with its values by `null`. Defaults to `true`.

###### Inherited from

[`ResourceOptions`](#resourceoptions).[`extensions`](#extensions-1)

##### maxEntries?

> `readonly` `optional` **maxEntries?**: `number`

The most entries. Defaults to 4.

##### maxRepeats?

> `readonly` `optional` **maxRepeats?**: `number`

The most items in a repeating element. Defaults to 3.

###### Inherited from

[`ResourceOptions`](#resourceoptions).[`maxRepeats`](#maxrepeats-1)

##### narrative?

> `readonly` `optional` **narrative?**: `boolean`

Whether to add a generated narrative (`text`) to some resources. Defaults to `true`.

###### Inherited from

[`ResourceOptions`](#resourceoptions).[`narrative`](#narrative-1)

##### types?

> `readonly` `optional` **types?**: readonly (`"Patient"` \| `"Observation"` \| `"DiagnosticReport"` \| `"Condition"` \| `"AllergyIntolerance"` \| `"MedicationRequest"` \| `"MedicationStatement"` \| `"Immunization"`)[]

The resource types to draw from. Defaults to all of [RESOURCE\_TYPES](#resource_types).

###### Inherited from

[`ResourceOptions`](#resourceoptions).[`types`](#types-1)

***

### DecimalTextOptions

Options for [decimalText](#decimaltext).

#### Properties

##### exponent?

> `readonly` `optional` **exponent?**: `boolean`

Allow an exponent, such as `1.5e3`. Defaults to `true`.

##### negative?

> `readonly` `optional` **negative?**: `boolean`

Allow a negative value. Defaults to `true`.

***

### HostileInputOptions

Options for [hostileInput](#hostileinput).

#### Properties

##### format?

> `readonly` `optional` **format?**: `"json"` \| `"xml"`

Which reader the structured part aims at. Defaults to both.

##### maxLength?

> `readonly` `optional` **maxLength?**: `number`

The longest random string. Defaults to 200.

***

### ResourceOptions

Options for [resource](#resource), [resourceJson](#resourcejson) and [resourceXml](#resourcexml).

#### Extended by

- [`BundleOptions`](#bundleoptions)

#### Properties

##### extensions?

> `readonly` `optional` **extensions?**: `boolean`

Whether to add extensions: on elements, and on primitives through their `_` sibling, where a
repeating primitive's metadata array lines up with its values by `null`. Defaults to `true`.

##### maxRepeats?

> `readonly` `optional` **maxRepeats?**: `number`

The most items in a repeating element. Defaults to 3.

##### narrative?

> `readonly` `optional` **narrative?**: `boolean`

Whether to add a generated narrative (`text`) to some resources. Defaults to `true`.

##### types?

> `readonly` `optional` **types?**: readonly (`"Patient"` \| `"Observation"` \| `"DiagnosticReport"` \| `"Condition"` \| `"AllergyIntolerance"` \| `"MedicationRequest"` \| `"MedicationStatement"` \| `"Immunization"`)[]

The resource types to draw from. Defaults to all of [RESOURCE\_TYPES](#resource_types).

***

### StringValueOptions

Options for [stringValue](#stringvalue).

#### Properties

##### maxLength?

> `readonly` `optional` **maxLength?**: `number`

The longest value, in characters. Defaults to 16.

##### minLength?

> `readonly` `optional` **minLength?**: `number`

The shortest value, at least 1. Defaults to 1.

## Type Aliases

### ResourceType

> **ResourceType** = *typeof* [`RESOURCE_TYPES`](#resource_types)\[`number`\]

One of the [RESOURCE\_TYPES](#resource_types).

## Variables

### RESOURCE\_TYPES

> `const` **RESOURCE\_TYPES**: readonly \[`"Patient"`, `"Observation"`, `"DiagnosticReport"`, `"Condition"`, `"AllergyIntolerance"`, `"MedicationRequest"`, `"MedicationStatement"`, `"Immunization"`\]

The resource types [resource](#resource) generates: the eight the library's built-in validation
models in full.

## Functions

### bundle()

> **bundle**(`options?`): `Arbitrary`\<[`FhirComplex`](../fhir.md#fhircomplex)\>

Generate a spec-clean Bundle, parsed: a collection or a search set of resources from
[resource](#resource), each with a unique `urn:uuid` full URL.

#### Parameters

##### options?

[`BundleOptions`](#bundleoptions) = `{}`

The resource options, and the most entries.

#### Returns

`Arbitrary`\<[`FhirComplex`](../fhir.md#fhircomplex)\>

An arbitrary of the Bundle model.

#### Example

```ts
import fc from "fast-check";
import { readBundle } from "@cosyte/fhir";
import { bundle } from "@cosyte/fhir/arbitraries";

fc.assert(fc.property(bundle(), (b) => readBundle(b).entries.length <= 4));
```

***

### decimalText()

> **decimalText**(`options?`): `Arbitrary`\<`string`\>

Generate the text of a FHIR `decimal` as JSON writes it, biased toward the spellings a reader
that turns numbers into doubles gets wrong: trailing zeros (`1.50`), more significant digits than
a double holds (`0.10000000000000000555`), and exponents (`1.0e-7`).

#### Parameters

##### options?

[`DecimalTextOptions`](#decimaltextoptions) = `{}`

Whether to allow a sign and an exponent.

#### Returns

`Arbitrary`\<`string`\>

An arbitrary of the decimal's text.

#### Example

```ts
import fc from "fast-check";
import { decimal } from "@cosyte/fhir";
import { decimalText } from "@cosyte/fhir/arbitraries";

fc.assert(fc.property(decimalText(), (text) => decimal(text).raw === text));
```

***

### hostileInput()

> **hostileInput**(`options?`): `Arbitrary`\<`string`\>

Generate hostile input for the readers: random strings, documents from [resourceJson](#resourcejson) and
[resourceXml](#resourcexml) cut short or with text inserted and deleted, nesting deeper than the readers'
bound, repeated property names, misaligned `_` siblings, numbers past a double's range, a byte
order mark, `resourceType` games, DTDs and entity expansion, undefined entities, character data
on a FHIR element, and a vendor namespace. A reader must turn each into a model with issues, or
refuse it with one of its documented fatal errors, and never throw anything else.

#### Parameters

##### options?

[`HostileInputOptions`](#hostileinputoptions) = `{}`

The longest random string, and which reader to aim at.

#### Returns

`Arbitrary`\<`string`\>

An arbitrary of the input text.

#### Example

```ts
import fc from "fast-check";
import { FhirCodecError, parseResource } from "@cosyte/fhir";
import { hostileInput } from "@cosyte/fhir/arbitraries";

fc.assert(
  fc.property(hostileInput({ format: "json" }), (text) => {
    try {
      parseResource(text);
    } catch (err) {
      return err instanceof FhirCodecError;
    }
    return true;
  }),
);
```

***

### resource()

> **resource**(`options?`): `Arbitrary`\<[`FhirComplex`](../fhir.md#fhircomplex)\>

Generate a spec-clean resource, parsed: one of the eight types the library validates in full,
with every element it requires, codes from its required bindings, and statuses that keep the
invariants (`con-3` to `con-5`, `ait-1` and `ait-2`, `obs-6` and `obs-7`, `pat-1`, `ext-1`), so
it validates with no error, strict mode included. Values are biased toward what a codec gets
wrong: decimals with trailing zeros, more digits than a double holds and exponents, strings with
characters JSON and XML escape, extensions on primitives with `null`-aligned metadata arrays, and
a narrative. Every value is random. Each case is a new model, so the code under test may change
it.

#### Parameters

##### options?

[`ResourceOptions`](#resourceoptions) = `{}`

The resource types, extensions, narrative and list sizes.

#### Returns

`Arbitrary`\<[`FhirComplex`](../fhir.md#fhircomplex)\>

An arbitrary of the resource model.

#### Example

```ts
import fc from "fast-check";
import { parseResource, serializeResource } from "@cosyte/fhir";
import { resource } from "@cosyte/fhir/arbitraries";

fc.assert(
  fc.property(resource(), (model) => {
    const text = serializeResource(model);
    return serializeResource(parseResource(text).resource) === text;
  }),
);
```

***

### resourceJson()

> **resourceJson**(`options?`): `Arbitrary`\<`string`\>

Generate JSON text of a resource that the reader accepts, messy on purpose: pretty-printed or on
one line, any indentation, `\r\n` line endings, spaces around colons, characters outside ASCII
written as `\u` escapes, `/` written as `/`, `resourceType` last, a `_` sibling before its value,
and sometimes an element no schema defines, an empty array, a bare `null` or an array inside an
array. The reader never refuses it, reports each `null` and nested array it finds, and the
writer can always write the model back.

#### Parameters

##### options?

[`ResourceOptions`](#resourceoptions) = `{}`

The resource types, extensions, narrative and list sizes.

#### Returns

`Arbitrary`\<`string`\>

An arbitrary of the JSON text.

#### Example

```ts
import fc from "fast-check";
import { parseResource } from "@cosyte/fhir";
import { resourceJson } from "@cosyte/fhir/arbitraries";

fc.assert(
  fc.property(resourceJson(), (text) => {
    parseResource(text); // never throws for this text
  }),
);
```

***

### resourceType()

> **resourceType**(): `Arbitrary`\<`"Patient"` \| `"Observation"` \| `"DiagnosticReport"` \| `"Condition"` \| `"AllergyIntolerance"` \| `"MedicationRequest"` \| `"MedicationStatement"` \| `"Immunization"`\>

Generate one of the resource types [resource](#resource) builds.

#### Returns

`Arbitrary`\<`"Patient"` \| `"Observation"` \| `"DiagnosticReport"` \| `"Condition"` \| `"AllergyIntolerance"` \| `"MedicationRequest"` \| `"MedicationStatement"` \| `"Immunization"`\>

An arbitrary of the type's name, such as `"Observation"`.

#### Example

```ts
import fc from "fast-check";
import { resourceType } from "@cosyte/fhir/arbitraries";

const [type] = fc.sample(resourceType(), 1);
// type is like "Condition"
```

***

### resourceXml()

> **resourceXml**(`options?`): `Arbitrary`\<`string`\>

Generate FHIR XML text of a resource that the reader accepts, messy on purpose: an XML
declaration, FHIR's namespace bound to a prefix, indentation, `\r\n` line endings, comments
between elements, single-quoted attributes, and characters outside ASCII as character
references. The resource underneath is one [resource](#resource) generates, so the reader builds a
model equivalent to it, with no issue.

#### Parameters

##### options?

[`ResourceOptions`](#resourceoptions) = `{}`

The resource types, extensions, narrative and list sizes.

#### Returns

`Arbitrary`\<`string`\>

An arbitrary of the XML text.

#### Example

```ts
import fc from "fast-check";
import { parseResourceXml } from "@cosyte/fhir";
import { resourceXml } from "@cosyte/fhir/arbitraries";

fc.assert(
  fc.property(resourceXml(), (text) => parseResourceXml(text).issues.length === 0),
);
```

***

### stringValue()

> **stringValue**(`options?`): `Arbitrary`\<`string`\>

Generate the text of a FHIR `string`: never empty, never only whitespace, and mixing in the
characters JSON and XML have to escape, tab, line feed and characters outside ASCII.

#### Parameters

##### options?

[`StringValueOptions`](#stringvalueoptions) = `{}`

Its length bounds.

#### Returns

`Arbitrary`\<`string`\>

An arbitrary of the text.

#### Example

```ts
import fc from "fast-check";
import { stringValue } from "@cosyte/fhir/arbitraries";

const [text] = fc.sample(stringValue({ maxLength: 4 }), 1);
// text is one to four characters, such as "a<&" or "Ω"
```
