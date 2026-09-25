/**
 * Every finding the shared-corpus measurement **moved**, pinned at the layer that decides an issue
 * code, a severity and `valid`.
 *
 * `documentation/fhirpath-coverage.md`, under "What these four move, and what they do not", tables
 * twenty-one movements: constraint expressions this package answers differently after the four
 * engine corrections the measurement forced. Some are withdrawals (an error becomes an
 * `INVARIANT_UNCHECKED` notice, or no issue at all), some are additions (silence becomes a notice or
 * an error). **The file name says "withdrawn" because withdrawals are what the first revision of it
 * pinned; it now pins the whole table, both directions.**
 *
 * Three earlier revisions of that record closed on an absolute - "nothing moves", then "nothing is
 * removed, re-severitied or relocated", then "remedies 2 and 4 withdraw nothing" - and every one was
 * false, because **the suite did not pin any of it**. This file is that missing pin. It exists so
 * the table is a checked statement rather than a remembered one, in either direction: change the
 * engine back and these red, change the engine further and they red too.
 *
 * **Do not cite this file as evidence that nothing moved: it is the file that pins what moved.**
 *
 * Read every assertion in `MOVEMENTS` as a COST or a gain that has been decided and recorded, never
 * as self-evidently desired behaviour.
 *
 * **How the `shipped` column was obtained.** It is NOT asserted here - it cannot be, since this
 * checkout is one of the two trees. Each row was run against the published package
 * (`git checkout --detach origin/main`) and against this change with the same probe, at
 * `collectInvariantIssues` / `validateResource` over the profile `profileWith` builds, and the two
 * outputs diffed. What IS checked here is that every row still MOVES (`shipped !== now`) and that
 * the `now` column is what the engine does today. Where the pre-change reduction is still reachable
 * at this commit, `CONTROLS` carries it as a live assertion, so that column is measured rather than
 * recalled:
 *
 * - the two qualifier rows are written with an explicit `$this.` target, which the qualifier branch
 *   in `resolveTypeQualifier` is guarded against (`expr.target === null`), so they take the ordinary
 *   `navigate` path the pre-change engine took for the unqualified spelling;
 * - the `Quantity` type tests name `Boolean`, which is inside `SYSTEM_TYPE_NAMES`, so they still run
 *   the `systemTypeOf(item) === normalized` comparison the pre-change engine ran for every type name;
 * - the `FHIR.`-prefixed type tests are reduced to their `System.`-prefixed twins, which is exactly
 *   what the pre-change `itemIsType` did with them once it had stripped the prefix;
 * - the re-associated `is` rows are written with explicit parentheses in both associations, which
 *   mean the same thing on both trees;
 * - the ordering rows are reduced to the same comparison between two String **literals**, which
 *   `compare` still decides lexically at this commit, exactly as the pre-change engine decided it
 *   for a model value.
 *
 * **A later change moved two of those rows again.** FHIR-type tests and `matches()` (AC-13, the
 * table headed "FHIR-type tests and matches()" in the same record) decide rows 11 and 12 once more,
 * from the node's kind, so each carries a `today` column beside its `now`: `now` is what the change
 * that tabled the row answered, `today` what the engine answers, and the assertion is on `today`.
 * That change's own movements are `TYPE_TEST_MOVEMENTS` below, each measured against the pin it was
 * written on (`0d75c80`) with this file's probe, the `pin` column recorded rather than asserted for
 * the same reason `shipped` is, and every one of them moves from `UNCHECKED` to a determination.
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

/** A caller-supplied profile (Patient unless named) carrying one root constraint at `error`. */
function profileWith(expression: string, type = "Patient"): StructureDefinition {
  return req(
    loadStructureDefinition(
      parse({
        resourceType: "StructureDefinition",
        url: "http://example.org/StructureDefinition/withdrawn-findings",
        type,
        snapshot: {
          element: [
            {
              id: type,
              path: type,
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
  const profile = profileWith(expression, resourceTypeOf(resource));
  return {
    issues: collectInvariantIssues(doc, profile).map((i) => [i.code, i.severity]),
    valid: validateResource(doc, { profiles: [profile] }).valid,
  };
}

/** The `resourceType` a probe document names, which is the type its profile constrains. */
function resourceTypeOf(resource: unknown): string {
  if (
    typeof resource === "object" &&
    resource !== null &&
    "resourceType" in resource &&
    typeof resource.resourceType === "string"
  ) {
    return resource.resourceType;
  }
  throw new Error("a probe document names its resourceType");
}

/** The three outcomes the record's tables abbreviate. */
type Outcome = "VIOLATED" | "UNCHECKED" | "none";

const OUTCOME: Readonly<Record<Outcome, { issues: string[][]; valid: boolean }>> = {
  VIOLATED: { issues: [["INVARIANT_VIOLATED", "error"]], valid: false },
  UNCHECKED: { issues: [["INVARIANT_UNCHECKED", "information"]], valid: true },
  none: { issues: [], valid: true },
};

const bare = { resourceType: "Patient" };
const inactive = { resourceType: "Patient", active: false };
const male = { resourceType: "Patient", gender: "male" };
const namelessPatient = { resourceType: "Patient", active: true };
const namedPatient = { resourceType: "Patient", name: [{ family: "Synthfamily" }] };
const namedMale = {
  resourceType: "Patient",
  gender: "male",
  name: [{ family: "Synthfamily", given: ["Synthgiven"] }],
};

function periodPatient(start: string, end: string) {
  return {
    resourceType: "Patient",
    identifier: [{ system: "http://example.org/ids", value: "SYN-0001", period: { start, end } }],
  };
}

/** R4's own `per-1`, verbatim. */
const PER_ONE =
  "identifier.period.all(start.hasValue().not() or end.hasValue().not() or (start <= end))";

interface Movement {
  /** The row number in `documentation/fhirpath-coverage.md`'s tables. */
  readonly row: number;
  /** Which of the four engine corrections produces it. */
  readonly remedy: 1 | 2 | 3 | 4;
  readonly expression: string;
  readonly over: unknown;
  /** What the published package answers. Measured, not asserted here; see the docblock. */
  readonly shipped: Outcome;
  /** What the change that tabled the row answered. */
  readonly now: Outcome;
  /** What the engine answers today, where a later change moved the row again. Asserted when set. */
  readonly today?: Outcome;
  readonly why: string;
}

const MOVEMENTS: readonly Movement[] = [
  {
    row: 1,
    remedy: 1,
    expression: "Encounter.name.exists()",
    over: namelessPatient,
    shipped: "VIOLATED",
    now: "UNCHECKED",
    why: "a resource-type qualifier that does not match the focus: a CORRECT finding withdrawn",
  },
  {
    row: 2,
    remedy: 1,
    expression: "name.all(HumanName.given.exists())",
    over: namedPatient,
    shipped: "VIOLATED",
    now: "UNCHECKED",
    why: "a datatype qualifier at a nested focus: a CORRECT finding withdrawn",
  },
  {
    row: 3,
    remedy: 1,
    expression: "Encounter.name.empty()",
    over: namelessPatient,
    shipped: "none",
    now: "UNCHECKED",
    why: "the same refusal's other face: the accidental navigation used to satisfy in silence",
  },
  {
    row: 4,
    remedy: 1,
    expression: "Encounter.exists().not()",
    over: namelessPatient,
    shipped: "none",
    now: "UNCHECKED",
    why: "as row 3",
  },
  {
    row: 5,
    remedy: 1,
    expression: "Patient.name.exists()",
    over: namedPatient,
    shipped: "VIOLATED",
    now: "none",
    why: "a FALSE POSITIVE removed: the head selected nothing on a conformant Patient",
  },
  {
    row: 6,
    remedy: 2,
    expression: "name.family | gender is String",
    over: namedMale,
    shipped: "VIOLATED",
    now: "none",
    why: "removed into SILENCE: the corrected parse is a union, and a two-item collection coerces to satisfied",
  },
  {
    row: 7,
    remedy: 2,
    expression: "name.given | name.family is String",
    over: namedMale,
    shipped: "VIOLATED",
    now: "none",
    why: "as row 6",
  },
  {
    row: 8,
    remedy: 2,
    expression: "gender > 'test' is String",
    over: male,
    shipped: "VIOLATED",
    now: "UNCHECKED",
    why: "withdrawn and re-severitied: the corrected parse reaches the non-orderable refusal",
  },
  {
    row: 9,
    remedy: 2,
    expression: "gender > 'test' is Boolean",
    over: male,
    shipped: "none",
    now: "UNCHECKED",
    why: "ADDED: the same re-association, where the mis-parse used to answer true",
  },
  {
    row: 10,
    remedy: 2,
    expression: "gender is String | name.family",
    over: namedMale,
    shipped: "UNCHECKED",
    now: "none",
    why: "an UNCHECKED removed: `is` left of `|` was a trailing-token parse error and now evaluates",
  },
  {
    row: 11,
    remedy: 3,
    expression: "gender is Quantity",
    over: male,
    shipped: "VIOLATED",
    now: "UNCHECKED",
    today: "VIOLATED", // AC-13 / AC-10: decided again from the node's kind, row T1
    why: "a type name the generic model cannot decide: a CORRECT finding withdrawn, restored as row T1",
  },
  {
    row: 12,
    remedy: 3,
    expression: "gender.ofType(Quantity).exists()",
    over: male,
    shipped: "VIOLATED",
    now: "UNCHECKED",
    today: "VIOLATED", // AC-13 / AC-10: decided again from the node's kind, row T2
    why: "as row 11, through `ofType`, which routes to the same predicate, restored as row T2",
  },
  {
    row: 13,
    remedy: 3,
    expression: "gender is FHIR.Boolean",
    over: male,
    shipped: "VIOLATED",
    now: "UNCHECKED",
    why: "`itemIsType` no longer strips a leading `FHIR.`, so the name falls outside SYSTEM_TYPE_NAMES",
  },
  {
    row: 14,
    remedy: 3,
    expression: "gender is FHIR.String",
    over: male,
    shipped: "none",
    now: "UNCHECKED",
    why: "ADDED: the same prefix, where the strip used to make the test succeed",
  },
  {
    row: 15,
    remedy: 3,
    expression: "(gender is String).not()",
    over: bare,
    shipped: "none",
    now: "VIOLATED",
    why: "ADDED: `{} is T` is `{}`, and `not()` over an empty input is `[]` rather than `true`",
  },
  {
    row: 16,
    remedy: 3,
    expression: "(gender is String) implies active",
    over: inactive,
    shipped: "none",
    now: "VIOLATED",
    why: "ADDED: `{} implies false` is `{}` rather than `true`",
  },
  {
    row: 17,
    remedy: 4,
    expression: PER_ONE,
    over: periodPatient("2001-05-06T13:00:00+02:00", "2001-05-06T12:00:00Z"),
    shipped: "VIOLATED",
    now: "none",
    why: "a FALSE POSITIVE removed into silence: 13:00+02:00 IS 11:00Z, which is before 12:00Z",
  },
  {
    row: 18,
    remedy: 4,
    expression: PER_ONE,
    over: periodPatient("2001-05-06T13:00:00+02:00", "2001-05-06T11:00:00Z"),
    shipped: "VIOLATED",
    now: "none",
    why: "as row 17, with the two ends equal once normalised",
  },
  {
    row: 19,
    remedy: 4,
    expression: PER_ONE,
    over: periodPatient("2001-05-06T10:00:00Z", "2001-05-06T11:00:00+02:00"),
    shipped: "none",
    now: "VIOLATED",
    why: "rows 17 and 18's mirror: 11:00+02:00 IS 09:00Z, so this period really is inverted",
  },
  {
    row: 20,
    remedy: 4,
    expression: PER_ONE,
    over: periodPatient("2001-05-06", "2001-05-06T10:10:10Z"),
    shipped: "none",
    now: "VIOLATED",
    why: "ADDED: two ends written at different precisions do not order",
  },
  {
    row: 21,
    remedy: 4,
    expression: "(gender > 'test') is Boolean",
    over: male,
    shipped: "none",
    now: "VIOLATED",
    why: "ADDED: a non-temporal model value does not order, so the type test sees `{}`",
  },
];

interface Control {
  readonly expression: string;
  readonly over: unknown;
  /** Measured identical on both trees. */
  readonly both: Outcome;
  readonly why: string;
}

const CONTROLS: readonly Control[] = [
  // Remedy 1: the pre-change reduction of rows 1 to 4, and the narrowing that bounds them.
  {
    expression: "$this.Encounter.name.exists()",
    over: namelessPatient,
    both: "VIOLATED",
    why: "row 1's pre-change reduction: `$this.` takes the ordinary member path",
  },
  {
    expression: "name.all($this.HumanName.given.exists())",
    over: namedPatient,
    both: "VIOLATED",
    why: "row 2's pre-change reduction",
  },
  {
    expression: "$this.Encounter.name.empty()",
    over: namelessPatient,
    both: "none",
    why: "row 3's pre-change reduction",
  },
  {
    expression: "$this.Encounter.exists().not()",
    over: namelessPatient,
    both: "none",
    why: "row 4's pre-change reduction",
  },
  {
    expression: "Patient.name.exists()",
    over: namelessPatient,
    both: "VIOLATED",
    why: "a qualifier that DOES match its focus still decides the constraint: what bounds rows 1 and 2",
  },
  {
    expression: "name.exists()",
    over: namelessPatient,
    both: "VIOLATED",
    why: "an unqualified path is untouched by any of the four",
  },
  {
    expression: "name.exists()",
    over: namedPatient,
    both: "none",
    why: "as above, in the other direction",
  },
  // Remedy 2: both associations written out, and the coercion that makes rows 6 and 7 silent.
  {
    expression: "(name.family | gender) is String",
    over: namedMale,
    both: "VIOLATED",
    why: "rows 6 and 7's pre-change parse, written with explicit parentheses",
  },
  {
    expression: "name.family | (gender is String)",
    over: namedMale,
    both: "none",
    why: "row 6's post-change parse, written with explicit parentheses",
  },
  {
    expression: "name.given | name.family",
    over: namedMale,
    both: "none",
    why: "a two-item collection has ALWAYS coerced to satisfied here: rows 6 and 7's silence is this, not a new determination",
  },
  {
    expression: "gender > ('test' is String)",
    over: male,
    both: "UNCHECKED",
    why: "row 8's post-change parse, written with explicit parentheses",
  },
  {
    expression: "(gender is String) | name.family",
    over: namedMale,
    both: "none",
    why: "the parse row 10 newly gets",
  },
  {
    expression: "gender is String > 'test'",
    over: male,
    both: "UNCHECKED",
    why: "the fourth affected spelling, which does NOT move: refused before as a trailing token, refused now as a non-orderable comparison",
  },
  // Remedy 3: the reductions of rows 11 to 14, and the type names still decided.
  {
    expression: "gender is Boolean",
    over: male,
    both: "VIOLATED",
    why: "row 11's pre-change reduction: a name inside SYSTEM_TYPE_NAMES still runs `systemTypeOf(item) === normalized`",
  },
  {
    expression: "gender.ofType(Boolean).exists()",
    over: male,
    both: "VIOLATED",
    why: "row 12's pre-change reduction",
  },
  {
    expression: "gender is System.Boolean",
    over: male,
    both: "VIOLATED",
    why: "row 13's pre-change reduction: exactly the comparison the old `itemIsType` ran once it had stripped `FHIR.`",
  },
  {
    expression: "gender is System.String",
    over: male,
    both: "none",
    why: "row 14's pre-change reduction",
  },
  {
    expression: "gender is String",
    over: male,
    both: "none",
    why: "a type test inside the System primitives still decides the constraint",
  },
  {
    expression: "gender.ofType(String).exists()",
    over: male,
    both: "none",
    why: "as above, through `ofType`",
  },
  {
    expression: "gender.ofType(FHIR.String).exists()",
    over: male,
    both: "UNCHECKED",
    why: "a qualified type name inside `ofType` was refused by the parser before this change too",
  },
  // Remedy 4: the lexical comparison, still reachable between two String literals.
  {
    expression: "'2001-05-06T13:00:00+02:00' <= '2001-05-06T12:00:00Z'",
    over: bare,
    both: "VIOLATED",
    why: "row 17's pre-change reduction: two String literals still compare lexically",
  },
  {
    expression: "'2001-05-06T10:00:00Z' <= '2001-05-06T11:00:00+02:00'",
    over: bare,
    both: "none",
    why: "row 19's pre-change reduction",
  },
  {
    expression: "'2001-05-06' <= '2001-05-06T10:10:10Z'",
    over: bare,
    both: "none",
    why: "row 20's pre-change reduction",
  },
  {
    expression: "'2001-05-06T13:00:00+02:00' <= '2001-05-06T10:00:00Z'",
    over: bare,
    both: "VIOLATED",
    why: "the direction where the lexical order and the instants' order agree: unchanged",
  },
  {
    expression: PER_ONE,
    over: periodPatient("2001-05-06T13:00:00+02:00", "2001-05-06T10:00:00Z"),
    both: "VIOLATED",
    why: "a genuinely inverted period across two offsets is still reported",
  },
  {
    expression: PER_ONE,
    over: periodPatient("2001-05-08", "2001-05-06"),
    both: "VIOLATED",
    why: "a genuinely inverted period at day precision is still reported",
  },
  {
    expression: PER_ONE,
    over: periodPatient("2001-05-06T10:00:00Z", "2001-05-06T13:00:00+02:00"),
    both: "none",
    why: "a conformant period across two offsets still reports nothing",
  },
  {
    expression: "gender > 'test'",
    over: male,
    both: "VIOLATED",
    why: "an ordering over a non-temporal model value keeps its verdict, by a different route: a lexical `false` before, `{}` now",
  },
  {
    expression: "name.all(family < 'A')",
    over: namedPatient,
    both: "VIOLATED",
    why: "as above",
  },
];

describe("the movement table in documentation/fhirpath-coverage.md, pinned row by row", () => {
  it("tables one row per movement, numbered as the record numbers them", () => {
    expect(MOVEMENTS.map((m) => m.row)).toEqual(
      Array.from({ length: MOVEMENTS.length }, (_, i) => i + 1),
    );
  });

  it("carries only rows that actually MOVE", () => {
    // A row whose two columns agree is a control, not a movement, and belongs in CONTROLS. This
    // keeps the record's table honest in the other direction: it may not pad itself with non-events.
    expect(MOVEMENTS.filter((m) => m.shipped === m.now)).toEqual([]);
  });

  for (const movement of MOVEMENTS) {
    const today = movement.today === undefined ? "" : ` (${movement.today} today)`;
    it(`row ${String(movement.row)} (remedy ${String(movement.remedy)}): \`${movement.expression}\` is ${movement.shipped} on the published package and ${movement.now} here${today} - ${movement.why}`, () => {
      expect(findings(movement.over, movement.expression)).toEqual(
        OUTCOME[movement.today ?? movement.now],
      );
    });
  }
});

// ---------------------------------------------------------------------------------------------
// AC-13: FHIR-type tests and matches(), measured against the pin they were written on.
// ---------------------------------------------------------------------------------------------

/** Which part of the widened subset moves a row. */
type TypeTestRule = "R1" | "R2" | "R3" | "is()/as()" | "matches()";

interface TypeTestMovement {
  /** The row label in `documentation/fhirpath-coverage.md`'s "FHIR-type tests and matches()" table. */
  readonly row: string;
  readonly rule: TypeTestRule;
  readonly expression: string;
  readonly over: unknown;
  /** What the engine at the pin answers. Measured with this file's probe, not asserted here. */
  readonly pin: Outcome;
  /** What this change answers. Asserted. */
  readonly now: Outcome;
  readonly why: string;
}

const deceasedFalse = { resourceType: "Patient", deceasedBoolean: false };
const identified = (value: string) => ({
  resourceType: "Patient",
  identifier: [{ system: "http://example.org/ids", value }],
});
const quantityObservation = {
  resourceType: "Observation",
  status: "final",
  code: { text: "synthetic" },
  valueQuantity: { value: 1, unit: "mg", system: "http://unitsofmeasure.org", code: "mg" },
};
const textlessObservation = {
  resourceType: "Observation",
  status: "final",
  code: { text: "synthetic" },
};

const TYPE_TEST_MOVEMENTS: readonly TypeTestMovement[] = [
  {
    row: "T1",
    rule: "R3",
    expression: "gender is Quantity",
    over: male,
    pin: "UNCHECKED",
    now: "VIOLATED",
    why: "a model primitive is never a complex FHIR type: row 11's correct finding, decided again",
  },
  {
    row: "T2",
    rule: "R3",
    expression: "gender.ofType(Quantity).exists()",
    over: male,
    pin: "UNCHECKED",
    now: "VIOLATED",
    why: "as T1, through `ofType`: row 12's correct finding, decided again",
  },
  {
    row: "T3",
    rule: "R3",
    expression: "gender.ofType(Quantity).empty()",
    over: male,
    pin: "UNCHECKED",
    now: "none",
    why: "T2's other face: an UNCHECKED removed into a satisfied constraint",
  },
  {
    row: "T4",
    rule: "R3",
    expression: "name is String",
    over: namedPatient,
    pin: "UNCHECKED",
    now: "VIOLATED",
    why: "a complex node is never a System primitive",
  },
  {
    row: "T5",
    rule: "R3",
    expression: "name.ofType(String).empty()",
    over: namedPatient,
    pin: "UNCHECKED",
    now: "none",
    why: "T4's other face",
  },
  {
    row: "T6",
    rule: "R2",
    expression: "$this is Patient",
    over: bare,
    pin: "UNCHECKED",
    now: "none",
    why: "the resource root is the type its resourceType names",
  },
  {
    row: "T7",
    rule: "R2",
    expression: "$this is Observation",
    over: bare,
    pin: "UNCHECKED",
    now: "VIOLATED",
    why: "a Patient root is not an Observation",
  },
  {
    row: "T8",
    rule: "R1",
    expression: "deceased is boolean",
    over: deceasedFalse,
    pin: "UNCHECKED",
    now: "none",
    why: "a choice variant R4 declares on Patient is its variant's type",
  },
  {
    row: "T9",
    rule: "R1",
    expression: "value is Quantity",
    over: quantityObservation,
    pin: "UNCHECKED",
    now: "none",
    why: "`valueQuantity` on an Observation root is a Quantity",
  },
  {
    row: "T10",
    rule: "R1",
    expression: "value is CodeableConcept",
    over: quantityObservation,
    pin: "UNCHECKED",
    now: "VIOLATED",
    why: "and it is not a CodeableConcept",
  },
  {
    row: "T11",
    rule: "is()/as()",
    expression: "gender.is(Quantity)",
    over: male,
    pin: "UNCHECKED",
    now: "VIOLATED",
    why: "the function form, refused outright at the pin, answers as the operator form does",
  },
  {
    row: "T12",
    rule: "is()/as()",
    expression: "deceased.is(boolean)",
    over: bare,
    pin: "UNCHECKED",
    now: "VIOLATED",
    why: "ADDED: over an absent element the function form is `{}`, which is not satisfied",
  },
  {
    row: "T13",
    rule: "is()/as()",
    expression: "value.as(Quantity).exists()",
    over: quantityObservation,
    pin: "UNCHECKED",
    now: "none",
    why: "`as()` keeps the item that is of the type",
  },
  {
    row: "T14",
    rule: "matches()",
    expression: "identifier.value.matches('^SYN-[0-9]{4}$')",
    over: identified("SYN-0001"),
    pin: "UNCHECKED",
    now: "none",
    why: "a matching value satisfies the constraint",
  },
  {
    row: "T15",
    rule: "matches()",
    expression: "identifier.value.matches('^SYN-[0-9]{4}$')",
    over: identified("SYN-01"),
    pin: "UNCHECKED",
    now: "VIOLATED",
    why: "a non-matching value violates it",
  },
  {
    row: "T16",
    rule: "matches()",
    expression: "gender.matches('^male$')",
    over: male,
    pin: "UNCHECKED",
    now: "none",
    why: "any string-valued primitive is matched on its value",
  },
  {
    row: "T17",
    rule: "matches()",
    expression: "text.div.matches('.*').exists()",
    over: textlessObservation,
    pin: "UNCHECKED",
    now: "VIOLATED",
    why: "ADDED: over an absent element `matches()` is `{}`, so `exists()` is false; test/invariants.test.ts carried this constraint as its unchecked probe and now carries `toString()`",
  },
  {
    row: "T18",
    rule: "R2",
    expression: "$this.is(FHIR.Patient)",
    over: bare,
    pin: "UNCHECKED",
    now: "none",
    why: "a qualified type name in function form is read as the operator form reads it",
  },
  {
    row: "T19",
    rule: "R1",
    expression: "value.ofType(FHIR.Quantity).exists()",
    over: quantityObservation,
    pin: "UNCHECKED",
    now: "none",
    why: "`ofType` refused every qualified name at the pin; `FHIR.Quantity` is `Quantity`",
  },
  {
    row: "T20",
    rule: "R1",
    expression: "value.as(FHIR.CodeableConcept).exists()",
    over: quantityObservation,
    pin: "UNCHECKED",
    now: "VIOLATED",
    why: "the qualified name's non-match, through `as()`",
  },
  {
    row: "T21",
    rule: "R3",
    expression: "name.ofType(System.String).exists()",
    over: namedPatient,
    pin: "UNCHECKED",
    now: "VIOLATED",
    why: "a complex node is never a System primitive, however the System name is written",
  },
];

const TYPE_TEST_CONTROLS: readonly Control[] = [
  {
    expression: "gender is code",
    over: male,
    both: "UNCHECKED",
    why: "a primitive not reached through a choice element: the instance does not establish `code`",
  },
  {
    expression: "name is HumanName",
    over: namedPatient,
    both: "UNCHECKED",
    why: "a complex element not reached through a choice element and not the root",
  },
  {
    expression: "deceased is dateTime",
    over: deceasedFalse,
    both: "UNCHECKED",
    why: "two different FHIR primitives are never related here",
  },
  {
    expression: "$this is Resource",
    over: bare,
    both: "UNCHECKED",
    why: "a relation to an abstract type is never established",
  },
  {
    expression: "gender.ofType(Quantity).exists()",
    over: bare,
    both: "VIOLATED",
    why: "`ofType` over an empty input was `{}` at the pin and still is",
  },
  {
    expression: "identifier.value.matches('\\\\d')",
    over: identified("SYN-0001"),
    both: "UNCHECKED",
    why: "a pattern outside the portable subset is refused",
  },
  {
    expression: "text.div.toString().exists()",
    over: textlessObservation,
    both: "UNCHECKED",
    why: "a function still outside the subset is refused whatever its input",
  },
  {
    expression: "gender.ofType(System.String).exists()",
    over: male,
    both: "UNCHECKED",
    why: "a qualified System name over a primitive stays refused in `ofType`, as at the pin",
  },
  {
    expression: "gender.ofType(System.String).exists()",
    over: bare,
    both: "VIOLATED",
    why: "and over an empty input it is `{}`, lazily, as at the pin",
  },
  {
    expression: "$this.is(System.Patient)",
    over: bare,
    both: "UNCHECKED",
    why: "a qualified name that resolves in neither model is refused",
  },
];

describe("AC-13: the FHIR-type test and matches() movements, pinned row by row", () => {
  it("tables only rows that actually move, and only from UNCHECKED to a determination", () => {
    expect(TYPE_TEST_MOVEMENTS.filter((m) => m.pin === m.now)).toEqual([]);
    expect(TYPE_TEST_MOVEMENTS.filter((m) => m.pin !== "UNCHECKED")).toEqual([]);
    expect(TYPE_TEST_MOVEMENTS.map((m) => m.row)).toEqual(
      TYPE_TEST_MOVEMENTS.map((_, i) => `T${String(i + 1)}`),
    );
  });

  for (const movement of TYPE_TEST_MOVEMENTS) {
    it(`row ${movement.row} (${movement.rule}): \`${movement.expression}\` is ${movement.pin} at the pin and ${movement.now} here - ${movement.why}`, () => {
      expect(findings(movement.over, movement.expression)).toEqual(OUTCOME[movement.now]);
    });
  }

  for (const control of TYPE_TEST_CONTROLS) {
    it(`\`${control.expression}\` is ${control.both} at the pin and here - ${control.why}`, () => {
      expect(findings(control.over, control.expression)).toEqual(OUTCOME[control.both]);
    });
  }
});

describe("what the four do NOT move, measured on both trees rather than assumed", () => {
  for (const control of CONTROLS) {
    it(`\`${control.expression}\` is ${control.both} on both - ${control.why}`, () => {
      expect(findings(control.over, control.expression)).toEqual(OUTCOME[control.both]);
    });
  }
});
