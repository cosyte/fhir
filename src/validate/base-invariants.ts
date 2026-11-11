/**
 * The base-constraint layer: the error-severity constraints R4 4.0.1 declares on the eight modeled
 * resource types and on the `DomainResource`, `Element` and `Extension` definitions they inherit,
 * evaluated by {@link ./validate.js validateResource} whether or not a profile is supplied.
 *
 * R4 says an error-severity constraint that does not hold makes the resource non-conformant, and a
 * base constraint is part of the base type, not of a profile. So a caller validating a `Patient`
 * with no profile at all is told about a `contact` that carries none of `name`, `telecom`,
 * `address` or `organization` (`pat-1`), an extension that carries both a value and nested
 * extensions (`ext-1`), or an element with no value and no children (`ele-1`).
 *
 * The table below is transcribed from the R4 4.0.1 StructureDefinitions of the eight types
 * (AllergyIntolerance, Condition, DiagnosticReport, Immunization, MedicationRequest,
 * MedicationStatement, Observation, Patient) and of `DomainResource`, `Element` and `Extension`.
 * Every expression is copied verbatim and evaluated by the bounded FHIRPath engine
 * ({@link ../fhirpath/index.js}); no StructureDefinition document is bundled. Each outcome maps
 * exactly as the profile layer maps it:
 *
 * - a constraint that does not hold → `INVARIANT_VIOLATED` at `error`, carrying the key;
 * - an expression the engine cannot evaluate → `INVARIANT_UNCHECKED` at `information`, carrying the
 *   key, **never treated as satisfied**.
 *
 * **What is deliberately not here.** The seven keys the safety layer hand-evaluates (`ait-1`,
 * `ait-2`, `con-3`, `con-4`, `con-5`, `obs-6`, `obs-7`) stay with that layer, so each is reported
 * once. `dom-6` (a narrative SHOULD be present) is a `warning` that cannot move `valid` and would
 * draw a finding on nearly every narrative-less document, so it is not evaluated without a profile;
 * a supplied profile carrying it still evaluates it. A `contained` resource is checked only through
 * the four `dom-*` constraints its container declares about it: its own type's constraints and the
 * `ele-1` / `ext-1` of its elements are not evaluated.
 *
 * **`dom-3` is decided by its own semantics where that needs no reference resolution.** Its
 * expression selects `contained` first and filters it with `where`. With no `contained` entry that
 * selection is empty, `where` over an empty collection is empty, `trace` returns its input and
 * `empty()` is `true`, so the constraint holds and nothing is reported. With at least one entry the
 * filter needs `descendants()`, FHIR-type `as()` and string concatenation, which are outside the
 * subset, so it is reported `INVARIANT_UNCHECKED`: never assumed to hold. A supplied profile whose
 * snapshot carries `dom-3` with this same expression is answered by this decision too, so a
 * resource with no `contained` entry draws no `dom-3` finding under that profile either.
 *
 * **Every occurrence the model holds at an anchor is evaluated as the model holds it.** A position
 * where the reader could not place what the sender wrote (a string, number or `null` where an
 * element belongs, or an array inside an array) holds an element with nothing in it, or a value
 * where an element belongs, and a constraint requiring content there does not hold. That is the
 * fail-safe direction: it can add a finding to a document that is already non-conformant, never
 * withdraw one.
 *
 * Every finding is value-free: the code, the severity, the constraint key and a location built from
 * the document's own element names (bounded, see {@link ../model/path.js}) and array indices.
 *
 * @packageDocumentation
 */

import { UnsupportedFhirPathError } from "../fhirpath/errors.js";
import { convertToBoolean, evaluate, type FpColl } from "../fhirpath/evaluate.js";
import { parseFhirPath, type Expr } from "../fhirpath/parser.js";
import {
  childPath,
  getProperty,
  isComplex,
  isList,
  isPrimitive,
  rootPath,
  type FhirComplex,
  type FhirNode,
  type FhirProperty,
} from "../model/index.js";
import { Trail } from "../model/path.js";
import { ISSUE_SEVERITIES, validationIssue, type ValidationIssue } from "./issues.js";

