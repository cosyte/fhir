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
 * `VALIDATOR_CLI_JAR` still prints the corpus it WOULD compare, its exclusions and the terminology
 * inputs it WOULD run under, which is what makes the accounting reviewable without a JVM.
 *
 * THE TERMINOLOGY INPUTS ARE DECLARED, AND THE RUN REFUSES BEFORE IT COMPARES
 * ---------------------------------------------------------------------------
 * A differential verdict is supposed to be a property of the document bytes and the oracle artifact.
 * It was also a property of a remote terminology service: the pinned release defaults `-tx` to a
 * public network endpoint, and three documents landed in the safety-critical `FALSE VALID` bucket on
 * one day and not on another because that service answered differently. So the run DECLARES its
 * terminology inputs (`scripts/differential/terminology.mjs`, `source: "none"` today), spells both
 * terminology options into the oracle's argv, and AUDITS that argv before a single document is
 * staged. If any terminology question would remain answerable over a network, or if the declared
 * inputs cannot be honoured exactly, this run compares nothing, names the condition and exits
 * non-zero. It never substitutes another terminology source.
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
 *   - the **FHIR R4 (4.0.1) specification's own published examples** (CC0-1.0).
 *
 * **266 declared, 179 compared, 87 excluded**, 169 of the 179 third party. The third-party documents
 * are **fetched, never committed** (`pnpm corpus:fetch`, materialised into the git-ignored
 * `corpus/documents/`), each verified against the SHA-256 the declaration records.
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
 * lives, including the **terminology class**: an oracle finding attributable to terminology
 * resolution is classified out of BOTH invariants, counted and printed, because this library
 * declaredly vendors no terminology content and such a finding is a documented delta rather than a
 * verdict. An oracle `error`/`fatal` outside that class, on a document this library reports clean,
 * is still a false valid and still fails the run.
 *
 * **THE EXCLUSION RATE IS PART OF THE RESULT, NOT A FOOTNOTE TO IT.** 87 of the 266 declared
 * documents are held out, each with the reason measured and recorded in `corpus/corpus.json` and
 * printed on every run, and the classes are almost entirely one thing: the reference validator
 * resolves canonical URLs (`identifier.system`, `url`, `instantiatesUri`, `library`,
 * `relatedArtifact.resource`, `Attachment.url`) and this library does neither and says so. The six
 * exclusions whose measured reason was ONLY a terminology finding are no longer exclusions: they are
 * compared, under the terminology class above, because a rule beats a snapshot of what a remote
 * service answered on one date. So the number is "179 documents on which the two were SHOWN to
 * agree", beside "87 on which they were shown not to". Reading only the first is reading half of it.
 *
 * What the number does NOT buy, separately: over resource types this library does not model, it
 * emits an informational `RESOURCE_NOT_MODELED` and no error, so agreement at scale mostly means "we
 * invented no error on a real document the oracle finds clean". That is a real property and a
 * bounded one. The shared corpus's own `r4` half is declared "not maintained" by its maintainer:
 * breadth is not currency.
 *
 * WHAT IS PRINTED, AND WHY
 * ------------------------
 * The compared count, the oracle's identity and the terminology inputs are printed on every run, so
 * a silent shrink of any of them is visible in the log. The identity is derived from the jar's own
 * bytes, not from the configured release string, so substituting a different artifact changes the
 * record. Excluded documents are printed with the recorded reason for their exclusion and are never
 * counted. The run closes with a RUN RECORD: a digest over a structure that is a pure function of
 * the run's inputs, carrying no wall-clock time, no staging path and no ordinal, which is what
 * `pnpm differential:determinism` compares across two comparisons.
 *
 * **THE EXIT IS `process.exitCode`, NEVER `process.exit()`, AND THAT IS NOT A STYLE CHOICE.** Under
 * CI this process's stdout is a PIPE, so writes to it are asynchronous and buffered, and
 * `process.exit()` terminates without flushing what is still in the buffer. Measured on a real run:
 * the per-document lines and the exclusions block reached the log and **the closing summary, the
 * oracle identity beside it and the run record did not**, which silently deleted the half of the
 * output this file's own docblock says is the point. Setting the code and returning lets Node drain
 * stdout and exit on its own. Do not "simplify" it back.
 *
 * @packageDocumentation
 */

import { writeFileSync } from "node:fs";

