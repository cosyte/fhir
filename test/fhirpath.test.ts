import { describe, expect, it } from "vitest";

import {
  convertToBoolean,
  evaluateInvariant,
  parseFhirPath,
  parseResource,
  tokenize,
  UnsupportedFhirPathError,
  type FhirComplex,
} from "../src/index.js";

function parse(obj: unknown): FhirComplex {
  return parseResource(JSON.stringify(obj)).resource;
}

/** Evaluate an expression against a resource; the focus is the resource itself. */
function evalOn(expression: string, obj: unknown): { unchecked: boolean; satisfied: boolean } {
  const resource = parse(obj);
  return evaluateInvariant(expression, resource, resource);
}

describe("tokenize", () => {
  it("lexes identifiers, calls, strings, and operators", () => {
    expect(tokenize("clinicalStatus.exists()").map((t) => t.value)).toEqual([
      "clinicalStatus",
      ".",
      "exists",
      "(",
      ")",
    ]);
    expect(tokenize("system = 'x' and code != 'y'").map((t) => t.type)).toEqual([
      "identifier",
      "symbol",
      "string",
      "identifier",
      "identifier",
      "symbol",
      "string",
    ]);
  });

  it("lexes environment and special variables and unescapes strings", () => {
    expect(tokenize("%resource")[0]).toEqual({ type: "envvar", value: "resource", pos: 0 });
    expect(tokenize("$this")[0]).toEqual({ type: "special", value: "this", pos: 0 });
    expect(tokenize("'a\\tb\\n'")[0]?.value).toBe("a\tb\n");
    expect(tokenize("'\\u0041'")[0]?.value).toBe("A");
  });

  it("prefers multi-char operators and lexes numbers/decimals", () => {
    expect(tokenize(">= <= != !~").map((t) => t.value)).toEqual([">=", "<=", "!=", "!~"]);
    expect(tokenize("3.14").map((t) => t.value)).toEqual(["3.14"]);
    expect(tokenize("count() > 1").map((t) => t.value)).toEqual(["count", "(", ")", ">", "1"]);
  });

  it("throws on an unrecognised character or bad escape", () => {
    expect(() => tokenize("a @ b")).toThrow(UnsupportedFhirPathError);
    expect(() => tokenize("'\\x'")).toThrow(UnsupportedFhirPathError);
    expect(() => tokenize("'unterminated")).toThrow(UnsupportedFhirPathError);
  });
});

describe("parseFhirPath — precedence", () => {
  it("binds 'and' tighter than 'or', and comparison tighter than 'and'", () => {
    const ast = parseFhirPath("a = 1 and b = 2 or c = 3");
    // → (( a=1 and b=2 ) or c=3 )
    expect(ast.kind).toBe("binary");
    if (ast.kind !== "binary") throw new Error("expected binary");
    expect(ast.op).toBe("or");
    expect(ast.left.kind === "binary" && ast.left.op).toBe("and");
  });

  it("parses invocation chains and function arguments", () => {
    const ast = parseFhirPath("coding.where(system = 'x').exists()");
    expect(ast.kind).toBe("call");
    if (ast.kind !== "call") throw new Error("expected call");
    expect(ast.name).toBe("exists");
  });

  it("throws on a dangling operator or trailing token", () => {
    expect(() => parseFhirPath("and x")).toThrow(UnsupportedFhirPathError);
    expect(() => parseFhirPath("a b")).toThrow(UnsupportedFhirPathError);
    expect(() => parseFhirPath("a.")).toThrow(UnsupportedFhirPathError);
  });
});

describe("convertToBoolean — matches the reference validator's coercion", () => {
  it("treats empty as false and a single non-boolean as true", () => {
    expect(convertToBoolean([])).toBe(false);
    expect(convertToBoolean([{ t: "bool", value: false }])).toBe(false);
    expect(convertToBoolean([{ t: "bool", value: true }])).toBe(true);
    expect(convertToBoolean([{ t: "str", value: "x" }])).toBe(true);
    expect(
      convertToBoolean([
        { t: "num", value: 1 },
        { t: "num", value: 2 },
      ]),
    ).toBe(true);
  });
});

