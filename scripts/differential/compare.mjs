/**
 * The differential's accounting: what agreement means per document, what "compared" counts, and
 * what the run prints.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * THE TWO INVARIANTS, UNCHANGED
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 *   1. **Never a false valid.** If the oracle reports an `error`/`fatal` on a document, `@cosyte/fhir`
 *      must NOT report it clean. This is the safety-critical direction: a validator that passes what
 *      the authoritative implementation fails is dangerous. Enforced hard.
 *   2. **No spurious errors on clean input.** On a document the oracle finds clean, we must not
 *      invent an `error`/`fatal`. Enforced hard, with ONE exemption, below.
 *
 * Comparison is on **issue presence + severity bucket + location**, never on diagnostic *text*: we
 * deliberately diverge on text (ours is PHI-redacted; the oracle echoes values). Where we are a
 * deliberate *subset* validator, the oracle finding an extra WARNING/INFORMATION we do not is a
 * **documented delta**, printed and not failed.
 *
 * THE FAIL-CLOSED PARSE-REFUSAL EXEMPTION
 * ----------------------------------------
 * A fail-closed *parse refusal* is exempt from Invariant 2: refusing unrecoverable structure (a
 * broken `_`-sibling alignment, HAPI #5738) is the safe, conservative direction, permitted even
 * where a more lenient oracle tolerates the input, and it can never be a false *valid* (we errored).
 * Invariant 1 still applies in full. The exemption is scoped to a thrown `FhirCodecError` from the
 * READER and to nothing else: a validation error stays a validation error.
 *
 * WHAT "COMPARED" MEANS
 * ---------------------
 * A document is compared only when BOTH sides produced a readable answer. If the oracle crashed,
 * timed out, wrote nothing, wrote something unparseable, or produced an outcome that cannot be
 * attributed to exactly one document, that document is not compared AND is not clean. Same on our
 * side: an unexpected throw is an answer we did not get, not an answer of "no findings". There is
 * deliberately no branch anywhere below that turns a missing answer into agreement.
 *
 * This module is pure: no filesystem, no process, no `dist/` import, so
 * `test/differential-harness.test.ts` grades every branch with no build and no JVM.
 *
 * @packageDocumentation
 */

/** The severities that make a finding an error for the purpose of both invariants. */
export const ERRORISH = new Set(["fatal", "error"]);

/** The per-document verdicts. Exactly one is assigned to every declared, included document. */
export const STATUS = Object.freeze({
  AGREE: "agree",
  FALSE_VALID: "false-valid",
  SPURIOUS_ERROR: "spurious-error",
  SAFE_REFUSAL: "safe-refusal",
  NO_ORACLE_OUTCOME: "no-oracle-outcome",
  NO_OWN_FINDINGS: "no-own-findings",
});

/** The two statuses that fail the run. */
const VIOLATIONS = new Set([STATUS.FALSE_VALID, STATUS.SPURIOUS_ERROR]);

function errorishOf(issues) {
  return issues.filter((i) => ERRORISH.has(String(i.severity)));
}

/**
 * Compare one document.
 *
 * @param input.id      the declared document id, used in every line printed about it
 * @param input.oracle  `{ ok: true, issues }` or `{ ok: false, reason }`
 * @param input.ours    `{ ok: true, issues, parseRefused }` or `{ ok: false, reason }`
 */
export function compareDocument(input) {
  const { id, oracle, ours } = input;

  if (oracle.ok !== true) {
    return {
      id,
      status: STATUS.NO_ORACLE_OUTCOME,
      compared: false,
      clean: false,
      violation: false,
      detail: oracle.reason ?? "the oracle yielded no readable outcome",
    };
  }
  if (ours.ok !== true) {
    return {
      id,
      status: STATUS.NO_OWN_FINDINGS,
      compared: false,
      clean: false,
      violation: false,
      detail: ours.reason ?? "this library yielded no readable findings",
    };
  }

  const oracleErrors = errorishOf(oracle.issues);
  const ourErrors = errorishOf(ours.issues);
  const base = {
    id,
    compared: true,
    // A document the oracle errors on is NEVER clean here, whatever we found. That is the
    // safety-critical direction stated as an assignment rather than as a comment.
    clean: oracleErrors.length === 0 && ourErrors.length === 0,
    oracleErrors: oracleErrors.length,
    oracleTotal: oracle.issues.length,
    ourErrors: ourErrors.length,
    ourTotal: ours.issues.length,
    delta: oracle.issues.length - ours.issues.length,
  };

  if (oracleErrors.length > 0 && ourErrors.length === 0) {
    return {
      ...base,
      status: STATUS.FALSE_VALID,
      violation: true,
      detail: `the oracle reports ${String(oracleErrors.length)} error(s), we report none`,
      oracleFindings: oracleErrors,
    };
  }
  if (oracleErrors.length === 0 && ourErrors.length > 0) {
    if (ours.parseRefused === true) {
      return {
        ...base,
        status: STATUS.SAFE_REFUSAL,
        violation: false,
        detail: "reader failed closed (safe refusal); oracle lenient, exempt from Invariant 2",
      };
    }
    return {
      ...base,
      status: STATUS.SPURIOUS_ERROR,
      violation: true,
      detail: `the oracle is clean, we report ${String(ourErrors.length)} error(s)`,
      ourFindings: ourErrors,
    };
  }
  return { ...base, status: STATUS.AGREE, violation: false, detail: "" };
}

