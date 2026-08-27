/**
 * The `Release` workflow is a thin caller of a reusable workflow owned by another repository, and
 * this file is the assertion that the caller still grants the token permissions that workflow
 * requires.
 *
 * WHY A TEST AND NOT A REVIEW NOTE. A called workflow's `GITHUB_TOKEN` can only be DOWNGRADED by
 * its caller, never elevated. The repository default is `contents: read`, so a caller that omits a
 * key the shared workflow asks for is granting that key `none`, the shared workflow's own request
 * for it becomes an escalation, and GitHub refuses the whole workflow BEFORE any job starts: one
 * second, no job, no step, no log, and no notification anywhere a normal test run would look. Three
 * consecutive pushes to the default branch were refused that way and the only thing that noticed
 * was an out-of-band sweep of the org's workflow histories. The failure is caller-side, it is
 * invisible from inside a run, and nothing else in this repository asserts the precondition. This
 * file is that assertion, and it fails here, in `pnpm test`, before the push that would be refused.
 *
 * WHAT IS GRADED, precisely:
 *
 *  1. The calling job grants `actions: read`, `contents: write`, `id-token: write` and
 *     `pull-requests: write`, which is the block the shared workflow declares for itself.
 *  2. A missing `permissions:` block is named as such, and the message says what GitHub does about
 *     it, because the next reader of this failure has no log to consult.
 *  3. A single missing key, and a key present at a WEAKER level than required (`contents: read`
 *     where `write` is needed), each fail naming the offending key. A partial grant is the exact
 *     shape that produced the refusals above, so it must not read as close enough.
 *  4. An absent, empty or job-less workflow file fails naming the file, rather than making no
 *     assertion and reporting success. A guard that quietly stops looking is worse than none.
 *  5. The required list is keyed to the workflow it was derived from. If the `uses:` target moves,
 *     this reds so the list is re-derived against whatever is actually being called, instead of
 *     continuing to assert a contract nothing is party to any more.
 *
 * NO YAML PARSER, DELIBERATELY, AND IT IS THE REASON FOR THE SCANNER BELOW. This package has zero
 * runtime dependencies and no YAML parser among its dev dependencies, and adding one to read a
 * hand-maintained 26-line file would be the larger change. The scanner therefore reads only the
 * two constructs that file uses, block mappings and indentation, and REFUSES anything else rather
 * than guessing at it. Every refusal below is written to fail closed: an unreadable shape, an
 * unrecognised permission value and an ambiguous set of jobs are all reported as problems, never
 * skipped. That direction is not stylistic. A false red costs someone five minutes; a false green
 * is precisely the condition this file exists to detect.
 *
 * THE UNHAPPY PATHS ARE DRIVEN FROM FIXTURES, never by editing the real workflow. Each fixture is
 * built by `callerWorkflow()` from the same template as the passing control, so the delta under
 * test is the single thing named in the test, and the control proves the fixtures are not failing
 * for an unrelated reason.
 */

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));

/** Path of the workflow under test, relative to the repository root, as the messages spell it. */
const WORKFLOW_RELATIVE_PATH = ".github/workflows/release.yml";

/**
 * The reusable workflow the caller is keyed to, with no `@ref`. The ref is deliberately not
 * compared: moving the caller from `@main` to a tag does not change what permissions are required,
 * whereas calling a different workflow does.
 */
const SHARED_WORKFLOW = "cosyte/.github/.github/workflows/release.yml";

/**
 * The permission levels the shared workflow declares for itself, which a caller must therefore
 * grant at least. `actions: read` is the one that is easy to lose: it is the only entry that is not
 * `write`, it was added later than the other three, and it is what the shared workflow reads this
 * caller's environment protection with.
 */
const REQUIRED_PERMISSIONS: ReadonlyArray<{ key: string; level: PermissionLevel }> = [
  { key: "actions", level: "read" },
  { key: "contents", level: "write" },
  { key: "id-token", level: "write" },
  { key: "pull-requests", level: "write" },
];

type PermissionLevel = "none" | "read" | "write";

/** `write` implies `read` implies `none`. Anything else is not a level this guard can compare. */
const PERMISSION_RANK: Readonly<Record<PermissionLevel, number>> = { none: 0, read: 1, write: 2 };

