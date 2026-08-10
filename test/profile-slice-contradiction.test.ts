import { describe, expect, it } from "vitest";

import {
  collectProfileIssues,
  generateSnapshot,
  isList,
  loadStructureDefinition,
  matchSlices,
  parseResource,
  parseResourceXml,
  resolvePath,
  resolveSlices,
  serializeResourceXml,
  type FhirComplex,
  type FhirNode,
  type StructureDefinition,
} from "../src/index.js";

/** Parse a JSON document into the resource model, failing loudly rather than returning `undefined`. */
function json(document: unknown): FhirComplex {
  const { resource } = parseResource(JSON.stringify(document));
  if (resource === undefined) throw new Error("fixture did not parse");
  return resource;
}

/** Parse an XML document into the resource model, failing loudly rather than returning `undefined`. */
function xml(document: string): FhirComplex {
  const { resource } = parseResourceXml(document);
  if (resource === undefined) throw new Error("fixture did not parse");
  return resource;
}

/** Load a definition, failing loudly rather than propagating `undefined` into an assertion. */
function load(resource: FhirComplex): StructureDefinition {
  const definition = loadStructureDefinition(resource);
  if (definition === undefined) throw new Error("fixture is not a StructureDefinition");
  return definition;
}

/**
 * A snapshot-form profile slicing `Observation.component` on an `exists` discriminator over
 * `dataAbsentReason`, with the slice descendant's bounds supplied by the caller. Everything else is
 * held fixed so a row differs from its neighbours only in the pair under test.
 */
function slicedProfile(
  descendant: Record<string, unknown>,
  rules: "open" | "closed" = "closed",
  slice: Record<string, unknown> = { min: 1, max: "*" },
): unknown {
  return {
    resourceType: "StructureDefinition",
    url: "http://example.org/StructureDefinition/probe",
    name: "Probe",
    type: "Observation",
    kind: "resource",
    derivation: "constraint",
    snapshot: {
      element: [
        { id: "Observation", path: "Observation" },
        {
          id: "Observation.component",
          path: "Observation.component",
          slicing: {
            discriminator: [{ type: "exists", path: "dataAbsentReason" }],
            rules,
          },
        },
        {
          id: "Observation.component:Missing",
          path: "Observation.component",
          sliceName: "Missing",
          ...slice,
        },
        {
          id: "Observation.component:Missing.dataAbsentReason",
          path: "Observation.component.dataAbsentReason",
          ...descendant,
        },
      ],
    },
  };
}

/** The `Missing` slice as `resolveSlices` reads it out of a profile's own snapshot. */
function missingSlice(definition: StructureDefinition): ReturnType<typeof resolveSlices>[number] {
  const element = definition.snapshot?.find(
    (el) => el.path === "Observation.component" && el.sliceName === undefined,
  );
  if (element === undefined) throw new Error("fixture lost its sliced element");
  const slice = resolveSlices(definition.snapshot ?? [], element)[0];
  if (slice === undefined) throw new Error("fixture lost its slice");
  return slice;
}

/** An `Observation` whose single `component` carries `dataAbsentReason`, plus its own `code`. */
function componentWithReason(): FhirComplex {
  return json({
    resourceType: "Observation",
    status: "final",
    code: { coding: [{ system: "http://loinc.org", code: "1234-5" }] },
    component: [{ dataAbsentReason: { text: "not collected" }, code: { text: "systolic" } }],
  });
}

/** An `Observation` whose single `component` carries no `dataAbsentReason`. */
function componentWithoutReason(): FhirComplex {
  return json({
    resourceType: "Observation",
    status: "final",
    code: { coding: [{ system: "http://loinc.org", code: "1234-5" }] },
    component: [{ code: { text: "systolic" } }],
  });
}

/**
 * The `component` occurrences of an `Observation`, which is what `matchSlices` takes. Passing the
 * resource itself instead is the degenerate shape: no discriminator path resolves at that root, so
 * every occurrence goes unmatched whatever the slice says.
 */
function componentOccurrences(resource: FhirComplex): FhirNode[] {
  return resolvePath(resource, "component").flatMap((node) =>
    isList(node) ? [...node.items] : [node],
  );
}

/** The severity, code, and location of every profile finding, for literal comparison. */
function issues(resource: FhirComplex, profile: StructureDefinition): string[] {
  return collectProfileIssues(resource, profile).map(
    (issue) => `${issue.severity}:${issue.code} at ${issue.expression}`,
  );
}

