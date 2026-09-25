/**
 * FHIR-type tests (`is` / `as` / `ofType`, operator and function forms): answered where the instance
 * establishes the item's type, refused everywhere else, and value-free when refused.
 *
 * The three rules the engine answers by: R1, the item is a choice variant of the resource root
 * (`valueQuantity` on an Observation is a `Quantity`); R2, the item is the resource root; R3, a
 * model primitive is never a complex type and a complex node is never a primitive type.
 *
 * FIXTURES ARE SYNTHETIC throughout: coded values from public vocabularies, reserved `example.org`
 * hosts, `syn-` identifiers, and no person, name, date of birth or address.
 */
import { describe, expect, it } from "vitest";

import { classifyProjection, loadProjection, reportLines } from "../scripts/uscore-classify.js";
import {
  evaluateInvariant,
  getProperty,
  isComplex,
  loadStructureDefinition,
  parseFhirPath,
  parseResource,
  UnsupportedFhirPathError,
  validateResource,
  type FhirComplex,
  type FhirNode,
  type FpColl,
} from "../src/index.js";
import { evaluate } from "../src/fhirpath/evaluate.js";
import { req } from "./_util.js";

function parse(obj: unknown): FhirComplex {
  return parseResource(JSON.stringify(obj)).resource;
}

/** Evaluate `expression` with `focus` as `$this` inside `resource`. */
function run(expression: string, focus: FhirNode, resource: FhirComplex): FpColl {
  const at: FpColl = [{ t: "node", node: focus }];
  return evaluate(parseFhirPath(expression), at, { resource, context: at });
}

/** The single boolean an expression yields, or a failure. */
function answer(expression: string, resource: FhirComplex, focus: FhirNode = resource): boolean {
  const out = run(expression, focus, resource);
  const item = out[0];
  if (out.length !== 1 || item?.t !== "bool") throw new Error(`not one boolean: ${expression}`);
  return item.value;
}

/** Whether the engine refuses `expression`, reported unchecked and never satisfied. */
function refused(expression: string, resource: FhirComplex, focus: FhirNode = resource): boolean {
  expect(() => run(expression, focus, resource)).toThrow(UnsupportedFhirPathError);
  const complexFocus = isComplex(focus) ? focus : resource;
  return (
    JSON.stringify(evaluateInvariant(expression, complexFocus, resource)) ===
    JSON.stringify({ unchecked: true, satisfied: false })
  );
}

function property(node: FhirComplex, name: string): FhirNode {
  return req(getProperty(node, name));
}

const UCUM = "http://unitsofmeasure.org";
const quantityObs = parse({
  resourceType: "Observation",
  status: "final",
  code: { coding: [{ system: "http://loinc.org", code: "2339-0" }] },
  valueQuantity: { value: 95, unit: "mg/dL", system: UCUM, code: "mg/dL" },
  effectiveDateTime: "2020-01-01T08:00:00Z",
});
const ageCondition = parse({
  resourceType: "Condition",
  subject: { reference: "Patient/syn-1" },
  onsetAge: { value: 40, unit: "a", system: UCUM, code: "a" },
});
const male = parse({ resourceType: "Patient", gender: "male", deceasedBoolean: false });

