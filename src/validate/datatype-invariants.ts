/**
 * The datatype-constraint layer: the error-severity constraints R4 4.0.1 declares on its datatypes
 * (`Quantity` and its profiles, `Period`, `Range`, `Ratio`, `Reference`, `Attachment`,
 * `ContactPoint`, `Timing`, and the rest below), evaluated by {@link ./validate.js validateResource}
 * at every occurrence of the datatype, at any depth, whether or not a profile is supplied.
 *
 * R4 says a datatype's constraint is part of the datatype: an Observation whose `valueQuantity` has
 * a `code` and no `system` breaks `qty-3`, a `Period` that starts after it ends breaks `per-1`, and a
 * `referenceRange.low` with a `comparator` breaks `sqty-1`, because R4 types that element as a
 * `SimpleQuantity`. Each is a non-conformant resource with no profile in sight.
 *
 * **The table is the definitions' own.** {@link DATATYPE_CONSTRAINTS} lists, verbatim, every
 * error-severity constraint of every datatype the validator's element model reaches below the ten
 * resource types it walks, and {@link TYPE_PROFILES} every element R4 narrows to a datatype profile
 * (`SimpleQuantity`). `test/datatype-invariants.test.ts` holds both, entry for entry, to
 * `test/__data__/fhir-element-definitions.json`, which CI re-derives from the R4 definition files
 * pinned by digest (`pnpm definitions:check`). `ele-1` and `ext-1` are the base-constraint layer's
 * ({@link ./base-invariants.js}), and `txt-1` / `txt-2` on `Narrative.div` are the narrative
 * layer's ({@link ./narrative.js}), whose findings carry those keys.
 *
 * **Where it walks.** From the resource root, member by member, typed by the R4 and R4B element
 * definitions ({@link ../safety/element-definitions.js}), into every backbone element, datatype and
 * extension, into a primitive's own extensions, and into every resource the document carries at a
 * position R4 types as a resource (`contained`, a Bundle entry) when that resource is one of the
 * ten. A member the definitions do not define is not walked: the structure layer reports it.
 *
 * **Outcomes**, mapped exactly as the base-constraint layer maps them:
 *
 * - a constraint that does not hold → `INVARIANT_VIOLATED` at `error`, carrying the key;
 * - an expression the bounded engine cannot evaluate → `INVARIANT_UNCHECKED` at `information`,
 *   carrying the key, **never treated as satisfied**.
 *
 * Two constraints are decided by code written for them, because the engine refuses their
 * expressions: `rng-2` (`low <= high`, two quantities compared only when they carry the same unit,
 * otherwise unchecked) and `ref-1` (a `#id` reference names a resource the root resource contains;
 * a bare `#`, which R4 uses for the container itself, is unchecked). `cnt-3` and `trd-3` call
 * functions outside the subset and are reported unchecked wherever a `Count` or a
 * `TriggerDefinition` occurs.
 *
 * Every finding is value-free: the code, the severity, the constraint key, and a location built from
 * the document's own element names (bounded, see {@link ../model/path.js}) and array indices.
 *
 * @packageDocumentation
 */

import { UnsupportedFhirPathError } from "../fhirpath/errors.js";
import { convertToBoolean, evaluate, type FpColl } from "../fhirpath/evaluate.js";
import { parseFhirPath, type Expr } from "../fhirpath/parser.js";
import { compareDecimals, FhirDecimal } from "../model/decimal.js";
import {
  getProperty,
  isComplex,
  isList,
  isPrimitive,
  resourceType,
  type FhirComplex,
  type FhirNode,
  type FhirProperty,
} from "../model/index.js";
import { Trail } from "../model/path.js";
import {
  elementTargets,
  PRIMITIVE_TARGET,
  RESOURCE_TARGET,
} from "../safety/element-definitions.js";
import { ASSESSED_RESOURCE_TYPES } from "../safety/status.js";
import type { BaseInvariantFinding, Outcome } from "./base-invariants.js";
import { ISSUE_SEVERITIES, validationIssue } from "./issues.js";

