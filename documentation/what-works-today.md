# What works today

The capability readout for `@cosyte/fhir`, linked from the README.

The no-data-loss core: read FHIR R4 JSON into an immutable model and serialize it back, **without
ever losing a decimal, a primitive extension, or an exact 64-bit value**.

```ts
import { parseResource, serializeResource } from "@cosyte/fhir";

const { resource, issues } = parseResource(
  '{"resourceType":"Observation","valueQuantity":{"value":0.010,"unit":"mg"}}',
);

// The trailing zero survives: a naive JSON.parse would have made this 0.01.
serializeResource(resource); // → {"resourceType":"Observation","valueQuantity":{"value":0.010,"unit":"mg"}}

// Diagnostics are value-free: a code + a FHIRPath location, never the value. The location is
// built from the names the document supplies, and those are bounded to their published form.
issues; // → [{ code: "DECIMAL_PRECISION_AT_RISK", severity: "information", expression: "Observation.valueQuantity.value" }]
```

- **`decimal` / `integer64`** are string-backed (`FhirDecimal`, `FhirInteger64`) and never routed
  through the JS `number` type. `FhirDecimal.equals` is precision-sensitive (`0.010 ≠ 0.01`);
  `.equalsValue` compares quantity only.
- **Primitive extensions** (the `_element` sibling) are modeled first-class with **null-padded array
  alignment**; a misaligned value/`_`-array **fails closed** rather than mis-attaching an extension.
  A `_`-sibling written beside an element that is **not** a primitive has no defined meaning (a
  complex element carries its `id`/`extension` inline), and the reader does not model what was in it,
  so that position raises `MISPLACED_PRIMITIVE_EXTENSION`: its own code, because unlike an unexpected
  property it says content is **not readable** there rather than merely tolerated.
- **A diagnostic's `expression` is a location and nothing else.** R4 defines
  `OperationOutcome.issue.expression` as a FHIRPath subset that resolves to a node, so an issue says
  _where_ in the path and _why_ in the `code`, and never explains itself in prose inside the path.
  Two forms are deliberately not resolvable and are the only two: a `<withheld>` segment, which is
  what a name that fails the bounded-echo shape test prints as, and the XML reader's `.@name`, which
  is an XML attribute FHIR gives no element to address.
