/**
 * Classify each projected US Core constraint against the bounded FHIRPath subset: `evaluated`, or
 * `declined` naming the first construct, in source order, that lies outside the subset.
 *
 * The classification is STATIC. The expression is parsed with the engine's own parser and every
 * construct in the tree is checked against the subset: the functions and operators the evaluator
 * dispatches on, the variables it binds, and, for a type test, whether the type name resolves in
 * the FHIR or the System model. `evaluated` therefore means no construct lies outside the subset.
 * It does not mean every instance decides the constraint: a type test is answered only where the
 * instance establishes the item's type, and is reported unchecked where it does not. The same holds
 * for a System type in a function form, `is(String)`, `as(String)` or `ofType(System.String)`
 * written as a chain of names: it resolves, so it classifies `evaluated`, but the engine answers it
 * over a complex node only and reports it unchecked over a primitive. No projected row spells one.
 *
 * Two subsets are described. HEAD is read off the evaluator itself (`SUBSET_FUNCTIONS`,
 * `SUBSET_OPERATORS`, `TYPE_ARGUMENT_FUNCTIONS`, `resolveTypeSpecifier`), so it cannot drift from
 * what the engine does. PIN is the engine before FHIR-type tests and `matches()` were added: the
 * fifteen functions its `applyFunction` switch dispatched on, the same thirteen operators, and type
 * tests on the four System primitives only (a `System.` prefix stripped, `ofType` the only
 * function taking a type). Every construct the classification is keyed on is value-free: it names
 * a function, an operator, a variable or a type from the profile's expression, never anything from
 * an instance.
 *
 * Imported by `scripts/uscore-constraints.ts` and by the suite. Never shipped: nothing under `src/`
 * imports this file, and the package's `files` field publishes `dist` only.
 *
 * @packageDocumentation
 */

import { readFileSync } from "node:fs";

import { parseFhirPath, type Expr } from "../src/fhirpath/index.js";
import {
  SUBSET_FUNCTIONS,
  SUBSET_OPERATORS,
  TYPE_ARGUMENT_FUNCTIONS,
} from "../src/fhirpath/evaluate.js";
import { resolveTypeSpecifier, typeSpecifierOf } from "../src/fhirpath/types.js";

/** One row of the committed projection, `test/__data__/uscore-constraints.json`. */
export interface ProjectedConstraint {
  readonly version: string;
  readonly profile: string;
  readonly type: string;
  readonly element: string;
  readonly path: string;
  readonly sliceName?: string;
  readonly key: string;
  readonly severity: string;
  readonly expression: string;
}

/** The committed projection. */
export interface UsCoreProjection {
  readonly note: string;
  readonly rule: string;
  readonly licence: string;
  readonly fhirVersion: string;
  readonly packages: Readonly<Record<string, { url: string; bytes: number; sha256: string }>>;
  readonly constraints: readonly ProjectedConstraint[];
}

/** Where the projection is committed. */
export const PROJECTION_PATH = new URL("../test/__data__/uscore-constraints.json", import.meta.url);

/** Where the classification expectation is committed. */
export const EXPECTATION_PATH = new URL(
  "../test/__data__/uscore-classification.json",
  import.meta.url,
);

/** Read the committed projection. */
export function loadProjection(): UsCoreProjection {
  return JSON.parse(readFileSync(PROJECTION_PATH, "utf8")) as UsCoreProjection;
}

/** What one engine's subset admits. */
export interface SubsetDescription {
  readonly functions: ReadonlySet<string>;
  readonly operators: ReadonlySet<string>;
  readonly typeArgumentFunctions: ReadonlySet<string>;
  /** The type specifier a type-argument function's argument spells, or `undefined` for none. */
  readonly typeArgument: (arg: Expr) => string | undefined;
  /** Whether a type specifier as written resolves to a type the engine tests for. */
  readonly resolvesType: (specifier: string) => boolean;
}

/** The engine in this tree, read off the evaluator's own dispatch sets. */
export const HEAD_SUBSET: SubsetDescription = {
  functions: SUBSET_FUNCTIONS,
  operators: SUBSET_OPERATORS,
  typeArgumentFunctions: TYPE_ARGUMENT_FUNCTIONS,
  typeArgument: typeSpecifierOf,
  resolvesType: (specifier) => resolveTypeSpecifier(specifier) !== undefined,
};

/**
 * The engine at the pin this change was written against (`src/fhirpath/evaluate.ts` at
 * `0d75c80`): the fifteen functions its `applyFunction` switch dispatched on, the thirteen
 * operators `evaluateBinary` dispatched on, and type tests on `Boolean`, `String`, `Integer` and
 * `Decimal` only, after stripping a leading `System.`. Its `ofType` read an unqualified name only.
 */
export const PIN_SUBSET: SubsetDescription = {
  functions: new Set([
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
  ]),
  operators: new Set([
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
  ]),
  typeArgumentFunctions: new Set(["ofType"]),
  typeArgument: (arg) => (arg.kind === "member" && arg.target === null ? arg.name : undefined),
  resolvesType: (specifier) =>
    ["Boolean", "String", "Integer", "Decimal"].includes(specifier.replace(/^System\./, "")),
};

/** The environment variables and special variables both engines bind. */
const ENVIRONMENT = new Set(["resource", "rootResource", "context"]);
const VARIABLES = new Set(["this"]);

/** A classification: evaluated, or declined at a named construct. */
export type Classification = "evaluated" | `declined: ${string}`;

