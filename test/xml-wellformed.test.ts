/**
 * `serializeResourceXml` refuses a document a conforming XML 1.0 processor must reject for a name or
 * a character: a tag name that is not an XML 1.0 `Name` (production [5]) draws
 * `UNSERIALIZABLE_XML_NAME`, and a code point outside `Char` (production [2]) in an attribute value
 * or a spliced `div` string, raw or denoted by a character reference, draws
 * `UNSERIALIZABLE_XML_CHARACTER`. Nothing is repaired, escaped into a reference or dropped.
 *
 * The models are `test/_xml-wellformed-models.ts`; what the base tree did with each one is the
 * committed record `test/__data__/xml-wellformed-base.json`, captured by
 * `scripts/capture-xml-wellformed.ts`. The codes are compared as string literals rather than read
 * off `SERIALIZE_ERROR_CODES`, so a tree that lacks them cannot pass by comparing `undefined` with
 * `undefined`. What head must keep as the base did is `test/xml-wellformed-base.test.ts`.
 *
 * All names, values and namespace URIs here are synthetic.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  FhirSerializeError,
  complex,
  list,
  parseResource,
  parseResourceXml,
  primitive,
  serializeResourceXml,
  type FhirComplex,
  type FhirNode,
} from "../src/index.js";
import {
  BOTH_NEW_MODELS,
  CHARACTER_MODELS,
  CLEAN_MODELS,
  DIV_MODELS,
  DIV_WRITTEN_MODELS,
  NAME_MODELS,
  SENTINEL,
  SENTINEL_MODELS,
  buildComplex,
  outcome,
  type ModelCodec,
  type NamedModel,
  type Outcome,
} from "./_xml-wellformed-models.js";

const XML_NAME = "UNSERIALIZABLE_XML_NAME";
const XML_CHARACTER = "UNSERIALIZABLE_XML_CHARACTER";

/** Head's own readers and constructors, behind the surface the capture called the base through. */
const HEAD: ModelCodec<FhirNode, FhirComplex> = {
  parseResource,
  parseResourceXml,
  complex,
  list,
  primitive,
};

interface CapturedEntry {
  readonly label: string;
  readonly xml: Outcome;
}

const captured = JSON.parse(
  readFileSync(new URL("./__data__/xml-wellformed-base.json", import.meta.url), "utf8"),
) as { readonly sets: Record<string, readonly CapturedEntry[]> };

/** What the base's XML writer did with the model labelled `label` in set `set`. */
function baseXml(set: string, label: string): Outcome {
  const entry = captured.sets[set]?.find((candidate) => candidate.label === label);
  if (entry === undefined) throw new Error(`no captured entry for ${set}: ${label}`);
  return entry.xml;
}

/** A fresh head model for `model`. */
function build(model: NamedModel): FhirComplex {
  return buildComplex(model.recipe, HEAD);
}

/** The `FhirSerializeError` head's XML writer raises for `node`, or `undefined` when it writes. */
function refusal(node: FhirComplex): FhirSerializeError | undefined {
  try {
    serializeResourceXml(node);
    return undefined;
  } catch (error) {
    if (error instanceof FhirSerializeError) return error;
    throw error;
  }
}

/** Whether `text` holds a code point outside XML 1.0 `Char`, read independently of `src/`. */
function holdsNonChar(text: string): boolean {
  return /[^\t\n\r\u{20}-\u{D7FF}\u{E000}-\u{FFFD}\u{10000}-\u{10FFFF}]/u.test(text);
}

/** The message and every location of a refusal, the surface a caller's log can print. */
function surface(err: FhirSerializeError): string {
  return [err.message, ...err.locations].join("\n");
}

const labels = (models: readonly NamedModel[]): string[] => models.map((m) => m.label);

describe("a tag name that is not an XML 1.0 Name", () => {
  it.each(labels(NAME_MODELS))("AC-1: the base wrote %s", (label) => {
    expect("written" in baseXml("name", label)).toBe(true);
  });

  it.each(NAME_MODELS.map((m) => [m.label, m] as const))(
    "AC-1: refuses %s on the name code, every position once, in walk order",
    (_label, model) => {
      const node = build(model);
      expect(() => serializeResourceXml(node)).toThrow(FhirSerializeError);
      const err = refusal(node);
      expect(err?.code).toBe(XML_NAME);
      expect(err?.locations).toEqual(model.locations);
    },
  );
});