describe("evaluateInvariant — core navigation, existence, logic", () => {
  it("navigates paths and evaluates exists()/empty()", () => {
    const obs = { resourceType: "Observation", status: "final" };
    expect(evalOn("status.exists()", obs).satisfied).toBe(true);
    expect(evalOn("value.empty()", obs).satisfied).toBe(true);
    expect(evalOn("status = 'final'", obs).satisfied).toBe(true);
    expect(evalOn("status = 'preliminary'", obs).satisfied).toBe(false);
  });

  it("navigates a choice element by its base name (value → valueString)", () => {
    const obs = { resourceType: "Observation", valueString: "POSITIVE" };
    expect(evalOn("value.exists()", obs).satisfied).toBe(true);
    expect(evalOn("value.empty()", obs).satisfied).toBe(false);
  });

  it("applies three-valued logic for and/or/implies", () => {
    const r = { resourceType: "Patient", active: true };
    expect(evalOn("active or missing.exists()", r).satisfied).toBe(true);
    expect(evalOn("active implies active", r).satisfied).toBe(true);
    // empty and false semantics: `missing and true` → empty → not satisfied.
    expect(evalOn("missing.first() and active", r).satisfied).toBe(false);
  });

  it("filters with where() and counts", () => {
    const obs = {
      resourceType: "Observation",
      category: [
        { coding: [{ system: "s", code: "vital-signs" }] },
        { coding: [{ system: "s", code: "laboratory" }] },
      ],
    };
    expect(evalOn("category.coding.where(code = 'vital-signs').exists()", obs).satisfied).toBe(
      true,
    );
    expect(evalOn("category.coding.count() = 2", obs).satisfied).toBe(true);
    expect(evalOn("category.coding.where(code = 'nope').empty()", obs).satisfied).toBe(true);
  });

  it("evaluates ele-1 (hasValue or children over id) — passes for a real resource", () => {
    // ele-1: `hasValue() or (children().count() > id.count())`
    const expr = "hasValue() or (children().count() > id.count())";
    expect(evalOn(expr, { resourceType: "Patient", gender: "female" }).satisfied).toBe(true);
    expect(evalOn(expr, { resourceType: "Patient", id: "x" }).unchecked).toBe(false);
  });

  it("passes dom-2/dom-4 style contained checks on a resource with no contained", () => {
    const r = { resourceType: "Patient", gender: "male" };
    expect(evalOn("contained.contained.empty()", r).satisfied).toBe(true);
    expect(evalOn("contained.meta.versionId.empty()", r).satisfied).toBe(true);
  });
});

