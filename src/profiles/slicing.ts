/**
 * Slicing, assigning instance occurrences of a repeating element to the profile's named slices
 * (elementdefinition.html §slicing).
 *
 * A profile can **slice** a repeating element: split it into named sub-groups, each with its own
 * constraints, told apart by one or more **discriminators**. R4 defines the discriminator types
 * `value | exists | pattern | type | profile` (`valueset-discriminator-type`); **`position` is
 * R5-only** and is treated here as unsupported, never silently accepted.
 *
 * **What this module evaluates, and what it defers.** The bounded path navigator
 * ({@link ./navigate.js}) decides **`value`** and **`pattern`** (the instance's value at the
 * discriminator path must match the slice's `fixed[x]` / `pattern[x]` there) and **`exists`** (the
 * element's presence must match the slice's cardinality there; where the slice's own descendant AT
 * that path is required and prohibited at once, no presence matches it, so it assigns no occurrence
 * rather than resolving toward one of the two).
 *
 * **`type`** is decided from the occurrence's concrete type where the document states it: the
 * suffix of a choice element (`valueQuantity` is a `Quantity`) or a resource's `resourceType`, read
 * at the discriminator path, through `resolve()` when the path ends in it. The slice must name the
 * type at that path (`type.code`, or `type.targetProfile` after `resolve()`).
 *
 * A discriminator path selects one element (profiling.html): a `type` path that selects more than
 * one node in an occurrence decides nothing, rather than matching when any one of them does.
 *
 * **`profile`** is not decided yet: a slicing with a `profile` discriminator among its
 * discriminators is reported unchecked with the `profile-discriminator` reason, whatever else it
 * discriminates on.
 *
 * Anything else is **not guessed**: an R5 `position`, an empty discriminator set, a path outside the
 * subset, a slice that declares nothing at a discriminator path, a type the document does not state,
 * a reference that resolves to nothing, or a target profile that was not supplied. The whole slicing
 * is then reported *unchecked* (`PROFILE_SLICE_UNCHECKED`) with its {@link SliceUncheckedReason}, so
 * membership is never silently assumed to pass or fail (fail-safe).
 *
 * **A re-slice is read, not reported unchecked.** A slice's `fixed[x]` / `pattern[x]` constraints
 * are collected from every element under its id, a re-slice of a descendant and that re-slice's own
 * children included, so a `value` or `pattern` discriminator can be decided by a re-slice's value.
 * That is how the R4 blood-pressure profile tells its components apart: the component slicing
 * discriminates on `code.coding.code`, and only the required `SBPCode` re-slice fixes it. Only the
 * unsatisfiable-`exists` record below is scoped to the slice's own descendants. A slice is matched to
 * its sliced element by id (`Observation.component:SystolicBP.code.coding:SBPCode` is a slice of
 * `Observation.component:SystolicBP.code.coding` alone), so a re-slice under one slice is never read
 * as a slice of a different slice's copy of the same path. The profile layer then checks a re-slice
 * within its parent slice's members.
 *
 * @packageDocumentation
 */

import {
  getProperty,
  isComplex,
  isList,
  resourceType,
  type FhirComplex,
  type FhirNode,
} from "../model/index.js";
import { primitiveString } from "../safety/codes.js";
import { SLICE_UNCHECKED_REASONS, type SliceUncheckedReason } from "../validate/issues.js";
import { UNBOUNDED } from "../validate/schema.js";
import { matchesFixed, matchesPattern } from "./fixed-pattern.js";
import { pathExists, resolvePath } from "./navigate.js";
import type { ElementDefinition, ElementType } from "./structure-definition.js";

// Stryker disable all: module-level constants, evaluated once when the module loads, which the
// mutation runner does not reload per mutant; test/slicing-type-profile.test.ts pins each one by
// behaviour (every discriminator kind, each pattern's anchors and classes).
/** The discriminator kinds this module can evaluate (`profile` is an R4 kind it does not, yet). */
const SUPPORTED_DISCRIMINATORS: ReadonlySet<string> = new Set([
  "value",
  "pattern",
  "exists",
  "type",
]);

/** The canonical prefix of a base R4 definition: its tail is the type it defines. */
const CORE_DEFINITION = "http://hl7.org/fhir/StructureDefinition/";

