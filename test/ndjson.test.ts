import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  FhirDecimal,
  NDJSON_ERROR_CODES,
  getProperty,
  isComplex,
  isPrimitive,
  parseNdjsonLine,
  streamNdjson,
  type NdjsonRecord,
} from "../src/index.js";
import { nth } from "./_util.js";

function fixture(name: string): string {
  return readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");
}

/** Collect an async generator into an array. */
async function collect(source: AsyncGenerator<NdjsonRecord>): Promise<NdjsonRecord[]> {
  const out: NdjsonRecord[] = [];
  for await (const record of source) out.push(record);
  return out;
}

/** An async iterable over the given chunks. */
async function* asyncChunks(
  chunks: readonly (string | Uint8Array)[],
): AsyncGenerator<string | Uint8Array> {
  await Promise.resolve();
  for (const chunk of chunks) yield chunk;
}

describe("parseNdjsonLine: one line, isolated", () => {
  it("reads a good line into a resource", () => {
    const record = parseNdjsonLine('{"resourceType":"Patient","id":"1"}', 1);
    expect(record.line).toBe(1);
    expect(record.error).toBeUndefined();
    expect(record.resource && isComplex(record.resource)).toBe(true);
  });

  it("a blank / whitespace-only line yields an empty record (no resource, no error)", () => {
    const record = parseNdjsonLine("   ", 5);
    expect(record.line).toBe(5);
    expect(record.resource).toBeUndefined();
    expect(record.error).toBeUndefined();
  });

  it("isolates malformed JSON as MALFORMED_JSON", () => {
    const record = parseNdjsonLine("{ not json", 2);
    expect(record.resource).toBeUndefined();
    expect(record.error?.code).toBe(NDJSON_ERROR_CODES.MALFORMED_JSON);
    expect(record.error?.line).toBe(2);
    // Value-free: the message never echoes the line content.
    expect(record.error?.message).not.toContain("not json");
  });

  it("isolates valid-JSON-but-not-a-resource as NOT_A_RESOURCE", () => {
    expect(parseNdjsonLine("[1,2,3]", 1).error?.code).toBe(NDJSON_ERROR_CODES.NOT_A_RESOURCE);
    expect(parseNdjsonLine("42", 1).error?.code).toBe(NDJSON_ERROR_CODES.NOT_A_RESOURCE);
    expect(parseNdjsonLine('"a string"', 1).error?.code).toBe(NDJSON_ERROR_CODES.NOT_A_RESOURCE);
  });

  it("isolates a structurally-unreadable object (broken _-alignment) as NOT_A_RESOURCE", () => {
    const record = parseNdjsonLine('{"resourceType":"Patient","given":["a"],"_given":[{},{}]}', 3);
    expect(record.resource).toBeUndefined();
    expect(record.error?.code).toBe(NDJSON_ERROR_CODES.NOT_A_RESOURCE);
  });

  it("preserves decimal precision (never via JSON.parse) and surfaces codec issues", () => {
    const record = parseNdjsonLine(
      '{"resourceType":"Observation","valueQuantity":{"value":0.010}}',
      1,
    );
    expect(record.issues?.some((i) => i.code === "DECIMAL_PRECISION_AT_RISK")).toBe(true);
    const vq = record.resource && getProperty(record.resource, "valueQuantity");
    const value = vq && isComplex(vq) ? getProperty(vq, "value") : undefined;
    expect(value && isPrimitive(value) && value.value).toBeInstanceOf(FhirDecimal);
    expect(value && isPrimitive(value) ? String(value.value) : "").toBe("0.010");
  });
});

