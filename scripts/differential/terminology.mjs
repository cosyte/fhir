/**
 * The terminology inputs a differential run declares, and the refusals that keep them exact.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THIS MODULE EXISTS: A VERDICT WAS A FUNCTION OF THE WEATHER
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * The reference validator resolves `Coding.display`, code membership and code-system identity
 * against a TERMINOLOGY SERVER, and the release this harness pins defaults that server to a public
 * network service. A differential verdict is supposed to be a property of the document bytes, the
 * oracle artifact and nothing else; with a remote service in the loop it was also a property of what
 * that service happened to answer, and of whether it answered at all. The same commit over the same
 * corpus produced three `FALSE VALID` verdicts on one day and none on another, with no document, no
 * library change and no pinned artifact having moved.
 *
 * So the run DECLARES its terminology inputs, and this module is the only place that says what they
 * are, turns them into the oracle's argv, and refuses when they cannot be honoured exactly.
 *
 * THE INPUTS THIS REPOSITORY DECLARES: NONE
 * -----------------------------------------
 * {@link TERMINOLOGY_INPUTS} declares `source: "none"`. Both terminology levers the pinned release
 * documents are set to the sentinel that release defines for "run without terminology":
 *
 *   - `-tx n/a` so no terminology SERVER is contacted. Omitting it is not neutral: the release's
 *     documented default is `https://tx.fhir.org`, so an absent flag IS the network.
 *   - `-txCache n/a` so no terminology CACHE DIRECTORY answers either. A cache is not a pinned input
 *     of this repository; it holds whatever some earlier run got back from a network on a date
 *     nobody recorded, which is the same non-determinism one indirection further away.
 *
 * That reading is chosen over pinning terminology content into this repository. This library
 * declaredly vendors no terminology content, the corpus documents are deliberately fetched rather
 * than committed because content in git history is not undone by a revert, and a pinned terminology
 * cache would put a third party's code-system content into that same history to answer questions
 * this library does not answer either. `source: "pinned"` is implemented and graded because the
 * refusal it carries is part of the contract, and because a later change may want it; nothing in
 * this repository declares it today.
 *
 * WHAT IS NOT BOUGHT HERE
 * -----------------------
 * "No terminology source" does not mean the oracle stops reporting terminology findings. It means it
 * resolves them from nothing, and reports so, DETERMINISTICALLY. Those findings are classified out
 * of both differential invariants by `compare.mjs`; this module only guarantees they are a function
 * of the declared inputs. The two halves are separate on purpose: this one alone would still fail
 * the same documents on every run.
 *
 * This module reads files only through an injectable `read`, spawns nothing and holds no `dist/`
 * import, so `test/differential-determinism.test.ts` grades every branch with no JVM, no network and
 * no build.
 *
 * @packageDocumentation
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import { REPO_ROOT } from "./corpus.mjs";

/**
 * The terminology inputs a run declared could not be honoured, or the effective configuration would
 * leave a terminology question answerable over a network. Every one of these is a REFUSAL: the
 * harness compares nothing rather than compare against answers it cannot reproduce.
 */
export class TerminologyError extends Error {
  constructor(message) {
    super(message);
    this.name = "TerminologyError";
  }
}

/**
 * The sentinel the pinned oracle release documents for both terminology options. Its `-tx`
 * description reads "To run without terminology, specify 'n/a' as the URL"; its `-txCache`
 * description reads "To run without a terminology case, specify 'n/a' as the value".
 */
export const NO_TERMINOLOGY = "n/a";

/** The option that names the terminology server. */
export const TX_SERVER_OPTION = "-tx";

/** The option that names the directory terminology responses are cached in. */
export const TX_CACHE_OPTION = "-txCache";

/**
 * What the pinned release uses when `-tx` is absent. Recorded so the refusal can NAME the condition
 * rather than say "a flag is missing": an absent flag is a public network service, not a no-op.
 */
export const DEFAULT_TX_SERVER = "https://tx.fhir.org";

/** The two terminology sources a run may declare. */
export const TERMINOLOGY_SOURCES = Object.freeze(["none", "pinned"]);

