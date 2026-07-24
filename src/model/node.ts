/**
 * The generic FHIR element model, a wire-agnostic, loss-free tree.
 *
 * FHIR is already structured data, so unlike a delimited-text parser this library's model is a
 * faithful element tree rather than a re-tokenization. Phase 1 deliberately models the *structure*
 * generically (typed per-resource models arrive in later phases) while typing the two primitives
 * that a naive implementation corrupts, `decimal` (see {@link FhirDecimal}) and `integer64`. The
 * tree preserves everything the wire carried: property order, primitive metadata, and exact decimal
 * text.
 *
 * Three node kinds cover every FHIR element:
 *
 * - {@link FhirComplex}, an object element (a resource, a `Coding`, a `HumanName`, an extension…):
 *   an **insertion-ordered** list of named properties.
 * - {@link FhirList}, a repeating element: an ordered list of nodes.
 * - {@link FhirPrimitive}, a leaf: a value plus the `id` / `extension` metadata that FHIR JSON
 *   carries in the `_`-sibling. Crucially the metadata is modeled as a **first-class** part of the
 *   primitive, not as a literal `_`-prefixed key, architecture ADR 0003 requires this so the XML
 *   codec (Phase 8) can attach the same metadata without a JSON-shaped assumption leaking into the
 *   model.
 *
 * Every node is deeply `readonly`: the model is immutable, and the reader never hands back a
 * structure a consumer can mutate in place.
 *
 * @packageDocumentation
 */

import type { FhirDecimal } from "./decimal.js";

/** The scalar value a {@link FhirPrimitive} can hold. `decimal` is a {@link FhirDecimal}; every
 * other primitive (`string`, `code`, `uri`, `date`, `boolean`, `integer`, …) reduces to one of
 * these three at the structural level. `undefined` means the value is absent but metadata is
 * present (the `_`-sibling-only case, e.g. an extension on a primitive that carries no value). */
export type PrimitiveValue = string | boolean | FhirDecimal;

/**
 * A primitive (leaf) element: a value plus its optional `id` and `extension` metadata.
 *
 * `value` is `undefined` exactly when the element has no value of its own but does carry metadata,
 * the FHIR case where a primitive slot is `null` in the value array but an object in the
 * `_`-sibling array. At least one of `value`, `id`, `extension` is meaningful for the node to exist.
 *
 * @example
 * ```ts
 * import { primitive } from "@cosyte/fhir";
 * const given = primitive("Jacqueline");                 // plain value
 * const flagged = primitive(undefined, { extension: [ext] }); // value-absent, extension-only
 * ```
 */
export interface FhirPrimitive {
  readonly kind: "primitive";
  readonly value: PrimitiveValue | undefined;
  readonly id?: string;
  readonly extension?: readonly FhirComplex[];
}

/** A single named property of a {@link FhirComplex}. */
export interface FhirProperty {
  readonly name: string;
  readonly value: FhirNode;
}

/**
 * An object (complex) element: an ordered list of named properties. Order is preserved from the
 * wire so that a spec-clean document round-trips faithfully; on emit the serializer additionally
 * hoists `resourceType` to the front where present (the one canonical-ordering rule FHIR requires).
 */
export interface FhirComplex {
  readonly kind: "complex";
  readonly properties: readonly FhirProperty[];
}

/**
 * A repeating element: an ordered list of item nodes. A primitive list preserves value-absent slots
 * as {@link FhirPrimitive} nodes with `value: undefined`, so the null-padding alignment between a
 * value array and its `_`-sibling array is captured structurally.
 */
export interface FhirList {
  readonly kind: "list";
  readonly items: readonly FhirNode[];
}

/** Any node in the model tree. */
export type FhirNode = FhirComplex | FhirList | FhirPrimitive;

/**
 * Whether `node` is a {@link FhirPrimitive}.
 *
 * @example
 * ```ts
 * import { isPrimitive, primitive } from "@cosyte/fhir";
 * isPrimitive(primitive("x")); // true
 * ```
 */
