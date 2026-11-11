/**
 * `readSafety` at every position the R4 and R4B definitions type as `Resource`, whether or not the
 * node there writes a `resourceType`.
 *
 * The positions are `DomainResource.contained`, `Bundle.entry.resource`,
 * `Bundle.entry.response.outcome`, `Parameters.parameter.resource` and, since `parameter.part`
 * repeats the `parameter` definition, `Parameters.parameter.part.resource` at any depth. A node at
 * one of them is a resource root. When it names no type, the layer cannot tell what its status
 * means, so the location is on `notAssessed` and the readout is never `safeToSummarize`: a Bundle
 * entry with no type and `status: entered-in-error` must not read as safe.
 *
 * Each position is read with a modeled type, with no type, in JSON and in XML, at the top and nested
 * two deep inside a Bundle entry.
 *
 * FIXTURES ARE SYNTHETIC: made-up ids, codes and text, and no person, name, date of birth or
 * address.
 */
import { describe, expect, it } from "vitest";

import {
  assertSafeToSummarize,
  FhirSafetyError,
  parseResource,
  parseResourceXml,
  readSafety,
  type FhirComplex,
} from "../src/index.js";

const NS = ' xmlns="http://hl7.org/fhir"';

/** One resource-typed position: a document holding `slot` there, in each format. */
interface Position {
  readonly name: string;
  /** The JSON document with `slot` at the position. */
  readonly json: (slot: unknown) => unknown;
  /** The XML document with `slot` (element content) at the position; `ns` goes on the root. */
  readonly xml: (slot: string, ns: string) => string;
  /** The position's location, relative to the document root's own location. */
  readonly at: string;
  /** Locations listed whatever the slot holds: the root of an unmodeled type. */
  readonly always: readonly string[];
}

const POSITIONS: readonly Position[] = [
  {
    name: "DomainResource.contained",
    json: (slot) => ({
      resourceType: "Observation",
      status: "final",
      code: { text: "Synthetic reading" },
      contained: [slot],
    }),
    xml: (slot, ns) =>
      `<Observation${ns}><contained>${slot}</contained><status value="final"/>` +
      `<code><text value="Synthetic reading"/></code></Observation>`,
    at: "contained[0]",
    always: [],
  },
  {
    name: "Bundle.entry.resource",
    json: (slot) => ({ resourceType: "Bundle", type: "collection", entry: [{ resource: slot }] }),
    xml: (slot, ns) =>
      `<Bundle${ns}><type value="collection"/><entry><resource>${slot}</resource></entry></Bundle>`,
    at: "entry[0].resource",
    always: [],
  },
  {
    name: "Bundle.entry.response.outcome",
    json: (slot) => ({
      resourceType: "Bundle",
      type: "batch-response",
      entry: [{ response: { status: "200 OK", outcome: slot } }],
    }),
    xml: (slot, ns) =>
      `<Bundle${ns}><type value="batch-response"/><entry><response>` +
      `<status value="200 OK"/><outcome>${slot}</outcome></response></entry></Bundle>`,
    at: "entry[0].response.outcome",
    always: [],
  },
  {
    name: "Parameters.parameter.resource",
    json: (slot) => ({
      resourceType: "Parameters",
      parameter: [{ name: "syn-param", resource: slot }],
    }),
    xml: (slot, ns) =>
      `<Parameters${ns}><parameter><name value="syn-param"/>` +
      `<resource>${slot}</resource></parameter></Parameters>`,
    at: "parameter[0].resource",
    always: [""],
  },
  {
    name: "Parameters.parameter.part.resource",
    json: (slot) => ({
      resourceType: "Parameters",
      parameter: [{ name: "syn-param", part: [{ name: "syn-part", resource: slot }] }],
    }),
    xml: (slot, ns) =>
      `<Parameters${ns}><parameter><name value="syn-param"/><part><name value="syn-part"/>` +
      `<resource>${slot}</resource></part></parameter></Parameters>`,
    at: "parameter[0].part[0].resource",
    always: [""],
  },
];

/** A slot that names a type this layer models. */
const TYPED_JSON = { resourceType: "Patient", id: "syn-pt-0001" };
const TYPED_XML = '<Patient><id value="syn-pt-0001"/></Patient>';
/** A slot that names no type at all, and is retracted. */
const TYPELESS_JSON = { id: "syn-x-0001", status: "entered-in-error" };
const TYPELESS_XML = '<id value="syn-x-0001"/><status value="entered-in-error"/>';

function rootName(position: Position): string {
  return (position.json(null) as { resourceType: string }).resourceType;
}

function at(base: string, relative: string): string {
  return relative === "" ? base : `${base}.${relative}`;
}

function readJson(document: unknown, nested: boolean): FhirComplex {
  const outer = nested
    ? { resourceType: "Bundle", type: "collection", entry: [{ resource: document }] }
    : document;
  return parseResource(JSON.stringify(outer)).resource;
}

/**
 * A location as the format reads it: XML does not know an element's cardinality, so an element
 * written once is not a list there and its location carries no index.
 */
