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
// one thing every case below depends on: the walk roots and the `--staged`
// scope. This package's fixture root is `test/__fixtures__`; a sibling's is
// `test/fixtures`. A case that quietly ran a sibling's scanner, or a scanner
// whose scope had drifted to a sibling's, would pass its refusal assertions
// while proving nothing about this gate.

describe("phi-scan: the scanner under test is this package's", () => {
  it("scopes to test/__fixtures__, and a sibling's test/fixtures is out of scope", () => {
    const source = readFileSync(SCANNER_PATH, "utf8");
    expect(source).toContain("@cosyte/fhir");
    expect(source).toContain('"__fixtures__"');

    // The behavioural half: a staged link at a SIBLING's fixture root draws no
    // refusal here, because that path is not in this package's staged scope.
    const root = makeRepo();
    mkdirSync(join(root, "test", "fixtures"), { recursive: true });
    symlinkSync(join("..", "..", TARGET_NAME), join(root, "test", "fixtures", "patient.json"));
    git(root, ["add", "test/fixtures/patient.json"]);

    const r = runIn(root, ["--staged"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
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

  it("PRE-EXISTING: an all-mode sweep that observed nothing still reports OK", () => {
    // A sibling refuses a sweep that read no files at all. That rule was never
    // ported here, and this change does not soften anything: it is simply not
    // present. Pinned so the gap is a measured fact rather than a sentence.
    const root = makeRepo();
    rmSync(join(root, "src"), { recursive: true, force: true });
    rmSync(join(root, "test"), { recursive: true, force: true });

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
    expect(r.stdout).toMatch(/OK, no hits/);
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

  it("DISCLOSED GAP: a regular BLOB at the fixture root gets the shape pass, not the FHIR scan", () => {
    // What admitting the path buys is the MODE check, above. It does not buy the
    // structured scan: `scanTarget` computes `isFixture` from
    // `startsWith("test/__fixtures__/")`, with a trailing slash, so the root's
    // own path can never reach the FHIR-aware branch. Recorded in
    // `phi-scan-overrides.md` and pinned here so it stays a measured fact rather
    // than a sentence. NOT a regression: base did not admit the path at all.
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

    // The gap: a name absent from the allow-list is not read at this path.
    const r = runIn(root, ["--staged"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);

    // And the control that makes that meaningful: the SAME resource one level
    // inside the root IS caught, so the payload is genuinely detectable and it is
    // the trailing slash that decides.
    const inner = makeRepo();
    writeFileSync(
      join(inner, "test", "__fixtures__", "patient.json"),
      JSON.stringify({
        resourceType: "Patient",
        name: [{ family: "Okonkwo", given: ["Chidinma"] }],
        birthDate: "1961-11-02",
      }),
    );
    git(inner, ["add", "test/__fixtures__/patient.json"]);
    const r2 = runIn(inner, ["--staged"]);
    expect(r2.code, `stderr: ${r2.stderr}`).toBe(1);
    expect(r2.stderr).toContain("Okonkwo");
  });

  it("DISCLOSED GAP: a scan root's PARENT staged as a link defeats both routes", () => {
    // The same shape one directory up, and unchanged by this slice: `test` is
    // matched by neither `===` nor either prefix, and the all-mode walk returns
    // silently because `existsSync(test/__fixtures__)` is false. Pinned so the
    // gap is a measured fact rather than a sentence.
    const root = makeRepo();
    writeFileSync(join(root, "src", "ordinary.ts"), "export const answer = 42;\n");
    git(root, ["add", "src/ordinary.ts"]);
    commit(root, "base");

    rmSync(join(root, "test"), { recursive: true, force: true });
    symlinkSync(TARGET_NAME, join(root, "test"));
    git(root, ["add", "test"]);
    expect(gitOut(root, ["ls-files", "--stage", "test"])).toMatch(/^120000 /);

    expect(runIn(root, ["--staged"]).code).toBe(0);
    expect(runIn(root, []).code).toBe(0);
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