export function isPrimitive(node: FhirNode): node is FhirPrimitive {
  return node.kind === "primitive";
}

/**
 * Whether `node` is a {@link FhirComplex}.
 *
 * @example
 * ```ts
 * import { complex, isComplex } from "@cosyte/fhir";
 * isComplex(complex([])); // true
 * ```
 */
export function isComplex(node: FhirNode): node is FhirComplex {
  return node.kind === "complex";
}

/**
 * Whether `node` is a {@link FhirList}.
 *
 * @example
 * ```ts
 * import { isList, list } from "@cosyte/fhir";
 * isList(list([])); // true
 * ```
 */
export function isList(node: FhirNode): node is FhirList {
  return node.kind === "list";
}

/** Optional `id` / `extension` metadata for {@link primitive}. */
export interface PrimitiveMeta {
  readonly id?: string;
  readonly extension?: readonly FhirComplex[];
}

/**
 * Construct a {@link FhirPrimitive}. Omits absent optional keys (rather than setting them to
 * `undefined`) so the model satisfies `exactOptionalPropertyTypes` and equality stays structural.
 *
 * @param value - The scalar value, or `undefined` for a metadata-only (value-absent) primitive.
 * @param meta - Optional `id` / `extension`.
 * @example
 * ```ts
 * import { primitive } from "@cosyte/fhir";
 * const given = primitive("Jacqueline");
 * ```
 */
export function primitive(
  value: PrimitiveValue | undefined,
  meta: PrimitiveMeta = {},
): FhirPrimitive {
  const node: {
    kind: "primitive";
    value: PrimitiveValue | undefined;
    id?: string;
    extension?: readonly FhirComplex[];
  } = { kind: "primitive", value };
  if (meta.id !== undefined) node.id = meta.id;
  if (meta.extension !== undefined) node.extension = meta.extension;
  return node;
}

/**
 * Construct a {@link FhirComplex} from ordered properties.
 *
 * @example
 * ```ts
 * import { complex, primitive } from "@cosyte/fhir";
 * const patient = complex([{ name: "resourceType", value: primitive("Patient") }]);
 * ```
 */
export function complex(properties: readonly FhirProperty[]): FhirComplex {
  return { kind: "complex", properties };
}

/**
 * Construct a {@link FhirList} from ordered items.
 *
 * @example
 * ```ts
 * import { list, primitive } from "@cosyte/fhir";
 * const given = list([primitive("Jane"), primitive("Q")]);
 * ```
 */
export function list(items: readonly FhirNode[]): FhirList {
  return { kind: "list", items };
}

/**
 * Look up a top-level property on a complex node by name, returning the first match (FHIR forbids
 * duplicate keys; if malformed input carried one, the reader kept the first). Returns `undefined`
 * when absent.
 *
 * @example
 * ```ts
 * import { getProperty, parseResource } from "@cosyte/fhir";
 * const { resource } = parseResource('{"resourceType":"Patient","active":true}');
 * getProperty(resource, "active"); // the `active` primitive node
 * ```
 */
export function getProperty(node: FhirComplex, name: string): FhirNode | undefined {
  return node.properties.find((property) => property.name === name)?.value;
}

/**
 * The `resourceType` of a complex node, if it carries one as a string primitive. FHIR allows
 * `resourceType` in any position on read; this reads it wherever it sits.
 *
 * @example
 * ```ts
 * import { parseResource, resourceType } from "@cosyte/fhir";
 * const { resource } = parseResource('{"resourceType":"Patient","id":"1"}');
 * resourceType(resource); // "Patient"
 * ```
 */
export function resourceType(node: FhirComplex): string | undefined {
  const rt = getProperty(node, "resourceType");
  if (rt !== undefined && isPrimitive(rt) && typeof rt.value === "string") return rt.value;
  return undefined;
}
