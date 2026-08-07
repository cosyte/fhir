/**
 * The JSON write path: the {@link FhirNode} model → compact FHIR JSON text.
 *
 * The writer is the conservative half of Postel's Law: it emits well-formed, canonical FHIR JSON for
 * every model that FHIR can express, and it never authors a value of its own. It is **not**
 * unconditionally spec-clean, and the exceptions are stated at the foot of this comment: a document
 * that wrote an array inside an array, a scalar or `null` where FHIR JSON has an object, a `null`
 * the reader marked in a **primitive's** value channel, or a `resourceType` that is not a string, is
 * handed back as written rather than repaired, because repairing it means inventing or dropping
 * content. **The primitive `null` and the complex one are two different branches and both are
 * listed**, because for a long time only the second was, and the first was omitted on emit: that
 * turned a non-conformant document into a conformant one with the member gone. Two details
 * are load-bearing for the no-data-loss guarantee (json.html):
 *
 * - **Decimals are emitted from their exact lexical text** ({@link FhirDecimal.raw}), unquoted, so a
 *   value read in as `0.010` is written back as `0.010`. The value never becomes a JavaScript
 *   `number`, so it cannot be re-rounded.
 * - **Primitive metadata is split back out into the `_`-sibling**, and repeating primitives emit the
 *   value array and the `_`-array **index-aligned with `null` placeholders**, exactly as read.
 *
 * The one canonical-ordering rule applied on emit is hoisting a **string** `resourceType` to the
 * front of a resource object; a `resourceType` of any other shape keeps its position rather than
 * being dropped, and every other property keeps the model's insertion order, so a spec-clean document
 * round-trips byte-for-byte. String values and object keys are escaped via `JSON.stringify` (correct
 * and canonical for strings, only numbers need the raw-text treatment).
 *
 * The **one** input the writer cannot round-trip is a document that repeated a property name. FHIR
 * requires unique property names (json.html), so writing both members back would emit a document
 * that is invalid by the rule the writer exists to uphold; the node's `duplicates` are therefore not
 * emitted and one value per name is written. That narrowing is deliberate and it is never silent: the
 * reader raised `DUPLICATE_PROPERTY` on the way in, the validator rejects such a resource, and the
 * safety readout refuses to summarize it. Emit is the wrong place to resolve the ambiguity, so the
 * writer does not try.
 *
 * **A position where the sender wrote an array inside an array is written back as that array**, from
 * the text the reader preserved. That output is not spec-clean, and it is the one place the writer
 * emits something it would never author, because both alternatives are worse: the model holds an
 * empty element at that position, so emitting the element fabricates an object the sender never
 * wrote, and omitting it drops content. Writing the array back is the only option under which
 * re-reading the output reproduces the same `NESTED_ARRAY` finding instead of laundering it away.
 * Conservatism here means refusing to author a value, not refusing to hand one back.
 *
 * **A position where the sender wrote a scalar or `null` where FHIR JSON has an object is written
 * back as that scalar**, on the same reasoning and from the same kind of preserved text. This is the
 * sharper of the two, because the alternative is not merely non-canonical, it is a value the writer
 * *authors*: the model holds an empty element at that position, `{}` is a conformant empty element,
 * and the `UNKNOWN_PROPERTY` the reader raised is therefore gone the moment the output is read back.
 * The writer that emitted it presents an object as read where nothing was read at all. Handing the
 * scalar back is what makes the re-read reproduce the finding instead.
 *
 * **A `null` the reader marked in a primitive's own value channel is written back as `null`**, and
 * this is the same reasoning again at the branch it was missing from. FHIR JSON defines a `null`
 * only as padding that aligns a repeating primitive's value array with its `_`-sibling (json.html
 * §2.6.1); one that padded nothing is marked on the way in
 * ({@link ../model/node.js} `isUndefinedNull`) and drew `UNDEFINED_JSON_NULL`. The model holds a
 * value-absent primitive there, and a value-absent primitive is ordinarily omitted, so without the
 * marker `{"value":null,"unit":"mg"}` was emitted as `{"unit":"mg"}`: a **conformant** `Quantity`
 * carrying a unit and no magnitude, which re-reads with no diagnostic at all. That is not the
 * writer dropping a value the sender wrote, because a `null` holds none; it is the writer resolving
 * a defect the sender's document had, into a clean document that no longer shows it. Writing the
 * `null` back is what makes the re-read reproduce the finding.
 *
 * A **padding** `null` is not marked and never was omitted: the array alignment below emits it from
 * the value-absent slot, so a conformant repeating primitive is untouched by any of this.
 *
 * @packageDocumentation
 */

import {
  isPrimitive,
  type FhirComplex,
  type FhirList,
  type FhirNode,
  type FhirPrimitive,
  type PrimitiveValue,
} from "../model/node.js";
import { assertSerializable } from "./serialize-guard.js";

/** Serialize a scalar primitive value to its JSON text. `undefined` is a value-absent slot → `null`. */
function emitScalar(value: PrimitiveValue | undefined): string {
  if (value === undefined) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  // FhirDecimal, emit its exact lexical text, unquoted. This is the whole point of ADR 0001.
  return value.raw;
}

/**
 * Emit a primitive's value slot: the array the sender wrote there if the reader preserved one,
 * otherwise the scalar. A preserved array is emitted as the reader kept it, which is the only way
 * this position can be written without either inventing an element the sender never wrote or
 * dropping one.
 */
function emitPrimitiveValue(node: FhirPrimitive): string {
  return node.nestedArraySource ?? emitScalar(node.value);
}

