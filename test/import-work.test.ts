import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { SOURCE_IS_INSTRUMENTED } from "./_runtime.js";

/**
 * What the module top level of the package runs when it is imported. A cold import of the built
 * package is held to a time budget (`pnpm check:cold-import`), and every call a module makes at its
 * top level is paid by every process that imports the package, whether or not it ever reads what
 * the call built. A lookup table, a scratch buffer or a derived set is made on first use instead:
 * `table ??= build()` inside the function that reads it.
 *
 * These cases list, by module and name, every top-level declaration of the modules `src/index.ts`
 * loads whose initializer calls a function or constructs an object, and hold that list to the one
 * below. A new entry is a cost to every caller's import: build it on first use, or add it here in
 * the change that makes the case for it. An entry that no longer runs at import is taken off.
 *
 * The census reads `src/` as text, so it stands aside in the mutation run (`SOURCE_IS_INSTRUMENTED`).
 */

const SRC = fileURLToPath(new URL("../src/", import.meta.url));

/** The top-level declarations that call or construct at import, as `module name`. */
const BUILT_AT_IMPORT: readonly string[] = [
  "codec/read.ts NO_META",
  "codec/read.ts RELEASED",
  "codec/serialize-guard.ts TAG_OPENER_STEALING",
  "fhirpath/evaluate.ts SUBSET_FUNCTIONS",
  "fhirpath/evaluate.ts SUBSET_OPERATORS",
  "fhirpath/evaluate.ts SYSTEM_TYPE_NAMES",
  "fhirpath/evaluate.ts TYPE_ARGUMENT_FUNCTIONS",
  "fhirpath/lexer.ts SINGLE_SYMBOLS",
  "fhirpath/matches.ts CLASS_ESCAPABLE",
  "fhirpath/matches.ts META",
  "fhirpath/parser.ts KEYWORD_OPS",
  "fhirpath/types.ts FHIR_ABSTRACT",
  "fhirpath/types.ts FHIR_COMPLEX",
  "fhirpath/types.ts FHIR_PRIMITIVES",
  "fhirpath/types.ts POSITIONS",
  "fhirpath/types.ts SPECIALIZES",
  "fhirpath/types.ts SYSTEM_TYPES",
  "model/node.ts NO_MEMBERS",
  "profiles/invariants.ts SAFETY_OWNED_KEYS",
  "profiles/slicing.ts SUPPORTED_DISCRIMINATORS",
  "profiles/starter-kit.ts PATIENT_IDENTIFIER_STARTER",
  "profiles/starter-kit.ts VETERINARY_PATIENT_STARTER",
  "profiles/starter-kit.ts VITAL_SIGN_OBSERVATION_STARTER",
  "quantity/ucum.ts VITAL_SIGN_UNITS",
  "quantity/value.ts OBSERVATION_VALUE_NAMES",
  "quantity/value.ts OBSERVATION_VALUE_PROPERTIES",
  "safety/absence.ts NO_EXTENSIONS",
  "safety/absence.ts STRUCTURAL_MEMBERS",
  "safety/codes.ts CODEABLE_CONCEPT_MEMBERS",
  "safety/codes.ts KNOWN_MODIFIER_EXTENSION_URLS",
  "safety/codes.ts NO_TYPES",
  "safety/codes.ts SAFETY_CODEABLE_ELEMENTS",
  "safety/codes.ts SAFETY_RESOURCE_TYPES",
  "safety/codes.ts SAFETY_SCALAR_ELEMENTS",
  "safety/codes.ts SEVERAL",
  "safety/modifier-elements.ts ADDRESS_USE",
  "safety/modifier-elements.ts CONTACT_POINT_USE",
  "safety/modifier-elements.ts IDENTIFIER_MEMBERS",
  "safety/modifier-elements.ts IDENTIFIER_USE",
  "safety/modifier-elements.ts INTENT_CODES",
  "safety/modifier-elements.ts MODIFIER_ELEMENT_ROOT_TYPES",
  "safety/modifier-elements.ts NAME_USE",
  "safety/modifier-elements.ts PATIENT_MEMBERS",
  "safety/modifier-elements.ts USE_ROOT_TYPES",
  "safety/status.ts ASSESSED_RESOURCE_TYPES",
  "safety/status.ts NO_MODEL",
  "safety/status.ts NO_NODES",
  "safety/status.ts NO_PROPERTIES",
  "terminology/systems.ts KNOWN_SYSTEMS",
  "validate/base-invariants.ts BASE_CONSTRAINT_TYPES",
  "validate/base-invariants.ts DECIDED_DIRECTLY",
  "validate/narrative.ts ACTIVE_ELEMENTS",
  "validate/narrative.ts ALLOWED_ATTRIBUTES",
  "validate/narrative.ts ALLOWED_ELEMENT_ATTRIBUTES",
  "validate/narrative.ts ALLOWED_ELEMENTS",
  "validate/narrative.ts BLOCK_ELEMENTS",
  "validate/narrative.ts URL_ATTRIBUTES",
  "validate/safety.ts RETRACTION_REPORTED_TYPES",
  "xml/read.ts ROOT_SCOPE",
  "xml/write.ts NOTHING_BOUND",
];

