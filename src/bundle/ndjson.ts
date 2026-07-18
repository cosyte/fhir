/**
 * Bulk Data `application/fhir+ndjson` streaming (Phase 9, the Bulk Data Access IG).
 *
 * A `$export` produces newline-delimited JSON: **one FHIR resource per line**, files that routinely
 * reach gigabytes. Two properties are non-negotiable, and this module is built around them:
 *
 * 1. **No whole-file load.** {@link streamNdjson} consumes an async (or sync) iterable of chunks —
 *    a Node `Readable`, a web `ReadableStream`, a generator — and yields one {@link NdjsonRecord} per
 *    line as the bytes arrive. It buffers only the current partial line, never the file. A single line
 *    that grows past {@link NdjsonOptions.maxLineBytes} without a newline is cut off as a
 *    `LINE_TOO_LONG` record (a defense against an adversarial unterminated line exhausting memory).
 * 2. **Per-line error isolation.** A malformed line (bad JSON, or valid JSON that is not a resource)
 *    yields a record whose `error` is set and whose `resource` is absent — the stream **continues**.
 *    One poisoned line never aborts the export, and the failure is reported by **line number, never
 *    line content** (roadmap §7 — the content could be PHI).
 *
 * Each good line is read through {@link ../codec/read.js parseResource}, so decimal precision and
 * primitive-extension alignment are preserved exactly as for a single resource — NDJSON never routes
 * a value through `JSON.parse` (ADR 0001).
 *
 * @packageDocumentation
 */

import { parseResource, type ReadResult } from "../codec/read.js";
import { readRawJson } from "../codec/raw-json.js";
import { FhirCodecError } from "../codec/issues.js";
import type { FhirComplex } from "../model/index.js";
import type { FhirIssue } from "../codec/issues.js";
import type { RawJson } from "../codec/raw-json.js";

/** Stable, value-free codes for a per-line NDJSON failure. */
export const NDJSON_ERROR_CODES = {
  /** The line is not well-formed JSON. */
  MALFORMED_JSON: "MALFORMED_JSON",
  /** The line is valid JSON but not a resource (not a JSON object at the top level). */
  NOT_A_RESOURCE: "NOT_A_RESOURCE",
  /** The line exceeded {@link NdjsonOptions.maxLineBytes} with no newline — cut off, not buffered. */
  LINE_TOO_LONG: "LINE_TOO_LONG",
} as const;

/** One of the {@link NDJSON_ERROR_CODES}. */
export type NdjsonErrorCode = (typeof NDJSON_ERROR_CODES)[keyof typeof NDJSON_ERROR_CODES];

/** A value-free, isolated failure for a single NDJSON line — carries the line number, never content. */
export interface NdjsonError {
  /** The 1-based line number of the failing line. */
  readonly line: number;
  /** The coded reason. */
  readonly code: NdjsonErrorCode;
  /** A value-free description of the *kind* of failure — never the line's text. */
  readonly message: string;
}

/**
 * One NDJSON line's outcome. Exactly one of `resource` / `error` is present: a good line yields the
 * parsed `resource` (plus any value-free codec `issues`), a bad line yields an isolated `error`.
 */
export interface NdjsonRecord {
  /** The 1-based line number. */
  readonly line: number;
  /** The parsed resource, when the line read cleanly. */
  readonly resource?: FhirComplex;
  /** Value-free codec diagnostics gathered reading the line (e.g. `DECIMAL_PRECISION_AT_RISK`). */
  readonly issues?: readonly FhirIssue[];
  /** The isolated failure, when the line did not read. */
  readonly error?: NdjsonError;
}

/** Options for the NDJSON readers. */
export interface NdjsonOptions {
  /**
   * The maximum bytes a single line may reach before a newline forces a `LINE_TOO_LONG` cut-off
   * (the no-whole-file-load / DoS guard). Default 16 MiB — comfortably above any real resource, far
   * below a memory hazard.
   */
  readonly maxLineBytes?: number;
}

const DEFAULT_MAX_LINE_BYTES = 16 * 1024 * 1024;

const CODE_MESSAGES: Readonly<Record<NdjsonErrorCode, string>> = {
  MALFORMED_JSON: "NDJSON line is not well-formed JSON.",
  NOT_A_RESOURCE: "NDJSON line is valid JSON but not a FHIR resource (not a JSON object).",
  LINE_TOO_LONG: "NDJSON line exceeded the maximum length and was not buffered.",
};

/** Build a value-free {@link NdjsonError}. */
function ndjsonError(line: number, code: NdjsonErrorCode): NdjsonError {
  return { line, code, message: CODE_MESSAGES[code] };
}

/**
 * Parse a single NDJSON line into a {@link NdjsonRecord}, isolating any failure (never throws).
 *
 * The one place read-time exceptions from {@link parseResource} are caught and turned into a
 * value-free per-line `error`, so a caller iterating lines by hand gets the same isolation the
 * streaming reader provides.
 *
 * @param line - The raw line text (without its trailing newline). A blank/whitespace-only line yields
 *   neither a resource nor an error — an empty record — so callers can skip it.
 * @param lineNumber - The 1-based line number to stamp on the record. Defaults to 1.
 * @returns The {@link NdjsonRecord}.
 * @example
 * ```ts
 * import { parseNdjsonLine } from "@cosyte/fhir";
 * parseNdjsonLine('{"resourceType":"Patient","id":"1"}', 1).resource; // the Patient model
 * parseNdjsonLine("{ not json", 2).error?.code;                       // "MALFORMED_JSON"
 * ```
 */
