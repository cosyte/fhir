/**
 * `use` on Identifier, HumanName, Address and ContactPoint, on the safety readout: the JSON read
 * path.
 *
 * R4 4.0.1 flags `use` Is Modifier on all four datatypes, each "so that applications should not
 * mistake a temporary or old" one "for a current/permanent one", and binds each `0..1` `use` to its
 * own value set at required strength. Until this channel existed a Patient carrying `use: "old"` on
 * an identifier, a name, an address or a telecom entry read `safeToSummarize: true` with nothing
 * surfaced. What is pinned here, criterion by criterion: a readable code is surfaced with its
 * location and leaves the verdict standing; anything else written at `use` is located, surfaces
 * nothing and refuses; the Practitioner rule is untouched; nested roots are read by the nearest
 * enclosing root only; and no channel carries document text.
 *
 * FIXTURES: every document in this file is an inline, synthetic JSON string written for it. No
 * value names, identifies or locates a person: the names are the repository's declared synthetic
 * tokens, the identifier and telecom values are placeholders, and no street line or date of birth
 * appears anywhere.
 */

import { describe, expect, it } from "vitest";

import {
  assertSafeToSummarize,
  FhirSafetyError,
  parseResource,
  readSafety,
  WITHHELD,
  type DatatypeUseCode,
  type SafetyReadout,
} from "../src/index.js";

/** The readout for a JSON document. */
function safetyOf(json: string): SafetyReadout {
  return readSafety(parseResource(json).resource);
}

/** The refusal `assertSafeToSummarize` raises for a JSON document, or `undefined` when it passes. */
function refusalOf(json: string): FhirSafetyError | undefined {
  try {
    assertSafeToSummarize(parseResource(json).resource);
    return undefined;
  } catch (error) {
    if (error instanceof FhirSafetyError) return error;
    throw error;
  }
}

/** The four datatypes and the R4 4.0.1 value set each one's `use` binds to (Definitions). */
const VALUE_SETS: Readonly<Record<string, readonly DatatypeUseCode[]>> = {
  Identifier: ["usual", "official", "temp", "secondary", "old"],
  HumanName: ["usual", "official", "temp", "nickname", "anonymous", "old", "maiden"],
  Address: ["home", "work", "temp", "old", "billing"],
  ContactPoint: ["home", "work", "temp", "old", "mobile"],
};

/** The twelve distinct strings the four value sets carry between them. */
const ALL_CODES: readonly DatatypeUseCode[] = [...new Set(Object.values(VALUE_SETS).flat())];

/**
 * A Patient document carrying `members` on one entry of the element that holds `datatype`, and the
 * location of that entry's `use`.
 */
function patientWith(
  datatype: string,
  members: string,
): { readonly json: string; readonly location: string } {
  const element = {
    Identifier: "identifier",
    HumanName: "name",
    Address: "address",
    ContactPoint: "telecom",
  }[datatype];
  if (element === undefined) throw new Error(`no position for ${datatype}`);
  return {
    json: `{"resourceType":"Patient","${element}":[{${members}}]}`,
    location: `Patient.${element}[0].use`,
  };
}

/**
 * The document AC-1 names, with one substitution: its family name is spelled with the repository's
 * declared synthetic token, `SynthFamily`, because the PHI gate reads a `family` literal in test
 * source against that declaration. No `use` reading depends on the family name.
 */
const AC1_PATIENT =
  '{"resourceType":"Patient","identifier":[{"use":"old","value":"S1"}],' +
  '"name":[{"use":"temp","family":"SynthFamily"}],"address":[{"use":"old","city":"Nowhere"}],' +
  '"telecom":[{"use":"old","system":"phone","value":"000"}]}';