/** A discriminator path step this module walks: a name, optionally a `[x]` choice. */
const PATH_STEP = /^[A-Za-z][A-Za-z0-9_]*(\[x\])?$/u;

/** A FHIR type name a slice may name in `type.code`: a resource, a datatype or a primitive. */
const TYPE_NAME = /^[A-Za-z][A-Za-z0-9]*$/u;

/** A resource or complex type name, as the tail of a base definition's canonical spells it. */
const CORE_TYPE_NAME = /^[A-Z][A-Za-z0-9]*$/u;

/** A choice suffix starts with an upper-case letter (`valueQuantity`, `effectiveDateTime`). */
const CHOICE_SUFFIX = /^[A-Z]/u;
// Stryker restore all

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
   * assigns no occurrence to the slice. Kept apart from {@link existsExpectations} rather than
   * resolved into a boolean there: neither boolean is true of a contradiction, and picking one
   * admits occurrences the profile forbids.
   */
  readonly unsatisfiableExists: ReadonlySet<string>;
  /**
   * The types the slice allows, by path relative to the sliced element (`"$this"` for the slice
   * element itself), from the slice element and its own descendants. Read by the `type`
   * discriminator. Absent on a definition built by hand, which then decides none.
   */
  readonly types?: ReadonlyMap<string, readonly ElementType[]>;
}

/**
 * What deciding a `type` discriminator needs beyond the occurrence itself, supplied by the profile
 * layer. Every member is optional; a discriminator that needs a missing one is reported unchecked
 * with its reason rather than guessed.
 */
export interface SliceEnvironment {
  /**
   * Resolve a `Reference.reference` string to the resource it names in the closure (the resource's
   * `contained` set and, for a Bundle, its entries), or `undefined` when it names none there.
   */
  readonly resolve?: (reference: string) => FhirComplex | undefined;
  /**
   * The resource type a profile canonical constrains, when the profile is known: how a `type`
   * discriminator through `resolve()` reads a slice's `targetProfile`.
   */
  readonly profileType?: (canonical: string) => string | undefined;
}

/**
 * {@link SliceEnvironment} plus what the caller knows about the occurrences themselves: the concrete
 * type of each, by position, where the sliced element is a choice (`valueQuantity` → `"Quantity"`).
 */
export interface SliceContext extends SliceEnvironment {
  /** Per occurrence, in order, its choice suffix, or `undefined` when it is not a choice variant. */
  readonly occurrenceTypes?: readonly (string | undefined)[];
}

/**
 * Whether `el` is a slice of the sliced element `sliced`: it shares the path, and its id is the
 * sliced element's id with its slice name appended. An element whose id was not given (it defaults
 * to the path) is matched on the path alone, the only thing such a profile says.
 *
 * @internal
 */
export function isSliceOf(el: ElementDefinition, sliced: ElementDefinition): boolean {
  if (el.sliceName === undefined || el.path !== sliced.path) return false;
  if (el.id === el.path) return true;
  return el.id === `${sliced.id}:${el.sliceName}`;
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
  /** Why membership could not be evaluated, when {@link unchecked} is `true`. */
  readonly reason?: SliceUncheckedReason;
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
    if (el.sliceName === undefined || !isSliceOf(el, slicedElement)) continue;
    const constraints: SliceConstraint[] = [];
    const existsExpectations = new Map<string, boolean>();
    const unsatisfiableExists = new Set<string>();
    const types = new Map<string, readonly ElementType[]>();
    types.set("$this", el.type ?? []);
    if (el.fixed !== undefined)
      constraints.push({ path: "$this", kind: "fixed", value: el.fixed.value });
    if (el.pattern !== undefined)
      constraints.push({ path: "$this", kind: "pattern", value: el.pattern.value });

    const sliceIdPrefix = `${el.id}.`;
    for (const desc of snapshot) {
      if (!desc.id.startsWith(sliceIdPrefix)) continue;
      const rel = desc.path.startsWith(prefix) ? desc.path.slice(prefix.length) : desc.path;
      // A type is read from the slice's own descendants only: a re-slice's type narrows its own
      // members, not the outer slice's, so it does not decide the outer slice's membership.
      if (!desc.id.slice(sliceIdPrefix.length).includes(":")) types.set(rel, desc.type ?? []);
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
      // blamed the instance for a statement belonging to a different slice. A re-slice decides
      // membership within its own sliced element, under the outer slice's members, so a
      // contradiction carried only by a re-slice is left out of the outer slice's membership.
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
      types,
    };
    if (el.min !== undefined) def.min = el.min;
    if (el.max !== undefined) def.max = el.max;
    slices.push(def);
  }
  return slices;
}

