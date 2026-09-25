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
 * IT PASSES WHEN THE ONLY DIFFERENCE IS THE ONE THE CHANGE UNDER THE PIN IS FOR: three more modifier
 * elements R4 defines on the types this library reads a verdict from (`Patient.deceased[x]`,
 * `Patient.link`, `Immunization.isSubpotent`) are reported, `MedicationRequest.intent` is surfaced
 * as its code, and an `intent` this library cannot read is located and refuses. So exactly these
 * may move, and nothing else:
 *
 * - `modifierElements` may GAIN a report whose element is `deceased`, `link` or `isSubpotent`, and
 *   every report base made is still made at head;
 * - `unreadableIntents` may GAIN a location at an `intent` element, and every location base had is
 *   still there;
 * - `intents` may GAIN a surfaced code, one of the eight R4 codes at an `intent` element, and every
 *   pair base surfaced is still surfaced;
 * - `safeToSummarize` may move TRUE TO FALSE, and only on a document whose head readout gained one
 *   of those reports or one of those locations.
 *
 * Everything else is asserted identical, field by field: every validator finding at the same code,
 * severity and location, the parse issues, the negations and the retraction, and every other
 * location channel byte-identical, its `unhandledModifierExtensions` included. This change touches
 * no validator, so the finding list is held IDENTICAL; the two bars below are what no allowance may
 * ever relax, and they grant nothing of their own.
 *
 * TWO BARS RUN IN OPPOSITE DIRECTIONS AND BOTH ARE HERE. A finding may be ADDED freely, which is the
 * whole point of modeling a type; it may never be withdrawn, moved or made less severe, and `valid`
 * may move true to false but NEVER false to true, which is the fail-safe direction. A change that
 * turned an invalid document valid would pass a bare "nothing was added" check and fail this one.
 * NEITHER BAR MOVED WHEN THE ALLOWANCE WIDENED: widening WHICH documents may move is not a licence
 * to change WHAT they may do, and if closing a gap ever seemed to need one of these two relaxed, the
 * thing that is wrong is an element table.
 *
 * EVERY ALLOWANCE IS ASSERTED EXERCISED: an allowance no corpus document reaches is a hole, not a
 * pass. The corpus carries one document per shape the change decides for that reason.
 *
 * The previous allowance (the informational note that a safety-critical type had no element table,
 * removed when the type gained one) is GONE, and not because it was relaxed: the base was
 * re-captured at the ref that shipped that behaviour, so both trees now carry it and the findings
 * are asserted identical.
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

/** The modifier elements this change adds to `modifierElements`, and no other. */
const ADDED_ELEMENTS: ReadonlySet<string> = new Set(["deceased", "link", "isSubpotent"]);

/** The eight R4 4.0.1 `MedicationRequest.intent` codes, the only ones head may surface. */
const INTENT_CODES: ReadonlySet<string> = new Set([
  "proposal",
  "plan",
  "order",
  "original-order",
  "reflex-order",
  "filler-order",
  "instance-order",
  "option",
]);

/** Whether a location names an `intent` element. */
function atIntent(location: string): boolean {
  return location.endsWith(".intent");
}

/**
 * Multiset difference: the entries of `a` that `b` does not also carry, occurrence by occurrence. A
 * set difference would hide an entry that went from two occurrences to one, which is a removal.
 */
function missingFrom(a: readonly string[], b: readonly string[]): string[] {
  const remaining = [...b];
  const out: string[] = [];
  for (const entry of a) {
    const found = remaining.indexOf(entry);
    if (found === -1) out.push(entry);
    else remaining.splice(found, 1);
  }
  return out;
}

/** What moved in one list-valued field, in both directions. */
function delta(
  base: readonly string[],
  head: readonly string[],
): { readonly removed: string[]; readonly added: string[] } {
  return { removed: missingFrom(base, head), added: missingFrom(head, base) };
}

/** A modifier-element report as one comparable string, `element at location`. */
function reportKeys(readout: Readout): string[] {
  return readout.modifierElements.map((report) => `${report.element} at ${report.location}`);
}

/** A surfaced intent as one comparable string, `code at location`. */
function intentKeys(readout: Readout): string[] {
  return readout.intents.map((read) => `${read.code} at ${read.location}`);
}

/** The first word of a `word at location` key. */
function headOf(key: string): string {
  return key.slice(0, key.indexOf(" at "));
}

/** The location half of a `word at location` key. */
function locationOf(key: string): string {
  return key.slice(key.indexOf(" at ") + " at ".length);
}

/** Everything that moved for one document on the fields this change is allowed to move. */
function movement(base: Readout, head: Readout) {
  return {
    reports: delta(reportKeys(base), reportKeys(head)),
    intents: delta(intentKeys(base), intentKeys(head)),
    unreadableIntents: delta(base.unreadableIntents, head.unreadableIntents),
    findings: delta(base.findings, head.findings),
  };
}

