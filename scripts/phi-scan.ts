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
 */

import { readFileSync, statSync, existsSync, readdirSync } from "node:fs";
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

function walk(dir: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      walk(full, out);
    } else if (e.isFile()) {
      // README/markdown docs may legitimately describe violator values; they
      // are documentation, not fixtures.
      if (e.name.toLowerCase().endsWith(".md")) continue;
      out.push(full);
    }
  }
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
  walk(FIXTURE_ROOT, files);
  walk(SRC_ROOT, files);
  const ignored = gitIgnored(files);
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

function buildTargetsForStaged(): Target[] {
  let listBuf: Buffer;
  try {
    // SECURITY: array-form execFileSync, no shell.
    listBuf = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=AM", "-z"], {
      encoding: "buffer",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    throw new InvocationError(
      `git diff --cached failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const list = listBuf
    .toString("utf8")
    .split("\0")
    .filter((p) => p.length > 0)
    .filter((p) => p.startsWith("test/__fixtures__/") || (p.startsWith("src/") && p.endsWith(".ts")));
  return list.map((relPath) => ({
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
function scanHumanName(node: unknown, path: string, location: string, allow: AllowList, hits: Hit[]): void {
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

function scanTelecom(node: unknown, path: string, location: string, allow: AllowList, hits: Hit[]): void {
  if (Array.isArray(node)) {
    for (const item of node) scanTelecom(item, path, location, allow, hits);
    return;
  }
  if (!isRecord(node)) return;
  const v = node["value"];
  if (typeof v === "string") checkContactValue(path, `${location}.value`, v, allow, hits);
}

function scanAddress(node: unknown, path: string, location: string, allow: AllowList, hits: Hit[]): void {
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

function scanIdentifier(node: unknown, path: string, location: string, allow: AllowList, hits: Hit[]): void {
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
function walkResource(node: unknown, path: string, location: string, allow: AllowList, hits: Hit[]): void {
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

  const allow = loadAllowList();
  const allowed = new Set<string>(args.allowFixtures.map(normalizePath));

  let targets: Target[];
  try {
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

process.exit(main());