function rankOf(value: string): number | undefined {
  return value === "none" || value === "read" || value === "write"
    ? PERMISSION_RANK[value]
    : undefined;
}

// ---------------------------------------------------------------------------
// The scanner. Block mappings and indentation only; every other shape is refused.
// ---------------------------------------------------------------------------

interface SourceLine {
  /** Leading-space count. Tabs are illegal as YAML indentation and are refused before this. */
  readonly indent: number;
  /** The line with its comment and surrounding whitespace removed. Never empty. */
  readonly text: string;
}

/**
 * Remove a trailing comment. A `#` opens one only at the start of a line or after whitespace, and
 * only outside a quoted scalar, so `package-name: "@cosyte/fhir"` and a `#` inside a quoted value
 * both survive.
 */
function stripComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line.charAt(i);
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (ch === "#" && !inSingle && !inDouble && (i === 0 || /\s/.test(line.charAt(i - 1)))) {
      return line.slice(0, i);
    }
  }
  return line;
}

/** Split into significant lines, or report the first tab-indented line rather than misreading it. */
function readSourceLines(source: string): { lines: SourceLine[] } | { refusal: string } {
  const lines: SourceLine[] = [];
  const rawLines = source.split(/\r?\n/);
  for (let i = 0; i < rawLines.length; i += 1) {
    const raw = rawLines[i] ?? "";
    const withoutComment = stripComment(raw);
    if (withoutComment.trim() === "") continue;
    const leading = /^[ \t]*/.exec(withoutComment)?.[0] ?? "";
    if (leading.includes("\t")) {
      return { refusal: `line ${i + 1} is indented with a tab, which YAML does not permit` };
    }
    lines.push({ indent: leading.length, text: withoutComment.trim() });
  }
  return { lines };
}

/** The lines strictly more indented than `lines[start]`, which is that entry's block body. */
function blockBody(lines: readonly SourceLine[], start: number): SourceLine[] {
  const parentIndent = lines[start]?.indent ?? 0;
  const body: SourceLine[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === undefined) break;
    if (line.indent <= parentIndent) break;
    body.push(line);
  }
  return body;
}

