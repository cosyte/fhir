/**
 * Decide whether a resource is safe to summarize before rolling it into a list, a card or a feed.
 *
 * `readSafety` surfaces every status and negation that changes what a record means, and
 * `assertSafeToSummarize` refuses a resource carrying something this library cannot interpret,
 * such as a `modifierExtension` it does not know. Every input is a synthetic test fixture from
 * `test/__fixtures__/`.
 *
 * Run from the repository root after `pnpm build`:
 *
 *     pnpm tsx examples/safe-to-summarize.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { assertSafeToSummarize, FhirSafetyError, parseResource, readSafety } from "@cosyte/fhir";

const fixture = (name: string): string =>
  readFileSync(new URL(`../test/__fixtures__/${name}`, import.meta.url), "utf8");

// Three records whose meaning is carried by a negation, not by their codes alone.
const negated = [
  { file: "allergy-refuted.json", expected: ["refuted"] },
  { file: "immunization-not-done.json", expected: ["not-done"] },
  { file: "medicationrequest-donotperform.json", expected: ["do-not-perform"] },
];

for (const { file, expected } of negated) {
  const safety = readSafety(parseResource(fixture(file)).resource);
  console.log(
    `${file}: negations ${JSON.stringify(safety.negations)}, safe to summarize ${String(safety.safeToSummarize)}`,
  );
  // A negation is read, never dropped: a summary that shows these codes must show the negation too.
  assert.deepEqual(safety.negations, expected);
  assert.equal(safety.safeToSummarize, true);
}

// An Observation carrying a modifierExtension nobody defined for it. Its meaning cannot be known,
// so the readout says it is not safe, and the assertion refuses it, naming where, never the value.
const unknown = parseResource(fixture("unknown-modifier.json")).resource;
const readout = readSafety(unknown);
console.log("unknown-modifier.json: safe to summarize", readout.safeToSummarize);
assert.equal(readout.safeToSummarize, false);
assert.deepEqual(readout.unhandledModifierExtensions, ["Observation.modifierExtension[0]"]);

let refusedAt: readonly string[] = [];
try {
  assertSafeToSummarize(unknown);
} catch (error) {
  if (!(error instanceof FhirSafetyError)) throw error;
  refusedAt = error.locations;
}
console.log("assertSafeToSummarize refused at:", refusedAt.join(", "));
assert.deepEqual(refusedAt, ["Observation.modifierExtension[0]"]);
console.log("safe-to-summarize: ok");
