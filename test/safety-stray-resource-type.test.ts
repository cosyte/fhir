/**
 * `readSafety` decides what is a resource by POSITION alone.
 *
 * A resource is the document root, or a value at a position the R4 and R4B definitions type as
 * `Resource` inside the resource that holds it: `DomainResource.contained`, `Bundle.entry.resource`,
 * `Bundle.entry.response.outcome`, `Parameters.parameter.resource` and `parameter.part.resource` at
 * any depth. A `resourceType` key anywhere else (on a Bundle entry, on a backbone element, on a
 * datatype) is a stray key: it never starts a new resource and never moves the scope used to find
 * the positions, so a typeless resource below it is still found. The node that carries it is listed
 * on `notAssessed`, since what such a document means is not known here.
 *
 * The fixed cases are the reported decoys; the properties plant a retracted or cancelled resource of
 * no type or an unmodeled type at a random resource position at random depth, with random stray keys
 * on every enclosing element, in JSON and in XML.
 *
 * FIXTURES ARE SYNTHETIC: made-up ids, codes and text, and no person, name, date of birth or
 * address.
 */
import fc from "fast-check";
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

function json(document: unknown): FhirComplex {
  return parseResource(JSON.stringify(document)).resource;
}

function xml(text: string): FhirComplex {
  return parseResourceXml(text).resource;
}

function expectDeclined(resource: FhirComplex, notAssessed: readonly string[]): void {
  const safety = readSafety(resource);
  expect(safety.notAssessed).toEqual(notAssessed);
  expect(safety.safeToSummarize).toBe(false);
  expect(() => assertSafeToSummarize(resource)).toThrow(FhirSafetyError);
}

const RETRACTED = { id: "syn-x-0101", status: "entered-in-error" };

