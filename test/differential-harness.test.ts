/**
 * The differential's accounting: what agreement means per document, what "compared" counts, what an
 * exclusion prints, and the one direction that is never allowed to be reported clean.
 *
 * NO JVM. `scripts/differential/compare.mjs` is pure: no filesystem, no process, no `dist/` import.
 * Every branch below is graded in a container with no Java, which is where this suite runs.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";

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
import { CorpusError } from "../scripts/differential/corpus.mjs";
import { runComparison } from "../scripts/differential/run.mjs";
import type { OwnAnswer, OwnOptions } from "../scripts/differential/run.mjs";
import {
  formatReachReport,
  loadNewlyEvaluatedRows,
  NOT_REACHED,
  ROW_ANSWER,
  ucumExercised,
  ucumShortfall,
} from "../scripts/differential/uscore.mjs";
import type { UsCoreRow } from "../scripts/differential/uscore.mjs";
import {
  CONCEPT,
  CORPUS,
  observation,
  QUANTITY,
  recordingOracle,
  STRING,
  US_CORE,
  usCoreWorld,
} from "./_uscore-world.js";
import type { World, WorldOptions } from "./_uscore-world.js";

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

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * The US Core pass, end to end through the real harness, over a synthetic package built in
 * `test/_uscore-world.ts`. The oracle and this library are functions in this file: the oracle stands
 * in for the JVM and the library for `dist/`, which is where this suite's boundary is.
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

const LAB_9 = `${US_CORE}us-core-observation-lab|9.0.0`;
const CLINICAL_9 = `${US_CORE}us-core-observation-clinical-result|9.0.0`;
const ORGANIZATION_9 = `${US_CORE}us-core-organization|9.0.0`;

const clean: OwnAnswer = { ok: true, issues: [], parseRefused: false };

/** This library, stood in for by the answer it would give; every call is recorded with its options. */
function recordingLibrary(answer: (text: string) => OwnAnswer = () => clean) {
  const calls: { text: string; options: OwnOptions | undefined; arity: number }[] = [];
  return {
    calls,
    ourFindings: (...args: [string, OwnOptions?]): OwnAnswer => {
      calls.push({ text: args[0], options: args[1], arity: args.length });
      return answer(args[0]);
    },
  };
}

function compareWorld(
  world: World,
  options: {
    readonly library?: ReturnType<typeof recordingLibrary>;
    readonly oracle?: ReturnType<typeof recordingOracle>;
  } = {},
) {
  const oracle = options.oracle ?? recordingOracle();
  const library = options.library ?? recordingLibrary();
  const outcome = runComparison({
    jar: world.jar,
    identity: world.identity,
    declaration: world.declaration,
    terminology: world.terminology,
    ourFindings: library.ourFindings,
    location: { documentsRoot: world.documentsRoot },
    exec: oracle.exec,
    read: oracle.read,
  });
  return { outcome, oracle, library };
}

const doc = (version: string, file: string, body: string) => ({ version, file, body });
const idOf = (version: string, file: string) => `${CORPUS}/${version}/${file}`;

function reportOf(outcome: ReturnType<typeof compareWorld>["outcome"]): string[] {
  const usCore = outcome.usCore;
  if (usCore === undefined) throw new Error("the US Core pass did not run");
  return formatReachReport(usCore.report);
}

function rowLine(lines: readonly string[], label: string): string {
  const found = lines.filter((l) => l.startsWith(`  ${label}:`));
  expect(found, label).toHaveLength(1);
  return found[0] ?? "";
}

