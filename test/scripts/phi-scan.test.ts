/**
 * Tests for `scripts/phi-scan.ts`, the CI / pre-commit half of the PHI commit-gate.
 *
 * The scanner is invoked via `spawnSync` (array args, no shell) so the full CLI
 * path (argv parse, exit code, stdout, stderr) is exercised rather than an
 * imported internal. Violator and clean files are written into throwaway
 * directories so nothing here ever lands in the committed corpus.
 *
 * SECURITY: every subprocess call in this file uses `spawnSync` with array args.
 * No `exec`, no shell-form.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import {
  writeFileSync,
  readFileSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  copyFileSync,
  symlinkSync,
  realpathSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const REPO_ROOT = process.cwd();
const SCANNER_PATH = join(REPO_ROOT, "scripts", "phi-scan.ts");
const TSX_BIN = join(REPO_ROOT, "node_modules", ".bin", "tsx");

/**
 * WHY THE SWEEP SPAWNS `node` AND NOT `tsx`, THOUGH `pnpm phi-scan` USES `tsx`.
 *
 * This file spawns the scanner once per case and the cost of each spawn is
 * start-up, not scanning: the fixtures are a few hundred bytes. `node` runs the
 * TypeScript through its native type stripping, which is erased-types-only and
 * emits no warning to pollute stderr, and several cases below assert on stderr
 * exactly.
 *
 * Two things this costs, and how each is paid:
 *   - the `tsx` entry point is no longer exercised by the sweep, so ONE case
 *     below still spawns `tsx` and asserts byte-for-byte agreement with the
 *     `node` runner. Delete it and a tsx-only breakage ships green.
 *   - node's type stripping is on by default from Node 22.18, while
 *     `engines.node` here is `>=22`. CI runs the 22 + 24 matrix, both above
 *     that; a developer on 22.0 to 22.17 would need a newer 22. The scanner uses
 *     no TypeScript construct needing emit, which the tsx-pinned case reds if it
 *     ever stops being true.
 */
const NODE_BIN = process.execPath;

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runIn(cwd: string, args: string[]): RunResult {
  const r = spawnSync(NODE_BIN, [SCANNER_PATH, ...args], { cwd, encoding: "utf8", shell: false });
  return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function git(cwd: string, args: string[]): void {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", shell: false });
  if ((r.status ?? -1) !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
}

function gitOut(cwd: string, args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", shell: false });
  return r.stdout ?? "";
}

function commit(cwd: string, message: string): void {
  git(cwd, ["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", message]);
}

/**
 * Synthetic, name-bearing payload. A payload with no name proves nothing about a
 * claim that names do not leak, so this one carries a person name, a date of
 * birth, an SSN shape and an email. Every value is invented.
 */
const SYNTHETIC_PHI =
  [
    "Patient: RIVERA^JUANITA^Q",
    "DOB: 1978-03-14",
    "SSN: 123-45-6789",
    "Contact: juanita.rivera@clinic.example",
  ].join("\n") + "\n";

/** The link target's own file name carries a synthetic name, so an echo of it is visible. */
const TARGET_NAME = "RIVERA-JUANITA-1978-03-14.txt";

/** Tokens that must never appear in a refusal message. */
const PHI_TOKENS = [
  "RIVERA",
  "JUANITA",
  "1978-03-14",
  "123-45-6789",
  "juanita.rivera@clinic.example",
  TARGET_NAME,
];

function expectNoPhi(stderr: string): void {
  for (const t of PHI_TOKENS) expect(stderr).not.toContain(t);
}

const repos: string[] = [];

/**
 * A throwaway git repo laid out the way THIS package's scanner expects: an
 * allow-list under `scripts/`, a `src/` walk root, a `test/__fixtures__/` walk
 * root, and one ordinary source file so the walk has something legitimate to
 * find. Every case runs against one of these, never against this repository, so
 * no link or violator is ever written into the committed corpus.
 */
function makeRepo(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "fhir-phi-scan-")));
  repos.push(root);
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, "src"));
  mkdirSync(join(root, "test", "__fixtures__"), { recursive: true });
  copyFileSync(
    join(REPO_ROOT, "scripts", "phi-allow-list.txt"),
    join(root, "scripts", "phi-allow-list.txt"),
  );
  writeFileSync(join(root, "src", "ordinary.ts"), "export const answer = 42;\n");
  writeFileSync(join(root, TARGET_NAME), SYNTHETIC_PHI);
  git(root, ["init", "-q", "."]);
  return root;
}

