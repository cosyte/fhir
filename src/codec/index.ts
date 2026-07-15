/**
 * FHIR wire codec — read (parse) and write (serialize) between the wire format and the model.
 *
 * JSON-first: the JSON codec lands in Phase 1; XML is deferred to Phase 8 — see
 * `documentation/decisions/0003-xml-scope-deferred.md`. Following the cosyte parser convention
 * (Postel's Law), the reader is liberal and the writer is conservative (emits spec-clean FHIR).
 *
 * This barrel is an intentional placeholder for the P0 bootstrap: no parse code this phase.
 */
export {};
