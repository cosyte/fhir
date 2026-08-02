/**
 * The JSON read path: a {@link RawJson} tree → the immutable {@link FhirNode} model.
 *
 * This is where the four silent-data-loss hazards of a FHIR JSON codec are handled (json.html): the
 * first three losslessly, the fourth by refusing to let the loss go unreported.
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
 * 4. **An array inside an array.** FHIR JSON uses an array for a repeating element and for nothing
 *    else (json.html §2.6.2.2), so a list of lists has no meaning at any position. This is the one
 *    shape the reader cannot model **as FHIR**, because there is no element for it to be. It is
 *    still kept: the array's JSON text is preserved on the node and read back with
 *    {@link ../model/node.js} `nestedArrayContent`, and the writer emits it again, so the document
 *    survives a round trip and no value the sender wrote is dropped. What the reader will
 *    not do is place it in the tree. The position is marked ({@link ../model/node.js}
 *    `isNestedArray`) and reported as `NESTED_ARRAY`, the safety readout refuses to summarize such a
 *    resource, and the validator raises an error, so the content does not sit underneath an
 *    affirmative verdict either.
 *
 *    **Kept out of the tree deliberately, and this is the load-bearing part.** Making the inner
 *    array an element of the repeating element would change what a repeating element *contains* for
 *    every consumer that walks one. The library has sites that flatten a list into its items and
 *    then drop, or miscount, anything that is not the element kind they expect, so a list holding a
 *    list reaches them as a silently absent value rather than as an error: a profile invariant, a
 *    vital-signs unit check, or a negation can go unevaluated and the resource then reads as valid.
 *    Preserving the text costs none of that, because a string is not a node and no walk can reach
 *    it.
 *
 *    **The one channel this does not reach, stated rather than implied:** a `_`-sibling the reader
 *    discards *whole* because it is misplaced or unrecognised (a `_`-sibling on an object or on a
 *    non-primitive array, or a member of a `_`-sibling object that is neither an `id` **string**
 *    nor an
 *    `extension` array). Nothing there becomes a node, so there is nothing to mark, and an array
 *    inside such a sibling draws the `UNKNOWN_PROPERTY` warning for the discarded sibling and no
 *    refusal. Reaching it would mean reading raw JSON the codec deliberately does not model, which
 *    is the preserving problem rather than the reporting one. Pinned by a test rather than left to
 *    this sentence.
 *
 * Reading is lenient elsewhere (Postel's Law): an unexpected shape is preserved and flagged, not
 * rejected. Only genuinely unrecoverable structure (malformed JSON, broken `_`-alignment) throws.
 *
 * @packageDocumentation
 */

import { decimal, wouldLosePrecisionAsDouble } from "../model/decimal.js";
import { childPath, rootPath } from "../model/path.js";
import {
  complex,
  list,
  markNestedArray,
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
import {
  rawJsonText,
  readRawJson,
  type RawArray,
  type RawJson,
  type RawObject,
} from "./raw-json.js";

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
 * Positions here are named in **FHIRPath form**, `birthDate.id` and `birthDate.extension[0]`, not in
 * the JSON encoding's `_`-prefixed form. FHIRPath addresses a primitive's metadata as members of the
 * element itself, the `_` is an artifact of how FHIR JSON splits them into two properties, and the
 * safety readout already emits the FHIRPath form for the same positions. One convention for the
 * whole reader is what lets a consumer correlate a read diagnostic with a safety location by string
 * equality, at every depth rather than only at the depth an override happened to cover.
 *
 * A repeated name here follows the **same** first-wins rule as every other object, and raises the
 * same `DUPLICATE_PROPERTY`, so the codec never resolves a duplicate two different ways. The
 * shadowed member is not carried on the model: a primitive's metadata is an R4 `Element` (`id` and
 * `extension` only, no `modifierExtension`), so nothing here feeds a safety verdict, and a slot for
 * it on every primitive node would buy no verdict. That limitation is stated on
 * {@link ../safety/status.js} `shadowedProperties`, which walks object elements.
 */
