import { describe, expect, it } from "vitest";

import {
  assertSafeToSummarize,
  FhirCodecError,
  codeOf,
  codingsOf,
  FhirSafetyError,
  getProperty,
  hasCodeAnySystem,
  hasCoding,
  isList,
  isRetracted,
  nestedArrays,
  parseResource,
  readSafety,
  serializeResource,
  validateResource,
} from "../src/index.js";

/**
 * A JSON array holding another array (`[["x"]]`).
 *
 * FHIR JSON uses an array for exactly one thing, a repeating element, and the array's items are that
 * element's occurrences (json.html §2.6.2.2). An array of arrays therefore describes no element, and
 * R4 defines none whose occurrences are arrays.
 *
 * The defect this closes was **data loss**, in the package whose P1 acceptance claim is that a read
 * loses nothing. The reader coerced the inner array to an empty complex, so `[["x"]]` became one
 * empty element and `"x"` was simply gone, and the only trace was an `UNKNOWN_PROPERTY` warning,
 * which says a property was unexpected and *not* that anything was dropped. Three consequences,
 * measured on the base commit and pinned below:
 *
 * 1. A negation written one array deep was invisible. `{"resourceType":"Condition",
 *    "clinicalStatus":{"coding":[[{"system":"…condition-clinical","code":"resolved"}]]}}` read
 *    `negations: []`, `valid: true`, `safeToSummarize: true` -- affirmed, not refused. The prose in
 *    `CLAUDE.md` claimed such a document was "at least refused, never affirmed"; that held only for
 *    the closed `SAFETY_SCALAR_ELEMENTS` set, and not one level down inside a `CodeableConcept`.
 * 2. Rewriting the model emitted `[{}]`, so a read -> write -> read cycle produced a **clean**
 *    document: the warning itself was laundered away, and an empty `Coding` / `HumanName` /
 *    `Bundle.entry` the sender never wrote was fabricated in its place.
 * 3. The `_`-sibling route dropped its slot with **no diagnostic at all**.
 *
 * The remedy is preserve-and-refuse, not preserve-and-interpret. The inner array is modeled as a
 * nested `FhirList` (the model already allowed one; only the reader never produced one), so nothing
 * is lost and the document round-trips byte-for-byte. Nothing reads a *value* out of it: it is
 * reported as `NESTED_ARRAY` on both channels and the resource is never `safeToSummarize`.
 *
 * The property that guards the direction is in the last block: **no coding read gains a value or a
 * pair.** That is the lesson `FHIR-CODING-SCALAR-WRAPPER` was refuted for on its first pass, where a
 * newly-readable code won a first-match race and retired a true finding.
 */
