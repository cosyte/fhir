/**
 * Modifier ELEMENTS on the XML read path, one characterization test per element.
 *
 * Silence about XML would have been a real gap: this package reads and writes both wire formats
 * through one model, so a modifier element written as XML is a live input. Each test below pins what
 * is OBSERVED rather than what is hoped for, and all four elements are observed to reach the safety
 * walk from XML, so each asserts the report. Nothing here is licensed to make the reader reach
 * further: a shape that did not reach would be pinned as an absence and recorded with this repo's
 * declared read-path losses instead.
 *
 * The pair worth reading together is the last two: FHIR XML carries a primitive's value in the
 * `value` attribute, so `<comparator>&lt;</comparator>` is a spelling this reader drops the value
 * of. The KEY is still there, and presence of the key is what this channel triggers on, so the
 * modifier is reported even in the spelling whose value is lost. That is the direction that matters:
 * a dropped value must not become an absent modifier.
 */

import { describe, expect, it } from "vitest";

import { parseResource, parseResourceXml, readSafety, validateResource } from "../src/index.js";

const NS = 'xmlns="http://hl7.org/fhir"';

/** The readout for an XML document. */
function safetyOfXml(xml: string): ReturnType<typeof readSafety> {
  return readSafety(parseResourceXml(xml).resource);
}

/**
 * The `code/severity at location` triples the validator emits for an XML document. Joined with
 * ` at ` for the reason the JSON suite next door records: an `IssueCode@FHIRPath` literal is
 * indistinguishable from an email address by shape, and the PHI gate answers that collision with a
 * declared domain per FHIRPath root.
 */
function findingsOfXml(xml: string): string[] {
  const result = validateResource(parseResourceXml(xml).resource);
  return result.issues.map((issue) => `${issue.code}/${issue.severity} at ${issue.expression}`);
}

describe("XML read path: implicitRules", () => {
  it("reaches the safety walk and is reported", () => {
    const safety = safetyOfXml(
      `<Patient ${NS}><implicitRules value="http://ehr.example.org/ig/x"/></Patient>`,
    );

    expect(safety.modifierElements).toEqual([
      { element: "implicitRules", location: "Patient.implicitRules" },
    ]);
    expect(safety.safeToSummarize).toBe(false);
    expect(safety.unhandledModifierExtensions).toEqual([]);
    expect(JSON.stringify(safety.modifierElements)).not.toContain("ehr.example.org");
  });

  it("draws nothing when it is absent", () => {
    const safety = safetyOfXml(`<Patient ${NS}><gender value="male"/></Patient>`);

    expect(safety.modifierElements).toEqual([]);
    expect(safety.safeToSummarize).toBe(true);
  });
});

describe("XML read path: Quantity.comparator", () => {
  it("reaches the safety walk and is reported, carrying no value or unit", () => {
    const safety = safetyOfXml(
      `<Observation ${NS}><status value="final"/><valueQuantity>` +
        `<value value="0.01"/><comparator value="&lt;"/><unit value="mg"/>` +
        `</valueQuantity></Observation>`,
    );

    expect(safety.modifierElements).toEqual([
      { element: "comparator", location: "Observation.valueQuantity.comparator" },
    ]);
    expect(safety.safeToSummarize).toBe(false);
    const serialized = JSON.stringify(safety.modifierElements);
    expect(serialized).not.toContain("0.01");
    expect(serialized).not.toContain("mg");
  });

  it("is reported for the value-absent spelling, where the key is present and no value is", () => {
    const safety = safetyOfXml(
      `<Observation ${NS}><valueQuantity><comparator/></valueQuantity></Observation>`,
    );

    expect(safety.modifierElements).toEqual([
      { element: "comparator", location: "Observation.valueQuantity.comparator" },
    ]);
  });

  it("is reported for the element-text spelling, whose VALUE this reader drops", () => {
    // The repo's flagship read-path loss, seen from this channel: the value goes, the key stays, and
    // the modifier is reported rather than silently absent.
    const xml = `<Observation ${NS}><valueQuantity><comparator>&lt;</comparator></valueQuantity></Observation>`;
    const safety = safetyOfXml(xml);

    expect(safety.modifierElements).toEqual([
      { element: "comparator", location: "Observation.valueQuantity.comparator" },
    ]);
    expect(safety.droppedText).toEqual(["Observation.valueQuantity.comparator"]);
    // The document names neither mandatory element, so the built-in Observation element table
    // raises both. Those are ADDED findings; the dropped-text one this test exists for is unmoved,
    // at the same code, severity and location, and the informational "not modeled" note it used to
    // sit beside is gone because the type now IS modeled.
    expect(findingsOfXml(xml)).toEqual([
      "CARDINALITY_MIN/error at Observation.status",
      "CARDINALITY_MIN/error at Observation.code",
      "DROPPED_ELEMENT_TEXT/error at Observation.valueQuantity.comparator",
    ]);
  });
});

