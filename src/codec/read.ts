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
 *    holds. What 6 reaches is a `_`-sibling **on a primitive**, the only position whose sibling is
 *    represented by a node at all (a complex element beside a misplaced sibling has a node, but it
 *    stands for the element, not for the sibling). Nothing in the three listed
 *    becomes a node, so there is nothing to mark, and an array inside such a sibling draws no
 *    refusal. **Which warning it draws is per member, not one code for all three:** an array inside
 *    the third, an unrecognised member of a `_`-sibling object, draws `UNKNOWN_PROPERTY`; the first
 *    two draw `MISPLACED_PRIMITIVE_EXTENSION` for the misplaced sibling and nothing besides.
 *    Reaching it would mean reading raw JSON the codec deliberately does not model, which
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
import { childPath, rootPath, Trail } from "../model/path.js";
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
  type FhirProperty,
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
  lazyAt,
  rawJsonText,
  readJsonTape,
  releaseJsonTape,
  tapeReader,
  type JsonTape,
  type RawArray,
  type RawJson,
  type RawMember,
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

/**
 * Mutable grouping of a base property with its optional `_`-sibling, in first-seen order: base name
 * `order[i]` has its value at `value[i]` and its `_`-sibling at `meta[i]`, either `undefined` when
 * the object did not write it. `shadowed` is `undefined` until a name repeats.
 */
interface Grouped {
  readonly order: string[];
  readonly value: (RawJson | undefined)[];
  readonly meta: (RawJson | undefined)[];
  shadowed: Shadowed[] | undefined;
}

/**
 * Objects with at most this many members find a base name's slot by scanning the names seen so
 * far; a larger one indexes them in a `Map`. A FHIR element has a handful of members, and a scan of
 * a handful of strings is cheaper than building a `Map`; the index keeps an object with thousands of
 * members (hostile input) linear.
 */
const SCAN_MEMBERS = 16;

/** `_`, the prefix of a primitive's `_`-sibling. */
const UNDERSCORE = 95;

/**
 * Group an object's members by base name into a value and a `_`-sibling slot each (see {@link Grouped}),
 * preserving the first-seen order of base names across both. Used for an object that has a
 * `_`-sibling or a repeated name, or more members than {@link SCAN_MEMBERS}; every other object is
 * read member for member (see {@link isPlain}).
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
  const members = obj.members;
  const grouped: Grouped = { order: [], value: [], meta: [], shadowed: undefined };
  const { order, value, meta } = grouped;
  const index = members.length > SCAN_MEMBERS ? new Map<string, number>() : undefined;
  for (const member of members) {
    const key = member.key;
    const isMeta = key.length > 1 && key.charCodeAt(0) === UNDERSCORE;
    const base = isMeta ? key.slice(1) : key;
    let slot = index === undefined ? order.indexOf(base) : (index.get(base) ?? -1);
    if (slot === -1) {
      slot = order.length;
      order.push(base);
      value.push(undefined);
      meta.push(undefined);
      index?.set(base, slot);
    }
    const target = isMeta ? meta : value;
    if (target[slot] === undefined) target[slot] = member.value;
    else (grouped.shadowed ??= []).push({ base, isMeta, node: member.value });
  }
  return grouped;
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
function scalarValue(node: RawJson, trail: Trail, issues: FhirIssue[]): PrimitiveValue | undefined {
  switch (node.t) {
    case "str":
      return node.value;
    case "bool":
      return node.value;
    case "num": {
      if (wouldLosePrecisionAsDouble(node.raw)) issues.push(decimalPrecisionAtRisk(trail.text()));
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
  trail: Trail,
  issues: FhirIssue[],
): FhirPrimitive {
  if (rawValue?.t !== "null") return node;
  if (inArray && carriesMetadata(meta)) return node;
  issues.push(undefinedJsonNull(trail.text()));
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
  trail: Trail,
  issues: FhirIssue[],
): FhirPrimitive {
  if (rawMeta === undefined || rawMeta.t === "obj" || rawMeta.t === "arr") return node;
  if (inArray && rawMeta.t === "null") return node;
  issues.push(unknownProperty(trail.text()));
  return markNonObjectMeta(node, rawJsonText(rawMeta));
}

/** The metadata of a primitive with no `_`-sibling object: shared, since nothing writes to it. */
const NO_META: PrimitiveMeta = Object.freeze({});

