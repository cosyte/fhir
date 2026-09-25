#!/usr/bin/env tsx
/**
 * Capture what a BASE tree's two writers return for the XML well-formedness model sets, as
 * committed expectation data.
 *
 *     pnpm capture:xml-wellformed                 # against origin/main
 *     pnpm capture:xml-wellformed --base <ref>    # against any ref
 *
 * The model sets are `test/_xml-wellformed-models.ts`, the readout corpus is
 * `test/_readout-corpus.ts`, and the property-generated models are drawn here, from the XML 1.0
 * `Name` and `Char` productions, with a fixed seed. Every model is recorded as data beside the
 * outcome the base tree's `serializeResourceXml` (and, for the named sets, `serializeResource`)
 * produced for it: the string it returned, or the code and locations it refused with. The suites
 * build each model again with head's own code and compare against that record, so the grade reads
 * committed pairs and never depends on a seed regenerating the same models.
 *
 * `git archive` is used rather than a worktree so the materialized tree cannot pick up an untracked
 * file from the working tree, which is the failure mode that would make base look like head. The
 * output is written ASCII-only (every other code unit as a `\u` escape), so a byte comparison of two
 * runs is a comparison of the data and not of an encoding. Run it at the same base and the file must
 * come back byte-identical.
 *
 * @packageDocumentation
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import fc from "fast-check";

import { corpus } from "../test/_readout-corpus.js";
import {
  BOTH_NEW_MODELS,
  CHARACTER_MODELS,
  CLEAN_MODELS,
  DIV_MODELS,
  DIV_WRITTEN_MODELS,
  NAME_MODELS,
  PIN_REFUSED_MODELS,
  SENTINEL_MODELS,
  buildComplex,
  outcome,
  type ModelCodec,
  type NamedModel,
  type Outcome,
  type Recipe,
} from "../test/_xml-wellformed-models.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const OUT = join(REPO, "test", "__data__", "xml-wellformed-base.json");

/** The seed the generated models are drawn with. Recorded in the output. */
const SEED = 424242;

/** How many models are drawn. The suite requires at least 1,000 of them the base wrote. */
const DRAWN = 1000;

/** The base tree's surface this capture calls. */
interface BaseCodec extends ModelCodec<unknown, unknown> {
  readonly serializeResource: (node: unknown) => string;
  readonly serializeResourceXml: (node: unknown) => string;
}

/** The ref to capture, `--base <ref>` or `origin/main`. */
function baseRef(argv: readonly string[]): string {
  const at = argv.indexOf("--base");
  return at === -1 ? "origin/main" : (argv[at + 1] ?? "origin/main");
}

/** Materialize `src/` at `ref` into a temp directory and import it. */
async function loadBase(ref: string): Promise<{ codec: BaseCodec; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), "fhir-xml-wellformed-"));
  const archive = execFileSync("git", ["archive", ref, "src"], {
    cwd: REPO,
    maxBuffer: 256 * 1024 * 1024,
    encoding: "buffer",
  });
  execFileSync("tar", ["-x", "-C", dir], { input: archive });
  const codec = (await import(pathToFileURL(join(dir, "src", "index.ts")).href)) as BaseCodec;
  return { codec, dir };
}

/** An inclusive code point range. */
type Range = readonly [number, number];

/** XML 1.0 [4] `NameStartChar`, without the colon: a colon is a namespace matter the base refuses. */
const NAME_START: readonly Range[] = [
  [0x41, 0x5a],
  [0x5f, 0x5f],
  [0x61, 0x7a],
  [0xc0, 0xd6],
  [0xd8, 0xf6],
  [0xf8, 0x2ff],
  [0x370, 0x37d],
  [0x37f, 0x1fff],
  [0x200c, 0x200d],
  [0x2070, 0x218f],
  [0x2c00, 0x2fef],
  [0x3001, 0xd7ff],
  [0xf900, 0xfdcf],
  [0xfdf0, 0xfffd],
  [0x10000, 0xeffff],
];

/** XML 1.0 [4a] `NameChar`: `NameStartChar` plus these. */
const NAME_CHAR: readonly Range[] = [
  ...NAME_START,
  [0x2d, 0x2e],
  [0x30, 0x39],
  [0xb7, 0xb7],
  [0x300, 0x36f],
  [0x203f, 0x2040],
];

