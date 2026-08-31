/**
 * The documentation-set gate, wired into `pnpm test`.
 *
 * Two halves, and the second is the load-bearing one:
 *
 *   1. THE REAL SET PASSES. `docs-content/` is graded by every arm, and a finding fails this file.
 *   2. EVERY ARM CAN GO RED. Each arm is run against a control directory seeded with exactly the
 *      fault it exists to catch. A gate whose red path is never exercised has not been shown to
 *      work: it can be broken by a refactor, an over-narrow regex or a swallowed error, and the
 *      first evidence would be a public page carrying the thing the gate was written to stop.
 *
 * Controls are seeded into throwaway directories, so nothing here can touch the committed content.
 *
 * SECURITY: the one subprocess call below uses `spawnSync` with array args. No `exec`, no shell-form.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ARMS, checkDocsSet, formatFinding } from "../scripts/docs-set-check.js";
import type { ArmName, Finding } from "../scripts/docs-set-check.js";

const REPO_ROOT = process.cwd();
const DOCS_DIR = join(REPO_ROOT, "docs-content");
const CHECKER = join(REPO_ROOT, "scripts", "docs-set-check.ts");
const TSX_BIN = join(REPO_ROOT, "node_modules", ".bin", "tsx");

/** Compiling and running every sample dominates the runtime of a full grading pass. */
const SAMPLE_TIMEOUT = 180_000;

