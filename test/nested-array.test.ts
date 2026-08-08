import { describe, expect, it } from "vitest";

import {
  assertSafeToSummarize,
  codingsOf,
  evaluateInvariant,
  FhirSafetyError,
  FhirSerializeError,
  getProperty,
  isComplex,
  isList,
  isNestedArray,
  isPrimitive,
  ISSUE_CODES,
  nestedArray,
  nestedArrayContent,
  nestedArrays,
  nodesEquivalent,
  parseResource,
  parseResourceXml,
  pathExists,
  primitive,
  complex,
  readSafety,
  resolvePath,
  SERIALIZE_ERROR_CODES,
  serializeResource,
  serializeResourceXml,
  validateResource,
  type FhirComplex,
  type FhirNode,
} from "../src/index.js";
import { nth, req } from "./_util.js";

/**
 * An array inside an array is a shape FHIR JSON gives no meaning at any position: json.html §2.6.2.2
 * uses an array for a repeating element and for nothing else, so no element is ever a list of lists.
 * The reader cannot model the inner array **as an element**, because there is no element for it to
 * be, and this suite is about how the package keeps that from costing anything.
 *
 * Three halves, and the split is the whole point.
 *
 * 1. **Refuse to affirm.** A document carrying one must never come back `valid: true` /
 *    `safeToSummarize: true` / `negations: []`, because the model would otherwise look exactly like
 *    an element the sender legitimately left out.
 * 2. **Preserve the content.** The array's JSON text is kept on the node and handed back by
 *    `nestedArrayContent`, and the writer emits it again, so no value the sender wrote is dropped and
 *    the finding survives a round trip instead of laundering away. Value-exact, not byte-exact: the
 *    text is the array re-rendered compactly, so whitespace goes and strings are re-escaped, and such
 *    output is deliberately not spec-clean.
 * 3. **Show no walker anything.** The preserved text is a string, not a node: it is not reachable
 *    through `properties`, `items` or `extension`, so a list still holds one item per position it
 *    held before, of the same kinds, with the same contents. Putting the array in the tree would
 *    redefine what a repeating element *contains* for every consumer in the package, and the
 *    negative assertions below are what hold that line.
 */

/** The `index`-th item of the list property `name` on `node`, which the tests below read a lot. */
function itemAt(node: FhirComplex, name: string, index: number): FhirNode {
  const property = req(getProperty(node, name), name);
  expect(isList(property), `${name} should be a list`).toBe(true);
  return nth(isList(property) ? property.items : [], index);
}

/** Read a document and return its safety readout together with its validation verdict. */
function verdict(json: string): {
  read: readonly string[];
  nested: readonly string[];
  valid: boolean;
  safe: boolean;
  negations: readonly string[];
  vcodes: readonly string[];
} {
  const { resource, issues } = parseResource(json);
  const safety = readSafety(resource);
  const result = validateResource(resource);
  return {
    read: issues.map((i) => i.code),
    nested: safety.nestedArrays,
    valid: result.valid,
    safe: safety.safeToSummarize,
    negations: safety.negations,
    vcodes: result.issues.map((i) => i.code),
  };
}

const ALLERGY_VER = "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification";
const ALLERGY_CLIN = "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical";
const CONDITION_CLIN = "http://terminology.hl7.org/CodeSystem/condition-clinical";

