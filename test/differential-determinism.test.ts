/**
 * The differential's determinism half: the terminology inputs a run declares, the refusals that keep
 * them exact, the run record that is a pure function of those inputs, and the verdict two
 * comparisons reach.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * NO JVM, NO NETWORK, NO BUILD
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * `scripts/differential/terminology.mjs` reads files only through an injectable `read` and
 * `scripts/differential/record.mjs` is pure, so every branch below is graded in a container with no
 * Java, no network and no `dist/`, which is where this suite runs. `scripts/differential/run.mjs`
 * takes its process launcher as an injectable `exec`, so even the end-to-end plumbing (stage, ask,
 * compare, record) is exercised here against an oracle that is a function in this file.
 *
 * WHAT IS DELIBERATELY NOT ASSERTED HERE. Nothing below claims the REAL oracle answers the same way
 * twice. That is `pnpm differential:determinism`, which needs a JVM and the pinned jar and is graded
 * in the differential CI job. What IS asserted is that the harness cannot ask the oracle a
 * terminology question a network could answer, refuses rather than substituting a source it cannot
 * honour, records nothing that varies between two runs of the same inputs, and never reports a skip
 * as a pass.
 */

import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { compareDocument, STATUS, summarize } from "../scripts/differential/compare.mjs";
import { parseDeclaration, REPO_ROOT, sha256 } from "../scripts/differential/corpus.mjs";
import type { Declaration } from "../scripts/differential/corpus.mjs";
import { oracleArgs, oracleIdentity } from "../scripts/differential/oracle.mjs";
import {
  buildRunRecord,
  canonicalJson,
  determinismRefusal,
  determinismVerdict,
  exitCodeForDeterminism,
  formatDeterminismVerdict,
  formatRunRecord,
  NOT_DEMONSTRATED,
  runRecordDigest,
} from "../scripts/differential/record.mjs";
import type { RunRecord } from "../scripts/differential/record.mjs";
import { runComparison } from "../scripts/differential/run.mjs";
import {
  auditTerminologyArgv,
  DEFAULT_TX_SERVER,
  NO_TERMINOLOGY,
  resolveTerminologyInputs,
  TERMINOLOGY_INPUTS,
  TerminologyError,
  terminologyArgs,
  TX_CACHE_OPTION,
  TX_SERVER_OPTION,
} from "../scripts/differential/terminology.mjs";

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "fhir-determinism-test-"));
}

function jarWith(bytes: string): string {
  const dir = scratch();
  const file = join(dir, "validator_cli.jar");
  writeFileSync(file, bytes);
  return file;
}

const resolvedNone = resolveTerminologyInputs(TERMINOLOGY_INPUTS);

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Criterion: no terminology question is answerable over a network.
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

describe("no terminology question the oracle is asked is answerable over a network", () => {
  it("declares a terminology source that is not a service: nothing, pinned in this repository", () => {
    // "WHEN the differential asks the oracle about any document THE SYSTEM SHALL obtain the
    // oracle's answer without contacting any terminology service over a network, resolving every
    // terminology question either from terminology content pinned in this repository or from no
    // terminology source at all."
    expect(TERMINOLOGY_INPUTS.source).toBe("none");
    expect(TERMINOLOGY_INPUTS.server).toBe(NO_TERMINOLOGY);
    expect(TERMINOLOGY_INPUTS.cache).toBe(NO_TERMINOLOGY);
    expect(TERMINOLOGY_INPUTS.pinned).toHaveLength(0);
  });

  it("spells both terminology options into the argv the oracle is actually invoked with", () => {
    const args = oracleArgs("/j.jar", ["/a.json"], "/out.json");
    expect(args).toContain(TX_SERVER_OPTION);
    expect(args).toContain(TX_CACHE_OPTION);
    expect(args[args.indexOf(TX_SERVER_OPTION) + 1]).toBe(NO_TERMINOLOGY);
    expect(args[args.indexOf(TX_CACHE_OPTION) + 1]).toBe(NO_TERMINOLOGY);
    // The default is the no-terminology one: a caller who passes no options does not get the
    // network by omission.
    expect(args.join(" ")).not.toContain(DEFAULT_TX_SERVER);
    expect(auditTerminologyArgv(args, resolvedNone).server).toBe(NO_TERMINOLOGY);
  });

  it("accepts the argv it builds from the inputs it declares, for both terminology levers", () => {
    expect(terminologyArgs(resolvedNone)).toEqual([
      TX_SERVER_OPTION,
      NO_TERMINOLOGY,
      TX_CACHE_OPTION,
      NO_TERMINOLOGY,
    ]);
  });
});