/**
 * The terminology inputs THIS repository declares for every differential run. Read the module
 * docblock for why the answer is "none" and not a pinned terminology cache.
 */
export const TERMINOLOGY_INPUTS = Object.freeze({
  source: "none",
  server: NO_TERMINOLOGY,
  cache: NO_TERMINOLOGY,
  pinned: Object.freeze([]),
});

const HEX64_RE = /^[0-9a-f]{64}$/;

/** SHA-256 of a buffer or string, lower-case hex. */
function digestOf(value) {
  return createHash("sha256").update(value).digest("hex");
}

/** Keys sorted at every depth, so a digest over the record is a function of the record's content. */
function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value === null || typeof value !== "object") return value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = sortDeep(value[key]);
  return out;
}

/**
 * Structural validation of a declared terminology-inputs record. Shape only: whether the pinned
 * content is actually there and actually matches is {@link resolveTerminologyInputs}.
 */
export function parseTerminologyInputs(value, where = "the declared terminology inputs") {
  if (typeof value === "string") {
    let raw;
    try {
      raw = JSON.parse(value);
    } catch (err) {
      throw new TerminologyError(`${where} are not readable JSON: ${String(err)}`);
    }
    return parseTerminologyInputs(raw, where);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TerminologyError(`${where} must be an object`);
  }
  const source = value.source;
  if (!TERMINOLOGY_SOURCES.includes(source)) {
    throw new TerminologyError(
      `${where}.source must be one of ${TERMINOLOGY_SOURCES.join(", ")}, not ${String(source)}`,
    );
  }
  if (typeof value.server !== "string" || value.server.length === 0) {
    throw new TerminologyError(`${where}.server must be a non-empty string`);
  }
  if (typeof value.cache !== "string" || value.cache.length === 0) {
    throw new TerminologyError(`${where}.cache must be a non-empty string`);
  }
  const pinned = value.pinned ?? [];
  if (!Array.isArray(pinned)) throw new TerminologyError(`${where}.pinned must be an array`);
  for (const [index, entry] of pinned.entries()) {
    const at = `${where}.pinned[${String(index)}]`;
    if (entry === null || typeof entry !== "object") {
      throw new TerminologyError(`${at} must be an object`);
    }
    if (typeof entry.path !== "string" || entry.path.length === 0) {
      throw new TerminologyError(`${at}.path must be a non-empty string`);
    }
    if (isAbsolute(entry.path) || entry.path.split("/").includes("..")) {
      throw new TerminologyError(`${at}.path must be a relative path that does not climb`);
    }
    if (!HEX64_RE.test(String(entry.sha256))) {
      throw new TerminologyError(`${at}.sha256 must be a sha-256 hex digest`);
    }
    if (entry.bytes !== undefined && (!Number.isInteger(entry.bytes) || entry.bytes <= 0)) {
      throw new TerminologyError(`${at}.bytes must be a positive integer when it is recorded`);
    }
  }
  if (source === "none") {
    if (value.server !== NO_TERMINOLOGY) {
      throw new TerminologyError(
        `${where} declare source "none" but name a terminology server (${value.server}). ` +
          `Under "none" the server must be the sentinel ${NO_TERMINOLOGY}.`,
      );
    }
    if (value.cache !== NO_TERMINOLOGY) {
      throw new TerminologyError(
        `${where} declare source "none" but name a terminology cache (${value.cache}). ` +
          `Under "none" the cache must be the sentinel ${NO_TERMINOLOGY}.`,
      );
    }
    if (pinned.length > 0) {
      throw new TerminologyError(
        `${where} declare source "none" but also pin ${String(pinned.length)} input(s). ` +
          `Declare source "pinned" or pin nothing; a run may not have it both ways.`,
      );
    }
  }
  if (source === "pinned") {
    if (value.server !== NO_TERMINOLOGY) {
      throw new TerminologyError(
        `${where} declare source "pinned" but name a terminology server (${value.server}). ` +
          `Pinned content is answered from this repository; the server stays ${NO_TERMINOLOGY}.`,
      );
    }
    if (pinned.length === 0) {
      throw new TerminologyError(
        `${where} declare source "pinned" but pin nothing, so no terminology question has an answer ` +
          `that is a function of this repository.`,
      );
    }
    if (value.cache === NO_TERMINOLOGY) {
      throw new TerminologyError(
        `${where} declare source "pinned" but no cache directory for the oracle to read it from.`,
      );
    }
    if (isAbsolute(value.cache) || value.cache.split("/").includes("..")) {
      throw new TerminologyError(
        `${where}.cache must be a relative path inside this repository that does not climb`,
      );
    }
  }
  return {
    source,
    server: value.server,
    cache: value.cache,
    pinned: pinned.map((entry) => ({
      path: entry.path,
      sha256: entry.sha256,
      ...(entry.bytes === undefined ? {} : { bytes: entry.bytes }),
    })),
  };
}

