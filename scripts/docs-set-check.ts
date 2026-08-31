/**
 * The documentation-set gate: grades everything under `docs-content/` against the package as it
 * actually exists in this repository.
 *
 * `docs-content/` is the narrative content the docs site pulls from a release asset and publishes
 * verbatim. Three properties make an unguarded edit there expensive:
 *
 *   1. The site is an MDX build and its failure is GLOBAL. One unescaped brace in this package's
 *      content stops the whole site deploying, so brace safety is graded here rather than discovered
 *      at deploy time.
 *   2. The PHI scanner does not read `.md` (see `phi-scan-overrides.md`), so `pnpm phi-scan` reads
 *      this directory as clean by construction rather than by inspection. The synthetic-identifier
 *      arm below is the only thing standing between an example value and a public page.
 *   3. Prose drifts away from code silently. Every claim this gate can tie to a fact in the
 *      repository (`package.json` fields, the exported issue-code tables, the compiler) is tied to
 *      it, so a rewrite of the package reds the docs instead of quietly outdating them.
 *
 * Two entry points, one implementation:
 *   `checkDocsSet(dir, options)`   the pure function; returns findings, throws nothing for content
 *   `tsx scripts/docs-set-check.ts [dir]`   the CLI, exits non-zero and prints every finding
 *
 * The vitest wrapper (`test/docs-set.test.ts`) runs the pure function over the real directory AND
 * over seeded control directories, one per arm, so every arm is proven able to go red on every run.
 * A gate whose red path is never exercised is a gate that has not been shown to work.
 *
 * NO NEW DEPENDENCY. Everything here is `node:*`, `typescript` (already a devDependency, already used
 * by `test/model-edges.test.ts`) and `tsx` (already the runner for `scripts/phi-scan.ts`).
 *
 * @packageDocumentation
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import * as fhir from "../src/index.js";

/** The package root, derived from this file's own location so any working directory works. */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** One graded property of the documentation set. Every arm is independently seedable. */
export const ARMS = [
  "mdx-braces",
  "links",
  "package-agreement",
  "synthetic-identifiers",
  "stale-assertions",
  "coverage",
  "code-tokens",
  "samples",
] as const;

/** One of the {@link ARMS}. */
export type ArmName = (typeof ARMS)[number];

/** A single graded failure: which arm, which file, which line, and what is wrong. */
export interface Finding {
  readonly arm: ArmName;
  readonly file: string;
  readonly line: number;
  readonly message: string;
}

/** Inputs a caller can redirect, so a seeded control directory is graded exactly like the real one. */
export interface CheckOptions {
  /** Grade only these arms (default: all of {@link ARMS}). */
  readonly arms?: readonly ArmName[];
  /** The `package.json` the installation page is graded against. */
  readonly packageJsonPath?: string;
  /** The synthetic-identifier declaration file. */
  readonly allowListPath?: string;
  /** The package entry point samples are compiled and run against. */
  readonly sourceIndexPath?: string;
  /** The `tsx` binary that runs the samples. */
  readonly tsxPath?: string;
}

// ---------------------------------------------------------------------------
// Page model
// ---------------------------------------------------------------------------

/** One line of a page, classified by the two contexts that change how it is read. */
interface LineInfo {
  readonly number: number;
  readonly text: string;
  /** Inside a fenced code block (the fence lines themselves are not). */
  readonly inFence: boolean;
  /** The info string of the enclosing fence (`ts`, `json`, ...), empty outside one. */
  readonly fenceLang: string;
  /** Inside the leading YAML frontmatter block. */
  readonly inFrontmatter: boolean;
}

/** A content page: its identity, its text, and its lines already classified. */
interface DocPage {
  readonly file: string;
  readonly path: string;
  readonly id: string;
  readonly title: string;
  readonly text: string;
  readonly lines: readonly LineInfo[];
}

