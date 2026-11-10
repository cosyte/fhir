import { parseResource, serializeResourceXml } from "@cosyte/fhir";
import type { RawJson, RawMember } from "@cosyte/fhir";
import fc from "fast-check";
import type { Arbitrary } from "fast-check";

import {
  NULL,
  arr,
  member,
  num,
  obj,
  str,
  writeCompact,
  writeStyled,
  type JsonStyle,
} from "./json.js";
import { resourceTree, type ResourceOptions } from "./resource.js";
import { token } from "./values.js";

/**
 * The raw-text generators: messy JSON and XML a reader accepts, and hostile input it may refuse.
 *
 * @packageDocumentation
 */

/**
 * The content quirks a messy JSON document may carry. Each is something real senders write that
 * the reader accepts and the writer hands back or tidies: a `_` sibling before its value, an
 * element the schema does not know, an empty array, a `null` where FHIR defines none, and an array
 * inside an array.
 *
 * @internal
 */
export interface JsonQuirks {
  /** Write each `_` sibling before the value it belongs to. */
  readonly siblingFirst: boolean;
  /** Add an element no schema defines. */
  readonly unknownElement: boolean;
  /** Add an empty array, which the writer leaves out. */
  readonly emptyArray: boolean;
  /** Add a bare `null` (`UNDEFINED_JSON_NULL`). */
  readonly undefinedNull: boolean;
  /** Add an array inside an array (`NESTED_ARRAY`). */
  readonly nestedArray: boolean;
}

/**
 * Put every `_` sibling ahead of its value, at every depth.
 *
 * @internal
 */
export function siblingsFirst(node: RawJson): RawJson {
  if (node.t === "arr") return arr(node.items.map(siblingsFirst));
  if (node.t !== "obj") return node;
  const members = node.members.map((m) => member(m.key, siblingsFirst(m.value)));
  for (let i = 0; i + 1 < members.length; i++) {
    const [a, b] = [members[i] as RawMember, members[i + 1] as RawMember];
    if (b.key === `_${a.key}`) {
      members[i] = b;
      members[i + 1] = a;
      i++;
    }
  }
  return obj(members);
}

/**
 * Apply content quirks to a generated resource, at its root.
 *
 * @internal
 */
export function applyJsonQuirks(tree: RawJson, quirks: JsonQuirks, text: string): RawJson {
  const root = quirks.siblingFirst ? siblingsFirst(tree) : tree;
  /* v8 ignore next -- a generated resource is always an object */
  if (root.t !== "obj") return root;
  const extra: RawMember[] = [];
  // The names start with `zz`, which no generated resource uses, so none repeats a member.
  if (quirks.unknownElement) extra.push(member("zzUnknown", obj([member("note", str(text))])));
  if (quirks.emptyArray) extra.push(member("zzEmpty", arr([])));
  if (quirks.undefinedNull) extra.push(member("zzNull", NULL));
  if (quirks.nestedArray) extra.push(member("zzNested", arr([arr([str(text), num("1.50")])])));
  return obj([...root.members, ...extra]);
}

/**
 * The styles a messy JSON writer uses.
 *
 * @internal
 */
function jsonStyle(): Arbitrary<JsonStyle> {
  return fc.record({
    indent: fc.constantFrom("", " ", "  ", "    ", "\t"),
    eol: fc.constantFrom("\n" as const, "\r\n" as const),
    beforeColon: fc.constantFrom("", " "),
    afterColon: fc.constantFrom("", " ", "  "),
    asciiOnly: fc.boolean(),
    escapeSlash: fc.boolean(),
    resourceTypeLast: fc.boolean(),
  });
}

/**
 * Generate JSON text of a resource that the reader accepts, messy on purpose: pretty-printed or on
 * one line, any indentation, `\r\n` line endings, spaces around colons, characters outside ASCII
 * written as `\u` escapes, `/` written as `\/`, `resourceType` last, a `_` sibling before its value,
 * and sometimes an element no schema defines, an empty array, a bare `null` or an array inside an
 * array. The reader never refuses it, reports each `null` and nested array it finds, and the
 * writer can always write the model back.
 *
 * @param options The resource types, extensions, narrative and list sizes.
 * @returns An arbitrary of the JSON text.
 * @example
 * ```ts
 * import fc from "fast-check";
 * import { parseResource } from "@cosyte/fhir";
 * import { resourceJson } from "@cosyte/fhir/arbitraries";
 *
 * fc.assert(
 *   fc.property(resourceJson(), (text) => {
 *     parseResource(text); // never throws for this text
 *   }),
 * );
 * ```
 */
