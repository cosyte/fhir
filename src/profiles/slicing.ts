/**
 * Slicing, assigning instance occurrences of a repeating element to the profile's named slices
 * (elementdefinition.html §slicing).
 *
 * A profile can **slice** a repeating element: split it into named sub-groups, each with its own
 * constraints, told apart by one or more **discriminators**. R4 defines the discriminator types
 * `value | exists | pattern | type | profile` (`valueset-discriminator-type`); **`position` is
 * R5-only** and is treated here as unsupported, never silently accepted.
 *
 * **What this module evaluates, and what it defers.** Full discriminator evaluation needs a FHIRPath
 * engine. This module evaluates the discriminator kinds reachable with
 * the bounded path navigator ({@link ./navigate.js}): **`value`** and **`pattern`** (the instance's
 * value at the discriminator path must match the slice's `fixed[x]` / `pattern[x]` there) and
 * **`exists`** (the element's presence must match the slice's cardinality there; where the slice's
 * own descendant AT that path is required and prohibited at once, no presence matches it, so it
 * assigns no occurrence rather than resolving toward one of the two). A `type` or
 * `profile` discriminator, an R5 `position`, an empty discriminator set, or a slice that declares no
 * constraint at a discriminator path is **not guessed**, the whole slicing is reported *unchecked*
 * (`PROFILE_SLICE_UNCHECKED`) so membership is never silently assumed to pass or fail
 * (fail-safe). Full evaluation of the deferred kinds needs the FHIRPath engine.
 *
 * @packageDocumentation
 */

import { UNBOUNDED } from "../validate/schema.js";
import { matchesFixed, matchesPattern } from "./fixed-pattern.js";
import { pathExists, resolvePath } from "./navigate.js";
import type { ElementDefinition } from "./structure-definition.js";
import type { FhirNode } from "../model/index.js";

/** The discriminator kinds this module can evaluate without a FHIRPath engine. */
const SUPPORTED_DISCRIMINATORS: ReadonlySet<string> = new Set(["value", "pattern", "exists"]);

/** One `fixed[x]` / `pattern[x]` constraint a slice imposes, at a path relative to the slice element. */
export interface SliceConstraint {
  /** The path relative to the sliced element (`"$this"` for the slice element itself). */
  readonly path: string;
  /** Whether the constraint is `fixed` (exact) or `pattern` (subset). */
  readonly kind: "fixed" | "pattern";
  /** The constraint value node. */
  readonly value: FhirNode;
}

/** A resolved slice: its name, cardinality, value constraints, and existence expectations. */
export interface SliceDefinition {
  /** The slice name (e.g. `"VSCat"`). */
  readonly sliceName: string;
  /** The slice's minimum cardinality, when stated. */
  readonly min?: number;
  /** The slice's maximum cardinality, when stated. */
  readonly max?: number;
  /** The `fixed`/`pattern` constraints the slice imposes, at paths relative to the sliced element. */
  readonly constraints: readonly SliceConstraint[];
  /** Relative paths whose presence/absence the slice fixes (min ≥ 1 → present; max 0 → absent). */
  readonly existsExpectations: ReadonlyMap<string, boolean>;
  /**
   * Relative paths the slice fixes as present **and** absent at once (`min ≥ 1` beside `max 0`).
   * No instance can meet such an expectation, so an `exists` discriminator on one of these paths
   * assigns no occurrence to this slice. Kept apart from {@link existsExpectations} rather than
   * resolved into a boolean there: neither boolean is true of a contradiction, and picking one
   * admits occurrences the profile forbids.
   */
  readonly unsatisfiableExists: ReadonlySet<string>;
}

/** A discriminator, as modeled on {@link ../profiles/structure-definition.js Slicing}. */
interface Discriminator {
  readonly type: string;
  readonly path: string;
}

/** The outcome of matching a sliced element's instance occurrences to its slices. */
export interface SliceMatchResult {
  /** Per instance occurrence (in order), the matched slice name, or `undefined` when none matched. */
  readonly assignments: readonly (string | undefined)[];
  /** `true` when membership could not be evaluated (an unsupported/insufficient discriminator). */
  readonly unchecked: boolean;
}

