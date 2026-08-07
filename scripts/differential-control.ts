/**
 * The read differential's negative control: the arms that decide whether a zero in its report means
 * anything at all.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS ITS OWN FILE
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * The control used to live inside `read-differential.ts` behind a top-level `await main()`, so
 * nothing could exercise it without running the whole differential. It was never exercised, and it
 * was WRONG for two slices running: it keyed on a hand-written document whose reading "this slice
 * moves", and that document named a slice that had since merged, so base and head agreed on it and
 * the control fired on an UNMODIFIED tree. A control that is red whether the tree is clean or
 * changed does not distinguish the two, so it clears neither, and every zero it stood behind was
 * inadmissible rather than reassuring.
 *
 * Nothing here has a top-level side effect, so `test/scripts/read-differential.test.ts` imports it
 * and asserts the polarity on both sides: red on a clean tree, green on a changed one. **A control
 * that has never been observed red on a tree it should be red on has not cleared any tree.**
 *
 * The incident, the three measurements behind the replacement, and what stayed open:
 * `documentation/agent-notes.md`, "A control that cleared nothing".
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * THE THREE ARMS, AND WHY IT TAKES THREE
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * The old control tried to establish two separate things with one hand-keyed document, which is why
 * it could not be maintained. They are separated here, and only the third is slice-relative:
 *
 *   1. {@link sourceTreesDiffer} -- the two trees really are two trees. Mechanical, over the bytes
 *      that were imported, so it cannot go stale and never needs re-keying for a new slice.
 *   2. {@link sensitivityProblems} -- the comparison the report scores with can SEE a change. Run
 *      against deliberately perturbed copies of the head codec, one per method of the surface, every
 *      run. This is the arm that makes the control prove it can fail.
 *   3. {@link unmovedProblems} -- a conformant document that no slice should move has not moved.
 *
 * **Arm 1 is the one the old control was reaching for and could not express.** A source difference
 * is not a promise that any READING moves: a write-path slice can change real code that no readable
 * document reaches. That is a true and useful thing to report, and the differential prints it as an
 * observation rather than swallowing it as a pass. What arm 1 refuses is the opposite case, where
 * the report is all zeroes because there is no change in front of it at all.
 *
 * @packageDocumentation
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/** One issue as either tree reports it, narrowed to the fields the differential compares. */
export interface RawIssue {
  readonly code: string;
  readonly severity?: string;
  readonly expression?: string;
}

/** The safety spine's readout, narrowed to the fields the differential compares. */
export interface RawSafety {
  readonly retracted: boolean;
  readonly safeToSummarize: boolean;
  readonly negations: readonly string[];
  readonly shadowedProperties: readonly string[];
  readonly arrayWrappedScalars: readonly string[];
  readonly nestedArrays: readonly string[];
}

/** The slice of the package surface this differential exercises. Both trees expose it identically. */
export interface Codec {
  parseResourceXml: (src: string) => { resource: unknown; issues: readonly RawIssue[] };
  parseResource: (src: string) => { resource: unknown; issues: readonly RawIssue[] };
  serializeResource: (resource: never) => string;
  serializeResourceXml: (resource: never) => string;
  validateResource: (resource: never) => { valid: boolean; issues: readonly RawIssue[] };
  readSafety: (resource: never) => RawSafety;
}

/**
 * Whether two codecs read one document to the same thing.
 *
 * The differential injects its own reader and its own comparison here rather than the control
 * defining either, because **the control must test the comparison the report actually scores with.**
 * The previous control defined a second, narrower one (`whole()`, which read seven fields and left
 * out `xml`, `leaves`, `reread` and `thrown`) while `fold()` compared the entire reading. So the
 * control was blind on exactly the axis the two slices before this one changed: the writer.
 */
export type ReadsAlike = (a: Codec, b: Codec, xml: string) => boolean;

// ──────────────────────────────────────────────────────────────────────────────────────────────
// Arm 1: the two trees really are two trees
// ──────────────────────────────────────────────────────────────────────────────────────────────