/**
 * Honour the declared inputs EXACTLY, or refuse.
 *
 * Absent, unreadable, the wrong length or the wrong digest are one answer: {@link TerminologyError},
 * naming what could not be honoured. There is deliberately no branch that falls back to another
 * terminology source, and none that carries on without one: substituting a source silently is how a
 * run comes to be reproducible against something nobody declared.
 */
export function resolveTerminologyInputs(inputs = TERMINOLOGY_INPUTS, options = {}) {
  const declared = parseTerminologyInputs(inputs, options.where ?? "the declared terminology inputs");
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const read = options.read ?? readFileSync;
  const pinned = declared.pinned.map((entry) => {
    const file = resolve(repoRoot, entry.path);
    let buf;
    try {
      buf = read(file);
    } catch (err) {
      throw new TerminologyError(
        `the declared terminology input ${entry.path} could not be honoured: it is not readable at ` +
          `${file} (${String(err)}). No other terminology source is substituted for it.`,
      );
    }
    if (entry.bytes !== undefined && buf.length !== entry.bytes) {
      throw new TerminologyError(
        `the declared terminology input ${entry.path} could not be honoured: declared ` +
          `${String(entry.bytes)} bytes, found ${String(buf.length)}.`,
      );
    }
    const sha256 = digestOf(buf);
    if (sha256 !== entry.sha256) {
      throw new TerminologyError(
        `the declared terminology input ${entry.path} could not be honoured: declared digest ` +
          `${entry.sha256}, found ${sha256}. The content is not the content this run declared.`,
      );
    }
    return { path: entry.path, bytes: buf.length, sha256 };
  });
  const record = {
    source: declared.source,
    server: declared.server,
    cache: declared.cache,
    pinned,
  };
  return { ...record, digest: digestOf(JSON.stringify(sortDeep(record))) };
}

/**
 * The terminology half of the oracle's argv, derived from the RESOLVED inputs.
 *
 * Both options are always spelled. Neither is ever omitted: an absent `-tx` is
 * {@link DEFAULT_TX_SERVER} and an absent `-txCache` is whatever cache directory the validator
 * decides to create, and a run whose terminology answers come from an undeclared directory is not
 * reproducible from this repository.
 */
export function terminologyArgs(resolved, options = {}) {
  const cache =
    resolved.source === "pinned"
      ? resolve(options.repoRoot ?? REPO_ROOT, resolved.cache)
      : resolved.cache;
  return [TX_SERVER_OPTION, resolved.server, TX_CACHE_OPTION, cache];
}

/** Whether a `-tx`/`-txCache` value would let the oracle reach a network for an answer. */
function networkAnswerable(value) {
  if (typeof value !== "string" || value.length === 0) return true;
  if (value === NO_TERMINOLOGY) return false;
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) || value.startsWith("//");
}

/**
 * Audit the argv the oracle is ABOUT to be invoked with, not the configuration it was built from.
 *
 * This is the check that makes criterion "no terminology question is answerable over a network" a
 * property of the run rather than of a constant somebody hopes is used. It refuses when `-tx` is
 * absent (the release default is a public service), when either terminology value names a network
 * location, when a terminology option is spelled twice with different values, and when a cache
 * directory is used that the resolved inputs did not declare.
 *
 * @throws {TerminologyError} naming the condition refused on.
 */
