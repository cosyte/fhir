---
id: limits
title: Current limits
sidebar_label: Current limits
description: "What @cosyte/fhir does not do (bundled content, typed models, other FHIR versions, unit conversion) and the findings that mean a check did not run."
---

# Current limits

What the package does not do, in its own words. Everything here is a deliberate boundary, and each
one is stated because working around a limit you know about is cheap, while discovering one in
production is not.

The gaps, in the order the README lists them under "Not covered yet":

- [typed per-resource models](#no-typed-per-resource-models);
- `profile` slicing discriminators, `type` discriminators the document holds no answer to, and the
  R5 `position` discriminator, reported `PROFILE_SLICE_UNCHECKED`, FHIRPath outside the subset
  we evaluate, reported `INVARIANT_UNCHECKED`, and a profile's type profiles, constraining target
  profiles, non-numeric value ranges, bindings beyond the structure layer's and what the model does
  not read, reported `PROFILE_CONSTRAINT_UNCHECKED`
  ([verdicts that say "not checked"](#verdicts-that-say-not-checked-rather-than-passing));
- bundled [terminology](#no-terminology-content-is-bundled) or [US Core](#no-profile-content-is-bundled)
  content;
- validation of [R4B, R5 and DSTU2 content](#r4-first) against its own version's definitions;
- [spec-clean JSON written from a model read out of XML](#json-written-from-an-xml-read-keeps-primitives-as-text);
- [unit conversion](#no-unit-is-converted);
- [executing a transaction Bundle](#a-transaction-bundle-is-read-never-executed).

## No terminology content is bundled

The library knows code system identities, not their contents. There is no bundled SNOMED CT, LOINC,
CPT, RxNorm, or ICD content, and there never will be: those are licensed distributions, and vendoring
them into a parser is both a licensing problem and a staleness problem.

What that means in practice:

- a coding is checked for a system this library recognizes, and for the binding strength the element
  declares;
- membership of a code in a value set is not answered unless you supply a terminology service;
- with no service supplied, the checks degrade to that content-free level and never produce a false
  error. Silence about membership is not a claim of validity.

## No profile content is bundled

US Core and vendor `StructureDefinition`s are caller-supplied. The package validates against
whatever profiles you hand it, with snapshot generation, slicing, fixed and pattern values, and
must-support treated as a system obligation rather than an instance requirement.

The consequence to plan for: "validated" here means "validated against the profiles you supplied".
The library never asserts conformance to a version of US Core you did not pass in, because the
alternative is a claim about an implementation guide release that may not be the one your trading
partner is on.

## No typed per-resource models

There is no generated TypeScript interface per resource type, and no `Patient` or `Observation`
class. The model is schema-free, and elements are reached by name through small helpers.

This is the cost side of the trade that makes a lenient read safe: a schema-free tree cannot drop an
element it has no field for, but it also cannot offer compile-time completions for a resource's
elements. If you want typed access to a handful of elements, wrap the helpers in your own accessors
at the edge of your program. If you want the compile-time shape of a whole resource,
[Type a parsed resource with the community R4 types](./type-resources-with-r4-types.md) types a
plain JSON copy with `@types/fhir`, and says what that copy loses: exact decimals become JavaScript
numbers.

## Verdicts that say "not checked" rather than passing

Each of these is a finding the validator emits rather than silently letting something through. If
you treat any non-error finding as a pass, you will misread them.

- `INVARIANT_UNCHECKED`: a constraint whose FHIRPath expression is outside the bounded expression
  subset this library evaluates, whether a profile supplied it or R4 declares it on the resource
  type. It is reported as informational, and it means the invariant was **not** evaluated, not that
  it held. With no profile, the one base constraint reported this way is `dom-3` on a resource that
  carries a contained resource: checking that every contained resource is referenced needs
  reference resolution the subset does not have. With nothing contained, `dom-3` holds by its own
  terms and nothing is reported, also when a supplied profile carries R4's `dom-3` as written. A
  profile's constraint under that key written any other way is its own expression, and is reported
  unchecked like any other the subset cannot evaluate.
- `PROFILE_SLICE_UNCHECKED`: a slicing whose membership this library could not decide. Again, it
  means the slice membership was not decided, not that it matched. A slice's own constraints apply
  only to the occurrences assigned to it, so under an undecided slicing they are not checked either.
  The finding's `sliceReason` says which part could not be decided:
  - `profile-discriminator`: a `profile` discriminator, which this library does not decide yet. A
    slicing with one among its discriminators is left undecided whatever else it discriminates on;
  - `discriminator-unsupported`: the `position` discriminator, which is not part of the R4
    discriminator set, or a kind outside it; `no-discriminator`: a slicing that declares none;
  - `slice-unconstrained`: a slice that states nothing at a discriminator path (no fixed or pattern
    value, no cardinality, no type);
  - `path-unsupported`: a `type` discriminator path outside dotted element names, `[x]` choices,
    `$this` and a trailing `resolve()`, such as `ofType(Quantity)`, or one that selects more than
    one node in an occurrence (a discriminator path selects one element, so several decide nothing
    rather than matching when any one of them does);
  - `type-undetermined`: an occurrence whose type the document does not state (a `type`
    discriminator is decided from a choice element's suffix, `valueQuantity`, or a resource's
    `resourceType`), or a slice naming an abstract type such as `Resource`;
  - `target-unresolved`: a `resolve()` whose reference names nothing in the resource's `contained`
    set or, when the resource is a Bundle, its entries; a reference to a server is never fetched. A
    reference to a contained id, or a Bundle `fullUrl`, that more than one resource carries names
    none of them, never the first, so it reads here too, and the repeat itself is reported:
    `CONTAINED_ID_DUPLICATE`, or `FULLURL_DUPLICATE` where R4's `bdl-7` forbids it;
  - `profile-unavailable`: after `resolve()`, a slice's `targetProfile` that is neither a base R4
    type, nor in the `profiles` you supplied, nor returned by your `resolveBase`, or whose supplied
    versions constrain different types, so the type it asks for is unknown.

  An occurrence is assigned to the earliest slice in the profile's snapshot order whose
  discriminators it matches, whatever their kind: `value`, `pattern`, `exists` or `type`. Once it
  matches one, later slices are not tried for it, so an occurrence that would also match a later
  slice is checked against the earlier one's constraints only, and counts toward its cardinality
  alone.

  Two warts to know about. The finding's diagnostic text still says the slicing used "an
  unsupported discriminator" whatever the reason; read `sliceReason` for the reason. And a
  `resolve()` takes an absolute reference to its `Type/id` tail when no entry has that full URL, as
  Bundle reference resolution does everywhere in this library, so a reference to another server,
  `https://other.example.org/fhir/Patient/1`, reaches the Bundle's `Patient/1` entry even when that
  entry has a different base, and a `type` discriminator reads that entry's type.
- `PROFILE_SLICE_NO_SLICING`: a profile naming a slice (`Observation.component:coded`) under an
  element that declares no `slicing`, or that is missing from the snapshot. Nothing in the profile
  says which occurrences belong to the slice, so none is assigned to it, and the slice's own
  constraints are not checked. It is reported at information, once per present parent.
- `PROFILE_CONSTRAINT_UNCHECKED`: a constraint a supplied profile places on an element that is
  present, of a kind this library does not check. It is reported at information, at the element or
  the occurrence, and the finding's `uncheckedConstraint` says which kind (it reaches an
  `OperationOutcome` as `issue.details.text`):
  - `type-profile`: a `type.profile` the occurrence must conform to, such as an extension's own
    definition or a datatype profile. The R4 `SimpleQuantity` profile is the exception: its one rule,
    `sqty-1`, is checked;
  - `target-profile`: a `Reference` whose target's type cannot be read (no `Type/id` form and no
    target in the resource's `contained` set or, for a Bundle, its entries), or whose target is of
    the type a constraining profile names, since conformance to that profile is not checked, or that
    names a profile neither supplied nor returned by `resolveBase`; and any `targetProfile` on a
    `canonical`. A target of a type no `targetProfile` names is an error,
    `PROFILE_REFERENCE_TARGET_MISMATCH`;
  - `max-length`: a `maxLength` on a value that is not a string. On a string it is checked, counted
    in UTF-16 code units as the reference validator counts it, and a longer one is
    `PROFILE_MAX_LENGTH`;
  - `value-range`: a `minValue[x]` or `maxValue[x]` that is not an integer or decimal type (a date, a
    time, a `Quantity`), or whose type is not the occurrence's. A number is compared exactly, and one
    outside the range is `PROFILE_MIN_VALUE` or `PROFILE_MAX_VALUE`;
  - `binding`: a `required` or `extensible` binding, unless it binds the very R4 value set whose
    codes the structure layer enumerates for that element of the resource, such as
    `Observation.status`. A `preferred` or `example` binding asks nothing and is not reported;
  - `slice-order`: an `ordered` slicing, or `openAtEnd` rules, over more than one occurrence;
  - `slice-invariant`: a slice's own invariant that the element it slices does not carry;
  - `primitive-invariant`: an invariant on an element present as a primitive value, other than
    `ele-1`;
  - `unread`: a member or extension of the element definition, its binding or one of its types that
    this library does not read and that is not documentation, such as `contentReference`,
    `type.aggregation`, or an extension it does not know.

  A `choice[x]` occurrence of a type the profile does not list is an error,
  `PROFILE_TYPE_MISMATCH`. A base `Resource` or `DomainResource` target profile allows any target.

All of them exist because the alternative, staying quiet, is indistinguishable from a pass to every
consumer downstream.

## R4 first

FHIR R4 (`4.0.1`) is the modeled target. R4B (`4.3.0`), R5 and DSTU2 documents can be read, because
the model is schema-free, but they are not validated against their own definitions. Treat
cross-version reads as data recovery, not conformance.

Nothing in a document tells the package which version it is: no read looks at a `fhirVersion`, a
MIME type parameter or a profile URL to pick a version. So an R4B resource is read and validated as
if it were R4:

- its values are read exactly as with R4, every `decimal` kept as written, and the safety readout
  reads its status, modifiers and negations by the same rules;
- the safety readout does not assess a resource of a type it does not model, including one R4B
  added: it lists the resource on `notAssessed` and never calls it safe to summarize, whatever
  status it carries, and it finds a resource by its position alone, so a `resourceType` written on
  a Bundle entry or another element that is not a resource is listed there too
  ([a resource type the readout does not model](./check-safety-before-summarizing.md#a-resource-type-the-readout-does-not-model));
- a resource of one of the eleven types we model (`Patient`, `Observation`, `DiagnosticReport`,
  `Condition`, `MedicationRequest`, `AllergyIntolerance`, `Immunization`, `MedicationStatement`,
  `Encounter`, `Procedure` and `DocumentReference`) is validated against R4's definition of that
  type, so an element R4B changed is judged by R4's rule;
- a resource of any other type, including one R4B added, gets the information finding
  `RESOURCE_NOT_MODELED`: only the elements every resource has are checked, and none of the type's
  own;
- `validateResource` reports an unmodeled type only at the top level, so a document can be valid
  and still decline in `readSafety` for a type it does not model in `contained` or a Bundle entry;
- inside a resource of a type the safety readout assesses, every element at every depth is checked
  against the union of what R4 and R4B define there, so an element either release defines is read
  as written, and one neither defines is listed on `notAssessed` and reported as `UNKNOWN_ELEMENT`
  ([an element the format does not define](./check-safety-before-summarizing.md#an-element-the-format-does-not-define));
- an XML element in a namespace other than its parent's is declined and reported the same way, and
  the reader still models it under its local name. Neither writer can spell the namespace, so both
  refuse the model (`UNSERIALIZABLE_FOREIGN_NAMESPACE`) rather than write the element as FHIR. A
  document whose root is in a namespace other than FHIR's is listed on `notAssessed` by its root's
  location and refused by both writers (`UNSERIALIZABLE_FOREIGN_ROOT`); a root in no namespace at
  all is read as FHIR. So a write and a re-read, in either format, cannot turn a declined element
  into one that reads safe.

Here a synthetic `NutritionProduct`, a type R4B added, carries a status outside any code list and an
element no version defines. Validation reports neither, and the safety readout does not assess the
resource, so it is not safe to summarize:

```ts runnable
import { parseResource, readSafety, validateResource } from "@cosyte/fhir";

const { resource } = parseResource(
  JSON.stringify({
    resourceType: "NutritionProduct",
    id: "syn-np-0001",
    status: "not-a-status",
    code: { text: "Synthetic formula" },
    notAnElement: "kept as written",
  }),
);

const result = validateResource(resource);
result.valid; // => true
result.issues.map((issue) => issue.code); // => ["RESOURCE_NOT_MODELED"]
readSafety(resource).status; // => "not-a-status"
readSafety(resource).notAssessed; // => ["NutritionProduct"]
readSafety(resource).safeToSummarize; // => false
```

The same status on an `Observation`, a type we model, is an error:

```ts runnable
import { parseResource, validateResource } from "@cosyte/fhir";

const { resource } = parseResource(
  '{"resourceType":"Observation","id":"syn-0002","status":"not-a-status","code":{"text":"Synthetic reading"}}',
);
validateResource(resource).issues.map((issue) => issue.code); // => ["CODE_INVALID"]
```

To hold R4B content to its own rules, pass the R4B definitions you need as profiles: see
[Validate against your own profiles](./validate-against-profiles.md).

## No unit is converted

A quantity is read with its magnitude exactly as written and its UCUM `code`, and the package never
converts it to another unit, compares two quantities in different units, or computes an
interpretation flag from a reference range. A vital sign's unit is checked against the units R4
allows for it; it is not converted to one of them.
[Read measured values and their units](./read-measured-values.md) shows what is read.

## A transaction Bundle is read, never executed

`readBundle` tells a transaction (all or nothing) from a batch (each entry on its own) and describes
the entries. Nothing in the package applies either: there is no server, no storage and no request.
[Read Bundles and resolve references](./read-bundles-and-references.md) shows what is read.

## JSON written from an XML read keeps primitives as text

The XML codec is schema-free like the JSON one, so a primitive read from XML is kept as the text of
its `value` attribute. `serializeResource` writes such a model faithfully, but not in spec-clean JSON:
a `boolean` or a number read from XML is written as a JSON string, because choosing the JSON type
needs the datatype of every element, which the schema-free model does not carry. A model read from
JSON writes back to JSON with its types, and the XML writer takes a model from either read.

```ts runnable
import { parseResourceXml, serializeResource } from "@cosyte/fhir";

const { resource } = parseResourceXml(
  '<Patient xmlns="http://hl7.org/fhir"><id value="syn-0001"/><active value="true"/></Patient>',
);
serializeResource(resource); // => '{"resourceType":"Patient","id":"syn-0001","active":"true"}'
```

## A narrative is checked, not sanitized

`validateResource` reads each `Narrative.div` as XHTML and checks it against the R4 narrative
rules: a single `div` root in the XHTML namespace, only the elements and attributes R4 allows, no
script, embedding element, event handler or script URL, no block element inside a paragraph, and
some content. Each broken rule is an error at the location of the `div`, and no finding names
anything written inside it. The string itself is kept exactly as written, and the writers emit it
unchanged.

```ts runnable
import { parseResource, validateResource } from "@cosyte/fhir";

const { resource } = parseResource(
  JSON.stringify({
    resourceType: "Patient",
    id: "syn-0003",
    text: {
      status: "generated",
      div: '<div xmlns="http://www.w3.org/1999/xhtml"><p onclick="track()">Synthetic summary</p></div>',
    },
  }),
);
validateResource(resource).issues.map((issue) => `${issue.code} ${issue.expression}`); // => ["NARRATIVE_ACTIVE_CONTENT Patient.text.div"]
```

What it does not check:

- where a table or list part may sit, such as a `tr` outside a `table` or an `li` outside a list;
- a URL beyond its scheme, and whether an internal image reference such as `src="#a"` points at
  anything. Only a `javascript:` or `vbscript:` scheme is reported, read the way a browser reads
  it (a tab or line break inside the scheme does not hide it); a `data:` URL, including
  `data:text/html`, is not reported;
- the content of a `style` attribute, and duplicate `id` values, so a `url(...)` inside a `style`
  value, `javascript:` included, is not reported;
- an HTML named entity such as `&nbsp;` is not read at all: XHTML in FHIR has only the five XML
  entities, so such a narrative is reported `NARRATIVE_UNREADABLE`, as the HL7 reference validator
  reports it.

A narrative with no finding has passed the rules R4 states, which is not the same as being safe to
render. If you display narratives as HTML, run them through your renderer's own sanitizer as well.

## Reported, not repaired

Several non-conformant shapes are read, reported, and deliberately not fixed. Character data written
directly on an element in XML is the clearest example. FHIR carries a primitive's value in an
attribute, so text in that position is non-conformant. On a primitive element the reader takes the
text as the value, so the safety readout still sees a status or a dose written that way, and the
read is reported: validation raises an error, the resource is not safe to summarize, and both
writers refuse it. On a complex element the text has no slot in the model and is dropped, with a
finding. Either way the package reports the shape rather than guessing what the sender meant.

The same posture governs the writers. When a model cannot be spelled back into the target format
without inventing or losing content, the write is refused with a coded reason instead of emitting
something plausible. [Troubleshooting](./troubleshooting.md) covers what each refusal means.

## Put it to use

- [Check codes without a terminology server](./check-codes.md) shows the content-free checks and
  where a terminology service of your own plugs in.
- [Validate against your own profiles](./validate-against-profiles.md) shows how to supply the
  profiles this package does not bundle.
- [Type a parsed resource with the community R4 types](./type-resources-with-r4-types.md) shows
  the typed copy, and which values to keep reading from the model.
- [Troubleshooting](./troubleshooting.md) has an entry for each finding above that means a check did
  not run.
