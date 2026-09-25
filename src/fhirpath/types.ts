/**
 * FHIR-type tests for the bounded FHIRPath engine: which type a type specifier names, and when the
 * **instance itself** establishes the FHIR type of an item, so that `is` / `as` / `ofType` can be
 * answered without guessing.
 *
 * The model is generic and carries no datatype name, so a type test is answered only where the
 * instance establishes the type, by one of three rules, and is refused everywhere else:
 *
 * - **R1, a choice variant.** The item is the value of a property `<base><Suffix>` of the resource
 *   the engine was handed, where this package's own element tables ({@link ../validate/schema.js})
 *   declare `<base>[x]` a choice on that resource type. Its type is the variant the table names
 *   (`valueQuantity` is `Quantity`, `valueDateTime` is `dateTime`). This holds for an item the
 *   engine navigated to and for the occurrence a profile constraint is anchored to alike, because it
 *   is decided by where the node sits in the resource, found by identity, not by how it was reached.
 * - **R2, the resource root.** The item is the resource the engine was handed, and its
 *   `resourceType` names a resource type this package's tables describe.
 * - **R3, kind.** A model primitive is never a complex FHIR type or a resource, and a complex node is
 *   never a FHIR primitive or a System primitive type. That answers a non-match on its own.
 *
 * Everything else raises {@link ./errors.js UnsupportedFhirPathError}, which the validator reports as
 * `INVARIANT_UNCHECKED`: a complex element not reached through a known choice element and not the
 * resource root, a property named like a choice variant the tables do not declare on that parent, a
 * property whose type-name suffix contradicts the node's own shape (a primitive under
 * `valueQuantity`), a type name that resolves in neither the FHIR nor the System model, and a
 * relation between two types this package cannot establish.
 *
 * @packageDocumentation
 */

import { isComplex, isList, isPrimitive, resourceType, type FhirNode } from "../model/node.js";
import {
  buildRegistry,
  isChoice,
  resolveElement,
  type SchemaRegistry,
} from "../validate/schema.js";
import { UnsupportedFhirPathError } from "./errors.js";

/**
 * The R4 primitive datatypes, as the R4 data types page names them (datatypes.html, "Primitive
 * Types").
 */
const FHIR_PRIMITIVES: ReadonlySet<string> = new Set([
  "boolean",
  "integer",
  "string",
  "decimal",
  "uri",
  "url",
  "canonical",
  "base64Binary",
  "instant",
  "date",
  "dateTime",
  "time",
  "code",
  "oid",
  "id",
  "markdown",
  "unsignedInt",
  "positiveInt",
  "uuid",
]);

/**
 * The R4 complex datatypes the R4 data types page defines or names (datatypes.html, including the
 * four specializations of `Quantity` and the "Other Types" it lists). `SimpleQuantity` and
 * `MoneyQuantity` are absent on purpose: the page says each "is not a type".
 */
const FHIR_COMPLEX: ReadonlySet<string> = new Set([
  "Address",
  "Age",
  "Annotation",
  "Attachment",
  "CodeableConcept",
  "Coding",
  "ContactPoint",
  "Count",
  "Distance",
  "Duration",
  "Extension",
  "HumanName",
  "Identifier",
  "Money",
  "Narrative",
  "Period",
  "Quantity",
  "Range",
  "Ratio",
  "Reference",
  "SampledData",
  "Signature",
  "Timing",
]);

/**
 * The one concrete-type specialization R4 defines among the types above: `Age`, `Count`, `Distance`
 * and `Duration` are "specializations of Quantity" (datatypes.html). Nothing else here specializes
 * another concrete type.
 */
const SPECIALIZES: ReadonlyMap<string, string> = new Map([
  ["Age", "Quantity"],
  ["Count", "Quantity"],
  ["Distance", "Quantity"],
  ["Duration", "Quantity"],
]);

/** An abstract FHIR type: a relation to it is never established here. */
const FHIR_ABSTRACT: ReadonlySet<string> = new Set(["Resource"]);

/** The System model's types (FHIRPath's literal types). */
const SYSTEM_TYPES: ReadonlySet<string> = new Set([
  "Boolean",
  "String",
  "Integer",
  "Decimal",
  "Date",
  "DateTime",
  "Time",
  "Quantity",
]);

