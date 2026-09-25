/**
 * The bounded FHIRPath evaluator (the invariant engine).
 *
 * FHIRPath is **collection-oriented**: every expression evaluates to an ordered collection of items,
 * and every operation maps a collection to a collection. This evaluator walks an {@link ./parser.js Expr}
 * AST over the generic {@link ../model/node.js} tree, implementing the subset of FHIRPath the R4 /
 * US Core invariant set actually uses:
 *
 * - **navigation** (`a.b.c`, choice access `value` → `valueQuantity`), `$this`, `%resource` / `%context`;
 * - **existence / filtering**, `exists`, `empty`, `not`, `where`, `all`, `select`, `count`, `first`,
 *   `last`, `distinct`, `hasValue`, `children`, `extension`, `intersect`;
 * - **logic**, `and` / `or` / `xor` / `implies` with FHIRPath three-valued (empty-propagating) truth;
 * - **comparison / membership / union**, `=`, `!=`, `<`, `>`, `<=`, `>=`, `in`, `contains`, `|`;
 * - **type tests** (`is` / `as` / `ofType`) on the System primitive types `Boolean` / `String` /
 *   `Integer` / `Decimal`, and on a FHIR type wherever the instance itself establishes the item's
 *   type ({@link ./types.js}: a choice variant of the resource, the resource root, or the node's
 *   kind), in operator and function form;
 * - **`matches(regex)`** over a pattern in a portable subset ({@link ./matches.js}).
 *
 * A **type-qualified path head** (`Patient.name`) resolves only where the focus is a resource root
 * whose `resourceType` the qualifier names, which is the one place a generic model can check it; see
 * {@link resolveTypeQualifier}. Everything else, arithmetic, other string functions,
 * `descendants()`, `resolve()`, a FHIR-type test the instance does not establish the answer to, and
 * a type qualifier that cannot be checked, raises {@link ./errors.js UnsupportedFhirPathError}.
 * That is the whole safety contract: the engine **never guesses**. Refusing is not the only way not
 * to guess, and it is the expensive one, because a refusal makes a constraint *unchecked* and takes
 * a diagnostic away: an ordering comparison the generic model cannot decide (see {@link compare})
 * therefore yields the empty collection, FHIRPath's own spelling of "no determination", which
 * coerces exactly as `false` does and so leaves every finding where it was.
 * `where`/`select`/`all`
 * evaluate their criteria *lazily per item*, so an unsupported sub-term inside a filter over an empty
 * collection (e.g. `contained.where(descendants()…)` on a resource with no `contained`) never fires.
 * R4's own `dom-3` still does not parse here as written (it calls `as()` in function form and ends
 * in `trace()`), so the base-constraint layer ({@link ../validate/base-invariants.js}) decides it by
 * that same reading, an empty `contained` selection making the whole filter empty, and reports it
 * unchecked whenever something is contained.
 *
 * A constraint is **satisfied** iff {@link convertToBoolean} of the result is `true`, matching the
 * reference validator's coercion (empty → false, a single non-boolean item → true), so an unmet or
 * empty result is a violation, never a silent pass.
 *
 * @packageDocumentation
 */

import { FhirDecimal } from "../model/decimal.js";
import {
  getProperty,
  isComplex,
  isList,
  isPrimitive,
  resourceType,
  type FhirComplex,
  type FhirNode,
  type PrimitiveValue,
} from "../model/node.js";
import { UnsupportedFhirPathError } from "./errors.js";
import { compileMatchesPattern } from "./matches.js";
import type { Expr } from "./parser.js";
import { nodeIsOfType, resolveTypeSpecifier, typeSpecifierOf } from "./types.js";

/** One item in a FHIRPath collection: a model node, or an engine-computed primitive. */
export type FpItem =
  | { readonly t: "node"; readonly node: FhirNode }
  | { readonly t: "bool"; readonly value: boolean }
  | { readonly t: "str"; readonly value: string }
  | { readonly t: "num"; readonly value: number };

/** A FHIRPath collection, the value every expression evaluates to. */
export type FpColl = readonly FpItem[];

/** The ambient evaluation context: the root resource (`%resource`) and the original focus (`%context`). */
interface EvalCtx {
  readonly resource: FhirNode;
  readonly context: FpColl;
}

/** Wrap a node into collection items, flattening a list into its (recursively flattened) members. */
function wrap(node: FhirNode): FpItem[] {
  if (isList(node)) return node.items.flatMap(wrap);
  return [{ t: "node", node }];
}

/** Whether `item` is a model-primitive node carrying an actual value (used by `hasValue`). */
function isPrimitiveWithValue(item: FpItem): boolean {
  return item.t === "node" && isPrimitive(item.node) && item.node.value !== undefined;
}

/** The scalar a single item compares as: a computed primitive, or a model primitive's value. */
function scalarOf(item: FpItem): PrimitiveValue | number | undefined {
  if (item.t === "bool") return item.value;
  if (item.t === "str") return item.value;
  if (item.t === "num") return item.value;
  if (isPrimitive(item.node)) return item.node.value;
  return undefined;
}

/** Whether two primitive scalars are equal (`decimal` precision-exact, `number` vs `decimal` numeric). */
function scalarEquals(a: PrimitiveValue | number, b: PrimitiveValue | number): boolean {
  if (a instanceof FhirDecimal && b instanceof FhirDecimal) return a.equals(b);
  if (a instanceof FhirDecimal) return typeof b === "number" && Number(a.toString()) === b;
  if (b instanceof FhirDecimal) return typeof a === "number" && Number(b.toString()) === a;
  return a === b;
}

/**
 * FHIRPath structural equality of two model nodes. Per the FHIRPath spec (§ Equals): a **complex
 * type** is equal when it has the *same set of named child properties* and each is recursively equal,
 * **order-independent by field name** (FHIR JSON does not make object key order significant, so a
 * `Coding` written `{code, system}` equals one written `{system, code}`). A **collection / repeating
 * element** is order-*dependent* (compared item-by-item in order). Getting the complex case wrong in
 * the positional direction would let `=` / `intersect` / `in` / `contains` silently miss a match and
 * pass a violated constraint, the one failure mode the invariant layer must never produce.
 */
