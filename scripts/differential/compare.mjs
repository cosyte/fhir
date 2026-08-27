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
 * THE TERMINOLOGY CLASS: A DOCUMENTED DELTA, NOT A VERDICT
 * --------------------------------------------------------
 * This library declaredly vendors no terminology content, so an oracle finding that exists only
 * because the ORACLE resolved terminology is a known delta between the two, and it must be accounted
 * as one EVERY TIME rather than deciding, run by run, whether a document is a false valid. It used
 * to decide exactly that: three documents landed in the safety-critical `FALSE VALID` bucket on one
 * day and not on another, because a remote terminology service answered differently.
 *
 * So {@link isTerminologyFinding} classifies such a finding out of BOTH invariants above. It is
 * counted, printed and carried in the run record; it is never a violation, in either direction. Two
 * things that classification deliberately is NOT:
 *
 *   - It is not a licence to widen. The predicate keys on the VALIDATOR'S OWN vocabulary and on
 *     nothing else (see {@link TERMINOLOGY_ISSUE_CODES}), and an oracle `error`/`fatal` outside it
 *     still decides Invariant 1 in full: a document the oracle errors on for a non-terminology
 *     reason, which this library reports clean, is a false valid and fails the run.
 *   - It is not a way to compare fewer documents. A terminology-classified document is still
 *     COMPARED and still counted; only the finding is held out of the two decisions.
 *
 * A note on the direction that is easy to get wrong. When the oracle's ONLY errors are terminology
 * findings and this library reports an error of its own, the old accounting called that agreement
 * (both sides errored). Removing the terminology finding naively would turn it into a SPURIOUS
 * ERROR, which is a violation the ABSENCE of a terminology finding would have decided, and the whole
 * point is that a terminology finding decides neither direction. That document is recorded as
 * {@link STATUS.TERMINOLOGY_DELTA}, which is not a violation, and is counted.
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
  TERMINOLOGY_DELTA: "terminology-delta",
  NO_ORACLE_OUTCOME: "no-oracle-outcome",
  NO_OWN_FINDINGS: "no-own-findings",
});

/** The two statuses that fail the run. `TERMINOLOGY_DELTA` is deliberately not one of them. */
const VIOLATIONS = new Set([STATUS.FALSE_VALID, STATUS.SPURIOUS_ERROR]);

/** The recorded class a terminology-attributable finding is accounted under. */
export const TERMINOLOGY_CLASS = "terminology";

/**
 * The validator's own terminology issue-type CodeSystem. A finding whose message id is drawn from
 * it is one the VALIDATOR says came out of terminology resolution, which is the strongest signal
 * available and the one that does not depend on our reading of a code's meaning.
 */
export const TX_ISSUE_TYPE_SYSTEM = "http://hl7.org/fhir/tools/CodeSystem/tx-issue-type";

/**
 * The R4 `IssueType` values that only terminology checking produces.
 *
 * `code-invalid` is the whole list on purpose. It is what the validator emits when a code is not
 * valid in the system or value set it was checked against, and checking that requires terminology
 * content this library declaredly does not vendor. The corpus declaration's own measured exclusion
 * reasons record it under exactly that description.
 *
 * **`not-found` is DELIBERATELY ABSENT.** The validator also uses it for a definition it could not
 * resolve in its own loaded packages, which is profile resolution and not terminology, and the
 * corpus declaration records exclusions under that reading too. Admitting it here on the code alone
 * would classify a non-terminology error out of Invariant 1, which is the one direction that may
 * never widen. A `not-found` that really is terminology arrives with a message id from
 * {@link TX_ISSUE_TYPE_SYSTEM} and is classified by that arm instead.
 *
 * `invalid` is absent for the same reason: the measured exclusions record it as a URL or canonical
 * reference the validator resolves and this library does not, which is not terminology.
 */
export const TERMINOLOGY_ISSUE_CODES = Object.freeze(new Set(["code-invalid"]));

/**
 * Message ids that NAME terminology in the validator's own message vocabulary
 * (`Terminology_TX_System_NotKnown`, `TERMINOLOGY_TX_*`, and the `tx-` family). A prefix, not a
 * substring: a substring match would classify any message that merely mentions a code.
 */
export const TERMINOLOGY_MESSAGE_ID_RE = /^(?:terminology|tx)[_-]/i;

/**
 * Whether one oracle finding is attributable to terminology resolution.
 *
 * Three arms, each of which is the VALIDATOR's own declaration about its own finding, never a
 * reading of document content: the message id's code system, the R4 issue code, and a message id
 * that names terminology. Nothing here looks at a location, a display value or any diagnostic text.
 */
export function isTerminologyFinding(finding) {
  if (finding === null || typeof finding !== "object") return false;
  if (String(finding.messageSystem ?? "") === TX_ISSUE_TYPE_SYSTEM) return true;
  if (TERMINOLOGY_ISSUE_CODES.has(String(finding.code ?? ""))) return true;
  return TERMINOLOGY_MESSAGE_ID_RE.test(String(finding.messageId ?? ""));
}

