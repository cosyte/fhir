import { describe, expect, it } from "vitest";

import {
  getProperty,
  matchesFixed,
  nodesEquivalent,
  parseResource,
  parseResourceXml,
  readMedicationDoses,
  readObservationValue,
  readQuantity,
  readReferenceRanges,
  resourceType,
  serializeResource,
  serializeResourceXml,
  validateResource,
  type FhirNode,
} from "../src/index.js";

const FHIR_NS = 'xmlns="http://hl7.org/fhir"';

/** The `valueQuantity` node of an Observation written in XML. */
function xmlValueQuantity(inner: string): FhirNode | undefined {
  const { resource } = parseResourceXml(
    `<Observation ${FHIR_NS}><status value="final"/><valueQuantity>${inner}</valueQuantity></Observation>`,
  );
  return getProperty(resource, "valueQuantity");
}

/** The `valueQuantity` node of an Observation written in JSON. */
function jsonValueQuantity(inner: string): FhirNode | undefined {
  const { resource } = parseResource(
    `{"resourceType":"Observation","status":"final","valueQuantity":${inner}}`,
  );
  return getProperty(resource, "valueQuantity");
}

/**
 * A `Quantity` magnitude the XML reader kept as lexical text is still a magnitude.
 *
 * FHIR XML carries every primitive as the text of its `value` attribute, and the reader is
 * schema-free by design: it never guesses a datatype, so `<value value="5"/>` lands as the string
 * `"5"` where the JSON reader would have built a `FhirDecimal`. That much is a deliberate, declared
 * limit of a codec with no StructureDefinition in hand, and it costs no precision (the text is never
 * routed through a `number`).
 *
 * What it used to cost was the magnitude itself: `readQuantity` accepted only the JSON reader's
 * shape, so an XML-sourced dose or lab value surfaced as `value: undefined` beside a unit that read
 * fine. `undefined` is the documented reading for "this quantity carries no magnitude", so a
 * document that *did* carry one came back as the bare-unit shape with an empty issue list. Those two
 * facts must not share one value, which is what these tests hold.
 */
describe("a Quantity magnitude written in XML is read, not reported absent", () => {
  it("reads a medication dose magnitude off an XML MedicationRequest", () => {
    const xml =
      `<MedicationRequest ${FHIR_NS}><dosageInstruction><doseAndRate><doseQuantity>` +
      `<value value="5"/><unit value="mg"/>` +
      `<system value="http://unitsofmeasure.org"/><code value="mg"/>` +
      `</doseQuantity></doseAndRate></dosageInstruction></MedicationRequest>`;
    const { resource, issues } = parseResourceXml(xml);
    const doses = readMedicationDoses(resource, resourceType(resource));

    expect(issues).toEqual([]);
    expect(doses).toHaveLength(1);
    expect(doses[0]?.value?.toString()).toBe("5");
    expect(doses[0]?.code).toBe("mg");
  });

  it("keeps a dose's trailing-zero precision across the XML read (0.010, not 0.01)", () => {
    const xml =
      `<MedicationStatement ${FHIR_NS}><dosage><doseAndRate><doseQuantity>` +
      `<value value="0.010"/><code value="mg"/>` +
      `</doseQuantity></doseAndRate></dosage></MedicationStatement>`;
    const { resource } = parseResourceXml(xml);

    expect(readMedicationDoses(resource, resourceType(resource))[0]?.value?.toString()).toBe(
      "0.010",
    );
  });

  it("reads an Observation value[x] Quantity magnitude written in XML", () => {
    const { resource } = parseResourceXml(
      `<Observation ${FHIR_NS}><status value="final"/><valueQuantity>` +
        `<value value="120"/><system value="http://unitsofmeasure.org"/><code value="mm[Hg]"/>` +
        `</valueQuantity></Observation>`,
    );

    expect(readObservationValue(resource)?.quantity?.value?.toString()).toBe("120");
  });

  it("reads both reference-range bounds written in XML", () => {
    const { resource } = parseResourceXml(
      `<Observation ${FHIR_NS}><status value="final"/><referenceRange>` +
        `<low><value value="70"/><code value="mg/dL"/></low>` +
        `<high><value value="110"/><code value="mg/dL"/></high>` +
        `</referenceRange></Observation>`,
    );
    const [range] = readReferenceRanges(resource);

    expect(range?.low?.value?.toString()).toBe("70");
    expect(range?.high?.value?.toString()).toBe("110");
  });

  it("preserves an exact magnitude no double could hold", () => {
    const q = readQuantity(xmlValueQuantity('<value value="9223372036854775807"/>'));

    expect(q?.value?.toString()).toBe("9223372036854775807");
  });

  it("reads the exponent and sign forms of the R4 decimal lexical space", () => {
    expect(readQuantity(xmlValueQuantity('<value value="-1.5e2"/>'))?.value?.toString()).toBe(
      "-1.5e2",
    );
    expect(readQuantity(xmlValueQuantity('<value value="0"/>'))?.value?.toString()).toBe("0");
  });

  it("reads a magnitude spelled as JSON text, which the JSON reader also keeps as a string", () => {
    // Declared collateral, not a separate rule: the model records no provenance, so the same
    // lexical read applies to a JSON document that spelled its magnitude as a string. FHIR JSON
    // says a decimal is a number, so this document is non-conformant, but the magnitude IS written
    // at Quantity.value and reporting it absent was the worse of the two readings.
    const q = readQuantity(jsonValueQuantity('{"value":"1.50","unit":"mg"}'));

    expect(q?.value?.toString()).toBe("1.50");
    expect(q?.unit).toBe("mg");
  });
});