/** Seed a control directory, grade it with one arm, and clean up whatever the grading wrote. */
function graded(files: Record<string, string>, arms: readonly ArmName[]): Finding[] {
  const dir = mkdtempSync(join(tmpdir(), "fhir-docs-control-"));
  try {
    for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
    return checkDocsSet(dir, { arms });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Every message a grading pass produced, joined, for a readable assertion failure. */
function messages(findings: readonly Finding[]): string {
  return findings.map(formatFinding).join("\n");
}

/** A page with frontmatter, the shape every page in the set has. */
function page(id: string, title: string, body: string): string {
  return `---\nid: ${id}\ntitle: ${title}\n---\n\n${body}\n`;
}

describe("the published documentation set", () => {
  it(
    "passes every arm of its own gate",
    () => {
      const findings = checkDocsSet(DOCS_DIR);
      expect(messages(findings)).toBe("");
    },
    SAMPLE_TIMEOUT,
  );

  it("declares an arm for every graded property", () => {
    expect([...ARMS]).toEqual([
      "mdx-braces",
      "links",
      "package-agreement",
      "synthetic-identifiers",
      "stale-assertions",
      "coverage",
      "code-tokens",
      "samples",
    ]);
  });
});

describe("every arm goes red on a seeded control", () => {
  it("mdx-braces: a brace in prose, where MDX reads it as an expression", () => {
    const findings = graded(
      { "intro.md": page("intro", "Getting started", "A resource is written as { ... } in JSON.") },
      ["mdx-braces"],
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.file).toBe("intro.md");
    expect(findings[0]?.line).toBe(6);
    expect(findings[0]?.message).toContain("unescaped brace outside a fenced code block");
  });

  it("mdx-braces: the same brace inside a fence is not a finding", () => {
    const findings = graded(
      {
        "intro.md": page(
          "intro",
          "Getting started",
          '```json\n{ "resourceType": "Patient" }\n```\n',
        ),
      },
      ["mdx-braces"],
    );
    expect(messages(findings)).toBe("");
  });

  it("links: a sidebar entry and a relative link that land on nothing", () => {
    const findings = graded(
      {
        "sidebars.json": '{ "docs": ["intro", "quickstart"] }\n',
        "intro.md": page("intro", "Getting started", "Read the [quickstart](./quickstart.md)."),
      },
      ["links"],
    );
    expect(messages(findings)).toContain('sidebar entry "quickstart" resolves to no page');
    expect(messages(findings)).toContain('relative link target "./quickstart.md" is not a page');
  });

  it("links: a page the sidebar does not enumerate is unreachable", () => {
    const findings = graded(
      {
        "sidebars.json": '{ "docs": ["intro"] }\n',
        "intro.md": page("intro", "Getting started", "Hello."),
        "orphan.md": page("orphan", "Orphan", "Nothing points here."),
      },
      ["links"],
    );
    expect(messages(findings)).toContain('page "orphan" is not enumerated by sidebars.json');
  });

  it("package-agreement: a Node range and a registry claim that disagree with package.json", () => {
    const findings = graded(
      {
        "installation.md": page(
          "installation",
          "Installation",
          [
            "Install `@cosyte/fhir` with `pnpm add @cosyte/fhir`.",
            "",
            "It needs Node `>=18.0.0`, ships ESM, and also offers CommonJS.",
            "",
            "The package is installable from the public npm registry today.",
          ].join("\n"),
        ),
      },
      ["package-agreement"],
    );
    expect(messages(findings)).toContain('does not state the supported Node range ">=22.0.0"');
    expect(messages(findings)).toContain("disagrees with package.json");
  });

  it("package-agreement: the truthful page passes the same arm", () => {
    const findings = graded(
      {
        "installation.md": page(
          "installation",
          "Installation",
          [
            "Install `@cosyte/fhir` with `pnpm add @cosyte/fhir`.",
            "",
            "It needs Node `>=22.0.0`, ships ESM, and also offers CommonJS.",
            "",
            "The package is not installable from the public npm registry today.",
          ].join("\n"),
        ),
      },
      ["package-agreement"],
    );
    expect(messages(findings)).toBe("");
  });

  it("synthetic-identifiers: an example name that is not declared synthetic", () => {
    const findings = graded(
      {
        "quickstart.md": page(
          "quickstart",
          "Quickstart",
          '```json\n{ "resourceType": "Patient", "name": [{ "family": "Kowalski" }] }\n```\n',
        ),
      },
      ["synthetic-identifiers"],
    );
    expect(messages(findings)).toContain('name value "Kowalski" is not declared synthetic');
  });

  it("synthetic-identifiers: an undeclared birth date, address line and contact number", () => {
    const findings = graded(
      {
        "quickstart.md": page(
          "quickstart",
          "Quickstart",
          [
            "```json",
            '{ "resourceType": "Patient", "birthDate": "1962-03-04",',
            '  "address": [{ "line": ["12 Nowhere Lane"] }],',
            '  "telecom": [{ "system": "phone", "value": "555-867-5309" }] }',
            "```",
          ].join("\n"),
        ),
      },
      ["synthetic-identifiers"],
    );
    expect(messages(findings)).toContain('dob value "1962-03-04"');
    expect(messages(findings)).toContain('addr value "12 Nowhere Lane"');
    expect(messages(findings)).toContain('id value "555-867-5309"');
  });

  it("synthetic-identifiers: declared tokens pass the same arm", () => {
    const findings = graded(
      {
        "quickstart.md": page(
          "quickstart",
          "Quickstart",
          [
            "```json",
            '{ "resourceType": "Patient", "birthDate": "1974-12-25",',
            '  "name": [{ "family": "Chalmers", "given": ["Peter"] }],',
            '  "address": [{ "line": ["534 Erewhon St"] }],',
            '  "identifier": [{ "system": "http://hospital.example.org", "value": "SYN-0001" }] }',
            "```",
          ].join("\n"),
        ),
      },
      ["synthetic-identifiers"],
    );
    expect(messages(findings)).toBe("");
  });

  it("stale-assertions: a page that sends the reader away from content that exists", () => {
    const findings = graded(
      {
        "intro.md": page(
          "intro",
          "Getting started",
          "The quickstart is not written yet, so read the repository instead.",
        ),
      },
      ["stale-assertions"],
    );
    expect(messages(findings)).toContain("asserts part of the documentation set is unwritten");
  });

  it("stale-assertions: the proximity rule catches the paraphrase too", () => {
    const findings = graded(
      {
        "intro.md": page("intro", "Getting started", "The troubleshooting page is a stub for now."),
      },
      ["stale-assertions"],
    );
    expect(messages(findings)).toContain("asserts part of the documentation set is unwritten");
  });

  it("coverage: a missing page and a page that drops a promised topic", () => {
    const findings = graded(
      {
        "limits.md": page("limits", "Current limits", "No terminology content is bundled."),
      },
      ["coverage"],
    );
    expect(messages(findings)).toContain("has no troubleshooting page");
    expect(messages(findings)).toContain("does not cover the unchecked invariant verdict");
  });

  it("coverage: a troubleshooting entry that diagnoses without saying what to do", () => {
    const findings = graded(
      {
        "troubleshooting.md": page(
          "troubleshooting",
          "Troubleshooting",
          [
            "## The reader refuses a document carrying a DOCTYPE",
            "",
            "The XML reader throws with `DTD_FORBIDDEN`.",
            "",
            "## A duplicate JSON property",
            "",
            "`DUPLICATE_PROPERTY`, `UNHANDLED_MODIFIER_EXTENSION` and `INVARIANT_UNCHECKED` appear.",
            "",
            "**What to do**: read the findings.",
          ].join("\n"),
        ),
      },
      ["coverage"],
    );
    expect(messages(findings)).toContain("the entry for DTD_FORBIDDEN names no action");
  });

  it("code-tokens: a coded reason the package does not define", () => {
    const findings = graded(
      {
        "troubleshooting.md": page(
          "troubleshooting",
          "Troubleshooting",
          "The reader reports `DOCTYPE_REJECTED` for a document carrying a DTD.",
        ),
      },
      ["code-tokens"],
    );
    expect(messages(findings)).toContain(
      '"DOCTYPE_REJECTED" is not an export or a coded reason this package defines',
    );
  });

  it("code-tokens: a real coded reason passes the same arm", () => {
    const findings = graded(
      {
        "troubleshooting.md": page(
          "troubleshooting",
          "Troubleshooting",
          "The reader throws `DTD_FORBIDDEN`, and `INVARIANT_UNCHECKED` is a validation finding.",
        ),
      },
      ["code-tokens"],
    );
    expect(messages(findings)).toBe("");
  });

  it(
    "samples: one that does not compile, and one whose stated result is wrong",
    () => {
      const findings = graded(
        {
          "quickstart.md": page(
            "quickstart",
            "Quickstart",
            [
              "```ts",
              'import { parseResource } from "@cosyte/fhir";',
              "",
              'const { resource } = parseResource(\'{"resourceType":"Patient"}\');',
              "resource.noSuchMember;",
              "```",
              "",
              "```ts",
              'import { parseResource, resourceType } from "@cosyte/fhir";',
              "",
              'const { resource } = parseResource(\'{"resourceType":"Patient"}\');',
              'resourceType(resource); // => "Observation"',
              "```",
            ].join("\n"),
          ),
        },
        ["samples"],
      );
      expect(messages(findings)).toContain("sample does not compile");
      expect(messages(findings)).toContain("noSuchMember");
      expect(messages(findings)).toContain("sample threw when run");
      expect(messages(findings)).toContain('expected "Observation", got "Patient"');
    },
    SAMPLE_TIMEOUT,
  );

  it(
    "samples: a sample that imports something other than the package entry point",
    () => {
      const findings = graded(
        {
          "quickstart.md": page(
            "quickstart",
            "Quickstart",
            ["```ts", 'import { parseResource } from "@cosyte/fhir/dist/index.js";', "```"].join(
              "\n",
            ),
          ),
        },
        ["samples"],
      );
      expect(messages(findings)).toContain('documented samples may only import "@cosyte/fhir"');
    },
    SAMPLE_TIMEOUT,
  );
});

describe("the gate's command-line entry point", () => {
  it(
    "exits non-zero and names the finding",
    () => {
      const dir = mkdtempSync(join(tmpdir(), "fhir-docs-cli-"));
      try {
        writeFileSync(
          join(dir, "intro.md"),
          page("intro", "Getting started", "Braces like { this } break the site build."),
        );
        const run = spawnSync(TSX_BIN, [CHECKER, dir], { encoding: "utf8", cwd: REPO_ROOT });
        expect(run.status).toBe(1);
        expect(run.stderr).toContain("[mdx-braces]");
        expect(run.stderr).toContain("finding(s)");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    SAMPLE_TIMEOUT,
  );
});
