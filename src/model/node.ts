/**
 * The generic FHIR element model, a wire-agnostic, loss-free tree.
 *
 * FHIR is already structured data, so unlike a delimited-text parser this library's model is a
 * faithful element tree rather than a re-tokenization. It deliberately models the *structure*
 * generically (typed per-resource models are not part of it yet) while typing the two primitives
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
 *   primitive, not as a literal `_`-prefixed key, so the XML
 *   codec can attach the same metadata without a JSON-shaped assumption leaking into the
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
  /**
   * Set when the JSON document put an **array** at this position, where FHIR JSON gives an array no
   * meaning (an array inside an array). The array's contents are **not** modeled as FHIR: this is a
   * marker that content was present and could not be placed, not a representation of it. Absent on
   * every conformant document. See {@link isNestedArray}.
   */
  readonly nestedArray?: true;
  /**
   * The JSON text of the array the sender wrote at this position, when that array sat in the
   * element's own value channel. Never interpreted as FHIR. See {@link NestedArrayContent} for what
   * "the text" is exact about, and {@link nestedArrayContent} to read it.
   */
  readonly nestedArraySource?: string;
  /**
   * The JSON text of the array the sender wrote at this position in the primitive's `_`-sibling
   * (metadata) channel. A primitive can carry a nested array in either channel or both, so the two
   * are kept apart rather than merged. See {@link nestedArrayContent}.
   */
  readonly nestedArrayMetaSource?: string;
}

/** A single named property of a {@link FhirComplex}. */
export interface FhirProperty {
  readonly name: string;
  readonly value: FhirNode;
}

/**
 * An object (complex) element: an ordered list of named properties. Order is preserved from the
 * wire so that a spec-clean document round-trips faithfully; on emit the serializer additionally
 * hoists a string `resourceType` to the front (the one canonical-ordering rule FHIR requires).
 *
 * `properties` holds at most one entry per name. FHIR JSON requires property names to be unique
 * (json.html §2.6.2: "Property names SHALL be unique"), and a repeating element is an array, never a
 * repeated name. A non-conformant document that repeats a name is still read (the reader is
 * lenient), and the members the first-wins rule did not put in `properties` are kept in
 * {@link duplicates} rather than discarded, so nothing the wire carried is lost and a safety read
 * can see that the document was ambiguous. {@link duplicates} is absent on every conformant
 * document.
 */
