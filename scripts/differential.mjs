#!/usr/bin/env node
/**
 * Differential test against the official FHIR validator (`org.hl7.fhir.core` / `validator_cli.jar`).
 * Roadmap §6, "The differential oracle is the official validator."
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A CI-ONLY GATE, NOT A LOCAL ONE
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * The oracle is a **JVM** program. The zero-dependency rule binds the *published package*, not the
 * test harness, but it does mean this gate needs a Java runtime + the `validator_cli.jar`, neither of
 * which is present in the default dev container. So this script runs on GitHub Actions (the
 * `differential` job in `.github/workflows/ci.yml`, which provisions Temurin 21 and downloads the
 * jar at a PINNED release) and is a no-op-with-clear-skip elsewhere. **It has not been observed green
 * in this container, do not read its presence as a proven differential.** Running it here with no
 * `VALIDATOR_CLI_JAR` still prints the corpus it WOULD compare, and its exclusions, which is what
 * makes the accounting reviewable without a JVM.
 *
 * THE CORPUS
 * ----------
 * The corpus is declared in `corpus/corpus.json` and is no longer ten in-tree fixtures. It is
 * **three corpora**, and only the first was written here:
 *
 *   - this repository's own synthetic **spec-clean** and **Tier-2 quirk** fixtures
 *     (`test/__fixtures__/`, MIT), which is what the ten-fixture corpus used to be, kept in full;
 *   - **`FHIR/fhir-test-cases`** at tag `1.7.67` (Apache-2.0), the shared corpus the reference
 *     validator's own `pom.xml` pins itself against;
 *   - the **FHIR R4 (4.0.1) specification's own published examples** (CC0-1.0), one per resource
 *     type that `fhir-test-cases` does not already cover.
 *
 * The third-party documents are **fetched, never committed** (`pnpm corpus:fetch`, materialised into
 * the git-ignored `corpus/documents/`), each verified against the SHA-256 the declaration records.
 * `scripts/differential/corpus.mjs` carries the reasoning; the short version is that committing
 * someone else's clinical examples would put real-looking names and dates of birth into this
 * repository's history, where a revert does not reach them, and would force the PHI scanner's
 * allow-lists to swallow third-party document content.
 *
 * WHAT IT PROVES, AND WHAT IT DOES NOT
 * ------------------------------------
 * The two invariants (never a false valid; no spurious errors on clean input) are enforced hard over
 * every compared document, and the fail-closed parse-refusal exemption to the second is unchanged.
 * They are stated in full in `scripts/differential/compare.mjs`, which is also where the accounting
 * lives. What the number does NOT buy: over resource types this library does not model, it emits an
 * informational `RESOURCE_NOT_MODELED` and no error, so agreement at scale mostly means "we invented
 * no error on a real document the oracle finds clean". That is a real property and a bounded one.
 * The corpus's own `r4` half is declared "not maintained" by its maintainer: breadth is not currency.
 *
 * WHAT IS PRINTED, AND WHY
 * ------------------------
 * The compared count and the oracle's identity are printed on every run, so a silent shrink of
 * either is visible in the log. The identity is derived from the jar's own bytes, not from the
 * configured release string, so substituting a different artifact changes the record. Excluded
 * documents are printed with the recorded reason for their exclusion and are never counted.
 *
 * @packageDocumentation
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { FhirCodecError, parseResource, validateResource } from "../dist/index.mjs";

import {
  compareDocument,
  exitCodeFor,
  formatExclusions,
  formatRecord,
  formatSummary,
  summarize,
} from "./differential/compare.mjs";
import {
  CorpusError,
  corpusOf,
  exclusions,
  loadDeclaration,
  provenanceLine,
  resolveCorpus,
} from "./differential/corpus.mjs";
import {
  formatOracleIdentity,
  ORACLE_RELEASE,
  oracleIdentity,
  OracleError,
  runOracleBatch,
} from "./differential/oracle.mjs";

/** How many documents go through one JVM start. Amortises ~30s of startup over a batch. */
const BATCH_SIZE = Number(process.env.DIFFERENTIAL_BATCH_SIZE ?? "40");

/** The time bound on one batch. Exceeding it yields no outcome for that batch, never "clean". */
const BATCH_TIMEOUT_MS = Number(process.env.DIFFERENTIAL_ORACLE_TIMEOUT_MS ?? "600000");

/**
 * Our own findings, normalized to the oracle's `{ severity, location }` shape (text deliberately
 * dropped), plus `parseRefused`: whether the reader **failed closed** on unrecoverable input (a
 * thrown `FhirCodecError`). A fail-closed refusal is a genuine `fatal` finding, never swallowed; the
 * flag lets the accounting treat it as the safe, conservative direction rather than a spurious
 * error. Anything else thrown is an answer we did NOT get, and is reported as such rather than as
 * "no findings".
 */
