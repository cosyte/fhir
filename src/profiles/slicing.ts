/**
 * Slicing, assigning instance occurrences of a repeating element to the profile's named slices
 * (Phase 6, elementdefinition.html §slicing).
 *
 * A profile can **slice** a repeating element: split it into named sub-groups, each with its own
 * constraints, told apart by one or more **discriminators**. R4 defines the discriminator types
 * `value | exists | pattern | type | profile` (`valueset-discriminator-type`); **`position` is
 * R5-only** and is treated here as unsupported, never silently accepted.
 *
 * **What this phase evaluates, and what it defers.** Full discriminator evaluation needs a FHIRPath
 * engine (roadmap §10 item 1, Phase 7). This phase evaluates the discriminator kinds reachable with
 * the bounded path navigator ({@link ./navigate.js}): **`value`** and **`pattern`** (the instance's
 * value at the discriminator path must match the slice's `fixed[x]` / `pattern[x]` there) and
 * **`exists`** (the element's presence must match the slice's cardinality there). A `type` or
 * `profile` discriminator, an R5 `position`, an empty discriminator set, or a slice that declares no
 * constraint at a discriminator path is **not guessed**, the whole slicing is reported *unchecked*
 * (`PROFILE_SLICE_UNCHECKED`) so membership is never silently assumed to pass or fail (roadmap §6
 * fail-safe). Full evaluation of the deferred kinds lands with Phase 7's FHIRPath subset.
 *
 * @packageDocumentation
 */

import { UNBOUNDED } from "../validate/schema.js";
import { matchesFixed, matchesPattern } from "./fixed-pattern.js";
import { pathExists, resolvePath } from "./navigate.js";
import type { ElementDefinition } from "./structure-definition.js";
import type { FhirNode } from "../model/index.js";

/** The discriminator kinds this phase can evaluate without a FHIRPath engine. */
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
      if (desc.min !== undefined && desc.min >= 1) existsExpectations.set(rel, true);
      else if (desc.max === 0) existsExpectations.set(rel, false);
    }

    const def: { -readonly [K in keyof SliceDefinition]: SliceDefinition[K] } = {
      sliceName: el.sliceName,
      constraints,
      existsExpectations,
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
