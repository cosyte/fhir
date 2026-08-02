/**
 * The XML read path: a raw {@link XmlElement} tree → the immutable {@link FhirNode} model, the same
 * model the JSON reader produces (xml.html).
 *
 * FHIR XML encodes the same information model as FHIR JSON through different mechanisms, and this
 * reader translates each back to the shared model so a resource read from XML is **equivalent** to
 * the same resource read from JSON (compared with {@link ./equivalence.js nodesEquivalent}). The
 * mapping (xml.html):
 *
 * - **The root/contained element name is the resource type**, there is no `resourceType` property on
 *   the wire, so the reader synthesizes one (`resourceType` → the element name) as the first property,
 *   matching the JSON model.
 * - **A primitive's value is the `value` attribute** (`<active value="true"/>`), and its `id` /
 *   `extension` metadata are an `id` attribute and child `<extension>` elements, the XML co-location
 *   of what JSON splits into the `_`-sibling. The reader is **schema-free** like the JSON reader, so a
 *   primitive value is kept as its exact lexical **string** (`"true"`, `"0.010"`); it never guesses a
 *   FHIR datatype to coerce a boolean or a decimal, and precision is preserved because the text is
 *   never routed through a `number`. Cross-format *equivalence* is therefore defined modulo lexical
 *   form (see {@link ./equivalence.js}).
 * - **A repeating element becomes a list**; a single occurrence is a single node (JSON always uses an
 *   array for a repeatable element, the one irreducible schema-free ambiguity, reconciled by the
 *   singleton-list rule in {@link ./equivalence.js}).
 * - **`Element.id` is an attribute, `Resource.id` a child element**; both land as an `id` property,
 *   and **`Extension.url` is an attribute** that lands as a `url` property.
 * - **A resource-valued element** (`<contained><Patient>…</Patient></contained>`) is unwrapped to the
 *   inner resource, matching JSON where the value *is* the resource object.
 * - **Names are namespace-resolved, so a prefix is a spelling and not part of the name.** FHIR XML
 *   is defined in the `http://hl7.org/fhir` namespace, and XML lets a document bind that namespace
 *   to a prefix instead of making it the default, so `<f:Patient xmlns:f="http://hl7.org/fhir">` and
 *   `<Patient xmlns="http://hl7.org/fhir">` are the *same* document. The reader tracks the in-scope
 *   declarations as it descends and models the **local** name, so both read to the same model. A
 *   prefix no in-scope declaration binds is not resolvable, so the tag is kept exactly as written
 *   and flagged rather than guessed at.
 *
 * The narrative `<div>` (XHTML) is carried **opaquely** as its full serialized string, the same
 * representation FHIR JSON uses for `Narrative.div`, so it round-trips as conformant `<div>…</div>`
 * and is never dropped or escaped into an attribute; its XHTML structure is not modeled or validated
 * (matching the JSON codec's fidelity). Reading is otherwise lenient (Postel's Law): an unexpected
 * namespace or stray character data is preserved-and-flagged, never rejected. Only genuinely
 * unrecoverable input (a malformed document, a refused DTD/entity) throws, see {@link ./raw-xml.js}
 * / {@link ./issues.js}.
 *
 * @packageDocumentation
 */

import { unexpectedXmlContent, unknownProperty, type FhirIssue } from "../codec/issues.js";
import { childPath, rootPath, safeDerivedName } from "../model/path.js";
import type { ReadResult } from "../codec/read.js";
import {
  complex,
  list,
  primitive,
  type FhirComplex,
  type FhirNode,
  type FhirProperty,
} from "../model/node.js";
import { readRawXml, type XmlElement, type XmlNode } from "./raw-xml.js";

/** The FHIR XML namespace; the default namespace of every FHIR resource element. */
export const FHIR_XML_NAMESPACE = "http://hl7.org/fhir";
/** The XHTML namespace of a FHIR narrative `<div>` (preserved-and-flagged). */
export const XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

/**
 * The namespace the `xml` prefix is bound to in every XML document, without being declared
 * (Namespaces in XML §3). Pre-bound so `xml:lang` and friends resolve rather than reading as an
 * undeclared prefix.
 */
const XML_PREFIX_NAMESPACE = "http://www.w3.org/XML/1998/namespace";

/**
 * What "no namespace" is spelled as internally, so an element that is in no namespace can be
 * compared against one that is without a `undefined` special case at every site.
 */
const NO_NAMESPACE = "";

