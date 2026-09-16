# XML codec and cross-format equivalence

Part of the capability readout for `@cosyte/fhir`, linked from the README.

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
- **`serializeResourceXml`** emits compact FHIR XML that round-trips a spec-clean document
  **byte-for-byte** (decimals byte-exact, never through a `number`). **Its output is not
  _unconditionally_ spec-clean**: a prefixed name is written with no declaration to bind it and a
  non-conformant name verbatim, so `<v:x value="1"/>`, `<a&b/>` and `<1abc/>` are all emitted, and the
  byte-for-byte claim is scoped to a spec-clean input (a `<div>x</div>` carrying no XHTML namespace
  comes back as `<div xmlns="http://hl7.org/fhir">x</div>`, the FHIR namespace rather than the XHTML
  one the conformant repair would use). It throws `FhirSerializeError`
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
- **A shape only FHIR JSON can spell is refused rather than emitted as an empty element**
  (`UNSERIALIZABLE_JSON_ONLY_SHAPE`). The JSON reader marks four positions FHIR JSON gives no meaning
  to and keeps what the sender wrote there, so `serializeResource` hands it back and re-reading the
  output reproduces the finding: an array inside an array, a scalar or `null` where FHIR JSON has an
  object, that same shape in a primitive's `_`-sibling, and a `null` in a primitive's value channel
  that padded nothing. **XML has none of those channels**: no array of arrays, no `_`-sibling (a
  primitive's metadata is co-located as an `id` attribute and child `<extension>` elements), and no
  `null` at all. So this writer used to emit the node the reader was left holding, and that output
  re-reads with an empty issue list, and three of the four also `valid: true`. `{"value":null,"unit":"mg"}` came back through XML as a `Quantity` carrying a unit
  and **no magnitude**, with an empty issue list; `{"name":[[{"family":"Roe"}]]}` came back with the
  name gone and `safeToSummarize` flipped from `false` to `true`. Refusing, because there is nothing
  to hand back into and inventing an XML spelling would author markup nobody wrote. **Only a model
  read from JSON reaches it**: XML cannot write any of those shapes, so a document read from XML
  carries no marker and nothing that round-trips today stops. `serializeResource` writes all four
  back at every position that writer walks, and the re-read reproduces the finding. **It does not
  walk a member a repeated property name shadowed, and this refusal does reach one**, so that is the
  refusal's own limit rather than a route the shape always survives; `DUPLICATE_PROPERTY` and the
  safety refusal are what carry such a document, which is refused outright now rather than
  narrowed. **Value-exact, not byte-exact**, which is the same
  limit the preserved text carries everywhere else in this README:
  `{"performer":[{"reference":"Practitioner/1"},"Practitioner\/2"]}` comes back with the second
  member spelled `"Practitioner/2"`, the same string in different bytes. Only the value-channel
  `null` family is byte-identical, because a `null` has no escaping to lose. That the route stays
  open is a statement about these shapes, not about the whole model. **Not** closed by it, and pinned rather than implied:
  a JSON decimal comes back from XML as a string because XML carries no JSON type.
- **An array wrapper XML cannot spell back is refused rather than flattened away**
  (`UNSERIALIZABLE_ARRAY_WRAPPER`). FHIR JSON writes a single-valued element as a name/value pair and
  reserves the array for a repeating one (json.html §2.6.2.2), so `{"status":["entered-in-error"]}` is
  a shape the spec does not define: it is reported as an error-severity `ARRAY_WRAPPED_SCALAR` and
  `safeToSummarize` is `false` over it, because a single-value read finds no string in it at all. FHIR
  XML spells a repeat by **repeating the element** and carries no other mark for one, so a wrapper of
  fewer than two items used to emit at most one element and re-read as an ordinary single-valued
  element: that document came back with `arrayWrappedScalars: []`, `safeToSummarize: true`,
  `valid: true` and an empty issue list, and a wrapped `resourceType` came back as `<Resource>`, the
  type gate every type-scoped read stands behind gone with it. **A writer cannot decide cardinality
  in general and this one does not
  try**: there is no per-resource model here, and a name-only rule would emit a false error on a
  conformant document (`Questionnaire.code` and `ElementDefinition.code` are `0..*` in R4). So this
  takes its cardinality from the one window that already has one, the locations
  `arrayWrappedScalars` reports, and inside it refuses the wrappers XML cannot write back as a
  wrapper: **fewer than two items**, plus **any** wrapper on `resourceType`, where the type is the tag
  and a tag cannot be repeated. **A wrapper of two or more items elsewhere is deliberately left
  alone**: it is written as repeated elements, the re-read groups them into a list and the location is
  reported again, so refusing it would withdraw a round trip that works today _and_ keeps the finding.
  That is a statement about which wrappers this refuses, not a claim that every wrapper it lets
  through survives. `serializeResource` writes the wrapper back and is the route that stays open.
  **Not** closed by it: a wrapper that only a **shadowed** member carried is the repeated-property-name
  case rather than this one, and both writers now refuse it (on whichever of the two codes is raised
  first, which is this one where the wrapper is itself unspellable); and the window does not reach
  `Observation.value[x]`, a `0..1` choice whose wrapper still launders.
- **A member a repeated property name shadowed is refused, by BOTH writers**
  (`UNSERIALIZABLE_SHADOWED_PROPERTY`). The reader keeps it, validation raises an error over it and
  `safeToSummarize` is `false`: **all three about the input**. Each writer walks the surviving
  members only, so `{"resourceType":"Observation","status":"final","status":"entered-in-error"}`
  used to come back as `{"resourceType":"Observation","status":"final"}` and
  `<Observation xmlns="http://hl7.org/fhir"><status value="final"/></Observation>`: both re-read with
  an empty issue list, `valid` and `safeToSummarize` both `false → true`, and **the retraction in
  neither output**. Which member is lost depends only on the order the sender wrote them in.
  **Handing both back is not the alternative it looks like**: `JSON.parse` resolves a repeated name
  last-wins where this library reads first-wins, so emitting both members hands every other consumer
  the member this one calls shadowed. XML can repeat an element, but two repeated elements re-read as
  a **list**, a repeating element nobody wrote. The window is `shadowedProperties`, the same call
  validation raises its error from, so a model refused here already reads `valid: false`. **Not**
  closed by it, and measured rather than implied: a repeated name inside a primitive's `_element`
  metadata is not modeled at all, and one inside a complex in a primitive's `extension` is still
  dropped by both writers, and that document reads `valid: true`, so refusing it would withdraw a round
  trip from a model this library reports as clean.
- **A `resourceType` with no string in it is refused rather than deleted and the tag substituted**
  (`UNSERIALIZABLE_RESOURCE_TYPE`). FHIR XML has no `resourceType` element: the type IS the tag
  (xml.html). So this writer skips that property at every element it walks and takes the tag from the
  property's string value, and where there is no string to take the root used to fall back to
  `Resource`. `{"resourceType":{"modifierExtension":[{"url":"http://example.org/x"}]},"status":"final"}`
  reads `RESOURCE_TYPE_UNKNOWN` at error severity with `valid: false`, and `safeToSummarize: false`
  for the unhandled modifier extension the type gate carries; it came back as
  `<Resource xmlns="http://hl7.org/fhir"><status value="final"/></Resource>`, which re-reads with an
  empty issue list, `valid` and `safeToSummarize` both `true`, and no modifier extension anywhere. The
  property is gone from the output and the element claims a type nobody wrote. **Neither repair is
  available**: writing `<Resource>` is what launders, and it authors the type gate every type-scoped
  safety read runs behind; coercing the value to a string authors a different type out of content the
  sender wrote at another shape. **The predicate reads the FIRST `resourceType` an element wrote**,
  because that is the one the writer names the tag from. **Two shapes are deliberately left**: an
  element that wrote **no** `resourceType` is untouched, because a typeless complex is named
  `Resource` by documented fallback and nothing is deleted there; and an element whose **first** one
  IS a string keeps its tag, so the substitution never happens and what drops there is the
  repeated-property-name case. The
  bound is structural rather than a verdict: at the root this costs a round trip only for a model
  already `valid: false`, but deeper no layer checks a nested element's type and a document read from
  XML reaches it, so what is withdrawn at every refused location is a **deletion** rather than a round
  trip. `serializeResource` emits a non-string `resourceType` through its ordinary path and is the
  route that stays open. **Not** closed by it: a JSON decimal still comes back from XML as a string,
  and `Observation.value[x]` is still outside the array-wrapper window.
- **`nodesEquivalent`** is the JSON↔XML equivalence oracle, equal _modulo_ the two irreducible
  schema-free ambiguities and only those: primitive lexical form (JSON `true`/number tokens ≡ XML
  `value`-attribute strings) and singleton lists (an array-of-one ≡ a single repeated element).

```ts
import {
  parseResource,
  parseResourceXml,
  serializeResource,
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
nodesEquivalent(fromXml, fromJson); // true: equivalent, not identical (see the two moduli above)
serializeResourceXml(fromXml) === xml; // true: spec-clean round-trip

// Equivalent is not identical, and re-serializing to JSON shows both moduli at once: `active` is
// the string "true" (XML carries every primitive as attribute text and the reader is schema-free,
// so a decimal is likewise its exact text where JSON gives a FhirDecimal), and `name` / `given` are
// single nodes rather than arrays. Precision survives either way, and `readQuantity` reads a
// magnitude in either form, but the datatype validator reads a lexical boolean as a type mismatch.
serializeResource(fromXml); // → '{"resourceType":"Patient","active":"true","name":{"given":"Jane"}}'

// The reader refuses an XXE / entity-expansion attack loudly, never resolving or expanding it:
parseResourceXml('<!DOCTYPE x [ <!ENTITY e SYSTEM "file:///etc/passwd"> ]><Patient/>');
// throws FhirXmlError { code: "DTD_FORBIDDEN" }
```
