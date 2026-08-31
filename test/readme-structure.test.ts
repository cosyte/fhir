/**
 * README.md is published to two surfaces that cannot be corrected afterwards: the repository front
 * page, and the npm package page, where the file is baked into the tarball at publish time. This
 * suite holds its structure, the provenance of every value its examples show, and its link rules, so
 * that an edit which drops a required section, writes a dead link, names an identifier the package
 * does not export, or introduces a value that is not demonstrably synthetic reds here instead of
 * shipping.
 *
 * WHY A TEST AND NOT THE PHI SCANNER. `scripts/phi-scan.ts` deliberately excludes every `.md` path
 * on both of its enumerating routes, and its walk roots are `test/` and `src/`, so
 * `pnpm phi-scan` returns exit 0 over a README carrying a real name, date of birth or identifier.
 * The example-provenance block below is the only gate on that surface. Read
 * `phi-scan-overrides.md` before assuming otherwise.
 *
 * EVERY CHECK IS A PURE FUNCTION OVER MARKDOWN TEXT, and each is asserted twice: once against the
 * real README (which must report nothing) and once against a crafted violating sample (which must
 * report the offender BY NAME). A checker that cannot see is worse than no checker, so the second
 * half is not optional.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import * as publicApi from "../src/index.js";

const README_URL = new URL("../README.md", import.meta.url);
const README = readFileSync(README_URL, "utf8");

const PACKAGE_JSON = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { readonly name: string; readonly description: string };

/** The banner block, byte for byte. The tiles and the alt string are owned by the assets repo. */
const BANNER = [
  '<a href="https://cosyte.com">',
  "  <picture>",
  '    <source media="(prefers-color-scheme: dark)" srcset="https://cosyte.com/tile/cosyte-lockup-tile-on-dark-1200x300.png">',
  '    <img alt="The Cosyte logo on its own white ground: the icon beside the word Cosyte." src="https://cosyte.com/tile/cosyte-lockup-tile-on-light-1200x300.png">',
  "  </picture>",
  "</a>",
].join("\n");

const ALT_TEXT = "The Cosyte logo on its own white ground: the icon beside the word Cosyte.";

const REQUIRED_SECTIONS = [
  "Why this exists",
  "Status",
  "Install",
  "Usage",
  "PHI and safety",
  "Contributing",
  "License",
] as const;

// ---------------------------------------------------------------------------
// Markdown outline
// ---------------------------------------------------------------------------

interface Fence {
  readonly lang: string;
  readonly body: string;
}

interface Heading {
  readonly level: number;
  readonly text: string;
  readonly index: number;
}

interface Outline {
  readonly lines: readonly string[];
  readonly fences: readonly Fence[];
  readonly headings: readonly Heading[];
  /** `lines`, with every line inside a fenced code block blanked. Index-aligned with `lines`. */
  readonly prose: readonly string[];
}

