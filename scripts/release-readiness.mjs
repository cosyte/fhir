#!/usr/bin/env node
/**
 * Release readiness check: is the pending Changesets set well formed, classified against the written
 * rule, and does it derive the version this repository is aiming at?
 *
 * WHY THIS IS A CHECK AND NOT A PARAGRAPH. Changesets derives the next version from the bump levels
 * sitting in `.changeset/`, and a set that is entirely `patch` derives a patch. A minor line cannot
 * be reached by intention, only by the levels in those files, so the gap between "what the release
 * notes say happened" and "what the files declare" is invisible until a version number that means
 * the wrong thing is already immutable on a registry. This reads the files.
 *
 * IT REFUSES RATHER THAN REPORTS. Every unhappy shape below exits non-zero and names the file and
 * the defect: an empty or absent directory, a file with no parseable frontmatter, one naming another
 * package, one declaring a level outside the three, one declaring `major`, one this repository has
 * not classified, a classification naming a file that is gone, a declared level that disagrees with
 * the classification, and a break candidate riding out as a patch. None of them is skipped, counted
 * anyway, or defaulted to a level. A check that quietly stops looking reports readiness over exactly
 * the condition it was written to catch.
 *
 * `major` IS NOT AVAILABLE. The package is on a `0.x` line and a `major` would derive `1.0.0`, which
 * is a different decision from the one this file grades, so a changeset declaring it is a defect
 * rather than a classification. That is also why a withdrawal of previously working public behavior
 * is `minor` at minimum here: on a `0.x` package the minor position is the only place a break can be
 * signalled at all.
 *
 * THE CLASSIFICATION IS DECLARED, NOT INFERRED. Reading a changeset's prose and deciding whether it
 * withdraws public behavior is a judgement, and a keyword matcher that guessed at it would be a
 * fourth place the rule lives and the first place it is wrong. The judgement is committed as data
 * (`documentation/release-0.1.0-classification.json`) beside the audit that explains it, and this
 * file grades the changeset files AGAINST that declaration in both directions, so neither an
 * unclassified changeset nor a classification whose changeset was consumed can pass.
 *
 * No build, no network, no npm credentials, no JVM. It reads files and exits.
 *
 * Usage:
 *   node scripts/release-readiness.mjs
 *   node scripts/release-readiness.mjs --changeset-dir <dir> --classification <file> --package-json <file>
 *
 * Exit 0 prints the count it classified and the version it derived. Every other exit is non-zero and
 * names its condition on stderr.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The two files in `.changeset/` that are not changesets. Everything else there is one. */
const NOT_A_CHANGESET = new Set(["README.md", "config.json"]);

/** The levels a changeset may declare. `major` is parseable and is refused on its own line below. */
const LEVELS = ["patch", "minor", "major"];

/** Bump precedence. The set's level is the maximum over its members. */
const RANK = { patch: 0, minor: 1, major: 2 };

class ReadinessError extends Error {}

function fail(message) {
  throw new ReadinessError(message);
}

// ---------------------------------------------------------------------------
// Argument handling
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const options = {
    changesetDir: join(ROOT, ".changeset"),
    classification: join(ROOT, "documentation", "release-0.1.0-classification.json"),
    packageJson: join(ROOT, "package.json"),
  };
  const keys = {
    "--changeset-dir": "changesetDir",
    "--classification": "classification",
    "--package-json": "packageJson",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const key = keys[argv[i]];
    if (key === undefined) fail(`unrecognised argument \`${argv[i]}\``);
    const value = argv[i + 1];
    if (value === undefined) fail(`\`${argv[i]}\` needs a value`);
    options[key] = value;
    i += 1;
  }
  return options;
}

// ---------------------------------------------------------------------------
// Reading the pending set
// ---------------------------------------------------------------------------

/**
 * Every entry in `.changeset/` that is not `README.md` or `config.json`, in sorted order.
 *
 * A directory that is absent and one that holds nothing but its two non-changeset files are the
 * same answer here (zero pending) and the caller refuses both; they are distinguished only in the
 * message, because "you deleted the directory" and "you already released" are different mistakes.
 */