describe("AC-15: a US Core document is validated with exactly the profiles it declares, from its own version", () => {
  const options: WorldOptions = {
    documents: [
      doc("9.0.0", "lab.json", observation([LAB_9, CLINICAL_9], QUANTITY)),
      doc("6.1.0", "lab.json", observation([`${US_CORE}us-core-observation-lab`], QUANTITY)),
    ],
    existing: ['{"resourceType":"Patient","id":"syn-1"}'],
  };

  it("hands this library the verbatim profile of every meta.profile entry, read from that version's package", () => {
    const world = usCoreWorld(options);
    const { library } = compareWorld(world);
    const lab9 = library.calls.find((c) => c.text === options.documents[0]?.body);
    const lab6 = library.calls.find((c) => c.text === options.documents[1]?.body);
    expect(lab9?.options?.profiles).toEqual([
      world.profileText("9.0.0", "us-core-observation-lab"),
      world.profileText("9.0.0", "us-core-observation-clinical-result"),
    ]);
    // The 6.1.0 document is validated with the 6.1.0 package's profile, not the 9.0.0 one.
    expect(lab6?.options?.profiles).toEqual([
      world.profileText("6.1.0", "us-core-observation-lab"),
    ]);
    expect(world.profileText("6.1.0", "us-core-observation-lab")).not.toBe(
      world.profileText("9.0.0", "us-core-observation-lab"),
    );
  });

  it("runs the oracle for each US Core version with exactly that version loaded, in a batch of its own", () => {
    const world = usCoreWorld(options);
    const { oracle } = compareWorld(world);
    const igOf = (args: readonly string[]) => args[args.indexOf("-ig") + 1];
    const staged = (args: readonly string[]) =>
      args.filter((a) => a.endsWith(".json") && !a.endsWith("outcome.json"));
    const nine = oracle.calls.filter((args) => igOf(args) === "hl7.fhir.us.core#9.0.0");
    expect(nine).toHaveLength(1);
    expect(staged(nine[0] ?? []).map((f) => f.slice(f.lastIndexOf("/") + 1))).toEqual([
      "0001-lab.json",
    ]);
    const six = oracle.calls.filter(
      (args) =>
        igOf(args) === "hl7.fhir.us.core#6.1.0" &&
        staged(args).some((f) => f.endsWith("-lab.json")),
    );
    expect(six).toHaveLength(1);
    expect(staged(six[0] ?? [])).toHaveLength(1);
    // Neither US Core batch carries the pre-existing corpus's document.
    for (const args of [...nine, ...six]) {
      expect(staged(args).some((f) => f.endsWith("-doc-0.json"))).toBe(false);
    }
  });
});

describe("AC-9: a package or a document that is not what the declaration records compares nothing", () => {
  const options: WorldOptions = {
    documents: [doc("9.0.0", "lab.json", observation([LAB_9], QUANTITY))],
    existing: ['{"resourceType":"Patient","id":"syn-1"}'],
  };

  it("refuses a package whose byte count or digest differs, before any document is asked about", () => {
    const tampers = [
      (bytes: Buffer) => Buffer.concat([bytes, Buffer.from([0])]),
      (bytes: Buffer) => {
        const same = Buffer.from(bytes);
        same[same.length - 1] = (same[same.length - 1] ?? 0) ^ 0xff;
        return same;
      },
    ];
    for (const tamper of tampers) {
      const world = usCoreWorld(options);
      const file = join(world.documentsRoot, CORPUS, "9.0.0", "package.tgz");
      writeFileSync(file, tamper(world.packages["9.0.0"] ?? Buffer.alloc(0)));
      const oracle = recordingOracle();
      const library = recordingLibrary();
      expect(() => compareWorld(world, { oracle, library })).toThrow(CorpusError);
      expect(() => compareWorld(world, { oracle, library })).toThrow(
        /US Core 9\.0\.0 package is \d+ bytes with sha256 [0-9a-f]{64}.*not the package this corpus was declared against/,
      );
      expect(oracle.calls).toHaveLength(0);
      expect(library.calls).toHaveLength(0);
    }
  });

  it("refuses a package that is not there at all", () => {
    const world = usCoreWorld(options);
    writeFileSync(join(world.documentsRoot, CORPUS, "9.0.0", "package.tgz"), "");
    expect(() => compareWorld(world)).toThrow(CorpusError);
  });

  it("refuses a US Core document that differs from its declaration, before any document is asked about", () => {
    const world = usCoreWorld(options);
    writeFileSync(
      join(world.documentsRoot, CORPUS, "9.0.0", "package", "example", "lab.json"),
      observation([LAB_9], CONCEPT),
    );
    const oracle = recordingOracle();
    expect(() => compareWorld(world, { oracle })).toThrow(/uscore\/9\.0\.0\/lab\.json/);
    expect(oracle.calls).toHaveLength(0);
  });
});

