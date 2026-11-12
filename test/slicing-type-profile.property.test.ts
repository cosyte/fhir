/**
 * Properties of the `type` and `profile` slicing discriminators, over generated documents. Every
 * profile and document here is synthetic: example.org canonicals, plainly fake ids and values.
 *
 * - A `type` discriminator on a choice element assigns an occurrence to the slice that names its
 *   type, and to no other, and is never reported unchecked when every slice names a type.
 * - Deciding membership only adds findings: every error the same profile draws with its slicing
 *   left undecided (an R5 `position` discriminator) is still drawn when the slicing is decided.
 * - A `profile` discriminator over any graph of references among contained resources terminates,
 *   and answers either a decision or `profile-undecided`, never a guess.
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

/** A profile slicing `hasMember` by the profile each reference resolves to: this profile itself. */
const memberLoop = loadSd({
  resourceType: "StructureDefinition",
  url: `${BASE}generated-member-loop`,
  type: "Observation",
  snapshot: {
    element: [
      { id: "Observation", path: "Observation" },
      { id: "Observation.status", path: "Observation.status", min: 1 },
      {
        id: "Observation.hasMember",
        path: "Observation.hasMember",
        slicing: { discriminator: [{ type: "profile", path: "resolve()" }], rules: "open" },
      },
      {
        id: "Observation.hasMember:member",
        path: "Observation.hasMember",
        sliceName: "member",
        type: [{ code: "Reference", targetProfile: [`${BASE}generated-member-loop`] }],
      },
    ],
  },
});

/** A graph over up to five contained Observations: per node, whether it has a status, and its edges. */
const graph = fc.integer({ min: 1, max: 5 }).chain((n) =>
  fc.tuple(
    fc.array(fc.boolean(), { minLength: n, maxLength: n }),
    fc.array(fc.array(fc.integer({ min: 0, max: n }), { maxLength: 3 }), {
      minLength: n,
      maxLength: n,
    }),
    fc.array(fc.integer({ min: 0, max: n }), { minLength: 1, maxLength: 3 }),
  ),
);

/** A reference to node `i`, or, at `i === n`, one that names nothing in the closure. */
function ref(i: number, n: number): { reference: string } {
  return { reference: i === n ? "#fake-missing" : `#n${String(i)}` };
}

describe("property: a profile discriminator over contained references", () => {
  it("terminates on any reference graph and never guesses", () => {
    fc.assert(
      fc.property(graph, ([status, edges, roots]) => {
        const n = status.length;
        const obs = parse({
          resourceType: "Observation",
          status: "final",
          contained: status.map((has, i) => ({
            resourceType: "Observation",
            id: `n${String(i)}`,
            ...(has ? { status: "final" } : {}),
            hasMember: (edges[i] ?? []).map((j) => ref(j, n)),
          })),
          hasMember: roots.map((j) => ref(j, n)),
        });
        const issues = collectProfileIssues(obs, memberLoop, { profiles: [memberLoop] });
        const reasons = issues
          .filter((i) => i.code === "PROFILE_SLICE_UNCHECKED")
          .map((i) => i.sliceReason);
        for (const reason of reasons) {
          expect([
            SLICE_UNCHECKED_REASONS.PROFILE_UNDECIDED,
            SLICE_UNCHECKED_REASONS.TARGET_UNRESOLVED,
          ]).toContain(reason);
        }
        // A root reference that resolves nowhere always leaves the slicing unchecked.
        if (roots.includes(n)) expect(reasons).not.toEqual([]);
      }),
      RUN,
    );
  });
});
