import { describe, expect, it } from "vitest";

import {
  collectProfileIssues,
  loadStructureDefinition,
  parseResource,
  SLICE_UNCHECKED_REASONS,
  validateResource,
  type FhirComplex,
  type StructureDefinition,
  type ValidationIssue,
} from "../src/index.js";
import { req } from "./_util.js";

/**
 * A `profile` slicing discriminator asks whether a resource conforms to the profile a slice names.
 * The answer is "yes" only when every layer validateResource runs finds no error and left nothing
 * unchecked: the profile's own invariants, the base layers, and what no layer checks (a required
 * binding, a type profile) leave it undecided. Every profile and document here is synthetic:
 * example.org canonicals, plainly fake ids and codes.
 */

function loadSd(obj: unknown): StructureDefinition {
  return req(loadStructureDefinition(parseResource(JSON.stringify(obj)).resource));
}

function parse(obj: unknown): FhirComplex {
  return parseResource(JSON.stringify(obj)).resource;
}

/** Each error finding as `[code, location]`. */
function errors(issues: readonly ValidationIssue[]): [string, string][] {
  return issues.filter((i) => i.severity === "error").map((i) => [i.code, i.expression]);
}

/** The `PROFILE_SLICE_UNCHECKED` findings, each with its reason. */
function unchecked(issues: readonly ValidationIssue[]): [string, string | undefined][] {
  return issues
    .filter((i) => i.code === "PROFILE_SLICE_UNCHECKED")
    .map((i) => [i.expression, i.sliceReason]);
}

const BASE = "http://example.org/StructureDefinition/";

/** A Patient profile `Q` whose one constraint is an invariant of the given severity and expression. */
function patientWith(key: string, severity: string, expression: string): StructureDefinition {
  return loadSd({
    resourceType: "StructureDefinition",
    url: `${BASE}patient-q`,
    type: "Patient",
    snapshot: {
      element: [
        { id: "Patient", path: "Patient", constraint: [{ key, severity, expression }] },
        { id: "Patient.gender", path: "Patient.gender", min: 0, max: "1" },
      ],
    },
  });
}

/** The reviewer's profile `Q`: a Patient must have a name, at error severity. */
const named = patientWith("fake-1", "error", "name.exists()");

/** A closed Bundle slicing on `entry` by the profile of its `resource`, slice `pat` required. */
const bundleByProfile = loadSd({
  resourceType: "StructureDefinition",
  url: `${BASE}bundle-by-profile`,
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
        type: [{ code: "Patient", profile: [`${BASE}patient-q`] }],
      },
    ],
  },
});

function bundleOf(patient: Record<string, unknown>): FhirComplex {
  return parse({
    resourceType: "Bundle",
    type: "collection",
    entry: [{ fullUrl: "urn:uuid:fake-1", resource: { resourceType: "Patient", ...patient } }],
  });
}

const NO_SLICE: [string, string][] = [
  ["PROFILE_SLICE_UNMATCHED", "Bundle.entry[0]"],
  ["CARDINALITY_MIN", "Bundle.entry:pat"],
];

