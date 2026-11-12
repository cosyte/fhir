/**
 * Element-path navigation over the generic model (support for the profile engine).
 *
 * Profile validation and slicing discriminators are expressed as **element paths** relative to a
 * resource or a slice element (e.g. `clinicalStatus.coding.code`, `value[x]`, `$this`). This module
 * resolves such a path to the set of model nodes it selects, flattening the repeating elements it
 * walks through and honoring `[x]` choice variants. It is a deliberately small, FHIRPath-*shaped* navigator, not the
 * FHIRPath engine: it walks dotted member access and choice suffixes,
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
 * choice variant (`value[x]` → `valueQuantity`, `valueString`, …). A repeating element the path
 * walks through is flattened, so `coding.code` on a `CodeableConcept` with three codings yields three
 * nodes. A repeating element in the last segment is not: it comes back as its list node
 * (`kind: "list"`, members on `items`), so `name` on a Patient with two names yields one node.
 * Flatten it with `isList(node) ? node.items : [node]`.
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
  /* v8 ignore next -- the `?? ""` is unreachable: split() always yields a first segment */
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
 * Whether an element path selects at least one node on `node`, the `exists` primitive used by the
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

/**
 * The concrete type of each occurrence one path step selects, aligned with
 * `resolvePath(node, name)` flattened to its members: a `[x]` step's choice suffix
 * (`valueQuantity` → `"Quantity"`), `undefined` for any other step. A `type` slicing discriminator
 * on a choice element reads it, since the occurrence node itself does not carry its name.
 *
 * @param node - The parent node.
 * @param name - One element name, `[x]` choices included.
 * @returns One entry per selected occurrence, in document order.
 * @internal
 */
export function stepTypes(node: FhirNode, name: string): (string | undefined)[] {
  if (isList(node)) return node.items.flatMap((item) => stepTypes(item, name));
  if (!isComplex(node)) return [];
  const count = (value: FhirNode): number => (isList(value) ? value.items.length : 1);
  if (!name.endsWith("[x]")) {
    const found = getProperty(node, name);
    return found === undefined ? [] : Array.from({ length: count(found) }, () => undefined);
  }
  const base = name.slice(0, -3);
  return node.properties
    .filter((p) => p.name.startsWith(base) && CHOICE_SUFFIX.test(p.name.slice(base.length)))
    .flatMap((p) => Array.from({ length: count(p.value) }, () => p.name.slice(base.length)));
}