describe("a nested array is reported, never affirmed over", () => {
  it("refuses a refuted allergy whose verificationStatus coding sits inside a nested array", () => {
    // The document asserts, after investigation, that the allergy is NOT present. One level down
    // inside the CodeableConcept the reader cannot see it, so before this rule the record read back
    // as an ordinary active allergy with a clean bill of health.
    const v = verdict(
      JSON.stringify({
        resourceType: "AllergyIntolerance",
        clinicalStatus: { coding: [{ system: ALLERGY_CLIN, code: "active" }] },
        verificationStatus: { coding: [[{ system: ALLERGY_VER, code: "refuted" }]] },
        code: { text: "peanut" },
      }),
    );
    expect(v.nested).toEqual(["AllergyIntolerance.verificationStatus.coding[0]"]);
    expect(v.safe).toBe(false);
    expect(v.valid).toBe(false);
    expect(v.vcodes).toContain("NESTED_ARRAY");
    expect(v.read).toContain(ISSUE_CODES.NESTED_ARRAY);
    // The refutation itself is still NOT readable. That is the deliberate half: the library reports
    // that it could not read the element, it does not guess what was in it.
    expect(v.negations).toEqual([]);
  });

  it("refuses a resolved condition whose clinicalStatus coding sits inside a nested array", () => {
    const v = verdict(
      JSON.stringify({
        resourceType: "Condition",
        clinicalStatus: { coding: [[{ system: CONDITION_CLIN, code: "resolved" }]] },
      }),
    );
    expect(v.nested).toEqual(["Condition.clinicalStatus.coding[0]"]);
    expect(v.safe).toBe(false);
    expect(v.valid).toBe(false);
  });

  it("refuses a Bundle entry whose whole resource sits inside a nested array", () => {
    // The worst shape of all: an entire resource, in this case a retracted one, is absent from the
    // model, and the Bundle otherwise looks well-formed.
    const v = verdict(
      JSON.stringify({
        resourceType: "Bundle",
        type: "collection",
        entry: [[{ resource: { resourceType: "Observation", status: "entered-in-error" } }]],
      }),
    );
    expect(v.nested).toEqual(["Bundle.entry[0]"]);
    expect(v.safe).toBe(false);
    expect(v.valid).toBe(false);
  });

  it("refuses a recorded no-known-allergy inside a nested array", () => {
    const v = verdict(
      JSON.stringify({
        resourceType: "AllergyIntolerance",
        clinicalStatus: { coding: [{ system: ALLERGY_CLIN, code: "active" }] },
        code: { coding: [[{ system: "http://snomed.info/sct", code: "716186003" }]] },
      }),
    );
    expect(v.nested).toEqual(["AllergyIntolerance.code.coding[0]"]);
    expect(v.safe).toBe(false);
    expect(v.valid).toBe(false);
  });

  it("reports a nested array in a primitive's _-sibling, which used to be entirely silent", () => {
    // This is the one position that drew no diagnostic of any kind: `readMeta` reads metadata out of
    // an object and had nothing to read from an array, so the document parsed clean.
    const v = verdict('{"resourceType":"Patient","_birthDate":[[{"id":"x"}]]}');
    expect(v.read).toEqual([ISSUE_CODES.NESTED_ARRAY]);
    expect(v.nested).toEqual(["Patient.birthDate[0]"]);
    expect(v.safe).toBe(false);
    expect(v.valid).toBe(false);
  });

  it("reports a nested array inside a primitive's extension metadata", () => {
    const v = verdict(
      '{"resourceType":"Patient","birthDate":"1980-01-01",' +
        '"_birthDate":{"extension":[[{"url":"http://example.org/x"}]]}}',
    );
    expect(v.nested).toEqual(["Patient.birthDate.extension[0]"]);
    expect(v.safe).toBe(false);
  });

  it("reports a nested array inside a contained resource", () => {
    const v = verdict(
      JSON.stringify({
        resourceType: "Patient",
        contained: [
          { resourceType: "Observation", status: "final", code: { coding: [[{ code: "x" }]] } },
        ],
      }),
    );
    expect(v.nested).toEqual(["Patient.contained[0].code.coding[0]"]);
    expect(v.safe).toBe(false);
  });

  it("cannot be hidden behind a repeated property name", () => {
    // A shadowed member is still part of the document, so a nested array inside one is still a loss.
    const v = verdict('{"resourceType":"Patient","name":[{}],"name":[[{"family":"Roe"}]]}');
    expect(v.nested).toEqual(["Patient.name[0]"]);
    expect(v.safe).toBe(false);
    expect(v.vcodes).toContain("NESTED_ARRAY");
    // and the duplicate finding is still there alongside it.
    expect(v.vcodes).toContain("DUPLICATE_PROPERTY");
  });

  it("reports one location per element when a repeated name marks two nodes at it", () => {
    // FHIRPath cannot address the individual members of a repeated name, so a second identical
    // location would say nothing new, and two identical errors would be noise a caller cannot act on.
    const { resource } = parseResource(
      '{"resourceType":"Patient","gender":[["male"]],"gender":[["female"]],"active":[[true]]}',
    );
    const locations = nestedArrays(resource, "Patient");
    expect(locations).toEqual(["Patient.gender[0]", "Patient.active[0]"]);
    expect(new Set(locations).size).toBe(locations.length);
    const errors = validateResource(resource)
      .issues.filter((i) => i.code === "NESTED_ARRAY")
      .map((i) => i.expression);
    expect(errors).toEqual(["Patient.gender[0]", "Patient.active[0]"]);
  });

  it("reports even when the type gate itself is unreadable because of one", () => {
    const { resource } = parseResource('{"resourceType":[["Observation"]],"status":"final"}');
    expect(nestedArrays(resource, "$this")).toEqual(["$this.resourceType[0]"]);
    const result = validateResource(resource);
    expect(result.valid).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain("NESTED_ARRAY");
  });

  it("throws from assertSafeToSummarize with the location", () => {
    const { resource } = parseResource('{"resourceType":"Patient","name":[[{"family":"Roe"}]]}');
    expect(() => {
      assertSafeToSummarize(resource);
    }).toThrow(FhirSafetyError);
    try {
      assertSafeToSummarize(resource);
    } catch (err) {
      expect(err).toBeInstanceOf(FhirSafetyError);
      expect((err as FhirSafetyError).locations).toEqual(["Patient.name[0]"]);
      // Value-free: the refusal names the position, never what was in it.
      expect((err as FhirSafetyError).message).not.toContain("Roe");
    }
  });
});

describe("array positions are counted, not values", () => {
  it("indexes past a null slot rather than past a value", () => {
    // A FHIR JSON `null` is a real position marker in a primitive array, not padding to skip. The
    // nested array here is the SECOND position, and that is the location that must be reported.
    const { resource, issues } = parseResource(
      '{"resourceType":"Patient","name":[{"given":[null,["B"]]}]}',
    );
    expect(nestedArrays(resource, "Patient")).toEqual(["Patient.name[0].given[1]"]);
    expect(issues.filter((i) => i.code === ISSUE_CODES.NESTED_ARRAY)[0]?.expression).toBe(
      "Patient.name[0].given[1]",
    );
  });

  it("reports each nested position separately in a mixed array", () => {
    const { resource } = parseResource(
      '{"resourceType":"Patient","name":[{"given":["A",["B"],null,["C"]]}]}',
    );
    expect(nestedArrays(resource, "Patient")).toEqual([
      "Patient.name[0].given[1]",
      "Patient.name[0].given[3]",
    ]);
  });

  it("keeps the value and the _-sibling arrays aligned when one of them nests", () => {
    const { resource } = parseResource(
      '{"resourceType":"Patient","name":[{"given":["A","B"],"_given":[null,[{"id":"x"}]]}]}',
    );
    const given = req(prop(nth(items(getProperty(resource, "name")), 0), "given"));
    expect(items(given).length).toBe(2);
    // The nested `_`-sibling did not consume the value beside it: position 1 still holds "B".
    const second = nth(items(given), 1);
    expect(isPrimitive(second) ? second.value : undefined).toBe("B");
    expect(nestedArrays(resource, "Patient")).toEqual(["Patient.name[0].given[1]"]);
  });
});

