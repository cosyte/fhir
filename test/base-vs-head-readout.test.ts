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
 * IT PASSES WHEN THE ONLY DIFFERENCE IS THE ONE THE CHANGE UNDER THE PIN IS FOR: `use` on an
 * Identifier, a HumanName, an Address or a ContactPoint is surfaced as its code at the covered
 * positions of the eight modeled resource types, and a `use` this library cannot read as a code of
 * its position's value set is located and refuses. So exactly these may move, and nothing else:
 *
 * - `datatypeUses` may GAIN an entry, and only one whose code is one of the twelve R4 4.0.1 codes
 *   the four value sets hold between them, at a location naming a `use` element;
 * - `unreadableDatatypeUses` may GAIN a location, and only one naming a `use` element;
 * - `safeToSummarize` may move TRUE TO FALSE, and only on a document whose head readout gained an
 *   unreadable-use location. A readable `use` never moves it.
 *
 * Everything else is asserted identical, field by field: the throw, the parse issues, every
 * validator finding at the same code, severity and location and so `valid`, the negations, the
 * convenience fields (`resourceType`, `status`, `retracted`, `noKnownAllergy`), and every other
 * location channel byte-identical, `modifierElements`, `intents`, `unreadableIntents` and
 * `unhandledModifierExtensions` included. This change touches no validator and does not move what
 * `modifierElements` reports for any document (`Practitioner.identifier.use` keeps its presence
 * rule), so those are held IDENTICAL rather than allowed to grow.
 *
 * TWO BARS RUN IN OPPOSITE DIRECTIONS AND BOTH ARE STILL HERE, though with the finding list held
 * identical they can no longer fire on their own: a finding may never be withdrawn, moved or made
 * less severe, and `valid` may never move false to true, which is the fail-safe direction. They grant
 * nothing and no allowance relaxes them.
 *
 * EVERY ALLOWANCE IS ASSERTED EXERCISED: an allowance no corpus document reaches is a hole, not a
 * pass. The corpus carries one document per shape the change decides for that reason.
 *
 * The previous allowance set (three modifier elements added to `modifierElements`, and
 * `MedicationRequest.intent` surfaced and located) is GONE, and not because it was relaxed: the base
 * was re-captured at the ref that shipped that behaviour, so both trees now carry it and those
 * channels are asserted identical.
 *
 * WHAT THIS IS NOT. The oracle differential (`scripts/differential.mjs`) compares this package
 * against the reference validator, so the base pin's output is not one of its operands and it
 * cannot answer this question; it is part of the verify surface and is run separately. The XML read
 * path has its own base-versus-head harness (`scripts/read-differential.ts`), which this does not
 * duplicate.
 *
 * The evidence is as strong as the corpus, which is this package's JSON fixtures plus the documents
 * the readout channels add. That bound is disclosed rather than implied: broadening the corpus is a
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

/** The pin the base half was captured at, named by AC-10. */
const BASE_PIN = "e3dc1fab818fec45b4ec71fceb661e8e8c712885";

/** Head's own tree, behind the same narrow surface the capture script called base through. */
const HEAD: ReadoutCodec = {
  parseResource: (text) => parseResource(text),
  validateResource: (resource) => validateResource(resource as never),
  readSafety: (resource) => readSafety(resource as never) as unknown as Record<string, unknown>,
};

/** The channels that must be byte-identical between the two trees. */
const IDENTICAL_CHANNELS = [
  "thrown",
  "issues",
  "valid",
  "findings",
  "resourceType",
  "status",
  "retracted",
  "noKnownAllergy",
  "negations",
  "unhandledModifierExtensions",
  "modifierElements",
  "intents",
  "shadowedProperties",
  "arrayWrappedScalars",
  "nestedArrays",
  "droppedText",
  "unreadableBooleans",
  "nearMissNegationCodes",
  "unreadableNegationCodes",
  "unreadableIntents",
] as const;

/** The twelve codes the four R4 4.0.1 `use` value sets hold between them, the only ones head may surface. */
const USE_CODES: ReadonlySet<string> = new Set([
  "usual",
  "official",
  "temp",
  "secondary",
  "old",
  "nickname",
  "anonymous",
  "maiden",
  "home",
  "work",
  "billing",
  "mobile",
]);