/** The namespace declarations in scope at a point in the tree: prefix (`""` = default) → URI. */
type NamespaceScope = ReadonlyMap<string, string>;

/** The scope a document starts in: the implicit `xml` binding and nothing else. */
const ROOT_SCOPE: NamespaceScope = new Map([["xml", XML_PREFIX_NAMESPACE]]);

/**
 * Extend `parent` with the `xmlns` / `xmlns:*` declarations this element carries. Returns `parent`
 * itself when the element declares nothing, which is the common case.
 */
function extendScope(element: XmlElement, parent: NamespaceScope): NamespaceScope {
  let scope: Map<string, string> | undefined;
  for (const attr of element.attributes) {
    const prefix = namespaceDeclarationPrefix(attr.name);
    if (prefix === undefined) continue;
    scope ??= new Map(parent);
    // An empty URI undeclares (Namespaces in XML §6.2): the prefix leaves scope rather than binding
    // to the empty string.
    if (attr.value === "") scope.delete(prefix);
    else scope.set(prefix, attr.value);
  }
  return scope ?? parent;
}

/** The prefix an attribute declares (`""` for `xmlns`), or `undefined` if it declares nothing. */
function namespaceDeclarationPrefix(attributeName: string): string | undefined {
  if (attributeName === "xmlns") return "";
  return attributeName.startsWith("xmlns:") ? attributeName.slice("xmlns:".length) : undefined;
}

/** An element's tag name, resolved against the declarations in scope where it was written. */
interface ResolvedName {
  /** The name to model: the local part when the prefix resolves, the tag verbatim when it does not. */
  readonly name: string;
  /** The namespace the element is in, {@link NO_NAMESPACE} when it is in none. */
  readonly namespace: string;
  /** Whether the tag carried a prefix that no declaration in scope binds. */
  readonly unboundPrefix: boolean;
}

/**
 * Resolve a tag name against `scope`. An unprefixed name takes the default namespace; a prefixed one
 * takes its prefix's. A prefix nothing binds, or a malformed QName, resolves to nothing: the tag is
 * returned exactly as written, because inventing a binding for it would model an element under a
 * name the document never gave it.
 */
function resolveName(tag: string, scope: NamespaceScope): ResolvedName {
  const colon = tag.indexOf(":");
  if (colon === -1) {
    return { name: tag, namespace: scope.get("") ?? NO_NAMESPACE, unboundPrefix: false };
  }
  const prefix = tag.slice(0, colon);
  const local = tag.slice(colon + 1);
  const bound = scope.get(prefix);
  if (bound === undefined || prefix === "" || local === "" || local.includes(":")) {
    return { name: tag, namespace: NO_NAMESPACE, unboundPrefix: true };
  }
  return { name: local, namespace: bound, unboundPrefix: false };
}

/** An element together with the namespace scope it was written in and its resolved name. */
interface ScopedElement {
  readonly element: XmlElement;
  readonly scope: NamespaceScope;
  readonly resolved: ResolvedName;
}

/** Pair an element with the scope in force inside it and its resolved name. */
function scoped(element: XmlElement, parentScope: NamespaceScope): ScopedElement {
  const scope = extendScope(element, parentScope);
  return { element, scope, resolved: resolveName(element.name, scope) };
}

/**
 * Flag an element whose namespace is not the FHIR one, at the position where the document leaves the
 * FHIR namespace rather than once per descendant: an element that merely *inherits* a foreign
 * namespace says nothing its ancestor did not already say. An unresolvable prefix is flagged
 * wherever it appears, because each such tag is separately unreadable.
 */
function flagNamespace(
  resolved: ResolvedName,
  parentNamespace: string,
  path: string,
  issues: FhirIssue[],
): void {
  if (resolved.unboundPrefix) {
    issues.push(unexpectedXmlContent(path));
    return;
  }
  if (resolved.namespace !== FHIR_XML_NAMESPACE && resolved.namespace !== parentNamespace) {
    issues.push(unexpectedXmlContent(path));
  }
}

/** Whether an XML tag name is a FHIR resource type (UpperCamelCase) vs an element name (lowerCamelCase). */
function isResourceName(name: string): boolean {
  const first = name.charAt(0);
  return first >= "A" && first <= "Z";
}

/** The element children of a node, in order, each paired with the scope in force inside it. */
function elementChildren(element: XmlElement, scope: NamespaceScope): ScopedElement[] {
  return element.children
    .filter((c): c is XmlElement => c.type === "element")
    .map((c) => scoped(c, scope));
}

