import { describe, expect, it } from "vitest";

import {
  collectInvariantIssues,
  collectProfileIssues,
  complex,
  loadStructureDefinition,
  matchSlices,
  parseResource,
  primitive,
  resolveSlices,
  SLICE_UNCHECKED_REASONS,
  validateResource,
  type FhirComplex,
  type StructureDefinition,
  type ValidationIssue,
} from "../src/index.js";
import { req } from "./_util.js";

/**
 * A slicing with a `profile` discriminator is not decided: it is reported `PROFILE_SLICE_UNCHECKED`
 * with the `profile-discriminator` reason, assigns no occurrence, and so draws no finding about slice
 * membership either way. Every profile and document here is synthetic: example.org canonicals,
 * plainly fake ids, codes and urls.
 */

const BASE = "http://example.org/StructureDefinition/";

function loadSd(obj: unknown): StructureDefinition {
  return req(loadStructureDefinition(parseResource(JSON.stringify(obj)).resource));
}

function parse(obj: unknown): FhirComplex {
  return parseResource(JSON.stringify(obj)).resource;
}

/** Every finding that is not information, plus each `PROFILE_SLICE_UNCHECKED` with its reason. */
function verdict(issues: readonly ValidationIssue[]): [string, string, string | undefined][] {
  return issues
    .filter((i) => i.severity !== "information" || i.code === "PROFILE_SLICE_UNCHECKED")
    .map((i) => [i.code, i.expression, i.sliceReason]);
}

/** A Bundle profile: `entry` closed-sliced by the profile of its `resource`, one required slice. */
const bundleByProfile = loadSd({
  resourceType: "StructureDefinition",
  url: `${BASE}fake-bundle-by-profile`,
  type: "Bundle",
  snapshot: {
    element: [
      { id: "Bundle", path: "Bundle" },
      {
        id: "Bundle.entry",
        path: "Bundle.entry",
        slicing: { discriminator: [{ type: "profile", path: "resource" }], rules: "closed" },
      },
      { id: "Bundle.entry:pat", path: "Bundle.entry", sliceName: "pat", min: 1, max: "1" },
      {
        id: "Bundle.entry:pat.resource",
        path: "Bundle.entry.resource",
        type: [{ code: "Patient", profile: [`${BASE}fake-pat-bt`] }],
      },
    ],
  },
});

/** The slice's Patient profile: `birthDate` extensions closed-sliced by url, at most one. */
const patientBirthTime = loadSd({
  resourceType: "StructureDefinition",
  url: `${BASE}fake-pat-bt`,
  type: "Patient",
  snapshot: {
    element: [
      { id: "Patient", path: "Patient" },
      { id: "Patient.birthDate", path: "Patient.birthDate", type: [{ code: "date" }] },
      {
        id: "Patient.birthDate.extension",
        path: "Patient.birthDate.extension",
        slicing: { discriminator: [{ type: "value", path: "url" }], rules: "closed" },
        max: "1",
      },
      {
        id: "Patient.birthDate.extension:bt",
        path: "Patient.birthDate.extension",
        sliceName: "bt",
        max: "1",
        type: [{ code: "Extension", profile: [`${BASE}fake-birth-time`] }],
      },
      {
        id: "Patient.birthDate.extension:bt.url",
        path: "Patient.birthDate.extension.url",
        fixedUri: `${BASE}fake-birth-time`,
      },
    ],
  },
});

/** The same profile url, asking for at least one `birthDate` extension instead. */
const patientBirthExtension = loadSd({
  resourceType: "StructureDefinition",
  url: `${BASE}fake-pat-bt`,
  type: "Patient",
  snapshot: {
    element: [
      { id: "Patient", path: "Patient" },
      { id: "Patient.birthDate.extension", path: "Patient.birthDate.extension", min: 1 },
    ],
  },
});

/** A one-entry Bundle holding a Patient whose `birthDate` carries the given extensions. */
function bundleWithBirthDate(extension: unknown[]): FhirComplex {
  return parse({
    resourceType: "Bundle",
    type: "collection",
    entry: [
      {
        fullUrl: "urn:uuid:fake-1",
        resource: {
          resourceType: "Patient",
          id: "fake-p",
          birthDate: "1970-01-01",
          _birthDate: { extension },
        },
      },
    ],
  });
}

