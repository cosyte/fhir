import { describe, expect, it } from "vitest";

import {
  assertSafeToSummarize,
  codingsOf,
  evaluateInvariant,
  FhirSafetyError,
  getProperty,
  isComplex,
  isList,
  isNestedArray,
  isPrimitive,
  ISSUE_CODES,
  nestedArray,
  nestedArrays,
  nodesEquivalent,
  parseResource,
  parseResourceXml,
  pathExists,
  primitive,
  complex,
  readSafety,
  resolvePath,
  serializeResource,
  validateResource,
  type FhirNode,
} from "../src/index.js";
import { nth, req } from "./_util.js";

/**
 * An array inside an array is a shape FHIR JSON gives no meaning at any position: json.html §2.6.2.2
 * uses an array for a repeating element and for nothing else, so no element is ever a list of lists.
 * The reader does not model the inner array, so content the sender wrote is genuinely unreadable at
 * that position, and this suite is about the consequence of that rather than a cure for it.
 *
 * Two halves, and the split is the whole point.
 *
 * 1. **Refuse to affirm.** A document carrying one must never come back `valid: true` /
 *    `safeToSummarize: true` / `negations: []`, because the model then looks exactly like an element
 *    the sender legitimately left out. Reporting is the entire remedy here.
 * 2. **Preserve nothing.** The inner array stays unread, unmodeled, and invisible to every walker. A
 *    list still holds one item per position it held before, of the same kinds, with the same
 *    contents. Making the value readable would redefine what a repeating element *contains* for
 *    every consumer in the package, which is a far larger and riskier change than declining to
 *    affirm, and the negative assertions in "the model is unchanged" below are what hold that line.
 */

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
    const { nestedArray: _drop, ...rest } = node;
    return rest.extension === undefined
      ? rest
      : { ...rest, extension: rest.extension.map((e) => stripMarker(e) as typeof e) };
  }
  const { nestedArray: _drop, ...rest } = node;
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

describe("the model is unchanged: nothing is preserved and nothing new is readable", () => {
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

  it("round-trips the model to the same JSON it produced before the marker existed", () => {
    // The writer is untouched: it emits the empty element the model holds. A consumer's bytes do not
    // change because of this rule. (See the laundering note below for what that costs.)
    const { resource } = parseResource(NESTED);
    expect(serializeResource(resource)).toBe('{"resourceType":"Patient","name":[{}]}');
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
    expect(
      nodesEquivalent(
        nested.resource,
        parseResource('{"resourceType":"Patient","name":[[{"family":"Doe"}]]}').resource,
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

  it("still differs one level INSIDE an extension, which is a known residual", () => {
    // The reader's FHIRPath override applies to the extension item itself. Deeper inside that item
    // the older `_`-prefixed convention is back on the path, so the two channels name the same
    // position with two different strings. Both are correct locations and neither is missing, so
    // this is a correlation nuisance rather than a lost finding, and the durable fix is one path
    // convention for the whole reader rather than a deeper override. Pinned so it is not mistaken
    // for agreement.
    const { resource, issues } = parseResource(
      '{"resourceType":"Patient","birthDate":"1980-01-01","_birthDate":{"extension":[{"url":[["u"]]}]}}',
    );
    const fromRead = issues
      .filter((i) => i.code === ISSUE_CODES.NESTED_ARRAY)
      .map((i) => i.expression);
    expect(fromRead).toEqual(["Patient.birthDate._extension[0].url[0]"]);
    expect(nestedArrays(resource, "Patient")).toEqual(["Patient.birthDate.extension[0].url[0]"]);
    // What matters is that neither channel is silent and the document is refused.
    expect(readSafety(resource).safeToSummarize).toBe(false);
    expect(validateResource(resource).valid).toBe(false);
  });
});

describe("the one channel the rule does not reach, pinned rather than claimed away", () => {
  // The rule is bounded by what the reader modeled. A `_`-sibling the reader discards WHOLE, because
  // it is misplaced or unrecognised, leaves no node to mark, so an array inside one is flagged as an
  // unexpected property and is not refused. Reaching it means reading raw JSON the codec does not
  // model, which is the preserving problem, not the reporting one. This behaviour is unchanged from
  // before the rule existed; it is pinned so that the claim on the public surface stays true and so
  // that closing it later is a deliberate act.
  const uncovered = [
    // a `_`-sibling on an object element
    '{"resourceType":"Patient","name":{"family":"Roe"},"_name":[[{"id":"x"}]]}',
    // a `_`-sibling on a non-primitive array
    '{"resourceType":"Patient","name":[{"family":"Roe"}],"_name":[[{"id":"x"}]]}',
    // a member of a `_`-sibling object that is neither an `id` STRING nor an `extension` array
    // (an `id` whose value is not a string is discarded the same way)
    '{"resourceType":"Patient","birthDate":"1980-01-01","_birthDate":{"foo":[["x"]]}}',
    '{"resourceType":"Patient","birthDate":"1980-01-01","_birthDate":{"id":[["x"]]}}',
    '{"resourceType":"Patient","birthDate":"1980-01-01","_birthDate":{"extension":{"0":[["x"]]}}}',
  ];

  it("flags the discarded sibling but does not refuse the document", () => {
    for (const doc of uncovered) {
      const { resource, issues } = parseResource(doc);
      expect(nestedArrays(resource, "Patient")).toEqual([]);
      expect(readSafety(resource).safeToSummarize).toBe(true);
      // Not silent: the discarded `_`-sibling itself is reported, as it was before this rule.
      expect(issues.map((i) => i.code)).toContain(ISSUE_CODES.UNKNOWN_PROPERTY);
    }
  });
});

describe("known limitation, pinned so a change to it is deliberate", () => {
  it("launders the finding on a write and re-read, because the writer emits an empty element", () => {
    // The reader cannot model the inner array, so the writer has nothing to write back and emits the
    // empty element the model holds. Reading that emits a clean document: the complaint does not
    // survive a round trip. Fixing this means changing what the model holds, which is the preserving
    // half of the problem and a much larger change. Pinned rather than described, so that a future
    // writer change has to face it.
    const { resource } = parseResource('{"resourceType":"Patient","name":[[{"family":"Roe"}]]}');
    expect(readSafety(resource).safeToSummarize).toBe(false);
    const again = parseResource(serializeResource(resource));
    expect(readSafety(again.resource).safeToSummarize).toBe(true);
    expect(again.issues).toEqual([]);
  });

  it("does not launder it on the read itself, which is where a consumer sees it", () => {
    const { issues } = parseResource('{"resourceType":"Patient","name":[[{"family":"Roe"}]]}');
    expect(issues.map((i) => i.code)).toContain(ISSUE_CODES.NESTED_ARRAY);
  });
});
