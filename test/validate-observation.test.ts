/**
 * The built-in `Observation` element table, exercised through `validateResource`.
 *
 * The generic checks this file grades already existed and were already proven on `Patient`;
 * registering a second type is what turns them on for it. So the question here is never "does the
 * validator check cardinality" but "is the TABLE right": an element R4 4.0.1 defines that the table
 * omits becomes a false unknown-element finding on a conformant document, and a cardinality invented
 * rather than read becomes a false error on a lab result. Every row is therefore asserted against the
 * published element table rather than against the code that consumes it, and the sweep below walks
 * every direct element name and every choice variant, not a sample of them.
 *
 * The fixtures are synthetic throughout: coded values, reserved example hosts and reference strings
 * that name a resource type and a coined id. No person name, date of birth, address or contact
 * value appears anywhere in this file, deliberately, because a diagnostic emitted for one of these
 * documents is the leak vector the redaction tier sweeps.
 */

import { describe, expect, it } from "vitest";

import {
  baseSchema,
  buildRegistry,
  parseResource,
  validateResource,
  type ValidationCode,
  type ValidationIssue,
} from "../src/index.js";

/** Parse then validate, the common path. */
function check(
  json: string,
  options?: Parameters<typeof validateResource>[1],
): ReturnType<typeof validateResource> {
  return validateResource(parseResource(json).resource, options);
}

/** The set of codes present in a result, for order-independent assertions. */
function codes(result: ReturnType<typeof validateResource>): ValidationCode[] {
  return result.issues.map((issue) => issue.code);
}

/** Every finding located exactly at `expression`. */
function at(result: ReturnType<typeof validateResource>, expression: string): ValidationIssue[] {
  return result.issues.filter((issue) => issue.expression === expression);
}

/** A conformant minimal Observation: the two mandatory direct elements and nothing else. */
const CODE = '{"coding":[{"system":"http://loinc.org","code":"718-7"}]}';
const MINIMAL = `{"resourceType":"Observation","status":"final","code":${CODE}}`;

/**
 * An Observation carrying `name` beside the two mandatory elements, or REPLACING one of them when
 * the name is `status` or `code`. Composed rather than concatenated on purpose: writing the property
 * twice would draw a DUPLICATE_PROPERTY finding, and a test that grades a binding must not be
 * grading the shadowed-member rule by accident.
 */
function withElement(name: string, value: string): string {
  const properties = [
    '"resourceType":"Observation"',
    name === "status" ? undefined : '"status":"final"',
    name === "code" ? undefined : `"code":${CODE}`,
    `${JSON.stringify(name)}:${value}`,
  ].filter((property): property is string => property !== undefined);
  return `{${properties.join(",")}}`;
}

/**
 * The eight `ObservationStatus` codes, in the order the R4 4.0.1 expansion lists them
 * (valueset-observation-status.html, "This value set contains 8 concepts").
 */
const OBSERVATION_STATUS = [
  "registered",
  "preliminary",
  "final",
  "amended",
  "corrected",
  "cancelled",
  "entered-in-error",
  "unknown",
] as const;

/**
 * The twenty-four DIRECT elements of `Observation` in R4 4.0.1 (observation.html). Base `Resource` /
 * `DomainResource` elements are merged in by the registry and are not part of this list. A choice is
 * keyed by its base name, which is how the schema records it.
 */
const R4_DIRECT_ELEMENTS = [
  "identifier",
  "basedOn",
  "partOf",
  "status",
  "category",
  "code",
  "subject",
  "focus",
  "encounter",
  "effective",
  "issued",
  "performer",
  "value",
  "dataAbsentReason",
  "interpretation",
  "note",
  "bodySite",
  "method",
  "specimen",
  "device",
  "referenceRange",
  "hasMember",
  "derivedFrom",
  "component",
] as const;

/**
 * One shape-correct synthetic occurrence per INSTANCE property name R4 4.0.1 defines on
 * `Observation`: the twenty-two plain elements plus every variant of the two choices (four for
 * `effective[x]`, eleven for `value[x]`), thirty-seven in all.
 */
