/**
 * The Bundle-integrity validation layer (Phase 9) — the findings a `Bundle` earns beyond
 * per-resource validation: unresolved references, `contained` reference cycles, and `fullUrl`↔`id`
 * disagreement. Keys off the resource being a `Bundle`, exactly as the safety / quantity / terminology
 * layers key off the resource type, and is wired into {@link ./validate.js validateResource}.
 *
 * Three value-free findings (all consistent with the P1–P8 diagnostic model):
 *
 * - **`FULLURL_ID_MISMATCH`** (error) — an entry whose `fullUrl` is a RESTful URL (`Type/id`) that
 *   disagrees with the wrapped `resource.id`. A `urn:uuid:` fullUrl constrains nothing, so it is
 *   exempt.
 * - **`REFERENCE_UNRESOLVED`** (warning) — a `#fragment` naming an absent contained resource, or a
 *   relative `Type/id` naming no entry in the Bundle. Never fatal: the reference is preserved, the
 *   target may live outside the Bundle. An absolute/logical reference that is simply external draws
 *   nothing.
 * - **`CONTAINED_CYCLE`** (error) — a resource whose `contained` resources reference each other in a
 *   cycle, caught by the bounded, iterative cycle guard rather than an unbounded resolver loop.
 *
 * Every finding is a FHIRPath *location*, never a value — a resource id, a reference string, and a
 * fullUrl are all kept out of the emitted issue.
 *
 * @packageDocumentation
 */

import type { FhirComplex } from "../model/index.js";
import { parseReference } from "../model/reference.js";
import {
  buildBundleIndex,
  containedIndex,
  eachReference,
  hasContainedCycle,
  resolveReference,
} from "../bundle/references.js";
import { readBundle } from "../bundle/types.js";
import { ISSUE_SEVERITIES, validationIssue, type ValidationIssue } from "./issues.js";

/**
 * Collect the Bundle-integrity findings for a `Bundle` resource. Returns an empty list for a
 * non-Bundle resource (the caller keys this off `resourceType`) and for a clean Bundle.
 *
 * @param resource - The resource model (a `Bundle`).
 * @returns The value-free {@link ValidationIssue}s, in document order.
 * @example
 * ```ts
 * import { parseResource, collectBundleIssues } from "@cosyte/fhir";
 * const { resource } = parseResource(
 *   '{"resourceType":"Bundle","type":"collection","entry":[' +
 *     '{"fullUrl":"https://ex/Patient/1","resource":{"resourceType":"Patient","id":"2"}}]}',
 * );
 * collectBundleIssues(resource).map((i) => i.code); // ["FULLURL_ID_MISMATCH"]
 * ```
 */
export function collectBundleIssues(resource: FhirComplex): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const bundle = readBundle(resource);
  const index = buildBundleIndex(resource);

  for (const entry of bundle.entries) {
    const entryPath = `Bundle.entry[${String(entry.index)}]`;

    // fullUrl ↔ id agreement: only a RESTful (relative/absolute Type/id) fullUrl constrains the id.
    if (entry.fullUrl !== undefined && entry.resourceId !== undefined) {
      const parsed = parseReference(entry.fullUrl);
      if (
        (parsed.kind === "relative" || parsed.kind === "absolute") &&
        parsed.id !== undefined &&
        parsed.id !== entry.resourceId
      ) {
        issues.push(
          validationIssue("FULLURL_ID_MISMATCH", ISSUE_SEVERITIES.ERROR, `${entryPath}.fullUrl`),
        );
      }
    }

    if (entry.resource === undefined) continue;

    // Contained reference cycle (DoS-safe, bounded) → error.
    if (hasContainedCycle(entry.resource)) {
      issues.push(
        validationIssue(
          "CONTAINED_CYCLE",
          ISSUE_SEVERITIES.ERROR,
          `${entryPath}.resource.contained`,
        ),
      );
    }

    // Unresolved references: fragments against this resource's contained, relatives against the
    // Bundle. External absolute/logical references are not a defect and draw nothing.
    const contained = containedIndex(entry.resource);
    eachReference(entry.resource, `${entryPath}.resource`, (location, reference) => {
      const resolution = resolveReference(reference, { bundle: index, contained });
      if (resolution.status === "unresolved") {
        issues.push(validationIssue("REFERENCE_UNRESOLVED", ISSUE_SEVERITIES.WARNING, location));
      }
    });
  }

  return issues;
}