describe("streamNdjson: streaming, per-line isolation, no whole-file load", () => {
  it("streams the export fixture: good resources, a skipped blank, an isolated bad line", async () => {
    const text = fixture("export.ndjson");
    const records = await collect(streamNdjson(asyncChunks([text])));
    // 3 good resources + 1 error; the blank line yields nothing.
    const resources = records.filter((r) => r.resource !== undefined);
    const errors = records.filter((r) => r.error !== undefined);
    expect(resources).toHaveLength(3);
    expect(errors).toHaveLength(1);
    expect(nth(errors, 0).error?.code).toBe(NDJSON_ERROR_CODES.MALFORMED_JSON);
    // The malformed line is line 4 (line 3 was blank and skipped but still counted).
    expect(nth(errors, 0).line).toBe(4);
    // The stream did not abort, the resource after the bad line still arrived.
    expect(nth(resources, 2).line).toBe(5);
  });

  it("reassembles lines split across byte-chunk boundaries", async () => {
    const line = '{"resourceType":"Patient","id":"split"}\n';
    const bytes = new TextEncoder().encode(line);
    // Split the bytes into single-byte chunks to force cross-chunk reassembly.
    const chunks = Array.from(bytes, (b) => Uint8Array.of(b));
    const records = await collect(streamNdjson(asyncChunks(chunks)));
    expect(records).toHaveLength(1);
    const r0 = nth(records, 0).resource;
    expect(r0 !== undefined && isComplex(r0)).toBe(true);
  });

  it("trims a trailing \\r (CRLF line endings)", async () => {
    const records = await collect(
      streamNdjson(asyncChunks(['{"resourceType":"Patient","id":"1"}\r\n'])),
    );
    expect(records).toHaveLength(1);
    expect(nth(records, 0).error).toBeUndefined();
    expect(nth(records, 0).resource).toBeDefined();
  });

  it("flushes a final line with no trailing newline", async () => {
    const records = await collect(
      streamNdjson(asyncChunks(['{"resourceType":"Patient","id":"1"}'])),
    );
    expect(records).toHaveLength(1);
    expect(nth(records, 0).resource).toBeDefined();
  });

  it("accepts a plain (sync) iterable of chunks", async () => {
    const records = await collect(
      streamNdjson([
        '{"resourceType":"Patient","id":"1"}\n',
        '{"resourceType":"Patient","id":"2"}\n',
      ]),
    );
    expect(records).toHaveLength(2);
    expect(nth(records, 1).line).toBe(2);
  });

  it("cuts off an over-long unterminated line as LINE_TOO_LONG and resyncs (no OOM)", async () => {
    const longLine = "x".repeat(50); // no newline, exceeds the tiny cap below
    const records = await collect(
      streamNdjson(asyncChunks([longLine, '\n{"resourceType":"Patient","id":"after"}\n']), {
        maxLineBytes: 10,
      }),
    );
    const errors = records.filter((r) => r.error !== undefined);
    const resources = records.filter((r) => r.resource !== undefined);
    expect(nth(errors, 0).error?.code).toBe(NDJSON_ERROR_CODES.LINE_TOO_LONG);
    // The stream recovered: the well-formed line after the drained remainder still parsed.
    expect(resources).toHaveLength(1);
  });

  it("keeps memory bounded while draining an over-long line delivered as many newline-free chunks", async () => {
    // The over-long line's remainder arrives as several chunks with NO newline among them, then a
    // newline ends it and a good line follows. The buffer must not accumulate across the drain.
    const chunks = [
      "x".repeat(50),
      "y".repeat(50),
      "z".repeat(50),
      '\n{"resourceType":"Patient","id":"after"}\n',
    ];
    const records = await collect(streamNdjson(asyncChunks(chunks), { maxLineBytes: 10 }));
    const errors = records.filter((r) => r.error !== undefined);
    const resources = records.filter((r) => r.resource !== undefined);
    // Exactly one LINE_TOO_LONG (not one per chunk), and the stream resynced to the good line.
    expect(errors).toHaveLength(1);
    expect(nth(errors, 0).error?.code).toBe(NDJSON_ERROR_CODES.LINE_TOO_LONG);
    expect(resources).toHaveLength(1);
    const after = nth(resources, 0).resource;
    expect(after !== undefined && isComplex(after)).toBe(true);
  });

  it("an empty source yields no records", async () => {
    const records = await collect(streamNdjson(asyncChunks([])));
    expect(records).toHaveLength(0);
  });
});