/** The eight resource types whose base constraints this layer evaluates. */
const BASE_CONSTRAINT_TYPES: ReadonlySet<string> = new Set([
  "AllergyIntolerance",
  "Condition",
  "DiagnosticReport",
  "Immunization",
  "MedicationRequest",
  "MedicationStatement",
  "Observation",
  "Patient",
]);

/**
 * Where a constraint is evaluated.
 *
 * - `root`: once, against the resource itself (`DomainResource`, so every one of the eight types).
 * - `element`: once per occurrence of a direct element of one resource type.
 * - `every-element`: once per element at any depth outside `contained` (`Element`).
 * - `every-extension`: once per `extension` / `modifierExtension` at any depth outside `contained`,
 *   including a primitive's own extensions and an extension's nested ones (`Extension`).
 */
type Anchor =
  | { readonly kind: "root" }
  | { readonly kind: "element"; readonly type: string; readonly element: string }
  | { readonly kind: "every-element" }
  | { readonly kind: "every-extension" };

/** One row of the transcribed table. Every row is `error` severity in R4 4.0.1. */
interface BaseConstraint {
  readonly key: string;
  readonly anchor: Anchor;
  /** The R4 4.0.1 expression, verbatim. */
  readonly expression: string;
}

/**
 * The base constraints this layer evaluates, verbatim from R4 4.0.1. `DiagnosticReport`,
 * `MedicationRequest` and `MedicationStatement` declare no constraint of their own, so they are
 * reached by the `DomainResource`, `Element` and `Extension` rows alone.
 */
const BASE_CONSTRAINTS: readonly BaseConstraint[] = [
  {
    key: "dom-2",
    anchor: { kind: "root" },
    expression: "contained.contained.empty()",
  },
  {
    key: "dom-3",
    anchor: { kind: "root" },
    expression:
      "contained.where((('#'+id in (%resource.descendants().reference | %resource.descendants().as(canonical) | %resource.descendants().as(uri) | %resource.descendants().as(url))) or descendants().where(reference = '#').exists() or descendants().where(as(canonical) = '#').exists() or descendants().where(as(canonical) = '#').exists()).not()).trace('unmatched', id).empty()",
  },
  {
    key: "dom-4",
    anchor: { kind: "root" },
    expression: "contained.meta.versionId.empty() and contained.meta.lastUpdated.empty()",
  },
  {
    key: "dom-5",
    anchor: { kind: "root" },
    expression: "contained.meta.security.empty()",
  },
  {
    key: "pat-1",
    anchor: { kind: "element", type: "Patient", element: "contact" },
    expression: "name.exists() or telecom.exists() or address.exists() or organization.exists()",
  },
  {
    key: "obs-3",
    anchor: { kind: "element", type: "Observation", element: "referenceRange" },
    expression: "low.exists() or high.exists() or text.exists()",
  },
  {
    key: "con-1",
    anchor: { kind: "element", type: "Condition", element: "stage" },
    expression: "summary.exists() or assessment.exists()",
  },
  {
    key: "con-2",
    anchor: { kind: "element", type: "Condition", element: "evidence" },
    expression: "code.exists() or detail.exists()",
  },
  {
    key: "imm-1",
    anchor: { kind: "element", type: "Immunization", element: "education" },
    expression: "documentType.exists() or reference.exists()",
  },
  {
    key: "ele-1",
    anchor: { kind: "every-element" },
    expression: "hasValue() or (children().count() > id.count())",
  },
  {
    key: "ext-1",
    anchor: { kind: "every-extension" },
    expression: "extension.exists() != value.exists()",
  },
];

/**
 * The outcome of one constraint at one focus.
 *
 * @internal
 */
export type Outcome = "satisfied" | "violated" | "unchecked";

/**
 * One expression parsed: its tree, or `undefined` when it lies outside the subset's grammar. A parse
 * that failed for any other reason (the stack running out when the first validation happens deep in
 * a caller's own recursion, say) is `failed`: its tree is `undefined` for this call, which reports
 * the constraint unchecked, and nothing is kept, so the next call parses it again.
 */
