/**
 * The XML write path: the {@link FhirNode} model → spec-clean FHIR XML text (roadmap Phase 8, xml.html).
 *
 * The writer is the conservative half of Postel's Law — it always emits well-formed, canonical FHIR
 * XML, the exact inverse of {@link ./read.js}:
 *
 * - a resource complex is emitted as an element named by its `resourceType` (the property itself is
 *   not emitted — it *is* the tag), and the root carries the FHIR default namespace;
 * - a primitive's value becomes the `value` attribute, its `id` an `id` attribute, and its extensions
 *   child `<extension>` elements — the XML co-location of the JSON `_`-sibling;
 * - `Resource.id` is emitted as a child `<id value="…"/>` element while `Element.id` is an attribute,
 *   and `Extension.url` is emitted as the `url` attribute, exactly matching how the reader consumes them;
 * - a list emits one element per item (repeating elements); a resource-valued element wraps the inner
 *   resource (`<contained><Patient>…</Patient></contained>`).
 *
 * Output is compact (no insignificant whitespace), so a spec-clean document round-trips **byte-for-byte**
 * through {@link ./read.js}. A decimal value is emitted from its exact lexical text and never routes
 * through a JavaScript `number` (ADR 0001). Narrative `<div>` XHTML is deferred (Phase 8) and is not
 * produced by the writer.
 *
 * @packageDocumentation
 */

import {
  isPrimitive,
  type FhirComplex,
  type FhirNode,
  type FhirPrimitive,
  type PrimitiveValue,
} from "../model/node.js";
import { FHIR_XML_NAMESPACE } from "./read.js";

/** Serialize a scalar primitive value to its lexical text (decimal from exact `raw` — never a `number`). */
function scalarText(value: PrimitiveValue): string {
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  return value.raw; // FhirDecimal — exact lexical form (ADR 0001).
}

/** Escape a string for use inside a double-quoted XML attribute value (round-trip-safe). */
function escapeAttr(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\t/g, "&#9;")
    .replace(/\n/g, "&#10;")
    .replace(/\r/g, "&#13;");
}

/** The `resourceType` of a complex (its string value), if it carries one — i.e. it is a resource. */
function resourceTypeOf(node: FhirComplex): string | undefined {
  const property = node.properties.find((p) => p.name === "resourceType");
  if (
    property !== undefined &&
    isPrimitive(property.value) &&
    typeof property.value.value === "string"
  ) {
    return property.value.value;
  }
  return undefined;
}

/** The scalar text of a primitive-valued property, for emission as an attribute (`id` / `url`). */
function attributeText(node: FhirNode): string | undefined {
  if (isPrimitive(node) && node.value !== undefined) return escapeAttr(scalarText(node.value));
  return undefined;
}

/** Emit a primitive as a property element: `<name id? value?/>`, with child `<extension>`s if any. */
function writePrimitiveElement(name: string, node: FhirPrimitive): string {
  let attrs = "";
  if (node.id !== undefined) attrs += ` id="${escapeAttr(node.id)}"`;
  if (node.value !== undefined) attrs += ` value="${escapeAttr(scalarText(node.value))}"`;
  const extensions = node.extension ?? [];
  if (extensions.length === 0) return `<${name}${attrs}/>`;
  const inner = extensions.map((ext) => writeElement("extension", ext, false, true)).join("");
  return `<${name}${attrs}>${inner}</${name}>`;
}

/** Emit one item of a property (a single node), naming its element `name`. */
function writeItem(name: string, node: FhirNode, inExtension: boolean): string {
  // A narrative `Narrative.div` is carried as its full opaque XHTML string (matching FHIR JSON); emit
  // it verbatim so the output is conformant `<div xmlns="…">…</div>`, never an escaped attribute.
  if (name === "div" && node.kind === "primitive" && typeof node.value === "string") {
    return node.value;
  }
  if (node.kind === "primitive") return writePrimitiveElement(name, node);
  if (node.kind === "list")
    return node.items.map((item) => writeItem(name, item, inExtension)).join("");
  const rt = resourceTypeOf(node);
  if (rt !== undefined) {
    // Resource-valued element: wrap the inner resource (`<name><ResourceType>…</ResourceType></name>`).
    return `<${name}>${writeElement(rt, node, false, false)}</${name}>`;
  }
  return writeElement(name, node, false, inExtension);
}

/** Emit a property (single or list) as one-or-more elements named `name`. */
function writeProperty(name: string, node: FhirNode, inExtension: boolean): string {
  if (node.kind === "list")
    return node.items.map((item) => writeItem(name, item, inExtension)).join("");
  return writeItem(name, node, inExtension);
}

/**
 * Emit a complex element `<tagName …>…</tagName>`. `isRoot` adds the FHIR default namespace;
 * `inExtension` routes an `Extension.url` property to the `url` attribute. `Element.id` becomes an
 * `id` attribute unless the complex is itself a resource (then `id` is a child element).
 */
function writeElement(
  tagName: string,
  node: FhirComplex,
  isRoot: boolean,
  inExtension: boolean,
): string {
  const isResource = resourceTypeOf(node) !== undefined;
  let attrs = isRoot ? ` xmlns="${FHIR_XML_NAMESPACE}"` : "";
  let idAttr = "";
  let urlAttr = "";
  const children: string[] = [];

  for (const property of node.properties) {
    const { name, value } = property;
    if (name === "resourceType") continue; // it is the tag name, not a child.
    if (name === "id" && !isResource) {
      const text = attributeText(value);
      if (text !== undefined) idAttr = ` id="${text}"`;
      continue;
    }
    if (name === "url" && inExtension) {
      const text = attributeText(value);
      if (text !== undefined) urlAttr = ` url="${text}"`;
      continue;
    }
    const childInExtension = name === "extension" || name === "modifierExtension";
    children.push(writeProperty(name, value, childInExtension));
  }

  attrs += idAttr + urlAttr;
  const inner = children.join("");
  return inner === "" ? `<${tagName}${attrs}/>` : `<${tagName}${attrs}>${inner}</${tagName}>`;
}

/**
 * Serialize a resource (or any {@link FhirComplex}) to spec-clean, compact FHIR XML text — the exact
 * inverse of {@link parseResourceXml}. Decimals are emitted byte-exact (never through a `number`),
 * primitive metadata is co-located (`id` attribute + child `<extension>`s), repeating elements are
 * repeated, and the root carries the FHIR namespace.
 *
 * @param node - The resource model to serialize (must carry a `resourceType` to name the root element).
 * @returns Canonical FHIR XML text.
 * @example
 * ```ts
 * import { parseResource, serializeResourceXml } from "@cosyte/fhir";
 * const { resource } = parseResource('{"resourceType":"Patient","active":true}');
 * serializeResourceXml(resource);
 * // → '<Patient xmlns="http://hl7.org/fhir"><active value="true"/></Patient>'
 * ```
 */
export function serializeResourceXml(node: FhirComplex): string {
  const rt = resourceTypeOf(node);
  const tagName = rt ?? "Resource";
  return writeElement(tagName, node, true, false);
}
