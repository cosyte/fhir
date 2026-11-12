/**
 * The profile validation layer, validate a resource against a `StructureDefinition`.
 *
 * This is the sixth validation layer (structure → cardinality → value-domain → terminology
 * → **profile** → invariant). Given a resource model and a profile, it walks the profile's snapshot
 * (generating one from the differential when needed, {@link ./snapshot.js}) and checks, per element:
 *
 * - **must-support**, an absent must-support element is `MUST_SUPPORT_ABSENT` (**`information`, never
 *   an error**): must-support is a *system obligation*, not an instance-presence requirement.
 * - **`fixed[x]` / `pattern[x]`**, a value that is not exactly the fixed value is
 *   `PROFILE_FIXED_MISMATCH`; one that does not contain the pattern is `PROFILE_PATTERN_MISMATCH`
 *   (both `error`). {@link ./fixed-pattern.js} draws the equality-vs-subset distinction.
 * - **profile-tightened cardinality**, an element the profile makes required (min ≥ 1) that is absent
 *   is `CARDINALITY_MIN`; one exceeding a profile max is `CARDINALITY_MAX`.
 * - **slicing**, each occurrence of a sliced element is matched to a slice ({@link ./slicing.js}); an
 *   unmatched occurrence under `closed` slicing is `PROFILE_SLICE_UNMATCHED`, a required slice with no
 *   occurrence is `CARDINALITY_MIN`, a slicing whose discriminator cannot be evaluated is
 *   `PROFILE_SLICE_UNCHECKED`, and a slice under an element that declares no slicing is
 *   `PROFILE_SLICE_NO_SLICING` (both `information`, never silently passed).
 *
 * **A slice's constraints apply to its members alone.** An element under a slice
 * (`Observation.component:SystolicBP.code`) constrains only the occurrences the slicing assigned to
 * the slice it names; an element under no slice (`Observation.component.code`) constrains every
 * occurrence ({@link ./scope.js}). A re-slice nests the same way: its cardinality and its elements are checked
 * within its parent slice's members, and its `fixed[x]` / `pattern[x]` values still decide the
 * parent slice's membership (the R4 blood-pressure shape, where
 * `component:SystolicBP.code.coding:SBPCode.code` fixes the code the component slicing
 * discriminates on). A slicing reported `PROFILE_SLICE_UNCHECKED` assigns no occurrence, so its
 * slices' own constraints are not checked either: membership is never assumed. The finding carries
 * its `sliceReason`.
 *
 * **`type` and `profile` discriminators.** A `type` discriminator is decided from the occurrence's
 * concrete type (a choice suffix or a `resourceType`). A `profile` discriminator is decided for a
 * resource held in place (`contained`, a Bundle entry) or reached by `resolve()` through the
 * resource's `contained` set or, for a Bundle, its entries: the resource is checked against the
 * profile the slice names, found in {@link ProfileOptions.profiles} or through
 * {@link ProfileOptions.resolve}, with every layer `validateResource` runs (the profile's own
 * invariants and the base constraints among them). An error there means it does not conform. A
 * clean check means it does only when nothing was left unchecked inside and every constraint the
 * profile places on an element present in the target is of a kind a layer that ran enforces
 * ({@link ENFORCED_CONSTRAINT_KINDS}); anything else leaves the slicing unchecked.
 *
 * Every finding is **value-free**, a code, a severity, and a FHIRPath location, never a value.
 * **Deferred:** binding enforcement from profile bindings (the terminology layer already covers
 * bindings), and invariant `constraint`s (the invariant layer, {@link ./invariants.js}).
 *
 * @packageDocumentation
 */

