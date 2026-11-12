import { describe, expect, it } from "vitest";

import {
  buildBundleIndex,
  collectBundleIssues,
  containedIndex,
  loadStructureDefinition,
  parseResource,
  resolveReference,
  SLICE_UNCHECKED_REASONS,
  validateResource,
  type FhirComplex,
  type StructureDefinition,
  type ValidationIssue,
} from "../src/index.js";
import { req } from "./_util.js";

/**
 * A reference whose target id repeats, among a resource's `contained` resources or a Bundle's
 * `fullUrl`s, names no one resource. It is never resolved by picking the first: it reads as
 * unresolved, so a check that depends on it reads unchecked, and the repeat is reported. Every
 * profile and document here is synthetic: example.org canonicals, plainly fake ids.
 */

function parse(obj: unknown): FhirComplex {
  return parseResource(JSON.stringify(obj)).resource;
}

function loadSd(obj: unknown): StructureDefinition {
  return req(loadStructureDefinition(parse(obj)));
}

/**
 * Each finding as `[code, severity, location]`, with the slice reason where there is one: every
 * error and warning, and an undecided slicing. The other information findings (`dom-3` unchecked
 * beside a contained resource, a Bundle not modeled) say nothing about a reference.
 */
function findings(issues: readonly ValidationIssue[]): (string | undefined)[][] {
  return issues
    .filter((i) => i.severity !== "information" || i.code === "PROFILE_SLICE_UNCHECKED")
    .map((i) =>
      i.sliceReason === undefined
        ? [i.code, i.severity, i.expression]
        : [i.code, i.severity, i.expression, i.sliceReason],
    );
}

const BASE = "http://example.org/StructureDefinition/";
const CORE = "http://hl7.org/fhir/StructureDefinition/";

const practitioner = { resourceType: "Practitioner", id: "fake-pr" };
const organization = { resourceType: "Organization", id: "fake-pr" };

/** An Observation profile: `performer` sliced closed by the type its reference resolves to. */
const performerByType = loadSd({
  resourceType: "StructureDefinition",
  url: `${BASE}performer-by-type`,
  type: "Observation",
  snapshot: {
    element: [
      { id: "Observation", path: "Observation" },
      {
        id: "Observation.performer",
        path: "Observation.performer",
        slicing: { discriminator: [{ type: "type", path: "resolve()" }], rules: "closed" },
      },
      {
        id: "Observation.performer:prac",
        path: "Observation.performer",
        sliceName: "prac",
        min: 1,
        max: "1",
        type: [{ code: "Reference", targetProfile: [`${CORE}Practitioner`] }],
      },
      {
        id: "Observation.performer:prac.display",
        path: "Observation.performer.display",
        min: 1,
        max: "1",
      },
    ],
  },
});

function observation(contained: readonly unknown[]): FhirComplex {
  return parse({
    resourceType: "Observation",
    id: "fake-o",
    status: "final",
    code: { text: "Synthetic test" },
    contained,
    performer: [{ reference: "#fake-pr", display: "Fake Doc" }],
  });
}

