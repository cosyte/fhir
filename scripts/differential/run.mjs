/**
 * One comparison, end to end: stage the declared bytes, ask the oracle under the declared
 * terminology inputs, compare, and build the run record.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A MODULE AND NOT THE TOP OF `differential.mjs`
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * `pnpm differential` runs it once over the whole compared corpus and exits on the invariants and
 * the floor. `pnpm differential:determinism` runs it TWICE over the declared subset and exits on
 * whether the two run records agree. They must be the same comparison or the second proves nothing
 * about the first, so there is one of it, here.
 *
 * THE TERMINOLOGY AUDIT HAPPENS BEFORE A DOCUMENT IS STAGED
 * ---------------------------------------------------------
 * {@link runComparison} builds the argv the oracle will actually be invoked with and hands it to
 * `terminology.mjs` to audit BEFORE it writes the first staged file. A run whose terminology
 * questions would be answerable over a network compares nothing at all; it does not compare and then
 * discover the problem.
 *
 * THE STAGING DIRECTORY IS AN IMPLEMENTATION DETAIL, NOT AN INPUT
 * ---------------------------------------------------------------
 * Documents are staged under a `mkdtemp` directory with an ordinal prefix, because the validator
 * attributes its outcomes by file name and needs them unique. Neither the directory nor the ordinal
 * reaches the run record: `record.mjs` copies named fields only, and the documents are keyed by
 * their DECLARED id. That is the whole reason two runs can produce byte-identical records.
 *
 * @packageDocumentation
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { compareDocument, summarize } from "./compare.mjs";
import { corpusOf, exclusions, resolveCorpus } from "./corpus.mjs";
import { oracleArgs, runOracleBatch } from "./oracle.mjs";
import { buildRunRecord } from "./record.mjs";
import { auditTerminologyArgv } from "./terminology.mjs";

/** How many documents go through one JVM start. Amortises ~30s of startup over a batch. */
export const BATCH_SIZE = Number(process.env.DIFFERENTIAL_BATCH_SIZE ?? "40");

/** The time bound on one batch. Exceeding it yields no outcome for that batch, never "clean". */
export const BATCH_TIMEOUT_MS = Number(process.env.DIFFERENTIAL_ORACLE_TIMEOUT_MS ?? "600000");

/** Stage the corpus into one temp directory under names that are unique and map back to documents. */
function stage(resolved) {
  const dir = mkdtempSync(join(tmpdir(), "fhir-diff-corpus-"));
  return resolved.map((entry, index) => {
    const name = `${String(index).padStart(4, "0")}-${basename(entry.document.path)}`;
    const file = join(dir, name);
    writeFileSync(file, entry.bytes);
    return { ...entry, staged: file, stagedName: name };
  });
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Ask the oracle about every staged document, batch by batch, under the declared inputs. */
function askOracle(jar, staged, options) {
  const answers = new Map();
  for (const batch of chunk(staged, Math.max(1, options.batchSize))) {
    const outputPath = join(mkdtempSync(join(tmpdir(), "fhir-diff-out-")), "outcome.json");
    const result = runOracleBatch(jar, batch.map((s) => s.staged), outputPath, {
      timeoutMs: options.timeoutMs,
      terminology: options.terminology,
      ...(options.exec === undefined ? {} : { exec: options.exec }),
      ...(options.read === undefined ? {} : { read: options.read }),
    });
    for (const entry of batch) {
      if (result.ok !== true) {
        answers.set(entry.document.id, { ok: false, reason: result.reason });
        continue;
      }
      const issues = result.byName.get(entry.stagedName);
      answers.set(
        entry.document.id,
        issues === undefined
          ? {
              ok: false,
              reason: "the oracle returned no outcome that could be attributed to this document",
            }
          : { ok: true, issues },
      );
    }
  }
  return answers;
}

/**
 * Run one comparison.
 *
 * @param input.jar          the oracle artifact, already identified by the caller
 * @param input.identity     that identity, recorded in the run record
 * @param input.declaration  the corpus declaration
 * @param input.terminology  the RESOLVED terminology inputs
 * @param input.ourFindings  this library's findings for one document's text
 * @param input.only         document ids to compare, or `undefined` for the whole compared corpus
 * @param input.scope        what the record calls this comparison: `full` or `subset`
 * @param input.exec         process launcher, injectable so the plumbing is gradeable with no JVM
 * @param input.read         output reader, injectable for the same reason
 */
export function runComparison(input) {
  const {
    jar,
    identity,
    declaration,
    terminology,
    ourFindings,
    only,
    scope = "full",
    batchSize = BATCH_SIZE,
    timeoutMs = BATCH_TIMEOUT_MS,
    exec,
    read,
    location = {},
  } = input;

  // Before a document is staged: the argv the oracle will be invoked with, audited. Throws a
  // TerminologyError the caller turns into "compared nothing, exit non-zero, named the condition".
  auditTerminologyArgv(oracleArgs(jar, ["<corpus>"], "<output>", { terminology }), terminology);

  const resolved = resolveCorpus(declaration, only === undefined ? location : { ...location, only });
  const staged = stage(resolved);
  const answers = askOracle(jar, staged, { batchSize, timeoutMs, terminology, exec, read });

  const records = staged.map((entry) =>
    compareDocument({
      id: entry.document.id,
      oracle: answers.get(entry.document.id) ?? {
        ok: false,
        reason: "the oracle was never asked about this document",
      },
      ours: ourFindings(entry.text),
    }),
  );

  const declaredExclusions = exclusions(declaration);
  const summary = summarize({
    records,
    exclusions: declaredExclusions,
    // A subset comparison is not measured against the corpus floor: the floor is a property of the
    // full run, and applying it here would fail a check that never claimed to compare the corpus.
    floor: only === undefined ? declaration.comparedFloor : records.length,
  });
  const runRecord = buildRunRecord({
    oracle: identity,
    terminology,
    corpus: {
      declared: declaration.documents.length,
      excluded: declaredExclusions.length,
      floor: declaration.comparedFloor,
      scope,
      documents: resolved.map((r) => r.document.id),
      corpora: declaration.corpora.map((c) => ({
        id: c.id,
        version: c.version,
        licence: c.licence,
      })),
    },
    records,
    summary,
  });
  return { records, summary, runRecord, resolved };
}

/** The per-corpus declared/compared breakdown printed at the top of every run. */
export function corpusSummaryLines(declaration) {
  const byCorpus = new Map();
  for (const document of declaration.documents) {
    const corpus = corpusOf(declaration, document);
    const row = byCorpus.get(corpus.id) ?? { corpus, declared: 0, excluded: 0 };
    row.declared += 1;
    if (document.exclude !== undefined) row.excluded += 1;
    byCorpus.set(corpus.id, row);
  }
  const lines = ["differential corpus:"];
  for (const { corpus, declared, excluded } of byCorpus.values()) {
    lines.push(
      `  ${corpus.id}: ${String(declared - excluded)} compared, ${String(excluded)} excluded, ` +
        `from ${corpus.title} @ ${corpus.version} (${corpus.licence}, ${corpus.origin})`,
    );
  }
  return lines;
}
