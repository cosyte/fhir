/**
 * What a validation left unchecked: the claims a resource makes that nothing here checks it against,
 * reported as findings, and the one bit a caller reads to know whether `valid` is a verdict over
 * every rule that applies, {@link ./validate.js ValidationResult.fullyChecked}.
 *
 * Two claims are reported, each at `information` and value-free:
 *
 * - `EXTENSION_UNCHECKED` at each `extension`, at any depth (a primitive's own extensions, a
 *   contained resource's and a Bundle entry's included): its `url` names a definition, and this
 *   library applies no extension definition, supplied or not. A nested extension is part of the
 *   definition of the extension holding it, so only the outermost one is reported. A
 *   `modifierExtension` is not reported here: the safety layer already refuses it as
 *   `UNHANDLED_MODIFIER_EXTENSION`, an `error`.
 * - `PROFILE_UNCHECKED` at each `meta.profile` claim of the resource validated that no supplied
 *   profile of its type carries at that canonical URL (a version after `|` aside, which
 *   `PROFILE_VERSION_MISMATCH` reports).
 *
 * @packageDocumentation
 */

import { getProperty, isComplex, isList, isPrimitive, type FhirComplex } from "../model/index.js";
import type { FhirNode, FhirProperty } from "../model/index.js";
import { Trail } from "../model/path.js";
import { primitiveString } from "../safety/codes.js";
import type { StructureDefinition } from "../profiles/structure-definition.js";
import {
  ISSUE_SEVERITIES,
  validationIssue,
  type ValidationCode,
  type ValidationIssue,
} from "./issues.js";

/**
 * The eight resource types whose structure, own constraints and datatype constraints are evaluated
 * at every depth: the types both the base-constraint layer and the element model cover.
 */
function fullyCheckableTypes(): ReadonlySet<string> {
  return new Set([
    "AllergyIntolerance",
    "Condition",
    "DiagnosticReport",
    "Immunization",
    "MedicationRequest",
    "MedicationStatement",
    "Observation",
    "Patient",
  ]);
}

/**
 * For each validation code, whether a finding of it says a rule was left unchecked or content was
 * left unread, so the result cannot read `fullyChecked: true`. Every code is classified here, so a
 * new code cannot be added without deciding this.
 *
 * @internal
 */
export const LEAVES_UNCHECKED = (): Readonly<Record<ValidationCode, boolean>> => ({
  UNKNOWN_ELEMENT: true,
  RESOURCE_TYPE_UNKNOWN: true,
  RESOURCE_NOT_MODELED: true,
  TYPE_MISMATCH: false,
  CHOICE_AMBIGUOUS: false,
  CARDINALITY_MIN: false,
  CARDINALITY_MAX: false,
  PRIMITIVE_INVALID: false,
  CODE_INVALID: false,
  UNHANDLED_MODIFIER_EXTENSION: true,
  DUPLICATE_PROPERTY: true,
  ARRAY_WRAPPED_SCALAR: false,
  ARRAY_WRAPPED_CHOICE: true,
  NESTED_ARRAY: true,
  DROPPED_ELEMENT_TEXT: true,
  ABSENCE_MARKER_CONFLICT: false,
  ABSENCE_MARKER_UNREADABLE: true,
  RETRACTED_RESOURCE: false,
  INVARIANT_VIOLATED: false,
  INVARIANT_UNCHECKED: true,
  UCUM_UNIT_UNRECOGNIZED: false,
  VITAL_SIGN_UNIT_NONCONFORMANT: false,
  VALUE_TYPE_UNEXPECTED: false,
  CODE_SYSTEM_UNKNOWN: false,
  CODE_SYSTEM_UNEXPECTED: false,
  CODE_NOT_IN_VALUESET: false,
  PROFILE_SLICE_UNMATCHED: false,
  PROFILE_SLICE_UNCHECKED: true,
  PROFILE_SLICE_NO_SLICING: true,
  MUST_SUPPORT_ABSENT: false,
  PROFILE_VERSION_MISMATCH: true,
  PROFILE_FIXED_MISMATCH: false,
  PROFILE_PATTERN_MISMATCH: false,
  PROFILE_TYPE_MISMATCH: false,
  PROFILE_REFERENCE_TARGET_MISMATCH: false,
  PROFILE_MAX_LENGTH: false,
  PROFILE_MIN_VALUE: false,
  PROFILE_MAX_VALUE: false,
  PROFILE_CONSTRAINT_UNCHECKED: true,
  REFERENCE_UNRESOLVED: false,
  CONTAINED_CYCLE: false,
  FULLURL_ID_MISMATCH: false,
  CONTAINED_ID_DUPLICATE: true,
  FULLURL_DUPLICATE: false,
  NARRATIVE_UNREADABLE: true,
  NARRATIVE_ROOT_INVALID: false,
  NARRATIVE_ELEMENT_ILLEGAL: false,
  NARRATIVE_ATTRIBUTE_ILLEGAL: false,
  NARRATIVE_ACTIVE_CONTENT: false,
  NARRATIVE_BLOCK_IN_PARAGRAPH: false,
  NARRATIVE_EMPTY: false,
  EXTENSION_UNCHECKED: true,
  PROFILE_UNCHECKED: true,
});

