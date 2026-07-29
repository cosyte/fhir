/**
 * The JSON read path: a {@link RawJson} tree → the immutable {@link FhirNode} model.
 *
 * This is where the three silent-data-loss hazards of a FHIR JSON codec are handled (json.html):
 *
 * 1. **Decimal precision.** Number tokens arrive from {@link readRawJson} as exact source text and
 *    become {@link FhirDecimal} values, never a JavaScript `number`. A token that a naive
 *    `JSON.parse` would have corrupted raises a value-free `DECIMAL_PRECISION_AT_RISK` issue.
 * 2. **Primitive-extension (`_`-sibling) alignment.** A primitive's value and its `id`/`extension`
 *    metadata live in two parallel JSON properties (`given` and `_given`), index-aligned with
 *    `null` placeholders for repeating primitives. The reader merges them into single
 *    {@link FhirPrimitive} nodes. If the two arrays disagree in length the alignment is broken and
 *    the reader **fails closed**, throwing `PRIMITIVE_EXTENSION_MISALIGNED` rather than guessing
 *    which value an extension belongs to (guessing could attach it to the wrong clinical value).
 * 3. **A repeated property name.** FHIR JSON requires unique names (json.html §2.6.2) and RFC 8259 §4
 *    leaves the winner undefined, so a name written twice is a defect with two equally (un)plausible
 *    values. The element keeps the first and a `DUPLICATE_PROPERTY` issue is raised, everywhere. On an
 *    **object** element the shadowed member is additionally kept on the node's `duplicates` rather
 *    than dropped, which is what lets a safety-classifying read see both values and refuse to affirm
 *    a verdict over a value it did not rank, instead of quietly reporting the one it happened to
 *    keep. Inside a **primitive's `_`-sibling** the shadowed member is not modeled and the read is
 *    flagged only, for the reason given on {@link readMeta}.
 *
 * 4. **A nested array.** An array's items are a repeating element's occurrences (json.html §2.6.2.2),
 *    so an array of arrays describes no element. The reader keeps everything the inner array held,
 *    as a nested {@link FhirList}, and raises `NESTED_ARRAY`. It used to read as an empty complex
 *    and the inner value was simply gone, under a warning that said only "unknown property"; the
 *    rewritten document was then clean, so a read → write → read cycle lost the finding as well.
 *    Nothing reads a *value* out of a nested list, so this is preserve-and-refuse, not
 *    preserve-and-interpret: the shape has no meaning to guess at.
 *
 * Reading is lenient elsewhere (Postel's Law): an unexpected shape is preserved and flagged, not
 * rejected. Only genuinely unrecoverable structure (malformed JSON, broken `_`-alignment) throws.
 *
 * @packageDocumentation
 */

import { decimal, wouldLosePrecisionAsDouble } from "../model/decimal.js";
import {
  complex,
  list,
  primitive,
  type FhirComplex,
  type FhirNode,
  type PrimitiveMeta,
  type PrimitiveValue,
} from "../model/node.js";
import {
  decimalPrecisionAtRisk,
  duplicateProperty,
  nestedArray,
  unknownProperty,
  FATAL_CODES,
  FhirCodecError,
  type FhirIssue,
} from "./issues.js";
import { readRawJson, type RawArray, type RawJson, type RawObject } from "./raw-json.js";

/** The result of reading a FHIR resource: the model plus any value-free issues gathered en route. */
export interface ReadResult {
  /** The parsed resource as an immutable model tree. */
  readonly resource: FhirComplex;
  /** Value-free diagnostics accumulated during the lenient read (never contains PHI). */
  readonly issues: readonly FhirIssue[];
}

/** A member a repeated JSON property name shadowed, kept rather than discarded. */
interface Shadowed {
  readonly base: string;
  readonly isMeta: boolean;
  readonly node: RawJson;
}

/** Mutable grouping of a base property with its optional `_`-sibling, in first-seen order. */
interface Grouped {
  readonly order: string[];
  readonly value: Map<string, RawJson>;
  readonly meta: Map<string, RawJson>;
  readonly shadowed: Shadowed[];
}

