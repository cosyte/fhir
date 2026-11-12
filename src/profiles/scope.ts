/**
 * Slice scope, which instance occurrences an element of a profile's snapshot constrains.
 *
 * An element's **id** says which slices it sits under (elementdefinition.html §id): the id of
 * `Observation.component:SystolicBP.code` names the `SystolicBP` slice of `Observation.component`, so
 * that element constrains the `code` of the components the slicing assigned to `SystolicBP`, and no
 * other component's. An element whose id names no slice (`Observation.component.code`) constrains
 * every occurrence. A re-slice nests the same way:
 * `Observation.component:SystolicBP.code.coding:SBPCode.code` constrains the codings assigned to
 * `SBPCode` within the components assigned to `SystolicBP`.
 *
 * This module walks the instance down an element's path one step at a time and, at each step whose
 * id segment names a slice, keeps only the occurrences the slicing assigned to the slice named
 * ({@link ./slicing.js}). A slicing whose membership cannot be decided (`unchecked`), or a slice whose
 * sliced element is missing from the snapshot or declares no slicing, assigns no occurrence, so
 * its elements constrain nothing: membership is never assumed. The profile layer reports an
 * undecided slicing as `PROFILE_SLICE_UNCHECKED`, and a slice with no slicing declared over it, which
 * states no membership to decide, as `PROFILE_SLICE_NO_SLICING`: neither is passed in silence. An
 * element whose id does not follow its path step for step is read as
 * naming no slice, and constrains every occurrence.
 *
 * @packageDocumentation
 * @internal
 */

import { isList, type FhirNode } from "../model/index.js";
import { resolvePath, stepTypes } from "./navigate.js";
import { matchSlices, resolveSlices, type SliceEnvironment } from "./slicing.js";
import type { ElementDefinition } from "./structure-definition.js";

/** One instance occurrence and its FHIRPath location. */
export interface ScopedNode {
  readonly node: FhirNode;
  readonly path: string;
}

/**
 * One evaluation context for an element: a present, in-scope occurrence of the element's parent and
 * this element's occurrences within it. Cardinality is defined relative to the parent
 * (elementdefinition.html), so a `1..1` child is "one per parent", not "one in the whole resource".
 */
export interface ParentGroup {
  /** The FHIRPath location of the parent occurrence (the element's own path is `${path}.${leaf}`). */
  readonly path: string;
  /** This element's occurrences within that parent. */
  readonly children: FhirNode[];
  /** Per child, its choice suffix when the element is a `[x]` choice, else `undefined`. */
  readonly types: (string | undefined)[];
}

/** Flatten a resolved path result into individual occurrences (a list becomes its items). */
function occurrencesOf(nodes: readonly FhirNode[]): FhirNode[] {
  return nodes.flatMap((n) => (isList(n) ? n.items : [n]));
}

/** One step of an element id: the element name and, when the step names one, the slice. */
interface IdStep {
  /** The id up to and including this step's name, without this step's slice. */
  readonly slicedId: string;
  /** The slice this step names, when it names one. */
  readonly sliceName?: string;
}

/** Read an element id into steps aligned with its path, or `undefined` when they do not align. */
function idSteps(el: ElementDefinition): IdStep[] | undefined {
  const names = el.path.split(".");
  const segments = el.id.split(".");
  if (segments.length !== names.length) return undefined;
  const steps: IdStep[] = [];
  let prefix = "";
  for (const [k, segment] of segments.entries()) {
    const colon = segment.indexOf(":");
    const name = colon === -1 ? segment : segment.slice(0, colon);
    if (name !== names[k]) return undefined;
    const slicedId = prefix === "" ? name : `${prefix}.${name}`;
    steps.push(colon === -1 ? { slicedId } : { slicedId, sliceName: segment.slice(colon + 1) });
    prefix = `${prefix === "" ? "" : `${prefix}.`}${segment}`;
  }
  return steps;
}

/**
 * The scope of one resource against one profile snapshot: which occurrences each element constrains.
 * Slice membership is decided once per sliced element and parent occurrence, and reused.
 *
 * @internal
 */
export class SliceScope {
  readonly #resource: FhirNode;
  readonly #root: string;
  readonly #snapshot: readonly ElementDefinition[];
  readonly #byId = new Map<string, ElementDefinition>();
  readonly #assignments = new Map<string, WeakMap<FhirNode, readonly (string | undefined)[]>>();
  readonly #environment: SliceEnvironment;

