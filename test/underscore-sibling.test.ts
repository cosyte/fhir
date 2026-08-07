import { describe, expect, it } from "vitest";

import {
  ISSUE_CODES,
  getProperty,
  isList,
  parseResource,
  parseResourceXml,
  readSafety,
  serializeResource,
  serializeResourceXml,
  validateResource,
} from "../src/index.js";

/**
 * A `_`-sibling whose value is not an object: reported, and handed back rather than deleted.
 *
 * FHIR JSON gives that channel an `Element` object and nothing else. json.html §2.6.2.3 puts "the
 * `id` and/or `extension`" there, and §2.6.2 gives an element an object, so a string, a number, a
 * boolean or a `null` that pads nothing carries no metadata a reader can model.
 *
 * Read silently and then omitted on emit, that shape did the same thing the value channel's `null`
 * did before it was closed: it **laundered**. `{"_status":null}` and `{"_status":"x"}` both came
 * back as `{}`, a conformant document with the member gone, with no diagnostic anywhere to say so.
 * Every layer then affirmed it: `issues: []`, `valid: true`, `safeToSummarize: true`.
 *
 * Both halves are load-bearing and are asserted together throughout. The report alone does not close
 * it, because a document with the member deleted re-reads clean; the hand-back alone does not close
 * it, because a caller reading `issues` still sees nothing. So every case here asserts the read
 * codes, the emitted text, **and** the codes the emitted text reads back with.
 *
 * **The code is the neighbouring `UNKNOWN_PROPERTY`, and nothing moved onto or off any code.** This
 * is the same observation the reader already makes where a scalar or `null` sits at a **complex**
 * position: something FHIR JSON has an object for arrived as a scalar, nothing is modeled, the text
 * is preserved, and the writer hands it back. A consumer acts on it identically. These positions
 * drew *nothing* before, so no predicate written against the old codes changes meaning.
 *
 * Every value here is synthetic.
 */

/** Parse, re-emit, and re-read: the round trip a laundering defect hides inside. */
function roundTrip(input: string): { out: string; codes: string[]; reReadCodes: string[] } {
  const first = parseResource(input);
  const out = serializeResource(first.resource);
  return {
    out,
    codes: first.issues.map((issue) => issue.code),
    reReadCodes: parseResource(out).issues.map((issue) => issue.code),
  };
}

/** The whole claim for one shape: reported, handed back byte for byte, and reported again. */
function expectClosed(input: string, expression: string): void {
  const first = parseResource(input);
  expect(first.issues).toContainEqual({
    code: ISSUE_CODES.UNKNOWN_PROPERTY,
    severity: "warning",
    expression,
  });
  const out = serializeResource(first.resource);
  expect(out).toBe(input);
  expect(parseResource(out).issues).toEqual(first.issues);
}

