/**
 * A profile invariant that **orders two model values** (`start <= end`, the shape of R4's `per-1`),
 * pinned at the layer that decides an issue code, a severity and `valid`.
 *
 * Why this file exists rather than another `describe` in `fhirpath.test.ts`: the evaluator's own
 * tests grade a collection or an `{ unchecked, satisfied }` pair, and neither is a finding. Between
 * them sits `src/profiles/invariants.ts`, which turns "the engine refused" into
 * `INVARIANT_UNCHECKED` at *information*, "the engine answered false" and "the engine answered
 * nothing" alike into `INVARIANT_VIOLATED` at the constraint's own severity, and only the second
 * makes `validateResource(...).valid` false. A change to how the engine orders a date moves a
 * document between those outcomes, and nothing under `test/fhirpath*.test.ts` can see it happen.
 *
 * Four readings are pinned here, one per direction a remedy can move a document:
 *
 * 1. **Two offsets order by the instants they name.** `13:00:00+02:00` is `11:00:00Z`, so a period
 *    written that way against a `10:00:00Z` end is genuinely inverted and stays reported. Refusing
 *    the pair instead reported `INVARIANT_UNCHECKED` and handed the caller `valid: true` for a
 *    document this package rejects, which is the one direction the fail-safe contract forbids.
 * 2. **A precision difference is undetermined, and the invariant layer's shipped coercion makes an
 *    undetermined constraint a violation.** This is an ADDITION: comparing the two lexically
 *    answered `true` and reported nothing. It is not a free choice, the shared corpus grades
 *    `testPeriodInvariantOld` over exactly this document and expects `false`, and `evaluateInvariant`
 *    documents `empty → not satisfied` as matching the reference validator's coercion. Pinned so the
 *    addition is visible rather than asserted away.
 * 3. **A model value that is not temporal is UNDETERMINED, not unsupported.** `{}` and the lexical
 *    `false` coerce alike, so `gender > 'test'` keeps its `INVARIANT_VIOLATED` at *error* with
 *    `valid: false`; refusing it instead removed and re-severitied that finding in one step. The
 *    cost the empty collection does carry is an ADDITION, where the lexical guess used to answer
 *    `true` and satisfy the constraint, and that is pinned beside it.
 * 4. **A type test over an empty operand is `{}`, and `{}` does not compose the way `false` does.**
 *    `not()` and a three-valued `implies` both turn it into a violation the shipped package did not
 *    report. Another addition, pinned so the blast-radius sentence in the shipped record has a test
 *    under it rather than a claim.
 */
import { describe, expect, it } from "vitest";

import {
  collectInvariantIssues,
  loadStructureDefinition,
  parseResource,
  validateResource,
  type StructureDefinition,
} from "../src/index.js";
import { req } from "./_util.js";

function parse(obj: unknown) {
  return parseResource(JSON.stringify(obj)).resource;
}

/** R4 `per-1`, verbatim, over every `Period` the resource carries. */
const PER_ONE =
  "identifier.period.all(start.hasValue().not() or end.hasValue().not() or (start <= end))";

/** A caller-supplied profile, which is the only way a profile arrives (the package bundles none). */
function profileWith(expression: string): StructureDefinition {
  return req(
    loadStructureDefinition(
      parse({
        resourceType: "StructureDefinition",
        url: "http://example.org/StructureDefinition/ordering",
        type: "Patient",
        snapshot: {
          element: [
            {
              id: "Patient",
              path: "Patient",
              constraint: [
                {
                  key: "per-1",
                  severity: "error",
                  human: "if present, start SHALL have a lower value than end",
                  expression,
                },
              ],
            },
          ],
        },
      }),
    ),
  );
}

const perOne = profileWith(PER_ONE);

function patientWithPeriod(start: string, end: string) {
  return parse({
    resourceType: "Patient",
    identifier: [{ system: "http://example.org/ids", value: "SYN-0001", period: { start, end } }],
  });
}

/** The issue code and severity pairs a profile run reports, which is what "a finding" means here. */
function findings(resource: ReturnType<typeof parse>, profile: StructureDefinition) {
  return collectInvariantIssues(resource, profile).map((i) => [i.code, i.severity]);
}