describe("evaluateInvariant — agrees with the oracle on the named R4 invariants", () => {
  // ait-1: clinicalStatus SHALL be present unless verificationStatus = entered-in-error.
  const ait1 =
    "verificationStatus.coding.where(system = 'http://terminology.hl7.org/CodeSystem/allergyintolerance-verification' and code = 'entered-in-error').exists() or clinicalStatus.exists()";
  // ait-2: clinicalStatus SHALL NOT be present when verificationStatus = entered-in-error.
  const ait2 =
    "verificationStatus.coding.where(system = 'http://terminology.hl7.org/CodeSystem/allergyintolerance-verification' and code = 'entered-in-error').exists().not() or clinicalStatus.exists().not()";

  it("ait-1 holds with a clinicalStatus and fails without one", () => {
    expect(
      evalOn(ait1, {
        resourceType: "AllergyIntolerance",
        clinicalStatus: { coding: [{ code: "active" }] },
      }).satisfied,
    ).toBe(true);
    expect(evalOn(ait1, { resourceType: "AllergyIntolerance" }).satisfied).toBe(false);
  });

  it("ait-2 fails when both entered-in-error and clinicalStatus are present", () => {
    const both = {
      resourceType: "AllergyIntolerance",
      clinicalStatus: { coding: [{ code: "active" }] },
      verificationStatus: {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",
            code: "entered-in-error",
          },
        ],
      },
    };
    expect(evalOn(ait2, both).satisfied).toBe(false);
    expect(
      evalOn(ait2, {
        resourceType: "AllergyIntolerance",
        clinicalStatus: { coding: [{ code: "active" }] },
      }).satisfied,
    ).toBe(true);
  });

  it("obs-6 (dataAbsentReason.empty() or value.empty()) fails when both present", () => {
    const expr = "dataAbsentReason.empty() or value.empty()";
    expect(
      evalOn(expr, {
        resourceType: "Observation",
        valueString: "x",
        dataAbsentReason: { text: "n" },
      }).satisfied,
    ).toBe(false);
    expect(evalOn(expr, { resourceType: "Observation", valueString: "x" }).satisfied).toBe(true);
    expect(
      evalOn(expr, { resourceType: "Observation", dataAbsentReason: { text: "n" } }).satisfied,
    ).toBe(true);
  });

  it("obs-7 (%resource + intersect) flags a component that repeats the observation code", () => {
    const expr =
      "value.empty() or component.code.where(coding.intersect(%resource.code.coding).exists()).empty()";
    const clash = {
      resourceType: "Observation",
      valueQuantity: { value: 1, unit: "mg" },
      code: { coding: [{ system: "http://loinc.org", code: "1234-5" }] },
      component: [{ code: { coding: [{ system: "http://loinc.org", code: "1234-5" }] } }],
    };
    const ok = {
      resourceType: "Observation",
      valueQuantity: { value: 1, unit: "mg" },
      code: { coding: [{ system: "http://loinc.org", code: "1234-5" }] },
      component: [{ code: { coding: [{ system: "http://loinc.org", code: "9999-9" }] } }],
    };
    expect(evalOn(expr, clash).satisfied).toBe(false);
    expect(evalOn(expr, ok).satisfied).toBe(true);
  });

  it("complex equality is order-independent by field name (JSON key order is not significant)", () => {
    // The obs-7 clash, but the component Coding writes {code, system} where the top-level writes
    // {system, code}. FHIR JSON key order is not significant, so this MUST still be a violation — a
    // positional comparison would silently pass a violated constraint (the non-negotiable failure mode).
    const expr =
      "value.empty() or component.code.where(coding.intersect(%resource.code.coding).exists()).empty()";
    const reordered = {
      resourceType: "Observation",
      valueQuantity: { value: 1, unit: "mg" },
      code: { coding: [{ system: "http://loinc.org", code: "1234-5" }] },
      component: [{ code: { coding: [{ code: "1234-5", system: "http://loinc.org" }] } }],
    };
    expect(evalOn(expr, reordered).satisfied).toBe(false);
    // And direct equality of two reordered Codings is true.
    const obs = {
      resourceType: "Observation",
      code: { coding: [{ system: "s", code: "c" }] },
      method: { coding: [{ code: "c", system: "s" }] },
    };
    expect(evalOn("code.coding.first() = method.coding.first()", obs).satisfied).toBe(true);
    // A genuine difference (extra property) is still unequal.
    const obs2 = {
      resourceType: "Observation",
      code: { coding: [{ system: "s", code: "c" }] },
      method: { coding: [{ system: "s", code: "c", display: "d" }] },
    };
    expect(evalOn("code.coding.first() = method.coding.first()", obs2).satisfied).toBe(false);
  });
});