/** A parsed module of `src/`, by its path from `src/` with forward slashes. */
function sourceOf(path: string): ts.SourceFile {
  const text = readFileSync(join(SRC, path), "utf8");
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
}

/** The modules a module loads: every relative import and re-export that is not type-only. */
function importsOf(path: string, source: ts.SourceFile): string[] {
  const out: string[] = [];
  for (const statement of source.statements) {
    let specifier: ts.Expression | undefined;
    if (ts.isImportDeclaration(statement) && statement.importClause?.isTypeOnly !== true) {
      specifier = statement.moduleSpecifier;
    } else if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
      specifier = statement.moduleSpecifier;
    }
    if (specifier === undefined || !ts.isStringLiteral(specifier)) continue;
    if (!specifier.text.startsWith(".")) continue;
    const target = join(dirname(path), specifier.text.replace(/\.js$/u, ".ts"));
    out.push(target.replaceAll("\\", "/"));
  }
  return out;
}

/** Every module `src/index.ts` loads, itself included. */
function loadedModules(): Map<string, ts.SourceFile> {
  const seen = new Map<string, ts.SourceFile>();
  const queue = ["index.ts"];
  for (let path = queue.pop(); path !== undefined; path = queue.pop()) {
    if (seen.has(path)) continue;
    const source = sourceOf(path);
    seen.set(path, source);
    queue.push(...importsOf(path, source));
  }
  return seen;
}

/** Whether `node`, outside any function or class body below it, calls or constructs. */
function callsAtLoad(node: ts.Node): boolean {
  if (ts.isFunctionLike(node) || ts.isClassLike(node)) return false;
  if (ts.isCallExpression(node) || ts.isNewExpression(node)) return true;
  if (ts.isTaggedTemplateExpression(node)) return true;
  return ts.forEachChild(node, callsAtLoad) === true;
}

/** Every top-level declaration of `source` that calls or constructs at import, as `module name`. */
function builtAtImport(path: string, source: ts.SourceFile): string[] {
  const out: string[] = [];
  for (const statement of source.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (declaration.initializer !== undefined && callsAtLoad(declaration.initializer)) {
          out.push(`${path} ${declaration.name.getText(source)}`);
        }
      }
    } else if (ts.isExpressionStatement(statement) && callsAtLoad(statement.expression)) {
      out.push(
        `${path} <statement at line ${String(source.getLineAndCharacterOfPosition(statement.getStart()).line + 1)}>`,
      );
    }
  }
  return out;
}

