/**
 * The layered structural / cardinality / value-domain validator (Phase 2, validation layers 1–3).
 *
 * Given a resource model (from `parseResource`) and a schema ({@link ./schema.js}), the validator
 * walks the resource once and produces value-free {@link ValidationIssue}s across three layers:
 *
 * 1. **Structure**, an element the resource's schema does not define is `UNKNOWN_ELEMENT`; a resource
 *    with no `resourceType` is `RESOURCE_TYPE_UNKNOWN`; a `choice[x]` with more than one variant is
 *    `CHOICE_AMBIGUOUS`; a node whose shape does not match its datatype is `TYPE_MISMATCH`.
 * 2. **Cardinality**, a required element (min ≥ 1) that is absent is `CARDINALITY_MIN`; an element
 *    appearing more than its max is `CARDINALITY_MAX`.
 * 3. **Value-domain**, a primitive whose lexical form fails its datatype pattern is
 *    `PRIMITIVE_INVALID`; a `code` outside a required-strength binding is `CODE_INVALID`.
 *
 * **Lenient vs strict (Postel's Law).** The only mode-sensitive rule is the unknown element: in
 * `"lenient"` (the read default) it is a `warning`, the codec preserved it, and a consumer may want
 * to know, while in `"strict"` (the emit posture) it is an `error`. Every other finding is an error
 * regardless of mode. **Fail-safe:** the validator never rejects a whole resource for one recoverable
 * field, and it **never emits a false error**, a resource type it has no schema for degrades to a
 * single informational `RESOURCE_NOT_MODELED` (its own elements are left unchecked rather than
 * wrongly flagged), and complex datatype internals are left to Phase 6 rather than guessed at.
 *
 * **Not in Phase 2:** terminology binding beyond required-code enumeration (Phase 5), profile /
 * slicing / must-support (Phase 6), FHIRPath invariants (Phase 7). The built-in schema set is base
 * elements + `Patient`; other resource types validate only when the caller supplies a schema.
 *
 * @packageDocumentation
 */

import {
  isComplex,
  isList,
  resourceType,
  type FhirComplex,
  type FhirNode,
} from "../model/index.js";
import { toOperationOutcome } from "./operation-outcome.js";
import { isPrimitiveType, validatePrimitiveValue } from "./primitives.js";
import { collectBundleIssues } from "./bundle.js";
import { collectQuantityIssues } from "./quantity.js";
import { collectSafetyIssues } from "./safety.js";
import { collectTerminologyIssues } from "./terminology.js";
import { collectProfileIssues, collectProfileVersionIssues } from "../profiles/validate-profile.js";
import { collectInvariantIssues } from "../profiles/invariants.js";
import type { BaseResolver } from "../profiles/snapshot.js";
import type { StructureDefinition } from "../profiles/structure-definition.js";
import type { TerminologyBinding } from "../terminology/bindings.js";
import type { TerminologyService } from "../terminology/service.js";
import {
  baseSchema,
  buildRegistry,
  isChoice,
  resolveElement,
  type ElementSchema,
  type ResourceSchema,
} from "./schema.js";
import {
  ISSUE_SEVERITIES,
  validationIssue,
  type ValidationCode,
  type ValidationIssue,
  type ValidationSeverity,
} from "./issues.js";

/** How strictly to read: `"lenient"` (warn + preserve unknowns) or `"strict"` (unknowns error). */
export type ValidationMode = "lenient" | "strict";

/** Options for {@link validateResource}. */
export interface ValidateOptions {
  /** Lenient (read, the default) or strict (emit). Only affects the severity of unknown elements. */
  readonly mode?: ValidationMode;
  /** Extra resource schemas, overriding the built-ins by type (Phase 6 feeds these). */
  readonly schemas?: readonly ResourceSchema[];
  /**
   * A pluggable terminology service for value-set membership (Phase 5). **None is bundled**; without
   * one, terminology binding checks degrade to the content-free system checks and never false-error.
   */
  readonly terminology?: TerminologyService;
  /** Extra terminology bindings, overriding the built-ins by element path (Phase 5 / Phase 6). */
  readonly bindings?: readonly TerminologyBinding[];
  /**
   * Profiles (`StructureDefinition`s) to validate against (Phase 6). **None is bundled**, a caller
   * supplies the US Core (or vendor) profiles. Every supplied profile whose `type` matches the
   * resource type is applied (fixed/pattern, must-support, slicing, profile cardinality), and the
   * resource's `meta.profile` version pins are checked against the supplied set.
   */
  readonly profiles?: readonly StructureDefinition[];
  /**
   * A resolver from a `baseDefinition` canonical URL to a loaded `StructureDefinition`, used only to
   * generate a snapshot for a supplied profile that carries a differential but no snapshot (Phase 6).
   */
  readonly resolveBase?: BaseResolver;
}