/**
 * Fold the per-document records plus the declared exclusions into the numbers the run prints and
 * exits on. `compared` counts ONLY documents for which both sides produced an answer; an excluded
 * document is not a record here at all and therefore cannot leak into the count.
 */
export function summarize(input) {
  const { records, exclusions = [], floor } = input;
  const compared = records.filter((r) => r.compared);
  const violations = records.filter((r) => VIOLATIONS.has(r.status));
  const unusable = records.filter((r) => !r.compared);
  return {
    declared: records.length + exclusions.length,
    compared: compared.length,
    clean: compared.filter((r) => r.clean).length,
    violations,
    unusable,
    exclusions,
    floor,
    meetsFloor: compared.length >= floor,
  };
}

/** One line per document, the shape the log has always had. */
export function formatRecord(record) {
  switch (record.status) {
    case STATUS.FALSE_VALID:
      return `FALSE VALID: ${record.id}, ${record.detail}.`;
    case STATUS.SPURIOUS_ERROR:
      return `SPURIOUS ERROR: ${record.id}, ${record.detail}.`;
    case STATUS.SAFE_REFUSAL:
      return `ok ${record.id}: ${record.detail}.`;
    case STATUS.NO_ORACLE_OUTCOME:
      return `NOT COMPARED: ${record.id}, ${record.detail}. Not counted, and not reported clean.`;
    case STATUS.NO_OWN_FINDINGS:
      return `NOT COMPARED: ${record.id}, ${record.detail}. Not counted, and not reported clean.`;
    default:
      return (
        `ok ${record.id}: oracle ${String(record.oracleErrors)} err / ${String(record.oracleTotal)} total; ` +
        `ours ${String(record.ourErrors)} err / ${String(record.ourTotal)} total` +
        (record.delta > 0
          ? ` (delta ${String(record.delta)}: the oracle's extra profile/terminology findings, expected)`
          : "")
      );
  }
}

/**
 * The exclusions block. A declared document held out of the comparison is printed WITH the recorded
 * reason, every run: an exclusion nobody sees is indistinguishable from a corpus that quietly
 * shrank.
 */
export function formatExclusions(exclusions) {
  if (exclusions.length === 0) return ["excluded: none. Every declared document was compared."];
  const lines = [
    `excluded from comparison: ${String(exclusions.length)} declared document(s), not counted toward the compared count.`,
  ];
  for (const e of exclusions) lines.push(`  - ${e.id}: ${e.reason}`);
  return lines;
}

/** The closing block: the compared count, the oracle identity, and why the run passed or failed. */
export function formatSummary(summary, identityLine) {
  const lines = [
    `differential: compared ${String(summary.compared)} document(s) against the oracle ` +
      `(${String(summary.declared)} declared, ${String(summary.exclusions.length)} excluded, ` +
      `${String(summary.unusable.length)} without a readable outcome on one side).`,
    identityLine,
  ];
  if (summary.violations.length > 0) {
    lines.push(`differential: ${String(summary.violations.length)} invariant violation(s), see above.`);
  }
  if (!summary.meetsFloor) {
    lines.push(
      `differential: compared ${String(summary.compared)} document(s), and the declared floor is ` +
        `${String(summary.floor)}. Short by ${String(summary.floor - summary.compared)}.`,
    );
  }
  return lines;
}

/** Non-zero when an invariant was violated or the corpus did not reach its declared floor. */
export function exitCodeFor(summary) {
  return summary.violations.length > 0 || !summary.meetsFloor ? 1 : 0;
}
