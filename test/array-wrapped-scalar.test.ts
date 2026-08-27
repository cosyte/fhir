import { describe, expect, it } from "vitest";

import {
  arrayWrappedScalars,
  assertSafeToSummarize,
  codingsOf,
  complex,
  FhirSafetyError,
  FhirSerializeError,
  getProperty,
  isRetracted,
  list,
  parseResource,
  primitive,
  readInterpretations,
  readObservationValue,
  readSafety,
  serializeResource,
  serializeResourceXml,
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
    // A wrapped `resourceType` is the worse half of the same defect: a type-scoped read is reached
    // only once the gate names the type, so a gate that cannot read the type reports nothing at all.
    // **These are keyed to "no known allergy" deliberately.** It is the negation that is still
    // type-scoped, so the negation assertion fails if the fail-safe type read is removed. They used
    // a `not-taken`, which is no longer gated on a type at all: the surrounding `resourceType` and
    // `arrayWrappedScalars` assertions still graded the type read, but the negation beside them had
    // stopped, and a test half of whose assertions have gone quiet is not the control it reads as.
    const NO_KNOWN_ALLERGY =
      '"code":{"coding":[{"system":"http://snomed.info/sct","code":"716186003"}]}';

    it("finds a type-scoped negation behind an array-wrapped resourceType", () => {
      const { resource } = parseResource(
        `{"resourceType":["AllergyIntolerance"],${NO_KNOWN_ALLERGY}}`,
      );
      const safety = readSafety(resource);

      expect(safety.negations).toEqual(["no-known-allergy"]);
      expect(safety.resourceType).toBe("AllergyIntolerance");
      expect(safety.safeToSummarize).toBe(false);
      expect(safety.arrayWrappedScalars).toEqual(["AllergyIntolerance.resourceType"]);
    });

    it("finds a type-scoped negation behind a duplicated resourceType", () => {
      // The sibling route to the same suppression: `resourceType` is first-wins, so the document
      // reads as an Observation and AllergyIntolerance's "no known allergy" is never looked for.
      const { resource } = parseResource(
        `{"resourceType":"Observation","resourceType":"AllergyIntolerance",${NO_KNOWN_ALLERGY}}`,
      );
      const safety = readSafety(resource);

      expect(safety.negations).toEqual(["no-known-allergy"]);
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
      // The JSON reader still does not model a nested array: it reads `[["entered-in-error"]]` as a
      // list holding an empty object and the inner value is not recoverable from the model. What it
      // no longer does is leave that unsaid. `NESTED_ARRAY` now names the position on both channels
      // (see test/nested-array.test.ts); the older UNKNOWN_PROPERTY warning is still raised too. The
      // direction is what matters here and it is unchanged: the document is **refused**, never
      // affirmed.
      const { resource, issues } = parseResource(
        '{"resourceType":"Observation","status":[["entered-in-error"]]}',
      );
      expect(issues.map((i) => i.code)).toContain("UNKNOWN_PROPERTY");
      expect(issues.map((i) => i.code)).toContain("NESTED_ARRAY");
      expect(readSafety(resource).nestedArrays).toEqual(["Observation.status[0]"]);

      const safety = readSafety(resource);
      expect(safety.safeToSummarize).toBe(false);
      expect(safety.arrayWrappedScalars).toEqual(["Observation.status"]);
      expect(validateResource(resource).valid).toBe(false);
    });
  });

  describe("a wrapper around Coding.system / Coding.code (both 0..1)", () => {
    // The same converter mechanism one level down, and the harder half of it.
    //
    // Reading through this wrapper is not the same change as reading through the element-level one:
    // `Coding.system` and `Coding.code` feed `codingsOf`'s system x code CROSS-PRODUCT, so any rule
    // that yields more than one value on either side manufactures a `(system, code)` pair the sender
    // never wrote. One of the pairs matched there is SNOMED 716186003 "no known allergy", a POSITIVE
    // clinical assertion: inventing it claims a patient has no known allergy over a record that names
    // an allergen. Missing a retraction withholds information; asserting an absence of allergy does
    // not, so the two directions are not equally safe.
    //
    // The rule that satisfies both at once is AT MOST ONE VALUE PER WRITTEN MEMBER: a wrapper is read
    // only where it holds exactly one ARRAY POSITION. The cross-product then has precisely the arity
    // it had when a wrapper read as `undefined`, so unwrapping can only fill in a value and can never
    // add a pair, and the pair it yields is the system and code the sender wrote in the same and only
    // position of that Coding. Positions, not strings: a FHIR JSON `null` is a real position marker
    // (`["716186003", null]` is two entries), which is what refuted the second earlier attempt.
    //
    // A multi-position wrapper is therefore left unread, on purpose, and reported instead, so the
    // library never affirms a resource over a value it declined to read.
    const CLINICAL_ACTIVE = '"clinicalStatus":{"coding":[{"code":"active"}]}';

    it("reads a refuted verificationStatus through the wrapper", () => {
      const { resource } = parseResource(
        `{"resourceType":"AllergyIntolerance",${CLINICAL_ACTIVE},` +
          '"verificationStatus":{"coding":[{"code":["refuted"]}]}}',
      );
      expect(readSafety(resource).negations).toEqual(["refuted"]);
      expect(readSafety(resource).verificationStatus).toBe("refuted");
    });

    it("reads a recorded no-known-allergy through the wrapper", () => {
      // The sharpest of the three: read wrong, this is an allergy *to* 716186003 rather than a
      // recorded absence of allergy.
      const { resource } = parseResource(
        `{"resourceType":"AllergyIntolerance",${CLINICAL_ACTIVE},` +
          '"code":{"coding":[{"system":"http://snomed.info/sct","code":["716186003"]}]}}',
      );
      expect(readSafety(resource).noKnownAllergy).toBe(true);
      expect(readSafety(resource).negations).toEqual(["no-known-allergy"]);
    });

    it("reads a retraction in verificationStatus through the wrapper", () => {
      const { resource } = parseResource(
        '{"resourceType":"Condition","verificationStatus":{"coding":[{"code":["entered-in-error"]}]}}',
      );
      expect(isRetracted(resource)).toBe(true);
      expect(readSafety(resource).retracted).toBe(true);
      expect(validateResource(resource).issues.some((i) => i.code === "RETRACTED_RESOURCE")).toBe(
        true,
      );
    });

    it("reads it when both halves are wrapped, and when the element is wrapped too", () => {
      const { resource } = parseResource(
        '{"resourceType":"AllergyIntolerance","clinicalStatus":[{"coding":[{"code":["active"]}]}],' +
          '"code":{"coding":[{"system":["http://snomed.info/sct"],"code":["716186003"]}]}}',
      );
      expect(readSafety(resource).noKnownAllergy).toBe(true);
      expect(readSafety(resource).clinicalStatus).toBe("active");
    });

    it("never invents a (system, code) pair the sender did not write", () => {
      // The property that had to hold however this was closed. Neither system is paired with
      // `716186003` in any position the sender wrote, so `no-known-allergy` must not be claimed.
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

    it("counts positions, not values, on either side of the cross-product", () => {
      // A single written value does not make a two-position array single-valued, whichever side it
      // sits on. Both of these would pair (sct, 716186003) under a string-counting rule.
      const systemPadded = parseResource(
        `{"resourceType":"AllergyIntolerance",${CLINICAL_ACTIVE},` +
          '"code":{"coding":[{"system":[null,"http://snomed.info/sct"],"code":"716186003"}]}}',
      ).resource;
      expect(readSafety(systemPadded).noKnownAllergy).toBe(false);

      const codePadded = parseResource(
        `{"resourceType":"AllergyIntolerance",${CLINICAL_ACTIVE},` +
          '"code":{"coding":[{"system":"http://snomed.info/sct","code":[null,"716186003"]}]}}',
      ).resource;
      expect(readSafety(codePadded).noKnownAllergy).toBe(false);
    });

    it("reports the Coding it declined to read, so nothing is affirmed over it", () => {
      // The unread multi-position case must never come back `safeToSummarize: true`: a refutation
      // could be sitting in it, and the location is the only thing that says so.
      const { resource } = parseResource(
        `{"resourceType":"AllergyIntolerance",${CLINICAL_ACTIVE},` +
          '"verificationStatus":{"coding":[{"code":["refuted","confirmed"]}]}}',
      );
      const safety = readSafety(resource);

      expect(safety.negations).toEqual([]);
      expect(safety.safeToSummarize).toBe(false);
      expect(safety.arrayWrappedScalars).toEqual([
        "AllergyIntolerance.verificationStatus.coding[0].code",
      ]);
      expect(() => {
        assertSafeToSummarize(resource);
      }).toThrow(FhirSafetyError);
    });

    it("reports the wrapper it did read, too, and validates as an error", () => {
      const { resource } = parseResource(
        `{"resourceType":"AllergyIntolerance",${CLINICAL_ACTIVE},` +
          '"code":{"coding":[{"system":["http://snomed.info/sct"],"code":["716186003"]}]}}',
      );
      const safety = readSafety(resource);

      expect(safety.arrayWrappedScalars).toEqual([
        "AllergyIntolerance.code.coding[0].system",
        "AllergyIntolerance.code.coding[0].code",
      ]);
      expect(safety.safeToSummarize).toBe(false);

      const result = validateResource(resource);
      expect(result.valid).toBe(false);
      const wrapped = result.issues.filter((i) => i.code === "ARRAY_WRAPPED_SCALAR");
      expect(wrapped).toHaveLength(2);
      expect(wrapped.every((i) => i.severity === "error")).toBe(true);
    });

    it("reports one location per Coding however many members repeated the name", () => {
      const { resource } = parseResource(
        '{"resourceType":"Condition","verificationStatus":{"coding":[{"code":["a","b"],' +
          '"code":["c","d"]}]}}',
      );
      expect(readSafety(resource).arrayWrappedScalars).toEqual([
        "Condition.verificationStatus.coding[0].code",
      ]);
    });

    it("indexes each Coding of a CodeableConcept separately", () => {
      const { resource } = parseResource(
        '{"resourceType":"Condition","code":{"coding":[{"code":"synthetic-1"},' +
          '{"system":["http://example.org/local"],"code":["synthetic-2"]}]}}',
      );
      expect(readSafety(resource).arrayWrappedScalars).toEqual([
        "Condition.code.coding[1].system",
        "Condition.code.coding[1].code",
      ]);
    });

    it("is transparent: a wrapped Coding reads exactly as the unwrapped one does", () => {
      // The property the whole rule rests on. Unwrapping decides nothing on its own, it restores the
      // reading the sender's pre-conversion document had, so it can neither add a pair nor drop one.
      const pairs = [
        ['"system":"http://snomed.info/sct","code":"716186003"', "no-known-allergy"],
        ['"system":"http://snomed.info/sct","code":"227493005"', "an allergen"],
        ['"code":"refuted"', "a refutation"],
        ['"system":"http://example.org/local"', "a system with no code"],
      ] as const;

      for (const [inner] of pairs) {
        const bare =
          `{"resourceType":"AllergyIntolerance",${CLINICAL_ACTIVE},` +
          `"code":{"coding":[{${inner}}]},"verificationStatus":{"coding":[{${inner}}]}}`;
        // Wrap every scalar in the two Codings, exactly as a generic converter would.
        const wrapped = bare.replace(/"(system|code)":("[^"]*")/g, '"$1":[$2]');
        expect(wrapped).not.toBe(bare);

        const bareSafety = readSafety(parseResource(bare).resource);
        const wrappedSafety = readSafety(parseResource(wrapped).resource);

        expect(wrappedSafety.negations).toEqual(bareSafety.negations);
        expect(wrappedSafety.noKnownAllergy).toBe(bareSafety.noKnownAllergy);
        expect(wrappedSafety.retracted).toBe(bareSafety.retracted);
        expect(wrappedSafety.verificationStatus).toBe(bareSafety.verificationStatus);
      }
    });

    it("never turns an invalid document valid, even where it removes a finding", () => {
      // Reading the wrapper can retire a finding the unread version emitted, and in both of these the
      // retired finding was FALSE: the sender did write the code the invariant asked for. What must
      // never follow is a clean bill of health, and it cannot, because the wrapper that made the value
      // readable is itself an error on the same Coding.
      const ait1 = parseResource(
        '{"resourceType":"AllergyIntolerance","verificationStatus":{"coding":[{"system":' +
          '"http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",' +
          '"code":["entered-in-error"]}]}}',
      ).resource;
      const ait1Result = validateResource(ait1);
      expect(ait1Result.issues.some((i) => i.constraint === "ait-1")).toBe(false);
      expect(ait1Result.issues.some((i) => i.code === "ARRAY_WRAPPED_SCALAR")).toBe(true);
      expect(ait1Result.valid).toBe(false);

      const con4 = parseResource(
        '{"resourceType":"Condition","abatementBoolean":true,"clinicalStatus":{"coding":' +
          '[{"system":"http://terminology.hl7.org/CodeSystem/condition-clinical",' +
          '"code":["resolved"]}]}}',
      ).resource;
      const con4Result = validateResource(con4);
      expect(con4Result.issues.some((i) => i.constraint === "con-4")).toBe(false);
      expect(con4Result.issues.some((i) => i.code === "ARRAY_WRAPPED_SCALAR")).toBe(true);
      expect(con4Result.valid).toBe(false);
    });

    it("round-trips the wrapper rather than laundering it away", () => {
      const source =
        '{"resourceType":"Condition","verificationStatus":{"coding":[{"code":["entered-in-error"]}]}}';
      const rewritten = serializeResource(parseResource(source).resource);
      expect(rewritten).toBe(source);

      const reread = readSafety(parseResource(rewritten).resource);
      expect(reread.retracted).toBe(true);
      expect(reread.safeToSummarize).toBe(false);
    });

    it("does not read a Coding it does not report, so it cannot retire a true finding", () => {
      // THE REGRESSION THIS BLOCK EXISTS FOR. The read window and the report window must be the same
      // window. An earlier revision unwrapped inside `codingsOf` itself, which every coding consumer
      // in the library calls, while only reporting the elements below. `requiredUnitsFor` reads
      // `Observation.component[i].code`, a backbone element nobody reports, and takes the FIRST LOINC
      // coding that has a vital-signs units entry. Making the wrapped `8867-4` readable let it win
      // over the `8480-6` (systolic BP, requires `mm[Hg]`) written beside it, so a TRUE
      // VITAL_SIGN_UNIT_NONCONFORMANT error against a `/min` value disappeared and the document came
      // back `valid: true` with no diagnostic at all. Base refused it; a false valid is the one
      // direction the fail-safe contract forbids. All codes/values here are synthetic.
      const { resource } = parseResource(
        '{"resourceType":"Observation","status":"final",' +
          '"category":[{"coding":[{"system":"http://terminology.hl7.org/CodeSystem/observation-category",' +
          '"code":"vital-signs"}]}],' +
          '"code":{"coding":[{"system":"http://loinc.org","code":"85354-9"}]},' +
          '"component":[{"code":{"coding":[{"system":"http://loinc.org","code":["8867-4"]},' +
          '{"system":"http://loinc.org","code":"8480-6"}]},' +
          '"valueQuantity":{"value":72,"system":"http://unitsofmeasure.org","code":"/min"}}]}',
      );
      const result = validateResource(resource);

      expect(result.issues.some((i) => i.code === "VITAL_SIGN_UNIT_NONCONFORMANT")).toBe(true);
      expect(result.valid).toBe(false);
    });

    it("leaves every out-of-window coding read exactly as it was", () => {
      // The other half of the same rule, stated positively: `category`, `interpretation`,
      // `referenceRange.type` and `component.code` are not reported, so they are not read through a
      // wrapper either. Under-reading is the safe direction and it is the pre-existing behaviour;
      // widening it means widening the reporting rule first, in its own change.
      const { resource } = parseResource(
        '{"resourceType":"Observation","status":"final","interpretation":[{"coding":' +
          '[{"system":"http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",' +
          '"code":["H"]}]}]}',
      );
      expect(readInterpretations(resource)).toEqual([
        {
          system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
          code: undefined,
        },
      ]);
      expect(readSafety(resource).arrayWrappedScalars).toEqual([]);
    });

    it("treats a wrapper on a repeated name exactly as the unwrapped repeated name", () => {
      // Corollary of transparency, and the case worth stating outright because it is where a pair the
      // sender never wrote genuinely can appear. It appears identically WITHOUT any wrapper, so the
      // invention belongs to the repeated name (already an error, already `safeToSummarize: false`)
      // and the wrapper adds no new case. Pinned so a future widening of the unwrap cannot hide here.
      const inner = '"system":"http://example.org/local","system":"http://snomed.info/sct"';
      const wrapped = parseResource(
        `{"resourceType":"AllergyIntolerance","code":{"coding":[{${inner},` +
          '"code":["716186003"],"code":"227493005"}]}}',
      ).resource;
      const bare = parseResource(
        `{"resourceType":"AllergyIntolerance","code":{"coding":[{${inner},` +
          '"code":"716186003","code":"227493005"}]}}',
      ).resource;

      // Compared through `readSafety`, which is the windowed read path. `codingsOf` is the public,
      // unwindowed read and stays on its pre-existing behaviour by design (see the regression test
      // above), so it is not the surface this property is stated on.
      expect(readSafety(wrapped).noKnownAllergy).toBe(readSafety(bare).noKnownAllergy);
      expect(readSafety(wrapped).negations).toEqual(readSafety(bare).negations);
      expect(readSafety(wrapped).safeToSummarize).toBe(false);
      expect(validateResource(wrapped).valid).toBe(false);
    });

    it("does not read an empty array or a nested one, and reports both", () => {
      const empty = parseResource(
        '{"resourceType":"AllergyIntolerance","code":{"coding":[{"system":' +
          '"http://snomed.info/sct","code":[]}]}}',
      ).resource;
      expect(codingsOf(getProperty(empty, "code"))).toEqual([
        { system: "http://snomed.info/sct", code: undefined },
      ]);
      expect(readSafety(empty).arrayWrappedScalars).toEqual([
        "AllergyIntolerance.code.coding[0].code",
      ]);

      // The JSON reader still does not model a nested array, so the value is not recoverable. What
      // matters is the direction: refused, never affirmed, and now with the position named.
      const nested = parseResource(
        '{"resourceType":"AllergyIntolerance","code":{"coding":[{"system":' +
          '"http://snomed.info/sct","code":[["716186003"]]}]}}',
      ).resource;
      expect(readSafety(nested).noKnownAllergy).toBe(false);
      expect(readSafety(nested).safeToSummarize).toBe(false);
      expect(readSafety(nested).nestedArrays).toEqual([
        "AllergyIntolerance.code.coding[0].code[0]",
      ]);
    });

    it("addresses a bare Coding member and a contained resource correctly", () => {
      // `CodeableConcept.coding` is 0..*, so a bare object there is its own converter quirk; the
      // location has no index because there is no array to index into.
      const bareCoding = parseResource(
        '{"resourceType":"AllergyIntolerance","code":{"coding":{"system":' +
          '"http://snomed.info/sct","code":["716186003"]}}}',
      ).resource;
      expect(readSafety(bareCoding).noKnownAllergy).toBe(true);
      expect(readSafety(bareCoding).arrayWrappedScalars).toEqual([
        "AllergyIntolerance.code.coding.code",
      ]);

      const contained = parseResource(
        '{"resourceType":"Patient","contained":[{"resourceType":"Condition",' +
          '"verificationStatus":{"coding":[{"code":["entered-in-error"]}]}}]}',
      ).resource;
      expect(readSafety(contained).arrayWrappedScalars).toEqual([
        "Patient.contained[0].verificationStatus.coding[0].code",
      ]);
    });

    it("says nothing about a conformant Coding, or one outside a safety element", () => {
      const conformant = parseResource(
        '{"resourceType":"AllergyIntolerance","code":{"coding":[{"system":' +
          '"http://snomed.info/sct","code":"227493005"}]}}',
      ).resource;
      expect(readSafety(conformant).arrayWrappedScalars).toEqual([]);
      expect(readSafety(conformant).safeToSummarize).toBe(true);

      // `Observation.category` is 0..* and is not an element this layer reads a verdict out of, so
      // its codings are none of this rule's business.
      const elsewhere = parseResource(
        '{"resourceType":"Observation","status":"final","category":[{"coding":[{"code":["x"]}]}]}',
      ).resource;
      expect(readSafety(elsewhere).arrayWrappedScalars).toEqual([]);

      // …and `Questionnaire` is not a safety type at all, so its repeating `code` stays untouched.
      const questionnaire = parseResource(
        '{"resourceType":"Questionnaire","status":"active","code":[{"code":["synthetic-1"]}]}',
      ).resource;
      expect(readSafety(questionnaire).arrayWrappedScalars).toEqual([]);
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

  describe("on a type whose elements the validator now checks, the wrapper suppresses nothing", () => {
    // TWO REPORTS, TWO LAYERS, ONE ELEMENT. The wrapper report is the safety layer's and has always
    // fired for these types; what is new is that the validator has an element table for them, so the
    // element's OWN structural findings arrive beside it. The direction that would be a defect is
    // the wrapper standing in for them: a document whose `status` is both wrapped AND outside its
    // required binding must draw both, or reading the wrapper has quietly become a way to launder
    // the value inside it past every other check.

    it("reports the wrapper AND the out-of-binding code inside it, at their own locations", () => {
      const { resource } = parseResource(
        '{"resourceType":"MedicationStatement","status":["taken"],' +
          '"medicationCodeableConcept":{"text":"synthetic drug"},' +
          '"subject":{"reference":"Patient/synthetic-1"}}',
      );
      const result = validateResource(resource);

      // `taken` is the STU3 spelling R4 replaced, so it is a real value outside the R4 code set.
      expect(result.issues.map((i) => `${i.code} at ${i.expression}`)).toEqual([
        "CODE_INVALID at MedicationStatement.status[0]",
        "ARRAY_WRAPPED_SCALAR at MedicationStatement.status",
      ]);
      expect(result.valid).toBe(false);
      expect(readSafety(resource).arrayWrappedScalars).toEqual(["MedicationStatement.status"]);
      expect(readSafety(resource).safeToSummarize).toBe(false);
    });

    it("reports the wrapper AND the cardinality violation the wrapper itself creates", () => {
      // Two occurrences of a `1..1` element. The wrapper report answers "this is not how FHIR JSON
      // spells a singleton"; the cardinality finding answers "and there are two of them".
      const { resource } = parseResource(
        '{"resourceType":"Immunization","status":["completed","not-done"],' +
          '"vaccineCode":{"text":"synthetic vaccine"},"patient":{"reference":"Patient/synthetic-1"},' +
          '"occurrenceDateTime":"2026-01-01"}',
      );
      const result = validateResource(resource);

      expect(result.issues.map((i) => `${i.code} at ${i.expression}`)).toContain(
        "CARDINALITY_MAX at Immunization.status",
      );
      expect(result.issues.map((i) => `${i.code} at ${i.expression}`)).toContain(
        "ARRAY_WRAPPED_SCALAR at Immunization.status",
      );
      // …and the negation written inside the wrapper is still read, which is the whole point of
      // reading through it rather than past it.
      expect(readSafety(resource).negations).toContain("not-done");
      expect(result.valid).toBe(false);
    });

    it("still reports the wrapper on a value that is otherwise perfectly conformant", () => {
      // The wrapper is a finding in its own right: nothing about the value excuses it.
      const { resource } = parseResource(
        '{"resourceType":"DiagnosticReport","status":["final"],"code":{"text":"synthetic panel"}}',
      );
      const result = validateResource(resource);

      expect(result.issues.map((i) => `${i.code} at ${i.expression}`)).toEqual([
        "ARRAY_WRAPPED_SCALAR at DiagnosticReport.status",
      ]);
      expect(result.valid).toBe(false);
    });

    it("draws neither finding on the same three documents written the conformant way", () => {
      // The control. Without it the three rows above could be passing on the element table alone.
      for (const json of [
        '{"resourceType":"MedicationStatement","status":"completed",' +
          '"medicationCodeableConcept":{"text":"synthetic drug"},' +
          '"subject":{"reference":"Patient/synthetic-1"}}',
        '{"resourceType":"Immunization","status":"completed",' +
          '"vaccineCode":{"text":"synthetic vaccine"},"patient":{"reference":"Patient/synthetic-1"},' +
          '"occurrenceDateTime":"2026-01-01"}',
        '{"resourceType":"DiagnosticReport","status":"final","code":{"text":"synthetic panel"}}',
      ]) {
        const { resource } = parseResource(json);
        expect(validateResource(resource).issues, json).toEqual([]);
        expect(readSafety(resource).arrayWrappedScalars, json).toEqual([]);
      }
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
      // The duplicate-key route used to launder: the writer emitted one member per name, so the
      // survivor was conformant and the re-read clean. That is closed (both writers refuse). The
      // array route never laundered here, because the model keeps the list and the writer emits it
      // back. Pinned so a future writer change cannot quietly introduce that laundering.
      const { resource } = parseResource(REPORTED);
      const rewritten = serializeResource(resource);
      expect(rewritten).toBe(REPORTED);

      const reread = readSafety(parseResource(rewritten).resource);
      expect(reread.retracted).toBe(true);
      expect(reread.safeToSummarize).toBe(false);
    });

    /**
     * THE OTHER FORMAT USED TO LAUNDER IT. IT IS NOW REFUSED, AND THIS IS WHAT IT USED TO DO.
     *
     * The test above pins the JSON route staying honest. The XML route did not: FHIR XML spells a
     * repeat by repeating the element (xml.html) and carries no other mark for one, so a wrapper of
     * fewer than two items emitted at most one element and the encoding complaint had nowhere to go.
     * Measured at `8a91d29`, base: this document emitted
     * `<Observation xmlns="http://hl7.org/fhir"><status value="entered-in-error"/></Observation>`,
     * which re-read with an **empty issue list**, `arrayWrappedScalars: []`, `safeToSummarize: true`
     * and `valid: true`.
     *
     * The clinical content did survive that trip, which is what made it the narrower laundering of
     * the two: the retraction read `true` on both sides. What vanished was the refusal to affirm
     * over a document nobody can read unambiguously.
     *
     * Closed by `UNSERIALIZABLE_ARRAY_WRAPPER` (`xml-array-wrapper.test.ts` owns the predicate). What
     * this asserts is the boundary: the JSON route is unchanged and still hands the wrapper back.
     */
    it("no longer launders it across the format boundary: the XML writer refuses", () => {
      const { resource } = parseResource(REPORTED);
      const before = readSafety(resource);
      expect(before.arrayWrappedScalars).toEqual(["Observation.status"]);
      expect(before.safeToSummarize).toBe(false);
      expect(validateResource(resource).valid).toBe(false);

      let err: unknown;
      try {
        serializeResourceXml(resource);
      } catch (caught) {
        err = caught;
      }
      expect(err).toBeInstanceOf(FhirSerializeError);
      expect(err).toMatchObject({
        code: "UNSERIALIZABLE_ARRAY_WRAPPER",
        locations: ["Observation.status"],
      });

      // The route that stays open, asserted rather than promised: JSON writes the wrapper back and
      // the re-read reproduces every finding, including the retraction the XML trip used to keep.
      expect(serializeResource(resource)).toBe(REPORTED);
      const back = readSafety(parseResource(serializeResource(resource)).resource);
      expect(back.arrayWrappedScalars).toEqual(["Observation.status"]);
      expect(back.safeToSummarize).toBe(false);
      expect(back.retracted).toBe(true);
      expect(isRetracted(resource)).toBe(true);
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

      // …and the write-path refusal is scoped to the same window, so this wrapper is written out and
      // still launders. Stated as the fact it is: the refusal took its cardinality from this layer
      // rather than growing a per-resource model, so it inherits exactly this bound.
      expect(serializeResourceXml(resource)).toBe(
        '<Observation xmlns="http://hl7.org/fhir"><status value="final"/>' +
          '<valueQuantity><value value="5"/><system value="http://unitsofmeasure.org"/>' +
          '<code value="mg"/></valueQuantity></Observation>',
      );
    });
  });
});
