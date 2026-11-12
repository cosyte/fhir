/**
 * The per-element constraints of a profile beyond cardinality, `fixed[x]`, `pattern[x]` and slicing:
 * the types an element allows, the targets a reference may name, `maxLength`, `minValue[x]` and
 * `maxValue[x]`, and everything else an element states that no layer checks.
 *
 * Each constraint is either **checked** here, drawing an `error` when an occurrence breaks it, or
 * reported **not checked** (`PROFILE_CONSTRAINT_UNCHECKED`, `information`, with the kind of
 * constraint in `uncheckedConstraint`) wherever the element is present. A profile validation never
 * comes back clean over a constraint it did not look at.
 *
 * - **Type lists.** An occurrence of a `choice[x]` element whose type the profile does not list is
 *   `PROFILE_TYPE_MISMATCH`. A type's `profile` is reported `type-profile`, except the R4
 *   `SimpleQuantity`, whose one rule (`sqty-1`, no `comparator`) is checked here.
 * - **Reference targets.** A `Reference` whose target's type no `targetProfile` names is
 *   `PROFILE_REFERENCE_TARGET_MISMATCH`. The type is read from the target when it resolves in the
 *   closure (the resource's `contained` set and, for a Bundle, its entries), else from the
 *   reference's own `Type/id` form. A base R4 canonical names its type; a supplied profile names the
 *   type it constrains, and a target of that type is reported `target-profile`, since conformance to
 *   that profile is not checked. A target whose type cannot be read is reported the same way.
 * - **`maxLength`** counts UTF-16 code units, as the reference validator does, and is checked on a
 *   string value; any other value is reported `max-length`.
 * - **`minValue[x]` / `maxValue[x]`** of a number type are compared exactly, as decimals, with an
 *   occurrence of the same type; any other bound, or an occurrence of another type, is reported
 *   `value-range`.
 * - **Bindings** of `required` or `extensible` strength are reported `binding` unless the structure
 *   layer enumerates the very R4 value set for that element of the resource.
 * - An `ordered` slicing or `openAtEnd` rules over more than one occurrence (`slice-order`), a
 *   slice's own invariant the sliced element does not carry (`slice-invariant`), an invariant on an
 *   element present as a primitive (`primitive-invariant`), and anything the model does not read
 *   (`unread`) are reported too.
 *
 * Every finding is value-free: a code, a severity, a location and a fixed kind.
 *
 * @packageDocumentation
 * @internal
 */

import { compareDecimals, decimalFromLexical, type FhirDecimal } from "../model/decimal.js";
import {
  getProperty,
  isComplex,
  isPrimitive,
  parseReference,
  resourceType,
  type FhirNode,
} from "../model/index.js";
import { primitiveString } from "../safety/codes.js";
import {
  ISSUE_SEVERITIES,
  PROFILE_UNCHECKED_CONSTRAINTS,
  validationIssue,
  type ProfileUncheckedConstraint,
  type ValidationIssue,
} from "../validate/issues.js";
import type { ResourceSchema } from "../validate/schema.js";
import type { SliceEnvironment } from "./slicing.js";
import type {
  ElementBinding,
  ElementDefinition,
  ElementType,
  TypedValue,
} from "./structure-definition.js";

/** One in-scope occurrence of an element: the node, its choice suffix when a choice, its location. */
export interface ElementOccurrence {
  readonly node: FhirNode;
  readonly type: string | undefined;
  readonly path: string;
}

/** What checking an element's constraints needs beyond the element and its occurrences. */
export interface ElementCheckContext {
  /** The resource type the profile constrains. */
  readonly resourceType: string;
  /** Reference resolution over the closure and the type a supplied profile constrains. */
  readonly environment: Required<SliceEnvironment>;
  /** The schema the structure layer checked the resource with, when it ran. */
  readonly schema: ResourceSchema | undefined;
}

// Stryker disable all: module-level constants, evaluated once when the module loads, which the
// mutation runner does not reload per mutant; test/profile-element-constraints.test.ts pins each one
// by behaviour (a core tail, SimpleQuantity pinned and not, a binding pinned to 4.0.1 and not).
/** The base R4 definitions' canonical prefix: a capitalized tail there names a type. */
const CORE_DEFINITION = "http://hl7.org/fhir/StructureDefinition/";

