import { describe, expect, it } from "vitest";

import {
  assertSafeToSummarize,
  collectProfileIssues,
  convertToBoolean,
  getProperty,
  loadStructureDefinition,
  parseResource,
  parseResourceXml,
  readSafety,
  serializeResourceXml,
  type FpColl,
} from "../src/index.js";

const FHIR_NS = 'xmlns="http://hl7.org/fhir"';

/** A `MedicationRequest` written in XML, carrying whatever `doNotPerform` spelling is passed. */
function xmlMedicationRequest(doNotPerform: string): string {
  return (
    `<MedicationRequest ${FHIR_NS}><status value="active"/><intent value="order"/>` +
    `${doNotPerform}<medicationCodeableConcept><text value="amoxicillin"/></medicationCodeableConcept>` +
    `<subject><reference value="Patient/1"/></subject></MedicationRequest>`
  );
}

/** A `StructureDefinition` written in XML, one differential element carrying the given children. */
function xmlStructureDefinition(elementChildren: string): string {
  return (
    `<StructureDefinition ${FHIR_NS}><url value="http://example.org/StructureDefinition/probe"/>` +
    `<type value="Observation"/><kind value="resource"/><differential><element>` +
    `<path value="Observation.status"/>${elementChildren}` +
    `</element></differential></StructureDefinition>`
  );
}

/**
 * A boolean the XML reader kept as lexical text is still a boolean.
 *
 * FHIR XML carries every primitive as the text of its `value` attribute (`xml.html` §2.6.1), and this
 * reader is schema-free by design: with no StructureDefinition in hand it cannot know that `value`
 * spells a `boolean`, so `<doNotPerform value="true"/>` lands as the string `"true"` where the JSON
 * reader builds `true`. That much is a declared limit of a codec with no schema, and it costs nothing
 * on its own.
 *
 * What it cost was the negation. `readDoNotPerform` read through `primitiveBooleans`, which accepted
 * only a JS `boolean`, and a failed match reads as **absence**, so a `MedicationRequest` carrying an
 * explicit "do not give this medication" lost that instruction across this package's own
 * `serializeResourceXml` -> `parseResourceXml` round trip, came back with `negations: []` and an empty
 * issue list, and `assertSafeToSummarize` passed clean over it. A summariser would have presented it
 * as an active order. `doNotPerform` is not a value that degrades when it is missed; it inverts.
 */
describe("a doNotPerform written in XML is read, not reported absent", () => {
  it("keeps the negation across this package's own XML round trip", () => {
    const json =
      '{"resourceType":"MedicationRequest","status":"active","intent":"order","doNotPerform":true,' +
      '"medicationCodeableConcept":{"text":"amoxicillin"},"subject":{"reference":"Patient/1"}}';
    const fromJson = parseResource(json).resource;
    const roundTripped = parseResourceXml(serializeResourceXml(fromJson));

    expect(roundTripped.issues).toEqual([]);
    expect(readSafety(fromJson).negations).toEqual(["do-not-perform"]);
    expect(readSafety(roundTripped.resource).negations).toEqual(["do-not-perform"]);
    expect(readSafety(roundTripped.resource).doNotPerform).toBe(true);
  });

  it("reads the negation off an XML MedicationRequest that was never JSON", () => {
    const { resource, issues } = parseResourceXml(
      xmlMedicationRequest('<doNotPerform value="true"/>'),
    );
    const safety = readSafety(resource);

    expect(issues).toEqual([]);
    expect(safety.doNotPerform).toBe(true);
    expect(safety.negations).toEqual(["do-not-perform"]);
  });

  it("reads an explicit false as false, not as an unwritten element", () => {
    // The two readings are not interchangeable: `undefined` says the prescriber wrote nothing,
    // `false` says they wrote "this may be performed". Only one of them is what the document says.
    const safety = readSafety(
      parseResourceXml(xmlMedicationRequest('<doNotPerform value="false"/>')).resource,
    );

    expect(safety.doNotPerform).toBe(false);
    expect(safety.negations).toEqual([]);
  });

  it("finds the negation in the value a repeated property name shadowed", () => {
    // First-wins would surface the conformant `false`; the read is across every value written, so a
    // `true` anywhere wins. Over-surfacing a "do not give" is safe; missing one is not.
    const { resource } = parseResource(
      '{"resourceType":"MedicationRequest","doNotPerform":false,"doNotPerform":"true"}',
    );
    const safety = readSafety(resource);

    expect(safety.doNotPerform).toBe(true);
    expect(safety.negations).toEqual(["do-not-perform"]);
  });

  it("finds the negation inside a generic converter's array wrapper", () => {
    // `{"doNotPerform":["true"]}` is what a generic XML-to-JSON converter emits, and it is both
    // shapes at once: the wrapper AND the lexical form. Neither may hide the instruction.
    const { resource } = parseResource(
      '{"resourceType":"MedicationRequest","doNotPerform":["true"]}',
    );
    const safety = readSafety(resource);

    expect(safety.doNotPerform).toBe(true);
    expect(safety.negations).toEqual(["do-not-perform"]);
  });

  it("reads a boolean spelled as JSON text, which the JSON reader also keeps as a string", () => {
    // Declared collateral, not a separate rule: the model records no provenance, so the same lexical
    // read applies to a JSON document that spelled its boolean as a string. FHIR JSON says a boolean
    // is a JSON boolean, so that document is non-conformant, but the instruction IS written at
    // MedicationRequest.doNotPerform and reporting it absent was the worse of the two readings.
    const safety = readSafety(
      parseResource('{"resourceType":"MedicationRequest","doNotPerform":"true"}').resource,
    );

    expect(safety.doNotPerform).toBe(true);
    expect(safety.negations).toEqual(["do-not-perform"]);
  });
});

