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
 * still yields one report. The other four land on the channel this module feeds.
 *
 * ## The recognition predicate, and why it is by KEY NAME
 *
 * An occurrence is decided by key name and by literal `resourceType` equality alone: no element
 * table, no StructureDefinition, no datatype model, no sibling-key shape. Four rules and nothing
 * else is an occurrence:
 *
 * - `comparator`: ANY object node the walk reaches that carries a member named `comparator` or
 *   `_comparator`, whatever element name it sits under, whatever the enclosing `resourceType` is,
 *   and whether or not it also carries `value`, `unit`, `system` or `code`;
 * - `implicitRules`: any object node the walk reaches carrying `implicitRules` or `_implicitRules`;
 * - `active`: a member named `active` or `_active` on the ROOT object of a resource whose
 *   `resourceType` is the exact string `Patient`, top-level or contained or a Bundle entry, and
 *   nowhere else;
 * - `use`: a member named `use` or `_use` on any entry of the `identifier` array on the ROOT object
 *   of a resource whose `resourceType` is the exact string `Practitioner`, and nowhere else.
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
 * unit, no code, no `implicitRules` URI, no name, no identifier, no free text. The element name is
 * safe by construction, being one of four literal keys this module spells.
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
  rootPath,
  WITHHELD,
  type FhirComplex,
  type FhirNode,
} from "../model/index.js";
import { SAFETY_RESOURCE_TYPES, typesOf } from "./codes.js";

/**
 * The modifier elements this channel reports, by their R4 element names.
 *
 * `modifierExtension` is deliberately absent: it keeps its own fail-closed channel, so a modifier
 * extension yields one report and not two.
 */
export type ModifierElementName = "comparator" | "implicitRules" | "active" | "use";

/**
 * One reported modifier element: which element, and where.
 *
 * Value-free by contract. `element` is one of four literal keys this library spells, never a name
 * read off the document, and `location` is bounded segment by segment with its root restricted to
 * {@link MODIFIER_ELEMENT_ROOT_TYPES}.
 */
export interface ModifierElementReport {
  /** The modifier element that is present. */
  readonly element: ModifierElementName;
  /** The FHIRPath location it is present at, bounded (never a document value). */
  readonly location: string;
}

/** The `resourceType` a `Patient`-gated rule requires, spelled once. */
const PATIENT = "Patient";

/** The `resourceType` a `Practitioner`-gated rule requires, spelled once. */
const PRACTITIONER = "Practitioner";

/** The element whose entries carry the `Practitioner`-gated `use`. */
const IDENTIFIER = "identifier";

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
 *   elements this library surfaces;
 * - `Patient`, the one type the validator carries a built-in element table for, and one of the two
 *   types this module's own predicate gates on;
 * - `Practitioner`, the other type this module's predicate gates on;
 * - `Bundle`, which the validator branches on by name when it checks entries.
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
 * The two gated rules run off the node's own `resourceType`, read through a repeated property name
 * and an array wrapper exactly as every other type gate in this layer reads it: a type-gate hole is
 * how a modifier goes unreported on a document that names its type twice.
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
  if (types.includes(PATIENT) && carries(node, "active")) {
    out.push({ element: "active", location: childPath(path, "active") });
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
 * Re-root every location at the token this channel is allowed to use, given the types the document
 * named. The walk builds its paths off one prefix shared by every channel, and this is the only
 * channel that tightens what that prefix may be, so the tightening happens here and touches no
 * other channel's output.
 *
 * @internal
 */
export function rebaseModifierElements(
  reports: readonly ModifierElementReport[],
  prefix: string,
  types: readonly string[],
): ModifierElementReport[] {
  const declared = types[0];
  // No `resourceType` at all: the prefix is already a library constant and names nothing document
  // -supplied, so there is nothing to re-root.
  if (declared === undefined) return [...reports];
  const root = MODIFIER_ELEMENT_ROOT_TYPES.has(declared) ? rootPath(declared) : WITHHELD;
  if (root === prefix) return [...reports];
  return reports.map((report) => ({
    element: report.element,
    location: report.location.startsWith(prefix)
      ? `${root}${report.location.slice(prefix.length)}`
      : report.location,
  }));
}