/**
 * The widening recognises the R4 `decimal` lexical space and nothing else, so `undefined` still
 * means "no magnitude this reader can read" and never "a magnitude I declined to look at".
 */
describe("what is still not a magnitude", () => {
  it("does not read non-numeric attribute text as a magnitude, and keeps the unit", () => {
    const q = readQuantity(xmlValueQuantity('<value value="abc"/><unit value="mg"/>'));

    expect(q?.value).toBeUndefined();
    expect(q?.unit).toBe("mg");
  });

  it("does not read a boolean's lexical form as a magnitude", () => {
    expect(readQuantity(xmlValueQuantity('<value value="true"/>'))?.value).toBeUndefined();
  });

  it("does not read empty attribute text as a magnitude", () => {
    expect(readQuantity(xmlValueQuantity('<value value=""/>'))?.value).toBeUndefined();
  });

  it("does not read a thousands-separated or padded number", () => {
    expect(readQuantity(xmlValueQuantity('<value value="1,5"/>'))?.value).toBeUndefined();
    expect(readQuantity(xmlValueQuantity('<value value=" 5 "/>'))?.value).toBeUndefined();
    expect(readQuantity(xmlValueQuantity('<value value="+5"/>'))?.value).toBeUndefined();
  });

  it("still reports no magnitude for a quantity that carries only a unit", () => {
    const q = readQuantity(xmlValueQuantity('<unit value="widgets"/>'));

    expect(q?.value).toBeUndefined();
    expect(q?.unit).toBe("widgets");
  });

  it("leaves the JSON reader's own decimal exactly as it was", () => {
    const q = readQuantity(jsonValueQuantity('{"value":0.010,"code":"U"}'));

    expect(q?.value?.toString()).toBe("0.010");
    expect(q?.code).toBe("U");
  });
});

/**
 * Characterization tests over what this change does NOT close, pinned so they cannot move in
 * silence. Each one holds on the base tree too: they record the residual, they do not clear it.
 * Closing any of them MUST red the test beside it, in the same change.
 */
describe("declared residuals of the schema-free primitive read, pinned", () => {
  it("re-emits an XML-sourced decimal as a JSON string, not a JSON number", () => {
    const { resource } = parseResourceXml(
      `<Observation ${FHIR_NS}><status value="final"/><valueQuantity>` +
        `<value value="1.50"/><unit value="mg"/></valueQuantity></Observation>`,
    );

    // The magnitude's text survives byte-for-byte; its JSON *type* does not.
    expect(serializeResource(resource)).toBe(
      '{"resourceType":"Observation","status":"final","valueQuantity":{"value":"1.50","unit":"mg"}}',
    );
  });

  it("keeps the two wire formats model-equivalent all the same", () => {
    const xml = `<Patient ${FHIR_NS}><active value="true"/></Patient>`;
    const fromXml = parseResourceXml(xml).resource;
    const fromJson = parseResource('{"resourceType":"Patient","active":true}').resource;

    // Equivalence is defined modulo lexical form; that is the declared rule, not an accident.
    expect(nodesEquivalent(fromXml, fromJson)).toBe(true);
    expect(serializeResourceXml(fromXml)).toBe(xml);
  });

  it("reports TYPE_MISMATCH on an XML-read boolean and integer the JSON twin validates clean", () => {
    const fromXml = parseResourceXml(
      `<Patient ${FHIR_NS}><active value="true"/><multipleBirthInteger value="2"/></Patient>`,
    ).resource;
    const fromJson = parseResource(
      '{"resourceType":"Patient","active":true,"multipleBirthInteger":2}',
    ).resource;

    // `validatePrimitiveValue`'s shape rule reads the JSON reader's model shape as THE model shape,
    // so a conformant XML document draws a false error and `valid` flips. Still open: the remedy
    // trades against a real TYPE_MISMATCH on a JSON document that spelled a boolean as a string,
    // and the model carries no provenance to tell the two apart.
    expect(validateResource(fromXml).issues.map((i) => [i.code, i.expression])).toEqual([
      ["TYPE_MISMATCH", "Patient.active"],
      ["TYPE_MISMATCH", "Patient.multipleBirthInteger"],
    ]);
    expect(validateResource(fromXml).valid).toBe(false);
    expect(validateResource(fromJson).issues).toEqual([]);
    expect(validateResource(fromJson).valid).toBe(true);
  });

  it("does not match an XML-read decimal against a fixed[x] decimal read from JSON", () => {
    const fixed = getProperty(
      parseResource('{"resourceType":"Observation","valueDecimal":1.50}').resource,
      "valueDecimal",
    );
    const fromXml = getProperty(
      parseResourceXml(`<Observation ${FHIR_NS}><valueDecimal value="1.50"/></Observation>`)
        .resource,
      "valueDecimal",
    );

    expect(fixed).toBeDefined();
    expect(fromXml).toBeDefined();
    if (fixed === undefined || fromXml === undefined) return;
    // `primitiveEquals` compares model shapes, so the same magnitude in the other wire format is a
    // mismatch: a profile's `fixed[x]`/`pattern[x]` check false-errors on conformant XML.
    expect(matchesFixed(fromXml, fixed)).toBe(false);
    expect(matchesFixed(fixed, fixed)).toBe(true);
  });
});
