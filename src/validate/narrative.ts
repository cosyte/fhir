/**
 * The narrative layer: `Narrative.div` checked against the R4 narrative rules.
 *
 * R4 carries a resource's human-readable narrative as XHTML in `Narrative.div`, and it limits that
 * XHTML. The `xhtml` datatype says the content is a single `div` element in the XHTML namespace;
 * `txt-1` says the narrative SHALL contain only the basic HTML formatting elements and attributes
 * (no script, no forms, no event handlers); `txt-2` says it SHALL have some non-whitespace content.
 * The model carries the narrative as an opaque string, exactly as the document wrote it, and this
 * layer reads that string and reports what breaks the rules. It never changes the string: the model
 * is immutable and the check only reads a copy of the parse.
 *
 * Seven value-free findings, each an `error` in both modes, each at the location of the `div`:
 *
 * - **`NARRATIVE_UNREADABLE`**: the `div` is not a string, or not well-formed XML, or it uses what
 *   the XML reader refuses (a DTD, an entity other than the five XML predefines, a CDATA section,
 *   or nesting past the reader's depth bound). Nothing else is checked in a narrative that cannot be
 *   read.
 * - **`NARRATIVE_ROOT_INVALID`**: the root element is not `div` in the XHTML namespace.
 * - **`NARRATIVE_ELEMENT_ILLEGAL`**: an element outside the allowed set, or outside the XHTML
 *   namespace.
 * - **`NARRATIVE_ATTRIBUTE_ILLEGAL`**: an attribute outside the allowed set.
 * - **`NARRATIVE_ACTIVE_CONTENT`**: content that runs or loads code in a renderer: a `script`,
 *   `iframe`, `frame`, `frameset`, `object`, `embed` or `applet` element in any case and any
 *   namespace, an `on…` event-handler attribute, or a `javascript:` or `vbscript:` URL in a link,
 *   image or citation. Such content is reported under this code rather than as an illegal element
 *   or attribute, so a caller can tell a hazard from a formatting slip.
 * - **`NARRATIVE_BLOCK_IN_PARAGRAPH`**: a `div`, `blockquote`, `table`, `ol`, `ul` or `p` inside a
 *   `p`, at any depth.
 * - **`NARRATIVE_EMPTY`**: no character other than XML whitespace and no `img` anywhere in it.
 *
 * Each code is reported at most once per narrative: every finding sits at the same location, so a
 * second one would add nothing a reader could act on.
 *
 * **Where the lists come from.** The allowed elements and attributes are the ones the HL7 reference
 * validator (`validator_cli`, the oracle of this package's differential) enforces for `txt-1`, which
 * are R4's own reading of "chapters 7 to 11 and 15 of HTML 4.0": the elements, the attributes any of
 * them may carry, and the attributes allowed on one element only (`a.href`, `img.src`, ...). An
 * attribute whose name starts with `xmlns` is a namespace declaration and always allowed, and so are
 * `xml:lang` and `xml:space`. Names compare exactly: XHTML is case-sensitive, so `<P>` is not `<p>`.
 * Elements compare by expanded name, so a narrative a document wrote with a prefix bound to the XHTML
 * namespace (`<h:div xmlns:h="...">`) reads the same as the default-namespace spelling.
 *
 * **Where it looks.** The narrative of the resource itself, and of every resource carried inside
 * it at the positions R4 defines for one: `contained`, a Bundle's `entry.resource` and
 * `entry.response.outcome`, and a Parameters resource's `parameter.resource` and
 * `parameter.part.resource`, at any depth. The walk is iterative, so a deeply nested model cannot
 * overflow the stack.
 *
 * **What it does not check.** The table and list structure rules (a `tr` outside a table, an `li`
 * outside a list), the validity of a URL beyond its scheme, the content of a `style` attribute, and
 * the uniqueness of `id` values. A narrative with none of the findings above is not thereby safe to
 * render as HTML without a sanitizer of the renderer's own.
 *
 * @packageDocumentation
 */

import {
  childPath,
  getProperty,
  isComplex,
  isList,
  isPrimitive,
  resourceType,
  type FhirComplex,
  type FhirNode,
} from "../model/index.js";
import { readRawXml, type XmlElement, type XmlNode } from "../xml/raw-xml.js";
import {
  ISSUE_SEVERITIES,
  validationIssue,
  type ValidationCode,
  type ValidationIssue,
} from "./issues.js";

/** The XHTML namespace, the only one a narrative's elements may be in. */
const XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

/** The namespace the `xml` prefix is bound to by definition (Namespaces in XML 1.0 §3). */
const XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace";