/**
 * Group an object's members into `{ base → value }` and `{ base → meta }` maps, preserving the
 * first-seen order of base names across both.
 *
 * FHIR JSON requires unique property names (json.html §2.6.2: "Property names SHALL be unique") and
 * expresses a repeating element as an array, so a repeated name is a document defect. RFC 8259 §4
 * leaves the winner undefined ("the behavior of software that receives such an object is
 * unpredictable"), and neither position is more authoritative than the other: whichever we picked, a
 * `status` written twice can carry the retraction on the side we dropped. So the reader ranks
 * nothing new, keeps the **first** occurrence as the element's value, and collects the rest in
 * `shadowed` so the value is still readable and the ambiguity is still visible downstream.
 *
 * @internal
 */
function group(obj: RawObject): Grouped {
  const order: string[] = [];
  const value = new Map<string, RawJson>();
  const meta = new Map<string, RawJson>();
  const shadowed: Shadowed[] = [];
  const seen = new Set<string>();
  for (const member of obj.members) {
    const isMeta = member.key.startsWith("_") && member.key.length > 1;
    const base = isMeta ? member.key.slice(1) : member.key;
    if (!seen.has(base)) {
      seen.add(base);
      order.push(base);
    }
    const target = isMeta ? meta : value;
    if (target.has(base)) shadowed.push({ base, isMeta, node: member.value });
    else target.set(base, member.value);
  }
  return { order, value, meta, shadowed };
}

/** A scalar (non-object, non-array) raw node. */
function isScalar(node: RawJson): boolean {
  return node.t === "str" || node.t === "num" || node.t === "bool" || node.t === "null";
}

/**
 * Convert a scalar raw node to a {@link PrimitiveValue} (or `undefined` for JSON null), raising a
 * precision issue for a number that a double would have corrupted.
 *
 * @internal
 */
function scalarValue(node: RawJson, path: string, issues: FhirIssue[]): PrimitiveValue | undefined {
  switch (node.t) {
    case "str":
      return node.value;
    case "bool":
      return node.value;
    case "num": {
      if (wouldLosePrecisionAsDouble(node.raw)) issues.push(decimalPrecisionAtRisk(path));
      return decimal(node.raw);
    }
    case "null":
      return undefined;
    case "obj":
    case "arr":
      // An object/array reaches here only via a malformed mixed array; treat as value-absent
      // (the caller's primitive/complex decision governs the surrounding shape).
      return undefined;
  }
}

/**
 * Read a primitive's `_`-sibling object into `{ id, extension }`.
 *
 * A repeated name here follows the **same** first-wins rule as every other object, and raises the
 * same `DUPLICATE_PROPERTY`, so the codec never resolves a duplicate two different ways. The
 * shadowed member is not carried on the model: a primitive's metadata is an R4 `Element` (`id` and
 * `extension` only, no `modifierExtension`), so nothing here feeds a safety verdict, and a slot for
 * it on every primitive node would buy no verdict. That limitation is stated on
 * {@link ../safety/status.js} `shadowedProperties`, which walks object elements.
 */
function readMeta(metaNode: RawJson | undefined, path: string, issues: FhirIssue[]): PrimitiveMeta {
  if (metaNode === undefined) return {};
  if (metaNode.t !== "obj") {
    // A `_`-sibling slot holds an object of `id`/`extension`, or JSON `null` for a position that
    // carries no metadata (json.html §2.6.2.3). Anything else has no place on the model: a
    // primitive's metadata is an R4 `Element`, so there is nowhere to put an array or a scalar. That
    // was the one route in this reader that dropped a member with **no** diagnostic at all, which is
    // the shape this codec exists to refuse. Flag it: the caller learns the location even though the
    // content cannot be modeled.
    if (metaNode.t !== "null") {
      issues.push(metaNode.t === "arr" ? nestedArray(path) : unknownProperty(path));
    }
    return {};
  }
  const result: { id?: string; extension?: readonly FhirComplex[] } = {};
  const seen = new Set<string>();
  for (const member of metaNode.members) {
    if (seen.has(member.key)) {
      issues.push(duplicateProperty(`${path}._${member.key}`));
      continue;
    }
    seen.add(member.key);
    if (member.key === "id" && member.value.t === "str") {
      result.id = member.value.value;
    } else if (member.key === "extension" && member.value.t === "arr") {
      result.extension = member.value.items.map((item, i) =>
        readComplex(item, `${path}._${member.key}[${String(i)}]`, issues),
      );
    } else {
      issues.push(unknownProperty(`${path}._${member.key}`));
    }
  }
  return result;
}

