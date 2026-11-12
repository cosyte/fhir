import { describe, expect, it } from "vitest";

import {
  collectInvariantIssues,
  collectProfileIssues,
  complex,
  list,
  loadStructureDefinition,
  matchSlices,
  parseResource,
  parseResourceXml,
  primitive,
  resolveSlices,
  SLICE_UNCHECKED_REASONS,
  validateResource,
  type FhirComplex,
  type StructureDefinition,
  type ValidationIssue,
} from "../src/index.js";
import { stepTypes } from "../src/profiles/navigate.js";
import { req } from "./_util.js";

/**
 * The `type` slicing discriminator, and the `profile` one left unchecked. Every profile and document
 * here is synthetic: example.org canonicals, plainly fake ids and codes.
 */

function loadSd(obj: unknown): StructureDefinition {
  return req(loadStructureDefinition(parseResource(JSON.stringify(obj)).resource));
}

function parse(obj: unknown): FhirComplex {
  return parseResource(JSON.stringify(obj)).resource;
}

/** Each finding as `[code, location]`, information findings included. */
function findings(issues: readonly ValidationIssue[]): [string, string][] {
  return issues.map((i) => [i.code, i.expression]);
}

/** The `PROFILE_SLICE_UNCHECKED` findings, each with its reason. */
function unchecked(issues: readonly ValidationIssue[]): [string, string | undefined][] {
  return issues
    .filter((i) => i.code === "PROFILE_SLICE_UNCHECKED")
    .map((i) => [i.expression, i.sliceReason]);
}

const BASE = "http://example.org/StructureDefinition/";

/**
 * The members every Observation needs (R4 `status` and `code`), so a nested profile check, which
 * runs every layer, judges a target on the profile alone.
 */
const anObservation = { resourceType: "Observation", status: "final", code: { text: "fake code" } };

/** An Observation profile slicing `value[x]` by type, as the US Core smoking-status profile does. */
const valueByType = loadSd({
  resourceType: "StructureDefinition",
  url: `${BASE}value-by-type`,
  type: "Observation",
  snapshot: {
    element: [
      { id: "Observation", path: "Observation" },
      {
        id: "Observation.value[x]",
        path: "Observation.value[x]",
        min: 1,
        max: "1",
        type: [{ code: "Quantity" }, { code: "CodeableConcept" }, { code: "string" }],
        slicing: { discriminator: [{ type: "type", path: "$this" }], rules: "open" },
      },
      {
        id: "Observation.value[x]:valueQuantity",
        path: "Observation.value[x]",
        sliceName: "valueQuantity",
        min: 0,
        max: "1",
        type: [{ code: "Quantity" }],
      },
      {
        id: "Observation.value[x]:valueQuantity.system",
        path: "Observation.value[x].system",
        min: 1,
        max: "1",
        fixedUri: "http://unitsofmeasure.org",
      },
      {
        id: "Observation.value[x]:valueCodeableConcept",
        path: "Observation.value[x]",
        sliceName: "valueCodeableConcept",
        min: 0,
        max: "1",
        type: [{ code: "CodeableConcept" }],
      },
      {
        id: "Observation.value[x]:valueCodeableConcept.coding",
        path: "Observation.value[x].coding",
        min: 1,
      },
    ],
  },
});

/** A closed slicing on `effective[x]` with one required `dateTime` slice (US Core 6.1.0's shape). */
const effectiveByType = loadSd({
  resourceType: "StructureDefinition",
  url: `${BASE}effective-by-type`,
  type: "Observation",
  snapshot: {
    element: [
      { id: "Observation", path: "Observation" },
      {
        id: "Observation.effective[x]",
        path: "Observation.effective[x]",
        type: [{ code: "dateTime" }],
        slicing: { discriminator: [{ type: "type", path: "$this" }], rules: "closed" },
      },
      {
        id: "Observation.effective[x]:effectiveDateTime",
        path: "Observation.effective[x]",
        sliceName: "effectiveDateTime",
        min: 1,
        max: "1",
        type: [{ code: "dateTime" }],
      },
    ],
  },
});

describe("a type discriminator on a choice element is decided from the choice suffix", () => {
  it("checks the matched slice's own constraints on its member", () => {
    const obs = parse({
      resourceType: "Observation",
      valueQuantity: { value: 1, unit: "fake-unit", system: "http://example.org/not-ucum" },
    });
    expect(findings(collectProfileIssues(obs, valueByType))).toEqual([
      ["PROFILE_FIXED_MISMATCH", "Observation.value[x].system"],
    ]);
  });

  it("applies a slice's constraints to its members alone", () => {
    const obs = parse({ resourceType: "Observation", valueCodeableConcept: { text: "fake" } });
    expect(findings(collectProfileIssues(obs, valueByType))).toEqual([
      ["CARDINALITY_MIN", "Observation.value[x].coding"],
    ]);
  });

  it("passes a conforming member, with nothing reported unchecked", () => {
    const obs = parse({
      resourceType: "Observation",
      valueQuantity: { value: 1, system: "http://unitsofmeasure.org", code: "1" },
    });
    expect(findings(collectProfileIssues(obs, valueByType))).toEqual([]);
  });

  it("leaves an occurrence of a type no slice names unassigned under open slicing", () => {
    const obs = parse({ resourceType: "Observation", valueString: "fake" });
    expect(findings(collectProfileIssues(obs, valueByType))).toEqual([]);
  });

  it("matches a primitive choice suffix to its lower-case type code", () => {
    const obs = parse({ resourceType: "Observation", effectiveDateTime: "2020-01-01" });
    expect(findings(collectProfileIssues(obs, effectiveByType))).toEqual([]);
  });

  it("reports an occurrence outside a closed slicing, and the required slice missing", () => {
    const obs = parse({
      resourceType: "Observation",
      effectivePeriod: { start: "2020-01-01" },
    });
    // The sliced element itself narrows `effective[x]` to dateTime, so a Period breaks it too.
    expect(findings(collectProfileIssues(obs, effectiveByType))).toEqual([
      ["PROFILE_TYPE_MISMATCH", "Observation.effective[x]"],
      ["PROFILE_SLICE_UNMATCHED", "Observation.effective[x][0]"],
      ["CARDINALITY_MIN", "Observation.effective[x]:effectiveDateTime"],
    ]);
  });

  it("decides the same through validateResource", () => {
    const obs = parse({
      resourceType: "Observation",
      status: "final",
      code: { text: "fake" },
      effectivePeriod: { start: "2020-01-01" },
    });
    const codes = validateResource(obs, { profiles: [effectiveByType] }).issues.map((i) => i.code);
    expect(codes).toContain("PROFILE_SLICE_UNMATCHED");
    expect(codes).not.toContain("PROFILE_SLICE_UNCHECKED");
  });

  it("reads the choice suffix from an XML document too", () => {
    const xml =
      '<Observation xmlns="http://hl7.org/fhir"><status value="final"/>' +
      '<code><text value="fake"/></code><effectivePeriod><start value="2020-01-01"/>' +
      "</effectivePeriod></Observation>";
    const obs = parseResourceXml(xml).resource;
    // The sliced element itself narrows `effective[x]` to dateTime, so a Period breaks it too.
    expect(findings(collectProfileIssues(obs, effectiveByType))).toEqual([
      ["PROFILE_TYPE_MISMATCH", "Observation.effective[x]"],
      ["PROFILE_SLICE_UNMATCHED", "Observation.effective[x][0]"],
      ["CARDINALITY_MIN", "Observation.effective[x]:effectiveDateTime"],
    ]);
  });
});