function ourFindings(text) {
  let resource;
  try {
    ({ resource } = parseResource(text));
  } catch (err) {
    if (err instanceof FhirCodecError) {
      return {
        ok: true,
        issues: [{ severity: "fatal", location: String(err.expression ?? "") }],
        parseRefused: true,
      };
    }
    return { ok: false, reason: `the reader threw a non-codec error: ${String(err)}` };
  }
  try {
    const result = validateResource(resource);
    return {
      ok: true,
      issues: result.issues.map((i) => ({
        severity: String(i.severity),
        location: String(i.expression),
      })),
      parseRefused: false,
    };
  } catch (err) {
    return { ok: false, reason: `validateResource threw: ${String(err)}` };
  }
}

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

/** Ask the oracle about every staged document, batch by batch. */
function askOracle(jar, staged) {
  const answers = new Map();
  for (const batch of chunk(staged, Math.max(1, BATCH_SIZE))) {
    const outputPath = join(mkdtempSync(join(tmpdir(), "fhir-diff-out-")), "outcome.json");
    const result = runOracleBatch(
      jar,
      batch.map((s) => s.staged),
      outputPath,
      { timeoutMs: BATCH_TIMEOUT_MS },
    );
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

function printCorpusSummary(declaration) {
  const byCorpus = new Map();
  for (const document of declaration.documents) {
    const corpus = corpusOf(declaration, document);
    const row = byCorpus.get(corpus.id) ?? { corpus, declared: 0, excluded: 0 };
    row.declared += 1;
    if (document.exclude !== undefined) row.excluded += 1;
    byCorpus.set(corpus.id, row);
  }
  console.log("differential corpus:");
  for (const { corpus, declared, excluded } of byCorpus.values()) {
    console.log(
      `  ${corpus.id}: ${String(declared - excluded)} compared, ${String(excluded)} excluded, ` +
        `from ${corpus.title} @ ${corpus.version} (${corpus.licence}, ${corpus.origin})`,
    );
  }
  for (const line of formatExclusions(exclusions(declaration))) console.log(line);
}

function main() {
  let declaration;
  try {
    declaration = loadDeclaration();
  } catch (err) {
    console.error(`differential: ${err instanceof CorpusError ? err.message : String(err)}`);
    process.exit(1);
  }

  printCorpusSummary(declaration);

  const jar = process.env.VALIDATOR_CLI_JAR;
  if (jar === undefined || jar === "") {
    console.log(
      `\ndifferential: VALIDATOR_CLI_JAR is not set (no JVM oracle available), SKIPPING the comparison.\n` +
        `  This gate runs on GitHub Actions (the \`differential\` job), not in the dev container.\n` +
        `  The corpus above is what it would compare; \`pnpm corpus:fetch\` materialises it.`,
    );
    process.exit(0);
  }

  let identity;
  try {
    identity = oracleIdentity(jar);
  } catch (err) {
    console.error(
      `differential: ${err instanceof OracleError ? err.message : String(err)}\n` +
        `  Refusing to compare documents against an unidentified oracle. The pinned release is ` +
        `${ORACLE_RELEASE}.`,
    );
    process.exit(1);
  }
  const identityLine = formatOracleIdentity(identity);
  console.log(`\n${identityLine}`);

  let resolved;
  try {
    resolved = resolveCorpus(declaration);
  } catch (err) {
    console.error(`differential: ${err instanceof CorpusError ? err.message : String(err)}`);
    process.exit(1);
  }

  const staged = stage(resolved);
  const answers = askOracle(jar, staged);

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

  for (const record of records) {
    const line = formatRecord(record);
    if (record.violation) {
      console.error(line);
      const findings = record.oracleFindings ?? record.ourFindings ?? [];
      for (const f of findings) console.error(`    ${f.severity} @ ${f.location || "(root)"}`);
    } else {
      console.log(line);
    }
  }

  const summary = summarize({ records, exclusions: exclusions(declaration), floor: declaration.comparedFloor });
  console.log("");
  for (const line of formatExclusions(summary.exclusions)) console.log(line);
  for (const line of formatSummary(summary, identityLine)) {
    if (summary.violations.length > 0 || !summary.meetsFloor) console.error(line);
    else console.log(line);
  }
  if (summary.compared > 0 && summary.violations.length === 0 && summary.meetsFloor) {
    const sample = resolved[0];
    console.log(
      `differential: the corpora above agree with the oracle within documented deltas ` +
        `(provenance, first document: ${provenanceLine(declaration, sample.document)}).`,
    );
  }
  process.exit(exitCodeFor(summary));
}

main();
