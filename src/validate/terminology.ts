/**
 * The terminology binding validation layer (Phase 5, strength-aware and content-free).
 *
 * Layered on the Phase-2/3/4 validators, this checks the codes on **bound** elements — an element the
 * binding registry ({@link ../terminology/bindings.js}) maps to a value set — for two kinds of
 * problem, at a severity that follows the binding **strength**:
 *
 * 1. **System (content-free, no service needed).** A bound coding's `system` is checked against the
 *    binding's known systems and the frozen {@link ../terminology/systems.js known-systems registry}:
 *    - a system the binding's value set does **not** draw from is `CODE_SYSTEM_UNEXPECTED` — an
 *      `error` for a `required` binding, a `warning` for `extensible`/`preferred` (a code from another
 *      system may be a legitimate extension), nothing for `example`;
 *    - a system not in the registry at all is `CODE_SYSTEM_UNKNOWN` (`information`) — an unrecognized
 *      (perhaps local) system is not a defect; the library just cannot validate its codes.
 * 2. **Membership (needs a terminology service).** When a {@link ../terminology/service.js
 *    TerminologyService} is supplied and the system is one the binding expects, the coding is checked
 *    for value-set membership. A definitive `not-in` is `CODE_NOT_IN_VALUESET` at the strength's
 *    severity (`required`/`extensible` → `error`, `preferred` → `warning`, `example` →
 *    `information`). An `"unknown"` answer — or **no service at all** — emits nothing: the layer
 *    degrades to the content-free system checks and never invents a false "not a member" error
 *    (roadmap §5 fail-safe).
 *
 * **example never errors.** An `example`-strength binding is illustrative; a non-member is
 * `information` at most and a wrong system draws nothing — rebinding an example code can never fail
 * validation (roadmap §6).
 *
 * Every finding is **value-free**: a code / severity / FHIRPath location, never a code value or a
 * resource value. The value-set identity is used only to call the service, never emitted.
 *
 * @packageDocumentation
 */

import { getProperty, isComplex, isList, type FhirComplex, type FhirNode } from "../model/index.js";
import { primitiveString } from "../safety/codes.js";
import {
  buildBindingRegistry,
  type BindingStrength,
  type TerminologyBinding,
} from "../terminology/bindings.js";
import type { TerminologyService } from "../terminology/service.js";
import { isKnownSystem } from "../terminology/systems.js";
import {
  ISSUE_SEVERITIES,
  validationIssue,
  type ValidationIssue,
  type ValidationSeverity,
} from "./issues.js";

/** Terminology inputs to {@link collectTerminologyIssues} — both optional (both degrade cleanly). */
export interface TerminologyOptions {
  /**
   * A pluggable terminology service for value-set membership. **None is bundled**; with none
   * supplied, membership checks are skipped and the layer degrades to the content-free system checks.
   */
  readonly terminology?: TerminologyService;
  /** Extra element bindings, overriding the built-ins by path (Phase 6 profiles feed these). */
  readonly bindings?: readonly TerminologyBinding[];
}

/** One coding read out of a `CodeableConcept`, with its value-free FHIRPath location. */
interface LocatedCoding {
  readonly system: string | undefined;
  readonly code: string | undefined;
  readonly path: string;
}

/**
 * Collect every terminology binding finding for a resource: content-free system checks on each bound
 * coding, plus value-set membership when a terminology service is supplied.
 *
 * @param resource - The resource model.
 * @param rt - Its resolved `resourceType`.
 * @param options - The optional terminology service and extra bindings.
 * @returns The value-free terminology {@link ValidationIssue}s, in document order.
 * @example
 * ```ts
 * import { collectTerminologyIssues, parseResource } from "@cosyte/fhir";
 * const { resource } = parseResource(
 *   '{"resourceType":"AllergyIntolerance",' +
 *     '"code":{"coding":[{"system":"http://hl7.org/fhir/sid/icd-10-cm","code":"T78.40XA"}]}}',
 * );
 * // Extensible binding (RxNorm + SNOMED) — ICD-10-CM is a known but unexpected system → one warning.
 * collectTerminologyIssues(resource, "AllergyIntolerance");
 * ```
 */
export function collectTerminologyIssues(
  resource: FhirComplex,
  rt: string,
  options: TerminologyOptions = {},
): ValidationIssue[] {
  const registry = buildBindingRegistry(options.bindings ?? []);
  const service = options.terminology;
  const issues: ValidationIssue[] = [];

  for (const property of resource.properties) {
    if (property.name === "resourceType") continue;
    const binding = registry(`${rt}.${property.name}`);
    if (binding === undefined) continue;
    for (const coding of locatedCodings(property.value, `${rt}.${property.name}`)) {
      checkCoding(coding, binding, service, issues);
    }
  }
  return issues;
}

