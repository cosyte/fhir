#!/usr/bin/env tsx
/**
 * `@cosyte/fhir` PHI scanner, the CI / pre-commit half of the PHI commit-gate.
 *
 * Pure Node. Zero runtime deps (it does NOT import the package's own codec, a
 * commit gate must run without a build and must tolerate the malformed /
 * fragmentary document a real leaked resource arrives as, which the strict codec
 * would reject). Walks the synthetic FHIR test fixtures (`test/__fixtures__/`,
 * the full structured scan) and a conservative text pass over `src/`, and
 * REFUSES anything that looks like real PHI, so a developer cannot commit a
 * real-looking FHIR resource by accident.
 *
 * A FHIR resource carries PHI by design (patient names, dates of birth, SSNs,
 * MRNs, addresses, phones / emails). Unlike a byte-strict HL7 v2 message a JSON
 * resource *could* carry an inline `"_synthetic": true` marker, but that would
 * corrupt the very round-trip the fixtures prove, so we use the same proven
 * mechanism the byte-strict siblings (`dicom` `.dcm`, `x12` `.edi`) use: a
 * **synthetic allow-list** (`scripts/phi-allow-list.txt`) is the positive
 * declaration that a fixture's identifiers are fake. Any realistic-PHI-shaped
 * token not covered by the allow-list is a hit. Adding a new synthetic fixture
 * therefore means either reusing known-synthetic tokens or consciously extending
 * the allow-list, a reviewed act, never silent.
 *
 * Detection is FHIR-shape-aware, NOT a blind text regex: the scanner parses each
 * resource (JSON / NDJSON) or scans the element/value-attribute pairs (XML) and
 * inspects only the elements that actually carry each PHI category, keyed by the
 * FHIR element name (`name` HumanName, `birthDate`, `telecom`, `address`,
 * `identifier`). That is deliberate, a `name` that is a plain string
 * (`Organization.name`, `StructureDefinition.name`) is a resource label, not a
 * person, and is never name-scanned; only a HumanName object/array is. See
 * `phi-scan-overrides.md` for the category → element map and the limitations.
 *
 * SECURITY: every subprocess is `git`, invoked via `execFileSync` with array
 * args only. Never shell-form spawn.
 *
 * Modes:
 *   --staged                 - scan only files staged in `git diff --cached`
 *   --allow-fixture <path>   - bypass one path; rejected unless logged in
 *                              phi-scan-overrides.md
 *   <path> [<path>...]       - scan specific paths
 *   (no args)                - scan all in-scope working-tree files
 *
 * Exit codes: 0 (clean), 1 (hits found), 2 (invocation error).
 *
 * ---------------------------------------------------------------------------
 * THE SWEEP READS THE BYTES GIT CARRIES AS A UNION WITH THE WALK. A walk reads
 * the WORKING TREE, and that is not what a commit contains: a fixture `git
 * add`ed and then scrubbed on disk scanned clean at exit 0 while `git commit`
 * would have committed the staged blob (measured). And the walk has ROOTS, so 33
 * tracked non-markdown files outside `test/` and `src/` were opened by no route
 * at all, two of them carrying bytes these recognisers report (measured).
 *
 * So `all` mode enumerates BOTH: the walk, which alone can see UNTRACKED
 * working-tree content, and every blob the index carries, which alone can see
 * what is staged and what lives outside the roots. Neither replaces the other.
 * Dedup is BY CONTENT under git's own `blob <len>\0` framing, so an ordinary
 * clean checkout SCANS nothing twice; where the two copies of one path DIFFER,
 * BOTH are scanned, which is what makes a CRLF working tree over an LF blob two
 * byte streams rather than one. `cat-file` IS invoked on a clean checkout, for
 * the blobs no walk root covers and for the declared paths below: the property
 * is that nothing is scanned twice, never that git goes unasked.
 * ---------------------------------------------------------------------------
 * AN ENUMERATED IN-SCOPE ENTRY THAT IS NOT A REGULAR FILE REFUSES THE SCAN
 * (exit 2). "Enumerated" is load-bearing and is not decoration: this narrows
 * what each route ADMITS from what that route already LISTS, so an entry a route
 * never lists is not reached by the refusal either. Do not restate this as
 * "every non-regular entry".
 *
 * `--staged` USED NOT TO LIST A RENAME AT ALL, and that was the hole this
 * paragraph once wrote down as a standing residual. It is closed by
 * `--no-renames`, not by handling a two-path record: see `buildTargetsForStaged`
 * for why that is a strict widening of the enumeration and costs the stride
 * nothing.
 *
 * Within that, such an entry is never silently skipped, because BOTH enumerating
 * routes are blind to one in a way that reads as clean:
 *
 *   - the walk enumerates `Dirent.isFile()`, which is an lstat answer, so a
 *     symbolic link is neither a file nor a directory and used to fall out of
 *     the loop silently, whatever it pointed at. `isDirectory()` is an lstat
 *     answer too, so a linked DIRECTORY took a whole subtree with it;
 *   - `--staged` reads content with `git show :<path>`, and git stores a
 *     symbolic link as its TARGET PATH under mode 120000, so that route is
 *     handed the path text and never the target's bytes.
 *
 * So a link under a scan root pointing at a PHI-bearing file scanned CLEAN on
 * both. Neither route is made to follow it: following would read bytes the
 * enumeration does not control (outside the repo, a loop, a device, a FIFO that
 * blocks the gate forever), and git does not carry those bytes anyway, so a hit
 * on them would be a claim about something no commit contains. Refusing states
 * the only true thing available: there is an entry here the scan cannot account
 * for, so the scan is not clean.
 *
 * "In scope" is each route's own existing boundary: the walk still excludes a
 * gitignored entry (the same rule that already excludes a gitignored file, so
 * links do not get a second, stricter boundary of their own), and `--staged`
 * still only looks at `test/__fixtures__/**` and `src/**.ts`.
 *
 * TWO PLACES THE `--staged` BOUNDARY MOVED, called out rather than folded into
 * "narrowing", because both admit MORE than before and both are the same
 * entry-shape this banner is about reached by a route the old test did not
 * cover: rename detection is off, so a rename DESTINATION now arrives as an
 * ordinary single-path add instead of vanishing with its two-path record; and
 * each scan root's OWN path is in scope as well as its contents. Everything
 * else narrows what the scopes ADMIT rather than widening the scopes.
 *
 * A refusal names the entry's own repo-relative path and an engine-owned token
 * for its kind. IT NEVER REPORTS THE LINK TARGET, which is text off the working
 * tree and can itself carry PHI: a target path of the shape
 * `../patients/<surname>-<given>-<dob>.txt` is the whole reason. The shape is
 * written out rather than an example, because a diagnostic ABOUT a PHI leak is
 * itself a PHI surface, and that applies to the prose explaining it too.
 * ---------------------------------------------------------------------------
 */

import { readFileSync, statSync, existsSync, readdirSync, type Dirent } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join, resolve, relative, sep, isAbsolute } from "node:path";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const REPO_ROOT = process.cwd();
const ALLOW_LIST_PATH = join(REPO_ROOT, "scripts", "phi-allow-list.txt");
const OVERRIDE_LOG_PATH = join(REPO_ROOT, "phi-scan-overrides.md");

// Roots walked in "all" mode. `test/__fixtures__/**` gets the full FHIR-aware
// scan by wire-format extension; everything else in scope gets the source pass
// (dashed SSN + non-test email + the FHIR-keyed literal recogniser below).
//
// `test` IS THE ROOT, NOT `test/__fixtures__`, AND THAT IS A WIDENING WITH A
// MEASUREMENT BEHIND IT. The roots used to be `test/__fixtures__` and `src`, so
// a tracked file directly under `test/` was reached by NEITHER route: 55 of them
// here. Counted with this scanner's own key regex over those 55 files, 87
// object-literal `family` / `given` sites and 21 `birthDate` sites, plus 33 more
// `family` / `given` and 3 `birthDate` spelled as XML `value` attributes. The old comment justified the exclusion by the
// PHI-leak suite's sentinel battery, and that justification covers TWO files
// (`test/phi-leak.test.ts`, `test/scripts/phi-scan.test.ts`), not the other 53.
// Those two are declared by path below, which is a reviewed exemption with an
// audit trail rather than a silent hole across a whole directory.
const TEST_ROOT = join(REPO_ROOT, "test");
const SRC_ROOT = join(REPO_ROOT, "src");
const WALK_ROOTS = [TEST_ROOT, SRC_ROOT];

/** Repo-relative prefix whose contents get the structured FHIR scan. */
const FIXTURE_PREFIX = "test/__fixtures__/";

// Files whose whole POINT is to carry realistic-PHI-shaped strings: the
// redaction-contract sentinel battery, and this scanner's own test, which must
// spell out the values it is meant to catch. Scanning them would flag the very
// sentinels that exist to be flagged. Declared HERE, by exact path, rather than
// by directory: a new test file under `test/` is in scope by default, and adding
// to this set is a reviewed act recorded in `phi-scan-overrides.md`.
//
// This is NOT the `--allow-fixture` mechanism. That one is a caller's per-run
// bypass and needs a flag; CI runs the scan with no flags, so a bypass that only
// exists on the command line would leave both files unscanned in exactly the
// route that matters.
//
// `scripts/phi-scan.ts` JOINED THEM WHEN THE INDEX ROUTE BROUGHT IT INTO SCOPE,
// and the alternative was measurably worse. Its docblocks have to spell out the
// violator values they explain, and one of them is `JOHN_SMITH@Mercy.org`, the
// example recording why a shape-based email exclusion was reverted. The
// token-level remedy would be `EMAILDOMAIN mercy.org`, and an allow-list entry is
// GLOBAL and ROUTE-BLIND: it would admit that domain in a fixture too, and
// `Mercy.org` is a plausible real hospital. A literal path is the narrower of the
// two. It is not a new blind spot -- this file sits outside every walk root and
// no route opened it at all before -- but it is a declared one, logged in
// `phi-scan-overrides.md` like the other two.
const SENTINEL_FILES = new Set<string>([
  "test/phi-leak.test.ts",
  "test/scripts/phi-scan.test.ts",
  "scripts/phi-scan.ts",
]);

