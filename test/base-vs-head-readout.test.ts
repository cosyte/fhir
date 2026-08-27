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
 * IT PASSES WHEN THE ONLY DIFFERENCE IS THE ONE THE CHANGE UNDER THE PIN IS FOR: a resource type
 * this library treats as SAFETY-CRITICAL gains an element table, so the informational note saying it
 * had none disappears at a root of that type, and findings ABOUT ITS OWN ELEMENTS appear. Everything
 * else is asserted identical, field by field: no finding removed, re-severitied or relocated
 * anywhere, no document of any other type changed at all, the negations and the retraction the same,
 * `safeToSummarize` the same, and every other location channel byte-identical, its
 * `unhandledModifierExtensions` included.
 *
 * TWO BARS RUN IN OPPOSITE DIRECTIONS AND BOTH ARE HERE. A finding may be ADDED freely, which is the
 * whole point of modeling a type; it may never be withdrawn, moved or made less severe, and `valid`
 * may move true to false but NEVER false to true, which is the fail-safe direction. A change that
 * turned an invalid document valid would pass a bare "nothing was added" check and fail this one.
 * NEITHER BAR MOVED WHEN THE ALLOWANCE WIDENED: widening WHICH documents may move is not a licence
 * to change WHAT they may do, and if closing a gap ever seemed to need one of these two relaxed, the
 * thing that is wrong is an element table.
 *
 * THE ALLOWANCE IS NARROW BY CONSTRUCTION AND CANNOT GO STALE UNNOTICED. Its two halves are keyed to
 * `SAFETY_RESOURCE_TYPES`, the set this library already gates on, rather than to a list written down
 * here; that set's size and membership are asserted below, so a type added to it reds this suite
 * instead of silently widening what may move. Both halves are asserted actually exercised: an
 * allowance no document reaches is a hole, not a pass.
 *
 * The previous allowance (a `safeToSummarize` that moved true to false for a document carrying a
 * modifier element) is GONE, and not because it was relaxed: the base was re-captured at the ref
 * that shipped that behaviour, so both trees now carry it and the channel is asserted identical.
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

import {
  parseResource,
  readSafety,
  SAFETY_RESOURCE_TYPES,
  validateResource,
} from "../src/index.js";
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

/**
 * The ONE KIND of finding this change is allowed to remove, spelled exactly as the readout renders
 * it: the informational note that the resource type had no element table, at a ROOT of one of the
 * safety-critical types. Its removal is the point of the change; every other removal is a
 * withdrawal, whatever the type.
 */
function notModeledNoteAt(type: string): string {
  return `RESOURCE_NOT_MODELED/information at ${type}`;
}

/** Every spelling of that note the allowance covers, one per safety-critical type. */
const DECLARED_REMOVALS = new Set([...SAFETY_RESOURCE_TYPES].map(notModeledNoteAt));

/** The location half of a `code/severity at location` readout string. */
function locationOf(finding: string): string {
  const at = finding.lastIndexOf(" at ");
  return at === -1 ? "" : finding.slice(at + " at ".length);
}

/**
 * Multiset difference: the entries of `a` that `b` does not also carry, occurrence by occurrence. A
 * set difference would hide a finding that went from two occurrences to one, which is a removal.
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

/** What moved in the `findings` channel for one document, in both directions. */
function findingDelta(
  base: Readout,
  head: Readout,
): { readonly removed: string[]; readonly added: string[] } {
  return {
    removed: missingFrom(base.findings, head.findings),
    added: missingFrom(head.findings, base.findings),
  };
}

/** Whether the readout is of a document this change is allowed to move at all. */
function isSafetyType(readout: Readout): boolean {
  return readout.resourceType !== undefined && SAFETY_RESOURCE_TYPES.has(readout.resourceType);
}

