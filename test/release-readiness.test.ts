/**
 * The release readiness check, and the certified public surface it reports readiness over.
 *
 * WHY THIS FILE EXISTS. A version number is a promise, and Changesets derives it mechanically from
 * the bump levels sitting in `.changeset/`. Nothing between a changeset and the registry re-reads
 * what the change actually did, so a withdrawal of working public behaviour declared `patch` ships
 * as a patch: the consumer takes it on a caret range, and the first they hear of the break is their
 * own build. `.github/workflows/release.yml` fires on every push to the default branch and opens a
 * "Version Packages" pull request whose merge publishes, and an npm version is permanent. The
 * decision therefore has to be auditable BEFORE the button, which is what this file grades.
 *
 * WHAT IS GRADED, precisely:
 *
 *  1. THE PENDING SET. Every file in `.changeset/` other than `README.md` and `config.json` is a
 *     changeset. Each is read for the package it names and the level it declares, and the level is
 *     compared against the classification rule below. A file that cannot be read is a REFUSAL, never
 *     a skip and never a default level.
 *  2. THE BREAK CANDIDATES. A changeset whose own text describes a withdrawal or a narrowing of
 *     previously working public behaviour is named, and may not sit at `patch`.
 *  3. THE DERIVED VERSION. What Changesets would produce from the classified set, and whether that
 *     is the version the release is asking for.
 *  4. THE CERTIFIED SURFACE. The entry point's exported names and their kinds, and the `exports`
 *     subpaths, compared against a committed inventory in BOTH directions.
 *  5. NO PUBLICATION. The package version and the `VERSION` export still agree and still read what
 *     this tree measured, and every classified changeset is still pending.
 *
 * THE CLASSIFICATION RULE, stated here because the check applies it and a reader grading a verdict
 * needs it in front of them:
 *
 *   - `major` is NOT AVAILABLE on a `0.x` line for this release and is a defect wherever declared.
 *   - `minor` for EITHER new public capability (a new export, a new optional member on a public
 *     type, an input the API now accepts that it refused, a new published diagnostic code) OR any
 *     WITHDRAWAL or NARROWING of previously working public behaviour (an output the library now
 *     refuses to produce, a document that now reports an error where it reported none, an export
 *     removed or renamed, a widened finding set that can turn a `valid` document invalid).
 *   - `patch` only for a fix leaving every public observable identical, or a change with no effect
 *     on the published artifact at all (tests, harnesses, CI, in-repo documentation).
 *   - A withdrawal is `minor` AT MINIMUM precisely because `major` is unavailable: on a `0.x`
 *     package the minor position is the only place a break can be signalled.
 *
 * FAIL CLOSED, EVERYWHERE. Every refusal below reports a problem rather than skipping. An empty
 * `.changeset/`, an absent one, a file with no frontmatter, a foreign package name, an unknown level
 * and a `major` declaration are each a named failure. A readiness check that reports "ready" over a
 * set it could not read is worse than no check: it is the one output that gets acted on.
 *
 * NO BUILD, NO JVM, NO NETWORK, NO CREDENTIALS. Everything here reads the working tree and the
 * package entry point through the ordinary test import. The unhappy paths are driven from fixtures
 * written into temp directories, never by editing the real `.changeset/`, and a passing control
 * proves the fixtures fail for the reason named rather than an unrelated one.
 */

import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import * as entryPoint from "../src/index.js";
import { VERSION } from "../src/index.js";

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
const CHANGESET_DIR = join(REPO_ROOT, ".changeset");

/** The package these changesets may name, and nothing else. */
const PACKAGE_NAME = "@cosyte/fhir";

/** The two files in `.changeset/` that are not changesets. */
const NON_CHANGESET_FILES = new Set(["README.md", "config.json"]);

/** The levels Changesets understands. `major` is among them and is separately refused. */
const BUMP_LEVELS = ["patch", "minor", "major"] as const;
type BumpLevel = (typeof BUMP_LEVELS)[number];

// ---------------------------------------------------------------------------
// Reading a changeset. Every unreadable shape is a refusal carrying the file name.
// ---------------------------------------------------------------------------

interface PendingChangeset {
  readonly file: string;
  readonly declared: BumpLevel;
  readonly body: string;
}

interface ChangesetDefect {
  readonly file: string;
  readonly defect: string;
}

type ChangesetRead = { readonly ok: PendingChangeset } | { readonly bad: ChangesetDefect };

/**
 * Read one changeset file.
 *
 * The frontmatter is the block between the first two `---` fences. It is read as
 * `"<package>": <level>` entries, which is the only shape Changesets writes for a single-package
 * repository. Anything else is refused by name: a defaulted level is precisely how a `minor` change
 * ships as a patch, so there is no default here.
 */