export function listChangesetFiles(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return { present: false, files: [] };
  }
  return { present: true, files: entries.filter((name) => !NOT_A_CHANGESET.has(name)).sort() };
}

/**
 * A changeset's PROSE: everything below the closing `---`.
 *
 * Correcting a bump level edits the level line and nothing else. The classification records the
 * digest of the prose it was taken over, so an edit that rewrote the paragraph while it was in there
 * reds instead of leaving a classification that cites text no longer in the file.
 */
export function proseOf(text) {
  const lines = text.split(/\r?\n/);
  const close = lines.indexOf("---", 1);
  return lines.slice(close + 1).join("\n");
}

/**
 * The bump level a changeset file declares for `expectedPackage`.
 *
 * Refuses, rather than defaults, on: an unreadable file, missing or unterminated `---` frontmatter,
 * frontmatter carrying no package line, a line that is not `"<package>": <level>`, a package that is
 * not the one under release, a level outside the three, and more than one entry for the package.
 */
export function readDeclaredLevel(name, text, expectedPackage) {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    fail(`${name}: no parseable frontmatter (the file does not open with \`---\`)`);
  }
  const close = lines.indexOf("---", 1);
  if (close === -1) fail(`${name}: no parseable frontmatter (the \`---\` block is never closed)`);

  const declarations = [];
  for (let i = 1; i < close; i += 1) {
    const line = lines[i].trim();
    if (line.length === 0) continue;
    const match = /^"([^"]+)"\s*:\s*(\S+)\s*$/.exec(line);
    if (match === null) {
      fail(`${name}: frontmatter line \`${line}\` is not \`"<package>": <level>\``);
    }
    declarations.push({ pkg: match[1], level: match[2] });
  }

  if (declarations.length === 0) fail(`${name}: frontmatter declares no package`);
  for (const { pkg } of declarations) {
    if (pkg !== expectedPackage) {
      fail(`${name}: declares package \`${pkg}\`, which is not \`${expectedPackage}\``);
    }
  }
  if (declarations.length > 1) {
    fail(`${name}: declares \`${expectedPackage}\` ${declarations.length} times`);
  }

  const { level } = declarations[0];
  if (!LEVELS.includes(level)) {
    fail(`${name}: declares bump level \`${level}\`, which is not one of ${LEVELS.join(" / ")}`);
  }
  if (level === "major") {
    fail(
      `${name}: declares \`major\`, which is not available on this line (it would derive a 1.0.0, ` +
        `which is a different release decision from the one this check grades)`,
    );
  }
  return level;
}

// ---------------------------------------------------------------------------
// Deriving the version
// ---------------------------------------------------------------------------