/** Content hash of every file under `root`, keyed by its path relative to `root`. */
function manifest(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dirPath: string): void => {
    for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
      const full = join(dirPath, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        out.set(relative(root, full), createHash("sha256").update(readFileSync(full)).digest("hex"));
      }
    }
  };
  walk(root);
  return out;
}

/**
 * Compare the source the two codecs were imported from, byte for byte.
 *
 * **This runs over the materialized directory, not over `git diff`.** A `git` query would answer for
 * the refs; hashing what was actually written to disk and imported answers for the thing the
 * differential ran, which is what catches a materialization that picked up the working tree.
 *
 * **WHAT IT REFUSES IS EXACTLY ONE CASE: the two trees are byte-identical.** It does NOT establish
 * that base precedes head, and it does not establish that base is free of the change. The
 * comparison is symmetric, so it cannot order the two at all, and a base that already carries the
 * change is green as soon as anything else differs: a base directory equal to head's `src/` plus one
 * unrelated edit reports `differingFiles: 1` and no problem. An earlier draft of this comment
 * claimed the wider thing and was refuted with that example.
 *
 * A count of differing files is returned as well as any problem, because it is the cheapest sanity
 * read a reviewer has, and it is the number that catches the case above: a slice touching one file
 * that reports 40 differing files is measuring against the wrong ref even though this arm is green.
 *
 * @param baseSrc - The materialized base `src/` directory.
 * @param headSrc - The working tree `src/` directory.
 * @returns The number of paths whose content differs, and a problem when that number is zero.
 */
export function sourceTreesDiffer(
  baseSrc: string,
  headSrc: string,
): { differingFiles: number; problems: string[] } {
  const base = manifest(baseSrc);
  const head = manifest(headSrc);
  let differingFiles = 0;
  for (const path of new Set([...base.keys(), ...head.keys()])) {
    if (base.get(path) !== head.get(path)) differingFiles += 1;
  }
  return {
    differingFiles,
    problems:
      differingFiles === 0
        ? [
            "the base tree imported from --base is byte-identical to the working tree src/: the two sides are the same code, so every number below is a comparison of a thing with itself and none of them is evidence for anything",
          ]
        : [],
  };
}

// ──────────────────────────────────────────────────────────────────────────────────────────────
// Arm 2: the comparison can see a change (the arm that proves the control can fail)
// ──────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A deliberately broken copy of the head codec, and the reading field its breakage lands in.
 *
 * There is one per method of {@link Codec} on purpose: a mutant that only ever perturbs `issues`
 * would pass against any comparison that reads `issues`, and prove nothing about the rest. The
 * `serializeResourceXml` mutant is the one with history: it lands ONLY in the emitted XML and in the
 * re-read of it, and the previous control compared neither, so it went undetected. That is the
 * blindness this arm now reds on rather than describes.
 */
export interface Mutant {
  /** The method perturbed. */
  readonly id: string;
  /** Which part of a reading the perturbation lands in, for the failure message. */
  readonly lands: string;
  /** Build the perturbed codec. */
  readonly of: (codec: Codec) => Codec;
}

/**
 * A conformant document every mutant is observable on: it parses, validates, reads safety, and both
 * writers emit it. **A probe one of the writers refused would make that mutant vacuously undetected**
 * and turn this arm into the thing it exists to catch.
 */
export const PROBE =
  `<Composition xmlns="http://hl7.org/fhir"><text><status value="generated"/>` +
  `<div xmlns="http://www.w3.org/1999/xhtml">PROBE</div></text></Composition>`;

/**
 * One perturbation per method the XML reading is built from.
 *
 * **`parseResource` is deliberately absent, and it is a declared gap rather than an oversight.** It
 * feeds the differential's JSON-fixtures section, which scores with a comparison of its own
 * (`readJson`) rather than the one this arm is handed, so a mutant here would assert sensitivity for
 * a comparison that is not under test. That section remains ungraded by this control.
 *
 * **A SECOND DECLARED GAP, AND IT IS THE LIVE ONE: every mutant here perturbs a SUCCESSFUL emit, so
 * none of them covers a change to WHICH refusal a writer raises.** The differential's `emit()`
 * records every `FhirSerializeError` as one `REFUSED` sentinel and a `Reading` carries neither the
 * refusal code nor its message, so swapping one refusal for another moves no reading at all. That is
 * `PRE-EXISTING` in `read-differential.ts` and is NOT closed here: a mutant for it would red this arm
 * on every run for a blindness this change does not fix, which is the permanent-false-red shape the
 * control it replaced already had. It is named on the printed report instead, beside the zero it can
 * produce. **Do not read a green arm 2 as covering the refusal identity.**
 */
