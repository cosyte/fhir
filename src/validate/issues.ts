/**
 * The validation issue vocabulary, severities, R4 `IssueType` codes, the stable public validation
 * code registry, and the **one redaction chokepoint** that turns a coded issue into value-free
 * diagnostic text.
 *
 * Two tiers, layered on top of the codec's read-time diagnostics ({@link ../codec/issues.js}):
 *
 * - The codec's {@link ../codec/issues.js} carries what the *reader* tolerated (unknown property,
 *   decimal precision). This module carries what the *validator* found: structure, cardinality, and
 *   datatype/value-domain problems, each mapped to an R4 `OperationOutcome.issue.code` (an
 *   `IssueType`) and an R4 `severity`.
 *
 * **PHI discipline.** A FHIR resource is PHI by default, and diagnostics are the leak
 * vector. Every {@link ValidationIssue} is **value-free by construction**: a stable `code`, a
 * `severity`, an `IssueType`, and an `expression` (a FHIRPath *location* such as
 * `Patient.name[0].given[1]`), never the offending value. The human-readable `diagnostics` string
 * that reaches an `OperationOutcome` is derived **only** from the code, through the single
 * {@link diagnosticFor} table, there is no code path that interpolates an instance value into a
 * message. This is the redaction chokepoint.
 *
 * Two identities ride **beside** that text rather than through it, and neither is instance data: the
 * invariant {@link ValidationIssue.constraint} key (a published FHIR identifier such as `"ait-1"`)
 * and the {@link ValidationIssue.codeSystemVersion} record (the code-system release a
 * caller-supplied terminology service declared its answer was made against, plus the explicit
 * marker for an answer that declared none). Both are assertions made outside the document: adding
 * one to `DIAGNOSTIC_OF`, or interpolating either into a diagnostic string, would breach the
 * chokepoint, so neither ever does.
 *
 * @packageDocumentation
 */

/**
 * The R4 issue-severity value set (`valueset-issue-severity`), in full. R4 does **not** include the
 * R5 `success` value, the "all clear" case is expressed as `information` +
 * {@link ISSUE_TYPES.INFORMATIONAL}, not a `success` severity.
 */
export const ISSUE_SEVERITIES = {
  FATAL: "fatal",
  ERROR: "error",
  WARNING: "warning",
  INFORMATION: "information",
} as const;

/** One of the four R4 {@link ISSUE_SEVERITIES}. */
export type ValidationSeverity = (typeof ISSUE_SEVERITIES)[keyof typeof ISSUE_SEVERITIES];

/**
 * The subset of the R4 `IssueType` value set (`valueset-issue-type`) that the layers emit.
 * These are the wire `OperationOutcome.issue.code` values; the richer sub-code tree (terminology,
 * invariant, profile) arrives with the layers that emit it. Renaming one is a breaking change.
 */
export const ISSUE_TYPES = {
  /** Structural issue, an element that is not allowed here, or a cardinality-max violation. */
  STRUCTURE: "structure",
  /** A required element (min cardinality ≥ 1) is missing. */
  REQUIRED: "required",
  /** An element value is invalid against its datatype value-domain (a primitive-regex failure). */
  VALUE: "value",
  /** A code is not a member of a required-strength value set binding. */
  CODE_INVALID: "code-invalid",
  /** A content-validation rule (a resource `constraint` / invariant) failed. */
  INVARIANT: "invariant",
  /** The content uses a modifier the processor does not support and cannot safely ignore. */
  NOT_SUPPORTED: "not-supported",
  /** Informational only, carries no defect (e.g. "this resource type has no schema yet"). */
  INFORMATIONAL: "informational",
  /** A business rule / profile-level assertion failed (e.g. a declared profile version is unknown). */
  BUSINESS_RULE: "business-rule",
  /** A referenced resource could not be found within the resolution closure (a Bundle reference). */
  NOT_FOUND: "not-found",
} as const;

/** One of the {@link ISSUE_TYPES}, the R4 `OperationOutcome.issue.code`. */
export type IssueType = (typeof ISSUE_TYPES)[keyof typeof ISSUE_TYPES];

/**
 * Stable string codes for every validation finding the layers can raise. Frozen via
 * `as const` so the union is exact and a comparison is typo-checked. **Renaming a code is a breaking
 * change**; the set is snapshotted (see `test/validation-codes.test.ts`).
 */