/** Coerce any raw node to a {@link FhirComplex} (objects pass through; anything else is empty). */
function readComplex(node: RawJson, path: string, issues: FhirIssue[]): FhirComplex {
  if (node.t === "obj") return buildComplex(node, path, issues);
  issues.push(node.t === "arr" ? nestedArray(path) : unknownProperty(path));
  return complex([]);
}

/**
 * Read one item of a repeating element, preserving an item that is itself an array as a **nested
 * list** rather than collapsing it.
 *
 * FHIR JSON uses an array for exactly one thing, a repeating element, and the array's items are that
 * element's occurrences (json.html §2.6.2.2). An item that is itself an array therefore describes no
 * element, and this reader used to read it as an empty {@link FhirComplex}: the inner value was
 * **dropped**, in a package whose core claim is that a read loses nothing, and the only trace was an
 * `UNKNOWN_PROPERTY` warning that does not say anything was lost. `{"name":[[{"family":"Doe"}]]}`
 * read as one nameless `HumanName`, and rewriting the model emitted `{"name":[{}]}`, so a
 * read → write → read cycle lost the warning too.
 *
 * Preserving it costs nothing structurally: {@link FhirList} items are {@link FhirNode}s, which
 * already includes {@link FhirList}, and the writer and the validator already handle one. What
 * matters is what does **not** change with it, and the line is drawn between two kinds of read.
 *
 * **No `Coding` is ever resolved out of a nested array.** `collectCodings` refuses a list item that
 * is itself a list, and `codingScalar` refuses one a `Coding.system` / `Coding.code` member holds, so
 * `codingsOf` / `codeOf` / `hasCoding` / `hasCodeAnySystem` return exactly what they returned before
 * a nested array was modeled at all. That is not tidiness: `requiredUnitsFor` takes the **first**
 * LOINC coding carrying a vital-signs units entry, so a `Coding` made readable here could beat the
 * one written beside it and erase a true `VITAL_SIGN_UNIT_NONCONFORMANT` error, and one pair
 * resolvable this way is SNOMED `716186003`, a recorded "no known allergy", which is a *positive*
 * clinical assertion. A draft of this change let the recursion through and did both.
 *
 * **The recursive fail-safe scalar reads do see through it**, by design: `primitiveStrings` /
 * `primitiveBooleans` walk lists at any depth, so `{"status":[["entered-in-error"]]}` reports its
 * retraction rather than losing it. Every check they feed asks "is this code present", so they can
 * only *add* a negation, never retire one. And a nested array is reported wherever it appears
 * ({@link ../safety/status.js} `nestedArrays`, `NESTED_ARRAY`, on every resource type at any depth),
 * so nothing is read in a place that is not also reported.
 *
 * @internal
 */
function readNestedArray(node: RawArray, path: string, issues: FhirIssue[]): FhirNode {
  issues.push(nestedArray(path));
  return list(node.items.map((item, i) => readNestedItem(item, `${path}[${String(i)}]`, issues)));
}

/**
 * Read one item **inside** a nested array, verbatim.
 *
 * There is no element here to read the item *as*, so the reader preserves the shape it was given
 * rather than coercing it: an object becomes a complex, a further array becomes a further nested
 * list, and a scalar becomes a primitive (which is the whole point, `[["x"]]` losing `"x"` is the
 * defect). No second `NESTED_ARRAY` is raised for the item itself unless it opens another array,
 * because the outer one already names the location a caller can act on.
 *
 * @internal
 */
function readNestedItem(node: RawJson, path: string, issues: FhirIssue[]): FhirNode {
  if (node.t === "arr") return readNestedArray(node, path, issues);
  if (node.t === "obj") return buildComplex(node, path, issues);
  return primitive(scalarValue(node, path, issues));
}

/**
 * Whether an array should be read as a primitive list (scalar/`null` items) vs a complex list.
 *
 * The value array's own items are authoritative, the presence of a `_`-sibling is a hint, **not**
 * proof of a primitive array. A complex array that carries a stray `_`-sibling (malformed FHIR) must
 * still be read as complex so its objects are preserved-and-flagged, never misrouted to the primitive
 * path and dropped. Only when there is no value array at all (a `_`-sibling-only, value-absent list)
 * does the `_`-sibling decide.
 */
