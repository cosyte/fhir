/**
 * The corpus the output-equivalence test runs over, and the record it takes of one document.
 *
 * Shared by the capture script (`scripts/capture-output-digests.ts`, which runs it against a base
 * ref) and by the test that asserts head against the captured digests
 * (`test/output-equivalence.test.ts`), so the two can never come to disagree about what a document
 * is or what "the outputs" are. Neither carries its own copy.
 *
 * The record is everything a caller can observe of the read, the validator, the safety readout and
 * the writers for one document: the raw JSON tree, the model, every parse issue, every validation
 * issue in both modes, the OperationOutcome, the safety readout and each of its location channels
 * called on their own, the JSON and XML writes, and every error any of them throws (its class,
 * code, message, offset, expression and locations). A change that is meant to make these faster
 * and nothing else must leave every record byte-identical, which is what the digests pin.
 *
 * The corpus is built in code and is the same on every run: this package's own fixtures, the
 * benchmark shapes at their small sizes, documents written here for the paths a performance change
 * touches (strings with escapes, objects with many members and repeated names), and documents drawn
 * from `@cosyte/fhir/arbitraries` on fixed seeds, clean, messy and hostile, JSON and XML. Every
 * document is synthetic.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";

import fc from "fast-check";

import { cleanBundleJson, cleanResourceJson } from "../src/arbitraries/resource.js";
import { hostileInput, resourceJson, resourceXml } from "../src/arbitraries/text.js";
import {
  containedPatient,
  observation,
  reportWithAttachment,
  searchsetBundle,
  transactionBundle,
} from "../bench/shapes.mjs";

import type * as Fhir from "../src/index.js";

/** The surface a record reads, the same on the base tree and on head. */
export type OutputApi = typeof Fhir;

/** One document, named so a difference can be attributed. */
export interface OutputDocument {
  readonly name: string;
  readonly format: "json" | "xml";
  readonly text: string;
}

const FIXTURES = new URL("./__fixtures__/", import.meta.url);

/** Draw `count` values from `arbitrary` on a fixed seed. */
function draw(arbitrary: fc.Arbitrary<string>, seed: number, count: number): string[] {
  return fc.sample(arbitrary, { seed, numRuns: count });
}

/** A JSON string literal's body with every escape the reader knows, mixed with plain runs. */
const ESCAPED_BODIES: readonly string[] = [
  "",
  "plain",
  '\\"',
  'a\\"b',
  "\\\\\\/\\b\\f\\n\\r\\t",
  "run one\\nrun two\\tthree\\\\",
  "\\u0041\\u00e9\\u4e2d\\ud83d\\ude00",
  "\\ud800 lone high, \\udc00 lone low",
  "tail escape\\n",
  "\\nhead escape",
  "x".repeat(70) + "\\u0020" + "y".repeat(70),
];