export const VALIDATION_CODES = {
  /** Layer 1, an element the resource's structure does not define at this location. */
  UNKNOWN_ELEMENT: "UNKNOWN_ELEMENT",
  /** Layer 1, the resource carries no `resourceType`, so it cannot be structurally validated. */
  RESOURCE_TYPE_UNKNOWN: "RESOURCE_TYPE_UNKNOWN",
  /** Layer 1, no schema is available for this resource type; structural layers were skipped. */
  RESOURCE_NOT_MODELED: "RESOURCE_NOT_MODELED",
  /** Layer 1, an element's node shape (primitive / complex) is not what its datatype expects. */
  TYPE_MISMATCH: "TYPE_MISMATCH",
  /** Layer 1, more than one variant of a `choice[x]` element is present. */
  CHOICE_AMBIGUOUS: "CHOICE_AMBIGUOUS",
  /** Layer 2, a required element (min ≥ 1) is absent. */
  CARDINALITY_MIN: "CARDINALITY_MIN",
  /** Layer 2, an element appears more times than its maximum cardinality allows. */
  CARDINALITY_MAX: "CARDINALITY_MAX",
  /** Layer 3, a primitive value does not match its datatype's lexical form. */
  PRIMITIVE_INVALID: "PRIMITIVE_INVALID",
  /** Layer 3, a `code` value is outside a required-strength enumerated binding. */
  CODE_INVALID: "CODE_INVALID",
  /**
   * Safety, an element carries a `modifierExtension` this library does not understand.
   * FHIR's `?!` rule forbids ignoring an unknown modifier, so this **fails closed** (an `error`): the
   * element cannot be safely processed. See {@link ./safety.js}.
   */
  UNHANDLED_MODIFIER_EXTENSION: "UNHANDLED_MODIFIER_EXTENSION",
  /**
   * Safety, the document wrote a property name more than once, so an element holds several values
   * and nothing says which the sender meant. FHIR JSON requires unique property names (json.html §2.6.2:
   * "Property names SHALL be unique") and expresses repetition with an array, so this is a violated
   * `SHALL` and an `error`. The reader keeps every value (see {@link ../model/node.js} `duplicates`),
   * so this reports an ambiguity, never a loss.
   */
  DUPLICATE_PROPERTY: "DUPLICATE_PROPERTY",
  /**
   * Safety, a single-valued (`0..1`) safety element, or `resourceType`, arrived wrapped in a JSON
   * array. FHIR JSON writes a single-valued element as a name/value pair and uses an array only for a
   * repeating element (json.html §2.6.2.2), so this is a non-conformant encoding and an `error`. It is the
   * shape a **generic XML-to-JSON converter** produces for every element, which is how a C-CDA or v2
   * feed commonly reaches a FHIR surface, and left unreported it reaches the same harm as a repeated
   * property name: a single-value read finds no code in the array, so a retraction or a negation the
   * sender wrote goes unreported and the record reads live. Nothing is lost, the wrapper is preserved
   * and the safety layer reads through it; this reports that the encoding was ambiguous.
   */
  ARRAY_WRAPPED_SCALAR: "ARRAY_WRAPPED_SCALAR",
  /**
   * Safety, the document wrote a JSON array **inside another array**. FHIR JSON uses an array for a
   * repeating element and for nothing else (json.html §2.6.2.2), so a list of lists has no meaning at
   * any position and this is a non-conformant encoding wherever it appears, which is why it needs no
   * cardinality rule and cannot fire on a conformant document. Reported at every position the model
   * has a node for; a `_`-sibling the reader discards whole is the stated exception, and draws a
   * reader warning instead: `UNKNOWN_PROPERTY` for an unrecognised member of a `_`-sibling object,
   * `MISPLACED_PRIMITIVE_EXTENSION` for a sibling on an object or on a non-primitive array, not one
   * code for all three. An `error`, and one of the two on this list
   * where the reader could **not model** what the sender wrote (the other is
   * {@link VALIDATION_CODES.DROPPED_ELEMENT_TEXT}): the codec does not model an inner array, so this
   * reports a loss of *structure* rather than an ambiguity, though the array's JSON text is kept and
   * readable (see {@link ../model/node.js} `nestedArrayContent`). Left unreported it is among the worst of the
   * set, because the model then looks exactly like an element that was legitimately absent, and a
   * refuted allergy, a resolved condition, or an entire resource inside a Bundle entry reads back as
   * a clean document. Value-free, the position the inner array occupied, never its contents.
   */
  NESTED_ARRAY: "NESTED_ARRAY",
  /**
   * Safety, an XML document wrote **character data directly on a FHIR element**. FHIR XML carries a
   * primitive's value in the `value` attribute (xml.html §2.6.1), so text written as element content
   * has no slot on the model and the reader drops it: `<status>entered-in-error</status>` yields a
   * `status` with no value. An `error`, and the only code on this list where the content is neither
   * modeled **nor kept**: unlike {@link VALIDATION_CODES.NESTED_ARRAY}, which preserves the array's
   * JSON text, the character data is discarded outright, because reading it back would be a
   * tolerance for a non-conformant encoding rather than a report of one. Left unreported it reaches the same harm as
   * {@link VALIDATION_CODES.NESTED_ARRAY} by the other wire format, because the model is again
   * indistinguishable from an element that was legitimately absent: a retraction, a `refuted`
   * verification status, or a dose *number* beside a surviving unit and UCUM code all read back as a
   * clean document. Value-free, the position the text occupied, never its contents.
   */
  DROPPED_ELEMENT_TEXT: "DROPPED_ELEMENT_TEXT",
  /**
   * Safety, an element carries a DataAbsentReason extension **and a value of its own**, so the
   * document asserts both that the element holds that value and that it holds none. An `error`
   * (`structure`): the two cannot both be true, nothing here ranks them, and a consumer that
   * happened to read one of the two would report the record as though the other had not been
   * written. Both survive on the model and on the safety readout; this reports that they disagree.
   * Value-free, the location of the element, never the value and never the reason.
   *
   * Cannot fire on a conformant document: an element the sender has data for is written with the
   * data and no marker. It is **not** the `Observation.dataAbsentReason` ELEMENT beside a `value[x]`,
   * which is the `obs-6` invariant and reports as {@link VALIDATION_CODES.INVARIANT_VIOLATED}; the
   * element is not the extension, and the two never report about one another's shape.
   */
  ABSENCE_MARKER_CONFLICT: "ABSENCE_MARKER_CONFLICT",
  /**
   * Safety, an element carries a DataAbsentReason extension whose reason this library could not
   * read: no `valueCode`, one holding no readable string, an empty one, one written twice, or a code
   * outside the closed fifteen-concept value set the extension's `value[x]` binds to at **required**
   * strength. An `error` (`code-invalid`), on the same footing as any other required-binding miss:
   * the set is closed and published, so membership is decided from the set itself with no
   * terminology service involved and no value-set expansion.
   *
   * **Nothing is coerced.** The code is not trimmed, case-folded or substituted, and the element is
   * not read as `unknown` and not read as populated: doing either would author a reason the sender
   * did not spell, or erase a declaration the sender did make. The element stays value-absent and
   * this is the record that a declaration was made and could not be honoured. Value-free, the
   * location of the element, never the code that failed to match.
   */
  ABSENCE_MARKER_UNREADABLE: "ABSENCE_MARKER_UNREADABLE",
  /**
   * Safety, the resource is marked `entered-in-error` and is therefore **retracted, not
   * data**. Surfaced as `information` (it is not itself a defect) so a consumer cannot miss it.
   */
  RETRACTED_RESOURCE: "RETRACTED_RESOURCE",
  /**
   * Safety, a named resource invariant failed (`ait-1`/`ait-2`, `con-3`/`con-4`/`con-5`,
   * `obs-6`/`obs-7`). The specific constraint key travels in {@link ValidationIssue.constraint}, and
   * the severity mirrors the constraint's own (`error`, except the best-practice `con-3` → `warning`).
   */
  INVARIANT_VIOLATED: "INVARIANT_VIOLATED",
  /**
   * Invariant, a profile `constraint`'s FHIRPath `expression` is **outside the bounded
   * engine's subset** and could not be evaluated. Always `information` (`informational`):
   * the constraint is reported **unchecked, never assumed to pass** (fail-safe), the
   * library does not claim conformance to an invariant it could not test. The constraint `key` travels
   * in {@link ValidationIssue.constraint}. Value-free (the location + key, never an instance value).
   */
  INVARIANT_UNCHECKED: "INVARIANT_UNCHECKED",
  /**
   * Quantity/UCUM, a `Quantity` claims the UCUM `system` but its `code` is absent or not a
   * shape-valid UCUM expression, so the unit cannot be trusted for machine use. A `warning`
   * (`value`): the value is **preserved verbatim and never converted**, the library does not bundle
   * UCUM content, so it cannot assert the code *is* a real unit, only that it is present and well-shaped.
   */
  UCUM_UNIT_UNRECOGNIZED: "UCUM_UNIT_UNRECOGNIZED",
  /**
   * Quantity/UCUM, a vital-signs Observation's measured value carries a unit the FHIR
   * vital-signs profile forbids for that LOINC code (wrong UCUM `code`, or a non-UCUM `system`). An
   * `error` (`code-invalid`): the vital-signs profile *requires* the unit, so a nonconformant one is a
   * profile violation, compared on the UCUM `code` (case- and bracket-sensitive), never the `unit` string.
   */
  VITAL_SIGN_UNIT_NONCONFORMANT: "VITAL_SIGN_UNIT_NONCONFORMANT",
  /**
   * Quantity/UCUM, an Observation whose profile expects a numeric `Quantity` value carries
   * a different `value[x]` variant instead (e.g. `valueString`). A `warning` (`value`): the value is
   * preserved and surfaced by its real type, a caller must not read it as a number.
   */
  VALUE_TYPE_UNEXPECTED: "VALUE_TYPE_UNEXPECTED",
  /**
   * Terminology, a bound coding's `system` URI is not in the frozen known-systems registry
   * (and not one the binding's value set draws from). Always `information` (`code-invalid`): an
   * unknown system may be a legitimate local/proprietary one, so it is never a defect, it only means
   * the library cannot validate codes drawn from it. Content-free, so it can never flip validity.
   */
  CODE_SYSTEM_UNKNOWN: "CODE_SYSTEM_UNKNOWN",
  /**
   * Terminology, a bound coding uses a **known** code `system` that is not one the
   * binding's value set draws from (e.g. an ICD-10-CM code where the binding expects RxNorm + SNOMED).
   * This is the content-free "wrong system for this binding" check, decided from the `system` alone,
   * with no value-set content. Severity follows the binding strength (`required` → `error`;
   * `extensible`/`preferred` → `warning`, since a different system may be a legitimate extension;
   * `example` → none). Compared on the `system` URI, never a code value.
   */
  CODE_SYSTEM_UNEXPECTED: "CODE_SYSTEM_UNEXPECTED",
  /**
   * Terminology, a configured terminology service reported that a bound coding's
   * `(system, code)` is **not a member** of the binding's value set. Severity follows the binding
   * strength (`required`/`extensible` → `error`; `preferred` → `warning`; `example` → `information`,
   * never an error). Emitted **only** when a service definitively answers `not-in`; with no service,
   * or an `unknown` answer, the library degrades to the content-free system checks and never
   * false-errors (fail-safe). Value-free, the coding location, never the code itself.
   *
   * The **only** finding that carries a {@link ValidationIssue.codeSystemVersion} record, because it
   * is the only one a terminology service produces: the release the service declared its answer was
   * made against, or the explicit mark that it declared none. Severity, emission and the fail-safe
   * degrade are all independent of it.
   */
  CODE_NOT_IN_VALUESET: "CODE_NOT_IN_VALUESET",
  /**
   * Profile, an instance element is present under a **closed** slicing whose discriminators
   * matched none of the profile's defined slices. A `structure` `error`: `closed` slicing forbids
   * content outside the named slices. (Under `open` slicing an unmatched element is allowed and draws
   * nothing; under `openAtEnd` it is allowed only in the trailing position, this library flags a
   * closed-slicing miss and leaves the ordering nuance unenforced.)
   */
  PROFILE_SLICE_UNMATCHED: "PROFILE_SLICE_UNMATCHED",
  /**
   * Profile, a slicing whose discriminator this library cannot evaluate (a `profile`
   * discriminator, which needs recursive profile resolution, or the R5-only `position`). Emitted as
   * `information` so slice membership is reported **unchecked, never silently passed** (the
   * fail-safe): the library does not guess a slice assignment it cannot justify.
   */
  PROFILE_SLICE_UNCHECKED: "PROFILE_SLICE_UNCHECKED",
  /**
   * Profile, an element the profile marks **must-support** is absent from the instance.
   * **Always `information`, never an error** (the fail-safe, and the single most important
   * must-support rule): must-support is a *system obligation* on the sender to be able to populate the
   * element and on the receiver to tolerate its absence, it is **not** an instance-presence
   * requirement. A strict client that errors on an absent must-support element is the classic bug this
   * code exists to avoid.
   */
  MUST_SUPPORT_ABSENT: "MUST_SUPPORT_ABSENT",
  /**
   * Profile, the instance's `meta.profile` declares a profile at a version the supplied
   * profile set does not carry (`canonical|version` with a different version, or an unresolvable
   * canonical). A `warning` (`business-rule`): an unknown profile
   * version is flagged rather than silently best-effort-validating against a different one.
   */
  PROFILE_VERSION_MISMATCH: "PROFILE_VERSION_MISMATCH",
  /**
   * Profile, an element carries a value that is not **exactly** the profile's `fixed[x]`.
   * A `value` `error`: `fixed[x]` is an equality constraint (the element SHALL match the fixed value
   * exactly, including every nested property). Compared structurally and precision-exactly (decimals
   * via {@link ../model/decimal.js}), never by echoing the value.
   */
  PROFILE_FIXED_MISMATCH: "PROFILE_FIXED_MISMATCH",
  /**
   * Profile, an element does not match the profile's `pattern[x]`. A `value` `error`:
   * `pattern[x]` is a **subset** constraint (the element SHALL contain *at least* the pattern's
   * properties and values, but may carry more), the weaker sibling of `fixed[x]`. Value-free.
   */
  PROFILE_PATTERN_MISMATCH: "PROFILE_PATTERN_MISMATCH",
  /**
   * Bundle, a `Reference` inside a Bundle entry (or a `#fragment` inside a resource's
   * `contained`) that could not be resolved within the resolution closure: a fragment whose target
   * contained resource is absent, or a relative `Type/id` reference naming no entry in the Bundle. A
   * `warning` (`not-found`) and **never fatal**, the target may legitimately live outside the
   * supplied closure (a partial Bundle, an external server), so the reference is **preserved**, only
   * flagged. An absolute/logical reference that is simply external to the Bundle draws **no** finding.
   * Value-free, the FHIRPath location of the reference, never the reference string itself.
   */
  REFERENCE_UNRESOLVED: "REFERENCE_UNRESOLVED",
  /**
   * Bundle, the `#fragment` references among a resource's `contained` resources form a
   * **cycle** (a → b → a, or a self-reference). An `error` (`structure`): a containment cycle is
   * malformed and, to a naive transitive resolver, a denial-of-service (an unbounded loop / stack
   * blow-up). The bounded, iterative cycle guard detects it and reports it here rather than looping,
   * DoS-safe by construction. Value-free, the location of the `contained` element, never a value.
   */
  CONTAINED_CYCLE: "CONTAINED_CYCLE",
  /**
   * Bundle, a Bundle entry's `fullUrl` is a RESTful URL (relative `Type/id` or an absolute
   * URL ending in `Type/id`) whose id disagrees with the entry `resource.id`. An `error`
   * (`business-rule`): FHIR requires a RESTful `fullUrl` to be consistent with the resource it wraps,
   * and a disagreement can cause a reference to resolve to the wrong resource. A `urn:uuid:` (logical)
   * `fullUrl` places no constraint on `resource.id`, so it never triggers this. Value-free, the
   * location of the `fullUrl`, never either id.
   */
  FULLURL_ID_MISMATCH: "FULLURL_ID_MISMATCH",
} as const;