function isPrimitiveArray(value: RawArray | undefined): boolean {
  if (value === undefined) return true; // only a `_`-sibling array → a value-absent primitive list
  const firstMeaningful = value.items.find((item) => item.t !== "null");
  return firstMeaningful === undefined || isScalar(firstMeaningful);
}

/**
 * Build a primitive list, merging the value array and its `_`-sibling array index-by-index with
 * null padding. A length disagreement between the two throws `PRIMITIVE_EXTENSION_MISALIGNED`.
 *
 * @internal
 */
function buildPrimitiveList(
  value: RawArray | undefined,
  meta: RawArray | undefined,
  path: string,
  issues: FhirIssue[],
): FhirNode {
  const valueItems = value?.items ?? [];
  const metaItems = meta?.items ?? [];
  if (value !== undefined && meta !== undefined && valueItems.length !== metaItems.length) {
    throw new FhirCodecError(
      FATAL_CODES.PRIMITIVE_EXTENSION_MISALIGNED,
      "Primitive value array and its _-sibling array have different lengths; " +
        "the null-padded alignment is broken and cannot be recovered safely.",
      { expression: path },
    );
  }
  const length = Math.max(valueItems.length, metaItems.length);
  const items: FhirNode[] = [];
  for (let i = 0; i < length; i++) {
    const itemPath = `${path}[${String(i)}]`;
    const rawValue = valueItems[i];
    // An item that is itself an array is a nested array: it holds values, so it is preserved as a
    // nested list rather than read as a value-absent slot. It occupies one array position, so the
    // `_`-sibling alignment either side of it is untouched.
    if (rawValue?.t === "arr") {
      // A `_`-sibling slot at this position has nowhere to attach: a nested list is not a primitive,
      // so it carries no `id`/`extension`. Fail **closed** rather than keep one and drop the other.
      // This is the same rule the length-disagreement case above applies, for the same reason: the
      // reader will not silently discard an `Element` a sender wrote (it can carry
      // `data-absent-reason`), and it will not guess a home for it either. An absent or `null` slot
      // is the conformant no-metadata marker and is not a disagreement, so it passes through.
      const metaItem = metaItems[i];
      if (metaItem !== undefined && metaItem.t !== "null") {
        throw new FhirCodecError(
          FATAL_CODES.PRIMITIVE_EXTENSION_MISALIGNED,
          "A primitive array position holds a nested array but its _-sibling holds metadata; a " +
            "nested array is not a primitive and cannot carry id/extension, so the alignment " +
            "cannot be recovered safely.",
          { expression: itemPath },
        );
      }
      items.push(readNestedArray(rawValue, itemPath, issues));
      continue;
    }
    // An object where a primitive value belongs (malformed mixed array) has no primitive
    // representation, flag it rather than drop it silently.
    if (rawValue !== undefined && rawValue.t === "obj") issues.push(unknownProperty(itemPath));
    const value_ = rawValue === undefined ? undefined : scalarValue(rawValue, itemPath, issues);
    const metaValue = readMeta(metaItems[i], itemPath, issues);
    items.push(primitive(value_, metaValue));
  }
  return list(items);
}

/** Build a list of complex items (`name: [{...}, {...}]`). */
function buildComplexList(
  value: RawArray,
  meta: RawJson | undefined,
  path: string,
  issues: FhirIssue[],
): FhirNode {
  if (meta !== undefined)
    issues.push(unknownProperty(`${path}` + " (unexpected _-sibling on a non-primitive array)"));
  return list(
    value.items.map((item, i) => {
      const itemPath = `${path}[${String(i)}]`;
      // A nested array holds values and is preserved as a nested list; anything else keeps the
      // pre-existing complex coercion.
      return item.t === "arr"
        ? readNestedArray(item, itemPath, issues)
        : readComplex(item, itemPath, issues);
    }),
  );
}

