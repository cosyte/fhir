/**
 * The differential's accounting: what agreement means per document, what "compared" counts, what an
 * exclusion prints, and the one direction that is never allowed to be reported clean.
 *
 * NO JVM. `scripts/differential/compare.mjs` is pure: no filesystem, no process, no `dist/` import.
 * Every branch below is graded in a container with no Java, which is where this suite runs.
 */

import { describe, expect, it } from "vitest";

import {
  classifyFinding,
  compareDocument,
  ERRORISH,
  exitCodeFor,
  formatExclusions,
  formatRecord,
  formatSummary,
  isTerminologyFinding,
  STATUS,
  summarize,
  TERMINOLOGY_CLASS,
  TERMINOLOGY_ISSUE_CODES,
  TX_ISSUE_TYPE_SYSTEM,
} from "../scripts/differential/compare.mjs";
import type { Record_ } from "../scripts/differential/compare.mjs";

const err = (location = "Patient.gender") => ({ severity: "error", location });
const fatal = (location = "") => ({ severity: "fatal", location });
const warn = (location = "Patient.name") => ({ severity: "warning", location });
const info = (location = "Patient") => ({ severity: "information", location });

/** An oracle error the validator's own vocabulary says came out of terminology resolution. */
const txErr = (location = "Observation.code.coding[0].code") => ({
  severity: "error",
  location,
  code: "code-invalid",
});

/** The same, said the other way: a message id drawn from the validator's tx issue-type system. */
const txNotFound = (location = "Observation.code.coding[0].system") => ({
  severity: "error",
  location,
  code: "not-found",
  messageId: "not-found",
  messageSystem: TX_ISSUE_TYPE_SYSTEM,
});

const oracleClean = { ok: true as const, issues: [] };
const oursClean = { ok: true as const, issues: [], parseRefused: false };

function record(over: Partial<Record_> = {}): Record_ {
  const base: Record_ = {
    id: "x",
    status: STATUS.AGREE,
    compared: true,
    clean: true,
    violation: false,
    detail: "",
  };
  return { ...base, ...over };
}

describe("a document the oracle errors on is never reported clean", () => {
  it("flags a false valid when the oracle errors and we do not", () => {
    // "WHEN the oracle reports an error or fatal on a document THE SYSTEM SHALL NOT report that
    // document clean"
    const result = compareDocument({
      id: "corpus/a.json",
      oracle: { ok: true, issues: [err(), warn()] },
      ours: oursClean,
    });
    expect(result.status).toBe(STATUS.FALSE_VALID);
    expect(result.clean).toBe(false);
    expect(result.violation).toBe(true);
    expect(formatRecord(result)).toContain("FALSE VALID");
  });

  it("treats a fatal exactly as an error, in both directions", () => {
    expect(ERRORISH.has("fatal")).toBe(true);
    expect(ERRORISH.has("error")).toBe(true);
    expect(ERRORISH.has("warning")).toBe(false);
    expect(ERRORISH.has("information")).toBe(false);
    const result = compareDocument({
      id: "corpus/a.json",
      oracle: { ok: true, issues: [fatal()] },
      ours: oursClean,
    });
    expect(result.status).toBe(STATUS.FALSE_VALID);
  });

  it("is still not clean when BOTH sides error, which is agreement and not a violation", () => {
    const result = compareDocument({
      id: "corpus/a.json",
      oracle: { ok: true, issues: [err()] },
      ours: { ok: true, issues: [err()], parseRefused: false },
    });
    expect(result.status).toBe(STATUS.AGREE);
    expect(result.violation).toBe(false);
    expect(result.clean).toBe(false);
  });

  it("never reports clean for an oracle error, whatever the shape of our own findings", () => {
    const ourShapes = [
      { ok: true as const, issues: [], parseRefused: false },
      { ok: true as const, issues: [warn()], parseRefused: false },
      { ok: true as const, issues: [err()], parseRefused: false },
      { ok: true as const, issues: [fatal()], parseRefused: true },
      { ok: false as const, reason: "the reader threw" },
    ];
    for (const ours of ourShapes) {
      const result = compareDocument({
        id: "corpus/a.json",
        oracle: { ok: true, issues: [err()] },
        ours,
      });
      expect(result.clean, JSON.stringify(ours)).toBe(false);
    }
  });
});

