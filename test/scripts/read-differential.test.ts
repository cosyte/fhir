/**
 * Tests for the read differential's negative control (`scripts/differential-control.ts`).
 *
 * WHY THIS FILE EXISTS. The control it replaced was never exercised by anything, and it was wrong
 * for two slices running: it keyed on a hand-written document whose reading "this slice moves", that
 * document named a slice that had since merged, and so base and head agreed on it. The consequence
 * is the one that matters: it fired on a MODIFIED tree and it fired on a CLEAN one, so it did not
 * distinguish them, so it cleared neither, and every zero standing behind it was inadmissible.
 *
 * The bar here is therefore polarity, asserted on both sides rather than argued:
 *
 *   - RED on a clean tree (the two sides are the same code, so the report compares a thing with
 *     itself);
 *   - GREEN on a genuinely changed tree, INCLUDING one whose change is confined to the XML writer,
 *     which is the shape the old control was blind to;
 *   - and the sensitivity arm goes red when the comparison cannot see a perturbation, which is what
 *     makes the control prove it can fail on every run instead of being trusted for never having
 *     failed.
 *
 * The control is imported directly. It has no top-level side effect, unlike `read-differential.ts`,
 * which ends in `await main()` and would run the whole differential on import.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { Codec, ReadsAlike } from "../../scripts/differential-control.js";
import {
  MUTANTS,
  PROBE,
  UNMOVED,
  refusalBlindSpots,
  refusalsIntroduced,
  sensitivityProblems,
  sourceTreesDiffer,
  unmovedProblems,
} from "../../scripts/differential-control.js";

const REPO = process.cwd();

// ──────────────────────────────────────────────────────────────────────────────────────────────
// A codec stub. The control must be gradeable without the package, so the mutants are applied to a
// stub whose readings are trivially inspectable rather than to the real reader; the real reader is
// what `pnpm differential:read` runs the same functions against.
// ──────────────────────────────────────────────────────────────────────────────────────────────

function stubCodec(): Codec {
  return {
    parseResourceXml: (src) => ({ resource: { src }, issues: [{ code: "OK" }] }),
    parseResource: (src) => ({ resource: { src }, issues: [] }),
    serializeResource: () => `{"resourceType":"Composition"}`,
    serializeResourceXml: () => `<Composition/>`,
    validateResource: () => ({ valid: true, issues: [] }),
    readSafety: () => ({
      retracted: false,
      safeToSummarize: true,
      negations: [],
      shadowedProperties: [],
      arrayWrappedScalars: [],
      nestedArrays: [],
    }),
    SERIALIZE_ERROR_CODES: { DROPPED_ELEMENT_TEXT: "DROPPED_ELEMENT_TEXT" },
  };
}

/** Everything the stub codec makes of one document, over every method of the surface. */
function stubReading(codec: Codec, xml: string): string {
  const parsed = codec.parseResourceXml(xml);
  return JSON.stringify({
    issues: parsed.issues,
    validated: codec.validateResource(parsed.resource as never),
    safety: codec.readSafety(parsed.resource as never),
    json: codec.serializeResource(parsed.resource as never),
    xml: codec.serializeResourceXml(parsed.resource as never),
  });
}

/** The comparison a report that reads EVERY field would score with. */
const wide: ReadsAlike = (a, b, xml) => stubReading(a, xml) === stubReading(b, xml);

/**
 * The comparison the DELETED control scored with, reconstructed field for field: `json`, `valid`,
 * `findings`, `issues`, `safeToSummarize`, `retracted`, `negations`. Not `xml`.
 *
 * It is here so the blindness is a failing assertion rather than a sentence in a changelog.
 */
const oldNarrow: ReadsAlike = (a, b, xml) => {
  const shrink = (codec: Codec): string => {
    const parsed = codec.parseResourceXml(xml);
    const validated = codec.validateResource(parsed.resource as never);
    const safety = codec.readSafety(parsed.resource as never);
    return JSON.stringify({
      json: codec.serializeResource(parsed.resource as never),
      valid: validated.valid,
      findings: validated.issues,
      issues: parsed.issues,
      safeToSummarize: safety.safeToSummarize,
      retracted: safety.retracted,
      negations: safety.negations,
    });
  };
  return shrink(a) === shrink(b);
};

