import { describe, expect, it } from "vitest";

import {
  complex,
  FhirSerializeError,
  parseResource,
  parseResourceXml,
  primitive,
  readSafety,
  SERIALIZE_ERROR_CODES,
  serializeResource,
  serializeResourceXml,
  shadowedProperties,
  validateResource,
  type FhirComplex,
} from "../src/index.js";

/**
 * A member a repeated property name shadowed, which **both** writers used to drop.
 *
 * The reader keeps it (`FhirComplex.duplicates`), `validateResource` raises an error-severity
 * `DUPLICATE_PROPERTY` over it and `readSafety` refuses to affirm `safeToSummarize` -- all of which
 * are findings about the **input**. Each writer walks `properties` only, so each emitted one member
 * per name, and that output is a different document carrying none of them.
 *
 * Measured at `914c03a`: `{"resourceType":"Observation","status":"final",
 * "status":"entered-in-error"}` emitted `{"resourceType":"Observation","status":"final"}` and
 * `<Observation xmlns="http://hl7.org/fhir"><status value="final"/></Observation>`, and both
 * re-read with an empty issue list, `valid: true` and `safeToSummarize: true`. The retraction is not
 * in either output. Which value is lost depends only on the order the sender wrote them in.
 *
 * That measurement is a reading taken then and is left as it was taken. Re-read today, those two
 * outputs draw the mandatory `Observation.code` a two-property document never carried, because
 * `Observation` now has a built-in element table. It is an ADDED finding about a DIFFERENT element
 * and it says nothing about the shadowed member, so the assertions below name the finding list
 * rather than `valid`, which no longer separates the two questions.
 *
 * Handing both back is the route the JSON-only shapes take, and here it is worse: `JSON.parse`
 * resolves a repeated name last-wins while this library reads first-wins, so emitting both members
 * hands every other consumer the value this one calls shadowed. That is asserted below rather than
 * argued.
 *
 * All values are synthetic.
 */

/** Serialize, returning the refusal rather than throwing. */
function refusal(
  write: (node: FhirComplex) => string,
  resource: FhirComplex,
): FhirSerializeError | undefined {
  try {
    write(resource);
    return undefined;
  } catch (err) {
    if (err instanceof FhirSerializeError) return err;
    throw err;
  }
}

/** Both writers' verdicts on one parsed document. */
function bothWriters(json: string): {
  resource: FhirComplex;
  viaJson: FhirSerializeError | undefined;
  viaXml: FhirSerializeError | undefined;
} {
  const { resource } = parseResource(json);
  return {
    resource,
    viaJson: refusal(serializeResource, resource),
    viaXml: refusal(serializeResourceXml, resource),
  };
}

const RETRACTION_SHADOWED =
  '{"resourceType":"Observation","status":"final","status":"entered-in-error"}';

