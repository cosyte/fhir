import { describe, expect, it } from "vitest";

import {
  complex,
  FhirSerializeError,
  list,
  parseResource,
  parseResourceXml,
  primitive,
  readSafety,
  SERIALIZE_ERROR_CODES,
  serializeResource,
  serializeResourceXml,
  validateResource,
  type FhirComplex,
} from "../src/index.js";

/**
 * An array wrapper around a `0..1` element, laundered by the `JSON -> XML` writer.
 *
 * FHIR JSON writes a single-valued element as a name/value pair and reserves the array for a
 * repeating one (json.html §2.6.2.2), so `{"status":["entered-in-error"]}` is a shape the spec does
 * not define. The safety layer reports it (`ARRAY_WRAPPED_SCALAR`, error severity) and declines to
 * affirm `safeToSummarize` over it, because a single-value read finds no string in it at all.
 *
 * FHIR XML spells a repeat by **repeating the element** (xml.html) and carries no other mark for
 * one. So a wrapper of fewer than two items emitted at most one element, which re-reads as an
 * ordinary single-valued element: measured at `8a91d29`, the document above emitted
 * `<Observation xmlns="http://hl7.org/fhir"><status value="entered-in-error"/></Observation>` and
 * came back with `arrayWrappedScalars: []`, `safeToSummarize: true`, `valid: true` and an empty
 * issue list. A format change upgraded a document's trustworthiness claim.
 *
 * **The cardinality decision on the write path**, which is what closing this needed: a writer cannot
 * decide cardinality in general, and this library has no per-resource model to decide it from. So it
 * takes its cardinality from the one window that already has one -- the locations the safety layer
 * reports -- and refuses inside that window only the wrappers XML cannot write back as a wrapper:
 * fewer than two items, plus **any** wrapper on `resourceType`, where the type is the tag and a tag
 * cannot be repeated. Both halves are asserted here, in both polarities.
 *
 * All values are synthetic.
 */

/** Serialize to XML, returning the refusal rather than throwing. */
function refusal(resource: FhirComplex): FhirSerializeError | undefined {
  try {
    serializeResourceXml(resource);
    return undefined;
  } catch (err) {
    if (err instanceof FhirSerializeError) return err;
    throw err;
  }
}

/** Parse JSON, then serialize to XML, keeping both sides. */
function fromJson(json: string): {
  resource: FhirComplex;
  refused: FhirSerializeError | undefined;
} {
  const { resource } = parseResource(json);
  return { resource, refused: refusal(resource) };
}