/** One discriminator's answer for one occurrence and one slice: held, not held, or why undecidable. */
type Verdict = boolean | { readonly reason: SliceUncheckedReason };

/** An undecidable verdict, with its reason. */
function undecided(reason: SliceUncheckedReason): Verdict {
  return { reason };
}

/** Whether an instance occurrence satisfies one discriminator for one slice, or cannot be evaluated. */
function discriminatorHolds(
  instance: FhirNode,
  selfType: string | undefined,
  discriminator: Discriminator,
  slice: SliceDefinition,
  context: SliceContext,
): Verdict {
  const { type, path } = discriminator;
  if (type === "type") return typeHolds(instance, selfType, path, slice, context);
  if (type === "exists") {
    // A contradiction is answered `no`, never `unevaluable`. `unevaluable` reports the whole slicing
    // `unchecked`, which returns before the unmatched-occurrence and slice-cardinality arms and so
    // would retire every finding this case exists to draw. It is not a guess either: no instance has
    // a path both present and absent. `no` is not purely additive against the previous behaviour
    // though: an occurrence no longer admitted stops counting toward the slice, and stops shadowing
    // later slices in the match loop, so a finding that existed only because of the wrongful
    // admission goes. That is pinned rather than claimed away, in
    // `test/profile-slice-contradiction.test.ts`, "the bound on what the change can retire".
    if (slice.unsatisfiableExists.has(path)) return false;
    const expected = slice.existsExpectations.get(path);
    if (expected === undefined) return undecided(SLICE_UNCHECKED_REASONS.SLICE_UNCONSTRAINED);
    return pathExists(instance, path) === expected;
  }
  // value | pattern: the slice must pin a value at the discriminator path.
  const constraint = slice.constraints.find((c) => c.path === path);
  if (constraint === undefined) return undecided(SLICE_UNCHECKED_REASONS.SLICE_UNCONSTRAINED);
  const targets = resolvePath(instance, path);
  const matcher = constraint.kind === "fixed" ? matchesFixed : matchesPattern;
  return targets.some((t) => matcher(t, constraint.value));
}

/** A node a discriminator path selected, with its concrete type where the document states it. */
interface Typed {
  readonly node: FhirNode;
  readonly type: string | undefined;
}

/** A discriminator path split at a trailing `resolve()`: the element path and whether it resolves. */
interface SplitPath {
  /** The element path the slice declares its types at (`"$this"` for the sliced element itself). */
  readonly element: string;
  /** Whether the path ends in `resolve()`, so the slice's `targetProfile` applies. */
  readonly resolves: boolean;
}

/** Split a discriminator path at a trailing `resolve()`, or `undefined` when its steps are outside the subset. */
function splitPath(path: string): SplitPath | undefined {
  const steps = path === "" ? [] : path.split(".");
  const resolves = steps[steps.length - 1] === "resolve()";
  const named = resolves ? steps.slice(0, -1) : steps;
  const rest = named[0] === "$this" ? named.slice(1) : named;
  if (!rest.every((step) => PATH_STEP.test(step))) return undefined;
  return { element: rest.length === 0 ? "$this" : rest.join("."), resolves };
}

/** Flatten a list node into its members. */
function members(node: FhirNode): readonly FhirNode[] {
  return isList(node) ? node.items : [node];
}

/** The type a node states about itself: a resource's `resourceType`, when it is one. */
function ownType(node: FhirNode): string | undefined {
  return isComplex(node) ? resourceType(node) : undefined;
}