/** Discriminant union of every {@link VALIDATION_CODES} value. */
export type ValidationCode = (typeof VALIDATION_CODES)[keyof typeof VALIDATION_CODES];

/**
 * The canonical identity of the library's own code system for the **code-system release record**
 * carried by a membership finding. It names the two-concept vocabulary in
 * {@link CODE_SYSTEM_VERSION_RECORD_CODES} and nothing else, and it reaches an `OperationOutcome` as
 * `issue.details.coding[0].system`.
 *
 * It is **this library's** canonical, not a third-party terminology identity: the known-systems
 * registry ({@link ../terminology/systems.js}) stays a frozen set of verified external URIs and
 * gains nothing here. Renaming this is a breaking change.
 */
export const CODE_SYSTEM_VERSION_RECORD_SYSTEM =
  "https://cosyte.com/fhir/CodeSystem/code-system-version-record";

/**
 * The two-concept vocabulary that says **whether** a membership answer declared the code-system
 * release it was made against. Frozen via `as const`; the set is snapshotted (see
 * `test/validation-codes.test.ts`) because it is a public wire identity.
 *
 * The concept is deliberately separate from the release string itself: the marker rides on
 * `issue.details.coding[0].code` and the declared release rides on `issue.details.text`, so no
 * release a service could declare (`"undeclared"` included) can ever be mistaken for the marker.
 */
