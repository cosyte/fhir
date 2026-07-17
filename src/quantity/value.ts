/**
 * The `Observation.value[x]` choice — typed by the **present** variant, never assumed (Phase 4).
 *
 * `Observation.value[x]` is an **11-way choice** (`valueQuantity`, `valueCodeableConcept`,
 * `valueString`, `valueBoolean`, `valueInteger`, `valueRange`, `valueRatio`, `valueSampledData`,
 * `valueTime`, `valueDateTime`, `valuePeriod`). A consumer that assumes `valueQuantity` and reads a
 * `valueString` of `"POSITIVE"` or a titer `valueRatio` of `1:64` as a number produces a wrong
 * clinical value (roadmap §4.6). {@link readObservationValue} branches on the variant that is actually
 * present and reports it, so a caller must handle the type it got rather than the one it expected. The
 * same reader works on a `component` (its `value[x]` is the identical choice, minus the SampledData
 * caveat), so a blood-pressure panel's systolic/diastolic components discriminate too.
 *
 * `interpretation` (the H/L/HH abnormal flags) and `referenceRange` (population-qualified) are
 * surfaced here too — Phase 4 preserves and exposes them; it never *computes* an abnormal flag from a
 * value and a range (roadmap §4.6 known limitations).
 *
 * @packageDocumentation
 */

import { getProperty, isList, type FhirComplex, type FhirNode } from "../model/index.js";
import { codingsOf, primitiveString, type Coded } from "../safety/codes.js";
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
 * present — a `value[x]` is a `0..1` choice, so a non-empty `ambiguous` is a structural defect (the
 * kind the structural validator reports as `CHOICE_AMBIGUOUS` once Observation is a modeled schema,
 * Phase 6). This reader surfaces it here regardless, so the extra variant is never silently dropped.
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
 * v?.type;     // "String" — NOT a Quantity; reading it as a number would be wrong
 * v?.quantity; // undefined
 * ```
 */
export function readObservationValue(node: FhirComplex): ObservationValue | undefined {
  const [first, ...rest] = presentValues(node);
  if (first === undefined) return undefined;
  return {
    type: first.type,
    property: `value${first.type}`,
    node: first.node,
    quantity: first.type === "Quantity" ? readQuantity(first.node) : undefined,
    ambiguous: rest.map((r) => r.type),
  };
}

/** A single `Observation.referenceRange` entry, surfaced (never used to compute an abnormal flag). */
export interface ObservationReferenceRange {
  /** `referenceRange.low` — the inclusive lower bound, when present. */
  readonly low: Quantity | undefined;
  /** `referenceRange.high` — the inclusive upper bound, when present. */
  readonly high: Quantity | undefined;
  /** `referenceRange.type` codings (e.g. `normal`, `treatment`), when present. */
  readonly type: readonly Coded[];
  /** `referenceRange.text` — a free-text range when the bounds are not machine-comparable. */
  readonly text: string | undefined;
}

/**
 * Surface every `Observation.referenceRange` entry — population-qualified bounds preserved as
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
 * Surface the `Observation.interpretation` codings (the abnormal flags — H/L/HH/LL/A/N…). Preserved
 * and exposed; never derived from a value and a reference range (Phase 4 does not compute).
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
