import { describe, expect, it } from "vitest";

import {
  assertSafeToSummarize,
  FhirSafetyError,
  parseResource,
  parseResourceXml,
  readSafety,
  serializeResourceXml,
  SAFETY_RESOURCE_TYPES,
} from "../src/index.js";

const FHIR_NS = 'xmlns="http://hl7.org/fhir"';

/** The readout of a JSON document, written out so each assertion below reads the literal it pins. */
function safetyOf(json: string): ReturnType<typeof readSafety> {
  return readSafety(parseResource(json).resource);
}

/** Whether `assertSafeToSummarize` refused, so the refusal can be asserted as a value. */
function refuses(json: string): boolean {
  try {
    assertSafeToSummarize(parseResource(json).resource);
    return false;
  } catch (err) {
    return err instanceof FhirSafetyError;
  }
}

/**
 * The `doNotPerform` negation was **blind by scope**, on plain conformant documents.
 *
 * Two `?!` modifier elements were simply not looked for. At the base commit `f0289a2`:
 *
 * ```
 * {"resourceType":"MedicationRequest",   ...,"doNotPerform":true}  ->  negations: ["do-not-perform"]
 * {"resourceType":"ServiceRequest",      ...,"doNotPerform":true}  ->  negations: []  safeToSummarize: true
 * {"resourceType":"CommunicationRequest",...,"doNotPerform":true}  ->  negations: []  safeToSummarize: true
 * ```
 *
 * This is sharper than the two boolean defects before it because of what it does **not** require.
 * The first needed an XML round trip; the second needed a value outside the datatype's lexical
 * space. This needs neither: it is plain conformant JSON, `doNotPerform` is flagged `?!` on each
 * request resource that defines it (`medicationrequest.html`, `servicerequest.html`,
 * `communicationrequest.html`), and a modifier element is the one class a consumer may never process
 * as if it were absent. The read was gated on `MedicationRequest`, and a type gate does not merely
 * fail to read the types it omits: it never looks, so nothing is reported either, and the readout
 * affirms the record is safe to summarise.
 *
 * **The second axis is the same blindness through depth.** The read visited only the resource
 * `readSafety` was handed, so a conformant `MedicationRequest` inside a `Bundle.entry` affirmed
 * `safeToSummarize` while its *unreadable* twin at the same location was already reported: the
 * library was strictly more honest about a value it could not read than about one it could.
 *
 * **Both are read scope, and the remedy is at the read, not a new refusal.** The type gate is
 * dropped rather than widened (a longer list of remembered types is the same mechanism), and the
 * read runs at every resource root, which is the window that already reports the unreadable half. A
 * value that *is* read needs no refusal: it is surfaced on `negations`, and `safeToSummarize` stays
 * `true` because nothing was lost.
 */