describe("evaluateInvariant — operators, functions, and literals across the subset", () => {
  const patient = {
    resourceType: "Patient",
    active: true,
    name: [{ family: "Aa", given: ["G1", "G2"] }, { family: "Bb" }],
  };

  it("union (|) concatenates and de-duplicates", () => {
    expect(evalOn("(name.given | name.family).count() = 4", patient).satisfied).toBe(true);
    expect(evalOn("('x' | 'x').count() = 1", patient).satisfied).toBe(true);
  });

  it("in / contains membership", () => {
    expect(evalOn("'Aa' in name.family", patient).satisfied).toBe(true);
    expect(evalOn("name.family contains 'Bb'", patient).satisfied).toBe(true);
    expect(evalOn("'zz' in name.family", patient).satisfied).toBe(false);
  });

  it("first / last / select / all / distinct", () => {
    expect(evalOn("name.first().family = 'Aa'", patient).satisfied).toBe(true);
    expect(evalOn("name.last().family = 'Bb'", patient).satisfied).toBe(true);
    expect(evalOn("name.select(family).count() = 2", patient).satisfied).toBe(true);
    expect(evalOn("name.all(family.exists())", patient).satisfied).toBe(true);
    expect(evalOn("(name.family | name.family).distinct().count() = 2", patient).satisfied).toBe(
      true,
    );
  });

  it("hasValue and comparison operators", () => {
    expect(evalOn("active.hasValue()", patient).satisfied).toBe(true);
    expect(evalOn("name.count() >= 2", patient).satisfied).toBe(true);
    expect(evalOn("name.count() <= 2", patient).satisfied).toBe(true);
    expect(evalOn("name.count() < 3", patient).satisfied).toBe(true);
    expect(evalOn("'a' < 'b'", patient).satisfied).toBe(true);
  });

  it("indexer selects by position and yields empty out of range", () => {
    expect(evalOn("name[0].family = 'Aa'", patient).satisfied).toBe(true);
    expect(evalOn("name[9].empty()", patient).satisfied).toBe(true);
  });

  it("boolean, empty-collection, and unary-minus literals", () => {
    expect(evalOn("true", patient).satisfied).toBe(true);
    expect(evalOn("false", patient).satisfied).toBe(false);
    expect(evalOn("{}.exists()", patient).satisfied).toBe(false);
    expect(evalOn("-1 < 0", patient).satisfied).toBe(true);
    expect(evalOn("%context.exists()", patient).satisfied).toBe(true);
  });

  it("xor and implies truth tables", () => {
    expect(evalOn("true xor false", patient).satisfied).toBe(true);
    expect(evalOn("true xor true", patient).satisfied).toBe(false);
    expect(evalOn("false implies false", patient).satisfied).toBe(true);
    expect(evalOn("true implies active", patient).satisfied).toBe(true);
  });

  it("System-type is / as / ofType on primitive values", () => {
    expect(evalOn("active is Boolean", patient).satisfied).toBe(true);
    expect(evalOn("3 is Integer", patient).satisfied).toBe(true);
    expect(evalOn("3 is System.Decimal", patient).satisfied).toBe(true); // Integer is a Decimal
    expect(evalOn("3.5 is Decimal", patient).satisfied).toBe(true);
    expect(evalOn("(name.family as String).count() = 2", patient).satisfied).toBe(true);
    expect(evalOn("name.family.ofType(String).count() = 2", patient).satisfied).toBe(true);
    expect(evalOn("name.first().family is Boolean", patient).satisfied).toBe(false);
  });

  it("compares a decimal element to a numeric literal precisely", () => {
    const obs = { resourceType: "Observation", valueQuantity: { value: 1.0, unit: "mg" } };
    expect(evalOn("valueQuantity.value = 1", obs).satisfied).toBe(true);
    expect(evalOn("valueQuantity.value = 2", obs).satisfied).toBe(false);
  });

  it("navigates a primitive's extension and evaluates extension(url)", () => {
    const withExt = {
      resourceType: "Patient",
      _gender: { extension: [{ url: "http://x/reason", valueCode: "asked" }] },
      extension: [{ url: "http://x/race", valueString: "r" }],
    };
    expect(evalOn("gender.extension.exists()", withExt).satisfied).toBe(true);
    expect(evalOn("extension('http://x/race').exists()", withExt).satisfied).toBe(true);
    expect(evalOn("extension('http://x/nope').exists()", withExt).satisfied).toBe(false);
  });
});

describe("evaluateInvariant — fail-safe (unchecked, never a false pass)", () => {
  it("reports an unsupported function as unchecked, never satisfied", () => {
    const r = evalOn("descendants().exists()", { resourceType: "Patient", id: "1" });
    expect(r.unchecked).toBe(true);
    expect(r.satisfied).toBe(false);
  });

  it("reports an unsupported operator / arithmetic as unchecked", () => {
    expect(evalOn("(1 + 1) = 2", { resourceType: "Patient" }).unchecked).toBe(true);
  });

  it("reports a FHIR-type test on a complex value as unchecked", () => {
    expect(evalOn("code is Quantity", { resourceType: "Observation", code: {} }).unchecked).toBe(
      true,
    );
  });

  it("reports an unsupported environment variable as unchecked", () => {
    expect(evalOn("%ucum.exists()", { resourceType: "Observation" }).unchecked).toBe(true);
  });

  it("does not throw out of the engine — every failure is caught into unchecked", () => {
    expect(() => evalOn("@@@", { resourceType: "Patient" })).not.toThrow();
    expect(evalOn("@@@", { resourceType: "Patient" }).unchecked).toBe(true);
  });

  it("reports a non-orderable comparison and a non-singleton membership as unchecked", () => {
    expect(
      evalOn("name > 'x'", { resourceType: "Patient", name: [{ family: "A" }] }).unchecked,
    ).toBe(true);
    expect(
      evalOn("(name.family | name.given) in name.family", {
        resourceType: "Patient",
        name: [{ family: "A", given: ["B"] }],
      }).unchecked,
    ).toBe(true);
  });

  it("reports a logical operator over a non-boolean operand as unchecked", () => {
    expect(
      evalOn("name.family and true", { resourceType: "Patient", name: [{ family: "A" }] })
        .unchecked,
    ).toBe(true);
  });

  it("reports a non-integer / unsupported $index / unknown function as unchecked", () => {
    expect(
      evalOn("name[$index]", { resourceType: "Patient", name: [{ family: "A" }] }).unchecked,
    ).toBe(true);
    expect(evalOn("name['x']", { resourceType: "Patient" }).unchecked).toBe(true);
    expect(evalOn("name.trace('x')", { resourceType: "Patient" }).unchecked).toBe(true);
  });
});