/** A node with every nested-array marker removed, for comparing content rather than diagnostics. */
function stripMarker(node: FhirNode): FhirNode {
  if (isList(node)) return { kind: "list", items: node.items.map(stripMarker) };
  if (isPrimitive(node)) {
    const {
      nestedArray: _drop,
      nestedArraySource: _dropValue,
      nestedArrayMetaSource: _dropMeta,
      ...rest
    } = node;
    return rest.extension === undefined
      ? rest
      : { ...rest, extension: rest.extension.map((e) => stripMarker(e) as typeof e) };
  }
  const { nestedArray: _drop, nestedArraySource: _dropValue, ...rest } = node;
  return {
    ...rest,
    properties: rest.properties.map((prty) => ({
      name: prty.name,
      value: stripMarker(prty.value),
    })),
  };
}

/** The items of a node that must be a list. */
function items(node: FhirNode | undefined): readonly FhirNode[] {
  const list = req(node, "node");
  expect(isList(list)).toBe(true);
  return isList(list) ? list.items : [];
}

/** A named property of a node that must be a complex. */
function prop(node: FhirNode, name: string): FhirNode | undefined {
  expect(isComplex(node)).toBe(true);
  return isComplex(node) ? getProperty(node, name) : undefined;
}

describe("the content is preserved, and no walker can see it", () => {
  const NESTED = '{"resourceType":"Patient","name":[[{"family":"Roe"}]]}';

  it("leaves the list holding exactly one item per position, of the same kind", () => {
    const { resource } = parseResource(NESTED);
    const name = items(getProperty(resource, "name"));
    expect(name.length).toBe(1);
    const item = nth(name, 0);
    expect(isComplex(item)).toBe(true);
    // Still the empty element it has always been. The inner object is NOT a property of it, and the
    // inner array is NOT an item of the outer list.
    expect(isComplex(item) ? item.properties.length : -1).toBe(0);
    expect(name.some((n) => isList(n))).toBe(false);
  });

  it("marks the position without making the value readable", () => {
    const { resource } = parseResource(NESTED);
    const item = nth(items(getProperty(resource, "name")), 0);
    expect(isNestedArray(item)).toBe(true);
    expect(prop(item, "family")).toBeUndefined();
  });

  it("leaves a nested array in a primitive list as one value-absent primitive", () => {
    const { resource } = parseResource('{"resourceType":"Patient","name":[{"given":["A",["B"]]}]}');
    const given = items(prop(nth(items(getProperty(resource, "name")), 0), "given"));
    expect(given.length).toBe(2);
    const second = nth(given, 1);
    expect(isPrimitive(second)).toBe(true);
    expect(isPrimitive(second) ? second.value : "set").toBeUndefined();
    expect(isNestedArray(second)).toBe(true);
  });

  it("is invisible to the coding walker", () => {
    // The walker a preserving change broke first: a nested coding must not become a coding. The
    // oracle throughout this block is the SAME document with the nested array replaced by the empty
    // element the model already holds, because that is exactly what a reader is entitled to see.
    const codingsFor = (inner: unknown): unknown =>
      codingsOf(
        getProperty(
          parseResource(
            JSON.stringify({
              resourceType: "Observation",
              status: "final",
              code: {
                coding: [inner, { system: "http://loinc.org", code: "8480-6" }],
              },
            }),
          ).resource,
          "code",
        ),
      );
    const nested = codingsFor([{ system: "http://loinc.org", code: "8867-4" }]);
    expect(nested).toEqual(codingsFor({}));
    expect(JSON.stringify(nested)).not.toContain("8867-4");
  });

  it("is invisible to the FHIRPath engine", () => {
    // A nested array must not resurrect a value that makes an invariant pass. `given` holds two
    // positions either way; the nested one has no value, so the value is not there to be found.
    const nested = parseResource('{"resourceType":"Patient","name":[{"given":["A",["B"]]}]}');
    const empty = parseResource('{"resourceType":"Patient","name":[{"given":["A",null]}]}');
    for (const expr of [
      "name.given.count() = 2",
      "name.given.where($this = 'B').exists()",
      "name.given.hasValue()",
      "name.family.exists()",
    ]) {
      expect(evaluateInvariant(expr, nested.resource, nested.resource).satisfied).toBe(
        evaluateInvariant(expr, empty.resource, empty.resource).satisfied,
      );
    }
    expect(
      evaluateInvariant("name.given.where($this = 'B').exists()", nested.resource, nested.resource)
        .satisfied,
    ).toBe(false);
  });

  it("is invisible to the profile path navigator", () => {
    const nested = parseResource(NESTED).resource;
    const empty = parseResource('{"resourceType":"Patient","name":[{}]}').resource;
    for (const path of ["Patient.name", "Patient.name.family", "name", "name.family"]) {
      expect(pathExists(nested, path)).toBe(pathExists(empty, path));
      // The marker itself is on the node, so compare what the navigator can READ out of what it
      // reached: same count, same content. Only the diagnostic flag differs.
      expect(resolvePath(nested, path).length).toBe(resolvePath(empty, path).length);
      expect(resolvePath(nested, path).map(stripMarker)).toEqual(
        resolvePath(empty, path).map(stripMarker),
      );
    }
    // and the family name is nowhere in what the navigator can reach.
    expect(resolvePath(nested, "Patient.name.family")).toEqual([]);
  });

  it("writes the array back exactly as the sender wrote it, inventing no element", () => {
    // The writer emits the preserved text. Before this it emitted `[{}]`, an object the sender never
    // wrote, which is what let the finding launder away on a re-read.
    const { resource } = parseResource(NESTED);
    expect(serializeResource(resource)).toBe(NESTED);
    expect(serializeResource(resource)).not.toContain("[{}]");
  });

  it("hands the lost content back as the exact text, on both JSON channels", () => {
    expect(nestedArrayContent(itemAt(parseResource(NESTED).resource, "name", 0))).toEqual([
      { channel: "value", json: '[{"family":"Roe"}]' },
    ]);

    // The two JSON channels are preserved separately, because a repeating primitive can nest in
    // either one alone or in both at the same position, and merging them would lose which was which.
    const doc =
      '{"resourceType":"Patient","name":[{"given":["A",["B"]],"_given":[null,[{"id":"x"}]]}]}';
    const firstName = itemAt(parseResource(doc).resource, "name", 0);
    expect(isComplex(firstName)).toBe(true);
    const given = isComplex(firstName) ? itemAt(firstName, "given", 1) : undefined;
    expect(nestedArrayContent(req(given))).toEqual([
      { channel: "value", json: '["B"]' },
      { channel: "metadata", json: '[{"id":"x"}]' },
    ]);
    // The position beside it is untouched, so the null-padded alignment still holds on the way out.
    const beside = isComplex(firstName) ? itemAt(firstName, "given", 0) : undefined;
    expect(nestedArrayContent(req(beside))).toEqual([]);
    expect(serializeResource(parseResource(doc).resource)).toBe(doc);
  });

  it("preserves a decimal inside a nested array as its exact lexical text", () => {
    // ADR 0001 does not stop applying because the position is unreadable: a dose that came in as
    // `0.010` must not come back as `0.01`, even from a position the model cannot place.
    const doc = '{"resourceType":"Observation","note":[[{"x":0.010}]]}';
    const note = itemAt(parseResource(doc).resource, "note", 0);
    expect(nth(nestedArrayContent(note), 0).json).toBe('[{"x":0.010}]');
    expect(serializeResource(parseResource(doc).resource)).toBe(doc);
  });

  it("returns nothing for a node the reader did not mark", () => {
    const { resource } = parseResource('{"resourceType":"Patient","name":[{"family":"Roe"}]}');
    expect(nestedArrayContent(resource)).toEqual([]);
    expect(nestedArrayContent(req(getProperty(resource, "name")))).toEqual([]);
  });
});