describe("AC-10: a FHIR-type test the instance establishes is answered", () => {
  it("answers the exact type of a choice variant, in every form (R1)", () => {
    expect(answer("value is Quantity", quantityObs)).toBe(true);
    expect(answer("value.is(Quantity)", quantityObs)).toBe(true);
    expect(answer("value.ofType(Quantity).count() = 1", quantityObs)).toBe(true);
    expect(answer("(value as Quantity).exists()", quantityObs)).toBe(true);
    expect(answer("value.as(Quantity).exists()", quantityObs)).toBe(true);
    expect(answer("effective is dateTime", quantityObs)).toBe(true);
    expect(answer("deceased is boolean", male)).toBe(true);
  });

  it("answers the occurrence a profile constraint is anchored to, by where it sits in the resource (R1)", () => {
    const valueQuantity = property(quantityObs, "valueQuantity");
    expect(answer("$this is Quantity", quantityObs, valueQuantity)).toBe(true);
    expect(answer("ofType(Quantity).exists()", quantityObs, valueQuantity)).toBe(true);
    expect(answer("ofType(CodeableConcept).exists()", quantityObs, valueQuantity)).toBe(false);
  });

  it("matches an R4 specialization of Quantity, and not the reverse or a sibling", () => {
    expect(answer("onset is Age", ageCondition)).toBe(true);
    expect(answer("onset is Quantity", ageCondition)).toBe(true);
    expect(answer("onset.ofType(Quantity).exists()", ageCondition)).toBe(true);
    expect(answer("onset is Duration", ageCondition)).toBe(false);
    expect(answer("value is Age", quantityObs)).toBe(false);
  });

  it("answers a non-match for a type the package can establish that is neither", () => {
    expect(answer("value is CodeableConcept", quantityObs)).toBe(false);
    expect(answer("value.is(Period)", quantityObs)).toBe(false);
    expect(answer("value.ofType(CodeableConcept).empty()", quantityObs)).toBe(true);
    expect(answer("value.as(Range).empty()", quantityObs)).toBe(true);
    expect(answer("value is Observation", quantityObs)).toBe(false);
  });

  it("answers the resource root by its resourceType (R2)", () => {
    expect(answer("$this is Observation", quantityObs)).toBe(true);
    expect(answer("$this.is(Observation)", quantityObs)).toBe(true);
    expect(answer("$this is Patient", quantityObs)).toBe(false);
    expect(answer("$this is Quantity", quantityObs)).toBe(false);
  });

  it("answers a primitive against a complex type, and the reverse, as a non-match (R3)", () => {
    // `gender is Quantity` over `gender: "male"`: decided `false`, never guessed.
    expect(answer("gender is Quantity", male)).toBe(false);
    expect(evaluateInvariant("gender is Quantity", male, male)).toEqual({
      unchecked: false,
      satisfied: false,
    });
    expect(answer("gender.ofType(Quantity).exists()", male)).toBe(false);
    expect(answer("gender.is(CodeableConcept)", male)).toBe(false);
    expect(answer("gender is Patient", male)).toBe(false);
    expect(answer("value is string", quantityObs)).toBe(false);
    expect(answer("value.is(boolean)", quantityObs)).toBe(false);
    // A complex node is never a System primitive either, reached through a choice or not.
    expect(answer("value is String", quantityObs)).toBe(false);
    expect(answer("code is string", quantityObs)).toBe(false);
    expect(answer("code.ofType(Boolean).empty()", quantityObs)).toBe(true);
  });

  // AC-10's boundary with AC-13: R3 answers a complex node, and nothing else about the System
  // primitives moves.
  it("keeps a System-primitive test over a primitive exactly as before", () => {
    expect(answer("gender is String", male)).toBe(true);
    expect(answer("gender.ofType(Boolean).empty()", male)).toBe(true);
  });

  it("answers a qualified type name in every form, as the unqualified one (R1, R2, R3)", () => {
    const valueQuantity = property(quantityObs, "valueQuantity");
    if (!isComplex(valueQuantity)) throw new Error("expected a complex valueQuantity");
    for (const form of [
      "$this is FHIR.Quantity",
      "($this as FHIR.Quantity).exists()",
      "ofType(FHIR.Quantity).exists()",
      "$this.is(FHIR.Quantity)",
      "$this.as(FHIR.Quantity).exists()",
    ]) {
      expect(answer(form, quantityObs, valueQuantity), form).toBe(true);
      expect(evaluateInvariant(form, valueQuantity, quantityObs), form).toEqual({
        unchecked: false,
        satisfied: true,
      });
    }
    expect(answer("value.ofType(FHIR.CodeableConcept).empty()", quantityObs)).toBe(true);
    expect(answer("value.is(FHIR.Period)", quantityObs)).toBe(false);
    expect(answer("onset.ofType(FHIR.Quantity).exists()", ageCondition)).toBe(true);
    expect(answer("$this.is(FHIR.Observation)", quantityObs)).toBe(true);
    expect(answer("$this.is(FHIR.Patient)", quantityObs)).toBe(false);
    expect(answer("gender.ofType(FHIR.Quantity).empty()", male)).toBe(true);
    expect(answer("code.ofType(System.Boolean).empty()", quantityObs)).toBe(true);
    expect(answer("code.is(System.String)", quantityObs)).toBe(false);
  });
});