/** The recorded class of a finding, or `null` where it carries none. */
export function classifyFinding(finding) {
  return isTerminologyFinding(finding) ? TERMINOLOGY_CLASS : null;
}

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
  // The terminology class, held out of BOTH invariants. `deciding` is what actually decides them.
  const terminologyFindings = oracle.issues.filter(isTerminologyFinding);
  const terminologyErrors = errorishOf(terminologyFindings);
  const deciding = oracleErrors.filter((i) => !isTerminologyFinding(i));
  const base = {
    id,
    compared: true,
    // A document the oracle errors on is NEVER clean here, whatever we found, and a terminology
    // finding does not buy it "clean" either. That is the safety-critical direction stated as an
    // assignment rather than as a comment.
    clean: oracleErrors.length === 0 && ourErrors.length === 0,
    oracleErrors: oracleErrors.length,
    oracleTotal: oracle.issues.length,
    ourErrors: ourErrors.length,
    ourTotal: ours.issues.length,
    delta: oracle.issues.length - ours.issues.length,
    terminology: terminologyFindings.length,
    terminologyErrors: terminologyErrors.length,
  };

  if (deciding.length > 0 && ourErrors.length === 0) {
    return {
      ...base,
      status: STATUS.FALSE_VALID,
      violation: true,
      detail: `the oracle reports ${String(deciding.length)} error(s) not attributable to terminology, we report none`,
      oracleFindings: deciding,
    };
  }
  if (deciding.length === 0 && ourErrors.length > 0) {
    if (ours.parseRefused === true) {
      return {
        ...base,
        status: STATUS.SAFE_REFUSAL,
        violation: false,
        detail: "reader failed closed (safe refusal); oracle lenient, exempt from Invariant 2",
      };
    }
    if (terminologyErrors.length > 0) {
      return {
        ...base,
        status: STATUS.TERMINOLOGY_DELTA,
        violation: false,
        detail:
          `the oracle's only error(s) are terminology-attributable ` +
          `(${String(terminologyErrors.length)} of ${String(terminologyFindings.length)} ` +
          `${TERMINOLOGY_CLASS} finding(s)), and we report ${String(ourErrors.length)} error(s) of ` +
          `our own; a terminology finding decides neither invariant`,
        terminologyFindings,
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
  if (deciding.length === 0 && ourErrors.length === 0 && terminologyErrors.length > 0) {
    return {
      ...base,
      status: STATUS.TERMINOLOGY_DELTA,
      violation: false,
      detail:
        `the oracle's only error(s) are terminology-attributable ` +
        `(${String(terminologyErrors.length)} of ${String(terminologyFindings.length)} ` +
        `${TERMINOLOGY_CLASS} finding(s)); this library vendors no terminology content, so the ` +
        `finding is a documented delta and not a false valid`,
      terminologyFindings,
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
  const terminology = records.filter((r) => Number(r.terminology ?? 0) > 0);
  return {
    declared: records.length + exclusions.length,
    compared: compared.length,
    clean: compared.filter((r) => r.clean).length,
    violations,
    unusable,
    exclusions,
    floor,
    meetsFloor: compared.length >= floor,
    // The terminology class, counted rather than decided. `terminologyDocuments` is how many
    // documents carried such a finding at all; `terminologyDeltas` is how many had their verdict
    // held out of both invariants because of one.
    terminologyDocuments: terminology.length,
    terminologyFindings: terminology.reduce((n, r) => n + Number(r.terminology ?? 0), 0),
    terminologyDeltas: records.filter((r) => r.status === STATUS.TERMINOLOGY_DELTA).length,
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
    case STATUS.TERMINOLOGY_DELTA:
      // Names the affected document and the count, so the class is auditable per document and not
      // only in the closing total. Severities, locations and codes only, never diagnostic text.
      return (
        `ok ${record.id}: ${TERMINOLOGY_CLASS} class, ` +
        `${String(record.terminology ?? 0)} terminology-attributable oracle finding(s) ` +
        `(${String(record.terminologyErrors ?? 0)} of error severity) classified out of both ` +
        `invariants; ${record.detail}.`
      );
    case STATUS.NO_ORACLE_OUTCOME:
      return `NOT COMPARED: ${record.id}, ${record.detail}. Not counted, and not reported clean.`;
    case STATUS.NO_OWN_FINDINGS:
      return `NOT COMPARED: ${record.id}, ${record.detail}. Not counted, and not reported clean.`;
    default:
      return (
        `ok ${record.id}: oracle ${String(record.oracleErrors)} err / ${String(record.oracleTotal)} total; ` +
        `ours ${String(record.ourErrors)} err / ${String(record.ourTotal)} total` +
        (Number(record.terminology ?? 0) > 0
          ? `; ${String(record.terminology)} ${TERMINOLOGY_CLASS} finding(s) classified out of both invariants`
          : "") +
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

/**
 * The closing block: the compared count, the oracle identity, the terminology inputs and the
 * terminology accounting, and why the run passed or failed.
 *
 * `terminologyLine` is optional so the pure accounting tests can call this with the identity alone;
 * every real run passes it, because a compared count is not reproducible without knowing which
 * terminology answers the run was capable of.
 */
export function formatSummary(summary, identityLine, terminologyLine) {
  const lines = [
    `differential: compared ${String(summary.compared)} document(s) against the oracle ` +
      `(${String(summary.declared)} declared, ${String(summary.exclusions.length)} excluded, ` +
      `${String(summary.unusable.length)} without a readable outcome on one side).`,
    identityLine,
  ];
  if (terminologyLine !== undefined) lines.push(terminologyLine);
  lines.push(
    `differential: ${String(summary.terminologyDocuments ?? 0)} document(s) carried a ` +
      `terminology-attributable oracle finding (${String(summary.terminologyFindings ?? 0)} ` +
      `finding(s) in total, ${String(summary.terminologyDeltas ?? 0)} document(s) whose verdict ` +
      `turned on one). Every one is classified out of both invariants under the ${TERMINOLOGY_CLASS} ` +
      `class and counted: this library vendors no terminology content, so such a finding is a ` +
      `documented delta and never decides a false valid or a spurious error.`,
  );
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
