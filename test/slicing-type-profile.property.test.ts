/**
 * Properties of the `type` and `profile` slicing discriminators, over generated documents. Every
 * profile and document here is synthetic: example.org canonicals, plainly fake ids and values.
 *
 * - A `type` discriminator on a choice element assigns an occurrence to the slice that names its
 *   type, and to no other, and is never reported unchecked when every slice names a type.
 * - Deciding membership only adds findings: every error the same profile draws with its slicing
 *   left undecided (an R5 `position` discriminator) is still drawn when the slicing is decided.
 * - A `profile` discriminator, alone or beside any other kinds, in any order, leaves the slicing
 *   unchecked with the `profile-discriminator` reason and draws no membership finding either way.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  collectProfileIssues,
  loadStructureDefinition,
  parseResource,
  SLICE_UNCHECKED_REASONS,
  type FhirComplex,
  type StructureDefinition,
  type ValidationIssue,
} from "../src/index.js";
import { propertyRun } from "./_property-run.js";
import { req } from "./_util.js";

const RUN = propertyRun({ numRuns: 200 });
const BASE = "http://example.org/StructureDefinition/";

/** The choice variants a generated Observation's `value[x]` takes, with a fake value of each. */
const VARIANTS: Readonly<Record<string, unknown>> = {
  Quantity: { value: 1, system: "http://unitsofmeasure.org", code: "1" },
  CodeableConcept: { text: "fake" },
  String: "fake",
  Boolean: true,
  Integer: 3,
  Period: { start: "2020-01-01" },
};
const NAMES = Object.keys(VARIANTS);

/** The type code a suffix spells in a profile: primitives lower-case their first letter. */
function code(suffix: string): string {
  return ["String", "Boolean", "Integer"].includes(suffix)
    ? suffix.charAt(0).toLowerCase() + suffix.slice(1)
    : suffix;
}

function loadSd(obj: unknown): StructureDefinition {
  return req(loadStructureDefinition(parseResource(JSON.stringify(obj)).resource));
}

function parse(obj: unknown): FhirComplex {
  return parseResource(JSON.stringify(obj)).resource;
}

/** A profile slicing `value[x]` by type into one slice per named variant, each requiring `id`. */
function valueSlicing(
  sliceTypes: readonly string[],
  discriminator: string,
  rules: string,
): StructureDefinition {
  return loadSd({
    resourceType: "StructureDefinition",
    url: `${BASE}generated-${discriminator}-${rules}`,
    type: "Observation",
    snapshot: {
      element: [
        { id: "Observation", path: "Observation" },
        {
          id: "Observation.value[x]",
          path: "Observation.value[x]",
          slicing: { discriminator: [{ type: discriminator, path: "$this" }], rules },
        },
        ...sliceTypes.flatMap((suffix) => [
          {
            id: `Observation.value[x]:value${suffix}`,
            path: "Observation.value[x]",
            sliceName: `value${suffix}`,
            min: 1,
            max: "1",
            type: [{ code: code(suffix) }],
          },
          {
            id: `Observation.value[x]:value${suffix}.id`,
            path: "Observation.value[x].id",
            min: 1,
          },
        ]),
      ],
    },
  });
}

function errors(issues: readonly ValidationIssue[]): string[] {
  return issues.filter((i) => i.severity === "error").map((i) => `${i.code} ${i.expression}`);
}

const variant = fc.constantFrom(...NAMES);
const sliceTypes = fc.uniqueArray(variant, { minLength: 1, maxLength: NAMES.length });
const rules = fc.constantFrom("open", "closed");

