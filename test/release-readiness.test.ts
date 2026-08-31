/**
 * The release gate, graded: the pending Changesets set, the certified public surface, and the
 * assertion that preparing a release is not the same act as taking one.
 *
 * WHY THIS FILE EXISTS. The next version is not stated anywhere; Changesets derives it from the bump
 * levels sitting in `.changeset/`, so a set that is entirely `patch` derives a patch however the
 * release notes read. That gap is invisible until a version number meaning the wrong thing is
 * already immutable on a registry, and an npm version, a git tag and a GitHub release are all
 * irreversible the moment they exist. Two properties are therefore pinned here rather than reviewed:
 * that every pending changeset declares the level the written rule yields for it, and that the
 * public surface a consumer may depend on is exactly the surface this repository has certified.
 *
 * THREE HALVES, IN ORDER.
 *
 *  1. THE PENDING SET, through `scripts/release-readiness.mjs`. Every case here runs the real check
 *     as a PROCESS and grades its exit status, because "exits non-zero" is the contract: a caller
 *     that reports readiness over a defect is the failure mode, and a returned object cannot show
 *     that a run which found one still exited zero. The unhappy paths are driven from temporary
 *     fixture directories built by `fixture()`, never by editing the real `.changeset/`, so the
 *     delta under test is the single thing the case names and the passing control proves the
 *     fixtures are not failing for an unrelated reason.
 *
 *  2. THE CERTIFIED SURFACE, `test/__data__/certified-public-surface.json` against the entry point.
 *     BIDIRECTIONAL, deliberately: a certified name absent from the entry point is a removal, and an
 *     entry point export nobody certified is an addition that was never reviewed, and a check that
 *     only looked one way would pass one of them silently. The runtime half is read by IMPORTING the
 *     entry point, so it is the set a consumer's `import` actually resolves rather than a set parsed
 *     out of the source; the type-only half is parsed from the source, because a type-only export
 *     exists at compile time and in no namespace object. KIND is graded on that difference: a name
 *     that moves between the two breaks a consumer's `import` even though the name survives.
 *
 *  3. NO PUBLICATION. `package.json` still reads the version this audit was taken over, the
 *     `VERSION` declaration in the entry point source still spells it, and every classified
 *     changeset is still pending. This is a TRIPWIRE and it is meant to red when `0.1.0` is
 *     actually cut: at that point the classification, the audit and this assertion are spent
 *     together and are updated together. `test/sanity.test.ts` already reds on the same event (it
 *     pins `VERSION` to the `0.0.x` ladder), so this adds no new kind of obstacle to a release, only
 *     a second place that says the release was a decision somebody took.
 *
 * NOT RESTATED HERE. `test/sanity.test.ts` owns `VERSION` versus `package.json` at runtime; this
 * file reads the SOURCE DECLARATION instead, which is a different property (that the literal in the
 * entry point was not edited). `test/public-types.test.ts` owns the SHAPE of the public types; this
 * file owns the NAME SET and the export kinds and asserts nothing about a type's members.
 *
 * No build, no JVM, no network, no npm credentials. It reads files and runs `node`.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import * as api from "../src/index.js";

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
const CHECK_SCRIPT = join(REPO_ROOT, "scripts", "release-readiness.mjs");
const CHANGESET_DIR = join(REPO_ROOT, ".changeset");
const CLASSIFICATION_PATH = join(REPO_ROOT, "documentation", "release-0.1.0-classification.json");
const AUDIT_PATH = join(REPO_ROOT, "documentation", "release-0.1.0-readiness.md");
const PACKAGE_JSON_PATH = join(REPO_ROOT, "package.json");
const ENTRY_POINT_PATH = join(REPO_ROOT, "src", "index.ts");

/**
 * The version this whole artifact was taken over. See "NO PUBLICATION" above: the literal is the
 * point, not an oversight.
 */
const AUDITED_VERSION = "0.0.10";

/** The version the classified set is aiming at. */
const TARGET_VERSION = "0.1.0";

