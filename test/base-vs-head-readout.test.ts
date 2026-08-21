/**
 * The base-versus-head READ differential for the JSON read path, run as a test.
 *
 * The two operands are the safety readout the BASE PIN produces for a document and the readout HEAD
 * produces for the same document. Base's half is committed data
 * (`test/__data__/base-readouts.json`), captured by `scripts/capture-base-readouts.ts`, which
 * materializes `src/` at a ref with `git archive` and runs this same corpus through it. Re-run the
 * script at the same base and the file must come back byte-identical; that is what makes the
 * expectation re-derivable rather than hand-written.
 *
 * IT PASSES WHEN THE ONLY DIFFERENCES ARE the modifier-element reports head adds and
 * `safeToSummarize` moving true to false. Everything else is asserted identical, field by field: no
 * finding removed, re-severitied or relocated, `valid` the same everywhere, the negations and the
 * retraction the same, and every other location channel byte-identical, its
 * `unhandledModifierExtensions` included.
 *
 * TWO BARS RUN IN OPPOSITE DIRECTIONS AND BOTH ARE HERE. `safeToSummarize` may never move false to
 * true, which is the fail-safe direction; and it may not move true to false for a document carrying
 * none of the four elements, which is the no-new-false-positives direction. A change that lowered
 * the verdict for some other reason would pass the first and fail the second.
 *
 * WHAT THIS IS NOT. The oracle differential (`scripts/differential.mjs`) compares this package
 * against the reference validator, so the base pin's output is not one of its operands and it
 * cannot answer this question; it is part of the verify surface and is run separately. The XML read
 * path has its own base-versus-head harness (`scripts/read-differential.ts`), which this does not
 * duplicate.
 *
 * The evidence is as strong as the corpus, which is this package's JSON fixtures plus the documents
 * this channel adds. That bound is disclosed rather than implied: broadening the corpus is a
 * separate piece of work.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parseResource, readSafety, validateResource } from "../src/index.js";
import { corpus, readDocument, type Readout, type ReadoutCodec } from "./_readout-corpus.js";

interface CapturedFile {
  readonly base: string;
  readonly documents: Record<string, Readout>;
}

const captured = JSON.parse(
  readFileSync(new URL("./__data__/base-readouts.json", import.meta.url), "utf8"),
) as CapturedFile;

/** Head's own tree, behind the same narrow surface the capture script called base through. */
const HEAD: ReadoutCodec = {
  parseResource: (text) => parseResource(text),
  validateResource: (resource) => validateResource(resource as never),
  readSafety: (resource) => readSafety(resource as never) as unknown as Record<string, unknown>,
};

/** The channels that must be byte-identical between the two trees. */
const IDENTICAL_CHANNELS = [
  "issues",
  "findings",
  "negations",
  "unhandledModifierExtensions",
  "shadowedProperties",
  "arrayWrappedScalars",
  "nestedArrays",
  "droppedText",
  "unreadableBooleans",
  "nearMissNegationCodes",
  "unreadableNegationCodes",
] as const;

describe("base versus head: the read differential over the JSON corpus", () => {
  it("compares the corpus the base capture was taken over, with nothing added or dropped", () => {
    // A fixture added without re-running the capture would otherwise be silently uncompared.
    expect(
      corpus()
        .map((document) => document.name)
        .sort(),
    ).toEqual(Object.keys(captured.documents).sort());
    expect(corpus().length).toBeGreaterThan(30);
  });

  for (const document of corpus()) {
    describe(document.name, () => {
      const base = captured.documents[document.name];
      const head = readDocument(HEAD, document.json);
      const reports = (() => {
        try {
          return readSafety(parseResource(document.json).resource).modifierElements;
        } catch {
          return [];
        }
      })();

      it("reads the same, in every channel but the one this change adds", () => {
        expect(base, "no base capture for this document").toBeDefined();
        const captured2 = base as Readout;
        expect(head.thrown).toEqual(captured2.thrown);
        expect(head.valid).toBe(captured2.valid);
        expect(head.resourceType).toEqual(captured2.resourceType);
        expect(head.status).toEqual(captured2.status);
        expect(head.retracted).toBe(captured2.retracted);
        expect(head.noKnownAllergy).toBe(captured2.noKnownAllergy);
        for (const channel of IDENTICAL_CHANNELS) {
          expect(head[channel], `${channel} moved`).toEqual(captured2[channel] ?? []);
        }
      });

      it("moves safeToSummarize one way only, and only for a document carrying a modifier element", () => {
        const captured2 = base as Readout;
        if (head.safeToSummarize !== captured2.safeToSummarize) {
          // The one permitted direction, and the one permitted cause.
          expect(captured2.safeToSummarize, "safeToSummarize moved false to true").toBe(true);
          expect(head.safeToSummarize).toBe(false);
          expect(
            reports.length,
            "the verdict moved with no modifier element to explain it",
          ).toBeGreaterThan(0);
        } else {
          // No new false positives: a document carrying none of the four reads exactly as it did.
          if (reports.length === 0) expect(head.safeToSummarize).toBe(captured2.safeToSummarize);
        }
      });
    });
  }
});