describe("AC-10: a document declaring no profile, or one its package lacks, has no readable outcome", () => {
  const bodies = {
    none: observation(undefined, QUANTITY),
    missing: observation([LAB_9, `${US_CORE}us-core-not-in-this-package|9.0.0`], QUANTITY),
    otherVersion: observation([`${US_CORE}us-core-observation-lab|6.1.0`], QUANTITY),
    fine: observation([LAB_9], QUANTITY),
  };

  it("is neither compared nor clean, and is never validated with fewer profiles than it declares", () => {
    const world = usCoreWorld({
      documents: [
        doc("9.0.0", "none.json", bodies.none),
        doc("9.0.0", "missing.json", bodies.missing),
        doc("9.0.0", "other-version.json", bodies.otherVersion),
        doc("9.0.0", "fine.json", bodies.fine),
      ],
    });
    const { outcome, library } = compareWorld(world);
    for (const file of ["none.json", "missing.json", "other-version.json"]) {
      const record = outcome.records.find((r) => r.id === idOf("9.0.0", file));
      expect(record?.status, file).toBe(STATUS.NO_OWN_FINDINGS);
      expect(record?.compared, file).toBe(false);
      expect(record?.clean, file).toBe(false);
      if (record !== undefined) {
        expect(formatRecord(record), file).toContain("Not counted, and not reported clean");
      }
    }
    // This library was asked about the one document whose every declared profile resolved, and
    // about no other: not with the profiles that did resolve, and not with none.
    expect(library.calls.map((c) => c.text)).toEqual([bodies.fine]);
    expect(outcome.records.find((r) => r.id === idOf("9.0.0", "fine.json"))?.compared).toBe(true);
    expect(outcome.summary.compared).toBe(1);
    expect(outcome.summary.unusable).toHaveLength(3);
  });

  it("names why: no declared profile, a profile the package lacks, a version it is not", () => {
    const world = usCoreWorld({
      documents: [
        doc("9.0.0", "none.json", bodies.none),
        doc("9.0.0", "missing.json", bodies.missing),
        doc("9.0.0", "other-version.json", bodies.otherVersion),
      ],
    });
    const { outcome } = compareWorld(world);
    const detail = (file: string) =>
      outcome.records.find((r) => r.id === idOf("9.0.0", file))?.detail;
    expect(detail("none.json")).toContain("declares no profile in meta.profile");
    expect(detail("missing.json")).toContain(
      "declares meta.profile[1], which the US Core 9.0.0 package does not contain",
    );
    expect(detail("other-version.json")).toContain(
      "declares meta.profile[0] at a version other than the US Core 9.0.0 package",
    );
    // By position, never by what the entry spells: meta.profile is document content.
    expect(detail("missing.json")).not.toContain("us-core-not-in-this-package");
    expect(detail("other-version.json")).not.toContain("6.1.0");
  });
});