function readChangeset(file: string, source: string): ChangesetRead {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(source);
  if (match === null) {
    return {
      bad: {
        file,
        defect:
          "has no parseable frontmatter: a changeset must open with a `---` fenced block naming the package and its bump level",
      },
    };
  }

  const frontmatter = match[1] ?? "";
  const body = (match[2] ?? "").trim();

  const entries: Array<{ pkg: string; level: string }> = [];
  for (const raw of frontmatter.split(/\r?\n/)) {
    const text = raw.trim();
    if (text === "") continue;
    const entry = /^(["']?)([^"':]+)\1\s*:\s*(.+)$/.exec(text);
    if (entry === null) {
      return {
        bad: { file, defect: `has a frontmatter line this check cannot read: \`${text}\`` },
      };
    }
    entries.push({
      pkg: (entry[2] ?? "").trim(),
      level: (entry[3] ?? "").trim().replace(/^["']|["']$/g, ""),
    });
  }

  if (entries.length === 0) {
    return { bad: { file, defect: "declares no package at all in its frontmatter" } };
  }
  if (entries.length > 1) {
    const named = entries.map((e) => e.pkg).join(", ");
    return {
      bad: { file, defect: `declares more than one package (${named}); this repository has one` },
    };
  }

  const only = entries[0];
  if (only === undefined) {
    return { bad: { file, defect: "declares no package at all in its frontmatter" } };
  }
  if (only.pkg !== PACKAGE_NAME) {
    return {
      bad: {
        file,
        defect: `names package \`${only.pkg}\`, which is not \`${PACKAGE_NAME}\``,
      },
    };
  }
  if (!(BUMP_LEVELS as readonly string[]).includes(only.level)) {
    return {
      bad: {
        file,
        defect: `declares bump level \`${only.level}\`, which is not one of ${BUMP_LEVELS.join(", ")}`,
      },
    };
  }
  if (only.level === "major") {
    return {
      bad: {
        file,
        defect:
          "declares `major`, which is not available on this `0.x` line: a major bump derives `1.0.0`, which this release is not asking for",
      },
    };
  }

  return { ok: { file, declared: only.level as BumpLevel, body } };
}

// ---------------------------------------------------------------------------
// The classification rule, applied to a changeset's own text.
// ---------------------------------------------------------------------------

/**
 * Phrases that mark a WITHDRAWAL or NARROWING of previously working public behaviour.
 *
 * These are read from the changeset's own prose, which in this repository states the cost of a
 * change explicitly. The recogniser is deliberately narrow and its misses are the safe direction
 * for the automated half: it can only ever RAISE a level or name a break, never lower one or clear
 * one, and the audit carries the human reading beside it. What it must never do is stay silent on a
 * changeset that says in plain words that it takes something away.
 */
const WITHDRAWAL_PHRASES: readonly string[] = [
  "withdraws",
  "withdrawal",
  "no longer written",
  "no longer produces",
  "no longer accepts",
  "now refuses",
  "refuses rather than",
  "removed from the public",
  "renamed",
  "breaking change",
  "turn a previously valid",
  "only ever adds a finding",
];

/** Phrases that mark NEW public capability. */
const CAPABILITY_PHRASES: readonly string[] = [
  "now carries an optional",
  "gains a new",
  "new public",
  "additive throughout",
  "a new export",
];

/** Phrases a changeset uses to say it does not reach the published artifact at all. */
const NO_SHIP_PHRASES: readonly string[] = [
  "nothing here ships in the published artifact",
  "no library code changed",
];

interface Classification {
  readonly level: BumpLevel;
  readonly breakCandidate: boolean;
  readonly reason: string;
}

/** Apply the rule to one changeset's text. */
function classify(changeset: PendingChangeset): Classification {
  const text = changeset.body.toLowerCase();
  const hit = (phrases: readonly string[]): string | undefined =>
    phrases.find((phrase) => text.includes(phrase));

  const withdrawal = hit(WITHDRAWAL_PHRASES);
  if (withdrawal !== undefined) {
    return {
      level: "minor",
      breakCandidate: true,
      reason: `its own text describes a withdrawal or narrowing of previously working public behaviour (\`${withdrawal}\`), which is \`minor\` at minimum because \`major\` is unavailable on this line`,
    };
  }

  const noShip = hit(NO_SHIP_PHRASES);
  const capability = hit(CAPABILITY_PHRASES);
  if (capability !== undefined && noShip === undefined) {
    return {
      level: "minor",
      breakCandidate: false,
      reason: `its own text describes new public capability (\`${capability}\`)`,
    };
  }
  if (noShip !== undefined) {
    return {
      level: "patch",
      breakCandidate: false,
      reason: `its own text states that nothing in it reaches the published artifact (\`${noShip}\`)`,
    };
  }
  return {
    level: "patch",
    breakCandidate: false,
    reason:
      "its own text describes no new public capability and no withdrawal of existing behaviour",
  };
}

// ---------------------------------------------------------------------------
// Deriving the next version, the way Changesets would.
// ---------------------------------------------------------------------------

/** `x.y.z` -> the version a bump of `level` produces. No pre-release handling: none is in use. */
function bump(version: string, level: BumpLevel): string {
  const parts = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (parts === null) throw new Error(`version \`${version}\` is not x.y.z`);
  const [major, minor, patch] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  if (level === "major") return `${String(major + 1)}.0.0`;
  if (level === "minor") return `${String(major)}.${String(minor + 1)}.0`;
  return `${String(major)}.${String(minor)}.${String(patch + 1)}`;
}

/** The single level a set of changesets resolves to: the highest any member declares. */
function highest(levels: readonly BumpLevel[]): BumpLevel | undefined {
  if (levels.includes("major")) return "major";
  if (levels.includes("minor")) return "minor";
  return levels.includes("patch") ? "patch" : undefined;
}

// ---------------------------------------------------------------------------
// The readiness check itself.
// ---------------------------------------------------------------------------

interface ReadinessOptions {
  /** Where the pending set lives. */
  readonly changesetDir: string;
  /** The version the set is derived FROM. */
  readonly currentVersion: string;
  /** The version this release is asking for. */
  readonly targetVersion: string;
}

interface ReadinessReport {
  /** Zero only when the set is well formed, consistently classified and derives the target. */
  readonly exitCode: number;
  /** What the check prints. A reader acts on this, so every refusal names its file. */
  readonly output: string;
  readonly problems: readonly string[];
  readonly classified: number;
  readonly derivedVersion: string | undefined;
  readonly breakCandidates: readonly string[];
}

/**
 * Grade one pending set. Reads the directory, refuses what it cannot read, classifies what it can,
 * derives the version, and reports readiness only when nothing above went wrong.
 */
function releaseReadiness(options: ReadinessOptions): ReadinessReport {
  const problems: string[] = [];
  const lines: string[] = [];

  let files: string[];
  try {
    files = readdirSync(options.changesetDir)
      .filter((name) => !NON_CHANGESET_FILES.has(name))
      .filter((name) => name.endsWith(".md"))
      .sort();
  } catch {
    return {
      exitCode: 1,
      output: `.changeset/ is absent at ${options.changesetDir}: zero pending changesets, and a tree with no pending changeset derives no new version. NOT RELEASABLE.`,
      problems: [`.changeset/ is absent at ${options.changesetDir}`],
      classified: 0,
      derivedVersion: undefined,
      breakCandidates: [],
    };
  }

  if (files.length === 0) {
    return {
      exitCode: 1,
      output: `.changeset/ holds no changeset file: zero pending changesets, and a tree with no pending changeset derives no new version. NOT RELEASABLE.`,
      problems: [".changeset/ holds no changeset file"],
      classified: 0,
      derivedVersion: undefined,
      breakCandidates: [],
    };
  }

  const pending: PendingChangeset[] = [];
  for (const file of files) {
    const read = readChangeset(file, readFileSync(join(options.changesetDir, file), "utf8"));
    if ("bad" in read) {
      problems.push(`.changeset/${read.bad.file} ${read.bad.defect}`);
      continue;
    }
    pending.push(read.ok);
  }

  // A defect stops the run. Classifying the readable remainder and reporting a version over it is
  // exactly the "skip it and count the rest" behaviour that must not happen.
  if (problems.length > 0) {
    return {
      exitCode: 1,
      output: `${String(problems.length)} changeset file(s) could not be read, so this set was not classified and no version was derived. NOT RELEASABLE.\n${problems.join("\n")}`,
      problems,
      classified: 0,
      derivedVersion: undefined,
      breakCandidates: [],
    };
  }

  const breakCandidates: string[] = [];
  const levels: BumpLevel[] = [];
  for (const changeset of pending) {
    const verdict = classify(changeset);
    levels.push(verdict.level);
    if (verdict.breakCandidate) {
      breakCandidates.push(changeset.file);
      if (changeset.declared === "patch") {
        problems.push(
          `.changeset/${changeset.file} is a break candidate and declares \`patch\`: ${verdict.reason}. A withdrawal shipped as a patch reaches a consumer on a caret range with no signal.`,
        );
      }
    }
    if (changeset.declared !== verdict.level) {
      problems.push(
        `.changeset/${changeset.file} declares \`${changeset.declared}\` and the classification rule yields \`${verdict.level}\`: ${verdict.reason}.`,
      );
    }
    lines.push(
      `.changeset/${changeset.file}: declared ${changeset.declared}, rule ${verdict.level}`,
    );
  }

  const level = highest(pending.map((changeset) => changeset.declared));
  const derivedVersion = level === undefined ? undefined : bump(options.currentVersion, level);

  if (derivedVersion !== options.targetVersion) {
    problems.push(
      `the pending set derives \`${String(derivedVersion)}\` from \`${options.currentVersion}\`, not the requested \`${options.targetVersion}\`.`,
    );
  }

  if (problems.length > 0) {
    return {
      exitCode: 1,
      output: `NOT RELEASABLE.\n${lines.join("\n")}\n${problems.join("\n")}`,
      problems,
      classified: pending.length,
      derivedVersion,
      breakCandidates,
    };
  }

  return {
    exitCode: 0,
    output: `classified ${String(pending.length)} changeset(s); derived version ${String(derivedVersion)} from ${options.currentVersion}. RELEASABLE.`,
    problems,
    classified: pending.length,
    derivedVersion,
    breakCandidates,
  };
}

// ---------------------------------------------------------------------------
// Fixtures. Never the real `.changeset/`.
// ---------------------------------------------------------------------------

/** Write a set of changesets into a throwaway directory and hand back its path. */
function fixtureDir(files: Readonly<Record<string, string>>): string {
  const dir = mkdtempSync(join(tmpdir(), "fhir-release-readiness-"));
  for (const [name, source] of Object.entries(files))
    writeFileSync(join(dir, name), source, "utf8");
  return dir;
}

/** A changeset declaring `level`, with `body` as its prose. */
function changeset(level: string, body: string, pkg: string = PACKAGE_NAME): string {
  return `---\n"${pkg}": ${level}\n---\n\n${body}\n`;
}

/** Prose the rule reads as an ordinary fix. */
const PATCH_PROSE = "A rounding fix in an internal helper. Every public observable is identical.";

/** Prose the rule reads as a withdrawal, in this repository's own idiom. */
const WITHDRAWAL_PROSE =
  "This withdraws an XML round trip from a document that reads valid, which is a cost two refusals beside it already pay.";

/** Prose the rule reads as new public capability. */
const CAPABILITY_PROSE =
  "The result now carries an optional member declaring the release an answer was made against. Additive throughout.";

const CONTROL_OPTIONS = { currentVersion: "0.0.11", targetVersion: "0.1.0" };

// ===========================================================================
// AC1 + AC5: the pending set as this tree actually holds it.
// ===========================================================================

describe("the pending changeset set, re-measured on this tree", () => {
  it("names every file in .changeset/, and only README.md and config.json are not changesets", () => {
    const present = readdirSync(CHANGESET_DIR).sort();
    for (const name of NON_CHANGESET_FILES) {
      expect(present, `.changeset/${name} is missing`).toContain(name);
    }
    const changesets = present.filter((name) => !NON_CHANGESET_FILES.has(name));
    // This is the MEASUREMENT, not a wish. It is asserted so that a changeset added after this
    // audit reds the suite and forces the classification to be redone rather than inherited.
    expect(
      changesets,
      "the pending set moved since the readiness audit was written; re-run the classification in documentation/release-0.1.0-readiness.md",
    ).toEqual([]);
  });

  it("reports the empty set as zero pending, refuses to call it releasable, and exits non-zero", () => {
    const report = releaseReadiness({ ...CONTROL_OPTIONS, changesetDir: CHANGESET_DIR });
    expect(report.classified).toBe(0);
    expect(report.derivedVersion).toBeUndefined();
    expect(report.exitCode).not.toBe(0);
    expect(report.output).toContain("zero pending changesets");
    expect(report.output).toContain("NOT RELEASABLE");
  });
});

// ===========================================================================
// AC6: an empty or absent `.changeset/`.
// ===========================================================================

describe("an empty or absent .changeset/ is reported, never treated as ready", () => {
  it("reports zero pending and exits non-zero on an empty directory", () => {
    const report = releaseReadiness({ ...CONTROL_OPTIONS, changesetDir: fixtureDir({}) });
    expect(report.exitCode).toBe(1);
    expect(report.classified).toBe(0);
    expect(report.output).toContain("holds no changeset file");
    expect(report.output).toContain("NOT RELEASABLE");
  });

  it("reports zero pending and exits non-zero when only the two non-changesets are there", () => {
    const report = releaseReadiness({
      ...CONTROL_OPTIONS,
      changesetDir: fixtureDir({ "README.md": "# Changesets\n", "config.json": "{}\n" }),
    });
    expect(report.exitCode).toBe(1);
    expect(report.classified).toBe(0);
    expect(report.output).toContain("zero pending changesets");
  });

  it("names the condition and exits non-zero when the directory does not exist", () => {
    const absent = join(mkdtempSync(join(tmpdir(), "fhir-release-readiness-")), "nonesuch");
    const report = releaseReadiness({ ...CONTROL_OPTIONS, changesetDir: absent });
    expect(report.exitCode).toBe(1);
    expect(report.classified).toBe(0);
    expect(report.output).toContain("is absent");
    expect(report.output).toContain("NOT RELEASABLE");
  });

  it("does not report a derived version for a set it could not read", () => {
    for (const dir of [fixtureDir({}), join(mkdtempSync(join(tmpdir(), "x-")), "nope")]) {
      expect(releaseReadiness({ ...CONTROL_OPTIONS, changesetDir: dir }).derivedVersion).toBe(
        undefined,
      );
    }
  });
});

// ===========================================================================
// AC7: a malformed changeset is named, never skipped, counted or defaulted.
// ===========================================================================

describe("a malformed changeset is named with its defect and stops the run", () => {
  const MALFORMED: ReadonlyArray<readonly [label: string, source: string, expected: string]> = [
    ["no frontmatter at all", "just prose, no fence\n", "no parseable frontmatter"],
    ["an unterminated fence", '---\n"@cosyte/fhir": patch\n', "no parseable frontmatter"],
    ["an empty frontmatter block", "---\n\n---\n\nprose\n", "declares no package at all"],
    [
      "a foreign package name",
      changeset("patch", PATCH_PROSE, "@cosyte/hl7"),
      "is not `@cosyte/fhir`",
    ],
    ["a level outside the three", changeset("wibble", PATCH_PROSE), "which is not one of"],
    ["a major declaration", changeset("major", PATCH_PROSE), "not available on this `0.x` line"],
  ];

  for (const [label, source, expected] of MALFORMED) {
    it(`fails naming the file and the defect: ${label}`, () => {
      const report = releaseReadiness({
        ...CONTROL_OPTIONS,
        changesetDir: fixtureDir({ "broken-thing.md": source }),
      });
      expect(report.exitCode).toBe(1);
      expect(report.problems).toHaveLength(1);
      expect(report.problems[0]).toContain("broken-thing.md");
      expect(report.problems[0]).toContain(expected);
    });

    it(`does not skip it, count it, or fall back to a level: ${label}`, () => {
      // The defective file sits beside a perfectly good one. A check that skipped the bad file
      // would classify 1, derive a version and report readiness over a set it half read.
      const report = releaseReadiness({
        ...CONTROL_OPTIONS,
        changesetDir: fixtureDir({
          "broken-thing.md": source,
          "good-thing.md": changeset("minor", CAPABILITY_PROSE),
        }),
      });
      expect(report.exitCode).toBe(1);
      expect(report.classified).toBe(0);
      expect(report.derivedVersion).toBeUndefined();
      expect(report.output).toContain("was not classified");
    });
  }

  it("refuses a changeset naming two packages rather than picking one", () => {
    const source = `---\n"${PACKAGE_NAME}": patch\n"@cosyte/hl7": minor\n---\n\n${PATCH_PROSE}\n`;
    const report = releaseReadiness({
      ...CONTROL_OPTIONS,
      changesetDir: fixtureDir({ "two-packages.md": source }),
    });
    expect(report.exitCode).toBe(1);
    expect(report.problems[0]).toContain("more than one package");
  });

  it("names every defective file when several are wrong at once", () => {
    const report = releaseReadiness({
      ...CONTROL_OPTIONS,
      changesetDir: fixtureDir({
        "a-thing.md": "no fence here\n",
        "b-thing.md": changeset("major", PATCH_PROSE),
        "c-thing.md": changeset("patch", PATCH_PROSE, "@cosyte/x12"),
      }),
    });
    expect(report.problems).toHaveLength(3);
    for (const name of ["a-thing.md", "b-thing.md", "c-thing.md"]) {
      expect(report.problems.some((problem) => problem.includes(name))).toBe(true);
    }
  });
});

// ===========================================================================
// AC2 + AC3 + AC4: classification, break candidates, and the patch refusal.
// ===========================================================================

describe("a break candidate is named and may not sit at patch", () => {
  it("fails naming the file and the observable when a withdrawal declares patch", () => {
    const report = releaseReadiness({
      ...CONTROL_OPTIONS,
      changesetDir: fixtureDir({ "takes-something-away.md": changeset("patch", WITHDRAWAL_PROSE) }),
    });
    expect(report.exitCode).toBe(1);
    expect(report.breakCandidates).toEqual(["takes-something-away.md"]);
    const named = report.problems.filter((problem) => problem.includes("break candidate"));
    expect(named).toHaveLength(1);
    expect(named[0]).toContain("takes-something-away.md");
    expect(named[0]).toContain("withdraws");
    expect(report.output).toContain("NOT RELEASABLE");
  });

  it("still names it a break candidate when it correctly declares minor", () => {
    // Classifying it right removes the PROBLEM, never the CANDIDACY: the audit names it either way,
    // because a consumer reading release notes needs to know a break shipped in that minor.
    const report = releaseReadiness({
      ...CONTROL_OPTIONS,
      changesetDir: fixtureDir({ "takes-something-away.md": changeset("minor", WITHDRAWAL_PROSE) }),
    });
    expect(report.breakCandidates).toEqual(["takes-something-away.md"]);
    expect(report.problems.filter((problem) => problem.includes("break candidate"))).toEqual([]);
    expect(report.exitCode).toBe(0);
  });

  it("reports the level the rule yields when a declaration disagrees with it", () => {
    const report = releaseReadiness({
      ...CONTROL_OPTIONS,
      changesetDir: fixtureDir({ "adds-something.md": changeset("patch", CAPABILITY_PROSE) }),
    });
    expect(report.exitCode).toBe(1);
    const named = report.problems.filter((problem) => problem.includes("adds-something.md"));
    expect(named[0]).toContain("declares `patch`");
    expect(named[0]).toContain("yields `minor`");
  });

  it("leaves a genuine patch alone, so the rule is not simply raising everything", () => {
    const report = releaseReadiness({
      currentVersion: "0.0.11",
      targetVersion: "0.0.12",
      changesetDir: fixtureDir({ "a-fix.md": changeset("patch", PATCH_PROSE) }),
    });
    expect(report.exitCode).toBe(0);
    expect(report.breakCandidates).toEqual([]);
    expect(report.derivedVersion).toBe("0.0.12");
  });

  it("reads `nothing here ships in the published artifact` as evidence for patch", () => {
    const prose =
      "The differential harness declares its inputs. No library code changed; nothing here ships in the published artifact.";
    const report = releaseReadiness({
      currentVersion: "0.0.11",
      targetVersion: "0.0.12",
      changesetDir: fixtureDir({ "harness-only.md": changeset("patch", prose) }),
    });
    expect(report.exitCode).toBe(0);
    expect(report.problems).toEqual([]);
  });
});

// ===========================================================================
// AC8: the happy path prints the count and the version.
// ===========================================================================

describe("a well formed, consistently classified set that derives the target", () => {
  it("exits zero and prints the count classified and the version derived", () => {
    const report = releaseReadiness({
      ...CONTROL_OPTIONS,
      changesetDir: fixtureDir({
        "adds-something.md": changeset("minor", CAPABILITY_PROSE),
        "a-fix.md": changeset("patch", PATCH_PROSE),
        "takes-something-away.md": changeset("minor", WITHDRAWAL_PROSE),
      }),
    });
    expect(report.exitCode).toBe(0);
    expect(report.problems).toEqual([]);
    expect(report.classified).toBe(3);
    expect(report.derivedVersion).toBe("0.1.0");
    expect(report.output).toContain("classified 3 changeset(s)");
    expect(report.output).toContain("derived version 0.1.0 from 0.0.11");
    expect(report.output).toContain("RELEASABLE");
  });

  it("refuses the same set when it derives a version the release did not ask for", () => {
    // Every member is a correctly classified patch, so nothing is malformed and nothing is
    // misclassified. It still is not a 0.1.0, and saying so is the whole job.
    const report = releaseReadiness({
      ...CONTROL_OPTIONS,
      changesetDir: fixtureDir({
        "a-fix.md": changeset("patch", PATCH_PROSE),
        "another-fix.md": changeset("patch", PATCH_PROSE),
      }),
    });
    expect(report.exitCode).toBe(1);
    expect(report.derivedVersion).toBe("0.0.12");
    expect(report.problems.some((problem) => problem.includes("not the requested `0.1.0`"))).toBe(
      true,
    );
  });

  it("derives from the highest level in the set, not the commonest", () => {
    expect(bump("0.0.11", "patch")).toBe("0.0.12");
    expect(bump("0.0.11", "minor")).toBe("0.1.0");
    expect(highest(["patch", "patch", "minor", "patch"])).toBe("minor");
    expect(highest(["patch", "patch"])).toBe("patch");
    expect(highest([])).toBeUndefined();
  });
});

// ===========================================================================
// AC9 + AC10 + AC11: the certified public surface.
// ===========================================================================

interface SurfaceInventory {
  readonly certifiedFor: string;
  readonly counts: {
    readonly values: number;
    readonly types: number;
    readonly exportSubpaths: number;
  };
  readonly values: readonly string[];
  readonly types: readonly string[];
  readonly exportSubpaths: readonly string[];
}

const INVENTORY = JSON.parse(
  readFileSync(new URL("./__data__/public-surface-0.1.0.json", import.meta.url), "utf8"),
) as SurfaceInventory;

const PACKAGE_JSON = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
  readonly version: string;
  readonly exports: Readonly<Record<string, unknown>>;
};

const ENTRY_SOURCE = readFileSync(join(REPO_ROOT, "src", "index.ts"), "utf8");

/**
 * The names `src/index.ts` exports, split by kind, read from the SOURCE.
 *
 * A type-only export is erased before runtime, so the runtime namespace cannot see one and cannot
 * be asked whether a name changed kind. That question is exactly AC10's, so the source is read too.
 * The reader handles only the constructs this entry point uses and REFUSES the rest: a construct it
 * silently ignored would drop a name from the comparison, which is the one failure a surface guard
 * may not have.
 */
function declaredSurface(source: string): {
  readonly values: Set<string>;
  readonly types: Set<string>;
} {
  const values = new Set<string>();
  const types = new Set<string>();
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

  const braced = /export\s+(type\s+)?\{([^}]*)\}\s*from\s*"[^"]*";/g;
  let match: RegExpExecArray | null;
  while ((match = braced.exec(stripped)) !== null) {
    const blockIsType = match[1] !== undefined;
    for (const raw of (match[2] ?? "").split(",")) {
      const entry = raw.trim();
      if (entry === "") continue;
      const inlineType = /^type\s+/.test(entry);
      const name = (
        entry
          .replace(/^type\s+/, "")
          .split(/\s+as\s+/)
          .pop() ?? ""
      ).trim();
      if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) {
        throw new Error(`src/index.ts exports a shape this guard cannot read: \`${entry}\``);
      }
      (blockIsType || inlineType ? types : values).add(name);
    }
  }

  const direct = /export\s+(?:const|let|var|function|class)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
  while ((match = direct.exec(stripped)) !== null) values.add(match[1] ?? "");
  const directType = /export\s+(?:interface|type)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
  while ((match = directType.exec(stripped)) !== null) types.add(match[1] ?? "");

  return { values, types };
}