/** Build the node for a single base property from its value and `_`-sibling. */
function buildNode(
  value: RawJson | undefined,
  meta: RawJson | undefined,
  path: string,
  issues: FhirIssue[],
): FhirNode {
  // Arrays (repeating elements).
  if (value?.t === "arr" || (value === undefined && meta?.t === "arr")) {
    const valueArr = value?.t === "arr" ? value : undefined;
    if (isPrimitiveArray(valueArr)) {
      const metaArr = meta?.t === "arr" ? meta : undefined;
      if (meta !== undefined && meta.t !== "arr") {
        throw new FhirCodecError(
          FATAL_CODES.PRIMITIVE_EXTENSION_MISALIGNED,
          "A primitive array's _-sibling must itself be an array; found a scalar/object.",
          { expression: path },
        );
      }
      return buildPrimitiveList(valueArr, metaArr, path, issues);
    }
    // valueArr is defined here (a complex array cannot be value-absent).
    return buildComplexList(valueArr ?? { t: "arr", items: [] }, meta, path, issues);
  }

  // A complex (object) element, its id/extension are inline, so any `_`-sibling is misplaced.
  if (value?.t === "obj") {
    if (meta !== undefined)
      issues.push(unknownProperty(`${path} (unexpected _-sibling on an object)`));
    return buildComplex(value, path, issues);
  }

  // A single primitive (scalar value, and/or a `_`-sibling object of id/extension).
  if (meta !== undefined && meta.t === "arr") {
    throw new FhirCodecError(
      FATAL_CODES.PRIMITIVE_EXTENSION_MISALIGNED,
      "A single primitive's _-sibling must be an object; found an array.",
      { expression: path },
    );
  }
  const scalar = value === undefined ? undefined : scalarValue(value, path, issues);
  return primitive(scalar, readMeta(meta, path, issues));
}

/** Build a {@link FhirComplex} from a raw object, recursing through its properties. */
function buildComplex(obj: RawObject, path: string, issues: FhirIssue[]): FhirComplex {
  const grouped = group(obj);
  // Root path becomes the resource type once known, so FHIRPath expressions read `Patient.birthDate`.
  let basePath = path;
  if (path === "") {
    const rt = grouped.value.get("resourceType");
    if (rt?.t === "str") basePath = rt.value;
  }
  const properties = grouped.order.map((name) => {
    const childPath = basePath === "" ? name : `${basePath}.${name}`;
    return {
      name,
      value: buildNode(grouped.value.get(name), grouped.meta.get(name), childPath, issues),
    };
  });
  // Members a repeated property name shadowed: read them into the model too (a dropped value cannot
  // be reasoned about later) and flag each one, so a caller is never handed one arbitrary value out
  // of several with a clean result.
  const reported = new Set<string>();
  const duplicates = grouped.shadowed.map((member) => {
    const childPath = basePath === "" ? member.base : `${basePath}.${member.base}`;
    // One issue per element on this object, however many members shadowed the name here (a name and
    // its `_`-sibling can each repeat): the FHIRPath location is the same, so a second issue would
    // say nothing new. Two different objects that each repeat a name still report separately.
    if (!reported.has(member.base)) {
      reported.add(member.base);
      issues.push(duplicateProperty(childPath));
    }
    return {
      name: member.base,
      value: member.isMeta
        ? buildNode(undefined, member.node, childPath, issues)
        : buildNode(member.node, undefined, childPath, issues),
    };
  });
  return complex(properties, duplicates);
}

/**
 * Read a FHIR resource from JSON text or an already-parsed {@link RawJson} tree into the immutable
 * model, gathering value-free issues. Throws {@link FhirCodecError} on malformed JSON or broken
 * `_`-sibling alignment.
 *
 * @param input - JSON text, or a {@link RawJson} tree from {@link readRawJson}.
 * @throws FhirCodecError (`MALFORMED_JSON`) when the input is not a JSON object.
 * @throws FhirCodecError (`MAX_DEPTH_EXCEEDED`) when text input nests past the reader's depth bound.
 * @throws FhirCodecError (`PRIMITIVE_EXTENSION_MISALIGNED`) when a value/`_`-sibling pair is misaligned.
 * @example
 * ```ts
 * import { parseResource } from "@cosyte/fhir";
 * const { resource, issues } = parseResource('{"resourceType":"Observation","valueQuantity":{"value":0.010}}');
 * ```
 */
export function parseResource(input: string | RawJson): ReadResult {
  const raw = typeof input === "string" ? readRawJson(input) : input;
  if (raw.t !== "obj") {
    throw new FhirCodecError(
      FATAL_CODES.MALFORMED_JSON,
      "A FHIR resource must be a JSON object at the top level.",
      { offset: 0 },
    );
  }
  const issues: FhirIssue[] = [];
  const resource = buildComplex(raw, "", issues);
  return { resource, issues };
}