/**
 * The census found two more booleans read the same wrong way, and **neither is fixed here**. The
 * profile reads go through `primitiveBoolean`, the convenience read, whose callers treat `undefined`
 * as "inherit from the base element": `snapshot.ts` merges a differential's `mustSupport` only when
 * it is not `undefined`, so reading an XML `<mustSupport value="false"/>` that base read as
 * `undefined` would let the differential **overwrite** an inherited `true` and **retire** a
 * `MUST_SUPPORT_ABSENT` the base emitted. Adding a negation is safe; removing a finding is the one
 * direction this layer must not move in without its own measurement. So the census is reported and
 * the two sites are left standing, pinned here.
 */
describe("the profile booleans written in XML are still unread, deliberately", () => {
  it("reads no mustSupport off an XML StructureDefinition", () => {
    const { resource } = parseResourceXml(
      xmlStructureDefinition('<min value="1"/><max value="1"/><mustSupport value="true"/>'),
    );
    const definition = loadStructureDefinition(resource);

    expect(definition?.differential?.[0]?.mustSupport).toBeUndefined();
    // The element is read, and `max` (a string in both formats) reads fine beside the lost flag.
    expect(definition?.differential?.[0]?.max).toBe(1);
  });

  it("reads no slicing.ordered off an XML StructureDefinition", () => {
    const { resource } = parseResourceXml(
      xmlStructureDefinition(
        '<slicing><discriminator><type value="value"/><path value="code"/></discriminator>' +
          '<rules value="closed"/><ordered value="true"/></slicing>',
      ),
    );
    const definition = loadStructureDefinition(resource);

    expect(definition?.differential?.[0]?.slicing?.ordered).toBeUndefined();
    // `rules` is asserted as `closed` rather than the `open` fallback on purpose: it proves a
    // sibling child of the same `slicing` element WAS read, so this is the flag going missing and
    // not the element.
    expect(definition?.differential?.[0]?.slicing?.rules).toBe("closed");
  });

  it("raises no profile diagnostic off an XML must-support flag, on either tree", () => {
    // The counterpart to the read above, and the reason no diagnostic moves in this slice:
    // `MUST_SUPPORT_ABSENT` is the only issue any of the censused boolean reads feeds, and this
    // one is unchanged, so `collectProfileIssues` returns the same thing base did.
    const { resource } = parseResourceXml(
      xmlStructureDefinition('<mustSupport value="true"/>').replace(
        "Observation.status",
        "Observation.note",
      ),
    );
    const profile = loadStructureDefinition(resource);
    const observation = parseResource('{"resourceType":"Observation","status":"final"}').resource;

    expect(profile).toBeDefined();
    if (profile === undefined) return;
    expect(collectProfileIssues(observation, profile)).toEqual([]);
  });

  it("leaves the JSON reader's own booleans exactly as they were", () => {
    // Deliberately green on both trees: the negative control that the widening reaches a shape the
    // JSON codec never produces, and changes nothing about the shape it does.
    const definition = loadStructureDefinition(
      parseResource(
        '{"resourceType":"StructureDefinition","url":"http://example.org/StructureDefinition/probe",' +
          '"type":"Observation","kind":"resource","differential":{"element":[' +
          '{"path":"Observation.status","min":1,"max":"1","mustSupport":true}]}}',
      ).resource,
    );

    expect(definition?.differential?.[0]?.mustSupport).toBe(true);
    expect(definition?.differential?.[0]?.min).toBe(1);
  });
});

/**
 * The widening recognises the R4 `boolean` lexical space (`datatypes.html`: `true` and `false`, and
 * nothing else) so `undefined` still means "no boolean this reader can read" and never "a boolean I
 * declined to look at". Every test in here is green on the base tree too, on purpose: they are the
 * negative controls that bound the change, not evidence for it.
 */
