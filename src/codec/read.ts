/**
 * The JSON read path: a {@link RawJson} tree → the immutable {@link FhirNode} model.
 *
 * This is where the four silent-data-loss hazards of a FHIR JSON codec are handled (json.html): the
 * first three losslessly, the fourth by refusing to let the loss go unreported. **Entries 5 and 6
 * are not data losses at all** and are listed with them because each one used to read exactly like
 * one. Count the entries rather than trusting this sentence: it said "a fifth" while six were listed.
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
 *    `extension` array). **The list is the predicate, and 6 below does not shrink it**: a
 *    `_`-sibling on an object or on a non-primitive array is still discarded whole, whatever it
 *    holds. What 6 reaches is a `_`-sibling **on a primitive**, which is the only position that
 *    leaves a node to hang the text on. Nothing in the three listed
 *    becomes a node, so there is nothing to mark, and an array
 *    inside such a sibling draws the `UNKNOWN_PROPERTY` warning for the discarded sibling and no
 *    refusal. Reaching it would mean reading raw JSON the codec deliberately does not model, which
 *    is the preserving problem rather than the reporting one. Pinned by a test rather than left to
 *    this sentence.
 *
 * 5. **A `null` in a primitive's value channel that pads nothing.** FHIR JSON defines `null` for one
 *    job, aligning a repeating primitive's value array with its `_`-sibling array (json.html
 *    §2.6.2.3, the one exception to §2.6.2.1's "properties never have null values").
 *    Anywhere else it encodes an absent value in a way the format does not define. **Nothing is lost
 *    here**, because a `null` carries no content and the element really is value-absent, which is exactly
 *    why it needed its own answer: read silently and written back as an omitted member, a
 *    non-conformant document became a conformant one with the member simply gone, and every layer
 *    then affirmed it. The reader raises `UNDEFINED_JSON_NULL` and marks the slot
 *    ({@link ../model/node.js} `isUndefinedNull`) so the writer hands the `null` back rather than
 *    dropping it, and re-reading the output reproduces the finding. See {@link applyNullRule} for
 *    why this is a diagnostic and not a refusal.
 *
 * 6. **A `_`-sibling, on a primitive, that is not an object.** The same laundering, one channel over,
 *    and closed the same way. FHIR JSON gives that channel an `Element` object (json.html §2.6.2.3,
 *    "the `id` and/or `extension`"), so a string, a number, a boolean, or a `null` at a **singleton**
 *    slot carries no metadata to read. **Nothing is lost here either**, and that is again why it was invisible: the
 *    reader modeled no metadata, the writer emits a `_`-sibling only for metadata it has, and
 *    `{"_status":null}` therefore came back as `{}`. The reader raises `UNKNOWN_PROPERTY` (the same
 *    code, and the same observation, as a scalar at a complex position) and keeps the text
 *    ({@link ../model/node.js} `nonObjectMetaSource`) so the writer hands it back. **The exemption is
 *    by POSITION, not by whether that slot pads a value:** a `null` at any slot of a repeating
 *    primitive's `_`-array is left alone, which is where §2.6.2.3 defines one. §2.6.2.3's Note also
 *    scopes its `null` to a slot whose element *has* a value, and that half is NOT implemented, so a
 *    `_`-array with no value array beside it keeps the silent drop it had before. Declared, not
 *    closed. See {@link applyMetaSlotRule}.
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
  markNonObjectMeta,
  markUndefinedNull,
  primitive,
  type FhirComplex,
  type FhirNode,
  type FhirPrimitive,
  type PrimitiveMeta,
  type PrimitiveValue,
} from "../model/node.js";
import {
  decimalPrecisionAtRisk,
  duplicateProperty,
  misplacedPrimitiveExtension,
  nestedArray,
  undefinedJsonNull,
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
 * Apply the one rule FHIR JSON has about `null`, to a primitive slot the reader has already built.
 *
 * FHIR JSON forbids `null` outright and then carves out exactly one exception. json.html §2.6.2.1:
 * "properties never have null values (except for a special case documented below)". The exception is
 * §2.6.2.3, and it is scoped to a **repeating** primitive: "In the case where the primitive element
 * may repeat, it is represented in two arrays. JSON null values are used to fill out both arrays so
 * that the id and/or extension are aligned with the matching value in the first array."
 *
 * **Two conditions, and both are load-bearing.**
 *
 * - **Inside an array.** The exception is written about the two parallel arrays and nothing else, and
 *   the same section states the singleton encoding positively: "If the primitive has an id attribute
 *   or extension, but no value, only the property with the `_` is rendered." So a value-absent
 *   singleton is spelled `{"_status":{…}}` and never `{"status":null,"_status":{…}}`. **A `null` at a
 *   singleton slot is therefore never padding, whatever sits beside it.** An earlier draft of this
 *   rule tested only the metadata, which exempted `{"value":null,"_value":{"id":"q1"},"unit":"mg"}`
 *   and laundered the magnitude away with no diagnostic: the exact shape this rule exists to catch.
 * - **Aligned with something.** Padding aligns the value array with an `id`/`extension` in the
 *   `_`-sibling array, so a slot the `_`-sibling puts nothing in aligns with nothing.
 *   {@link carriesMetadata} is that test, and it must agree with the writer (see there).
 *
 * A `null` failing either condition leaves an element with neither a value nor children, which R4
 * `ele-1` requires one of.
 *
 * Reporting it is the whole of the remedy on the read side; **the marker is what makes the report
 * survive.** Without it the writer omits a value-absent primitive, so `{"value":null,"unit":"mg"}`
 * comes back as `{"unit":"mg"}`: a conformant `Quantity` carrying a unit and no magnitude, which is
 * a document the sender never wrote and which re-reads with no diagnostic at all. Handing the `null`
 * back is the same rule the writer already applies one branch over, where a `null` written at a
 * complex position is written back from {@link FhirComplex.nonObjectSource}.
 *
 * **What this deliberately does not do.** It does not refuse: a `null` is a non-conformant encoding
 * of an *absent* value, not content the reader could not read, so nothing is lost and the fatal tier
 * (reserved for structure the reader cannot recover) is the wrong instrument, and refusing would
 * withdraw round trips that work today. Nothing that round-trips today stops: a value-absent
 * singleton written the conformant way carries no `null`, so it is never marked and is emitted
 * exactly as before. For the same reason it adds no safety-summary refusal: `nestedArray` and
 * `droppedText` refuse because content was unreadable at that position, and that is not what
 * happened here.
 *
 * @internal
 */
