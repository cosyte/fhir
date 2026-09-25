/**
 * What the two writers must keep exactly as the base did, beside the XML writer's refusals of a tag
 * name that is not an XML 1.0 `Name` and of a character outside `Char`.
 *
 * The operands are the committed record `test/__data__/xml-wellformed-base.json`, which
 * `scripts/capture-xml-wellformed.ts` captured by materializing the base pin's `src/` with
 * `git archive` and running every model through it, and head's own output for the same models,
 * built again here with head's own readers and constructors. Every model is committed beside the
 * base's output for it, so no comparison depends on a generator or a seed reproducing a model:
 *
 * - a model the base refused keeps the base's code and locations, whatever non-Name name or non-Char
 *   character it also carries (AC-6);
 * - a model the base wrote, all of whose names are Names and all of whose characters are Chars, is
 *   written byte-identically: every document of the readout corpus and 1,000 generated models (AC-7);
 * - `serializeResource` returns the base's string, or the base's refusal, for every model the new
 *   refusals are graded over, and never either new code (AC-8).
 *
 * All names, values and namespace URIs here are synthetic.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  SERIALIZE_ERROR_CODES,
  complex,
  list,
  parseResource,
  parseResourceXml,
  primitive,
  serializeResource,
  serializeResourceXml,
  type FhirComplex,
  type FhirNode,
} from "../src/index.js";
import { corpus } from "./_readout-corpus.js";
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
} from "./_xml-wellformed-models.js";

const XML_NAME = "UNSERIALIZABLE_XML_NAME";
const XML_CHARACTER = "UNSERIALIZABLE_XML_CHARACTER";

/** The pin the record was captured at. */
const BASE_PIN = "18567b969c5fc34bd70dc8b7a5321027ea52dc87";

/** Every code `SERIALIZE_ERROR_CODES` lists at the pin, spelled out rather than read off head. */
const CODES_AT_PIN = [
  "DROPPED_ELEMENT_TEXT",
  "UNSERIALIZABLE_ELEMENT_NAME",
  "UNSERIALIZABLE_DIV_MARKUP",
  "UNSERIALIZABLE_JSON_ONLY_SHAPE",
  "UNSERIALIZABLE_ARRAY_WRAPPER",
  "UNSERIALIZABLE_CHOICE_WRAPPER",
  "UNSERIALIZABLE_SHADOWED_PROPERTY",
  "UNSERIALIZABLE_RESOURCE_TYPE",
  "UNSERIALIZABLE_FOREIGN_ROOT",
  "UNSERIALIZABLE_PREFIXED_NAME",
  "UNSERIALIZABLE_DIV_PREFIX",
] as const;

const HEAD: ModelCodec<FhirNode, FhirComplex> = {
  parseResource,
  parseResourceXml,
  complex,
  list,
  primitive,
};

interface CapturedEntry {
  readonly label?: string;
  readonly recipe: Recipe;
  readonly xml: Outcome;
  readonly json?: Outcome;
}

const captured = JSON.parse(
  readFileSync(new URL("./__data__/xml-wellformed-base.json", import.meta.url), "utf8"),
) as { readonly base: string; readonly sets: Record<string, readonly CapturedEntry[]> };

/** The named sets as the suites spell them, keyed as the record keys them. */
const NAMED_SETS: readonly (readonly [string, readonly NamedModel[]])[] = [
  ["name", NAME_MODELS],
  ["character", CHARACTER_MODELS],
  ["div", DIV_MODELS],
  ["divWritten", DIV_WRITTEN_MODELS],
  ["clean", CLEAN_MODELS],
  ["pinRefused", PIN_REFUSED_MODELS],
  ["bothNew", BOTH_NEW_MODELS],
  ["sentinel", SENTINEL_MODELS],
];

/** One set of the record. */
function recorded(set: string): readonly CapturedEntry[] {
  const entries = captured.sets[set];
  if (entries === undefined) throw new Error(`the record holds no set ${set}`);
  return entries;
}

/** The record's entry for the model labelled `label` in `set`. */
function entryOf(set: string, label: string): CapturedEntry {
  const entry = recorded(set).find((candidate) => candidate.label === label);
  if (entry === undefined) throw new Error(`no captured entry for ${set}: ${label}`);
  return entry;
}

/** Head's XML writer over a recipe, as an outcome. Building the model is inside it, as at capture. */
function headXml(recipe: Recipe): Outcome {
  return outcome(() => serializeResourceXml(buildComplex(recipe, HEAD)));
}

/** Head's JSON writer over a recipe, as an outcome. */
function headJson(recipe: Recipe): Outcome {
  return outcome(() => serializeResource(buildComplex(recipe, HEAD)));
}

/**
 * XML 1.0 [5] `Name`, read off the grammar independently of `src/`. The combining marks lead the
 * second class so no mark follows another character in the pattern's source.
 */
const NAME =
  /^[:A-Z_a-z\u{C0}-\u{D6}\u{D8}-\u{F6}\u{F8}-\u{2FF}\u{370}-\u{37D}\u{37F}-\u{1FFF}\u{200C}-\u{200D}\u{2070}-\u{218F}\u{2C00}-\u{2FEF}\u{3001}-\u{D7FF}\u{F900}-\u{FDCF}\u{FDF0}-\u{FFFD}\u{10000}-\u{EFFFF}][\u{300}-\u{36F}\-.0-9:A-Z_a-z\u{B7}\u{C0}-\u{D6}\u{D8}-\u{F6}\u{F8}-\u{2FF}\u{370}-\u{37D}\u{37F}-\u{1FFF}\u{200C}-\u{200D}\u{203F}-\u{2040}\u{2070}-\u{218F}\u{2C00}-\u{2FEF}\u{3001}-\u{D7FF}\u{F900}-\u{FDCF}\u{FDF0}-\u{FFFD}\u{10000}-\u{EFFFF}]*$/u;