/** Split `key: value` into its two halves, unquoting the value. `undefined` when there is no key. */
function splitEntry(text: string): { key: string; value: string } | undefined {
  const match = /^([^:]+):(.*)$/.exec(text);
  if (match === null) return undefined;
  const key = (match[1] ?? "").trim().replace(/^["']|["']$/g, "");
  const value = (match[2] ?? "").trim().replace(/^["']|["']$/g, "");
  return { key, value };
}

interface CallerJob {
  readonly name: string;
  readonly uses: string;
  /** The job's own `permissions:` block, or `undefined` when it declares none. */
  readonly permissions: ReadonlyMap<string, string> | undefined;
  /** Set when `permissions:` carried an inline scalar instead of a block mapping. */
  readonly permissionsShape: string | undefined;
}

/**
 * Find the one job that calls a reusable workflow.
 *
 * A calling job is identified by HAVING a `uses:` key, never by what that key points at. Keying on
 * the target instead would make a moved `uses:` look like "there is no calling job", which reports
 * the wrong problem and, worse, reports it in the one case where the required-permission list has
 * gone stale. Exactly one such job is required: a second one means this guard can no longer say
 * which job's permissions it is grading, and that is refused rather than resolved by picking.
 */
function findCallerJob(
  lines: readonly SourceLine[],
): { job: CallerJob } | { refusal: string } | undefined {
  const jobsIndex = lines.findIndex((line) => line.indent === 0 && line.text === "jobs:");
  if (jobsIndex === -1) return undefined;

  const jobsBody = blockBody(lines, jobsIndex);
  if (jobsBody.length === 0) return undefined;
  const jobIndent = Math.min(...jobsBody.map((line) => line.indent));

  const callers: CallerJob[] = [];
  for (let i = 0; i < jobsBody.length; i += 1) {
    const line = jobsBody[i];
    if (line === undefined || line.indent !== jobIndent) continue;
    const entry = splitEntry(line.text);
    if (entry === undefined || entry.value !== "") continue;

    const body = blockBody(jobsBody, i);
    const keyIndent = body.length === 0 ? 0 : Math.min(...body.map((l) => l.indent));

    let uses: string | undefined;
    let permissions: ReadonlyMap<string, string> | undefined;
    let permissionsShape: string | undefined;

    for (let j = 0; j < body.length; j += 1) {
      const bodyLine = body[j];
      if (bodyLine === undefined || bodyLine.indent !== keyIndent) continue;
      const bodyEntry = splitEntry(bodyLine.text);
      if (bodyEntry === undefined) continue;
      if (bodyEntry.key === "uses") uses = bodyEntry.value;
      if (bodyEntry.key === "permissions") {
        if (bodyEntry.value !== "") {
          permissionsShape = bodyEntry.value;
          continue;
        }
        const grants = new Map<string, string>();
        const permissionLines = blockBody(body, j);
        const grantIndent =
          permissionLines.length === 0 ? 0 : Math.min(...permissionLines.map((l) => l.indent));
        for (const permissionLine of permissionLines) {
          if (permissionLine.indent !== grantIndent) continue;
          const grant = splitEntry(permissionLine.text);
          if (grant !== undefined) grants.set(grant.key, grant.value);
        }
        permissions = grants;
      }
    }

    if (uses !== undefined && uses !== "") {
      callers.push({ name: entry.key, uses, permissions, permissionsShape });
    }
  }

  if (callers.length > 1) {
    const names = callers.map((caller) => caller.name).join(", ");
    return {
      refusal: `expected exactly one job calling a reusable workflow, found ${String(callers.length)} (${names})`,
    };
  }
  const only = callers[0];
  return only === undefined ? undefined : { job: only };
}

/**
 * Every problem with the workflow at `path`, in the order a reader should act on them. An empty
 * array means the caller grants what the shared workflow requires.
 */
function releaseCallerProblems(path: string): string[] {
  const label = WORKFLOW_RELATIVE_PATH;

  let source: string;
  try {
    source = readFileSync(path, "utf8");
  } catch {
    return [
      `${label} could not be read at ${path}. The Release caller's permissions cannot be checked, so this guard reports a failure rather than success.`,
    ];
  }

  if (source.trim() === "") {
    return [`${label} is empty, so it declares no calling job and grants no permissions.`];
  }

  const scanned = readSourceLines(source);
  if ("refusal" in scanned) {
    return [`${label} could not be read: ${scanned.refusal}.`];
  }

  const found = findCallerJob(scanned.lines);
  if (found === undefined) {
    return [
      `${label} contains no job that calls a reusable workflow, so there is nothing here granting the shared release pipeline its permissions.`,
    ];
  }
  if ("refusal" in found) {
    return [`${label} could not be read: ${found.refusal}.`];
  }

  const job = found.job;
  const problems: string[] = [];

  const calledWorkflow = job.uses.split("@")[0] ?? job.uses;
  if (calledWorkflow !== SHARED_WORKFLOW) {
    problems.push(
      `${label}: job \`${job.name}\` calls \`${job.uses}\`, not \`${SHARED_WORKFLOW}\`. The required permissions asserted here were derived from the latter, so re-derive them against the workflow now being called instead of asserting a list nothing is party to.`,
    );
  }

  if (job.permissionsShape !== undefined) {
    problems.push(
      `${label}: job \`${job.name}\` writes \`permissions: ${job.permissionsShape}\`, which this guard does not read. Spell the grants out as a block mapping, one key per line, so each one can be compared.`,
    );
    return problems;
  }

  if (job.permissions === undefined) {
    problems.push(
      `${label}: job \`${job.name}\` declares no \`permissions:\` block. A called workflow's GITHUB_TOKEN can only be downgraded by its caller and never elevated, and this repository's default is \`contents: read\`, so the shared workflow's own request becomes an escalation and GitHub refuses the workflow at startup: no job runs, no log is written, and nothing is reported.`,
    );
    return problems;
  }

  const grants = job.permissions;
  for (const required of REQUIRED_PERMISSIONS) {
    const granted = grants.get(required.key);
    if (granted === undefined) {
      problems.push(
        `${label}: job \`${job.name}\` does not grant \`${required.key}\`, which the shared workflow requires at \`${required.level}\`. An omitted key is granted \`none\`, and GitHub refuses the workflow at startup rather than running it with less.`,
      );
      continue;
    }
    const grantedRank = rankOf(granted);
    if (grantedRank === undefined) {
      problems.push(
        `${label}: job \`${job.name}\` grants \`${required.key}: ${granted}\`, which is not one of none, read or write, so this guard cannot tell whether it meets the required \`${required.level}\`.`,
      );
      continue;
    }
    if (grantedRank < PERMISSION_RANK[required.level]) {
      problems.push(
        `${label}: job \`${job.name}\` grants \`${required.key}: ${granted}\`, which is weaker than the \`${required.key}: ${required.level}\` the shared workflow requires.`,
      );
    }
  }

  return problems;
}

/** The assertion itself: throws carrying every problem, so a failing run names all of them at once. */
function assertReleaseCallerIsSound(path: string): void {
  const problems = releaseCallerProblems(path);
  if (problems.length > 0) {
    throw new Error(
      `The Release caller workflow no longer grants what the shared release workflow requires.\n\n${problems.join("\n\n")}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Fixtures. Every unhappy path is a named delta from the passing control.
// ---------------------------------------------------------------------------

const CONTROL_PERMISSIONS = [
  "actions: read",
  "contents: write",
  "id-token: write",
  "pull-requests: write",
];

/**
 * A caller workflow in the shape of the real one. `permissions: null` omits the block entirely;
 * `permissions` as a string writes it inline, which is the shape the scanner refuses.
 */
function callerWorkflow(
  options: {
    permissions?: readonly string[] | string | null;
    uses?: string;
    jobName?: string;
    extraJob?: boolean;
  } = {},
): string {
  // `??` is deliberately not used here: `null` MEANS "omit the block" and must not coalesce into
  // the control set, which is exactly the bug that made the missing-block case pass green once.
  const permissions = options.permissions === undefined ? CONTROL_PERMISSIONS : options.permissions;
  const uses = options.uses ?? `${SHARED_WORKFLOW}@main`;
  const jobName = options.jobName ?? "release";

  const lines = ["name: Release", "", "on:", "  push:", "    branches: [main]", "", "jobs:"];
  lines.push(`  ${jobName}:`);
  if (typeof permissions === "string") {
    lines.push(`    permissions: ${permissions}`);
  } else if (permissions !== null) {
    lines.push("    permissions:");
    for (const grant of permissions) lines.push(`      ${grant}`);
  }
  lines.push(`    uses: ${uses}`, "    with:", '      package-name: "@cosyte/fhir"');
  lines.push("    secrets: inherit");
  if (options.extraJob === true) {
    lines.push("  release-again:", `    uses: ${uses}`, "    secrets: inherit");
  }
  return `${lines.join("\n")}\n`;
}

/** Write `source` to a throwaway file and hand back its path. Nothing here touches the real tree. */
function fixtureFile(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), "fhir-release-caller-"));
  const path = join(dir, "release.yml");
  writeFileSync(path, source, "utf8");
  return path;
}

/** A path inside a real directory that was never written to. */
function absentFile(): string {
  return join(mkdtempSync(join(tmpdir(), "fhir-release-caller-")), "release.yml");
}

const WORKFLOW_PATH = join(REPO_ROOT, WORKFLOW_RELATIVE_PATH);

// ---------------------------------------------------------------------------

describe("the Release caller grants the permissions the shared workflow requires", () => {
  it("passes on this repository's own workflow", () => {
    expect(() => {
      assertReleaseCallerIsSound(WORKFLOW_PATH);
    }).not.toThrow();
    expect(releaseCallerProblems(WORKFLOW_PATH)).toEqual([]);
  });

  it("reads all four grants out of the real file, at the levels required", () => {
    // Read independently of the scanner, so this case still fails if the scanner silently stops
    // finding the block and reports "no problems" over a file it never looked inside.
    const source = readFileSync(WORKFLOW_PATH, "utf8");
    for (const required of REQUIRED_PERMISSIONS) {
      expect(source).toMatch(new RegExp(`^\\s*${required.key}:\\s*${required.level}\\b`, "m"));
    }
    expect(source).toContain(`uses: ${SHARED_WORKFLOW}@`);
  });

  it("passes on the control fixture, so every failing fixture below differs by one thing", () => {
    expect(releaseCallerProblems(fixtureFile(callerWorkflow()))).toEqual([]);
  });

  it("reds on a COPY of the real file with the historical line removed", () => {
    // The strongest available evidence that this guard is not vacuous. The three refused runs were
    // this exact file without its `actions: read` line, so the regression is reproduced from the
    // real bytes rather than from a fixture that merely resembles them. The copy lives in a temp
    // dir: the workflow in this repository is never written to by this suite.
    const real = readFileSync(WORKFLOW_PATH, "utf8");
    expect(releaseCallerProblems(fixtureFile(real))).toEqual([]);

    const historical = real
      .split("\n")
      .filter((line) => !/^\s*actions:\s*read\b/.test(line))
      .join("\n");
    expect(historical).not.toBe(real);

    const problems = releaseCallerProblems(fixtureFile(historical));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("does not grant `actions`");
  });

  it("tolerates a ref other than @main, which does not change what is required", () => {
    const path = fixtureFile(callerWorkflow({ uses: `${SHARED_WORKFLOW}@v1.2.3` }));
    expect(releaseCallerProblems(path)).toEqual([]);
  });
});

describe("a missing permissions block names itself and says what GitHub does about it", () => {
  it("fails naming the absent block, with no job and no log", () => {
    const path = fixtureFile(callerWorkflow({ permissions: null }));
    expect(() => {
      assertReleaseCallerIsSound(path);
    }).toThrow(/declares no `permissions:` block/);
    const [problem] = releaseCallerProblems(path);
    expect(problem).toContain(WORKFLOW_RELATIVE_PATH);
    expect(problem).toContain("refuses the workflow at startup");
    expect(problem).toContain("no job runs");
    expect(problem).toContain("no log is written");
    expect(problem).toContain("can only be downgraded");
  });

  it("refuses an inline permissions scalar rather than reading it as a grant", () => {
    // `write-all` would in fact grant everything, and is still refused: this guard compares keys it
    // can read, and a shape it cannot read must never come out green.
    const path = fixtureFile(callerWorkflow({ permissions: "write-all" }));
    expect(() => {
      assertReleaseCallerIsSound(path);
    }).toThrow(/permissions: write-all/);
  });
});

describe("a permission that is absent or weaker than required fails naming the key", () => {
  for (const missing of REQUIRED_PERMISSIONS) {
    it(`fails naming \`${missing.key}\` when only that key is dropped`, () => {
      const kept = CONTROL_PERMISSIONS.filter((grant) => !grant.startsWith(`${missing.key}:`));
      expect(kept).toHaveLength(CONTROL_PERMISSIONS.length - 1);
      const path = fixtureFile(callerWorkflow({ permissions: kept }));

      expect(() => {
        assertReleaseCallerIsSound(path);
      }).toThrow(new RegExp(`does not grant \`${missing.key}\``));

      const problems = releaseCallerProblems(path);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain(missing.key);
      expect(problems[0]).toContain(missing.level);
    });
  }

  it("fails naming `contents` when it is present but only at read", () => {
    // The historical shape: three write grants and no `actions` key at all was the real refusal,
    // and a downgraded `contents` is the same mistake spelled a different way.
    const path = fixtureFile(
      callerWorkflow({
        permissions: CONTROL_PERMISSIONS.map((grant) =>
          grant.startsWith("contents:") ? "contents: read" : grant,
        ),
      }),
    );
    const problems = releaseCallerProblems(path);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("contents: read");
    expect(problems[0]).toContain("weaker than");
    expect(() => {
      assertReleaseCallerIsSound(path);
    }).toThrow(/contents/);
  });

  it("fails naming `actions` on the exact block that was refused at startup three times", () => {
    const path = fixtureFile(
      callerWorkflow({
        permissions: ["contents: write", "id-token: write", "pull-requests: write"],
      }),
    );
    const problems = releaseCallerProblems(path);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("does not grant `actions`");
  });

  it("names every offending key at once when several are wrong", () => {
    const path = fixtureFile(callerWorkflow({ permissions: ["contents: read"] }));
    const problems = releaseCallerProblems(path);
    expect(problems).toHaveLength(4);
    for (const required of REQUIRED_PERMISSIONS) {
      expect(problems.some((problem) => problem.includes(required.key))).toBe(true);
    }
  });

  it("refuses a level it cannot compare rather than reading it as sufficient", () => {
    const path = fixtureFile(
      callerWorkflow({
        permissions: CONTROL_PERMISSIONS.map((grant) =>
          grant.startsWith("contents:") ? "contents: maybe" : grant,
        ),
      }),
    );
    const problems = releaseCallerProblems(path);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("not one of none, read or write");
  });
});

describe("an absent, empty or job-less workflow fails naming the file", () => {
  it("fails naming the file when it does not exist", () => {
    const path = absentFile();
    expect(() => {
      assertReleaseCallerIsSound(path);
    }).toThrow(new RegExp(WORKFLOW_RELATIVE_PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    expect(releaseCallerProblems(path)[0]).toContain("could not be read");
  });

  for (const [label, source] of [
    ["empty", ""],
    ["whitespace only", "\n\n   \n"],
    ["comments only", "# nothing but a comment\n"],
  ] as const) {
    it(`fails naming the file when it is ${label}`, () => {
      const problems = releaseCallerProblems(fixtureFile(source));
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain(WORKFLOW_RELATIVE_PATH);
    });
  }

  it("fails naming the file when no job calls a reusable workflow", () => {
    const source = [
      "name: Release",
      "on:",
      "  push:",
      "    branches: [main]",
      "jobs:",
      "  release:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: echo nothing is released here",
      "",
    ].join("\n");
    const problems = releaseCallerProblems(fixtureFile(source));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(WORKFLOW_RELATIVE_PATH);
    expect(problems[0]).toContain("no job that calls a reusable workflow");
  });

  it("fails naming the file when the jobs block is gone entirely", () => {
    const problems = releaseCallerProblems(
      fixtureFile("name: Release\non:\n  push:\n    branches: [main]\n"),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("no job that calls a reusable workflow");
  });

  it("refuses two calling jobs rather than picking one to grade", () => {
    const problems = releaseCallerProblems(fixtureFile(callerWorkflow({ extraJob: true })));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("exactly one job calling a reusable workflow");
  });
});

describe("the required list is keyed to the workflow actually being called", () => {
  for (const [label, uses] of [
    ["a different workflow in the same repository", "cosyte/.github/.github/workflows/ci.yml@main"],
    ["a fork of the shared repository", "someone-else/.github/.github/workflows/release.yml@main"],
    ["a local workflow", "./.github/workflows/release-local.yml"],
  ] as const) {
    it(`fails when the caller points at ${label}`, () => {
      const path = fixtureFile(callerWorkflow({ uses }));
      expect(() => {
        assertReleaseCallerIsSound(path);
      }).toThrow(/re-derive them against the workflow now being called/);
      const problems = releaseCallerProblems(path);
      expect(problems[0]).toContain(uses.split("@")[0] ?? uses);
      expect(problems[0]).toContain(SHARED_WORKFLOW);
    });
  }

  it("still fails on a moved target even when the permissions are the required four", () => {
    // The permissions are correct for the OLD callee, which is the point: correct-looking grants
    // must not mask the fact that they are being asserted against the wrong contract.
    const path = fixtureFile(callerWorkflow({ uses: "cosyte/.github/.github/workflows/ci.yml" }));
    const problems = releaseCallerProblems(path);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("re-derive");
  });
});

describe("the scanner reads the constructs the real file uses, and refuses the rest", () => {
  it("keeps a quoted value containing a hash instead of reading it as a comment", () => {
    expect(stripComment('      package-name: "@cosyte/fhir#tag"')).toBe(
      '      package-name: "@cosyte/fhir#tag"',
    );
  });

  it("strips a trailing comment, which every grant in the real file carries", () => {
    expect(stripComment("      actions: read # the shared workflow reads this").trim()).toBe(
      "actions: read",
    );
    expect(splitEntry(stripComment("      actions: read # a comment").trim())).toEqual({
      key: "actions",
      value: "read",
    });
  });

  it("refuses a tab-indented file rather than misreading its nesting", () => {
    const problems = releaseCallerProblems(fixtureFile("jobs:\n\trelease:\n\t\tuses: x\n"));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("indented with a tab");
  });
});