/** Documents written here for the code paths a performance change touches. */
function writtenDocuments(): OutputDocument[] {
  const docs: OutputDocument[] = [];
  const json = (name: string, text: string): void => {
    docs.push({ name: `written:${name}`, format: "json", text });
  };
  ESCAPED_BODIES.forEach((body, i) => {
    json(
      `escapes-${String(i)}`,
      `{"resourceType":"Patient","id":"p${String(i)}","name":[{"text":"${body}","given":["${body}","b"]}]}`,
    );
    json(`escape-key-${String(i)}`, `{"resourceType":"Basic","${body}":"v","_${body}":{"id":"m"}}`);
  });
  // Malformed strings: each must fail at the same offset with the same message.
  for (const [name, text] of [
    ["unterminated", '{"resourceType":"Patient","id":"abc'],
    ["unterminated-after-escape", '{"resourceType":"Patient","id":"ab\\n'],
    ["unterminated-in-escape", '{"resourceType":"Patient","id":"ab\\'],
    ["control-char", '{"resourceType":"Patient","id":"a\u0001b"}'],
    ["control-after-escape", '{"resourceType":"Patient","id":"a\\nb\u0009c"}'],
    ["bad-escape", '{"resourceType":"Patient","id":"a\\qb"}'],
    ["bad-unicode", '{"resourceType":"Patient","id":"a\\u12g4"}'],
    ["short-unicode", '{"resourceType":"Patient","id":"a\\u12"}'],
    ["key-unterminated", '{"resourceType":"Patient","i'],
  ] as const) {
    json(name, text);
  }
  // Objects past any small-object fast path: many members, repeated names and `_` siblings among
  // them, at the root and nested.
  const many = (n: number, prefix: string): string[] =>
    Array.from({ length: n }, (_v, i) => `"${prefix}${String(i)}":"v${String(i)}"`);
  for (const n of [15, 16, 17, 40]) {
    const members = many(n, "el");
    json(`wide-${String(n)}`, `{"resourceType":"Basic",${members.join(",")}}`);
    json(
      `wide-dup-${String(n)}`,
      `{"resourceType":"Observation",${members.join(",")},"status":"final","el3":"again","_el5":{"id":"x"},"_el5":{"id":"y"},"status":"entered-in-error","el${String(n - 1)}":["w"]}`,
    );
    json(
      `wide-nested-${String(n)}`,
      `{"resourceType":"Patient","name":[{${members.join(",")},"_el1":{"extension":[{"url":"u","valueString":"s"}]},"el1":"dup"}],"contact":[{${members.join(",")}}]}`,
    );
    json(
      `wide-meta-first-${String(n)}`,
      `{"_status":{"id":"s"},${members.join(",")},"resourceType":"Observation","status":"final","_status":{"id":"t"}}`,
    );
  }
  const wideMeta = many(20, "k").join(",");
  json(
    "wide-meta-object",
    `{"resourceType":"Patient","birthDate":"1970-01-01","_birthDate":{"id":"a",${wideMeta},"id":"b","extension":[],"k3":1}}`,
  );
  json(
    "meta-repeats",
    '{"resourceType":"Patient","gender":"other","_gender":{"id":"a","id":"b","extension":[{"url":"u","valueCode":"x"}],"extension":[]}}',
  );
  json(
    "proto-key",
    '{"resourceType":"Basic","__proto__":"x","constructor":{"a":1},"_toString":{}}',
  );
  json("empty-key", '{"resourceType":"Basic","":"x","_":"y","_":{"id":"z"}}');
  json("rt-wrapped", '{"resourceType":["Observation"],"status":["entered-in-error"]}');
  json("rt-number", '{"resourceType":7,"status":"final"}');
  json("rt-dup", '{"resourceType":"Observation","resourceType":"Condition","status":"final"}');
  json("not-object", '["resourceType","Patient"]');
  return docs;
}

/** The benchmark shapes, at their small sizes. */
function benchDocuments(): OutputDocument[] {
  const docs: OutputDocument[] = [];
  const add = (name: string, text: string): void => {
    docs.push({ name: `bench:${name}`, format: "json", text });
  };
  for (let i = 0; i < 4; i++) add(`observation-${String(i)}`, observation(i));
  add("transaction-20", transactionBundle(1, 20));
  add("searchset-10", searchsetBundle(2, 10));
  add("patient-6", containedPatient(3, 6));
  add("report-2k", reportWithAttachment(4, 2048));
  return docs;
}

/** This package's own fixtures, JSON and XML, in a stable order. */
function fixtureDocuments(): OutputDocument[] {
  return readdirSync(FIXTURES)
    .filter((file) => file.endsWith(".json") || file.endsWith(".xml"))
    .sort()
    .map((file) => ({
      name: `fixture:${file}`,
      format: file.endsWith(".xml") ? ("xml" as const) : ("json" as const),
      text: readFileSync(new URL(file, FIXTURES), "utf8"),
    }));
}

/** Documents drawn from the arbitraries, on fixed seeds. */
function drawnDocuments(): OutputDocument[] {
  const docs: OutputDocument[] = [];
  const add = (family: string, format: "json" | "xml", texts: readonly string[]): void => {
    texts.forEach((text, i) => {
      docs.push({ name: `${family}:${String(i)}`, format, text });
    });
  };
  add("clean-json", "json", draw(cleanResourceJson(), 101, 150));
  add("messy-json", "json", draw(resourceJson(), 202, 250));
  add("bundle-json", "json", draw(cleanBundleJson({ maxEntries: 4 }), 303, 40));
  add("hostile-json", "json", draw(hostileInput({ format: "json" }), 404, 300));
  add("xml", "xml", draw(resourceXml(), 505, 120));
  add("hostile-xml", "xml", draw(hostileInput({ format: "xml" }), 606, 150));
  return docs;
}

