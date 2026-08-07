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
 * model carries, verbatim. Its XHTML is not validated, but the string is checked at that branch for
 * the one property splicing it in depends on ({@link emitsOneDivElement}).
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
  refuseUnserializableDivMarkup,
  refuseUnserializableNames,
} from "../codec/serialize-guard.js";
import { childPath, rootPath } from "../model/path.js";
import { FHIR_XML_NAMESPACE } from "./read.js";
import { readRawXml } from "./raw-xml.js";

/**
 * The one mutable thing the writer carries: the locations it refuses, by reason.
 *
 * Collected rather than thrown at the first hit so a caller sees every position in one pass, the
 * same shape {@link assertSerializable} reports. The writer still builds its string; the refusal is
 * raised at the root once the walk is complete, so a partially-built document is never returned.
 */
interface RefusalSink {
  /** Locations whose name cannot be written as a tag ({@link breaksTag}). */
  readonly refusedNames: string[];
  /** `div` locations whose raw markup fails {@link emitsOneDivElement}. */
  readonly refusedDivs: string[];
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
function tag(name: string, path: string, sink: RefusalSink): string {
  if (breaksTag(name)) sink.refusedNames.push(path);
  return name;
}

/**
 * Whether the raw string a `div` property carries would contribute exactly one element to the
 * document, and that element is the `div` the model names.
 *
 * **This is the check at the one site that emits markup rather than a name, and it is stated as the
 * question the site actually has to answer**: `writeItem` splices this string into the document
 * unexamined, so everything it spells becomes markup. `readRawXml` is the same parser
 * {@link parseResourceXml} re-reads the document with, run over the same bytes, so the element
 * STRUCTURE it reports is the structure the re-read sees. Two conditions, and both are load-bearing:
 *
 * - **it parses as a document with exactly one root element.** A string that closes its own element
 *   and opens siblings (`…</div></text><code>…</code><text>`) is trailing content after the root and
 *   fails here. That shape is the reason this exists: it put a SNOMED `716186003` coding into an
 *   `AllergyIntolerance` that asserted nothing, and the re-read affirmed a `no-known-allergy`
 *   negation with no diagnostic at either end.
 * - **that root's local name is `div`.** Well-formedness alone does not settle it, and assuming it
 *   did was one of two wrong guesses recorded against this defect: `<status value="final"/>` is one
 *   perfectly well-formed element, and emitting it for a property named `div` authors a status the
 *   sender never wrote. The **local** name is compared because a prefixed narrative (`<h:div
 *   xmlns:h="…xhtml">`) is a spelling this library reads and round-trips today.
 *
 * **What it does NOT check**, because neither is this defect: which namespace the root is in (an
 * unprefixed `<div>` under no declaration, and a vendor one, both reach `Narrative.div` on the
 * read), and whether a prefix on the root is bound inside the string (an unbound prefix is the
 * separately declared residual on this function's own output). Comments and processing instructions
 * around the root parse as prolog/misc and are accepted: neither is an element.
 *
 * **THE STRUCTURE IS WHAT THIS SETTLES. IT SETTLES NOTHING ELSE, AND THE THREE COUNTEREXAMPLES ARE
 * ASSERTED RATHER THAN LEFT AS A CAVEAT.** (1) `readRawXml` bounds nesting depth, and this check
 * spends that budget from 0 while the re-read spends it from the `div`'s depth in the document: a
 * `div` holding 254 nested elements is accepted here and the emitted document raises
 * `MAX_DEPTH_EXCEEDED` on re-read. Loud, and byte-identical on base. (2) An accepted string need not come back
 * byte-identical: `<div>x</div>` re-reads as `<div xmlns="http://hl7.org/fhir">x</div>`, so the
 * library inserts a declaration the sender did not write, with no diagnostic. (3) An XML declaration
 * is not a processing instruction (XML 1.0 §2.6, §2.8) and is legal only at the start of an entity,
 * but `skipMisc` swallows one, so `<?xml version="1.0"?><div …/>` is accepted here and the emitted
 * document is rejected by a conformant third-party parser. All three are `PRE-EXISTING`.
 *
 * @param value - The raw string a `div` property carries.
 * @returns `true` when the string may be written verbatim.
 */
function emitsOneDivElement(value: string): boolean {
  let name: string;
  try {
    name = readRawXml(value).name;
  } catch {
    return false; // not one well-formed element: unbalanced, multi-root, a DTD, an undefined entity.
  }
  const colon = name.indexOf(":");
  return (colon === -1 ? name : name.slice(colon + 1)) === "div";
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
  sink: RefusalSink,
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
  sink: RefusalSink,
): string {
  // A narrative `Narrative.div` is carried as its full opaque XHTML string (matching FHIR JSON); emit
  // it verbatim so the output is conformant `<div xmlns="…">…</div>`, never an escaped attribute.
  // THIS IS THE ONE SITE THAT WRITES MARKUP RATHER THAN A NAME, so `tag()` cannot cover it and
  // `emitsOneDivElement` is its counterpart: the string is checked here, at the site that splices it
  // in, for the only property that makes it safe to splice: that it spells the one `div` element
  // this property names. Not scoped to `Narrative`: any property named `div`, at any depth in any
  // resource, takes this branch, which is why the check is on the branch and not on a resource type.
  // Nothing is repaired: a string that fails is recorded and the refusal is raised at the root, so
  // the forged markup is never built into the returned document.
  if (name === "div" && node.kind === "primitive" && typeof node.value === "string") {
    if (emitsOneDivElement(node.value)) return node.value;
    sink.refusedDivs.push(path);
    return "";
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
  sink: RefusalSink,
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
  sink: RefusalSink,
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
 * ## The `div` branch, which writes markup rather than a name
 *
 * A `div` property is written back as its own raw string, so what that string spells is markup in
 * the output. `emitsOneDivElement` is checked at that branch before the string is spliced in, and
 * the string is written only when it parses as exactly one element whose local name is `div`; a
 * string that fails raises `UNSERIALIZABLE_DIV_MARKUP` below. The shape that check exists for is
 * `<div xmlns="…xhtml">ok</div></text><code><coding>…716186003…</coding></code><text>` on an
 * `AllergyIntolerance`: it used to be spliced in whole, and the emitted document re-read with
 * `noKnownAllergy: true` and a `no-known-allergy` negation over a record that had asserted nothing,
 * with no diagnostic at either end and `readSafety` affirming it.
 *
 * **What passing that check does and does not settle, by example rather than by rule.** A string it
 * accepts contributes one element, and that element is the `div`; it is not a claim that the round
 * trip is lossless or that the output is well-formed from there. `<v:div>x</v:div>` carrying no
 * binding for `v` is accepted, and the emitted document re-reads it as a property named `v:div`
 * rather than as the narrative, which is the same unbound-prefix residual the paragraph above
 * declares for names. A comment beside the root (`<!--c--><div …/>`) is accepted and does not
 * survive the re-read. `emitsOneDivElement` carries three more counterexamples, each `PRE-EXISTING`
 * and each asserted rather than argued: a depth bound this check spends from a different starting
 * depth than the re-read, an inserted namespace declaration, and an XML declaration a conformant
 * third-party parser rejects.
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
 *   rather than reports. {@link serializeResource} escapes a member name, so this refusal never
 *   reaches it and that route stays open (which is not the same as saying the JSON output is
 *   spec-clean: this function's own exception list still applies to the rest of the model).
 * @throws {FhirSerializeError} With `UNSERIALIZABLE_DIV_MARKUP` if a `div` property carries a string
 *   that would not be spliced in as the one `div` element the property names. It would carry other
 *   elements into the document, or leave markup that does not re-read. Refused rather than repaired
 *   for the same reason as a name: escaping it would author a text node where the sender wrote
 *   markup, and splicing it authors elements the sender never wrote. {@link serializeResource}
 *   carries the string as a string, so this refusal never reaches it and that route stays open.
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
  const sink: RefusalSink = { refusedNames: [], refusedDivs: [] };
  const xml = writeElement(rootPath(tagName), tagName, node, true, false, sink);
  // Names first, which is the order base raised them in, so a model that trips both keeps the code
  // it already reported. Both are raised after the walk, so neither returns a half-built document.
  if (sink.refusedNames.length > 0) refuseUnserializableNames([...new Set(sink.refusedNames)]);
  if (sink.refusedDivs.length > 0) refuseUnserializableDivMarkup([...new Set(sink.refusedDivs)]);
  return xml;
}
