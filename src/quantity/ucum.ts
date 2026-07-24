/**
 * UCUM unit fidelity for FHIR `Quantity` (Phase 4, the results & doses safety spine).
 *
 * FHIR carries a measured value as a `Quantity`, a number plus a coded unit. The unit that a
 * machine may act on is the **`code`** (a UCUM expression under `system` = `http://unitsofmeasure.org`),
 * **not** the human-readable `unit` string: `code` is case-sensitive and bracket-literal (`mm[Hg]`,
 * `[lb_av]`, `Cel`), while `unit` is free text a display might localize. Reading the `unit` string
 * where the `code` was meant is a unit-confusion hazard (roadmap §4.6). This module surfaces the
 * `code`, checks its **shape** (not its membership, no UCUM content is bundled, roadmap §5), and
 * holds the FHIR **vital-signs required-unit table**. It **never converts** a unit, an unrecognized
 * unit is preserved verbatim and flagged, never inferred (roadmap §4.6 fail-safe).
 *
 * @packageDocumentation
 */

import type { FhirDecimal } from "../model/decimal.js";
import { getProperty, isPrimitive, type FhirComplex, type FhirNode } from "../model/index.js";
import { primitiveString } from "../safety/codes.js";

/** The UCUM `system` URI (`terminologies-systems.html`), the one system whose codes are UCUM. */
export const UCUM_SYSTEM = "http://unitsofmeasure.org";

/** The LOINC `system` URI, the coding system the vital-signs profile keys its required units on. */
export const LOINC_SYSTEM = "http://loinc.org";

/** The `Observation.category` code system that carries the `vital-signs` slice value. */
export const OBSERVATION_CATEGORY_SYSTEM =
  "http://terminology.hl7.org/CodeSystem/observation-category";

/** The `Observation.category` code that marks an observation as a vital sign (its profile trigger). */
export const VITAL_SIGNS_CATEGORY = "vital-signs";

/** The canonical URL of the FHIR R4 vital-signs `StructureDefinition` (an alternate profile trigger). */
export const VITAL_SIGNS_PROFILE = "http://hl7.org/fhir/StructureDefinition/vitalsigns";

/**
 * The FHIR R4 **vital-signs required-unit table** (`observation-vitalsigns.html`): each vital-sign
 * LOINC code and the exact UCUM **codes** its profile requires on `Observation.value[x]` (or the
 * relevant `component.value[x]`). The comparison is against the UCUM `code`, case-sensitive and
 * bracket-literal, never the `unit` display string. Panels (vital-signs panel `85353-1`, blood
 * pressure panel `85354-9`) carry no top-level value and so are not keyed here; their measured
 * components (e.g. systolic `8480-6`) are.
 *
 * This is a **closed, spec-defined** set of stable identifiers (like the Phase-3 status codes), not a
 * licensed terminology table. A LOINC code absent from this table is left unchecked (a clean degrade,
 * never a false error), and the table is the seam a later terminology phase widens.
 */
export const VITAL_SIGN_UNITS: ReadonlyMap<string, readonly string[]> = new Map<
  string,
  readonly string[]
>([
  ["29463-7", ["g", "kg", "[lb_av]"]], // Body weight
  ["8302-2", ["cm", "[in_i]"]], // Body height
  ["8306-3", ["cm", "[in_i]"]], // Body height (lying) / body length
  ["8287-5", ["cm", "[in_i]"]], // Head circumference (Occipital-frontal, by tape)
  ["9843-4", ["cm", "[in_i]"]], // Head circumference
  ["8310-5", ["Cel", "[degF]"]], // Body temperature
  ["8867-4", ["/min"]], // Heart rate
  ["9279-1", ["/min"]], // Respiratory rate
  ["8480-6", ["mm[Hg]"]], // Systolic blood pressure
  ["8462-4", ["mm[Hg]"]], // Diastolic blood pressure
  ["2708-6", ["%"]], // Oxygen saturation in Arterial blood
  ["59408-5", ["%"]], // Oxygen saturation (SpO2) by pulse oximetry
  ["39156-5", ["kg/m2"]], // Body mass index
]);

/**
 * The UCUM codes the vital-signs profile requires for a given LOINC code, or `undefined` when the
 * code is not a table-keyed vital sign (so no required-unit check applies).
 *
 * @param loincCode - A LOINC code (e.g. `"8480-6"`).
 * @returns The allowed UCUM codes, or `undefined` when unlisted.
 * @example
 * ```ts
 * import { requiredVitalSignUnits } from "@cosyte/fhir";
 * requiredVitalSignUnits("8480-6"); // ["mm[Hg]"]  (systolic blood pressure)
 * ```
 */
export function requiredVitalSignUnits(loincCode: string): readonly string[] | undefined {
  return VITAL_SIGN_UNITS.get(loincCode);
}

/**
 * The value-free reading of a FHIR `Quantity` element. `value` is a {@link FhirDecimal}, the exact
 * lexical number, never routed through a JS float (ADR 0001), and `code`/`system` are the
 * machine-actionable unit, kept distinct from the human `unit` string.
 */
