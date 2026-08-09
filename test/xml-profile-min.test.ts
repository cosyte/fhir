import { describe, expect, it } from "vitest";

import {
  collectProfileIssues,
  generateSnapshot,
  loadStructureDefinition,
  matchSlices,
  parseResource,
  parseResourceXml,
  resolveSlices,
  serializeResourceXml,
  validateResource,
  type FhirComplex,
  type StructureDefinition,
} from "../src/index.js";

const FHIR_NS = 'xmlns="http://hl7.org/fhir"';

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
 * The same profile, spelled both ways: a JSON document and the XML this package's own writer emits
 * for it. Round-tripping through `serializeResourceXml` is deliberate - it is the route a caller
 * reaches by changing format inside this library, so the two are the same profile by construction
 * rather than by a hand-transcription that could differ.
 */
function bothSpellings(document: unknown): {
  fromJson: StructureDefinition;
  fromXml: StructureDefinition;
} {
  const resource = json(document);
  return { fromJson: load(resource), fromXml: load(xml(serializeResourceXml(resource))) };
}

/** A snapshot-form profile on `Observation`, carrying whatever elements are passed. */
function snapshotProfile(
  elements: readonly unknown[],
  url = "http://example.org/StructureDefinition/probe",
): unknown {
  return {
    resourceType: "StructureDefinition",
    url,
    name: "Probe",
    type: "Observation",
    kind: "resource",
    derivation: "constraint",
    snapshot: { element: [{ id: "Observation", path: "Observation" }, ...elements] },
  };
}

/** A conformant-enough `Observation` carrying no `subject` and no `performer`. */
function bareObservation(): FhirComplex {
  return json({
    resourceType: "Observation",
    status: "final",
    code: { coding: [{ system: "http://loinc.org", code: "1234-5" }] },
  });
}

/** The severity, code, and location of a validation run's issues, for set comparison. */
function codes(resource: FhirComplex, profile: StructureDefinition): string[] {
  return validateResource(resource, { profiles: [profile] }).issues.map(
    (issue) => `${issue.severity}:${issue.code} at ${issue.expression}`,
  );
}

/**
 * An XML-sourced profile's `min` is a lower bound, not a string.
 *
 * FHIR XML carries every primitive as the text of its `value` attribute (`xml.html` §2.6.1) and this
 * reader is schema-free by design, so `<min value="1"/>` reaches the model as `"1"` where FHIR
 * JSON's `"min": 1` reaches it as a number. `parseMin` matched only the number, and a failed match
 * reads as absence, so an XML-sourced profile declared its required elements and this library
 * enforced **none** of them, with nothing on any diagnostic channel to say so.
 *
 * The read is widened at `parseMin`, never in the XML reader: a schema-free reader cannot know that
 * `value` spells an `unsignedInt` rather than a `code`, and coercing there would turn the text into
 * a number the writer then re-emits as one, laundering a value across a format change.
 */