function outlineOf(markdown: string): Outline {
  const lines = markdown.split("\n");
  const fences: Fence[] = [];
  const headings: Heading[] = [];
  const prose: string[] = [];
  let open: { lang: string; body: string[] } | null = null;

  for (const [index, line] of lines.entries()) {
    const fence = /^```(.*)$/.exec(line);
    if (fence !== null) {
      if (open === null) open = { lang: (fence[1] ?? "").trim(), body: [] };
      else {
        fences.push({ lang: open.lang, body: open.body.join("\n") });
        open = null;
      }
      prose.push("");
      continue;
    }
    if (open !== null) {
      open.body.push(line);
      prose.push("");
      continue;
    }
    prose.push(line);
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading !== null) {
      headings.push({
        level: (heading[1] ?? "").length,
        text: (heading[2] ?? "").trim(),
        index,
      });
    }
  }
  return { lines, fences, headings, prose };
}

function sectionBody(outline: Outline, title: string): string | null {
  const head = outline.headings.find((h) => h.level === 2 && h.text === title);
  if (head === undefined) return null;
  const next = outline.headings.find((h) => h.level <= 2 && h.index > head.index);
  const end = next === undefined ? outline.lines.length : next.index;
  return outline.lines
    .slice(head.index + 1, end)
    .join("\n")
    .trim();
}

/** GitHub's heading-anchor slug, enough of it for the headings this file carries. */
function slugOf(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N} -]/gu, "")
    .trim()
    .replace(/ +/g, "-");
}

// ---------------------------------------------------------------------------
// Checkers. Each returns a list of problems, each problem naming its offender.
// ---------------------------------------------------------------------------

function sectionProblems(markdown: string): string[] {
  const outline = outlineOf(markdown);
  const h2 = outline.headings.filter((h) => h.level === 2).map((h) => h.text);
  const problems: string[] = [];

  for (const name of REQUIRED_SECTIONS) {
    if (!h2.includes(name)) problems.push(`missing required section: ## ${name}`);
  }

  const present = REQUIRED_SECTIONS.filter((name) => h2.includes(name));
  for (let i = 1; i < present.length; i += 1) {
    const before = present[i - 1] ?? "";
    const here = present[i] ?? "";
    if (h2.indexOf(here) < h2.indexOf(before)) {
      problems.push(`section out of order: ## ${here} must come after ## ${before}`);
    }
  }

  for (const name of present) {
    const body = sectionBody(outline, name);
    if (body === null || body === "") problems.push(`empty section body: ## ${name}`);
  }

  const last = h2.at(-1);
  if (h2.includes("License") && last !== "License") {
    problems.push(`## License must be the last H2, but the last H2 is ## ${last ?? "(none)"}`);
  }
  return problems;
}

function tableOfContentsProblems(markdown: string): string[] {
  const outline = outlineOf(markdown);
  if (outline.lines.length <= 100) return [];

  const entries: string[] = [];
  let started = false;
  for (const line of outline.prose) {
    const item = /^-\s+\[[^\]]+\]\((#[^)]*)\)\s*$/.exec(line);
    if (item !== null) {
      entries.push(item[1] ?? "");
      started = true;
      continue;
    }
    if (started) break;
  }

  if (entries.length === 0) {
    return ["the file is longer than 100 lines and carries no table of contents"];
  }

  const problems: string[] = [];
  const anchors = new Set(outline.headings.map((h) => `#${slugOf(h.text)}`));
  for (const target of entries) {
    if (!anchors.has(target)) {
      problems.push(`table-of-contents link resolves to no heading in this file: ${target}`);
    }
  }

  const expected = outline.headings
    .filter((h) => h.level === 2)
    .map((h) => `#${slugOf(h.text)}`)
    .join(" ");
  if (entries.join(" ") !== expected) {
    problems.push(
      `the table of contents must list every H2 in document order: it lists "${entries.join(" ")}" against headings "${expected}"`,
    );
  }
  return problems;
}

function linkProblems(markdown: string): string[] {
  const text = outlineOf(markdown).prose.join("\n");
  const targets: string[] = [];
  for (const m of text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) targets.push(m[1] ?? "");
  for (const m of text.matchAll(/(?:href|src|srcset)="([^"]*)"/g)) targets.push(m[1] ?? "");

  const problems: string[] = [];
  for (const target of targets) {
    if (target.startsWith("https://") || target.startsWith("#")) continue;
    problems.push(
      `link is neither an absolute https:// URL nor an in-file anchor, so it is dead inside the npm tarball: ${target}`,
    );
  }
  return problems;
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

function importedNames(body: string): string[] {
  const names: string[] = [];
  for (const m of body.matchAll(/import\s*\{([^}]*)\}\s*from\s*"@cosyte\/fhir"/g)) {
    for (const raw of (m[1] ?? "").split(",")) {
      const name = raw
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)[0];
      if (name !== undefined && name !== "") names.push(name.trim());
    }
  }
  return names;
}