describe("tokenize / parseFhirPath — remaining lexer & parser branches", () => {
  it("lexes delimited identifiers, quoted env vars, and decimals", () => {
    expect(tokenize("`status`")[0]).toEqual({ type: "identifier", value: "status", pos: 0 });
    expect(tokenize("%'vs'")[0]).toEqual({ type: "envvar", value: "vs", pos: 0 });
    expect(tokenize("1.5 + 2").map((t) => t.value)).toEqual(["1.5", "+", "2"]);
  });

  it("rejects malformed delimited identifiers, env/special vars", () => {
    expect(() => tokenize("`unterminated")).toThrow(UnsupportedFhirPathError);
    expect(() => tokenize("`a\\b`")).toThrow(UnsupportedFhirPathError);
    expect(() => tokenize("% ")).toThrow(UnsupportedFhirPathError);
    expect(() => tokenize("$ ")).toThrow(UnsupportedFhirPathError);
  });

  it("parses qualified type specifiers and parenthesised groups", () => {
    expect(parseFhirPath("3 is System.Integer").kind).toBe("typeop");
    expect(parseFhirPath("(a or b) and c").kind).toBe("binary");
  });

  it("rejects an unclosed group, empty-literal, and malformed type name", () => {
    expect(() => parseFhirPath("(a")).toThrow(UnsupportedFhirPathError);
    expect(() => parseFhirPath("{")).toThrow(UnsupportedFhirPathError);
    expect(() => parseFhirPath("a is 3")).toThrow(UnsupportedFhirPathError);
    expect(() => parseFhirPath("")).toThrow(UnsupportedFhirPathError);
  });

  it("parses (but defers) arithmetic and multi-argument calls; rejects stray symbols", () => {
    expect(parseFhirPath("a * b").kind).toBe("binary");
    expect(parseFhirPath("a div b").kind).toBe("binary");
    expect(parseFhirPath("x.combine(a, b)").kind).toBe("call");
    expect(() => parseFhirPath("a.'x'")).toThrow(UnsupportedFhirPathError);
    expect(() => parseFhirPath(",")).toThrow(UnsupportedFhirPathError);
  });

  it("rejects a bad unicode escape", () => {
    expect(() => tokenize("'\\uZZZZ'")).toThrow(UnsupportedFhirPathError);
  });
});

