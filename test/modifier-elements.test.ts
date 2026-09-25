/**
 * Modifier ELEMENTS on the safety readout, the JSON read path.
 *
 * R4 flags several ordinary base elements `Is Modifier: true`, and until this channel existed the
 * safety spine was blind to every one of them: `{"valueQuantity":{"value":0.01,"comparator":"<"}}`
 * came back `safeToSummarize: true`, so a caller doing exactly what the readout tells it to do was
 * handed `0.01 mg` for a value the sender wrote as `< 0.01 mg`.
 *
 * What is pinned here, in the order the criteria run:
 *
 *  - the four elements this channel reports, each present / absent / malformed / at more than one
 *    location;
 *  - the recognition predicate, one assertion per named input, because a predicate nobody tested is
 *    a predicate nobody picked;
 *  - the location rules, which are the PHI-bearing half: what a segment may echo, what a root may
 *    echo, and that neither carries a value;
 *  - the non-regression bars, which are the other half of "reporting only": the modifier-EXTENSION
 *    channel, the existing findings and `valid` are all untouched;
 *  - the declared non-reach residuals, pinned as characterization tests so that closing one has to
 *    red a test here in the same change.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  assertSafeToSummarize,
  FhirSafetyError,
  MODIFIER_ELEMENT_ROOT_TYPES,
  modifierElements,
  parseResource,
  readSafety,
  validateResource,
  WITHHELD,
  type ModifierElementReport,
  type SafetyReadout,
} from "../src/index.js";

/** The readout for a JSON document. */
function safetyOf(json: string): SafetyReadout {
  return readSafety(parseResource(json).resource);
}

/** The reported modifier elements for a JSON document. */
function reportsOf(json: string): readonly ModifierElementReport[] {
  return safetyOf(json).modifierElements;
}

/**
 * The `code/severity at location` triples the validator emits, the base pin's finding set.
 *
 * Joined with ` at ` rather than an `@`, deliberately: this package spells a diagnostic
 * `IssueCode@FHIRPath`, which no email recogniser can tell from an address by shape, and the PHI
 * gate's remedy for that collision is a declared domain per FHIRPath root. Not writing the shape
 * costs nothing here and keeps that declaration list from growing by a dozen entries.
 */
function findingsOf(json: string): string[] {
  const result = validateResource(parseResource(json).resource);
  return result.issues.map((issue) => `${issue.code}/${issue.severity} at ${issue.expression}`);
}

/** A patient identity written where a name is not a value: the shape a real leak takes. */
const FORGED_KEY = "DOE-JOHN-1970-01-01-MRN-8891";

describe("Quantity.comparator is reported wherever the walk reaches it, and lowers the verdict", () => {
  it("reports a comparator on an Observation value, with the element and its location", () => {
    const safety = safetyOf(
      '{"resourceType":"Observation","status":"final",' +
        '"valueQuantity":{"value":0.01,"comparator":"<","unit":"mg"}}',
    );

    expect(safety.modifierElements).toEqual([
      { element: "comparator", location: "Observation.valueQuantity.comparator" },
    ]);
    expect(safety.safeToSummarize).toBe(false);
  });

  it("reports a comparator under an element US Core does not name, on an unmodeled type", () => {
    // The inherited bar is "anywhere the safety walk reaches", not "under Observation.value[x]".
    const safety = safetyOf(
      '{"resourceType":"MedicationRequest","dosageInstruction":[{"doseAndRate":' +
        '[{"doseQuantity":{"value":0.01,"comparator":"<","unit":"mg"}}]}]}',
    );

    expect(safety.modifierElements).toEqual([
      {
        element: "comparator",
        location: "MedicationRequest.dosageInstruction[0].doseAndRate[0].doseQuantity.comparator",
      },
    ]);
    expect(safety.safeToSummarize).toBe(false);
  });

  it("THE WORKED CASE IS NOT VACUOUS: the dose comparator carries no value, unit or code", () => {
    // A bounded dose invisible to the readout is the exact hazard this channel exists to close, so
    // this document is a decided outcome and not a residual anyone may record.
    const json =
      '{"resourceType":"MedicationRequest","dosageInstruction":[{"doseAndRate":' +
      '[{"doseQuantity":{"value":0.01,"comparator":"<","unit":"mg"}}]}]}';
    const safety = safetyOf(json);
    const serialized = JSON.stringify(safety.modifierElements);

    expect(safety.modifierElements).toHaveLength(1);
    expect(serialized).not.toContain("0.01");
    expect(serialized).not.toContain("mg");
    expect(serialized).not.toContain("<");
    // The validator's findings for this document. `MedicationRequest` has a built-in element table
    // now, so the informational not-modeled note is gone and the four direct elements R4 makes
    // mandatory are reported absent instead. NONE of them is about the comparator: the modifier
    // element the readout reports is still invisible to the validator, which is the asymmetry this
    // channel exists to close and the reason the readout carries it.
    expect(findingsOf(json)).toEqual([
      "CARDINALITY_MIN/error at MedicationRequest.status",
      "CARDINALITY_MIN/error at MedicationRequest.intent",
      "CARDINALITY_MIN/error at MedicationRequest.medication[x]",
      "CARDINALITY_MIN/error at MedicationRequest.subject",
    ]);
    expect(validateResource(parseResource(json).resource).valid).toBe(false);
  });

  it("draws nothing on the same document with no comparator written", () => {
    const safety = safetyOf(
      '{"resourceType":"MedicationRequest","dosageInstruction":[{"doseAndRate":' +
        '[{"doseQuantity":{"value":0.01,"unit":"mg"}}]}]}',
    );

    expect(safety.modifierElements).toEqual([]);
    expect(safety.safeToSummarize).toBe(true);
  });

  it("reports a comparator inside a contained resource and inside a Bundle entry", () => {
    expect(
      reportsOf(
        '{"resourceType":"Observation","status":"final","contained":' +
          '[{"resourceType":"Observation","valueQuantity":{"comparator":">="}}]}',
      ),
    ).toEqual([
      { element: "comparator", location: "Observation.contained[0].valueQuantity.comparator" },
    ]);
    expect(
      reportsOf(
        '{"resourceType":"Bundle","type":"collection","entry":[{"resource":' +
          '{"resourceType":"Observation","valueQuantity":{"comparator":">="}}}]}',
      ),
    ).toEqual([
      {
        element: "comparator",
        location: "Bundle.entry[0].resource.valueQuantity.comparator",
      },
    ]);
  });
});

