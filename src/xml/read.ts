/**
 * The XML read path: a raw {@link XmlElement} tree → the immutable {@link FhirNode} model (xml.html).
 * It is **not identical** to the model the JSON reader builds; {@link ./equivalence.js nodesEquivalent}
 * enumerates the differences equivalence is defined modulo, and is the oracle for them.
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
 *   never routed through a `number`. Cross-format *equivalence* therefore accounts for it (see
 *   {@link ./equivalence.js}).
 * - **A repeating element becomes a list**; a single occurrence is a single node (JSON always uses an
 *   array for a repeatable element, an irreducible schema-free ambiguity, reconciled by the
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
 *   and flagged rather than guessed at. An element in a namespace other than its parent's is
 *   flagged wherever it appears; a **prefixed** one additionally keeps its tag, which is what stops
 *   it from being read as the FHIR element beside it.
 *
 * The narrative `<div>` (XHTML) is carried **opaquely** as its full serialized string, the same
 * representation FHIR JSON uses for `Narrative.div`, so it round-trips as `<div>…</div>` and is
 * never dropped or escaped into an attribute; its XHTML structure is not modeled or validated
 * (matching the JSON codec's fidelity). It is recognised by its **expanded name**
 * (`{http://www.w3.org/1999/xhtml}div`), so a document that spells the XHTML namespace with a prefix
 * carries the same narrative as one that makes it the default, and the string it is carried as
 * includes the namespace declarations the element inherited **and uses**, so the fragment stands on
 * its own. It is recognised **before** the resource-valued unwrap, because the content of a
 * narrative is XHTML and the unwrap's UpperCamelCase test is a FHIR-vocabulary heuristic: applied
 * inside a narrative it read `<div>Take 5 mg<BR/></div>` as a contained `BR` resource and destroyed
 * the prose. A `div` in another namespace is separated from the narrative only where its tag carries
 * a prefix; the unprefixed spelling still reaches `Narrative.div` and is reported rather than
 * separated, exactly as before. Reading is otherwise lenient (Postel's Law): nothing here is
 * rejected. **Lenient does not mean lossless, and the two halves differ.** An element in an
 * unexpected namespace is modeled and flagged; non-whitespace character data written directly on a
 * FHIR element is **dropped** and flagged, because a FHIR element carries its value in `value=`
 * (§2.6.1) and there is no slot on the model for text. Wherever `hasStrayText` observes such text
 * the node is also **marked** ({@link ../model/node.js} `isDroppedText`), which is what the safety
 * layer reads: the flag says the position was odd, the marker says content is missing from it, and
 * only the second can stop an affirmative verdict being computed over an element the document did
 * fill in. **`hasStrayText` is the scope of both, and it is narrower than "any character data":** it
 * tests JS `String.trim()`, whose whitespace set is wider than XML's S production and is not one
 * Unicode category: it spans U+00A0 and the Zs block, U+2028 (Zl) and U+2029 (Zp), U+FEFF (Cf), and
 * VT/FF. Character data made only of those is dropped with neither a flag nor a marker. That gap is
 * unchanged from every release that has had this code; do not read either sentence as covering it.
 * Only genuinely unrecoverable input (a malformed document, a refused DTD/entity) throws, see
 * {@link ./raw-xml.js} / {@link ./issues.js}.
 *
 * @packageDocumentation
 */

import {
  ISSUE_CODES,
  mixedXmlSpelling,
  unexpectedXmlContent,
  unknownProperty,
  type FhirIssue,
} from "../codec/issues.js";
import { childPath, rootPath, safeDerivedName } from "../model/path.js";
import type { ReadResult } from "../codec/read.js";
import {
  complex,
  list,
  markDroppedText,
  primitive,
  type FhirComplex,
  type FhirNode,
  type FhirProperty,
} from "../model/node.js";
import { readRawXml, type XmlElement, type XmlNode } from "./raw-xml.js";