import {
  getProperty,
  isComplex,
  isList,
  resourceType,
  rootPath,
  type FhirComplex,
  type FhirNode,
} from "../model/index.js";
import {
  buildBundleIndex,
  containedIndex,
  resolveReference,
  type BundleIndex,
  type ContainedIndex,
} from "../bundle/references.js";
import { primitiveString } from "../safety/codes.js";
import { UNBOUNDED, type ResourceSchema } from "../validate/schema.js";
import { builtInSchema, conformanceResult } from "../validate/validate.js";
import {
  ISSUE_SEVERITIES,
  SLICE_UNCHECKED_REASONS,
  validationIssue,
  type SliceUncheckedReason,
  type ValidationIssue,
} from "../validate/issues.js";
import { matchesFixed, matchesPattern } from "./fixed-pattern.js";
import { SliceScope } from "./scope.js";
import { isSliceOf, matchSlices, resolveSlices, type SliceEnvironment } from "./slicing.js";
import { FhirProfileError, snapshotElements, type BaseResolver } from "./snapshot.js";
import type {
  ElementBinding,
  ElementConstraint,
  ElementDefinition,
  ElementType,
  StructureDefinition,
} from "./structure-definition.js";

/** The base resolver when none is supplied: it knows no definition. */
const noBase: BaseResolver = () => undefined;

/** Options for {@link collectProfileIssues}. */
export interface ProfileOptions {
  /**
   * Base resolver for snapshot generation, needed only when the profile carries no snapshot. A
   * `profile` slicing discriminator also asks it for a profile the supplied set does not carry.
   */
  readonly resolve?: BaseResolver | undefined;
  /**
   * The supplied profile set. A `profile` slicing discriminator checks a resource against the
   * profile a slice names, looked up here by canonical (and version, when the canonical pins one);
   * a profile neither here nor returned by {@link resolve} leaves the slicing unchecked.
   */
  readonly profiles?: readonly StructureDefinition[] | undefined;
}

/**
 * How many profiles deep a `profile` discriminator may check a resource against a slice's profile,
 * which may itself slice by profile. Deeper than this, the slicing is reported unchecked: that is
 * also where a reference cycle stops, since a cycle only ever deepens.
 */
const MAX_PROFILE_DEPTH = 8;

/**
 * How many resource-against-profile checks one validation may run for its `profile`
 * discriminators. A decided answer is checked once and reused; past this budget the rest are
 * reported unchecked, so a document with many references cannot make validation run without bound.
 */
const MAX_PROFILE_CHECKS = 4096;

/** The resources a `resolve()` can reach: the `contained` set and, for a Bundle, its entries. */
interface Closure {
  readonly contained: ContainedIndex;
  readonly bundle?: BundleIndex;
}

/** One answer to "does this resource conform to that profile", or why it cannot be given. */
type Conformance = "yes" | "no" | SliceUncheckedReason;

/** What one validation's nested profile checks share: the answers decided, and the budget spent. */
interface CheckState {
  readonly decided: WeakMap<FhirComplex, Map<string, "yes" | "no">>;
  checks: number;
}

/**
 * The {@link SliceEnvironment} for a resource validated against a profile: reference resolution
 * over its closure, and profile conformance through this layer, bounded in depth and in count.
 *
 * @param resource - The resource model being validated.
 * @param options - The supplied profile set and base resolver.
 * @returns The environment the slicing of this resource is decided in.
 * @internal
 */
export function sliceEnvironment(
  resource: FhirComplex,
  options: ProfileOptions = {},
): SliceEnvironment {
  const contained = containedIndex(resource);
  const closure: Closure =
    resourceType(resource) === "Bundle"
      ? { contained, bundle: buildBundleIndex(resource) }
      : { contained };
  return environmentIn(closure, options, 0, { decided: new WeakMap(), checks: 0 });
}

/** The profiles a canonical names: the supplied ones at that url (and version), else the resolver's. */
function profilesNamed(canonical: string, options: ProfileOptions): StructureDefinition[] {
  const bar = canonical.indexOf("|");
  const url = bar === -1 ? canonical : canonical.slice(0, bar);
  const version = bar === -1 ? undefined : canonical.slice(bar + 1);
  const fits = (p: StructureDefinition): boolean =>
    p.url === url && (version === undefined || p.version === version);
  const supplied = options.profiles?.filter(fits) ?? [];
  if (supplied.length > 0) return supplied;
  const resolved = options.resolve?.(url);
  return resolved !== undefined && fits(resolved) ? [resolved] : [];
}

