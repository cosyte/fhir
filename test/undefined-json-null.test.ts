import { describe, expect, it } from "vitest";

import {
  getProperty,
  isList,
  isUndefinedNull,
  parseResource,
  parseResourceXml,
  readSafety,
  serializeResource,
  validateResource,
} from "../src/index.js";

/**
 * A JSON `null` in a primitive's value channel: reported, and handed back rather than deleted.
 *
 * FHIR JSON uses `null` for exactly one job, padding a repeating primitive's value array so that it
 * aligns index-by-index with the `_`-sibling array carrying that occurrence's `id`/`extension`
 * (json.html §2.6.2.3, the one exception to §2.6.2.1's "properties never have null values"). A `null`
 * that pads nothing leaves an element with neither a value nor children,
 * which R4 `ele-1` requires one of.
 *
 * Read silently and then omitted on emit, that shape did something worse than lose data: it
 * **laundered**. A non-conformant document came back as a conformant one with the member simply
 * gone, and there was no diagnostic anywhere to say so, so the output could not be told apart from a
 * document whose sender had legitimately left the element out. `{"value":null,"unit":"mg"}` re-emitted
 * as `{"unit":"mg"}` is the sharpest shape of it: a quantity that reads as a bare unit rather than as
 * missing.
 *
 * Both halves are load-bearing and are asserted together throughout. The report alone does not close
 * it, because the report does not survive `serializeResource`; the hand-back alone does not close it,
 * because a caller reading `issues` still sees nothing.
 *
 * Every value here is synthetic.
 */

/** Parse, re-emit, and re-read: the round trip a laundering defect hides inside. */
function roundTrip(input: string): { out: string; codes: string[]; reReadCodes: string[] } {
  const first = parseResource(input);
  const out = serializeResource(first.resource);
  return {
    out,
    codes: first.issues.map((issue) => issue.code),
    reReadCodes: parseResource(out).issues.map((issue) => issue.code),
  };
}

describe("a `null` that pads nothing is reported and written back", () => {
  const shapes: [string, string, string][] = [
    [
      "a patient identifier's value",
      '{"resourceType":"Patient","identifier":[{"system":"http://hospital.example/mrn","value":null}]}',
      "Patient.identifier[0].value",
    ],
    [
      "an observation's status",
      '{"resourceType":"Observation","status":null}',
      "Observation.status",
    ],
    [
      "a quantity's magnitude, beside a unit that survives",
      '{"resourceType":"Observation","status":"final","valueQuantity":{"value":null,"unit":"mg","system":"http://unitsofmeasure.org","code":"mg"}}',
      "Observation.valueQuantity.value",
    ],
    [
      "a dose magnitude, three levels down",
      '{"resourceType":"MedicationRequest","status":"active","intent":"order","dosageInstruction":[{"doseAndRate":[{"doseQuantity":{"value":null,"unit":"mg","system":"http://unitsofmeasure.org","code":"mg"}}]}]}',
      "MedicationRequest.dosageInstruction[0].doseAndRate[0].doseQuantity.value",
    ],
    [
      "a coding's code on a resource a safety verdict is read out of",
      '{"resourceType":"AllergyIntolerance","clinicalStatus":{"coding":[{"system":"http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical","code":null}]}}',
      "AllergyIntolerance.clinicalStatus.coding[0].code",
    ],
    [
      "a value inside a primitive's own extension",
      '{"resourceType":"Patient","extension":[{"url":"http://example.org/x","valueString":null}]}',
      "Patient.extension[0].valueString",
    ],
    [
      "an every-slot-absent repeating primitive, which used to lose the member outright",
      '{"resourceType":"Patient","name":[{"given":[null]}]}',
      "Patient.name[0].given[0]",
    ],
    [
      "one slot of a repeating primitive whose other slot has a value",
      '{"resourceType":"Patient","name":[{"given":["Peter",null]}]}',
      "Patient.name[0].given[1]",
    ],
  ];

  it.each(shapes)("reports %s at the position it sat", (_label, input, expression) => {
    expect(parseResource(input).issues).toEqual([
      { code: "UNDEFINED_JSON_NULL", severity: "warning", expression },
    ]);
  });

  it.each(shapes)("writes %s back, so the round trip is byte-identical", (_label, input) => {
    const { out } = roundTrip(input);
    expect(out).toBe(input);
  });

  it.each(shapes)("re-reads %s to the same finding rather than losing it", (_label, input) => {
    const { codes, reReadCodes } = roundTrip(input);
    expect(codes).toEqual(["UNDEFINED_JSON_NULL"]);
    // The laundering, stated as the property that failed: the finding must survive the round trip.
    expect(reReadCodes).toEqual(codes);
  });

  it("the quantity is no longer indistinguishable from one written without a magnitude", () => {
    const withNull =
      '{"resourceType":"Observation","status":"final","valueQuantity":{"value":null,"unit":"mg"}}';
    const withoutValue =
      '{"resourceType":"Observation","status":"final","valueQuantity":{"unit":"mg"}}';
    const emittedFromNull = serializeResource(parseResource(withNull).resource);
    const emittedFromAbsent = serializeResource(parseResource(withoutValue).resource);
    // This equality is the defect, restated: the two documents used to emit the same bytes, so a
    // magnitude the sender wrote a `null` for came back as a conformant unit-only quantity.
    expect(emittedFromNull).not.toBe(emittedFromAbsent);
    expect(emittedFromAbsent).toBe(withoutValue);
    // A document that never wrote a `null` draws nothing, in either direction.
    expect(parseResource(withoutValue).issues).toEqual([]);
  });

  it("marks the node so a consumer walking the model directly can see it", () => {
    const { resource } = parseResource('{"resourceType":"Observation","status":null}');
    const status = getProperty(resource, "status");
    expect(status !== undefined && isUndefinedNull(status)).toBe(true);
  });
});