describe("XML read path: Patient.active", () => {
  it("reaches the safety walk and is reported, at any written value", () => {
    for (const written of ["true", "false", "1"]) {
      const safety = safetyOfXml(`<Patient ${NS}><active value="${written}"/></Patient>`);

      expect(safety.modifierElements, `active="${written}"`).toEqual([
        { element: "active", location: "Patient.active" },
      ]);
      expect(safety.safeToSummarize).toBe(false);
    }
  });

  it("leaves the validator's own finding on that element exactly where it was", () => {
    // This reader is schema-free and keeps the lexical text, so the validator's datatype check on
    // the one type it models is what it always was. This channel adds a report; it moves no finding.
    expect(findingsOfXml(`<Patient ${NS}><active value="true"/></Patient>`)).toEqual([
      "TYPE_MISMATCH/error at Patient.active",
    ]);
  });
});

describe("XML read path: Practitioner.identifier.use", () => {
  it("reaches the safety walk and is reported, unindexed for a single identifier", () => {
    // FHIR XML spells a repeat by repeating the element, so ONE `<identifier>` is not an array in
    // the model and there is no array position to name. Two of them are, and are indexed.
    const safety = safetyOfXml(
      `<Practitioner ${NS}><identifier><use value="official"/><value value="X"/></identifier></Practitioner>`,
    );

    expect(safety.modifierElements).toEqual([
      { element: "use", location: "Practitioner.identifier.use" },
    ]);
    expect(safety.safeToSummarize).toBe(false);
  });

  it("indexes each entry when the document repeats the element", () => {
    const safety = safetyOfXml(
      `<Practitioner ${NS}><identifier><use value="official"/></identifier>` +
        `<identifier><use value="usual"/></identifier></Practitioner>`,
    );

    expect(safety.modifierElements).toEqual([
      { element: "use", location: "Practitioner.identifier[0].use" },
      { element: "use", location: "Practitioner.identifier[1].use" },
    ]);
  });

  it("draws nothing for `use` on a Patient's identifier read from XML", () => {
    const safety = safetyOfXml(
      `<Patient ${NS}><identifier><use value="official"/></identifier></Patient>`,
    );

    expect(safety.modifierElements).toEqual([]);
  });
});

// S0364-fhir-safety-modifier-3, AC-12: the documents of AC-1, AC-2, AC-3, AC-7 and AC-8 written
// as FHIR XML read exactly as their JSON spelling does. A nested resource is written as a
// two-entry Bundle in both spellings: FHIR XML spells a repeat by repeating the element, so a
// single `<entry>` or `<contained>` is not an array in the model and carries no index (pinned for
// `identifier` above), which is a property of the reader and not of this channel.

/** One document in both spellings. */
interface Spelled {
  readonly json: string;
  readonly xml: string;
}