/** The environment at one depth of profile checking. */
function environmentIn(
  closure: Closure,
  options: ProfileOptions,
  depth: number,
  state: CheckState,
): SliceEnvironment {
  const check = (target: FhirComplex, profile: StructureDefinition): Conformance => {
    if (resourceType(target) !== profile.type) return "no";
    // A contained resource contains nothing (dom-2), so its references resolve among its
    // container's; any other target's `#` references resolve among its own `contained`.
    const inner = [...closure.contained.byId.values()].includes(target)
      ? closure
      : { ...closure, contained: containedIndex(target) };
    const environment = environmentIn(inner, options, depth + 1, state);
    let result: { readonly issues: readonly ValidationIssue[]; readonly valid: boolean };
    let leftOut: boolean;
    try {
      // Every layer validateResource runs, the profile's own invariants among them, so a target is
      // judged against the slice's profile exactly as it would be validated against it alone.
      result = conformanceResult(target, profile, options.resolve, environment);
      leftOut = checksLeftOut(target, profile, options, environment);
    } catch (error) {
      // Any other throw (a caller's resolver failing, say) propagates exactly as it does unnested.
      if (!(error instanceof FhirProfileError)) throw error;
      // A profile whose snapshot cannot be generated was not available to check against.
      return SLICE_UNCHECKED_REASONS.PROFILE_UNAVAILABLE;
    }
    if (!result.valid) return "no";
    // Something the profile asks of the target that was not evaluated: a slicing, an invariant, a
    // resource type with no schema, or a constraint of a kind no layer that ran enforces.
    const incomplete =
      leftOut ||
      result.issues.some(
        (i) =>
          i.code === "PROFILE_SLICE_UNCHECKED" ||
          i.code === "PROFILE_SLICE_NO_SLICING" ||
          i.code === "INVARIANT_UNCHECKED" ||
          i.code === "RESOURCE_NOT_MODELED",
      );
    return incomplete ? SLICE_UNCHECKED_REASONS.PROFILE_UNDECIDED : "yes";
  };

  const decide = (target: FhirComplex, canonical: string): Conformance => {
    const profiles = profilesNamed(canonical, options);
    if (profiles.length === 0) return SLICE_UNCHECKED_REASONS.PROFILE_UNAVAILABLE;
    if (depth >= MAX_PROFILE_DEPTH || state.checks >= MAX_PROFILE_CHECKS)
      return SLICE_UNCHECKED_REASONS.PROFILE_UNDECIDED;
    state.checks += 1;
    // Every version supplied under an unpinned canonical must agree, or nothing is asserted.
    return profiles
      .map((p) => check(target, p))
      .reduce((a, b) => (a === b ? a : SLICE_UNCHECKED_REASONS.PROFILE_UNDECIDED));
  };

  return {
    resolve: (reference) => {
      // Only a resolved answer carries a target.
      const answer: { readonly status: string; readonly target?: FhirComplex } = resolveReference(
        reference,
        closure,
      );
      return answer.target;
    },
    profileType: (canonical) => {
      const types = new Set(profilesNamed(canonical, options).map((p) => p.type));
      return types.size === 1 ? [...types][0] : undefined;
    },
    conforms: (target, canonical) => {
      const known = state.decided.get(target)?.get(canonical);
      if (known !== undefined) return known;
      const answer = decide(target, canonical);
      // Only a decision is kept: an undecided answer may come from the depth or the budget alone.
      if (answer === "yes" || answer === "no") {
        const byCanonical = state.decided.get(target) ?? new Map<string, "yes" | "no">();
        byCanonical.set(canonical, answer);
        state.decided.set(target, byCanonical);
      }
      return answer;
    },
  };
}