describe("implicitRules is reported as an unhandled modifier, on the element channel", () => {
  it("reports implicitRules at the resource root and lowers the verdict", () => {
    const safety = safetyOf(
      '{"resourceType":"Patient","implicitRules":"http://ehr.example.org/ig/x"}',
    );

    expect(safety.modifierElements).toEqual([
      { element: "implicitRules", location: "Patient.implicitRules" },
    ]);
    expect(safety.safeToSummarize).toBe(false);
  });

  it("does NOT add it to the modifier-EXTENSION channel: the class is named, the channel is chosen", () => {
    const safety = safetyOf(
      '{"resourceType":"Patient","implicitRules":"http://ehr.example.org/ig/x"}',
    );

    expect(safety.unhandledModifierExtensions).toEqual([]);
  });

  it("reports it on a nested resource root too", () => {
    expect(
      reportsOf(
        '{"resourceType":"Patient","contained":[{"resourceType":"Observation",' +
          '"implicitRules":"http://ehr.example.org/ig/x"}]}',
      ),
    ).toEqual([{ element: "implicitRules", location: "Patient.contained[0].implicitRules" }]);
  });

  it("draws nothing when it is absent", () => {
    expect(reportsOf('{"resourceType":"Patient","gender":"male"}')).toEqual([]);
  });
});

describe("Patient.active is reported, at any value and at no other type", () => {
  it("reports active: true, active: false and a value of the wrong JSON type alike", () => {
    for (const written of ["true", "false", '"yes"', "null", '{"value":true}', "[true]"]) {
      const safety = safetyOf(`{"resourceType":"Patient","active":${written}}`);

      expect(safety.modifierElements, `active written as ${written}`).toEqual([
        { element: "active", location: "Patient.active" },
      ]);
      expect(safety.safeToSummarize).toBe(false);
    }
  });

  it("reports it from the underscore form alone, with no value sibling", () => {
    // `{"active":null,"_active":{…}}` read as "absent" would return a clean verdict over a document
    // that carries the modifier. Presence of the key is the trigger, in either spelling.
    expect(
      reportsOf(
        '{"resourceType":"Patient","_active":{"extension":[{"url":"http://x","valueCode":"masked"}]}}',
      ),
    ).toEqual([{ element: "active", location: "Patient.active" }]);
  });

  it("reports a Patient inside a Bundle entry and inside contained", () => {
    expect(
      reportsOf(
        '{"resourceType":"Bundle","type":"collection","entry":' +
          '[{"resource":{"resourceType":"Patient","active":false}}]}',
      ),
    ).toEqual([{ element: "active", location: "Bundle.entry[0].resource.active" }]);
    expect(
      reportsOf(
        '{"resourceType":"Observation","status":"final","contained":' +
          '[{"resourceType":"Patient","active":true}]}',
      ),
    ).toEqual([{ element: "active", location: "Observation.contained[0].active" }]);
  });

  it("draws nothing for `active` anywhere but a Patient ROOT", () => {
    // Path-gated, exactly where US Core names it and nowhere else. Widening this would begin the
    // general per-element table this channel defers.
    expect(reportsOf('{"resourceType":"Patient","contact":[{"active":true}]}')).toEqual([]);
    expect(reportsOf('{"resourceType":"Encounter","active":true}')).toEqual([]);
    expect(reportsOf('{"resourceType":"Patient","gender":"male"}')).toEqual([]);
  });
});

describe("Practitioner.identifier.use is reported, at any array position and at no other type", () => {
  it("reports use on the first identifier entry", () => {
    const safety = safetyOf(
      '{"resourceType":"Practitioner","identifier":[{"use":"official","value":"X"}]}',
    );

    expect(safety.modifierElements).toEqual([
      { element: "use", location: "Practitioner.identifier[0].use" },
    ]);
    expect(safety.safeToSummarize).toBe(false);
  });

  it("reports use at a later array position, and once per entry that carries one", () => {
    expect(
      reportsOf(
        '{"resourceType":"Practitioner","identifier":[{"value":"a"},{"use":"usual","value":"b"}]}',
      ),
    ).toEqual([{ element: "use", location: "Practitioner.identifier[1].use" }]);
    expect(
      reportsOf(
        '{"resourceType":"Practitioner","identifier":' +
          '[{"use":"official"},{"value":"b"},{"use":"usual"}]}',
      ),
    ).toEqual([
      { element: "use", location: "Practitioner.identifier[0].use" },
      { element: "use", location: "Practitioner.identifier[2].use" },
    ]);
  });

  it("reports an unreadable use: an object, a number, a null, and the underscore form alone", () => {
    for (const written of ['{"x":1}', "5", "null", '"notinthevalueset"']) {
      expect(
        reportsOf(`{"resourceType":"Practitioner","identifier":[{"use":${written}}]}`),
        `use written as ${written}`,
      ).toEqual([{ element: "use", location: "Practitioner.identifier[0].use" }]);
    }
    expect(
      reportsOf('{"resourceType":"Practitioner","identifier":[{"_use":{"id":"u1"}}]}'),
    ).toEqual([{ element: "use", location: "Practitioner.identifier[0].use" }]);
  });

  it("draws nothing for `use` on any other type, or off `identifier`", () => {
    expect(reportsOf('{"resourceType":"Patient","identifier":[{"use":"official"}]}')).toEqual([]);
    expect(
      reportsOf('{"resourceType":"Practitioner","name":[{"use":"official","family":"X"}]}'),
    ).toEqual([]);
    expect(reportsOf('{"resourceType":"Practitioner","identifier":[{"value":"a"}]}')).toEqual([]);
  });
});