export interface FhirComplex {
  readonly kind: "complex";
  readonly properties: readonly FhirProperty[];
  /**
   * The members a repeated property name shadowed, in document order, each still carrying the name
   * it was written under. Present only on a non-conformant document. Read them with
   * {@link getAllProperties}; a consumer that ignores this field is reading one arbitrary value out
   * of several the sender wrote.
   */
  readonly duplicates?: readonly FhirProperty[];
  /**
   * Set when the JSON document put an **array** at this position, where FHIR JSON gives an array no
   * meaning (an array inside an array). The array's contents are **not** modeled as FHIR: this is a
   * marker that content was present and could not be placed, not a representation of it, and the
   * node stays the empty element it has always been. Absent on every conformant document.
   * See {@link isNestedArray}.
   */
  readonly nestedArray?: true;
  /**
   * The JSON text of the array the sender wrote at this position, never interpreted as FHIR. See
   * {@link NestedArrayContent} for what "the text" is exact about, and {@link nestedArrayContent} to
   * read it.
   */
  readonly nestedArraySource?: string;
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

/**
 * Whether `node` sits where the JSON document wrote an **array inside an array**, a shape FHIR JSON
 * gives no meaning at any position (json.html §2.6.2.2 uses an array for a repeating element and
 * nothing else, so no element is ever a list of lists).
 *
 * The reader does not model what was inside that array **as FHIR**, so this node is the same empty
 * element it would be without the marker and no walker sees anything there. What the marker buys is
 * that the loss is **reportable**: a document carrying one must never come back with an affirmative
 * safety verdict computed as though nothing had been there. The safety readout collects these
 * locations (`nestedArrays`), refuses to summarize, and the validator raises an error.
 *
 * The content itself is **kept** and is read with {@link nestedArrayContent}. It
 * are deliberately not reachable through `properties`, `items` or `extension`: an array inside an
 * array has no FHIR meaning at any position, so there is no element for it to be, and placing one in
 * the tree would change what a repeating element contains for every consumer that walks one.
 *
 * Always `false` for a document read from XML, which has no way to express the shape, and for every
 * conformant JSON document.
 *
 * @example
 * ```ts
 * import { isNestedArray, parseResource, getProperty, isList } from "@cosyte/fhir";
 * const { resource } = parseResource('{"resourceType":"Patient","name":[[{"family":"Roe"}]]}');
 * const name = getProperty(resource, "name");
 * isList(name!) && isNestedArray(name.items[0]!); // true
 * ```
 */
export function isNestedArray(node: FhirNode): boolean {
  return (node.kind === "complex" || node.kind === "primitive") && node.nestedArray === true;
}

/** Which JSON channel a preserved array came from: the element's own value, or its `_`-sibling. */
export type NestedArrayChannel = "value" | "metadata";

/**
 * One array the sender wrote where FHIR JSON gives an array no meaning, kept as JSON text.
 *
 * The text is the array re-rendered compactly from what was read: member order and every member of a
 * repeated key are preserved, and number tokens keep their verbatim source, so no value changes. It
 * is not a byte-for-byte slice of the input, because insignificant whitespace is dropped and strings
 * are re-escaped canonically, exactly as everywhere else this library emits JSON.
 */
export interface NestedArrayContent {
  /** The JSON channel the array sat in. */
  readonly channel: NestedArrayChannel;
  /** The array's JSON text, uninterpreted. */
  readonly json: string;
}

/** The source texts {@link markNestedArray} preserves, one per JSON channel. */
interface NestedArraySources {
  readonly value?: string;
  readonly metadata?: string;
}

/**
 * Mark a node as sitting at a position where the document wrote an array inside an array, keeping
 * that array's JSON text. The JSON reader's own helper, **not part of the package's public
 * surface**: it is the write side of a diagnostic the reader owns, and a consumer marking a node of
 * their own would inject a validation error and a summarization refusal into a document that never
 * carried the shape. Read the marker with {@link isNestedArray} and the text with
 * {@link nestedArrayContent}, both of which are public.
 *
 * It copies the node rather than mutating it, and adds no element, property or item: the preserved
 * text is a leaf of its own, reachable only by name.
 *
 * @param node - The empty element or value-absent primitive the reader produced at that position.
 * @param sources - The JSON text per channel. A complex element has only a value channel.
 * @internal
 */
export function markNestedArray(node: FhirComplex, sources: { value: string }): FhirComplex;
export function markNestedArray(node: FhirPrimitive, sources: NestedArraySources): FhirPrimitive;
export function markNestedArray(
  node: FhirComplex | FhirPrimitive,
  sources: NestedArraySources,
): FhirComplex | FhirPrimitive {
  // Built by literal rather than by assignment so the optional keys are omitted outright, not set to
  // `undefined`: the model satisfies `exactOptionalPropertyTypes` and a node that preserved nothing
  // stays structurally equal to one built without the argument.
  if (node.kind === "complex") {
    if (sources.value === undefined) return { ...node, nestedArray: true };
    return { ...node, nestedArray: true, nestedArraySource: sources.value };
  }
  const withValue: FhirPrimitive =
    sources.value === undefined
      ? { ...node, nestedArray: true }
      : { ...node, nestedArray: true, nestedArraySource: sources.value };
  if (sources.metadata === undefined) return withValue;
  return { ...withValue, nestedArrayMetaSource: sources.metadata };
}

/**
 * The arrays the sender wrote at this position that FHIR JSON gives no meaning to, each as JSON
 * text (see {@link NestedArrayContent} for what that text preserves). Empty for every conformant
 * document, and for every node the reader did not mark.
 *
 * This is where the content of an array inside an array is preserved. It is **not** modeled as FHIR
 * and never will be: json.html §2.6.2.2 uses an array for a repeating element and for nothing else,
 * so an array inside one is not an element and has no place in the tree. Handing it back as the text
 * the sender wrote keeps it readable without redefining what a repeating element contains. Parse it
 * with `readRawJson` if you need its structure; the library will not decide what it meant.
 *
 * A primitive can carry one in each of the two JSON channels (its value array and its `_`-sibling
 * array), so up to two entries come back, value channel first.
 *
 * @param node - Any model node.
 * @returns The preserved arrays, `[]` when the node carries none.
 * @example
 * ```ts
 * import { getProperty, isList, nestedArrayContent, parseResource } from "@cosyte/fhir";
 * const { resource } = parseResource('{"resourceType":"Patient","name":[[{"family":"Roe"}]]}');
 * const name = getProperty(resource, "name");
 * isList(name!) && nestedArrayContent(name.items[0]!); // [{ channel: "value", json: '[{"family":"Roe"}]' }]
 * ```
 */
export function nestedArrayContent(node: FhirNode): readonly NestedArrayContent[] {
  if (node.kind === "list") return [];
  const out: NestedArrayContent[] = [];
  if (node.nestedArraySource !== undefined) {
    out.push({ channel: "value", json: node.nestedArraySource });
  }
  if (node.kind === "primitive" && node.nestedArrayMetaSource !== undefined) {
    out.push({ channel: "metadata", json: node.nestedArrayMetaSource });
  }
  return out;
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
 * Construct a {@link FhirComplex} from ordered properties, optionally carrying the members a
 * repeated property name shadowed.
 *
 * @param properties - The named properties, in wire order, at most one per name.
 * @param duplicates - Members shadowed by a repeated name. Omitted (not set to `undefined`) when
 *   empty, so a conformant node stays structurally equal to one built without the argument.
 * @example
 * ```ts
 * import { complex, primitive } from "@cosyte/fhir";
 * const patient = complex([{ name: "resourceType", value: primitive("Patient") }]);
 * ```
 */
export function complex(
  properties: readonly FhirProperty[],
  duplicates: readonly FhirProperty[] = [],
): FhirComplex {
  if (duplicates.length === 0) return { kind: "complex", properties };
  return { kind: "complex", properties, duplicates };
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
 * Look up a top-level property on a complex node by name, returning the first match. Returns
 * `undefined` when absent.
 *
 * FHIR JSON requires property names to be unique, so on a conformant document there is exactly one
 * match. On a document that repeats a name this returns the **first** one written and ignores the
 * rest; use {@link getAllProperties} wherever reading only one of several written values would be
 * unsafe.
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
 * Every top-level value written under `name`, in document order: the one in `properties` followed by
 * any that a repeated name shadowed. Returns one element for a conformant document, none when the
 * property is absent, and more than one only for a document that broke FHIR's unique-name rule.
 *
 * This is the fail-safe read. A check that must not miss a value the sender wrote (a retraction, a
 * negation) runs over all of them; a convenience read that only needs one uses {@link getProperty}.
 *
 * @example
 * ```ts
 * import { getAllProperties, parseResource } from "@cosyte/fhir";
 * const { resource } = parseResource('{"resourceType":"Observation","status":"final","status":"entered-in-error"}');
 * getAllProperties(resource, "status").length; // 2, both values are readable
 * ```
 */
export function getAllProperties(node: FhirComplex, name: string): readonly FhirNode[] {
  const out: FhirNode[] = [];
  for (const property of node.properties) if (property.name === name) out.push(property.value);
  for (const property of node.duplicates ?? []) {
    if (property.name === name) out.push(property.value);
  }
  return out;
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
