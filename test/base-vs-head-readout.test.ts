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
 * IT PASSES WHEN THE ONLY DIFFERENCE IS THE ONE THE CHANGE UNDER THE PIN IS FOR: the error-severity
 * constraints R4 4.0.1 declares on the eight modeled types and on their DomainResource, Element and
 * Extension base are evaluated with no profile supplied. So exactly these may move, and nothing
 * else:
 *
 * - the validator's findings may GAIN an `INVARIANT_VIOLATED` or an `INVARIANT_UNCHECKED`, and only
 *   one carrying one of the 19 constraint keys, at that key's R4 severity for a violation and at
 *   `information` for an unchecked one;
 * - `valid` may move TRUE TO FALSE, and only on a document that gained such a violation.
 *
 * Everything else is asserted identical, field by field: the throw, the parse issues, the
 * negations, the convenience fields (`resourceType`, `status`, `retracted`, `noKnownAllergy`),
 * `safeToSummarize`, and every location channel byte-identical, `modifierElements`, `intents`,
 * `datatypeUses` and their unreadable twins included. This change touches no readout channel.
 *
 * TWO BARS RUN IN OPPOSITE DIRECTIONS AND BOTH ARE STILL HERE: a finding may never be withdrawn,
 * moved or made less severe, and `valid` may never move false to true, which is the fail-safe
 * direction. They grant nothing and no allowance relaxes them.
 *
 * THE ADDED FINDINGS ARE WRITTEN OUT IN FULL below (`ADDED_FINDINGS`), so an addition nobody listed
 * fails, and so does a listed one that stopped happening. EVERY ALLOWANCE IS ASSERTED EXERCISED: an
 * allowance no corpus document reaches is a hole, not a pass. The corpus carries one document per
 * key the change decides for that reason.
 *
 * The previous allowance set (`use` surfaced on four datatypes, and the unreadable-`use` refusal)
 * is GONE, and not because it was relaxed: the base was re-captured at the ref that shipped that
 * behaviour, so both trees now carry it and those channels are asserted identical.
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

/** The pin the base half was captured at, named by AC-13. */
const BASE_PIN = "8330359c1345d8f55dae5852f41385260fb08803";

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
  "resourceType",
  "status",
  "retracted",
  "noKnownAllergy",
  "negations",
  "safeToSummarize",
  "unhandledModifierExtensions",
  "modifierElements",
  "intents",
  "datatypeUses",
  "shadowedProperties",
  "arrayWrappedScalars",
  "nestedArrays",
  "droppedText",
  "unreadableBooleans",
  "nearMissNegationCodes",
  "unreadableNegationCodes",
  "unreadableIntents",
  "unreadableDatatypeUses",
] as const;

/** The 19 constraint keys and the severity R4 4.0.1 declares for each. */
const KEY_SEVERITY: Readonly<Record<string, "error" | "warning">> = {
  "ait-1": "error",
  "ait-2": "error",
  "con-1": "error",
  "con-2": "error",
  "con-3": "warning",
  "con-4": "error",
  "con-5": "error",
  "dom-2": "error",
  "dom-3": "error",
  "dom-4": "error",
  "dom-5": "error",
  "dom-6": "warning",
  "ele-1": "error",
  "ext-1": "error",
  "imm-1": "error",
  "obs-3": "error",
  "obs-6": "error",
  "obs-7": "error",
  "pat-1": "error",
};

/** The keys AC-3 and AC-6 name, each of which the corpus must reach with a violation. */
const DECIDED_KEYS = [
  "pat-1",
  "obs-3",
  "con-1",
  "con-2",
  "imm-1",
  "dom-2",
  "dom-4",
  "dom-5",
  "ext-1",
  "ele-1",
] as const;

/**
 * Every finding head adds over base, `document: finding`, in corpus order. Written out rather than
 * derived, so an addition that is not listed here fails, and a listed one that stops happening
 * fails too.
 */
