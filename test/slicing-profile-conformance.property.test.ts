/**
 * Property: a `profile` slicing discriminator's nested check says a target conforms only when every
 * constraint the slice's profile places on an element present in the target is of a kind the
 * layers that ran enforce (`ENFORCED_CONSTRAINT_KINDS`). Each generated profile carries a random
 * set of constraints, one of each kind the element definition model can hold (and some it does not
 * model), all of them kept by the target, so the only thing that decides the answer is whether every
 * kind is on that list. Every profile and document here is synthetic: example.org canonicals,
 * plainly fake ids and values.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  loadStructureDefinition,
  parseResource,
  SLICE_UNCHECKED_REASONS,
  validateResource,
  type StructureDefinition,
} from "../src/index.js";
import { ENFORCED_CONSTRAINT_KINDS } from "../src/profiles/validate-profile.js";
import { propertyRun, propertyTimeout } from "./_property-run.js";
import { req } from "./_util.js";

const RUN = propertyRun({ numRuns: 100 });
const BASE = "http://example.org/StructureDefinition/";

/** One kind of constraint, as the element fragments that place it on a present element. */
interface Kind {
  readonly kind: string;
  readonly elements: readonly Record<string, unknown>[];
}

/** An identifier slicing by `system`, slice `fake`, which the target's one identifier fills. */
const identifierSlicing: Record<string, unknown>[] = [
  {
    id: "Observation.identifier",
    path: "Observation.identifier",
    slicing: { discriminator: [{ type: "value", path: "system" }], rules: "open" },
  },
  { id: "Observation.identifier:fake", path: "Observation.identifier", sliceName: "fake" },
  {
    id: "Observation.identifier:fake.system",
    path: "Observation.identifier.system",
    fixedUri: "http://example.org/fake-ids",
  },
];

/**
 * Every kind of constraint the element definition model holds, each on an element of its own where
 * two would clash, and each kept by {@link target}. The allowed kinds are exactly the keys of
 * `ENFORCED_CONSTRAINT_KINDS`; the rest are what no layer enforces.
 */
const KINDS: readonly Kind[] = [
  { kind: "min", elements: [{ id: "Observation.status", path: "Observation.status", min: 1 }] },
  { kind: "max", elements: [{ id: "Observation.note", path: "Observation.note", max: "1" }] },
  {
    kind: "mustSupport",
    elements: [{ id: "Observation.code", path: "Observation.code", mustSupport: true }],
  },
  {
    kind: "fixed",
    elements: [
      {
        id: "Observation.identifier.system",
        path: "Observation.identifier.system",
        fixedUri: "http://example.org/fake-ids",
      },
    ],
  },
  {
    kind: "pattern",
    elements: [
      {
        id: "Observation.category",
        path: "Observation.category",
        patternCodeableConcept: { text: "fake category" },
      },
    ],
  },
  { kind: "slicing", elements: identifierSlicing },
  {
    kind: "constraint",
    elements: [
      {
        id: "Observation.subject",
        path: "Observation.subject",
        constraint: [{ key: "fake-1", severity: "error", expression: "reference.exists()" }],
      },
    ],
  },
  {
    kind: "binding:schema",
    elements: [
      {
        id: "Observation.status",
        path: "Observation.status",
        binding: {
          strength: "required",
          valueSet: "http://hl7.org/fhir/ValueSet/observation-status|4.0.1",
        },
      },
    ],
  },
  {
    kind: "binding:advisory",
    elements: [
      {
        id: "Observation.code",
        path: "Observation.code",
        binding: { strength: "example", valueSet: "http://example.org/ValueSet/fake-codes" },
      },
    ],
  },
  {
    kind: "type:code",
    elements: [
      { id: "Observation.value[x]", path: "Observation.value[x]", type: [{ code: "Quantity" }] },
    ],
  },
  {
    kind: "constraint:slice",
    elements: [
      ...identifierSlicing,
      {
        id: "Observation.identifier:fake",
        path: "Observation.identifier",
        constraint: [{ key: "fake-2", severity: "error", expression: "value.exists()" }],
      },
    ],
  },
  {
    kind: "binding:unenforced",
    elements: [
      {
        id: "Observation.category",
        path: "Observation.category",
        binding: { strength: "extensible", valueSet: "http://example.org/ValueSet/fake-cats" },
      },
    ],
  },
  {
    kind: "type:profile",
    elements: [
      {
        id: "Observation.code",
        path: "Observation.code",
        type: [{ code: "CodeableConcept", profile: [`${BASE}fake-cc`] }],
      },
    ],
  },
  {
    kind: "type:targetProfile",
    elements: [
      {
        id: "Observation.subject",
        path: "Observation.subject",
        type: [
          { code: "Reference", targetProfile: ["http://hl7.org/fhir/StructureDefinition/Patient"] },
        ],
      },
    ],
  },
  {
    kind: "type:unchecked",
    elements: [
      {
        id: "Observation.effective[x]",
        path: "Observation.effective[x]",
        type: [{ code: "Period" }],
      },
    ],
  },
  {
    kind: "maxLength",
    elements: [{ id: "Observation.id", path: "Observation.id", maxLength: 64 }],
  },
  {
    kind: "minValueDecimal",
    elements: [
      {
        id: "Observation.value[x].value",
        path: "Observation.value[x].value",
        minValueDecimal: 0,
      },
    ],
  },
  {
    kind: "maxValueDecimal",
    elements: [
      {
        id: "Observation.value[x].value",
        path: "Observation.value[x].value",
        maxValueDecimal: 100,
      },
    ],
  },
  {
    kind: "contentReference",
    elements: [
      { id: "Observation.note", path: "Observation.note", contentReference: "#Observation.note" },
    ],
  },
  {
    kind: "extension:http://example.org/StructureDefinition/fake-rule",
    elements: [
      {
        id: "Observation.status",
        path: "Observation.status",
        extension: [{ url: "http://example.org/StructureDefinition/fake-rule", valueString: "x" }],
      },
    ],
  },
  {
    kind: "binding.extension:http://hl7.org/fhir/StructureDefinition/elementdefinition-maxValueSet",
    elements: [
      {
        id: "Observation.method",
        path: "Observation.method",
        binding: {
          strength: "preferred",
          valueSet: "http://example.org/ValueSet/fake-methods",
          extension: [
            {
              url: "http://hl7.org/fhir/StructureDefinition/elementdefinition-maxValueSet",
              valueCanonical: "http://example.org/ValueSet/fake-methods",
            },
          ],
        },
      },
    ],
  },
  {
    kind: "type.aggregation",
    elements: [
      {
        id: "Observation.performer",
        path: "Observation.performer",
        type: [{ code: "Reference", aggregation: ["referenced"] }],
      },
    ],
  },
  {
    kind: "fakeRule",
    elements: [
      { id: "Observation.interpretation", path: "Observation.interpretation", fakeRule: true },
    ],
  },
];

