/**
 * The four findings the shared-corpus measurement **withdrew**, pinned at the layer that decides an
 * issue code, a severity and `valid`.
 *
 * `documentation/fhirpath-coverage.md`, under "What these four move, and what they do not", tables
 * four constraint expressions that this package used to report as `INVARIANT_VIOLATED` at *error*
 * with `validateResource(...).valid === false`, and now reports as `INVARIANT_UNCHECKED` at
 * *information* with `valid === true`. Two earlier revisions of that record claimed nothing moved,
 * and both claims were false: the suite was green over every one of these because **the suite did
 * not pin them**. This file is that missing pin. It exists so the table is a checked statement
 * rather than a remembered one, in either direction: change the engine back and these red, change
 * the engine further and they red too.
 *
 * Read every assertion here as a COST, not as desired behaviour. Each pre-change answer was `false`
 * and each `false` was correct FHIRPath (a qualifier that does not match its focus selects nothing;
 * a FHIR `code` is not a `Quantity`). The refusal ships because the previous engine reached those
 * answers by accident rather than by deciding them, and answering `false` where the generic model
 * has not established the type is a determination the model has not made: the
 * wrong-answer-with-no-diagnostic shape `UnsupportedFhirPathError` exists to prevent. `unchecked` is
 * visible in the `OperationOutcome`; a silent `false` is not.
 *
 * Each case carries its **pre-change reduction, run at HEAD**, so the "before" column is measured
 * rather than recalled:
 *
 * - the two qualifier cases are written with an explicit `$this.` target, which the qualifier branch
 *   in `resolveTypeQualifier` is guarded against (`expr.target === null`), so they take the ordinary
 *   `navigate` path the pre-change engine took for the unqualified spelling;
 * - the two type-test cases name `Boolean`, which is inside `SYSTEM_TYPE_NAMES`, so they still run
 *   the `systemTypeOf(item) === normalized` comparison that the pre-change engine ran for every type
 *   name including `Quantity`.
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

/** A caller-supplied Patient profile carrying one root constraint at `error`. */
function profileWith(expression: string): StructureDefinition {
  return req(
    loadStructureDefinition(
      parse({
        resourceType: "StructureDefinition",
        url: "http://example.org/StructureDefinition/withdrawn-findings",
        type: "Patient",
        snapshot: {
          element: [
            {
              id: "Patient",
              path: "Patient",
              constraint: [{ key: "wf-1", severity: "error", human: "probe", expression }],
            },
          ],
        },
      }),
    ),
  );
}

/** `[code, severity]` pairs plus `valid`: what "a finding" means at this layer. */
function findings(resource: unknown, expression: string) {
  const doc = parse(resource);
  const profile = profileWith(expression);
  return {
    issues: collectInvariantIssues(doc, profile).map((i) => [i.code, i.severity]),
    valid: validateResource(doc, { profiles: [profile] }).valid,
  };
}

const VIOLATED = [["INVARIANT_VIOLATED", "error"]];
const UNCHECKED = [["INVARIANT_UNCHECKED", "information"]];

const namelessPatient = { resourceType: "Patient", active: true };
const namedPatient = { resourceType: "Patient", name: [{ family: "Synthfamily" }] };
const male = { resourceType: "Patient", gender: "male" };

describe("remedy 1: a type qualifier the generic model cannot confirm withdraws a finding", () => {
  it("a resource-type qualifier that does not match the focus: VIOLATED/error/false -> UNCHECKED/information/true", () => {
    // The pre-change reduction, at HEAD: `$this.` in front of the head takes the ordinary member
    // path, which is byte for byte what the pre-change `member` case did for `Encounter`.
    const before = findings(namelessPatient, "$this.Encounter.name.exists()");
    expect(before.issues).toEqual(VIOLATED);
    expect(before.valid).toBe(false);

    const now = findings(namelessPatient, "Encounter.name.exists()");
    expect(now.issues).toEqual(UNCHECKED);
    expect(now.valid).toBe(true);
  });

  it("a datatype qualifier at a nested focus: VIOLATED/error/false -> UNCHECKED/information/true", () => {
    const before = findings(namedPatient, "name.all($this.HumanName.given.exists())");
    expect(before.issues).toEqual(VIOLATED);
    expect(before.valid).toBe(false);

    const now = findings(namedPatient, "name.all(HumanName.given.exists())");
    expect(now.issues).toEqual(UNCHECKED);
    expect(now.valid).toBe(true);
  });
});

describe("remedy 3: a type test naming a type outside the System primitives withdraws a finding", () => {
  it("`is` a FHIR datatype: VIOLATED/error/false -> UNCHECKED/information/true", () => {
    // `gender is Boolean` still runs `systemTypeOf(item) === normalized`, which is exactly the
    // comparison `gender is Quantity` used to run, and it still reports the violation.
    const before = findings(male, "gender is Boolean");
    expect(before.issues).toEqual(VIOLATED);
    expect(before.valid).toBe(false);

    const now = findings(male, "gender is Quantity");
    expect(now.issues).toEqual(UNCHECKED);
    expect(now.valid).toBe(true);
  });

  it("the same through `ofType`, which routes to the same predicate", () => {
    const before = findings(male, "gender.ofType(Boolean).exists()");
    expect(before.issues).toEqual(VIOLATED);
    expect(before.valid).toBe(false);

    const now = findings(male, "gender.ofType(Quantity).exists()");
    expect(now.issues).toEqual(UNCHECKED);
    expect(now.valid).toBe(true);
  });
});

describe("the same refusal ADDS an unchecked notice where the accidental navigation satisfied", () => {
  it("reports INVARIANT_UNCHECKED at information where the package reported nothing before", () => {
    // The other face of remedy 1, and the reason the record says three of the four remedies add a
    // finding. Navigating `Encounter` as an ordinary member selected nothing, so a constraint that
    // asks for nothing was SATISFIED by accident and the caller was told nothing at all. The refusal
    // replaces that silence with an information-level notice: no error, no `valid` change, but the
    // caller now learns the constraint was never evaluated.
    expect(findings(namelessPatient, "$this.Encounter.name.empty()").issues).toEqual([]);
    expect(findings(namelessPatient, "Encounter.name.empty()").issues).toEqual(UNCHECKED);
    expect(findings(namelessPatient, "Encounter.name.empty()").valid).toBe(true);

    expect(findings(namelessPatient, "$this.Encounter.exists().not()").issues).toEqual([]);
    expect(findings(namelessPatient, "Encounter.exists().not()").issues).toEqual(UNCHECKED);
  });
});

describe("what the withdrawal does not reach", () => {
  it("a qualifier that DOES match its focus still decides the constraint, in both directions", () => {
    // The narrowing that makes the refusal survivable: the spelling most published constraints use
    // is still evaluated, so the withdrawal is bounded to a qualifier the focus does not match.
    expect(findings(namelessPatient, "Patient.name.exists()").issues).toEqual(VIOLATED);
    expect(findings(namedPatient, "Patient.name.exists()").issues).toEqual([]);
    expect(findings(namedPatient, "Patient.name.exists()").valid).toBe(true);
  });

  it("a type test inside the System primitives still decides the constraint", () => {
    expect(findings(male, "gender is String").issues).toEqual([]);
    expect(findings(male, "gender.ofType(String).exists()").issues).toEqual([]);
  });

  it("an unqualified path is untouched by either remedy", () => {
    expect(findings(namelessPatient, "name.exists()").issues).toEqual(VIOLATED);
    expect(findings(namedPatient, "name.exists()").issues).toEqual([]);
  });
});
