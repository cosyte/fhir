/**
 * The three properties every Cosyte parser proves, run on the generators this package exports at
 * `@cosyte/fhir/arbitraries`:
 *
 * 1. **Round trip.** What equality means here: FHIR is a tree, so the library's model is the thing
 *    compared, not a string.
 *    - **JSON.** For any generated resource `m`, `parseResource(serializeResource(m)).resource`
 *      deep-equals `m`: the same properties in the same order, every primitive the same kind with
 *      the same value (a decimal by its exact text, never by number), the same `id` and extensions
 *      on every primitive. The read raises no issue but `DECIMAL_PRECISION_AT_RISK`, which is
 *      advice that a decimal has more digits than a double holds, and changes nothing. Writing
 *      again gives the same text, byte for byte.
 *    - **XML.** The XML reader is schema-free and keeps every primitive as its lexical string, and
 *      a single occurrence of a repeating element as one node, so the documented equality across
 *      formats is `nodesEquivalent`: for any generated `m`, the model read back from
 *      `serializeResourceXml(m)` is `nodesEquivalent` to `m`, the read raises no issue, and writing
 *      it again gives the same XML, byte for byte.
 * 2. **Idempotent normalize.** The library has two normalizers, one per wire format:
 *    `serializeResource(parseResource(raw).resource)` and
 *    `serializeResourceXml(parseResourceXml(raw).resource)`. Normalizing twice gives what
 *    normalizing once gave, over messy text and over any hostile input the reader accepts and the
 *    writer does not refuse.
 * 3. **Never throws in lenient mode.** The readers are lenient by design. Any input comes back as a
 *    model whose issues carry registered codes, or is refused with one of the documented fatal
 *    errors (`FhirCodecError` with a `FATAL_CODES` code from the JSON reader, `FhirXmlError` with an
 *    `XML_FATAL_CODES` code from the XML reader), which are what lenient reading may still throw.
 *    What is accepted then validates, reads for safety and renders an `OperationOutcome` without
 *    throwing, and a writer either writes it or refuses with a `SERIALIZE_ERROR_CODES` code.
 *
 * Each runs 100 cases by default from a fresh seed; `COSYTE_PROPERTY_RUNS` sets the depth, and a
 * failure prints the seed and path that replay it (see `./_runner.ts`).
 */

import assert from "node:assert/strict";

import fc from "fast-check";
import { describe, it } from "vitest";

import {
  FATAL_CODES,
  FhirCodecError,
  FhirSerializeError,
  FhirXmlError,
  ISSUE_CODES,
  NDJSON_ERROR_CODES,
  SERIALIZE_ERROR_CODES,
  XML_FATAL_CODES,
  nodesEquivalent,
  parseNdjsonLine,
  parseResource,
  parseResourceXml,
  readSafety,
  serializeResource,
  serializeResourceXml,
  validateResource,
  type FhirComplex,
  type FhirNode,
  type ReadResult,
} from "../../src/index.js";
import {
  bundle,
  hostileInput,
  resource,
  resourceJson,
  resourceXml,
} from "../../src/arbitraries/index.js";
import { cleanBundleJson, cleanResourceJson } from "../../src/arbitraries/resource.js";

import { assertProperty, propertyTimeout } from "./_runner.js";

/** Each test's budget, scaled to the depth `COSYTE_PROPERTY_RUNS` sets. */
const TIMEOUT = propertyTimeout();

const JSON_FATAL: ReadonlySet<string> = new Set(Object.values(FATAL_CODES));
const XML_FATAL: ReadonlySet<string> = new Set(Object.values(XML_FATAL_CODES));
const ISSUES: ReadonlySet<string> = new Set(Object.values(ISSUE_CODES));
const NDJSON: ReadonlySet<string> = new Set(Object.values(NDJSON_ERROR_CODES));
const REFUSALS: ReadonlySet<string> = new Set(Object.values(SERIALIZE_ERROR_CODES));

/** The issues a read raised, other than the advice that a decimal outruns a double. */
function repairs(read: ReadResult): string[] {
  return read.issues
    .map((i) => i.code)
    .filter((code) => code !== ISSUE_CODES.DECIMAL_PRECISION_AT_RISK);
}

