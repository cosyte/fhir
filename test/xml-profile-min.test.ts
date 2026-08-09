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
 * The text recognised is exactly R4's `positiveInt` lexical space, `[1-9][0-9]*` (datatypes.html).
 * Nothing is coerced and nothing is guessed: this is the same exactness the boolean read applies to
 * `true` / `false`, one datatype over.
 */
describe("the lexical space read is R4's, and nothing beside it", () => {
  const stated: readonly [string, number][] = [
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
 * The widening is additive by construction, and `0` is where that is bought.
 *
 * A lower bound of `0` imposes no obligation, so every site that acts on one tests `min >= 1` and
 * cannot tell `0` from absent. One site can: `mergeElement` treats an absent differential `min` as
 * *inherit* and a stated `0` as *override*. Taking `0` off XML would let a differential begin
 * overwriting an inherited `1` and **retire** a `CARDINALITY_MIN` the base emitted, which is exactly
 * the retirement the sibling `mustSupport` read was measured into and declined.
 */
describe("the widening can only add a bound, never lower one", () => {
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
        { id: "Observation.subject", path: "Observation.subject", min: 1, max: "1" },
      ],
    },
  };
  const derived = {
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
        { id: "Observation.subject", path: "Observation.subject", min: 0, max: "1" },
      ],
    },
  };
  const resolveBase = (url: string): StructureDefinition | undefined =>
    url === base.url ? load(json(base)) : undefined;

  it("reads a min of 0 as no bound stated, so the snapshot merge keeps the inherited bound", () => {
    const { fromXml } = bothSpellings(derived);

    expect(fromXml.differential?.[1]?.min).toBeUndefined();
    expect(
      generateSnapshot(fromXml, resolveBase).find((el) => el.path === "Observation.subject")?.min,
    ).toBe(1);
  });

  it("leaves the JSON path's own handling of a stated 0 exactly where it was", () => {
    // A both-states pin: this holds on the base tree too, and it is here to prove the widening did
    // NOT reach the JSON route. If it ever reads 1 here, the fix has changed the JSON path.
    const { fromJson } = bothSpellings(derived);

    expect(fromJson.differential?.[1]?.min).toBe(0);
    expect(
      generateSnapshot(fromJson, resolveBase).find((el) => el.path === "Observation.subject")?.min,
    ).toBe(0);
  });
});

/**
 * Characterization tests over what this change does NOT close, pinned so they cannot move in
 * silence. Closing any of them MUST red the test beside it, in the same change.
 *
 * The first two hold on the base tree as well - they are `PRE-EXISTING` residuals, recorded here
 * because they sit inside the read this change touches, and they are NOT evidence for it.
 */
describe("declared residuals of the lexical min read, pinned", () => {
  it("still reads no mustSupport and no slicing.ordered off an XML definition", () => {
    // Both-states pin. Deliberately unchanged: they were measured into a retirement of a
    // `MUST_SUPPORT_ABSENT`, and the `min` remedy does not license them - the argument that buys
    // `min` is the `0` exclusion above, which has no counterpart on a boolean flag.
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

  it("still reads a min of 0 as absent, so the loaded model does not say the profile stated it", () => {
    // The declared cost of the additivity argument above, stated as its own residual rather than
    // buried in it: an XML `<min value="0"/>` and an XML element with no `min` at all load
    // identically, and the public model cannot tell a caller which one the profile wrote. That was
    // true on the base tree too. It is the fail-safe of the two readings, not a free one.
    const withZero = load(
      xml(
        `<StructureDefinition ${FHIR_NS}><url value="http://example.org/StructureDefinition/zero"/>` +
          '<type value="Observation"/><kind value="resource"/><differential><element>' +
          '<path value="Observation.subject"/><min value="0"/><max value="1"/>' +
          "</element></differential></StructureDefinition>",
      ),
    );

    expect(withZero.differential?.[0]?.min).toBeUndefined();
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
