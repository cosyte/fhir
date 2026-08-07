/**
 * The XML write path: the {@link FhirNode} model → spec-clean FHIR XML text (xml.html).
 *
 * The writer is the conservative half of Postel's Law, and for a model read from a conformant
 * document it emits canonical FHIR XML, the exact inverse of {@link ./read.js}:
 *
 * - a resource complex is emitted as an element named by its `resourceType` (the property itself is
 *   not emitted, it *is* the tag), and the root carries the FHIR default namespace;
 * - a primitive's value becomes the `value` attribute, its `id` an `id` attribute, and its extensions
 *   child `<extension>` elements, the XML co-location of the JSON `_`-sibling;
 * - `Resource.id` is emitted as a child `<id value="…"/>` element while `Element.id` is an attribute,
 *   and `Extension.url` is emitted as the `url` attribute, exactly matching how the reader consumes them;
 * - a list emits one element per item (repeating elements); a resource-valued element wraps the inner
 *   resource (`<contained><Patient>…</Patient></contained>`).
 *
 * Output is compact (no insignificant whitespace), so a spec-clean document round-trips **byte-for-byte**
 * through {@link ./read.js}. A decimal value is emitted from its exact lexical text and never routes
 * through a JavaScript `number`. Narrative `<div>` XHTML is written back as the opaque string the
 * model carries, verbatim and unchecked.
 *
 * **It refuses exactly one thing: a NAME that breaks the tag it is written into.** That is a rule
 * about names and nothing wider. `serializeResourceXml` lists what it does not cover.
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
import {
  assertSerializable,
  breaksTag,
  refuseUnserializableNames,
} from "../codec/serialize-guard.js";
import { childPath, rootPath } from "../model/path.js";
import { FHIR_XML_NAMESPACE } from "./read.js";

/**
 * The one mutable thing the writer carries: the locations whose name cannot be written as a tag.
 *
 * Collected rather than thrown at the first hit so a caller sees every position in one pass, the
 * same shape {@link assertSerializable} reports. The writer still builds its string; the refusal is
 * raised at the root once the walk is complete, so a partially-built document is never returned.
 */
interface TagNameSink {
  readonly refused: string[];
}

/**
 * Test one tag name, at the site that is about to write it, and record its bounded location.
 *
 * **This is called from every site that puts a name in a tag position and from no other site, which
 * is what keeps it from drifting away from what the writer emits.** A pre-pass walker would have to
 * re-derive the writer's own branching (which names become attributes, which become the tag, which
 * are dropped), and that duplicate would be free to disagree. If you add a branch that writes a tag,
 * call this from it.
 *
 * @returns The name, unchanged, so a caller can write `<${tag(...)}>` inline.
 */
function tag(name: string, path: string, sink: TagNameSink): string {
  if (breaksTag(name)) sink.refused.push(path);
  return name;
}

/** Serialize a scalar primitive value to its lexical text (decimal from exact `raw`, never a `number`). */
function scalarText(value: PrimitiveValue): string {
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  return value.raw; // FhirDecimal, exact lexical form (ADR 0001).
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

/** The `resourceType` of a complex (its string value), if it carries one, i.e. it is a resource. */
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
function writePrimitiveElement(
  path: string,
  name: string,
  node: FhirPrimitive,
  sink: TagNameSink,
): string {
  const tagName = tag(name, path, sink);
  let attrs = "";
  if (node.id !== undefined) attrs += ` id="${escapeAttr(node.id)}"`;
  if (node.value !== undefined) attrs += ` value="${escapeAttr(scalarText(node.value))}"`;
  const extensions = node.extension ?? [];
  if (extensions.length === 0) return `<${tagName}${attrs}/>`;
  const extensionPath = childPath(path, "extension");
  const inner = extensions
    .map((ext, index) =>
      writeElement(`${extensionPath}[${String(index)}]`, "extension", ext, false, true, sink),
    )
    .join("");
  return `<${tagName}${attrs}>${inner}</${tagName}>`;
}

/** Emit one item of a property (a single node), naming its element `name`. */
function writeItem(
  path: string,
  name: string,
  node: FhirNode,
  inExtension: boolean,
  sink: TagNameSink,
): string {
  // A narrative `Narrative.div` is carried as its full opaque XHTML string (matching FHIR JSON); emit
  // it verbatim so the output is conformant `<div xmlns="…">…</div>`, never an escaped attribute.
  // 🔴 THIS IS THE ONE MARKUP-EMITTING SITE `tag()` DOES NOT COVER: the string is emitted unexamined,
  // so markup inside it reaches the document. `serializeResourceXml`'s docblock carries the three
  // measured shapes and `test/xml-tag-name.test.ts` pins them. Not scoped to `Narrative`: any
  // property named `div`, at any depth, takes this branch.
  if (name === "div" && node.kind === "primitive" && typeof node.value === "string") {
    return node.value;
  }
  if (node.kind === "primitive") return writePrimitiveElement(path, name, node, sink);
  if (node.kind === "list")
    return node.items
      .map((item, index) => writeItem(`${path}[${String(index)}]`, name, item, inExtension, sink))
      .join("");
  const rt = resourceTypeOf(node);
  if (rt !== undefined) {
    // Resource-valued element: wrap the inner resource (`<name><ResourceType>…</ResourceType></name>`).
    const tagName = tag(name, path, sink);
    return `<${tagName}>${writeElement(path, rt, node, false, false, sink)}</${tagName}>`;
  }
  return writeElement(path, name, node, false, inExtension, sink);
}

/** Emit a property (single or list) as one-or-more elements named `name`. */
function writeProperty(
  parentPath: string,
  name: string,
  node: FhirNode,
  inExtension: boolean,
  sink: TagNameSink,
): string {
  const path = childPath(parentPath, name);
  if (node.kind === "list")
    return node.items
      .map((item, index) => writeItem(`${path}[${String(index)}]`, name, item, inExtension, sink))
      .join("");
  return writeItem(path, name, node, inExtension, sink);
}

/**
 * Emit a complex element `<tagName …>…</tagName>`. `isRoot` adds the FHIR default namespace;
 * `inExtension` routes an `Extension.url` property to the `url` attribute. `Element.id` becomes an
 * `id` attribute unless the complex is itself a resource (then `id` is a child element).
 */
function writeElement(
  path: string,
  tagName: string,
  node: FhirComplex,
  isRoot: boolean,
  inExtension: boolean,
  sink: TagNameSink,
): string {
  const written = tag(tagName, path, sink);
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
    children.push(writeProperty(path, name, value, childInExtension, sink));
  }

  attrs += idAttr + urlAttr;
  const inner = children.join("");
  return inner === "" ? `<${written}${attrs}/>` : `<${written}${attrs}>${inner}</${written}>`;
}

