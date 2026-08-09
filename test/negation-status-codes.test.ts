import { describe, expect, it } from "vitest";

import {
  isRetracted,
  parseResource,
  parseResourceXml,
  readSafety,
  serializeResource,
  SAFETY_RESOURCE_TYPES,
} from "../src/index.js";

const FHIR_NS = 'xmlns="http://hl7.org/fhir"';

/** The readout of a JSON document, written out so each assertion below reads the literal it pins. */
function safetyOf(json: string): ReturnType<typeof readSafety> {
  return readSafety(parseResource(json).resource);
}

/**
 * The R4 resource types whose `status` binds a value set containing `not-done`. Derived from the
 * published R4 definitions rather than remembered: `hl7.org/fhir/R4/valuesets.json` and
 * `profiles-resources.json` (`fhirVersion` `4.0.1`), by taking every element whose binding names a
 * value set that includes the code. `Immunization` is the only one this library used to read.
 */
const R4_NOT_DONE_TYPES = [
  "Procedure",
  "Communication",
  "Media",
  "MedicationAdministration",
  "Immunization",
] as const;

/**
 * The `not-done` / `not-taken` negations were **blind by type gate**, on plain conformant documents.
 *
 * At the base commit `f8d7213`:
 *
 * ```
 * {"resourceType":"Immunization",            "status":"not-done"}  ->  negations: ["not-done"]
 * {"resourceType":"Procedure",               "status":"not-done"}  ->  negations: []  safeToSummarize: true
 * {"resourceType":"MedicationAdministration","status":"not-done"}  ->  negations: []  safeToSummarize: true
 * {"resourceType":"Communication",           "status":"not-done"}  ->  negations: []  safeToSummarize: true
 * {"resourceType":"Media",                   "status":"not-done"}  ->  negations: []  safeToSummarize: true
 * ```
 *
 * Each of those four is a **conformant R4 document**: `not-done` is in the required value set bound
 * to that resource's `status`, and it means the event did not happen. The read was gated on
 * `Immunization`, and a type gate does not merely fail to read the types it omits: it never looks,
 * so nothing is reported for them either and the readout affirms the record is safe to summarise. A
 * procedure recorded as **not performed** read as a procedure with nothing to say about it.
 *
 * **The argument that dropped the `doNotPerform` type gate does not transfer to this one for free,
 * and that is the whole difficulty of this slice.** `doNotPerform` is an *element*: no R4 type
 * defines it as anything but an instruction not to act, so reading it anywhere cannot mis-read it.
 * `not-done` is a *value* of `status`, one element name whose value set is defined **per resource
 * type**, so "which R4 types carry this code" is a real question. It was answered against the
 * published R4 definitions, not by analogy, and the answer is what licenses the read:
 *
 * - Each code is defined **only** as a `status` value: no R4 element outside `status` binds a value
 *   set containing `not-done` or `not-taken`.
 * - **Every** R4 code system that defines the code defines it as the negation: `not-done` in
 *   `event-status` ("terminated prior to any activity beyond preparation") and in
 *   `medication-admin-status` ("terminated prior to any impact on the subject"), `not-taken` in
 *   `medication-statement-status` ("the medication was not consumed by the patient").
 * - A gate is **short and version-scoped**: the R4 census below is five types where this library read
 *   one, and the same census against R5 returns a different set entirely (it carries the code on
 *   types R4 has no such resource for, and drops `not-taken` from `MedicationStatement.status`), on
 *   documents a reader with R5 read-tolerance will still be handed.
 *
 * Only then does the direction argument apply: the read can only **add** a negation, never retire a
 * finding and never flip `valid` (nothing in the validator reads `negations`). So the gate is
 * **dropped rather than widened**: a longer list of remembered types is the same mechanism: and
 * what is left is the read `isRetracted` already performed for `entered-in-error`, which is the same
 * shape of code on the same element, now in one shared function.
 *
 * **`not-taken` is the narrower half and is reported as such.** The R4 census returns exactly one
 * element for it, `MedicationStatement.status`, so the old gate was already complete for every
 * conformant document and dropping it changes nothing on one. What it changes is the
 * **non-conformant** document, which is the case this library exists to be honest about.
 */
