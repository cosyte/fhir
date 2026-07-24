/**
 * The fail-safe sentinel for the bounded FHIRPath engine (Phase 7, ADR 0002).
 *
 * @packageDocumentation
 */

/**
 * Thrown when the bounded FHIRPath subset cannot **lex, parse, or evaluate** an expression, an
 * unrecognised character, an unsupported function or operator, a construct the evaluator does not
 * implement, or a runtime type it cannot reconcile. It is the seam the roadmap §6 fail-safe hangs on:
 * an invariant whose expression raises this is reported **`INVARIANT_UNCHECKED` (information)**, the
 * library never claims such a constraint *passed*, only that it could not evaluate it. Widening the
 * subset means catching one of these cases in the parser/evaluator, never suppressing it at the call
 * site.
 *
 * The message is **value-free**, it names the offending FHIRPath construct or position, never an
 * instance value, so it is safe to surface (roadmap §7 PHI discipline).
 *
 * @example
 * ```ts
 * import { evaluateInvariant, UnsupportedFhirPathError } from "@cosyte/fhir";
 * try {
 *   // `descendants()` is outside the bounded subset:
 *   throw new UnsupportedFhirPathError("unsupported function descendants()");
 * } catch (e) {
 *   if (e instanceof UnsupportedFhirPathError) console.error(e.message);
 * }
 * ```
 */
export class UnsupportedFhirPathError extends Error {
  /**
   * @param message - A value-free description of the construct the subset does not support.
   */
  public constructor(message: string) {
    super(message);
    this.name = "UnsupportedFhirPathError";
  }
}
