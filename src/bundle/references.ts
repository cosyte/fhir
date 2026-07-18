/**
 * Reference resolution within a Bundle and a resource's `contained` set, plus the **DoS-safe cycle
 * guard** (Phase 9, references.html).
 *
 * A FHIR `Reference.reference` comes in four forms ({@link ../model/reference.js parseReference}
 * classifies them): a `#fragment` into the same resource's `contained`, a relative `Type/id`, an
 * absolute URL, or a logical (`urn:`) identifier. This module resolves them against the closure the
 * caller actually holds — a {@link BundleIndex} (entries keyed by `fullUrl` and `Type/id`) and a
 * {@link ContainedIndex} (a resource's `contained` keyed by id) — and says, honestly, one of three
 * things: `"resolved"`, `"unresolved"` (a local miss — flagged, never dropped), or `"external"` (a
 * reference to somewhere outside the closure — not a defect, so never flagged).
 *
 * **The cycle guard (DoS-safety).** A naive "resolve this and everything it points to" walk loops
 * forever on a reference cycle (`#a` → `#b` → `#a`) and can blow the stack on a deeply-nested one.
 * {@link hasContainedCycle} builds the `contained` fragment graph and runs an **iterative** (heap, not
 * call-stack) depth-first search with a bounded frontier ({@link MAX_REFERENCE_DEPTH}) and three-color
 * marking — so a cycle is *detected and reported*, never followed. It always terminates.
 *
 * @packageDocumentation
 */

import { getProperty, isComplex, isList, isPrimitive } from "../model/index.js";
import type { FhirComplex, FhirNode } from "../model/index.js";
import { parseReference } from "../model/reference.js";

/**
 * A hard cap on the depth-first frontier the cycle guard will hold at once. A `contained` fragment
 * graph deeper than this is treated as pathological (reported as a cycle) rather than walked — a
 * belt-and-suspenders bound on memory on top of the three-color visited marking that already
 * guarantees termination.
 */
export const MAX_REFERENCE_DEPTH = 512;

/** A resolvable index of a Bundle's entries, keyed the two ways a reference can name an entry. */
export interface BundleIndex {
  /** Entries keyed by their exact `fullUrl` (matches an absolute or `urn:` reference). */
  readonly byFullUrl: ReadonlyMap<string, FhirComplex>;
  /** Entries keyed by `Type/id` (matches a relative reference, or an absolute one's RESTful tail). */
  readonly byTypeId: ReadonlyMap<string, FhirComplex>;
}