describe("a nested array (FHIR-NESTED-ARRAY-DATA-LOSS)", () => {
  describe("the inner value survives", () => {
    it("keeps a complex the inner array held, instead of reading an empty element", () => {
      const { resource, issues } = parseResource(
        '{"resourceType":"Patient","name":[[{"family":"Roe"}]]}',
      );
      expect(issues.map((i) => i.code)).toEqual(["NESTED_ARRAY"]);
      expect(issues[0]?.expression).toBe("Patient.name[0]");

      const name = getProperty(resource, "name");
      expect(name !== undefined && isList(name)).toBe(true);
      // The value is reachable: a list holding a list holding the HumanName.
      expect(serializeResource(resource)).toBe(
        '{"resourceType":"Patient","name":[[{"family":"Roe"}]]}',
      );
    });

    it("keeps a scalar the inner array held (the item's own example)", () => {
      const { resource } = parseResource('{"resourceType":"Patient","birthDate":[["1980-01-01"]]}');
      expect(serializeResource(resource)).toBe(
        '{"resourceType":"Patient","birthDate":[["1980-01-01"]]}',
      );
    });

    it("keeps a nested array beside a real primitive, and both sides of the alignment", () => {
      // The mixed shape: the first position is a genuine repeating primitive, the second a nested
      // array. Before, the second read as a value-absent slot and `"B"` was gone.
      const { resource } = parseResource('{"resourceType":"Patient","given":["A",["B"]]}');
      expect(serializeResource(resource)).toBe('{"resourceType":"Patient","given":["A",["B"]]}');
    });

    it("keeps an arbitrarily deep nesting, reporting each level", () => {
      const { resource, issues } = parseResource(
        '{"resourceType":"Patient","name":[[[{"family":"Roe"}]]]}',
      );
      expect(issues.map((i) => i.expression)).toEqual(["Patient.name[0]", "Patient.name[0][0]"]);
      expect(serializeResource(resource)).toBe(
        '{"resourceType":"Patient","name":[[[{"family":"Roe"}]]]}',
      );
    });

    it("keeps a whole resource a nested Bundle entry held", () => {
      // The widest shape measured: an entire retracted Observation vanished from the model, and the
      // Bundle read `valid: true`, `safeToSummarize: true`.
      const json =
        '{"resourceType":"Bundle","type":"collection","entry":[[{"resource":' +
        '{"resourceType":"Observation","status":"entered-in-error"}}]]}';
      const { resource } = parseResource(json);
      expect(serializeResource(resource)).toBe(json);
      expect(readSafety(resource).nestedArrays).toEqual(["Bundle.entry[0]"]);
      expect(validateResource(resource).valid).toBe(false);
    });

    it("keeps an empty inner array as an empty nested list", () => {
      const { resource } = parseResource('{"resourceType":"Patient","name":[[]]}');
      expect(serializeResource(resource)).toBe('{"resourceType":"Patient","name":[[]]}');
    });
  });

  describe("the finding survives a round trip", () => {
    // Distinct from the duplicate-key laundering, which is a decision about which member the writer
    // emits. Here the model itself had lost the content, so the rewritten document was genuinely
    // clean and a re-read had nothing to find.
    const documents = [
      '{"resourceType":"Patient","name":[[{"family":"Roe"}]]}',
      '{"resourceType":"Observation","status":[["entered-in-error"]]}',
      '{"resourceType":"Patient","given":["A",["B"]]}',
      '{"resourceType":"Condition","clinicalStatus":{"coding":[[{"system":' +
        '"http://terminology.hl7.org/CodeSystem/condition-clinical","code":"resolved"}]]}}',
    ];

    it.each(documents)("re-reads to the same model and the same finding: %s", (json) => {
      const first = parseResource(json);
      const rewritten = serializeResource(first.resource);
      expect(rewritten).toBe(json);

      const second = parseResource(rewritten);
      expect(second.issues).toEqual(first.issues);
      expect(readSafety(second.resource).nestedArrays).toEqual(
        readSafety(first.resource).nestedArrays,
      );
      expect(validateResource(second.resource).valid).toBe(false);
    });
  });

  describe("the document is refused, on every channel", () => {
    it("refuses a negation written one array deep inside a CodeableConcept", () => {
      // The measured affirm-over-loss: `valid: true`, `safeToSummarize: true`, no negation, and one
      // UNKNOWN_PROPERTY warning that did not say the code had been dropped.
      const { resource } = parseResource(
        '{"resourceType":"Condition","clinicalStatus":{"coding":[[{"system":' +
          '"http://terminology.hl7.org/CodeSystem/condition-clinical","code":"resolved"}]]}}',
      );
      const safety = readSafety(resource);
      expect(safety.safeToSummarize).toBe(false);
      expect(safety.nestedArrays).toEqual(["Condition.clinicalStatus.coding[0]"]);

      const result = validateResource(resource);
      expect(result.valid).toBe(false);
      expect(result.issues.map((i) => i.code)).toContain("NESTED_ARRAY");
      expect(() => {
        assertSafeToSummarize(resource);
      }).toThrow(FhirSafetyError);
    });

    it("refuses a refuted allergy written one array deep", () => {
      const { resource } = parseResource(
        '{"resourceType":"AllergyIntolerance","verificationStatus":{"coding":[[{"system":' +
          '"http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",' +
          '"code":"refuted"}]]}}',
      );
      expect(readSafety(resource).safeToSummarize).toBe(false);
      expect(validateResource(resource).valid).toBe(false);
    });

    it("reads a retraction the nested array held, which is the add-only direction", () => {
      // `primitiveStrings` is the recursive fail-safe read, so a nested array is reached. It can only
      // ADD a negation: every membership test it feeds asks "is this code present".
      const { resource } = parseResource(
        '{"resourceType":"Observation","status":[["entered-in-error"]]}',
      );
      expect(isRetracted(resource)).toBe(true);
      expect(readSafety(resource).negations).toEqual(["entered-in-error"]);
      expect(readSafety(resource).safeToSummarize).toBe(false);
    });

    it("carries a value-free location and never the value", () => {
      const { resource, issues } = parseResource(
        '{"resourceType":"Patient","name":[[{"family":"Roe","given":["Sam"]}]]}',
      );
      const text = JSON.stringify([
        issues,
        validateResource(resource).issues,
        readSafety(resource),
      ]);
      expect(text).not.toContain("Roe");
      expect(text).not.toContain("Sam");
    });

    it("reports at any depth and on any resource type, with no cardinality table", () => {
      // Unlike ARRAY_WRAPPED_SCALAR this needs neither an element name nor a type gate: no
      // conformant document contains a nested array anywhere, so it cannot false-positive.
      const { resource } = parseResource(
        '{"resourceType":"Questionnaire","item":[{"code":[[{"system":"http://example.org/local",' +
          '"code":"q1"}]]}]}',
      );
      expect(nestedArrays(resource, "Questionnaire")).toEqual(["Questionnaire.item[0].code[0]"]);
    });
  });

  describe("no conformant document is affected", () => {
    const conformant = [
      '{"resourceType":"Patient","name":[{"family":"Roe"},{"family":"Doe"}],"given":["A","B"]}',
      '{"resourceType":"Patient","given":["A",null],"_given":[null,{"id":"x"}]}',
      '{"resourceType":"Questionnaire","code":[{"system":"http://example.org/local","code":"q1"}]}',
      '{"resourceType":"Observation","status":"final","component":[{"code":{"coding":[' +
        '{"system":"http://loinc.org","code":"8480-6"}]}}]}',
    ];

    it.each(conformant)("draws no finding and round-trips unchanged: %s", (json) => {
      const { resource, issues } = parseResource(json);
      expect(issues.filter((i) => i.code === "NESTED_ARRAY")).toEqual([]);
      expect(readSafety(resource).nestedArrays).toEqual([]);
      expect(validateResource(resource).issues.filter((i) => i.code === "NESTED_ARRAY")).toEqual(
        [],
      );
      expect(serializeResource(resource)).toBe(json);
    });
  });

  describe("what is read did not widen", () => {
    // The property that keeps this slice safe, and the one FHIR-CODING-SCALAR-WRAPPER was refuted
    // for breaking on its first pass: modeling the nested array must not make a clinical code
    // READABLE, because a newly-readable code can win a first-match race and retire a true finding.
    // Measured across the shipped fixture corpus and 3,000 generated documents: no coding read gained
    // a value or a pair, no document went `valid: false -> true`, no negation was lost, and no
    // `safeToSummarize: false` was weakened.
    it("reads no Coding out of a nested array", () => {
      const { resource } = parseResource(
        '{"resourceType":"AllergyIntolerance","code":{"coding":[[{"system":' +
          '"http://snomed.info/sct","code":"716186003"}]]}}',
      );
      const code = getProperty(resource, "code");
      // Not one phantom `{ system: undefined, code: undefined }` either: the base commit
      // manufactured exactly that from the empty complex it coerced the inner array into.
      expect(codingsOf(code)).toEqual([]);
      expect(codeOf(code)).toBeUndefined();
      expect(hasCoding(code, "http://snomed.info/sct", "716186003")).toBe(false);
      expect(hasCodeAnySystem(code, "716186003")).toBe(false);
      expect(readSafety(resource).noKnownAllergy).toBe(false);
    });

    it("refuses a nested array in Coding.system / Coding.code however few positions it holds", () => {
      // `codingScalar` reads a single-position WRAPPER, because a converter emits one and reading it
      // restores the sender's own pre-conversion reading. Nothing emits `[["716186003"]]`, so there
      // is no reading to restore, and resolving one would assert SNOMED 716186003 "no known allergy"
      // -- a POSITIVE clinical claim -- out of a shape FHIR gives no meaning.
      const { resource } = parseResource(
        '{"resourceType":"AllergyIntolerance","code":{"coding":[{"system":[["http://snomed.info/sct"]],' +
          '"code":[["716186003"]]}]}}',
      );
      expect(readSafety(resource).noKnownAllergy).toBe(false);
      expect(readSafety(resource).safeToSummarize).toBe(false);
      expect(validateResource(resource).valid).toBe(false);
    });

    it("does not let a nested LOINC code beat the one beside it, at EITHER level", () => {
      // The regression shape from FHIR-CODING-SCALAR-WRAPPER pass one: `requiredUnitsFor` takes the
      // FIRST LOINC coding carrying a vital-signs units entry, so a newly-readable heart-rate `8867-4`
      // (required `/min`) displaces the systolic-BP `8480-6` beside it and the true
      // VITAL_SIGN_UNIT_NONCONFORMANT error disappears.
      //
      // BOTH levels are pinned, because a draft of this slice guarded only the inner one. Wrapping
      // `Coding.code` is caught by `codingScalar`; wrapping the `CodeableConcept` ELEMENT is caught by
      // `collectCodings`, and that is the one a nested array actually reaches, since `collectCodings`
      // flattens a repeating element and so recursed straight through it.
      const unitOf = (json: string): unknown =>
        validateResource(parseResource(json).resource)
          .issues.filter((i) => i.code !== "NESTED_ARRAY")
          .map((i) => `${i.code}@${i.expression}`);

      const tail =
        '"valueQuantity":{"value":72,"system":"http://unitsofmeasure.org","code":"/min"}}]}';
      const head =
        '{"resourceType":"Observation","status":"final","category":[{"coding":[{"system":' +
        '"http://terminology.hl7.org/CodeSystem/observation-category","code":"vital-signs"}]}],' +
        '"component":[{"code":';
      const bp = '{"coding":[{"system":"http://loinc.org","code":"8480-6"}]}';
      const hr = '{"coding":[{"system":"http://loinc.org","code":"8867-4"}]}';

      // The reference reading: only the systolic-BP coding is present, and `/min` is wrong for it.
      const expected = unitOf(`${head}${bp},${tail}`);
      expect(expected).toContain(
        "VITAL_SIGN_UNIT_NONCONFORMANT@Observation.component[0].valueQuantity",
      );

      // Element-level nesting: the nested heart-rate concept must decide nothing.
      expect(unitOf(`${head}[[${hr}],${bp}],${tail}`)).toEqual(expected);
      // Inner nesting, on Coding.code.
      const hrInner = '{"coding":[{"system":"http://loinc.org","code":[["8867-4"]]}]}';
      expect(unitOf(`${head}[${hrInner},${bp}],${tail}`)).toEqual(expected);
    });

    it("does not resolve a no-known-allergy code out of a nested CodeableConcept element", () => {
      // The direction the item names as NOT safe: SNOMED 716186003 is a recorded "no known allergy",
      // a POSITIVE clinical assertion, and here it would be asserted over a record naming peanut.
      const { resource } = parseResource(
        '{"resourceType":"AllergyIntolerance","code":[[{"coding":[{"system":' +
          '"http://snomed.info/sct","code":"716186003"}]}]],"reaction":[{"substance":' +
          '{"text":"peanut"},"manifestation":[{"text":"anaphylaxis"}]}]}',
      );
      const safety = readSafety(resource);
      expect(safety.noKnownAllergy).toBe(false);
      expect(safety.negations).toEqual([]);
      expect(safety.safeToSummarize).toBe(false);
      expect(codingsOf(getProperty(resource, "code"))).toEqual([]);
    });
  });

  describe("what the reader still cannot model, reported rather than silent", () => {
    // A primitive's `_`-sibling is an R4 `Element` (`id` / `extension` only), so there is nowhere on
    // the model to put an array or a scalar written in its place. These used to vanish with NO
    // diagnostic at all, which is the exact failure mode this item is about; they are now located.
    it("flags a nested array written as a primitive's _-sibling slot", () => {
      const { issues } = parseResource(
        '{"resourceType":"Patient","birthDate":["1980"],"_birthDate":[[{"id":"x"}]]}',
      );
      expect(issues.map((i) => `${i.code}@${i.expression}`)).toEqual([
        "NESTED_ARRAY@Patient.birthDate[0]",
      ]);
    });

    it("flags a scalar written as a primitive's _-sibling slot", () => {
      const { issues } = parseResource(
        '{"resourceType":"Patient","birthDate":["1980"],"_birthDate":["oops"]}',
      );
      expect(issues.map((i) => `${i.code}@${i.expression}`)).toEqual([
        "UNKNOWN_PROPERTY@Patient.birthDate[0]",
      ]);
    });

    it("fails closed when a nested-array position also carries _-sibling metadata", () => {
      // Neither half can be kept: a nested list is not a primitive, so it cannot carry the R4
      // `Element`, and dropping the `Element` would lose a `data-absent-reason` the sender wrote. The
      // reader refuses, exactly as it does for a value/_-sibling length disagreement, rather than
      // trade one loss for another in a slice about data loss.
      expect(() =>
        parseResource(
          '{"resourceType":"Patient","given":["A",["B"]],"_given":[{"id":"x"},{"extension":' +
            '[{"url":"http://hl7.org/fhir/StructureDefinition/data-absent-reason",' +
            '"valueCode":"masked"}]}]}',
        ),
      ).toThrow(FhirCodecError);
    });

    it("reads a nested-array position whose _-sibling slot is the conformant null marker", () => {
      // `null` is the no-metadata marker, not a disagreement, so nothing is lost and nothing throws.
      const { resource } = parseResource(
        '{"resourceType":"Patient","given":["A",["B"]],"_given":[{"id":"x"},null]}',
      );
      expect(serializeResource(resource)).toBe(
        '{"resourceType":"Patient","given":["A",["B"]],"_given":[{"id":"x"},null]}',
      );
    });

    it("flags a nested array inside an extension list", () => {
      // `PrimitiveMeta.extension` is `readonly FhirComplex[]`, so a nested list cannot go there
      // without a public type change. Reported, not silent.
      const { issues } = parseResource(
        '{"resourceType":"Patient","birthDate":"1980","_birthDate":{"extension":[[{"url":"u"}]]}}',
      );
      expect(issues.map((i) => i.code)).toEqual(["NESTED_ARRAY"]);
    });
  });
});
