/**
 * Declared absence: the R4 DataAbsentReason EXTENSION, read as a first-class answer.
 *
 * A source system that has no data for an element whose minimum cardinality is greater than zero
 * cannot omit it, so it writes the element present, with no value, carrying an extension whose
 * `url` is `http://hl7.org/fhir/StructureDefinition/data-absent-reason` and whose `valueCode` says
 * why. That is a **declaration**, not a gap: "we asked and nobody knows" is a different answer from
 * "we never sent this".
 *
 * Before this channel existed the model read both the same way. An element written that way is
 * present and value-absent, so no required-element finding fires and every value read returns
 * `undefined`, which is exactly what an element the sender never wrote returns. The difference was
 * in the document and reachable nowhere else, so a caller had to re-read the wire bytes to find it.
 * This module is the read that recovers it.
 *
 * ## What is an absence marker, and what is deliberately not
 *
 * An absence marker is an `Extension` whose `url` is **exactly** the canonical URL above, written
 * either on a complex element's `extension` or on a primitive element's extension metadata (the
 * `_`-sibling in JSON, a child `<extension>` in XML). Both wire formats reach the same model, so
 * both are read here by one predicate.
 *
 * **The DataAbsentReason CODE SYSTEM used as a `Coding` inside a coded element is NOT a marker and
 * is not read here.** A `CodeableConcept` carrying `system` = the code system URI with `code` =
 * `unknown` is a present, conformant coded VALUE; reading it as an absent element would be a
 * different question with a different failure mode. The two URIs are close enough to confuse, and
 * one published implementation guide page writes the extension's `url` as the code system URI,
 * which is an error on that page: the extension definition fixes `Extension.url` at the
 * `StructureDefinition` canonical, and that is the only string matched here.
 *
 * **The `Observation.dataAbsentReason` ELEMENT is not a marker either.** That element is an ordinary
 * `CodeableConcept` with its own `obs-6` invariant, already checked by the validator's safety layer,
 * and conflating the two would double-report one document and mis-report another.
 *
 * ## What a report may carry
 *
 * The absence code and the FHIRPath location of the element the marker sits on, and nothing else
 * from the document. The code is safe to carry for the same reason the retraction and negation codes
 * are: it is drawn from a **closed, spec-defined 15-concept set** this module spells in its own
 * source, so a report can only ever contain one of fifteen literal strings this package wrote down.
 * A `valueCode` outside that set is never carried, never coerced into a member of it, and never
 * folded into `unknown`; its element's location goes on the unreadable channel instead. The location
 * is bounded segment by segment by the same rule every other location in this package uses.
 *
 * ## No coercion, in either direction
 *
 * FHIR `code` is case-sensitive and its lexical space excludes surrounding whitespace, so `UNKNOWN`
 * and `" unknown"` are not the code `unknown` and are not read as one. Nothing here trims, case-folds
 * or substitutes: a code the sender did not spell is not a code this library will author. The
 * refusal is disclosed rather than silent, which is the same disposition the near-miss negation
 * channel takes for the same reason.
 *
 * @packageDocumentation
 */

import {
  childPath,
  getAllProperties,
  isComplex,
  isList,
  isPrimitive,
  type FhirComplex,
  type FhirNode,
} from "../model/index.js";
import { primitiveString } from "./codes.js";

/**
 * The canonical URL of the R4 DataAbsentReason extension, fixed by its own definition as
 * `Extension.url`. An extension is an absence marker when its `url` is this string and never when
 * it merely resembles it: the code system URI that names the same concepts is a **different** URI
 * and is not matched.
 *
 * @example
 * ```ts
 * import { DATA_ABSENT_REASON_URL } from "@cosyte/fhir";
 * DATA_ABSENT_REASON_URL; // "http://hl7.org/fhir/StructureDefinition/data-absent-reason"
 * ```
 */
export const DATA_ABSENT_REASON_URL = "http://hl7.org/fhir/StructureDefinition/data-absent-reason";

/**
 * The complete DataAbsentReason value set: fifteen concepts, transcribed from the published R4
 * expansion in the order it lists them, all drawn from one code system. The extension's `value[x]`
 * binds to this value set at **required** strength, so the set is closed: a `valueCode` outside it
 * is a binding violation, not a local extension of the vocabulary.
 *
 * It is enumerated here for the same reason the required `code` bindings the validator enforces are
 * enumerated in its own source: membership in a closed, published, required-strength set is decided
 * from the set itself, and no terminology service, value-set expansion or vendored terminology
 * resource is involved. This is the whole of the terminology content this channel needs.
 *
 * @example
 * ```ts
 * import { ABSENCE_CODES } from "@cosyte/fhir";
 * ABSENCE_CODES.length;         // 15
 * ABSENCE_CODES.includes("masked"); // true
 * ```
 */