describe("no existing finding is suppressed", () => {
  it("keeps the unknown-property warning it always raised, and adds to it", () => {
    const { issues } = parseResource(NESTED_OBS);
    const codes = issues.map((i) => i.code);
    expect(codes).toContain(ISSUE_CODES.UNKNOWN_PROPERTY);
    expect(codes).toContain(ISSUE_CODES.NESTED_ARRAY);
  });

  it("keeps a true vital-signs unit error raised beside a nested array", () => {
    // The direction that matters: a new diagnostic must never silence a real one. The weight
    // Observation carries a genuine unit violation; a nested array elsewhere in the same document
    // must not make it disappear.
    const clean = JSON.stringify(WEIGHT_BAD_UNIT);
    const withNested = JSON.stringify({ ...WEIGHT_BAD_UNIT, note: [[{ text: "x" }]] });
    const before = validateResource(parseResource(clean).resource);
    const after = validateResource(parseResource(withNested).resource);
    expect(before.issues.map((i) => i.code)).toContain("VITAL_SIGN_UNIT_NONCONFORMANT");
    expect(after.issues.map((i) => i.code)).toContain("VITAL_SIGN_UNIT_NONCONFORMANT");
    expect(after.issues.map((i) => i.code)).toContain("NESTED_ARRAY");
  });

  it("keeps a retraction that is readable beside a nested array", () => {
    const { resource } = parseResource(
      '{"resourceType":"Observation","status":"entered-in-error","note":[[{"text":"x"}]]}',
    );
    const safety = readSafety(resource);
    expect(safety.retracted).toBe(true);
    expect(safety.negations).toContain("entered-in-error");
    expect(safety.nestedArrays).toEqual(["Observation.note[0]"]);
    expect(safety.safeToSummarize).toBe(false);
  });

  it("keeps the array-wrapped-scalar location when the wrapper is also nested", () => {
    const { resource } = parseResource('{"resourceType":"Observation","status":[["final"]]}');
    const safety = readSafety(resource);
    expect(safety.arrayWrappedScalars).toEqual(["Observation.status"]);
    expect(safety.nestedArrays).toEqual(["Observation.status[0]"]);
    expect(validateResource(resource).issues.map((i) => i.code)).toEqual(
      expect.arrayContaining(["ARRAY_WRAPPED_SCALAR", "NESTED_ARRAY"]),
    );
  });
});

const NESTED_OBS = '{"resourceType":"Observation","status":"final","note":[[{"text":"x"}]]}';

const WEIGHT_BAD_UNIT = {
  resourceType: "Observation",
  status: "final",
  category: [
    {
      coding: [
        {
          system: "http://terminology.hl7.org/CodeSystem/observation-category",
          code: "vital-signs",
        },
      ],
    },
  ],
  code: { coding: [{ system: "http://loinc.org", code: "29463-7" }] },
  valueQuantity: { value: 70, unit: "stone", system: "http://unitsofmeasure.org", code: "[stone]" },
};

describe("a conformant document is untouched", () => {
  it("says nothing about an element that really is empty", () => {
    const v = verdict('{"resourceType":"Patient","name":[{}]}');
    expect(v.nested).toEqual([]);
    expect(v.read).toEqual([]);
    expect(v.safe).toBe(true);
    expect(v.valid).toBe(true);
  });

  it("says nothing about a null slot in a repeating primitive", () => {
    const v = verdict('{"resourceType":"Patient","name":[{"given":["A",null]}]}');
    expect(v.nested).toEqual([]);
    expect(v.safe).toBe(true);
  });

  it("says nothing about an ordinary repeating element", () => {
    const v = verdict('{"resourceType":"Patient","name":[{"given":["A","B"]},{"given":["C"]}]}');
    expect(v.nested).toEqual([]);
    expect(v.read).toEqual([]);
    expect(v.safe).toBe(true);
  });
});