/** What a FHIR type name is, or `undefined` when this package does not know the name. */
type FhirKind = "primitive" | "complex" | "resource" | "abstract";

let registry: SchemaRegistry | undefined;

/** The built-in element tables, built once on first use. */
function tables(): SchemaRegistry {
  registry ??= buildRegistry();
  return registry;
}

function fhirKind(name: string): FhirKind | undefined {
  if (FHIR_PRIMITIVES.has(name)) return "primitive";
  if (FHIR_COMPLEX.has(name)) return "complex";
  if (FHIR_ABSTRACT.has(name)) return "abstract";
  if (tables()(name) !== undefined) return "resource";
  return undefined;
}

/** A type specifier resolved to the model that defines it. */
export interface ResolvedType {
  readonly model: "FHIR" | "System";
  readonly name: string;
}

/**
 * Resolve a type specifier the way FHIRPath does: a `FHIR.` or `System.` qualifier names the model,
 * and an unqualified name is looked up in the FHIR model first and the System model second. So
 * `Quantity` and `dateTime` are FHIR types, while `DateTime` and `String` are System types.
 *
 * @param specifier - The type specifier as written, possibly qualified (`System.String`).
 * @returns The resolved type, or `undefined` when the name resolves in neither model as this
 *   package knows them.
 * @example
 * ```ts
 * resolveTypeSpecifier("Quantity"); // { model: "FHIR", name: "Quantity" }
 * resolveTypeSpecifier("DateTime"); // { model: "System", name: "DateTime" }
 * resolveTypeSpecifier("string1"); // undefined
 * ```
 */
export function resolveTypeSpecifier(specifier: string): ResolvedType | undefined {
  const dot = specifier.indexOf(".");
  if (dot >= 0) {
    const model = specifier.slice(0, dot);
    const name = specifier.slice(dot + 1);
    if (model === "FHIR" && fhirKind(name) !== undefined) return { model, name };
    if (model === "System" && SYSTEM_TYPES.has(name)) return { model, name };
    return undefined;
  }
  if (fhirKind(specifier) !== undefined) return { model: "FHIR", name: specifier };
  if (SYSTEM_TYPES.has(specifier)) return { model: "System", name: specifier };
  return undefined;
}

/** One place a node sits in a resource: the node holding it, and the property it sits under. */
interface Position {
  readonly parent: FhirNode;
  readonly property: string;
  /** Whether it sits inside a repeating element rather than being the property's value itself. */
  readonly inList: boolean;
}

const POSITIONS = new WeakMap<FhirNode, ReadonlyMap<FhirNode, readonly Position[]>>();

/**
 * Every position of every node in `resource`, keyed by node identity. Built once per resource (the
 * model is immutable) and walked without recursion, so a deeply nested document cannot exhaust the
 * stack here.
 */
function positionsIn(resource: FhirNode): ReadonlyMap<FhirNode, readonly Position[]> {
  const cached = POSITIONS.get(resource);
  if (cached !== undefined) return cached;
  const out = new Map<FhirNode, Position[]>();
  const pending: FhirNode[] = [resource];
  const seen = new Set<FhirNode>([resource]);
  const record = (value: FhirNode, parent: FhirNode, property: string, inList: boolean): void => {
    if (isList(value)) {
      for (const item of value.items) record(item, parent, property, true);
      return;
    }
    const list = out.get(value);
    if (list === undefined) out.set(value, [{ parent, property, inList }]);
    else list.push({ parent, property, inList });
    if (!seen.has(value)) {
      seen.add(value);
      pending.push(value);
    }
  };
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (isComplex(node)) {
      for (const p of node.properties) record(p.value, node, p.name, false);
      for (const p of node.duplicates ?? []) record(p.value, node, p.name, false);
    } else if (isPrimitive(node)) {
      for (const ext of node.extension ?? []) record(ext, node, "extension", true);
    }
  }
  POSITIONS.set(resource, out);
  return out;
}

/**
 * Whether a property name ends in a FHIR type name whose kind contradicts the node sitting under it:
 * a primitive under `valueQuantity`, an object under `valueString`. Such a node's type is refused
 * rather than read off either the name or the shape.
 */