/** A Bundle profile slicing `entry` by the type of its `resource`. */
const entryByType = loadSd({
  resourceType: "StructureDefinition",
  url: `${BASE}entry-by-type`,
  type: "Bundle",
  snapshot: {
    element: [
      { id: "Bundle", path: "Bundle" },
      {
        id: "Bundle.entry",
        path: "Bundle.entry",
        slicing: { discriminator: [{ type: "type", path: "resource" }], rules: "closed" },
      },
      { id: "Bundle.entry:patient", path: "Bundle.entry", sliceName: "patient", min: 1, max: "1" },
      { id: "Bundle.entry:patient.fullUrl", path: "Bundle.entry.fullUrl", min: 1, max: "1" },
      {
        id: "Bundle.entry:patient.resource",
        path: "Bundle.entry.resource",
        min: 1,
        max: "1",
        type: [{ code: "Patient" }],
      },
    ],
  },
});

describe("a type discriminator on a resource is decided from its resourceType", () => {
  it("assigns the entry whose resource is of the slice's type and checks the slice on it", () => {
    const bundle = parse({
      resourceType: "Bundle",
      type: "collection",
      entry: [{ resource: { resourceType: "Patient", id: "fake-1" } }],
    });
    expect(findings(collectProfileIssues(bundle, entryByType))).toEqual([
      ["CARDINALITY_MIN", "Bundle.entry.fullUrl"],
    ]);
  });

  it("reports an entry of another type under the closed slicing", () => {
    const bundle = parse({
      resourceType: "Bundle",
      type: "collection",
      entry: [
        { fullUrl: "urn:uuid:fake-1", resource: { resourceType: "Patient", id: "fake-1" } },
        { fullUrl: "urn:uuid:fake-2", resource: { resourceType: "Organization", id: "fake-2" } },
        "fake-not-an-entry",
      ],
    });
    expect(
      findings(collectProfileIssues(bundle, entryByType)).filter(
        ([code]) => code !== "CARDINALITY_MIN",
      ),
    ).toEqual([
      ["PROFILE_SLICE_UNMATCHED", "Bundle.entry[1]"],
      ["PROFILE_SLICE_UNMATCHED", "Bundle.entry[2]"],
    ]);
  });

  it("counts an entry with no resource as of no type", () => {
    const bundle = parse({
      resourceType: "Bundle",
      type: "collection",
      entry: [{ fullUrl: "urn:uuid:fake-1" }],
    });
    expect(findings(collectProfileIssues(bundle, entryByType))).toEqual([
      ["PROFILE_SLICE_UNMATCHED", "Bundle.entry[0]"],
      ["CARDINALITY_MIN", "Bundle.entry:patient"],
    ]);
  });

  it("evaluates a slice-scoped invariant on the decided members alone", () => {
    const withInvariant = loadSd({
      resourceType: "StructureDefinition",
      url: `${BASE}entry-invariant`,
      type: "Bundle",
      snapshot: {
        element: [
          { id: "Bundle", path: "Bundle" },
          {
            id: "Bundle.entry",
            path: "Bundle.entry",
            slicing: { discriminator: [{ type: "type", path: "resource" }], rules: "open" },
          },
          { id: "Bundle.entry:patient", path: "Bundle.entry", sliceName: "patient" },
          {
            id: "Bundle.entry:patient.resource",
            path: "Bundle.entry.resource",
            type: [{ code: "Patient" }],
            constraint: [{ key: "fake-1", severity: "error", expression: "gender.exists()" }],
          },
        ],
      },
    });
    const bundle = parse({
      resourceType: "Bundle",
      type: "collection",
      entry: [
        { resource: { resourceType: "Patient", id: "fake-1" } },
        { resource: { resourceType: "Organization", id: "fake-2" } },
      ],
    });
    expect(findings(collectInvariantIssues(bundle, withInvariant))).toEqual([
      ["INVARIANT_VIOLATED", "Bundle.entry[0].resource"],
    ]);
  });
});

