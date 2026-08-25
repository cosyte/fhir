/**
 * The differential corpus declaration: what is compared, where it comes from, and the digest that
 * says the bytes are the ones the declaration was written against.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THE DOCUMENTS ARE NOT IN THIS REPOSITORY
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * The third-party documents are **declared here and fetched at run time**, never committed. Two
 * reasons, and the second is the one that cannot be undone:
 *
 *   1. This repository's PHI scanner sweeps what git carries, repo-wide, and gives anything outside
 *      `test/__fixtures__/` the source pass. Real FHIR examples spell `family`, `given`, `birthDate`
 *      and `line`, so committing them would force a token-level allow-list entry per name and date
 *      in someone else's corpus. An allow-list is a declaration about **self-authored synthetic
 *      fixtures**; making it swallow third-party document content would weaken a live safety control
 *      permanently. The layout changed instead.
 *   2. Content committed into git history is not undone by a revert.
 *
 * So `corpus/documents/` is git-ignored, `scripts/corpus-fetch.mjs` materialises it, and every
 * document is digest-checked before it is compared.
 *
 * This module holds no `dist/` import on purpose: it is exercised by `test/differential-corpus.test.ts`
 * with no build, no JVM and no network.
 *
 * @packageDocumentation
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The repository root, from this file's own location. */
export const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** The committed declaration. */
export const DECLARATION_PATH = join(REPO_ROOT, "corpus", "corpus.json");

/** Where `scripts/corpus-fetch.mjs` puts the documents it retrieves (git-ignored). */
export const DOCUMENTS_ROOT = join(REPO_ROOT, "corpus", "documents");

/** Where the per-corpus licence texts and attribution notices live. */
export const LICENCES_ROOT = join(REPO_ROOT, "corpus");

/**
 * Anything wrong with the declaration, or with the bytes it declares. Every one of these is a
 * REFUSAL: the harness fails rather than comparing a corpus it cannot vouch for.
 */
export class CorpusError extends Error {
  constructor(message) {
    super(message);
    this.name = "CorpusError";
  }
}

/** SHA-256 of a buffer, lower-case hex. The one digest this corpus speaks. */
export function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const HEX64_RE = /^[0-9a-f]{64}$/;
const ACQUISITION_KINDS = new Set(["in-tree", "files", "archive"]);

function requireString(value, what) {
  if (typeof value !== "string" || value.length === 0) {
    throw new CorpusError(`${what} must be a non-empty string`);
  }
  return value;
}

/**
 * A document path is relative, and it may not climb. A declaration is a committed file, so this is
 * not an untrusted-input boundary; it is a guard against a typo silently reading `../../src`.
 */
function requireSafeRelativePath(value, what) {
  const path = requireString(value, what);
  if (isAbsolute(path) || path.split("/").includes("..") || path.includes("\\")) {
    throw new CorpusError(`${what} must be a relative path that does not climb: ${path}`);
  }
  return path;
}

function validateCorpus(entry, index) {
  const at = `corpora[${String(index)}]`;
  if (entry === null || typeof entry !== "object") throw new CorpusError(`${at} must be an object`);
  const id = requireString(entry.id, `${at}.id`);
  if (!ID_RE.test(id)) throw new CorpusError(`${at}.id is not a corpus id: ${id}`);
  requireString(entry.title, `${at}.title`);
  // The three provenance facts a consumer is owed for every document.
  requireString(entry.version, `${at}.version`);
  requireString(entry.licence, `${at}.licence`);
  requireString(entry.origin, `${at}.origin`);
  if (entry.authored !== "self" && entry.authored !== "third-party") {
    throw new CorpusError(`${at}.authored must be "self" or "third-party"`);
  }
  const acquisition = entry.acquisition;
  if (acquisition === null || typeof acquisition !== "object") {
    throw new CorpusError(`${at}.acquisition must be an object`);
  }
  if (!ACQUISITION_KINDS.has(acquisition.kind)) {
    throw new CorpusError(`${at}.acquisition.kind must be one of ${[...ACQUISITION_KINDS].join(", ")}`);
  }
  if (acquisition.kind === "in-tree") requireSafeRelativePath(acquisition.root, `${at}.acquisition.root`);
  if (acquisition.kind === "files") requireString(acquisition.baseUrl, `${at}.acquisition.baseUrl`);
  if (acquisition.kind === "archive") {
    requireString(acquisition.url, `${at}.acquisition.url`);
    if (acquisition.format !== "zip") throw new CorpusError(`${at}.acquisition.format must be "zip"`);
    if (!HEX64_RE.test(String(acquisition.sha256))) {
      throw new CorpusError(`${at}.acquisition.sha256 must be a sha-256 hex digest`);
    }
  }
  // Third-party content is only ever obtained through this repository if its licence text and the
  // attribution it requires travel with the declaration that names it.
  if (entry.authored === "third-party") {
    requireSafeRelativePath(entry.licenceText, `${at}.licenceText`);
    requireSafeRelativePath(entry.notice, `${at}.notice`);
  }
  return entry;
}