/**
 * Resolve the slices a sliced element introduces, reading each slice's constraints and existence
 * expectations from the snapshot (the slice element's own `fixed`/`pattern`, plus any descendant
 * element that carries one).
 *
 * @param snapshot - The full snapshot element list.
 * @param slicedElement - The element carrying the `slicing` declaration.
 * @returns The slice definitions, in snapshot order.
 * @example
 * ```ts
 * import { resolveSlices } from "@cosyte/fhir";
 * // snapshot contains `Observation.category` (slicing) + `Observation.category:VSCat` (pattern):
 * const slices = resolveSlices(snapshot, categoryElement); // → [{ sliceName: "VSCat", … }]
 * ```
 */
export function resolveSlices(
  snapshot: readonly ElementDefinition[],
  slicedElement: ElementDefinition,
): SliceDefinition[] {
  const prefix = `${slicedElement.path}.`;
  const slices: SliceDefinition[] = [];
  for (const el of snapshot) {
    if (el.sliceName === undefined || el.path !== slicedElement.path) continue;
    const constraints: SliceConstraint[] = [];
    const existsExpectations = new Map<string, boolean>();
    const unsatisfiableExists = new Set<string>();
    if (el.fixed !== undefined)
      constraints.push({ path: "$this", kind: "fixed", value: el.fixed.value });
    if (el.pattern !== undefined)
      constraints.push({ path: "$this", kind: "pattern", value: el.pattern.value });

    const sliceIdPrefix = `${el.id}.`;
    for (const desc of snapshot) {
      if (!desc.id.startsWith(sliceIdPrefix)) continue;
      const rel = desc.path.startsWith(prefix) ? desc.path.slice(prefix.length) : desc.path;
      if (desc.fixed !== undefined)
        constraints.push({ path: rel, kind: "fixed", value: desc.fixed.value });
      if (desc.pattern !== undefined)
        constraints.push({ path: rel, kind: "pattern", value: desc.pattern.value });
      // A descendant states an existence expectation through its cardinality: required means the
      // path must be present, prohibited means it must be absent. A descendant stating BOTH at once
      // (`min ≥ 1` beside `max 0`) is a contradiction no instance can satisfy, and the ordering of
      // these two branches alone used to decide it: `min` was read first, so the prohibition was
      // discarded and every occurrence carrying the forbidden element was admitted into the slice.
      // Beneath a `closed` slicing that silently retired a `PROFILE_SLICE_UNMATCHED` and the slice's
      // own `CARDINALITY_MIN`. It is recorded as unsatisfiable instead, which assigns no occurrence
      // to the slice, so the two findings are drawn rather than resolved away.
      //
      // Scoped to the `exists` discriminator on purpose. An unsatisfiable descendant does not make
      // the slice unmatchable in general: membership is decided by the discriminators, and an
      // occurrence may be assigned to a slice it then violates. Only a contradiction AT a
      // discriminator path makes membership itself undecidable in the instance's favour.
      //
      // Scoped to the slice's OWN descendants (`sliceName === undefined`) as well, which is not
      // cosmetic. This walk sweeps every element under the slice's id prefix, and a RE-SLICE of a
      // descendant is under that prefix too and flattens onto the same relative path. Recording a
      // re-slice's contradiction here made the satisfiable OUTER slice unmatchable and drew a
      // `PROFILE_SLICE_UNMATCHED` plus a slice `CARDINALITY_MIN` on a CONFORMANT document: it
      // blamed the instance for a statement belonging to a different slice. Re-slicing is a declared
      // deferral of this module, so a contradiction carried only by a re-slice is left reading as it
      // did before rather than guessed at from the outer slice's position.
      if (desc.sliceName === undefined && desc.min !== undefined && desc.min >= 1 && desc.max === 0)
        unsatisfiableExists.add(rel);
      else if (desc.min !== undefined && desc.min >= 1) existsExpectations.set(rel, true);
      else if (desc.max === 0) existsExpectations.set(rel, false);
    }

    const def: { -readonly [K in keyof SliceDefinition]: SliceDefinition[K] } = {
      sliceName: el.sliceName,
      constraints,
      existsExpectations,
      unsatisfiableExists,
    };
    if (el.min !== undefined) def.min = el.min;
    if (el.max !== undefined) def.max = el.max;
    slices.push(def);
  }
  return slices;
}