/** The result of validating a resource: the findings plus an `OperationOutcome` view of them. */
export interface ValidationResult {
  /** The value-free findings, in document order. Empty when the resource validated clean. */
  readonly issues: readonly ValidationIssue[];
  /** Whether there were no `error`/`fatal` findings (warnings and information do not fail). */
  readonly valid: boolean;
  /** Render the findings as an `OperationOutcome` resource model (value-free, serializable). */
  toOperationOutcome: () => FhirComplex;
}

/** The severity a code carries in a given mode (only the unknown element varies by mode). */
function severityFor(code: ValidationCode, mode: ValidationMode): ValidationSeverity {
  if (code === "UNKNOWN_ELEMENT") {
    return mode === "strict" ? ISSUE_SEVERITIES.ERROR : ISSUE_SEVERITIES.WARNING;
  }
  if (code === "RESOURCE_NOT_MODELED") return ISSUE_SEVERITIES.INFORMATION;
  return ISSUE_SEVERITIES.ERROR;
}

/** Accumulator threaded through the walk so factories stay value-free and mode-aware. */
interface Ctx {
  readonly mode: ValidationMode;
  readonly issues: ValidationIssue[];
}

function emit(ctx: Ctx, code: ValidationCode, expression: string): void {
  ctx.issues.push(validationIssue(code, severityFor(code, ctx.mode), expression));
}

/** The occurrences of an element node as (leaf, path) pairs, one for a singleton, N for a list. */
function occurrences(
  node: FhirNode,
  path: string,
): { readonly leaf: FhirNode; readonly path: string }[] {
  if (isList(node)) {
    return node.items.map((leaf, i) => ({ leaf, path: `${path}[${String(i)}]` }));
  }
  return [{ leaf: node, path }];
}

/** Validate one occurrence's datatype / value-domain against the element's declared datatype. */
function checkLeaf(
  ctx: Ctx,
  leaf: FhirNode,
  datatype: string,
  element: ElementSchema,
  path: string,
): void {
  const primitiveExpected = isPrimitiveType(datatype);

  if (isComplex(leaf)) {
    // A primitive datatype cannot be an object; a complex datatype's internals are Phase 6.
    if (primitiveExpected) emit(ctx, "TYPE_MISMATCH", path);
    return;
  }
  if (isList(leaf)) {
    // A nested list where a single element belongs, recurse into its items.
    for (const inner of occurrences(leaf, path))
      checkLeaf(ctx, inner.leaf, datatype, element, inner.path);
    return;
  }

  // leaf is a primitive.
  if (!primitiveExpected) {
    // A complex datatype (e.g. HumanName) cannot be a bare primitive.
    emit(ctx, "TYPE_MISMATCH", path);
    return;
  }
  if (leaf.value === undefined) return; // metadata-only primitive (extension without a value), nothing to check.

  const verdict = validatePrimitiveValue(leaf.value, datatype);
  if (verdict === "type-mismatch") emit(ctx, "TYPE_MISMATCH", path);
  else if (verdict === "invalid") emit(ctx, "PRIMITIVE_INVALID", path);

  // Required-strength enumerated code binding (Phase 2 enforces `required` only).
  if (
    verdict === "ok" &&
    datatype === "code" &&
    element.binding !== undefined &&
    typeof leaf.value === "string" &&
    !element.binding.codes.includes(leaf.value)
  ) {
    emit(ctx, "CODE_INVALID", path);
  }
}

/**
 * Validate a FHIR resource model against structural, cardinality, and value-domain rules.
 *
 * @param resource - A resource model (typically from `parseResource`).
 * @param options - Mode and extra schemas.
 * @returns The value-free {@link ValidationResult}.
 * @example
 * ```ts
 * import { parseResource, validateResource } from "@cosyte/fhir";
 * const { resource } = parseResource('{"resourceType":"Patient","gender":"masculine"}');
 * const { issues } = validateResource(resource); // → one CODE_INVALID at Patient.gender
 * ```
 */