// Stryker disable all: module-level constants, evaluated once when the module loads, which the
// mutation runner does not reload per mutant; test/slicing-profile-conformance.property.test.ts
// and test/slicing-profile-conformance.test.ts pin each by behaviour.
/**
 * The kinds of constraint a nested profile check may affirm, each with what enforces it when the
 * check runs. A profile discriminator's check says a target conforms only when every constraint the
 * slice's profile places on an element present in the target is of one of these kinds
 * ({@link constraintKinds} names the kinds of one element). Any other kind, a narrowed type the
 * occurrence's own type cannot be read against, a type `profile`, a `targetProfile`, a binding to a
 * value set other than the one the schema enumerates there, an invariant on a slice itself,
 * `maxLength`, `minValue[x]`, `maxValue[x]`, and everything the model does not recognise, leaves
 * the check undecided: the reference validator would check it, and a "yes" without it is a guess.
 *
 * @internal
 */
export const ENFORCED_CONSTRAINT_KINDS: Readonly<Record<string, string>> = {
  min: "the profile layer: cardinality, per parent occurrence",
  max: "the profile layer: cardinality, per parent occurrence",
  mustSupport: "nothing to enforce: an obligation on a system, never on an instance",
  fixed: "the profile layer: fixed[x]",
  pattern: "the profile layer: pattern[x]",
  slicing: "the profile layer; a slicing it cannot decide is reported and leaves this undecided",
  constraint:
    "the invariant layer; an invariant it cannot evaluate is reported and leaves this undecided",
  "binding:schema":
    "the structure layer: the schema's enumerated codes, bound to the very value set they enumerate",
  "binding:advisory": "nothing to enforce: a preferred or example binding asks nothing",
  "type:code": "this check: each present occurrence's own type is one the element allows",
};

/** The canonical of the base `Resource` definition: as a `targetProfile`, it narrows nothing. */
const ANY_RESOURCE = "http://hl7.org/fhir/StructureDefinition/Resource";

/**
 * The version of the R4 base value sets the schema enumerates: a profile's binding to one of them
 * may pin it, and pins nothing else.
 */
const R4_VERSION = "4.0.1";
// Stryker restore all

/**
 * Whether the profile asks something of the target that the layers which ran do not check: an
 * element present in the target carries a constraint whose kind is not on
 * {@link ENFORCED_CONSTRAINT_KINDS}.
 */
function checksLeftOut(
  target: FhirComplex,
  profile: StructureDefinition,
  options: ProfileOptions,
  environment: SliceEnvironment,
): boolean {
  const snapshot = snapshotElements(profile, options.resolve ?? noBase);
  const scope = new SliceScope(target, rootPath(profile.type), snapshot, environment);
  const schema = builtInSchema(profile.type);
  return snapshot.some(
    (el) =>
      scope.occurrences(el).length > 0 &&
      constraintKinds(el, profile.type, snapshot, schema, scope).some(
        (kind) => !Object.hasOwn(ENFORCED_CONSTRAINT_KINDS, kind),
      ),
  );
}

/**
 * The kinds of constraint one element of a profile places on a target the element is present in,
 * as {@link ENFORCED_CONSTRAINT_KINDS} names them; what the model does not read comes back as
 * {@link ElementDefinition.unmodeled} spells it under `unmodeled:`, a kind never on that list.
 *
 * @param el - The element.
 * @param type - The resource type the profile constrains.
 * @param snapshot - The profile's snapshot, which the element is one of.
 * @param schema - The built-in schema of that type, when there is one.
 * @param scope - The target's slice scope against the snapshot.
 * @returns The kinds, one entry per constraint.
 * @internal
 */