afterAll(() => {
  for (const r of repos) rmSync(r, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// The scanner under test is THIS package's, not a sibling's
// ---------------------------------------------------------------------------
//
// Every parser in the suite ships a `scripts/phi-scan.ts` and they differ in the
// one thing every case below depends on: what gets the STRUCTURED scan. This
// package's structured root is `test/__fixtures__/`; a sibling's is
// `test/fixtures/`. A case that quietly ran a sibling's scanner, or a scanner
// whose dispatch had drifted to a sibling's, would pass its refusal assertions
// while proving nothing about this gate.
//
// THE DISCRIMINATOR MOVED WHEN THE WALK ROOT DID, and the old one would now be
// a false green. It used to be that a sibling's `test/fixtures/` was out of
// scope entirely; `test/` is the walk root now, so that path IS scanned here.
// What still separates the two is the DISPATCH: only `test/__fixtures__/` gets
// the structured scanner, and the case below picks a payload only the
// structured scanner reads (`identifier.value`, which the source recogniser
// deliberately does not key, because bare `value` is FHIR's most overloaded
// name and there is no block boundary in source text to scope it with).

describe("phi-scan: the scanner under test is this package's", () => {
  it("gives test/__fixtures__ the structured scan and a sibling's test/fixtures only the source pass", () => {
    const source = readFileSync(SCANNER_PATH, "utf8");
    expect(source).toContain("@cosyte/fhir");
    expect(source).toContain('"test/__fixtures__/"');

    // A 9-digit identifier: read by `scanIdentifier` (structured) and by nothing
    // in the source pass. No dashed SSN, no email, no name, no birthDate, so
    // every other detector is silent and the dispatch is the only variable.
    const resource = '{"resourceType":"Patient","identifier":[{"value":"123456789"}]}\n';

    const root = makeRepo();
    mkdirSync(join(root, "test", "fixtures"), { recursive: true });
    writeFileSync(join(root, "test", "fixtures", "patient.json"), resource);
    const sibling = runIn(root, ["test/fixtures/patient.json"]);
    expect(sibling.code, `stderr: ${sibling.stderr}`).toBe(0);

    writeFileSync(join(root, "test", "__fixtures__", "patient.json"), resource);
    const ours = runIn(root, ["test/__fixtures__/patient.json"]);
    expect(ours.code, `stderr: ${ours.stderr}`).toBe(1);
    expect(ours.stderr).toContain("Patient.identifier.value");
  });
});

// ---------------------------------------------------------------------------
// The payload is genuinely detectable
// ---------------------------------------------------------------------------
//
// Guards against proving nothing by fixture: every refusal case below rests on
// this payload being something the scanner would otherwise catch.

describe("phi-scan: the synthetic payload is genuinely detectable", () => {
  it("as a plain regular file it is a hit (exit 1)", () => {
    const root = makeRepo();
    writeFileSync(join(root, "src", "violator.ts"), SYNTHETIC_PHI);
    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain("123-45-6789");
    expect(r.stderr).toContain("juanita.rivera@clinic.example");
  });

  it("a repo with no link and no violator scans clean (exit 0)", () => {
    const root = makeRepo();
    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
    expect(r.stdout).toMatch(/OK, no hits/);
  });

  it("the `tsx` entry point `pnpm phi-scan` uses agrees byte-for-byte with the `node` runner", () => {
    // THE ONE CASE THAT PAYS THE tsx COLD START, and the backstop for every other
    // case in this file. `pnpm phi-scan` runs `tsx scripts/phi-scan.ts`, which is
    // what the pre-commit hook and CI invoke; the rest spawn `node`. It asserts
    // EQUIVALENCE rather than merely "tsx works", so if the two runners ever
    // diverge this reds instead of the sweep silently testing something the gate
    // does not run.
    const root = makeRepo();
    symlinkSync(join("..", TARGET_NAME), join(root, "src", "leak.ts"));

    const viaNode = runIn(root, []);
    const tsx = spawnSync(TSX_BIN, [SCANNER_PATH], { cwd: root, encoding: "utf8", shell: false });
    const viaTsx: RunResult = {
      code: tsx.status ?? -1,
      stdout: tsx.stdout ?? "",
      stderr: tsx.stderr ?? "",
    };

    expect(viaTsx.code, `tsx stderr: ${viaTsx.stderr}`).toBe(2);
    expect(viaTsx.code).toBe(viaNode.code);
    expect(viaTsx.stdout).toBe(viaNode.stdout);
    expect(viaTsx.stderr).toBe(viaNode.stderr);
  });
});

// ---------------------------------------------------------------------------
// Entries that are not regular files, on BOTH enumerating routes
// ---------------------------------------------------------------------------
//
// The walk enumerates `Dirent.isFile()`, an lstat answer, so a symbolic link is
// neither a file nor a directory; `--staged` reads content with
// `git show :<path>`, and git stores a link as its TARGET PATH under mode
// 120000. A link under a scan root pointing at a PHI-bearing file therefore
// scanned CLEAN on both. These cases pin the refusal on each route, the negative
// controls that keep ordinary files scanned on each route, and the rule that a
// refusal never echoes what is on the other side of the link.

describe("phi-scan: the all-mode walk refuses a non-regular entry", () => {
  it("refuses a symlink under a walk root pointing at PHI (exit 2), and reports no PHI", () => {
    const root = makeRepo();
    symlinkSync(join("..", TARGET_NAME), join(root, "src", "leak.ts"));

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("src/leak.ts");
    expect(r.stderr).toContain("a symbolic link");
    expectNoPhi(r.stderr);
    expect(r.stdout).not.toMatch(/OK/);
  });

  it("refuses a symlinked DIRECTORY too, which isDirectory() also answers false for", () => {
    // A linked directory takes a whole subtree with it, not one file.
    const root = makeRepo();
    mkdirSync(join(root, "elsewhere"));
    writeFileSync(join(root, "elsewhere", TARGET_NAME), SYNTHETIC_PHI);
    symlinkSync(join("..", "elsewhere"), join(root, "src", "linked-dir"));

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("src/linked-dir");
    expectNoPhi(r.stderr);
  });

  it("refuses a symlink under the fixture walk root as well as under src/", () => {
    const root = makeRepo();
    symlinkSync(join("..", "..", TARGET_NAME), join(root, "test", "__fixtures__", "patient.json"));

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("test/__fixtures__/patient.json");
    expectNoPhi(r.stderr);
  });

  it("names EVERY offender, not just the first", () => {
    const root = makeRepo();
    symlinkSync(join("..", TARGET_NAME), join(root, "src", "one.ts"));
    symlinkSync(join("..", TARGET_NAME), join(root, "src", "two.ts"));

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("src/one.ts");
    expect(r.stderr).toContain("src/two.ts");
    expect(r.stderr).toContain("2 entries");
    expectNoPhi(r.stderr);
  });

  it("the `.md` exemption does not extend to a link named like documentation", () => {
    // The exemption is a judgement about a file whose bytes the walk could have
    // read. A link's NAME is no evidence about what is on the other side.
    const root = makeRepo();
    symlinkSync(join("..", TARGET_NAME), join(root, "src", "notes.md"));

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("src/notes.md");
    expectNoPhi(r.stderr);
  });

  it("still scans ordinary files in the same walk root (the refusal is not the only outcome)", () => {
    const root = makeRepo();
    writeFileSync(join(root, "src", "violator.ts"), SYNTHETIC_PHI);
    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
  });

  it("an ignored link is out of scope, by the same rule that already excludes an ignored file", () => {
    const root = makeRepo();
    symlinkSync(join("..", TARGET_NAME), join(root, "src", "leak.ts"));
    writeFileSync(join(root, ".gitignore"), "src/leak.ts\n");

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
  });

  it("but an entry already in the index cannot be excused that way", () => {
    const root = makeRepo();
    symlinkSync(join("..", TARGET_NAME), join(root, "src", "leak.ts"));
    writeFileSync(join(root, ".gitignore"), "src/leak.ts\n");
    git(root, ["add", "-f", "src/leak.ts"]);

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("src/leak.ts");
  });
});

describe("phi-scan: the --staged route refuses a staged non-regular entry", () => {
  it("git really does store the link as its target path, not the target's bytes", () => {
    // The measurement the refusal rests on. If git ever changed this, the
    // refusal below would be arguing from a premise that no longer holds.
    const root = makeRepo();
    symlinkSync(join("..", TARGET_NAME), join(root, "src", "leak.ts"));
    git(root, ["add", "src/leak.ts"]);

    expect(gitOut(root, ["ls-files", "--stage", "src/leak.ts"])).toMatch(/^120000 /);
    const shown = gitOut(root, ["show", ":src/leak.ts"]);
    expect(shown.trim()).toBe(`../${TARGET_NAME}`);
    expect(shown).not.toContain("123-45-6789");
  });

  it("refuses a staged symlink under src/ (exit 2), and reports no PHI", () => {
    const root = makeRepo();
    symlinkSync(join("..", TARGET_NAME), join(root, "src", "leak.ts"));
    git(root, ["add", "src/leak.ts"]);

    const r = runIn(root, ["--staged"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("src/leak.ts");
    expect(r.stderr).toContain("a symbolic link");
    expectNoPhi(r.stderr);
  });

  it("refuses a staged symlink under test/__fixtures__ (the structured-scan route)", () => {
    // This is the shape that matters most here: the fixture route is where the
    // FHIR-aware structured scan runs, and `git show` handed it the target path,
    // which fails JSON.parse and falls through to the conservative pass over a
    // few dozen bytes of path text. Clean, and about nothing.
    const root = makeRepo();
    symlinkSync(join("..", "..", TARGET_NAME), join(root, "test", "__fixtures__", "patient.json"));
    git(root, ["add", "test/__fixtures__/patient.json"]);

    const r = runIn(root, ["--staged"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("test/__fixtures__/patient.json");
    expect(r.stderr).toContain("a symbolic link");
    expectNoPhi(r.stderr);
  });

  it("refuses a TYPECHANGE, a tracked regular file replaced by a link (exit 2)", () => {
    // The shape `--diff-filter=AM` deleted before any mode could be read.
    // Replacing a TRACKED file with a link is neither an add nor a modify: git
    // raises `:100644 120000 <sha> <sha> T`, and without `T` in the filter the
    // record never existed, so the pre-commit hook passed the link green.
    const root = makeRepo();
    git(root, ["add", "src/ordinary.ts"]);
    commit(root, "base");

    rmSync(join(root, "src", "ordinary.ts"));
    symlinkSync(join("..", TARGET_NAME), join(root, "src", "ordinary.ts"));
    git(root, ["add", "src/ordinary.ts"]);

    // The premise: git really does raise this as a typechange, not A or M.
    expect(gitOut(root, ["diff", "--cached", "--raw", "--diff-filter=AM"]).trim()).toBe("");
    expect(gitOut(root, ["diff", "--cached", "--raw"])).toContain(" 120000 ");

    const r = runIn(root, ["--staged"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("src/ordinary.ts");
    expect(r.stderr).toContain("a symbolic link");
    expectNoPhi(r.stderr);
  });

  it("scans the other direction of a typechange, a link replaced by a real file (exit 1)", () => {
    // Admitting `T` closes the reverse hole too: a tracked link replaced by a
    // regular file carrying PHI was dropped by the same one-letter filter.
    const root = makeRepo();
    symlinkSync("ordinary.ts", join(root, "src", "link.ts"));
    git(root, ["add", "src/link.ts"]);
    commit(root, "base");

    rmSync(join(root, "src", "link.ts"));
    writeFileSync(join(root, "src", "link.ts"), SYNTHETIC_PHI);
    git(root, ["add", "src/link.ts"]);

    const r = runIn(root, ["--staged"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain("123-45-6789");
  });

  it("refuses a staged gitlink under a scanned prefix, naming its kind (exit 2)", () => {
    // A gitlink already refused before this change, but by way of an
    // uncontrolled `git show` failure ("fatal: bad object") that named no kind.
    // The mode is read first now, so the refusal is the scanner's own.
    const root = makeRepo();
    const nested = join(root, "test", "__fixtures__", "nested");
    mkdirSync(nested, { recursive: true });
    git(nested, ["init", "-q", "."]);
    writeFileSync(join(nested, "payload.txt"), SYNTHETIC_PHI);
    git(nested, ["add", "payload.txt"]);
    commit(nested, "n");
    git(root, ["add", "test/__fixtures__/nested"]);

    const r = runIn(root, ["--staged"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("test/__fixtures__/nested");
    expect(r.stderr).toContain("a gitlink");
    expect(r.stderr).not.toContain("bad object");
    expectNoPhi(r.stderr);
  });

  it("still catches a staged ORDINARY file carrying the same payload (exit 1)", () => {
    // The regression control on the `--raw -z` reparse: reading the mode must not
    // cost the route the ordinary files it was already enumerating.
    const root = makeRepo();
    writeFileSync(join(root, "src", "violator.ts"), SYNTHETIC_PHI);
    git(root, ["add", "src/violator.ts"]);

    const r = runIn(root, ["--staged"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain("src/violator.ts");
    expect(r.stderr).toContain("123-45-6789");
  });

  it("still runs the FHIR-aware structured scan on a staged fixture (exit 1)", () => {
    // The mode check must not cost the fixture route its structured detectors:
    // this name is in no allow-list and is caught by the HumanName detector, not
    // by the SSN / email floor.
    const root = makeRepo();
    writeFileSync(
      join(root, "test", "__fixtures__", "patient.json"),
      JSON.stringify({ resourceType: "Patient", name: [{ family: "Vanterpool" }] }),
    );
    git(root, ["add", "test/__fixtures__/patient.json"]);

    const r = runIn(root, ["--staged"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain("Patient.name.family");
    expect(r.stderr).toContain("person-name token not in synthetic allow-list");
  });

  it("passes a staged ordinary clean file (exit 0)", () => {
    const root = makeRepo();
    git(root, ["add", "src/ordinary.ts"]);
    const r = runIn(root, ["--staged"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
    expect(r.stdout).toMatch(/OK, no hits/);
  });

  it("a staged link OUTSIDE the route's scope is left alone (the scope is unchanged)", () => {
    // `--staged` only ever covered `test/__fixtures__/**` and `src/**.ts`. The
    // mode check narrows what that scope admits; it does not widen the scope,
    // and saying otherwise would overstate what this closes.
    const root = makeRepo();
    symlinkSync(TARGET_NAME, join(root, "docs-link.txt"));
    git(root, ["add", "docs-link.txt"]);

    const r = runIn(root, ["--staged"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
  });

  it("a staged non-.ts file under src/ is out of scope, link or not", () => {
    const root = makeRepo();
    symlinkSync(join("..", TARGET_NAME), join(root, "src", "leak.json"));
    git(root, ["add", "src/leak.json"]);

    const r = runIn(root, ["--staged"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Residuals, pinned as behaviour rather than asserted in prose
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// A staged rename is enumerated (PHI-SCAN-RENAME-BLIND-AT-PRECOMMIT)
// ---------------------------------------------------------------------------
//
// `R`/`C` are returned by neither `AM` nor `AMT`, and git's rename detection is
// on by default, so a staged rename used to vanish from this route entirely:
// its CONTENT went unscanned and, worse, its MODE was never checked, so an
// ordinary `git mv` of a tracked symbolic link into a scan root reported clean.
// `--no-renames` closes both by making the destination arrive as an ordinary
// single-path add. The enumeration is a strict superset of the previous one.

describe("phi-scan: a staged rename is enumerated", () => {
  it("scans the CONTENT of a renamed file, so a substituted name is a hit (exit 1)", () => {
    // The high-similarity case: git pairs it as `R`, which is exactly the record
    // the old filter deleted. The rename also substitutes a real-looking name,
    // which is the harm this route existed to catch.
    const root = makeRepo();
    const body = Array.from({ length: 40 }, (_, i) => `export const v${String(i)} = ${String(i)};`)
      .join("\n")
      .concat("\n");
    writeFileSync(join(root, "src", "ordinary.ts"), body);
    git(root, ["add", "src/ordinary.ts"]);
    commit(root, "base");

    git(root, ["mv", "src/ordinary.ts", "src/renamed.ts"]);
    writeFileSync(join(root, "src", "renamed.ts"), `${body}// ssn 123-45-6789\n`);
    git(root, ["add", "src/renamed.ts"]);

    // The premise, unchanged: git itself still reports this as a rename, and the
    // old `AMT` filter still deletes it. It is `--no-renames`, not the filter,
    // that closes this.
    expect(gitOut(root, ["diff", "--cached", "--raw"])).toMatch(/\sR\d*\s/);
    expect(gitOut(root, ["diff", "--cached", "--raw", "--diff-filter=AMT"]).trim()).toBe("");

    const r = runIn(root, ["--staged"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain("src/renamed.ts");
  });

  it("refuses a tracked LINK `git mv`d into a scan root: R100 at mode 120000 (exit 2)", () => {
    // The headline. The record is `:120000 120000 <sha> <sha> R100`, so on base
    // the filter deleted it before any mode could be read and this route printed
    // "OK, no hits" over a mode-120000 entry sitting under a scan root.
    const root = makeRepo();
    symlinkSync(TARGET_NAME, join(root, "notes-link.txt"));
    git(root, ["add", "notes-link.txt", "src/ordinary.ts"]);
    commit(root, "base");

    git(root, ["mv", "notes-link.txt", "src/leak.ts"]);

    // The premise: both sides mode 120000, and git reports it as a rename.
    expect(gitOut(root, ["diff", "--cached", "--raw"])).toMatch(/^:120000 120000 \S+ \S+ R\d+\s/);
    expect(gitOut(root, ["ls-files", "--stage", "src/leak.ts"])).toMatch(/^120000 /);

    const r = runIn(root, ["--staged"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("src/leak.ts");
    expect(r.stderr).toContain("a symbolic link");
    expectNoPhi(r.stderr);
  });

  // The refusal must not depend on the caller's diff configuration. `--no-renames`
  // is passed on the command line, which overrides every one of these.
  for (const renames of ["true", "false", "copies", "1"]) {
    it(`refuses that same link with diff.renames=${renames} (exit 2)`, () => {
      const root = makeRepo();
      symlinkSync(TARGET_NAME, join(root, "notes-link.txt"));
      git(root, ["add", "notes-link.txt", "src/ordinary.ts"]);
      commit(root, "base");
      git(root, ["config", "diff.renames", renames]);
      git(root, ["mv", "notes-link.txt", "src/leak.ts"]);

      const r = runIn(root, ["--staged"]);
      expect(r.code, `stderr: ${r.stderr}`).toBe(2);
      expect(r.stderr).toContain("src/leak.ts");
      expectNoPhi(r.stderr);
    });
  }

  it("refuses that same link with diff.renameLimit=1 (exit 2)", () => {
    const root = makeRepo();
    symlinkSync(TARGET_NAME, join(root, "notes-link.txt"));
    git(root, ["add", "notes-link.txt", "src/ordinary.ts"]);
    commit(root, "base");
    git(root, ["config", "diff.renameLimit", "1"]);
    git(root, ["mv", "notes-link.txt", "src/leak.ts"]);

    const r = runIn(root, ["--staged"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("src/leak.ts");
    expectNoPhi(r.stderr);
  });

  it("emits no R or C record at all, so the two-field stride is structural", () => {
    // What makes the stride safe is not the filter's leave but that git cannot
    // produce a second-path record under `--no-renames`. Asserted directly.
    const root = makeRepo();
    symlinkSync(TARGET_NAME, join(root, "notes-link.txt"));
    git(root, ["add", "notes-link.txt", "src/ordinary.ts"]);
    commit(root, "base");
    git(root, ["config", "diff.renames", "copies"]);
    git(root, ["mv", "notes-link.txt", "src/leak.ts"]);

    const raw = gitOut(root, ["diff", "--cached", "--raw", "--no-renames", "--diff-filter=AMTU"]);
    expect(raw).not.toMatch(/\s[RC]\d*\s/);
    expect(raw).toMatch(/^:000000 120000 \S+ \S+ A\s+src\/leak\.ts/m);
  });

  it("scans a genuine COPY (`C`) destination, which was dropped exactly like a rename (exit 1)", () => {
    // The `C` half is real, not a theoretical arm of the sentence. With
    // `diff.renames=copies`, copying a PHI-bearing file from outside the scope
    // INTO a scan root stages as a genuine two-path `C` record, which `AMT`
    // dropped exactly as it dropped `R`. Copy detection only pairs when the
    // SOURCE is also touched in the same diff, so the source is modified here.
    const root = makeRepo();
    writeFileSync(join(root, "outside.txt"), SYNTHETIC_PHI);
    git(root, ["add", "outside.txt", "src/ordinary.ts"]);
    commit(root, "base");

    git(root, ["config", "diff.renames", "copies"]);
    writeFileSync(join(root, "outside.txt"), `${SYNTHETIC_PHI}// touched\n`);
    writeFileSync(join(root, "src", "copied.ts"), SYNTHETIC_PHI);
    git(root, ["add", "outside.txt", "src/copied.ts"]);

    // The premise: a real `C` record, which the old filter deleted outright.
    const raw = gitOut(root, ["diff", "--cached", "--raw", "--find-copies-harder"]);
    expect(raw, `raw: ${raw}`).toMatch(/\sC\d*\s/);
    expect(
      gitOut(root, ["diff", "--cached", "--raw", "--find-copies-harder", "--diff-filter=AMT"]),
    ).not.toMatch(/src\/copied\.ts/);

    const r = runIn(root, ["--staged"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain("src/copied.ts");
  });

  it("a CLEAN renamed fixture still passes: enumerating it is not refusing it (exit 0)", () => {
    const root = makeRepo();
    writeFileSync(join(root, "src", "ordinary.ts"), "export const answer = 42;\n");
    git(root, ["add", "src/ordinary.ts"]);
    commit(root, "base");

    git(root, ["mv", "src/ordinary.ts", "src/renamed.ts"]);

    const r = runIn(root, ["--staged"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
  });
});

describe("phi-scan: disclosed residuals on the --staged route", () => {
  it("a low-similarity rename is a delete plus an add, and the ADD is scanned (exit 1)", () => {
    const root = makeRepo();
    writeFileSync(join(root, "src", "ordinary.ts"), "export const answer = 42;\n");
    git(root, ["add", "src/ordinary.ts"]);
    commit(root, "base");

    git(root, ["rm", "-q", "src/ordinary.ts"]);
    // `git rm` takes the now-empty directory with it.
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "renamed.ts"), SYNTHETIC_PHI);
    git(root, ["add", "src/renamed.ts"]);

    const r = runIn(root, ["--staged"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain("src/renamed.ts");
  });

  it("a NEW link cannot arrive as a rename: git keeps it an add, which IS refused", () => {
    // The other bound. Even when a deleted regular file carries byte-identical
    // content to the link's target string (so the blob oids match), git does not
    // pair them across a mode change: the record stays `A` and the mode check
    // reaches it.
    const root = makeRepo();
    writeFileSync(join(root, "decoy.txt"), TARGET_NAME);
    git(root, ["add", "-A"]);
    commit(root, "base");

    git(root, ["rm", "-q", "decoy.txt"]);
    symlinkSync(TARGET_NAME, join(root, "src", "leak.ts"));
    git(root, ["add", "src/leak.ts"]);

    const raw = gitOut(root, ["diff", "--cached", "--raw"]);
    expect(raw).toMatch(/\sA\s+src\/leak\.ts/);
    expect(raw).not.toMatch(/\sR\d*\s/);

    const r = runIn(root, ["--staged"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("src/leak.ts");
    expect(r.stderr).toContain("a symbolic link");
    expectNoPhi(r.stderr);
  });

  it("CLOSED: an all-mode sweep that observed nothing now refuses instead of reporting OK", () => {
    // This was a pinned gap: with both roots gone the sweep printed `OK, no
    // hits` and exited 0, having opened nothing. Closing it reds this case, which
    // is the pin doing its job.
    const root = makeRepo();
    rmSync(join(root, "src"), { recursive: true, force: true });
    rmSync(join(root, "test"), { recursive: true, force: true });

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stdout).not.toMatch(/OK, no hits/);
    expect(r.stderr).toContain("observed no files");
  });
});

// ---------------------------------------------------------------------------
// An unmerged path, and each scan root's own path
// ---------------------------------------------------------------------------

describe("phi-scan: the --staged route refuses an unmerged in-scope path", () => {
  /** Leave `path` conflicted between two branches. Returns the repo root. */
  function makeConflict(path: string, ours: string, theirs: string): string {
    const root = makeRepo();
    writeFileSync(join(root, path), "export const base = 0;\n");
    git(root, ["add", path]);
    commit(root, "base");
    const branch = gitOut(root, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();

    git(root, ["checkout", "-q", "-b", "other"]);
    writeFileSync(join(root, path), theirs);
    git(root, ["add", path]);
    commit(root, "theirs");

    git(root, ["checkout", "-q", branch]);
    writeFileSync(join(root, path), ours);
    git(root, ["add", path]);
    commit(root, "ours");

    // The merge is EXPECTED to fail with a CONFLICT (that is the point), so it
    // does not go through `git()`, which throws on a non-zero status.
    //
    // IT STILL NEEDS AN INLINE IDENTITY, and this cost a CI-only red. These
    // repos configure no `user.email`, so git falls back to auto-detecting one
    // from the username and hostname. That succeeds on a developer box and
    // FAILS ON A RUNNER, whose hostname has no domain, so git refuses the merge
    // outright before touching the index: the conflict never happens, the index
    // stays clean, `git diff --cached --raw` returns EMPTY, and both cases below
    // go green locally and red in CI. Passing the identity the way `commit()`
    // already does removes the fallback entirely.
    const merge = spawnSync(
      "git",
      ["-c", "user.email=t@example.com", "-c", "user.name=t", "merge", "other"],
      { cwd: root, encoding: "utf8", shell: false },
    );

    // Assert the SETUP, not the behaviour under test. A merge that was refused
    // rather than conflicting leaves an index these cases would read as clean,
    // so it must fail here, loudly, and not further down as a puzzling regex
    // mismatch against an empty string.
    expect(
      merge.status,
      `git merge should have CONFLICTED (exit 1), not been refused. stderr: ${merge.stderr ?? ""}`,
    ).toBe(1);
    return root;
  }

  it("refuses (exit 2) rather than reporting clean over an index it cannot read", () => {
    // `U` was returned by neither `AM` nor `AMT`, so a conflicted in-scope path
    // was simply absent from the list and this route printed "OK, no hits".
    const root = makeConflict("src/ordinary.ts", "export const ours = 1;\n", SYNTHETIC_PHI);

    // The premise: a `U` record, and no stage-0 entry to read.
    expect(gitOut(root, ["diff", "--cached", "--raw"])).toMatch(/\sU\s+src\/ordinary\.ts/);
    expect(gitOut(root, ["ls-files", "--stage", "src/ordinary.ts"])).not.toMatch(/^\S+ \S+ 0\t/m);

    const r = runIn(root, ["--staged"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("src/ordinary.ts");
    expect(r.stderr).toContain("unmerged");
    // The refusal is about the index, not about the conflicting content.
    expectNoPhi(r.stderr);
  });

  it("an unmerged path OUTSIDE the scope is left alone (the scope is unchanged)", () => {
    const root = makeConflict("outside.md", "ours\n", "theirs\n");
    expect(gitOut(root, ["diff", "--cached", "--raw"])).toMatch(/\sU\s+outside\.md/);
    const r = runIn(root, ["--staged"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
  });
});

describe("phi-scan: a scan root's OWN path is in scope, not just its contents", () => {
  // An index entry at exactly `test/__fixtures__` or `src` is never a directory,
  // git records no entry for one, so it is a scan root replaced by a blob, a link
  // or a gitlink. The prefix test alone let that through.
  for (const scanRoot of ["test/__fixtures__", "src"]) {
    it(`refuses the ${scanRoot} root itself staged as a link (exit 2)`, () => {
      const root = makeRepo();
      writeFileSync(join(root, "src", "ordinary.ts"), "export const answer = 42;\n");
      git(root, ["add", "src/ordinary.ts"]);
      commit(root, "base");

      git(root, ["rm", "-rq", "--ignore-unmatch", scanRoot]);
      // `git rm` leaves an empty (or untracked-only) directory behind.
      rmSync(join(root, scanRoot), { recursive: true, force: true });
      mkdirSync(join(root, scanRoot, ".."), { recursive: true });
      symlinkSync(TARGET_NAME, join(root, scanRoot));
      git(root, ["add", scanRoot]);

      // The premise: a mode-120000 entry at exactly the root's own path.
      expect(gitOut(root, ["ls-files", "--stage", scanRoot])).toMatch(/^120000 /);

      const r = runIn(root, ["--staged"]);
      expect(r.code, `stderr: ${r.stderr}`).toBe(2);
      expect(r.stderr).toContain(scanRoot);
      expect(r.stderr).toContain("a symbolic link");
      expectNoPhi(r.stderr);
    });
  }

  it("a regular BLOB at the fixture root is now name-read, and the residual gap is narrower", () => {
    // This was pinned as a whole gap: a resource written at exactly
    // `test/__fixtures__` had its names, birthDate, address and telecom read by
    // NOTHING, because `scanTarget` computes `isFixture` from
    // `startsWith("test/__fixtures__/")`, with a trailing slash, so the root's
    // own path cannot reach the FHIR-aware branch. It still cannot. What changed
    // is what the non-fixture branch does: the source recogniser reads `family`,
    // `given`, `birthDate` and `line` there now, so three quarters of the gap is
    // gone and the pin reds.
    const root = makeRepo();
    rmSync(join(root, "test", "__fixtures__"), { recursive: true, force: true });
    writeFileSync(
      join(root, "test", "__fixtures__"),
      JSON.stringify({
        resourceType: "Patient",
        name: [{ family: "Okonkwo", given: ["Chidinma"] }],
        birthDate: "1961-11-02",
      }),
    );
    git(root, ["add", "test/__fixtures__"]);
    expect(gitOut(root, ["ls-files", "--stage", "test/__fixtures__"])).toMatch(/^100644 /);

    const r = runIn(root, ["--staged"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain("Okonkwo");
    expect(r.stderr).toContain("(source)");

    // THE RESIDUAL, PINNED RATHER THAN DESCRIBED. The structured-only detectors
    // are still unreachable at this path: `identifier.value` and `telecom.value`
    // are read by `scanIdentifier` / `scanTelecom` and by nothing in the source
    // recogniser, which deliberately does not key bare `value`.
    const gap = makeRepo();
    rmSync(join(gap, "test", "__fixtures__"), { recursive: true, force: true });
    writeFileSync(
      join(gap, "test", "__fixtures__"),
      '{"resourceType":"Patient","identifier":[{"value":"123456789"}]}',
    );
    git(gap, ["add", "test/__fixtures__"]);
    expect(runIn(gap, ["--staged"]).code).toBe(0);

    // The control that makes that meaningful: the SAME resource one level inside
    // the root IS caught, so the payload is genuinely detectable and it is the
    // trailing slash that decides.
    const inner = makeRepo();
    writeFileSync(
      join(inner, "test", "__fixtures__", "patient.json"),
      '{"resourceType":"Patient","identifier":[{"value":"123456789"}]}',
    );
    git(inner, ["add", "test/__fixtures__/patient.json"]);
    const r2 = runIn(inner, ["--staged"]);
    expect(r2.code, `stderr: ${r2.stderr}`).toBe(1);
    expect(r2.stderr).toContain("Patient.identifier.value");
  });

  it("CLOSED: a scan root's PARENT staged as a link is refused, not walked past", () => {
    // This was pinned as a gap on both routes: `test` matched neither `===` nor
    // either prefix on `--staged`, and the all-mode walk returned silently
    // because `existsSync(test/__fixtures__)` was false, so the whole fixture
    // corpus could leave the index with both routes reporting OK. `test` is the
    // scan root now, so both routes reach it and the pin reds.
    const root = makeRepo();
    writeFileSync(join(root, "src", "ordinary.ts"), "export const answer = 42;\n");
    git(root, ["add", "src/ordinary.ts"]);
    commit(root, "base");

    rmSync(join(root, "test"), { recursive: true, force: true });
    symlinkSync(TARGET_NAME, join(root, "test"));
    git(root, ["add", "test"]);
    expect(gitOut(root, ["ls-files", "--stage", "test"])).toMatch(/^120000 /);

    const staged = runIn(root, ["--staged"]);
    expect(staged.code, `stderr: ${staged.stderr}`).toBe(2);
    expect(staged.stderr).toContain("a symbolic link");
    expectNoPhi(staged.stderr);

    // The all-mode half refuses too, by a different mechanism and with a
    // different message: `existsSync` and `readdirSync` both FOLLOW, so the walk
    // reaches the link's target, which is a regular file, and `readdirSync`
    // raises `ENOTDIR`. Asserted on the code and on the absence of a clean
    // report, not on which of the two refusals fired.
    const all = runIn(root, []);
    expect(all.code, `stderr: ${all.stderr}`).toBe(2);
    expect(all.stdout).not.toMatch(/OK, no hits/);
    expectNoPhi(all.stderr);
  });
});

// ---------------------------------------------------------------------------
// A scan that could not RUN exits 2, never 1
// ---------------------------------------------------------------------------
//
// Node exits 1 on an uncaught throw, and 1 is this gate's code for HITS FOUND,
// so a failure that was not an `InvocationError` was reported to CI and to the
// developer as a finding. Both routes below were measured exiting 1.

describe("phi-scan: a scan that could not run exits 2, not 1", () => {
  it("a missing allow-list is an invocation error, not a finding", () => {
    const root = makeRepo();
    rmSync(join(root, "scripts", "phi-allow-list.txt"), { force: true });

    const r = runIn(root, ["--staged"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("allow-list not found");
  });

  it("a walk root that is not a directory refuses instead of impersonating a hit", () => {
    // `readdirSync` raises `ENOTDIR`, a plain system error rather than an
    // `InvocationError`, straight out of the walk.
    const root = makeRepo();
    rmSync(join(root, "src"), { recursive: true, force: true });
    writeFileSync(join(root, "src"), "not a directory\n");

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("could not enumerate");
    expect(r.stderr).not.toMatch(/HIT:/);
  });
});

// ---------------------------------------------------------------------------
// The override-log gate, and the paths mode
// ---------------------------------------------------------------------------

describe("phi-scan: paths mode and the override-log gate", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "fhir-phi-scan-paths-"));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects --allow-fixture without a matching override entry (exit 2)", () => {
    const clean = join(dir, "override-me.txt");
    writeFileSync(clean, "nothing to see\n");
    const r = runIn(REPO_ROOT, ["--allow-fixture", clean]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/phi-scan-overrides\.md/);
  });

  it("a path named explicitly is scanned through its target, which is the caller's own act", () => {
    // `buildTargetsForPaths` uses `statSync`, which FOLLOWS a link, and this is
    // deliberately unchanged: naming a path on the CLI is an explicit request to
    // read whatever is there, and it errs toward scanning MORE, never less. The
    // two sweeping routes are the ones that must not follow anything.
    const root = makeRepo();
    symlinkSync(join("..", TARGET_NAME), join(root, "src", "leak.ts"));

    const r = runIn(root, ["src/leak.ts"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain("123-45-6789");
  });
});

// ---------------------------------------------------------------------------
// The walk root is `test`, not `test/__fixtures__`
// ---------------------------------------------------------------------------
//
// Measured on this repository before the change: 55 tracked files sat directly
// under `test/` and were reached by NEITHER route, the all-mode walk (rooted at
// `test/__fixtures__` and `src`) nor `--staged` (scoped to the same two
// prefixes). Counted with the scanner's own key regex over those 55 files: 87
// object-literal `family` / `given` sites and 21 `birthDate` sites, plus 33 more
// `family` / `given` and 3 `birthDate` spelled as XML `value` attributes, all of
// them unread. The old justification for the exclusion was the
// PHI-leak suite's sentinel battery, which is two files, not the directory.

describe("phi-scan: tracked files directly under test/ are in scope", () => {
  it("the all-mode walk reads a dashed SSN in a test/*.ts (the enumeration floor)", () => {
    const root = makeRepo();
    writeFileSync(join(root, "test", "inline.test.ts"), 'const s = "SSN 123-45-6789";\n');

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain("test/inline.test.ts");
  });

  it("the --staged route reads it too, so the hook and CI agree on the corpus", () => {
    const root = makeRepo();
    writeFileSync(join(root, "test", "inline.test.ts"), 'const s = "SSN 123-45-6789";\n');
    git(root, ["add", "test/inline.test.ts"]);

    const r = runIn(root, ["--staged"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain("test/inline.test.ts");
  });

  it("`test` staged as a symbolic link is refused, not walked past", () => {
    // The scan roots' PARENT. Recorded as an open limitation before this change:
    // `test` staged as a mode-120000 entry matched neither `===` nor either
    // prefix, so the whole fixture corpus could leave the index with both routes
    // reporting OK.
    const root = makeRepo();
    rmSync(join(root, "test"), { recursive: true, force: true });
    symlinkSync(TARGET_NAME, join(root, "test"));
    git(root, ["add", "test"]);

    const r = runIn(root, ["--staged"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("a symbolic link");
    expectNoPhi(r.stderr);
  });

  it("a declared sentinel file is skipped by the sweep, and says so", () => {
    const root = makeRepo();
    mkdirSync(join(root, "test", "scripts"), { recursive: true });
    writeFileSync(join(root, "test", "phi-leak.test.ts"), SYNTHETIC_PHI);

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
    expect(r.stdout).toContain("declared sentinel");
    expect(r.stdout).toContain("test/phi-leak.test.ts");
  });

  it("a sentinel named explicitly on the command line is still scanned", () => {
    // The exemption is for the SWEEPING routes. Naming a path is the caller's
    // own request to read whatever is there.
    const root = makeRepo();
    writeFileSync(join(root, "test", "phi-leak.test.ts"), SYNTHETIC_PHI);

    const r = runIn(root, ["test/phi-leak.test.ts"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain("123-45-6789");
  });
});

// ---------------------------------------------------------------------------
// Enumerating a source file buys the SSN / email floor and NOTHING else
// ---------------------------------------------------------------------------
//
// The structured scanner assumes the FILE IS THE DOCUMENT and is reached only
// for a fixture with a FHIR wire-format extension. A test builds its resources
// as TypeScript object literals, so widening the scope without widening the
// recogniser would enumerate these files and still read nothing in them.

describe("phi-scan: the FHIR-keyed literal recogniser reads source", () => {
  const cases: [string, string, string][] = [
    ["a family name", 'const p = { name: [{ family: "Nakamura" }] };\n', "Nakamura"],
    ["a given name", 'const p = { name: [{ given: ["Hiroshi", "Ken"] }] };\n', "Hiroshi"],
    ["a date of birth", 'const p = { birthDate: "1961-11-02" };\n', "1961-11-02"],
    ["a street address", 'const p = { address: [{ line: ["42 Wallaby Way"] }] };\n', "42 Wallaby"],
  ];

  for (const [label, body, token] of cases) {
    it(`reports ${label} written as a source literal, which the shape pass never saw`, () => {
      const root = makeRepo();
      writeFileSync(join(root, "test", "inline.test.ts"), body);

      const r = runIn(root, []);
      expect(r.code, `stderr: ${r.stderr}`).toBe(1);
      expect(r.stderr).toContain(token);
      expect(r.stderr).toContain("(source)");
    });
  }

  it("decodes the escapes a JSON-document-inside-a-TypeScript-string is spelled with", () => {
    // Two layers: the TypeScript literal, then the JSON one. A single decode
    // leaves `Nakamura`, whose name tokens are `Nakamur` and `u`, and
    // neither is what the file says.
    const root = makeRepo();
    writeFileSync(
      join(root, "test", "inline.test.ts"),
      `const doc = '{"resourceType":"Patient","name":[{"family":"Nakamur\\\\u0061"}]}';\n`,
    );

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain("Nakamura");
  });

  // THE XML SPELLING. This package reads two wire formats and its tests write
  // both, so keying only the object literal left the other half unread inside
  // the newly widened scope. Measured on base, in the 55 files under `test/`
  // outside the fixture root: 87 object-literal `family` / `given` key sites and
  // 21 `birthDate` sites, PLUS 33 more `family` / `given` and 3 `birthDate`
  // written as XML `value` attributes.

  it("reads a name written as a FHIR XML value attribute in a template literal", () => {
    const root = makeRepo();
    writeFileSync(
      join(root, "test", "inline.test.ts"),
      'const xml = `<Patient><name><family value="Nakamura"/></name></Patient>`;\n',
    );

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain("Nakamura");
  });

  it("reads a date of birth and a street address in the XML spelling too", () => {
    const root = makeRepo();
    writeFileSync(
      join(root, "test", "inline.test.ts"),
      'const xml = `<Patient><birthDate value="1961-11-02"/>' +
        '<address><line value="742 Evergreen Terrace"/></address></Patient>`;\n',
    );

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain("1961-11-02");
    expect(r.stderr).toContain("742 Evergreen Terrace");
  });

  it("does not report an entity reference as a person name", () => {
    // The XXE and entity cases in this suite's own XML tests. `amp`, `xxe`,
    // `secret` are entity NAMES, not anybody's name.
    const root = makeRepo();
    writeFileSync(
      join(root, "test", "inline.test.ts"),
      'const xml = `<Patient><name><family value="A&amp;B &lt;x&gt; &#65;&#x42;"/>' +
        '<family value="&xxe;"/><family value="&secret;"/></name></Patient>`;\n',
    );

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
  });

  it("splits on an entity reference rather than deleting it, so a real name still reports", () => {
    const root = makeRepo();
    writeFileSync(
      join(root, "test", "inline.test.ts"),
      'const xml = `<Patient><name><family value="Nakamura&amp;Rodriguez"/></name></Patient>`;\n',
    );

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain("Nakamura");
    expect(r.stderr).toContain("Rodriguez");
  });

  it("does not report a template substitution's expression text as a name", () => {
    const root = makeRepo();
    writeFileSync(
      join(root, "test", "inline.test.ts"),
      "const surname = process.env.X;\nconst p = { name: [{ family: `${surname}` }] };\n",
    );

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
  });

  // THE VALUE READER FAILS TOWARD REPORTING. Each case below was measured
  // reporting NOTHING under a fixed-window reader that ended the array at the
  // first `]` it found: a bracket inside a string or an index expression ended
  // it early and dropped every member after, and a closing bracket past the
  // window dropped them all.
  const readerCases: [string, string, string][] = [
    [
      "a bracket inside an earlier index expression",
      'const p = { name: [{ given: [names[0], "Nakamura"] }] };\n',
      "Nakamura",
    ],
    [
      "a bracket inside the string itself",
      'const p = { address: [{ line: ["742 Evergreen Terrace [Apt 4]"] }] };\n',
      "742 Evergreen Terrace",
    ],
    [
      "a comment between the key and its value",
      'const p = { name: [{ family: /* the surname */ "Nakamura" }] };\n',
      "Nakamura",
    ],
    [
      "an escaped-quote JSON document inside a double-quoted string",
      'const doc = "{\\"resourceType\\":\\"Patient\\",\\"name\\":[{\\"family\\":\\"Nakamura\\"}]}";\n',
      "Nakamura",
    ],
  ];

  for (const [label, body, token] of readerCases) {
    it(`reads the value past ${label}`, () => {
      const root = makeRepo();
      writeFileSync(join(root, "test", "inline.test.ts"), body);

      const r = runIn(root, []);
      expect(r.code, `stderr: ${r.stderr}`).toBe(1);
      expect(r.stderr).toContain(token);
    });
  }

  it("reads a member far past the fixed window the old reader used", () => {
    // THE FILLER IS DIGITS ON PURPOSE, so it contributes no name tokens and the
    // only thing this case can report is the planted member. An earlier version
    // filled with letter-bearing tokens, which reported 800 hits and pushed
    // stderr past 70 KB; the planted name was then the LAST line of a very large
    // pipe, and the assertion went red under CI while the scanner was correct.
    // A case whose signal sits at the end of 70 KB of noise is testing the pipe,
    // not the reader.
    const filler = Array.from({ length: 400 }, () => `"0123456789"`).join(", ");
    const root = makeRepo();
    const body = `const p = { name: [{ given: [${filler}, "Nakamura"] }] };\n`;
    // The premise: the planted member sits well past the 4096-character window
    // the previous reader sliced, which dropped the WHOLE array rather than the
    // tail.
    expect(body.indexOf("Nakamura")).toBeGreaterThan(4096);
    writeFileSync(join(root, "test", "inline.test.ts"), body);

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain("Nakamura");
    expect(r.stderr).toContain("1 hit(s)");
  });

  it("declares the diagnostic form in the allow-list rather than excluding it by shape", () => {
    // `IssueCode@FHIRPath` is one `@` between two dotted tokens and no email
    // recogniser separates it from an address by shape. A shape exclusion was
    // tried and reverted: it covered every capitalised domain in every source
    // target and LOST a hit the scanner already had. One `EMAILDOMAIN` line has
    // a blast radius of one domain, and this asserts both halves of that.
    const root = makeRepo();
    writeFileSync(
      join(root, "test", "inline.test.ts"),
      'const e = ["UNKNOWN_PROPERTY@Patient.name[1]", "JOHN_SMITH@Mercy.org"];\n',
    );

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain("JOHN_SMITH@Mercy.org");
    expect(r.stderr).not.toContain("UNKNOWN_PROPERTY");
  });

  it("keeps that detection on a fixture with an unexpected extension", () => {
    // The route the reverted shape exclusion regressed: `scanTarget` sends any
    // fixture that is not `.json` / `.xml` / `.ndjson` down the same branch as
    // source, so a weakening scoped to "source" reached fixtures too.
    const root = makeRepo();
    writeFileSync(
      join(root, "test", "__fixtures__", "vendor.hl7"),
      "contact JOHN_SMITH@Mercy.org\n",
    );

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain("JOHN_SMITH@Mercy.org");
  });
});

// ---------------------------------------------------------------------------
// The two routes agree about markdown
// ---------------------------------------------------------------------------
//
// The walk exempts `.md` by design: docs may legitimately describe violator
// values. Applying that on one route only made them disagree in BOTH
// directions, and a hook that reds on documentation the sweep exempts is a hook
// that gets bypassed.

describe("phi-scan: the markdown exemption is scan-wide, not per route", () => {
  it("neither route reports a tracked markdown file under test/", () => {
    const root = makeRepo();
    writeFileSync(join(root, "test", "notes.md"), "describes 123-45-6789 as a violator\n");
    git(root, ["add", "test/notes.md"]);

    const staged = runIn(root, ["--staged"]);
    expect(staged.code, `stderr: ${staged.stderr}`).toBe(0);

    const all = runIn(root, []);
    expect(all.code, `stderr: ${all.stderr}`).toBe(0);
  });

  it("but a markdown path named explicitly is still scanned", () => {
    const root = makeRepo();
    writeFileSync(join(root, "test", "notes.md"), "describes 123-45-6789 as a violator\n");

    const r = runIn(root, ["test/notes.md"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Existence is not observation
// ---------------------------------------------------------------------------
//
// `walk` returns silently when its root does not exist and yields nothing when
// the root is an empty directory, so an emptied or deleted `test/__fixtures__`
// printed `OK, no hits` and exited 0 over a corpus still wholly present in the
// index (measured, both cases). A scanned-file COUNT does not detect this: the
// count counts the roots that did exist.

describe("phi-scan: a sweep refuses to report clean over what it never opened", () => {
  function committedRepo(): string {
    const root = makeRepo();
    writeFileSync(
      join(root, "test", "__fixtures__", "patient.json"),
      '{"resourceType":"Patient","name":[{"family":"Chalmers","given":["Peter"]}]}\n',
    );
    git(root, ["add", "src/ordinary.ts", "test/__fixtures__/patient.json"]);
    commit(root, "corpus");
    return root;
  }

  it("passes when every tracked in-scope file was opened", () => {
    const r = runIn(committedRepo(), []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
  });

  it("refuses when a walk root is EMPTIED but its corpus is still in the index", () => {
    const root = committedRepo();
    rmSync(join(root, "test", "__fixtures__", "patient.json"), { force: true });

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("test/__fixtures__/patient.json");
    expect(r.stderr).not.toMatch(/HIT:/);
  });

  it("refuses when a walk root is REMOVED but its corpus is still in the index", () => {
    const root = committedRepo();
    rmSync(join(root, "test", "__fixtures__"), { recursive: true, force: true });

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("test/__fixtures__/patient.json");
  });

  it("names EVERY unobserved path, not just the first", () => {
    const root = committedRepo();
    writeFileSync(join(root, "test", "__fixtures__", "second.json"), "{}\n");
    git(root, ["add", "test/__fixtures__/second.json"]);
    commit(root, "second");
    rmSync(join(root, "test", "__fixtures__"), { recursive: true, force: true });

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("patient.json");
    expect(r.stderr).toContain("second.json");
  });

  it("refuses a sweep that observed no files at all, with no index to consult", () => {
    // The floor underneath the reconciliation: a tree with no repository of its
    // own. `git rev-parse --is-inside-work-tree` is no help, because it answers
    // for the ENCLOSING repository.
    const root = mkdtempSync(join(tmpdir(), "fhir-phi-scan-bare-"));
    repos.push(root);
    mkdirSync(join(root, "scripts"));
    mkdirSync(join(root, "src"));
    mkdirSync(join(root, "test"));
    copyFileSync(
      join(REPO_ROOT, "scripts", "phi-allow-list.txt"),
      join(root, "scripts", "phi-allow-list.txt"),
    );

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("observed no files");
    expect(r.stdout).not.toContain("OK, no hits");
  });

  it("does not refuse over a tracked markdown file, which the walk exempts by design", () => {
    const root = committedRepo();
    writeFileSync(join(root, "test", "NOTES.md"), "describes 123-45-6789 as a violator\n");
    git(root, ["add", "test/NOTES.md"]);
    commit(root, "notes");

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The bytes git carries, as a UNION with the walk
// ---------------------------------------------------------------------------
//
// The walk reads the WORKING TREE, and that is not what a commit contains. Both
// halves were measured on this repository before the index route existed, and
// neither is exotic: a fixture `git add`ed and then scrubbed in the working tree
// scanned clean at exit 0 while `git commit` would have committed the staged
// blob; and 33 tracked non-markdown files sat outside `test/` and `src/`
// altogether, so neither the walk nor `refuseUnobserved` (whose pathspec is
// limited to the walk roots) ever mentioned them.
//
// UNION, NEVER REPLACEMENT. The walk keeps its roots and keeps reading UNTRACKED
// content under them, which the index cannot see; the index route adds every
// blob git carries, wherever it carries it.

describe("phi-scan: the sweep reads the bytes git carries, as a union with the walk", () => {
  /** A committed corpus with one fixture and one source file, both clean. */
  function corpus(): string {
    const root = makeRepo();
    writeFileSync(
      join(root, "test", "__fixtures__", "patient.json"),
      '{"resourceType":"Patient","name":[{"family":"Chalmers","given":["Peter"]}]}\n',
    );
    git(root, ["add", "src/ordinary.ts", "test/__fixtures__/patient.json"]);
    commit(root, "corpus");
    return root;
  }

  it("reads a staged blob whose working-tree copy has been scrubbed clean (exit 1)", () => {
    const root = corpus();
    const rel = "test/__fixtures__/probe.json";
    writeFileSync(
      join(root, rel),
      '{"resourceType":"Patient","name":[{"family":"Rivera","given":["Juanita"]}],"birthDate":"1978-03-14"}\n',
    );
    git(root, ["add", rel]);
    // The working tree now says nothing; the index still carries the names, and
    // the index is what a commit would contain.
    writeFileSync(join(root, rel), '{"resourceType":"Patient"}\n');

    const r = runIn(root, []);
    expect(r.code, `stdout: ${r.stdout} stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain(`${rel} (as git carries it)`);
    expect(r.stderr).toContain("Rivera");
  });

  it("reads a tracked file that sits outside every walk root (exit 1)", () => {
    const root = corpus();
    mkdirSync(join(root, "docs-content"), { recursive: true });
    writeFileSync(join(root, "docs-content", "leak.json"), "SSN: 123-45-6789\n");
    git(root, ["add", "docs-content/leak.json"]);

    const r = runIn(root, []);
    expect(r.code, `stdout: ${r.stdout} stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain("docs-content/leak.json (as git carries it)");
  });

  it("still reads UNTRACKED working-tree content, which the index cannot see (exit 1)", () => {
    const root = corpus();
    // Never `git add`ed: the index has no record of it at all, so only the walk
    // can reach it. This is the half that makes the two routes a union.
    writeFileSync(join(root, "test", "__fixtures__", "untracked.json"), "SSN: 123-45-6789\n");

    const r = runIn(root, []);
    expect(r.code, `stdout: ${r.stdout} stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain("HIT: test/__fixtures__/untracked.json\n");
    expect(r.stderr).not.toContain("test/__fixtures__/untracked.json (as git carries it)");
  });

  it("reads nothing twice: an unmodified tracked file is reported once, not once per route", () => {
    const root = corpus();
    const rel = "test/__fixtures__/probe.json";
    writeFileSync(join(root, rel), "SSN: 123-45-6789\n");
    git(root, ["add", rel]);
    // Working tree and index hold the SAME bytes, so they are one blob under
    // git's `blob <len>\0` framing and the index copy is never fetched.
    const r = runIn(root, []);
    expect(r.code, `stdout: ${r.stdout} stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain(`HIT: ${rel}\n`);
    expect(r.stderr).not.toContain(`${rel} (as git carries it)`);
    expect(r.stderr).toContain("1 hit(s) across 1 file(s)");
  });

  it("identical bytes at two paths with the SAME detector are one blob, and the gate still reds", () => {
    // The consequence that REMAINS after the key carries the detector, stated
    // narrowly: two in-scope paths whose bytes AND detector agree are one
    // object, so the hit is reported at whichever the sweep read first. The
    // exit code is unaffected, and fixing the reported copy leaves the other
    // object unobserved, so the next run names it -- convergent and loud, never
    // a silent pass.
    const root = corpus();
    mkdirSync(join(root, "docs-content"), { recursive: true });
    writeFileSync(join(root, "test", "a.ts"), "SSN: 123-45-6789\n"); // walked; source pass
    writeFileSync(join(root, "docs-content", "b.ts"), "SSN: 123-45-6789\n"); // index only; source pass
    git(root, ["add", "test/a.ts", "docs-content/b.ts"]);

    const r = runIn(root, []);
    expect(r.code, `stdout: ${r.stdout} stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain("1 hit(s) across 1 file(s)");
    expect(r.stderr).toContain("HIT: test/a.ts");

    // And it converges: fix the reported copy, and the next run names the other.
    writeFileSync(join(root, "test", "a.ts"), "clean\n");
    git(root, ["add", "test/a.ts"]);
    const again = runIn(root, []);
    expect(again.code, `stdout: ${again.stdout} stderr: ${again.stderr}`).toBe(1);
    expect(again.stderr).toContain("docs-content/b.ts (as git carries it)");
  });

  it("a declared SENTINEL's bytes vouch for nothing: an identical copy is still scanned", () => {
    // A sentinel is exempt BECAUSE it carries realistic-PHI-shaped strings, and
    // `main` drops it before any detector runs. Letting it into the observed set
    // would dedup away an identical copy at a path with no exemption -- and not
    // convergently either, since a sentinel is never "fixed".
    const root = corpus();
    mkdirSync(join(root, "docs-content"), { recursive: true });
    writeFileSync(join(root, "test", "phi-leak.test.ts"), "SSN: 123-45-6789\n");
    writeFileSync(join(root, "docs-content", "copy.ts"), "SSN: 123-45-6789\n");
    git(root, ["add", "test/phi-leak.test.ts", "docs-content/copy.ts"]);

    const r = runIn(root, []);
    expect(r.code, `stdout: ${r.stdout} stderr: ${r.stderr}`).toBe(1);
    expect(r.stdout).toContain("test/phi-leak.test.ts");
    expect(r.stderr).toContain("docs-content/copy.ts (as git carries it)");
    // The exemption is still ANNOUNCED, and exactly once, though the path now
    // reaches the sweep from two enumerations.
    expect(r.stdout.match(/test\/phi-leak\.test\.ts/g)?.length).toBe(1);
  });

  it("the dedup key carries the DETECTOR, so a source file cannot vouch for a fixture blob", () => {
    // `scanTarget` sends a fixture to the structured FHIR scan and a `.ts` file
    // to the source pass, and the source pass deliberately does not key
    // `identifier.value` or `telecom.value`. An oid-only key would apply the
    // weakest detector any path holding those bytes gets.
    const root = corpus();
    const doc =
      '{"resourceType":"Patient",' +
      '"identifier":[{"system":"http://hl7.org/fhir/sid/us-ssn","value":"123456789"}],' +
      '"telecom":[{"system":"phone","value":"617-432-1000"}]}\n';
    writeFileSync(join(root, "test", "__fixtures__", "leak.json"), doc);
    writeFileSync(join(root, "src", "decoy.ts"), doc);
    git(root, ["add", "test/__fixtures__/leak.json", "src/decoy.ts"]);
    // Only the fixture's working copy is scrubbed, so the fixture blob is
    // reachable through the index alone -- and `src/decoy.ts` holds those very
    // bytes on disk, where the source pass reads neither field.
    writeFileSync(join(root, "test", "__fixtures__", "leak.json"), '{"resourceType":"Patient"}\n');

    const r = runIn(root, []);
    expect(r.code, `stdout: ${r.stdout} stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain("test/__fixtures__/leak.json (as git carries it)");
    expect(r.stderr).toContain("Patient.identifier.value");
    expect(r.stderr).toContain("Patient.telecom.value");
  });

  it("scans BOTH copies when they differ only by line endings (the EOL axis)", () => {
    const root = corpus();
    const rel = "test/__fixtures__/probe.json";
    const abs = join(root, rel);
    writeFileSync(abs, '{"resourceType":"Patient","name":[{"family":"Rivera"}]}\n');
    git(root, ["add", rel]);
    // The same document, byte-for-byte, except for the line endings and one
    // name. A path-keyed dedup would pick one of these and call it the corpus.
    writeFileSync(abs, '{"resourceType":"Patient","name":[{"family":"Okonkwo"}]}\r\n');

    const r = runIn(root, []);
    expect(r.code, `stdout: ${r.stdout} stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain("Okonkwo"); // the CRLF working-tree copy
    expect(r.stderr).toContain("Rivera"); // the LF blob git carries
    expect(r.stderr).toContain(`${rel} (as git carries it)`);
  });

  it("refuses a tracked gitlink OUTSIDE every walk root, naming its kind (exit 2)", () => {
    const root = corpus();
    git(root, [
      "update-index",
      "--add",
      "--cacheinfo",
      "160000,0000000000000000000000000000000000000001,vendor/sub",
    ]);

    const r = runIn(root, []);
    expect(r.code, `stdout: ${r.stdout} stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("vendor/sub");
    expect(r.stderr).toContain("gitlink");
    expect(r.stderr).not.toMatch(/HIT:/);
  });

  it("refuses a tracked symbolic link OUTSIDE every walk root, and echoes no target (exit 2)", () => {
    const root = corpus();
    mkdirSync(join(root, "docs-content"), { recursive: true });
    symlinkSync(join("..", TARGET_NAME), join(root, "docs-content", "link.json"));
    git(root, ["add", "docs-content/link.json"]);

    const r = runIn(root, []);
    expect(r.code, `stdout: ${r.stdout} stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("docs-content/link.json");
    expect(r.stderr).toContain("a symbolic link");
    expectNoPhi(r.stderr);
  });

  it("does not read a tracked markdown blob either: the exemption is scan-wide", () => {
    const root = corpus();
    writeFileSync(join(root, "NOTES.md"), "describes 123-45-6789 as a violator\n");
    git(root, ["add", "NOTES.md"]);

    const r = runIn(root, []);
    expect(r.code, `stdout: ${r.stdout} stderr: ${r.stderr}`).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// An unmerged path in all-mode: key on the ABSENCE OF STAGE 0
// ---------------------------------------------------------------------------
//
// `git diff --cached --raw` reports an unmerged path with status `U` and
// destination mode `000000`, which is how `--staged` spots it. `git ls-files -s`
// reports the SAME path at stages 1/2/3 with ORDINARY blob modes and no `U`
// anywhere, so a reader that takes the first record it sees gets STAGE 1, THE
// MERGE BASE, and reports on it as though it were what git carries. Every stage
// is read and every stage is labelled with its own number, so none of them can
// be silently promoted to "the" index copy.

describe("phi-scan: an unmerged path in all-mode is read at every stage", () => {
  function conflicted(root: string, rel: string, blobs: [string, string, string]): void {
    const info = blobs
      .map((content, i) => {
        const oid = spawnSync("git", ["hash-object", "-w", "--stdin"], {
          cwd: root,
          input: content,
          encoding: "utf8",
          shell: false,
        }).stdout.trim();
        return `100644 ${oid} ${String(i + 1)}\t${rel}`;
      })
      .join("\n");
    const r = spawnSync("git", ["update-index", "--index-info"], {
      cwd: root,
      input: info + "\n",
      encoding: "utf8",
      shell: false,
    });
    if ((r.status ?? -1) !== 0) throw new Error(`update-index failed: ${r.stderr}`);
  }

  it("finds a payload living ONLY in stage 3, and names the stage (exit 1)", () => {
    const root = makeRepo();
    git(root, ["add", "src/ordinary.ts"]);
    commit(root, "corpus");
    const rel = "test/__fixtures__/probe.json";
    conflicted(root, rel, [
      '{"resourceType":"Patient","id":"base"}\n',
      '{"resourceType":"Patient","id":"ours"}\n',
      '{"resourceType":"Patient","name":[{"family":"Rivera"}]}\n',
    ]);
    writeFileSync(join(root, rel), '{"resourceType":"Patient","id":"merged"}\n');

    const r = runIn(root, []);
    expect(r.code, `stdout: ${r.stdout} stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain(`${rel} (index stage 3)`);
    expect(r.stderr).toContain("Rivera");
    // The merge base is never labelled as what git carries.
    expect(r.stderr).not.toContain(`${rel} (as git carries it)`);
  });

  it("labels the MERGE BASE as stage 1 rather than as what git carries (exit 1)", () => {
    const root = makeRepo();
    git(root, ["add", "src/ordinary.ts"]);
    commit(root, "corpus");
    const rel = "test/__fixtures__/probe.json";
    conflicted(root, rel, [
      '{"resourceType":"Patient","name":[{"family":"Okonkwo"}]}\n',
      '{"resourceType":"Patient","id":"ours"}\n',
      '{"resourceType":"Patient","id":"theirs"}\n',
    ]);
    writeFileSync(join(root, rel), '{"resourceType":"Patient","id":"merged"}\n');

    const r = runIn(root, []);
    expect(r.code, `stdout: ${r.stdout} stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain(`${rel} (index stage 1)`);
    expect(r.stderr).not.toContain(`${rel} (as git carries it)`);
  });

  it("the --staged route still REFUSES over the same index, which is unchanged (exit 2)", () => {
    const root = makeRepo();
    git(root, ["add", "src/ordinary.ts"]);
    commit(root, "corpus");
    const rel = "test/__fixtures__/probe.json";
    conflicted(root, rel, [
      '{"resourceType":"Patient","id":"base"}\n',
      '{"resourceType":"Patient","id":"ours"}\n',
      '{"resourceType":"Patient","name":[{"family":"Rivera"}]}\n',
    ]);

    const r = runIn(root, ["--staged"]);
    expect(r.code, `stdout: ${r.stdout} stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("unmerged");
    expectNoPhi(r.stderr);
  });
});

// ---------------------------------------------------------------------------
// THE POSITIVE CONTROL
// ---------------------------------------------------------------------------
//
// A gate never seen red is indistinguishable from one that cannot go red, and
// this class of defect is exactly a gate reporting `OK, no hits` over a corpus
// it never opened. So the control is built from THIS repository's own tracked
// path list rather than from a hand-written sample: same paths, same directory
// shapes, same extensions, same walk-root / outside-walk-root split. It answers
// the only question that matters about a green run, which is whether the sweep
// can fire on the corpus it claims to clear.
//
// The mirror carries placeholder bytes, not this repository's content, so no
// fixture is copied anywhere and nothing here can leak the corpus.

describe("phi-scan: the positive control fires on this repository's own corpus shape", () => {
  const SENTINELS = new Set([
    "test/phi-leak.test.ts",
    "test/scripts/phi-scan.test.ts",
    "scripts/phi-scan.ts",
  ]);
  const ALLOW_LIST_REL = "scripts/phi-allow-list.txt";

  /** Every path this repository tracks, forward-slash, in index order. */
  function realTrackedPaths(): string[] {
    return gitOut(REPO_ROOT, ["ls-files", "-z"])
      .split("\0")
      .filter((p) => p.length > 0);
  }

  /** A repo with THIS repository's paths and placeholder contents. */
  function mirror(contentFor: (path: string) => string): { root: string; paths: string[] } {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "fhir-phi-scan-mirror-")));
    repos.push(root);
    const paths = realTrackedPaths();
    for (const rel of paths) {
      const abs = join(root, ...rel.split("/"));
      mkdirSync(join(abs, ".."), { recursive: true });
      writeFileSync(abs, contentFor(rel));
    }
    git(root, ["init", "-q", "."]);
    // A throwaway repo runs no hooks. The mirror reproduces every tracked path,
    // `.npmrc` among them, and a developer machine or CI image may carry a
    // global pre-commit hook with an opinion about such a filename. That is an
    // opinion about the developer's environment, not about this scanner.
    git(root, ["config", "core.hooksPath", join(root, ".no-hooks")]);
    git(root, ["add", "-A"]);
    commit(root, "mirror");
    return { root, paths };
  }

  /** The real allow-list, so the scanner can start; placeholder for everything else. */
  const REAL_ALLOW_LIST = readFileSync(join(REPO_ROOT, ALLOW_LIST_REL), "utf8");
  const clean = (rel: string): string =>
    rel === ALLOW_LIST_REL ? REAL_ALLOW_LIST : "placeholder\n";

  it("mirrors a corpus the scanner CLEARS, so a hit below is the payload and not the shape", () => {
    const { root, paths } = mirror(clean);
    expect(paths.length).toBeGreaterThan(100);

    const r = runIn(root, []);
    expect(r.code, `stdout: ${r.stdout} stderr: ${r.stderr}`).toBe(0);
    expect(r.stdout).toContain("OK, no hits");
  });

  /**
   * How many payload-bearing paths ONE run of the control is allowed to report.
   *
   * THE CONTROL'S QUESTION IS "DID THE SWEEP OPEN THIS PATH", AND IT READS THE
   * ANSWER OFF A REPORT DELIVERED THROUGH A PIPE, WHICH IS A SECOND VARIABLE.
   * The scanner ends in `process.exit(exitCode)`, and `process.exit()` discards
   * writes still pending on a pipe, so a report large enough to outrun its
   * reader loses its TAIL -- and a missing tail is indistinguishable here from a
   * sweep that stopped early. That is measured, not hypothetical: with the
   * payload at every non-exempt path at once the report runs to tens of
   * kilobytes, and this case came back with 129 of 199 paths named on Node 24
   * while the Node 22 runner at the SAME commit, and every local run, were
   * green. The reading "the walk stopped partway through `src/`" was wrong; the
   * WRITE stopped.
   *
   * So the corpus is swept in BOUNDED BATCHES. Nothing is sampled and nothing
   * leaves the expected set -- every non-exempt tracked path is still asserted
   * to be named, and every exempt one is still asserted to be silent WHILE hits
   * are being reported -- but no single run emits a report big enough for a pipe
   * to have an opinion about it. `REPORT_CEILING` is asserted per run so the
   * bound stays real: it is one page, the smallest buffer Linux hands a pipe
   * when a machine is under pressure, and a batch's report measures well under
   * half of it. Widen the payload or the per-hit output far enough and this reds
   * instead of going flaky again.
   *
   * DO NOT CONCLUDE FROM ANY OF THIS THAT `spawnSync` CANNOT SEE THE
   * TRUNCATION, OR THAT A CONTROL BUILT ON IT WOULD BE VACUOUS. This control is
   * built on `spawnSync` (`runIn`) and it is precisely what caught the defect.
   * The truncation is a race, so what a `spawnSync` reader sees is
   * NON-DETERMINISTIC -- which is a reason to keep the report bounded HERE, and
   * no reason at all to weaken or abandon the control.
   */
  const BATCH_PATHS = 8;
  const REPORT_CEILING = 4096;

  it("fires on EVERY tracked path that is not exempt", () => {
    // THE PAYLOAD IS MADE UNIQUE PER PATH ON PURPOSE. Dedup is by CONTENT under
    // git's own blob framing, so ONE payload written to EVERY path is ONE blob,
    // scanned once and reported at one path -- correct behaviour, and it would
    // make this case assert nothing about any of the others. Suffixing the path
    // gives every file its own object, which is what the corpus really looks
    // like.
    //
    // NO COUNT IS WRITTEN HERE, DELIBERATELY. This comment carried two ("248
    // paths", "the other 247"): the count at the BASE commit, which this slice's
    // own three added files falsified before it shipped. The mirror is built
    // from `git ls-files` at run time, so any count here is a claim about a
    // corpus that moves. The assertions below are count-free for the same
    // reason: they derive the expected set from `paths` and only floor it.
    const payloadFor = (rel: string): string => `${SYNTHETIC_PHI}at ${rel}\n`;

    const all = realTrackedPaths();
    // Markdown is exempt scan-wide and the three sentinel files are declared, so
    // those are the paths a green run is ALLOWED to say nothing about. Every
    // other tracked path must appear.
    const exempt = new Set(all.filter((p) => p.toLowerCase().endsWith(".md") || SENTINELS.has(p)));
    const expected = all.filter((p) => !exempt.has(p));
    expect(expected.length).toBeGreaterThan(100);

    const missed: string[] = [];
    for (let i = 0; i < expected.length; i += BATCH_PATHS) {
      const batch = new Set(expected.slice(i, i + BATCH_PATHS));
      // EVERY EXEMPT PATH CARRIES THE PAYLOAD IN EVERY RUN, not just in one of
      // them: the exempt paths have to be silent WHILE the scanner is reporting,
      // or "silent" would only mean "silent in a run with nothing to say". They
      // cost the report nothing, which is what lets them ride along in a batch.
      const { root } = mirror((rel) => {
        if (!batch.has(rel) && !exempt.has(rel)) return clean(rel);
        const payload = payloadFor(rel);
        return rel === ALLOW_LIST_REL ? `${REAL_ALLOW_LIST}\n${payload}` : payload;
      });

      const r = runIn(root, []);
      expect(r.code, `stdout: ${r.stdout} stderr: ${r.stderr}`).toBe(1);
      // The exempt ones really are silent, which is what makes the list below a
      // measurement rather than a tautology. Asserted BEFORE the bound: an
      // exemption that stopped holding blows the report up too, and it should
      // report as itself rather than as a budget overrun.
      for (const p of exempt) expect(r.stderr).not.toContain(`HIT: ${p}`);
      // `HIT: ${p}` rather than a bare substring: a tracked path can be a prefix
      // of another (`README.md` of `.changeset/README.md`), and a bare
      // `includes` would then let one path's hit stand in for the other's.
      for (const p of batch) if (!r.stderr.includes(`HIT: ${p}`)) missed.push(p);
      expect(
        Buffer.byteLength(r.stderr),
        "a run's report outgrew the bound that keeps this case deterministic",
      ).toBeLessThan(REPORT_CEILING);
    }
    expect(missed, `paths the sweep never reported: ${missed.join(", ")}`).toEqual([]);
  }, 180_000);

  it("fires on a path outside every walk root through the INDEX, not the walk", () => {
    // The sharp half: with the payload only in the blob, the working tree is
    // clean everywhere and the walk has nothing to find outside its roots.
    const { root, paths } = mirror(clean);
    const outside = paths.filter(
      (p) =>
        !p.startsWith("test/") &&
        !p.startsWith("src/") &&
        !p.toLowerCase().endsWith(".md") &&
        !SENTINELS.has(p) &&
        p !== ALLOW_LIST_REL,
    );
    expect(outside.length).toBeGreaterThan(10);
    const rel = outside[0] ?? "";
    const abs = join(root, ...rel.split("/"));
    writeFileSync(abs, SYNTHETIC_PHI);
    git(root, ["add", rel]);
    writeFileSync(abs, "placeholder\n"); // scrub the working tree

    const r = runIn(root, []);
    expect(r.code, `stdout: ${r.stdout} stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain(`${rel} (as git carries it)`);
  });
});
