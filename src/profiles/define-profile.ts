/**
 * `defineProfile()` — author a {@link StructureDefinition} in code (Phase 10, half a: the profile
 * growth loop).
 *
 * The profile engine (Phase 6) validates a resource against a {@link StructureDefinition}. Until now
 * the only way to obtain one was to `parseResource(structureDefinitionJson)` and
 * `loadStructureDefinition()` it — i.e. a caller had to hand-write (or fetch) raw FHIR
 * `StructureDefinition` JSON. `defineProfile()` is the **programmatic authoring** front door: it takes
 * an ergonomic {@link ProfileSpec} and returns the exact same {@link StructureDefinition} object the
 * engine consumes, so a consumer who hits a resource the base does not constrain can write the
 * constraint in TypeScript and feed it straight into `validateResource({ profiles })`.
 *
 * **One public path, no privileged internal shape.** The built-in starter profiles ({@link
 * ./starter-kit.js}) are authored through *this same function* — there is no separate, blessed internal
 * representation for "our" profiles versus a user's. `defineProfile(spec)` is byte-for-byte equivalent
 * to `loadStructureDefinition(parseResource(equivalentJson).resource)` for every valid spec (proven in
 * the test suite): the two authoring routes converge on one model. That equivalence is the whole point
 * of the growth loop — dogfooding the public API keeps it honest.
 *
 * **The writer is conservative (Postel's Law, emit side).** Unlike `loadStructureDefinition` (a
 * lenient *reader* of possibly-messy supplied JSON, which degrades malformed input), `defineProfile` is
 * an *authoring* surface: it throws {@link InvalidProfileError} on an author mistake — a missing `url`
 * / `type` / element `path`, a negative or non-integer cardinality, a `max` below `min` — so the error
 * surfaces at authoring time, not as a silent no-op at validation time. Every message is value-free
 * (profile metadata — URLs, paths, numbers — never instance data).
 *
 * @packageDocumentation
 */

import { UNBOUNDED } from "../validate/schema.js";
import type {
  Derivation,
  ElementBinding,
  ElementConstraint,
  ElementDefinition,
  ElementType,
  Slicing,
  StructureDefinition,
  TypedValue,
} from "./structure-definition.js";

/**
 * Thrown by {@link defineProfile} when a spec is malformed — the conservative-writer guard. The
 * message is value-free: it names profile metadata (a `url`, an element `path`, a cardinality number),
 * never instance data. A profile is not PHI, but the same value-free discipline is kept throughout.
 *
 * @example
 * ```ts
 * import { defineProfile, InvalidProfileError } from "@cosyte/fhir";
 * try {
 *   defineProfile({ url: "", type: "Patient" });
 * } catch (e) {
 *   if (e instanceof InvalidProfileError) console.error(e.message); // "profile url is required"
 * }
 * ```
 */
export class InvalidProfileError extends Error {
  /**
   * @param message - A value-free description of the authoring error.
   */
  public constructor(message: string) {
    super(message);
    this.name = "InvalidProfileError";
  }
}

/**
 * One `constraint` (invariant) in a {@link ProfileElementSpec}. `severity` defaults to `"error"` (as
 * `loadStructureDefinition` defaults it), mirroring the FHIR `ElementDefinition.constraint` shape.
 */
export interface ProfileConstraintSpec {
  /** The stable invariant key (`us-core-1`, `ait-1`). */
  readonly key: string;
  /** `error` | `warning`; defaults to `"error"` when omitted. */
  readonly severity?: string;
  /** The prose description (spec text, never surfaced in a diagnostic). */
  readonly human?: string;
  /** The FHIRPath expression the Phase-7 engine evaluates. */
  readonly expression: string;
}

/**
 * The ergonomic authoring shape for one element. Mirrors {@link ElementDefinition}, but `max` accepts
 * the author-friendly `"*"` (normalized to {@link UNBOUNDED}) and `constraint` takes
 * {@link ProfileConstraintSpec} (whose `severity` defaults). `id` defaults to `path`; `sliceName` is
 * derived from the id's `:` segment when omitted — exactly as `loadStructureDefinition` does.
 */
