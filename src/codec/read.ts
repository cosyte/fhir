/**
 * The JSON read path: a {@link RawJson} tree → the immutable {@link FhirNode} model.
 *
 * This is where the two silent-data-loss hazards of a FHIR JSON codec are handled (json.html,
 * roadmap §4.1):
 *
 * 1. **Decimal precision.** Number tokens arrive from {@link readRawJson} as exact source text and
 *    become {@link FhirDecimal} values — never a JavaScript `number`. A token that a naive
 *    `JSON.parse` would have corrupted raises a value-free `DECIMAL_PRECISION_AT_RISK` issue.
 * 2. **Primitive-extension (`_`-sibling) alignment.** A primitive's value and its `id`/`extension`
 *    metadata live in two parallel JSON properties (`given` and `_given`), index-aligned with
 *    `null` placeholders for repeating primitives. The reader merges them into single
 *    {@link FhirPrimitive} nodes. If the two arrays disagree in length the alignment is broken and
 *    the reader **fails closed** — throwing `PRIMITIVE_EXTENSION_MISALIGNED` rather than guessing
 *    which value an extension belongs to (guessing could attach it to the wrong clinical value).
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

/** Mutable grouping of a base property with its optional `_`-sibling, in first-seen order. */
interface Grouped {
  readonly order: string[];
  readonly value: Map<string, RawJson>;
  readonly meta: Map<string, RawJson>;
}

/**
 * Group an object's members into `{ base → value }` and `{ base → meta }` maps, preserving the
 * first-seen order of base names across both. Duplicate keys keep the first occurrence (FHIR
 * forbids duplicates; refining that is a later validation phase).
 *
 * @internal
 */
function group(obj: RawObject): Grouped {
  const order: string[] = [];
  const value = new Map<string, RawJson>();
  const meta = new Map<string, RawJson>();
  const seen = new Set<string>();
  for (const member of obj.members) {
    const isMeta = member.key.startsWith("_") && member.key.length > 1;
    const base = isMeta ? member.key.slice(1) : member.key;
    if (!seen.has(base)) {
      seen.add(base);
      order.push(base);
    }
    const target = isMeta ? meta : value;
    if (!target.has(base)) target.set(base, member.value);
  }
  return { order, value, meta };
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

/** Read a primitive's `_`-sibling object into `{ id, extension }`. */
function readMeta(metaNode: RawJson | undefined, path: string, issues: FhirIssue[]): PrimitiveMeta {
  if (metaNode === undefined || metaNode.t !== "obj") return {};
  const result: { id?: string; extension?: readonly FhirComplex[] } = {};
  for (const member of metaNode.members) {
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
  issues.push(unknownProperty(path));
  return complex([]);
}

/**
 * Whether an array should be read as a primitive list (scalar/`null` items) vs a complex list.
 *
 * The value array's own items are authoritative — the presence of a `_`-sibling is a hint, **not**
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
    // representation — flag it rather than drop it silently.
    if (rawValue !== undefined && (rawValue.t === "obj" || rawValue.t === "arr")) {
      issues.push(unknownProperty(itemPath));
    }
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

  // A complex (object) element — its id/extension are inline, so any `_`-sibling is misplaced.
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
  return complex(properties);
}

/**
 * Read a FHIR resource from JSON text or an already-parsed {@link RawJson} tree into the immutable
 * model, gathering value-free issues. Throws {@link FhirCodecError} on malformed JSON or broken
 * `_`-sibling alignment.
 *
 * @param input - JSON text, or a {@link RawJson} tree from {@link readRawJson}.
 * @throws FhirCodecError (`MALFORMED_JSON`) when the input is not a JSON object.
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
