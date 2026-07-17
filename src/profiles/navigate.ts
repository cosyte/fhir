/**
 * Element-path navigation over the generic model (Phase 6 support for the profile engine).
 *
 * Profile validation and slicing discriminators are expressed as **element paths** relative to a
 * resource or a slice element (e.g. `clinicalStatus.coding.code`, `value[x]`, `$this`). This module
 * resolves such a path to the set of model nodes it selects, flattening repeating elements and
 * honoring `[x]` choice variants. It is a deliberately small, FHIRPath-*shaped* navigator — not the
 * FHIRPath engine (that is Phase 7, ADR 0002): it walks dotted member access and choice suffixes,
 * which is exactly what StructureDefinition discriminator paths and fixed/pattern locations use, and
 * nothing more (no functions, no filters, no arithmetic).
 *
 * @packageDocumentation
 */

import { getProperty, isComplex, isList, type FhirNode } from "../model/index.js";

/** The FHIR primitive datatype suffixes a `[x]` choice element can take, upper-cased as they appear. */
const CHOICE_SUFFIX = /^[A-Z]/;

/**
 * Resolve an element path against a node, returning every node it selects (empty when nothing
 * matches). `$this` (or the empty path) selects the node itself. A `[x]` segment matches any concrete
 * choice variant (`value[x]` → `valueQuantity`, `valueString`, …). Repeating elements are flattened,
 * so `coding.code` on a `CodeableConcept` with three codings yields three nodes.
 *
 * @param node - The starting node (a resource, a slice element instance, …).
 * @param path - A dotted element path relative to `node` (`""` / `"$this"` selects `node`).
 * @returns The selected nodes, in document order.
 * @example
 * ```ts
 * import { parseResource } from "@cosyte/fhir";
 * import { resolvePath } from "@cosyte/fhir";
 * const { resource } = parseResource(
 *   '{"resourceType":"Observation","category":[{"coding":[{"code":"vital-signs"}]}]}',
 * );
 * resolvePath(resource, "category.coding.code"); // → [ the "vital-signs" primitive node ]
 * ```
 */
export function resolvePath(node: FhirNode, path: string): FhirNode[] {
  if (path === "" || path === "$this") return [node];
  const [head, ...rest] = path.split(".");
  const restPath = rest.join(".");
  const selected = step(node, head ?? "");
  if (restPath === "") return selected;
  return selected.flatMap((child) => resolvePath(child, restPath));
}

/** One member-access step: select the named element (or a `[x]` choice variant) from a node. */
function step(node: FhirNode, name: string): FhirNode[] {
  if (isList(node)) return node.items.flatMap((item) => step(item, name));
  if (!isComplex(node)) return [];

  if (name.endsWith("[x]")) {
    const base = name.slice(0, -3);
    return node.properties
      .filter((p) => p.name.startsWith(base) && CHOICE_SUFFIX.test(p.name.slice(base.length)))
      .map((p) => p.value);
  }
  const found = getProperty(node, name);
  return found === undefined ? [] : [found];
}

/**
 * Whether an element path selects at least one node on `node` — the `exists` primitive used by the
 * `exists` slicing discriminator and by cardinality checks.
 *
 * @param node - The starting node.
 * @param path - A dotted element path relative to `node`.
 * @returns `true` when the path selects one or more nodes.
 * @example
 * ```ts
 * import { parseResource } from "@cosyte/fhir";
 * import { pathExists } from "@cosyte/fhir";
 * const { resource } = parseResource('{"resourceType":"Patient","deceasedBoolean":true}');
 * pathExists(resource, "deceased[x]"); // true
 * ```
 */
export function pathExists(node: FhirNode, path: string): boolean {
  return resolvePath(node, path).length > 0;
}