/**
 * XML 1.0 [2] `Char`, with printable ASCII first as a range of its own so the characters the
 * writer escapes turn up often. `@` and U+2013 and U+2014 are never drawn: the committed data is
 * swept by the PHI scan's email shape and by the dash gates, and neither is a property of `Char`.
 */
const CHAR: readonly Range[] = [
  [0x20, 0x7e],
  [0x09, 0x0a],
  [0x0d, 0x0d],
  [0x20, 0xd7ff],
  [0xe000, 0xfffd],
  [0x10000, 0x10ffff],
];

/** Never drawn, for the reason given on {@link CHAR}. */
const NEVER_DRAWN = new Set([0x40, 0x2013, 0x2014]);

/**
 * One code point from `ranges`: half the time from the first range, otherwise from any range with
 * each equally likely. The first range of every set is ASCII, so the committed data stays small
 * while every range is still drawn from.
 */
function codePoint(ranges: readonly Range[]): fc.Arbitrary<string> {
  const [first] = ranges;
  if (first === undefined) throw new Error("no range to draw from");
  return fc
    .oneof(
      fc.integer({ min: first[0], max: first[1] }),
      fc.oneof(...ranges.map(([min, max]) => fc.integer({ min, max }))),
    )
    .filter((cp) => !NEVER_DRAWN.has(cp))
    .map((cp) => String.fromCodePoint(cp));
}

/** A Name, never `div` or `resourceType`, which the writer does not write as an ordinary tag. */
const NAME = fc
  .tuple(codePoint(NAME_START), fc.array(codePoint(NAME_CHAR), { maxLength: 2 }))
  .map(([first, rest]) => first + rest.join(""))
  .filter((name) => name !== "div" && name !== "resourceType");

/** A property name: mostly a drawn Name, sometimes one the writer spells as an attribute or wraps. */
const PROPERTY = fc.oneof(
  { weight: 8, arbitrary: NAME },
  { weight: 1, arbitrary: fc.constantFrom("id", "url", "extension", "modifierExtension") },
);

/** A resource type: a Name, or one of three this library models. */
const TYPE = fc.oneof(NAME, fc.constantFrom("Patient", "Observation", "Basic"));

/** A value drawn from Char. */
const CHARS = fc.array(codePoint(CHAR), { maxLength: 3 }).map((chars) => chars.join(""));

/** A primitive's value: drawn Chars, a boolean, or none. */
const VALUE = fc.oneof(
  { weight: 6, arbitrary: CHARS },
  { weight: 1, arbitrary: fc.boolean() },
  { weight: 1, arbitrary: fc.constant(null) },
);

/** The model trees the generated set is drawn from. */
const TREE = fc.letrec<{
  node: Recipe;
  primitive: Recipe;
  extension: Recipe;
  complex: Recipe;
  list: Recipe;
  resource: Recipe;
}>((tie) => ({
  node: fc.oneof(
    { maxDepth: 2, depthIdentifier: "tree" },
    tie("primitive"),
    tie("complex"),
    tie("list"),
    tie("resource"),
  ),
  primitive: fc.oneof(
    { weight: 4, arbitrary: VALUE.map((value): Recipe => ({ primitive: value })) },
    {
      weight: 1,
      arbitrary: fc.tuple(VALUE, CHARS).map(([value, id]): Recipe => ({ primitive: value, id })),
    },
    {
      weight: 1,
      arbitrary: fc
        .tuple(VALUE, tie("extension"))
        .map(([value, extension]): Recipe => ({ primitive: value, extension: [extension] })),
    },
  ),
  extension: fc
    .tuple(CHARS, fc.array(fc.tuple(NAME, tie("node")), { maxLength: 1 }))
    .map(([url, rest]): Recipe => ({ complex: [["url", { primitive: url }], ...rest] })),
  complex: fc
    .array(fc.tuple(PROPERTY, tie("node")), { maxLength: 2 })
    .map((properties): Recipe => ({ complex: properties })),
  list: fc
    .array(tie("node"), { minLength: 2, maxLength: 2 })
    .map((items): Recipe => ({ list: items })),
  resource: fc.tuple(TYPE, fc.array(fc.tuple(PROPERTY, tie("node")), { maxLength: 2 })).map(
    ([type, properties]): Recipe => ({
      complex: [["resourceType", { primitive: type }], ...properties],
    }),
  ),
}));

