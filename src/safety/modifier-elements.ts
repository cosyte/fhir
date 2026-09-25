/**
 * Modifier ELEMENTS, the second half of FHIR's "check for modifiers anywhere they could appear".
 *
 * A modifier is not only a `modifierExtension`. R4 flags several ordinary base elements
 * `Is Modifier: true` because they change how the value beside them must be read, and
 * `Quantity.comparator` is the sharpest of them: `< 0.01 mg` read as `0.01 mg` is a wrong lab
 * result delivered under a clean verdict. US Core names five such elements for a consumer to check
 * (`implicitRules`, `modifierExtension`, `Observation.value[x].comparator`,
 * `Practitioner.identifier.use`, `Patient.active`) and says rejection is typically the only safe
 * action when an unexpected one is present.
 *
 * `modifierExtension` already fails closed on its own channel ({@link ./status.js}
 * `unhandledModifierExtensions`) and is deliberately NOT reported here, so one modifier extension
 * still yields one report. The other four land on the channel this module feeds, and so do three
 * more R4 flags on the resource types this library reads a safety verdict from: a Patient's
 * `deceased[x]` and `link`, and an Immunization's `isSubpotent`.
 *
 * ## The recognition predicate, and why it is by KEY NAME
 *
 * An occurrence is decided by key name and by literal `resourceType` equality alone: no element
 * table, no StructureDefinition, no datatype model, no sibling-key shape. These rules and nothing
 * else make an occurrence:
 *
 * - `comparator`: ANY object node the walk reaches that carries a member named `comparator` or
 *   `_comparator`, whatever element name it sits under, whatever the enclosing `resourceType` is,
 *   and whether or not it also carries `value`, `unit`, `system` or `code`;
 * - `implicitRules`: any object node the walk reaches carrying `implicitRules` or `_implicitRules`;
 * - `active`: a member named `active` or `_active` on the ROOT object of a resource whose
 *   `resourceType` is the exact string `Patient`, top-level or contained or a Bundle entry, and
 *   nowhere else;
 * - `use`: a member named `use` or `_use` on any entry of the `identifier` array on the ROOT object
 *   of a resource whose `resourceType` is the exact string `Practitioner`, and nowhere else;
 * - `deceased`: a member whose name, less a leading `_`, begins `deceased`, on the ROOT object of a
 *   `Patient`, and nowhere else. The element is the R4 choice `deceased[x]`, so the stem is the key:
 *   `deceasedBoolean` and `deceasedDateTime` are the two members R4 defines, and a member it does not
 *   define (`deceasedString`, a bare `deceased`) is reported rather than passed over, because a
 *   choice suffix nobody expected is still the sender saying something about a death. The report
 *   is located at the member as written, so a caller can tell the two R4 members apart;
 * - `link`: a member named `link` or `_link` on the ROOT object of a `Patient`, and nowhere else,
 *   reported ONCE at `link` however many entries it holds. No entry is read: `link.type` is what
 *   says whether this record was replaced by another, and reading it would be interpreting the
 *   modifier rather than reporting it;
 * - `isSubpotent`: a member named `isSubpotent` or `_isSubpotent` on the ROOT object of an
 *   `Immunization`, and nowhere else.
 *
 * The three gated on a Patient or an Immunization report at ANY value, `false` included, exactly as
 * `active` does. `{"deceasedBoolean":false}` is a Patient the sender says is alive, and deciding
 * that from the value would be reading a modifier to decide whether to report it, which opens a
 * readable-versus-unreadable fork this channel does not have. A caller that has read the element
 * handles the report; one that has not is refused.
 *
 * The first two OVER-REPORT by construction, and that is the trade taken rather than an oversight.
 * `{"resourceType":"Foo","x":{"comparator":"anything"}}` is an occurrence, so a non-FHIR payload
 * and a vendor extension that reuses the name both stop the readout affirming. The alternative, a
 * type-directed predicate, needs an element table this library does not have (its built-in schema
 * set holds one entry), so it would either under-report every unmodeled type or wait on modelling
 * six more. A false positive costs a caller a refusal; a false negative costs a patient a wrong
 * value read as right.
 *
 * A structural predicate is rejected by name: `{"comparator":"<"}` standing alone, with no `value`,
 * `unit`, `system` or `code` beside it, IS an occurrence and IS reported. That is exactly the
 * unreadable modifier this layer has to fail closed on. PRESENCE OF THE KEY is the trigger, in
 * every form the codec can leave it in (a value outside the R4 value set, a value of the wrong JSON
 * type, a JSON `null`, or the primitive-extension `_` form with no value sibling); readability of
 * the value is never a precondition, and no value is ever interpreted, normalised or repaired.
 *
 * ## What a report may carry, and what a LOCATION may carry
 *
 * The element name and the location, and nothing taken from the document: no measurement value, no
 * unit, no code, no `implicitRules` URI, no name, no identifier, no date, no linked record, no free
 * text. The element name is safe by construction, being one of the literal keys this module spells
 * ({@link ModifierElementName}).
 *
 * ## `MedicationRequest.intent`, which is SURFACED rather than reported
 *
 * R4 flags `intent` a modifier too, and it is mandatory (`1..1`), so reporting it on presence would
 * refuse every MedicationRequest there is. It is surfaced instead, the way `status` is: at every
 * `MedicationRequest` root, the code paired with the location of that root's `intent`
 * ({@link IntentReport}). Only the eight codes the R4 value set defines can be surfaced
 * ({@link MedicationRequestIntent}), matched exactly and case-sensitively, so this channel never
 * echoes a string the document wrote. Anything else present at `intent` (a string outside the
 * eight, a case or whitespace variant of one, a JSON `null`, a value of another JSON type, the `_`
 * form with no value, an array wrapper, a name written twice) is not a code this library may read:
 * nothing is surfaced for that root, its location is reported as unreadable, and that lowers the
 * verdict. Nothing is case-folded, trimmed or mapped to a nearby code. An ABSENT `intent` surfaces
 * nothing and refuses nothing, because a missing mandatory element is the validator's verdict.
 *
 * No meaning is read out of the code: whether a `proposal` is an order is the caller's question.
 *
 * The location is the one place document text can reach a report, and it is bounded twice:
 *
 * 1. **Every path SEGMENT** is rendered by {@link ../model/path.js} `childPath`, the bound this
 *    package already ships and pins: a segment matching the published element-name form is echoed,
 *    anything else is replaced by {@link ../model/path.js} `WITHHELD`. So
 *    `{"resourceType":"Foo","DOE-JOHN-1970-01-01-MRN-8891":{"comparator":"<"}}` reports at a
 *    location carrying neither string. What that bound deliberately does NOT do is refuse a forgery
 *    genuinely shaped like an element name, which is stated rather than claimed away.
 * 2. **The ROOT** is stricter here than anywhere else in the package, and this channel is the only
 *    one that tightens it: a resource type name roots a location ONLY IF it is a member of
 *    {@link MODIFIER_ELEMENT_ROOT_TYPES}, a set this library defines in its own source, and
 *    otherwise the root is `WITHHELD`. A type name the library defines is structural vocabulary; an
 *    unmodeled one is an attacker-controlled string, and a bounded echo of it would be a NEW
 *    surface that carries document text. Nothing a caller can read today is lost: the
 *    `RESOURCE_NOT_MODELED` issue in the same readout still names the type exactly as it did.
 *
 * @packageDocumentation
 */

