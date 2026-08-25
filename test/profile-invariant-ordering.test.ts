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
 * Three readings are pinned here, one per direction the remedy can move a document:
 *
 * 1. **Two offsets order by the instants they name.** `13:00:00+02:00` is `11:00:00Z`, so a period
 *    written that way against a `10:00:00Z` end is genuinely inverted and stays reported. Refusing
 *    the pair instead reported `INVARIANT_UNCHECKED` and handed the caller `valid: true` for a
 *    document this package rejects, which is the one direction the fail-safe contract forbids.
 * 2. **A precision difference is indeterminate, and the invariant layer's shipped coercion makes an
 *    indeterminate constraint a violation.** This is an ADDITION: comparing the two lexically
 *    answered `true` and reported nothing. It is not a free choice, the shared corpus grades
 *    `testPeriodInvariantOld` over exactly this document and expects `false`, and `evaluateInvariant`
 *    documents `empty → not satisfied` as matching the reference validator's coercion. Pinned so the
 *    addition is visible rather than asserted away.
 * 3. **A model value that is not temporal is refused**, which costs the caller an answer they used to
 *    get (lexically, and wrongly for anything numeric). Pinned with its severity so the cost is
 *    stated where it lands rather than only where it is thrown.
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
  it("reports INVARIANT_UNCHECKED at information, never a decision", () => {
    // The refusal's cost, at the layer that pays it: a caller who ordered a `string`-valued element
    // against a literal used to get a lexical answer and now gets `unchecked`. The engine cannot tell
    // a `string` from a `decimal` read out of XML (the corpus caught `Observation.value.value <
    // 'test'` answering `true`), so it does not guess. `unchecked` is never an error, and never a
    // silent pass either: `valid` stays true only because nothing was established.
    const profile = profileWith("gender < 'test'");
    const resource = parse({ resourceType: "Patient", gender: "male" });
    expect(findings(resource, profile)).toEqual([["INVARIANT_UNCHECKED", "information"]]);
    expect(validateResource(resource, { profiles: [profile] }).valid).toBe(true);
  });
});