export interface ProfileElementSpec {
  /** The dotted element path from the resource root (e.g. `Observation.status`). Required. */
  readonly path: string;
  /** The element id — carries slice names as `:sliceName`. Defaults to `path`. */
  readonly id?: string;
  /** The slice this element defines. Defaults to the id's `:sliceName` segment when present. */
  readonly sliceName?: string;
  /** Minimum cardinality (a non-negative integer). */
  readonly min?: number;
  /** Maximum cardinality: a non-negative integer or `"*"` (→ {@link UNBOUNDED}). */
  readonly max?: number | "*";
  /** Whether the element is flagged must-support (a *system obligation*, not instance-presence). */
  readonly mustSupport?: boolean;
  /** The slicing declaration, when this element introduces slices. */
  readonly slicing?: Slicing;
  /** The allowed types, when the profile constrains them. */
  readonly type?: readonly ElementType[];
  /** A `fixed[x]` equality constraint (a FHIR type name + a model node — build with `complex`/`primitive`/`list`). */
  readonly fixed?: TypedValue;
  /** A `pattern[x]` subset constraint (a FHIR type name + a model node). */
  readonly pattern?: TypedValue;
  /** The element's terminology binding (strength + value-set identity). */
  readonly binding?: ElementBinding;
  /** The element's invariant constraints (Phase 7 FHIRPath). */
  readonly constraint?: readonly ProfileConstraintSpec[];
}

/**
 * The ergonomic authoring shape for a whole profile. Mirrors the modeled slice of a FHIR
 * `StructureDefinition` ({@link StructureDefinition}); `differential` / `snapshot` take
 * {@link ProfileElementSpec}s.
 */
export interface ProfileSpec {
  /** The canonical URL — the identity the profile is referenced by. Required. */
  readonly url: string;
  /** The business version (e.g. `"6.1.0"`), when the profile is versioned. */
  readonly version?: string;
  /** The computer-friendly name. */
  readonly name?: string;
  /** The resource type this profile constrains (e.g. `"Observation"`). Required. */
  readonly type: string;
  /** `resource` | `complex-type` | `primitive-type` | `logical`. */
  readonly kind?: string;
  /** Specialization (a base resource) or constraint (a profile). */
  readonly derivation?: Derivation;
  /** The canonical URL of the definition this one derives from. */
  readonly baseDefinition?: string;
  /** The differential element list (constraints relative to the base). */
  readonly differential?: readonly ProfileElementSpec[];
  /** A pre-resolved snapshot element list (rare in authoring; usually generated from the differential). */
  readonly snapshot?: readonly ProfileElementSpec[];
}

/** The last `:sliceName` segment of an element id, or `undefined` when the id names no slice. */
function sliceNameFromId(id: string): string | undefined {
  const lastDot = id.lastIndexOf(".");
  const tail = lastDot === -1 ? id : id.slice(lastDot + 1);
  const colon = tail.indexOf(":");
  return colon === -1 ? undefined : tail.slice(colon + 1);
}

/** Normalize an author-supplied `max` (`"*"` → {@link UNBOUNDED}, a number verbatim). */
function normalizeMax(max: number | "*"): number {
  if (max === "*") return UNBOUNDED;
  return max;
}

/** Validate + normalize one {@link ProfileConstraintSpec} into an {@link ElementConstraint}. */
function toConstraint(spec: ProfileConstraintSpec, path: string): ElementConstraint {
  if (spec.key === "") throw new InvalidProfileError(`constraint on ${path} is missing a key`);
  if (spec.expression === "") {
    throw new InvalidProfileError(`constraint ${spec.key} on ${path} is missing an expression`);
  }
  const constraint: { -readonly [K in keyof ElementConstraint]: ElementConstraint[K] } = {
    key: spec.key,
    severity: spec.severity ?? "error",
    expression: spec.expression,
  };
  if (spec.human !== undefined) constraint.human = spec.human;
  return constraint;
}