/** The FHIR XML namespace; the default namespace of every FHIR resource element. */
export const FHIR_XML_NAMESPACE = "http://hl7.org/fhir";
/** The XHTML namespace of a FHIR narrative `<div>`, which is carried whole rather than flagged. */
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

/** An element together with the namespace scope it was written in and the name to model it under. */
interface ScopedElement {
  readonly element: XmlElement;
  readonly scope: NamespaceScope;
  readonly resolved: ResolvedName;
  /**
   * The name the model uses for this element. **A prefix is only a spelling within one vocabulary**,
   * so it is dropped only for an element that is in its parent's namespace; see {@link isForeign}.
   */
  readonly modelName: string;
}

/**
 * Whether an element belongs to a different vocabulary than the element containing it: its namespace
 * differs from its parent's, or its prefix resolves to nothing at all.
 *
 * **This one predicate governs both naming and flagging, and that is the point.** An expanded name is
 * a namespace *and* a local name (Namespaces in XML 1.0 §6.1), so `{urn:vendor}code` and
 * `{http://hl7.org/fhir}code` are different names. Resolving a prefix away without comparing the
 * namespace it came from would merge foreign content into the FHIR element beside it, which would
 * let a document assert FHIR content it never wrote in FHIR.
 *
 * **Every element the reader MODELS is tested by this predicate exactly once, and a `true` is
 * flagged {@link unexpectedXmlContent}.** That flag, not the name, is what covers foreign content
 * reached by a default declaration: keeping the tag verbatim additionally *separates* it from FHIR
 * content, but only where the tag carries a prefix; see {@link modelNameOf}.
 *
 * **"Every element the reader models" is the scope, and it is narrower than "every element".** A
 * child element beside a `value` attribute is not modeled at all: the primitive branch of
 * {@link buildSingle} discards it whole and reports {@link unknownProperty}, so a foreign child
 * there never reaches this predicate and never draws an `UNEXPECTED_XML_CONTENT`. That is the
 * reader's behaviour with or without namespace resolution, and it is a residual of the lenient read
 * rather than anything this predicate governs. Do not write a claim that says otherwise.
 */
function isForeign(resolved: ResolvedName, parentNamespace: string): boolean {
  return resolved.unboundPrefix || resolved.namespace !== parentNamespace;
}

/**
 * Whether a resolved name is the FHIR narrative `<div>`, by its **expanded name**
 * `{http://www.w3.org/1999/xhtml}div` (Namespaces in XML 1.0 §6.1) rather than by the spelling the
 * document happened to use.
 *
 * This is the one element FHIR *requires* in a namespace other than its parent's, so it is the one
 * place where {@link isForeign} being `true` says nothing about the content being foreign, and the
 * one place a resolved local name is used without the namespace matching the parent's. That is safe
 * here precisely because the namespace is compared (against a single fixed URI) and because what
 * the reader does with the result is carry the element as an **opaque string** rather than model any
 * FHIR structure from it.
 *
 * **What this predicate governs is the NAME, so like every other name rule in this reader it only
 * separates a spelling that carries a prefix.** A `<v:div xmlns:v="urn:vendor">` fails it, keeps its
 * tag, and is not read as `Narrative.div`. An unprefixed `<div xmlns="urn:vendor">` fails it too, but
 * its tag *is* the FHIR spelling, so it reaches the narrative slot exactly as it did before
 * namespaces were resolved at all: carried there and flagged {@link unexpectedXmlContent}, unchanged
 * by this predicate. That is the residual named on {@link modelNameOf}, and no claim here or anywhere
 * else may say a `div` in another namespace can never reach the narrative.
 *
 * An unresolvable prefix leaves {@link ResolvedName.namespace} empty, so `<f:div/>` with no `xmlns:f`
 * in scope is not the narrative either: it is the unbound-prefix residual, unchanged.
 */