/** The elements a narrative may use (R4 `txt-1`, as the reference validator enforces it). */
const ALLOWED_ELEMENTS: ReadonlySet<string> = new Set([
  "p",
  "br",
  "div",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "a",
  "span",
  "b",
  "em",
  "i",
  "strong",
  "small",
  "big",
  "tt",
  "dfn",
  "q",
  "var",
  "abbr",
  "acronym",
  "cite",
  "blockquote",
  "hr",
  "address",
  "bdo",
  "kbd",
  "sub",
  "sup",
  "ul",
  "ol",
  "li",
  "dl",
  "dt",
  "dd",
  "pre",
  "table",
  "caption",
  "colgroup",
  "col",
  "thead",
  "tr",
  "tfoot",
  "tbody",
  "th",
  "td",
  "code",
  "samp",
  "img",
  "map",
  "area",
]);

/** The attributes any allowed element may carry. */
const ALLOWED_ATTRIBUTES: ReadonlySet<string> = new Set([
  "title",
  "style",
  "class",
  "id",
  "lang",
  "xml:lang",
  "xml:space",
  "dir",
  "accesskey",
  "tabindex",
  "span",
  "width",
  "align",
  "valign",
  "char",
  "charoff",
  "abbr",
  "axis",
  "headers",
  "scope",
  "rowspan",
  "colspan",
]);

/** The attributes allowed on one element only, as `element.attribute`. */
const ALLOWED_ELEMENT_ATTRIBUTES: ReadonlySet<string> = new Set([
  "a.href",
  "a.name",
  "a.charset",
  "a.type",
  "a.hreflang",
  "a.rel",
  "a.rev",
  "a.shape",
  "a.coords",
  "img.src",
  "img.border",
  "img.alt",
  "img.longdesc",
  "img.height",
  "img.width",
  "img.usemap",
  "img.ismap",
  "div.xmlns",
  "blockquote.cite",
  "q.cite",
  "map.name",
  "area.shape",
  "area.coords",
  "area.href",
  "area.nohref",
  "area.alt",
  "table.summary",
  "table.width",
  "table.border",
  "table.frame",
  "table.rules",
  "table.cellspacing",
  "table.cellpadding",
  "pre.space",
  "td.nowrap",
]);

/** The block elements a paragraph may not hold, at any depth. */
const BLOCK_ELEMENTS: ReadonlySet<string> = new Set([
  "div",
  "blockquote",
  "table",
  "ol",
  "ul",
  "p",
]);

/** Elements that run or load code in a renderer, compared in lower case in any namespace. */
const ACTIVE_ELEMENTS: ReadonlySet<string> = new Set([
  "script",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
]);

/** The attributes that hold a URL a renderer follows or loads. */
const URL_ATTRIBUTES: ReadonlySet<string> = new Set(["href", "src", "cite", "longdesc", "usemap"]);

/**
 * A URL scheme that runs script when followed, read the way a browser reads it (the WHATWG URL
 * parser): every tab, line feed and carriage return anywhere in the value is removed, then leading
 * C0 control characters and spaces, and only then is the scheme read. So `java&#9;script:` is a
 * `javascript:` URL, since the reader keeps a character reference as the character it names.
 */
const SCRIPT_URL = /^(?:javascript|vbscript)\s*:/iu;

/** Tab, line feed and carriage return, which a browser strips from anywhere in a URL. */
const URL_STRIPPED = /[\t\n\r]/gu;

/** Leading C0 control characters and spaces, which a browser trims from a URL. */
const URL_LEADING = /^[\u0000- ]+/u;

/** Whether a URL value runs script when a browser follows or loads it. */
function isScriptUrl(value: string): boolean {
  return SCRIPT_URL.test(value.replace(URL_STRIPPED, "").replace(URL_LEADING, ""));
}

/** The findings in the order they are reported for one narrative. */
const REPORT_ORDER: readonly ValidationCode[] = [
  "NARRATIVE_UNREADABLE",
  "NARRATIVE_ROOT_INVALID",
  "NARRATIVE_ACTIVE_CONTENT",
  "NARRATIVE_ELEMENT_ILLEGAL",
  "NARRATIVE_ATTRIBUTE_ILLEGAL",
  "NARRATIVE_BLOCK_IN_PARAGRAPH",
  "NARRATIVE_EMPTY",
];

/** Whether a character is XML whitespace (XML 1.0 §2.3 `S`). */
function isXmlWhitespace(c: string): boolean {
  return c === " " || c === "\t" || c === "\n" || c === "\r";
}

