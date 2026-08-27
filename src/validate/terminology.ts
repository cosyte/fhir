/**
 * The terminology binding validation layer (strength-aware and content-free).
 *
 * Layered on the structural, safety, and quantity validators, this checks the codes on **bound**
 * elements, an element the
 * binding registry ({@link ../terminology/bindings.js}) maps to a value set, for two kinds of
 * problem, at a severity that follows the binding **strength**:
 *
 * 1. **System (content-free, no service needed).** A bound coding's `system` is checked against the
 *    binding's known systems and the frozen {@link ../terminology/systems.js known-systems registry}:
 *    - a system the binding's value set does **not** draw from is `CODE_SYSTEM_UNEXPECTED`, an
 *      `error` for a `required` binding, a `warning` for `extensible`/`preferred` (a code from another
 *      system may be a legitimate extension), nothing for `example`;
 *    - a system not in the registry at all is `CODE_SYSTEM_UNKNOWN` (`information`), an unrecognized
 *      (perhaps local) system is not a defect; the library just cannot validate its codes.
 * 2. **Membership (needs a terminology service).** When a {@link ../terminology/service.js
 *    TerminologyService} is supplied and the system is one the binding expects, the coding is checked
 *    for value-set membership. A definitive `not-in` is `CODE_NOT_IN_VALUESET` at the strength's
 *    severity (`required`/`extensible` → `error`, `preferred` → `warning`, `example` →
 *    `information`). An `"unknown"` answer, or **no service at all**, emits nothing: the layer
 *    degrades to the content-free system checks and never invents a false "not a member" error
 *    (fail-safe).
 *
 * **example never errors.** An `example`-strength binding is illustrative; a non-member is
 * `information` at most and a wrong system draws nothing, rebinding an example code can never fail
 * validation.
 *
 * **The membership finding records which code-system release the answer was made against.** A
 * service may declare one per answer ({@link ../terminology/service.js}
 * `CodeValidationResult.systemVersion`); it is carried verbatim onto the finding, and an answer that
 * declares none is marked **undeclared** rather than left silent, so a `not-in` never reads as a
 * timeless fact when it is really an answer against one release. The record is the caller's
 * assertion and nothing else: **the resource's own `Coding.version` is never read**, by this layer
 * or any other, because it is document content and a finding is not a place to put document content.
 *
 * Every finding is **value-free**: a code / severity / FHIRPath location, never a code value or a
 * resource value. The value-set identity is used only to call the service, never emitted.
 *
 * @packageDocumentation
 */

import {
  childPath,
  getProperty,
  isComplex,
  isList,
  rootPath,
  type FhirComplex,
  type FhirNode,
} from "../model/index.js";
import { primitiveString } from "../safety/codes.js";
import {
  buildBindingRegistry,
  type BindingStrength,
  type TerminologyBinding,
} from "../terminology/bindings.js";
import type { CodeValidationResult, TerminologyService } from "../terminology/service.js";
import { isKnownSystem } from "../terminology/systems.js";
import {
  ISSUE_SEVERITIES,
  validationIssue,
  type CodeSystemVersionRecord,
  type ValidationIssue,
  type ValidationSeverity,
} from "./issues.js";

/** Terminology inputs to {@link collectTerminologyIssues}, both optional (both degrade cleanly). */
export interface TerminologyOptions {
  /**
   * A pluggable terminology service for value-set membership. **None is bundled**; with none
   * supplied, membership checks are skipped and the layer degrades to the content-free system checks.
   */
  readonly terminology?: TerminologyService;
  /** Extra element bindings, overriding the built-ins by path (profiles feed these). */
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
 * // Extensible binding (RxNorm + SNOMED), ICD-10-CM is a known but unexpected system → one warning.
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