function exampleIdentifierProblems(markdown: string, exported: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  for (const fence of outlineOf(markdown).fences) {
    if (fence.lang !== "ts") continue;
    const stripped = fence.body.replace(/import\s*\{[^}]*\}\s*from\s*"@cosyte\/fhir";?/g, "");
    for (const name of importedNames(fence.body)) {
      if (!IDENTIFIER.test(name)) {
        problems.push(`example imports something that is not an identifier: ${name}`);
        continue;
      }
      if (!exported.has(name)) {
        problems.push(
          `example imports \`${name}\` from @cosyte/fhir, which src/index.ts does not export`,
        );
        continue;
      }
      if (!new RegExp(`\\b${name}\\b`).test(stripped)) {
        problems.push(`example imports \`${name}\` and never uses it`);
      }
    }
  }
  return problems;
}

function apiListProblems(markdown: string, exported: ReadonlySet<string>): string[] {
  const body = sectionBody(outlineOf(markdown), "API");
  if (body === null) return [];
  const problems: string[] = [];
  for (const line of body.split("\n")) {
    if (!line.startsWith("- ")) continue;
    for (const m of line.matchAll(/`([A-Za-z_$][\w$]*)`/g)) {
      const name = m[1] ?? "";
      if (!exported.has(name)) {
        problems.push(`the API list names \`${name}\`, which src/index.ts does not export`);
      }
    }
  }
  return problems;
}

const EN_DASH = String.fromCodePoint(0x2013);
const EM_DASH = String.fromCodePoint(0x2014);

function dashProblems(markdown: string): string[] {
  const problems: string[] = [];
  for (const [index, line] of markdown.split("\n").entries()) {
    if (line.includes(EN_DASH)) problems.push(`en dash (U+2013) on line ${String(index + 1)}`);
    if (line.includes(EM_DASH)) problems.push(`em dash (U+2014) on line ${String(index + 1)}`);
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Example-value provenance
// ---------------------------------------------------------------------------

interface AllowList {
  readonly names: ReadonlySet<string>;
  readonly dobs: ReadonlySet<string>;
  readonly addresses: ReadonlySet<string>;
  readonly ids: ReadonlySet<string>;
  readonly emailDomains: ReadonlySet<string>;
}

function parseAllowList(text: string): AllowList {
  const names = new Set<string>();
  const dobs = new Set<string>();
  const addresses = new Set<string>();
  const ids = new Set<string>();
  const emailDomains = new Set<string>();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const at = line.indexOf(" ");
    if (at < 0) continue;
    const tag = line.slice(0, at);
    const value = line.slice(at + 1).trim();
    if (tag === "NAME") names.add(value.toUpperCase());
    else if (tag === "DOB") dobs.add(value.replace(/\D/g, ""));
    else if (tag === "ADDR") addresses.add(value.toUpperCase());
    else if (tag === "ID") {
      ids.add(value.toUpperCase());
      ids.add(value.replace(/\D/g, ""));
    } else if (tag === "EMAILDOMAIN") emailDomains.add(value.toLowerCase());
  }
  return { names, dobs, addresses, ids, emailDomains };
}

function readFixtureCorpus(dir: string, into: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) readFixtureCorpus(path, into);
    else if (entry.isFile()) into.push(readFileSync(path, "utf8"));
  }
}

const ALLOW_LIST = parseAllowList(
  readFileSync(new URL("../scripts/phi-allow-list.txt", import.meta.url), "utf8"),
);

const FIXTURE_CORPUS = ((): string => {
  const parts: string[] = [];
  readFixtureCorpus(fileURLToPath(new URL("./__fixtures__/", import.meta.url)), parts);
  return parts.join("\n");
})();

/**
 * A value the README shows that would be PHI if it were real, with the tag that says which allow-list
 * declaration would cover it.
 */
interface Candidate {
  readonly kind: "NAME" | "DOB" | "ADDR" | "ID" | "EMAIL";
  readonly value: string;
}