describe("a min stated in XML is a lower bound this library enforces", () => {
  it("carries the same min the JSON spelling of the same profile carries", () => {
    const { fromJson, fromXml } = bothSpellings(
      snapshotProfile([
        { id: "Observation.subject", path: "Observation.subject", min: 1, max: "1" },
        { id: "Observation.performer", path: "Observation.performer", min: 2, max: "*" },
      ]),
    );

    expect(fromXml.snapshot?.map((el) => el.min)).toEqual(fromJson.snapshot?.map((el) => el.min));
    expect(fromXml.snapshot?.[1]?.min).toBe(1);
    expect(fromXml.snapshot?.[2]?.min).toBe(2);
  });

  it("raises the CARDINALITY_MIN the JSON spelling raises, on the same instance", () => {
    const { fromJson, fromXml } = bothSpellings(
      snapshotProfile([
        { id: "Observation.subject", path: "Observation.subject", min: 1, max: "1" },
        { id: "Observation.performer", path: "Observation.performer", min: 2, max: "*" },
      ]),
    );
    const observation = bareObservation();

    expect(codes(observation, fromXml)).toEqual(codes(observation, fromJson));
    expect(codes(observation, fromXml)).toEqual([
      "information:RESOURCE_NOT_MODELED at Observation",
      "error:CARDINALITY_MIN at Observation.subject",
      "error:CARDINALITY_MIN at Observation.performer",
    ]);
  });

  it("stops affirming a profile round trip through this package's own writer", () => {
    // The sharpest reading of the defect: the profile is written by `serializeResourceXml` and read
    // back by `parseResourceXml`, both this package's own, and the verdict on the SAME instance
    // moved `valid: false` to `valid: true`. A format change upgraded a document's trustworthiness.
    const resource = json(
      snapshotProfile([
        { id: "Observation.subject", path: "Observation.subject", min: 1, max: "1" },
      ]),
    );
    const roundTripped = load(xml(serializeResourceXml(resource)));

    expect(validateResource(bareObservation(), { profiles: [roundTripped] }).valid).toBe(false);
  });

  it("enforces a min a caller supplied as a hand-authored XML profile, not only a round trip", () => {
    const definition = load(
      xml(
        `<StructureDefinition ${FHIR_NS}><url value="http://example.org/StructureDefinition/hand"/>` +
          '<type value="Observation"/><kind value="resource"/><derivation value="constraint"/>' +
          '<snapshot><element><path value="Observation"/></element>' +
          '<element><path value="Observation.subject"/><min value="1"/><max value="1"/></element>' +
          "</snapshot></StructureDefinition>",
      ),
    );

    expect(
      collectProfileIssues(bareObservation(), definition).map((issue) => issue.code),
    ).toContain("CARDINALITY_MIN");
  });

  it("enforces a min stated on a slice, not only on a plain element", () => {
    const { fromJson, fromXml } = bothSpellings(
      snapshotProfile([
        {
          id: "Observation.category",
          path: "Observation.category",
          slicing: { discriminator: [{ type: "pattern", path: "$this" }], rules: "open" },
        },
        {
          id: "Observation.category:VSCat",
          path: "Observation.category",
          sliceName: "VSCat",
          min: 1,
          max: "1",
          patternCodeableConcept: {
            coding: [
              {
                system: "http://terminology.hl7.org/CodeSystem/observation-category",
                code: "vital-signs",
              },
            ],
          },
        },
      ]),
    );
    const observation = json({
      resourceType: "Observation",
      status: "final",
      code: { coding: [{ system: "http://loinc.org", code: "1234-5" }] },
      category: [
        {
          coding: [
            {
              system: "http://terminology.hl7.org/CodeSystem/observation-category",
              code: "laboratory",
            },
          ],
        },
      ],
    });

    expect(codes(observation, fromXml)).toEqual(codes(observation, fromJson));
    expect(codes(observation, fromXml)).toContain(
      "error:CARDINALITY_MIN at Observation.category:VSCat",
    );
  });

  it("builds the exists expectations a sliced XML profile states, instead of reporting it unchecked", () => {
    // A descendant `min >= 1` is what `resolveSlices` turns into an existence expectation, and an
    // `exists` discriminator is unevaluable without one - so at the base tree the WHOLE slicing came
    // back `unchecked` and no slice constraint was checked at all. This is the read reaching a
    // second consumer, and the direction is a fail-safe placeholder giving way to real evaluation.
    const { fromJson, fromXml } = bothSpellings(
      snapshotProfile([
        {
          id: "Observation.component",
          path: "Observation.component",
          slicing: { discriminator: [{ type: "exists", path: "dataAbsentReason" }], rules: "open" },
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
      ]),
    );
    const sliced = (definition: StructureDefinition): ReturnType<typeof resolveSlices> => {
      const element = definition.snapshot?.find(
        (el) => el.path === "Observation.component" && el.sliceName === undefined,
      );
      if (element === undefined) throw new Error("fixture lost its sliced element");
      return resolveSlices(definition.snapshot ?? [], element);
    };

    expect([...(sliced(fromXml)[0]?.existsExpectations.entries() ?? [])]).toEqual([
      ["dataAbsentReason", true],
    ]);
    expect([...(sliced(fromXml)[0]?.existsExpectations.entries() ?? [])]).toEqual([
      ...(sliced(fromJson)[0]?.existsExpectations.entries() ?? []),
    ]);
    expect(
      matchSlices([json({ resourceType: "Observation" })], sliced(fromXml), [
        { type: "exists", path: "dataAbsentReason" },
      ]).unchecked,
    ).toBe(false);
  });
});

/**
 * The text recognised is exactly R4's `unsignedInt` lexical space, `[0]|([1-9][0-9]*)`
 * (datatypes.html), which is the datatype `ElementDefinition.min` declares
 * (elementdefinition.html). Nothing is coerced and nothing is guessed: this is the same exactness
 * the boolean read applies to `true` / `false`, one datatype over. R4's `positiveInt` is a DIFFERENT
 * space (`+?[1-9][0-9]*`, a leading `+` admitted) and is deliberately not the one cited: `min` is
 * not a `positiveInt`, and `<min value="+1"/>` states no bound here.
 */
describe("the lexical space read is R4's, and nothing beside it", () => {
  const stated: readonly [string, number][] = [
    ["0", 0],
    ["1", 1],
    ["2", 2],
    ["10", 10],
    ["999", 999],
  ];
  const notStated: readonly string[] = [
    "+1",
    "01",
    "1.0",
    "1.",
    " 1",
    "1 ",
    "one",
    "",
    "-1",
    "1e2",
  ];

  it.each(stated)("reads %s as the bound %i", (text, expected) => {
    const definition = load(
      xml(
        `<StructureDefinition ${FHIR_NS}><url value="http://example.org/StructureDefinition/lex"/>` +
          '<type value="Observation"/><kind value="resource"/><differential><element>' +
          `<path value="Observation.subject"/><min value="${text}"/>` +
          "</element></differential></StructureDefinition>",
      ),
    );

    expect(definition.differential?.[0]?.min).toBe(expected);
  });

  it.each(notStated)("reads %j as no bound at all", (text) => {
    const definition = load(
      xml(
        `<StructureDefinition ${FHIR_NS}><url value="http://example.org/StructureDefinition/lex"/>` +
          '<type value="Observation"/><kind value="resource"/><differential><element>' +
          `<path value="Observation.subject"/><min value="${text}"/><max value="1"/>` +
          "</element></differential></StructureDefinition>",
      ),
    );

    expect(definition.differential?.[0]?.min).toBeUndefined();
    // The element itself was read: this is the bound declining, not the element going missing.
    expect(definition.differential?.[0]?.max).toBe(1);
  });
});

/**
 * The widening cannot lower a bound, and the guarantee is at the merge rather than at the read.
 *
 * A profile derives by *constraining* (profiling.html): its `min` may raise the inherited one and
 * may not lower it. `mergeElement` overlaid the differential's `min` verbatim, so a newly-read bound
 * BELOW the inherited one silently retired a `CARDINALITY_MIN` the base element had earned and moved
 * `valid` from `false` to `true`. That was reachable for **any** stated bound under the inherited
 * one, not only for `0`, and it was reachable through JSON as well as XML. The merge now takes the
 * tighter of the two, so a newly-read `min` can only raise the snapshot's bound or leave it alone.
 */
describe("a differential min can raise the inherited bound and can never lower it", () => {
  const base = {
    resourceType: "StructureDefinition",
    url: "http://example.org/StructureDefinition/base",
    name: "Base",
    type: "Observation",
    kind: "resource",
    derivation: "specialization",
    snapshot: {
      element: [
        { id: "Observation", path: "Observation" },
        { id: "Observation.performer", path: "Observation.performer", min: 2, max: "*" },
      ],
    },
  };
  const derived = (min?: unknown): unknown => ({
    resourceType: "StructureDefinition",
    url: "http://example.org/StructureDefinition/derived",
    name: "Derived",
    type: "Observation",
    kind: "resource",
    derivation: "constraint",
    baseDefinition: "http://example.org/StructureDefinition/base",
    differential: {
      element: [
        { id: "Observation", path: "Observation" },
        {
          id: "Observation.performer",
          path: "Observation.performer",
          ...(min === undefined ? {} : { min }),
          max: "*",
        },
      ],
    },
  });
  const resolveBase = (url: string): StructureDefinition | undefined =>
    url === base.url ? load(json(base)) : undefined;
  const mergedMin = (definition: StructureDefinition): number | undefined =>
    generateSnapshot(definition, resolveBase).find((el) => el.path === "Observation.performer")
      ?.min;
  /** An `Observation` with ONE performer: conformant under `min 1`, not under the inherited `min 2`. */
  const onePerformer = (): FhirComplex =>
    json({
      resourceType: "Observation",
      status: "final",
      code: { coding: [{ system: "http://loinc.org", code: "1234-5" }] },
      performer: [{ reference: "Practitioner/1" }],
    });
  const cardinalityMin = (definition: StructureDefinition): string[] =>
    collectProfileIssues(onePerformer(), definition, { resolve: resolveBase })
      .filter((issue) => issue.code === "CARDINALITY_MIN")
      .map((issue) => `${issue.severity}:${issue.code} at ${issue.expression}`);

  it("keeps the inherited bound when an XML differential states a smaller one", () => {
    const { fromXml } = bothSpellings(derived(1));

    expect(fromXml.differential?.[1]?.min).toBe(1);
    expect(mergedMin(fromXml)).toBe(2);
    expect(cardinalityMin(fromXml)).toEqual(["error:CARDINALITY_MIN at Observation.performer"]);
  });

  it("keeps the inherited bound when a JSON differential states a smaller one", () => {
    // The same guarantee on the reference path, and it is a change there: before the merge took the
    // tighter of the two, a JSON `{"min": 1}` under an inherited `2` already retired this finding.
    // Named rather than buried, because it is a `valid: true -> false` move on JSON input.
    expect(mergedMin(load(json(derived(1))))).toBe(2);
    expect(cardinalityMin(load(json(derived(1))))).toEqual([
      "error:CARDINALITY_MIN at Observation.performer",
    ]);
  });

  it("keeps the inherited bound for a min of 0, whichever format spelled it", () => {
    const { fromJson, fromXml } = bothSpellings(derived(0));

    expect(fromXml.differential?.[1]?.min).toBe(0);
    expect(fromJson.differential?.[1]?.min).toBe(0);
    expect(mergedMin(fromXml)).toBe(2);
    expect(mergedMin(fromJson)).toBe(2);
  });

  it("still takes a differential bound that tightens, which is the whole point of a profile", () => {
    // The other polarity, so the guard cannot pass by refusing every differential `min`.
    const { fromJson, fromXml } = bothSpellings(derived(3));

    expect(mergedMin(fromXml)).toBe(3);
    expect(mergedMin(fromJson)).toBe(3);
  });

  it("leaves an element the differential states no min for exactly as the base had it", () => {
    // Both-states control: green on the base tree too. It is what makes the rows above a delta of
    // the newly-read bound rather than of the merge running at all.
    const { fromXml } = bothSpellings(derived());

    expect(mergedMin(fromXml)).toBe(2);
    expect(cardinalityMin(fromXml)).toEqual(["error:CARDINALITY_MIN at Observation.performer"]);
  });
});

/**
 * Characterization tests over what this change does NOT close, pinned so they cannot move in
 * silence. Closing any of them MUST red the test beside it, in the same change.
 *
 * These hold on the base tree as well - they are `PRE-EXISTING` residuals, recorded here because
 * they sit inside or beside the read this change touches, and they are NOT evidence for it.
 */
describe("declared residuals of the lexical min read, pinned", () => {
  it("still reads no mustSupport and no slicing.ordered off an XML definition", () => {
    // Both-states pin. Deliberately unchanged: they were measured into a retirement of a
    // `MUST_SUPPORT_ABSENT`, and the `min` remedy does not license them. What makes a widened `min`
    // safe is that its only consumer that can retire a finding now takes the tighter bound, and a
    // boolean flag has no tighter-of-the-two: `false` is not "no flag stated".
    const definition = load(
      xml(
        `<StructureDefinition ${FHIR_NS}><url value="http://example.org/StructureDefinition/residual"/>` +
          '<type value="Observation"/><kind value="resource"/><differential><element>' +
          '<path value="Observation.subject"/><min value="1"/><mustSupport value="true"/>' +
          '<slicing><discriminator><type value="value"/><path value="code"/></discriminator>' +
          '<rules value="closed"/><ordered value="true"/></slicing>' +
          "</element></differential></StructureDefinition>",
      ),
    );

    expect(definition.differential?.[0]?.mustSupport).toBeUndefined();
    expect(definition.differential?.[0]?.slicing?.ordered).toBeUndefined();
    // The bound beside them reads, so this is the two flags declining and not the element.
    expect(definition.differential?.[0]?.min).toBe(1);
  });

  it("still overlays a differential max verbatim, so an upper bound CAN be relaxed", () => {
    // Both-states pin over the mirror of the defect this slice fixed, deliberately NOT taken here.
    // `mergeElement` gives `max` no tighter-of-the-two treatment, so a differential stating a larger
    // `max` than it inherits widens the bound and retires a `CARDINALITY_MAX`. It is left standing
    // because no read feeding `max` moved in this change: FHIR spells `max` as a string in both
    // formats, so `parseMax` read it from XML at the base commit too. Tightening it is a change to
    // the JSON path with no defect in this slice forcing it, which makes it its own decision.
    const base = json({
      resourceType: "StructureDefinition",
      url: "http://example.org/StructureDefinition/maxbase",
      type: "Observation",
      kind: "resource",
      derivation: "specialization",
      snapshot: {
        element: [
          { id: "Observation", path: "Observation" },
          { id: "Observation.performer", path: "Observation.performer", min: 0, max: "1" },
        ],
      },
    });
    const derived = load(
      json({
        resourceType: "StructureDefinition",
        url: "http://example.org/StructureDefinition/maxderived",
        type: "Observation",
        kind: "resource",
        derivation: "constraint",
        baseDefinition: "http://example.org/StructureDefinition/maxbase",
        differential: {
          element: [
            { id: "Observation", path: "Observation" },
            { id: "Observation.performer", path: "Observation.performer", max: "5" },
          ],
        },
      }),
    );

    expect(
      generateSnapshot(derived, (url) =>
        url === "http://example.org/StructureDefinition/maxbase" ? load(base) : undefined,
      ).find((el) => el.path === "Observation.performer")?.max,
    ).toBe(5);
  });

  it("reads a min a non-conformant JSON document spelled as a string, having no provenance to refuse it", () => {
    // Declared collateral rather than left to be found. FHIR JSON spells `min` as a number, so
    // `{"min": "1"}` is non-conformant - but the model records no provenance, so the lexical read
    // cannot be scoped to XML. The direction is lenient on the read and unchanged on the write: the
    // string is still what the writer hands back.
    const definition = load(
      json({
        resourceType: "StructureDefinition",
        url: "http://example.org/StructureDefinition/stringy",
        type: "Observation",
        kind: "resource",
        differential: { element: [{ path: "Observation.subject", min: "1" }] },
      }),
    );

    expect(definition.differential?.[0]?.min).toBe(1);
  });
});