describe("padding is what §2.6.2.3 defines, and padding is untouched", () => {
  const padded =
    '{"resourceType":"Patient","name":[{"given":["Peter",null],' +
    '"_given":[null,{"extension":[{"url":"http://example.org/x","valueString":"y"}]}]}]}';

  it("draws no issue on the conformant null-padded repeating primitive", () => {
    expect(parseResource(padded).issues).toEqual([]);
  });

  it("round-trips it byte-for-byte, exactly as before", () => {
    expect(serializeResource(parseResource(padded).resource)).toBe(padded);
  });

  it("does not mark a padded slot", () => {
    const { resource } = parseResource(padded);
    const name = getProperty(resource, "name");
    const first = name !== undefined && isList(name) ? name.items[0] : undefined;
    const given = first?.kind === "complex" ? getProperty(first, "given") : undefined;
    const slot = given !== undefined && isList(given) ? given.items[1] : undefined;
    // The padded slot exists, and it is not marked: an absent node would pass a bare `false` check.
    expect(slot).toBeDefined();
    expect(slot !== undefined && isUndefinedNull(slot)).toBe(false);
  });

  it("an `id` pads just as an `extension` does, and a slot with neither does not", () => {
    // Inside the array, the second condition is what reached the slot: index 0 aligns with an `id`,
    // index 1 aligns with a `null`, so only the second is reported.
    const mixed =
      '{"resourceType":"Patient","name":[{"given":[null,null],"_given":[{"id":"a"},null]}]}';
    expect(parseResource(mixed).issues).toEqual([
      {
        code: "UNDEFINED_JSON_NULL",
        severity: "warning",
        expression: "Patient.name[0].given[1]",
      },
    ]);
    expect(serializeResource(parseResource(mixed).resource)).toBe(mixed);
  });

  it("a value-absent repeating primitive written the canonical way keeps its canonical shape", () => {
    // No `null` was written, so nothing is marked and the writer still emits the `_`-sibling alone
    // rather than an all-`null` value array it would have had to author.
    const canonical =
      '{"resourceType":"Patient","name":[{"_given":[{"extension":[{"url":"http://example.org/x","valueString":"y"}]}]}]}';
    expect(parseResource(canonical).issues).toEqual([]);
    expect(serializeResource(parseResource(canonical).resource)).toBe(canonical);
  });

  it("an EMPTY extension array is not metadata, and the read must agree with the writer", () => {
    // The two halves disagreeing here is a laundering bug, not a cosmetic one. `readMeta` sets
    // `extension: []` for `"extension":[]`, but the writer's `hasMeta` requires `length > 0`, so
    // treating the empty array as padding exempted the slot on the read and then deleted the member
    // on emit, with no diagnostic anywhere. That reproduced all three of the shapes at the top of
    // this file verbatim, past the fix meant to close them.
    const shapes = [
      '{"resourceType":"Observation","status":null,"_status":{"extension":[]}}',
      '{"resourceType":"Patient","identifier":[{"system":"http://hospital.example/mrn","value":null,"_value":{"extension":[]}}]}',
      '{"resourceType":"Observation","valueQuantity":{"value":null,"_value":{"extension":[]},"unit":"mg"}}',
      '{"resourceType":"Patient","name":[{"given":["Peter",null],"_given":[null,{"extension":[]}]}]}',
    ];
    for (const input of shapes) {
      const first = parseResource(input);
      expect(first.issues.map((issue) => issue.code)).toEqual(["UNDEFINED_JSON_NULL"]);
      // And the two reads must agree. The writer normalizes an empty `_`-sibling away, so a guard
      // that leaned on it affirmed read 1 and then flagged the writer's own output on read 2.
      const reRead = parseResource(serializeResource(first.resource));
      expect(reRead.issues).toEqual(first.issues);
    }
  });

  it("a singleton slot is NEVER padding, whatever `_`-sibling sits beside it", () => {
    // json.html §2.6.2.3 states the singleton encoding positively: a value-absent singleton renders
    // only the `_` property. So `{"active":null,"_active":{…}}` is not the padded form of anything,
    // and exempting it laundered the item's named quantity shape with zero diagnostics.
    const withExtension =
      '{"resourceType":"Patient","active":null,"_active":{"extension":[{"url":"http://example.org/x","valueString":"y"}]}}';
    const withId =
      '{"resourceType":"Observation","valueQuantity":{"value":null,"_value":{"id":"q1"},"unit":"mg"}}';
    for (const input of [withExtension, withId]) {
      expect(parseResource(input).issues.map((issue) => issue.code)).toEqual([
        "UNDEFINED_JSON_NULL",
      ]);
      // Reported and handed back, so the round trip is byte-identical rather than tidied up.
      expect(serializeResource(parseResource(input).resource)).toBe(input);
    }
    // The conformant spelling of the same intent carries no `null`, draws nothing, and is emitted
    // exactly as before: no round trip was withdrawn to buy the report above.
    const conformant =
      '{"resourceType":"Patient","_active":{"extension":[{"url":"http://example.org/x","valueString":"y"}]}}';
    expect(parseResource(conformant).issues).toEqual([]);
    expect(serializeResource(parseResource(conformant).resource)).toBe(conformant);
  });
});