export function validateResource(
  resource: FhirComplex,
  options: ValidateOptions = {},
): ValidationResult {
  const mode: ValidationMode = options.mode ?? "lenient";
  const ctx: Ctx = { mode, issues: [] };

  const rt = resourceType(resource);
  if (rt === undefined || rt === "") {
    emit(ctx, "RESOURCE_TYPE_UNKNOWN", "$this");
    return finalize(ctx);
  }

  const registry = buildRegistry(options.schemas ?? []);
  const modeled = registry(rt);
  const schema = modeled ?? baseSchema(rt);
  if (modeled === undefined) emit(ctx, "RESOURCE_NOT_MODELED", rt);

  // Layer 1 + 2 (max) + 3: a single ordered pass over the resource's own properties.
  const counts = new Map<string, number>();
  const choiceVariants = new Map<string, Set<string>>();

  for (const property of resource.properties) {
    if (property.name === "resourceType") continue;
    const path = `${rt}.${property.name}`;
    const match = resolveElement(schema.elements, property.name);

    if (match === undefined) {
      // Unmodeled resource: leave its own elements unchecked (safe degrade, no false error).
      if (modeled !== undefined) emit(ctx, "UNKNOWN_ELEMENT", path);
      continue;
    }

    const { element, datatype, base } = match;
    const occ = occurrences(property.value, path);
    // `counts` accumulates across a choice's variants so a choice with any variant present satisfies
    // its min. The max check is per-property (this variant's own occurrences): a two-variant choice
    // is one logical problem, reported once as CHOICE_AMBIGUOUS below rather than also as a spurious
    // CARDINALITY_MAX; a single variant repeated as an array is still a real max violation.
    counts.set(base, (counts.get(base) ?? 0) + occ.length);

    if (isChoice(element)) {
      const seen = choiceVariants.get(base) ?? new Set<string>();
      seen.add(property.name);
      choiceVariants.set(base, seen);
    }

    if (occ.length > element.max) emit(ctx, "CARDINALITY_MAX", path);
    for (const { leaf, path: leafPath } of occ) checkLeaf(ctx, leaf, datatype, element, leafPath);
  }

  // A choice[x] with more than one variant present is ambiguous (structure).
  for (const [base, seen] of choiceVariants) {
    if (seen.size > 1) emit(ctx, "CHOICE_AMBIGUOUS", `${rt}.${base}[x]`);
  }

  // Layer 2 (min): a required element that never appeared.
  for (const [name, element] of Object.entries(schema.elements)) {
    if (element.min >= 1 && (counts.get(name) ?? 0) < element.min) {
      const suffix = isChoice(element) ? `${name}[x]` : name;
      emit(ctx, "CARDINALITY_MIN", `${rt}.${suffix}`);
    }
  }

  // Safety layer (Phase 3): fail-closed modifier extensions (every type), retraction, and the named
  // status/negation invariants (the six safety types). Independent of the structural schema above,
  // it keys off `resourceType` and the modifier elements directly, so it runs even for types the
  // Phase-2 schema does not model.
  for (const issue of collectSafetyIssues(resource, rt)) ctx.issues.push(issue);

  // Quantity / UCUM layer (Phase 4): value[x] type discrimination, UCUM code shape, vital-signs
  // required-unit conformance, and dose quantities. Like the safety layer it keys off the resource
  // model directly (independent of the Phase-2 structural schema).
  for (const issue of collectQuantityIssues(resource, rt)) ctx.issues.push(issue);

  // Bundle-integrity layer (Phase 9): for a Bundle, fullUrl↔id agreement, unresolved references, and
  // the DoS-safe contained-cycle guard. Keys off the resource type, like the layers around it.
  if (rt === "Bundle") {
    for (const issue of collectBundleIssues(resource)) ctx.issues.push(issue);
  }

  // Terminology binding layer (Phase 5): strength-aware, content-free system checks on bound codings,
  // plus value-set membership when a terminology service is supplied. Degrades to warnings (never a
  // false error) with no service. Also keys off the resource model directly.
  // `options` is a superset of TerminologyOptions (it also carries `mode`/`schemas`), so it satisfies
  // the layer's contract directly, avoids re-spreading optional fields under exactOptionalPropertyTypes.
  for (const issue of collectTerminologyIssues(resource, rt, options)) ctx.issues.push(issue);

  // Profile layer (Phase 6): validate against each supplied StructureDefinition whose `type` matches
  // (fixed/pattern, must-support-as-obligation, profile cardinality, slicing), plus the resource's
  // `meta.profile` version pins against the supplied set. No profile content is bundled, a caller
  // supplies US Core (or vendor) profiles, exactly as the terminology layer takes a service.
  if (options.profiles !== undefined && options.profiles.length > 0) {
    const profileOptions =
      options.resolveBase === undefined ? {} : { resolve: options.resolveBase };
    for (const profile of options.profiles) {
      if (profile.type !== rt) continue;
      for (const issue of collectProfileIssues(resource, profile, profileOptions)) {
        ctx.issues.push(issue);
      }
      // Invariant layer (Phase 7): evaluate the profile's FHIRPath `constraint`s via the bounded
      // engine. An unevaluable expression is surfaced INVARIANT_UNCHECKED (never a silent pass); the
      // seven named safety invariants are left to the always-on Phase-3 safety layer.
      for (const issue of collectInvariantIssues(resource, profile, profileOptions)) {
        ctx.issues.push(issue);
      }
    }
    for (const issue of collectProfileVersionIssues(resource, options.profiles)) {
      ctx.issues.push(issue);
    }
  }

  return finalize(ctx);
}

/** Freeze the accumulator into an immutable {@link ValidationResult}. */
function finalize(ctx: Ctx): ValidationResult {
  const issues: readonly ValidationIssue[] = [...ctx.issues];
  const valid = !issues.some(
    (i) => i.severity === ISSUE_SEVERITIES.ERROR || i.severity === ISSUE_SEVERITIES.FATAL,
  );
  return { issues, valid, toOperationOutcome: () => toOperationOutcome(issues) };
}