describe("the recognition predicate: key name and literal resourceType equality, nothing else", () => {
  it("(i) an unmodeled type carrying `comparator` under an arbitrary element IS an occurrence", () => {
    // The over-report is accepted by name: an unrecognised comparator is more dangerous than a
    // recognised one, and the alternative needs an element table this library does not have.
    const safety = safetyOf('{"resourceType":"Foo","x":{"comparator":"anything"}}');

    expect(safety.modifierElements).toEqual([
      { element: "comparator", location: `${WITHHELD}.x.comparator` },
    ]);
    expect(safety.safeToSummarize).toBe(false);
  });

  it('(ii) `{"comparator":"<"}` standing alone, with no Quantity sibling, IS an occurrence', () => {
    // A structural predicate that declined this is rejected by name: it is exactly the unreadable
    // modifier the fail-closed rule exists for.
    const safety = safetyOf('{"comparator":"<"}');

    expect(safety.modifierElements).toEqual([
      { element: "comparator", location: "$this.comparator" },
    ]);
    expect(safety.safeToSummarize).toBe(false);
  });

  it("(iii) a Practitioner carrying `active` reports `use` and does NOT report `active`", () => {
    expect(
      reportsOf(
        '{"resourceType":"Practitioner","active":true,"identifier":[{"use":"official","value":"X"}]}',
      ),
    ).toEqual([{ element: "use", location: "Practitioner.identifier[0].use" }]);
  });

  it("consults no element table: a comparator beside no value, unit, system or code still reports", () => {
    expect(reportsOf('{"resourceType":"Observation","code":{"comparator":"<"}}')).toEqual([
      { element: "comparator", location: "Observation.code.comparator" },
    ]);
  });

  it("reads the type gate fail-closed, through a repeated resourceType", () => {
    // A type gate that reads one of two written types is how a modifier goes unreported on a
    // document that names its type twice. Every written type is considered.
    expect(
      reportsOf('{"resourceType":"Practitioner","resourceType":"Patient","active":true}'),
    ).toEqual([{ element: "active", location: "Practitioner.active" }]);
  });
});

describe("one occurrence is one report, and two locations are two reports", () => {
  it("emits two distinguishable locations for two component comparators", () => {
    expect(
      reportsOf(
        '{"resourceType":"Observation","status":"final","component":[' +
          '{"valueQuantity":{"value":1,"comparator":"<"}},' +
          '{"valueQuantity":{"value":2,"comparator":">"}}]}',
      ),
    ).toEqual([
      { element: "comparator", location: "Observation.component[0].valueQuantity.comparator" },
      { element: "comparator", location: "Observation.component[1].valueQuantity.comparator" },
    ]);
  });

  it("carries the array index UNCONDITIONALLY, with only one occurrence in the document", () => {
    // A location that depends on what else the document contains is not a location.
    const one = reportsOf(
      '{"resourceType":"Observation","status":"final","component":' +
        '[{"valueQuantity":{"value":1,"comparator":"<"}}]}',
    );

    expect(one).toEqual([
      { element: "comparator", location: "Observation.component[0].valueQuantity.comparator" },
    ]);

    const two = reportsOf(
      '{"resourceType":"Observation","status":"final","component":[' +
        '{"valueQuantity":{"value":1,"comparator":"<"}},' +
        '{"valueQuantity":{"value":2,"comparator":">"}}]}',
    );

    // Adding a second occurrence does not move the first one's location.
    expect(two[0]).toEqual(one[0]);
  });

  it("counts a value and its underscore sibling at one element as ONE report", () => {
    expect(
      reportsOf(
        '{"resourceType":"Patient","active":true,"_active":' +
          '{"extension":[{"url":"http://x","valueCode":"masked"}]}}',
      ),
    ).toEqual([{ element: "active", location: "Patient.active" }]);
  });

  it("collapses a repeated property name at one location to one report", () => {
    // FHIRPath cannot address the individual members, so a second identical location says nothing.
    expect(
      reportsOf(
        '{"resourceType":"Observation","valueQuantity":{"comparator":"<","comparator":">"}}',
      ),
    ).toEqual([{ element: "comparator", location: "Observation.valueQuantity.comparator" }]);
  });

  it("collapses two occurrences whose locations both withhold to the same segment", () => {
    // Two different keys, both outside the element-name form, name one location once bounded. The
    // readout already collapses locations FHIRPath cannot tell apart; this channel does the same.
    const safety = safetyOf(
      '{"resourceType":"Patient","Aaa 1":{"comparator":"<"},"Bbb 2":{"comparator":">"}}',
    );

    expect(safety.modifierElements).toEqual([
      { element: "comparator", location: `Patient.${WITHHELD}.comparator` },
    ]);
    expect(safety.safeToSummarize).toBe(false);
  });

  it("skips an identifier entry that is not an object, and still reports the ones that are", () => {
    expect(reportsOf('{"resourceType":"Practitioner","identifier":["x","y"]}')).toEqual([]);
    expect(
      reportsOf('{"resourceType":"Practitioner","identifier":[{"use":"official"},"x"]}'),
    ).toEqual([{ element: "use", location: "Practitioner.identifier[0].use" }]);
  });
});

describe("a report carries the element and the location, and NOTHING taken from the document", () => {
  it("carries no measurement value, no unit, no code and no URI, from a fixture built to leak", () => {
    // A name-shaped string inside the URI and a known measurement value beside the comparator: if
    // either reaches a report, this channel is a new PHI surface.
    const json = JSON.stringify({
      resourceType: "Patient",
      implicitRules: `http://ehr.example.org/ig/${FORGED_KEY}`,
      contained: [
        {
          resourceType: "Observation",
          valueQuantity: { value: 424242.000424242, comparator: "<", unit: "mg/dL" },
        },
      ],
    });
    const serialized = JSON.stringify(reportsOf(json));

    expect(reportsOf(json)).toHaveLength(2);
    for (const leaked of [FORGED_KEY, "424242.000424242", "mg/dL", "<", "ehr.example.org"]) {
      expect(serialized, `${leaked} must not reach a report`).not.toContain(leaked);
    }
  });

  it("withholds a path segment that is not shaped like an element name", () => {
    // The bound this package already ships and pins, applied to this channel's locations: a segment
    // matching the published element-name form is echoed, anything else is withheld.
    const safety = safetyOf(
      `{"resourceType":"Foo",${JSON.stringify(FORGED_KEY)}:{"comparator":"<"}}`,
    );

    expect(safety.modifierElements).toEqual([
      { element: "comparator", location: `${WITHHELD}.${WITHHELD}.comparator` },
    ]);
    expect(JSON.stringify(safety.modifierElements)).not.toContain("DOE");
  });

  it("still echoes a segment genuinely shaped like an element name, which the bound does not stop", () => {
    // Stated rather than claimed away: a forgery shaped like an element name is echoed here exactly
    // as it is everywhere else this package builds a location.
    expect(reportsOf('{"resourceType":"Foo","johnsmith":{"comparator":"<"}}')).toEqual([
      { element: "comparator", location: `${WITHHELD}.johnsmith.comparator` },
    ]);
  });
});

