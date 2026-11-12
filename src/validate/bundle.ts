/**
 * The Bundle-integrity validation layer, the findings a `Bundle` earns beyond
 * per-resource validation: unresolved references, `contained` reference cycles, `fullUrl`↔`id`
 * disagreement, and a `fullUrl` or a contained id that repeats. Keys off the resource being a
 * `Bundle`, exactly as the safety / quantity / terminology layers key off the resource type, and is
 * wired into {@link ./validate.js validateResource}.
 *
 * Five value-free findings (all consistent with the diagnostic model):
 *
 * - **`FULLURL_ID_MISMATCH`** (error), an entry whose `fullUrl` is a RESTful URL (`Type/id`) that
 *   disagrees with the wrapped `resource.id`. A `urn:uuid:` fullUrl constrains nothing, so it is
 *   exempt.
 * - **`REFERENCE_UNRESOLVED`** (warning), a `#fragment` naming an absent contained resource, or a
 *   relative `Type/id` naming no entry in the Bundle. Never fatal: the reference is preserved, the
 *   target may live outside the Bundle. An absolute/logical reference that is simply external draws
 *   nothing.
 * - **`CONTAINED_CYCLE`** (error), a resource whose `contained` resources reference each other in a
 *   cycle, caught by the bounded, iterative cycle guard rather than an unbounded resolver loop.
 * - **`FULLURL_DUPLICATE`** (error), an entry whose `fullUrl` and `meta.versionId` an earlier entry
 *   carries too, outside a `history` Bundle (R4's `bdl-7`).
 * - **`CONTAINED_ID_DUPLICATE`** (error), an entry resource's contained resource whose `id` an
 *   earlier contained resource of it carries too.
 *
 * A reference to a `fullUrl` or contained id that repeats is never resolved to the first: it draws
 * `REFERENCE_UNRESOLVED`, reported or not as a duplicate.
 *
 * Every finding is a FHIRPath *location*, never a value, a resource id, a reference string, and a
 * fullUrl are all kept out of the emitted issue.
 *
 * @packageDocumentation
 */

import { getProperty, isComplex, isList } from "../model/index.js";
import type { FhirComplex } from "../model/index.js";
import { Trail } from "../model/path.js";
import { parseReference } from "../model/reference.js";
import {
  buildBundleIndex,
  containedIndex,
  eachReferenceOn,
  hasContainedCycle,
  resolveReference,
} from "../bundle/references.js";
import { readBundle } from "../bundle/types.js";
import { primitiveString } from "../safety/codes.js";
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
  // bdl-7: a history Bundle may carry a fullUrl once per version of the resource, and so may any
  // Bundle whose entries under it differ in meta.versionId.
  const versionsSeen = bundle.type === "history" ? undefined : new Set<string>();

  for (const entry of bundle.entries) {
    const entryPath = `Bundle.entry[${String(entry.index)}]`;

    if (versionsSeen !== undefined && entry.fullUrl !== undefined) {
      const version = entry.resource === undefined ? undefined : versionIdOf(entry.resource);
      // The fullUrl and the version joined by a NUL, which a valid uri never holds.
      const key = `${entry.fullUrl}\u0000${version ?? ""}`;
      if (versionsSeen.has(key)) {
        issues.push(
          validationIssue("FULLURL_DUPLICATE", ISSUE_SEVERITIES.ERROR, `${entryPath}.fullUrl`),
        );
      }
      versionsSeen.add(key);
    }

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

    issues.push(...collectContainedIdIssues(entry.resource, `${entryPath}.resource`));

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
    eachReferenceOn(entry.resource, new Trail(`${entryPath}.resource`), (at, reference) => {
      const resolution = resolveReference(reference, { bundle: index, contained });
      if (resolution.status === "unresolved") {
        const location = `${at.text()}.reference`;
        issues.push(validationIssue("REFERENCE_UNRESOLVED", ISSUE_SEVERITIES.WARNING, location));
      }
    });
  }

  return issues;
}

/** A resource's `meta.versionId`, when it states one. */
function versionIdOf(resource: FhirComplex): string | undefined {
  const meta = getProperty(resource, "meta");
  return meta !== undefined && isComplex(meta)
    ? primitiveString(getProperty(meta, "versionId"))
    : undefined;
}

/**
 * The `CONTAINED_ID_DUPLICATE` findings for one resource: one at each contained resource whose `id`
 * an earlier contained resource of it carries. A `#id` reference to such an id names no one of them,
 * and reference resolution reads it as unresolved.
 *
 * @param resource - The resource whose `contained` set to read.
 * @param path - The FHIRPath location of `resource`, the prefix of each finding.
 * @returns The value-free findings, in document order.
 * @internal
 */
export function collectContainedIdIssues(resource: FhirComplex, path: string): ValidationIssue[] {
  const node = getProperty(resource, "contained");
  // A single contained object carries one id, which repeats nothing.
  if (node === undefined || !isList(node)) return [];
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();
  node.items.forEach((item, i) => {
    const id = isComplex(item) ? primitiveString(getProperty(item, "id")) : undefined;
    if (id === undefined) return;
    if (seen.has(id)) {
      issues.push(
        validationIssue(
          "CONTAINED_ID_DUPLICATE",
          ISSUE_SEVERITIES.ERROR,
          `${path}.contained[${String(i)}].id`,
        ),
      );
    }
    seen.add(id);
  });
  return issues;
}