const ELEMENT_SAMPLES: readonly (readonly [string, string])[] = [
  ["identifier", '[{"system":"http://example.org/obs-ids"}]'],
  ["basedOn", '[{"reference":"ServiceRequest/synthetic-1"}]'],
  ["partOf", '[{"reference":"Procedure/synthetic-1"}]'],
  ["status", '"final"'],
  [
    "category",
    '[{"coding":[{"system":"http://terminology.hl7.org/CodeSystem/observation-category","code":"laboratory"}]}]',
  ],
  ["code", CODE],
  ["subject", '{"reference":"Patient/synthetic-1"}'],
  ["focus", '[{"reference":"Patient/synthetic-1"}]'],
  ["encounter", '{"reference":"Encounter/synthetic-1"}'],
  ["effectiveDateTime", '"2026-01-01T09:00:00Z"'],
  ["effectivePeriod", '{"start":"2026-01-01T09:00:00Z"}'],
  ["effectiveTiming", '{"event":["2026-01-01T09:00:00Z"]}'],
  ["effectiveInstant", '"2026-01-01T09:00:00Z"'],
  ["issued", '"2026-01-01T09:05:00Z"'],
  ["performer", '[{"reference":"Practitioner/synthetic-1"}]'],
  [
    "valueQuantity",
    '{"value":7.2,"unit":"g/dL","system":"http://unitsofmeasure.org","code":"g/dL"}',
  ],
  ["valueCodeableConcept", '{"coding":[{"system":"http://snomed.info/sct","code":"260385009"}]}'],
  ["valueString", '"synthetic result text"'],
  ["valueBoolean", "true"],
  ["valueInteger", "3"],
  ["valueRange", '{"low":{"value":1},"high":{"value":9}}'],
  ["valueRatio", '{"numerator":{"value":1},"denominator":{"value":64}}'],
  ["valueSampledData", '{"origin":{"value":0},"period":1,"dimensions":1,"data":"0 1 2"}'],
  ["valueTime", '"09:00:00"'],
  ["valueDateTime", '"2026-01-01T09:00:00Z"'],
  ["valuePeriod", '{"start":"2026-01-01T09:00:00Z"}'],
  [
    "dataAbsentReason",
    '{"coding":[{"system":"http://terminology.hl7.org/CodeSystem/data-absent-reason","code":"unknown"}]}',
  ],
  [
    "interpretation",
    '[{"coding":[{"system":"http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation","code":"N"}]}]',
  ],
  ["note", '[{"text":"synthetic annotation"}]'],
  ["bodySite", '{"coding":[{"system":"http://snomed.info/sct","code":"368209003"}]}'],
  ["method", '{"coding":[{"system":"http://snomed.info/sct","code":"702659008"}]}'],
  ["specimen", '{"reference":"Specimen/synthetic-1"}'],
  ["device", '{"reference":"Device/synthetic-1"}'],
  ["referenceRange", '[{"low":{"value":70},"high":{"value":99}}]'],
  ["hasMember", '[{"reference":"Observation/synthetic-1"}]'],
  ["derivedFrom", '[{"reference":"Observation/synthetic-2"}]'],
  ["component", '[{"code":{"text":"synthetic component"},"valueString":"synthetic"}]'],
];

// -- The table itself -----------------------------------------------------------------------------

describe("the built-in Observation element table", () => {
  it("registers Observation with exactly the twenty-four R4 4.0.1 direct elements", () => {
    const schema = buildRegistry()("Observation");
    expect(schema, "Observation is not registered in the built-in schema set").toBeDefined();
    const base = new Set(Object.keys(baseSchema("Observation").elements));
    const direct = Object.keys(schema?.elements ?? {})
      .filter((name) => !base.has(name))
      .sort();
    expect(direct).toEqual([...R4_DIRECT_ELEMENTS].sort());
  });

  it("makes status and code the only two mandatory direct elements", () => {
    const elements = buildRegistry()("Observation")?.elements ?? {};
    const mandatory = Object.entries(elements)
      .filter(([, element]) => element.min >= 1)
      .map(([name]) => name)
      .sort();
    expect(mandatory).toEqual(["code", "status"]);
  });

  it("binds status at required strength over the eight-code value set, and binds nothing else", () => {
    const elements = buildRegistry()("Observation")?.elements ?? {};
    expect(elements["status"]?.binding).toEqual({
      strength: "required",
      codes: [...OBSERVATION_STATUS],
    });
    const bound = Object.entries(elements)
      .filter(([, element]) => element.binding !== undefined)
      .map(([name]) => name);
    expect(bound, "only the required-strength binding belongs in this layer").toEqual(["status"]);
  });

  it("declares value[x] over eleven variants and effective[x] over four", () => {
    const elements = buildRegistry()("Observation")?.elements ?? {};
    expect(elements["value"]?.types).toEqual([
      "Quantity",
      "CodeableConcept",
      "string",
      "boolean",
      "integer",
      "Range",
      "Ratio",
      "SampledData",
      "time",
      "dateTime",
      "Period",
    ]);
    expect(elements["effective"]?.types).toEqual(["dateTime", "Period", "Timing", "instant"]);
  });
});