/** The R4 profile on `Quantity` whose one rule, `sqty-1`, is checked here. */
const SIMPLE_QUANTITY = "http://hl7.org/fhir/StructureDefinition/SimpleQuantity";

/** The R4 version the schema's enumerated value sets are of. */
const R4_VERSION = "4.0.1";
// Stryker restore all

/**
 * Collect the findings for one element over its in-scope occurrences.
 *
 * @param el - The element.
 * @param occurrences - Its in-scope occurrences, each with its choice suffix and location.
 * @param at - The element's location, where a finding about the element as a whole is placed.
 * @param context - The resource type, closure and schema.
 * @param issues - Where the findings go.
 * @param sliced - The element `el` is a slice of, when it is a slice.
 * @internal
 */
export function collectElementConstraintIssues(
  el: ElementDefinition,
  occurrences: readonly ElementOccurrence[],
  at: string,
  context: ElementCheckContext,
  issues: ValidationIssue[],
  sliced?: ElementDefinition,
): void {
  if (occurrences.length === 0) return;
  const reported = new Set<string>();
  const unchecked = (kind: ProfileUncheckedConstraint, path: string): void => {
    const key = `${kind} ${path}`;
    if (reported.has(key)) return;
    reported.add(key);
    issues.push(
      validationIssue(
        "PROFILE_CONSTRAINT_UNCHECKED",
        ISSUE_SEVERITIES.INFORMATION,
        path,
        undefined,
        undefined,
        undefined,
        kind,
      ),
    );
  };

  if (el.binding !== undefined && !bindingChecked(el, el.binding, context)) {
    unchecked(PROFILE_UNCHECKED_CONSTRAINTS.BINDING, at);
  }
  if (el.unmodeled !== undefined) unchecked(PROFILE_UNCHECKED_CONSTRAINTS.UNREAD, at);
  const slicing = el.slicing;
  if (
    slicing !== undefined &&
    (slicing.ordered === true || slicing.rules === "openAtEnd") &&
    occurrences.length > 1
  ) {
    unchecked(PROFILE_UNCHECKED_CONSTRAINTS.SLICE_ORDER, at);
  }
  if (sliced !== undefined && hasOwnSliceInvariant(el, sliced)) {
    unchecked(PROFILE_UNCHECKED_CONSTRAINTS.SLICE_INVARIANT, at);
  }
  const invariants = (el.constraint ?? []).some((c) => c.key !== "ele-1");

  for (const occurrence of occurrences) {
    // The invariant layer anchors on complex occurrences only.
    if (invariants && isPrimitive(occurrence.node)) {
      unchecked(PROFILE_UNCHECKED_CONSTRAINTS.PRIMITIVE_INVARIANT, at);
    }
    const applies = typesFor(el, occurrence.type);
    if (applies === undefined) {
      issues.push(
        validationIssue("PROFILE_TYPE_MISMATCH", ISSUE_SEVERITIES.ERROR, occurrence.path),
      );
      continue;
    }
    checkTypeProfiles(applies, occurrence, issues, unchecked);
    checkTargets(applies, occurrence, context.environment, issues, unchecked);
    if (el.maxLength !== undefined) checkLength(el.maxLength, occurrence, issues, unchecked);
    // Stryker disable next-line OptionalChaining: `applies[0]` is read only when there is one entry
    const own = occurrence.type ?? (applies.length === 1 ? applies[0]?.code : undefined);
    if (el.minValue !== undefined)
      checkBound(el.minValue, "min", own, occurrence, issues, unchecked);
    if (el.maxValue !== undefined)
      checkBound(el.maxValue, "max", own, occurrence, issues, unchecked);
  }
}

/** Reports one unchecked kind at one location, once. */
type Unchecked = (kind: ProfileUncheckedConstraint, path: string) => void;

/**
 * The element's types that apply to an occurrence: those its choice suffix names, or every type of
 * an element that is not a choice. `undefined` when the occurrence is a choice variant the element's
 * type list does not name.
 */
function typesFor(
  el: ElementDefinition,
  suffix: string | undefined,
): readonly ElementType[] | undefined {
  const types = el.type ?? [];
  if (suffix === undefined || types.length === 0) return types;
  const named = types.filter((t) => t.code.charAt(0).toUpperCase() + t.code.slice(1) === suffix);
  return named.length === 0 ? undefined : named;
}