describe("AC-1: a readable use is surfaced exactly as written, with its location, per position", () => {
  it("AC-1: surfaces all four datatypes on the AC-1 Patient", () => {
    expect(safetyOf(AC1_PATIENT).datatypeUses).toEqual([
      { code: "old", location: "Patient.identifier[0].use" },
      { code: "temp", location: "Patient.name[0].use" },
      { code: "old", location: "Patient.address[0].use" },
      { code: "old", location: "Patient.telecom[0].use" },
    ]);
  });

  it("AC-1: surfaces a Patient contact's name, telecom and address", () => {
    const safety = safetyOf(
      '{"resourceType":"Patient","contact":[{"name":{"use":"maiden","family":"SynthFamily"},' +
        '"telecom":[{"use":"mobile","system":"phone","value":"000"}],' +
        '"address":{"use":"billing","city":"Nowhere"}}]}',
    );

    expect(safety.datatypeUses).toEqual([
      { code: "maiden", location: "Patient.contact[0].name.use" },
      { code: "mobile", location: "Patient.contact[0].telecom[0].use" },
      { code: "billing", location: "Patient.contact[0].address.use" },
    ]);
  });

  it("AC-1: surfaces an Observation identifier", () => {
    expect(
      safetyOf(
        '{"resourceType":"Observation","status":"final","identifier":[{"use":"official","value":"O1"}]}',
      ).datatypeUses,
    ).toEqual([{ code: "official", location: "Observation.identifier[0].use" }]);
  });

  it("AC-1: surfaces a MedicationRequest groupIdentifier", () => {
    expect(
      safetyOf(
        '{"resourceType":"MedicationRequest","status":"active","intent":"order",' +
          '"groupIdentifier":{"use":"usual","value":"G1"}}',
      ).datatypeUses,
    ).toEqual([{ code: "usual", location: "MedicationRequest.groupIdentifier.use" }]);
  });

  it("AC-1: surfaces a Reference's identifier, and an Identifier's assigner identifier", () => {
    expect(
      safetyOf(
        '{"resourceType":"Observation","status":"final","subject":{"identifier":{"use":"temp","value":"T1"}}}',
      ).datatypeUses,
    ).toEqual([{ code: "temp", location: "Observation.subject.identifier.use" }]);
    expect(
      safetyOf(
        '{"resourceType":"Patient","identifier":[{"value":"S1","assigner":' +
          '{"identifier":{"use":"secondary","value":"A1"}}}]}',
      ).datatypeUses,
    ).toEqual([{ code: "secondary", location: "Patient.identifier[0].assigner.identifier.use" }]);
  });

  it("AC-1: a _use sibling beside a readable value does not change the reading", () => {
    const plain = safetyOf('{"resourceType":"Patient","identifier":[{"use":"old","value":"S1"}]}');
    for (const sibling of [
      '"_use":{"id":"u1"}',
      '"_use":{"extension":[{"url":"http://example.org/x","valueString":"y"}]}',
    ]) {
      const withSibling = safetyOf(
        `{"resourceType":"Patient","identifier":[{"use":"old",${sibling},"value":"S1"}]}`,
      );
      expect(withSibling.datatypeUses, sibling).toEqual(plain.datatypeUses);
      expect(withSibling.unreadableDatatypeUses, sibling).toEqual([]);
      expect(withSibling.safeToSummarize, sibling).toBe(true);
    }
  });
});

describe("AC-2: each of the 22 (datatype, code) pairs is surfaced, and no code off its own set", () => {
  for (const [datatype, codes] of Object.entries(VALUE_SETS)) {
    for (const code of codes) {
      it(`AC-2: ${datatype} surfaces ${code}`, () => {
        const { json, location } = patientWith(datatype, `"use":${JSON.stringify(code)}`);
        const safety = safetyOf(json);

        expect(safety.datatypeUses).toEqual([{ code, location }]);
        expect(safety.unreadableDatatypeUses).toEqual([]);
      });
    }
  }

  it("AC-2: the four sets hold 22 pairs over 12 distinct strings", () => {
    expect(Object.values(VALUE_SETS).flat()).toHaveLength(22);
    expect(ALL_CODES).toHaveLength(12);
  });

  for (const [datatype, codes] of Object.entries(VALUE_SETS)) {
    for (const code of ALL_CODES.filter((candidate) => !codes.includes(candidate))) {
      it(`AC-2: ${datatype} never surfaces ${code}, which its value set does not list`, () => {
        const { json, location } = patientWith(datatype, `"use":${JSON.stringify(code)}`);
        const safety = safetyOf(json);

        expect(safety.datatypeUses).toEqual([]);
        expect(safety.unreadableDatatypeUses).toEqual([location]);
      });
    }
  }
});