import {
  childPath,
  getAllProperties,
  isComplex,
  isList,
  isPrimitive,
  rootPath,
  WITHHELD,
  type FhirComplex,
  type FhirNode,
} from "../model/index.js";
import { SAFETY_RESOURCE_TYPES, typesOf } from "./codes.js";

/**
 * The modifier elements this channel reports, by their R4 element names. `deceased` names the R4
 * choice element `deceased[x]`; the report's location carries the member as the document wrote it.
 *
 * `modifierExtension` is deliberately absent: it keeps its own fail-closed channel, so a modifier
 * extension yields one report and not two. `MedicationRequest.intent` is absent too: it is
 * surfaced as a code on its own field rather than reported on presence ({@link IntentReport}).
 *
 * @example
 * ```ts
 * import { parseResource, readSafety, type ModifierElementName } from "@cosyte/fhir";
 * const { resource } = parseResource('{"resourceType":"Patient","deceasedBoolean":true}');
 * const names: ModifierElementName[] = readSafety(resource).modifierElements.map((r) => r.element);
 * names; // ["deceased"]
 * ```
 */
export type ModifierElementName =
  | "comparator"
  | "implicitRules"
  | "active"
  | "use"
  | "deceased"
  | "link"
  | "isSubpotent";

/**
 * One reported modifier element: which element, and where.
 *
 * Value-free by contract. `element` is one of the literal keys this library spells, never a name
 * read off the document, and `location` is bounded segment by segment with its root restricted to
 * {@link MODIFIER_ELEMENT_ROOT_TYPES}.
 */
