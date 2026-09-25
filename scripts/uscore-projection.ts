#!/usr/bin/env tsx
/**
 * Derive the committed projection of the constraints carried by the US Core 6.1.0 and 9.0.0
 * resource profiles, as TEST DATA.
 *
 *     pnpm uscore:projection                                  # fetch both packages, rewrite
 *     pnpm uscore:projection --check                          # fetch, re-derive, compare
 *     pnpm uscore:projection --tarball 6.1.0=<path> --tarball 9.0.0=<path> [--check]
 *
 * Each package is the tarball `packages.fhir.org` serves for that version. Its bytes are checked
 * against the byte count and sha256 recorded below BEFORE anything reads them, so a substituted or
 * truncated artifact is refused rather than projected. The projection is written to
 * `test/__data__/uscore-constraints.json`, which is never shipped (the package's `files` field is
 * `dist` plus three documents) and which no module under `src/` imports.
 *
 * The rule, which the output repeats: one row per `constraint` in the `differential` of every
 * StructureDefinition at the top level of the package (`package/*.json`) with `kind: "resource"`
 * and `derivation: "constraint"`, keyed by (version, profile id, element id, constraint key), with
 * `key`, `severity` and `expression` copied verbatim. Profiles in ascending id order; within one,
 * the differential's element order and each element's constraint order. Nothing is rewritten,
 * corrected or normalised: an expression is projected exactly as the package publishes it.
 *
 * `--check` re-derives and compares with the committed file, exiting non-zero on any difference.
 *
 * @packageDocumentation
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(resolve(HERE, ".."), "test", "__data__", "uscore-constraints.json");

/** One package this projection reads, with the identity its bytes must carry. */
interface PackageSource {
  readonly version: string;
  readonly url: string;
  readonly bytes: number;
  readonly sha256: string;
}

/** The two packages, pinned by byte count and digest. Adding one is a change to this list. */
const PACKAGES: readonly PackageSource[] = [
  {
    version: "6.1.0",
    url: "https://packages.fhir.org/hl7.fhir.us.core/6.1.0",
    bytes: 1606342,
    sha256: "ec096f29bc4ce8f04117dfc4ef82e7289c67a7e2188892e86288c45389d158d9",
  },
  {
    version: "9.0.0",
    url: "https://packages.fhir.org/hl7.fhir.us.core/9.0.0",
    bytes: 2749959,
    sha256: "d7b54d2ec2a48cea94ffea5d939ad67a681f80b94d69594a08cebac36da9e059",
  },
];

/** The only host this script talks to, over https only. */
const ALLOWED_HOST = "packages.fhir.org";

/** One projected row. */
interface ProjectedConstraint {
  readonly version: string;
  readonly profile: string;
  readonly type: string;
  readonly element: string;
  readonly path: string;
  readonly sliceName?: string;
  readonly key: string;
  readonly severity: string;
  readonly expression: string;
}

/** The committed file's shape. */
interface UsCoreProjection {
  readonly note: string;
  readonly rule: string;
  readonly licence: string;
  readonly fhirVersion: string;
  readonly packages: Readonly<Record<string, { url: string; bytes: number; sha256: string }>>;
  readonly constraints: readonly ProjectedConstraint[];
}

class ProjectionError extends Error {}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Refuse bytes whose count or digest differs from the pinned identity. Runs before any read. */
function verified(source: PackageSource, bytes: Uint8Array): Uint8Array {
  const digest = sha256(bytes);
  if (bytes.length !== source.bytes || digest !== source.sha256) {
    throw new ProjectionError(
      `refusing US Core ${source.version}: expected ${String(source.bytes)} bytes with sha256 ` +
        `${source.sha256}, got ${String(bytes.length)} bytes with sha256 ${digest}`,
    );
  }
  return bytes;
}