/** Both directions of a name-set comparison. */
function delta(
  certified: readonly string[],
  actual: Iterable<string>,
): { readonly missing: string[]; readonly uncertified: string[] } {
  const present = new Set(actual);
  const inventory = new Set(certified);
  return {
    missing: [...inventory].filter((name) => !present.has(name)).sort(),
    uncertified: [...present].filter((name) => !inventory.has(name)).sort(),
  };
}

describe("the certified public surface matches the package entry point", () => {
  it("certifies the surface for the version this release is asking for", () => {
    expect(INVENTORY.certifiedFor).toBe("0.1.0");
    expect(INVENTORY.counts.values).toBe(INVENTORY.values.length);
    expect(INVENTORY.counts.types).toBe(INVENTORY.types.length);
    expect(INVENTORY.counts.exportSubpaths).toBe(INVENTORY.exportSubpaths.length);
  });

  it("counts what it certifies, so a dropped ROW reds even if every name still matches", () => {
    expect(INVENTORY.values).toHaveLength(170);
    expect(INVENTORY.types).toHaveLength(102);
    expect(INVENTORY.exportSubpaths).toHaveLength(2);
  });

  it("fails if a certified RUNTIME name is absent from the entry point (a removal)", () => {
    // Read from the real runtime namespace, independently of the source reader, so this direction
    // still holds if the reader ever stops seeing a construct.
    const runtime = Object.keys(entryPoint);
    expect(
      delta(INVENTORY.values, runtime).missing,
      "certified names the entry point no longer exports",
    ).toEqual([]);
  });

  it("fails if the entry point exports a RUNTIME name the inventory does not certify", () => {
    const runtime = Object.keys(entryPoint);
    expect(
      delta(INVENTORY.values, runtime).uncertified,
      "the entry point exports these and the inventory certifies neither",
    ).toEqual([]);
  });

  it("fails in both directions on the TYPE-only names too", () => {
    const declared = declaredSurface(ENTRY_SOURCE);
    const both = delta(INVENTORY.types, declared.types);
    expect(both.missing, "certified types the entry point no longer exports").toEqual([]);
    expect(both.uncertified, "types the entry point exports and the inventory does not").toEqual(
      [],
    );
  });

  it("agrees with the source reader on the value names as well as the runtime namespace", () => {
    const declared = declaredSurface(ENTRY_SOURCE);
    const both = delta(INVENTORY.values, declared.values);
    expect(both.missing).toEqual([]);
    expect(both.uncertified).toEqual([]);
  });
});

