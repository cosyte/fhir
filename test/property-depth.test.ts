/**
 * Every property in this suite reads the shared depth, and every line coverage leaves out says why.
 *
 * The nightly run sets `COSYTE_PROPERTY_RUNS` to 10,000 and `COSYTE_PROPERTY_SEED` to a seed of
 * its own, and a property only goes that deep if its run options come from `propertyRun`
 * (`./_property-run.ts`), which reads both. A property that passes `fc.assert` a literal count,
 * or no options at all, runs the same cases every night and never deeper. So:
 *
 * - every `fc.assert` and `fc.check` under `test/` takes its options from a `propertyRun(...)`
 *   call, directly or through a constant of the same file set to one;
 * - a `numRuns` anywhere else under `test/` is a fixed sample size, not a property's depth, and is
 *   listed below with the reason it stays fixed.
 *
 * And every `v8 ignore` comment in `src/` names its reason after ` -- `: coverage is held at 100,
 * so a line it leaves out is the one place the number does not speak for itself.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * The `numRuns` that are not a property's depth, each with its reason: `fc.sample` sizes that draw
 * a fixed corpus from a fixed seed. Taking the nightly depth would change what is drawn, and the
 * tests compare those draws with recorded digests or count what they hold.
 */
const FIXED_SAMPLES: Readonly<Record<string, string>> = {
  "test/_output-corpus.ts":
    "the output corpus is drawn on fixed seeds and its digests are recorded, so its size is part of the record",
  "test/arbitraries.test.ts":
    "each test draws a fixed sample and checks what it holds; the generators' properties run in test/property",
};

/** Every `.ts` file under `dir`, but fixtures and data, as paths relative to the repository. */
function tsFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      return entry.name === "__fixtures__" || entry.name === "__data__" ? [] : tsFiles(path);
    }
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

function parse(path: string): ts.SourceFile {
  return ts.createSourceFile(
    path,
    readFileSync(join(ROOT, path), "utf8"),
    ts.ScriptTarget.ES2022,
    true,
  );
}

function isPropertyRunCall(node: ts.Node | undefined): boolean {
  return (
    node !== undefined &&
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "propertyRun"
  );
}

function isFcCall(node: ts.CallExpression, names: readonly string[]): boolean {
  const callee = node.expression;
  return (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === "fc" &&
    names.includes(callee.name.text)
  );
}

/** Where a property in `file` does not read the shared depth, as `path:line` with the reason. */
function depthFindings(path: string): string[] {
  const file = parse(path);
  const fromPropertyRun = new Set<string>();
  const findings: string[] = [];
  const at = (node: ts.Node): string =>
    `${path}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}`;

  const collect = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      isPropertyRunCall(node.initializer)
    ) {
      fromPropertyRun.add(node.name.text);
    }
    ts.forEachChild(node, collect);
  };
  collect(file);

  const check = (node: ts.Node, insidePropertyRun: boolean): void => {
    if (ts.isCallExpression(node) && isFcCall(node, ["assert", "check"])) {
      const options = node.arguments[1];
      const reads =
        isPropertyRunCall(options) ||
        (options !== undefined && ts.isIdentifier(options) && fromPropertyRun.has(options.text));
      if (!reads) findings.push(`${at(node)}: its options are not a propertyRun(...) call`);
    }
    if (
      !insidePropertyRun &&
      ts.isPropertyAssignment(node) &&
      node.name.getText(file) === "numRuns" &&
      FIXED_SAMPLES[path] === undefined
    ) {
      findings.push(`${at(node)}: a numRuns outside propertyRun(...)`);
    }
    ts.forEachChild(node, (child) => check(child, insidePropertyRun || isPropertyRunCall(node)));
  };
  check(file, false);
  return findings;
}

describe("the nightly property depth reaches every property", () => {
  // The helper and its own test set numRuns as data, never as a property's depth.
  const files = tsFiles("test").filter(
    (path) => path !== "test/_property-run.ts" && path !== "test/property/runner.test.ts",
  );

  it("finds the properties it checks", () => {
    const properties = files.filter((path) =>
      /fc\.(?:assert|check)\(/u.test(readFileSync(join(ROOT, path), "utf8")),
    );
    expect(properties.length).toBeGreaterThan(10);
  });

  it("every fc.assert and fc.check takes its options from propertyRun", () => {
    expect(files.flatMap(depthFindings)).toEqual([]);
  });

  it("every fixed sample size listed is still in its file, with a reason", () => {
    for (const [path, reason] of Object.entries(FIXED_SAMPLES)) {
      expect(readFileSync(join(ROOT, path), "utf8")).toMatch(/numRuns/u);
      expect(reason.length).toBeGreaterThan(20);
    }
  });
});

describe("every line coverage leaves out names its reason", () => {
  it("each v8 ignore comment in src/ carries `-- <reason>`", () => {
    const missing: string[] = [];
    let count = 0;
    for (const path of tsFiles("src")) {
      const lines = readFileSync(join(ROOT, path), "utf8").split("\n");
      lines.forEach((line, index) => {
        if (!/v8 ignore/u.test(line)) return;
        count += 1;
        if (!/v8 ignore (?:next|else|if|start|stop)\b[^-]*-- \S.{10,}/u.test(line)) {
          missing.push(`${relative(ROOT, join(ROOT, path))}:${index + 1}`);
        }
      });
    }
    expect(missing).toEqual([]);
    expect(count).toBeGreaterThan(0);
  });
});