export interface Quantity {
  /** `Quantity.value`, the exact decimal, or `undefined` when absent (e.g. a `comparator`-only bound). */
  readonly value: FhirDecimal | undefined;
  /** `Quantity.comparator` (`<` | `<=` | `>=` | `>`), a bound, not an exact value, when present. */
  readonly comparator: string | undefined;
  /** `Quantity.unit`, the human-readable display string. **Not** for machine comparison. */
  readonly unit: string | undefined;
  /** `Quantity.system`, the unit code system URI (UCUM for a coded quantity). */
  readonly system: string | undefined;
  /** `Quantity.code`, the machine-actionable coded unit (UCUM when `system` is {@link UCUM_SYSTEM}). */
  readonly code: string | undefined;
}

/** The scalar value of a primitive node when it is a {@link FhirDecimal}, else `undefined`. */
function decimalValue(node: FhirNode | undefined): FhirDecimal | undefined {
  if (node !== undefined && isPrimitive(node) && typeof node.value === "object") {
    return node.value;
  }
  return undefined;
}

/**
 * Read a FHIR `Quantity` (or a specialization: `Age`, `Distance`, `Duration`, `Count`,
 * `SimpleQuantity`) into a {@link Quantity}, surfacing the coded unit distinct from the display unit.
 * Returns `undefined` for a node that is not a complex element.
 *
 * @param node - A `Quantity` node, or `undefined`.
 * @returns The {@link Quantity}, or `undefined` when the node is not a complex element.
 * @example
 * ```ts
 * import { getProperty, parseResource, readQuantity } from "@cosyte/fhir";
 * const { resource } = parseResource(
 *   '{"resourceType":"Observation","valueQuantity":{"value":120,"unit":"mmHg","system":"http://unitsofmeasure.org","code":"mm[Hg]"}}',
 * );
 * const q = readQuantity(getProperty(resource, "valueQuantity"));
 * q?.code; // "mm[Hg]" , the machine unit, not the "mmHg" display string
 * ```
 */
export function readQuantity(node: FhirNode | undefined): Quantity | undefined {
  if (node === undefined || node.kind !== "complex") return undefined;
  const q: FhirComplex = node;
  return {
    value: decimalValue(getProperty(q, "value")),
    comparator: primitiveString(getProperty(q, "comparator")),
    unit: primitiveString(getProperty(q, "unit")),
    system: primitiveString(getProperty(q, "system")),
    code: primitiveString(getProperty(q, "code")),
  };
}

/** The verdict of a UCUM shape check: a well-formed UCUM expression, or a malformed one. */
export type UcumShapeVerdict = "ok" | "invalid";

/**
 * Whether a string is a **shape-valid** UCUM code. This checks structure only, it does **not**
 * assert the code names a real UCUM unit (that needs the UCUM content, which is not bundled, roadmap
 * §5). A code is `"invalid"` when it is empty, contains whitespace (UCUM codes never do), or has
 * unbalanced `[]` / `{}` / `()`. Curly-brace annotations (`{RBC}`) are stripped before the whitespace
 * and bracket checks, since their inner text is unconstrained. Everything else is `"ok"`, a
 * conservative pass, so a well-formed but exotic unit is never wrongly rejected. The only consumer of
 * this is a **warning** (`UCUM_UNIT_UNRECOGNIZED`), never an error, so an occasional lenient pass on a
 * weird annotation cannot flip validity.
 *
 * @param code - A candidate UCUM code (e.g. `"mm[Hg]"`, `"kg/m2"`, `"/min"`).
 * @returns `"ok"` when the shape is well-formed, `"invalid"` otherwise.
 * @example
 * ```ts
 * import { validateUcumShape } from "@cosyte/fhir";
 * validateUcumShape("mm[Hg]"); // "ok"
 * validateUcumShape("mm Hg");  // "invalid", UCUM has no spaces (the code is "mm[Hg]")
 * validateUcumShape("[lb_av"); // "invalid", unbalanced bracket
 * ```
 */
export function validateUcumShape(code: string): UcumShapeVerdict {
  if (code.length === 0) return "invalid";
  // Strip UCUM annotations `{…}`, their inner text is unconstrained, so it must not be checked.
  const skeleton = code.replace(/\{[^{}]*\}/g, "");
  // A leftover brace means an unbalanced/nested annotation.
  if (skeleton.includes("{") || skeleton.includes("}")) return "invalid";
  if (/\s/.test(skeleton)) return "invalid";
  const pairs: Readonly<Record<string, string>> = { "]": "[", ")": "(" };
  const stack: string[] = [];
  for (const ch of skeleton) {
    if (ch === "[" || ch === "(") stack.push(ch);
    else if (ch === "]" || ch === ")") {
      if (stack.pop() !== pairs[ch]) return "invalid";
    }
  }
  return stack.length === 0 ? "ok" : "invalid";
}
