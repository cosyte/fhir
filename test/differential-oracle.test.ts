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

import { REPO_ROOT } from "../scripts/differential/corpus.mjs";
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
    expect(workflow).toContain("/releases/download/${ORACLE_RELEASE}/validator_cli.jar");
    expect(workflow).not.toContain("releases/latest/download");
    // "WHEN the differential job is run by CI THE SYSTEM SHALL be bounded by a declared time limit"
    expect(workflow).toMatch(/timeout-minutes:\s*\d+/);
  });

  it("keeps the oracle's configuration in one place: FHIR version and the US Core IG", () => {
    const args = oracleArgs("/j.jar", ["/a.json", "/b.json"], "/out.json");
    expect(args.slice(0, 2)).toEqual(["-jar", "/j.jar"]);
    expect(args).toContain("/a.json");
    expect(args).toContain("/b.json");
    expect(args).toContain(FHIR_VERSION);
    expect(args).toContain(US_CORE_IG);
    expect(args.slice(-2)).toEqual(["-output", "/out.json"]);
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
      { severity: "error", location: "Patient.gender" },
    ]);
    expect(result.byName.get("0002-b.json")).toEqual([]);
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