describe("a stray resourceType never starts a resource or hides one", () => {
  it("a Bundle entry that writes resourceType Patient, over a typeless retracted resource", () => {
    expectDeclined(
      json({
        resourceType: "Bundle",
        type: "collection",
        entry: [{ resourceType: "Patient", resource: RETRACTED }],
      }),
      ["Bundle.entry[0]", "Bundle.entry[0].resource"],
    );
  });

  it("a Bundle entry that writes resourceType Bundle, over a typeless cancelled resource", () => {
    expectDeclined(
      json({
        resourceType: "Bundle",
        type: "collection",
        entry: [{ resourceType: "Bundle", resource: { id: "syn-x-0102", status: "cancelled" } }],
      }),
      ["Bundle.entry[0]", "Bundle.entry[0].resource"],
    );
  });

  it("an entry.response that writes resourceType Patient, over a typeless outcome", () => {
    expectDeclined(
      json({
        resourceType: "Bundle",
        type: "batch-response",
        entry: [{ response: { resourceType: "Patient", status: "200", outcome: RETRACTED } }],
      }),
      ["Bundle.entry[0].response", "Bundle.entry[0].response.outcome"],
    );
  });

  it("a Parameters parameter that writes resourceType Patient, over a typeless resource", () => {
    expectDeclined(
      json({
        resourceType: "Parameters",
        parameter: [{ resourceType: "Patient", name: "syn-param", resource: RETRACTED }],
      }),
      ["Parameters", "Parameters.parameter[0]", "Parameters.parameter[0].resource"],
    );
  });

  it("a stray resourceType on its own, over nothing typeless, still declines", () => {
    expectDeclined(
      json({
        resourceType: "Bundle",
        type: "collection",
        entry: [{ resourceType: "Patient", resource: { resourceType: "Patient", id: "syn-p" } }],
      }),
      ["Bundle.entry[0]"],
    );
    expectDeclined(
      json({
        resourceType: "Observation",
        status: "final",
        code: { resourceType: "Patient", text: "Synthetic reading" },
      }),
      ["Observation.code"],
    );
  });

  it("the XML decoy at entry and at entry.response", () => {
    expectDeclined(
      xml(
        `<Bundle${NS}><type value="collection"/><entry><resourceType value="Patient"/>` +
          `<resource><status value="entered-in-error"/></resource></entry></Bundle>`,
      ),
      ["Bundle.entry", "Bundle.entry.resource"],
    );
    expectDeclined(
      xml(
        `<Bundle${NS}><type value="batch-response"/><entry><response>` +
          `<resourceType value="Patient"/><status value="200"/>` +
          `<outcome><status value="entered-in-error"/></outcome></response></entry></Bundle>`,
      ),
      ["Bundle.entry.response", "Bundle.entry.response.outcome"],
    );
  });

  it("a modeled document with no stray key is still safe", () => {
    const safety = readSafety(
      json({
        resourceType: "Bundle",
        type: "collection",
        entry: [{ resource: { resourceType: "Patient", id: "syn-p" } }],
      }),
    );
    expect(safety.notAssessed).toEqual([]);
    expect(safety.safeToSummarize).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// The properties.

/**
 * Cases per property. The default keeps the ordinary suite quick; the fuzz depth (`FUZZ_RUNS`, 20000
 * in the CI fuzz job, `.github/workflows/ci.yml`, which the nightly run runs too) is the one to
 * judge the design at.
 */
const FUZZ_RUNS = Number.parseInt(process.env["FUZZ_RUNS"] ?? "", 10);
const RUNS = Number.isFinite(FUZZ_RUNS) && FUZZ_RUNS > 0 ? FUZZ_RUNS : 1000;

/**
 * A container resource, named for the resource position it offers: `contained` on an Observation,
 * `entry.resource` and `entry.response.outcome` on a Bundle, `parameter.resource` and
 * `parameter.part.resource` on a Parameters.
 */
type Container = "Observation" | "Bundle" | "BundleResponse" | "Parameters" | "ParametersPart";

/** An element a format writes: a name, attributes as primitive children, and child elements. */
interface Element {
  readonly name: string;
  /** Primitive children, written in order: `[name, value]`. */
  readonly primitives: readonly (readonly [string, string])[];
  /** Complex children, in order. */
  readonly children: readonly Element[];
  /** The resource this element holds, when it is a resource position. */
  readonly held?: Resource;
}

/** A resource: its type (or none) and its content, as an element whose name is the type. */
interface Resource {
  readonly type: string | undefined;
  readonly primitives: readonly (readonly [string, string])[];
  readonly children: readonly Element[];
}

/** A path from a root down to the planted resource, one step per enclosing resource. */
interface Step {
  readonly container: Container;
  /** Stray keys planted on each element between the container and the position, outermost first. */
  readonly strays: readonly (readonly (readonly [string, string])[])[];
}

/** Property names a stray key may take: resourceType always among them. */
const STRAY_NAME = fc.constantFrom("resourceType", "resourceType", "syn-note", "status", "id");
/** Values a stray resourceType may name: modeled, unmodeled, empty and odd. */
const STRAY_VALUE = fc.oneof(
  fc.constantFrom(
    "Patient",
    "Bundle",
    "Parameters",
    "Observation",
    "Basic",
    "ServiceRequest",
    "",
    "patient",
  ),
  fc.stringMatching(/^[A-Za-z]{1,12}$/),
);
const STRAY = fc.tuple(STRAY_NAME, STRAY_VALUE);
/** The stray keys on one enclosing element. */
const STRAYS: fc.Arbitrary<readonly (readonly [string, string])[]> = fc.array(STRAY, {
  maxLength: 3,
});
const NO_STRAYS: fc.Arbitrary<readonly (readonly [string, string])[]> = fc.constant([]);

/** How many elements lie between a container and its resource position. */
function between(container: Container): number {
  switch (container) {
    case "Observation":
      return 0;
    case "Bundle":
      return 1; // entry
    case "BundleResponse":
      return 2; // entry, response
    case "Parameters":
      return 1; // parameter
    case "ParametersPart":
      return 2; // parameter, part
  }
}

const CONTAINER = fc.constantFrom<Container>(
  "Observation",
  "Bundle",
  "BundleResponse",
  "Parameters",
  "ParametersPart",
);

function stepArbitrary(strays: boolean): fc.Arbitrary<Step> {
  return CONTAINER.chain((container) =>
    fc
      .array(strays ? STRAYS : NO_STRAYS, {
        minLength: between(container),
        maxLength: between(container),
      })
      .map((s) => ({ container, strays: s })),
  );
}

/**
 * The type of the planted resource: none, or one this layer does not model. Spelled so XML can
 * write it as a tag.
 */
const PLANTED_TYPE = fc.constantFrom(
  undefined,
  "Basic",
  "ServiceRequest",
  "Procedure",
  "Encounter",
);
const PLANTED_STATUS = fc.constantFrom("entered-in-error", "cancelled");

const MODELED_LEAF: Resource = {
  type: "Patient",
  primitives: [["id", "syn-pt-0201"]],
  children: [],
};

/** The modeled content each container writes beside its position, so it is safe on its own. */
function containerResource(container: Container, slot: Element, strays: Step["strays"]): Resource {
  const withStrays = (depth: number, element: Element): Element => ({
    ...element,
    primitives: [...(strays[depth] ?? []), ...element.primitives],
  });
  switch (container) {
    case "Observation":
      return {
        type: "Observation",
        primitives: [["status", "final"]],
        children: [
          { ...slot, name: "contained" },
          { name: "code", primitives: [["text", "Synthetic reading"]], children: [] },
        ],
      };
    case "Bundle":
      return {
        type: "Bundle",
        primitives: [["type", "collection"]],
        children: [withStrays(0, { name: "entry", primitives: [], children: [slot] })],
      };
    case "BundleResponse":
      return {
        type: "Bundle",
        primitives: [["type", "batch-response"]],
        children: [
          withStrays(0, {
            name: "entry",
            primitives: [],
            children: [
              withStrays(1, {
                name: "response",
                primitives: [["status", "200"]],
                children: [{ ...slot, name: "outcome" }],
              }),
            ],
          }),
        ],
      };
    case "Parameters":
      return {
        type: "Parameters",
        primitives: [],
        children: [
          withStrays(0, {
            name: "parameter",
            primitives: [["name", "syn-param"]],
            children: [slot],
          }),
        ],
      };
    case "ParametersPart":
      return {
        type: "Parameters",
        primitives: [],
        children: [
          withStrays(0, {
            name: "parameter",
            primitives: [["name", "syn-param"]],
            children: [
              withStrays(1, {
                name: "part",
                primitives: [["name", "syn-part"]],
                children: [slot],
              }),
            ],
          }),
        ],
      };
  }
}

/** The element at a resource position holding `resource`; the container renames it. */
function slotOf(resource: Resource): Element {
  return { name: "resource", primitives: [], children: [], held: resource };
}

/** Build the document: the steps from the outside in, then the planted resource innermost. */
function build(steps: readonly Step[], planted: Resource): Resource {
  let inner = planted;
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i] as Step;
    inner = containerResource(step.container, slotOf(inner), step.strays);
  }
  return inner;
}

// JSON spelling. A primitive child repeated by name becomes the first value (strays come first, so
// a stray `status` or `id` shadows nothing the container needs, but stays written).

function toJsonObject(primitives: Element["primitives"], children: readonly Element[]): object {
  const out: Record<string, unknown> = {};
  for (const [name, value] of primitives) if (!(name in out)) out[name] = value;
  for (const child of children) {
    const held = child.held;
    const value = held === undefined ? elementJson(child) : resourceJson(held);
    const name = child.name;
    // Every repeating element here (contained, entry, parameter, part) is an array in JSON.
    const list =
      name === "contained" || name === "entry" || name === "parameter" || name === "part";
    if (list) out[name] = [...((out[name] as unknown[] | undefined) ?? []), value];
    else out[name] = value;
  }
  return out;
}

function elementJson(element: Element): object {
  return toJsonObject(element.primitives, element.children);
}

function resourceJson(resource: Resource): object {
  const body = toJsonObject(resource.primitives, resource.children);
  return resource.type === undefined ? body : { resourceType: resource.type, ...body };
}

// XML spelling. A stray `resourceType` is an element like any other unknown one.

function escape(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

function xmlContent(primitives: Element["primitives"], children: readonly Element[]): string {
  let out = "";
  for (const [name, value] of primitives) out += `<${name} value="${escape(value)}"/>`;
  for (const child of children) {
    const held = child.held;
    const body =
      held === undefined ? xmlContent(child.primitives, child.children) : xmlResource(held, "");
    out += `<${child.name}>${body}</${child.name}>`;
  }
  return out;
}

function xmlResource(resource: Resource, ns: string): string {
  const body = xmlContent(resource.primitives, resource.children);
  // A typeless resource in XML is its content written straight inside the position's element.
  return resource.type === undefined ? body : `<${resource.type}${ns}>${body}</${resource.type}>`;
}

const PLANTED = fc.tuple(PLANTED_TYPE, PLANTED_STATUS).map(([type, status]): Resource => ({
  type,
  primitives: [
    ["id", "syn-x-0301"],
    ["status", status],
  ],
  children: [],
}));

function check(resource: FhirComplex): {
  safe: boolean;
  notAssessed: readonly string[];
  threw: boolean;
} {
  const safety = readSafety(resource);
  let threw = false;
  try {
    assertSafeToSummarize(resource);
  } catch (error) {
    threw = error instanceof FhirSafetyError;
  }
  return { safe: safety.safeToSummarize, notAssessed: safety.notAssessed, threw };
}

/** The root type of the document a container step builds. */
function rootTypeOf(container: Container): string {
  switch (container) {
    case "Observation":
      return "Observation";
    case "Bundle":
    case "BundleResponse":
      return "Bundle";
    case "Parameters":
    case "ParametersPart":
      return "Parameters";
  }
}

/**
 * The location of the planted resource: the root's type, then each container's way down to its
 * position. Every element on the way holds one item, which JSON writes in an array (`[0]`) for the
 * repeating ones and XML writes as a single element (no index).
 */
function plantedPath(steps: readonly Step[], format: "json" | "xml"): string {
  const one = format === "json" ? "[0]" : "";
  let path = rootTypeOf((steps[0] as Step).container);
  for (const step of steps) {
    switch (step.container) {
      case "Observation":
        path += `.contained${one}`;
        break;
      case "Bundle":
        path += `.entry${one}.resource`;
        break;
      case "BundleResponse":
        path += `.entry${one}.response.outcome`;
        break;
      case "Parameters":
        path += `.parameter${one}.resource`;
        break;
      case "ParametersPart":
        path += `.parameter${one}.part${one}.resource`;
        break;
    }
  }
  return path;
}

describe("property: a planted retracted resource of no or an unmodeled type always declines", () => {
  const steps = (strays: boolean) =>
    fc.array(stepArbitrary(strays), { minLength: 1, maxLength: 4 });

  it(`JSON, ${String(RUNS)} cases`, () => {
    fc.assert(
      fc.property(steps(true), PLANTED, (path, planted) => {
        const document = build(path, planted);
        const result = check(json(resourceJson(document)));
        expect(result).toEqual({ safe: false, notAssessed: result.notAssessed, threw: true });
        // The planted resource itself is listed, by its own location, whatever else is.
        expect(result.notAssessed).toContain(plantedPath(path, "json"));
      }),
      { numRuns: RUNS, seed: 20261111 },
    );
  });

  it(`XML, ${String(RUNS)} cases`, () => {
    fc.assert(
      fc.property(steps(true), PLANTED, (path, planted) => {
        const document = build(path, planted);
        const result = check(xml(xmlResource(document, NS)));
        expect(result).toEqual({ safe: false, notAssessed: result.notAssessed, threw: true });
        // The planted resource itself is listed, by its own location, whatever else is.
        expect(result.notAssessed).toContain(plantedPath(path, "xml"));
      }),
      { numRuns: RUNS, seed: 20261111 },
    );
  });

  it(`converse: only modeled resources at resource positions, no stray key, stays safe (${String(RUNS)} cases)`, () => {
    fc.assert(
      fc.property(steps(false), fc.boolean(), (path, asXml) => {
        // Only the modeled containers: Parameters is a type this layer does not model.
        const modeled = path.filter(
          (step) => step.container !== "Parameters" && step.container !== "ParametersPart",
        );
        fc.pre(modeled.length > 0);
        const document = build(modeled, MODELED_LEAF);
        const resource = asXml ? xml(xmlResource(document, NS)) : json(resourceJson(document));
        const safety = readSafety(resource);
        expect(safety.notAssessed).toEqual([]);
        expect(safety.safeToSummarize).toBe(true);
        expect(() => assertSafeToSummarize(resource)).not.toThrow();
      }),
      { numRuns: RUNS, seed: 20261111 },
    );
  });
});
