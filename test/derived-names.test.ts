/**
 * The bound on a name the document supplies, and the surfaces it has to hold on.
 *
 * A finding carries a FHIRPath `expression` instead of a value, and that expression is assembled
 * out of the document's own `resourceType` and its own property names. On a conformant resource
 * those are element names. On anything else they are whatever the sender wrote, at whatever length
 * the sender wrote it, which is how document bytes reached a surface that promises to carry none.
 *
 * Three things are pinned here, and the third matters as much as the first two:
 *
 *  1. the shape test itself, against the published forms it is grounded in;
 *  2. every surface that builds a location out of a document-supplied name;
 *  3. **where the bound stops.** A shape test cannot tell an element name from a forgery shaped
 *     like one, so such a forgery is still echoed. That residue is pinned with live examples rather
 *     than described, because the failure mode this whole exercise came from was a sentence
 *     claiming more than the code did.
 */

import { describe, expect, it } from "vitest";

import { WITHHELD, childPath, rootPath, safeDerivedName } from "../src/model/path.js";
import {
  FhirCodecError,
  FhirSerializeError,
  parseResource,
  parseResourceXml,
  readSafety,
  serializeResource,
  serializeResourceXml,
  validateResource,
} from "../src/index.js";

/** A realistic forged name: a patient identity, which is not shaped like an element name. */
const FORGED = "Chalmers, Peter 1974-12-25";
/** A forgery that IS shaped like an element name. The bound does not stop this one, by design. */
const CONFORMING_FORGERY = "johnsmith";
/** Longer than the 64 characters a published element name may occupy. */
const OVERLONG = "a".repeat(65);

/** Every `expression` a document draws, from read, validation, and the safety readout. */
function locationsOfJson(text: string): string[] {
  const { resource, issues } = parseResource(text);
  const result = validateResource(resource);
  const safety = readSafety(resource);
  return [
    ...issues.map((i) => i.expression),
    ...result.issues.map((i) => i.expression),
    serializeResource(result.toOperationOutcome()),
    ...safety.unhandledModifierExtensions,
    ...safety.shadowedProperties,
    ...safety.arrayWrappedScalars,
    ...safety.nestedArrays,
  ];
}

/** The same for XML. */
function locationsOfXml(text: string): string[] {
  const { resource, issues } = parseResourceXml(text);
  const result = validateResource(resource);
  return [
    ...issues.map((i) => i.expression),
    ...result.issues.map((i) => i.expression),
    serializeResource(result.toOperationOutcome()),
  ];
}

/** Assert no location mentions the forged name, and that there were locations to check. */
function expectNoEcho(locations: readonly string[], forged: string): void {
  expect(
    locations.length,
    "the document drew no diagnostic, so this proves nothing",
  ).toBeGreaterThan(0);
  for (const location of locations) expect(location).not.toContain(forged);
}

describe("the shape test matches the published forms it claims to", () => {
  it("returns a sample of R4 element names unchanged, one at the 64-character cap", () => {
    for (const name of [
      "resourceType",
      "birthDate",
      "valueQuantity",
      "modifierExtension",
      "id",
      "url",
      "div",
      "entry",
      "a".repeat(64),
    ]) {
      expect(safeDerivedName(name, "elementName")).toBe(name);
    }
  });

  it("returns a sample of R4 resource type names unchanged, at both ends of the length range", () => {
    for (const type of [
      "Flag",
      "Goal",
      "List",
      "Slot",
      "Task",
      "Patient",
      "Observation",
      "AllergyIntolerance",
      "MedicinalProductUndesirableEffect",
    ]) {
      expect(safeDerivedName(type, "resourceTypeName")).toBe(type);
    }
  });

  it("withholds a name outside the element form", () => {
    for (const name of [
      FORGED,
      OVERLONG,
      "",
      "Chalmers",
      "birth date",
      "birth-date",
      "birth.date",
      "9223372036854775807",
      "_gender",
      "ZqPhI7xK",
    ]) {
      expect(safeDerivedName(name, "elementName")).toBe(WITHHELD);
    }
  });

  it("withholds a type outside the resource-type form", () => {
    for (const type of [
      FORGED,
      "A".repeat(65),
      "",
      "patient",
      "Patient1",
      "Patient Two",
      "ZqPhI7xK",
    ]) {
      expect(safeDerivedName(type, "resourceTypeName")).toBe(WITHHELD);
    }
  });

  it("joins a child onto its parent, and stands alone when there is no parent yet", () => {
    expect(childPath("Patient", "birthDate")).toBe("Patient.birthDate");
    expect(childPath("", "birthDate")).toBe("birthDate");
    expect(childPath("Patient", FORGED)).toBe(`Patient.${WITHHELD}`);
    expect(childPath("", FORGED)).toBe(WITHHELD);
    expect(rootPath("Patient")).toBe("Patient");
    expect(rootPath(FORGED)).toBe(WITHHELD);
  });
});

