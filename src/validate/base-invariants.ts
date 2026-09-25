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
 * subset, so it is reported `INVARIANT_UNCHECKED`: never assumed to hold.
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

import { convertToBoolean, evaluate, type FpColl } from "../fhirpath/evaluate.js";
import { parseFhirPath, type Expr } from "../fhirpath/parser.js";
import {
  childPath,
  getProperty,
  isComplex,
  isList,
  rootPath,
  type FhirComplex,
  type FhirNode,
} from "../model/index.js";
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

/** The outcome of one constraint at one focus. */
type Outcome = "satisfied" | "violated" | "unchecked";

/** Parse an expression once, or `undefined` when it lies outside the subset's grammar. */
function compile(expression: string): Expr | undefined {
  try {
    return parseFhirPath(expression);
  } catch {
    return undefined;
  }
}

/** A table row with its expression parsed once, when the subset can parse it. */
interface Compiled {
  readonly row: BaseConstraint;
  readonly ast: Expr | undefined;
}

const COMPILED: readonly Compiled[] = BASE_CONSTRAINTS.map((row) => ({
  row,
  ast: compile(row.expression),
}));

/** The selection `dom-3` starts from, evaluated on its own by the same engine. */
const CONTAINED_SELECTION = compile("contained");

/**
 * Evaluate a parsed expression against one focus. Any failure, a missing parse included, is
 * `unchecked`, never `satisfied`, exactly as {@link ../fhirpath/index.js evaluateInvariant} decides.
 */
function outcomeOf(ast: Expr | undefined, focus: FhirNode, resource: FhirComplex): Outcome {
  if (ast === undefined) return "unchecked";
  try {
    const at: FpColl = [{ t: "node", node: focus }];
    return convertToBoolean(evaluate(ast, at, { resource, context: at }))
      ? "satisfied"
      : "violated";
  } catch {
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
  if (CONTAINED_SELECTION === undefined) return "unchecked";
  try {
    const at: FpColl = [{ t: "node", node: resource }];
    const selected = evaluate(CONTAINED_SELECTION, at, { resource, context: at });
    return selected.length === 0 ? "satisfied" : "unchecked";
  } catch {
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

/** Called once per element occurrence the walk reaches. */
type Visit = (node: FhirNode, path: string, extension: boolean, typedElement: boolean) => void;

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
  path: string,
  extension: boolean,
  typedElement: boolean,
  visit: Visit,
): void {
  for (const occurrence of occurrencesOf(value, path)) {
    const { node } = occurrence;
    visit(node, occurrence.path, extension, typedElement);
    if (isComplex(node)) {
      walkChildren(node, occurrence.path, extension, visit);
    } else if (!isList(node)) {
      (node.extension ?? []).forEach((ext, i) => {
        walkElements(ext, `${occurrence.path}.extension[${String(i)}]`, true, true, visit);
      });
    }
  }
}

/** Walk the members of one complex node. `resourceType` is a type marker, not an element. */
function walkChildren(node: FhirComplex, path: string, isExtension: boolean, visit: Visit): void {
  for (const property of node.properties) {
    if (property.name === "resourceType") continue;
    const plainString = property.name === "id" || (isExtension && property.name === "url");
    walkElements(
      property.value,
      childPath(path, property.name),
      holdsExtensions(property.name),
      !plainString,
      visit,
    );
  }
}

/**
 * Evaluate the base constraints of one of the eight modeled types against a resource.
 *
 * @param resource - The resource model.
 * @param rt - Its `resourceType`, exactly as the document wrote it. Any type outside the eight
 *   yields no finding.
 * @returns The findings, each with the node it was evaluated against: the resource-level constraints
 *   first, then the element-anchored ones, then `ele-1` / `ext-1` in document order.
 * @internal
 */
export function collectBaseInvariantFindings(
  resource: FhirComplex,
  rt: string,
): BaseInvariantFinding[] {
  if (!BASE_CONSTRAINT_TYPES.has(rt)) return [];
  const root = rootPath(rt);
  const findings: BaseInvariantFinding[] = [];

  const report = (outcome: Outcome, key: string, focus: FhirNode, path: string): void => {
    if (outcome === "satisfied") return;
    const issue =
      outcome === "violated"
        ? validationIssue("INVARIANT_VIOLATED", ISSUE_SEVERITIES.ERROR, path, key)
        : validationIssue("INVARIANT_UNCHECKED", ISSUE_SEVERITIES.INFORMATION, path, key);
    findings.push({ issue, focus });
  };

  for (const { row, ast } of COMPILED) {
    const { anchor } = row;
    if (anchor.kind === "root") {
      const outcome = row.key === "dom-3" ? decideDom3(resource) : outcomeOf(ast, resource, resource);
      report(outcome, row.key, resource, root);
    } else if (anchor.kind === "element" && anchor.type === rt) {
      const value = getProperty(resource, anchor.element);
      if (value === undefined) continue;
      for (const { node, path } of occurrencesOf(value, childPath(root, anchor.element))) {
        report(outcomeOf(ast, node, resource), row.key, node, path);
      }
    }
  }

  const elementRow = COMPILED.find(({ row }) => row.anchor.kind === "every-element");
  const extensionRow = COMPILED.find(({ row }) => row.anchor.kind === "every-extension");
  const visit: Visit = (node, path, extension, typedElement) => {
    if (elementRow !== undefined && typedElement) {
      report(outcomeOf(elementRow.ast, node, resource), elementRow.row.key, node, path);
    }
    if (extensionRow !== undefined && extension) {
      report(outcomeOf(extensionRow.ast, node, resource), extensionRow.row.key, node, path);
    }
  };
  // The resource root is a resource, not an element, and `contained` holds resources whose own
  // content this layer does not evaluate; every other member of the root is walked.
  for (const property of resource.properties) {
    if (property.name === "resourceType" || property.name === "contained") continue;
    walkElements(
      property.value,
      childPath(root, property.name),
      holdsExtensions(property.name),
      property.name !== "id",
      visit,
    );
  }
  return findings;
}
