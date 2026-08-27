/**
 * The oracle half of the differential: the identity recorded beside every result, the refusal when
 * that identity cannot be established, and the failure modes that yield no readable outcome.
 *
 * NO JVM. `scripts/differential/oracle.mjs` takes its process interaction as an injectable `exec`
 * and its output as an injectable `read`, so every branch below is graded in a container with no
 * Java, which is where this suite runs. The pinned release string is graded against the workflow
 * that downloads it, so the two cannot drift apart in silence.
 */

import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { STATUS } from "../scripts/differential/compare.mjs";
import type { Record_ } from "../scripts/differential/compare.mjs";
import { REPO_ROOT, sha256 } from "../scripts/differential/corpus.mjs";
import {
  attributeOutcome,
  FHIR_VERSION,
  formatOracleIdentity,
  ORACLE_DOWNLOAD_URL,
  ORACLE_RELEASE,
  oracleArgs,
  oracleIdentity,
  OracleError,
  parseOracleOutput,
  runOracleBatch,
  US_CORE_IG,
} from "../scripts/differential/oracle.mjs";
import {
  buildRunRecord,
  determinismVerdict,
  exitCodeForDeterminism,
  formatDeterminismVerdict,
  NOT_DEMONSTRATED,
} from "../scripts/differential/record.mjs";
import {
  formatTerminologyInputs,
  NO_TERMINOLOGY,
  resolveTerminologyInputs,
  TERMINOLOGY_INPUTS,
} from "../scripts/differential/terminology.mjs";

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "fhir-oracle-test-"));
}

function jarWith(bytes: string): string {
  const dir = scratch();
  const file = join(dir, "validator_cli.jar");
  writeFileSync(file, bytes);
  return file;
}

const outcome = (
  issues: readonly { severity: string; expression?: string[] }[],
  file?: string,
) => ({
  resourceType: "OperationOutcome",
  ...(file === undefined
    ? {}
    : {
        extension: [
          {
            url: "http://hl7.org/fhir/StructureDefinition/operationoutcome-file",
            valueString: `/tmp/staged/${file}`,
          },
        ],
      }),
  issue: issues,
});

