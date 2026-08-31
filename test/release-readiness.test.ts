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
 *     a skip and never a default level. So is a file whose level cannot be ESTABLISHED: see
 *     THE TWO CHANNELS below.
 *  2. THE BREAK CANDIDATES. A changeset whose own text describes a withdrawal or a narrowing of
 *     previously working public behaviour, or which the audit's committed classification register
 *     names as one, is named with the observable a consumer would see, and may not sit at `patch`.
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
 * THE TWO CHANNELS a level can be established through, and the refusal when neither speaks:
 *
 *   a. THE CHANGESET'S OWN TEXT, through the narrow phrase recogniser below. It matches the idiom
 *      this repository has actually used, so it recognises a withdrawal stated in those words and
 *      the "nothing here ships in the published artifact" the rule names as evidence for `patch`.
 *   b. THE AUDIT'S CLASSIFICATION REGISTER, `test/__data__/changeset-classification.json`, a
 *      committed file the audit writes and this check reads. It may RAISE a level and NAME a break
 *      candidate with its observable; it can never lower a level the text established nor clear a
 *      break the text described, so the effective level is the higher of the two readings.
 *
 * When NEITHER channel speaks, the changeset is UNCLASSIFIED and the whole set is refused. There is
 * no `patch` fallback. A recogniser miss is not evidence of anything, and treating it as evidence of
 * a fix is precisely how a withdrawal of working behaviour ships to a consumer on a caret range.
 *
 * FAIL CLOSED, EVERYWHERE. Every refusal below reports a problem rather than skipping. An empty
 * `.changeset/`, an absent one, a file with no frontmatter, a foreign package name, an unknown level,
 * a `major` declaration, a register entry that names a break candidate without its observable, and a
 * changeset neither channel classifies are each a named failure. A readiness check that reports
 * "ready" over a set it could not read is worse than no check: it is the one output that gets acted
 * on.
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
 * change explicitly. The recogniser is deliberately narrow, and NARROW MEANS IT MISSES: it carries
 * this repository's idiom and nothing wider, so ordinary changeset prose spelling any of the cases
 * the rule names in general terms goes unrecognised here. A miss is therefore worth nothing in
 * either direction and is never read as evidence of a fix. What the recogniser buys is one thing
 * only: it can RAISE a level and name a break the author declared too low. Everything it does not
 * recognise falls to the audit's register, and what neither reads is refused.
 *
 * DO NOT ANSWER A MISS BY LENGTHENING THIS LIST. A longer list has the same shape and the same
 * blind spot one paraphrase further out; the register is the channel for a reading a keyword cannot
 * make.
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
  /** What a consumer sees change. Non-empty whenever `breakCandidate` is true, per AC3 and AC4. */
  readonly observable: string;
  readonly reason: string;
}

/**
 * ONE ENTRY IN THE AUDIT'S CLASSIFICATION REGISTER.
 *
 * The acceptance criterion this serves speaks of "a changeset the audit classifies as a break
 * candidate". A check whose only authority is its own keyword recogniser gives that phrase no input
 * at all: it can then only refuse the breaks it happens to recognise, and every other one passes as
 * a fix. This is the input. The audit writes an entry, the check reads it, and the two cannot drift
 * apart silently because a pending changeset that neither channel classifies is refused.
 */
interface RegisterEntry {
  /** The level the audit assigns. `major` is unavailable on this line and is refused. */
  readonly level: string;
  /** Whether the audit calls this a break candidate. */
  readonly breakCandidate: boolean;
  /** What a consumer would see change. REQUIRED when `breakCandidate` is true. */
  readonly observable?: string;
  /** The audit's own words for why. Required: an unexplained classification is not one. */
  readonly reason: string;
}

interface ClassificationRegister {
  /** The document that wrote this register, quoted in every problem it produces. */
  readonly certifiedBy: string;
  /** Keyed by file name inside `.changeset/`. */
  readonly entries: Readonly<Record<string, RegisterEntry>>;
}

/** The committed register, read the same way the committed surface inventory is. */
const REGISTER = JSON.parse(
  readFileSync(new URL("./__data__/changeset-classification.json", import.meta.url), "utf8"),
) as ClassificationRegister;