import {
  exitCodeFor,
  formatExclusions,
  formatRecord,
  formatSummary,
} from "./differential/compare.mjs";
import { CorpusError, exclusions, loadDeclaration, provenanceLine } from "./differential/corpus.mjs";
import { ourFindings } from "./differential/findings.mjs";
import {
  formatOracleIdentity,
  ORACLE_RELEASE,
  oracleIdentity,
  OracleError,
} from "./differential/oracle.mjs";
import { canonicalJson, formatRunRecord } from "./differential/record.mjs";
import { corpusSummaryLines, runComparison } from "./differential/run.mjs";
import {
  formatTerminologyInputs,
  resolveTerminologyInputs,
  TERMINOLOGY_INPUTS,
  TerminologyError,
} from "./differential/terminology.mjs";

function main() {
  let declaration;
  try {
    declaration = loadDeclaration();
  } catch (err) {
    console.error(`differential: ${err instanceof CorpusError ? err.message : String(err)}`);
    process.exitCode = 1;
    return;
  }

  for (const line of corpusSummaryLines(declaration)) console.log(line);
  for (const line of formatExclusions(exclusions(declaration))) console.log(line);

  // BEFORE the oracle, and before any document: the terminology inputs this run declares, honoured
  // exactly or refused. A run that cannot honour them compares nothing rather than compare against
  // answers it cannot reproduce.
  let terminology;
  try {
    terminology = resolveTerminologyInputs(TERMINOLOGY_INPUTS);
  } catch (err) {
    console.error(
      `differential: ${err instanceof TerminologyError ? err.message : String(err)}\n` +
        `  No document was compared. The declared terminology inputs are honoured exactly or not ` +
        `at all; no other terminology source is substituted for them.`,
    );
    process.exitCode = 1;
    return;
  }
  const terminologyLine = formatTerminologyInputs(terminology);
  console.log(`\n${terminologyLine}`);

  const jar = process.env.VALIDATOR_CLI_JAR;
  if (jar === undefined || jar === "") {
    console.log(
      `\ndifferential: VALIDATOR_CLI_JAR is not set (no JVM oracle available), SKIPPING the comparison.\n` +
        `  This gate runs on GitHub Actions (the \`differential\` job), not in the dev container.\n` +
        `  The corpus above is what it would compare; \`pnpm corpus:fetch\` materialises it.`,
    );
    process.exitCode = 0;
    return;
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
    process.exitCode = 1;
    return;
  }
  const identityLine = formatOracleIdentity(identity);
  console.log(identityLine);

  let outcome;
  try {
    outcome = runComparison({ jar, identity, declaration, terminology, ourFindings });
  } catch (err) {
    if (err instanceof TerminologyError) {
      console.error(
        `differential: ${err.message}\n` +
          `  No document was compared and no count is reported: a comparison whose terminology ` +
          `answers could come from a network is not reproducible from this repository.`,
      );
      process.exitCode = 1;
      return;
    }
    console.error(`differential: ${err instanceof CorpusError ? err.message : String(err)}`);
    process.exitCode = 1;
    return;
  }

  const { records, summary, runRecord, resolved } = outcome;

  for (const record of records) {
    const line = formatRecord(record);
    if (record.violation) {
      console.error(line);
      const findings = record.oracleFindings ?? record.ourFindings ?? [];
      for (const f of findings) {
        // Severity, location and CODES. Never the diagnostic text: the oracle echoes document
        // values and this log is public. The codes are what make a violation classifiable.
        const kind = [f.code, f.messageId].filter(Boolean).join("/");
        console.error(`    ${f.severity} @ ${f.location || "(root)"}${kind ? ` [${kind}]` : ""}`);
      }
    } else {
      console.log(line);
    }
  }

  console.log("");
  for (const line of formatExclusions(summary.exclusions)) console.log(line);
  for (const line of formatSummary(summary, identityLine, terminologyLine)) {
    if (summary.violations.length > 0 || !summary.meetsFloor) console.error(line);
    else console.log(line);
  }
  for (const line of formatRunRecord(runRecord)) console.log(line);

  // The full record, for a reader who wants to diff two of them by hand. Opt-in, because the
  // per-document lines above are already the readable form.
  const recordPath = process.env.DIFFERENTIAL_RUN_RECORD;
  if (recordPath !== undefined && recordPath !== "") {
    writeFileSync(recordPath, canonicalJson(runRecord));
    console.log(`run record: written to ${recordPath}`);
  }

  if (summary.compared > 0 && summary.violations.length === 0 && summary.meetsFloor) {
    const sample = resolved[0];
    console.log(
      `differential: the corpora above agree with the oracle within documented deltas ` +
        `(provenance, first document: ${provenanceLine(declaration, sample.document)}).`,
    );
  }
  process.exitCode = exitCodeFor(summary);
}

main();