  // The binding registry is keyed on the spec's own element paths, so the lookup uses the name the
  // document wrote. `root` is the bounded form, and it is the only one that reaches an `expression`.
  // Defensive rather than load-bearing: `root` is only observable once a binding matched, which
  // requires `rt` to be a real FHIR type, so here the bound is provably the identity. It stays so a
  // future binding that keys on something looser cannot reintroduce the echo.
  const root = rootPath(rt);
  for (const property of resource.properties) {
    if (property.name === "resourceType") continue;
    const binding = registry(`${rt}.${property.name}`);
    if (binding === undefined) continue;
    for (const coding of locatedCodings(property.value, childPath(root, property.name))) {
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
    // `system` and `code` are the whole read, and that is deliberate. A `Coding.version` element
    // beside them is the sender's claim about the release THEIR code was drawn from, i.e. document
    // content, and the only release a finding may record is the one the caller's own service
    // declared. Reading it here would put an instance value onto a finding, which is the one thing
    // the value-free contract forbids. Do not add it, and do not pass it to the service either.
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
  // A systemless coding cannot be reasoned about (system is what identifies the code system), no
  // terminology finding (a bare code is a structural oddity for other layers, never a false error).
  if (system === undefined) return;

  const expectedSystem = binding.systems === undefined || binding.systems.includes(system);
  if (!expectedSystem) {
    if (isKnownSystem(system)) {
      // A known system the value set does not draw from, strength-scaled, never for `example`.
      const severity = systemUnexpectedSeverity(binding.strength);
      if (severity !== undefined) {
        issues.push(validationIssue("CODE_SYSTEM_UNEXPECTED", severity, `${path}.system`));
      }
    } else {
      // An unrecognized system, informational only; codes from it cannot be validated.
      issues.push(
        validationIssue("CODE_SYSTEM_UNKNOWN", ISSUE_SEVERITIES.INFORMATION, `${path}.system`),
      );
    }
    return; // A wrong/unknown system is decided; do not also ask a service about membership.
  }

  // The binding declares no closed system set and the system is unrecognized, cannot validate.
  if (binding.systems === undefined && !isKnownSystem(system)) {
    issues.push(
      validationIssue("CODE_SYSTEM_UNKNOWN", ISSUE_SEVERITIES.INFORMATION, `${path}.system`),
    );
    return;
  }

  // System is expected (or a known system under a system-less binding): ask the service, if any.
  if (service === undefined || code === undefined) return;
  const answer = service.validateCode({ valueSet: binding.valueSet, system, code });
  // "in" or "unknown" → nothing, and no release record either (fail-safe: never guess). A declared
  // release on such an answer is discarded with the answer; there is no finding to hang it on.
  if (answer.membership !== "not-in") return;
  const severity = notInSeverity(binding.strength);
  if (severity !== undefined) {
    issues.push(
      validationIssue("CODE_NOT_IN_VALUESET", severity, path, undefined, declaredRelease(answer)),
    );
  }
}

/**
 * Read the code-system release a service declared its answer was made against.
 *
 * The declaration is the service's own assertion and is preserved **exactly**: the string is not
 * trimmed, case-folded, parsed or truncated, so `"  2026-08-04  "` is recorded with its spaces
 * intact. Trimming happens only to decide whether anything was declared **at all**.
 *
 * Everything that is not a non-blank string is the **undeclared** case, and it is marked rather than
 * omitted: absent, a blank or whitespace-only string, and (reachable only from untyped JavaScript,
 * which the interface's types cannot bind) a value of some other type entirely. It never throws, it
 * never records an empty release, and it never substitutes a default, latest or "current" release,
 * because the library holds no code-system content from which any of those could be derived and
 * would be inventing currency the service never claimed.
 */
function declaredRelease(answer: CodeValidationResult): CodeSystemVersionRecord {
  const declared: unknown = answer.systemVersion;
  if (typeof declared !== "string" || declared.trim() === "") return { declared: false };
  return { declared: true, version: declared };
}

/**
 * Severity for a **known** coding system that is not one the binding's value set draws from
 * (content-free). `required` → `error` (the value set is a closed system set, so a foreign system is
 * definitively not a member); `extensible`/`preferred` → `warning` (a different system may be a
 * justified extension, degrade, never false-error); `example` → none.
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
 * `required`/`extensible` → `error` (required→error, extensible→error-unless); `preferred`
 * → `warning`; `example` → `information` (illustrative only, never an error).
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
