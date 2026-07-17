/**
 * The **pluggable terminology-service interface** (Phase 5). None is bundled.
 *
 * Validating that a code is a *member* of a value set needs the value set's expansion — i.e. the
 * SNOMED / LOINC / RxNorm / CPT content the library deliberately does **not** vendor (roadmap §5
 * licensing). That work is delegated to a terminology service a consumer supplies: a small interface
 * with one operation, `$validate-code`-shaped, so an adapter over a real terminology server (HL7's
 * `tx.fhir.org`, a VSAC-backed service, an in-house expansion) can satisfy it.
 *
 * **Fail-safe by design.** The interface can always answer {@link CodeMembership} `"unknown"` — a
 * service that cannot decide (offline, value set not loaded, code system not installed) says so, and
 * the validator degrades to the system-level, content-free checks rather than inventing a verdict.
 * With **no** service configured at all, the validator behaves as if every membership question
 * returned `"unknown"`: it never emits a false "not a member" error (roadmap §5 fail-safe).
 *
 * The library ships **no implementation** — wiring a real one is a consumer/`pathways` concern. This
 * module defines only the contract.
 *
 * @packageDocumentation
 */

/**
 * A value-set membership question: is `(system, code)` a member of the value set identified by
 * `valueSet`? All three are plain identities — no PHI, no resource value.
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
 * A membership verdict. `"unknown"` is a first-class answer, not a failure — a conformant service
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
}

/**
 * A pluggable terminology service — the one seam through which value-set **content** enters the
 * library. A consumer implements this over a real terminology server; the library bundles none.
 *
 * An implementation MUST be **fail-safe**: when it cannot answer, it returns
 * `{ membership: "unknown" }` rather than throwing or guessing. It MUST be value-free — it receives
 * only identities ({@link CodeValidationRequest}), never a resource or a patient value.
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
 * ```
 */
export interface TerminologyService {
  /**
   * Decide whether a coding is a member of a value set.
   *
   * @param request - The value-set identity and the `(system, code)` to check.
   * @returns The membership verdict — `"unknown"` when it cannot decide.
   */
  validateCode(request: CodeValidationRequest): CodeValidationResult;
}
