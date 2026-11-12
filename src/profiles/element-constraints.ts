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
 *   `PROFILE_TYPE_MISMATCH`. A list of profiles, or of target profiles, is met by meeting any one
 *   of them, and two entries of one type code are alternatives the same way. A type's `profile` is
 *   reported `type-profile`, except the R4 `SimpleQuantity`, whose one rule (`sqty-1`, no
 *   `comparator`) is checked here: a value without a comparator meets it, and one with a comparator
 *   breaks the list only when `SimpleQuantity` is all it names.
 * - **Reference targets.** A `Reference` whose target's type no `targetProfile` allows is
 *   `PROFILE_REFERENCE_TARGET_MISMATCH`. The type is read from the target when it resolves in the
 *   closure (the resource's `contained` set and, for a Bundle, its entries), else from the
 *   reference's own `Type/id` form. A base R4 canonical names its type: `Resource` allows any,
 *   `DomainResource` any but `Binary`, `Bundle` and `Parameters`, and a logical or element name
 *   decides nothing. A supplied profile names the type it constrains, and a target of that type is
 *   reported `target-profile`, since conformance to that profile is not checked. A target whose type
 *   cannot be read is reported the same way.
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
    for (const entries of byCode(applies)) {
      const verdicts = entries.map((t) => typeVerdict(t, occurrence.node, context.environment));
      reportEither(verdicts, occurrence.path, issues, unchecked);
    }
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

/** What one entry of an element's type list finds over one occurrence. */
interface TypeVerdict {
  /** The rules the occurrence breaks under this entry: `sqty-1`, or a target the entry does not allow. */
  readonly broken: readonly ("sqty-1" | "target")[];
  /** What the entry asks that was not checked. */
  readonly open: readonly ProfileUncheckedConstraint[];
}

/**
 * The applicable entries grouped by type code, in the order first seen. Entries of one code are
 * alternatives, any one of which the occurrence may meet; entries of different codes are not, since
 * an occurrence is of one type.
 */
function byCode(applies: readonly ElementType[]): readonly (readonly ElementType[])[] {
  const groups = new Map<string, ElementType[]>();
  for (const t of applies) {
    const group = groups.get(t.code);
    if (group === undefined) groups.set(t.code, [t]);
    else group.push(t);
  }
  return [...groups.values()];
}

/** One entry's `profile` and `targetProfile` lists over one occurrence. */
function typeVerdict(
  t: ElementType,
  node: FhirNode,
  environment: Required<SliceEnvironment>,
): TypeVerdict {
  const broken: ("sqty-1" | "target")[] = [];
  const open: ProfileUncheckedConstraint[] = [];
  const profile = profileVerdict(t.profile ?? [], node);
  if (profile === "broken") broken.push("sqty-1");
  else if (profile === "open") open.push(PROFILE_UNCHECKED_CONSTRAINTS.TYPE_PROFILE);
  const target = targetsVerdict(t, node, environment);
  if (target === "broken") broken.push("target");
  else if (target === "open") open.push(PROFILE_UNCHECKED_CONSTRAINTS.TARGET_PROFILE);
  return { broken, open };
}

/**
 * Report alternative entries over one occurrence: nothing when it meets one of them in full; else
 * what was not checked when some entry is not broken outright; else what each entry breaks.
 */
function reportEither(
  verdicts: readonly TypeVerdict[],
  path: string,
  issues: ValidationIssue[],
  unchecked: Unchecked,
): void {
  if (verdicts.some((v) => v.broken.length === 0 && v.open.length === 0)) return;
  const unbroken = verdicts.filter((v) => v.broken.length === 0);
  const reported = unbroken.length > 0 ? unbroken : verdicts;
  const broken = new Set(reported.flatMap((v) => v.broken));
  if (broken.has("sqty-1")) {
    issues.push(validationIssue("INVARIANT_VIOLATED", ISSUE_SEVERITIES.ERROR, path, "sqty-1"));
  }
  if (broken.has("target")) {
    issues.push(validationIssue("PROFILE_REFERENCE_TARGET_MISMATCH", ISSUE_SEVERITIES.ERROR, path));
  }
  for (const v of reported) for (const kind of v.open) unchecked(kind, path);
}

/**
 * A type's `profile` list, which an occurrence meets by meeting any one of them. `SimpleQuantity`
 * asks one thing beyond `Quantity`, no `comparator` (`sqty-1`), so a value without one meets it and
 * so the list; a value with one breaks it, which breaks the list only when nothing else is listed.
 * Any other profile is not checked.
 */
function profileVerdict(
  canonicals: readonly string[],
  node: FhirNode,
): "broken" | "open" | undefined {
  if (canonicals.length === 0) return undefined;
  const simple = canonicals.filter((c) => canonicalUrl(c) === SIMPLE_QUANTITY).length;
  if (simple === 0) return "open";
  if (!isComplex(node) || getProperty(node, "comparator") === undefined) return undefined;
  return simple === canonicals.length ? "broken" : "open";
}

/**
 * A type's `targetProfile` list, which a target meets by meeting any one of them. `Resource` allows
 * any target; a `canonical`'s list is otherwise not checked, beyond `DomainResource`, which every
 * resource a canonical can name is.
 */
function targetsVerdict(
  t: ElementType,
  node: FhirNode,
  environment: Required<SliceEnvironment>,
): "broken" | "open" | undefined {
  const canonicals = t.targetProfile ?? [];
  if (canonicals.length === 0) return undefined;
  const bases = canonicals.map((c) => coreType(c));
  if (bases.includes("Resource")) return undefined;
  if (t.code !== "Reference") return bases.includes("DomainResource") ? undefined : "open";
  return targetVerdict(node, canonicals, environment);
}

/**
 * Whether a reference's target is of a type one of its `targetProfile`s allows: `undefined` when one
 * does, `broken` when each names a type or kind of resource the target is not, and `open` when the
 * target's type cannot be read, or a canonical names a kind of resource or a profile that may allow
 * it but whose rules are not checked here.
 */
function targetVerdict(
  node: FhirNode,
  canonicals: readonly string[],
  environment: Required<SliceEnvironment>,
): "broken" | "open" | undefined {
  const target = targetType(node, environment);
  if (target === undefined) return "open";
  let open = false;
  for (const canonical of canonicals) {
    const base = coreType(canonical);
    const admits =
      base === undefined ? profileAdmits(canonical, target, environment) : coreAdmits(base, target);
    if (admits === true) return undefined;
    if (admits === undefined) open = true;
  }
  return open ? "open" : "broken";
}

/**
 * Whether a supplied profile allows a target type: `false` when it constrains another type, else
 * `undefined`, since a target of its type may or may not conform to it, and a profile nobody
 * supplied names no type.
 */
function profileAdmits(
  canonical: string,
  target: string,
  environment: Required<SliceEnvironment>,
): false | undefined {
  const constrained = environment.profileType(canonical);
  return constrained === undefined || constrained === target ? undefined : false;
}

/**
 * Whether a base R4 type allows a target type. `DomainResource` is every resource but the three R4
 * defines on `Resource` alone; a logical or interface name (`MetadataResource`, R5's
 * `CanonicalResource`) or an element type names no list of resources here, so it is not decided.
 */
function coreAdmits(base: string, target: string): boolean | undefined {
  if (base === "DomainResource") return !["Binary", "Bundle", "Parameters"].includes(target);
  if (["MetadataResource", "CanonicalResource", "Element", "BackboneElement"].includes(base)) {
    return undefined;
  }
  return base === target;
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
  return type?.match(/^[A-Z][A-Za-z]*$/u)?.[0];
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
  // A `FhirDecimal` spells its own lexical text; a boolean, an absent value, and a complex or list
  // node, which holds no `value`, spell no number.
  return decimalFromLexical(String(Reflect.get(node, "value")));
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