/** The Observation every generated profile is checked against: it keeps every constraint above. */
const target = {
  resourceType: "Observation",
  id: "fake-o",
  identifier: [{ system: "http://example.org/fake-ids", value: "fake-1" }],
  status: "final",
  category: [{ text: "fake category" }],
  code: { text: "fake code" },
  subject: { reference: "Patient/fake-p" },
  effectiveDateTime: "2020-01-01",
  performer: [{ reference: "Practitioner/fake-pr" }],
  valueQuantity: { value: 1, unit: "mg" },
  interpretation: [{ text: "fake interpretation" }],
  note: [{ text: "fake note" }],
  method: { text: "fake method" },
};

/** The target's profile: the root, and every chosen kind's fragments merged by element id. */
function profileWith(kinds: readonly Kind[]): Record<string, unknown> {
  const byId = new Map<string, Record<string, unknown>>();
  byId.set("Observation", { id: "Observation", path: "Observation" });
  for (const { elements } of kinds) {
    for (const fragment of elements) {
      const id = String(fragment["id"]);
      byId.set(id, { ...byId.get(id), ...fragment });
    }
  }
  return {
    resourceType: "StructureDefinition",
    url: `${BASE}fake-target`,
    type: "Observation",
    snapshot: { element: [...byId.values()] },
  };
}

function loadSd(obj: unknown): StructureDefinition {
  return req(loadStructureDefinition(parseResource(JSON.stringify(obj)).resource));
}

/** A closed Bundle slicing on `entry` by the profile of its `resource`: slice `x`, required. */
const bundleProfile = loadSd({
  resourceType: "StructureDefinition",
  url: `${BASE}fake-bundle`,
  type: "Bundle",
  snapshot: {
    element: [
      { id: "Bundle", path: "Bundle" },
      {
        id: "Bundle.entry",
        path: "Bundle.entry",
        slicing: { discriminator: [{ type: "profile", path: "resource" }], rules: "closed" },
      },
      { id: "Bundle.entry:x", path: "Bundle.entry", sliceName: "x", min: 1, max: "1" },
      {
        id: "Bundle.entry:x.resource",
        path: "Bundle.entry.resource",
        type: [{ code: "Observation", profile: [`${BASE}fake-target`] }],
      },
    ],
  },
});

const bundle = parseResource(
  JSON.stringify({
    resourceType: "Bundle",
    type: "collection",
    entry: [{ fullUrl: "urn:uuid:fake-1", resource: target }],
  }),
).resource;

/** The nested check's answer for the target against a profile carrying the given kinds. */
function answer(kinds: readonly Kind[]): "conforms" | "undecided" | "other" {
  const result = validateResource(bundle, {
    profiles: [bundleProfile, loadSd(profileWith(kinds))],
  });
  const unchecked = result.issues.filter((i) => i.code === "PROFILE_SLICE_UNCHECKED");
  const errors = result.issues.filter((i) => i.severity === "error");
  if (unchecked.length === 0 && errors.length === 0) return "conforms";
  if (
    errors.length === 0 &&
    unchecked.length === 1 &&
    unchecked[0]?.sliceReason === SLICE_UNCHECKED_REASONS.PROFILE_UNDECIDED
  )
    return "undecided";
  return "other";
}

describe("property: the nested profile check affirms only the kinds a layer enforces", () => {
  it("names every allowed kind in the catalogue the property draws from", () => {
    const drawn = new Set(KINDS.map((k) => k.kind));
    for (const kind of ENFORCED_CONSTRAINT_KINDS.keys()) expect(drawn.has(kind), kind).toBe(true);
  });

  it("answers each kind alone: conforms when it is allowed, undecided when it is not", () => {
    for (const kind of KINDS) {
      expect(answer([kind]), kind.kind).toBe(
        ENFORCED_CONSTRAINT_KINDS.has(kind.kind) ? "conforms" : "undecided",
      );
    }
  });

  it(
    "never says conforms unless every kind the profile places is allowed",
    () => {
      fc.assert(
        fc.property(
          fc.uniqueArray(fc.constantFrom(...KINDS), { minLength: 1, maxLength: 5 }),
          (kinds) => {
            const allowed = kinds.every((k) => ENFORCED_CONSTRAINT_KINDS.has(k.kind));
            expect(answer(kinds)).toBe(allowed ? "conforms" : "undecided");
          },
        ),
        RUN,
      );
    },
    propertyTimeout(),
  );
});