/**
 * Whether a validation of `resource` checked every rule that applies: the resource is of one of the
 * {@link fullyCheckableTypes}, it carries no `contained` resource, and no finding is of a code that
 * {@link LEAVES_UNCHECKED}. A type the registry has no schema for draws `RESOURCE_NOT_MODELED`,
 * which is one of those codes.
 *
 * @param resource - The resource validated.
 * @param rt - Its `resourceType`.
 * @param issues - Every finding of the validation.
 * @returns The value of `fullyChecked`.
 * @internal
 */
export function fullyCheckedOver(
  resource: FhirComplex,
  rt: string,
  issues: readonly ValidationIssue[],
): boolean {
  if (!fullyCheckableTypes().has(rt)) return false;
  if (getProperty(resource, "contained") !== undefined) return false;
  const leaves = LEAVES_UNCHECKED();
  return !issues.some((issue) => leaves[issue.code]);
}

/** Report each outermost `extension` under `node`, at any depth. */
function collectExtensions(node: FhirNode, trail: Trail, out: ValidationIssue[]): void {
  if (isList(node)) {
    const items = node.items;
    for (let i = 0; i < items.length; i++) {
      trail.index(i);
      collectExtensions(items[i] as FhirNode, trail, out);
      trail.pop();
    }
    return;
  }
  if (isPrimitive(node)) {
    const extensions = node.extension;
    if (extensions === undefined) return;
    trail.child("extension");
    for (let i = 0; i < extensions.length; i++) {
      trail.index(i);
      reportExtension(extensions[i] as FhirNode, trail, out, true);
      trail.pop();
    }
    trail.pop();
    return;
  }
  const properties = node.properties;
  for (let i = 0; i < properties.length; i++) {
    const property = properties[i] as FhirProperty;
    trail.child(property.name);
    if (property.name === "extension") reportEach(property.value, trail, out, true);
    else if (property.name === "modifierExtension") reportEach(property.value, trail, out, false);
    else collectExtensions(property.value, trail, out);
    trail.pop();
  }
}

/** Report each extension a property holds, when `report`; a `modifierExtension` is not reported. */
function reportEach(value: FhirNode, trail: Trail, out: ValidationIssue[], report: boolean): void {
  if (!isList(value)) {
    reportExtension(value, trail, out, report);
    return;
  }
  const items = value.items;
  for (let i = 0; i < items.length; i++) {
    trail.index(i);
    reportEach(items[i] as FhirNode, trail, out, report);
    trail.pop();
  }
}

/**
 * Report one extension when `report`, then look inside everything it holds but its own nested
 * extensions, which its definition describes: a datatype in its value can carry extensions of its
 * own.
 */
function reportExtension(
  extension: FhirNode,
  trail: Trail,
  out: ValidationIssue[],
  report: boolean,
): void {
  if (report) {
    out.push(validationIssue("EXTENSION_UNCHECKED", ISSUE_SEVERITIES.INFORMATION, trail.text()));
  }
  if (!isComplex(extension)) return;
  const properties = extension.properties;
  for (let i = 0; i < properties.length; i++) {
    const property = properties[i] as FhirProperty;
    if (property.name === "extension") continue;
    trail.child(property.name);
    collectExtensions(property.value, trail, out);
    trail.pop();
  }
}

/** Report each `meta.profile` claim no supplied profile of type `rt` carries. */
function collectProfileClaims(
  resource: FhirComplex,
  rt: string,
  root: string,
  profiles: readonly StructureDefinition[] | undefined,
  out: ValidationIssue[],
): void {
  const meta = getProperty(resource, "meta");
  if (meta === undefined || !isComplex(meta)) return;
  const claims = getProperty(meta, "profile");
  if (claims === undefined) return;
  const supplied = new Set(profiles?.filter((p) => p.type === rt).map((p) => p.url));
  const items = isList(claims) ? claims.items : [claims];
  for (const [i, item] of items.entries()) {
    // A claim with no readable canonical is one the structure layer reports.
    const canonical = primitiveString(item);
    if (canonical === undefined) continue;
    const bar = canonical.indexOf("|");
    const url = bar === -1 ? canonical : canonical.slice(0, bar);
    if (supplied.has(url)) continue;
    out.push(
      validationIssue(
        "PROFILE_UNCHECKED",
        ISSUE_SEVERITIES.INFORMATION,
        `${root}.meta.profile[${String(i)}]`,
      ),
    );
  }
}

/**
 * The claims a resource makes that this validation does not check it against: every outermost
 * `extension`, at any depth, as `EXTENSION_UNCHECKED`, then every `meta.profile` claim no supplied
 * profile of its type carries, as `PROFILE_UNCHECKED`.
 *
 * @param resource - The resource model.
 * @param rt - Its `resourceType`.
 * @param root - The location of the resource root, already bounded.
 * @param profiles - The supplied profiles, or `undefined` when none were.
 * @returns The findings, value-free, in that order.
 * @internal
 */
export function collectUncheckedClaims(
  resource: FhirComplex,
  rt: string,
  root: string,
  profiles: readonly StructureDefinition[] | undefined,
): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  collectExtensions(resource, new Trail(root), out);
  collectProfileClaims(resource, rt, root, profiles, out);
  return out;
}