// The key alternations below deliberately never place a keyed word directly against a quote and a
// colon in this file's own bytes. `scripts/phi-scan.ts` keys its source recogniser on exactly that
// adjacency, so writing it here would make this gate's own patterns look like a fixture carrying a
// surname. Keep the closing parenthesis where it is.
const JSON_NAME_KEY = /["'](?:family|given|prefix|suffix)["']\s*:\s*(\[[^\]]*\]|"[^"]*")/g;
const XML_NAME_KEY = /<(?:family|given|prefix|suffix)\s+value="([^"]*)"/g;
const DATE = /\b\d{4}-\d{2}-\d{2}\b/g;
const STREET =
  /\b\d+\s+[A-Z][\w']*(?:\s+[A-Z][\w']*)*\s+(?:St|Street|Ave|Avenue|Rd|Road|Ln|Lane|Blvd|Boulevard|Dr|Drive|Way|Ct|Court)\b\.?/g;
const DASHED_SSN = /\b\d{3}-\d{2}-\d{4}\b/g;
const NINE_DIGITS = /\b\d{9}\b/g;
const CONTACT_RUN = /[+(]?\d[\d\s().-]{8,}\d/g;
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

function candidatesIn(markdown: string): Candidate[] {
  const found: Candidate[] = [];
  for (const m of markdown.matchAll(JSON_NAME_KEY)) {
    for (const part of (m[1] ?? "").matchAll(/"([^"]*)"/g)) {
      found.push({ kind: "NAME", value: part[1] ?? "" });
    }
  }
  for (const m of markdown.matchAll(XML_NAME_KEY)) found.push({ kind: "NAME", value: m[1] ?? "" });
  for (const m of markdown.matchAll(DATE)) found.push({ kind: "DOB", value: m[0] });
  for (const m of markdown.matchAll(STREET)) found.push({ kind: "ADDR", value: m[0] });
  for (const m of markdown.matchAll(DASHED_SSN)) found.push({ kind: "ID", value: m[0] });
  for (const m of markdown.matchAll(NINE_DIGITS)) found.push({ kind: "ID", value: m[0] });
  for (const m of markdown.matchAll(CONTACT_RUN)) {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length >= 10 && digits.length <= 15) found.push({ kind: "ID", value: m[0] });
  }
  for (const m of markdown.matchAll(EMAIL)) found.push({ kind: "EMAIL", value: m[0] });
  return found;
}

function declared(candidate: Candidate, allow: AllowList): boolean {
  const value = candidate.value.trim();
  if (value === "") return true;
  switch (candidate.kind) {
    case "NAME": {
      const tokens = value.split(/[^\p{L}]+/u).filter((t) => t !== "");
      return tokens.length > 0 && tokens.every((t) => allow.names.has(t.toUpperCase()));
    }
    case "DOB":
      return allow.dobs.has(value.replace(/\D/g, ""));
    case "ADDR":
      return allow.addresses.has(value.toUpperCase());
    case "ID":
      return allow.ids.has(value.toUpperCase()) || allow.ids.has(value.replace(/\D/g, ""));
    case "EMAIL": {
      const domain = value.split("@")[1];
      return domain !== undefined && allow.emailDomains.has(domain.toLowerCase());
    }
  }
}

function provenanceProblems(markdown: string, allow: AllowList, corpus: string): string[] {
  const problems: string[] = [];
  for (const candidate of candidatesIn(markdown)) {
    if (declared(candidate, allow)) continue;
    if (corpus.includes(candidate.value.trim())) continue;
    problems.push(
      `README example value "${candidate.value}" is neither declared ${candidate.kind} in scripts/phi-allow-list.txt nor present under test/__fixtures__/`,
    );
  }
  return problems;
}

// ---------------------------------------------------------------------------
// The README itself
// ---------------------------------------------------------------------------

const OUTLINE = outlineOf(README);
const PUBLIC_EXPORTS: ReadonlySet<string> = new Set(Object.keys(publicApi));