export interface ModifierElementReport {
  /** The modifier element that is present. */
  readonly element: ModifierElementName;
  /** The FHIRPath location it is present at, bounded (never a document value). */
  readonly location: string;
}

/**
 * A `MedicationRequest.intent` code this library surfaces: exactly the eight concepts of the R4
 * 4.0.1 value set the element binds to at required strength, and nothing else.
 *
 * @example
 * ```ts
 * import { parseResource, readSafety, type MedicationRequestIntent } from "@cosyte/fhir";
 * const { resource } = parseResource('{"resourceType":"MedicationRequest","intent":"proposal"}');
 * const codes: MedicationRequestIntent[] = readSafety(resource).intents.map((i) => i.code);
 * codes; // ["proposal"]
 * ```
 */
export type MedicationRequestIntent =
  | "proposal"
  | "plan"
  | "order"
  | "original-order"
  | "reflex-order"
  | "filler-order"
  | "instance-order"
  | "option";

/**
 * One surfaced `MedicationRequest.intent`: the code exactly as the document wrote it, and the
 * location of the `intent` element it was read from, one per `MedicationRequest` root.
 *
 * The code is one of the eight {@link MedicationRequestIntent} values, matched exactly, so this
 * carries no text the library did not spell itself. The location follows the same bound and the
 * same root rule as {@link ModifierElementReport}'s.
 */
export interface IntentReport {
  /** The intent code, exactly as written. */
  readonly code: MedicationRequestIntent;
  /** The FHIRPath location of the `intent` element it was read from, bounded. */
  readonly location: string;
}

/** The `resourceType` a `Patient`-gated rule requires, spelled once. */
const PATIENT = "Patient";

/** The `resourceType` a `Practitioner`-gated rule requires, spelled once. */
const PRACTITIONER = "Practitioner";

/** The `resourceType` the `isSubpotent` rule requires, spelled once. */
const IMMUNIZATION = "Immunization";

/** The `resourceType` whose `intent` is surfaced, spelled once. */
const MEDICATION_REQUEST = "MedicationRequest";

/** The element whose entries carry the `Practitioner`-gated `use`. */
const IDENTIFIER = "identifier";

/** The stem every member of the R4 choice element `Patient.deceased[x]` is spelled with. */
const DECEASED = "deceased";

/** The element surfaced rather than reported. */
const INTENT = "intent";

/**
 * The eight codes of the R4 4.0.1 `MedicationRequest.intent` value set, and the whole of what
 * {@link collectIntent} will surface.
 */
const INTENT_CODES: ReadonlySet<string> = new Set<MedicationRequestIntent>([
  "proposal",
  "plan",
  "order",
  "original-order",
  "reflex-order",
  "filler-order",
  "instance-order",
  "option",
]);

/** The two elements recognised by key name alone, wherever the walk reaches them. */
const UNGATED_ELEMENTS: readonly ModifierElementName[] = ["implicitRules", "comparator"];

