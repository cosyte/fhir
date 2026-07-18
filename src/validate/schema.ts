/**
 * The compact element schema the Phase-2 validator walks — a **non-StructureDefinition** description
 * of a resource's direct elements: cardinality, datatype(s), and any required-strength code binding.
 *
 * This is deliberately *not* a FHIR `StructureDefinition` and not a snapshot generator — that engine
 * (loading StructureDefinitions, generating snapshots from differentials, slicing, US Core profiles)
 * is Phase 6. Phase 2 needs only enough shape to run layers 1–3, so it uses a hand-authored,
 * hierarchy-free record. Phase 6 will *feed* this engine from real StructureDefinitions; the schema
 * type is the seam between the two.
 *
 * **What ships built-in here is intentionally minimal:** the base `Resource` / `DomainResource`
 * elements (which are the same on every resource), and **`Patient`** as the one worked demonstrator
 * that proves the engine validates a real R4 resource end-to-end. Every other resource type is
 * "not modeled yet" and degrades safely (see {@link ./validate.js}) rather than emitting false
 * errors — full per-resource + US Core coverage arrives in Phase 6. Cardinalities are cited from the
 * R4 base definitions (resource.html, domainresource.html, patient.html).
 *
 * @packageDocumentation
 */

/** `1..1` / `0..*` etc. `max` uses {@link UNBOUNDED} for `*`. */
export const UNBOUNDED = Number.POSITIVE_INFINITY;

/** The definition of one direct element of a resource. */
export interface ElementSchema {
  /** Minimum cardinality (`0` for optional, `≥ 1` for required). */
  readonly min: number;
  /** Maximum cardinality (`1` for a singleton, {@link UNBOUNDED} for `*`). */
  readonly max: number;
  /**
   * The allowed datatype name(s). One entry for a normal element; several for a `choice[x]` element
   * (see {@link isChoice}). Primitive names are validated by {@link ./primitives.js}; complex names
   * (e.g. `HumanName`) are validated structurally (cardinality + node shape) only — their internals
   * need the datatype's own definition, which is Phase 6.
   */
  readonly types: readonly string[];
  /** A required-strength enumerated `code` binding, when the element has one. */
  readonly binding?: RequiredBinding;
}

/** A required-strength value-set binding to a fixed set of `code` values. */
export interface RequiredBinding {
  /** Only `"required"` bindings are enforced in Phase 2; weaker strengths are Phase 5 (terminology). */
  readonly strength: "required";
  /** The complete enumerated code set. */
  readonly codes: readonly string[];
}

/** A resource's direct elements, keyed by element name (the `choice[x]` base for choices). */
export interface ResourceSchema {
  /** The resource type this schema describes (e.g. `"Patient"`). */
  readonly type: string;
  /** Direct elements by name. The base-resource elements are merged in by the registry. */
  readonly elements: Readonly<Record<string, ElementSchema>>;
}

/**
 * Whether an element is a `choice[x]` (more than one allowed datatype).
 *
 * @param element - An element schema.
 * @returns `true` when the element allows more than one datatype.
 * @example
 * ```ts
 * import { isChoice } from "@cosyte/fhir";
 * isChoice({ min: 0, max: 1, types: ["boolean", "dateTime"] }); // true
 * ```
 */
export function isChoice(element: ElementSchema): boolean {
  return element.types.length > 1;
}

/**
 * The direct elements shared by every resource: `Resource` (`id`, `meta`, `implicitRules`,
 * `language`) plus `DomainResource` (`text`, `contained`, `extension`, `modifierExtension`). All are
 * optional in the base definitions. `language` binds to CommonLanguages at *preferred* strength in
 * R4 — **not** required — so it is not enumerated here (terminology binding is Phase 5).
 * *(resource.html, domainresource.html)*
 */
const BASE_ELEMENTS: Readonly<Record<string, ElementSchema>> = {
  id: { min: 0, max: 1, types: ["id"] },
  meta: { min: 0, max: 1, types: ["Meta"] },
  implicitRules: { min: 0, max: 1, types: ["uri"] },
  language: { min: 0, max: 1, types: ["code"] },
  text: { min: 0, max: 1, types: ["Narrative"] },
  contained: { min: 0, max: UNBOUNDED, types: ["Resource"] },
  extension: { min: 0, max: UNBOUNDED, types: ["Extension"] },
  modifierExtension: { min: 0, max: UNBOUNDED, types: ["Extension"] },
};

/** R4 `AdministrativeGender` — the required binding on `Patient.gender`. *(patient.html)* */
const ADMINISTRATIVE_GENDER = ["male", "female", "other", "unknown"] as const;

/**
 * `Patient` direct elements, from the R4 base StructureDefinition (patient.html). All are optional in
 * base R4 (Patient has no mandatory direct element). `gender` carries the one required binding.
 * `deceased[x]` and `multipleBirth[x]` are `choice[x]` elements. Complex-typed elements are checked
 * for cardinality and node shape only in Phase 2.
 */
