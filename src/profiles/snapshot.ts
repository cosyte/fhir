/**
 * Snapshot generation from a differential (Phase 6, the heaviest single piece — profiling.html).
 *
 * A FHIR profile is usually authored as a **differential**: only the elements it constrains, expressed
 * relative to the resource it profiles. To validate an instance you need the **snapshot**: the full,
 * flattened element list with every base element present and each differential constraint applied.
 * Published IGs ship the snapshot too, but a profile that carries only a differential must have one
 * generated — walk the `baseDefinition` chain to the base resource's snapshot, then overlay the
 * differential element by element.
 *
 * The merge is by element **id** (which encodes slice membership as `path:sliceName`): a differential
 * element whose id matches a base element **tightens** it (cardinality, `mustSupport`, `fixed` /
 * `pattern`, `binding`, `slicing`, `type`); a differential element with no match — a **slice**, or a
 * newly-constrained descendant — is **inserted** next to the element it belongs under. The base is
 * resolved through a caller-supplied {@link BaseResolver}: **no StructureDefinition content is
 * bundled**, so the caller provides the base resource's definition (a base R4 SD carries a full
 * snapshot, so the recursion bottoms out there).
 *
 * **Known limitation (deferred):** re-slicing and deep re-parenting of a slice's descendant elements
 * are not modeled — slice *membership* is resolved from the slice element and any descendant
 * `fixed`/`pattern` constraints (see {@link ./slicing.js}), which covers the US Core slice shapes,
 * but a profile that re-slices an inherited slice is out of this phase's scope.
 *
 * @packageDocumentation
 */

import type {
  ElementConstraint,
  ElementDefinition,
  StructureDefinition,
} from "./structure-definition.js";

/** A resolver from a canonical URL to a loaded {@link StructureDefinition} (for `baseDefinition`). */
export type BaseResolver = (canonicalUrl: string) => StructureDefinition | undefined;

/**
 * Thrown when a snapshot cannot be generated: an unresolvable `baseDefinition`, or a `baseDefinition`
 * cycle. The message is value-free (canonical URLs and structural facts only, never instance data).
 *
 * @example
 * ```ts
 * import { FhirProfileError, generateSnapshot } from "@cosyte/fhir";
 * try {
 *   generateSnapshot(differentialOnlyProfile, () => undefined);
 * } catch (e) {
 *   if (e instanceof FhirProfileError) console.error(e.message);
 * }
 * ```
 */
export class FhirProfileError extends Error {
  /**
   * @param message - A value-free description of why snapshot generation failed.
   */
  public constructor(message: string) {
    super(message);
    this.name = "FhirProfileError";
  }
}

/** Overlay a differential element's stated constraints onto a base element (id/path preserved). */
function mergeElement(base: ElementDefinition, diff: ElementDefinition): ElementDefinition {
  const merged: { -readonly [K in keyof ElementDefinition]: ElementDefinition[K] } = { ...base };
  if (diff.min !== undefined) merged.min = diff.min;
  if (diff.max !== undefined) merged.max = diff.max;
  if (diff.mustSupport !== undefined) merged.mustSupport = diff.mustSupport;
  if (diff.slicing !== undefined) merged.slicing = diff.slicing;
  if (diff.type !== undefined) merged.type = diff.type;
  if (diff.fixed !== undefined) merged.fixed = diff.fixed;
  if (diff.pattern !== undefined) merged.pattern = diff.pattern;
  if (diff.binding !== undefined) merged.binding = diff.binding;
  if (diff.sliceName !== undefined) merged.sliceName = diff.sliceName;
  // Invariants are *additive* down the derivation chain (profiling.html): a profile adds constraints
  // to those it inherits. Accumulate by key, letting a same-key differential constraint win.
  if (diff.constraint !== undefined) {
    const byKey = new Map<string, ElementConstraint>();
    for (const c of base.constraint ?? []) byKey.set(c.key, c);
    for (const c of diff.constraint) byKey.set(c.key, c);
    merged.constraint = [...byKey.values()];
  }
  return merged;
}

