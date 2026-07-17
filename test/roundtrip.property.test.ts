import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  complex,
  decimal,
  FhirDecimal,
  getProperty,
  isPrimitive,
  list,
  parseResource,
  primitive,
  serializeResource,
  type FhirComplex,
  type FhirNode,
  type FhirProperty,
  type PrimitiveValue,
} from "../src/index.js";

/** A pool of valid, non-`_`-prefixed, non-`resourceType` property names (kept unique per object). */
const KEY_POOL = [
  "alpha",
  "beta",
  "gamma",
  "given",
  "code",
  "note",
  "flag",
  "count",
  "when",
  "who",
];

/** A JSON-number literal, biased toward the hazards: trailing zeros, high precision, exponents. */
const arbDecimalRaw: fc.Arbitrary<string> = fc
  .tuple(
    fc.boolean(),
    fc.integer({ min: 0, max: 99999 }),
    fc.option(fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 1, maxLength: 8 }), {
      nil: undefined,
    }),
    fc.option(fc.integer({ min: -9, max: 9 }), { nil: undefined }),
  )
  .map(([neg, int, frac, exp]) => {
    let s = `${neg && int !== 0 ? "-" : ""}${String(int)}`;
    if (frac !== undefined) s += `.${frac.join("")}`;
    if (exp !== undefined) s += `e${String(exp)}`;
    return s;
  });

const arbPrimitiveValue: fc.Arbitrary<PrimitiveValue> = fc.oneof(
  fc.string(),
  fc.boolean(),
  arbDecimalRaw.map((raw) => decimal(raw)),
);

/** A shallow extension: `{ url, valueString }`. */
const arbExtension: fc.Arbitrary<FhirComplex> = fc
  .tuple(fc.webUrl(), fc.string())
  .map(([url, value]) =>
    complex([
      { name: "url", value: primitive(url) },
      { name: "valueString", value: primitive(value) },
    ]),
  );

/** Sparse primitive metadata: sometimes an id, sometimes a (non-empty) extension array. */
const arbMeta = fc.record(
  {
    id: fc.option(fc.stringMatching(/^[A-Za-z0-9.-]{1,16}$/), { nil: undefined }),
    extension: fc.option(fc.array(arbExtension, { minLength: 1, maxLength: 2 }), {
      nil: undefined,
    }),
  },
  { requiredKeys: [] },
);

/** A single primitive node that always carries either a value or metadata (never neither). */
const arbPrimitiveNode: fc.Arbitrary<FhirNode> = fc
  .tuple(fc.option(arbPrimitiveValue, { nil: undefined }), arbMeta)
  .map(([value, meta]) => {
    const hasMeta = meta.id !== undefined || meta.extension !== undefined;
    // Never emit a value-absent primitive with no metadata (it serializes to nothing).
    const safeValue = value === undefined && !hasMeta ? "" : value;
    return primitive(safeValue, {
      ...(meta.id !== undefined ? { id: meta.id } : {}),
      ...(meta.extension !== undefined ? { extension: meta.extension } : {}),
    });
  });

/** A repeating primitive with sparse `_`-sibling metadata (forces null-padding on serialize). */
const arbPrimitiveList: fc.Arbitrary<FhirNode> = fc
  .array(arbPrimitiveNode, { minLength: 1, maxLength: 4 })
  .map((items) => list(items));

/** A property value: a primitive, a primitive list, or (bounded) a nested complex. */
function arbValue(depth: number): fc.Arbitrary<FhirNode> {
  const leaves = [arbPrimitiveNode, arbPrimitiveList];
  if (depth <= 0) return fc.oneof(...leaves);
  return fc.oneof(
    { weight: 3, arbitrary: arbPrimitiveNode },
    { weight: 2, arbitrary: arbPrimitiveList },
    { weight: 1, arbitrary: arbComplex(depth - 1) },
    {
      weight: 1,
      arbitrary: fc.array(arbComplex(depth - 1), { minLength: 1, maxLength: 3 }).map(list),
    },
  );
}

/** A complex node with unique, valid property names. */
function arbComplex(depth: number): fc.Arbitrary<FhirComplex> {
  return fc
    .uniqueArray(fc.constantFrom(...KEY_POOL), { minLength: 0, maxLength: 5 })
    .chain((keys) =>
      fc.tuple(...keys.map(() => arbValue(depth))).map((values): FhirComplex => {
        const properties: FhirProperty[] = keys.map((name, i) => ({
          name,
          value: values[i] ?? primitive(""),
        }));
        return complex(properties);
      }),
    );
}

/** A resource: a complex with `resourceType` first. */
const arbResource: fc.Arbitrary<FhirComplex> = arbComplex(3).map((body) =>
  complex([{ name: "resourceType", value: primitive("TestResource") }, ...body.properties]),
);

describe("property: wire round-trip is stable", () => {
  it("serialize → parse → serialize is a fixed point for any generated resource", () => {
    fc.assert(
      fc.property(arbResource, (model) => {
        const once = serializeResource(model);
        const twice = serializeResource(parseResource(once).resource);
        expect(twice).toBe(once);
      }),
      { numRuns: 400 },
    );
  });

  it("every generated decimal survives the round-trip lexically", () => {
    fc.assert(
      fc.property(arbDecimalRaw, (raw) => {
        const model = complex([
          { name: "resourceType", value: primitive("TestResource") },
          { name: "count", value: primitive(decimal(raw)) },
        ]);
        const out = serializeResource(model);
        const back = getProperty(parseResource(out).resource, "count");
        expect(back && isPrimitive(back)).toBe(true);
        const value = (back as { value: PrimitiveValue | undefined }).value;
        expect(value).toBeInstanceOf(FhirDecimal);
        expect((value as FhirDecimal).raw).toBe(raw);
      }),
      { numRuns: 500 },
    );
  });
});