describe("a slice profile's error invariant decides that a target does not conform", () => {
  it("leaves a Bundle entry that breaks it in no slice, and the slice's minimum unmet", () => {
    const result = validateResource(bundleOf({ id: "fake-1" }), {
      profiles: [bundleByProfile, named],
    });
    expect(errors(result.issues)).toEqual(NO_SLICE);
    expect(result.valid).toBe(false);
    expect(unchecked(result.issues)).toEqual([]);
  });

  it("assigns a Bundle entry that keeps it", () => {
    const result = validateResource(bundleOf({ id: "fake-1", name: [{ family: "Synthfamily" }] }), {
      profiles: [bundleByProfile, named],
    });
    expect(errors(result.issues)).toEqual([]);
    expect(unchecked(result.issues)).toEqual([]);
  });

  it("decides the same through collectProfileIssues", () => {
    const issues = collectProfileIssues(bundleOf({ id: "fake-1" }), bundleByProfile, {
      profiles: [named],
    });
    expect(errors(issues)).toEqual(NO_SLICE);
  });

  it("decides the same for a contained resource", () => {
    const byContained = loadSd({
      resourceType: "StructureDefinition",
      url: `${BASE}contained-by-profile`,
      type: "Observation",
      snapshot: {
        element: [
          { id: "Observation", path: "Observation" },
          {
            id: "Observation.contained",
            path: "Observation.contained",
            slicing: { discriminator: [{ type: "profile", path: "$this" }], rules: "closed" },
          },
          {
            id: "Observation.contained:pat",
            path: "Observation.contained",
            sliceName: "pat",
            min: 1,
            type: [{ code: "Patient", profile: [`${BASE}patient-q`] }],
          },
        ],
      },
    });
    const doc = (patient: Record<string, unknown>) =>
      parse({
        resourceType: "Observation",
        status: "final",
        code: { text: "fake code" },
        contained: [{ resourceType: "Patient", id: "p1", ...patient }],
        subject: { reference: "#p1" },
      });
    const profiles = [named];
    expect(errors(collectProfileIssues(doc({}), byContained, { profiles }))).toEqual([
      ["PROFILE_SLICE_UNMATCHED", "Observation.contained[0]"],
      ["CARDINALITY_MIN", "Observation.contained:pat"],
    ]);
    expect(
      errors(
        collectProfileIssues(doc({ name: [{ family: "Synthfamily" }] }), byContained, { profiles }),
      ),
    ).toEqual([]);
  });

  it("decides the same for the target a resolve() reaches", () => {
    const byPerformer = loadSd({
      resourceType: "StructureDefinition",
      url: `${BASE}performer-by-q`,
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
            id: "Observation.performer:pat",
            path: "Observation.performer",
            sliceName: "pat",
            min: 1,
            type: [{ code: "Reference", targetProfile: [`${BASE}patient-q`] }],
          },
        ],
      },
    });
    const doc = (patient: Record<string, unknown>) =>
      parse({
        resourceType: "Bundle",
        type: "collection",
        entry: [
          {
            fullUrl: "urn:uuid:fake-p",
            resource: { resourceType: "Patient", id: "fake-p", ...patient },
          },
          {
            fullUrl: "urn:uuid:fake-o",
            resource: {
              resourceType: "Observation",
              id: "fake-o",
              status: "final",
              code: { text: "fake code" },
              performer: [{ reference: "urn:uuid:fake-p" }],
            },
          },
        ],
      });
    // The performer slicing sits on the Observation entry: check it through a Bundle profile that
    // slices the entry by the Observation profile, so the reference resolves among the entries.
    const outer = loadSd({
      resourceType: "StructureDefinition",
      url: `${BASE}bundle-by-observation`,
      type: "Bundle",
      snapshot: {
        element: [
          { id: "Bundle", path: "Bundle" },
          {
            id: "Bundle.entry",
            path: "Bundle.entry",
            slicing: { discriminator: [{ type: "profile", path: "resource" }], rules: "open" },
          },
          { id: "Bundle.entry:obs", path: "Bundle.entry", sliceName: "obs", min: 1 },
          {
            id: "Bundle.entry:obs.resource",
            path: "Bundle.entry.resource",
            type: [{ code: "Observation", profile: [`${BASE}performer-by-q`] }],
          },
        ],
      },
    });
    const profiles = [named, byPerformer];
    expect(errors(collectProfileIssues(doc({}), outer, { profiles }))).toEqual([
      ["CARDINALITY_MIN", "Bundle.entry:obs"],
    ]);
    expect(
      errors(collectProfileIssues(doc({ name: [{ family: "Synthfamily" }] }), outer, { profiles })),
    ).toEqual([]);
  });
});

describe("what a slice profile's invariant leaves undecided, and what it does not", () => {
  it("leaves the slicing undecided when the invariant cannot be evaluated", () => {
    const unevaluable = patientWith("fake-2", "error", "link.other.resolve().active.exists()");
    const result = validateResource(
      bundleOf({
        id: "fake-1",
        link: [{ other: { reference: "Patient/fake-9" }, type: "seealso" }],
      }),
      { profiles: [bundleByProfile, unevaluable] },
    );
    expect(unchecked(result.issues)).toEqual([
      ["Bundle.entry", SLICE_UNCHECKED_REASONS.PROFILE_UNDECIDED],
    ]);
    expect(errors(result.issues)).toEqual([]);
  });

  it("does not decide on a warning-level invariant", () => {
    const warned = patientWith("fake-3", "warning", "name.exists()");
    const result = validateResource(bundleOf({ id: "fake-1" }), {
      profiles: [bundleByProfile, warned],
    });
    expect(errors(result.issues)).toEqual([]);
    expect(unchecked(result.issues)).toEqual([]);
  });
});