describe("a run whose terminology questions a network could answer compares nothing", () => {
  const base = ["-jar", "/j.jar", "/a.json", "-version", "4.0.1", "-output", "/o.json"];

  it("refuses an ABSENT -tx, because the pinned release's default is a public service", () => {
    // "IF a run would be performed under terminology inputs that leave any terminology question
    // answerable over a network, THEN THE SYSTEM SHALL compare no document, exit non-zero and name
    // the condition it refused on."
    expect(() =>
      auditTerminologyArgv([...base, TX_CACHE_OPTION, NO_TERMINOLOGY], resolvedNone),
    ).toThrow(TerminologyError);
    // A SUBSTRING assertion, deliberately not a constructed RegExp: a host name compiled into a
    // pattern is a shape that matches more hosts than it names, and the refusal owes the reader the
    // exact default it is warning about.
    expect(() =>
      auditTerminologyArgv([...base, TX_CACHE_OPTION, NO_TERMINOLOGY], resolvedNone),
    ).toThrow(DEFAULT_TX_SERVER);
  });

  it("names the condition it refused on for a -tx that is a URL", () => {
    for (const server of [
      "https://tx.fhir.org",
      "http://localhost:8080/fhir",
      "HTTPS://TX.FHIR.ORG",
      "//tx.fhir.org",
    ]) {
      const argv = [...base, TX_SERVER_OPTION, server, TX_CACHE_OPTION, NO_TERMINOLOGY];
      expect(() => auditTerminologyArgv(argv, resolvedNone), server).toThrow(
        /answerable over a network/,
      );
      expect(() => auditTerminologyArgv(argv, resolvedNone), server).toThrow(
        /Refusing to compare any document/,
      );
    }
  });

  it("refuses an ABSENT -txCache, which is an undeclared directory of earlier network answers", () => {
    expect(() =>
      auditTerminologyArgv([...base, TX_SERVER_OPTION, NO_TERMINOLOGY], resolvedNone),
    ).toThrow(/did not declare/);
  });

  it("refuses a -txCache that is a URL", () => {
    expect(() =>
      auditTerminologyArgv(
        [...base, TX_SERVER_OPTION, NO_TERMINOLOGY, TX_CACHE_OPTION, "https://cache.example/"],
        resolvedNone,
      ),
    ).toThrow(/answerable over a network/);
  });

  it("refuses a cache directory when the run declared no terminology source at all", () => {
    expect(() =>
      auditTerminologyArgv(
        [...base, TX_SERVER_OPTION, NO_TERMINOLOGY, TX_CACHE_OPTION, "/var/tmp/tx-cache"],
        resolvedNone,
      ),
    ).toThrow(/no cache directory is a declared input/);
  });

  it("refuses a terminology option spelled twice with two values", () => {
    expect(() =>
      auditTerminologyArgv(
        [
          ...base,
          TX_SERVER_OPTION,
          NO_TERMINOLOGY,
          TX_SERVER_OPTION,
          "https://tx.fhir.org",
          TX_CACHE_OPTION,
          NO_TERMINOLOGY,
        ],
        resolvedNone,
      ),
    ).toThrow(/conflicting terminology options/);
  });

  it("refuses a -tx that is not the server the run declared, even when it is not a URL", () => {
    expect(() =>
      auditTerminologyArgv(
        [...base, TX_SERVER_OPTION, "somewhere-else", TX_CACHE_OPTION, NO_TERMINOLOGY],
        resolvedNone,
      ),
    ).toThrow(/not the terminology server this run declared/);
  });

  it("refuses declared inputs that name a server at all, before any argv is built", () => {
    for (const inputs of [
      { source: "none", server: DEFAULT_TX_SERVER, cache: NO_TERMINOLOGY, pinned: [] },
      { source: "none", server: NO_TERMINOLOGY, cache: "/var/tmp/tx", pinned: [] },
      { source: "pinned", server: DEFAULT_TX_SERVER, cache: "corpus/tx", pinned: [] },
    ]) {
      expect(() => resolveTerminologyInputs(inputs), JSON.stringify(inputs)).toThrow(
        TerminologyError,
      );
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Criterion: declared inputs are honoured exactly, or the run refuses and substitutes nothing.
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

describe("declared terminology inputs are honoured exactly or the run compares nothing", () => {
  function pinnedCorpus(body: string): { root: string; inputs: unknown } {
    const root = scratch();
    const file = join(root, "corpus", "terminology", "codesystems.json");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, body);
    return {
      root,
      inputs: {
        source: "pinned",
        server: NO_TERMINOLOGY,
        cache: "corpus/terminology",
        pinned: [
          {
            path: "corpus/terminology/codesystems.json",
            bytes: Buffer.byteLength(body),
            sha256: sha256(Buffer.from(body)),
          },
        ],
      },
    };
  }

  it("honours pinned content whose bytes and digest are what the run declared", () => {
    const { root, inputs } = pinnedCorpus('{"resourceType":"Bundle"}');
    const resolved = resolveTerminologyInputs(inputs, { repoRoot: root });
    expect(resolved.source).toBe("pinned");
    expect(resolved.pinned).toHaveLength(1);
    expect(resolved.pinned[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses a pinned input that is not there, and substitutes no other source", () => {
    // "IF the terminology inputs a run declares cannot be honored exactly, because they are absent,
    // unreadable, or do not match the digest recorded for them, THEN THE SYSTEM SHALL compare no
    // document, exit non-zero naming what could not be honored, and SHALL NOT substitute any other
    // terminology source."
    const { inputs } = pinnedCorpus('{"resourceType":"Bundle"}');
    const empty = scratch();
    expect(() => resolveTerminologyInputs(inputs, { repoRoot: empty })).toThrow(TerminologyError);
    expect(() => resolveTerminologyInputs(inputs, { repoRoot: empty })).toThrow(
      /could not be honoured: it is not readable/,
    );
    expect(() => resolveTerminologyInputs(inputs, { repoRoot: empty })).toThrow(
      /No other terminology source is substituted/,
    );
  });

  it("refuses a pinned input whose digest does not match the one recorded for it", () => {
    const { root, inputs } = pinnedCorpus('{"resourceType":"Bundle"}');
    const tampered = JSON.parse(JSON.stringify(inputs)) as {
      pinned: { path: string; bytes: number; sha256: string }[];
    };
    tampered.pinned = tampered.pinned.map((p) => ({ ...p, sha256: "0".repeat(64) }));
    expect(() => resolveTerminologyInputs(tampered, { repoRoot: root })).toThrow(
      /declared digest 0{64}, found [0-9a-f]{64}/,
    );
  });

  it("refuses a pinned input whose byte count does not match", () => {
    const { root, inputs } = pinnedCorpus('{"resourceType":"Bundle"}');
    const tampered = JSON.parse(JSON.stringify(inputs)) as {
      pinned: { path: string; bytes: number; sha256: string }[];
    };
    tampered.pinned = tampered.pinned.map((p) => ({ ...p, bytes: 1 }));
    expect(() => resolveTerminologyInputs(tampered, { repoRoot: root })).toThrow(
      /declared 1 bytes, found \d+/,
    );
  });

  it("refuses an unreadable pinned input rather than carrying on without it", () => {
    const { root, inputs } = pinnedCorpus('{"resourceType":"Bundle"}');
    expect(() =>
      resolveTerminologyInputs(inputs, {
        repoRoot: root,
        read: () => {
          throw new Error("EACCES: permission denied");
        },
      }),
    ).toThrow(/could not be honoured/);
  });

  it("refuses a declaration that says pinned and pins nothing, so no answer comes from this repo", () => {
    expect(() =>
      resolveTerminologyInputs({
        source: "pinned",
        server: NO_TERMINOLOGY,
        cache: "corpus/tx",
        pinned: [],
      }),
    ).toThrow(/pin nothing/);
  });

  it("refuses a declaration that says none and pins content anyway", () => {
    expect(() =>
      resolveTerminologyInputs({
        source: "none",
        server: NO_TERMINOLOGY,
        cache: NO_TERMINOLOGY,
        pinned: [{ path: "a.json", sha256: "0".repeat(64) }],
      }),
    ).toThrow(/may not have it both ways/);
  });

  it("refuses a pinned path that climbs out of the repository", () => {
    expect(() =>
      resolveTerminologyInputs({
        source: "pinned",
        server: NO_TERMINOLOGY,
        cache: "corpus/tx",
        pinned: [{ path: "../../etc/passwd", sha256: "0".repeat(64) }],
      }),
    ).toThrow(/does not climb/);
  });

  it("refuses an unknown source rather than defaulting to one", () => {
    expect(() => resolveTerminologyInputs({ source: "network", server: "x", cache: "y" })).toThrow(
      /must be one of none, pinned/,
    );
  });
});

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Criterion: the run record is a pure function of the run's inputs.
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

describe("the run record is a pure function of the run's inputs", () => {
  const identity = oracleIdentity(jarWith("PK-not-really-a-jar"));

  const recordInput = () => ({
    oracle: identity,
    terminology: resolvedNone,
    corpus: {
      declared: 3,
      excluded: 1,
      floor: 2,
      scope: "subset",
      documents: ["corpus/b.json", "corpus/a.json"],
      corpora: [
        { id: "b", version: "1", licence: "MIT" },
        { id: "a", version: "2", licence: "CC0-1.0" },
      ],
    },
    records: [
      {
        ...compareDocument({
          id: "corpus/b.json",
          oracle: { ok: true, issues: [] },
          ours: { ok: true, issues: [], parseRefused: false },
        }),
        // Everything a caller might be carrying that MUST NOT reach the record.
        staged: "/tmp/fhir-diff-corpus-Xy7/0001-b.json",
        stagedName: "0001-b.json",
        startedAt: "2026-08-27T15:00:00.000Z",
      },
      compareDocument({
        id: "corpus/a.json",
        oracle: {
          ok: true,
          issues: [{ severity: "error", location: "Patient.gender", code: "structure" }],
        },
        ours: { ok: true, issues: [], parseRefused: false },
      }),
    ],
    summary: summarize({
      records: [
        compareDocument({
          id: "corpus/b.json",
          oracle: { ok: true, issues: [] },
          ours: { ok: true, issues: [], parseRefused: false },
        }),
      ],
      floor: 1,
    }),
  });

  it("produces byte-identical records for the same inputs, twice", () => {
    // "WHEN the same corpus and the same oracle answers are put through the comparison twice, THE
    // SYSTEM SHALL produce byte-identical run records"
    const a = canonicalJson(buildRunRecord(recordInput()));
    const b = canonicalJson(buildRunRecord(recordInput()));
    expect(a).toBe(b);
    expect(runRecordDigest(buildRunRecord(recordInput()))).toBe(
      runRecordDigest(buildRunRecord(recordInput())),
    );
  });

  it("carries no wall-clock time, no staging path and no run ordinal", () => {
    // "containing no wall-clock time, no temporary staging path, no run ordinal and nothing else
    // that varies between two runs of the same inputs"
    const text = canonicalJson(buildRunRecord(recordInput()));
    expect(text).not.toContain("/tmp/fhir-diff-corpus-");
    expect(text).not.toContain("0001-b.json");
    expect(text).not.toContain("2026-08-27T15:00:00.000Z");
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    expect(text).not.toContain("startedAt");
    expect(text).not.toContain("staged");
    // The jar's own path is a runner-temporary location and is not an input either.
    expect(text).not.toContain(identity.path);
  });

  it("is stable under the order the caller happened to iterate in", () => {
    const forwards = recordInput();
    const backwards = { ...recordInput(), records: [...recordInput().records].reverse() };
    expect(canonicalJson(buildRunRecord(forwards))).toBe(canonicalJson(buildRunRecord(backwards)));
  });

  it("moves when the oracle artifact moves, and when the terminology inputs move", () => {
    const other = { ...recordInput(), oracle: oracleIdentity(jarWith("a-different-artifact")) };
    expect(runRecordDigest(buildRunRecord(other))).not.toBe(
      runRecordDigest(buildRunRecord(recordInput())),
    );
    const pinned = {
      ...recordInput(),
      terminology: {
        ...resolvedNone,
        source: "pinned" as const,
        cache: "corpus/tx",
        digest: "f".repeat(64),
      },
    };
    expect(runRecordDigest(buildRunRecord(pinned))).not.toBe(
      runRecordDigest(buildRunRecord(recordInput())),
    );
  });

  it("moves when any document's status moves", () => {
    const flipped = recordInput();
    const changed = {
      ...flipped,
      records: [
        ...flipped.records.slice(0, 1),
        compareDocument({
          id: "corpus/a.json",
          oracle: { ok: true, issues: [] },
          ours: { ok: true, issues: [], parseRefused: false },
        }),
      ],
    };
    expect(runRecordDigest(buildRunRecord(changed))).not.toBe(
      runRecordDigest(buildRunRecord(recordInput())),
    );
  });

  it("says in its own printed form that it carries none of those things", () => {
    const lines = formatRunRecord(buildRunRecord(recordInput())).join("\n");
    expect(lines).toContain("digest sha256");
    expect(lines).toContain("No wall-clock time, no staging path, no run ordinal");
  });
});

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Criterion: the check never reports a skip as a pass.
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

function runRecordWith(documents: readonly Partial<RunRecord["documents"][number]>[]): RunRecord {
  return buildRunRecord({
    oracle: oracleIdentity(jarWith("PK-not-really-a-jar")),
    terminology: resolvedNone,
    corpus: {
      declared: documents.length,
      excluded: 0,
      floor: 1,
      scope: "subset",
      documents: [],
      corpora: [],
    },
    records: documents.map((d) => ({
      id: "x",
      status: STATUS.AGREE,
      compared: true,
      clean: true,
      violation: false,
      detail: "",
      ...d,
    })),
    summary: {
      compared: documents.length,
      clean: documents.length,
      violations: [],
      unusable: [],
      exclusions: [],
    },
  });
}

describe("determinism is demonstrated, or it is NOT demonstrated; there is no third outcome", () => {
  it("passes only when the two records are byte-identical", () => {
    const a = runRecordWith([{ id: "corpus/a.json" }, { id: "corpus/b.json" }]);
    const b = runRecordWith([{ id: "corpus/b.json" }, { id: "corpus/a.json" }]);
    const verdict = determinismVerdict(a, b);
    expect(verdict.demonstrated).toBe(true);
    expect(exitCodeForDeterminism(verdict)).toBe(0);
    expect(verdict.differences).toEqual([]);
  });

  it("reports NOT demonstrated and exits non-zero when a document's status moved", () => {
    const a = runRecordWith([{ id: "corpus/a.json", status: STATUS.AGREE }]);
    const b = runRecordWith([
      { id: "corpus/a.json", status: STATUS.FALSE_VALID, violation: true, clean: false },
    ]);
    const verdict = determinismVerdict(a, b);
    expect(verdict.demonstrated).toBe(false);
    expect(exitCodeForDeterminism(verdict)).toBe(1);
    expect(verdict.reason).toContain(NOT_DEMONSTRATED);
    expect(verdict.differences.join("\n")).toContain(`corpus/a.json: ${STATUS.AGREE} -> `);
  });

  it("reports NOT demonstrated when either comparison could not be obtained at all", () => {
    // "IF the determinism check cannot obtain the oracle artifact or the declared terminology
    // inputs, THEN THE SYSTEM SHALL report that determinism was NOT demonstrated and exit non-zero,
    // and SHALL NOT report success or a silent skip."
    const one = runRecordWith([{ id: "corpus/a.json" }]);
    for (const pair of [
      [null, one],
      [one, null],
      [undefined, undefined],
    ] as const) {
      const verdict = determinismVerdict(pair[0], pair[1]);
      expect(verdict.demonstrated).toBe(false);
      expect(exitCodeForDeterminism(verdict)).toBe(1);
      expect(verdict.reason).toContain(NOT_DEMONSTRATED);
    }
  });

  it("says NOT demonstrated in the words the log prints, for a refusal with no comparison at all", () => {
    const verdict = determinismRefusal(
      "VALIDATOR_CLI_JAR is not set, so the oracle was not obtained",
    );
    expect(verdict.demonstrated).toBe(false);
    expect(exitCodeForDeterminism(verdict)).toBe(1);
    const printed = formatDeterminismVerdict(verdict).join("\n");
    expect(printed).toContain(NOT_DEMONSTRATED);
    expect(printed).toContain("VALIDATOR_CLI_JAR");
    expect(printed).not.toMatch(/\bskip/i);
    expect(printed).not.toMatch(/\bok\b/i);
  });

  it("never reports success for a pair of records it did not compare", () => {
    // The whole surface: nothing below returns `demonstrated: true` without two real records.
    expect(determinismVerdict({}, {}).demonstrated).toBe(false);
    expect(determinismVerdict("a", "a").demonstrated).toBe(false);
    expect(determinismRefusal("anything at all").demonstrated).toBe(false);
  });
});

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * The check is wired where it is graded: `pnpm differential:determinism`, in the differential job.
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

describe("the determinism check is wired where it is graded", () => {
  const manifest = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  const workflow = readFileSync(join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8");

  it("is invoked as `pnpm differential:determinism`", () => {
    expect(manifest.scripts["differential:determinism"]).toBe(
      "node scripts/differential-determinism.mjs",
    );
  });

  it("runs inside the differential job, which carries a declared time bound", () => {
    const job = workflow.slice(workflow.indexOf("\n  differential:"));
    expect(job).toContain("node scripts/differential-determinism.mjs");
    expect(job).toMatch(/timeout-minutes:\s*\d+/);
    expect(job).toContain("VALIDATOR_CLI_JAR");
    // Never allowed to pass by being ignored.
    expect(job).not.toContain("continue-on-error");
  });

  it("repeats a DECLARED subset, and the workflow comment says why it is a subset", () => {
    expect(workflow).toContain("determinismSubset");
    expect(workflow).toContain("what determinism was demonstrated over");
  });

  it("sets `process.exitCode` and NEVER calls `process.exit()`, so the log keeps the last lines", () => {
    // MEASURED, NOT THEORETICAL. Under CI these processes write to a PIPE, so stdout is
    // asynchronous and buffered, and `process.exit()` terminates without draining it. In a real
    // differential run the per-document lines and the exclusions block reached the log and the
    // CLOSING SUMMARY, the oracle identity beside it and the RUN RECORD did not: exactly the half
    // of the output that makes a silent shrink visible. Setting the code and returning lets Node
    // drain stdout and exit on its own. A check whose evidence is what it printed cannot call
    // `process.exit()`.
    for (const script of ["scripts/differential.mjs", "scripts/differential-determinism.mjs"]) {
      const source = readFileSync(join(REPO_ROOT, script), "utf8");
      // Block comments stripped first: both files EXPLAIN this rule in prose, and a scan that read
      // the explanation as a violation would fail on the fix.
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "");
      expect(
        code.match(/process\.exit\s*\(/g) ?? [],
        `${script} must not call process.exit()`,
      ).toEqual([]);
      expect(code, `${script} must set process.exitCode`).toContain("process.exitCode");
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * The plumbing end to end, with an oracle that is a function in this file.
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

describe("two comparisons of the same inputs through the real harness produce one record", () => {
  const body = '{"resourceType":"Patient","id":"x"}';

  function scratchWorld(): { declaration: Declaration; documentsRoot: string } {
    const documentsRoot = scratch();
    const declaration = parseDeclaration(
      JSON.stringify({
        schemaVersion: 1,
        comparedFloor: 1,
        determinismSubset: ["scratch/one.json"],
        corpora: [
          {
            id: "scratch",
            title: "scratch",
            version: "0",
            licence: "CC0-1.0",
            origin: "https://example.org/",
            authored: "third-party",
            acquisition: { kind: "files", baseUrl: "https://example.org/" },
            licenceText: "licences/x.txt",
            notice: "licences/x-NOTICE.txt",
          },
        ],
        documents: [
          {
            id: "scratch/one.json",
            corpus: "scratch",
            path: "one.json",
            bytes: Buffer.byteLength(body),
            sha256: sha256(Buffer.from(body)),
          },
          {
            id: "scratch/two.json",
            corpus: "scratch",
            path: "two.json",
            bytes: Buffer.byteLength(body),
            sha256: sha256(Buffer.from(body)),
          },
        ],
      }),
    );
    for (const name of ["one.json", "two.json"]) {
      const file = join(documentsRoot, "scratch", name);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, body);
    }
    return { declaration, documentsRoot };
  }

  /** An oracle that answers from the staged file names alone, so two runs cannot differ. */
  const stubOracle = (issues: readonly unknown[] = []) => ({
    exec: (_file: string, args: readonly string[]) => {
      const staged = args.filter((a) => a.endsWith(".json") && !a.endsWith("outcome.json"));
      return staged.length;
    },
    read: (): string =>
      JSON.stringify({
        resourceType: "Bundle",
        entry: [
          { resource: { resourceType: "OperationOutcome", id: "0000-one", issue: issues } },
          { resource: { resourceType: "OperationOutcome", id: "0001-two", issue: issues } },
        ],
      }),
  });

  function compare(overrides: Record<string, unknown> = {}) {
    const { declaration, documentsRoot } = scratchWorld();
    return runComparison({
      jar: jarWith("PK-not-really-a-jar"),
      identity: oracleIdentity(jarWith("PK-not-really-a-jar")),
      declaration,
      terminology: resolvedNone,
      ourFindings: () => ({ ok: true, issues: [], parseRefused: false }),
      scope: "subset",
      location: { documentsRoot },
      ...stubOracle(),
      ...overrides,
    });
  }

  it("produces byte-identical run records over two comparisons of the same inputs", () => {
    const first = compare();
    const second = compare();
    expect(canonicalJson(first.runRecord)).toBe(canonicalJson(second.runRecord));
    const verdict = determinismVerdict(first.runRecord, second.runRecord);
    expect(verdict.demonstrated).toBe(true);
    expect(first.summary.compared).toBe(2);
  });

  it("compares only the declared subset while still verifying every declared document", () => {
    const { declaration, documentsRoot } = scratchWorld();
    const outcome = runComparison({
      jar: jarWith("PK-not-really-a-jar"),
      identity: oracleIdentity(jarWith("PK-not-really-a-jar")),
      declaration,
      terminology: resolvedNone,
      ourFindings: () => ({ ok: true, issues: [], parseRefused: false }),
      only: ["scratch/one.json"],
      scope: "subset",
      location: { documentsRoot },
      exec: () => 1,
      read: () => JSON.stringify({ resourceType: "OperationOutcome", id: "0000-one", issue: [] }),
    });
    expect(outcome.runRecord.documents.map((d) => d.id)).toEqual(["scratch/one.json"]);
    expect(outcome.runRecord.corpus.scope).toBe("subset");
  });

  it("compares NOTHING when the terminology inputs would leave a question network-answerable", () => {
    // "THEN THE SYSTEM SHALL compare no document, exit non-zero and name the condition it refused
    // on." The refusal is raised before a single document is staged.
    const { declaration, documentsRoot } = scratchWorld();
    let asked = 0;
    expect(() =>
      runComparison({
        jar: jarWith("PK-not-really-a-jar"),
        identity: oracleIdentity(jarWith("PK-not-really-a-jar")),
        declaration,
        terminology: { ...resolvedNone, server: DEFAULT_TX_SERVER },
        ourFindings: () => ({ ok: true, issues: [], parseRefused: false }),
        location: { documentsRoot },
        exec: () => {
          asked += 1;
          return 0;
        },
        read: () => "{}",
      }),
    ).toThrow(TerminologyError);
    expect(asked).toBe(0);
  });
});