describe("a location root is never document text", () => {
  it("roots two unmodeled types at ONE constant token, so the two locations are equal", () => {
    const first = reportsOf(
      `{"resourceType":${JSON.stringify(FORGED_KEY)},"implicitRules":"http://ehr.example.org/ig/x"}`,
    );
    const second = reportsOf(
      '{"resourceType":"AAA-BBB","implicitRules":"http://ehr.example.org/ig/x"}',
    );

    expect(first).toEqual(second);
    expect(first).toEqual([{ element: "implicitRules", location: `${WITHHELD}.implicitRules` }]);
    const serialized = JSON.stringify(first);
    expect(serialized).not.toContain("DOE");
    expect(serialized).not.toContain("AAA-BBB");
    expect(serialized).not.toContain("ehr.example.org");
  });

  it("tokenises a type name that is SHAPED like a resource type but is not one this library defines", () => {
    // The shape test alone would echo `Chalmers`, and does on every other channel. This channel is
    // the only one that tightens the root, and set membership is what tightens it.
    expect(reportsOf('{"resourceType":"Chalmers","implicitRules":"http://x"}')).toEqual([
      { element: "implicitRules", location: `${WITHHELD}.implicitRules` },
    ]);
    expect(MODIFIER_ELEMENT_ROOT_TYPES.has("Chalmers")).toBe(false);
  });

  it("names the concrete set, and both spellings the mandated cases turn on", () => {
    expect(MODIFIER_ELEMENT_ROOT_TYPES.has("Practitioner")).toBe(true);
    expect(MODIFIER_ELEMENT_ROOT_TYPES.has("MedicationRequest")).toBe(true);
    expect([...MODIFIER_ELEMENT_ROOT_TYPES].sort()).toEqual([
      "AllergyIntolerance",
      "Bundle",
      "Condition",
      "DiagnosticReport",
      "Immunization",
      "MedicationRequest",
      "MedicationStatement",
      "Observation",
      "Patient",
      "Practitioner",
    ]);
  });

  it("roots the two mandated documents at their own type names, which the set defines", () => {
    expect(
      reportsOf('{"resourceType":"Practitioner","identifier":[{"use":"official","value":"X"}]}'),
    ).toEqual([{ element: "use", location: "Practitioner.identifier[0].use" }]);
    expect(
      reportsOf(
        '{"resourceType":"MedicationRequest","dosageInstruction":[{"doseAndRate":' +
          '[{"doseQuantity":{"value":0.01,"comparator":"<","unit":"mg"}}]}]}',
      ),
    ).toEqual([
      {
        element: "comparator",
        location: "MedicationRequest.dosageInstruction[0].doseAndRate[0].doseQuantity.comparator",
      },
    ]);
  });
});

describe("reporting only: nothing already emitted moves", () => {
  it("leaves an unrecognised modifierExtension on its own channel, reported once", () => {
    const json = '{"resourceType":"Patient","modifierExtension":[{"url":"http://example.org/x"}]}';
    const safety = safetyOf(json);

    expect(safety.unhandledModifierExtensions).toEqual(["Patient.modifierExtension[0]"]);
    expect(safety.modifierElements).toEqual([]);
    // AC-6 (S0374): the extension carries neither a value nor nested extensions, so it also
    // violates the R4 base constraint ext-1, a finding gained beside the one pinned here.
    expect(findingsOf(json)).toEqual([
      "UNHANDLED_MODIFIER_EXTENSION/error at Patient.modifierExtension[0]",
      "INVARIANT_VIOLATED/error at Patient.modifierExtension[0]",
    ]);
  });

  it("does not move the modifier-extension channel's locations when this channel indexes", () => {
    // The unconditional array indexing this channel does is confined to this channel's own path.
    const json =
      '{"resourceType":"Patient","active":true,"contact":{"modifierExtension":' +
      '{"url":"http://example.org/x"}}}';
    const safety = safetyOf(json);

    expect(safety.unhandledModifierExtensions).toEqual(["Patient.contact.modifierExtension"]);
    expect(safety.modifierElements).toEqual([{ element: "active", location: "Patient.active" }]);
  });

  it("leaves every existing finding, its severity, its location and `valid` alone", () => {
    const withComparator =
      '{"resourceType":"Observation","status":"final","category":[{"coding":[{"system":' +
      '"http://terminology.hl7.org/CodeSystem/observation-category","code":"vital-signs"}]}],' +
      '"code":{"coding":[{"system":"http://loinc.org","code":"29463-7"}]},' +
      '"valueQuantity":{"value":70,"comparator":"<","unit":"kg","system":"http://unitsofmeasure.org","code":"lb"}}';
    const without = withComparator.replace('"comparator":"<",', "");

    // The comparator is the only difference between the two documents, and it moves no finding.
    expect(findingsOf(withComparator)).toEqual(findingsOf(without));
    expect(validateResource(parseResource(withComparator).resource).valid).toBe(
      validateResource(parseResource(without).resource).valid,
    );
    expect(reportsOf(withComparator)).toHaveLength(1);
    expect(reportsOf(without)).toHaveLength(0);
  });

  it("leaves the negations, the retraction and every other location channel unchanged", () => {
    const json =
      '{"resourceType":"MedicationRequest","status":"entered-in-error","doNotPerform":true,' +
      '"dosageInstruction":[{"doseAndRate":[{"doseQuantity":{"comparator":"<"}}]}]}';
    const safety = safetyOf(json);

    expect(safety.negations).toEqual(["entered-in-error", "do-not-perform"]);
    expect(safety.retracted).toBe(true);
    expect(safety.unhandledModifierExtensions).toEqual([]);
    expect(safety.shadowedProperties).toEqual([]);
    expect(safety.arrayWrappedScalars).toEqual([]);
    expect(safety.nestedArrays).toEqual([]);
    expect(safety.droppedText).toEqual([]);
    expect(safety.unreadableBooleans).toEqual([]);
    expect(safety.nearMissNegationCodes).toEqual([]);
    expect(safety.unreadableNegationCodes).toEqual([]);
  });

  it("introduces no false positive: a corpus fixture with none of the four is untouched", () => {
    const text = readFileSync(
      new URL("./__fixtures__/observation-vitals-bp.json", import.meta.url),
      "utf8",
    );
    const safety = safetyOf(text);

    expect(safety.modifierElements).toEqual([]);
    expect(safety.safeToSummarize).toBe(true);
  });
});