/** Split a page into lines, tracking fence and frontmatter context. */
function classifyLines(text: string): LineInfo[] {
  const out: LineInfo[] = [];
  let inFence = false;
  let fenceLang = "";
  let inFrontmatter = false;
  let frontmatterDone = false;
  const raw = text.split("\n");
  for (const [index, line] of raw.entries()) {
    const number = index + 1;
    if (!frontmatterDone && number === 1 && line.trim() === "---") {
      inFrontmatter = true;
      out.push({ number, text: line, inFence: false, fenceLang: "", inFrontmatter: true });
      continue;
    }
    if (inFrontmatter) {
      const closing = line.trim() === "---";
      out.push({ number, text: line, inFence: false, fenceLang: "", inFrontmatter: true });
      if (closing) {
        inFrontmatter = false;
        frontmatterDone = true;
      }
      continue;
    }
    const fence = /^\s*(?:```|~~~)\s*([A-Za-z0-9_-]*)\s*$/.exec(line);
    if (fence !== null) {
      if (inFence) {
        out.push({ number, text: line, inFence: false, fenceLang: "", inFrontmatter: false });
        inFence = false;
        fenceLang = "";
      } else {
        inFence = true;
        fenceLang = fence[1] ?? "";
        out.push({ number, text: line, inFence: false, fenceLang: "", inFrontmatter: false });
      }
      continue;
    }
    out.push({ number, text: line, inFence, fenceLang, inFrontmatter: false });
  }
  return out;
}

/** Read `key: value` pairs out of a page's leading frontmatter block (a flat subset is enough). */
function frontmatter(lines: readonly LineInfo[]): Map<string, string> {
  const found = new Map<string, string>();
  for (const line of lines) {
    if (!line.inFrontmatter || line.text.trim() === "---") continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line.text);
    if (match === null) continue;
    const key = match[1] ?? "";
    const value = (match[2] ?? "").trim().replace(/^["']|["']$/g, "");
    found.set(key, value);
  }
  return found;
}

/** Load every `.md` page in the content directory, in filename order. */
function loadPages(dir: string): DocPage[] {
  const pages: DocPage[] = [];
  for (const entry of readdirSync(dir).sort()) {
    if (!entry.endsWith(".md") && !entry.endsWith(".mdx")) continue;
    const path = join(dir, entry);
    const text = readFileSync(path, "utf8");
    const lines = classifyLines(text);
    const meta = frontmatter(lines);
    pages.push({
      file: entry,
      path,
      id: meta.get("id") ?? entry.replace(/\.mdx?$/, ""),
      title: meta.get("title") ?? "",
      text,
      lines,
    });
  }
  return pages;
}

// ---------------------------------------------------------------------------
// Arm: MDX brace safety
// ---------------------------------------------------------------------------

/**
 * A `{` or `}` outside a fenced code block is read by MDX as the start of an expression, and an
 * expression that does not compile fails the SITE build, not just this package's pages.
 *
 * The rule is deliberately stricter than MDX itself: an inline code span protects a brace from MDX,
 * but not from a later edit that unwraps it, and the fenced form always reads better in a doc that
 * is about a wire format. Braces belong in fences here.
 */
function checkBraces(pages: readonly DocPage[]): Finding[] {
  const findings: Finding[] = [];
  for (const page of pages) {
    for (const line of page.lines) {
      if (line.inFence || line.inFrontmatter) continue;
      const column = line.text.search(/[{}]/);
      if (column === -1) continue;
      findings.push({
        arm: "mdx-braces",
        file: page.file,
        line: line.number,
        message: `unescaped brace outside a fenced code block at column ${String(column + 1)}: ${line.text.trim()}`,
      });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Arm: links and sidebar entries
// ---------------------------------------------------------------------------

/** The sidebar as the site reads it: a `docs` array of page ids. */
function readSidebar(dir: string): { entries: string[]; error: string | undefined } {
  const path = join(dir, "sidebars.json");
  if (!existsSync(path)) return { entries: [], error: "sidebars.json is missing" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    return { entries: [], error: `sidebars.json is not valid JSON: ${String(err)}` };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { entries: [], error: "sidebars.json must be an object" };
  }
  const docs = (parsed as Record<string, unknown>)["docs"];
  if (!Array.isArray(docs)) return { entries: [], error: "sidebars.json needs a `docs` array" };
  const entries: string[] = [];
  for (const entry of docs) {
    if (typeof entry !== "string") {
      return { entries, error: "every `docs` entry must be a page id string" };
    }
    entries.push(entry);
  }
  return { entries, error: undefined };
}

/** Sidebar entries and relative links must both land on a page that is really there. */
function checkLinks(dir: string, pages: readonly DocPage[]): Finding[] {
  const findings: Finding[] = [];
  const byId = new Set(pages.map((p) => p.id));
  const byFile = new Set(pages.map((p) => p.file));
  const sidebar = readSidebar(dir);
  if (sidebar.error !== undefined) {
    findings.push({ arm: "links", file: "sidebars.json", line: 1, message: sidebar.error });
  }
  for (const [index, entry] of sidebar.entries.entries()) {
    if (byId.has(entry)) continue;
    findings.push({
      arm: "links",
      file: "sidebars.json",
      line: index + 1,
      message: `sidebar entry "${entry}" resolves to no page in this content directory`,
    });
  }
  const enumerated = new Set(sidebar.entries);
  for (const page of pages) {
    if (enumerated.has(page.id)) continue;
    findings.push({
      arm: "links",
      file: page.file,
      line: 1,
      message: `page "${page.id}" is not enumerated by sidebars.json, so no reader can navigate to it`,
    });
  }
  for (const page of pages) {
    for (const line of page.lines) {
      if (line.inFence || line.inFrontmatter) continue;
      for (const match of line.text.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
        const target = match[1] ?? "";
        if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) continue;
        const withoutAnchor = (target.split("#")[0] ?? "").replace(/^\.\//, "");
        if (withoutAnchor === "") continue;
        if (byFile.has(withoutAnchor) || byId.has(withoutAnchor.replace(/\.mdx?$/, ""))) continue;
        findings.push({
          arm: "links",
          file: page.file,
          line: line.number,
          message: `relative link target "${target}" is not a page in this content directory`,
        });
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Arm: agreement with package.json
// ---------------------------------------------------------------------------

/** The four installation facts, each read off `package.json` rather than believed from prose. */
interface PackageFacts {
  readonly name: string;
  readonly version: string;
  readonly isEsm: boolean;
  readonly hasCjs: boolean;
  readonly engines: string;
  readonly onPublicRegistry: boolean;
}

/** Read the installation facts off a `package.json`. */
function packageFacts(path: string): PackageFacts {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  const pkg = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  const engines = pkg["engines"];
  const nodeRange =
    typeof engines === "object" && engines !== null
      ? (engines as Record<string, unknown>)["node"]
      : undefined;
  const exportsMap = pkg["exports"];
  const dot =
    typeof exportsMap === "object" && exportsMap !== null
      ? (exportsMap as Record<string, unknown>)["."]
      : undefined;
  const version = typeof pkg["version"] === "string" ? pkg["version"] : "";
  return {
    name: typeof pkg["name"] === "string" ? pkg["name"] : "",
    version,
    isEsm: pkg["type"] === "module",
    hasCjs: typeof dot === "object" && dot !== null && "require" in (dot as Record<string, unknown>),
    engines: typeof nodeRange === "string" ? nodeRange : "",
    // WHY THE VERSION LADDER DECIDES THIS, AND WHAT IT COSTS.
    // "Can a reader install this from the public registry today" has no npm-native field: `private`
    // says whether publishing is ALLOWED, never whether it HAPPENED. What this repository does carry
    // is the pre-release ladder: the package sits on `0.0.x` precisely because no release has been
    // cut (CLAUDE.md, "Status": pre-alpha, unpublished, read the version from `package.json`). So the
    // ladder is the fact this arm keys on, and the day the version leaves `0.0.x` the expectation
    // flips and the installation page has to be rewritten before this gate goes green again. That is
    // the intended cost: a release forces a documentation review instead of silently outdating a
    // page that tells a reader the package cannot be installed.
    onPublicRegistry: pkg["private"] !== true && !/^0\.0\./.test(version),
  };
}

/** The two spellings of the registry answer. Exactly one must appear on the installation page. */
const REGISTRY_AVAILABLE = /is installable from the public npm registry today/;
const REGISTRY_UNAVAILABLE = /is not installable from the public npm registry today/;

/** Grade the installation page against `package.json` at this commit. */
function checkPackageAgreement(pages: readonly DocPage[], packageJsonPath: string): Finding[] {
  const findings: Finding[] = [];
  const page = pages.find((p) => p.id === "installation");
  if (page === undefined) {
    return [
      {
        arm: "package-agreement",
        file: "installation.md",
        line: 1,
        message: "no installation page to grade against package.json",
      },
    ];
  }
  const facts = packageFacts(packageJsonPath);
  const say = (message: string): void => {
    findings.push({ arm: "package-agreement", file: page.file, line: 1, message });
  };
  if (!page.text.includes(facts.name)) {
    say(`the installation page never names the package (package.json name is "${facts.name}")`);
  }
  if (facts.isEsm && !/\bESM\b/.test(page.text)) {
    say('package.json sets "type": "module" but the installation page never says the package is ESM');
  }
  if (facts.hasCjs && !/\bCommonJS\b/.test(page.text)) {
    say("the exports map offers a require condition but the page never mentions CommonJS");
  }
  if (facts.engines !== "" && !page.text.includes(facts.engines)) {
    say(`the installation page does not state the supported Node range "${facts.engines}"`);
  }
  const claimsAvailable = REGISTRY_AVAILABLE.test(page.text);
  const claimsUnavailable = REGISTRY_UNAVAILABLE.test(page.text);
  if (claimsAvailable === claimsUnavailable) {
    say(
      "the installation page must state exactly one of " +
        '"is installable from the public npm registry today" or ' +
        '"is not installable from the public npm registry today"',
    );
  } else if (claimsAvailable !== facts.onPublicRegistry) {
    say(
      `the page says the package ${claimsAvailable ? "is" : "is not"} installable from the public ` +
        `npm registry today, which disagrees with package.json (version "${facts.version}", ` +
        `private ${String(!facts.onPublicRegistry && claimsAvailable)})`,
    );
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Arm: synthetic identifiers
// ---------------------------------------------------------------------------

/** The positive declaration that every example value in this repository is synthetic. */
interface AllowList {
  readonly names: ReadonlySet<string>;
  readonly dobs: ReadonlySet<string>;
  readonly addrs: ReadonlySet<string>;
  readonly ids: ReadonlySet<string>;
  readonly idDigits: ReadonlySet<string>;
  readonly emailDomains: ReadonlySet<string>;
}

/** Strip everything but digits, the form the allow-list compares numeric values in. */
function digitsOf(value: string): string {
  return value.replace(/\D/g, "");
}

/** Parse `scripts/phi-allow-list.txt` (`<TAG> <value>` per line, `#` comments ignored). */
function loadAllowList(path: string): AllowList {
  const names = new Set<string>();
  const dobs = new Set<string>();
  const addrs = new Set<string>();
  const ids = new Set<string>();
  const idDigits = new Set<string>();
  const emailDomains = new Set<string>();
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const space = line.indexOf(" ");
    if (space === -1) continue;
    const tag = line.slice(0, space);
    const value = line.slice(space + 1).trim();
    if (tag === "NAME") names.add(value.toUpperCase());
    else if (tag === "DOB") dobs.add(digitsOf(value));
    else if (tag === "ADDR") addrs.add(value.toLowerCase().replace(/\s+/g, " "));
    else if (tag === "ID") {
      ids.add(value.toUpperCase());
      if (digitsOf(value) !== "") idDigits.add(digitsOf(value));
    } else if (tag === "EMAILDOMAIN") emailDomains.add(value.toLowerCase());
  }
  return { names, dobs, addrs, ids, idDigits, emailDomains };
}

/** A value pulled out of an example, with the element that gave it its meaning. */
interface Candidate {
  readonly kind: "name" | "dob" | "addr" | "id" | "email";
  readonly value: string;
  readonly line: number;
}

/**
 * Every JSON-looking payload in a page: fenced `json` blocks, and the object literals a sample
 * embeds in a quoted or templated string.
 *
 * The embedded ones are matched by counting braces rather than by a regex, because a regex that
 * stops at the first `}` truncates every nested object, the truncation then fails to parse, and a
 * failed parse is silent: the whole structural half of the synthetic-identifier arm would read a
 * page carrying a nested `name` as clean.
 */
function jsonPayloads(page: DocPage): { text: string; line: number }[] {
  const payloads: { text: string; line: number }[] = [];
  let buffer: string[] = [];
  let start = 0;
  for (const line of page.lines) {
    if (line.inFence && line.fenceLang === "json") {
      if (buffer.length === 0) start = line.number;
      buffer.push(line.text);
      continue;
    }
    if (buffer.length > 0) {
      payloads.push({ text: buffer.join("\n"), line: start });
      buffer = [];
    }
  }
  if (buffer.length > 0) payloads.push({ text: buffer.join("\n"), line: start });
  for (const embedded of embeddedObjects(page.text)) payloads.push(embedded);
  return payloads;
}

/** Pull every `'{ ... }'` or backticked object literal out of a page, with the line it starts on. */
function embeddedObjects(text: string): { text: string; line: number }[] {
  const found: { text: string; line: number }[] = [];
  for (let index = 0; index < text.length - 1; index += 1) {
    const quote = text[index];
    if ((quote !== "'" && quote !== "`") || text[index + 1] !== "{") continue;
    let depth = 0;
    let inString = false;
    for (let scan = index + 1; scan < text.length; scan += 1) {
      const char = text[scan];
      if (inString) {
        if (char === "\\") scan += 1;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          found.push({
            text: text.slice(index + 1, scan + 1),
            line: text.slice(0, index).split("\n").length,
          });
          index = scan;
          break;
        }
      } else if (char === quote) break;
    }
  }
  return found;
}

/** Walk a parsed example and pull out every value FHIR gives an identifying meaning to. */
function walkJson(node: unknown, path: readonly string[], line: number, out: Candidate[]): void {
  if (Array.isArray(node)) {
    for (const item of node) walkJson(item, path, line, out);
    return;
  }
  if (typeof node === "object" && node !== null) {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      walkJson(value, [...path, key], line, out);
    }
    return;
  }
  if (typeof node !== "string") return;
  const key = path[path.length - 1] ?? "";
  const parent = path[path.length - 2] ?? "";
  const inside = (element: string): boolean => path.includes(element);
  if (key === "family" || key === "given" || key === "prefix" || key === "suffix") {
    out.push({ kind: "name", value: node, line });
  } else if (key === "text" && (parent === "name" || inside("name"))) {
    out.push({ kind: "name", value: node, line });
  } else if (key === "birthDate" || key === "deceasedDateTime") {
    out.push({ kind: "dob", value: node, line });
  } else if (key === "line" || (key === "text" && inside("address"))) {
    out.push({ kind: "addr", value: node, line });
  } else if (key === "value" && (inside("identifier") || inside("telecom"))) {
    out.push({ kind: "id", value: node, line });
  }
}

