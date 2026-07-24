/**
 * The bounded FHIRPath engine (Phase 7, ADR 0002), lexer → parser → evaluator, plus the
 * invariant-oriented {@link evaluateInvariant} entry point the validator uses.
 *
 * This is a **vendored, capped subset** of FHIRPath, not a general engine and not a runtime
 * dependency: it evaluates the `constraint.expression`s and discriminator-shaped paths the R4 /
 * US Core invariant set uses, and **refuses everything else** by raising
 * {@link ./errors.js UnsupportedFhirPathError}. The refusal is the feature, the validator turns it
 * into `INVARIANT_UNCHECKED` (roadmap §6 fail-safe: an expression the subset cannot evaluate is
 * reported unchecked, never silently passed).
 *
 * @packageDocumentation
 */

import { convertToBoolean, evaluate, focusCollection } from "./evaluate.js";
import { parseFhirPath } from "./parser.js";
import type { FhirComplex, FhirNode } from "../model/node.js";

export { UnsupportedFhirPathError } from "./errors.js";
export { tokenize } from "./lexer.js";
export type { Token, TokenType } from "./lexer.js";
export { parseFhirPath } from "./parser.js";
export type { Expr } from "./parser.js";
export { convertToBoolean } from "./evaluate.js";
export type { FpColl, FpItem } from "./evaluate.js";

/** The outcome of evaluating one invariant expression against an instance. */
export interface InvariantResult {
  /**
   * `true` when the bounded subset could not lex/parse/evaluate the expression. The caller reports
   * this as `INVARIANT_UNCHECKED`, **the invariant is never treated as satisfied when unchecked**.
   */
  readonly unchecked: boolean;
  /** Whether the constraint is satisfied. Meaningful only when {@link unchecked} is `false`. */
  readonly satisfied: boolean;
}

/**
 * Evaluate one FHIRPath invariant `expression` against a focus node.
 *
 * The result is judged by {@link convertToBoolean} (empty → not satisfied), matching the reference
 * validator's coercion. **Fail-safe:** any {@link UnsupportedFhirPathError}, or any other evaluation
 * error, yields `{ unchecked: true, satisfied: false }`; the engine never reports a constraint
 * *satisfied* on a failure, so an unevaluable expression is surfaced as unchecked, never a false pass.
 *
 * @param expression - The FHIRPath constraint expression (e.g. `dataAbsentReason.empty() or value.empty()`).
 * @param focus - The node the constraint is anchored to (the resource, or an element occurrence).
 * @param resource - The root resource, bound to `%resource` / `%rootResource` inside the expression.
 * @returns The {@link InvariantResult}.
 * @example
 * ```ts
 * import { evaluateInvariant, parseResource } from "@cosyte/fhir";
 * const { resource } = parseResource('{"resourceType":"Observation","valueString":"x","dataAbsentReason":{}}');
 * evaluateInvariant("dataAbsentReason.empty() or value.empty()", resource, resource);
 * // → { unchecked: false, satisfied: false }  (obs-6 violated: both present)
 * ```
 */
export function evaluateInvariant(
  expression: string,
  focus: FhirComplex,
  resource: FhirNode,
): InvariantResult {
  try {
    const ast = parseFhirPath(expression);
    const result = evaluate(ast, focusCollection(focus), {
      resource,
      context: focusCollection(focus),
    });
    return { unchecked: false, satisfied: convertToBoolean(result) };
  } catch {
    // Fail-safe: a parse/eval failure (unsupported construct, or a defensive catch-all) is *unchecked*,
    // never a satisfied constraint. The specific reason is intentionally not surfaced (value-free).
    return { unchecked: true, satisfied: false };
  }
}
