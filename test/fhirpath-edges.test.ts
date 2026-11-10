/**
 * The bounded FHIRPath engine at its edges: the `matches()` subset grammar rule by rule, equality
 * over decimals and value-absent primitives, temporal ordering at every written precision, the
 * refusals a malformed or out-of-subset expression draws, and type tests over shapes the instance
 * does not settle.
 *
 * Every refusal is asserted as `unchecked` (never satisfied), the contract the profile layer relies
 * on to keep a constraint reported. FIXTURES ARE SYNTHETIC: made-up identifiers and values, and no
 * person, name, date of birth or address.
 */
import { describe, expect, it } from "vitest";

import {
  complex,
  decimal,
  evaluateInvariant,
  list,
  parseFhirPath,
  parseResource,
  primitive,
  UnsupportedFhirPathError,
  type FhirComplex,
  type FhirNode,
} from "../src/index.js";

const SATISFIED = { unchecked: false, satisfied: true };
const NOT_SATISFIED = { unchecked: false, satisfied: false };
const UNCHECKED = { unchecked: true, satisfied: false };

function parse(obj: unknown): FhirComplex {
  return parseResource(JSON.stringify(obj)).resource;
}

/** `evaluateInvariant` of `expression` with the resource as both focus and `%resource`. */
function on(expression: string, obj: unknown): { unchecked: boolean; satisfied: boolean } {
  const resource = parse(obj);
  return evaluateInvariant(expression, resource, resource);
}

/** `matches(pattern)` over one synthetic string value, the pattern written as FHIRPath source. */
function decide(pattern: string, value: string): { unchecked: boolean; satisfied: boolean } {
  return on(`identifier.value.matches('${pattern}')`, {
    resourceType: "Organization",
    identifier: [{ system: "http://example.org/ids", value }],
  });
}

describe("matches(): the portable subset, rule by rule", () => {
  it("decides an alternation, quantified on either side", () => {
    expect(decide("7|1", "12345")).toEqual(SATISFIED);
    expect(decide("7|8", "12345")).toEqual(NOT_SATISFIED);
    expect(decide("^1+|x", "12345")).toEqual(SATISFIED);
    expect(decide("^x|5+$", "12345")).toEqual(SATISFIED);
    expect(decide("^(12|34)5", "12345")).toEqual(NOT_SATISFIED);
    expect(decide("(12|34)5$", "12345")).toEqual(SATISFIED);
  });

  it("refuses a quantified group that holds an alternation or a quantifier", () => {
    expect(decide("(1|2)+", "12345")).toEqual(UNCHECKED);
    expect(decide("(1|2+)", "12345")).toEqual(SATISFIED);
    expect(decide("(x|2+)*", "12345")).toEqual(UNCHECKED);
  });

  it("refuses a pattern with a stray close parenthesis or a quantified anchor", () => {
    expect(decide("1)", "12345")).toEqual(UNCHECKED);
    expect(decide("^*1", "12345")).toEqual(UNCHECKED);
    expect(decide("1$+", "12345")).toEqual(UNCHECKED);
  });

  it("refuses a quantifier or a closing bracket with nothing to apply to", () => {
    expect(decide("*1", "12345")).toEqual(UNCHECKED);
    expect(decide("+1", "12345")).toEqual(UNCHECKED);
    expect(decide("]1", "12345")).toEqual(UNCHECKED);
    expect(decide("}1", "12345")).toEqual(UNCHECKED);
  });

  it("decides the counted quantifiers and refuses a malformed or oversized count", () => {
    expect(decide("^1{2,}", "11345")).toEqual(SATISFIED);
    expect(decide("^1{2,}", "12345")).toEqual(NOT_SATISFIED);
    expect(decide("^[0-9]{2,5}$", "12345")).toEqual(SATISFIED);
    expect(decide("^[0-9]{2,4}$", "12345")).toEqual(NOT_SATISFIED);
    expect(decide("^[0-9]{5,5}$", "12345")).toEqual(SATISFIED);
    expect(decide("1{4,2}", "12345")).toEqual(UNCHECKED);
    expect(decide("1{2", "12345")).toEqual(UNCHECKED);
    expect(decide("1{2,3", "12345")).toEqual(UNCHECKED);
    expect(decide("1{,3}", "12345")).toEqual(UNCHECKED);
    expect(decide("1{x}", "12345")).toEqual(UNCHECKED);
    expect(decide("1{1001}", "12345")).toEqual(UNCHECKED);
    expect(decide("1{1,1001}", "12345")).toEqual(UNCHECKED);
    expect(decide("^[0-9]{1,1000}$", "12345")).toEqual(SATISFIED);
  });

  it("decides a negated class, and refuses an empty one", () => {
    expect(decide("^[^a-z]+$", "12345")).toEqual(SATISFIED);
    expect(decide("[^0-9]", "12345")).toEqual(NOT_SATISFIED);
    expect(decide("[]", "12345")).toEqual(UNCHECKED);
    expect(decide("[^]", "12345")).toEqual(UNCHECKED);
  });

  it("reads an escaped metacharacter literally, inside a class and out", () => {
    // FHIRPath source `\\` is one backslash in the pattern.
    expect(decide("^12\\\\.3$", "12.3")).toEqual(SATISFIED);
    expect(decide("^12\\\\.3$", "1243")).toEqual(NOT_SATISFIED);
    expect(decide("a\\\\/b", "a/b")).toEqual(SATISFIED);
    expect(decide("^[\\\\]x]$", "]")).toEqual(SATISFIED);
    expect(decide("^[\\\\]x]$", "y")).toEqual(NOT_SATISFIED);
    expect(decide("^[a\\\\-z]+$", "a-z")).toEqual(SATISFIED);
    expect(decide("^[a\\\\-z]+$", "b")).toEqual(NOT_SATISFIED);
  });

  it("refuses an escape outside the subset, and a pattern ending in a lone backslash", () => {
    expect(decide("1\\\\", "12345")).toEqual(UNCHECKED);
    expect(decide("\\\\q", "12345")).toEqual(UNCHECKED);
    expect(decide("[\\\\d]", "12345")).toEqual(UNCHECKED);
    expect(decide("[1\\\\", "12345")).toEqual(UNCHECKED);
    expect(decide("[1", "12345")).toEqual(UNCHECKED);
    expect(decide("[-1]", "12345")).toEqual(UNCHECKED);
    expect(decide("[1-]", "1-")).toEqual(UNCHECKED);
  });
});