/**
 * The resource type names that may root a modifier-element location, which is every resource type
 * name THIS LIBRARY spells in its own source, and no other.
 *
 * Named concretely rather than left to "known or modeled", because two candidate sets exist here
 * with different memberships and the choice decides what a location reads:
 *
 * - the seven `SAFETY_RESOURCE_TYPES` ({@link ./codes.js}), the types whose type-scoped safety
 *   elements this library surfaces, `Immunization` and `MedicationRequest` among them;
 * - `Patient`, the one type the validator carries a built-in element table for, and one of the
 *   types this module's own predicate gates on;
 * - `Practitioner`, another type this module's predicate gates on;
 * - `Bundle`, which the validator branches on by name when it checks entries.
 *
 * The surfaced `MedicationRequest.intent` locations ({@link IntentReport}) and the unreadable ones
 * are rooted by the same rule, since they are read by this module at the same window.
 *
 * The set is the union, and it is derived from source constants only. **It is never derived from
 * the input**: a type name is a member because this package wrote it down, not because a document
 * looked plausible. That is the whole property, and a "shaped like a resource type" test would
 * defeat it, since a forged name can match a shape.
 *
 * @example
 * ```ts
 * import { MODIFIER_ELEMENT_ROOT_TYPES } from "@cosyte/fhir";
 * MODIFIER_ELEMENT_ROOT_TYPES.has("MedicationRequest"); // true
 * MODIFIER_ELEMENT_ROOT_TYPES.has("Foo");               // false, such a location roots at "<withheld>"
 * ```
 */
export const MODIFIER_ELEMENT_ROOT_TYPES: ReadonlySet<string> = new Set([
  ...SAFETY_RESOURCE_TYPES,
  PATIENT,
  PRACTITIONER,
  "Bundle",
]);

/**
 * Whether this node carries a member with `name`, in either of the two spellings R4 gives one: the
 * value itself, or the primitive-extension `_` sibling that can stand alone when the value is
 * absent. Reading the metadata spelling is what stops `{"active":null,"_active":{…}}` reading as
 * "absent" and coming back summarizable over a document that carries the modifier.
 *
 * @internal
 */
function carries(node: FhirComplex, name: string): boolean {
  return getAllProperties(node, name).length > 0 || getAllProperties(node, `_${name}`).length > 0;
}

/**
 * Visit each entry of a repeating element, indexing the location at the array as the walk itself
 * does. A node that is not a list is one entry with no index, because there is no array in the
 * document to index into.
 *
 * @internal
 */
function eachEntry(
  value: FhirNode,
  path: string,
  visit: (entry: FhirComplex, at: string) => void,
): void {
  if (isList(value)) {
    value.items.forEach((item, index) => {
      if (isComplex(item)) visit(item, `${path}[${String(index)}]`);
    });
    return;
  }
  if (isComplex(value)) visit(value, path);
}

/**
 * Record every modifier element THIS node is an occurrence of. Called once per complex node the
 * safety walk reaches, so the window this reports at is exactly the window the walk reads at, and
 * the location is the path the walk had already built (array indices included, unconditionally).
 *
 * The gated rules run off the node's own `resourceType`, read through a repeated property name and
 * an array wrapper exactly as every other type gate in this layer reads it: a type-gate hole is how
 * a modifier goes unreported on a document that names its type twice.
 *
 * @internal
 */
export function collectModifierElements(
  node: FhirComplex,
  path: string,
  out: ModifierElementReport[],
): void {
  for (const element of UNGATED_ELEMENTS) {
    if (carries(node, element)) out.push({ element, location: childPath(path, element) });
  }
  const types = typesOf(node);
  if (types.includes(PATIENT)) {
    if (carries(node, "active")) {
      out.push({ element: "active", location: childPath(path, "active") });
    }
    for (const member of deceasedMembers(node)) {
      out.push({ element: "deceased", location: childPath(path, member) });
    }
    if (carries(node, "link")) out.push({ element: "link", location: childPath(path, "link") });
  }
  if (types.includes(IMMUNIZATION) && carries(node, "isSubpotent")) {
    out.push({ element: "isSubpotent", location: childPath(path, "isSubpotent") });
  }
  if (types.includes(PRACTITIONER)) {
    const at = childPath(path, IDENTIFIER);
    for (const written of getAllProperties(node, IDENTIFIER)) {
      eachEntry(written, at, (entry, entryPath) => {
        if (carries(entry, "use")) {
          out.push({ element: "use", location: childPath(entryPath, "use") });
        }
      });
    }
  }
}

/**
 * Collapse reports that name one element at one location to a single report.
 *
 * A value and its `_` sibling are one occurrence at one element, so counting them twice would make
 * the multi-location bar this channel exists to hold ungradeable. A repeated property name puts two
 * members at one location too, and FHIRPath cannot address the individual members, which is the
 * same reason every other location channel here collapses.
 *
 * @internal
 */