/** Whether a location names a `use` element. */
function atUse(location: string): boolean {
  return location.endsWith(".use");
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

/** A surfaced `use` as one comparable string, `code at location`. */
function useKeys(readout: Readout): string[] {
  return readout.datatypeUses.map((read) => `${read.code} at ${read.location}`);
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
    uses: delta(useKeys(base), useKeys(head)),
    unreadableUses: delta(base.unreadableDatatypeUses, head.unreadableDatatypeUses),
    findings: delta(base.findings, head.findings),
  };
}

describe("AC-10: base versus head, the read differential over the JSON corpus", () => {
  it("AC-10: compares the corpus the base capture was taken over, at the named pin", () => {
    // A fixture added without re-running the capture would otherwise be silently uncompared.
    expect(captured.base).toBe(BASE_PIN);
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

      it("AC-10: reads the same in every field this change does not move", () => {
        expect(base, "no base capture for this document").toBeDefined();
        const captured2 = base as Readout;
        for (const channel of IDENTICAL_CHANNELS) {
          expect(head[channel], `${channel} moved`).toEqual(captured2[channel]);
        }
      });

      it("AC-10: withdraws no finding, and moves valid one way only", () => {
        const captured2 = base as Readout;
        const { removed } = delta(captured2.findings, head.findings);
        expect(removed, "a finding was removed, re-severitied or relocated").toEqual([]);
        if (head.valid === captured2.valid) return;
        expect(captured2.valid, "valid moved false to true").toBe(true);
      });

      it("AC-10: keeps every code and location base made, and adds only the allowed shapes", () => {
        const moved = movement(base as Readout, head);
        expect(moved.uses.removed, "a surfaced use was withdrawn").toEqual([]);
        expect(
          moved.uses.added.filter((key) => !USE_CODES.has(headOf(key)) || !atUse(locationOf(key))),
          "a use was surfaced that is not one of the twelve codes at a use element",
        ).toEqual([]);
        expect(moved.unreadableUses.removed, "an unreadable-use location was withdrawn").toEqual(
          [],
        );
        expect(
          moved.unreadableUses.added.filter((location) => !atUse(location)),
          "an unreadable-use location was added somewhere other than a use element",
        ).toEqual([]);
      });

      it("AC-10: moves safeToSummarize true to false only, and only with a new unreadable use", () => {
        const captured2 = base as Readout;
        if (head.safeToSummarize === captured2.safeToSummarize) return;
        expect(captured2.safeToSummarize, "safeToSummarize moved false to true").toBe(true);
        expect(head.safeToSummarize).toBe(false);
        expect(
          movement(captured2, head).unreadableUses.added.length,
          "safeToSummarize moved with no added unreadable-use location to explain it",
        ).toBeGreaterThan(0);
      });
    });
  }

  describe("AC-10: every allowance is exercised rather than merely declared", () => {
    const moves = corpus().map((document) => {
      const base = captured.documents[document.name] as Readout;
      const head = readDocument(HEAD, document.json);
      return { name: document.name, base, head, ...movement(base, head) };
    });

    it("AC-10: surfaces a use code somewhere in the corpus", () => {
      expect(moves.filter((move) => move.uses.added.length > 0).length).toBeGreaterThan(0);
    });

    it("AC-10: adds an unreadable-use location somewhere in the corpus", () => {
      expect(moves.filter((move) => move.unreadableUses.added.length > 0).length).toBeGreaterThan(
        0,
      );
    });

    it("AC-10: moves safeToSummarize true to false somewhere in the corpus", () => {
      expect(
        moves.filter((move) => move.base.safeToSummarize && !move.head.safeToSummarize).length,
      ).toBeGreaterThan(0);
    });

    it("AC-10: removes and adds no finding anywhere in the corpus", () => {
      const moved = moves.flatMap((move) => [
        ...move.findings.removed.map((finding) => `${move.name}: removed ${finding}`),
        ...move.findings.added.map((finding) => `${move.name}: added ${finding}`),
      ]);
      expect(moved).toEqual([]);
    });
  });
});