export const CODE_SYSTEM_VERSION_RECORD_CODES = {
  /** The service declared a release; the string it declared travels beside this marker. */
  DECLARED: "declared",
  /**
   * The service was consulted, answered definitively, and declared **no** release. It is an
   * applicable, unanswered question, **not** "current" and not "not applicable": the marker is
   * emitted precisely so the silence cannot be read as currency.
   */
  UNDECLARED: "undeclared",
} as const;

/** One of the {@link CODE_SYSTEM_VERSION_RECORD_CODES}. */
export type CodeSystemVersionRecordCode =
  (typeof CODE_SYSTEM_VERSION_RECORD_CODES)[keyof typeof CODE_SYSTEM_VERSION_RECORD_CODES];

/**
 * Which code-system release a membership answer was made against, as recorded on the finding.
 *
 * Three states, all distinguishable, which is the whole point of the type:
 *
 * - the field is **absent** from a {@link ValidationIssue}: no terminology service was consulted to
 *   produce that finding, so there is no release to record (every content-free system check, every
 *   non-terminology finding);
 * - `{ declared: true, version }`: the service named the release, and `version` is its string
 *   **exactly** as declared, never normalised, trimmed, truncated or substituted;
 * - `{ declared: false }`: the service answered but named no release. The answer stands; its
 *   currency is **unknown and said so**, rather than left to a reader to fill in with "current".
 *
 * The release is always the caller's own assertion. It is never read from the instance: a resource's
 * own `Coding.version` is document content and never reaches a finding.
 */