describe("a terminology-attributable finding is a recorded class, never a verdict", () => {
  it("classifies on the VALIDATOR's own vocabulary, and on nothing else", () => {
    expect(isTerminologyFinding(txErr())).toBe(true);
    expect(isTerminologyFinding(txNotFound())).toBe(true);
    expect(
      isTerminologyFinding({
        severity: "error",
        location: "x",
        messageId: "Terminology_TX_System_NotKnown",
      }),
    ).toBe(true);
    expect(classifyFinding(txErr())).toBe(TERMINOLOGY_CLASS);
    // The three shapes the corpus declaration's measured reasons record as NOT terminology.
    expect(
      isTerminologyFinding({
        severity: "error",
        location: "Patient.identifier[0].system",
        code: "invalid",
      }),
    ).toBe(false);
    expect(
      isTerminologyFinding({
        severity: "error",
        location: "Questionnaire.item[0]",
        code: "structure",
      }),
    ).toBe(false);
    expect(isTerminologyFinding({ severity: "error", location: "x", code: "invariant" })).toBe(
      false,
    );
    expect(isTerminologyFinding({ severity: "error", location: "x", code: "business-rule" })).toBe(
      false,
    );
    expect(classifyFinding(err())).toBeNull();
  });

  it("does NOT classify a bare not-found, which is also an unresolved definition", () => {
    // The corpus declaration records `not-found` as "a definition the reference validator could not
    // resolve in its own loaded packages", which is profile resolution and not terminology.
    // Admitting it on the code alone would classify a non-terminology error out of Invariant 1.
    expect(isTerminologyFinding({ severity: "error", location: "x", code: "not-found" })).toBe(
      false,
    );
    expect(TERMINOLOGY_ISSUE_CODES.has("not-found")).toBe(false);
    expect(TERMINOLOGY_ISSUE_CODES.has("invalid")).toBe(false);
    expect(TERMINOLOGY_ISSUE_CODES.has("code-invalid")).toBe(true);
  });

  it("does not let a message id that merely mentions a code pass as terminology", () => {
    expect(
      isTerminologyFinding({ severity: "error", location: "x", messageId: "CODE_IS_WRONG" }),
    ).toBe(false);
    expect(
      isTerminologyFinding({ severity: "error", location: "x", messageId: "SOMETHING_TX_ISH" }),
    ).toBe(false);
  });

  it("classifies the finding out of BOTH invariants, counts it, and prints the document", () => {
    // "WHEN the oracle reports a finding that is attributable to terminology resolution, THE SYSTEM
    // SHALL classify that finding out of both differential invariants under a recorded terminology
    // class, count it, and print the count and the affected document"
    const result = compareDocument({
      id: "hl7-fhir-r4-examples/chargeitem-example.json",
      oracle: { ok: true, issues: [txErr(), warn()] },
      ours: oursClean,
    });
    expect(result.status).toBe(STATUS.TERMINOLOGY_DELTA);
    expect(result.violation).toBe(false);
    expect(result.compared).toBe(true);
    expect(result.terminology).toBe(1);
    expect(result.terminologyErrors).toBe(1);
    const line = formatRecord(result);
    expect(line).toContain("hl7-fhir-r4-examples/chargeitem-example.json");
    expect(line).toContain(TERMINOLOGY_CLASS);
    expect(line).toContain("1 terminology-attributable oracle finding(s)");
    expect(line).not.toContain("FALSE VALID");
  });

  it("is still COMPARED and still counted: the class is not a route to comparing less", () => {
    const records = [
      compareDocument({ id: "a", oracle: { ok: true, issues: [txErr()] }, ours: oursClean }),
      compareDocument({ id: "b", oracle: oracleClean, ours: oursClean }),
    ];
    const summary = summarize({ records, floor: 2 });
    expect(summary.compared).toBe(2);
    expect(summary.meetsFloor).toBe(true);
    expect(summary.violations).toHaveLength(0);
    expect(exitCodeFor(summary)).toBe(0);
  });

  it("does not report a terminology-only oracle error as clean, either", () => {
    const result = compareDocument({
      id: "a",
      oracle: { ok: true, issues: [txErr()] },
      ours: oursClean,
    });
    expect(result.clean).toBe(false);
  });

  it("does not turn agreement into a SPURIOUS ERROR when the oracle's only errors are terminology", () => {
    // The absence of a terminology finding must not decide a violation any more than its presence
    // may. Stripping the finding naively would flip this document from agreement to a violation.
    const result = compareDocument({
      id: "a",
      oracle: { ok: true, issues: [txErr()] },
      ours: { ok: true, issues: [err()], parseRefused: false },
    });
    expect(result.status).toBe(STATUS.TERMINOLOGY_DELTA);
    expect(result.violation).toBe(false);
  });

  it("counts and prints how many documents carried such a finding", () => {
    // "SHALL print how many documents carried such a finding"
    const records = [
      compareDocument({ id: "a", oracle: { ok: true, issues: [txErr()] }, ours: oursClean }),
      compareDocument({
        id: "b",
        oracle: { ok: true, issues: [txNotFound(), txErr()] },
        ours: oursClean,
      }),
      compareDocument({ id: "c", oracle: oracleClean, ours: oursClean }),
    ];
    const summary = summarize({ records, floor: 3 });
    expect(summary.terminologyDocuments).toBe(2);
    expect(summary.terminologyFindings).toBe(3);
    expect(summary.terminologyDeltas).toBe(2);
    const text = formatSummary(summary, "oracle: x").join("\n");
    expect(text).toContain("2 document(s) carried a terminology-attributable oracle finding");
    expect(text).toContain("3 finding(s) in total");
    expect(text).toContain(TERMINOLOGY_CLASS);
  });

  it("treats a code or system the declared inputs cannot resolve under the same class", () => {
    // "IF the oracle reports that a code or code system could not be resolved because it is absent
    // from the terminology inputs the run declared, THEN THE SYSTEM SHALL treat that finding under
    // the same recorded terminology class, SHALL NOT report the document as a violation on account
    // of it"
    const result = compareDocument({
      id: "a",
      oracle: { ok: true, issues: [txNotFound()] },
      ours: oursClean,
    });
    expect(result.status).toBe(STATUS.TERMINOLOGY_DELTA);
    expect(result.violation).toBe(false);
    expect(result.terminology).toBe(1);
    expect(summarize({ records: [result], floor: 1 }).violations).toHaveLength(0);
  });

  it("records the count on an AGREE document that carried one too, and prints it", () => {
    const result = compareDocument({
      id: "a",
      oracle: { ok: true, issues: [txErr(), err("Patient.gender")] },
      ours: { ok: true, issues: [err("Patient.gender")], parseRefused: false },
    });
    expect(result.status).toBe(STATUS.AGREE);
    expect(result.terminology).toBe(1);
    expect(formatRecord(result)).toContain(`1 ${TERMINOLOGY_CLASS} finding(s)`);
  });

  it("NEVER classifies a non-terminology error out of the false-valid direction", () => {
    // "WHEN the oracle reports an error or fatal finding that is NOT attributable to terminology
    // resolution and this library reports no error on the same document, THE SYSTEM SHALL still
    // record that document as a false valid and fail the run."
    for (const finding of [
      err(),
      fatal("Bundle"),
      { severity: "error", location: "Patient.identifier[0].system", code: "invalid" },
      { severity: "error", location: "Questionnaire.item[0]", code: "structure" },
      { severity: "error", location: "x", code: "not-found" },
      { severity: "fatal", location: "x", code: "exception" },
    ]) {
      const result = compareDocument({
        id: "a",
        // Beside a terminology finding, which must not launder the one that decides.
        oracle: { ok: true, issues: [txErr(), finding] },
        ours: oursClean,
      });
      expect(result.status, JSON.stringify(finding)).toBe(STATUS.FALSE_VALID);
      expect(result.violation, JSON.stringify(finding)).toBe(true);
      expect(result.clean, JSON.stringify(finding)).toBe(false);
      const summary = summarize({ records: [result], floor: 1 });
      expect(exitCodeFor(summary), JSON.stringify(finding)).toBe(1);
      // The printed findings are the DECIDING ones, so a reader is not sent looking at the
      // terminology finding for the reason the run failed.
      expect(result.oracleFindings).toEqual([finding]);
    }
  });

  it("still fails the run for a non-terminology error even when terminology findings outnumber it", () => {
    const result = compareDocument({
      id: "a",
      oracle: { ok: true, issues: [txErr(), txErr(), txNotFound(), err("Patient.gender")] },
      ours: oursClean,
    });
    expect(result.status).toBe(STATUS.FALSE_VALID);
    expect(result.terminology).toBe(3);
    expect(formatRecord(result)).toContain("not attributable to terminology");
  });
});

