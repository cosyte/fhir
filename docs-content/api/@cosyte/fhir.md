# @cosyte/fhir

Public entry point for the `@cosyte/fhir` package.

## Classes

### FhirCodecError

Thrown by the JSON reader on an unrecoverable structural failure. Carries the coded reason, a
FHIRPath `expression` location (for a misalignment) or an `offset` byte position (for malformed
JSON), and, by design, **no** slice of the offending input, because any part of it could be PHI.

#### Example

```ts
import { parseResource, FhirCodecError, FATAL_CODES } from "@cosyte/fhir";
try {
  parseResource(feed);
} catch (err) {
  if (err instanceof FhirCodecError && err.code === FATAL_CODES.PRIMITIVE_EXTENSION_MISALIGNED) {
    // the `_`-sibling alignment was broken at err.expression
  }
}
```

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new FhirCodecError**(`code`, `message`, `location?`): [`FhirCodecError`](#fhircodecerror)

**`Internal`**

###### Parameters

###### code

[`FatalCode`](#fatalcode)

The fatal reason.

###### message

`string`

A PHI-safe description, must not embed any input value.

###### location?

Either a FHIRPath `expression` or a string-index `offset`.

###### expression?

`string`

###### offset?

`number`

###### Returns

[`FhirCodecError`](#fhircodecerror)

###### Overrides

`Error.constructor`

#### Properties

##### code

> `readonly` **code**: [`FatalCode`](#fatalcode)

##### expression

> `readonly` **expression**: `string` \| `undefined`

FHIRPath location of the failure, when it has one (misalignment).

##### offset

> `readonly` **offset**: `number` \| `undefined`

Where in the input the failure was detected, when it has one (malformed JSON), as an index into
the input string in UTF-16 code units (JavaScript string indexing), not a byte offset: the two
differ once a non-ASCII character precedes the failure.

***

### FhirDecimal

A FHIR `decimal`, backed by its exact lexical source string.

Construct one via the [decimal](#decimal) factory (which validates the text) rather than `new`. The
value is immutable and carries no `number` field by design, read [FhirDecimal.toString](#tostring) for
the exact literal, [FhirDecimal.toBigInt](#tobigint) for an integer-valued decimal, and
[FhirDecimal.toNumber](#tonumber) only when you have consciously accepted the precision loss.

#### Example

```ts
import { decimal } from "@cosyte/fhir";
const dose = decimal("0.010");
dose.toString();                 // "0.010", the trailing zero survives
dose.equals(decimal("0.01"));    // false, different precision (FHIR: 0.010 ≠ 0.01)
dose.equalsValue(decimal("0.01")); // true , same quantity
```

#### Constructors

##### Constructor

> **new FhirDecimal**(`raw`): [`FhirDecimal`](#fhirdecimal)

**`Internal`**

###### Parameters

###### raw

`string`

A validated JSON-number literal. Prefer the [decimal](#decimal) factory over calling
  this directly; the factory is where validation lives.

###### Returns

[`FhirDecimal`](#fhirdecimal)

#### Properties

##### raw

> `readonly` **raw**: `string`

The exact lexical text as it appeared on the wire (or was supplied to [decimal](#decimal)).

#### Methods

##### equals()

> **equals**(`other`): `boolean`

Precision-sensitive equality, the FHIR-conformant default. Two decimals are equal only when
they denote the same quantity **and** carry the same precision, so `0.010` does not equal `0.01`
(the trailing zero is significant). Use [FhirDecimal.equalsValue](#equalsvalue) for quantity-only
comparison.

###### Parameters

###### other

[`FhirDecimal`](#fhirdecimal)

###### Returns

`boolean`

##### equalsValue()

> **equalsValue**(`other`): `boolean`

Quantity equality, precision-insensitive: `0.010` equals `0.01` equals `1e-2`. Computed by
aligning scales with BigInt arithmetic, no float is involved.

###### Parameters

###### other

[`FhirDecimal`](#fhirdecimal)

###### Returns

`boolean`

##### toBigInt()

> **toBigInt**(): `bigint`

The exact value as a `bigint`, valid only for an integer-valued decimal (no fractional digits
after accounting for the exponent). Throws a `RangeError` otherwise, a caller asking for an
integer view of `1.5` has a bug, and silently truncating would be a data-integrity hazard.

###### Returns

`bigint`

###### Example

```ts
import { decimal } from "@cosyte/fhir";
decimal("9223372036854775807").toBigInt(); // 9223372036854775807n, exact past 2^53
```

##### toNumber()

> **toNumber**(): `number`

The value as a JavaScript `number`. **Lossy and deliberately explicit**: this is the one place
the float hazard is allowed in, and only because the caller named it. For
values with more than ~15 significant digits, trailing-zero precision, or magnitude beyond
`Number.MAX_SAFE_INTEGER`, the result is not exact. Prefer [FhirDecimal.toString](#tostring) or
[FhirDecimal.toBigInt](#tobigint).

###### Returns

`number`

##### toString()

> **toString**(): `string`

The exact lexical form, the string this decimal was created from, unchanged. This is what the
serializer emits, so a spec-clean value round-trips byte-for-byte.

###### Returns

`string`

***

### FhirInteger64

A FHIR `integer64`, backed by its exact lexical source string.

Construct via the [integer64](#integer64) factory (which validates range and grammar). Immutable; the
`bigint` view is computed lazily on first access and cached.

#### Example

```ts
import { integer64 } from "@cosyte/fhir";
const big = integer64("9223372036854775807");
big.toString();  // "9223372036854775807"
big.toBigInt();  // 9223372036854775807n, exact, no 2^53 truncation
```

#### Constructors

##### Constructor

> **new FhirInteger64**(`raw`): [`FhirInteger64`](#fhirinteger64)

**`Internal`**

###### Parameters

###### raw

`string`

A validated signed-integer literal within the 64-bit range. Prefer the
  [integer64](#integer64) factory; validation lives there.

###### Returns

[`FhirInteger64`](#fhirinteger64)

#### Properties

##### raw

> `readonly` **raw**: `string`

The exact lexical text as it appeared on the wire (FHIR JSON encodes this as a string).

#### Methods

##### equals()

> **equals**(`other`): `boolean`

Exact equality of two `integer64` values (by numeric value, so `"-0"`-style variants agree).

###### Parameters

###### other

[`FhirInteger64`](#fhirinteger64)

###### Returns

`boolean`

##### toBigInt()

> **toBigInt**(): `bigint`

The value as a `bigint`, exact across the whole 64-bit range. Computed once and cached.

###### Returns

`bigint`

##### toString()

> **toString**(): `string`

The exact lexical form, what the serializer emits (as a JSON string, per FHIR).

###### Returns

`string`

***

### FhirProfileError

Thrown when a snapshot cannot be generated: an unresolvable `baseDefinition`, or a `baseDefinition`
cycle. The message is value-free (canonical URLs and structural facts only, never instance data).

#### Example

```ts
import { FhirProfileError, generateSnapshot } from "@cosyte/fhir";
try {
  generateSnapshot(differentialOnlyProfile, () => undefined);
} catch (e) {
  if (e instanceof FhirProfileError) console.error(e.message);
}
```

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new FhirProfileError**(`message`): [`FhirProfileError`](#fhirprofileerror)

###### Parameters

###### message

`string`

A value-free description of why snapshot generation failed.

###### Returns

[`FhirProfileError`](#fhirprofileerror)

###### Overrides

`Error.constructor`

***

### FhirSafetyError

A refusal raised when a caller tries to flatten or summarize a resource this library cannot
summarize honestly: it carries a `modifierExtension` we do not understand (FHIR's `?!` rule forbids
ignoring one), it carries a modifier ELEMENT (an ordinary base element R4 flags `?!`, which the
same rule forbids ignoring), a repeated property name left an element holding several values with no rule for
choosing between them, a `0..1` safety element arrived wrapped in a JSON array, an array inside
an array left content the codec could not read at all, XML character data written on an element
was dropped, a boolean-valued safety element carries a written value outside the datatype's
lexical space, a `code`-valued negation element carries a value that spells a negation code bar
its case or its surrounding whitespace, such an element holds content at a position no `code`
read can reach, a `MedicationRequest.intent` is not one of the eight R4 codes, a `use` on an
Identifier, a HumanName, an Address or a ContactPoint is not a code of its datatype's R4 value
set, an element declares an absence in a reason this library cannot read, or an element
declares an absence and carries a value. Every way the safe move is to **refuse**, value-free,
carrying only the locations. A **readable, non-conflicting** absence marker is not on that list
and never refuses: it is a declaration the caller can now read, so summarizing over it asserts
nothing this library cannot establish. Neither does a readable `use`, which is surfaced.

#### Example

```ts
import { assertSafeToSummarize, FhirSafetyError, parseResource } from "@cosyte/fhir";
const { resource } = parseResource(
  '{"resourceType":"Patient","modifierExtension":[{"url":"http://example.org/x"}]}',
);
try {
  assertSafeToSummarize(resource);
} catch (err) {
  if (err instanceof FhirSafetyError) err.locations; // ["Patient.modifierExtension[0]"]
}
```

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new FhirSafetyError**(`locations`): [`FhirSafetyError`](#fhirsafetyerror)

###### Parameters

###### locations

readonly `string`[]

The FHIRPath locations that forced the refusal (value-free).

###### Returns

[`FhirSafetyError`](#fhirsafetyerror)

###### Overrides

`Error.constructor`

#### Properties

##### locations

> `readonly` **locations**: readonly `string`[]

FHIRPath locations that forced the refusal (value-free).

***

### FhirSerializeError

Thrown by a writer asked to serialize a model it cannot encode without losing a finding.

Value-free like every other diagnostic in this library: `locations` carries bounded FHIRPath
expressions, never the content that was dropped.

#### Example

```ts
import { serializeResourceXml, FhirSerializeError, SERIALIZE_ERROR_CODES } from "@cosyte/fhir";
try {
  serializeResourceXml(resource);
} catch (err) {
  if (err instanceof FhirSerializeError && err.code === SERIALIZE_ERROR_CODES.DROPPED_ELEMENT_TEXT) {
    console.error("cannot re-emit; text was dropped at", err.locations);
  }
}
```

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new FhirSerializeError**(`message`, `code`, `locations`): [`FhirSerializeError`](#fhirserializeerror)

###### Parameters

###### message

`string`

A value-free description of the refusal.

###### code

[`SerializeErrorCode`](#serializeerrorcode)

Which refusal this is.

###### locations

readonly `string`[]

The bounded FHIRPath locations it is about.

###### Returns

[`FhirSerializeError`](#fhirserializeerror)

###### Overrides

`Error.constructor`

#### Properties

##### code

> `readonly` **code**: [`SerializeErrorCode`](#serializeerrorcode)

Which refusal this is.

##### locations

> `readonly` **locations**: readonly `string`[]

The bounded FHIRPath locations the refusal is about, in walk order. Never document content.

***

### FhirXmlError

Thrown by the XML reader on an unrecoverable failure, a well-formedness error, a **refused** DTD
or entity (the safety refusals), or nesting past the depth bound. Carries the coded reason and a
`offset` into the input, and, by design, **no** slice of the offending input, because any part of it
could be PHI.

#### Example

```ts
import { parseResourceXml, FhirXmlError, XML_FATAL_CODES } from "@cosyte/fhir";
try {
  parseResourceXml('<!DOCTYPE x [ <!ENTITY a "boom"> ]><Patient/>');
} catch (err) {
  if (err instanceof FhirXmlError && err.code === XML_FATAL_CODES.DTD_FORBIDDEN) {
    // the DTD was refused before any entity could be declared or expanded
  }
}
```

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new FhirXmlError**(`code`, `message`, `offset`): [`FhirXmlError`](#fhirxmlerror)

**`Internal`**

###### Parameters

###### code

[`XmlFatalCode`](#xmlfatalcode)

The fatal reason.

###### message

`string`

A PHI-safe description, must not embed any input value.

###### offset

`number`

The string index (UTF-16 code units) where the failure was detected.

###### Returns

[`FhirXmlError`](#fhirxmlerror)

###### Overrides

`Error.constructor`

#### Properties

##### code

> `readonly` **code**: [`XmlFatalCode`](#xmlfatalcode)

##### offset

> `readonly` **offset**: `number`

Where in the input the failure was detected, as an index into the input string in UTF-16 code
units (JavaScript string indexing), not a byte offset: the two differ once a non-ASCII character
precedes the failure.

***

### InvalidProfileError

Thrown by [defineProfile](#defineprofile) when a spec is malformed, the conservative-writer guard. The
message is value-free: it names profile metadata (a `url`, an element `path`, a cardinality number),
never instance data. A profile is not PHI, but the same value-free discipline is kept throughout.

#### Example

```ts
import { defineProfile, InvalidProfileError } from "@cosyte/fhir";
try {
  defineProfile({ url: "", type: "Patient" });
} catch (e) {
  if (e instanceof InvalidProfileError) console.error(e.message); // "profile url is required"
}
```

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new InvalidProfileError**(`message`): [`InvalidProfileError`](#invalidprofileerror)

###### Parameters

###### message

`string`

A value-free description of the authoring error.

###### Returns

[`InvalidProfileError`](#invalidprofileerror)

###### Overrides

`Error.constructor`

***

### UnsupportedFhirPathError

Thrown when the bounded FHIRPath subset cannot **lex, parse, or evaluate** an expression, an
unrecognised character, an unsupported function or operator, a construct the evaluator does not
implement, or a runtime type it cannot reconcile. It is the seam the fail-safe hangs on:
an invariant whose expression raises this is reported **`INVARIANT_UNCHECKED` (information)**, the
library never claims such a constraint *passed*, only that it could not evaluate it. Widening the
subset means catching one of these cases in the parser/evaluator, never suppressing it at the call
site.

The message is **value-free**, it names the offending FHIRPath construct or position, never an
instance value, so it is safe to surface (PHI discipline).

#### Example

```ts
import { evaluateInvariant, UnsupportedFhirPathError } from "@cosyte/fhir";
try {
  // `descendants()` is outside the bounded subset:
  throw new UnsupportedFhirPathError("unsupported function descendants()");
} catch (e) {
  if (e instanceof UnsupportedFhirPathError) console.error(e.message);
}
```

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new UnsupportedFhirPathError**(`message`): [`UnsupportedFhirPathError`](#unsupportedfhirpatherror)

###### Parameters

###### message

`string`

A value-free description of the construct the subset does not support.

###### Returns

[`UnsupportedFhirPathError`](#unsupportedfhirpatherror)

###### Overrides

`Error.constructor`

## Interfaces

### AbsenceMarker

One readable declared absence: which reason, and where.

Value-free by construction. `code` is one of the fifteen literal strings [ABSENCE\_CODES](#absence_codes)
holds, never a string read off the document, and `location` is a FHIRPath location whose every
segment is bounded to the published form of a FHIR name.

The location names the **marked element**, not the extension that marks it: the caller's question
is "what happened to this element", and the extension is the answer's carrier rather than its
subject.

#### Properties

##### code

> `readonly` **code**: `"error"` \| `"unknown"` \| `"asked-unknown"` \| `"temp-unknown"` \| `"not-asked"` \| `"asked-declined"` \| `"masked"` \| `"not-applicable"` \| `"unsupported"` \| `"as-text"` \| `"not-a-number"` \| `"negative-infinity"` \| `"positive-infinity"` \| `"not-performed"` \| `"not-permitted"`

The reason the sender spelled, always a member of the closed value set.

##### location

> `readonly` **location**: `string`

The FHIRPath location of the element the marker sits on, bounded (never a document value).

***

### BundleEntry

One entry of a [BundleReadout](#bundlereadout), value-free, structural facts only.

`request`/`response` presence and the request method/url are surfaced (a `transaction`/`batch`
entry carries a `request`; a `*-response` entry carries a `response`) so a caller can see the
*shape* of the entry without this library interpreting or executing it.

#### Properties

##### fullUrl

> `readonly` **fullUrl**: `string` \| `undefined`

The entry `fullUrl`, when present, the identity a reference resolves against.

##### hasResource

> `readonly` **hasResource**: `boolean`

Whether the entry carries an inline `resource`.

##### index

> `readonly` **index**: `number`

Zero-based position of the entry in `Bundle.entry`.

##### requestMethod

> `readonly` **requestMethod**: `string` \| `undefined`

`entry.request.method` (`GET`/`POST`/`PUT`/`DELETE`/`PATCH`/`HEAD`), when present.

##### requestUrl

> `readonly` **requestUrl**: `string` \| `undefined`

`entry.request.url`, when present.

##### resource

> `readonly` **resource**: [`FhirComplex`](#fhircomplex) \| `undefined`

The wrapped resource itself, for downstream reference resolution. `undefined` when absent.

##### resourceId

> `readonly` **resourceId**: `string` \| `undefined`

The wrapped resource's logical `id`, when it has one.

##### resourceType

> `readonly` **resourceType**: `string` \| `undefined`

The wrapped resource's `resourceType`, when it has one.

##### responseStatus

> `readonly` **responseStatus**: `string` \| `undefined`

`entry.response.status`, when present (a server-reply entry).

***

### BundleIndex

A resolvable index of a Bundle's entries, keyed the two ways a reference can name an entry.

#### Properties

##### byFullUrl

> `readonly` **byFullUrl**: `ReadonlyMap`\<`string`, [`FhirComplex`](#fhircomplex)\>

Entries keyed by their exact `fullUrl` (matches an absolute or `urn:` reference).

##### byTypeId

> `readonly` **byTypeId**: `ReadonlyMap`\<`string`, [`FhirComplex`](#fhircomplex)\>

Entries keyed by `Type/id` (matches a relative reference, or an absolute one's RESTful tail).

***

### BundleReadout

The complete, value-free readout of a `Bundle`: its type, the entry-processing semantics implied by
that type, and one [BundleEntry](#bundleentry) per `Bundle.entry` in order.

`atomic` restates [entryProcessing](#entryprocessing-1) `=== "atomic"` for ergonomics: **`true` means the entries
are all-or-nothing (a `transaction`)**, `false` means they are independent or the type carries no
processing contract. Nothing here is executed, see the module doc.

#### Properties

##### atomic

> `readonly` **atomic**: `boolean`

`true` exactly for a `transaction` (all-or-nothing); `false` for `batch` and everything else.

##### entries

> `readonly` **entries**: readonly [`BundleEntry`](#bundleentry)[]

The entries, in document order.

##### processing

> `readonly` **processing**: [`EntryProcessing`](#entryprocessing)

The entry-processing semantics for [type](#type).

##### total

> `readonly` **total**: `string` \| `undefined`

`Bundle.total` (a `searchset` count), kept as its **lexical string**, never a JS `number`.

##### type

> `readonly` **type**: `string` \| `undefined`

`Bundle.type`, or `undefined` if absent.

***

### Coded

A (system, code) pair read out of a `Coding`, either half may be absent on a quirky instance.

#### Properties

##### code

> `readonly` **code**: `string` \| `undefined`

##### system

> `readonly` **system**: `string` \| `undefined`

***

### CodeValidationRequest

A value-set membership question: is `(system, code)` a member of the value set identified by
`valueSet`? All three are plain identities, no PHI, no resource value.

#### Properties

##### code

> `readonly` **code**: `string`

The coding's `code`.

##### system

> `readonly` **system**: `string`

The coding's `system` URI.

##### valueSet

> `readonly` **valueSet**: `string`

The value set's canonical identity (URL / OID form), from the element's binding.

***

### CodeValidationResult

The result of a [CodeValidationRequest](#codevalidationrequest).

#### Properties

##### membership

> `readonly` **membership**: [`CodeMembership`](#codemembership)

Whether the code is in the value set, not in it, or undecidable.

##### systemVersion?

> `readonly` `optional` **systemVersion?**: `string`

**Optional.** The code-system release this answer was made against, exactly as the service
names it: an RxNorm monthly drop (`"2026-08-04"`), a SNOMED CT edition
(`"http://snomed.info/sct/731000124108/version/20260301"`), a LOINC release (`"2.78"`). It is
carried onto the finding the validator emits (`CODE_NOT_IN_VALUESET`) and reaches the
`OperationOutcome`, so a consumer reconciling a validation report months later can tell which
release the answer was made against without asking the service again.

**The library verifies nothing about it.** This is the service's own assertion, preserved
**exactly**: never trimmed, case-folded, parsed, truncated or substituted. The library vendors
no code-system content, so it has nothing to check the string against and does not pretend to.

**Declaring nothing is conformant, and is recorded rather than assumed.** Omit it (or, from
untyped JavaScript, hand over a value that is not a non-blank string) and the finding is marked
as having an **undeclared** release. No default, "latest" or "current" release is ever
substituted, and the answer is otherwise unchanged: this field never affects `membership`,
severity, or whether a finding is emitted at all.

It is a code-**system** release, not a value-set version, and it must never be read from the
instance being validated: a resource's own `Coding.version` is document content, and echoing it
onto a finding would publish instance data through the one surface this library keeps
value-free.

***

### ContainedIndex

A resolvable index of one resource's `contained` resources, for `#fragment` resolution.

#### Properties

##### byId

> `readonly` **byId**: `ReadonlyMap`\<`string`, [`FhirComplex`](#fhircomplex)\>

Contained resources keyed by their logical `id` (matches `#id`).

##### root

> `readonly` **root**: [`FhirComplex`](#fhircomplex)

The containing resource itself, the target of a bare `#` fragment.

***

### DatatypeUseReport

One surfaced `use` on an Identifier, a HumanName, an Address or a ContactPoint: the code exactly
as the document wrote it, and the location of the `use` element it was read from, one per covered
position.

The code is one of the [DatatypeUseCode](#datatypeusecode) values of that position's own value set, matched
exactly, so this carries no text the library did not spell itself. The location follows the same
bound and the same root rule as [ModifierElementReport](#modifierelementreport)'s.

#### Example

```ts
import { parseResource, readSafety, type DatatypeUseReport } from "@cosyte/fhir";
const { resource } = parseResource(
  '{"resourceType":"Patient","identifier":[{"use":"old","value":"S1"}]}',
);
const uses: readonly DatatypeUseReport[] = readSafety(resource).datatypeUses;
uses; // [{ code: "old", location: "Patient.identifier[0].use" }]
```

#### Properties

##### code

> `readonly` **code**: [`DatatypeUseCode`](#datatypeusecode)

The `use` code, exactly as written.

##### location

> `readonly` **location**: `string`

The FHIRPath location of the `use` element it was read from, bounded.

***

### Discriminator

One slicing discriminator: how to tell instances of different slices apart.

#### Properties

##### path

> `readonly` **path**: `string`

The FHIRPath (element path, relative to the sliced element) the discriminator inspects.

##### type

> `readonly` **type**: `string`

The discriminator kind. A `type` outside [DISCRIMINATOR\_TYPES](#discriminator_types) (e.g. R5 `position`) is unsupported.

***

### ElementBinding

An element's terminology binding (strength + value-set identity) as declared by a profile.

#### Properties

##### strength

> `readonly` **strength**: `string`

##### valueSet?

> `readonly` `optional` **valueSet?**: `string`

***

### ElementConstraint

One `ElementDefinition.constraint`, a FHIR **invariant**. `key` is the stable identifier
(`ait-1`, `us-core-1`), `severity` is `error` | `warning`, and `expression` is the FHIRPath the
engine evaluates against an instance. `human` (the prose description) is modeled but never
surfaced in a diagnostic (it is spec text, not PHI, but the engine reports the value-free `key`).

#### Properties

##### expression

> `readonly` **expression**: `string`

##### human?

> `readonly` `optional` **human?**: `string`

##### key

> `readonly` **key**: `string`

##### severity

> `readonly` **severity**: `string`

***

### ElementDefinition

The slice of a FHIR `ElementDefinition` the validator acts on. `path` is the dotted element path
(e.g. `AllergyIntolerance.clinicalStatus`); `id` additionally encodes slice membership as
`path:sliceName` (e.g. `Observation.category:VSCat`).

#### Properties

##### binding?

> `readonly` `optional` **binding?**: [`ElementBinding`](#elementbinding)

The element's terminology binding, when the definition states one.

##### constraint?

> `readonly` `optional` **constraint?**: readonly [`ElementConstraint`](#elementconstraint)[]

The element's invariant constraints (FHIRPath), when the definition states any.

##### fixed?

> `readonly` `optional` **fixed?**: [`TypedValue`](#typedvalue)

A `fixed[x]` equality constraint, when present.

##### id

> `readonly` **id**: `string`

The element id, carries slice names as `:sliceName` segments. Defaults to `path` when absent.

##### max?

> `readonly` `optional` **max?**: `number`

Maximum cardinality ([UNBOUNDED](#unbounded) for `*`), when the definition states one.

##### min?

> `readonly` `optional` **min?**: `number`

Minimum cardinality, when the definition states one.

##### mustSupport?

> `readonly` `optional` **mustSupport?**: `boolean`

Whether the element is flagged must-support.

##### path

> `readonly` **path**: `string`

The dotted element path from the resource root.

##### pattern?

> `readonly` `optional` **pattern?**: [`TypedValue`](#typedvalue)

A `pattern[x]` subset constraint, when present.

##### sliceName?

> `readonly` `optional` **sliceName?**: `string`

The slice this element defines, when it is a slice (from `sliceName` or the id's `:` segment).

##### slicing?

> `readonly` `optional` **slicing?**: [`Slicing`](#slicing-2)

The slicing declaration, when the element introduces slices.

##### type?

> `readonly` `optional` **type?**: readonly [`ElementType`](#elementtype)[]

The allowed types, when the definition constrains them.

***

### ElementSchema

The definition of one direct element of a resource.

#### Properties

##### binding?

> `readonly` `optional` **binding?**: [`RequiredBinding`](#requiredbinding)

A required-strength enumerated `code` binding, when the element has one.

##### max

> `readonly` **max**: `number`

Maximum cardinality (`1` for a singleton, [UNBOUNDED](#unbounded) for `*`).

##### min

> `readonly` **min**: `number`

Minimum cardinality (`0` for optional, `≥ 1` for required).

##### types

> `readonly` **types**: readonly `string`[]

The allowed datatype name(s). One entry for a normal element; several for a `choice[x]` element
(see [isChoice](#ischoice)). Primitive names are validated by ./primitives.js; complex names
(e.g. `HumanName`) are validated structurally (cardinality + node shape) only, their internals
need the datatype's own definition, which this schema does not carry.

***

### ElementType

One allowed type for an element (`code` is the datatype; `profile`/`targetProfile` constrain it).

#### Properties

##### code

> `readonly` **code**: `string`

##### profile?

> `readonly` `optional` **profile?**: readonly `string`[]

##### targetProfile?

> `readonly` `optional` **targetProfile?**: readonly `string`[]

***

### FhirComplex

An object (complex) element: an ordered list of named properties. Order is preserved from the
wire so that a spec-clean document round-trips faithfully; on emit the serializer additionally
hoists a string `resourceType` to the front (the one canonical-ordering rule FHIR requires).

`properties` holds at most one entry per name. FHIR JSON requires property names to be unique
(json.html §2.6.2: "Property names SHALL be unique"), and a repeating element is an array, never a
repeated name. A non-conformant document that repeats a name is still read (the reader is
lenient), and the members the first-wins rule did not put in `properties` are kept in
[duplicates](#duplicates) rather than discarded, so nothing the wire carried is lost and a safety read
can see that the document was ambiguous. [duplicates](#duplicates) is absent on every conformant
document.

#### Properties

##### droppedText?

> `readonly` `optional` **droppedText?**: `true`

Set when the XML document wrote **character data directly on this element**, which a FHIR
element has no slot for (xml.html §2.6.1: a value travels in the `value` attribute, and an
element's other content is child elements). The text is dropped, so this node holds only what
the attributes and child elements carried. A marker that content was present and could not be
placed, not a representation of it. Absent on every conformant document and on every document
read from JSON. See [isDroppedText](#isdroppedtext).

##### duplicates?

> `readonly` `optional` **duplicates?**: readonly [`FhirProperty`](#fhirproperty)[]

The members a repeated property name shadowed, in document order, each still carrying the name
it was written under. Present only on a non-conformant document. Read them with
[getAllProperties](#getallproperties); a consumer that ignores this field is reading one arbitrary value out
of several the sender wrote.

##### foreignRoot?

> `readonly` `optional` **foreignRoot?**: `true`

Set when the XML document's **root** element resolved to a vocabulary that is neither FHIR's nor
none at all: `<Observation xmlns="urn:vendor">` or `<v:Observation xmlns:v="urn:vendor">`. The
reader already reports that position (../xml/issues.js ISSUE\_CODES.UNEXPECTED\_XML\_CONTENT),
but a report lives in the issue list and the issue list is not carried on the model, so a writer
handed the model alone could not tell a vendor-rooted resource from one authored in FHIR.

**A marker that the root named another vocabulary, NOT the vocabulary.** It is a literal `true`:
the namespace URI is document content and is deliberately not kept, so nothing here can be
echoed into a diagnostic and no walker gains a position. What it buys is that
../xml/write.js serializeResourceXml refuses rather than emitting a FHIR-namespaced
document whose re-read carries an empty issue list.

**Set at a document root and nowhere else.** An element that merely inherits a foreign namespace
from its parent is flagged where the document leaves the vocabulary and is not marked here, and
a root whose prefix resolves to **nothing** is not marked either: that root reads under its
verbatim tag, and its XML write is refused at the tag sites on a code of its own rather than
through this marker. A root declaring no
namespace at all is read as FHIR, unflagged and unmarked. Absent on every conformant document
and on every document read from JSON. See [isForeignRoot](#isforeignroot).

##### kind

> `readonly` **kind**: `"complex"`

##### nestedArray?

> `readonly` `optional` **nestedArray?**: `true`

Set when the JSON document put an **array** at this position, where FHIR JSON gives an array no
meaning (an array inside an array). The array's contents are **not** modeled as FHIR: this is a
marker that content was present and could not be placed, not a representation of it, and the
node stays the empty element it has always been. Absent on every conformant document.
See [isNestedArray](#isnestedarray).

##### nestedArraySource?

> `readonly` `optional` **nestedArraySource?**: `string`

The JSON text of the array the sender wrote at this position, never interpreted as FHIR. See
[NestedArrayContent](#nestedarraycontent) for what "the text" is exact about, and [nestedArrayContent](#nestedarraycontent-1) to
read it.

##### nonObjectSource?

> `readonly` `optional` **nonObjectSource?**: `string`

The JSON text of a **non-object, non-array** value the sender wrote at a position where FHIR
JSON has an object: a string, a number, a boolean, or `null` (json.html §2.6.2 gives a complex
element an object and nothing else). The value is **not** modeled as FHIR, and deliberately not
as a primitive either: putting it in the tree would make it visible to every walker at a
position that walker reads as a complex element, which is a redefinition of the model rather
than a preservation of the document. The node stays the empty element the reader had to produce
there, and the text hangs off it where the writer can hand it back. The reader raises
[ISSUE\_CODES.UNKNOWN\_PROPERTY](#unknown_property) at the same position. An **array** is the neighbouring case
and has its own field ([nestedArraySource](#nestedarraysource)) plus a marker, because it additionally carries
[ISSUE\_CODES.NESTED\_ARRAY](#nested_array). Absent on every conformant document and on every document read
from XML.

**The text is value-exact, not byte-exact**, exactly as [NestedArrayContent](#nestedarraycontent) is: it is the
value re-rendered the way this library renders every other JSON value it emits, so a number's
exact source survives and a string's escaping does not (`"Jamés"` comes back as `"Jamés"`,
`"a/b"` as `"a/b"`). Both denote the same string, so nothing is lost; a caller comparing the
writer's output to the input **byte for byte** will still see a difference here.

##### properties

> `readonly` **properties**: readonly [`FhirProperty`](#fhirproperty)[]

***

### FhirIssue

A single value-free diagnostic accumulated during a lenient read.

`expression` is a FHIRPath location into the document (e.g. `Bundle.entry[2].resource.ofType(Patient).name[0].given[1]`,
or a simpler `Patient.birthDate`), it says *where* without echoing *what*. It never contains a
resource value, so an issue is safe to log.

**It is a location, and on non-conformant input it can be a location with a gap.** The segments
are the document's own names, and a name is echoed only when it matches the published form of a
FHIR name; anything else reads as the ../model/path.js `WITHHELD` marker, `"<withheld>"`.
A marker is not a FHIRPath identifier, so such an expression will not resolve against the
instance: R4 defines `OperationOutcome.issue.expression` as a FHIRPath subset that SHALL resolve
to a single node, and a location with a withheld segment does not. Every segment around the
marker is intact, so the nearest addressable ancestor is still there. Test for the marker before
handing an expression to a FHIRPath engine.

#### Properties

##### code

> `readonly` **code**: [`IssueCode`](#issuecode)

##### expression

> `readonly` **expression**: `string`

##### severity

> `readonly` **severity**: [`IssueSeverity`](#issueseverity)

***

### FhirList

A repeating element: an ordered list of item nodes. A primitive list preserves value-absent slots
as [FhirPrimitive](#fhirprimitive) nodes with `value: undefined`, so the null-padding alignment between a
value array and its `_`-sibling array is captured structurally.

#### Properties

##### items

> `readonly` **items**: readonly [`FhirNode`](#fhirnode)[]

##### kind

> `readonly` **kind**: `"list"`

***

### FhirPrimitive

A primitive (leaf) element: a value plus its optional `id` and `extension` metadata.

`value` is `undefined` exactly when the element has no value of its own but does carry metadata,
the FHIR case where a primitive slot is `null` in the value array but an object in the
`_`-sibling array. At least one of `value`, `id`, `extension` is meaningful for the node to exist.

#### Example

```ts
import { primitive } from "@cosyte/fhir";
const given = primitive("Jacqueline");                 // plain value
const flagged = primitive(undefined, { extension: [ext] }); // value-absent, extension-only
```

#### Properties

##### droppedText?

> `readonly` `optional` **droppedText?**: `true`

Set when the XML document wrote **character data directly on this element**, which a FHIR
element has no slot for: a primitive's value travels in the `value` attribute (xml.html §2.6.1),
so the text is dropped and this node's `value` is whatever the attribute held, which for
`<status>entered-in-error</status>` is nothing at all. A marker that content was present and
could not be placed, not a representation of it. Absent on every conformant document and on
every document read from JSON. See [isDroppedText](#isdroppedtext).

##### extension?

> `readonly` `optional` **extension?**: readonly [`FhirComplex`](#fhircomplex)[]

##### id?

> `readonly` `optional` **id?**: `string`

##### kind

> `readonly` **kind**: `"primitive"`

##### nestedArray?

> `readonly` `optional` **nestedArray?**: `true`

Set when the JSON document put an **array** at this position, where FHIR JSON gives an array no
meaning (an array inside an array). The array's contents are **not** modeled as FHIR: this is a
marker that content was present and could not be placed, not a representation of it. Absent on
every conformant document. See [isNestedArray](#isnestedarray).

##### nestedArrayMetaSource?

> `readonly` `optional` **nestedArrayMetaSource?**: `string`

The JSON text of the array the sender wrote at this position in the primitive's `_`-sibling
(metadata) channel. A primitive can carry a nested array in either channel or both, so the two
are kept apart rather than merged. See [nestedArrayContent](#nestedarraycontent-1).

##### nestedArraySource?

> `readonly` `optional` **nestedArraySource?**: `string`

The JSON text of the array the sender wrote at this position, when that array sat in the
element's own value channel. Never interpreted as FHIR. See [NestedArrayContent](#nestedarraycontent) for what
"the text" is exact about, and [nestedArrayContent](#nestedarraycontent-1) to read it.

##### nonObjectMetaSource?

> `readonly` `optional` **nonObjectMetaSource?**: `string`

The JSON text of a **non-object, non-array** value the sender wrote in this primitive's
`_`-sibling (metadata) channel: a string, a number, a boolean, or a `null` at a **singleton**
slot. FHIR JSON gives that channel an `Element` object and nothing else (json.html §2.6.2.3, "the
`id` and/or `extension`"), so there is no metadata to read out of a scalar and the reader models
none. This is the `_`-sibling counterpart of [FhirComplex.nonObjectSource](#nonobjectsource) and it exists
for the same reason: without the text the writer has no `_`-sibling to emit, so the member is
dropped and a non-conformant document comes back conformant with it simply gone. The reader
raises [ISSUE\_CODES.UNKNOWN\_PROPERTY](#unknown_property) at the element's position.

**A `null` at any slot of a repeating primitive's `_`-array is never marked here** (§2.6.2.3
fills out *both* arrays), so a conformant document never carries this. The exemption is by
**position**, not by whether that slot pads a value, so a `_`-array with no value array beside
it keeps the silent drop it had before: declared, not closed. A `null` at a **singleton** `_`
slot is never padding, on the same reasoning as [undefinedNull](#undefinednull), and is marked.
An **array** in this channel is the neighbouring case with its own field
([nestedArrayMetaSource](#nestedarraymetasource)) and its own code. Absent on every document read from XML.

**The text is value-exact, not byte-exact**, exactly as [FhirComplex.nonObjectSource](#nonobjectsource) is.

##### undefinedNull?

> `readonly` `optional` **undefinedNull?**: `true`

Set when the JSON document wrote a bare `null` in this primitive's **value** channel at a
position FHIR JSON does not define one. FHIR JSON uses `null` for exactly one thing, padding a
repeating primitive's value array so that it aligns index-by-index with the `_`-sibling array
carrying that occurrence's `id`/`extension` (json.html §2.6.2.3); a `null` whose slot carries no
such metadata aligns nothing, and the element then has neither a value nor children, which R4
`ele-1` requires. The node stays the value-absent primitive it has always been, so no walker
sees anything new; what the marker buys is that ../codec/write.js serializeResource can
write the `null` back instead of omitting the member, which is what stops the shape being
laundered into a conformant document with the member simply missing. Absent on every conformant
document and on every document read from XML. See [isUndefinedNull](#isundefinednull).

##### value

> `readonly` **value**: [`PrimitiveValue`](#primitivevalue) \| `undefined`

***

### FhirProperty

A single named property of a [FhirComplex](#fhircomplex).

#### Properties

##### name

> `readonly` **name**: `string`

##### value

> `readonly` **value**: [`FhirNode`](#fhirnode)

***

### IntentReport

One surfaced `MedicationRequest.intent`: the code exactly as the document wrote it, and the
location of the `intent` element it was read from, one per `MedicationRequest` root.

The code is one of the eight [MedicationRequestIntent](#medicationrequestintent) values, matched exactly, so this
carries no text the library did not spell itself. The location follows the same bound and the
same root rule as [ModifierElementReport](#modifierelementreport)'s.

#### Properties

##### code

> `readonly` **code**: [`MedicationRequestIntent`](#medicationrequestintent)

The intent code, exactly as written.

##### location

> `readonly` **location**: `string`

The FHIRPath location of the `intent` element it was read from, bounded.

***

### InvariantOptions

Options for [collectInvariantIssues](#collectinvariantissues).

#### Properties

##### resolve?

> `readonly` `optional` **resolve?**: [`BaseResolver`](#baseresolver)

Base resolver for snapshot generation, needed only when the profile carries no snapshot.

***

### InvariantResult

The outcome of evaluating one invariant expression against an instance.

#### Properties

##### satisfied

> `readonly` **satisfied**: `boolean`

Whether the constraint is satisfied. Meaningful only when [unchecked](#unchecked) is `false`.

##### unchecked

> `readonly` **unchecked**: `boolean`

`true` when the bounded subset could not lex/parse/evaluate the expression. The caller reports
this as `INVARIANT_UNCHECKED`, **the invariant is never treated as satisfied when unchecked**.

***

### LocatedDoseQuantity

A located `doseQuantity` node: the complex value and its FHIRPath expression for a value-free issue.

#### Properties

##### node

> `readonly` **node**: [`FhirComplex`](#fhircomplex)

The `doseQuantity` complex node.

##### path

> `readonly` **path**: `string`

The FHIRPath location, e.g. `MedicationRequest.dosageInstruction[0].doseAndRate[0].doseQuantity`.

***

### ModifierElementReport

One reported modifier element: which element, and where.

Value-free by contract. `element` is one of the literal keys this library spells, never a name
read off the document, and `location` is bounded segment by segment with its root restricted to
[MODIFIER\_ELEMENT\_ROOT\_TYPES](#modifier_element_root_types).

#### Properties

##### element

> `readonly` **element**: [`ModifierElementName`](#modifierelementname)

The modifier element that is present.

##### location

> `readonly` **location**: `string`

The FHIRPath location it is present at, bounded (never a document value).

***

### NdjsonError

A value-free, isolated failure for a single NDJSON line, carries the line number, never content.

#### Properties

##### code

> `readonly` **code**: [`NdjsonErrorCode`](#ndjsonerrorcode-1)

The coded reason.

##### line

> `readonly` **line**: `number`

The 1-based line number of the failing line.

##### message

> `readonly` **message**: `string`

A value-free description of the *kind* of failure, never the line's text.

***

### NdjsonOptions

Options for the NDJSON readers.

#### Properties

##### maxLineBytes?

> `readonly` `optional` **maxLineBytes?**: `number`

The maximum bytes a single line may reach before a newline forces a `LINE_TOO_LONG` cut-off
(the no-whole-file-load / DoS guard). Default 16 MiB, comfortably above any real resource, far
below a memory hazard.

***

### NdjsonRecord

One NDJSON line's outcome. Exactly one of `resource` / `error` is present: a good line yields the
parsed `resource` (plus any value-free codec `issues`), a bad line yields an isolated `error`.

#### Properties

##### error?

> `readonly` `optional` **error?**: [`NdjsonError`](#ndjsonerror)

The isolated failure, when the line did not read.

##### issues?

> `readonly` `optional` **issues?**: readonly [`FhirIssue`](#fhirissue)[]

Value-free codec diagnostics gathered reading the line (e.g. `DECIMAL_PRECISION_AT_RISK`).

##### line

> `readonly` **line**: `number`

The 1-based line number.

##### resource?

> `readonly` `optional` **resource?**: [`FhirComplex`](#fhircomplex)

The parsed resource, when the line read cleanly.

***

### NestedArrayContent

One array the sender wrote where FHIR JSON gives an array no meaning, kept as JSON text.

The text is the array re-rendered compactly from what was read: member order and every member of a
repeated key are preserved, and number tokens keep their verbatim source, so no value changes. It
is not a byte-for-byte slice of the input, because insignificant whitespace is dropped and strings
are re-escaped canonically, exactly as everywhere else this library emits JSON.

#### Properties

##### channel

> `readonly` **channel**: [`NestedArrayChannel`](#nestedarraychannel)

The JSON channel the array sat in.

##### json

> `readonly` **json**: `string`

The array's JSON text, uninterpreted.

***

### ObservationReferenceRange

A single `Observation.referenceRange` entry, surfaced (never used to compute an abnormal flag).

#### Properties

##### high

> `readonly` **high**: [`Quantity`](#quantity-1) \| `undefined`

`referenceRange.high`, the inclusive upper bound, when present.

##### low

> `readonly` **low**: [`Quantity`](#quantity-1) \| `undefined`

`referenceRange.low`, the inclusive lower bound, when present.

##### text

> `readonly` **text**: `string` \| `undefined`

`referenceRange.text`, a free-text range when the bounds are not machine-comparable.

##### type

> `readonly` **type**: readonly [`Coded`](#coded)[]

`referenceRange.type` codings (e.g. `normal`, `treatment`), when present.

***

### ObservationValue

The discriminated reading of an `Observation.value[x]` (or a `component.value[x]`). `type` names the
variant that is present; `quantity` is populated **only** when `type === "Quantity"`, so a caller
that wants a number must check the type first. `ambiguous` lists any *additional* variants also
present, a `value[x]` is a `0..1` choice, so a non-empty `ambiguous` is a structural defect (the
kind the structural validator reports as `CHOICE_AMBIGUOUS` once Observation is a modeled
schema). This reader surfaces it here regardless, so the extra variant is never silently dropped.

#### Properties

##### ambiguous

> `readonly` **ambiguous**: readonly (`"Quantity"` \| `"CodeableConcept"` \| `"String"` \| `"Boolean"` \| `"Integer"` \| `"Range"` \| `"Ratio"` \| `"SampledData"` \| `"Time"` \| `"DateTime"` \| `"Period"`)[]

Additional `value[x]` variants also present (a structural ambiguity); empty in a clean resource.

##### encodingIssue

> `readonly` **encodingIssue**: [`ValidationCode`](#validationcode) \| `undefined`

The published ../validate/issues.js `ValidationCode` for the ENCODING the present
variant arrived in, when FHIR JSON gives that shape no meaning at a `0..1` choice, and
`undefined` otherwise, which is every conformant document.

The one value it takes today is `ARRAY_WRAPPED_CHOICE`: the variant arrived wrapped in a JSON
array, which json.html §2.6.2.2 reserves for a repeating element. **This is the channel that
distinguishes "the sender wrote a value here and nothing read it" from "the sender wrote no
value here"**, which `quantity: undefined` alone cannot: a `valueQuantity` of `[{"value":5,
"code":"mg"}]` and one of `{}` both read as a present `Quantity` with no magnitude, and one of
them is a 5 mg dose. It is the same code `validateResource` raises at the same location, so a
caller switching on this and a caller reading the issue list see one vocabulary.

**It says nothing about the value's CONTENT.** A variant that arrived the way FHIR JSON spells
it and holds a shape the variant cannot carry is not this channel's business; nothing here is
a general "the value was unreadable" report.

##### node

> `readonly` **node**: [`FhirNode`](#fhirnode)

The raw value node for the present variant.

##### property

> `readonly` **property**: `string`

The full JSON property name of the present variant (e.g. `"valueQuantity"`).

##### quantity

> `readonly` **quantity**: [`Quantity`](#quantity-1) \| `undefined`

The parsed [Quantity](#quantity-1), present **only** when `type === "Quantity"`; `undefined` otherwise.

##### type

> `readonly` **type**: `"Quantity"` \| `"CodeableConcept"` \| `"String"` \| `"Boolean"` \| `"Integer"` \| `"Range"` \| `"Ratio"` \| `"SampledData"` \| `"Time"` \| `"DateTime"` \| `"Period"`

The present variant's type suffix (e.g. `"Quantity"`, `"String"`, `"CodeableConcept"`).

***

### ParsedReference

A parsed `Reference.reference` string.

`type`, `id`, and `version` are populated only when the form makes them unambiguous (a relative
reference always; an absolute RESTful URL when its tail matches `Type/id`). A `logical` reference
(e.g. `urn:uuid:…`) exposes only `raw` and `kind`.

#### Properties

##### id?

> `readonly` `optional` **id?**: `string`

The referenced logical id, when the form reveals it. For a fragment this is the anchor.

##### kind

> `readonly` **kind**: [`ReferenceKind`](#referencekind)

The classified form.

##### raw

> `readonly` **raw**: `string`

The exact reference string as supplied.

##### type?

> `readonly` `optional` **type?**: `string`

The referenced resource type, when the form reveals it (e.g. `"Patient"`).

##### version?

> `readonly` `optional` **version?**: `string`

The version id from a `/_history/{vid}` suffix, when present.

***

### PrimitiveMeta

Optional `id` / `extension` metadata for [primitive](#primitive).

#### Properties

##### extension?

> `readonly` `optional` **extension?**: readonly [`FhirComplex`](#fhircomplex)[]

##### id?

> `readonly` `optional` **id?**: `string`

***

### ProfileConstraintSpec

One `constraint` (invariant) in a [ProfileElementSpec](#profileelementspec). `severity` defaults to `"error"` (as
`loadStructureDefinition` defaults it), mirroring the FHIR `ElementDefinition.constraint` shape.

#### Properties

##### expression

> `readonly` **expression**: `string`

The FHIRPath expression the engine evaluates.

##### human?

> `readonly` `optional` **human?**: `string`

The prose description (spec text, never surfaced in a diagnostic).

##### key

> `readonly` **key**: `string`

The stable invariant key (`us-core-1`, `ait-1`).

##### severity?

> `readonly` `optional` **severity?**: `string`

`error` | `warning`; defaults to `"error"` when omitted.

***

### ProfileElementSpec

The ergonomic authoring shape for one element. Mirrors [ElementDefinition](#elementdefinition), but `max` accepts
the author-friendly `"*"` (normalized to [UNBOUNDED](#unbounded)) and `constraint` takes
[ProfileConstraintSpec](#profileconstraintspec) (whose `severity` defaults). `id` defaults to `path`; `sliceName` is
derived from the id's `:` segment when omitted, exactly as `loadStructureDefinition` does.

#### Properties

##### binding?

> `readonly` `optional` **binding?**: [`ElementBinding`](#elementbinding)

The element's terminology binding (strength + value-set identity).

##### constraint?

> `readonly` `optional` **constraint?**: readonly [`ProfileConstraintSpec`](#profileconstraintspec)[]

The element's invariant constraints (FHIRPath).

##### fixed?

> `readonly` `optional` **fixed?**: [`TypedValue`](#typedvalue)

A `fixed[x]` equality constraint (a FHIR type name + a model node, build with `complex`/`primitive`/`list`).

##### id?

> `readonly` `optional` **id?**: `string`

The element id, carries slice names as `:sliceName`. Defaults to `path`.

##### max?

> `readonly` `optional` **max?**: `number` \| `"*"`

Maximum cardinality: a non-negative integer or `"*"` (→ [UNBOUNDED](#unbounded)).

##### min?

> `readonly` `optional` **min?**: `number`

Minimum cardinality (a non-negative integer).

##### mustSupport?

> `readonly` `optional` **mustSupport?**: `boolean`

Whether the element is flagged must-support (a *system obligation*, not instance-presence).

##### path

> `readonly` **path**: `string`

The dotted element path from the resource root (e.g. `Observation.status`). Required.

##### pattern?

> `readonly` `optional` **pattern?**: [`TypedValue`](#typedvalue)

A `pattern[x]` subset constraint (a FHIR type name + a model node).

##### sliceName?

> `readonly` `optional` **sliceName?**: `string`

The slice this element defines. Defaults to the id's `:sliceName` segment when present.

##### slicing?

> `readonly` `optional` **slicing?**: [`Slicing`](#slicing-2)

The slicing declaration, when the element introduces slices.

##### type?

> `readonly` `optional` **type?**: readonly [`ElementType`](#elementtype)[]

The allowed types, when the profile constrains them.

***

### ProfileOptions

Options for [collectProfileIssues](#collectprofileissues).

#### Properties

##### resolve?

> `readonly` `optional` **resolve?**: [`BaseResolver`](#baseresolver)

Base resolver for snapshot generation, needed only when the profile carries no snapshot.

***

### ProfileSpec

The ergonomic authoring shape for a whole profile. Mirrors the modeled slice of a FHIR
`StructureDefinition` ([StructureDefinition](#structuredefinition)); `differential` / `snapshot` take
[ProfileElementSpec](#profileelementspec)s.

#### Properties

##### baseDefinition?

> `readonly` `optional` **baseDefinition?**: `string`

The canonical URL of the definition this one derives from.

##### derivation?

> `readonly` `optional` **derivation?**: [`Derivation`](#derivation-2)

Specialization (a base resource) or constraint (a profile).

##### differential?

> `readonly` `optional` **differential?**: readonly [`ProfileElementSpec`](#profileelementspec)[]

The differential element list (constraints relative to the base).

##### kind?

> `readonly` `optional` **kind?**: `string`

`resource` | `complex-type` | `primitive-type` | `logical`.

##### name?

> `readonly` `optional` **name?**: `string`

The computer-friendly name.

##### snapshot?

> `readonly` `optional` **snapshot?**: readonly [`ProfileElementSpec`](#profileelementspec)[]

A pre-resolved snapshot element list (rare in authoring; usually generated from the differential).

##### type

> `readonly` **type**: `string`

The resource type this profile constrains (e.g. `"Observation"`). Required.

##### url

> `readonly` **url**: `string`

The canonical URL, the identity the profile is referenced by. Required.

##### version?

> `readonly` `optional` **version?**: `string`

The business version (e.g. `"6.1.0"`), when the profile is versioned.

***

### Quantity

The value-free reading of a FHIR `Quantity` element. `value` is a [FhirDecimal](#fhirdecimal), the exact
lexical number, never routed through a JS float, and `code`/`system` are the
machine-actionable unit, kept distinct from the human `unit` string. The magnitude is read from
either wire format's model, so an XML-sourced quantity is not a unit with no number. The model
records no provenance, so a JSON document that spelled its magnitude as a string is read the same
way; FHIR JSON says a decimal is a number, so that document is non-conformant either way.

#### Properties

##### code

> `readonly` **code**: `string` \| `undefined`

`Quantity.code`, the machine-actionable coded unit (UCUM when `system` is [UCUM\_SYSTEM](#ucum_system)).

##### comparator

> `readonly` **comparator**: `string` \| `undefined`

`Quantity.comparator` (`<` | `<=` | `>=` | `>`), a bound, not an exact value, when present.

##### system

> `readonly` **system**: `string` \| `undefined`

`Quantity.system`, the unit code system URI (UCUM for a coded quantity).

##### unit

> `readonly` **unit**: `string` \| `undefined`

`Quantity.unit`, the human-readable display string. **Not** for machine comparison.

##### value

> `readonly` **value**: [`FhirDecimal`](#fhirdecimal) \| `undefined`

`Quantity.value`, the exact decimal, or `undefined` when this reader found no magnitude it can
read: an absent `value`, a `comparator`-only bound, or text outside the R4 `decimal` lexical
space. **That last one is a residual, not a guarantee.** `<value value="+5"/>` reads `undefined`
beside a unit that reads fine, and nothing is raised on any channel to say a magnitude was
written there.

***

### RawArray

A JSON array node.

#### Properties

##### items

> `readonly` **items**: readonly [`RawJson`](#rawjson)[]

##### t

> `readonly` **t**: `"arr"`

***

### RawBool

A JSON boolean node.

#### Properties

##### t

> `readonly` **t**: `"bool"`

##### value

> `readonly` **value**: `boolean`

***

### RawMember

A member of a [RawObject](#rawobject), preserving key and source order.

#### Properties

##### key

> `readonly` **key**: `string`

##### value

> `readonly` **value**: [`RawJson`](#rawjson)

***

### RawNull

A JSON null node.

#### Properties

##### t

> `readonly` **t**: `"null"`

***

### RawNumber

A JSON number node, preserved as its **exact** source text, never a JavaScript `number`.

#### Properties

##### raw

> `readonly` **raw**: `string`

##### t

> `readonly` **t**: `"num"`

***

### RawObject

A JSON object node, members in source order (duplicate keys preserved as separate members).

#### Properties

##### members

> `readonly` **members**: readonly [`RawMember`](#rawmember)[]

##### t

> `readonly` **t**: `"obj"`

***

### RawString

A JSON string node, already unescaped to its logical value.

#### Properties

##### t

> `readonly` **t**: `"str"`

##### value

> `readonly` **value**: `string`

***

### ReadResult

The result of reading a FHIR resource: the model plus any value-free issues gathered en route.

#### Properties

##### issues

> `readonly` **issues**: readonly [`FhirIssue`](#fhirissue)[]

Value-free diagnostics accumulated during the lenient read (never contains PHI).

##### resource

> `readonly` **resource**: [`FhirComplex`](#fhircomplex)

The parsed resource as an immutable model tree.

***

### RequiredBinding

A required-strength value-set binding to a fixed set of `code` values.

#### Properties

##### codes

> `readonly` **codes**: readonly `string`[]

The complete enumerated code set.

##### strength

> `readonly` **strength**: `"required"`

Only `"required"` bindings are enforced here; weaker strengths are the terminology layer's.

***

### ResourceSchema

A resource's direct elements, keyed by element name (the `choice[x]` base for choices).

#### Properties

##### elements

> `readonly` **elements**: `Readonly`\<`Record`\<`string`, [`ElementSchema`](#elementschema)\>\>

Direct elements by name. The base-resource elements are merged in by the registry.

##### type

> `readonly` **type**: `string`

The resource type this schema describes (e.g. `"Patient"`).

***

### SafetyReadout

The complete, value-free safety readout of a resource. Every modifier element the safety resource
types can carry has a slot here, present or `undefined`, so a consumer building a summary
reads them explicitly rather than forgetting one.

**`negations` is the authoritative safety read, and it is collected at every resource root** the
document carries, so a retracted `Observation`, a not-performed `Procedure` or an order marked "do
not give" inside `contained` or a `Bundle.entry` reaches it. The one negation not collected from
the walk is `no-known-allergy`, which stays the root, type-scoped read on its own field for the
reasons given there.

**Two groups of fields, and the difference is which question they answer.** The location channels
(`unhandledModifierExtensions`, `modifierElements`, `intents`, `datatypeUses`,
`shadowedProperties`, `arrayWrappedScalars`, `nestedArrays`, `droppedText`, `unreadableBooleans`,
`nearMissNegationCodes`, `unreadableNegationCodes`, `unreadableIntents`,
`unreadableDatatypeUses`, `absenceMarkers`, `unreadableAbsenceMarkers`,
`conflictingAbsenceMarkers`) and the `safeToSummarize` derived from them (from all but
`absenceMarkers`, `intents` and `datatypeUses`, which disclose rather than refuse) are
**document-wide**: they carry FHIRPath locations, so a nested finding has an address to name, and
`assertSafeToSummarize` refuses over a `Bundle`'s entries. The **single-valued** fields
(`resourceType` / `status` / `clinicalStatus` / `verificationStatus` / `doNotPerform` / `retracted`
/ `noKnownAllergy`) answer about **the resource handed in** and nothing nested inside it, because
one value cannot say which resource it came from. `negations` is the read that crosses that line:
it is a document-wide **set** with no locations. Branch on it, not on the single-valued fields,
whenever the resource may carry others.

The single-code convenience fields (`resourceType` / `status` / `clinicalStatus` /
`verificationStatus`) surface one value: the
*preferred*-system coding of a `CodeableConcept`, falling back to the first coding when the
standard one is absent (which may be a local/translation code), and the first member written when a
non-conformant document repeated a property name or wrapped the element in an array. The classified
`negations` are derived from **every** coding under any system and **every** value written for the
element each negation reads (`resourceType`, `status`, `verificationStatus`, `code`,
`doNotPerform`), including the ones a repeated property name shadowed and the ones inside an array
wrapper **around the element**, so a refutation or a retraction cannot hide in the value a
single-value lookup skipped, and the type gate cannot hide a type-scoped negation behind a type it
did not read. That extends **one level down**, to an array around a `Coding.system` / `Coding.code`
inside a `CodeableConcept`, where the wrapper holds a single array position; a multi-position one is
reported rather than read, because pairing a `system` from one position with a `code` from another
would assert a coding the sender never wrote (see [arrayWrappedScalars](#arraywrappedscalars-1)). Read a safety
decision off `negations`, not off the raw status string, and check `safeToSummarize` before
flattening anything.

#### Properties

##### absenceMarkers

> `readonly` **absenceMarkers**: readonly [`AbsenceMarker`](#absencemarker)[]

Every element the document declares an absence for, with the reason the sender spelled and the
FHIRPath location of the element it sits on. This is the read that separates "we asked and
nobody knows" from "we never sent this": both leave the element value-absent, and before this
channel the two were the same answer to a caller.

The marker is the R4 DataAbsentReason **extension**, on a complex element or on a primitive's
extension metadata, in either wire format. See ../safety/absence.js for the recognition
predicate, for the closed value set a `code` is drawn from, and for the two neighbouring shapes
that are deliberately NOT markers (the same code system used as a `Coding` inside a coded
element, and the `Observation.dataAbsentReason` ELEMENT with its own `obs-6` invariant).

**This channel does NOT lower [SafetyReadout.safeToSummarize](#safetosummarize)**, and it is the only
location-bearing channel here that does not. Every other one marks something the library could
not read or could not rank; a readable, non-conflicting marker is the opposite, a disclosure the
sender made deliberately and the caller can now read. Refusing to summarize over it would
withdraw an affirmation from a conformant document, which is the one direction this layer's
contract forbids. The two channels beside it, [SafetyReadout.unreadableAbsenceMarkers](#unreadableabsencemarkers) and
[SafetyReadout.conflictingAbsenceMarkers](#conflictingabsencemarkers), do lower it, and for the ordinary reason.

**Document-wide**, like the location channels beside it: a marker inside `contained` or a
`Bundle.entry` is here, with a location that names where it sits.

Empty for every document that carries no DataAbsentReason extension, which is where a document
carrying none reads exactly as it did before this channel existed.

##### arrayWrappedScalars

> `readonly` **arrayWrappedScalars**: readonly `string`[]

FHIRPath locations where a `0..1` safety element (or `resourceType`) arrived wrapped in a JSON
array, the shape a generic XML-to-JSON converter emits for every element. Empty on every
conformant document, since FHIR JSON uses an array only for a repeating element.

##### clinicalStatus

> `readonly` **clinicalStatus**: `string` \| `undefined`

The `clinicalStatus` code, preferred-system-first (AllergyIntolerance / Condition). Convenience only.

##### conflictingAbsenceMarkers

> `readonly` **conflictingAbsenceMarkers**: readonly `string`[]

FHIRPath locations of elements that carry an absence marker **and** a value of their own, so the
document says both "here is the value" and "there is no value" about one element.

Nothing here resolves the contradiction. The value stays in the model where a caller walking it
finds it, the marker stays on [SafetyReadout.absenceMarkers](#absencemarkers) when its reason is readable,
and this location is what stops a caller silently preferring whichever of the two its own read
happened to reach first.

A complex element "carries a value" when it holds any member beyond `id`, `url`, `extension`,
`modifierExtension` and the JSON encoding's `resourceType`, none of which is the value a marker
denies; a primitive carries one when its value channel is filled.

Empty for every conformant document: an element the sender has data for is written with the
data and no marker.

##### datatypeUses

> `readonly` **datatypeUses**: readonly [`DatatypeUseReport`](#datatypeusereport)[]

`use` on an Identifier, a HumanName, an Address or a ContactPoint, surfaced at **every covered
position** the document carries: the code exactly as written, paired with the location of that
`use` element, one pair per position, in walk order.

The covered positions sit below a resource root of one of the eight types this library's safety
layer models (`AllergyIntolerance`, `Condition`, `DiagnosticReport`, `Immunization`,
`MedicationRequest`, `MedicationStatement`, `Observation`, `Patient`), whether that root is the
resource handed in, a `contained` one or a `Bundle.entry`: every member named `identifier` or
`groupIdentifier` at any depth (a Reference's identifier included), and on a `Patient` its
`name`, `telecom` and `address` and the same three on each `contact` entry. A position belongs to
its nearest enclosing resource root, and a root of any other type reads nothing here.

R4 flags `use` a modifier on all four datatypes, so that an `old` or `temp` entry is not taken
for a current one. It is optional and written on most records, so it is surfaced rather than
refused on presence, and a readable one **does not lower [safeToSummarize](#safetosummarize)**. Only a code
of the value set of the position's OWN datatype is surfaced, matched exactly, so `temp` reads on
all four and `maiden` on a HumanName only, and this field carries no text the library did not
spell. A `use` that is present and not one of those codes is on [unreadableDatatypeUses](#unreadabledatatypeuses)
instead. A position with no `use` surfaces nothing.

**Surfaced, never interpreted.** Nothing here maps `old` or `temp` to "not current", and nothing
is filtered, reordered or picked as the current entry: which entry to show is the caller's
decision. `Practitioner.identifier.use` is not here: it keeps its presence rule on
[modifierElements](#modifierelements-1). **Declared limits:** a datatype carried as an extension value
(`valueIdentifier`, `valueHumanName`, `valueAddress`, `valueContactPoint`) is not read, nor is a
position inside a nested resource root whose type is not one of the eight (a contained
`Organization`'s `identifier` or `telecom`); and an ended `period` on an entry is a separate
element this does not read.

Located by the same bound and the same root rule as [modifierElements](#modifierelements-1).

##### doNotPerform

> `readonly` **doNotPerform**: `boolean` \| `undefined`

`doNotPerform` **on the resource handed to [readSafety](#readsafety)**, whatever its type, read off
either wire format's model: the JSON codec's `boolean`, or the lexical `true` / `false` the
schema-free XML reader keeps as the text of the `value` attribute. Text outside that two-word
lexical space (`"TRUE"`, `"1"`) still reads as `undefined` (coercing it would author a value the
sender did not spell) but no longer silently: the element's location is on
[unreadableBooleans](#unreadablebooleans-1) and the resource is not `safeToSummarize`. So `undefined` here means
*either* "no boolean was written" or "one was written and could not be read", and the two are
told apart by that channel, never by this field.

**Convenience only, and root-scoped like `status` beside it.** A `doNotPerform` written on a
resource *inside* this one, in `contained` or a Bundle `entry`, leaves this field `undefined`
and still puts `do-not-perform` on [negations](#negations), which is the authoritative read. Branch on
`negations`, never on this field, when the resource may carry others.

##### droppedText

> `readonly` **droppedText**: readonly `string`[]

FHIRPath locations where an XML document wrote **character data directly on a FHIR element**,
which has no slot for it: a primitive's value travels in the `value` attribute (xml.html
§2.6.1), so the reader drops the text. Like `nestedArrays` the content at these locations is
**not readable**, and the element then looks exactly like one the sender left out, which is how
`<status>entered-in-error</status>` came to read as a live record. Empty on every conformant
document and on every document read from JSON.

##### intents

> `readonly` **intents**: readonly [`IntentReport`](#intentreport)[]

`MedicationRequest.intent`, surfaced at **every `MedicationRequest` root** the document carries
(the resource handed in, a `contained` one, a `Bundle.entry`): the code exactly as written,
paired with the location of that root's `intent`, one pair per root, in walk order.

R4 flags `intent` a modifier (a `proposal` is not an `order`) and makes it mandatory, so it is
surfaced the way `status` is rather than refused on presence, and a readable one **does not
lower [safeToSummarize](#safetosummarize)**. Only the eight codes of the R4 value set can appear here,
matched exactly and case-sensitively, so this field carries no text the library did not spell.
An `intent` that is present and not one of them is on [unreadableIntents](#unreadableintents) instead, and its
root surfaces nothing here. A root with no `intent` at all surfaces nothing and refuses nothing:
a missing mandatory element is the validator's verdict, not this readout's.

No meaning is read from the code: nothing here says whether a request is in force.

##### modifierElements

> `readonly` **modifierElements**: readonly [`ModifierElementReport`](#modifierelementreport)[]

The modifier ELEMENTS present in the document, one entry per distinct location, each naming the
element and where it is. R4 flags several ordinary base elements `Is Modifier: true` because
they change how the value beside them must be read, and this is the channel that surfaces them:
`comparator` wherever the walk reaches a node carrying it, `implicitRules` likewise,
`Patient.active`, `Patient.deceased[x]` (element `deceased`, located at the member as written,
`deceasedBoolean` or `deceasedDateTime`), `Patient.link` (once, at `link`, however many entries),
`Immunization.isSubpotent`, and `use` on a `Practitioner`'s `identifier` entries. Every one of
them lowers [safeToSummarize](#safetosummarize) **on presence, at any value**: a bounded quantity summarized
as a point value is a wrong clinical number delivered under a clean verdict, a deceased patient
or a record replaced by another is not the live record a summary would present, and a
subpotent dose does not protect the way the record would otherwise say. `deceasedBoolean: false`
and `isSubpotent: false` report too, as `active: true` does, because deciding from the value
would be interpreting the modifier; an unreadable value (a `null`, a wrong JSON type, the `_`
form alone, an array wrapper, a name written twice, a `deceased` member R4 does not define) is
reported the same way and never read.

`MedicationRequest.intent` is not here: it is mandatory, so it is surfaced on [intents](#intents)
instead.

**Distinct from [unhandledModifierExtensions](#unhandledmodifierextensions-1), and the two never double-report.** A
modifier EXTENSION stays on that channel and draws nothing here, so one modifier extension is
one report. `implicitRules` is a modifier element and reports here rather than there.

**Reporting only.** The element is surfaced and never interpreted: no bound, no range, no
inequality is read out of a `comparator`, and no value, code or URI is carried. See
../safety/modifier-elements.js for the recognition predicate, for what a location may
carry, and for the resource type names that may root one.

Empty for a document carrying none of them, where this readout returns exactly what it always
did.

##### nearMissNegationCodes

> `readonly` **nearMissNegationCodes**: readonly `string`[]

FHIRPath locations of a `code`-valued negation element holding a value that differs from a code
this layer classifies **only by letter case, only by surrounding whitespace, or by both**, where
the exact-string match therefore declined it and **that** negation was not classified.

**Nothing is dropped at parse time.** Unlike the channels above it, this one does not mark
content the codec could not keep: the value is in the model, at the element this location names,
and a caller walking the model finds it there. What did not happen is the *classification*. FHIR
`code` is case-sensitive and its lexical space excludes surrounding whitespace
(`[^\s]+(\s[^\s]+)*`, datatypes.html), so `"NOT-DONE"` and `" not-done"` are not the code
`not-done` and this library will not read them as one. **The value is never coerced, trimmed or
case-folded into the negation**: that would accept a non-conformant document as though it were
conformant and author a negation the sender did not spell. What this channel fixes is that the
refusal used to be *silent*: a caller branching on [negations](#negations), which is what this
readout tells it to do, saw an empty list over a document that plainly spelled a negation.

**This is NOT a promise that the value appears elsewhere on this readout, and the difference
bites in two ordinary shapes.** `status` / `verificationStatus` are **root-scoped** and
single-valued, and this channel is document-wide, so a near miss inside `contained` or a
`Bundle.entry` leaves them holding the *root's* value or `undefined`; and
`verificationStatus` surfaces the preferred-system coding, so a near miss in a second coding is
not the code it shows. Walk the model at the location; do not read the value off a convenience
field.

**A near miss is suppressed where the same element also spells that code exactly**, because the
negation is then classified and a caller has it. R4 permits translation codings beside the one
from a required binding's value set (terminologies.html), so a `verificationStatus` carrying
`refuted` from the standard system and `REFUTED` from a local one is **conformant** and draws
nothing here. The suppression is per code, so a near miss of a *different* code at that element
still reports.

The elements are the `code`-valued ones the negation read looks at, `status` and
`verificationStatus`, at **every resource root**, which is [negations](#negations)' window.
[arrayWrappedScalars](#arraywrappedscalars-1) reaches every root too, but only for the `Coding` members of the
elements that same table marks `codings` (`verificationStatus`, not `status`), and its
element-level half is scoped to the resource types whose cardinality this layer knows, so the
two windows are **not** the same window. `AllergyIntolerance.code` is **not** among them: SNOMED
`716186003` is a *positive* assertion whose read is root- and type-scoped (see
[noKnownAllergy](#noknownallergy)), and disclosing a near miss at every root would report the miss where
an exact hit is read by nothing.

**Value-free, like every location on this readout**: the text that failed to match is not
carried here or anywhere else, and neither is the code it resembles.

**Empty for every conformant document read from JSON, with one shape admitted rather than claimed
away**: a `CodeableConcept` may carry translation codings beside the one a required binding's
value set supplies, and R4 asks only that *one* coding come from that set (terminologies.html)
while `datatypes.html` asks that each coding represent the same concept **without a SHALL**.
Under that permissive reading a document whose translation coding differs from a negation code
**only by case** is conformant, and this channel discloses it. (Only the case half can be: a
surrounding-whitespace value is outside `code`'s lexical space whatever coding carries it.)
Over-disclosure is the fail-safe direction, and the slice's own tests pin the case.
**In XML the whitespace half is a further declared limit rather than a
claim**: R4 derives `code` from `xs:token` (fhir-base.xsd), whose
`whiteSpace=collapse` facet strips surrounding whitespace *before* validation, so
`<status value=" not-done"/>` is schema-valid and a schema-validating consumer reads it as the
code. This reader is schema-free and does not collapse, so it discloses rather than reads. That
is the fail-safe direction, and it is stated here rather than claimed away.

##### negations

> `readonly` **negations**: readonly [`NegationKind`](#negationkind)[]

Every negation asserted **anywhere in the document** (from all codings, any system), the
authoritative safety read: at the resource handed in and at every resource root inside it, so a
`contained` or `Bundle.entry` resource's retraction, refutation, `not-done` / `not-taken` status
or "do not perform" instruction is here. Value-free and **unlocated**, so a kind appears once
however many resources assert it, in a fixed order that does not depend on entry order.
`no-known-allergy` is the one exception and is root-scoped; see [noKnownAllergy](#noknownallergy).

##### nestedArrays

> `readonly` **nestedArrays**: readonly `string`[]

FHIRPath locations where the document wrote an array inside an array, a shape FHIR JSON gives no
meaning at any position. Unlike every other location here the content at these is **not
readable**: the codec does not model an inner array, so this is the record that something was
written where the model now shows an empty element. Whole resources have been lost this way
inside a Bundle entry. Empty on every conformant document.

##### noKnownAllergy

> `readonly` **noKnownAllergy**: `boolean`

Whether **the resource handed to [readSafety](#readsafety)** is a recorded "no known allergy" (SNOMED
`716186003` on an `AllergyIntolerance.code`), not an allergy *to* that code.

**Root-scoped and type-scoped, and alone among the negations in being both.** Every other
negation is read off an element R4 flags `?!`, where a consumer may not process the element as if
it were absent and surfacing one can only make a caller more careful. This one is a *positive*
clinical assertion read off an element R4 does not flag at all, and surfacing it from somewhere
inside a document could make a caller **less** careful about a patient, while leaving it
unsurfaced reads as *unknown*. So a nested `AllergyIntolerance` recording it reaches neither this
field nor [negations](#negations): a declared gap in the fail-safe direction, not an oversight.

##### resourceType

> `readonly` **resourceType**: `string` \| `undefined`

The first `resourceType` the document names, read through a repeated name or an array wrapper,
**bounded** to the published form of a resource type name, or `undefined` if the resource names
none. Every R4 type is returned exactly as written; anything that is not shaped like a type name
reads as the [WITHHELD](#withheld) marker, `"<withheld>"`, because this is the one identifier on this readout
that a caller would interpolate to describe a location, and a location is not a place to echo
whatever a sender wrote. Convenience only: the type-scoped negation reads consider **every**
type named, not just this one, and they read it unbounded.

##### retracted

> `readonly` **retracted**: `boolean`

Whether **the resource handed to [readSafety](#readsafety)** is marked `entered-in-error` (retracted,
not data), read off its own `status` or `verificationStatus`.

**Root-scoped, like `status` beside it.** A retracted resource in `contained` or a `Bundle.entry`
leaves this `false` (a Bundle is not retracted because one of its entries is) and still puts
`entered-in-error` on [negations](#negations), which is the read that covers the whole document. So
`retracted` implies `entered-in-error` is on `negations`, never the other way round.

##### safeToSummarize

> `readonly` **safeToSummarize**: `boolean`

`false` when the resource must not be flattened: an unhandled `modifierExtension` is present, a
modifier ELEMENT is present, a
repeated property name left an element with more than one value, a `0..1` safety element
arrived array-wrapped, an array inside an array left content the codec could not read, XML
character data on an element was dropped, a boolean-valued safety element carries a written
value this layer cannot read, a `code`-valued negation element carries a value that spells a
negation code bar its case or its surrounding whitespace, such an element holds content at a
position no `code` read can reach, a `MedicationRequest.intent` is not one of the eight R4
codes, a `use` on an Identifier, a HumanName, an Address or a ContactPoint is not a code of its
datatype's R4 value set, an element declares an absence in a reason this library
cannot read, or an element declares an absence and carries a value. Each is a case where a
summary would have to assert something this library cannot establish (for the negation pair,
that no negation was asserted; for the absence pair, which of two contradictory answers the
element holds), so it declines instead.

**A readable, non-conflicting absence marker does NOT move this**, and that exception is the
point of the channel rather than a hole in the rule: the declaration is read, carried and
addressable, so nothing about the document is unestablished. See
[SafetyReadout.absenceMarkers](#absencemarkers). **Nor does a readable `intent`**, which is surfaced on
[SafetyReadout.intents](#intents) for the caller to read, **nor a readable `use`** on the four
datatypes, which is surfaced on [SafetyReadout.datatypeUses](#datatypeuses): `old` and `temp` included,
because refusing on WHICH code was written would be interpreting the modifier.

##### shadowedProperties

> `readonly` **shadowedProperties**: readonly `string`[]

FHIRPath locations where the document wrote a property name more than once, so the element has
several values and no rule says which one the sender meant (fail-closed). Empty on every
conformant document, since FHIR JSON requires unique property names.

##### status

> `readonly` **status**: `string` \| `undefined`

The `status` code (Observation / Immunization / DiagnosticReport / MedicationRequest·Statement).

##### unhandledModifierExtensions

> `readonly` **unhandledModifierExtensions**: readonly `string`[]

FHIRPath locations of `modifierExtension`s this library does not understand (fail-closed).

##### unreadableAbsenceMarkers

> `readonly` **unreadableAbsenceMarkers**: readonly `string`[]

FHIRPath locations of elements carrying an absence marker whose reason this library could not
read: no `valueCode`, a `valueCode` holding no readable string, an empty one, one written twice,
or a code outside the closed fifteen-concept value set the extension's required binding names.

**Nothing is read as `unknown` and nothing is read as populated.** Coercing an unreadable code
into the value set's most common member would author a reason the sender did not spell, and
treating the element as populated would erase the declaration entirely. The element stays
value-absent, the marker stays unread, and this location is the record that a declaration was
made and could not be honoured. It is the same disposition
[SafetyReadout.nearMissNegationCodes](#nearmissnegationcodes) takes for the same reason.

**Value-free**: neither the code that failed to match nor anything else from the element is
carried, only the location.

Empty for every conformant document, in either wire format: the extension's `value[x]` binds to
that value set at required strength, so a member of it is what a conformant document writes.

##### unreadableBooleans

> `readonly` **unreadableBooleans**: readonly `string`[]

FHIRPath locations where a `boolean`-valued safety element carries a **written value outside the
R4 `boolean` lexical space** (`true` / `false`, datatypes.html), so the element is present, the
sender filled it in, and the read still returns `undefined`. `<doNotPerform value="1"/>` and
`value="Y"` are ordinary v2 / C-CDA converter output and land here; without the location they
read exactly like `value="0"`, and a "do not administer" is indistinguishable from its opposite.
Its content is **not readable**, as [nestedArrays](#nestedarrays-1)' and [droppedText](#droppedtext-3)' is, and like
them it carries locations and no values. **How many channels share that property is deliberately
not written down**: that census has gone stale here before.
The element read is `doNotPerform`, at any resource root, on any type; it is the only `boolean`
this readout takes off a document at all, since `retracted` and `noKnownAllergy` come from codes
and codings. Empty whenever each `doNotPerform` is written as exactly `true` or `false`. That is
not every schema-valid document: R4's XML schema takes `<doNotPerform value=" true"/>`, since its
`xs:boolean` collapses surrounding whitespace, and R4 says an XML reader SHOULD trim it. This
reader does not trim, so that value lands here and the resource is not `safeToSummarize`.

##### unreadableDatatypeUses

> `readonly` **unreadableDatatypeUses**: readonly `string`[]

FHIRPath locations of a `use` on an Identifier, a HumanName, an Address or a ContactPoint, at a
covered position ([datatypeUses](#datatypeuses)), that this library could not read as a code of that
position's own R4 value set: a string outside it (a case or surrounding-whitespace variant of a
code, the empty string, or a code from a sibling set, such as `maiden` on an Identifier), a JSON
`null`, a value of another JSON type, the `_use` form with no value, an array wrapper, or the
name written twice.

Each `use` is a modifier bound to its value set at required strength, so a value outside it says
something this library cannot establish, and **nothing is case-folded, trimmed or mapped to a
nearby code**: the position surfaces no code on [datatypeUses](#datatypeuses), its location is here, and
the resource is not [safeToSummarize](#safetosummarize). Value-free: the text that failed is carried
nowhere.

Located by the same bound and the same root rule as [modifierElements](#modifierelements-1). Empty for every
conformant document.

##### unreadableIntents

> `readonly` **unreadableIntents**: readonly `string`[]

FHIRPath locations of a `MedicationRequest.intent` this library could not read as one of the
eight R4 codes, at any `MedicationRequest` root: a string outside them (including a case or
surrounding-whitespace variant of one, and the empty string), a JSON `null`, a value of another
JSON type, the `_` form with no value, an array wrapper, or the name written twice.

`intent` is a modifier bound to its value set at required strength, so a value outside it says
something this library cannot establish, and **nothing is case-folded, trimmed or mapped to a
nearby code**: the root surfaces no code on [intents](#intents), its location is here, and the
resource is not [safeToSummarize](#safetosummarize). Value-free: the text that failed is carried nowhere.

Located by the same bound and the same root rule as [modifierElements](#modifierelements-1). Empty for every
conformant document.

##### unreadableNegationCodes

> `readonly` **unreadableNegationCodes**: readonly `string`[]

FHIRPath locations of a `code`-valued negation element holding **content at a position no
datatype FHIR spells there can hold**: an object carrying **any member outside**
`{coding, text, id, extension}` (`{"status":{"value":"not-done"}}` and
`{"status":{"id":"s1","value":"not-done"}}`, the members a generic converter makes of FHIR XML's
`value` attribute and the primitive's own metadata beside it), an object carrying **no member at
all** (`ele-1` forbids an element with no value, children or extension), or a written value that
is not a string at all. **`ele-1` grounds that one arm; it is not a rule this channel
enforces**, and `{"status":{"id":"s1"}}` / `{"status":{"coding":[]}}` violate it too and are
deliberately not reported, their members being ones FHIR spells here. The element is present, and the negation read still returned nothing, so `{"resourceType":"Procedure","status":{"value":"not-done"}}` read `negations: []`
under `safeToSummarize: true`, indistinguishable from a procedure that was carried out.

**The shape complement of [nearMissNegationCodes](#nearmissnegationcodes-1), and the two do not overlap.** That one
covers a *value* the exact match declined; this one covers a *position* the read could take no
value from at all, which is the case a value-shaped question cannot see. It is the same
distinction that keeps an object at `doNotPerform` off [unreadableBooleans](#unreadablebooleans-1), which asks
only about written values.

**Nothing reads through this location.** `{"value":"not-done"}` is the *XML* spelling of a
primitive; FHIR JSON spells a `code` as a JSON string (json.html §2.6.0), so descending to find
the code would resolve a negation out of an encoding no version of FHIR defines for JSON. The
value is in the model at the location named here and a caller walking it finds it. **What this
fixes is the silence, not the strictness**, the same disposition
[nearMissNegationCodes](#nearmissnegationcodes-1) takes.

**Two datatypes reach a root `status`, and this clears both.** R4 spells it a `code` on the
overwhelming majority of types and a **`CodeableConcept`** on `MedicinalProductAuthorization`
and `SubstanceSpecification`; R5 adds several more, including a mandatory
`DeviceAssociation.status`; DSTU2 spells every one a `code`. So the question is about the
**shape**, not about which read succeeded: a complex **all of whose members** are ones FHIR
spells here (`coding`, `text`, `id`, `extension`) is left alone, whether or not a code came out
of it, while **any** member outside that set is reported, as is an object with **no** member at
all (`ele-1`: an element present in a resource SHALL carry a value, children defined for its
type, or an extension). The polarity is load-bearing: exempting a shape for carrying *one* legal
member would read `{"status":{"id":"s1","value":"not-done"}}` as clean, and that is the same
converter output. Keyed on "no string was read" instead, this would refuse the published R4
`MedicinalProductAuthorization` example, which was measured rather than feared.

**The element is `status`, at every resource root**, which is [negations](#negations)' window: the
entry node plus every node carrying its own `resourceType`, so a `Bundle.entry` or `contained`
resource is covered. **`verificationStatus` is deliberately absent and it is a declared limit**:
its shape complement is a *primitive* at the element, and `Condition.verificationStatus` **is** a
`code` in DSTU2, a version this reader ingests tolerantly, so the same predicate would report a
conformant DSTU2 document. Both directions are pinned rather than described.

**Value-free, like every location on this readout**: neither the content at the position nor
anything read out of it is carried here.

**Empty for every conformant document this library has been measured against, in either wire
format**, and the limit is declared rather than claimed away: a version spelling a root `status`
as a datatype whose members are none of the above would be reported, and the census found none
in R4, R5 or DSTU2. The XML reader models a `value` attribute beside `id` / `extension` children
as a primitive, so a conformant `<status value="not-done"><extension …/></status>` is read. A
primitive whose value is *absent* is not reported either: that is the conformant
`data-absent-reason` shape (json.html §2.6.2.3), and it is content the read never stepped over.
**The converse limit:** a shape **all of whose members** are ones FHIR spells here is never
reported, so a code buried under `{"status":{"coding":{…}}}` at a type whose `status` is a
`code` stays silent. One member outside the set is enough to report, so this covers only a shape
that is wholly a `CodeableConcept`.

##### verificationStatus

> `readonly` **verificationStatus**: `string` \| `undefined`

The `verificationStatus` code, preferred-system-first (AllergyIntolerance / Condition). Convenience only.

***

### SliceConstraint

One `fixed[x]` / `pattern[x]` constraint a slice imposes, at a path relative to the slice element.

#### Properties

##### kind

> `readonly` **kind**: `"pattern"` \| `"fixed"`

Whether the constraint is `fixed` (exact) or `pattern` (subset).

##### path

> `readonly` **path**: `string`

The path relative to the sliced element (`"$this"` for the slice element itself).

##### value

> `readonly` **value**: [`FhirNode`](#fhirnode)

The constraint value node.

***

### SliceDefinition

A resolved slice: its name, cardinality, value constraints, and existence expectations.

#### Properties

##### constraints

> `readonly` **constraints**: readonly [`SliceConstraint`](#sliceconstraint)[]

The `fixed`/`pattern` constraints the slice imposes, at paths relative to the sliced element.

##### existsExpectations

> `readonly` **existsExpectations**: `ReadonlyMap`\<`string`, `boolean`\>

Relative paths whose presence/absence the slice fixes (min ≥ 1 → present; max 0 → absent).

##### max?

> `readonly` `optional` **max?**: `number`

The slice's maximum cardinality, when stated.

##### min?

> `readonly` `optional` **min?**: `number`

The slice's minimum cardinality, when stated.

##### sliceName

> `readonly` **sliceName**: `string`

The slice name (e.g. `"VSCat"`).

##### unsatisfiableExists

> `readonly` **unsatisfiableExists**: `ReadonlySet`\<`string`\>

Relative paths the slice fixes as present **and** absent at once (`min ≥ 1` beside `max 0`).
No instance can meet such an expectation, so an `exists` discriminator on one of these paths
assigns no occurrence to the slice. Kept apart from [existsExpectations](#existsexpectations) rather than
resolved into a boolean there: neither boolean is true of a contradiction, and picking one
admits occurrences the profile forbids.

***

### SliceMatchResult

The outcome of matching a sliced element's instance occurrences to its slices.

#### Properties

##### assignments

> `readonly` **assignments**: readonly (`string` \| `undefined`)[]

Per instance occurrence (in order), the matched slice name, or `undefined` when none matched.

##### unchecked

> `readonly` **unchecked**: `boolean`

`true` when membership could not be evaluated (an unsupported/insufficient discriminator).

***

### Slicing

The slicing declaration on an element with slices.

#### Properties

##### discriminator

> `readonly` **discriminator**: readonly [`Discriminator`](#discriminator)[]

The discriminators distinguishing the slices (empty is legal but leaves slices unresolvable).

##### ordered?

> `readonly` `optional` **ordered?**: `boolean`

Whether slice order is significant (surfaced but not enforced here).

##### rules

> `readonly` **rules**: [`SlicingRules`](#slicingrules-1)

Whether content outside the defined slices is allowed. Absent defaults to `open` (the R4 default).

***

### StructureDefinition

The modeled slice of a FHIR `StructureDefinition`.

#### Properties

##### baseDefinition?

> `readonly` `optional` **baseDefinition?**: `string`

The canonical URL of the definition this one derives from.

##### derivation?

> `readonly` `optional` **derivation?**: [`Derivation`](#derivation-2)

Specialization (a base resource) or constraint (a profile).

##### differential?

> `readonly` `optional` **differential?**: readonly [`ElementDefinition`](#elementdefinition)[]

The differential element list (constraints relative to the base).

##### kind?

> `readonly` `optional` **kind?**: `string`

`resource` | `complex-type` | `primitive-type` | `logical`.

##### name?

> `readonly` `optional` **name?**: `string`

The computer-friendly name, when stated.

##### snapshot?

> `readonly` `optional` **snapshot?**: readonly [`ElementDefinition`](#elementdefinition)[]

The fully-resolved snapshot element list, when the definition carries one.

##### type

> `readonly` **type**: `string`

The resource type this definition constrains (`StructureDefinition.type`, e.g. `"AllergyIntolerance"`).

##### url

> `readonly` **url**: `string`

The canonical URL, the identity a profile is referenced by (`meta.profile`, `baseDefinition`).

##### version?

> `readonly` `optional` **version?**: `string`

The business version, when stated (e.g. US Core `"6.1.0"`). Part of the `canonical|version` key.

***

### TerminologyBinding

A binding from an element path to a value set, at a given strength.

#### Properties

##### path

> `readonly` **path**: `string`

The element's FHIRPath from the resource root, e.g. `"AllergyIntolerance.code"` or
`"MedicationRequest.medicationCodeableConcept"` (the concrete `medication[x]` choice variant).

##### strength

> `readonly` **strength**: [`BindingStrength`](#bindingstrength)

The binding strength, governs the severity of a non-conforming code.

##### systems?

> `readonly` `optional` **systems?**: readonly `string`[]

The closed set of code `system`s the value set draws from, when it is known. Present enables the
content-free "wrong system for this binding" check; absent, only a terminology service can judge
conformance. For an **extensible** binding a code from another system may be a legitimate
extension, so a system outside this set is a `warning`, never an `error` (see the layer).

##### valueSet

> `readonly` **valueSet**: `string`

The bound value set's canonical identity (URL / OID form), passed to a terminology service.

***

### TerminologyOptions

Terminology inputs to [collectTerminologyIssues](#collectterminologyissues), both optional (both degrade cleanly).

#### Properties

##### bindings?

> `readonly` `optional` **bindings?**: readonly [`TerminologyBinding`](#terminologybinding)[]

Extra element bindings, overriding the built-ins by path (profiles feed these).

##### terminology?

> `readonly` `optional` **terminology?**: [`TerminologyService`](#terminologyservice)

A pluggable terminology service for value-set membership. **None is bundled**; with none
supplied, membership checks are skipped and the layer degrades to the content-free system checks.

***

### TerminologyService

A pluggable terminology service, the one seam through which value-set **content** enters the
library. A consumer implements this over a real terminology server; the library bundles none.

An implementation MUST be **fail-safe**: when it cannot answer, it returns
`{ membership: "unknown" }` rather than throwing or guessing. It MUST be value-free, it receives
only identities ([CodeValidationRequest](#codevalidationrequest)), never a resource or a patient value. It MAY
declare the code-system release an answer was made against
([CodeValidationResult.systemVersion](#systemversion)); declaring nothing is conformant and is recorded as
undeclared rather than read as "current".

#### Example

```ts
import type { TerminologyService } from "@cosyte/fhir";

// A trivial service that only knows one value set; everything else is "unknown".
const svc: TerminologyService = {
  validateCode({ valueSet, code }) {
    if (valueSet !== "http://example.org/vs/colors") return { membership: "unknown" };
    return { membership: ["red", "green", "blue"].includes(code) ? "in" : "not-in" };
  },
};

// The same service, declaring the release each answer was made against.
const dated: TerminologyService = {
  validateCode({ valueSet, code }) {
    if (valueSet !== "http://example.org/vs/colors") return { membership: "unknown" };
    const membership = ["red", "green", "blue"].includes(code) ? "in" : "not-in";
    return { membership, systemVersion: "2026-08-04" };
  },
};
```

#### Methods

##### validateCode()

> **validateCode**(`request`): [`CodeValidationResult`](#codevalidationresult)

Decide whether a coding is a member of a value set.

###### Parameters

###### request

[`CodeValidationRequest`](#codevalidationrequest)

The value-set identity and the `(system, code)` to check.

###### Returns

[`CodeValidationResult`](#codevalidationresult)

The membership verdict, `"unknown"` when it cannot decide.

***

### Token

One lexical token: its [TokenType](#tokentype-1), its text/value, and its start offset (for diagnostics).

#### Properties

##### pos

> `readonly` **pos**: `number`

##### type

> `readonly` **type**: [`TokenType`](#tokentype-1)

##### value

> `readonly` **value**: `string`

***

### TypedValue

A value bound to a `fixed[x]` or `pattern[x]` constraint: the FHIR type name plus the value node.

#### Properties

##### type

> `readonly` **type**: `string`

The FHIR datatype suffix, e.g. `"Code"`, `"CodeableConcept"`, `"String"` (as it appears on the property).

##### value

> `readonly` **value**: [`FhirNode`](#fhirnode)

The constraint value, as a model node.

***

### ValidateOptions

Options for [validateResource](#validateresource).

#### Properties

##### bindings?

> `readonly` `optional` **bindings?**: readonly [`TerminologyBinding`](#terminologybinding)[]

Extra terminology bindings, overriding the built-ins by element path.

##### mode?

> `readonly` `optional` **mode?**: [`ValidationMode`](#validationmode)

Lenient (read, the default) or strict (emit). Only affects the severity of unknown elements.

##### profiles?

> `readonly` `optional` **profiles?**: readonly [`StructureDefinition`](#structuredefinition)[]

Profiles (`StructureDefinition`s) to validate against. **None is bundled**, a caller
supplies the US Core (or vendor) profiles. Every supplied profile whose `type` matches the
resource type is applied (fixed/pattern, must-support, slicing, profile cardinality), and the
resource's `meta.profile` version pins are checked against the supplied set.

##### registry?

> `readonly` `optional` **registry?**: [`SchemaRegistry`](#schemaregistry)

A registry built once by [buildRegistry](#buildregistry) and reused across calls, in place of `schemas`.
A call reads it exactly as it reads the `schemas` it was built from. When a call passes both,
the registry is used and `schemas` is not read.

##### resolveBase?

> `readonly` `optional` **resolveBase?**: [`BaseResolver`](#baseresolver)

A resolver from a `baseDefinition` canonical URL to a loaded `StructureDefinition`, used only to
generate a snapshot for a supplied profile that carries a differential but no snapshot.

##### schemas?

> `readonly` `optional` **schemas?**: readonly [`ResourceSchema`](#resourceschema)[]

Extra resource schemas, overriding the built-ins by type (profiles feed these). A call given
`schemas` merges them into a new registry; to validate many resources against the same schemas,
build the registry once with [buildRegistry](#buildregistry) and pass it as `registry` instead.

##### terminology?

> `readonly` `optional` **terminology?**: [`TerminologyService`](#terminologyservice)

A pluggable terminology service for value-set membership. **None is bundled**; without
one, terminology binding checks degrade to the content-free system checks and never false-error.

***

### ValidationIssue

A single value-free validation finding.

`expression` is a FHIRPath location into the document (e.g. `Patient.gender`,
`Observation.component[1].valueQuantity.value`), it says *where* without echoing *what*. An issue
never contains a resource value, so it is safe to log or return in an `OperationOutcome`.

**It is a location, and on non-conformant input it can be a location with a gap.** The segments
are the document's own names, and a name is echoed only when it matches the published form of a
FHIR name; anything else reads as the ../model/path.js `WITHHELD` marker, `"<withheld>"`.
A marker is not a FHIRPath identifier, so such an expression will not resolve against the
instance: R4 defines `OperationOutcome.issue.expression` as a FHIRPath subset that SHALL resolve
to a single node, and a location with a withheld segment does not. Every segment around the
marker is intact, so the nearest addressable ancestor is still there. Test for the marker before
handing an expression to a FHIRPath engine.

#### Properties

##### code

> `readonly` **code**: [`ValidationCode`](#validationcode)

##### codeSystemVersion?

> `readonly` `optional` **codeSystemVersion?**: [`CodeSystemVersionRecord`](#codesystemversionrecord)

Which code-system release the terminology service's answer was made against, when a service was
consulted to produce this finding (today, `CODE_NOT_IN_VALUESET` and only it). `undefined` for
every finding no service produced, including the content-free `CODE_SYSTEM_UNKNOWN` /
`CODE_SYSTEM_UNEXPECTED` checks, which consult nothing.

A declared release is the **caller's own assertion**, a public code-system release identifier on
the same footing as the constraint key an invariant finding surfaces, never an instance value,
so it is safe to surface. It reaches the `OperationOutcome` as `issue.details`
(./operation-outcome.js), and the `diagnostics` string stays derived from the finding
code alone.

##### constraint?

> `readonly` `optional` **constraint?**: `string`

The spec constraint key when the finding is an invariant violation (e.g. `"ait-1"`, `"obs-6"`),
a public FHIR identifier, never an instance value, so it is safe to surface. `undefined` for
every non-invariant finding. It reaches the `OperationOutcome` as `issue.details.text`.

##### expression

> `readonly` **expression**: `string`

FHIRPath location of the finding.

##### severity

> `readonly` **severity**: [`ValidationSeverity`](#validationseverity)

##### type

> `readonly` **type**: [`IssueType`](#issuetype)

The R4 `OperationOutcome.issue.code` this finding maps to.

***

### ValidationResult

The result of validating a resource: the findings plus an `OperationOutcome` view of them.

#### Properties

##### issues

> `readonly` **issues**: readonly [`ValidationIssue`](#validationissue)[]

The value-free findings, in document order. Empty when the resource validated clean.

##### toOperationOutcome

> **toOperationOutcome**: () => [`FhirComplex`](#fhircomplex)

Render the findings as an `OperationOutcome` resource model (value-free, serializable).

###### Returns

[`FhirComplex`](#fhircomplex)

##### valid

> `readonly` **valid**: `boolean`

Whether there were no `error`/`fatal` findings (warnings and information do not fail).

***

### XmlAttribute

A name/value attribute on an [XmlElement](#xmlelement). Values are already entity-decoded and
normalized (XML 1.0 §3.3.3): a literal tab, line feed, carriage return or CR LF pair is one space,
while a character reference such as `&#10;` keeps the character it names.

#### Properties

##### name

> `readonly` **name**: `string`

##### value

> `readonly` **value**: `string`

***

### XmlElement

An XML element node: a tag name, its attributes (source order), and its child nodes (source order).

#### Properties

##### attributes

> `readonly` **attributes**: readonly [`XmlAttribute`](#xmlattribute)[]

##### children

> `readonly` **children**: readonly [`XmlNode`](#xmlnode)[]

##### name

> `readonly` **name**: `string`

##### type

> `readonly` **type**: `"element"`

***

### XmlText

An XML character-data node, already entity-decoded to its logical text.

#### Properties

##### type

> `readonly` **type**: `"text"`

##### value

> `readonly` **value**: `string`

## Type Aliases

### AbsenceCode

> **AbsenceCode** = *typeof* [`ABSENCE_CODES`](#absence_codes)\[`number`\]

One of the fifteen [ABSENCE\_CODES](#absence_codes). A value of this type is always one of the literal
strings this package spells, never a string taken off a document, which is what makes an
[AbsenceMarker](#absencemarker) safe to log.

***

### BaseResolver

> **BaseResolver** = (`canonicalUrl`) => [`StructureDefinition`](#structuredefinition) \| `undefined`

A resolver from a canonical URL to a loaded [StructureDefinition](#structuredefinition) (for `baseDefinition`).

#### Parameters

##### canonicalUrl

`string`

#### Returns

[`StructureDefinition`](#structuredefinition) \| `undefined`

***

### BindingRegistry

> **BindingRegistry** = (`path`) => [`TerminologyBinding`](#terminologybinding) \| `undefined`

A resolver from an element path to its [TerminologyBinding](#terminologybinding), or `undefined`.

#### Parameters

##### path

`string`

#### Returns

[`TerminologyBinding`](#terminologybinding) \| `undefined`

***

### BindingStrength

> **BindingStrength** = `"required"` \| `"extensible"` \| `"preferred"` \| `"example"`

The four FHIR binding strengths (terminologies.html), strongest to weakest.

***

### BundleType

> **BundleType** = *typeof* [`BUNDLE_TYPES`](#bundle_types)\[keyof *typeof* [`BUNDLE_TYPES`](#bundle_types)\]

One of the [BUNDLE\_TYPES](#bundle_types), the R4 `Bundle.type`.

***

### CodeMembership

> **CodeMembership** = `"in"` \| `"not-in"` \| `"unknown"`

A membership verdict. `"unknown"` is a first-class answer, not a failure, a conformant service
returns it whenever it cannot decide, and the validator degrades cleanly rather than guessing.

***

### CodeSystemVersionRecord

> **CodeSystemVersionRecord** = \{ `declared`: `true`; `version`: `string`; \} \| \{ `declared`: `false`; \}

Which code-system release a membership answer was made against, as recorded on the finding.

Three states, all distinguishable, which is the whole point of the type:

- the field is **absent** from a [ValidationIssue](#validationissue): no terminology service was consulted to
  produce that finding, so there is no release to record (every content-free system check, every
  non-terminology finding);
- `{ declared: true, version }`: the service named the release, and `version` is its string
  **exactly** as declared, never normalised, trimmed, truncated or substituted;
- `{ declared: false }`: the service answered but named no release. The answer stands; its
  currency is **unknown and said so**, rather than left to a reader to fill in with "current".

The release is always the caller's own assertion. It is never read from the instance: a resource's
own `Coding.version` is document content and never reaches a finding.

***

### CodeSystemVersionRecordCode

> **CodeSystemVersionRecordCode** = *typeof* [`CODE_SYSTEM_VERSION_RECORD_CODES`](#code_system_version_record_codes)\[keyof *typeof* [`CODE_SYSTEM_VERSION_RECORD_CODES`](#code_system_version_record_codes)\]

One of the [CODE\_SYSTEM\_VERSION\_RECORD\_CODES](#code_system_version_record_codes).

***

### DatatypeUseCode

> **DatatypeUseCode** = `"usual"` \| `"official"` \| `"temp"` \| `"secondary"` \| `"old"` \| `"nickname"` \| `"anonymous"` \| `"maiden"` \| `"home"` \| `"work"` \| `"billing"` \| `"mobile"`

A `use` code this library surfaces on an Identifier, a HumanName, an Address or a ContactPoint:
the union of the four R4 4.0.1 value sets those elements bind to at required strength, and
nothing else. Which of them a given position may carry is decided by that position's own
datatype (IdentifierUse `usual` `official` `temp` `secondary` `old`; NameUse `usual` `official`
`temp` `nickname` `anonymous` `old` `maiden`; AddressUse `home` `work` `temp` `old` `billing`;
ContactPointUse `home` `work` `temp` `old` `mobile`).

#### Example

```ts
import { parseResource, readSafety, type DatatypeUseCode } from "@cosyte/fhir";
const { resource } = parseResource('{"resourceType":"Patient","name":[{"use":"old"}]}');
const codes: DatatypeUseCode[] = readSafety(resource).datatypeUses.map((u) => u.code);
codes; // ["old"]
```

***

### Derivation

> **Derivation** = `"specialization"` \| `"constraint"`

`StructureDefinition.derivation`, how a definition relates to its base.

***

### DiscriminatorType

> **DiscriminatorType** = `"value"` \| `"exists"` \| `"pattern"` \| `"type"` \| `"profile"`

The R4 discriminator types (`valueset-discriminator-type`) a slicing may use to tell its slices
apart. **`position` is R5-only and is deliberately not a member here**: an R4
profile that carries it is treated as an unsupported discriminator, not silently accepted.

***

### EntryProcessing

> **EntryProcessing** = `"atomic"` \| `"independent"` \| `"none"`

How a server would process a Bundle's entries, the artifact-level semantic contract.

- `"atomic"`, a `transaction`: all-or-nothing, entries may be interdependent.
- `"independent"`, a `batch`: each entry on its own, no rollback across entries.
- `"none"`, every other type: not a processing request, no entry contract.

***

### Expr

> **Expr** = \{ `kind`: `"empty"`; \} \| \{ `kind`: `"bool"`; `value`: `boolean`; \} \| \{ `kind`: `"string"`; `value`: `string`; \} \| \{ `kind`: `"number"`; `value`: `number`; \} \| \{ `kind`: `"envvar"`; `name`: `string`; \} \| \{ `kind`: `"variable"`; `name`: `string`; \} \| \{ `kind`: `"member"`; `name`: `string`; `target`: [`Expr`](#expr) \| `null`; \} \| \{ `args`: readonly [`Expr`](#expr)[]; `kind`: `"call"`; `name`: `string`; `target`: [`Expr`](#expr) \| `null`; \} \| \{ `index`: [`Expr`](#expr); `kind`: `"index"`; `target`: [`Expr`](#expr); \} \| \{ `kind`: `"unary"`; `op`: `string`; `operand`: [`Expr`](#expr); \} \| \{ `kind`: `"binary"`; `left`: [`Expr`](#expr); `op`: `string`; `right`: [`Expr`](#expr); \} \| \{ `kind`: `"typeop"`; `op`: `string`; `operand`: [`Expr`](#expr); `type`: `string`; \}

A parsed FHIRPath expression node.

#### Union Members

##### Type Literal

\{ `kind`: `"empty"`; \}

***

##### Type Literal

\{ `kind`: `"bool"`; `value`: `boolean`; \}

***

##### Type Literal

\{ `kind`: `"string"`; `value`: `string`; \}

***

##### Type Literal

\{ `kind`: `"number"`; `value`: `number`; \}

***

##### Type Literal

\{ `kind`: `"envvar"`; `name`: `string`; \}

***

##### Type Literal

\{ `kind`: `"variable"`; `name`: `string`; \}

***

##### Type Literal

\{ `kind`: `"member"`; `name`: `string`; `target`: [`Expr`](#expr) \| `null`; \}

Member access: `name` navigates from `target` (or the current focus when `target` is null).

***

##### Type Literal

\{ `args`: readonly [`Expr`](#expr)[]; `kind`: `"call"`; `name`: `string`; `target`: [`Expr`](#expr) \| `null`; \}

Function call: `name(args)` invoked on `target` (or the current focus when `target` is null).

***

##### Type Literal

\{ `index`: [`Expr`](#expr); `kind`: `"index"`; `target`: [`Expr`](#expr); \}

Indexer: `target[index]`.

***

##### Type Literal

\{ `kind`: `"unary"`; `op`: `string`; `operand`: [`Expr`](#expr); \}

***

##### Type Literal

\{ `kind`: `"binary"`; `left`: [`Expr`](#expr); `op`: `string`; `right`: [`Expr`](#expr); \}

***

##### Type Literal

\{ `kind`: `"typeop"`; `op`: `string`; `operand`: [`Expr`](#expr); `type`: `string`; \}

Type operator: `operand is Type` / `operand as Type` (the type is a possibly-qualified name).

***

### FatalCode

> **FatalCode** = *typeof* [`FATAL_CODES`](#fatal_codes)\[keyof *typeof* [`FATAL_CODES`](#fatal_codes)\]

Discriminant union of every [FATAL\_CODES](#fatal_codes) value.

***

### FhirNode

> **FhirNode** = [`FhirComplex`](#fhircomplex) \| [`FhirList`](#fhirlist) \| [`FhirPrimitive`](#fhirprimitive)

Any node in the model tree.

***

### FpColl

> **FpColl** = readonly [`FpItem`](#fpitem)[]

A FHIRPath collection, the value every expression evaluates to.

***

### FpItem

> **FpItem** = \{ `node`: [`FhirNode`](#fhirnode); `t`: `"node"`; \} \| \{ `t`: `"bool"`; `value`: `boolean`; \} \| \{ `t`: `"str"`; `value`: `string`; \} \| \{ `t`: `"num"`; `value`: `number`; \}

One item in a FHIRPath collection: a model node, or an engine-computed primitive.

***

### IssueCode

> **IssueCode** = *typeof* [`ISSUE_CODES`](#issue_codes)\[keyof *typeof* [`ISSUE_CODES`](#issue_codes)\]

Discriminant union of every [ISSUE\_CODES](#issue_codes) value.

***

### IssueSeverity

> **IssueSeverity** = `"warning"` \| `"information"`

FHIR issue severities carried by a warning (the recoverable subset of the R4 set).

***

### IssueType

> **IssueType** = *typeof* [`ISSUE_TYPES`](#issue_types)\[keyof *typeof* [`ISSUE_TYPES`](#issue_types)\]

One of the [ISSUE\_TYPES](#issue_types), the R4 `OperationOutcome.issue.code`.

***

### MedicationRequestIntent

> **MedicationRequestIntent** = `"proposal"` \| `"plan"` \| `"order"` \| `"original-order"` \| `"reflex-order"` \| `"filler-order"` \| `"instance-order"` \| `"option"`

A `MedicationRequest.intent` code this library surfaces: exactly the eight concepts of the R4
4.0.1 value set the element binds to at required strength, and nothing else.

#### Example

```ts
import { parseResource, readSafety, type MedicationRequestIntent } from "@cosyte/fhir";
const { resource } = parseResource('{"resourceType":"MedicationRequest","intent":"proposal"}');
const codes: MedicationRequestIntent[] = readSafety(resource).intents.map((i) => i.code);
codes; // ["proposal"]
```

***

### ModifierElementName

> **ModifierElementName** = `"comparator"` \| `"implicitRules"` \| `"active"` \| `"use"` \| `"deceased"` \| `"link"` \| `"isSubpotent"`

The modifier elements this channel reports, by their R4 element names. `deceased` names the R4
choice element `deceased[x]`; the report's location carries the member as the document wrote it.

`modifierExtension` is deliberately absent: it keeps its own fail-closed channel, so a modifier
extension yields one report and not two. `MedicationRequest.intent` is absent too: it is
surfaced as a code on its own field rather than reported on presence ([IntentReport](#intentreport)).

#### Example

```ts
import { parseResource, readSafety, type ModifierElementName } from "@cosyte/fhir";
const { resource } = parseResource('{"resourceType":"Patient","deceasedBoolean":true}');
const names: ModifierElementName[] = readSafety(resource).modifierElements.map((r) => r.element);
names; // ["deceased"]
```

***

### NdjsonErrorCode

> **NdjsonErrorCode** = *typeof* [`NDJSON_ERROR_CODES`](#ndjson_error_codes)\[keyof *typeof* [`NDJSON_ERROR_CODES`](#ndjson_error_codes)\]

One of the [NDJSON\_ERROR\_CODES](#ndjson_error_codes).

***

### NegationKind

> **NegationKind** = `"refuted"` \| `"no-known-allergy"` \| `"do-not-perform"` \| `"not-taken"` \| `"not-done"` \| `"entered-in-error"`

A classified negation, an explicit *negative* assertion that must never collapse into its positive
on a summary or a round-trip. One value per distinct FHIR negation mechanism this library covers.

***

### NestedArrayChannel

> **NestedArrayChannel** = `"value"` \| `"metadata"`

Which JSON channel a preserved array came from: the element's own value, or its `_`-sibling.

***

### ObservationValueType

> **ObservationValueType** = *typeof* [`OBSERVATION_VALUE_TYPES`](#observation_value_types)\[`number`\]

One of the eleven [OBSERVATION\_VALUE\_TYPES](#observation_value_types) `value[x]` variant suffixes.

***

### PrimitiveType

> **PrimitiveType** = *typeof* [`PRIMITIVE_TYPES`](#primitive_types)\[`number`\]

A FHIR R4 primitive datatype name.

***

### PrimitiveValue

> **PrimitiveValue** = `string` \| `boolean` \| [`FhirDecimal`](#fhirdecimal)

The scalar value a [FhirPrimitive](#fhirprimitive) can hold. `decimal` is a [FhirDecimal](#fhirdecimal); every
other primitive (`string`, `code`, `uri`, `date`, `boolean`, `integer`, …) reduces to one of
these three at the structural level. `undefined` means the value is absent but metadata is
present (the `_`-sibling-only case, e.g. an extension on a primitive that carries no value).

***

### RawJson

> **RawJson** = [`RawObject`](#rawobject) \| [`RawArray`](#rawarray) \| [`RawString`](#rawstring) \| [`RawNumber`](#rawnumber) \| [`RawBool`](#rawbool) \| [`RawNull`](#rawnull)

Any node in the raw JSON tree.

***

### ReferenceKind

> **ReferenceKind** = `"fragment"` \| `"relative"` \| `"absolute"` \| `"logical"`

Which of the four FHIR reference forms a `Reference.reference` string is.

***

### ReferenceResolution

> **ReferenceResolution** = \{ `status`: `"resolved"`; `target`: [`FhirComplex`](#fhircomplex); \} \| \{ `status`: `"unresolved"`; \} \| \{ `status`: `"external"`; \}

The outcome of resolving a single reference against a closure.

#### Union Members

##### Type Literal

\{ `status`: `"resolved"`; `target`: [`FhirComplex`](#fhircomplex); \}

The reference named a resource in the closure.

***

##### Type Literal

\{ `status`: `"unresolved"`; \}

A local reference (fragment, or relative within a Bundle) that named nothing in the closure.

***

##### Type Literal

\{ `status`: `"external"`; \}

A reference to somewhere outside the closure (an absolute/logical target not in the Bundle).

***

### SchemaRegistry

> **SchemaRegistry** = (`resourceType`) => [`ResourceSchema`](#resourceschema) \| `undefined`

A resolver from a resource type name to its [ResourceSchema](#resourceschema) (base elements merged in), or
`undefined` when the type is not modeled. Built by [buildRegistry](#buildregistry).

#### Parameters

##### resourceType

`string`

#### Returns

[`ResourceSchema`](#resourceschema) \| `undefined`

***

### SerializeErrorCode

> **SerializeErrorCode** = *typeof* [`SERIALIZE_ERROR_CODES`](#serialize_error_codes)\[keyof *typeof* [`SERIALIZE_ERROR_CODES`](#serialize_error_codes)\]

Discriminant union of every [SERIALIZE\_ERROR\_CODES](#serialize_error_codes) value.

***

### SlicingRules

> **SlicingRules** = `"closed"` \| `"open"` \| `"openAtEnd"`

`ElementDefinition.slicing.rules`, whether content outside the named slices is allowed.

***

### TokenType

> **TokenType** = `"string"` \| `"number"` \| `"identifier"` \| `"envvar"` \| `"special"` \| `"symbol"`

The kind of a lexed [Token](#token).

***

### UcumShapeVerdict

> **UcumShapeVerdict** = `"ok"` \| `"invalid"`

The verdict of a UCUM shape check: a well-formed UCUM expression, or a malformed one.

***

### ValidationCode

> **ValidationCode** = *typeof* [`VALIDATION_CODES`](#validation_codes)\[keyof *typeof* [`VALIDATION_CODES`](#validation_codes)\]

Discriminant union of every [VALIDATION\_CODES](#validation_codes) value.

***

### ValidationMode

> **ValidationMode** = `"lenient"` \| `"strict"`

How strictly to read: `"lenient"` (warn + preserve unknowns) or `"strict"` (unknowns error).

***

### ValidationSeverity

> **ValidationSeverity** = *typeof* [`ISSUE_SEVERITIES`](#issue_severities)\[keyof *typeof* [`ISSUE_SEVERITIES`](#issue_severities)\]

One of the four R4 [ISSUE\_SEVERITIES](#issue_severities).

***

### XmlFatalCode

> **XmlFatalCode** = *typeof* [`XML_FATAL_CODES`](#xml_fatal_codes)\[keyof *typeof* [`XML_FATAL_CODES`](#xml_fatal_codes)\]

Discriminant union of every [XML\_FATAL\_CODES](#xml_fatal_codes) value.

***

### XmlNode

> **XmlNode** = [`XmlElement`](#xmlelement) \| [`XmlText`](#xmltext)

Any node in the raw XML tree.

## Variables

### ABSENCE\_CODES

> `const` **ABSENCE\_CODES**: readonly \[`"unknown"`, `"asked-unknown"`, `"temp-unknown"`, `"not-asked"`, `"asked-declined"`, `"masked"`, `"not-applicable"`, `"unsupported"`, `"as-text"`, `"error"`, `"not-a-number"`, `"negative-infinity"`, `"positive-infinity"`, `"not-performed"`, `"not-permitted"`\]

The complete DataAbsentReason value set: fifteen concepts, transcribed from the published R4
expansion in the order it lists them, all drawn from one code system. The extension's `value[x]`
binds to this value set at **required** strength, so the set is closed: a `valueCode` outside it
is a binding violation, not a local extension of the vocabulary.

It is enumerated here for the same reason the required `code` bindings the validator enforces are
enumerated in its own source: membership in a closed, published, required-strength set is decided
from the set itself, and no terminology service, value-set expansion or vendored terminology
resource is involved. This is the whole of the terminology content this channel needs.

#### Example

```ts
import { ABSENCE_CODES } from "@cosyte/fhir";
ABSENCE_CODES.length;         // 15
ABSENCE_CODES.includes("masked"); // true
```

***

### ALLERGY\_CLINICAL\_SYSTEM

> `const` **ALLERGY\_CLINICAL\_SYSTEM**: `"http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical"` = `"http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical"`

AllergyIntolerance `clinicalStatus` code system (`allergyintolerance.html`).

***

### ALLERGY\_SUBSTANCE\_VALUESET

> `const` **ALLERGY\_SUBSTANCE\_VALUESET**: `"http://cts.nlm.nih.gov/fhir/ValueSet/2.16.840.1.113762.1.4.1186.8"` = `"http://cts.nlm.nih.gov/fhir/ValueSet/2.16.840.1.113762.1.4.1186.8"`

US Core AllergyIntolerance substance value set, VSAC `2.16.840.1.113762.1.4.1186.8`, an
**extensible** binding drawing from **RxNorm** (drug) **+ SNOMED CT** (food/environmental and the
"no known allergy" negation concepts). The multi-system composition means
the validator must accept *both* systems on this one element. *(US Core AllergyIntolerance)*

***

### ALLERGY\_VERIFICATION\_SYSTEM

> `const` **ALLERGY\_VERIFICATION\_SYSTEM**: `"http://terminology.hl7.org/CodeSystem/allergyintolerance-verification"` = `"http://terminology.hl7.org/CodeSystem/allergyintolerance-verification"`

AllergyIntolerance `verificationStatus` code system, the system ait-1/ait-2 pin.

***

### BINDING\_STRENGTHS

> `const` **BINDING\_STRENGTHS**: readonly [`BindingStrength`](#bindingstrength)[]

The set of [BindingStrength](#bindingstrength) values, for validation/iteration.

***

### BUNDLE\_TYPES

> `const` **BUNDLE\_TYPES**: `object`

The R4 `Bundle.type` value set (`valueset-bundle-type`), in full. The seven headline types
plus the two server-reply variants a real feed carries, so an incoming `transaction-response` /
`batch-response` classifies rather than falling through. Frozen via `as const`.

#### Type Declaration

##### BATCH

> `readonly` **BATCH**: `"batch"` = `"batch"`

A set of actions applied **independently**, one failing does not roll back the rest.

##### BATCH\_RESPONSE

> `readonly` **BATCH\_RESPONSE**: `"batch-response"` = `"batch-response"`

The server's reply to a `batch`.

##### COLLECTION

> `readonly` **COLLECTION**: `"collection"` = `"collection"`

An arbitrary collection with no processing semantics.

##### DOCUMENT

> `readonly` **DOCUMENT**: `"document"` = `"document"`

A fully-formed clinical document (first entry is a `Composition`).

##### HISTORY

> `readonly` **HISTORY**: `"history"` = `"history"`

A list of prior versions of one or more resources.

##### MESSAGE

> `readonly` **MESSAGE**: `"message"` = `"message"`

A message (first entry is a `MessageHeader`).

##### SEARCHSET

> `readonly` **SEARCHSET**: `"searchset"` = `"searchset"`

The result set of a search.

##### TRANSACTION

> `readonly` **TRANSACTION**: `"transaction"` = `"transaction"`

A set of actions applied **atomically**, all-or-nothing.

##### TRANSACTION\_RESPONSE

> `readonly` **TRANSACTION\_RESPONSE**: `"transaction-response"` = `"transaction-response"`

The server's reply to a `transaction`.

***

### CODE\_SYSTEM\_VERSION\_RECORD\_CODES

> `const` **CODE\_SYSTEM\_VERSION\_RECORD\_CODES**: `object`

The two-concept vocabulary that says **whether** a membership answer declared the code-system
release it was made against. Frozen via `as const`; the set is snapshotted (see
`test/validation-codes.test.ts`) because it is a public wire identity.

The concept is deliberately separate from the release string itself: the marker rides on
`issue.details.coding[0].code` and the declared release rides on `issue.details.text`, so no
release a service could declare (`"undeclared"` included) can ever be mistaken for the marker.

#### Type Declaration

##### DECLARED

> `readonly` **DECLARED**: `"declared"` = `"declared"`

The service declared a release; the string it declared travels beside this marker.

##### UNDECLARED

> `readonly` **UNDECLARED**: `"undeclared"` = `"undeclared"`

The service was consulted, answered definitively, and declared **no** release. It is an
applicable, unanswered question, **not** "current" and not "not applicable": the marker is
emitted precisely so the silence cannot be read as currency.

***

### CODE\_SYSTEM\_VERSION\_RECORD\_SYSTEM

> `const` **CODE\_SYSTEM\_VERSION\_RECORD\_SYSTEM**: `"https://cosyte.com/fhir/CodeSystem/code-system-version-record"` = `"https://cosyte.com/fhir/CodeSystem/code-system-version-record"`

The canonical identity of the library's own code system for the **code-system release record**
carried by a membership finding. It names the two-concept vocabulary in
[CODE\_SYSTEM\_VERSION\_RECORD\_CODES](#code_system_version_record_codes) and nothing else, and it reaches an `OperationOutcome` as
`issue.details.coding[0].system`.

It is **this library's** canonical, not a third-party terminology identity: the known-systems
registry (../terminology/systems.js) stays a frozen set of verified external URIs and
gains nothing here. Renaming this is a breaking change.

***

### CONDITION\_CATEGORY\_SYSTEM

> `const` **CONDITION\_CATEGORY\_SYSTEM**: `"http://terminology.hl7.org/CodeSystem/condition-category"` = `"http://terminology.hl7.org/CodeSystem/condition-category"`

Condition `category` code system carrying `problem-list-item` (the con-3 trigger).

***

### CONDITION\_CLINICAL\_SYSTEM

> `const` **CONDITION\_CLINICAL\_SYSTEM**: `"http://terminology.hl7.org/CodeSystem/condition-clinical"` = `"http://terminology.hl7.org/CodeSystem/condition-clinical"`

Condition `clinicalStatus` code system (`condition.html`), the system con-4 pins.

***

### CONDITION\_VERIFICATION\_SYSTEM

> `const` **CONDITION\_VERIFICATION\_SYSTEM**: `"http://terminology.hl7.org/CodeSystem/condition-ver-status"` = `"http://terminology.hl7.org/CodeSystem/condition-ver-status"`

Condition `verificationStatus` code system, the system con-3/con-5 pin.

***

### CPT\_SYSTEM

> `const` **CPT\_SYSTEM**: `"http://www.ama-assn.org/go/cpt"` = `"http://www.ama-assn.org/go/cpt"`

CPT `system` URI, AMA, procedures/billing. **License-restricted**: identity only, no content.

***

### CVX\_SYSTEM

> `const` **CVX\_SYSTEM**: `"http://hl7.org/fhir/sid/cvx"` = `"http://hl7.org/fhir/sid/cvx"`

CVX `system` URI, CDC NCIRD, vaccines.

***

### DATA\_ABSENT\_REASON\_URL

> `const` **DATA\_ABSENT\_REASON\_URL**: `"http://hl7.org/fhir/StructureDefinition/data-absent-reason"` = `"http://hl7.org/fhir/StructureDefinition/data-absent-reason"`

The canonical URL of the R4 DataAbsentReason extension, fixed by its own definition as
`Extension.url`. An extension is an absence marker when its `url` is this string and never when
it merely resembles it: the code system URI that names the same concepts is a **different** URI
and is not matched.

#### Example

```ts
import { DATA_ABSENT_REASON_URL } from "@cosyte/fhir";
DATA_ABSENT_REASON_URL; // "http://hl7.org/fhir/StructureDefinition/data-absent-reason"
```

***

### DISCRIMINATOR\_TYPES

> `const` **DISCRIMINATOR\_TYPES**: readonly [`DiscriminatorType`](#discriminatortype-1)[]

The R4 discriminator types, for iteration / validation.

***

### ENTERED\_IN\_ERROR

> `const` **ENTERED\_IN\_ERROR**: `"entered-in-error"` = `"entered-in-error"`

The `entered-in-error` code, the universal "this record is retracted, not data" value.

***

### FATAL\_CODES

> `const` **FATAL\_CODES**: `object`

Stable string codes for the reader's unrecoverable fatals. Everything less severe is a recoverable
[FhirIssue](#fhirissue).

#### Type Declaration

##### MALFORMED\_JSON

> `readonly` **MALFORMED\_JSON**: `"MALFORMED_JSON"` = `"MALFORMED_JSON"`

The input is not well-formed JSON.

##### MAX\_DEPTH\_EXCEEDED

> `readonly` **MAX\_DEPTH\_EXCEEDED**: `"MAX_DEPTH_EXCEEDED"` = `"MAX_DEPTH_EXCEEDED"`

JSON nested deeper than the reader's fixed bound. Well-formed but pathological input (a tower of
`[[[[…]]]]` / `{"a":{"a":…}}`) is refused as a **DoS guard**, turning what would otherwise be a
V8 stack overflow (`RangeError`, environment-dependent, untyped) into a typed, value-free fatal
carrying an `offset`. Mirrors the XML reader's `MAX_DEPTH_EXCEEDED` (fuzzing: deep
nesting must never crash/hang/OOM, always a typed error or a bounded rejection).

##### PRIMITIVE\_EXTENSION\_MISALIGNED

> `readonly` **PRIMITIVE\_EXTENSION\_MISALIGNED**: `"PRIMITIVE_EXTENSION_MISALIGNED"` = `"PRIMITIVE_EXTENSION_MISALIGNED"`

A primitive value array and its `_`-sibling array have different lengths, so the null-padded
index alignment is broken and the reader cannot know which value each extension belongs to
(cf. HAPI #5738). Fails closed, see the module doc.

***

### FHIR\_XML\_NAMESPACE

> `const` **FHIR\_XML\_NAMESPACE**: `"http://hl7.org/fhir"` = `"http://hl7.org/fhir"`

The FHIR XML namespace; the default namespace of every FHIR resource element.

***

### ICD10CM\_SYSTEM

> `const` **ICD10CM\_SYSTEM**: `"http://hl7.org/fhir/sid/icd-10-cm"` = `"http://hl7.org/fhir/sid/icd-10-cm"`

ICD-10-CM `system` URI, NCHS/CMS, encounter diagnosis / billing.

***

### ICD9CM\_SYSTEM

> `const` **ICD9CM\_SYSTEM**: `"http://hl7.org/fhir/sid/icd-9-cm"` = `"http://hl7.org/fhir/sid/icd-9-cm"`

ICD-9-CM `system` URI, legacy, crosswalk only.

***

### ISSUE\_CODES

> `const` **ISSUE\_CODES**: `object`

Stable string codes for every warning the JSON reader may emit. Frozen via `as const` so the
`IssueCode` union is exact and a comparison is typo-checked. Renaming a code is a breaking change.

#### Type Declaration

##### DECIMAL\_PRECISION\_AT\_RISK

> `readonly` **DECIMAL\_PRECISION\_AT\_RISK**: `"DECIMAL_PRECISION_AT_RISK"` = `"DECIMAL_PRECISION_AT_RISK"`

A numeric primitive whose exact value would have been corrupted by routing it through a
JavaScript `number`, trailing-zero precision, more than ~15 significant digits, or magnitude
past the safe-integer range. Informational: the reader preserved it losslessly; this flags that
the protection mattered here.

##### DUPLICATE\_PROPERTY

> `readonly` **DUPLICATE\_PROPERTY**: `"DUPLICATE_PROPERTY"` = `"DUPLICATE_PROPERTY"`

A JSON object repeated a property name. FHIR JSON requires unique property names (json.html §2.6.2:
"Property names SHALL be unique") and expresses repetition with an array, so a repeated name is
a document defect with no defined winner: RFC 8259 §4 says "the behavior of software that
receives such an object is unpredictable". The reader keeps the first value in the node's
`properties`, keeps the rest in its `duplicates` (nothing is discarded), and raises this. Warning
severity: the data survived, but any single-value read of that element is now arbitrary.

##### MISPLACED\_PRIMITIVE\_EXTENSION

> `readonly` **MISPLACED\_PRIMITIVE\_EXTENSION**: `"MISPLACED_PRIMITIVE_EXTENSION"` = `"MISPLACED_PRIMITIVE_EXTENSION"`

A `_`-sibling appeared beside an element that is **not** a primitive. FHIR JSON defines the
`_`-prefixed property as the carrier for a *primitive* element's `id` and `extension`
(json.html §2.6.2.3); a complex element carries both inline, and a complex array's members carry
their own, so there is no position for a `_`-sibling on either and no defined meaning for one.

The reader does not model what was inside it, so (as with [ISSUE\_CODES.NESTED\_ARRAY](#nested_array))
**content the sender wrote is not readable** at this location. That is why it is its own code
rather than an [ISSUE\_CODES.UNKNOWN\_PROPERTY](#unknown_property), whose contract is that nothing was lost.

The location names the **element**, not the `_`-prefixed member: FHIRPath addresses elements,
and `_name` is not an element. It is raised once per misplaced sibling.

##### MIXED\_XML\_SPELLING

> `readonly` **MIXED\_XML\_SPELLING**: `"MIXED_XML_SPELLING"` = `"MIXED_XML_SPELLING"`

One modeled XML element's occurrences did **not all arrive under the same expanded name**: the
namespace and the tag together (Namespaces in XML 1.0 §6.1), not the tag alone. Either half can
differ, and the two halves are different situations.

- **The tag differs, the namespace does not.** `<f:status/>` beside `<status/>` is one element
  written two ways. Nothing is lost and the reading is the correct one: the occurrences are
  modeled as repeats of a single element, exactly as the same document spelled one way would be.
- **The namespace differs, the tag does not.** Two elements that are not the same element at all
  reach one model name under one tag. **This is not a closed list of routes and no sentence here
  or anywhere else may make it one**: the rule is simply that the group's occurrences did not all
  carry one expanded name. Two worth naming, because they are the ones that read as conformant:
  a prefix **rebound between siblings** (`<p:x xmlns:p="urn:a"/>` beside `<p:x xmlns:p="urn:b"/>`,
  where the model name of each is that verbatim tag), and a **`<div/>` in the FHIR namespace
  beside the narrative**, because the narrative is modeled as `div` under every spelling of the
  XHTML namespace. The second is the costlier: `Narrative.div` is `0..1`, so the merge turns the
  narrative into a repeat over an otherwise conformant document. A **foreign** element reached by
  a **default** `xmlns` re-declaration also keeps its tag verbatim as its model name, so it groups
  with its FHIR namesake the same way; there the group additionally carries
  [ISSUE\_CODES.UNEXPECTED\_XML\_CONTENT](#unexpected_xml_content), which is the code to read for it. Whether a group
  carries that flag as well is decided by whether each occurrence is foreign **to its own
  parent**, so an element in the parent's namespace does not draw it: inside a FHIR-namespace
  `<text>`, a `<div xmlns="http://hl7.org/fhir"/>` beside the real XHTML narrative draws this
  code and no other, which makes this the only report there is to read for it.

It also fires where a prefixed FHIR element groups with an unprefixed one carrying a **foreign**
default declaration, because that one is spelled exactly like the FHIR element; there the group
additionally carries [ISSUE\_CODES.UNEXPECTED\_XML\_CONTENT](#unexpected_xml_content) at the foreign occurrence, and
this code is not the one to read for that. In every case this is raised because
the *count* is what changes. An element a consumer expects at most once now presents as a
repeat, and a single-value read of a repeated element yields nothing rather than a value, so a
check written against `0..1` can skip an element it would otherwise have inspected. Warning
severity: it tells a consumer that the number of occurrences here came from the spelling, not
just from the content.

The location names the element, once per element, not once per occurrence.

##### NESTED\_ARRAY

> `readonly` **NESTED\_ARRAY**: `"NESTED_ARRAY"` = `"NESTED_ARRAY"`

A JSON array appeared **inside another array**. FHIR JSON uses an array for one thing only, a
repeating element (json.html §2.6.2.2), so no element is ever a list of lists and this shape has
no meaning at any position. The reader does not model what was inside, so unlike every other
warning here **content the sender wrote is not readable** at this location. That is why it has
its own code: an unexpected-property warning says a shape was tolerated, this one says something
was there and could not be read, which is what must stop a downstream safety verdict from being
affirmed over it. Raised in addition to any other warning the position already drew, never
instead of one.

##### UNDEFINED\_JSON\_NULL

> `readonly` **UNDEFINED\_JSON\_NULL**: `"UNDEFINED_JSON_NULL"` = `"UNDEFINED_JSON_NULL"`

A JSON `null` sat at a position FHIR JSON does not define one.

FHIR JSON forbids `null` and carves out one exception. json.html §2.6.2.1: "properties never have
null values (except for a special case documented below)". The exception is §2.6.2.3, and it is
about a **repeating** primitive: "In the case where the primitive element may repeat, it is
represented in two arrays. JSON null values are used to fill out both arrays so that the id
and/or extension are aligned with the matching value in the first array."

So this is raised for a `null` that is **not** that. Two conditions, both required for the
exception to apply: the `null` sat **inside a repeating primitive's value array**, and the slot
it produced **carries an `id` or a non-empty `extension`** for it to align with. A `null` failing
either leaves an element with neither a value nor children, which R4 `ele-1` requires one of.
A padding `null` in a conformant document never draws it.

**A singleton slot is never padding, whatever sits beside it.** §2.6.2.3 states the singleton
encoding positively: "If the primitive has an id attribute or extension, but no value, only the
property with the `_` is rendered." So a value-absent singleton is `{"_status":{…}}`, and both
`{"status":null}` and `{"status":null,"_status":{…}}` draw this.

**The set this walks is what the reader read as a primitive, not what FHIR types as one.** The
model is schema-free, so a bare `null` at any **singleton** property reaches the primitive branch
whatever that element's FHIR type would be: `{"subject":null}` on an `Observation` draws this
code, even though `Observation.subject` is a `Reference`. Only an **array item** and a
`_`-sibling's `extension` item reach the complex branch (see below).

**Unlike [ISSUE\_CODES.NESTED\_ARRAY](#nested_array), this does not say content was unreadable.** A `null`
carries nothing, so nothing was lost; the element really is value-absent. What it says is that
the document encoded that absence in a way FHIR JSON does not define, which matters because the
absence is otherwise indistinguishable from an element the sender legitimately omitted, and a
`Quantity` that arrives as `{"value":null,"unit":"mg"}` would then read back as a conformant
quantity with a unit and no magnitude. `serializeResource` writes the `null` back for exactly
that reason, so the finding survives a round trip rather than being laundered away. Warning
severity.

**The neighbouring position has its own code and is not this one.** A `null` the reader takes to
the complex branch preserves its text (../model/node.js `nonObjectSource`) and raises
[ISSUE\_CODES.UNKNOWN\_PROPERTY](#unknown_property) instead; that behaviour is unchanged and no case moved onto
this code. **The predicate, rather than a list of the documents that satisfy it:** a `null`
reaches the complex branch when it is an item of an array the reader read as a *complex* array
(its first non-`null` item is not a scalar, so an object **or** an inner array puts it there), or
an item of a `_`-sibling's `extension` array. A `_`-sibling that is itself not an object
(`"_status":null`) is a third position, and it draws [ISSUE\_CODES.UNKNOWN\_PROPERTY](#unknown_property) too:
FHIR JSON has an `Element` object in that channel, so a `null` there is the scalar-where-an-object
-belongs observation rather than this one. **No case has ever moved between the two codes**; that
channel drew nothing at all until it was closed, so a predicate written against either is
unchanged by it.

##### UNEXPECTED\_XML\_CONTENT

> `readonly` **UNEXPECTED\_XML\_CONTENT**: `"UNEXPECTED_XML_CONTENT"` = `"UNEXPECTED_XML_CONTENT"`

The XML reader met content at this position that does not belong to the vocabulary it expected,
or that it cannot map to the model. Warning severity: the document is not rejected.

**It reports two different observations, and only one of them preserves anything.**

- **An element from another vocabulary** (a namespace other than its parent's, or a root
  declaring a namespace other than FHIR's). The element **is** modeled; this says the document
  left the vocabulary here.
- **Non-whitespace character data directly on an element.** A FHIR element carries its value in
  the `value` attribute (xml.html), not as text, so there is no slot on the model for it and
  the text is **dropped**. That is true at every site this fires for text: on a complex element,
  on a primitive (`<status>entered-in-error</status>` loses the status), and beside the one
  resource child of a resource-valued element (`<contained>…<Patient/></contained>`). The
  guarantee on offer is that the drop is not silent, and nothing more.

The narrative `<div>` is the one element whose text is expected, and it is carried whole rather
than reported here. **Do not write a claim that this code means the content survived.**

**More than one of the observations above can be true at one position, and this code does NOT
promise one report per location.** Exactly one site takes care not to be the second: the text
report beside the one resource child of a resource-valued element, which is the site added last
and the only one that checks. Everywhere else, an element that is both in another vocabulary and
carrying character data draws the code twice at one expression. That is the behaviour on every
release that has had this code, and a consumer keying on `code` + `expression` should treat it
as a set.

##### UNKNOWN\_PROPERTY

> `readonly` **UNKNOWN\_PROPERTY**: `"UNKNOWN_PROPERTY"` = `"UNKNOWN_PROPERTY"`

A property the reader did not expect at this position and preserved verbatim (Postel's Law,
lenient read). Warning severity: nothing was lost, but a consumer may want to know.

**Two JSON positions raise it for the same observation, and both preserve the text so that
re-reading the writer's output raises it again.** FHIR JSON has an object at each of them
(json.html §2.6.2), and what arrived was a string, a number, a boolean or a `null`: a **complex**
element's own position (the text goes to ../model/node.js `nonObjectSource`), and a
primitive's **`_`-sibling**, the channel §2.6.2.3 gives the `id` and/or `extension`
(`nonObjectMetaSource`). Neither is modeled as FHIR, at either position, so no walker sees a new
element. **A `null` padding a repeating primitive's `_`-array is the one exception §2.6.2.3
defines and never draws this.**

#### Example

```ts
import { parseResource, ISSUE_CODES } from "@cosyte/fhir";
const { issues } = parseResource(json);
if (issues.some((i) => i.code === ISSUE_CODES.DECIMAL_PRECISION_AT_RISK)) {
  // a value here would have been corrupted by a naive JSON.parse, we preserved it
}
```

***

### ISSUE\_SEVERITIES

> `const` **ISSUE\_SEVERITIES**: `object`

The R4 issue-severity value set (`valueset-issue-severity`), in full. R4 does **not** include the
R5 `success` value, the "all clear" case is expressed as `information` +
[ISSUE\_TYPES.INFORMATIONAL](#informational), not a `success` severity.

#### Type Declaration

##### ERROR

> `readonly` **ERROR**: `"error"` = `"error"`

##### FATAL

> `readonly` **FATAL**: `"fatal"` = `"fatal"`

##### INFORMATION

> `readonly` **INFORMATION**: `"information"` = `"information"`

##### WARNING

> `readonly` **WARNING**: `"warning"` = `"warning"`

***

### ISSUE\_TYPES

> `const` **ISSUE\_TYPES**: `object`

The subset of the R4 `IssueType` value set (`valueset-issue-type`) that the layers emit.
These are the wire `OperationOutcome.issue.code` values; the richer sub-code tree (terminology,
invariant, profile) arrives with the layers that emit it. Renaming one is a breaking change.

#### Type Declaration

##### BUSINESS\_RULE

> `readonly` **BUSINESS\_RULE**: `"business-rule"` = `"business-rule"`

A business rule / profile-level assertion failed (e.g. a declared profile version is unknown).

##### CODE\_INVALID

> `readonly` **CODE\_INVALID**: `"code-invalid"` = `"code-invalid"`

A code is not a member of a required-strength value set binding.

##### INFORMATIONAL

> `readonly` **INFORMATIONAL**: `"informational"` = `"informational"`

Informational only, carries no defect (e.g. "this resource type has no schema yet").

##### INVARIANT

> `readonly` **INVARIANT**: `"invariant"` = `"invariant"`

A content-validation rule (a resource `constraint` / invariant) failed.

##### NOT\_FOUND

> `readonly` **NOT\_FOUND**: `"not-found"` = `"not-found"`

A referenced resource could not be found within the resolution closure (a Bundle reference).

##### NOT\_SUPPORTED

> `readonly` **NOT\_SUPPORTED**: `"not-supported"` = `"not-supported"`

The content uses a modifier the processor does not support and cannot safely ignore.

##### REQUIRED

> `readonly` **REQUIRED**: `"required"` = `"required"`

A required element (min cardinality ≥ 1) is missing.

##### STRUCTURE

> `readonly` **STRUCTURE**: `"structure"` = `"structure"`

Structural issue, an element that is not allowed here, or a cardinality-max violation.

##### VALUE

> `readonly` **VALUE**: `"value"` = `"value"`

An element value is invalid against its datatype value-domain (a primitive-regex failure).

***

### KNOWN\_MODIFIER\_EXTENSION\_URLS

> `const` **KNOWN\_MODIFIER\_EXTENSION\_URLS**: `ReadonlySet`\<`string`\>

The `modifierExtension` URLs this library understands. It is **empty**: no standard
`modifierExtension` is handled yet, so *every* `modifierExtension` an instance carries is unknown
and the validator fails closed on it (../validate/safety.js). The set exists as the seam a
change widens deliberately, a URL is added here only alongside code that actually honors that
modifier's meaning. Widening it silently would re-introduce the exact hazard the FHIR `?!` rule
exists to prevent.

***

### KNOWN\_SYSTEMS

> `const` **KNOWN\_SYSTEMS**: `ReadonlyMap`\<`string`, `string`\>

The frozen known-systems registry: each recognized code-`system` URI mapped to its short steward
name. This is a **closed set of identities** (like the status codes and the
vital-signs table), not a licensed terminology table, it says *which* system a URI names, never
*what codes* it contains. A URI absent from this map is "unknown": the validator cannot reason
about its codes, and degrades to a non-erroring informational note rather than a false rejection
(fail-safe). It is the seam a later change widens as verified URIs are confirmed
(ICD-10-PCS / HCPCS remain open).

***

### LOINC\_SYSTEM

> `const` **LOINC\_SYSTEM**: `"http://loinc.org"` = `"http://loinc.org"`

The LOINC `system` URI, the coding system the vital-signs profile keys its required units on.

***

### MAX\_REFERENCE\_DEPTH

> `const` **MAX\_REFERENCE\_DEPTH**: `512` = `512`

A hard cap on the depth-first frontier the cycle guard will hold at once. A `contained` fragment
graph deeper than this is treated as pathological (reported as a cycle) rather than walked, a
belt-and-suspenders bound on memory on top of the three-color visited marking that already
guarantees termination.

***

### MEDICATION\_VALUESET

> `const` **MEDICATION\_VALUESET**: `"http://cts.nlm.nih.gov/fhir/ValueSet/2.16.840.1.113762.1.4.1010.4"` = `"http://cts.nlm.nih.gov/fhir/ValueSet/2.16.840.1.113762.1.4.1010.4"`

US Core medication value set, VSAC `2.16.840.1.113762.1.4.1010.4`, an **extensible** binding to
**RxNorm**. Bound on `MedicationRequest`/`MedicationStatement` `medicationCodeableConcept`.
*(US Core MedicationRequest)*

***

### MODIFIER\_ELEMENT\_ROOT\_TYPES

> `const` **MODIFIER\_ELEMENT\_ROOT\_TYPES**: `ReadonlySet`\<`string`\>

The resource type names that may root a modifier-element location, which is every resource type
name THIS LIBRARY spells in its own source, and no other.

Named concretely rather than left to "known or modeled", because two candidate sets exist here
with different memberships and the choice decides what a location reads:

- the seven `SAFETY_RESOURCE_TYPES` (./codes.js), the types whose type-scoped safety
  elements this library surfaces, `Immunization` and `MedicationRequest` among them;
- `Patient`, the one type the validator carries a built-in element table for, and one of the
  types this module's own predicate gates on;
- `Practitioner`, another type this module's predicate gates on;
- `Bundle`, which the validator branches on by name when it checks entries.

The surfaced `MedicationRequest.intent` locations ([IntentReport](#intentreport)) and the unreadable ones
are rooted by the same rule, since they are read by this module at the same window, and so are the
surfaced and the unreadable `use` locations on the four datatypes ([DatatypeUseReport](#datatypeusereport)).

The set is the union, and it is derived from source constants only. **It is never derived from
the input**: a type name is a member because this package wrote it down, not because a document
looked plausible. That is the whole property, and a "shaped like a resource type" test would
defeat it, since a forged name can match a shape.

#### Example

```ts
import { MODIFIER_ELEMENT_ROOT_TYPES } from "@cosyte/fhir";
MODIFIER_ELEMENT_ROOT_TYPES.has("MedicationRequest"); // true
MODIFIER_ELEMENT_ROOT_TYPES.has("Foo");               // false, such a location roots at "<withheld>"
```

***

### NDC\_SYSTEM

> `const` **NDC\_SYSTEM**: `"http://hl7.org/fhir/sid/ndc"` = `"http://hl7.org/fhir/sid/ndc"`

NDC `system` URI, FDA, drug product/package.

***

### NDJSON\_ERROR\_CODES

> `const` **NDJSON\_ERROR\_CODES**: `object`

Stable, value-free codes for a per-line NDJSON failure.

#### Type Declaration

##### LINE\_TOO\_LONG

> `readonly` **LINE\_TOO\_LONG**: `"LINE_TOO_LONG"` = `"LINE_TOO_LONG"`

The line exceeded [NdjsonOptions.maxLineBytes](#maxlinebytes) with no newline, cut off, not buffered.

##### MALFORMED\_JSON

> `readonly` **MALFORMED\_JSON**: `"MALFORMED_JSON"` = `"MALFORMED_JSON"`

The line is not well-formed JSON.

##### NOT\_A\_RESOURCE

> `readonly` **NOT\_A\_RESOURCE**: `"NOT_A_RESOURCE"` = `"NOT_A_RESOURCE"`

The line is valid JSON but not a resource (not a JSON object at the top level).

***

### NO\_KNOWN\_ALLERGY

> `const` **NO\_KNOWN\_ALLERGY**: `"716186003"` = `"716186003"`

SNOMED CT `716186003` "No known allergy", a **positive** record that the patient has no known
allergy. This is a first-class negation: it is *not* an absent AllergyIntolerance
(absence = *unknown*), and it must *not* be read as an allergy to code `716186003`. Other
"no known X allergy" substance-specific concepts (drug/food/environmental) are recognized by the
same mechanism when terminology work lands; only this concept is encoded here.

***

### NOT\_DONE

> `const` **NOT\_DONE**: `"not-done"` = `"not-done"`

The `not-done` status code, a negation: the event did not happen. R4 spells it **only** as a
`status` value and defines it in the `event-status` and `medication-admin-status` code systems,
which define it as "terminated prior to any activity beyond preparation" and "terminated prior to
any impact on the subject". The R4 resources whose `status` binds a value set containing it are
`Procedure`, `Communication`, `Media`, `MedicationAdministration` and `Immunization`. Read off
`status` on any resource type, for the reasons on statusSpells.

***

### NOT\_TAKEN

> `const` **NOT\_TAKEN**: `"not-taken"` = `"not-taken"`

The `not-taken` status code, a negation: "the medication was not consumed by the patient". R4
spells it **only** as a `status` value and defines it in **only** the `MedicationStatement.status`
code system (`medication-statement-status`), where that sentence is the code's own definition. Read
off `status` on any resource type, for the reasons on statusSpells.

***

### OBSERVATION\_CATEGORY\_SYSTEM

> `const` **OBSERVATION\_CATEGORY\_SYSTEM**: `"http://terminology.hl7.org/CodeSystem/observation-category"` = `"http://terminology.hl7.org/CodeSystem/observation-category"`

The `Observation.category` code system that carries the `vital-signs` slice value.

***

### OBSERVATION\_VALUE\_TYPES

> `const` **OBSERVATION\_VALUE\_TYPES**: readonly \[`"Quantity"`, `"CodeableConcept"`, `"String"`, `"Boolean"`, `"Integer"`, `"Range"`, `"Ratio"`, `"SampledData"`, `"Time"`, `"DateTime"`, `"Period"`\]

The eleven `Observation.value[x]` variant type suffixes, in FHIR's declared order. A variant's JSON
property name is `"value" + <suffix>` (e.g. `"Quantity"` → `valueQuantity`, `"String"` →
`valueString`). This is the exact choice set from `observation.html`; a rename would be breaking.

***

### PATIENT\_IDENTIFIER\_STARTER

> `const` **PATIENT\_IDENTIFIER\_STARTER**: [`StructureDefinition`](#structuredefinition)

A **`Patient` identifier** starter, grounded in US Core Patient. It marks
`identifier`, `identifier.system`, and `identifier.value` required + must-support, a patient
identity is the `(system, value)` tuple. It deliberately does **not** slice an "MRN" slice and does
**not** bind `identifier.type`: US Core does neither, and inventing an MRN slice is exactly the
wrong-patient-merge hazard.

***

### PRIMITIVE\_TYPES

> `const` **PRIMITIVE\_TYPES**: readonly \[`"boolean"`, `"integer"`, `"integer64"`, `"unsignedInt"`, `"positiveInt"`, `"decimal"`, `"string"`, `"code"`, `"markdown"`, `"id"`, `"uri"`, `"url"`, `"canonical"`, `"oid"`, `"uuid"`, `"base64Binary"`, `"instant"`, `"date"`, `"dateTime"`, `"time"`\]

The FHIR R4 primitive datatype names. `code`, `id`, `markdown`, `url`, `canonical`, `oid`, `uuid`
are string-derived types with their own patterns; the JSON-number family (`integer` …) is stored
as ../model/decimal.js. Frozen so the union is exact.

***

### REFUTED

> `const` **REFUTED**: `"refuted"` = `"refuted"`

`refuted`, an AllergyIntolerance/Condition asserted to be *not* present after investigation.

***

### RXNORM\_SYSTEM

> `const` **RXNORM\_SYSTEM**: `"http://www.nlm.nih.gov/research/umls/rxnorm"` = `"http://www.nlm.nih.gov/research/umls/rxnorm"`

RxNorm `system` URI, NLM, medications.

***

### SAFETY\_RESOURCE\_TYPES

> `const` **SAFETY\_RESOURCE\_TYPES**: `ReadonlySet`\<`string`\>

The resource types whose **type-scoped** modifier/status/negation elements this library surfaces
and whose invariants it enforces. `MedicationStatement` rides alongside `MedicationRequest`.
Count them off the set, never off a sentence: a written-down count here read "six" over a set of
seven for days, and reached `dist/` saying so.

Several reads are deliberately **not** scoped by it, because they can only add a finding: the
`modifierExtension` fail-closed check, the `entered-in-error` retraction, the `refuted`
verification status, the `doNotPerform` instruction, and the `not-done` / `not-taken` status
negations (statusSpells). `doNotPerform` used to be
gated on `MedicationRequest` alone, and `not-done` on `Immunization` alone; the types each gate
left out were neither read nor reported, so a conformant `ServiceRequest` carrying an instruction
*not* to perform the service, and a conformant `Procedure` recording that it was **not** done, both
read as carrying no negation at all. Those same reads run at **every resource root** the document
carries (./status.js `checkNegations`), not only the resource handed in.

***

### SERIALIZE\_ERROR\_CODES

> `const` **SERIALIZE\_ERROR\_CODES**: `object`

Every reason a writer refuses to serialize a model.

#### Type Declaration

##### DROPPED\_ELEMENT\_TEXT

> `readonly` **DROPPED\_ELEMENT\_TEXT**: `"DROPPED_ELEMENT_TEXT"` = `"DROPPED_ELEMENT_TEXT"`

The model carries character data the XML reader dropped, at one or more locations. There is no
conformant encoding of it in either wire format, and emitting the element as unfilled would
launder the `DROPPED_ELEMENT_TEXT` finding across a round trip.

##### UNSERIALIZABLE\_ARRAY\_WRAPPER

> `readonly` **UNSERIALIZABLE\_ARRAY\_WRAPPER**: `"UNSERIALIZABLE_ARRAY_WRAPPER"` = `"UNSERIALIZABLE_ARRAY_WRAPPER"`

The model carries, at a location this library already reports as an array-wrapped `0..1` safety
element, a wrapper FHIR XML has no repetition to spell back: one holding fewer than two items,
or any wrapper at all on `resourceType`. **XML only**: `serializeResource` writes the list back
and the re-read reports the same location, so that route stays open.

XML spells a repeat by repeating the element and has no other mark for one, so a wrapper of
fewer than two items emits at most one element and re-reads as an ordinary single-valued
element. The encoding complaint the reader raised is then gone, and with it an `error`-severity
`ARRAY_WRAPPED_SCALAR` and a `safeToSummarize: false`.

See assertXmlArrayWrapper for the exact predicate and for what it deliberately leaves.

##### UNSERIALIZABLE\_CHOICE\_WRAPPER

> `readonly` **UNSERIALIZABLE\_CHOICE\_WRAPPER**: `"UNSERIALIZABLE_CHOICE_WRAPPER"` = `"UNSERIALIZABLE_CHOICE_WRAPPER"`

The model carries, at a location this library already reports as an array-wrapped
`Observation.value[x]` choice, a wrapper FHIR XML has no repetition to spell back: one holding
fewer than two items. **XML only**: `serializeResource` writes the list back and the re-read
reports the same location, so that route stays open.

The same harm as [SERIALIZE\_ERROR\_CODES.UNSERIALIZABLE\_ARRAY\_WRAPPER](#unserializable_array_wrapper), at the position
where the number is a DOSE: `{"resourceType":"Observation","status":"final","valueQuantity":
[{"value":5,"system":"http://unitsofmeasure.org","code":"mg"}]}` reads with the encoding
reported and no magnitude handed out, and used to come back from XML as an unambiguous 5 mg
nothing had complained about.

See assertXmlValueChoiceWrapper for the window and for what it deliberately leaves.

##### UNSERIALIZABLE\_DIV\_MARKUP

> `readonly` **UNSERIALIZABLE\_DIV\_MARKUP**: `"UNSERIALIZABLE_DIV_MARKUP"` = `"UNSERIALIZABLE_DIV_MARKUP"`

A `div` property carries a string the XML writer would emit as raw markup, and that string does
not contribute exactly one element named `div` to the document. **XML only**: `serializeResource`
carries the string as a string, so this refusal never reaches it and that route stays open.

**That is a statement about the `div` string, not about the whole model.** `serializeResource`
has its own declared non-spec-clean exceptions, so a model refused here can still route through
it and emit one of those: `{"text":{"div":""},"name":[[{"family":"X"}]]}` is refused here and
`serializeResource` emits the array inside an array unchanged.

See `emitsOneDivElement` in `../xml/write.js` for the exact predicate and what it does not cover.

##### UNSERIALIZABLE\_DIV\_PREFIX

> `readonly` **UNSERIALIZABLE\_DIV\_PREFIX**: `"UNSERIALIZABLE_DIV_PREFIX"` = `"UNSERIALIZABLE_DIV_PREFIX"`

The model holds, at one or more `div` locations, a string the XML writer would splice in as raw
markup that spells the one `div` element the property names, and whose markup names a namespace
prefix, on an element or on an attribute, that no declaration inside the string binds. **XML
only**: `serializeResource` carries the string as a string, so this refusal never reaches it and
that route stays open.

Written anyway, `<v:div>x</v:div>` put a prefix nothing declared into the output, which a
conformant XML parser rejects, and this library's own re-read of that output turned the narrative
into a property named `v:div`: the narrative gone after one write and one read, with no
diagnostic at either end. **Not [SERIALIZE\_ERROR\_CODES.UNSERIALIZABLE\_PREFIXED\_NAME](#unserializable_prefixed_name)**,
whose published meaning is a name at a tag position, and **not
[SERIALIZE\_ERROR\_CODES.UNSERIALIZABLE\_DIV\_MARKUP](#unserializable_div_markup)**, whose question is which elements the
string contributes: a string that fails that question keeps that code whatever prefix it names.

See `bindsEveryPrefix` in `../xml/write.js` for the exact predicate and what it leaves.

###### Example

```ts
import {
  FhirSerializeError,
  SERIALIZE_ERROR_CODES,
  parseResource,
  serializeResourceXml,
} from "@cosyte/fhir";
const { resource } = parseResource(
  '{"resourceType":"Patient","text":{"status":"generated","div":"<v:div>x</v:div>"}}',
);
try {
  serializeResourceXml(resource);
} catch (err) {
  if (err instanceof FhirSerializeError && err.code === SERIALIZE_ERROR_CODES.UNSERIALIZABLE_DIV_PREFIX) {
    err.locations; // ["Patient.text.div"]
  }
}
```

##### UNSERIALIZABLE\_ELEMENT\_NAME

> `readonly` **UNSERIALIZABLE\_ELEMENT\_NAME**: `"UNSERIALIZABLE_ELEMENT_NAME"` = `"UNSERIALIZABLE_ELEMENT_NAME"`

The model carries a name that cannot occupy the `Name` slot of an XML start tag, so writing it
would emit markup that does not re-read as the element the model holds. **XML only**: JSON
escapes a member name, so this refusal never reaches it and that route stays open. **Narrowed
2026-08-07 from "encodes every one of these correctly", which was false and shipped**: a model
refused here can carry one of `serializeResource`'s own declared exceptions and emit that.

See breaksTag for the exact predicate and for what is deliberately NOT refused.

##### UNSERIALIZABLE\_FOREIGN\_ROOT

> `readonly` **UNSERIALIZABLE\_FOREIGN\_ROOT**: `"UNSERIALIZABLE_FOREIGN_ROOT"` = `"UNSERIALIZABLE_FOREIGN_ROOT"`

The model carries, at one or more elements, a root the XML reader read out of a vocabulary that
resolved to something other than FHIR's. **XML only**: `serializeResource` spells a member name
and never a namespace, so it emits the model exactly as it did before this refusal existed and
that route stays open -- which is a statement about that writer's output, **not** a claim that
the JSON channel keeps the flag. It does not, and that half is declared open.

FHIR XML puts the resource in the FHIR namespace, and the writer has no vendor binding to write
instead, so it emitted a document in the FHIR namespace with no trace of the one the sender
wrote. That output re-reads with an **empty** issue list, so the one warning that said the
document came from another vocabulary is gone after a single trip and the vendor document is
indistinguishable from FHIR.

See assertXmlForeignRoot for the window, the two routes weighed, and what it costs.

##### UNSERIALIZABLE\_JSON\_ONLY\_SHAPE

> `readonly` **UNSERIALIZABLE\_JSON\_ONLY\_SHAPE**: `"UNSERIALIZABLE_JSON_ONLY_SHAPE"` = `"UNSERIALIZABLE_JSON_ONLY_SHAPE"`

The model carries, at one or more locations, a shape the JSON reader marked because FHIR JSON
gives that position no meaning: an array inside an array, a scalar or `null` where FHIR JSON has
an object (a complex element's own position or a primitive's `_`-sibling), or a `null` in a
primitive's value channel that padded nothing. **XML only**: this refusal does not reach
`serializeResource`, which writes these back from the text the reader preserved at every position
that writer walks. **It does not walk a member a repeated property name shadowed, and this
refusal does reach one** -- `serializeResource` refuses that model on
[SERIALIZE\_ERROR\_CODES.UNSERIALIZABLE\_SHADOWED\_PROPERTY](#unserializable_shadowed_property) rather than emitting it, so it is
still not a route the shape survives. The XML writer keeps reporting THIS code on such a model,
because this one is raised first. See assertXmlSerializable.

XML has no array-of-arrays, no `_`-sibling and no `null`, so the XML writer has nowhere to put
any of it and emits the element the reader was left holding: an empty one, or none. That output
re-reads with an empty issue list, so the finding the reader raised is gone after one trip.

See assertXmlSerializable for the exact set of markers and for what it does NOT cover.

##### UNSERIALIZABLE\_PREFIXED\_NAME

> `readonly` **UNSERIALIZABLE\_PREFIXED\_NAME**: `"UNSERIALIZABLE_PREFIXED_NAME"` = `"UNSERIALIZABLE_PREFIXED_NAME"`

The model holds, at one or more tag positions, a name carrying a colon. XML reads the colon as
a namespace prefix, and the model carries no namespace binding for the writer to declare one
with, so the document would not be namespace-well-formed. **XML only**: `serializeResource`
spells a member name as a JSON string, so this refusal never reaches it and that route stays
open.

Written anyway, the output named a prefix nothing declared, which a conformant XML parser
rejects, and a prefix rebound between siblings (`<p:x xmlns:p="urn:a"/>` beside
`<p:x xmlns:p="urn:b"/>`) lost its `MIXED_XML_SPELLING` report across one write and one re-read.
**Not [SERIALIZE\_ERROR\_CODES.UNSERIALIZABLE\_ELEMENT\_NAME](#unserializable_element_name)**, whose line is whether this
library's own round trip survives a name: a colon-bearing name survives that round trip, so the
two are different questions and keep different codes. A name that trips both keeps that one.

See carriesUndeclarablePrefix for the exact predicate, its one exemption, and what it
leaves.

##### UNSERIALIZABLE\_RESOURCE\_TYPE

> `readonly` **UNSERIALIZABLE\_RESOURCE\_TYPE**: `"UNSERIALIZABLE_RESOURCE_TYPE"` = `"UNSERIALIZABLE_RESOURCE_TYPE"`

The model carries, at one or more elements, a first `resourceType` that is not a string. FHIR
XML has no `resourceType` element at all -- the type IS the tag -- so the XML writer skipped the
property, and at the root, with no string to name the tag, it wrote `Resource` instead: the
member deleted and the element named a type nobody wrote. **XML only**: `serializeResource` emits a
non-string `resourceType` through its ordinary path, so this refusal never reaches it and that
route stays open.

See assertXmlResourceType for the window and for what it deliberately leaves.

##### UNSERIALIZABLE\_SHADOWED\_PROPERTY

> `readonly` **UNSERIALIZABLE\_SHADOWED\_PROPERTY**: `"UNSERIALIZABLE_SHADOWED_PROPERTY"` = `"UNSERIALIZABLE_SHADOWED_PROPERTY"`

The model carries, at one or more object elements, a member a repeated property name shadowed
(../model/node.js `duplicates`). **Both writers**, unlike the four refusals above it:
each walks `properties` only, so each wrote one member per name and the second value left the
document with no diagnostic on it.

See assertNoShadowedProperty for the window, the two routes weighed, and what it leaves.

##### UNSERIALIZABLE\_XML\_CHARACTER

> `readonly` **UNSERIALIZABLE\_XML\_CHARACTER**: `"UNSERIALIZABLE_XML_CHARACTER"` = `"UNSERIALIZABLE_XML_CHARACTER"`

The model holds, at one or more locations, a value the XML writer would emit as an attribute
value (a primitive's `value`, an `id` written as an attribute, an `Extension.url`), or a `div`
string it would splice in, carrying a code point outside XML 1.0 `Char` (production [2]): U+0000
to U+0008, U+000B, U+000C, U+000E to U+001F, an unpaired surrogate, U+FFFE or U+FFFF. In a `div`
string that includes a numeric character reference denoting one (`&#0;`), which the Legal
Character constraint makes as fatal as the raw character; each reference is judged on its own, so
`&#xD83D;&#xDE00;` is two unpaired surrogates, not one character. **XML only**: `serializeResource`
writes these values as JSON strings, so this refusal never reaches it and that route stays open.

Written anyway, a U+0000 went into the output raw and a conforming processor rejected the
document. **Refused, never repaired**: a reference to a non-`Char` is itself a fatal error, and
replacing or dropping the character would change a value the sender wrote, so the model is left
exactly as it was and no string is returned. Raised after every other refusal, the name code
included.

See carriesNonXmlCharacter for the exact predicate.

###### Example

```ts
import {
  FhirSerializeError,
  SERIALIZE_ERROR_CODES,
  parseResource,
  serializeResourceXml,
} from "@cosyte/fhir";
const { resource } = parseResource('{"resourceType":"Patient","gender":"a\\u0000"}');
try {
  serializeResourceXml(resource);
} catch (err) {
  if (err instanceof FhirSerializeError && err.code === SERIALIZE_ERROR_CODES.UNSERIALIZABLE_XML_CHARACTER) {
    err.locations; // ["Patient.gender"]
  }
}
```

##### UNSERIALIZABLE\_XML\_NAME

> `readonly` **UNSERIALIZABLE\_XML\_NAME**: `"UNSERIALIZABLE_XML_NAME"` = `"UNSERIALIZABLE_XML_NAME"`

The model holds, at one or more tag positions, a name that is not an XML 1.0 `Name` (production
[5]): `a&b`, `1abc`, `-x`, a name carrying U+0000 or an unpaired surrogate. A conforming XML
processor must reject such a document as a fatal error. **XML only**: `serializeResource` spells
a member name as a JSON string, so this refusal never reaches it and that route stays open.

Written anyway, `<a&b value="v"/>` was a document this library's own reader read back unchanged
and a third-party parser rejected, which is why the tag-breaking refusal, whose line is this
library's own round trip, never reached it. **Not
[SERIALIZE\_ERROR\_CODES.UNSERIALIZABLE\_ELEMENT\_NAME](#unserializable_element_name)** and **not
[SERIALIZE\_ERROR\_CODES.UNSERIALIZABLE\_PREFIXED\_NAME](#unserializable_prefixed_name)**: a name that breaks the tag, or
carries a colon, keeps the code it drew before this one existed, whether or not it is a `Name`.
A name carrying a character outside `Char` is not a `Name`, so it draws this code rather than
[SERIALIZE\_ERROR\_CODES.UNSERIALIZABLE\_XML\_CHARACTER](#unserializable_xml_character).

See isXmlName for the exact predicate and what it leaves.

###### Example

```ts
import {
  FhirSerializeError,
  SERIALIZE_ERROR_CODES,
  parseResource,
  serializeResourceXml,
} from "@cosyte/fhir";
const { resource } = parseResource('{"resourceType":"Patient","1abc":"v"}');
try {
  serializeResourceXml(resource);
} catch (err) {
  if (err instanceof FhirSerializeError && err.code === SERIALIZE_ERROR_CODES.UNSERIALIZABLE_XML_NAME) {
    err.locations; // ["Patient.<withheld>"]
  }
}
```

***

### SNOMED\_SCT

> `const` **SNOMED\_SCT**: `"http://snomed.info/sct"` = `"http://snomed.info/sct"`

The SNOMED CT `system` URI (`terminologies-systems.html`).

***

### STARTER\_PROFILE\_BASE\_URL

> `const` **STARTER\_PROFILE\_BASE\_URL**: `"https://cosyte.com/fhir/StructureDefinition"` = `"https://cosyte.com/fhir/StructureDefinition"`

The canonical URL prefix the starter-kit profiles are published under.

***

### STARTER\_PROFILES

> `const` **STARTER\_PROFILES**: readonly [`StructureDefinition`](#structuredefinition)[]

Every starter-kit profile. Iterate this to register the whole kit as a validation profile set, or
pick one by `url`, a starting point a consumer extends with their own site/vendor constraints.

#### Example

```ts
import { STARTER_PROFILES, parseResource, validateResource } from "@cosyte/fhir";
const { resource } = parseResource(observationJson);
const { issues } = validateResource(resource, { profiles: [...STARTER_PROFILES] });
```

***

### TERMINOLOGY\_BINDINGS

> `const` **TERMINOLOGY\_BINDINGS**: readonly [`TerminologyBinding`](#terminologybinding)[]

The built-in bindings, the multi-system elements. Deliberately minimal: broad US
Core element coverage is a profile concern. Each is **extensible**, so a code outside its systems
is a `warning` (a possible legitimate extension), never a false `error`.

***

### UCUM\_SYSTEM

> `const` **UCUM\_SYSTEM**: `"http://unitsofmeasure.org"` = `"http://unitsofmeasure.org"`

The UCUM `system` URI (`terminologies-systems.html`), the one system whose codes are UCUM.

***

### UNBOUNDED

> `const` **UNBOUNDED**: `number` = `Number.POSITIVE_INFINITY`

`1..1` / `0..*` etc. `max` uses [UNBOUNDED](#unbounded) for `*`.

***

### VALIDATION\_CODES

> `const` **VALIDATION\_CODES**: `object`

Stable string codes for every validation finding the layers can raise. Frozen via
`as const` so the union is exact and a comparison is typo-checked. **Renaming a code is a breaking
change**; the set is snapshotted (see `test/validation-codes.test.ts`).

#### Type Declaration

##### ABSENCE\_MARKER\_CONFLICT

> `readonly` **ABSENCE\_MARKER\_CONFLICT**: `"ABSENCE_MARKER_CONFLICT"` = `"ABSENCE_MARKER_CONFLICT"`

Safety, an element carries a DataAbsentReason extension **and a value of its own**, so the
document asserts both that the element holds that value and that it holds none. An `error`
(`structure`): the two cannot both be true, nothing here ranks them, and a consumer that
happened to read one of the two would report the record as though the other had not been
written. Both survive on the model and on the safety readout; this reports that they disagree.
Value-free, the location of the element, never the value and never the reason.

Cannot fire on a conformant document: an element the sender has data for is written with the
data and no marker. It is **not** the `Observation.dataAbsentReason` ELEMENT beside a `value[x]`,
which is the `obs-6` invariant and reports as [VALIDATION\_CODES.INVARIANT\_VIOLATED](#invariant_violated); the
element is not the extension, and the two never report about one another's shape.

##### ABSENCE\_MARKER\_UNREADABLE

> `readonly` **ABSENCE\_MARKER\_UNREADABLE**: `"ABSENCE_MARKER_UNREADABLE"` = `"ABSENCE_MARKER_UNREADABLE"`

Safety, an element carries a DataAbsentReason extension whose reason this library could not
read: no `valueCode`, one holding no readable string, an empty one, one written twice, or a code
outside the closed fifteen-concept value set the extension's `value[x]` binds to at **required**
strength. An `error` (`code-invalid`), on the same footing as any other required-binding miss:
the set is closed and published, so membership is decided from the set itself with no
terminology service involved and no value-set expansion.

**Nothing is coerced.** The code is not trimmed, case-folded or substituted, and the element is
not read as `unknown` and not read as populated: doing either would author a reason the sender
did not spell, or erase a declaration the sender did make. The element stays value-absent and
this is the record that a declaration was made and could not be honoured. Value-free, the
location of the element, never the code that failed to match.

##### ARRAY\_WRAPPED\_CHOICE

> `readonly` **ARRAY\_WRAPPED\_CHOICE**: `"ARRAY_WRAPPED_CHOICE"` = `"ARRAY_WRAPPED_CHOICE"`

Safety, an `Observation.value[x]` choice element arrived wrapped in a JSON array. The same
non-conformant encoding [VALIDATION\_CODES.ARRAY\_WRAPPED\_SCALAR](#array_wrapped_scalar) reports (json.html
§2.6.2.2 reserves the array for a repeating element), at the one position whose cardinality is
decided by a choice rather than by a per-resource element table, so it needs a code of its own
rather than a wider window on that one. An `error`.

**Why the value readout needs its own channel.** `readObservationValue` fails safe on this
shape, it reports the variant that is present and no `quantity`, so no wrong number is handed
out, but "the variant is present and the magnitude is absent" reads identically to an
`Observation` whose `valueQuantity` carried no `value`. A dose the sender wrote is then
indistinguishable from one it did not, and this is the record that the position held content
nothing here would read.

**The window is `Observation.value[x]` and `Observation.component.value[x]`, at every
Observation resource root the model holds**, which is the window the value readout itself reads
(`../quantity/value.js`). Both are `0..1` in R4 (observation.html), so this needs no
per-resource cardinality table and cannot fire on a conformant document. It is deliberately not
every R4 `0..1` element: that is the per-resource model this library does not have.

Value-free, the location of the choice variant, never the magnitude, unit or code inside the
wrapper.

##### ARRAY\_WRAPPED\_SCALAR

> `readonly` **ARRAY\_WRAPPED\_SCALAR**: `"ARRAY_WRAPPED_SCALAR"` = `"ARRAY_WRAPPED_SCALAR"`

Safety, a single-valued (`0..1`) safety element, or `resourceType`, arrived wrapped in a JSON
array. FHIR JSON writes a single-valued element as a name/value pair and uses an array only for a
repeating element (json.html §2.6.2.2), so this is a non-conformant encoding and an `error`. It is the
shape a **generic XML-to-JSON converter** produces for every element, which is how a C-CDA or v2
feed commonly reaches a FHIR surface, and left unreported it reaches the same harm as a repeated
property name: a single-value read finds no code in the array, so a retraction or a negation the
sender wrote goes unreported and the record reads live. Nothing is lost, the wrapper is preserved
and the safety layer reads through it; this reports that the encoding was ambiguous.

##### CARDINALITY\_MAX

> `readonly` **CARDINALITY\_MAX**: `"CARDINALITY_MAX"` = `"CARDINALITY_MAX"`

Layer 2, an element appears more times than its maximum cardinality allows.

##### CARDINALITY\_MIN

> `readonly` **CARDINALITY\_MIN**: `"CARDINALITY_MIN"` = `"CARDINALITY_MIN"`

Layer 2, a required element (min ≥ 1) is absent.

##### CHOICE\_AMBIGUOUS

> `readonly` **CHOICE\_AMBIGUOUS**: `"CHOICE_AMBIGUOUS"` = `"CHOICE_AMBIGUOUS"`

Layer 1, more than one variant of a `choice[x]` element is present.

##### CODE\_INVALID

> `readonly` **CODE\_INVALID**: `"CODE_INVALID"` = `"CODE_INVALID"`

Layer 3, a `code` value is outside a required-strength enumerated binding.

##### CODE\_NOT\_IN\_VALUESET

> `readonly` **CODE\_NOT\_IN\_VALUESET**: `"CODE_NOT_IN_VALUESET"` = `"CODE_NOT_IN_VALUESET"`

Terminology, a configured terminology service reported that a bound coding's
`(system, code)` is **not a member** of the binding's value set. Severity follows the binding
strength (`required`/`extensible` → `error`; `preferred` → `warning`; `example` → `information`,
never an error). Emitted **only** when a service definitively answers `not-in`; with no service,
or an `unknown` answer, the library degrades to the content-free system checks and never
false-errors (fail-safe). Value-free, the coding location, never the code itself.

The **only** finding that carries a [ValidationIssue.codeSystemVersion](#codesystemversion) record, because it
is the only one a terminology service produces: the release the service declared its answer was
made against, or the explicit mark that it declared none. Severity, emission and the fail-safe
degrade are all independent of it.

##### CODE\_SYSTEM\_UNEXPECTED

> `readonly` **CODE\_SYSTEM\_UNEXPECTED**: `"CODE_SYSTEM_UNEXPECTED"` = `"CODE_SYSTEM_UNEXPECTED"`

Terminology, a bound coding uses a **known** code `system` that is not one the
binding's value set draws from (e.g. an ICD-10-CM code where the binding expects RxNorm + SNOMED).
This is the content-free "wrong system for this binding" check, decided from the `system` alone,
with no value-set content. Severity follows the binding strength (`required` → `error`;
`extensible`/`preferred` → `warning`, since a different system may be a legitimate extension;
`example` → none). Compared on the `system` URI, never a code value.

##### CODE\_SYSTEM\_UNKNOWN

> `readonly` **CODE\_SYSTEM\_UNKNOWN**: `"CODE_SYSTEM_UNKNOWN"` = `"CODE_SYSTEM_UNKNOWN"`

Terminology, a bound coding's `system` URI is not in the frozen known-systems registry
(and not one the binding's value set draws from). Always `information` (`code-invalid`): an
unknown system may be a legitimate local/proprietary one, so it is never a defect, it only means
the library cannot validate codes drawn from it. Content-free, so it can never flip validity.

##### CONTAINED\_CYCLE

> `readonly` **CONTAINED\_CYCLE**: `"CONTAINED_CYCLE"` = `"CONTAINED_CYCLE"`

Bundle, the `#fragment` references among a resource's `contained` resources form a
**cycle** (a → b → a, or a self-reference). An `error` (`structure`): a containment cycle is
malformed and, to a naive transitive resolver, a denial-of-service (an unbounded loop / stack
blow-up). The bounded, iterative cycle guard detects it and reports it here rather than looping,
DoS-safe by construction. Value-free, the location of the `contained` element, never a value.

##### DROPPED\_ELEMENT\_TEXT

> `readonly` **DROPPED\_ELEMENT\_TEXT**: `"DROPPED_ELEMENT_TEXT"` = `"DROPPED_ELEMENT_TEXT"`

Safety, an XML document wrote **character data directly on a FHIR element**. FHIR XML carries a
primitive's value in the `value` attribute (xml.html §2.6.1), so text written as element content
has no slot on the model and the reader drops it: `<status>entered-in-error</status>` yields a
`status` with no value. An `error`, and the only code on this list where the content is neither
modeled **nor kept**: unlike [VALIDATION\_CODES.NESTED\_ARRAY](#nested_array-1), which preserves the array's
JSON text, the character data is discarded outright, because reading it back would be a
tolerance for a non-conformant encoding rather than a report of one. Left unreported it reaches the same harm as
[VALIDATION\_CODES.NESTED\_ARRAY](#nested_array-1) by the other wire format, because the model is again
indistinguishable from an element that was legitimately absent: a retraction, a `refuted`
verification status, or a dose *number* beside a surviving unit and UCUM code all read back as a
clean document. Value-free, the position the text occupied, never its contents.

##### DUPLICATE\_PROPERTY

> `readonly` **DUPLICATE\_PROPERTY**: `"DUPLICATE_PROPERTY"` = `"DUPLICATE_PROPERTY"`

Safety, the document wrote a property name more than once, so an element holds several values
and nothing says which the sender meant. FHIR JSON requires unique property names (json.html §2.6.2:
"Property names SHALL be unique") and expresses repetition with an array, so this is a violated
`SHALL` and an `error`. The reader keeps every value (see ../model/node.js `duplicates`),
so this reports an ambiguity, never a loss.

##### FULLURL\_ID\_MISMATCH

> `readonly` **FULLURL\_ID\_MISMATCH**: `"FULLURL_ID_MISMATCH"` = `"FULLURL_ID_MISMATCH"`

Bundle, a Bundle entry's `fullUrl` is a RESTful URL (relative `Type/id` or an absolute
URL ending in `Type/id`) whose id disagrees with the entry `resource.id`. An `error`
(`business-rule`): FHIR requires a RESTful `fullUrl` to be consistent with the resource it wraps,
and a disagreement can cause a reference to resolve to the wrong resource. A `urn:uuid:` (logical)
`fullUrl` places no constraint on `resource.id`, so it never triggers this. Value-free, the
location of the `fullUrl`, never either id.

##### INVARIANT\_UNCHECKED

> `readonly` **INVARIANT\_UNCHECKED**: `"INVARIANT_UNCHECKED"` = `"INVARIANT_UNCHECKED"`

Invariant, a `constraint`'s FHIRPath `expression`, from a supplied profile or from the R4 base
constraints the base-constraint layer evaluates, is **outside the bounded
engine's subset** and could not be evaluated. Always `information` (`informational`):
the constraint is reported **unchecked, never assumed to pass** (fail-safe), the
library does not claim conformance to an invariant it could not test. The constraint `key` travels
in [ValidationIssue.constraint](#constraint-2). Value-free (the location + key, never an instance value).
A profile's verbatim copy of an R4 base constraint that the base-constraint layer decided at the
same occurrence is not reported this way, because that constraint was evaluated: R4's `dom-3`
on a resource with nothing contained draws nothing, with or without a profile.

##### INVARIANT\_VIOLATED

> `readonly` **INVARIANT\_VIOLATED**: `"INVARIANT_VIOLATED"` = `"INVARIANT_VIOLATED"`

Invariant, a resource constraint failed. Three sources raise it, each with or without the
others: the safety layer's named invariants (`ait-1`/`ait-2`, `con-3`/`con-4`/`con-5`,
`obs-6`/`obs-7`); the base-constraint layer, which evaluates the other error-severity
constraints R4 declares on the eight modeled types and their `DomainResource` / `Element` /
`Extension` base (`pat-1`, `obs-3`, `con-1`, `con-2`, `imm-1`, `dom-2` to `dom-5`, `ele-1`,
`ext-1`) with no profile supplied; and a supplied profile's own `constraint`s. The specific
constraint key travels in [ValidationIssue.constraint](#constraint-2), and the severity mirrors the
constraint's own (`error`, except a `warning` constraint such as the best-practice `con-3`).

##### MUST\_SUPPORT\_ABSENT

> `readonly` **MUST\_SUPPORT\_ABSENT**: `"MUST_SUPPORT_ABSENT"` = `"MUST_SUPPORT_ABSENT"`

Profile, an element the profile marks **must-support** is absent from the instance.
**Always `information`, never an error** (the fail-safe, and the single most important
must-support rule): must-support is a *system obligation* on the sender to be able to populate the
element and on the receiver to tolerate its absence, it is **not** an instance-presence
requirement. A strict client that errors on an absent must-support element is the classic bug this
code exists to avoid.

##### NESTED\_ARRAY

> `readonly` **NESTED\_ARRAY**: `"NESTED_ARRAY"` = `"NESTED_ARRAY"`

Safety, the document wrote a JSON array **inside another array**. FHIR JSON uses an array for a
repeating element and for nothing else (json.html §2.6.2.2), so a list of lists has no meaning at
any position and this is a non-conformant encoding wherever it appears, which is why it needs no
cardinality rule and cannot fire on a conformant document. Reported at every position the model
has a node for; a `_`-sibling the reader discards whole is the stated exception, and draws a
reader warning instead: `UNKNOWN_PROPERTY` for an unrecognised member of a `_`-sibling object,
`MISPLACED_PRIMITIVE_EXTENSION` for a sibling on an object or on a non-primitive array, not one
code for all three. An `error`, and one of the two on this list
where the reader could **not model** what the sender wrote (the other is
[VALIDATION\_CODES.DROPPED\_ELEMENT\_TEXT](#dropped_element_text-1)): the codec does not model an inner array, so this
reports a loss of *structure* rather than an ambiguity, though the array's JSON text is kept and
readable (see ../model/node.js `nestedArrayContent`). Left unreported it is among the worst of the
set, because the model then looks exactly like an element that was legitimately absent, and a
refuted allergy, a resolved condition, or an entire resource inside a Bundle entry reads back as
a clean document. Value-free, the position the inner array occupied, never its contents.

##### PRIMITIVE\_INVALID

> `readonly` **PRIMITIVE\_INVALID**: `"PRIMITIVE_INVALID"` = `"PRIMITIVE_INVALID"`

Layer 3, a primitive value does not match its datatype's lexical form.

##### PROFILE\_FIXED\_MISMATCH

> `readonly` **PROFILE\_FIXED\_MISMATCH**: `"PROFILE_FIXED_MISMATCH"` = `"PROFILE_FIXED_MISMATCH"`

Profile, an element carries a value that is not **exactly** the profile's `fixed[x]`.
A `value` `error`: `fixed[x]` is an equality constraint (the element SHALL match the fixed value
exactly, including every nested property). Compared structurally and precision-exactly (decimals
via ../model/decimal.js), never by echoing the value.

##### PROFILE\_PATTERN\_MISMATCH

> `readonly` **PROFILE\_PATTERN\_MISMATCH**: `"PROFILE_PATTERN_MISMATCH"` = `"PROFILE_PATTERN_MISMATCH"`

Profile, an element does not match the profile's `pattern[x]`. A `value` `error`:
`pattern[x]` is a **subset** constraint (the element SHALL contain *at least* the pattern's
properties and values, but may carry more), the weaker sibling of `fixed[x]`. Value-free.

##### PROFILE\_SLICE\_NO\_SLICING

> `readonly` **PROFILE\_SLICE\_NO\_SLICING**: `"PROFILE_SLICE_NO_SLICING"` = `"PROFILE_SLICE_NO_SLICING"`

Profile, the profile defines a slice under an element that declares no `slicing` (or that is
missing from the snapshot), so nothing says which occurrences belong to the slice. Emitted as
`information` at the slice's location: the slice and every element under it are reported
**not checked**, never silently passed. A profile whose snapshot declares the slicing is
checked as usual.

##### PROFILE\_SLICE\_UNCHECKED

> `readonly` **PROFILE\_SLICE\_UNCHECKED**: `"PROFILE_SLICE_UNCHECKED"` = `"PROFILE_SLICE_UNCHECKED"`

Profile, a slicing whose discriminator this library cannot evaluate (a `profile`
discriminator, which needs recursive profile resolution, or the R5-only `position`). Emitted as
`information` so slice membership is reported **unchecked, never silently passed** (the
fail-safe): the library does not guess a slice assignment it cannot justify.

##### PROFILE\_SLICE\_UNMATCHED

> `readonly` **PROFILE\_SLICE\_UNMATCHED**: `"PROFILE_SLICE_UNMATCHED"` = `"PROFILE_SLICE_UNMATCHED"`

Profile, an instance element is present under a **closed** slicing whose discriminators
matched none of the profile's defined slices. A `structure` `error`: `closed` slicing forbids
content outside the named slices. (Under `open` slicing an unmatched element is allowed and draws
nothing; under `openAtEnd` it is allowed only in the trailing position, this library flags a
closed-slicing miss and leaves the ordering nuance unenforced.)

##### PROFILE\_VERSION\_MISMATCH

> `readonly` **PROFILE\_VERSION\_MISMATCH**: `"PROFILE_VERSION_MISMATCH"` = `"PROFILE_VERSION_MISMATCH"`

Profile, the instance's `meta.profile` declares a profile at a version the supplied
profile set does not carry (`canonical|version` with a different version, or an unresolvable
canonical). A `warning` (`business-rule`): an unknown profile
version is flagged rather than silently best-effort-validating against a different one.

##### REFERENCE\_UNRESOLVED

> `readonly` **REFERENCE\_UNRESOLVED**: `"REFERENCE_UNRESOLVED"` = `"REFERENCE_UNRESOLVED"`

Bundle, a `Reference` inside a Bundle entry (or a `#fragment` inside a resource's
`contained`) that could not be resolved within the resolution closure: a fragment whose target
contained resource is absent, or a relative `Type/id` reference naming no entry in the Bundle. A
`warning` (`not-found`) and **never fatal**, the target may legitimately live outside the
supplied closure (a partial Bundle, an external server), so the reference is **preserved**, only
flagged. An absolute/logical reference that is simply external to the Bundle draws **no** finding.
Value-free, the FHIRPath location of the reference, never the reference string itself.

##### RESOURCE\_NOT\_MODELED

> `readonly` **RESOURCE\_NOT\_MODELED**: `"RESOURCE_NOT_MODELED"` = `"RESOURCE_NOT_MODELED"`

Layer 1, no schema is available for this resource type; structural layers were skipped.

##### RESOURCE\_TYPE\_UNKNOWN

> `readonly` **RESOURCE\_TYPE\_UNKNOWN**: `"RESOURCE_TYPE_UNKNOWN"` = `"RESOURCE_TYPE_UNKNOWN"`

Layer 1, the resource carries no `resourceType`, so it cannot be structurally validated.

##### RETRACTED\_RESOURCE

> `readonly` **RETRACTED\_RESOURCE**: `"RETRACTED_RESOURCE"` = `"RETRACTED_RESOURCE"`

Safety, the resource is marked `entered-in-error` and is therefore **retracted, not
data**. Surfaced as `information` (it is not itself a defect) so a consumer cannot miss it.

##### TYPE\_MISMATCH

> `readonly` **TYPE\_MISMATCH**: `"TYPE_MISMATCH"` = `"TYPE_MISMATCH"`

Layer 1, an element's node shape (primitive / complex) is not what its datatype expects.

##### UCUM\_UNIT\_UNRECOGNIZED

> `readonly` **UCUM\_UNIT\_UNRECOGNIZED**: `"UCUM_UNIT_UNRECOGNIZED"` = `"UCUM_UNIT_UNRECOGNIZED"`

Quantity/UCUM, a `Quantity` claims the UCUM `system` but its `code` is absent or not a
shape-valid UCUM expression, so the unit cannot be trusted for machine use. A `warning`
(`value`): the value is **preserved verbatim and never converted**, the library does not bundle
UCUM content, so it cannot assert the code *is* a real unit, only that it is present and well-shaped.

##### UNHANDLED\_MODIFIER\_EXTENSION

> `readonly` **UNHANDLED\_MODIFIER\_EXTENSION**: `"UNHANDLED_MODIFIER_EXTENSION"` = `"UNHANDLED_MODIFIER_EXTENSION"`

Safety, an element carries a `modifierExtension` this library does not understand.
FHIR's `?!` rule forbids ignoring an unknown modifier, so this **fails closed** (an `error`): the
element cannot be safely processed. See ./safety.js.

##### UNKNOWN\_ELEMENT

> `readonly` **UNKNOWN\_ELEMENT**: `"UNKNOWN_ELEMENT"` = `"UNKNOWN_ELEMENT"`

Layer 1, an element the resource's structure does not define at this location.

##### VALUE\_TYPE\_UNEXPECTED

> `readonly` **VALUE\_TYPE\_UNEXPECTED**: `"VALUE_TYPE_UNEXPECTED"` = `"VALUE_TYPE_UNEXPECTED"`

Quantity/UCUM, an Observation whose profile expects a numeric `Quantity` value carries
a different `value[x]` variant instead (e.g. `valueString`). A `warning` (`value`): the value is
preserved and surfaced by its real type, a caller must not read it as a number.

##### VITAL\_SIGN\_UNIT\_NONCONFORMANT

> `readonly` **VITAL\_SIGN\_UNIT\_NONCONFORMANT**: `"VITAL_SIGN_UNIT_NONCONFORMANT"` = `"VITAL_SIGN_UNIT_NONCONFORMANT"`

Quantity/UCUM, a vital-signs Observation's measured value carries a unit the FHIR
vital-signs profile forbids for that LOINC code (wrong UCUM `code`, or a non-UCUM `system`). An
`error` (`code-invalid`): the vital-signs profile *requires* the unit, so a nonconformant one is a
profile violation, compared on the UCUM `code` (case- and bracket-sensitive), never the `unit` string.

***

### VERSION

> `const` **VERSION**: `string` = `"0.1.14"`

Library version string, synced with `package.json#version` at build time by
`cosyte-process sync-version` (wired into the Changesets `version` script). Exported now so
consumers, and the type-check pipeline, have at least one symbol to resolve through the
`exports` map.

#### Example

```ts
import { VERSION } from "@cosyte/fhir";
console.log(VERSION);
```

***

### VITAL\_SIGN\_OBSERVATION\_STARTER

> `const` **VITAL\_SIGN\_OBSERVATION\_STARTER**: [`StructureDefinition`](#structuredefinition)

A **vital-sign `Observation`** starter, grounded in `observation-vitalsigns.html` + US Core Vital
Signs: `status` is required, `code` is required + must-support, and `category` is **sliced**, a
required `VSCat` slice pins the `vital-signs` category coding, while the slicing stays **`open`** so
an instance may *also* carry other categories (e.g. `laboratory`). This mirrors how the real vital-
signs profile constrains `category` (a slice, **not** a bare pattern on the repeating element, a
bare pattern would wrongly require *every* category entry to be `vital-signs` and reject a valid
multi-category Observation). It exercises the profile engine's `pattern`/`$this` slicing
discriminator. Fixed UCUM units per vital sign are surfaced by the quantity layer
(`VITAL_SIGN_UNITS`), not re-encoded here.

***

### VITAL\_SIGN\_UNITS

> `const` **VITAL\_SIGN\_UNITS**: `ReadonlyMap`\<`string`, readonly `string`[]\>

The FHIR R4 **vital-signs required-unit table** (`observation-vitalsigns.html`): each vital-sign
LOINC code and the exact UCUM **codes** its profile requires on `Observation.value[x]` (or the
relevant `component.value[x]`). The comparison is against the UCUM `code`, case-sensitive and
bracket-literal, never the `unit` display string. Panels (vital-signs panel `85353-1`, blood
pressure panel `85354-9`) carry no top-level value and so are not keyed here; their measured
components (e.g. systolic `8480-6`) are.

This is a **closed, spec-defined** set of stable identifiers (like the status codes), not a
licensed terminology table. A LOINC code absent from this table is left unchecked (a clean degrade,
never a false error), and the table is the seam a later terminology change widens.

***

### VITAL\_SIGNS\_CATEGORY

> `const` **VITAL\_SIGNS\_CATEGORY**: `"vital-signs"` = `"vital-signs"`

The `Observation.category` code that marks an observation as a vital sign (its profile trigger).

***

### VITAL\_SIGNS\_PROFILE

> `const` **VITAL\_SIGNS\_PROFILE**: `"http://hl7.org/fhir/StructureDefinition/vitalsigns"` = `"http://hl7.org/fhir/StructureDefinition/vitalsigns"`

The canonical URL of the FHIR R4 vital-signs `StructureDefinition` (an alternate profile trigger).

***

### WITHHELD

> `const` **WITHHELD**: `"<withheld>"` = `"<withheld>"`

What a location prints in place of a name it may not echo.

Deliberately carries **no length**, because the length of a refused name is itself derivable
information about the content that was there.

***

### XHTML\_NAMESPACE

> `const` **XHTML\_NAMESPACE**: `"http://www.w3.org/1999/xhtml"` = `"http://www.w3.org/1999/xhtml"`

The XHTML namespace of a FHIR narrative `<div>`, which is carried whole rather than flagged.

***

### XML\_FATAL\_CODES

> `const` **XML\_FATAL\_CODES**: `object`

Stable string codes for the XML reader's unrecoverable fatals. The first two are the safety
refusals (see the module doc); the last two are ordinary well-formedness / DoS bounds.

#### Type Declaration

##### DTD\_FORBIDDEN

> `readonly` **DTD\_FORBIDDEN**: `"DTD_FORBIDDEN"` = `"DTD_FORBIDDEN"`

A `<!DOCTYPE …>` declaration was present. Refused unconditionally: a DTD is where entities are
declared, so refusing it closes the XXE **and** billion-laughs vectors at once (module doc).

##### MALFORMED\_XML

> `readonly` **MALFORMED\_XML**: `"MALFORMED_XML"` = `"MALFORMED_XML"`

The input is not well-formed XML (bad tag, mismatched close, unterminated string, …).

##### MAX\_DEPTH\_EXCEEDED

> `readonly` **MAX\_DEPTH\_EXCEEDED**: `"MAX_DEPTH_EXCEEDED"` = `"MAX_DEPTH_EXCEEDED"`

Element nesting deeper than the reader's fixed bound, refused as a DoS guard, never a crash.

##### UNDEFINED\_ENTITY

> `readonly` **UNDEFINED\_ENTITY**: `"UNDEFINED_ENTITY"` = `"UNDEFINED_ENTITY"`

An entity reference other than the five predefined (`&amp; &lt; &gt; &quot; &apos;`) or a
numeric character reference. Undefined by construction (DTDs are refused), so it is refused
rather than resolved, never expanded, never fetched, never dropped.

## Functions

### absenceMarkers()

> **absenceMarkers**(`resource`, `path`): [`AbsenceMarker`](#absencemarker)[]

Every element the document declares an absence for, with the reason the sender spelled: the
standalone form of [SafetyReadout.absenceMarkers](#absencemarkers), returning exactly what that channel
carries.

A source system with no data for a mandatory element cannot omit it, so it writes the element
present and value-absent, carrying the R4 DataAbsentReason extension. Without this read that
element is indistinguishable from one the sender never wrote: both are present-and-empty to every
value reader in the package. This is the read that tells them apart, and it carries the reason, so
`unknown` is distinguishable from `masked` and from `not-performed` too.

A deep walk of the whole document, so a marker inside `contained` or a Bundle entry is caught with
a location that names where it sits, and both wire formats are read by one predicate.

#### Parameters

##### resource

[`FhirComplex`](#fhircomplex)

The resource model.

##### path

`string`

The FHIRPath prefix for the resource root (usually its `resourceType`).

#### Returns

[`AbsenceMarker`](#absencemarker)[]

The readable markers, in walk order, one entry per distinct reason at a location.

#### Example

```ts
import { absenceMarkers, parseResource } from "@cosyte/fhir";
const { resource } = parseResource(
  '{"resourceType":"Observation","_status":{"extension":[{"url":' +
    '"http://hl7.org/fhir/StructureDefinition/data-absent-reason","valueCode":"unknown"}]}}',
);
absenceMarkers(resource, "Observation"); // [{ code: "unknown", location: "Observation.status" }]
```

***

### arrayWrappedScalars()

> **arrayWrappedScalars**(`resource`, `path`): `string`[]

Collect the FHIRPath locations where a `0..1` safety element arrived wrapped in a JSON array, a
deep walk of the whole resource (so a resource inside `contained` or a Bundle `entry` is covered).

FHIR JSON represents a `0..1` element as a name/value pair and a repeating element as an array
(json.html §2.6.2.2), so an array here is non-conformant. It matters far more than that sounds:
array-wrapping **every** element is ordinary generic XML-to-JSON converter output, which is exactly
the route a C-CDA or v2 feed takes to a FHIR surface, and a single-value read of
`{"status":["entered-in-error"]}` finds no string at all. The negation reads now see through the
wrapper (../safety/codes.js `primitiveStrings`), so the retraction is no longer missed; this
is the second half, the **refusal to affirm** a positive verdict over a document whose safety-bearing
element the sender encoded in a shape FHIR does not define.

**Scope: a resource root, and three windows that are scoped differently because they are grounded
differently.** They are named as three rather than blurred into one, because a sentence that made
them one window was false here for as long as the negation read was wider than the report:

1. **The cardinality table**, `SAFETY_SCALAR_ELEMENTS` on a ../safety/codes.js
   `SAFETY_RESOURCE_TYPES` root, plus `resourceType` on **any** root. The type scoping is not
   timidity: R4 defines repeating elements under these names elsewhere (`Questionnaire.code`,
   `ElementDefinition.code`, both `0..*`), so a name-only rule would emit a false error on a
   conformant document.
2. **One level down from those of them that are `CodeableConcept`-valued**
   (`SAFETY_CODEABLE_ELEMENTS`), at `Coding.system` / `Coding.code`.
3. **One level down from every element the negation read resolves through a `Coding`**
   (../safety/codes.js `NEGATION_CODE_READS`, the rows marked `codings`), at **every**
   resource root of **any** type -- because those reads are not type-scoped either, and a read
   whose report is narrower than itself resolves a clinical code out of an encoding FHIR JSON does
   not define with no diagnostic anywhere, or declines one in silence.

The `Coding` level needs no cardinality care in either of its two windows, because `Coding` is a
datatype whose `system` and `code` are `0..1` wherever it appears -- which is exactly why the
un-gated window can exist and the element-level one cannot. Deciding cardinality anywhere else
needs a per-resource model, which this library does not have and this layer must not grow.

**Why the `Coding` level is reported even though it is now read:** ../safety/codes.js
`codingsOf` reads through such a wrapper only where it holds a *single array position*, since
`system` and `code` feed its `system` x `code` cross-product and a rule yielding more than one value
on either side would pair values from different positions and **assert a coding the sender never
wrote**, one of which is a recorded "no known allergy", a *positive* clinical assertion. So a
multi-position wrapper is deliberately unread, and its location is the only thing standing between
that and a `safeToSummarize: true` over a value the library declined to read. The single-position
case is reported for the same reason the element-level wrapper is when its value *is* read: FHIR
JSON does not define the shape, so an affirmative verdict over it is not this library's to give.

#### Parameters

##### resource

[`FhirComplex`](#fhircomplex)

The resource model.

##### path

`string`

The FHIRPath prefix for the resource root (usually its `resourceType`).

#### Returns

`string`[]

The locations of the array-wrapped scalar elements, in **walk order**: each resource root
  as the walk reaches it, and within one root the cardinality table's surviving properties, then
  the members a repeated property name shadowed, then the negation read's `Coding` locations.
  **Walk order is not document order**, and no claim is made that it is: do not sort or diff a
  caller's expectations against the order the document wrote.

#### Example

```ts
import { arrayWrappedScalars, parseResource } from "@cosyte/fhir";
const { resource } = parseResource('{"resourceType":"Observation","status":["entered-in-error"]}');
arrayWrappedScalars(resource, "Observation"); // ["Observation.status"]
```

***

### assertSafeToSummarize()

> **assertSafeToSummarize**(`resource`): `void`

Assert a resource is safe to flatten/summarize, throwing [FhirSafetyError](#fhirsafetyerror) when it carries an
unhandled `modifierExtension`, a modifier element, a repeated property name, an array-wrapped single-valued element, an
array inside an array, dropped XML element text, a boolean-valued safety element holding a written
value outside the datatype's lexical space, or a `code`-valued negation element holding a value
that spells a negation code bar its case or its surrounding whitespace, or content at a position
no `code` read can reach, or a `MedicationRequest.intent` that is not one of the eight R4 codes,
or a `use` on an Identifier, a HumanName, an Address or a ContactPoint that is not a code of its
datatype's R4 value set, or an element declaring an absence in a reason this library cannot read,
or an element declaring an absence beside a value of its own. A readable, non-conflicting declared
absence throws nothing, and neither does a readable `intent` or `use`. This is the executable
form of "carries status
**or refuses**": a summary helper calls it first, and never silently drops a modifier it cannot
honor, nor summarizes an element whose value the document left ambiguous or whose content the codec
could not read.

#### Parameters

##### resource

[`FhirComplex`](#fhircomplex) \| [`SafetyReadout`](#safetyreadout)

The resource (or a readout already computed for it).

#### Returns

`void`

#### Throws

FhirSafetyError when any of the shapes named above is present.

#### Example

```ts
import { assertSafeToSummarize, parseResource } from "@cosyte/fhir";
const { resource } = parseResource('{"resourceType":"Condition","clinicalStatus":{}}');
assertSafeToSummarize(resource); // ok, no unhandled modifier
```

***

### baseSchema()

> **baseSchema**(`type`): [`ResourceSchema`](#resourceschema)

A base-elements-only schema for a resource type, the universally-true `Resource` /
`DomainResource` elements, and nothing resource-specific. Used to validate a resource whose type
is not modeled **without** emitting false "unknown element" findings for its own
(unmodeled) elements, the safe degrade.

#### Parameters

##### type

`string`

The resource type name.

#### Returns

[`ResourceSchema`](#resourceschema)

A schema carrying only the base elements.

#### Example

```ts
import { baseSchema } from "@cosyte/fhir";
baseSchema("Device").elements.id; // { min: 0, max: 1, types: ["id"] }
```

***

### buildBindingRegistry()

> **buildBindingRegistry**(`extra?`): [`BindingRegistry`](#bindingregistry)

Build a [BindingRegistry](#bindingregistry) from the built-in bindings plus any caller-supplied ones. A
caller binding for a path replaces the built-in for that path, so a consumer can override or add
element bindings (real profiles feed these).

#### Parameters

##### extra?

readonly [`TerminologyBinding`](#terminologybinding)[] = `[]`

Additional bindings to register (override built-ins by path).

#### Returns

[`BindingRegistry`](#bindingregistry)

A resolver from element path to its binding.

#### Example

```ts
import { buildBindingRegistry } from "@cosyte/fhir";
const registry = buildBindingRegistry();
registry("AllergyIntolerance.code")?.strength; // "extensible"
registry("Patient.gender");                    // undefined, not a terminology binding here
```

***

### buildBundleIndex()

> **buildBundleIndex**(`bundle`): [`BundleIndex`](#bundleindex)

Build a [BundleIndex](#bundleindex) from a `Bundle`, keying every entry resource by both its `fullUrl` and,
where derivable, a `Type/id`, so a relative, absolute, or logical reference can each find it.

#### Parameters

##### bundle

[`FhirComplex`](#fhircomplex)

A `Bundle` resource model.

#### Returns

[`BundleIndex`](#bundleindex)

#### Example

```ts
import { parseResource, buildBundleIndex, resolveReference } from "@cosyte/fhir";
const { resource } = parseResource(
  '{"resourceType":"Bundle","type":"collection","entry":[' +
    '{"fullUrl":"https://ex/Patient/1","resource":{"resourceType":"Patient","id":"1"}}]}',
);
const index = buildBundleIndex(resource);
resolveReference("Patient/1", { bundle: index }).status; // "resolved"
```

***

### buildRegistry()

> **buildRegistry**(`extra?`): [`SchemaRegistry`](#schemaregistry)

Build a [SchemaRegistry](#schemaregistry) from the built-in schemas plus any caller-supplied ones. A
caller schema for a type replaces the built-in for that type (so a consumer can, for example,
provide a resource type this package does not ship). Base elements are always merged in.

Build a registry once and hand it to every `validateResource` call as `registry`: a call given
`schemas` merges them into a new registry each time.

#### Parameters

##### extra?

readonly [`ResourceSchema`](#resourceschema)[] = `[]`

Additional resource schemas to register (override built-ins by type).

#### Returns

[`SchemaRegistry`](#schemaregistry)

A resolver from resource type to its merged schema.

#### Example

```ts
import { buildRegistry } from "@cosyte/fhir";
const registry = buildRegistry();
registry("Patient"); // the built-in Patient schema, base elements merged in
registry("Device");  // undefined, not modeled
```

***

### codeOf()

> **codeOf**(`node`, `preferredSystem?`): `string` \| `undefined`

The first `code` on a `CodeableConcept` node, preferring a coding in `preferredSystem` when one is
given. Used to surface a `clinicalStatus` / `verificationStatus` value without a typed model.

#### Parameters

##### node

[`FhirNode`](#fhirnode) \| `undefined`

A `CodeableConcept` node (or list), or `undefined`.

##### preferredSystem?

`string`

A system to prefer a coding from, when several are present.

#### Returns

`string` \| `undefined`

The chosen code, or `undefined` when there is none.

#### Example

```ts
import { codeOf, getProperty, parseResource } from "@cosyte/fhir";
const { resource } = parseResource(
  '{"resourceType":"Condition","clinicalStatus":{"coding":[{"code":"active"}]}}',
);
codeOf(getProperty(resource, "clinicalStatus")); // "active"
```

***

### codingsOf()

> **codingsOf**(`node`): [`Coded`](#coded)[]

Every `Coding` reachable from a node that is a `CodeableConcept` (or a list of them). Flattens a
repeating element (e.g. `Condition.category`) and tolerates a `CodeableConcept` with no `coding`.

Read across **every** value a non-conformant document wrote: all `coding` members, and every
`system` x `code` combination inside one `Coding` that repeated either name. A conformant `Coding`
has one `system` and one `code`, so it yields exactly one pair and this is a no-op there.

Each `system` / `code` member contributes **at most one value** (codingScalar), read through
a single-position array wrapper but never through a multi-position one. That bound is what makes the
wrapper safe to read at all: it holds the cross-product to one pair per (`system` member, `code`
member) combination, so this **never invents a `(system, code)` pair the sender did not write**. A
multi-position wrapper is left unread on purpose, and reported instead.

Precisely: **a single-position wrapper is transparent.** The pairs this yields for a document are
exactly the pairs it yields for the same document with those wrappers removed. So unwrapping decides
nothing on its own; it restores the reading the sender's pre-conversion document had.

Two consequences, both confined to a document that repeated a name, which is a document
../validate/safety.js already reports invalid and ./status.js already refuses to
summarize. **(a)** Repeating a name only ever *adds* pairs, so a check asking "is this code present"
(a retraction, a refutation) over-reports rather than misses, which is the direction the safety layer
wants. A check asking the opposite, "is the required code absent" (`con-3`, `con-4`, `ait-1`), can
therefore be *suppressed* by an added pair. **(b)** When a `Coding` repeated **both** names the
pairing is genuinely unrecoverable, so a combination the sender never wrote can appear, and
[codeOf](#codeof) with a preferred system may select it. Neither is a silent read: the caller already
has the `DUPLICATE_PROPERTY` location. Transparency means a wrapper adds no *new* case here: a
wrapped repeated name reads as the unwrapped repeated name already did, and the invention is the
repetition's, not the wrapper's.

Reading a wrapper can also *remove* a finding, and that is the same effect from the other side: a
`verificationStatus` of `entered-in-error` written inside a wrapper satisfies `ait-1` and it is the
unread version that emitted the false error. It cannot turn a document valid, because the wrapper
that made the value readable here is itself an `ARRAY_WRAPPED_SCALAR` error on the very same
`Coding` (./status.js `arrayWrappedScalars`).

#### Parameters

##### node

[`FhirNode`](#fhirnode) \| `undefined`

A `CodeableConcept` node, a list of them, or `undefined`.

#### Returns

[`Coded`](#coded)[]

The `(system, code)` pairs, in document order.

#### Example

```ts
import { codingsOf, getProperty, parseResource } from "@cosyte/fhir";
const { resource } = parseResource(
  '{"resourceType":"Condition","clinicalStatus":{"coding":[{"system":"s","code":"active"}]}}',
);
codingsOf(getProperty(resource, "clinicalStatus")); // [{ system: "s", code: "active" }]
```

***

### collectBundleIssues()

> **collectBundleIssues**(`resource`): [`ValidationIssue`](#validationissue)[]

Collect the Bundle-integrity findings for a `Bundle` resource. Returns an empty list for a
non-Bundle resource (the caller keys this off `resourceType`) and for a clean Bundle.

#### Parameters

##### resource

[`FhirComplex`](#fhircomplex)

The resource model (a `Bundle`).

#### Returns

[`ValidationIssue`](#validationissue)[]

The value-free [ValidationIssue](#validationissue)s, in document order.

#### Example

```ts
import { parseResource, collectBundleIssues } from "@cosyte/fhir";
const { resource } = parseResource(
  '{"resourceType":"Bundle","type":"collection","entry":[' +
    '{"fullUrl":"https://ex/Patient/1","resource":{"resourceType":"Patient","id":"2"}}]}',
);
collectBundleIssues(resource).map((i) => i.code); // ["FULLURL_ID_MISMATCH"]
```

***

### collectInvariantIssues()

> **collectInvariantIssues**(`resource`, `profile`, `options?`): [`ValidationIssue`](#validationissue)[]

Collect every invariant finding for a resource validated against one profile.

#### Parameters

##### resource

[`FhirComplex`](#fhircomplex)

The resource model.

##### profile

[`StructureDefinition`](#structuredefinition)

The profile whose `constraint`s to evaluate.

##### options?

[`InvariantOptions`](#invariantoptions) = `{}`

Optional base resolver for snapshot generation.

#### Returns

[`ValidationIssue`](#validationissue)[]

The value-free invariant [ValidationIssue](#validationissue)s (`INVARIANT_VIOLATED` / `INVARIANT_UNCHECKED`).
  Empty when the profile does not apply, carries no constraints, or the resource satisfies them all.

#### Example

```ts
import { collectInvariantIssues, loadStructureDefinition, parseResource } from "@cosyte/fhir";
const profile = loadStructureDefinition(parseResource(usCoreProfileJson).resource);
if (profile !== undefined) {
  const issues = collectInvariantIssues(parseResource(instanceJson).resource, profile);
}
```

***

### collectProfileIssues()

> **collectProfileIssues**(`resource`, `profile`, `options?`): [`ValidationIssue`](#validationissue)[]

Collect every profile-conformance finding for a resource validated against one profile.

#### Parameters

##### resource

[`FhirComplex`](#fhircomplex)

The resource model.

##### profile

[`StructureDefinition`](#structuredefinition)

The profile (`StructureDefinition`) to validate against.

##### options?

[`ProfileOptions`](#profileoptions) = `{}`

Optional base resolver for snapshot generation.

#### Returns

[`ValidationIssue`](#validationissue)[]

The value-free profile [ValidationIssue](#validationissue)s. Empty when the profile does not apply to
  this resource type or the resource conforms.

#### Example

```ts
import { collectProfileIssues, loadStructureDefinition, parseResource } from "@cosyte/fhir";
const profile = loadStructureDefinition(parseResource(usCoreAllergyJson).resource);
if (profile !== undefined) {
  const issues = collectProfileIssues(parseResource(allergyJson).resource, profile);
}
```

***

### collectProfileVersionIssues()

> **collectProfileVersionIssues**(`resource`, `profiles`): [`ValidationIssue`](#validationissue)[]

Collect `PROFILE_VERSION_MISMATCH` findings by comparing the resource's declared `meta.profile`
canonicals against the supplied profile set. A declared `canonical|version` whose canonical is
supplied at a **different** version is flagged (`warning`): flagging an
unknown profile version rather than silently validating against a different one. A canonical that is
not supplied at all is *not* flagged here (it simply was not validated), and a declaration with no
version pin never mismatches.

#### Parameters

##### resource

[`FhirComplex`](#fhircomplex)

The resource model.

##### profiles

readonly [`StructureDefinition`](#structuredefinition)[]

The supplied profiles (their `url` + `version` form the known set).

#### Returns

[`ValidationIssue`](#validationissue)[]

The value-free version-mismatch issues.

#### Example

```ts
import { collectProfileVersionIssues } from "@cosyte/fhir";
// resource.meta.profile = ["http://…/us-core-patient|3.1.1"], supplied profile is version 6.1.0:
collectProfileVersionIssues(resource, [usCorePatient610]); // → one PROFILE_VERSION_MISMATCH
```

***

### collectQuantityIssues()

> **collectQuantityIssues**(`resource`, `rt`): [`ValidationIssue`](#validationissue)[]

Collect every Quantity/UCUM finding for a resource: UCUM shape on Observation values / dose
quantities, and the vital-signs required-unit conformance.

#### Parameters

##### resource

[`FhirComplex`](#fhircomplex)

The resource model.

##### rt

`string`

Its resolved `resourceType`.

#### Returns

[`ValidationIssue`](#validationissue)[]

The value-free Quantity [ValidationIssue](#validationissue)s, in document order.

#### Example

```ts
import { collectQuantityIssues, parseResource } from "@cosyte/fhir";
const { resource } = parseResource(
  '{"resourceType":"Observation","category":[{"coding":[{"system":"http://terminology.hl7.org/CodeSystem/observation-category","code":"vital-signs"}]}],' +
    '"code":{"coding":[{"system":"http://loinc.org","code":"8480-6"}]},' +
    '"valueQuantity":{"value":120,"system":"http://unitsofmeasure.org","code":"mmHg"}}',
);
collectQuantityIssues(resource, "Observation"); // → one VITAL_SIGN_UNIT_NONCONFORMANT ("mmHg" ≠ "mm[Hg]")
```

***

### collectSafetyIssues()

> **collectSafetyIssues**(`resource`, `rt`): [`ValidationIssue`](#validationissue)[]

Collect every safety finding for a resource: fail-closed modifier extensions and repeated property
names (both universal), the `entered-in-error` retraction note, and the named invariants (for the
types `SAFETY_RESOURCE_TYPES` names).

#### Parameters

##### resource

[`FhirComplex`](#fhircomplex)

The resource model.

##### rt

`string`

Its resolved `resourceType` (the caller has already established it is present).

#### Returns

[`ValidationIssue`](#validationissue)[]

The value-free safety [ValidationIssue](#validationissue)s, in a stable order.

#### Example

```ts
import { collectSafetyIssues, parseResource } from "@cosyte/fhir";
const { resource } = parseResource('{"resourceType":"Observation","status":"entered-in-error"}');
collectSafetyIssues(resource, "Observation"); // → one RETRACTED_RESOURCE issue
```

***

### collectTerminologyIssues()

> **collectTerminologyIssues**(`resource`, `rt`, `options?`): [`ValidationIssue`](#validationissue)[]

Collect every terminology binding finding for a resource: content-free system checks on each bound
coding, plus value-set membership when a terminology service is supplied.

#### Parameters

##### resource

[`FhirComplex`](#fhircomplex)

The resource model.

##### rt

`string`

Its resolved `resourceType`.

##### options?

[`TerminologyOptions`](#terminologyoptions) = `{}`

The optional terminology service and extra bindings.

#### Returns

[`ValidationIssue`](#validationissue)[]

The value-free terminology [ValidationIssue](#validationissue)s, in document order.

#### Example

```ts
import { collectTerminologyIssues, parseResource } from "@cosyte/fhir";
const { resource } = parseResource(
  '{"resourceType":"AllergyIntolerance",' +
    '"code":{"coding":[{"system":"http://hl7.org/fhir/sid/icd-10-cm","code":"T78.40XA"}]}}',
);
// Extensible binding (RxNorm + SNOMED), ICD-10-CM is a known but unexpected system → one warning.
collectTerminologyIssues(resource, "AllergyIntolerance");
```

***

### complex()

> **complex**(`properties`, `duplicates?`): [`FhirComplex`](#fhircomplex)

Construct a [FhirComplex](#fhircomplex) from ordered properties, optionally carrying the members a
repeated property name shadowed.

#### Parameters

##### properties

readonly [`FhirProperty`](#fhirproperty)[]

The named properties, in wire order, at most one per name.

##### duplicates?

readonly [`FhirProperty`](#fhirproperty)[]

Members shadowed by a repeated name. Omitted (not set to `undefined`) when
  empty, so a conformant node stays structurally equal to one built without the argument.

#### Returns

[`FhirComplex`](#fhircomplex)

#### Example

```ts
import { complex, primitive } from "@cosyte/fhir";
const patient = complex([{ name: "resourceType", value: primitive("Patient") }]);
```

***

### conflictingAbsenceMarkers()

> **conflictingAbsenceMarkers**(`resource`, `path`): `string`[]

The locations where an element carries an absence marker and a value of its own: the standalone
form of [SafetyReadout.conflictingAbsenceMarkers](#conflictingabsencemarkers).

The document says two contradictory things about one element and this library ranks neither. Both
survive on the readout, and this location is what stops a caller preferring whichever its own read
reached first.

#### Parameters

##### resource

[`FhirComplex`](#fhircomplex)

The resource model.

##### path

`string`

The FHIRPath prefix for the resource root (usually its `resourceType`).

#### Returns

`string`[]

The locations, in walk order, each once however many markers sit there.

#### Example

```ts
import { conflictingAbsenceMarkers, parseResource } from "@cosyte/fhir";
const { resource } = parseResource(
  '{"resourceType":"Observation","status":"final","_status":{"extension":[{"url":' +
    '"http://hl7.org/fhir/StructureDefinition/data-absent-reason","valueCode":"unknown"}]}}',
);
conflictingAbsenceMarkers(resource, "Observation"); // ["Observation.status"]
```

***

### containedIndex()

> **containedIndex**(`resource`): [`ContainedIndex`](#containedindex)

Build a [ContainedIndex](#containedindex) for `#fragment` resolution against a resource's `contained` set.

#### Parameters

##### resource

[`FhirComplex`](#fhircomplex)

The containing resource model.

#### Returns

[`ContainedIndex`](#containedindex)

#### Example

```ts
import { parseResource, containedIndex, resolveReference } from "@cosyte/fhir";
const { resource } = parseResource(
  '{"resourceType":"Observation","contained":[{"resourceType":"Patient","id":"p1"}],' +
    '"subject":{"reference":"#p1"}}',
);
const contained = containedIndex(resource);
resolveReference("#p1", { contained }).status; // "resolved"
```

***

### convertToBoolean()

> **convertToBoolean**(`coll`): `boolean`

FHIRPath boolean coercion, matching the reference validator: an empty collection is `false`, a
single boolean is itself, any other single item is `true`, and a multi-item collection is `true`.

#### Parameters

##### coll

[`FpColl`](#fpcoll)

The collection to coerce.

#### Returns

`boolean`

The boolean an invariant result (or a `where` criteria) is judged by.

#### Example

```ts
import { convertToBoolean } from "@cosyte/fhir";
convertToBoolean([]); // false, an empty result fails a constraint, never silently passes
```

***

### decimal()

> **decimal**(`raw`): [`FhirDecimal`](#fhirdecimal)

Construct a [FhirDecimal](#fhirdecimal) from its exact lexical text, validating that the text is a JSON
number. Throws a `TypeError` on anything else, a decimal primitive can only hold a number literal,
and accepting arbitrary text here would defeat the whole point of the type.

#### Parameters

##### raw

`string`

The exact decimal literal, e.g. `"0.010"`, `"-3.14"`, `"1e3"`, `"42"`.

#### Returns

[`FhirDecimal`](#fhirdecimal)

#### Throws

TypeError when `raw` is not a valid JSON number.

#### Example

```ts
import { decimal } from "@cosyte/fhir";
const weight = decimal("70.0"); // one-decimal-place precision, preserved
```

***

### decimalPrecisionAtRisk()

> **decimalPrecisionAtRisk**(`expression`): [`FhirIssue`](#fhirissue)

Build a [ISSUE\_CODES.DECIMAL\_PRECISION\_AT\_RISK](#decimal_precision_at_risk) issue at `expression`.

#### Parameters

##### expression

`string`

#### Returns

[`FhirIssue`](#fhirissue)

#### Example

```ts
import { decimalPrecisionAtRisk } from "@cosyte/fhir";
const issue = decimalPrecisionAtRisk("Observation.valueQuantity.value");
```

***

### defineProfile()

> **defineProfile**(`spec`): [`StructureDefinition`](#structuredefinition)

Author a [StructureDefinition](#structuredefinition) programmatically from an ergonomic [ProfileSpec](#profilespec).

The result is the *same* model the profile engine consumes, pass it straight to
`validateResource(resource, { profiles: [defineProfile(spec)] })`. It is identical to what
`loadStructureDefinition` produces from the equivalent FHIR `StructureDefinition` JSON: one model,
two authoring routes.

#### Parameters

##### spec

[`ProfileSpec`](#profilespec)

The ergonomic profile spec.

#### Returns

[`StructureDefinition`](#structuredefinition)

The modeled [StructureDefinition](#structuredefinition).

#### Throws

InvalidProfileError when the spec is malformed (missing `url`/`type`/element `path`, a bad
  cardinality, or a `max` below `min`).

#### Example

```ts
import { defineProfile, primitive, validateResource, parseResource } from "@cosyte/fhir";
const finalOnly = defineProfile({
  url: "http://example.org/StructureDefinition/final-observation",
  type: "Observation",
  differential: [{ path: "Observation.status", fixed: { type: "Code", value: primitive("final") } }],
});
const { resource } = parseResource('{"resourceType":"Observation","status":"preliminary"}');
validateResource(resource, { profiles: [finalOnly] }); // → one PROFILE_FIXED_MISMATCH
```

***

### diagnosticFor()

> **diagnosticFor**(`code`): `string`

The value-free diagnostic line for a code, the only text that reaches an `OperationOutcome`.

#### Parameters

##### code

[`ValidationCode`](#validationcode)

The validation code.

#### Returns

`string`

A description of the *kind* of problem, guaranteed free of any instance value.

#### Example

```ts
import { diagnosticFor } from "@cosyte/fhir";
diagnosticFor("CARDINALITY_MIN"); // "Required element is missing."
```

***

### droppedText()

> **droppedText**(`resource`, `path`): `string`[]

The locations where an XML document wrote **character data directly on a FHIR element**, which the
reader drops: a primitive's value travels in the `value` attribute (xml.html §2.6.1), so text
written as element content has no slot on the model. A deep walk of the whole resource, so text on
an element inside a backbone element or a contained resource is caught too.

**This layer reports these; it does not read them.** The dropped text is not kept anywhere, and
this location is the only thing that distinguishes such a position from an element the sender
genuinely wrote without a value. Without it `<status>entered-in-error</status>` reads back as an
ordinary absent `status` and the readout affirms over a retracted record. Reporting is deliberately
the entire remedy: reading the text as the element's value would be a **tolerance for a
non-conformant encoding**, a decision about what this reader accepts, which is a much larger change
than declining to affirm.

Empty for every conformant document, and for every document read from JSON, which has no
character-data channel.

#### Parameters

##### resource

[`FhirComplex`](#fhircomplex)

The resource model.

##### path

`string`

The FHIRPath prefix for the resource root (usually its `resourceType`).

#### Returns

`string`[]

The locations of the dropped text, in walk order, each location once however many marked
  nodes sit at it, on the same reasoning as [nestedArrays](#nestedarrays-1).

#### Example

```ts
import { droppedText, parseResourceXml } from "@cosyte/fhir";
const { resource } = parseResourceXml(
  '<Observation xmlns="http://hl7.org/fhir"><status>entered-in-error</status></Observation>',
);
droppedText(resource, "Observation"); // ["Observation.status"]
```

***

### duplicateProperty()

> **duplicateProperty**(`expression`): [`FhirIssue`](#fhirissue)

Build a [ISSUE\_CODES.DUPLICATE\_PROPERTY](#duplicate_property) issue at `expression`.

The location names the element, not the individual member: FHIRPath addresses elements, and a
repeated JSON name is not addressable, so both the surviving and the shadowed member report here.

#### Parameters

##### expression

`string`

#### Returns

[`FhirIssue`](#fhirissue)

#### Example

```ts
import { duplicateProperty } from "@cosyte/fhir";
const issue = duplicateProperty("Observation.status");
```

***

### entryProcessing()

> **entryProcessing**(`type`): [`EntryProcessing`](#entryprocessing)

The entry-processing semantics for a `Bundle.type` (bundle.html). This is the all-or-nothing
(`transaction`) vs independent (`batch`) distinction, modeled explicitly so a caller never has to
re-derive it, and never conflates the two.

#### Parameters

##### type

`string` \| `undefined`

The `Bundle.type` code (or any string; unknown types are `"none"`).

#### Returns

[`EntryProcessing`](#entryprocessing)

`"atomic"` for `transaction`, `"independent"` for `batch`, `"none"` otherwise.

#### Example

```ts
import { entryProcessing } from "@cosyte/fhir";
entryProcessing("transaction"); // "atomic"     , all-or-nothing
entryProcessing("batch");       // "independent", entries stand alone
entryProcessing("searchset");   // "none"       , not a processing request
```

***

### evaluateInvariant()

> **evaluateInvariant**(`expression`, `focus`, `resource`): [`InvariantResult`](#invariantresult)

Evaluate one FHIRPath invariant `expression` against a focus node.

The result is judged by [convertToBoolean](#converttoboolean) (empty → not satisfied), matching the reference
validator's coercion. **Fail-safe:** any [UnsupportedFhirPathError](#unsupportedfhirpatherror), or any other evaluation
error, yields `{ unchecked: true, satisfied: false }`; the engine never reports a constraint
*satisfied* on a failure, so an unevaluable expression is surfaced as unchecked, never a false pass.

#### Parameters

##### expression

`string`

The FHIRPath constraint expression (e.g. `dataAbsentReason.empty() or value.empty()`).

##### focus

[`FhirComplex`](#fhircomplex)

The node the constraint is anchored to (the resource, or an element occurrence).

##### resource

[`FhirNode`](#fhirnode)

The root resource, bound to `%resource` / `%rootResource` inside the expression.

#### Returns

[`InvariantResult`](#invariantresult)

The [InvariantResult](#invariantresult).

#### Example

```ts
import { evaluateInvariant, parseResource } from "@cosyte/fhir";
const { resource } = parseResource('{"resourceType":"Observation","valueString":"x","dataAbsentReason":{}}');
evaluateInvariant("dataAbsentReason.empty() or value.empty()", resource, resource);
// → { unchecked: false, satisfied: false }  (obs-6 violated: both present)
```

***

### generateSnapshot()

> **generateSnapshot**(`profile`, `resolve`, `seen?`): [`ElementDefinition`](#elementdefinition)[]

Generate the snapshot element list for a profile: the base resource's snapshot with the profile's
differential overlaid. When the profile already carries a snapshot it is returned as-is.

#### Parameters

##### profile

[`StructureDefinition`](#structuredefinition)

The profile (or base resource) StructureDefinition.

##### resolve

[`BaseResolver`](#baseresolver)

Resolver for `baseDefinition` canonical URLs (a base R4 SD carries its own snapshot).

##### seen?

`ReadonlySet`\<`string`\> = `...`

Internal cycle guard; omit at the top level.

#### Returns

[`ElementDefinition`](#elementdefinition)[]

The flattened, constraint-applied element list.

#### Throws

FhirProfileError when the base cannot be resolved, or a `baseDefinition` cycle is found.

#### Example

```ts
import { generateSnapshot } from "@cosyte/fhir";
// base carries a snapshot; profile carries only a differential tightening one element:
const snapshot = generateSnapshot(profile, (url) => (url === base.url ? base : undefined));
```

***

### getAllProperties()

> **getAllProperties**(`node`, `name`): readonly [`FhirNode`](#fhirnode)[]

Every top-level value written under `name`, in document order: the one in `properties` followed by
any that a repeated name shadowed. Returns one element for a conformant document, none when the
property is absent, and more than one only for a document that broke FHIR's unique-name rule.

This is the fail-safe read. A check that must not miss a value the sender wrote (a retraction, a
negation) runs over all of them; a convenience read that only needs one uses [getProperty](#getproperty).

#### Parameters

##### node

[`FhirComplex`](#fhircomplex)

##### name

`string`

#### Returns

readonly [`FhirNode`](#fhirnode)[]

#### Example

```ts
import { getAllProperties, parseResource } from "@cosyte/fhir";
const { resource } = parseResource('{"resourceType":"Observation","status":"final","status":"entered-in-error"}');
getAllProperties(resource, "status").length; // 2, both values are readable
```

***

### getProperty()

> **getProperty**(`node`, `name`): [`FhirNode`](#fhirnode) \| `undefined`

Look up a top-level property on a complex node by name, returning the first match. Returns
`undefined` when absent.

FHIR JSON requires property names to be unique, so on a conformant document there is exactly one
match. On a document that repeats a name this returns the **first** one written and ignores the
rest; use [getAllProperties](#getallproperties) wherever reading only one of several written values would be
unsafe.

#### Parameters

##### node

[`FhirComplex`](#fhircomplex)

##### name

`string`

#### Returns

[`FhirNode`](#fhirnode) \| `undefined`

#### Example

```ts
import { getProperty, parseResource } from "@cosyte/fhir";
const { resource } = parseResource('{"resourceType":"Patient","active":true}');
getProperty(resource, "active"); // the `active` primitive node
```

***

### hasCodeAnySystem()

> **hasCodeAnySystem**(`node`, `code`): `boolean`

Whether a `CodeableConcept` node carries the given `code` under **any** system (fail-safe read).

#### Parameters

##### node

[`FhirNode`](#fhirnode) \| `undefined`

A `CodeableConcept` node (or list), or `undefined`.

##### code

`string`

The code to match, regardless of system.

#### Returns

`boolean`

`true` when any coding carries that code.

#### Example

```ts
import { ENTERED_IN_ERROR, getProperty, hasCodeAnySystem, parseResource } from "@cosyte/fhir";
const { resource } = parseResource(
  '{"resourceType":"Condition","verificationStatus":{"coding":[{"code":"entered-in-error"}]}}',
);
hasCodeAnySystem(getProperty(resource, "verificationStatus"), ENTERED_IN_ERROR); // true
```

***

### hasCoding()

> **hasCoding**(`node`, `system`, `code`): `boolean`

Whether a `CodeableConcept` node carries the given `(system, code)` coding exactly.

#### Parameters

##### node

[`FhirNode`](#fhirnode) \| `undefined`

A `CodeableConcept` node (or list), or `undefined`.

##### system

`string`

The code system URI to match.

##### code

`string`

The code to match.

#### Returns

`boolean`

`true` when a coding with that exact system and code is present.

#### Example

```ts
import { getProperty, hasCoding, parseResource, SNOMED_SCT } from "@cosyte/fhir";
const { resource } = parseResource(
  '{"resourceType":"AllergyIntolerance","code":{"coding":[{"system":"http://snomed.info/sct","code":"716186003"}]}}',
);
hasCoding(getProperty(resource, "code"), SNOMED_SCT, "716186003"); // true
```

***

### hasContainedCycle()

> **hasContainedCycle**(`resource`): `boolean`

Whether a resource's `contained` resources reference each other (or the root) in a **cycle**.

Builds the fragment graph, one node per contained resource id plus the root (`""`), an edge for
each `#fragment` reference, and runs an iterative three-color DFS. Because the DFS is heap-based
(not recursive) and marks visited nodes, it **always terminates**: a cycle is reported, never
followed. This is the DoS guard: a reference cycle becomes a typed
`CONTAINED_CYCLE` finding, never an infinite loop or a stack overflow.

#### Parameters

##### resource

[`FhirComplex`](#fhircomplex)

The resource whose `contained` set to check.

#### Returns

`boolean`

`true` when a containment cycle exists.

#### Example

```ts
import { parseResource, hasContainedCycle } from "@cosyte/fhir";
const { resource } = parseResource(
  '{"resourceType":"Observation","contained":[' +
    '{"resourceType":"Observation","id":"a","hasMember":[{"reference":"#b"}]},' +
    '{"resourceType":"Observation","id":"b","hasMember":[{"reference":"#a"}]}]}',
);
hasContainedCycle(resource); // true, a → b → a
```

***

### integer64()

> **integer64**(`raw`): [`FhirInteger64`](#fhirinteger64)

Construct a [FhirInteger64](#fhirinteger64) from its lexical text, validating both the signed-integer grammar
and the 64-bit range. Throws a `TypeError`/`RangeError` on anything else.

#### Parameters

##### raw

`string`

The exact integer literal, e.g. `"9223372036854775807"`, `"-42"`.

#### Returns

[`FhirInteger64`](#fhirinteger64)

#### Throws

TypeError when `raw` is not a signed-integer literal.

#### Throws

RangeError when `raw` is outside the signed 64-bit range.

#### Example

```ts
import { integer64 } from "@cosyte/fhir";
const n = integer64("-9223372036854775808"); // the 64-bit minimum, exact
```

***

### isAbsenceCode()

> **isAbsenceCode**(`value`): value is "error" \| "unknown" \| "asked-unknown" \| "temp-unknown" \| "not-asked" \| "asked-declined" \| "masked" \| "not-applicable" \| "unsupported" \| "as-text" \| "not-a-number" \| "negative-infinity" \| "positive-infinity" \| "not-performed" \| "not-permitted"

Whether a string is exactly one of the fifteen [ABSENCE\_CODES](#absence_codes).

The comparison is exact. A case or whitespace variant is **not** a member and is not made into
one: FHIR `code` is case-sensitive and its lexical space excludes surrounding whitespace, so
folding `"UNKNOWN"` in would accept a non-conformant document as conformant and author a reason
the sender did not spell.

#### Parameters

##### value

`string`

Any string.

#### Returns

value is "error" \| "unknown" \| "asked-unknown" \| "temp-unknown" \| "not-asked" \| "asked-declined" \| "masked" \| "not-applicable" \| "unsupported" \| "as-text" \| "not-a-number" \| "negative-infinity" \| "positive-infinity" \| "not-performed" \| "not-permitted"

`true` when the string is a member of the value set.

#### Example

```ts
import { isAbsenceCode } from "@cosyte/fhir";
isAbsenceCode("not-performed"); // true
isAbsenceCode("UNKNOWN");       // false, never coerced
```

***

### isAtomicBundle()

> **isAtomicBundle**(`type`): `boolean`

Whether a `Bundle.type` is applied **all-or-nothing** (a `transaction`). The inverse of "entries are
independent"; a convenience over [entryProcessing](#entryprocessing-1).

#### Parameters

##### type

`string` \| `undefined`

#### Returns

`boolean`

#### Example

```ts
import { isAtomicBundle } from "@cosyte/fhir";
isAtomicBundle("transaction"); // true
isAtomicBundle("batch");       // false
```

***

### isChoice()

> **isChoice**(`element`): `boolean`

Whether an element is a `choice[x]` (more than one allowed datatype).

#### Parameters

##### element

[`ElementSchema`](#elementschema)

An element schema.

#### Returns

`boolean`

`true` when the element allows more than one datatype.

#### Example

```ts
import { isChoice } from "@cosyte/fhir";
isChoice({ min: 0, max: 1, types: ["boolean", "dateTime"] }); // true
```

***

### isComplex()

> **isComplex**(`node`): `node is FhirComplex`

Whether `node` is a [FhirComplex](#fhircomplex).

#### Parameters

##### node

[`FhirNode`](#fhirnode)

#### Returns

`node is FhirComplex`

#### Example

```ts
import { complex, isComplex } from "@cosyte/fhir";
isComplex(complex([])); // true
```

***

### isDroppedText()

> **isDroppedText**(`node`): `boolean`

Whether the XML document wrote **character data directly on this element**, content a FHIR element
has no slot for and the reader therefore drops.

A primitive's value travels in the `value` attribute (xml.html §2.6.1: "values of primitive types
in a `value` attribute"), so `<status>entered-in-error</status>` is not a `status` this library can
read: the attribute is absent, the model's `value` is `undefined`, and the node is then
indistinguishable from an element the sender legitimately wrote without one. That is the harm this
marker exists to make reportable. The safety readout collects these locations
(`droppedText`), refuses to summarize, and the validator raises an error.

The text is **not** kept and **not** interpreted. Reading it as the element's value would be a
tolerance for a non-conformant encoding, a separate decision from declining to affirm over it.

Always `false` for a document read from JSON, which has no character-data channel, and for every
conformant XML document.

#### Parameters

##### node

[`FhirNode`](#fhirnode)

Any model node.

#### Returns

`boolean`

`true` when the reader dropped character data at this node's position.

#### Example

```ts
import { getProperty, isDroppedText, parseResourceXml } from "@cosyte/fhir";
const { resource } = parseResourceXml(
  '<Observation xmlns="http://hl7.org/fhir"><status>entered-in-error</status></Observation>',
);
isDroppedText(getProperty(resource, "status")!); // true
```

***

### isForeignRoot()

> **isForeignRoot**(`node`): `boolean`

Whether the XML document's **root** element resolved to a vocabulary other than FHIR's: a vendor
namespace reached by a default declaration or by a bound prefix.

The reader models such a root as the FHIR resource its local name spells and reports the position,
because it is schema-free and lenient and the local name is the only thing it has to go on. That
report is a warning in the issue list and the model carries no issue list, so before this marker
existed a caller could write the model back to XML and get a document in the FHIR namespace whose
re-read said nothing at all: one round trip and a vendor document was indistinguishable from FHIR.
../xml/write.js serializeResourceXml refuses a marked model rather than emit that.

**The namespace itself is NOT kept**, which is the difference between this and recovering the
vocabulary. The document's own namespace URI is content, and a marker cannot leak content.

`false` for a root that declares no namespace (read as FHIR on purpose), for a root whose prefix
resolves to nothing (modeled under its verbatim tag, and refused by the XML writer at its tag
sites rather than through this marker), for
foreign content below a root, for every document read from JSON, and for every conformant document.

#### Parameters

##### node

[`FhirNode`](#fhirnode)

Any model node.

#### Returns

`boolean`

`true` when this node is a root the XML reader read out of another vocabulary.

#### Example

```ts
import { isForeignRoot, parseResourceXml } from "@cosyte/fhir";
const { resource } = parseResourceXml('<Observation xmlns="urn:vendor"><id value="o1"/></Observation>');
isForeignRoot(resource); // true
```

***

### isKnownSystem()

> **isKnownSystem**(`system`): `boolean`

Whether a code-`system` URI is in the frozen [KNOWN\_SYSTEMS](#known_systems) registry. An **unknown** system
is not an error, it may be a legitimate local/proprietary system, it merely means the library
cannot reason about codes drawn from it (fail-safe).

#### Parameters

##### system

`string`

A code-system URI.

#### Returns

`boolean`

`true` when the URI is a recognized code system.

#### Example

```ts
import { isKnownSystem } from "@cosyte/fhir";
isKnownSystem("http://loinc.org");        // true
isKnownSystem("http://example.org/local"); // false, unknown, not invalid
```

***

### isList()

> **isList**(`node`): `node is FhirList`

Whether `node` is a [FhirList](#fhirlist).

#### Parameters

##### node

[`FhirNode`](#fhirnode)

#### Returns

`node is FhirList`

#### Example

```ts
import { isList, list } from "@cosyte/fhir";
isList(list([])); // true
```

***

### isNestedArray()

> **isNestedArray**(`node`): `boolean`

Whether `node` sits where the JSON document wrote an **array inside an array**, a shape FHIR JSON
gives no meaning at any position (json.html §2.6.2.2 uses an array for a repeating element and
nothing else, so no element is ever a list of lists).

The reader does not model what was inside that array **as FHIR**, so this node is the same empty
element it would be without the marker and no walker sees anything there. What the marker buys is
that the loss is **reportable**: a document carrying one must never come back with an affirmative
safety verdict computed as though nothing had been there. The safety readout collects these
locations (`nestedArrays`), refuses to summarize, and the validator raises an error.

The content itself is **kept** and is read with [nestedArrayContent](#nestedarraycontent-1). It
are deliberately not reachable through `properties`, `items` or `extension`: an array inside an
array has no FHIR meaning at any position, so there is no element for it to be, and placing one in
the tree would change what a repeating element contains for every consumer that walks one.

Always `false` for a document read from XML, which has no way to express the shape, and for every
conformant JSON document.

#### Parameters

##### node

[`FhirNode`](#fhirnode)

#### Returns

`boolean`

#### Example

```ts
import { isNestedArray, parseResource, getProperty, isList } from "@cosyte/fhir";
const { resource } = parseResource('{"resourceType":"Patient","name":[[{"family":"Roe"}]]}');
const name = getProperty(resource, "name");
isList(name!) && isNestedArray(name.items[0]!); // true
```

***

### isPrimitive()

> **isPrimitive**(`node`): `node is FhirPrimitive`

Whether `node` is a [FhirPrimitive](#fhirprimitive).

#### Parameters

##### node

[`FhirNode`](#fhirnode)

#### Returns

`node is FhirPrimitive`

#### Example

```ts
import { isPrimitive, primitive } from "@cosyte/fhir";
isPrimitive(primitive("x")); // true
```

***

### isPrimitiveType()

> **isPrimitiveType**(`name`): name is "string" \| "boolean" \| "integer" \| "integer64" \| "unsignedInt" \| "positiveInt" \| "decimal" \| "code" \| "markdown" \| "id" \| "uri" \| "url" \| "canonical" \| "oid" \| "uuid" \| "base64Binary" \| "instant" \| "date" \| "dateTime" \| "time"

Whether `name` is a known FHIR R4 primitive datatype.

#### Parameters

##### name

`string`

A datatype name.

#### Returns

name is "string" \| "boolean" \| "integer" \| "integer64" \| "unsignedInt" \| "positiveInt" \| "decimal" \| "code" \| "markdown" \| "id" \| "uri" \| "url" \| "canonical" \| "oid" \| "uuid" \| "base64Binary" \| "instant" \| "date" \| "dateTime" \| "time"

`true` for a primitive type name, `false` for a complex one.

#### Example

```ts
import { isPrimitiveType } from "@cosyte/fhir";
isPrimitiveType("date");      // true
isPrimitiveType("HumanName"); // false
```

***

### isRetracted()

> **isRetracted**(`resource`): `boolean`

Whether a resource is **retracted**, marked `entered-in-error` and therefore not to be treated as
active data. Read fail-safe: a `status` primitive of `entered-in-error` (Observation,
Immunization, DiagnosticReport, MedicationRequest/Statement) **or** a `verificationStatus` carrying
`entered-in-error` under any system (AllergyIntolerance, Condition). Over-surfacing a retraction is
safe; missing one is not.

"Fail-safe" is read across **every** value the document wrote for those elements, not just the one
a single-value lookup returns, and **through an array wrapper around the element**
(primitiveStrings). Three documents motivate that and they are one hazard: a `CodeableConcept`
legitimately carries several codings and the retraction may not be in the first; a non-conformant
document may write `status` twice and put the retraction in the one that lost; and a generic
XML-to-JSON converter wraps the `0..1` `status` in an array, where a single-value read finds no
string at all. Each ends the same way: reading one of several written values, or none, and
reporting the record as live.

That includes an array around a `Coding.system` / `Coding.code` *inside* a `CodeableConcept`, which
is the same converter shape one level down. It is read where the wrapper holds a single array
position, which is the only shape in which the value the sender wrote is recoverable without
inventing a `(system, code)` pair; a multi-position wrapper is reported rather than guessed at. See
[codingsOf](#codingsof).

**It answers about the resource it is handed, never about one nested inside it.** A `Bundle` whose
entry is retracted is not itself retracted, so this stays `false` there; the safety walk applies
this same read at every resource root and puts `entered-in-error` on `SafetyReadout.negations`
(./status.js `checkNegations`), which is the read that covers a whole document.

#### Parameters

##### resource

[`FhirComplex`](#fhircomplex)

The resource model.

#### Returns

`boolean`

`true` when the resource is marked entered-in-error.

#### Example

```ts
import { isRetracted, parseResource } from "@cosyte/fhir";
const { resource } = parseResource('{"resourceType":"Observation","status":"entered-in-error"}');
isRetracted(resource); // true
```

***

### isUndefinedNull()

> **isUndefinedNull**(`node`): `boolean`

Whether the JSON document wrote a bare `null` in this primitive's **value** channel at a position
FHIR JSON does not define one.

FHIR JSON defines `null` in one place only: as padding in a repeating primitive's value array, so
that the array lines up index-by-index with the `_`-sibling array carrying that occurrence's
`id`/`extension` (json.html §2.6.2.3). A `null` outside that array, or one whose slot carries no
such metadata, pads nothing,
and leaves an element with neither a value nor children, which R4 `ele-1` requires one of. This
marks those and only those, so a padding `null` in a conformant document is never marked.

The node is the same value-absent primitive it would be without the marker, and nothing is
preserved on it, because a `null` carries no content to preserve: it is a non-conformant encoding
of an absent value, not content the reader failed to read. That is why this marker does **not**
refuse a safety summary the way [isNestedArray](#isnestedarray) and [isDroppedText](#isdroppedtext) do, both of which
mark content the reader could not read at all. What it buys is that the writer hands the `null`
back rather than omitting the member, so re-reading the output reproduces the
../codec/issues.js ISSUE\_CODES.UNDEFINED\_JSON\_NULL finding instead of losing it.

Always `false` for a document read from XML, which has no `null`, and for every conformant JSON
document.

#### Parameters

##### node

[`FhirNode`](#fhirnode)

Any model node.

#### Returns

`boolean`

`true` when the document wrote an undefined `null` at this node's position.

#### Example

```ts
import { getProperty, isUndefinedNull, parseResource } from "@cosyte/fhir";
const { resource } = parseResource('{"resourceType":"Observation","status":null}');
isUndefinedNull(getProperty(resource, "status")!); // true
```

***

### list()

> **list**(`items`): [`FhirList`](#fhirlist)

Construct a [FhirList](#fhirlist) from ordered items.

#### Parameters

##### items

readonly [`FhirNode`](#fhirnode)[]

#### Returns

[`FhirList`](#fhirlist)

#### Example

```ts
import { list, primitive } from "@cosyte/fhir";
const given = list([primitive("Jane"), primitive("Q")]);
```

***

### loadStructureDefinition()

> **loadStructureDefinition**(`resource`): [`StructureDefinition`](#structuredefinition) \| `undefined`

Load a [StructureDefinition](#structuredefinition) out of a parsed FHIR `StructureDefinition` resource model.

Reads the identity, derivation, and the `differential` / `snapshot` element lists. Lenient: a field
the validator does not act on is ignored, and a malformed sub-node degrades to `undefined` rather
than throwing, a profile a consumer supplies is data, and data is read Postel-style.

#### Parameters

##### resource

[`FhirComplex`](#fhircomplex)

A `StructureDefinition` resource model (e.g. from `parseResource`).

#### Returns

[`StructureDefinition`](#structuredefinition) \| `undefined`

The modeled [StructureDefinition](#structuredefinition), or `undefined` when the resource is not one / lacks a `type`.

#### Example

```ts
import { parseResource } from "@cosyte/fhir";
import { loadStructureDefinition } from "@cosyte/fhir";
const { resource } = parseResource(usCoreAllergyProfileJson);
const sd = loadStructureDefinition(resource); // → { url, type: "AllergyIntolerance", differential, … }
```

***

### locateDoseQuantities()

> **locateDoseQuantities**(`resource`, `rt`): [`LocatedDoseQuantity`](#locateddosequantity)[]

Locate every `doseAndRate.doseQuantity` on a medication resource, with its FHIRPath location.
Returns `[]` for a non-medication resource or one carrying no dose quantity. Used by the validator
to UCUM-check dose units and by [readMedicationDoses](#readmedicationdoses) to surface them.

#### Parameters

##### resource

[`FhirComplex`](#fhircomplex)

The resource model.

##### rt

`string`

Its resolved `resourceType`.

#### Returns

[`LocatedDoseQuantity`](#locateddosequantity)[]

The located dose quantities, in document order.

#### Example

```ts
import { locateDoseQuantities, parseResource } from "@cosyte/fhir";
const { resource } = parseResource(
  '{"resourceType":"MedicationRequest","dosageInstruction":[{"doseAndRate":[{"doseQuantity":{"value":5,"code":"mg"}}]}]}',
);
locateDoseQuantities(resource, "MedicationRequest")[0]?.path;
// "MedicationRequest.dosageInstruction[0].doseAndRate[0].doseQuantity"
```

***

### matchesFixed()

> **matchesFixed**(`instance`, `fixed`): `boolean`

Whether an instance node **exactly equals** a `fixed[x]` value.

#### Parameters

##### instance

[`FhirNode`](#fhirnode) \| `undefined`

The instance node (or `undefined` when the element is absent).

##### fixed

[`FhirNode`](#fhirnode)

The profile's fixed value node.

#### Returns

`boolean`

`true` when the instance equals the fixed value exactly (same content, nothing extra).

#### Example

```ts
import { primitive } from "@cosyte/fhir";
import { matchesFixed } from "@cosyte/fhir";
matchesFixed(primitive("active"), primitive("active")); // true
matchesFixed(primitive("inactive"), primitive("active")); // false
```

***

### matchesPattern()

> **matchesPattern**(`instance`, `pattern`): `boolean`

Whether an instance node **matches** a `pattern[x]` value, contains at least the pattern's content.

#### Parameters

##### instance

[`FhirNode`](#fhirnode) \| `undefined`

The instance node (or `undefined` when the element is absent).

##### pattern

[`FhirNode`](#fhirnode)

The profile's pattern value node.

#### Returns

`boolean`

`true` when the instance contains every property/value the pattern names (extras allowed).

#### Example

```ts
import { complex, list, primitive } from "@cosyte/fhir";
import { matchesPattern } from "@cosyte/fhir";
const instance = complex([
  { name: "coding", value: list([complex([
    { name: "system", value: primitive("http://terminology.hl7.org/CodeSystem/observation-category") },
    { name: "code", value: primitive("vital-signs") },
    { name: "display", value: primitive("Vital Signs") },
  ])]) },
]);
const pattern = complex([
  { name: "coding", value: list([complex([{ name: "code", value: primitive("vital-signs") }])]) },
]);
matchesPattern(instance, pattern); // true, the extra system/display are allowed
```

***

### matchSlices()

> **matchSlices**(`instances`, `slices`, `discriminators`): [`SliceMatchResult`](#slicematchresult)

Assign each instance occurrence of a sliced element to a slice (or none), per the discriminators.

Returns `unchecked: true`, and no assignments the caller should act on, when membership cannot be
evaluated: an empty discriminator set, any discriminator of an unsupported type (`type`, `profile`,
R5 `position`, …), or any slice that declares no constraint at a discriminator path. The library
does **not** guess a slice assignment it cannot justify.

#### Parameters

##### instances

readonly [`FhirNode`](#fhirnode)[]

The instance occurrences of the sliced element, in order.

##### slices

readonly [`SliceDefinition`](#slicedefinition)[]

The resolved slice definitions.

##### discriminators

readonly `Discriminator`[]

The slicing's discriminators.

#### Returns

[`SliceMatchResult`](#slicematchresult)

The per-occurrence assignments and the `unchecked` flag.

#### Example

```ts
import { matchSlices } from "@cosyte/fhir";
const result = matchSlices(categoryOccurrences, slices, [{ type: "pattern", path: "$this" }]);
result.assignments; // e.g. ["VSCat", undefined]
```

***

### misplacedPrimitiveExtension()

> **misplacedPrimitiveExtension**(`expression`): [`FhirIssue`](#fhirissue)

Build a [ISSUE\_CODES.MISPLACED\_PRIMITIVE\_EXTENSION](#misplaced_primitive_extension) issue at `expression`.

The location is the element the `_`-sibling was written beside (`Patient.name`), because the
`_`-prefixed member itself is not addressable in FHIRPath.

#### Parameters

##### expression

`string`

#### Returns

[`FhirIssue`](#fhirissue)

#### Example

```ts
import { misplacedPrimitiveExtension } from "@cosyte/fhir";
const issue = misplacedPrimitiveExtension("Patient.name");
```

***

### mixedXmlSpelling()

> **mixedXmlSpelling**(`expression`): [`FhirIssue`](#fhirissue)

Build a [ISSUE\_CODES.MIXED\_XML\_SPELLING](#mixed_xml_spelling) issue at `expression` (XML reader only).

The location names the element whose occurrences did not all arrive under one expanded name,
raised once for that element rather than once per occurrence.

#### Parameters

##### expression

`string`

#### Returns

[`FhirIssue`](#fhirissue)

#### Example

```ts
import { mixedXmlSpelling } from "@cosyte/fhir";
const issue = mixedXmlSpelling("Observation.status");
```

***

### modifierElements()

> **modifierElements**(`resource`): [`ModifierElementReport`](#modifierelementreport)[]

Collect the modifier ELEMENTS a resource carries, a deep walk of the whole document, so one
nested in a backbone element, a contained resource or a Bundle entry is caught too. This is the
standalone form of [SafetyReadout.modifierElements](#modifierelements) and returns exactly what that channel
carries.

**It takes no `path`, unlike its siblings on this module, and that is deliberate.** A
modifier-element location may root at a resource type name only when the name is one this library
defines, so the root is derived here from the document's own type against that fixed set rather
than supplied by a caller who could root it at anything.

#### Parameters

##### resource

[`FhirComplex`](#fhircomplex)

The resource model.

#### Returns

[`ModifierElementReport`](#modifierelementreport)[]

The modifier elements present, in document order, one per distinct location.

#### Example

```ts
import { modifierElements, parseResource } from "@cosyte/fhir";
const { resource } = parseResource(
  '{"resourceType":"Observation","valueQuantity":{"value":0.01,"comparator":"<","unit":"mg"}}',
);
modifierElements(resource); // [{ element: "comparator", location: "Observation.valueQuantity.comparator" }]
```

***

### nearMissNegationCodes()

> **nearMissNegationCodes**(`resource`, `path`): `string`[]

The locations where a `code`-valued negation element carries a value that differs from a code this
layer classifies **only by letter case or by surrounding whitespace**, so the exact-string match
declined it and that negation was not classified.

`{"resourceType":"Procedure","status":"NOT-DONE"}` and `{"…","status":" not-done"}` are ordinary
output from a system whose codes are upper-cased, or from a fixed-width or CSV feed that padded a
field, and both are how a v2 or C-CDA extract reaches a FHIR surface. FHIR `code` is
case-sensitive and its lexical space has no room for surrounding whitespace
(`[^\s]+(\s[^\s]+)*`, datatypes.html), so neither value **is** the code, and this library does
not read either as one. **Nothing here coerces, trims or case-folds a value into a negation**:
that would accept a non-conformant document as though it were conformant and hand a caller an
assertion its sender never spelled. This is **the record that the value was there**, which is what
the read was missing: without it a procedure recorded as `"NOT-DONE"` returns `negations: []`
under `safeToSummarize: true`, indistinguishable from one that was carried out.

**A near miss is suppressed where the same element also spells that code exactly**, since the
negation is then classified and the caller has it. R4 permits translation codings beside the one
from a required binding's value set (terminologies.html), so a `verificationStatus` carrying
`refuted` from the standard system and `REFUTED` from a local one is **conformant** and draws
nothing. Suppressed per code, so a near miss of a *different* code there still reports.

**Value-free**: neither the text nor the code it resembles is carried, only the FHIRPath of the
element that held it.

**The elements are `status` and `verificationStatus`, at every resource root**, which is the
negation read's own window and the same window `unreadableBooleans` uses; the pairs come from the
table those matches are made from, so this cannot cover a pair the read does not.
`arrayWrappedScalars` reaches every root too, but only for the `Coding` members that same table
marks -- its element-level half stays on the cardinality table, so the two are **not** one window.
`AllergyIntolerance.code` is deliberately outside it (see
[SafetyReadout.nearMissNegationCodes](#nearmissnegationcodes)).

**Empty for every conformant document read from JSON, bar one admitted shape**: a translation
coding beside a required binding's own may differ from a negation code **only by case**, which R4
permits under the reading that only *one* coding SHALL come from the value set
(terminologies.html). Only the case half can be conformant, a surrounding-whitespace value being
outside `code`'s lexical space whatever coding carries it. Over-disclosure is the fail-safe
direction. In XML the whitespace half is a
further declared limit: R4 derives `code` from `xs:token` (fhir-base.xsd), whose
`whiteSpace=collapse` facet strips surrounding whitespace before validation, and this reader is
schema-free and does not collapse. See [SafetyReadout.nearMissNegationCodes](#nearmissnegationcodes).

#### Parameters

##### resource

[`FhirComplex`](#fhircomplex)

The resource model.

##### path

`string`

The FHIRPath prefix for the resource root (usually its `resourceType`).

#### Returns

`string`[]

The locations of the near-miss negation codes, in walk order.

#### Example

```ts
import { nearMissNegationCodes, parseResource } from "@cosyte/fhir";
const { resource } = parseResource('{"resourceType":"Procedure","status":"NOT-DONE"}');
nearMissNegationCodes(resource, "Procedure"); // ["Procedure.status"]
```

***

### nestedArray()

> **nestedArray**(`expression`): [`FhirIssue`](#fhirissue)

Build a [ISSUE\_CODES.NESTED\_ARRAY](#nested_array) issue at `expression`.

The location is the position the inner array occupied, so it indexes into the outer array
(`Patient.name[0]`, `Patient.name[0].given[1]`), which is as close as FHIRPath can get to a shape
FHIRPath cannot address.

#### Parameters

##### expression

`string`

#### Returns

[`FhirIssue`](#fhirissue)

#### Example

```ts
import { nestedArray } from "@cosyte/fhir";
const issue = nestedArray("Patient.name[0]");
```

***

### nestedArrayContent()

> **nestedArrayContent**(`node`): readonly [`NestedArrayContent`](#nestedarraycontent)[]

The arrays the sender wrote at this position that FHIR JSON gives no meaning to, each as JSON
text (see [NestedArrayContent](#nestedarraycontent) for what that text preserves). Empty for every conformant
document, and for every node the reader did not mark.

This is where the content of an array inside an array is preserved. It is **not** modeled as FHIR
and never will be: json.html §2.6.2.2 uses an array for a repeating element and for nothing else,
so an array inside one is not an element and has no place in the tree. Handing it back as the text
the sender wrote keeps it readable without redefining what a repeating element contains. Parse it
with `readRawJson` if you need its structure; the library will not decide what it meant.

A primitive can carry one in each of the two JSON channels (its value array and its `_`-sibling
array), so up to two entries come back, value channel first.

#### Parameters

##### node

[`FhirNode`](#fhirnode)

Any model node.

#### Returns

readonly [`NestedArrayContent`](#nestedarraycontent)[]

The preserved arrays, `[]` when the node carries none.

#### Example

```ts
import { getProperty, isList, nestedArrayContent, parseResource } from "@cosyte/fhir";
const { resource } = parseResource('{"resourceType":"Patient","name":[[{"family":"Roe"}]]}');
const name = getProperty(resource, "name");
isList(name!) && nestedArrayContent(name.items[0]!); // [{ channel: "value", json: '[{"family":"Roe"}]' }]
```

***

### nestedArrays()

> **nestedArrays**(`resource`, `path`): `string`[]

Collect the FHIRPath locations where the document wrote an **array inside an array**, a deep walk
of the whole resource.

FHIR JSON uses an array for one thing, a repeating element (json.html §2.6.2.2), so no element is
ever a list of lists and this shape has no meaning at any position. That is what makes this rule
different from the two above it and simpler than either: it needs **no cardinality table and no
element list**, because there is no position in a conformant document where it can fire.

**Scope: every node the model has.** Every element at every depth, a primitive's `extension`
metadata, a resource nested in `contained` or a Bundle entry, and a member a repeated property
name shadowed. It is bounded by what the reader modeled rather than by an element list, which is
the one qualification worth stating plainly: a `_`-sibling the reader discards *whole* as
misplaced or unrecognised (one sitting on an object or on a non-primitive array, or a member of a
`_`-sibling object that is neither an `id` **string** nor an `extension` array) leaves no node
behind, so an
array inside one is reported by the reader against the discarded sibling and is **not** refused
here. **Which warning the reader draws is per member, not one code for all three:** an
unrecognised member of a `_`-sibling object draws `UNKNOWN_PROPERTY`
(`{"birthDate":"1980-01-01","_birthDate":{"foo":[["x"]]}}`, at `Patient.birthDate.foo`), while a
`_`-sibling on an object or on a non-primitive array draws `MISPLACED_PRIMITIVE_EXTENSION` for the
misplaced sibling and nothing besides. Reaching it would mean reading raw JSON the codec does not
model.

**This layer reports these; it does not read them.** The codec does not model an inner array, so
whatever the sender wrote inside one is not recoverable here, and this location is the only thing
that distinguishes such a position from an element that really was empty on the wire. Without it a
refuted allergy, a resolved condition, or a whole retracted resource inside a Bundle entry reads
back as an ordinary absent element and the readout affirms `safeToSummarize` over content it never
saw. Reporting is deliberately the entire remedy: making the inner array readable would change
what a repeating element *contains* for every consumer that walks one, which is a much larger and
riskier change than declining to affirm.

Empty for every conformant document, and for every document read from XML, which has no way to
write the shape.

#### Parameters

##### resource

[`FhirComplex`](#fhircomplex)

The resource model.

##### path

`string`

The FHIRPath prefix for the resource root (usually its `resourceType`).

#### Returns

`string`[]

The locations of the nested arrays, in walk order (an element's own properties before any
  member a repeated name shadowed, which is not the document order that member had), each location
  once however many marked nodes sit at it. Two elements whose names are both withheld
  (../model/path.js) share a location and therefore collapse into one entry, on the same
  reasoning as a repeated name: a location nobody can address twice says nothing twice. The
  verdict does not move, `safeToSummarize` is `false` either way.

#### Example

```ts
import { nestedArrays, parseResource } from "@cosyte/fhir";
const { resource } = parseResource('{"resourceType":"Patient","name":[[{"family":"Roe"}]]}');
nestedArrays(resource, "Patient"); // ["Patient.name[0]"]
```

***

### nodesEquivalent()

> **nodesEquivalent**(`a`, `b`): `boolean`

Whether two model nodes are equivalent modulo primitive lexical form and singleton lists, the
definition of JSON↔XML model equivalence (see the module doc). Reflexive, symmetric, and transitive
over the schema-free model.

#### Parameters

##### a

[`FhirNode`](#fhirnode)

One node (e.g. the model parsed from JSON).

##### b

[`FhirNode`](#fhirnode)

The other node (e.g. the model parsed from the same resource in XML).

#### Returns

`boolean`

`true` when the two denote the same FHIR content.

#### Example

```ts
import { parseResource, parseResourceXml, nodesEquivalent } from "@cosyte/fhir";
const json = parseResource('{"resourceType":"Patient","active":true,"name":[{"given":["Jane"]}]}');
const xml = parseResourceXml(
  '<Patient xmlns="http://hl7.org/fhir"><active value="true"/><name><given value="Jane"/></name></Patient>',
);
nodesEquivalent(json.resource, xml.resource); // true
```

***

### parseFhirPath()

> **parseFhirPath**(`expression`): [`Expr`](#expr)

Parse a FHIRPath expression string into an [Expr](#expr) AST.

#### Parameters

##### expression

`string`

The FHIRPath source (e.g. an `ElementDefinition.constraint.expression`).

#### Returns

[`Expr`](#expr)

The parsed expression tree.

#### Throws

UnsupportedFhirPathError when the expression is malformed or uses a token the bounded subset
  does not recognise, the caller's fail-safe reports the invariant *unchecked*, never passed.

#### Example

```ts
import { parseFhirPath } from "@cosyte/fhir";
const ast = parseFhirPath("dataAbsentReason.empty() or value.empty()");
```

***

### parseNdjsonLine()

> **parseNdjsonLine**(`line`, `lineNumber?`): [`NdjsonRecord`](#ndjsonrecord)

Parse a single NDJSON line into a [NdjsonRecord](#ndjsonrecord), isolating any failure (never throws).

The one place read-time exceptions from [parseResource](#parseresource) are caught and turned into a
value-free per-line `error`, so a caller iterating lines by hand gets the same isolation the
streaming reader provides.

#### Parameters

##### line

`string`

The raw line text (without its trailing newline). A blank/whitespace-only line yields
  neither a resource nor an error, an empty record, so callers can skip it.

##### lineNumber?

`number` = `1`

The 1-based line number to stamp on the record. Defaults to 1.

#### Returns

[`NdjsonRecord`](#ndjsonrecord)

The [NdjsonRecord](#ndjsonrecord).

#### Example

```ts
import { parseNdjsonLine } from "@cosyte/fhir";
parseNdjsonLine('{"resourceType":"Patient","id":"1"}', 1).resource; // the Patient model
parseNdjsonLine("{ not json", 2).error?.code;                       // "MALFORMED_JSON"
```

***

### parseReference()

> **parseReference**(`raw`): [`ParsedReference`](#parsedreference)

Classify a `Reference.reference` string into its FHIR form and extract the resource
type / id / version where the form allows.

#### Parameters

##### raw

`string`

The reference string, e.g. `"Patient/123"`, `"#p1"`, `"https://ehr/fhir/Observation/9/_history/2"`,
  `"urn:uuid:…"`.

#### Returns

[`ParsedReference`](#parsedreference)

#### Example

```ts
import { parseReference } from "@cosyte/fhir";
parseReference("Patient/123");   // { kind: "relative", type: "Patient", id: "123", ... }
parseReference("#p1");           // { kind: "fragment", id: "p1", ... }
parseReference("urn:uuid:1-2-3"); // { kind: "logical", ... }
```

***

### parseResource()

> **parseResource**(`input`): [`ReadResult`](#readresult)

Read a FHIR resource from JSON text or an already-parsed [RawJson](#rawjson) tree into the immutable
model, gathering value-free issues. Throws [FhirCodecError](#fhircodecerror) on malformed JSON or broken
`_`-sibling alignment.

Strings of 13 or more characters are slices of the input text, so a parsed resource can keep the
parsed text in memory while it lives. Copy what you keep (for example with `structuredClone` or a
JSON round trip of the resource) or let the parsed result go.

#### Parameters

##### input

`string` \| [`RawJson`](#rawjson)

JSON text, or a [RawJson](#rawjson) tree from [readRawJson](#readrawjson).

#### Returns

[`ReadResult`](#readresult)

#### Throws

FhirCodecError (`MALFORMED_JSON`) when the input is not a JSON object.

#### Throws

FhirCodecError (`MAX_DEPTH_EXCEEDED`) when text input nests past the reader's depth bound.

#### Throws

FhirCodecError (`PRIMITIVE_EXTENSION_MISALIGNED`) when a value/`_`-sibling pair is misaligned.

#### Example

```ts
import { parseResource } from "@cosyte/fhir";
const { resource, issues } = parseResource('{"resourceType":"Observation","valueQuantity":{"value":0.010}}');
```

***

### parseResourceXml()

> **parseResourceXml**(`input`): [`ReadResult`](#readresult)

Read a FHIR resource from XML text (or an already-parsed [XmlElement](#xmlelement) tree) into the immutable
model, gathering value-free issues, the same [ReadResult](#readresult) the JSON ../codec/read.js parseResource returns. Throws ./issues.js FhirXmlError on malformed XML or a refused
DTD/entity (XXE / billion-laughs safe).

#### Parameters

##### input

`string` \| [`XmlElement`](#xmlelement)

XML text, or an [XmlElement](#xmlelement) tree from [readRawXml](#readrawxml).

#### Returns

[`ReadResult`](#readresult)

#### Example

```ts
import { parseResourceXml, serializeResource } from "@cosyte/fhir";
const { resource } = parseResourceXml(
  '<Patient xmlns="http://hl7.org/fhir"><active value="true"/></Patient>',
);
serializeResource(resource); // → '{"resourceType":"Patient","active":"true"}'
// XML carried `active` as attribute text, so it re-emits as a JSON string rather than `true`.
```

***

### pathExists()

> **pathExists**(`node`, `path`): `boolean`

Whether an element path selects at least one node on `node`, the `exists` primitive used by the
`exists` slicing discriminator and by cardinality checks.

#### Parameters

##### node

[`FhirNode`](#fhirnode)

The starting node.

##### path

`string`

A dotted element path relative to `node`.

#### Returns

`boolean`

`true` when the path selects one or more nodes.

#### Example

```ts
import { parseResource } from "@cosyte/fhir";
import { pathExists } from "@cosyte/fhir";
const { resource } = parseResource('{"resourceType":"Patient","deceasedBoolean":true}');
pathExists(resource, "deceased[x]"); // true
```

***

### primitive()

> **primitive**(`value`, `meta?`): [`FhirPrimitive`](#fhirprimitive)

Construct a [FhirPrimitive](#fhirprimitive). Omits absent optional keys (rather than setting them to
`undefined`) so the model satisfies `exactOptionalPropertyTypes` and equality stays structural.

#### Parameters

##### value

[`PrimitiveValue`](#primitivevalue) \| `undefined`

The scalar value, or `undefined` for a metadata-only (value-absent) primitive.

##### meta?

[`PrimitiveMeta`](#primitivemeta) = `{}`

Optional `id` / `extension`.

#### Returns

[`FhirPrimitive`](#fhirprimitive)

#### Example

```ts
import { primitive } from "@cosyte/fhir";
const given = primitive("Jacqueline");
```

***

### readBundle()

> **readBundle**(`bundle`): [`BundleReadout`](#bundlereadout)

Read a `Bundle` resource into a value-free [BundleReadout](#bundlereadout), its type, entry-processing
semantics, and one entry per `Bundle.entry`. Lenient: a Bundle with no `type` reads with
`type: undefined` / `processing: "none"`, and a malformed entry reads with empty fields rather than
throwing (Postel's Law, nothing is dropped, the shape is surfaced).

#### Parameters

##### bundle

[`FhirComplex`](#fhircomplex)

A `Bundle` resource model (typically from `parseResource`).

#### Returns

[`BundleReadout`](#bundlereadout)

The [BundleReadout](#bundlereadout). Nothing is executed, see the module doc.

#### Example

```ts
import { parseResource, readBundle } from "@cosyte/fhir";
const { resource } = parseResource(
  '{"resourceType":"Bundle","type":"transaction","entry":[' +
    '{"fullUrl":"urn:uuid:1","resource":{"resourceType":"Patient","id":"1"},' +
    '"request":{"method":"POST","url":"Patient"}}]}',
);
const bundle = readBundle(resource);
bundle.atomic;                 // true, a transaction is all-or-nothing
bundle.entries[0]?.fullUrl;    // "urn:uuid:1"
bundle.entries[0]?.requestMethod; // "POST"
```

***

### readInterpretations()

> **readInterpretations**(`observation`): [`Coded`](#coded)[]

Surface the `Observation.interpretation` codings (the abnormal flags, H/L/HH/LL/A/N…). Preserved
and exposed; never derived from a value and a reference range (this layer does not compute).

#### Parameters

##### observation

[`FhirComplex`](#fhircomplex)

An `Observation` complex node.

#### Returns

[`Coded`](#coded)[]

The interpretation codings across every `interpretation` CodeableConcept (`[]` when none).

#### Example

```ts
import { parseResource, readInterpretations } from "@cosyte/fhir";
const { resource } = parseResource(
  '{"resourceType":"Observation","interpretation":[{"coding":[{"code":"H"}]}]}',
);
readInterpretations(resource)[0]?.code; // "H"
```

***

### readMedicationDoses()

> **readMedicationDoses**(`resource`, `rt`): [`Quantity`](#quantity-1)[]

Surface every medication **dose `Quantity`** as a [Quantity](#quantity-1), the coded UCUM unit kept
distinct from the display string, the value an exact decimal. Reads `MedicationRequest`
(`dosageInstruction`) and `MedicationStatement` (`dosage`).

#### Parameters

##### resource

[`FhirComplex`](#fhircomplex)

The resource model.

##### rt

`string` \| `undefined`

#### Returns

[`Quantity`](#quantity-1)[]

The dose quantities in document order (`[]` when none / not a medication resource).

#### Example

```ts
import { parseResource, readMedicationDoses, resourceType } from "@cosyte/fhir";
const { resource } = parseResource(
  '{"resourceType":"MedicationRequest","dosageInstruction":[{"doseAndRate":[{"doseQuantity":{"value":5,"system":"http://unitsofmeasure.org","code":"mg"}}]}]}',
);
readMedicationDoses(resource, resourceType(resource))[0]?.code; // "mg"
```

***

### readObservationValue()

> **readObservationValue**(`node`): [`ObservationValue`](#observationvalue) \| `undefined`

Read the present `value[x]` variant off an Observation (or a `component`), typed by what is actually
there. Returns `undefined` when no `value[x]` is present (e.g. a `dataAbsentReason`-only
observation). When more than one variant is present, the first in FHIR's declared order is returned
and the rest are reported in [ObservationValue.ambiguous](#ambiguous).

#### Parameters

##### node

[`FhirComplex`](#fhircomplex)

An `Observation` or `component` complex node.

#### Returns

[`ObservationValue`](#observationvalue) \| `undefined`

The discriminated [ObservationValue](#observationvalue), or `undefined` when there is no value.

#### Example

```ts
import { parseResource, readObservationValue } from "@cosyte/fhir";
const { resource } = parseResource('{"resourceType":"Observation","valueString":"POSITIVE"}');
const v = readObservationValue(resource);
v?.type;     // "String", NOT a Quantity; reading it as a number would be wrong
v?.quantity; // undefined
```

***

### readQuantity()

> **readQuantity**(`node`): [`Quantity`](#quantity-1) \| `undefined`

Read a FHIR `Quantity` (or a specialization: `Age`, `Distance`, `Duration`, `Count`,
`SimpleQuantity`) into a [Quantity](#quantity-1), surfacing the coded unit distinct from the display unit.
Returns `undefined` for a node that is not a complex element.

#### Parameters

##### node

[`FhirNode`](#fhirnode) \| `undefined`

A `Quantity` node, or `undefined`.

#### Returns

[`Quantity`](#quantity-1) \| `undefined`

The [Quantity](#quantity-1), or `undefined` when the node is not a complex element.

#### Example

```ts
import { getProperty, parseResource, readQuantity } from "@cosyte/fhir";
const { resource } = parseResource(
  '{"resourceType":"Observation","valueQuantity":{"value":120,"unit":"mmHg","system":"http://unitsofmeasure.org","code":"mm[Hg]"}}',
);
const q = readQuantity(getProperty(resource, "valueQuantity"));
q?.code; // "mm[Hg]" , the machine unit, not the "mmHg" display string
```

***

### readRawJson()

> **readRawJson**(`src`): [`RawJson`](#rawjson)

Parse a JSON document into a [RawJson](#rawjson) tree that preserves number literals verbatim and
member order. Throws [FhirCodecError](#fhircodecerror) (`MALFORMED_JSON`) on invalid input, or
(`MAX_DEPTH_EXCEEDED`) when nesting passes the reader's fixed depth bound, both value-free, with a
`offset` and no snippet.

#### Parameters

##### src

`string`

The JSON text.

#### Returns

[`RawJson`](#rawjson)

#### Example

```ts
import { readRawJson } from "@cosyte/fhir";
const tree = readRawJson('{"v":0.010}');
// the number node carries raw === "0.010", the trailing zero is intact
```

***

### readRawXml()

> **readRawXml**(`src`): [`XmlElement`](#xmlelement)

Parse an XML document into a raw [XmlElement](#xmlelement) tree, preserving element/attribute order,
decoding the five predefined entities and numeric character references, and normalizing attribute
values as XML 1.0 §3.3.3 requires (a literal tab, line feed or carriage return becomes a space; a
character reference keeps the character it names). **Refuses** any DTD
(`DTD_FORBIDDEN`) or non-predefined entity (`UNDEFINED_ENTITY`), and bounds nesting depth, so it
is XXE- and billion-laughs-safe and never crashes on adversarial input. Throws
[FhirXmlError](#fhirxmlerror) on any refusal or well-formedness error, with an `offset` and no snippet.

#### Parameters

##### src

`string`

The XML text.

#### Returns

[`XmlElement`](#xmlelement)

#### Example

```ts
import { readRawXml } from "@cosyte/fhir";
const root = readRawXml('<Patient xmlns="http://hl7.org/fhir"><active value="true"/></Patient>');
root.name; // "Patient"
```

***

### readReferenceRanges()

> **readReferenceRanges**(`observation`): [`ObservationReferenceRange`](#observationreferencerange)[]

Surface every `Observation.referenceRange` entry, population-qualified bounds preserved as
[Quantity](#quantity-1)s, not evaluated. A reference range is meaningful only alongside its qualifiers
(`appliesTo`, `age`), which are preserved in the model; this reader exposes the bounds and type.

#### Parameters

##### observation

[`FhirComplex`](#fhircomplex)

An `Observation` complex node.

#### Returns

[`ObservationReferenceRange`](#observationreferencerange)[]

The reference ranges in document order (`[]` when none).

#### Example

```ts
import { parseResource, readReferenceRanges } from "@cosyte/fhir";
const { resource } = parseResource(
  '{"resourceType":"Observation","referenceRange":[{"low":{"value":70,"code":"mg/dL"}}]}',
);
readReferenceRanges(resource)[0]?.low?.code; // "mg/dL"
```

***

### readSafety()

> **readSafety**(`resource`): [`SafetyReadout`](#safetyreadout)

Read the safety-critical modifier / status / negation elements out of a resource, never dropping
one. The type-scoped slots are filled for the types `SAFETY_RESOURCE_TYPES` names; for any other
type they are `undefined` and only the un-gated reads apply, which are the retraction, the
refutation, `doNotPerform`, the `not-done` / `not-taken` status negations, and the
modifier-extension check. `noKnownAllergy` is the one negation that stays type-gated, because it
asserts something *positive* about a patient.

**The un-gated negation reads run at every resource root**, so a `contained` or `Bundle.entry`
resource's retraction, refutation, `not-done` / `not-taken` status or "do not perform" instruction
is classified on [SafetyReadout.negations](#negations), while the **single-valued** fields (`status`,
`retracted`, `doNotPerform`, `noKnownAllergy` and the rest) stay root reads. The readout's location
channels and `safeToSummarize` are document-wide too. Branch on `negations`
rather than on a single-valued field when the resource may carry others.

#### Parameters

##### resource

[`FhirComplex`](#fhircomplex)

The resource model (typically from `parseResource`).

#### Returns

[`SafetyReadout`](#safetyreadout)

The complete [SafetyReadout](#safetyreadout).

#### Example

```ts
import { parseResource, readSafety } from "@cosyte/fhir";
const { resource } = parseResource(
  '{"resourceType":"MedicationRequest","status":"active","doNotPerform":true,' +
    '"medicationCodeableConcept":{"text":"amoxicillin"}}',
);
const safety = readSafety(resource);
safety.doNotPerform;  // true
safety.negations;     // ["do-not-perform"]
```

***

### requiredVitalSignUnits()

> **requiredVitalSignUnits**(`loincCode`): readonly `string`[] \| `undefined`

The UCUM codes the vital-signs profile requires for a given LOINC code, or `undefined` when the
code is not a table-keyed vital sign (so no required-unit check applies).

#### Parameters

##### loincCode

`string`

A LOINC code (e.g. `"8480-6"`).

#### Returns

readonly `string`[] \| `undefined`

The allowed UCUM codes, or `undefined` when unlisted.

#### Example

```ts
import { requiredVitalSignUnits } from "@cosyte/fhir";
requiredVitalSignUnits("8480-6"); // ["mm[Hg]"]  (systolic blood pressure)
```

***

### resolveElement()

> **resolveElement**(`elements`, `property`): \{ `base`: `string`; `datatype`: `string`; `element`: [`ElementSchema`](#elementschema); \} \| `undefined`

Resolve an instance property name against a schema, honoring `choice[x]`. A plain element matches
by exact name; a choice element `deceased` (types `boolean | dateTime`) matches the instance
property `deceasedBoolean` or `deceasedDateTime`, returning which variant datatype was chosen.

#### Parameters

##### elements

`Readonly`\<`Record`\<`string`, [`ElementSchema`](#elementschema)\>\>

The resource's elements.

##### property

`string`

The instance property name.

#### Returns

\{ `base`: `string`; `datatype`: `string`; `element`: [`ElementSchema`](#elementschema); \} \| `undefined`

The matched element and (for a choice) the chosen datatype and the choice base name, or
  `undefined` when nothing matches.

#### Example

```ts
import { resolveElement } from "@cosyte/fhir";
const elements = { deceased: { min: 0, max: 1, types: ["boolean", "dateTime"] } };
resolveElement(elements, "deceasedBoolean")?.datatype; // "boolean"
```

***

### resolvePath()

> **resolvePath**(`node`, `path`): [`FhirNode`](#fhirnode)[]

Resolve an element path against a node, returning every node it selects (empty when nothing
matches). `$this` (or the empty path) selects the node itself. A `[x]` segment matches any concrete
choice variant (`value[x]` → `valueQuantity`, `valueString`, …). A repeating element the path
walks through is flattened, so `coding.code` on a `CodeableConcept` with three codings yields three
nodes. A repeating element in the last segment is not: it comes back as its list node
(`kind: "list"`, members on `items`), so `name` on a Patient with two names yields one node.
Flatten it with `isList(node) ? node.items : [node]`.

#### Parameters

##### node

[`FhirNode`](#fhirnode)

The starting node (a resource, a slice element instance, …).

##### path

`string`

A dotted element path relative to `node` (`""` / `"$this"` selects `node`).

#### Returns

[`FhirNode`](#fhirnode)[]

The selected nodes, in document order.

#### Example

```ts
import { parseResource } from "@cosyte/fhir";
import { resolvePath } from "@cosyte/fhir";
const { resource } = parseResource(
  '{"resourceType":"Observation","category":[{"coding":[{"code":"vital-signs"}]}]}',
);
resolvePath(resource, "category.coding.code"); // → [ the "vital-signs" primitive node ]
```

***

### resolveReference()

> **resolveReference**(`reference`, `options?`): [`ReferenceResolution`](#referenceresolution)

Resolve a single `Reference.reference` string against a Bundle and/or a `contained` closure.

Resolution is honest about its closure: a `#fragment` resolves only within `contained`; a relative
`Type/id` only within the Bundle. A local miss is `"unresolved"` (the caller flags it,
`REFERENCE_UNRESOLVED`, and preserves the reference). An absolute or logical reference that is not
in the Bundle is `"external"`, it points somewhere this library was never given, which is **not** a
defect, so it draws no finding.

#### Parameters

##### reference

`string`

The `Reference.reference` string.

##### options?

The closure: a [BundleIndex](#bundleindex) and/or a [ContainedIndex](#containedindex).

###### bundle?

[`BundleIndex`](#bundleindex)

###### contained?

[`ContainedIndex`](#containedindex)

#### Returns

[`ReferenceResolution`](#referenceresolution)

The [ReferenceResolution](#referenceresolution).

#### Example

```ts
import { resolveReference } from "@cosyte/fhir";
resolveReference("Patient/1", { bundle }).status;   // "resolved" | "unresolved"
resolveReference("#p1", { contained }).status;      // "resolved" | "unresolved"
resolveReference("https://other/fhir/Patient/9", {}).status; // "external"
```

***

### resolveSlices()

> **resolveSlices**(`snapshot`, `slicedElement`): [`SliceDefinition`](#slicedefinition)[]

Resolve the slices a sliced element introduces, reading each slice's constraints and existence
expectations from the snapshot (the slice element's own `fixed`/`pattern`, plus any descendant
element that carries one).

#### Parameters

##### snapshot

readonly [`ElementDefinition`](#elementdefinition)[]

The full snapshot element list.

##### slicedElement

[`ElementDefinition`](#elementdefinition)

The element carrying the `slicing` declaration.

#### Returns

[`SliceDefinition`](#slicedefinition)[]

The slice definitions, in snapshot order.

#### Example

```ts
import { resolveSlices } from "@cosyte/fhir";
// snapshot contains `Observation.category` (slicing) + `Observation.category:VSCat` (pattern):
const slices = resolveSlices(snapshot, categoryElement); // → [{ sliceName: "VSCat", … }]
```

***

### resourceType()

> **resourceType**(`node`): `string` \| `undefined`

The `resourceType` of a complex node, if it carries one as a string primitive. FHIR allows
`resourceType` in any position on read; this reads it wherever it sits.

#### Parameters

##### node

[`FhirComplex`](#fhircomplex)

#### Returns

`string` \| `undefined`

#### Example

```ts
import { parseResource, resourceType } from "@cosyte/fhir";
const { resource } = parseResource('{"resourceType":"Patient","id":"1"}');
resourceType(resource); // "Patient"
```

***

### serializeResource()

> **serializeResource**(`node`): `string`

Serialize a resource (or any [FhirComplex](#fhircomplex)) to compact FHIR JSON text: spec-clean for any
model FHIR can express, and faithful rather than spec-clean for the shapes it cannot (see the
module comment).

#### Parameters

##### node

[`FhirComplex`](#fhircomplex)

The resource model to serialize.

#### Returns

`string`

Compact JSON text, decimals byte-exact, primitive metadata split back into `_`-siblings
  with null-padded array alignment, and `resourceType` hoisted to the front where it is a string.
  A `resourceType` that is anything else keeps its position in the document rather than being
  dropped, and an array the sender wrote where FHIR gives an array no meaning, a scalar or
  `null` the sender wrote where FHIR has an object (a complex element's position, or a primitive's
  `_`-sibling), or a `null` the reader marked in a primitive's
  value channel, is written back as it was read, so such output is deliberately not spec-clean.

#### Throws

With `DROPPED_ELEMENT_TEXT` if the model carries a node the XML reader
  MARKED as having lost character data. JSON has no character-data channel, so the member would
  simply be absent and the finding would be lost across a round trip. Text the reader drops WITHOUT
  marking (character data that is `String.trim()`-empty) is not covered, because there is no marker.

#### Throws

With `UNSERIALIZABLE_SHADOWED_PROPERTY` if the model carries a member
  a repeated property name shadowed. This writer walks `properties` only, so
  `{"status":"final","status":"entered-in-error"}` came back as `{"status":"final"}`: the
  retraction absent, and `valid` and `safeToSummarize` both moved from `false` to `true`.
  `serializeResourceXml` drops it too, so **this refusal reaches both writers** and there is no
  route here that keeps the member. A repeated name inside a primitive's `_`-sibling is not
  modeled, and one inside a complex in a primitive's `extension` is outside the window; see
  `assertNoShadowedProperty` for both.

#### Example

```ts
import { parseResource, serializeResource } from "@cosyte/fhir";
const { resource } = parseResource(input);
const json = serializeResource(resource); // round-trips a spec-clean input byte-for-byte
```

***

### serializeResourceXml()

> **serializeResourceXml**(`node`): `string`

Serialize a resource (or any [FhirComplex](#fhircomplex)) to compact FHIR XML text, the exact
inverse of [parseResourceXml](#parseresourcexml) for a model read from a conformant document (**the summary
line said "spec-clean" unqualified and the section below has always contradicted it**). Decimals are emitted byte-exact (never through a `number`),
primitive metadata is co-located (`id` attribute + child `<extension>`s), repeating elements are
repeated, and the root carries the FHIR namespace.

**What this output is NOT guaranteed to be, stated rather than implied.** "Spec-clean" is a
claim about the FHIR structure, and the XML 1.0 grammar for a name and a
character is now held at every site this writer writes one: a tag name that is not a `Name`
(`<a&b/>`, `<1abc/>`) is refused rather than written, although it re-reads through
[parseResourceXml](#parseresourcexml) exactly as written, because a conforming third-party processor must
reject it; and a code point outside `Char` in an attribute value or a spliced `div` string is
refused, raw or as a reference (see the `@throws` below). A name carrying a **colon** is refused
on a code of its own, because the model carries no binding to declare. **What is still written,
each a declared residual rather than an oversight**:

- a `Name` that is not namespace-well-formed after `xml:` (`<xml:1abc/>`), since only the colon
  question reads the `xml:` prefix and it exempts that prefix;
- an element or attribute name inside a `div` string that is not a `Name` (`<p>` spelled `<1p>`):
  the string is asked the `Char` question, never the `Name` question, which is asked at tag
  positions only;
- the three `div` counterexamples below, none of them a name or a character matter.

The reader is unchanged and still reads `<1abc>` and `<a&b>` back, and `validateResource` still
returns `valid: true` for a `string` carrying U+0000; both are separate surfaces.

**The `div` branch, which writes markup rather than a name.** A `div` property is written
back as its own raw string, so what that string spells is markup in
the output. `emitsOneDivElement` is checked at that branch before the string is spliced in, and
the string is written only when it parses as exactly one element whose local name is `div`; a
string that fails raises `UNSERIALIZABLE_DIV_MARKUP` below. A string that passes is written only
when every prefix its markup names is bound by a declaration inside it (`bindsEveryPrefix`); one
that is not raises `UNSERIALIZABLE_DIV_PREFIX` below. A string that passes both is written only
when it carries no code point outside XML 1.0 `Char`, neither raw nor denoted by a numeric
character reference its parse decoded, each reference judged on its own; one that does raises
`UNSERIALIZABLE_XML_CHARACTER` below, and a reference inside a comment, which is never decoded, is
not one. The shape the first
check exists for is
`<div xmlns="…xhtml">ok</div></text><code><coding>…716186003…</coding></code><text>` on an
`AllergyIntolerance`: it used to be spliced in whole, and the emitted document re-read with
`noKnownAllergy: true` and a `no-known-allergy` negation over a record that had asserted nothing,
with no diagnostic at either end and `readSafety` affirming it.

**What passing the three checks does and does not settle, by example rather than by rule.** A
string they accept contributes one element, that element is the `div`, every prefix its markup
names is bound inside it, and every character it spells or denotes is a `Char`; it is not a claim
that the round trip is lossless or that the output is well-formed from there. A comment beside the root (`<!--c--><div …/>`) is accepted and does not
survive the re-read. `emitsOneDivElement` carries three more counterexamples, each `PRE-EXISTING`
and each asserted rather than argued: a depth bound this check spends from a different starting
depth than the re-read, an inserted namespace declaration, and an XML declaration a conformant
third-party parser rejects.

#### Parameters

##### node

[`FhirComplex`](#fhircomplex)

The resource model to serialize (must carry a `resourceType` to name the root element).

#### Returns

`string`

Canonical FHIR XML text.

#### Throws

With `DROPPED_ELEMENT_TEXT` if the model carries a node the reader
  MARKED as having lost character data. There is no conformant XML for it (§2.6.1: an element
  present in the resource SHALL have a value attribute, child elements, or extensions), and
  emitting the element as unfilled would lose the `DROPPED_ELEMENT_TEXT` finding across a round
  trip. Text the reader drops WITHOUT marking (character data that is `String.trim()`-empty) is
  not covered, because there is no marker.

#### Throws

With `UNSERIALIZABLE_ELEMENT_NAME` if any tag position holds a name
  that cannot be written as a tag without changing which elements the document holds: it would
  either fail to re-read at all, or re-read as DIFFERENT elements. The second is why this refuses
  rather than reports. [serializeResource](#serializeresource) escapes a member name, so this refusal never
  reaches it and that route stays open (which is not the same as saying the JSON output is
  spec-clean: [serializeResource](#serializeresource)'s own exception list still applies to the rest of the
  model).

#### Throws

With `UNSERIALIZABLE_DIV_MARKUP` if a `div` property carries a string
  that would not be spliced in as the one `div` element the property names. It would carry other
  elements into the document, or leave markup that does not re-read. Refused rather than repaired
  for the same reason as a name: escaping it would author a text node where the sender wrote
  markup, and splicing it authors elements the sender never wrote. [serializeResource](#serializeresource)
  carries the string as a string, so this refusal never reaches it and that route stays open.

#### Throws

With `UNSERIALIZABLE_JSON_ONLY_SHAPE` if the model carries a shape the
  JSON reader marked at a position FHIR JSON gives no meaning to: an array inside an array, a
  scalar or `null` where FHIR JSON has an object (a complex element's position or a primitive's
  `_`-sibling), or a `null` in a primitive's value channel that padded nothing. XML has no array of
  arrays, no `_`-sibling and no `null`, so this writer emitted the empty element the reader was
  left holding and the finding was gone on the next read; `{"value":null,"unit":"mg"}` came back as
  a `Quantity` carrying a unit and no magnitude under an empty issue list. This refusal does not
  reach [serializeResource](#serializeresource), which writes these back from the text the reader preserved at
  every position that writer walks; **it does not walk a member a repeated property name shadowed,
  and this refusal does reach one**, so that is the refusal's limit and not a route the shape
  always survives. The text handed back is value-exact, **not byte-exact**. **Only a model read
  from JSON reaches this**: XML cannot write any of those shapes, so a document read from XML
  carries none of the markers.

#### Throws

With `UNSERIALIZABLE_ARRAY_WRAPPER` if the model carries an array
  wrapper around a `0..1` element, at a location this library already reports as
  `ARRAY_WRAPPED_SCALAR`, that XML has no repeated element to spell back: one holding fewer than
  two items, or any wrapper on `resourceType`, where the type is the tag and a tag cannot be
  repeated. `{"resourceType":"Observation","status":["entered-in-error"]}` used to come back as
  `<status value="entered-in-error"/>` and re-read with an empty issue list, moving `valid` and
  `safeToSummarize` both from `false` to `true`. **A wrapper of two or more items elsewhere is left
  alone rather than refused**, because a model read from JSON writes it as repeated elements that
  re-read as a list. **That is a statement about a model a reader produced, not about every
  `FhirComplex` this accepts**, and the difference is reachable: a hand-built
  `list([list([]), list([])])` at `Observation.status` counts two items here and emits **no**
  element, so it launders exactly as an empty wrapper does. Neither reader builds one: every list
  the JSON reader constructs holds primitives or complexes, never lists (a nested array is marked
  at the item, and which of the two it is depends on the spelling), and XML has no such shape.
  [serializeResource](#serializeresource) writes the wrapper back, so this refusal does not reach
  it. See `assertXmlArrayWrapper` for the window this is scoped to and what it does not cover.

#### Throws

With `UNSERIALIZABLE_SHADOWED_PROPERTY` if the model carries a member
  a repeated property name shadowed. This writer walks `properties` only, so
  `{"status":"final","status":"entered-in-error"}` came back as `<status value="final"/>`: the
  retraction absent, and `valid` and `safeToSummarize` both moved from `false` to `true`. This
  refusal also reaches [serializeResource](#serializeresource), because that writer drops the
  member too and there is no route that keeps it. XML *can* repeat an element, but two repeated
  elements re-read as a list, which is a repeating element the sender never wrote. See
  `assertNoShadowedProperty` for the window and for the two positions it leaves.

#### Throws

With `UNSERIALIZABLE_RESOURCE_TYPE` if the first `resourceType` an
  element wrote is not a string -- the one `resourceTypeOf` reads, since it is a `find`. FHIR XML
  has no `resourceType` element -- the type IS the tag -- so this writer skips that property at
  every element, and with no string to name the tag the root fell back to `Resource`:
  `{"resourceType":{"modifierExtension":[{"url":"http://example.org/x"}]},"status":"final"}` came
  back as `<Resource xmlns="http://hl7.org/fhir"><status value="final"/></Resource>`, moving
  `valid` and `safeToSummarize` both from `false` to `true` and taking the modifier extension with
  it. An element with **no** `resourceType` is untouched and still named `Resource` by the fallback
  above, and one whose first is a string keeps its tag and is left to the repeated-property-name
  case. `serializeResource` emits a non-string `resourceType` through its
  ordinary path, so this refusal does not reach it. See `assertXmlResourceType` for the window,
  which reaches every depth, and for the bound that holds only at the root.

#### Throws

With `UNSERIALIZABLE_FOREIGN_ROOT` if the model holds a resource whose
  root the XML reader read out of a vocabulary that resolved to something other than FHIR's, by a
  default declaration or by a bound prefix. FHIR XML puts the resource in the FHIR namespace and
  this writer has no vendor binding to write instead, so
  `<v:Observation xmlns:v="urn:vendor"><v:status value="entered-in-error"/>…</v:Observation>` came
  back as `<Observation xmlns="http://hl7.org/fhir">…</Observation>` whose re-read carried an
  **empty** issue list: the one warning saying the document came from elsewhere was gone after a
  single trip. **Unlike most of the refusals above it this one withdraws a round trip from a
  document that reads `valid: true`**, because the root flag is a warning; the cost is bounded to
  this class. A root declaring no namespace at all is untouched, and one carrying a prefix bound to
  nothing is outside it too, refused on `UNSERIALIZABLE_PREFIXED_NAME` below rather than on this
  code. `serializeResource` emits the model exactly as it always did, so this refusal does not
  reach it -- a statement about that writer's output, not a claim that the JSON channel keeps the
  flag. See `assertXmlForeignRoot` for the window and for the route not taken.

#### Throws

With `UNSERIALIZABLE_CHOICE_WRAPPER` if the model carries an array
  wrapper around an `Observation.value[x]` choice, at a location this library already reports as
  `ARRAY_WRAPPED_CHOICE`, that XML has no repeated element to spell back: one holding fewer than
  two items. `{"resourceType":"Observation","status":"final","valueQuantity":[{"value":5,
  "system":"http://unitsofmeasure.org","code":"mg"}]}` reads with the encoding reported and no
  magnitude handed out, and used to come back as `<valueQuantity><value value="5"/>…` re-reading
  as an unambiguous 5 mg under an empty issue list: a **dose** a format change made confident. **A
  wrapper of two or more items is left alone rather than refused**, because it writes as repeated
  elements that re-read as a list and the location is reported again. Scoped to `value[x]` and
  `component.value[x]`, `0..1` in R4, at every Observation resource root; the window is the value
  layer's own rather than a second cardinality table. [serializeResource](#serializeresource) writes the wrapper
  back, so this refusal does not reach it. See `assertXmlValueChoiceWrapper`.

#### Throws

With `UNSERIALIZABLE_PREFIXED_NAME` if any tag position holds a name
  carrying a colon, other than `xml:` followed by a local part with no colon in it. XML reads the
  colon as a namespace prefix and the model carries no binding for this writer to declare one
  with, so it used to write the prefix bound to nothing: `<v:x value="1"/>`, `<:x/>`, `<a:b:c/>`,
  `<xmlns:x/>`, and a root read as `<v:Observation>` written back as
  `<v:Observation xmlns="http://hl7.org/fhir">`. A conformant parser rejects all of them, and a
  prefix rebound between siblings lost its `MIXED_XML_SPELLING` report across one write and one
  re-read. **It withdraws an XML write from models that read `valid: true`**, the cost the
  foreign-root refusal above already pays: a property named `p:x` reads with zero issues. Checked
  at every tag position, at every depth, including a resource composed into a `contained` or a
  `Bundle.entry.resource` after it was read. Raised after every refusal above, so a model carrying
  one of these names beside anything above keeps the code it already reported, and a name that
  both carries a colon and breaks the tag stays `UNSERIALIZABLE_ELEMENT_NAME`. **Not covered**: a
  name with no colon that is not an XML 1.0 `Name`, which is refused on
  `UNSERIALIZABLE_XML_NAME` below, not on this code; and the local part after `xml:`, which is
  not checked for namespace well-formedness, so `<xml:1abc/>` is still written. A `div` string
  whose own markup carries an unbound prefix is written by the `div` branch rather than at a tag
  position, so this refusal does not reach it either; that branch refuses it on
  `UNSERIALIZABLE_DIV_PREFIX`, below. [serializeResource](#serializeresource) spells a member name as a JSON
  string, so this refusal does not reach it and that route stays open.

#### Throws

With `UNSERIALIZABLE_DIV_PREFIX` if a `div` property carries a string
  that passes the `UNSERIALIZABLE_DIV_MARKUP` check above and whose markup names, on an element or
  on an attribute, a namespace prefix no declaration inside the string binds (`xml` is bound by
  definition, and an `xmlns` or `xmlns:p` attribute is a declaration, not a prefixed name). The
  branch splices the string in verbatim, so it used to write `<v:div>x</v:div>` into a document a
  conformant parser rejects, and this library's re-read of that document turned the narrative into
  a property named `v:div`, with no diagnostic at either end. An unbound prefix on an inner element
  or an attribute (`<div xmlns="…xhtml"><v:p>x</v:p></div>`) is refused as well: the line is
  namespace-well-formedness, the one the colon refusal above draws at the tag sites. **It withdraws
  an XML write from models that read `valid: true`**, and for an inner prefix from a model this
  library itself round-tripped, the cost that refusal already pays. A prefix a conformant document
  bound on an ANCESTOR of the `div` is not refused, because the reader writes that declaration into
  the string it hands back. Checked at the `div` branch at every depth, including a resource
  composed into a `contained` or a `Bundle.entry.resource` after it was read, and raised after
  every refusal above, so a model that also trips any of them keeps the code it already reported.
  The message and the locations carry neither the string nor its prefix. [serializeResource](#serializeresource)
  carries the string as a string, so this refusal does not reach it and that route stays open.

#### Throws

With `UNSERIALIZABLE_XML_NAME` if any tag position holds a name that
  is not an XML 1.0 `Name` (production [5]) and that neither breaks the tag nor carries a colon:
  `a&b`, `1abc`, `-x`, `.x`, `a"b`, a name beginning U+00B7, a name carrying U+0000 or an unpaired
  surrogate. Each used to be written verbatim, and this library's own reader read each back
  unchanged, which is why the tag-breaking line above never reached it; a conforming processor must
  reject every one. Checked at every tag position at every depth: a property name, a name inside
  `contained`, `Bundle.entry.resource` or an extension, a resource-valued element's wrapper, and a
  `resourceType` that names a root or a nested resource's tag, the last reported at the location of
  the element wrapping it. Every position once, in walk order; a refused name's own segment renders
  `WITHHELD`, and neither the message nor a location carries the name. **Refused, never repaired**:
  XML has no escape for a name. **It withdraws an XML write from models that read `valid: true`**,
  the cost the colon refusal above already pays: a JSON property named `1abc` reads with zero
  issues. Raised after every refusal above, so a model that trips any of them keeps the code it
  already reported. [serializeResource](#serializeresource) spells a member name as a JSON string, so this
  refusal does not reach it and that route stays open.

#### Throws

With `UNSERIALIZABLE_XML_CHARACTER` if a value this writer emits as an
  attribute value (a primitive's `value`, an `id` written as an attribute, an `Extension.url`) or
  a `div` string that passes both `div` checks above carries a code point outside XML 1.0 `Char`
  (production [2]): U+0000 to U+0008, U+000B, U+000C, U+000E to U+001F, an unpaired surrogate,
  U+FFFE or U+FFFF. In a `div` string a numeric character reference denoting one (`&#0;`,
  `&#x1F;`) counts as the raw character does, because the Legal Character constraint makes it as
  fatal; each reference is judged on its own, so two references to the halves of a surrogate pair
  (`&#xD83D;&#xDE00;`) are refused although they decode to one `Char`, while `&#x1F600;` is
  written. A reference inside a comment is never decoded and does not count. A U+0000 used to be
  written raw into its `value` attribute. **Refused, never repaired**: the character is not written raw,
  as a reference or replaced, and neither it nor its value is dropped, so the model is left as it
  was. The location is the value's (`Patient.gender`, `Patient.gender.id`,
  `Patient.extension[0].url`, `Patient.text.div`), every one once, in walk order; neither the
  message nor a location carries the value or the character. The discouraged code points `Char`
  still admits (U+007F to U+009F, U+FDD0 to U+FDEF) are written. Raised last of all, after
  `UNSERIALIZABLE_XML_NAME`, so a model that trips any refusal above keeps the code it already
  reported and a model carrying both a name that is not a `Name` and a character that is not a
  `Char` draws the name code. [serializeResource](#serializeresource) writes these values as JSON strings, so
  this refusal does not reach it and that route stays open.

#### Example

```ts
import { parseResource, serializeResourceXml } from "@cosyte/fhir";
const { resource } = parseResource('{"resourceType":"Patient","active":true}');
serializeResourceXml(resource);
// → '<Patient xmlns="http://hl7.org/fhir"><active value="true"/></Patient>'
```

***

### shadowedProperties()

> **shadowedProperties**(`resource`, `path`): `string`[]

Collect the FHIRPath locations where the document wrote a property name more than once, a deep
walk of the whole resource. FHIR JSON requires unique property names (json.html §2.6.2: "Property
names SHALL be unique") and expresses repetition with an array, so this is empty for every
conformant document; a non-empty result means an element carries several values and RFC 8259 §4
gives no rule for choosing between them.

The location names the element, not the individual member: FHIRPath has no way to address "the
second `status` member", so one object element reports its path once however many members shadowed
the name there. Two *different* objects that each repeat the same name still report separately, and
where those objects are themselves duplicates of each other the two locations read identically, for
the same reason: the path is all FHIRPath can say.

**Scope: object elements.** A repeated name inside a primitive's `_`-sibling (its R4 `Element`
metadata, which is `id` and `extension`, never `modifierExtension`) is reported by the reader as a
`DUPLICATE_PROPERTY` issue but does not appear here: nothing in that metadata feeds a safety
verdict, so it cannot make one wrong.

#### Parameters

##### resource

[`FhirComplex`](#fhircomplex)

The resource model.

##### path

`string`

The FHIRPath prefix for the resource root (usually its `resourceType`).

#### Returns

`string`[]

The locations of the shadowed members, in document order.

#### Example

```ts
import { parseResource, shadowedProperties } from "@cosyte/fhir";
const { resource } = parseResource(
  '{"resourceType":"Observation","status":"final","status":"entered-in-error"}',
);
shadowedProperties(resource, "Observation"); // ["Observation.status"]
```

***

### snapshotElements()

> **snapshotElements**(`profile`, `resolve?`): readonly [`ElementDefinition`](#elementdefinition)[]

The snapshot elements to validate against: the profile's own snapshot when present, else generated.
A convenience over [generateSnapshot](#generatesnapshot) that does not require a resolver when the profile is
already snapshotted (the common case for a published IG profile).

#### Parameters

##### profile

[`StructureDefinition`](#structuredefinition)

The profile StructureDefinition.

##### resolve?

[`BaseResolver`](#baseresolver) = `...`

A base resolver, needed only when the profile carries no snapshot.

#### Returns

readonly [`ElementDefinition`](#elementdefinition)[]

The snapshot element list.

#### Throws

FhirProfileError when generation is required but no (or an insufficient) resolver is given.

#### Example

```ts
import { snapshotElements } from "@cosyte/fhir";
const elements = snapshotElements(usCoreProfile); // uses the IG-supplied snapshot
```

***

### starterProfile()

> **starterProfile**(`url`): [`StructureDefinition`](#structuredefinition) \| `undefined`

Look up a starter profile by its canonical `url`.

#### Parameters

##### url

`string`

The canonical URL (see each profile's `url`, or [STARTER\_PROFILE\_BASE\_URL](#starter_profile_base_url)).

#### Returns

[`StructureDefinition`](#structuredefinition) \| `undefined`

The matching starter profile, or `undefined`.

#### Example

```ts
import { starterProfile, STARTER_PROFILE_BASE_URL } from "@cosyte/fhir";
const p = starterProfile(`${STARTER_PROFILE_BASE_URL}/starter-patient-identifier`);
```

***

### streamNdjson()

> **streamNdjson**(`source`, `options?`): `AsyncGenerator`\<[`NdjsonRecord`](#ndjsonrecord), `void`, `undefined`\>

Stream `application/fhir+ndjson`, yielding one [NdjsonRecord](#ndjsonrecord) per line as bytes arrive,
**without ever loading the whole file** and with **per-line error isolation**.

The source is any (async or sync) iterable of `string` or `Uint8Array` chunks: a Node `Readable`
(async-iterable), a web `ReadableStream` via `for await`, or a hand-rolled generator. Lines are
split on `\n` (a trailing `\r` is trimmed) as chunks flow; only the current partial line is held.
A blank line is skipped. A malformed line yields an `error` record and the stream continues; a line
that exceeds `maxLineBytes` before a newline yields a `LINE_TOO_LONG` record and is drained to the
next newline rather than buffered.

#### Parameters

##### source

`AsyncIterable`\<`string` \| `Uint8Array`\<`ArrayBufferLike`\>, `any`, `any`\> \| `Iterable`\<`string` \| `Uint8Array`\<`ArrayBufferLike`\>, `any`, `any`\>

An (async)iterable of UTF-8 text or byte chunks.

##### options?

[`NdjsonOptions`](#ndjsonoptions) = `{}`

[NdjsonOptions](#ndjsonoptions).

#### Returns

`AsyncGenerator`\<[`NdjsonRecord`](#ndjsonrecord), `void`, `undefined`\>

An async generator of [NdjsonRecord](#ndjsonrecord), one per non-blank line, in order.

#### Example

```ts
import { streamNdjson } from "@cosyte/fhir";
// e.g. a Node Readable from fs.createReadStream(path)
for await (const record of streamNdjson(readable)) {
  if (record.error) console.warn("bad line", record.error.line); // isolated, stream continues
  else handle(record.resource);
}
```

***

### tokenize()

> **tokenize**(`input`): [`Token`](#token)[]

Tokenise a FHIRPath expression into a flat [Token](#token) stream.

#### Parameters

##### input

`string`

The FHIRPath expression source.

#### Returns

[`Token`](#token)[]

The tokens, in order (no end-of-input sentinel, the parser tracks its own position).

#### Throws

UnsupportedFhirPathError on any character the bounded subset does not recognise, so an
  out-of-subset construct fails loudly rather than mis-lexing into a wrong parse.

#### Example

```ts
import { tokenize } from "@cosyte/fhir";
tokenize("clinicalStatus.exists()").map((t) => t.value); // ["clinicalStatus", ".", "exists", "(", ")"]
```

***

### toOperationOutcome()

> **toOperationOutcome**(`issues`): [`FhirComplex`](#fhircomplex)

Build an `OperationOutcome` resource model from validation issues.

The result is an immutable [FhirComplex](#fhircomplex); serialize it with `serializeResource` to get
spec-clean, **value-free** FHIR JSON. Safe to log or return to a caller, it contains locations and
coded reasons, never resource values.

#### Parameters

##### issues

readonly [`ValidationIssue`](#validationissue)[]

The validation findings (may be empty → an "all clear" outcome).

#### Returns

[`FhirComplex`](#fhircomplex)

The `OperationOutcome` as a model resource.

#### Example

```ts
import { validateResource, toOperationOutcome, serializeResource } from "@cosyte/fhir";
const { issues } = validateResource(resource);
const outcome = toOperationOutcome(issues);
serializeResource(outcome); // → {"resourceType":"OperationOutcome","issue":[…]}
```

***

### undefinedJsonNull()

> **undefinedJsonNull**(`expression`): [`FhirIssue`](#fhirissue)

Build a [ISSUE\_CODES.UNDEFINED\_JSON\_NULL](#undefined_json_null) issue at `expression`.

The location is the primitive slot the `null` occupied, so it indexes into a repeating element
(`Patient.name[0].given[1]`) where the `null` sat in an array, and names the element itself
(`Observation.status`) where it did not.

#### Parameters

##### expression

`string`

#### Returns

[`FhirIssue`](#fhirissue)

#### Example

```ts
import { undefinedJsonNull } from "@cosyte/fhir";
const issue = undefinedJsonNull("Observation.valueQuantity.value");
```

***

### unexpectedXmlContent()

> **unexpectedXmlContent**(`expression`): [`FhirIssue`](#fhirissue)

Build a [ISSUE\_CODES.UNEXPECTED\_XML\_CONTENT](#unexpected_xml_content) issue at `expression` (XML reader only).

#### Parameters

##### expression

`string`

#### Returns

[`FhirIssue`](#fhirissue)

#### Example

```ts
import { unexpectedXmlContent } from "@cosyte/fhir";
const issue = unexpectedXmlContent("Observation.status");
```

***

### unhandledModifierExtensions()

> **unhandledModifierExtensions**(`resource`, `path`): `string`[]

Collect the FHIRPath locations of every `modifierExtension` whose URL this library cannot honor,
a deep walk of the whole resource, so a modifier nested in a backbone element or a contained
resource is caught too.

#### Parameters

##### resource

[`FhirComplex`](#fhircomplex)

The resource model.

##### path

`string`

The FHIRPath prefix for the resource root (usually its `resourceType`).

#### Returns

`string`[]

The locations of unhandled `modifierExtension`s, in document order.

#### Example

```ts
import { parseResource, unhandledModifierExtensions } from "@cosyte/fhir";
const { resource } = parseResource(
  '{"resourceType":"Patient","modifierExtension":[{"url":"http://example.org/x"}]}',
);
unhandledModifierExtensions(resource, "Patient"); // ["Patient.modifierExtension[0]"]
```

***

### unknownProperty()

> **unknownProperty**(`expression`): [`FhirIssue`](#fhirissue)

Build a [ISSUE\_CODES.UNKNOWN\_PROPERTY](#unknown_property) issue at `expression`.

#### Parameters

##### expression

`string`

#### Returns

[`FhirIssue`](#fhirissue)

#### Example

```ts
import { unknownProperty } from "@cosyte/fhir";
const issue = unknownProperty("Patient.wibble");
```

***

### unreadableAbsenceMarkers()

> **unreadableAbsenceMarkers**(`resource`, `path`): `string`[]

The locations where an absence marker is present and its reason is not readable: the standalone
form of [SafetyReadout.unreadableAbsenceMarkers](#unreadableabsencemarkers).

Neither `unknown` nor "populated" is inferred at such an element. The extension's `value[x]` binds
to a closed fifteen-concept value set at required strength, so a code outside it is a code this
library will not read and will not author, and an element with no readable reason is still an
element the sender declared absent. Disclosing the refusal is the whole remedy.

#### Parameters

##### resource

[`FhirComplex`](#fhircomplex)

The resource model.

##### path

`string`

The FHIRPath prefix for the resource root (usually its `resourceType`).

#### Returns

`string`[]

The locations, in walk order, each once however many unreadable markers sit there.

#### Example

```ts
import { parseResource, unreadableAbsenceMarkers } from "@cosyte/fhir";
const { resource } = parseResource(
  '{"resourceType":"Observation","_status":{"extension":[{"url":' +
    '"http://hl7.org/fhir/StructureDefinition/data-absent-reason","valueCode":"UNKNOWN"}]}}',
);
unreadableAbsenceMarkers(resource, "Observation"); // ["Observation.status"]
```

***

### unreadableBooleans()

> **unreadableBooleans**(`resource`, `path`): `string`[]

The locations where a `boolean`-valued safety element carries a **written value this layer could
not read as a boolean**, so the element is present, the sender filled it in, and the read returned
`undefined` all the same.

R4 spells a `boolean` as `true` or `false` and nothing else (datatypes.html), so
`<doNotPerform value="1"/>` and `<doNotPerform value="Y"/>` (ordinary output from a v2 or C-CDA
converter, which is how a great deal of data reaches a FHIR surface) carry no boolean this library
may read. Coercing them would author a value the sender did not spell, and `"1"` and `"Y"` also
appear on the wire meaning the opposite of what a naive reading gives them. So the value stays
unread, and **this is the record that it was there**: without it, `value="1"` and `value="0"` read
identically, and a prescriber's "yes, do not administer" is indistinguishable from "no" with
nothing anywhere to say a choice was made.

**Value-free, like every location on this readout**: the text that failed to read is not carried
here or anywhere else, only the FHIRPath of the element that held it.

**The element is `doNotPerform`**, the only `boolean` [readSafety](#readsafety) takes off a document, and
there is no resource-type gate on it. **The window is every resource root** (so a `contained` or
Bundle-`entry` resource is covered), which is **the negation read's own window**: the value that is
read and the value that cannot be read are decided together, in one pass, so neither can cover a
document the other does not. It is **not** `arrayWrappedScalars`' whole window, and the difference
is a live residual rather than a nicety: that report's *element-level* half is scoped to the
resource types the cardinality table knows, so `{"resourceType":"ServiceRequest",
"doNotPerform":[true]}` is read here and at [SafetyReadout.negations](#negations), while the wrapper it
arrived in draws no `ARRAY_WRAPPED_SCALAR`. Closing that needs a cardinality for the element name
on the types outside the table, which is a per-resource question this layer does not answer.
It is **not** a report of every unreadable value in a document: the profile booleans, an
`ElementDefinition.min` whose text falls outside the lexical space the profile loader reads, and a
`Quantity` magnitude's lexical forms are read elsewhere and are still lost silently.

**Empty whenever each `doNotPerform` is written as exactly `true` or `false`, which is not every
schema-valid document.** R4's XML schema derives `boolean` from `xs:boolean`, whose
`whiteSpace=collapse` facet strips surrounding whitespace before the value is checked, so
`<doNotPerform value=" true"/>` is schema-valid, and R4 says an XML reader SHOULD trim that
whitespace (xml.html, datatypes.html). This reader does not trim, so the value is reported here
rather than read: over-disclosure, never a guessed boolean. XML attribute-value normalization does
not change the answer, since it turns a literal tab or line break into a space and keeps a space.

#### Parameters

##### resource

[`FhirComplex`](#fhircomplex)

The resource model.

##### path

`string`

The FHIRPath prefix for the resource root (usually its `resourceType`).

#### Returns

`string`[]

The locations of the unreadable boolean values, in walk order.

#### Example

```ts
import { parseResourceXml, unreadableBooleans } from "@cosyte/fhir";
const { resource } = parseResourceXml(
  '<MedicationRequest xmlns="http://hl7.org/fhir"><doNotPerform value="1"/></MedicationRequest>',
);
unreadableBooleans(resource, "MedicationRequest"); // ["MedicationRequest.doNotPerform"]
```

***

### unreadableNegationCodes()

> **unreadableNegationCodes**(`resource`, `path`): `string`[]

The locations where a `code`-valued negation element holds **content at a position no datatype
FHIR spells there can hold**, so the negation read stepped over it and returned nothing.

`{"resourceType":"Procedure","status":{"value":"not-done"}}` is ordinary output from a converter
that carried FHIR XML's `value` attribute across as a JSON member, and
`{"…","status":3}` from a feed whose codes are enumerated numerically. Neither is a `code` (FHIR
JSON spells one as a JSON string, json.html §2.6.0) and neither is a `CodeableConcept`, the other
datatype a root `status` carries. **Nothing here descends into the object or
coerces the number**, which would resolve a negation out of an encoding no version of FHIR defines
for JSON. This is **the record that content was there**, which is what the read was missing:
without it a procedure recorded as not done returns `negations: []` under `safeToSummarize: true`,
indistinguishable from one that was carried out.

**The shape complement of [nearMissNegationCodes](#nearmissnegationcodes-1)**, which covers a *value* the exact match
declined. A position holding no value at all is invisible to every value-shaped question here,
[unreadableBooleans](#unreadablebooleans-1) included, and that is the gap this closes.

**The element is `status`, at every resource root**, the negation read's own window. A complex
with at least one member, all of them ones FHIR spells there, is left alone, because R4 and R5
both spell some root `status` elements as `CodeableConcept`; one member outside that set is enough
to report, and so is carrying no member at all. `verificationStatus` is deliberately outside it, and `AllergyIntolerance.code` is outside it for
the reason that keeps `no-known-allergy` root-scoped (see
[SafetyReadout.unreadableNegationCodes](#unreadablenegationcodes) for both).

**Value-free**: only the FHIRPath of the element is carried.

Empty for every conformant document this library has been measured against, in either wire
format. See [SafetyReadout.unreadableNegationCodes](#unreadablenegationcodes) for the two declared limits.

#### Parameters

##### resource

[`FhirComplex`](#fhircomplex)

The resource model.

##### path

`string`

The FHIRPath prefix for the resource root (usually its `resourceType`).

#### Returns

`string`[]

The locations of the unreadable negation-code positions, in walk order.

#### Example

```ts
import { parseResource, unreadableNegationCodes } from "@cosyte/fhir";
const { resource } = parseResource(
  '{"resourceType":"Procedure","status":{"value":"not-done"}}',
);
unreadableNegationCodes(resource, "Procedure"); // ["Procedure.status"]
```

***

### validatePrimitiveValue()

> **validatePrimitiveValue**(`value`, `datatype`): `"ok"` \| `"type-mismatch"` \| `"invalid"`

Whether a model primitive value is well-formed for a declared FHIR R4 primitive datatype.

Returns `"ok"` when the value matches the datatype's value-domain, `"type-mismatch"` when the
value's *shape* is wrong for the datatype (e.g. a JS string where a `boolean` is required, or a
`boolean` where a numeric type is required), and `"invalid"` when the shape is right but the
lexical form fails the datatype's pattern. The caller maps these to `TYPE_MISMATCH` /
`PRIMITIVE_INVALID` issues.

An unknown (non-primitive) datatype name yields `"ok"`, a complex datatype is validated
structurally elsewhere, not here; this function speaks only for the primitives it knows.

#### Parameters

##### value

[`PrimitiveValue`](#primitivevalue)

The model primitive value.

##### datatype

`string`

The declared FHIR datatype name.

#### Returns

`"ok"` \| `"type-mismatch"` \| `"invalid"`

`"ok"` | `"type-mismatch"` | `"invalid"`.

#### Example

```ts
import { validatePrimitiveValue } from "@cosyte/fhir";
validatePrimitiveValue("2013-06-08", "date");   // "ok"
validatePrimitiveValue("2013-13-40", "date");   // "invalid"
validatePrimitiveValue("male", "boolean");      // "type-mismatch"
```

***

### validateResource()

> **validateResource**(`resource`, `options?`): [`ValidationResult`](#validationresult)

Validate a FHIR resource model against structural, cardinality, and value-domain rules.

#### Parameters

##### resource

[`FhirComplex`](#fhircomplex)

A resource model (typically from `parseResource`).

##### options?

[`ValidateOptions`](#validateoptions) = `{}`

Mode and extra schemas.

#### Returns

[`ValidationResult`](#validationresult)

The value-free [ValidationResult](#validationresult).

#### Example

```ts
import { parseResource, validateResource } from "@cosyte/fhir";
const { resource } = parseResource('{"resourceType":"Patient","gender":"masculine"}');
const { issues } = validateResource(resource); // → one CODE_INVALID at Patient.gender
```

***

### validateUcumShape()

> **validateUcumShape**(`code`): [`UcumShapeVerdict`](#ucumshapeverdict)

Whether a string is a **shape-valid** UCUM code. This checks structure only, it does **not**
assert the code names a real UCUM unit (that needs the UCUM content, which is not bundled).
A code is `"invalid"` when it is empty, contains whitespace (UCUM codes never do), or has
unbalanced `[]` / `{}` / `()`. Curly-brace annotations (`{RBC}`) are stripped before the whitespace
and bracket checks, since their inner text is unconstrained. Everything else is `"ok"`, a
conservative pass, so a well-formed but exotic unit is never wrongly rejected. The only consumer of
this is a **warning** (`UCUM_UNIT_UNRECOGNIZED`), never an error, so an occasional lenient pass on a
weird annotation cannot flip validity.

#### Parameters

##### code

`string`

A candidate UCUM code (e.g. `"mm[Hg]"`, `"kg/m2"`, `"/min"`).

#### Returns

[`UcumShapeVerdict`](#ucumshapeverdict)

`"ok"` when the shape is well-formed, `"invalid"` otherwise.

#### Example

```ts
import { validateUcumShape } from "@cosyte/fhir";
validateUcumShape("mm[Hg]"); // "ok"
validateUcumShape("mm Hg");  // "invalid", UCUM has no spaces (the code is "mm[Hg]")
validateUcumShape("[lb_av"); // "invalid", unbalanced bracket
```

***

### validationIssue()

> **validationIssue**(`code`, `severity`, `expression`, `constraint?`, `codeSystemVersion?`): [`ValidationIssue`](#validationissue)

Construct a value-free [ValidationIssue](#validationissue). The `IssueType` is fixed by the code; only the
`severity` is caller-chosen (it varies with lenient vs strict mode for some codes).

#### Parameters

##### code

[`ValidationCode`](#validationcode)

The validation code.

##### severity

[`ValidationSeverity`](#validationseverity)

The R4 severity to record (mode-dependent for some codes).

##### expression

`string`

The FHIRPath location of the finding, never a value.

##### constraint?

`string`

The spec constraint key, for an invariant finding only (e.g. `"ait-1"`).

##### codeSystemVersion?

[`CodeSystemVersionRecord`](#codesystemversionrecord)

The code-system release record, for a finding a terminology service
  produced only. Omit it for every finding no service was consulted for; passing
  `{ declared: false }` is the distinct claim that a service answered and named no release.

#### Returns

[`ValidationIssue`](#validationissue)

#### Example

```ts
import { validationIssue } from "@cosyte/fhir";
const issue = validationIssue("CODE_INVALID", "error", "Patient.gender");
```

***

### wouldLosePrecisionAsDouble()

> **wouldLosePrecisionAsDouble**(`raw`): `boolean`

Whether a JSON-number literal would lose information if it were routed through a JavaScript
`number` (an IEEE-754 double) and back. This is the exact test the codec uses to raise
`DECIMAL_PRECISION_AT_RISK`: it is `true` when a naive `JSON.parse`-based reader *would have*
corrupted this value, either by changing its quantity (too many significant digits, or magnitude
past the safe-integer range) or by dropping trailing-zero precision (`0.010` → `0.01`).

#### Parameters

##### raw

`string`

#### Returns

`boolean`

#### Example

```ts
import { wouldLosePrecisionAsDouble } from "@cosyte/fhir";
wouldLosePrecisionAsDouble("0.010"); // true , trailing zero dropped by a double
wouldLosePrecisionAsDouble("0.5");   // false, survives a double exactly
```