interface Parsed {
  readonly ast: Expr | undefined;
  readonly failed: boolean;
}

/** Parse an expression, telling a grammar refusal (kept) from any other failure (not kept). */
function compile(expression: string): Parsed {
  try {
    return { ast: parseFhirPath(expression), failed: false };
  } catch (error) {
    return { ast: undefined, failed: !(error instanceof UnsupportedFhirPathError) };
  }
}

/** A table row with its expression parsed once, when the subset can parse it. */
interface Compiled {
  readonly row: BaseConstraint;
  readonly ast: Expr | undefined;
}

/**
 * The table's expressions, parsed on the first validation rather than when the package is imported,
 * so an import parses nothing. Kept only once every row has parsed or been refused by the grammar:
 * a build that failed part way keeps nothing and the next call builds again. A call that reaches
 * this while another build is under way (none does today: parsing calls back into nothing) builds
 * its own copy, equal to the kept one.
 */
let compiledTable: readonly Compiled[] | undefined;

/** The parsed table, built on first use. */
function compiledConstraints(): readonly Compiled[] {
  if (compiledTable !== undefined) return compiledTable;
  let failed = false;
  const built = BASE_CONSTRAINTS.map((row): Compiled => {
    const parsed = compile(row.expression);
    if (parsed.failed) failed = true;
    return { row, ast: parsed.ast };
  });
  if (!failed) compiledTable = built;
  return built;
}

/** Each key's verbatim expression, to tell a profile's copy of a base constraint from its own. */
const EXPRESSION_OF: ReadonlyMap<string, string> = new Map(
  BASE_CONSTRAINTS.map((row) => [row.key, row.expression]),
);

/** The selection `dom-3` starts from, parsed on first use and kept once it has parsed. */
let containedSelection: Expr | undefined;

/** The `contained` selection, or `undefined` when it could not be parsed on this call. */
function containedSelectionExpr(): Expr | undefined {
  if (containedSelection !== undefined) return containedSelection;
  const { ast } = compile("contained");
  if (ast !== undefined) containedSelection = ast;
  return ast;
}

/**
 * The leaves a node selects in FHIRPath: itself, or for a list every item, a list inside a list
 * followed item by item, exactly as the engine's `wrap` flattens one.
 */
function leafCount(node: FhirNode): number {
  if (!isList(node)) return 1;
  let count = 0;
  for (const item of node.items) count += leafCount(item);
  return count;
}

/** Whether `propertyName` is a `[x]` variant of `base`, as the engine decides it. */
function isChoiceVariant(propertyName: string, base: string): boolean {
  if (!propertyName.startsWith(base) || propertyName.length === base.length) return false;
  const suffix = propertyName.charAt(base.length);
  return suffix >= "A" && suffix <= "Z";
}

/**
 * How many items the member `name` selects on `node`, as the engine navigates it: on a complex
 * node, the first property of that name, or failing one, every `[x]` variant of it; on a primitive,
 * its `extension` metadata or its `id`; anything else selects nothing.
 */
function memberCount(node: FhirNode, name: string): number {
  if (isComplex(node)) {
    const exact = getProperty(node, name);
    if (exact !== undefined) return leafCount(exact);
    let count = 0;
    for (const property of node.properties) {
      if (isChoiceVariant(property.name, name)) count += leafCount(property.value);
    }
    return count;
  }
  if (isPrimitive(node)) {
    if (name === "extension") return node.extension?.length ?? 0;
    if (name === "id") return node.id === undefined ? 0 : 1;
  }
  return 0;
}

/**
 * How many items `children()` selects on `node`, as the engine reads it: a complex node's
 * properties but `resourceType`, each list flattened; a primitive's `id` and its extensions.
 */
function childCount(node: FhirNode): number {
  if (isComplex(node)) {
    let count = 0;
    for (const property of node.properties) {
      if (property.name !== "resourceType") count += leafCount(property.value);
    }
    return count;
  }
  if (isPrimitive(node)) return (node.id === undefined ? 0 : 1) + (node.extension?.length ?? 0);
  return 0;
}

