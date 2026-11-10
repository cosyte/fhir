---
id: stream-ndjson-exports
title: Stream a Bulk Data NDJSON export
sidebar_label: Stream NDJSON exports
description: "Read a Bulk Data NDJSON export one line at a time without loading the file, with a malformed line reported by number and the rest still read."
---

# Stream a Bulk Data NDJSON export

A FHIR Bulk Data export arrives as NDJSON: one resource per line, often far more than fits in memory.
`streamNdjson` reads it as the chunks arrive and yields one record per line. A line that does not
read is reported with its line number, and the stream carries on with the next one.

## Read the export a line at a time

Pass any iterable or async iterable of text or byte chunks: a Node.js stream from
`fs.createReadStream`, the body of a `fetch` response, or a generator. Each record carries its
1-based `line` and either the parsed `resource` or an `error`; a blank line yields nothing:

```ts runnable
import { streamNdjson } from "@cosyte/fhir";

// Three chunks, split mid-line the way a network read splits them. Line 3 is blank, line 4 is broken.
async function* chunks(): AsyncGenerator<string> {
  yield '{"resourceType":"Patient","id":"syn-0001"}\n{"resourceType":"Pat';
  yield 'ient","id":"syn-0002"}\n\n{not json\n';
  yield '{"resourceType":"Patient","id":"syn-0003"}\n';
}

const outcome: string[] = [];
for await (const record of streamNdjson(chunks())) {
  outcome.push(
    record.error === undefined
      ? `line ${String(record.line)}: ${record.resource?.kind ?? "none"}`
      : `line ${String(record.line)}: ${record.error.code}`,
  );
}

outcome; // => ["line 1: complex", "line 2: complex", "line 4: MALFORMED_JSON", "line 5: complex"]
```

From a file, pass `createReadStream(path)` from `node:fs` as the source, and the loop is the same.
The repository's [`examples/bundles-and-ndjson.ts`](https://github.com/cosyte/fhir/blob/main/examples/bundles-and-ndjson.ts)
streams a committed synthetic export that way.

An error carries a code from `NDJSON_ERROR_CODES` and the line number, and never the line's text:
the bytes of a broken line are as likely to be patient data as anything else in the export.

## Bound the memory one line can take

Between chunks the reader holds only the part of the current line that has no newline yet.
`maxLineBytes`, 16 MiB by default, bounds that part: once it passes the bound with no newline in
sight, the line is reported as `LINE_TOO_LONG` and the rest of it is skipped up to the next newline.

```ts runnable
import { streamNdjson } from "@cosyte/fhir";

const long = JSON.stringify({ resourceType: "Patient", id: "x".repeat(200) });
const chunks = [long.slice(0, 120), `${long.slice(120)}\n{"resourceType":"Patient"}\n`];

const codes: string[] = [];
for await (const record of streamNdjson(chunks, { maxLineBytes: 100 })) {
  codes.push(record.error?.code ?? "read");
}

codes; // => ["LINE_TOO_LONG", "read"]
```

## Read a single line

When you split the lines yourself, `parseNdjsonLine` reads one, with the same isolation: it never
throws.

```ts runnable
import { parseNdjsonLine } from "@cosyte/fhir";

parseNdjsonLine('{"resourceType":"Patient","id":"syn-0001"}', 1).resource?.kind; // => "complex"
parseNdjsonLine("{not json", 2).error?.code; // => "MALFORMED_JSON"
```

## Reference

- [`streamNdjson`](./api/README.md#streamndjson), [`NdjsonOptions`](./api/README.md#ndjsonoptions)
  and [`NdjsonRecord`](./api/README.md#ndjsonrecord).
- [`parseNdjsonLine`](./api/README.md#parsendjsonline), [`NdjsonError`](./api/README.md#ndjsonerror)
  and [`NDJSON_ERROR_CODES`](./api/README.md#ndjson_error_codes).
- [Read Bundles and resolve references](./read-bundles-and-references.md) for the resources once
  they are read.