/**
 * The primitive {@link buildNode} makes of a string or boolean value with no `_`-sibling, or
 * `undefined` for any other value. Such a value draws no finding and needs no location, so it is
 * built here without one: `buildNode` would build `primitive(value)` and return it unchanged.
 */
function plainPrimitive(value: RawJson): FhirPrimitive | undefined {
  if (value.t === "str" || value.t === "bool") return primitive(value.value, NO_META);
  return undefined;
}

/**
 * A test of whether a member's key was already written earlier in the same object, member by
 * member in order. A `_`-sibling object has a member or two, so a scan back is cheaper than a `Set`;
 * a large one (hostile input) is indexed in a `Set` instead so the read stays linear.
 */
function repeatedKeys(members: readonly RawMember[]): (m: number) => boolean {
  if (members.length > SCAN_MEMBERS) {
    const seen = new Set<string>();
    return (m) => {
      const key = (members[m] as RawMember).key;
      if (seen.has(key)) return true;
      seen.add(key);
      return false;
    };
  }
  return (m) => {
    const key = (members[m] as RawMember).key;
    for (let i = 0; i < m; i++) if ((members[i] as RawMember).key === key) return true;
    return false;
  };
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
function readMeta(metaNode: RawJson | undefined, trail: Trail, issues: FhirIssue[]): PrimitiveMeta {
  if (metaNode === undefined || metaNode.t !== "obj") return NO_META;
  const path = trail.text();
  const result: { id?: string; extension?: readonly FhirComplex[] } = {};
  const members = metaNode.members;
  const repeats = repeatedKeys(members);
  for (let m = 0; m < members.length; m++) {
    const member = members[m] as RawMember;
    const at = childPath(path, member.key);
    if (repeats(m)) {
      issues.push(duplicateProperty(at));
      continue;
    }
    if (member.key === "id" && member.value.t === "str") {
      result.id = member.value.value;
    } else if (member.key === "extension" && member.value.t === "arr") {
      const items = new Trail(at);
      result.extension = member.value.items.map((item, i) => {
        items.index(i);
        const extension = readComplex(item, items, issues);
        items.pop();
        return extension;
      });
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
function readComplex(node: RawJson, trail: Trail, issues: FhirIssue[]): FhirComplex {
  if (node.t === "obj") return buildComplex(node, trail, issues);
  issues.push(unknownProperty(trail.text()));
  if (node.t !== "arr") return { ...complex([]), nonObjectSource: rawJsonText(node) };
  issues.push(nestedArray(trail.text()));
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
  trail: Trail,
  issues: FhirIssue[],
): FhirNode {
  const valueItems = value?.items ?? [];
  const metaItems = meta?.items ?? [];
  if (value !== undefined && meta !== undefined && valueItems.length !== metaItems.length) {
    throw new FhirCodecError(
      FATAL_CODES.PRIMITIVE_EXTENSION_MISALIGNED,
      "Primitive value array and its _-sibling array have different lengths; " +
        "the null-padded alignment is broken and cannot be recovered safely.",
      { expression: trail.text() },
    );
  }
  const length = Math.max(valueItems.length, metaItems.length);
  const items: FhirNode[] = [];
  for (let i = 0; i < length; i++) {
    const rawValue = valueItems[i];
    const rawMeta = metaItems[i];
    // The common slot, a string or boolean with no `_`-sibling entry, draws no finding, so it is
    // built without its location.
    if (rawMeta === undefined && rawValue !== undefined) {
      const plain = plainPrimitive(rawValue);
      if (plain !== undefined) {
        items.push(plain);
        continue;
      }
    }
    trail.index(i);
    // A non-scalar where a primitive value belongs (malformed mixed array) has no primitive
    // representation, flag it rather than drop it silently.
    if (rawValue !== undefined && (rawValue.t === "obj" || rawValue.t === "arr")) {
      issues.push(unknownProperty(trail.text()));
    }
    // An array in either channel is an array inside an array, which FHIR JSON does not define. The
    // value channel already drew the warning above; the `_`-sibling channel drew nothing at all,
    // because `readMeta` reads metadata out of an object and silently has none to read from an
    // array. Neither says content was lost, so both get the marker, the explicit report, and their
    // own text kept verbatim. The slot itself is unchanged: still one primitive, still holding
    // whatever value the value channel carried, so the null-padded alignment between the two arrays
    // is untouched, and the two channels stay distinguishable because either can nest alone.
    const nested = rawValue?.t === "arr" || rawMeta?.t === "arr";
    if (nested) issues.push(nestedArray(trail.text()));
    const value_ = rawValue === undefined ? undefined : scalarValue(rawValue, trail, issues);
    const metaValue = readMeta(rawMeta, trail, issues);
    // `true` in both: this is a slot of a repeating primitive, the one place json.html §2.6.2.3
    // defines a `null`, so the padding exemption is available here and nowhere else. It applies to
    // each channel separately, because §2.6.2.3 fills out both arrays.
    const node = applyMetaSlotRule(
      applyNullRule(primitive(value_, metaValue), rawValue, metaValue, true, trail, issues),
      rawMeta,
      true,
      trail,
      issues,
    );
    trail.pop();
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
  trail: Trail,
  issues: FhirIssue[],
): FhirNode {
  // A `_`-sibling belongs to a primitive; a complex array's members carry their own id/extension
  // inline. The sibling is not read, so this reports unreadable content, not a tolerated shape.
  if (meta !== undefined) issues.push(misplacedPrimitiveExtension(trail.text()));
  return list(
    value.items.map((item, i) => {
      trail.index(i);
      const node = readComplex(item, trail, issues);
      trail.pop();
      // A tree this read made from text is its own and nothing reads an item again once it is
      // built, so the item is let go. That tree is made one part at a time as it is read
      // (`lazyAt`), so a large Bundle's raw entries are made one at a time and let go
      // one at a time, and only the entry being built stays alive beside the model.
      if (releasing) (value.items as RawJson[])[i] = RELEASED;
      return node;
    }),
  );
}

/**
 * Whether the read under way made its raw tree from text itself, and so may let an item of it go
 * once the item is built (see {@link buildComplexList}). Set only by {@link parseResource} for text
 * input: a tree a caller handed in is the caller's and is never changed.
 */
let releasing = false;

/** What a released item of a raw tree is left holding. */
const RELEASED: RawJson = Object.freeze({ t: "null" });

/** Build the node for a single base property from its value and `_`-sibling. */
function buildNode(
  value: RawJson | undefined,
  meta: RawJson | undefined,
  trail: Trail,
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
          { expression: trail.text() },
        );
      }
      return buildPrimitiveList(valueArr, metaArr, trail, issues);
    }
    // valueArr is defined here (a complex array cannot be value-absent).
    /* v8 ignore next -- the `??` fallback is unreachable: isPrimitiveArray() is true when valueArr is undefined */
    return buildComplexList(valueArr ?? { t: "arr", items: [] }, meta, trail, issues);
  }

  // A complex (object) element, its id/extension are inline, so any `_`-sibling is misplaced.
  if (value?.t === "obj") {
    if (meta !== undefined) issues.push(misplacedPrimitiveExtension(trail.text()));
    return buildComplex(value, trail, issues);
  }

  // A single primitive (scalar value, and/or a `_`-sibling object of id/extension).
  if (meta !== undefined && meta.t === "arr") {
    throw new FhirCodecError(
      FATAL_CODES.PRIMITIVE_EXTENSION_MISALIGNED,
      "A single primitive's _-sibling must be an object; found an array.",
      { expression: trail.text() },
    );
  }
  const scalar = value === undefined ? undefined : scalarValue(value, trail, issues);
  const metaValue = readMeta(meta, trail, issues);
  // `false` in both: a singleton slot. §2.6.2.3 renders a value-absent singleton as the `_` property
  // alone, so no `null` here is ever padding, in either channel, however the other one is filled in.
  return applyMetaSlotRule(
    applyNullRule(primitive(scalar, metaValue), value, metaValue, false, trail, issues),
    meta,
    false,
    trail,
    issues,
  );
}

/**
 * Whether an object's members are its properties one for one: no `_`-sibling and no repeated name.
 * Almost every object in a FHIR document is, and for those {@link buildComplex} reads the members
 * directly instead of grouping them, which builds the same properties in the same order. Decided by
 * a scan for a small object; a large one is grouped.
 */
function isPlain(members: readonly RawMember[]): boolean {
  if (members.length > SCAN_MEMBERS) return false;
  for (let m = 0; m < members.length; m++) {
    const key = (members[m] as RawMember).key;
    if (key.length > 1 && key.charCodeAt(0) === UNDERSCORE) return false;
    for (let i = 0; i < m; i++) if ((members[i] as RawMember).key === key) return false;
  }
  return true;
}

/** Build a {@link FhirComplex} from a raw object, recursing through its properties. */
function buildComplex(obj: RawObject, at: Trail, issues: FhirIssue[], root = false): FhirComplex {
  const members = obj.members;
  if (isPlain(members)) {
    let trail = at;
    if (root) {
      const rt = members.find((member) => member.key === "resourceType")?.value;
      if (rt?.t === "str") trail = new Trail(rootPath(rt.value));
    }
    return complex(
      members.map((member) => {
        const plain = plainPrimitive(member.value);
        if (plain !== undefined) return { name: member.key, value: plain };
        trail.child(member.key);
        const node = buildNode(member.value, undefined, trail, issues);
        trail.pop();
        return { name: member.key, value: node };
      }),
    );
  }
  const grouped = group(obj);
  const { order, value, meta, shadowed } = grouped;
  // Root path becomes the resource type once known, so FHIRPath expressions read `Patient.birthDate`.
  let trail = at;
  if (root) {
    const rt = value[order.indexOf("resourceType")];
    if (rt?.t === "str") trail = new Trail(rootPath(rt.value));
  }
  const properties: FhirProperty[] = [];
  for (let i = 0; i < order.length; i++) {
    const name = order[i] as string;
    const rawValue = value[i];
    const plain =
      meta[i] === undefined && rawValue !== undefined ? plainPrimitive(rawValue) : undefined;
    if (plain !== undefined) {
      properties.push({ name, value: plain });
      continue;
    }
    trail.child(name);
    properties.push({ name, value: buildNode(rawValue, meta[i], trail, issues) });
    trail.pop();
  }
  if (shadowed === undefined) return complex(properties);
  // Members a repeated property name shadowed: read them into the model too (a dropped value cannot
  // be reasoned about later) and flag each one, so a caller is never handed one arbitrary value out
  // of several with a clean result.
  const reported = new Set<string>();
  const duplicates = shadowed.map((member) => {
    trail.child(member.base);
    const at = trail.text();
    // One issue per element on this object, however many members shadowed the name here (a name and
    // its `_`-sibling can each repeat): the FHIRPath location is the same, so a second issue would
    // say nothing new. Two different objects that each repeat a name still report separately.
    if (!reported.has(member.base)) {
      reported.add(member.base);
      issues.push(duplicateProperty(at));
    }
    const node = member.isMeta
      ? buildNode(undefined, member.node, trail, issues)
      : buildNode(member.node, undefined, trail, issues);
    trail.pop();
    return { name: member.base, value: node };
  });
  return complex(properties, duplicates);
}

/**
 * {@link buildComplex} for the object whose token is at `index` of a tape a read of text made,
 * built straight from the tape. A plain object (see {@link isPlain}) is read member by member with
 * no raw node made for it: a string or boolean member becomes its primitive, an object member is
 * built the same way, and an array of strings and booleans or of objects is read item by item.
 * Anything else, and an object that is not plain, is built from {@link lazyAt}'s tree by the same
 * code a tree read takes, so both reads build the same model and report the same issues.
 */
function buildComplexAt(
  tape: JsonTape,
  index: number,
  at: Trail,
  issues: FhirIssue[],
  root = false,
): FhirComplex {
  if (!tapeReader.isPlainObject(tape, index, SCAN_MEMBERS)) {
    return buildComplex(lazyAt(tape, index) as RawObject, at, issues, root);
  }
  const count = tapeReader.count(tape, index);
  let trail = at;
  if (root) {
    let key = index + 1;
    for (let m = 0; m < count; m++) {
      const value = key + 1;
      if (tapeReader.key(tape, key) === "resourceType") {
        if (tapeReader.type(tape, value) === "str") {
          trail = new Trail(rootPath(tapeReader.string(tape, value)));
        }
        break;
      }
      key = tapeReader.after(tape, value);
    }
  }
  const properties = new Array<FhirProperty>(count);
  let key = index + 1;
  for (let m = 0; m < count; m++) {
    const name = tapeReader.key(tape, key);
    const value = key + 1;
    properties[m] = { name, value: buildMemberAt(tape, value, name, trail, issues) };
    key = tapeReader.after(tape, value);
  }
  return complex(properties);
}

/** The node of a plain object's member `name`, whose value's token is at `index`; see {@link buildComplexAt}. */
function buildMemberAt(
  tape: JsonTape,
  index: number,
  name: string,
  trail: Trail,
  issues: FhirIssue[],
): FhirNode {
  const type = tapeReader.type(tape, index);
  if (type === "str") return primitive(tapeReader.string(tape, index), NO_META);
  if (type === "bool") return primitive(tapeReader.isTrue(tape, index), NO_META);
  trail.child(name);
  let node: FhirNode;
  if (type === "obj") node = buildComplexAt(tape, index, trail, issues);
  else if (type === "arr") node = buildArrayAt(tape, index, trail, issues);
  else node = buildNode(lazyAt(tape, index), undefined, trail, issues);
  trail.pop();
  return node;
}

/**
 * The node of an array with no `_`-sibling, whose token is at `index`: {@link buildNode}'s answer.
 * An array of strings and booleans is a primitive list of them, and an array of objects a list of
 * complex nodes, each read from the tape; any other array is built from {@link lazyAt}'s tree.
 */
function buildArrayAt(tape: JsonTape, index: number, trail: Trail, issues: FhirIssue[]): FhirNode {
  const count = tapeReader.count(tape, index);
  const first = count === 0 ? undefined : tapeReader.type(tape, index + 1);
  let plain = first === "str" || first === "bool" || first === "obj";
  let item = index + 1;
  for (let i = 0; plain && i < count; i++) {
    const type = tapeReader.type(tape, item);
    plain = first === "obj" ? type === "obj" : type === "str" || type === "bool";
    item = tapeReader.after(tape, item);
  }
  if (!plain) return buildNode(lazyAt(tape, index), undefined, trail, issues);
  const items = new Array<FhirNode>(count);
  item = index + 1;
  for (let i = 0; i < count; i++) {
    if (first === "obj") {
      trail.index(i);
      items[i] = buildComplexAt(tape, item, trail, issues);
      trail.pop();
    } else if (tapeReader.type(tape, item) === "str") {
      items[i] = primitive(tapeReader.string(tape, item), NO_META);
    } else {
      items[i] = primitive(tapeReader.isTrue(tape, item), NO_META);
    }
    item = tapeReader.after(tape, item);
  }
  return list(items);
}

/**
 * Read a FHIR resource from JSON text or an already-parsed {@link RawJson} tree into the immutable
 * model, gathering value-free issues. Throws {@link FhirCodecError} on malformed JSON or broken
 * `_`-sibling alignment.
 *
 * Strings of 13 or more characters are slices of the input text, so a parsed resource can keep the
 * parsed text in memory while it lives. Copy what you keep (for example with `structuredClone` or a
 * JSON round trip of the resource) or let the parsed result go.
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
  // Text is checked whole first, so a malformed document throws before anything is built; the model
  // is then built from its tape, and any raw tree made for part of it is made only as far as it is
  // read (see buildComplexAt). Neither the tape nor such a tree outlives this call.
  const tape = typeof input === "string" ? readJsonTape(input, true) : undefined;
  try {
    const type = tape === undefined ? (input as RawJson).t : tapeReader.type(tape, 0);
    if (type !== "obj") {
      throw new FhirCodecError(
        FATAL_CODES.MALFORMED_JSON,
        "A FHIR resource must be a JSON object at the top level.",
        { offset: 0 },
      );
    }
    const issues: FhirIssue[] = [];
    releasing = tape !== undefined;
    const resource =
      tape === undefined
        ? buildComplex(input as RawObject, new Trail(""), issues, true)
        : buildComplexAt(tape, 0, new Trail(""), issues, true);
    return { resource, issues };
  } finally {
    releasing = false;
    if (tape !== undefined) releaseJsonTape(tape);
  }
}
