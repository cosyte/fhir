/**
 * A profile invariant written the **type-qualified** way (`Patient.name.exists()`), pinned at the
 * layer that decides an issue code, a severity and `valid`.
 *
 * Why this file exists rather than another `describe` in `fhirpath.test.ts`: the evaluator's own
 * tests grade a collection, and a collection is not a finding. Between them sits
 * `src/profiles/invariants.ts`, which turns "the engine refused" into `INVARIANT_UNCHECKED` at
 * *information* and "the engine answered false" into `INVARIANT_VIOLATED` at *error*, and only the
 * second makes `validateResource(...).valid` false. A change to how the engine treats the head of a
 * path moves a document between those two outcomes, and nothing under `test/fhirpath*.test.ts` can
 * see it happen.
 *
 * The spelling matters: published FHIR constraints are written type-qualified, and so is a
 * substantial share of the shared R4 corpus (the count is re-derived on every run by
 * `test/fhirpath-suite.test.ts` and recorded in `documentation/fhirpath-coverage.md`'s counts block
 * as `type_qualified_head_cases`; it is deliberately not restated here, because a number written
 * twice drifts). An engine that refuses the spelling outright reports a genuinely non-conformant
 * resource as *unchecked* and hands the caller `valid: true`, so the qualifier is resolved wherever
 * the model can check it. The first two blocks below assert both directions of that.
 *
 * **The third block pins a cost, not a guarantee.** Where the qualifier does NOT match the focus the
 * engine refuses, and that refusal withdraws a finding this package used to report: `valid` goes
 * `false` to `true` and the constraint is reported at `INVARIANT_UNCHECKED` / information instead of
 * `INVARIANT_VIOLATED` / error. It ships because a generic model that has not established the type
 * has not decided the constraint either, and an unchecked constraint is visible in the
 * `OperationOutcome` where a silent `false` is not. Do not cite this file as evidence that nothing
 * moved: it is the file that pins what moved. The movement is enumerated in
 * `documentation/fhirpath-coverage.md`, under "What these four move, and what they do not".
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

/** A caller-supplied profile carrying one root constraint, which is the only way a profile arrives. */
function profileWith(type: string, expression: string): StructureDefinition {
  return req(
    loadStructureDefinition(
      parse({
        resourceType: "StructureDefinition",
        url: "http://example.org/StructureDefinition/type-qualified",
        type,
        snapshot: {
          element: [
            {
              id: type,
              path: type,
              constraint: [
                {
                  key: "tq-1",
                  severity: "error",
                  human: "a patient must carry a name",
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

const namedPatient = { resourceType: "Patient", name: [{ family: "Synthfamily" }] };
const namelessPatient = { resourceType: "Patient", active: true };

describe("a type-qualified invariant on a resource of that type is evaluated, not refused", () => {
  const profile = profileWith("Patient", "Patient.name.exists()");

  it("reports a violated type-qualified invariant as an error, and the resource as invalid", () => {
    // THE REGRESSION GUARD. Refusing the qualifier turns this into INVARIANT_UNCHECKED at
    // information and flips valid to true on a resource that genuinely violates the constraint.
    const issues = collectInvariantIssues(parse(namelessPatient), profile);
    expect(issues.map((i) => [i.code, i.severity])).toEqual([["INVARIANT_VIOLATED", "error"]]);
    expect(validateResource(parse(namelessPatient), { profiles: [profile] }).valid).toBe(false);
  });

  it("reports nothing for a resource that satisfies it", () => {
    // The other half, and the reason the qualifier is resolved rather than navigated: read as an
    // ordinary member `Patient` selects nothing, so this answered `false` on a Patient that HAS a
    // name and the caller was handed a violation that was not one.
    expect(collectInvariantIssues(parse(namedPatient), profile)).toEqual([]);
    expect(validateResource(parse(namedPatient), { profiles: [profile] }).valid).toBe(true);
  });
});

describe("a qualifier the resource does not match stays unchecked, never guessed", () => {
  it("reports INVARIANT_UNCHECKED at information rather than deciding", () => {
    // `Encounter.name.exists()` against a Patient: the engine cannot say whether the qualifier
    // holds, so it refuses and the fail-safe surfaces it. Unchecked is never an error, and never a
    // silent pass either.
    //
    // THIS IS A COST, AND IT IS ROW 1 OF THE RECORD'S WITHDRAWAL TABLE. Pre-change the head was
    // navigated as an ordinary member, selected nothing, `exists()` answered `false`, and this layer
    // reported INVARIANT_VIOLATED at error with valid=false. The full set of four, each with its
    // pre-change control, is `test/profile-invariant-withdrawn-findings.test.ts`.
    const profile = profileWith("Patient", "Encounter.name.exists()");
    const issues = collectInvariantIssues(parse(namelessPatient), profile);
    expect(issues.map((i) => [i.code, i.severity])).toEqual([
      ["INVARIANT_UNCHECKED", "information"],
    ]);
    expect(validateResource(parse(namelessPatient), { profiles: [profile] }).valid).toBe(true);
  });
});

describe("an unqualified invariant is unaffected by any of it", () => {
  it("keeps reporting a violation, at error, on the resource that violates it", () => {
    const profile = profileWith("Patient", "name.exists()");
    expect(collectInvariantIssues(parse(namelessPatient), profile).map((i) => i.code)).toEqual([
      "INVARIANT_VIOLATED",
    ]);
    expect(collectInvariantIssues(parse(namedPatient), profile)).toEqual([]);
  });
});