describe("equality over decimals and value-absent primitives", () => {
  const observation = {
    resourceType: "Observation",
    status: "final",
    code: { text: "synthetic" },
    valueQuantity: { value: 1.5, unit: "mg" },
    referenceRange: [{ low: { value: 1.5 }, high: { value: 1.5 } }],
  };

  it("compares two model decimals by value", () => {
    const written = parse({
      resourceType: "Observation",
      status: "final",
      code: { text: "synthetic" },
      referenceRange: [{ low: { value: 1.5 }, high: { value: 2.5 } }, { low: { value: 1.5 } }],
    });
    const at = (expression: string) => evaluateInvariant(expression, written, written);
    expect(at("referenceRange[0].low.value = referenceRange[1].low.value")).toEqual(SATISFIED);
    expect(at("referenceRange[0].low.value = referenceRange[0].high.value")).toEqual(NOT_SATISFIED);
  });

  it("compares a computed number to a model decimal from either side", () => {
    expect(on("1.5 = referenceRange.low.value", observation)).toEqual(SATISFIED);
    expect(on("referenceRange.low.value = 1.5", observation)).toEqual(SATISFIED);
    expect(on("2 = referenceRange.low.value", observation)).toEqual(NOT_SATISFIED);
    expect(on("'1.5' = referenceRange.low.value", observation)).toEqual(NOT_SATISFIED);
    expect(on("referenceRange.low.value = '1.5'", observation)).toEqual(NOT_SATISFIED);
  });

  it("holds a value-absent primitive unequal to a valued one inside a complex", () => {
    const condition = {
      resourceType: "Condition",
      code: {
        coding: [
          { system: "http://example.org/cs", _code: { extension: [{ url: "http://e.org/x" }] } },
          { system: "http://example.org/cs", code: "a" },
          { system: "http://example.org/cs", _code: { extension: [{ url: "http://e.org/x" }] } },
        ],
      },
    };
    expect(on("code.coding[0] = code.coding[1]", condition)).toEqual(NOT_SATISFIED);
    expect(on("code.coding[0] = code.coding[2]", condition)).toEqual(SATISFIED);
  });
});