describe("a certified name that changes KIND fails, because a consumer's import breaks", () => {
  it("fails when a name certified as a runtime value survives only as a type", () => {
    // `import { X }` on a type-only export is a compile error for a CJS consumer and resolves to
    // `undefined` at runtime for an ESM one, even though the NAME is still exported. So the kinds
    // are compared, not just the names.
    const runtime = new Set(Object.keys(entryPoint));
    for (const name of INVENTORY.values) {
      expect(runtime.has(name), `${name} is certified a runtime value and is not one`).toBe(true);
    }
  });

  it("fails when a name certified type-only turns up as a runtime value", () => {
    const runtime = new Set(Object.keys(entryPoint));
    for (const name of INVENTORY.types) {
      expect(runtime.has(name), `${name} is certified type-only and is a runtime value`).toBe(
        false,
      );
    }
  });

  it("certifies no name as both a value and a type", () => {
    const overlap = INVENTORY.values.filter((name) => INVENTORY.types.includes(name));
    expect(overlap).toEqual([]);
  });

  it("has teeth: the kind comparison reds when a kind is flipped", () => {
    // The negative control. Without it every assertion above could be vacuously green.
    const runtime = new Set(Object.keys(entryPoint));
    const [aValue] = INVENTORY.values;
    const [aType] = INVENTORY.types;
    expect(aValue, "the inventory certifies no value to flip").toBeDefined();
    expect(aType, "the inventory certifies no type to flip").toBeDefined();
    // Certified the other way round, each one now contradicts the runtime.
    expect(runtime.has(aValue ?? "")).toBe(true);
    expect(runtime.has(aType ?? "")).toBe(false);
  });

  it("has teeth: the name comparison reds in both directions", () => {
    const runtime = Object.keys(entryPoint);
    const truncated = INVENTORY.values.slice(1);
    const dropped = INVENTORY.values[0] ?? "";
    expect(delta(truncated, runtime).uncertified).toEqual([dropped]);
    const invented = [...INVENTORY.values, "nonesuchExport"];
    expect(delta(invented, runtime).missing).toEqual(["nonesuchExport"]);
  });
});