function isNarrativeDiv(resolved: ResolvedName): boolean {
  return resolved.name === "div" && resolved.namespace === XHTML_NAMESPACE;
}

/**
 * The name to model an element under: its local name when it shares its parent's namespace, and
 * otherwise its tag exactly as the document wrote it. The narrative `<div>` is the single exception
 * ({@link isNarrativeDiv}): it is modeled as `div` under every spelling, because XHTML is the
 * vocabulary FHIR mandates for it.
 *
 * **What that separates, and what it does not.** A *prefixed* foreign element keeps a tag no FHIR
 * element can be spelled with (`v:code`), so it cannot group with a FHIR sibling, cannot satisfy the
 * `extension` test, cannot be read as a resource name, and cannot be read as the narrative `div`.
 * A foreign element reached by a **default** declaration (`<extension xmlns="urn:vendor">`) has no
 * prefix to keep, so its tag *is* the FHIR spelling and it does all four. That is why the flag, not
 * the name, is what the reader relies on: an unprefixed foreign element is modeled as the FHIR
 * element it is spelled as, and reported as content from another vocabulary. Reading it is
 * unchanged from before namespaces were resolved at all, so it is a residual rather than a
 * regression, but it is not covered by the separation and no claim may say it is.
 */
function modelNameOf(element: XmlElement, resolved: ResolvedName, parentNamespace: string): string {
  if (isNarrativeDiv(resolved)) return resolved.name;
  return isForeign(resolved, parentNamespace) ? element.name : resolved.name;
}

/** Pair an element with the scope in force inside it, its resolved name, and its model name. */
function scoped(
  element: XmlElement,
  parentScope: NamespaceScope,
  parentNamespace: string,
): ScopedElement {
  const scope = extendScope(element, parentScope);
  const resolved = resolveName(element.name, scope);
  return { element, scope, resolved, modelName: modelNameOf(element, resolved, parentNamespace) };
}

/**
 * Flag an element that belongs to a different vocabulary than the one containing it, at the position
 * where the document leaves that vocabulary rather than once per descendant: an element that merely
 * *inherits* a foreign namespace says nothing its ancestor did not already say.
 */
function flagForeign(
  resolved: ResolvedName,
  parentNamespace: string,
  path: string,
  issues: FhirIssue[],
): void {
  if (isForeign(resolved, parentNamespace)) issues.push(unexpectedXmlContent(path));
}

/**
 * Read a child element the model reaches **without** going through {@link buildSingle}: the resource
 * inside a resource-valued element, and a primitive's child `<extension>`s.
 *
 * Both branches take a child and model it directly, so both would otherwise skip the one place a
 * foreign namespace is reported. They route through here instead, so **every element the reader
 * models is tested by {@link isForeign} exactly once**, at the position it occupies. Without this a
 * `<extension xmlns="urn:vendor">` or a `<Patient xmlns="urn:vendor">` inside `<contained>` is
 * modeled as FHIR and reported nowhere, which is a diagnostic lost in the unsafe direction.
 */
function readNested(
  child: ScopedElement,
  path: string,
  issues: FhirIssue[],
  parentNamespace: string,
  opts: { isResource: boolean },
): FhirComplex {
  flagForeign(child.resolved, parentNamespace, path, issues);
  return readComplex(child, path, issues, opts);
}

/** Whether an XML tag name is a FHIR resource type (UpperCamelCase) vs an element name (lowerCamelCase). */
function isResourceName(name: string): boolean {
  const first = name.charAt(0);
  return first >= "A" && first <= "Z";
}

/**
 * The element children of a node, in order, each paired with the scope in force inside it and the
 * name the model gives it (which depends on the containing element's namespace).
 */
function elementChildren(
  element: XmlElement,
  scope: NamespaceScope,
  namespace: string,
): ScopedElement[] {
  return element.children
    .filter((c): c is XmlElement => c.type === "element")
    .map((c) => scoped(c, scope, namespace));
}

