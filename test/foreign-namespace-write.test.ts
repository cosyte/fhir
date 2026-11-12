/**
 * Both writers refuse a model carrying an element the XML reader read from another vocabulary.
 *
 * The XML reader marks an element written in a namespace other than its parent's, and a root in a
 * namespace other than FHIR's, and `readSafety` declines both. Neither mark is part of what a writer
 * emits: JSON has no namespaces, and the XML writer puts every element in the FHIR namespace. So a
 * write and a re-read used to hand back the same document with the mark gone, and
 * `safeToSummarize` read `true` for a status the sender wrote in a vendor vocabulary.
 *
 * The writers now refuse such a model, the way they refuse dropped character data: the element in
 * another namespace on `UNSERIALIZABLE_FOREIGN_NAMESPACE`, in both writers, and the root in another
 * namespace on `UNSERIALIZABLE_FOREIGN_ROOT`, which the XML writer already raised and the JSON
 * writer now raises too.
 *
 * FIXTURES ARE SYNTHETIC: made-up ids, codes and text, and no person, name, date of birth or
 * address.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  assertSafeToSummarize,
  FhirSafetyError,
  FhirSerializeError,
  parseResource,
  parseResourceXml,
  readSafety,
  SERIALIZE_ERROR_CODES,
  serializeResource,
  serializeResourceXml,
  type FhirComplex,
} from "../src/index.js";

const NS = ' xmlns="http://hl7.org/fhir"';
const CODE = `<code><text value="syn"/></code>`;

function xml(text: string): FhirComplex {
  return parseResourceXml(text).resource;
}

/** Serialize, returning the refusal rather than throwing; any other error propagates. */
function refusal(
  write: (node: FhirComplex) => string,
  resource: FhirComplex,
): FhirSerializeError | undefined {
  try {
    write(resource);
    return undefined;
  } catch (err) {
    if (err instanceof FhirSerializeError) return err;
    throw err;
  }
}

/** Assert both writers refuse `resource` on `code`, at exactly `locations`. */
function expectBothRefuse(resource: FhirComplex, code: string, locations: readonly string[]): void {
  for (const write of [serializeResource, serializeResourceXml]) {
    const err = refusal(write, resource);
    expect(err, write.name).toBeInstanceOf(FhirSerializeError);
    expect(err?.code, write.name).toBe(code);
    expect(err?.locations, write.name).toEqual(locations);
  }
}

const FOREIGN = SERIALIZE_ERROR_CODES.UNSERIALIZABLE_FOREIGN_NAMESPACE;
const FOREIGN_ROOT = SERIALIZE_ERROR_CODES.UNSERIALIZABLE_FOREIGN_ROOT;

