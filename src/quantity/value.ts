/**
 * The `Observation.value[x]` choice, typed by the **present** variant, never assumed.
 *
 * `Observation.value[x]` is an **11-way choice** (`valueQuantity`, `valueCodeableConcept`,
 * `valueString`, `valueBoolean`, `valueInteger`, `valueRange`, `valueRatio`, `valueSampledData`,
 * `valueTime`, `valueDateTime`, `valuePeriod`). A consumer that assumes `valueQuantity` and reads a
 * `valueString` of `"POSITIVE"` or a titer `valueRatio` of `1:64` as a number produces a wrong
 * clinical value. {@link readObservationValue} branches on the variant that is actually
 * present and reports it, so a caller must handle the type it got rather than the one it expected. The
 * same reader works on a `component` (its `value[x]` is the identical choice, minus the SampledData
 * caveat), so a blood-pressure panel's systolic/diastolic components discriminate too.
 *
 * `interpretation` (the H/L/HH abnormal flags) and `referenceRange` (population-qualified) are
 * surfaced here too, this layer preserves and exposes them; it never *computes* an abnormal flag from a
 * value and a range (known limitations).
 *
 * @packageDocumentation
 */

import {
  childPath,
  getAllProperties,
  getProperty,
  isComplex,
  isList,
  isPrimitive,
  type FhirComplex,
  type FhirNode,
} from "../model/index.js";
import { codingsOf, primitiveString, typesOf, type Coded } from "../safety/codes.js";
// The published validation-code registry, which has no imports of its own, so naming a code here
// does not put the value layer behind the validator: `../validate/quantity.js` still imports this
// module and not the other way round. The readout carries the SAME code the validator raises
// because a caller switching on one and reading the other must never see two vocabularies for one
// encoding fault.
import { VALIDATION_CODES, type ValidationCode } from "../validate/issues.js";
import { readQuantity, type Quantity } from "./ucum.js";

/**
 * The eleven `Observation.value[x]` variant type suffixes, in FHIR's declared order. A variant's JSON
 * property name is `"value" + <suffix>` (e.g. `"Quantity"` → `valueQuantity`, `"String"` →
 * `valueString`). This is the exact choice set from `observation.html`; a rename would be breaking.
 */
export const OBSERVATION_VALUE_TYPES = [
  "Quantity",
  "CodeableConcept",
  "String",
  "Boolean",
  "Integer",
  "Range",
  "Ratio",
  "SampledData",
  "Time",
  "DateTime",
  "Period",
] as const;

/** One of the eleven {@link OBSERVATION_VALUE_TYPES} `value[x]` variant suffixes. */
export type ObservationValueType = (typeof OBSERVATION_VALUE_TYPES)[number];

/**
 * The discriminated reading of an `Observation.value[x]` (or a `component.value[x]`). `type` names the
 * variant that is present; `quantity` is populated **only** when `type === "Quantity"`, so a caller
 * that wants a number must check the type first. `ambiguous` lists any *additional* variants also
 * present, a `value[x]` is a `0..1` choice, so a non-empty `ambiguous` is a structural defect (the
 * kind the structural validator reports as `CHOICE_AMBIGUOUS` once Observation is a modeled
 * schema). This reader surfaces it here regardless, so the extra variant is never silently dropped.
 */
