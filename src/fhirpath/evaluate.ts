/**
 * The bounded FHIRPath evaluator (Phase 7, the invariant engine — ADR 0002).
 *
 * FHIRPath is **collection-oriented**: every expression evaluates to an ordered collection of items,
 * and every operation maps a collection to a collection. This evaluator walks an {@link ./parser.js Expr}
 * AST over the generic {@link ../model/node.js} tree, implementing the subset of FHIRPath the R4 /
 * US Core invariant set actually uses:
 *
 * - **navigation** (`a.b.c`, choice access `value` → `valueQuantity`), `$this`, `%resource` / `%context`;
 * - **existence / filtering** — `exists`, `empty`, `not`, `where`, `all`, `select`, `count`, `first`,
 *   `last`, `distinct`, `hasValue`, `children`, `extension`, `intersect`;
 * - **logic** — `and` / `or` / `xor` / `implies` with FHIRPath three-valued (empty-propagating) truth;
 * - **comparison / membership / union** — `=`, `!=`, `<`, `>`, `<=`, `>=`, `in`, `contains`, `|`;
 * - **type tests** on the System primitive types (`is` / `as` / `ofType` for `Boolean` / `String` /
 *   `Integer` / `Decimal`).
 *
 * Everything else — arithmetic, string functions, `descendants()`, `resolve()`, FHIR-type `is`/`as`
 * (a generic model carries no datatype name) — raises {@link ./errors.js UnsupportedFhirPathError}.
 * That is the whole safety contract (roadmap §6): the engine **never guesses**. `where`/`select`/`all`
 * evaluate their criteria *lazily per item*, so an unsupported sub-term inside a filter over an empty
 * collection (e.g. `contained.where(descendants()…)` on a resource with no `contained`) never fires —
 * exactly the common case that lets base constraints like `dom-3` pass without implementing their full
 * machinery.
 *
 * A constraint is **satisfied** iff {@link convertToBoolean} of the result is `true` — matching the
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
  type FhirComplex,
  type FhirNode,
  type PrimitiveValue,
} from "../model/node.js";
import { UnsupportedFhirPathError } from "./errors.js";
import type { Expr } from "./parser.js";

/** One item in a FHIRPath collection: a model node, or an engine-computed primitive. */
export type FpItem =
  | { readonly t: "node"; readonly node: FhirNode }
  | { readonly t: "bool"; readonly value: boolean }
  | { readonly t: "str"; readonly value: string }
  | { readonly t: "num"; readonly value: number };

/** A FHIRPath collection — the value every expression evaluates to. */
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
 * type** is equal when it has the *same set of named child properties* and each is recursively equal —
 * **order-independent by field name** (FHIR JSON does not make object key order significant, so a
 * `Coding` written `{code, system}` equals one written `{system, code}`). A **collection / repeating
 * element** is order-*dependent* (compared item-by-item in order). Getting the complex case wrong in
 * the positional direction would let `=` / `intersect` / `in` / `contains` silently miss a match and
 * pass a violated constraint — the one failure mode the invariant layer must never produce.
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
  // member — or a member on a non-primitive leaf — selects nothing.
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

/** The immediate child nodes of an item (used by `children()` — resourceType is type info, not a child). */
function childrenOf(item: FpItem): FpItem[] {
  if (item.t !== "node") return [];
  if (isComplex(item.node)) {
    return item.node.properties
      .filter((p) => p.name !== "resourceType")
      .flatMap((p) => wrap(p.value));
  }
  // A primitive's children are its extensions; a bare leaf has none.
  if (isPrimitive(item.node)) {
    return (item.node.extension ?? []).map((ext) => ({ t: "node", node: ext }));
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
 * convertToBoolean([]); // false — an empty result fails a constraint, never silently passes
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

/** Evaluate an ordering comparison (`<`, `>`, `<=`, `>=`) over two singleton collections. */
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
    cmp = as < bs ? -1 : as > bs ? 1 : 0;
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

/** Whether an item is of a given (System-primitive) type; FHIR complex types are not determinable. */
function itemIsType(item: FpItem, typeName: string): boolean {
  const normalized = typeName.replace(/^System\./, "").replace(/^FHIR\./, "");
  const actual = systemTypeOf(item);
  if (actual === undefined) {
    throw new UnsupportedFhirPathError(`type test '${typeName}' on a non-System value`);
  }
  // Integer is a sub-type of Decimal for the purpose of `is Decimal`.
  if (normalized === "Decimal" && actual === "Integer") return true;
  return actual === normalized;
}

/** Extract the type name from an `ofType(...)` / `as(...)` argument expression. */
function typeNameOf(arg: Expr): string {
  if (arg.kind === "member" && arg.target === null) return arg.name;
  throw new UnsupportedFhirPathError("expected a type name argument");
}

/** Keep the items of `focus` for which `criteria` coerces to `true` (evaluated per item). */
function filterWhere(focus: FpColl, criteria: Expr, ctx: EvalCtx): FpItem[] {
  return focus.filter((item) => convertToBoolean(evaluate(criteria, [item], ctx)));
}

/** Apply a built-in function to its input collection. */
function applyFunction(
  name: string,
  input: FpColl,
  args: readonly Expr[],
  callFocus: FpColl,
  ctx: EvalCtx,
): FpColl {
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
      return input.filter((item) => itemIsType(item, typeNameOf(req(args[0]))));
    default:
      throw new UnsupportedFhirPathError(`unsupported function '${name}()'`);
  }
}

/** `extension(url)` — the extensions (on the input) whose `url` equals the argument string. */
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
        if (operand.length !== 1) return [{ t: "bool", value: false }];
        return [{ t: "bool", value: itemIsType(operand[0] as FpItem, expr.type) }];
      }
      return operand.filter((item) => itemIsType(item, expr.type)); // `as`
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