/**
 * Grade every example value against the synthetic declaration.
 *
 * TWO ROUTES, ON PURPOSE. The structural route parses each example and keys on the ELEMENT the value
 * sits at, which is exact. The shape route sweeps the whole page (prose included, because a page can
 * name an identifier in a sentence) for the shapes that identify a person regardless of element:
 * an email address, an SSN, and any run of nine or more digits.
 *
 * KNOWN AND DELIBERATE RESIDUAL: the shape route cannot tell a nine-digit clinical code from a
 * nine-digit identifier, so writing one into a page means either declaring it or naming the exported
 * constant instead. That is the same trade `scripts/phi-allow-list.txt` already documents, and it
 * fails in the safe direction.
 */
function checkSyntheticIdentifiers(pages: readonly DocPage[], allowListPath: string): Finding[] {
  const allow = loadAllowList(allowListPath);
  const findings: Finding[] = [];
  for (const page of pages) {
    const candidates: Candidate[] = [];
    for (const payload of jsonPayloads(page)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(payload.text);
      } catch {
        continue;
      }
      walkJson(parsed, [], payload.line, candidates);
    }
    for (const line of page.lines) {
      for (const match of line.text.matchAll(
        /<(family|given|prefix|suffix|birthDate|deceasedDateTime|line)\s+value="([^"]*)"/g,
      )) {
        const element = match[1] ?? "";
        const value = match[2] ?? "";
        const kind =
          element === "birthDate" || element === "deceasedDateTime"
            ? "dob"
            : element === "line"
              ? "addr"
              : "name";
        candidates.push({ kind, value, line: line.number });
      }
      for (const match of line.text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) {
        candidates.push({ kind: "email", value: match[0], line: line.number });
      }
      for (const match of line.text.matchAll(/\b\d{3}-\d{2}-\d{4}\b/g)) {
        candidates.push({ kind: "id", value: match[0], line: line.number });
      }
      for (const match of line.text.matchAll(/\+?\d[\d\s().-]{7,}\d/g)) {
        if (digitsOf(match[0]).length >= 9) {
          candidates.push({ kind: "id", value: match[0], line: line.number });
        }
      }
    }
    // One token, one finding, at the line a reader can see it on. The structural route and the shape
    // route deliberately overlap, so the same value can arrive twice; reporting it twice would only
    // make the shorter fix look like two.
    const reported = new Set<string>();
    for (const candidate of candidates) {
      const undeclared = undeclaredPart(candidate, allow);
      if (undeclared === undefined) continue;
      const key = `${candidate.kind}|${candidate.value}`;
      if (reported.has(key)) continue;
      reported.add(key);
      findings.push({
        arm: "synthetic-identifiers",
        file: page.file,
        line: lineOf(page, candidate.value, candidate.line),
        message: `${candidate.kind} value "${undeclared}" is not declared synthetic in scripts/phi-allow-list.txt`,
      });
    }
  }
  return findings;
}