/** A type's `profile`: `SimpleQuantity` is checked, any other is reported. */
function checkTypeProfiles(
  applies: readonly ElementType[],
  occurrence: ElementOccurrence,
  issues: ValidationIssue[],
  unchecked: Unchecked,
): void {
  for (const t of applies) {
    for (const canonical of t.profile ?? []) {
      if (canonicalUrl(canonical) !== SIMPLE_QUANTITY) {
        unchecked(PROFILE_UNCHECKED_CONSTRAINTS.TYPE_PROFILE, occurrence.path);
      } else if (
        isComplex(occurrence.node) &&
        getProperty(occurrence.node, "comparator") !== undefined
      ) {
        issues.push(
          validationIssue("INVARIANT_VIOLATED", ISSUE_SEVERITIES.ERROR, occurrence.path, "sqty-1"),
        );
      }
    }
  }
}

/** The `targetProfile`s of the applicable `Reference` and `canonical` types. */
function checkTargets(
  applies: readonly ElementType[],
  occurrence: ElementOccurrence,
  environment: Required<SliceEnvironment>,
  issues: ValidationIssue[],
  unchecked: Unchecked,
): void {
  for (const t of applies) {
    const canonicals = t.targetProfile ?? [];
    // A target of any resource narrows nothing.
    if (canonicals.length === 0 || canonicals.some((c) => anyResource(c))) continue;
    if (t.code !== "Reference") {
      unchecked(PROFILE_UNCHECKED_CONSTRAINTS.TARGET_PROFILE, occurrence.path);
      continue;
    }
    const verdict = targetVerdict(occurrence.node, canonicals, environment);
    // `undefined`: a base R4 canonical names the target's type, so the constraint holds.
    if (verdict === "mismatch") {
      issues.push(
        validationIssue(
          "PROFILE_REFERENCE_TARGET_MISMATCH",
          ISSUE_SEVERITIES.ERROR,
          occurrence.path,
        ),
      );
    } else if (verdict === "unchecked") {
      unchecked(PROFILE_UNCHECKED_CONSTRAINTS.TARGET_PROFILE, occurrence.path);
    }
  }
}

/** Whether a canonical is the base `Resource` or `DomainResource`, which any target satisfies. */
function anyResource(canonical: string): boolean {
  const url = canonicalUrl(canonical);
  return url === `${CORE_DEFINITION}Resource` || url === `${CORE_DEFINITION}DomainResource`;
}

/**
 * Whether a reference's target is of a type its `targetProfile`s allow: `undefined` when a base R4
 * canonical names it, `mismatch` when every canonical names a known type and none is it, and
 * `unchecked` when its type cannot be read, a canonical's type is unknown, or only a constraining
 * profile names it.
 */
function targetVerdict(
  node: FhirNode,
  canonicals: readonly string[],
  environment: Required<SliceEnvironment>,
): "mismatch" | "unchecked" | undefined {
  const target = targetType(node, environment);
  if (target === undefined) return "unchecked";
  let open = false;
  for (const canonical of canonicals) {
    const base = coreType(canonical);
    if (base !== undefined) {
      if (base === target) return undefined;
      continue;
    }
    const constrained = environment.profileType(canonical);
    if (constrained === undefined || constrained === target) open = true;
  }
  return open ? "unchecked" : "mismatch";
}

/**
 * The type of the resource a `Reference` names: its target's `resourceType` when it resolves in the
 * closure, else the type its own `Type/id` form spells, else `undefined`.
 */
function targetType(node: FhirNode, environment: Required<SliceEnvironment>): string | undefined {
  if (!isComplex(node)) return undefined;
  const reference = primitiveString(getProperty(node, "reference"));
  if (reference === undefined) return undefined;
  const resolved = environment.resolve(reference);
  const type = resolved === undefined ? parseReference(reference).type : resourceType(resolved);
  return /^[A-Z][A-Za-z]*$/u.test(type ?? "") ? type : undefined;
}

/** The type a base R4 canonical names (its capitalized tail), or `undefined` for any other. */
function coreType(canonical: string): string | undefined {
  const url = canonicalUrl(canonical);
  if (!url.startsWith(CORE_DEFINITION)) return undefined;
  const tail = url.slice(CORE_DEFINITION.length);
  return /^[A-Z][A-Za-z]*$/u.test(tail) ? tail : undefined;
}