describe("property: a type discriminator on a choice element", () => {
  it("assigns the occurrence to the slice naming its type, and never reports unchecked", () => {
    fc.assert(
      fc.property(variant, sliceTypes, rules, (suffix, types, rule) => {
        const profile = valueSlicing(types, "type", rule);
        const obs = parse({ resourceType: "Observation", [`value${suffix}`]: VARIANTS[suffix] });
        const found = collectProfileIssues(obs, profile).map((i) => `${i.code} ${i.expression}`);
        expect(found.filter((f) => f.startsWith("PROFILE_SLICE_UNCHECKED"))).toEqual([]);
        const named = types.includes(suffix);
        // Every other slice is required and has no member.
        for (const other of types.filter((t) => t !== suffix)) {
          expect(found).toContain(`CARDINALITY_MIN Observation.value[x]:value${other}`);
        }
        // A slice naming the occurrence's type has its member, and no slice is invented for it.
        expect(found).not.toContain(`CARDINALITY_MIN Observation.value[x]:value${suffix}`);
        // The member's own slice requires an `id` it does not carry, and only a member draws that.
        expect(found.includes("CARDINALITY_MIN Observation.value[x].id")).toBe(named);
        expect(found.includes("PROFILE_SLICE_UNMATCHED Observation.value[x][0]")).toBe(
          !named && rule === "closed",
        );
      }),
      RUN,
    );
  });

  it("only adds errors to what the same profile draws with its slicing undecided", () => {
    fc.assert(
      fc.property(variant, sliceTypes, rules, (suffix, types, rule) => {
        const obs = parse({ resourceType: "Observation", [`value${suffix}`]: VARIANTS[suffix] });
        const undecided = errors(collectProfileIssues(obs, valueSlicing(types, "position", rule)));
        const decided = errors(collectProfileIssues(obs, valueSlicing(types, "type", rule)));
        for (const finding of undecided) expect(decided).toContain(finding);
      }),
      RUN,
    );
  });
});

/** The other discriminators a generated slicing may carry beside its `profile` one. */
const OTHER_DISCRIMINATORS = [
  { type: "type", path: "$this" },
  { type: "value", path: "system" },
  { type: "pattern", path: "$this" },
  { type: "exists", path: "id" },
] as const;

/** A profile slicing `value[x]` by `profile` and the given others, one required slice per variant. */
function profileSlicing(
  sliceTypes: readonly string[],
  others: readonly (typeof OTHER_DISCRIMINATORS)[number][],
  rule: string,
  profileFirst: boolean,
): StructureDefinition {
  const profile = { type: "profile", path: "$this" };
  return loadSd({
    resourceType: "StructureDefinition",
    url: `${BASE}generated-profile-${rule}`,
    type: "Observation",
    snapshot: {
      element: [
        { id: "Observation", path: "Observation" },
        {
          id: "Observation.value[x]",
          path: "Observation.value[x]",
          slicing: {
            discriminator: profileFirst ? [profile, ...others] : [...others, profile],
            rules: rule,
          },
        },
        ...sliceTypes.flatMap((suffix) => [
          {
            id: `Observation.value[x]:value${suffix}`,
            path: "Observation.value[x]",
            sliceName: `value${suffix}`,
            min: 1,
            max: "1",
            type: [{ code: code(suffix), profile: [`${BASE}generated-${suffix}`] }],
          },
          {
            id: `Observation.value[x]:value${suffix}.id`,
            path: "Observation.value[x].id",
            min: 1,
          },
        ]),
      ],
    },
  });
}

describe("property: a profile discriminator", () => {
  it("leaves the slicing unchecked, with its reason, and draws no membership finding", () => {
    fc.assert(
      fc.property(
        variant,
        sliceTypes,
        rules,
        fc.subarray([...OTHER_DISCRIMINATORS]),
        fc.boolean(),
        (suffix, types, rule, others, profileFirst) => {
          const profile = profileSlicing(types, others, rule, profileFirst);
          const obs = parse({ resourceType: "Observation", [`value${suffix}`]: VARIANTS[suffix] });
          const issues = collectProfileIssues(obs, profile, { profiles: [profile] });
          expect(
            issues
              .filter((i) => i.code === "PROFILE_SLICE_UNCHECKED")
              .map((i) => [i.expression, i.sliceReason]),
          ).toEqual([["Observation.value[x]", SLICE_UNCHECKED_REASONS.PROFILE_DISCRIMINATOR]]);
          // Nothing is assigned, so no slice is missing, no occurrence is outside the slicing, and
          // no slice's own constraint is applied.
          expect(errors(issues)).toEqual([]);
        },
      ),
      RUN,
    );
  });
});