/** Whether text holds a character other than XML whitespace. */
function hasContent(text: string): boolean {
  for (const c of text) {
    if (!isXmlWhitespace(c)) return true;
  }
  return false;
}

/** The prefix and local part of a qualified name; the prefix is `""` when there is none. */
function splitName(name: string): { readonly prefix: string; readonly local: string } {
  const colon = name.indexOf(":");
  return colon === -1
    ? { prefix: "", local: name }
    : { prefix: name.slice(0, colon), local: name.slice(colon + 1) };
}

/** The prefix a namespace declaration binds (`""` for `xmlns`), or `undefined` for any other name. */
function declaredPrefix(name: string): string | undefined {
  if (name === "xmlns") return "";
  return name.startsWith("xmlns:") ? name.slice(6) : undefined;
}

/** One element waiting to be checked, with the namespace bindings and paragraph state it inherits. */
interface Pending {
  readonly element: XmlElement;
  readonly scope: ReadonlyMap<string, string>;
  readonly inParagraph: boolean;
}

/**
 * The findings for one narrative string, as a set of codes. Never throws: a string the XML reader
 * refuses is `NARRATIVE_UNREADABLE`, and nothing further is asked of it.
 */
function narrativeFindings(div: string): Set<ValidationCode> {
  const found = new Set<ValidationCode>();
  let root: XmlElement;
  try {
    root = readRawXml(div);
  } catch {
    // The reader throws only its own typed refusals (a malformed document, a DTD, an undefined
    // entity, a CDATA section, nesting past its bound), and each one means the same thing here.
    found.add("NARRATIVE_UNREADABLE");
    return found;
  }

  let content = false;
  const initial = new Map<string, string>([
    ["", ""],
    ["xml", XML_NAMESPACE],
  ]);
  const stack: Pending[] = [{ element: root, scope: initial, inParagraph: false }];
  let isRoot = true;
  while (stack.length > 0) {
    const { element, scope: inherited, inParagraph } = stack.pop() as Pending;

    let scope = inherited;
    for (const attribute of element.attributes) {
      const prefix = declaredPrefix(attribute.name);
      if (prefix === undefined) continue;
      if (scope === inherited) scope = new Map(inherited);
      (scope as Map<string, string>).set(prefix, attribute.value);
    }

    const { prefix, local } = splitName(element.name);
    const namespace = scope.get(prefix);
    const xhtml = namespace === XHTML_NAMESPACE;

    const active = ACTIVE_ELEMENTS.has(local.toLowerCase());
    if (active) found.add("NARRATIVE_ACTIVE_CONTENT");
    if (isRoot) {
      if (!xhtml || local !== "div") found.add("NARRATIVE_ROOT_INVALID");
      isRoot = false;
    } else if (!active && (!xhtml || !ALLOWED_ELEMENTS.has(local))) {
      found.add("NARRATIVE_ELEMENT_ILLEGAL");
    }
    if (xhtml && inParagraph && BLOCK_ELEMENTS.has(local))
      found.add("NARRATIVE_BLOCK_IN_PARAGRAPH");
    if (xhtml && local === "img") content = true;

    for (const attribute of element.attributes) {
      const name = attribute.name;
      if (name.toLowerCase().startsWith("on")) {
        found.add("NARRATIVE_ACTIVE_CONTENT");
        continue;
      }
      if (URL_ATTRIBUTES.has(name) && isScriptUrl(attribute.value)) {
        found.add("NARRATIVE_ACTIVE_CONTENT");
      }
      if (
        name.startsWith("xmlns") ||
        ALLOWED_ATTRIBUTES.has(name) ||
        ALLOWED_ELEMENT_ATTRIBUTES.has(`${local}.${name}`)
      ) {
        continue;
      }
      found.add("NARRATIVE_ATTRIBUTE_ILLEGAL");
    }

    const childInParagraph = inParagraph || (xhtml && local === "p");
    const children: readonly XmlNode[] = element.children;
    // Pushed in reverse so the walk visits children in document order; the order changes no
    // finding, since each code is a set member, but it keeps the walk easy to follow in a debugger.
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i] as XmlNode;
      if (child.type === "text") {
        if (!content && hasContent(child.value)) content = true;
        continue;
      }
      stack.push({ element: child, scope, inParagraph: childInParagraph });
    }
  }
  if (!content) found.add("NARRATIVE_EMPTY");
  return found;
}