describe("the refusal and the readout are one verdict", () => {
  it("assertSafeToSummarize throws for a modifier element, carrying the location and no value", () => {
    const resource = parseResource(
      '{"resourceType":"Observation","valueQuantity":{"value":0.01,"comparator":"<","unit":"mg"}}',
    ).resource;

    expect(() => {
      assertSafeToSummarize(resource);
    }).toThrow(FhirSafetyError);
    try {
      assertSafeToSummarize(resource);
      expect.unreachable("a modifier element must refuse a summary");
    } catch (err) {
      expect(err).toBeInstanceOf(FhirSafetyError);
      const safetyError = err as FhirSafetyError;
      expect(safetyError.locations).toEqual(["Observation.valueQuantity.comparator"]);
      expect(safetyError.message).not.toContain("0.01");
      expect(safetyError.message).not.toContain("mg");
    }
  });

  it("the standalone collector and the readout channel are one call, not two rules", () => {
    for (const json of [
      '{"resourceType":"Patient","active":true}',
      '{"resourceType":"Practitioner","identifier":[{"use":"official"}]}',
      '{"resourceType":"Foo","x":{"comparator":"<"}}',
      '{"resourceType":"Patient","gender":"male"}',
    ]) {
      const { resource } = parseResource(json);
      expect(modifierElements(resource)).toEqual(readSafety(resource).modifierElements);
    }
  });
});

// S0364-fhir-safety-modifier-3: Patient.deceased[x], Patient.link and Immunization.isSubpotent join
// this channel, and MedicationRequest.intent is surfaced per root. The document tables below are
// shared by the criteria that re-read them (AC-9, AC-10), so every refusal is asserted over exactly
// the documents its own criterion names.

/** One document and the single `modifierElements` report it must draw. */
interface ExpectedReport {
  readonly json: string;
  readonly report: ModifierElementReport;
}

/** AC-1: a Patient root carrying `deceased[x]`, as `true`, `false`, a dateTime and the `_` form. */
const AC1_DOCUMENTS: readonly ExpectedReport[] = [
  {
    json: '{"resourceType":"Patient","deceasedBoolean":true}',
    report: { element: "deceased", location: "Patient.deceasedBoolean" },
  },
  {
    json: '{"resourceType":"Patient","deceasedBoolean":false}',
    report: { element: "deceased", location: "Patient.deceasedBoolean" },
  },
  {
    json: '{"resourceType":"Patient","deceasedDateTime":"1970-01-01"}',
    report: { element: "deceased", location: "Patient.deceasedDateTime" },
  },
  {
    json:
      '{"resourceType":"Patient","_deceasedDateTime":' +
      '{"extension":[{"url":"http://example.org/x","valueCode":"masked"}]}}',
    report: { element: "deceased", location: "Patient.deceasedDateTime" },
  },
  {
    json: '{"resourceType":"Patient","deceasedBoolean":true,"_deceasedBoolean":{"id":"d1"}}',
    report: { element: "deceased", location: "Patient.deceasedBoolean" },
  },
  {
    json:
      '{"resourceType":"Observation","status":"final","contained":' +
      '[{"resourceType":"Patient","deceasedDateTime":"1970-01-01"}]}',
    report: { element: "deceased", location: "Observation.contained[0].deceasedDateTime" },
  },
  {
    json:
      '{"resourceType":"Bundle","type":"collection","entry":' +
      '[{"resource":{"resourceType":"Patient","deceasedBoolean":false}}]}',
    report: { element: "deceased", location: "Bundle.entry[0].resource.deceasedBoolean" },
  },
];

/** AC-2: a Patient root carrying `link`, one entry or several, whatever each `link.type` says. */
const AC2_DOCUMENTS: readonly ExpectedReport[] = [
  {
    json: '{"resourceType":"Patient","link":[{"other":{"reference":"Patient/p2"},"type":"replaced-by"}]}',
    report: { element: "link", location: "Patient.link" },
  },
  {
    json:
      '{"resourceType":"Patient","link":[{"other":{"reference":"Patient/p2"},"type":"replaces"},' +
      '{"other":{"reference":"Patient/p3"},"type":"seealso"},' +
      '{"other":{"reference":"RelatedPerson/r1"},"type":"refer"}]}',
    report: { element: "link", location: "Patient.link" },
  },
  {
    json: '{"resourceType":"Patient","_link":{"id":"l1"}}',
    report: { element: "link", location: "Patient.link" },
  },
  {
    json:
      '{"resourceType":"Bundle","type":"collection","entry":[{"resource":{"resourceType":"Patient",' +
      '"link":[{"other":{"reference":"Patient/p2"},"type":"replaced-by"}]}}]}',
    report: { element: "link", location: "Bundle.entry[0].resource.link" },
  },
];