describe("cross-format and construction", () => {
  it("never fires on a document read from XML, which cannot express the shape", () => {
    const { resource } = parseResourceXml(
      '<Patient xmlns="http://hl7.org/fhir"><name><family value="Roe"/></name></Patient>',
    );
    expect(nestedArrays(resource, "Patient")).toEqual([]);
    expect(readSafety(resource).safeToSummarize).toBe(true);
  });

  it("stops the equivalence oracle calling a lost element the same as an empty one", () => {
    // The model holds an empty element either way, so before the marker was compared the oracle said
    // these two documents denote the same content. One of them lost a family name.
    const nested = parseResource('{"resourceType":"Patient","name":[[{"family":"Roe"}]]}');
    const plainEmpty = parseResource('{"resourceType":"Patient","name":[{}]}');
    expect(nodesEquivalent(nested.resource, plainEmpty.resource)).toBe(false);
    // The tightening is confined to the shape: two documents that really do agree still do.
    const alsoEmpty = parseResource('{"resourceType":"Patient","name":[{}]}');
    expect(nodesEquivalent(plainEmpty.resource, alsoEmpty.resource)).toBe(true);
    // Two documents that nested DIFFERENT content are not equivalent either, now that the content is
    // preserved: the oracle compares what was written, not merely that something was.
    expect(
      nodesEquivalent(
        nested.resource,
        parseResource('{"resourceType":"Patient","name":[[{"family":"Doe"}]]}').resource,
      ),
    ).toBe(false);
    // Two that nested the SAME content still agree, so the tightening stays confined to the shape.
    expect(
      nodesEquivalent(
        nested.resource,
        parseResource('{"resourceType":"Patient","name":[[{"family":"Roe"}]]}').resource,
      ),
    ).toBe(true);
  });

  it("is absent from a hand-built node and settable only deliberately", () => {
    expect(isNestedArray(complex([]))).toBe(false);
    expect(isNestedArray(primitive("x"))).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(complex([]), "nestedArray")).toBe(false);
    // The marker is the reader's to set, not a consumer's: `markNestedArray` is deliberately absent
    // from the package's public surface, so the only way to obtain a marked node is to read a
    // document that carried the shape.
    const marked = nth(
      items(
        getProperty(
          parseResource('{"resourceType":"Patient","name":[[{"family":"Roe"}]]}').resource,
          "name",
        ),
      ),
      0,
    );
    expect(isNestedArray(marked)).toBe(true);
    // A list is never the marked node; the position inside it is.
    expect(isNestedArray({ kind: "list", items: [] })).toBe(false);
  });

  it("builds a value-free issue at the position the inner array occupied", () => {
    expect(nestedArray("Patient.name[0]")).toEqual({
      code: "NESTED_ARRAY",
      severity: "warning",
      expression: "Patient.name[0]",
    });
  });
});

describe("the two report channels name the same position, for the cases below", () => {
  it("agrees where the nested array is the element, or is the extension item itself", () => {
    const docs = [
      '{"resourceType":"Patient","name":[[{"family":"Roe"}]]}',
      '{"resourceType":"Patient","name":[{"given":[null,["B"]]}]}',
      '{"resourceType":"Patient","_birthDate":[[{"id":"x"}]]}',
      '{"resourceType":"Patient","birthDate":"1980-01-01",' +
        '"_birthDate":{"extension":[[{"url":"http://example.org/x"}]]}}',
      '{"resourceType":"Observation","status":[["final"]]}',
    ];
    for (const doc of docs) {
      const { resource, issues } = parseResource(doc);
      const fromRead = issues
        .filter((i) => i.code === ISSUE_CODES.NESTED_ARRAY)
        .map((i) => i.expression);
      const rt = readSafety(resource).resourceType ?? "$this";
      // The `_`-sibling case is the one where the reader's older warnings use a `_`-prefixed path
      // that is not FHIRPath. The nested-array report uses the FHIRPath form on both channels here,
      // so a consumer correlating them finds the same string.
      expect(fromRead).toEqual(nestedArrays(resource, rt));
    }
  });

  it("agrees one level INSIDE an extension too, where the two used to differ", () => {
    // The reader names a primitive's metadata in FHIRPath form at every depth, not only at the depth
    // an override happened to cover, so correlating the read channel with the safety readout is
    // string equality rather than a rewrite the consumer has to know about.
    const { resource, issues } = parseResource(
      '{"resourceType":"Patient","birthDate":"1980-01-01","_birthDate":{"extension":[{"url":[["u"]]}]}}',
    );
    const fromRead = issues
      .filter((i) => i.code === ISSUE_CODES.NESTED_ARRAY)
      .map((i) => i.expression);
    expect(fromRead).toEqual(["Patient.birthDate.extension[0].url[0]"]);
    expect(nestedArrays(resource, "Patient")).toEqual(["Patient.birthDate.extension[0].url[0]"]);
    // What matters most is still that neither channel is silent and the document is refused.
    expect(readSafety(resource).safeToSummarize).toBe(false);
    expect(validateResource(resource).valid).toBe(false);
  });

  it("names a primitive's metadata in FHIRPath form on the reader's older warnings too", () => {
    // The `_` is an artifact of how FHIR JSON splits a primitive's value from its metadata; FHIRPath
    // addresses both as members of the element. One convention, everywhere the reader reports.
    const { issues } = parseResource(
      '{"resourceType":"Patient","birthDate":"1980-01-01","_birthDate":{"foo":"bar"}}',
    );
    expect(issues.map((i) => i.expression)).toEqual(["Patient.birthDate.foo"]);
  });
});