/** Read the `value` attribute of an element, if present. */
function valueAttribute(element: XmlElement): string | undefined {
  return element.attributes.find((a) => a.name === "value")?.value;
}

/** Serialize an XML node back to a canonical string, used to carry a narrative `<div>` opaquely. */
function serializeXml(node: XmlNode): string {
  if (node.type === "text") {
    return node.value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  const attrs = node.attributes
    .map(
      (a) =>
        ` ${a.name}="${a.value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;")}"`,
    )
    .join("");
  const inner = node.children.map(serializeXml).join("");
  return node.children.length === 0
    ? `<${node.name}${attrs}/>`
    : `<${node.name}${attrs}>${inner}</${node.name}>`;
}

/**
 * Group an element's children by **resolved** name, preserving first-seen order (mirrors the JSON
 * grouping). Two children spelled with different prefixes but resolving to the same namespace and
 * local name are the same element repeated, so they group together.
 */
function groupChildren(children: ScopedElement[]): {
  order: string[];
  byName: Map<string, ScopedElement[]>;
} {
  const order: string[] = [];
  const byName = new Map<string, ScopedElement[]>();
  for (const child of children) {
    const name = child.resolved.name;
    const existing = byName.get(name);
    if (existing === undefined) {
      order.push(name);
      byName.set(name, [child]);
    } else {
      existing.push(child);
    }
  }
  return { order, byName };
}

/**
 * Read a complex (object) element into a {@link FhirComplex}. Attributes become the leading `id` /
 * `url` properties (`Element.id` / `Extension.url`); child elements become the remaining properties,
 * grouped by name. When `isResource`, a synthetic `resourceType` property (the element name) leads.
 */
function readComplex(
  self: ScopedElement,
  path: string,
  issues: FhirIssue[],
  opts: { isResource: boolean },
): FhirComplex {
  const { element, resolved } = self;
  const properties: FhirProperty[] = [];
  if (opts.isResource) {
    properties.push({ name: "resourceType", value: primitive(resolved.name) });
  }
  for (const attr of element.attributes) {
    // A namespace declaration is not an element: it is read by `extendScope`, and whether the
    // namespace it names is the FHIR one is reported against the element, not the attribute.
    if (namespaceDeclarationPrefix(attr.name) !== undefined) continue;
    if (attr.name === "id" || attr.name === "url") {
      properties.push({ name: attr.name, value: primitive(attr.value) });
      continue;
    }
    if (attr.name === "value") {
      // A `value` attribute on an element the reader treated as complex is misplaced; flag it.
      issues.push(unknownProperty(`${path}.@value`));
      continue;
    }
    issues.push(unknownProperty(`${path}.@${safeDerivedName(attr.name, "elementName")}`));
  }
  const children = elementChildren(element, self.scope);
  flagStrayText(element.children, path, issues);
  const { order, byName } = groupChildren(children);
  for (const name of order) {
    const occurrences = byName.get(name) ?? [];
    properties.push({
      name,
      value: buildNode(occurrences, childPath(path, name), issues, resolved.namespace),
    });
  }
  return complex(properties);
}

/** Flag any non-whitespace character data directly under an element (FHIR uses `value=`, not text). */
function flagStrayText(children: readonly XmlNode[], path: string, issues: FhirIssue[]): void {
  for (const node of children) {
    if (node.type === "text" && node.value.trim() !== "") {
      issues.push(unexpectedXmlContent(path));
      return;
    }
  }
}

/** Build the model node for a set of same-named occurrences: a list when repeated, else a single node. */
function buildNode(
  occurrences: ScopedElement[],
  path: string,
  issues: FhirIssue[],
  parentNamespace: string,
): FhirNode {
  if (occurrences.length > 1) {
    return list(
      occurrences.map((occ, i) =>
        buildSingle(occ, `${path}[${String(i)}]`, issues, parentNamespace),
      ),
    );
  }
  const only = occurrences[0];
  if (only === undefined) return list([]); // unreachable: a grouped name always has ≥1 occurrence
  return buildSingle(only, path, issues, parentNamespace);
}

/** Build the model node for one element occurrence, resource-valued, primitive, or complex. */
function buildSingle(
  self: ScopedElement,
  path: string,
  issues: FhirIssue[],
  parentNamespace: string,
): FhirNode {
  const { element, resolved } = self;
  // The narrative `<div>` is the one element FHIR *requires* in a foreign namespace (XHTML), so it
  // is not unexpected content there. Any other namespace on it still is.
  const narrativeDiv = resolved.name === "div" && resolved.namespace === XHTML_NAMESPACE;
  if (!narrativeDiv) flagNamespace(resolved, parentNamespace, path, issues);
  const children = elementChildren(element, self.scope);
  const hasValue = valueAttribute(element) !== undefined;

  // A resource-valued element wraps exactly one resource element (e.g. `contained`, `entry.resource`).
  const onlyChild = children[0];
  if (!hasValue && children.length === 1 && onlyChild !== undefined) {
    // An unresolvable prefix keeps the tag verbatim, so `f:Patient` does not read as a resource name.
    if (isResourceName(onlyChild.resolved.name)) {
      flagNamespace(onlyChild.resolved, resolved.namespace, path, issues);
      return readComplex(onlyChild, path, issues, { isResource: true });
    }
  }

  // A narrative `<div>` (XHTML) is carried **opaquely** as its full serialized string, exactly the
  // representation FHIR JSON uses for `Narrative.div` (a string). The reader does not model the XHTML
  // element tree, but it never drops or garbles it: the writer re-emits this string verbatim, so a
  // narrative round-trips as conformant `<div>…</div>`, not an escaped attribute. (The XHTML structure
  // itself is not validated, the same fidelity as the JSON codec.)
  if (resolved.name === "div") {
    return primitive(serializeXml(element));
  }

  const extensionChildren = children.filter((c) => c.resolved.name === "extension");
  const otherChildren = children.filter((c) => c.resolved.name !== "extension");

  // Primitive: a `value` attribute, or no child elements beyond `extension` (incl. value-absent).
  if (hasValue || otherChildren.length === 0) {
    for (const stray of otherChildren) {
      issues.push(unknownProperty(childPath(path, stray.resolved.name)));
    }
    const meta: { id?: string; extension?: readonly FhirComplex[] } = {};
    const id = element.attributes.find((a) => a.name === "id")?.value;
    if (id !== undefined) meta.id = id;
    if (extensionChildren.length > 0) {
      meta.extension = extensionChildren.map((ext, i) => {
        flagNamespace(ext.resolved, resolved.namespace, `${path}.extension[${String(i)}]`, issues);
        return readComplex(ext, `${path}.extension[${String(i)}]`, issues, { isResource: false });
      });
    }
    // A primitive carries only `value`, `id`, and child `<extension>`s; flag any other attribute
    // (a stray `url`, …) as unknown, preserved, never rejected. A namespace declaration is not an
    // attribute of the element in this sense: it is read as a declaration and reported, when it
    // names something other than the FHIR namespace, against the element itself.
    for (const attr of element.attributes) {
      if (
        attr.name !== "value" &&
        attr.name !== "id" &&
        namespaceDeclarationPrefix(attr.name) === undefined
      ) {
        issues.push(unknownProperty(`${path}.@${safeDerivedName(attr.name, "elementName")}`));
      }
    }
    flagStrayText(element.children, path, issues);
    return primitive(valueAttribute(element), meta);
  }

  return readComplex(self, path, issues, { isResource: false });
}

/**
 * Read a FHIR resource from XML text (or an already-parsed {@link XmlElement} tree) into the immutable
 * model, gathering value-free issues, the same {@link ReadResult} the JSON {@link ../codec/read.js
 * parseResource} returns. Throws {@link ./issues.js FhirXmlError} on malformed XML or a refused
 * DTD/entity (XXE / billion-laughs safe).
 *
 * @param input - XML text, or an {@link XmlElement} tree from {@link readRawXml}.
 * @example
 * ```ts
 * import { parseResourceXml, serializeResource } from "@cosyte/fhir";
 * const { resource } = parseResourceXml(
 *   '<Patient xmlns="http://hl7.org/fhir"><active value="true"/></Patient>',
 * );
 * serializeResource(resource); // → the same model as the JSON form, re-emitted as JSON
 * ```
 */
export function parseResourceXml(input: string | XmlElement): ReadResult {
  const root = typeof input === "string" ? readRawXml(input) : input;
  const issues: FhirIssue[] = [];
  const self = scoped(root, ROOT_SCOPE);
  const path = rootPath(self.resolved.name);
  flagNamespace(self.resolved, NO_NAMESPACE, path, issues);
  const resource = readComplex(self, path, issues, { isResource: true });
  return { resource, issues };
}