function nodesEqual(a: FhirNode, b: FhirNode): boolean {
  if (isPrimitive(a) && isPrimitive(b)) {
    const av = a.value;
    const bv = b.value;
    if (av === undefined || bv === undefined) return av === bv;
    return scalarEquals(av, bv);
  }
  if (isList(a) && isList(b)) {
    return (
      a.items.length === b.items.length &&
      a.items.every((x, i) => nodesEqual(x, b.items[i] as FhirNode))
    );
  }
  if (isComplex(a) && isComplex(b)) {
    // Same count + every named property of `a` matched by the same-named property of `b` (FHIR forbids
    // duplicate keys, so a bijection by name follows). Name-keyed, not index-keyed.
    if (a.properties.length !== b.properties.length) return false;
    return a.properties.every((p) => {
      const q = b.properties.find((x) => x.name === p.name);
      return q !== undefined && nodesEqual(p.value, q.value);
    });
  }
  return false;
}

/** Whether two collection items are FHIRPath-equal (scalars by value, nodes structurally). */
function itemsEqual(a: FpItem, b: FpItem): boolean {
  const sa = scalarOf(a);
  const sb = scalarOf(b);
  if (sa !== undefined && sb !== undefined) return scalarEquals(sa, sb);
  if (a.t === "node" && b.t === "node") return nodesEqual(a.node, b.node);
  return false;
}

/** Deduplicate a collection by {@link itemsEqual} (used by `distinct` and union `|`). */
function distinctItems(coll: FpColl): FpItem[] {
  const out: FpItem[] = [];
  for (const item of coll) {
    if (!out.some((seen) => itemsEqual(seen, item))) out.push(item);
  }
  return out;
}

/** Whether a property name is a `[x]` choice variant of `base` (`value` → `valueQuantity`). */
function isChoiceVariant(propertyName: string, base: string): boolean {
  if (!propertyName.startsWith(base) || propertyName.length === base.length) return false;
  const suffix = propertyName.charAt(base.length);
  return suffix >= "A" && suffix <= "Z";
}

/** Navigate one member `name` from a single node item; returns the selected items (lists flattened). */
function navigateItem(node: FhirNode, name: string): FpItem[] {
  if (isComplex(node)) {
    const exact = getProperty(node, name);
    if (exact !== undefined) return wrap(exact);
    // No literal property: try a `[x]` choice variant (`value` selects `valueQuantity`, …).
    return node.properties
      .filter((p) => isChoiceVariant(p.name, name))
      .flatMap((p) => wrap(p.value));
  }
  // A primitive's only navigable children are its `_`-sibling metadata (id + extensions). Any other
  // member, or a member on a non-primitive leaf, selects nothing.
  if (isPrimitive(node) && name === "extension") {
    return (node.extension ?? []).map((ext) => ({ t: "node", node: ext }));
  }
  if (isPrimitive(node) && name === "id" && node.id !== undefined) {
    return [{ t: "str", value: node.id }];
  }
  return [];
}

/** Navigate `name` from every node item in a collection (computed items have no members). */
function navigate(focus: FpColl, name: string): FpItem[] {
  return focus.flatMap((item) => (item.t === "node" ? navigateItem(item.node, name) : []));
}

/**
 * Whether a **head-of-path** name is FHIR's spelling of a *type*, not of an element.
 *
 * FHIRPath lets a path be written type-qualified, `Patient.name.given`, where the leading segment
 * names the type the path is rooted in rather than a member to navigate. FHIR's naming rules make
 * the two spellings disjoint: element names are lowerCamelCase (json.html), type names, resources
 * and datatypes alike, are UpperCamelCase. So an upper-case first letter at the head of a path is a
 * type qualifier and nothing else.
 *
 * Recognising it is not the same as resolving it: {@link resolveTypeQualifier} decides that, and
 * refuses wherever the match cannot be checked.
 *
 * Scoped to the head of a path on purpose. `ofType(Boolean)` and `x is System.String` never reach
 * here: a type-name argument is read off the AST by {@link typeNameOf} / the `typeop` node and is
 * never evaluated as a member.
 */
function isTypeQualifier(name: string): boolean {
  const first = name.charAt(0);
  return first >= "A" && first <= "Z";
}

/**
 * Resolve a **head-of-path** type qualifier ({@link isTypeQualifier}) against the focus, or refuse.
 *
 * A type qualifier is not a member: it asserts what the path is rooted in, and when the assertion
 * holds the path continues from the focus unchanged. This engine checks the assertion in the one
 * place its generic model can: a **resource root** carries `resourceType`, so `Patient.name` over a
 * focus whose {@link ../model/node.js resourceType} reads `Patient` resolves to that focus without
 * guessing and without widening the subset. Every other shape is refused, because the model carries
 * no datatype name for an element focus and an empty focus has nothing to check the qualifier
 * against at all.
 *
 * The two options this must never take, both of which the corpus caught:
 *
 * - **Navigating it as an ordinary member.** No resource has a property called `Patient`, so
 *   `Patient.name.exists()` answered `false` on a Patient that HAS a name: a wrong answer with no
 *   diagnostic, exactly what {@link ./errors.js UnsupportedFhirPathError} exists to prevent.
 * - **Refusing it unconditionally.** That is safe-looking and is not safe: an invariant written the
 *   type-qualified way (the spelling most published constraints use) becomes *unchecked*, so a
 *   resource that genuinely violates it stops being reported and `validateResource(...).valid`
 *   flips from `false` to `true`. `test/profile-invariant-type-qualified.test.ts` pins both
 *   directions of the matching case.
 *
 * **WHAT THE NARROW REFUSAL STILL COSTS, stated here because the code cannot say it and an earlier
 * revision of this comment claimed the opposite.** Where the qualifier does NOT match the focus this
 * still withdraws a finding: pre-change the head was navigated as an ordinary member and selected
 * nothing, so `Encounter.name.exists()` over a Patient answered `false` and the profile layer
 * reported `INVARIANT_VIOLATED` at *error* with `valid: false`; it now reports `INVARIANT_UNCHECKED`
 * at *information* with `valid: true`. That answer was correct, so this is a withdrawal and not a
 * correction. It ships because the previous engine reached it by accident rather than by deciding
 * it, and because a diagnostic a caller can see beats a silent `false`. The full set is tabled in
 * `documentation/fhirpath-coverage.md` and pinned in
 * `test/profile-invariant-withdrawn-findings.test.ts`.
 */