describe("the other layers of a nested profile check", () => {
  /** A profile `Q` with the given extra snapshot elements under the Patient root. */
  const patientQ = (elements: unknown[]) =>
    loadSd({
      resourceType: "StructureDefinition",
      url: `${BASE}patient-q`,
      type: "Patient",
      snapshot: { element: [{ id: "Patient", path: "Patient" }, ...elements] },
    });

  it("decides no on a base value-domain error in the target", () => {
    const result = validateResource(bundleOf({ id: "fake-1", gender: "fakegender" }), {
      profiles: [bundleByProfile, patientQ([])],
    });
    expect(errors(result.issues)).toEqual(NO_SLICE);
  });

  it("decides no on a base cardinality error in the target", () => {
    const observationQ = loadSd({
      resourceType: "StructureDefinition",
      url: `${BASE}patient-q`,
      type: "Observation",
      snapshot: { element: [{ id: "Observation", path: "Observation" }] },
    });
    const bundle = parse({
      resourceType: "Bundle",
      type: "collection",
      entry: [{ fullUrl: "urn:uuid:fake-1", resource: { resourceType: "Observation", id: "o" } }],
    });
    const bundleByObservation = loadSd({
      resourceType: "StructureDefinition",
      url: `${BASE}bundle-by-observation-q`,
      type: "Bundle",
      snapshot: {
        element: [
          { id: "Bundle", path: "Bundle" },
          {
            id: "Bundle.entry",
            path: "Bundle.entry",
            slicing: { discriminator: [{ type: "profile", path: "resource" }], rules: "closed" },
          },
          { id: "Bundle.entry:obs", path: "Bundle.entry", sliceName: "obs", min: 1 },
          {
            id: "Bundle.entry:obs.resource",
            path: "Bundle.entry.resource",
            type: [{ code: "Observation", profile: [`${BASE}patient-q`] }],
          },
        ],
      },
    });
    expect(
      errors(collectProfileIssues(bundle, bundleByObservation, { profiles: [observationQ] })),
    ).toEqual([
      ["PROFILE_SLICE_UNMATCHED", "Bundle.entry[0]"],
      ["CARDINALITY_MIN", "Bundle.entry:obs"],
    ]);
  });

  it("decides no on a fixed value the target breaks", () => {
    const fixed = patientQ([
      { id: "Patient.gender", path: "Patient.gender", fixedCode: "unknown" },
    ]);
    const result = validateResource(bundleOf({ id: "fake-1", gender: "other" }), {
      profiles: [bundleByProfile, fixed],
    });
    expect(errors(result.issues)).toEqual(NO_SLICE);
  });

  it("leaves undecided a required binding to a value set no layer checks", () => {
    const bound = patientQ([
      {
        id: "Patient.maritalStatus",
        path: "Patient.maritalStatus",
        binding: { strength: "required", valueSet: "http://example.org/ValueSet/fake-marital" },
      },
    ]);
    const present = validateResource(
      bundleOf({ id: "fake-1", maritalStatus: { text: "fake status" } }),
      { profiles: [bundleByProfile, bound] },
    );
    expect(unchecked(present.issues)).toEqual([
      ["Bundle.entry", SLICE_UNCHECKED_REASONS.PROFILE_UNDECIDED],
    ]);
    // Absent, the binding asks nothing of the target.
    const absent = validateResource(bundleOf({ id: "fake-1" }), {
      profiles: [bundleByProfile, bound],
    });
    expect(unchecked(absent.issues)).toEqual([]);
  });

  it("takes a base required binding on a code element as the schema's", () => {
    const bound = patientQ([
      {
        id: "Patient.gender",
        path: "Patient.gender",
        binding: {
          strength: "required",
          valueSet: "http://hl7.org/fhir/ValueSet/administrative-gender|4.0.1",
        },
      },
    ]);
    const result = validateResource(bundleOf({ id: "fake-1", gender: "other" }), {
      profiles: [bundleByProfile, bound],
    });
    expect(unchecked(result.issues)).toEqual([]);
    expect(errors(result.issues)).toEqual([]);
  });

  it("leaves undecided a required binding to another value set on that element", () => {
    const bound = patientQ([
      {
        id: "Patient.gender",
        path: "Patient.gender",
        binding: { strength: "required", valueSet: "http://example.org/ValueSet/fake-gender" },
      },
    ]);
    const result = validateResource(bundleOf({ id: "fake-1", gender: "other" }), {
      profiles: [bundleByProfile, bound],
    });
    expect(unchecked(result.issues)).toEqual([
      ["Bundle.entry", SLICE_UNCHECKED_REASONS.PROFILE_UNDECIDED],
    ]);
  });

  it("decides past a weaker binding, which never decides conformance", () => {
    const bound = patientQ([
      {
        id: "Patient.maritalStatus",
        path: "Patient.maritalStatus",
        binding: { strength: "extensible", valueSet: "http://example.org/ValueSet/fake-marital" },
      },
    ]);
    const result = validateResource(
      bundleOf({ id: "fake-1", maritalStatus: { text: "fake status" } }),
      { profiles: [bundleByProfile, bound] },
    );
    expect(unchecked(result.issues)).toEqual([]);
  });

  it("leaves undecided an extension whose definition no layer checks", () => {
    const extended = patientQ([
      {
        id: "Patient.extension",
        path: "Patient.extension",
        slicing: { discriminator: [{ type: "value", path: "url" }], rules: "open" },
      },
      {
        id: "Patient.extension:fake",
        path: "Patient.extension",
        sliceName: "fake",
        type: [{ code: "Extension", profile: ["http://example.org/StructureDefinition/fake-ext"] }],
      },
      {
        id: "Patient.extension:fake.url",
        path: "Patient.extension.url",
        fixedUri: "http://example.org/StructureDefinition/fake-ext",
      },
    ]);
    const present = validateResource(
      bundleOf({
        id: "fake-1",
        extension: [{ url: "http://example.org/StructureDefinition/fake-ext", valueString: "x" }],
      }),
      { profiles: [bundleByProfile, extended] },
    );
    expect(unchecked(present.issues)).toEqual([
      ["Bundle.entry", SLICE_UNCHECKED_REASONS.PROFILE_UNDECIDED],
    ]);
    const absent = validateResource(bundleOf({ id: "fake-1" }), {
      profiles: [bundleByProfile, extended],
    });
    expect(unchecked(absent.issues)).toEqual([]);
  });

  it("leaves undecided a target of a type the schema does not model", () => {
    const groupQ = loadSd({
      resourceType: "StructureDefinition",
      url: `${BASE}patient-q`,
      type: "Group",
      snapshot: {
        element: [
          { id: "Group", path: "Group" },
          {
            id: "Group.type",
            path: "Group.type",
            binding: {
              strength: "required",
              valueSet: "http://hl7.org/fhir/ValueSet/group-type|4.0.1",
            },
          },
        ],
      },
    });
    const byGroup = loadSd({
      resourceType: "StructureDefinition",
      url: `${BASE}bundle-by-group`,
      type: "Bundle",
      snapshot: {
        element: [
          { id: "Bundle", path: "Bundle" },
          {
            id: "Bundle.entry",
            path: "Bundle.entry",
            slicing: { discriminator: [{ type: "profile", path: "resource" }], rules: "closed" },
          },
          { id: "Bundle.entry:g", path: "Bundle.entry", sliceName: "g", min: 1 },
          {
            id: "Bundle.entry:g.resource",
            path: "Bundle.entry.resource",
            type: [{ code: "Group", profile: [`${BASE}patient-q`] }],
          },
        ],
      },
    });
    const bundle = parse({
      resourceType: "Bundle",
      type: "collection",
      entry: [
        {
          fullUrl: "urn:uuid:fake-1",
          // No `type`, so the profile's binding on it asks nothing: only the type is left unchecked.
          resource: { resourceType: "Group", id: "g", actual: true },
        },
      ],
    });
    expect(unchecked(collectProfileIssues(bundle, byGroup, { profiles: [groupQ] }))).toEqual([
      ["Bundle.entry", SLICE_UNCHECKED_REASONS.PROFILE_UNDECIDED],
    ]);
  });

  it("leaves undecided a required binding below the resource's own elements", () => {
    // The schema enumerates `Patient.gender`, never `Patient.contact.gender`: a base value set there
    // is a binding no layer checks.
    const bound = patientQ([
      {
        id: "Patient.contact.gender",
        path: "Patient.contact.gender",
        binding: {
          strength: "required",
          valueSet: "http://hl7.org/fhir/ValueSet/administrative-gender|4.0.1",
        },
      },
    ]);
    const result = validateResource(
      bundleOf({ id: "fake-1", contact: [{ gender: "other", name: { family: "Synthfamily" } }] }),
      { profiles: [bundleByProfile, bound] },
    );
    expect(unchecked(result.issues)).toEqual([
      ["Bundle.entry", SLICE_UNCHECKED_REASONS.PROFILE_UNDECIDED],
    ]);
  });

  it("leaves undecided a required binding that names no value set", () => {
    const bound = patientQ([
      { id: "Patient.gender", path: "Patient.gender", binding: { strength: "required" } },
    ]);
    const result = validateResource(bundleOf({ id: "fake-1", gender: "other" }), {
      profiles: [bundleByProfile, bound],
    });
    expect(unchecked(result.issues)).toEqual([
      ["Bundle.entry", SLICE_UNCHECKED_REASONS.PROFILE_UNDECIDED],
    ]);
  });

  it("leaves undecided an element any one of whose types names a profile", () => {
    const choice = patientQ([
      {
        id: "Patient.deceased[x]",
        path: "Patient.deceased[x]",
        type: [{ code: "boolean" }, { code: "dateTime", profile: [`${BASE}fake-datetime`] }],
      },
    ]);
    const result = validateResource(bundleOf({ id: "fake-1", deceasedBoolean: false }), {
      profiles: [bundleByProfile, choice],
    });
    expect(unchecked(result.issues)).toEqual([
      ["Bundle.entry", SLICE_UNCHECKED_REASONS.PROFILE_UNDECIDED],
    ]);
  });

  it("decides past a type that names no profile", () => {
    const typed = patientQ([
      { id: "Patient.gender", path: "Patient.gender", type: [{ code: "code" }] },
    ]);
    const result = validateResource(bundleOf({ id: "fake-1", gender: "other" }), {
      profiles: [bundleByProfile, typed],
    });
    expect(unchecked(result.issues)).toEqual([]);
    expect(errors(result.issues)).toEqual([]);
  });

  it("generates the slice profile's snapshot through the base resolver for what it leaves out", () => {
    const base = loadSd({
      resourceType: "StructureDefinition",
      url: `${BASE}fake-base-patient`,
      type: "Patient",
      snapshot: {
        element: [
          { id: "Patient", path: "Patient" },
          { id: "Patient.maritalStatus", path: "Patient.maritalStatus" },
        ],
      },
    });
    const differentialOnly = loadSd({
      resourceType: "StructureDefinition",
      url: `${BASE}patient-q`,
      type: "Patient",
      baseDefinition: base.url,
      differential: {
        element: [
          {
            id: "Patient.maritalStatus",
            path: "Patient.maritalStatus",
            binding: { strength: "required", valueSet: "http://example.org/ValueSet/fake-marital" },
          },
        ],
      },
    });
    const resolveBase = (url: string) => (url === base.url ? base : undefined);
    const result = validateResource(
      bundleOf({ id: "fake-1", maritalStatus: { text: "fake status" } }),
      { profiles: [bundleByProfile, differentialOnly], resolveBase },
    );
    expect(unchecked(result.issues)).toEqual([
      ["Bundle.entry", SLICE_UNCHECKED_REASONS.PROFILE_UNDECIDED],
    ]);
  });
});

describe("an invariant on a slice a profile discriminator decides", () => {
  it("is evaluated on the decided members at the top level", () => {
    const withSliceInvariant = loadSd({
      resourceType: "StructureDefinition",
      url: `${BASE}bundle-slice-invariant`,
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
            type: [{ code: "Patient", profile: [`${BASE}patient-q`] }],
          },
          {
            id: "Bundle.entry:pat.search",
            path: "Bundle.entry.search",
            constraint: [{ key: "fake-4", severity: "error", expression: "mode.exists()" }],
          },
        ],
      },
    });
    const bundle = parse({
      resourceType: "Bundle",
      type: "searchset",
      entry: [
        {
          fullUrl: "urn:uuid:fake-1",
          resource: { resourceType: "Patient", id: "fake-1", name: [{ family: "Synthfamily" }] },
          search: { score: 1 },
        },
      ],
    });
    const result = validateResource(bundle, { profiles: [withSliceInvariant, named] });
    expect(
      result.issues
        .filter((i) => i.code === "INVARIANT_VIOLATED")
        .map((i) => [i.constraint, i.expression]),
    ).toEqual([["fake-4", "Bundle.entry.search"]]);
  });
});