describe("AC-11: a FHIR-type test the instance does not establish is refused, never answered", () => {
  it("refuses a complex element not reached through a known choice element and not the root", () => {
    expect(refused("code is CodeableConcept", quantityObs)).toBe(true);
    expect(refused("code.coding.ofType(Coding).exists()", quantityObs)).toBe(true);
    const wrapped = parse({
      resourceType: "Observation",
      status: "final",
      code: { text: "synthetic" },
      valueQuantity: [{ value: 1, system: UCUM, code: "mg" }],
    });
    expect(refused("value is Quantity", wrapped)).toBe(true);
  });

  it("refuses a property named like a choice variant the package's tables do not declare there", () => {
    const patient = parse({ resourceType: "Patient", valueQuantity: { value: 1 } });
    expect(refused("value is Quantity", patient)).toBe(true);
    const component = parse({
      resourceType: "Observation",
      status: "final",
      code: { text: "synthetic" },
      component: [{ code: { text: "synthetic" }, valueQuantity: { value: 1 } }],
    });
    expect(refused("component.value is Quantity", component)).toBe(true);
    const extension = parse({
      resourceType: "Observation",
      status: "final",
      code: { text: "synthetic" },
      extension: [{ url: "http://example.org/ext", valueQuantity: { value: 1 } }],
    });
    expect(refused("extension.value is Quantity", extension)).toBe(true);
  });

  it("refuses a choice suffix whose kind contradicts the node", () => {
    const primitiveQuantity = parse({
      resourceType: "Observation",
      status: "final",
      code: { text: "synthetic" },
      valueQuantity: "5",
    });
    expect(refused("value is Quantity", primitiveQuantity)).toBe(true);
    const objectString = parse({
      resourceType: "Observation",
      status: "final",
      code: { text: "synthetic" },
      valueString: { text: "synthetic" },
    });
    expect(refused("value is string", objectString)).toBe(true);
    expect(refused("value is String", objectString)).toBe(true);
  });

  it("refuses a type name that resolves in neither the FHIR nor the System model", () => {
    expect(refused("value is Quantityy", quantityObs)).toBe(true);
    expect(refused("value.ofType(SimpleQuantity).exists()", quantityObs)).toBe(true);
    expect(refused("value.is(string1)", quantityObs)).toBe(true);
    expect(refused("gender is FHIR.String", male)).toBe(true);
    // Refused in function form even over an empty input: the name is resolved first.
    expect(refused("multipleBirth.is(string1)", male)).toBe(true);
    // Qualified: a model neither names, or a name the named model does not carry.
    expect(refused("value.ofType(HL7.Quantity).exists()", quantityObs)).toBe(true);
    expect(refused("value.is(FHIR.Quantity.value)", quantityObs)).toBe(true);
    expect(refused("$this.is(System.Observation)", quantityObs)).toBe(true);
    expect(refused("value.as(FHIR.String).exists()", quantityObs)).toBe(true);
  });

  it("refuses a qualified System name over a primitive in function form, as before", () => {
    expect(refused("gender.ofType(System.String).exists()", male)).toBe(true);
    expect(refused("gender.is(System.String)", male)).toBe(true);
  });

  it("refuses a relation between two types the package cannot establish", () => {
    expect(refused("value is Resource", quantityObs)).toBe(true);
    expect(refused("$this is Resource", quantityObs)).toBe(true);
    expect(refused("effective is date", quantityObs)).toBe(true);
    expect(refused("gender is code", male)).toBe(true);
  });

  it("refuses a focus found nowhere in the resource it is evaluated against", () => {
    const detached = parse({ resourceType: "Basic", valueQuantity: { value: 1 } });
    const elsewhere = property(detached, "valueQuantity");
    expect(refused("$this is Quantity", quantityObs, elsewhere)).toBe(true);
  });

  it("refuses a FHIR type over a value the engine computed itself", () => {
    expect(refused("'x' is Quantity", quantityObs)).toBe(true);
    expect(refused("'x'.is(String)", quantityObs)).toBe(true);
  });

  it("reports the refusal as INVARIANT_UNCHECKED at the profile layer", () => {
    const profile = req(
      loadStructureDefinition(
        parse({
          resourceType: "StructureDefinition",
          url: "http://example.org/StructureDefinition/type-test-refusal",
          type: "Observation",
          snapshot: {
            element: [
              {
                id: "Observation",
                path: "Observation",
                constraint: [
                  {
                    key: "tt-1",
                    severity: "error",
                    human: "probe",
                    expression: "code is CodeableConcept",
                  },
                ],
              },
            ],
          },
        }),
      ),
    );
    const found = validateResource(quantityObs, { profiles: [profile] }).issues.filter(
      (i) => i.constraint === "tt-1",
    );
    expect(found.map((i) => [i.code, i.severity])).toEqual([
      ["INVARIANT_UNCHECKED", "information"],
    ]);
  });
});

