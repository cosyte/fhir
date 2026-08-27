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
    expect(findingsOf(json)).toEqual([
      "UNHANDLED_MODIFIER_EXTENSION/error at Patient.modifierExtension[0]",
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