export function auditTerminologyArgv(argv, resolved = TERMINOLOGY_INPUTS, options = {}) {
  const values = (option) => {
    const found = [];
    for (let i = 0; i < argv.length - 1; i += 1) if (argv[i] === option) found.push(String(argv[i + 1]));
    return found;
  };
  const servers = values(TX_SERVER_OPTION);
  const caches = values(TX_CACHE_OPTION);
  if (servers.length === 0) {
    throw new TerminologyError(
      `the oracle would be invoked without ${TX_SERVER_OPTION}, and the pinned release's documented ` +
        `default terminology server is ${DEFAULT_TX_SERVER}, so every terminology question would be ` +
        `answerable over a network. Refusing to compare any document.`,
    );
  }
  if (caches.length === 0) {
    throw new TerminologyError(
      `the oracle would be invoked without ${TX_CACHE_OPTION}, so it would answer terminology ` +
        `questions from a cache directory this run did not declare. Refusing to compare any document.`,
    );
  }
  if (new Set(servers).size > 1 || new Set(caches).size > 1) {
    throw new TerminologyError(
      `the oracle would be invoked with conflicting terminology options, so which answers it was ` +
        `capable of cannot be stated. Refusing to compare any document.`,
    );
  }
  const [server] = servers;
  const [cache] = caches;
  if (networkAnswerable(server)) {
    throw new TerminologyError(
      `the oracle would be invoked with ${TX_SERVER_OPTION} ${server}, which leaves terminology ` +
        `questions answerable over a network. Refusing to compare any document.`,
    );
  }
  if (networkAnswerable(cache)) {
    throw new TerminologyError(
      `the oracle would be invoked with ${TX_CACHE_OPTION} ${cache}, which leaves terminology ` +
        `questions answerable over a network. Refusing to compare any document.`,
    );
  }
  if (server !== resolved.server) {
    throw new TerminologyError(
      `the oracle would be invoked with ${TX_SERVER_OPTION} ${server}, which is not the terminology ` +
        `server this run declared (${String(resolved.server)}). Refusing to compare any document.`,
    );
  }
  if (resolved.source === "none" && cache !== NO_TERMINOLOGY) {
    throw new TerminologyError(
      `the oracle would be invoked with ${TX_CACHE_OPTION} ${cache}, but this run declared no ` +
        `terminology source, so no cache directory is a declared input. Refusing to compare any document.`,
    );
  }
  if (resolved.source === "pinned") {
    const repoRoot = options.repoRoot ?? REPO_ROOT;
    const declared = resolve(repoRoot, String(resolved.cache));
    if (resolve(cache) !== declared) {
      throw new TerminologyError(
        `the oracle would be invoked with ${TX_CACHE_OPTION} ${cache}, which is not the pinned ` +
          `terminology cache this run declared (${declared}). Refusing to compare any document.`,
      );
    }
  }
  return { server, cache };
}

/**
 * The terminology line printed beside the oracle identity, on every run.
 *
 * It is derived from the RESOLVED inputs, so it moves when the inputs move: a different sentinel, a
 * different pinned file or a different digest for the same file all change the `digest` it ends
 * with. The capability clause is there so a reader of the log can tell which terminology answers the
 * run was capable of without knowing what `n/a` means to a validator CLI.
 */
export function formatTerminologyInputs(resolved) {
  const capability =
    resolved.source === "none"
      ? "no terminology source: no code system, value set or display is resolved, and no terminology service is reached"
      : `pinned terminology content only: every terminology answer comes from ${String(resolved.pinned.length)} file(s) committed to this repository, and no terminology service is reached`;
  return (
    `terminology: source ${resolved.source} (${capability}), ` +
    `${TX_SERVER_OPTION} ${resolved.server}, ${TX_CACHE_OPTION} ${resolved.cache}, ` +
    `${String(resolved.pinned.length)} pinned input(s), digest sha256 ${resolved.digest}`
  );
}
