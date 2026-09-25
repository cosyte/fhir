---
"@cosyte/fhir": minor
---

`readSafety` now surfaces `use` on identifiers, names, addresses and contact points, so a caller can
tell an old or temporary one from a current one without knowing that R4 makes `use` a modifier.
Until now a `Patient` carrying `"use": "old"` on an identifier, a name, an address or a telecom
entry read `safeToSummarize: true` with nothing surfaced.

- The new `datatypeUses` field carries `{ code, location }` for every `use` at a covered position:
  every `identifier` and `groupIdentifier` (a Reference's `identifier` included) on an
  `AllergyIntolerance`, `Condition`, `DiagnosticReport`, `Immunization`, `MedicationRequest`,
  `MedicationStatement`, `Observation` or `Patient`, and a `Patient`'s `name`, `telecom` and
  `address`, on the patient and on each `contact`, wherever that resource sits: the resource handed
  in, `contained`, or a `Bundle` entry. `code` is one of the codes R4 4.0.1 lists for that position's
  datatype (the new `DatatypeUseCode` type), matched exactly, so `maiden` is read on a name and
  nowhere else. A readable `use`, `old` and `temp` included, leaves `safeToSummarize` standing: the
  code is surfaced and never interpreted, and no entry is filtered, reordered or picked as current.
- A `use` that is present and is not a code of its datatype's value set (`"OLD"`, `" old"`, `""`,
  `"maiden"` on an identifier, a `null`, a number, the `_use` form with no value, an array wrapper,
  the name written twice) surfaces no code and puts its location on the new
  `unreadableDatatypeUses` field. The readout reports `safeToSummarize: false` for it, and
  `assertSafeToSummarize` now refuses the document, throwing `FhirSafetyError` with that location.

The cost a consumer sees: a document whose `use` is outside its R4 value set no longer summarizes.
`DatatypeUseReport` and `DatatypeUseCode` are each a new export, type-only. `Practitioner.identifier.use`
is unchanged and is still reported on `modifierElements`, and a `Practitioner`'s names, telecoms and
addresses are not read. Not read either: a `use` carried inside an extension value
(`valueIdentifier` and its siblings), or inside a contained resource of another type, such as an
`Organization`. Validation findings, `modifierElements` and every other readout channel are
unchanged, and the XML read path reads the same as JSON.
