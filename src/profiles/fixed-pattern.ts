/**
 * `fixed[x]` and `pattern[x]` constraint comparison (Phase 6).
 *
 * A profile can pin an element's value two ways (elementdefinition.html):
 *
 * - **`fixed[x]`** is an **equality** constraint, the element SHALL equal the fixed value *exactly*,
 *   with no additional content. On a complex value that means the same properties, recursively fixed,
 *   and nothing more.
 * - **`pattern[x]`** is a **subset** constraint, the element SHALL contain *at least* the properties
 *   and values the pattern names, but may carry others. This is the far more common profiling tool
 *   (US Core uses `pattern` almost everywhere it constrains a value), precisely because it does not
 *   forbid the extra codings / extensions a real instance carries.
 *
 * Comparison is structural and **precision-exact**, a `decimal` is compared through
 * {@link ../model/decimal.js}, never a float, and it never echoes a value, so a mismatch reported by
 * the profile layer stays value-free. Primitive `id` / `extension` metadata on the constraint side is
 * ignored (a `fixed`/`pattern` constrains the value, not its primitive metadata).
 *
 * @packageDocumentation
 */

import { FhirDecimal } from "../model/decimal.js";
import {
  isComplex,
  isList,
  isPrimitive,
  type FhirNode,
  type PrimitiveValue,
} from "../model/index.js";

/** Whether two primitive scalar values are equal (a `decimal` compared precision-exactly). */
function primitiveEquals(a: PrimitiveValue | undefined, b: PrimitiveValue | undefined): boolean {
  if (a instanceof FhirDecimal && b instanceof FhirDecimal) return a.equals(b);
  // A decimal never equals a non-decimal scalar here (they arrive as distinct model shapes).
  if (a instanceof FhirDecimal || b instanceof FhirDecimal) return false;
  return a === b;
}

/**
 * Whether an instance node **exactly equals** a `fixed[x]` value.
 *
 * @param instance - The instance node (or `undefined` when the element is absent).
 * @param fixed - The profile's fixed value node.
 * @returns `true` when the instance equals the fixed value exactly (same content, nothing extra).
 * @example
 * ```ts
 * import { primitive } from "@cosyte/fhir";
 * import { matchesFixed } from "@cosyte/fhir";
 * matchesFixed(primitive("active"), primitive("active")); // true
 * matchesFixed(primitive("inactive"), primitive("active")); // false
 * ```
 */
export function matchesFixed(instance: FhirNode | undefined, fixed: FhirNode): boolean {
  if (instance === undefined) return false;

  if (isPrimitive(fixed)) {
    return isPrimitive(instance) && primitiveEquals(instance.value, fixed.value);
  }
  if (isList(fixed)) {
    if (!isList(instance) || instance.items.length !== fixed.items.length) return false;
    return fixed.items.every((f, i) => {
      const item = instance.items[i];
      return item !== undefined && matchesFixed(item, f);
    });
  }
  // fixed is complex: same set of value-bearing properties, each fixed-equal, and nothing extra.
  if (!isComplex(instance)) return false;
  const fixedNames = new Set(fixed.properties.map((p) => p.name));
  const instanceValueNames = instance.properties
    .filter((p) => !isMetadataOnly(p.value))
    .map((p) => p.name);
  if (instanceValueNames.some((n) => !fixedNames.has(n))) return false; // extra content → not exact.
  return fixed.properties.every((f) => {
    const found = instance.properties.find((p) => p.name === f.name)?.value;
    return matchesFixed(found, f.value);
  });
}

/**
 * Whether an instance node **matches** a `pattern[x]` value, contains at least the pattern's content.
 *
 * @param instance - The instance node (or `undefined` when the element is absent).
 * @param pattern - The profile's pattern value node.
 * @returns `true` when the instance contains every property/value the pattern names (extras allowed).
 * @example
 * ```ts
 * import { complex, list, primitive } from "@cosyte/fhir";
 * import { matchesPattern } from "@cosyte/fhir";
 * const instance = complex([
 *   { name: "coding", value: list([complex([
 *     { name: "system", value: primitive("http://terminology.hl7.org/CodeSystem/observation-category") },
 *     { name: "code", value: primitive("vital-signs") },
 *     { name: "display", value: primitive("Vital Signs") },
 *   ])]) },
 * ]);
 * const pattern = complex([
 *   { name: "coding", value: list([complex([{ name: "code", value: primitive("vital-signs") }])]) },
 * ]);
 * matchesPattern(instance, pattern); // true, the extra system/display are allowed
 * ```
 */
export function matchesPattern(instance: FhirNode | undefined, pattern: FhirNode): boolean {
  if (instance === undefined) return false;

  if (isPrimitive(pattern)) {
    return isPrimitive(instance) && primitiveEquals(instance.value, pattern.value);
  }
  if (isList(pattern)) {
    const instanceItems = isList(instance) ? instance.items : [instance];
    // Every pattern item must be matched by some instance item (order-independent subset).
    return pattern.items.every((p) => instanceItems.some((item) => matchesPattern(item, p)));
  }
  // pattern is complex: every named property must be present and match (instance may carry more).
  if (!isComplex(instance)) return false;
  return pattern.properties.every((p) => {
    const found = instance.properties.find((q) => q.name === p.name)?.value;
    return matchesPattern(found, p.value);
  });
}

/** Whether a primitive node carries only metadata (no value), ignored on the constraint side. */
function isMetadataOnly(node: FhirNode): boolean {
  return isPrimitive(node) && node.value === undefined;
}