export type CodeSystemVersionRecord =
  | { readonly declared: true; readonly version: string }
  | { readonly declared: false };

/**
 * A single value-free validation finding.
 *
 * `expression` is a FHIRPath location into the document (e.g. `Patient.gender`,
 * `Observation.component[1].valueQuantity.value`), it says *where* without echoing *what*. An issue
 * never contains a resource value, so it is safe to log or return in an `OperationOutcome`.
 *
 * **It is a location, and on non-conformant input it can be a location with a gap.** The segments
 * are the document's own names, and a name is echoed only when it matches the published form of a
 * FHIR name; anything else reads as the {@link ../model/path.js} `WITHHELD` marker, `"<withheld>"`.
 * A marker is not a FHIRPath identifier, so such an expression will not resolve against the
 * instance: R4 defines `OperationOutcome.issue.expression` as a FHIRPath subset that SHALL resolve
 * to a single node, and a location with a withheld segment does not. Every segment around the
 * marker is intact, so the nearest addressable ancestor is still there. Test for the marker before
 * handing an expression to a FHIRPath engine.
 */
export interface ValidationIssue {
  readonly code: ValidationCode;
  readonly severity: ValidationSeverity;
  /** The R4 `OperationOutcome.issue.code` this finding maps to. */
  readonly type: IssueType;
  /** FHIRPath location of the finding. */
  readonly expression: string;
  /**
   * The spec constraint key when the finding is an invariant violation (e.g. `"ait-1"`, `"obs-6"`),
   * a public FHIR identifier, never an instance value, so it is safe to surface. `undefined` for
   * every non-invariant finding. It reaches the `OperationOutcome` as `issue.details.text`.
   */
  readonly constraint?: string;
  /**
   * Which code-system release the terminology service's answer was made against, when a service was
   * consulted to produce this finding (today, `CODE_NOT_IN_VALUESET` and only it). `undefined` for
   * every finding no service produced, including the content-free `CODE_SYSTEM_UNKNOWN` /
   * `CODE_SYSTEM_UNEXPECTED` checks, which consult nothing.
   *
   * A declared release is the **caller's own assertion**, a public code-system release identifier on
   * the same footing as the constraint key an invariant finding surfaces, never an instance value,
   * so it is safe to surface. It reaches the `OperationOutcome` as `issue.details`
   * ({@link ./operation-outcome.js}), and the `diagnostics` string stays derived from the finding
   * code alone.
   */
  readonly codeSystemVersion?: CodeSystemVersionRecord;
}