/**
 * `ele-1`, `hasValue() or (children().count() > id.count())`, decided directly at one occurrence.
 *
 * The layer asks this of every element of the resource, so it is decided by code written for it
 * rather than by running the expression through the engine at each one, which allocated more than
 * every other layer of the validator put together. Both operands are booleans for every focus, so
 * the engine never refuses it and its answer is `satisfied` or `violated`, never `unchecked`.
 * `test/base-invariants.test.ts` holds this to the engine's own answer over every element of a
 * generated corpus.
 */
function decideEle1(focus: FhirNode): Outcome {
  const hasValue = isPrimitive(focus) && focus.value !== undefined;
  return hasValue || childCount(focus) > memberCount(focus, "id") ? "satisfied" : "violated";
}

/** `ext-1`, `extension.exists() != value.exists()`, decided directly, as {@link decideEle1} is. */
function decideExt1(focus: FhirNode): Outcome {
  const extension = memberCount(focus, "extension") > 0;
  const value = memberCount(focus, "value") > 0;
  return extension !== value ? "satisfied" : "violated";
}

/** The constraints decided directly rather than by the engine, by key. */
const DECIDED_DIRECTLY: ReadonlyMap<string, (focus: FhirNode) => Outcome> = new Map([
  ["ele-1", decideEle1],
  ["ext-1", decideExt1],
]);

/**
 * One base constraint's outcome at one focus, by the engine and, where the layer decides it
 * directly, by that code too, so a test can hold the two to agreement.
 *
 * @internal
 */
export function baseConstraintOutcomes(
  key: string,
  focus: FhirNode,
  resource: FhirComplex,
): { readonly engine: Outcome; readonly direct: Outcome | undefined } {
  const ast = compiledConstraints().find(({ row }) => row.key === key)?.ast;
  return { engine: outcomeOf(ast, focus, resource), direct: DECIDED_DIRECTLY.get(key)?.(focus) };
}

/**
 * Evaluate a parsed expression against one focus. Any failure, a missing parse included, is
 * `unchecked`, never `satisfied`, exactly as {@link ../fhirpath/index.js evaluateInvariant} decides.
 */
function outcomeOf(ast: Expr | undefined, focus: FhirNode, resource: FhirComplex): Outcome {
  // Every table expression but dom-3 parses, and dom-3 is decided apart: a tree is missing here
  // only when its parse failed on this call for a reason other than the grammar.
  if (ast === undefined) return "unchecked";
  try {
    const at: FpColl = [{ t: "node", node: focus }];
    return convertToBoolean(evaluate(ast, at, { resource, context: at }))
      ? "satisfied"
      : "violated";
  } catch {
    /* v8 ignore next -- defensive: no table expression refuses at evaluation today */
    return "unchecked";
  }
}

/**
 * `dom-3` over the resource, decided by its own semantics where that needs no reference resolution.
 * The expression is `contained.where(<criteria>).trace(...).empty()`: an empty `contained`
 * selection makes the `where`, and so the `trace`, empty, and `empty()` of that is `true`. Any entry
 * reaches the criteria, which are outside the subset, so the outcome is `unchecked`.
 */
function decideDom3(resource: FhirComplex): Outcome {
  const selection = containedSelectionExpr();
  // Missing only when the parse of `contained` failed on this call for a reason other than the grammar.
  if (selection === undefined) return "unchecked";
  try {
    const at: FpColl = [{ t: "node", node: resource }];
    const selected = evaluate(selection, at, { resource, context: at });
    return selected.length === 0 ? "satisfied" : "unchecked";
  } catch {
    /* v8 ignore next -- defensive: navigating `contained` never refuses */
    return "unchecked";
  }
}

/**
 * One base-constraint finding with the occurrence it was evaluated against, so the validator can
 * report a violation a supplied profile repeats exactly once.
 *
 * @internal
 */