function validateDocument(entry, index, corpusIds) {
  const at = `documents[${String(index)}]`;
  if (entry === null || typeof entry !== "object") throw new CorpusError(`${at} must be an object`);
  requireString(entry.id, `${at}.id`);
  const corpus = requireString(entry.corpus, `${at}.corpus`);
  if (!corpusIds.has(corpus)) throw new CorpusError(`${at}.corpus names no declared corpus: ${corpus}`);
  requireSafeRelativePath(entry.path, `${at}.path`);
  if (!Number.isInteger(entry.bytes) || entry.bytes <= 0) {
    throw new CorpusError(`${at}.bytes must be a positive integer`);
  }
  if (!HEX64_RE.test(String(entry.sha256))) {
    throw new CorpusError(`${at}.sha256 must be a sha-256 hex digest`);
  }
  if (entry.exclude !== undefined) {
    // An exclusion without a reason is the shape this whole mechanism exists to forbid.
    const reason = requireString(entry.exclude, `${at}.exclude`);
    if (reason.length < 40) {
      throw new CorpusError(`${at}.exclude must record WHY, not a label: ${reason}`);
    }
  }
  return entry;
}

/**
 * Parse and structurally validate a declaration. Every failure is a {@link CorpusError}: a
 * declaration that cannot be read is a corpus that cannot be vouched for, and the harness refuses
 * rather than comparing a subset of it.
 */
export function parseDeclaration(text, where = "the corpus declaration") {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new CorpusError(`${where} is not readable JSON: ${String(err)}`);
  }
  if (raw === null || typeof raw !== "object") throw new CorpusError(`${where} must be an object`);
  if (raw.schemaVersion !== 1) {
    throw new CorpusError(`${where}: unsupported schemaVersion ${String(raw.schemaVersion)}`);
  }
  if (!Number.isInteger(raw.comparedFloor) || raw.comparedFloor < 1) {
    throw new CorpusError(`${where}.comparedFloor must be a positive integer`);
  }
  if (!Array.isArray(raw.corpora) || raw.corpora.length === 0) {
    throw new CorpusError(`${where}.corpora must be a non-empty array`);
  }
  if (!Array.isArray(raw.documents) || raw.documents.length === 0) {
    throw new CorpusError(`${where}.documents must be a non-empty array`);
  }
  const corpusIds = new Set();
  for (const [index, entry] of raw.corpora.entries()) {
    validateCorpus(entry, index);
    if (corpusIds.has(entry.id)) throw new CorpusError(`${where}: duplicate corpus id ${entry.id}`);
    corpusIds.add(entry.id);
  }
  const documentIds = new Set();
  for (const [index, entry] of raw.documents.entries()) {
    validateDocument(entry, index, corpusIds);
    if (documentIds.has(entry.id)) {
      throw new CorpusError(`${where}: duplicate document id ${entry.id}`);
    }
    documentIds.add(entry.id);
  }
  return raw;
}

/** Read and validate the committed declaration (or another one, for tests). */
export function loadDeclaration(file = DECLARATION_PATH) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (err) {
    throw new CorpusError(`the corpus declaration at ${file} could not be read: ${String(err)}`);
  }
  return parseDeclaration(text, file);
}