describe("README.md: the head of the file", () => {
  it("opens with the banner block, byte for byte, before any heading", () => {
    expect(README.startsWith(`${BANNER}\n`)).toBe(true);
    expect(README).toContain('<a href="https://cosyte.com">');
    expect(README).toContain(
      '<source media="(prefers-color-scheme: dark)" srcset="https://cosyte.com/tile/cosyte-lockup-tile-on-dark-1200x300.png">',
    );
    expect(README).toContain(
      'src="https://cosyte.com/tile/cosyte-lockup-tile-on-light-1200x300.png"',
    );

    const firstHeading = OUTLINE.headings[0];
    expect(firstHeading).toBeDefined();
    expect(firstHeading?.index ?? -1).toBeGreaterThan(BANNER.split("\n").length - 1);
  });

  it("carries the light tile's alt string exactly, and only that one", () => {
    const alts = [...README.matchAll(/alt="([^"]*)"/g)].map((m) => m[1] ?? "");
    expect(alts).toEqual([ALT_TEXT]);
  });

  it("has a single H1 equal to the npm package name", () => {
    const h1 = OUTLINE.headings.filter((h) => h.level === 1);
    expect(h1).toHaveLength(1);
    expect(h1[0]?.text).toBe(PACKAGE_JSON.name);
    expect(h1[0]?.text).toBe("@cosyte/fhir");
  });

  it("follows the H1 with a one-line blockquote tagline under 120 characters", () => {
    const h1Index = OUTLINE.headings.find((h) => h.level === 1)?.index ?? -1;
    expect(h1Index).toBeGreaterThanOrEqual(0);
    expect(OUTLINE.lines[h1Index + 1]).toBe("");
    const tagline = OUTLINE.lines[h1Index + 2] ?? "";
    expect(tagline.startsWith("> ")).toBe(true);
    expect(tagline.slice(2).length).toBeLessThan(120);
    // One line: the blockquote ends immediately.
    expect(OUTLINE.lines[h1Index + 3]).toBe("");
    // A tagline is a hook, not a restatement of the package description.
    expect(tagline.slice(2)).not.toBe(PACKAGE_JSON.description);
  });

  it("carries exactly four badges, newline-delimited, under no heading, in the house order", () => {
    const h1Index = OUTLINE.headings.find((h) => h.level === 1)?.index ?? -1;
    const badges = OUTLINE.lines.slice(h1Index + 4, h1Index + 8);
    const parsed = badges.map((line) =>
      /^\[!\[([^\]]+)\]\((https:\/\/[^)]+)\)\]\((https:\/\/[^)]+)\)$/.exec(line),
    );

    for (const [i, m] of parsed.entries()) {
      expect(
        m,
        `badge ${String(i + 1)} is not a linked image on its own line: ${badges[i] ?? ""}`,
      ).not.toBeNull();
    }

    const labels = parsed.map((m) => m?.[1] ?? "");
    const links = parsed.map((m) => m?.[3] ?? "");
    expect(labels[0]).toMatch(/npm/i);
    expect(links[0]).toContain("npmjs.com/package/@cosyte/fhir");
    expect(labels[1]).toMatch(/^CI$/);
    expect(links[1]).toContain("github.com/cosyte/fhir/actions/workflows/ci.yml");
    expect(labels[2]).toMatch(/license/i);
    expect(links[2]).toContain("/LICENSE");
    expect(labels[3]).toMatch(/node/i);
    expect(links[3]).toContain("nodejs.org");

    // Four is the ceiling: the line after the badge run is not a fifth badge.
    expect(OUTLINE.lines[h1Index + 8]).toBe("");
    const anyBadge = /^\[!\[[^\]]+\]\(https:\/\//;
    expect(OUTLINE.lines.filter((l) => anyBadge.test(l))).toHaveLength(4);
  });

  it("states the package description on one line, byte-identical to package.json", () => {
    const h1Index = OUTLINE.headings.find((h) => h.level === 1)?.index ?? -1;
    expect(OUTLINE.lines[h1Index + 9]).toBe(PACKAGE_JSON.description);
  });
});