/**
 * The error-severity constraints R4 4.0.1 declares on each datatype (or datatype backbone element,
 * `Timing.repeat`) the element model reaches, and on each datatype profile it reaches, as
 * `[key, expression]` pairs, the expression verbatim. A datatype that declares none (`Dosage`,
 * `Identifier`, `HumanName`, `CodeableConcept` and the rest) has no entry. Written inside a function
 * and made on first use, so an import that never validates builds nothing.
 *
 * @internal
 */
export const DATATYPE_CONSTRAINTS = (): Readonly<
  Record<string, readonly (readonly [string, string])[]>
> => ({
  Age: [
    [
      "age-1",
      "(code.exists() or value.empty()) and (system.empty() or system = %ucum) and (value.empty() or value.hasValue().not() or value > 0)",
    ],
    ["qty-3", "code.empty() or system.exists()"],
  ],
  Attachment: [["att-1", "data.empty() or contentType.exists()"]],
  ContactPoint: [["cpt-2", "value.empty() or system.exists()"]],
  Count: [
    [
      "cnt-3",
      "(code.exists() or value.empty()) and (system.empty() or system = %ucum) and (code.empty() or code = '1') and (value.empty() or value.hasValue().not() or value.toString().contains('.').not())",
    ],
    ["qty-3", "code.empty() or system.exists()"],
  ],
  "DataRequirement.codeFilter": [["drq-1", "path.exists() xor searchParam.exists()"]],
  "DataRequirement.dateFilter": [["drq-2", "path.exists() xor searchParam.exists()"]],
  Distance: [
    ["dis-1", "(code.exists() or value.empty()) and (system.empty() or system = %ucum)"],
    ["qty-3", "code.empty() or system.exists()"],
  ],
  Duration: [
    ["drt-1", "code.exists() implies ((system = %ucum) and value.exists())"],
    ["qty-3", "code.empty() or system.exists()"],
  ],
  Expression: [["exp-1", "expression.exists() or reference.exists()"]],
  Period: [["per-1", "start.hasValue().not() or end.hasValue().not() or (start <= end)"]],
  Quantity: [["qty-3", "code.empty() or system.exists()"]],
  Range: [["rng-2", "low.empty() or high.empty() or (low <= high)"]],
  Ratio: [
    [
      "rat-1",
      "(numerator.empty() xor denominator.exists()) and (numerator.exists() or extension.exists())",
    ],
  ],
  Reference: [
    [
      "ref-1",
      "reference.startsWith('#').not() or (reference.substring(1).trace('url') in %rootResource.contained.id.trace('ids'))",
    ],
  ],
  SimpleQuantity: [
    ["qty-3", "code.empty() or system.exists()"],
    ["sqty-1", "comparator.empty()"],
  ],
  "Timing.repeat": [
    ["tim-1", "duration.empty() or durationUnit.exists()"],
    ["tim-10", "timeOfDay.empty() or when.empty()"],
    ["tim-2", "period.empty() or periodUnit.exists()"],
    ["tim-4", "duration.exists() implies duration >= 0"],
    ["tim-5", "period.exists() implies period >= 0"],
    ["tim-6", "periodMax.empty() or period.exists()"],
    ["tim-7", "durationMax.empty() or duration.exists()"],
    ["tim-8", "countMax.empty() or count.exists()"],
    ["tim-9", "offset.empty() or (when.exists() and ((when in ('C' | 'CM' | 'CD' | 'CV')).not()))"],
  ],
  TriggerDefinition: [
    ["trd-1", "data.empty() or timing.empty()"],
    ["trd-2", "condition.exists() implies data.exists()"],
    [
      "trd-3",
      "(type = 'named-event' implies name.exists()) and (type = 'periodic' implies timing.exists()) and (type.startsWith('data-') implies data.exists())",
    ],
  ],
});

/**
 * The elements R4 4.0.1 types with a datatype profile, by `<context>.<member>` as the element
 * model names them (a choice by the name a document writes), and the profile, whose constraints
 * apply there in place of the datatype's own.
 *
 * @internal
 */
