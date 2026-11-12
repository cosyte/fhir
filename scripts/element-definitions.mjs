#!/usr/bin/env node
/**
 * Derive, or check, `test/__data__/fhir-element-definitions.json`: what the FHIR R4 and R4B
 * definitions say about the elements the safety readout reads.
 *
 *   pnpm definitions:check            fetch the pinned definitions, derive, compare (CI)
 *   pnpm definitions:derive           fetch the pinned definitions, derive, write the file
 *
 * Either form takes `--dir <directory>` to read the four definition files from a directory instead
 * of fetching them. A file is read only when its SHA-256 matches the one pinned below, fetched or
 * not, so the projection is always the projection of exactly these bytes.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * THE SOURCES
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * `profiles-resources.xml` and `profiles-types.xml` of FHIR R4 (4.0.1) and R4B (4.3.0), the
 * specification's own StructureDefinition bundles, as the HAPI FHIR project redistributes them in
 * its `hapi-fhir-validation-resources-r4` and `-r4b` modules, read at one pinned commit. For R4 the
 * projection was compared, when it was made, with the same projection of the published
 * `hl7.fhir.r4.core` 4.0.1 package and agreed. The specification is licensed CC0; see
 * `test/__data__/fhir-element-definitions.NOTICE.txt`.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * THE RULE
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * Read every StructureDefinition whose derivation is `specialization` (the base resources and
 * datatypes), and every complex-type one whose derivation is `constraint` (`Age`, `Duration`,
 * `SimpleQuantity` and the like) as a name for the type it constrains. From their snapshots:
 *
 * - `resourcePositions`: every element path whose type is `Resource`, sorted.
 * - `contentReferences`: every element that repeats another element's definition, as
 *   `[path, target]`, sorted, for a target holding a `Resource` element below it.
 * - `elements`: starting at the ten resource types the readout assesses, the elements each context
 *   defines, closed over every context they reach. A context is a type (`Patient`, `Quantity`) or a
 *   backbone element (`Bundle.entry`). Each element maps to what is below it: `"primitive"`,
 *   `"Resource"`, or a context. A choice `value[x]` is listed by each name a document writes
 *   (`valueQuantity`, `valueString`), and a constrained datatype by the type it constrains.
 *
 * The XML is read by a narrow scanner written for these files, not by this package's own reader,
 * so the definitions the readout is checked against do not pass through the code under test.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "test", "__data__", "fhir-element-definitions.json");

/** The commit of github.com/hapifhir/hapi-fhir the four files are read at. */
const COMMIT = "3f77c0353b0bf07f0b06eaaa56df43e501447bff";

const BASE = `https://raw.githubusercontent.com/hapifhir/hapi-fhir/${COMMIT}`;

/** The four inputs: where each is fetched from and the digest it must have. */
const SOURCES = {
  r4: {
    version: "4.0.1",
    files: {
      "profiles-resources.xml": {
        url: `${BASE}/hapi-fhir-validation-resources-r4/src/main/resources/org/hl7/fhir/r4/model/profile/profiles-resources.xml`,
        sha256: "f3005bd427a60a3552be16d59e66b4546d0e9d58decd97b87f5943fbef94a1b7",
      },
      "profiles-types.xml": {
        url: `${BASE}/hapi-fhir-validation-resources-r4/src/main/resources/org/hl7/fhir/r4/model/profile/profiles-types.xml`,
        sha256: "4edb5f32c4977153a70a5db4b733c56308f94fe85f0278d11df87b589f53b097",
      },
    },
  },
  r4b: {
    version: "4.3.0",
    files: {
      "profiles-resources.xml": {
        url: `${BASE}/hapi-fhir-validation-resources-r4b/src/main/resources/org/hl7/fhir/r4b/model/profile/profiles-resources.xml`,
        sha256: "d564774a387cee996f9f29c9ea7a13b930780434ef62b28f5c35c0045177f0ff",
      },
      "profiles-types.xml": {
        url: `${BASE}/hapi-fhir-validation-resources-r4b/src/main/resources/org/hl7/fhir/r4b/model/profile/profiles-types.xml`,
        sha256: "89a784af23844c305f8a8a567569ecb97a279a059596efab99b994ec4ed03c99",
      },
    },
  },
};

/** The resource types the safety readout assesses, the roots the element closure starts from. */
const ASSESSED = [
  "AllergyIntolerance",
  "Bundle",
  "Condition",
  "DiagnosticReport",
  "Immunization",
  "MedicationRequest",
  "MedicationStatement",
  "Observation",
  "Patient",
  "Practitioner",
];