/** An Observation profile slicing `hasMember` by the type of the resource each reference resolves to. */
const memberByType = loadSd({
  resourceType: "StructureDefinition",
  url: `${BASE}member-by-type`,
  type: "Observation",
  snapshot: {
    element: [
      { id: "Observation", path: "Observation" },
      {
        id: "Observation.hasMember",
        path: "Observation.hasMember",
        slicing: { discriminator: [{ type: "type", path: "resolve()" }], rules: "closed" },
      },
      {
        id: "Observation.hasMember:obs",
        path: "Observation.hasMember",
        sliceName: "obs",
        type: [
          {
            code: "Reference",
            targetProfile: ["http://hl7.org/fhir/StructureDefinition/Observation"],
          },
        ],
      },
      { id: "Observation.hasMember:obs.display", path: "Observation.hasMember.display", min: 1 },
    ],
  },
});

describe("a type discriminator through resolve()", () => {
  it("decides from the contained resource the reference reaches", () => {
    const obs = parse({
      resourceType: "Observation",
      contained: [
        { resourceType: "Observation", id: "o1", status: "final", code: { text: "fake" } },
        { resourceType: "QuestionnaireResponse", id: "q1", status: "completed" },
      ],
      hasMember: [{ reference: "#o1" }, { reference: "#q1" }],
    });
    expect(findings(collectProfileIssues(obs, memberByType))).toEqual([
      ["PROFILE_SLICE_UNMATCHED", "Observation.hasMember[1]"],
      ["CARDINALITY_MIN", "Observation.hasMember[0].display"],
    ]);
  });

  it("stays unchecked, with its reason, when the reference resolves to nothing", () => {
    const obs = parse({
      resourceType: "Observation",
      hasMember: [{ reference: "Observation/fake-elsewhere" }],
    });
    expect(unchecked(collectProfileIssues(obs, memberByType))).toEqual([
      ["Observation.hasMember", SLICE_UNCHECKED_REASONS.TARGET_UNRESOLVED],
    ]);
  });

  it("stays unchecked when the slice names a profile that was not supplied", () => {
    const named = loadSd({
      resourceType: "StructureDefinition",
      url: `${BASE}member-by-named-profile`,
      type: "Observation",
      snapshot: {
        element: [
          { id: "Observation", path: "Observation" },
          {
            id: "Observation.hasMember",
            path: "Observation.hasMember",
            slicing: { discriminator: [{ type: "type", path: "resolve()" }], rules: "open" },
          },
          {
            id: "Observation.hasMember:obs",
            path: "Observation.hasMember",
            sliceName: "obs",
            type: [{ code: "Reference", targetProfile: [`${BASE}not-supplied`] }],
          },
        ],
      },
    });
    const obs = parse({
      resourceType: "Observation",
      contained: [{ resourceType: "Observation", id: "o1" }],
      hasMember: [{ reference: "#o1" }],
    });
    expect(unchecked(collectProfileIssues(obs, named))).toEqual([
      ["Observation.hasMember", SLICE_UNCHECKED_REASONS.PROFILE_UNAVAILABLE],
    ]);
    // A profile supplied or resolved at another url names no type for this one.
    const elsewhere = loadSd({
      resourceType: "StructureDefinition",
      url: `${BASE}fake-elsewhere`,
      type: "Observation",
      snapshot: { element: [{ id: "Observation", path: "Observation" }] },
    });
    expect(unchecked(collectProfileIssues(obs, named, { profiles: [elsewhere] }))).toEqual([
      ["Observation.hasMember", SLICE_UNCHECKED_REASONS.PROFILE_UNAVAILABLE],
    ]);
    expect(unchecked(collectProfileIssues(obs, named, { resolve: () => elsewhere }))).toEqual([
      ["Observation.hasMember", SLICE_UNCHECKED_REASONS.PROFILE_UNAVAILABLE],
    ]);
  });
});

/** A synthetic Patient profile: `gender` required. */
const genderedPatient = loadSd({
  resourceType: "StructureDefinition",
  url: `${BASE}gendered-patient`,
  version: "1.0.0",
  type: "Patient",
  snapshot: {
    element: [
      { id: "Patient", path: "Patient" },
      { id: "Patient.gender", path: "Patient.gender", min: 1, max: "1" },
    ],
  },
});