/** The first line of a page carrying a value, so a finding points where the reader can see it. */
function lineOf(page: DocPage, value: string, fallback: number): number {
  for (const line of page.lines) {
    if (line.text.includes(value)) return line.number;
  }
  return fallback;
}

/** The part of a candidate the allow-list does not cover, or `undefined` when it is fully declared. */
function undeclaredPart(candidate: Candidate, allow: AllowList): string | undefined {
  const { kind, value } = candidate;
  if (kind === "name") {
    for (const token of value.split(/[^A-Za-z]+/)) {
      if (token.length < 2) continue;
      if (!allow.names.has(token.toUpperCase())) return token;
    }
    return undefined;
  }
  if (kind === "dob") return allow.dobs.has(digitsOf(value)) ? undefined : value;
  if (kind === "addr") {
    return allow.addrs.has(value.toLowerCase().replace(/\s+/g, " ")) ? undefined : value;
  }
  if (kind === "email") {
    const domain = (value.split("@")[1] ?? "").toLowerCase();
    return allow.emailDomains.has(domain) ? undefined : domain;
  }
  const digits = digitsOf(value);
  if (allow.ids.has(value.toUpperCase())) return undefined;
  if (digits !== "" && allow.idDigits.has(digits)) return undefined;
  return value;
}