const PATIENT_ELEMENTS: Readonly<Record<string, ElementSchema>> = {
  identifier: { min: 0, max: UNBOUNDED, types: ["Identifier"] },
  active: { min: 0, max: 1, types: ["boolean"] },
  name: { min: 0, max: UNBOUNDED, types: ["HumanName"] },
  telecom: { min: 0, max: UNBOUNDED, types: ["ContactPoint"] },
  gender: {
    min: 0,
    max: 1,
    types: ["code"],
    binding: { strength: "required", codes: [...ADMINISTRATIVE_GENDER] },
  },
  birthDate: { min: 0, max: 1, types: ["date"] },
  deceased: { min: 0, max: 1, types: ["boolean", "dateTime"] },
  address: { min: 0, max: UNBOUNDED, types: ["Address"] },
  maritalStatus: { min: 0, max: 1, types: ["CodeableConcept"] },
  multipleBirth: { min: 0, max: 1, types: ["boolean", "integer"] },
  photo: { min: 0, max: UNBOUNDED, types: ["Attachment"] },
  contact: { min: 0, max: UNBOUNDED, types: ["BackboneElement"] },
  communication: { min: 0, max: UNBOUNDED, types: ["BackboneElement"] },
  generalPractitioner: { min: 0, max: UNBOUNDED, types: ["Reference"] },
  managingOrganization: { min: 0, max: 1, types: ["Reference"] },
  link: { min: 0, max: UNBOUNDED, types: ["BackboneElement"] },
};

/** The built-in schemas that ship in Phase 2 (base elements are merged into each). */
const BUILTIN_SCHEMAS: readonly ResourceSchema[] = [
  { type: "Patient", elements: PATIENT_ELEMENTS },
];

/**
 * A resolver from a resource type name to its {@link ResourceSchema} (base elements merged in), or
 * `undefined` when the type is not modeled. Built by {@link buildRegistry}.
 */
export type SchemaRegistry = (resourceType: string) => ResourceSchema | undefined;

/** Merge base-resource elements under a resource's own (own elements win on a name clash). */
function withBase(schema: ResourceSchema): ResourceSchema {
  return { type: schema.type, elements: { ...BASE_ELEMENTS, ...schema.elements } };
}

/**
 * A base-elements-only schema for a resource type — the universally-true `Resource` /
 * `DomainResource` elements, and nothing resource-specific. Used to validate a resource whose type
 * is not modeled in Phase 2 **without** emitting false "unknown element" findings for its own
 * (unmodeled) elements — the safe degrade.
 *
 * @param type - The resource type name.
 * @returns A schema carrying only the base elements.
 * @example
 * ```ts
 * import { baseSchema } from "@cosyte/fhir";
 * baseSchema("Device").elements.id; // { min: 0, max: 1, types: ["id"] }
 * ```
 */
export function baseSchema(type: string): ResourceSchema {
  return { type, elements: BASE_ELEMENTS };
}

/**
 * Build a {@link SchemaRegistry} from the built-in schemas plus any caller-supplied ones. A
 * caller schema for a type replaces the built-in for that type (so a consumer can, for example,
 * provide a resource type Phase 2 does not ship). Base elements are always merged in.
 *
 * @param extra - Additional resource schemas to register (override built-ins by type).
 * @returns A resolver from resource type to its merged schema.
 * @example
 * ```ts
 * import { buildRegistry } from "@cosyte/fhir";
 * const registry = buildRegistry();
 * registry("Patient"); // the built-in Patient schema, base elements merged in
 * registry("Device");  // undefined — not modeled in Phase 2
 * ```
 */
export function buildRegistry(extra: readonly ResourceSchema[] = []): SchemaRegistry {
  const byType = new Map<string, ResourceSchema>();
  for (const schema of BUILTIN_SCHEMAS) byType.set(schema.type, withBase(schema));
  for (const schema of extra) byType.set(schema.type, withBase(schema));
  return (resourceType: string): ResourceSchema | undefined => byType.get(resourceType);
}

/**
 * Resolve an instance property name against a schema, honoring `choice[x]`. A plain element matches
 * by exact name; a choice element `deceased` (types `boolean | dateTime`) matches the instance
 * property `deceasedBoolean` or `deceasedDateTime`, returning which variant datatype was chosen.
 *
 * @param elements - The resource's elements.
 * @param property - The instance property name.
 * @returns The matched element and (for a choice) the chosen datatype and the choice base name, or
 *   `undefined` when nothing matches.
 * @example
 * ```ts
 * import { resolveElement } from "@cosyte/fhir";
 * const elements = { deceased: { min: 0, max: 1, types: ["boolean", "dateTime"] } };
 * resolveElement(elements, "deceasedBoolean")?.datatype; // "boolean"
 * ```
 */
export function resolveElement(
  elements: Readonly<Record<string, ElementSchema>>,
  property: string,
):
  | { readonly element: ElementSchema; readonly datatype: string; readonly base: string }
  | undefined {
  // `Object.hasOwn` guard, not a bare `elements[property]`: a resource property literally named
  // `constructor` / `toString` / `valueOf` / `hasOwnProperty` would otherwise read an inherited
  // `Object.prototype` member (a `Function`, not an `ElementSchema`) and crash `isChoice` on its
  // absent `.types`. An adversarial resource must not be able to fault the validator. Own-property only.
  const direct = Object.hasOwn(elements, property) ? elements[property] : undefined;
  if (direct !== undefined && !isChoice(direct)) {
    return { element: direct, datatype: direct.types[0] ?? "", base: property };
  }
  // A choice[x]: find a `<base>` whose `<base><Type>` matches the property.
  for (const [base, element] of Object.entries(elements)) {
    if (!isChoice(element)) continue;
    for (const datatype of element.types) {
      const variant = base + datatype.charAt(0).toUpperCase() + datatype.slice(1);
      if (variant === property) return { element, datatype, base };
    }
  }
  return undefined;
}
