/**
 * The `StructureDefinition` model and loader (Phase 6, the profile engine's front door).
 *
 * A FHIR `StructureDefinition` (profiling.html, structuredefinition.html) is itself a FHIR resource —
 * it describes a resource type or a *profile* (a constrained variant, e.g. a US Core profile) as a
 * list of {@link ElementDefinition}s. This module models the slice of a StructureDefinition the
 * validator needs and reads it out of the generic {@link FhirComplex} model produced by the codec, so
 * a caller can `parseResource(usCoreProfileJson)` and feed the result straight in.
 *
 * **What is modeled** is deliberately the profile-validation surface: identity (`url` / `version` /
 * `type` / `kind` / `derivation` / `baseDefinition`), the `differential` and `snapshot` element lists,
 * and per-element cardinality, `mustSupport`, `type`, `binding`, `slicing`, and the `fixed[x]` /
 * `pattern[x]` constraints. Narrative, mapping, and documentation fields the validator does not act on
 * are ignored (lenient read — an unmodeled field is never an error).
 *
 * **No StructureDefinition content is bundled.** Like the terminology layer (roadmap §5), this ships
 * the *engine*, not the *content*: a caller supplies the US Core (or vendor) StructureDefinitions to
 * validate against. That keeps the package zero-dependency and content-free while still letting a
 * consumer run real US Core conformance by loading the published (CC0) IG profiles.
 *
 * @packageDocumentation
 */

import {
  getProperty,
  isComplex,
  isList,
  isPrimitive,
  type FhirComplex,
  type FhirNode,
} from "../model/index.js";
import { FhirDecimal } from "../model/decimal.js";
import { primitiveBoolean, primitiveString } from "../safety/codes.js";
import { UNBOUNDED } from "../validate/schema.js";

/** `StructureDefinition.derivation` — how a definition relates to its base. */
export type Derivation = "specialization" | "constraint";

/**
 * The R4 discriminator types (`valueset-discriminator-type`) a slicing may use to tell its slices
 * apart. **`position` is R5-only and is deliberately not a member here** (roadmap Phase 6): an R4
 * profile that carries it is treated as an unsupported discriminator, not silently accepted.
 */
export type DiscriminatorType = "value" | "exists" | "pattern" | "type" | "profile";

/** The R4 discriminator types, for iteration / validation. */
export const DISCRIMINATOR_TYPES: readonly DiscriminatorType[] = [
  "value",
  "exists",
  "pattern",
  "type",
  "profile",
];

/** `ElementDefinition.slicing.rules` — whether content outside the named slices is allowed. */
export type SlicingRules = "closed" | "open" | "openAtEnd";

/** One slicing discriminator: how to tell instances of different slices apart. */
export interface Discriminator {
  /** The discriminator kind. A `type` outside {@link DISCRIMINATOR_TYPES} (e.g. R5 `position`) is unsupported. */
  readonly type: string;
  /** The FHIRPath (element path, relative to the sliced element) the discriminator inspects. */
  readonly path: string;
}

/** The slicing declaration on an element that introduces slices. */
export interface Slicing {
  /** The discriminators that distinguish the slices (empty is legal but leaves slices unresolvable). */
  readonly discriminator: readonly Discriminator[];
  /** Whether content outside the defined slices is allowed. Absent defaults to `open` (the R4 default). */
  readonly rules: SlicingRules;
  /** Whether slice order is significant (surfaced but not enforced here). */
  readonly ordered?: boolean;
}

/** A value bound to a `fixed[x]` or `pattern[x]` constraint: the FHIR type name plus the value node. */
export interface TypedValue {
  /** The FHIR datatype suffix, e.g. `"Code"`, `"CodeableConcept"`, `"String"` (as it appears on the property). */
  readonly type: string;
  /** The constraint value, as a model node. */
  readonly value: FhirNode;
}

/** An element's terminology binding (strength + value-set identity) as declared by a profile. */
export interface ElementBinding {
  readonly strength: string;
  readonly valueSet?: string;
}

