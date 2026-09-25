/**
 * A synthetic US Core world for the differential harness suites: a package tarball built here, its
 * examples, and a corpus declaration naming both, written to a scratch directory. No JVM, no
 * network and no build: the oracle is a function the suite passes in.
 *
 * EVERYTHING HERE IS SYNTHETIC. The StructureDefinitions carry US Core's public profile ids and
 * constraint keys, which are identifiers and not content, over snapshots written here; the example
 * documents carry coded values from public vocabularies, reserved `example.org` hosts, and no
 * person, name, date of birth or address.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";

import { parseDeclaration, sha256 } from "../scripts/differential/corpus.mjs";
import type { Declaration } from "../scripts/differential/corpus.mjs";
import { oracleIdentity } from "../scripts/differential/oracle.mjs";
import {
  resolveTerminologyInputs,
  TERMINOLOGY_INPUTS,
} from "../scripts/differential/terminology.mjs";

export const US_CORE = "http://hl7.org/fhir/us/core/StructureDefinition/";
export const UCUM = "http://unitsofmeasure.org";
export const CORPUS = "uscore";

/** A gzipped ustar archive of `entries`, written byte by byte so the reader is graded on our bytes. */
export function tgz(entries: Readonly<Record<string, string>>): Buffer {
  const blocks: Buffer[] = [];
  for (const [name, body] of Object.entries(entries)) {
    const data = Buffer.from(body, "utf8");
    const header = Buffer.alloc(512);
    header.write(name, 0, "latin1");
    header.write("0000644\0", 100, "latin1");
    header.write("0000000\0", 108, "latin1");
    header.write("0000000\0", 116, "latin1");
    header.write(`${data.length.toString(8).padStart(11, "0")}\0`, 124, "latin1");
    header.write("00000000000\0", 136, "latin1");
    header.write("        ", 148, "latin1");
    header.write("0", 156, "latin1");
    header.write("ustar\0", 257, "latin1");
    header.write("00", 263, "latin1");
    let sum = 0;
    for (const byte of header) sum += byte;
    header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "latin1");
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

/**
 * One synthetic StructureDefinition: an id, the package version it is published in, the type, the
 * snapshot constraints, and a parent.
 */
export function profile(
  id: string,
  version: string,
  type: string,
  constraints: Readonly<Record<string, readonly string[]>>,
  base?: string,
): string {
  const elements: Record<string, unknown>[] = [{ id: type, path: type }];
  for (const [element, keys] of Object.entries(constraints)) {
    if (element === type) {
      elements[0] = { ...elements[0], constraint: keys.map((key) => constraintOf(key)) };
      continue;
    }
    const [path, sliceName] = element.split(":");
    elements.push({
      id: element,
      path,
      ...(sliceName === undefined ? {} : { sliceName }),
      constraint: keys.map((key) => constraintOf(key)),
    });
  }
  return JSON.stringify({
    resourceType: "StructureDefinition",
    id,
    url: `${US_CORE}${id}`,
    version,
    kind: "resource",
    derivation: "constraint",
    type,
    baseDefinition:
      base === undefined ? `http://hl7.org/fhir/StructureDefinition/${type}` : `${US_CORE}${base}`,
    snapshot: { element: elements },
  });
}

function constraintOf(key: string): Record<string, string> {
  return { key, severity: "error", human: "synthetic", expression: "true" };
}

/** The synthetic profiles every version of the scratch package carries, each naming its version. */
export function standardProfiles(version: string): Record<string, string> {
  return {
    "package/StructureDefinition-us-core-observation-clinical-result.json": profile(
      "us-core-observation-clinical-result",
      version,
      "Observation",
      { "Observation.value[x]": ["us-core-3"] },
    ),
    "package/StructureDefinition-us-core-observation-lab.json": profile(
      "us-core-observation-lab",
      version,
      "Observation",
      { "Observation.value[x]": ["us-core-3", "us-core-4"] },
      "us-core-observation-clinical-result",
    ),
    "package/StructureDefinition-us-core-organization.json": profile(
      "us-core-organization",
      version,
      "Organization",
      { "Organization.identifier:NPI": ["us-core-16"] },
    ),
  };
}

/** A synthetic Observation declaring `profiles`, carrying `value` as its only value[x]. */
export function observation(
  profiles: readonly string[] | undefined,
  value: Record<string, unknown>,
): string {
  return JSON.stringify({
    resourceType: "Observation",
    ...(profiles === undefined ? {} : { meta: { profile: profiles } }),
    status: "final",
    code: { coding: [{ system: "http://loinc.org", code: "2951-2" }] },
    ...value,
  });
}

export const QUANTITY = {
  valueQuantity: { value: 140, unit: "mmol/L", system: UCUM, code: "mmol/L" },
};
export const CONCEPT = {
  valueCodeableConcept: { coding: [{ system: "http://snomed.info/sct", code: "260385009" }] },
};
export const STRING = { valueString: "synthetic" };

export interface WorldDocument {
  readonly version: string;
  readonly file: string;
  readonly body: string;
}

export interface WorldOptions {
  /** The US Core examples, per version. */
  readonly documents: readonly WorldDocument[];
  /** Extra package entries per version, over the standard profiles. */
  readonly packages?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** A pre-existing corpus beside the US Core one, with one document per entry. */
  readonly existing?: readonly string[];
}

export interface World {
  readonly declaration: Declaration;
  readonly documentsRoot: string;
  readonly packages: Readonly<Record<string, Buffer>>;
  readonly profileText: (version: string, id: string) => string;
  readonly jar: string;
  readonly identity: ReturnType<typeof oracleIdentity>;
  readonly terminology: ReturnType<typeof resolveTerminologyInputs>;
}

/** Build the scratch world on disk and return the declaration that names it. */
export function usCoreWorld(options: WorldOptions): World {
  const documentsRoot = mkdtempSync(join(tmpdir(), "fhir-uscore-world-"));
  const versions = [...new Set(["9.0.0", ...options.documents.map((d) => d.version)])];
  const packages: Record<string, Buffer> = {};
  const entriesByVersion: Record<string, Record<string, string>> = {};
  for (const version of versions) {
    const entries: Record<string, string> = {
      "package/package.json": JSON.stringify({
        name: "hl7.fhir.us.core",
        version,
        license: "CC0-1.0",
      }),
      ...standardProfiles(version),
      ...(options.packages?.[version] ?? {}),
    };
    for (const d of options.documents.filter((doc) => doc.version === version)) {
      entries[`package/example/${d.file}`] = d.body;
    }
    entriesByVersion[version] = entries;
    packages[version] = tgz(entries);
    write(join(documentsRoot, CORPUS, version, "package.tgz"), packages[version]);
  }
  for (const d of options.documents) {
    write(
      join(documentsRoot, CORPUS, d.version, "package", "example", d.file),
      Buffer.from(d.body),
    );
  }
  const existing = options.existing ?? [];
  for (const [i, body] of existing.entries()) {
    write(join(documentsRoot, "scratch", `doc-${String(i)}.json`), Buffer.from(body));
  }
  const declaration = parseDeclaration(
    JSON.stringify({
      schemaVersion: 1,
      comparedFloor: 1,
      corpora: [
        ...(existing.length === 0
          ? []
          : [
              {
                id: "scratch",
                title: "scratch",
                version: "0",
                licence: "Apache-2.0",
                origin: "https://example.org/",
                authored: "third-party",
                acquisition: { kind: "files", baseUrl: "https://example.org/" },
                licenceText: "licences/x.txt",
                notice: "licences/x-NOTICE.txt",
              },
            ]),
        {
          id: CORPUS,
          title: "synthetic US Core package",
          version: versions.join(" and "),
          licence: "CC0-1.0",
          origin: "https://example.org/",
          authored: "third-party",
          acquisition: {
            kind: "packages",
            format: "tgz",
            packages: Object.fromEntries(
              versions.map((v) => [
                v,
                {
                  url: `https://example.org/${v}`,
                  bytes: req(packages[v]).length,
                  sha256: sha256(req(packages[v])),
                },
              ]),
            ),
          },
          licenceText: "licences/x.txt",
          notice: "licences/x-NOTICE.txt",
        },
      ],
      documents: [
        ...existing.map((body, i) => ({
          id: `scratch/doc-${String(i)}.json`,
          corpus: "scratch",
          path: `doc-${String(i)}.json`,
          bytes: Buffer.byteLength(body),
          sha256: sha256(Buffer.from(body)),
        })),
        ...options.documents.map((d) => ({
          id: `${CORPUS}/${d.version}/${d.file}`,
          corpus: CORPUS,
          version: d.version,
          licence: "CC0-1.0",
          path: `${d.version}/package/example/${d.file}`,
          bytes: Buffer.byteLength(d.body),
          sha256: sha256(Buffer.from(d.body)),
        })),
      ],
    }),
  );
  const jar = join(documentsRoot, "validator_cli.jar");
  writeFileSync(jar, "PK-not-really-a-jar");
  return {
    declaration,
    documentsRoot,
    packages,
    profileText: (version, id) =>
      req(req(entriesByVersion[version])[`package/StructureDefinition-${id}.json`]),
    jar,
    identity: oracleIdentity(jar),
    terminology: resolveTerminologyInputs(TERMINOLOGY_INPUTS),
  };
}

function write(file: string, bytes: Buffer): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, bytes);
}

function req<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("expected a value");
  return value;
}

/**
 * An oracle that answers every staged file with the issues `issuesFor` names for it, or with no
 * outcome at all where it returns `null`, recording each argv it was invoked with. Staged names are
 * read back from the argv, so attribution works exactly as it does for the CLI.
 */
export function recordingOracle(
  issuesFor: (stagedName: string) => readonly unknown[] | null = () => [],
) {
  const calls: string[][] = [];
  let last: string[] = [];
  return {
    calls,
    exec: (_file: string, args: readonly string[]) => {
      calls.push([...args]);
      last = args.filter((a) => a.endsWith(".json") && !a.endsWith("outcome.json"));
      return 0;
    },
    read: (): string =>
      JSON.stringify({
        resourceType: "Bundle",
        entry: last.flatMap((file) => {
          const name = file.slice(file.lastIndexOf("/") + 1);
          const issues = issuesFor(name);
          if (issues === null) return [];
          return [
            {
              resource: {
                resourceType: "OperationOutcome",
                id: name.replace(/\.json$/, ""),
                issue: issues,
              },
            },
          ];
        }),
      }),
  };
}