// ---------------------------------------------------------------------------
// Arm: stale "unwritten" assertions
// ---------------------------------------------------------------------------

/** Phrases that assert a part of this documentation set does not exist yet. */
const STALE_PHRASES: readonly RegExp[] = [
  /\bnot written yet\b/i,
  /\b(?:is|are)\s+not\s+written\b/i,
  /\byet to be written\b/i,
  /\bto be written\b/i,
  /\bcoming soon\b/i,
  /\bstill to come\b/i,
  /\bgrowing stub\b/i,
  /\bTODO\b/,
];

/** Words that name a part of the documentation set, for the proximity rule. */
const DOC_NOUNS =
  /\b(?:documentation|docs|doc set|guide|guides|page|pages|section|spine|quickstart|installation|troubleshooting|core concepts)\b/i;

/** Words that, next to a documentation noun, assert absence. */
const ABSENCE_WORDS = /\b(?:unwritten|a stub|stubs|placeholder|forthcoming|not yet|not there)\b/i;

/**
 * A page that says a part of the set is unwritten while that part is present is worse than no page:
 * it sends the reader away from content that exists. Graded outside fences, so a sample may quote
 * such a sentence for illustration.
 */
function checkStaleAssertions(pages: readonly DocPage[]): Finding[] {
  const findings: Finding[] = [];
  for (const page of pages) {
    for (const line of page.lines) {
      if (line.inFence) continue;
      const hit = STALE_PHRASES.find((phrase) => phrase.test(line.text));
      if (hit !== undefined) {
        findings.push({
          arm: "stale-assertions",
          file: page.file,
          line: line.number,
          message: `asserts part of the documentation set is unwritten: ${line.text.trim()}`,
        });
        continue;
      }
      for (const sentence of line.text.split(/(?<=[.!?])\s+/)) {
        if (DOC_NOUNS.test(sentence) && ABSENCE_WORDS.test(sentence)) {
          findings.push({
            arm: "stale-assertions",
            file: page.file,
            line: line.number,
            message: `asserts part of the documentation set is unwritten: ${sentence.trim()}`,
          });
          break;
        }
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Arm: coverage
// ---------------------------------------------------------------------------

/** One thing a page has to carry, and the human name of the topic it stands for. */
interface Requirement {
  readonly topic: string;
  readonly needle: string;
  readonly caseInsensitive?: boolean;
}

/** A page the set is not complete without, with the topics that page owes its reader. */
interface RequiredPage {
  readonly id: string;
  readonly role: string;
  readonly requires: readonly Requirement[];
}

/**
 * The reading order of the set and the substance each page owes.
 *
 * Every needle here is a claim a reader arrives needing, not a style preference: the concept names
 * the package's own contracts are written in, and the coded reasons it emits. A rewrite that drops
 * one of these drops the reason the page exists.
 */
const REQUIRED_PAGES: readonly RequiredPage[] = [
  {
    id: "intro",
    role: "getting started",
    requires: [
      { topic: "the package name", needle: "@cosyte/fhir" },
      { topic: "a route into the rest of the set", needle: "quickstart", caseInsensitive: true },
    ],
  },
  {
    id: "installation",
    role: "installation",
    requires: [{ topic: "the install command", needle: "pnpm add", caseInsensitive: true }],
  },
  {
    id: "quickstart",
    role: "quickstart",
    requires: [
      { topic: "reading a document", needle: "parseResource" },
      { topic: "reading a clinical value off the resource", needle: "readObservationValue" },
      { topic: "a validation verdict", needle: "validateResource" },
      { topic: "the verdict field", needle: "valid" },
    ],
  },
  {
    id: "core-concepts",
    role: "core concepts",
    requires: [
      { topic: "the schema-free model", needle: "schema-free", caseInsensitive: true },
      { topic: "exact decimals", needle: "decimal" },
      { topic: "exact 64-bit integers", needle: "integer64" },
      { topic: "why they stay lexical", needle: "lexical", caseInsensitive: true },
      { topic: "the JSON codec", needle: "parseResource" },
      { topic: "the XML codec", needle: "parseResourceXml" },
      { topic: "the DOCTYPE refusal", needle: "DOCTYPE" },
      { topic: "the DOCTYPE refusal code", needle: "DTD_FORBIDDEN" },
      { topic: "the entity refusal code", needle: "UNDEFINED_ENTITY" },
      { topic: "the validation layers", needle: "validation layers", caseInsensitive: true },
      { topic: "the outcome contract", needle: "OperationOutcome" },
      { topic: "value-free diagnostics", needle: "value-free", caseInsensitive: true },
    ],
  },
  {
    id: "guides",
    role: "guides",
    requires: [
      { topic: "validating against a supplied profile", needle: "validateResource" },
      { topic: "caller-supplied profiles", needle: "profiles" },
      { topic: "the safety readout", needle: "readSafety" },
    ],
  },
  {
    id: "limits",
    role: "current limits",
    requires: [
      { topic: "no bundled terminology", needle: "terminology", caseInsensitive: true },
      { topic: "no bundled profile content", needle: "profile", caseInsensitive: true },
      { topic: "US Core is caller-supplied", needle: "US Core" },
      { topic: "caller-supplied profiles", needle: "caller-supplied", caseInsensitive: true },
      { topic: "no typed per-resource models", needle: "typed per-resource", caseInsensitive: true },
      { topic: "the unchecked invariant verdict", needle: "INVARIANT_UNCHECKED" },
      { topic: "the unchecked slice verdict", needle: "PROFILE_SLICE_UNCHECKED" },
    ],
  },
  {
    id: "troubleshooting",
    role: "troubleshooting",
    requires: [
      { topic: "a rejected DOCTYPE", needle: "DTD_FORBIDDEN" },
      { topic: "a duplicate JSON property", needle: "DUPLICATE_PROPERTY" },
      { topic: "an unknown modifierExtension", needle: "UNHANDLED_MODIFIER_EXTENSION" },
      { topic: "an unchecked invariant", needle: "INVARIANT_UNCHECKED" },
    ],
  },
];

/** Every troubleshooting entry has to end in an action, not just a diagnosis. */
const ACTION_HEADING = "What to do";

/** Grade the set for the pages and the substance a reader is promised. */
function checkCoverage(pages: readonly DocPage[]): Finding[] {
  const findings: Finding[] = [];
  const byId = new Map(pages.map((p) => [p.id, p]));
  for (const required of REQUIRED_PAGES) {
    const page = byId.get(required.id);
    if (page === undefined) {
      findings.push({
        arm: "coverage",
        file: `${required.id}.md`,
        line: 1,
        message: `the documentation set has no ${required.role} page (expected id "${required.id}")`,
      });
      continue;
    }
    if (page.title.trim() === "") {
      findings.push({
        arm: "coverage",
        file: page.file,
        line: 1,
        message: "the page has no title in its frontmatter",
      });
    }
    for (const requirement of required.requires) {
      const haystack = requirement.caseInsensitive === true ? page.text.toLowerCase() : page.text;
      const needle =
        requirement.caseInsensitive === true ? requirement.needle.toLowerCase() : requirement.needle;
      if (haystack.includes(needle)) continue;
      findings.push({
        arm: "coverage",
        file: page.file,
        line: 1,
        message: `the ${required.role} page does not cover ${requirement.topic} (expected "${requirement.needle}")`,
      });
    }
  }
  const troubleshooting = byId.get("troubleshooting");
  if (troubleshooting !== undefined) {
    for (const requirement of REQUIRED_PAGES.find((p) => p.id === "troubleshooting")?.requires ??
      []) {
      const section = sectionNaming(troubleshooting, requirement.needle);
      if (section === undefined) continue;
      if (section.body.includes(ACTION_HEADING)) continue;
      findings.push({
        arm: "coverage",
        file: troubleshooting.file,
        line: section.line,
        message: `the entry for ${requirement.needle} names no action (expected a "${ACTION_HEADING}" line)`,
      });
    }
  }
  return findings;
}

/** The `##` section of a page that names a token, as text plus its heading line. */
function sectionNaming(page: DocPage, token: string): { line: number; body: string } | undefined {
  const sections: { line: number; body: string[] }[] = [];
  for (const line of page.lines) {
    if (!line.inFence && /^##\s+/.test(line.text)) {
      sections.push({ line: line.number, body: [line.text] });
      continue;
    }
    const current = sections[sections.length - 1];
    if (current !== undefined) current.body.push(line.text);
  }
  for (const section of sections) {
    const body = section.body.join("\n");
    if (body.includes(token)) return { line: section.line, body };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Arm: code tokens
// ---------------------------------------------------------------------------

/** Every screaming-snake token the package really defines: export names plus code-table values. */
function knownCodeTokens(): Set<string> {
  const known = new Set<string>();
  for (const [name, value] of Object.entries(fhir)) {
    known.add(name);
    if (typeof value !== "object" || value === null) continue;
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      known.add(key);
      if (typeof entry === "string") known.add(entry);
    }
  }
  return known;
}

/**
 * A screaming-snake token in the docs is a promise that the package emits it. Grading those against
 * the package's own exported tables is what stops a page from documenting a code that was renamed,
 * or one that never existed.
 */
function checkCodeTokens(pages: readonly DocPage[]): Finding[] {
  const known = knownCodeTokens();
  const findings: Finding[] = [];
  for (const page of pages) {
    for (const line of page.lines) {
      if (line.inFrontmatter) continue;
      for (const match of line.text.matchAll(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g)) {
        const token = match[0];
        if (known.has(token)) continue;
        findings.push({
          arm: "code-tokens",
          file: page.file,
          line: line.number,
          message: `"${token}" is not an export or a coded reason this package defines`,
        });
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Arm: samples
// ---------------------------------------------------------------------------

/** One fenced TypeScript sample, kept with the page position it came from. */
interface Sample {
  readonly page: DocPage;
  /** The line of the opening fence, so a diagnostic can be reported where the reader sees it. */
  readonly fenceLine: number;
  readonly body: readonly string[];
}

/** The preamble every extracted sample is compiled and run with (line count is load-bearing). */
const SAMPLE_PREAMBLE = [
  'import { deepStrictEqual } from "node:assert/strict";',
  "const __expect = (actual: unknown, expected: unknown, line: number): void => {",
  "  try {",
  "    deepStrictEqual(actual, expected);",
  "  } catch {",
  "    throw new Error(",
  "      `line ${String(line)}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,",
  "    );",
  "  }",
  "};",
  "void __expect;",
];

/** Pull every fenced `ts` sample out of the set. */
function collectSamples(pages: readonly DocPage[]): Sample[] {
  const samples: Sample[] = [];
  let body: string[] = [];
  let fenceLine = 0;
  let open = false;
  for (const page of pages) {
    for (const line of page.lines) {
      const isTsFence = line.inFence && (line.fenceLang === "ts" || line.fenceLang === "typescript");
      if (isTsFence) {
        if (!open) {
          open = true;
          fenceLine = line.number - 1;
          body = [];
        }
        body.push(line.text);
        continue;
      }
      if (open) {
        samples.push({ page, fenceLine, body });
        open = false;
      }
    }
    if (open) {
      samples.push({ page, fenceLine, body });
      open = false;
    }
  }
  return samples;
}

/**
 * Rewrite one sample into something that can be compiled and run outside the docs.
 *
 * Two rewrites, both line-count preserving so a diagnostic still points at the line the reader sees:
 *   - the public import specifier becomes the entry point in this repository, which is what "compiled
 *     against the package in this repository" means with no build step and no published tarball;
 *   - an expectation line (`expr; // => value`) becomes a runtime assertion, so a stated result is
 *     checked rather than believed.
 */
function rewriteSample(sample: Sample, sourceIndexPath: string): string {
  const lines = sample.body.map((line, index) => {
    const docLine = sample.fenceLine + index + 1;
    const expectation = /^(\s*)(.+);\s*\/\/\s*=>\s*(.+)$/.exec(line);
    if (expectation !== null) {
      const indent = expectation[1] ?? "";
      const expression = expectation[2] ?? "";
      const expected = expectation[3] ?? "";
      return `${indent}__expect(${expression}, (${expected}), ${String(docLine)});`;
    }
    return line.replace(/(["'])@cosyte\/fhir\1/g, `"${sourceIndexPath}"`);
  });
  return [...SAMPLE_PREAMBLE, ...lines].join("\n");
}

/** Map a line in a rewritten sample back to the line of the page the reader reads. */
function docLineFor(sample: Sample, sampleLine: number): number {
  return sample.fenceLine + (sampleLine - SAMPLE_PREAMBLE.length);
}

/** The compiler options samples are graded under: the repository's own, minus emit. */
function sampleCompilerOptions(): ts.CompilerOptions {
  return {
    target: ts.ScriptTarget.ES2023,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    lib: ["lib.es2023.d.ts"],
    types: ["node"],
    strict: true,
    noUncheckedIndexedAccess: true,
    exactOptionalPropertyTypes: true,
    noImplicitOverride: true,
    noFallthroughCasesInSwitch: true,
    noImplicitReturns: true,
    useUnknownInCatchVariables: true,
    esModuleInterop: true,
    resolveJsonModule: true,
    skipLibCheck: true,
    noEmit: true,
    typeRoots: [join(REPO_ROOT, "node_modules", "@types")],
  };
}

/**
 * Compile every sample, then run every sample.
 *
 * A sample that imports anything but the package's public entry point is refused before compilation:
 * a documented example that reaches into a deep path is teaching a consumer to import something the
 * `exports` map does not offer.
 */
function checkSamples(
  pages: readonly DocPage[],
  sourceIndexPath: string,
  tsxPath: string,
): Finding[] {
  const findings: Finding[] = [];
  for (const page of pages) {
    for (const payload of jsonPayloads(page)) {
      try {
        JSON.parse(payload.text);
      } catch (err) {
        findings.push({
          arm: "samples",
          file: page.file,
          line: payload.line,
          message: `the JSON sample here does not parse: ${String(err)}`,
        });
      }
    }
  }
  const samples = collectSamples(pages);
  for (const sample of samples) {
    for (const [index, line] of sample.body.entries()) {
      const importMatch = /\bfrom\s+["']([^"']+)["']/.exec(line);
      if (importMatch === null) continue;
      const specifier = importMatch[1] ?? "";
      if (specifier === "@cosyte/fhir" || specifier.startsWith("node:")) continue;
      findings.push({
        arm: "samples",
        file: sample.page.file,
        line: sample.fenceLine + index + 1,
        message: `sample imports "${specifier}"; documented samples may only import "@cosyte/fhir"`,
      });
    }
  }
  if (samples.length === 0) return findings;

  const dir = mkdtempSync(join(tmpdir(), "fhir-docs-samples-"));
  try {
    // `.mts`, so both the compiler and `tsx` read every sample as an ES module wherever the
    // temporary directory lands. A bare `.ts` in a directory with no `package.json` above it is read
    // as CommonJS, and the samples a consumer copies are ESM.
    const files = samples.map((sample, index) => {
      const path = join(dir, `sample-${String(index)}.mts`);
      writeFileSync(path, rewriteSample(sample, sourceIndexPath));
      return path;
    });
    findings.push(...compileSamples(samples, files));
    findings.push(...runSamples(samples, files, dir, tsxPath));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return findings;
}

/** Type-check the rewritten samples against the package source in this repository. */
function compileSamples(samples: readonly Sample[], files: readonly string[]): Finding[] {
  const program = ts.createProgram([...files], sampleCompilerOptions());
  const findings: Finding[] = [];
  const byPath = new Map(files.map((path, index) => [path, samples[index]]));
  for (const diagnostic of [
    ...program.getSemanticDiagnostics(),
    ...program.getSyntacticDiagnostics(),
  ]) {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
    const file = diagnostic.file;
    const sample = file === undefined ? undefined : byPath.get(file.fileName);
    if (file === undefined || sample === undefined) {
      findings.push({
        arm: "samples",
        file: file === undefined ? "docs-content" : basename(file.fileName),
        line: 1,
        message: `sample compilation failed: ${message}`,
      });
      continue;
    }
    const position = file.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
    findings.push({
      arm: "samples",
      file: sample.page.file,
      line: docLineFor(sample, position.line + 1),
      message: `sample does not compile: ${message}`,
    });
  }
  return findings;
}

/** What the sample runner prints, one record per sample. */
interface RunRecord {
  readonly index: number;
  readonly error: string | null;
}

/** Narrow one line of the runner's output. */
function asRunRecord(value: unknown): RunRecord | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record["index"] !== "number") return undefined;
  const error = record["error"];
  if (error !== null && typeof error !== "string") return undefined;
  return { index: record["index"], error };
}

/**
 * Run every sample once, in ONE `tsx` process.
 *
 * One process, not one per sample: the samples are cheap and the interpreter start-up is not, and a
 * gate nobody wants to wait for is a gate somebody deletes. Each sample is its own module, so a
 * binding declared in one cannot leak into the next, and a sample that throws is reported against
 * its own page rather than stopping the run.
 */
function runSamples(
  samples: readonly Sample[],
  files: readonly string[],
  dir: string,
  tsxPath: string,
): Finding[] {
  const runner = join(dir, "run-samples.mts");
  const body = [
    "const modules = [",
    ...files.map((path) => `  ${JSON.stringify(path)},`),
    "];",
    "const run = async (): Promise<void> => {",
    "  for (const [index, path] of modules.entries()) {",
    "    try {",
    "      await import(path);",
    "      console.log(JSON.stringify({ index, error: null }));",
    "    } catch (err) {",
    "      const message = err instanceof Error ? err.message : String(err);",
    "      console.log(JSON.stringify({ index, error: message }));",
    "    }",
    "  }",
    "};",
    "run().then(",
    "  () => process.exit(0),",
    "  (err: unknown) => {",
    "    console.error(err);",
    "    process.exit(1);",
    "  },",
    ");",
  ].join("\n");
  writeFileSync(runner, body);
  const run = spawnSync(tsxPath, [runner], { encoding: "utf8", cwd: REPO_ROOT });
  if (run.status !== 0) {
    return [
      {
        arm: "samples",
        file: "docs-content",
        line: 1,
        message: `the sample runner exited ${String(run.status)}: ${(run.stderr || run.stdout || "").trim()}`,
      },
    ];
  }
  const findings: Finding[] = [];
  const seen = new Set<number>();
  for (const line of run.stdout.split("\n")) {
    if (line.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const record = asRunRecord(parsed);
    if (record === undefined) continue;
    seen.add(record.index);
    const sample = samples[record.index];
    if (sample === undefined || record.error === null) continue;
    findings.push({
      arm: "samples",
      file: sample.page.file,
      line: sample.fenceLine,
      message: `sample threw when run: ${record.error}`,
    });
  }
  for (const [index, sample] of samples.entries()) {
    if (seen.has(index)) continue;
    findings.push({
      arm: "samples",
      file: sample.page.file,
      line: sample.fenceLine,
      message: "sample never reported a result, so it is not known to run",
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/**
 * Grade a documentation-set directory.
 *
 * @param dir - The content directory (the real one, or a seeded control).
 * @param options - Redirected inputs; every default points at this repository.
 * @returns Every finding, in arm then file then line order. An empty array is a pass.
 */
export function checkDocsSet(dir: string, options: CheckOptions = {}): Finding[] {
  const arms = new Set<ArmName>(options.arms ?? ARMS);
  const packageJsonPath = options.packageJsonPath ?? join(REPO_ROOT, "package.json");
  const allowListPath = options.allowListPath ?? join(REPO_ROOT, "scripts", "phi-allow-list.txt");
  const sourceIndexPath = options.sourceIndexPath ?? join(REPO_ROOT, "src", "index.js");
  const tsxPath = options.tsxPath ?? join(REPO_ROOT, "node_modules", ".bin", "tsx");
  const pages = loadPages(dir);
  const findings: Finding[] = [];
  if (arms.has("mdx-braces")) findings.push(...checkBraces(pages));
  if (arms.has("links")) findings.push(...checkLinks(dir, pages));
  if (arms.has("package-agreement")) {
    findings.push(...checkPackageAgreement(pages, packageJsonPath));
  }
  if (arms.has("synthetic-identifiers")) {
    findings.push(...checkSyntheticIdentifiers(pages, allowListPath));
  }
  if (arms.has("stale-assertions")) findings.push(...checkStaleAssertions(pages));
  if (arms.has("coverage")) findings.push(...checkCoverage(pages));
  if (arms.has("code-tokens")) findings.push(...checkCodeTokens(pages));
  if (arms.has("samples")) findings.push(...checkSamples(pages, sourceIndexPath, tsxPath));
  return findings.sort(
    (a, b) => a.arm.localeCompare(b.arm) || a.file.localeCompare(b.file) || a.line - b.line,
  );
}

/** Render one finding the way the CLI prints it. */
export function formatFinding(finding: Finding): string {
  return `${finding.file}:${String(finding.line)} [${finding.arm}] ${finding.message}`;
}

/** The CLI: grade a directory, print every finding, exit non-zero when there is one. */
function main(argv: readonly string[]): number {
  const dir = argv[0] ?? join(REPO_ROOT, "docs-content");
  if (!existsSync(dir)) {
    console.error(`docs-set-check: no such content directory: ${dir}`);
    return 1;
  }
  const findings = checkDocsSet(dir);
  for (const finding of findings) console.error(formatFinding(finding));
  if (findings.length > 0) {
    console.error("");
    console.error(`docs-set-check: ${String(findings.length)} finding(s) in ${dir}`);
    return 1;
  }
  console.log(`docs-set-check: OK (${dir})`);
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