// -- AC1: the type is checked, and no longer reported as unmodeled -------------------------------

describe("validateResource: an Observation is checked against its own elements", () => {
  it("emits no RESOURCE_NOT_MODELED and nothing else for a conformant minimal document", () => {
    const result = check(MINIMAL);
    expect(codes(result)).not.toContain("RESOURCE_NOT_MODELED");
    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("checks the type's own elements: a bad instant on issued is a value-domain finding", () => {
    const result = check(withElement("issued", '"2026-13-45T99:00:00Z"'));
    expect(codes(result)).toEqual(["PRIMITIVE_INVALID"]);
    expect(result.issues[0]?.expression).toBe("Observation.issued");
    expect(result.valid).toBe(false);
  });

  it("checks the type's own cardinality: a repeated 0..1 element is a max violation", () => {
    const result = check(withElement("issued", '["2026-01-01T09:00:00Z","2026-01-02T09:00:00Z"]'));
    expect(codes(result)).toContain("CARDINALITY_MAX");
    expect(at(result, "Observation.issued")[0]?.code).toBe("CARDINALITY_MAX");
  });

  it("still emits no RESOURCE_NOT_MODELED for an Observation that is otherwise wrong", () => {
    const result = check('{"resourceType":"Observation","status":"nonesuch"}');
    expect(codes(result)).not.toContain("RESOURCE_NOT_MODELED");
  });
});

// -- AC2 + AC5: the required-strength ObservationStatus binding ----------------------------------

describe("validateResource: the required ObservationStatus binding on Observation.status", () => {
  it("errors on a code outside the eight-code set, with no terminology service supplied", () => {
    const result = check(withElement("status", '"complete"'));
    expect(codes(result)).toEqual(["CODE_INVALID"]);
    const issue = result.issues[0];
    expect(issue?.expression).toBe("Observation.status");
    expect(issue?.severity).toBe("error");
    expect(issue?.type).toBe("code-invalid");
    expect(result.valid).toBe(false);
  });

  it("errors on a near miss of a member code, which is what a hand-rolled feed writes", () => {
    for (const nearMiss of ["Final", "entered_in_error", "in-progress", "finals", "FINAL"]) {
      const result = check(withElement("status", JSON.stringify(nearMiss)));
      expect(codes(result), `"${nearMiss}" was accepted`).toContain("CODE_INVALID");
      expect(at(result, "Observation.status")[0]?.severity).toBe("error");
    }
  });

  it("errors on a status that is not even a lexical code, through the value-domain arm", () => {
    // A trailing space or an empty string fails the `code` datatype pattern before membership is a
    // question, so the layer reports the lexical fault rather than a binding verdict on a value it
    // could not read as a code. Still an error at the status path, which is what matters.
    for (const malformed of ["final ", "", " ", " final"]) {
      const result = check(withElement("status", JSON.stringify(malformed)));
      const status = at(result, "Observation.status");
      expect(
        status.map((issue) => issue.code),
        JSON.stringify(malformed),
      ).toEqual(["PRIMITIVE_INVALID"]);
      expect(status[0]?.severity).toBe("error");
      expect(result.valid).toBe(false);
    }
  });

  it("errors the same way in strict mode: the binding is not a mode-sensitive rule", () => {
    const result = check(withElement("status", '"complete"'), { mode: "strict" });
    expect(codes(result)).toEqual(["CODE_INVALID"]);
    expect(result.issues[0]?.severity).toBe("error");
  });

  it("accepts each of the eight codes with no error or warning at the status path", () => {
    for (const status of OBSERVATION_STATUS) {
      const result = check(withElement("status", JSON.stringify(status)));
      const bad = at(result, "Observation.status").filter(
        (issue) => issue.severity === "error" || issue.severity === "warning",
      );
      expect(bad, `${status} drew a finding at Observation.status`).toEqual([]);
    }
  });

  it("sweeps all eight without inventing a finding anywhere else in the document", () => {
    for (const status of OBSERVATION_STATUS) {
      const result = check(withElement("status", JSON.stringify(status)));
      // `entered-in-error` is a retraction: information, surfaced by the always-on safety layer and
      // never withdrawn by this change. Nothing else may appear for an otherwise minimal document.
      const expected: ValidationCode[] =
        status === "entered-in-error" ? ["RETRACTED_RESOURCE"] : [];
      expect(codes(result), `${status} drew an unexpected finding`).toEqual(expected);
      expect(result.valid).toBe(true);
    }
  });
});

// -- AC3: choice exclusivity across the eleven value[x] variants ---------------------------------

/** The eleven `value[x]` instance property names, paired with a shape-correct synthetic value. */
const VALUE_VARIANTS: readonly (readonly [string, string])[] = ELEMENT_SAMPLES.filter(([name]) =>
  name.startsWith("value"),
);

describe("validateResource: choice exclusivity on Observation.value[x]", () => {
  it("covers all eleven variants", () => {
    expect(VALUE_VARIANTS.length).toBe(11);
  });

  it("accepts each variant on its own", () => {
    for (const [name, value] of VALUE_VARIANTS) {
      const result = check(withElement(name, value));
      expect(codes(result), `${name} alone drew a finding`).toEqual([]);
    }
  });

  it("errors once when two variants are present, at the [x] path", () => {
    const json =
      `{"resourceType":"Observation","status":"final","code":${CODE},` +
      '"valueString":"synthetic","valueInteger":3}';
    const result = check(json);
    expect(codes(result)).toEqual(["CHOICE_AMBIGUOUS"]);
    expect(result.issues[0]?.expression).toBe("Observation.value[x]");
    expect(result.issues[0]?.severity).toBe("error");
    expect(result.valid).toBe(false);
  });

  it("errors for every pairing of the eleven, never as a spurious cardinality-max", () => {
    for (const [firstName, firstValue] of VALUE_VARIANTS) {
      for (const [secondName, secondValue] of VALUE_VARIANTS) {
        if (firstName === secondName) continue;
        const json =
          `{"resourceType":"Observation","status":"final","code":${CODE},` +
          `${JSON.stringify(firstName)}:${firstValue},${JSON.stringify(secondName)}:${secondValue}}`;
        const result = check(json);
        const ambiguous = result.issues.filter((issue) => issue.code === "CHOICE_AMBIGUOUS");
        expect(ambiguous.length, `${firstName} + ${secondName}`).toBe(1);
        expect(ambiguous[0]?.expression).toBe("Observation.value[x]");
        expect(codes(result), `${firstName} + ${secondName}`).not.toContain("CARDINALITY_MAX");
      }
    }
  });

  it("errors when all eleven are present at once, still exactly once", () => {
    const all = VALUE_VARIANTS.map(([name, value]) => `${JSON.stringify(name)}:${value}`).join(",");
    const result = check(`{"resourceType":"Observation","status":"final","code":${CODE},${all}}`);
    expect(result.issues.filter((issue) => issue.code === "CHOICE_AMBIGUOUS").length).toBe(1);
  });

  it("applies the same exclusivity to effective[x]", () => {
    const json =
      `{"resourceType":"Observation","status":"final","code":${CODE},` +
      '"effectiveDateTime":"2026-01-01T09:00:00Z","effectivePeriod":{"start":"2026-01-01T09:00:00Z"}}';
    const result = check(json);
    expect(codes(result)).toEqual(["CHOICE_AMBIGUOUS"]);
    expect(result.issues[0]?.expression).toBe("Observation.effective[x]");
  });
});

// -- AC6 + AC7: unknown-element reporting is scoped to what R4 does not define -------------------

describe("validateResource: unknown-element reporting on an Observation", () => {
  it("has one sample per instance property name R4 defines: twenty-two plus fifteen variants", () => {
    expect(ELEMENT_SAMPLES.length).toBe(37);
    const bases = new Set(
      ELEMENT_SAMPLES.map(([name]) =>
        name.startsWith("value") ? "value" : name.startsWith("effective") ? "effective" : name,
      ),
    );
    expect([...bases].sort()).toEqual([...R4_DIRECT_ELEMENTS].sort());
  });

  for (const mode of ["lenient", "strict"] as const) {
    it(`emits no unknown-element finding for any R4-defined element in ${mode} mode`, () => {
      for (const [name, value] of ELEMENT_SAMPLES) {
        const result = check(withElement(name, value), { mode });
        expect(codes(result), `${name} was reported unknown`).not.toContain("UNKNOWN_ELEMENT");
      }
    });
  }

  it("emits no unknown-element finding when every R4-defined element is present at once", () => {
    // One variant per choice, so the document is conformant rather than ambiguous.
    const properties = ELEMENT_SAMPLES.filter(
      ([name]) => !name.startsWith("value") || name === "valueString",
    )
      .filter(([name]) => !name.startsWith("effective") || name === "effectiveDateTime")
      .map(([name, value]) => `${JSON.stringify(name)}:${value}`)
      .join(",");
    const json = `{"resourceType":"Observation",${properties}}`;
    for (const mode of ["lenient", "strict"] as const) {
      const result = check(json, { mode });
      expect(codes(result), `unknown element reported in ${mode} mode`).not.toContain(
        "UNKNOWN_ELEMENT",
      );
    }
  });

  it("warns in lenient mode on an element R4 does not define, at that element's path", () => {
    const result = check(withElement("wibble", "1"));
    expect(codes(result)).toEqual(["UNKNOWN_ELEMENT"]);
    expect(result.issues[0]?.severity).toBe("warning");
    expect(result.issues[0]?.expression).toBe("Observation.wibble");
    expect(result.valid).toBe(true);
  });

  it("errors in strict mode on the same element, at the same path", () => {
    const result = check(withElement("wibble", "1"), { mode: "strict" });
    expect(codes(result)).toEqual(["UNKNOWN_ELEMENT"]);
    expect(result.issues[0]?.severity).toBe("error");
    expect(result.issues[0]?.expression).toBe("Observation.wibble");
    expect(result.valid).toBe(false);
  });

  it("reports an R5 element and a mis-spelled variant as unknown, which is the point", () => {
    // `Observation.instantiatesCanonical` is R5; `valueDecimal` is not one of the eleven R4 variants.
    for (const name of ["instantiatesCanonical", "valueDecimal", "bodyStructure"]) {
      const result = check(withElement(name, '"x"'));
      expect(codes(result), `${name} was not reported unknown`).toContain("UNKNOWN_ELEMENT");
      expect(at(result, `Observation.${name}`)[0]?.code).toBe("UNKNOWN_ELEMENT");
    }
  });

  it("leaves the universal base elements unflagged", () => {
    const json =
      `{"resourceType":"Observation","status":"final","code":${CODE},"id":"synthetic-1",` +
      '"meta":{"versionId":"1"},"language":"en","text":{"status":"generated","div":"<div>x</div>"}}';
    const result = check(json, { mode: "strict" });
    expect(codes(result)).not.toContain("UNKNOWN_ELEMENT");
  });
});

// -- AC8: the empty Observation ------------------------------------------------------------------

describe("validateResource: an Observation carrying nothing but its resourceType", () => {
  const result = check('{"resourceType":"Observation"}');

  it("reports exactly the two absent mandatory elements as cardinality findings", () => {
    const cardinality = result.issues
      .filter((issue) => issue.code === "CARDINALITY_MIN")
      .map((issue) => issue.expression)
      .sort();
    expect(cardinality).toEqual(["Observation.code", "Observation.status"]);
    for (const issue of result.issues.filter((i) => i.code === "CARDINALITY_MIN")) {
      expect(issue.severity).toBe("error");
      expect(issue.type).toBe("required");
    }
  });

  it("emits no RESOURCE_NOT_MODELED and no unknown-element finding", () => {
    expect(codes(result)).not.toContain("RESOURCE_NOT_MODELED");
    expect(codes(result)).not.toContain("UNKNOWN_ELEMENT");
  });

  it("emits nothing else at all", () => {
    expect(codes(result)).toEqual(["CARDINALITY_MIN", "CARDINALITY_MIN"]);
    expect(result.valid).toBe(false);
  });
});

// -- AC9: an object where the status primitive belongs -------------------------------------------

describe("validateResource: Observation.status present as an object", () => {
  const json = `{"resourceType":"Observation","status":{"coding":[{"code":"final"}]},"code":${CODE}}`;

  it("does not throw", () => {
    expect(() => check(json)).not.toThrow();
  });

  it("reports it as a datatype mismatch at the status path", () => {
    const result = check(json);
    const status = at(result, "Observation.status");
    expect(status.map((issue) => issue.code)).toEqual(["TYPE_MISMATCH"]);
    expect(status[0]?.severity).toBe("error");
    expect(result.valid).toBe(false);
  });

  it("does not additionally report it as a required-binding violation", () => {
    // The value never became a readable `code`, so a binding verdict on it would be invented.
    expect(codes(check(json))).not.toContain("CODE_INVALID");
    expect(codes(check(json, { mode: "strict" }))).not.toContain("CODE_INVALID");
  });

  it("holds for an empty object and for a list of objects too", () => {
    for (const shape of ["{}", '[{"a":1}]', '{"value":"final"}']) {
      const result = check(`{"resourceType":"Observation","status":${shape},"code":${CODE}}`);
      expect(codes(result), shape).toContain("TYPE_MISMATCH");
      expect(codes(result), shape).not.toContain("CODE_INVALID");
    }
  });
});

// -- AC12: backbone elements are checked for shape only, never entered --------------------------

describe("validateResource: Observation.component and Observation.referenceRange", () => {
  it("reports neither as an unknown element", () => {
    const json =
      `{"resourceType":"Observation","status":"final","code":${CODE},` +
      '"component":[{"code":{"text":"synthetic"},"valueString":"synthetic"}],' +
      '"referenceRange":[{"low":{"value":70},"high":{"value":99}}]}';
    for (const mode of ["lenient", "strict"] as const) {
      expect(codes(check(json, { mode }))).not.toContain("UNKNOWN_ELEMENT");
    }
  });

  it("emits no choice-exclusivity finding for a component holding two value[x] variants", () => {
    // `component.value[x]` is a backbone child and is deliberately unmodeled in this layer: the
    // outer `value[x]` is absent, so a CHOICE_AMBIGUOUS here would be about the inner one.
    const json =
      `{"resourceType":"Observation","status":"final","code":${CODE},` +
      '"component":[{"code":{"text":"synthetic"},"valueString":"synthetic","valueInteger":3}]}';
    for (const mode of ["lenient", "strict"] as const) {
      const result = check(json, { mode });
      expect(codes(result), mode).not.toContain("CHOICE_AMBIGUOUS");
      expect(codes(result), mode).not.toContain("UNKNOWN_ELEMENT");
    }
  });

  it("emits nothing for a member of either backbone that R4 does not define there", () => {
    const json =
      `{"resourceType":"Observation","status":"final","code":${CODE},` +
      '"component":[{"nonesuch":1}],"referenceRange":[{"nonesuch":1,"valueString":"a","valueInteger":2}]}';
    const result = check(json, { mode: "strict" });
    expect(codes(result)).not.toContain("UNKNOWN_ELEMENT");
    expect(codes(result)).not.toContain("CHOICE_AMBIGUOUS");
  });

  it("still enforces the backbone's own node shape: a bare primitive is a mismatch", () => {
    const result = check(withElement("component", '"synthetic"'));
    expect(at(result, "Observation.component")[0]?.code).toBe("TYPE_MISMATCH");
  });
});
