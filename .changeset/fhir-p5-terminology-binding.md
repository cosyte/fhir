---
"@cosyte/fhir": patch
---

Phase 5 — Terminology binding validation (strength-aware, content-free). Validate the codes on
**bound** elements by their `system` and binding **strength**, without vendoring any SNOMED / CPT /
LOINC / RxNorm content (roadmap §5). All findings value-free; **no false errors without a terminology
service** (roadmap §5 fail-safe).

- **Frozen known-systems registry** (`KNOWN_SYSTEMS`, `isKnownSystem`) — the roadmap §5 verified
  `system` URIs (LOINC, SNOMED, RxNorm, ICD-10-CM, ICD-9-CM, CPT, UCUM, NDC, CVX) as **identities,
  not content**. The open-question URIs (ICD-10-PCS, HCPCS — roadmap §10) are deliberately **omitted**;
  an unknown system reads as a safe, non-erroring degrade, never a guessed identity.
- **Binding-strength severity** (`BindingStrength`, `TERMINOLOGY_BINDINGS`, `buildBindingRegistry`) —
  `required` → error, `extensible` → error-unless (error on a definitive not-in), `preferred` →
  warning, `example` → information (an example binding can **never** error). Content-free system
  checks: a **known** system the value set does not draw from is `CODE_SYSTEM_UNEXPECTED` (strength-
  scaled — `warning` for extensible/preferred since another system may be a justified extension); an
  **unknown** system is `CODE_SYSTEM_UNKNOWN` (`information`, never a defect).
- **Value-set identities + multi-system elements** — the roadmap-named bindings are built in:
  `AllergyIntolerance.code` (extensible, **RxNorm + SNOMED**) and
  `MedicationRequest`/`MedicationStatement.medicationCodeableConcept` (extensible, **RxNorm**). Both
  systems are accepted on the one allergy element (roadmap §4.3).
- **Pluggable terminology-service interface** (`TerminologyService`, `CodeValidationRequest`,
  `CodeValidationResult`, `CodeMembership`) — the one seam through which value-set **content** enters
  the library; **none is bundled**. Membership is checked (`CODE_NOT_IN_VALUESET`) only when a service
  is supplied and definitively answers `not-in`; an `"unknown"` answer — or **no service at all** —
  emits nothing and degrades to the content-free system checks (never a false error).
- `collectTerminologyIssues` runs inside `validateResource`; `validateResource(resource, {
  terminology, bindings })` supplies a service and/or extra bindings. New issue codes
  `CODE_SYSTEM_UNKNOWN` / `CODE_SYSTEM_UNEXPECTED` / `CODE_NOT_IN_VALUESET` (all `code-invalid`) are
  snapshot-pinned; a rename is breaking. Every finding is value-free — a code/severity/location, never
  a code value; the value-set identity is used only to call the service.

Still deferred: **code validity / value-set membership** beyond system + strength without a supplied
terminology service (no content is bundled — roadmap §5); StructureDefinition / US Core profiles and
per-element US Core binding coverage (Phase 6); the general FHIRPath engine (Phase 7); XML (Phase 8).