/** A resolvable index of one resource's `contained` resources, for `#fragment` resolution. */
export interface ContainedIndex {
  /** The containing resource itself — the target of a bare `#` fragment. */
  readonly root: FhirComplex;
  /** Contained resources keyed by their logical `id` (matches `#id`). */
  readonly byId: ReadonlyMap<string, FhirComplex>;
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

/** The list of `contained` resources on a resource (a single object or a list, both tolerated). */
function containedResources(resource: FhirComplex): readonly FhirComplex[] {
  const node = getProperty(resource, "contained");
  if (node === undefined) return [];
  const items = isList(node) ? node.items : [node];
  return items.filter((item): item is FhirComplex => isComplex(item));
}

/**
 * Build a {@link ContainedIndex} for `#fragment` resolution against a resource's `contained` set.
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
  for (const contained of containedResources(resource)) {
    const id = stringOf(getProperty(contained, "id"));
    if (id !== undefined && !byId.has(id)) byId.set(id, contained);
  }
  return { root: resource, byId };
}

/**
 * Build a {@link BundleIndex} from a `Bundle`, keying every entry resource by both its `fullUrl` and,
 * where derivable, a `Type/id` — so a relative, absolute, or logical reference can each find it.
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
  const entryNode = getProperty(bundle, "entry");
  const entries = entryNode !== undefined && isList(entryNode) ? entryNode.items : [];
  for (const entry of entries) {
    if (!isComplex(entry)) continue;
    const resourceNode = getProperty(entry, "resource");
    if (resourceNode === undefined || !isComplex(resourceNode)) continue;
    const fullUrl = stringOf(getProperty(entry, "fullUrl"));
    if (fullUrl !== undefined && !byFullUrl.has(fullUrl)) byFullUrl.set(fullUrl, resourceNode);
    // Key by the fullUrl's RESTful tail (Type/id), when it has one.
    if (fullUrl !== undefined) {
      const parsed = parseReference(fullUrl);
      if (parsed.type !== undefined && parsed.id !== undefined) {
        const key = `${parsed.type}/${parsed.id}`;
        if (!byTypeId.has(key)) byTypeId.set(key, resourceNode);
      }
    }
    // Also key by the wrapped resource's own Type/id, filling any gap the fullUrl did not.
    const rt = typeOf(resourceNode);
    const rid = stringOf(getProperty(resourceNode, "id"));
    if (rt !== undefined && rid !== undefined) {
      const key = `${rt}/${rid}`;
      if (!byTypeId.has(key)) byTypeId.set(key, resourceNode);
    }
  }
  return { byFullUrl, byTypeId };
}

/**
 * Resolve a single `Reference.reference` string against a Bundle and/or a `contained` closure.
 *
 * Resolution is honest about its closure: a `#fragment` resolves only within `contained`; a relative
 * `Type/id` only within the Bundle. A local miss is `"unresolved"` (the caller flags it,
 * `REFERENCE_UNRESOLVED`, and preserves the reference). An absolute or logical reference that is not
 * in the Bundle is `"external"` — it points somewhere this library was never given, which is **not** a
 * defect, so it draws no finding.
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
    const anchor = parsed.id ?? "";
    // A bare `#` targets the containing resource itself; `#id` targets a contained resource.
    if (anchor === "") return { status: "resolved", target: contained.root };
    const target = contained.byId.get(anchor);
    return target === undefined ? { status: "unresolved" } : { status: "resolved", target };
  }

  if (parsed.kind === "relative") {
    if (bundle === undefined) return { status: "external" };
    // Key on the parsed Type/id (dropping any `/_history/{vid}` suffix) so a versioned relative
    // reference `Patient/1/_history/2` still resolves against the `Patient/1` entry — the index is
    // keyed version-free, exactly as the absolute branch below.
    const key =
      parsed.type !== undefined && parsed.id !== undefined
        ? `${parsed.type}/${parsed.id}`
        : reference;
    const target = bundle.byTypeId.get(key);
    return target === undefined ? { status: "unresolved" } : { status: "resolved", target };
  }

  // Absolute or logical: match the whole URL, then its RESTful tail; otherwise it is external.
  if (bundle !== undefined) {
    const byUrl = bundle.byFullUrl.get(reference);
    if (byUrl !== undefined) return { status: "resolved", target: byUrl };
    if (parsed.type !== undefined && parsed.id !== undefined) {
      const byTail = bundle.byTypeId.get(`${parsed.type}/${parsed.id}`);
      if (byTail !== undefined) return { status: "resolved", target: byTail };
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
  if (isList(node)) {
    node.items.forEach((item, index) => eachReference(item, `${path}[${String(index)}]`, visit));
    return;
  }
  if (!isComplex(node)) return;
  const ref = stringOf(getProperty(node, "reference"));
  if (ref !== undefined) visit(`${path}.reference`, ref);
  for (const property of node.properties) {
    eachReference(property.value, `${path}.${property.name}`, visit);
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
 * Builds the fragment graph — one node per contained resource id plus the root (`""`), an edge for
 * each `#fragment` reference — and runs an iterative three-color DFS. Because the DFS is heap-based
 * (not recursive) and marks visited nodes, it **always terminates**: a cycle is reported, never
 * followed. This is the DoS guard the roadmap requires — a reference cycle becomes a typed
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
 * hasContainedCycle(resource); // true — a → b → a
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
      if (stack.length > MAX_REFERENCE_DEPTH) return true; // pathologically deep — treat as a cycle
      const frame = stack[stack.length - 1];
      if (frame === undefined) break;
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