/** Read the `value` attribute of an element, if present. */
function valueAttribute(element: XmlElement): string | undefined {
  return element.attributes.find((a) => a.name === "value")?.value;
}

/**
 * Escape a string for use inside a double-quoted attribute value in the opaque narrative string.
 *
 * **Every attribute value written into that string goes through here, including the namespace fixup
 * {@link narrativeSource} adds.** The value can carry a `<`: the raw reader refuses a literal one in
 * an attribute but decodes `&lt;`, so `xmlns:v="urn:a&lt;b"` reaches this point as `urn:a<b`. A
 * second, laxer escaper for the fixup would put that straight back into the string unescaped, and
 * since the writer emits `Narrative.div` verbatim, the emitted document would not be well-formed XML
 * and would not re-read.
 */
function escapeNarrativeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

/**
 * Serialize an XML node back to a canonical string, used to carry a narrative `<div>` opaquely.
 * `extraAttributes` is emitted on this element only (never on a descendant) and carries the
 * namespace fixup computed by {@link narrativeSource}.
 */
function serializeXml(node: XmlNode, extraAttributes = ""): string {
  if (node.type === "text") {
    return node.value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  const attrs =
    node.attributes.map((a) => ` ${a.name}="${escapeNarrativeAttr(a.value)}"`).join("") +
    extraAttributes;
  const inner = node.children.map((child) => serializeXml(child)).join("");
  return node.children.length === 0
    ? `<${node.name}${attrs}/>`
    : `<${node.name}${attrs}>${inner}</${node.name}>`;
}

/** The prefix an element or attribute name carries, `""` when it carries none. */
function namePrefix(name: string): string {
  const colon = name.indexOf(":");
  return colon === -1 ? "" : name.slice(0, colon);
}

/**
 * Collect the prefixes a subtree uses but does not itself declare, i.e. the bindings it inherits
 * from outside and would lose if it were lifted out of its document.
 *
 * An element name always uses a prefix (`""` being the default namespace); an **attribute** name
 * uses one only when it carries one, because an unprefixed attribute is in no namespace at all
 * (Namespaces in XML 1.0 §6.2). A namespace declaration is a binding, not a use.
 */
function collectInheritedPrefixes(
  node: XmlNode,
  declared: ReadonlySet<string>,
  needed: Set<string>,
): void {
  if (node.type !== "element") return;
  let scope = declared;
  for (const attr of node.attributes) {
    const prefix = namespaceDeclarationPrefix(attr.name);
    if (prefix === undefined) continue;
    if (scope === declared) scope = new Set(declared);
    (scope as Set<string>).add(prefix);
  }
  if (!scope.has(namePrefix(node.name))) needed.add(namePrefix(node.name));
  for (const attr of node.attributes) {
    if (namespaceDeclarationPrefix(attr.name) !== undefined) continue;
    const prefix = namePrefix(attr.name);
    if (prefix !== "" && !scope.has(prefix)) needed.add(prefix);
  }
  for (const child of node.children) collectInheritedPrefixes(child, scope, needed);
}

/**
 * The opaque string a narrative `<div>` is carried as: the element serialized **exactly as the
 * document wrote it**, plus the namespace declarations it inherited from its ancestors and uses.
 *
 * `Narrative.div` is a self-contained XHTML fragment (the FHIR JSON representation), and this
 * element is being lifted out of the document that declared its namespaces. Without the fixup a
 * `<h:div>` whose `xmlns:h` sits on the resource element becomes a fragment with `h:` bound to
 * nothing: not namespace-well-formed, and re-emitted by the writer in that state. The declarations
 * added are the ones that were **in scope where the document wrote them**, so nothing is invented
 * and the fragment's infoset is the one the document gave it. A prefix nothing in scope binds is
 * left exactly as written rather than guessed at, matching {@link resolveName}.
 *
 * The document's own spelling is preserved rather than rewritten to the default-namespace form:
 * this is a preserving read, not a normalizing one, so a prefixed narrative is namespace-equivalent
 * to the default spelling and **not** byte-identical to it.
 */
function narrativeSource(element: XmlElement, scope: NamespaceScope): string {
  const needed = new Set<string>();
  collectInheritedPrefixes(element, new Set(), needed);
  const fixup = [...needed]
    .filter((prefix) => prefix !== "xml" && scope.has(prefix))
    .sort()
    .map((prefix) => {
      const uri = escapeNarrativeAttr(scope.get(prefix) ?? "");
      return prefix === "" ? ` xmlns="${uri}"` : ` xmlns:${prefix}="${uri}"`;
    })
    .join("");
  return serializeXml(element, fixup);
}

/**
 * Group an element's children by **model** name, preserving first-seen order (mirrors the JSON
 * grouping). Two children spelled with different prefixes that both resolve to their parent's
 * namespace are the same element repeated, so they group together; a child carrying a prefix bound
 * to any other namespace keeps its tag verbatim and therefore cannot join them.
 */
function groupChildren(children: ScopedElement[]): {
  order: string[];
  byName: Map<string, ScopedElement[]>;
} {
  const order: string[] = [];
  const byName = new Map<string, ScopedElement[]>();
  for (const child of children) {
    const name = child.modelName;
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
 * Report each grouped element whose occurrences did not all arrive under the same **expanded name**:
 * the namespace and the tag together (Namespaces in XML 1.0 §6.1), not the tag alone.
 *
 * **This is the cost of resolving prefixes, made visible rather than left to be found.** Two
 * prefixes bound to one namespace are two spellings of one name, so grouping them is the correct
 * reading, and it is the reading the same document spelled one way already gets. What changes is
 * the **count**: an element that a raw-tag read saw once now has two occurrences, and a consumer
 * that reads a `0..1` element as a single value gets nothing from a repeat, so a check can skip an
 * element it would otherwise have inspected. Raising {@link mixedXmlSpelling} here is what keeps
 * that from happening silently.
 *
 * **The namespace has to be in the comparison, because the tag alone misses the merges that are not
 * spellings of one name at all.** {@link groupChildren} keys on the model name, and two elements can
 * reach one model name carrying one tag and two different namespaces. **Do not write down how many
 * such routes there are.** The rule is the comparison itself, and an earlier draft of this very
 * docblock named two and shipped while its own differential corpus exercised four; see the trap on
 * {@link modelNameOf}, which already says a default-declared foreign element "does all four".
 * Two routes worth naming, because they are the ones a document can reach while otherwise reading as
 * conformant: a prefix **rebound between siblings**
 * (`<p:x xmlns:p="urn:a"/><p:x xmlns:p="urn:b"/>`, two foreign elements whose model name is that one
 * verbatim tag) and a **FHIR-namespace `<div/>` beside the narrative** ({@link modelNameOf} models
 * the narrative as `div` under every spelling of the XHTML namespace, so `{http://hl7.org/fhir}div`
 * groups with it). Comparing tags is silent about both, and the second is the one that costs the
 * most: `Narrative.div` is `0..1`, so the merge turns the narrative into a repeat that a single-value
 * read yields nothing from, over a document that is otherwise conformant. An element reached by a
 * **default** `xmlns` re-declaration groups with its FHIR namesake the same way, and whether that
 * group also carries {@link unexpectedXmlContent} is decided by {@link isForeign}, which compares the
 * element against **its parent's** namespace and not against the FHIR one.
 *
 * **State the predicate, not its consequence.** Three consecutive gate passes refuted a sentence
 * here that summarised which documents come out of that predicate, each narrower than the last and
 * each still wrong, because the set depends on the parent. Name the predicate and let the reader
 * evaluate it.
 *
 * The comparison can only ever add a report, never retire one: two occurrences that differ in tag
 * differ in the pair regardless of namespace. A conformant document reaches it only with occurrences
 * that share both, so it stays silent there.
 */
function reportMixedSpelling(
  order: readonly string[],
  byName: ReadonlyMap<string, ScopedElement[]>,
  path: string,
  issues: FhirIssue[],
): void {
  // The two components are compared separately rather than through a joined key: a namespace URI is
  // an attribute value this reader does not constrain, so no separator is provably unambiguous.
  const sameSpelling = (a: ScopedElement, b: ScopedElement): boolean =>
    a.element.name === b.element.name && a.resolved.namespace === b.resolved.namespace;
  for (const name of order) {
    const occurrences = byName.get(name);
    if (occurrences === undefined || occurrences.length < 2) continue;
    const first = occurrences[0];
    if (first === undefined) continue;
    if (occurrences.some((o) => !sameSpelling(o, first))) {
      issues.push(mixedXmlSpelling(childPath(path, name)));
    }
  }
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
    properties.push({ name: "resourceType", value: primitive(self.modelName) });
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
  const children = elementChildren(element, self.scope, resolved.namespace);
  const dropped = flagStrayText(element.children, path, issues);
  const { order, byName } = groupChildren(children);
  reportMixedSpelling(order, byName, path, issues);
  for (const name of order) {
    const occurrences = byName.get(name) ?? [];
    properties.push({
      name,
      value: buildNode(occurrences, childPath(path, name), issues, resolved.namespace),
    });
  }
  const node = complex(properties);
  return dropped ? markDroppedText(node) : node;
}

/** Whether any node directly under an element is non-whitespace character data. */
function hasStrayText(children: readonly XmlNode[]): boolean {
  return children.some((node) => node.type === "text" && node.value.trim() !== "");
}

/**
 * Whether `path` already carries an {@link unexpectedXmlContent} report.
 *
 * The code covers two different observations (content from another vocabulary, and character data
 * that cannot be modeled), and more than one of them can be true at one location. **This does NOT
 * make the code once-per-location across the reader:** it has one caller, the resource-valued
 * unwrap, which is the only site that asks. The other two text sites and the foreign flag can and
 * do land twice at one expression, on this release and every release before it. Widening that is a
 * change to what the reader reports at positions this slice never touched, so it is not made here.
 */
function unexpectedXmlContentAt(issues: readonly FhirIssue[], path: string): boolean {
  return issues.some((i) => i.code === ISSUE_CODES.UNEXPECTED_XML_CONTENT && i.expression === path);
}

/**
 * Flag non-whitespace character data directly under an element, **which is dropped**: a FHIR element
 * carries its value in the `value` attribute (xml.html §2.6.1), so there is no slot on the model for
 * text written there and the reader has nowhere to put it. Once per element, not once per text node.
 *
 * "Non-whitespace" is whatever JS `String.trim()` leaves, which is **wider than XML's S production**:
 * a text node of U+00A0 or U+FEFF trims to empty, so it is dropped here silently, with neither a flag
 * nor a marker. Pre-existing and deliberately not widened by the marker work: widening it changes
 * what the reader reports on documents nothing else in this change touches.
 *
 * @returns Whether any was found, so the caller can mark the node it builds. The report says a
 *   position was odd; the marker is what lets the safety layer see that content is **missing** there,
 *   and the two are separate because `UNEXPECTED_XML_CONTENT` also covers foreign content, which is
 *   modeled and loses nothing.
 */
function flagStrayText(children: readonly XmlNode[], path: string, issues: FhirIssue[]): boolean {
  if (!hasStrayText(children)) return false;
  issues.push(unexpectedXmlContent(path));
  return true;
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
  const { element, resolved, modelName } = self;
  // The narrative `<div>` is the one element FHIR *requires* in a namespace other than its parent's
  // (XHTML), so it is not foreign content there, under any spelling of that namespace. A `div` in
  // any other namespace still is, and is still flagged here -- which is the report that covers the
  // unprefixed one the name cannot separate (see `isNarrativeDiv`).
  if (!isNarrativeDiv(resolved)) flagForeign(resolved, parentNamespace, path, issues);
  const children = elementChildren(element, self.scope, resolved.namespace);
  const hasValue = valueAttribute(element) !== undefined;

  // A narrative `<div>` (XHTML) is carried **opaquely** as its full serialized string, exactly the
  // representation FHIR JSON uses for `Narrative.div` (a string). The reader does not model the XHTML
  // element tree, but it never drops or garbles it: the writer re-emits this string verbatim, so a
  // narrative round-trips as `<div>…</div>`, not an escaped attribute. (The XHTML structure itself is
  // not validated, the same fidelity as the JSON codec.) `narrativeSource` is what makes the
  // lifted-out fragment carry its own namespace declarations.
  //
  // THIS SITS BEFORE THE RESOURCE-VALUED BRANCH, AND THAT ORDER IS THE WHOLE POINT OF THE BRANCH.
  // `isResourceName` is a FHIR-vocabulary heuristic -- UpperCamelCase names a resource type -- and
  // the content of `Narrative.div` is XHTML, a vocabulary where it means nothing. Applied there it
  // read `<div>Take 5 mg<BR/></div>` as a contained `BR` resource: the prose was destroyed with no
  // diagnostic at all, the document read `valid: true`, and the writer re-emitted the `<div>`
  // stripped of the XHTML namespace so the re-read came back clean. HTML-4-era generators do emit
  // `<BR>`, `<TABLE>`, `<P>`, so that is realistic clinical narrative. Nothing is shadowed by taking
  // the narrative first: `div` names exactly one element in R4, the only one of the 7,696 element
  // paths in profiles-types.json + profiles-resources.json whose name is `div`.
  //
  // WHAT READING THE NARRATIVE COSTS, AND THE ONLY YARDSTICK THAT SETTLES IT. Carrying the element
  // as a string necessarily stops modelling anything inside it as FHIR, so every finding the reader
  // used to raise from in there goes -- including an `UNHANDLED_MODIFIER_EXTENSION` **error**, which
  // takes such a document from `valid: false` to `valid: true`. That is not a weakening, and the
  // measurement that shows it is a comparison against THE SAME DOCUMENT SPELLED THE OTHER WAY -- a
  // default `xmlns` rather than a prefix, a lowercase child rather than an uppercase one -- not
  // against the previous release: those findings only ever existed because a narrative was not
  // recognised as one, and the twin has been `valid: true` all along. Nothing inside `Narrative.div`
  // is a FHIR modifier extension. **If you change this branch, re-run that comparison; "no finding
  // disappeared" is the wrong question here and will mislead you.**
  if (modelName === "div") {
    return primitive(narrativeSource(element, self.scope));
  }

  // A resource-valued element wraps exactly one resource element (e.g. `contained`, `entry.resource`).
  const onlyChild = children[0];
  if (!hasValue && children.length === 1 && onlyChild !== undefined) {
    // Foreign content and an unresolvable prefix both keep the tag verbatim, so neither `v:Patient`
    // nor `f:Patient` reads as a resource name; only a resource in this element's own namespace does.
    if (isResourceName(onlyChild.modelName)) {
      // The unwrap models the child and nothing else, so character data written beside it is
      // discarded. That is the same silent destruction the narrative branch above exists to stop,
      // reached through the elements that genuinely do wrap a resource, so it is reported here. The
      // text is still not preserved: there is no slot on the model for it, and minting one is a
      // separate decision.
      //
      // REPORTED AFTER THE CHILD, AND ONLY WHERE THIS LOCATION IS OTHERWISE SILENT. The child is
      // modeled AT THIS PATH, so two other things can already have reported
      // `UNEXPECTED_XML_CONTENT` here: the foreign-namespace flag at the top of this function, and
      // the child's own stray text inside `readComplex`. Raising unconditionally would emit the same
      // `code@expression` twice at a position where base emitted it once, and running last is what
      // lets one check cover both, because by then `issues` holds whatever either of them raised.
      // **The scope of that is exactly this site**: elsewhere in the reader the code does land twice
      // at one expression, unchanged from base, and no claim anywhere may read wider.
      const nested = readNested(onlyChild, path, issues, resolved.namespace, { isResource: true });
      // The REPORT is de-duplicated here (see above); the MARKER is not, because the loss happened
      // whether or not this location already carried a report for another reason. `markDroppedText`
      // is idempotent, so a wrapper and its unwrapped child both carrying text mark once.
      if (!hasStrayText(element.children)) return nested;
      if (!unexpectedXmlContentAt(issues, path)) issues.push(unexpectedXmlContent(path));
      return markDroppedText(nested);
    }
  }

  // `extension` in this element's own namespace only, as far as the NAME can carry that: a prefixed
  // `<v:extension>` keeps its tag and fails this test, so it is not promoted. An unprefixed
  // `<extension xmlns="urn:vendor">` is spelled exactly like the FHIR one and does pass it; that is
  // the residual named on `modelNameOf`, and `readNested` is what makes sure it is still reported.
  const extensionChildren = children.filter((c) => c.modelName === "extension");
  const otherChildren = children.filter((c) => c.modelName !== "extension");

  // Primitive: a `value` attribute, or no child elements beyond `extension` (incl. value-absent).
  if (hasValue || otherChildren.length === 0) {
    for (const stray of otherChildren) {
      issues.push(unknownProperty(childPath(path, stray.modelName)));
    }
    const meta: { id?: string; extension?: readonly FhirComplex[] } = {};
    const id = element.attributes.find((a) => a.name === "id")?.value;
    if (id !== undefined) meta.id = id;
    if (extensionChildren.length > 0) {
      meta.extension = extensionChildren.map((ext, i) =>
        readNested(ext, `${path}.extension[${String(i)}]`, issues, resolved.namespace, {
          isResource: false,
        }),
      );
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
    // The headline case: `<status>entered-in-error</status>` has no `value` attribute, so the
    // primitive built here holds `undefined` while the document plainly wrote a code at it. Without
    // the marker that node is indistinguishable from a `status` the sender left out, which is what
    // let an affirmative safety verdict be computed over a retraction.
    const dropped = flagStrayText(element.children, path, issues);
    const node = primitive(valueAttribute(element), meta);
    return dropped ? markDroppedText(node) : node;
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
 * serializeResource(resource); // → '{"resourceType":"Patient","active":"true"}'
 * // XML carried `active` as attribute text, so it re-emits as a JSON string rather than `true`.
 * ```
 */
export function parseResourceXml(input: string | XmlElement): ReadResult {
  const root = typeof input === "string" ? readRawXml(input) : input;
  const issues: FhirIssue[] = [];
  // The root has no parent to take a vocabulary from: it *establishes* the document's, so it is
  // always modeled by its local name and is foreign only when that vocabulary is not FHIR's.
  const scope = extendScope(root, ROOT_SCOPE);
  const resolved = resolveName(root.name, scope);
  const self: ScopedElement = { element: root, scope, resolved, modelName: resolved.name };
  const path = rootPath(self.modelName);
  // A document that declares no namespace at all is read as FHIR and not flagged, exactly as before:
  // the reader is schema-free and lenient, and refusing every unnamespaced document would reject
  // input it has always accepted. A root that names a vocabulary other than FHIR's is flagged.
  const rootIsForeign =
    resolved.unboundPrefix ||
    (resolved.namespace !== FHIR_XML_NAMESPACE && resolved.namespace !== NO_NAMESPACE);
  if (rootIsForeign) issues.push(unexpectedXmlContent(path));
  const resource = readComplex(self, path, issues, { isResource: true });
  return { resource, issues };
}