describe("an array wrapper XML cannot spell back is refused rather than flattened", () => {
  describe("the reported document, and what base did with it", () => {
    const REPORTED = '{"resourceType":"Observation","status":["entered-in-error"]}';

    it("refuses, on its own code, naming the location", () => {
      const { refused } = fromJson(REPORTED);
      expect(refused).toMatchObject({
        code: SERIALIZE_ERROR_CODES.UNSERIALIZABLE_ARRAY_WRAPPER,
        locations: ["Observation.status"],
      });
    });

    it("what base emitted re-read clean, which is the harm and is asserted, not described", () => {
      // The bytes base produced, run through this library's own reader. If a future change made the
      // refusal disappear, this is what it would be handing back.
      const laundered = parseResourceXml(
        '<Observation xmlns="http://hl7.org/fhir"><status value="entered-in-error"/></Observation>',
      );
      expect(laundered.issues).toEqual([]);
      expect(readSafety(laundered.resource).arrayWrappedScalars).toEqual([]);
      expect(readSafety(laundered.resource).safeToSummarize).toBe(true);
      expect(validateResource(laundered.resource).valid).toBe(true);
    });

    it("leaves the JSON route open, which is where the wrapper survives", () => {
      const { resource } = parseResource(REPORTED);
      expect(serializeResource(resource)).toBe(REPORTED);
      const back = readSafety(parseResource(serializeResource(resource)).resource);
      expect(back.arrayWrappedScalars).toEqual(["Observation.status"]);
      expect(back.safeToSummarize).toBe(false);
    });
  });

  describe("both polarities of the arity rule, at every reported element position", () => {
    const positions: readonly (readonly [string, string, string, string])[] = [
      ["status", "Observation", "status", '"entered-in-error"'],
      ["doNotPerform", "MedicationRequest", "doNotPerform", "true"],
      ["clinicalStatus", "Condition", "clinicalStatus", '{"coding":[{"code":"active"}]}'],
      ["verificationStatus", "Condition", "verificationStatus", '{"coding":[{"code":"refuted"}]}'],
      ["code", "AllergyIntolerance", "code", '{"coding":[{"code":"227493005"}]}'],
    ];

    it.each(positions)("refuses a singleton wrapper on %s", (_n, type, element, item) => {
      const { refused } = fromJson(`{"resourceType":"${type}","${element}":[${item}]}`);
      expect(refused).toMatchObject({
        code: SERIALIZE_ERROR_CODES.UNSERIALIZABLE_ARRAY_WRAPPER,
        locations: [`${type}.${element}`],
      });
    });

    it.each(positions)("refuses an EMPTY wrapper on %s too", (_n, type, element) => {
      // An empty wrapper emits no element at all, so the element vanishes outright: the same
      // laundering with even less left behind.
      const { refused } = fromJson(`{"resourceType":"${type}","${element}":[]}`);
      expect(refused).toMatchObject({
        code: SERIALIZE_ERROR_CODES.UNSERIALIZABLE_ARRAY_WRAPPER,
      });
    });

    it.each(positions)(
      "does NOT refuse a two-item wrapper on %s, and the finding survives the trip",
      (_n, type, element, item) => {
        // The negative pole, and the reason the rule is not arity-blind: XML writes two elements,
        // the re-read groups them into a list, and the same location is reported again. Refusing
        // here would withdraw a round trip that works today AND keeps the finding.
        const source = `{"resourceType":"${type}","${element}":[${item},${item}]}`;
        const { resource, refused } = fromJson(source);
        expect(refused).toBeUndefined();
        expect(readSafety(resource).arrayWrappedScalars).toEqual([`${type}.${element}`]);

        const back = parseResourceXml(serializeResourceXml(resource));
        expect(readSafety(back.resource).arrayWrappedScalars).toEqual([`${type}.${element}`]);
        expect(readSafety(back.resource).safeToSummarize).toBe(false);
      },
    );
  });

  describe("`resourceType`, the one position where no arity has a spelling", () => {
    // FHIR XML has no `resourceType` element: the type IS the tag, and a tag cannot be repeated. So
    // the writer skips the property outright however many entries it holds, and every arity
    // launders. This is a fact about XML, not about this writer's branching.
    it.each([
      ["empty", "[]"],
      ["singleton", '["MedicationStatement"]'],
      ["two", '["Observation","Patient"]'],
      ["three", '["Observation","Patient","Condition"]'],
    ])("refuses a %s wrapper on resourceType", (_n, arr) => {
      const { refused } = fromJson(`{"resourceType":${arr},"subject":{"reference":"Patient/1"}}`);
      expect(refused?.code).toBe(SERIALIZE_ERROR_CODES.UNSERIALIZABLE_ARRAY_WRAPPER);
    });

    it("what base emitted for a wrapped type gate, which is the sharper half", () => {
      // A wrapped `resourceType` suppresses every type-scoped negation behind it, so the document
      // that came back was not merely missing a complaint: base wrote `<Resource>` and the re-read
      // could not have found `not-taken` at all.
      const laundered = parseResourceXml(
        '<Resource xmlns="http://hl7.org/fhir"><status value="not-taken"/></Resource>',
      );
      expect(readSafety(laundered.resource).negations).toEqual([]);
      expect(readSafety(laundered.resource).safeToSummarize).toBe(true);

      const { resource, refused } = fromJson(
        '{"resourceType":["MedicationStatement"],"status":["not-taken"]}',
      );
      // The ROOT SEGMENT IS `Resource`, not `MedicationStatement`, and the difference from the
      // readout's own locations is deliberate rather than an oversight. Every write-path refusal
      // roots its locations at `typeOf`, the strict single-value read that rejects an unreadable
      // type instead of guessing; a wrapped type gate is exactly that case. The readout reaches the
      // string through the wrapper and names it. Both are pinned so neither can move in silence.
      expect(refused?.locations).toEqual(["Resource.resourceType", "Resource.status"]);
      expect(readSafety(resource).arrayWrappedScalars).toEqual([
        "MedicationStatement.resourceType",
        "MedicationStatement.status",
      ]);
    });
  });

  describe("the `Coding.system` / `Coding.code` level, one member at a time", () => {
    const SCT = "http://snomed.info/sct";

    it("refuses a singleton wrapper on a Coding member", () => {
      const { refused } = fromJson(
        `{"resourceType":"AllergyIntolerance","code":{"coding":[{"system":"${SCT}","code":["716186003"]}]}}`,
      );
      expect(refused).toMatchObject({
        code: SERIALIZE_ERROR_CODES.UNSERIALIZABLE_ARRAY_WRAPPER,
        locations: ["AllergyIntolerance.code.coding[0].code"],
      });
    });

    it("leaves a two-item wrapper on a Coding member alone, and it survives", () => {
      const source = `{"resourceType":"AllergyIntolerance","code":{"coding":[{"system":"${SCT}","code":["716186003","227493005"]}]}}`;
      const { resource, refused } = fromJson(source);
      expect(refused).toBeUndefined();
      const back = parseResourceXml(serializeResourceXml(resource));
      expect(readSafety(back.resource).arrayWrappedScalars).toEqual([
        "AllergyIntolerance.code.coding.code",
      ]);
      expect(readSafety(back.resource).safeToSummarize).toBe(false);
    });

    it("answers per written MEMBER, not per location", () => {
      // `system` is a singleton and `code` holds two, so the LOCATION is still reported after the
      // trip (the `code` wrapper keeps it) while the `system` wrapper is gone. The member that
      // vanishes is what this refusal is about, so it fires.
      const { refused } = fromJson(
        `{"resourceType":"AllergyIntolerance","code":{"coding":[{"system":["${SCT}"],"code":["716186003","227493005"]}]}}`,
      );
      expect(refused).toMatchObject({
        code: SERIALIZE_ERROR_CODES.UNSERIALIZABLE_ARRAY_WRAPPER,
        locations: ["AllergyIntolerance.code.coding[0].system"],
      });
    });

    it("answers over EVERY member of a repeated name, not only over all of them at once", () => {
      // A repeated `code` puts two wrappers on one Coding, and the safety layer reports the Coding
      // once. The short one is the member that vanishes, so `some` is the quantifier and `every`
      // would let it through. Both directions are pinned.
      const oneShort = fromJson(
        `{"resourceType":"AllergyIntolerance","code":{"coding":[{"system":"${SCT}",` +
          '"code":["716186003","227493005"],"code":["716186003"]}]}}',
      );
      expect(oneShort.refused).toMatchObject({
        code: SERIALIZE_ERROR_CODES.UNSERIALIZABLE_ARRAY_WRAPPER,
        locations: ["AllergyIntolerance.code.coding[0].code"],
      });

      const bothLong = fromJson(
        `{"resourceType":"AllergyIntolerance","code":{"coding":[{"system":"${SCT}",` +
          '"code":["716186003","227493005"],"code":["227493005","716186003"]}]}}',
      );
      expect(bothLong.refused).toBeUndefined();
    });
  });

  describe("an unwritable wrapper cannot hide behind a writable one at the same location", () => {
    it("refuses when the shadowed member is the unwritable one", () => {
      // A repeated property name puts two wrappers at one location. The reported-location set
      // de-duplicates, so if this refusal shared that de-duplication the singleton arriving SECOND
      // would be invisible. It is collected independently, and the order is asserted both ways.
      const shadowedIsShort = fromJson(
        '{"resourceType":"Observation","status":["final","amended"],"status":["entered-in-error"]}',
      );
      expect(shadowedIsShort.refused?.code).toBe(
        SERIALIZE_ERROR_CODES.UNSERIALIZABLE_ARRAY_WRAPPER,
      );
      expect(readSafety(shadowedIsShort.resource).arrayWrappedScalars).toEqual([
        "Observation.status",
      ]);

      const survivorIsShort = fromJson(
        '{"resourceType":"Observation","status":["entered-in-error"],"status":["final","amended"]}',
      );
      expect(survivorIsShort.refused?.code).toBe(
        SERIALIZE_ERROR_CODES.UNSERIALIZABLE_ARRAY_WRAPPER,
      );
    });

    it("does not fire when BOTH members are writable", () => {
      const { refused } = fromJson(
        '{"resourceType":"Observation","status":["final","amended"],"status":["entered-in-error","corrected"]}',
      );
      expect(refused).toBeUndefined();
    });
  });

  describe("raised last, so no case moves onto the new code", () => {
    it("keeps the JSON-only-shape refusal when a model trips both", () => {
      const { refused } = fromJson(
        '{"resourceType":"Observation","status":["entered-in-error"],"name":[[{"family":"Roe"}]]}',
      );
      expect(refused?.code).toBe(SERIALIZE_ERROR_CODES.UNSERIALIZABLE_JSON_ONLY_SHAPE);
    });

    it("keeps the element-name refusal when a model trips both", () => {
      const { refused } = fromJson(
        '{"resourceType":"Observation","status":["entered-in-error"],"zz value=\\"1\\"/><x":"1"}',
      );
      expect(refused?.code).toBe(SERIALIZE_ERROR_CODES.UNSERIALIZABLE_ELEMENT_NAME);
    });

    it("keeps the dropped-text refusal when a model trips both", () => {
      // No document carries both (one marker is XML's, the wrapper is JSON's), so this ordering is
      // only reachable from a hand-built node -- which is exactly why it needs pinning.
      const resource = complex([
        { name: "resourceType", value: primitive("Observation") },
        { name: "status", value: list([primitive("entered-in-error")]) },
        { name: "issued", value: { ...primitive(undefined), droppedText: true } },
      ]);
      expect(refusal(resource)?.code).toBe(SERIALIZE_ERROR_CODES.DROPPED_ELEMENT_TEXT);
    });
  });

  describe("nothing that works today is withdrawn", () => {
    it("does not touch a document read from XML that repeats an element", () => {
      // An XML document CAN put a list at a reported location, by repeating the element. Two
      // repeated elements are two items, so this leaves them alone: the round trip is byte-exact and
      // the finding is read on both sides.
      const doc =
        '<Observation xmlns="http://hl7.org/fhir"><status value="entered-in-error"/>' +
        '<status value="final"/></Observation>';
      const { resource, issues } = parseResourceXml(doc);
      expect(issues).toEqual([]);
      expect(readSafety(resource).arrayWrappedScalars).toEqual(["Observation.status"]);
      expect(serializeResourceXml(resource)).toBe(doc);
    });

    it("says nothing about a conformant document", () => {
      const conformant =
        '{"resourceType":"Observation","status":"entered-in-error","code":{"text":"synthetic"},' +
        '"identifier":[{"value":"synthetic-1"}],"category":[{"coding":[{"code":"vital-signs"}]}]}';
      const { resource, refused } = fromJson(conformant);
      expect(refused).toBeUndefined();
      expect(readSafety(resource).arrayWrappedScalars).toEqual([]);
    });

    it("says nothing where R4 really defines the element as repeating", () => {
      // The reason the window is scoped to a safety type at a resource root rather than keyed on the
      // element name: `Questionnaire.code` and `ElementDefinition.code` are `0..*`, so a name-only
      // rule would refuse two conformant documents.
      expect(
        fromJson('{"resourceType":"Questionnaire","status":"active","code":[{"code":"s1"}]}')
          .refused,
      ).toBeUndefined();
      expect(
        fromJson(
          '{"resourceType":"StructureDefinition","status":"draft","differential":{"element":' +
            '[{"path":"Observation.value[x]","code":[{"code":"a"}]}]}}',
        ).refused,
      ).toBeUndefined();
    });

    it("says nothing about a backbone element, whose cardinality this library does not know", () => {
      expect(
        fromJson('{"resourceType":"Observation","status":"final","component":[{"code":["x"]}]}')
          .refused,
      ).toBeUndefined();
    });
  });

  describe("what this does NOT cover, measured rather than implied", () => {
    it("does not reach a writable wrapper that only a SHADOWED member carried", () => {
      // `{"status":"final","status":["a","b"]}` reports `Observation.status` and comes back from XML
      // reporting nothing, so the location does launder here. It is NOT this class: the wrapper is
      // writable (two items), what drops it is the repeated property name, and the JSON writer drops
      // it identically -- `{"resourceType":"Observation","status":"final"}`, with `safeToSummarize`
      // going `false -> true` on THAT route too. `DUPLICATE_PROPERTY` and the safety refusal are
      // what carry such a document, and the repeated name is its own declared-open residual.
      const source = '{"resourceType":"Observation","status":"final","status":["a","b"]}';
      const { resource, refused } = fromJson(source);
      expect(refused).toBeUndefined();
      expect(readSafety(resource).arrayWrappedScalars).toEqual(["Observation.status"]);

      expect(serializeResource(resource)).toBe('{"resourceType":"Observation","status":"final"}');
      const viaJson = readSafety(parseResource(serializeResource(resource)).resource);
      expect(viaJson.arrayWrappedScalars).toEqual([]);
      expect(viaJson.safeToSummarize).toBe(true);

      const viaXml = parseResourceXml(serializeResourceXml(resource));
      expect(readSafety(viaXml.resource).arrayWrappedScalars).toEqual([]);

      // The same shape on a Coding, which is where a member that is not a wrapper at all reaches
      // the predicate: a bare `code` beside a shadowed two-item one is not a wrapper this can spell
      // back OR refuse, and it must not be mistaken for one.
      const coding = fromJson(
        `{"resourceType":"AllergyIntolerance","code":{"coding":[{"system":"${"http://snomed.info/sct"}",` +
          '"code":"x","code":["a","b"]}]}}',
      );
      expect(coding.refused).toBeUndefined();
    });

    it("does not extend past the safety layer's window, `Observation.value[x]` included", () => {
      // A `0..1` choice element, and a wrapper on it still launders -- because the window this took
      // its cardinality from does not reach it. Widening it means a per-resource model, which is a
      // different change and one this library deliberately does not have.
      const source =
        '{"resourceType":"Observation","status":"final","valueQuantity":[{"value":5,"unit":"mg"}]}';
      const { resource, refused } = fromJson(source);
      expect(refused).toBeUndefined();
      expect(readSafety(resource).arrayWrappedScalars).toEqual([]);
      expect(serializeResourceXml(resource)).toBe(
        '<Observation xmlns="http://hl7.org/fhir"><status value="final"/>' +
          '<valueQuantity><value value="5"/><unit value="mg"/></valueQuantity></Observation>',
      );
    });
  });

  describe("the refusal is value-free, like every other diagnostic here", () => {
    it("carries bounded locations and never the wrapped value", () => {
      const { refused } = fromJson(
        '{"resourceType":"Observation","status":["entered-in-error"],"code":[{"text":"SECRET"}]}',
      );
      const serialized = JSON.stringify({
        message: refused?.message,
        locations: refused?.locations,
      });
      expect(serialized).not.toContain("SECRET");
      expect(serialized).not.toContain("entered-in-error");
    });
  });

  describe("nested resources reach it too", () => {
    it("refuses a wrapper on a contained resource and on a Bundle entry", () => {
      expect(
        fromJson(
          '{"resourceType":"Patient","contained":[{"resourceType":"Observation",' +
            '"status":["entered-in-error"]}]}',
        ).refused?.locations,
      ).toEqual(["Patient.contained[0].status"]);

      expect(
        fromJson(
          '{"resourceType":"Bundle","type":"collection","entry":[{"resource":' +
            '{"resourceType":"Observation","status":["entered-in-error"]}}]}',
        ).refused?.locations,
      ).toEqual(["Bundle.entry[0].resource.status"]);
    });
  });
});