describe("no spurious errors on clean input, with the fail-closed parse refusal exempt", () => {
  it("flags a spurious error when the oracle is clean and we error", () => {
    const result = compareDocument({
      id: "corpus/a.json",
      oracle: oracleClean,
      ours: { ok: true, issues: [err()], parseRefused: false },
    });
    expect(result.status).toBe(STATUS.SPURIOUS_ERROR);
    expect(result.violation).toBe(true);
    expect(formatRecord(result)).toContain("SPURIOUS ERROR");
  });

  it("exempts a fail-closed READER refusal, which is the safe conservative direction", () => {
    const result = compareDocument({
      id: "corpus/quirk-primitive-extension-misaligned.json",
      oracle: oracleClean,
      ours: { ok: true, issues: [fatal()], parseRefused: true },
    });
    expect(result.status).toBe(STATUS.SAFE_REFUSAL);
    expect(result.violation).toBe(false);
    expect(result.compared).toBe(true);
    expect(formatRecord(result)).toContain("failed closed");
  });

  it("does not extend that exemption to a validation error", () => {
    const result = compareDocument({
      id: "corpus/a.json",
      oracle: oracleClean,
      ours: { ok: true, issues: [err()], parseRefused: false },
    });
    expect(result.status).toBe(STATUS.SPURIOUS_ERROR);
  });

  it("prints the oracle's extra warning/information findings as a documented delta, not a failure", () => {
    const result = compareDocument({
      id: "corpus/a.json",
      oracle: { ok: true, issues: [warn(), info(), info()] },
      ours: { ok: true, issues: [info()], parseRefused: false },
    });
    expect(result.status).toBe(STATUS.AGREE);
    expect(result.violation).toBe(false);
    expect(result.clean).toBe(true);
    expect(formatRecord(result)).toContain("delta 2");
  });
});