/** Whether an instance occurrence satisfies one discriminator for one slice, or cannot be evaluated. */
function discriminatorHolds(
  instance: FhirNode,
  discriminator: Discriminator,
  slice: SliceDefinition,
): "yes" | "no" | "unevaluable" {
  const { type, path } = discriminator;
  if (type === "exists") {
    // A contradiction is answered `no`, never `unevaluable`. `unevaluable` reports the whole slicing
    // `unchecked`, which returns before the unmatched-occurrence and slice-cardinality arms and so
    // would retire every finding this case exists to draw. It is not a guess either: no instance has
    // a path both present and absent. `no` is not purely additive against the previous behaviour
    // though: an occurrence no longer admitted stops counting toward the slice, and stops shadowing
    // later slices in the match loop, so a finding that existed only because of the wrongful
    // admission goes. That is measured rather than claimed away, in
    // `documentation/agent-notes/profile-slice-contradiction.md`.
    if (slice.unsatisfiableExists.has(path)) return "no";
    const expected = slice.existsExpectations.get(path);
    if (expected === undefined) return "unevaluable";
    return pathExists(instance, path) === expected ? "yes" : "no";
  }
  // value | pattern: the slice must pin a value at the discriminator path.
  const constraint = slice.constraints.find((c) => c.path === path);
  if (constraint === undefined) return "unevaluable";
  const targets = resolvePath(instance, path);
  const matcher = constraint.kind === "fixed" ? matchesFixed : matchesPattern;
  return targets.some((t) => matcher(t, constraint.value)) ? "yes" : "no";
}

/**
 * Assign each instance occurrence of a sliced element to a slice (or none), per the discriminators.
 *
 * Returns `unchecked: true`, and no assignments the caller should act on, when membership cannot be
 * evaluated: an empty discriminator set, any discriminator of an unsupported type (`type`, `profile`,
 * R5 `position`, …), or any slice that declares no constraint at a discriminator path. The library
 * does **not** guess a slice assignment it cannot justify.
 *
 * @param instances - The instance occurrences of the sliced element, in order.
 * @param slices - The resolved slice definitions.
 * @param discriminators - The slicing's discriminators.
 * @returns The per-occurrence assignments and the `unchecked` flag.
 * @example
 * ```ts
 * import { matchSlices } from "@cosyte/fhir";
 * const result = matchSlices(categoryOccurrences, slices, [{ type: "pattern", path: "$this" }]);
 * result.assignments; // e.g. ["VSCat", undefined]
 * ```
 */
export function matchSlices(
  instances: readonly FhirNode[],
  slices: readonly SliceDefinition[],
  discriminators: readonly Discriminator[],
): SliceMatchResult {
  const unchecked = (): SliceMatchResult => ({
    assignments: instances.map(() => undefined),
    unchecked: true,
  });

  if (discriminators.length === 0) return unchecked();
  if (discriminators.some((d) => !SUPPORTED_DISCRIMINATORS.has(d.type))) return unchecked();

  const assignments: (string | undefined)[] = [];
  for (const instance of instances) {
    let matched: string | undefined;
    for (const slice of slices) {
      const verdicts = discriminators.map((d) => discriminatorHolds(instance, d, slice));
      if (verdicts.includes("unevaluable")) return unchecked();
      if (verdicts.every((v) => v === "yes")) {
        matched = slice.sliceName;
        break;
      }
    }
    assignments.push(matched);
  }
  return { assignments, unchecked: false };
}

/** Re-export for callers building cardinality checks over a slice's max (`UNBOUNDED` for `*`). */
export { UNBOUNDED };
