# 0002. FHIRPath dependency posture: vendor a bounded subset in-repo, zero runtime deps

- **Status:** Accepted
- **Date:** 2026-07-15

## Context

FHIR expresses two things in **FHIRPath**, a path-navigation and expression language:

1. **Invariants**: the `constraint` elements on every StructureDefinition (e.g. base FHIR's
   `ele-1`, `dom-3`, US Core's profile-specific constraints). Evaluating a resource against its
   profile means evaluating these FHIRPath expressions.
2. **Slicing discriminators**: `discriminator.type = value | pattern | exists | type | profile`
   with a FHIRPath `path`, used to resolve which slice an array element belongs to.

Both are needed for the profile/validation engine (roadmap Phase 7), not for P0. But the *posture*
must be set now, because the model and codec are built assuming one of three worlds, and they are
not interchangeable:

- **(a) Depend on a full third-party engine** (e.g. `fhirpath.js`). It is a complete implementation,
  but it is large, pulls its own transitive dependencies, and evaluates a far broader surface than
  our shipped profiles use. Adopting it **violates the cosyte zero-runtime-dependency rule** that
  every parser in the suite holds (see the meta-repo `documentation/conventions.md` and the dep-cap
  gate in `scripts/verify.sh`). A runtime dep here would make `@cosyte/fhir` the one parser that
  breaks the suite's core promise.
- **(b) Optional peer dependency**: declare FHIRPath support only if the consumer installs an
  engine. This fragments behavior (validation results depend on whether a peer is present and which
  version), defeats deterministic, self-contained validation, and pushes a supply-chain decision
  onto every consumer. It also makes our own tests depend on an out-of-repo engine.
- **(c) Implement a bounded subset in-repo.** The invariants that base R4 + US Core actually ship
  use a small, well-characterized slice of FHIRPath: path navigation, `.exists()` / `.empty()` /
  `.hasValue()`, `where(...)`, `.all(...)` / `.select(...)`, `matches(...)`, the comparison and
  boolean operators, `implies`, and a handful of functions (`count()`, `first()`, `distinct()`,
  `memberOf` for terminology). It is bounded and testable.

## Decision

**Implement a bounded, vendored FHIRPath subset in-repo, with zero runtime dependencies.** Neither a
full third-party engine (a) nor an optional peer (b).

- The evaluator's scope is defined by an explicit **capability list**: exactly the FHIRPath
  productions and functions required by the invariants and slicing discriminators we ship support
  for. That list is versioned in-repo and grows deliberately, per profile need.
- Encountering an expression outside the supported subset is a **loud, typed error**
  (`UnsupportedFhirPathError`) at profile-load time, **never** a silent pass. A validator that
  quietly treats an un-evaluatable constraint as satisfied would report a false green on a
  clinical-safety check; that failure mode is prohibited. Unsupported → surfaced, not swallowed.
- The subset is self-contained (its own tiny tokenizer + evaluator over our resource model), so
  validation is deterministic and reproducible with no out-of-repo state.

## Consequences

- **Zero-dependency rule preserved**: `@cosyte/fhir` stays consistent with every sibling parser and
  passes the dep-cap gate. No supply-chain surface added for consumers.
- **We own an evaluator.** This is a real, non-trivial cost, incurred in Phase 7 (not P0). It is
  bounded by the capability list rather than by "all of FHIRPath," which keeps it tractable.
- **Deterministic validation.** Results do not vary with a peer's presence or version; our own test
  corpus is self-hosting.
- **Explicit coverage boundary.** When a profile needs an expression we do not yet support, that is a
  visible, scoped feature request (extend the capability list + tests), surfaced by the typed error,
  not hidden behind a wrong answer.
- **Revisit trigger:** if the required subset ever approaches the size of a full engine, or a
  high-value profile needs broad FHIRPath we cannot economically maintain, this ADR is superseded,
  but the default is not to take the dependency.