describe("a character outside XML 1.0 Char in an attribute value the writer emits", () => {
  it.each(labels(CHARACTER_MODELS))("AC-2: the base wrote %s", (label) => {
    expect("written" in baseXml("character", label)).toBe(true);
  });

  it.each(CHARACTER_MODELS.map((m) => [m.label, m] as const))(
    "AC-2: refuses %s on the character code, every location once, in walk order",
    (_label, model) => {
      const node = build(model);
      // A refusal returns no string at all, so the character is neither written raw, written as
      // a reference, replaced nor dropped, and neither is the value carrying it.
      expect(() => serializeResourceXml(node)).toThrow(FhirSerializeError);
      const err = refusal(node);
      expect(err?.code).toBe(XML_CHARACTER);
      expect(err?.locations).toEqual(model.locations);
    },
  );
});

describe("a div string carrying a character outside XML 1.0 Char", () => {
  it.each(labels(DIV_MODELS))("AC-3: the base wrote %s, passing both div checks", (label) => {
    expect("written" in baseXml("div", label)).toBe(true);
  });

  it.each(DIV_MODELS.map((m) => [m.label, m] as const))(
    "AC-3: refuses %s at the div location, raw or by reference",
    (_label, model) => {
      const node = build(model);
      expect(() => serializeResourceXml(node)).toThrow(FhirSerializeError);
      const err = refusal(node);
      expect(err?.code).toBe(XML_CHARACTER);
      expect(err?.locations).toEqual(model.locations);
    },
  );

  it.each(DIV_WRITTEN_MODELS.map((m) => [m.label, m] as const))(
    "AC-3: writes %s as the base did",
    (label, model) => {
      const base = baseXml("divWritten", label);
      expect("written" in base).toBe(true);
      expect(outcome(() => serializeResourceXml(build(model)))).toEqual(base);
    },
  );
});

describe("what either refusal reports", () => {
  it.each(SENTINEL_MODELS.map((m) => [m.label, m] as const))(
    "AC-4: echoes no part of %s into the message or any location",
    (_label, model) => {
      const err = refusal(build(model));
      expect(err).toBeInstanceOf(FhirSerializeError);
      if (err === undefined) return;
      expect([XML_NAME, XML_CHARACTER]).toContain(err.code);
      expect(err.locations).toEqual(model.locations);
      const printed = surface(err);
      expect(printed).not.toContain(SENTINEL);
      for (const content of model.content) expect(printed).not.toContain(content);
    },
  );

  it.each([...NAME_MODELS, ...CHARACTER_MODELS, ...DIV_MODELS].map((m) => [m.label, m] as const))(
    "AC-4: prints no character outside Char and no unbounded segment for %s",
    (_label, model) => {
      const err = refusal(build(model));
      expect(err).toBeInstanceOf(FhirSerializeError);
      if (err === undefined) return;
      expect(holdsNonChar(surface(err))).toBe(false);
      for (const location of err.locations) {
        for (const segment of location.split(".")) {
          expect(segment).toMatch(/^(?:[A-Za-z][A-Za-z0-9]*|<withheld>)(?:\[\d+\])*$/u);
        }
      }
      expect(err.message).toContain(`${String(err.locations.length)} location(s)`);
    },
  );
});

describe("every name a Name and every character a Char", () => {
  it.each(CLEAN_MODELS.map((m) => [m.label, m] as const))(
    "AC-5: raises neither code for %s and returns the base's output",
    (label, model) => {
      const base = baseXml("clean", label);
      expect("written" in base).toBe(true);
      const head = outcome(() => serializeResourceXml(build(model)));
      expect(head).toEqual(base);
    },
  );
});

describe("the model a refusal leaves behind", () => {
  it.each(
    [...NAME_MODELS, ...CHARACTER_MODELS, ...DIV_MODELS, ...BOTH_NEW_MODELS].map(
      (m) => [m.label, m] as const,
    ),
  )("AC-9: leaves %s structurally unchanged", (_label, model) => {
    const node = build(model);
    const untouched = build(model);
    const err = refusal(node);
    expect([XML_NAME, XML_CHARACTER]).toContain(err?.code);
    expect(node).toStrictEqual(untouched);
  });
});