function readMeta(metaNode: RawJson | undefined, path: string, issues: FhirIssue[]): PrimitiveMeta {
  if (metaNode === undefined || metaNode.t !== "obj") return {};
  const result: { id?: string; extension?: readonly FhirComplex[] } = {};
  const seen = new Set<string>();
  for (const member of metaNode.members) {
    const at = childPath(path, member.key);
    if (seen.has(member.key)) {
      issues.push(duplicateProperty(at));
      continue;
    }
    seen.add(member.key);
    if (member.key === "id" && member.value.t === "str") {
      result.id = member.value.value;
    } else if (member.key === "extension" && member.value.t === "arr") {
      result.extension = member.value.items.map((item, i) =>
        readComplex(item, `${at}[${String(i)}]`, issues),
      );
    } else {
      issues.push(unknownProperty(at));
    }
  }
  return result;
}

/**
 * Coerce any raw node to a {@link FhirComplex} (objects pass through; anything else is empty).
 *
 * An **array** here is the one case where the empty element is not the whole story: FHIR JSON uses an
 * array only for a repeating element, so an array inside an array is a shape with no meaning, and
 * whatever it held is content this reader cannot place *as an element*. The element therefore stays
 * empty and the position is marked and reported, so nothing downstream can affirm a verdict as
 * though the position had been empty on the wire; the existing warning is kept alongside the new one.
 * The array's own text is kept verbatim on the node, where it is readable without being an element:
 * putting it in the tree would change what a repeating element *contains* for every consumer that
 * walks one, which is a redefinition of the model rather than a preservation of the document.
 */
function readComplex(node: RawJson, path: string, issues: FhirIssue[]): FhirComplex {
  if (node.t === "obj") return buildComplex(node, path, issues);
  issues.push(unknownProperty(path));
  if (node.t !== "arr") return complex([]);
  issues.push(nestedArray(path));
  return markNestedArray(complex([]), { value: rawJsonText(node) });
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
    // A non-scalar where a primitive value belongs (malformed mixed array) has no primitive
    // representation, flag it rather than drop it silently.
    if (rawValue !== undefined && (rawValue.t === "obj" || rawValue.t === "arr")) {
      issues.push(unknownProperty(itemPath));
    }
    // An array in either channel is an array inside an array, which FHIR JSON does not define. The
    // value channel already drew the warning above; the `_`-sibling channel drew nothing at all,
    // because `readMeta` reads metadata out of an object and silently has none to read from an
    // array. Neither says content was lost, so both get the marker, the explicit report, and their
    // own text kept verbatim. The slot itself is unchanged: still one primitive, still holding
    // whatever value the value channel carried, so the null-padded alignment between the two arrays
    // is untouched, and the two channels stay distinguishable because either can nest alone.
    const rawMeta = metaItems[i];
    const nested = rawValue?.t === "arr" || rawMeta?.t === "arr";
    if (nested) issues.push(nestedArray(itemPath));
    const value_ = rawValue === undefined ? undefined : scalarValue(rawValue, itemPath, issues);
    const metaValue = readMeta(rawMeta, itemPath, issues);
    const node = primitive(value_, metaValue);
    if (!nested) {
      items.push(node);
      continue;
    }
    const sources: { value?: string; metadata?: string } = {};
    if (rawValue?.t === "arr") sources.value = rawJsonText(rawValue);
    if (rawMeta?.t === "arr") sources.metadata = rawJsonText(rawMeta);
    items.push(markNestedArray(node, sources));
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
  return list(value.items.map((item, i) => readComplex(item, `${path}[${String(i)}]`, issues)));
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
    if (rt?.t === "str") basePath = rootPath(rt.value);
  }
  const properties = grouped.order.map((name) => ({
    name,
    value: buildNode(
      grouped.value.get(name),
      grouped.meta.get(name),
      childPath(basePath, name),
      issues,
    ),
  }));
  // Members a repeated property name shadowed: read them into the model too (a dropped value cannot
  // be reasoned about later) and flag each one, so a caller is never handed one arbitrary value out
  // of several with a clean result.
  const reported = new Set<string>();
  const duplicates = grouped.shadowed.map((member) => {
    const at = childPath(basePath, member.base);
    // One issue per element on this object, however many members shadowed the name here (a name and
    // its `_`-sibling can each repeat): the FHIRPath location is the same, so a second issue would
    // say nothing new. Two different objects that each repeat a name still report separately.
    if (!reported.has(member.base)) {
      reported.add(member.base);
      issues.push(duplicateProperty(at));
    }
    return {
      name: member.base,
      value: member.isMeta
        ? buildNode(undefined, member.node, at, issues)
        : buildNode(member.node, undefined, at, issues),
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