export interface ObservationValue {
  /** The present variant's type suffix (e.g. `"Quantity"`, `"String"`, `"CodeableConcept"`). */
  readonly type: ObservationValueType;
  /** The full JSON property name of the present variant (e.g. `"valueQuantity"`). */
  readonly property: string;
  /** The raw value node for the present variant. */
  readonly node: FhirNode;
  /** The parsed {@link Quantity}, present **only** when `type === "Quantity"`; `undefined` otherwise. */
  readonly quantity: Quantity | undefined;
  /** Additional `value[x]` variants also present (a structural ambiguity); empty in a clean resource. */
  readonly ambiguous: readonly ObservationValueType[];
  /**
   * The published {@link ../validate/issues.js} `ValidationCode` for the ENCODING the present
   * variant arrived in, when FHIR JSON gives that shape no meaning at a `0..1` choice, and
   * `undefined` otherwise, which is every conformant document.
   *
   * The one value it takes today is `ARRAY_WRAPPED_CHOICE`: the variant arrived wrapped in a JSON
   * array, which json.html §2.6.2.2 reserves for a repeating element. **This is the channel that
   * distinguishes "the sender wrote a value here and nothing read it" from "the sender wrote no
   * value here"**, which `quantity: undefined` alone cannot: a `valueQuantity` of `[{"value":5,
   * "code":"mg"}]` and one of `{}` both read as a present `Quantity` with no magnitude, and one of
   * them is a 5 mg dose. It is the same code `validateResource` raises at the same location, so a
   * caller switching on this and a caller reading the issue list see one vocabulary.
   *
   * **It says nothing about the value's CONTENT.** A variant that arrived the way FHIR JSON spells
   * it and holds a shape the variant cannot carry is not this channel's business; nothing here is
   * a general "the value was unreadable" report.
   */
  readonly encodingIssue: ValidationCode | undefined;
}

/** The present `value[x]` variants as `{ type, node }`, in FHIR's declared order (`[]` when none). */
function presentValues(node: FhirComplex): { type: ObservationValueType; node: FhirNode }[] {
  const byName = new Map(node.properties.map((p) => [p.name, p.value]));
  const out: { type: ObservationValueType; node: FhirNode }[] = [];
  for (const type of OBSERVATION_VALUE_TYPES) {
    const value = byName.get(`value${type}`);
    if (value !== undefined) out.push({ type, node: value });
  }
  return out;
}

/**
 * Read the present `value[x]` variant off an Observation (or a `component`), typed by what is actually
 * there. Returns `undefined` when no `value[x]` is present (e.g. a `dataAbsentReason`-only
 * observation). When more than one variant is present, the first in FHIR's declared order is returned
 * and the rest are reported in {@link ObservationValue.ambiguous}.
 *
 * @param node - An `Observation` or `component` complex node.
 * @returns The discriminated {@link ObservationValue}, or `undefined` when there is no value.
 * @example
 * ```ts
 * import { parseResource, readObservationValue } from "@cosyte/fhir";
 * const { resource } = parseResource('{"resourceType":"Observation","valueString":"POSITIVE"}');
 * const v = readObservationValue(resource);
 * v?.type;     // "String", NOT a Quantity; reading it as a number would be wrong
 * v?.quantity; // undefined
 * ```
 */
export function readObservationValue(node: FhirComplex): ObservationValue | undefined {
  const [first, ...rest] = presentValues(node);
  if (first === undefined) return undefined;
  const wrapped = isList(first.node);
  return {
    type: first.type,
    property: `value${first.type}`,
    node: first.node,
    // Never from inside a wrapper, and the guard is written here rather than left to
    // {@link readQuantity} returning `undefined` for a list. Picking the member would author a
    // magnitude at a position the sender spelled ambiguously, which is the one thing Postel's Law
    // does not license: tolerate the form, never invent the content.
    quantity: first.type === "Quantity" && !wrapped ? readQuantity(first.node) : undefined,
    ambiguous: rest.map((r) => r.type),
    encodingIssue: wrapped ? VALIDATION_CODES.ARRAY_WRAPPED_CHOICE : undefined,
  };
}

/** The eleven `value[x]` property names, `value` + each {@link OBSERVATION_VALUE_TYPES} suffix. */
const OBSERVATION_VALUE_PROPERTIES: ReadonlySet<string> = new Set(
  OBSERVATION_VALUE_TYPES.map((type) => `value${type}`),
);

/**
 * Record every `value[x]` choice this element wrote as an array, across the members a repeated
 * property name left. One location per element name however many members carried a wrapper, because
 * FHIRPath cannot address an individual member, which is how the element-level wrapper report one
 * layer over already answers.
 */
