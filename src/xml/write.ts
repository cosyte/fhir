/**
 * The XML write path: the {@link FhirNode} model → compact FHIR XML text (xml.html).
 *
 * **The output is NOT unconditionally spec-clean, and this line used to say it was.** A tag name the
 * writer writes that is not an XML 1.0 `Name` (`a&b`, `1abc`) is refused rather than written, and so
 * is an attribute value or a spliced `div` string carrying a code point outside `Char`. A name
 * carrying a colon is refused too, and so is a narrative `div` string whose own markup names a prefix
 * nothing inside it binds. That is not every way a strict processor can reject the output: an element
 * or attribute name inside a `div` string is checked for `Char` and never for `Name`, and the `div`
 * branch carries three more counterexamples. They are enumerated on {@link serializeResourceXml},
 * with the refusals, and this header deliberately keeps no second copy.
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
 * through {@link ./read.js}. **That is scoped to a spec-clean document and must stay scoped**: a
 * narrative `<div>x</div>` carrying no XHTML namespace comes back as
 * `<div xmlns="http://hl7.org/fhir">x</div>`, a declaration the sender never wrote.
 * A decimal value is emitted from its exact lexical text and never routes
 * through a JavaScript `number`. Narrative `<div>` XHTML is written back as the opaque string the
 * model carries, verbatim. Its XHTML is not validated, but the string is checked at that branch for
 * the two properties splicing it in depends on: that it spells the one `div` element the property
 * names ({@link emitsOneDivElement}), and that every prefix its markup names is bound inside it
 * ({@link bindsEveryPrefix}).
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
  assertNoShadowedProperty,
  assertSerializable,
  assertXmlArrayWrapper,
  assertXmlForeignRoot,
  assertXmlResourceType,
  assertXmlSerializable,
  assertXmlValueChoiceWrapper,
  breaksTag,
  carriesNonXmlCharacter,
  carriesUndeclarablePrefix,
  isXmlName,
  refuseNonXmlCharacters,
  refuseNonXmlNames,
  refuseUnboundDivPrefixes,
  refuseUndeclarablePrefixes,
  refuseUnserializableDivMarkup,
  refuseUnserializableNames,
} from "../codec/serialize-guard.js";
import { childPath, rootPath } from "../model/path.js";
import { FHIR_XML_NAMESPACE } from "./read.js";
import { readRawXml, type XmlElement } from "./raw-xml.js";

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
  /** Locations whose name carries a colon no declaration here can bind ({@link carriesUndeclarablePrefix}). */
  readonly refusedPrefixes: string[];
  /** `div` locations whose markup names a prefix nothing inside the string binds ({@link bindsEveryPrefix}). */
  readonly refusedDivPrefixes: string[];
  /** Locations whose name is not an XML 1.0 `Name` and failed neither question before ({@link isXmlName}). */
  readonly refusedXmlNames: string[];
  /** Locations whose emitted value or `div` string carries a non-`Char` ({@link carriesNonXmlCharacter}). */
  readonly refusedCharacters: string[];
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
 * Three questions are asked of the name, and a name is recorded under the first it fails only: does
 * it break the tag ({@link breaksTag}), does it carry a colon this writer cannot declare a binding
 * for ({@link carriesUndeclarablePrefix}), and is it an XML 1.0 `Name` ({@link isXmlName}). A name
 * failing more than one keeps the code of the earliest, which is the code it drew before the later
 * questions existed.
 *
 * @returns The name, unchanged, so a caller can write `<${tag(...)}>` inline.
 */
function tag(name: string, path: string, sink: RefusalSink): string {
  if (breaksTag(name)) sink.refusedNames.push(path);
  else if (carriesUndeclarablePrefix(name)) sink.refusedPrefixes.push(path);
  else if (!isXmlName(name)) sink.refusedXmlNames.push(path);
  return name;
}

/**
 * Test one attribute value, at the site that is about to write it, and return it escaped.
 *
 * **Called from every site that writes a value into an attribute and from no other**, for the same
 * reason {@link tag} is: a pre-pass would have to re-derive which values the writer emits (an `id` is
 * an attribute on an element and a child element on a resource, a `url` only inside an extension),
 * and that copy would be free to disagree. A value carrying a code point outside XML 1.0 `Char`
 * ({@link carriesNonXmlCharacter}) records `path`, the location of the value, and is still escaped
 * and returned, because the refusal is raised at the root and the string is never returned.
 */
function attributeValue(text: string, path: string, sink: RefusalSink): string {
  if (carriesNonXmlCharacter(text)) sink.refusedCharacters.push(path);
  return escapeAttr(text);
}