const ADDED_FINDINGS: readonly string[] = [
  "fixture:extension-only-list.json: INVARIANT_VIOLATED/error at Patient.name[0].given[1] for ele-1",
  "added:modifier-extension-only: INVARIANT_VIOLATED/error at Patient.modifierExtension[0] for ext-1",
  "added:patient-contained-practitioner-identifier-use: INVARIANT_UNCHECKED/information at Patient for dom-3",
  "added:patient-contained-organization-use: INVARIANT_UNCHECKED/information at Patient for dom-3",
  "added:base-pat-1-contact-without-contact-detail: INVARIANT_VIOLATED/error at Patient.contact[0] for pat-1",
  "added:base-obs-3-reference-range-without-bound: INVARIANT_VIOLATED/error at Observation.referenceRange[0] for obs-3",
  "added:base-con-1-stage-without-summary: INVARIANT_VIOLATED/error at Condition.stage[0] for con-1",
  "added:base-con-2-evidence-without-code-or-detail: INVARIANT_VIOLATED/error at Condition.evidence[0] for con-2",
  "added:base-imm-1-education-without-document: INVARIANT_VIOLATED/error at Immunization.education[0] for imm-1",
  "added:base-dom-2-nested-contained: INVARIANT_UNCHECKED/information at Patient for dom-3",
  "added:base-dom-2-nested-contained: INVARIANT_VIOLATED/error at Patient for dom-2",
  "added:base-dom-4-contained-version: INVARIANT_UNCHECKED/information at Patient for dom-3",
  "added:base-dom-4-contained-version: INVARIANT_VIOLATED/error at Patient for dom-4",
  "added:base-dom-5-contained-security: INVARIANT_UNCHECKED/information at Patient for dom-3",
  "added:base-dom-5-contained-security: INVARIANT_VIOLATED/error at Patient for dom-5",
  "added:base-ext-1-extension-without-value: INVARIANT_VIOLATED/error at Patient.extension[0] for ext-1",
  "added:base-ext-1-extension-with-value-and-extensions: INVARIANT_VIOLATED/error at Patient.extension[0] for ext-1",
  "added:base-ele-1-empty-datatype: INVARIANT_VIOLATED/error at Patient.maritalStatus for ele-1",
  "added:base-dom-3-referenced-contained: INVARIANT_UNCHECKED/information at Patient for dom-3",
];

/** `CODE/severity at location for key`, the shape an invariant finding string takes. */
const INVARIANT_FINDING =
  /^(INVARIANT_VIOLATED|INVARIANT_UNCHECKED)\/(\w+) at .+ for ([a-z]+-\d+)$/;

/**
 * Whether one added finding is one this change may add: an invariant code, one of the 19 keys, at
 * that key's severity when violated and at `information` when unchecked.
 */
function allowedAddition(finding: string): boolean {
  const match = INVARIANT_FINDING.exec(finding);
  if (match === null) return false;
  const [, code, severity, key] = match;
  const declared = KEY_SEVERITY[key ?? ""];
  if (declared === undefined) return false;
  return code === "INVARIANT_VIOLATED" ? severity === declared : severity === "information";
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

describe("AC-13: base versus head, the read differential over the JSON corpus", () => {
  it("AC-13: compares the corpus the base capture was taken over, at the named pin", () => {
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

      it("AC-13: reads the same in every channel this change does not move", () => {
        expect(base, "no base capture for this document").toBeDefined();
        const captured2 = base as Readout;
        for (const channel of IDENTICAL_CHANNELS) {
          expect(head[channel], `${channel} moved`).toEqual(captured2[channel]);
        }
      });

      it("AC-13: withdraws, relocates and re-severities no finding", () => {
        const { removed } = delta((base as Readout).findings, head.findings);
        expect(removed, "a finding was removed, re-severitied or relocated").toEqual([]);
      });

      it("AC-13: adds only an invariant finding carrying one of the 19 keys at its severity", () => {
        const { added } = delta((base as Readout).findings, head.findings);
        expect(added.filter((finding) => !allowedAddition(finding))).toEqual([]);
      });

      it("AC-13: moves valid true to false only, and only with an added violation", () => {
        const captured2 = base as Readout;
        if (head.valid === captured2.valid) return;
        expect(captured2.valid, "valid moved false to true").toBe(true);
        expect(
          delta(captured2.findings, head.findings).added.some((finding) =>
            finding.startsWith("INVARIANT_VIOLATED/error "),
          ),
          "valid moved with no added error-severity violation to explain it",
        ).toBe(true);
      });
    });
  }

  describe("AC-13: the whole of what moved, and every allowance exercised", () => {
    const moves = corpus().map((document) => {
      const base = captured.documents[document.name] as Readout;
      const head = readDocument(HEAD, document.json);
      return { name: document.name, base, head, ...delta(base.findings, head.findings) };
    });
    const added = moves.flatMap((move) => move.added.map((finding) => `${move.name}: ${finding}`));

    it("AC-13: adds exactly the findings written out, and no other", () => {
      expect(added).toEqual(ADDED_FINDINGS);
    });

    for (const key of DECIDED_KEYS) {
      it(`AC-13: the corpus reaches a ${key} violation`, () => {
        expect(
          added.some(
            (line) => line.includes("INVARIANT_VIOLATED/error ") && line.endsWith(` for ${key}`),
          ),
        ).toBe(true);
      });
    }

    it("AC-13: the corpus reaches dom-3 unchecked over a contained resource", () => {
      expect(
        added.some(
          (line) =>
            line.includes("INVARIANT_UNCHECKED/information ") && line.endsWith(" for dom-3"),
        ),
      ).toBe(true);
    });

    it("AC-13: moves valid true to false somewhere in the corpus", () => {
      expect(moves.filter((move) => move.base.valid && !move.head.valid).length).toBeGreaterThan(0);
    });

    it("AC-13: removes no finding anywhere in the corpus", () => {
      expect(moves.flatMap((move) => move.removed.map((f) => `${move.name}: ${f}`))).toEqual([]);
    });
  });
});