/** The JSON and XML readouts of one document, and the fields AC-12 holds equal. */
function expectSameReading({ json, xml }: Spelled): ReturnType<typeof readSafety> {
  const fromJson = readSafety(parseResource(json).resource);
  const fromXml = safetyOfXml(xml);
  expect(fromXml.modifierElements, "modifierElements").toEqual(fromJson.modifierElements);
  expect(fromXml.intents, "intents").toEqual(fromJson.intents);
  expect(fromXml.unreadableIntents, "unreadableIntents").toEqual(fromJson.unreadableIntents);
  expect(fromXml.safeToSummarize, "safeToSummarize").toBe(fromJson.safeToSummarize);
  return fromXml;
}

const MASKED = '<extension url="http://example.org/x"><valueCode value="masked"/></extension>';

describe("AC-12: deceased[x], link and isSubpotent read the same from XML as from JSON", () => {
  const documents: readonly Spelled[] = [
    {
      json: '{"resourceType":"Patient","deceasedBoolean":true}',
      xml: `<Patient ${NS}><deceasedBoolean value="true"/></Patient>`,
    },
    {
      json: '{"resourceType":"Patient","deceasedBoolean":false}',
      xml: `<Patient ${NS}><deceasedBoolean value="false"/></Patient>`,
    },
    {
      json: '{"resourceType":"Patient","deceasedDateTime":"1970-01-01"}',
      xml: `<Patient ${NS}><deceasedDateTime value="1970-01-01"/></Patient>`,
    },
    {
      json: `{"resourceType":"Patient","_deceasedDateTime":{"extension":[{"url":"http://example.org/x","valueCode":"masked"}]}}`,
      xml: `<Patient ${NS}><deceasedDateTime>${MASKED}</deceasedDateTime></Patient>`,
    },
    {
      json: '{"resourceType":"Patient","deceasedBoolean":true,"_deceasedBoolean":{"id":"d1"}}',
      xml: `<Patient ${NS}><deceasedBoolean id="d1" value="true"/></Patient>`,
    },
    {
      json: '{"resourceType":"Patient","link":[{"other":{"reference":"Patient/p2"},"type":"replaced-by"}]}',
      xml:
        `<Patient ${NS}><link><other><reference value="Patient/p2"/></other>` +
        `<type value="replaced-by"/></link></Patient>`,
    },
    {
      json:
        '{"resourceType":"Patient","link":[{"other":{"reference":"Patient/p2"},"type":"replaces"},' +
        '{"other":{"reference":"Patient/p3"},"type":"seealso"},' +
        '{"other":{"reference":"RelatedPerson/r1"},"type":"refer"}]}',
      xml:
        `<Patient ${NS}>` +
        `<link><other><reference value="Patient/p2"/></other><type value="replaces"/></link>` +
        `<link><other><reference value="Patient/p3"/></other><type value="seealso"/></link>` +
        `<link><other><reference value="RelatedPerson/r1"/></other><type value="refer"/></link>` +
        `</Patient>`,
    },
    {
      json: '{"resourceType":"Immunization","status":"completed","isSubpotent":true}',
      xml: `<Immunization ${NS}><status value="completed"/><isSubpotent value="true"/></Immunization>`,
    },
    {
      json: '{"resourceType":"Immunization","status":"completed","isSubpotent":false}',
      xml: `<Immunization ${NS}><status value="completed"/><isSubpotent value="false"/></Immunization>`,
    },
    {
      json: '{"resourceType":"Immunization","_isSubpotent":{"id":"s1"}}',
      xml: `<Immunization ${NS}><isSubpotent id="s1"/></Immunization>`,
    },
    {
      json:
        '{"resourceType":"Bundle","type":"collection","entry":[' +
        '{"resource":{"resourceType":"Patient","deceasedBoolean":false,' +
        '"link":[{"other":{"reference":"Patient/p2"},"type":"replaced-by"}]}},' +
        '{"resource":{"resourceType":"Immunization","isSubpotent":true}}]}',
      xml:
        `<Bundle ${NS}><type value="collection"/>` +
        `<entry><resource><Patient><deceasedBoolean value="false"/>` +
        `<link><other><reference value="Patient/p2"/></other><type value="replaced-by"/></link>` +
        `</Patient></resource></entry>` +
        `<entry><resource><Immunization><isSubpotent value="true"/></Immunization></resource></entry>` +
        `</Bundle>`,
    },
  ];

  for (const document of documents) {
    it(`AC-12: ${document.xml}`, () => {
      const safety = expectSameReading(document);

      expect(safety.modifierElements.length).toBeGreaterThan(0);
      expect(safety.safeToSummarize).toBe(false);
    });
  }
});