interface BreakCandidate {
  readonly observable: string;
  readonly symbol: string;
}

interface ClassificationEntry {
  readonly level: string;
  readonly proseSha256: string;
  readonly justification: string;
  readonly breakCandidate: BreakCandidate | null;
}

interface Classification {
  readonly package: string;
  readonly baselineVersion: string;
  readonly targetVersion: string;
  readonly changesets: Readonly<Record<string, ClassificationEntry>>;
}

interface CertifiedSurface {
  readonly package: string;
  readonly certifiedFor: string;
  readonly subpaths: readonly string[];
  readonly values: readonly string[];
  readonly types: readonly string[];
}

const CLASSIFICATION = JSON.parse(readFileSync(CLASSIFICATION_PATH, "utf8")) as Classification;
const CERTIFIED = JSON.parse(
  readFileSync(new URL("./__data__/certified-public-surface.json", import.meta.url), "utf8"),
) as CertifiedSurface;
const PACKAGE_JSON = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8")) as {
  name: string;
  version: string;
  exports: Readonly<Record<string, unknown>>;
};

// ---------------------------------------------------------------------------
// Running the check
// ---------------------------------------------------------------------------

interface Run {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

function runCheck(args: readonly string[]): Run {
  const result = spawnSync(process.execPath, [CHECK_SCRIPT, ...args], { encoding: "utf8" });
  if (result.error !== undefined) throw result.error;
  return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

/**
 * The single line a successful run prints. Every refusal below asserts this line is ABSENT, which is
 * how "shall not skip it, count it, or fall back to a default level" is graded: a run that counted a
 * defective file around its defect would still have printed a count.
 */
const SUCCESS_MARKER = "classified";

// ---------------------------------------------------------------------------
// Fixtures. A whole temporary tree per case, never an edit to the real one.
// ---------------------------------------------------------------------------

function proseOf(text: string): string {
  const lines = text.split(/\r?\n/);
  return lines.slice(lines.indexOf("---", 1) + 1).join("\n");
}

interface FixtureChangeset {
  /** The file's whole text, frontmatter included, so a malformed case can spell one. */
  readonly text: string;
  /** Omit to leave the file unclassified. */
  readonly level?: string;
  readonly breakCandidate?: BreakCandidate;
  /** Omit to have the fixture compute the digest of `text`; supply one to break it deliberately. */
  readonly proseSha256?: string;
}

interface FixtureOptions {
  readonly changesets?: Readonly<Record<string, FixtureChangeset>>;
  /** Entries the classification carries that no file backs. */
  readonly orphanClassifications?: readonly string[];
  /** Skip creating `.changeset/` at all. */
  readonly omitChangesetDir?: boolean;
  readonly version?: string;
  readonly targetVersion?: string;
}

/** A well-formed changeset body, used wherever the case is not about the prose. */
function body(level: string, sentence: string): string {
  return `---\n"@cosyte/fhir": ${level}\n---\n\n${sentence}\n`;
}

function fixture(options: FixtureOptions): string[] {
  const root = mkdtempSync(join(tmpdir(), "fhir-readiness-"));
  const changesetDir = join(root, ".changeset");
  if (options.omitChangesetDir !== true) {
    mkdirSync(changesetDir);
    // The two files that are never changesets, present so a case about an EMPTY directory is
    // genuinely about "no changeset in it" rather than "no file in it".
    writeFileSync(join(changesetDir, "README.md"), "# Changesets\n");
    writeFileSync(join(changesetDir, "config.json"), '{ "changelog": false }\n');
  }

  const classified: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(options.changesets ?? {})) {
    writeFileSync(join(changesetDir, name), spec.text);
    if (spec.level === undefined) continue;
    classified[name] = {
      level: spec.level,
      proseSha256:
        spec.proseSha256 ?? createHash("sha256").update(proseOf(spec.text), "utf8").digest("hex"),
      justification: "fixture",
      breakCandidate: spec.breakCandidate ?? null,
    };
  }
  for (const name of options.orphanClassifications ?? []) {
    classified[name] = {
      level: "patch",
      proseSha256: createHash("sha256").update("", "utf8").digest("hex"),
      justification: "fixture",
      breakCandidate: null,
    };
  }

  const version = options.version ?? AUDITED_VERSION;
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "@cosyte/fhir", version }, null, 2),
  );
  writeFileSync(
    join(root, "classification.json"),
    JSON.stringify(
      {
        package: "@cosyte/fhir",
        baselineVersion: version,
        targetVersion: options.targetVersion ?? TARGET_VERSION,
        changesets: classified,
      },
      null,
      2,
    ),
  );

  return [
    "--changeset-dir",
    changesetDir,
    "--classification",
    join(root, "classification.json"),
    "--package-json",
    join(root, "package.json"),
  ];
}