export const MUTANTS: readonly Mutant[] = [
  {
    id: "parseResourceXml",
    lands: "issues",
    of: (codec) => ({
      ...codec,
      parseResourceXml: (src) => {
        const result = codec.parseResourceXml(src);
        return { resource: result.resource, issues: [...result.issues, { code: "MUTANT" }] };
      },
    }),
  },
  {
    id: "validateResource",
    lands: "valid and findings",
    of: (codec) => ({
      ...codec,
      validateResource: (resource) => {
        const result = codec.validateResource(resource);
        return { valid: !result.valid, issues: result.issues };
      },
    }),
  },
  {
    id: "readSafety",
    lands: "safeToSummarize",
    of: (codec) => ({
      ...codec,
      readSafety: (resource) => {
        const result = codec.readSafety(resource);
        return { ...result, safeToSummarize: !result.safeToSummarize };
      },
    }),
  },
  {
    id: "serializeResource",
    lands: "json",
    of: (codec) => ({
      ...codec,
      serializeResource: (resource) => `${codec.serializeResource(resource)} `,
    }),
  },
  {
    id: "serializeResourceXml",
    lands: "xml and reread, and NOTHING else",
    of: (codec) => ({
      ...codec,
      serializeResourceXml: (resource) => `${codec.serializeResourceXml(resource)}<!--mutant-->`,
    }),
  },
];

/**
 * Assert the comparison can tell a perturbed codec from the real one, for every method of the
 * surface.
 *
 * This is the arm that makes the control **prove it can fail** on every run instead of being trusted
 * because it has never gone red. It is a self-test of the comparison, not of the package: a mutant
 * that slips past means the differential would score a real change of the same shape as zero.
 *
 * @param head - The working tree's codec.
 * @param readsAlike - The comparison the report scores with.
 * @returns One problem per mutant the comparison could not see.
 */
export function sensitivityProblems(head: Codec, readsAlike: ReadsAlike): string[] {
  const problems: string[] = [];
  for (const mutant of MUTANTS) {
    if (readsAlike(head, mutant.of(head), PROBE)) {
      problems.push(
        `the comparison cannot see a change to ${mutant.id}, which lands in ${mutant.lands}: a real change of that shape would be scored as zero, so the report is blind on that axis`,
      );
    }
  }
  return problems;
}

// ──────────────────────────────────────────────────────────────────────────────────────────────
// Arm 3: the conformant spelling has not moved
// ──────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The conformant narrative that a slice narrowing a write path or widening a report should leave
 * exactly as it was. It is deliberately NOT one of the documents the corpus is scored on, so it
 * cannot flatter a tally.
 */
export const UNMOVED =
  `<Composition xmlns="http://hl7.org/fhir"><text><status value="generated"/>` +
  `<div xmlns="http://www.w3.org/1999/xhtml">CONTROL</div></text></Composition>`;

/**
 * Assert base and head agree on {@link UNMOVED}.
 *
 * **This is a bar, not a key.** It says nothing about which slice is under measurement, which is
 * what makes it survive the next one; a slice that genuinely intends to change how a conformant
 * narrative reads is expected to red it and to say so, rather than to re-key it.
 *
 * @param base - The codec imported from `--base`.
 * @param head - The working tree's codec.
 * @param readsAlike - The comparison the report scores with.
 * @returns A problem when the two trees disagree on the conformant spelling.
 */
export function unmovedProblems(base: Codec, head: Codec, readsAlike: ReadsAlike): string[] {
  return readsAlike(base, head, UNMOVED)
    ? []
    : [
        "the two trees disagree on a conformant narrative document, which is not what this slice claims to change: check that before reading any number below",
      ];
}
