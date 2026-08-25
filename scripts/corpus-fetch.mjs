#!/usr/bin/env node
/**
 * Materialise the differential corpus: `pnpm corpus:fetch`.
 *
 * Reads `corpus/corpus.json`, retrieves every declared third-party document from the pinned source
 * the declaration names, verifies it against the declared SHA-256, and writes it under
 * `corpus/documents/`, which is git-ignored.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * WHY FETCH RATHER THAN VENDOR
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * See the banner in `scripts/differential/corpus.mjs`. The short version: committing someone else's
 * clinical examples would put real-looking names, dates of birth and street addresses into this
 * repository's history, where a revert does not reach them, and it would force the PHI scanner's
 * allow-lists (which are declarations about SELF-AUTHORED synthetic fixtures) to swallow third-party
 * document content. The layout changed instead of the safety control.
 *
 * IDEMPOTENT. A document already on disk with the declared digest is not fetched again, so a CI
 * cache over `corpus/documents/` turns the whole step into digest checks.
 *
 * FAIL-CLOSED. A download that fails, a digest that does not match, or an archive that does not
 * carry a declared entry all exit non-zero. There is no partial success: a corpus that is missing
 * documents is a corpus whose compared count would be a smaller number wearing the same name.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  corpusOf,
  CorpusError,
  declaredDocuments,
  DOCUMENTS_ROOT,
  loadDeclaration,
  sha256,
} from "./differential/corpus.mjs";
import { extractNamed } from "./differential/zip.mjs";

const RETRIES = 3;
const CONCURRENCY = 8;

/**
 * The only hosts this script will talk to, and the only scheme.
 *
 * The URL a request is built from comes out of `corpus/corpus.json`, which is a committed file
 * rather than user input, so this is not a trust boundary in the usual sense. It is a REACH bound:
 * a typo, a bad merge or a mis-edited declaration should fail loudly instead of pointing this
 * script's credentials-free-but-real network access at an arbitrary host. Adding a corpus means
 * adding its host here, in review, on purpose.
 */
const ALLOWED_HOSTS = new Set(["raw.githubusercontent.com", "hl7.org"]);

/** The URL, parsed and bounded, or a refusal. Never returns something unchecked. */
function allowedUrl(candidate) {
  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new CorpusError(`the corpus declares an unreadable URL: ${String(candidate)}`);
  }
  if (url.protocol !== "https:") {
    throw new CorpusError(`refusing ${url.href}: the corpus is fetched over https only.`);
  }
  if (!ALLOWED_HOSTS.has(url.hostname)) {
    throw new CorpusError(
      `refusing ${url.href}: ${url.hostname} is not one of this corpus's declared hosts ` +
        `(${[...ALLOWED_HOSTS].join(", ")}). Add it here, in review, or fix the declaration.`,
    );
  }
  return url;
}

async function getBytes(candidate) {
  const url = allowedUrl(candidate);
  let lastError;
  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "user-agent": "cosyte-fhir-differential-corpus/1.0" },
      });
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
      // A redirect is followed, and then the host it landed on is bounded too. Neither of these
      // corpora redirects today (measured), so this is a guard rather than a code path.
      if (response.url !== "" && response.url !== undefined) allowedUrl(response.url);
      return Buffer.from(await response.arrayBuffer());
    } catch (err) {
      lastError = err;
      if (attempt < RETRIES) {
        await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    }
  }
  throw new CorpusError(`could not retrieve ${url.href}: ${String(lastError)}`);
}

function onDiskWithDeclaredDigest(file, document) {
  try {
    const buf = readFileSync(file);
    return buf.length === document.bytes && sha256(buf) === document.sha256;
  } catch {
    return false;
  }
}

function place(file, buf, document) {
  const digest = sha256(buf);
  if (buf.length !== document.bytes || digest !== document.sha256) {
    throw new CorpusError(
      `${document.id}: retrieved ${String(buf.length)} bytes with digest ${digest}, the declaration ` +
        `says ${String(document.bytes)} bytes with digest ${document.sha256}. NOT written.`,
    );
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, buf);
}

async function fetchFilesCorpus(corpus, documents, root) {
  const pending = documents.filter((d) => !onDiskWithDeclaredDigest(join(root, corpus.id, d.path), d));
  let index = 0;
  let fetched = 0;
  async function worker() {
    for (;;) {
      const next = index;
      index += 1;
      if (next >= pending.length) return;
      const document = pending[next];
      const buf = await getBytes(`${corpus.acquisition.baseUrl}${document.path}`);
      place(join(root, corpus.id, document.path), buf, document);
      fetched += 1;
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker));
  return { fetched, cached: documents.length - pending.length };
}

async function fetchArchiveCorpus(corpus, documents, root) {
  const pending = documents.filter((d) => !onDiskWithDeclaredDigest(join(root, corpus.id, d.path), d));
  if (pending.length === 0) return { fetched: 0, cached: documents.length };
  const archive = await getBytes(corpus.acquisition.url);
  const digest = sha256(archive);
  if (digest !== corpus.acquisition.sha256) {
    throw new CorpusError(
      `${corpus.id}: the archive at ${corpus.acquisition.url} has digest ${digest}, the declaration ` +
        `says ${corpus.acquisition.sha256}. It is not the archive this corpus was declared against.`,
    );
  }
  const extracted = extractNamed(
    archive,
    pending.map((d) => d.path),
  );
  for (const document of pending) {
    place(join(root, corpus.id, document.path), extracted.get(document.path), document);
  }
  return { fetched: pending.length, cached: documents.length - pending.length };
}

async function main() {
  const declaration = loadDeclaration();
  const root = DOCUMENTS_ROOT;
  const byCorpus = new Map();
  for (const document of declaredDocuments(declaration)) {
    const corpus = corpusOf(declaration, document);
    if (corpus.acquisition.kind === "in-tree") continue;
    if (!byCorpus.has(corpus.id)) byCorpus.set(corpus.id, { corpus, documents: [] });
    byCorpus.get(corpus.id).documents.push(document);
  }

  for (const { corpus, documents } of byCorpus.values()) {
    const result =
      corpus.acquisition.kind === "archive"
        ? await fetchArchiveCorpus(corpus, documents, root)
        : await fetchFilesCorpus(corpus, documents, root);
    console.log(
      `corpus:fetch ${corpus.id} @ ${corpus.version} (${corpus.licence}): ` +
        `${String(result.fetched)} retrieved, ${String(result.cached)} already present, ` +
        `${String(documents.length)} declared.`,
    );
  }
  console.log(`corpus:fetch: documents are under ${root} (git-ignored, never committed).`);
}

main().catch((err) => {
  console.error(`corpus:fetch: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