function applyNullRule(
  node: FhirPrimitive,
  rawValue: RawJson | undefined,
  meta: PrimitiveMeta,
  inArray: boolean,
  path: string,
  issues: FhirIssue[],
): FhirPrimitive {
  if (rawValue?.t !== "null") return node;
  if (inArray && carriesMetadata(meta)) return node;
  issues.push(undefinedJsonNull(path));
  return markUndefinedNull(node);
}

/**
 * Whether this slot's `_`-sibling put anything on the wire for the padding to align **with**.
 *
 * **This must agree exactly with `hasMeta` in {@link ./write.js}, and the two disagreeing is a
 * laundering bug rather than a cosmetic one.** An earlier draft tested `extension !== undefined`,
 * which is true for `"extension":[]`; the writer requires `length > 0`, so the read exempted the
 * slot as padding and the writer then emitted neither the value nor the `_`-sibling, deleting the
 * member with no diagnostic anywhere. An empty array is not metadata in any case: json.html §2.6.2.1
 * says "JSON objects and arrays are never empty" and to omit an empty property. Pinned by tests over
 * both halves rather than by this sentence: the empty-`extension` half and the `id` half each have
 * their own.
 *
 * @internal
 */
function carriesMetadata(meta: PrimitiveMeta): boolean {
  return meta.id !== undefined || (meta.extension !== undefined && meta.extension.length > 0);
}

