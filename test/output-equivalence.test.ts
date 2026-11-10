/**
 * Output equivalence: head outputs exactly what the base tree output, for every document of the
 * corpus in `test/_output-corpus.ts`.
 *
 * The base half is committed data (`test/__data__/output-digests.json`), one SHA-256 per document
 * of everything a caller can observe: the raw tree, the model, every parse issue, every validation
 * issue in both modes, the safety readout and each location channel, the JSON and XML writes, and
 * every error any of them throws. `scripts/capture-output-digests.ts` captures it from a base ref
 * with `git archive`; re-run at the same base, the file comes back byte-identical.
 *
 * It exists for changes that make the read, the validator or the writers cheaper and are meant to
 * change nothing else. A change that does mean to change an output re-captures the digests at the
 * ref that ships it, and says so.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import * as head from "../src/index.js";
import { digestOf, outputCorpus, recordOf } from "./_output-corpus.js";

interface CapturedFile {
  readonly base: string;
  readonly documents: Record<string, string>;
}

const captured = JSON.parse(
  readFileSync(new URL("./__data__/output-digests.json", import.meta.url), "utf8"),
) as CapturedFile;

describe("output equivalence with the base tree", () => {
  const corpus = outputCorpus();

  it("covers the same documents the base digests were captured over", () => {
    expect(corpus.map((doc) => doc.name).sort()).toEqual(Object.keys(captured.documents).sort());
  });

  it("outputs exactly what the base tree output, for every document", { timeout: 120_000 }, () => {
    const differing = corpus
      .filter((doc) => digestOf(recordOf(head, doc)) !== captured.documents[doc.name])
      .map((doc) => doc.name);
    expect(differing).toEqual([]);
  });
});
