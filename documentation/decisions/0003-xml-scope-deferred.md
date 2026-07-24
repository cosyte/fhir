# 0003. Wire-format scope: JSON-first, XML deferred to Phase 8

- **Status:** Accepted
- **Date:** 2026-07-15

## Context

FHIR defines resources abstractly and specifies **two normative serializations**: JSON and XML
(plus a non-normative RDF/Turtle form). A parser has to decide which wire format(s) it reads and
writes, and when.

The two formats are not equal in cost or in market relevance:

- **JSON is the modern default.** US Core, SMART App Launch, the ONC-certified `$export` / bulk-data
  flows, and essentially every greenfield FHIR server lead with JSON. The regulatory anchor
  (ADR 0004) lives in a JSON-first world.
- **XML is heavier and shrinking in relevance.** A conformant FHIR XML codec has to handle
  namespaces, attribute-vs-element encoding of primitives (value-in-`@value`), mixed content, the
  embedded **XHTML** `Narrative.div`, and the primitive-extension representation: roughly double the
  codec surface for a diminishing audience (legacy interfaces, some CDA-adjacent and government
  exchanges). Building it in lockstep with JSON would roughly double Phase-1 codec effort for
  little near-term user value.

Crucially, the resource **model is serialization-agnostic** (a well-designed model does not encode
JSON-shaped assumptions), so XML can be added later as a second codec without reworking the model.
That makes deferral cheap to reverse and expensive to pre-pay.

## Decision

**JSON-first.** The resource model and the **JSON codec** are the product through Phase 7. **XML is
deferred to Phase 8**, and when it arrives it is **read-first** (ingesting XML feeds) before emit.

- Phases 1–7 build model, JSON read/write, validation, and profiles against JSON only.
- The model layer stays strictly **wire-agnostic**: no JSON-specific shapes leak into the model, so
  the XML codec in Phase 8 is purely additive (a new reader/writer over the same model), not a
  refactor.
- Until Phase 8, an XML-only input is an explicit, documented **unsupported-input** condition
  (a typed error), not a silent partial parse.

## Consequences

- **Faster to a useful R4 + US Core JSON parser**: the effort goes where the certified market and
  the roadmap's regulatory anchor (ADR 0004) actually are.
- **Documented limitation:** `@cosyte/fhir` cannot ingest XML-only FHIR feeds until Phase 8. Teams on
  XML-only legacy interfaces are not served by the early phases; this is stated plainly rather than
  half-implemented.
- **Model discipline is load-bearing.** Because XML is coming, the model must not bake in JSON
  assumptions (e.g. primitive extensions via the JSON `_field` sidecar convention must be modeled as
  a first-class concept, not as a literal `_`-prefixed key). This constraint is inherited by Phase 1.
- **XHTML narrative** (`Narrative.div`) is handled as an embedded string in the JSON phase; the
  Phase-8 XML work is where it becomes structured markup if needed.
- Reversible: deferral costs nothing structural to undo. Phase 8 slots a second codec onto an
  unchanged model.