async function fetchBytes(source: PackageSource): Promise<Uint8Array> {
  const url = new URL(source.url);
  if (url.protocol !== "https:" || url.hostname !== ALLOWED_HOST) {
    throw new ProjectionError(`refusing ${url.href}: only https://${ALLOWED_HOST} is fetched`);
  }
  const response = await fetch(url, { headers: { accept: "application/tar+gzip" } });
  if (!response.ok) {
    throw new ProjectionError(`fetching ${url.href} answered ${String(response.status)}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

/** One regular file read out of a ustar archive. */
interface TarEntry {
  readonly name: string;
  readonly data: Uint8Array;
}

/** Read the regular files of an uncompressed ustar archive. Any other entry kind is skipped. */
function tarEntries(archive: Uint8Array): TarEntry[] {
  const text = (from: number, to: number, at: number): string => {
    const raw = Buffer.from(archive.subarray(at + from, at + to)).toString("latin1");
    const nul = raw.indexOf("\0");
    return nul < 0 ? raw : raw.slice(0, nul);
  };
  const out: TarEntry[] = [];
  let at = 0;
  while (at + 512 <= archive.length) {
    const header = archive.subarray(at, at + 512);
    if (header.every((b) => b === 0)) break;
    if (text(257, 262, at) !== "ustar") throw new ProjectionError("not a ustar archive");
    const size = Number.parseInt(text(124, 136, at).trim() || "0", 8);
    if (!Number.isSafeInteger(size) || size < 0) throw new ProjectionError("unreadable entry size");
    const prefix = text(345, 500, at);
    const name = prefix === "" ? text(0, 100, at) : `${prefix}/${text(0, 100, at)}`;
    const kind = String.fromCharCode(header[156] ?? 0);
    if (kind === "0" || kind === "\0") {
      out.push({ name, data: archive.subarray(at + 512, at + 512 + size) });
    }
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, name: string, where: string): string {
  const value = record[name];
  if (typeof value !== "string") throw new ProjectionError(`${where}: no string '${name}'`);
  return value;
}

/** Project one verified package. */
function project(source: PackageSource, tarball: Uint8Array): ProjectedConstraint[] {
  const entries = tarEntries(new Uint8Array(gunzipSync(verified(source, tarball))));
  const manifest = entries.find((e) => e.name === "package/package.json");
  if (manifest === undefined) throw new ProjectionError(`${source.version}: no package.json`);
  const meta: unknown = JSON.parse(Buffer.from(manifest.data).toString("utf8"));
  if (!isRecord(meta)) throw new ProjectionError(`${source.version}: unreadable package.json`);
  if (meta["version"] !== source.version || meta["license"] !== "CC0-1.0") {
    throw new ProjectionError(`${source.version}: package.json names another version or licence`);
  }
  const fhirVersions = meta["fhirVersions"];
  if (!Array.isArray(fhirVersions) || fhirVersions.join(",") !== "4.0.1") {
    throw new ProjectionError(`${source.version}: package is not for FHIR 4.0.1`);
  }

  const profiles: { id: string; type: string; elements: unknown[] }[] = [];
  for (const entry of entries) {
    if (!/^package\/[^/]+\.json$/.test(entry.name) || entry.name === "package/package.json") {
      continue;
    }
    const resource: unknown = JSON.parse(Buffer.from(entry.data).toString("utf8"));
    if (!isRecord(resource) || resource["resourceType"] !== "StructureDefinition") continue;
    if (resource["kind"] !== "resource" || resource["derivation"] !== "constraint") continue;
    const where = `${source.version} ${entry.name}`;
    const differential = resource["differential"];
    const elements = isRecord(differential) ? differential["element"] : undefined;
    profiles.push({
      id: stringField(resource, "id", where),
      type: stringField(resource, "type", where),
      elements: Array.isArray(elements) ? elements : [],
    });
  }
  profiles.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const rows: ProjectedConstraint[] = [];
  for (const profile of profiles) {
    for (const element of profile.elements) {
      if (!isRecord(element)) continue;
      const constraints = element["constraint"];
      if (!Array.isArray(constraints)) continue;
      const where = `${source.version} ${profile.id}`;
      const id = stringField(element, "id", where);
      const path = stringField(element, "path", where);
      const sliceName = element["sliceName"];
      for (const constraint of constraints) {
        if (!isRecord(constraint))
          throw new ProjectionError(`${where} ${id}: unreadable constraint`);
        rows.push({
          version: source.version,
          profile: profile.id,
          type: profile.type,
          element: id,
          path,
          ...(typeof sliceName === "string" ? { sliceName } : {}),
          key: stringField(constraint, "key", `${where} ${id}`),
          severity: stringField(constraint, "severity", `${where} ${id}`),
          expression: stringField(constraint, "expression", `${where} ${id}`),
        });
      }
    }
  }
  return rows;
}

const NOTE =
  "Committed TEST DATA, never shipped: the FHIRPath constraints carried by the US Core 6.1.0 and 9.0.0 resource profiles, projected from the package tarballs named under packages. Do not hand-edit: re-derive it with scripts/uscore-projection.ts, which refuses bytes whose count or sha256 differs from the value recorded here.";

const RULE =
  "One row per constraint in the differential of every StructureDefinition at the top level of the package (package/*.json) with kind 'resource' and derivation 'constraint', keyed by (version, profile id, element id, key). key, severity and expression are copied verbatim, never rewritten. sliceName is carried when the element is a slice. Packages in the order listed under packages; profiles in ascending id order; within one, the differential's element order and each element's constraint order.";

function render(rows: readonly ProjectedConstraint[]): string {
  const document: UsCoreProjection = {
    note: NOTE,
    rule: RULE,
    licence: "CC0-1.0",
    fhirVersion: "4.0.1",
    packages: Object.fromEntries(
      PACKAGES.map((p) => [p.version, { url: p.url, bytes: p.bytes, sha256: p.sha256 }]),
    ),
    constraints: rows,
  };
  return `${JSON.stringify(document, null, 2)}\n`;
}

function parseArgs(argv: readonly string[]): { check: boolean; tarballs: Map<string, string> } {
  const tarballs = new Map<string, string>();
  let check = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--check") {
      check = true;
    } else if (arg === "--tarball") {
      const spec = argv[i + 1] ?? "";
      const eq = spec.indexOf("=");
      if (eq < 1) throw new ProjectionError("--tarball takes <version>=<path>");
      tarballs.set(spec.slice(0, eq), spec.slice(eq + 1));
      i += 1;
    } else {
      throw new ProjectionError(`unknown argument ${String(arg)}`);
    }
  }
  return { check, tarballs };
}

async function main(): Promise<void> {
  const { check, tarballs } = parseArgs(process.argv.slice(2));
  const rows: ProjectedConstraint[] = [];
  for (const source of PACKAGES) {
    const local = tarballs.get(source.version);
    const bytes = local === undefined ? await fetchBytes(source) : readFileSync(local);
    rows.push(...project(source, bytes));
  }
  const text = render(rows);
  if (check) {
    if (readFileSync(OUT, "utf8") !== text) {
      throw new ProjectionError(`${OUT} differs from the projection re-derived from the packages`);
    }
    process.stdout.write(`uscore-projection: ${String(rows.length)} rows, identical to ${OUT}\n`);
    return;
  }
  writeFileSync(OUT, text);
  process.stdout.write(`uscore-projection: wrote ${String(rows.length)} rows to ${OUT}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `uscore-projection: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