function resolveTypeQualifier(name: string, focus: FpColl): FpColl {
  const matchesFocus =
    focus.length > 0 &&
    focus.every(
      (item) => item.t === "node" && isComplex(item.node) && resourceType(item.node) === name,
    );
  if (matchesFocus) return focus;
  throw new UnsupportedFhirPathError(`type-qualified path head '${name}'`);
}

/**
 * The immediate child nodes of an item (used by `children()`, resourceType is type info, not a child).
 *
 * A primitive's children are its `Element` members, `id` and then `extension`, which are exactly
 * the two members {@link navigateItem} reaches on it; a bare leaf has none. Leaving the `id` out
 * made `ele-1` (`hasValue() or (children().count() > id.count())`) count the `id` on one side and
 * not the other, so a value-absent primitive carrying an `id` and an extension, which R4 allows,
 * was reported as violating it.
 */
function childrenOf(item: FpItem): FpItem[] {
  if (item.t !== "node") return [];
  if (isComplex(item.node)) {
    return item.node.properties
      .filter((p) => p.name !== "resourceType")
      .flatMap((p) => wrap(p.value));
  }
  if (isPrimitive(item.node)) {
    const id: FpItem[] = item.node.id === undefined ? [] : [{ t: "str", value: item.node.id }];
    const extensions: FpItem[] = (item.node.extension ?? []).map((ext) => ({
      t: "node",
      node: ext,
    }));
    return [...id, ...extensions];
  }
  return [];
}

/**
 * FHIRPath boolean coercion, matching the reference validator: an empty collection is `false`, a
 * single boolean is itself, any other single item is `true`, and a multi-item collection is `true`.
 *
 * @param coll - The collection to coerce.
 * @returns The boolean an invariant result (or a `where` criteria) is judged by.
 * @example
 * ```ts
 * import { convertToBoolean } from "@cosyte/fhir";
 * convertToBoolean([]); // false, an empty result fails a constraint, never silently passes
 * ```
 */
export function convertToBoolean(coll: FpColl): boolean {
  if (coll.length === 0) return false;
  if (coll.length === 1) {
    const item = coll[0] as FpItem;
    if (item.t === "bool") return item.value;
    if (item.t === "node" && isPrimitive(item.node) && typeof item.node.value === "boolean") {
      return item.node.value;
    }
    return true;
  }
  return true;
}

/** FHIRPath three-valued truth: `true` | `false` | `null` (empty / indeterminate). */
type Trit = boolean | null;

/** Coerce a collection to a three-valued truth for a logical operator (non-boolean → unsupported). */
function toTrit(coll: FpColl): Trit {
  if (coll.length === 0) return null;
  if (coll.length === 1) {
    const item = coll[0] as FpItem;
    if (item.t === "bool") return item.value;
    if (item.t === "node" && isPrimitive(item.node) && typeof item.node.value === "boolean") {
      return item.node.value;
    }
  }
  throw new UnsupportedFhirPathError("a logical operator requires boolean operands");
}

/** Render a three-valued truth back into a collection (`null` → empty). */
function fromTrit(value: Trit): FpColl {
  return value === null ? [] : [{ t: "bool", value }];
}

/** The numeric value of a comparable item, or `undefined` when it is not numeric. */
function numberOf(item: FpItem): number | undefined {
  if (item.t === "num") return item.value;
  if (item.t === "node" && isPrimitive(item.node) && item.node.value instanceof FhirDecimal) {
    return Number(item.node.value.toString());
  }
  return undefined;
}

/** The string value of a comparable item, or `undefined` when it is not a string. */
function stringOf(item: FpItem): string | undefined {
  if (item.t === "str") return item.value;
  if (item.t === "node" && isPrimitive(item.node) && typeof item.node.value === "string") {
    return item.node.value;
  }
  return undefined;
}

/**
 * A FHIR temporal value as the **range of instants** its lexical form denotes.
 *
 * A lexical form is not an instant, it is an interval: `2001-05-06` denotes the whole of that day and
 * `2001-05-06T10:00Z` the whole of that minute. Carrying the interval rather than the components is
 * what lets one function express both of FHIRPath's rules at once, the precision rule (two values
 * whose intervals overlap without being the same interval do not order) and the offset rule (two
 * values written in different timezone designators are the same instant when their intervals
 * coincide). `lo` is inclusive, `hi` exclusive, both in milliseconds, both already read at the
 * value's own offset. For `form: "time"` they are milliseconds since midnight, FHIR `time` carrying
 * no offset at all.
 *
 * **The one reading here, declared once for the whole engine rather than guessed per value.** A
 * `dateTime` written with no designator is read at the evaluation context's timezone, which FHIRPath
 * leaves to the engine; this engine's is UTC. That is the frame the pre-change lexical comparison
 * used implicitly on every value, so declaring it moves no answer that was being given.
 */
interface TemporalValue {
  readonly form: "date" | "time";
  readonly lo: number;
  readonly hi: number;
}

