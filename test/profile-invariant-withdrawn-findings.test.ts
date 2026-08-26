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
  /** What this change answers. Asserted. */
  readonly now: Outcome;
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
    why: "a type name the generic model cannot decide: a CORRECT finding withdrawn",
  },
  {
    row: 12,
    remedy: 3,
    expression: "gender.ofType(Quantity).exists()",
    over: male,
    shipped: "VIOLATED",
    now: "UNCHECKED",
    why: "as row 11, through `ofType`, which routes to the same predicate",
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
    it(`row ${String(movement.row)} (remedy ${String(movement.remedy)}): \`${movement.expression}\` is ${movement.shipped} on the published package and ${movement.now} here - ${movement.why}`, () => {
      expect(findings(movement.over, movement.expression)).toEqual(OUTCOME[movement.now]);
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