/** `0.0.10` + minor is `0.1.0`; + patch is `0.0.11`. `major` never reaches here. */
export function nextVersion(current, level) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
  if (match === null) fail(`package.json version \`${current}\` is not a plain \`x.y.z\``);
  const [major, minor, patch] = match.slice(1).map(Number);
  if (level === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

/**
 * The whole check as a pure-ish function over paths, so a test can drive it over a temporary
 * directory without spawning anything. Returns the report; throws `ReadinessError` on every refusal.
 */
export function check(options) {
  const pkg = JSON.parse(readFileSync(options.packageJson, "utf8"));
  const declaration = JSON.parse(readFileSync(options.classification, "utf8"));

  if (declaration.package !== pkg.name) {
    fail(
      `the classification declares package \`${declaration.package}\` but package.json is ` +
        `\`${pkg.name}\``,
    );
  }
  if (declaration.baselineVersion !== pkg.version) {
    fail(
      `the classification was taken against version \`${declaration.baselineVersion}\` but ` +
        `package.json now reads \`${pkg.version}\`, so the classification is stale`,
    );
  }

  const { present, files } = listChangesetFiles(options.changesetDir);
  if (files.length === 0) {
    fail(
      present
        ? "0 pending changesets: `.changeset/` holds no changeset file, so there is nothing to " +
            "release and this tree is NOT releasable"
        : "0 pending changesets: `.changeset/` is absent, so there is nothing to release and this " +
            "tree is NOT releasable",
    );
  }

  const classified = declaration.changesets ?? {};
  const rows = [];

  for (const name of files) {
    const entry = classified[name];
    if (entry === undefined) {
      fail(
        `${name}: pending but not classified. Apply the rule to it and record the verdict in ` +
          `${options.classification} rather than releasing over an unread changeset.`,
      );
    }
    const text = readFileSync(join(options.changesetDir, name), "utf8");
    const declared = readDeclaredLevel(name, text, pkg.name);
    if (typeof entry.proseSha256 !== "string") {
      fail(`${name}: its classification records no \`proseSha256\`, so it grades no text`);
    }
    const actual = createHash("sha256").update(proseOf(text), "utf8").digest("hex");
    if (actual !== entry.proseSha256) {
      fail(
        `${name}: its prose is not the prose the classification was taken over ` +
          `(sha256 ${actual}, classified ${entry.proseSha256}). Correcting a bump level edits the ` +
          `level line only; re-read the changeset and re-classify it.`,
      );
    }
    const ruled = entry.level;
    if (!LEVELS.includes(ruled)) {
      fail(`${name}: the classification records level \`${ruled}\`, which is not a bump level`);
    }
    const breakCandidate = entry.breakCandidate ?? null;

    // A break candidate is `minor` at minimum, because on a 0.x line the minor position is the only
    // place a break can be signalled. Both halves are graded: the classification may not record one
    // as a patch, and the file may not declare a patch for one.
    if (breakCandidate !== null && RANK[ruled] < RANK.minor) {
      fail(
        `${name}: classified as a break candidate and recorded \`${ruled}\`. A withdrawal of ` +
          `previously working public behavior is \`minor\` at minimum. Observable: ` +
          `${breakCandidate.observable}`,
      );
    }
    if (breakCandidate !== null && declared === "patch") {
      fail(
        `${name}: declares \`patch\` but is a break candidate, so the set is NOT ready. ` +
          `Observable: ${breakCandidate.observable} Published symbol a consumer sees: ` +
          `${breakCandidate.symbol}`,
      );
    }
    if (declared !== ruled) {
      fail(
        `${name}: declares \`${declared}\` but the classification rule yields \`${ruled}\`. ` +
          `Correct the bump level line, leaving the prose untouched.`,
      );
    }
    rows.push({ name, level: declared, breakCandidate });
  }

  for (const name of Object.keys(classified)) {
    if (!files.includes(name)) {
      fail(
        `${name}: classified but no longer in \`${options.changesetDir}\`. Either a version was ` +
          `taken over it or the classification is stale; both mean this report is not about the ` +
          `tree in front of you.`,
      );
    }
  }

  const level = rows.reduce((acc, row) => (RANK[row.level] > RANK[acc] ? row.level : acc), "patch");
  const derived = nextVersion(pkg.version, level);
  const target = declaration.targetVersion;
  if (derived !== target) {
    fail(
      `the pending set derives \`${derived}\` from \`${pkg.version}\`, not the target ` +
        `\`${target}\`. The set's level is \`${level}\`; reaching \`${target}\` needs a member the ` +
        `rule classifies higher, and inventing one is not available.`,
    );
  }

  return {
    count: rows.length,
    level,
    currentVersion: pkg.version,
    derivedVersion: derived,
    targetVersion: target,
    breakCandidates: rows.filter((row) => row.breakCandidate !== null).map((row) => row.name),
    rows,
  };
}

export function main(argv) {
  const report = check(parseArgs(argv));
  const candidates =
    report.breakCandidates.length === 0
      ? "no break candidates"
      : `break candidates: ${report.breakCandidates.join(", ")}`;
  console.log(
    `release-readiness: classified ${report.count} pending changeset(s); set level ` +
      `\`${report.level}\`; derives ${report.currentVersion} -> ${report.derivedVersion} ` +
      `(target ${report.targetVersion}); ${candidates}.`,
  );
  return report;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    if (error instanceof ReadinessError) {
      console.error(`release-readiness: ${error.message}`);
      process.exit(1);
    }
    console.error(`release-readiness: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

export { ReadinessError };
