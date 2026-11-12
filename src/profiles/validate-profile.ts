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
 * {@link ProfileOptions.resolve}, with this same layer. An error there means it does not conform; a
 * clean check with nothing unchecked inside means it does; anything else leaves the slicing
 * unchecked.
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
import { UNBOUNDED } from "../validate/schema.js";
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
import type { ElementDefinition, StructureDefinition } from "./structure-definition.js";

/** Options for {@link collectProfileIssues}. */
export interface ProfileOptions {
  /**
   * Base resolver for snapshot generation, needed only when the profile carries no snapshot. A
   * `profile` slicing discriminator also asks it for a profile the supplied set does not carry.
   */
  readonly resolve?: BaseResolver;
  /**
   * The supplied profile set. A `profile` slicing discriminator checks a resource against the
   * profile a slice names, looked up here by canonical (and version, when the canonical pins one);
   * a profile neither here nor returned by {@link resolve} leaves the slicing unchecked.
   */
  readonly profiles?: readonly StructureDefinition[];
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
  const supplied = (options.profiles ?? []).filter(fits);
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
    let issues: ValidationIssue[];
    try {
      issues = profileIssues(
        target,
        profile,
        options,
        environmentIn(inner, options, depth + 1, state),
      );
    } catch (error) {
      /* v8 ignore next -- any other throw is a defect, and propagates exactly as it did unnested */
      if (!(error instanceof FhirProfileError)) throw error;
      // A profile whose snapshot cannot be generated was not available to check against.
      return SLICE_UNCHECKED_REASONS.PROFILE_UNAVAILABLE;
    }
    if (issues.some((i) => i.severity === ISSUE_SEVERITIES.ERROR)) return "no";
    const incomplete = issues.some(
      (i) => i.code === "PROFILE_SLICE_UNCHECKED" || i.code === "PROFILE_SLICE_NO_SLICING",
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
      const answer = resolveReference(reference, closure);
      return answer.status === "resolved" ? answer.target : undefined;
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
  return profileIssues(resource, profile, options, sliceEnvironment(resource, options));
}

/** {@link collectProfileIssues} in a given slice environment (a nested profile check reuses its closure). */
function profileIssues(
  resource: FhirComplex,
  profile: StructureDefinition,
  options: ProfileOptions,
  environment: SliceEnvironment,
): ValidationIssue[] {
  const rt = resourceType(resource);
  if (rt === undefined || rt !== profile.type) return [];
  // The profile only applies when the two agree, so the location is bounded once, here.
  const root = rootPath(rt);

  const snapshot = snapshotElements(profile, options.resolve ?? (() => undefined));
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