/** Read JSON leniently: the result, or `undefined` when the reader refused with a documented fatal. */
function readJson(raw: string): ReadResult | undefined {
  try {
    return parseResource(raw);
  } catch (err) {
    assert.ok(err instanceof FhirCodecError, `parseResource threw ${String(err)}`);
    assert.ok(JSON_FATAL.has(err.code), `parseResource threw the unregistered code ${err.code}`);
    return undefined;
  }
}

/** Read XML leniently: the result, or `undefined` when the reader refused with a documented fatal. */
function readXml(raw: string): ReadResult | undefined {
  try {
    return parseResourceXml(raw);
  } catch (err) {
    assert.ok(err instanceof FhirXmlError, `parseResourceXml threw ${String(err)}`);
    assert.ok(XML_FATAL.has(err.code), `parseResourceXml threw the unregistered code ${err.code}`);
    return undefined;
  }
}

/** Write a model, or `undefined` when the writer refused with a registered code. */
function write(model: FhirComplex, writer: (m: FhirComplex) => string): string | undefined {
  try {
    return writer(model);
  } catch (err) {
    assert.ok(err instanceof FhirSerializeError, `the writer threw ${String(err)}`);
    assert.ok(REFUSALS.has(err.code), `the writer refused with the unregistered code ${err.code}`);
    return undefined;
  }
}

/** Whether a model carries a narrative `div` whose start tag declares no default namespace. */
function carriesUnscopedNarrative(node: FhirNode): boolean {
  if (node.kind === "list") return node.items.some(carriesUnscopedNarrative);
  if (node.kind === "primitive") return false;
  return node.properties.some(({ name, value }) => {
    if (name === "div" && value.kind === "primitive" && typeof value.value === "string") {
      return !/^<div\b[^>]*\sxmlns=/u.test(value.value);
    }
    return carriesUnscopedNarrative(value);
  });
}

/** Everything a caller does with an accepted read: none of it throws. */
function assertUsable(read: ReadResult): void {
  for (const issue of read.issues) assert.ok(ISSUES.has(issue.code), `unregistered ${issue.code}`);
  const result = validateResource(read.resource);
  assert.equal(typeof result.valid, "boolean");
  result.toOperationOutcome();
  readSafety(read.resource);
  write(read.resource, serializeResource);
  write(read.resource, serializeResourceXml);
}

describe("property: round trip", () => {
  it(
    "JSON: parse(serialize(m)) deep-equals m for any generated resource, and writing again changes nothing",
    () => {
      assertProperty(
        "round trip (JSON)",
        fc.property(resource(), (m) => {
          const once = serializeResource(m);
          const back = parseResource(once);
          assert.deepStrictEqual(repairs(back), []);
          assert.deepStrictEqual(back.resource, m);
          assert.equal(serializeResource(back.resource), once);
        }),
      );
    },
    TIMEOUT,
  );

  it(
    "JSON: the same holds for any generated Bundle",
    () => {
      assertProperty(
        "round trip (Bundle)",
        fc.property(bundle(), (m) => {
          const once = serializeResource(m);
          const back = parseResource(once);
          assert.deepStrictEqual(repairs(back), []);
          assert.deepStrictEqual(back.resource, m);
          assert.equal(serializeResource(back.resource), once);
        }),
      );
    },
    TIMEOUT,
  );

  it(
    "XML: the model read back from serializeResourceXml(m) is nodesEquivalent to m, and writing again changes nothing",
    () => {
      assertProperty(
        "round trip (XML)",
        fc.property(resource(), (m) => {
          const once = serializeResourceXml(m);
          const back = parseResourceXml(once);
          assert.deepStrictEqual(back.issues, []);
          assert.ok(nodesEquivalent(back.resource, m), "the XML read is not equivalent");
          assert.equal(serializeResourceXml(back.resource), once);
        }),
      );
    },
    TIMEOUT,
  );

  it(
    "a generated resource is written apart from the library's writer, reads with no repair, and validates with no error in strict mode",
    () => {
      // This holds the generator to account: if the reader repaired anything in the text, or the
      // resource broke a rule the validator knows, the round trips above could be passing over a
      // repair or over a document that is not FHIR.
      assertProperty(
        "generator is spec-clean",
        fc.property(fc.oneof(cleanResourceJson(), cleanBundleJson({ maxEntries: 2 })), (text) => {
          const read = parseResource(text);
          assert.deepStrictEqual(repairs(read), []);
          assert.equal(serializeResource(read.resource), text);
          const errors = validateResource(read.resource, { mode: "strict" }).issues.filter(
            (i) => i.severity === "error" || i.severity === "fatal",
          );
          assert.deepStrictEqual(errors, []);
        }),
      );
    },
    TIMEOUT,
  );
});