/** One allowed type for an element (`code` is the datatype; `profile`/`targetProfile` constrain it). */
export interface ElementType {
  readonly code: string;
  readonly profile?: readonly string[];
  readonly targetProfile?: readonly string[];
}

/**
 * The slice of a FHIR `ElementDefinition` the validator acts on. `path` is the dotted element path
 * (e.g. `AllergyIntolerance.clinicalStatus`); `id` additionally encodes slice membership as
 * `path:sliceName` (e.g. `Observation.category:VSCat`).
 */
export interface ElementDefinition {
  /** The dotted element path from the resource root. */
  readonly path: string;
  /** The element id — carries slice names as `:sliceName` segments. Defaults to `path` when absent. */
  readonly id: string;
  /** The slice this element defines, when it is a slice (from `sliceName` or the id's `:` segment). */
  readonly sliceName?: string;
  /** Minimum cardinality, when the definition states one. */
  readonly min?: number;
  /** Maximum cardinality ({@link UNBOUNDED} for `*`), when the definition states one. */
  readonly max?: number;
  /** Whether the element is flagged must-support. */
  readonly mustSupport?: boolean;
  /** The slicing declaration, when this element introduces slices. */
  readonly slicing?: Slicing;
  /** The allowed types, when the definition constrains them. */
  readonly type?: readonly ElementType[];
  /** A `fixed[x]` equality constraint, when present. */
  readonly fixed?: TypedValue;
  /** A `pattern[x]` subset constraint, when present. */
  readonly pattern?: TypedValue;
  /** The element's terminology binding, when the definition states one. */
  readonly binding?: ElementBinding;
}

/** The modeled slice of a FHIR `StructureDefinition`. */
export interface StructureDefinition {
  /** The canonical URL — the identity a profile is referenced by (`meta.profile`, `baseDefinition`). */
  readonly url: string;
  /** The business version, when stated (e.g. US Core `"6.1.0"`). Part of the `canonical|version` key. */
  readonly version?: string;
  /** The computer-friendly name, when stated. */
  readonly name?: string;
  /** The resource type this definition constrains (`StructureDefinition.type`, e.g. `"AllergyIntolerance"`). */
  readonly type: string;
  /** `resource` | `complex-type` | `primitive-type` | `logical`. */
  readonly kind?: string;
  /** Specialization (a base resource) or constraint (a profile). */
  readonly derivation?: Derivation;
  /** The canonical URL of the definition this one derives from. */
  readonly baseDefinition?: string;
  /** The differential element list (constraints relative to the base). */
  readonly differential?: readonly ElementDefinition[];
  /** The fully-resolved snapshot element list, when the definition carries one. */
  readonly snapshot?: readonly ElementDefinition[];
}

/** Parse a FHIR `max` string (`"*"` → {@link UNBOUNDED}, a numeric string → its integer) or `undefined`. */
function parseMax(node: FhirNode | undefined): number | undefined {
  const raw = primitiveString(node);
  if (raw === undefined) return undefined;
  if (raw === "*") return UNBOUNDED;
  const n = Number.parseInt(raw, 10);
  return Number.isNaN(n) ? undefined : n;
}

/**
 * Parse a FHIR `min` (an `unsignedInt` primitive) to a number, or `undefined`. The precision-
 * preserving codec models every JSON number as a {@link FhirDecimal} (ADR 0001), so a well-formed
 * `min` arrives as an integer-valued decimal; a non-integer or non-numeric `min` (malformed input)
 * degrades to `undefined` rather than throwing.
 */
function parseMin(node: FhirNode | undefined): number | undefined {
  if (node === undefined || !isPrimitive(node)) return undefined;
  const { value } = node;
  if (!(value instanceof FhirDecimal)) return undefined;
  try {
    return Number(value.toBigInt());
  } catch {
    return undefined;
  }
}

/** Read a `Discriminator` out of its complex node. */
function readDiscriminator(node: FhirNode): Discriminator | undefined {
  if (!isComplex(node)) return undefined;
  const type = primitiveString(getProperty(node, "type"));
  const path = primitiveString(getProperty(node, "path"));
  if (type === undefined || path === undefined) return undefined;
  return { type, path };
}