/**
 * Whether any text or attribute value the parse of a `div` string decoded carries a code point
 * outside XML 1.0 `Char`. Asked after the raw string itself passed that question, so what this finds
 * came from a numeric character reference (`&#0;`, `&#x1F;`), which XML 1.0's Legal Character
 * constraint makes a fatal error. A comment or a processing instruction is not decoded by the parse
 * and does not reach this, which is right: a reference is not recognised inside either.
 */
function decodesNonXmlCharacter(element: XmlElement): boolean {
  if (element.attributes.some(({ value }) => carriesNonXmlCharacter(value))) return true;
  return element.children.some((child) =>
    child.type === "text" ? carriesNonXmlCharacter(child.value) : decodesNonXmlCharacter(child),
  );
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
 * **What it does NOT check**, because none of it is this defect: which namespace the root is in (an
 * unprefixed `<div>` under no declaration, and a vendor one, both reach `Narrative.div` on the
 * read), whether a prefix the markup names is bound inside the string, and whether the string
 * carries a code point outside XML 1.0 `Char`. The second is asked next, of this same parse and only
 * of a string that passes here, by {@link bindsEveryPrefix}, on a code of its own: an unbound prefix
 * is the value route of the residual the colon refusal closes at the tag sites, which that refusal
 * cannot reach because this site writes a value, not a name. The third is asked after that, of the
 * raw string and of what this parse decoded ({@link decodesNonXmlCharacter}), on a code of its own
 * again. A string that fails here keeps `UNSERIALIZABLE_DIV_MARKUP` whatever prefix or character it
 * carries. Comments and processing instructions around the root parse as prolog/misc and are
 * accepted: neither is an element.
 *
 * **THE STRUCTURE IS WHAT THIS SETTLES. IT SETTLES NOTHING ELSE, AND THE COUNTEREXAMPLES BELOW ARE
 * ASSERTED RATHER THAN LEFT AS A CAVEAT. They are examples, not an enumeration.** `readRawXml`
 * bounds nesting depth, and this check
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
 * @returns The string's root element when the string spells the one `div` element the property
 *   names, so the branch can ask its next question ({@link bindsEveryPrefix}) of the same parse;
 *   `undefined` when it does not.
 */
function emitsOneDivElement(value: string): XmlElement | undefined {
  let root: XmlElement;
  try {
    root = readRawXml(value);
  } catch {
    return undefined; // not one well-formed element: unbalanced, multi-root, a DTD, an undefined entity.
  }
  const colon = root.name.indexOf(":");
  return (colon === -1 ? root.name : root.name.slice(colon + 1)) === "div" ? root : undefined;
}

/** The prefix Namespaces in XML 1.0 §3 binds by definition, so a name may use it undeclared. */
const XML_PREFIX = "xml";

/** The prefix Namespaces in XML 1.0 §3 reserves for declarations: it binds nothing a name may use. */
const XMLNS_PREFIX = "xmlns";

/** How a prefix-declaring attribute's name begins (`xmlns:p="…"`). */
const DECLARATION = `${XMLNS_PREFIX}:`;

/** The prefixes a `div` string's root inherits from inside the string: none. */
const NOTHING_BOUND: ReadonlySet<string> = new Set();

/**
 * The prefixes in scope on `element`: what it inherited from enclosing elements inside the string,
 * plus what its own `xmlns:p` attributes declare. A declaration with an empty value binds nothing
 * (Namespaces in XML 1.0 §3 forbids it, and 1.1 reads it as undeclaring the prefix), so under either
 * reading the prefix is out of scope from that element down.
 */
function prefixesInScope(element: XmlElement, inherited: ReadonlySet<string>): ReadonlySet<string> {
  const declarations = element.attributes.filter(({ name }) => name.startsWith(DECLARATION));
  if (declarations.length === 0) return inherited;
  const scope = new Set(inherited);
  for (const { name, value } of declarations) {
    const prefix = name.slice(DECLARATION.length);
    if (value === "") scope.delete(prefix);
    else scope.add(prefix);
  }
  return scope;
}

/**
 * Whether one element or attribute name is namespace-well-formed under `scope`: it carries no colon,
 * or exactly one, between a non-empty prefix and a non-empty local part, and the prefix is `xml` or
 * in scope. `xmlns` is never accepted as a prefix here, whatever was declared: an element name MUST
 * NOT carry it (§3), and on an attribute it marks a declaration, which the caller does not ask about.
 */
function nameIsBound(name: string, scope: ReadonlySet<string>): boolean {
  const colon = name.indexOf(":");
  if (colon === -1) return true;
  const prefix = name.slice(0, colon);
  const local = name.slice(colon + 1);
  if (prefix === "" || prefix === XMLNS_PREFIX || local === "" || local.includes(":")) return false;
  return prefix === XML_PREFIX || scope.has(prefix);
}

/**
 * Whether every element and attribute name a `div` string's markup carries names only prefixes that
 * a declaration inside the string binds, so splicing the string in keeps the output
 * namespace-well-formed.
 *
 * **This is the value route of the unbound-prefix residual, closed at the site that splices the
 * value in.** The tag-site colon refusal ({@link carriesUndeclarablePrefix}) asks its question of a
 * NAME, and this branch writes a STRING, so it never reached one: `<v:div>x</v:div>` passes
 * {@link emitsOneDivElement} (one element, local name `div`), was spliced in with nothing binding
 * `v`, and the emitted document, which a conformant parser rejects, re-read here with the narrative
 * turned into a property named `v:div`.
 *
 * **The line is the one the tag-site refusal draws, namespace-well-formedness.** Namespaces in XML
 * 1.0 (Third Edition) §5, Prefix Declared: "The namespace prefix, unless it is xml or xmlns, MUST
 * have been declared in a namespace declaration attribute in either the start-tag of the element
 * where the prefix is used or in an ancestor element"; §7: "All element and attribute names contain
 * either zero or one colon"; §3: "The prefix xml is by definition bound", and "Element names MUST NOT
 * have the prefix xmlns". The ancestors that count are the ones inside the string, because the
 * string is all this branch splices in and the document around it is the skeleton this writer
 * authors, which declares no prefix. So every element and attribute name carrying a colon must split
 * at its one colon into a non-empty local part and a prefix that is `xml`, or that an `xmlns:p`
 * attribute on that element or an enclosing one inside the string binds. An `xmlns` or `xmlns:p`
 * attribute is a declaration, not a prefixed name, and is not asked. An unbound prefix on an inner
 * element or an attribute is refused as well as one on the root.
 *
 * **Asked only of a string {@link emitsOneDivElement} accepted, and of the tree it parsed**, so a
 * string that fails that check keeps `UNSERIALIZABLE_DIV_MARKUP` whatever prefix it names. The walk
 * goes no deeper than that parse did, which `readRawXml` bounds.
 *
 * **What it costs, stated rather than implied: it withdraws an XML write from models that read
 * `valid: true`**, and for an inner prefix from a model this library itself round-tripped:
 * `{"resourceType":"Patient","text":{"status":"generated","div":"<div xmlns=\"…xhtml\"><v:p>x</v:p></div>"}}`
 * reads with zero issues, and the document written from it re-read the same string. The cost the
 * tag-site colon refusal already pays. **What it does not withdraw**: a prefix a conformant document
 * bound on an ANCESTOR of the `div`, because the reader writes the declarations the element inherited
 * and uses into the string it hands back, so that string binds the prefix itself.
 *
 * **What it does NOT check**, none of it an unbound prefix: whether a bound prefix names the
 * namespace the sender meant, whether two attributes expand to one name (§6.3), a malformed
 * declaration (`xmlns:` with nothing after it), and the local part of a name beyond its being
 * non-empty and colon-free.
 *
 * @param element - An element of the string, as `readRawXml` parsed it; the root at the first call.
 * @param inherited - The prefixes declarations on enclosing elements inside the string bind.
 * @returns `true` when the string may be written verbatim.
 */
function bindsEveryPrefix(
  element: XmlElement,
  inherited: ReadonlySet<string> = NOTHING_BOUND,
): boolean {
  const scope = prefixesInScope(element, inherited);
  if (!nameIsBound(element.name, scope)) return false;
  for (const { name } of element.attributes) {
    if (name === XMLNS_PREFIX || name.startsWith(DECLARATION)) continue;
    if (!nameIsBound(name, scope)) return false;
  }
  return element.children.every((child) => child.type === "text" || bindsEveryPrefix(child, scope));
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
  if (isPrimitive(node) && node.value !== undefined) return scalarText(node.value);
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
  if (node.id !== undefined) {
    attrs += ` id="${attributeValue(node.id, childPath(path, "id"), sink)}"`;
  }
  if (node.value !== undefined) {
    attrs += ` value="${attributeValue(scalarText(node.value), path, sink)}"`;
  }
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
  // the forged markup is never built into the returned document. A string that passes is asked one
  // more question, of the same parse, on a code of its own: whether every prefix its markup names is
  // bound inside it, since this branch writes a value and the colon check in `tag()` never sees it.
  // A string that passes both is asked a third, on a code of its own again: whether it carries a
  // code point outside XML 1.0 `Char`, raw or denoted by a reference its parse decoded.
  if (name === "div" && node.kind === "primitive" && typeof node.value === "string") {
    const root = emitsOneDivElement(node.value);
    if (root === undefined) {
      sink.refusedDivs.push(path);
      return "";
    }
    if (!bindsEveryPrefix(root)) {
      sink.refusedDivPrefixes.push(path);
      return "";
    }
    if (carriesNonXmlCharacter(node.value) || decodesNonXmlCharacter(root)) {
      sink.refusedCharacters.push(path);
      return "";
    }
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
 *
 * The attributes are settled before the children are walked, which is the order the output spells
 * them in, so a value the attributes carry is tested before anything inside the element. Where a
 * name repeats, the last primitive carrying a value is the one written, and only that one is tested.
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
  const asId = (name: string): boolean => name === "id" && !isResource;
  const asUrl = (name: string): boolean => name === "url" && inExtension;
  let attrs = isRoot ? ` xmlns="${FHIR_XML_NAMESPACE}"` : "";
  let idText: string | undefined;
  let urlText: string | undefined;
  for (const { name, value } of node.properties) {
    const text = attributeText(value);
    if (text === undefined) continue;
    if (asId(name)) idText = text;
    else if (asUrl(name)) urlText = text;
  }
  if (idText !== undefined) {
    attrs += ` id="${attributeValue(idText, childPath(path, "id"), sink)}"`;
  }
  if (urlText !== undefined) {
    attrs += ` url="${attributeValue(urlText, childPath(path, "url"), sink)}"`;
  }

  const children: string[] = [];
  for (const { name, value } of node.properties) {
    // `resourceType` is the tag name, and an attribute-routed `id` or `url` was written above.
    if (name === "resourceType" || asId(name) || asUrl(name)) continue;
    const childInExtension = name === "extension" || name === "modifierExtension";
    children.push(writeProperty(path, name, value, childInExtension, sink));
  }

  const inner = children.join("");
  return inner === "" ? `<${written}${attrs}/>` : `<${written}${attrs}>${inner}</${written}>`;
}

/**
 * Serialize a resource (or any {@link FhirComplex}) to compact FHIR XML text, the exact
 * inverse of {@link parseResourceXml} for a model read from a conformant document (**the summary
 * line said "spec-clean" unqualified and the section below has always contradicted it**). Decimals are emitted byte-exact (never through a `number`),
 * primitive metadata is co-located (`id` attribute + child `<extension>`s), repeating elements are
 * repeated, and the root carries the FHIR namespace.
 *
 * ## What this output is NOT guaranteed to be, stated rather than implied
 *
 * "Spec-clean" is a claim about the FHIR structure, and the XML 1.0 grammar for a name and a
 * character is now held at every site this writer writes one: a tag name that is not a `Name`
 * (`<a&b/>`, `<1abc/>`) is refused rather than written, although it re-reads through
 * {@link parseResourceXml} exactly as written, because a conforming third-party processor must
 * reject it; and a code point outside `Char` in an attribute value or a spliced `div` string is
 * refused, raw or as a reference (see the `@throws` below). A name carrying a **colon** is refused
 * on a code of its own, because the model carries no binding to declare. **What is still written,
 * each a declared residual rather than an oversight**:
 *
 * - a `Name` that is not namespace-well-formed after `xml:` (`<xml:1abc/>`), since only the colon
 *   question reads the `xml:` prefix and it exempts that prefix;
 * - an element or attribute name inside a `div` string that is not a `Name` (`<p>` spelled `<1p>`):
 *   the string is asked the `Char` question, never the `Name` question, which is asked at tag
 *   positions only;
 * - the three `div` counterexamples below, none of them a name or a character matter.
 *
 * The reader is unchanged and still reads `<1abc>` and `<a&b>` back, and `validateResource` still
 * returns `valid: true` for a `string` carrying U+0000; both are separate surfaces.
 *
 * ## The `div` branch, which writes markup rather than a name
 *
 * A `div` property is written back as its own raw string, so what that string spells is markup in
 * the output. `emitsOneDivElement` is checked at that branch before the string is spliced in, and
 * the string is written only when it parses as exactly one element whose local name is `div`; a
 * string that fails raises `UNSERIALIZABLE_DIV_MARKUP` below. A string that passes is written only
 * when every prefix its markup names is bound by a declaration inside it (`bindsEveryPrefix`); one
 * that is not raises `UNSERIALIZABLE_DIV_PREFIX` below. A string that passes both is written only
 * when it carries no code point outside XML 1.0 `Char`, neither raw nor denoted by a numeric
 * character reference its parse decoded; one that does raises `UNSERIALIZABLE_XML_CHARACTER`
 * below, and a reference inside a comment, which is never decoded, is not one. The shape the first
 * check exists for is
 * `<div xmlns="…xhtml">ok</div></text><code><coding>…716186003…</coding></code><text>` on an
 * `AllergyIntolerance`: it used to be spliced in whole, and the emitted document re-read with
 * `noKnownAllergy: true` and a `no-known-allergy` negation over a record that had asserted nothing,
 * with no diagnostic at either end and `readSafety` affirming it.
 *
 * **What passing the three checks does and does not settle, by example rather than by rule.** A
 * string they accept contributes one element, that element is the `div`, every prefix its markup
 * names is bound inside it, and every character it spells or denotes is a `Char`; it is not a claim
 * that the round trip is lossless or that the output is well-formed from there. A comment beside the root (`<!--c--><div …/>`) is accepted and does not
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
 *   spec-clean: {@link serializeResource}'s own exception list still applies to the rest of the
 *   model).
 * @throws {FhirSerializeError} With `UNSERIALIZABLE_DIV_MARKUP` if a `div` property carries a string
 *   that would not be spliced in as the one `div` element the property names. It would carry other
 *   elements into the document, or leave markup that does not re-read. Refused rather than repaired
 *   for the same reason as a name: escaping it would author a text node where the sender wrote
 *   markup, and splicing it authors elements the sender never wrote. {@link serializeResource}
 *   carries the string as a string, so this refusal never reaches it and that route stays open.
 * @throws {FhirSerializeError} With `UNSERIALIZABLE_JSON_ONLY_SHAPE` if the model carries a shape the
 *   JSON reader marked at a position FHIR JSON gives no meaning to: an array inside an array, a
 *   scalar or `null` where FHIR JSON has an object (a complex element's position or a primitive's
 *   `_`-sibling), or a `null` in a primitive's value channel that padded nothing. XML has no array of
 *   arrays, no `_`-sibling and no `null`, so this writer emitted the empty element the reader was
 *   left holding and the finding was gone on the next read; `{"value":null,"unit":"mg"}` came back as
 *   a `Quantity` carrying a unit and no magnitude under an empty issue list. This refusal does not
 *   reach {@link serializeResource}, which writes these back from the text the reader preserved at
 *   every position that writer walks; **it does not walk a member a repeated property name shadowed,
 *   and this refusal does reach one**, so that is the refusal's limit and not a route the shape
 *   always survives. The text handed back is value-exact, **not byte-exact**. **Only a model read
 *   from JSON reaches this**: XML cannot write any of those shapes, so a document read from XML
 *   carries none of the markers.
 * @throws {FhirSerializeError} With `UNSERIALIZABLE_ARRAY_WRAPPER` if the model carries an array
 *   wrapper around a `0..1` element, at a location this library already reports as
 *   `ARRAY_WRAPPED_SCALAR`, that XML has no repeated element to spell back: one holding fewer than
 *   two items, or any wrapper on `resourceType`, where the type is the tag and a tag cannot be
 *   repeated. `{"resourceType":"Observation","status":["entered-in-error"]}` used to come back as
 *   `<status value="entered-in-error"/>` and re-read with an empty issue list, moving `valid` and
 *   `safeToSummarize` both from `false` to `true`. **A wrapper of two or more items elsewhere is left
 *   alone rather than refused**, because a model read from JSON writes it as repeated elements that
 *   re-read as a list. **That is a statement about a model a reader produced, not about every
 *   `FhirComplex` this accepts**, and the difference is reachable: a hand-built
 *   `list([list([]), list([])])` at `Observation.status` counts two items here and emits **no**
 *   element, so it launders exactly as an empty wrapper does. Neither reader builds one: every list
 *   the JSON reader constructs holds primitives or complexes, never lists (a nested array is marked
 *   at the item, and which of the two it is depends on the spelling), and XML has no such shape.
 *   {@link serializeResource} writes the wrapper back, so this refusal does not reach
 *   it. See `assertXmlArrayWrapper` for the window this is scoped to and what it does not cover.
 * @throws {FhirSerializeError} With `UNSERIALIZABLE_SHADOWED_PROPERTY` if the model carries a member
 *   a repeated property name shadowed. This writer walks `properties` only, so
 *   `{"status":"final","status":"entered-in-error"}` came back as `<status value="final"/>`: the
 *   retraction absent, and `valid` and `safeToSummarize` both moved from `false` to `true`. This
 *   refusal also reaches {@link serializeResource}, because that writer drops the
 *   member too and there is no route that keeps it. XML *can* repeat an element, but two repeated
 *   elements re-read as a list, which is a repeating element the sender never wrote. See
 *   `assertNoShadowedProperty` for the window and for the two positions it leaves.
 * @throws {FhirSerializeError} With `UNSERIALIZABLE_RESOURCE_TYPE` if the first `resourceType` an
 *   element wrote is not a string -- the one `resourceTypeOf` reads, since it is a `find`. FHIR XML
 *   has no `resourceType` element -- the type IS the tag -- so this writer skips that property at
 *   every element, and with no string to name the tag the root fell back to `Resource`:
 *   `{"resourceType":{"modifierExtension":[{"url":"http://example.org/x"}]},"status":"final"}` came
 *   back as `<Resource xmlns="http://hl7.org/fhir"><status value="final"/></Resource>`, moving
 *   `valid` and `safeToSummarize` both from `false` to `true` and taking the modifier extension with
 *   it. An element with **no** `resourceType` is untouched and still named `Resource` by the fallback
 *   above, and one whose first is a string keeps its tag and is left to the repeated-property-name
 *   case. `serializeResource` emits a non-string `resourceType` through its
 *   ordinary path, so this refusal does not reach it. See `assertXmlResourceType` for the window,
 *   which reaches every depth, and for the bound that holds only at the root.
 * @throws {FhirSerializeError} With `UNSERIALIZABLE_FOREIGN_ROOT` if the model holds a resource whose
 *   root the XML reader read out of a vocabulary that resolved to something other than FHIR's, by a
 *   default declaration or by a bound prefix. FHIR XML puts the resource in the FHIR namespace and
 *   this writer has no vendor binding to write instead, so
 *   `<v:Observation xmlns:v="urn:vendor"><v:status value="entered-in-error"/>…</v:Observation>` came
 *   back as `<Observation xmlns="http://hl7.org/fhir">…</Observation>` whose re-read carried an
 *   **empty** issue list: the one warning saying the document came from elsewhere was gone after a
 *   single trip. **Unlike most of the refusals above it this one withdraws a round trip from a
 *   document that reads `valid: true`**, because the root flag is a warning; the cost is bounded to
 *   this class. A root declaring no namespace at all is untouched, and one carrying a prefix bound to
 *   nothing is outside it too, refused on `UNSERIALIZABLE_PREFIXED_NAME` below rather than on this
 *   code. `serializeResource` emits the model exactly as it always did, so this refusal does not
 *   reach it -- a statement about that writer's output, not a claim that the JSON channel keeps the
 *   flag. See `assertXmlForeignRoot` for the window and for the route not taken.
 * @throws {FhirSerializeError} With `UNSERIALIZABLE_CHOICE_WRAPPER` if the model carries an array
 *   wrapper around an `Observation.value[x]` choice, at a location this library already reports as
 *   `ARRAY_WRAPPED_CHOICE`, that XML has no repeated element to spell back: one holding fewer than
 *   two items. `{"resourceType":"Observation","status":"final","valueQuantity":[{"value":5,
 *   "system":"http://unitsofmeasure.org","code":"mg"}]}` reads with the encoding reported and no
 *   magnitude handed out, and used to come back as `<valueQuantity><value value="5"/>…` re-reading
 *   as an unambiguous 5 mg under an empty issue list: a **dose** a format change made confident. **A
 *   wrapper of two or more items is left alone rather than refused**, because it writes as repeated
 *   elements that re-read as a list and the location is reported again. Scoped to `value[x]` and
 *   `component.value[x]`, `0..1` in R4, at every Observation resource root; the window is the value
 *   layer's own rather than a second cardinality table. {@link serializeResource} writes the wrapper
 *   back, so this refusal does not reach it. See `assertXmlValueChoiceWrapper`.
 * @throws {FhirSerializeError} With `UNSERIALIZABLE_PREFIXED_NAME` if any tag position holds a name
 *   carrying a colon, other than `xml:` followed by a local part with no colon in it. XML reads the
 *   colon as a namespace prefix and the model carries no binding for this writer to declare one
 *   with, so it used to write the prefix bound to nothing: `<v:x value="1"/>`, `<:x/>`, `<a:b:c/>`,
 *   `<xmlns:x/>`, and a root read as `<v:Observation>` written back as
 *   `<v:Observation xmlns="http://hl7.org/fhir">`. A conformant parser rejects all of them, and a
 *   prefix rebound between siblings lost its `MIXED_XML_SPELLING` report across one write and one
 *   re-read. **It withdraws an XML write from models that read `valid: true`**, the cost the
 *   foreign-root refusal above already pays: a property named `p:x` reads with zero issues. Checked
 *   at every tag position, at every depth, including a resource composed into a `contained` or a
 *   `Bundle.entry.resource` after it was read. Raised after every refusal above, so a model carrying
 *   one of these names beside anything above keeps the code it already reported, and a name that
 *   both carries a colon and breaks the tag stays `UNSERIALIZABLE_ELEMENT_NAME`. **Not covered**: a
 *   name with no colon that is not an XML 1.0 `Name`, which is refused on
 *   `UNSERIALIZABLE_XML_NAME` below, not on this code; and the local part after `xml:`, which is
 *   not checked for namespace well-formedness, so `<xml:1abc/>` is still written. A `div` string
 *   whose own markup carries an unbound prefix is written by the `div` branch rather than at a tag
 *   position, so this refusal does not reach it either; that branch refuses it on
 *   `UNSERIALIZABLE_DIV_PREFIX`, below. {@link serializeResource} spells a member name as a JSON
 *   string, so this refusal does not reach it and that route stays open.
 * @throws {FhirSerializeError} With `UNSERIALIZABLE_DIV_PREFIX` if a `div` property carries a string
 *   that passes the `UNSERIALIZABLE_DIV_MARKUP` check above and whose markup names, on an element or
 *   on an attribute, a namespace prefix no declaration inside the string binds (`xml` is bound by
 *   definition, and an `xmlns` or `xmlns:p` attribute is a declaration, not a prefixed name). The
 *   branch splices the string in verbatim, so it used to write `<v:div>x</v:div>` into a document a
 *   conformant parser rejects, and this library's re-read of that document turned the narrative into
 *   a property named `v:div`, with no diagnostic at either end. An unbound prefix on an inner element
 *   or an attribute (`<div xmlns="…xhtml"><v:p>x</v:p></div>`) is refused as well: the line is
 *   namespace-well-formedness, the one the colon refusal above draws at the tag sites. **It withdraws
 *   an XML write from models that read `valid: true`**, and for an inner prefix from a model this
 *   library itself round-tripped, the cost that refusal already pays. A prefix a conformant document
 *   bound on an ANCESTOR of the `div` is not refused, because the reader writes that declaration into
 *   the string it hands back. Checked at the `div` branch at every depth, including a resource
 *   composed into a `contained` or a `Bundle.entry.resource` after it was read, and raised after
 *   every refusal above, so a model that also trips any of them keeps the code it already reported.
 *   The message and the locations carry neither the string nor its prefix. {@link serializeResource}
 *   carries the string as a string, so this refusal does not reach it and that route stays open.
 * @throws {FhirSerializeError} With `UNSERIALIZABLE_XML_NAME` if any tag position holds a name that
 *   is not an XML 1.0 `Name` (production [5]) and that neither breaks the tag nor carries a colon:
 *   `a&b`, `1abc`, `-x`, `.x`, `a"b`, a name beginning U+00B7, a name carrying U+0000 or an unpaired
 *   surrogate. Each used to be written verbatim, and this library's own reader read each back
 *   unchanged, which is why the tag-breaking line above never reached it; a conforming processor must
 *   reject every one. Checked at every tag position at every depth: a property name, a name inside
 *   `contained`, `Bundle.entry.resource` or an extension, a resource-valued element's wrapper, and a
 *   `resourceType` that names a root or a nested resource's tag, the last reported at the location of
 *   the element wrapping it. Every position once, in walk order; a refused name's own segment renders
 *   `WITHHELD`, and neither the message nor a location carries the name. **Refused, never repaired**:
 *   XML has no escape for a name. **It withdraws an XML write from models that read `valid: true`**,
 *   the cost the colon refusal above already pays: a JSON property named `1abc` reads with zero
 *   issues. Raised after every refusal above, so a model that trips any of them keeps the code it
 *   already reported. {@link serializeResource} spells a member name as a JSON string, so this
 *   refusal does not reach it and that route stays open.
 * @throws {FhirSerializeError} With `UNSERIALIZABLE_XML_CHARACTER` if a value this writer emits as an
 *   attribute value (a primitive's `value`, an `id` written as an attribute, an `Extension.url`) or
 *   a `div` string that passes both `div` checks above carries a code point outside XML 1.0 `Char`
 *   (production [2]): U+0000 to U+0008, U+000B, U+000C, U+000E to U+001F, an unpaired surrogate,
 *   U+FFFE or U+FFFF. In a `div` string a numeric character reference denoting one (`&#0;`,
 *   `&#x1F;`) counts as the raw character does, because the Legal Character constraint makes it as
 *   fatal; a reference inside a comment is never decoded and does not. A U+0000 used to be written
 *   raw into its `value` attribute. **Refused, never repaired**: the character is not written raw,
 *   as a reference or replaced, and neither it nor its value is dropped, so the model is left as it
 *   was. The location is the value's (`Patient.gender`, `Patient.gender.id`,
 *   `Patient.extension[0].url`, `Patient.text.div`), every one once, in walk order; neither the
 *   message nor a location carries the value or the character. The discouraged code points `Char`
 *   still admits (U+007F to U+009F, U+FDD0 to U+FDEF) are written. Raised last of all, after
 *   `UNSERIALIZABLE_XML_NAME`, so a model that trips any refusal above keeps the code it already
 *   reported and a model carrying both a name that is not a `Name` and a character that is not a
 *   `Char` draws the name code. {@link serializeResource} writes these values as JSON strings, so
 *   this refusal does not reach it and that route stays open.
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
  const sink: RefusalSink = {
    refusedNames: [],
    refusedDivs: [],
    refusedPrefixes: [],
    refusedDivPrefixes: [],
    refusedXmlNames: [],
    refusedCharacters: [],
  };
  const xml = writeElement(rootPath(tagName), tagName, node, true, false, sink);
  // Names first, which is the order base raised them in, so a model that trips both keeps the code
  // it already reported. Both are raised after the walk, so neither returns a half-built document.
  if (sink.refusedNames.length > 0) refuseUnserializableNames([...new Set(sink.refusedNames)]);
  if (sink.refusedDivs.length > 0) refuseUnserializableDivMarkup([...new Set(sink.refusedDivs)]);
  // Last, for the same reason: a model carrying a JSON-only shape AND a name this cannot write keeps
  // the name refusal it already raised, so no case moves onto the newer code.
  assertXmlSerializable(node);
  // And this one after that, on the same rule: it is the newest code, so it goes at the end of the
  // chain and no model that already reported one of the three above moves onto it.
  assertXmlArrayWrapper(node);
  // And this one after that, on the same rule again: it goes at the very end of the chain in both
  // writers and nothing that already reported one of the four moves onto it.
  assertNoShadowedProperty(node);
  // And this one last of all, on the same rule again: it is the newest code, so nothing that already
  // reported one of the five moves onto it. An array-wrapped or `null` type gate keeps its own.
  assertXmlResourceType(node);
  // And this one after THAT, on the same rule once more: it is now the newest code, so a vendor root
  // that also carries dropped character data or an unwritable name keeps the code it already had.
  assertXmlForeignRoot(node);
  // And this one at the very end of the chain, on the same rule again: it is the newest code, so a
  // document whose `value[x]` wrapper sits beside an element-level one, a shadowed member or an
  // untaggable type keeps the code it already reported and no case moves onto this one.
  assertXmlValueChoiceWrapper(node);
  // And the colon refusal after every one of them, on the same rule: it is the newest code, and it
  // was collected at the tag sites during the walk above rather than by a pass of its own, so a
  // model that also trips any refusal above keeps the code the writer raised for it before.
  if (sink.refusedPrefixes.length > 0) {
    refuseUndeclarablePrefixes([...new Set(sink.refusedPrefixes)]);
  }
  // And the `div` prefix refusal after that, on the same rule: it was the newest code, collected
  // at the `div` branch during the same walk, so a model that also trips any refusal above, the colon
  // refusal at the tag sites included, keeps the code the writer raised for it before.
  if (sink.refusedDivPrefixes.length > 0) {
    refuseUnboundDivPrefixes([...new Set(sink.refusedDivPrefixes)]);
  }
  // Then the two XML 1.0 refusals, both collected during the same walk: the `Name` code first, then
  // the `Char` code last of all, so every model that drew any code above keeps it, and a model that
  // carries both a name that is not a `Name` and a character that is not a `Char` draws the name code.
  if (sink.refusedXmlNames.length > 0) refuseNonXmlNames([...new Set(sink.refusedXmlNames)]);
  if (sink.refusedCharacters.length > 0) {
    refuseNonXmlCharacters([...new Set(sink.refusedCharacters)]);
  }
  return xml;
}