/** Validate + normalize one {@link ProfileElementSpec} into an {@link ElementDefinition}. */
function toElementDefinition(spec: ProfileElementSpec): ElementDefinition {
  if (spec.path === "") throw new InvalidProfileError("every profile element needs a path");
  const id = spec.id ?? spec.path;
  const sliceName = spec.sliceName ?? sliceNameFromId(id);

  if (spec.min !== undefined && (!Number.isInteger(spec.min) || spec.min < 0)) {
    throw new InvalidProfileError(`min on ${spec.path} must be a non-negative integer`);
  }
  let max: number | undefined;
  if (spec.max !== undefined) {
    // A numeric max must be a non-negative integer or {@link UNBOUNDED} (Infinity) — accepting the
    // latter keeps `defineProfile` idempotent on an already-normalized `ElementDefinition` (whose `*`
    // is UNBOUNDED), so re-authoring a loaded profile round-trips.
    if (
      typeof spec.max === "number" &&
      spec.max !== UNBOUNDED &&
      (!Number.isInteger(spec.max) || spec.max < 0)
    ) {
      throw new InvalidProfileError(`max on ${spec.path} must be a non-negative integer or "*"`);
    }
    max = normalizeMax(spec.max);
    if (spec.min !== undefined && max !== UNBOUNDED && max < spec.min) {
      throw new InvalidProfileError(`max on ${spec.path} is below its min`);
    }
  }

  const el: { -readonly [K in keyof ElementDefinition]: ElementDefinition[K] } = {
    path: spec.path,
    id,
  };
  if (sliceName !== undefined) el.sliceName = sliceName;
  if (spec.min !== undefined) el.min = spec.min;
  if (max !== undefined) el.max = max;
  if (spec.mustSupport !== undefined) el.mustSupport = spec.mustSupport;
  if (spec.slicing !== undefined) el.slicing = spec.slicing;
  if (spec.type !== undefined) el.type = spec.type;
  if (spec.fixed !== undefined) el.fixed = spec.fixed;
  if (spec.pattern !== undefined) el.pattern = spec.pattern;
  if (spec.binding !== undefined) el.binding = spec.binding;
  if (spec.constraint !== undefined) {
    el.constraint = spec.constraint.map((c) => toConstraint(c, spec.path));
  }
  return el;
}

/**
 * Author a {@link StructureDefinition} programmatically from an ergonomic {@link ProfileSpec}.
 *
 * The result is the *same* model the profile engine consumes — pass it straight to
 * `validateResource(resource, { profiles: [defineProfile(spec)] })`. It is identical to what
 * `loadStructureDefinition` produces from the equivalent FHIR `StructureDefinition` JSON: one model,
 * two authoring routes.
 *
 * @param spec - The ergonomic profile spec.
 * @returns The modeled {@link StructureDefinition}.
 * @throws InvalidProfileError when the spec is malformed (missing `url`/`type`/element `path`, a bad
 *   cardinality, or a `max` below `min`).
 * @example
 * ```ts
 * import { defineProfile, primitive, validateResource, parseResource } from "@cosyte/fhir";
 * const finalOnly = defineProfile({
 *   url: "http://example.org/StructureDefinition/final-observation",
 *   type: "Observation",
 *   differential: [{ path: "Observation.status", fixed: { type: "Code", value: primitive("final") } }],
 * });
 * const { resource } = parseResource('{"resourceType":"Observation","status":"preliminary"}');
 * validateResource(resource, { profiles: [finalOnly] }); // → one PROFILE_FIXED_MISMATCH
 * ```
 */
export function defineProfile(spec: ProfileSpec): StructureDefinition {
  if (spec.url === "") throw new InvalidProfileError("profile url is required");
  if (spec.type === "") throw new InvalidProfileError("profile type is required");

  const sd: { -readonly [K in keyof StructureDefinition]: StructureDefinition[K] } = {
    url: spec.url,
    type: spec.type,
  };
  if (spec.version !== undefined) sd.version = spec.version;
  if (spec.name !== undefined) sd.name = spec.name;
  if (spec.kind !== undefined) sd.kind = spec.kind;
  if (spec.derivation !== undefined) sd.derivation = spec.derivation;
  if (spec.baseDefinition !== undefined) sd.baseDefinition = spec.baseDefinition;
  if (spec.differential !== undefined) sd.differential = spec.differential.map(toElementDefinition);
  if (spec.snapshot !== undefined) sd.snapshot = spec.snapshot.map(toElementDefinition);
  return sd;
}