/** `YYYY[-MM[-DD]][THH[:MM[:SS[.fff]]]][Z|(+|-)HH:MM]`, the FHIR `date` / `dateTime` lexical form. */
const DATE_LEXICAL =
  /^(\d{4})(?:-(\d{2})(?:-(\d{2})(?:T(\d{2})(?::(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?(Z|[+-]\d{2}:\d{2})?)?)?)?$/;

/** `HH[:MM[:SS[.fff]]]`, the FHIR `time` lexical form (no timezone in FHIR `time`). */
const TIME_LEXICAL = /^(\d{2})(?::(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?$/;

/** Milliseconds east of UTC a designator names (`Z` and an absent designator alike are `0`). */
function zoneOffsetMillis(zone: string): number {
  if (zone === "" || zone === "Z") return 0;
  const sign = zone.charAt(0) === "-" ? -1 : 1;
  return sign * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4, 6))) * 60_000;
}

/**
 * UTC milliseconds for a year-first component tuple, missing components defaulting to their first
 * value. Out-of-range components carry (month `13` is January of the next year), which is what makes
 * {@link bumpLast} a one-liner.
 */
function utcMillis(parts: readonly number[]): number {
  const [year, month = 1, day = 1, hour = 0, minute = 0, second = 0] = parts;
  const at = new Date(0);
  // Not `Date.UTC`, which maps a two-digit year onto the 1900s and would order `0085` as `1985`.
  at.setUTCFullYear(year as number, month - 1, day);
  at.setUTCHours(hour, minute, second, 0);
  return at.getTime();
}

/** The same tuple with one added to its least significant component: the width of that precision. */
function bumpLast(parts: readonly number[]): number[] {
  const bumped = [...parts];
  bumped[bumped.length - 1] = (bumped[bumped.length - 1] as number) + 1;
  return bumped;
}

/**
 * Read a FHIR temporal lexical form as the interval it denotes, or `undefined` when the text is not
 * one.
 *
 * This is a **lexical** reading, not a semantic one: it says how the text is written, which is all a
 * generic model carries. The written precision becomes the interval's width, so `2001-05-06` is a
 * day wide and `2001-05-06T10:10:10Z` one second, and a fractional second narrows it further
 * (`.5` → 100ms of width, `.500` → 1ms).
 */
function readTemporal(text: string): TemporalValue | undefined {
  const date = DATE_LEXICAL.exec(text);
  if (date !== null) {
    const parts: number[] = [];
    for (const part of [date[1], date[2], date[3], date[4], date[5], date[6]]) {
      if (part === undefined) break;
      parts.push(Number(part));
    }
    const offset = zoneOffsetMillis(date[8] ?? "");
    const start = utcMillis(parts) - offset;
    const fraction = date[7];
    if (fraction === undefined) {
      return { form: "date", lo: start, hi: utcMillis(bumpLast(parts)) - offset };
    }
    const lo = start + Number(`0.${fraction}`) * 1000;
    return { form: "date", lo, hi: lo + 10 ** (3 - fraction.length) };
  }
  const time = TIME_LEXICAL.exec(text);
  if (time === null) return undefined;
  const units = [3_600_000, 60_000, 1000];
  let lo = 0;
  let width = 0;
  for (const [i, part] of [time[1], time[2], time[3]].entries()) {
    if (part === undefined) break;
    lo += Number(part) * (units[i] as number);
    width = units[i] as number;
  }
  const fraction = time[4];
  if (fraction === undefined) return { form: "time", lo, hi: lo + width };
  const withFraction = lo + Number(`0.${fraction}`) * 1000;
  return { form: "time", lo: withFraction, hi: withFraction + 10 ** (3 - fraction.length) };
}

/**
 * Order two temporal values the way FHIRPath does, or say the comparison cannot be made.
 *
 * Two values order when the interval one denotes lies wholly outside the other's, and are equal when
 * the two intervals coincide, which is FHIRPath's precision rule stated once: `2001-05-06` and
 * `2001-05-06T10:10:10Z` overlap without coinciding, so whether the day is before or after an
 * instant inside it is *indeterminate* and the expression's value is the empty collection rather
 * than a boolean. Two designators for the same instant (`10:00:00Z`, `12:00:00+02:00`) coincide, and
 * so compare **equal**, which is the correction this engine owes a caller: refusing them instead
 * withdrew the `per-1` violation the validator reported for a period whose start really is after its
 * end, and that direction is the one the fail-safe contract forbids.
 *
 * @returns `-1` / `0` / `1` when they order, or `"undetermined"` when FHIRPath says `{}`: two
 *   overlapping precisions, and a date against a time of day, which is not a comparison FHIRPath
 *   defines over values whose types this model does not carry.
 */
function compareTemporal(a: TemporalValue, b: TemporalValue): -1 | 0 | 1 | "undetermined" {
  if (a.form !== b.form) return "undetermined";
  if (a.hi <= b.lo) return -1;
  if (b.hi <= a.lo) return 1;
  if (a.lo === b.lo && a.hi === b.hi) return 0;
  return "undetermined";
}

/**
 * Evaluate an ordering comparison (`<`, `>`, `<=`, `>=`) over two singleton collections.
 *
 * Numbers order as numbers, and two values the **engine itself computed** as strings order as
 * System Strings. A **model** primitive is the case that needs care: the model is generic, so a
 * string-valued primitive is the FHIR *lexical form* of an element whose type the model does not
 * carry, and it may be a `string`, a `code`, a `date`, a `dateTime`, a `time`, or (read from XML,
 * which is untyped) a `decimal`. Ordering it lexically answers a question the engine has not asked:
 * the shared corpus caught both directions of that, `Observation.value.value < 'test'` (a decimal
 * against a string, which FHIRPath makes an execution error) answered `true`, and `per-1`'s
 * `start <= end` over a day-precision date and a second-precision dateTime answered `true` where
 * FHIRPath says `{}`.
 *
 * So where either side is a model primitive, {@link compareTemporal} answers whenever both read as
 * temporal lexical forms of the same family, with FHIRPath's own precision and offset rules; every
 * other pair is **undetermined** and the expression's value is the empty collection.
 *
 * **`{}`, never a refusal, and that distinction is the whole point.** An
 * {@link ./errors.js UnsupportedFhirPathError} here reaches
 * {@link ../fhirpath/index.js evaluateInvariant} as `unchecked`, so the profile layer downgrades a
 * constraint it used to report to `INVARIANT_UNCHECKED` at *information* with
 * `validateResource(...).valid` flipping to `true`: a diagnostic withdrawn and re-severitied, which
 * is the one direction this package's fail-safe contract forbids. `{}` coerces through
 * {@link convertToBoolean} exactly as `false` did, so a constraint whose ordering the engine cannot
 * determine stays **reported**, at the same code, the same severity and the same location as before.
 * What the empty collection can do, and a lexical guess could not, is *add*: an ordering that used
 * to come back `true` on a guess now leaves its constraint unsatisfied, which surfaces the
 * undetermined comparison instead of hiding it behind an answer.
 * `test/profile-invariant-ordering.test.ts` pins both halves.
 */
function compare(op: string, left: FpColl, right: FpColl): FpColl {
  if (left.length === 0 || right.length === 0) return [];
  if (left.length !== 1 || right.length !== 1) {
    throw new UnsupportedFhirPathError("comparison requires singleton operands");
  }
  const a = left[0] as FpItem;
  const b = right[0] as FpItem;
  const an = numberOf(a);
  const bn = numberOf(b);
  let cmp: number;
  if (an !== undefined && bn !== undefined) {
    cmp = an < bn ? -1 : an > bn ? 1 : 0;
  } else {
    const as = stringOf(a);
    const bs = stringOf(b);
    if (as === undefined || bs === undefined) {
      throw new UnsupportedFhirPathError("comparison of non-orderable values");
    }
    if (a.t === "str" && b.t === "str") {
      cmp = as < bs ? -1 : as > bs ? 1 : 0;
    } else {
      const at = readTemporal(as);
      const bt = readTemporal(bs);
      // Two temporal lexical forms of the same family are the one pair a generic model can order.
      // Everything else, a value whose type the model does not carry against anything at all, is
      // undetermined rather than unsupported, and FHIRPath spells an undetermined ordering `{}`.
      if (at === undefined || bt === undefined) return [];
      const ordered = compareTemporal(at, bt);
      if (ordered === "undetermined") return [];
      cmp = ordered;
    }
  }
  const result = op === "<" ? cmp < 0 : op === ">" ? cmp > 0 : op === "<=" ? cmp <= 0 : cmp >= 0;
  return [{ t: "bool", value: result }];
}

/** Evaluate FHIRPath equality (`=`): empty if either side empty, else element-wise. */
function equals(left: FpColl, right: FpColl): FpColl {
  if (left.length === 0 || right.length === 0) return [];
  if (left.length !== right.length) return [{ t: "bool", value: false }];
  const equal = left.every((item, i) => itemsEqual(item, right[i] as FpItem));
  return [{ t: "bool", value: equal }];
}

/** The normalised System type name of an item, or `undefined` when the model cannot determine it. */
function systemTypeOf(item: FpItem): string | undefined {
  if (item.t === "bool") return "Boolean";
  if (item.t === "str") return "String";
  if (item.t === "num") return Number.isInteger(item.value) ? "Integer" : "Decimal";
  if (isPrimitive(item.node)) {
    const value = item.node.value;
    if (typeof value === "boolean") return "Boolean";
    if (typeof value === "string") return "String";
    if (value instanceof FhirDecimal) return "Decimal";
  }
  return undefined;
}

/**
 * The System primitive types this subset tests for off the item's own value, on anything but a
 * complex node. Every other type name is either a FHIR type, answered only where the instance
 * establishes the item's type ({@link ./types.js nodeIsOfType}), or refused.
 */
const SYSTEM_TYPE_NAMES: ReadonlySet<string> = new Set(["Boolean", "String", "Integer", "Decimal"]);

/**
 * Whether an item is of a given type, for the operator forms `is` / `as` and for `ofType()`.
 *
 * Two routes, and every other shape is refused:
 *
 * - **A System primitive** in {@link SYSTEM_TYPE_NAMES}, over a computed value or a model primitive,
 *   is read off the value's own System type. An item whose System type the model cannot determine
 *   (a value-absent primitive) is refused.
 * - **Anything else that resolves** (a FHIR type, or a System type over a complex node) is answered
 *   by {@link ./types.js nodeIsOfType} where the instance establishes the item's type, and refused
 *   where it does not. `Observation.issued is instant` and `Patient.gender.ofType(code)` ask for the
 *   FHIR type of an element that is not a choice variant, which this generic model does not carry,
 *   so both are still refused; answering `false` there would look like a determination and not be
 *   one. `gender is Quantity` over `gender: "male"` is answered `false`: a model primitive is never a
 *   complex FHIR type, whatever its FHIR type is.
 *
 * A type name that resolves in neither the FHIR nor the System model is refused, and so is a FHIR
 * type over a value the engine computed itself.
 */
function itemIsType(item: FpItem, typeName: string, ctx: EvalCtx): boolean {
  const resolved = resolveTypeSpecifier(typeName);
  const complexNode = item.t === "node" && isComplex(item.node);
  if (resolved?.model === "System" && SYSTEM_TYPE_NAMES.has(resolved.name) && !complexNode) {
    const actual = systemTypeOf(item);
    if (actual === undefined) {
      throw new UnsupportedFhirPathError(`type test '${typeName}' on a non-System value`);
    }
    // Integer is a sub-type of Decimal for the purpose of `is Decimal`.
    if (resolved.name === "Decimal" && actual === "Integer") return true;
    return actual === resolved.name;
  }
  return fhirTypeTest(item, typeName, resolved, ctx);
}

/** A type test answered by the instance ({@link ./types.js nodeIsOfType}), or refused. */
function fhirTypeTest(
  item: FpItem,
  typeName: string,
  resolved: ReturnType<typeof resolveTypeSpecifier>,
  ctx: EvalCtx,
): boolean {
  if (resolved === undefined) {
    throw new UnsupportedFhirPathError(`type test '${typeName}' names no known type`);
  }
  if (item.t !== "node") {
    throw new UnsupportedFhirPathError(`type test '${typeName}' on a computed value`);
  }
  return nodeIsOfType(item.node, resolved, ctx.resource);
}

/**
 * The function forms `is(type)` / `as(type)`, over the single item they accept.
 *
 * These answer a FHIR type, and a System type over a complex node, exactly as {@link itemIsType}
 * does. A System-type test over a computed value or a model primitive is **refused** in function
 * form: the engine has always refused both functions outright, and the value-based System reading
 * the operator form keeps (`1 is Decimal` answering `true`) is one the shared corpus grades wrong
 * through the function (`1.is(Decimal)` is `false` there), so it is not extended to a form that
 * never had it.
 *
 * The type argument is resolved before the input is looked at, so a name that resolves in neither
 * model is refused even over an empty input, as FHIRPath says an unresolvable type identifier is.
 *
 * @returns The input's one item when it is of the type, `undefined` when it is not, and `"empty"`
 *   when there is no input.
 */
function functionFormTypeTest(
  input: FpColl,
  arg: Expr | undefined,
  construct: string,
  ctx: EvalCtx,
): FpItem | undefined | "empty" {
  const typeName = typeNameOf(req(arg));
  const resolved = resolveTypeSpecifier(typeName);
  if (resolved === undefined) {
    throw new UnsupportedFhirPathError(`type test '${typeName}' names no known type`);
  }
  if (input.length === 0) return "empty";
  const item = singleItem(input, construct);
  if (resolved.model === "System" && !(item.t === "node" && isComplex(item.node))) {
    throw new UnsupportedFhirPathError(`function-form type test '${typeName}' on a primitive`);
  }
  return fhirTypeTest(item, typeName, resolved, ctx) ? item : undefined;
}

/**
 * Whether `ofType(type)` keeps one item: {@link itemIsType}, with the type specifier read qualified
 * or not.
 *
 * One shape is refused before that: a System type written **qualified** (`ofType(System.Boolean)`)
 * over a model primitive or a computed value. `ofType` has always answered the unqualified name
 * there off the item's own value, and keeps doing so, but it refused the qualified spelling outright,
 * and the corpus reads a FHIR primitive as not being of a System type through the function forms
 * (`Patient.active.is(System.Boolean).not()` is `true` there). So the value-based reading is not
 * extended to a spelling that never had it, exactly as {@link functionFormTypeTest} does not extend
 * it to `is()` / `as()`. Over a complex node the qualified System name is answered (R3), and a
 * qualified FHIR name is answered wherever the unqualified one is.
 *
 * "Qualified" is the argument's shape, a chain of two or more names, never a dot in the text: a
 * delimited identifier (`` `System.Boolean` ``) is one name whose text holds a dot, `ofType` has
 * always read it off the item's value, and it still does.
 */
function ofTypeKeeps(item: FpItem, arg: Expr, ctx: EvalCtx): boolean {
  const typeName = typeNameOf(arg);
  const qualified = arg.kind === "member" && arg.target !== null;
  const complexNode = item.t === "node" && isComplex(item.node);
  if (qualified && resolveTypeSpecifier(typeName)?.model === "System" && !complexNode) {
    throw new UnsupportedFhirPathError(`qualified type test '${typeName}' on a primitive`);
  }
  return itemIsType(item, typeName, ctx);
}

/** The single item a function-form type test or `matches()` accepts, or a refusal. */
function singleItem(input: FpColl, construct: string): FpItem {
  if (input.length !== 1) {
    throw new UnsupportedFhirPathError(`${construct} over more than one item`);
  }
  return input[0] as FpItem;
}

/**
 * `matches(regex)`: whether the single string input contains a match of the pattern.
 *
 * An empty input or an empty pattern yields the empty collection. More than one input item, a
 * pattern argument that is not one string, an input that is not a string, and a pattern outside
 * the portable subset ({@link ./matches.js}) are refused, never answered `false`. No refusal message
 * carries the input or the pattern.
 */
function applyMatches(
  input: FpColl,
  args: readonly Expr[],
  callFocus: FpColl,
  ctx: EvalCtx,
): FpColl {
  if (input.length === 0) return [];
  const patternColl = evaluate(req(args[0]), callFocus, ctx);
  if (patternColl.length === 0) return [];
  const value = stringOf(singleItem(input, "matches()"));
  if (value === undefined) throw new UnsupportedFhirPathError("matches() on a non-string value");
  const pattern = patternColl.length === 1 ? stringOf(patternColl[0] as FpItem) : undefined;
  if (pattern === undefined)
    throw new UnsupportedFhirPathError("matches() needs one string pattern");
  return [{ t: "bool", value: compileMatchesPattern(pattern).test(value) }];
}

/**
 * Extract the type specifier from an `ofType(...)` / `is(...)` / `as(...)` argument expression,
 * qualified (`FHIR.Quantity`) or not, exactly as the operator forms read it.
 */
function typeNameOf(arg: Expr): string {
  const specifier = typeSpecifierOf(arg);
  if (specifier === undefined) throw new UnsupportedFhirPathError("expected a type name argument");
  return specifier;
}

/** Keep the items of `focus` for which `criteria` coerces to `true` (evaluated per item). */
function filterWhere(focus: FpColl, criteria: Expr, ctx: EvalCtx): FpItem[] {
  return focus.filter((item) => convertToBoolean(evaluate(criteria, [item], ctx)));
}

/**
 * Every function this engine evaluates, and nothing else: {@link applyFunction} refuses any name
 * outside it before dispatching. Read the subset off this set, never off a count in prose.
 *
 * @example
 * ```ts
 * SUBSET_FUNCTIONS.has("matches"); // true
 * SUBSET_FUNCTIONS.has("resolve"); // false, refused as unsupported
 * ```
 */
export const SUBSET_FUNCTIONS: ReadonlySet<string> = new Set([
  "exists",
  "empty",
  "not",
  "where",
  "select",
  "all",
  "count",
  "first",
  "last",
  "distinct",
  "hasValue",
  "children",
  "extension",
  "intersect",
  "ofType",
  "is",
  "as",
  "matches",
]);

/**
 * The functions whose argument is a type specifier rather than an expression.
 *
 * @example
 * ```ts
 * TYPE_ARGUMENT_FUNCTIONS.has("ofType"); // true
 * ```
 */
export const TYPE_ARGUMENT_FUNCTIONS: ReadonlySet<string> = new Set(["ofType", "is", "as"]);

/**
 * Every binary operator this engine evaluates, and nothing else: {@link evaluateBinary} refuses any
 * operator outside it before dispatching.
 *
 * @example
 * ```ts
 * SUBSET_OPERATORS.has("implies"); // true
 * SUBSET_OPERATORS.has("mod"); // false, refused as unsupported
 * ```
 */
export const SUBSET_OPERATORS: ReadonlySet<string> = new Set([
  "and",
  "or",
  "xor",
  "implies",
  "=",
  "!=",
  "<",
  ">",
  "<=",
  ">=",
  "|",
  "in",
  "contains",
]);

/** Apply a built-in function to its input collection. */
function applyFunction(
  name: string,
  input: FpColl,
  args: readonly Expr[],
  callFocus: FpColl,
  ctx: EvalCtx,
): FpColl {
  if (!SUBSET_FUNCTIONS.has(name)) {
    throw new UnsupportedFhirPathError(`unsupported function '${name}()'`);
  }
  switch (name) {
    case "exists":
      return [
        {
          t: "bool",
          value: (args.length === 0 ? input : filterWhere(input, req(args[0]), ctx)).length > 0,
        },
      ];
    case "empty":
      return [{ t: "bool", value: input.length === 0 }];
    case "not":
      if (input.length === 0) return [];
      return fromTrit(negate(toTrit(input)));
    case "where":
      return filterWhere(input, req(args[0]), ctx);
    case "select":
      return input.flatMap((item) => evaluate(req(args[0]), [item], ctx));
    case "all":
      return [
        {
          t: "bool",
          value: input.every((item) => convertToBoolean(evaluate(req(args[0]), [item], ctx))),
        },
      ];
    case "count":
      return [{ t: "num", value: input.length }];
    case "first":
      return input.length > 0 ? [input[0] as FpItem] : [];
    case "last":
      return input.length > 0 ? [input[input.length - 1] as FpItem] : [];
    case "distinct":
      return distinctItems(input);
    case "hasValue":
      return [{ t: "bool", value: input.length === 1 && isPrimitiveWithValue(input[0] as FpItem) }];
    case "children":
      return input.flatMap(childrenOf);
    case "extension":
      return applyExtension(input, args, callFocus, ctx);
    case "intersect": {
      const other = evaluate(req(args[0]), callFocus, ctx);
      return distinctItems(input).filter((item) => other.some((o) => itemsEqual(item, o)));
    }
    case "ofType":
      // The type name is read per item, so an empty input stays `{}` whatever the name is.
      return input.filter((item) => ofTypeKeeps(item, req(args[0]), ctx));
    case "is": {
      const matched = functionFormTypeTest(input, args[0], "is()", ctx);
      return matched === "empty" ? [] : [{ t: "bool", value: matched !== undefined }];
    }
    case "as": {
      const matched = functionFormTypeTest(input, args[0], "as()", ctx);
      return matched === "empty" || matched === undefined ? [] : [matched];
    }
    case "matches":
      return applyMatches(input, args, callFocus, ctx);
    default:
      throw new UnsupportedFhirPathError(`unsupported function '${name}()'`);
  }
}

/** `extension(url)`, the extensions (on the input) whose `url` equals the argument string. */
function applyExtension(
  input: FpColl,
  args: readonly Expr[],
  callFocus: FpColl,
  ctx: EvalCtx,
): FpColl {
  const urlColl = evaluate(req(args[0]), callFocus, ctx);
  if (urlColl.length !== 1) throw new UnsupportedFhirPathError("extension(url) needs one url");
  const url = stringOf(urlColl[0] as FpItem);
  if (url === undefined) throw new UnsupportedFhirPathError("extension(url) needs a string url");
  return navigate(input, "extension").filter((item) => {
    const urlNodes = item.t === "node" ? navigateItem(item.node, "url") : [];
    return urlNodes.some((u) => stringOf(u) === url);
  });
}

/** Negate a three-valued truth (empty stays empty). */
function negate(value: Trit): Trit {
  return value === null ? null : !value;
}

/** Require an optional argument expression to be present (a bounded-arity function was mis-called). */
function req(arg: Expr | undefined): Expr {
  if (arg === undefined) throw new UnsupportedFhirPathError("missing function argument");
  return arg;
}

/** Evaluate a logical / comparison / membership / union binary operator. */
function evaluateBinary(
  op: string,
  node: Expr & { kind: "binary" },
  focus: FpColl,
  ctx: EvalCtx,
): FpColl {
  // Logical operators need three-valued evaluation of each side.
  if (!SUBSET_OPERATORS.has(op)) throw new UnsupportedFhirPathError(`unsupported operator '${op}'`);
  if (op === "and" || op === "or" || op === "xor" || op === "implies") {
    const a = toTrit(evaluate(node.left, focus, ctx));
    const b = toTrit(evaluate(node.right, focus, ctx));
    return fromTrit(logic(op, a, b));
  }
  const left = evaluate(node.left, focus, ctx);
  const right = evaluate(node.right, focus, ctx);
  switch (op) {
    case "=":
      return equals(left, right);
    case "!=": {
      const eq = equals(left, right);
      if (eq.length === 0) return [];
      const item = eq[0] as FpItem;
      return [{ t: "bool", value: !(item.t === "bool" ? item.value : true) }];
    }
    case "<":
    case ">":
    case "<=":
    case ">=":
      return compare(op, left, right);
    case "|":
      return distinctItems([...left, ...right]);
    case "in":
      return membership(left, right);
    case "contains":
      return membership(right, left);
    default:
      throw new UnsupportedFhirPathError(`unsupported operator '${op}'`);
  }
}

/** `needle in haystack`: empty if the needle is empty, else whether the singleton needle is a member. */
function membership(needle: FpColl, haystack: FpColl): FpColl {
  if (needle.length === 0) return [];
  if (needle.length !== 1)
    throw new UnsupportedFhirPathError("'in' requires a singleton left side");
  const item = needle[0] as FpItem;
  return [{ t: "bool", value: haystack.some((h) => itemsEqual(h, item)) }];
}

/** FHIRPath three-valued logic tables for `and` / `or` / `xor` / `implies`. */
function logic(op: string, a: Trit, b: Trit): Trit {
  switch (op) {
    case "and":
      if (a === false || b === false) return false;
      if (a === true && b === true) return true;
      return null;
    case "or":
      if (a === true || b === true) return true;
      if (a === false && b === false) return false;
      return null;
    case "xor":
      if (a === null || b === null) return null;
      return a !== b;
    default: // implies
      if (a === false) return true;
      if (a === null) return b === true ? true : null;
      return b; // a === true
  }
}

/**
 * Evaluate a FHIRPath expression against a focus collection.
 *
 * @param expr - The parsed expression.
 * @param focus - The current focus collection the expression navigates from (and that `$this` names).
 * @param ctx - The ambient context (`%resource`, `%context`).
 * @returns The result collection.
 * @throws UnsupportedFhirPathError on any construct outside the bounded subset.
 * @example
 * ```ts
 * import { convertToBoolean, evaluate, parseFhirPath } from "@cosyte/fhir";
 * const ast = parseFhirPath("status = 'final'");
 * // evaluate is low-level; callers usually reach it via evaluateInvariant.
 * void [ast, evaluate, convertToBoolean];
 * ```
 */
export function evaluate(expr: Expr, focus: FpColl, ctx: EvalCtx): FpColl {
  switch (expr.kind) {
    case "empty":
      return [];
    case "bool":
      return [{ t: "bool", value: expr.value }];
    case "string":
      return [{ t: "str", value: expr.value }];
    case "number":
      return [{ t: "num", value: expr.value }];
    case "envvar":
      if (expr.name === "resource" || expr.name === "rootResource") return wrap(ctx.resource);
      if (expr.name === "context") return ctx.context;
      throw new UnsupportedFhirPathError(`unsupported environment variable %${expr.name}`);
    case "variable":
      if (expr.name === "this") return focus;
      throw new UnsupportedFhirPathError(`unsupported variable $${expr.name}`);
    case "member":
      if (expr.target === null && isTypeQualifier(expr.name)) {
        return resolveTypeQualifier(expr.name, focus);
      }
      return navigate(expr.target === null ? focus : evaluate(expr.target, focus, ctx), expr.name);
    case "call": {
      const input = expr.target === null ? focus : evaluate(expr.target, focus, ctx);
      return applyFunction(expr.name, input, expr.args, focus, ctx);
    }
    case "index": {
      const target = evaluate(expr.target, focus, ctx);
      const indexColl = evaluate(expr.index, focus, ctx);
      const idx = indexColl.length === 1 ? numberOf(indexColl[0] as FpItem) : undefined;
      if (idx === undefined || !Number.isInteger(idx)) {
        throw new UnsupportedFhirPathError("indexer requires an integer");
      }
      return idx >= 0 && idx < target.length ? [target[idx] as FpItem] : [];
    }
    case "unary": {
      const operand = evaluate(expr.operand, focus, ctx);
      if (operand.length !== 1)
        throw new UnsupportedFhirPathError("unary operator on non-singleton");
      const n = numberOf(operand[0] as FpItem);
      if (n === undefined) throw new UnsupportedFhirPathError("unary operator on non-number");
      return [{ t: "num", value: expr.op === "-" ? -n : n }];
    }
    case "binary":
      return evaluateBinary(expr.op, expr, focus, ctx);
    case "typeop": {
      // `operand is/as Type`.
      const operand = evaluate(expr.operand, focus, ctx);
      if (expr.op === "is") {
        // `{} is T` is `{}`, not `false`: FHIRPath propagates the empty collection through a type
        // test rather than deciding one, and the shared corpus reads that collection directly
        // (`Observation.issued is instant` over a document with no `issued` expects `{}`; answering
        // `false` makes that case wrongly answered, measured).
        //
        // Taken ALONE the two coerce alike through convertToBoolean, so a constraint that IS the
        // type test keeps its verdict. They do not COMPOSE alike: `not()` over an empty input is
        // `[]` rather than `true`, and `{} implies false` is `{}` rather than `true`, so a
        // constraint wrapping the test in either can go from satisfied to violated. That is an
        // ADDED finding, never a withdrawn one, and `test/profile-invariant-ordering.test.ts` pins
        // both directions rather than leaving the blast radius asserted.
        if (operand.length === 0) return [];
        if (operand.length !== 1) return [{ t: "bool", value: false }];
        return [{ t: "bool", value: itemIsType(operand[0] as FpItem, expr.type, ctx) }];
      }
      return operand.filter((item) => itemIsType(item, expr.type, ctx)); // `as`
    }
  }
}

/**
 * Build the initial focus/context collection from a single focus node.
 *
 * @param node - The node an invariant is anchored to.
 * @returns A one-item collection wrapping it.
 * @example
 * ```ts
 * import { focusCollection, parseResource } from "@cosyte/fhir";
 * const { resource } = parseResource('{"resourceType":"Observation"}');
 * focusCollection(resource); // [{ t: "node", node: resource }]
 * ```
 */
export function focusCollection(node: FhirComplex): FpColl {
  return [{ t: "node", node }];
}