/** A register for a fixture set, standing in for the committed one. */
function registerOf(entries: Readonly<Record<string, RegisterEntry>>): ClassificationRegister {
  return { certifiedBy: "a fixture register standing in for the audit", entries };
}

/** The register that classifies nothing, which is what the committed one holds today. */
const EMPTY_REGISTER = registerOf({});

/** `patch` < `minor` < `major`, so two readings of one changeset resolve upward and never down. */
const LEVEL_RANK: Readonly<Record<BumpLevel, number>> = { patch: 0, minor: 1, major: 2 };

/**
 * The sentence a matched phrase sits in, so a refusal quotes the changeset rather than a keyword.
 * The observable AC4 requires is a thing a consumer sees, and a bare phrase is not one.
 */
function sentenceAround(body: string, phrase: string): string {
  const lower = body.toLowerCase();
  const at = lower.indexOf(phrase);
  if (at < 0) return body.replace(/\s+/g, " ").trim();
  const start = lower.lastIndexOf(".", at) + 1;
  const stop = lower.indexOf(".", at + phrase.length);
  return body
    .slice(start, stop < 0 ? body.length : stop + 1)
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The outcome of applying the rule to one changeset: a classification, or a refusal to make one.
 *
 * THE REFUSAL IS THE POINT. There is no third arm returning a default, because a default here is a
 * positive claim ("this changes no public observable") that nothing established.
 */
type Verdict = { readonly ok: Classification } | { readonly unclassifiable: string };

/** Apply the rule to one changeset, through both channels, refusing when neither speaks. */
function classify(changeset: PendingChangeset, register: ClassificationRegister): Verdict {
  const text = changeset.body.toLowerCase();
  const hit = (phrases: readonly string[]): string | undefined =>
    phrases.find((phrase) => text.includes(phrase));

  // Channel (a): what the changeset's own text establishes. A miss establishes nothing at all.
  const withdrawal = hit(WITHDRAWAL_PHRASES);
  const capability = hit(CAPABILITY_PHRASES);
  const noShip = hit(NO_SHIP_PHRASES);

  let fromText: Classification | undefined;
  if (withdrawal !== undefined) {
    fromText = {
      level: "minor",
      breakCandidate: true,
      observable: sentenceAround(changeset.body, withdrawal),
      reason: `its own text describes a withdrawal or narrowing of previously working public behaviour (\`${withdrawal}\`), which is \`minor\` at minimum because \`major\` is unavailable on this line`,
    };
  } else if (capability !== undefined && noShip === undefined) {
    fromText = {
      level: "minor",
      breakCandidate: false,
      observable: "",
      reason: `its own text describes new public capability (\`${capability}\`)`,
    };
  } else if (noShip !== undefined) {
    fromText = {
      level: "patch",
      breakCandidate: false,
      observable: "",
      reason: `its own text states that nothing in it reaches the published artifact (\`${noShip}\`)`,
    };
  }

  // Channel (b): what the audit recorded about this file, if anything. A defective entry is a
  // refusal too: a register that cannot be read cannot classify, and half-reading one is the same
  // failure as half-reading a changeset.
  const entry = register.entries[changeset.file];
  let fromAudit: Classification | undefined;
  if (entry !== undefined) {
    if (entry.level !== "patch" && entry.level !== "minor") {
      return {
        unclassifiable: `${register.certifiedBy} assigns it level \`${entry.level}\`, which is neither \`patch\` nor \`minor\`; \`major\` is unavailable on this line and there is no other level`,
      };
    }
    const observable = (entry.observable ?? "").trim();
    if (entry.breakCandidate && observable === "") {
      return {
        unclassifiable: `${register.certifiedBy} calls it a break candidate and names no observable, so a refusal could not say what a consumer would see change`,
      };
    }
    if (entry.reason.trim() === "") {
      return { unclassifiable: `${register.certifiedBy} carries no reason for its classification` };
    }
    fromAudit = {
      level: entry.level,
      breakCandidate: entry.breakCandidate,
      observable,
      reason: `the audit classifies it \`${entry.level}\` in ${register.certifiedBy}: ${entry.reason.trim()}`,
    };
  }

  // Neither channel spoke. REFUSE, and say so in the words that make the refusal actionable.
  if (fromText === undefined && fromAudit === undefined) {
    return {
      unclassifiable:
        "neither its own text nor the audit's classification register classifies it. The recogniser carries this repository's idiom and nothing wider, so a miss establishes nothing; reading one as a fix is how a withdrawal of working behaviour reaches a consumer labelled a patch. Classify it in the audit's register, or state the cost in the changeset's own prose",
    };
  }

  // Both may speak. Resolve UPWARD only: the register can raise a level the author declared too low
  // and can name a break the text did not spell out, and it can do neither in the other direction.
  const readings = [fromText, fromAudit].filter((r): r is Classification => r !== undefined);
  const level = readings.reduce<BumpLevel>(
    (highestSoFar, reading) =>
      LEVEL_RANK[reading.level] > LEVEL_RANK[highestSoFar] ? reading.level : highestSoFar,
    "patch",
  );
  const breakCandidate = readings.some((reading) => reading.breakCandidate);
  // The audit's observable is preferred where it has one: it was written by a reader, and the
  // recogniser's is a sentence it found near a keyword.
  const audited = fromAudit?.observable ?? "";
  const named = audited !== "" ? audited : (fromText?.observable ?? "");

  if (breakCandidate && named === "") {
    return {
      unclassifiable:
        "it reads as a break candidate and no observable could be named for it, and a refusal that cannot say what a consumer sees change is not the refusal this check owes",
    };
  }

  return {
    ok: {
      level,
      breakCandidate,
      observable: named,
      reason: readings.map((reading) => reading.reason).join("; and "),
    },
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
  /** The audit's classification register for this set. Never optional: an absent one would be a
   *  silent empty one, which is the fallback this check does not have. */
  readonly register: ClassificationRegister;
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
  /** Files neither channel could classify. Non-empty means the set was NOT classified. */
  readonly unclassified: readonly string[];
  /** Every file the check treated as a changeset, so a skip is visible rather than inferred. */
  readonly pendingFiles: readonly string[];
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
      unclassified: [],
      pendingFiles: [],
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
      unclassified: [],
      pendingFiles: [],
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
      unclassified: [],
      pendingFiles: files,
    };
  }

  const breakCandidates: string[] = [];
  const unclassified: string[] = [];
  for (const changeset of pending) {
    const verdict = classify(changeset, options.register);

    if ("unclassifiable" in verdict) {
      // THE FAIL-CLOSED ARM. A changeset nothing classified is refused by name. It is not scored
      // `patch`, not counted, and does not contribute a level, because every one of those is a
      // claim about a change nobody read.
      unclassified.push(changeset.file);
      problems.push(
        `.changeset/${changeset.file} could not be classified: ${verdict.unclassifiable}.`,
      );
      lines.push(`.changeset/${changeset.file}: declared ${changeset.declared}, rule UNCLASSIFIED`);
      continue;
    }

    const classification = verdict.ok;
    if (classification.breakCandidate) {
      breakCandidates.push(changeset.file);
      if (changeset.declared === "patch") {
        problems.push(
          `.changeset/${changeset.file} is a break candidate and declares \`patch\`: ${classification.reason}. The observable a consumer sees change: ${classification.observable} A withdrawal shipped as a patch reaches a consumer on a caret range with no signal.`,
        );
      }
    }
    if (changeset.declared !== classification.level) {
      problems.push(
        `.changeset/${changeset.file} declares \`${changeset.declared}\` and the classification rule yields \`${classification.level}\`: ${classification.reason}.`,
      );
    }
    lines.push(
      `.changeset/${changeset.file}: declared ${changeset.declared}, rule ${classification.level}`,
    );
  }

  // An unclassified member sinks the SET, exactly as an unreadable one does. Deriving a version
  // over the remainder is the "skip it and count the rest" behaviour that must not happen, and
  // reporting readiness over it is the output this whole file exists to prevent.
  if (unclassified.length > 0) {
    return {
      exitCode: 1,
      output: `${String(unclassified.length)} changeset file(s) could not be classified, so this set was not classified and no version was derived. NOT RELEASABLE.\n${lines.join("\n")}\n${problems.join("\n")}`,
      problems,
      classified: 0,
      derivedVersion: undefined,
      breakCandidates,
      unclassified,
      pendingFiles: files,
    };
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
      unclassified: [],
      pendingFiles: files,
    };
  }

  return {
    exitCode: 0,
    output: `classified ${String(pending.length)} changeset(s); derived version ${String(derivedVersion)} from ${options.currentVersion}. RELEASABLE.`,
    problems,
    classified: pending.length,
    derivedVersion,
    breakCandidates,
    unclassified: [],
    pendingFiles: files,
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

/**
 * Prose describing an ordinary fix.
 *
 * The recogniser does NOT read this as anything: nothing in it is this repository's idiom for a
 * withdrawal, for new capability, or for a change that does not ship. That is deliberate, and it is
 * why the fixtures using it also carry a register entry. Before the audit's register existed, prose
 * like this was scored `patch` by default, which is the same silent default a withdrawal got.
 */
const PATCH_PROSE = "A rounding fix in an internal helper. Every public observable is identical.";

/** The audit's reading of `PATCH_PROSE`, supplied the way the audit supplies one. */
const PATCH_ENTRY: RegisterEntry = {
  level: "patch",
  breakCandidate: false,
  reason: "a rounding fix inside a helper no export reaches; every public observable is identical",
};

/** Prose the rule reads as a withdrawal, in this repository's own idiom. */
const WITHDRAWAL_PROSE =
  "This withdraws an XML round trip from a document that reads valid, which is a cost two refusals beside it already pay.";

/** Prose the rule reads as new public capability. */
const CAPABILITY_PROSE =
  "The result now carries an optional member declaring the release an answer was made against. Additive throughout.";

const CONTROL_OPTIONS = {
  currentVersion: "0.0.11",
  targetVersion: "0.1.0",
  register: EMPTY_REGISTER,
};

// ===========================================================================
// AC1 + AC5: the pending set as this tree actually holds it.
// ===========================================================================

/** What `.changeset/` holds right now, minus the two files that are not changesets. */
function pendingOnThisTree(): string[] {
  return readdirSync(CHANGESET_DIR)
    .filter((name) => !NON_CHANGESET_FILES.has(name))
    .sort();
}

describe("the pending changeset set, re-measured on this tree", () => {
  it("names every file in .changeset/, and only README.md and config.json are not changesets", () => {
    const present = readdirSync(CHANGESET_DIR).sort();
    for (const name of NON_CHANGESET_FILES) {
      expect(present, `.changeset/${name} is missing`).toContain(name);
    }
    // Every other file is a changeset and the check treats it as one. Asserting the count is
    // whatever the directory holds, and asserting that the check SAW every one of them, is the
    // measurement. Asserting the set is EMPTY would be a different claim: it would red on a
    // changeset a later change legitimately adds under this repository's standing discipline,
    // including the one the audit's own go-forward step recommends, and it would say nothing
    // about whether the set was classified. Classification is what the next test asserts.
    const report = releaseReadiness({ ...CONTROL_OPTIONS, changesetDir: CHANGESET_DIR });
    expect(
      [...report.pendingFiles].sort(),
      "the check skipped a file in .changeset/ that is neither README.md nor config.json",
    ).toEqual(pendingOnThisTree());
  });

  it("reports zero pending, or names no break candidate sitting at `patch`: never neither", () => {
    // THE LIVE INVARIANT, scoped to the property AC3 and AC4 actually name.
    //
    // WHAT THIS DELIBERATELY DOES NOT ASSERT, and why. An earlier form required
    // `report.unclassified` to be empty over the live `.changeset/`. That made a RELEASE decision
    // into a BUILD failure: `CLAUDE.md` standing discipline 2 asks for a changeset on every change
    // and `.changeset/README.md` tells the author to "pick patch", so the ordinary next
    // contribution arrives with prose this deliberately narrow recogniser does not carry and the
    // audit's register has not yet read, and the suite reded on it. `pnpm test` is this
    // repository's own gate and its `prepublishOnly` step, so that assertion put every contributor
    // in front of a release audit's test data. Refusing to classify is the check's job and the
    // audit's to resolve; it is reported by `releaseReadiness()` and recorded in the audit, and it
    // is not a reason for the build to fail. The unclassified case keeps its FULL grading in the
    // fixtures below, where AC4 is graded and the input is controlled rather than inherited.
    //
    // What survives here is the one property the criteria name over the real tree: a withdrawal or
    // narrowing of previously working public behaviour may not sit at `patch`. That fires on the
    // defect this whole file exists to prevent and on nothing else, and it cannot be quieted by a
    // register entry, because the register resolves upward only.
    const pending = pendingOnThisTree();
    const report = releaseReadiness({
      ...CONTROL_OPTIONS,
      changesetDir: CHANGESET_DIR,
      register: REGISTER,
    });

    if (pending.length === 0) {
      expect(report.classified).toBe(0);
      expect(report.derivedVersion).toBeUndefined();
      expect(report.exitCode).not.toBe(0);
      expect(report.output).toContain("zero pending changesets");
      expect(report.output).toContain("NOT RELEASABLE");
      return;
    }

    const misdeclared: string[] = [];
    for (const file of report.pendingFiles) {
      const read = readChangeset(file, readFileSync(join(CHANGESET_DIR, file), "utf8"));
      // A file the reader refuses is AC7's shape and is graded by fixture; a file neither channel
      // classifies is reported by the check and owed a reading in the audit. Neither is this
      // assertion's subject, and neither is read here as evidence that nothing was withdrawn.
      if ("bad" in read) continue;
      const verdict = classify(read.ok, REGISTER);
      if ("unclassifiable" in verdict) continue;
      if (verdict.ok.breakCandidate && read.ok.declared === "patch") {
        misdeclared.push(`.changeset/${file}: ${verdict.ok.observable}`);
      }
    }

    const unread =
      report.unclassified.length === 0 ? "none" : [...report.unclassified].sort().join(", ");
    expect(
      misdeclared,
      `these pending changesets withdraw or narrow previously working public behaviour and declare \`patch\`; raise each to \`minor\` and name it a break candidate in ${REGISTER.certifiedBy}. Pending files neither channel classified, which the audit owes a reading and which do not fail this test: ${unread}`,
    ).toEqual([]);
  });

  it("reads the audit's classification register, and the register names the audit that wrote it", () => {
    // The register is a committed input, so its own SHAPE is graded here rather than assumed.
    //
    // Deliberately NOT graded: whether every registered file is still pending. `changeset version`
    // CONSUMES the pending set, deleting the files it bumped, so an entry for a consumed changeset
    // is a stale reading rather than a defective one, and failing on it would put exactly the
    // release bookkeeping the test above just took off the build gate straight back on it. A stale
    // entry classifies nothing either way: `classify()` only ever looks up the entry for a file
    // that is pending.
    expect(REGISTER.certifiedBy).toBe("documentation/release-0.1.0-readiness.md");
    for (const [file, entry] of Object.entries(REGISTER.entries)) {
      expect(["patch", "minor"], `${file} is registered at an unavailable level`).toContain(
        entry.level,
      );
      expect(entry.reason.trim().length, `${file} is registered with no reason`).toBeGreaterThan(0);
      if (entry.breakCandidate) {
        expect(
          (entry.observable ?? "").trim().length,
          `${file} names no observable`,
        ).toBeGreaterThan(0);
      }
    }
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
    // The audit classified this one, so the check has a reading and does not refuse it. The
    // register raises and names; it does not lower, and here there is nothing to lower.
    const report = releaseReadiness({
      currentVersion: "0.0.11",
      targetVersion: "0.0.12",
      register: registerOf({ "a-fix.md": PATCH_ENTRY }),
      changesetDir: fixtureDir({ "a-fix.md": changeset("patch", PATCH_PROSE) }),
    });
    expect(report.exitCode).toBe(0);
    expect(report.breakCandidates).toEqual([]);
    expect(report.unclassified).toEqual([]);
    expect(report.derivedVersion).toBe("0.0.12");
  });

  it("does not let the register lower a level the changeset's own text established", () => {
    // The laundering the register must not enable: the audit calls it a patch and says nothing
    // withdrew, and the changeset's own prose says it withdraws a round trip. The higher reading
    // wins and the candidacy survives, so an entry can never talk a break down into a fix.
    const report = releaseReadiness({
      ...CONTROL_OPTIONS,
      register: registerOf({
        "takes-something-away.md": {
          level: "patch",
          breakCandidate: false,
          reason: "the audit read this as an internal change",
        },
      }),
      changesetDir: fixtureDir({ "takes-something-away.md": changeset("patch", WITHDRAWAL_PROSE) }),
    });
    expect(report.exitCode).toBe(1);
    expect(report.breakCandidates).toEqual(["takes-something-away.md"]);
    expect(report.problems.some((problem) => problem.includes("yields `minor`"))).toBe(true);
  });

  it("lets the register RAISE a level and name a break its own text never spelled out", () => {
    // The other direction, which is the whole reason the register exists: prose the recogniser
    // cannot read, classified by a reader, refused because it declares `patch`.
    const report = releaseReadiness({
      ...CONTROL_OPTIONS,
      register: registerOf({
        "drops-an-export.md": {
          level: "minor",
          breakCandidate: true,
          observable: "`readRawJson` is gone from the entry point; `import { readRawJson }` throws",
          reason: "an export a consumer may already import was removed",
        },
      }),
      changesetDir: fixtureDir({
        "drops-an-export.md": changeset(
          "patch",
          "The `readRawJson` entry point is gone. Callers reach the same model through `parseResource`.",
        ),
      }),
    });
    expect(report.exitCode).toBe(1);
    expect(report.breakCandidates).toEqual(["drops-an-export.md"]);
    const named = report.problems.filter((problem) => problem.includes("break candidate"));
    expect(named).toHaveLength(1);
    expect(named[0]).toContain("drops-an-export.md");
    expect(named[0]).toContain("readRawJson");
    expect(report.output).toContain("NOT RELEASABLE");
  });

  it("reads `nothing here ships in the published artifact` as evidence for patch", () => {
    const prose =
      "The differential harness declares its inputs. No library code changed; nothing here ships in the published artifact.";
    const report = releaseReadiness({
      currentVersion: "0.0.11",
      targetVersion: "0.0.12",
      register: EMPTY_REGISTER,
      changesetDir: fixtureDir({ "harness-only.md": changeset("patch", prose) }),
    });
    expect(report.exitCode).toBe(0);
    expect(report.problems).toEqual([]);
  });
});

// ===========================================================================
// AC4, the arm the phrase recogniser cannot reach: prose neither channel classifies is REFUSED.
//
// This is the shape of the defect these cases exist to keep closed. The recogniser carries this
// repository's idiom; every case below spells a withdrawal the classification rule names IN GENERAL
// TERMS, in the words a changeset is ordinarily written in, and the recogniser matches none of
// them. Scored as a default `patch` they would push no problem, enter no break-candidate list, and
// exit 0 with RELEASABLE the moment the derived version happened to equal the target: a withdrawal
// of working public behaviour, reported ready, over a set nothing had read.
// ===========================================================================

describe("a changeset neither channel classifies is refused, never scored patch by default", () => {
  /** Each is a case `## Classification rule` names, spelled the way changesets are written here. */
  const UNRECOGNISED_WITHDRAWALS: ReadonlyArray<readonly [clause: string, prose: string]> = [
    [
      "an export or member removed",
      "The `readRawJson` export is gone from the public entry point. Callers reach the same model through `parseResource`.",
    ],
    [
      "a document that now reports an error where it reported none",
      "A document that previously validated clean now reports an error, because the vital-signs unit check reaches one more element.",
    ],
    [
      "an output the library now refuses to produce",
      "`serializeResource` will not emit a document carrying a shadowed member; it raises instead.",
    ],
    [
      "a widened set of findings that can turn a previously valid document invalid",
      "The structural validator gained six resource tables, so a resource that carried a single informational note is now checked against its own elements.",
    ],
  ];

  for (const [clause, prose] of UNRECOGNISED_WITHDRAWALS) {
    it(`refuses it by name rather than assuming a fix: ${clause}`, () => {
      const report = releaseReadiness({
        ...CONTROL_OPTIONS,
        changesetDir: fixtureDir({ "unread-thing.md": changeset("patch", prose) }),
      });
      expect(report.exitCode).toBe(1);
      expect(report.unclassified).toEqual(["unread-thing.md"]);
      expect(report.classified).toBe(0);
      expect(report.derivedVersion).toBeUndefined();
      expect(report.problems).toHaveLength(1);
      expect(report.problems[0]).toContain("unread-thing.md");
      expect(report.problems[0]).toContain("could not be classified");
      expect(report.output).toContain("NOT RELEASABLE");
    });
  }

  it("NEVER reports RELEASABLE over a set carrying prose it could not classify", () => {
    // The headline. The target is set to the version this all-`patch` set derives, so nothing else
    // can be what refuses it: with a silent `patch` default this call exits 0 and prints
    // RELEASABLE over a changeset saying in plain words that an export is gone.
    const report = releaseReadiness({
      currentVersion: "0.0.11",
      targetVersion: "0.0.12",
      register: EMPTY_REGISTER,
      changesetDir: fixtureDir({
        "drops-an-export.md": changeset(
          "patch",
          "The `readRawJson` export is gone from the public entry point. Callers reach the same model through `parseResource`.",
        ),
      }),
    });
    expect(report.exitCode).not.toBe(0);
    // The affirmative verdict, and only it: `NOT RELEASABLE` contains the word and is the opposite.
    expect(report.output).not.toMatch(/(?<!NOT )RELEASABLE/);
    expect(report.output).toContain("NOT RELEASABLE");
    expect(report.output).not.toContain("derived version");
    expect(report.unclassified).toEqual(["drops-an-export.md"]);
  });

  it("does not skip an unclassifiable file, count it, or derive a version around it", () => {
    // Beside a changeset both channels DO read. A check that skipped the unread one would classify
    // 1, derive `0.1.0` and report the set ready, which is the same half-read verdict a malformed
    // file may not produce either.
    const report = releaseReadiness({
      ...CONTROL_OPTIONS,
      changesetDir: fixtureDir({
        "unread-thing.md": changeset(
          "patch",
          "`serializeResource` will not emit a document carrying a shadowed member; it raises instead.",
        ),
        "adds-something.md": changeset("minor", CAPABILITY_PROSE),
      }),
    });
    expect(report.exitCode).toBe(1);
    expect(report.classified).toBe(0);
    expect(report.derivedVersion).toBeUndefined();
    expect(report.unclassified).toEqual(["unread-thing.md"]);
    expect(report.output).toContain("was not classified");
    expect(report.pendingFiles).toEqual(["adds-something.md", "unread-thing.md"]);
  });

  it("still names the break candidates it DID read while refusing the set", () => {
    // Refusing early must not hide what was read: a set carrying both an unread file and a
    // recognised break names both, so a reader fixes two things rather than discovering the second
    // on the next run.
    const report = releaseReadiness({
      ...CONTROL_OPTIONS,
      changesetDir: fixtureDir({
        "unread-thing.md": changeset(
          "patch",
          "An internal refactor of the reader's dispatch table.",
        ),
        "takes-something-away.md": changeset("patch", WITHDRAWAL_PROSE),
      }),
    });
    expect(report.exitCode).toBe(1);
    expect(report.unclassified).toEqual(["unread-thing.md"]);
    expect(report.breakCandidates).toEqual(["takes-something-away.md"]);
    expect(report.problems.some((problem) => problem.includes("break candidate"))).toBe(true);
  });

  it("refuses a register entry that names a break candidate without its observable", () => {
    // The register is an input like any other and its defects are refusals too. AC4's refusal has
    // to name the observable, so an entry that supplies none cannot classify anything.
    const report = releaseReadiness({
      ...CONTROL_OPTIONS,
      register: registerOf({
        "drops-an-export.md": {
          level: "minor",
          breakCandidate: true,
          reason: "an export was removed",
        },
      }),
      changesetDir: fixtureDir({
        "drops-an-export.md": changeset("patch", "The `readRawJson` export is gone."),
      }),
    });
    expect(report.exitCode).toBe(1);
    expect(report.unclassified).toEqual(["drops-an-export.md"]);
    expect(report.problems[0]).toContain("names no observable");
  });

  it("refuses a register entry declaring an unavailable level", () => {
    const report = releaseReadiness({
      ...CONTROL_OPTIONS,
      register: registerOf({
        "a-fix.md": { level: "major", breakCandidate: false, reason: "the audit said so" },
      }),
      changesetDir: fixtureDir({ "a-fix.md": changeset("patch", PATCH_PROSE) }),
    });
    expect(report.exitCode).toBe(1);
    expect(report.unclassified).toEqual(["a-fix.md"]);
    expect(report.problems[0]).toContain("neither `patch` nor `minor`");
  });

  it("refuses a register entry carrying no reason", () => {
    const report = releaseReadiness({
      ...CONTROL_OPTIONS,
      register: registerOf({
        "a-fix.md": { level: "patch", breakCandidate: false, reason: "   " },
      }),
      changesetDir: fixtureDir({ "a-fix.md": changeset("patch", PATCH_PROSE) }),
    });
    expect(report.exitCode).toBe(1);
    expect(report.unclassified).toEqual(["a-fix.md"]);
    expect(report.problems[0]).toContain("no reason");
  });

  it("has teeth: the same prose classified in the register is accepted, so the refusal is the miss", () => {
    // The control. Without it, every refusal above could be firing for an unrelated reason.
    const prose = "An internal refactor of the reader's dispatch table.";
    const files = { "internal-thing.md": changeset("patch", prose) };
    const refused = releaseReadiness({
      currentVersion: "0.0.11",
      targetVersion: "0.0.12",
      register: EMPTY_REGISTER,
      changesetDir: fixtureDir(files),
    });
    const accepted = releaseReadiness({
      currentVersion: "0.0.11",
      targetVersion: "0.0.12",
      register: registerOf({
        "internal-thing.md": {
          level: "patch",
          breakCandidate: false,
          reason:
            "an internal dispatch table no export reaches; every public observable is identical",
        },
      }),
      changesetDir: fixtureDir(files),
    });
    expect(refused.exitCode).toBe(1);
    expect(accepted.exitCode).toBe(0);
    expect(accepted.classified).toBe(1);
    expect(accepted.derivedVersion).toBe("0.0.12");
  });
});

// ===========================================================================
// AC8: the happy path prints the count and the version.
// ===========================================================================

describe("a well formed, consistently classified set that derives the target", () => {
  it("exits zero and prints the count classified and the version derived", () => {
    const report = releaseReadiness({
      ...CONTROL_OPTIONS,
      register: registerOf({ "a-fix.md": PATCH_ENTRY }),
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
      register: registerOf({ "a-fix.md": PATCH_ENTRY, "another-fix.md": PATCH_ENTRY }),
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
    // A `changeset version` run CONSUMES the pending set: it deletes the files and bumps the
    // version in one commit. So what is asserted is that running this check consumes nothing and
    // that the directory still holds its two non-changeset files, whatever else is beside them.
    // Asserting the set is EMPTY would assert a fact about the tree's release state rather than
    // about publication, and would red on any changeset a later change legitimately adds.
    const before = readdirSync(CHANGESET_DIR).sort();
    releaseReadiness({ ...CONTROL_OPTIONS, changesetDir: CHANGESET_DIR, register: REGISTER });
    const after = readdirSync(CHANGESET_DIR).sort();
    expect(after).toEqual(before);
    for (const name of NON_CHANGESET_FILES) expect(after).toContain(name);
  });

  it("leaves no artifact of a version run standing in for a publish", () => {
    // A `changeset version` run rewrites package.json AND src/index.ts, which is what the two
    // assertions above catch. This is the third artifact: `changeset pre enter` writes
    // `.changeset/pre.json` and makes every publish after it a prerelease, stickily, until someone
    // exits. Nothing here writes it, and reading the tree must not either.
    const packageBefore = readFileSync(join(REPO_ROOT, "package.json"), "utf8");
    releaseReadiness({ ...CONTROL_OPTIONS, changesetDir: CHANGESET_DIR, register: REGISTER });
    expect(readFileSync(join(REPO_ROOT, "package.json"), "utf8")).toBe(packageBefore);
    expect(readdirSync(CHANGESET_DIR)).not.toContain("pre.json");
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