describe("the doNotPerform negation is read wherever it is written", () => {
  describe("axis 1: no resource-type gate", () => {
    for (const resourceType of ["ServiceRequest", "CommunicationRequest", "MedicationRequest"]) {
      it(`surfaces the negation on a conformant ${resourceType}`, () => {
        const safety = safetyOf(`{"resourceType":"${resourceType}","doNotPerform":true}`);

        expect(safety.negations).toEqual(["do-not-perform"]);
        expect(safety.doNotPerform).toBe(true);
        // Read, so nothing is withheld: the refusal channel is for values that cannot be read.
        expect(safety.safeToSummarize).toBe(true);
        expect(safety.unreadableBooleans).toEqual([]);
      });

      it(`reports the unreadable twin on the same ${resourceType}`, () => {
        // The read window and the report window are one window, decided in one function. If they
        // could drift, widening the read would leave `<doNotPerform value="1"/>` on the new types
        // exactly as invisible as `value="true"` was before this slice.
        const safety = safetyOf(`{"resourceType":"${resourceType}","doNotPerform":"1"}`);

        expect(safety.negations).toEqual([]);
        expect(safety.doNotPerform).toBeUndefined();
        expect(safety.unreadableBooleans).toEqual([`${resourceType}.doNotPerform`]);
        expect(safety.safeToSummarize).toBe(false);
        expect(refuses(`{"resourceType":"${resourceType}","doNotPerform":"1"}`)).toBe(true);
      });
    }

    it("reads the lexical spelling the schema-free XML reader keeps as text", () => {
      const { resource } = parseResourceXml(
        `<ServiceRequest ${FHIR_NS}><status value="active"/><intent value="order"/>` +
          `<doNotPerform value="true"/><subject><reference value="Patient/1"/></subject>` +
          `</ServiceRequest>`,
      );

      expect(readSafety(resource).negations).toEqual(["do-not-perform"]);
      expect(readSafety(resource).doNotPerform).toBe(true);
    });

    it("keeps the negation across this package's own XML round trip", () => {
      const source = '{"resourceType":"ServiceRequest","status":"active","doNotPerform":true}';
      const { resource } = parseResource(source);
      const reread = parseResourceXml(serializeResourceXml(resource)).resource;

      expect(readSafety(reread).negations).toEqual(["do-not-perform"]);
    });

    it("does not need the type to be one the type-scoped reads know", () => {
      // The point of the fix, stated as a property of the sets rather than of one document: the
      // types that carry `doNotPerform` are not the types this library scopes its other reads to,
      // so any rule that consulted `SAFETY_RESOURCE_TYPES` here was blind by construction.
      expect(SAFETY_RESOURCE_TYPES.has("ServiceRequest")).toBe(false);
      expect(SAFETY_RESOURCE_TYPES.has("CommunicationRequest")).toBe(false);
      expect(safetyOf('{"resourceType":"ServiceRequest","doNotPerform":true}').negations).toEqual([
        "do-not-perform",
      ]);
    });
  });

  describe("axis 2: every resource root, not only the one handed in", () => {
    const bundleWith = (resource: string): string =>
      `{"resourceType":"Bundle","type":"collection","entry":[{"resource":${resource}}]}`;

    for (const resourceType of ["MedicationRequest", "ServiceRequest"]) {
      it(`surfaces a ${resourceType} negation from inside a Bundle entry`, () => {
        const safety = safetyOf(
          bundleWith(`{"resourceType":"${resourceType}","status":"active","doNotPerform":true}`),
        );

        expect(safety.negations).toEqual(["do-not-perform"]);
        // The convenience field stays the root read, exactly as `status` beside it does. The Bundle
        // wrote no `doNotPerform` of its own, and `negations` is the authoritative read.
        expect(safety.doNotPerform).toBeUndefined();
        expect(safety.safeToSummarize).toBe(true);
      });
    }

    it("surfaces a negation from a contained resource", () => {
      const safety = safetyOf(
        '{"resourceType":"Patient","contained":[{"resourceType":"MedicationRequest",' +
          '"status":"active","doNotPerform":true}]}',
      );

      expect(safety.negations).toEqual(["do-not-perform"]);
      expect(safety.doNotPerform).toBeUndefined();
    });

    it("reports the unreadable twin at the same nested location", () => {
      // The asymmetry this axis existed to close, pinned from both sides at one location: the
      // unreadable value is reported there, and the readable one is now read there.
      const unreadable = safetyOf(
        bundleWith('{"resourceType":"MedicationRequest","doNotPerform":"1"}'),
      );

      expect(unreadable.unreadableBooleans).toEqual(["Bundle.entry[0].resource.doNotPerform"]);
      expect(unreadable.negations).toEqual([]);
      expect(unreadable.safeToSummarize).toBe(false);
      expect(
        safetyOf(bundleWith('{"resourceType":"MedicationRequest","doNotPerform":true}')).negations,
      ).toEqual(["do-not-perform"]);
    });

    it("names the negation once however many resources assert it", () => {
      const safety = safetyOf(
        '{"resourceType":"Bundle","type":"collection","entry":[' +
          '{"resource":{"resourceType":"MedicationRequest","doNotPerform":true}},' +
          '{"resource":{"resourceType":"ServiceRequest","doNotPerform":true}}]}',
      );

      expect(safety.negations).toEqual(["do-not-perform"]);
    });

    it("keeps the classified negations in their established order", () => {
      const safety = safetyOf(
        '{"resourceType":"MedicationRequest","status":"entered-in-error","doNotPerform":true}',
      );

      expect(safety.negations).toEqual(["entered-in-error", "do-not-perform"]);
    });
  });

  /**
   * What this slice deliberately leaves exactly as it found it. Each is asserted against the literal
   * it produces, so a later change that moves one has to say so.
   */
  describe("pinned in both states: what this slice does not move", () => {
    it("adds no negation for a written false", () => {
      for (const resourceType of ["MedicationRequest", "ServiceRequest"]) {
        const safety = safetyOf(`{"resourceType":"${resourceType}","doNotPerform":false}`);

        expect(safety.negations).toEqual([]);
        expect(safety.doNotPerform).toBe(false);
      }
    });

    it("adds no negation when the element is absent", () => {
      const safety = safetyOf('{"resourceType":"ServiceRequest","status":"active"}');

      expect(safety.negations).toEqual([]);
      expect(safety.doNotPerform).toBeUndefined();
      expect(safety.safeToSummarize).toBe(true);
    });

    it("leaves noKnownAllergy type-gated, which is the opposite direction", () => {
      // The one negation that is a *positive* clinical assertion. Un-gating a read that can only add
      // a negation is safe; un-gating this one would claim a patient has no known allergy over a
      // Condition that merely carries the code. It stays gated on purpose.
      const condition = safetyOf(
        '{"resourceType":"Condition","code":{"coding":[' +
          '{"system":"http://snomed.info/sct","code":"716186003"}]}}',
      );

      expect(condition.negations).toEqual([]);
      expect(condition.noKnownAllergy).toBe(false);
      expect(
        safetyOf(
          '{"resourceType":"AllergyIntolerance","code":{"coding":[' +
            '{"system":"http://snomed.info/sct","code":"716186003"}]}}',
        ).negations,
      ).toEqual(["no-known-allergy"]);
    });

    it("leaves the status-code negations on their own type gates", () => {
      // `not-done` is also a `Procedure` / `MedicationAdministration` status in R4, so the same
      // blindness exists there. It is a declared gap and its own slice, not this one: each type gate
      // needs its own grounding of which types carry that status code, and this slice's argument is
      // about one element name.
      expect(safetyOf('{"resourceType":"Immunization","status":"not-done"}').negations).toEqual([
        "not-done",
      ]);
      expect(safetyOf('{"resourceType":"Procedure","status":"not-done"}').negations).toEqual([]);
      expect(
        safetyOf('{"resourceType":"MedicationStatement","status":"not-taken"}').negations,
      ).toEqual(["not-taken"]);
    });

    it("leaves the other negations root-only", () => {
      // Only `doNotPerform` was folded in. A retraction inside a Bundle entry is still not surfaced
      // at the Bundle, and that is a declared gap rather than a claim.
      const safety = safetyOf(
        '{"resourceType":"Bundle","type":"collection","entry":[{"resource":' +
          '{"resourceType":"Observation","status":"entered-in-error"}}]}',
      );

      expect(safety.negations).toEqual([]);
      expect(safety.retracted).toBe(false);
    });

    it("stops the scope at resource roots, not backbone elements", () => {
      // R4 defines no `doNotPerform` on `Dosage`; a resource root is where this library knows what
      // an element name means, and it is the same boundary the array-wrapper report draws.
      const safety = safetyOf(
        '{"resourceType":"MedicationRequest","dosageInstruction":[{"doNotPerform":true}]}',
      );

      expect(safety.negations).toEqual([]);
    });

    it("leaves the array-wrapper report on its cardinality table", () => {
      // Declared residual, in the safe direction: on a type outside `SAFETY_RESOURCE_TYPES` the
      // wrapper is read through and the negation surfaced, but the wrapper itself is not reported.
      // Reporting one is an `error`, so it stays where a cardinality is known.
      const serviceRequest = safetyOf('{"resourceType":"ServiceRequest","doNotPerform":[true]}');

      expect(serviceRequest.negations).toEqual(["do-not-perform"]);
      expect(serviceRequest.arrayWrappedScalars).toEqual([]);

      const medicationRequest = safetyOf(
        '{"resourceType":"MedicationRequest","doNotPerform":[true]}',
      );

      expect(medicationRequest.negations).toEqual(["do-not-perform"]);
      expect(medicationRequest.arrayWrappedScalars).toEqual(["MedicationRequest.doNotPerform"]);
    });

    it("reads across a repeated property name on the new types too", () => {
      const safety = safetyOf(
        '{"resourceType":"ServiceRequest","doNotPerform":false,"doNotPerform":true}',
      );

      expect(safety.negations).toEqual(["do-not-perform"]);
      expect(safety.doNotPerform).toBe(true);
      expect(safety.shadowedProperties).toEqual(["ServiceRequest.doNotPerform"]);
    });
  });
});