describe("AC-5: every newly evaluated row prints its reach, or not reached with the reason", () => {
  const world = () =>
    usCoreWorld({
      documents: [
        doc("9.0.0", "lab.json", observation([LAB_9], QUANTITY)),
        doc("9.0.0", "clinical-string.json", observation([CLINICAL_9], STRING)),
        doc(
          "9.0.0",
          "organization.json",
          JSON.stringify({
            resourceType: "Organization",
            meta: { profile: [ORGANIZATION_9] },
            identifier: [{ system: "http://hl7.org/fhir/sid/us-npi", value: "0000000000" }],
          }),
        ),
      ],
    });

  it("reports on exactly the rows the committed classification newly evaluates", () => {
    const rows = loadNewlyEvaluatedRows();
    expect(rows).toHaveLength(18);
    expect(rows.filter((r) => r.version === "6.1.0")).toHaveLength(8);
    expect(rows.filter((r) => r.version === "9.0.0")).toHaveLength(10);
    expect([...new Set(rows.map((r) => r.key))].sort()).toEqual(
      [
        "us-core-16",
        "us-core-18",
        "us-core-19",
        "us-core-24",
        "us-core-25",
        "us-core-27",
        "us-core-3",
        "us-core-4",
      ].sort(),
    );
  });

  it("prints one line per row: how many compared documents reach it, or not reached and why", () => {
    const { outcome } = compareWorld(world());
    const lines = reportOf(outcome);
    for (const row of loadNewlyEvaluatedRows()) {
      rowLine(lines, `${row.version}  ${row.profile}  ${row.element}  ${row.key}`);
    }
    // The lab document reaches us-core-4 on its own profile.
    expect(
      rowLine(lines, "9.0.0  us-core-observation-lab  Observation.value[x]  us-core-4"),
    ).toContain("reached by 1 compared document(s): 1 agree");
    // us-core-3 is carried by the clinical-result profile AND inherited by the lab profile, so both
    // Observations reach it; the one whose value is a primitive is not evaluated there.
    const us3 = rowLine(
      lines,
      "9.0.0  us-core-observation-clinical-result  Observation.value[x]  us-core-3",
    );
    expect(us3).toContain("reached by 2 compared document(s): 1 agree");
    expect(us3).toContain(`1 ${ROW_ANSWER.NOT_EVALUATED}`);
    expect(lines).toContain(
      `    ${ROW_ANSWER.NOT_EVALUATED}: ${idOf("9.0.0", "clinical-string.json")}; not counted as agreement.`,
    );
    // A slice-scoped row is not reached even where a document carries the sliced element.
    expect(
      rowLine(lines, "9.0.0  us-core-organization  Organization.identifier:NPI  us-core-16"),
    ).toContain(
      `not reached (${NOT_REACHED.SLICE_SCOPED}); 1 compared document(s) declare a profile carrying it`,
    );
    // A row no compared document declares is not reached, and says so.
    expect(rowLine(lines, "9.0.0  us-core-smokingstatus  Observation  us-core-24")).toContain(
      `not reached (${NOT_REACHED.NO_COMPARED_DOCUMENT})`,
    );
  });

  it("does not count a not-reached row, or a document that was not compared, as agreement", () => {
    const { outcome } = compareWorld(world());
    const closing = reportOf(outcome).find((l) => l.includes("newly evaluated row(s) agree"));
    expect(closing).toContain(
      "2 of 18 newly evaluated row(s) agree on at least one compared document",
    );
    expect(closing).toContain(`not reached (${NOT_REACHED.SLICE_SCOPED})`);
    // The same world with the oracle silent on the lab document: it is not compared, so it reaches
    // nothing, and the two rows it alone agreed on are no longer counted.
    const silent = recordingOracle((name) => (name.endsWith("-lab.json") ? null : []));
    const { outcome: without } = compareWorld(world(), { oracle: silent });
    const lines = reportOf(without);
    expect(
      rowLine(lines, "9.0.0  us-core-observation-lab  Observation.value[x]  us-core-4"),
    ).toContain(`not reached (${NOT_REACHED.NO_COMPARED_DOCUMENT})`);
    expect(lines.find((l) => l.includes("newly evaluated row(s) agree"))).toContain(
      "0 of 18 newly evaluated row(s) agree",
    );
  });
});

