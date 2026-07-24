/**
 * The profile validation layer (Phase 6), validate a resource against a `StructureDefinition`.
 *
 * This is the sixth validation layer (roadmap §6: structure → cardinality → value-domain → terminology
 * → **profile** → invariant). Given a resource model and a profile, it walks the profile's snapshot
 * (generating one from the differential when needed, {@link ./snapshot.js}) and checks, per element:
 *
 * - **must-support**, an absent must-support element is `MUST_SUPPORT_ABSENT` (**`information`, never
 *   an error**): must-support is a *system obligation*, not an instance-presence requirement (roadmap
 *   §8). This is the single rule the roadmap is most emphatic about.
 * - **`fixed[x]` / `pattern[x]`**, a value that is not exactly the fixed value is
 *   `PROFILE_FIXED_MISMATCH`; one that does not contain the pattern is `PROFILE_PATTERN_MISMATCH`
 *   (both `error`). {@link ./fixed-pattern.js} draws the equality-vs-subset distinction.
 * - **profile-tightened cardinality**, an element the profile makes required (min ≥ 1) that is absent
 *   is `CARDINALITY_MIN`; one exceeding a profile max is `CARDINALITY_MAX`.
 * - **slicing**, each occurrence of a sliced element is matched to a slice ({@link ./slicing.js}); an
 *   unmatched occurrence under `closed` slicing is `PROFILE_SLICE_UNMATCHED`, a required slice with no
 *   occurrence is `CARDINALITY_MIN`, and a slicing whose discriminator cannot be evaluated is
 *   `PROFILE_SLICE_UNCHECKED` (never silently passed).
 *
 * Every finding is **value-free**, a code, a severity, and a FHIRPath location, never a value.
 * **Deferred:** binding enforcement from profile bindings (the terminology layer already covers
 * bindings, Phase 5), the `profile`/`type` discriminators and reslicing (need FHIRPath, Phase 7),
 * and invariant `constraint`s (Phase 7).
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
import { UNBOUNDED } from "../validate/schema.js";
import { ISSUE_SEVERITIES, validationIssue, type ValidationIssue } from "../validate/issues.js";
import { matchesFixed, matchesPattern } from "./fixed-pattern.js";
import { resolvePath } from "./navigate.js";
import { matchSlices, resolveSlices } from "./slicing.js";
import { snapshotElements, type BaseResolver } from "./snapshot.js";
import type { ElementDefinition, StructureDefinition } from "./structure-definition.js";

/** Options for {@link collectProfileIssues}. */
export interface ProfileOptions {
  /** Base resolver for snapshot generation, needed only when the profile carries no snapshot. */
  readonly resolve?: BaseResolver;
}

/** Flatten a resolved path result into individual occurrences (a list becomes its items). */
function occurrencesOf(nodes: readonly FhirNode[]): FhirNode[] {
  return nodes.flatMap((n) => (isList(n) ? n.items : [n]));
}

/**
 * One evaluation context for an element: a present occurrence of the element's **parent** and this
 * element's occurrences *within it*. Cardinality is defined relative to the parent
 * (elementdefinition.html), so a `1..1` child is "one per parent", not "one in the whole resource",
 * evaluating it against a root-flattened count would false-error a conformant repeating backbone.
 */
interface ParentGroup {
  /** The FHIRPath location of the parent occurrence (the element's own path is `${path}.${leaf}`). */
  readonly path: string;
  /** This element's occurrences within that parent. */
  readonly children: FhirNode[];
}

/** The element's leaf segment (the last path step, e.g. `code` or `value[x]`). */
function leafOf(elementPath: string): string {
  const dot = elementPath.lastIndexOf(".");
  return dot === -1 ? elementPath : elementPath.slice(dot + 1);
}

/**
 * Group an element's instance occurrences by the parent occurrence they belong to. A top-level
 * element (parent = the resource) yields a single group; a nested element yields one group per
 * present parent occurrence, and **no groups at all when the parent is absent**, an absent optional
 * parent means its required children simply do not apply (no false cardinality error).
 */
function parentGroups(resource: FhirComplex, rt: string, elementPath: string): ParentGroup[] {
  const relPath = elementPath.slice(rt.length + 1);
  const dot = relPath.lastIndexOf(".");
  if (dot === -1) {
    return [{ path: rt, children: occurrencesOf(resolvePath(resource, relPath)) }];
  }
  const parentRel = relPath.slice(0, dot);
  const leaf = relPath.slice(dot + 1);
  const parents = occurrencesOf(resolvePath(resource, parentRel));
  return parents.map((parent, j) => ({
    path: parents.length > 1 ? `${rt}.${parentRel}[${String(j)}]` : `${rt}.${parentRel}`,
    children: occurrencesOf(resolvePath(parent, leaf)),
  }));
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
 * const issues = collectProfileIssues(parseResource(allergyJson).resource, profile);
 * ```
 */
export function collectProfileIssues(
  resource: FhirComplex,
  profile: StructureDefinition,
  options: ProfileOptions = {},
): ValidationIssue[] {
  const rt = resourceType(resource);
  if (rt === undefined || rt !== profile.type) return [];

  const snapshot = snapshotElements(profile, options.resolve ?? (() => undefined));
  const issues: ValidationIssue[] = [];

  for (const el of snapshot) {
    if (el.path === profile.type) continue; // the root element, nothing to check on the resource itself.
    if (el.sliceName !== undefined) continue; // slice elements are handled via their sliced parent below.

    const groups = parentGroups(resource, rt, el.path);
    if (groups.length === 0) continue; // parent absent → the element's constraints do not apply.
    const leaf = leafOf(el.path);
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
        collectSlicingIssues(group.children, here, snapshot, el, issues);
      }
    }
  }
  return issues;
}

/** Emit the slice findings for one sliced element's occurrences within a single parent context. */
function collectSlicingIssues(
  occ: readonly FhirNode[],
  slicedPath: string,
  snapshot: readonly ElementDefinition[],
  slicedElement: ElementDefinition,
  issues: ValidationIssue[],
): void {
  const slices = resolveSlices(snapshot, slicedElement);
  const discriminators = slicedElement.slicing?.discriminator ?? [];
  const result = matchSlices(occ, slices, discriminators);

  if (result.unchecked) {
    issues.push(
      validationIssue("PROFILE_SLICE_UNCHECKED", ISSUE_SEVERITIES.INFORMATION, slicedPath),
    );
    return;
  }

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
      (e) => e.sliceName === slice.sliceName && e.path === slicedElement.path,
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
 * supplied at a **different** version is flagged (`warning`), the roadmap requires flagging an
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
  const rt = resourceType(resource) ?? "";
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
          `${rt}.meta.profile[${String(i)}]`,
        ),
      );
    }
  });
  return issues;
}
