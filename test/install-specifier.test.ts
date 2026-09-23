import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { installSpecifiers } from "./_first-use.js";

/**
 * The install command a reader copies has to fetch THIS package. The subject is package identity:
 * every registry specifier the two first-use documents print is compared with `package.json`
 * `name`, and a mismatch names both strings. The installation page must print one; the README
 * prints none today, and any it gains is held to the same rule.
 */
const root = join(import.meta.dirname, "..");
const { name } = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { name: string };
const read = (doc: string): string[] => installSpecifiers(readFileSync(join(root, doc), "utf8"));

describe("the documented install specifier", () => {
  it("AC-FH8: the installation page prints an install command for the package", () => {
    expect(read("docs-content/installation.md")).toContain(name);
  });

  for (const doc of ["docs-content/installation.md", "README.md"]) {
    it(`AC-FH8: every registry install command in ${doc} names package.json name`, () => {
      for (const spec of read(doc)) {
        expect(spec, `${doc} installs "${spec}", package.json name is "${name}"`).toBe(name);
      }
    });
  }

  it("AC-FH8: a specifier that is not the package name is read as the name it prints", () => {
    expect(
      installSpecifiers(
        "npm install @cosyte/fhirr\n`pnpm add -D @cosyte/fhir@0.0.1`\npnpm add file:../fhir",
      ),
    ).toEqual(["@cosyte/fhirr", "@cosyte/fhir"]);
  });
});