describe("a `_`-sibling that is not an object is reported and handed back", () => {
  describe("at a singleton slot, where §2.6.2.3 defines no `null` at all", () => {
    it("reports and hands back a `null` sibling with no value beside it", () => {
      expectClosed('{"resourceType":"Observation","_status":null}', "Observation.status");
    });

    it("reports and hands back a `null` sibling beside a value", () => {
      expectClosed(
        '{"resourceType":"Observation","status":"final","_status":null}',
        "Observation.status",
      );
    });

    it("reports and hands back a string, a number and a boolean sibling", () => {
      expectClosed('{"resourceType":"Observation","_status":"x"}', "Observation.status");
      expectClosed('{"resourceType":"Observation","_status":1}', "Observation.status");
      expectClosed('{"resourceType":"Observation","_status":true}', "Observation.status");
    });

    it("reaches a clinically load-bearing position three levels down", () => {
      // The dose magnitude's own metadata channel. Nothing here is lost in the ordinary sense, which
      // is exactly why it was invisible: the document came back clean with the sibling gone.
      expectClosed(
        '{"resourceType":"MedicationRequest","dosageInstruction":[{"doseAndRate":' +
          '[{"doseQuantity":{"value":5,"_value":"junk","unit":"mg"}}]}]}',
        "MedicationRequest.dosageInstruction[0].doseAndRate[0].doseQuantity.value",
      );
    });

    it("reaches an AllergyIntolerance clinical-status code's own metadata channel", () => {
      expectClosed(
        '{"resourceType":"AllergyIntolerance","clinicalStatus":{"coding":' +
          '[{"system":"http://example.invalid/status","code":"active","_code":null}]}}',
        "AllergyIntolerance.clinicalStatus.coding[0].code",
      );
    });

    it("reaches the hoisted `resourceType`, which the writer skipped past `hasMeta` entirely", () => {
      // The writer hoists a string `resourceType` to the front and then `continue`d past the
      // property, so a remedy in `hasMeta` alone never reached this branch and the sibling was
      // deleted anyway. That is the shape of the failure a remedy on the read side always risks:
      // the reported symptom closes and the class does not.
      expectClosed(
        '{"resourceType":"Observation","_resourceType":"x"}',
        "Observation.resourceType",
      );
    });

    it("stops deleting a hoisted `_resourceType` that carried real metadata", () => {
      // Pre-existing at the same branch and closed by the same three lines: this one is not even
      // the non-object case, it is modeled `id` metadata that the hoist dropped with no diagnostic.
      const input = '{"resourceType":"Observation","_resourceType":{"id":"q"}}';
      const first = parseResource(input);
      expect(first.issues).toEqual([]);
      expect(serializeResource(first.resource)).toBe(input);
    });
  });

  describe("at a slot of a repeating primitive's `_`-array", () => {
    it("reports and hands back a scalar item with no value array", () => {
      expectClosed('{"resourceType":"Patient","_given":["x"]}', "Patient.given[0]");
    });

    it("reports and hands back a scalar item beside a value array", () => {
      expectClosed(
        '{"resourceType":"Patient","name":[{"given":["a"],"_given":["x"]}]}',
        "Patient.name[0].given[0]",
      );
      expectClosed(
        '{"resourceType":"Patient","name":[{"given":["a"],"_given":[7]}]}',
        "Patient.name[0].given[0]",
      );
    });

    it("stops replacing a junk item with padding beside a real sibling object", () => {
      // The sharpest of the array shapes: the writer emitted `[{"id":"q"},null]`, so what came back
      // was not merely missing the item, it was a well-formed padding `null` the sender never wrote.
      expectClosed(
        '{"resourceType":"Patient","name":[{"given":["a","b"],"_given":[{"id":"q"},"junk"]}]}',
        "Patient.name[0].given[1]",
      );
    });

    it("reports both channels at one slot when both are non-conformant", () => {
      // A `null` value that pads nothing and a junk sibling beside it are two findings, and each
      // survives the round trip on its own marker.
      const input = '{"resourceType":"Patient","name":[{"given":[null],"_given":["x"]}]}';
      const { out, codes, reReadCodes } = roundTrip(input);
      expect(codes).toEqual([ISSUE_CODES.UNDEFINED_JSON_NULL, ISSUE_CODES.UNKNOWN_PROPERTY]);
      expect(out).toBe(input);
      expect(reReadCodes).toEqual(codes);
    });

    it("keeps the array-inside-an-array case on its own code and text", () => {
      // An array in the `_`-channel is `NESTED_ARRAY` with its own preserved text, and is deliberately
      // excluded from this rule. Both slots of this document round-trip, on two different mechanisms.
      const input = '{"resourceType":"Patient","given":["a","b"],"_given":[["z"],"junk"]}';
      const { out, codes, reReadCodes } = roundTrip(input);
      expect(codes).toEqual([ISSUE_CODES.NESTED_ARRAY, ISSUE_CODES.UNKNOWN_PROPERTY]);
      expect(out).toBe(input);
      expect(reReadCodes).toEqual(codes);
    });
  });

  describe("the §2.6.2.3 padding exemption, which this must not false-error on", () => {
    it("says nothing about a `null` padding a `_`-array", () => {
      // §2.6.2.3 fills out BOTH arrays so the two stay index-aligned, so a slot whose value needs no
      // metadata is spelled `null` there. A conformant document must draw nothing and change nothing.
      const input =
        '{"resourceType":"Patient","name":[{"given":["a","b"],"_given":[null,{"id":"q"}]}]}';
      const { out, codes, reReadCodes } = roundTrip(input);
      expect(codes).toEqual([]);
      expect(out).toBe(input);
      expect(reReadCodes).toEqual([]);
    });

    it("still reports a `null` sibling at a SINGLETON slot, which is never padding", () => {
      // The exemption is scoped to the two arrays. §2.6.2.3 renders a value-absent singleton as the
      // `_` property alone, so a `null` there aligns nothing however the value channel is filled in.
      // This is condition (a) of the same rule the value channel applies, one channel over.
      expectClosed('{"resourceType":"Observation","_status":null}', "Observation.status");
    });

    it("leaves a mixed `_`-array's padding alone while reporting the junk beside it", () => {
      const input = '{"resourceType":"Patient","_given":["x",null]}';
      const { out, codes, reReadCodes } = roundTrip(input);
      expect(codes).toEqual([ISSUE_CODES.UNKNOWN_PROPERTY]);
      expect(out).toBe(input);
      expect(reReadCodes).toEqual(codes);
    });

    it("leaves a conformant value-absent singleton and a primitive extension untouched", () => {
      for (const input of [
        '{"resourceType":"Observation","_status":{"id":"q1"}}',
        '{"resourceType":"Observation","status":"final","_status":{"extension":' +
          '[{"url":"http://example.invalid/ext","valueString":"v"}]}}',
        '{"resourceType":"Observation","status":"final","code":{"text":"t"},' +
          '"valueQuantity":{"value":0.010,"unit":"mg"}}',
      ]) {
        const { out, codes, reReadCodes } = roundTrip(input);
        expect(codes.filter((code) => code === ISSUE_CODES.UNKNOWN_PROPERTY)).toEqual([]);
        expect(out).toBe(input);
        expect(reReadCodes).toEqual(codes);
      }
    });
  });

  describe("the read-side exemption and the write-side test cannot drift apart", () => {
    it("never exempts a slot on the read that the writer then declines to emit", () => {
      // The mechanism that produced a fix which did not fix: the read treats a slot as §2.6.2.3
      // padding while `hasMeta` declines to emit its `_`-sibling, so the member is deleted anyway
      // and the read's silence is confirmed by an output that re-reads clean. The mark added for
      // this rule is a new DISJUNCT in `hasMeta`, so it can only ever make the writer emit more.
      // Asserted over both halves of the exemption at once: an `id`, and an EMPTY `extension`, which
      // is the half the earlier draft got wrong.
      for (const input of [
        '{"resourceType":"Patient","name":[{"given":[null],"_given":[{"id":"q1"}]}]}',
        '{"resourceType":"Patient","name":[{"given":[null,"b"],"_given":[{"extension":[]},null]}]}',
        '{"resourceType":"Observation","valueQuantity":{"value":null,"_value":{"id":"q1"},"unit":"mg"}}',
      ]) {
        const { out, codes, reReadCodes } = roundTrip(input);
        // Whatever the read decided, the re-read has to decide the same thing. That equality is the
        // property; the individual verdicts are pinned by `undefined-json-null.test.ts`.
        expect(reReadCodes).toEqual(codes);
        expect(parseResource(out).issues).toEqual(parseResource(input).issues);
      }
    });
  });

  describe("what this deliberately does not do, pinned so it cannot move in silence", () => {
    it("does not model the preserved text, so no walker sees a new element", () => {
      const { resource } = parseResource(
        '{"resourceType":"Observation","status":"final","_status":"x"}',
      );
      const status = getProperty(resource, "status");
      expect(status?.kind).toBe("primitive");
      expect(status !== undefined && isList(status)).toBe(false);
      // The node is the primitive it always was: the text hangs off it, it is not a property of it.
      expect(resource.properties.map((property) => property.name)).toEqual([
        "resourceType",
        "status",
      ]);
    });

    it("does not move `valid` or `safeToSummarize`", () => {
      // Characterization, not endorsement. Nothing was unreadable at that position in the sense
      // `NESTED_ARRAY` and `DROPPED_ELEMENT_TEXT` mean it: a scalar in the metadata channel carries
      // no clinical content, and the element itself is read exactly as before. If a later slice
      // decides the safety layer should decline here, this is the test that has to move.
      const { resource } = parseResource(
        '{"resourceType":"AllergyIntolerance","clinicalStatus":{"coding":' +
          '[{"system":"http://example.invalid/status","code":"active","_code":null}]}}',
      );
      expect(readSafety(resource).safeToSummarize).toBe(true);
      expect(validateResource(resource).valid).toBe(true);
    });

    it("does not reach a `_`-sibling beside a NON-primitive, which has its own code", () => {
      // `MISPLACED_PRIMITIVE_EXTENSION`, whose contract is that content was unreadable there. It is
      // reported on the read and is still lost across a round trip: a declared open residual, not
      // something this rule closes.
      const { out, codes, reReadCodes } = roundTrip(
        '{"resourceType":"Observation","code":{"text":"t"},"_code":null}',
      );
      expect(codes).toEqual([ISSUE_CODES.MISPLACED_PRIMITIVE_EXTENSION]);
      expect(out).toBe('{"resourceType":"Observation","code":{"text":"t"}}');
      expect(reReadCodes).toEqual([]);
    });

    it("does not reach an EMPTY `_`-sibling object or array, which is a different clause", () => {
      // json.html §2.6.2.1's "JSON objects and arrays are never empty" rather than §2.6.2.3's
      // element-is-an-object. The sibling IS an object here, it just holds nothing, so this rule's
      // predicate does not match it. Still deleted with no diagnostic: declared, not closed.
      for (const input of [
        '{"resourceType":"Observation","status":"final","_status":{}}',
        '{"resourceType":"Observation","status":"final","_status":{"extension":[]}}',
        '{"resourceType":"Patient","_given":[]}',
      ]) {
        const { codes, reReadCodes } = roundTrip(input);
        expect(codes).toEqual([]);
        expect(reReadCodes).toEqual([]);
      }
    });

    it("does not make a `_`-sibling object's unreadable MEMBER survive a round trip", () => {
      // Adjacent and measured, and a different mechanism: the sibling here IS an object, the reader
      // DOES report, and what is lost is that the report does not survive emit. Closing it means
      // preserving text in front of metadata the model already holds (the third case below carries
      // a real `id`), which is a change to how the writer treats a modeled channel rather than the
      // hand-back this rule performs where the model holds nothing. Declared, not closed.
      for (const input of [
        '{"resourceType":"Observation","status":"final","_status":{"foo":1}}',
        '{"resourceType":"Observation","_status":{"foo":1}}',
        '{"resourceType":"Observation","status":"final","_status":{"id":"q","foo":1}}',
      ]) {
        const { codes, reReadCodes } = roundTrip(input);
        expect(codes).toEqual([ISSUE_CODES.UNKNOWN_PROPERTY]);
        expect(reReadCodes).toEqual([]);
      }
    });

    it("never marks a document read from XML, and does not close the `JSON -> XML -> JSON` trip", () => {
      // XML has no `null` and no `_`-sibling: a primitive's metadata is co-located as an `id`
      // attribute and child `<extension>` elements, so there is no channel for this text to travel
      // in. The XML writer therefore drops it, and that trip still launders. Declared residual.
      const xml = '<Observation xmlns="http://hl7.org/fhir"><status value="final"/></Observation>';
      const fromXml = parseResourceXml(xml);
      expect(fromXml.issues).toEqual([]);
      expect(serializeResource(fromXml.resource)).toBe(
        '{"resourceType":"Observation","status":"final"}',
      );

      const { resource } = parseResource(
        '{"resourceType":"Observation","status":"final","_status":"x"}',
      );
      expect(serializeResourceXml(resource)).toBe(xml);
      expect(serializeResource(parseResourceXml(serializeResourceXml(resource)).resource)).toBe(
        '{"resourceType":"Observation","status":"final"}',
      );
    });
  });
});
