/**
 * The reads the walks now make without building lists, held to the answers they gave before on the
 * shapes that take their less common branches: a reference walk entered through its string-location
 * form, a `Coding` that repeats `system` or `code`, and a `resourceType` written as something other
 * than a string.
 */

import { describe, expect, it } from "vitest";

import { eachReference } from "../src/bundle/references.js";
import { codingsOf, complex, list, parseResource, primitive, readSafety } from "../src/index.js";
import { safetyCodingsOf, typesOf } from "../src/safety/codes.js";

describe("eachReference", () => {
  it("reports each reference at the location the string walk built, lists indexed", () => {
    const { resource } = parseResource(
      JSON.stringify({
        resourceType: "Observation",
        subject: { reference: "Patient/1" },
        performer: [{ reference: "Practitioner/2" }, { display: "none" }, { reference: "#c" }],
        "not a name": { reference: "Device/3" },
      }),
    );
    const seen: string[] = [];
    eachReference(resource, "Observation", (location, reference) => {
      seen.push(`${location} ${reference}`);
    });
    expect(seen).toEqual([
      "Observation.subject.reference Patient/1",
      "Observation.performer[0].reference Practitioner/2",
      "Observation.performer[2].reference #c",
      "Observation.<withheld>.reference Device/3",
    ]);
    const empty: string[] = [];
    eachReference(complex([{ name: "reference", value: primitive("Patient/1") }]), "", (at) => {
      empty.push(at);
    });
    expect(empty).toEqual([".reference"]);
  });
});

describe("the coding reads", () => {
  it("pairs every system with every code when a Coding repeats one, in member order", () => {
    const coding = complex(
      [
        { name: "system", value: primitive("http://snomed.info/sct") },
        { name: "code", value: primitive("a") },
      ],
      [{ name: "code", value: primitive("b") }],
    );
    const concept = complex([{ name: "coding", value: list([coding]) }]);
    expect(codingsOf(concept)).toEqual([
      { system: "http://snomed.info/sct", code: "a" },
      { system: "http://snomed.info/sct", code: "b" },
    ]);
    const twoSystems = complex(
      [{ name: "system", value: primitive("s1") }],
      [{ name: "system", value: primitive("s2") }],
    );
    expect(safetyCodingsOf(complex([{ name: "coding", value: twoSystems }]))).toEqual([
      { system: "s1", code: undefined },
      { system: "s2", code: undefined },
    ]);
    expect(codingsOf(complex([{ name: "coding", value: complex([]) }]))).toEqual([
      { system: undefined, code: undefined },
    ]);
    // A model built by hand can hold a member only among the shadowed ones.
    const onlyShadowed = complex([], [{ name: "code", value: primitive("c") }]);
    expect(codingsOf(complex([{ name: "coding", value: onlyShadowed }]))).toEqual([
      { system: undefined, code: "c" },
    ]);
  });
});

describe("typesOf", () => {
  it("reads strings through a wrapper and nothing out of an object", () => {
    const wrapped = complex([
      { name: "resourceType", value: list([primitive("Observation"), primitive(true)]) },
    ]);
    expect(typesOf(wrapped)).toEqual(["Observation"]);
    expect(typesOf(complex([{ name: "resourceType", value: complex([]) }]))).toEqual([]);
    expect(
      typesOf(
        complex(
          [{ name: "resourceType", value: primitive("Observation") }],
          [{ name: "resourceType", value: primitive("Patient") }],
        ),
      ),
    ).toEqual(["Observation", "Patient"]);
  });
});

describe("the use reads", () => {
  it("read a Practitioner identifier written as one object, and skip a list item that is not one", () => {
    const practitioner = parseResource(
      JSON.stringify({ resourceType: "Practitioner", identifier: { use: "official", value: "1" } }),
    ).resource;
    expect(readSafety(practitioner).modifierElements).toEqual([
      { element: "use", location: "Practitioner.identifier.use" },
    ]);
    const patient = complex([
      { name: "resourceType", value: primitive("Patient") },
      {
        name: "identifier",
        value: list([primitive("x"), complex([{ name: "use", value: primitive("usual") }])]),
      },
    ]);
    expect(readSafety(patient).datatypeUses).toEqual([
      { code: "usual", location: "Patient.identifier[1].use" },
    ]);
  });
});