export function constraintKinds(
  el: ElementDefinition,
  type: string,
  snapshot: readonly ElementDefinition[],
  schema: ResourceSchema | undefined,
  scope: SliceScope,
): string[] {
  const kinds: string[] = [];
  if (el.min !== undefined) kinds.push("min");
  if (el.max !== undefined) kinds.push("max");
  if (el.mustSupport !== undefined) kinds.push("mustSupport");
  if (el.fixed !== undefined) kinds.push("fixed");
  if (el.pattern !== undefined) kinds.push("pattern");
  if (el.slicing !== undefined) {
    kinds.push("slicing");
    // The profile layer checks a closed slicing's unmatched occurrences, never their order.
    if (el.slicing.ordered === true) kinds.push("slicing:ordered");
    if (el.slicing.rules === "openAtEnd") kinds.push("slicing:openAtEnd");
  }
  for (const constraint of el.constraint ?? [])
    kinds.push(constraintKind(el, constraint, snapshot));
  if (el.binding !== undefined) kinds.push(bindingKind(el, el.binding, type, schema));
  const slicedBy = sliceDiscriminators(el, snapshot);
  const types = el.type ?? [];
  for (const t of types) {
    if ((t.profile ?? []).length > 0)
      kinds.push(decidesProfile(slicedBy, false) ? "slicing" : "type:profile");
    if ((t.targetProfile ?? []).some((c) => c !== ANY_RESOURCE))
      kinds.push(decidesProfile(slicedBy, true) ? "slicing" : "type:targetProfile");
  }
  if (types.length > 0 && el.path !== type) kinds.push(typeKind(el, types, scope));
  // Under a prefix of their own, so nothing the model does not read can spell an allowed kind.
  for (const statement of el.unmodeled ?? []) kinds.push(`unmodeled:${statement}`);
  return kinds;
}

/** The discriminators of the slicing a slice element belongs to; none for any other element. */
function sliceDiscriminators(
  el: ElementDefinition,
  snapshot: readonly ElementDefinition[],
): readonly { readonly type: string; readonly path: string }[] {
  if (el.sliceName === undefined) return [];
  const sliced = snapshot.find((e) => e.sliceName === undefined && isSliceOf(el, e));
  return sliced?.slicing?.discriminator ?? [];
}

/**
 * Whether a slicing's discriminators decide a slice's type `profile` (at the slice itself) or its
 * `targetProfile` (at `resolve()`): a member is then assigned only once it conforms, so the
 * slicing enforces what the slice names there.
 */
function decidesProfile(
  discriminators: readonly { readonly type: string; readonly path: string }[],
  resolves: boolean,
): boolean {
  const at = resolves ? ["resolve()", "$this.resolve()"] : ["$this", ""];
  return discriminators.some((d) => d.type === "profile" && at.includes(d.path));
}

/**
 * An invariant's kind. The invariant layer evaluates an element's invariants on every occurrence in
 * its scope, and skips a slice element's own: one of those is evaluated only when the sliced element
 * carries the same invariant, which then reaches every occurrence.
 */
function constraintKind(
  el: ElementDefinition,
  constraint: ElementConstraint,
  snapshot: readonly ElementDefinition[],
): string {
  if (el.sliceName === undefined) return "constraint";
  const sliced = snapshot.find((e) => e.sliceName === undefined && isSliceOf(el, e));
  const shared = sliced?.constraint?.some(
    (c) => c.key === constraint.key && c.expression === constraint.expression,
  );
  return shared === true ? "constraint" : "constraint:slice";
}

/**
 * A binding's kind. The schema checks a resource's direct `code` element against the codes of one
 * R4 value set; a `required` or `extensible` binding to exactly that value set asks nothing more,
 * and a binding to any other value set, even one whose codes are all among those, asks more.
 */
function bindingKind(
  el: ElementDefinition,
  binding: ElementBinding,
  type: string,
  schema: ResourceSchema | undefined,
): string {
  if (binding.strength === "preferred" || binding.strength === "example") return "binding:advisory";
  // A nested path's tail has a dot, which names no schema element.
  const enumerated = schema?.elements[el.path.slice(type.length + 1)]?.binding?.valueSet;
  const valueSet = binding.valueSet;
  if (valueSet === undefined) return "binding:unenforced";
  const bar = valueSet.indexOf("|");
  const url = bar === -1 ? valueSet : valueSet.slice(0, bar);
  const version = bar === -1 ? R4_VERSION : valueSet.slice(bar + 1);
  const same =
    (binding.strength === "required" || binding.strength === "extensible") &&
    url === enumerated &&
    version === R4_VERSION;
  return same ? "binding:schema" : "binding:unenforced";
}

