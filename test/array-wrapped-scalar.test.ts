import { describe, expect, it } from "vitest";

import {
  arrayWrappedScalars,
  assertSafeToSummarize,
  complex,
  FhirSafetyError,
  isRetracted,
  list,
  parseResource,
  primitive,
  readObservationValue,
  readSafety,
  serializeResource,
  validateResource,
} from "../src/index.js";

import { req } from "./_util.js";

/**
 * A `0..1` element wrapped in a JSON array.
 *
 * FHIR JSON writes a single-valued element as a name/value pair and reserves the array for a
 * repeating element (json.html §2.6.2.2), so `{"status":["entered-in-error"]}` is not a shape the spec
 * defines. The hazard is not the non-conformance, it is the **silence**: a single-value read asks a
 * list for its string value, gets `undefined`, and the retraction the sender wrote is never reported.
 * The reported document read back `retracted: false`, `safeToSummarize: true`, `valid: true` and an
 * empty issue list, which is the same harm a repeated property name reached, with no repeated name.
 *
 * This is not an exotic input. Array-wrapping **every** element is ordinary generic XML-to-JSON
 * converter output, which is exactly how a C-CDA or v2 feed reaches a FHIR surface in practice, so
 * the wrapper usually sits on `resourceType` too, and a wrapped type gate suppresses every
 * type-scoped negation behind it.
 *
 * All values here are synthetic.
 */

/** The reported document, verbatim. */
const REPORTED = '{"resourceType":"Observation","status":["entered-in-error"]}';

