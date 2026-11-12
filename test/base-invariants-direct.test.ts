/**
 * `ele-1` and `ext-1` are asked of every element of a resource, so the base-constraint layer decides
 * them with code written for them instead of running their expressions through the FHIRPath engine
 * at each element. This holds that code to the engine's own answer: at every node of every resource
 * drawn here, both constraints, the direct outcome and the engine's are the same.
 *
 * The nodes come from `@cosyte/fhir/arbitraries` on a fixed seed, clean and messy JSON and XML,
 * plus nodes built by hand for the shapes the engine's navigation treats specially: a list inside a
 * list, an empty list, a `[x]` variant of `id`, `extension` or `value`, a repeated name, a primitive
 * with an `id` and no value. Every document is synthetic.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  complex,
  decimal,
  list,
  parseResource,
  parseResourceXml,
  primitive,
  type FhirComplex,
  type FhirNode,
} from "../src/index.js";
import { resource as resourceArbitrary } from "../src/arbitraries/resource.js";
import { resourceJson, resourceXml } from "../src/arbitraries/text.js";
import {
  baseConstraintOutcomes,
  collectBaseInvariantFindings,
} from "../src/validate/base-invariants.js";
import { propertyRun } from "./_property-run.js";

/** Every node under `node`, itself first, including a primitive's extensions and shadowed members. */
function nodesOf(node: FhirNode): FhirNode[] {
  const out: FhirNode[] = [node];
  if (node.kind === "list") for (const item of node.items) out.push(...nodesOf(item));
  else if (node.kind === "primitive")
    for (const ext of node.extension ?? []) out.push(...nodesOf(ext));
  else {
    for (const property of [...node.properties, ...(node.duplicates ?? [])]) {
      out.push(...nodesOf(property.value));
    }
  }
  return out;
}

/** Both constraints, direct and by the engine, at every node of `resource`. */
function expectAgreement(resource: FhirComplex): void {
  for (const node of nodesOf(resource)) {
    for (const key of ["ele-1", "ext-1"]) {
      const { engine, direct } = baseConstraintOutcomes(key, node, resource);
      expect(direct).toBe(engine);
    }
  }
}

const ext = complex([
  { name: "url", value: primitive("http://example.org/x") },
  { name: "valueString", value: primitive("v") },
]);

/** Nodes for the shapes the engine's navigation treats specially. */
const HAND_BUILT: readonly FhirComplex[] = [
  complex([]),
  complex([{ name: "resourceType", value: primitive("Basic") }]),
  complex([{ name: "id", value: primitive("a") }]),
  complex([
    { name: "id", value: primitive("a") },
    { name: "text", value: primitive("t") },
  ]),
  complex([{ name: "idX", value: list([primitive("a"), primitive("b")]) }]),
  complex([
    { name: "idX", value: primitive("a") },
    { name: "idY", value: list([list([primitive("b"), primitive("c")]), list([])]) },
    { name: "code", value: primitive("c") },
  ]),
  complex([
    { name: "id", value: list([]) },
    { name: "idZ", value: primitive("z") },
  ]),
  complex([{ name: "ids", value: primitive("lower-case suffix is not a variant") }]),
  complex([{ name: "extension", value: list([ext]) }]),
  complex([
    { name: "extension", value: list([]) },
    { name: "valueQuantity", value: complex([{ name: "value", value: primitive(decimal("1")) }]) },
  ]),
  complex([
    { name: "url", value: primitive("u") },
    { name: "extensionFoo", value: ext },
  ]),
  complex([
    { name: "url", value: primitive("u") },
    { name: "value", value: list([]) },
    { name: "valueString", value: primitive("s") },
  ]),
  complex([
    { name: "url", value: primitive("u") },
    { name: "valueBoolean", value: primitive(false) },
    { name: "extension", value: list([list([ext])]) },
  ]),
  complex(
    [{ name: "status", value: primitive("final") }],
    [
      { name: "id", value: primitive("shadowed") },
      { name: "value", value: primitive("shadowed") },
    ],
  ),
  complex([
    { name: "given", value: list([primitive(undefined, { id: "g1" }), primitive("b")]) },
    { name: "birthDate", value: primitive(undefined, { id: "b", extension: [ext] }) },
    { name: "active", value: primitive(true, { extension: [] }) },
    { name: "nested", value: list([list([]), list([list([primitive("deep")])])]) },
  ]),
];

describe("ele-1 and ext-1, decided directly", () => {
  it("agree with the engine at every node of hand-built shapes", () => {
    for (const resource of HAND_BUILT) expectAgreement(resource);
  });

  it("agree with the engine at every node of generated resources", () => {
    fc.assert(
      fc.property(resourceArbitrary(), expectAgreement),
      propertyRun({ seed: 7101, numRuns: 150 }),
    );
  });

  it("agree with the engine at every node of messy JSON and of XML", () => {
    fc.assert(
      fc.property(resourceJson(), (text) => {
        expectAgreement(parseResource(text).resource);
      }),
      propertyRun({ seed: 7102, numRuns: 150 }),
    );
    fc.assert(
      fc.property(resourceXml(), (text) => {
        expectAgreement(parseResourceXml(text).resource);
      }),
      propertyRun({ seed: 7103, numRuns: 100 }),
    );
  });

  it("are decided directly, and only those two", () => {
    const node = complex([]);
    expect(baseConstraintOutcomes("ele-1", node, node).direct).toBe("violated");
    expect(baseConstraintOutcomes("ext-1", node, node).direct).toBe("violated");
    expect(baseConstraintOutcomes("dom-2", node, node)).toEqual({
      engine: "satisfied",
      direct: undefined,
    });
  });
});

describe("what the layer records as decided", () => {
  const EXT1 = "extension.exists() != value.exists()";
  const ELE1 = "hasValue() or (children().count() > id.count())";

  it("records each key at each node it decided, one key or several, and nothing elsewhere", () => {
    const extension = complex([
      { name: "url", value: primitive("http://example.org/x") },
      { name: "valueString", value: primitive("v") },
    ]);
    const shared = primitive("b");
    const patient = complex([
      { name: "resourceType", value: primitive("Patient") },
      { name: "extension", value: list([extension]) },
      // The same node object at two positions: decided twice, recorded once.
      { name: "name", value: list([complex([{ name: "given", value: list([shared, shared]) }])]) },
    ]);
    const { decides } = collectBaseInvariantFindings(patient, "Patient");
    expect(decides(extension, "ext-1", EXT1)).toBe(true);
    expect(decides(extension, "ele-1", ELE1)).toBe(true);
    expect(decides(shared, "ele-1", ELE1)).toBe(true);
    expect(decides(shared, "ext-1", EXT1)).toBe(false);
    expect(decides(patient, "ele-1", ELE1)).toBe(false);
    expect(decides(complex([]), "ext-1", EXT1)).toBe(false);
    expect(decides(extension, "ext-1", "value.exists()")).toBe(false);

    // Asked not to keep the table (the validator, when no profile is supplied), it records nothing,
    // and the findings are the same either way.
    const untracked = collectBaseInvariantFindings(patient, "Patient", { decides: false });
    expect(untracked.decides(extension, "ext-1", EXT1)).toBe(false);
    expect(untracked.decides(shared, "ele-1", ELE1)).toBe(false);
    expect(untracked.findings).toEqual(collectBaseInvariantFindings(patient, "Patient").findings);
  });
});
