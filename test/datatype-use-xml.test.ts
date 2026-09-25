/**
 * `use` on Identifier, HumanName, Address and ContactPoint, on the safety readout: the XML read
 * path reads the same as the JSON one.
 *
 * FHIR XML spells a repeat by repeating the element, so a single `<identifier>` is not an array in
 * the model and its location carries no index, where the JSON spelling of the same content does
 * (`Patient.identifier.use` against `Patient.identifier[0].use`). That is a property of the reader,
 * already pinned for `Practitioner.identifier.use` in the modifier-element XML suite, and not of
 * this channel. So each document below is written in a shape both readers index alike: a repeating
 * element carrying a `use` is written twice, and a `0..1` position (`groupIdentifier`, a Reference's
 * `identifier`) is indexed by neither. The AC-1 document is also read in its own single-entry
 * spelling, where the codes, the verdict and every location but that index agree. Its family name
 * is spelled `SynthFamily`, the repository's declared synthetic token, for the PHI gate; no `use`
 * reading depends on it.
 *
 * FIXTURES: every document in this file is an inline, synthetic XML or JSON string written for it.
 * No value names, identifies or locates a person.
 */

import { describe, expect, it } from "vitest";

import { parseResource, parseResourceXml, readSafety, type SafetyReadout } from "../src/index.js";

const NS = 'xmlns="http://hl7.org/fhir"';

/** One document in both spellings. */
interface Spelled {
  readonly json: string;
  readonly xml: string;
}

/** The JSON and XML readouts of one document. */
function readBoth({ json, xml }: Spelled): {
  readonly fromJson: SafetyReadout;
  readonly fromXml: SafetyReadout;
} {
  return {
    fromJson: readSafety(parseResource(json).resource),
    fromXml: readSafety(parseResourceXml(xml).resource),
  };
}

/** AC-9: the same codes, the same unreadable locations and the same verdict, from both readers. */
function expectSameReading(document: Spelled): SafetyReadout {
  const { fromJson, fromXml } = readBoth(document);
  expect(fromXml.datatypeUses, "datatypeUses").toEqual(fromJson.datatypeUses);
  expect(fromXml.unreadableDatatypeUses, "unreadableDatatypeUses").toEqual(
    fromJson.unreadableDatatypeUses,
  );
  expect(fromXml.safeToSummarize, "safeToSummarize").toBe(fromJson.safeToSummarize);
  return fromXml;
}

const MASKED = '<extension url="http://example.org/x"><valueCode value="masked"/></extension>';
const MASKED_JSON = '{"extension":[{"url":"http://example.org/x","valueCode":"masked"}]}';

describe("AC-9: the AC-1 document reads the same from XML as from JSON", () => {
  it("AC-9: the AC-1 document in its own spelling: same codes, same verdict, no unreadable", () => {
    const { fromJson, fromXml } = readBoth({
      json:
        '{"resourceType":"Patient","identifier":[{"use":"old","value":"S1"}],' +
        '"name":[{"use":"temp","family":"SynthFamily"}],"address":[{"use":"old","city":"Nowhere"}],' +
        '"telecom":[{"use":"old","system":"phone","value":"000"}]}',
      xml:
        `<Patient ${NS}><identifier><use value="old"/><value value="S1"/></identifier>` +
        `<name><use value="temp"/><family value="SynthFamily"/></name>` +
        `<address><use value="old"/><city value="Nowhere"/></address>` +
        `<telecom><use value="old"/><system value="phone"/><value value="000"/></telecom></Patient>`,
    });

    expect(fromXml.datatypeUses.map((read) => read.code)).toEqual(
      fromJson.datatypeUses.map((read) => read.code),
    );
    expect(fromXml.datatypeUses.map((read) => read.code)).toEqual(["old", "temp", "old", "old"]);
    expect(fromXml.unreadableDatatypeUses).toEqual([]);
    expect(fromJson.unreadableDatatypeUses).toEqual([]);
    expect(fromXml.safeToSummarize).toBe(true);
    expect(fromJson.safeToSummarize).toBe(true);
    // The one difference is the reader's: a single repeat carries no index in XML.
    expect(fromXml.datatypeUses.map((read) => read.location)).toEqual(
      fromJson.datatypeUses.map((read) => read.location.replace("[0]", "")),
    );
  });

  it("AC-9: the AC-1 content with each element repeated: every location agrees too", () => {
    const safety = expectSameReading({
      json:
        '{"resourceType":"Patient","identifier":[{"use":"old","value":"S1"},{"value":"S2"}],' +
        '"name":[{"use":"temp","family":"SynthFamily"},{"family":"SynthFamily"}],' +
        '"address":[{"use":"old","city":"Nowhere"},{"city":"Nowhere"}],' +
        '"telecom":[{"use":"old","system":"phone","value":"000"},{"system":"phone","value":"001"}]}',
      xml:
        `<Patient ${NS}>` +
        `<identifier><use value="old"/><value value="S1"/></identifier>` +
        `<identifier><value value="S2"/></identifier>` +
        `<name><use value="temp"/><family value="SynthFamily"/></name>` +
        `<name><family value="SynthFamily"/></name>` +
        `<address><use value="old"/><city value="Nowhere"/></address>` +
        `<address><city value="Nowhere"/></address>` +
        `<telecom><use value="old"/><system value="phone"/><value value="000"/></telecom>` +
        `<telecom><system value="phone"/><value value="001"/></telecom></Patient>`,
    });

    expect(safety.datatypeUses).toEqual([
      { code: "old", location: "Patient.identifier[0].use" },
      { code: "temp", location: "Patient.name[0].use" },
      { code: "old", location: "Patient.address[0].use" },
      { code: "old", location: "Patient.telecom[0].use" },
    ]);
    expect(safety.safeToSummarize).toBe(true);
  });
});