export const TYPE_PROFILES = (): Readonly<Record<string, string>> => ({
  "Dosage.doseAndRate.doseQuantity": "SimpleQuantity",
  "Dosage.doseAndRate.rateQuantity": "SimpleQuantity",
  "Dosage.maxDosePerAdministration": "SimpleQuantity",
  "Dosage.maxDosePerLifetime": "SimpleQuantity",
  "Immunization.doseQuantity": "SimpleQuantity",
  "MedicationRequest.dispenseRequest.initialFill.quantity": "SimpleQuantity",
  "MedicationRequest.dispenseRequest.quantity": "SimpleQuantity",
  "Observation.referenceRange.high": "SimpleQuantity",
  "Observation.referenceRange.low": "SimpleQuantity",
  "Range.high": "SimpleQuantity",
  "Range.low": "SimpleQuantity",
  "SampledData.origin": "SimpleQuantity",
});

/**
 * The datatype constraints R4 declares that another layer evaluates, and the layer: the two
 * narrative constraints on `Narrative.div`, which the narrative layer reads as XHTML.
 *
 * @internal
 */
export const DATATYPE_CONSTRAINTS_ELSEWHERE: Readonly<Record<string, string>> = {
  "txt-1": "narrative",
  "txt-2": "narrative",
};

/** One constraint ready to evaluate: its key, and its tree or the code that decides it. */
interface Compiled {
  readonly key: string;
  readonly decide: (focus: FhirComplex, root: FhirComplex, context: string) => Outcome;
}

/** The compiled constraints by context, made on first use and kept once every row has compiled. */
let compiledTable: ReadonlyMap<string, readonly Compiled[]> | undefined;

/** The profile of each profiled position, made on first use and kept. */
let profileTable: Readonly<Record<string, string>> | undefined;

/**
 * Evaluate a parsed expression against one focus read as `context`. A name the definitions give
 * `context` as an element of its own is navigated exactly, never as the stem of a choice: `Timing.repeat`
 * defines `period` and `periodMax` both, and `period.exists()` over a repeat holding only `periodMax`
 * is `false`. Any failure is `unchecked`, never `satisfied`.
 */
function outcomeOf(
  ast: Expr | undefined,
  focus: FhirNode,
  root: FhirComplex,
  context: string,
): Outcome {
  if (ast === undefined) return "unchecked";
  try {
    const at: FpColl = [{ t: "node", node: focus }];
    const contexts = [context];
    const exact = (name: string): boolean => elementTargets(contexts, name) !== undefined;
    return convertToBoolean(evaluate(ast, at, { resource: root, context: at, exact }))
      ? "satisfied"
      : "violated";
  } catch {
    return "unchecked";
  }
}

/** The string a primitive member holds, or `undefined` when it holds none. */
function stringMember(node: FhirComplex, name: string): string | undefined {
  const value = getProperty(node, name);
  if (value === undefined || !isPrimitive(value) || typeof value.value !== "string") {
    return undefined;
  }
  return value.value;
}

/**
 * `ref-1`, `reference.startsWith('#').not() or (reference.substring(1) in
 * %rootResource.contained.id)`, decided directly. A reference that is not a local `#id` satisfies
 * it; `#id` satisfies it when the root resource contains a resource with that id. A bare `#`
 * names the container itself in R4, which the expression as written does not allow for, so it is
 * left unchecked rather than reported.
 */
function decideRef1(focus: FhirComplex, root: FhirComplex): Outcome {
  const reference = getProperty(focus, "reference");
  if (reference === undefined) return "satisfied";
  if (!isPrimitive(reference) || typeof reference.value !== "string") return "unchecked";
  const text = reference.value;
  if (!text.startsWith("#")) return "satisfied";
  if (text === "#") return "unchecked";
  const id = text.slice(1);
  const contained = getProperty(root, "contained");
  if (contained === undefined) return "violated";
  const items = isList(contained) ? contained.items : [contained];
  for (const item of items) {
    if (isComplex(item) && stringMember(item, "id") === id) return "satisfied";
  }
  return "violated";
}