describe("base versus head: the read differential over the JSON corpus", () => {
  it("keys its allowance to the seven safety-critical types, by the set and not by a list here", () => {
    // If the set ever grows, this reds rather than the allowance quietly widening with it.
    expect(SAFETY_RESOURCE_TYPES.size).toBe(7);
    expect([...SAFETY_RESOURCE_TYPES].sort()).toEqual([
      "AllergyIntolerance",
      "Condition",
      "DiagnosticReport",
      "Immunization",
      "MedicationRequest",
      "MedicationStatement",
      "Observation",
    ]);
    expect(DECLARED_REMOVALS.size).toBe(7);
  });

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

      it("reads the same, in every channel but the one this change adds", () => {
        expect(base, "no base capture for this document").toBeDefined();
        const captured2 = base as Readout;
        expect(head.thrown).toEqual(captured2.thrown);
        expect(head.resourceType).toEqual(captured2.resourceType);
        expect(head.status).toEqual(captured2.status);
        expect(head.retracted).toBe(captured2.retracted);
        expect(head.noKnownAllergy).toBe(captured2.noKnownAllergy);
        expect(head.safeToSummarize, "safeToSummarize moved").toBe(captured2.safeToSummarize);
        for (const channel of IDENTICAL_CHANNELS) {
          expect(head[channel], `${channel} moved`).toEqual(captured2[channel] ?? []);
        }
      });

      it("withdraws no finding, and adds one only about a safety type's own element", () => {
        const captured2 = base as Readout;
        const { removed, added } = findingDelta(captured2, head);

        if (!isSafetyType(head)) {
          // No document of any other type moves at all, in either direction.
          expect(removed, "a finding was withdrawn from a document outside the allowance").toEqual(
            [],
          );
          expect(added, "a finding was added to a document outside the allowance").toEqual([]);
          return;
        }

        // The single declared removal for THIS document's own type, and nothing else. A
        // re-severitied or relocated finding shows up here as a removal beside its replacement, so
        // this arm refuses both. Keyed to `head.resourceType` rather than to the whole set, so a
        // note removed at the wrong root is still a withdrawal.
        const declared = notModeledNoteAt(head.resourceType ?? "");
        expect(DECLARED_REMOVALS.has(declared), "the declared removal is not in the set").toBe(
          true,
        );
        expect(
          removed.filter((finding) => finding !== declared),
          "a finding was removed, re-severitied or relocated",
        ).toEqual([]);
        expect(removed.length, "the declared removal can only occur once").toBeLessThanOrEqual(1);

        // Everything added is about an element OF this resource, never about the resource root and
        // never about another document's element.
        expect(
          added.filter((finding) => !locationOf(finding).startsWith(`${head.resourceType ?? ""}.`)),
          "a finding was added somewhere other than this resource's own element",
        ).toEqual([]);
      });

      it("moves valid one way only, and only with an added finding to explain it", () => {
        const captured2 = base as Readout;
        if (head.valid === captured2.valid) return;
        expect(captured2.valid, "valid moved false to true").toBe(true);
        expect(head.valid).toBe(false);
        expect(isSafetyType(head), "a document outside the allowance changed verdict").toBe(true);
        expect(
          findingDelta(captured2, head).added.length,
          "the verdict moved with no added finding to explain it",
        ).toBeGreaterThan(0);
      });
    });
  }

  describe("the allowance is exercised rather than merely declared", () => {
    const deltas = corpus().map((document) => {
      const base = captured.documents[document.name] as Readout;
      const head = readDocument(HEAD, document.json);
      return { name: document.name, type: head.resourceType, ...findingDelta(base, head) };
    });

    it("removes the informational note at a safety-critical root somewhere in the corpus", () => {
      const removals = deltas.filter((delta) =>
        delta.removed.some((finding) => DECLARED_REMOVALS.has(finding)),
      );
      expect(removals.length, "the declared removal reaches no document").toBeGreaterThan(0);
    });

    it("adds a finding about a safety type's own element somewhere in the corpus", () => {
      const additions = deltas.filter((delta) => delta.added.length > 0);
      expect(additions.length, "the declared addition reaches no document").toBeGreaterThan(0);
    });

    it("removes nothing but that note, anywhere in the corpus", () => {
      const withdrawn = deltas.flatMap((delta) =>
        delta.removed
          .filter((finding) => !DECLARED_REMOVALS.has(finding))
          .map((finding) => `${delta.name}: ${finding}`),
      );
      expect(withdrawn).toEqual([]);
    });

    it("exercises the allowance on the types this change models, not only on the one it had", () => {
      // The widening itself, measured. An allowance keyed to seven types whose corpus only ever
      // reaches one of them is the stale allowance the docblock above warns about, and it would
      // pass every other assertion in this file.
      const reached = new Set(
        deltas
          .filter(
            (delta) =>
              delta.removed.some((finding) => DECLARED_REMOVALS.has(finding)) ||
              delta.added.length > 0,
          )
          .map((delta) => delta.type ?? ""),
      );
      for (const type of reached) expect(SAFETY_RESOURCE_TYPES.has(type), type).toBe(true);
      expect([...reached].sort(), "the corpus reaches these safety types and no others").toEqual(
        [...SAFETY_RESOURCE_TYPES].sort(),
      );
    });
  });
});