describe("per-1 over a period whose two ends carry different timezone offsets", () => {
  it("still reports the violation, at error, when the start is really after the end", () => {
    // THE REGRESSION GUARD. start 13:00+02:00 == 11:00Z, end 10:00Z: inverted by an hour.
    const inverted = patientWithPeriod("2001-05-06T13:00:00+02:00", "2001-05-06T10:00:00Z");
    expect(findings(inverted, perOne)).toEqual([["INVARIANT_VIOLATED", "error"]]);
    expect(validateResource(inverted, { profiles: [perOne] }).valid).toBe(false);
  });

  it("reports nothing for the same two spellings in conformant order", () => {
    const ordered = patientWithPeriod("2001-05-06T10:00:00Z", "2001-05-06T13:00:00+02:00");
    expect(findings(ordered, perOne)).toEqual([]);
    expect(validateResource(ordered, { profiles: [perOne] }).valid).toBe(true);
  });

  it("treats two designators for one instant as equal, not as unorderable", () => {
    const sameInstant = patientWithPeriod("2001-05-06T10:00:00Z", "2001-05-06T12:00:00+02:00");
    expect(findings(sameInstant, perOne)).toEqual([]);
  });

  it("keeps reporting the same inversion written with one designator (the control)", () => {
    const sameZone = patientWithPeriod("2001-05-06T11:00:00Z", "2001-05-06T10:00:00Z");
    expect(findings(sameZone, perOne)).toEqual([["INVARIANT_VIOLATED", "error"]]);
    // …and with none at all, where both ends are read at the engine's declared UTC context.
    const noZone = patientWithPeriod("2001-05-06T11:00:00", "2001-05-06T10:00:00");
    expect(findings(noZone, perOne)).toEqual([["INVARIANT_VIOLATED", "error"]]);
  });

  it("keeps reporting a plain inverted date pair, and nothing for a conformant one", () => {
    expect(findings(patientWithPeriod("2001-05-08", "2001-05-06"), perOne)).toEqual([
      ["INVARIANT_VIOLATED", "error"],
    ]);
    expect(findings(patientWithPeriod("2001-05-06", "2001-05-08"), perOne)).toEqual([]);
  });
});

describe("per-1 where the two ends are written at different precisions", () => {
  it("reports INVARIANT_VIOLATED at error, an ADDITION over the lexical comparison", () => {
    // The document is `patient-example-period.xml`'s own identifier period, and the shared corpus
    // expects `false` from `per-1` over it (`testPeriodInvariantOld`). A day and an instant inside
    // that day do not order, so the comparison is `{}`; `evaluateInvariant` coerces empty to "not
    // satisfied", matching the reference validator, and the profile layer makes that a violation at
    // the constraint's severity. Before this remedy the two compared lexically and answered `true`,
    // so the shipped validator reported nothing for this document. Nothing is withdrawn by it, an
    // error is added, and this test is where that is stated.
    const mixedPrecision = patientWithPeriod("2001-05-06", "2001-05-06T10:10:10Z");
    expect(findings(mixedPrecision, perOne)).toEqual([["INVARIANT_VIOLATED", "error"]]);
    expect(validateResource(mixedPrecision, { profiles: [perOne] }).valid).toBe(false);
  });

  it("carries the constraint's own severity, so a warning-severity constraint stays a warning", () => {
    const warning = req(
      loadStructureDefinition(
        parse({
          resourceType: "StructureDefinition",
          url: "http://example.org/StructureDefinition/ordering-warning",
          type: "Patient",
          snapshot: {
            element: [
              {
                id: "Patient",
                path: "Patient",
                constraint: [
                  {
                    key: "per-1",
                    severity: "warning",
                    human: "start before end",
                    expression: PER_ONE,
                  },
                ],
              },
            ],
          },
        }),
      ),
    );
    const mixedPrecision = patientWithPeriod("2001-05-06", "2001-05-06T10:10:10Z");
    expect(findings(mixedPrecision, warning)).toEqual([["INVARIANT_VIOLATED", "warning"]]);
  });
});

