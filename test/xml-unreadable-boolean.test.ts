import { describe, expect, it } from "vitest";

import {
  assertSafeToSummarize,
  FhirSafetyError,
  parseResource,
  parseResourceXml,
  readSafety,
  serializeResourceXml,
  unreadableBooleans,
  validateResource,
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

/** The readout of an XML `MedicationRequest` carrying the given `doNotPerform` element. */
function safetyOfXml(doNotPerform: string): ReturnType<typeof readSafety> {
  return readSafety(parseResourceXml(xmlMedicationRequest(doNotPerform)).resource);
}

/**
 * A `doNotPerform` whose value this library cannot read is **reported**, not read.
 *
 * `#79` closed the lexical `true`: `<doNotPerform value="true"/>` reads, and the negation survives
 * this package's own XML round trip. What it left standing is the value that is not in the datatype
 * at all. R4 spells a `boolean` as `true` or `false` and nothing else (`datatypes.html`), so
 * `<doNotPerform value="1"/>` and `value="Y"`, ordinary output from a v2 or C-CDA converter, which
 * is how a great deal of data reaches a FHIR surface, carry no boolean this library may read.
 *
 * At the base commit `05ecc5a` they read `doNotPerform: undefined`, `negations: []`, `issues: []`,
 * `safeToSummarize: true`, and `assertSafeToSummarize` passed clean, **identical to `value="0"` and
 * `value="N"`**. A prescriber who wrote "yes, do not administer" got the same answer as one who wrote
 * "no", and nothing on any channel recorded that a choice had been made and dropped.
 *
 * **The remedy is a report, not a wider read.** Widening `booleanOf` to take `"1"` and `"Y"` would be
 * worse than the defect: it would invent a reading R4 does not license, and it would turn `value="0"`
 * and `value="N"` into a JS `false` that `serializeResource` then emits as `false`, authoring a
 * value and laundering it across a format change. So the read is untouched, `undefined` still means
 * "no boolean was read", and the new `unreadableBooleans` channel is what tells its two causes apart.
 */
describe("a doNotPerform value outside the boolean lexical space is reported", () => {
  for (const text of ["1", "Y", "0", "N", "TRUE", "True", "yes", " true", "1.0", ""]) {
    it(`reports ${JSON.stringify(text)} as an unreadable boolean and declines to summarize`, () => {
      const safety = safetyOfXml(`<doNotPerform value="${text}"/>`);

      // The read is unchanged: no value is invented in either direction.
      expect(safety.doNotPerform).toBeUndefined();
      expect(safety.negations).toEqual([]);
      // What changed is that the element's presence is now recorded, and the readout stops affirming.
      expect(safety.unreadableBooleans).toEqual(["MedicationRequest.doNotPerform"]);
      expect(safety.safeToSummarize).toBe(false);
    });
  }

  it("gives the affirmative and the negative spelling the same answer, and it is a refusal", () => {
    // The heart of the item. `"Y"` and `"N"` are the same two characters a v2 feed uses for opposite
    // instructions, and this library can read neither. Base gave them the same answer too, and that
    // answer was `safeToSummarize: true` with an empty issue list, a summariser presenting a
    // "do not administer" as an active order. They still read alike, because they are alike to a
    // reader with no licence to guess; the difference is that the answer is now a refusal.
    const yes = safetyOfXml('<doNotPerform value="Y"/>');
    const no = safetyOfXml('<doNotPerform value="N"/>');

    expect(yes.doNotPerform).toBe(no.doNotPerform);
    expect(yes.unreadableBooleans).toEqual(no.unreadableBooleans);
    expect(yes.safeToSummarize).toBe(false);
    expect(no.safeToSummarize).toBe(false);
  });

  it("throws from assertSafeToSummarize, carrying the location and no value", () => {
    // The written text is a sentinel rather than `"1"` so the value-free assertion below cannot be
    // satisfied by accident: the message legitimately carries a location COUNT, and `"1"` would
    // match that digit instead of proving the value stayed out.
    const resource = parseResourceXml(
      xmlMedicationRequest('<doNotPerform value="Zq7-SENTINEL"/>'),
    ).resource;

    expect(() => {
      assertSafeToSummarize(resource);
    }).toThrow(FhirSafetyError);
    try {
      assertSafeToSummarize(resource);
      expect.unreachable("assertSafeToSummarize must refuse an unreadable doNotPerform");
    } catch (err) {
      expect(err).toBeInstanceOf(FhirSafetyError);
      const safetyError = err as FhirSafetyError;
      expect(safetyError.locations).toEqual(["MedicationRequest.doNotPerform"]);
      // Value-free by contract: the text that failed to read reaches neither the locations nor the
      // message. This sentinel is innocuous; the same channel would otherwise echo whatever a sender
      // wrote at a PHI-adjacent element.
      expect(safetyError.message).not.toContain("Zq7-SENTINEL");
      expect(safetyError.message).toBe(
        "Resource cannot be safely summarized: an unhandled modifierExtension, a repeated property " +
          "name, an array-wrapped single-valued element, an array inside an array, dropped XML " +
          "element text, or a boolean value this library cannot read leaves an element this " +
          "library must not flatten (1 location(s)).",
      );
    }
  });

  it("reports the standalone collector at the same location as the readout", () => {
    // The exported collector and the readout channel are one call, not two rules that can drift.
    const { resource } = parseResourceXml(xmlMedicationRequest('<doNotPerform value="Y"/>'));

    expect(unreadableBooleans(resource, "MedicationRequest")).toEqual([
      "MedicationRequest.doNotPerform",
    ]);
    expect(readSafety(resource).unreadableBooleans).toEqual(
      unreadableBooleans(resource, "MedicationRequest"),
    );
  });

  it("reports a JSON document that spelled its boolean as a number or a foreign string", () => {
    // The model records no provenance, so the rule is about the value, not the wire. FHIR JSON says
    // a boolean is a JSON boolean (`json.html`), so both of these are non-conformant either way, and
    // both wrote something at `doNotPerform` that this library did not read.
    for (const written of ["1", '"Y"']) {
      const { resource } = parseResource(
        `{"resourceType":"MedicationRequest","doNotPerform":${written}}`,
      );

      expect(readSafety(resource).unreadableBooleans).toEqual(["MedicationRequest.doNotPerform"]);
      expect(readSafety(resource).safeToSummarize).toBe(false);
    }
  });

  it("reports the unreadable value a repeated property name shadowed", () => {
    // `readDoNotPerform` reads across every member a duplicate key left, so the report has to as
    // well, or an unreadable value becomes invisible by arriving second. One location however many
    // members: FHIRPath cannot address an individual member. (The duplicate is independently a
    // `shadowedProperties` finding; the point here is that the unreadable value is its own.)
    const { resource } = parseResource(
      '{"resourceType":"MedicationRequest","doNotPerform":false,"doNotPerform":"Y"}',
    );
    const safety = readSafety(resource);

    expect(safety.unreadableBooleans).toEqual(["MedicationRequest.doNotPerform"]);
    expect(safety.doNotPerform).toBe(false);
  });

  it("reports an unreadable value inside a generic converter's array wrapper", () => {
    // `primitiveBooleans` reads through the wrapper, so the complement must look through it too:
    // `{"doNotPerform":["Y"]}` is exactly what a generic XML-to-JSON converter emits, and the value
    // it wrote is no more readable for being wrapped.
    const { resource } = parseResource('{"resourceType":"MedicationRequest","doNotPerform":["Y"]}');

    expect(readSafety(resource).unreadableBooleans).toEqual(["MedicationRequest.doNotPerform"]);
  });

  it("reports the unreadable member beside a readable one in the same wrapper", () => {
    // A wrapper holding `["true","Y"]` yields the negation AND the report: the `true` is read, the
    // `Y` is not, and one value being readable does not make the other one absent.
    const { resource } = parseResource(
      '{"resourceType":"MedicationRequest","doNotPerform":["true","Y"]}',
    );
    const safety = readSafety(resource);

    expect(safety.negations).toEqual(["do-not-perform"]);
    expect(safety.unreadableBooleans).toEqual(["MedicationRequest.doNotPerform"]);
  });

  it("reports a MedicationRequest inside a Bundle entry, the window arrayWrappedScalars uses", () => {
    // The check runs at every resource root, so a converter-sourced order buried in a Bundle is
    // covered on the same terms as one at the top level.
    const bundle = parseResource(
      '{"resourceType":"Bundle","type":"collection","entry":[{"resource":' +
        '{"resourceType":"MedicationRequest","doNotPerform":"Y"}}]}',
    ).resource;

    expect(readSafety(bundle).unreadableBooleans).toEqual([
      "Bundle.entry[0].resource.doNotPerform",
    ]);
    expect(readSafety(bundle).safeToSummarize).toBe(false);
  });
});

/**
 * What the channel deliberately does NOT report. Every test here is green on the base tree too: they
 * are the negative controls that bound the report, not evidence for it. A channel that fires on a
 * conformant document is worse than one that stays quiet, because a refusal a caller learns to
 * ignore protects nothing.
 */
describe("what is not an unreadable boolean", () => {
  for (const text of ["true", "false"]) {
    it(`reports nothing for the conformant spelling ${JSON.stringify(text)}`, () => {
      const safety = safetyOfXml(`<doNotPerform value="${text}"/>`);

      expect(safety.unreadableBooleans).toEqual([]);
      expect(safety.safeToSummarize).toBe(true);
    });
  }

  it("reports nothing when the element is absent", () => {
    expect(safetyOfXml("").unreadableBooleans).toEqual([]);
  });

  it("reports nothing for a primitive that carries metadata and no value", () => {
    // R4 lets a primitive be present with no value of its own, carrying only `id` / `extension`
    // (`json.html` §2.6.2.3), a data-absent-reason is written exactly this way. Nothing was written
    // at the value channel, so nothing was unread, and firing here would false-error on a conformant
    // document. This is the one shape that separates "no value" from "a value I could not read".
    const safety = safetyOfXml(
      '<doNotPerform><extension url="http://hl7.org/fhir/StructureDefinition/data-absent-reason">' +
        '<valueCode value="unknown"/></extension></doNotPerform>',
    );

    expect(safety.doNotPerform).toBeUndefined();
    expect(safety.unreadableBooleans).toEqual([]);
    expect(safety.safeToSummarize).toBe(true);
  });

  it("reports nothing for a doNotPerform on a resource type that has no such element", () => {
    // The report follows the read's own type gate. `doNotPerform` is a MedicationRequest element;
    // `readDoNotPerform` never looks at a Patient, so naming a location there would report a value
    // no read declined.
    const { resource } = parseResourceXml(
      `<Patient ${FHIR_NS}><doNotPerform value="Y"/></Patient>`,
    );
    const safety = readSafety(resource);

    expect(safety.unreadableBooleans).toEqual([]);
    expect(safety.safeToSummarize).toBe(true);
  });

  it("leaves a conformant JSON MedicationRequest untouched on every channel", () => {
    const { resource } = parseResource(
      '{"resourceType":"MedicationRequest","status":"active","intent":"order","doNotPerform":true,' +
        '"medicationCodeableConcept":{"text":"amoxicillin"},"subject":{"reference":"Patient/1"}}',
    );
    const safety = readSafety(resource);

    expect(safety.negations).toEqual(["do-not-perform"]);
    expect(safety.unreadableBooleans).toEqual([]);
    expect(safety.safeToSummarize).toBe(true);
  });

  it("keeps this package's own XML round trip clean", () => {
    // The writer emits `<doNotPerform value="true"/>`, which reads. If the report ever fired on the
    // library's own output it would refuse to summarize everything it had just written.
    const { resource } = parseResource(
      '{"resourceType":"MedicationRequest","status":"active","intent":"order","doNotPerform":false}',
    );
    const back = parseResourceXml(serializeResourceXml(resource)).resource;

    expect(readSafety(back).doNotPerform).toBe(false);
    expect(readSafety(back).unreadableBooleans).toEqual([]);
    expect(readSafety(back).safeToSummarize).toBe(true);
  });
});

/**
 * Characterization tests over what this change does NOT close, pinned so they cannot move in
 * silence. Each one holds on the base tree too: they record the residual, they do not clear it.
 * Closing any of them MUST red the test beside it, in the same change.
 */
describe("declared residuals of the unreadable-boolean report, pinned", () => {
  it("raises no ValidationIssue for an unreadable boolean", () => {
    // A deliberate asymmetry, and it puts `safeToSummarize: false` beside `valid: true` for the
    // first time on this readout (the refusal is asserted in the parametrised block above; only the
    // validator half is pinned here, because only the validator half is unchanged from base). The
    // five fail-closed rules in the validator are all about shapes FHIR gives no meaning to at ANY
    // position (a repeated name, an array wrapper, an array inside an array, dropped element text),
    // decidable with no datatype in hand. This one is decidable only because the safety layer knows
    // `MedicationRequest.doNotPerform` is a `boolean`, and the structural validator is schema-free.
    // Putting a datatype-dependent rule in there is the change `#78` measured at
    // `validatePrimitiveValue` and declined, because in place it RETIRES a real mismatch. Left for
    // its own measurement rather than folded in here.
    const { resource } = parseResourceXml(xmlMedicationRequest('<doNotPerform value="Y"/>'));
    const result = validateResource(resource);

    expect(result.valid).toBe(true);
    expect(result.issues.map((issue) => issue.code)).toEqual(["RESOURCE_NOT_MODELED"]);
  });

  it("reports nothing for a boolean element written as an object or an empty array", () => {
    // The channel answers about a WRITTEN VALUE outside the lexical space, not about a wrong shape.
    // `{"doNotPerform":{}}` holds no value at all, so there is nothing the read declined, and it
    // still reads as an absent instruction under `safeToSummarize: true`. Not folded in: an object
    // where a primitive belongs is a shape question, and answering it here would put a second,
    // differently-shaped rule on a channel whose whole guarantee is that it mirrors the read.
    const asObject = parseResource(
      '{"resourceType":"MedicationRequest","doNotPerform":{}}',
    ).resource;

    expect(readSafety(asObject).unreadableBooleans).toEqual([]);
    expect(readSafety(asObject).safeToSummarize).toBe(true);
  });

  it("reports nothing for a JSON null, which is left to its own parse issue", () => {
    // `{"doNotPerform":null}` draws `UNDEFINED_JSON_NULL` at parse time and leaves a value-less
    // primitive, so it is on a channel already, but not on this one, and not on `safeToSummarize`.
    // That gap is `UNDEFINED_JSON_NULL`'s, deliberately open and pinned where it was closed.
    const { resource, issues } = parseResource(
      '{"resourceType":"MedicationRequest","doNotPerform":null}',
    );

    expect(issues.map((issue) => issue.code)).toEqual(["UNDEFINED_JSON_NULL"]);
    expect(readSafety(resource).unreadableBooleans).toEqual([]);
    expect(readSafety(resource).safeToSummarize).toBe(true);
  });

  it("reports nothing for the two profile booleans, still lost from XML in silence", () => {
    // `ElementDefinition.mustSupport` and `slicing.ordered` go through `primitiveBoolean`, the
    // convenience read, which `#79` left matching a JS `boolean` alone because filling in a value
    // there RETIRES a `MUST_SUPPORT_ABSENT`. They are not on this channel either: `SafetyReadout` is
    // the safety spine's readout and a StructureDefinition is not a safety resource, so a report
    // for them needs a home this slice does not build. Both remain lost, silently.
    const { resource } = parseResourceXml(
      `<StructureDefinition ${FHIR_NS}><url value="http://example.org/StructureDefinition/probe"/>` +
        '<type value="Observation"/><kind value="resource"/><differential><element>' +
        '<path value="Observation.status"/><mustSupport value="1"/>' +
        "</element></differential></StructureDefinition>",
    );
    const safety = readSafety(resource);

    expect(safety.unreadableBooleans).toEqual([]);
    expect(safety.safeToSummarize).toBe(true);
  });

  it("reports nothing for an unreadable value at a non-boolean datatype", () => {
    // The class is wider than this channel and the channel does not pretend otherwise. A `Quantity`
    // magnitude written `+5`, an `ElementDefinition.min` written in XML, and a FHIRPath number are
    // each "written, not readable" too, and each is its own open item. Only the boolean the safety
    // spine reads is covered here.
    const safety = safetyOfXml(
      '<doNotPerform value="true"/><dispenseRequest><quantity><value value="+5"/>' +
        '<code value="mg"/></quantity></dispenseRequest>',
    );

    expect(safety.unreadableBooleans).toEqual([]);
    expect(safety.safeToSummarize).toBe(true);
  });
});