// ──────────────────────────────────────────────────────────────────────────────────────────────

describe("arm 1: the two trees really are two trees", () => {
  it("goes RED on a clean tree, where both sides are the same source", () => {
    const dir = mkdtempSync(join(tmpdir(), "differential-control-clean-"));
    try {
      const a = join(dir, "a");
      const b = join(dir, "b");
      mkdirSync(a);
      mkdirSync(b);
      writeFileSync(join(a, "index.ts"), "export const x = 1;\n");
      writeFileSync(join(b, "index.ts"), "export const x = 1;\n");

      const result = sourceTreesDiffer(a, b);
      expect(result.differingFiles).toBe(0);
      expect(result.problems).toHaveLength(1);
      expect(result.problems[0]).toContain("byte-identical");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("goes GREEN on a tree changed by one byte in one file", () => {
    const dir = mkdtempSync(join(tmpdir(), "differential-control-changed-"));
    try {
      const a = join(dir, "a");
      const b = join(dir, "b");
      mkdirSync(a);
      mkdirSync(b);
      writeFileSync(join(a, "index.ts"), "export const x = 1;\n");
      writeFileSync(join(b, "index.ts"), "export const x = 2;\n");

      const result = sourceTreesDiffer(a, b);
      expect(result.differingFiles).toBe(1);
      expect(result.problems).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("sees a file added on one side and a file removed on the other", () => {
    const dir = mkdtempSync(join(tmpdir(), "differential-control-addremove-"));
    try {
      const a = join(dir, "a");
      const b = join(dir, "b");
      mkdirSync(join(a, "xml"), { recursive: true });
      mkdirSync(join(b, "xml"), { recursive: true });
      writeFileSync(join(a, "xml", "gone.ts"), "export const gone = 1;\n");
      writeFileSync(join(b, "xml", "new.ts"), "export const added = 1;\n");

      expect(sourceTreesDiffer(a, b).differingFiles).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads nested directories, not just the top level", () => {
    const dir = mkdtempSync(join(tmpdir(), "differential-control-nested-"));
    try {
      const a = join(dir, "a");
      const b = join(dir, "b");
      mkdirSync(join(a, "codec"), { recursive: true });
      mkdirSync(join(b, "codec"), { recursive: true });
      writeFileSync(join(a, "codec", "deep.ts"), "export const d = 1;\n");
      writeFileSync(join(b, "codec", "deep.ts"), "export const d = 2;\n");

      expect(sourceTreesDiffer(a, b).differingFiles).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports THIS package's own src/ as identical to a copy of itself", () => {
    // The arm has to be right about a real tree, not only about two-file fixtures, and a copy of
    // src/ is the only clean tree available in a test. A sibling package's src/ would differ for
    // the wrong reason and prove nothing about the comparison.
    const dir = mkdtempSync(join(tmpdir(), "differential-control-selfcopy-"));
    try {
      const copy = join(dir, "src");
      cpSync(join(REPO, "src"), copy, { recursive: true });
      const result = sourceTreesDiffer(join(REPO, "src"), copy);
      expect(result.differingFiles).toBe(0);
      expect(result.problems).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("arm 2: the comparison can see a change", () => {
  it("is GREEN for every mutant when the comparison reads the whole reading", () => {
    expect(sensitivityProblems(stubCodec(), wide)).toEqual([]);
  });

  it("covers every method the XML reading is built from, one mutant each, and no more", () => {
    // A mutant set that skipped one of these would leave that axis unproven while the arm reported
    // green, which is the same never-pointed-at-its-input shape the control exists for. Pinned as an
    // exact set, so adding a method to the surface without a mutant reds here.
    //
    // `parseResource` is DELIBERATELY not in it, and that is a declared gap rather than an
    // oversight: it feeds the JSON-fixtures section of the report, which scores with its own
    // comparison (`readJson`) and not with the one this arm grades. Covering it would mean asserting
    // sensitivity for a comparison this arm is not handed.
    expect([...MUTANTS].map((m) => m.id).sort()).toEqual([
      "parseResourceXml",
      "readSafety",
      "serializeResource",
      "serializeResourceXml",
      "validateResource",
    ]);
  });

  it("every mutant really does perturb the reading it claims to", () => {
    const head = stubCodec();
    for (const mutant of MUTANTS) {
      expect(stubReading(mutant.of(head), PROBE), mutant.id).not.toBe(stubReading(head, PROBE));
    }
  });

  it("goes RED under the DELETED control's narrower comparison, naming the XML writer", () => {
    // This is the defect, asserted rather than described: the comparison the old control used could
    // not see a change confined to `serializeResourceXml`, so a writer-only slice measured against
    // it reported a comfortable zero.
    const problems = sensitivityProblems(stubCodec(), oldNarrow);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("serializeResourceXml");
    expect(problems[0]).toContain("blind");
  });

  it("goes RED for EVERY mutant under a comparison that reads nothing", () => {
    const blind: ReadsAlike = () => true;
    expect(sensitivityProblems(stubCodec(), blind)).toHaveLength(MUTANTS.length);
  });

  it("does not depend on the probe being refused by a writer", () => {
    // A probe one of the writers declined would make that mutant vacuously undetectable, so pin
    // that the probe is a document both writers of the real package handle.
    expect(PROBE).toContain("http://www.w3.org/1999/xhtml");
    expect(PROBE.startsWith("<Composition")).toBe(true);
  });
});

describe("arm 3: a conformant narrative has not moved", () => {
  it("is GREEN when the two codecs agree", () => {
    expect(unmovedProblems(stubCodec(), stubCodec(), wide)).toEqual([]);
  });

  it("is RED when they disagree on the conformant spelling", () => {
    const head = MUTANTS[0]?.of(stubCodec());
    expect(head).toBeDefined();
    const problems = unmovedProblems(stubCodec(), head as Codec, wide);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("conformant narrative");
  });

  it("uses a document the corpus is not scored on, so it cannot flatter a tally", () => {
    expect(UNMOVED).not.toBe(PROBE);
    expect(UNMOVED).toContain("CONTROL");
  });
});

describe("arm 4: the run names the refusals it introduced", () => {
  /** A codec that publishes exactly these refusal reasons. */
  function withRefusals(...codes: string[]): Codec {
    return { ...stubCodec(), SERIALIZE_ERROR_CODES: Object.fromEntries(codes.map((c) => [c, c])) };
  }

  it("names a refusal head declares and base does not", () => {
    const base = withRefusals("DROPPED_ELEMENT_TEXT");
    const head = withRefusals("DROPPED_ELEMENT_TEXT", "UNSERIALIZABLE_FOREIGN_ROOT");
    expect(refusalsIntroduced(base, head)).toEqual(["UNSERIALIZABLE_FOREIGN_ROOT"]);
    const spots = refusalBlindSpots(base, head);
    // The point of the arm: the run says the code, so the zeros below are read with it in view.
    expect(spots[0]).toContain("UNSERIALIZABLE_FOREIGN_ROOT");
    expect(spots.join(" ")).toContain("SKIPPED by the leaf comparison");
  });

  it("names nothing once that refusal has merged into base, so it cannot go stale", () => {
    // This is the property the deleted hand-keyed control could not hold. The same head, measured
    // against a base that now carries the refusal, keys nothing rather than firing forever.
    const merged = withRefusals("DROPPED_ELEMENT_TEXT", "UNSERIALIZABLE_FOREIGN_ROOT");
    expect(refusalsIntroduced(merged, merged)).toEqual([]);
    expect(refusalBlindSpots(merged, merged)).toEqual([]);
  });

  it("names nothing for a run that adds no refusal, which is not a fault either", () => {
    expect(refusalBlindSpots(stubCodec(), stubCodec())).toEqual([]);
  });

  it("does not treat a refusal REMOVED at head as one introduced", () => {
    // The difference is directional on purpose: this arm answers "what did head start refusing",
    // which is what turns a line below into a floor. A code base had and head dropped does not.
    const base = withRefusals("DROPPED_ELEMENT_TEXT", "UNSERIALIZABLE_FOREIGN_ROOT");
    const head = withRefusals("DROPPED_ELEMENT_TEXT");
    expect(refusalsIntroduced(base, head)).toEqual([]);
  });

  it("reports every introduced code, sorted, not just the first", () => {
    const base = withRefusals("A");
    const head = withRefusals("A", "C", "B");
    expect(refusalsIntroduced(base, head)).toEqual(["B", "C"]);
  });
});