describe("what stays unchecked, each with its reason", () => {
  const slicesOf = (sd: StructureDefinition, id: string) =>
    resolveSlices(req(sd.snapshot), req(sd.snapshot?.find((e) => e.id === id)));

  it("an R5 position discriminator", () => {
    const result = matchSlices([primitive("x")], [], [{ type: "position", path: "$this" }]);
    expect(result).toMatchObject({
      unchecked: true,
      reason: SLICE_UNCHECKED_REASONS.DISCRIMINATOR_UNSUPPORTED,
    });
  });

  it("an empty discriminator set", () => {
    expect(matchSlices([primitive("x")], [], []).reason).toBe(
      SLICE_UNCHECKED_REASONS.NO_DISCRIMINATOR,
    );
  });

  it("a path outside the subset", () => {
    const slices = slicesOf(valueByType, "Observation.value[x]");
    const result = matchSlices([primitive("x")], slices, [
      { type: "type", path: "ofType(Quantity)" },
    ]);
    expect(result.reason).toBe(SLICE_UNCHECKED_REASONS.PATH_UNSUPPORTED);
  });

  it("an occurrence whose type the document does not state", () => {
    const slices = slicesOf(valueByType, "Observation.value[x]");
    const result = matchSlices([primitive("x")], slices, [{ type: "type", path: "$this" }]);
    expect(result.reason).toBe(SLICE_UNCHECKED_REASONS.TYPE_UNDETERMINED);
  });

  it.each([
    "Resource",
    "DomainResource",
    "MetadataResource",
    "CanonicalResource",
    "Element",
    "BackboneElement",
  ])("a slice that names the abstract type %s", (abstractType) => {
    const abstract = loadSd({
      resourceType: "StructureDefinition",
      url: `${BASE}abstract`,
      type: "Bundle",
      snapshot: {
        element: [
          { id: "Bundle", path: "Bundle" },
          {
            id: "Bundle.entry",
            path: "Bundle.entry",
            slicing: { discriminator: [{ type: "type", path: "resource" }], rules: "closed" },
          },
          { id: "Bundle.entry:any", path: "Bundle.entry", sliceName: "any" },
          {
            id: "Bundle.entry:any.resource",
            path: "Bundle.entry.resource",
            type: [{ code: abstractType }],
          },
        ],
      },
    });
    const bundle = parse({
      resourceType: "Bundle",
      type: "collection",
      entry: [{ resource: { resourceType: "Patient", id: "fake-1" } }],
    });
    expect(unchecked(collectProfileIssues(bundle, abstract))).toEqual([
      ["Bundle.entry", SLICE_UNCHECKED_REASONS.TYPE_UNDETERMINED],
    ]);
  });

  it("a profile discriminator, which is not decided yet", () => {
    const datatype = loadSd({
      resourceType: "StructureDefinition",
      url: `${BASE}datatype`,
      type: "Observation",
      snapshot: {
        element: [
          { id: "Observation", path: "Observation" },
          {
            id: "Observation.identifier",
            path: "Observation.identifier",
            slicing: { discriminator: [{ type: "profile", path: "$this" }], rules: "open" },
          },
          {
            id: "Observation.identifier:fake",
            path: "Observation.identifier",
            sliceName: "fake",
            type: [{ code: "Identifier", profile: [`${BASE}fake-identifier`] }],
          },
        ],
      },
    });
    const obs = parse({ resourceType: "Observation", identifier: [{ value: "fake-1" }] });
    expect(unchecked(collectProfileIssues(obs, datatype))).toEqual([
      ["Observation.identifier", SLICE_UNCHECKED_REASONS.PROFILE_DISCRIMINATOR],
    ]);
  });

  it("a slice that declares no type at the discriminator path", () => {
    const bare = loadSd({
      resourceType: "StructureDefinition",
      url: `${BASE}bare`,
      type: "Observation",
      snapshot: {
        element: [
          { id: "Observation", path: "Observation" },
          {
            id: "Observation.value[x]",
            path: "Observation.value[x]",
            slicing: { discriminator: [{ type: "type", path: "$this" }], rules: "open" },
          },
          {
            id: "Observation.value[x]:valueQuantity",
            path: "Observation.value[x]",
            sliceName: "valueQuantity",
          },
        ],
      },
    });
    const obs = parse({ resourceType: "Observation", valueString: "fake" });
    expect(unchecked(collectProfileIssues(obs, bare))).toEqual([
      ["Observation.value[x]", SLICE_UNCHECKED_REASONS.SLICE_UNCONSTRAINED],
    ]);
  });
});

