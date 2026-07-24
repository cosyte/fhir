/**
 * The invariant validation layer (Phase 7), evaluate a profile's `constraint[]` (FHIRPath invariants)
 * against an instance, the sixth-and-final validation layer (roadmap §6: structure → cardinality →
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
 *   **never silently passed** (roadmap §6 fail-safe).
 *
 * **The seven named safety invariants (`ait-1`/`ait-2`, `con-3`/`con-4`/`con-5`, `obs-6`/`obs-7`) are
 * skipped here**, the always-on Phase-3 safety layer ({@link ../validate/safety.js}) owns them,
 * hand-evaluated from their exact R4 FHIRPath so they fire *with or without* a supplied profile.
 * Evaluating them again from a profile snapshot would double the finding at a different location. The
 * generic engine covers **every other** constraint a supplied profile carries (base `ele-1` / `dom-*`,
 * US Core `us-core-*`, vendor invariants). Its agreement with the reference validator on the named
 * safety expressions is proven directly against {@link ../fhirpath/index.js evaluateInvariant}.
 *
 * @packageDocumentation
 */

import { evaluateInvariant } from "../fhirpath/index.js";
import {
  isComplex,
  isList,
  resourceType,
  type FhirComplex,
  type FhirNode,
} from "../model/index.js";
import { ISSUE_SEVERITIES, validationIssue, type ValidationIssue } from "../validate/issues.js";
import { resolvePath } from "./navigate.js";
import { snapshotElements, type BaseResolver } from "./snapshot.js";
import type { StructureDefinition } from "./structure-definition.js";

/** Options for {@link collectInvariantIssues}. */
export interface InvariantOptions {
  /** Base resolver for snapshot generation, needed only when the profile carries no snapshot. */
  readonly resolve?: BaseResolver;
}

/**
 * The constraint keys the Phase-3 safety layer hand-evaluates and therefore owns. The generic engine
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

/** Flatten a resolved path result into individual complex occurrences (constraints anchor on elements). */
function complexOccurrences(nodes: readonly FhirNode[]): FhirComplex[] {
  return nodes.flatMap((n) => (isList(n) ? n.items : [n])).filter(isComplex);
}

/**
 * The instance occurrences a constraint on `elementPath` is evaluated against. A root-level constraint
 * (path === the resource type) evaluates once against the whole resource; a nested one evaluates once
 * per present occurrence of that element (a primitive occurrence carries no invariants to anchor, so
 * only complex occurrences are used).
 */
function fociFor(resource: FhirComplex, rt: string, elementPath: string): Focus[] {
  if (elementPath === rt) return [{ node: resource, path: rt }];
  const rel = elementPath.slice(rt.length + 1);
  const occ = complexOccurrences(resolvePath(resource, rel));
  return occ.map((node, i) => ({
    node,
    path: occ.length > 1 ? `${rt}.${rel}[${String(i)}]` : `${rt}.${rel}`,
  }));
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
 * const issues = collectInvariantIssues(parseResource(instanceJson).resource, profile);
 * ```
 */
export function collectInvariantIssues(
  resource: FhirComplex,
  profile: StructureDefinition,
  options: InvariantOptions = {},
): ValidationIssue[] {
  const rt = resourceType(resource);
  if (rt === undefined || rt !== profile.type) return [];

  const snapshot = snapshotElements(profile, options.resolve ?? (() => undefined));
  const issues: ValidationIssue[] = [];

  for (const el of snapshot) {
    if (el.constraint === undefined || el.constraint.length === 0) continue;
    if (el.sliceName !== undefined) continue; // slice-scoped constraints are handled with their slice (deferred).

    const foci = fociFor(resource, rt, el.path);
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
          issues.push(
            validationIssue(
              "INVARIANT_UNCHECKED",
              ISSUE_SEVERITIES.INFORMATION,
              focus.path,
              constraint.key,
            ),
          );
        } else if (!satisfied) {
          issues.push(validationIssue("INVARIANT_VIOLATED", severity, focus.path, constraint.key));
        }
      }
    }
  }
  return issues;
}
