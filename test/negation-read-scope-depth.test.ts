import { describe, expect, it } from "vitest";

import {
  assertSafeToSummarize,
  droppedText,
  FhirSafetyError,
  isRetracted,
  parseResource,
  parseResourceXml,
  readSafety,
  type NegationKind,
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

/** A collection `Bundle` carrying one entry resource: one of the two shapes a nested read must reach. */
const bundleWith = (resource: string): string =>
  `{"resourceType":"Bundle","type":"collection","entry":[{"resource":${resource}}]}`;

/** A `Patient` carrying one `contained` resource: the other shape. */
const containing = (resource: string): string =>
  `{"resourceType":"Patient","contained":[${resource}]}`;

const ALLERGY_VERIFICATION =
  "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification";
const CONDITION_VERIFICATION = "http://terminology.hl7.org/CodeSystem/condition-ver-status";

/**
 * One conformant R4 resource per negation this slice moves onto the walk, each spelling its negation
 * on an element R4 flags `?!`. Every document here is synthetic and carries no patient content.
 */
const NESTED: readonly { kind: NegationKind; label: string; resource: string }[] = [
  {
    kind: "entered-in-error",
    label: "an Observation retracted on `status`",
    resource:
      '{"resourceType":"Observation","status":"entered-in-error","code":{"text":"synthetic"}}',
  },
  {
    kind: "entered-in-error",
    label: "a Condition retracted on `verificationStatus`",
    resource:
      '{"resourceType":"Condition","verificationStatus":{"coding":[' +
      `{"system":"${CONDITION_VERIFICATION}","code":"entered-in-error"}]}}`,
  },
  {
    kind: "refuted",
    label: "a refuted AllergyIntolerance",
    resource:
      '{"resourceType":"AllergyIntolerance","verificationStatus":{"coding":[' +
      `{"system":"${ALLERGY_VERIFICATION}","code":"refuted"}]}}`,
  },
  {
    kind: "not-done",
    label: "a Procedure recorded as not performed",
    resource: '{"resourceType":"Procedure","status":"not-done"}',
  },
  {
    kind: "not-taken",
    label: "a MedicationStatement recorded as not taken",
    resource: '{"resourceType":"MedicationStatement","status":"not-taken"}',
  },
];

/**
 * **Every negation except `doNotPerform` was still read only at the resource handed in.**
 *
 * Measured at the base commit `3fa61aa`, on plain conformant JSON:
 *
 * ```
 * Bundle{ entry[0].resource = Observation{status:"entered-in-error"} }  ->  negations: []
 * Bundle{ entry[0].resource = Procedure{status:"not-done"} }            ->  negations: []
 * Patient{ contained[0]     = AllergyIntolerance{…refuted} }            ->  negations: []
 * ```
 *
 * each under `safeToSummarize: true` with `assertSafeToSummarize` clean, while the identical
 * `Bundle` carrying a `doNotPerform` order returned `negations: ["do-not-perform"]`: that one
 * negation having been moved onto the walk by the slice before this one. **A retracted record and a
 * procedure recorded as not performed read as a document with nothing to say about them**, and a
 * `Bundle` is how a FHIR resource ordinarily travels.
 *
 * **This needs neither a non-conformant value nor a wire-format quirk.** It is conformant JSON in
 * the container the standard defines for carrying resources, read wrong: which is what puts it in
 * the same class as its two predecessors rather than in the residual pile.
 *
 * **What licenses reading a nested resource is FHIR's modifier rule, not the depth.** Every element
 * moved here is one R4 flags `?!`: `status`, `verificationStatus`, `doNotPerform`: and a consumer
 * may never process a modifier element as if it were absent. That obligation attaches to the
 * resource carrying it, not to the position the resource occupies in a document: a `Bundle.entry`
 * order and a `contained` order are resources. The direction argument then applies exactly as it
 * does at the entry root: this can only **add** a negation, never retire a finding, never flip
 * `valid`, and never turn a refusal into an affirmation.
 *
 * **The read is not widened past its refusal, and that is pinned rather than argued.** The four
 * channels that record a safety value this layer could **not** read: dropped XML element text, an
 * array inside an array, a shadowed property name, an array-wrapped scalar: already walked the
 * whole document at the base commit, so the refusal window was, and remains, at least as wide as
 * this read. Both halves are pinned at one nested location below: a `<status>not-done</status>`
 * whose text the reader drops is reported there and adds no negation, and a `<status
 * value="not-done"/>` at the same location is read.
 *
 * **`no-known-allergy` deliberately does not move**, and it is the one negation whose absence is the
 * cautious answer. See the declared-gap section at the foot of this file.
 */
describe("every negation is read at every resource root, not only the one handed in", () => {
  describe("axis: a negation asserted inside a Bundle entry or a contained resource", () => {
    for (const { kind, label, resource } of NESTED) {
      it(`surfaces ${kind} from ${label} in a Bundle entry`, () => {
        const safety = safetyOf(bundleWith(resource));

        expect(safety.negations).toEqual([kind]);
        // Read, so nothing is withheld: `safeToSummarize` does not move for a value that IS read.
        expect(safety.safeToSummarize).toBe(true);
        expect(refuses(bundleWith(resource))).toBe(false);
      });

      it(`surfaces ${kind} from ${label} in contained`, () => {
        expect(safetyOf(containing(resource)).negations).toEqual([kind]);
      });
    }

    it("reaches a resource nested two containers deep", () => {
      // The walk has no depth limit and this says so: a `Bundle` entry whose resource is a `Patient`
      // that itself contains the retracted record. Nothing about the rule is per-container.
      const safety = safetyOf(
        bundleWith(containing('{"resourceType":"Procedure","status":"not-done"}')),
      );

      expect(safety.negations).toEqual(["not-done"]);
    });

    it("reads a nested resource the XML reader built", () => {
      const { resource } = parseResourceXml(
        `<Bundle ${FHIR_NS}><type value="collection"/><entry><resource>` +
          `<Procedure><status value="not-done"/></Procedure></resource></entry></Bundle>`,
      );

      expect(readSafety(resource).negations).toEqual(["not-done"]);
    });
  });

  /**
   * The read and the refusal at **one** nested location, from both sides. Widening a read without
   * its refusal is how a value goes from *not looked for* to *looked for and silently dropped*, and
   * the predecessor slice paid for learning it. Here the refusal channels already covered the whole
   * document, so the pin runs the other way: it establishes that the window this read moved into was
   * already reported, at the exact location the read now visits.
   */
  describe("the refusal covers the location the read moved into", () => {
    const xmlBundle = (statusElement: string): string =>
      `<Bundle ${FHIR_NS}><type value="collection"/><entry><resource>` +
      `<Procedure>${statusElement}</Procedure></resource></entry></Bundle>`;

    it("reports the unreadable twin at the same nested location", () => {
      // BOTH-STATES. FHIR XML carries a primitive's value in the `value` attribute (xml.html
      // §2.6.1), so `<status>not-done</status>` writes character data the reader has no slot for and
      // drops. That was reported at this nested location at the base commit too, and it is why this
      // slice widens no refusal: the report was already wider than the read.
      const { resource } = parseResourceXml(xmlBundle("<status>not-done</status>"));
      const safety = readSafety(resource);

      expect(droppedText(resource, "Bundle")).toEqual(["Bundle.entry.resource.status"]);
      expect(safety.droppedText).toEqual(["Bundle.entry.resource.status"]);
      expect(safety.negations).toEqual([]);
      expect(safety.safeToSummarize).toBe(false);
    });

    it("reads the value at that same location when the document spells it", () => {
      const { resource } = parseResourceXml(xmlBundle('<status value="not-done"/>'));

      expect(readSafety(resource).negations).toEqual(["not-done"]);
      expect(readSafety(resource).droppedText).toEqual([]);
    });

    it("keeps reporting a nested value the boolean read cannot read", () => {
      // BOTH-STATES, and the pairing the predecessor slice established: `doNotPerform` was already
      // read and refused at this window. It is here so that a change to the shared window cannot
      // move one negation's halves apart without moving this too.
      const unreadable = bundleWith('{"resourceType":"Procedure","doNotPerform":"1"}');

      expect(safetyOf(unreadable).unreadableBooleans).toEqual([
        "Bundle.entry[0].resource.doNotPerform",
      ]);
      expect(safetyOf(unreadable).negations).toEqual([]);
      expect(refuses(unreadable)).toBe(true);
    });

    it("refuses a nested shadowed status while still reading the negation out of it", () => {
      // A repeated property name is reported by a walk that already reached here, and the read now
      // sees every member: the negation is surfaced AND the document is refused, which is the pair
      // this layer exists to keep together.
      const doc = bundleWith(
        '{"resourceType":"Procedure","status":"completed","status":"not-done"}',
      );

      expect(safetyOf(doc).negations).toEqual(["not-done"]);
      expect(safetyOf(doc).shadowedProperties).toEqual(["Bundle.entry[0].resource.status"]);
      expect(refuses(doc)).toBe(true);
    });
  });

  /**
   * The classified list is unlocated, so what a caller sees must not depend on how a document
   * happened to be ordered, nor say the same thing twice.
   */
  describe("the classified list is a set in a fixed order", () => {
    it("names a negation once however many nested resources assert it", () => {
      const safety = safetyOf(
        '{"resourceType":"Bundle","type":"collection","entry":[' +
          '{"resource":{"resourceType":"Procedure","status":"not-done"}},' +
          '{"resource":{"resourceType":"Communication","status":"not-done"}}]}',
      );

      expect(safety.negations).toEqual(["not-done"]);
    });

    it("does not let entry order decide the order of the kinds", () => {
      // The walk meets `not-done` first here and `entered-in-error` second, and the readout lists
      // them the other way round, which is the order it has always used.
      const safety = safetyOf(
        '{"resourceType":"Bundle","type":"collection","entry":[' +
          '{"resource":{"resourceType":"Procedure","status":"not-done"}},' +
          '{"resource":{"resourceType":"Observation","status":"entered-in-error",' +
          '"code":{"text":"synthetic"}}}]}',
      );

      expect(safety.negations).toEqual(["entered-in-error", "not-done"]);
    });

    it("collects negations from several nested resources at once", () => {
      const safety = safetyOf(
        '{"resourceType":"Bundle","type":"collection","entry":[' +
          '{"resource":{"resourceType":"MedicationRequest","status":"active","doNotPerform":true}},' +
          '{"resource":{"resourceType":"MedicationStatement","status":"not-taken"}},' +
          '{"resource":{"resourceType":"Procedure","status":"not-done"}}]}',
      );

      expect(safety.negations).toEqual(["do-not-perform", "not-taken", "not-done"]);
    });
  });

  /**
   * The boundaries this slice moves, pinned at their new values, and the ones it deliberately leaves
   * where they are. Each is red at the base commit except where it says BOTH-STATES.
   */
  describe("moved, and pinned at the new boundary", () => {
    it("leaves `retracted` answering about the resource handed in", () => {
      // A Bundle is not retracted because one of its entries is. The field stays the root read, like
      // `status` beside it, and the negation is where the document-wide answer lives. So `retracted`
      // implies `entered-in-error` is on `negations`, never the other way round.
      const doc = bundleWith(
        '{"resourceType":"Observation","status":"entered-in-error","code":{"text":"synthetic"}}',
      );
      const safety = safetyOf(doc);

      expect(safety.negations).toEqual(["entered-in-error"]);
      expect(safety.retracted).toBe(false);
      expect(isRetracted(parseResource(doc).resource)).toBe(false);
      // The same document handed in at its own root still reads `retracted`.
      expect(safetyOf('{"resourceType":"Observation","status":"entered-in-error"}').retracted).toBe(
        true,
      );
    });

    it("leaves the convenience `status` and `doNotPerform` fields answering about the root", () => {
      const safety = safetyOf(
        bundleWith('{"resourceType":"MedicationRequest","status":"not-taken","doNotPerform":true}'),
      );

      expect(safety.negations).toEqual(["do-not-perform", "not-taken"]);
      expect(safety.status).toBeUndefined();
      expect(safety.doNotPerform).toBeUndefined();
    });

    it("leaves the array-wrapper report on its cardinality table at depth too", () => {
      // Declared residual, unchanged in kind by this slice and now reachable at one more location:
      // on a type outside `SAFETY_RESOURCE_TYPES` the wrapper is read through and the negation
      // surfaced, but the wrapper itself draws no `ARRAY_WRAPPED_SCALAR`, because reporting one is
      // an `error` and that stays where a cardinality is known. Strictly better than the base, which
      // surfaced neither.
      const safety = safetyOf(bundleWith('{"resourceType":"Procedure","status":["not-done"]}'));

      expect(safety.negations).toEqual(["not-done"]);
      expect(safety.arrayWrappedScalars).toEqual([]);

      // The same wrapper on a type the table does know is reported, at the nested location.
      const known = safetyOf(bundleWith('{"resourceType":"Observation","status":["not-done"]}'));

      expect(known.negations).toEqual(["not-done"]);
      expect(known.arrayWrappedScalars).toEqual(["Bundle.entry[0].resource.status"]);
    });

    it("reads a nested resource a repeated property name shadowed", () => {
      // Two `entry` members under one name: the second is the one a single-value read skips, and a
      // negation must not become invisible by arriving there.
      const safety = safetyOf(
        '{"resourceType":"Bundle","type":"collection",' +
          '"entry":[{"resource":{"resourceType":"Patient"}}],' +
          '"entry":[{"resource":{"resourceType":"Procedure","status":"not-done"}}]}',
      );

      expect(safety.negations).toEqual(["not-done"]);
      expect(safety.shadowedProperties).toEqual(["Bundle.entry"]);
    });
  });

  /**
   * **The deliberate both-states pins: these read identically at the base commit and at head**, so
   * they clear nothing about this slice and are here to say what it did not touch. **They are named
   * rather than counted**, so the set is checkable without re-running the base. The five in this
   * section, plus two marked BOTH-STATES in place above: "reports the unreadable twin at the same
   * nested location" and "keeps reporting a nested value the boolean read cannot read": plus all
   * three in the declared-gap section at the foot of this file. Everything else here is red at the
   * base commit `3fa61aa`.
   */
  describe("pinned in both states: identical at the base commit", () => {
    it("surfaces a nested do-not-perform, which the predecessor slice already moved", () => {
      expect(
        safetyOf(bundleWith('{"resourceType":"ServiceRequest","doNotPerform":true}')).negations,
      ).toEqual(["do-not-perform"]);
    });

    it("adds nothing for a document whose nested resources assert no negation", () => {
      const safety = safetyOf(bundleWith('{"resourceType":"Procedure","status":"completed"}'));

      expect(safety.negations).toEqual([]);
      expect(safety.safeToSummarize).toBe(true);
    });

    it("keeps reading the negations at the entry root", () => {
      // The control that says nothing broke where it already worked: the reads at the resource
      // handed in are the same reads, applied to more nodes.
      for (const { kind, resource } of NESTED) {
        expect(safetyOf(resource).negations).toEqual([kind]);
      }
    });

    it("reads a resource's own status, not a status inside a backbone element", () => {
      // A declared limit rather than a rule the read derives: the direction argument would license
      // going deeper, and what stops it is that the walk delivers resource roots. R4 defines no
      // `status` on `Procedure.performer` and no `doNotPerform` on `Dosage`, so no conformant
      // document sits at either, but that is a gap and not a claim that none can.
      expect(
        safetyOf(bundleWith('{"resourceType":"Procedure","performer":[{"status":"not-done"}]}'))
          .negations,
      ).toEqual([]);
      expect(
        safetyOf(
          bundleWith(
            '{"resourceType":"MedicationRequest","dosageInstruction":[{"doNotPerform":true}]}',
          ),
        ).negations,
      ).toEqual([]);
    });

    it("reads no negation out of a nested element that merely spells one as a code", () => {
      // The element scope is untouched by this slice: `status` and no other name. A nested
      // `Procedure.code` spelling `not-done` is a code, not a status.
      expect(
        safetyOf(bundleWith('{"resourceType":"Procedure","code":{"coding":[{"code":"not-done"}]}}'))
          .negations,
      ).toEqual([]);
      expect(
        safetyOf(bundleWith('{"resourceType":"Procedure","statusReason":"not-done"}')).negations,
      ).toEqual([]);
    });
  });

  /**
   * 🔴 **The declared gap, in the fail-safe direction.** `no-known-allergy` is the one negation this
   * slice deliberately leaves root-scoped, and the reason is not caution about depth:
   *
   * - It is read off `AllergyIntolerance.code`, an element R4 does **not** flag `?!`. It is not a
   *   modifier element at all, but this library's own first-class concept, so the rule that licenses
   *   every other read here: a consumer may not process a modifier as if it were absent: does not
   *   reach it.
   * - It runs the other way from every negation on the walk. Surfacing a recorded "no known allergy"
   *   from somewhere inside a document can make a caller **less** careful about a patient; leaving
   *   it unsurfaced reads as *unknown*, which is the cautious answer. The direction argument that
   *   licenses the others therefore argues against this one.
   *
   * It is pinned at both states, so closing it later must red these.
   */
  describe("declared gap: no-known-allergy stays the root, type-scoped read", () => {
    const noKnownAllergy =
      '{"resourceType":"AllergyIntolerance","code":{"coding":[' +
      '{"system":"http://snomed.info/sct","code":"716186003"}]}}';

    it("does not surface a nested no-known-allergy", () => {
      // BOTH-STATES.
      expect(safetyOf(bundleWith(noKnownAllergy)).negations).toEqual([]);
      expect(safetyOf(bundleWith(noKnownAllergy)).noKnownAllergy).toBe(false);
      expect(safetyOf(containing(noKnownAllergy)).negations).toEqual([]);
    });

    it("still surfaces it at the resource's own root", () => {
      // BOTH-STATES, and the control that says the gap is about scope and not about the read.
      expect(safetyOf(noKnownAllergy).negations).toEqual(["no-known-allergy"]);
      expect(safetyOf(noKnownAllergy).noKnownAllergy).toBe(true);
    });

    it("stays type-scoped as well, which is the same asymmetry from the other side", () => {
      // BOTH-STATES.
      expect(
        safetyOf(
          '{"resourceType":"Condition","code":{"coding":[' +
            '{"system":"http://snomed.info/sct","code":"716186003"}]}}',
        ).negations,
      ).toEqual([]);
    });
  });
});