describe("AC-8: a row whose only answer is INVARIANT_UNCHECKED is printed as unchecked, never as agreement", () => {
  const unchecked = (key: string): OwnAnswer => ({
    ok: true,
    issues: [
      {
        severity: "information",
        location: "Observation.value[x]",
        code: "INVARIANT_UNCHECKED",
        constraint: key,
      },
    ],
    parseRefused: false,
  });
  const oracleAnswers: readonly (readonly [string, readonly unknown[]])[] = [
    ["the oracle is clean", []],
    [
      "the oracle errors",
      [{ severity: "error", expression: ["Observation.value"], code: "invariant" }],
    ],
  ];

  for (const [label, oracleIssues] of oracleAnswers) {
    it(`prints the document as unchecked for that row and does not count it when ${label}`, () => {
      const world = usCoreWorld({
        documents: [doc("9.0.0", "lab.json", observation([LAB_9], QUANTITY))],
      });
      const { outcome } = compareWorld(world, {
        library: recordingLibrary(() => unchecked("us-core-4")),
        oracle: recordingOracle(() => oracleIssues),
      });
      const lines = reportOf(outcome);
      expect(
        rowLine(lines, "9.0.0  us-core-observation-lab  Observation.value[x]  us-core-4"),
      ).toContain("reached by 1 compared document(s): 0 agree, 1 unchecked");
      expect(lines).toContain(
        `    unchecked: ${idOf("9.0.0", "lab.json")}, this library's only answer for us-core-4 is INVARIANT_UNCHECKED; not counted as agreement.`,
      );
      const result = outcome.usCore?.report.rows.find(
        (r) => r.row.version === "9.0.0" && r.row.key === "us-core-4",
      );
      expect(result?.documents.map((d) => [d.answer, d.agrees])).toEqual([
        [ROW_ANSWER.UNCHECKED, false],
      ]);
    });
  }

  it("keeps the rows this library did decide on the same document apart from the unchecked one", () => {
    const world = usCoreWorld({
      documents: [doc("9.0.0", "lab.json", observation([LAB_9], QUANTITY))],
    });
    const { outcome } = compareWorld(world, {
      library: recordingLibrary(() => unchecked("us-core-4")),
    });
    expect(
      rowLine(
        reportOf(outcome),
        "9.0.0  us-core-observation-clinical-result  Observation.value[x]  us-core-3",
      ),
    ).toContain("reached by 1 compared document(s): 1 agree, 0 unchecked");
  });
});

describe("AC-7: no compared 9.0.0 document deciding us-core-3 over a valueQuantity is named, and fails", () => {
  const reportFor = (
    documents: WorldOptions["documents"],
    answer?: (text: string) => OwnAnswer,
  ) => {
    const { outcome } = compareWorld(usCoreWorld({ documents }), {
      library: recordingLibrary(answer),
    });
    const usCore = outcome.usCore;
    if (usCore === undefined) throw new Error("the US Core pass did not run");
    return usCore.report;
  };

  it("is satisfied by one compared 9.0.0 document with a valueQuantity that this library decided", () => {
    const report = reportFor([doc("9.0.0", "lab.json", observation([LAB_9], QUANTITY))]);
    expect(ucumExercised(report)).toEqual([idOf("9.0.0", "lab.json")]);
    expect(ucumShortfall(report)).toBeNull();
  });

  it("names the condition when the only reaching documents are another value type, or another version", () => {
    const report = reportFor([
      doc("9.0.0", "concept.json", observation([LAB_9], CONCEPT)),
      doc("6.1.0", "lab.json", observation([`${US_CORE}us-core-observation-lab`], QUANTITY)),
    ]);
    expect(ucumExercised(report)).toEqual([]);
    const condition = ucumShortfall(report);
    expect(condition).toContain(
      "no compared US Core 9.0.0 document reaches us-core-3 with a valueQuantity",
    );
    expect(condition).toContain("This run fails.");
    expect(formatReachReport(report)).toContain(condition);
  });

  it("does not count a valueQuantity document whose only us-core-3 answer was unchecked", () => {
    const report = reportFor([doc("9.0.0", "lab.json", observation([LAB_9], QUANTITY))], () => ({
      ok: true,
      issues: [
        {
          severity: "information",
          location: "Observation.value[x]",
          code: "INVARIANT_UNCHECKED",
          constraint: "us-core-3",
        },
      ],
      parseRefused: false,
    }));
    expect(ucumShortfall(report)).not.toBeNull();
  });

  it("names the condition over a pass that reached nothing, rather than passing it", () => {
    const rows: readonly UsCoreRow[] = loadNewlyEvaluatedRows();
    const report = {
      rows: rows.map((row) => ({ row, reached: false, declaring: 0, documents: [] })),
      comparedDocuments: 0,
    };
    expect(ucumShortfall(report)).not.toBeNull();
  });
});
