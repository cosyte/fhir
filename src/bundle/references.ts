/**
 * Reference resolution within a Bundle and a resource's `contained` set, plus the **DoS-safe cycle
 * guard** (references.html).
 *
 * A FHIR `Reference.reference` comes in four forms ({@link ../model/reference.js parseReference}
 * classifies them): a `#fragment` into the same resource's `contained`, a relative `Type/id`, an
 * absolute URL, or a logical (`urn:`) identifier. This module resolves them against the closure the
 * caller actually holds, a {@link BundleIndex} (entries keyed by `fullUrl` and `Type/id`) and a
 * {@link ContainedIndex} (a resource's `contained` keyed by id), and says, honestly, one of three
 * things: `"resolved"`, `"unresolved"` (a local miss, flagged, never dropped), or `"external"` (a
 * reference to somewhere outside the closure, not a defect, so never flagged).
 *
 * **The cycle guard (DoS-safety).** A naive "resolve this and everything it points to" walk loops
 * forever on a reference cycle (`#a` → `#b` → `#a`) and can blow the stack on a deeply-nested one.
 * {@link hasContainedCycle} builds the `contained` fragment graph and runs an **iterative** (heap, not
 * call-stack) depth-first search with a bounded frontier ({@link MAX_REFERENCE_DEPTH}) and three-color
 * marking, so a cycle is *detected and reported*, never followed. It always terminates.
 *
 * @packageDocumentation
 */

import { getProperty, isComplex, isList, isPrimitive } from "../model/index.js";
import type { FhirComplex, FhirNode, FhirProperty } from "../model/index.js";
import { Trail } from "../model/path.js";
import { parseReference } from "../model/reference.js";

/**
 * A hard cap on the depth-first frontier the cycle guard will hold at once. A `contained` fragment
 * graph deeper than this is treated as pathological (reported as a cycle) rather than walked, a
 * belt-and-suspenders bound on memory on top of the three-color visited marking that already
 * guarantees termination.
 */
export const MAX_REFERENCE_DEPTH = 512;

/**
 * A resolvable index of a Bundle's entries, keyed the two ways a reference can name an entry.
 *
 * A key two entries claim names neither: it is left out of its map and listed in the matching
 * `repeated` set, so a reference to it reads as unresolved rather than reaching whichever entry came
 * first.
 */
export interface BundleIndex {
  /** Entries keyed by their exact `fullUrl` (matches an absolute or `urn:` reference). */
  readonly byFullUrl: ReadonlyMap<string, FhirComplex>;
  /** Entries keyed by `Type/id` (matches a relative reference, or an absolute one's RESTful tail). */
  readonly byTypeId: ReadonlyMap<string, FhirComplex>;
  /**
   * The `fullUrl`s more than one entry carries, kept out of {@link BundleIndex.byFullUrl}. Absent on
   * an index built by hand, which then names no repeat.
   */
  readonly repeatedFullUrls?: ReadonlySet<string>;
  /**
   * The `Type/id` keys more than one entry claims, kept out of {@link BundleIndex.byTypeId}. Absent
   * on an index built by hand, which then names no repeat.
   */
  readonly repeatedTypeIds?: ReadonlySet<string>;
}

/**
 * A resolvable index of one resource's `contained` resources, for `#fragment` resolution.
 *
 * An id two contained resources carry names neither: it is left out of
 * {@link ContainedIndex.byId} and listed in {@link ContainedIndex.repeatedIds}, so `#id` reads as
 * unresolved rather than reaching whichever came first.
 */
export interface ContainedIndex {
  /** The containing resource itself, the target of a bare `#` fragment. */
  readonly root: FhirComplex;
  /** Contained resources keyed by their logical `id` (matches `#id`), each id carried once. */
  readonly byId: ReadonlyMap<string, FhirComplex>;
  /**
   * The ids more than one contained resource carries, kept out of {@link ContainedIndex.byId}.
   * Absent on an index built by hand, which then names no repeat.
   */
  readonly repeatedIds?: ReadonlySet<string>;
}

/** The outcome of resolving a single reference against a closure. */
export type ReferenceResolution =
  /** The reference named a resource in the closure. */
  | { readonly status: "resolved"; readonly target: FhirComplex }
  /** A local reference (fragment, or relative within a Bundle) that named nothing in the closure. */
  | { readonly status: "unresolved" }
  /** A reference to somewhere outside the closure (an absolute/logical target not in the Bundle). */
  | { readonly status: "external" };

/** Read a primitive node's value as its lexical string. */
function stringOf(node: FhirNode | undefined): string | undefined {
  if (node === undefined || !isPrimitive(node) || typeof node.value !== "string") return undefined;
  return node.value;
}

