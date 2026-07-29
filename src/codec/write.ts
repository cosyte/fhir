/**
 * The JSON write path: the {@link FhirNode} model → spec-clean FHIR JSON text.
 *
 * The writer is the conservative half of Postel's Law: given a model that describes a conformant
 * document it always emits well-formed, canonical FHIR JSON. Two details are load-bearing for the
 * no-data-loss guarantee (json.html):
 *
 * - **Decimals are emitted from their exact lexical text** ({@link FhirDecimal.raw}), unquoted, so a
 *   value read in as `0.010` is written back as `0.010`. The value never becomes a JavaScript
 *   `number`, so it cannot be re-rounded.
 * - **Primitive metadata is split back out into the `_`-sibling**, and repeating primitives emit the
 *   value array and the `_`-array **index-aligned with `null` placeholders**, exactly as read.
 *
 * The one canonical-ordering rule applied on emit is hoisting `resourceType` to the front of a
 * resource object; every other property keeps the model's insertion order, so a spec-clean document
 * round-trips byte-for-byte. String values and object keys are escaped via `JSON.stringify` (correct
 * and canonical for strings, only numbers need the raw-text treatment).
 *
 * A model read from a **non-conformant** document is where "spec-clean" and "loses nothing" pull
 * against each other, and the writer resolves that the same way twice: it never invents, and it never
 * hides. Two such shapes exist, and they are resolved in opposite directions because the ambiguity is
 * of two different kinds.
 *
 * - **A repeated property name is narrowed.** FHIR requires unique property names (json.html), so
 *   writing both members back would emit a document invalid by the rule the writer exists to uphold.
 *   The node's `duplicates` are therefore not emitted and one value per name is written. The document
 *   held two values and only one can be expressed, so emit is the wrong place to choose between them.
 * - **A nested array is written back as it was read.** Here there is nothing to choose: the content
 *   is unambiguous, only its encoding is meaningless, and the alternative is worse. This writer used
 *   to emit `[{}]` for it, which both lost the value and *fabricated* an empty element the sender
 *   never wrote, and the re-read of that was clean. So the output for such a model is deliberately
 *   **not** spec-clean, because the input was not, and a lossy emit is the greater harm.
 *
 * Neither narrowing is ever silent: the reader raised `DUPLICATE_PROPERTY` / `NESTED_ARRAY` on the way
 * in, the validator rejects such a resource, and the safety readout refuses to summarize it.
 *
 * @packageDocumentation
 */

import {
  isList,
  isPrimitive,
  type FhirComplex,
  type FhirList,
  type FhirNode,
  type FhirPrimitive,
  type PrimitiveValue,
} from "../model/node.js";

/** Serialize a scalar primitive value to its JSON text. `undefined` is a value-absent slot → `null`. */
function emitScalar(value: PrimitiveValue | undefined): string {
  if (value === undefined) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  // FhirDecimal, emit its exact lexical text, unquoted. This is the whole point of ADR 0001.
  return value.raw;
}

/** Whether a primitive carries `id`/`extension` metadata that must go to a `_`-sibling. */
function hasMeta(node: FhirPrimitive): boolean {
  return node.id !== undefined || (node.extension !== undefined && node.extension.length > 0);
}

/** Emit a primitive's `_`-sibling object `{ id?, extension? }`. */
function emitMeta(node: FhirPrimitive): string {
  const parts: string[] = [];
  if (node.id !== undefined) parts.push(`"id":${JSON.stringify(node.id)}`);
  if (node.extension !== undefined && node.extension.length > 0) {
    parts.push(`"extension":[${node.extension.map(emitComplex).join(",")}]`);
  }
  return `{${parts.join(",")}}`;
}