describe("AC-12: MedicationRequest.intent reads the same from XML as from JSON", () => {
  const codes = [
    "proposal",
    "plan",
    "order",
    "original-order",
    "reflex-order",
    "filler-order",
    "instance-order",
    "option",
  ];
  for (const code of codes) {
    it(`AC-12: surfaces ${code} from its value attribute`, () => {
      const safety = expectSameReading({
        json: `{"resourceType":"MedicationRequest","status":"active","intent":"${code}"}`,
        xml: `<MedicationRequest ${NS}><status value="active"/><intent value="${code}"/></MedicationRequest>`,
      });

      expect(safety.intents).toEqual([{ code, location: "MedicationRequest.intent" }]);
      expect(safety.safeToSummarize).toBe(true);
    });
  }

  it("AC-12: surfaces one pair per root in a Bundle", () => {
    const safety = expectSameReading({
      json:
        '{"resourceType":"Bundle","type":"collection","entry":[' +
        '{"resource":{"resourceType":"MedicationRequest","intent":"proposal"}},' +
        '{"resource":{"resourceType":"MedicationRequest","intent":"order"}}]}',
      xml:
        `<Bundle ${NS}><type value="collection"/>` +
        `<entry><resource><MedicationRequest><intent value="proposal"/></MedicationRequest></resource></entry>` +
        `<entry><resource><MedicationRequest><intent value="order"/></MedicationRequest></resource></entry>` +
        `</Bundle>`,
    });

    expect(safety.intents).toHaveLength(2);
  });

  const unreadable: readonly Spelled[] = [
    ...["PROPOSAL", "Order", " order", "order ", "", "draft", "1"].map((written) => ({
      json: `{"resourceType":"MedicationRequest","status":"active","intent":${JSON.stringify(written)}}`,
      xml: `<MedicationRequest ${NS}><status value="active"/><intent value="${written}"/></MedicationRequest>`,
    })),
    {
      json: `{"resourceType":"MedicationRequest","status":"active","_intent":{"extension":[{"url":"http://example.org/x","valueCode":"masked"}]}}`,
      xml: `<MedicationRequest ${NS}><status value="active"/><intent>${MASKED}</intent></MedicationRequest>`,
    },
    {
      json: '{"resourceType":"MedicationRequest","status":"active","intent":["order","plan"]}',
      xml:
        `<MedicationRequest ${NS}><status value="active"/>` +
        `<intent value="order"/><intent value="plan"/></MedicationRequest>`,
    },
    {
      json: '{"resourceType":"MedicationRequest","status":"active","intent":{"value":"order"}}',
      xml: `<MedicationRequest ${NS}><status value="active"/><intent><value value="order"/></intent></MedicationRequest>`,
    },
  ];
  for (const document of unreadable) {
    it(`AC-12: refuses ${document.xml}`, () => {
      const safety = expectSameReading(document);

      expect(safety.intents).toEqual([]);
      expect(safety.unreadableIntents).toEqual(["MedicationRequest.intent"]);
      expect(safety.safeToSummarize).toBe(false);
    });
  }

  it("AC-12: an intent written as element text reads safeToSummarize false", () => {
    // The reader's element-text tolerance recovers the text as the value, exactly as it does for
    // `status`, so the code is surfaced; the dropped-text channel is what refuses the document.
    const safety = safetyOfXml(
      `<MedicationRequest ${NS}><status value="active"/><intent>proposal</intent></MedicationRequest>`,
    );

    expect(safety.safeToSummarize).toBe(false);
    expect(safety.droppedText).toEqual(["MedicationRequest.intent"]);
    expect(safety.intents).toEqual([{ code: "proposal", location: "MedicationRequest.intent" }]);
  });
});