/**
 * A type list's kind: `type:code` when every present occurrence's own type is one the element
 * allows, read from a choice suffix or a resource's `resourceType`, or, on an element of one type
 * that is not a choice, the type the structure layer read it as. Otherwise the narrowing is not
 * checked here, and the kind says so.
 */
function typeKind(el: ElementDefinition, types: readonly ElementType[], scope: SliceScope): string {
  const codes = types.map((t) => t.code);
  // A choice's occurrences always carry their suffix, so only another element reads `single`.
  const single = codes.length === 1;
  for (const group of scope.parentGroups(el)) {
    for (const [i, child] of group.children.entries()) {
      const suffix = group.types[i];
      const resource = isComplex(child) ? resourceType(child) : undefined;
      const allowed =
        suffix !== undefined
          ? codes.some((c) => c.charAt(0).toUpperCase() + c.slice(1) === suffix)
          : resource !== undefined
            ? codes.some((c) => c === resource || c === "Resource" || c === "DomainResource")
            : single;
      if (!allowed) return "type:unchecked";
    }
  }
  return "type:code";
}

/**
 * Collect every profile-conformance finding for a resource validated against one profile.
 *
 * @param resource - The resource model.
 * @param profile - The profile (`StructureDefinition`) to validate against.
 * @param options - Optional base resolver for snapshot generation.
 * @returns The value-free profile {@link ValidationIssue}s. Empty when the profile does not apply to
 *   this resource type or the resource conforms.
 * @example
 * ```ts
 * import { collectProfileIssues, loadStructureDefinition, parseResource } from "@cosyte/fhir";
 * const profile = loadStructureDefinition(parseResource(usCoreAllergyJson).resource);
 * if (profile !== undefined) {
 *   const issues = collectProfileIssues(parseResource(allergyJson).resource, profile);
 * }
 * ```
 */
export function collectProfileIssues(
  resource: FhirComplex,
  profile: StructureDefinition,
  options: ProfileOptions = {},
): ValidationIssue[] {
  return profileIssuesIn(resource, profile, options, sliceEnvironment(resource, options));
}

/**
 * {@link collectProfileIssues} in a given slice environment (a nested profile check reuses its
 * closure).
 *
 * @param resource - The resource model.
 * @param profile - The profile to validate against.
 * @param options - The supplied profile set and base resolver.
 * @param environment - The slice environment the profile's slicings are decided in.
 * @returns The value-free profile findings.
 * @internal
 */