describe("compared counts only documents for which BOTH sides produced an answer", () => {
  it("does not count, and does not clean, a document the oracle gave no outcome for", () => {
    // "IF the oracle yields no readable outcome for a document ... THEN THE SYSTEM SHALL neither
    // count that document as compared nor report it clean"
    for (const reason of [
      "the oracle exceeded its 600000ms time bound",
      "the oracle wrote no readable output: ENOENT",
      "the oracle's output is not parseable JSON",
      "the oracle returned no outcome that could be attributed to this document",
    ]) {
      const result = compareDocument({
        id: "corpus/a.json",
        oracle: { ok: false, reason },
        ours: oursClean,
      });
      expect(result.status).toBe(STATUS.NO_ORACLE_OUTCOME);
      expect(result.compared).toBe(false);
      expect(result.clean).toBe(false);
      expect(formatRecord(result)).toContain("Not counted, and not reported clean");
    }
  });

  it("does not count a document THIS library produced no findings for either", () => {
    // "WHEN a run finishes THE SYSTEM SHALL print a compared count that counts only documents for
    // which both the oracle's outcome and this library's own findings were obtained"
    const result = compareDocument({
      id: "corpus/a.json",
      oracle: oracleClean,
      ours: { ok: false, reason: "validateResource threw" },
    });
    expect(result.status).toBe(STATUS.NO_OWN_FINDINGS);
    expect(result.compared).toBe(false);
    expect(result.clean).toBe(false);
  });

  it("counts a document exactly when both sides answered", () => {
    const both = [
      { oracle: oracleClean, ours: oursClean, compared: true },
      { oracle: { ok: false as const, reason: "r" }, ours: oursClean, compared: false },
      { oracle: oracleClean, ours: { ok: false as const, reason: "r" }, compared: false },
      {
        oracle: { ok: false as const, reason: "r" },
        ours: { ok: false as const, reason: "r" },
        compared: false,
      },
    ];
    for (const c of both) {
      expect(compareDocument({ id: "x", oracle: c.oracle, ours: c.ours }).compared).toBe(
        c.compared,
      );
    }
  });

  it("folds the records into a compared count that excludes every unusable one", () => {
    const records = [
      compareDocument({ id: "a", oracle: oracleClean, ours: oursClean }),
      compareDocument({ id: "b", oracle: oracleClean, ours: oursClean }),
      compareDocument({ id: "c", oracle: { ok: false, reason: "crashed" }, ours: oursClean }),
    ];
    const summary = summarize({ records, floor: 2 });
    expect(summary.compared).toBe(2);
    expect(summary.unusable.length).toBe(1);
    expect(summary.meetsFloor).toBe(true);
    expect(exitCodeFor(summary)).toBe(0);
  });
});

