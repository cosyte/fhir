import { describe, expect, it } from "vitest";

import {
  complex,
  FhirSerializeError,
  list,
  parseResource,
  parseResourceXml,
  primitive,
  readObservationValue,
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
      // Nothing about the wrapper survives, which is the harm. Stated as the whole finding list
      // rather than as `valid`, which is strictly stronger: the mandatory `code` this two-property
      // document never carried is raised by the built-in Observation element table and says nothing
      // about a retraction sitting inside an array, and the retraction note is information.
      expect(
        validateResource(laundered.resource).issues.map(
          (issue) => `${issue.code}/${issue.severity} at ${issue.expression}`,
        ),
      ).toEqual([
        "CARDINALITY_MIN/error at Observation.code",
        "RETRACTED_RESOURCE/information at Observation.status",
      ]);
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
      // A wrapped `resourceType` suppresses every **type-scoped** read behind it, so the document
      // that came back was not merely missing a complaint: base wrote `<Resource>`, and a re-read of
      // that output cannot reach a read the type gate stands in front of. Keyed to the negation that
      // is still type-scoped, "no known allergy", because that is what makes the assertion say
      // something. It was keyed to a laundered `<Resource><status value="not-taken"/></Resource>`,
      // which this assertion outlived: the status-code negations stopped being gated on a type, that
      // document now reads `["not-taken"]`, and the assertion was **false at head**, not merely
      // quiet. The claim it was making is true only of a read the type gate still stands in front of.
      const NKA =
        '<code><coding><system value="http://snomed.info/sct"/>' +
        '<code value="716186003"/></coding></code>';
      const laundered = parseResourceXml(`<Resource xmlns="http://hl7.org/fhir">${NKA}</Resource>`);
      expect(readSafety(laundered.resource).negations).toEqual([]);
      expect(readSafety(laundered.resource).safeToSummarize).toBe(true);
      // The identical content under the tag the sender's type would have produced, so the assertion
      // above is a statement about the lost type rather than about the document's content.
      const kept = parseResourceXml(
        `<AllergyIntolerance xmlns="http://hl7.org/fhir">${NKA}</AllergyIntolerance>`,
      );
      expect(readSafety(kept.resource).negations).toEqual(["no-known-allergy"]);

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
      // Not THIS refusal: both wrappers are writable. The repeated name is refused by the code
      // raised after it, which is what carries the document instead.
      expect(bothLong.refused?.code).toBe(SERIALIZE_ERROR_CODES.UNSERIALIZABLE_SHADOWED_PROPERTY);
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
      // Both wrappers hold two items, so THIS refusal has nothing to say. The document is still
      // refused, by the repeated-name code raised after it, and the distinction is the point: this
      // one must not claim a location it did not decide.
      expect(refused?.code).toBe(SERIALIZE_ERROR_CODES.UNSERIALIZABLE_SHADOWED_PROPERTY);
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
      // `{"status":"final","status":["a","b"]}` reports `Observation.status` and used to come back
      // from BOTH writers reporting nothing. That is not this class: the wrapper is writable (two
      // items) and what drops it is the repeated property name. So this refusal still says nothing
      // about it -- the code raised after it does, which is the assertion that keeps the two apart.
      const source = '{"resourceType":"Observation","status":"final","status":["a","b"]}';
      const { resource, refused } = fromJson(source);
      expect(refused?.code).toBe(SERIALIZE_ERROR_CODES.UNSERIALIZABLE_SHADOWED_PROPERTY);
      expect(readSafety(resource).arrayWrappedScalars).toEqual(["Observation.status"]);
      // The JSON route is refused on the same code, so neither writer emits the flattened document
      // this test used to assert.
      expect(() => serializeResource(resource)).toThrow(FhirSerializeError);

      // The same shape on a Coding, which is where a member that is not a wrapper at all reaches
      // the predicate: a bare `code` beside a shadowed two-item one is not a wrapper this can spell
      // back OR refuse, and it must not be mistaken for one.
      const coding = fromJson(
        `{"resourceType":"AllergyIntolerance","code":{"coding":[{"system":"${"http://snomed.info/sct"}",` +
          '"code":"x","code":["a","b"]}]}}',
      );
      expect(coding.refused?.code).toBe(SERIALIZE_ERROR_CODES.UNSERIALIZABLE_SHADOWED_PROPERTY);
    });

    it("counts ITEMS, not emitted elements, and the two part on a hand-built node", () => {
      // The predicate tests `items.length`, while the sentence justifying it reasons about how many
      // ELEMENTS get emitted. Those are the same number for a model a reader produced and not in
      // general: a list whose items are themselves lists holds two items and emits none. Base
      // launders it identically, so this is `PRE-EXISTING` and pinned rather than fixed -- widening
      // the guard to catch it would start refusing arity-2 wrappers, withdrawing the working round
      // trip the arity rule exists to protect.
      const empties = complex([
        { name: "resourceType", value: primitive("Observation") },
        { name: "status", value: list([list([]), list([])]) },
      ]);
      expect(refusal(empties)).toBeUndefined();
      expect(readSafety(empties).arrayWrappedScalars).toEqual(["Observation.status"]);
      expect(serializeResourceXml(empties)).toBe('<Observation xmlns="http://hl7.org/fhir"/>');
      expect(
        readSafety(parseResourceXml(serializeResourceXml(empties)).resource).safeToSummarize,
      ).toBe(true);
    });

    it("is unreachable from a parsed document: NEITHER READER BUILDS A LIST OF LISTS", () => {
      // What actually holds the gap shut, measured rather than assumed. The JSON reader models a
      // nested array as a marked COMPLEX, so `{"status":[["a"],["b"]]}` is `list([complex, complex])`
      // and the item count this refusal reads is 2 whatever order the guards run in; every spelling
      // is refused on `UNSERIALIZABLE_JSON_ONLY_SHAPE` because that guard fires at all, not because
      // it fires first. An earlier revision of this test was named for a guard ORDER and did not
      // pin one; the ordering that IS load-bearing (which code a model tripping two reports) is
      // pinned by the "raised last" block above.
      for (const src of [
        '{"resourceType":"Observation","status":[["a"],["b"]]}',
        '{"resourceType":"Observation","status":["a",["b"]]}',
        '{"resourceType":"Observation","status":[[],[]]}',
      ]) {
        expect(fromJson(src).refused?.code).toBe(
          SERIALIZE_ERROR_CODES.UNSERIALIZABLE_JSON_ONLY_SHAPE,
        );
      }
      // The model shape itself, which is the actual protection.
      const nested = parseResource(
        '{"resourceType":"Observation","status":[["a"],["b"]]}',
      ).resource;
      const nestedStatus = nested.properties.find((p) => p.name === "status");
      expect(
        nestedStatus?.value.kind === "list" &&
          nestedStatus.value.items.every((i) => i.kind === "complex"),
      ).toBe(true);

      // …and XML cannot spell a list of lists at all, so no XML-read model reaches it either.
      const xml = parseResourceXml(
        '<Observation xmlns="http://hl7.org/fhir"><status value="a"/><status value="b"/></Observation>',
      );
      const status = xml.resource.properties.find((p) => p.name === "status");
      expect(status?.value.kind).toBe("list");
      expect(
        status?.value.kind === "list" && status.value.items.every((i) => i.kind !== "list"),
      ).toBe(true);
    });

    it("still does not extend the SAFETY layer's own window past the elements it reads", () => {
      // The bound that has NOT moved. `Observation.value[x]` is a `0..1` choice and is still not an
      // element the safety layer reads a verdict out of, so it draws no ARRAY_WRAPPED_SCALAR and
      // THIS refusal still says nothing about it. What closed is the laundering, and it closed on a
      // cardinality the VALUE layer has for that one position (`xml-value-choice-wrapper`, below),
      // not by widening this window into the per-resource model the library does not have.
      const { resource, refused } = fromJson(
        '{"resourceType":"Observation","status":"final","valueQuantity":[{"value":5,"unit":"mg"}]}',
      );
      expect(readSafety(resource).arrayWrappedScalars).toEqual([]);
      expect(refused?.code).not.toBe(SERIALIZE_ERROR_CODES.UNSERIALIZABLE_ARRAY_WRAPPER);
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

/** A `code` so the reported documents below are conformant but for the wrapper under test. */
const CODE = '"code":{"text":"synthetic"}';

/** The reported document: one array-wrapped `value[x]`, carrying a DOSE. Synthetic throughout. */
const REPORTED_VALUE =
  `{"resourceType":"Observation","status":"final",${CODE},` +
  '"valueQuantity":[{"value":5,"system":"http://unitsofmeasure.org","code":"mg"}]}';

/**
 * An array wrapper around an `Observation.value[x]` choice, laundered by the `JSON -> XML` writer.
 *
 * The sibling of the element-level residual above, at the position where the number is a **dose**,
 * and the reason it needed a rule of its own: the element-level refusal takes its cardinality from
 * the safety layer's walk, which is scoped by resource type to the elements a safety verdict is read
 * out of, and `value[x]` is not one of them. Widening THAT window to every R4 `0..1` element is the
 * per-resource model this library does not have.
 *
 * **Where the cardinality comes from instead.** The value readout already walks the eleven
 * `value[x]` variant names, and R4 spells that choice at two positions, `Observation.value[x]` and
 * `Observation.component.value[x]`, both `0..1` (observation.html). That walk is the window, and the
 * validator's `ARRAY_WRAPPED_CHOICE`, the readout's own `encodingIssue` and this refusal all read it
 * rather than each deciding a cardinality. So this refusal can never name a location the library
 * does not already report, which is the discipline the element-level one holds.
 *
 * **The arity rule is the same rule and for the same reason**: XML spells a repeat by repeating the
 * element, so a wrapper of two or more items writes as repeated elements the re-read groups back
 * into a list, and the location is reported again. Refusing those would withdraw a round trip that
 * works today AND keeps the finding. Both poles are asserted.
 */
describe("an array wrapper around `value[x]` is refused rather than normalized away", () => {
  it("AC-4: refuses the write on its own stable code, naming the position", () => {
    const { refused } = fromJson(REPORTED_VALUE);
    expect(refused).toMatchObject({
      code: SERIALIZE_ERROR_CODES.UNSERIALIZABLE_CHOICE_WRAPPER,
      locations: ["Observation.valueQuantity"],
    });
  });

  it("AC-4: what base emitted re-read as a confident dose, which is the harm and is asserted", () => {
    // The bytes base produced for the document above, run through this library's own reader. If the
    // refusal ever disappears, THIS is what it would be handing a caller: a 5 mg nothing complained
    // about, out of a document whose own reading declined to give a number at all.
    const laundered = parseResourceXml(
      '<Observation xmlns="http://hl7.org/fhir"><status value="final"/>' +
        '<code><text value="synthetic"/></code><valueQuantity><value value="5"/>' +
        '<system value="http://unitsofmeasure.org"/><code value="mg"/></valueQuantity></Observation>',
    );
    expect(laundered.issues).toEqual([]);
    expect(validateResource(laundered.resource).issues).toEqual([]);
    expect(validateResource(laundered.resource).valid).toBe(true);
    const value = readObservationValue(laundered.resource);
    expect(value?.quantity?.value?.toString()).toBe("5");
    expect(value?.quantity?.code).toBe("mg");
    expect(value?.encodingIssue).toBeUndefined();

    // …and the same document before the trip, which is what makes the line above a LOSS rather than
    // a reading: no magnitude was readable, and the encoding was reported.
    const { resource } = parseResource(REPORTED_VALUE);
    expect(readObservationValue(resource)?.quantity).toBeUndefined();
    expect(readObservationValue(resource)?.encodingIssue).toBe("ARRAY_WRAPPED_CHOICE");
  });

  it("AC-4: leaves the JSON route open, which is where the wrapper survives", () => {
    // The capability is routed rather than lost, exactly as the element-level refusal routes it.
    const { resource } = parseResource(REPORTED_VALUE);
    expect(serializeResource(resource)).toBe(REPORTED_VALUE);

    const back = parseResource(serializeResource(resource)).resource;
    expect(readObservationValue(back)?.encodingIssue).toBe("ARRAY_WRAPPED_CHOICE");
    expect(readObservationValue(back)?.quantity).toBeUndefined();
    expect(validateResource(back).issues.map((i) => `${i.code} at ${i.expression}`)).toContain(
      "ARRAY_WRAPPED_CHOICE at Observation.valueQuantity",
    );
  });

  it("AC-4: refuses a wrapped component value and one on a contained resource", () => {
    expect(
      fromJson(
        `{"resourceType":"Observation","status":"final",${CODE},"component":[{${CODE},` +
          '"valueQuantity":[{"value":5,"code":"mg"}]}]}',
      ).refused,
    ).toMatchObject({
      code: SERIALIZE_ERROR_CODES.UNSERIALIZABLE_CHOICE_WRAPPER,
      locations: ["Observation.component[0].valueQuantity"],
    });

    expect(
      fromJson(
        '{"resourceType":"Patient","contained":[{"resourceType":"Observation","status":"final",' +
          '"valueQuantity":[{"value":5,"code":"mg"}]}]}',
      ).refused,
    ).toMatchObject({
      code: SERIALIZE_ERROR_CODES.UNSERIALIZABLE_CHOICE_WRAPPER,
      locations: ["Patient.contained[0].valueQuantity"],
    });
  });

  it("AC-5: does NOT refuse a two-item wrapper, and the report survives the round trip", () => {
    // The negative pole, and the reason the rule is not arity-blind: XML writes two elements, the
    // re-read groups them into a list, and the same location is reported again. Refusing here would
    // withdraw a round trip that works today AND keeps the finding.
    const source =
      `{"resourceType":"Observation","status":"final",${CODE},"valueQuantity":[` +
      '{"value":5,"system":"http://unitsofmeasure.org","code":"mg"},' +
      '{"value":7,"system":"http://unitsofmeasure.org","code":"mg"}]}';
    const { resource, refused } = fromJson(source);
    expect(refused).toBeUndefined();

    const xml = serializeResourceXml(resource);
    const back = parseResourceXml(xml);
    expect(readObservationValue(back.resource)?.encodingIssue).toBe("ARRAY_WRAPPED_CHOICE");
    expect(readObservationValue(back.resource)?.quantity).toBeUndefined();
    expect(
      validateResource(back.resource).issues.map((i) => `${i.code} at ${i.expression}`),
    ).toContain("ARRAY_WRAPPED_CHOICE at Observation.valueQuantity");
    // And the trip is byte-exact, so nothing was traded for the report.
    expect(serializeResourceXml(back.resource)).toBe(xml);
  });

  it("AC-7: reports an EMPTY wrapper and refuses rather than emitting a document with neither", () => {
    // An empty wrapper emits no element at all, so the element AND the report both vanish: the same
    // laundering with even less left behind. The position is unreadable and is reported as such.
    const empty = `{"resourceType":"Observation","status":"final",${CODE},"valueQuantity":[]}`;
    const { resource, refused } = fromJson(empty);

    expect(readObservationValue(resource)?.encodingIssue).toBe("ARRAY_WRAPPED_CHOICE");
    expect(readObservationValue(resource)?.quantity).toBeUndefined();
    expect(validateResource(resource).issues.map((i) => `${i.code} at ${i.expression}`)).toContain(
      "ARRAY_WRAPPED_CHOICE at Observation.valueQuantity",
    );
    expect(refused).toMatchObject({
      code: SERIALIZE_ERROR_CODES.UNSERIALIZABLE_CHOICE_WRAPPER,
      locations: ["Observation.valueQuantity"],
    });
    // What base emitted for this document, asserted rather than described: no `valueQuantity` at
    // all, and a reading with nothing anywhere to say one had ever been written.
    const laundered = parseResourceXml(
      '<Observation xmlns="http://hl7.org/fhir"><status value="final"/>' +
        '<code><text value="synthetic"/></code></Observation>',
    );
    expect(laundered.issues).toEqual([]);
    expect(readObservationValue(laundered.resource)).toBeUndefined();
    expect(validateResource(laundered.resource).valid).toBe(true);
  });

  it("AC-10: a document tripping an existing refusal keeps that code, unchanged", () => {
    // Raised last, so nothing that already reported one of the six moves onto this one. One row per
    // refusal that can sit beside a wrapped `value[x]` on the same model.
    const wrapped = '"valueQuantity":[{"value":5,"code":"mg"}]';
    const cases: readonly (readonly [string, string])[] = [
      // The element-level wrapper refusal, the nearest neighbour of all.
      [
        `{"resourceType":"Observation","status":["final"],${wrapped}}`,
        SERIALIZE_ERROR_CODES.UNSERIALIZABLE_ARRAY_WRAPPER,
      ],
      // A shape only FHIR JSON can spell.
      [
        `{"resourceType":"Observation","status":"final","name":[[{"family":"Roe"}]],${wrapped}}`,
        SERIALIZE_ERROR_CODES.UNSERIALIZABLE_JSON_ONLY_SHAPE,
      ],
      // A name that cannot occupy a tag.
      [
        `{"resourceType":"Observation","status":"final","zz value=\\"1\\"/><x":"1",${wrapped}}`,
        SERIALIZE_ERROR_CODES.UNSERIALIZABLE_ELEMENT_NAME,
      ],
      // A member a repeated property name shadowed.
      [
        `{"resourceType":"Observation","status":"final","status":"amended",${wrapped}}`,
        SERIALIZE_ERROR_CODES.UNSERIALIZABLE_SHADOWED_PROPERTY,
      ],
      // A `resourceType` with no string to name a tag with.
      [
        `{"resourceType":"Observation","contained":[{"resourceType":42,${wrapped}}]}`,
        SERIALIZE_ERROR_CODES.UNSERIALIZABLE_RESOURCE_TYPE,
      ],
    ];

    for (const [json, code] of cases) {
      expect(fromJson(json).refused?.code, json).toBe(code);
    }
  });

  it("AC-10: and the control, so the rows above are not passing on a shape that never reaches it", () => {
    // Each document minus the OTHER refusal reports the new code, which is what makes the ordering
    // above an ordering rather than five documents this refusal cannot see.
    for (const json of [
      `{"resourceType":"Observation","status":"final","valueQuantity":[{"value":5,"code":"mg"}]}`,
      `{"resourceType":"Observation","contained":[{"resourceType":"Observation",` +
        '"valueQuantity":[{"value":5,"code":"mg"}]}]}',
    ]) {
      expect(fromJson(json).refused?.code, json).toBe(
        SERIALIZE_ERROR_CODES.UNSERIALIZABLE_CHOICE_WRAPPER,
      );
    }
  });

  it("AC-9: the refusal is value-free, carrying a code and bounded locations only", () => {
    const { refused } = fromJson(
      `{"resourceType":"Observation","status":"final",${CODE},` +
        '"valueQuantity":[{"value":5,"unit":"SECRET-UNIT","code":"SECRET-CODE"}]}',
    );
    const serialized = JSON.stringify({
      message: refused?.message,
      locations: refused?.locations,
      code: refused?.code,
    });
    expect(serialized).not.toContain("SECRET");
    expect(serialized).not.toContain("5");
  });

  it("AC-6: refuses nothing for a conformant document, wrapped or unwrapped elsewhere", () => {
    // The false-positive control for the write path. A conformant `value[x]`, a conformant repeating
    // element, and a backbone element whose cardinality this library does not know.
    for (const json of [
      `{"resourceType":"Observation","status":"final",${CODE},"valueQuantity":{"value":5,"code":"mg"}}`,
      `{"resourceType":"Observation","status":"final",${CODE},"identifier":[{"value":"synthetic-1"}]}`,
      `{"resourceType":"Observation","status":"final",${CODE},"component":[{"code":["x"]}]}`,
      '{"resourceType":"Questionnaire","status":"active","code":[{"code":"synthetic-1"}]}',
    ]) {
      expect(fromJson(json).refused, json).toBeUndefined();
    }
  });
});