describe("the one channel the rule does not reach, pinned rather than claimed away", () => {
  // The rule is bounded by what the reader modeled. A `_`-sibling the reader discards WHOLE, because
  // it is misplaced or unrecognised, leaves no node to mark, so an array inside one is reported
  // against the discarded sibling and is not refused. WHICH code reports it is per member, not one
  // code for all three: `UNKNOWN_PROPERTY` for an unrecognised member of a `_`-sibling object,
  // `MISPLACED_PRIMITIVE_EXTENSION` for a sibling on an object or on a non-primitive array.
  // Reaching it means reading raw JSON the codec does not
  // model, which is the preserving problem, not the reporting one. This behaviour is unchanged from
  // before the rule existed; it is pinned so that the claim on the public surface stays true and so
  // that closing it later is a deliberate act.
  // Each entry pins WHICH code reports the discard, because the two discard routes are different
  // defects: a sibling written where FHIR defines no sibling at all, and an unrecognised member
  // inside a well-placed one.
  const uncovered = [
    // a `_`-sibling on an object element
    {
      doc: '{"resourceType":"Patient","name":{"family":"Roe"},"_name":[[{"id":"x"}]]}',
      code: ISSUE_CODES.MISPLACED_PRIMITIVE_EXTENSION,
    },
    // a `_`-sibling on a non-primitive array
    {
      doc: '{"resourceType":"Patient","name":[{"family":"Roe"}],"_name":[[{"id":"x"}]]}',
      code: ISSUE_CODES.MISPLACED_PRIMITIVE_EXTENSION,
    },
    // a member of a `_`-sibling object that is neither an `id` STRING nor an `extension` array
    // (an `id` whose value is not a string is discarded the same way)
    {
      doc: '{"resourceType":"Patient","birthDate":"1980-01-01","_birthDate":{"foo":[["x"]]}}',
      code: ISSUE_CODES.UNKNOWN_PROPERTY,
    },
    {
      doc: '{"resourceType":"Patient","birthDate":"1980-01-01","_birthDate":{"id":[["x"]]}}',
      code: ISSUE_CODES.UNKNOWN_PROPERTY,
    },
    {
      doc: '{"resourceType":"Patient","birthDate":"1980-01-01","_birthDate":{"extension":{"0":[["x"]]}}}',
      code: ISSUE_CODES.UNKNOWN_PROPERTY,
    },
  ];

  it("flags the discarded sibling but does not refuse the document", () => {
    for (const { doc, code } of uncovered) {
      const { resource, issues } = parseResource(doc);
      expect(nestedArrays(resource, "Patient")).toEqual([]);
      expect(readSafety(resource).safeToSummarize).toBe(true);
      // Not silent: the discarded `_`-sibling itself is reported, as it was before this rule.
      // EXACT, not `toContain`: the public surface says the misplaced-sibling members draw
      // `MISPLACED_PRIMITIVE_EXTENSION` "and nothing besides", so a second code appearing here
      // would falsify that sentence rather than merely add noise.
      expect(issues.map((i) => i.code)).toEqual([code]);
    }
  });
});

describe("the finding survives a write and a re-read, on every channel", () => {
  const docs = [
    '{"resourceType":"Patient","name":[[{"family":"Roe"}]]}',
    '{"resourceType":"Patient","_birthDate":[[{"id":"x"}]]}',
    '{"resourceType":"Patient","birthDate":"1980-01-01","_birthDate":{"extension":[[{"url":"http://example.org/x"}]]}}',
    '{"resourceType":"Observation","status":[["final"]]}',
    '{"resourceType":"Patient","name":[{"given":["A","B"],"_given":[null,[{"id":"x"}]]}]}',
  ];

  it("writes the sender's bytes back, so the re-read reproduces the refusal", () => {
    // Before this the writer emitted an empty element and the complaint vanished on the round trip.
    // A safety finding that a re-serialization launders away is worse than one that was never made,
    // because a pipeline that stores what it wrote keeps neither the content nor the warning.
    for (const doc of docs) {
      const { resource } = parseResource(doc);
      expect(readSafety(resource).safeToSummarize).toBe(false);
      const written = serializeResource(resource);
      expect(written).toBe(doc);
      const again = parseResource(written);
      expect(readSafety(again.resource).safeToSummarize).toBe(false);
      expect(again.issues.map((i) => i.code)).toContain(ISSUE_CODES.NESTED_ARRAY);
      expect(validateResource(again.resource).valid).toBe(false);
      // and it is stable: writing the re-read model produces the same bytes again.
      expect(serializeResource(again.resource)).toBe(written);
    }
  });

  it("does not launder it on the read itself, which is where a consumer sees it", () => {
    const { issues } = parseResource('{"resourceType":"Patient","name":[[{"family":"Roe"}]]}');
    expect(issues.map((i) => i.code)).toContain(ISSUE_CODES.NESTED_ARRAY);
  });

  it("never emits the empty element the model holds at that position", () => {
    for (const doc of docs) {
      expect(serializeResource(parseResource(doc).resource)).not.toContain("[{}]");
    }
  });

  it("writes back a resourceType it cannot hoist, rather than dropping the property", () => {
    // Hoisting `resourceType` to the front is the one canonical-ordering rule the writer applies. It
    // used to skip the property whenever it could not hoist it, which dropped whatever the sender
    // had written there: the loudest possible position to lose content from, and the one shape whose
    // finding still laundered away on a re-read after the rest of this was fixed.
    const doc = '{"resourceType":[["Patient"]],"id":"x"}';
    const { resource } = parseResource(doc);
    expect(serializeResource(resource)).toBe(doc);
    expect(parseResource(serializeResource(resource)).issues.map((i) => i.code)).toContain(
      ISSUE_CODES.NESTED_ARRAY,
    );
    // An array-wrapped one is not a nested array at all, and was dropped by the same branch.
    expect(serializeResource(parseResource('{"resourceType":["Patient"],"id":"x"}').resource)).toBe(
      '{"resourceType":["Patient"],"id":"x"}',
    );
    // A conformant resourceType is still hoisted to the front, unchanged.
    expect(serializeResource(parseResource('{"id":"x","resourceType":"Patient"}').resource)).toBe(
      '{"resourceType":"Patient","id":"x"}',
    );
  });
});