/** One step of {@link walkTyped}: the named element, or a `[x]` choice's variants, of each node. */
function stepTyped(current: readonly Typed[], step: string): Typed[] {
  const next: Typed[] = [];
  for (const { node } of current) {
    for (const item of members(node)) {
      if (!isComplex(item)) continue;
      if (step.endsWith("[x]")) {
        const base = step.slice(0, -3);
        for (const property of item.properties) {
          const suffix = property.name.slice(base.length);
          if (!property.name.startsWith(base) || !CHOICE_SUFFIX.test(suffix)) continue;
          for (const value of members(property.value)) next.push({ node: value, type: suffix });
        }
        continue;
      }
      const found = getProperty(item, step);
      if (found === undefined) continue;
      for (const value of members(found)) next.push({ node: value, type: ownType(value) });
    }
  }
  return next;
}

/**
 * Walk an element path from an occurrence, keeping each selected node's concrete type: a `[x]`
 * step's choice suffix, else a resource's `resourceType`. Then follow a trailing `resolve()`.
 */
function walkTyped(
  instance: FhirNode,
  selfType: string | undefined,
  split: SplitPath,
  context: SliceContext,
): readonly Typed[] | SliceUncheckedReason {
  let current: Typed[] = [{ node: instance, type: selfType ?? ownType(instance) }];
  if (split.element !== "$this") {
    for (const step of split.element.split(".")) current = stepTyped(current, step);
  }
  if (!split.resolves) return current;
  const resolved: Typed[] = [];
  for (const { node } of current) {
    for (const item of members(node)) {
      const reference = isComplex(item)
        ? primitiveString(getProperty(item, "reference"))
        : undefined;
      const target = reference === undefined ? undefined : context.resolve?.(reference);
      if (target === undefined) return SLICE_UNCHECKED_REASONS.TARGET_UNRESOLVED;
      resolved.push({ node: target, type: resourceType(target) });
    }
  }
  return resolved;
}

/** Spell a type code as a choice suffix spells it: `dateTime` is `DateTime` there. */
function asSuffix(code: string): string {
  return code.charAt(0).toUpperCase() + code.slice(1);
}

/** The resource type a profile canonical names: a base definition's tail, else the supplied profile's. */
function typeOfProfile(canonical: string, context: SliceContext): string | undefined {
  const bar = canonical.indexOf("|");
  const url = bar === -1 ? canonical : canonical.slice(0, bar);
  if (url.startsWith(CORE_DEFINITION)) {
    // A core profile's tail is lower-case (`vitalsigns`) and names no type; a type's is capitalized.
    const tail = url.slice(CORE_DEFINITION.length);
    if (CORE_TYPE_NAME.test(tail)) return tail;
  }
  return context.profileType?.(canonical);
}

/**
 * The type names a slice says an occurrence must be of at a `type` discriminator path: its
 * `type.code`s, or after `resolve()` the types its `targetProfile`s constrain, or why it cannot say.
 */
function sliceDemands(
  split: SplitPath,
  slice: SliceDefinition,
  context: SliceContext,
): readonly string[] | SliceUncheckedReason {
  const declared = slice.types?.get(split.element) ?? [];
  if (!split.resolves) return declared.map((t) => t.code);
  const canonicals = declared.flatMap((t) => t.targetProfile ?? []);
  const names: string[] = [];
  for (const canonical of canonicals) {
    const name = typeOfProfile(canonical, context);
    if (name === undefined) return SLICE_UNCHECKED_REASONS.PROFILE_UNAVAILABLE;
    names.push(name);
  }
  return names;
}

/**
 * Whether a slice names a type that many concrete types satisfy. A `type` discriminator compares
 * names, so a slice naming one of these cannot be decided by a name and is reported unchecked
 * instead. A function rather than a set built at import, which every caller's import would pay for.
 */
function isAbstractType(name: string): boolean {
  return (
    name === "Resource" ||
    name === "DomainResource" ||
    name === "MetadataResource" ||
    name === "CanonicalResource" ||
    name === "Element" ||
    name === "BackboneElement"
  );
}