/** A quantity's value and the unit it is compared in, or `undefined` when either is unreadable. */
function quantityOf(
  node: FhirNode,
): { readonly value: FhirDecimal; readonly unit: string } | undefined {
  if (!isComplex(node)) return undefined;
  const value = getProperty(node, "value");
  if (value === undefined || !isPrimitive(value) || !(value.value instanceof FhirDecimal)) {
    return undefined;
  }
  const code = stringMember(node, "code");
  const unit =
    code === undefined
      ? `unit ${stringMember(node, "unit") ?? ""}`
      : `code ${stringMember(node, "system") ?? ""} ${code}`;
  return { value: value.value, unit };
}

/**
 * `rng-2`, `low.empty() or high.empty() or (low <= high)`, decided directly. Two bounds are
 * compared only when both carry a value and the same unit: the same `system` and `code`, or no code
 * and the same `unit` text. Any other pair (different units, a bound with no value) is a comparison
 * this library does not make, so the constraint is unchecked there, never assumed to hold.
 */
function decideRng2(focus: FhirComplex): Outcome {
  const low = getProperty(focus, "low");
  const high = getProperty(focus, "high");
  if (low === undefined || high === undefined) return "satisfied";
  const a = quantityOf(low);
  const b = quantityOf(high);
  if (a === undefined || b === undefined || a.unit !== b.unit) return "unchecked";
  const order = compareDecimals(a.value, b.value);
  if (order === undefined) return "unchecked";
  return order > 0 ? "violated" : "satisfied";
}

/** The constraints decided by code rather than by the engine, by key. */
function decidedDirectly(key: string): Compiled["decide"] | undefined {
  if (key === "ref-1") return decideRef1;
  if (key === "rng-2") return decideRng2;
  return undefined;
}

/**
 * One row's decision by the engine, its expression parsed the first time an occurrence asks for it
 * rather than when the table is built, so a validation parses only the rows it reaches. A parse the
 * grammar refuses is kept, and the row is unchecked wherever it applies; a parse that failed for any
 * other reason (the stack running out when the first validation happens deep in a caller's own
 * recursion) leaves the row unchecked at this occurrence and is tried again at the next.
 */
function byEngine(expression: string): Compiled["decide"] {
  let parsed: { readonly ast: Expr | undefined } | undefined;
  return (focus, root, context) => {
    if (parsed === undefined) {
      try {
        parsed = { ast: parseFhirPath(expression) };
      } catch (error) {
        if (!(error instanceof UnsupportedFhirPathError)) return "unchecked";
        /* v8 ignore next -- defensive: every expression in the table parses today */
        parsed = { ast: undefined };
      }
    }
    return outcomeOf(parsed.ast, focus, root, context);
  };
}

/** The table, with each row's decision, made on first use and kept. Nothing is parsed here. */
function compiledConstraints(): ReadonlyMap<string, readonly Compiled[]> {
  if (compiledTable !== undefined) return compiledTable;
  const built = new Map<string, readonly Compiled[]>();
  for (const [context, rows] of Object.entries(DATATYPE_CONSTRAINTS())) {
    built.set(
      context,
      rows.map(([key, expression]): Compiled => ({
        key,
        decide: decidedDirectly(key) ?? byEngine(expression),
      })),
    );
  }
  compiledTable = built;
  return built;
}

/** The profiled positions, built on first use. */
function typeProfiles(): Readonly<Record<string, string>> {
  profileTable ??= TYPE_PROFILES();
  return profileTable;
}

/** One walk's state: the findings, and the table it evaluates. */
interface Walk {
  readonly findings: BaseInvariantFinding[];
  readonly table: ReadonlyMap<string, readonly Compiled[]>;
}

/**
 * Evaluate the constraints of `constrained` (the datatype, or the datatype profile R4 narrows it
 * to) at one occurrence of `context`.
 */
function check(
  walk: Walk,
  constrained: string,
  context: string,
  focus: FhirComplex,
  root: FhirComplex,
  trail: Trail,
): void {
  const rows = walk.table.get(constrained);
  if (rows === undefined) return;
  for (const { key, decide } of rows) {
    const outcome = decide(focus, root, context);
    if (outcome === "satisfied") continue;
    const issue =
      outcome === "violated"
        ? validationIssue("INVARIANT_VIOLATED", ISSUE_SEVERITIES.ERROR, trail.text(), key)
        : validationIssue("INVARIANT_UNCHECKED", ISSUE_SEVERITIES.INFORMATION, trail.text(), key);
    walk.findings.push({ issue, focus });
  }
}

