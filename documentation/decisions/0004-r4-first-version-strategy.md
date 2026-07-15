# 0004 — Version strategy: R4-first (`4.0.1`), R5 / DSTU2 read-tolerance only

- **Status:** Accepted
- **Date:** 2026-07-15

## Context

FHIR has shipped several incompatible versions:

| Version | Code | Notes |
| --- | --- | --- |
| DSTU2 | `1.0.2` | Widely deployed in legacy Epic / Cerner (Millennium) API endpoints; still seen in production ingest. |
| STU3 | `3.0.2` | Transitional; limited long-term relevance. |
| R4 | `4.0.1` | The first fully-normative core. **The US regulatory anchor.** |
| R4B | `4.3.0` | Minor increment on R4. |
| R5 | `5.0.0` | Current; early adoption. Adds primitives such as `integer64`. |

The decisive fact is regulatory: the ONC **HTI-1** final rule and the 21st Century Cures Act
**§170.315(g)(10)** "Standardized API for patient and population services" certification criterion
bind the certified US market to **FHIR R4**, specifically **US Core (on R4) + SMART App Launch**.
That is where the customers, the compliance pressure, and the profile ecosystem (US Core) are. R5 is
current but early in real-world adoption; DSTU2 is legacy but persists on read-only ingest from older
EHR endpoints.

A parser that tries to fully model every version at once multiplies its surface for little near-term
value; one that hard-codes a single version can't ingest the legacy and next-gen resources that show
up in real integrations.

## Decision

**R4 `4.0.1` is the first-class, fully-modeled version** — the version the model, JSON codec,
validation, and profiles (US Core) target. **R5 `5.0.0` and DSTU2 `1.0.2` get read-tolerance
only**, not full modeling/validation/emit.

- **R4 (`4.0.1`):** full read + write + validation + US Core profiles. The default and the certified
  target.
- **R5 (`5.0.0`) and DSTU2 (`1.0.2`):** the reader ingests them leniently (Postel's Law) —
  version-detected, structurally parsed, unknown/version-specific fields **preserved and flagged**,
  not fully validated and not emitted. Read-tolerance means "don't lose data and don't lie," not
  "certified support."
- The model carries an explicit **`fhirVersion` discriminator** so version is never inferred
  ambiguously downstream, and so a future decision to promote R5 to first-class is additive.
- Emit is **R4-only** until a later, explicitly-scoped phase.

## Consequences

- **Effort concentrates on the market that exists** — R4 + US Core + SMART, the ONC-certified
  surface — instead of being spread across five versions.
- **Legacy and next-gen ingest still work** at the read-tolerant level: a DSTU2 resource from an
  older Epic endpoint or an R5 resource is parsed and preserved (flagged as non-first-class) rather
  than rejected — important for real integration feeds.
- **Read-tolerance has a hard honesty rule:** a version we don't fully model is never silently
  validated as if it were R4. Unmodeled version-specific content is preserved and marked, so a
  consumer is never told a resource is "valid" against rules that don't apply to it.
- **Interacts with ADR 0001:** R5's `integer64` is one of the read-tolerant primitives; its
  string-backed, lexically-exact representation from ADR 0001 applies unchanged when we read R5, so
  read-tolerance never reintroduces the precision hazard.
- **Promotion path is clean:** elevating R5 (or R4B) to first-class later is adding a modeled version
  behind the existing `fhirVersion` discriminator, not re-architecting.