/**
 * A slice descendant that is required and prohibited at once states no presence to match.
 *
 * `resolveSlices` turns a slice descendant's cardinality into an `exists` expectation: `min >= 1`
 * means the path must be present, `max 0` means it must be absent. The two were read as an ordered
 * pair, `min` first, so a descendant stating BOTH (an unsatisfiable `min 1 / max 0`, which is what
 * a `0..0` prohibition beneath a required base element composes to) silently discarded the
 * prohibition and resolved toward *present*. Every occurrence carrying the forbidden element was
 * then admitted into the slice, retiring a `PROFILE_SLICE_UNMATCHED` under `closed` slicing and the
 * slice's own `CARDINALITY_MIN`.
 *
 * The contradiction is recorded as unsatisfiable instead of resolved toward either side, and an
 * `exists` discriminator on such a path assigns no occurrence to the slice. That answer is `no`,
 * never `unevaluable`: `unevaluable` reports the whole slicing `unchecked`, which returns before
 * the very arms this case exists to reach.
 */
describe("a contradictory slice descendant assigns no occurrence", () => {
  it("records the contradiction apart from the expectations, not as one of them", () => {
    const slice = missingSlice(load(json(slicedProfile({ min: 1, max: "0" }))));

    expect([...slice.unsatisfiableExists]).toEqual(["dataAbsentReason"]);
    expect([...slice.existsExpectations.entries()]).toEqual([]);
  });

  it("draws both findings the ordered read used to retire, under closed slicing", () => {
    // The closure, stated as the whole issue list rather than a `toContain`: the two findings named
    // in the defect are the two that arrive. RED at base, where this list is one entry long.
    const profile = load(json(slicedProfile({ min: 1, max: "0" })));

    expect(issues(componentWithReason(), profile)).toEqual([
      "error:PROFILE_SLICE_UNMATCHED at Observation.component[0]",
      "error:CARDINALITY_MIN at Observation.component:Missing",
      "error:CARDINALITY_MAX at Observation.component.dataAbsentReason",
    ]);
  });

  it("does not report the slicing unchecked, which would return before those arms", () => {
    // The distinction the remedy turns on, asserted directly rather than inferred from the list
    // above: an unsatisfiable expectation is a `no`, so membership is still evaluated.
    // `matchSlices` takes the sliced element's OCCURRENCES, so the fixture hands it the `component`
    // node and not the resource around it. Handing it the resource made this row pass in both
    // states for the wrong reason - `dataAbsentReason` does not exist at an `Observation` root, so
    // the occurrence went unmatched however the contradiction was resolved.
    const slice = missingSlice(load(json(slicedProfile({ min: 1, max: "0" }))));
    const occurrences = componentOccurrences(componentWithReason());
    const result = matchSlices(
      occurrences,
      [slice],
      [{ type: "exists", path: "dataAbsentReason" }],
    );

    expect(occurrences).toHaveLength(1);
    expect(result.unchecked).toBe(false);
    expect(result.assignments).toEqual([undefined]);
  });

  it("reads the same contradiction out of the XML spelling of the same profile", () => {
    // The arc this slice belongs to is about a profile changing format inside this library. FHIR
    // spells `min` a number and `max` a string, so the pair reaches the model differently from XML;
    // the two spellings must still land on the same unsatisfiable path.
    const resource = json(slicedProfile({ min: 1, max: "0" }));
    const fromXml = missingSlice(load(xml(serializeResourceXml(resource))));

    // Both assertions state a literal. Comparing the XML reading to the JSON reading would pass in
    // both states, since the two spellings agreed at base as well; only a literal separates them.
    expect([...fromXml.unsatisfiableExists]).toEqual(["dataAbsentReason"]);
    expect(issues(componentWithReason(), load(xml(serializeResourceXml(resource))))).toEqual([
      "error:PROFILE_SLICE_UNMATCHED at Observation.component[0]",
      "error:CARDINALITY_MIN at Observation.component:Missing",
      "error:CARDINALITY_MAX at Observation.component.dataAbsentReason",
    ]);
  });

  it("closes it through a differential and a base, the route the defect was filed at", () => {
    // The filed shape: the contradiction is not authored, it is COMPOSED by `mergeElement` taking
    // the tighter of a required base `min 1` and a differential `0..0`. That composition is
    // deliberately unchanged (a clamp against `max` was tried there and reverted for lowering the
    // enforced bound below the inherited one), so the snapshot still carries `min 1 / max 0`.
    const base = {
      resourceType: "StructureDefinition",
      url: "http://example.org/StructureDefinition/slicebase",
      type: "Observation",
      kind: "resource",
      derivation: "specialization",
      snapshot: {
        element: [
          { id: "Observation", path: "Observation" },
          {
            id: "Observation.component",
            path: "Observation.component",
            slicing: {
              discriminator: [{ type: "exists", path: "dataAbsentReason" }],
              rules: "closed",
            },
          },
          {
            id: "Observation.component:Missing",
            path: "Observation.component",
            sliceName: "Missing",
            min: 1,
            max: "*",
          },
          {
            id: "Observation.component:Missing.dataAbsentReason",
            path: "Observation.component.dataAbsentReason",
            min: 1,
            max: "1",
          },
        ],
      },
    };
    const forbidding = load(
      json({
        resourceType: "StructureDefinition",
        url: "http://example.org/StructureDefinition/forbidding",
        type: "Observation",
        kind: "resource",
        derivation: "constraint",
        baseDefinition: base.url,
        differential: {
          element: [
            { id: "Observation", path: "Observation" },
            {
              id: "Observation.component:Missing.dataAbsentReason",
              path: "Observation.component.dataAbsentReason",
              min: 0,
              max: "0",
            },
          ],
        },
      }),
    );
    const resolve = (url: string): StructureDefinition | undefined =>
      url === base.url ? load(json(base)) : undefined;
    const descendant = generateSnapshot(forbidding, resolve).find(
      (el) => el.id === "Observation.component:Missing.dataAbsentReason",
    );

    expect({ min: descendant?.min, max: descendant?.max }).toEqual({ min: 1, max: 0 });
    expect(
      collectProfileIssues(componentWithReason(), forbidding, { resolve }).map(
        (issue) => `${issue.severity}:${issue.code} at ${issue.expression}`,
      ),
    ).toEqual([
      "error:PROFILE_SLICE_UNMATCHED at Observation.component[0]",
      "error:CARDINALITY_MIN at Observation.component:Missing",
      "error:CARDINALITY_MAX at Observation.component.dataAbsentReason",
    ]);
  });
});