describe("the exports map publishes exactly the certified subpaths", () => {
  it("matches package.json in both directions", () => {
    const subpaths = Object.keys(PACKAGE_JSON.exports).sort();
    expect(subpaths).toEqual([...INVENTORY.exportSubpaths].sort());
  });

  it("names the subpath when one is gained or lost", () => {
    const certified = [...INVENTORY.exportSubpaths];
    const gained = [...certified, "./safety"];
    expect(delta(certified, gained).uncertified).toEqual(["./safety"]);
    const lost = certified.slice(1);
    expect(delta(certified, lost).missing).toEqual([certified[0] ?? ""]);
  });

  it("certifies the two subpaths a consumer may resolve today", () => {
    expect(INVENTORY.exportSubpaths).toEqual([".", "./package.json"]);
  });
});

// ===========================================================================
// AC15: nothing has been published, and nothing has been made inevitable.
// ===========================================================================

describe("this tree performs no publication and makes none inevitable", () => {
  /**
   * The version measured on this tree when the audit was written. It is asserted rather than
   * derived so that a bump ANYWHERE reds here: the point is that this change did not move it.
   * `test/sanity.test.ts` separately asserts VERSION against package.json; this is the different
   * question of whether either one MOVED, and the two coexist.
   */
  const MEASURED_VERSION = "0.0.11";

  it("leaves package.json at the version this work measured", () => {
    expect(PACKAGE_JSON.version).toBe(MEASURED_VERSION);
  });

  it("leaves the VERSION export agreeing with it", () => {
    expect(VERSION).toBe(PACKAGE_JSON.version);
    expect(VERSION).toBe(MEASURED_VERSION);
  });

  it("leaves every classified changeset still pending in .changeset/", () => {
    // Zero were classified, because the set is empty, so the assertion is that the directory still
    // holds exactly the two non-changeset files and no `version` run has been performed here.
    const present = readdirSync(CHANGESET_DIR).sort();
    expect(present).toEqual([...NON_CHANGESET_FILES].sort());
  });

  it("leaves no built artifact standing in for a publish", () => {
    // A `changeset version` run rewrites package.json AND src/index.ts in one commit, which is why
    // the two assertions above are the ones that catch it. This adds the third: no tag was made
    // here, and the readiness report over this tree still refuses.
    const report = releaseReadiness({ ...CONTROL_OPTIONS, changesetDir: CHANGESET_DIR });
    expect(report.exitCode).not.toBe(0);
  });
});