export interface BaseInvariantFinding {
  readonly issue: ValidationIssue;
  /** The node the constraint was evaluated against: the resource, or one element occurrence. */
  readonly focus: FhirNode;
}

/**
 * What the base-constraint layer found and what it decided.
 *
 * @internal
 */
export interface BaseInvariantResult {
  /**
   * The findings, each with the node it was evaluated against: the resource-level constraints first,
   * then the element-anchored ones, then `ele-1` / `ext-1` in document order.
   */
  readonly findings: readonly BaseInvariantFinding[];
  /**
   * Whether this layer decided the base constraint `key`, written exactly as `expression`, at
   * `focus`: evaluated it there to held or to not held. A constraint it reported unchecked, never
   * evaluated there, or an expression that is not the base constraint's own, is not decided.
   */
  readonly decides: (focus: FhirNode, key: string, expression: string) => boolean;
}

/** Whether a property name holds `Extension`s: `extension` or `modifierExtension`. */
function holdsExtensions(name: string): boolean {
  return name === "extension" || name === "modifierExtension";
}

/**
 * The occurrences of one element as (node, location) pairs: one for a singleton, one per item for a
 * list, each item at its own index. A list inside a list is followed item by item.
 */
function occurrencesOf(node: FhirNode, path: string): { node: FhirNode; path: string }[] {
  if (!isList(node)) return [{ node, path }];
  return node.items.flatMap((item, i) => occurrencesOf(item, `${path}[${String(i)}]`));
}

/**
 * Called once per element occurrence the walk reaches, with the trail at that occurrence: its
 * location is `trail.text()`, rendered only when a finding needs it.
 */
type Visit = (node: FhirNode, trail: Trail, extension: boolean, typedElement: boolean) => void;

/**
 * Walk every element occurrence under `value`, depth first, in document order.
 *
 * `extension` says whether the occurrence is an `Extension`. `typedElement` is `false` for the two
 * positions R4 types as a plain `System.String` rather than as an element, `Element.id` /
 * `Resource.id` and `Extension.url`, which carry no `ele-1`. A primitive's own extensions are walked
 * as extensions of it, at `<primitive>.extension[i]`.
 */
function walkElements(
  value: FhirNode,
  trail: Trail,
  extension: boolean,
  typedElement: boolean,
  visit: Visit,
): void {
  // Each occurrence, a list followed item by item at its own index as `occurrencesOf` does, is
  // visited and then walked into before the next one.
  if (isList(value)) {
    const items = value.items;
    for (let i = 0; i < items.length; i++) {
      trail.index(i);
      walkElements(items[i] as FhirNode, trail, extension, typedElement, visit);
      trail.pop();
    }
    return;
  }
  visit(value, trail, extension, typedElement);
  if (isComplex(value)) {
    walkChildren(value, trail, extension, visit);
    return;
  }
  const extensions = value.extension;
  if (extensions === undefined) return;
  for (let i = 0; i < extensions.length; i++) {
    trail.child("extension");
    trail.index(i);
    walkElements(extensions[i] as FhirNode, trail, true, true, visit);
    trail.truncate(trail.depth - 2);
  }
}

/** Walk the members of one complex node. `resourceType` is a type marker, not an element. */
function walkChildren(node: FhirComplex, trail: Trail, isExtension: boolean, visit: Visit): void {
  const properties = node.properties;
  for (let i = 0; i < properties.length; i++) {
    const property = properties[i] as FhirProperty;
    if (property.name === "resourceType") continue;
    const plainString = property.name === "id" || (isExtension && property.name === "url");
    trail.child(property.name);
    walkElements(property.value, trail, holdsExtensions(property.name), !plainString, visit);
    trail.pop();
  }
}

/**
 * Evaluate the base constraints of one of the eight modeled types against a resource.
 *
 * @param resource - The resource model.
 * @param rt - Its `resourceType`, exactly as the document wrote it. Any type outside the eight
 *   yields no finding and decides nothing.
 * @returns The findings, and which constraints were decided at which node.
 * @internal
 */