describe("an ordering comparison over a model value that is not temporal", () => {
  // THE REGRESSION GUARD for the withdrawal this remedy must not make. The engine cannot tell a
  // `string` from a `decimal` read out of XML (the corpus caught `Observation.value.value < 'test'`
  // answering `true`), so it does not guess: the ordering is undetermined and the expression is
  // `{}`. Refusing instead raised `UnsupportedFhirPathError`, and `unchecked` reaches this layer as
  // `INVARIANT_UNCHECKED` at *information* with `valid: true`, which REMOVES and RE-SEVERITIES a
  // finding the shipped package emits today. `{}` coerces exactly as the lexical `false` did, so the
  // finding survives at its own code, its own severity and its own location.
  it("keeps reporting INVARIANT_VIOLATED at error for a code ordered against a literal", () => {
    const profile = profileWith("gender > 'test'");
    const resource = parse({ resourceType: "Patient", gender: "male" });
    expect(findings(resource, profile)).toEqual([["INVARIANT_VIOLATED", "error"]]);
    expect(validateResource(resource, { profiles: [profile] }).valid).toBe(false);
  });

  it("keeps reporting it for a `string` element too, inside all()", () => {
    // `HumanName.family` is a FHIR `string`, so String-against-String is a comparison FHIRPath
    // defines and the pre-change answer was the right one. Not peculiar to `code`, and not peculiar
    // to a top-level comparison: the undetermined value composes through `all()` unchanged.
    const profile = profileWith("name.all(family < 'A')");
    const resource = parse({ resourceType: "Patient", name: [{ family: "Chalmers" }] });
    expect(findings(resource, profile)).toEqual([["INVARIANT_VIOLATED", "error"]]);
    expect(validateResource(resource, { profiles: [profile] }).valid).toBe(false);
  });

  it("carries the constraint's own severity, exactly as a decided false does", () => {
    const warning = req(
      loadStructureDefinition(
        parse({
          resourceType: "StructureDefinition",
          url: "http://example.org/StructureDefinition/ordering-nontemporal-warning",
          type: "Patient",
          snapshot: {
            element: [
              {
                id: "Patient",
                path: "Patient",
                constraint: [
                  {
                    key: "probe-1",
                    severity: "warning",
                    human: "gender orders after the literal",
                    expression: "gender > 'test'",
                  },
                ],
              },
            ],
          },
        }),
      ),
    );
    const resource = parse({ resourceType: "Patient", gender: "male" });
    expect(findings(resource, warning)).toEqual([["INVARIANT_VIOLATED", "warning"]]);
  });

  it("costs an answer where the lexical guess used to satisfy the constraint (the ADDITION)", () => {
    // Stated where it lands rather than only where it is returned. `'zzz' > 'test'` is lexically
    // true, so the shipped package reported nothing for this document; the engine cannot establish
    // that ordering, so the constraint is now unsatisfied and an error is ADDED. An addition is not
    // a withdrawal, and this is the whole of what this remedy moves at this layer.
    const profile = profileWith("gender > 'test'");
    const resource = parse({ resourceType: "Patient", gender: "zzz" });
    expect(findings(resource, profile)).toEqual([["INVARIANT_VIOLATED", "error"]]);
  });

  it("leaves a date against a time of day decided the same way, not unchecked", () => {
    const profile = profileWith("identifier.period.start < identifier.period.end");
    const resource = patientWithPeriod("2001-05-06", "10:10:10");
    expect(findings(resource, profile)).toEqual([["INVARIANT_VIOLATED", "error"]]);
  });
});

describe("a type test over an empty operand, at the layer that reports it", () => {
  // What remedy 3 (`{} is T` yields `{}`, not `false`) actually moves. `{}` and `false` coerce
  // alike through `convertToBoolean` TAKEN ALONE, and they do NOT compose alike: `not()` over an
  // empty input is `[]` rather than `true`, and a three-valued `implies` with a false consequent is
  // `{}` rather than `true`, so a constraint the shipped package reported nothing for is now
  // violated. An ADDED finding, which is not what C17 forbids, but it is not "no verdict moves"
  // either and the record says so in these words. Pinned here so the sentence has a test under it.
  it("adds a violation where an empty type test used to reduce to false under not()", () => {
    const profile = profileWith("(gender is String).not()");
    const resource = parse({ resourceType: "Patient" });
    expect(findings(resource, profile)).toEqual([["INVARIANT_VIOLATED", "error"]]);
    expect(validateResource(resource, { profiles: [profile] }).valid).toBe(false);
  });

  it("adds one under implies with a false consequent, and none where the consequent is true", () => {
    const profile = profileWith("(gender is String) implies active");
    const inactive = parse({ resourceType: "Patient", active: false });
    expect(findings(inactive, profile)).toEqual([["INVARIANT_VIOLATED", "error"]]);
    const active = parse({ resourceType: "Patient", active: true });
    expect(findings(active, profile)).toEqual([]);
  });

  it("moves nothing where the type test is the whole constraint", () => {
    // The claim that IS true, and the reason the record's old sentence read plausibly: taken alone
    // the empty collection and `false` are the same verdict.
    const profile = profileWith("gender is String");
    const resource = parse({ resourceType: "Patient" });
    expect(findings(resource, profile)).toEqual([["INVARIANT_VIOLATED", "error"]]);
  });
});