// ===========================================================================
// The break candidates the audit names, verified against this tree's own behaviour.
// ===========================================================================

describe("the observables the audit names as break candidates are real", () => {
  it("a safety-critical type that drew an informational note now draws errors", () => {
    // The observable behind the first break candidate. A bare MedicationRequest was structurally
    // unchecked and read `valid: true` with a single informational finding; it is now checked
    // against its own R4 elements and reads `valid: false`. That is a document a consumer's feed
    // could have been passing, failing after a version they took as a patch.
    const result = entryPoint.validateResource(
      entryPoint.parseResource('{"resourceType":"MedicationRequest","id":"synthetic-1"}').resource,
    );
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("CARDINALITY_MIN");
    expect(result.issues.map((issue) => issue.code)).not.toContain("RESOURCE_NOT_MODELED");

    // The control: a type still outside the registry keeps the old, permissive reading, so the
    // change above is the registry widening and not a global tightening.
    const control = entryPoint.validateResource(
      entryPoint.parseResource('{"resourceType":"Procedure","id":"synthetic-1"}').resource,
    );
    expect(control.valid).toBe(true);
    expect(control.issues.map((issue) => issue.code)).toEqual(["RESOURCE_NOT_MODELED"]);
  });

  it("a document that reads valid is now refused by the XML writer", () => {
    // The observable behind the second: the read is unchanged and still says `valid`, and the write
    // that used to succeed now throws. A round trip was withdrawn from a document nothing rejects.
    const source =
      '<v:Observation xmlns:v="urn:vendor"><v:id value="o1"/><v:status value="final"/>' +
      '<v:code><v:text value="synthetic"/></v:code></v:Observation>';
    const read = entryPoint.parseResourceXml(source);
    expect(entryPoint.validateResource(read.resource).valid).toBe(true);
    expect(() => entryPoint.serializeResourceXml(read.resource)).toThrow(
      entryPoint.FhirSerializeError,
    );
    // The published code a consumer switches on, named as the audit names it.
    expect(Object.keys(entryPoint.SERIALIZE_ERROR_CODES)).toContain("UNSERIALIZABLE_FOREIGN_ROOT");
    let thrownCode: string | undefined;
    try {
      entryPoint.serializeResourceXml(read.resource);
    } catch (error) {
      thrownCode = (error as { code?: string }).code;
    }
    expect(thrownCode).toBe(entryPoint.SERIALIZE_ERROR_CODES.UNSERIALIZABLE_FOREIGN_ROOT);

    // The control: a FHIR-rooted document of the same shape still writes.
    const fhirRooted = entryPoint.parseResourceXml(
      '<Observation xmlns="http://hl7.org/fhir"><id value="o1"/><status value="final"/>' +
        '<code><text value="synthetic"/></code></Observation>',
    );
    expect(() => entryPoint.serializeResourceXml(fhirRooted.resource)).not.toThrow();
  });
});

// ===========================================================================
// The fixtures are throwaway, and the real tree is never written to.
// ===========================================================================

describe("the check never writes to the tree it grades", () => {
  it("reads .changeset/ without modifying it", () => {
    const before = readdirSync(CHANGESET_DIR).sort();
    releaseReadiness({ ...CONTROL_OPTIONS, changesetDir: CHANGESET_DIR });
    expect(readdirSync(CHANGESET_DIR).sort()).toEqual(before);
  });

  it("cleans up after a fixture directory, proving the fixtures are throwaway", () => {
    const dir = fixtureDir({ "a-fix.md": changeset("patch", PATCH_PROSE) });
    expect(readdirSync(dir)).toEqual(["a-fix.md"]);
    rmSync(dir, { recursive: true, force: true });
    expect(releaseReadiness({ ...CONTROL_OPTIONS, changesetDir: dir }).output).toContain(
      "is absent",
    );
  });
});