/**
 * What the remedy must NOT reach, pinned as a both-states set.
 *
 * Every row here is **green on the base tree as well as this one**, and that is the point: the
 * change is scoped to `min >= 1` beside `max 0` exactly, so a bound that is merely tight, merely
 * prohibitive, or contradictory in a way that says nothing about *existence* has to read the same
 * as it did before. They clear nothing on their own, because a row that reads the same in both
 * states is not evidence, so each was checked by mutating the guard until it moved: widening it to
 * `max 0`
 * alone, to `max < min`, to `min >= 1` alone, and to every descendant. Every row here reds under at
 * least one. The runs are recorded in `documentation/agent-notes/profile-slice-contradiction.md`.
 */
describe("the neighbours of the contradiction, unchanged in both states", () => {
  it("still expects presence from a plainly required descendant", () => {
    const slice = missingSlice(load(json(slicedProfile({ min: 1, max: "1" }))));

    expect([...slice.existsExpectations.entries()]).toEqual([["dataAbsentReason", true]]);
    expect([...slice.unsatisfiableExists]).toEqual([]);
  });

  it("still expects absence from a plainly prohibited descendant", () => {
    const slice = missingSlice(load(json(slicedProfile({ min: 0, max: "0" }))));

    expect([...slice.existsExpectations.entries()]).toEqual([["dataAbsentReason", false]]);
    expect([...slice.unsatisfiableExists]).toEqual([]);
  });

  it("still expects presence from `min 2 / max 1`, which contradicts on count and not existence", () => {
    // The scoping line, and the reason the guard reads `max === 0` rather than `max < min`. A
    // descendant no instance can satisfy by COUNT still says something unambiguous about presence:
    // `min 2` means present. Only `max 0` contradicts the presence half.
    const slice = missingSlice(load(json(slicedProfile({ min: 2, max: "1" }))));

    expect([...slice.existsExpectations.entries()]).toEqual([["dataAbsentReason", true]]);
    expect([...slice.unsatisfiableExists]).toEqual([]);
  });

  it("ignores a contradiction carried only by a RE-SLICE of the discriminator path", () => {
    // Raised by the accuracy gate, and the sharper of its two findings: this walk sweeps every
    // element under the slice's id prefix, and a re-slice of a descendant is under that prefix and
    // flattens onto the same relative path. Recording its contradiction made the satisfiable OUTER
    // slice unmatchable and drew two errors on a CONFORMANT document, blaming the instance for a
    // statement belonging to a different slice. Re-slicing is a declared deferral of this module,
    // so the outer slice keeps the plain expectation its own descendant states.
    const profile = load(
      json({
        resourceType: "StructureDefinition",
        url: "http://example.org/StructureDefinition/reslice",
        type: "Observation",
        kind: "resource",
        derivation: "constraint",
        snapshot: {
          element: [
            { id: "Observation", path: "Observation" },
            {
              id: "Observation.component",
              path: "Observation.component",
              slicing: {
                discriminator: [{ type: "exists", path: "dataAbsentReason" }],
                rules: "closed",
              },
            },
            {
              id: "Observation.component:A",
              path: "Observation.component",
              sliceName: "A",
              min: 1,
              max: "*",
            },
            {
              id: "Observation.component:A.dataAbsentReason",
              path: "Observation.component.dataAbsentReason",
              min: 1,
              max: "1",
            },
            {
              id: "Observation.component:A.dataAbsentReason:Z",
              path: "Observation.component.dataAbsentReason",
              sliceName: "Z",
              min: 1,
              max: "0",
            },
          ],
        },
      }),
    );
    const slice = missingSlice(profile);

    expect([...slice.unsatisfiableExists]).toEqual([]);
    expect([...slice.existsExpectations.entries()]).toEqual([["dataAbsentReason", true]]);
    expect(issues(componentWithReason(), profile)).toEqual([]);
  });

  it("still expects nothing from a descendant stating no bound at all", () => {
    const slice = missingSlice(load(json(slicedProfile({}))));

    expect([...slice.existsExpectations.entries()]).toEqual([]);
    expect([...slice.unsatisfiableExists]).toEqual([]);
  });

  it("still reports unchecked when no descendant pins the discriminator path", () => {
    // The fail-safe the module already had, and the one the remedy deliberately does NOT reuse.
    const slice = missingSlice(load(json(slicedProfile({}))));

    expect(
      matchSlices(
        componentOccurrences(componentWithReason()),
        [slice],
        [{ type: "exists", path: "dataAbsentReason" }],
      ).unchecked,
    ).toBe(true);
  });
});