describe("an excluded document is printed with its reason and never counted", () => {
  const exclusions = [
    {
      id: "fhir-test-cases/r4/bundle-with-no-type.json",
      corpus: "fhir-test-cases",
      path: "r4/bundle-with-no-type.json",
      reason: "deliberately invalid corpus fixture: it omits Bundle.type, which R4 makes 1..1",
    },
  ];

  it("prints the id together with the recorded reason", () => {
    // "WHEN a declared document is deliberately excluded from comparison THE SYSTEM SHALL print it
    // together with the recorded reason for its exclusion"
    const lines = formatExclusions(exclusions).join("\n");
    expect(lines).toContain("fhir-test-cases/r4/bundle-with-no-type.json");
    expect(lines).toContain("deliberately invalid corpus fixture");
    expect(lines).toContain("not counted toward the compared count");
  });

  it("says so plainly when nothing is excluded", () => {
    expect(formatExclusions([]).join("\n")).toContain("none");
  });

  it("does not count an exclusion toward the compared count, and does count it as declared", () => {
    const records = [compareDocument({ id: "a", oracle: oracleClean, ours: oursClean })];
    const summary = summarize({ records, exclusions, floor: 1 });
    expect(summary.compared).toBe(1);
    expect(summary.declared).toBe(2);
    expect(summary.exclusions).toHaveLength(1);
  });
});

describe("the run prints the count and the oracle identity, and exits on both failures", () => {
  const identityLine = "oracle: validator_cli.jar release 6.10.2, 187697077 bytes, sha256 ".padEnd(
    80,
    "a",
  );

  it("prints the compared count beside the oracle identity", () => {
    const summary = summarize({
      records: [compareDocument({ id: "a", oracle: oracleClean, ours: oursClean })],
      floor: 1,
    });
    const lines = formatSummary(summary, identityLine);
    expect(lines[0]).toContain("compared 1 document(s)");
    expect(lines).toContain(identityLine);
  });

  it("exits non-zero and names the shortfall when the floor is not met", () => {
    const summary = summarize({
      records: [compareDocument({ id: "a", oracle: oracleClean, ours: oursClean })],
      floor: 100,
    });
    expect(summary.meetsFloor).toBe(false);
    expect(exitCodeFor(summary)).toBe(1);
    const text = formatSummary(summary, identityLine).join("\n");
    expect(text).toContain("the declared floor is 100");
    expect(text).toContain("Short by 99");
  });

  it("exits non-zero on an invariant violation even when the floor is met", () => {
    const summary = summarize({
      records: [
        compareDocument({ id: "a", oracle: { ok: true, issues: [err()] }, ours: oursClean }),
      ],
      floor: 1,
    });
    expect(exitCodeFor(summary)).toBe(1);
    expect(formatSummary(summary, identityLine).join("\n")).toContain("invariant violation(s)");
  });

  it("counts a clean document as clean only when neither side errored", () => {
    const summary = summarize({
      records: [
        record({ id: "a", clean: true }),
        record({ id: "b", clean: false, status: STATUS.SAFE_REFUSAL }),
      ],
      floor: 1,
    });
    expect(summary.clean).toBe(1);
    expect(summary.compared).toBe(2);
  });
});