/** The `resourceType` string of a complex node. */
function typeOf(node: FhirComplex): string | undefined {
  return stringOf(getProperty(node, "resourceType"));
}

/**
 * Key `node` under `key`, unless another node holds it already: then the key names neither, and
 * moves from `map` to `repeated`. The same node keyed twice (an entry's fullUrl tail and its own
 * `Type/id`) is one claim, not a repeat.
 */
function claim(
  map: Map<string, FhirComplex>,
  repeated: Set<string>,
  key: string,
  node: FhirComplex,
): void {
  if (repeated.has(key)) return;
  const held = map.get(key);
  if (held === undefined) {
    map.set(key, node);
  } else if (held !== node) {
    map.delete(key);
    repeated.add(key);
  }
}

/** The list of `contained` resources on a resource (a single object or a list, both tolerated). */
function containedResources(resource: FhirComplex): readonly FhirComplex[] {
  const node = getProperty(resource, "contained");
  if (node === undefined) return [];
  const items = isList(node) ? node.items : [node];
  return items.filter((item): item is FhirComplex => isComplex(item));
}

/**
 * Build a {@link ContainedIndex} for `#fragment` resolution against a resource's `contained` set.
 * An id more than one contained resource carries is resolved to none of them: it is listed in
 * `repeatedIds` instead of `byId`.
 *
 * @param resource - The containing resource model.
 * @example
 * ```ts
 * import { parseResource, containedIndex, resolveReference } from "@cosyte/fhir";
 * const { resource } = parseResource(
 *   '{"resourceType":"Observation","contained":[{"resourceType":"Patient","id":"p1"}],' +
 *     '"subject":{"reference":"#p1"}}',
 * );
 * const contained = containedIndex(resource);
 * resolveReference("#p1", { contained }).status; // "resolved"
 * ```
 */
export function containedIndex(resource: FhirComplex): ContainedIndex {
  const byId = new Map<string, FhirComplex>();
  const repeatedIds = new Set<string>();
  for (const contained of containedResources(resource)) {
    const id = stringOf(getProperty(contained, "id"));
    if (id !== undefined) claim(byId, repeatedIds, id, contained);
  }
  return { root: resource, byId, repeatedIds };
}

/**
 * Build a {@link BundleIndex} from a `Bundle`, keying every entry resource by both its `fullUrl` and,
 * where derivable, a `Type/id`, so a relative, absolute, or logical reference can each find it. A
 * `fullUrl` or a `Type/id` more than one entry claims is resolved to none of them: it is listed in
 * `repeatedFullUrls` or `repeatedTypeIds` instead.
 *
 * @param bundle - A `Bundle` resource model.
 * @example
 * ```ts
 * import { parseResource, buildBundleIndex, resolveReference } from "@cosyte/fhir";
 * const { resource } = parseResource(
 *   '{"resourceType":"Bundle","type":"collection","entry":[' +
 *     '{"fullUrl":"https://ex/Patient/1","resource":{"resourceType":"Patient","id":"1"}}]}',
 * );
 * const index = buildBundleIndex(resource);
 * resolveReference("Patient/1", { bundle: index }).status; // "resolved"
 * ```
 */
export function buildBundleIndex(bundle: FhirComplex): BundleIndex {
  const byFullUrl = new Map<string, FhirComplex>();
  const byTypeId = new Map<string, FhirComplex>();
  const repeatedFullUrls = new Set<string>();
  const repeatedTypeIds = new Set<string>();
  const entryNode = getProperty(bundle, "entry");
  const entries = entryNode !== undefined && isList(entryNode) ? entryNode.items : [];
  for (const entry of entries) {
    if (!isComplex(entry)) continue;
    const resourceNode = getProperty(entry, "resource");
    if (resourceNode === undefined || !isComplex(resourceNode)) continue;
    const fullUrl = stringOf(getProperty(entry, "fullUrl"));
    // Key by the fullUrl, and by its RESTful tail (Type/id) when it has one.
    if (fullUrl !== undefined) {
      claim(byFullUrl, repeatedFullUrls, fullUrl, resourceNode);
      const parsed = parseReference(fullUrl);
      if (parsed.type !== undefined && parsed.id !== undefined) {
        claim(byTypeId, repeatedTypeIds, `${parsed.type}/${parsed.id}`, resourceNode);
      }
    }
    // Also key by the wrapped resource's own Type/id, filling any gap the fullUrl did not.
    const rt = typeOf(resourceNode);
    const rid = stringOf(getProperty(resourceNode, "id"));
    if (rt !== undefined && rid !== undefined) {
      claim(byTypeId, repeatedTypeIds, `${rt}/${rid}`, resourceNode);
    }
  }
  return { byFullUrl, byTypeId, repeatedFullUrls, repeatedTypeIds };
}