/** Every document in the corpus, in a stable order. */
export function outputCorpus(): OutputDocument[] {
  return [...writtenDocuments(), ...benchDocuments(), ...fixtureDocuments(), ...drawnDocuments()];
}

/** An error as a record: its class, and every field a caller can read off it. */
function errorRecord(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { thrown: String(error) };
  const fields = error as unknown as Record<string, unknown>;
  return {
    thrown: error.name,
    message: error.message,
    code: fields["code"],
    offset: fields["offset"],
    expression: fields["expression"],
    locations: fields["locations"],
  };
}

/** Run `fn`, recording its result through `keep`, or the error it throws. */
function attempt<T>(fn: () => T, keep: (value: T) => unknown): unknown {
  try {
    return keep(fn());
  } catch (error) {
    return errorRecord(error);
  }
}

/** The location a channel called on its own is rooted at, as the safety layer itself roots it. */
const PREFIX = "Root";

/** Everything the validator, the safety layer and the writers make of one model. */
function modelRecord(api: OutputApi, resource: Fhir.FhirComplex): Record<string, unknown> {
  const validation = (options?: Fhir.ValidateOptions): unknown =>
    attempt(
      () => api.validateResource(resource, options),
      (result) => ({
        issues: result.issues,
        valid: result.valid,
        outcome: api.serializeResource(result.toOperationOutcome()),
      }),
    );
  const type = api.resourceType(resource);
  const keep = <T>(value: T): T => value;
  return {
    lenient: validation(),
    strict: validation({ mode: "strict" }),
    safety: attempt(() => api.readSafety(resource), keep),
    summarize: attempt(() => {
      api.assertSafeToSummarize(resource);
      return true;
    }, keep),
    safetyIssues: attempt(() => api.collectSafetyIssues(resource, type ?? ""), keep),
    quantityIssues: attempt(() => api.collectQuantityIssues(resource, type ?? ""), keep),
    channels: {
      modifiers: attempt(() => api.unhandledModifierExtensions(resource, PREFIX), keep),
      modifierElements: attempt(() => api.modifierElements(resource), keep),
      shadowed: attempt(() => api.shadowedProperties(resource, PREFIX), keep),
      arrayWrapped: attempt(() => api.arrayWrappedScalars(resource, PREFIX), keep),
      nested: attempt(() => api.nestedArrays(resource, PREFIX), keep),
      dropped: attempt(() => api.droppedText(resource, PREFIX), keep),
      booleans: attempt(() => api.unreadableBooleans(resource, PREFIX), keep),
      nearMiss: attempt(() => api.nearMissNegationCodes(resource, PREFIX), keep),
      unreadableCodes: attempt(() => api.unreadableNegationCodes(resource, PREFIX), keep),
      absence: attempt(() => api.absenceMarkers(resource, PREFIX), keep),
      absenceUnreadable: attempt(() => api.unreadableAbsenceMarkers(resource, PREFIX), keep),
      absenceConflict: attempt(() => api.conflictingAbsenceMarkers(resource, PREFIX), keep),
    },
    json: attempt(() => api.serializeResource(resource), keep),
    xml: attempt(() => api.serializeResourceXml(resource), keep),
  };
}

/**
 * The record of one document on one tree, as canonical JSON text. A value JSON cannot carry (a
 * function, `undefined`) is dropped the same way on both trees, and a decimal is written as the
 * object it is, its exact text included.
 */
export function recordOf(api: OutputApi, doc: OutputDocument): string {
  const read =
    doc.format === "json"
      ? attempt(
          () => api.parseResource(doc.text),
          (result) => ({ model: result.resource, issues: result.issues }),
        )
      : attempt(
          () => api.parseResourceXml(doc.text),
          (result) => ({ model: result.resource, issues: result.issues }),
        );
  const record: Record<string, unknown> = { read };
  if (doc.format === "json") {
    record["raw"] = attempt(
      () => api.readRawJson(doc.text),
      (tree) => tree,
    );
  }
  const model = (read as { model?: Fhir.FhirComplex }).model;
  if (model !== undefined) record["outputs"] = modelRecord(api, model);
  return JSON.stringify(record);
}

/** The SHA-256 of a record, the form the captured data keeps. */
export function digestOf(record: string): string {
  return createHash("sha256").update(record).digest("hex");
}