export function dedupeModifierElements(
  reports: readonly ModifierElementReport[],
): ModifierElementReport[] {
  const seen = new Set<string>();
  const out: ModifierElementReport[] = [];
  for (const report of reports) {
    const key = `${report.element} ${report.location}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(report);
  }
  return out;
}

/**
 * The names of every member of `Patient.deceased[x]` this node carries, each once, in the order the
 * document wrote them, with a leading `_` removed so a value and its metadata name one member. Any
 * name on the stem counts, including a suffix R4 does not define and the bare stem, because the
 * predicate is presence and an unexpected spelling is the case it must not pass over.
 *
 * @internal
 */
function deceasedMembers(node: FhirComplex): string[] {
  const members = new Set<string>();
  for (const property of [...node.properties, ...(node.duplicates ?? [])]) {
    const name = property.name.startsWith("_") ? property.name.slice(1) : property.name;
    if (name.startsWith(DECEASED)) members.add(name);
  }
  return [...members];
}

/**
 * Read `MedicationRequest.intent` off THIS node when it is a `MedicationRequest` root, gated as the
 * reports above are, off the node's own `resourceType`. The surfaced code goes on `intents` and an
 * unreadable one's location on `unreadable`, decided by this one function at one window, so a root
 * is on exactly one of the two lists or on neither.
 *
 * The code is surfaced only when the document wrote exactly one `intent` member holding one JSON
 * string equal to one of the eight {@link MedicationRequestIntent} codes. Anything else written
 * there is recorded as unreadable at the element's location and nothing is surfaced for the root:
 * a second member (a repeated name), an array wrapper, a value that is not a string, a value that is
 * absent (a JSON `null`, or the `_` form alone), or a string outside the eight. The comparison is
 * exact, so `"PROPOSAL"` and `" order"` are not codes here. A root carrying neither `intent` nor
 * `_intent` draws nothing.
 *
 * A value the XML reader recovered from element text reads as that value, exactly as `status` does
 * there; the element-text channel is what refuses that document.
 *
 * @internal
 */
export function collectIntent(
  node: FhirComplex,
  path: string,
  intents: IntentReport[],
  unreadable: string[],
): void {
  if (!typesOf(node).includes(MEDICATION_REQUEST)) return;
  const written = getAllProperties(node, INTENT);
  if (written.length === 0 && getAllProperties(node, `_${INTENT}`).length === 0) return;
  const at = childPath(path, INTENT);
  const only = written.length === 1 ? written[0] : undefined;
  const value = only !== undefined && isPrimitive(only) ? only.value : undefined;
  if (typeof value === "string" && isIntentCode(value)) {
    intents.push({ code: value, location: at });
  } else {
    unreadable.push(at);
  }
}

/** Whether `value` is exactly one of the eight intent codes. */
function isIntentCode(value: string): value is MedicationRequestIntent {
  return INTENT_CODES.has(value);
}

/**
 * The function that re-roots one location at the token this module's channels are allowed to use,
 * given the types the document named. The walk builds its paths off one prefix shared by every
 * channel, and the channels this module feeds are the only ones that tighten what that prefix may
 * be, so the tightening happens here and touches no other channel's output.
 *
 * @internal
 */
export function modifierLocationRebaser(
  prefix: string,
  types: readonly string[],
): (location: string) => string {
  const declared = types[0];
  // No `resourceType` at all: the prefix is already a library constant and names nothing document
  // -supplied, so there is nothing to re-root.
  if (declared === undefined) return (location) => location;
  const root = MODIFIER_ELEMENT_ROOT_TYPES.has(declared) ? rootPath(declared) : WITHHELD;
  if (root === prefix) return (location) => location;
  return (location) =>
    location.startsWith(prefix) ? `${root}${location.slice(prefix.length)}` : location;
}

/**
 * Re-root every report's location. See {@link modifierLocationRebaser}.
 *
 * @internal
 */
export function rebaseModifierElements(
  reports: readonly ModifierElementReport[],
  prefix: string,
  types: readonly string[],
): ModifierElementReport[] {
  const rebase = modifierLocationRebaser(prefix, types);
  return reports.map((report) => ({ element: report.element, location: rebase(report.location) }));
}
