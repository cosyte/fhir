/**
 * Read Bundles, resolve the references inside one, and stream a Bulk Data NDJSON export.
 *
 * A `transaction` is all-or-nothing and a `batch` is independent; the readout says which, and
 * nothing is executed. A reference resolves inside the Bundle, stays unresolved (and is flagged)
 * when it names a resource the Bundle does not carry, or is external. The NDJSON reader isolates
 * a bad line by its line number and keeps going. Every input is a synthetic test fixture from
 * `test/__fixtures__/`.
 *
 * Run from the repository root after `pnpm build`:
 *
 *     pnpm tsx examples/bundles-and-ndjson.ts
 */

import assert from "node:assert/strict";
import { createReadStream, readFileSync } from "node:fs";

import {
  buildBundleIndex,
  parseResource,
  readBundle,
  resolveReference,
  streamNdjson,
  validateResource,
} from "@cosyte/fhir";

const fixtureUrl = (name: string): URL => new URL(`../test/__fixtures__/${name}`, import.meta.url);
const read = (name: string) => parseResource(readFileSync(fixtureUrl(name), "utf8")).resource;

const transaction = readBundle(read("bundle-transaction.json"));
const batch = readBundle(read("bundle-batch.json"));
console.log(
  `transaction: processing ${transaction.processing}, atomic ${String(transaction.atomic)}`,
);
console.log(`batch: processing ${batch.processing}, atomic ${String(batch.atomic)}`);

// References inside a collection Bundle: one resolves, one names an entry that is not there, and
// one points outside the Bundle.
const collection = read("bundle.json");
const index = buildBundleIndex(collection);
const statuses = ["Patient/1", "Organization/2", "https://other.example/fhir/Patient/9"].map(
  (reference) => `${reference} -> ${resolveReference(reference, { bundle: index }).status}`,
);
console.log(statuses.join("\n"));

// Validation reports the dangling reference by location, never by value.
const dangling = validateResource(collection)
  .issues.filter((issue) => issue.code === "REFERENCE_UNRESOLVED")
  .map((issue) => issue.expression);
console.log("Unresolved reference at:", dangling.join(", "));

// Stream the export a chunk at a time: the malformed line is reported by number and skipped.
const lines: string[] = [];
for await (const record of streamNdjson(createReadStream(fixtureUrl("export.ndjson")))) {
  lines.push(
    record.error
      ? `line ${String(record.line)}: ${record.error.code}`
      : `line ${String(record.line)}: ok`,
  );
}
console.log(lines.join("\n"));

assert.equal(transaction.atomic, true);
assert.equal(transaction.processing, "atomic");
assert.equal(batch.atomic, false);
assert.equal(batch.processing, "independent");
assert.deepEqual(statuses, [
  "Patient/1 -> resolved",
  "Organization/2 -> unresolved",
  "https://other.example/fhir/Patient/9 -> external",
]);
assert.deepEqual(dangling, ["Bundle.entry[0].resource.managingOrganization.reference"]);
assert.deepEqual(lines, ["line 1: ok", "line 2: ok", "line 4: MALFORMED_JSON", "line 5: ok"]);
console.log("bundles-and-ndjson: ok");