describe("AC-3: a document whose every use is surfaced keeps the verdict standing", () => {
  it("AC-3: the AC-1 Patient is safe to summarize, does not throw, and reports no use", () => {
    const safety = safetyOf(AC1_PATIENT);

    expect(safety.safeToSummarize).toBe(true);
    expect(refusalOf(AC1_PATIENT)).toBeUndefined();
    expect(safety.modifierElements).toEqual([]);
    expect(safety.unreadableDatatypeUses).toEqual([]);
  });

  for (const [datatype, codes] of Object.entries(VALUE_SETS)) {
    for (const code of codes) {
      it(`AC-3: ${datatype} ${code} leaves safeToSummarize true and reports no use`, () => {
        const { json } = patientWith(datatype, `"use":${JSON.stringify(code)}`);
        const safety = safetyOf(json);

        expect(safety.safeToSummarize).toBe(true);
        expect(refusalOf(json)).toBeUndefined();
        expect(safety.modifierElements.filter((report) => report.element === "use")).toEqual([]);
      });
    }
  }
});

/**
 * AC-4: the shapes that are not "exactly one `use` member holding one JSON string equal to a code
 * of this position's value set", each its own case. `members` replaces the entry's `use`.
 */
const UNREADABLE_SHAPES: readonly { readonly shape: string; readonly members: string }[] = [
  { shape: "a case variant", members: '"use":"OLD"' },
  { shape: "surrounding whitespace", members: '"use":" old"' },
  { shape: "the empty string", members: '"use":""' },
  { shape: "a JSON null", members: '"use":null' },
  { shape: "a number", members: '"use":1' },
  { shape: "a boolean", members: '"use":true' },
  { shape: "an object", members: '"use":{"value":"old"}' },
  {
    shape: "_use with no value",
    members: '"_use":{"extension":[{"url":"http://example.org/x","valueCode":"masked"}]}',
  },
  { shape: "an array wrapper", members: '"use":["old"]' },
  { shape: "the name written twice, same value", members: '"use":"old","use":"old"' },
  { shape: "the name written twice, two values", members: '"use":"old","use":"temp"' },
];

/** AC-4: a code from a sibling value set that this position's own set does not list. */
const CROSS_SET: readonly { readonly datatype: string; readonly code: string }[] = [
  { datatype: "Identifier", code: "maiden" },
  { datatype: "Address", code: "mobile" },
  { datatype: "ContactPoint", code: "billing" },
  { datatype: "Address", code: "nickname" },
  { datatype: "HumanName", code: "secondary" },
];

/** The AC-4 assertions for one document whose one covered `use` sits at `location`. */
function expectUnreadable(json: string, location: string): void {
  const safety = safetyOf(json);
  expect(safety.datatypeUses).toEqual([]);
  expect(safety.unreadableDatatypeUses).toEqual([location]);
  expect(safety.safeToSummarize).toBe(false);
  const refusal = refusalOf(json);
  expect(refusal, "assertSafeToSummarize must throw FhirSafetyError").toBeInstanceOf(
    FhirSafetyError,
  );
  expect(refusal?.locations).toContain(location);
}