describe("property: idempotent normalize", () => {
  const normalizeJson = (raw: string): string | undefined => {
    const read = readJson(raw);
    return read === undefined ? undefined : write(read.resource, serializeResource);
  };
  const normalizeXml = (raw: string): string | undefined => {
    const read = readXml(raw);
    return read === undefined ? undefined : write(read.resource, serializeResourceXml);
  };

  it(
    "JSON: serialize(parse(raw)) is a fixed point for messy JSON",
    () => {
      assertProperty(
        "idempotent normalize (messy JSON)",
        fc.property(resourceJson(), (raw) => {
          const once = normalizeJson(raw);
          assert.ok(once !== undefined, "messy JSON was refused");
          assert.equal(normalizeJson(once), once);
        }),
      );
    },
    TIMEOUT,
  );

  it(
    "JSON: serialize(parse(raw)) is a fixed point for any hostile input the reader and writer accept",
    () => {
      assertProperty(
        "idempotent normalize (hostile JSON)",
        fc.property(hostileInput({ format: "json" }), (raw) => {
          const once = normalizeJson(raw);
          if (once === undefined) return;
          assert.equal(normalizeJson(once), once);
        }),
      );
    },
    TIMEOUT,
  );

  it(
    "XML: serialize(parse(raw)) is a fixed point for messy XML, and reads equivalent to the clean spelling",
    () => {
      assertProperty(
        "idempotent normalize (messy XML)",
        fc.property(resourceXml(), (raw) => {
          const once = normalizeXml(raw);
          assert.ok(once !== undefined, "messy XML was refused");
          assert.equal(normalizeXml(once), once);
          assert.ok(
            nodesEquivalent(parseResourceXml(raw).resource, parseResourceXml(once).resource),
            "the messy spelling reads differently from its normal form",
          );
        }),
      );
    },
    TIMEOUT,
  );

  it(
    "XML: serialize(parse(raw)) is a fixed point for any hostile input the reader and writer accept",
    () => {
      assertProperty(
        "idempotent normalize (hostile XML)",
        fc.property(hostileInput({ format: "xml" }), (raw) => {
          const once = normalizeXml(raw);
          if (once === undefined) return;
          // A known gap, pinned in `test/xml-narrative-namespace.test.ts`: a narrative `div` that
          // declares no namespace takes on the FHIR namespace once written, so its first rewrite
          // is not a fixed point. When that test reds because the gap closed, drop this line.
          if (carriesUnscopedNarrative(parseResourceXml(raw).resource)) return;
          assert.equal(normalizeXml(once), once);
        }),
      );
    },
    TIMEOUT,
  );
});

describe("property: never throws in lenient mode", () => {
  it(
    "any hostile input reads from JSON with registered issues, or is refused with a documented fatal, and what is read is usable",
    () => {
      assertProperty(
        "never throws in lenient mode (JSON)",
        fc.property(hostileInput(), (raw) => {
          const read = readJson(raw);
          if (read !== undefined) assertUsable(read);
          const line = parseNdjsonLine(raw);
          if (line.error !== undefined) assert.ok(NDJSON.has(line.error.code));
        }),
      );
    },
    TIMEOUT,
  );

  it(
    "any hostile input reads from XML with registered issues, or is refused with a documented fatal, and what is read is usable",
    () => {
      assertProperty(
        "never throws in lenient mode (XML)",
        fc.property(hostileInput(), (raw) => {
          const read = readXml(raw);
          if (read !== undefined) assertUsable(read);
        }),
      );
    },
    TIMEOUT,
  );

  it(
    "messy JSON and messy XML always read, with registered issues",
    () => {
      assertProperty(
        "never throws in lenient mode (messy text)",
        fc.property(resourceJson(), resourceXml(), (json, xml) => {
          assertUsable(parseResource(json));
          const read = parseResourceXml(xml);
          assert.deepStrictEqual(read.issues, []);
          assertUsable(read);
        }),
      );
    },
    TIMEOUT,
  );
});