describe("the recorded identity is derived from the artifact actually used", () => {
  it("records the release, the byte count and the digest of the jar on disk", () => {
    // "IF the oracle jar version changes between runs THEN ... record the version it used
    // alongside the result"
    const identity = oracleIdentity(jarWith("PK-not-really-a-jar"));
    expect(identity.release).toBe(ORACLE_RELEASE);
    expect(identity.bytes).toBe("PK-not-really-a-jar".length);
    expect(identity.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(formatOracleIdentity(identity)).toContain(ORACLE_RELEASE);
    expect(formatOracleIdentity(identity)).toContain(identity.sha256);
  });

  it("changes when the artifact changes EVEN THOUGH the configured version string does not", () => {
    // "WHEN the recorded oracle identity is produced THE SYSTEM SHALL derive it from the artifact
    // actually used, so that substituting a different artifact changes the recorded identity even
    // when the configured version string does not"
    const a = oracleIdentity(jarWith("artifact-one"));
    const b = oracleIdentity(jarWith("artifact-two"));
    expect(a.release).toBe(b.release);
    expect(a.sha256).not.toBe(b.sha256);
    expect(formatOracleIdentity(a)).not.toBe(formatOracleIdentity(b));
  });

  it("records the same identity for the same bytes, so a re-run is comparable", () => {
    expect(oracleIdentity(jarWith("same")).sha256).toBe(oracleIdentity(jarWith("same")).sha256);
  });
});

describe("the terminology inputs are recorded beside the identity, and move when they move", () => {
  const jar = jarWith("PK-not-really-a-jar");

  it("prints which terminology answers the run was capable of, beside the oracle identity", () => {
    // "WHEN a differential run reports its result, THE SYSTEM SHALL record the terminology inputs in
    // effect for that run alongside the oracle identity it already prints, such that changing those
    // inputs changes the recorded line and a reader of the log can tell which terminology answers
    // the run was capable of."
    const identityLine = formatOracleIdentity(oracleIdentity(jar));
    const terminologyLine = formatTerminologyInputs(resolveTerminologyInputs(TERMINOLOGY_INPUTS));
    expect(identityLine).toContain(ORACLE_RELEASE);
    expect(terminologyLine).toContain("terminology:");
    expect(terminologyLine).toContain("source none");
    expect(terminologyLine).toContain(`-tx ${NO_TERMINOLOGY}`);
    expect(terminologyLine).toContain(`-txCache ${NO_TERMINOLOGY}`);
    // The capability, in words, so the line is readable without knowing what `n/a` means to a CLI.
    expect(terminologyLine).toContain("no code system, value set or display is resolved");
    expect(terminologyLine).toContain("no terminology service is reached");
    expect(terminologyLine).toMatch(/digest sha256 [0-9a-f]{64}/);
  });

  it("is derived from what the run will USE, not from a configured string", () => {
    // Same declaration, resolved twice: the same line. A different declaration: a different line.
    const same = formatTerminologyInputs(resolveTerminologyInputs(TERMINOLOGY_INPUTS));
    expect(formatTerminologyInputs(resolveTerminologyInputs(TERMINOLOGY_INPUTS))).toBe(same);
    const dir = scratch();
    const body = '{"resourceType":"CodeSystem"}';
    writeFileSync(join(dir, "codes.json"), body);
    const pinned = formatTerminologyInputs(
      resolveTerminologyInputs(
        {
          source: "pinned",
          server: NO_TERMINOLOGY,
          cache: "tx-cache",
          pinned: [
            {
              path: "codes.json",
              bytes: Buffer.byteLength(body),
              sha256: sha256(Buffer.from(body)),
            },
          ],
        },
        { repoRoot: dir },
      ),
    );
    expect(pinned).not.toBe(same);
    expect(pinned).toContain("source pinned");
    expect(pinned).toContain("1 pinned input(s)");
    expect(pinned).toContain("every terminology answer comes from");
  });

  it("puts the terminology inputs into the run record beside the artifact's own digest", () => {
    const record = buildRunRecord({
      oracle: oracleIdentity(jar),
      terminology: resolveTerminologyInputs(TERMINOLOGY_INPUTS),
      corpus: { declared: 1, excluded: 0, floor: 1, scope: "full", documents: [], corpora: [] },
      records: [],
      summary: {},
    });
    expect(record.oracle.release).toBe(ORACLE_RELEASE);
    expect(record.oracle.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(record.terminology.source).toBe("none");
    expect(record.terminology.server).toBe(NO_TERMINOLOGY);
    expect(record.terminology.digest).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("an oracle whose identity cannot be established is refused, never guessed at", () => {
  it("refuses an empty path", () => {
    // "IF the identity of the oracle artifact about to be used cannot be established THEN THE
    // SYSTEM SHALL fail rather than compare documents against an unidentified oracle"
    expect(() => oracleIdentity("")).toThrow(OracleError);
  });

  it("refuses a jar that is not there", () => {
    expect(() => oracleIdentity(join(scratch(), "absent.jar"))).toThrow(/could not be examined/);
  });

  it("refuses a directory standing in for a jar", () => {
    expect(() => oracleIdentity(scratch())).toThrow(/not a regular file/);
  });

  it("refuses an empty jar rather than recording a digest of nothing", () => {
    expect(() => oracleIdentity(jarWith(""))).toThrow(/is empty/);
  });

  it("refuses a jar it cannot read", () => {
    const file = jarWith("bytes");
    chmodSync(file, 0o000);
    try {
      expect(() => oracleIdentity(file)).toThrow(OracleError);
    } finally {
      chmodSync(file, 0o600);
    }
  });
});

describe("CI obtains the oracle at a fixed release identifier, and the two cannot drift", () => {
  it("pins a release rather than a pointer that moves when upstream publishes", () => {
    // "WHEN CI obtains the oracle THE SYSTEM SHALL obtain it at a fixed release identifier"
    expect(ORACLE_RELEASE).toMatch(/^\d+\.\d+\.\d+$/);
    expect(ORACLE_DOWNLOAD_URL).toContain(`/releases/download/${ORACLE_RELEASE}/validator_cli.jar`);
    expect(ORACLE_DOWNLOAD_URL).not.toContain("releases/latest");
  });

  it("is the release the workflow downloads, and the workflow declares a time bound", () => {
    const workflow = readFileSync(join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8");
    expect(workflow).toContain(`ORACLE_RELEASE: "${ORACLE_RELEASE}"`);
    // A regex, not a string: the workflow spells the shell expansion of its own job-level env var,
    // and a string literal containing that shape reads to a linter as a template literal someone
    // forgot to back-tick.
    expect(workflow).toMatch(/releases\/download\/\$\{ORACLE_RELEASE\}\/validator_cli\.jar/);
    expect(workflow).not.toContain("releases/latest/download");
    // "WHEN the differential job is run by CI THE SYSTEM SHALL be bounded by a declared time limit"
    expect(workflow).toMatch(/timeout-minutes:\s*\d+/);
  });

  it("keeps the oracle's configuration in one place: FHIR version, US Core IG, terminology", () => {
    const args = oracleArgs("/j.jar", ["/a.json", "/b.json"], "/out.json");
    expect(args.slice(0, 2)).toEqual(["-jar", "/j.jar"]);
    expect(args).toContain("/a.json");
    expect(args).toContain("/b.json");
    expect(args).toContain(FHIR_VERSION);
    expect(args).toContain(US_CORE_IG);
    // The terminology options are part of THIS argv and have no omitted default: leaving `-tx` out
    // is the release's public terminology server, not "no terminology".
    expect(args).toContain("-tx");
    expect(args).toContain("-txCache");
    expect(args.slice(-2)).toEqual(["-output", "/out.json"]);
  });

  it("carries the terminology options through to the process it actually spawns", () => {
    let seen: readonly string[] = [];
    runOracleBatch("/j.jar", ["/s/one.json"], "/o.json", {
      exec: (_file, args) => {
        seen = args;
        return undefined;
      },
      read: () => JSON.stringify(outcome([])),
    });
    expect(seen[seen.indexOf("-tx") + 1]).toBe(NO_TERMINOLOGY);
    expect(seen[seen.indexOf("-txCache") + 1]).toBe(NO_TERMINOLOGY);
    expect(seen.join(" ")).not.toContain("tx.fhir.org");
  });
});

describe("an outcome is attributed to exactly one document or to none", () => {
  it("reads the file the validator records in its own extension", () => {
    expect(attributeOutcome(outcome([], "0001-patient.json"), ["0001-patient.json"])).toBe(
      "0001-patient.json",
    );
  });

  it("falls back to finding the staged name anywhere in the outcome", () => {
    const bare = {
      resourceType: "OperationOutcome",
      id: "x",
      issue: [{ severity: "information", location: ["/tmp/s/0002-obs.json"] }],
    };
    expect(attributeOutcome(bare, ["0001-patient.json", "0002-obs.json"])).toBe("0002-obs.json");
  });

  it("returns null when nothing matches, rather than picking the first", () => {
    expect(attributeOutcome(outcome([]), ["0001-patient.json"])).toBeNull();
  });

  it("returns null when two staged names match, rather than resolving the ambiguity by guessing", () => {
    const both = {
      resourceType: "OperationOutcome",
      issue: [
        { severity: "information", location: ["/tmp/s/0001-a.json"] },
        { severity: "information", location: ["/tmp/s/0002-b.json"] },
      ],
    };
    expect(attributeOutcome(both, ["0001-a.json", "0002-b.json"])).toBeNull();
  });

  it("does not let a staged name match a longer name that merely ends with it", () => {
    const bare = {
      resourceType: "OperationOutcome",
      issue: [{ severity: "error", location: ["/tmp/s/x0001-a.json"] }],
    };
    expect(attributeOutcome(bare, ["0001-a.json"])).toBeNull();
  });

  it("reads an id spelled without the extension, which is how an OperationOutcome.id carries it", () => {
    const bare = { resourceType: "OperationOutcome", id: "0003-cond", issue: [] };
    expect(attributeOutcome(bare, ["0002-obs.json", "0003-cond.json"])).toBe("0003-cond.json");
  });
});

describe("the oracle's output is read, or it is not obtained", () => {
  it("reads a bare OperationOutcome for a single staged document", () => {
    const result = parseOracleOutput(JSON.stringify(outcome([{ severity: "error" }])), [
      "one.json",
    ]);
    expect(result.ok).toBe(true);
    expect(result.ok === true && result.byName.get("one.json")?.[0]?.severity).toBe("error");
  });

  it("reads a Bundle of OperationOutcomes for a batch", () => {
    const bundle = {
      resourceType: "Bundle",
      entry: [
        {
          resource: outcome([{ severity: "error", expression: ["Patient.gender"] }], "0001-a.json"),
        },
        { resource: outcome([], "0002-b.json") },
      ],
    };
    const result = parseOracleOutput(JSON.stringify(bundle), ["0001-a.json", "0002-b.json"]);
    expect(result.ok).toBe(true);
    if (result.ok !== true) return;
    expect(result.byName.get("0001-a.json")).toEqual([
      { severity: "error", location: "Patient.gender", code: "" },
    ]);
    expect(result.byName.get("0002-b.json")).toEqual([]);
  });

  it("carries the issue CODE and the validator's message id, and never the diagnostic text", () => {
    const withCode = {
      resourceType: "OperationOutcome",
      issue: [
        {
          severity: "error",
          code: "code-invalid",
          expression: ["Appointment.serviceCategory[0].coding[0].system"],
          details: {
            coding: [
              { system: "http://hl7.org/fhir/tools/CodeSystem/tx-issue-type", code: "not-found" },
            ],
            text: "A code with a value the log must not echo",
          },
        },
      ],
    };
    const result = parseOracleOutput(JSON.stringify(withCode), ["one.json"]);
    expect(result.ok).toBe(true);
    if (result.ok !== true) return;
    const issue = result.byName.get("one.json")?.[0];
    expect(issue?.code).toBe("code-invalid");
    expect(issue?.messageId).toBe("not-found");
    expect(JSON.stringify(issue)).not.toContain("must not echo");
  });

  it("does not invent an entry for a document the oracle never answered about", () => {
    const bundle = { resourceType: "Bundle", entry: [{ resource: outcome([], "0001-a.json") }] };
    const result = parseOracleOutput(JSON.stringify(bundle), ["0001-a.json", "0002-b.json"]);
    expect(result.ok).toBe(true);
    expect(result.ok === true && result.byName.has("0002-b.json")).toBe(false);
  });

  it("refuses unparseable output", () => {
    const result = parseOracleOutput("<html>gateway timeout</html>", ["one.json"]);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("not parseable JSON");
  });

  it("refuses output that is neither an OperationOutcome nor a Bundle of them", () => {
    const result = parseOracleOutput(JSON.stringify({ resourceType: "Patient" }), ["one.json"]);
    expect(result.ok).toBe(false);
  });

  it("refuses one outcome standing in for several staged documents", () => {
    const result = parseOracleOutput(JSON.stringify(outcome([])), ["a.json", "b.json"]);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("several documents");
  });
});

describe("a run that produced nothing readable yields no outcome, and never 'clean'", () => {
  const out = "/tmp/does-not-matter.json";

  it("reads the outcome even when the CLI exits non-zero, because that is data", () => {
    const result = runOracleBatch("/j.jar", ["/s/one.json"], out, {
      exec: () => {
        const err = new Error("exit 1") as Error & { status?: number };
        err.status = 1;
        throw err;
      },
      read: () => JSON.stringify(outcome([{ severity: "error" }])),
    });
    expect(result.ok).toBe(true);
  });

  it("reports a time-bound breach rather than an empty issue list", () => {
    // "IF the oracle yields no readable outcome for a document, whether by crashing, exiting without
    // output, emitting unparseable output or exceeding its time bound, THEN ..."
    const result = runOracleBatch("/j.jar", ["/s/one.json"], out, {
      timeoutMs: 5,
      exec: () => {
        const err = new Error("timed out") as Error & { code?: string };
        err.code = "ETIMEDOUT";
        throw err;
      },
      read: () => JSON.stringify(outcome([])),
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("time bound");
  });

  it("reports a killed process as no outcome", () => {
    const result = runOracleBatch("/j.jar", ["/s/one.json"], out, {
      exec: () => {
        const err = new Error("killed") as Error & { signal?: string };
        err.signal = "SIGKILL";
        throw err;
      },
      read: () => JSON.stringify(outcome([])),
    });
    expect(result.ok).toBe(false);
  });

  it("reports a missing JVM as no outcome", () => {
    const result = runOracleBatch("/j.jar", ["/s/one.json"], out, {
      exec: () => {
        const err = new Error("spawn java ENOENT") as Error & { code?: string };
        err.code = "ENOENT";
        throw err;
      },
      read: () => JSON.stringify(outcome([])),
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("java");
  });

  it("reports a run that wrote no output file as no outcome", () => {
    const result = runOracleBatch("/j.jar", ["/s/one.json"], out, {
      exec: () => undefined,
      read: () => {
        throw new Error("ENOENT: no such file");
      },
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("no readable output");
  });

  it("passes the declared time bound through to the process", () => {
    let seen: number | undefined;
    runOracleBatch("/j.jar", ["/s/one.json"], out, {
      timeoutMs: 1234,
      exec: (_file, _args, options) => {
        seen = (options as { timeout?: number }).timeout;
        return undefined;
      },
      read: () => JSON.stringify(outcome([])),
    });
    expect(seen).toBe(1234);
  });
});

describe("a document without a readable outcome is not agreement between two runs", () => {
  const record = (over: Partial<Record_> = {}): Record_ => ({
    id: "corpus/a.json",
    status: STATUS.AGREE,
    compared: true,
    clean: true,
    violation: false,
    detail: "",
    ...over,
  });

  const runRecord = (records: readonly Record_[]) =>
    buildRunRecord({
      oracle: oracleIdentity(jarWith("PK-not-really-a-jar")),
      terminology: resolveTerminologyInputs(TERMINOLOGY_INPUTS),
      corpus: {
        declared: records.length,
        excluded: 0,
        floor: 1,
        scope: "subset",
        documents: [],
        corpora: [],
      },
      records,
      summary: { compared: records.length, clean: 0, violations: [], unusable: [], exclusions: [] },
    });

  it("counts such a document as neither compared nor clean, whatever went wrong", () => {
    // "IF the oracle yields no readable outcome for a document, because it crashed, exceeded its
    // time bound, wrote nothing readable, or produced an outcome attributable to no single
    // document, THEN THE SYSTEM SHALL count that document as neither compared nor clean"
    for (const reason of [
      "the oracle exceeded its 600000ms time bound",
      "no `java` on PATH, so the oracle could not be run",
      "the oracle wrote no readable output: ENOENT",
      "the oracle's output is not parseable JSON",
      "the oracle returned no outcome that could be attributed to this document",
      "the oracle returned one outcome for several documents",
    ]) {
      const result = runOracleBatch("/j.jar", ["/s/one.json"], "/o.json", {
        exec: () => undefined,
        read: () => "not json at all",
      });
      expect(result.ok, reason).toBe(false);
    }
  });

  it("reads two comparisons that both LOST the same document as determinism NOT demonstrated", () => {
    // "and the determinism check SHALL treat a comparison containing such a document as determinism
    // not demonstrated rather than as agreement between two runs". Two runs that both failed to
    // obtain an answer produce identical records; reading that as agreement would let a
    // permanently broken oracle certify its own determinism.
    const lost = [
      record({ id: "corpus/a.json" }),
      record({
        id: "corpus/b.json",
        status: STATUS.NO_ORACLE_OUTCOME,
        compared: false,
        clean: false,
        detail: "the oracle exceeded its time bound",
      }),
    ];
    const first = runRecord(lost);
    const second = runRecord(lost);
    // The two records ARE identical, which is exactly the trap.
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    const verdict = determinismVerdict(first, second);
    expect(verdict.demonstrated).toBe(false);
    expect(exitCodeForDeterminism(verdict)).toBe(1);
    expect(verdict.reason).toContain(NOT_DEMONSTRATED);
    expect(verdict.reason).toContain("no readable outcome");
    const printed = formatDeterminismVerdict(verdict).join("\n");
    expect(printed).toContain("corpus/b.json");
    expect(printed).toContain("neither compared nor clean");
  });

  it("does the same when only ONE of the two comparisons lost a document", () => {
    const first = runRecord([record({ id: "corpus/a.json" })]);
    const second = runRecord([
      record({
        id: "corpus/a.json",
        status: STATUS.NO_OWN_FINDINGS,
        compared: false,
        clean: false,
      }),
    ]);
    expect(determinismVerdict(first, second).demonstrated).toBe(false);
    expect(determinismVerdict(second, first).demonstrated).toBe(false);
  });

  it("demonstrates determinism only when every repeated document was actually compared", () => {
    const both = [record({ id: "corpus/a.json" }), record({ id: "corpus/b.json" })];
    expect(determinismVerdict(runRecord(both), runRecord(both)).demonstrated).toBe(true);
  });
});