describe("navigation from primitives and computed values", () => {
  const patient = {
    resourceType: "Patient",
    gender: "female",
    _gender: { id: "g1" },
  };

  it("reads a primitive's id and nothing else off it", () => {
    expect(on("gender.id = 'g1'", patient)).toEqual(SATISFIED);
    expect(on("gender.value.empty()", patient)).toEqual(SATISFIED);
    expect(on("gender.extension.empty()", patient)).toEqual(SATISFIED);
    expect(on("active.id.empty()", { resourceType: "Patient", active: true })).toEqual(SATISFIED);
  });

  it("selects nothing from a member or children() of a computed value", () => {
    expect(on("('a' | 'b').length.empty()", patient)).toEqual(SATISFIED);
    expect(on("'a'.children().empty()", patient)).toEqual(SATISFIED);
  });

  it("answers last() over an empty collection with empty", () => {
    expect(on("name.last().empty()", patient)).toEqual(SATISFIED);
    expect(on("gender.last() = 'female'", patient)).toEqual(SATISFIED);
  });
});

describe("temporal ordering at every written precision", () => {
  function period(start: string, end: string) {
    return { resourceType: "Encounter", status: "finished", period: { start, end } };
  }

  it("orders across a negative zone offset", () => {
    expect(
      on("period.start < period.end", period("2020-01-01T10:00:00-05:00", "2020-01-01T16:00:00Z")),
    ).toEqual(SATISFIED);
    expect(
      on("period.start = period.end", period("2020-01-01T10:00:00-05:00", "2020-01-01T15:00:00Z")),
    ).toEqual(NOT_SATISFIED);
    expect(
      on("period.start <= period.end", period("2020-01-01T10:00:00-05:00", "2020-01-01T15:00:00Z")),
    ).toEqual(SATISFIED);
    expect(
      on("period.start > period.end", period("2020-01-01T10:00:00-05:00", "2020-01-01T14:00:00Z")),
    ).toEqual(SATISFIED);
  });

  it("narrows to a fractional second, and leaves an overlapping precision undetermined", () => {
    expect(
      on("period.start < period.end", period("2020-01-01T10:00:00.5Z", "2020-01-01T10:00:00.7Z")),
    ).toEqual(SATISFIED);
    expect(
      on(
        "period.start >= period.end",
        period("2020-01-01T10:00:00.500Z", "2020-01-01T10:00:00.5Z"),
      ),
    ).toEqual(NOT_SATISFIED);
    expect(
      on(
        "(period.start < period.end).empty()",
        period("2020-01-01T10:00:00.500Z", "2020-01-01T10:00:00.5Z"),
      ),
    ).toEqual(SATISFIED);
  });

  function times(a: string, b: string) {
    return {
      resourceType: "Observation",
      status: "final",
      code: { text: "synthetic" },
      valueTime: a,
      component: [{ code: { text: "synthetic" }, valueTime: b }],
    };
  }

  it("orders times of day at hour, minute, second and fractional precision", () => {
    expect(on("valueTime < component.valueTime", times("09", "10"))).toEqual(SATISFIED);
    expect(on("valueTime < component.valueTime", times("09:30", "09:31"))).toEqual(SATISFIED);
    expect(on("valueTime > component.valueTime", times("09:30:01", "09:30:00"))).toEqual(SATISFIED);
    expect(on("valueTime < component.valueTime", times("09:30:00.25", "09:30:00.5"))).toEqual(
      SATISFIED,
    );
    expect(on("(valueTime < component.valueTime).empty()", times("09:30", "09:30:15"))).toEqual(
      SATISFIED,
    );
  });
});

