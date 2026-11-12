/**
 * The invariant validation layer, evaluate a profile's `constraint[]` (FHIRPath invariants)
 * against an instance, the sixth-and-final validation layer (structure → cardinality →
 * value-domain → terminology → profile → **invariant**).
 *
 * For every element in a profile's snapshot that carries `constraint`s, this resolves the element's
 * occurrences in the instance (the resource itself for a root-level constraint, or each present
 * occurrence for a nested one) and evaluates each constraint's `expression` with the bounded FHIRPath
 * engine ({@link ../fhirpath/index.js}):
 *
 * - a **violated** constraint → `INVARIANT_VIOLATED`, its severity mirroring the constraint's own
 *   (`error` | `warning`), carrying the constraint `key`;
 * - an expression the engine **cannot evaluate** → `INVARIANT_UNCHECKED` (`information`), surfaced,
 *   **never silently passed** (fail-safe).
 *
 * **The seven named safety invariants (`ait-1`/`ait-2`, `con-3`/`con-4`/`con-5`, `obs-6`/`obs-7`) are
 * skipped here**, the always-on safety layer ({@link ../validate/safety.js}) owns them,
 * hand-evaluated from their exact R4 FHIRPath so they fire *with or without* a supplied profile.
 * Evaluating them again from a profile snapshot would double the finding at a different location. The
 * generic engine covers **every other** constraint a supplied profile carries (base `ele-1` / `dom-*`,
 * US Core `us-core-*`, vendor invariants). Its agreement with the reference validator on the named
 * safety expressions is proven directly against {@link ../fhirpath/index.js evaluateInvariant}.
 *
 * **What {@link collectInvariantIssues} returns does not depend on the base-constraint layer.**
 * Called directly it reports every constraint the profile carries, the R4 base ones (`pat-1`,
 * `ext-1`, `ele-1`, `dom-2` and the rest) included. Under `validateResource` the base-constraint
 * layer ({@link ../validate/base-invariants.js}) evaluates those base constraints on the eleven
 * modeled types whether or not a profile is supplied, and a finding this layer makes at the same
 * occurrence, for the same key and code, is reported once rather than twice. Where that layer
 * decided a base constraint at an occurrence and this layer could not evaluate the profile's
 * verbatim copy of it there (`dom-3`, whose expression lies outside the subset, over a resource
 * with no `contained` entry), the decision stands and no `INVARIANT_UNCHECKED` is added for it.
 *
 * @packageDocumentation
 */

import { evaluateInvariant } from "../fhirpath/index.js";
import { isComplex, resourceType, rootPath, type FhirComplex } from "../model/index.js";
import { ISSUE_SEVERITIES, validationIssue, type ValidationIssue } from "../validate/issues.js";
import { SliceScope } from "./scope.js";
import { snapshotElements, type BaseResolver } from "./snapshot.js";
import type { ElementDefinition, StructureDefinition } from "./structure-definition.js";
import { sliceEnvironment } from "./validate-profile.js";

/** Options for {@link collectInvariantIssues}. */
export interface InvariantOptions {
  /** Base resolver for snapshot generation, needed only when the profile carries no snapshot. */
  readonly resolve?: BaseResolver;
  /**
   * The supplied profile set, so a slicing discriminated by `profile` decides which occurrences a
   * slice's invariants apply to, exactly as the profile layer decides it.
   */
  readonly profiles?: readonly StructureDefinition[];
}

/**
 * The constraint keys the safety layer hand-evaluates and therefore owns. The generic engine
 * skips them so a supplied US Core profile (whose snapshot inherits them) does not double the finding.
 */
const SAFETY_OWNED_KEYS: ReadonlySet<string> = new Set([
  "ait-1",
  "ait-2",
  "con-3",
  "con-4",
  "con-5",
  "obs-6",
  "obs-7",
]);

/** One occurrence of an element to evaluate a constraint against: the focus node and its location. */
interface Focus {
  readonly node: FhirComplex;
  readonly path: string;
}

/**
 * The instance occurrences a constraint on `el` is evaluated against. A root-level constraint (path ===
 * the resource type) evaluates once against the whole resource; a nested one evaluates once per
 * present occurrence of that element within its slice's members when its id names a slice (a
 * primitive occurrence carries no invariants to anchor, so only complex occurrences are used).
 */