export const ABSENCE_CODES = [
  "unknown",
  "asked-unknown",
  "temp-unknown",
  "not-asked",
  "asked-declined",
  "masked",
  "not-applicable",
  "unsupported",
  "as-text",
  "error",
  "not-a-number",
  "negative-infinity",
  "positive-infinity",
  "not-performed",
  "not-permitted",
] as const;

/**
 * One of the fifteen {@link ABSENCE_CODES}. A value of this type is always one of the literal
 * strings this package spells, never a string taken off a document, which is what makes an
 * {@link AbsenceMarker} safe to log.
 */
export type AbsenceCode = (typeof ABSENCE_CODES)[number];

/**
 * Whether a string is exactly one of the fifteen {@link ABSENCE_CODES}.
 *
 * The comparison is exact. A case or whitespace variant is **not** a member and is not made into
 * one: FHIR `code` is case-sensitive and its lexical space excludes surrounding whitespace, so
 * folding `"UNKNOWN"` in would accept a non-conformant document as conformant and author a reason
 * the sender did not spell.
 *
 * @param value - Any string.
 * @returns `true` when the string is a member of the value set.
 * @example
 * ```ts
 * import { isAbsenceCode } from "@cosyte/fhir";
 * isAbsenceCode("not-performed"); // true
 * isAbsenceCode("UNKNOWN");       // false, never coerced
 * ```
 */
export function isAbsenceCode(value: string): value is AbsenceCode {
  return (ABSENCE_CODES as readonly string[]).includes(value);
}

/**
 * One readable declared absence: which reason, and where.
 *
 * Value-free by construction. `code` is one of the fifteen literal strings {@link ABSENCE_CODES}
 * holds, never a string read off the document, and `location` is a FHIRPath location whose every
 * segment is bounded to the published form of a FHIR name.
 *
 * The location names the **marked element**, not the extension that marks it: the caller's question
 * is "what happened to this element", and the extension is the answer's carrier rather than its
 * subject.
 */
export interface AbsenceMarker {
  /** The reason the sender spelled, always a member of the closed value set. */
  readonly code: AbsenceCode;
  /** The FHIRPath location of the element the marker sits on, bounded (never a document value). */
  readonly location: string;
}

/** The three lists one walk of a document collects. */
export interface AbsenceReport {
  /** Readable markers, in walk order, one entry per distinct reason at a location. */
  readonly markers: readonly AbsenceMarker[];
  /** Locations of elements carrying a marker whose reason could not be read. */
  readonly unreadable: readonly string[];
  /** Locations of elements carrying both a marker and a value of their own. */
  readonly conflicting: readonly string[];
}

/** Mutable accumulator for {@link collectAbsence}. */
interface MutableReport {
  readonly markers: AbsenceMarker[];
  readonly unreadable: string[];
  readonly conflicting: string[];
}

/**
 * The member names that are an element's identity or metadata rather than its value.
 *
 * `id` and `extension` are R4 `Element`'s own members, `modifierExtension` is a `BackboneElement`'s,
 * and `url` is an `Extension`'s identity. None of them is the value an absence marker denies, so an
 * element carrying only these beside a marker carries no value and is not in conflict with it.
 *
 * `resourceType` is here for a sharper reason than the other four: it is not a FHIR element at all
 * but the JSON encoding's way of naming the type, which FHIR XML spells as the tag instead. Counting
 * it as content would make the two wire formats disagree about the same instance.
 */
const STRUCTURAL_MEMBERS: ReadonlySet<string> = new Set([
  "id",
  "url",
  "extension",
  "modifierExtension",
  "resourceType",
]);

/**
 * Every extension written on a node, in either of the two places the model puts one: a primitive's
 * extension metadata, or a complex element's `extension` property.
 *
 * The property is read across every member a repeated name left, and through the single-versus-list
 * difference the two readers produce (FHIR JSON always writes an array; the XML reader models a lone
 * `<extension>` child as one node). A marker must not become invisible because a document spelled
 * its carrier one legal way rather than the other.
 */
function extensionsOf(node: FhirNode): readonly FhirNode[] {
  if (isPrimitive(node)) return node.extension ?? [];
  if (!isComplex(node)) return [];
  return getAllProperties(node, "extension").flatMap((written) =>
    isList(written) ? written.items : [written],
  );
}

/**
 * Whether an extension node is an absence marker: a complex element carrying the canonical
 * DataAbsentReason `url`.
 *
 * The `url` is read across every member a repeated name left, because recognition is additive: a
 * marker recognised through a duplicate name adds a disclosure a caller can act on, and one missed
 * behind a duplicate name is the silence this channel exists to end. A document that repeats a
 * property name already draws its own error, so this can never be the finding that first turns a
 * conformant document non-conformant.
 */
function isAbsenceMarker(extension: FhirNode): extension is FhirComplex {
  if (!isComplex(extension)) return false;
  return getAllProperties(extension, "url").some(
    (written) => primitiveString(written) === DATA_ABSENT_REASON_URL,
  );
}

