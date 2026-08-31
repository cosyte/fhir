---
id: core-concepts
title: Core concepts
sidebar_position: 4
---

# Core concepts

Four ideas carry the whole library: a schema-free model, exact primitives, two codecs that agree
with each other, and diagnostics that never carry a value.

## The schema-free resource model

A parsed resource is a small, immutable tree of three node kinds:

- a **complex** node, an ordered list of named properties, exactly as the document wrote them;
- a **list** node, a repeating element with its positions preserved;
- a **primitive** node, one value plus the metadata FHIR allows beside it.

There is no generated class per resource type, and no schema is consulted to build the tree. That is
a deliberate trade. A schema-free read cannot silently drop the element it has no field for, which
is the failure mode that matters when the sender is a production system you do not control. What you
give up is the compile-time shape of a typed model, and small helpers earn most of it back:

```ts
import { getProperty, isPrimitive, parseResource, resourceType } from "@cosyte/fhir";

const { resource } = parseResource('{"resourceType":"Observation","status":"final"}');

resourceType(resource); // => "Observation"

const status = getProperty(resource, "status");
const code = status !== undefined && isPrimitive(status) ? status.value : undefined;

code; // => "final"
```

Content FHIR gives no meaning to is kept, but never as an element. An array nested inside an array,
for instance, is preserved as inert text rather than modeled, so no walker can mistake it for part
of the resource while the reader still reports that it was there.

## Numbers stay exactly as they were written

`decimal` and `integer64` are kept as their exact lexical strings and are never routed through a
JavaScript number. This is the single most consequential decision in the library.

A JavaScript number is a binary double. It cannot represent `0.1` exactly, it silently rounds past
about 15 significant digits, and it has no concept of trailing zeros. In FHIR those three facts are
clinical, not academic: `0.010` and `0.01` are different statements about how precisely a dose was
measured, and a 19-digit identifier that comes back changed in its last digits is a different
patient.

So the codec never converts. A magnitude is carried as the text the sender wrote, and it round-trips
byte for byte:

```ts
import { parseResource, serializeResource } from "@cosyte/fhir";

const source = '{"resourceType":"Observation","status":"final","valueQuantity":{"value":0.010}}';
const { resource, issues } = parseResource(source);

serializeResource(resource); // => '{"resourceType":"Observation","status":"final","valueQuantity":{"value":0.010}}'
issues.map((issue) => issue.code); // => ["DECIMAL_PRECISION_AT_RISK"]
```

`DECIMAL_PRECISION_AT_RISK` is informational. It says a value arrived that a naive reader would have
corrupted, which is useful to log and never a reason to reject a document.

When you need arithmetic, ask for it explicitly. The decimal type exposes its exact text and an
exact integer view, and neither is a lossy conversion.

## Two codecs, one model

The JSON codec is `parseResource` and `serializeResource`. The XML codec is `parseResourceXml` and
`serializeResourceXml`. Both produce the same model, so a consumer written against one wire format
already works with the other:

```ts
import { nodesEquivalent, parseResource, parseResourceXml } from "@cosyte/fhir";

const fromJson = parseResource('{"resourceType":"Observation","status":"final"}').resource;
const fromXml = parseResourceXml(
  '<Observation xmlns="http://hl7.org/fhir"><status value="final"/></Observation>',
).resource;

nodesEquivalent(fromJson, fromXml); // => true
```

The writers are conservative where the readers are liberal. A writer authors no value of its own: if
a model carries something the target format cannot spell back without inventing or dropping content,
the write is refused with a coded reason rather than emitted as something plausible.

### The XML reader refuses rather than resolves

The XML reader is hardened by refusal, not by configuration:

- any `DOCTYPE` declaration is refused with `DTD_FORBIDDEN`;
- any entity beyond the five predefined ones and numeric character references is refused with
  `UNDEFINED_ENTITY`;
- nesting past a fixed bound is refused with `MAX_DEPTH_EXCEEDED`;
- there is no I/O and no URI resolution at any point.

Together those close external entity expansion and billion-laughs expansion by construction. There
is no option to relax them, because an option is what turns a hardened parser into an exploitable
one on somebody else's deployment:

```ts
import { FhirXmlError, XML_FATAL_CODES, parseResourceXml } from "@cosyte/fhir";

const read = (input: string): string => {
  try {
    parseResourceXml(input);
    return "read";
  } catch (err) {
    return err instanceof FhirXmlError ? err.code : "unknown";
  }
};

read('<!DOCTYPE Observation><Observation xmlns="http://hl7.org/fhir"/>'); // => XML_FATAL_CODES.DTD_FORBIDDEN
read('<Observation xmlns="http://hl7.org/fhir"><status value="&x;"/></Observation>'); // => XML_FATAL_CODES.UNDEFINED_ENTITY
```

## The validation layers

`validateResource` runs a single pass made of layers. Each one is independent, each one adds
findings, and none of them can withdraw another's:

1. **Structure and cardinality**: unknown elements, type mismatches, choice ambiguity, and the
   minimum and maximum occurrences a modeled element declares.
2. **Primitive value domains**: the lexical space of each primitive type, and required code
   enumerations.
3. **Safety**: unknown `modifierExtension`s, retraction, negation and status codes. Always on, for
   every resource type, whether or not you supply a profile.
4. **Quantity and units**: which `value[x]` is present, UCUM code shape, and the units a vital sign
   is required to use. Units are checked, never converted.
5. **Bundle integrity**: agreement between an entry's full URL and the resource id, unresolved
   references, and a bounded guard against contained-resource cycles.
6. **Terminology bindings**: strength-aware and content-free. Without a terminology service the
   checks degrade to the system level and never produce a false error.
7. **Profiles and invariants**: everything a caller-supplied `StructureDefinition` asserts, plus its
   FHIRPath constraints.

The verdict is one boolean over the findings: `valid` is false when any finding is an error or
worse. Warnings and informational findings leave it true.

## The value-free OperationOutcome contract

Every finding this library raises carries a coded reason and a FHIRPath location, and never the
value it was raised over:

```ts
import { parseResource, validateResource } from "@cosyte/fhir";

const { resource } = parseResource(
  '{"resourceType":"Patient","modifierExtension":[{"url":"http://example.org/local-flag"}]}',
);

const finding = validateResource(resource).issues[0];

finding?.code; // => "UNHANDLED_MODIFIER_EXTENSION"
finding?.severity; // => "error"
finding?.expression; // => "Patient.modifierExtension[0]"
```

The reason this is a contract rather than a style is that findings travel. They go into logs,
support tickets, dashboards and bug reports, all of which are less protected than the resource
store, and a diagnostic that quotes the value it complained about is a diagnostic that copies
patient data into every one of them.

`toOperationOutcome` renders the same findings as an `OperationOutcome` resource, which is the shape
a FHIR server expects to receive:

```ts
import { parseResource, serializeResource, validateResource } from "@cosyte/fhir";

const { resource } = parseResource('{"resourceType":"Observation","status":"final"}');
const outcome = validateResource(resource).toOperationOutcome();

serializeResource(outcome).includes("OperationOutcome"); // => true
```

One qualification, stated because the opposite is easy to assume: a location is bounded to the
published form of a FHIR name, not guaranteed to be free of anything a sender wrote. A name that
does not match that form is replaced by a withheld marker rather than echoed.
