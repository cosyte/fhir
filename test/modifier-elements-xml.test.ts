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

import { parseResourceXml, readSafety, validateResource } from "../src/index.js";

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
    expect(findingsOfXml(xml)).toEqual([
      "RESOURCE_NOT_MODELED/information at Observation",
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