/** A canonical without its `|version`. */
function canonicalUrl(canonical: string): string {
  const bar = canonical.indexOf("|");
  return bar === -1 ? canonical : canonical.slice(0, bar);
}

/** `maxLength` over a string value, in UTF-16 code units; any other value is reported. */
function checkLength(
  maxLength: number,
  occurrence: ElementOccurrence,
  issues: ValidationIssue[],
  unchecked: Unchecked,
): void {
  const { node } = occurrence;
  if (isPrimitive(node) && node.value === undefined) return; // no value, nothing to measure.
  if (!isPrimitive(node) || typeof node.value !== "string") {
    unchecked(PROFILE_UNCHECKED_CONSTRAINTS.MAX_LENGTH, occurrence.path);
  } else if (node.value.length > maxLength) {
    issues.push(validationIssue("PROFILE_MAX_LENGTH", ISSUE_SEVERITIES.ERROR, occurrence.path));
  }
}

/** Whether a bound's type is a number type, compared exactly here. */
function numberType(type: string): boolean {
  return ["Integer", "Decimal", "PositiveInt", "UnsignedInt"].includes(type);
}

/**
 * A `minValue[x]` or `maxValue[x]` over one occurrence: a number bound against a number of the same
 * type, exactly; any other pairing is reported.
 */
function checkBound(
  bound: TypedValue,
  side: "min" | "max",
  own: string | undefined,
  occurrence: ElementOccurrence,
  issues: ValidationIssue[],
  unchecked: Unchecked,
): void {
  const { node } = occurrence;
  if (isPrimitive(node) && node.value === undefined) return; // no value, nothing to compare.
  const ownType = own === undefined ? undefined : own.charAt(0).toUpperCase() + own.slice(1);
  const limit = numberType(bound.type) ? decimalOf(bound.value) : undefined;
  const value = ownType === bound.type ? decimalOf(node) : undefined;
  const order =
    limit === undefined || value === undefined ? undefined : compareDecimals(value, limit);
  if (order === undefined) {
    unchecked(PROFILE_UNCHECKED_CONSTRAINTS.VALUE_RANGE, occurrence.path);
  } else if (side === "min" && order < 0) {
    issues.push(validationIssue("PROFILE_MIN_VALUE", ISSUE_SEVERITIES.ERROR, occurrence.path));
  } else if (side === "max" && order > 0) {
    issues.push(validationIssue("PROFILE_MAX_VALUE", ISSUE_SEVERITIES.ERROR, occurrence.path));
  }
}

/** The number a primitive holds, whichever reader built it, or `undefined`. */
function decimalOf(node: FhirNode): FhirDecimal | undefined {
  if (!isPrimitive(node)) return undefined;
  // A `FhirDecimal` spells its own lexical text; a boolean or an absent value spells no number.
  return decimalFromLexical(String(node.value));
}

/**
 * Whether a binding asks nothing a layer does not check: a `preferred` or `example` binding asks
 * nothing, and a `required` or `extensible` one to exactly the R4 value set the structure layer
 * enumerates for this element of the resource is checked there.
 */
function bindingChecked(
  el: ElementDefinition,
  binding: ElementBinding,
  context: ElementCheckContext,
): boolean {
  if (binding.strength === "preferred" || binding.strength === "example") return true;
  if (binding.strength !== "required" && binding.strength !== "extensible") return false;
  const name = el.path.slice(context.resourceType.length + 1);
  const enumerated = context.schema?.elements[name]?.binding?.valueSet;
  const valueSet = binding.valueSet;
  if (valueSet === undefined) return false;
  const bar = valueSet.indexOf("|");
  const url = bar === -1 ? valueSet : valueSet.slice(0, bar);
  const version = bar === -1 ? R4_VERSION : valueSet.slice(bar + 1);
  return url === enumerated && version === R4_VERSION;
}

/**
 * Whether a slice carries an invariant the element it slices does not: the invariant layer evaluates
 * the sliced element's invariants on every occurrence, and a slice's own on none.
 */
function hasOwnSliceInvariant(slice: ElementDefinition, sliced: ElementDefinition): boolean {
  const shared = sliced.constraint;
  return (slice.constraint ?? []).some(
    (c) => shared?.some((s) => s.key === c.key && s.expression === c.expression) !== true,
  );
}
