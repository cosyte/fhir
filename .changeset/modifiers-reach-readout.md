---
"@cosyte/fhir": patch
---

`readSafety` now reports three more elements R4 flags as modifiers, and surfaces a fourth. Until
now a deceased `Patient`, a `Patient` whose `link` says the record was replaced by another, an
`Immunization` marked `isSubpotent`, and a `MedicationRequest` whose `intent` is only a `proposal`
all read `safeToSummarize: true` with `modifierElements` empty.

- `Patient.deceased[x]`, `Patient.link` and `Immunization.isSubpotent` are reported on
  `modifierElements` (elements `deceased`, `link` and `isSubpotent`) at every resource root of their
  type, the resource handed in, `contained` or a `Bundle` entry, and each makes `safeToSummarize`
  `false` and `assertSafeToSummarize` throw. `deceased` is located at the member as written
  (`Patient.deceasedBoolean` or `Patient.deceasedDateTime`), and `link` is reported once at `link`
  however many entries it holds. They report **on presence and at any value**, exactly as
  `Patient.active` does, so `"deceasedBoolean": false` and `"isSubpotent": false` now refuse too; an
  unreadable value (a `null`, the wrong JSON type, the `_` form alone, an array wrapper, a name
  written twice, a `deceased` member R4 does not define) is reported the same way and never read.
  `ModifierElementName` widens to carry the three names.
- `MedicationRequest.intent` is mandatory, so it is surfaced rather than refused: the new `intents`
  field carries `{ code, location }` for every `MedicationRequest` root, where `code` is one of the
  eight R4 codes (the new `MedicationRequestIntent` type) matched exactly, and a readable intent
  leaves `safeToSummarize` standing. An `intent` that is present and not one of the eight codes
  (`"PROPOSAL"`, `" order"`, `"draft"`, a `null`, a number, the `_intent` form alone, an array
  wrapper, the name written twice) surfaces no code, puts its location on the new
  `unreadableIntents` field, makes `safeToSummarize` `false` and makes `assertSafeToSummarize` throw.
  An absent `intent` surfaces nothing and refuses nothing.

The cost a consumer sees: a document carrying any of the three reported elements, at any value, no
longer summarizes without the caller handling the report. Nothing is interpreted: no death date is
read, no `link` is followed and its `type` is not read, and no `intent` is mapped to active or
inactive. Every report and location is value-free. Validation findings, the other location channels,
`unhandledModifierExtensions` and the negation reads are unchanged.
