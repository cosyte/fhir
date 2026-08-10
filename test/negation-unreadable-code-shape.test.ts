import { describe, expect, it } from "vitest";

import {
  assertSafeToSummarize,
  FhirSafetyError,
  parseResource,
  parseResourceXml,
  readSafety,
  unreadableNegationCodes,
  validateResource,
} from "../src/index.js";
import { hasUnreadableCode, NEGATION_CODE_READS } from "../src/safety/codes.js";

const FHIR_NS = 'xmlns="http://hl7.org/fhir"';

/** The readout of a JSON document, written out so each assertion below pins the literal it names. */
function safetyOf(json: string): ReturnType<typeof readSafety> {
  return readSafety(parseResource(json).resource);
}

/** The readout of an XML document. */
function safetyOfXml(xml: string): ReturnType<typeof readSafety> {
  return readSafety(parseResourceXml(xml).resource);
}

/**
 * The channel this slice adds, read through **one accessor**, so the whole file can be run against
 * the base commit by substituting this function alone: there it returns `[]`, the reading a caller
 * had before the channel existed. Every assertion below therefore measures a **behaviour**, not the
 * presence of a symbol. (`#84` measured 31/35 in the flattering direction by asserting through a
 * field its base commit lacked; this is the correction it published.)
 */
function disclosed(safety: ReturnType<typeof readSafety>): readonly string[] {
  return safety.unreadableNegationCodes;
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

/** A collection `Bundle` carrying one entry resource. */
const bundleWith = (resource: string): string =>
  `{"resourceType":"Bundle","type":"collection","entry":[{"resource":${resource}}]}`;

/** A `Patient` carrying one `contained` resource. */
const containing = (resource: string): string =>
  `{"resourceType":"Patient","contained":[${resource}]}`;

/**
 * **A `status` written as a JSON object read `negations: []` under `safeToSummarize: true`.**
 *
 * At the base commit `632f914`, every one of these returned an empty negation list with **no
 * location anywhere** saying the element had been looked at and nothing taken from it:
 *
 * ```
 * {"resourceType":"Procedure","status":{"value":"not-done"}}          -> negations: []  safe: true
 * {"resourceType":"Observation","status":{"value":"entered-in-error"}} -> negations: []  safe: true
 * {"resourceType":"Procedure","status":[{"value":"not-done"}]}        -> negations: []  safe: true
 * {"resourceType":"Procedure","status":3}                             -> negations: []  safe: true
 * ```
 *
 * **This is a SHAPE, and that is why no existing channel caught it.** Every value-shaped question in
 * this layer asks about a *written value*: `hasUnreadableBoolean` asks whether a value the read saw
 * fell outside the datatype's lexical space, and the near-miss disclosure asks whether a value spells
 * a code bar its case or its whitespace. **An object holds no value at all**, so both answer "no"
 * about it, truthfully, and the element ends up reading exactly like one the sender left out. That is
 * the same silence `#80` and `#84` closed, arriving through a door neither of them faced.
 *
 * **Nothing here is read through.** `{"value":"not-done"}` is FHIR *XML*'s spelling of a primitive
 * (xml.html §2.6.1); FHIR JSON spells a `code` as a JSON string (json.html §2.6.0). Descending into
 * the object to recover the code would resolve a negation out of an encoding no version of FHIR
 * defines for JSON, which is the laundering this package refuses everywhere else. **The remedy is a
 * disclosure**: a location on `unreadableNegationCodes`, `safeToSummarize` false, and
 * `assertSafeToSummarize` refusing.
 *
 * **The read and its refusal are one function at one window.** Both come out of the same loop over
 * `NEGATION_CODE_READS`, so the disclosure cannot cover an element the classification does not, nor
 * miss one it does. That is pinned mechanically below rather than described.
 *
 * **Corpus caveat:** every document here is hand-authored, synthetic, and carries no patient content.
 * These are fixtures, mutations and probes, **not** the R4 published-examples corpus.
 */
describe("content where a code belongs is disclosed, not read through", () => {
  describe("axis: the shape the item named, on `status`", () => {
    it("discloses an object at status instead of reading nothing", () => {
      const safety = safetyOf('{"resourceType":"Procedure","status":{"value":"not-done"}}');

      // Still not a negation, and that is the correct reading: nothing in FHIR JSON says this
      // object is a code, so reading one out of it would author it.
      expect(safety.negations).toEqual([]);
      // But no longer silent. This is the whole of the change.
      expect(disclosed(safety)).toEqual(["Procedure.status"]);
      expect(safety.safeToSummarize).toBe(false);
      // The convenience field is a single-value string read, so it shows nothing either. Before this
      // slice that `undefined` was indistinguishable from an absent element.
      expect(safety.status).toBeUndefined();
    });

    it("discloses an object at status carrying a retraction", () => {
      const safety = safetyOf(
        '{"resourceType":"Observation","status":{"value":"entered-in-error"}}',
      );

      expect(safety.negations).toEqual([]);
      expect(safety.retracted).toBe(false);
      expect(disclosed(safety)).toEqual(["Observation.status"]);
      expect(safety.safeToSummarize).toBe(false);
    });

    it("discloses an empty object at status, where no code is recoverable at all", () => {
      // The content is unreadable whether or not a code is hiding in it. The channel reports the
      // POSITION, so it does not depend on guessing what the object holds.
      const safety = safetyOf('{"resourceType":"Procedure","status":{}}');

      expect(disclosed(safety)).toEqual(["Procedure.status"]);
      expect(safety.safeToSummarize).toBe(false);
    });

    it("discloses a code buried deeper than any code read looks", () => {
      const safety = safetyOf(
        '{"resourceType":"Procedure","status":{"coding":{"code":"not-done"}}}',
      );

      expect(safety.negations).toEqual([]);
      expect(disclosed(safety)).toEqual(["Procedure.status"]);
      expect(safety.safeToSummarize).toBe(false);
    });

    it("discloses a written value that is not a string", () => {
      // The other half of the same predicate: a position the string read reached and could take
      // nothing from. A numerically-enumerated status is ordinary output from a legacy feed.
      const safety = safetyOf('{"resourceType":"Procedure","status":3}');

      expect(safety.negations).toEqual([]);
      expect(disclosed(safety)).toEqual(["Procedure.status"]);
      expect(safety.safeToSummarize).toBe(false);
    });

    it("discloses a boolean written where a code belongs", () => {
      const safety = safetyOf('{"resourceType":"MedicationStatement","status":false}');

      expect(disclosed(safety)).toEqual(["MedicationStatement.status"]);
      expect(safety.safeToSummarize).toBe(false);
    });

    it("refuses to summarize, carrying the location and no content", () => {
      const json = '{"resourceType":"Procedure","status":{"value":"not-done"}}';
      expect(refuses(json)).toBe(true);

      try {
        assertSafeToSummarize(parseResource(json).resource);
        expect.unreachable("expected a refusal");
      } catch (err) {
        expect(err).toBeInstanceOf(FhirSafetyError);
        const locations = (err as FhirSafetyError).locations;
        expect(locations).toEqual(["Procedure.status"]);
        // Value-free by contract: neither the content at the position nor anything read out of it
        // reaches the message or the locations.
        expect((err as FhirSafetyError).message).not.toContain("not-done");
        expect(locations.join("|")).not.toContain("not-done");
      }
    });
  });

  describe("axis: the window is every resource root, which is the negation read's own", () => {
    const buried = '{"resourceType":"Procedure","status":{"value":"not-done"}}';

    it("reaches a Bundle entry", () => {
      const safety = safetyOf(bundleWith(buried));

      expect(disclosed(safety)).toEqual(["Bundle.entry[0].resource.status"]);
      expect(safety.safeToSummarize).toBe(false);
    });

    it("reaches a contained resource", () => {
      const safety = safetyOf(containing(buried));

      expect(disclosed(safety)).toEqual(["Patient.contained[0].status"]);
      expect(safety.safeToSummarize).toBe(false);
    });

    it("reports the root and a nested root separately", () => {
      const safety = safetyOf(
        '{"resourceType":"Procedure","status":{"value":"not-done"},"contained":' + `[${buried}]}`,
      );

      expect(disclosed(safety)).toEqual(["Procedure.status", "Procedure.contained[0].status"]);
    });

    it("agrees with the exported collector, which is the same walk", () => {
      const { resource } = parseResource(bundleWith(buried));

      expect(unreadableNegationCodes(resource, "Bundle")).toEqual(disclosed(readSafety(resource)));
    });

    it("reads no deeper than a resource root", () => {
      // A DECLARED LIMIT, pinned so it cannot move in silence. R4 defines no `status` under
      // `Procedure.performer`, so no conformant document sits here; the window is inherited from
      // the array-wrapper walk rather than derived, exactly as the negation read's is.
      const safety = safetyOf(
        '{"resourceType":"Procedure","performer":[{"status":{"value":"not-done"}}]}',
      );

      expect(disclosed(safety)).toEqual([]);
      expect(safety.safeToSummarize).toBe(true);
    });
  });

  describe("axis: read scope IS report scope, derived rather than asserted", () => {
    it("discloses at exactly the elements the table gives an `unread` complement", () => {
      const covered = NEGATION_CODE_READS.filter((read) => read.unread !== undefined).map(
        (read) => read.element,
      );

      // Derived from the table, never written down as a count: if a later change gives another
      // element a complement, this reds until the cases below cover it too.
      expect(covered).toEqual(["status"]);
    });

    it("discloses at every element the table covers, and the disclosure is that element's", () => {
      for (const read of NEGATION_CODE_READS) {
        if (read.unread === undefined) continue;
        const json = `{"resourceType":"Procedure","${read.element}":{"value":"x"}}`;

        expect(disclosed(safetyOf(json))).toEqual([`Procedure.${read.element}`]);
      }
    });

    it("keeps the wrapper walk of the read it complements", () => {
      // `primitiveStrings` reads through an array wrapper position by position, so the complement
      // must reach a wrapped object or it would cover a narrower set of documents than the read.
      expect(
        disclosed(safetyOf('{"resourceType":"Procedure","status":[{"value":"not-done"}]}')),
      ).toEqual(["Procedure.status"]);
      expect(
        disclosed(safetyOf('{"resourceType":"Procedure","status":[[{"value":"not-done"}]]}')),
      ).toEqual(["Procedure.status"]);
    });

    it("reports one location however many members a repeated name left", () => {
      // FHIRPath cannot address an individual member, so a second identical location would say
      // nothing a caller could act on. The same rule the near-miss and boolean channels follow.
      const safety = safetyOf(
        '{"resourceType":"Procedure","status":{"value":"not-done"},"status":{"value":"x"}}',
      );

      expect(disclosed(safety)).toEqual(["Procedure.status"]);
    });

    it("sees a shadowed member, so a shape cannot hide behind a duplicate key", () => {
      const safety = safetyOf(
        '{"resourceType":"Procedure","status":"completed","status":{"value":"not-done"}}',
      );

      expect(disclosed(safety)).toEqual(["Procedure.status"]);
    });
  });

  describe("axis: empty on conformant documents, in both wire formats", () => {
    /**
     * Every one of these is conformant R4 and every one of them must draw nothing. This is the
     * direction that bit `#84` pass 1: a disclosure firing on a conformant document is a behavioural
     * defect, not an over-report.
     */
    const conformant: readonly [string, string][] = [
      ["a plain status", '{"resourceType":"Procedure","status":"completed"}'],
      ["a status that IS a negation", '{"resourceType":"Procedure","status":"not-done"}'],
      [
        "a value-absent status with a data-absent-reason sibling (json.html 2.6.2.3)",
        '{"resourceType":"Procedure","_status":{"extension":[{"url":"http://hl7.org/fhir/StructureDefinition/data-absent-reason","valueCode":"unknown"}]}}',
      ],
      ["a resource with no status at all", '{"resourceType":"Patient","active":true}'],
      [
        "a CodeableConcept verificationStatus",
        '{"resourceType":"Condition","verificationStatus":{"coding":[{"system":"http://terminology.hl7.org/CodeSystem/condition-ver-status","code":"refuted"}]}}',
      ],
      [
        "a CodeableConcept verificationStatus carrying only text, which R4 permits",
        '{"resourceType":"Condition","verificationStatus":{"text":"refuted"}}',
      ],
      [
        "a Bundle of conformant entries",
        bundleWith('{"resourceType":"Procedure","status":"not-done"}'),
      ],
    ];

    for (const [name, json] of conformant) {
      it(`draws nothing for ${name}`, () => {
        const safety = safetyOf(json);

        expect(disclosed(safety)).toEqual([]);
        expect(safety.safeToSummarize).toBe(true);
      });
    }

    it("draws nothing for a conformant XML status carrying id and extension children", () => {
      // The shape that would false-fire if the predicate keyed on "the element has children". Both
      // readers model a primitive's `value` beside its metadata as a primitive, so this is READ.
      const safety = safetyOfXml(
        `<Procedure ${FHIR_NS}><status id="s1" value="not-done">` +
          '<extension url="http://example.org/x"><valueString value="a"/></extension>' +
          "</status></Procedure>",
      );

      expect(safety.negations).toEqual(["not-done"]);
      expect(disclosed(safety)).toEqual([]);
      expect(safety.safeToSummarize).toBe(true);
    });

    it("draws nothing for a conformant XML status with no value at all", () => {
      const safety = safetyOfXml(
        `<Procedure ${FHIR_NS}><status>` +
          '<extension url="http://hl7.org/fhir/StructureDefinition/data-absent-reason">' +
          '<valueCode value="unknown"/></extension></status></Procedure>',
      );

      expect(disclosed(safety)).toEqual([]);
      expect(safety.safeToSummarize).toBe(true);
    });
  });

  describe("the predicate itself, pinned directly", () => {
    it("is false for a primitive holding no value, which is not content stepped over", () => {
      // Pinned on `hasUnreadableCode` rather than only through a document, because the pass-1
      // remedy on `#84` made a guard redundant and the surviving mutation was only visible when the
      // predicate was asserted directly.
      const { resource } = parseResourceXml(
        `<Procedure ${FHIR_NS}><status><extension url="http://example.org/x">` +
          '<valueString value="a"/></extension></status></Procedure>',
      );
      const status = resource.properties.find((p) => p.name === "status");

      expect(status).toBeDefined();
      expect(hasUnreadableCode(status?.value)).toBe(false);
    });

    it("is false for undefined and for an empty wrapper, which hold no position", () => {
      expect(hasUnreadableCode(undefined)).toBe(false);
      expect(disclosed(safetyOf('{"resourceType":"Procedure","status":[]}'))).toEqual([]);
    });
  });

  describe("declared limits, pinned in BOTH states so they cannot move in silence", () => {
    /**
     * **The both-states pins, named here rather than counted.** Each of these reads the same at the
     * base commit `632f914` and at this one, deliberately, and each is a limit this slice declines
     * to close rather than a case it covers:
     *
     * 1. `verificationStatus` written as a bare string draws nothing. Its shape complement is a
     *    *primitive*, and `Condition.verificationStatus` IS a `code` in DSTU2 (ADR 0004 read
     *    tolerance), so the same predicate would report a conformant DSTU2 document.
     * 2. `AllergyIntolerance.code` written as a bare string draws nothing. That is the boundary keeping
     *    `no-known-allergy` root- and type-scoped: absence there reads as UNKNOWN, not NONE.
     * 3. `doNotPerform` written as an object draws nothing. `unreadableBooleans` asks about a
     *    written value, and this slice does not widen it.
     * 4. `clinicalStatus` written as a bare string draws nothing. It is not a negation element.
     * 5. `validateResource` still reports `valid: true`. The safety layer is this slice's window
     *    and no new `ValidationIssue` is raised.
     * 6. An empty array at `status` draws nothing: no position, so no content.
     */
    it("1. leaves a bare-string verificationStatus alone (DSTU2 spells it a code)", () => {
      const safety = safetyOf('{"resourceType":"Condition","verificationStatus":"refuted"}');

      expect(disclosed(safety)).toEqual([]);
      expect(safety.negations).toEqual([]);
      expect(safety.safeToSummarize).toBe(true);
    });

    it("2. leaves a bare-string AllergyIntolerance.code alone", () => {
      const safety = safetyOf('{"resourceType":"AllergyIntolerance","code":"716186003"}');

      expect(disclosed(safety)).toEqual([]);
      expect(safety.noKnownAllergy).toBe(false);
      expect(safety.safeToSummarize).toBe(true);
    });

    it("3. leaves an object at doNotPerform alone", () => {
      const safety = safetyOf('{"resourceType":"MedicationRequest","doNotPerform":{"value":true}}');

      expect(disclosed(safety)).toEqual([]);
      expect(safety.unreadableBooleans).toEqual([]);
      expect(safety.safeToSummarize).toBe(true);
    });

    it("4. leaves an object at clinicalStatus alone", () => {
      const safety = safetyOf('{"resourceType":"Condition","clinicalStatus":"active"}');

      expect(disclosed(safety)).toEqual([]);
      expect(safety.safeToSummarize).toBe(true);
    });

    it("5. leaves `validateResource` reporting valid, which is this slice's declared boundary", () => {
      // The safety readout refuses; the validator is untouched. Raising a new issue code here needs
      // a window decision of its own (which types, and what the validator knows about a datatype
      // with no caller-supplied profile), so it is filed rather than absorbed.
      const { resource } = parseResource(
        '{"resourceType":"Procedure","status":{"value":"not-done"}}',
      );

      // ONLY the validator is asserted here, and that is deliberate: the head-side refusal is
      // asserted in the first case of this file, and folding it in would make this case red at base
      // and stop it being a both-states pin at all.
      expect(validateResource(resource).valid).toBe(true);
    });

    it("6. leaves an empty array at status alone", () => {
      const safety = safetyOf('{"resourceType":"Procedure","status":[]}');

      expect(disclosed(safety)).toEqual([]);
      expect(safety.safeToSummarize).toBe(true);
    });
  });
});