describe("AC-14: base versus head, the read differential over the JSON corpus", () => {
  it("AC-14: compares the corpus the base capture was taken over, with nothing added or dropped", () => {
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

      it("AC-14: reads the same in every field this change does not move", () => {
        expect(base, "no base capture for this document").toBeDefined();
        const captured2 = base as Readout;
        expect(head.thrown).toEqual(captured2.thrown);
        expect(head.resourceType).toEqual(captured2.resourceType);
        expect(head.status).toEqual(captured2.status);
        expect(head.retracted).toBe(captured2.retracted);
        expect(head.noKnownAllergy).toBe(captured2.noKnownAllergy);
        for (const channel of IDENTICAL_CHANNELS) {
          expect(head[channel], `${channel} moved`).toEqual(captured2[channel]);
        }
      });

      it("AC-14: withdraws no finding, and moves valid one way only", () => {
        const captured2 = base as Readout;
        const { removed } = delta(captured2.findings, head.findings);
        expect(removed, "a finding was removed, re-severitied or relocated").toEqual([]);
        if (head.valid === captured2.valid) return;
        expect(captured2.valid, "valid moved false to true").toBe(true);
        expect(head.valid).toBe(false);
        expect(
          delta(captured2.findings, head.findings).added.length,
          "the verdict moved with no added finding to explain it",
        ).toBeGreaterThan(0);
      });

      it("AC-14: keeps every report, code and location base made, and adds only the new shapes", () => {
        const moved = movement(base as Readout, head);
        expect(moved.reports.removed, "a modifier-element report was withdrawn").toEqual([]);
        expect(
          moved.reports.added.filter((key) => !ADDED_ELEMENTS.has(headOf(key))),
          "a report was added for an element this change does not add",
        ).toEqual([]);
        expect(
          moved.unreadableIntents.removed,
          "an unreadable-intent location was withdrawn",
        ).toEqual([]);
        expect(
          moved.unreadableIntents.added.filter((location) => !atIntent(location)),
          "an unreadable-intent location was added somewhere other than an intent element",
        ).toEqual([]);
        expect(moved.intents.removed, "a surfaced intent was withdrawn").toEqual([]);
        expect(
          moved.intents.added.filter(
            (key) => !INTENT_CODES.has(headOf(key)) || !atIntent(locationOf(key)),
          ),
          "an intent was surfaced that is not one of the eight codes at an intent element",
        ).toEqual([]);
      });

      it("AC-14: moves safeToSummarize true to false only, and only with a new report or location", () => {
        const captured2 = base as Readout;
        if (head.safeToSummarize === captured2.safeToSummarize) return;
        expect(captured2.safeToSummarize, "safeToSummarize moved false to true").toBe(true);
        expect(head.safeToSummarize).toBe(false);
        const moved = movement(captured2, head);
        expect(
          moved.reports.added.length + moved.unreadableIntents.added.length,
          "safeToSummarize moved with no added report or unreadable-intent location to explain it",
        ).toBeGreaterThan(0);
      });
    });
  }

  describe("AC-14: every allowance is exercised rather than merely declared", () => {
    const moves = corpus().map((document) => {
      const base = captured.documents[document.name] as Readout;
      const head = readDocument(HEAD, document.json);
      return { name: document.name, base, head, ...movement(base, head) };
    });

    it("AC-14: adds a report for each of deceased, link and isSubpotent somewhere in the corpus", () => {
      const reached = new Set(moves.flatMap((move) => move.reports.added.map(headOf)));
      expect([...reached].sort()).toEqual([...ADDED_ELEMENTS].sort());
    });

    it("AC-14: adds an unreadable-intent location somewhere in the corpus", () => {
      expect(
        moves.filter((move) => move.unreadableIntents.added.length > 0).length,
      ).toBeGreaterThan(0);
    });

    it("AC-14: surfaces an intent code somewhere in the corpus", () => {
      expect(moves.filter((move) => move.intents.added.length > 0).length).toBeGreaterThan(0);
    });

    it("AC-14: moves safeToSummarize true to false somewhere in the corpus", () => {
      expect(
        moves.filter((move) => move.base.safeToSummarize && !move.head.safeToSummarize).length,
      ).toBeGreaterThan(0);
    });

    it("AC-14: removes and adds no finding anywhere in the corpus", () => {
      const moved = moves.flatMap((move) => [
        ...move.findings.removed.map((finding) => `${move.name}: removed ${finding}`),
        ...move.findings.added.map((finding) => `${move.name}: added ${finding}`),
      ]);
      expect(moved).toEqual([]);
    });
  });
});