export function resourceJson(options: ResourceOptions = {}): Arbitrary<string> {
  const quirks: Arbitrary<JsonQuirks> = fc.record({
    siblingFirst: fc.boolean(),
    unknownElement: fc.boolean(),
    emptyArray: fc.boolean(),
    undefinedNull: fc.boolean(),
    nestedArray: fc.boolean(),
  });
  return fc
    .record({
      tree: resourceTree(options),
      style: jsonStyle(),
      quirks: fc.oneof(
        { weight: 1, arbitrary: quirks },
        { weight: 1, arbitrary: fc.constant(NO_QUIRKS) },
      ),
      text: token(6),
      lead: fc.constantFrom("", " ", "\n", "\r\n\t"),
      trail: fc.constantFrom("", "\n", "\r\n", "  "),
    })
    .map(
      ({ tree, style, quirks: q, text, lead, trail }) =>
        lead + writeStyled(applyJsonQuirks(tree, q, text), style) + trail,
    );
}

/**
 * No content quirks.
 *
 * @internal
 */
const NO_QUIRKS: JsonQuirks = {
  siblingFirst: false,
  unknownElement: false,
  emptyArray: false,
  undefinedNull: false,
  nestedArray: false,
};

/**
 * How a messy XML document is spelled: an XML declaration, a namespace prefix for FHIR's
 * namespace, indentation, comments between elements, single-quoted attributes, and characters
 * outside ASCII as character references.
 *
 * @internal
 */
export interface XmlStyle {
  readonly declaration: boolean;
  readonly prefix: string | undefined;
  readonly indent: string;
  readonly eol: "\n" | "\r\n";
  readonly comments: boolean;
  readonly singleQuotes: boolean;
  readonly charRefs: boolean;
}