/** Walk a primitive's own extensions, each an `Extension`. */
function walkPrimitiveExtensions(
  walk: Walk,
  node: FhirNode,
  root: FhirComplex,
  trail: Trail,
): void {
  if (!isPrimitive(node)) return;
  const extensions = node.extension;
  if (extensions === undefined) return;
  trail.child("extension");
  for (let i = 0; i < extensions.length; i++) {
    trail.index(i);
    walkValue(walk, extensions[i] as FhirNode, "Extension", undefined, root, trail);
    trail.pop();
  }
  trail.pop();
}

/**
 * Walk one value typed as `context` (a datatype or backbone element), or {@link RESOURCE_TARGET} for
 * a resource, or {@link PRIMITIVE_TARGET}; `profile` is the datatype profile R4 narrows it to.
 */
function walkValue(
  walk: Walk,
  value: FhirNode,
  context: string,
  profile: string | undefined,
  root: FhirComplex,
  trail: Trail,
): void {
  if (isList(value)) {
    const items = value.items;
    for (let i = 0; i < items.length; i++) {
      trail.index(i);
      walkValue(walk, items[i] as FhirNode, context, profile, root, trail);
      trail.pop();
    }
    return;
  }
  if (!isComplex(value)) {
    walkPrimitiveExtensions(walk, value, root, trail);
    return;
  }
  if (context === PRIMITIVE_TARGET) return;
  if (context === RESOURCE_TARGET) {
    const type = resourceType(value);
    if (type !== undefined && ASSESSED_RESOURCE_TYPES.has(type)) {
      walkMembers(walk, value, type, root, trail);
    }
    return;
  }
  check(walk, profile ?? context, context, value, root, trail);
  walkMembers(walk, value, context, root, trail);
}

/** Walk the members of one complex node read against `context`. */
function walkMembers(
  walk: Walk,
  node: FhirComplex,
  context: string,
  root: FhirComplex,
  trail: Trail,
): void {
  const contexts = [context];
  const properties = node.properties;
  for (let i = 0; i < properties.length; i++) {
    const property = properties[i] as FhirProperty;
    const name = property.name;
    if (name === "resourceType") continue;
    const targets = elementTargets(contexts, name);
    if (targets === undefined) continue;
    const target = targets[0] as string;
    trail.child(name);
    if (target === RESOURCE_TARGET) {
      // A contained resource answers `%rootResource` with the resource that contains it; any other
      // resource the document carries (a Bundle entry) is its own root.
      walkResources(walk, property.value, name === "contained" ? root : undefined, trail);
    } else {
      walkValue(walk, property.value, target, typeProfiles()[`${context}.${name}`], root, trail);
    }
    trail.pop();
  }
}

/** Walk each resource at a resource position, with `root`, or each resource as its own root. */
function walkResources(
  walk: Walk,
  value: FhirNode,
  root: FhirComplex | undefined,
  trail: Trail,
): void {
  if (isList(value)) {
    const items = value.items;
    for (let i = 0; i < items.length; i++) {
      trail.index(i);
      walkResources(walk, items[i] as FhirNode, root, trail);
      trail.pop();
    }
    return;
  }
  if (!isComplex(value)) return;
  walkValue(walk, value, RESOURCE_TARGET, undefined, root ?? value, trail);
}

/**
 * Evaluate the datatype constraints at every occurrence of a datatype in a resource of one of the
 * ten types the element model describes. A resource of any other type yields nothing.
 *
 * @param resource - The resource model.
 * @param root - The location of the resource root, already bounded.
 * @returns The findings, in document order, each with the node it was evaluated against.
 * @internal
 */
export function collectDatatypeInvariantFindings(
  resource: FhirComplex,
  root: string,
): readonly BaseInvariantFinding[] {
  const walk: Walk = { findings: [], table: compiledConstraints() };
  walkValue(walk, resource, RESOURCE_TARGET, undefined, resource, new Trail(root));
  return walk.findings;
}