/** Read the `slicing` declaration out of an element definition node. */
function readSlicing(node: FhirNode | undefined): Slicing | undefined {
  if (node === undefined || !isComplex(node)) return undefined;
  const discNode = getProperty(node, "discriminator");
  const discItems = discNode === undefined ? [] : isList(discNode) ? discNode.items : [discNode];
  const discriminator: Discriminator[] = [];
  for (const item of discItems) {
    const d = readDiscriminator(item);
    if (d !== undefined) discriminator.push(d);
  }
  const rulesRaw = primitiveString(getProperty(node, "rules"));
  const rules: SlicingRules = rulesRaw === "closed" || rulesRaw === "openAtEnd" ? rulesRaw : "open";
  const ordered = primitiveBoolean(getProperty(node, "ordered"));
  const slicing: Slicing =
    ordered === undefined ? { discriminator, rules } : { discriminator, rules, ordered };
  return slicing;
}

/** Read the allowed `type[]` out of an element definition node. */
function readTypes(node: FhirNode | undefined): readonly ElementType[] | undefined {
  if (node === undefined) return undefined;
  const items = isList(node) ? node.items : [node];
  const types: ElementType[] = [];
  for (const item of items) {
    if (!isComplex(item)) continue;
    const code = primitiveString(getProperty(item, "code"));
    if (code === undefined) continue;
    const profile = readStringList(getProperty(item, "profile"));
    const targetProfile = readStringList(getProperty(item, "targetProfile"));
    const t: { code: string; profile?: readonly string[]; targetProfile?: readonly string[] } = {
      code,
    };
    if (profile !== undefined) t.profile = profile;
    if (targetProfile !== undefined) t.targetProfile = targetProfile;
    types.push(t);
  }
  return types.length === 0 ? undefined : types;
}

/** Read a repeating (or single) primitive-string property into an array, or `undefined` when absent. */
function readStringList(node: FhirNode | undefined): readonly string[] | undefined {
  if (node === undefined) return undefined;
  const items = isList(node) ? node.items : [node];
  const out: string[] = [];
  for (const item of items) {
    const s = primitiveString(item);
    if (s !== undefined) out.push(s);
  }
  return out.length === 0 ? undefined : out;
}

/** Read the `binding` (strength + valueSet) out of an element definition node. */
function readBinding(node: FhirNode | undefined): ElementBinding | undefined {
  if (node === undefined || !isComplex(node)) return undefined;
  const strength = primitiveString(getProperty(node, "strength"));
  if (strength === undefined) return undefined;
  const valueSet = primitiveString(getProperty(node, "valueSet"));
  return valueSet === undefined ? { strength } : { strength, valueSet };
}

/**
 * Find a `fixed[x]` or `pattern[x]` constraint on an element definition node. FHIR spells the type
 * into the property name (`fixedCode`, `patternCodeableConcept`, …), so this scans the properties for
 * one beginning with the given prefix immediately followed by an upper-case type letter.
 */
function readTypedValue(node: FhirComplex, prefix: string): TypedValue | undefined {
  for (const property of node.properties) {
    if (!property.name.startsWith(prefix)) continue;
    const rest = property.name.slice(prefix.length);
    const first = rest.charAt(0);
    if (first >= "A" && first <= "Z") return { type: rest, value: property.value };
  }
  return undefined;
}

/** Read one `ElementDefinition` out of its complex node. */
function readElementDefinition(node: FhirNode): ElementDefinition | undefined {
  if (!isComplex(node)) return undefined;
  const path = primitiveString(getProperty(node, "path"));
  if (path === undefined) return undefined;
  const id = primitiveString(getProperty(node, "id")) ?? path;
  const sliceName = primitiveString(getProperty(node, "sliceName")) ?? sliceNameFromId(id);

  const min = parseMin(getProperty(node, "min"));
  const max = parseMax(getProperty(node, "max"));
  const mustSupport = primitiveBoolean(getProperty(node, "mustSupport"));
  const slicing = readSlicing(getProperty(node, "slicing"));
  const type = readTypes(getProperty(node, "type"));
  const fixed = readTypedValue(node, "fixed");
  const pattern = readTypedValue(node, "pattern");
  const binding = readBinding(getProperty(node, "binding"));

  const el: {
    -readonly [K in keyof ElementDefinition]: ElementDefinition[K];
  } = { path, id };
  if (sliceName !== undefined) el.sliceName = sliceName;
  if (min !== undefined) el.min = min;
  if (max !== undefined) el.max = max;
  if (mustSupport !== undefined) el.mustSupport = mustSupport;
  if (slicing !== undefined) el.slicing = slicing;
  if (type !== undefined) el.type = type;
  if (fixed !== undefined) el.fixed = fixed;
  if (pattern !== undefined) el.pattern = pattern;
  if (binding !== undefined) el.binding = binding;
  return el;
}

