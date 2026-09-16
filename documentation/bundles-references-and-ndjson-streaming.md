# Bundles, references, and Bulk NDJSON streaming

Part of the capability readout for `@cosyte/fhir`, linked from the README.

Read a `Bundle` into an explicit readout with the one semantic distinction a consumer must never blur
(**`transaction` is all-or-nothing, `batch` is independent**), resolve the references inside it with a
**DoS-safe cycle guard**, and stream a Bulk Data `$export` line by line with **per-line error isolation
and no whole-file load**. The Bundle _artifact_ and its semantics are modeled; a transaction is **never
executed** (there is no server here).

- **`readBundle` / `entryProcessing` / `isAtomicBundle`**: the `Bundle.type` (`BUNDLE_TYPES`) and its
  entry-processing contract: `transaction` → `"atomic"` (all-or-nothing), `batch` → `"independent"`,
  everything else → `"none"`. `Bundle.total` is a lexical string, never a JS `number`.
- **`resolveReference` / `buildBundleIndex` / `containedIndex`**: resolve relative / absolute /
  logical / `#fragment` references against a Bundle + `contained` closure. A local miss is
  `"unresolved"` (flagged, preserved); an external target is `"external"` (never false-flagged).
- **`hasContainedCycle` / `MAX_REFERENCE_DEPTH`**, a bounded, iterative (heap-based) cycle guard: a
  `contained` reference cycle is **detected and reported, never followed**: no infinite loop, no stack
  blow-up, no false positive on a legitimate DAG.
- **`streamNdjson` / `parseNdjsonLine`**: a streaming `application/fhir+ndjson` reader over any chunk
  iterable, one resource per line, each read through the precision-preserving codec (a decimal never
  through a `number`). A malformed line is isolated (reported by **line number, never content**), the
  stream continues, and memory stays bounded (`LINE_TOO_LONG`).
- **New findings** (in `validateResource` for a `Bundle`): `REFERENCE_UNRESOLVED` (warning, preserved),
  `CONTAINED_CYCLE` (error), `FULLURL_ID_MISMATCH` (error: a `urn:uuid` fullUrl is exempt). All
  value-free (a FHIRPath location, never a value, reference, or id).

```ts
import { parseResource, readBundle, validateResource, streamNdjson } from "@cosyte/fhir";

const { resource } = parseResource(
  '{"resourceType":"Bundle","type":"transaction","entry":[' +
    '{"fullUrl":"urn:uuid:1","resource":{"resourceType":"Patient","id":"1"},' +
    '"request":{"method":"POST","url":"Patient"}}]}',
);

readBundle(resource).atomic; // true: a transaction is all-or-nothing (a batch would be false)

// A contained reference cycle is a bounded, typed finding, never an infinite loop:
const { issues } = validateResource(
  parseResource(
    '{"resourceType":"Bundle","type":"collection","entry":[{"resource":' +
      '{"resourceType":"Observation","id":"o","contained":[' +
      '{"resourceType":"Observation","id":"a","hasMember":[{"reference":"#b"}]},' +
      '{"resourceType":"Observation","id":"b","hasMember":[{"reference":"#a"}]}]}}]}',
  ).resource,
);
issues.some((i) => i.code === "CONTAINED_CYCLE"); // true

// Stream a Bulk NDJSON export without loading the file; a bad line is isolated, not fatal:
for await (const record of streamNdjson(readableChunks)) {
  if (record.error)
    console.warn("bad line", record.error.line); // line number, never content
  else handle(record.resource);
}
```