describe("README.md: the document outline", () => {
  it("carries every required section, in order, with a non-empty body and License last", () => {
    expect(sectionProblems(README)).toEqual([]);
  });

  it("carries a table of contents listing every H2 in document order", () => {
    expect(OUTLINE.lines.length).toBeGreaterThan(100);
    expect(tableOfContentsProblems(README)).toEqual([]);
  });
});

describe("README.md: the claims each required section has to make", () => {
  it("Status names 0.1.0, the settled-API claim, and the surfaces still moving", () => {
    const body = sectionBody(OUTLINE, "Status") ?? "";
    expect(body).toContain("0.1.0");
    expect(body).toContain("public API is settled and safe to depend on");
    expect(body).toMatch(/read path/i);
    expect(body).toMatch(/not available from the public npm registry/i);
  });

  it("Install shows the command, the engine floor, the module format and today's route", () => {
    const body = sectionBody(OUTLINE, "Install") ?? "";
    expect(body).toContain("npm install @cosyte/fhir");
    expect(body).toContain(">=22.0.0");
    expect(body).toMatch(/dual esm and cjs/i);
    expect(body).toMatch(/not yet available from the public npm registry/i);
    expect(body).toContain("git clone https://github.com/cosyte/fhir.git");
  });

  it("Install agrees with package.json about the engine floor and the dual entry points", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      readonly engines: { readonly node: string };
      readonly exports: Record<string, Record<string, unknown>>;
    };
    const body = sectionBody(OUTLINE, "Install") ?? "";
    expect(body).toContain(pkg.engines.node);
    const root = pkg.exports["."];
    expect(root).toBeDefined();
    expect(Object.keys(root ?? {}).sort()).toEqual(["import", "require"]);
  });

  it("Usage shows a runnable example with its output inline", () => {
    const body = sectionBody(OUTLINE, "Usage") ?? "";
    const fences = outlineOf(`${body}\n`).fences.filter((f) => f.lang === "ts");
    expect(fences.length).toBeGreaterThanOrEqual(1);
    const example = fences[0]?.body ?? "";
    expect(example).toContain('from "@cosyte/fhir"');

    const lines = example.split("\n");
    const logged = lines.filter((l) => l.includes("console.log("));
    expect(logged.length).toBeGreaterThanOrEqual(1);
    for (const [i, line] of lines.entries()) {
      if (!line.includes("console.log(")) continue;
      const next = (lines[i + 1] ?? "").trim();
      expect(next.startsWith("//"), `console.log on line ${String(i + 1)} shows no output`).toBe(
        true,
      );
    }
  });

  it("Contributing says where to ask and reaches both surfaces absolutely", () => {
    const body = sectionBody(OUTLINE, "Contributing") ?? "";
    expect(body).toContain("https://github.com/cosyte/fhir/issues");
    expect(body).toContain("https://github.com/cosyte/fhir/blob/main/CONTRIBUTING.md");
    expect(body).toMatch(/pull requests are accepted/i);
    expect(body).toContain("pnpm test");
  });

  it("PHI and safety states the logging, retention, disk and diagnostic positions", () => {
    const body = sectionBody(OUTLINE, "PHI and safety") ?? "";
    expect(body).toMatch(/does not log/i);
    expect(body).toMatch(/does not retain/i);
    expect(body).toMatch(/does not write to disk/i);
    expect(body).toMatch(/never the value it was raised over/i);
    expect(body).toMatch(/you still own/i);
  });
});

