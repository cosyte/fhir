/**
 * The safety walks one `validateResource` call shares between its layers, and the cheap tests the
 * walks ask at every node.
 *
 * A validator call walks each resource once for the safety channels and hands every layer that asks
 * the same answer, instead of walking again per channel. That must change nothing a caller sees: a
 * call inside a call (a terminology service that validates another resource) gets its own answers,
 * every accessor hands its caller a list of its own, and nothing outlives the call. Every document
 * here is synthetic.
 */

import { describe, expect, it } from "vitest";

import {
  arrayWrappedScalars,
  complex,
  modifierElements,
  parseResource,
  primitive,
  RXNORM_SYSTEM,
  shadowedProperties,
  unhandledModifierExtensions,
  validateResource,
  type TerminologyService,
  type ValidationResult,
} from "../src/index.js";
import { writesProperty } from "../src/model/node.js";
import { shareSafetyWalks } from "../src/safety/status.js";

/** A MedicationRequest whose medication code a terminology service is asked about. */
const ORDER =
  '{"resourceType":"MedicationRequest","status":"active","intent":"order",' +
  '"subject":{"reference":"Patient/synthetic-1"},' +
  `"medicationCodeableConcept":{"coding":[{"system":"${RXNORM_SYSTEM}","code":"7980"}]},` +
  '"modifierExtension":[{"url":"http://example.org/m","valueBoolean":true}]}';

/** A retracted Observation, written with a repeated name and an array wrapper. */
const RETRACTED =
  '{"resourceType":"Observation","status":"final","code":{"text":"x"},' +
  '"status":["entered-in-error"]}';

describe("validateResource shares the safety walks within one call", () => {
  it("answers a call made inside a call exactly as the same call made on its own", () => {
    const inner = parseResource(RETRACTED).resource;
    const alone = validateResource(inner);
    let nested: ValidationResult | undefined;
    const service: TerminologyService = {
      validateCode() {
        nested = validateResource(inner);
        return { membership: "unknown" };
      },
    };
    const outer = parseResource(ORDER).resource;
    const withService = validateResource(outer, { terminology: service });

    expect(nested?.issues).toEqual(alone.issues);
    expect(nested?.valid).toBe(alone.valid);
    expect(withService.issues).toEqual(validateResource(outer).issues);
  });

  it("hands every accessor's caller a list of its own while a walk is shared", () => {
    const resource = parseResource(RETRACTED).resource;
    shareSafetyWalks(() => {
      const first = arrayWrappedScalars(resource, "Observation");
      first.push("written by the caller");
      expect(arrayWrappedScalars(resource, "Observation")).toEqual(["Observation.status"]);
      const modifiers = unhandledModifierExtensions(resource, "Observation");
      modifiers.push("written by the caller");
      expect(unhandledModifierExtensions(resource, "Observation")).toEqual([]);
      expect(modifierElements(resource)).toEqual(modifierElements(resource));
    });
    expect(shadowedProperties(resource, "Observation")).toEqual(["Observation.status"]);
  });

  it("returns what the run returns, and keeps nothing once it has", () => {
    const resource = parseResource(ORDER).resource;
    const inside = shareSafetyWalks(() => unhandledModifierExtensions(resource, "X"));
    expect(inside).toEqual(["X.modifierExtension[0]"]);
    expect(unhandledModifierExtensions(resource, "X")).toEqual(inside);
  });
});

describe("writesProperty", () => {
  it("finds a member in properties, among the shadowed members, or nowhere", () => {
    const node = complex(
      [{ name: "status", value: primitive("final") }],
      [{ name: "code", value: primitive("c") }],
    );
    expect(writesProperty(node, "status")).toBe(true);
    expect(writesProperty(node, "code")).toBe(true);
    expect(writesProperty(node, "id")).toBe(false);
    expect(writesProperty(complex([]), "id")).toBe(false);
  });
});

describe("a modifier element named by a member spelled with its `_`", () => {
  // The readers merge a `_` sibling into its element, so only a model built by hand has a member
  // literally named `_active`. It is the same element, and is reported the same way.
  const patient = (name: string): ReturnType<typeof complex> =>
    complex([
      { name: "resourceType", value: primitive("Patient") },
      { name, value: primitive(undefined, { id: "a1" }) },
    ]);

  it("reports `_active` as `active`", () => {
    expect(modifierElements(patient("_active"))).toEqual([
      { element: "active", location: "Patient.active" },
    ]);
  });

  it("reports nothing for a name one longer that is not the `_` spelling", () => {
    expect(modifierElements(patient("activeX"))).toEqual([]);
    expect(modifierElements(patient("_activf"))).toEqual([]);
  });
});