/** A generated root: a resource whose type is drawn, holding up to three drawn properties. */
const ROOT = fc
  .tuple(TYPE, fc.array(fc.tuple(PROPERTY, TREE.node), { minLength: 1, maxLength: 3 }))
  .map(
    ([type, properties]): Recipe => ({
      complex: [["resourceType", { primitive: type }], ...properties],
    }),
  );

/** One recorded entry of a named set: the model and both writers' outcomes. */
interface NamedEntry {
  readonly label: string;
  readonly recipe: Recipe;
  readonly xml: Outcome;
  readonly json: Outcome;
}

/** One recorded entry of the corpus or the generated set: the model and the XML writer's outcome. */
interface XmlEntry {
  /** The corpus document's name; a generated model is known by its position instead. */
  readonly label?: string;
  readonly recipe: Recipe;
  readonly xml: Outcome;
}

/** JSON text with every code unit outside printable ASCII escaped, so the file is ASCII only. */
function ascii(text: string): string {
  return text.replace(/[\u{7f}-\u{10ffff}]/gu, (char) =>
    Array.from(
      { length: char.length },
      (_, index) => `\\u${char.charCodeAt(index).toString(16).padStart(4, "0")}`,
    ).join(""),
  );
}

/** One set, one entry per line. */
function set(name: string, entries: readonly object[]): string {
  const lines = entries.map((entry) => `      ${ascii(JSON.stringify(entry))}`);
  return `    ${JSON.stringify(name)}: [\n${lines.join(",\n")}\n    ]`;
}

async function main(): Promise<void> {
  const ref = baseRef(process.argv.slice(2));
  const sha = execFileSync("git", ["rev-parse", ref], { cwd: REPO, encoding: "utf8" }).trim();
  const { codec, dir } = await loadBase(ref);
  try {
    const xmlOf = (recipe: Recipe): Outcome =>
      outcome(() => codec.serializeResourceXml(buildComplex(recipe, codec)));
    const jsonOf = (recipe: Recipe): Outcome =>
      outcome(() => codec.serializeResource(buildComplex(recipe, codec)));
    const named = (models: readonly NamedModel[]): NamedEntry[] =>
      models.map(({ label, recipe }) => ({
        label,
        recipe,
        xml: xmlOf(recipe),
        json: jsonOf(recipe),
      }));

    const corpusEntries: XmlEntry[] = corpus().map((document) => {
      const recipe: Recipe = { json: document.json };
      return { label: document.name, recipe, xml: xmlOf(recipe) };
    });
    const generated: XmlEntry[] = fc
      .sample(ROOT, { seed: SEED, numRuns: DRAWN })
      .map((recipe) => ({ recipe, xml: xmlOf(recipe) }));

    const sets: readonly (readonly [string, readonly object[]])[] = [
      ["name", named(NAME_MODELS)],
      ["character", named(CHARACTER_MODELS)],
      ["div", named(DIV_MODELS)],
      ["divWritten", named(DIV_WRITTEN_MODELS)],
      ["clean", named(CLEAN_MODELS)],
      ["pinRefused", named(PIN_REFUSED_MODELS)],
      ["bothNew", named(BOTH_NEW_MODELS)],
      ["sentinel", named(SENTINEL_MODELS)],
      ["corpus", corpusEntries],
      ["generated", generated],
    ];
    const header = [
      `  "note": "Generated by scripts/capture-xml-wellformed.ts. Do not hand-edit: re-run it instead.",`,
      `  "base": ${JSON.stringify(sha)},`,
      `  "seed": ${String(SEED)},`,
      `  "drawn": ${String(DRAWN)},`,
    ];
    const body = sets.map(([name, entries]) => set(name, entries)).join(",\n");
    writeFileSync(OUT, `{\n${header.join("\n")}\n  "sets": {\n${body}\n  }\n}\n`, "utf8");
    const written = generated.filter((entry) => "written" in entry.xml).length;
    console.log(
      `captured ${String(sets.length)} sets at ${sha} (${String(written)} of ${String(DRAWN)} generated models written) -> ${OUT}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

await main();
