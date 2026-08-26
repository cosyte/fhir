/**
 * A minimal ZIP reader, built from Node's own `zlib` and nothing else.
 *
 * WHY THIS EXISTS RATHER THAN A DEPENDENCY. The corpus's second half is the FHIR R4 specification's
 * own published examples, and the only artifact HL7 publishes them in is `examples-json.zip`. The
 * individually published copies at `hl7.org/fhir/R4/<name>.json` are NOT byte-identical to the
 * archive's entries (measured on `patient-example.json`: 3,748 bytes published, 4,270 in the
 * archive), so a per-file fetch cannot be digest-checked against an archive-derived declaration.
 * This repository has zero runtime dependencies and adds no new dev dependency for a corpus chore,
 * so the archive is read here: central directory, `stored` and `deflate`, and nothing more.
 *
 * SCOPE, STATED NARROWLY. This reads the archives this corpus names. It is not a general ZIP
 * implementation: no ZIP64, no encryption, no multi-disk, no data descriptors beyond what the
 * central directory already records. Every one of those is a REFUSAL rather than a silent skip,
 * because an entry this reader cannot account for is a document the corpus would then be missing.
 *
 * @packageDocumentation
 */

import { inflateRawSync } from "node:zlib";

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

/** An archive this reader will not read. Refusing beats returning a short list of entries. */
export class ZipError extends Error {
  constructor(message) {
    super(message);
    this.name = "ZipError";
  }
}

function findEndOfCentralDirectory(buf) {
  // The EOCD is last, after a comment of at most 0xFFFF bytes. Scan backwards over that window.
  const earliest = Math.max(0, buf.length - (22 + 0xffff));
  for (let i = buf.length - 22; i >= earliest; i -= 1) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i;
  }
  throw new ZipError("not a zip archive: no end-of-central-directory record");
}

/**
 * The archive's central directory: one record per entry, name plus where and how it is stored.
 * Directory entries (a trailing `/`) are dropped; they carry no bytes.
 */
export function readCentralDirectory(buf) {
  const eocd = findEndOfCentralDirectory(buf);
  const diskEntries = buf.readUInt16LE(eocd + 8);
  const totalEntries = buf.readUInt16LE(eocd + 10);
  if (diskEntries !== totalEntries) {
    throw new ZipError("multi-disk zip archives are not read here");
  }
  if (totalEntries === 0xffff) {
    throw new ZipError("this archive needs ZIP64, which is not read here");
  }
  let ptr = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let n = 0; n < totalEntries; n += 1) {
    if (ptr + 46 > buf.length || buf.readUInt32LE(ptr) !== SIG_CENTRAL) {
      throw new ZipError(`central directory record ${String(n)} is not where the archive says it is`);
    }
    const flags = buf.readUInt16LE(ptr + 8);
    const method = buf.readUInt16LE(ptr + 10);
    const compressedSize = buf.readUInt32LE(ptr + 20);
    const uncompressedSize = buf.readUInt32LE(ptr + 24);
    const nameLength = buf.readUInt16LE(ptr + 28);
    const extraLength = buf.readUInt16LE(ptr + 30);
    const commentLength = buf.readUInt16LE(ptr + 32);
    const localOffset = buf.readUInt32LE(ptr + 42);
    const name = buf.subarray(ptr + 46, ptr + 46 + nameLength).toString("utf8");
    ptr += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith("/")) continue;
    entries.push({ name, flags, method, compressedSize, uncompressedSize, localOffset });
  }
  return entries;
}

/** The bytes of one central-directory entry. Refuses anything it cannot decode exactly. */
export function readEntry(buf, entry) {
  if ((entry.flags & 0x1) !== 0) throw new ZipError(`${entry.name}: encrypted entries are not read here`);
  if (entry.method !== METHOD_STORED && entry.method !== METHOD_DEFLATE) {
    throw new ZipError(`${entry.name}: compression method ${String(entry.method)} is not read here`);
  }
  const localOffset = entry.localOffset;
  if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== SIG_LOCAL) {
    throw new ZipError(`${entry.name}: no local file header where the central directory points`);
  }
  const nameLength = buf.readUInt16LE(localOffset + 26);
  const extraLength = buf.readUInt16LE(localOffset + 28);
  const start = localOffset + 30 + nameLength + extraLength;
  const raw = buf.subarray(start, start + entry.compressedSize);
  const data = entry.method === METHOD_STORED ? Buffer.from(raw) : inflateRawSync(raw);
  if (data.length !== entry.uncompressedSize) {
    throw new ZipError(
      `${entry.name}: decoded ${String(data.length)} bytes, the archive declares ${String(entry.uncompressedSize)}`,
    );
  }
  return data;
}

/**
 * Extract exactly the named entries. A name the archive does not carry is a REFUSAL: the corpus
 * declares it, so an archive without it is not the archive the declaration was written against.
 */
export function extractNamed(buf, names) {
  const wanted = new Set(names);
  const byName = new Map(readCentralDirectory(buf).map((e) => [e.name, e]));
  const out = new Map();
  for (const name of wanted) {
    const entry = byName.get(name);
    if (entry === undefined) throw new ZipError(`the archive does not carry ${name}`);
    out.set(name, readEntry(buf, entry));
  }
  return out;
}
