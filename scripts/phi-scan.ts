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
import { join, resolve, relative, sep, isAbsolute } from "node:path";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const REPO_ROOT = process.cwd();
const ALLOW_LIST_PATH = join(REPO_ROOT, "scripts", "phi-allow-list.txt");
const OVERRIDE_LOG_PATH = join(REPO_ROOT, "phi-scan-overrides.md");

// Roots walked in "all" mode. `test/__fixtures__` gets the full FHIR-aware scan;
// `src` gets a conservative text pass (dashed-SSN + non-test email only) because
// it is hand-written code, not data, JSDoc `@example` FHIR snippets carry
// synthetic names / ids that must not trip the structured detectors. `test/*.ts`
// is deliberately NOT walked: the PHI-leak suite ships a sentinel battery of
// deliberately PHI-shaped strings to prove the redaction contract, and scanning
// it would flag the very sentinels that exist to be flagged elsewhere.
const FIXTURE_ROOT = join(REPO_ROOT, "test", "__fixtures__");
const SRC_ROOT = join(REPO_ROOT, "src");

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
  path: string; // forward-slash repo-relative path for reporting
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

function buildTargetsForAll(): Target[] {
  const files: string[] = [];
  const unscannable: Unscannable[] = [];
  walk(FIXTURE_ROOT, files, unscannable);
  walk(SRC_ROOT, files, unscannable);

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

  return files
    .filter((abs) => !ignored.has(normalizePath(abs)))
    .map((abs) => ({ path: normalizePath(abs), read: () => readFileSync(abs) }));
}

function buildTargetsForPaths(paths: string[]): Target[] {
  return paths.map((p) => {
    const abs = isAbsolute(p) ? p : resolve(REPO_ROOT, p);
    if (!existsSync(abs)) throw new InvocationError(`File not found: ${p}`);
    if (!statSync(abs).isFile()) throw new InvocationError(`Not a regular file: ${p}`);
    return { path: normalizePath(abs), read: () => readFileSync(abs) };
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
  const inScope = staged.filter(
    (s) =>
      s.path === "test/__fixtures__" ||
      s.path.startsWith("test/__fixtures__/") ||
      s.path === "src" ||
      (s.path.startsWith("src/") && s.path.endsWith(".ts")),
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
  for (const m of content.matchAll(/\b[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g)) {
    const domain = (m[1] ?? "").toLowerCase();
    if (!allow.emailDomains.has(domain)) {
      hits.push({ path, location: "(email)", value: m[0], reason: "email with non-test domain" });
    }
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
    scanCommonShapes(target.path, text, allow, hits);
    return;
  }
  walkResource(parsed, target.path, rootLabel(parsed), allow, hits);
  scanCommonShapes(target.path, text, allow, hits);
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
      scanCommonShapes(`${target.path}:${String(i + 1)}`, line, allow, hits);
      continue;
    }
    walkResource(parsed, `${target.path}:${String(i + 1)}`, rootLabel(parsed), allow, hits);
  }
  scanCommonShapes(target.path, text, allow, hits);
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
    checkNameString(target.path, "name.family", v, allow, hits);
  }
  for (const v of xmlValues(text, "given")) {
    checkNameString(target.path, "name.given", v, allow, hits);
  }
  for (const tag of ["birthDate", "deceasedDateTime"]) {
    for (const v of xmlValues(text, tag)) checkDate(target.path, tag, v, allow, hits);
  }
  for (const v of xmlValues(text, "line")) {
    checkAddressLine(target.path, "address.line", v, allow, hits);
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
        checkContactValue(target.path, `${tag}.value`, v, allow, hits);
      }
    }
  }
  scanCommonShapes(target.path, text, allow, hits);
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/**
 * A file gets the full structured FHIR scan only when it is fixture-like (under
 * `test/__fixtures__/`) with a FHIR wire-format extension. Hand-written `src/`
 * code, even a `.ts` file embedding a `{"resourceType":"Patient",…}` example,
 * gets the conservative dashed-SSN + email pass instead, because a JSDoc
 * `@example` carries synthetic names that must not trip the structured detectors.
 */
function scanTarget(target: Target, allow: AllowList, hits: Hit[]): void {
  let buf: Buffer;
  try {
    buf = target.read();
  } catch (err) {
    throw new InvocationError(
      `could not read ${target.path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const text = buf.toString("utf8");
  const isFixture = target.path.startsWith("test/__fixtures__/");
  if (isFixture && target.path.endsWith(".ndjson")) {
    scanNdjsonText(target, text, allow, hits);
  } else if (isFixture && target.path.endsWith(".xml")) {
    scanXmlText(target, text, allow, hits);
  } else if (isFixture && target.path.endsWith(".json")) {
    scanJsonText(target, text, allow, hits);
  } else {
    // Non-fixture target (hand-written src, or a non-FHIR fixture file):
    // conservative shape pass only, no structured model to lean on.
    scanCommonShapes(target.path, text, allow, hits);
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