export function collectBaseInvariantFindings(
  resource: FhirComplex,
  rt: string,
  track: { readonly decides: boolean } = TRACK_DECIDED,
): BaseInvariantResult {
  const findings: BaseInvariantFinding[] = [];
  // The keys decided (held or not held) at each node; an unchecked outcome is never recorded here.
  // Most nodes have one key decided at them, kept as the key itself until a second one arrives.
  const decided = new Map<FhirNode, string | Set<string>>();
  const isDecided = (focus: FhirNode, key: string): boolean => {
    const keys = decided.get(focus);
    return typeof keys === "string" ? keys === key : keys?.has(key) === true;
  };
  const result: BaseInvariantResult = {
    findings,
    decides: (focus, key, expression) =>
      EXPRESSION_OF.get(key) === expression && isDecided(focus, key),
  };
  if (!BASE_CONSTRAINT_TYPES.has(rt)) return result;
  const root = rootPath(rt);

  const report = (outcome: Outcome, key: string, focus: FhirNode, at: string | Trail): void => {
    if (outcome !== "unchecked" && track.decides) {
      const keys = decided.get(focus);
      if (keys === undefined) decided.set(focus, key);
      else if (typeof keys !== "string") keys.add(key);
      else if (keys !== key) decided.set(focus, new Set([keys, key]));
    }
    if (outcome === "satisfied") return;
    const path = typeof at === "string" ? at : at.text();
    const issue =
      outcome === "violated"
        ? validationIssue("INVARIANT_VIOLATED", ISSUE_SEVERITIES.ERROR, path, key)
        : validationIssue("INVARIANT_UNCHECKED", ISSUE_SEVERITIES.INFORMATION, path, key);
    findings.push({ issue, focus });
  };

  const compiled = compiledConstraints();
  for (const { row, ast } of compiled) {
    const { anchor } = row;
    if (anchor.kind === "root") {
      const outcome =
        row.key === "dom-3" ? decideDom3(resource) : outcomeOf(ast, resource, resource);
      report(outcome, row.key, resource, root);
    } else if (anchor.kind === "element" && anchor.type === rt) {
      const value = getProperty(resource, anchor.element);
      if (value === undefined) continue;
      for (const { node, path } of occurrencesOf(value, childPath(root, anchor.element))) {
        report(outcomeOf(ast, node, resource), row.key, node, path);
      }
    }
  }

  const elementRow = compiled.find(({ row }) => row.anchor.kind === "every-element");
  const extensionRow = compiled.find(({ row }) => row.anchor.kind === "every-extension");
  const decide = (row: Compiled, node: FhirNode): Outcome => {
    const direct = DECIDED_DIRECTLY.get(row.row.key);
    /* v8 ignore next -- unreachable today: both rows asked at every element are decided directly */
    return direct === undefined ? outcomeOf(row.ast, node, resource) : direct(node);
  };
  const visit: Visit = (node, trail, extension, typedElement) => {
    if (elementRow !== undefined && typedElement) {
      report(decide(elementRow, node), elementRow.row.key, node, trail);
    }
    if (extensionRow !== undefined && extension) {
      report(decide(extensionRow, node), extensionRow.row.key, node, trail);
    }
  };
  // The resource root is a resource, not an element, and `contained` holds resources whose own
  // content this layer does not evaluate; every other member of the root is walked.
  const trail = new Trail(root);
  const properties = resource.properties;
  for (let i = 0; i < properties.length; i++) {
    const property = properties[i] as FhirProperty;
    if (property.name === "resourceType" || property.name === "contained") continue;
    trail.child(property.name);
    walkElements(
      property.value,
      trail,
      holdsExtensions(property.name),
      property.name !== "id",
      visit,
    );
    trail.pop();
  }
  return result;
}

/**
 * The default for {@link collectBaseInvariantFindings}: record which constraints were decided at
 * which node, for {@link BaseInvariantResult.decides}. The validator asks that only when a profile is
 * supplied, and passes `{ decides: false }` otherwise, so a call without one keeps no table of every
 * node; `decides` then answers `false` for every node.
 */
const TRACK_DECIDED = { decides: true } as const;