- **Lenient read, conservative write** (Postel's Law), `resourceType` resolvable in any position, and
  a `parseReference` classifier (relative / absolute / logical / fragment). The writer authors no
  value of its own, and it emits spec-clean FHIR for every model FHIR can express; the shapes it
  cannot express (an array inside an array, a scalar or `null` where FHIR JSON has an object (at a
  complex element's own position, or in a primitive's `_`-sibling), a `null`
  in a **primitive's** value channel that padded nothing, and a
  non-string `resourceType`) are handed back as written
  rather than repaired, because repairing them means inventing or dropping content. See the
  no-data-loss notes below. **The two `null` entries are different branches**, and for a long time
  only the first was listed while the second was silently deleted on emit.
- **A repeated property name is read, not resolved.** FHIR requires unique property names and JSON
  leaves the winner undefined, so the first value wins everywhere and a `DUPLICATE_PROPERTY` issue
  says where. On an **object** element both values are kept (`getAllProperties` reads them,
  `getProperty` still returns the first), the element is treated as genuinely ambiguous, and nothing
  downstream pretends otherwise: it validates as an error, the safety readout declines to
  summarize it rather than answering from one arbitrary half of the document, and **both writers
  refuse** rather than emit the surviving member alone. Inside a **primitive's
  `_element` metadata** (`id` and `extension`, which no safety verdict reads) the issue is raised but
  the shadowed member is not kept, and validation and the safety readout are unaffected.

And the first three validation layers (structure, cardinality, and primitive/enumerated-`code`
value-domain) with a value-free `OperationOutcome`:

```ts
import { parseResource, validateResource, serializeResource } from "@cosyte/fhir";

const { resource } = parseResource('{"resourceType":"Patient","gender":"masculine","wibble":1}');
const { issues, valid } = validateResource(resource); // lenient (read) mode by default

valid; // → false
issues;
// → [
//   { code: "UNKNOWN_ELEMENT", severity: "warning",  type: "structure",    expression: "Patient.wibble" },
//   { code: "CODE_INVALID",    severity: "error",    type: "code-invalid", expression: "Patient.gender" },
// ]

// Render an OperationOutcome: the diagnostics are value-free (a coded reason + a location, never
// the offending value "masculine"), the PHI redaction chokepoint.
serializeResource(validateResource(resource).toOperationOutcome());
```

- **Layered, severity-tagged** (validation.html): structure (`UNKNOWN_ELEMENT`, `TYPE_MISMATCH`,
  `CHOICE_AMBIGUOUS`), cardinality (`CARDINALITY_MIN`/`_MAX`), value-domain (`PRIMITIVE_INVALID` with
  the R4 datatype regexes, `CODE_INVALID` for required-strength enumerations).
- **Lenient vs strict:** an unknown element is a `warning` on read and an `error` under `mode: "strict"`.
- **Fail-safe:** never a false error: a resource type with no schema degrades to one informational
  `RESOURCE_NOT_MODELED`, not a wall of false unknowns. Built-in schemas: base-resource elements +
  `Patient` + `Observation`, and that list is the whole set; supply your own via
  `validateResource(resource, { schemas: [...] })`. The set grows one fully-verified element table at
  a time, because a table missing a row R4 defines would turn a conformant document into a wall of
  false unknowns, which is the failure the degrade above exists to avoid.

And the safety spine: FHIR's modifier (`?!`) elements, surfaced so they can never be silently dropped
or inverted, and the invariants that harm a patient when read wrong:

```ts
import { parseResource, readSafety, validateResource } from "@cosyte/fhir";

const { resource } = parseResource(
  '{"resourceType":"AllergyIntolerance",' +
    '"clinicalStatus":{"coding":[{"system":"http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical","code":"active"}]},' +
    '"code":{"coding":[{"system":"http://snomed.info/sct","code":"716186003"}]}}',
);

readSafety(resource).negations; // → ["no-known-allergy"]  (a recorded "no allergy", not an allergy TO it)

// An unknown modifierExtension fails closed: the resource cannot be safely processed.
const { resource: quirky } = parseResource(
  '{"resourceType":"Observation","status":"final","modifierExtension":[{"url":"http://vendor.example/x"}]}',
);
validateResource(quirky).issues.map((i) => i.code); // → ["UNHANDLED_MODIFIER_EXTENSION"]
```

- **Never-droppable status/negation:** `readSafety` carries `status` / `clinicalStatus` /
  `verificationStatus` / `doNotPerform` / retraction and a classified `negations` list (`refuted`,
  `no-known-allergy`, `do-not-perform`, `not-taken`, `not-done`, `entered-in-error`). The
  type-scoped slots are filled for the types `SAFETY_RESOURCE_TYPES` names; **the negation reads that
  can only add a finding are not type-scoped at all**: a retraction, a refutation, an instruction
  **not** to perform, and a `status` of `not-done` / `not-taken` are surfaced whatever the resource
  type, because a gate does not merely fail to read the types it omits, it never looks, so nothing is
  reported for them either. Those same reads run at **every resource root**, so a retracted
  `Observation`, a `Procedure` recorded as not performed or an order marked "do not perform" inside a
  `Bundle` entry or `contained` reaches `negations` too. **The readout's location channels
  (`unhandledModifierExtensions`, `modifierElements`, `shadowedProperties`, `arrayWrappedScalars`,
  `nestedArrays`, `droppedText`, `unreadableBooleans`, `nearMissNegationCodes`,
  `unreadableNegationCodes`, `absenceMarkers`, `unreadableAbsenceMarkers`,
  `conflictingAbsenceMarkers`) and
  `safeToSummarize` are document-wide.** The **single-valued** fields (`status`, `retracted`, `doNotPerform`, `noKnownAllergy`
  and the rest) answer about the resource you handed in, because one value cannot say which resource
  it came from, so branch on `negations` whenever a resource may carry others.
  `no-known-allergy` is the exception and
  stays a root, type-scoped read: it is a _positive_ clinical assertion, read off an element R4 does
  not flag `?!`, and surfacing one from somewhere inside a document could make a caller less careful
  where leaving it unsurfaced reads as _unknown_.
  `assertSafeToSummarize` **refuses** (throws) rather than flatten past an unhandled modifier.
- **A modifier is not only a `modifierExtension`, and the ordinary base elements R4 flags `?!` reach
  the readout too.** `modifierElements` carries one entry per location, each
  `{ element, location }`: `comparator` wherever a node the walk reaches carries it, `implicitRules`
  likewise, `active` on a `Patient` root, and `use` on a `Practitioner`'s `identifier` entries. Each
  sets `safeToSummarize` to `false` and makes `assertSafeToSummarize` throw, because
  `{"valueQuantity":{"value":0.01,"comparator":"<","unit":"mg"}}` summarized as a point value is
  `0.01 mg` reported for a result the sender wrote as `< 0.01 mg`. **Reporting only:** the element is
  surfaced and never interpreted, so no bound, range or inequality is read out of a `comparator` and
  no unit is ever converted. Recognition is by KEY NAME (and, for the two path-gated elements, by
  literal `resourceType` equality), which OVER-reports by construction: any object carrying a
  `comparator` member is an occurrence, a vendor payload that reuses the name included. That trade is
  deliberate, since a false positive costs a refusal and a false negative costs a wrong clinical
  value. A report carries the element and the location and nothing from the document: no value, no
  unit, no code, no URI; and a location roots at a resource type name only when the name is one this
  library defines (`MODIFIER_ELEMENT_ROOT_TYPES`), so an unmodeled type reads as a constant token.
  `modifierElements(resource)` is the standalone collector, and a modifier EXTENSION stays on
  `unhandledModifierExtensions` and draws nothing here, so one of those is still one report.
- **A safety verdict is never asserted over a value the document left ambiguous.** Each negation read
  runs over every coding on a `CodeableConcept` and every value written for the element it reads
  (`resourceType`, `status`, `verificationStatus`, `code`, `doNotPerform`), **including through an
  array wrapper around the element**, so a retraction or a refutation cannot hide in the one a
  single-value lookup skipped. Where a repeated property name leaves an element with two values,
  `safeToSummarize` is `false` with the locations in `shadowedProperties` instead of an affirmative
  answer.
- **A single-valued element wrapped in an array is read, and reported.** FHIR JSON writes a `0..1`
  element as a name/value pair and uses an array only for a repeating element, so
  `{"resourceType":"Observation","status":["entered-in-error"]}` is non-conformant, and a plain
  single-value read finds no code in it at all. It is realistic input, because a generic XML-to-JSON
  converter array-wraps every element it emits. The negation reads see through the wrapper, an
  `ARRAY_WRAPPED_SCALAR` issue (error) says where it was, and `safeToSummarize` is `false` with the
  locations in `arrayWrappedScalars`. The check covers `resourceType` and the single-valued safety
  elements on a resource root; deciding cardinality elsewhere would need a per-resource model, and R4
  genuinely does define repeating elements under some of the same names (`Questionnaire.code`), so a
  name-only rule would report a conformant document as broken.
- **That extends one level down, to a `Coding.system` / `Coding.code` inside a `CodeableConcept`**,
  which are `0..1` too and which the same converter wraps the same way, so a refuted allergy, a
  recorded "no known allergy" and a retracted Condition all hinge on it. Here the wrapper is read only
  where it holds **exactly one array position**, and the restriction is the safety property, not
  caution: those two values are paired with each other, so a rule yielding more than one value on
  either side would pair a `system` written in one position with a `code` written in another and
  **assert a coding the sender never wrote**, including a recorded absence of allergy, which is a
  positive clinical claim about a patient. Positions, not values: a JSON `null` inside a primitive
  array is a real position whose `_`-sibling may carry an extension, so `["716186003", null]` is two
  positions and is not read. A wrapper that is not read is still reported, so a negation is never
  quietly skipped: either way the `Coding` draws an `ARRAY_WRAPPED_SCALAR` error and
  `safeToSummarize` is `false`.
  **Scope:** this covers the codings of `clinicalStatus`, `verificationStatus` and `code`, which are
  the elements a safety verdict is read out of. A `Coding` anywhere else (`category`,
  `interpretation`, `referenceRange.type`, a `component`'s own `code`, and anything `codingsOf` is
  pointed at directly) is read exactly as it was before, without the wrapper. Reading a wrapper the
  library does not also report would resolve a clinical code out of an encoding FHIR JSON does not
  define and hand it back with no diagnostic anywhere.
  **The type scoping stops at the element name, and it does not reach the `Coding` inside it.** The
  negation reads are not type-scoped at all, so a `verificationStatus.coding.system` / `.code`
  wrapper is reported at **every** resource root of **any** type, including inside `contained` and a
  `Bundle.entry` -- read through where it holds one position, left unread where it holds more, and
  reported either way. What makes that safe without a per-resource model is that `Coding` is a
  _datatype_: its `system` and `code` are `0..1` wherever a `Coding` appears, so no question about
  the enclosing resource arises. A `code` carrying SNOMED `716186003` is read only on the types the
  cardinality table knows, so its wrapper is reported wherever it is read.
  **One read still runs ahead of its report, and it is named rather than smoothed over:** the
  `clinicalStatus` convenience field is filled off **any** resource root, so on a type the
  cardinality table does not know, that value is unwrapped (or, for a multi-position wrapper,
  declined) with no location reported, so `safeToSummarize` stays `true` over a value the library
  declined to read. Otherwise it reaches that one field and nothing else: never `negations`, never
  `valid`, never `noKnownAllergy`. A declared residual, pinned in both states, not a design.
- **An array inside an array is reported, and its contents are kept but never interpreted.** FHIR
  JSON uses an array for a repeating element and for nothing else, so a list of lists has no meaning
  at any position and there is no element for the reader to make of it. Left alone the model then
  looks exactly like an element the sender legitimately left out: whole resources have gone missing
  this way inside a `Bundle.entry`, and a refuted allergy has read back as an ordinary active one. So
  the position is named on every channel. `NESTED_ARRAY` on the read (warning) and in
  `validateResource` (error), the locations in `nestedArrays`, `safeToSummarize` is `false`, and
  `assertSafeToSummarize` throws. `isNestedArray` marks the node for a consumer walking the model
  directly. Because the shape is meaningless everywhere, this needs no cardinality rule and cannot
  fire on a conformant document, so unlike the two above it the check runs at every position the
  model has a node for, at every depth, including a primitive's `extension` metadata.
  **The array itself is not lost.** Its exact JSON text is preserved on the node and handed back by
  `nestedArrayContent`, so you can inspect or re-parse what the sender wrote (`readRawJson` will
  parse it with the same precision guarantees as the rest of the codec). A repeating primitive can
  nest in its value array, in its `_`-sibling array, or in both at one position, so the two channels
  come back separately rather than merged. `serializeResource` writes the array back, which is the one
  place the writer emits something it would not author: the alternatives are to emit the empty
  element the model holds, which fabricates an object the sender never wrote, or to omit the
  position, which drops content. Writing it back is also what makes the finding survive a round trip
  rather than laundering away. The preserved text is the array re-rendered compactly, so member order,
  every member of a repeated key and every number's exact source survive, but insignificant
  whitespace does not and strings are re-escaped canonically, exactly as everywhere else this library
  emits JSON. Such output is deliberately **not** spec-clean.
- **A scalar where FHIR JSON has an object is handed back too, and that one stops the writer authoring
  a value.** One position over from the shape above: a string, number, boolean or `null` written where
  a complex element belongs is content the reader has no element to make of it either, so it reports
  `UNKNOWN_PROPERTY` and the model holds an empty element there. Emitting that element writes `{}`,
  which is a **conformant** empty element, so the warning was gone the moment the output was read
  back and the writer had presented an object as read at a position nothing was read at.
  `serializeResource` now writes the value the sender wrote instead, so the finding survives the round
  trip. The scalar is **not** modeled as a primitive, deliberately: putting it in the tree would make
  it visible to every walker at a position walkers read as a complex element. It hangs off the node
  (`FhirComplex.nonObjectSource`), where only the writer reads it. Such output is deliberately **not**
  spec-clean, and `serializeResourceXml` does not carry it (that writer emits the empty element, the
  same as it does for an array inside an array).
  **The same rule reaches a primitive's `_`-sibling, which is the other place FHIR JSON has an
  object.** §2.6.2.3 gives that channel the `id` and/or `extension`, so `{"_status":null}` and
  `{"_status":"x"}` carry no metadata to model; the writer emits a `_`-sibling only for metadata it
  has, so both used to come back as `{}` with **no diagnostic at all**: the member gone, and
  `valid` and `safeToSummarize` both affirming. They now draw the same `UNKNOWN_PROPERTY` and the
  text is handed back (`FhirPrimitive.nonObjectMetaSource`), so the finding survives the round trip.
  **A `null` padding a repeating primitive's `_`-array is the one shape §2.6.2.3 defines and draws
  nothing**; a `null` at a singleton `_` slot is never padding and does.
  **Gaps, stated rather than implied:** the rule is bounded by what the reader modeled. A
  `_`-sibling the reader discards whole because it is misplaced or unrecognised (one sitting on an
  object or a non-primitive array, or a member of a `_`-sibling object that is neither an `id`
  **string** nor an
  `extension` array) leaves no node behind, so an array inside one is reported against the discarded
  sibling and draws no refusal. **Which warning it draws is per member, not one code for all three.**
  An unrecognised member of a `_`-sibling object draws `UNKNOWN_PROPERTY`:
  `{"birthDate":"1980-01-01","_birthDate":{"foo":[["x"]]}}` reports it at `Patient.birthDate.foo`. A
  `_`-sibling on an object and one on a non-primitive array instead draw
  `MISPLACED_PRIMITIVE_EXTENSION` for the misplaced sibling and nothing besides:
  `{"name":{"family":"Roe"},"_name":[[{"id":"x"}]]}` reports that one code at `Patient.name`, and no
  unexpected-property warning. Reaching it would mean reading raw JSON the codec
  does not model, which is the same problem as making the value readable. An **empty** `_`-sibling
  object or array is a different clause of the spec (§2.6.2.1's "never empty") and is still deleted
  silently; a `_`-sibling object's own unreadable **member** is reported but that report still does
  not survive emit. Both are open and declared, not closed here.
  **What it deliberately does not do is put the array in the tree.** The preserved content is text,
  not an element: it is not reachable through a node's properties, items or extensions, so a list
  holds exactly the items it held before, of the same kinds, with the same contents, and nothing that
  walks a repeating element sees anything new. That boundary is not a matter of taste. This library
  has checks that flatten a repeating element into its items and then skip whatever is not the kind
  they expect, so a list holding a list would reach them as an absent value: a profile invariant, a
  vital-signs unit check or a negation would go unevaluated and the resource would read as valid.
  Preserving the text costs none of that.
  **One further limitation, stated rather than hidden:** a scalar written beside a nested array in
  the same array (`"given":[["Peter"],"James"]`) lands where an object was expected, and that scalar
  is still dropped. It is reported as an unexpected property and the resource is still refused, but
  unlike the array itself its content is not kept.
- **A `null` the reader reads into a primitive slot is reported and written back, which is the other
  half of the rule above and used to be missing.** The bullet above covers the `null` the reader
  takes to the **complex** branch. Every other `null` is a different branch, and it read with no
  diagnostic at all and was then deleted on emit, so a non-conformant document came back as a clean
  conformant one with the member simply gone and every layer affirmed it.
  `{"identifier":[{"system":"…","value":null}]}` lost the identifier value;
  `{"value":null,"unit":"mg"}` lost the magnitude and **kept the unit**, so a quantity read back as a
  bare unit rather than as missing; `"status":null` lost the status. Nothing was _lost_ in the sense
  the shapes above lose things (a `null` carries no content), which is precisely why it was
  invisible: the output was indistinguishable from a document whose sender had legitimately omitted
  the element.
  **The rule is what §2.6.2.3 actually defines, not "the document wrote `null`".** FHIR JSON forbids
  `null` (§2.6.2.1: "properties never have null values (except for a special case documented below)")
  and carves out one exception, which is about a **repeating** primitive: the value array and the
  `_`-sibling array are padded with `null` so they align index-by-index. So two conditions are
  required for a `null` to be that exception, and both are checked: it sat **inside a repeating
  primitive's value array**, and the slot it produced **carries an `id` or a non-empty `extension`**
  for it to align with. One that is padding draws nothing and round-trips byte-for-byte exactly as
  before. One that is not leaves an element with neither a value nor children, which R4 `ele-1`
  requires one of: it draws `UNDEFINED_JSON_NULL` (warning) at that position, `isUndefinedNull` marks
  the node, and `serializeResource` writes the `null` back so re-reading the output reproduces the
  finding instead of laundering it away. Such output is deliberately **not** spec-clean, on the same
  reasoning as the two shapes above.
  **A singleton slot is never padding, whatever sits beside it.** §2.6.2.3 states the singleton
  encoding positively ("If the primitive has an id attribute or extension, but no value, only the
  property with the `_` is rendered"), so a value-absent singleton is `{"_status":{…}}` and both
  `{"status":null}` and `{"status":null,"_status":{…}}` are reported. **And the set this walks is
  what the reader read as a primitive, not what FHIR types as one:** the model is schema-free, so a
  bare `null` at any singleton property reaches the primitive branch whatever the element's FHIR type
  would be, and `{"subject":null}` on an `Observation` is reported here rather than as an unexpected
  property. Only an array item, and an item of a `_`-sibling's `extension` array, reach the complex
  branch.
  **What it deliberately does not do, stated rather than implied.** It does not refuse. A `null` is a
  non-conformant encoding of an _absent_ value, not content the reader could not read, so unlike an
  array inside an array or dropped element text there is nothing unreadable at the position, and
  `validateResource` and `safeToSummarize` are unchanged; refusing would also withdraw round trips
  that work today, and nothing that round-trips today stops (a value-absent primitive written the
  conformant way carries no `null`, so it is never marked). It is scoped to the **value** channel: a
  `_`-sibling that is itself not an object (`"_status":null`) is the neighbouring position and draws
  `UNKNOWN_PROPERTY` instead, on the reasoning above. **No case has ever moved between the two
  codes**, because that channel drew nothing at all until it was closed. And
  `serializeResourceXml` does not carry it: XML has no `null`, so it **refuses** rather than emit the
  empty element (see `UNSERIALIZABLE_JSON_ONLY_SHAPE` below).
- **A primitive whose value is written as XML element text is reported, not silently read as an
  absent value.** FHIR XML carries a primitive's value in the `value` attribute, so
  `<status>entered-in-error</status>` puts a code where the model has no slot for one: the character
  data is dropped and the element is left holding nothing. That is the same harm as an array inside
  an array, reached through the other wire format, and it is the sharper one, because the shape a
  retraction takes is an **affirmation**. Measured: a `<status>entered-in-error</status>` read back
  as a live record, an `AllergyIntolerance` that lost its `refuted`, and a `doseQuantity` that lost
  the dose **number** while its `mg` unit and UCUM code survived, all under `valid: true`. So the
  position is named: `DROPPED_ELEMENT_TEXT` in `validateResource` (error), the locations in
  `droppedText`, `safeToSummarize` is `false`, and `assertSafeToSummarize` throws. `isDroppedText`
  marks the node for a consumer walking the model directly, and the reader's existing
  `UNEXPECTED_XML_CONTENT` warning is kept alongside it rather than replaced. Like the rule above it
  needs no cardinality table and cannot fire on a conformant document, so it runs at every position
  the model has a node for, at every depth, and never on a document read from JSON.
  **The text is not read back as the value, deliberately.** Recovering it would be a _tolerance_ for
  a non-conformant encoding rather than a report of one, and this library encodes a tolerance only
  when a real document shows the shape in the wild. So the value stays unread and the verdict is a
  refusal rather than a repair.
  **Two limitations, stated rather than implied.** Whitespace between elements is not character data
  in this sense and is untouched, so ordinary indented XML is unaffected; but text written beside a
  value that _did_ arrive (`<status value="final">entered-in-error</status>`) is dropped too and
  draws the same refusal. The rule is keyed on the reader **dropping** character data, not on the
  text differing from the value: the reader never compares the two, so
  `<status value="final">final</status>` refuses as well, even though nothing is missing there. That
  is deliberate. Deciding the document meant no harm would mean reading the text, which is the
  tolerance this half does not take.
- **A boolean value outside the datatype's lexical space is reported, not read as an absent
  instruction.** R4 spells a `boolean` as `true` or `false` and nothing else, so
  `<doNotPerform value="1"/>` and `value="Y"` (ordinary v2 and C-CDA converter output, which is how
  a great deal of data reaches a FHIR surface) carry no boolean this library may read. They are not
  `false`; they are **unreadable**, and the difference is the whole point: measured, a `value="1"`
  read back exactly like `value="0"`, so a prescriber's "yes, do not administer" and another's "no"
  produced the same answer, with nothing on any channel to say a value had been written and dropped.
  So the position is named: the locations in `unreadableBooleans`, `safeToSummarize` is `false`, and
  `assertSafeToSummarize` throws. **The value is still not read**, deliberately: coercing `"1"` or
  `"Y"` would invent a reading the spec does not license, and it would turn `value="0"` into a JS
  `false` that `serializeResource` then emits, laundering an authored value across a format change.
  The channel covers `doNotPerform`, the only `boolean` `readSafety` takes off a document, on any
  resource type. Its window is every resource root (so a `contained` or `Bundle.entry` order counts),
  which is **the negation read's own window**: the value that is read and the value that cannot be
  read are decided together, in one pass, so neither can cover a document the other does not. It is
  **not** the whole of `arrayWrappedScalars`' window, and the gap is a declared residual rather than
  a nicety -- that report's _element-level_ half stays on the resource types this library models a
  cardinality for, so `{"resourceType":"ServiceRequest","doNotPerform":[true]}` is read here and on
  `negations`, while the array wrapper it arrived in draws no `ARRAY_WRAPPED_SCALAR`. A primitive carrying only `id` / `extension` and
  no value is untouched, since nothing was written there to be unread, so this cannot fire on a
  conformant document in either wire format.
  **Unlike the five findings above it, this one raises no `ValidationIssue` of its own**, for a narrow
  and measured reason rather than a general one: the request resources that define `doNotPerform`
  have no built-in schema, so the validator is silent about this element's **datatype** unless a
  caller supplies one, and the readout has to hold either way. The safety layer knows the datatype
  unconditionally, which is why the report lives there.
- **A code that spells a negation bar its case or its surrounding whitespace is reported, not read as
  one.** A negation is matched by its exact `code`, because FHIR `code` is case-sensitive and the
  datatype's lexical space has no room for surrounding whitespace (`[^\s]+(\s[^\s]+)*`). So
  `{"resourceType":"Procedure","status":"NOT-DONE"}` (an upper-casing source system) and a `status`
  of `" not-done"` (a padded fixed-width or CSV extract) assert no negation, and **that reading is
  correct and unchanged**: folding them in would accept a non-conformant document as though it were
  conformant and hand you a negation the sender never spelled. **What was wrong was that the refusal
  was silent.** Measured: every such document returned `negations: []` under
  `safeToSummarize: true`, with nothing on any channel to say a value had been looked at and
  declined, so a caller doing exactly what this readout says to do (branch on `negations`, not on
  the raw status string) read a procedure recorded as `"NOT-DONE"` as a procedure with nothing to
  say about it. So the position is named: the locations in `nearMissNegationCodes`,
  `safeToSummarize` is `false`, and `assertSafeToSummarize` throws. **The value is still not
  coerced, trimmed or case-folded.** Unlike the location channels above it nothing is
  dropped at parse time either: the value is in the model, at the element the location names, and
  what the library declines is the _classification_. That is **not** a promise the value reaches a
  convenience field, and the difference bites in two ordinary shapes: `status` /
  `verificationStatus` are root-scoped and single-valued while this channel is document-wide, so a
  near miss inside `contained` or a `Bundle.entry` leaves them holding the root's value or
  `undefined`; and `verificationStatus` surfaces the preferred-system coding, so a near miss in a
  second coding is not the code it shows. Walk the model at the location.
  **A near miss is suppressed where the same element also spells that code exactly**, since the
  negation is then classified: R4 permits translation codings beside the one from a required
  binding's value set, so a `verificationStatus` carrying `refuted` from the standard system and
  `REFUTED` from a local one is conformant and draws nothing. Suppressed per code, so a near miss of
  a _different_ code at that element still reports. The elements are the `code`-valued ones the negation read
  looks at, `status` and `verificationStatus`, at every resource root, which is the negation read's
  own window. The pairs come from the same table the matches are made from, so the report cannot
  cover a pair the read does not. `AllergyIntolerance.code` is deliberately outside it: SNOMED
  `716186003` "no known allergy" is a _positive_ assertion whose read is root- and type-scoped, and
  disclosing a near miss at every root would report the miss where an exact hit is read by nothing.
  Like the boolean channel above, it raises no `ValidationIssue` of its own, so it cannot move
  `valid` in either direction. **Empty on every conformant document read from JSON, bar one shape
  admitted rather than claimed away**: a `CodeableConcept` may carry translation codings beside the
  one a required binding's value set supplies, and R4 asks only that _one_ coding come from that set,
  so a translation whose code differs from a negation code **only by case** is conformant under that
  reading and is disclosed. Only the case half can be: a surrounding-whitespace value is outside
  `code`'s lexical space whatever coding carries it. Over-disclosure is the fail-safe direction. **In
  XML the
  whitespace half is a declared limit rather than a claim**: R4 derives `code` from `xs:token`,
  whose `whiteSpace=collapse` facet strips surrounding whitespace before validation, so
  `<status value=" not-done"/>` is schema-valid and a schema-validating consumer reads it as the
  code. This reader is schema-free and does not collapse, so it discloses rather than reads, which is
  the fail-safe direction.
- **Content written where a `code` belongs is reported, not read as an absent element.** FHIR JSON
  spells a `code` as a JSON string, so `{"resourceType":"Procedure","status":{"value":"not-done"}}`
  (a generic converter carrying FHIR XML's `value` attribute across as a member) and a `status`
  written as a number or a boolean hold no code this library may read. Measured, every one of them
  returned `negations: []` under `safeToSummarize: true`, so a procedure recorded as not done was
  indistinguishable from one that was carried out. **This is a shape, which is why the two channels
  above it did not catch it**: both ask about a written _value_, and an object holds no value at all,
  so both answered "no" about it truthfully and the element read exactly like one the sender left
  out. So the position is named: the locations in `unreadableNegationCodes`, `safeToSummarize` is
  `false`, and `assertSafeToSummarize` throws. **Nothing is read through the position**, deliberately:
  `{"value":"…"}` is FHIR _XML_'s spelling of a primitive, so descending into it would resolve a
  negation out of an encoding no version of FHIR defines for JSON. The element is `status`, at every
  resource root, which is the negation read's own window; the complement is carried in the same table
  the matches are made from and applied in the same loop, so it cannot cover an element the read does
  not. **Two datatypes reach a root `status`, and the question asked is about the shape rather than
  about which read succeeded, so that both are cleared**: R4 spells `status` a `code` on the
  overwhelming majority of types and a `CodeableConcept` on `MedicinalProductAuthorization` and
  `SubstanceSpecification`, R5 adds several more including a mandatory `DeviceAssociation.status`,
  and DSTU2 spells every one a `code`. So a complex **all of whose members** FHIR spells here (`coding`,
  `text`, `id`, `extension`) is left alone, whether or not a code came out of it, while **any**
  member outside that set is reported: `{"status":{"id":"s1","value":"not-done"}}` is the same
  converter output and is reported too. An object with **no** member at all is reported as well,
  `ele-1` requiring an element present in a resource to carry a value, children, or an extension. Keyed instead on "no string was read", this would refuse the
  published R4 `MedicinalProductAuthorization` example. The converse is a declared limit:
  a code buried under `{"coding":{…}}` at a type whose `status` is a `code` stays silent.
  **`verificationStatus` is deliberately outside it** for a related reason: its shape complement is a
  _primitive_ at the element, and `Condition.verificationStatus` is a `code` in DSTU2, so the same
  rule would report a conformant DSTU2 document. `AllergyIntolerance.code` is outside it for the
  reason that keeps "no known allergy" root- and type-scoped. Like the two channels above it this one
  raises no `ValidationIssue`, so it cannot move `valid` in either direction. **Empty on every
  conformant document this library has been measured against, in either wire format**: the XML reader
  models a `value` attribute beside `id` and `extension` children as a primitive, so a conformant
  `<status value="not-done"><extension …/></status>` is read; and a primitive whose value is _absent_
  is untouched, that being the conformant `data-absent-reason` shape and content the read never
  stepped over.
- **An element a sender explicitly does not know is now distinguishable from one it never sent.**
  A source system with no data for an element whose minimum cardinality is greater than zero cannot
  omit it, so it writes the element present, with no value, carrying the R4 DataAbsentReason
  **extension** and a reason code. Measured, both shapes reached a caller as the same answer: the
  element counts as present so no required-element finding fires, and every value read returns
  `undefined`, exactly as it does for an element nobody wrote. `absenceMarkers` is the read that
  recovers the difference, one `{ code, location }` per declared absence, on a complex element or on
  a primitive's extension metadata, in either wire format, at every depth (`contained` and
  `Bundle.entry` included). It **carries the reason the sender spelled**, so `unknown` is
  distinguishable from `masked`, `not-applicable` and `not-performed` on otherwise identical
  instances. `absenceMarkers(resource, path)` is the standalone collector.
  **This is the one location-bearing channel that leaves `safeToSummarize` standing**, and the
  exception is the point rather than a hole: a declaration the caller can now read is a disclosure,
  and refusing over it would withdraw an affirmation from a conformant document. **A report carries
  the reason and the location and nothing else**, the reason being one of fifteen literal strings
  this package spells (`ABSENCE_CODES`, the extension's own required-strength value set) rather than
  anything taken off the document.
  Its two neighbours behave like every channel above. **A reason outside that value set is refused,
  never folded into `unknown`**: FHIR `code` is case-sensitive and excludes surrounding whitespace,
  so `UNKNOWN` and `" unknown"` are not the code and coercing them would author a reason the sender
  did not spell. The element is not read as populated either; the location goes on
  `unreadableAbsenceMarkers`, `safeToSummarize` is `false`, and the validator raises
  `ABSENCE_MARKER_UNREADABLE` (error). **A marker beside a value on one element is a contradiction
  this library does not resolve**: both survive on the model and on the readout, the location goes on
  `conflictingAbsenceMarkers`, and `ABSENCE_MARKER_CONFLICT` (error) says they disagree rather than
  letting a consumer prefer whichever its own read reached first. A complex element "carries a value"
  when it holds any member beyond `id`, `url`, `extension`, `modifierExtension` and the JSON
  encoding's `resourceType`, none of which is a value a marker denies.
  **Two neighbouring shapes are deliberately NOT this.** The same concepts used as a `Coding` inside
  a coded element (`system` = the DataAbsentReason code system, `code` = `unknown`) are a present,
  conformant coded VALUE, not an absent element, and draw nothing here. Nor is the
  `Observation.dataAbsentReason` ELEMENT, an ordinary `CodeableConcept` whose `obs-6` invariant is
  unchanged: the element is not the extension, so an Observation carrying one draws exactly what it
  drew before and never both findings. Recognition is by the extension's **canonical URL** and
  nothing that resembles it, so an extension whose `url` is the code system URI instead is not a
  marker.
- **Neither writer will re-emit a document the reader MARKED** (`FhirSerializeError`, code
  `DROPPED_ELEMENT_TEXT`). Say "marked", not "whose text was dropped": character data that is
  `String.trim()`-empty is dropped with no flag, no marker and no finding, so a `<status>` holding
  only whitespace still emits `<status/>` and still re-reads clean. That gap is real, unchanged here,
  and noted below. This is the other half of the refusal, and it exists because the finding
  used to disappear across a round trip. `serializeResourceXml` emitted `<status/>` and a re-read of
  that output came back clean; `serializeResource` was worse, dropping the member outright, so a
  retracted `Observation` re-read as one that had never named a status. The error is value-free and
  carries the bounded FHIRPath `locations` it refused over, never the text it could not encode.
  Be precise about why `<status/>` is not a neutral fallback: xml.html §2.6.1 says _"FHIR elements are
  never empty. If an element is present in the resource, it SHALL have either a value attribute,
  child elements as defined for its type, or 1 or more extensions"_, so emitting it violates that
  SHALL.
  **The refusal is scoped to a model the reader MARKED, and to nothing else.** A document read from
  JSON has no character-data channel and is never affected; a conformant XML document round-trips
  byte-for-byte exactly as before. In particular, writing a value-absent primitive that carries **no
  extension** is still permitted and still emits `<status/>`: §2.6.1's third arm ("or 1 or more
  extensions") is satisfied by `<status><extension url="..."/></status>`, which is what a
  `data-absent-reason` emits, but an `id`-only primitive (`<status id="s1"/>`) has none of the three
  permitted contents and remains a **pre-existing** violation this change does not address. Keep the
  original document if you need the text itself; the library will not invent it for you.
- **Fail-closed on an unknown `modifierExtension`** (`UNHANDLED_MODIFIER_EXTENSION`, error): FHIR's
  `?!` rule; and **`entered-in-error` surfaced** as `RETRACTED_RESOURCE` (retracted, not data).
- **Invariants** `ait-1`/`ait-2`, `con-3`/`con-4`/`con-5`, `obs-6`/`obs-7`, hand-evaluated from their
  exact R4 FHIRPath by the always-on safety layer. This layer surfaces and enforces. It
  never reconciles contradictions or infers clinical meaning. Every **other** profile `constraint[]`
  invariant is evaluated by the FHIRPath engine (below).

And Quantity / UCUM fidelity: read a measured value by the type it actually is, and its unit by the
UCUM **`code`** a machine may act on (never the display string, and **never converted**):

```ts
import { parseResource, readObservationValue, validateResource } from "@cosyte/fhir";

// value[x] is an 11-way choice: a non-numeric result is never read as a number.
const { resource: titer } = parseResource(
  '{"resourceType":"Observation","status":"final","valueString":"POSITIVE"}',
);
const v = readObservationValue(titer);
v?.type; // → "String"     (NOT "Quantity")
v?.quantity; // → undefined (no number is fabricated)

// A vital sign's unit is checked on the UCUM code, case- and bracket-exact: "mmHg" is not "mm[Hg]".
const { resource: bp } = parseResource(
  '{"resourceType":"Observation","status":"final",' +
    '"category":[{"coding":[{"system":"http://terminology.hl7.org/CodeSystem/observation-category","code":"vital-signs"}]}],' +
    '"code":{"coding":[{"system":"http://loinc.org","code":"8480-6"}]},' +
    '"valueQuantity":{"value":120,"unit":"mmHg","system":"http://unitsofmeasure.org","code":"mmHg"}}',
);
validateResource(bp).issues.map((i) => i.code); // → ["VITAL_SIGN_UNIT_NONCONFORMANT"]  (should be "mm[Hg]")
```

- **`readObservationValue`** discriminates the 11 `value[x]` variants (`Quantity`, `CodeableConcept`,
  `String`, `Boolean`, `Integer`, `Range`, `Ratio`, `SampledData`, `Time`, `DateTime`, `Period`) by
  the one present. `quantity` is populated **only** for a `Quantity`. `readQuantity` keeps the coded
  unit (`code`/`system`) distinct from the human `unit`; `validateUcumShape` checks a code's shape.
- **Vital-signs required-unit** conformance (`VITAL_SIGN_UNIT_NONCONFORMANT`, error) against the FHIR
  profile's closed table, compared on the UCUM `code`; a UCUM-declared unit that is absent or malformed
  is `UCUM_UNIT_UNRECOGNIZED` (warning, preserved verbatim); a vital sign whose value is not a Quantity
  is `VALUE_TYPE_UNEXPECTED` (warning).
- **Dose `Quantity`** (`readMedicationDoses`) for MedicationRequest/Statement, and
  `interpretation` / `referenceRange` surfaced (`readInterpretations` / `readReferenceRanges`):
  **never** used to auto-convert a unit or compute an abnormal flag.

And terminology binding validation, strength-aware and **content-free**: validate a coding's code
`system` and its binding **strength** without bundling any SNOMED / CPT / LOINC concept tables, and
never raise a false error when no terminology service is configured:

```ts
import { parseResource, validateResource, type TerminologyService } from "@cosyte/fhir";

// AllergyIntolerance.code binds extensibly to a multi-system value set (RxNorm + SNOMED). An
// ICD-10-CM code is a KNOWN but unexpected system for this binding → a warning, never an error.
const { resource: allergy } = parseResource(
  '{"resourceType":"AllergyIntolerance",' +
    '"clinicalStatus":{"coding":[{"system":"http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical","code":"active"}]},' +
    '"code":{"coding":[{"system":"http://hl7.org/fhir/sid/icd-10-cm","code":"T78.40XA"}]}}',
);
validateResource(allergy).issues.map((i) => `${i.code}/${i.severity}`);
// → ["RESOURCE_NOT_MODELED/information", "CODE_SYSTEM_UNEXPECTED/warning"]  (valid stays true)

// Value-set membership needs content the library does not bundle. Supply a terminology service.
const svc: TerminologyService = {
  validateCode: ({ code }) => ({ membership: code === "7980" ? "in" : "not-in" }),
};
validateResource(allergy, { terminology: svc }); // now membership is checked against your service
```

- **Frozen known-systems registry** (`KNOWN_SYSTEMS`, `isKnownSystem`): the verified `system`
  URIs (LOINC, SNOMED, RxNorm, ICD-10-CM/9-CM, CPT, UCUM, NDC, CVX) as **identities, not content**.
  An unrecognized system is `CODE_SYSTEM_UNKNOWN` (`information`): not a defect, just unvalidatable.
- **Binding-strength severity:** `required` → error, `extensible` → error-unless, `preferred` →
  warning, `example` → information (an example binding **never** errors). A known system outside a
  binding's value set is `CODE_SYSTEM_UNEXPECTED` (strength-scaled); a service's definitive `not-in`
  is `CODE_NOT_IN_VALUESET`. Built-in **multi-system** bindings: allergy substance (RxNorm + SNOMED),
  medication (RxNorm).
- **Pluggable terminology service** (`TerminologyService`): the one seam for value-set content, and
  **none is bundled** (licensing). With none supplied, checks degrade to the content-free system
  level and **never false-error**; the service receives only identities, never a resource value.

And StructureDefinition-driven **profile validation** (US Core the target): snapshot generation,
slicing, `fixed[x]` / `pattern[x]`, and **must-support as a system obligation**. Like the terminology
layer it ships the _engine_, not the _content_: you supply the profiles (the published US Core /
vendor `StructureDefinition`s), and **nothing is bundled**.

```ts
import { loadStructureDefinition, parseResource, validateResource } from "@cosyte/fhir";

// Load a US Core profile (its published JSON) into a StructureDefinition.
const profile = loadStructureDefinition(parseResource(usCoreAllergyProfileJson).resource);

const { resource: allergy } = parseResource(
  '{"resourceType":"AllergyIntolerance",' +
    '"clinicalStatus":{"coding":[{"code":"active"}]},' +
    '"code":{"coding":[{"code":"227493005"}]},"patient":{"reference":"Patient/1"}}',
);

// verificationStatus is must-support and absent → information, NEVER an error (the resource stays valid).
const { issues, valid } = validateResource(allergy, { profiles: profile ? [profile] : [] });
valid; // → true
issues.map((i) => `${i.code}/${i.severity}`); // → ["MUST_SUPPORT_ABSENT/information", …]
```

- **Snapshot generation** (`generateSnapshot` / `snapshotElements`) walks `baseDefinition` and merges
  the differential onto the base snapshot: tightening matched elements by id, inserting slices, and
  failing closed (`FhirProfileError`) on an unresolvable base or a `baseDefinition` cycle. A caller
  supplies the base via a resolver; a profile that already ships a snapshot is used as-is.
- **Slicing** matches each occurrence of a sliced element to a slice by its discriminators. The R4
  set is `value | exists | pattern | type | profile` (**`position` is R5-only** and excluded). What
  needs a FHIRPath engine (`type` / `profile` discriminators, reslicing) is reported
  `PROFILE_SLICE_UNCHECKED` (`information`): **never silently passed**. An unmatched occurrence under
  `closed` slicing is `PROFILE_SLICE_UNMATCHED` (error); a missing required slice is `CARDINALITY_MIN`.
- **`fixed[x]` vs `pattern[x]`** (`matchesFixed` / `matchesPattern`): `fixed` is exact equality
  (nothing extra), `pattern` is a subset (extras allowed); decimals compared precision-exactly, never
  via a float. A mismatch is `PROFILE_FIXED_MISMATCH` / `PROFILE_PATTERN_MISMATCH` (error).
- **Must-support is a system obligation, not instance-presence**: an absent must-support element is
  `MUST_SUPPORT_ABSENT` at **`information`, never an error**. A strict client that rejects an absent
  must-support element is the classic interop bug this rule exists to prevent.
- **Multi-version**: a `meta.profile` `canonical|version` pin the supplied set carries at a different
  version is `PROFILE_VERSION_MISMATCH` (warning) rather than a silent best-effort validation.
- **Invariants**: the profile's `constraint[]` (FHIRPath) are evaluated by a **bounded, vendored
  FHIRPath engine** (`tokenize` / `parseFhirPath` / `evaluateInvariant`; no runtime
  dependency). A violated constraint is `INVARIANT_VIOLATED` (severity mirroring its `error` |
  `warning`); an expression outside the subset raises `UnsupportedFhirPathError` and is reported
  `INVARIANT_UNCHECKED` (`information`): **surfaced, never assumed to pass**. The seven named safety
  invariants stay owned by the always-on safety layer; the engine covers every other constraint.
- **Deferred:** the bundled multi-version US Core IG corpus and the `validator_cli.jar` differential
  (a JVM dev/CI job); the `type` / `profile` slicing discriminators and reslicing (still
  `PROFILE_SLICE_UNCHECKED`: a genuine fail-safe deferral, they need per-occurrence type carriage /
  recursive profile resolution). Every finding is **value-free** (a code + a FHIRPath location,
  never the value).

```ts
import { evaluateInvariant, parseResource } from "@cosyte/fhir";

// The bounded FHIRPath engine, judged by the reference validator's boolean coercion.
const { resource } = parseResource(
  '{"resourceType":"Observation","valueString":"x","dataAbsentReason":{"text":"n"}}',
);
evaluateInvariant("dataAbsentReason.empty() or value.empty()", resource, resource);
// → { unchecked: false, satisfied: false }  (obs-6 violated: value AND dataAbsentReason both present)

evaluateInvariant("descendants().count() > 0", resource, resource);
// → { unchecked: true, satisfied: false }  (descendants() is outside the subset, never a false pass)
```

**Authoring a profile in code: `defineProfile()`.** You don't have to hand-write
`StructureDefinition` JSON. `defineProfile(spec)` builds one from an ergonomic spec and returns the
**same model** `loadStructureDefinition` produces, so it flows straight into
`validateResource({ profiles })`. There is **one authoring path, no privileged internal shape**: the
built-in starter profiles are `defineProfile()` calls, exactly what you write. As a conservative
writer it throws a value-free `InvalidProfileError` on an author mistake (a missing `url` / `type` /
element `path`, a bad cardinality, a `max` below `min`).

```ts
import { defineProfile, parseResource, primitive, validateResource } from "@cosyte/fhir";

const finalOnly = defineProfile({
  url: "https://example.org/StructureDefinition/final-observation",
  type: "Observation",
  differential: [
    { path: "Observation.status", fixed: { type: "Code", value: primitive("final") } },
  ],
});

const { resource } = parseResource('{"resourceType":"Observation","status":"preliminary"}');
validateResource(resource, { profiles: [finalOnly] }).issues.map((i) => i.code);
// → ["PROFILE_FIXED_MISMATCH", …]
```

A publishable **profile starter kit** ships as worked examples / templates you extend:
`VITAL_SIGN_OBSERVATION_STARTER` (required `status`, must-support `code`, and a **sliced** `category`:
a required `VSCat` slice pins the `vital-signs` coding while the open slicing still allows other
categories, the way the real profile does) and `PATIENT_IDENTIFIER_STARTER` (`identifier` / `.system`
/ `.value` required + must-support, deliberately **no** MRN slice), plus `STARTER_PROFILES`,
`starterProfile(url)`, and `STARTER_PROFILE_BASE_URL`. Each is grounded in a public FHIR / US Core
spec page, self-contained (differential-only, no bundled base), and clearly a template, **not** an
authoritative vendor conformance statement.

```ts
import { STARTER_PROFILES, parseResource, validateResource } from "@cosyte/fhir";

const { resource } = parseResource(vitalSignObservationJson);
validateResource(resource, { profiles: [...STARTER_PROFILES] });
```

- **Real-world quirk corpus + differential.** Five quirk fixtures
  (`test/__fixtures__/quirk-*.json`), each **grounded in a public artifact** and cited in
  `test/quirk-corpus.test.ts`: a non-first `resourceType` (json.html), a scientific-notation decimal
  preserved byte-exact (Synthea #675), a primitive-extension `_`-sibling misalignment that **fails
  closed** (HAPI #5738), a searchset Bundle `link[next]` that survives the round-trip
  (bundle-example.json), and US Core race + birthsex extensions preserved on a base Patient. The
  `validator_cli.jar` differential (CI-only) runs over this corpus too. **Values are synthetic;** a
  genuinely vendor-**proprietary** deviation absent from every public sample stays grounded-only. It is
  never invented. Missing-must-support and version-drift quirks are covered by the profile suite.