export function parseNdjsonLine(line: string, lineNumber = 1): NdjsonRecord {
  if (line.trim() === "") return { line: lineNumber };

  // Two-step so malformed-JSON and valid-JSON-but-not-a-resource isolate to distinct codes: the raw
  // reader validates JSON well-formedness; the top-level node must then be an object.
  let raw: RawJson;
  try {
    raw = readRawJson(line);
  } catch {
    return { line: lineNumber, error: ndjsonError(lineNumber, NDJSON_ERROR_CODES.MALFORMED_JSON) };
  }
  if (raw.t !== "obj") {
    return { line: lineNumber, error: ndjsonError(lineNumber, NDJSON_ERROR_CODES.NOT_A_RESOURCE) };
  }

  let result: ReadResult;
  try {
    result = parseResource(raw);
  } catch (err) {
    // A structurally-unreadable object (e.g. a broken `_`-sibling alignment) is a JSON object but not
    // a well-formed resource — isolated to this line, never aborting the stream.
    if (err instanceof FhirCodecError) {
      return {
        line: lineNumber,
        error: ndjsonError(lineNumber, NDJSON_ERROR_CODES.NOT_A_RESOURCE),
      };
    }
    throw err;
  }
  return result.issues.length > 0
    ? { line: lineNumber, resource: result.resource, issues: result.issues }
    : { line: lineNumber, resource: result.resource };
}

/** Coerce a chunk to text, decoding bytes as UTF-8 via a streaming decoder. */
function decodeChunk(
  chunk: string | Uint8Array,
  decoder: InstanceType<typeof TextDecoder>,
): string {
  return typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
}

/**
 * Stream `application/fhir+ndjson`, yielding one {@link NdjsonRecord} per line as bytes arrive —
 * **without ever loading the whole file** and with **per-line error isolation**.
 *
 * The source is any (async or sync) iterable of `string` or `Uint8Array` chunks: a Node `Readable`
 * (async-iterable), a web `ReadableStream` via `for await`, or a hand-rolled generator. Lines are
 * split on `\n` (a trailing `\r` is trimmed) as chunks flow; only the current partial line is held.
 * A blank line is skipped. A malformed line yields an `error` record and the stream continues; a line
 * that exceeds `maxLineBytes` before a newline yields a `LINE_TOO_LONG` record and is drained to the
 * next newline rather than buffered.
 *
 * @param source - An (async)iterable of UTF-8 text or byte chunks.
 * @param options - {@link NdjsonOptions}.
 * @returns An async generator of {@link NdjsonRecord}, one per non-blank line, in order.
 * @example
 * ```ts
 * import { streamNdjson } from "@cosyte/fhir";
 * // e.g. a Node Readable from fs.createReadStream(path)
 * for await (const record of streamNdjson(readable)) {
 *   if (record.error) console.warn("bad line", record.error.line); // isolated, stream continues
 *   else handle(record.resource);
 * }
 * ```
 */
export async function* streamNdjson(
  source: AsyncIterable<string | Uint8Array> | Iterable<string | Uint8Array>,
  options: NdjsonOptions = {},
): AsyncGenerator<NdjsonRecord, void, undefined> {
  const maxLineBytes = options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES;
  const decoder = new TextDecoder();
  let buffer = "";
  let lineNumber = 0;
  // While `true`, we are discarding the remainder of an over-long line until the next newline.
  let draining = false;

  const emitLine = function* (line: string): Generator<NdjsonRecord> {
    lineNumber += 1;
    const trimmed = line.endsWith("\r") ? line.slice(0, -1) : line;
    if (trimmed.trim() === "") return; // skip blank lines
    yield parseNdjsonLine(trimmed, lineNumber);
  };

  for await (const chunk of source as AsyncIterable<string | Uint8Array>) {
    buffer += decodeChunk(chunk, decoder);
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      if (draining) {
        // We already emitted LINE_TOO_LONG for this line; this newline ends the drained remainder.
        draining = false;
      } else {
        yield* emitLine(line);
      }
      newlineIndex = buffer.indexOf("\n");
    }
    if (draining) {
      // Still discarding the remainder of an over-long line and this chunk carried no newline (a
      // newline would have ended the drain in the loop above). Drop the buffered remainder so memory
      // stays bounded across arbitrarily many newline-free chunks — the no-whole-file-load guard.
      buffer = "";
    } else if (buffer.length > maxLineBytes) {
      // An unterminated line past the cap is cut off here, not buffered forever, then drained.
      lineNumber += 1;
      yield { line: lineNumber, error: ndjsonError(lineNumber, NDJSON_ERROR_CODES.LINE_TOO_LONG) };
      buffer = "";
      draining = true;
    }
  }

  // Flush any final line with no trailing newline.
  if (!draining && buffer.length > 0) {
    yield* emitLine(buffer);
  }
}
