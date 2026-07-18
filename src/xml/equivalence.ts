/**
 * Cross-format model equivalence — the oracle for "the same resource in XML and in JSON parses to the
 * same model" (roadmap Phase 8: *JSON↔XML model equivalence*).
 *
 * The JSON and XML readers produce the **same** {@link FhirNode} model, but two differences are
 * irreducible without a datatype schema (which the schema-free codec deliberately does not consult),
 * so equivalence is defined *modulo* them — and only them:
 *
 * 1. **Lexical primitive form.** JSON has native `true`/`false` and number tokens, so its reader yields
 *    a boolean or a {@link ../model/decimal.js FhirDecimal}; XML carries every primitive as the string
 *    of its `value` attribute. `true` ≡ `"true"` and `FhirDecimal("0.010")` ≡ `"0.010"` — compared by
 *    their canonical lexical text. (Decimal precision is preserved either way: the string is never
 *    routed through a `number`.)
 * 2. **Singleton lists.** FHIR JSON always encodes a repeatable element as an array, so a single
 *    occurrence is a one-item list; FHIR XML repeats elements, so a single occurrence is one element
 *    (a single node). A one-item {@link ../model/node.js FhirList} is therefore equivalent to its sole
 *    item. A multi-item list matches element-for-element.
 *
 * Everything else must match exactly: property names **and order**, nesting, `id`, and extensions. The
 * comparison is value-free in spirit — it inspects structure and lexical form, and is used in tests and
 * by consumers verifying a transcode, not to build a PHI-carrying diff.
 *
 * **Two schema-free corner cases** where the two readers legitimately diverge (and equivalence does
 * *not* paper over them — they are honest limitations, not silent passes):
 *
 * - An **extension-only element with no value** — `<x><extension …/></x>` in XML vs `{"x":{…}}` (a
 *   complex) vs `{"_x":{…}}` (a value-absent primitive) in JSON. Without a datatype schema the XML
 *   reader cannot tell a value-absent *primitive* from a *complex* that happens to hold only an
 *   extension, and models it as a primitive; the JSON form disambiguates via the `_`-sibling. Such a
 *   pair may compare non-equivalent. It is the safe direction (no data is lost; XML→XML round-trips).
 * - **Narrative `<div>`** — carried as an opaque XHTML string on both sides, so two narratives compare
 *   equivalent only when their XHTML text is byte-identical (XHTML has insignificant whitespace the
 *   codec does not normalize across formats).
 *
 * @packageDocumentation
 */

import type { FhirComplex, FhirNode, FhirPrimitive, PrimitiveValue } from "../model/node.js";

/** The canonical lexical text of a primitive value (`undefined` stays `undefined`). */
function canonicalScalar(value: PrimitiveValue | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  return value.raw; // FhirDecimal
}

/** Unwrap a one-item list to its sole item, repeatedly (a singleton list ≡ its element — see module doc). */
function unwrapSingleton(node: FhirNode): FhirNode {
  let current = node;
  while (current.kind === "list" && current.items.length === 1) {
    const only = current.items[0];
    if (only === undefined) break; // unreachable (length === 1)
    current = only;
  }
  return current;
}

/** Whether two extension arrays (a primitive's `id`/`extension` metadata) are equivalent. */
function extensionsEquivalent(
  a: readonly FhirComplex[] | undefined,
  b: readonly FhirComplex[] | undefined,
): boolean {
  const left = a ?? [];
  const right = b ?? [];
  if (left.length !== right.length) return false;
  return left.every((ext, i) => {
    const other = right[i];
    return other !== undefined && nodesEquivalent(ext, other);
  });
}

/** Whether two primitives are equivalent (canonical value, `id`, and extensions). */
function primitivesEquivalent(a: FhirPrimitive, b: FhirPrimitive): boolean {
  return (
    canonicalScalar(a.value) === canonicalScalar(b.value) &&
    a.id === b.id &&
    extensionsEquivalent(a.extension, b.extension)
  );
}

/** Whether two complexes are equivalent (same property names, in the same order, with equivalent values). */
function complexesEquivalent(a: FhirComplex, b: FhirComplex): boolean {
  if (a.properties.length !== b.properties.length) return false;
  return a.properties.every((property, i) => {
    const other = b.properties[i];
    return (
      other !== undefined &&
      property.name === other.name &&
      nodesEquivalent(property.value, other.value)
    );
  });
}

/**
 * Whether two model nodes are equivalent modulo primitive lexical form and singleton lists — the
 * definition of JSON↔XML model equivalence (see the module doc). Reflexive, symmetric, and transitive
 * over the schema-free model.
 *
 * @param a - One node (e.g. the model parsed from JSON).
 * @param b - The other node (e.g. the model parsed from the same resource in XML).
 * @returns `true` when the two denote the same FHIR content.
 * @example
 * ```ts
 * import { parseResource, parseResourceXml, nodesEquivalent } from "@cosyte/fhir";
 * const json = parseResource('{"resourceType":"Patient","active":true,"name":[{"given":["Jane"]}]}');
 * const xml = parseResourceXml(
 *   '<Patient xmlns="http://hl7.org/fhir"><active value="true"/><name><given value="Jane"/></name></Patient>',
 * );
 * nodesEquivalent(json.resource, xml.resource); // true
 * ```
 */
export function nodesEquivalent(a: FhirNode, b: FhirNode): boolean {
  const left = unwrapSingleton(a);
  const right = unwrapSingleton(b);
  if (left.kind === "primitive" && right.kind === "primitive") {
    return primitivesEquivalent(left, right);
  }
  if (left.kind === "complex" && right.kind === "complex") {
    return complexesEquivalent(left, right);
  }
  if (left.kind === "list" && right.kind === "list") {
    if (left.items.length !== right.items.length) return false;
    return left.items.every((item, i) => {
      const other = right.items[i];
      return other !== undefined && nodesEquivalent(item, other);
    });
  }
  return false;
}