describe("a round trip cannot make an element in another namespace read safe", () => {
  const VENDOR_STATUS = `<Observation${NS}><status xmlns="urn:syn-vendor" value="final"/>${CODE}</Observation>`;

  it("declines on the read, and neither writer hands back a document to re-read", () => {
    const resource = xml(VENDOR_STATUS);
    expect(readSafety(resource).safeToSummarize).toBe(false);
    expectBothRefuse(resource, FOREIGN, ["Observation.status"]);
  });

  it("the same status in no namespace at all", () => {
    const resource = xml(`<Observation${NS}><status xmlns="" value="final"/>${CODE}</Observation>`);
    expectBothRefuse(resource, FOREIGN, ["Observation.status"]);
  });

  it("every position the reader marks: a repeat, a primitive's extension, a contained resource", () => {
    const resource = xml(
      `<Observation${NS}><contained><Practitioner xmlns="urn:syn-vendor"><id value="syn-pr-3"/>` +
        `</Practitioner></contained><status value="final">` +
        `<extension xmlns="urn:syn-vendor" url="http://example.org/syn"><valueString value="x"/>` +
        `</extension></status>${CODE}` +
        `<category><text value="syn-a"/></category><category xmlns=""><text value="syn-b"/>` +
        `</category></Observation>`,
    );
    expectBothRefuse(resource, FOREIGN, [
      "Observation.contained",
      "Observation.status.extension[0]",
      "Observation.category[1]",
    ]);
  });

  it("a narrative div in a vendor namespace is refused, and the XHTML one is written", () => {
    const vendor = xml(
      `<Observation${NS}><text><status value="generated"/>` +
        `<div xmlns="urn:syn-vendor">syn</div></text><status value="final"/>${CODE}</Observation>`,
    );
    expectBothRefuse(vendor, FOREIGN, ["Observation.text.div"]);
    const xhtml = xml(
      `<Observation${NS}><text><status value="generated"/>` +
        `<div xmlns="http://www.w3.org/1999/xhtml">syn</div></text><status value="final"/>` +
        `${CODE}</Observation>`,
    );
    expect(refusal(serializeResource, xhtml)).toBeUndefined();
    expect(refusal(serializeResourceXml, xhtml)).toBeUndefined();
  });

  it("carries no document content in the refusal: no namespace and no value", () => {
    const err = refusal(serializeResource, xml(VENDOR_STATUS));
    expect(err).toBeInstanceOf(FhirSerializeError);
    const surface = `${String(err?.message)} ${(err?.locations ?? []).join(" ")}`;
    for (const content of ["urn:syn-vendor", "final", "syn"]) {
      expect(surface).not.toContain(content);
    }
  });

  it("keeps the code a refusal raised before it: dropped text still reports dropped text", () => {
    const resource = xml(
      `<Observation${NS}><status xmlns="urn:syn-vendor">entered-in-error</status>${CODE}</Observation>`,
    );
    for (const write of [serializeResource, serializeResourceXml]) {
      expect(refusal(write, resource)?.code).toBe(SERIALIZE_ERROR_CODES.DROPPED_ELEMENT_TEXT);
    }
  });

  it("writes a document whose every element is in the FHIR namespace, as before", () => {
    const resource = xml(`<Observation${NS}><status value="final"/>${CODE}</Observation>`);
    expect(serializeResource(resource)).toBe(
      '{"resourceType":"Observation","status":"final","code":{"text":"syn"}}',
    );
    expect(serializeResourceXml(resource)).toBe(
      `<Observation${NS}><status value="final"/>${CODE}</Observation>`,
    );
  });
});

describe("a round trip through JSON cannot make a root in another namespace read safe", () => {
  const BODY = `<status value="final"/>${CODE}`;

  it("both writers refuse it, by default declaration or by prefix", () => {
    for (const text of [
      `<Observation xmlns="urn:syn-vendor">${BODY}</Observation>`,
      `<v:Observation xmlns:v="urn:syn-vendor"><v:status value="final"/>` +
        `<v:code><v:text value="syn"/></v:code></v:Observation>`,
    ]) {
      const resource = xml(text);
      expect(readSafety(resource).safeToSummarize).toBe(false);
      expectBothRefuse(resource, FOREIGN_ROOT, ["Observation"]);
    }
  });

  it("a root in no namespace at all is read as FHIR and written by both", () => {
    const resource = xml(`<Observation>${BODY}</Observation>`);
    expect(refusal(serializeResource, resource)).toBeUndefined();
    expect(refusal(serializeResourceXml, resource)).toBeUndefined();
  });
});

describe("FhirSafetyError lists each location once", () => {
  it("an element both dropped text and in another namespace is listed once", () => {
    const resource = xml(
      `<Observation${NS}><status xmlns="urn:syn-vendor">entered-in-error</status>${CODE}</Observation>`,
    );
    const safety = readSafety(resource);
    // The two channels each name the element; the refusal names it once.
    expect(safety.droppedText).toEqual(["Observation.status"]);
    expect(safety.notAssessed).toEqual(["Observation.status"]);
    let locations: readonly string[] = [];
    try {
      assertSafeToSummarize(resource);
    } catch (err) {
      expect(err).toBeInstanceOf(FhirSafetyError);
      locations = (err as FhirSafetyError).locations;
    }
    expect(locations).toEqual(["Observation.status"]);
  });

  it("keeps each location once, in the order it was first listed", () => {
    const resource = parseResource(
      '{"resourceType":"Observation","status":"final","status":"entered-in-error",' +
        '"code":{"text":"syn"},"nickname":"syn"}',
    ).resource;
    const safety = readSafety(resource);
    let locations: readonly string[] = [];
    try {
      assertSafeToSummarize(resource);
    } catch (err) {
      expect(err).toBeInstanceOf(FhirSafetyError);
      locations = (err as FhirSafetyError).locations;
    }
    expect(locations.length).toBeGreaterThan(0);
    expect(new Set(locations).size).toBe(locations.length);
    for (const location of [...safety.shadowedProperties, ...safety.notAssessed]) {
      expect(locations).toContain(location);
    }
  });
});