describe("a reference to a contained id that repeats", () => {
  it("resolves a unique contained id as before", () => {
    const result = validateResource(observation([practitioner]), {
      profiles: [performerByType],
    });
    expect(findings(result.issues)).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("is never resolved to the first, a Practitioner listed first included", () => {
    const result = validateResource(observation([practitioner, organization]), {
      profiles: [performerByType],
    });
    expect(findings(result.issues)).toEqual([
      ["CONTAINED_ID_DUPLICATE", "error", "Observation.contained[1].id"],
      [
        "PROFILE_SLICE_UNCHECKED",
        "information",
        "Observation.performer",
        SLICE_UNCHECKED_REASONS.TARGET_UNRESOLVED,
      ],
    ]);
    expect(result.valid).toBe(false);
  });

  it("is never resolved to the first, an Organization listed first included", () => {
    const result = validateResource(observation([organization, practitioner]), {
      profiles: [performerByType],
    });
    expect(findings(result.issues)).toEqual([
      ["CONTAINED_ID_DUPLICATE", "error", "Observation.contained[1].id"],
      [
        "PROFILE_SLICE_UNCHECKED",
        "information",
        "Observation.performer",
        SLICE_UNCHECKED_REASONS.TARGET_UNRESOLVED,
      ],
    ]);
  });

  it("reads as unresolved through resolveReference, and leaves a unique id beside it resolved", () => {
    const resource = observation([
      practitioner,
      organization,
      { resourceType: "Patient", id: "fake-pt" },
      { resourceType: "Device", id: "fake-pr" },
    ]);
    const contained = containedIndex(resource);
    expect(resolveReference("#fake-pr", { contained }).status).toBe("unresolved");
    expect(resolveReference("#fake-pt", { contained }).status).toBe("resolved");
    expect(contained.byId.has("fake-pr")).toBe(false);
    expect([...(contained.repeatedIds ?? [])]).toEqual(["fake-pr"]);
    // Every repeat after the first is reported, each at its own id.
    expect(findings(validateResource(resource).issues)).toEqual([
      ["CONTAINED_ID_DUPLICATE", "error", "Observation.contained[1].id"],
      ["CONTAINED_ID_DUPLICATE", "error", "Observation.contained[3].id"],
    ]);
  });

  it("is reported inside a Bundle entry, at the entry's contained id", () => {
    const bundle = parse({
      resourceType: "Bundle",
      type: "collection",
      entry: [
        {
          fullUrl: "urn:uuid:fake-1",
          resource: {
            resourceType: "Observation",
            id: "fake-o",
            status: "final",
            contained: [practitioner, organization],
            performer: [{ reference: "#fake-pr" }],
          },
        },
      ],
    });
    expect(findings(collectBundleIssues(bundle))).toEqual([
      ["CONTAINED_ID_DUPLICATE", "error", "Bundle.entry[0].resource.contained[1].id"],
      ["REFERENCE_UNRESOLVED", "warning", "Bundle.entry[0].resource.performer[0].reference"],
    ]);
  });
});

/** A Bundle profile: `entry` sliced closed by the type of `resource.hasMember.resolve()`. */
const membersByType = loadSd({
  resourceType: "StructureDefinition",
  url: `${BASE}members-by-type`,
  type: "Bundle",
  snapshot: {
    element: [
      { id: "Bundle", path: "Bundle" },
      {
        id: "Bundle.entry",
        path: "Bundle.entry",
        slicing: {
          discriminator: [{ type: "type", path: "resource.hasMember.resolve()" }],
          rules: "open",
        },
      },
      { id: "Bundle.entry:grouped", path: "Bundle.entry", sliceName: "grouped" },
      {
        id: "Bundle.entry:grouped.resource.hasMember",
        path: "Bundle.entry.resource.hasMember",
        type: [{ code: "Reference", targetProfile: [`${CORE}Observation`] }],
      },
    ],
  },
});

function bundleOf(entries: readonly unknown[], type = "collection"): FhirComplex {
  return parse({ resourceType: "Bundle", type, entry: entries });
}

const grouping = {
  fullUrl: "urn:uuid:fake-a",
  resource: {
    resourceType: "Observation",
    id: "fake-a",
    hasMember: [{ reference: "urn:uuid:fake-b" }],
  },
};

describe("a reference to a Bundle fullUrl that repeats", () => {
  it("resolves a unique fullUrl as before", () => {
    const bundle = bundleOf([
      grouping,
      { fullUrl: "urn:uuid:fake-b", resource: { resourceType: "Observation", id: "fake-b" } },
    ]);
    const index = buildBundleIndex(bundle);
    expect(resolveReference("urn:uuid:fake-b", { bundle: index }).status).toBe("resolved");
    expect(findings(validateResource(bundle, { profiles: [membersByType] }).issues)).toEqual([]);
  });

  it("is never resolved to the first entry under it", () => {
    const bundle = bundleOf([
      grouping,
      { fullUrl: "urn:uuid:fake-b", resource: { resourceType: "Observation", id: "fake-b" } },
      { fullUrl: "urn:uuid:fake-b", resource: { resourceType: "Patient", id: "fake-b" } },
    ]);
    const index = buildBundleIndex(bundle);
    // In the Bundle, so never external; twice, so never one of the two.
    expect(resolveReference("urn:uuid:fake-b", { bundle: index }).status).toBe("unresolved");
    expect(index.byFullUrl.has("urn:uuid:fake-b")).toBe(false);
    expect([...(index.repeatedFullUrls ?? [])]).toEqual(["urn:uuid:fake-b"]);
    expect(findings(validateResource(bundle, { profiles: [membersByType] }).issues)).toEqual([
      ["REFERENCE_UNRESOLVED", "warning", "Bundle.entry[0].resource.hasMember[0].reference"],
      ["FULLURL_DUPLICATE", "error", "Bundle.entry[2].fullUrl"],
      [
        "PROFILE_SLICE_UNCHECKED",
        "information",
        "Bundle.entry",
        SLICE_UNCHECKED_REASONS.TARGET_UNRESOLVED,
      ],
    ]);
  });

  it("reads a RESTful fullUrl's Type/id as unresolved too, by a relative or another base", () => {
    const bundle = bundleOf([
      {
        fullUrl: "https://fhir.example.org/Patient/fake-7",
        resource: { resourceType: "Patient", id: "fake-7" },
      },
      {
        fullUrl: "https://fhir.example.org/Patient/fake-7",
        resource: { resourceType: "Patient", id: "fake-7" },
      },
      { fullUrl: "urn:uuid:fake-9", resource: { resourceType: "Patient", id: "fake-9" } },
    ]);
    const index = buildBundleIndex(bundle);
    const status = (reference: string) => resolveReference(reference, { bundle: index }).status;
    expect(status("https://fhir.example.org/Patient/fake-7")).toBe("unresolved");
    expect(status("Patient/fake-7")).toBe("unresolved");
    expect(status("https://other.example.org/fhir/Patient/fake-7")).toBe("unresolved");
    expect(status("Patient/fake-9")).toBe("resolved");
    expect(status("urn:uuid:fake-9")).toBe("resolved");
  });

  it("reads a Type/id two entries under different fullUrls claim as unresolved", () => {
    const bundle = bundleOf([
      {
        fullUrl: "https://a.example.org/fhir/Patient/fake-7",
        resource: { resourceType: "Patient", id: "fake-7" },
      },
      {
        fullUrl: "https://b.example.org/fhir/Patient/fake-7",
        resource: { resourceType: "Patient", id: "fake-7" },
      },
    ]);
    const index = buildBundleIndex(bundle);
    const status = (reference: string) => resolveReference(reference, { bundle: index }).status;
    expect(status("Patient/fake-7")).toBe("unresolved");
    expect(status("https://c.example.org/fhir/Patient/fake-7")).toBe("unresolved");
    // Each full URL is still one entry's.
    expect(status("https://a.example.org/fhir/Patient/fake-7")).toBe("resolved");
    expect(status("https://b.example.org/fhir/Patient/fake-7")).toBe("resolved");
    expect([...(index.repeatedTypeIds ?? [])]).toEqual(["Patient/fake-7"]);
    // Two fullUrls, no repeat of either: nothing to report about the fullUrls themselves.
    expect(collectBundleIssues(bundle).map((i) => i.code)).toEqual([]);
  });

  it("reports a repeat as bdl-7 does: never in a history Bundle, nor across versions", () => {
    const entry = (versionId?: string) => ({
      fullUrl: "urn:uuid:fake-b",
      resource: {
        resourceType: "Patient",
        id: "fake-b",
        ...(versionId === undefined ? {} : { meta: { versionId } }),
      },
    });
    const codes = (bundle: FhirComplex) => collectBundleIssues(bundle).map((i) => i.code);
    expect(codes(bundleOf([entry(), entry()], "history"))).toEqual([]);
    expect(codes(bundleOf([entry("1"), entry("2")]))).toEqual([]);
    expect(codes(bundleOf([entry("1"), entry("1")]))).toEqual(["FULLURL_DUPLICATE"]);
    expect(codes(bundleOf([entry(), entry("1")]))).toEqual([]);
    // Unreported or not, a reference to the fullUrl still names no one entry.
    const history = buildBundleIndex(bundleOf([entry("1"), entry("2")], "history"));
    expect(resolveReference("urn:uuid:fake-b", { bundle: history }).status).toBe("unresolved");
  });
});

describe("the edges of a repeat", () => {
  it("reads contained resources with no id as no repeat", () => {
    const resource = observation([
      { resourceType: "Practitioner" },
      { resourceType: "Organization" },
    ]);
    const contained = containedIndex(resource);
    expect(contained.byId.size).toBe(0);
    expect([...(contained.repeatedIds ?? [])]).toEqual([]);
    expect(
      validateResource(resource).issues.filter((i) => i.code === "CONTAINED_ID_DUPLICATE"),
    ).toEqual([]);
  });

  it("keys an entry by its fullUrl's Type/id when the resource states no id", () => {
    const index = buildBundleIndex(
      bundleOf([
        {
          fullUrl: "https://fhir.example.org/Patient/fake-7",
          resource: { resourceType: "Patient" },
        },
      ]),
    );
    expect(resolveReference("Patient/fake-7", { bundle: index }).status).toBe("resolved");
  });

  it("resolves against an index built by hand, with no repeat sets, as before", () => {
    const bundle = { byFullUrl: new Map(), byTypeId: new Map() };
    expect(resolveReference("https://fhir.example.org/Patient/fake-7", { bundle }).status).toBe(
      "external",
    );
    expect(resolveReference("urn:uuid:fake-7", { bundle }).status).toBe("external");
    const contained = { root: observation([]), byId: new Map() };
    expect(resolveReference("#fake-7", { contained }).status).toBe("unresolved");
  });

  it("keeps a fullUrl and a versionId apart, so no two pairs read alike", () => {
    // `urn:uuid:fake-1` at version `2` and `urn:uuid:fake-12` at none spell the same text run
    // together, and are two different entries.
    const bundle = bundleOf([
      {
        fullUrl: "urn:uuid:fake-1",
        resource: { resourceType: "Patient", id: "fake-1", meta: { versionId: "2" } },
      },
      { fullUrl: "urn:uuid:fake-12", resource: { resourceType: "Patient", id: "fake-12" } },
    ]);
    expect(collectBundleIssues(bundle).map((i) => i.code)).toEqual([]);
  });
});