describe("README.md: examples, links and brand rules", () => {
  it("imports only identifiers src/index.ts exports, and uses each of them", () => {
    expect(exampleIdentifierProblems(README, PUBLIC_EXPORTS)).toEqual([]);
  });

  it("names only real exports in the API list", () => {
    expect(apiListProblems(README, PUBLIC_EXPORTS)).toEqual([]);
  });

  it("shows only values declared synthetic in the allow-list or present in the fixtures", () => {
    expect(provenanceProblems(README, ALLOW_LIST, FIXTURE_CORPUS)).toEqual([]);
  });

  it("carries no link that is neither absolute https nor an in-file anchor", () => {
    expect(linkProblems(README)).toEqual([]);
  });

  it("carries no en dash and no em dash", () => {
    expect(dashProblems(README)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The checkers themselves. A gate is believed only once it has shown it can see.
// ---------------------------------------------------------------------------

describe("the structure checkers name what they refuse", () => {
  it("names a missing section, an out-of-order section and an empty body", () => {
    const missing = sectionProblems("## Status\n\ntext\n");
    expect(missing).toContain("missing required section: ## Why this exists");
    expect(missing).toContain("missing required section: ## Usage");

    const swapped = [
      "## Why this exists",
      "a",
      "## Install",
      "b",
      "## Status",
      "c",
      "## Usage",
      "d",
      "## PHI and safety",
      "e",
      "## Contributing",
      "f",
      "## License",
      "g",
    ].join("\n\n");
    expect(sectionProblems(swapped)).toContain(
      "section out of order: ## Install must come after ## Status",
    );

    const hollow = [
      "## Why this exists",
      "a",
      "## Status",
      "",
      "## Install",
      "c",
      "## Usage",
      "d",
      "## PHI and safety",
      "e",
      "## Contributing",
      "f",
      "## License",
      "g",
    ].join("\n\n");
    expect(sectionProblems(hollow)).toContain("empty section body: ## Status");
  });

  it("names an H2 that follows License", () => {
    const trailing = [...REQUIRED_SECTIONS, "Appendix"]
      .map((name) => `## ${name}\n\nbody`)
      .join("\n\n");
    expect(sectionProblems(trailing)).toContain(
      "## License must be the last H2, but the last H2 is ## Appendix",
    );
  });

  it("names a table-of-contents link that resolves to no heading", () => {
    const filler = Array.from({ length: 120 }, () => "filler").join("\n");
    const doc = ["- [Status](#status)", "- [Nowhere](#nowhere)", "", "## Status", "", filler].join(
      "\n",
    );
    expect(tableOfContentsProblems(doc)).toContain(
      "table-of-contents link resolves to no heading in this file: #nowhere",
    );
  });

  it("names a heading the table of contents leaves out", () => {
    const filler = Array.from({ length: 120 }, () => "filler").join("\n");
    const doc = ["- [Status](#status)", "", "## Status", "", "## Install", "", filler].join("\n");
    expect(
      tableOfContentsProblems(doc).some((p) => p.startsWith("the table of contents must list")),
    ).toBe(true);
  });

  it("names a relative link and leaves an in-file anchor alone", () => {
    expect(linkProblems("See [LICENSE](./LICENSE) and [Status](#status).")).toEqual([
      "link is neither an absolute https:// URL nor an in-file anchor, so it is dead inside the npm tarball: ./LICENSE",
    ]);
    expect(linkProblems('<img alt="x" src="tile.png">')).toEqual([
      "link is neither an absolute https:// URL nor an in-file anchor, so it is dead inside the npm tarball: tile.png",
    ]);
    // A link inside a fenced block is sample text, not a link the reader can follow.
    expect(linkProblems("```sh\ncp ./a ./b\n```\n")).toEqual([]);
  });

  it("names an example identifier the package does not export", () => {
    const doc = [
      "```ts",
      'import { parseResource, notAnExport } from "@cosyte/fhir";',
      "",
      'parseResource("{}");',
      "notAnExport();",
      "```",
    ].join("\n");
    expect(exampleIdentifierProblems(doc, PUBLIC_EXPORTS)).toEqual([
      "example imports `notAnExport` from @cosyte/fhir, which src/index.ts does not export",
    ]);
  });

  it("names an example identifier that is imported and never used", () => {
    const doc = [
      "```ts",
      'import { parseResource, readSafety } from "@cosyte/fhir";',
      "",
      'parseResource("{}");',
      "```",
    ].join("\n");
    expect(exampleIdentifierProblems(doc, PUBLIC_EXPORTS)).toEqual([
      "example imports `readSafety` and never uses it",
    ]);
  });

  it("names an API-list entry the package does not export", () => {
    const doc = [
      "## API",
      "",
      "- Codec: `parseResource`, `notAnExport`",
      "",
      "## License",
      "",
      "MIT",
    ].join("\n");
    expect(apiListProblems(doc, PUBLIC_EXPORTS)).toEqual([
      "the API list names `notAnExport`, which src/index.ts does not export",
    ]);
  });

  it("names an en dash and an em dash", () => {
    expect(dashProblems(`a${EN_DASH}b`)).toEqual(["en dash (U+2013) on line 1"]);
    expect(dashProblems(`\na${EM_DASH}b`)).toEqual(["em dash (U+2014) on line 2"]);
  });
});

describe("the example-value provenance checker names what it refuses", () => {
  // The keyed words are assembled at run time rather than written out against a quote and a colon:
  // `scripts/phi-scan.ts` reads THIS file too, and a spelled-out key beside a surname literal would
  // make the sample look like a fixture carrying real data.
  const familyKey = ["fam", "ily"].join("");
  const birthKey = ["birth", "Date"].join("");

  it("passes a name, a date and an identifier the allow-list declares", () => {
    const doc = `{ "${familyKey}": "Chalmers", "${birthKey}": "1974-12-25" }`;
    expect(provenanceProblems(doc, ALLOW_LIST, FIXTURE_CORPUS)).toEqual([]);
  });

  it("names an undeclared person name", () => {
    const doc = `{ "${familyKey}": "Nonesuch" }`;
    expect(provenanceProblems(doc, ALLOW_LIST, FIXTURE_CORPUS)).toEqual([
      'README example value "Nonesuch" is neither declared NAME in scripts/phi-allow-list.txt nor present under test/__fixtures__/',
    ]);
  });

  it("names an undeclared date of birth", () => {
    const doc = `{ "${birthKey}": "1963-07-04" }`;
    expect(provenanceProblems(doc, ALLOW_LIST, FIXTURE_CORPUS)).toEqual([
      'README example value "1963-07-04" is neither declared DOB in scripts/phi-allow-list.txt nor present under test/__fixtures__/',
    ]);
  });

  it("names an undeclared street address, identifier and email domain", () => {
    expect(
      provenanceProblems("Lives at 42 Nowhere Lane today.", ALLOW_LIST, FIXTURE_CORPUS),
    ).toEqual([
      'README example value "42 Nowhere Lane" is neither declared ADDR in scripts/phi-allow-list.txt nor present under test/__fixtures__/',
    ]);
    expect(provenanceProblems("id 314159265 here", ALLOW_LIST, FIXTURE_CORPUS)).toEqual([
      'README example value "314159265" is neither declared ID in scripts/phi-allow-list.txt nor present under test/__fixtures__/',
    ]);
    // Joined at run time for the same reason the keys above are: written out, this sample IS an
    // address on an undeclared domain, and `scripts/phi-scan.ts` reads this file and reports it.
    // The point of the sample is that the README checker sees one, not that this file carries one.
    const undeclaredAddress = ["nobody", "elsewhere.test"].join("@");
    expect(provenanceProblems(`write to ${undeclaredAddress}`, ALLOW_LIST, FIXTURE_CORPUS)).toEqual(
      [
        `README example value "${undeclaredAddress}" is neither declared EMAIL in scripts/phi-allow-list.txt nor present under test/__fixtures__/`,
      ],
    );
  });

  it("reads the allow-list and the fixture corpus rather than an empty stand-in", () => {
    // A checker that opened nothing would report every document clean.
    expect(ALLOW_LIST.names.size).toBeGreaterThan(10);
    expect(ALLOW_LIST.dobs.has("19741225")).toBe(true);
    expect(ALLOW_LIST.addresses.has("534 EREWHON ST")).toBe(true);
    expect(FIXTURE_CORPUS.length).toBeGreaterThan(1000);
    expect(FIXTURE_CORPUS).toContain("Chalmers");
  });
});
