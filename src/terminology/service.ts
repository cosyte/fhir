/**
 * The **pluggable terminology-service interface**. None is bundled.
 *
 * Validating that a code is a *member* of a value set needs the value set's expansion, i.e. the
 * SNOMED / LOINC / RxNorm / CPT content the library deliberately does **not** vendor
 * (licensing). That work is delegated to a terminology service a consumer supplies: a small interface
 * with one operation, `$validate-code`-shaped, so an adapter over a real terminology server (HL7's
 * `tx.fhir.org`, a VSAC-backed service, an in-house expansion) can satisfy it.
 *
 * **Fail-safe by design.** The interface can always answer {@link CodeMembership} `"unknown"`, a
 * service that cannot decide (offline, value set not loaded, code system not installed) says so, and
 * the validator degrades to the system-level, content-free checks rather than inventing a verdict.
 * With **no** service configured at all, the validator behaves as if every membership question
 * returned `"unknown"`: it never emits a false "not a member" error (fail-safe).
 *
 * **A membership answer may declare the code-system release it was made against.** A `not-in` for an
 * RxNorm code is an answer against one monthly RxNorm drop, not a timeless fact, so
 * {@link CodeValidationResult} carries an optional `systemVersion`: the release the service consulted
 * when it decided. The declaration is the **caller's own assertion** and the library verifies nothing
 * about it, it does not fetch, parse, compare or normalise the string, and it bundles no code-system
 * content against which it could. The declaration is **optional and additive**: a service that
 * declares nothing is a conformant service, and the absent case is a first-class part of this
 * contract rather than an omission, a finding derived from an undeclared answer is marked as having
 * an undeclared release rather than left silent (see {@link ../validate/issues.js}
 * `CodeSystemVersionRecord`), because a silence reads as "current" and that is exactly the
 * implication a stale answer must not carry.
 *
 * The library ships **no implementation**, wiring a real one is a consumer/`pathways` concern. This
 * module defines only the contract.
 *
 * @packageDocumentation
 */

/**
 * A value-set membership question: is `(system, code)` a member of the value set identified by
 * `valueSet`? All three are plain identities, no PHI, no resource value.
 */
export interface CodeValidationRequest {
  /** The value set's canonical identity (URL / OID form), from the element's binding. */
  readonly valueSet: string;
  /** The coding's `system` URI. */
  readonly system: string;
  /** The coding's `code`. */
  readonly code: string;
}

/**
 * A membership verdict. `"unknown"` is a first-class answer, not a failure, a conformant service
 * returns it whenever it cannot decide, and the validator degrades cleanly rather than guessing.
 */
export type CodeMembership =
  /** The code is a member of the value set. */
  | "in"
  /** The code is definitively **not** a member of the value set. */
  | "not-in"
  /** The service cannot decide (value set / code system not loaded, offline, …). */
  | "unknown";

/** The result of a {@link CodeValidationRequest}. */
export interface CodeValidationResult {
  /** Whether the code is in the value set, not in it, or undecidable. */
  readonly membership: CodeMembership;
  /**
   * **Optional.** The code-system release this answer was made against, exactly as the service
   * names it: an RxNorm monthly drop (`"2026-08-04"`), a SNOMED CT edition
   * (`"http://snomed.info/sct/731000124108/version/20260301"`), a LOINC release (`"2.78"`). It is
   * carried onto the finding the validator emits (`CODE_NOT_IN_VALUESET`) and reaches the
   * `OperationOutcome`, so a consumer reconciling a validation report months later can tell which
   * release the answer was made against without asking the service again.
   *
   * **The library verifies nothing about it.** This is the service's own assertion, preserved
   * **exactly**: never trimmed, case-folded, parsed, truncated or substituted. The library vendors
   * no code-system content, so it has nothing to check the string against and does not pretend to.
   *
   * **Declaring nothing is conformant, and is recorded rather than assumed.** Omit it (or, from
   * untyped JavaScript, hand over a value that is not a non-blank string) and the finding is marked
   * as having an **undeclared** release. No default, "latest" or "current" release is ever
   * substituted, and the answer is otherwise unchanged: this field never affects `membership`,
   * severity, or whether a finding is emitted at all.
   *
   * It is a code-**system** release, not a value-set version, and it must never be read from the
   * instance being validated: a resource's own `Coding.version` is document content, and echoing it
   * onto a finding would publish instance data through the one surface this library keeps
   * value-free.
   */
  readonly systemVersion?: string;
}

/**
 * A pluggable terminology service, the one seam through which value-set **content** enters the
 * library. A consumer implements this over a real terminology server; the library bundles none.
 *
 * An implementation MUST be **fail-safe**: when it cannot answer, it returns
 * `{ membership: "unknown" }` rather than throwing or guessing. It MUST be value-free, it receives
 * only identities ({@link CodeValidationRequest}), never a resource or a patient value. It MAY
 * declare the code-system release an answer was made against
 * ({@link CodeValidationResult.systemVersion}); declaring nothing is conformant and is recorded as
 * undeclared rather than read as "current".
 *
 * @example
 * ```ts
 * import type { TerminologyService } from "@cosyte/fhir";
 *
 * // A trivial service that only knows one value set; everything else is "unknown".
 * const svc: TerminologyService = {
 *   validateCode({ valueSet, code }) {
 *     if (valueSet !== "http://example.org/vs/colors") return { membership: "unknown" };
 *     return { membership: ["red", "green", "blue"].includes(code) ? "in" : "not-in" };
 *   },
 * };
 *
 * // The same service, declaring the release each answer was made against.
 * const dated: TerminologyService = {
 *   validateCode({ valueSet, code }) {
 *     if (valueSet !== "http://example.org/vs/colors") return { membership: "unknown" };
 *     const membership = ["red", "green", "blue"].includes(code) ? "in" : "not-in";
 *     return { membership, systemVersion: "2026-08-04" };
 *   },
 * };
 * ```
 */
export interface TerminologyService {
  /**
   * Decide whether a coding is a member of a value set.
   *
   * @param request - The value-set identity and the `(system, code)` to check.
   * @returns The membership verdict, `"unknown"` when it cannot decide.
   */
  validateCode(request: CodeValidationRequest): CodeValidationResult;
}