/** The corpus record a document names. Throws rather than returning undefined. */
export function corpusOf(declaration, document) {
  const corpus = declaration.corpora.find((c) => c.id === document.corpus);
  if (corpus === undefined) {
    throw new CorpusError(`${document.id} names no declared corpus: ${document.corpus}`);
  }
  return corpus;
}

/** Every declared document, excluded ones included. */
export function declaredDocuments(declaration) {
  return declaration.documents;
}

/** The documents that are actually compared. */
export function includedDocuments(declaration) {
  return declaration.documents.filter((d) => d.exclude === undefined);
}

/**
 * The documents deliberately held out of the comparison, each with the reason recorded for it. They
 * never count toward the compared count; {@link module:scripts/differential/compare} prints them.
 */
export function exclusions(declaration) {
  return declaration.documents
    .filter((d) => d.exclude !== undefined)
    .map((d) => ({ id: d.id, corpus: d.corpus, path: d.path, reason: d.exclude }));
}

/**
 * Where a declared document's bytes are expected on disk. An `in-tree` corpus lives in the
 * checkout; everything else lives under the git-ignored documents root that
 * `scripts/corpus-fetch.mjs` writes.
 */
export function documentLocation(declaration, document, options = {}) {
  const corpus = corpusOf(declaration, document);
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const documentsRoot = options.documentsRoot ?? join(repoRoot, "corpus", "documents");
  if (corpus.acquisition.kind === "in-tree") {
    return resolve(repoRoot, corpus.acquisition.root, document.path);
  }
  return resolve(documentsRoot, corpus.id, document.path);
}

/**
 * Read one declared document and verify it against the declaration. Missing, unreadable, the wrong
 * length or the wrong digest are all the same answer: refuse. Continuing without it is the shape
 * that lets a corpus shrink in silence.
 */
export function readDeclaredDocument(declaration, document, options = {}) {
  const file = documentLocation(declaration, document, options);
  let buf;
  try {
    buf = readFileSync(file);
  } catch (err) {
    throw new CorpusError(
      `${document.id}: declared by the corpus but not readable at ${file} (${String(err)}). ` +
        `Run \`pnpm corpus:fetch\` to materialise the corpus.`,
    );
  }
  if (buf.length !== document.bytes) {
    throw new CorpusError(
      `${document.id}: declared ${String(document.bytes)} bytes, found ${String(buf.length)} at ${file}.`,
    );
  }
  const digest = sha256(buf);
  if (digest !== document.sha256) {
    throw new CorpusError(
      `${document.id}: digest mismatch at ${file}. Declared ${document.sha256}, found ${digest}. ` +
        `The corpus is not the corpus this declaration was written against.`,
    );
  }
  return { document, file, text: buf.toString("utf8"), bytes: buf };
}

/**
 * Verify every declared document, then hand back the included ones in declaration order. An
 * excluded document is still verified: the declaration declares it, so its absence is still a
 * corpus that is not what it says it is.
 */
export function resolveCorpus(declaration, options = {}) {
  for (const document of declaredDocuments(declaration)) {
    if (document.exclude !== undefined) readDeclaredDocument(declaration, document, options);
  }
  return includedDocuments(declaration).map((document) =>
    readDeclaredDocument(declaration, document, options),
  );
}

/** A one-line provenance record for a document: corpus, pinned version, licence. */
export function provenanceLine(declaration, document) {
  const corpus = corpusOf(declaration, document);
  return `${document.path} <- ${corpus.title} @ ${corpus.version} (${corpus.licence})`;
}

/**
 * The shortfall message, or `null` when the floor is met. Named separately so the floor is one
 * decision in one place and the test can grade it without a corpus on disk.
 */
export function shortfall(compared, floor) {
  if (compared >= floor) return null;
  return (
    `differential: compared ${String(compared)} document(s), and the declared floor is ${String(floor)}. ` +
    `Short by ${String(floor - compared)}. Reporting success over a smaller corpus would make the ` +
    `count meaningless, so this run fails.`
  );
}