/** Emit the `key:value` entries for a single primitive property (0, 1, or 2 entries). */
function emitPrimitiveProperty(name: string, node: FhirPrimitive): string[] {
  const entries: string[] = [];
  if (node.value !== undefined) {
    entries.push(`${JSON.stringify(name)}:${emitScalar(node.value)}`);
  }
  if (hasMeta(node)) {
    entries.push(`${JSON.stringify(`_${name}`)}:${emitMeta(node)}`);
  }
  return entries;
}

/**
 * Emit the `key:value` entries for a list property. Empty lists are omitted (FHIR forbids `[]`).
 *
 * A list whose items are primitives **or nested lists** takes the value/`_`-sibling split: each item
 * occupies one array position, a nested list emits as a nested array and contributes `null` to the
 * `_`-sibling array (it is not a primitive, so it has no `id`/`extension` of its own). Reading a
 * nested array as a nested list and writing it back this way is what makes the defect **survive a
 * round trip**: it used to read as an empty complex and rewrite as `[{}]`, so the second read of a
 * document was clean and the `NESTED_ARRAY` finding vanished on the way through.
 */
function emitListProperty(name: string, node: FhirList): string[] {
  if (node.items.length === 0) return [];

  const positional = node.items.every((item) => isPrimitive(item) || isList(item));
  if (!positional) {
    return [`${JSON.stringify(name)}:[${node.items.map(emitNode).join(",")}]`];
  }

  const anyValue = node.items.some((item) => !isPrimitive(item) || item.value !== undefined);
  const anyMeta = node.items.some((item) => isPrimitive(item) && hasMeta(item));
  const entries: string[] = [];
  // Emit the value array only when at least one item has a value. When every value is absent (an
  // extension-only repeating primitive) the value array would be all-`null`, non-canonical, so we
  // emit the `_`-sibling array alone, which round-trips to the same value-absent list.
  if (anyValue) {
    entries.push(`${JSON.stringify(name)}:[${node.items.map(emitNode).join(",")}]`);
  }
  if (anyMeta) {
    const metas = node.items
      .map((item) => (isPrimitive(item) && hasMeta(item) ? emitMeta(item) : "null"))
      .join(",");
    entries.push(`${JSON.stringify(`_${name}`)}:[${metas}]`);
  }
  return entries;
}

/** Emit a bare node (used for complex list items and nested lists). */
function emitNode(node: FhirNode): string {
  switch (node.kind) {
    case "complex":
      return emitComplex(node);
    case "list":
      return `[${node.items.map(emitNode).join(",")}]`;
    case "primitive":
      return emitScalar(node.value);
  }
}

/** Emit a complex object, hoisting `resourceType` to the front where present. */
function emitComplex(node: FhirComplex): string {
  const parts: string[] = [];

  const rt = node.properties.find((p) => p.name === "resourceType");
  if (rt !== undefined && isPrimitive(rt.value) && typeof rt.value.value === "string") {
    parts.push(`"resourceType":${JSON.stringify(rt.value.value)}`);
  }

  for (const property of node.properties) {
    if (property.name === "resourceType" && rt !== undefined) continue;
    const value = property.value;
    switch (value.kind) {
      case "primitive":
        parts.push(...emitPrimitiveProperty(property.name, value));
        break;
      case "list":
        parts.push(...emitListProperty(property.name, value));
        break;
      case "complex":
        parts.push(`${JSON.stringify(property.name)}:${emitComplex(value)}`);
        break;
    }
  }

  return `{${parts.join(",")}}`;
}

/**
 * Serialize a resource (or any {@link FhirComplex}) to spec-clean, compact FHIR JSON text.
 *
 * @param node - The resource model to serialize.
 * @returns Canonical JSON text, decimals byte-exact, primitive metadata split back into
 *   `_`-siblings with null-padded array alignment, `resourceType` first.
 * @example
 * ```ts
 * import { parseResource, serializeResource } from "@cosyte/fhir";
 * const { resource } = parseResource(input);
 * const json = serializeResource(resource); // round-trips a spec-clean input byte-for-byte
 * ```
 */
export function serializeResource(node: FhirComplex): string {
  return emitComplex(node);
}