describe("evaluateInvariant — remaining evaluator branches", () => {
  const patient = {
    resourceType: "Patient",
    name: [
      { family: "Aa", given: ["G1", "G2"], _family: { extension: [{ url: "u" }] } },
      { family: "Bb" },
    ],
  };

  it("!= operator, decimal comparison, and Decimal type of a decimal element", () => {
    const obs = { resourceType: "Observation", status: "final", valueQuantity: { value: 1.0 } };
    expect(evalOn("status != 'x'", obs).satisfied).toBe(true);
    expect(evalOn("status != 'final'", obs).satisfied).toBe(false);
    expect(evalOn("valueQuantity.value < 2", obs).satisfied).toBe(true);
    expect(evalOn("valueQuantity.value is Decimal", obs).satisfied).toBe(true);
  });

  it("and short-circuits to empty (three-valued) when one side is empty", () => {
    expect(evalOn("name.exists() and missing.first()", patient).satisfied).toBe(false);
  });

  it("structural equality across nested lists and mixed-kind inequality", () => {
    expect(evalOn("name.first() = name.first()", patient).satisfied).toBe(true); // recurses into given[]
    expect(evalOn("name.first() = name.first().family", patient).satisfied).toBe(false); // complex vs primitive
    expect(evalOn("name.first() = 'Aa'", patient).satisfied).toBe(false); // complex vs string
  });

  it("navigates a value-absent primitive's id and an unknown primitive member", () => {
    const obs = { resourceType: "Observation", status: "final", _status: { id: "abc" } };
    expect(evalOn("status.id = 'abc'", obs).satisfied).toBe(true);
    expect(evalOn("status.subfield.empty()", obs).satisfied).toBe(true);
  });

  it("children() of a primitive returns its extensions; nested-array navigation flattens", () => {
    expect(evalOn("name.first().family.children().exists()", patient).satisfied).toBe(true);
    expect(evalOn("x.count() = 1", { resourceType: "Patient", x: [["a"]] }).satisfied).toBe(true);
  });

  it("a non-singleton comparison and a non-identifier ofType() are unchecked", () => {
    expect(evalOn("name.family < 'z'", patient).unchecked).toBe(true); // two families → not singleton
    expect(evalOn("name.ofType('String')", patient).unchecked).toBe(true); // string arg, not a type name
  });

  it("equality/comparison/membership propagate empty when a side is empty", () => {
    expect(evalOn("missing.first() = 'x'", patient).satisfied).toBe(false); // empty = x → empty
    expect(evalOn("missing.first() != 'x'", patient).satisfied).toBe(false); // empty != x → empty
    expect(evalOn("missing.first() < 1", patient).satisfied).toBe(false); // empty < 1 → empty
    expect(evalOn("missing.first() in name.family", patient).satisfied).toBe(false); // empty in … → empty
    expect(evalOn("name.first().family = name.last().family", patient).satisfied).toBe(false); // Aa vs Bb
  });

  it("covers or/xor/implies empty propagation and rootResource", () => {
    expect(evalOn("missing.first() or name.exists()", patient).satisfied).toBe(true);
    expect(evalOn("name.exists() xor missing.first()", patient).satisfied).toBe(false); // true xor empty → empty
    expect(evalOn("name.exists() implies missing.first()", patient).satisfied).toBe(false); // true implies empty
    expect(evalOn("missing.first() implies name.exists()", patient).satisfied).toBe(true); // empty implies true
    expect(evalOn("%rootResource.exists()", patient).satisfied).toBe(true);
  });

  it("is on a non-singleton is false; unary plus; empty ofType", () => {
    expect(evalOn("name is String", patient).satisfied).toBe(false); // two names → not singleton → false
    expect(evalOn("+1 > 0", patient).satisfied).toBe(true);
    expect(evalOn("name.given.ofType(Boolean).empty()", patient).satisfied).toBe(true);
    expect(evalOn("name[name.family]", patient).unchecked).toBe(true); // index is not a single integer
  });
});

describe("tokenize — every string escape and number-boundary branch", () => {
  it("unescapes the full escape set", () => {
    expect(tokenize("'\\'\\`\\\\\\/\\f\\r\\n\\t'")[0]?.value).toBe("'`\\/\f\r\n\t");
  });

  it("treats a trailing dot as a symbol, not a decimal point", () => {
    expect(tokenize("1.exists()").map((t) => t.value)).toEqual(["1", ".", "exists", "(", ")"]);
  });

  it("skips every whitespace kind between tokens", () => {
    expect(tokenize("a\n\t\r b").map((t) => t.value)).toEqual(["a", "b"]);
  });
});

describe("evaluateInvariant — boolean-node coercion in logic operators", () => {
  const r = { resourceType: "Patient", active: true };
  it("coerces a boolean element node in a logical operator", () => {
    expect(evalOn("active and active", r).satisfied).toBe(true);
    expect(evalOn("active or active", r).satisfied).toBe(true);
  });
  it("propagates empty through 'or' when both sides are empty", () => {
    expect(evalOn("missing.first() or missing.first()", r).satisfied).toBe(false);
  });
});
