/**
 * The reads a small resource now makes without building lists or sets, held to the answers the
 * longer reads give on the shapes that take their less common branches: a `resourceType` a shared
 * list answers and one it does not, a `Coding` that repeats `code` with and without an array, a
 * `status` written twice, and a walk's lists collapsed only when they hold a repeat.
 */

import { describe, expect, it } from "vitest";

import {
  arrayWrappedScalars,
  complex,
  isRetracted,
  list,
  parseResource,
  primitive,
  readSafety,
  validateResource,
} from "../src/index.js";
import { typesOf } from "../src/safety/codes.js";

describe("typesOf", () => {
  it("answers a root naming one common type once with that type", () => {
    expect(typesOf(complex([{ name: "resourceType", value: primitive("Observation") }]))).toEqual([
      "Observation",
    ]);
    const shadowedNothing = {
      ...complex([{ name: "resourceType", value: primitive("Patient") }]),
      duplicates: [],
    };
    expect(typesOf(shadowedNothing)).toEqual(["Patient"]);
  });

  it("reads every type a root names whenever the shared list does not answer", () => {
    expect(
      typesOf(
        complex([
          { name: "resourceType", value: primitive("Observation") },
          { name: "resourceType", value: primitive("Patient") },
        ]),
      ),
    ).toEqual(["Observation", "Patient"]);
    expect(typesOf(complex([{ name: "resourceType", value: primitive("SynthType") }]))).toEqual([
      "SynthType",
    ]);
    expect(typesOf(complex([{ name: "resourceType", value: primitive(true) }]))).toEqual([]);
    expect(
      typesOf(complex([{ name: "resourceType", value: list([primitive("Observation")]) }])),
    ).toEqual(["Observation"]);
    expect(
      typesOf(
        complex(
          [{ name: "resourceType", value: primitive("Observation") }],
          [{ name: "resourceType", value: primitive("Patient") }],
        ),
      ),
    ).toEqual(["Observation", "Patient"]);
  });

  it("hands a caller a list it only reads, the same list each time", () => {
    const root = complex([{ name: "resourceType", value: primitive("Condition") }]);
    expect(typesOf(root)).toBe(typesOf(root));
  });
});

describe("a Coding that repeats a member", () => {
  const condition = (coding: string): string =>
    `{"resourceType":"Condition","verificationStatus":{"coding":[${coding}]},` +
    `"subject":{"reference":"Patient/SYNTH-1"}}`;

  it("reports an array in a repeated `code` at the Coding", () => {
    const { resource } = parseResource(
      condition('{"system":"http://example.org/synth","code":"confirmed","code":["refuted"]}'),
    );
    expect(arrayWrappedScalars(resource, "Condition")).toContain(
      "Condition.verificationStatus.coding[0].code",
    );
  });

  it("reports nothing for a repeated `code` with no array", () => {
    const { resource } = parseResource(
      condition('{"system":"http://example.org/synth","code":"confirmed","code":"refuted"}'),
    );
    expect(arrayWrappedScalars(resource, "Condition")).toEqual([]);
  });
});

describe("a status read at a resource root", () => {
  it("finds a retraction in a repeated or wrapped `status`, and none elsewhere", () => {
    const read = (text: string): boolean => isRetracted(parseResource(text).resource);
    expect(read('{"resourceType":"Observation","status":"final"}')).toBe(false);
    expect(
      read('{"resourceType":"Observation","status":"final","status":"entered-in-error"}'),
    ).toBe(true);
    expect(read('{"resourceType":"Observation","status":"final","status":"amended"}')).toBe(false);
    expect(read('{"resourceType":"Observation","status":["final","entered-in-error"]}')).toBe(true);
    expect(read('{"resourceType":"Observation","status":["final"]}')).toBe(false);
    expect(read('{"resourceType":"Observation","status":{"text":"entered-in-error"}}')).toBe(false);
  });
});

describe("the lists a safety walk collapses", () => {
  it("collapses a repeat and keeps a single entry", () => {
    // A resource a repeated name shadowed is walked at the same path as the one it shadowed.
    const entry = (intent: string): string =>
      `{"resourceType":"MedicationRequest","intent":"${intent}","status":"active"}`;
    const bundle = (intent: string): string =>
      `{"resourceType":"Bundle","type":"collection","entry":[{"resource":${entry(intent)},` +
      `"resource":${entry(intent)}}]}`;
    expect(readSafety(parseResource(bundle("order")).resource).intents).toEqual([
      { code: "order", location: "Bundle.entry[0].resource.intent" },
    ]);
    expect(readSafety(parseResource(bundle("synth")).resource).unreadableIntents).toEqual([
      "Bundle.entry[0].resource.intent",
    ]);
    const unknown = parseResource(
      '{"resourceType":"Observation","status":"final","code":{"text":"x"},' +
        '"synthMember":1,"synthMember":2,"synthOther":3}',
    ).resource;
    const elements = validateResource(unknown)
      .issues.filter((issue) => issue.code === "UNKNOWN_ELEMENT")
      .map((issue) => issue.expression);
    expect(elements).toEqual(["Observation.synthMember", "Observation.synthOther"]);
  });
});