/**
 * Whether a primitive has anything to write in the value slot at all.
 *
 * A slot the reader marked as an undefined `null` counts, and that is the whole of the write-side
 * remedy: the `null` goes back where the sender wrote it instead of the member being omitted. It is
 * the same rule {@link emitComplex} applies one branch over for a `null` written at a complex
 * position. A **padding** `null` is not marked and does not reach this, so it is still emitted by
 * the array alignment below, exactly as before.
 */
function hasValue(node: FhirPrimitive): boolean {
  return (
    node.value !== undefined || node.nestedArraySource !== undefined || node.undefinedNull === true
  );
}

/** Whether a primitive carries `id`/`extension` metadata that must go to a `_`-sibling. */
function hasMeta(node: FhirPrimitive): boolean {
  return (
    node.id !== undefined ||
    (node.extension !== undefined && node.extension.length > 0) ||
    node.nestedArrayMetaSource !== undefined
  );
}

/** Emit a primitive's `_`-sibling object `{ id?, extension? }`, or the array preserved in its place. */
function emitMeta(node: FhirPrimitive): string {
  if (node.nestedArrayMetaSource !== undefined) return node.nestedArrayMetaSource;
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
  if (hasValue(node)) {
    entries.push(`${JSON.stringify(name)}:${emitPrimitiveValue(node)}`);
  }
  if (hasMeta(node)) {
    entries.push(`${JSON.stringify(`_${name}`)}:${emitMeta(node)}`);
  }
  return entries;
}

/** Emit the `key:value` entries for a list property. Empty lists are omitted (FHIR forbids `[]`). */
function emitListProperty(name: string, node: FhirList): string[] {
  if (node.items.length === 0) return [];

  const allPrimitive = node.items.every(isPrimitive);
  if (!allPrimitive) {
    return [`${JSON.stringify(name)}:[${node.items.map(emitNode).join(",")}]`];
  }

  const primitives = node.items.filter(isPrimitive);
  const anyValue = primitives.some(hasValue);
  const anyMeta = primitives.some(hasMeta);
  const entries: string[] = [];
  // Emit the value array only when at least one item has a value. When every value is absent (an
  // extension-only repeating primitive) the value array would be all-`null`, non-canonical, so we
  // emit the `_`-sibling array alone, which round-trips to the same value-absent list.
  if (anyValue) {
    const values = primitives.map(emitPrimitiveValue).join(",");
    entries.push(`${JSON.stringify(name)}:[${values}]`);
  }
  if (anyMeta) {
    const metas = primitives.map((item) => (hasMeta(item) ? emitMeta(item) : "null")).join(",");
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
      return emitPrimitiveValue(node);
  }
}

/** Emit a complex object, hoisting a string `resourceType` to the front where present. */
function emitComplex(node: FhirComplex): string {
  // A position the sender wrote an array at is written back as that array. The node itself is the
  // empty element the reader had to produce there, so emitting the element would put an object on
  // the wire that no sender wrote.
  if (node.nestedArraySource !== undefined) return node.nestedArraySource;
  // Same for a scalar or `null` there: hand back the text the sender wrote. Emitting the element
  // instead writes `{}`, an object nobody sent, and `{}` reads back as a conformant empty element,
  // so the `UNKNOWN_PROPERTY` the reader raised is gone after one round trip.
  if (node.nonObjectSource !== undefined) return node.nonObjectSource;
  const parts: string[] = [];

  // Hoisting applies only to a `resourceType` that is actually a string, the shape FHIR defines. One
  // that is anything else is emitted through the ordinary path below rather than skipped: skipping
  // it dropped whatever the sender wrote there, which is the loss this writer exists to avoid.
  const rt = node.properties.find((p) => p.name === "resourceType");
  const hoisted = rt !== undefined && isPrimitive(rt.value) && typeof rt.value.value === "string";
  if (hoisted) parts.push(`"resourceType":${JSON.stringify(rt.value.value)}`);

  for (const property of node.properties) {
    if (property.name === "resourceType" && hoisted) continue;
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
 * Serialize a resource (or any {@link FhirComplex}) to compact FHIR JSON text: spec-clean for any
 * model FHIR can express, and faithful rather than spec-clean for the shapes it cannot (see the
 * module comment).
 *
 * @param node - The resource model to serialize.
 * @returns Compact JSON text, decimals byte-exact, primitive metadata split back into `_`-siblings
 *   with null-padded array alignment, and `resourceType` hoisted to the front where it is a string.
 *   A `resourceType` that is anything else keeps its position in the document rather than being
 *   dropped, and an array the sender wrote where FHIR gives an array no meaning, a scalar or
 *   `null` the sender wrote where FHIR has an object, or a `null` the reader marked in a primitive's
 *   value channel, is written back as it was read, so such output is deliberately not spec-clean.
 * @throws {FhirSerializeError} If the model carries a node the XML reader MARKED as having lost
 *   character data. JSON has no character-data channel, so the member would simply be absent and the
 *   `DROPPED_ELEMENT_TEXT` finding would be lost across a round trip. Text the reader drops WITHOUT
 *   marking (character data that is `String.trim()`-empty) is not covered, because there is no marker.
 * @example
 * ```ts
 * import { parseResource, serializeResource } from "@cosyte/fhir";
 * const { resource } = parseResource(input);
 * const json = serializeResource(resource); // round-trips a spec-clean input byte-for-byte
 * ```
 */
export function serializeResource(node: FhirComplex): string {
  assertSerializable(node);
  return emitComplex(node);
}