describe("the not-done / not-taken negations are read wherever a status spells them", () => {
  describe("axis: no resource-type gate", () => {
    for (const resourceType of R4_NOT_DONE_TYPES) {
      it(`surfaces not-done on a conformant ${resourceType}`, () => {
        // The `Immunization` turn of this loop is a both-states pin: it read this way at the base
        // commit too, and it is the control that says the fix broke nothing that already worked.
        const safety = safetyOf(`{"resourceType":"${resourceType}","status":"not-done"}`);

        expect(safety.negations).toEqual(["not-done"]);
        // Read, so nothing is withheld: the refusal channel is for values that cannot be read.
        expect(safety.safeToSummarize).toBe(true);
        // The convenience field surfaces the raw code either way and is not the safety read.
        expect(safety.status).toBe("not-done");
      });
    }

    it("surfaces not-taken on a conformant MedicationStatement", () => {
      // A both-states pin: the one R4 element whose value set carries `not-taken`, and the type the
      // dropped gate named. Nothing about a conformant `not-taken` document moves in this slice.
      const safety = safetyOf('{"resourceType":"MedicationStatement","status":"not-taken"}');

      expect(safety.negations).toEqual(["not-taken"]);
      expect(safety.safeToSummarize).toBe(true);
    });

    it("surfaces not-taken written on a type whose R4 value set excludes it", () => {
      // The document the item quoted. R4 spells this negation `not-done` on
      // `MedicationAdministration`, so a `not-taken` here is non-conformant: and a sender who wrote
      // "not taken" on a medication administration is the one case where reading the record as live
      // costs a patient something. Surfacing it is the fail-safe direction; the document is already
      // reported non-conformant by any consumer checking the value set, which this library does not.
      const safety = safetyOf('{"resourceType":"MedicationAdministration","status":"not-taken"}');

      expect(safety.negations).toEqual(["not-taken"]);
    });

    it("does not need the type to be one the type-scoped reads know", () => {
      // The point of the fix stated as a property of the sets rather than of one document: four of
      // the five R4 types that carry `not-done` are not types this library scopes its other reads
      // to, so any rule consulting `SAFETY_RESOURCE_TYPES` here was blind by construction.
      for (const resourceType of [
        "Procedure",
        "Communication",
        "Media",
        "MedicationAdministration",
      ]) {
        expect(SAFETY_RESOURCE_TYPES.has(resourceType)).toBe(false);
        // Asserted together with the reading, so this is not a statement about two sets that would
        // hold whatever the read did.
        expect(
          safetyOf(`{"resourceType":"${resourceType}","status":"not-done"}`).negations,
        ).toEqual(["not-done"]);
      }
      expect(SAFETY_RESOURCE_TYPES.has("Immunization")).toBe(true);
    });

    it("adds nothing for a status that is not one of the two negation codes", () => {
      // A both-states pin, and the assertion that says the read is the code rather than the element:
      // dropping a type gate must not turn every `status` into a negation.
      expect(safetyOf('{"resourceType":"Procedure","status":"completed"}').negations).toEqual([]);
      expect(safetyOf('{"resourceType":"Procedure","status":"in-progress"}').negations).toEqual([]);
      expect(safetyOf('{"resourceType":"Procedure"}').negations).toEqual([]);
      // Not a substring match either: `not-done` is a code, not a fragment of one.
      expect(safetyOf('{"resourceType":"Procedure","status":"not-done-yet"}').negations).toEqual(
        [],
      );
    });

    it("reads the lexical spelling the schema-free XML reader keeps as text", () => {
      const { resource } = parseResourceXml(
        `<Procedure ${FHIR_NS}><status value="not-done"/><subject><reference value="Patient/1"/>` +
          `</subject></Procedure>`,
      );

      expect(readSafety(resource).negations).toEqual(["not-done"]);
    });

    it("keeps the negation across a parse -> serialize -> parse round trip", () => {
      const source =
        '{"resourceType":"Procedure","status":"not-done","subject":{"reference":"Patient/1"}}';
      const reread = parseResource(serializeResource(parseResource(source).resource)).resource;

      expect(readSafety(reread).negations).toEqual(["not-done"]);
    });
  });

  describe("axis: every value the document wrote for the element", () => {
    it("finds the negation in a member a repeated property name shadowed", () => {
      // First-wins would read `completed`. The negation read runs over every written member, so a
      // retraction cannot hide behind a duplicate key on the new types either.
      const safety = safetyOf(
        '{"resourceType":"Procedure","status":"completed","status":"not-done"}',
      );

      expect(safety.negations).toEqual(["not-done"]);
      expect(safety.status).toBe("completed");
      expect(safety.shadowedProperties).toEqual(["Procedure.status"]);
      expect(safety.safeToSummarize).toBe(false);
    });

    it("reads through an array wrapper around status on a type with no cardinality", () => {
      // Declared residual, in the safe direction and identical in shape to the `doNotPerform` one:
      // on a type outside `SAFETY_RESOURCE_TYPES` the wrapper is read through and the negation
      // surfaced, but the wrapper itself draws no `ARRAY_WRAPPED_SCALAR`, because reporting one is an
      // `error` and that stays where a cardinality is known. Strictly better than the base commit,
      // which read nothing here and reported nothing either.
      const procedure = safetyOf('{"resourceType":"Procedure","status":["not-done"]}');

      expect(procedure.negations).toEqual(["not-done"]);
      expect(procedure.arrayWrappedScalars).toEqual([]);

      // The both-states half of the pair: on a safety type the wrapper is read AND reported.
      const immunization = safetyOf('{"resourceType":"Immunization","status":["not-done"]}');

      expect(immunization.negations).toEqual(["not-done"]);
      expect(immunization.arrayWrappedScalars).toEqual(["Immunization.status"]);
    });

    it("keeps the classified negations in their established order", () => {
      // A negation read at a newly-reachable type must not reorder the ones already there.
      const retracted = safetyOf('{"resourceType":"Procedure","status":"entered-in-error"}');

      expect(retracted.negations).toEqual(["entered-in-error"]);

      const both = safetyOf(
        '{"resourceType":"Procedure","status":"entered-in-error","status":"not-done"}',
      );

      expect(both.negations).toEqual(["entered-in-error", "not-done"]);

      const twoCodes = safetyOf(
        '{"resourceType":"MedicationAdministration","status":"not-taken","status":"not-done"}',
      );

      expect(twoCodes.negations).toEqual(["not-taken", "not-done"]);
    });
  });

  /**
   * The retraction read this slice re-pointed at the shared function. `isRetracted` answered the
   * `status` half with the same expression before, so **every assertion here is a both-states pin**:
   * they exist to say the refactor moved nothing, and they would red if it had.
   */
  describe("pinned in both states: the retraction read the shared function now serves", () => {
    it("still retracts on a status code, on any resource type", () => {
      expect(
        isRetracted(
          parseResource('{"resourceType":"Observation","status":"entered-in-error"}').resource,
        ),
      ).toBe(true);
      expect(
        isRetracted(
          parseResource('{"resourceType":"Patient","status":"entered-in-error"}').resource,
        ),
      ).toBe(true);
      expect(
        isRetracted(parseResource('{"resourceType":"Observation","status":"final"}').resource),
      ).toBe(false);
      expect(
        safetyOf('{"resourceType":"Observation","status":"entered-in-error"}').negations,
      ).toEqual(["entered-in-error"]);
    });

    it("still retracts on a verificationStatus coding, the half the shared read does not cover", () => {
      const safety = safetyOf(
        '{"resourceType":"Condition","verificationStatus":{"coding":[' +
          '{"system":"http://terminology.hl7.org/CodeSystem/condition-ver-status",' +
          '"code":"entered-in-error"}]}}',
      );

      expect(safety.retracted).toBe(true);
      expect(safety.negations).toEqual(["entered-in-error"]);
    });

    it("still reads the retraction through a wrapper and a duplicate key", () => {
      expect(
        safetyOf('{"resourceType":"Observation","status":["entered-in-error"]}').retracted,
      ).toBe(true);
      expect(
        safetyOf('{"resourceType":"Observation","status":"final","status":"entered-in-error"}')
          .retracted,
      ).toBe(true);
    });
  });

  /**
   * The deliberate both-states pins: **these read identically at the base commit and at head**, so
   * they clear nothing about the fix and are here to say what it did not touch. Three more sit in the
   * sections above, named so the set is countable without re-running the base: the `Immunization`
   * turn of the `not-done` loop and the conformant `MedicationStatement` `not-taken` (the two types
   * the dropped gates named, the controls that say nothing broke), and "adds nothing for a status
   * that is not one of the two negation codes": and the whole retraction section above is pinned in
   * both states as well.
   */
  describe("pinned in both states: the boundaries this slice does not move", () => {
    it("leaves noKnownAllergy type-gated, which is the opposite direction", () => {
      // The one negation that is a *positive* clinical assertion. Un-gating a read that can only add
      // a negation is safe; un-gating this one would claim a patient has no known allergy over a
      // Condition that merely carries the code.
      const code = '{"coding":[{"system":"http://snomed.info/sct","code":"716186003"}]}';

      expect(safetyOf(`{"resourceType":"Condition","code":${code}}`).negations).toEqual([]);
      expect(safetyOf(`{"resourceType":"AllergyIntolerance","code":${code}}`).negations).toEqual([
        "no-known-allergy",
      ]);
    });

    it("keeps the read on a resource's own status through depth", () => {
      // **Re-keyed, and the reason is recorded rather than the assertion quietly narrowed.** This
      // pinned "a `Procedure` recorded as not performed inside a Bundle entry still leaves the
      // Bundle's `negations` empty": a declared gap that a later slice closed, and it is pinned at
      // its new value in `test/negation-read-scope-depth.test.ts`. That slice widened the set of
      // NODES the read is applied to and nothing about the read itself, so what survives here, and
      // reads identically at this slice's base commit and at head, is the element-and-root scope:
      // a `status` on a backbone element is not a resource's status at any depth.
      const bundle = (resource: string): string =>
        `{"resourceType":"Bundle","type":"collection","entry":[{"resource":${resource}}]}`;

      expect(
        safetyOf(bundle('{"resourceType":"Procedure","performer":[{"status":"not-done"}]}'))
          .negations,
      ).toEqual([]);
      expect(
        safetyOf(
          '{"resourceType":"Patient","contained":[{"resourceType":"Procedure",' +
            '"code":{"coding":[{"code":"not-done"}]}}]}',
        ).negations,
      ).toEqual([]);
    });

    it("reads the resource's own status, not a status inside a backbone element", () => {
      // The same limit the element-scoped read has, and for the same reason: the read is at the
      // resource root. `Procedure.performer` has no `status` in R4, so no conformant document sits
      // here, but that is a declared gap rather than a claim that none can.
      expect(
        safetyOf('{"resourceType":"Procedure","performer":[{"status":"not-done"}]}').negations,
      ).toEqual([]);
    });

    it("reads the code off `status` and off no other element", () => {
      // The element half of the grounding, asserted rather than only written down: R4 defines these
      // codes only as `status` values, so the read is scoped to that element. A `Procedure.code` or
      // an `Observation.code` that happens to spell one is a *code*, not a status, and reading it
      // would surface a negation the sender never asserted. Un-gating the type must not un-scope the
      // element. **The element name is now the ONLY boundary left on this read**, so it is pinned in
      // both the shapes a widening could take: through the CodeableConcept reader that the other
      // negations use, and through the very same primitive read this one uses, where a widening is
      // one more element name in a list and nothing else.
      expect(
        safetyOf('{"resourceType":"Procedure","code":{"coding":[{"code":"not-done"}]}}').negations,
      ).toEqual([]);
      expect(
        safetyOf('{"resourceType":"MedicationStatement","category":{"text":"not-taken"}}')
          .negations,
      ).toEqual([]);
      // The primitive-shaped twins. These are non-conformant documents (R4 gives none of these
      // elements a primitive `code` value), and they are exactly the shape that tells a read of
      // `status` apart from a read of `status` plus any other name.
      expect(safetyOf('{"resourceType":"Procedure","code":"not-done"}').negations).toEqual([]);
      expect(safetyOf('{"resourceType":"Procedure","statusReason":"not-done"}').negations).toEqual(
        [],
      );
      expect(
        safetyOf('{"resourceType":"MedicationStatement","category":"not-taken"}').negations,
      ).toEqual([]);
      expect(
        safetyOf('{"resourceType":"Procedure","statusReason":{"text":"not-done"}}').negations,
      ).toEqual([]);
    });

    it("leaves the array-wrapped type gate read fail-safe", () => {
      // Unchanged: `typesOf` still reads every type the document names, which is what keeps the one
      // remaining type-scoped negation reachable behind a non-conformant type gate.
      const safety = safetyOf(
        '{"resourceType":["AllergyIntolerance"],"code":{"coding":[' +
          '{"system":"http://snomed.info/sct","code":"716186003"}]}}',
      );

      expect(safety.negations).toEqual(["no-known-allergy"]);
      expect(safety.arrayWrappedScalars).toEqual(["AllergyIntolerance.resourceType"]);
    });
  });
});