describe("no surface that builds a location out of a document name echoes a forged one", () => {
  it("the expression root, which prefixes every finding on the resource", () => {
    const locations = locationsOfJson(`{"resourceType":${JSON.stringify(FORGED)},"status":"x"}`);
    expectNoEcho(locations, FORGED);
    expect(locations).toContain(WITHHELD);
  });

  it("an unknown element on a resource the validator has a schema for", () => {
    const locations = locationsOfJson(`{"resourceType":"Patient",${JSON.stringify(FORGED)}:"x"}`);
    expectNoEcho(locations, FORGED);
    expect(locations).toContain(`Patient.${WITHHELD}`);
  });

  it("a repeated property name, reported by the reader and by the validator", () => {
    const locations = locationsOfJson(
      `{"resourceType":"Patient",${JSON.stringify(FORGED)}:"x",${JSON.stringify(FORGED)}:"y"}`,
    );
    expectNoEcho(locations, FORGED);
  });

  it("an array inside an array under a forged name, at the root and one level down", () => {
    expectNoEcho(
      locationsOfJson(`{"resourceType":"Patient",${JSON.stringify(FORGED)}:[["x"]]}`),
      FORGED,
    );
    expectNoEcho(
      locationsOfJson(`{"resourceType":"Patient","contact":{${JSON.stringify(FORGED)}:[["x"]]}}`),
      FORGED,
    );
  });

  it("a member of a primitive's `_`-sibling", () => {
    const locations = locationsOfJson(
      `{"resourceType":"Patient","gender":"male","_gender":{${JSON.stringify(FORGED)}:"x"}}`,
    );
    expectNoEcho(locations, FORGED);
  });

  it("a fail-closed modifier extension sitting under a forged name", () => {
    const locations = locationsOfJson(
      `{"resourceType":"Observation","status":"final",${JSON.stringify(FORGED)}:` +
        `{"modifierExtension":[{"url":"http://example.org/unknown"}]}}`,
    );
    expectNoEcho(locations, FORGED);
  });

  it("an unresolved reference reached through a forged name inside a Bundle", () => {
    const locations = locationsOfJson(
      `{"resourceType":"Bundle","type":"collection","entry":[{"resource":` +
        `{"resourceType":"Patient",${JSON.stringify(FORGED)}:{"reference":"Patient/nope"}}}]}`,
    );
    expectNoEcho(locations, FORGED);
  });

  it("a CodeableConcept-bearing resource, whose findings are rooted on the document's own type", () => {
    const locations = locationsOfJson(
      `{"resourceType":${JSON.stringify(FORGED)},"code":{"coding":[{"system":"http://example.org/x","code":"y"}]}}`,
    );
    expectNoEcho(locations, FORGED);
  });

  it("a dosage-bearing resource, whose findings are rooted on the document's own type", () => {
    const locations = locationsOfJson(
      `{"resourceType":${JSON.stringify(FORGED)},"dosageInstruction":[{"doseAndRate":[{"doseQuantity":{"value":5,"code":"mg"}}]}]}`,
    );
    expectNoEcho(locations, FORGED);
  });

  it("the XML root element name", () => {
    // An XML name cannot hold a space or a comma, so the forgery here is the shape an XML sender
    // can actually write: a hyphenated identity with a year in it.
    const xmlForged = "Chalmers-Peter-1974";
    const locations = locationsOfXml(
      `<${xmlForged} xmlns="http://example.org/not-fhir"><status value="final"/></${xmlForged}>`,
    );
    expectNoEcho(locations, xmlForged);
  });

  it("an XML stray child and an XML unknown attribute", () => {
    expectNoEcho(
      locationsOfXml(
        `<Patient xmlns="http://hl7.org/fhir"><gender value="male"><Chalmers/></gender></Patient>`,
      ),
      "Chalmers",
    );
    expectNoEcho(
      locationsOfXml(
        `<Patient xmlns="http://hl7.org/fhir"><gender value="male" Chalmers="x"/></Patient>`,
      ),
      "Chalmers",
    );
  });

  it("a thrown fatal, the one location channel the shared runner cannot sweep", () => {
    // A misaligned value/`_`-sibling pair fails closed with a typed error carrying an `expression`.
    // The shared runner collects what a parse RETURNED, so this route is asserted directly.
    const text = `{"resourceType":"Patient",${JSON.stringify(FORGED)}:["a","b"],${JSON.stringify(
      `_${FORGED}`,
    )}:[null]}`;
    let thrown: unknown;
    try {
      parseResource(text);
    } catch (err) {
      thrown = err;
    }
    expect(thrown, "the misaligned `_`-sibling must fail closed").toBeInstanceOf(FhirCodecError);
    const err = thrown as FhirCodecError;
    expect(err.code).toBe("PRIMITIVE_EXTENSION_MISALIGNED");
    expect(err.expression).not.toContain(FORGED);
    expect(err.message).not.toContain(FORGED);
    expect(err.stack ?? "").not.toContain(FORGED);
  });

  it("a refused serialization, the other location channel a parse sweep cannot reach", () => {
    // The writers refuse a model carrying character data the reader dropped, and the refusal names
    // the locations. That is a NEW location surface, reached by throwing rather than by returning,
    // so it is swept here directly like the fatal above.
    // The forged name has to be a legal XML name to reach the reader at all, so the overlong one is
    // the forgery this channel can actually carry; the dropped TEXT is the forgery beside it.
    const { resource } = parseResourceXml(
      `<Observation xmlns="http://hl7.org/fhir"><${OVERLONG}>${FORGED}</${OVERLONG}></Observation>`,
    );
    let thrown: unknown;
    try {
      serializeResourceXml(resource);
    } catch (err) {
      thrown = err;
    }
    expect(thrown, "a model with dropped text must not serialize").toBeInstanceOf(
      FhirSerializeError,
    );
    const err = thrown as FhirSerializeError;
    // Neither the dropped CONTENT nor the overlong NAME may reach the refusal.
    expect(err.message).not.toContain(FORGED);
    expect(err.message).not.toContain(OVERLONG);
    expect(err.locations).toEqual([`Observation.${WITHHELD}`]);
    expect(err.stack ?? "").not.toContain(FORGED);
    expect(err.stack ?? "").not.toContain(OVERLONG);
  });

  it("the one derived identifier the model surfaces", () => {
    const { resource } = parseResource(`{"resourceType":${JSON.stringify(FORGED)}}`);
    expect(readSafety(resource).resourceType).toBe(WITHHELD);
  });

  it("holds at a megabyte, which is the property the word `unbounded` named", () => {
    const huge = "b".repeat(1_000_000);
    const locations = locationsOfJson(`{"resourceType":"Patient",${JSON.stringify(huge)}:[["x"]]}`);
    expectNoEcho(locations, huge);
    for (const location of locations) expect(location.length).toBeLessThan(1000);
  });
});