function suffixContradicts(property: string, node: FhirNode): boolean {
  for (let i = 1; i < property.length; i += 1) {
    const first = property.charAt(i);
    if (first < "A" || first > "Z") continue;
    const suffix = property.slice(i);
    const kind = fhirKind(suffix);
    if (isPrimitive(node) && (kind === "complex" || kind === "resource")) return true;
    if (isComplex(node) && FHIR_PRIMITIVES.has(first.toLowerCase() + suffix.slice(1))) return true;
  }
  return false;
}

/** R1: the variant type of a choice property of the resource root, as this package's tables say. */
function choiceVariantType(position: Position, resource: FhirNode): string | undefined {
  if (position.inList || position.parent !== resource || !isComplex(resource)) return undefined;
  const type = resourceType(resource);
  const schema = type === undefined ? undefined : tables()(type);
  if (schema === undefined) return undefined;
  const resolved = resolveElement(schema.elements, position.property);
  if (resolved === undefined || !isChoice(resolved.element)) return undefined;
  return resolved.datatype;
}

/** The FHIR type the instance establishes for `node` (R1 or R2), or `undefined`. */
function establishedType(node: FhirNode, resource: FhirNode): string | undefined {
  const positions = positionsIn(resource).get(node) ?? [];
  if (node === resource) {
    // R2. A root found somewhere inside itself is not a shape a tree can have; refuse it.
    if (positions.length > 0 || !isComplex(node)) return undefined;
    const type = resourceType(node);
    return type !== undefined && fhirKind(type) === "resource" ? type : undefined;
  }
  // R1, which must hold at EVERY position the node occupies, and agree.
  let established: string | undefined;
  for (const position of positions) {
    const type = choiceVariantType(position, resource);
    if (type === undefined || (established !== undefined && established !== type)) {
      return undefined;
    }
    established = type;
  }
  return established;
}

/** Whether established type `actual` is the type `tested` or a specialization of it. */
function isOfType(actual: string, tested: string): boolean {
  if (actual === tested) return true;
  const actualKind = fhirKind(actual);
  const testedKind = fhirKind(tested);
  if (actualKind === undefined || testedKind === undefined || testedKind === "abstract") {
    throw new UnsupportedFhirPathError("type test between types this engine cannot relate");
  }
  if (actualKind === "primitive" || testedKind === "primitive") {
    // Two different FHIR primitives. R4 specializes some of them (`code` from `string`), and the
    // shared corpus answers such a pair differently through `is` and through `ofType`, so no pair
    // of distinct primitives is answered here.
    throw new UnsupportedFhirPathError("type test between two different FHIR primitive types");
  }
  return SPECIALIZES.get(actual) === tested;
}

/**
 * Answer a FHIR-type test, or a System-type test on a complex node, over one model node, or refuse.
 *
 * @param node - The item's node.
 * @param type - The resolved type being tested for.
 * @param resource - The resource the engine was handed (`%resource`): where R1 and R2 look.
 * @returns Whether `node` is of `type` (exactly, or a specialization of it).
 * @throws UnsupportedFhirPathError when the instance does not establish the answer.
 * @example
 * ```ts
 * // `valueQuantity` on an Observation root: R1 establishes Quantity.
 * nodeIsOfType(valueQuantityNode, { model: "FHIR", name: "Quantity" }, observation); // true
 * ```
 */
export function nodeIsOfType(node: FhirNode, type: ResolvedType, resource: FhirNode): boolean {
  if (isList(node)) throw new UnsupportedFhirPathError("type test on a repeating element");
  const positions = positionsIn(resource).get(node) ?? [];
  if (positions.some((p) => suffixContradicts(p.property, node))) {
    throw new UnsupportedFhirPathError(
      "type test on an element whose property name contradicts its shape",
    );
  }
  if (type.model === "System") {
    // R3: a complex node is never a System primitive. Every other System-type test on a model node
    // is the caller's to answer or refuse.
    if (isComplex(node)) return false;
    throw new UnsupportedFhirPathError(`type test '${type.name}' on a model primitive`);
  }
  const kind = fhirKind(type.name);
  // R3, both directions.
  if (isPrimitive(node) && kind !== "primitive") return false;
  if (isComplex(node) && kind === "primitive") return false;
  const actual = establishedType(node, resource);
  if (actual === undefined) {
    throw new UnsupportedFhirPathError(
      "type test on an element whose type the instance does not establish",
    );
  }
  return isOfType(actual, type.name);
}