export function profileIssuesIn(
  resource: FhirComplex,
  profile: StructureDefinition,
  options: ProfileOptions,
  environment: SliceEnvironment,
): ValidationIssue[] {
  const rt = resourceType(resource);
  if (rt === undefined || rt !== profile.type) return [];
  // The profile only applies when the two agree, so the location is bounded once, here.
  const root = rootPath(rt);

  const snapshot = snapshotElements(profile, options.resolve ?? noBase);
  const scope = new SliceScope(resource, root, snapshot, environment);
  const issues: ValidationIssue[] = [];

  for (const el of snapshot) {
    if (el.path === profile.type) continue; // the root element, nothing to check on the resource itself.
    if (el.sliceName !== undefined) {
      // A slice is handled via its sliced parent below, when that parent declares the slicing that
      // assigns the slice its members. Without one no occurrence is assigned, so nothing under the
      // slice is checked, and that is reported rather than passed in silence.
      if (!slicingDeclaredFor(snapshot, el)) collectNoSlicingIssues(scope, el, issues);
      continue;
    }

    // An element under a slice constrains the members of the slice its id names, and no others, so
    // its groups are the in-scope parents only; an element under no slice constrains every occurrence.
    const groups = scope.parentGroups(el);
    if (groups.length === 0) continue; // parent absent → the element's constraints do not apply.
    const leaf = el.path.slice(el.path.lastIndexOf(".") + 1);
    const totalChildren = groups.reduce((n, g) => n + g.children.length, 0);

    // must-support: informational, never an error (roadmap §8, the load-bearing rule). Evaluated at
    // the element level (absent across every present parent) so an optional repeat does not multiply it.
    if (el.mustSupport === true && totalChildren === 0) {
      issues.push(validationIssue("MUST_SUPPORT_ABSENT", ISSUE_SEVERITIES.INFORMATION, el.path));
    }

    for (const group of groups) {
      const here = `${group.path}.${leaf}`;
      const count = group.children.length;

      // profile-tightened cardinality, evaluated per parent occurrence.
      if (el.min !== undefined && el.min >= 1 && count < el.min) {
        issues.push(validationIssue("CARDINALITY_MIN", ISSUE_SEVERITIES.ERROR, here));
      }
      if (el.max !== undefined && el.max !== UNBOUNDED && count > el.max) {
        issues.push(validationIssue("CARDINALITY_MAX", ISSUE_SEVERITIES.ERROR, here));
      }

      // fixed[x] / pattern[x] on each present occurrence within this parent.
      const fixed = el.fixed;
      const pattern = el.pattern;
      group.children.forEach((node, i) => {
        const loc = count > 1 ? `${here}[${String(i)}]` : here;
        if (fixed !== undefined && !matchesFixed(node, fixed.value)) {
          issues.push(validationIssue("PROFILE_FIXED_MISMATCH", ISSUE_SEVERITIES.ERROR, loc));
        }
        if (pattern !== undefined && !matchesPattern(node, pattern.value)) {
          issues.push(validationIssue("PROFILE_PATTERN_MISMATCH", ISSUE_SEVERITIES.ERROR, loc));
        }
      });

      // slicing, evaluated within this parent occurrence.
      if (el.slicing !== undefined) {
        collectSlicingIssues(group.children, group.types, here, snapshot, el, environment, issues);
      }
    }
  }
  return issues;
}

/**
 * Whether the element a slice belongs to declares `slicing`. The sliced element is the first one the
 * slice is a slice of ({@link isSliceOf}), the same element the slice scope reads by id; a slice whose
 * sliced element is missing from the snapshot has none.
 */
function slicingDeclaredFor(
  snapshot: readonly ElementDefinition[],
  slice: ElementDefinition,
): boolean {
  const sliced = snapshot.find(
    (e) => e !== slice && e.sliceName === undefined && isSliceOf(slice, e),
  );
  return sliced?.slicing !== undefined;
}

/**
 * Report a slice whose sliced element declares no slicing as not checked, once per present parent
 * occurrence of the sliced element, at the slice's location (`Observation.component:coded`).
 */
function collectNoSlicingIssues(
  scope: SliceScope,
  slice: ElementDefinition,
  issues: ValidationIssue[],
): void {
  const leaf = slice.path.slice(slice.path.lastIndexOf(".") + 1);
  for (const group of scope.parentGroups(slice)) {
    issues.push(
      validationIssue(
        "PROFILE_SLICE_NO_SLICING",
        ISSUE_SEVERITIES.INFORMATION,
        `${group.path}.${leaf}:${String(slice.sliceName)}`,
      ),
    );
  }
}