function collectChoiceWrappers(
  element: FhirComplex,
  path: string,
  keep: (items: readonly FhirNode[]) => boolean,
  out: string[],
): void {
  for (const property of [...element.properties, ...(element.duplicates ?? [])]) {
    if (!OBSERVATION_VALUE_PROPERTIES.has(property.name)) continue;
    if (!isList(property.value)) continue;
    if (!keep(property.value.items)) continue;
    const at = childPath(path, property.name);
    if (!out.includes(at)) out.push(at);
  }
}

/**
 * Walk for Observation resource roots and record the `value[x]` wrappers at each, its `component`
 * entries included.
 *
 * **The type read is the fail-safe one** ({@link typesOf}, every `resourceType` member and every
 * value inside a wrapper on one) rather than the strict single-value read, on the same reasoning the
 * safety layer's cardinality window uses: a document whose own type gate arrived inside a wrapper is
 * already non-conformant, and over-reporting there is the safe direction where under-reporting hides
 * the value the gate stands in front of.
 */
function walkForObservationRoots(
  node: FhirNode,
  path: string,
  keep: (items: readonly FhirNode[]) => boolean,
  out: string[],
): void {
  if (isList(node)) {
    node.items.forEach((item, index) =>
      walkForObservationRoots(item, `${path}[${String(index)}]`, keep, out),
    );
    return;
  }
  // A primitive holds no resource; its `extension` metadata holds complexes, but an `Extension` is
  // a datatype and never a resource root, so nothing below one can be an Observation.
  if (isPrimitive(node)) return;
  if (typesOf(node).includes("Observation")) {
    collectChoiceWrappers(node, path, keep, out);
    // `Observation.component` is `0..*`, so the array there is the conformant encoding; each entry
    // carries its own `value[x]`, `0..1` exactly as the root's is (observation.html).
    for (const member of getAllProperties(node, "component")) {
      const items = isList(member) ? member.items : [member];
      items.forEach((item, index) => {
        if (!isComplex(item)) return;
        const at = isList(member) ? `${path}.component[${String(index)}]` : `${path}.component`;
        collectChoiceWrappers(item, at, keep, out);
      });
    }
  }
  for (const property of [...node.properties, ...(node.duplicates ?? [])]) {
    walkForObservationRoots(property.value, childPath(path, property.name), keep, out);
  }
}

/** Every wrapper, whatever it holds. */
const ANY_ARITY = (): boolean => true;

/**
 * The FHIRPath locations where an `Observation.value[x]` choice arrived wrapped in a JSON array.
 *
 * **This is the one window**, and the report, the readout's own
 * {@link ObservationValue.encodingIssue} and the XML write refusal all take it from here rather than
 * each deciding a cardinality of its own. `value[x]` and `component.value[x]` are `0..1` in R4
 * (observation.html), which is why this needs no per-resource element table and cannot fire on a
 * conformant document, and why it is scoped to the choice rather than widened to every R4 `0..1`
 * element: that widening IS the per-resource model this library does not have.
 *
 * Reaches every Observation resource root the model holds, a `contained` one and a `Bundle.entry`
 * one included, because a wrapper laundered at depth loses a dose exactly as one at the root does.
 *
 * @param resource - The resource model.
 * @param path - The FHIRPath prefix for the resource root (usually its `resourceType`).
 * @returns Those locations, each once, in walk order (which is not document order).
 * @internal
 */
export function arrayWrappedValueChoices(resource: FhirComplex, path: string): string[] {
  const out: string[] = [];
  walkForObservationRoots(resource, path, ANY_ARITY, out);
  return out;
}