describe("what is still not a boolean", () => {
  for (const text of ["TRUE", "True", "1", "yes", "Y", " true", ""]) {
    it(`does not read ${JSON.stringify(text)} as a boolean`, () => {
      const safety = readSafety(
        parseResourceXml(xmlMedicationRequest(`<doNotPerform value="${text}"/>`)).resource,
      );

      expect(safety.doNotPerform).toBeUndefined();
      expect(safety.negations).toEqual([]);
    });
  }

  it("reads a doNotPerform written on a resource type that has no such element", () => {
    // There is no type gate any more, and this document is the price of dropping it: R4 defines no
    // `doNotPerform` on Patient, so this is non-conformant and the negation is surfaced anyway. That
    // is the direction the read is allowed to be wrong in -- it adds a negation a caller can ignore,
    // where a gate subtracts one nobody ever sees. `test/negation-read-scope.test.ts` holds the
    // conformant half.
    const { resource } = parseResourceXml(
      `<Patient ${FHIR_NS}><doNotPerform value="true"/></Patient>`,
    );

    expect(readSafety(resource).doNotPerform).toBe(true);
    expect(readSafety(resource).negations).toEqual(["do-not-perform"]);
  });

  it("does not read a decimal's lexical form as a boolean", () => {
    const { resource } = parseResourceXml(
      `<MedicationRequest ${FHIR_NS}><doNotPerform value="1.0"/></MedicationRequest>`,
    );

    expect(readSafety(resource).doNotPerform).toBeUndefined();
  });
});

/**
 * Characterization tests over what this change does NOT close, pinned so they cannot move in
 * silence. Each one holds on the base tree too: they record the residual, they do not clear it.
 * Closing any of them MUST red the test beside it, in the same change.
 */
describe("declared residuals of the schema-free boolean read, pinned", () => {
  it("still affirms safeToSummarize over a doNotPerform this reader CAN read", () => {
    // The half of the original pin that was never a residual, kept as the boundary of the one that
    // was. This slice's remedy is that `negations` carries the instruction, NOT that summarizing is
    // refused, so for a value that reads (`"true"`) `safeToSummarize` is unmoved and must stay so:
    // a lexical `true` is the whole R4 boolean lexical space, the read succeeds, and there is
    // nothing left over to decline. The `"1"` half moved and now lives in
    // `test/xml-unreadable-boolean.test.ts`.
    const resource = parseResourceXml(
      xmlMedicationRequest('<doNotPerform value="true"/>'),
    ).resource;
    const safety = readSafety(resource);

    expect(safety.safeToSummarize).toBe(true);
    expect(safety.droppedText).toEqual([]);
    expect(safety.unreadableBooleans).toEqual([]);
    expect(() => {
      assertSafeToSummarize(resource);
    }).not.toThrow();
  });

  it("reads no ElementDefinition.min off an XML StructureDefinition, silently", () => {
    // The same root class one datatype over, and NOT closed here: `min` is an `unsignedInt`, read
    // through a `FhirDecimal` match that lexical text does not satisfy. So a profile handed over in
    // XML declares its required elements and this library enforces none of them, with nothing on any
    // diagnostic channel to say so. Deliberately left standing: `min` is not a boolean, and the
    // remedy for it is its own measurement.
    const { resource } = parseResourceXml(
      xmlStructureDefinition('<min value="1"/><max value="1"/>'),
    );
    const definition = loadStructureDefinition(resource);

    expect(definition?.differential?.[0]?.min).toBeUndefined();
    // `max` reads fine, because FHIR spells it as a string in both formats.
    expect(definition?.differential?.[0]?.max).toBe(1);
  });

  it("coerces an XML-read false to true in FHIRPath singleton evaluation", () => {
    // `convertToBoolean` implements FHIRPath's singleton-evaluation rule: a single item that is not
    // a Boolean is `true` (existence). On a schema-free XML model `<doNotPerform value="false"/>` is
    // a single String item, so an invariant or a `where()` criteria judged by it reads `true` for a
    // document that says `false`. Deliberately not taken here: the remedy changes FHIRPath's typing
    // rules for genuinely string-valued elements too, which can RETIRE a finding rather than add
    // one, and the model carries no provenance to scope it.
    const fromXml = parseResourceXml(
      `<MedicationRequest ${FHIR_NS}><doNotPerform value="false"/></MedicationRequest>`,
    ).resource;
    const fromJson = parseResource(
      '{"resourceType":"MedicationRequest","doNotPerform":false}',
    ).resource;
    const asColl = (name: string, resource: Parameters<typeof getProperty>[0]): FpColl => {
      const node = getProperty(resource, name);
      return node === undefined ? [] : [{ t: "node", node }];
    };

    expect(convertToBoolean(asColl("doNotPerform", fromXml))).toBe(true);
    expect(convertToBoolean(asColl("doNotPerform", fromJson))).toBe(false);
  });
});