const RETRIES = 3;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function fetchBytes(url) {
  let lastError;
  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "user-agent": "cosyte-fhir-element-definitions/1.0" },
      });
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt < RETRIES) await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
  throw new Error(`could not retrieve ${url}: ${String(lastError)}`);
}

/** The bytes of one input, from `dir` or fetched, refused unless the digest is the pinned one. */
async function input(release, name, dir) {
  const source = SOURCES[release].files[name];
  const bytes =
    dir === undefined
      ? await fetchBytes(source.url)
      : readFileSync(path.join(dir, `${release}-${name}`));
  const digest = sha256(bytes);
  if (digest !== source.sha256) {
    throw new Error(
      `${release} ${name}: digest ${digest}, pinned ${source.sha256}. Not read.`,
    );
  }
  return bytes.toString("utf8");
}

/** The `value` attribute of the first `<tag value="...">` in `text`, unescaped. */
function valueOf(text, tag) {
  const match = new RegExp(`<${tag} value="([^"]*)"`).exec(text);
  return match === null ? undefined : unescape(match[1]);
}

function unescape(text) {
  return text
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

/**
 * Every StructureDefinition in a bundle: its header fields and its snapshot elements, each as
 * `{ path, types, contentReference }`.
 */
function structureDefinitions(xml) {
  const out = [];
  const parts = xml.split("<StructureDefinition xmlns=").slice(1);
  for (const part of parts) {
    const body = part.slice(0, part.indexOf("</StructureDefinition>"));
    const snapshotAt = body.indexOf("<snapshot>");
    if (snapshotAt < 0) throw new Error("a StructureDefinition with no snapshot");
    // The header is everything before the snapshot, with the narrative taken out so nothing in it
    // can be read as a field.
    let header = body.slice(0, snapshotAt);
    const textAt = header.indexOf("<text>");
    if (textAt >= 0) header = header.slice(0, textAt) + header.slice(header.indexOf("</text>") + 7);
    const snapshot = body.slice(snapshotAt, body.indexOf("</snapshot>"));
    const elements = snapshot
      .split("<element id=")
      .slice(1)
      .map((chunk) => {
        const element = chunk.slice(0, chunk.indexOf("</element>"));
        const types = [...element.matchAll(/<type>([\s\S]*?)<\/type>/g)].map((m) => {
          const code = valueOf(m[1], "code");
          if (code === undefined) throw new Error("a type with no code");
          return code;
        });
        const elementPath = valueOf(element, "path");
        if (elementPath === undefined) throw new Error("an element with no path");
        return { path: elementPath, types, contentReference: valueOf(element, "contentReference") };
      });
    out.push({
      name: valueOf(header, "name"),
      type: valueOf(header, "type"),
      kind: valueOf(header, "kind"),
      derivation: valueOf(header, "derivation"),
      elements,
    });
  }
  return out;
}

function isPrimitiveCode(code) {
  return code.startsWith("http://hl7.org/fhirpath/") || /^[a-z]/.test(code);
}

/** The projection of one release's two bundles. */
function project(resourcesXml, typesXml) {
  const definitions = [
    ...structureDefinitions(resourcesXml),
    ...structureDefinitions(typesXml),
  ];
  const byType = new Map();
  const alias = new Map();
  for (const sd of definitions) {
    if (sd.derivation === "specialization") byType.set(sd.type, sd);
    else if (sd.derivation === "constraint" && sd.kind === "complex-type") {
      alias.set(sd.name, sd.type);
    }
  }

  const resourcePositions = [];
  for (const sd of byType.values()) {
    for (const element of sd.elements) {
      if (element.types.includes("Resource")) resourcePositions.push(element.path);
    }
  }
  resourcePositions.sort();

  const contentReferences = [];
  for (const sd of byType.values()) {
    for (const element of sd.elements) {
      if (element.contentReference === undefined) continue;
      const target = element.contentReference.slice(element.contentReference.indexOf("#") + 1);
      if (resourcePositions.some((position) => position.startsWith(`${target}.`))) {
        contentReferences.push([element.path, target]);
      }
    }
  }
  contentReferences.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  const contexts = new Map();
  const todo = [...ASSESSED];
  const target = (code, elementPath, all) => {
    if (code === "Resource") return "Resource";
    if (isPrimitiveCode(code)) return "primitive";
    if (
      (code === "BackboneElement" || code === "Element") &&
      all.some((e) => e.path.startsWith(`${elementPath}.`))
    ) {
      return elementPath;
    }
    return alias.get(code) ?? code;
  };
  while (todo.length > 0) {
    const context = todo.pop();
    if (contexts.has(context)) continue;
    const typeName = context.split(".")[0];
    const sd = byType.get(typeName);
    if (sd === undefined) throw new Error(`no definition for ${context}`);
    const prefix = `${context}.`;
    const members = {};
    for (const element of sd.elements) {
      if (!element.path.startsWith(prefix)) continue;
      const name = element.path.slice(prefix.length);
      if (name.includes(".")) continue;
      const add = (memberName, to) => {
        const list = members[memberName] ?? [];
        if (!list.includes(to)) list.push(to);
        members[memberName] = list;
        if (to !== "primitive" && to !== "Resource") todo.push(to);
      };
      if (element.contentReference !== undefined) {
        const ref = element.contentReference;
        add(name, ref.slice(ref.indexOf("#") + 1));
      } else if (name.endsWith("[x]")) {
        const stem = name.slice(0, -3);
        for (const code of element.types) {
          add(stem + code[0].toUpperCase() + code.slice(1), target(code, element.path, sd.elements));
        }
      } else {
        for (const code of element.types) add(name, target(code, element.path, sd.elements));
      }
    }
    contexts.set(context, members);
  }
  const elements = {};
  for (const context of [...contexts.keys()].sort()) {
    const members = contexts.get(context);
    const sorted = {};
    for (const name of Object.keys(members).sort()) sorted[name] = members[name];
    elements[context] = sorted;
  }
  return { resourcePositions, contentReferences, elements };
}

async function derive(dir) {
  const releases = {};
  for (const release of Object.keys(SOURCES)) {
    const resources = await input(release, "profiles-resources.xml", dir);
    const types = await input(release, "profiles-types.xml", dir);
    releases[release] = project(resources, types);
  }
  const projection = {
    note:
      "Committed expectation data: a projection of the FHIR R4 and R4B StructureDefinitions named " +
      "under sources. Do not hand-edit: re-derive it with `pnpm definitions:derive`, and " +
      "`pnpm definitions:check` (CI) re-derives it from the pinned files and compares. The rule is " +
      "the docblock of scripts/element-definitions.mjs.",
    licence:
      "CC0-1.0, as the FHIR specification is; see fhir-element-definitions.NOTICE.txt beside this file.",
    sources: Object.fromEntries(
      Object.entries(SOURCES).map(([release, source]) => [
        release,
        {
          version: source.version,
          files: Object.fromEntries(
            Object.entries(source.files).map(([name, file]) => [
              name,
              { url: file.url, sha256: file.sha256 },
            ]),
          ),
        },
      ]),
    ),
    assessedTypes: ASSESSED,
    resourcePositions: Object.fromEntries(
      Object.entries(releases).map(([release, p]) => [release, p.resourcePositions]),
    ),
    contentReferences: Object.fromEntries(
      Object.entries(releases).map(([release, p]) => [release, p.contentReferences]),
    ),
    elements: Object.fromEntries(
      Object.entries(releases).map(([release, p]) => [release, p.elements]),
    ),
  };
  return `${JSON.stringify(projection, null, 2)}\n`;
}

async function main() {
  const args = process.argv.slice(2);
  const mode = args[0];
  if (mode !== "--write" && mode !== "--check") {
    throw new Error("usage: element-definitions.mjs --write|--check [--dir <directory>]");
  }
  const dirAt = args.indexOf("--dir");
  const dir = dirAt >= 0 ? path.resolve(args[dirAt + 1] ?? "") : undefined;
  const text = await derive(dir);
  if (mode === "--write") {
    mkdirSync(path.dirname(OUT), { recursive: true });
    writeFileSync(OUT, text);
    process.stdout.write(`wrote ${path.relative(ROOT, OUT)}\n`);
    return;
  }
  const committed = readFileSync(OUT, "utf8");
  if (committed !== text) {
    process.stderr.write(
      `${path.relative(ROOT, OUT)} does not match the projection of the pinned definitions. ` +
        "Re-derive it with `pnpm definitions:derive` and read the diff.\n",
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    `${path.relative(ROOT, OUT)} matches the projection of the pinned R4 and R4B definitions.\n`,
  );
}

await main();