/** Report the findings for the `div` of one `Narrative` node at `path`. */
function checkNarrative(narrative: FhirComplex, path: string, issues: ValidationIssue[]): void {
  const div = getProperty(narrative, "div");
  if (div === undefined) return;
  const at = childPath(path, "div");
  if (!isPrimitive(div)) {
    issues.push(validationIssue("NARRATIVE_UNREADABLE", ISSUE_SEVERITIES.ERROR, at));
    return;
  }
  // A `div` with no value carries only an id or extensions on its `_div` sibling: there is no
  // narrative here to check.
  if (div.value === undefined) return;
  if (typeof div.value !== "string") {
    issues.push(validationIssue("NARRATIVE_UNREADABLE", ISSUE_SEVERITIES.ERROR, at));
    return;
  }
  const found = narrativeFindings(div.value);
  for (const code of REPORT_ORDER) {
    if (found.has(code)) {
      issues.push(validationIssue(code, ISSUE_SEVERITIES.ERROR, at, NARRATIVE_CONSTRAINT[code]));
    }
  }
}

/**
 * The R4 constraint on `Narrative.div` a finding is a breach of, carried on the finding as its
 * `constraint`: `txt-1` (only the basic HTML formatting elements and attributes, no active content)
 * and `txt-2` (some non-whitespace content). The root and paragraph findings are breaches of the
 * XHTML the `xhtml` datatype requires, not of either constraint, and carry no key.
 */
const NARRATIVE_CONSTRAINT: Readonly<Partial<Record<ValidationCode, string>>> = {
  NARRATIVE_ELEMENT_ILLEGAL: "txt-1",
  NARRATIVE_ATTRIBUTE_ILLEGAL: "txt-1",
  NARRATIVE_ACTIVE_CONTENT: "txt-1",
  NARRATIVE_EMPTY: "txt-2",
};

/** One resource waiting to be visited, with the location of its root. */
interface PendingResource {
  readonly resource: FhirComplex;
  readonly path: string;
}

/**
 * The complex nodes at `name` on `node`, each with its location: one for a single object, one per
 * object item for a list. A primitive or a nested list in that position holds no resource or
 * narrative and is left to the layers that report its shape.
 */
function complexesAt(
  node: FhirComplex,
  name: string,
  path: string,
): { readonly node: FhirComplex; readonly path: string }[] {
  const value = getProperty(node, name);
  if (value === undefined) return [];
  const at = childPath(path, name);
  if (isComplex(value)) return [{ node: value, path: at }];
  if (!isList(value)) return [];
  const out: { node: FhirComplex; path: string }[] = [];
  const items: readonly FhirNode[] = value.items;
  for (let i = 0; i < items.length; i++) {
    const item = items[i] as FhirNode;
    if (isComplex(item)) out.push({ node: item, path: `${at}[${String(i)}]` });
  }
  return out;
}

/**
 * Collect the narrative findings for a resource and every resource it carries.
 *
 * @param resource - The resource model.
 * @param root - The location of the resource root, as the validator built it.
 * @returns The value-free {@link ValidationIssue}s, the resource's own narrative first.
 * @internal
 */
export function collectNarrativeIssues(resource: FhirComplex, root: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const pending: PendingResource[] = [{ resource, path: root }];
  // A queue rather than a stack: the resource's own narrative is reported before those of the
  // resources inside it, in document order.
  for (let next = 0; next < pending.length; next++) {
    const { resource: current, path } = pending[next] as PendingResource;
    for (const text of complexesAt(current, "text", path))
      checkNarrative(text.node, text.path, issues);
    for (const inner of complexesAt(current, "contained", path)) {
      pending.push({ resource: inner.node, path: inner.path });
    }
    const type = resourceType(current);
    if (type === "Bundle") {
      for (const entry of complexesAt(current, "entry", path)) {
        for (const inner of complexesAt(entry.node, "resource", entry.path)) {
          pending.push({ resource: inner.node, path: inner.path });
        }
        for (const response of complexesAt(entry.node, "response", entry.path)) {
          for (const inner of complexesAt(response.node, "outcome", response.path)) {
            pending.push({ resource: inner.node, path: inner.path });
          }
        }
      }
    } else if (type === "Parameters") {
      // `part` repeats the shape of `parameter` to any depth, so it is walked with its own queue.
      const parameters = complexesAt(current, "parameter", path);
      for (let p = 0; p < parameters.length; p++) {
        const parameter = parameters[p] as { node: FhirComplex; path: string };
        for (const inner of complexesAt(parameter.node, "resource", parameter.path)) {
          pending.push({ resource: inner.node, path: inner.path });
        }
        for (const part of complexesAt(parameter.node, "part", parameter.path))
          parameters.push(part);
      }
    }
  }
  return issues;
}