describe("the writer's output is bounded, and the bound is pinned not prose", () => {
  it("is deliberately not spec-clean for the two shapes FHIR cannot express", () => {
    // The writer authors no value of its own, which is a different promise from always emitting
    // conformant FHIR. For these two it hands back what arrived, because repairing either means
    // inventing content or dropping it. Stated on `serializeResource` and in the README, and pinned
    // here so the claim and the behaviour cannot drift apart.
    expect(
      serializeResource(parseResource('{"resourceType":"Patient","name":[[{}]]}').resource),
    ).toBe('{"resourceType":"Patient","name":[[{}]]}');
    expect(serializeResource(parseResource('{"id":"x","resourceType":["Patient"]}').resource)).toBe(
      '{"id":"x","resourceType":["Patient"]}',
    );
  });

  it("does not hoist a resourceType that is not a string, so it is not always first", () => {
    // Hoisting is the one canonical-ordering rule, and it applies to the shape FHIR defines. A
    // `resourceType` of any other shape goes through the ordinary path and keeps its position: the
    // alternative was dropping it, which is what this replaced.
    const out = serializeResource(parseResource('{"id":"x","resourceType":["Patient"]}').resource);
    expect(out.startsWith('{"resourceType"')).toBe(false);
    expect(out).toContain('"resourceType":["Patient"]');
    // A string one is still hoisted, from wherever it sat.
    expect(serializeResource(parseResource('{"id":"x","resourceType":"Patient"}').resource)).toBe(
      '{"resourceType":"Patient","id":"x"}',
    );
  });

  it("preserves the array's values exactly, not its bytes", () => {
    // The text is the array re-rendered compactly: member order, repeated keys and every number's
    // exact source survive, insignificant whitespace does not, and strings are re-escaped the way
    // this library escapes every other string it emits. Value-exact, not byte-exact.
    const spaced = '{"resourceType":"Patient","name":[ [ {"family":"Ro\\u0065"} ] ]}';
    const content = nestedArrayContent(itemAt(parseResource(spaced).resource, "name", 0));
    expect(nth(content, 0).json).toBe('[{"family":"Roe"}]');
    // A decimal keeps its exact lexical source, which is the one thing that must never normalize.
    const dec = '{"resourceType":"Observation","note":[[{"a":1.2300,"b":1e-3}]]}';
    expect(nth(nestedArrayContent(itemAt(parseResource(dec).resource, "note", 0)), 0).json).toBe(
      '[{"a":1.2300,"b":1e-3}]',
    );
  });
});

/**
 * THE NEIGHBOURING SHAPE: A SCALAR OR `null` WHERE FHIR JSON HAS AN OBJECT.
 *
 * One branch over from the array-inside-an-array, and the same remedy, for a sharper reason. The
 * reader has no element to build from a scalar at a complex position either, so it produces the same
 * empty element and raises `UNKNOWN_PROPERTY`. What made this the worse of the two is what the
 * writer then did with it: an empty element emits as `{}`, `{}` is a **conformant** empty element,
 * and so the warning was gone the moment the output was read back. The writer presented an object as
 * read at a position nothing was read at. That is a value the writer authored, which is the one
 * thing the conservative half of Postel's Law may never do.
 *
 * The remedy is the one the array shape already uses, and it is deliberately NOT to model the scalar
 * as a primitive: that would make it visible to every walker at a position walkers read as a complex
 * element, which is a redefinition of the model. The text hangs off the node instead
 * (`FhirComplex.nonObjectSource`), where only the writer reads it.
 */
describe("a scalar where an object belongs is handed back, not replaced with an object", () => {
  /** Every non-object, non-array shape that reaches the complex-item branch of the reader. */
  const SCALARS = [
    { label: "a string", written: '"James"' },
    { label: "a number", written: "42" },
    { label: "a decimal", written: "1.2300" },
    { label: "a boolean", written: "true" },
    { label: "null", written: "null" },
  ];

  it.each(SCALARS)("writes $label back exactly as the sender wrote it", ({ written }) => {
    const doc = `{"resourceType":"Patient","name":[{"family":"Roe"},${written}]}`;
    // Byte-identical: the value is handed back, not re-authored.
    expect(serializeResource(parseResource(doc).resource)).toBe(doc);
  });

  it.each(SCALARS)("reproduces the $label finding across a round trip", ({ written }) => {
    const doc = `{"resourceType":"Patient","name":[{"family":"Roe"},${written}]}`;
    const first = parseResource(doc).issues;
    expect(first.map((i) => `${i.code}@${i.expression}`)).toEqual([
      "UNKNOWN_PROPERTY@Patient.name[1]",
    ]);
    // The whole point: the second read says what the first read said. Before this, it said nothing,
    // because `{}` is a conformant empty element and there was nothing left to report.
    const again = parseResource(serializeResource(parseResource(doc).resource)).issues;
    expect(again).toEqual(first);
  });

  it("does not touch a genuinely empty object, which stays `{}` and stays silent", () => {
    // The distinction is the whole risk of the change: an object the sender really wrote empty must
    // not acquire a finding, and must not become anything else on the way out.
    const doc = '{"resourceType":"Patient","name":[{}]}';
    expect(parseResource(doc).issues).toEqual([]);
    expect(serializeResource(parseResource(doc).resource)).toBe(doc);
  });

  it("keeps the scalar OUT of the tree: the node is still the empty element", () => {
    // Preservation is not modeling. A consumer walking `name` sees a complex with no properties at
    // `[1]`, exactly as before, so no walker, safety rule or validator can read the scalar as a
    // value. Only the writer can reach it.
    const { resource } = parseResource(
      '{"resourceType":"Patient","name":[{"family":"Roe"},"James"]}',
    );
    const name = req(getProperty(resource, "name"));
    const item = isList(name) ? nth(name.items, 1) : undefined;
    expect(item !== undefined && isComplex(item) && item.properties).toEqual([]);
    // Not a nested array either: this shape carries no `NESTED_ARRAY` and no marker.
    expect(item !== undefined && isNestedArray(item)).toBe(false);
    expect(nestedArrays(resource, "Patient")).toEqual([]);
    expect(item !== undefined && nestedArrayContent(item)).toEqual([]);
  });

  it("reaches the `_`-sibling's extension items too, which is the reader's other call site", () => {
    const doc = '{"resourceType":"Patient","name":["Roe"],"_name":[{"extension":["x"]}]}';
    const { resource, issues } = parseResource(doc);
    expect(issues.map((i) => i.code)).toContain(ISSUE_CODES.UNKNOWN_PROPERTY);
    expect(serializeResource(resource)).toBe(doc);
  });

  it("distinguishes two documents that wrote DIFFERENT scalars at one position", () => {
    // Cross-format equivalence compares the preserved text, so the oracle cannot call two documents
    // the same over content neither could place. Without that arm both are the empty element.
    const a = parseResource(
      '{"resourceType":"Patient","name":[{"family":"Roe"},"James"]}',
    ).resource;
    const b = parseResource(
      '{"resourceType":"Patient","name":[{"family":"Roe"},"Peter"]}',
    ).resource;
    expect(nodesEquivalent(a, b)).toBe(false);
    // And neither is equivalent to the document that really wrote an empty object there.
    const empty = parseResource('{"resourceType":"Patient","name":[{"family":"Roe"},{}]}').resource;
    expect(nodesEquivalent(a, empty)).toBe(false);
  });

  it("still hands back the array beside it, so BOTH findings survive the round trip", () => {
    // The shape the two branches meet at, and the one the residual was filed under: `["Peter"]`
    // makes the array read as a list of complex elements, so `"James"` lands where an object was
    // expected. Both positions now write back what the sender wrote.
    const doc = '{"resourceType":"Patient","name":[{"given":[["Peter"],"James"]}]}';
    const { resource } = parseResource(doc);
    expect(serializeResource(resource)).toBe(doc);
    expect(parseResource(serializeResource(resource)).issues.map((i) => i.code)).toEqual([
      ISSUE_CODES.UNKNOWN_PROPERTY,
      ISSUE_CODES.NESTED_ARRAY,
      ISSUE_CODES.UNKNOWN_PROPERTY,
    ]);
    // Unchanged: the nested array still refuses the affirmative verdict.
    expect(readSafety(resource).safeToSummarize).toBe(false);
    expect(validateResource(resource).valid).toBe(false);
  });
});