/** The last `:sliceName` segment of an element id, or `undefined` when the id names no slice. */
function sliceNameFromId(id: string): string | undefined {
  const lastDot = id.lastIndexOf(".");
  const tail = lastDot === -1 ? id : id.slice(lastDot + 1);
  const colon = tail.indexOf(":");
  return colon === -1 ? undefined : tail.slice(colon + 1);
}

/** Read the element list from a `differential` / `snapshot` sub-node. */
function readElementList(node: FhirNode | undefined): readonly ElementDefinition[] | undefined {
  if (node === undefined || !isComplex(node)) return undefined;
  const elementNode = getProperty(node, "element");
  if (elementNode === undefined) return undefined;
  const items = isList(elementNode) ? elementNode.items : [elementNode];
  const out: ElementDefinition[] = [];
  for (const item of items) {
    const el = readElementDefinition(item);
    if (el !== undefined) out.push(el);
  }
  return out;
}

/**
 * Load a {@link StructureDefinition} out of a parsed FHIR `StructureDefinition` resource model.
 *
 * Reads the identity, derivation, and the `differential` / `snapshot` element lists. Lenient: a field
 * the validator does not act on is ignored, and a malformed sub-node degrades to `undefined` rather
 * than throwing — a profile a consumer supplies is data, and data is read Postel-style.
 *
 * @param resource - A `StructureDefinition` resource model (e.g. from `parseResource`).
 * @returns The modeled {@link StructureDefinition}, or `undefined` when the resource is not one / lacks a `type`.
 * @example
 * ```ts
 * import { parseResource } from "@cosyte/fhir";
 * import { loadStructureDefinition } from "@cosyte/fhir";
 * const { resource } = parseResource(usCoreAllergyProfileJson);
 * const sd = loadStructureDefinition(resource); // → { url, type: "AllergyIntolerance", differential, … }
 * ```
 */
export function loadStructureDefinition(resource: FhirComplex): StructureDefinition | undefined {
  const rt = primitiveString(getProperty(resource, "resourceType"));
  if (rt !== "StructureDefinition") return undefined;
  const url = primitiveString(getProperty(resource, "url"));
  const type = primitiveString(getProperty(resource, "type"));
  if (url === undefined || type === undefined) return undefined;

  const version = primitiveString(getProperty(resource, "version"));
  const name = primitiveString(getProperty(resource, "name"));
  const kind = primitiveString(getProperty(resource, "kind"));
  const derivationRaw = primitiveString(getProperty(resource, "derivation"));
  const derivation: Derivation | undefined =
    derivationRaw === "specialization" || derivationRaw === "constraint"
      ? derivationRaw
      : undefined;
  const baseDefinition = primitiveString(getProperty(resource, "baseDefinition"));
  const differential = readElementList(getProperty(resource, "differential"));
  const snapshot = readElementList(getProperty(resource, "snapshot"));

  const sd: { -readonly [K in keyof StructureDefinition]: StructureDefinition[K] } = { url, type };
  if (version !== undefined) sd.version = version;
  if (name !== undefined) sd.name = name;
  if (kind !== undefined) sd.kind = kind;
  if (derivation !== undefined) sd.derivation = derivation;
  if (baseDefinition !== undefined) sd.baseDefinition = baseDefinition;
  if (differential !== undefined) sd.differential = differential;
  if (snapshot !== undefined) sd.snapshot = snapshot;
  return sd;
}