/** Emit the slice findings for one sliced element's occurrences within a single parent context. */
function collectSlicingIssues(
  occ: readonly FhirNode[],
  occurrenceTypes: readonly (string | undefined)[],
  slicedPath: string,
  snapshot: readonly ElementDefinition[],
  slicedElement: ElementDefinition,
  environment: SliceEnvironment,
  issues: ValidationIssue[],
): void {
  const slices = resolveSlices(snapshot, slicedElement);
  /* v8 ignore next -- the `?? []` is unreachable: called only for an element that declares slicing */
  const discriminators = slicedElement.slicing?.discriminator ?? [];
  const result = matchSlices(occ, slices, discriminators, { ...environment, occurrenceTypes });

  if (result.unchecked) {
    issues.push(
      validationIssue(
        "PROFILE_SLICE_UNCHECKED",
        ISSUE_SEVERITIES.INFORMATION,
        slicedPath,
        undefined,
        undefined,
        result.reason,
      ),
    );
    return;
  }

  /* v8 ignore next -- the `?? "open"` is unreachable: called only for an element that declares slicing */
  const rules = slicedElement.slicing?.rules ?? "open";
  if (rules === "closed") {
    result.assignments.forEach((sliceName, i) => {
      if (sliceName === undefined) {
        issues.push(
          validationIssue(
            "PROFILE_SLICE_UNMATCHED",
            ISSUE_SEVERITIES.ERROR,
            `${slicedPath}[${String(i)}]`,
          ),
        );
      }
    });
  }

  for (const slice of slices) {
    const count = result.assignments.filter((name) => name === slice.sliceName).length;
    const sliceElement = snapshot.find(
      (e) => e.sliceName === slice.sliceName && isSliceOf(e, slicedElement),
    );
    const slicePath = `${slicedPath}:${slice.sliceName}`;
    if (sliceElement?.mustSupport === true && count === 0) {
      issues.push(validationIssue("MUST_SUPPORT_ABSENT", ISSUE_SEVERITIES.INFORMATION, slicePath));
    }
    if (slice.min !== undefined && slice.min >= 1 && count < slice.min) {
      issues.push(validationIssue("CARDINALITY_MIN", ISSUE_SEVERITIES.ERROR, slicePath));
    }
    if (slice.max !== undefined && slice.max !== UNBOUNDED && count > slice.max) {
      issues.push(validationIssue("CARDINALITY_MAX", ISSUE_SEVERITIES.ERROR, slicePath));
    }
  }
}

/**
 * Collect `PROFILE_VERSION_MISMATCH` findings by comparing the resource's declared `meta.profile`
 * canonicals against the supplied profile set. A declared `canonical|version` whose canonical is
 * supplied at a **different** version is flagged (`warning`): flagging an
 * unknown profile version rather than silently validating against a different one. A canonical that is
 * not supplied at all is *not* flagged here (it simply was not validated), and a declaration with no
 * version pin never mismatches.
 *
 * @param resource - The resource model.
 * @param profiles - The supplied profiles (their `url` + `version` form the known set).
 * @returns The value-free version-mismatch issues.
 * @example
 * ```ts
 * import { collectProfileVersionIssues } from "@cosyte/fhir";
 * // resource.meta.profile = ["http://…/us-core-patient|3.1.1"], supplied profile is version 6.1.0:
 * collectProfileVersionIssues(resource, [usCorePatient610]); // → one PROFILE_VERSION_MISMATCH
 * ```
 */
export function collectProfileVersionIssues(
  resource: FhirComplex,
  profiles: readonly StructureDefinition[],
): ValidationIssue[] {
  const root = rootPath(resourceType(resource) ?? "");
  const meta = getProperty(resource, "meta");
  if (meta === undefined || !isComplex(meta)) return [];
  const profileNode = getProperty(meta, "profile");
  if (profileNode === undefined) return [];
  const declared = isList(profileNode) ? profileNode.items : [profileNode];

  const versionsByUrl = new Map<string, Set<string>>();
  for (const p of profiles) {
    if (p.version === undefined) continue;
    const set = versionsByUrl.get(p.url) ?? new Set<string>();
    set.add(p.version);
    versionsByUrl.set(p.url, set);
  }

  const issues: ValidationIssue[] = [];
  declared.forEach((node, i) => {
    const canonical = primitiveString(node);
    if (canonical === undefined) return;
    const bar = canonical.indexOf("|");
    if (bar === -1) return; // no version pin → never a version mismatch.
    const url = canonical.slice(0, bar);
    const version = canonical.slice(bar + 1);
    const known = versionsByUrl.get(url);
    if (known !== undefined && !known.has(version)) {
      issues.push(
        validationIssue(
          "PROFILE_VERSION_MISMATCH",
          ISSUE_SEVERITIES.WARNING,
          `${root}.meta.profile[${String(i)}]`,
        ),
      );
    }
  });
  return issues;
}