/** Read every `Coding` (with its FHIRPath location) out of a `CodeableConcept` node, or a list of them. */
function locatedCodings(node: FhirNode, basePath: string): LocatedCoding[] {
  if (isList(node)) {
    return node.items.flatMap((item, i) => locatedCodings(item, `${basePath}[${String(i)}]`));
  }
  if (!isComplex(node)) return [];
  const coding = getProperty(node, "coding");
  if (coding === undefined) return [];
  const single = !isList(coding);
  const items = isList(coding) ? coding.items : [coding];
  const out: LocatedCoding[] = [];
  items.forEach((item, i) => {
    if (!isComplex(item)) return;
    out.push({
      system: primitiveString(getProperty(item, "system")),
      code: primitiveString(getProperty(item, "code")),
      path: single ? `${basePath}.coding` : `${basePath}.coding[${String(i)}]`,
    });
  });
  return out;
}

/** Check one bound coding: content-free system checks, then service-backed membership. */
function checkCoding(
  coding: LocatedCoding,
  binding: TerminologyBinding,
  service: TerminologyService | undefined,
  issues: ValidationIssue[],
): void {
  const { system, code, path } = coding;
  // A systemless coding cannot be reasoned about (system is what identifies the code system) — no
  // terminology finding (a bare code is a structural oddity for other layers, never a false error).
  if (system === undefined) return;

  const expectedSystem = binding.systems === undefined || binding.systems.includes(system);
  if (!expectedSystem) {
    if (isKnownSystem(system)) {
      // A known system the value set does not draw from — strength-scaled, never for `example`.
      const severity = systemUnexpectedSeverity(binding.strength);
      if (severity !== undefined) {
        issues.push(validationIssue("CODE_SYSTEM_UNEXPECTED", severity, `${path}.system`));
      }
    } else {
      // An unrecognized system — informational only; codes from it cannot be validated.
      issues.push(
        validationIssue("CODE_SYSTEM_UNKNOWN", ISSUE_SEVERITIES.INFORMATION, `${path}.system`),
      );
    }
    return; // A wrong/unknown system is decided; do not also ask a service about membership.
  }

  // The binding declares no closed system set and the system is unrecognized — cannot validate.
  if (binding.systems === undefined && !isKnownSystem(system)) {
    issues.push(
      validationIssue("CODE_SYSTEM_UNKNOWN", ISSUE_SEVERITIES.INFORMATION, `${path}.system`),
    );
    return;
  }

  // System is expected (or a known system under a system-less binding): ask the service, if any.
  if (service === undefined || code === undefined) return;
  const { membership } = service.validateCode({ valueSet: binding.valueSet, system, code });
  if (membership !== "not-in") return; // "in" or "unknown" → nothing (fail-safe: never guess).
  const severity = notInSeverity(binding.strength);
  if (severity !== undefined) {
    issues.push(validationIssue("CODE_NOT_IN_VALUESET", severity, path));
  }
}

/**
 * Severity for a **known** coding system that is not one the binding's value set draws from
 * (content-free). `required` → `error` (the value set is a closed system set, so a foreign system is
 * definitively not a member); `extensible`/`preferred` → `warning` (a different system may be a
 * justified extension — degrade, never false-error); `example` → none.
 */
function systemUnexpectedSeverity(strength: BindingStrength): ValidationSeverity | undefined {
  switch (strength) {
    case "required":
      return ISSUE_SEVERITIES.ERROR;
    case "extensible":
    case "preferred":
      return ISSUE_SEVERITIES.WARNING;
    case "example":
      return undefined;
  }
}

/**
 * Severity for a coding a terminology service reports is **not a member** of the value set.
 * `required`/`extensible` → `error` (roadmap's required→error, extensible→error-unless); `preferred`
 * → `warning`; `example` → `information` (illustrative only — never an error).
 */
function notInSeverity(strength: BindingStrength): ValidationSeverity | undefined {
  switch (strength) {
    case "required":
    case "extensible":
      return ISSUE_SEVERITIES.ERROR;
    case "preferred":
      return ISSUE_SEVERITIES.WARNING;
    case "example":
      return ISSUE_SEVERITIES.INFORMATION;
  }
}