/** The control: a well-formed, consistently classified set that derives the target. */
function passingFixture(): string[] {
  return fixture({
    changesets: {
      "a-fix.md": { text: body("patch", "A fix with no public observable."), level: "patch" },
      "a-feature.md": { text: body("minor", "A new export."), level: "minor" },
    },
  });
}

// ---------------------------------------------------------------------------
// 1. The pending set
// ---------------------------------------------------------------------------

describe("the release readiness check refuses rather than reports", () => {
  it("the control: a well-formed, consistently classified set exits zero", () => {
    const run = runCheck(passingFixture());
    expect(run.stderr, "the control must not be failing for an unrelated reason").toBe("");
    expect(run.status).toBe(0);
  });

  it("prints the count it classified and the version it derived", () => {
    const run = runCheck(passingFixture());
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("classified 2 pending changeset(s)");
    expect(run.stdout).toContain(`${AUDITED_VERSION} -> ${TARGET_VERSION}`);
  });

  it("an empty `.changeset/` reports zero pending, refuses readiness and exits non-zero", () => {
    const run = runCheck(fixture({ changesets: {} }));
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("0 pending changesets");
    expect(run.stderr).toContain("NOT releasable");
    expect(run.stdout).not.toContain(SUCCESS_MARKER);
  });

  it("an absent `.changeset/` reports zero pending and names that condition", () => {
    const run = runCheck(fixture({ omitChangesetDir: true }));
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("0 pending changesets");
    expect(run.stderr).toContain("absent");
    expect(run.stdout).not.toContain(SUCCESS_MARKER);
  });

  it("a file with no parseable frontmatter is named, not skipped", () => {
    const run = runCheck(
      fixture({
        changesets: {
          "a-feature.md": { text: body("minor", "A new export."), level: "minor" },
          "broken.md": { text: "no frontmatter at all, just prose\n", level: "patch" },
        },
      }),
    );
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("broken.md");
    expect(run.stderr).toContain("no parseable frontmatter");
    expect(run.stdout).not.toContain(SUCCESS_MARKER);
  });

  it("an unterminated frontmatter block is refused rather than read to the end of the file", () => {
    const run = runCheck(
      fixture({
        changesets: {
          "unterminated.md": { text: '---\n"@cosyte/fhir": patch\nprose\n', level: "patch" },
        },
      }),
    );
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("unterminated.md");
    expect(run.stderr).toContain("no parseable frontmatter");
  });

  it("a changeset naming another package is named with the package it names", () => {
    const run = runCheck(
      fixture({
        changesets: {
          "foreign.md": {
            text: '---\n"@cosyte/hl7": patch\n---\n\nSomeone else\'s package.\n',
            level: "patch",
          },
        },
      }),
    );
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("foreign.md");
    expect(run.stderr).toContain("@cosyte/hl7");
    expect(run.stdout).not.toContain(SUCCESS_MARKER);
  });

  it("a bump level outside patch / minor / major is refused, never defaulted", () => {
    const run = runCheck(
      fixture({
        changesets: {
          "moderate.md": { text: body("moderate", "An invented level."), level: "patch" },
        },
      }),
    );
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("moderate.md");
    expect(run.stderr).toContain("moderate");
    expect(run.stdout).not.toContain(SUCCESS_MARKER);
  });

  it("`major` is refused on this line: it is a finding, not a classification", () => {
    const run = runCheck(
      fixture({ changesets: { "big.md": { text: body("major", "A break."), level: "major" } } }),
    );
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("big.md");
    expect(run.stderr).toContain("major");
    expect(run.stderr).toContain("not available");
    expect(run.stdout).not.toContain(SUCCESS_MARKER);
  });

  it("a pending changeset nobody classified is refused, not counted around", () => {
    const run = runCheck(
      fixture({
        changesets: {
          "a-feature.md": { text: body("minor", "A new export."), level: "minor" },
          "unread.md": { text: body("patch", "Nobody applied the rule to this one.") },
        },
      }),
    );
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("unread.md");
    expect(run.stderr).toContain("not classified");
    expect(run.stdout).not.toContain(SUCCESS_MARKER);
  });

  it("a classification whose changeset is gone is refused, so a consumed set cannot pass", () => {
    const run = runCheck(
      fixture({
        changesets: { "a-feature.md": { text: body("minor", "A new export."), level: "minor" } },
        orphanClassifications: ["already-released.md"],
      }),
    );
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("already-released.md");
    expect(run.stdout).not.toContain(SUCCESS_MARKER);
  });

  it("a declared level that disagrees with the rule's level is named in both directions", () => {
    const run = runCheck(
      fixture({
        changesets: {
          "understated.md": {
            text: body("patch", "A new export, declared as a fix."),
            level: "minor",
          },
        },
      }),
    );
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("understated.md");
    expect(run.stderr).toContain("declares `patch`");
    expect(run.stderr).toContain("yields `minor`");
    expect(run.stdout).not.toContain(SUCCESS_MARKER);
  });

  it("a break candidate declaring `patch` fails the check, naming the file and the observable", () => {
    const run = runCheck(
      fixture({
        changesets: {
          "withdrawal.md": {
            text: body("patch", "The writer now refuses a document it used to emit."),
            level: "minor",
            breakCandidate: {
              observable: "serializeResourceXml refuses a model it previously wrote",
              symbol: "UNSERIALIZABLE_FOREIGN_ROOT",
            },
          },
        },
      }),
    );
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("withdrawal.md");
    expect(run.stderr).toContain("break candidate");
    expect(run.stderr).toContain("serializeResourceXml refuses a model it previously wrote");
    expect(run.stderr).toContain("NOT ready");
    expect(run.stdout).not.toContain(SUCCESS_MARKER);
  });

  it("a break candidate classified `patch` is refused: a withdrawal is `minor` at minimum", () => {
    const run = runCheck(
      fixture({
        changesets: {
          "withdrawal.md": {
            text: body("patch", "The writer now refuses a document it used to emit."),
            level: "patch",
            breakCandidate: {
              observable: "an output the library now refuses to produce",
              symbol: "UNSERIALIZABLE_FOREIGN_ROOT",
            },
          },
        },
      }),
    );
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("withdrawal.md");
    expect(run.stderr).toContain("`minor` at minimum");
    expect(run.stdout).not.toContain(SUCCESS_MARKER);
  });

  it("prose edited under a classification is refused: the level line is the only edit allowed", () => {
    const run = runCheck(
      fixture({
        changesets: {
          "rewritten.md": {
            text: body("minor", "A new export."),
            level: "minor",
            proseSha256: createHash("sha256").update("something else", "utf8").digest("hex"),
          },
        },
      }),
    );
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("rewritten.md");
    expect(run.stderr).toContain("not the prose the classification was taken over");
    expect(run.stdout).not.toContain(SUCCESS_MARKER);
  });

  it("an all-patch set derives a patch, does not reach the target, and is refused", () => {
    const run = runCheck(
      fixture({
        changesets: {
          "one.md": { text: body("patch", "A fix."), level: "patch" },
          "two.md": { text: body("patch", "Another fix."), level: "patch" },
        },
      }),
    );
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("derives `0.0.11`");
    expect(run.stderr).toContain("`0.1.0`");
    expect(run.stdout).not.toContain(SUCCESS_MARKER);
  });
});

