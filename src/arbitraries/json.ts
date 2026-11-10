import type { RawArray, RawJson, RawMember, RawObject } from "@cosyte/fhir";

/**
 * The raw JSON tree the generators build documents in, and the two writers that turn it into text:
 * the canonical one the library's writer agrees with byte for byte, and a messy one with the
 * spellings a real sender uses. The tree is the library's own {@link RawJson}, so a decimal stays
 * its exact text from the generator to the wire.
 *
 * @internal
 * @packageDocumentation
 */

/**
 * A string node.
 *
 * @internal
 */
export function str(value: string): RawJson {
  return { t: "str", value };
}

/**
 * A number node, kept as its exact text.
 *
 * @internal
 */
export function num(raw: string): RawJson {
  return { t: "num", raw };
}

/**
 * A boolean node.
 *
 * @internal
 */
export function bool(value: boolean): RawJson {
  return { t: "bool", value };
}

/**
 * The `null` node.
 *
 * @internal
 */
export const NULL: RawJson = { t: "null" };

/**
 * An array node.
 *
 * @internal
 */
export function arr(items: readonly RawJson[]): RawArray {
  return { t: "arr", items };
}

/**
 * An object node from members, in order.
 *
 * @internal
 */
export function obj(members: readonly RawMember[]): RawObject {
  return { t: "obj", members };
}

/**
 * One member.
 *
 * @internal
 */
export function member(key: string, value: RawJson): RawMember {
  return { key, value };
}

/**
 * Write a tree as compact JSON, `resourceType` where it stands, strings escaped the way
 * `JSON.stringify` escapes them. A spec-clean document written this way is the exact text the
 * library's writer gives back for it.
 *
 * @internal
 */
export function writeCompact(node: RawJson): string {
  switch (node.t) {
    case "str":
      return JSON.stringify(node.value);
    case "num":
      return node.raw;
    case "bool":
      return node.value ? "true" : "false";
    case "null":
      return "null";
    case "arr":
      return `[${node.items.map(writeCompact).join(",")}]`;
    case "obj":
      return `{${node.members.map((m) => `${JSON.stringify(m.key)}:${writeCompact(m.value)}`).join(",")}}`;
  }
}

/**
 * How a messy writer spells a document: its indentation, line ending, the space around a colon,
 * how it escapes strings, and where it puts `resourceType`.
 *
 * @internal
 */
export interface JsonStyle {
  /** The indentation of one level, or `""` for one line. */
  readonly indent: string;
  /** The line ending between members when indenting. */
  readonly eol: "\n" | "\r\n";
  /** The text between a key and its colon. */
  readonly beforeColon: string;
  /** The text between a colon and its value. */
  readonly afterColon: string;
  /** Write every character outside ASCII as a `\u` escape. */
  readonly asciiOnly: boolean;
  /** Write `/` as `\/`, as some PHP and Java writers do. */
  readonly escapeSlash: boolean;
  /** Move each object's `resourceType` member to the end. */
  readonly resourceTypeLast: boolean;
}

/**
 * Escape one string the way a style asks.
 *
 * @internal
 */
export function styledString(value: string, style: JsonStyle): string {
  let text = JSON.stringify(value);
  if (style.escapeSlash) text = text.replaceAll("/", "\\/");
  if (style.asciiOnly) {
    // A character outside the Basic Multilingual Plane is two UTF-16 units, escaped one by one.
    text = text.replace(/[\u0080-\u{10ffff}]/gu, (ch) =>
      Array.from(
        { length: ch.length },
        (_, i) => `\\u${ch.charCodeAt(i).toString(16).padStart(4, "0")}`,
      ).join(""),
    );
  }
  return text;
}

/**
 * Write a tree in a style. Every spelling here denotes the same JSON value, so the reader builds
 * the same model from it as from {@link writeCompact}'s text.
 *
 * @internal
 */
export function writeStyled(node: RawJson, style: JsonStyle, depth = 0): string {
  const open = style.indent === "" ? "" : style.eol + style.indent.repeat(depth + 1);
  const close = style.indent === "" ? "" : style.eol + style.indent.repeat(depth);
  switch (node.t) {
    case "str":
      return styledString(node.value, style);
    case "arr":
      if (node.items.length === 0) return "[]";
      return `[${node.items.map((item) => open + writeStyled(item, style, depth + 1)).join(",")}${close}]`;
    case "obj": {
      if (node.members.length === 0) return "{}";
      const members =
        style.resourceTypeLast && node.members[0]?.key === "resourceType"
          ? [...node.members.slice(1), node.members[0]]
          : node.members;
      const written = members.map(
        (m) =>
          `${open}${styledString(m.key, style)}${style.beforeColon}:${style.afterColon}${writeStyled(m.value, style, depth + 1)}`,
      );
      return `{${written.join(",")}${close}}`;
    }
    case "num":
    case "bool":
    case "null":
      return writeCompact(node);
  }
}