describe("type and profile discriminators: the edges", () => {
  it("reads an empty discriminator path as the occurrence itself", () => {
    const slices = resolveSlices(
      req(valueByType.snapshot),
      req(valueByType.snapshot?.find((e) => e.id === "Observation.value[x]")),
    );
    const result = matchSlices([complex([])], slices, [{ type: "type", path: "" }], {
      occurrenceTypes: ["Quantity"],
    });
    expect(result).toEqual({ assignments: ["valueQuantity"], unchecked: false });
  });

  it("matches a slice that names several types when any one is the occurrence's", () => {
    const either = loadSd({
      resourceType: "StructureDefinition",
      url: `${BASE}value-either`,
      type: "Observation",
      snapshot: {
        element: [
          { id: "Observation", path: "Observation" },
          {
            id: "Observation.value[x]",
            path: "Observation.value[x]",
            slicing: { discriminator: [{ type: "type", path: "$this" }], rules: "open" },
          },
          {
            id: "Observation.value[x]:either",
            path: "Observation.value[x]",
            sliceName: "either",
            type: [{ code: "CodeableConcept" }, { code: "Quantity" }, { code: "string" }],
          },
        ],
      },
    });
    const slices = resolveSlices(
      req(either.snapshot),
      req(either.snapshot?.find((e) => e.id === "Observation.value[x]")),
    );
    const result = matchSlices([complex([])], slices, [{ type: "type", path: "" }], {
      occurrenceTypes: ["Quantity"],
    });
    expect(result).toEqual({ assignments: ["either"], unchecked: false });
  });

  it("walks a choice step below the sliced element", () => {
    const componentByType = loadSd({
      resourceType: "StructureDefinition",
      url: `${BASE}component-by-type`,
      type: "Observation",
      snapshot: {
        element: [
          { id: "Observation", path: "Observation" },
          {
            id: "Observation.component",
            path: "Observation.component",
            slicing: { discriminator: [{ type: "type", path: "value[x]" }], rules: "closed" },
          },
          { id: "Observation.component:q", path: "Observation.component", sliceName: "q" },
          {
            id: "Observation.component:q.value[x]",
            path: "Observation.component.value[x]",
            type: [{ code: "Quantity" }],
            slicing: { discriminator: [{ type: "type", path: "$this" }], rules: "open" },
          },
          // A re-slice's type narrows its own members and does not decide the outer slice's.
          {
            id: "Observation.component:q.value[x]:valueString",
            path: "Observation.component.value[x]",
            sliceName: "valueString",
            type: [{ code: "string" }],
          },
          {
            id: "Observation.component:q.interpretation",
            path: "Observation.component.interpretation",
            min: 1,
          },
        ],
      },
    });
    const obs = parse({
      resourceType: "Observation",
      component: [
        { code: { text: "fake-a" }, valueQuantity: { value: 1 } },
        // `fakesQuantity` is no `value[x]` variant, however its tail is spelled.
        { code: { text: "fake-b" }, valueString: "fake", fakesQuantity: {}, valuefakeQ: {} },
      ],
    });
    expect(findings(collectProfileIssues(obs, componentByType))).toEqual([
      ["PROFILE_SLICE_UNMATCHED", "Observation.component[1]"],
      ["CARDINALITY_MIN", "Observation.component[0].interpretation"],
    ]);
  });

  it("walks a repeating element into resolve(), through Bundle entries", () => {
    const grouped = loadSd({
      resourceType: "StructureDefinition",
      url: `${BASE}grouped`,
      type: "Bundle",
      snapshot: {
        element: [
          { id: "Bundle", path: "Bundle" },
          {
            id: "Bundle.entry",
            path: "Bundle.entry",
            slicing: {
              discriminator: [{ type: "type", path: "resource.hasMember.resolve()" }],
              rules: "closed",
            },
          },
          { id: "Bundle.entry:grouped", path: "Bundle.entry", sliceName: "grouped" },
          {
            id: "Bundle.entry:grouped.resource.hasMember",
            path: "Bundle.entry.resource.hasMember",
            type: [
              {
                code: "Reference",
                targetProfile: ["http://hl7.org/fhir/StructureDefinition/Observation|4.0.1"],
              },
            ],
          },
        ],
      },
    });
    const bundle = parse({
      resourceType: "Bundle",
      type: "collection",
      entry: [
        {
          fullUrl: "urn:uuid:fake-a",
          resource: {
            resourceType: "Observation",
            id: "fake-a",
            hasMember: [{ reference: "urn:uuid:fake-b" }],
          },
        },
        { fullUrl: "urn:uuid:fake-b", resource: { resourceType: "Observation", id: "fake-b" } },
      ],
    });
    expect(findings(collectProfileIssues(bundle, grouped))).toEqual([
      ["PROFILE_SLICE_UNMATCHED", "Bundle.entry[1]"],
    ]);
  });

  it("reads a core profile's canonical as a profile, not a type", () => {
    const vitals = (targetProfile: string) =>
      loadSd({
        resourceType: "StructureDefinition",
        url: `${BASE}members-vitals`,
        type: "Observation",
        snapshot: {
          element: [
            { id: "Observation", path: "Observation" },
            {
              id: "Observation.hasMember",
              path: "Observation.hasMember",
              slicing: { discriminator: [{ type: "type", path: "resolve()" }], rules: "closed" },
            },
            {
              id: "Observation.hasMember:vitals",
              path: "Observation.hasMember",
              sliceName: "vitals",
              type: [{ code: "Reference", targetProfile: [targetProfile] }],
            },
          ],
        },
      });
    const coreVitals = "http://hl7.org/fhir/StructureDefinition/vitalsigns";
    const obs = parse({
      resourceType: "Observation",
      contained: [{ resourceType: "Patient", id: "p1" }],
      hasMember: [{ reference: "#p1" }],
    });
    expect(unchecked(collectProfileIssues(obs, vitals(coreVitals)))).toEqual([
      ["Observation.hasMember", SLICE_UNCHECKED_REASONS.PROFILE_UNAVAILABLE],
    ]);
    const supplied = loadSd({
      resourceType: "StructureDefinition",
      url: coreVitals,
      type: "Observation",
      snapshot: { element: [{ id: "Observation", path: "Observation" }] },
    });
    expect(
      findings(collectProfileIssues(obs, vitals(coreVitals), { profiles: [supplied] })),
    ).toEqual([["PROFILE_SLICE_UNMATCHED", "Observation.hasMember[0]"]]);
  });

  it("leaves a slice that names no target unconstrained, and any profile slicing unchecked", () => {
    const naming = (discriminator: string, path: string, type: unknown) =>
      loadSd({
        resourceType: "StructureDefinition",
        url: `${BASE}naming-nothing`,
        type: "Observation",
        snapshot: {
          element: [
            { id: "Observation", path: "Observation" },
            {
              id: "Observation.hasMember",
              path: "Observation.hasMember",
              slicing: { discriminator: [{ type: discriminator, path }], rules: "open" },
            },
            {
              id: "Observation.hasMember:any",
              path: "Observation.hasMember",
              sliceName: "any",
              type: [type],
            },
          ],
        },
      });
    const obs = parse({
      resourceType: "Observation",
      contained: [{ resourceType: "Observation", id: "o1" }],
      hasMember: [{ reference: "#o1" }],
    });
    expect(
      unchecked(collectProfileIssues(obs, naming("type", "resolve()", { code: "Reference" }))),
    ).toEqual([["Observation.hasMember", SLICE_UNCHECKED_REASONS.SLICE_UNCONSTRAINED]]);
    for (const sd of [
      naming("profile", "resolve()", { code: "Reference" }),
      naming("profile", "$this", { code: "Reference" }),
    ]) {
      expect(unchecked(collectProfileIssues(obs, sd))).toEqual([
        ["Observation.hasMember", SLICE_UNCHECKED_REASONS.PROFILE_DISCRIMINATOR],
      ]);
    }
  });

  it("aligns the choice types of a step with its occurrences, through a list", () => {
    const parent = complex([
      { name: "valueQuantity", value: complex([]) },
      { name: "valueString", value: list([primitive("fake-a"), primitive("fake-b")]) },
      { name: "code", value: list([complex([]), complex([])]) },
      { name: "fakesQuantity", value: complex([]) },
      { name: "value", value: complex([]) },
    ]);
    expect(stepTypes(list([parent]), "value[x]")).toEqual(["Quantity", "String", "String"]);
    expect(stepTypes(parent, "code")).toEqual([undefined, undefined]);
    expect(stepTypes(parent, "absent")).toEqual([]);
    expect(stepTypes(primitive("fake"), "value[x]")).toEqual([]);
  });
});