/** AC-3: an Immunization root carrying `isSubpotent`, `true`, `false` or the `_` form alone. */
const AC3_DOCUMENTS: readonly ExpectedReport[] = [
  {
    json: '{"resourceType":"Immunization","status":"completed","isSubpotent":true}',
    report: { element: "isSubpotent", location: "Immunization.isSubpotent" },
  },
  {
    json: '{"resourceType":"Immunization","status":"completed","isSubpotent":false}',
    report: { element: "isSubpotent", location: "Immunization.isSubpotent" },
  },
  {
    json: '{"resourceType":"Immunization","_isSubpotent":{"id":"s1"}}',
    report: { element: "isSubpotent", location: "Immunization.isSubpotent" },
  },
  {
    json: '{"resourceType":"Patient","contained":[{"resourceType":"Immunization","isSubpotent":true}]}',
    report: { element: "isSubpotent", location: "Patient.contained[0].isSubpotent" },
  },
];

/** AC-5: each of the three present in a form whose value cannot be read. */
const AC5_DOCUMENTS: readonly ExpectedReport[] = [
  ...[
    '"deceasedBoolean":null',
    '"deceasedBoolean":"yes"',
    '"deceasedBoolean":1',
    '"deceasedBoolean":[true]',
    '"deceasedBoolean":{"value":true}',
    '"deceasedBoolean":true,"deceasedBoolean":false',
  ].map((members) => ({
    json: `{"resourceType":"Patient",${members}}`,
    report: { element: "deceased", location: "Patient.deceasedBoolean" } as const,
  })),
  {
    json: '{"resourceType":"Patient","deceasedDateTime":true}',
    report: { element: "deceased", location: "Patient.deceasedDateTime" },
  },
  {
    json: '{"resourceType":"Patient","deceasedString":"unknown"}',
    report: { element: "deceased", location: "Patient.deceasedString" },
  },
  {
    json: '{"resourceType":"Patient","_deceasedString":{"id":"d1"}}',
    report: { element: "deceased", location: "Patient.deceasedString" },
  },
  ...[
    '"link":null',
    '"link":"replaced-by"',
    '"link":{"other":{"reference":"Patient/p2"},"type":"replaced-by"}',
    '"link":[null]',
    '"link":[{"type":"seealso"}],"link":[{"type":"replaced-by"}]',
  ].map((members) => ({
    json: `{"resourceType":"Patient",${members}}`,
    report: { element: "link", location: "Patient.link" } as const,
  })),
  ...[
    '"isSubpotent":null',
    '"isSubpotent":1',
    '"isSubpotent":"yes"',
    '"isSubpotent":[true]',
    '"isSubpotent":{"value":true}',
    '"isSubpotent":false,"isSubpotent":true',
  ].map((members) => ({
    json: `{"resourceType":"Immunization",${members}}`,
    report: { element: "isSubpotent", location: "Immunization.isSubpotent" } as const,
  })),
];

/** The eight R4 4.0.1 `MedicationRequest.intent` codes (valueset-medicationrequest-intent). */
const INTENT_CODES = [
  "proposal",
  "plan",
  "order",
  "original-order",
  "reflex-order",
  "filler-order",
  "instance-order",
  "option",
] as const;

/** AC-8: a MedicationRequest `intent` that is not one of those codes, written as one JSON string. */
const AC8_DOCUMENTS: readonly string[] = [
  '"intent":null',
  '"intent":1',
  '"intent":true',
  '"intent":{"value":"order"}',
  '"_intent":{"extension":[{"url":"http://example.org/x","valueCode":"masked"}]}',
  '"intent":["order"]',
  '"intent":["order","plan"]',
  '"intent":"order","intent":"order"',
  '"intent":"order","intent":"plan"',
  '"intent":"PROPOSAL"',
  '"intent":"Order"',
  '"intent":" order"',
  '"intent":"order "',
  '"intent":""',
  '"intent":"draft"',
].map((members) => `{"resourceType":"MedicationRequest","status":"active",${members}}`);

describe("AC-1: Patient.deceased[x] is reported at the member as written, at any value", () => {
  for (const { json, report } of AC1_DOCUMENTS) {
    it(`AC-1: ${json}`, () => {
      const safety = safetyOf(json);

      expect(safety.modifierElements).toEqual([report]);
      expect(safety.safeToSummarize).toBe(false);
    });
  }
});

describe("AC-2: Patient.link is reported once, at link, whatever its entries say", () => {
  for (const { json, report } of AC2_DOCUMENTS) {
    it(`AC-2: ${json}`, () => {
      const safety = safetyOf(json);

      expect(safety.modifierElements).toEqual([report]);
      expect(safety.safeToSummarize).toBe(false);
    });
  }
});

describe("AC-3: Immunization.isSubpotent is reported, whether true or false", () => {
  for (const { json, report } of AC3_DOCUMENTS) {
    it(`AC-3: ${json}`, () => {
      const safety = safetyOf(json);

      expect(safety.modifierElements).toEqual([report]);
      expect(safety.safeToSummarize).toBe(false);
    });
  }
});

describe("AC-4: several roots in one Bundle each report at their own entry", () => {
  it("AC-4: two deceased Patients and a subpotent Immunization draw three reports", () => {
    const safety = safetyOf(
      '{"resourceType":"Bundle","type":"collection","entry":[' +
        '{"resource":{"resourceType":"Patient","deceasedBoolean":true}},' +
        '{"resource":{"resourceType":"Patient","deceasedBoolean":true}},' +
        '{"resource":{"resourceType":"Immunization","status":"completed","isSubpotent":true}}]}',
    );

    expect(safety.modifierElements).toEqual([
      { element: "deceased", location: "Bundle.entry[0].resource.deceasedBoolean" },
      { element: "deceased", location: "Bundle.entry[1].resource.deceasedBoolean" },
      { element: "isSubpotent", location: "Bundle.entry[2].resource.isSubpotent" },
    ]);
    expect(safety.safeToSummarize).toBe(false);
  });
});

describe("AC-5: an unreadable value is still reported, and never read, coerced or repaired", () => {
  for (const { json, report } of AC5_DOCUMENTS) {
    it(`AC-5: ${json}`, () => {
      const safety = safetyOf(json);

      expect(safety.modifierElements).toEqual([report]);
      expect(safety.safeToSummarize).toBe(false);
    });
  }
});