describe("AC-4: a use that cannot be read is located, surfaces nothing and refuses", () => {
  for (const datatype of Object.keys(VALUE_SETS)) {
    for (const { shape, members } of UNREADABLE_SHAPES) {
      it(`AC-4: ${datatype}, ${shape}`, () => {
        const { json, location } = patientWith(datatype, members);
        expectUnreadable(json, location);
      });
    }
  }

  for (const { datatype, code } of CROSS_SET) {
    it(`AC-4: ${datatype}, ${code} from a sibling value set`, () => {
      const { json, location } = patientWith(datatype, `"use":${JSON.stringify(code)}`);
      expectUnreadable(json, location);
    });
  }

  it("AC-4: a contact's name, a groupIdentifier and a Reference identifier refuse the same way", () => {
    expectUnreadable(
      '{"resourceType":"Patient","contact":[{"name":{"use":"Maiden"}}]}',
      "Patient.contact[0].name.use",
    );
    expectUnreadable(
      '{"resourceType":"MedicationRequest","status":"active","intent":"order",' +
        '"groupIdentifier":{"use":"current"}}',
      "MedicationRequest.groupIdentifier.use",
    );
    expectUnreadable(
      '{"resourceType":"Observation","status":"final","subject":{"identifier":{"use":null}}}',
      "Observation.subject.identifier.use",
    );
  });
});

describe("AC-5: a covered position without use surfaces nothing and locates nothing", () => {
  it("AC-5: a Patient whose covered positions all lack use reads both channels empty", () => {
    const safety = safetyOf(
      '{"resourceType":"Patient","identifier":[{"value":"S1"}],"name":[{"family":"SynthFamily"}],' +
        '"address":[{"city":"Nowhere"}],"telecom":[{"system":"phone","value":"000"}],' +
        '"contact":[{"name":{"family":"SynthFamily"},"address":{"city":"Nowhere"}}]}',
    );

    expect(safety.datatypeUses).toEqual([]);
    expect(safety.unreadableDatatypeUses).toEqual([]);
    expect(safety.safeToSummarize).toBe(true);
  });

  it("AC-5: the verdict is whatever the other channels decide", () => {
    // `active` refuses on its own channel; the two new channels add nothing to that refusal.
    const safety = safetyOf(
      '{"resourceType":"Patient","active":true,"name":[{"family":"SynthFamily"}]}',
    );

    expect(safety.datatypeUses).toEqual([]);
    expect(safety.unreadableDatatypeUses).toEqual([]);
    expect(safety.safeToSummarize).toBe(false);
    expect(refusalOf('{"resourceType":"Patient","active":true}')?.locations).toEqual([
      "Patient.active",
    ]);
  });

  it("AC-5: one entry without use beside one with it surfaces the one that has it", () => {
    expect(
      safetyOf('{"resourceType":"Patient","name":[{"family":"SynthFamily"},{"use":"old"}]}')
        .datatypeUses,
    ).toEqual([{ code: "old", location: "Patient.name[1].use" }]);
  });
});