// Name tokens that are honorific / degree / suffix codes, never a person's
// identifying name, extracted alongside real name tokens and skipped.
const NAME_NOISE_TOKENS = new Set<string>([
  "MD",
  "DO",
  "DR",
  "MR",
  "MRS",
  "MS",
  "MISS",
  "JR",
  "SR",
  "II",
  "III",
  "IV",
  "RN",
  "NP",
  "PA",
  "PHD",
  "DDS",
  "DMD",
  "ESQ",
  "PROF",
  "FNP",
  "APRN",
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Hit {
  path: string;
  location: string; // FHIR element path (e.g. "Patient.name.family") or "(ssn)"
  value: string;
  reason: string;
}

interface AllowList {
  /** Uppercase synthetic person-name tokens (HumanName family / given / text). */
  names: Set<string>;
  /** Synthetic dates of birth, normalized (YYYYMMDD / YYYYMM / YYYY). */
  dobs: Set<string>;
  /** Synthetic street-address lines (Address.line), lower-cased. */
  addresses: Set<string>;
  /** Synthetic id values that legitimately match an SSN / bare-9-digit shape. */
  ids: Set<string>;
  /** Allowed email domains (anything else is a hit). */
  emailDomains: Set<string>;
}

interface Args {
  mode: "all" | "staged" | "paths";
  paths: string[];
  allowFixtures: string[];
}

class InvocationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvocationError";
  }
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): Args {
  let staged = false;
  const paths: string[] = [];
  const allowFixtures: string[] = [];
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a === "--") {
      for (let j = i + 1; j < argv.length; j += 1) {
        const v = argv[j];
        if (v !== undefined) paths.push(v);
      }
      break;
    } else if (a === "--staged") {
      staged = true;
      i += 1;
    } else if (a === "--allow-fixture") {
      const next = argv[i + 1];
      if (next === undefined) {
        throw new InvocationError("--allow-fixture requires a path argument");
      }
      allowFixtures.push(next);
      i += 2;
    } else if (a !== undefined && a.startsWith("--")) {
      throw new InvocationError(`Unknown flag: ${a}`);
    } else if (a !== undefined) {
      paths.push(a);
      i += 1;
    } else {
      i += 1;
    }
  }

  if (staged && paths.length > 0) {
    throw new InvocationError("--staged cannot be combined with positional paths");
  }

  // An `--allow-fixture` path is a *subtractive* acknowledgement on a broader
  // scan, never a scan target on its own, so it also seeds the positional path
  // set. That makes `--allow-fixture X` mean "scan X, but allow it" (proving the
  // override gate actually subtracts a scanned target) instead of a silent no-op.
  const scanPaths = paths.length > 0 ? paths : [...allowFixtures];

  let mode: Args["mode"];
  if (staged) {
    mode = "staged";
  } else if (scanPaths.length > 0) {
    mode = "paths";
  } else {
    mode = "all";
  }
  return { mode, paths: scanPaths, allowFixtures };
}

// ---------------------------------------------------------------------------
// Allow-list + override log
// ---------------------------------------------------------------------------

function normalizeDob(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  if (digits.length >= 8) {
    const d = digits.slice(0, 8);
    const month = Number(d.slice(4, 6));
    const day = Number(d.slice(6, 8));
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return d;
  }
  if (/^\d{6}$/.test(digits)) {
    const month = Number(digits.slice(4, 6));
    if (month < 1 || month > 12) return null;
    return digits;
  }
  if (/^\d{4}$/.test(digits)) return digits; // year-only precision
  return null;
}

function loadAllowList(): AllowList {
  if (!existsSync(ALLOW_LIST_PATH)) {
    throw new InvocationError(`allow-list not found at ${ALLOW_LIST_PATH}`);
  }
  const raw = readFileSync(ALLOW_LIST_PATH, "utf8");
  const names = new Set<string>();
  const dobs = new Set<string>();
  const addresses = new Set<string>();
  const ids = new Set<string>();
  const emailDomains = new Set<string>();
  for (const lineRaw of raw.split(/\r?\n/)) {
    const line = lineRaw.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const sp = line.indexOf(" ");
    if (sp < 0) continue;
    const tag = line.slice(0, sp);
    const value = line.slice(sp + 1).trim();
    if (value.length === 0) continue;
    switch (tag) {
      case "NAME":
        names.add(value.toUpperCase());
        break;
      case "DOB": {
        const norm = normalizeDob(value);
        if (norm !== null) dobs.add(norm);
        break;
      }
      case "ADDR":
        addresses.add(value.toLowerCase());
        break;
      case "ID":
        ids.add(value.toUpperCase());
        break;
      case "EMAILDOMAIN":
        emailDomains.add(value.toLowerCase());
        break;
      default:
        break;
    }
  }
  return { names, dobs, addresses, ids, emailDomains };
}

function normalizePath(p: string): string {
  const abs = isAbsolute(p) ? p : resolve(REPO_ROOT, p);
  const rel = relative(REPO_ROOT, abs);
  return rel.split(sep).join("/");
}

function loadOverrideLog(): Set<string> {
  if (!existsSync(OVERRIDE_LOG_PATH)) return new Set();
  const raw = readFileSync(OVERRIDE_LOG_PATH, "utf8");
  const out = new Set<string>();
  for (const lineRaw of raw.split(/\r?\n/)) {
    const m = /^###\s+(.+?)\s*$/.exec(lineRaw);
    if (m && m[1] !== undefined) out.add(normalizePath(m[1]));
  }
  return out;
}

function validateAllowFixtures(allowFixtures: string[]): void {
  if (allowFixtures.length === 0) return;
  const overrides = loadOverrideLog();
  const missing = allowFixtures.map(normalizePath).filter((p) => !overrides.has(p));
  if (missing.length > 0) {
    const lines = missing.map((p) => `  - ${p}`).join("\n");
    throw new InvocationError(
      `--allow-fixture rejected: no matching entry in phi-scan-overrides.md for:\n${lines}\n` +
        `Add a "### <path>" subsection to phi-scan-overrides.md and commit it.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Target enumeration
// ---------------------------------------------------------------------------

interface Target {
  /**
   * Forward-slash repo-relative path. THE DISPATCH AND EVERY FILTER KEY ON THIS,
   * never on `label`: `scanTarget` reads the `test/__fixtures__/` prefix and the
   * wire-format extension off it, and `SENTINEL_FILES` / `--allow-fixture` match
   * it exactly. A target read out of the index carries the same `path` as the
   * walked file at that path, so a declared exemption covers both routes rather
   * than one, which is the property the markdown exemption already relies on.
   */
  path: string;
  /**
   * What a hit is REPORTED against. Equal to `path` for a working-tree target,
   * and annotated for one read out of the index, because "there is PHI in
   * `test/__fixtures__/patient.json`" and "there is PHI in the blob git has
   * staged at `test/__fixtures__/patient.json`" are different findings with
   * different remedies, and a developer who cannot tell them apart looks at the
   * file, sees nothing, and stops trusting the gate.
   */
  label: string;
  read: () => Buffer;
}

/**
 * An entry the enumeration reached but cannot scan. Both fields are safe to
 * print: `path` is the entry's own repo-relative path (the same locus every hit
 * already carries) and `kind` is a token from the closed set below. Nothing off
 * the other side of a link is ever recorded here.
 */
interface Unscannable {
  path: string;
  kind: string;
}

/** Closed-set, engine-owned description of a directory entry's kind. */
function direntKind(e: Dirent): string {
  if (e.isSymbolicLink()) return "a symbolic link";
  if (e.isFIFO()) return "a FIFO";
  if (e.isSocket()) return "a socket";
  if (e.isBlockDevice()) return "a block device";
  if (e.isCharacterDevice()) return "a character device";
  return "not a regular file";
}

/**
 * Enumerate a scan root. `Dirent`'s predicates are lstat answers and are not
 * exhaustive: an entry that is neither a directory nor a regular file is
 * collected into `unscannable` rather than dropped, so the caller can refuse
 * instead of reporting clean over it.
 */
function walk(dir: string, out: string[], unscannable: Unscannable[]): void {
  if (!existsSync(dir)) return;
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    // A directory the walk cannot list is an INCOMPLETE ENUMERATION, so it
    // refuses (exit 2) rather than reporting clean over whatever is inside it.
    // Raised as an `InvocationError` so it reaches this scanner's own diagnostic
    // channel and its own exit code: an uncaught fs error (`EACCES` on a mode-000
    // directory, `ENOTDIR` on a root that is not one) exits 1, and 1 is the code
    // this gate reserves for HITS FOUND.
    throw new InvocationError(
      `could not enumerate ${normalizePath(dir)}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      walk(full, out, unscannable);
    } else if (e.isFile()) {
      // README/markdown docs may legitimately describe violator values; they
      // are documentation, not fixtures.
      if (e.name.toLowerCase().endsWith(".md")) continue;
      out.push(full);
    } else {
      // Deliberately NOT subject to the `.md` exemption above. That exemption is
      // a judgement about a file whose bytes the walk could have read; a link's
      // name is no evidence at all about what is on the other side.
      unscannable.push({ path: normalizePath(full), kind: direntKind(e) });
    }
  }
}

/**
 * Refuse (exit 2) over entries the enumeration reached and cannot scan. EVERY
 * offender is named, not just the first: a developer who has to re-run the gate
 * once per link learns to distrust it.
 */
function refuseUnscannable(entries: Unscannable[], why: string, remedy: string): void {
  if (entries.length === 0) return;
  const lines = entries.map((u) => `  - ${u.path} (${u.kind})`).join("\n");
  const noun =
    entries.length === 1 ? "entry is not a regular file" : "entries are not regular files";
  throw new InvocationError(
    `refusing the scan: ${String(entries.length)} ${noun}:\n${lines}\n${why} ${remedy}`,
  );
}

function gitIgnored(paths: string[]): Set<string> {
  const ignored = new Set<string>();
  if (paths.length === 0) return ignored;
  try {
    // SECURITY: array-form execFileSync, no shell. Default (Buffer) encoding,
    // `encoding: "buffer"` with `input` is rejected by Node.
    const out = execFileSync("git", ["check-ignore", "--stdin", "-z"], {
      input: paths.map(normalizePath).join("\0"),
      stdio: ["pipe", "pipe", "ignore"],
    });
    for (const p of out.toString("utf8").split("\0")) {
      if (p.length > 0) ignored.add(p);
    }
  } catch {
    // `git check-ignore` exits 1 when nothing matches, treat as none ignored.
  }
  return ignored;
}

/**
 * Every path the INDEX says is in scope, or `null` when git named none.
 *
 * `null` and `[]` are deliberately different answers and the caller branches on
 * which it got. `null` means the question could not be asked (no git, no
 * repository, a pathspec matching nothing at all) and the walk is then the only
 * evidence there is. `[]` cannot be produced here: an empty list is returned as
 * `null` for exactly that reason.
 *
 * THE PATHSPEC IS LIMITED TO THE SCAN ROOTS ON PURPOSE. `git ls-files` with no
 * pathspec answers for the whole repository, and a repository CONTAINING this
 * one (a vendored copy, an agent worktree) would then answer with paths that
 * have nothing to do with the scan. Scoping to the roots means a nested copy
 * whose enclosing repository tracks nothing under them returns `null` and the
 * walk is used, rather than a list that reconciles against the wrong tree.
 */