/**
 * The subset of {@link arrayWrappedValueChoices} whose wrapper FHIR XML has no repetition to spell
 * back: one holding fewer than two items.
 *
 * **Same walk, same window, one narrowing.** It can never name a location
 * {@link arrayWrappedValueChoices} does not, which is what keeps the write path from growing a
 * cardinality table of its own. FHIR XML spells a repeat by repeating the element (xml.html) and
 * carries no other mark for one, so a wrapper of two or more items emits repeated elements, the
 * re-read groups them into a list and this location is reported again; refusing those would withdraw
 * a round trip that works today AND keeps the finding. There is no `resourceType`-style exception
 * here: `value[x]` is an element with a tag of its own at every arity.
 *
 * This counts ITEMS, while the sentence above reasons about EMITTED elements. They are the same
 * number for a model a reader produced and not in general, which is the same declared limit the
 * element-level wrapper refusal carries.
 *
 * The XML write path is its only consumer; it is not part of the public surface.
 *
 * @param resource - The resource model.
 * @param path - The FHIRPath prefix for the resource root (usually its `resourceType`).
 * @returns Those locations, each once, in the same walk order.
 * @internal
 */
export function unspellableXmlValueChoices(resource: FhirComplex, path: string): string[] {
  const out: string[] = [];
  walkForObservationRoots(resource, path, (items) => items.length < 2, out);
  return out;
}

/** A single `Observation.referenceRange` entry, surfaced (never used to compute an abnormal flag). */
export interface ObservationReferenceRange {
  /** `referenceRange.low`, the inclusive lower bound, when present. */
  readonly low: Quantity | undefined;
  /** `referenceRange.high`, the inclusive upper bound, when present. */
  readonly high: Quantity | undefined;
  /** `referenceRange.type` codings (e.g. `normal`, `treatment`), when present. */
  readonly type: readonly Coded[];
  /** `referenceRange.text`, a free-text range when the bounds are not machine-comparable. */
  readonly text: string | undefined;
}

/**
 * Surface every `Observation.referenceRange` entry, population-qualified bounds preserved as
 * {@link Quantity}s, not evaluated. A reference range is meaningful only alongside its qualifiers
 * (`appliesTo`, `age`), which are preserved in the model; this reader exposes the bounds and type.
 *
 * @param observation - An `Observation` complex node.
 * @returns The reference ranges in document order (`[]` when none).
 * @example
 * ```ts
 * import { parseResource, readReferenceRanges } from "@cosyte/fhir";
 * const { resource } = parseResource(
 *   '{"resourceType":"Observation","referenceRange":[{"low":{"value":70,"code":"mg/dL"}}]}',
 * );
 * readReferenceRanges(resource)[0]?.low?.code; // "mg/dL"
 * ```
 */
export function readReferenceRanges(observation: FhirComplex): ObservationReferenceRange[] {
  const node = getProperty(observation, "referenceRange");
  if (node === undefined) return [];
  const items = isList(node) ? node.items : [node];
  const ranges: ObservationReferenceRange[] = [];
  for (const item of items) {
    if (item.kind !== "complex") continue;
    ranges.push({
      low: readQuantity(getProperty(item, "low")),
      high: readQuantity(getProperty(item, "high")),
      type: codingsOf(getProperty(item, "type")),
      text: primitiveString(getProperty(item, "text")),
    });
  }
  return ranges;
}

/**
 * Surface the `Observation.interpretation` codings (the abnormal flags, H/L/HH/LL/A/N…). Preserved
 * and exposed; never derived from a value and a reference range (this layer does not compute).
 *
 * @param observation - An `Observation` complex node.
 * @returns The interpretation codings across every `interpretation` CodeableConcept (`[]` when none).
 * @example
 * ```ts
 * import { parseResource, readInterpretations } from "@cosyte/fhir";
 * const { resource } = parseResource(
 *   '{"resourceType":"Observation","interpretation":[{"coding":[{"code":"H"}]}]}',
 * );
 * readInterpretations(resource)[0]?.code; // "H"
 * ```
 */
export function readInterpretations(observation: FhirComplex): Coded[] {
  return codingsOf(getProperty(observation, "interpretation"));
}
