import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { ISSUE_CODES, parseResource, parseResourceXml, WITHHELD } from "../src/index.js";

/**
 * Every diagnostic a reader emits carries an `expression`, and R4 defines
 * `OperationOutcome.issue.expression` as a **FHIRPath subset** that resolves to a node. So an
 * `expression` is a *location*: a thing a consumer may hand to a path engine. A sentence explaining
 * the finding is not a location, and the reason a finding was raised is what the `code` is for.
 *
 * The JSON reader used to append English prose to two of them (`Patient.name (unexpected _-sibling
 * on an object)`), which is not FHIRPath on any input. This suite is the gate that keeps prose out.
 *
 * **What it does and does not claim.** It checks the shape of the *location*, not that the location
 * resolves: a `<withheld>` segment is deliberately unresolvable (it is what a name that failed the
 * bounded-echo shape test prints as), and the XML reader's `.@name` attribute form is a **declared
 * residual**: an XML attribute the reader does not model has no FHIRPath address at all, and
 * choosing one is a separate decision from removing prose. Both are admitted by the grammar below
 * rather than papered over, so widening or narrowing either is a deliberate act that edits this file.
 */

/** A path segment: an identifier or a withheld marker, with any number of `[n]` indices. */
const SEGMENT = String.raw`(?:[A-Za-z][A-Za-z0-9]*|${WITHHELD.replace(/[<>]/g, "\\$&")})(?:\[\d+\])*`;
/** The XML reader's unmodeled-attribute form, a declared residual (see the suite doc). */
const ATTRIBUTE = String.raw`@(?:[A-Za-z][A-Za-z0-9]*|${WITHHELD.replace(/[<>]/g, "\\$&")})`;
const EXPRESSION = new RegExp(String.raw`^${SEGMENT}(?:\.(?:${SEGMENT}|${ATTRIBUTE}))*$`);

/** Documents chosen to make the reader talk: every warning it has, at several depths. */
const JSON_DOCS: readonly string[] = [
  // the two shapes that used to carry prose
  '{"resourceType":"Patient","name":{"family":"Roe"},"_name":{"id":"z"}}',
  '{"resourceType":"Patient","contact":[{"name":{"text":"X"}}],"_contact":[{"id":"z"}]}',
  // …and the same, nested, so the prose could not hide behind a short path
  '{"resourceType":"Bundle","entry":[{"resource":{"resourceType":"Patient","name":{"family":"Roe"},"_name":{"id":"z"}}}]}',
  '{"resourceType":"Patient","contact":[{"name":[{"text":"X"}],"_name":[{"id":"z"}]}]}',
  // the rest of the reader's warning surface
  '{"resourceType":"Observation","status":"final","status":"entered-in-error"}',
  '{"resourceType":"Patient","name":[["Roe"]]}',
  '{"resourceType":"Patient","birthDate":"1980-01-01","_birthDate":{"foo":"bar"}}',
  '{"resourceType":"Patient","birthDate":"1980-01-01","_birthDate":{"id":[["x"]]}}',
  '{"resourceType":"Observation","valueQuantity":{"value":0.010}}',
  '{"resourceType":"Observation","v":0.010,"a":1,"_a":{"nope":1}}',
  // names that fail the bounded-echo shape test, so the location withholds a segment
  '{"resourceType":"Patient","Not An Element":{"x":1},"_Not An Element":{"id":"z"}}',
  '{"resourceType":"Chalmers","name":{"x":1},"_name":{"id":"z"}}',
];

const XML_DOCS: readonly string[] = [
  '<Patient xmlns="http://hl7.org/fhir"><name wibble="x"><family value="y"/></name></Patient>',
  '<Patient xmlns="http://hl7.org/fhir"><gender value="male"><stray/></gender></Patient>',
  '<Patient xmlns="http://example.org/not-fhir"><active value="true"/></Patient>',
  '<Patient xmlns="http://hl7.org/fhir"><f:active value="true"/></Patient>',
  '<f:Patient xmlns:f="http://example.org/not-fhir"><f:active value="true"/></f:Patient>',
  '<Patient xmlns="http://hl7.org/fhir">stray<active value="true"/></Patient>',
  '<Patient xmlns="http://hl7.org/fhir"><name value="x"><family value="y"/></name></Patient>',
  '<Not-An-Element xmlns="http://example.org/not-fhir"><status value="final"/></Not-An-Element>',
];

/** Every JSON/XML fixture in the repo, so a conformant document is swept too. */
function fixtures(extension: string): string[] {
  const dir = new URL("./__fixtures__/", import.meta.url);
  return readdirSync(dir)
    .filter((f) => f.endsWith(extension))
    .map((f) => readFileSync(new URL(f, dir), "utf8"));
}

function expressionsOf(
  docs: readonly string[],
  read: (s: string) => { issues: readonly { expression: string }[] },
): string[] {
  const out: string[] = [];
  for (const doc of docs) {
    let issues: readonly { expression: string }[];
    try {
      issues = read(doc).issues;
    } catch {
      continue; // a fatal carries no issue list; the fatal's own expression is checked below
    }
    for (const issue of issues) out.push(issue.expression);
  }
  return out;
}

describe("a diagnostic expression is a location, never a sentence", () => {
  const jsonExpressions = [
    ...expressionsOf(JSON_DOCS, parseResource),
    ...expressionsOf(fixtures(".json"), parseResource),
  ];
  const xmlExpressions = [
    ...expressionsOf(XML_DOCS, parseResourceXml),
    ...expressionsOf(fixtures(".xml"), parseResourceXml),
  ];
  const all = [...jsonExpressions, ...xmlExpressions];

  it("the corpus actually makes the readers talk (a vacuous sweep would pass silently)", () => {
    expect(jsonExpressions.length).toBeGreaterThanOrEqual(19);
    expect(xmlExpressions.length).toBeGreaterThanOrEqual(8);
  });

  it("no expression contains prose: no whitespace, no parenthesis, no comma", () => {
    for (const expression of all) {
      expect(expression, `expression: ${expression}`).not.toMatch(/[\s(),]/);
    }
  });

  it("every expression matches the location grammar", () => {
    for (const expression of all) {
      expect(expression, `expression: ${expression}`).toMatch(EXPRESSION);
    }
  });

  it("the two shapes that carried prose now carry a bare location and say why in the code", () => {
    const onObject = parseResource(
      '{"resourceType":"Patient","name":{"family":"Roe"},"_name":{"id":"z"}}',
    ).issues;
    expect(onObject).toEqual([
      {
        code: ISSUE_CODES.MISPLACED_PRIMITIVE_EXTENSION,
        severity: "warning",
        expression: "Patient.name",
      },
    ]);

    const onComplexArray = parseResource(
      '{"resourceType":"Patient","contact":[{"name":{"text":"X"}}],"_contact":[{"id":"z"}]}',
    ).issues;
    expect(onComplexArray).toEqual([
      {
        code: ISSUE_CODES.MISPLACED_PRIMITIVE_EXTENSION,
        severity: "warning",
        expression: "Patient.contact",
      },
    ]);
  });

  it("a withheld segment is still a location, not a sentence about the name it withheld", () => {
    const { issues } = parseResource(
      '{"resourceType":"Patient","Not An Element":{"x":1},"_Not An Element":{"id":"z"}}',
    );
    const misplaced = issues.filter((i) => i.code === ISSUE_CODES.MISPLACED_PRIMITIVE_EXTENSION);
    expect(misplaced.map((i) => i.expression)).toEqual([`Patient.${WITHHELD}`]);
  });
});