/** The fixed R4 `IssueType` each validation code maps to. */
const ISSUE_TYPE_OF: Readonly<Record<ValidationCode, IssueType>> = {
  UNKNOWN_ELEMENT: ISSUE_TYPES.STRUCTURE,
  RESOURCE_TYPE_UNKNOWN: ISSUE_TYPES.STRUCTURE,
  RESOURCE_NOT_MODELED: ISSUE_TYPES.INFORMATIONAL,
  TYPE_MISMATCH: ISSUE_TYPES.STRUCTURE,
  CHOICE_AMBIGUOUS: ISSUE_TYPES.STRUCTURE,
  CARDINALITY_MIN: ISSUE_TYPES.REQUIRED,
  CARDINALITY_MAX: ISSUE_TYPES.STRUCTURE,
  PRIMITIVE_INVALID: ISSUE_TYPES.VALUE,
  CODE_INVALID: ISSUE_TYPES.CODE_INVALID,
  UNHANDLED_MODIFIER_EXTENSION: ISSUE_TYPES.NOT_SUPPORTED,
  DUPLICATE_PROPERTY: ISSUE_TYPES.STRUCTURE,
  ARRAY_WRAPPED_SCALAR: ISSUE_TYPES.STRUCTURE,
  NESTED_ARRAY: ISSUE_TYPES.STRUCTURE,
  DROPPED_ELEMENT_TEXT: ISSUE_TYPES.STRUCTURE,
  ABSENCE_MARKER_CONFLICT: ISSUE_TYPES.STRUCTURE,
  ABSENCE_MARKER_UNREADABLE: ISSUE_TYPES.CODE_INVALID,
  RETRACTED_RESOURCE: ISSUE_TYPES.INFORMATIONAL,
  INVARIANT_VIOLATED: ISSUE_TYPES.INVARIANT,
  INVARIANT_UNCHECKED: ISSUE_TYPES.INFORMATIONAL,
  UCUM_UNIT_UNRECOGNIZED: ISSUE_TYPES.VALUE,
  VITAL_SIGN_UNIT_NONCONFORMANT: ISSUE_TYPES.CODE_INVALID,
  VALUE_TYPE_UNEXPECTED: ISSUE_TYPES.VALUE,
  CODE_SYSTEM_UNKNOWN: ISSUE_TYPES.CODE_INVALID,
  CODE_SYSTEM_UNEXPECTED: ISSUE_TYPES.CODE_INVALID,
  CODE_NOT_IN_VALUESET: ISSUE_TYPES.CODE_INVALID,
  PROFILE_SLICE_UNMATCHED: ISSUE_TYPES.STRUCTURE,
  PROFILE_SLICE_UNCHECKED: ISSUE_TYPES.INFORMATIONAL,
  MUST_SUPPORT_ABSENT: ISSUE_TYPES.INFORMATIONAL,
  PROFILE_VERSION_MISMATCH: ISSUE_TYPES.BUSINESS_RULE,
  PROFILE_FIXED_MISMATCH: ISSUE_TYPES.VALUE,
  PROFILE_PATTERN_MISMATCH: ISSUE_TYPES.VALUE,
  REFERENCE_UNRESOLVED: ISSUE_TYPES.NOT_FOUND,
  CONTAINED_CYCLE: ISSUE_TYPES.STRUCTURE,
  FULLURL_ID_MISMATCH: ISSUE_TYPES.BUSINESS_RULE,
};