describe("an array-wrapped 0..1 element (generic converter output)", () => {
  describe("the reported document", () => {
    it("reports the retraction rather than reading the record as live", () => {
      const { resource } = parseResource(REPORTED);
      const safety = readSafety(resource);

      expect(safety.retracted).toBe(true);
      expect(safety.negations).toEqual(["entered-in-error"]);
      expect(isRetracted(resource)).toBe(true);
    });

    it("refuses to affirm the resource is summarizable, and says where", () => {
      const { resource } = parseResource(REPORTED);
      const safety = readSafety(resource);

      expect(safety.safeToSummarize).toBe(false);
      expect(safety.arrayWrappedScalars).toEqual(["Observation.status"]);
      expect(() => {
        assertSafeToSummarize(resource);
      }).toThrow(FhirSafetyError);
    });

    it("no longer validates clean", () => {
      const { resource } = parseResource(REPORTED);
      const result = validateResource(resource);

      expect(result.valid).toBe(false);
      const wrapped = req(result.issues.find((i) => i.code === "ARRAY_WRAPPED_SCALAR"));
      expect(wrapped.severity).toBe("error");
      expect(wrapped.expression).toBe("Observation.status");
      // The retraction is surfaced alongside it, not swallowed by the structural finding.
      expect(result.issues.some((i) => i.code === "RETRACTED_RESOURCE")).toBe(true);
    });
  });

  describe("the type gate itself", () => {
    // A wrapped `resourceType` is the worse half of the same defect: every type-scoped negation
    // (`not-taken`, `not-done`, "no known allergy") is looked for only once the gate names the type,
    // so a gate that cannot read the type reports no negation at all.
    it("finds a type-scoped negation behind an array-wrapped resourceType", () => {
      const { resource } = parseResource(
        '{"resourceType":["MedicationStatement"],"status":["not-taken"]}',
      );
      const safety = readSafety(resource);

      expect(safety.negations).toEqual(["not-taken"]);
      expect(safety.resourceType).toBe("MedicationStatement");
      expect(safety.safeToSummarize).toBe(false);
      expect(safety.arrayWrappedScalars).toEqual([
        "MedicationStatement.resourceType",
        "MedicationStatement.status",
      ]);
    });

    it("finds a type-scoped negation behind a duplicated resourceType", () => {
      // The sibling route to the same suppression: `resourceType` is first-wins, so the document
      // reads as an Observation and `MedicationStatement.status = not-taken` is never looked for.
      const { resource } = parseResource(
        '{"resourceType":"Observation","resourceType":"MedicationStatement","status":"not-taken"}',
      );
      const safety = readSafety(resource);

      expect(safety.negations).toEqual(["not-taken"]);
      expect(safety.safeToSummarize).toBe(false);
      expect(safety.shadowedProperties).toEqual(["Observation.resourceType"]);
    });

    it("still reports the structural fault when the type is unreadable", () => {
      const result = validateResource(
        parseResource('{"resourceType":["Immunization"],"status":["not-done"]}').resource,
      );

      expect(result.valid).toBe(false);
      expect(result.issues.map((i) => i.code)).toContain("RESOURCE_TYPE_UNKNOWN");
      // …and does not stop there: the safety layer still runs against the type the document names.
      expect(result.issues.filter((i) => i.code === "ARRAY_WRAPPED_SCALAR")).toHaveLength(2);
    });
  });

  describe("every safety element this layer reads", () => {
    const cases: readonly (readonly [string, string, string])[] = [
      [
        "status",
        '{"resourceType":"Observation","status":["entered-in-error"]}',
        "Observation.status",
      ],
      [
        "clinicalStatus",
        '{"resourceType":"Condition","clinicalStatus":[{"coding":[{"code":"active"}]}]}',
        "Condition.clinicalStatus",
      ],
      [
        "verificationStatus",
        '{"resourceType":"Condition","verificationStatus":[{"coding":[{"code":"refuted"}]}]}',
        "Condition.verificationStatus",
      ],
      [
        "doNotPerform",
        '{"resourceType":"MedicationRequest","doNotPerform":[true]}',
        "MedicationRequest.doNotPerform",
      ],
      [
        "code",
        '{"resourceType":"AllergyIntolerance","code":[{"coding":[{"code":"227493005"}]}]}',
        "AllergyIntolerance.code",
      ],
    ];

    it.each(cases)("flags an array-wrapped %s", (_name, json, location) => {
      const { resource } = parseResource(json);
      expect(readSafety(resource).arrayWrappedScalars).toEqual([location]);
      expect(readSafety(resource).safeToSummarize).toBe(false);
    });

    it("reads a negation through the wrapper, not just past it", () => {
      const refuted = parseResource(
        '{"resourceType":"Condition","clinicalStatus":{"coding":[{"code":"active"}]},' +
          '"verificationStatus":[{"coding":[{"code":"refuted"}]}]}',
      ).resource;
      expect(readSafety(refuted).negations).toContain("refuted");

      const doNotPerform = parseResource(
        '{"resourceType":"MedicationRequest","status":["active"],"doNotPerform":[true]}',
      ).resource;
      expect(readSafety(doNotPerform).negations).toContain("do-not-perform");
      expect(readSafety(doNotPerform).doNotPerform).toBe(true);
    });

    it("reads through a nested wrapper in the model", () => {
      // The scalar read unwraps recursively, so a nested list still yields its values.
      const observation = complex([
        { name: "resourceType", value: primitive("Observation") },
        { name: "status", value: list([list([primitive("entered-in-error")])]) },
      ]);
      expect(isRetracted(observation)).toBe(true);
      expect(readSafety(observation).negations).toEqual(["entered-in-error"]);
    });

    it("fails closed on a doubly-wrapped value the JSON reader cannot model", () => {
      // PRE-EXISTING, and outside this slice: the JSON reader does not model a nested array. It reads
      // `[["entered-in-error"]]` as a list holding an empty object and drops the inner value, warning
      // UNKNOWN_PROPERTY. So the retraction is not recoverable from the model here. What matters is
      // the direction: the document is **refused**, never affirmed.
      const { resource, issues } = parseResource(
        '{"resourceType":"Observation","status":[["entered-in-error"]]}',
      );
      expect(issues.map((i) => i.code)).toContain("UNKNOWN_PROPERTY");

      const safety = readSafety(resource);
      expect(safety.safeToSummarize).toBe(false);
      expect(safety.arrayWrappedScalars).toEqual(["Observation.status"]);
      expect(validateResource(resource).valid).toBe(false);
    });
  });

  describe("a wrapper around Coding.system / Coding.code (both 0..1) is a KNOWN GAP", () => {
    // The same mechanism one level down, deliberately NOT closed here, and this block is the pin.
    //
    // Reading through this wrapper is not the same change as reading through the element-level one:
    // `Coding.system` and `Coding.code` feed `codingsOf`'s system x code CROSS-PRODUCT, so any rule
    // that yields more than one value on either side manufactures a `(system, code)` pair the sender
    // never wrote. One of the pairs matched there is SNOMED 716186003 "no known allergy", a POSITIVE
    // clinical assertion: inventing it claims a patient has no known allergy over a record that names
    // an allergen. Missing a retraction withholds information; asserting an absence of allergy does
    // not, so the two directions are not equally safe and the obvious fix is not obviously right.
    //
    // Two candidate predicates were tried and refuted during this slice. Reading every value
    // manufactured the pair outright. Reading only a "single-valued" wrapper still did, because it
    // counted strings rather than array positions and a FHIR JSON `null` is a real position marker
    // (`["716186003", null]` is two entries), so `[null,"...sct"]` x `["716186003",null]` still
    // produced (sct, 716186003). The gap is real and its shape is understood; it needs its own slice
    // with its own grading rather than a third guess appended to this one.
    const CLINICAL_ACTIVE = '"clinicalStatus":{"coding":[{"code":"active"}]}';

    it("does not read a refuted verificationStatus through the wrapper", () => {
      const { resource } = parseResource(
        `{"resourceType":"AllergyIntolerance",${CLINICAL_ACTIVE},` +
          '"verificationStatus":{"coding":[{"code":["refuted"]}]}}',
      );
      expect(readSafety(resource).negations).toEqual([]);
    });

    it("does not read a recorded no-known-allergy through the wrapper", () => {
      const { resource } = parseResource(
        `{"resourceType":"AllergyIntolerance",${CLINICAL_ACTIVE},` +
          '"code":{"coding":[{"system":"http://snomed.info/sct","code":["716186003"]}]}}',
      );
      expect(readSafety(resource).noKnownAllergy).toBe(false);
    });

    it("does not read a retraction in verificationStatus through the wrapper", () => {
      const { resource } = parseResource(
        '{"resourceType":"Condition","verificationStatus":{"coding":[{"code":["entered-in-error"]}]}}',
      );
      expect(isRetracted(resource)).toBe(false);
    });

    it("never invents a (system, code) pair the sender did not write", () => {
      // The property that must hold however this gap is eventually closed. Neither system is paired
      // with `716186003` in any position the sender wrote, so `no-known-allergy` must not be claimed.
      const { resource } = parseResource(
        `{"resourceType":"AllergyIntolerance",${CLINICAL_ACTIVE},` +
          '"code":{"coding":[{"system":["http://example.org/local","http://snomed.info/sct"],' +
          '"code":["716186003","227493005"]}]}}',
      );
      expect(readSafety(resource).noKnownAllergy).toBe(false);
      expect(readSafety(resource).negations).toEqual([]);
    });

    it("never invents one across a FHIR JSON null position marker either", () => {
      // `["716186003", null]` is two entries, not one: a `null` in a primitive array marks a position
      // whose value is absent but whose `_`-sibling may carry an extension. So SNOMED sits in position
      // 2 and `716186003` in position 1, and the pair exists in no position the sender wrote.
      const { resource } = parseResource(
        `{"resourceType":"AllergyIntolerance",${CLINICAL_ACTIVE},` +
          '"code":{"coding":[{"system":[null,"http://snomed.info/sct"],"code":["716186003",null]},' +
          '{"system":"http://www.nlm.nih.gov/research/umls/rxnorm","code":"7980"}]}}',
      );
      expect(readSafety(resource).noKnownAllergy).toBe(false);
      expect(readSafety(resource).negations).toEqual([]);
    });

    it("still reports nothing at the element level for it (no location either)", () => {
      const { resource } = parseResource(
        `{"resourceType":"AllergyIntolerance",${CLINICAL_ACTIVE},` +
          '"verificationStatus":{"coding":[{"code":["refuted"]}]}}',
      );
      expect(readSafety(resource).arrayWrappedScalars).toEqual([]);
      expect(readSafety(resource).safeToSummarize).toBe(true);
    });
  });

  describe("nested resources", () => {
    it("flags a wrapped element on a contained resource", () => {
      const { resource } = parseResource(
        '{"resourceType":"Patient","contained":[{"resourceType":"Observation",' +
          '"status":["entered-in-error"]}]}',
      );
      expect(readSafety(resource).arrayWrappedScalars).toEqual(["Patient.contained[0].status"]);
    });

    it("flags a wrapped element on a Bundle entry resource", () => {
      const { resource } = parseResource(
        '{"resourceType":"Bundle","type":"collection","entry":[{"resource":' +
          '{"resourceType":"Observation","status":["entered-in-error"]}}]}',
      );
      expect(readSafety(resource).arrayWrappedScalars).toEqual(["Bundle.entry[0].resource.status"]);
    });
  });

  describe("it never flags a conformant document (no false errors)", () => {
    it("leaves a spec-clean resource exactly as it was", () => {
      const { resource } = parseResource(
        '{"resourceType":"Observation","status":"entered-in-error","code":{"text":"synthetic"}}',
      );
      const safety = readSafety(resource);

      expect(safety.arrayWrappedScalars).toEqual([]);
      expect(safety.safeToSummarize).toBe(true);
      expect(safety.retracted).toBe(true);
      expect(validateResource(resource).valid).toBe(true);
    });

    it("leaves a genuinely repeating element alone", () => {
      // `Observation.category` is 0..*, `identifier` is 0..*: an array is the correct encoding.
      const { resource } = parseResource(
        '{"resourceType":"Observation","status":"final","identifier":[{"value":"synthetic-1"}],' +
          '"category":[{"coding":[{"code":"vital-signs"}]}]}',
      );
      expect(readSafety(resource).arrayWrappedScalars).toEqual([]);
      expect(readSafety(resource).safeToSummarize).toBe(true);
    });

    it("does not flag `code` where R4 really does define it as repeating", () => {
      // This is why the rule is scoped to a resource root of a safety type rather than keyed on the
      // element name alone. `Questionnaire.code` is 0..* (questionnaire.html) and
      // `ElementDefinition.code` is 0..* (elementdefinition.html); a name-only rule would call both
      // of these conformant documents errors, which the validator's fail-safe contract forbids.
      const questionnaire = parseResource(
        '{"resourceType":"Questionnaire","status":"active","code":[{"code":"synthetic-1"},' +
          '{"code":"synthetic-2"}]}',
      ).resource;
      expect(readSafety(questionnaire).arrayWrappedScalars).toEqual([]);
      expect(
        validateResource(questionnaire).issues.some((i) => i.code === "ARRAY_WRAPPED_SCALAR"),
      ).toBe(false);

      const structureDefinition = parseResource(
        '{"resourceType":"StructureDefinition","status":"draft","differential":{"element":' +
          '[{"path":"Observation.value[x]","code":[{"code":"a"},{"code":"b"}]}]}}',
      ).resource;
      expect(readSafety(structureDefinition).arrayWrappedScalars).toEqual([]);
    });

    it("does not flag a nested backbone element whose cardinality it cannot know", () => {
      // `Observation.component` is a backbone element, not a resource root. This library has no
      // per-resource model, so it says nothing there rather than guessing.
      const { resource } = parseResource(
        '{"resourceType":"Observation","status":"final","component":[{"code":["x"]}]}',
      );
      expect(readSafety(resource).arrayWrappedScalars).toEqual([]);
    });
  });

  describe("diagnostics stay value-free", () => {
    it("reports locations only, never the wrapped value", () => {
      const { resource } = parseResource(
        '{"resourceType":"Observation","status":["entered-in-error"],"code":[{"text":"SECRET"}]}',
      );
      const serialized = JSON.stringify(validateResource(resource).issues);

      expect(serialized).not.toContain("SECRET");
      expect(serialized).not.toContain("entered-in-error");
      const outcome = JSON.stringify(
        serializeResource(validateResource(resource).toOperationOutcome()),
      );
      expect(outcome).not.toContain("SECRET");
    });
  });

  describe("arrayWrappedScalars() addresses the element, like its siblings", () => {
    it("takes the FHIRPath prefix the caller supplies", () => {
      const { resource } = parseResource(REPORTED);
      expect(arrayWrappedScalars(resource, "Observation")).toEqual(["Observation.status"]);
      expect(arrayWrappedScalars(resource, "$this")).toEqual(["$this.status"]);
    });

    it("reports one location per element however many members carry the wrapper", () => {
      const { resource } = parseResource(
        '{"resourceType":"Observation","status":["final"],"status":["entered-in-error"]}',
      );
      expect(arrayWrappedScalars(resource, "Observation")).toEqual(["Observation.status"]);
      // …and the retraction in the shadowed member is still read through its wrapper.
      expect(readSafety(resource).retracted).toBe(true);
    });
  });

  describe("what this slice deliberately does not change", () => {
    it("does NOT launder the defect through a write and re-read", () => {
      // The duplicate-key route launders: the writer emits one member per name, so the survivor is
      // conformant and the re-read is clean. The array route does not, because the model keeps the
      // list and the writer emits it back. Pinned so a future writer change cannot quietly introduce
      // the laundering the duplicate-key route has.
      const { resource } = parseResource(REPORTED);
      const rewritten = serializeResource(resource);
      expect(rewritten).toBe(REPORTED);

      const reread = readSafety(parseResource(rewritten).resource);
      expect(reread.retracted).toBe(true);
      expect(reread.safeToSummarize).toBe(false);
    });

    it("does not extend the cardinality rule beyond the elements the safety layer reads", () => {
      // Deferred bound, stated as a fact rather than a sentence: `value[x]` is a `0..1` choice, but
      // it is not one of the elements this layer reads to reach a safety verdict, so an array around
      // it draws **no** ARRAY_WRAPPED_SCALAR. Widening the table to every 0..1 element in R4 is a
      // per-resource model, which this library does not have and this layer must not become.
      const { resource } = parseResource(
        '{"resourceType":"Observation","status":"final","valueQuantity":[{"value":5,' +
          '"system":"http://unitsofmeasure.org","code":"mg"}]}',
      );

      expect(readSafety(resource).arrayWrappedScalars).toEqual([]);

      // It fails **safe** where it does reach: `readObservationValue` reports the variant that is
      // present and no `quantity`, so no wrong number is ever handed out. What it still lacks is a
      // channel of its own to say the encoding was ambiguous, which is a public-surface change and
      // belongs in its own slice.
      const value = req(readObservationValue(resource));
      expect(value.type).toBe("Quantity");
      expect(value.quantity).toBeUndefined();
      expect(value.node.kind).toBe("list");
    });
  });
});