describe("AC-9: an unreadable use is located alike and refuses alike from XML", () => {
  const cases: readonly { readonly name: string; readonly document: Spelled; readonly at: string }[] =
    [
      {
        name: "an out-of-set code, mobile on an Address",
        document: {
          json: '{"resourceType":"Patient","address":[{"use":"home"},{"use":"mobile"}]}',
          xml:
            `<Patient ${NS}><address><use value="home"/></address>` +
            `<address><use value="mobile"/></address></Patient>`,
        },
        at: "Patient.address[1].use",
      },
      {
        name: "an out-of-set code, maiden on a groupIdentifier",
        document: {
          json: '{"resourceType":"MedicationRequest","intent":"order","groupIdentifier":{"use":"maiden"}}',
          xml:
            `<MedicationRequest ${NS}><intent value="order"/>` +
            `<groupIdentifier><use value="maiden"/></groupIdentifier></MedicationRequest>`,
        },
        at: "MedicationRequest.groupIdentifier.use",
      },
      {
        name: "a case variant, OLD on an Identifier",
        document: {
          json: '{"resourceType":"Patient","identifier":[{"use":"old"},{"use":"OLD"}]}',
          xml:
            `<Patient ${NS}><identifier><use value="old"/></identifier>` +
            `<identifier><use value="OLD"/></identifier></Patient>`,
        },
        at: "Patient.identifier[1].use",
      },
      {
        name: "a case variant, Maiden on a contact's name",
        document: {
          json: '{"resourceType":"Patient","contact":[{"name":{"use":"maiden"}},{"name":{"use":"Maiden"}}]}',
          xml:
            `<Patient ${NS}><contact><name><use value="maiden"/></name></contact>` +
            `<contact><name><use value="Maiden"/></name></contact></Patient>`,
        },
        at: "Patient.contact[1].name.use",
      },
      {
        name: "a use carrying only an extension, on a ContactPoint",
        document: {
          json: `{"resourceType":"Patient","telecom":[{"use":"work"},{"_use":${MASKED_JSON}}]}`,
          xml:
            `<Patient ${NS}><telecom><use value="work"/></telecom>` +
            `<telecom><use>${MASKED}</use></telecom></Patient>`,
        },
        at: "Patient.telecom[1].use",
      },
      {
        name: "a use carrying only an extension, on a Reference's identifier",
        document: {
          json: `{"resourceType":"Observation","status":"final","subject":{"identifier":{"_use":${MASKED_JSON}}}}`,
          xml:
            `<Observation ${NS}><status value="final"/>` +
            `<subject><identifier><use>${MASKED}</use></identifier></subject></Observation>`,
        },
        at: "Observation.subject.identifier.use",
      },
    ];

  for (const { name, document, at } of cases) {
    it(`AC-9: ${name}`, () => {
      const safety = expectSameReading(document);

      expect(safety.unreadableDatatypeUses).toEqual([at]);
      expect(safety.safeToSummarize).toBe(false);
    });
  }
});