/** Where to insert a new (unmatched) differential element so it sits with its path group / parent. */
function insertionIndexFor(result: readonly ElementDefinition[], diff: ElementDefinition): number {
  const after = (predicate: (e: ElementDefinition) => boolean): number => {
    let anchor = -1;
    result.forEach((e, i) => {
      if (predicate(e)) anchor = i;
    });
    return anchor;
  };
  // After the last element that shares the new element's path (its base element + any prior slices).
  let anchor = after((e) => e.path === diff.path || e.path.startsWith(`${diff.path}.`));
  if (anchor >= 0) return anchor + 1;
  // Otherwise after the parent element group.
  const dot = diff.path.lastIndexOf(".");
  if (dot > 0) {
    const parent = diff.path.slice(0, dot);
    anchor = after((e) => e.path === parent || e.path.startsWith(`${parent}.`));
    if (anchor >= 0) return anchor + 1;
  }
  return result.length;
}

/** The base snapshot for a profile: its own snapshot, or recursively generated from its base. */
function baseSnapshot(
  profile: StructureDefinition,
  resolve: BaseResolver,
  seen: ReadonlySet<string>,
): readonly ElementDefinition[] {
  if (profile.snapshot !== undefined) return profile.snapshot;
  if (profile.baseDefinition === undefined) {
    // A specialization root with only a differential (no base): its differential is the whole surface.
    return profile.differential ?? [];
  }
  const base = resolve(profile.baseDefinition);
  if (base === undefined) {
    throw new FhirProfileError(
      `cannot generate snapshot for ${profile.url}: base definition is not resolvable`,
    );
  }
  if (seen.has(base.url)) {
    throw new FhirProfileError(`baseDefinition cycle detected at ${base.url}`);
  }
  return generateSnapshot(base, resolve, new Set([...seen, profile.url]));
}

/**
 * Generate the snapshot element list for a profile: the base resource's snapshot with the profile's
 * differential overlaid. When the profile already carries a snapshot it is returned as-is.
 *
 * @param profile - The profile (or base resource) StructureDefinition.
 * @param resolve - Resolver for `baseDefinition` canonical URLs (a base R4 SD carries its own snapshot).
 * @param seen - Internal cycle guard; omit at the top level.
 * @returns The flattened, constraint-applied element list.
 * @throws FhirProfileError when the base cannot be resolved, or a `baseDefinition` cycle is found.
 * @example
 * ```ts
 * import { generateSnapshot } from "@cosyte/fhir";
 * // base carries a snapshot; profile carries only a differential tightening one element:
 * const snapshot = generateSnapshot(profile, (url) => (url === base.url ? base : undefined));
 * ```
 */
export function generateSnapshot(
  profile: StructureDefinition,
  resolve: BaseResolver,
  seen: ReadonlySet<string> = new Set(),
): ElementDefinition[] {
  if (profile.snapshot !== undefined) return [...profile.snapshot];

  const result: ElementDefinition[] = [...baseSnapshot(profile, resolve, seen)];
  for (const diff of profile.differential ?? []) {
    const idx = result.findIndex((e) => e.id === diff.id);
    if (idx >= 0) {
      result[idx] = mergeElement(result[idx] as ElementDefinition, diff);
    } else {
      result.splice(insertionIndexFor(result, diff), 0, diff);
    }
  }
  return result;
}

/**
 * The snapshot elements to validate against: the profile's own snapshot when present, else generated.
 * A convenience over {@link generateSnapshot} that does not require a resolver when the profile is
 * already snapshotted (the common case for a published IG profile).
 *
 * @param profile - The profile StructureDefinition.
 * @param resolve - A base resolver, needed only when the profile carries no snapshot.
 * @returns The snapshot element list.
 * @throws FhirProfileError when generation is required but no (or an insufficient) resolver is given.
 * @example
 * ```ts
 * import { snapshotElements } from "@cosyte/fhir";
 * const elements = snapshotElements(usCoreProfile); // uses the IG-supplied snapshot
 * ```
 */
export function snapshotElements(
  profile: StructureDefinition,
  resolve: BaseResolver = () => undefined,
): readonly ElementDefinition[] {
  if (profile.snapshot !== undefined) return profile.snapshot;
  return generateSnapshot(profile, resolve);
}