describe("AC-6: Practitioner.identifier.use stays on modifierElements, exactly as at the pin", () => {
  it("AC-6: the named Practitioner document reads as it does at the pin", () => {
    const safety = safetyOf(
      '{"resourceType":"Practitioner","identifier":[{"use":"official","value":"X"}]}',
    );

    expect(safety.modifierElements).toEqual([
      { element: "use", location: "Practitioner.identifier[0].use" },
    ]);
    expect(safety.safeToSummarize).toBe(false);
    expect(safety.datatypeUses).toEqual([]);
    expect(safety.unreadableDatatypeUses).toEqual([]);
  });

  for (const written of ['"old"', '"OLD"', "null", '["usual"]']) {
    it(`AC-6: a Practitioner identifier use of ${written} is reported and never surfaced`, () => {
      const safety = safetyOf(
        `{"resourceType":"Practitioner","identifier":[{"use":${written},"value":"X"}]}`,
      );

      expect(safety.modifierElements).toEqual([
        { element: "use", location: "Practitioner.identifier[0].use" },
      ]);
      expect(safety.datatypeUses).toEqual([]);
      expect(safety.unreadableDatatypeUses).toEqual([]);
    });
  }

  it("AC-6: a Practitioner's own names, telecoms and addresses stay off both new channels", () => {
    const safety = safetyOf(
      '{"resourceType":"Practitioner","name":[{"use":"old","family":"SynthFamily"}],' +
        '"telecom":[{"use":"OLD"}],"address":[{"use":"old"}]}',
    );

    expect(safety.datatypeUses).toEqual([]);
    expect(safety.unreadableDatatypeUses).toEqual([]);
    expect(safety.modifierElements).toEqual([]);
  });

  it("AC-6: a Practitioner contained in a Patient reports at the pin's location, surfaces nothing", () => {
    const safety = safetyOf(
      '{"resourceType":"Patient","contained":[{"resourceType":"Practitioner",' +
        '"identifier":[{"use":"official","value":"X"}]}]}',
    );

    expect(safety.modifierElements).toEqual([
      { element: "use", location: "Patient.contained[0].identifier[0].use" },
    ]);
    expect(safety.datatypeUses).toEqual([]);
    expect(safety.unreadableDatatypeUses).toEqual([]);
    expect(safety.safeToSummarize).toBe(false);
  });

  it("AC-6: a Practitioner in a Bundle entry reports at its entry, surfaces nothing", () => {
    const safety = safetyOf(
      '{"resourceType":"Bundle","type":"collection","entry":[{"resource":' +
        '{"resourceType":"Practitioner","identifier":[{"use":"usual","value":"X"}]}}]}',
    );

    expect(safety.modifierElements).toEqual([
      { element: "use", location: "Bundle.entry[0].resource.identifier[0].use" },
    ]);
    expect(safety.datatypeUses).toEqual([]);
    expect(safety.unreadableDatatypeUses).toEqual([]);
  });
});

describe("AC-7: nested roots of the eight types are read, and only by their nearest root", () => {
  it("AC-7: reads each Bundle entry at its own root", () => {
    const safety = safetyOf(
      '{"resourceType":"Bundle","type":"collection","entry":[' +
        '{"resource":{"resourceType":"Patient","name":[{"use":"old","family":"SynthFamily"}]}},' +
        '{"resource":{"resourceType":"Observation","status":"final","identifier":[{"use":"OLD"}]}}]}',
    );

    expect(safety.datatypeUses).toEqual([
      { code: "old", location: "Bundle.entry[0].resource.name[0].use" },
    ]);
    expect(safety.unreadableDatatypeUses).toEqual(["Bundle.entry[1].resource.identifier[0].use"]);
    expect(safety.safeToSummarize).toBe(false);
  });

  it("AC-7: reads a contained Patient once, at its own root, and not again from its container", () => {
    const safety = safetyOf(
      '{"resourceType":"Observation","status":"final","contained":[{"resourceType":"Patient",' +
        '"identifier":[{"use":"temp"}],"telecom":[{"use":"work","system":"phone","value":"000"}]}]}',
    );

    expect(safety.datatypeUses).toEqual([
      { code: "temp", location: "Observation.contained[0].identifier[0].use" },
      { code: "work", location: "Observation.contained[0].telecom[0].use" },
    ]);
  });

  it("AC-7: roots a location as modifierElements does, withheld outside the defined types", () => {
    const safety = safetyOf(
      '{"resourceType":"Foo","contained":[{"resourceType":"Patient","active":true,' +
        '"identifier":[{"use":"old"}],"name":[{"use":"OLD"}]}]}',
    );

    expect(safety.modifierElements).toEqual([
      { element: "active", location: `${WITHHELD}.contained[0].active` },
    ]);
    expect(safety.datatypeUses).toEqual([
      { code: "old", location: `${WITHHELD}.contained[0].identifier[0].use` },
    ]);
    expect(safety.unreadableDatatypeUses).toEqual([`${WITHHELD}.contained[0].name[0].use`]);
  });

  it("AC-7: a contained Organization's identifier and telecom use draw nothing", () => {
    for (const written of ['"old"', '"OLD"']) {
      const safety = safetyOf(
        '{"resourceType":"Patient","contained":[{"resourceType":"Organization",' +
          `"identifier":[{"use":${written}}],"telecom":[{"use":${written}}]}]}`,
      );

      expect(safety.datatypeUses, written).toEqual([]);
      expect(safety.unreadableDatatypeUses, written).toEqual([]);
      expect(safety.safeToSummarize, written).toBe(true);
    }
  });
});