describe("what preservation does NOT reach, pinned rather than claimed away", () => {
  it("is not carried by the XML writer either, which now refuses instead of emitting the empty element", () => {
    // The preserved text still does not reach `serializeResourceXml`: XML has no array of arrays and
    // no object-position scalar, so there is nothing to hand it back into. What changed is what the
    // writer does about that. It used to emit the empty element the reader was left holding, and the
    // finding was gone on the next read; it now refuses, so the JSON route stays the one that
    // carries the shape. The bytes it used to emit are asserted here, through the re-read, so the
    // laundering this closes is recorded rather than described.
    /** The `FhirSerializeError` the XML writer raises for `node`, or `undefined`. */
    const errorFrom = (node: FhirComplex): FhirSerializeError | undefined => {
      try {
        serializeResourceXml(node);
      } catch (error) {
        return error instanceof FhirSerializeError ? error : undefined;
      }
      return undefined;
    };

    const scalar = parseResource(
      '{"resourceType":"Patient","name":[{"family":"Roe"},"James"]}',
    ).resource;
    expect(() => serializeResourceXml(scalar)).toThrow(FhirSerializeError);
    expect(errorFrom(scalar)).toMatchObject({
      code: SERIALIZE_ERROR_CODES.UNSERIALIZABLE_JSON_ONLY_SHAPE,
      locations: ["Patient.name[1]"],
    });
    // What base emitted, and what re-reading it gave back: an empty element and an empty issue list.
    expect(
      parseResourceXml(
        '<Patient xmlns="http://hl7.org/fhir"><name><family value="Roe"/></name><name/></Patient>',
      ).issues,
    ).toEqual([]);

    const nested = parseResource('{"resourceType":"Patient","name":[[{"family":"Roe"}]]}').resource;
    expect(readSafety(nested).safeToSummarize).toBe(false);
    expect(errorFrom(nested)).toMatchObject({
      code: SERIALIZE_ERROR_CODES.UNSERIALIZABLE_JSON_ONLY_SHAPE,
      locations: ["Patient.name[0]"],
    });
    // Base emitted `<Patient><name/></Patient>`, which re-reads with no finding at all and turns the
    // refusal to summarize into an affirmation. That is the whole of the harm, in two assertions.
    const wasEmitted = parseResourceXml('<Patient xmlns="http://hl7.org/fhir"><name/></Patient>');
    expect(wasEmitted.issues).toEqual([]);
    expect(readSafety(wasEmitted.resource).safeToSummarize).toBe(true);

    // The JSON route is untouched and still carries both shapes back byte-identically.
    expect(serializeResource(scalar)).toBe(
      '{"resourceType":"Patient","name":[{"family":"Roe"},"James"]}',
    );
    expect(serializeResource(nested)).toBe(
      '{"resourceType":"Patient","name":[[{"family":"Roe"}]]}',
    );
  });

  it("still discards a `_`-sibling it drops whole, so an array inside one draws no refusal", () => {
    // Unchanged from before this: there is no node at those positions to carry either the marker or
    // the text, and creating one is a separate read-path change. The five shapes are pinned below in
    // "the one channel the rule does not reach".
    const { resource } = parseResource(
      '{"resourceType":"Patient","name":[{"family":"Roe"}],"_name":[[{"id":"x"}]]}',
    );
    expect(nestedArrays(resource, "Patient")).toEqual([]);
    expect(readSafety(resource).safeToSummarize).toBe(true);
  });
});