function spelled(location: string, format: "json" | "xml"): string {
  return format === "json" ? location : location.replaceAll("[0]", "");
}

function readXml(position: Position, slot: string, nested: boolean): FhirComplex {
  const text = nested
    ? `<Bundle${NS}><type value="collection"/><entry><resource>` +
      `${position.xml(slot, "")}</resource></entry></Bundle>`
    : position.xml(slot, NS);
  return parseResourceXml(text).resource;
}

describe("a resource-typed position is a resource root whether or not it names a type", () => {
  for (const position of POSITIONS) {
    for (const nested of [false, true]) {
      const depth = nested ? "nested two deep" : "at the top";
      // The root the position's document reads at, top level or nested in a Bundle entry.
      const base = nested ? "Bundle.entry[0].resource" : rootName(position);
      const always = position.always.map((relative) => at(base, relative));
      const slot = at(base, position.at);

      describe(`${position.name}, ${depth}`, () => {
        it("a modeled type there is assessed (JSON and XML)", () => {
          for (const [resource, format] of [
            [readJson(position.json(TYPED_JSON), nested), "json"],
            [readXml(position, TYPED_XML, nested), "xml"],
          ] as const) {
            const safety = readSafety(resource);
            expect(safety.notAssessed, format).toEqual(always.map((p) => spelled(p, format)));
            expect(safety.safeToSummarize, format).toBe(always.length === 0);
          }
        });

        it("no type there is not assessed and never safe (JSON and XML)", () => {
          for (const [resource, format] of [
            [readJson(position.json(TYPELESS_JSON), nested), "json"],
            [readXml(position, TYPELESS_XML, nested), "xml"],
          ] as const) {
            const safety = readSafety(resource);
            expect(safety.notAssessed, format).toEqual(
              [...always, slot].map((p) => spelled(p, format)),
            );
            expect(safety.safeToSummarize, format).toBe(false);
            expect(safety.negations, format).toContain("entered-in-error");
            expect(() => assertSafeToSummarize(resource), format).toThrow(FhirSafetyError);
          }
        });
      });
    }
  }
});

describe("the reported cases", () => {
  it("a Bundle entry with no type and status entered-in-error is not safe", () => {
    const resource = parseResource(
      '{"resourceType":"Bundle","type":"collection",' +
        '"entry":[{"resource":{"id":"syn-x-0002","status":"entered-in-error"}}]}',
    ).resource;
    const safety = readSafety(resource);
    expect(safety.notAssessed).toEqual(["Bundle.entry[0].resource"]);
    expect(safety.safeToSummarize).toBe(false);
    expect(() => assertSafeToSummarize(resource)).toThrow(FhirSafetyError);
  });

  it("a contained resource with no type is not safe", () => {
    const resource = parseResource(
      '{"resourceType":"Observation","status":"final","code":{"text":"Synthetic reading"},' +
        '"contained":[{"id":"syn-x-0003","status":"entered-in-error"}]}',
    ).resource;
    const safety = readSafety(resource);
    expect(safety.notAssessed).toEqual(["Observation.contained[0]"]);
    expect(safety.safeToSummarize).toBe(false);
    expect(() => assertSafeToSummarize(resource)).toThrow(FhirSafetyError);
  });

  it("a Bundle entry with no type and status cancelled is not safe", () => {
    const resource = parseResource(
      '{"resourceType":"Bundle","type":"collection",' +
        '"entry":[{"resource":{"id":"syn-x-0004","status":"cancelled"}}]}',
    ).resource;
    const safety = readSafety(resource);
    expect(safety.notAssessed).toEqual(["Bundle.entry[0].resource"]);
    expect(safety.safeToSummarize).toBe(false);
  });

  it("a value at a resource position that is not an object is not assessed", () => {
    const resource = parseResource(
      '{"resourceType":"Bundle","type":"collection","entry":[{"resource":"syn-text"}]}',
    ).resource;
    const safety = readSafety(resource);
    expect(safety.notAssessed).toEqual(["Bundle.entry[0].resource"]);
    expect(safety.safeToSummarize).toBe(false);
    // The XML spelling: an empty `<resource/>` holds no resource element to unwrap.
    const text = `<Bundle${NS}><type value="collection"/><entry><resource/></entry></Bundle>`;
    const xml = readSafety(parseResourceXml(text).resource);
    expect(xml.notAssessed).toEqual(["Bundle.entry.resource"]);
    expect(xml.safeToSummarize).toBe(false);
  });

  it("an element named like a resource position elsewhere is not a resource root", () => {
    // `outcome` inside an Observation component is not a position R4 types as Resource.
    const safety = readSafety(
      parseResource(
        JSON.stringify({
          resourceType: "Observation",
          status: "final",
          code: { text: "Synthetic reading" },
          component: [{ code: { text: "Synthetic part" }, outcome: { text: "Synthetic" } }],
        }),
      ).resource,
    );
    expect(safety.notAssessed).toEqual([]);
  });
});