describe.skipIf(SOURCE_IS_INSTRUMENTED)("what importing the package builds", () => {
  it("follows the package's own modules, so the census below covers something", () => {
    const modules = [...loadedModules().keys()];
    expect(modules.length).toBeGreaterThan(40);
    expect(modules).toContain("codec/raw-json.ts");
    expect(modules).toContain("safety/status.ts");
    expect(modules).not.toContain("arbitraries/index.ts");
  });

  it("builds only what it built before: the JSON reader, the safety walk and the base constraints build theirs on first use", () => {
    const built = [...loadedModules()].flatMap(([path, source]) => builtAtImport(path, source));
    expect(built.sort()).toEqual([...BUILT_AT_IMPORT].sort());
  });

  it("counts a call or a construction outside a function, and nothing inside one", () => {
    const source = ts.createSourceFile(
      "probe.ts",
      [
        "const A = new Set([1]);",
        "const B = [1].map((n) => n + 1);",
        "const C = () => new Map();",
        "function d() { return new Map(); }",
        "const E = { f: () => g() };",
        "const H = [1, 2];",
        "let i: Int32Array | undefined;",
        "register();",
      ].join("\n"),
      ts.ScriptTarget.Latest,
      true,
    );
    expect(builtAtImport("probe.ts", source)).toEqual([
      "probe.ts A",
      "probe.ts B",
      "probe.ts <statement at line 8>",
    ]);
  });
});

/**
 * The large tables the modules write out at their top level. A literal there costs every import
 * twice, even though it calls nothing: the engine compiles all of it, since a module's top level is
 * compiled whole, and then builds every object and array in it. A table inside a function is only
 * scanned until the function first runs. The tables below are exported, so a caller reads them as
 * values; every other table is written inside a function, called the first time a caller needs it.
 * Four of the six are public codes. The other two are read where they stand: the derived-name
 * shapes give a type its members, and the element definitions are one line of text per context,
 * which a walk reads into maps on first use.
 */
const TABLES_AT_IMPORT: readonly string[] = [
  "codec/issues.ts ISSUE_CODES",
  "codec/serialize-guard.ts SERIALIZE_ERROR_CODES",
  "model/path.ts DERIVED_NAME_SHAPES",
  "safety/element-definitions.ts ELEMENT_DEFINITIONS",
  "validate/issues.ts ISSUE_TYPES",
  "validate/issues.ts VALIDATION_CODES",
];

/** The size, in characters of source, from which a top-level literal counts as a table. */
const TABLE_CHARACTERS = 1000;

/** The initializer under any `as`, `satisfies` or parentheses around it. */
function unwrapped(node: ts.Expression): ts.Expression {
  if (
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isParenthesizedExpression(node)
  ) {
    return unwrapped(node.expression);
  }
  return node;
}

/** Every top-level object or array literal of `source` of the size of a table, as `module name`. */
function tablesAtImport(path: string, source: ts.SourceFile): string[] {
  const out: string[] = [];
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (declaration.initializer === undefined) continue;
      const value = unwrapped(declaration.initializer);
      if (!ts.isObjectLiteralExpression(value) && !ts.isArrayLiteralExpression(value)) continue;
      if (value.getEnd() - value.getStart(source) < TABLE_CHARACTERS) continue;
      out.push(`${path} ${declaration.name.getText(source)}`);
    }
  }
  return out;
}

describe.skipIf(SOURCE_IS_INSTRUMENTED)("the tables importing the package writes out", () => {
  it("are only the exported ones: the schema, constraint and issue tables are made on first use", () => {
    const tables = [...loadedModules()].flatMap(([path, source]) => tablesAtImport(path, source));
    expect(tables.sort()).toEqual([...TABLES_AT_IMPORT].sort());
  });

  it("counts a large literal at the top level, and none inside a function or under the size", () => {
    const big = `{ ${Array.from({ length: 200 }, (_, i) => `k${String(i)}: ${String(i)}`).join(", ")} }`;
    const source = ts.createSourceFile(
      "probe.ts",
      [
        `const A = ${big};`,
        `const B = ${big} as const;`,
        `const C = [${big}];`,
        `function d() { return ${big}; }`,
        `const E = () => (${big});`,
        "const F = { small: 1 };",
      ].join("\n"),
      ts.ScriptTarget.Latest,
      true,
    );
    expect(tablesAtImport("probe.ts", source)).toEqual(["probe.ts A", "probe.ts B", "probe.ts C"]);
  });
});
