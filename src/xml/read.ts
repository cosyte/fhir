/**
 * The XML read path: a raw {@link XmlElement} tree → the immutable {@link FhirNode} model, the same
 * model the JSON reader produces (roadmap Phase 8, xml.html).
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
/** The XHTML namespace of a FHIR narrative `<div>` (deferred in Phase 8, preserved-and-flagged). */
export const XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

/** Whether an XML tag name is a FHIR resource type (UpperCamelCase) vs an element name (lowerCamelCase). */
function isResourceName(name: string): boolean {
  const first = name.charAt(0);
  return first >= "A" && first <= "Z";
}

/** The element children of a node, in order. */
function elementChildren(children: readonly XmlNode[]): XmlElement[] {
  return children.filter((c): c is XmlElement => c.type === "element");
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

/** Group an element's children by tag name, preserving first-seen order (mirrors the JSON grouping). */
function groupChildren(children: XmlElement[]): {
  order: string[];
  byName: Map<string, XmlElement[]>;
} {
  const order: string[] = [];
  const byName = new Map<string, XmlElement[]>();
  for (const child of children) {
    const existing = byName.get(child.name);
    if (existing === undefined) {
      order.push(child.name);
      byName.set(child.name, [child]);
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
  element: XmlElement,
  path: string,
  issues: FhirIssue[],
  opts: { isResource: boolean },
): FhirComplex {
  const properties: FhirProperty[] = [];
  if (opts.isResource) {
    properties.push({ name: "resourceType", value: primitive(element.name) });
  }
  for (const attr of element.attributes) {
    if (attr.name === "xmlns") {
      if (attr.value !== FHIR_XML_NAMESPACE) issues.push(unexpectedXmlContent(path));
      continue;
    }
    if (attr.name.startsWith("xmlns:")) continue;
    if (attr.name === "id" || attr.name === "url") {
      properties.push({ name: attr.name, value: primitive(attr.value) });
      continue;
    }
    if (attr.name === "value") {
      // A `value` attribute on an element the reader treated as complex is misplaced; flag it.
      issues.push(unknownProperty(`${path}.@value`));
      continue;
    }
    issues.push(unknownProperty(`${path}.@${attr.name}`));
  }
  const children = elementChildren(element.children);
  flagStrayText(element.children, path, issues);
  const { order, byName } = groupChildren(children);
  for (const name of order) {
    const occurrences = byName.get(name) ?? [];
    properties.push({ name, value: buildNode(occurrences, `${path}.${name}`, issues) });
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
function buildNode(occurrences: XmlElement[], path: string, issues: FhirIssue[]): FhirNode {
  if (occurrences.length > 1) {
    return list(occurrences.map((occ, i) => buildSingle(occ, `${path}[${String(i)}]`, issues)));
  }
  const only = occurrences[0];
  if (only === undefined) return list([]); // unreachable: a grouped name always has ≥1 occurrence
  return buildSingle(only, path, issues);
}

/** Build the model node for one element occurrence, resource-valued, primitive, or complex. */
function buildSingle(element: XmlElement, path: string, issues: FhirIssue[]): FhirNode {
  const children = elementChildren(element.children);
  const hasValue = valueAttribute(element) !== undefined;

  // A resource-valued element wraps exactly one resource element (e.g. `contained`, `entry.resource`).
  if (
    !hasValue &&
    children.length === 1 &&
    children[0] !== undefined &&
    isResourceName(children[0].name)
  ) {
    return readComplex(children[0], path, issues, { isResource: true });
  }

  // A narrative `<div>` (XHTML) is carried **opaquely** as its full serialized string, exactly the
  // representation FHIR JSON uses for `Narrative.div` (a string). The reader does not model the XHTML
  // element tree, but it never drops or garbles it: the writer re-emits this string verbatim, so a
  // narrative round-trips as conformant `<div>…</div>`, not an escaped attribute. (The XHTML structure
  // itself is not validated, the same fidelity as the JSON codec.)
  if (element.name === "div") {
    return primitive(serializeXml(element));
  }

  const extensionChildren = children.filter((c) => c.name === "extension");
  const otherChildren = children.filter((c) => c.name !== "extension");

  // Primitive: a `value` attribute, or no child elements beyond `extension` (incl. value-absent).
  if (hasValue || otherChildren.length === 0) {
    for (const stray of otherChildren) issues.push(unknownProperty(`${path}.${stray.name}`));
    const meta: { id?: string; extension?: readonly FhirComplex[] } = {};
    const id = element.attributes.find((a) => a.name === "id")?.value;
    if (id !== undefined) meta.id = id;
    if (extensionChildren.length > 0) {
      meta.extension = extensionChildren.map((ext, i) =>
        readComplex(ext, `${path}.extension[${String(i)}]`, issues, { isResource: false }),
      );
    }
    // A primitive carries only `value`, `id`, and child `<extension>`s; flag any other attribute
    // (a stray `url`, an xmlns on a nested primitive, …) as unknown, preserved, never rejected.
    for (const attr of element.attributes) {
      if (attr.name !== "value" && attr.name !== "id") {
        issues.push(unknownProperty(`${path}.@${attr.name}`));
      }
    }
    flagStrayText(element.children, path, issues);
    return primitive(valueAttribute(element), meta);
  }

  return readComplex(element, path, issues, { isResource: false });
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
  const resource = readComplex(root, root.name, issues, { isResource: true });
  return { resource, issues };
}