/**
 * The cost, measured and reported rather than left to be found.
 *
 * Occurrences that used to be admitted into the slice no longer are, and findings that existed only
 * because of that wrongful admission go with them. That is the direction this library refuses to
 * move in, so the classes are enumerated rather than summarised into a count: a slice-level
 * `CARDINALITY_MAX` fired by the wrongful count, and a LATER slice's `CARDINALITY_MIN` and
 * `MUST_SUPPORT_ABSENT` that the contradictory slice had been shadowing in the match loop.
 *
 * Where the contradiction is on the slice's OWN descendant, that descendant is also checked at
 * element level, and `min 1 / max 0` is unsatisfiable for every count, so an error stands on each
 * present parent occurrence whichever way the instance goes. Both polarities are asserted below.
 * **That is not a general bound and must not be written as one.** The accuracy gate refuted the
 * general form: `collectProfileIssues` skips slice elements, so a contradiction carried by a
 * RE-SLICE is never element-checked at all, and through that route the retirement DID move a
 * verdict to `valid`. The record is scoped away from re-slices instead, which is what closes that
 * route, and two rows here name it.
 */
describe("the bound on what the change can retire", () => {
  it("retires a slice CARDINALITY_MAX that only fired on a wrongful admission", () => {
    // RED at base, and it is a cost, not a capability: at base this list carries
    // `error:CARDINALITY_MAX at Observation.component:Missing` from two occurrences admitted into a
    // `max 1` slice. Under `open` rules nothing replaces it at the slice, because an unmatched
    // occurrence is only a finding under `closed`. What is left is the element-level pair below.
    const profile = load(json(slicedProfile({ min: 1, max: "0" }, "open", { min: 0, max: "1" })));
    const twoComponents = json({
      resourceType: "Observation",
      status: "final",
      code: { coding: [{ system: "http://loinc.org", code: "1234-5" }] },
      component: [
        { dataAbsentReason: { text: "not collected" }, code: { text: "systolic" } },
        { dataAbsentReason: { text: "not collected" }, code: { text: "diastolic" } },
      ],
    });

    expect(issues(twoComponents, profile)).toEqual([
      "error:CARDINALITY_MAX at Observation.component[0].dataAbsentReason",
      "error:CARDINALITY_MAX at Observation.component[1].dataAbsentReason",
    ]);
  });

  it("retires a later slice's findings that existed only because a contradictory slice shadowed it", () => {
    // Raised by the accuracy gate, which measured the disclosed count of retirements as too low.
    // `matchSlices` breaks at the first matching slice, so an occurrence wrongly admitted to a
    // contradictory slice never reached the slices after it. Refusing the admission DE-SHADOWS them,
    // and whatever they then do - match, or turn out UNEVALUABLE and take the whole slicing to
    // `unchecked` - the findings their emptiness earned go with them. This row covers the matching
    // half; the unevaluable half is recorded in the note rather than pinned, because it is the same
    // de-shadowing through a control-flow arm this module already owns. Here that is a
    // slice `CARDINALITY_MIN` (the very code this change exists to draw elsewhere) and a slice
    // `MUST_SUPPORT_ABSENT`. Head is the more correct reading - both were artefacts of the wrongful
    // admission - but the count is a disclosure, so it is pinned rather than described.
    const profile = load(
      json({
        resourceType: "StructureDefinition",
        url: "http://example.org/StructureDefinition/shadow",
        type: "Observation",
        kind: "resource",
        derivation: "constraint",
        snapshot: {
          element: [
            { id: "Observation", path: "Observation" },
            {
              id: "Observation.component",
              path: "Observation.component",
              slicing: {
                discriminator: [{ type: "exists", path: "dataAbsentReason" }],
                rules: "open",
              },
            },
            {
              id: "Observation.component:A",
              path: "Observation.component",
              sliceName: "A",
              min: 0,
              max: "*",
            },
            {
              id: "Observation.component:A.dataAbsentReason",
              path: "Observation.component.dataAbsentReason",
              min: 1,
              max: "0",
            },
            {
              id: "Observation.component:B",
              path: "Observation.component",
              sliceName: "B",
              min: 1,
              max: "*",
              mustSupport: true,
            },
            {
              id: "Observation.component:B.dataAbsentReason",
              path: "Observation.component.dataAbsentReason",
              min: 1,
              max: "1",
            },
          ],
        },
      }),
    );

    expect(issues(componentWithReason(), profile)).toEqual([
      "error:CARDINALITY_MAX at Observation.component.dataAbsentReason",
    ]);
  });

  it("does not move a verdict to valid through a re-slice the element check never sees", () => {
    // The other half of the gate's finding, and the reason the bound needed narrowing rather than
    // re-wording. `collectProfileIssues` SKIPS slice elements, so a contradiction carried by a
    // re-slice is never checked at element level and nothing stands behind a retirement there.
    // With the record scoped to the slice's own descendants, that route is closed: the verdict is
    // the base tree's.
    const profile = load(
      json({
        resourceType: "StructureDefinition",
        url: "http://example.org/StructureDefinition/resliceverdict",
        type: "Observation",
        kind: "resource",
        derivation: "constraint",
        snapshot: {
          element: [
            { id: "Observation", path: "Observation" },
            {
              id: "Observation.component",
              path: "Observation.component",
              slicing: {
                discriminator: [{ type: "exists", path: "interpretation" }],
                rules: "open",
              },
            },
            {
              id: "Observation.component:A",
              path: "Observation.component",
              sliceName: "A",
              min: 0,
              max: "*",
            },
            {
              id: "Observation.component:A.interpretation",
              path: "Observation.component.interpretation",
              min: 1,
              max: "1",
            },
            {
              id: "Observation.component:A.interpretation:X",
              path: "Observation.component.interpretation",
              sliceName: "X",
              min: 1,
              max: "0",
            },
            {
              id: "Observation.component:B",
              path: "Observation.component",
              sliceName: "B",
              min: 1,
              max: "*",
            },
            {
              id: "Observation.component:B.interpretation",
              path: "Observation.component.interpretation",
              min: 1,
              max: "1",
            },
          ],
        },
      }),
    );
    const withInterpretation = json({
      resourceType: "Observation",
      status: "final",
      code: { coding: [{ system: "http://loinc.org", code: "1234-5" }] },
      component: [{ interpretation: { text: "high" }, code: { text: "systolic" } }],
    });

    expect(issues(withInterpretation, profile)).toEqual([
      "error:CARDINALITY_MIN at Observation.component:B",
    ]);
  });

  it("leaves an error standing when the forbidden element is present", () => {
    const profile = load(json(slicedProfile({ min: 1, max: "0" }, "open", { min: 0, max: "1" })));

    expect(issues(componentWithReason(), profile)).toEqual([
      "error:CARDINALITY_MAX at Observation.component.dataAbsentReason",
    ]);
  });

  it("leaves an error standing when the forbidden element is absent", () => {
    // The other polarity: `min 1` is unsatisfiable downward too, so the element-level check fires
    // whichever way the instance goes. There is no instance under a contradictory descendant that
    // this library calls clean at that location.
    const profile = load(json(slicedProfile({ min: 1, max: "0" }, "open", { min: 0, max: "1" })));

    expect(issues(componentWithoutReason(), profile)).toEqual([
      "error:CARDINALITY_MIN at Observation.component.dataAbsentReason",
    ]);
  });
});
