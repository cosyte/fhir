/**
 * Read a FHIR R4 JSON resource, keep its exact values, and get a validation verdict.
 *
 * The input is a synthetic blood-pressure Observation, the same document the README's Usage block
 * reads, committed as `test/__fixtures__/first-use/quickstart-observation.json`.
 *
 * Run from the repository root after `pnpm build`:
 *
 *     pnpm tsx examples/read-and-validate.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  parseResource,
  readObservationValue,
  serializeResource,
  validateResource,
} from "@cosyte/fhir";

const text = readFileSync(
  new URL("../test/__fixtures__/first-use/quickstart-observation.json", import.meta.url),
  "utf8",
);

// Reading never throws on a readable document: diagnostics come back beside the model.
const { resource, issues } = parseResource(text);
const readCodes = issues.map((issue) => issue.code);
console.log("Read diagnostics:", readCodes.join(", "));

// value[x] is discriminated before any magnitude is touched, and the magnitude keeps the exact
// lexical form it was written in ("120.0", never the double 120).
const reading = readObservationValue(resource);
console.log("Value type:", reading?.type);
console.log("Magnitude as written:", reading?.quantity?.value?.raw);
console.log("UCUM code:", reading?.quantity?.code);

const verdict = validateResource(resource);
console.log("Valid:", verdict.valid, `(${String(verdict.issues.length)} findings)`);

// The writer emits the model back out; the decimal is still 120.0 on the way out.
const written = serializeResource(resource);
console.log(
  "Written back:",
  written.includes('"value":120.0') ? "value 120.0 kept" : "value changed",
);

assert.deepEqual(readCodes, ["DECIMAL_PRECISION_AT_RISK"]);
assert.equal(reading?.type, "Quantity");
assert.equal(reading.quantity?.value?.raw, "120.0");
assert.equal(reading.quantity.code, "mm[Hg]");
assert.equal(verdict.valid, true);
assert.ok(written.includes('"value":120.0'));
console.log("read-and-validate: ok");