describe("a member a repeated property name shadowed is refused by both writers", () => {
  it("refuses the retraction case on both paths, at the location the reader reported", () => {
    const { resource, viaJson, viaXml } = bothWriters(RETRACTION_SHADOWED);
    for (const refused of [viaJson, viaXml]) {
      expect(refused?.code).toBe(SERIALIZE_ERROR_CODES.UNSERIALIZABLE_SHADOWED_PROPERTY);
      expect(refused?.locations).toEqual(["Observation.status"]);
    }
    // The location is the one the read and the safety layer already name, not a new one.
    expect(shadowedProperties(resource, "Observation")).toEqual(["Observation.status"]);
  });

  it("is the loss it exists for: the retraction is absent from what base emitted", () => {
    // The base behaviour, reconstructed from the surviving member alone. This is the document both
    // writers used to produce, and it is what makes the finding disappear.
    const laundered = parseResource('{"resourceType":"Observation","status":"final"}');
    expect(laundered.issues).toEqual([]);
    // Not a trace of the shadowed member: the one finding left is the mandatory `code` this
    // reconstruction never carried, which is about a different element entirely.
    expect(validateResource(laundered.resource).issues.map((issue) => issue.code)).toEqual([
      "CARDINALITY_MIN",
    ]);
    expect(readSafety(laundered.resource).safeToSummarize).toBe(true);
    expect(readSafety(laundered.resource).negations).toEqual([]);
    // Where the input said otherwise on every one of those three.
    const { resource } = parseResource(RETRACTION_SHADOWED);
    expect(validateResource(resource).issues.map((issue) => issue.code)).toContain(
      "DUPLICATE_PROPERTY",
    );
    expect(validateResource(resource).valid).toBe(false);
    expect(readSafety(resource).safeToSummarize).toBe(false);
    expect(readSafety(resource).negations).toEqual(["entered-in-error"]);
  });

  it("loses whichever member the sender wrote second, so the order decides the harm", () => {
    // The mirror spelling: the retraction survives and `final` is shadowed. Refused identically,
    // which is the point -- the writer cannot know which of the two the sender meant.
    const { viaJson, viaXml } = bothWriters(
      '{"resourceType":"Observation","status":"entered-in-error","status":"final"}',
    );
    expect(viaJson?.code).toBe(SERIALIZE_ERROR_CODES.UNSERIALIZABLE_SHADOWED_PROPERTY);
    expect(viaXml?.code).toBe(SERIALIZE_ERROR_CODES.UNSERIALIZABLE_SHADOWED_PROPERTY);
  });

  it("does not hand both members back, because JSON.parse would resolve them the other way", () => {
    // The measurement behind refusing rather than handing back: emitting both members produces a
    // document every conformant JSON consumer reads last-wins, where this library reads first-wins.
    // The mirror spelling is the one that shows the harm direction: the model holds the retraction
    // and `JSON.parse` returns `final`, so the hand-back would tell a third party the opposite.
    const mirror = '{"resourceType":"Observation","status":"entered-in-error","status":"final"}';
    expect((JSON.parse(mirror) as { status: string }).status).toBe("final");
    const { resource } = parseResource(mirror);
    expect(resource.properties.find((property) => property.name === "status")?.value).toMatchObject(
      {
        kind: "primitive",
        value: "entered-in-error",
      },
    );
    expect(readSafety(resource).negations).toEqual(["entered-in-error"]);
  });
});

describe("the window it refuses over, and the bound that window carries", () => {
  it("reaches every depth the safety layer walks: nested, list item, contained", () => {
    const cases: readonly [string, string][] = [
      ['{"resourceType":"Patient","name":{"family":"Roe","family":"Doe"}}', "Patient.name.family"],
      [
        '{"resourceType":"Patient","name":[{"family":"Roe","family":"Doe"}]}',
        "Patient.name[0].family",
      ],
      [
        '{"resourceType":"Patient","contained":[{"resourceType":"Observation",' +
          '"status":"entered-in-error","status":"final"}]}',
        "Patient.contained[0].status",
      ],
    ];
    for (const [json, location] of cases) {
      const { viaJson, viaXml } = bothWriters(json);
      expect(viaJson?.locations).toEqual([location]);
      expect(viaXml?.locations).toEqual([location]);
    }
  });

  it("refuses only documents this library already reports as invalid and unsummarizable", () => {
    // Not a measurement over examples: the refusal calls `shadowedProperties`, which is the same
    // call `validateResource` raises its error from and the same one `readSafety` requires empty.
    // Asserted in both polarities on one document all the same.
    const { resource } = parseResource(RETRACTION_SHADOWED);
    expect(validateResource(resource).valid).toBe(false);
    expect(readSafety(resource).safeToSummarize).toBe(false);

    const clean = parseResource('{"resourceType":"Observation","status":"final"}');
    expect(shadowedProperties(clean.resource, "Observation")).toEqual([]);
    expect(serializeResource(clean.resource)).toBe(
      '{"resourceType":"Observation","status":"final"}',
    );
    expect(serializeResourceXml(clean.resource)).toBe(
      '<Observation xmlns="http://hl7.org/fhir"><status value="final"/></Observation>',
    );
  });

  it("no document read from XML reaches it, because that reader has no duplicates channel", () => {
    // Two elements of one name re-read as a LIST, not as a shadowed member, so the round trip that
    // XML CAN spell is untouched by this refusal.
    const { resource } = parseResourceXml(
      '<Observation xmlns="http://hl7.org/fhir"><status value="final"/>' +
        '<status value="amended"/></Observation>',
    );
    expect(resource.duplicates).toBeUndefined();
    expect(shadowedProperties(resource, "Observation")).toEqual([]);
    expect(serializeResourceXml(resource)).toBe(
      '<Observation xmlns="http://hl7.org/fhir"><status value="final"/>' +
        '<status value="amended"/></Observation>',
    );
  });
});