describe("AC-6: the three are gated to their own resource type, at a resource root", () => {
  it("AC-6: draws nothing for deceased[x] or link on a root that is not a Patient", () => {
    for (const json of [
      '{"resourceType":"Observation","deceasedBoolean":true}',
      '{"resourceType":"RelatedPerson","deceasedDateTime":"1970-01-01"}',
      '{"resourceType":"Bundle","type":"searchset","link":[{"relation":"self","url":"http://x"}]}',
      '{"resourceType":"Person","link":[{"target":{"reference":"Patient/p1"}}]}',
      '{"resourceType":"Immunization","deceasedBoolean":true,"link":[{"type":"replaced-by"}]}',
    ]) {
      expect(reportsOf(json), json).toEqual([]);
    }
  });

  it("AC-6: draws nothing for isSubpotent on a root that is not an Immunization", () => {
    for (const json of [
      '{"resourceType":"Patient","isSubpotent":true}',
      '{"resourceType":"MedicationAdministration","isSubpotent":true}',
      '{"resourceType":"ImmunizationEvaluation","isSubpotent":true}',
    ]) {
      expect(reportsOf(json), json).toEqual([]);
    }
  });

  it("AC-6: draws nothing for the three below a root, off the element R4 defines them on", () => {
    for (const json of [
      '{"resourceType":"Patient","contact":[{"deceasedBoolean":true,"link":[{"type":"refer"}]}]}',
      '{"resourceType":"Immunization","protocolApplied":[{"isSubpotent":true}]}',
    ]) {
      expect(reportsOf(json), json).toEqual([]);
    }
  });
});

describe("AC-7: MedicationRequest.intent is surfaced exactly as written, per root", () => {
  for (const code of INTENT_CODES) {
    it(`AC-7: surfaces ${code} at MedicationRequest.intent and leaves the verdict standing`, () => {
      const safety = safetyOf(
        `{"resourceType":"MedicationRequest","status":"active","intent":${JSON.stringify(code)}}`,
      );

      expect(safety.intents).toEqual([{ code, location: "MedicationRequest.intent" }]);
      expect(safety.unreadableIntents).toEqual([]);
      expect(safety.modifierElements).toEqual([]);
      expect(safety.safeToSummarize).toBe(true);
    });
  }

  it("AC-7: surfaces one pair per root, each at its own entry, in a Bundle", () => {
    const safety = safetyOf(
      '{"resourceType":"Bundle","type":"collection","entry":[' +
        '{"resource":{"resourceType":"MedicationRequest","status":"active","intent":"proposal"}},' +
        '{"resource":{"resourceType":"MedicationRequest","status":"active","intent":"order"}}]}',
    );

    expect(safety.intents).toEqual([
      { code: "proposal", location: "Bundle.entry[0].resource.intent" },
      { code: "order", location: "Bundle.entry[1].resource.intent" },
    ]);
    expect(safety.safeToSummarize).toBe(true);
  });

  it("AC-7: surfaces a contained MedicationRequest's intent at its own root", () => {
    const safety = safetyOf(
      '{"resourceType":"MedicationRequest","status":"active","intent":"order","contained":' +
        '[{"resourceType":"MedicationRequest","status":"active","intent":"plan"}]}',
    );

    expect(safety.intents).toEqual([
      { code: "order", location: "MedicationRequest.intent" },
      { code: "plan", location: "MedicationRequest.contained[0].intent" },
    ]);
    expect(safety.safeToSummarize).toBe(true);
  });

  it("AC-7: surfaces a readable intent beside its primitive-extension metadata", () => {
    const safety = safetyOf(
      '{"resourceType":"MedicationRequest","status":"active","intent":"plan","_intent":{"id":"i1"}}',
    );

    expect(safety.intents).toEqual([{ code: "plan", location: "MedicationRequest.intent" }]);
    expect(safety.safeToSummarize).toBe(true);
  });

  it("AC-7: surfaces no intent for a root that is not a MedicationRequest", () => {
    // Gated exactly as the three reports above are, off the root's own `resourceType`.
    expect(safetyOf('{"resourceType":"ServiceRequest","intent":"order"}').intents).toEqual([]);
    expect(
      safetyOf('{"resourceType":"Observation","intent":"PROPOSAL"}').unreadableIntents,
    ).toEqual([]);
  });
});

describe("AC-8: an intent that is not one of the eight codes refuses, is located and is not surfaced", () => {
  for (const json of AC8_DOCUMENTS) {
    it(`AC-8: ${json}`, () => {
      const safety = safetyOf(json);

      expect(safety.intents).toEqual([]);
      expect(safety.unreadableIntents).toEqual(["MedicationRequest.intent"]);
      expect(safety.safeToSummarize).toBe(false);
    });
  }

  it("AC-8: locates an unreadable intent at its own root, beside a readable one", () => {
    const safety = safetyOf(
      '{"resourceType":"Bundle","type":"collection","entry":[' +
        '{"resource":{"resourceType":"MedicationRequest","intent":"order"}},' +
        '{"resource":{"resourceType":"MedicationRequest","intent":"Order"}}]}',
    );

    expect(safety.intents).toEqual([
      { code: "order", location: "Bundle.entry[0].resource.intent" },
    ]);
    expect(safety.unreadableIntents).toEqual(["Bundle.entry[1].resource.intent"]);
    expect(safety.safeToSummarize).toBe(false);
  });
});