describe("refusals the engine owes a malformed or out-of-subset expression", () => {
  const extended = {
    resourceType: "Patient",
    extension: [{ url: "http://example.org/a", valueString: "x" }],
    active: true,
  };

  it("refuses extension() without exactly one string url", () => {
    expect(on("extension('http://example.org/a').exists()", extended)).toEqual(SATISFIED);
    expect(on("extension('http://example.org/b').exists()", extended)).toEqual(NOT_SATISFIED);
    expect(on("extension({}).exists()", extended)).toEqual(UNCHECKED);
    expect(on("extension('a' | 'b').exists()", extended)).toEqual(UNCHECKED);
    expect(on("extension(1).exists()", extended)).toEqual(UNCHECKED);
  });

  it("refuses a function called without the argument it needs", () => {
    expect(on("extension.where()", extended)).toEqual(UNCHECKED);
    expect(on("extension.select().exists()", extended)).toEqual(UNCHECKED);
  });

  it("refuses a unary sign over a collection or a non-number", () => {
    expect(on("-(1 | 2) < 0", extended)).toEqual(UNCHECKED);
    expect(on("-'a' < 0", extended)).toEqual(UNCHECKED);
    expect(on("-active < 0", extended)).toEqual(UNCHECKED);
    expect(on("-(1) < 0", extended)).toEqual(SATISFIED);
    expect(on("+(1) > 0", extended)).toEqual(SATISFIED);
  });

  it("refuses a type name with a non-identifier part, and a number literal too large to hold", () => {
    expect(on("active is FHIR.1", extended)).toEqual(UNCHECKED);
    expect(() => parseFhirPath("active is FHIR.'boolean'")).toThrow(UnsupportedFhirPathError);
    expect(() => parseFhirPath(`1${"0".repeat(400)} > 1`)).toThrow(UnsupportedFhirPathError);
    expect(on(`1${"0".repeat(400)} > 1`, extended)).toEqual(UNCHECKED);
  });

  it("refuses a System type test on a primitive the model holds no value for", () => {
    const absent = { resourceType: "Patient", _gender: { extension: [{ url: "http://e.org/x" }] } };
    expect(on("gender is String", absent)).toEqual(UNCHECKED);
    expect(on("gender is String", { resourceType: "Patient", gender: "male" })).toEqual(SATISFIED);
  });

  it("refuses a System type outside the value-read set on a model primitive", () => {
    const patient = { resourceType: "Patient", birthDate: "1970-01-01" };
    expect(on("birthDate is System.Date", patient)).toEqual(UNCHECKED);
    expect(on("birthDate is DateTime", patient)).toEqual(UNCHECKED);
  });
});

describe("type tests over shapes the instance does not settle", () => {
  const quantity = (): FhirComplex => complex([{ name: "value", value: primitive(decimal("1")) }]);

  it("answers a node shared at two root choice positions only when both agree", () => {
    const shared = parse({
      resourceType: "Observation",
      valuePeriod: { start: "2020-01-01" },
    });
    const periodNode = shared.properties.find((p) => p.name === "valuePeriod")?.value as FhirNode;
    const agreeing = complex([
      { name: "resourceType", value: primitive("Observation") },
      { name: "valuePeriod", value: periodNode },
      { name: "effectivePeriod", value: periodNode },
    ]);
    expect(evaluateInvariant("valuePeriod is Period", agreeing, agreeing)).toEqual(SATISFIED);
    expect(evaluateInvariant("effectivePeriod is Quantity", agreeing, agreeing)).toEqual(
      NOT_SATISFIED,
    );

    const disagreeing = complex([
      { name: "resourceType", value: primitive("Observation") },
      { name: "valuePeriod", value: periodNode },
      { name: "valueRange", value: periodNode },
    ]);
    expect(evaluateInvariant("valuePeriod is Period", disagreeing, disagreeing)).toEqual(UNCHECKED);
  });

  it("still answers a type test on a resource that carries a duplicate property", () => {
    const json =
      '{"resourceType":"Observation","valueQuantity":{"value":1},"valueQuantity":{"value":2}}';
    const resource = parseResource(json).resource;
    expect(resource.duplicates?.length).toBe(1);
    expect(evaluateInvariant("valueQuantity is Quantity", resource, resource)).toEqual(SATISFIED);
  });

  it("refuses a type test where the root carries no resource type", () => {
    const q = quantity();
    const untyped = complex([{ name: "valueQuantity", value: q }]);
    expect(evaluateInvariant("valueQuantity is Quantity", untyped, untyped)).toEqual(UNCHECKED);
    expect(evaluateInvariant("%resource is Quantity", untyped, untyped)).toEqual(UNCHECKED);

    const datatypeRoot = complex([
      { name: "resourceType", value: primitive("Quantity") },
      { name: "value", value: primitive(undefined, { id: "v" }) },
    ]);
    expect(evaluateInvariant("%resource is Quantity", datatypeRoot, datatypeRoot)).toEqual(
      UNCHECKED,
    );
  });

  it("refuses a type test when the resource handed in is a bare list", () => {
    const focus = parse({ resourceType: "Patient" });
    expect(evaluateInvariant("$this is Patient", focus, list([focus]))).toEqual(UNCHECKED);
    expect(evaluateInvariant("$this is Patient", focus, focus)).toEqual(SATISFIED);
  });

  it("refuses a FHIR primitive type test on a primitive standing as the resource", () => {
    const focus = parse({ resourceType: "Basic" });
    expect(evaluateInvariant("%resource is string", focus, primitive("x"))).toEqual(UNCHECKED);
    expect(evaluateInvariant("%resource is Quantity", focus, primitive("x"))).toEqual(
      NOT_SATISFIED,
    );
  });
});