describe("this repository's own pending set", () => {
  it("is well formed, consistently classified, and derives the target version", () => {
    const run = runCheck([]);
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    expect(run.stdout).toContain(`${AUDITED_VERSION} -> ${TARGET_VERSION}`);
  });

  it("declares, for every classified changeset, the level the rule recorded for it", () => {
    for (const [name, entry] of Object.entries(CLASSIFICATION.changesets)) {
      const text = readFileSync(join(CHANGESET_DIR, name), "utf8");
      const declared = /^"@cosyte\/fhir":\s*(\S+)$/m.exec(text)?.[1];
      expect(declared, `${name} declares no @cosyte/fhir bump level`).toBeDefined();
      expect(declared, `${name} declares ${declared}, the rule yields ${entry.level}`).toBe(
        entry.level,
      );
    }
  });

  it("carries prose byte-identical to the text the classification cites", () => {
    for (const [name, entry] of Object.entries(CLASSIFICATION.changesets)) {
      const text = readFileSync(join(CHANGESET_DIR, name), "utf8");
      const digest = createHash("sha256").update(proseOf(text), "utf8").digest("hex");
      expect(digest, `${name}'s prose is not the prose that was classified`).toBe(
        entry.proseSha256,
      );
    }
  });

  it("names every break candidate with an observable, a published symbol, and a level >= minor", () => {
    let graded = 0;
    for (const [name, entry] of Object.entries(CLASSIFICATION.changesets)) {
      const candidate = entry.breakCandidate;
      if (candidate === null) continue;
      graded += 1;
      // The observable is a sentence about what a consumer can see change, not a label.
      expect(candidate.observable.length, `${name} names no observable`).toBeGreaterThan(40);
      // The symbol is a published identifier, so the audit can be searched for it and a consumer
      // can grep their own code for it. A phrase here would make the audit assertion vacuous.
      expect(candidate.symbol, `${name}'s symbol is not a published identifier`).toMatch(
        /^[A-Za-z_][\w.]*$/,
      );
      expect(entry.level, `${name} is a break candidate classified below minor`).not.toBe("patch");
    }
    // A set with no break candidate at all would make every assertion above vacuous, and this
    // repository has two. Asserting the count keeps the case exercised rather than merely green.
    expect(graded, "no break candidate was graded, so this case asserted nothing").toBeGreaterThan(
      0,
    );
  });

  it("is reported in the audit, break candidates and their symbols included", () => {
    const audit = readFileSync(AUDIT_PATH, "utf8");
    for (const [name, entry] of Object.entries(CLASSIFICATION.changesets)) {
      expect(audit, `the audit does not name ${name}`).toContain(name);
      expect(audit, `the audit does not record ${name}'s level`).toContain(entry.level);
      if (entry.breakCandidate === null) continue;
      expect(audit, `the audit names ${name} without its published symbol`).toContain(
        entry.breakCandidate.symbol,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 2. The certified public surface
// ---------------------------------------------------------------------------

/**
 * Every name the entry point exports, split by kind.
 *
 * The runtime half is the imported namespace: exactly what a consumer's `import` resolves. The
 * type-only half cannot be, so it is parsed from the source, and the parser REFUSES an export form
 * it does not recognise rather than dropping the names in it. A silently-dropped export is an
 * uncertified addition that this file would then report as certified, which is the one direction a
 * surface guard may never fail in.
 */
function entryPointExports(source: string): { values: string[]; types: string[] } {
  const values: string[] = [];
  const types: string[] = [];

  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (!line.startsWith("export")) continue;

    const declared = /^export const ([A-Za-z_$][\w$]*)\s*[:=]/.exec(line);
    if (declared !== null) {
      values.push(declared[1] ?? "");
      continue;
    }

    const opening = /^export (type )?\{/.exec(line);
    if (opening === null) {
      throw new Error(`unrecognised export form in src/index.ts, line ${i + 1}: ${line}`);
    }
    let block = line;
    while (!block.includes("}") && i + 1 < lines.length) {
      i += 1;
      block += `\n${lines[i] ?? ""}`;
    }
    const inner = /\{([\s\S]*)\}/.exec(block)?.[1];
    if (inner === undefined) {
      throw new Error(`unterminated export block in src/index.ts at line ${i + 1}`);
    }
    for (const raw of inner.split(",")) {
      const name = raw.trim();
      if (name.length === 0) continue;
      if (!/^[A-Za-z_$][\w$]*$/.test(name)) {
        throw new Error(`unrecognised export specifier in src/index.ts: \`${name}\``);
      }
      (opening[1] === undefined ? values : types).push(name);
    }
  }

  return { values: values.sort(), types: types.sort() };
}

/**
 * The comparison, as a pure function, so the negative cases below can drive it over a MUTATED copy
 * of the inventory instead of over a mutated repository. Returns one problem string per divergence;
 * an empty array is agreement.
 */
function surfaceProblems(
  certified: CertifiedSurface,
  runtime: readonly string[],
  sourceTypes: readonly string[],
  subpaths: readonly string[],
): string[] {
  const problems: string[] = [];
  const certifiedValues = new Set(certified.values);
  const certifiedTypes = new Set(certified.types);
  const runtimeSet = new Set(runtime);
  const sourceTypeSet = new Set(sourceTypes);

  for (const name of certified.values) {
    if (sourceTypeSet.has(name)) {
      problems.push(`${name}: certified as a runtime value, exported type-only (kind changed)`);
    } else if (!runtimeSet.has(name)) {
      problems.push(`${name}: certified as a runtime value, absent from the entry point`);
    }
  }
  for (const name of certified.types) {
    if (runtimeSet.has(name)) {
      problems.push(
        `${name}: certified as a type-only export, exported as a runtime value (kind changed)`,
      );
    } else if (!sourceTypeSet.has(name)) {
      problems.push(`${name}: certified as a type-only export, absent from the entry point`);
    }
  }
  for (const name of runtime) {
    if (!certifiedValues.has(name) && !certifiedTypes.has(name)) {
      problems.push(`${name}: exported as a runtime value, certified by nothing`);
    }
  }
  for (const name of sourceTypes) {
    if (!certifiedTypes.has(name) && !certifiedValues.has(name)) {
      problems.push(`${name}: exported type-only, certified by nothing`);
    }
  }
  for (const subpath of certified.subpaths) {
    if (!subpaths.includes(subpath)) problems.push(`${subpath}: certified subpath is gone`);
  }
  for (const subpath of subpaths) {
    if (!certified.subpaths.includes(subpath)) {
      problems.push(`${subpath}: exports subpath is certified by nothing`);
    }
  }
  return problems;
}

describe("the certified public surface", () => {
  const source = readFileSync(ENTRY_POINT_PATH, "utf8");
  const entry = entryPointExports(source);
  const runtime = Object.keys(api).sort();
  const subpaths = Object.keys(PACKAGE_JSON.exports);

  it("is certified for the version the classified set derives", () => {
    expect(CERTIFIED.package).toBe(PACKAGE_JSON.name);
    expect(CERTIFIED.certifiedFor).toBe(TARGET_VERSION);
  });

  it("agrees with the entry point in both directions", () => {
    expect(surfaceProblems(CERTIFIED, runtime, entry.types, subpaths)).toEqual([]);
  });

  it("covers a surface worth certifying, so the comparison is not vacuously green", () => {
    expect(CERTIFIED.values.length).toBeGreaterThan(100);
    expect(CERTIFIED.types.length).toBeGreaterThan(50);
    expect(runtime.length).toBe(CERTIFIED.values.length);
  });

  it("the source parse and the imported namespace agree, so neither half is guessing", () => {
    expect(entry.values).toEqual(runtime);
  });

  it("fails when the entry point loses a certified name (a removal)", () => {
    const withoutOne = runtime.filter((name) => name !== "parseResource");
    const problems = surfaceProblems(CERTIFIED, withoutOne, entry.types, subpaths);
    expect(problems).toContain(
      "parseResource: certified as a runtime value, absent from the entry point",
    );
  });

  it("fails when the entry point gains a name nobody certified (an addition)", () => {
    const problems = surfaceProblems(
      CERTIFIED,
      [...runtime, "readSecretly"],
      entry.types,
      subpaths,
    );
    expect(problems).toContain("readSecretly: exported as a runtime value, certified by nothing");
  });

  it("fails when a certified type-only export is missing from the entry point", () => {
    const withoutOne = entry.types.filter((name) => name !== "ReadResult");
    const problems = surfaceProblems(CERTIFIED, runtime, withoutOne, subpaths);
    expect(problems).toContain(
      "ReadResult: certified as a type-only export, absent from the entry point",
    );
  });

  it("fails when a name moves from a runtime value to a type-only export", () => {
    const movedRuntime = runtime.filter((name) => name !== "parseResource");
    const movedTypes = [...entry.types, "parseResource"].sort();
    const problems = surfaceProblems(CERTIFIED, movedRuntime, movedTypes, subpaths);
    expect(problems).toContain(
      "parseResource: certified as a runtime value, exported type-only (kind changed)",
    );
  });

  it("fails when a name moves from a type-only export to a runtime value", () => {
    const movedRuntime = [...runtime, "ReadResult"].sort();
    const movedTypes = entry.types.filter((name) => name !== "ReadResult");
    const problems = surfaceProblems(CERTIFIED, movedRuntime, movedTypes, subpaths);
    expect(problems).toContain(
      "ReadResult: certified as a type-only export, exported as a runtime value (kind changed)",
    );
  });

  it("fails when the `exports` map gains a subpath, naming it", () => {
    const problems = surfaceProblems(CERTIFIED, runtime, entry.types, [...subpaths, "./internals"]);
    expect(problems).toContain("./internals: exports subpath is certified by nothing");
  });

  it("fails when the `exports` map loses a subpath, naming it", () => {
    const problems = surfaceProblems(
      CERTIFIED,
      runtime,
      entry.types,
      subpaths.filter((subpath) => subpath !== "./package.json"),
    );
    expect(problems).toContain("./package.json: certified subpath is gone");
  });

  it("refuses an export form it cannot read rather than dropping the names in it", () => {
    expect(() => entryPointExports('export * from "./everything.js";\n')).toThrow(
      /unrecognised export form/,
    );
    expect(() => entryPointExports('export { a as b } from "./x.js";\n')).toThrow(
      /unrecognised export specifier/,
    );
  });
});

// ---------------------------------------------------------------------------
// 3. No publication has been performed or made inevitable
// ---------------------------------------------------------------------------

describe("no publication has been performed or made inevitable", () => {
  it("leaves package.json at the version this audit was taken over", () => {
    expect(PACKAGE_JSON.version).toBe(AUDITED_VERSION);
    expect(CLASSIFICATION.baselineVersion).toBe(AUDITED_VERSION);
  });

  it("leaves the VERSION declaration in the entry point source spelling that version", () => {
    const source = readFileSync(ENTRY_POINT_PATH, "utf8");
    expect(source).toContain(`export const VERSION: string = "${AUDITED_VERSION}";`);
  });

  it("leaves every classified changeset pending, so no version was taken over the set", () => {
    const names = Object.keys(CLASSIFICATION.changesets);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(() => readFileSync(join(CHANGESET_DIR, name), "utf8")).not.toThrow();
    }
  });
});