describe("AC-17: a refused type test or matches(), and the US Core report, carry no instance value", () => {
  const SENTINEL = "SENTINEL-8d41c";
  const carrier = parse({
    resourceType: "Observation",
    status: "final",
    code: { text: `${SENTINEL}\\d` },
    identifier: [
      { system: "http://example.org/ids", value: SENTINEL },
      { system: "http://example.org/ids", value: SENTINEL },
    ],
    valueString: SENTINEL,
    extension: [{ url: "http://example.org/ext", valueQuantity: { value: 1, unit: SENTINEL } }],
  });
  const declining = [
    "code is CodeableConcept",
    "extension.value is Quantity",
    "value is date",
    "value.is(Quantityy)",
    "identifier.value.matches('^x$')",
    "code.matches('x')",
    "value.matches('\\\\d')",
    "value.matches(code.text)",
  ];

  it("names no instance value in the refusal message", () => {
    for (const expression of declining) {
      let message = "";
      try {
        run(expression, carrier, carrier);
      } catch (error) {
        expect(error).toBeInstanceOf(UnsupportedFhirPathError);
        message = (error as Error).message;
      }
      expect(message, expression).not.toBe("");
      expect(message, expression).not.toContain(SENTINEL);
      expect(message, expression).not.toContain("8d41c");
    }
  });

  it("names no instance value in any invariant issue the refusals produce", () => {
    const profile = req(
      loadStructureDefinition(
        parse({
          resourceType: "StructureDefinition",
          url: "http://example.org/StructureDefinition/sentinel",
          type: "Observation",
          snapshot: {
            element: [
              {
                id: "Observation",
                path: "Observation",
                constraint: declining.map((expression, i) => ({
                  key: `sn-${String(i)}`,
                  severity: "error",
                  human: "probe",
                  expression,
                })),
              },
            ],
          },
        }),
      ),
    );
    const invariant = validateResource(carrier, { profiles: [profile] }).issues.filter(
      (i) => i.constraint?.startsWith("sn-") === true,
    );
    expect(invariant.map((i) => i.code)).toEqual(declining.map(() => "INVARIANT_UNCHECKED"));
    expect(JSON.stringify(invariant)).not.toContain("8d41c");
  });

  it("prints only version, profile, element, key and a classification from the projection", () => {
    const lines = reportLines(classifyProjection(loadProjection()));
    const row =
      /^(6\.1\.0|9\.0\.0) {2}[a-z0-9-]+ {2}[A-Za-z.[\]:]+ {2}[a-z0-9-]+ {2}(evaluated|declined: [A-Za-z]+\(\))$/;
    const rows = lines.slice(0, -3);
    expect(rows.length).toBe(63);
    for (const line of rows) expect(line).toMatch(row);
    for (const line of lines) expect(line).not.toContain("8d41c");
  });
});