describe("type and profile discriminators: the bounds of what is decided", () => {
  const typeSlicing = (path: string, type: unknown) =>
    loadSd({
      resourceType: "StructureDefinition",
      url: `${BASE}type-slicing`,
      type: "Observation",
      snapshot: {
        element: [
          { id: "Observation", path: "Observation" },
          {
            id: "Observation.hasMember",
            path: "Observation.hasMember",
            slicing: { discriminator: [{ type: "type", path }], rules: "closed" },
          },
          {
            id: "Observation.hasMember:one",
            path: "Observation.hasMember",
            sliceName: "one",
            type: [type],
          },
        ],
      },
    });
  const member = parse({
    resourceType: "Observation",
    contained: [{ resourceType: "Observation", id: "o1" }],
    hasMember: [{ reference: "#o1" }],
  });

  it("refuses a path step that is not a plain element name", () => {
    const sd = typeSlicing("%resolve.resolve()", {
      code: "Reference",
      targetProfile: ["http://hl7.org/fhir/StructureDefinition/Observation"],
    });
    expect(unchecked(collectProfileIssues(member, sd))).toEqual([
      ["Observation.hasMember", SLICE_UNCHECKED_REASONS.PATH_UNSUPPORTED],
    ]);
  });

  it("refuses a type code that is not a plain type name", () => {
    const systemString = loadSd({
      resourceType: "StructureDefinition",
      url: `${BASE}system-string`,
      type: "Observation",
      snapshot: {
        element: [
          { id: "Observation", path: "Observation" },
          {
            id: "Observation.value[x]",
            path: "Observation.value[x]",
            slicing: { discriminator: [{ type: "type", path: "$this" }], rules: "open" },
          },
          {
            id: "Observation.value[x]:valueString",
            path: "Observation.value[x]",
            sliceName: "valueString",
            type: [{ code: "http://hl7.org/fhirpath/System.String" }],
          },
        ],
      },
    });
    const obs = parse({ resourceType: "Observation", valueString: "fake" });
    expect(unchecked(collectProfileIssues(obs, systemString))).toEqual([
      ["Observation.value[x]", SLICE_UNCHECKED_REASONS.TYPE_UNDETERMINED],
    ]);
  });

  it("selects no choice variant whose tail is not capitalized", () => {
    const componentByType = loadSd({
      resourceType: "StructureDefinition",
      url: `${BASE}component-by-type-tail`,
      type: "Observation",
      snapshot: {
        element: [
          { id: "Observation", path: "Observation" },
          {
            id: "Observation.component",
            path: "Observation.component",
            slicing: { discriminator: [{ type: "type", path: "value[x]" }], rules: "closed" },
          },
          { id: "Observation.component:q", path: "Observation.component", sliceName: "q" },
          {
            id: "Observation.component:q.value[x]",
            path: "Observation.component.value[x]",
            type: [{ code: "Quantity" }],
          },
        ],
      },
    });
    // `valuefakeQ` is no variant: the path selects the one Quantity, so the component is decided.
    const obs = parse({
      resourceType: "Observation",
      component: [{ code: { text: "fake" }, valueQuantity: { value: 1 }, valuefakeQ: {} }],
    });
    expect(findings(collectProfileIssues(obs, componentByType))).toEqual([]);
  });

  it.each([
    "http://hl7.org/fhir/StructureDefinition/fake-Observation",
    "http://hl7.org/fhir/StructureDefinition/Observation-fake",
    // As long as a core canonical, and capitalized where a core tail would start: still not core.
    "http://example.org/StructureDefinition/xObservation",
  ])("reads only a whole capitalized core tail as a type: %s", (targetProfile) => {
    const sd = typeSlicing("resolve()", { code: "Reference", targetProfile: [targetProfile] });
    expect(unchecked(collectProfileIssues(member, sd))).toEqual([
      ["Observation.hasMember", SLICE_UNCHECKED_REASONS.PROFILE_UNAVAILABLE],
    ]);
  });

  it("names no type for a canonical whose supplied versions constrain different types", () => {
    const of = (version: string, type: string) =>
      loadSd({
        resourceType: "StructureDefinition",
        url: `${BASE}two-types`,
        version,
        type,
        snapshot: { element: [{ id: type, path: type }] },
      });
    const sd = typeSlicing("resolve()", {
      code: "Reference",
      targetProfile: [`${BASE}two-types`],
    });
    // Decided: the member is an Observation. Its conformance to the profile is not checked.
    expect(
      findings(collectProfileIssues(member, sd, { profiles: [of("1", "Observation")] })),
    ).toEqual([["PROFILE_CONSTRAINT_UNCHECKED", "Observation.hasMember"]]);
    expect(
      unchecked(
        collectProfileIssues(member, sd, {
          profiles: [of("1", "Observation"), of("2", "Patient")],
        }),
      ),
    ).toEqual([["Observation.hasMember", SLICE_UNCHECKED_REASONS.PROFILE_UNAVAILABLE]]);
  });

  it("reads the type of a resource held in place at $this", () => {
    const containedByType = loadSd({
      resourceType: "StructureDefinition",
      url: `${BASE}contained-by-type`,
      type: "Observation",
      snapshot: {
        element: [
          { id: "Observation", path: "Observation" },
          {
            id: "Observation.contained",
            path: "Observation.contained",
            slicing: { discriminator: [{ type: "type", path: "$this" }], rules: "closed" },
          },
          {
            id: "Observation.contained:patient",
            path: "Observation.contained",
            sliceName: "patient",
            type: [{ code: "Patient" }],
          },
        ],
      },
    });
    const obs = parse({
      resourceType: "Observation",
      contained: [
        { resourceType: "Patient", id: "p1" },
        { resourceType: "Organization", id: "g1" },
      ],
    });
    expect(findings(collectProfileIssues(obs, containedByType))).toEqual([
      ["PROFILE_SLICE_UNMATCHED", "Observation.contained[1]"],
    ]);
  });

  it("decides nothing from a slice definition that carries no types", () => {
    const bare = {
      sliceName: "bare",
      constraints: [],
      existsExpectations: new Map(),
      unsatisfiableExists: new Set<string>(),
    };
    const result = matchSlices([complex([])], [bare], [{ type: "type", path: "$this" }]);
    expect(result.reason).toBe(SLICE_UNCHECKED_REASONS.SLICE_UNCONSTRAINED);
  });

  it("resolves nothing, and looks up no profile, without an environment", () => {
    const slicesFor = (sd: StructureDefinition) =>
      resolveSlices(
        req(sd.snapshot),
        req(sd.snapshot?.find((e) => e.id === "Observation.hasMember")),
      );
    const reference = complex([{ name: "reference", value: primitive("#o1") }]);
    const core = typeSlicing("resolve()", {
      code: "Reference",
      targetProfile: ["http://hl7.org/fhir/StructureDefinition/Observation"],
    });
    expect(
      matchSlices([reference], slicesFor(core), [{ type: "type", path: "resolve()" }]).reason,
    ).toBe(SLICE_UNCHECKED_REASONS.TARGET_UNRESOLVED);
    const named = typeSlicing("resolve()", {
      code: "Reference",
      targetProfile: [`${BASE}not-supplied`],
    });
    expect(
      matchSlices([reference], slicesFor(named), [{ type: "type", path: "resolve()" }]).reason,
    ).toBe(SLICE_UNCHECKED_REASONS.PROFILE_UNAVAILABLE);
  });

  it("resolves into Bundle entries only from a Bundle", () => {
    // Not a Bundle, so an `entry` it carries is not a closure, whatever it holds.
    const obs = parse({
      resourceType: "Observation",
      entry: [
        { fullUrl: "urn:uuid:fake-a", resource: { resourceType: "Observation", id: "fake-a" } },
      ],
      hasMember: [{ reference: "urn:uuid:fake-a" }],
    });
    expect(unchecked(collectProfileIssues(obs, memberByType))).toEqual([
      ["Observation.hasMember", SLICE_UNCHECKED_REASONS.TARGET_UNRESOLVED],
    ]);
  });

  it("reads a target profile's type from the supplied set, else the base resolver, at the version pinned", () => {
    const pinned = (version: string) =>
      loadSd({
        resourceType: "StructureDefinition",
        url: `${BASE}performer-pinned`,
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
              id: "Observation.performer:patient",
              path: "Observation.performer",
              sliceName: "patient",
              type: [{ code: "Reference", targetProfile: [`${BASE}gendered-patient${version}`] }],
            },
          ],
        },
      });
    const obs = parse({
      resourceType: "Observation",
      contained: [
        { resourceType: "Patient", id: "p1" },
        { resourceType: "Group", id: "g1" },
      ],
      performer: [{ reference: "#p1" }, { reference: "#g1" }],
    });
    // The Patient is assigned to the slice; its conformance to the slice's profile is not checked.
    const decided = [
      ["PROFILE_SLICE_UNMATCHED", "Observation.performer[1]"],
      ["PROFILE_CONSTRAINT_UNCHECKED", "Observation.performer[0]"],
    ];
    const unavailable = [["Observation.performer", SLICE_UNCHECKED_REASONS.PROFILE_UNAVAILABLE]];
    const resolve = (url: string) => (url === genderedPatient.url ? genderedPatient : undefined);
    const profiles = [genderedPatient];
    for (const version of ["", "|1.0.0"]) {
      expect(findings(collectProfileIssues(obs, pinned(version), { profiles }))).toEqual(decided);
      expect(findings(collectProfileIssues(obs, pinned(version), { resolve }))).toEqual(decided);
    }
    expect(unchecked(collectProfileIssues(obs, pinned("|2.0.0"), { profiles }))).toEqual(
      unavailable,
    );
    expect(unchecked(collectProfileIssues(obs, pinned("|2.0.0"), { resolve }))).toEqual(
      unavailable,
    );
    // The supplied set is read first: the resolver is not asked for a profile it carries.
    const refusing = () => {
      throw new Error("fake resolver asked");
    };
    expect(
      findings(collectProfileIssues(obs, pinned(""), { profiles, resolve: refusing })),
    ).toEqual(decided);
  });
});