function fociFor(scope: SliceScope, el: ElementDefinition): Focus[] {
  return scope
    .occurrences(el)
    .flatMap(({ node, path }) => (isComplex(node) ? [{ node, path }] : []));
}

/**
 * Collect every invariant finding for a resource validated against one profile.
 *
 * @param resource - The resource model.
 * @param profile - The profile whose `constraint`s to evaluate.
 * @param options - Optional base resolver for snapshot generation.
 * @returns The value-free invariant {@link ValidationIssue}s (`INVARIANT_VIOLATED` / `INVARIANT_UNCHECKED`).
 *   Empty when the profile does not apply, carries no constraints, or the resource satisfies them all.
 * @example
 * ```ts
 * import { collectInvariantIssues, loadStructureDefinition, parseResource } from "@cosyte/fhir";
 * const profile = loadStructureDefinition(parseResource(usCoreProfileJson).resource);
 * if (profile !== undefined) {
 *   const issues = collectInvariantIssues(parseResource(instanceJson).resource, profile);
 * }
 * ```
 */
export function collectInvariantIssues(
  resource: FhirComplex,
  profile: StructureDefinition,
  options: InvariantOptions = {},
): ValidationIssue[] {
  return invariantFindings(resource, profile, options).map((finding) => finding.issue);
}

/**
 * One profile invariant finding with the occurrence it was evaluated against, so the validator can
 * tell a finding the base-constraint layer already made at that occurrence from a new one.
 *
 * @internal
 */
export interface InvariantFinding {
  readonly issue: ValidationIssue;
  /** The node the constraint was evaluated against: the resource, or one element occurrence. */
  readonly focus: FhirComplex;
  /** The constraint's `expression`, exactly as the profile carries it. */
  readonly expression: string;
}

/**
 * {@link collectInvariantIssues} with each finding's focus kept beside it. The issues, their order
 * and their locations are exactly the ones {@link collectInvariantIssues} returns.
 *
 * @param resource - The resource model.
 * @param profile - The profile whose `constraint`s to evaluate.
 * @param options - Optional base resolver for snapshot generation.
 * @returns The findings, in the order {@link collectInvariantIssues} returns their issues.
 * @internal
 */
export function invariantFindings(
  resource: FhirComplex,
  profile: StructureDefinition,
  options: InvariantOptions = {},
): InvariantFinding[] {
  const rt = resourceType(resource);
  if (rt === undefined || rt !== profile.type) return [];
  // The profile only applies when the two agree, so the location is bounded once, here.
  const root = rootPath(rt);

  const snapshot = snapshotElements(profile, options.resolve ?? (() => undefined));
  const scope = new SliceScope(resource, root, snapshot, sliceEnvironment(resource, options));
  const findings: InvariantFinding[] = [];

  for (const el of snapshot) {
    if (el.constraint === undefined || el.constraint.length === 0) continue;
    // A slice element's own constraints are deferred; its descendants are scoped to its members.
    if (el.sliceName !== undefined) continue;

    const foci = fociFor(scope, el);
    if (foci.length === 0) continue; // element absent → its invariants do not apply.

    for (const constraint of el.constraint) {
      if (SAFETY_OWNED_KEYS.has(constraint.key)) continue; // owned by the always-on safety layer.
      const severity =
        constraint.severity === "warning" ? ISSUE_SEVERITIES.WARNING : ISSUE_SEVERITIES.ERROR;
      for (const focus of foci) {
        const { unchecked, satisfied } = evaluateInvariant(
          constraint.expression,
          focus.node,
          resource,
        );
        if (unchecked) {
          findings.push({
            issue: validationIssue(
              "INVARIANT_UNCHECKED",
              ISSUE_SEVERITIES.INFORMATION,
              focus.path,
              constraint.key,
            ),
            focus: focus.node,
            expression: constraint.expression,
          });
        } else if (!satisfied) {
          findings.push({
            issue: validationIssue("INVARIANT_VIOLATED", severity, focus.path, constraint.key),
            focus: focus.node,
            expression: constraint.expression,
          });
        }
      }
    }
  }
  return findings;
}
