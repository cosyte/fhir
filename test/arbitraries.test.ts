/**
 * The `@cosyte/fhir/arbitraries` subpath: what each generator promises, checked on fixed seeds so
 * every run reaches the same cases, and how the subpath is packaged (an optional peer dependency
 * that the main entry point never loads).
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";

import {
  FhirDecimal,
  decimal,
  parseResource,
  parseResourceXml,
  readBundle,
  serializeResource,
  type FhirComplex,
  type RawJson,
} from "../src/index.js";
import {
  RESOURCE_TYPES,
  bundle,
  decimalText,
  hostileInput,
  resource,
  resourceJson,
  resourceType,
  resourceXml,
  stringValue,
} from "../src/arbitraries/index.js";
import {
  NULL,
  arr,
  bool,
  member,
  num,
  obj,
  str,
  styledString,
  writeCompact,
  writeStyled,
  type JsonStyle,
} from "../src/arbitraries/json.js";
import { cleanResourceJson, resourceTree } from "../src/arbitraries/resource.js";
import {
  applyEdits,
  applyJsonQuirks,
  siblingsFirst,
  styleXml,
  type XmlStyle,
} from "../src/arbitraries/text.js";
import { carriesExtension } from "../src/arbitraries/values.js";

const root = join(import.meta.dirname, "..");

// Several tests below draw a few hundred generated resources, which takes several seconds under
// coverage on a CI runner; the suite's 10 s ceiling is too close for that.
vi.setConfig({ testTimeout: 60_000 });

/** The cheapest resources to draw, for tests that only look at their type or statuses. */
const LEAN = { extensions: false, narrative: false, maxRepeats: 1 } as const;

/** Draw `n` values from a fixed seed. */
function draw<T>(arb: fc.Arbitrary<T>, n = 200, seed = 20261110): T[] {
  return fc.sample(arb, { numRuns: n, seed });
}

/** The resource type of a model. */
function typeOf(model: FhirComplex): unknown {
  const node = model.properties[0]?.value;
  return node?.kind === "primitive" ? node.value : undefined;
}

/** Every object key in a JSON value. */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => [k, ...keysOf(v)]);
  }
  return [];
}

/** Every array length in a JSON value. */
function arrayLengths(value: unknown): number[] {
  if (Array.isArray(value)) return [value.length, ...value.flatMap(arrayLengths)];
  if (value !== null && typeof value === "object")
    return Object.values(value).flatMap(arrayLengths);
  return [];
}

const FLAT: JsonStyle = {
  indent: "",
  eol: "\n",
  beforeColon: "",
  afterColon: "",
  asciiOnly: false,
  escapeSlash: false,
  resourceTypeLast: false,
};

const PLAIN_XML: XmlStyle = {
  declaration: false,
  prefix: undefined,
  indent: "",
  eol: "\n",
  comments: false,
  singleQuotes: false,
  charRefs: false,
};

describe("stringValue", () => {
  it("is a FHIR string: never empty, never only whitespace, only tab and line feed among controls", () => {
    for (const text of draw(stringValue())) {
      expect(text.trim()).not.toBe("");
      expect(/^[ \r\n\t\S]+$/u.test(text)).toBe(true);
      expect([...text].length).toBeLessThanOrEqual(16);
    }
  });

  it("honours its length bounds, and mixes in what JSON and XML escape", () => {
    const texts = draw(stringValue({ minLength: 3, maxLength: 5 }), 400);
    for (const text of texts) {
      expect([...text].length).toBeGreaterThanOrEqual(3);
      expect([...text].length).toBeLessThanOrEqual(5);
    }
    const all = texts.join("");
    for (const ch of ['"', "<", "&", "\\", "\n", "😀"]) expect(all).toContain(ch);
    expect(draw(stringValue({ minLength: 0, maxLength: 0 }), 20).every((t) => t.length >= 1)).toBe(
      true,
    );
  });
});

describe("decimalText", () => {
  it("is a FHIR decimal the model keeps exactly, biased to trailing zeros, long digits and exponents", () => {
    const texts = draw(decimalText(), 600);
    for (const text of texts) expect(decimal(text).raw).toBe(text);
    expect(texts.some((t) => /\.\d*00$/u.test(t))).toBe(true);
    expect(texts.some((t) => /\d{16}/u.test(t))).toBe(true);
    expect(texts.some((t) => /[eE]/u.test(t))).toBe(true);
    expect(texts.some((t) => t.startsWith("-"))).toBe(true);
    expect(texts).not.toContain("-0");
  });

  it("leaves out the sign and the exponent when asked", () => {
    for (const text of draw(decimalText({ negative: false, exponent: false }), 300)) {
      expect(text).not.toMatch(/[-eE]/u);
    }
  });
});