/**
 * The reason a marker spells, or `undefined` when it spells none this library may read.
 *
 * Readable means: **exactly one** `valueCode` was written, it is a string primitive, and that string
 * is a member of the closed value set. Everything else is unreadable, and each arm is a real
 * document rather than a hypothetical: no `valueCode` at all, a `valueCode` whose value channel is
 * empty, a `valueCode` holding something other than a string, an empty string, a code outside the
 * value set, and a `valueCode` written twice with no rule for ranking the two.
 *
 * Nothing here descends, coerces or picks. Reading a second `valueCode`'s value would rank two
 * values the sender left unranked; reading a non-member would author a reason nobody spelled.
 */
function reasonOf(marker: FhirComplex): AbsenceCode | undefined {
  const written = getAllProperties(marker, "valueCode");
  if (written.length !== 1) return undefined;
  const spelled = primitiveString(written[0]);
  if (spelled === undefined || !isAbsenceCode(spelled)) return undefined;
  return spelled;
}

/**
 * Whether an element carries a value of its own beside the marker.
 *
 * A primitive carries one when its value channel is filled. A complex element carries one when it
 * holds any member that is not in {@link STRUCTURAL_MEMBERS}, which is R4's own answer to the same
 * question: an element has a value or it has children, and `id` / `extension` / `modifierExtension`
 * are neither.
 *
 * Members a repeated property name shadowed count too. A value must not stop counting as a value by
 * arriving second under a duplicate key.
 */
function carriesValue(node: FhirNode): boolean {
  if (isPrimitive(node)) return node.value !== undefined;
  if (!isComplex(node)) return false;
  return [...node.properties, ...(node.duplicates ?? [])].some(
    (property) => !STRUCTURAL_MEMBERS.has(property.name),
  );
}

/** Append `location` to `out` unless it is already the last thing said about that element. */
function pushOnce(out: string[], location: string): void {
  if (!out.includes(location)) out.push(location);
}

/** Record what the markers on ONE node say, if it carries any. */
function visit(node: FhirNode, path: string, out: MutableReport): void {
  const markers = extensionsOf(node).filter(isAbsenceMarker);
  if (markers.length === 0) return;
  // The conflict is a property of the ELEMENT, not of an individual marker, so it is decided once
  // however many markers sit here: FHIRPath cannot address one extension apart from the element.
  if (carriesValue(node)) pushOnce(out.conflicting, path);
  for (const marker of markers) {
    const code = reasonOf(marker);
    if (code === undefined) {
      pushOnce(out.unreadable, path);
      continue;
    }
    // One entry per distinct reason at a location. Two markers spelling the same reason at one
    // element say the same thing twice; two spelling different reasons genuinely differ, and
    // collapsing them would pick one.
    if (!out.markers.some((seen) => seen.code === code && seen.location === path)) {
      out.markers.push({ code, location: path });
    }
  }
}

/**
 * Walk every node the model has, recording each element an absence marker sits on.
 *
 * The traversal is the whole document: every element at every depth, a primitive's extension
 * metadata, a resource nested in `contained` or a Bundle entry, and a member a repeated property
 * name shadowed. It matches the walk the unreadable-content channels use, so a marker cannot be
 * reachable by one and not by the other.
 *
 * An extension is itself a complex element, so a marker nested inside another extension is reached
 * by the ordinary descent rather than by a special case.
 */
function walk(node: FhirNode, path: string, out: MutableReport): void {
  visit(node, path, out);
  if (isList(node)) {
    node.items.forEach((item, index) => {
      walk(item, `${path}[${String(index)}]`, out);
    });
    return;
  }
  if (isPrimitive(node)) {
    (node.extension ?? []).forEach((extension, index) => {
      walk(extension, `${path}.extension[${String(index)}]`, out);
    });
    return;
  }
  for (const property of node.properties) walk(property.value, childPath(path, property.name), out);
  for (const property of node.duplicates ?? []) {
    walk(property.value, childPath(path, property.name), out);
  }
}

/**
 * Collect every declared absence a resource carries, in one walk.
 *
 * The three lists are built together so they cannot come to cover different parts of a document:
 * whatever a node has to be for a marker to be recognised on it, it is the same node whose reason is
 * read and the same node whose value is compared against it.
 *
 * A **conflicting** marker appears on `conflicting` **and**, when its reason is readable, on
 * `markers`. That is deliberate: the element carries a value and a declaration that it has none, and
 * dropping either from the readout would silently prefer the other. The refusal to rank them is the
 * point, and the caller gets both plus a location saying they disagree.
 *
 * @param resource - The resource model.
 * @param path - The FHIRPath prefix for the resource root (usually its `resourceType`).
 * @returns The readable markers, the unreadable locations and the conflicting locations, in walk
 *   order. **Walk order is not document order**; do not diff a caller's expectations against the
 *   order the document wrote.
 * @internal
 */
export function collectAbsence(resource: FhirComplex, path: string): AbsenceReport {
  const out: MutableReport = { markers: [], unreadable: [], conflicting: [] };
  walk(resource, path, out);
  return out;
}
