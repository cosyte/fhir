---
"@cosyte/fhir": patch
---

Phase 8 — XML codec + cross-format equivalence (xml.html). Adds a **zero-dependency** FHIR XML codec
that reads and writes the **same schema-free model** as the JSON codec, and an oracle proving the two
wire formats agree. Security is the headline: the hand-written XML reader is **XXE- and
billion-laughs-proof by refusal**, not by mitigation.

- **A hardened raw XML reader** (`readRawXml` → `XmlElement` tree). It **refuses any `<!DOCTYPE`**
  (`DTD_FORBIDDEN`) before parsing a single element — a DTD is the only place XML can *declare* an
  entity, so refusing it closes the external-entity (XXE) **and** nested-entity-expansion
  (billion-laughs) vectors at once — and **refuses any entity reference** beyond the five predefined
  names and numeric character references (`UNDEFINED_ENTITY`), a second, independent guard that means
  no entity is ever resolved, expanded, or fetched. The reader performs no I/O and resolves no URI (it
  has nothing to fetch), and bounds nesting depth (`MAX_DEPTH_EXCEEDED`), so adversarial input yields a
  typed `FhirXmlError` — never a hang, an OOM, a fetch, or a crash. New: `FhirXmlError`,
  `XML_FATAL_CODES` (`MALFORMED_XML` / `DTD_FORBIDDEN` / `UNDEFINED_ENTITY` / `MAX_DEPTH_EXCEEDED`),
  `readRawXml`, and the `XmlElement` / `XmlNode` / `XmlText` / `XmlAttribute` types.
- **FHIR XML → model** (`parseResourceXml`) — produces the **same** `FhirNode` model as
  `parseResource`, returning the shared `ReadResult`. Maps the FHIR XML conventions: the root/contained
  element name → a synthetic `resourceType`; a primitive's `value` attribute → its value (kept as the
  exact lexical **string** — schema-free, so no datatype is guessed and precision is never routed
  through a `number`); `id`/`extension` co-located as an `id` attribute + child `<extension>`s (the XML
  form of the JSON `_`-sibling); `Element.id` / `Extension.url` attributes → `id` / `url` properties;
  repeated elements → a list; a resource-valued element (`<contained><Patient>…`) unwrapped to the
  inner resource. **Narrative `Narrative.div` (XHTML) is carried opaquely as its full serialized
  string** — exactly the representation FHIR JSON uses — so it round-trips as conformant `<div>…</div>`,
  never dropped or escaped into an attribute (its XHTML structure is not modeled/validated, the same
  fidelity as the JSON codec). Lenient (Postel): an unexpected namespace or stray character data is
  preserved-and-flagged (new value-free issue code `UNEXPECTED_XML_CONTENT`), never rejected.
- **Model → FHIR XML** (`serializeResourceXml`) — the spec-clean inverse: compact, canonical FHIR XML
  that round-trips a spec-clean document **byte-for-byte**. Decimals are emitted from their exact
  lexical text (never a `number`, ADR 0001); `Resource.id` becomes a child `<id>` while `Element.id`
  is an attribute; `Extension.url` is the `url` attribute; control characters are escaped
  round-trip-safe.
- **JSON↔XML equivalence** (`nodesEquivalent`) — the oracle for "the same resource in XML and in JSON
  parses to the same model." Equivalence is defined **modulo** the two irreducible schema-free
  ambiguities and only those: primitive lexical form (JSON's native `true` / number tokens ≡ XML's
  `value`-attribute strings) and singleton lists (JSON's array-for-a-repeatable-element ≡ XML's single
  repeated element). Everything else — property names and order, nesting, `id`, extensions — must match.

Deferred, honest-uncertainty intact: the XHTML **structure** inside `Narrative.div` is not modeled or
validated (it is carried as an opaque string — the same fidelity as the JSON codec — never dropped);
typed cross-format *transcoding* (emitting spec-clean JSON booleans/numbers from an XML-sourced model)
needs the datatype schema and is not in this phase; an extension-only element with no value is read as
a primitive (a value-absent primitive vs a complex-with-only-an-extension is a schema-free ambiguity —
documented on `nodesEquivalent`, the safe direction, no data lost); RDF/Turtle is out of scope; the
XML-fuzz differential vs `validator_cli.jar` is Phase 11.