describe("resourceType and resource", () => {
  it("draws the eight types the library validates in full", () => {
    expect(new Set(draw(resourceType(), 300))).toEqual(new Set(RESOURCE_TYPES));
    expect(new Set(draw(resource(LEAN), 150).map(typeOf))).toEqual(new Set(RESOURCE_TYPES));
  });

  it("draws only the types asked for, and every type when the list is empty", () => {
    const types = new Set(
      draw(resource({ ...LEAN, types: ["Condition", "Immunization"] }), 60).map(typeOf),
    );
    expect(types).toEqual(new Set(["Condition", "Immunization"]));
    expect(new Set(draw(resource({ ...LEAN, types: [] }), 150).map(typeOf)).size).toBe(8);
  });

  it("parses into the model classes the main entry point exports", () => {
    const quantities = draw(resource({ types: ["Observation"], extensions: false }), 40)
      .map((m) => m.properties.find((p) => p.name === "valueQuantity")?.value)
      .filter((q): q is FhirComplex => q?.kind === "complex");
    expect(quantities.length).toBeGreaterThan(0);
    for (const q of quantities) {
      const value = q.properties.find((p) => p.name === "value")?.value;
      expect(value?.kind === "primitive" ? value.value : undefined).toBeInstanceOf(FhirDecimal);
    }
  });

  it("prints a counterexample as the call that rebuilds it", () => {
    const [model] = draw(resource(), 1);
    const printed = fc.stringify(model);
    expect(printed.startsWith('parseResource("{\\"resourceType\\":')).toBe(true);
    expect(printed.endsWith('").resource')).toBe(true);
  });

  it("clones by parsing again, so code that changes a resource cannot change the case fast-check replays", () => {
    const [model] = draw(resource(), 1);
    if (model === undefined) throw new Error("no model");
    const clone = (model as unknown as Record<symbol, () => FhirComplex>)[fc.cloneMethod]?.();
    expect(clone).not.toBe(model);
    expect(clone).toEqual(model);
  });

  it("adds no extension and no narrative when asked, and keeps lists within maxRepeats", () => {
    for (const model of draw(resource({ extensions: false, narrative: false, maxRepeats: 1 }))) {
      const text = serializeResource(model);
      const keys = keysOf(JSON.parse(text));
      expect(keys.filter((k) => k.startsWith("_") || k === "extension" || k === "div")).toEqual([]);
      // AllergyIntolerance.category draws up to two distinct codes whatever the bound.
      expect(Math.max(0, ...arrayLengths(JSON.parse(text)))).toBeLessThanOrEqual(2);
    }
  });

  it("carries extensions on primitives, null-aligned metadata arrays and value-absent primitives", () => {
    const texts = draw(cleanResourceJson(), 400);
    expect(texts.some((t) => /"_\w+":\{"extension"/u.test(t))).toBe(true);
    expect(texts.some((t) => /"_\w+":\[[^\]]*null/u.test(t))).toBe(true);
    expect(texts.some((t) => /"\w+":\[[^\]]*null/u.test(t))).toBe(true);
    expect(texts.some((t) => t.includes('"text":{"status"'))).toBe(true);
    expect(texts.some((t) => t.includes('"code":"vital-signs"'))).toBe(true);
    expect(texts.some((t) => t.includes('"dataAbsentReason"'))).toBe(true);
    expect(texts.some((t) => /"extension":\[\{"url":"[^"]+","extension"/u.test(t))).toBe(true);
  });

  it("keeps the status invariants: no clinical status on a record entered in error, an inactive one once abated", () => {
    for (const model of draw(
      resource({ ...LEAN, types: ["Condition", "AllergyIntolerance"] }),
      300,
    )) {
      const doc = JSON.parse(serializeResource(model)) as Record<string, unknown>;
      const verification = JSON.stringify(doc["verificationStatus"] ?? "");
      if (verification.includes("entered-in-error")) expect(doc["clinicalStatus"]).toBeUndefined();
      else expect(doc["clinicalStatus"]).toBeDefined();
      const abated = Object.keys(doc).some((k) => k.startsWith("abatement"));
      if (abated)
        expect(JSON.stringify(doc["clinicalStatus"])).toMatch(/inactive|remission|resolved/u);
    }
  });
});

describe("bundle", () => {
  it("is a collection or search set of generated resources, each with a unique urn:uuid full URL", () => {
    const bundles = draw(bundle({ maxEntries: 3, maxRepeats: 1 }), 100);
    const types = new Set<string | undefined>();
    for (const b of bundles) {
      const readout = readBundle(b);
      types.add(readout.type);
      expect(readout.entries.length).toBeLessThanOrEqual(3);
      const urls = readout.entries.map((e) => e.fullUrl);
      expect(new Set(urls).size).toBe(urls.length);
      for (const url of urls) expect(url).toMatch(/^urn:uuid:/u);
      if (readout.type === "searchset") expect(readout.total).toBe(String(urls.length));
    }
    expect(types).toEqual(new Set(["collection", "searchset"]));
    expect(bundles.some((b) => readBundle(b).entries.length === 0)).toBe(true);
    expect(draw(bundle(), 50).some((b) => readBundle(b).entries.length === 4)).toBe(true);
  });
});

describe("resourceJson", () => {
  it("always parses, and carries every kind of mess", () => {
    const texts = draw(resourceJson(), 400);
    for (const text of texts) expect(() => parseResource(text)).not.toThrow();
    const some = (test: (t: string) => boolean): boolean => texts.some(test);
    expect(some((t) => t.includes("\r\n"))).toBe(true);
    expect(some((t) => t.includes("\t"))).toBe(true);
    expect(some((t) => t.includes(" : "))).toBe(true);
    expect(some((t) => /\\u[0-9a-f]{4}/u.test(t))).toBe(true);
    expect(some((t) => t.includes("\\/"))).toBe(true);
    expect(some((t) => !/^\s*\{\s*"resourceType"/u.test(t))).toBe(true);
    for (const quirk of ['"zzUnknown"', '"zzEmpty"', '"zzNull"', '"zzNested"']) {
      expect(some((t) => t.includes(quirk))).toBe(true);
    }
  });

  it("siblingsFirst puts each `_` sibling ahead of its value, at every depth", () => {
    const tree = obj([
      member("a", str("x")),
      member("_a", obj([member("id", str("i"))])),
      member("b", arr([obj([member("c", bool(true)), member("_c", obj([])), member("d", NULL)])])),
    ]);
    expect(writeCompact(siblingsFirst(tree))).toBe(
      '{"_a":{"id":"i"},"a":"x","b":[{"_c":{},"c":true,"d":null}]}',
    );
  });

  it("applyJsonQuirks adds each quirk at the root, and leaves a document alone without them", () => {
    const tree = obj([member("resourceType", str("Patient"))]);
    const none = {
      siblingFirst: false,
      unknownElement: false,
      emptyArray: false,
      undefinedNull: false,
      nestedArray: false,
    };
    expect(writeCompact(applyJsonQuirks(tree, none, "t"))).toBe('{"resourceType":"Patient"}');
    const all = {
      ...none,
      unknownElement: true,
      emptyArray: true,
      undefinedNull: true,
      nestedArray: true,
    };
    expect(writeCompact(applyJsonQuirks(tree, all, "t"))).toBe(
      '{"resourceType":"Patient","zzUnknown":{"note":"t"},"zzEmpty":[],"zzNull":null,"zzNested":[["t",1.50]]}',
    );
  });

  it("writeStyled spells the same value in every style", () => {
    const tree: RawJson = obj([
      member("resourceType", str("Patient")),
      member("a", arr([])),
      member("b", obj([])),
      member("c", arr([num("1.0"), bool(false), NULL, str("é/😀")])),
    ]);
    const pretty = {
      ...FLAT,
      indent: "  ",
      beforeColon: " ",
      afterColon: " ",
      resourceTypeLast: true,
    };
    const text = writeStyled(tree, pretty);
    expect(text).toBe(
      '{\n  "a" : [],\n  "b" : {},\n  "c" : [\n    1.0,\n    false,\n    null,\n    "é/😀"\n  ],\n  "resourceType" : "Patient"\n}',
    );
    expect(JSON.parse(text)).toEqual(JSON.parse(writeCompact(tree)));
    expect(styledString("é/😀", { ...FLAT, asciiOnly: true, escapeSlash: true })).toBe(
      '"\\u00e9\\/\\ud83d\\ude00"',
    );
  });
});

describe("resourceXml", () => {
  it("always reads with no issue, and carries every spelling", () => {
    const texts = draw(resourceXml(), 300);
    for (const text of texts) expect(parseResourceXml(text).issues).toEqual([]);
    const some = (test: (t: string) => boolean): boolean => texts.some(test);
    expect(some((t) => t.startsWith("<?xml"))).toBe(true);
    expect(some((t) => /^(<\?xml[^>]*>\r?\n)?<(f|fhir|h7):/u.test(t))).toBe(true);
    expect(some((t) => t.includes("<!--"))).toBe(true);
    expect(some((t) => t.includes("value='"))).toBe(true);
    expect(some((t) => /&#x[0-9a-f]+;/u.test(t))).toBe(true);
    expect(some((t) => t.includes("\r\n"))).toBe(true);
  });

  it("styleXml leaves a narrative exactly as written and re-spells the rest", () => {
    const div = '<div xmlns="http://www.w3.org/1999/xhtml"><p>a</p></div>';
    const xml = `<Patient xmlns="http://hl7.org/fhir"><text><status value="generated"/>${div}</text><active value="true"/></Patient>`;
    const style = { ...PLAIN_XML, prefix: "f", indent: " ", comments: true, singleQuotes: true };
    const out = styleXml(xml, style);
    expect(out).toContain(div);
    expect(out).toContain("<f:active value='true'/>");
    expect(out).toContain("<!-- active -->");
    expect(parseResourceXml(out).issues).toEqual([]);
    expect(styleXml(xml, PLAIN_XML)).toBe(xml);
    const plain =
      '<Patient xmlns="http://hl7.org/fhir"><name><given value="é&quot;\'"/></name></Patient>';
    const quoted = styleXml(plain, {
      ...PLAIN_XML,
      singleQuotes: true,
      charRefs: true,
      declaration: true,
    });
    expect(quoted).toBe(
      `<?xml version="1.0" encoding="UTF-8"?>\n<Patient xmlns='http://hl7.org/fhir'><name><given value='&#xe9;"&apos;'/></name></Patient>`,
    );
  });
});

describe("hostileInput", () => {
  it("gives strings, aimed at either reader or both", () => {
    for (const format of ["json", "xml", undefined] as const) {
      const texts = draw(
        hostileInput({ ...(format === undefined ? {} : { format }), maxLength: 20 }),
        300,
      );
      expect(texts.every((t) => typeof t === "string")).toBe(true);
      const xmlish = texts.filter((t) => t.includes("<Patient") || t.includes("<!DOCTYPE"));
      const jsonish = texts.filter((t) => t.includes('"resourceType"'));
      if (format === "json") expect(xmlish.length).toBe(0);
      if (format === "xml") expect(jsonish.length).toBe(0);
      if (format === undefined) expect(xmlish.length * jsonish.length).toBeGreaterThan(0);
    }
  });

  it("applyEdits cuts, deletes and inserts at positions taken modulo the length", () => {
    expect(applyEdits("abcdef", [{ kind: "cut", at: 3 }])).toBe("abc");
    expect(applyEdits("abcdef", [{ kind: "cut", at: 10 }])).toBe("abc");
    expect(applyEdits("abcdef", [{ kind: "delete", at: 1, length: 2 }])).toBe("adef");
    expect(applyEdits("abc", [{ kind: "insert", at: 1, text: "XY" }])).toBe("aXYbc");
    expect(applyEdits("", [{ kind: "insert", at: 5, text: "Z" }])).toBe("Z");
  });
});

describe("internal helpers", () => {
  it("carriesExtension asks whether metadata holds an extension", () => {
    expect(carriesExtension(obj([member("extension", arr([]))]))).toBe(true);
    expect(carriesExtension(obj([member("id", str("a"))]))).toBe(false);
    expect(carriesExtension(str("a"))).toBe(false);
  });

  it("resourceTree is the raw form resource() parses", () => {
    const [tree] = draw(resourceTree({ types: ["Patient"] }), 1);
    expect(tree?.t).toBe("obj");
  });
});

describe("packaging", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    exports: Record<string, unknown>;
    typesVersions: Record<string, Record<string, string[]>>;
    files: string[];
    dependencies?: Record<string, string>;
    peerDependencies: Record<string, string>;
    peerDependenciesMeta: Record<string, { optional?: boolean }>;
  };

  it("exports the subpath for import and require, each with its own types, and publishes its files", () => {
    expect(pkg.exports["./arbitraries"]).toEqual({
      import: { types: "./dist/arbitraries.d.ts", default: "./dist/arbitraries.mjs" },
      require: { types: "./dist/arbitraries.d.cts", default: "./dist/arbitraries.cjs" },
    });
    expect(pkg.typesVersions["*"]?.["arbitraries"]).toEqual(["./dist/arbitraries.d.ts"]);
    for (const file of ["mjs", "cjs", "d.ts", "d.cts"]) {
      expect(pkg.files).toContain(`dist/arbitraries.${file}`);
    }
  });

  it("takes fast-check as an optional peer dependency, never a dependency", () => {
    expect(pkg.peerDependencies["fast-check"]).toBeDefined();
    expect(pkg.peerDependenciesMeta["fast-check"]?.optional).toBe(true);
    expect(pkg.dependencies?.["fast-check"]).toBeUndefined();
  });

  it("imports fast-check only under src/arbitraries, and nothing the main entry reaches imports that folder", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? walk(join(dir, e.name))
          : e.name.endsWith(".ts")
            ? [join(dir, e.name)]
            : [],
      );
    const offenders: string[] = [];
    for (const file of walk(join(root, "src"))) {
      const rel = relative(join(root, "src"), file);
      if (rel.startsWith("arbitraries")) continue;
      const text = readFileSync(file, "utf8");
      if (/from\s+["']fast-check["']/u.test(text) || /from\s+["'][./]*arbitraries/u.test(text)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});