/** A `type` discriminator's verdict for one occurrence and one slice. */
function typeHolds(
  instance: FhirNode,
  selfType: string | undefined,
  path: string,
  slice: SliceDefinition,
  context: SliceContext,
): Verdict {
  const split = splitPath(path);
  if (split === undefined) return undecided(SLICE_UNCHECKED_REASONS.PATH_UNSUPPORTED);
  const names = sliceDemands(split, slice, context);
  if (typeof names === "string") return undecided(names);
  if (names.length === 0) return undecided(SLICE_UNCHECKED_REASONS.SLICE_UNCONSTRAINED);
  if (names.some((n) => isAbstractType(n) || !TYPE_NAME.test(n)))
    return undecided(SLICE_UNCHECKED_REASONS.TYPE_UNDETERMINED);

  // An occurrence with nothing at the path is of no type there.
  const targets = walkTyped(instance, selfType, split, context);
  if (typeof targets === "string") return undecided(targets);
  // A discriminator path selects one element (profiling.html); the reference validator's type test
  // on a collection of more than one does not hold. A path that selects several nodes in one
  // occurrence decides nothing, rather than matching when any one of them does.
  if (targets.length > 1) return undecided(SLICE_UNCHECKED_REASONS.PATH_UNSUPPORTED);
  const target = targets[0];
  if (target === undefined) return false;
  if (target.type === undefined) return undecided(SLICE_UNCHECKED_REASONS.TYPE_UNDETERMINED);
  return names.some((name) => asSuffix(name) === target.type);
}

/**
 * Assign each instance occurrence of a sliced element to a slice (or none), per the discriminators.
 *
 * Returns `unchecked: true`, with the {@link SliceMatchResult.reason} and no assignments the caller
 * should act on, when membership cannot be evaluated: an empty discriminator set, a discriminator of
 * an unsupported kind (R5 `position`, …), a `profile` discriminator (not decided yet), a slice that
 * declares nothing at a discriminator path, or a `type` discriminator whose answer needs what
 * `context` does not supply. The library does **not** guess a slice assignment it cannot justify.
 *
 * @param instances - The instance occurrences of the sliced element, in order.
 * @param slices - The resolved slice definitions.
 * @param discriminators - The slicing's discriminators.
 * @param context - What a `type` discriminator needs: each occurrence's choice suffix, reference
 *   resolution, and the type a target profile constrains. Optional; without it a type is decided
 *   only from what the occurrences state themselves (a resource's `resourceType`).
 * @returns The per-occurrence assignments, the `unchecked` flag and, when unchecked, its reason.
 * @example
 * ```ts
 * import { matchSlices } from "@cosyte/fhir";
 * const result = matchSlices(categoryOccurrences, slices, [{ type: "pattern", path: "$this" }]);
 * result.assignments; // e.g. ["VSCat", undefined]
 * const values = matchSlices([quantityNode], valueSlices, [{ type: "type", path: "$this" }], {
 *   occurrenceTypes: ["Quantity"],
 * });
 * values.assignments; // e.g. ["valueQuantity"]
 * ```
 */
export function matchSlices(
  instances: readonly FhirNode[],
  slices: readonly SliceDefinition[],
  discriminators: readonly Discriminator[],
  context: SliceContext = {},
): SliceMatchResult {
  const unchecked = (reason: SliceUncheckedReason): SliceMatchResult => ({
    assignments: instances.map(() => undefined),
    unchecked: true,
    reason,
  });

  if (discriminators.length === 0) return unchecked(SLICE_UNCHECKED_REASONS.NO_DISCRIMINATOR);
  if (discriminators.some((d) => d.type !== "profile" && !SUPPORTED_DISCRIMINATORS.has(d.type)))
    return unchecked(SLICE_UNCHECKED_REASONS.DISCRIMINATOR_UNSUPPORTED);
  // A profile discriminator is not decided yet, so neither is any slicing that uses one.
  if (discriminators.some((d) => d.type === "profile"))
    return unchecked(SLICE_UNCHECKED_REASONS.PROFILE_DISCRIMINATOR);

  const assignments: (string | undefined)[] = [];
  for (const [i, instance] of instances.entries()) {
    const selfType = context.occurrenceTypes?.[i];
    let matched: string | undefined;
    for (const slice of slices) {
      const verdicts = discriminators.map((d) =>
        discriminatorHolds(instance, selfType, d, slice, context),
      );
      const blocked = verdicts.find(
        (v): v is { reason: SliceUncheckedReason } => typeof v === "object",
      );
      if (blocked !== undefined) return unchecked(blocked.reason);
      if (verdicts.every((v) => v === true)) {
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