describe("the set the code walks is what the reader read, not what FHIR types", () => {
  it("reports a singleton `null` at an element FHIR types as an object", () => {
    // The model is schema-free, so `Observation.subject` (a Reference) reaches the primitive branch
    // like any other singleton. Stated rather than implied: a description saying this code only ever
    // fires "in a primitive's value channel" would be false for every `0..1` object-typed element.
    for (const [input, expression] of [
      ['{"resourceType":"Observation","subject":null}', "Observation.subject"],
      ['{"resourceType":"AllergyIntolerance","code":null}', "AllergyIntolerance.code"],
      ['{"resourceType":"Patient","name":null}', "Patient.name"],
    ] as const) {
      expect(parseResource(input).issues).toEqual([
        { code: "UNDEFINED_JSON_NULL", severity: "warning", expression },
      ]);
      expect(serializeResource(parseResource(input).resource)).toBe(input);
    }
  });
});

describe("the neighbouring positions keep the codes they already drew", () => {
  // A widening that moves a case onto a new code breaks every consumer predicate written against
  // the old one. Nothing moved: these positions report what they always reported.
  it("a `null` where FHIR JSON has an object still draws only the unexpected-property warning", () => {
    const beside =
      '{"resourceType":"Patient","identifier":[{"system":"http://hospital.example/mrn"},null]}';
    expect(parseResource(beside).issues).toEqual([
      { code: "UNKNOWN_PROPERTY", severity: "warning", expression: "Patient.identifier[1]" },
    ]);
    expect(serializeResource(parseResource(beside).resource)).toBe(beside);
  });

  it("a `null` inside a primitive's extension array still draws only that warning", () => {
    const input = '{"resourceType":"Patient","active":true,"_active":{"extension":[null]}}';
    expect(parseResource(input).issues).toEqual([
      { code: "UNKNOWN_PROPERTY", severity: "warning", expression: "Patient.active.extension[0]" },
    ]);
  });
});

describe("what this deliberately does not do, pinned so it cannot move in silence", () => {
  it("does not refuse: the reader stays lenient and the writer still emits", () => {
    expect(() =>
      serializeResource(parseResource('{"resourceType":"Observation","status":null}').resource),
    ).not.toThrow();
  });

  it("does not move `valid` or `safeToSummarize`", () => {
    // A `null` carries no content, so nothing was unreadable at that position and the refusals that
    // exist for unreadable content are the wrong instrument. Characterization, not endorsement: if a
    // later slice decides the safety layer should decline here, this is the test that has to move.
    const { resource } = parseResource(
      '{"resourceType":"AllergyIntolerance","clinicalStatus":{"coding":[{"system":"http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical","code":null}]}}',
    );
    expect(readSafety(resource).safeToSummarize).toBe(true);
    expect(
      validateResource(
        parseResource('{"resourceType":"Patient","name":[{"given":[null]}]}').resource,
      ).valid,
    ).toBe(true);
  });

  it("leaves a `_`-sibling that is not an object to `UNKNOWN_PROPERTY`, not to this code", () => {
    // That channel used to be this code's declared gap: it drew nothing at all and the member was
    // deleted on emit. It is closed now, and closed on the neighbouring code rather than this one,
    // because it is the same observation the reader already makes at a complex position (something
    // FHIR JSON has an object for arrived as a scalar). See `underscore-sibling.test.ts` for the
    // whole of that behaviour; what is pinned here is that no case moved onto UNDEFINED_JSON_NULL.
    const input = '{"resourceType":"Observation","status":"final","_status":null}';
    expect(parseResource(input).issues).toEqual([
      { code: "UNKNOWN_PROPERTY", severity: "warning", expression: "Observation.status" },
    ]);
    expect(serializeResource(parseResource(input).resource)).toBe(input);
  });

  it("never marks a document read from XML, which has no `null`", () => {
    const { resource } = parseResourceXml(
      '<Observation xmlns="http://hl7.org/fhir"><status/></Observation>',
    );
    const status = getProperty(resource, "status");
    expect(status).toBeDefined();
    expect(status !== undefined && isUndefinedNull(status)).toBe(false);
    // And the XML writer is unchanged: a value-absent primitive still emits the empty element.
    expect(serializeResource(resource)).toBe('{"resourceType":"Observation"}');
  });
});