/** A start, end or empty tag as the library's XML writer spells one. */
const TAG = /<(\/?)([A-Za-z][\w.-]*)((?:\s+[^\s="]+="[^"]*")*)(\s*\/?)>/gu;

/**
 * Re-spell one attribute list in a style.
 *
 * @internal
 */
function styleAttributes(attributes: string, style: XmlStyle): string {
  return attributes.replace(
    /(\s+)([^\s="]+)="([^"]*)"/gu,
    (_, space: string, name: string, value: string) => {
      let v = value;
      if (style.charRefs) {
        v = v.replace(
          /[\u0080-\u{10ffff}]/gu,
          (ch) => `&#x${(ch.codePointAt(0) as number).toString(16)};`,
        );
      }
      if (style.prefix !== undefined && name === "xmlns")
        return `${space}xmlns:${style.prefix}="${v}"`;
      if (style.singleQuotes) {
        return `${space}${name}='${v.replaceAll("'", "&apos;").replaceAll("&quot;", '"')}'`;
      }
      return `${space}${name}="${v}"`;
    },
  );
}

/**
 * Re-spell the FHIR part of an XML document (everything but a narrative) in a style: each tag
 * prefixed and its attributes re-quoted, and whitespace or a comment between tags.
 *
 * @internal
 */
export function styleFhirXml(xml: string, style: XmlStyle, depthAtStart: number): string {
  let depth = depthAtStart;
  let out = "";
  let last = 0;
  for (const match of xml.matchAll(TAG)) {
    const [whole, close = "", name = "", attributes = "", end = ""] = match;
    const between = xml.slice(last, match.index);
    last = match.index + whole.length;
    if (close === "/") depth--;
    const gap =
      between === "" && style.indent !== ""
        ? style.eol + style.indent.repeat(Math.max(0, depth))
        : between;
    const note = style.comments && between === "" && depth > 0 ? `<!-- ${name} -->` : "";
    const tagName = style.prefix === undefined ? name : `${style.prefix}:${name}`;
    out += `${gap}${note}<${close}${tagName}${styleAttributes(attributes, style)}${end}>`;
    if (close === "" && !end.endsWith("/")) depth++;
  }
  return out + xml.slice(last);
}

/** The opening of a generated narrative, which is XHTML and kept exactly as written. */
const DIV_OPEN = '<div xmlns="http://www.w3.org/1999/xhtml">';

/**
 * Re-spell an XML document in a style, leaving its narrative exactly as written.
 *
 * @internal
 */
export function styleXml(xml: string, style: XmlStyle): string {
  const start = xml.indexOf(DIV_OPEN);
  let body: string;
  if (start === -1) {
    body = styleFhirXml(xml, style, 0);
  } else {
    const end = xml.indexOf("</div>", start) + "</div>".length;
    const head = xml.slice(0, start);
    const depth = head.split(/<[A-Za-z]/u).length - head.split(/<\/|\/>/u).length;
    body =
      styleFhirXml(head, style, 0) +
      xml.slice(start, end) +
      styleFhirXml(xml.slice(end), style, depth);
  }
  const declaration = style.declaration ? `<?xml version="1.0" encoding="UTF-8"?>${style.eol}` : "";
  return declaration + body;
}

/**
 * The styles a messy XML writer uses.
 *
 * @internal
 */
function xmlStyle(): Arbitrary<XmlStyle> {
  return fc.record({
    declaration: fc.boolean(),
    prefix: fc.option(fc.constantFrom("f", "fhir", "h7"), { nil: undefined }),
    indent: fc.constantFrom("", " ", "  ", "\t"),
    eol: fc.constantFrom("\n" as const, "\r\n" as const),
    comments: fc.boolean(),
    singleQuotes: fc.boolean(),
    charRefs: fc.boolean(),
  });
}

/**
 * Generate FHIR XML text of a resource that the reader accepts, messy on purpose: an XML
 * declaration, FHIR's namespace bound to a prefix, indentation, `\r\n` line endings, comments
 * between elements, single-quoted attributes, and characters outside ASCII as character
 * references. The resource underneath is one {@link resource} generates, so the reader builds a
 * model equivalent to it, with no issue.
 *
 * @param options The resource types, extensions, narrative and list sizes.
 * @returns An arbitrary of the XML text.
 * @example
 * ```ts
 * import fc from "fast-check";
 * import { parseResourceXml } from "@cosyte/fhir";
 * import { resourceXml } from "@cosyte/fhir/arbitraries";
 *
 * fc.assert(
 *   fc.property(resourceXml(), (text) => parseResourceXml(text).issues.length === 0),
 * );
 * ```
 */
export function resourceXml(options: ResourceOptions = {}): Arbitrary<string> {
  return fc
    .tuple(resourceTree(options), xmlStyle())
    .map(([tree, style]) =>
      styleXml(serializeResourceXml(parseResource(writeCompact(tree)).resource), style),
    );
}

/** Options for {@link hostileInput}. */
export interface HostileInputOptions {
  /** The longest random string. Defaults to 200. */
  readonly maxLength?: number;
  /** Which reader the structured part aims at. Defaults to both. */
  readonly format?: "json" | "xml";
}

/**
 * One edit to a document's text: cut it short, delete a run, or insert random text.
 *
 * @internal
 */
export type Edit =
  | { readonly kind: "cut"; readonly at: number }
  | { readonly kind: "delete"; readonly at: number; readonly length: number }
  | { readonly kind: "insert"; readonly at: number; readonly text: string };

/**
 * Apply edits to text, each position taken modulo the text's length at that point.
 *
 * @internal
 */
export function applyEdits(text: string, edits: readonly Edit[]): string {
  let out = text;
  for (const edit of edits) {
    const at = edit.at % (out.length + 1);
    if (edit.kind === "cut") out = out.slice(0, at);
    else if (edit.kind === "delete") out = out.slice(0, at) + out.slice(at + edit.length);
    else out = out.slice(0, at) + edit.text + out.slice(at);
  }
  return out;
}

/**
 * JSON a reader has to refuse or report: the shapes a fuzzer aims at.
 *
 * @internal
 */
function hostileJson(): Arbitrary<string> {
  const depth = fc.integer({ min: 200, max: 400 });
  return fc.oneof(
    depth.map((n) => "[".repeat(n) + "]".repeat(n)),
    depth.map((n) => `{"resourceType":"Patient","a":${'{"a":'.repeat(n)}1${"}".repeat(n + 1)}`),
    fc.constantFrom(
      "",
      "null",
      "[]",
      '"Patient"',
      "{}",
      '{"resourceType":5}',
      '{"resourceType":["Patient"]}',
      '{"resourceType":null}',
      '{"resourceType":"Patient","resourceType":"Observation"}',
      '{"resourceType":"Observation","status":"final","status":"entered-in-error"}',
      '{"resourceType":"Patient","name":[{"given":["a","b"],"_given":[null]}]}',
      '{"resourceType":"Patient","_active":[{"id":"a"}],"active":true}',
      '{"resourceType":"Observation","valueQuantity":{"value":1e999999}}',
      '{"resourceType":"Observation","valueQuantity":{"value":-0.000000000000000000000001}}',
      '{"resourceType":"Observation","valueInteger":123456789012345678901234567890}',
      '{"resourceType":"Observation","status":"\\ud800"}',
      '{"resourceType":"<bad name/>"}',
      '{"resourceType":"Patient","bad name":true}',
      '{"resourceType":"Patient"',
      '{"resourceType":"Patient",}',
      '﻿{"resourceType":"Patient"}',
    ),
  );
}

/**
 * XML a reader has to refuse or report: entities, DTDs, depth and stray text.
 *
 * @internal
 */
function hostileXml(): Arbitrary<string> {
  return fc.oneof(
    fc
      .integer({ min: 200, max: 400 })
      .map(
        (n) =>
          `<Patient xmlns="http://hl7.org/fhir">${"<a>".repeat(n)}${"</a>".repeat(n)}</Patient>`,
      ),
    fc.constantFrom(
      "",
      "<",
      "<Patient",
      '<Patient xmlns="http://hl7.org/fhir">',
      '<?xml version="1.0"?><!DOCTYPE Patient [<!ENTITY x "y">]><Patient xmlns="http://hl7.org/fhir"><id value="&x;"/></Patient>',
      '<!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;">]><Patient xmlns="http://hl7.org/fhir">&lol2;</Patient>',
      '<Patient xmlns="http://hl7.org/fhir"><id value="&nope;"/></Patient>',
      '<Observation xmlns="http://hl7.org/fhir"><status>entered-in-error</status></Observation>',
      '<Observation xmlns="urn:vendor"><status value="final"/></Observation>',
      '<v:Observation xmlns:v="urn:vendor"><status value="final"/></v:Observation>',
      '<x:Patient><active value="true"/></x:Patient>',
      '<Patient xmlns="http://hl7.org/fhir"><active value="yes"/><active value="true"/></Patient>',
      '<Patient xmlns="http://hl7.org/fhir"><text><div xmlns="http://www.w3.org/1999/xhtml"><p>a</div></text></Patient>',
      '<Patient xmlns="http://hl7.org/fhir"><name><given value="a&#0;b"/></name></Patient>',
    ),
  );
}

/**
 * Generate hostile input for the readers: random strings, documents from {@link resourceJson} and
 * {@link resourceXml} cut short or with text inserted and deleted, nesting deeper than the readers'
 * bound, repeated property names, misaligned `_` siblings, numbers past a double's range, a byte
 * order mark, `resourceType` games, DTDs and entity expansion, undefined entities, character data
 * on a FHIR element, and a vendor namespace. A reader must turn each into a model with issues, or
 * refuse it with one of its documented fatal errors, and never throw anything else.
 *
 * @param options The longest random string, and which reader to aim at.
 * @returns An arbitrary of the input text.
 * @example
 * ```ts
 * import fc from "fast-check";
 * import { FhirCodecError, parseResource } from "@cosyte/fhir";
 * import { hostileInput } from "@cosyte/fhir/arbitraries";
 *
 * fc.assert(
 *   fc.property(hostileInput({ format: "json" }), (text) => {
 *     try {
 *       parseResource(text);
 *     } catch (err) {
 *       return err instanceof FhirCodecError;
 *     }
 *     return true;
 *   }),
 * );
 * ```
 */
export function hostileInput(options: HostileInputOptions = {}): Arbitrary<string> {
  const maxLength = options.maxLength ?? 200;
  const randomText = fc.string({ unit: "binary", maxLength });
  const edit: Arbitrary<Edit> = fc.oneof(
    fc.nat().map((at) => ({ kind: "cut" as const, at })),
    fc
      .tuple(fc.nat(), fc.integer({ min: 1, max: 20 }))
      .map(([at, length]) => ({ kind: "delete" as const, at, length })),
    fc
      .tuple(fc.nat(), fc.string({ unit: "binary", minLength: 1, maxLength: 8 }))
      .map(([at, text]) => ({ kind: "insert" as const, at, text })),
  );
  const small: ResourceOptions = { maxRepeats: 2 };
  const json = fc.oneof(
    hostileJson(),
    fc
      .tuple(resourceJson(small), fc.array(edit, { minLength: 1, maxLength: 4 }))
      .map(([t, e]) => applyEdits(t, e)),
    fc
      .tuple(fc.constantFrom('{"resourceType":"', '{"resourceType":"Patient",'), randomText)
      .map(([h, t]) => h + t),
  );
  const xml = fc.oneof(
    hostileXml(),
    fc
      .tuple(resourceXml(small), fc.array(edit, { minLength: 1, maxLength: 4 }))
      .map(([t, e]) => applyEdits(t, e)),
    fc
      .tuple(fc.constantFrom("<Patient ", '<Patient xmlns="http://hl7.org/fhir">'), randomText)
      .map(([h, t]) => h + t),
  );
  const aimed =
    options.format === "json" ? json : options.format === "xml" ? xml : fc.oneof(json, xml);
  return fc.oneof({ weight: 1, arbitrary: randomText }, { weight: 3, arbitrary: aimed });
}