describe("AC-9: the readout carries none of the document's text beyond the eight intent codes", () => {
  // Sentinels seeded at every position the criterion names. A dateTime is still a date, so its
  // sentinel is shaped like one; the rest are strings nobody else writes.
  const DECEASED = "1980-01-01T13:14:15+09:30";
  const OTHER_REFERENCE = "Patient/SENTINEL-OTHER-REFERENCE-5501";
  const OTHER_DISPLAY = "SENTINEL-OTHER-DISPLAY-5502";
  const LINK_TYPE = "SENTINEL-LINK-TYPE-5503";
  const INTENT = "SENTINEL-INTENT-5504";
  const SUBPOTENT = "SENTINEL-SUBPOTENT-5505";

  const patient = {
    resourceType: "Patient",
    deceasedDateTime: DECEASED,
    link: [
      { other: { reference: OTHER_REFERENCE, display: OTHER_DISPLAY }, type: LINK_TYPE },
      { other: { reference: OTHER_REFERENCE }, type: "replaced-by" },
    ],
  };
  const request = { resourceType: "MedicationRequest", status: "active", intent: INTENT };
  const readable = { resourceType: "MedicationRequest", status: "active", intent: "proposal" };
  const immunization = {
    resourceType: "Immunization",
    status: "completed",
    isSubpotent: SUBPOTENT,
  };

  for (const [name, document] of Object.entries({
    patient,
    request,
    readable,
    immunization,
    bundle: {
      resourceType: "Bundle",
      type: "collection",
      entry: [patient, request, readable, immunization].map((resource) => ({ resource })),
    },
  })) {
    it(`AC-9: ${name}`, () => {
      const safety = safetyOf(JSON.stringify(document));
      const serialized = JSON.stringify(safety);

      expect(safety.safeToSummarize).toBe(name === "readable");
      for (const sentinel of [
        DECEASED,
        "13:14:15",
        OTHER_REFERENCE,
        "SENTINEL-OTHER-REFERENCE-5501",
        OTHER_DISPLAY,
        LINK_TYPE,
        INTENT,
        SUBPOTENT,
      ]) {
        expect(serialized, `${sentinel} must not reach the readout`).not.toContain(sentinel);
      }
    });
  }
});

describe("AC-10: assertSafeToSummarize refuses over the new shapes and passes a readable intent", () => {
  const refused = [
    ...AC1_DOCUMENTS.map((entry) => entry.json),
    ...AC2_DOCUMENTS.map((entry) => entry.json),
    ...AC3_DOCUMENTS.map((entry) => entry.json),
    ...AC5_DOCUMENTS.map((entry) => entry.json),
    ...AC8_DOCUMENTS,
  ];
  for (const json of refused) {
    it(`AC-10: throws on ${json}`, () => {
      const { resource } = parseResource(json);

      expect(() => {
        assertSafeToSummarize(resource);
      }).toThrow(FhirSafetyError);
    });
  }

  it("AC-10: carries the intent location on the refusal, and no intent text", () => {
    const { resource } = parseResource(
      '{"resourceType":"MedicationRequest","status":"active","intent":"SENTINEL-INTENT-5506"}',
    );
    try {
      assertSafeToSummarize(resource);
      expect.unreachable("an unreadable intent must refuse a summary");
    } catch (err) {
      expect(err).toBeInstanceOf(FhirSafetyError);
      const safetyError = err as FhirSafetyError;
      expect(safetyError.locations).toEqual(["MedicationRequest.intent"]);
      expect(safetyError.message).not.toContain("SENTINEL-INTENT-5506");
    }
  });

  for (const code of INTENT_CODES) {
    it(`AC-10: does not throw on an active MedicationRequest whose intent is ${code}`, () => {
      const { resource } = parseResource(
        `{"resourceType":"MedicationRequest","status":"active","intent":${JSON.stringify(code)}}`,
      );

      expect(() => {
        assertSafeToSummarize(resource);
      }).not.toThrow();
    });
  }
});

describe("AC-11: an absent intent surfaces nothing and does not refuse", () => {
  it("AC-11: a MedicationRequest with neither intent nor _intent reads safeToSummarize true", () => {
    const safety = safetyOf('{"resourceType":"MedicationRequest","status":"active"}');

    expect(safety.intents).toEqual([]);
    expect(safety.unreadableIntents).toEqual([]);
    expect(safety.safeToSummarize).toBe(true);
  });
});

describe("declared non-reach residuals on the JSON read path, pinned so they cannot move in silence", () => {
  // Each of these is a Scope element the READ PATH drops before the safety walk sees it. Closing one
  // must red the test that pins it, in the same change. They are recorded with the repo's other
  // declared read-path losses; this phase does not close them.
  it("a comparator inside a primitive's `_`-sibling extension is not reached", () => {
    // The safety walk descends complex nodes and lists; a primitive's own `id`/`extension` metadata
    // is a different walk, and this channel rides the first one.
    const safety = safetyOf(
      '{"resourceType":"Patient","gender":"male","_gender":{"extension":' +
        '[{"url":"http://x","valueQuantity":{"value":1,"comparator":"<"}}]}}',
    );

    expect(safety.modifierElements).toEqual([]);
    expect(safety.safeToSummarize).toBe(true);
  });

  it("a comparator inside an array-inside-an-array is not reached", () => {
    // The codec models no inner array, so there is no node to reach. The document is already not
    // summarizable, by the channel that reports the unreadable content itself.
    const safety = safetyOf('{"resourceType":"Patient","x":[[{"comparator":"<"}]]}');

    expect(safety.modifierElements).toEqual([]);
    expect(safety.nestedArrays).toEqual(["Patient.x[0]"]);
    expect(safety.safeToSummarize).toBe(false);
  });

  it("a `use` in an identifier array the codec read as a PRIMITIVE list is not reached", () => {
    // A mixed array whose first entry is a scalar is read as a repeating primitive, so the object
    // entry beside it becomes a value-absent slot and there is no complex node to reach. The
    // position is reported (`UNKNOWN_PROPERTY`), so the loss is not silent, but it is not this
    // channel that reports it and the verdict does not move.
    const json = '{"resourceType":"Practitioner","identifier":["x",{"use":"official"}]}';
    const { resource, issues } = parseResource(json);

    expect(readSafety(resource).modifierElements).toEqual([]);
    expect(readSafety(resource).safeToSummarize).toBe(true);
    expect(issues.map((issue) => issue.code)).toEqual(["UNKNOWN_PROPERTY"]);
  });

  it("a comparator inside a `_`-sibling misplaced on a complex element is not reached", () => {
    // The reader discards such a sibling whole, so the modifier never reaches the model at all.
    const safety = safetyOf(
      '{"resourceType":"Observation","valueQuantity":{"value":1},"_valueQuantity":' +
        '{"extension":[{"url":"http://x","valueQuantity":{"comparator":"<"}}]}}',
    );

    expect(safety.modifierElements).toEqual([]);
    expect(safety.safeToSummarize).toBe(true);
  });
});