/**
 * Resolve a single `Reference.reference` string against a Bundle and/or a `contained` closure.
 *
 * Resolution is honest about its closure: a `#fragment` resolves only within `contained`; a relative
 * `Type/id` only within the Bundle. A local miss is `"unresolved"` (the caller flags it,
 * `REFERENCE_UNRESOLVED`, and preserves the reference). An absolute or logical reference that is not
 * in the Bundle is `"external"`, it points somewhere this library was never given, which is **not** a
 * defect, so it draws no finding.
 *
 * A reference to an id, `fullUrl` or `Type/id` the closure holds more than once is `"unresolved"`
 * too: it names no one resource, and the first is never picked for it.
 *
 * @param reference - The `Reference.reference` string.
 * @param options - The closure: a {@link BundleIndex} and/or a {@link ContainedIndex}.
 * @returns The {@link ReferenceResolution}.
 * @example
 * ```ts
 * import { resolveReference } from "@cosyte/fhir";
 * resolveReference("Patient/1", { bundle }).status;   // "resolved" | "unresolved"
 * resolveReference("#p1", { contained }).status;      // "resolved" | "unresolved"
 * resolveReference("https://other/fhir/Patient/9", {}).status; // "external"
 * ```
 */
export function resolveReference(
  reference: string,
  options: { readonly bundle?: BundleIndex; readonly contained?: ContainedIndex } = {},
): ReferenceResolution {
  const parsed = parseReference(reference);
  const { bundle, contained } = options;

  if (parsed.kind === "fragment") {
    if (contained === undefined) return { status: "unresolved" };
    /* v8 ignore next -- the `?? ""` is unreachable: parseReference always sets a fragment's id */
    const anchor = parsed.id ?? "";
    // A bare `#` targets the containing resource itself; `#id` targets a contained resource.
    if (anchor === "") return { status: "resolved", target: contained.root };
    const target = contained.byId.get(anchor);
    return target === undefined ? { status: "unresolved" } : { status: "resolved", target };
  }

  if (parsed.kind === "relative") {
    if (bundle === undefined) return { status: "external" };
    // Key on the parsed Type/id (dropping any `/_history/{vid}` suffix) so a versioned relative
    // reference `Patient/1/_history/2` still resolves against the `Patient/1` entry, the index is
    // keyed version-free, exactly as the absolute branch below.
    /* v8 ignore next -- the fallback is unreachable: parseReference sets type and id on every relative form */
    const key =
      parsed.type !== undefined && parsed.id !== undefined
        ? `${parsed.type}/${parsed.id}`
        : reference;
    const target = bundle.byTypeId.get(key);
    return target === undefined ? { status: "unresolved" } : { status: "resolved", target };
  }

  // Absolute or logical: match the whole URL, then its RESTful tail; otherwise it is external. A
  // URL or tail the Bundle holds more than once is in the Bundle, so it is never external, and
  // names no one entry, so it is unresolved.
  if (bundle !== undefined) {
    const byUrl = bundle.byFullUrl.get(reference);
    if (byUrl !== undefined) return { status: "resolved", target: byUrl };
    if (bundle.repeatedFullUrls?.has(reference) === true) return { status: "unresolved" };
    if (parsed.type !== undefined && parsed.id !== undefined) {
      const tail = `${parsed.type}/${parsed.id}`;
      const byTail = bundle.byTypeId.get(tail);
      if (byTail !== undefined) return { status: "resolved", target: byTail };
      if (bundle.repeatedTypeIds?.has(tail) === true) return { status: "unresolved" };
    }
  }
  return { status: "external" };
}

/**
 * Visit every `Reference` element in a node subtree, in document order, reporting its FHIRPath
 * location and reference string. A `Reference` is recognised structurally: a complex node carrying a
 * `reference` string property.
 *
 * @param node - The node to walk.
 * @param path - The FHIRPath prefix for `node`.
 * @param visit - Called once per reference with its value-free location and the reference string.
 * @internal
 */
export function eachReference(
  node: FhirNode,
  path: string,
  visit: (location: string, reference: string) => void,
): void {
  eachReferenceOn(node, new Trail(path), (at, reference) => {
    visit(`${at.text()}.reference`, reference);
  });
}

/**
 * {@link eachReference} on a {@link Trail}: `visit` is handed the trail at the element carrying the
 * reference, so a caller renders the location only for a reference it reports.
 *
 * @internal
 */
