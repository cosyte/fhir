import { describe, expect, it } from "vitest";

import {
  convertToBoolean,
  evaluateInvariant,
  parseFhirPath,
  parseResource,
  tokenize,
  UnsupportedFhirPathError,
  type FhirComplex,
  type FpColl,
} from "../src/index.js";
import { evaluate, focusCollection } from "../src/fhirpath/evaluate.js";

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

describe("parseFhirPath: precedence", () => {
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

describe("convertToBoolean: matches the reference validator's coercion", () => {
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

describe("evaluateInvariant: core navigation, existence, logic", () => {
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

  it("evaluates ele-1 (hasValue or children over id): passes for a real resource", () => {
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

describe("evaluateInvariant: agrees with the oracle on the named R4 invariants", () => {
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
    // {system, code}. FHIR JSON key order is not significant, so this MUST still be a violation, a
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

describe("evaluateInvariant: operators, functions, and literals across the subset", () => {
  const patient = {
    resourceType: "Patient",
    active: true,
    name: [{ family: "Chalmers", given: ["G1", "G2"] }, { family: "Roe" }],
  };

  it("union (|) concatenates and de-duplicates", () => {
    expect(evalOn("(name.given | name.family).count() = 4", patient).satisfied).toBe(true);
    expect(evalOn("('x' | 'x').count() = 1", patient).satisfied).toBe(true);
  });

  it("in / contains membership", () => {
    expect(evalOn("'Chalmers' in name.family", patient).satisfied).toBe(true);
    expect(evalOn("name.family contains 'Roe'", patient).satisfied).toBe(true);
    expect(evalOn("'zz' in name.family", patient).satisfied).toBe(false);
  });

  it("first / last / select / all / distinct", () => {
    expect(evalOn("name.first().family = 'Chalmers'", patient).satisfied).toBe(true);
    expect(evalOn("name.last().family = 'Roe'", patient).satisfied).toBe(true);
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
    expect(evalOn("name[0].family = 'Chalmers'", patient).satisfied).toBe(true);
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

describe("evaluateInvariant: fail-safe (unchecked, never a false pass)", () => {
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

  it("does not throw out of the engine: every failure is caught into unchecked", () => {
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

describe("tokenize / parseFhirPath: remaining lexer & parser branches", () => {
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

describe("evaluateInvariant: remaining evaluator branches", () => {
  const patient = {
    resourceType: "Patient",
    name: [
      { family: "Chalmers", given: ["G1", "G2"], _family: { extension: [{ url: "u" }] } },
      { family: "Roe" },
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
    expect(evalOn("name.first() = 'Chalmers'", patient).satisfied).toBe(false); // complex vs string
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
    expect(evalOn("name.first().family = name.last().family", patient).satisfied).toBe(false); // Chalmers vs Roe
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

describe("tokenize: every string escape and number-boundary branch", () => {
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

describe("evaluateInvariant: boolean-node coercion in logic operators", () => {
  const r = { resourceType: "Patient", active: true };
  it("coerces a boolean element node in a logical operator", () => {
    expect(evalOn("active and active", r).satisfied).toBe(true);
    expect(evalOn("active or active", r).satisfied).toBe(true);
  });
  it("propagates empty through 'or' when both sides are empty", () => {
    expect(evalOn("missing.first() or missing.first()", r).satisfied).toBe(false);
  });
});

describe("evaluate: a type-qualified path head resolves against a matching resource, else refuses", () => {
  const patient = { resourceType: "Patient", name: [{ given: ["Synthgiven"] }] };

  /** Evaluate against the resource, returning the raw collection so a refusal is visible. */
  function run(expression: string, obj: unknown = patient): FpColl {
    const resource = parse(obj);
    return evaluate(parseFhirPath(expression), focusCollection(resource), {
      resource,
      context: focusCollection(resource),
    });
  }

  it("resolves a leading resource-type qualifier to the focus it names", () => {
    // Navigated as an ordinary member this is `false` on a Patient that HAS a name (no resource has
    // a property called `Patient`): a wrong answer with no diagnostic. Refused outright it is
    // INVARIANT_UNCHECKED on a Patient that has NO name, which withdraws a true finding. Resolving
    // it against the focus whose resourceType the qualifier names is neither.
    expect(run("Patient.name.exists()")).toEqual([{ t: "bool", value: true }]);
    expect(evalOn("Patient.name.exists()", patient)).toEqual({ unchecked: false, satisfied: true });
    expect(evalOn("Patient.name.exists()", { resourceType: "Patient", active: true })).toEqual({
      unchecked: false,
      satisfied: false,
    });
    // The delimited spelling names the same type, and is resolved the same way.
    expect(run("`Patient`.name").length).toBe(1);
  });

  it("refuses a qualifier the focus does not match, rather than answering", () => {
    expect(() => run("Encounter.name.given")).toThrow(UnsupportedFhirPathError);
    expect(() => run("Encounter.name.given")).toThrow(/type-qualified path head 'Encounter'/);
  });

  it("refuses a type-qualified head over a focus that is not a resource root", () => {
    // Inside a filter the focus is a HumanName element, and the generic model carries no datatype
    // name, so there is nothing to check `Patient` against. Per item, and lazily.
    expect(() => run("name.where(Patient.given.exists())")).toThrow(UnsupportedFhirPathError);
    // An empty focus has nothing to check either, which is what lets a case whose input document is
    // unreadable still be scored on a document-independent refusal.
    const resource = parse(patient);
    expect(() => evaluate(parseFhirPath("Patient.name"), [], { resource, context: [] })).toThrow(
      /type-qualified path head 'Patient'/,
    );
  });

  it("leaves lowerCamelCase element navigation, and every type-name argument, untouched", () => {
    // FHIR element names are lowerCamelCase, so the two spellings are disjoint and nothing an
    // ordinary path navigates is caught by the rule.
    expect(run("name.given").length).toBe(1);
    expect(evalOn("name.given.exists()", patient).satisfied).toBe(true);
    // A type name reaches `ofType` / `is` / `as` off the AST and is never evaluated as a member, so
    // the System-primitive type tests the subset supports keep working.
    expect(evalOn("active.ofType(Boolean).exists()", { ...patient, active: true }).satisfied).toBe(
      true,
    );
    expect(evalOn("name.given.first() is String", patient).satisfied).toBe(true);
    expect(evalOn("name.given.first() as String", patient).satisfied).toBe(true);
  });
});

describe("evaluate: a type test outside the System primitives is refused, never answered false", () => {
  const patient = { resourceType: "Patient", gender: "male", name: [{ given: ["Synthgiven"] }] };

  it("refuses a FHIR type name in is / as / ofType", () => {
    // `false` there looks like a determination and is not one: the model is generic and carries no
    // FHIR datatype name, so `code` is a question the engine cannot answer (ADR 0002).
    expect(evalOn("gender.ofType(code).exists()", patient).unchecked).toBe(true);
    expect(evalOn("gender is code", patient).unchecked).toBe(true);
    expect(evalOn("gender as code", patient).unchecked).toBe(true);
    expect(evalOn("name.first() is HumanName", patient).unchecked).toBe(true);
  });

  it("keeps the four System primitive types, spelled bare or System-qualified", () => {
    expect(evalOn("gender is String", patient).satisfied).toBe(true);
    expect(evalOn("gender is System.String", patient).satisfied).toBe(true);
    expect(evalOn("(1 is Integer)", patient).satisfied).toBe(true);
    expect(evalOn("(1 is Decimal)", patient).satisfied).toBe(true); // Integer is a Decimal
    expect(evalOn("(true is Boolean)", patient).satisfied).toBe(true);
  });

  it("yields the empty collection for a type test over an empty operand", () => {
    const resource = parse(patient);
    const focus = focusCollection(resource);
    expect(
      evaluate(parseFhirPath("missing is String"), focus, { resource, context: focus }),
    ).toEqual([]);
    // Empty and false coerce alike, so no invariant's verdict moves with it.
    expect(evalOn("missing is String", patient)).toEqual({ unchecked: false, satisfied: false });
  });
});

describe("evaluate: ordering a model value the model carries no type for", () => {
  const periods = (start: string, end: string) => ({
    resourceType: "Patient",
    identifier: [{ period: { start, end } }],
  });
  const perOne =
    "identifier.period.all(start.hasValue().not() or end.hasValue().not() or (start <= end))";

  it("keeps answering per-1 where both ends are written at the same precision", () => {
    // The finding this must not withdraw: a period whose start is after its end.
    expect(evalOn(perOne, periods("2001-05-08", "2001-05-06")).satisfied).toBe(false);
    expect(evalOn(perOne, periods("2001-05-06", "2001-05-08")).satisfied).toBe(true);
    expect(evalOn(perOne, periods("2001-05-06", "2001-05-06")).satisfied).toBe(true);
  });

  it("yields empty where the two ends are written at different precisions", () => {
    // FHIRPath says a day and an instant inside that day do not order, so the comparison is `{}`,
    // and `all()` over it is false. Comparing the two lexically answered `true` instead.
    const resource = parse(periods("2001-05-06", "2001-05-06T10:10:10Z"));
    const focus = focusCollection(resource);
    expect(
      evaluate(parseFhirPath("identifier.period.start <= identifier.period.end"), focus, {
        resource,
        context: focus,
      }),
    ).toEqual([]);
    expect(evalOn(perOne, periods("2001-05-06", "2001-05-06T10:10:10Z")).satisfied).toBe(false);
  });

  it("orders two timezone offsets by the instants they name, rather than refusing them", () => {
    // Refusing these withdrew a true `per-1` violation: `13:00+02:00` is `11:00Z`, an hour AFTER
    // `10:00Z`, so a period written this way is genuinely inverted and the validator reported it
    // before this remedy existed. `test/profile-invariant-ordering.test.ts` pins the issue code, the
    // severity and `valid` for exactly this document at the layer that decides them.
    expect(evalOn(perOne, periods("2001-05-06T13:00:00+02:00", "2001-05-06T10:00:00Z"))).toEqual({
      unchecked: false,
      satisfied: false,
    });
    expect(evalOn(perOne, periods("2001-05-06T10:00:00Z", "2001-05-06T13:00:00+02:00"))).toEqual({
      unchecked: false,
      satisfied: true,
    });
    // Two designators for the same instant are equal, not unorderable, so `<=` holds both ways.
    expect(
      evalOn(
        "identifier.period.start <= identifier.period.end",
        periods("2001-05-06T10:00:00Z", "2001-05-06T12:00:00+02:00"),
      ).satisfied,
    ).toBe(true);
    expect(
      evalOn(
        "identifier.period.start < identifier.period.end",
        periods("2001-05-06T10:00:00Z", "2001-05-06T12:00:00+02:00"),
      ).satisfied,
    ).toBe(false);
    // A value with no designator is read at the engine's declared evaluation-context offset, UTC,
    // which is the frame the pre-change lexical comparison used, so the answer is still given.
    expect(
      evalOn(
        "identifier.period.start <= identifier.period.end",
        periods("2001-05-06T12:00:00", "2001-05-06T11:00:00Z"),
      ),
    ).toEqual({ unchecked: false, satisfied: false });
  });

  it("yields empty for a date against a time of day, the one comparison FHIRPath does not define", () => {
    const resource = parse(periods("2001-05-06", "10:10:10"));
    const focus = focusCollection(resource);
    expect(
      evaluate(parseFhirPath("identifier.period.start < identifier.period.end"), focus, {
        resource,
        context: focus,
      }),
    ).toEqual([]);
    // Undetermined, NOT unchecked: the constraint is still decided, and decided against.
    expect(
      evalOn("identifier.period.start < identifier.period.end", periods("2001-05-06", "10:10:10")),
    ).toEqual({ unchecked: false, satisfied: false });
  });

  it("yields empty for a model value that is not temporal, and leaves System String ordering alone", () => {
    // From XML a `decimal` reads as a string, so `Observation.value.value < 'test'` compared a
    // number with a word and answered `true`. The engine cannot name the type either value came
    // from, so the ordering is undetermined and the expression is `{}`.
    const resource = parse({ resourceType: "Patient", gender: "male" });
    const focus = focusCollection(resource);
    expect(evaluate(parseFhirPath("gender < 'test'"), focus, { resource, context: focus })).toEqual(
      [],
    );
    // `{}` and `false` coerce alike here, so the constraint stays DECIDED and stays reported: this
    // is the difference between an undetermined comparison and an unsupported one, and
    // `test/profile-invariant-ordering.test.ts` pins the issue code and the severity for it.
    expect(evalOn("gender < 'test'", { resourceType: "Patient", gender: "male" })).toEqual({
      unchecked: false,
      satisfied: false,
    });
    // Two values the engine computed itself are Strings by construction and still order as Strings.
    expect(evalOn("('a' < 'b')", { resourceType: "Patient" }).satisfied).toBe(true);
    expect(evalOn("(2 > 1)", { resourceType: "Patient" }).satisfied).toBe(true);
    // A JSON-read decimal still orders as a number: it reaches the numeric branch, not this one.
    expect(
      evalOn("valueQuantity.value > 100", {
        resourceType: "Observation",
        valueQuantity: { value: 185.0 },
      }).satisfied,
    ).toBe(true);
  });
});

describe("parseFhirPath: 'is'/'as' bind tighter than union and looser than additive", () => {
  it("associates a union to the right of 'is', not around it", () => {
    // `1 | 1 is Integer` is `1 | (1 is Integer)`, two items, not `(1 | 1) is Integer`, one boolean.
    const ast = parseFhirPath("1 | 1 is Integer");
    expect(ast.kind).toBe("binary");
    if (ast.kind !== "binary") throw new Error("expected binary");
    expect(ast.op).toBe("|");
    expect(ast.right.kind).toBe("typeop");
  });

  it("associates a comparison outside 'is', so the operand is the right-hand side alone", () => {
    // `1 > 2 is Boolean` compares an Integer with a Boolean, which the language calls an error;
    // parsed the other way it answers `true`, a wrong boolean out of a well-formed parse.
    const ast = parseFhirPath("1 > 2 is Boolean");
    expect(ast.kind).toBe("binary");
    if (ast.kind !== "binary") throw new Error("expected binary");
    expect(ast.op).toBe(">");
    expect(ast.right.kind).toBe("typeop");
    expect(
      evaluateInvariant("1 > 2 is Boolean", parse({ resourceType: "Patient" }), parse({})),
    ).toEqual({ unchecked: true, satisfied: false });
  });

  it("keeps 'is' looser than additive, so the left operand is the whole sum", () => {
    const ast = parseFhirPath("1 + 2 is Integer");
    expect(ast.kind).toBe("typeop");
    if (ast.kind !== "typeop") throw new Error("expected typeop");
    expect(ast.operand.kind === "binary" && ast.operand.op).toBe("+");
  });

  it("leaves equality looser than 'is', which it already was", () => {
    const ast = parseFhirPath("a = b is Boolean");
    expect(ast.kind).toBe("binary");
    if (ast.kind !== "binary") throw new Error("expected binary");
    expect(ast.op).toBe("=");
    expect(ast.right.kind).toBe("typeop");
  });
});
