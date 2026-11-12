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
import { SliceScope } from "../src/profiles/scope.js";
import { constraintKinds } from "../src/profiles/validate-profile.js";
import { builtInSchema } from "../src/validate/validate.js";
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

  it("decides past a preferred or example binding, which asks nothing of an instance", () => {
    for (const strength of ["preferred", "example"]) {
      const bound = patientQ([
        {
          id: "Patient.maritalStatus",
          path: "Patient.maritalStatus",
          binding: { strength, valueSet: "http://example.org/ValueSet/fake-marital" },
        },
      ]);
      const result = validateResource(
        bundleOf({ id: "fake-1", maritalStatus: { text: "fake status" } }),
        { profiles: [bundleByProfile, bound] },
      );
      expect(unchecked(result.issues)).toEqual([]);
    }
  });

  it("leaves undecided an extensible binding no layer checks", () => {
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
    expect(unchecked(result.issues)).toEqual([
      ["Bundle.entry", SLICE_UNCHECKED_REASONS.PROFILE_UNDECIDED],
    ]);
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

describe("what the nested check may call conforming", () => {
  /** A closed Bundle slicing on `entry` by the profile of its `resource`: slice `x`, required. */
  const bundleBy = (type: string, target: string) =>
    loadSd({
      resourceType: "StructureDefinition",
      url: `${BASE}bundle-${type}`,
      type: "Bundle",
      snapshot: {
        element: [
          { id: "Bundle", path: "Bundle" },
          {
            id: "Bundle.entry",
            path: "Bundle.entry",
            slicing: { discriminator: [{ type: "profile", path: "resource" }], rules: "closed" },
          },
          { id: "Bundle.entry:x", path: "Bundle.entry", sliceName: "x", min: 1, max: "1" },
          {
            id: "Bundle.entry:x.resource",
            path: "Bundle.entry.resource",
            type: [{ code: type, profile: [target] }],
          },
        ],
      },
    });
  const entry = (resource: Record<string, unknown>) =>
    parse({
      resourceType: "Bundle",
      type: "collection",
      entry: [{ fullUrl: "urn:uuid:fake-1", resource }],
    });
  const profileOf = (type: string, name: string, elements: unknown[]) =>
    loadSd({
      resourceType: "StructureDefinition",
      url: `${BASE}${name}`,
      type,
      snapshot: { element: [{ id: type, path: type }, ...elements] },
    });
  const UNDECIDED: [string, string][] = [
    ["Bundle.entry", SLICE_UNCHECKED_REASONS.PROFILE_UNDECIDED],
  ];
  const observation = (rest: Record<string, unknown>) => ({
    resourceType: "Observation",
    id: "fake-o",
    status: "final",
    code: { text: "Synthetic test" },
    ...rest,
  });

  it("leaves undecided a required binding to a base value set other than the schema's", () => {
    // Every observation-status code is a DiagnosticReport status, so the profile narrows the codes
    // the schema enumerates there: `partial` passes the schema and breaks the profile.
    const narrowed = profileOf("DiagnosticReport", "dr-q", [
      {
        id: "DiagnosticReport.status",
        path: "DiagnosticReport.status",
        min: 1,
        max: "1",
        type: [{ code: "code" }],
        binding: {
          strength: "required",
          valueSet: "http://hl7.org/fhir/ValueSet/observation-status",
        },
      },
    ]);
    const report = (status: string) =>
      entry({
        resourceType: "DiagnosticReport",
        id: "fake-dr",
        status,
        code: { text: "Synthetic panel" },
      });
    const profiles = [bundleBy("DiagnosticReport", `${BASE}dr-q`), narrowed];
    for (const status of ["partial", "final"]) {
      const result = validateResource(report(status), { profiles });
      expect(unchecked(result.issues)).toEqual(UNDECIDED);
      expect(errors(result.issues)).toEqual([]);
    }
  });

  it("decides past a required binding to exactly the value set the schema enumerates", () => {
    const same = profileOf("DiagnosticReport", "dr-q", [
      {
        id: "DiagnosticReport.status",
        path: "DiagnosticReport.status",
        binding: {
          strength: "required",
          valueSet: "http://hl7.org/fhir/ValueSet/diagnostic-report-status|4.0.1",
        },
      },
    ]);
    const result = validateResource(
      entry({
        resourceType: "DiagnosticReport",
        id: "fake-dr",
        status: "partial",
        code: { text: "Synthetic panel" },
      }),
      { profiles: [bundleBy("DiagnosticReport", `${BASE}dr-q`), same] },
    );
    expect(unchecked(result.issues)).toEqual([]);
    expect(errors(result.issues)).toEqual([]);
  });

  it("leaves undecided a choice narrowed to a type the target's value is not", () => {
    const quantityOnly = profileOf("Observation", "obs-q", [
      {
        id: "Observation.value[x]",
        path: "Observation.value[x]",
        min: 1,
        max: "1",
        type: [{ code: "Quantity" }],
      },
    ]);
    const profiles = [bundleBy("Observation", `${BASE}obs-q`), quantityOnly];
    const wrong = validateResource(entry(observation({ valueString: "fake" })), { profiles });
    expect(unchecked(wrong.issues)).toEqual(UNDECIDED);
    expect(errors(wrong.issues)).toEqual([]);
    // A value of the type the profile names is decided, and fills the slice.
    const right = validateResource(
      entry(observation({ valueQuantity: { value: 1, unit: "mg" } })),
      { profiles },
    );
    expect(unchecked(right.issues)).toEqual([]);
    expect(errors(right.issues)).toEqual([]);
  });

  it("leaves undecided a maxLength, which no layer checks", () => {
    const short = profileOf("Patient", "pat-ml", [
      { id: "Patient.id", path: "Patient.id", maxLength: 3, type: [{ code: "id" }] },
    ]);
    const result = validateResource(entry({ resourceType: "Patient", id: "fake-long-id" }), {
      profiles: [bundleBy("Patient", `${BASE}pat-ml`), short],
    });
    expect(unchecked(result.issues)).toEqual(UNDECIDED);
    // Absent, it asks nothing of the target.
    const absent = validateResource(entry({ resourceType: "Patient", gender: "other" }), {
      profiles: [bundleBy("Patient", `${BASE}pat-ml`), short],
    });
    expect(unchecked(absent.issues)).toEqual([]);
  });

  it("leaves undecided a minValue or a maxValue, which no layer checks", () => {
    for (const bound of [{ minValueInteger: 2 }, { maxValueInteger: 1 }]) {
      const limited = profileOf("Patient", "pat-mv", [
        { id: "Patient.multipleBirth[x]", path: "Patient.multipleBirth[x]", ...bound },
      ]);
      const result = validateResource(
        entry({ resourceType: "Patient", id: "fake-1", multipleBirthInteger: 3 }),
        { profiles: [bundleBy("Patient", `${BASE}pat-mv`), limited] },
      );
      expect(unchecked(result.issues)).toEqual(UNDECIDED);
    }
  });

  it("leaves undecided a reference narrowed to a target profile", () => {
    const toPatient = profileOf("Observation", "obs-s", [
      {
        id: "Observation.subject",
        path: "Observation.subject",
        min: 1,
        max: "1",
        type: [
          { code: "Reference", targetProfile: ["http://hl7.org/fhir/StructureDefinition/Patient"] },
        ],
      },
    ]);
    const result = validateResource(
      entry(observation({ subject: { reference: "Group/fake-g" } })),
      { profiles: [bundleBy("Observation", `${BASE}obs-s`), toPatient] },
    );
    expect(unchecked(result.issues)).toEqual(UNDECIDED);
    expect(errors(result.issues)).toEqual([]);
  });

  it("leaves undecided an invariant on a slice itself, which no layer evaluates", () => {
    const sliced = profileOf("Patient", "pat-slice-inv", [
      {
        id: "Patient.identifier",
        path: "Patient.identifier",
        slicing: { discriminator: [{ type: "value", path: "system" }], rules: "open" },
      },
      {
        id: "Patient.identifier:fake",
        path: "Patient.identifier",
        sliceName: "fake",
        constraint: [{ key: "fake-9", severity: "error", expression: "value.exists()" }],
      },
      {
        id: "Patient.identifier:fake.system",
        path: "Patient.identifier.system",
        fixedUri: "http://example.org/fake-ids",
      },
    ]);
    const result = validateResource(
      entry({
        resourceType: "Patient",
        id: "fake-1",
        identifier: [{ system: "http://example.org/fake-ids" }],
      }),
      { profiles: [bundleBy("Patient", `${BASE}pat-slice-inv`), sliced] },
    );
    expect(unchecked(result.issues)).toEqual(UNDECIDED);
  });

  it("leaves undecided an element extension the model does not recognise", () => {
    const extended = profileOf("Patient", "pat-ext", [
      {
        id: "Patient.gender",
        path: "Patient.gender",
        extension: [{ url: "http://example.org/StructureDefinition/fake-rule", valueString: "x" }],
      },
    ]);
    const result = validateResource(entry({ resourceType: "Patient", gender: "other" }), {
      profiles: [bundleBy("Patient", `${BASE}pat-ext`), extended],
    });
    expect(unchecked(result.issues)).toEqual(UNDECIDED);
  });
});

describe("the kinds of constraint one element places on a target", () => {
  /** The kinds of the element with `id` in a snapshot of `type`, against `resource`. */
  const kindsOf = (
    type: string,
    resource: Record<string, unknown>,
    elements: unknown[],
    id: string,
  ): string[] => {
    const profile = loadSd({
      resourceType: "StructureDefinition",
      url: `${BASE}kinds`,
      type,
      snapshot: { element: [{ id: type, path: type }, ...elements] },
    });
    const snapshot = req(profile.snapshot);
    const target = parse({ resourceType: type, ...resource });
    const scope = new SliceScope(target, type, snapshot);
    const el = req(snapshot.find((e) => e.id === id));
    return constraintKinds(el, type, snapshot, builtInSchema(type), scope);
  };

  it("reads a resource occurrence's own type against the types an element allows", () => {
    const contained = (code: string) =>
      kindsOf(
        "Observation",
        { contained: [{ resourceType: "Patient", id: "p1" }] },
        [{ id: "Observation.contained", path: "Observation.contained", type: [{ code }] }],
        "Observation.contained",
      );
    expect(contained("Patient")).toEqual(["type:code"]);
    expect(contained("Resource")).toEqual(["type:code"]);
    expect(contained("DomainResource")).toEqual(["type:code"]);
    expect(contained("Organization")).toEqual(["type:unchecked"]);
  });

  it("reads a choice suffix against the types, spelled as a suffix spells them", () => {
    const value = (codes: string[]) =>
      kindsOf(
        "Observation",
        { valueDateTime: "2020-01-01" },
        [
          {
            id: "Observation.value[x]",
            path: "Observation.value[x]",
            type: codes.map((code) => ({ code })),
          },
        ],
        "Observation.value[x]",
      );
    expect(value(["dateTime"])).toEqual(["type:code"]);
    expect(value(["string", "dateTime"])).toEqual(["type:code"]);
    expect(value(["string"])).toEqual(["type:unchecked"]);
  });

  it("takes one type on an element that is not a choice as the structure layer's", () => {
    const gender = (codes: string[]) =>
      kindsOf(
        "Patient",
        { gender: "other" },
        [{ id: "Patient.gender", path: "Patient.gender", type: codes.map((code) => ({ code })) }],
        "Patient.gender",
      );
    expect(gender(["code"])).toEqual(["type:code"]);
    expect(gender(["code", "string"])).toEqual(["type:unchecked"]);
  });

  it("names no type kind on the root element", () => {
    expect(
      kindsOf("Patient", {}, [], "Patient").concat(
        kindsOf(
          "Patient",
          {},
          [{ id: "Patient", path: "Patient", type: [{ code: "Patient" }] }],
          "Patient",
        ),
      ),
    ).toEqual([]);
  });

  it("takes a binding as the schema's only at that value set and the R4 release", () => {
    const status = (binding: Record<string, unknown>) =>
      kindsOf(
        "Observation",
        { status: "final" },
        [{ id: "Observation.status", path: "Observation.status", binding }],
        "Observation.status",
      );
    const vs = "http://hl7.org/fhir/ValueSet/observation-status";
    expect(status({ strength: "required", valueSet: vs })).toEqual(["binding:schema"]);
    expect(status({ strength: "required", valueSet: `${vs}|4.0.1` })).toEqual(["binding:schema"]);
    expect(status({ strength: "extensible", valueSet: vs })).toEqual(["binding:schema"]);
    expect(status({ strength: "required", valueSet: `${vs}|4.0.0` })).toEqual([
      "binding:unenforced",
    ]);
    expect(status({ strength: "required", valueSet: `${vs}-fake` })).toEqual([
      "binding:unenforced",
    ]);
    expect(status({ strength: "required" })).toEqual(["binding:unenforced"]);
    expect(status({ strength: "fake-strength", valueSet: vs })).toEqual(["binding:unenforced"]);
    expect(status({ strength: "preferred", valueSet: `${vs}-fake` })).toEqual(["binding:advisory"]);
    expect(status({ strength: "example", valueSet: `${vs}-fake` })).toEqual(["binding:advisory"]);
  });

  it("takes a slice's profile as the slicing's when a profile discriminator decides it", () => {
    const slice = (path: string, type: Record<string, unknown>) =>
      kindsOf(
        "Observation",
        { hasMember: [{ reference: "Observation/fake-o" }] },
        [
          {
            id: "Observation.hasMember",
            path: "Observation.hasMember",
            slicing: { discriminator: [{ type: "profile", path }], rules: "open" },
          },
          {
            id: "Observation.hasMember:m",
            path: "Observation.hasMember",
            sliceName: "m",
            type: [{ code: "Reference", ...type }],
          },
        ],
        "Observation.hasMember:m",
      );
    const target = { targetProfile: [`${BASE}fake-member`] };
    const own = { profile: [`${BASE}fake-reference`] };
    expect(slice("resolve()", target)).toEqual(["slicing", "type:code"]);
    expect(slice("$this.resolve()", target)).toEqual(["slicing", "type:code"]);
    expect(slice("$this", target)).toEqual(["type:targetProfile", "type:code"]);
    expect(slice("$this", own)).toEqual(["slicing", "type:code"]);
    expect(slice("", own)).toEqual(["slicing", "type:code"]);
    expect(slice("resolve()", own)).toEqual(["type:profile", "type:code"]);
    // Any resource at all is no narrowing.
    expect(
      slice("$this", { targetProfile: ["http://hl7.org/fhir/StructureDefinition/Resource"] }),
    ).toEqual(["type:code"]);
  });

  it("takes an invariant on a slice as evaluated only when the sliced element carries it too", () => {
    const sliced = (shared: Record<string, unknown>) =>
      kindsOf(
        "Patient",
        { identifier: [{ system: "urn:fake" }] },
        [
          {
            id: "Patient.identifier",
            path: "Patient.identifier",
            slicing: { discriminator: [{ type: "value", path: "system" }], rules: "open" },
            constraint: [shared],
          },
          {
            id: "Patient.identifier:s",
            path: "Patient.identifier",
            sliceName: "s",
            constraint: [{ key: "fake-5", severity: "error", expression: "value.exists()" }],
          },
        ],
        "Patient.identifier:s",
      );
    expect(sliced({ key: "fake-5", severity: "error", expression: "value.exists()" })).toEqual([
      "constraint",
    ]);
    expect(sliced({ key: "fake-5", severity: "error", expression: "system.exists()" })).toEqual([
      "constraint:slice",
    ]);
    expect(sliced({ key: "fake-6", severity: "error", expression: "value.exists()" })).toEqual([
      "constraint:slice",
    ]);
  });
});