export function eachReferenceOn(
  node: FhirNode,
  trail: Trail,
  visit: (at: Trail, reference: string) => void,
): void {
  if (isList(node)) {
    const items = node.items;
    for (let index = 0; index < items.length; index++) {
      trail.index(index);
      eachReferenceOn(items[index] as FhirNode, trail, visit);
      trail.pop();
    }
    return;
  }
  if (!isComplex(node)) return;
  const ref = stringOf(getProperty(node, "reference"));
  if (ref !== undefined) visit(trail, ref);
  const properties = node.properties;
  for (let i = 0; i < properties.length; i++) {
    const property = properties[i] as FhirProperty;
    trail.child(property.name);
    eachReferenceOn(property.value, trail, visit);
    trail.pop();
  }
}

/** Collect the fragment-reference target ids reachable from a node subtree (a bare `#` → `""`). */
function fragmentTargets(node: FhirNode, skipContained: boolean): string[] {
  const targets: string[] = [];
  walkFragments(node, skipContained, targets);
  return targets;
}

/** Recursive helper for {@link fragmentTargets}; skips a top-level `contained` when asked. */
function walkFragments(node: FhirNode, skipContained: boolean, out: string[]): void {
  if (isList(node)) {
    for (const item of node.items) walkFragments(item, false, out);
    return;
  }
  if (!isComplex(node)) return;
  const ref = stringOf(getProperty(node, "reference"));
  if (ref !== undefined) {
    const parsed = parseReference(ref);
    /* v8 ignore next -- the `?? ""` is unreachable: parseReference always sets a fragment's id */
    if (parsed.kind === "fragment") out.push(parsed.id ?? "");
  }
  for (const property of node.properties) {
    if (skipContained && property.name === "contained") continue;
    walkFragments(property.value, false, out);
  }
}

/** A mutable DFS frame for the iterative (heap-based) cycle walk. */
interface Frame {
  readonly node: string;
  edge: number;
}

/**
 * Whether a resource's `contained` resources reference each other (or the root) in a **cycle**.
 *
 * Builds the fragment graph, one node per contained resource id plus the root (`""`), an edge for
 * each `#fragment` reference, and runs an iterative three-color DFS. Because the DFS is heap-based
 * (not recursive) and marks visited nodes, it **always terminates**: a cycle is reported, never
 * followed. This is the DoS guard: a reference cycle becomes a typed
 * `CONTAINED_CYCLE` finding, never an infinite loop or a stack overflow.
 *
 * @param resource - The resource whose `contained` set to check.
 * @returns `true` when a containment cycle exists.
 * @example
 * ```ts
 * import { parseResource, hasContainedCycle } from "@cosyte/fhir";
 * const { resource } = parseResource(
 *   '{"resourceType":"Observation","contained":[' +
 *     '{"resourceType":"Observation","id":"a","hasMember":[{"reference":"#b"}]},' +
 *     '{"resourceType":"Observation","id":"b","hasMember":[{"reference":"#a"}]}]}',
 * );
 * hasContainedCycle(resource); // true, a → b → a
 * ```
 */
export function hasContainedCycle(resource: FhirComplex): boolean {
  const graph = new Map<string, readonly string[]>();
  graph.set("", fragmentTargets(resource, true));
  for (const contained of containedResources(resource)) {
    const id = stringOf(getProperty(contained, "id"));
    if (id !== undefined && !graph.has(id)) graph.set(id, fragmentTargets(contained, false));
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();

  for (const start of graph.keys()) {
    if ((color.get(start) ?? WHITE) !== WHITE) continue;
    color.set(start, GRAY);
    const stack: Frame[] = [{ node: start, edge: 0 }];
    while (stack.length > 0) {
      if (stack.length > MAX_REFERENCE_DEPTH) return true; // pathologically deep, treat as a cycle
      const frame = stack[stack.length - 1];
      /* v8 ignore next -- unreachable: the stack is non-empty here */
      if (frame === undefined) break;
      /* v8 ignore next -- the `?? []` is unreachable: the stack holds only ids the graph keys */
      const edges = graph.get(frame.node) ?? [];
      if (frame.edge >= edges.length) {
        color.set(frame.node, BLACK);
        stack.pop();
        continue;
      }
      const next = edges[frame.edge];
      frame.edge += 1;
      if (next === undefined || !graph.has(next)) continue; // an unknown target is not a cycle edge
      const nextColor = color.get(next) ?? WHITE;
      if (nextColor === GRAY) return true; // back-edge into the active path → cycle
      if (nextColor === WHITE) {
        color.set(next, GRAY);
        stack.push({ node: next, edge: 0 });
      }
    }
  }
  return false;
}
