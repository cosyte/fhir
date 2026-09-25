/**
 * `matches(regex)`: decided over a single string and a pattern in the portable subset, refused
 * (unchecked, never satisfied) everywhere else, and empty over an empty input or pattern.
 *
 * The four US Core identifier patterns are read out of the committed projection
 * (`test/__data__/uscore-constraints.json`), never retyped.
 *
 * FIXTURES ARE SYNTHETIC throughout: made-up identifier values under reserved or public identifier
 * systems, and no person, name, date of birth or address.
 */
import { describe, expect, it } from "vitest";

import { loadProjection, type ProjectedConstraint } from "../scripts/uscore-classify.js";
import {
  evaluateInvariant,
  getProperty,
  isComplex,
  isList,
  parseFhirPath,
  parseResource,
  UnsupportedFhirPathError,
  type FpColl,
} from "../src/index.js";
import { evaluate } from "../src/fhirpath/evaluate.js";
import { req } from "./_util.js";

const PROJECTION = loadProjection();

function projected(profile: string, element: string, key: string): ProjectedConstraint {
  const found = PROJECTION.constraints.filter(
    (r) => r.version === "9.0.0" && r.profile === profile && r.element === element && r.key === key,
  );
  if (found.length !== 1) throw new Error(`expected one projected ${key}`);
  return found[0] as ProjectedConstraint;
}

/** A resource carrying the given identifiers, and those identifiers as focus nodes. */
function withIdentifiers(type: string, values: readonly (string | undefined)[]) {
  const resource = parseResource(
    JSON.stringify({
      resourceType: type,
      identifier: values.map((value) =>
        value === undefined
          ? { system: "http://example.org/ids" }
          : { system: "http://example.org/ids", value },
      ),
    }),
  ).resource;
  const list = req(getProperty(resource, "identifier"));
  const items = isList(list) ? list.items : [list];
  return { resource, identifiers: items.filter(isComplex) };
}

/** `evaluateInvariant` of `expression` at one identifier whose value is `value`. */
function atIdentifier(expression: string, value: string | undefined) {
  const { resource, identifiers } = withIdentifiers("Organization", [value]);
  return evaluateInvariant(expression, req(identifiers[0]), resource);
}

const SATISFIED = { unchecked: false, satisfied: true };
const NOT_SATISFIED = { unchecked: false, satisfied: false };
const UNCHECKED = { unchecked: true, satisfied: false };

describe("AC-8: the US Core identifier patterns are decided", () => {
  const us16 = projected("us-core-organization", "Organization.identifier:NPI", "us-core-16");

  it("us-core-16 decides a ten-digit value, and every near miss", () => {
    expect(atIdentifier(us16.expression, "1234567893")).toEqual(SATISFIED);
    expect(atIdentifier(us16.expression, "123456789")).toEqual(NOT_SATISFIED);
    expect(atIdentifier(us16.expression, "12345678930")).toEqual(NOT_SATISFIED);
    // `$` is the end of the input: a trailing line feed is not a ten-digit value.
    expect(atIdentifier(us16.expression, "1234567893\n")).toEqual(NOT_SATISFIED);
  });

  const others: readonly [ProjectedConstraint, string, string][] = [
    [
      projected("us-core-organization", "Organization.identifier:CLIA", "us-core-18"),
      "12D3456789",
      "12d3456789",
    ],
    [
      projected("us-core-organization", "Organization.identifier:NAIC", "us-core-19"),
      "12345",
      "1234",
    ],
    [
      projected("us-core-practitioner", "Practitioner.identifier:NCSBNID", "us-core-27"),
      "12345678",
      "12345679",
    ],
  ];
  for (const [row, matching, failing] of others) {
    it(`${row.key} decides one matching and one non-matching synthetic value`, () => {
      expect(atIdentifier(row.expression, matching)).toEqual(SATISFIED);
      expect(atIdentifier(row.expression, failing)).toEqual(NOT_SATISFIED);
    });
  }
});

describe("AC-9: matches() refuses what it cannot decide, and is empty over an empty input or pattern", () => {
  it("refuses an input of more than one item", () => {
    const { resource } = withIdentifiers("Organization", ["12345", "12345"]);
    expect(evaluateInvariant("identifier.value.matches('^[0-9]{5}$')", resource, resource)).toEqual(
      UNCHECKED,
    );
  });

  it("refuses an input that is not a string", () => {
    const patient = parseResource(
      JSON.stringify({ resourceType: "Patient", active: true, multipleBirthInteger: 2 }),
    ).resource;
    expect(evaluateInvariant("active.matches('true')", patient, patient)).toEqual(UNCHECKED);
    expect(evaluateInvariant("multipleBirth.matches('2')", patient, patient)).toEqual(UNCHECKED);
    const { resource } = withIdentifiers("Organization", ["12345"]);
    expect(evaluateInvariant("identifier.matches('1')", resource, resource)).toEqual(UNCHECKED);
  });

  it("refuses a pattern that does not compile", () => {
    expect(atIdentifier("value.matches('[0-9')", "12345")).toEqual(UNCHECKED);
    expect(atIdentifier("value.matches('(1')", "12345")).toEqual(UNCHECKED);
    expect(atIdentifier("value.matches('[9-0]')", "12345")).toEqual(UNCHECKED);
  });

  it("refuses a pattern whose meaning depends on the regular expression dialect", () => {
    for (const pattern of [
      "\\\\d{5}",
      "(?=1)1",
      "[[:digit:]]",
      "1(?i)2",
      "(1+)+",
      "[1&&2]",
      "a*?",
    ]) {
      expect(atIdentifier(`value.matches('${pattern}')`, "12345"), pattern).toEqual(UNCHECKED);
    }
  });

  it("refuses a pattern argument that is not one string", () => {
    const { resource, identifiers } = withIdentifiers("Organization", ["12345", "12345"]);
    expect(
      evaluateInvariant("value.matches(%resource.identifier.value)", req(identifiers[0]), resource),
    ).toEqual(UNCHECKED);
  });

  it("yields the empty collection over an empty input or an empty pattern", () => {
    const { resource, identifiers } = withIdentifiers("Organization", [undefined]);
    const at: FpColl = [{ t: "node", node: req(identifiers[0]) }];
    const ctx = { resource, context: at };
    expect(evaluate(parseFhirPath("value.matches('^[0-9]{5}$')"), at, ctx)).toEqual([]);
    expect(evaluate(parseFhirPath("'12345'.matches({})"), at, ctx)).toEqual([]);
    expect(evaluate(parseFhirPath("{}.matches({})"), at, ctx)).toEqual([]);
    // Empty is not a refusal: the invariant is decided, and empty is not satisfied.
    expect(evaluateInvariant("value.matches('^[0-9]{5}$')", req(identifiers[0]), resource)).toEqual(
      NOT_SATISFIED,
    );
    expect(() => evaluate(parseFhirPath("value.matches('^[0-9]{5}$')"), at, ctx)).not.toThrow(
      UnsupportedFhirPathError,
    );
  });
});