/**
 * The single value-free human-readable line for each code. **This is the redaction chokepoint**: it
 * is keyed only by the code, so no instance value can ever reach `diagnostics`. Every string here is
 * a description of the *kind* of problem, never a rendering of the offending data.
 */
const DIAGNOSTIC_OF: Readonly<Record<ValidationCode, string>> = {
  UNKNOWN_ELEMENT: "Element is not defined at this location in the resource structure.",
  RESOURCE_TYPE_UNKNOWN: "Resource is missing a resourceType and cannot be structurally validated.",
  RESOURCE_NOT_MODELED:
    "No structural schema is available for this resource type; structural validation was skipped.",
  TYPE_MISMATCH: "Element value is not of the shape its datatype requires.",
  CHOICE_AMBIGUOUS: "More than one variant of a choice element is present.",
  CARDINALITY_MIN: "Required element is missing.",
  CARDINALITY_MAX: "Element appears more times than its maximum cardinality allows.",
  PRIMITIVE_INVALID: "Primitive value does not match the required lexical form for its datatype.",
  CODE_INVALID: "Code is not in the required value set for this element.",
  UNHANDLED_MODIFIER_EXTENSION:
    "Element carries a modifierExtension this processor does not understand; it cannot be safely " +
    "processed and is rejected (fail-closed).",
  DUPLICATE_PROPERTY:
    "Property name appears more than once on this object; FHIR requires unique property names and " +
    "uses an array for a repeating element, so the element's value is ambiguous.",
  ARRAY_WRAPPED_SCALAR:
    "Single-valued element is wrapped in an array; FHIR JSON writes a 0..1 element as a name/value " +
    "pair and uses an array only for a repeating element, so the element's encoding is ambiguous.",
  NESTED_ARRAY:
    "A JSON array appears inside another array; FHIR JSON uses an array only for a repeating " +
    "element, so this shape has no meaning and its contents were not read. Content the sender " +
    "wrote is missing from the model at this position.",
  DROPPED_ELEMENT_TEXT:
    "Character data was written directly on this element; FHIR XML carries a primitive's value in " +
    "the value attribute, so an element has no slot for text and it was not read. Content the " +
    "sender wrote is missing from the model at this position.",
  ABSENCE_MARKER_CONFLICT:
    "Element carries a data-absent-reason extension and a value of its own; the document asserts " +
    "both that the element holds that value and that it holds none, and neither is preferred " +
    "here. Both are preserved.",
  ABSENCE_MARKER_UNREADABLE:
    "Element carries a data-absent-reason extension whose reason could not be read: it is absent, " +
    "empty, written more than once, or outside the value set the extension requires. The reason " +
    "is not guessed and the element is not read as populated.",
  RETRACTED_RESOURCE:
    "Resource is marked entered-in-error; it is retracted and must not be treated as active data.",
  INVARIANT_VIOLATED: "A resource invariant (content-validation constraint) was violated.",
  INVARIANT_UNCHECKED:
    "A resource invariant could not be evaluated by the bounded FHIRPath engine; it is reported " +
    "unchecked rather than assumed to pass.",
  UCUM_UNIT_UNRECOGNIZED:
    "Quantity declares the UCUM system but its unit code is absent or not a well-formed UCUM " +
    "expression; the unit is preserved verbatim and never converted.",
  VITAL_SIGN_UNIT_NONCONFORMANT:
    "Vital-signs measurement carries a unit the vital-signs profile does not allow for this code.",
  VALUE_TYPE_UNEXPECTED: "Observation value is present but not the expected type for this profile.",
  CODE_SYSTEM_UNKNOWN:
    "Coding uses a code system that is not in the known-systems registry; its codes cannot be " +
    "validated (an unrecognized system is not itself an error).",
  CODE_SYSTEM_UNEXPECTED: "Coding uses a code system that the bound value set does not draw from.",
  CODE_NOT_IN_VALUESET:
    "Coding is not a member of the value set required by this element's binding.",
  PROFILE_SLICE_UNMATCHED:
    "Element is present under closed slicing but matches none of the profile's defined slices.",
  PROFILE_SLICE_UNCHECKED:
    "Slice membership could not be evaluated (an unsupported discriminator); it is reported " +
    "unchecked rather than assumed to pass.",
  MUST_SUPPORT_ABSENT:
    "Profile marks this element must-support; it is absent. Must-support is a system obligation, " +
    "not an instance-presence requirement, this is informational, never an error.",
  PROFILE_VERSION_MISMATCH:
    "Instance declares a profile at a version the supplied profile set does not carry; it was not " +
    "validated against that exact version.",
  PROFILE_FIXED_MISMATCH:
    "Element value does not exactly match the value the profile fixes for it.",
  PROFILE_PATTERN_MISMATCH: "Element does not match the pattern the profile requires for it.",
  REFERENCE_UNRESOLVED:
    "Reference could not be resolved within the supplied closure; it is preserved and flagged, " +
    "never dropped (the target may live outside this Bundle).",
  CONTAINED_CYCLE:
    "Contained resources reference each other in a cycle; the containment graph is malformed and " +
    "was reported by the bounded cycle guard rather than followed into an unbounded loop.",
  FULLURL_ID_MISMATCH:
    "Bundle entry fullUrl is a RESTful URL whose id disagrees with the wrapped resource's id.",
};