describe("what the bound does NOT do, pinned so no prose can widen it", () => {
  it("still echoes a forgery that is genuinely shaped like an element name", () => {
    const locations = locationsOfJson(
      `{"resourceType":"Patient",${JSON.stringify(CONFORMING_FORGERY)}:"x"}`,
    );
    expect(locations).toContain(`Patient.${CONFORMING_FORGERY}`);
  });

  it("still echoes a forgery shaped like a resource type name", () => {
    const locations = locationsOfJson('{"resourceType":"Chalmers","status":"x"}');
    expect(locations).toContain("Chalmers");
  });

  it("collapses two withheld siblings into one nested-array location, and does not move the verdict", () => {
    // Both names withhold to the same segment, and the readout already collapses locations that
    // FHIRPath cannot tell apart. What must not change is the verdict, so that is asserted too.
    const { resource } = parseResource(
      `{"resourceType":"Patient","Aaa 1":[["x"]],"Bbb 2":[["y"]]}`,
    );
    const safety = readSafety(resource);
    expect(safety.nestedArrays).toEqual([`Patient.${WITHHELD}[0]`]);
    expect(safety.safeToSummarize).toBe(false);
    expect(validateResource(resource).valid).toBe(false);
  });

  it("leaves the model's own property names exactly as the document wrote them, and must", () => {
    // Bounding these would not be redaction, it would be data loss: the writer reproduces them, and
    // a round trip is the package's first claim. This is the residual a consumer that builds its own
    // location out of the model inherits, and it is stated rather than quietly bounded.
    const text = `{"resourceType":"Patient",${JSON.stringify(FORGED)}:"x"}`;
    const { resource } = parseResource(text);
    expect(resource.properties.map((p) => p.name)).toContain(FORGED);
    expect(serializeResource(resource)).toContain(FORGED);
  });
});