  /**
   * @param resource - The resource model.
   * @param root - The resource's bounded FHIRPath root (its type).
   * @param snapshot - The profile's snapshot elements.
   * @param environment - What a `type` or `profile` discriminator needs to be decided.
   */
  constructor(
    resource: FhirNode,
    root: string,
    snapshot: readonly ElementDefinition[],
    environment: SliceEnvironment = {},
  ) {
    this.#resource = resource;
    this.#environment = environment;
    this.#root = root;
    this.#snapshot = snapshot;
    for (const el of snapshot) if (!this.#byId.has(el.id)) this.#byId.set(el.id, el);
  }

  /**
   * The in-scope occurrences of an element's parent, and the element's occurrences within each.
   * A top-level element yields one group (the resource); a nested one yields a group per present,
   * in-scope parent occurrence, and none when there is none.
   */
  parentGroups(el: ElementDefinition): ParentGroup[] {
    const names = el.path.split(".");
    /* v8 ignore next -- the `?? ""` is unreachable: split() always yields a last segment */
    const leaf = names[names.length - 1] ?? "";
    return this.#walk(el, names.length - 1).map((parent) => ({
      path: parent.path,
      children: occurrencesOf(resolvePath(parent.node, leaf)),
      types: stepTypes(parent.node, leaf),
    }));
  }

  /**
   * The in-scope occurrences of an element itself, each with its location. The root element yields
   * the resource.
   */
  occurrences(el: ElementDefinition): ScopedNode[] {
    const names = el.path.split(".");
    /* v8 ignore next -- the `?? ""` is unreachable: split() always yields a last segment */
    const leaf = names[names.length - 1] ?? "";
    if (names.length === 1) return [{ node: this.#resource, path: this.#root }];
    return this.#walk(el, names.length - 1).flatMap((parent) => {
      const occ = occurrencesOf(resolvePath(parent.node, leaf));
      return occ.map((node, i) => ({ node, path: located(parent.path, leaf, i, occ.length) }));
    });
  }

  /** Walk the first `depth` steps of an element's path, keeping the in-scope occurrences. */
  #walk(el: ElementDefinition, depth: number): ScopedNode[] {
    const names = el.path.split(".");
    const steps = idSteps(el);
    let contexts: ScopedNode[] = [{ node: this.#resource, path: this.#root }];
    for (let k = 1; k < depth; k += 1) {
      /* v8 ignore next -- the `?? ""` is unreachable: k stays below the path's segment count */
      const name = names[k] ?? "";
      const step = steps?.[k];
      const next: ScopedNode[] = [];
      for (const parent of contexts) {
        const occ = occurrencesOf(resolvePath(parent.node, name));
        const members =
          step?.sliceName === undefined
            ? undefined
            : this.#members(parent.node, name, occ, step.slicedId, step.sliceName);
        occ.forEach((node, i) => {
          if (members !== undefined && members[i] !== true) return;
          next.push({ node, path: located(parent.path, name, i, occ.length) });
        });
      }
      contexts = next;
    }
    return contexts;
  }

  /** Per occurrence, whether the slicing on `slicedId` assigned it to `sliceName`. */
  #members(
    parent: FhirNode,
    name: string,
    occ: readonly FhirNode[],
    slicedId: string,
    sliceName: string,
  ): boolean[] {
    const sliced = this.#byId.get(slicedId);
    if (sliced?.slicing === undefined) return occ.map(() => false);
    let byParent = this.#assignments.get(slicedId);
    if (byParent === undefined) {
      byParent = new WeakMap();
      this.#assignments.set(slicedId, byParent);
    }
    let assignments = byParent.get(parent);
    if (assignments === undefined) {
      const slices = resolveSlices(this.#snapshot, sliced);
      const result = matchSlices(occ, slices, sliced.slicing.discriminator, {
        ...this.#environment,
        occurrenceTypes: stepTypes(parent, name),
      });
      assignments = result.unchecked ? occ.map(() => undefined) : result.assignments;
      byParent.set(parent, assignments);
    }
    return occ.map((_, i) => assignments[i] === sliceName);
  }
}

/** The location of the `i`th of `count` occurrences of `name` under `parent` (indexed when repeated). */
function located(parent: string, name: string, i: number, count: number): string {
  return count > 1 ? `${parent}.${name}[${String(i)}]` : `${parent}.${name}`;
}