describe("AC-8: an unreadable use carries none of the text the document wrote there", () => {
  const SENTINEL = "SENTINEL-USE-7101";
  const at = (members: string): string => members.replace("X", SENTINEL);

  const documents: readonly string[] = [
    `{"resourceType":"Patient","identifier":[{${at('"use":"X"')}}]}`,
    `{"resourceType":"Patient","name":[{${at('"use":"X"')}}]}`,
    `{"resourceType":"Patient","address":[{${at('"use":"X"')}}]}`,
    `{"resourceType":"Patient","telecom":[{${at('"use":"X"')}}]}`,
    `{"resourceType":"Patient","contact":[{"name":{${at('"use":"X"')}}}]}`,
    `{"resourceType":"MedicationRequest","intent":"order","groupIdentifier":{${at('"use":"X"')}}}`,
    `{"resourceType":"Observation","subject":{"identifier":{${at('"use":["X"]')}}}}`,
    `{"resourceType":"Patient","telecom":[{${at('"use":{"value":"X"}')}}]}`,
    `{"resourceType":"Patient","name":[{${at('"_use":{"extension":[{"url":"http://example.org/x","valueString":"X"}]}')}}]}`,
    `{"resourceType":"Bundle","type":"collection","entry":[{"resource":{"resourceType":"Patient","identifier":[{${at('"use":"X"')}}]}}]}`,
  ];

  for (const json of documents) {
    it(`AC-8: ${json}`, () => {
      const safety = safetyOf(json);
      const refusal = refusalOf(json);

      expect(safety.unreadableDatatypeUses).toHaveLength(1);
      expect(JSON.stringify(safety)).not.toContain(SENTINEL);
      expect(refusal).toBeInstanceOf(FhirSafetyError);
      expect(refusal?.message).not.toContain(SENTINEL);
      expect(JSON.stringify(refusal?.locations)).not.toContain(SENTINEL);
    });
  }

  it("AC-8: both channels carry only codes from Definitions and bounded locations", () => {
    // A forged key and a forged resource type sit on the path; neither reaches either channel.
    const FORGED_KEY = "SENTINEL-KEY-7102";
    const FORGED_TYPE = "SentinelTypeSevenOneZeroThree";
    const safety = safetyOf(
      `{"resourceType":"${FORGED_TYPE}","contained":[{"resourceType":"Patient",` +
        `"${FORGED_KEY}":{"identifier":{"use":"old"}},"name":[{"use":"${SENTINEL}"}]}]}`,
    );
    const segment = /^(?:[a-z][A-Za-z0-9]{0,63}|<withheld>)(?:\[\d+\])?$/;
    const root = /^(?:[A-Z][A-Za-z]{0,63}|<withheld>|\$this)$/;

    expect(safety.datatypeUses).toEqual([
      { code: "old", location: `${WITHHELD}.contained[0].${WITHHELD}.identifier.use` },
    ]);
    expect(safety.unreadableDatatypeUses).toEqual([`${WITHHELD}.contained[0].name[0].use`]);
    const locations = [
      ...safety.datatypeUses.map((read) => read.location),
      ...safety.unreadableDatatypeUses,
    ];
    for (const location of locations) {
      const [first, ...rest] = location.split(".");
      expect(first, location).toMatch(root);
      for (const part of rest) expect(part, location).toMatch(segment);
      for (const forged of [SENTINEL, FORGED_KEY, FORGED_TYPE]) {
        expect(location).not.toContain(forged);
      }
    }
    for (const read of safety.datatypeUses) expect(ALL_CODES).toContain(read.code);
  });
});