/** The first construct outside `subset`, in source order, or `undefined` when there is none. */
function firstOutside(expr: Expr, subset: SubsetDescription): string | undefined {
  switch (expr.kind) {
    case "empty":
    case "bool":
    case "string":
    case "number":
      return undefined;
    case "envvar":
      return ENVIRONMENT.has(expr.name) ? undefined : `%${expr.name}`;
    case "variable":
      return VARIABLES.has(expr.name) ? undefined : `$${expr.name}`;
    case "member":
      return expr.target === null ? undefined : firstOutside(expr.target, subset);
    case "index":
      return firstOutside(expr.target, subset) ?? firstOutside(expr.index, subset);
    case "unary":
      return firstOutside(expr.operand, subset);
    case "binary":
      return (
        firstOutside(expr.left, subset) ??
        (subset.operators.has(expr.op) ? undefined : `operator ${expr.op}`) ??
        firstOutside(expr.right, subset)
      );
    case "typeop":
      return (
        firstOutside(expr.operand, subset) ??
        (subset.resolvesType(expr.type) ? undefined : `${expr.op} ${expr.type}`)
      );
    case "call": {
      const target = expr.target === null ? undefined : firstOutside(expr.target, subset);
      if (target !== undefined) return target;
      if (!subset.functions.has(expr.name)) return `${expr.name}()`;
      if (subset.typeArgumentFunctions.has(expr.name)) {
        const arg = expr.args[0];
        const named = arg === undefined ? undefined : subset.typeArgument(arg);
        return named !== undefined && subset.resolvesType(named)
          ? undefined
          : `${expr.name}(${named ?? "a non-identifier type argument"})`;
      }
      for (const arg of expr.args) {
        const inner = firstOutside(arg, subset);
        if (inner !== undefined) return inner;
      }
      return undefined;
    }
  }
}

/**
 * Classify one expression against one subset.
 *
 * @example
 * ```ts
 * classify("value.matches('^[0-9]{5}$')", HEAD_SUBSET); // "evaluated"
 * classify("value.matches('^[0-9]{5}$')", PIN_SUBSET); // "declined: matches()"
 * ```
 */
export function classify(expression: string, subset: SubsetDescription): Classification {
  let ast: Expr;
  try {
    ast = parseFhirPath(expression);
  } catch {
    return "declined: syntax";
  }
  const outside = firstOutside(ast, subset);
  return outside === undefined ? "evaluated" : `declined: ${outside}`;
}

/** One classified row, as the expectation records it. */
export interface ClassifiedRow {
  readonly version: string;
  readonly profile: string;
  readonly element: string;
  readonly key: string;
  readonly head: Classification;
  readonly pin: Classification;
}

/** Per-version totals. */
export interface VersionTotals {
  readonly rows: number;
  readonly evaluated: number;
  readonly pinEvaluated: number;
}

/** Classify every projected row under both subsets. */
export function classifyProjection(projection: UsCoreProjection): ClassifiedRow[] {
  return projection.constraints.map((row) => ({
    version: row.version,
    profile: row.profile,
    element: row.element,
    key: row.key,
    head: classify(row.expression, HEAD_SUBSET),
    pin: classify(row.expression, PIN_SUBSET),
  }));
}

/** Totals per version, in first-seen version order. */
export function totalsOf(rows: readonly ClassifiedRow[]): Map<string, VersionTotals> {
  const out = new Map<string, VersionTotals>();
  for (const row of rows) {
    const seen = out.get(row.version) ?? { rows: 0, evaluated: 0, pinEvaluated: 0 };
    out.set(row.version, {
      rows: seen.rows + 1,
      evaluated: seen.evaluated + (row.head === "evaluated" ? 1 : 0),
      pinEvaluated: seen.pinEvaluated + (row.pin === "evaluated" ? 1 : 0),
    });
  }
  return out;
}

/** The report `pnpm uscore:constraints` prints: one line per row, then per-version totals. */
export function reportLines(rows: readonly ClassifiedRow[]): string[] {
  const lines = rows.map((r) => `${r.version}  ${r.profile}  ${r.element}  ${r.key}  ${r.head}`);
  lines.push("totals");
  for (const [version, t] of totalsOf(rows)) {
    lines.push(
      `${version}: ${String(t.evaluated)} of ${String(t.rows)} evaluated, ` +
        `${String(t.rows - t.evaluated)} declined ` +
        `(the engine at the pin: ${String(t.pinEvaluated)} of ${String(t.rows)})`,
    );
  }
  return lines;
}

/** The committed expectation's shape. */
export interface ClassificationExpectation {
  readonly note: string;
  readonly totals: Readonly<Record<string, VersionTotals>>;
  readonly rows: readonly ClassifiedRow[];
}

/** Render the expectation for `rows`, exactly as it is committed. */
export function renderExpectation(rows: readonly ClassifiedRow[]): string {
  const expectation: ClassificationExpectation = {
    note:
      "Committed expectation: how the bounded FHIRPath subset classifies each row of " +
      "uscore-constraints.json, in this tree (head) and at the pin this change was written " +
      "against (pin). Re-derive with `pnpm uscore:constraints --write-expectation`; the suite " +
      "fails on any row that moves.",
    totals: Object.fromEntries(totalsOf(rows)),
    rows,
  };
  return `${JSON.stringify(expectation, null, 2)}\n`;
}