function trackedInScope(): string[] | null {
  let out: Buffer;
  try {
    // SECURITY: array-form execFileSync, no shell.
    out = execFileSync("git", ["ls-files", "-z", "--", ...WALK_ROOTS.map(normalizePath)], {
      encoding: "buffer",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
  const paths = out
    .toString("utf8")
    .split("\0")
    .filter((p) => p.length > 0)
    // The walk exempts markdown (docs may legitimately describe violator
    // values), so the index side has to exempt it too or the reconciliation
    // would refuse over a file the scan is meant to skip.
    .filter((p) => !p.toLowerCase().endsWith(".md"));
  return paths.length > 0 ? paths : null;
}

/**
 * Refuse (exit 2) over paths the index names and the scan did not open.
 *
 * EXISTENCE IS NOT OBSERVATION, and this is the check that says so. `walk`
 * returns silently when its root does not exist, and yields nothing when the
 * root is an empty directory, so an emptied or deleted `test/__fixtures__`
 * printed `OK, no hits` and exited 0 over a corpus still fully present in the
 * index (measured, both cases). A count of scanned files does not detect it
 * either: the count counts the roots that DID exist, and a healthy-looking
 * number is exactly what the surviving root produces.
 */
function refuseUnobserved(paths: string[]): void {
  if (paths.length === 0) return;
  const lines = paths.map((p) => `  - ${p}`).join("\n");
  const noun =
    paths.length === 1
      ? "path is tracked in the index and was"
      : "paths are tracked in the index and were";
  throw new InvocationError(
    `refusing the scan: ${String(paths.length)} in-scope ${noun} ` +
      `not opened by the sweep:\n${lines}\n` +
      "A scan that reports clean over a file it never read is reporting on its own scope, not " +
      "on the corpus. Restore the file, or remove it from the index.",
  );
}

// ---------------------------------------------------------------------------
// The index route: the bytes git carries, as a UNION with the walk
// ---------------------------------------------------------------------------
//
// THE WALK READS THE WORKING TREE AND THAT IS NOT WHAT A COMMIT CONTAINS. Both
// halves of the gap were measured on this repository before this route existed,
// and neither is exotic:
//
//   - a PHI-bearing fixture `git add`ed and then scrubbed in the working tree
//     scanned CLEAN and exited 0, while `git commit` would have committed the
//     staged blob (measured, exit 0);
//   - 33 tracked non-markdown files sit outside `test/` and `src/` entirely
//     (`scripts/`, `.github/`, `docs-content/`, `.changeset/`, the root
//     manifests), so neither the walk nor `refuseUnobserved`'s index
//     reconciliation, whose pathspec is limited to the walk roots, ever
//     mentioned them. Two of the 33 carry bytes this scanner's own recognisers
//     report (measured).
//
// This route is a UNION, NEVER A REPLACEMENT. The walk keeps its roots and keeps
// reading UNTRACKED working-tree content under them, which the index cannot see
// at all; this adds every blob the index carries, wherever it carries it. Each
// route covers what the other structurally cannot, and the superset property is
// the one being relied on: nothing that was enumerated stops being enumerated.
//
// DEDUP IS BY CONTENT UNDER GIT'S OWN `blob <len>\0` FRAMING, NOT BY PATH. On an
// ordinary clean checkout an index blob that hashes to bytes the sweep already
// scanned is not fetched, so NOTHING IS SCANNED TWICE. That is not the same as
// leaving git unasked, and the difference is measurable: `cat-file` is invoked
// for the blobs no walk root covers, and for the declared paths excluded below.
// Where the two copies DIFFER, BOTH are scanned, and that is deliberate: with
// `core.autocrlf` or a `.gitattributes` `text` attribute the working-tree file
// is CRLF and the blob is LF, so they are different byte streams and a hit in
// one is not evidence about the other. A path-keyed dedup would have picked one
// and called it the corpus.
//
// THE DEDUP KEY IS THE OBJECT ID *AND* THE DETECTOR THE PATH DISPATCHES TO, AND
// NEITHER HALF IS OPTIONAL. Two states were constructed against an oid-only key
// and BOTH printed `OK, no hits` at exit 0:
//
//   - the DETECTOR is a property of the PATH, not of the bytes. `scanTarget`
//     sends `test/__fixtures__/x.json` to the structured FHIR scan and
//     `src/x.ts` to the source pass, and the source pass deliberately does not
//     key `identifier.value` or `telecom.value`. So one payload committed at
//     both paths was "observed" at the weaker one, and the fixture blob carrying
//     an SSN-shaped `identifier.value` was never fetched. An oid-only key
//     silently applies the weakest detector any path holding those bytes gets;
//   - an EXEMPT path's bytes were never scanned in the first place. A declared
//     `SENTINEL_FILES` entry is walked, and it is exempt precisely BECAUSE it
//     carries realistic-PHI-shaped strings, so hashing it into the observed set
//     let it vouch for a copy at a path with no exemption at all. That one is
//     not even convergent: the sentinel is never "fixed", so the other copy is
//     deduped away on every future run.
//
// So the observed set holds `<oid>\0<detector>` for the walked files that were
// actually SCANNED, and an exempt path contributes nothing to it. `scanKindOf`
// below is the ONE dispatch table; `scanTarget` reads it too, so the key cannot
// drift from what really runs.
//
// AN EXEMPT PATH IS STILL FETCHED, AND SAYING OTHERWISE WOULD CONTRADICT THE
// ENUMERATION. It contributes nothing to the observed set, so its own blob is
// not deduped away either: `indexTargets` enumerates it, `readBlobs` asks git
// for it, and `main` drops it before any detector runs. That costs a read of a
// declared file and buys the announcement, which is the point of declaring one.
//
// THE CONSEQUENCE THAT REMAINS, stated narrowly: two paths that hold identical
// bytes AND dispatch to the same detector AND are both in scope are one object,
// so a payload at both is reported at whichever the sweep read first, not at
// both. The exit code is unaffected, and fixing the reported copy leaves the
// other one's object unobserved, so the next run names it.

/** A single `git ls-files -s` record: one path at one stage. */
interface IndexEntry {
  path: string;
  mode: string;
  /** `0` for an ordinary entry; `1`/`2`/`3` for the three sides of a conflict. */
  stage: string;
  oid: string;
}

/** `<mode> <oid> <stage>\t<path>`, one `git ls-files -s -z` record. */
const LS_FILES_RECORD = /^(\d{6}) ([0-9a-f]+) ([0-3])\t([\s\S]+)$/;

/**
 * git's object-id algorithm for this repository, or `null` when git cannot say.
 *
 * ASK, NEVER ASSUME `sha1`. A repository created with `--object-format=sha256`
 * names its blobs with SHA-256, so hashing the working-tree bytes with SHA-1
 * would match nothing, every index blob would look different from its file, and
 * the whole corpus would be scanned twice. That is slow rather than wrong, which
 * is exactly why it would never be noticed.
 */
function objectFormat(): string | null {
  try {
    // SECURITY: array-form execFileSync, no shell.
    const out = execFileSync("git", ["rev-parse", "--show-object-format"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

/**
 * The object id git would give these bytes, under its `blob <len>\0<bytes>`
 * framing. This is the identity the dedup keys on, and it is a property of the
 * CONTENT: two paths holding the same bytes have the same id, and one path whose
 * working-tree and index copies differ by so much as a line ending has two.
 */
function blobOid(bytes: Buffer, algo: string): string | null {
  try {
    const h = createHash(algo);
    h.update(Buffer.from(`blob ${String(bytes.length)}\0`, "utf8"));
    h.update(bytes);
    return h.digest("hex");
  } catch {
    // An algorithm node does not implement. The caller then dedups nothing and
    // scans both copies, which reads MORE rather than less.
    return null;
  }
}

/**
 * Every entry the index carries, or `null` when git could not be asked.
 *
 * NO PATHSPEC, DELIBERATELY, AND THAT IS THE OPPOSITE OF `trackedInScope`'s
 * CHOICE ABOVE. That one limits itself to the walk roots because it feeds a
 * REFUSAL, and refusing over a path no route was ever going to scan would be a
 * gate nobody can get green. This one feeds a SCAN, so the widest honest scope
 * is the right one. `git ls-files` is implicitly scoped to the current directory
 * and below, so a copy vendored inside an enclosing repository still answers
 * with this copy's own paths rather than the enclosing tree's.
 */
function indexEntries(): IndexEntry[] | null {
  let out: Buffer;
  try {
    // SECURITY: array-form execFileSync, no shell.
    out = execFileSync("git", ["ls-files", "-s", "-z"], {
      encoding: "buffer",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null;
  }
  const entries: IndexEntry[] = [];
  for (const record of out.toString("utf8").split("\0")) {
    if (record.length === 0) continue;
    const m = LS_FILES_RECORD.exec(record);
    const mode = m?.[1];
    const oid = m?.[2];
    const stage = m?.[3];
    const path = m?.[4];
    if (mode === undefined || oid === undefined || stage === undefined || path === undefined) {
      // Refuse rather than skip: a record this route cannot read is a file it
      // would then report clean over, which is the whole shape being closed.
      throw new InvocationError(
        "could not read the output of `git ls-files -s -z`: unrecognized record. " +
          "Refusing rather than scanning a list that may be short.",
      );
    }
    entries.push({ path, mode, stage, oid });
  }
  return entries.length > 0 ? entries : null;
}

/**
 * Read the named blobs in ONE `git cat-file --batch`, keyed by object id.
 *
 * `--batch` writes `<oid> blob <size>\n<size bytes>\n` per request, so the
 * payload is taken by LENGTH and never by scanning for a delimiter: a blob is
 * arbitrary bytes and may contain any newline anywhere.
 */
function readBlobs(oids: string[]): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  if (oids.length === 0) return out;
  let buf: Buffer;
  try {
    // SECURITY: array-form execFileSync, no shell. Default (Buffer) encoding,
    // because `encoding: "buffer"` alongside `input` is rejected by Node --
    // the same constraint `gitIgnored` above records.
    buf = execFileSync("git", ["cat-file", "--batch"], {
      input: oids.join("\n") + "\n",
      stdio: ["pipe", "pipe", "ignore"],
      maxBuffer: 512 * 1024 * 1024,
    });
  } catch (err) {
    throw new InvocationError(
      `could not read the index blobs git carries: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  let at = 0;
  while (at < buf.length) {
    const nl = buf.indexOf(0x0a, at);
    if (nl < 0) break;
    const header = buf.toString("utf8", at, nl);
    const m = /^([0-9a-f]+) (\S+) (\d+)$/.exec(header);
    const oid = m?.[1];
    const kind = m?.[2];
    const size = m?.[3];
    if (oid === undefined || kind === undefined || size === undefined) {
      throw new InvocationError(
        `could not read the output of \`git cat-file --batch\`: unrecognized header "${header}". ` +
          "Refusing rather than scanning a list that may be short.",
      );
    }
    const len = Number(size);
    const start = nl + 1;
    if (kind === "blob") out.set(oid, buf.subarray(start, start + len));
    at = start + len + 1; // trailing newline git writes after each payload
  }
  return out;
}

/**
 * Turn the index into scan targets, minus whatever the walk already read.
 *
 * KEY THE CONFLICT CASE ON THE ABSENCE OF STAGE 0, NOT ON THE FIRST RECORD. An
 * unmerged path is recorded at stages 1, 2 and 3 with ORDINARY blob modes, so a
 * reader that takes the first record it sees gets stage 1, THE MERGE BASE, and
 * would report on it as if it were what git carries. Every stage is read and
 * every stage is labelled with its own number, so no single one of them can be
 * silently promoted to "the" index copy. Reading all three is a widening: the
 * `--staged` route still REFUSES over an unmerged path, because that route has
 * to name one blob and there is none, and git will not let a conflicted path be
 * committed anyway.
 */
function indexTargets(scanned: Set<string>): Target[] {
  const entries = indexEntries();
  if (entries === null) return [];

  // The markdown exemption is a scan-wide rule, not a property of one
  // enumeration: the walk skips `.md` because documentation may legitimately
  // describe violator values, and a route that reads it anyway would red on
  // exactly the files the sweep exempts.
  const inScope = entries.filter((e) => !e.path.toLowerCase().endsWith(".md"));

  // A mode the index carries that is not a blob proves nothing when read: for
  // mode 120000 the object IS the link's target path, and for 160000 there is no
  // object in this repository at all. Refusing here covers the whole index,
  // including the gitlink and link cases outside the walk roots, which no route
  // reached before.
  refuseUnscannable(
    inScope
      .filter((e) => !REGULAR_BLOB_MODES.has(e.mode))
      .map((e) => ({ path: e.path, kind: gitModeKind(e.mode) })),
    "The object git carries for such an entry is its target path, or is not in this repository " +
      "at all, so scanning it would prove nothing about what it points at.",
    "Replace it with a regular file, or remove it from the index.",
  );

  // A DECLARED PATH IS STILL ENUMERATED HERE, and `main` is what drops it. The
  // exemption is announced rather than performed in silence, and an exemption
  // nobody sees is the same blind spot this gate exists to refuse; a route that
  // dropped it earlier would announce nothing whenever the walk never reached it
  // (`scripts/phi-scan.ts` sits outside every walk root, so that is the ordinary
  // case, not an edge one). The ONE thing an exemption does to this enumeration
  // is decided in `scanned` by the caller: a declared path's bytes are never the
  // reason another path's identical bytes get skipped.
  const wanted = inScope.filter(
    (e) => REGULAR_BLOB_MODES.has(e.mode) && !scanned.has(scanIdentity(e.oid, e.path)),
  );
  // Two entries can name one object (the same bytes committed at two paths, or
  // two sides of a conflict that agree), so ask git for each object once.
  const blobs = readBlobs([...new Set(wanted.map((e) => e.oid))]);

  return wanted.map((e) => {
    const missing = !blobs.has(e.oid);
    return {
      path: e.path,
      label:
        e.stage === "0" ? `${e.path} (as git carries it)` : `${e.path} (index stage ${e.stage})`,
      read: (): Buffer => {
        const b = blobs.get(e.oid);
        if (b === undefined || missing) {
          throw new InvocationError(
            `the index names an object at ${e.path} that this repository does not carry, so the ` +
              "scan cannot read what a commit there would contain.",
          );
        }
        return b;
      },
    };
  });
}

function buildTargetsForAll(): Target[] {
  const files: string[] = [];
  const unscannable: Unscannable[] = [];
  for (const root of WALK_ROOTS) walk(root, files, unscannable);

  // One `git check-ignore` over both lists. An ignored entry is already out of
  // scope for the file route, so applying the same rule to a link keeps a single
  // boundary rather than inventing a second, stricter one for links alone.
  const ignored = gitIgnored([...files.map(normalizePath), ...unscannable.map((u) => u.path)]);

  refuseUnscannable(
    unscannable.filter((u) => !ignored.has(u.path)),
    "The walk can neither read such an entry nor vouch for what is on the other side of it.",
    "Remove it, replace it with a regular file, or (if it is genuinely not part of the " +
      "corpus) untrack it and add it to .gitignore.",
  );

  const observed = new Set(files.map(normalizePath));

  // Reconcile against the index BEFORE the sentinel filter, and before anything
  // else subtracts: a declared sentinel file is still a file the sweep OPENED
  // and then chose not to scan, which is a different claim from never having
  // reached it. Filtering first would make an emptied root indistinguishable
  // from a fully-declared one.
  const tracked = trackedInScope();
  if (tracked !== null) {
    refuseUnobserved(tracked.filter((p) => !observed.has(p) && !ignored.has(p)));
  }

  // Read each walked file ONCE, here, and keep the bytes. The read has to happen
  // before the dedup can ask whether the index carries the same content, and
  // reading twice would let the two answers come from two different states of
  // the file.
  const algo = objectFormat();
  const scanned = new Set<string>();
  const targets: Target[] = [];
  for (const abs of files) {
    const rel = normalizePath(abs);
    if (ignored.has(rel)) continue;
    let bytes: Buffer;
    try {
      bytes = readFileSync(abs);
    } catch (err) {
      throw new InvocationError(
        `could not read ${rel}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    // A DECLARED SENTINEL VOUCHES FOR NOTHING. It is walked, but `main` drops it
    // before any detector runs, and it is exempt precisely BECAUSE it carries
    // realistic-PHI-shaped strings. Hashing it into the observed set would let
    // it dedup away an identical copy at a path with no exemption, on every run
    // forever, since a sentinel is never "fixed". `--allow-fixture` needs no
    // equivalent here: `parseArgs` turns it into `paths` mode, so it cannot
    // reach this route at all.
    if (algo !== null && !SENTINEL_FILES.has(rel)) {
      const oid = blobOid(bytes, algo);
      if (oid !== null) scanned.add(scanIdentity(oid, rel));
    }
    targets.push({ path: rel, label: rel, read: (): Buffer => bytes });
  }

  // A SWEEP THAT OPENED NOTHING MUST NOT REPORT CLEAN, whatever the index said.
  // The reconciliation above is the sharp instrument and needs git to answer;
  // this is the floor underneath it, for a tree git cannot answer about at all:
  // a copy with no repository of its own, or one nested inside an unrelated
  // repository that tracks nothing under the scan roots.
  // `git rev-parse --is-inside-work-tree` is no help there, because it ANSWERS
  // FOR THE ENCLOSING REPOSITORY and reports `true` for a nested copy whose own
  // files git has never heard of.
  //
  // STATE WHAT IT COVERS, WHICH IS THE ZERO-FILES CASE AND NOT THE GENERAL ONE.
  // With no usable index and only SOME roots emptied, the surviving root still
  // yields targets and this arm does not fire; that state is reported clean and
  // is a declared residual, not a covered case.
  //
  // IT STAYS KEYED ON THE WALK, NOT ON THE UNION BELOW. The state it names is "no
  // repository to ask and nothing on disk either", and an index route that
  // happened to find blobs would make the arm unreachable in exactly the case it
  // was built for. The union widens what is SCANNED; it does not retire a refusal.
  if (targets.length === 0) {
    throw new InvocationError(
      "refusing the scan: the sweep observed no files under any scan root. " +
        `Roots are ${WALK_ROOTS.map(normalizePath).join(", ")}. ` +
        "An empty result here is a statement about the scan, not about the corpus, and " +
        "`OK, no hits` would read as the second. Run it from the repository root.",
    );
  }

  return [...targets, ...indexTargets(scanned)];
}

function buildTargetsForPaths(paths: string[]): Target[] {
  return paths.map((p) => {
    const abs = isAbsolute(p) ? p : resolve(REPO_ROOT, p);
    if (!existsSync(abs)) throw new InvocationError(`File not found: ${p}`);
    if (!statSync(abs).isFile()) throw new InvocationError(`Not a regular file: ${p}`);
    const rel = normalizePath(abs);
    return { path: rel, label: rel, read: (): Buffer => readFileSync(abs) };
  });
}

/** git's file modes for a regular blob. Every other mode is not a file to read. */
const REGULAR_BLOB_MODES = new Set(["100644", "100755"]);

/** Closed-set, engine-owned description of a git file mode. */
function gitModeKind(mode: string): string {
  if (mode === "120000") return "a symbolic link";
  if (mode === "160000") return "a gitlink (a nested repository)";
  return `a git mode-${mode} entry`;
}

/** `:<srcmode> <dstmode> <srcsha> <dstsha> <status>`, the info half of a `--raw -z` record. */
const RAW_RECORD = /^:(?:\d{6}) (\d{6}) [0-9a-f]+ [0-9a-f]+ ([A-Z])\d*$/;

/**
 * Refuse (exit 2) over in-scope paths that are unmerged. Separate from
 * `refuseUnscannable` because the reason is different in kind: there is no
 * single staged blob to read, rather than one that proves nothing.
 */
function refuseUnmerged(paths: string[]): void {
  if (paths.length === 0) return;
  const lines = paths.map((p) => `  - ${p}`).join("\n");
  const noun = paths.length === 1 ? "path is unmerged" : "paths are unmerged";
  throw new InvocationError(
    `refusing the scan: ${String(paths.length)} in-scope ${noun}:\n${lines}\n` +
      "An unmerged path is recorded at stages 1/2/3 and at no stage 0, so `git show :<path>` " +
      "fails outright and there is no one staged blob for the scan to read. " +
      "Resolve the conflict and `git add` the result.",
  );
}

function buildTargetsForStaged(): Target[] {
  let listBuf: Buffer;
  try {
    // SECURITY: array-form execFileSync, no shell. `--raw` rather than
    // `--name-only` because the DESTINATION MODE is the only thing that
    // distinguishes a staged regular file from a staged symlink or gitlink, and
    // `git show :<path>` answers all three without complaint.
    //
    // `T` (TYPECHANGE) IS IN THE FILTER, AND LEAVING IT OUT MAKES THE MODE CHECK
    // BELOW UNREACHABLE WHENEVER THE FILE WAS ALREADY TRACKED. Replacing a
    // TRACKED regular file with a link is not an add and not a modify: git
    // raises it as `T` (`:100644 120000 <sha> <sha> T`), so `--diff-filter=AM`
    // deleted the record before any mode could be read and the hook passed the
    // link green. Admitting `T` also covers the reverse typechange, a link
    // replaced by a real file carrying PHI, which the same filter dropped.
    // Typechange carries a single path, exactly like `A` and `M`, so admitting
    // it costs the two-field stride below nothing.
    //
    // `--no-renames` FOR THE SAME REASON, AND THE FILTER ALONE WAS NOT ENOUGH.
    // `R` and `C` are returned by neither `AM` nor `AMT`, and rename detection
    // is ON BY DEFAULT (git 2.39.5; `diff.renames` can turn copy detection on
    // too), so `git mv <link> test/__fixtures__/<name>` staged as
    // `:120000 120000 <sha> <sha> R100` with TWO paths and the filter deleted
    // the record outright: an ordinary `git mv` put a mode-120000 entry under a
    // scan root and this route printed "OK, no hits" (measured, exit 0). A
    // rename that also SUBSTITUTES a real name into the moved file passed
    // identically, because a record this route never lists is never scanned
    // either. THE COPY HALF IS REAL TOO, not a theoretical arm: under
    // `diff.renames=copies` a PHI-bearing file copied from outside the scope into
    // a scan root stages as a genuine `C100`, also two-path, and was dropped
    // exactly as a rename was. Turning detection off makes the destination arrive
    // as an ordinary single-path `A` (`:000000 120000 0000000 <sha> A`) and the
    // source a `D` the filter drops (or, for a copy, leaves the source untouched),
    // so it needs no two-path record shape and costs the stride nothing. It also
    // makes the two-field stride STRUCTURAL rather than conditional: with
    // detection off no `R` or `C` record can be produced whatever the caller's
    // `diff.renames` / `diff.renameLimit` say. Verified under
    // `diff.renames=true|copies|false|1` and `renameLimit=1`.
    //
    // SAY "EQUAL OR LARGER", NOT "A STRICT SUPERSET". The two enumerations are
    // EQUAL whenever nothing is renamed or copied, which is the ordinary commit,
    // and larger only when something is. "Strict superset" claims it always
    // grows, and that is false for almost every commit this gate ever sees. The
    // property actually being relied on is the one-directional half: nothing that
    // WAS enumerated stops being enumerated.
    //
    // `U` (UNMERGED) IS IN THE FILTER SO THE SCAN CAN REFUSE OVER IT. It was
    // returned by neither `AM` nor `AMT`, so an in-scope conflicted path was
    // simply absent from the list and this route reported "OK, no hits" over an
    // index it had not read (measured, exit 0). Git itself will not commit while
    // a path is unmerged, so this was never a route to a committed leak; what it
    // was is a gate attesting clean over a state it never observed, and
    // `phi-scan --staged` is run by hand and from scripts as well as from the
    // hook. `U` carries a single path like `A`/`M`/`T`, so it costs the stride
    // nothing either; it is refused rather than scanned, below.
    listBuf = execFileSync(
      "git",
      ["diff", "--cached", "--raw", "-z", "--no-renames", "--diff-filter=AMTU"],
      {
        encoding: "buffer",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  } catch (err) {
    throw new InvocationError(
      `git diff --cached failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // `--raw -z` emits `<info>\0<path>\0` per record. `R` (rename) and `C` (copy)
  // are the only statuses carrying a SECOND path, and `--no-renames` above means
  // git cannot emit either whatever the caller's config says, so the stride is
  // two fields STRUCTURALLY rather than by the filter's leave. The regex still
  // admits a score-suffixed status: if one ever reached here the stride would
  // desync and the next record would fail to parse, which REFUSES, the same
  // outcome as any other unparseable record and the safe one. A record that does
  // not parse REFUSES rather than being skipped: a silently shortened list is
  // exactly the shape this scan must never report clean over.
  //
  // What this route still does NOT enumerate, stated because the boundary is
  // narrower than the path prefix alone: the filter drops `D`, a deletion, which
  // has no staged blob to scan. That is PRE-EXISTING and deliberate. The only
  // other statuses git documents are `B` (a broken pairing, which needs `-B` and
  // is not passed) and `X` (git's own "this is a bug" marker), so `A`/`M`/`T`/`U`
  // plus `D` accounts for every record this invocation can produce.
  const fields = listBuf.toString("utf8").split("\0");
  const staged: { path: string; mode: string; status: string }[] = [];
  let i = 0;
  while (i < fields.length) {
    const info = fields[i];
    if (info === undefined || info.length === 0) {
      i += 1;
      continue;
    }
    const m = RAW_RECORD.exec(info);
    const mode = m?.[1];
    const status = m?.[2];
    const path = fields[i + 1];
    if (mode === undefined || status === undefined || path === undefined || path.length === 0) {
      throw new InvocationError(
        "could not read the output of `git diff --cached --raw -z`: unrecognized record. " +
          "Refusing rather than scanning a list that may be short.",
      );
    }
    staged.push({ path, mode, status });
    i += 2;
  }

  // EACH SCAN ROOT'S OWN PATH IS IN SCOPE AS WELL AS EVERYTHING UNDER IT. A
  // `--raw` RECORD at exactly `test/__fixtures__` or `src` is never a directory,
  // because this invocation emits no record for one, so it is a scan root
  // replaced by a blob, a link or a gitlink, and the prefix test alone let that
  // through (measured: exit 0 over a staged mode-120000 `test/__fixtures__`, and
  // the same for `src`). Scope the claim to the RECORD and not to the index: a
  // sparse index does hold a directory entry (`040000 <sha> 0 src/`), which
  // cannot match either `===` anyway because it carries a trailing slash, and
  // which produces no record here.
  //
  // The other three modes are all handled below. A REGULAR BLOB at either path
  // falls to `scanTarget`, and what it gets there is the CONSERVATIVE SHAPE PASS
  // ONLY, NOT THE FHIR-AWARE SCAN: `isFixture` tests
  // `startsWith("test/__fixtures__/")` with a trailing slash, so the root's own
  // path cannot reach the structured branch, and a resource written there has its
  // names, birthDate, address and telecom read by nothing. Measured exit 0, and
  // identical on base, which did not admit the path at all. That is a DISCLOSED
  // GAP recorded in `phi-scan-overrides.md`, not a safe direction, and the reason
  // it is not closed here is that the fix belongs to `scanTarget`'s dispatch
  // rather than to this filter. What admitting the path does buy is the mode
  // check, which is the whole of the link / gitlink case.
  //
  // The `.ts` suffix rule still governs the CONTENTS of `src`; the root's own
  // path is admitted for the same reason the fixture root's is, that losing the
  // whole root from the index is not a thing to report clean.
  //
  // `test` REPLACED `test/__fixtures__` HERE TOO, for the same measured reason
  // the walk root moved: a staged file directly under `test/` was listed by
  // neither route. Keeping the two routes on different scopes would mean the
  // hook and CI disagree about what the corpus is, which is the state that let
  // the hole sit unnoticed. It also closes the recorded "a scan root's PARENT
  // staged as a link defeats both routes" case for the fixture corpus: `test`
  // staged as a mode-120000 entry is now in scope and refused on its mode.
  //
  // THE MARKDOWN EXEMPTION IS APPLIED HERE TOO, and leaving it out made the two
  // routes disagree in BOTH directions: the walk skips `.md` by design ("docs
  // may legitimately describe violator values"), so a tracked `test/notes.md`
  // carrying a dashed SSN was never opened by CI while this route reported it as
  // a hit (measured, exit 1 here against exit 0 there). A pre-commit hook that
  // reds on documentation the sweep exempts is a hook that gets bypassed. The
  // exemption is a scan-wide rule, not a property of one enumeration.
  const inScope = staged.filter(
    (s) =>
      !s.path.toLowerCase().endsWith(".md") &&
      (s.path === "test" ||
        s.path.startsWith("test/") ||
        s.path === "src" ||
        (s.path.startsWith("src/") && s.path.endsWith(".ts"))),
  );

  // Unmerged first: such a record's destination mode is `000000`, which the mode
  // test below would otherwise refuse with a sentence about symbolic links and
  // gitlinks that is false for it.
  refuseUnmerged(inScope.filter((s) => s.status === "U").map((s) => s.path));

  const list = inScope.filter((s) => s.status !== "U");

  refuseUnscannable(
    list
      .filter((s) => !REGULAR_BLOB_MODES.has(s.mode))
      .map((s) => ({ path: s.path, kind: gitModeKind(s.mode) })),
    // Measured on this repo, and the two modes fail DIFFERENTLY, so the wording
    // covers both rather than asserting the symlink one of a gitlink: for mode
    // 120000 `git show :<path>` succeeds and hands back the TARGET PATH, which
    // this route then scanned as if it were content; for mode 160000 it fails
    // outright (`fatal: bad object`), which surfaced as an uncontrolled read
    // error naming no kind. Neither is content that proves anything.
    "For such an entry `git show :<path>` hands back its target path rather than any content, " +
      "or no object at all, so scanning it would prove nothing about what it points at.",
    "Unstage it, or replace it with a regular file.",
  );

  return list.map(({ path: relPath }) => ({
    path: relPath,
    label: relPath,
    // SECURITY: array-form execFileSync, no shell. `:<path>` is a git pathspec.
    read: (): Buffer =>
      execFileSync("git", ["show", `:${relPath}`], {
        encoding: "buffer",
        stdio: ["ignore", "pipe", "pipe"],
      }),
  }));
}

// ---------------------------------------------------------------------------
// Shared token / shape helpers
// ---------------------------------------------------------------------------

/** Escape a literal string for embedding in a RegExp. */
function reEscape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Unicode-aware name tokenizer: significant tokens only (middle initials dropped). */
function nameTokens(value: string): string[] {
  const out: string[] = [];
  for (const raw of value.split(/[^\p{L}]+/u)) {
    if (raw.length === 0) continue;
    if (!/\p{L}/u.test(raw)) continue;
    // A single Latin letter is a middle initial, not identifying. A single CJK
    // ideograph / kana / hangul IS a name (Chinese/Korean surnames are 1 char).
    const isCjk = /[぀-ヿ㐀-鿿가-힯]/u.test(raw);
    if (raw.length < 2 && !isCjk) continue;
    out.push(raw);
  }
  return out;
}

function isEmailShaped(value: string): boolean {
  return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value.trim());
}

// ---------------------------------------------------------------------------
// Category detectors
// ---------------------------------------------------------------------------

function checkNameString(
  path: string,
  location: string,
  value: string,
  allow: AllowList,
  hits: Hit[],
): void {
  for (const tok of nameTokens(value)) {
    if (NAME_NOISE_TOKENS.has(tok.toUpperCase())) continue;
    if (!allow.names.has(tok.toUpperCase())) {
      hits.push({
        path,
        location,
        value: tok,
        reason: "person-name token not in synthetic allow-list",
      });
    }
  }
}

function checkDate(
  path: string,
  location: string,
  value: string,
  allow: AllowList,
  hits: Hit[],
): void {
  const dob = normalizeDob(value);
  if (dob === null) return;
  if (!allow.dobs.has(dob)) {
    hits.push({
      path,
      location,
      value,
      reason: "date of birth not in synthetic allow-list",
    });
  }
}

function checkAddressLine(
  path: string,
  location: string,
  value: string,
  allow: AllowList,
  hits: Hit[],
): void {
  const street = value.trim();
  // A street line: house number + at least one word (`123 Main St`).
  if (!/^\d+\s+\p{L}/u.test(street)) return;
  if (!allow.addresses.has(street.toLowerCase())) {
    hits.push({
      path,
      location,
      value: street,
      reason: "street address not in synthetic allow-list",
    });
  }
}

/** A ContactPoint.value or Identifier.value, phone / email / SSN shape checks. */
function checkContactValue(
  path: string,
  location: string,
  value: string,
  allow: AllowList,
  hits: Hit[],
): void {
  const v = value.trim();
  if (v.length === 0) return;
  if (isEmailShaped(v)) {
    const domain = (v.split("@")[1] ?? "").toLowerCase();
    if (!allow.emailDomains.has(domain)) {
      hits.push({ path, location, value: v, reason: "email with non-test domain" });
    }
    return;
  }
  const digits = v.replace(/\D/g, "");
  // A 9-digit value is SSN-shaped; declare it synthetic in the allow-list.
  if (/^\d{9}$/.test(digits) && !allow.ids.has(digits.toUpperCase())) {
    hits.push({
      path,
      location,
      value: v,
      reason: "SSN- / 9-digit-identifier-shaped value not in synthetic allow-list",
    });
    return;
  }
  // A real dialable phone is >= 10 digits. The `555` fake-exchange convention
  // (555-01xx is reserved for fiction) marks a synthetic number.
  if (digits.length >= 10 && !digits.includes("555") && !allow.ids.has(digits.toUpperCase())) {
    hits.push({
      path,
      location,
      value: v,
      reason: "phone number without the 555 fake-exchange convention",
    });
  }
}

// ---------------------------------------------------------------------------
// Cross-cutting shape checks (free text + non-FHIR targets)
// ---------------------------------------------------------------------------

function scanCommonShapes(path: string, content: string, allow: AllowList, hits: Hit[]): void {
  // Dashed SSN anywhere (covers Narrative.div / Annotation.text + non-FHIR src).
  for (const m of content.matchAll(/\b\d{3}-\d{2}-\d{4}\b/g)) {
    hits.push({ path, location: "(ssn)", value: m[0], reason: "dashed SSN pattern" });
  }
  // Emails whose domain is not an allow-listed reserved / test domain.
  //
  // THIS PACKAGE'S DIAGNOSTIC FORM, `IssueCode@FHIRPath`, IS INDISTINGUISHABLE
  // FROM AN ADDRESS BY SHAPE: both are one `@` between two dotted tokens, and
  // `.name` is a real top-level domain, so no TLD test separates them. It is
  // handled by ONE `EMAILDOMAIN` line in the allow-list, the file's own reviewed
  // mechanism, and NOT by a shape exclusion here. A shape exclusion was tried and
  // reverted: keyed on an all-caps local part plus a capitalised first domain
  // label, it silently covered every capitalised domain (`JOHN_SMITH@Mercy.org`)
  // in every source target, and because `scanTarget` routes a fixture with an
  // unexpected extension down the same branch it also LOST a hit this scanner
  // already had. One allow-list line has a blast radius of one domain.
  for (const m of content.matchAll(/\b[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g)) {
    const domain = (m[1] ?? "").toLowerCase();
    if (!allow.emailDomains.has(domain)) {
      hits.push({ path, location: "(email)", value: m[0], reason: "email with non-test domain" });
    }
  }
}

// ---------------------------------------------------------------------------
// FHIR-keyed literal recogniser (source files)
// ---------------------------------------------------------------------------

/**
 * ENUMERATING A FILE BUYS THE SSN / EMAIL FLOOR AND NOTHING ELSE, so widening
 * the scope without widening this is half a fix.
 *
 * `scanTarget` reaches the structured scanner only for a fixture with a FHIR
 * wire-format extension, because the structured scanner assumes the FILE IS THE
 * DOCUMENT. A test builds its resources as TypeScript object literals instead,
 * so a real surname typed as `family: "…"` inside a `.ts` file was read by
 * NOTHING before this: `scanCommonShapes` looks for a dashed SSN and an email
 * and neither is a name, a date of birth or a street address. Measured on a
 * `.ts` file carrying `{ resourceType: "Patient", name: [{ family: "…",
 * given: ["…"] }] }`: exit 0, `OK, no hits`, both before the scope widening
 * (never enumerated) and after it with this recogniser absent (enumerated,
 * unread).
 *
 * This is IN ADDITION TO `scanCommonShapes`, never instead of it.
 *
 * The key set is closed and small, and every omission below is deliberate:
 *
 *   - `text` is NOT keyed. `HumanName.text` and `Address.text` are PHI, but a
 *     flat text pass cannot tell them from `CodeableConcept.text`,
 *     `Narrative.text` or an assertion message, all of which are ordinary in
 *     this suite. Keying it would false-error on conformant test code, which is
 *     the failure that gets a gate switched off.
 *   - `identifier.value` and `telecom.value` are NOT keyed, for the same
 *     reason and more sharply: bare `value:` is the single most overloaded key
 *     in FHIR (`Quantity.value`, `Extension.value[x]`, every primitive) and the
 *     XML scanner only dares read it inside a `<telecom>` / `<identifier>`
 *     block. There is no equivalent block boundary in TypeScript source.
 *
 * So this recogniser covers NAMES, DATES OF BIRTH AND STREET ADDRESSES in
 * source. It is not a claim that source is scanned as thoroughly as a fixture;
 * a 9-digit identifier written inline still reaches only the dashed-SSN arm.
 * Put a resource that needs full coverage in `test/__fixtures__/`.
 */
const SOURCE_LITERAL_KEYS =
  /(?:^|[^\w$.])\\?["'`]?(family|given|birthDate|deceasedDateTime|line)\\?["'`]?\s*:\s*/g;

/**
 * A `${…}` substitution span, replaced by a space before anything is tokenized.
 *
 * NOT skipped, and not read either. Reading it reported the EXPRESSION as a
 * person name: `` family: `${surname}` `` produced a hit whose value was
 * `surname`, which is a variable, not anybody's name, and a gate that invents
 * findings is a gate that gets ignored. Skipping the whole literal would drop
 * the XML resources this suite writes as template literals with an interpolated
 * namespace declaration, which is most of them. Blanking the span keeps every
 * character the file spells out and reads none that it computes.
 */
const TEMPLATE_SUBSTITUTION = /\$\{[^{}]*\}/g;

/**
 * An XML entity reference or numeric character reference, blanked for the same
 * reason a substitution is: it is a REFERENCE, not spelled-out content, and
 * neither XML pass in this scanner resolves one.
 *
 * A SPACE, NOT A DELETION, and the direction matters. Blanking can only split a
 * token apart, never join two, so it cannot hide a name that was written as
 * letters: `Smith&amp;Jones` reports both halves. Deleting would have joined
 * `A&#65;` into one token that the file never spells. Without this the entity
 * and XXE cases in this suite's own XML tests reported `amp`, `lt`, `gt`, `xxe`,
 * `lol`, `secret` and `xZZ` as person-name tokens, which are entity names and
 * nobody's name.
 *
 * THE RESIDUAL, WHICH THE FIXTURE XML PASS HAS TOO AND ALWAYS HAS: a name
 * spelled ENTIRELY as character references is blanked to nothing and not
 * reported. The threat this gate is built for is an accidental commit, not an
 * author encoding a name to evade it, and a partially encoded name still
 * reports.
 */
const XML_ENTITY_REF = /&#?[A-Za-z0-9]+;/g;

/**
 * Decode the string escapes a TypeScript literal can spell a character with, so
 * a name is not hidden from the token check by the way it was typed. `"Roe"`
 * is `Roe` to every reader of the program and has to be `Roe` here too; this
 * suite already contains that spelling. Unknown escapes drop to their literal
 * character, which is what the language does for everything outside the short
 * list below.
 *
 * BOUNDED FIXED POINT, NOT ONE PASS, and the reason is in this suite already: a
 * resource is routinely written as a JSON document inside a TypeScript string,
 * so that value is TWO layers of escaping and one decode leaves a backslash-u
 * sequence whose only surviving name token is `Ro`, which nobody wrote. Decoding
 * until the text stops changing reads what the program reads. The bound is a
 * bound: this runs over source text and a fixed point is not guaranteed to be
 * reached cheaply, so three rounds is the cap. A fourth layer of escaping is not
 * decoded, and it fails toward reporting rather than away from it: the residue
 * still tokenizes and still has to clear the allow-list.
 */
function decodeSourceEscapes(raw: string): string {
  let out = raw;
  for (let round = 0; round < 3; round += 1) {
    const next = decodeSourceEscapesOnce(out);
    if (next === out) break;
    out = next;
  }
  return out;
}

function decodeSourceEscapesOnce(raw: string): string {
  return raw.replace(
    /\\(u\{([0-9a-fA-F]+)\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|(.))/gs,
    (...m) => {
      const [, , braced, u4, x2, other] = m as (string | undefined)[];
      const hex = braced ?? u4 ?? x2;
      if (hex !== undefined) {
        const cp = Number.parseInt(hex, 16);
        // A lone surrogate is not a scalar value; leave the escape as written
        // rather than manufacturing U+FFFD, which would change the token.
        if (cp >= 0xd800 && cp <= 0xdfff) return `\\u${hex}`;
        try {
          return String.fromCodePoint(cp);
        } catch {
          return `\\u${hex}`;
        }
      }
      // The single-character escapes. Anything not named here drops to the
      // character itself, which is what the language does: `\q` is `q`, and `\\`
      // is one backslash.
      const single = other ?? "";
      switch (single) {
        case "n":
          return "\n";
        case "t":
          return "\t";
        case "r":
          return "\r";
        case "0":
          return "\0";
        default:
          return single;
      }
    },
  );
}

/** How far past a matched key the value reader will look. */
const LITERAL_SCAN_LIMIT = 200_000;

function isQuote(c: string | undefined): boolean {
  return c === '"' || c === "'" || c === "`";
}

/**
 * Read one quoted string starting at `i`, or `null`. Returns the raw body.
 *
 * AN ESCAPED DELIMITER OPENS A STRING TOO, and missing that read nothing at all
 * for the commonest way this suite embeds a document: a JSON resource inside a
 * DOUBLE-quoted TypeScript string spells its keys and values `\"family\"`, so
 * both the key and the value begin with a backslash. The single-quoted spelling
 * has no backslash and always worked, which is exactly why the gap was easy to
 * miss.
 */
function readQuoted(text: string, i: number): { value: string; end: number } | null {
  let start = i;
  const escaped = text[i] === "\\" && isQuote(text[i + 1]);
  if (escaped) start = i + 1;
  const quote = text[start];
  if (!isQuote(quote)) return null;

  let j = start + 1;
  let body = "";
  while (j < text.length) {
    const c = text[j];
    if (c === undefined) break;
    if (escaped) {
      // The delimiter is the two-character sequence `\` + quote.
      if (c === "\\" && text[j + 1] === quote) return { value: body, end: j + 2 };
      body += c;
      j += 1;
      continue;
    }
    if (c === "\\") {
      body += c + (text[j + 1] ?? "");
      j += 2;
      continue;
    }
    if (c === quote) return { value: body, end: j + 1 };
    body += c;
    j += 1;
  }
  return null;
}

/** Advance past whitespace and both comment forms. */
function skipTrivia(text: string, i: number): number {
  let j = i;
  for (;;) {
    while (j < text.length && /\s/.test(text[j] ?? "")) j += 1;
    if (text.startsWith("//", j)) {
      const nl = text.indexOf("\n", j);
      if (nl < 0) return text.length;
      j = nl + 1;
      continue;
    }
    if (text.startsWith("/*", j)) {
      const close = text.indexOf("*/", j);
      if (close < 0) return text.length;
      j = close + 2;
      continue;
    }
    return j;
  }
}

/**
 * Read the string literal, or the array of string literals, that follows a
 * matched key.
 *
 * IT SCANS RATHER THAN SLICING A WINDOW, and the earlier window is why. A fixed
 * 4 KB slice with `indexOf("]")` for the array's end got BOTH ends wrong: a `]`
 * inside a string (`"742 Evergreen Terrace [Apt 4]"`) or inside an index
 * expression (`names[0]`) ended the array early and dropped every member after
 * it, and an array whose closing bracket sat past the window dropped ALL of its
 * members rather than the tail. Both failed toward reporting nothing, which is
 * the direction this gate must never fail in. The scan tracks quoting and
 * bracket depth, and its bound is a character budget, so a pathological input
 * stops the scan instead of the file.
 *
 * A non-string member (a number, an identifier, a call) contributes nothing;
 * this recogniser reports on values the file actually spells out.
 */
function readLiteralValues(text: string, from: number): string[] {
  const limit = Math.min(text.length, from + LITERAL_SCAN_LIMIT);
  let i = skipTrivia(text, from);
  if (i >= limit) return [];

  const direct = readQuoted(text, i);
  if (direct !== null) return [decodeSourceEscapes(direct.value)];
  if (text[i] !== "[") return [];

  const out: string[] = [];
  let depth = 0;
  while (i < limit) {
    const c = text[i];
    if (c === "[") {
      depth += 1;
      i += 1;
      continue;
    }
    if (c === "]") {
      depth -= 1;
      if (depth === 0) return out;
      i += 1;
      continue;
    }
    const quoted = readQuoted(text, i);
    if (quoted !== null) {
      out.push(decodeSourceEscapes(quoted.value));
      i = quoted.end;
      continue;
    }
    i += 1;
  }
  // Unterminated within the budget: return what was read rather than nothing.
  return out;
}

/**
 * ENUMERATING A FILE BUYS THE SSN / EMAIL FLOOR AND NOTHING ELSE, so widening
 * the scope without widening this is half a fix.
 *
 * `scanTarget` reaches the structured scanner only for a fixture with a FHIR
 * wire-format extension, because that scanner assumes the FILE IS THE DOCUMENT.
 * A test builds its resources as TypeScript literals instead, so a real surname
 * typed as `family: "…"` inside a `.ts` file was read by NOTHING before this:
 * `scanCommonShapes` looks for a dashed SSN and an email and neither is a name,
 * a date of birth or a street address.
 *
 * THIS PACKAGE READS TWO WIRE FORMATS AND ITS TESTS WRITE BOTH, so there are two
 * arms. The object-literal arm covers `family: "…"`; the XML arm runs the same
 * `xmlValues` extractor the fixture scanner uses over the whole text, which
 * covers `<family value="…"/>` written inside a template literal. Keying only
 * the first was measured leaving 33 `family` / `given` and 3 `birthDate` XML
 * `value` attributes unread in the 55 files this scope widening admitted.
 *
 * SAY "TWO FORMATS", NEVER "BOTH SPELLINGS". That would be a claim about the
 * spellings WITHIN the XML format, and the XML arm covers ONE of the three this
 * suite uses: the double-quoted attribute. A single-quoted attribute
 * (`value='…'`) and XML ELEMENT TEXT (`<given>…</given>`) are both unread, and
 * the element-text case has a live site here. Declared in
 * `phi-scan-overrides.md` rather than guarded, and it is why the rename in
 * `test/dropped-element-text.test.ts` had a hand-renamed half: the scanner
 * forced only the `value=` one.
 *
 * This is IN ADDITION TO `scanCommonShapes`, never instead of it.
 *
 * WHAT IT DOES NOT COVER, stated as the set rather than as a universal:
 *
 *   - `text` is NOT keyed. `HumanName.text` and `Address.text` are PHI, but a
 *     flat pass cannot tell them from `CodeableConcept.text`, `Narrative.text`
 *     or an assertion message, all of which are ordinary in this suite. Keying
 *     it would false-error on conformant test code, which is the failure that
 *     gets a gate switched off.
 *   - `identifier.value` and `telecom.value` are NOT keyed, for the same reason
 *     and more sharply: bare `value` is the most overloaded key in FHIR
 *     (`Quantity.value`, `Extension.value[x]`, every primitive). The fixture XML
 *     scanner only dares read it inside a `<telecom>` / `<identifier>` block,
 *     and source has no equivalent boundary. So the XML arm here reads names,
 *     dates and address lines and deliberately not `<value value="…"/>`.
 *   - a value the file COMPUTES rather than spells (an identifier, a call, a
 *     `${…}` substitution) is not read, and neither is a computed KEY
 *     (`{ ["family"]: "…" }`).
 *   - a letter run between an `&` and a `;` is blanked with the entity
 *     references it is there to suppress, so it is not read either.
 *
 * So the two arms cover NAMES, DATES OF BIRTH AND STREET ADDRESSES spelled out
 * in source as an object-literal value or a double-quoted XML attribute. That is
 * not a claim that source is scanned as thoroughly as a fixture. Put a resource
 * that needs full coverage in `test/__fixtures__/`.
 */
function scanSourceLiterals(path: string, content: string, allow: AllowList, hits: Hit[]): void {
  const text = content.replace(TEMPLATE_SUBSTITUTION, " ").replace(XML_ENTITY_REF, " ");

  SOURCE_LITERAL_KEYS.lastIndex = 0;
  for (const m of text.matchAll(SOURCE_LITERAL_KEYS)) {
    const key = m[1];
    if (key === undefined || m.index === undefined) continue;
    for (const value of readLiteralValues(text, m.index + m[0].length)) {
      dispatchSourceValue(path, key, value, allow, hits);
    }
  }

  // The XML spelling. `xmlValues` is the same extractor the fixture XML scanner
  // uses, so the two formats are read by one rule rather than two that drift.
  for (const key of ["family", "given", "birthDate", "deceasedDateTime", "line"] as const) {
    for (const value of xmlValues(text, key)) {
      dispatchSourceValue(path, key, decodeSourceEscapes(value), allow, hits);
    }
  }
}

function dispatchSourceValue(
  path: string,
  key: string,
  value: string,
  allow: AllowList,
  hits: Hit[],
): void {
  switch (key) {
    case "family":
    case "given":
      checkNameString(path, `(source) name.${key}`, value, allow, hits);
      break;
    case "birthDate":
    case "deceasedDateTime":
      checkDate(path, `(source) ${key}`, value, allow, hits);
      break;
    case "line":
      checkAddressLine(path, "(source) address.line", value, allow, hits);
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// FHIR JSON structured scanner
// ---------------------------------------------------------------------------

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/** Scan a HumanName object/array. A string `name` is a resource label, skipped. */
function scanHumanName(
  node: unknown,
  path: string,
  location: string,
  allow: AllowList,
  hits: Hit[],
): void {
  if (Array.isArray(node)) {
    for (const item of node) scanHumanName(item, path, location, allow, hits);
    return;
  }
  if (!isRecord(node)) return; // a plain-string `name` is not a person
  for (const key of ["family", "text"] as const) {
    const v = node[key];
    if (typeof v === "string") checkNameString(path, `${location}.${key}`, v, allow, hits);
  }
  const given = node["given"];
  if (typeof given === "string") checkNameString(path, `${location}.given`, given, allow, hits);
  else if (Array.isArray(given)) {
    for (const g of given) {
      if (typeof g === "string") checkNameString(path, `${location}.given`, g, allow, hits);
    }
  }
  // prefix / suffix are honorifics / generational suffixes, not scanned.
}

function scanTelecom(
  node: unknown,
  path: string,
  location: string,
  allow: AllowList,
  hits: Hit[],
): void {
  if (Array.isArray(node)) {
    for (const item of node) scanTelecom(item, path, location, allow, hits);
    return;
  }
  if (!isRecord(node)) return;
  const v = node["value"];
  if (typeof v === "string") checkContactValue(path, `${location}.value`, v, allow, hits);
}

function scanAddress(
  node: unknown,
  path: string,
  location: string,
  allow: AllowList,
  hits: Hit[],
): void {
  if (Array.isArray(node)) {
    for (const item of node) scanAddress(item, path, location, allow, hits);
    return;
  }
  if (!isRecord(node)) return;
  const line = node["line"];
  if (typeof line === "string") checkAddressLine(path, `${location}.line`, line, allow, hits);
  else if (Array.isArray(line)) {
    for (const l of line) {
      if (typeof l === "string") checkAddressLine(path, `${location}.line`, l, allow, hits);
    }
  }
  const text = node["text"];
  if (typeof text === "string") checkAddressLine(path, `${location}.text`, text, allow, hits);
}

function scanIdentifier(
  node: unknown,
  path: string,
  location: string,
  allow: AllowList,
  hits: Hit[],
): void {
  if (Array.isArray(node)) {
    for (const item of node) scanIdentifier(item, path, location, allow, hits);
    return;
  }
  if (!isRecord(node)) return;
  const v = node["value"];
  if (typeof v === "string") checkContactValue(path, `${location}.value`, v, allow, hits);
}

/**
 * Walk the parsed resource. Known PHI-bearing element keys are dispatched to
 * their category detector; every value is then recursed into so a nested
 * resource (`contained`, `entry.resource`, an extension's `value[x]`) is reached.
 * The dispatch keys are never recursed *as* their category twice, the generic
 * recursion into e.g. a HumanName object visits `family` / `given` as bare
 * strings, which are not dispatch keys.
 */
function walkResource(
  node: unknown,
  path: string,
  location: string,
  allow: AllowList,
  hits: Hit[],
): void {
  if (Array.isArray(node)) {
    for (const item of node) walkResource(item, path, location, allow, hits);
    return;
  }
  if (!isRecord(node)) return;
  for (const [key, value] of Object.entries(node)) {
    const childLoc = `${location}.${key}`;
    switch (key) {
      case "name":
        scanHumanName(value, path, childLoc, allow, hits);
        break;
      case "telecom":
        scanTelecom(value, path, childLoc, allow, hits);
        break;
      case "address":
        scanAddress(value, path, childLoc, allow, hits);
        break;
      case "identifier":
        scanIdentifier(value, path, childLoc, allow, hits);
        break;
      case "birthDate":
      case "deceasedDateTime":
        if (typeof value === "string") checkDate(path, childLoc, value, allow, hits);
        break;
      default:
        break;
    }
    walkResource(value, path, childLoc, allow, hits);
  }
}

function rootLabel(node: unknown): string {
  if (isRecord(node) && typeof node["resourceType"] === "string") return node["resourceType"];
  return "resource";
}

function scanJsonText(target: Target, text: string, allow: AllowList, hits: Hit[]): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // A malformed / fragmentary leaked resource still gets the conservative pass.
    scanCommonShapes(target.label, text, allow, hits);
    return;
  }
  walkResource(parsed, target.label, rootLabel(parsed), allow, hits);
  scanCommonShapes(target.label, text, allow, hits);
}

function scanNdjsonText(target: Target, text: string, allow: AllowList, hits: Hit[]): void {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = (lines[i] ?? "").trim();
    if (line.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      scanCommonShapes(`${target.label}:${String(i + 1)}`, line, allow, hits);
      continue;
    }
    walkResource(parsed, `${target.label}:${String(i + 1)}`, rootLabel(parsed), allow, hits);
  }
  scanCommonShapes(target.label, text, allow, hits);
}

// ---------------------------------------------------------------------------
// FHIR XML structured scanner
// ---------------------------------------------------------------------------

/** Extract every `value` attribute of an element named `<tag …/>`. */
function xmlValues(text: string, tag: string): string[] {
  const re = new RegExp(`<${reEscape(tag)}\\b[^>]*\\bvalue="([^"]*)"`, "g");
  const out: string[] = [];
  for (const m of text.matchAll(re)) {
    if (m[1] !== undefined) out.push(m[1]);
  }
  return out;
}

function scanXmlText(target: Target, text: string, allow: AllowList, hits: Hit[]): void {
  // FHIR XML represents primitives as `<element value="…"/>`. Inspect only the
  // PHI-bearing element names, mirroring the JSON element map.
  for (const v of xmlValues(text, "family")) {
    checkNameString(target.label, "name.family", v, allow, hits);
  }
  for (const v of xmlValues(text, "given")) {
    checkNameString(target.label, "name.given", v, allow, hits);
  }
  for (const tag of ["birthDate", "deceasedDateTime"]) {
    for (const v of xmlValues(text, tag)) checkDate(target.label, tag, v, allow, hits);
  }
  for (const v of xmlValues(text, "line")) {
    checkAddressLine(target.label, "address.line", v, allow, hits);
  }
  // ContactPoint.value / Identifier.value serialize as `<value value="…"/>`, but
  // so does the overloaded `Quantity.value` (`<value value="70.0"/>`). Scope the
  // value scan to inside a `<telecom>` / `<identifier>` block so a numeric
  // measurement is never misread as a phone / SSN.
  for (const tag of ["telecom", "identifier"]) {
    const blockRe = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "g");
    for (const block of text.matchAll(blockRe)) {
      const inner = block[1] ?? "";
      for (const v of xmlValues(inner, "value")) {
        checkContactValue(target.label, `${tag}.value`, v, allow, hits);
      }
    }
  }
  scanCommonShapes(target.label, text, allow, hits);
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/**
 * WHICH DETECTOR A PATH DISPATCHES TO. A file gets the full structured FHIR scan
 * only when it is fixture-like (under `test/__fixtures__/`) with a FHIR
 * wire-format extension. Hand-written `src/` code, even a `.ts` file embedding a
 * `{"resourceType":"Patient",…}` example, gets the conservative dashed-SSN +
 * email pass instead, because a JSDoc `@example` carries synthetic names that
 * must not trip the structured detectors.
 *
 * THE ONE TABLE, read by `scanTarget` below and by the union route's dedup key.
 * It must not be duplicated: the dedup is only sound if it knows exactly what
 * the sweep would have run, and a second copy of this decision is how that stops
 * being true without a test noticing.
 */
function scanKindOf(path: string): "ndjson" | "xml" | "json" | "source" {
  if (!path.startsWith(FIXTURE_PREFIX)) return "source";
  if (path.endsWith(".ndjson")) return "ndjson";
  if (path.endsWith(".xml")) return "xml";
  if (path.endsWith(".json")) return "json";
  return "source";
}

/** The union route's dedup identity: the bytes AND what would be run on them. */
function scanIdentity(oid: string, path: string): string {
  return `${oid}\0${scanKindOf(path)}`;
}

function scanTarget(target: Target, allow: AllowList, hits: Hit[]): void {
  let buf: Buffer;
  try {
    buf = target.read();
  } catch (err) {
    throw new InvocationError(
      `could not read ${target.label}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const text = buf.toString("utf8");
  const kind = scanKindOf(target.path);
  if (kind === "ndjson") {
    scanNdjsonText(target, text, allow, hits);
  } else if (kind === "xml") {
    scanXmlText(target, text, allow, hits);
  } else if (kind === "json") {
    scanJsonText(target, text, allow, hits);
  } else {
    // Non-fixture target (hand-written source, or a non-FHIR fixture file):
    // no structured model to lean on, so the shape pass AND the FHIR-keyed
    // literal recogniser. BOTH, not either: the shape pass alone is the
    // SSN / email floor, which is what enumerating a source file buys on its
    // own, and a name is neither.
    scanCommonShapes(target.label, text, allow, hits);
    scanSourceLiterals(target.label, text, allow, hits);
  }
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function report(hits: Hit[]): void {
  if (hits.length === 0) {
    process.stdout.write("[phi-scan] OK, no hits\n");
    return;
  }
  const byPath = new Map<string, Hit[]>();
  for (const h of hits) {
    const arr = byPath.get(h.path);
    if (arr) arr.push(h);
    else byPath.set(h.path, [h]);
  }
  for (const [path, group] of byPath) {
    process.stderr.write(`[phi-scan] HIT: ${path}\n`);
    for (const h of group) {
      process.stderr.write(
        `  element=${h.location} value=${JSON.stringify(h.value)} (${h.reason})\n`,
      );
    }
  }
  process.stderr.write(
    `[phi-scan] ${String(hits.length)} hit(s) across ${String(byPath.size)} file(s). ` +
      `If a value is genuinely synthetic, declare it in scripts/phi-allow-list.txt OR ` +
      `run with --allow-fixture <path> AND log it in phi-scan-overrides.md.\n`,
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): number {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
    validateAllowFixtures(args.allowFixtures);
  } catch (err) {
    if (err instanceof InvocationError) {
      process.stderr.write(`[phi-scan] ${err.message}\n`);
      return 2;
    }
    throw err;
  }

  const allowed = new Set<string>(args.allowFixtures.map(normalizePath));

  // `loadAllowList()` is INSIDE this try. It used to sit outside every one of
  // them, so a missing or unreadable allow-list threw all the way out of `main`
  // and node exited 1, which is this gate's code for HITS FOUND: a scan that
  // never started reported as a scan that found PHI. Nothing downstream reads
  // the difference today (both are non-zero, so the gate still blocks), but a
  // caller that ever splits them would read it exactly backwards.
  let allow: AllowList;
  let targets: Target[];
  try {
    allow = loadAllowList();
    if (args.mode === "staged") targets = buildTargetsForStaged();
    else if (args.mode === "paths") targets = buildTargetsForPaths(args.paths);
    else targets = buildTargetsForAll();
  } catch (err) {
    if (err instanceof InvocationError) {
      process.stderr.write(`[phi-scan] ${err.message}\n`);
      return 2;
    }
    throw err;
  }

  targets = targets.filter((t) => !allowed.has(t.path));

  // The declared sentinel files are subtracted from the SWEEPING routes only. A
  // path named explicitly on the command line is still scanned, because that is
  // the caller's own request to read whatever is there and it errs toward
  // scanning more. Skipping is announced rather than silent: an exemption
  // nobody sees is the same shape of blind spot this gate exists to refuse.
  if (args.mode !== "paths") {
    // DEDUPED: a declared path can arrive from the walk AND from the index (they
    // are separate targets by design, since the two copies can differ), and
    // announcing it twice reads as two exemptions rather than one.
    const skipped = [
      ...new Set(targets.filter((t) => SENTINEL_FILES.has(t.path)).map((t) => t.path)),
    ];
    if (skipped.length > 0) {
      process.stdout.write(
        `[phi-scan] skipping ${String(skipped.length)} declared sentinel file(s): ` +
          `${skipped.join(", ")}\n`,
      );
      targets = targets.filter((t) => !SENTINEL_FILES.has(t.path));
    }
  }

  const hits: Hit[] = [];
  for (const t of targets) {
    try {
      scanTarget(t, allow, hits);
    } catch (err) {
      if (err instanceof InvocationError) {
        process.stderr.write(`[phi-scan] ${err.message}\n`);
        return 2;
      }
      throw err;
    }
  }

  report(hits);
  return hits.length === 0 ? 0 : 1;
}

/**
 * A SCAN THAT FAILED ANYWHERE INSIDE `main()` EXITS 2, NOT 1. Node exits 1 on an
 * uncaught throw and 1 is this gate's code for HITS FOUND, so any failure that is
 * not an `InvocationError` used to be reported to CI and to the developer as a
 * finding. Every anticipated failure already returns 2 from `main`; this is the
 * backstop for the rest (an `EACCES` on the allow-list, a `git` binary that is
 * not there).
 *
 * NAME THE WINDOW RATHER THAN SAYING "NEVER 1": this net wraps the CALL to
 * `main()`, so it covers everything that runs inside it and nothing before it.
 * A throw at module load, or a failure in the `tsx` / `node` runner itself,
 * still exits 1 and no wrapper placed here could change that.
 *
 * The net is here rather than a `catch` per call site deliberately: the property
 * wanted is about the PROCESS's exit code, and a per-site list is the thing that
 * goes stale the next time a call is added. The stack is printed because at this
 * point the scanner does not know what went wrong, and a refusal a developer
 * cannot act on is the refusal they learn to bypass.
 */
let exitCode: number;
try {
  exitCode = main();
} catch (err) {
  process.stderr.write(
    `[phi-scan] refusing the scan: it failed with an unexpected error, so it observed less than ` +
      `it enumerated: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
  );
  exitCode = 2;
}
process.exit(exitCode);