const PROFILE_UNCHECKED: [string, string, string | undefined][] = [
  ["PROFILE_SLICE_UNCHECKED", "Bundle.entry", SLICE_UNCHECKED_REASONS.PROFILE_DISCRIMINATOR],
];

describe("a profile discriminator is reported unchecked, never decided", () => {
  it("does not pass an entry whose primitive's extension breaks a closed url slicing", () => {
    const doc = bundleWithBirthDate([
      { url: "http://example.org/fake-other-ext", valueString: "fake" },
    ]);
    const result = validateResource(doc, { profiles: [bundleByProfile, patientBirthTime] });
    expect(verdict(result.issues)).toEqual(PROFILE_UNCHECKED);
  });

  it("does not pass an entry whose primitive carries more extensions than the max", () => {
    const doc = bundleWithBirthDate([
      { url: `${BASE}fake-birth-time`, valueDateTime: "1970-01-01T08:00:00Z" },
      { url: `${BASE}fake-birth-time`, valueDateTime: "1970-01-01T09:00:00Z" },
    ]);
    const result = validateResource(doc, { profiles: [bundleByProfile, patientBirthTime] });
    expect(verdict(result.issues)).toEqual(PROFILE_UNCHECKED);
  });

  it("does not pass an entry whose extension breaks the extension's own definition", () => {
    const doc = bundleWithBirthDate([{ url: `${BASE}fake-birth-time`, valueString: "fake" }]);
    const result = validateResource(doc, { profiles: [bundleByProfile, patientBirthTime] });
    expect(verdict(result.issues)).toEqual(PROFILE_UNCHECKED);
  });

  it("reports no error for an entry that carries the extension the profile requires", () => {
    const doc = bundleWithBirthDate([
      { url: "http://example.org/fake-other-ext", valueString: "fake" },
    ]);
    const result = validateResource(doc, { profiles: [bundleByProfile, patientBirthExtension] });
    expect(verdict(result.issues)).toEqual(PROFILE_UNCHECKED);
  });

  it("assigns no occurrence, so no slice's own constraint is checked either", () => {
    const doc = parse({
      resourceType: "Bundle",
      type: "collection",
      entry: [{ resource: { resourceType: "Patient", id: "fake-1" } }],
    });
    // The slice asks for a fullUrl, which the entry lacks; the slice is never applied.
    const withFullUrl = loadSd({
      resourceType: "StructureDefinition",
      url: `${BASE}fake-bundle-full-url`,
      type: "Bundle",
      snapshot: {
        element: [
          { id: "Bundle", path: "Bundle" },
          {
            id: "Bundle.entry",
            path: "Bundle.entry",
            slicing: { discriminator: [{ type: "profile", path: "resource" }], rules: "open" },
          },
          { id: "Bundle.entry:pat", path: "Bundle.entry", sliceName: "pat" },
          { id: "Bundle.entry:pat.fullUrl", path: "Bundle.entry.fullUrl", min: 1 },
          {
            id: "Bundle.entry:pat.resource",
            path: "Bundle.entry.resource",
            type: [{ code: "Patient", profile: [`${BASE}fake-pat-bt`] }],
          },
        ],
      },
    });
    expect(
      verdict(collectProfileIssues(doc, withFullUrl, { profiles: [patientBirthTime] })),
    ).toEqual(PROFILE_UNCHECKED);
  });

  it("leaves a profile discriminator through resolve() unchecked too", () => {
    const performerByProfile = loadSd({
      resourceType: "StructureDefinition",
      url: `${BASE}fake-performer-by-profile`,
      type: "Observation",
      snapshot: {
        element: [
          { id: "Observation", path: "Observation" },
          {
            id: "Observation.performer",
            path: "Observation.performer",
            slicing: { discriminator: [{ type: "profile", path: "resolve()" }], rules: "closed" },
          },
          {
            id: "Observation.performer:patient",
            path: "Observation.performer",
            sliceName: "patient",
            min: 1,
            type: [{ code: "Reference", targetProfile: [`${BASE}fake-pat-bt`] }],
          },
        ],
      },
    });
    const obs = parse({
      resourceType: "Observation",
      contained: [{ resourceType: "Patient", id: "p1" }],
      performer: [{ reference: "#p1" }],
    });
    expect(
      verdict(collectProfileIssues(obs, performerByProfile, { profiles: [patientBirthExtension] })),
    ).toEqual([
      [
        "PROFILE_SLICE_UNCHECKED",
        "Observation.performer",
        SLICE_UNCHECKED_REASONS.PROFILE_DISCRIMINATOR,
      ],
    ]);
  });

  it("leaves the whole slicing unchecked when a profile discriminator sits beside a decidable one", () => {
    const both = loadSd({
      resourceType: "StructureDefinition",
      url: `${BASE}fake-type-and-profile`,
      type: "Bundle",
      snapshot: {
        element: [
          { id: "Bundle", path: "Bundle" },
          {
            id: "Bundle.entry",
            path: "Bundle.entry",
            slicing: {
              discriminator: [
                { type: "type", path: "resource" },
                { type: "profile", path: "resource" },
              ],
              rules: "closed",
            },
          },
          { id: "Bundle.entry:pat", path: "Bundle.entry", sliceName: "pat", min: 1 },
          {
            id: "Bundle.entry:pat.resource",
            path: "Bundle.entry.resource",
            type: [{ code: "Patient", profile: [`${BASE}fake-pat-bt`] }],
          },
        ],
      },
    });
    // A Group fails the type discriminator outright; the slicing is still not decided.
    const doc = parse({
      resourceType: "Bundle",
      type: "collection",
      entry: [{ resource: { resourceType: "Group", id: "fake-g" } }],
    });
    expect(verdict(collectProfileIssues(doc, both))).toEqual(PROFILE_UNCHECKED);
  });

  it("scopes no slice invariant to a member of a profile-discriminated slicing", () => {
    const withInvariant = loadSd({
      resourceType: "StructureDefinition",
      url: `${BASE}fake-entry-invariant`,
      type: "Bundle",
      snapshot: {
        element: [
          { id: "Bundle", path: "Bundle" },
          {
            id: "Bundle.entry",
            path: "Bundle.entry",
            slicing: { discriminator: [{ type: "profile", path: "resource" }], rules: "open" },
          },
          { id: "Bundle.entry:pat", path: "Bundle.entry", sliceName: "pat" },
          {
            id: "Bundle.entry:pat.resource",
            path: "Bundle.entry.resource",
            type: [{ code: "Patient", profile: [`${BASE}fake-pat-bt`] }],
            constraint: [{ key: "fake-1", severity: "error", expression: "gender.exists()" }],
          },
        ],
      },
    });
    const doc = parse({
      resourceType: "Bundle",
      type: "collection",
      entry: [{ resource: { resourceType: "Patient", id: "fake-1" } }],
    });
    const issues = collectInvariantIssues(doc, withInvariant, {
      profiles: [patientBirthExtension],
    });
    expect(issues.map((i) => i.code)).not.toContain("INVARIANT_VIOLATED");
  });

  it("answers matchSlices with the reason, and no assignment, for any profile discriminator", () => {
    const slices = resolveSlices(
      req(bundleByProfile.snapshot),
      req(bundleByProfile.snapshot?.find((e) => e.id === "Bundle.entry")),
    );
    const entry = complex([
      {
        name: "resource",
        value: complex([{ name: "resourceType", value: primitive("Patient") }]),
      },
    ]);
    const environment = { resolve: () => undefined, profileType: () => "Patient" };
    for (const discriminators of [
      [{ type: "profile", path: "resource" }],
      [
        { type: "value", path: "fullUrl" },
        { type: "profile", path: "resource" },
      ],
    ]) {
      expect(matchSlices([entry, entry], slices, discriminators, environment)).toEqual({
        assignments: [undefined, undefined],
        unchecked: true,
        reason: SLICE_UNCHECKED_REASONS.PROFILE_DISCRIMINATOR,
      });
    }
  });

  it("keeps an unsupported kind's own reason when it sits beside a profile discriminator", () => {
    const result = matchSlices(
      [complex([])],
      [],
      [
        { type: "profile", path: "$this" },
        { type: "position", path: "$this" },
      ],
    );
    expect(result.reason).toBe(SLICE_UNCHECKED_REASONS.DISCRIMINATOR_UNSUPPORTED);
  });
});