/**
 * The property: a synthetic resource read from FHIR XML, with one of its elements moved into another
 * namespace (or none), at the root or inside a Bundle entry. Whenever `readSafety` declines on the
 * mark, neither writer hands back a document; with nothing moved, both write and the re-read in
 * each format reads safe.
 */
const RUNS = Number(process.env["FUZZ_RUNS"] ?? 200);

/** Elements of an Observation, each one FHIR XML element, in R4 order. */
const OBSERVATION_MEMBERS: readonly string[] = [
  `<identifier><value value="syn-id-1"/></identifier>`,
  `<status value="final"/>`,
  `<category><text value="syn-category"/></category>`,
  CODE,
  `<subject><reference value="Patient/syn-pt-1"/></subject>`,
  `<valueQuantity><value value="1.50"/><unit value="mg"/></valueQuantity>`,
  `<note><text value="syn note"/></note>`,
];

/** Move the element at `index` into `namespace` by a default declaration on its start tag. */
function moveInto(members: readonly string[], index: number, namespace: string): string[] {
  return members.map((member, i) =>
    i === index ? member.replace(/^<([A-Za-z]+)/u, `<$1 xmlns="${namespace}"`) : member,
  );
}

const DOCUMENT = fc.record({
  members: fc.subarray([...OBSERVATION_MEMBERS.keys()], { minLength: 1 }),
  pick: fc.nat(),
  namespace: fc.option(fc.constantFrom("urn:syn-vendor", "urn:syn-other", ""), { nil: undefined }),
  inBundle: fc.boolean(),
});

describe("property: no write of a marked model re-reads safe", () => {
  it(`${String(RUNS)} cases`, () => {
    fc.assert(
      fc.property(DOCUMENT, ({ members, pick, namespace, inBundle }) => {
        const chosen = members.map((i) => OBSERVATION_MEMBERS[i] as string);
        const moved =
          namespace === undefined ? chosen : moveInto(chosen, pick % chosen.length, namespace);
        const observation = `<Observation${NS}>${moved.join("")}</Observation>`;
        const text = inBundle
          ? `<Bundle${NS}><type value="collection"/><entry><resource>${observation}` +
            `</resource></entry></Bundle>`
          : observation;
        const resource = xml(text);
        if (namespace !== undefined) {
          expect(readSafety(resource).safeToSummarize).toBe(false);
          for (const write of [serializeResource, serializeResourceXml]) {
            const err = refusal(write, resource);
            expect(err).toBeInstanceOf(FhirSerializeError);
            expect(err?.code).toBe(FOREIGN);
            expect(err?.locations).toHaveLength(1);
          }
          return;
        }
        // The converse: nothing moved, both writers write, and each re-read is as safe as the read.
        const safe = readSafety(resource).safeToSummarize;
        expect(
          readSafety(parseResource(serializeResource(resource)).resource).safeToSummarize,
        ).toBe(safe);
        expect(
          readSafety(parseResourceXml(serializeResourceXml(resource)).resource).safeToSummarize,
        ).toBe(safe);
      }),
      { numRuns: RUNS, seed: 20261111 },
    );
  });

  it(`every refusal re-reads nothing safe: a write that succeeds re-reads as the read (${String(RUNS)} cases)`, () => {
    fc.assert(
      fc.property(DOCUMENT, fc.boolean(), ({ members, pick, namespace, inBundle }, asJson) => {
        const chosen = members.map((i) => OBSERVATION_MEMBERS[i] as string);
        const moved =
          namespace === undefined ? chosen : moveInto(chosen, pick % chosen.length, namespace);
        const observation = `<Observation${NS}>${moved.join("")}</Observation>`;
        const text = inBundle
          ? `<Bundle${NS}><type value="collection"/><entry><resource>${observation}` +
            `</resource></entry></Bundle>`
          : observation;
        const resource = xml(text);
        const write = asJson ? serializeResource : serializeResourceXml;
        const read = asJson
          ? (out: string) => parseResource(out).resource
          : (out: string) => parseResourceXml(out).resource;
        let out: string;
        try {
          out = write(resource);
        } catch (err) {
          expect(err).toBeInstanceOf(FhirSerializeError);
          return;
        }
        // Whatever was written re-reads no safer than the model it came from.
        if (!readSafety(resource).safeToSummarize) {
          expect(readSafety(read(out)).safeToSummarize).toBe(false);
        }
      }),
      { numRuns: RUNS, seed: 20261111 },
    );
  });
});