/** XML 1.0 [2] `Char`, as a whole string of them. */
const CHARS = /^[\t\n\r\u{20}-\u{D7FF}\u{E000}-\u{FFFD}\u{10000}-\u{10FFFF}]*$/u;

/** Every tag name and every string a recipe built by the constructors carries. */
function namesAndStrings(recipe: Recipe, names: string[], strings: string[]): void {
  if ("complex" in recipe) {
    for (const [name, value] of recipe.complex) {
      names.push(name);
      if (name === "resourceType" && "primitive" in value && typeof value.primitive === "string") {
        names.push(value.primitive);
      }
      namesAndStrings(value, names, strings);
    }
  } else if ("list" in recipe) {
    for (const item of recipe.list) namesAndStrings(item, names, strings);
  } else if ("primitive" in recipe) {
    if (typeof recipe.primitive === "string") strings.push(recipe.primitive);
    if (recipe.id !== undefined) strings.push(recipe.id);
    for (const extension of recipe.extension ?? []) namesAndStrings(extension, names, strings);
  }
}

describe("the record the base half is read from", () => {
  it("AC-6, AC-7, AC-8: was captured at the pin, and holds every model the suites grade, as they spell it", () => {
    expect(captured.base).toBe(BASE_PIN);
    for (const [set, models] of NAMED_SETS) {
      expect(
        recorded(set).map((entry) => [entry.label, entry.recipe]),
        `the record's ${set} set is stale: re-run scripts/capture-xml-wellformed.ts at the pin`,
      ).toEqual(models.map((model) => [model.label, model.recipe]));
    }
  });
});

describe("a model the base refused", () => {
  it("AC-6: the graded set reaches every code SERIALIZE_ERROR_CODES lists at the pin", () => {
    const reached = new Set(
      PIN_REFUSED_MODELS.map((model) => {
        const base = entryOf("pinRefused", model.label).xml;
        return "refused" in base ? base.refused : undefined;
      }),
    );
    expect([...reached].sort()).toEqual([...CODES_AT_PIN].sort());
    // And the pin's list is complete: head publishes exactly those plus the two new codes.
    expect(Object.values(SERIALIZE_ERROR_CODES).sort()).toEqual(
      [...CODES_AT_PIN, XML_NAME, XML_CHARACTER].sort(),
    );
  });

  it.each(PIN_REFUSED_MODELS.map((model) => [model.label, model] as const))(
    "AC-6: keeps the base's code and locations for %s",
    (label, model) => {
      const base = entryOf("pinRefused", label).xml;
      expect("refused" in base).toBe(true);
      expect(headXml(model.recipe)).toEqual(base);
    },
  );

  it.each(BOTH_NEW_MODELS.map((model) => [model.label, model] as const))(
    "AC-6: raises the name code for %s, which carries both new triggers and no base one",
    (label, model) => {
      expect("written" in entryOf("bothNew", label).xml).toBe(true);
      expect(headXml(model.recipe)).toEqual({ refused: XML_NAME, locations: model.locations });
    },
  );
});

describe("a model the base wrote, whose names are Names and whose characters are Chars", () => {
  it("AC-7: the corpus the record holds is the corpus corpus() returns", () => {
    expect(recorded("corpus").map((entry) => [entry.label, entry.recipe])).toEqual(
      corpus().map((document) => [document.name, { json: document.json }]),
    );
  });

  it.each(recorded("corpus").map((entry) => [entry.label, entry] as const))(
    "AC-7: returns the base's output for the corpus document %s",
    (_label, entry) => {
      expect(headXml(entry.recipe)).toEqual(entry.xml);
    },
  );

  it("AC-7: draws at least 1,000 generated models the base wrote, from Name and Char only", () => {
    const generated = recorded("generated");
    expect(generated.filter((entry) => "written" in entry.xml).length).toBeGreaterThanOrEqual(1000);
    const names: string[] = [];
    const strings: string[] = [];
    for (const entry of generated) namesAndStrings(entry.recipe, names, strings);
    expect(names.filter((name) => !NAME.test(name))).toEqual([]);
    expect(strings.filter((text) => !CHARS.test(text))).toEqual([]);
  });

  it("AC-7: returns a string byte-identical to the base's for every generated model", () => {
    const moved = recorded("generated")
      .map((entry, index) => ({ index, base: entry.xml, head: headXml(entry.recipe) }))
      .filter(({ base, head }) => JSON.stringify(base) !== JSON.stringify(head));
    expect(moved).toEqual([]);
  });
});

describe("the JSON writer", () => {
  const graded = [
    ...NAME_MODELS.map((model) => ["name", model] as const),
    ...CHARACTER_MODELS.map((model) => ["character", model] as const),
    ...DIV_MODELS.map((model) => ["div", model] as const),
    ...PIN_REFUSED_MODELS.map((model) => ["pinRefused", model] as const),
    ...BOTH_NEW_MODELS.map((model) => ["bothNew", model] as const),
  ].map(([set, model]) => [model.label, set, model] as const);

  it.each(graded)(
    "AC-8: returns the base's output, or the base's refusal, for %s",
    (label, set, model) => {
      const base = entryOf(set, label).json;
      const head = headJson(model.recipe);
      expect(head).toEqual(base);
      if ("refused" in head) expect([XML_NAME, XML_CHARACTER]).not.toContain(head.refused);
    },
  );
});