/**
 * The value-free diagnostic line for a code, the only text that reaches an `OperationOutcome`.
 *
 * @param code - The validation code.
 * @returns A description of the *kind* of problem, guaranteed free of any instance value.
 * @example
 * ```ts
 * import { diagnosticFor } from "@cosyte/fhir";
 * diagnosticFor("CARDINALITY_MIN"); // "Required element is missing."
 * ```
 */
export function diagnosticFor(code: ValidationCode): string {
  return DIAGNOSTIC_OF[code];
}

/**
 * Construct a value-free {@link ValidationIssue}. The `IssueType` is fixed by the code; only the
 * `severity` is caller-chosen (it varies with lenient vs strict mode for some codes).
 *
 * @param code - The validation code.
 * @param severity - The R4 severity to record (mode-dependent for some codes).
 * @param expression - The FHIRPath location of the finding, never a value.
 * @param constraint - The spec constraint key, for an invariant finding only (e.g. `"ait-1"`).
 * @param codeSystemVersion - The code-system release record, for a finding a terminology service
 *   produced only. Omit it for every finding no service was consulted for; passing
 *   `{ declared: false }` is the distinct claim that a service answered and named no release.
 * @example
 * ```ts
 * import { validationIssue } from "@cosyte/fhir";
 * const issue = validationIssue("CODE_INVALID", "error", "Patient.gender");
 * ```
 */
export function validationIssue(
  code: ValidationCode,
  severity: ValidationSeverity,
  expression: string,
  constraint?: string,
  codeSystemVersion?: CodeSystemVersionRecord,
): ValidationIssue {
  const issue: ValidationIssue = { code, severity, type: ISSUE_TYPE_OF[code], expression };
  const withConstraint = constraint === undefined ? issue : { ...issue, constraint };
  return codeSystemVersion === undefined
    ? withConstraint
    : { ...withConstraint, codeSystemVersion };
}