describe("raised last, so no case moves onto the new code", () => {
  it("keeps each of the four refusals above it when a model trips both", () => {
    const cases: readonly [string, string][] = [
      // Dropped element text, the one other refusal that runs in both writers.
      [
        '<Observation xmlns="http://hl7.org/fhir"><status>final</status></Observation>',
        SERIALIZE_ERROR_CODES.DROPPED_ELEMENT_TEXT,
      ],
    ];
    for (const [xml, code] of cases) {
      const { resource } = parseResourceXml(xml);
      expect(refusal(serializeResourceXml, resource)?.code).toBe(code);
    }

    // The three XML-only ones, each on a JSON document that ALSO repeats a name.
    const tripsBoth: readonly [string, string][] = [
      [
        '{"resourceType":"Observation","status":"final","status":"amended",' +
          '"zz value=\\"1\\"/><status":1}',
        SERIALIZE_ERROR_CODES.UNSERIALIZABLE_ELEMENT_NAME,
      ],
      [
        '{"resourceType":"Patient","active":true,"active":false,' +
          '"text":{"status":"generated","div":"<div>a</div><div>b</div>"}}',
        SERIALIZE_ERROR_CODES.UNSERIALIZABLE_DIV_MARKUP,
      ],
      [
        '{"resourceType":"Patient","name":[{"family":"Roe"}],"name":[[{"family":"Roe"}]]}',
        SERIALIZE_ERROR_CODES.UNSERIALIZABLE_JSON_ONLY_SHAPE,
      ],
      [
        '{"resourceType":"Observation","status":["entered-in-error"],"status":["final","amended"]}',
        SERIALIZE_ERROR_CODES.UNSERIALIZABLE_ARRAY_WRAPPER,
      ],
    ];
    for (const [json, code] of tripsBoth) {
      const { resource } = parseResource(json);
      expect(refusal(serializeResourceXml, resource)?.code).toBe(code);
      // And the JSON writer, which has only one refusal ahead of this, reports the new one.
      expect(refusal(serializeResource, resource)?.code).toBe(
        SERIALIZE_ERROR_CODES.UNSERIALIZABLE_SHADOWED_PROPERTY,
      );
    }
  });
});

describe("what it does not cover, measured rather than implied", () => {
  it("leaves a repeated name in a primitive's `_`-sibling, which is not modeled at all", () => {
    // The reader flags it (`DUPLICATE_PROPERTY`) but carries no shadowed member for a primitive's
    // R4 `Element` metadata, so there is nothing here to refuse.
    const source = '{"resourceType":"Observation","status":"final","_status":{"id":"a","id":"b"}}';
    const { resource, viaJson, viaXml } = bothWriters(source);
    expect(parseResource(source).issues.map((issue) => issue.expression)).toEqual([
      "Observation.status.id",
    ]);
    expect(viaJson).toBeUndefined();
    expect(viaXml).toBeUndefined();
    expect(serializeResource(resource)).toBe(
      '{"resourceType":"Observation","status":"final","_status":{"id":"a"}}',
    );
  });

  it("leaves a repeated name inside a primitive's `extension`, and states the cost of not", () => {
    // This one IS modeled -- the extension is a complex with `duplicates` -- but it sits outside
    // `shadowedProperties`, which does not descend a primitive's metadata. Both writers still drop
    // it. Left rather than refused because the document reads clean, so refusing would withdraw a
    // round trip from a model this library reports as fine: the one cost none of these refusals
    // pays. Declared, and asserted in the state that makes it a gap.
    const source =
      '{"resourceType":"Observation","status":"final","code":{"text":"synthetic"},"_status":{"extension":' +
      '[{"url":"http://example.org/synthetic","valueString":"x","valueString":"y"}]}}';
    const { resource, viaJson, viaXml } = bothWriters(source);
    expect(viaJson).toBeUndefined();
    expect(viaXml).toBeUndefined();
    expect(validateResource(resource).valid).toBe(true);
    expect(readSafety(resource).safeToSummarize).toBe(true);
    // The drop itself, so the gap cannot be read as absent.
    expect(serializeResource(resource)).not.toContain('"y"');
  });

  it("says nothing about a hand-built node carrying `duplicates` under a name it cannot address", () => {
    // The window is the safety layer's walk, so a node built by hand is covered exactly as a parsed
    // one is: the refusal has no separate table to disagree with.
    const node = complex(
      [
        { name: "resourceType", value: primitive("Observation") },
        { name: "status", value: primitive("final") },
      ],
      [{ name: "status", value: primitive("entered-in-error") }],
    );
    expect(refusal(serializeResource, node)?.locations).toEqual(["Observation.status"]);
    expect(refusal(serializeResourceXml, node)?.locations).toEqual(["Observation.status"]);
  });
});
