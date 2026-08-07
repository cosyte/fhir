<a href="https://cosyte.com">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://cosyte.com/tile/cosyte-lockup-tile-on-dark-1200x300.png">
    <img alt="Cosyte: a plus mark set in two overlapping rounded squares, one solid and one outlined, beside the Cosyte wordmark" src="https://cosyte.com/tile/cosyte-lockup-tile-on-light-1200x300.png">
  </picture>
</a>

# @cosyte/fhir

> Developer-focused FHIR toolkit for Node.js and TypeScript: an **R4-first** resource model, a
> JSON **and XML** codec, and validation, with the same one-line ergonomics as the rest of the
> `@cosyte/*` parser suite.

**Status: pre-alpha, unpublished.** What is built: the no-data-loss core (a
precision-preserving JSON codec and typed primitive model), the first three validation layers
(structure, cardinality, and primitive/enumerated-`code` value-domain) with value-free
`OperationOutcome` output, the **safety-critical status & negation model** (`readSafety`,
fail-closed on unknown `modifierExtension`, the `ait`/`con`/`obs` invariants), **Quantity / UCUM
fidelity** (the 11-way `Observation.value[x]` discrimination, UCUM-`code` unit fidelity, vital-signs
required-unit conformance, dose quantities), **strength-aware, content-free terminology binding
validation** (a frozen known-systems registry, binding-strength severity, the multi-system allergy /
medication bindings, and a pluggable terminology-service interface, none bundled),
**StructureDefinition-driven profile validation** (snapshot generation, slicing, `fixed[x]` /
`pattern[x]`, and must-support as a system obligation, against caller-supplied US Core / vendor
profiles, none bundled), and **profile-invariant validation through a bounded, vendored FHIRPath
subset** (an in-repo lexer → parser → evaluator that evaluates a profile's `constraint[]`, reporting
anything outside the subset `INVARIANT_UNCHECKED` rather than passing it), and a **zero-dependency XML
codec** (`parseResourceXml` / `serializeResourceXml`) that reads and writes the same schema-free model
as the JSON codec, with a reader that is **XXE- and billion-laughs-proof by refusal** (any DTD or
non-predefined entity is refused loudly, never resolved or expanded) and a `nodesEquivalent` oracle for
JSON↔XML model equivalence, and **Bundles + references + Bulk NDJSON streaming** (`readBundle` with
**transaction = all-or-nothing vs batch = independent** semantics: modeled, never executed; reference
resolution for relative / absolute / logical / `#fragment` with a **DoS-safe cycle guard**; and a
`streamNdjson` reader with **per-line error isolation** and **no whole-file load**), and a
**programmatic profile-authoring API** (`defineProfile()` builds a `StructureDefinition` in code: the
same model `loadStructureDefinition` reads from JSON, one path with no privileged internal shape, plus
a spec-grounded **starter kit** of example profiles that dogfood it), and **conformance hardening**:
JSON + XML + NDJSON **fuzz targets** proving adversarial input never
crashes / hangs / OOMs (only a _typed_ error or a bounded rejection; the JSON reader now bounds nesting
with a `MAX_DEPTH_EXCEEDED` fatal, matching the XML reader), a **PHI-leak test tier** gating the
value-free-diagnostics contract, and **type-level (`expect-type`) tests** on the public surface. See
[What works today](#what-works-today). It **reads, round-trips,
structurally validates, never drops a modifier / status / negation, surfaces measured values by their
true type with the UCUM `code`** (never the display string, never converted), **validates code systems
and binding strength without vendoring any SNOMED / CPT / LOINC content, validates against US Core
profiles you supply, and evaluates their FHIRPath invariants** (failing safe to `INVARIANT_UNCHECKED`
on any unsupported expression); it does **not** yet do `type`·`profile` slicing discriminator or
reslicing validation (still `PROFILE_SLICE_UNCHECKED`), and it bundles **no** US Core
IG corpus. The `validator_cli.jar` **differential is authored but CI-only** (a JVM oracle job: there is
no Java in the dev container, so it has not been observed green there) and now runs over **both** the
synthetic spec-clean corpus **and** the real-world quirk corpus. The built-in structural schema set is the base-resource elements plus
`Patient` as a worked demonstrator; other resource types validate only against a caller-supplied schema
or profile. Without a supplied terminology service there is **no code-validity / value-set-membership**
guarantee beyond `system` + strength (no terminology content is bundled: licensing). Its XML codec is
schema-free like the JSON one, so an XML-sourced primitive is kept as its lexical string and **typed
cross-format transcoding** (emitting spec-clean JSON booleans/numbers from an XML model) needs the
datatype schema and is not yet done; the XHTML **structure** inside `Narrative.div` is not modeled or
validated (carried opaquely as a string (the JSON codec's fidelity), never dropped), and RDF/Turtle is
out of scope. It has no typed per-resource models
yet, and it **never converts a unit** or evaluates a reference range. Do not depend on this package.

## What works today

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
  value of its own, and it emits spec-clean FHIR for every model FHIR can express; the three shapes it
  cannot express (an array inside an array, a scalar or `null` where FHIR JSON has an object, and a
  non-string `resourceType`) are handed back as written
  rather than repaired, because repairing them means inventing or dropping content. See the
  no-data-loss notes below.
- **A repeated property name is read, not resolved.** FHIR requires unique property names and JSON
  leaves the winner undefined, so the first value wins everywhere and a `DUPLICATE_PROPERTY` issue
  says where. On an **object** element both values are kept (`getAllProperties` reads them,
  `getProperty` still returns the first), the element is treated as genuinely ambiguous, and nothing
  downstream pretends otherwise: it validates as an error, and the safety readout declines to
  summarize it rather than answering from one arbitrary half of the document. Inside a **primitive's
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
  `Patient`; supply your own via `validateResource(resource, { schemas: [...] })`.

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
  `no-known-allergy`, `do-not-perform`, `not-taken`, `not-done`, `entered-in-error`) across the six
  safety resource types. `assertSafeToSummarize` **refuses** (throws) rather than flatten past an
  unhandled modifier.
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
  define and hand it back with no diagnostic anywhere, so the read never runs ahead of the report on
  anything that reaches a verdict.
  **One asymmetry is deliberate and worth stating rather than glossing:** the `ARRAY_WRAPPED_SCALAR`
  location is only emitted on a resource of one of the safety types, while the retraction and
  refutation reads are not type-gated, so on some other resource type a wrapped
  `verificationStatus.coding.code` is read without a location being reported. That is the fail-safe
  direction on purpose: those reads can only ever **add** a retraction or a negation, never withhold
  one, and no type-scoped verdict is reached for such a resource anyway. Narrowing the read to match
  the report would make `isRetracted` miss retractions it currently catches.
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
  **One gap, stated rather than implied:** the rule is bounded by what the reader modeled. A
  `_`-sibling the reader discards whole because it is misplaced or unrecognised (one sitting on an
  object or a non-primitive array, or a member of a `_`-sibling object that is neither an `id`
  **string** nor an
  `extension` array) leaves no node behind, so an array inside one draws the unexpected-property
  warning for the discarded sibling and no refusal. Reaching it would mean reading raw JSON the codec
  does not model, which is the same problem as making the value readable.
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

### XML codec and cross-format equivalence

A **zero-dependency** FHIR XML codec that reads and writes the **same schema-free model** as the JSON
codec, so a resource is equivalent whichever wire format it arrived in. The hand-written reader is
**XXE- and billion-laughs-proof by refusal**: it refuses any `<!DOCTYPE` (a DTD is the only place XML
can declare an entity) and any entity reference beyond the five predefined names and numeric character
references, performs no I/O, resolves no URI, and bounds nesting depth. Adversarial input is a typed
`FhirXmlError`, never a hang, OOM, fetch, or crash.

- **`parseResourceXml`** returns the same `ReadResult` (`{ resource, issues }`) as `parseResource`,
  mapping the FHIR XML conventions (element name → `resourceType`, `value` attribute → primitive value
  kept as its lexical string, `id`/`extension` co-located, repeated elements → a list, resource-valued
  elements unwrapped, narrative `Narrative.div` carried opaquely as its full XHTML string, the FHIR
  JSON representation, so it round-trips as `<div>…</div>`, never dropped). Lenient: an
  unexpected namespace or stray text draws `UNEXPECTED_XML_CONTENT` and the document is never rejected.
  **Lenient is not lossless there:** an element in another namespace is modeled and flagged, but
  character data written directly on a FHIR element is dropped and flagged, because a FHIR element
  carries its value in the `value` attribute and the model has no slot for text.
  **Names are namespace-resolved, so a prefix is a spelling and not part of the name.** FHIR XML is
  defined in the `http://hl7.org/fhir` namespace, and a document may bind that namespace to a prefix
  instead of making it the default, so `<f:Patient xmlns:f="http://hl7.org/fhir">` and
  `<Patient xmlns="http://hl7.org/fhir">` are the same resource and read to the same model. The
  in-scope declarations are tracked as the reader descends, including a prefix rebound partway down.
  A prefix nothing in scope binds is not resolvable, so the tag is kept exactly as written and
  flagged rather than guessed at. **The narrative `<div>` is the one element FHIR requires in a
  namespace other than its parent's, so it is recognised by its expanded name
  (`{http://www.w3.org/1999/xhtml}div`) under every spelling**, and is not flagged for being there.
  It is carried as an opaque string together with the namespace declarations it inherited from its
  ancestors **and uses**, so the fragment stands on its own; the document's own spelling is preserved
  rather than rewritten, which makes a prefixed narrative namespace-equivalent to the default
  spelling and not byte-identical to it. A `div` in another namespace is kept out of `Narrative.div`
  only where its tag carries a **prefix**: an unprefixed `<div xmlns="urn:vendor">` is spelled exactly
  like the FHIR one, so it reaches that slot and is reported, not separated. **The narrative is
  recognised before a resource-valued element is unwrapped**, because the content of `Narrative.div`
  is XHTML and the unwrap's UpperCamelCase test is a way of spelling a FHIR resource type: applied
  inside a narrative it read `<div xmlns="…xhtml">Take 5 mg<BR/></div>` as a contained `BR` resource
  and destroyed the prose, and HTML-4-era generators do emit `<BR>`, `<TABLE>`, `<P>`. Nothing is
  shadowed by that order: `div` names exactly one element in R4. Reading the narrative
  means its contents are no longer modeled as FHIR, so a narrative spelled with a prefix, or holding
  a capitalized child, reads as the same document written the other way reads, including where that
  is quieter. The one way it reads
  differently is **louder**: a document holding the narrative under both spellings at once is one
  element written twice, so it draws `MIXED_XML_SPELLING`, which the all-default twin does not.
  Every element the reader **models** is tested once for being in a namespace other than its parent's,
  and reported when it is. A **prefixed** one additionally keeps its tag, and since no FHIR element
  is spelled `v:code`, that is what keeps it out of the FHIR element beside it. Content reached by a
  **default** declaration (`<extension xmlns="urn:vendor">`) is spelled exactly like the FHIR element,
  so it is modeled as one and reported rather than separated. A child element written beside a
  `value` attribute is not modeled at all: it is discarded and reported `UNKNOWN_PROPERTY`, so a
  foreign one there draws no namespace report.
  Two prefixes bound to the same namespace are two spellings of one name, so an element written twice
  that way reads as the repeat it is. The model matches the same document spelled one way; only the
  number of occurrences differs, so that element carries `MIXED_XML_SPELLING`. Nothing is lost, but a
  check that reads a `0..1` element as a single value gets nothing from a repeat, and that should
  never be silent. **That report compares the expanded name, not the tag alone**, so it also covers
  the merges where the tag is the same and the namespace is not. Two of those are worth naming
  because a document can reach them while otherwise reading as conformant: a prefix rebound between
  siblings (`<p:x xmlns:p="urn:a"/>` beside `<p:x xmlns:p="urn:b"/>`), and a `<div/>` in the FHIR
  namespace landing in `Narrative.div` beside the real XHTML narrative, which is the one that costs
  the most because `Narrative.div` is `0..1`. A **foreign** element reached by a **default** `xmlns`
  re-declaration groups with its FHIR namesake the same way, and there the group already carried
  `UNEXPECTED_XML_CONTENT`. A FHIR-namespace one carries no such flag, which is exactly why this
  report is the one that covers the narrative case.
- **`serializeResourceXml`** emits compact, spec-clean FHIR XML that round-trips a spec-clean document
  **byte-for-byte** (decimals byte-exact, never through a `number`). It throws `FhirSerializeError`
  rather than emit a model the reader marked as having lost character data, so that finding cannot
  vanish across a round trip; `serializeResource` refuses the same models for the same reason. Text
  the reader drops **without** marking (whitespace only) is not covered, because there is no marker.
- **A `div` property is written back as raw markup, and that markup is checked at the branch that
  writes it** (`UNSERIALIZABLE_DIV_MARKUP`). `Narrative.div` is carried as an opaque XHTML string and
  emitted verbatim, so whatever the string spells becomes markup in the output. It is written only
  when it parses as exactly one element whose local name is `div`; anything else is refused, because
  a string that closes its own element and opens siblings puts elements into the document that the
  sender never wrote. The shape that decided it: a `div` on an `AllergyIntolerance` spelled
  `<div xmlns="…xhtml">ok</div></text><code><coding>…716186003…</coding></code><text>` used to emit
  spec-clean FHIR XML that re-read with `noKnownAllergy: true` and a `no-known-allergy` negation over
  a record that had asserted nothing, with no diagnostic at either end. **Well-formedness alone is
  not the line**: `<status value="final"/>` is one well-formed element, and writing it for a property
  named `div` authors a status. `serializeResource` carries the string as a string and is the route
  that stays open. Passing the check is not a claim that the round trip is lossless from there: a
  root whose prefix nothing binds is accepted and re-reads as a different property, the same
  unbound-prefix gap named above for element names.
- **`nodesEquivalent`** is the JSON↔XML equivalence oracle, equal _modulo_ the two irreducible
  schema-free ambiguities and only those: primitive lexical form (JSON `true`/number tokens ≡ XML
  `value`-attribute strings) and singleton lists (an array-of-one ≡ a single repeated element).

```ts
import {
  parseResource,
  parseResourceXml,
  serializeResourceXml,
  nodesEquivalent,
} from "@cosyte/fhir";

const xml =
  '<Patient xmlns="http://hl7.org/fhir"><active value="true"/>' +
  '<name><given value="Jane"/></name></Patient>';

const fromXml = parseResourceXml(xml).resource;
const fromJson = parseResource(
  '{"resourceType":"Patient","active":true,"name":[{"given":["Jane"]}]}',
).resource;
nodesEquivalent(fromXml, fromJson); // true: same model from either wire format
serializeResourceXml(fromXml) === xml; // true: spec-clean round-trip

// The reader refuses an XXE / entity-expansion attack loudly, never resolving or expanding it:
parseResourceXml('<!DOCTYPE x [ <!ENTITY e SYSTEM "file:///etc/passwd"> ]><Patient/>');
// throws FhirXmlError { code: "DTD_FORBIDDEN" }
```

### Bundles, references, and Bulk NDJSON streaming

Read a `Bundle` into an explicit readout with the one semantic distinction a consumer must never blur
(**`transaction` is all-or-nothing, `batch` is independent**), resolve the references inside it with a
**DoS-safe cycle guard**, and stream a Bulk Data `$export` line by line with **per-line error isolation
and no whole-file load**. The Bundle _artifact_ and its semantics are modeled; a transaction is **never
executed** (there is no server here).

- **`readBundle` / `entryProcessing` / `isAtomicBundle`**: the `Bundle.type` (`BUNDLE_TYPES`) and its
  entry-processing contract: `transaction` → `"atomic"` (all-or-nothing), `batch` → `"independent"`,
  everything else → `"none"`. `Bundle.total` is a lexical string, never a JS `number`.
- **`resolveReference` / `buildBundleIndex` / `containedIndex`**: resolve relative / absolute /
  logical / `#fragment` references against a Bundle + `contained` closure. A local miss is
  `"unresolved"` (flagged, preserved); an external target is `"external"` (never false-flagged).
- **`hasContainedCycle` / `MAX_REFERENCE_DEPTH`**, a bounded, iterative (heap-based) cycle guard: a
  `contained` reference cycle is **detected and reported, never followed**: no infinite loop, no stack
  blow-up, no false positive on a legitimate DAG.
- **`streamNdjson` / `parseNdjsonLine`**: a streaming `application/fhir+ndjson` reader over any chunk
  iterable, one resource per line, each read through the precision-preserving codec (a decimal never
  through a `number`). A malformed line is isolated (reported by **line number, never content**), the
  stream continues, and memory stays bounded (`LINE_TOO_LONG`).
- **New findings** (in `validateResource` for a `Bundle`): `REFERENCE_UNRESOLVED` (warning, preserved),
  `CONTAINED_CYCLE` (error), `FULLURL_ID_MISMATCH` (error: a `urn:uuid` fullUrl is exempt). All
  value-free (a FHIRPath location, never a value, reference, or id).

```ts
import { parseResource, readBundle, validateResource, streamNdjson } from "@cosyte/fhir";

const { resource } = parseResource(
  '{"resourceType":"Bundle","type":"transaction","entry":[' +
    '{"fullUrl":"urn:uuid:1","resource":{"resourceType":"Patient","id":"1"},' +
    '"request":{"method":"POST","url":"Patient"}}]}',
);

readBundle(resource).atomic; // true: a transaction is all-or-nothing (a batch would be false)

// A contained reference cycle is a bounded, typed finding, never an infinite loop:
const { issues } = validateResource(
  parseResource(
    '{"resourceType":"Bundle","type":"collection","entry":[{"resource":' +
      '{"resourceType":"Observation","id":"o","contained":[' +
      '{"resourceType":"Observation","id":"a","hasMember":[{"reference":"#b"}]},' +
      '{"resourceType":"Observation","id":"b","hasMember":[{"reference":"#a"}]}]}}]}',
  ).resource,
);
issues.some((i) => i.code === "CONTAINED_CYCLE"); // true

// Stream a Bulk NDJSON export without loading the file; a bad line is isolated, not fatal:
for await (const record of streamNdjson(readableChunks)) {
  if (record.error)
    console.warn("bad line", record.error.line); // line number, never content
  else handle(record.resource);
}
```

## What this will be

FHIR is HL7's modern, resource-oriented interoperability standard, the format behind the US
regulatory push (ONC HTI-1 binds §170.315(g)(10) to **FHIR R4 + US Core + SMART on FHIR**).
`@cosyte/fhir` is the FHIR member of the cosyte parser family: a small, zero-runtime-dependency
TypeScript library that reads and writes FHIR, models its resources with correct primitive
semantics, and validates against structural rules and US Core profiles, mirroring the API shape of
[`@cosyte/hl7`](https://github.com/cosyte/hl7), the reference parser.

## Architecture decisions

The decisions that shape everything downstream:

- `decimal` / `integer64` are **string-backed** and preserve lexical precision. `0.010` is never
  silently normalized to `0.01`, and these primitives never round-trip through JS `number`.
- **FHIRPath**: a bounded, vendored subset in-repo, no runtime dependency, no full third-party
  engine.
- **R4-first** (`4.0.1`), the US regulatory anchor. R5 and DSTU2 are **read-tolerance only**.

## Tech stack

Inherited from the shared `@cosyte/*` standard, by depending on the published `@cosyte/*` config
packages, not by copying files:

- **TypeScript** (strict) via `@cosyte/tsconfig`, target **ES2023**, `NodeNext`.
- **Dual ESM + CJS + `.d.ts`** build via `tsup` (`@cosyte/tsup-config`); `attw` is a publish gate,
  run through `scripts/attw.mjs`. The wrapper is there because the `attw` CLI prints "This package
  does not contain types." and then exits **0**, so a tarball that lost its declarations passed the
  gate. It checks that every artifact path `package.json` promises exists before the run, and
  treats an untyped report afterwards as a failure.
- **Node >= 22**; package manager **pnpm 10**.
- **ESLint 10** (`@cosyte/eslint-config`) + **Prettier** (`@cosyte/prettier-config`), lint at
  `--max-warnings=0`.
- **Vitest 4** + v8 coverage (`@cosyte/vitest-config`).
- **Zero runtime dependencies.**
- **License:** MIT.

## Development

```bash
pnpm install
pnpm build       # dual ESM + CJS + .d.ts
pnpm typecheck
pnpm lint
pnpm test
```

Every meaningful change gets a Changeset (`pnpm changeset`, `patch` on the `0.0.x` ladder) and a
`CHANGELOG.md` `[Unreleased]` entry. See [`CONTRIBUTING.md`](CONTRIBUTING.md).

## License

[MIT](LICENSE) © Cosyte