/**
 * Apply the same rule one channel over, to the `_`-sibling slot itself.
 *
 * FHIR JSON gives the `_`-sibling an `Element` object and nothing else: json.html §2.6.2.3 puts "the
 * `id` and/or `extension`" there, and §2.6.2 gives an element an object. A scalar, a boolean or a
 * `null` in that channel carries no metadata this reader can model, so {@link readMeta} reads none
 * out of it and the primitive is left holding nothing in that channel. **That was silent, and the
 * silence was the defect**: the writer emits a `_`-sibling only when the model has metadata for one,
 * so `{"_status":null}` and `{"_status":"x"}` both came back as `{}`: a conformant document with
 * the member gone, and every layer affirming it, which is exactly the laundering
 * {@link applyNullRule} closed in the value channel.
 *
 * The remedy is the same one, for the same reason: report it, and keep the text so the writer hands
 * it back. Reporting alone does not survive a round trip, because a document with the member deleted
 * re-reads clean.
 *
 * **The code is {@link ISSUE_CODES.UNKNOWN_PROPERTY}, and no case moves onto or off any code.** This
 * is the same observation the reader already makes one branch over, where a scalar or `null` sits at
 * a **complex** position: something FHIR JSON has an object for arrived as a scalar, nothing is
 * modeled, the text is preserved, and the writer hands it back ({@link readComplex}). A consumer
 * acts on it identically, so it needs no new code to key on, and the positions that draw
 * `UNDEFINED_JSON_NULL` are untouched, because this channel drew *nothing* before.
 *
 * **Two exclusions, and both are load-bearing.**
 *
 * - **An array** is not this case. In a repeating primitive's `_`-array it is an array inside an
 *   array, already marked and reported as `NESTED_ARRAY` with its own preserved text; at a singleton
 *   slot {@link buildNode} has already thrown `PRIMITIVE_EXTENSION_MISALIGNED`.
 * - **A `null` at a slot of a repeating primitive's `_`-array**, which is where §2.6.2.3 defines
 *   one: it fills out *both* arrays so the two stay index-aligned, so a slot whose value needs no
 *   metadata is spelled `null` there. **The test is `inArray`, so the exemption is by POSITION, not
 *   by whether that slot pads a value.** §2.6.2.3's Note scopes its `null` to a slot whose element
 *   *has* a value, and that half is deliberately NOT implemented: `{"_given":[null]}` with no
 *   `given` beside it keeps the silent drop it had before, a declared residual rather than a claim.
 *   A `null` at a **singleton** `_` slot is never padding, on exactly the reasoning
 *   {@link applyNullRule} sets out for the value channel: §2.6.2.3 renders a value-absent singleton
 *   as the `_` property alone.
 *
 * **This cannot reopen the drift that {@link carriesMetadata} guards.** That hazard is the read
 * exempting a `null` as padding while `hasMeta` in {@link ./write.js} declines to emit the
 * `_`-sibling, so the member is deleted anyway. The mark added here only ever makes `hasMeta` *more*
 * true (it is a new disjunct there), and `carriesMetadata` is unchanged, so no slot can newly be
 * exempted on the read and dropped on the write. Pinned by a test rather than by this sentence.
 *
 * @internal
 */
function applyMetaSlotRule(
  node: FhirPrimitive,
  rawMeta: RawJson | undefined,
  inArray: boolean,
  path: string,
  issues: FhirIssue[],
): FhirPrimitive {
  if (rawMeta === undefined || rawMeta.t === "obj" || rawMeta.t === "arr") return node;
  if (inArray && rawMeta.t === "null") return node;
  issues.push(unknownProperty(path));
  return markNonObjectMeta(node, rawJsonText(rawMeta));
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
 *
 * **A scalar or `null` here is the same problem one branch over, and its text is kept the same way.**
 * The element is empty for the same reason, so without the text the writer has nothing to hand back
 * and emits `{}`: an object the sender never wrote, at a position the reader never read, which is a
 * value the writer authored rather than one it carried. The warning above is the only thing that
 * says otherwise, and it does not survive a round trip, because `{}` reads back as a conformant
 * empty element. Keeping the text costs the tree nothing, for the same reason it costs the tree
 * nothing one branch over: it hangs off the node instead of being modeled at it
 * ({@link FhirComplex.nonObjectSource}).
 */
function readComplex(node: RawJson, path: string, issues: FhirIssue[]): FhirComplex {
  if (node.t === "obj") return buildComplex(node, path, issues);
  issues.push(unknownProperty(path));
  if (node.t !== "arr") return { ...complex([]), nonObjectSource: rawJsonText(node) };
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
    // `true` in both: this is a slot of a repeating primitive, the one place json.html §2.6.2.3
    // defines a `null`, so the padding exemption is available here and nowhere else. It applies to
    // each channel separately, because §2.6.2.3 fills out both arrays.
    const node = applyMetaSlotRule(
      applyNullRule(primitive(value_, metaValue), rawValue, metaValue, true, itemPath, issues),
      rawMeta,
      true,
      itemPath,
      issues,
    );
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
  // A `_`-sibling belongs to a primitive; a complex array's members carry their own id/extension
  // inline. The sibling is not read, so this reports unreadable content, not a tolerated shape.
  if (meta !== undefined) issues.push(misplacedPrimitiveExtension(path));
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
    if (meta !== undefined) issues.push(misplacedPrimitiveExtension(path));
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
  const metaValue = readMeta(meta, path, issues);
  // `false` in both: a singleton slot. §2.6.2.3 renders a value-absent singleton as the `_` property
  // alone, so no `null` here is ever padding, in either channel, however the other one is filled in.
  return applyMetaSlotRule(
    applyNullRule(primitive(scalar, metaValue), value, metaValue, false, path, issues),
    meta,
    false,
    path,
    issues,
  );
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