describe("type and profile discriminators: what a walk meets that is not an element", () => {
  it("resolves nothing from a reference that is not an object", () => {
    const obs = parse({
      resourceType: "Observation",
      contained: [{ resourceType: "Observation", id: "o1" }],
      hasMember: ["#o1"],
    });
    expect(unchecked(collectProfileIssues(obs, memberByType))).toEqual([
      ["Observation.hasMember", SLICE_UNCHECKED_REASONS.TARGET_UNRESOLVED],
    ]);
  });
});

describe("type and profile discriminators: each of several", () => {
  it("reports unchecked when any one of several discriminators is unsupported", () => {
    const result = matchSlices(
      [complex([])],
      [],
      [
        { type: "value", path: "code" },
        { type: "position", path: "$this" },
      ],
    );
    expect(result.reason).toBe(SLICE_UNCHECKED_REASONS.DISCRIMINATOR_UNSUPPORTED);
  });

  it("refuses a slice naming an abstract type beside a concrete one", () => {
    const mixed = loadSd({
      resourceType: "StructureDefinition",
      url: `${BASE}mixed-types`,
      type: "Bundle",
      snapshot: {
        element: [
          { id: "Bundle", path: "Bundle" },
          {
            id: "Bundle.entry",
            path: "Bundle.entry",
            slicing: { discriminator: [{ type: "type", path: "resource" }], rules: "closed" },
          },
          { id: "Bundle.entry:any", path: "Bundle.entry", sliceName: "any" },
          {
            id: "Bundle.entry:any.resource",
            path: "Bundle.entry.resource",
            type: [{ code: "Patient" }, { code: "Resource" }],
          },
        ],
      },
    });
    const bundle = parse({
      resourceType: "Bundle",
      type: "collection",
      entry: [{ resource: { resourceType: "Patient", id: "fake-1" } }],
    });
    expect(unchecked(collectProfileIssues(bundle, mixed))).toEqual([
      ["Bundle.entry", SLICE_UNCHECKED_REASONS.TYPE_UNDETERMINED],
    ]);
  });

  it("matches a value discriminator on any one of several values at its path", () => {
    const byCode = loadSd({
      resourceType: "StructureDefinition",
      url: `${BASE}by-code`,
      type: "Observation",
      snapshot: {
        element: [
          { id: "Observation", path: "Observation" },
          {
            id: "Observation.category",
            path: "Observation.category",
            slicing: { discriminator: [{ type: "value", path: "coding.code" }], rules: "closed" },
          },
          { id: "Observation.category:fake", path: "Observation.category", sliceName: "fake" },
          {
            id: "Observation.category:fake.coding.code",
            path: "Observation.category.coding.code",
            fixedCode: "fake-b",
          },
        ],
      },
    });
    const obs = parse({
      resourceType: "Observation",
      category: [{ coding: [{ code: "fake-a" }, { code: "fake-b" }] }],
    });
    // A member, so not unmatched; and as a member, its other coding breaks the slice's fixed code.
    expect(findings(collectProfileIssues(obs, byCode))).toEqual([
      ["PROFILE_FIXED_MISMATCH", "Observation.category.coding[0].code"],
    ]);
  });
});

