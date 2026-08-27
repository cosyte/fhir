#!/usr/bin/env node
/**
 * The determinism check: compare the same documents against the same oracle artifact under the same
 * declared terminology inputs TWICE, and pass only when the two run records are byte-identical.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * WHY A SECOND COMPARISON IS THE ONLY EVIDENCE THAT COUNTS
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * A differential verdict is supposed to be a property of the document bytes and the identified
 * oracle artifact. It was not: the reference validator resolved terminology over a public network
 * service, so the same commit over the same corpus produced three `FALSE VALID` verdicts on one day
 * and none on another. `scripts/differential/terminology.mjs` removes the cause; this script is what
 * MEASURES the effect, because a configuration that intends determinism and a run that exhibits it
 * are different claims and only the second is evidence.
 *
 * IT NEVER SKIPS. THERE IS NO THIRD OUTCOME.
 * ------------------------------------------
 * No oracle artifact, an artifact whose identity cannot be established, declared terminology inputs
 * that cannot be honoured, no declared subset, a comparison that could not be run, or a document
 * that yielded no readable outcome on one side: every one of those reports **determinism NOT
 * demonstrated** and exits non-zero. A silent skip here would be worse than no check at all, because
 * a green job would then mean "the oracle was absent" and "the oracle answered the same way twice"
 * interchangeably. Two runs that both failed to obtain an answer are not two runs that agreed, which
 * is why `record.mjs` refuses to read matching records as agreement when either contains a document
 * without a readable outcome.
 *
 * WHAT IT REPEATS
 * ---------------
 * The DECLARED subset in `corpus/corpus.json` (`determinismSubset`), printed in full before the
 * first comparison so the log says what determinism was demonstrated over. It is a subset and not
 * the whole corpus because the differential job carries a declared 30 minute bound and 179 documents
 * do not fit through a JVM oracle three times. The subset is declared rather than sampled: a check
 * that chose its own documents each run would be measuring a different thing each run. Every
 * declared document is still digest-verified on both comparisons, subset or not.
 *
 * @packageDocumentation
 */

import {
  CorpusError,
  determinismSubset,
  loadDeclaration,
  provenanceLine,
} from "./differential/corpus.mjs";
import { ourFindings } from "./differential/findings.mjs";
import {
  formatOracleIdentity,
  ORACLE_RELEASE,
  oracleIdentity,
  OracleError,
} from "./differential/oracle.mjs";
import {
  determinismRefusal,
  determinismVerdict,
  exitCodeForDeterminism,
  formatDeterminismVerdict,
  formatRunRecord,
} from "./differential/record.mjs";
import { runComparison } from "./differential/run.mjs";
import {
  formatTerminologyInputs,
  resolveTerminologyInputs,
  TERMINOLOGY_INPUTS,
  TerminologyError,
} from "./differential/terminology.mjs";

/** Report the refusal and leave. Never zero, never silent. */
function refuse(reason) {
  const verdict = determinismRefusal(reason);
  for (const line of formatDeterminismVerdict(verdict)) console.error(line);
  process.exit(exitCodeForDeterminism(verdict));
}

function main() {
  let declaration;
  try {
    declaration = loadDeclaration();
  } catch (err) {
    refuse(
      `the corpus declaration could not be read, so there is nothing to compare twice: ` +
        `${err instanceof CorpusError ? err.message : String(err)}`,
    );
    return;
  }

  let subset;
  try {
    subset = determinismSubset(declaration);
  } catch (err) {
    refuse(err instanceof CorpusError ? err.message : String(err));
    return;
  }

  let terminology;
  try {
    terminology = resolveTerminologyInputs(TERMINOLOGY_INPUTS);
  } catch (err) {
    refuse(
      `the declared terminology inputs could not be obtained, so two comparisons could not be run ` +
        `under the same ones: ${err instanceof TerminologyError ? err.message : String(err)}`,
    );
    return;
  }
  const terminologyLine = formatTerminologyInputs(terminology);

  const jar = process.env.VALIDATOR_CLI_JAR;
  if (jar === undefined || jar === "") {
    refuse(
      `VALIDATOR_CLI_JAR is not set, so the oracle artifact could not be obtained. This check runs ` +
        `in the differential CI job, which downloads validator_cli.jar at the pinned release ` +
        `${ORACLE_RELEASE}; it does not skip when the jar is absent.`,
    );
    return;
  }

  let identity;
  try {
    identity = oracleIdentity(jar);
  } catch (err) {
    refuse(
      `the oracle artifact could not be identified, so two comparisons could not be run against the ` +
        `same one: ${err instanceof OracleError ? err.message : String(err)}`,
    );
    return;
  }

  const only = subset.map((d) => d.id);
  console.log(
    `differential:determinism: repeating ${String(only.length)} declared document(s) of the ` +
      `${String(declaration.documents.filter((d) => d.exclude === undefined).length)} the ` +
      `differential compares. Two comparisons, same corpus bytes, same oracle artifact, same ` +
      `declared terminology inputs.`,
  );
  for (const document of subset) {
    console.log(`  repeated: ${document.id} <- ${provenanceLine(declaration, document)}`);
  }
  console.log(formatOracleIdentity(identity));
  console.log(terminologyLine);

  const comparisons = [];
  for (const pass of [1, 2]) {
    try {
      const outcome = runComparison({
        jar,
        identity,
        declaration,
        terminology,
        ourFindings,
        only,
        scope: "subset",
      });
      comparisons.push(outcome);
      console.log(`\ncomparison ${String(pass)} of 2:`);
      for (const line of formatRunRecord(outcome.runRecord)) console.log(`  ${line}`);
    } catch (err) {
      if (err instanceof TerminologyError) {
        refuse(
          `comparison ${String(pass)} of 2 compared no document: ${err.message}`,
        );
        return;
      }
      refuse(
        `comparison ${String(pass)} of 2 could not be run: ` +
          `${err instanceof CorpusError ? err.message : String(err)}`,
      );
      return;
    }
  }

  const verdict = determinismVerdict(comparisons[0].runRecord, comparisons[1].runRecord);
  console.log("");
  for (const line of formatDeterminismVerdict(verdict)) {
    if (verdict.demonstrated) console.log(line);
    else console.error(line);
  }
  process.exit(exitCodeForDeterminism(verdict));
}

main();