/**
 * Serialize a resource (or any {@link FhirComplex}) to spec-clean, compact FHIR XML text, the exact
 * inverse of {@link parseResourceXml}. Decimals are emitted byte-exact (never through a `number`),
 * primitive metadata is co-located (`id` attribute + child `<extension>`s), repeating elements are
 * repeated, and the root carries the FHIR namespace.
 *
 * ## What this output is NOT guaranteed to be, stated rather than implied
 *
 * "Spec-clean" is a claim about the FHIR structure, not about namespace well-formedness, and the
 * gap is real for a model that carries content FHIR cannot spell. A property name carrying a
 * **prefix** is written verbatim with no declaration to bind it (`<v:x value="1"/>`), because the
 * binding was never modeled; a name that is not a conformant XML name at all is written verbatim
 * too (`<a&b/>`, `<1abc/>`). Both re-read through {@link parseResourceXml} exactly as written, and
 * both are rejected by a conformant third-party parser. They are not refused precisely because this
 * library's own round trip does survive them, and refusing would withdraw that from models it reads
 * as valid. What IS refused is the subset where nothing survives; see the `@throws` below.
 *
 * ## 🔴 The bigger gap in this function, which the refusal above does NOT cover
 *
 * **A `div` property is written back as its own raw string, examined by nothing, so markup inside it
 * is markup in the output.** Measured, and no remedy is proposed here on purpose:
 *
 * - a `div` on an `AllergyIntolerance` spelled
 *   `<div xmlns="…xhtml">ok</div></text><code><coding>…716186003…</coding></code><text>` re-reads
 *   with `noKnownAllergy: true` and a `no-known-allergy` negation over a record that asserted
 *   nothing, with no diagnostic at either end and `readSafety` affirming it;
 * - the branch keys on the name `div` alone, at any depth in any resource, so an `Observation` with
 *   a `div` member spelled `<status value="final"/>` emits exactly that and re-reads with a status
 *   it never had;
 * - `{"div":"v"}` emits `<Patient …>v</Patient>`, which re-reads with the property gone, one
 *   `UNEXPECTED_XML_CONTENT` warning and `safeToSummarize: false`.
 *
 * Older than the name refusal above and not closed by it. Pinned by `test/xml-tag-name.test.ts`.
 *
 * @param node - The resource model to serialize (must carry a `resourceType` to name the root element).
 * @returns Canonical FHIR XML text.
 * @throws {FhirSerializeError} With `DROPPED_ELEMENT_TEXT` if the model carries a node the reader
 *   MARKED as having lost character data. There is no conformant XML for it (§2.6.1: an element
 *   present in the resource SHALL have a value attribute, child elements, or extensions), and
 *   emitting the element as unfilled would lose the `DROPPED_ELEMENT_TEXT` finding across a round
 *   trip. Text the reader drops WITHOUT marking (character data that is `String.trim()`-empty) is
 *   not covered, because there is no marker.
 * @throws {FhirSerializeError} With `UNSERIALIZABLE_ELEMENT_NAME` if any tag position holds a name
 *   that cannot be written as a tag without changing which elements the document holds: it would
 *   either fail to re-read at all, or re-read as DIFFERENT elements. The second is why this refuses
 *   rather than reports. {@link serializeResource} encodes every such model correctly, and is the
 *   route that stays open.
 * @example
 * ```ts
 * import { parseResource, serializeResourceXml } from "@cosyte/fhir";
 * const { resource } = parseResource('{"resourceType":"Patient","active":true}');
 * serializeResourceXml(resource);
 * // → '<Patient xmlns="http://hl7.org/fhir"><active value="true"/></Patient>'
 * ```
 */
export function serializeResourceXml(node: FhirComplex): string {
  assertSerializable(node);
  const rt = resourceTypeOf(node);
  const tagName = rt ?? "Resource";
  const sink: TagNameSink = { refused: [] };
  const xml = writeElement(rootPath(tagName), tagName, node, true, false, sink);
  if (sink.refused.length > 0) refuseUnserializableNames([...new Set(sink.refused)]);
  return xml;
}