describe("a type or profile discriminator path that selects more than one node", () => {
  /** A closed Bundle slicing on `entry` at `resource.contained`, slice `x` typed or profiled. */
  const byContained = (kind: "type" | "profile", type: Record<string, unknown>) =>
    loadSd({
      resourceType: "StructureDefinition",
      url: `${BASE}bundle-contained-${kind}`,
      type: "Bundle",
      snapshot: {
        element: [
          { id: "Bundle", path: "Bundle" },
          {
            id: "Bundle.entry",
            path: "Bundle.entry",
            slicing: {
              discriminator: [{ type: kind, path: "resource.contained" }],
              rules: "closed",
            },
          },
          { id: "Bundle.entry:x", path: "Bundle.entry", sliceName: "x", min: 0, max: "1" },
          {
            id: "Bundle.entry:x.resource.contained",
            path: "Bundle.entry.resource.contained",
            type: [type],
          },
        ],
      },
    });
  const bundleWith = (contained: Record<string, unknown>[]) =>
    parse({
      resourceType: "Bundle",
      type: "collection",
      entry: [
        {
          fullUrl: "urn:uuid:fake-1",
          resource: {
            resourceType: "Patient",
            id: "fake-p",
            contained,
            managingOrganization: { reference: "#o1" },
            ...(contained.length > 1 ? { generalPractitioner: [{ reference: "#p1" }] } : {}),
          },
        },
      ],
    });
  const organization = { resourceType: "Organization", id: "o1", name: "Fake Org" };
  const practitioner = { resourceType: "Practitioner", id: "p1" };

  it("decides nothing by type, instead of matching when any one node does", () => {
    const result = validateResource(bundleWith([organization, practitioner]), {
      profiles: [byContained("type", { code: "Organization" })],
    });
    expect(unchecked(result.issues)).toEqual([
      ["Bundle.entry", SLICE_UNCHECKED_REASONS.PATH_UNSUPPORTED],
    ]);
  });

  it("leaves a profile discriminator over several nodes unchecked, as any profile one", () => {
    // Two contained Observations: the first keeps the profile's fixed status, the second breaks it.
    const finalOnly = loadSd({
      resourceType: "StructureDefinition",
      url: `${BASE}fake-final-obs`,
      type: "Observation",
      snapshot: {
        element: [
          { id: "Observation", path: "Observation" },
          { id: "Observation.status", path: "Observation.status", fixedCode: "final" },
        ],
      },
    });
    const bundle = parse({
      resourceType: "Bundle",
      type: "collection",
      entry: [
        {
          fullUrl: "urn:uuid:fake-1",
          resource: {
            ...anObservation,
            id: "fake-root",
            contained: [
              { ...anObservation, id: "o1" },
              { ...anObservation, id: "o2", status: "preliminary" },
            ],
            hasMember: [{ reference: "#o1" }, { reference: "#o2" }],
          },
        },
      ],
    });
    const result = validateResource(bundle, {
      profiles: [
        byContained("profile", { code: "Observation", profile: [finalOnly.url] }),
        finalOnly,
      ],
    });
    expect(unchecked(result.issues)).toEqual([
      ["Bundle.entry", SLICE_UNCHECKED_REASONS.PROFILE_DISCRIMINATOR],
    ]);
  });

  it("places an occurrence with nothing at the path in no slice", () => {
    const result = validateResource(bundleWith([]), {
      profiles: [byContained("type", { code: "Organization" })],
    });
    expect(unchecked(result.issues)).toEqual([]);
    // With nothing contained, `#o1` names no resource, which R4's `ref-1` forbids.
    expect(
      result.issues.filter((i) => i.severity === "error").map((i) => [i.code, i.expression]),
    ).toEqual([
      ["INVARIANT_VIOLATED", "Bundle.entry[0].resource.managingOrganization"],
      ["PROFILE_SLICE_UNMATCHED", "Bundle.entry[0]"],
    ]);
  });

  it("assigns nothing by profile, so an entry with nothing at the path draws no finding", () => {
    const finalOnly = loadSd({
      resourceType: "StructureDefinition",
      url: `${BASE}fake-final-obs`,
      type: "Observation",
      snapshot: { element: [{ id: "Observation", path: "Observation" }] },
    });
    const result = validateResource(bundleWith([]), {
      profiles: [
        byContained("profile", { code: "Observation", profile: [finalOnly.url] }),
        finalOnly,
      ],
    });
    expect(unchecked(result.issues)).toEqual([
      ["Bundle.entry", SLICE_UNCHECKED_REASONS.PROFILE_DISCRIMINATOR],
    ]);
    // The one error is `ref-1`: with nothing contained, `#o1` names no resource.
    expect(
      result.issues.filter((i) => i.severity === "error").map((i) => [i.code, i.constraint]),
    ).toEqual([["INVARIANT_VIOLATED", "ref-1"]]);
  });

  it("still decides a path that selects one node", () => {
    const typed = validateResource(bundleWith([organization]), {
      profiles: [byContained("type", { code: "Organization" })],
    });
    expect(unchecked(typed.issues)).toEqual([]);
    expect(typed.issues.filter((i) => i.severity === "error")).toEqual([]);
  });
});
