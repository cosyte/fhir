/**
 * The US Core pass of the differential: which published US Core example documents are compared, the
 * package their profiles are read from, and what the run says about each constraint row this
 * library newly evaluates.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PASS ADDS TO THE THREE CORPORA BEFORE IT
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * The three existing corpora are validated with NO profile supplied, and the oracle runs them with
 * one US Core release loaded so it can resolve US Core extension definitions. Neither side asks a
 * US Core constraint anything there. This pass does: a US Core example document is validated by
 * this library with exactly the US Core profiles its `meta.profile` declares, read from the package
 * of the US Core version it is declared under, and the oracle runs it with that same US Core version
 * loaded. The two differential invariants (never a false valid; no spurious error on clean input)
 * then decide it exactly as they decide every other document.
 *
 * THE PACKAGE IS VERIFIED BEFORE ANYTHING IS COMPARED
 * ---------------------------------------------------
 * The package tarball is fetched by `pnpm corpus:fetch` into the git-ignored documents directory,
 * never committed (it carries the same examples, names and dates of birth included). Its byte count
 * and SHA-256 are recorded in `corpus/corpus.json`, and {@link readVerifiedPackage} refuses bytes
 * that differ BEFORE a profile is read out of them: a profile read from an unverified package is a
 * verdict about a package nobody declared.
 *
 * A DOCUMENT IS NEVER VALIDATED WITH FEWER PROFILES THAN IT DECLARES
 * ------------------------------------------------------------------
 * {@link declaredProfiles} resolves every canonical in `meta.profile` against the verified package.
 * A document that declares none, or declares one the package does not contain, or pins a version the
 * package is not, has NO READABLE OUTCOME: it is neither compared nor reported clean. Validating it
 * with the subset of its profiles that happened to resolve would answer a question the document
 * never asked.
 *
 * THE REACH REPORT: A GREEN RUN OVER CONSTRAINTS NOTHING EXERCISED IS NOT AGREEMENT
 * -------------------------------------------------------------------------------
 * The rows this pass reports on are the rows of `test/__data__/uscore-classification.json` whose
 * `head` is `evaluated` and whose `pin` is not: the constraints the bounded FHIRPath subset newly
 * decides. For each one the run prints how many compared US Core documents REACH it (the document
 * declares a profile carrying the row, and the element the row anchors on is present) or
 * `not reached` with the reason. A row counts as agreement only on a document that reaches it, where
 * this library DECIDED it, and whose document-level comparison is not a violation. An answer that is
 * only `INVARIANT_UNCHECKED` is printed as `unchecked` and never counted as agreement, whatever the
 * oracle answered. A slice-scoped row is printed `not reached (slice-scoped)`, because the profile
 * layer does not evaluate a constraint scoped to a slice, and a row anchored on an element present
 * only as a primitive occurrence is printed `not evaluated (primitive occurrence)` for that document,
 * because the profile layer anchors a nested constraint on complex occurrences only. Both limits are
 * declared, and neither is counted as agreement.
 *
 * This module is pure apart from reading files through an injectable `read`: no process, no network,
 * no `dist/` import, so `test/differential-harness.test.ts` grades every branch with no build, no JVM
 * and no network.
 *
 * @packageDocumentation
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

import { CorpusError, REPO_ROOT, sha256 } from "./corpus.mjs";

/** The acquisition kind of a corpus whose documents are example files inside pinned FHIR packages. */
export const PACKAGES_KIND = "packages";

/** The FHIR package every document of a packages corpus comes out of. */
export const US_CORE_PACKAGE = "hl7.fhir.us.core";

/** The one directory inside a US Core package that holds its published examples. */
export const EXAMPLE_DIRECTORY = "package/example/";

/** The file name the fetched package tarball is written under, beside that version's examples. */
export const PACKAGE_FILE = "package.tgz";

/** The committed projection of the US Core constraint rows. */
export const PROJECTION_PATH = join(REPO_ROOT, "test", "__data__", "uscore-constraints.json");

/** The committed classification of those rows, `head` and `pin`. */
export const CLASSIFICATION_PATH = join(
  REPO_ROOT,
  "test",
  "__data__",
  "uscore-classification.json",
);

/** The US Core version and constraint key whose reach a green run must show on a real document. */
export const UCUM_RULE = Object.freeze({
  version: "9.0.0",
  key: "us-core-3",
  variant: "valueQuantity",
});

/**
 * What one reaching document's own answer for one row was. Printed words, and stable: a caller of
 * the log switches on them.
 */
export const ROW_ANSWER = Object.freeze({
  /** A finding carrying the row's key said the constraint does not hold. */
  VIOLATED: "violated",
  /** The anchor is present as a complex occurrence and no finding carries the key: it holds. */
  SATISFIED: "satisfied",
  /** Every finding carrying the key is `INVARIANT_UNCHECKED`. Never agreement. */
  UNCHECKED: "unchecked",
  /** The anchor is present only as a primitive occurrence, which the profile layer does not reach. */
  NOT_EVALUATED: "not evaluated (primitive occurrence)",
});

/** Why a row reached no document. Printed words, and stable. */
export const NOT_REACHED = Object.freeze({
  SLICE_SCOPED: "slice-scoped",
  NO_COMPARED_DOCUMENT: "no compared document",
});

/** The document-level statuses that are violations. Held here so this module needs no other. */
const VIOLATION_STATUSES = new Set(["false-valid", "spurious-error"]);

/** The oracle `-ig` for one US Core version. */
export function usCoreIg(version) {
  return `${US_CORE_PACKAGE}#${String(version)}`;
}

/** Whether a corpus record is a packages corpus. */
export function isPackageCorpus(corpus) {
  return corpus?.acquisition?.kind === PACKAGES_KIND;
}

/** Every packages corpus the declaration names. */
export function packageCorpora(declaration) {
  return declaration.corpora.filter(isPackageCorpus);
}

/**
 * The package entry a packages-corpus document path names, or `null` when the path is not
 * `<version>/package/example/<file>.json` for the version the document declares.
 */
export function packageEntryOf(document) {
  const version = String(document.version ?? "");
  const prefix = `${version}/`;
  const path = String(document.path ?? "");
  if (version === "" || !path.startsWith(prefix)) return null;
  const entry = path.slice(prefix.length);
  if (!entry.startsWith(EXAMPLE_DIRECTORY)) return null;
  const file = entry.slice(EXAMPLE_DIRECTORY.length);
  if (file === "" || file.includes("/") || !file.endsWith(".json")) return null;
  return entry;
}

/** Where the fetched tarball of one version of a packages corpus lives (git-ignored). */
export function packageLocation(corpus, version, options = {}) {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const documentsRoot = options.documentsRoot ?? join(repoRoot, "corpus", "documents");
  return resolve(documentsRoot, corpus.id, String(version), PACKAGE_FILE);
}

/** The recorded identity of one version's package. Throws rather than returning undefined. */
export function packageRecord(corpus, version) {
  const record = corpus.acquisition?.packages?.[version];
  if (record === undefined || record === null || typeof record !== "object") {
    throw new CorpusError(
      `${corpus.id}: the declaration records no package for US Core ${String(version)}`,
    );
  }
  return record;
}

/**
 * Whether `buf` is the package the declaration records, as a refusal naming the difference or
 * `null`. One decision in one place, shared by the fetch and the harness.
 */
export function packageMismatch(corpus, version, buf) {
  const record = packageRecord(corpus, version);
  const digest = sha256(buf);
  if (buf.length === record.bytes && digest === record.sha256) return null;
  return (
    `${corpus.id}: the US Core ${String(version)} package is ${String(buf.length)} bytes with sha256 ` +
    `${digest}, and the declaration records ${String(record.bytes)} bytes with sha256 ` +
    `${String(record.sha256)}. It is not the package this corpus was declared against`
  );
}

/**
 * Read one version's package from disk and verify it against the declaration. Missing, unreadable,
 * the wrong length and the wrong digest are one answer: a {@link CorpusError}, and nothing is read
 * out of the bytes.
 */
export function readVerifiedPackage(corpus, version, options = {}) {
  const file = packageLocation(corpus, version, options);
  const read = options.read ?? readFileSync;
  let buf;
  try {
    buf = read(file);
  } catch (err) {
    throw new CorpusError(
      `${corpus.id}: the US Core ${String(version)} package is not readable at ${file} ` +
        `(${String(err)}). Run \`pnpm corpus:fetch\` to materialise it.`,
    );
  }
  const mismatch = packageMismatch(corpus, version, buf);
  if (mismatch !== null) throw new CorpusError(`${mismatch} (at ${file}).`);
  return buf;
}

/**
 * The regular files of a gzipped ustar package, `name -> bytes`. Refuses anything it cannot read
 * exactly rather than returning a short map.
 */
export function packageEntries(tgz) {
  let archive;
  try {
    archive = gunzipSync(tgz);
  } catch (err) {
    throw new CorpusError(`the package is not a gzip stream: ${String(err)}`);
  }
  const text = (from, to, at) => {
    const raw = archive.subarray(at + from, at + to).toString("latin1");
    const nul = raw.indexOf("\0");
    return nul < 0 ? raw : raw.slice(0, nul);
  };
  const out = new Map();
  let at = 0;
  while (at + 512 <= archive.length) {
    const header = archive.subarray(at, at + 512);
    if (header.every((b) => b === 0)) break;
    if (text(257, 262, at) !== "ustar") throw new CorpusError("the package is not a ustar archive");
    const size = Number.parseInt(text(124, 136, at).trim() || "0", 8);
    if (!Number.isSafeInteger(size) || size < 0 || at + 512 + size > archive.length) {
      throw new CorpusError("the package carries an entry whose size cannot be read");
    }
    const prefix = text(345, 500, at);
    const name = prefix === "" ? text(0, 100, at) : `${prefix}/${text(0, 100, at)}`;
    const kind = String.fromCharCode(header[156] ?? 0);
    if (kind === "0" || kind === "\0")
      out.set(name, Buffer.from(archive.subarray(at + 512, at + 512 + size)));
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * The profiles a package carries: every StructureDefinition at the top level of the package
 * (`package/*.json`), keyed by canonical URL, with its text kept verbatim so the library parses the
 * bytes the package published.
 */
export function profileIndex(entries) {
  const byUrl = new Map();
  for (const [name, data] of entries) {
    if (!/^package\/[^/]+\.json$/.test(name) || name === "package/package.json") continue;
    const text = data.toString("utf8");
    let resource;
    try {
      resource = JSON.parse(text);
    } catch {
      continue;
    }
    if (!isRecord(resource) || resource.resourceType !== "StructureDefinition") continue;
    if (typeof resource.url !== "string" || typeof resource.id !== "string") continue;
    const snapshot =
      isRecord(resource.snapshot) && Array.isArray(resource.snapshot.element)
        ? resource.snapshot.element
        : [];
    const profile = {
      id: resource.id,
      url: resource.url,
      type: String(resource.type ?? ""),
      baseDefinition:
        typeof resource.baseDefinition === "string" ? resource.baseDefinition : undefined,
      snapshot,
      text,
    };
    byUrl.set(profile.url, profile);
  }
  return { byUrl };
}

/** Read, verify and index one version's package. */
export function loadPackage(corpus, version, options = {}) {
  return profileIndex(packageEntries(readVerifiedPackage(corpus, version, options)));
}

/**
 * The profiles one document declares, resolved against the package of the version it is declared
 * under: `{ ok: true, urls, profiles }` with `profiles` the verbatim StructureDefinition texts, or
 * `{ ok: false, reason }`. Every declared canonical resolves or the document has no readable
 * outcome; there is no branch that validates with the ones that did.
 */
export function declaredProfiles(text, version, index) {
  let resource;
  try {
    resource = JSON.parse(text);
  } catch {
    return {
      ok: false,
      reason: "the document is not readable JSON, so the profiles it declares cannot be read",
    };
  }
  const declared =
    isRecord(resource) && isRecord(resource.meta) ? resource.meta.profile : undefined;
  if (!Array.isArray(declared) || declared.length === 0) {
    return {
      ok: false,
      reason:
        "the document declares no profile in meta.profile, so there is no declared profile set to " +
        "validate it with and it has no readable outcome",
    };
  }
  const urls = [];
  const profiles = [];
  // A refusal names the entry by its POSITION, never by what it spells: `meta.profile` is document
  // content, and this log carries a document's shape, not its values.
  for (const [position, canonical] of declared.entries()) {
    const at = `meta.profile[${String(position)}]`;
    if (typeof canonical !== "string" || canonical === "") {
      return {
        ok: false,
        reason: `the document declares ${at}, which is not a canonical URL`,
      };
    }
    const bar = canonical.indexOf("|");
    const url = bar < 0 ? canonical : canonical.slice(0, bar);
    const pinned = bar < 0 ? undefined : canonical.slice(bar + 1);
    if (pinned !== undefined && pinned !== String(version)) {
      return {
        ok: false,
        reason:
          `the document declares ${at} at a version other than the US Core ${String(version)} ` +
          `package it is declared under; it is not validated with fewer profiles than it declares`,
      };
    }
    const profile = index.byUrl.get(url);
    if (profile === undefined) {
      return {
        ok: false,
        reason:
          `the document declares ${at}, which the US Core ${String(version)} package does not ` +
          `contain; it is not validated with fewer profiles than it declares`,
      };
    }
    if (urls.includes(url)) continue;
    urls.push(url);
    profiles.push(profile.text);
  }
  return { ok: true, urls, profiles };
}

/**
 * The rows this pass reports on: every row of the committed classification whose `head` is
 * `evaluated` and whose `pin` is not, joined with the projection for its path, slice and expression.
 * Throws rather than dropping a row the projection does not carry.
 */
export function newlyEvaluatedRows(projection, classification) {
  const rows = [];
  for (const row of classification.rows ?? []) {
    if (row.head !== "evaluated" || row.pin === "evaluated") continue;
    const projected = (projection.constraints ?? []).find(
      (c) =>
        c.version === row.version &&
        c.profile === row.profile &&
        c.element === row.element &&
        c.key === row.key,
    );
    if (projected === undefined) {
      throw new CorpusError(
        `the classification names ${row.version} ${row.profile} ${row.element} ${row.key}, which the ` +
          `projection does not carry`,
      );
    }
    rows.push({
      version: row.version,
      profile: row.profile,
      type: projected.type,
      element: row.element,
      path: projected.path,
      ...(projected.sliceName === undefined ? {} : { sliceName: projected.sliceName }),
      key: row.key,
    });
  }
  return rows;
}

/** {@link newlyEvaluatedRows} over the committed projection and classification. */
export function loadNewlyEvaluatedRows(options = {}) {
  const read = options.read ?? ((p) => readFileSync(p, "utf8"));
  let projection;
  let classification;
  try {
    projection = JSON.parse(read(options.projectionPath ?? PROJECTION_PATH));
    classification = JSON.parse(read(options.classificationPath ?? CLASSIFICATION_PATH));
  } catch (err) {
    throw new CorpusError(`the US Core constraint rows could not be read: ${String(err)}`);
  }
  return newlyEvaluatedRows(projection, classification);
}

/** Whether a row is scoped to a slice, which the profile layer does not evaluate. */
export function isSliceScoped(row) {
  return row.sliceName !== undefined || String(row.element).includes(":");
}

/** A profile and its `baseDefinition` ancestors inside the package, nearest first. */
function lineage(profile, index) {
  const out = [];
  const seen = new Set();
  let current = profile;
  while (current !== undefined && !seen.has(current.url)) {
    seen.add(current.url);
    out.push(current);
    current =
      current.baseDefinition === undefined ? undefined : index.byUrl.get(current.baseDefinition);
  }
  return out;
}

/**
 * Whether the profile at `url` carries `row`: the row's profile is that profile or one of its
 * ancestors in the package (so a constraint inherited from a parent profile is carried), and the
 * profile's snapshot element the row names carries a constraint with the row's key.
 */
export function carriesRow(url, row, index) {
  const profile = index.byUrl.get(url);
  if (profile === undefined) return false;
  if (!lineage(profile, index).some((p) => p.id === row.profile)) return false;
  const element = profile.snapshot.find((e) => isRecord(e) && e.id === row.element);
  return (
    element !== undefined &&
    Array.isArray(element.constraint) &&
    element.constraint.some((c) => isRecord(c) && c.key === row.key)
  );
}

/**
 * How the element a row anchors on occurs in a document: `{ complex, primitive }` counts. The
 * resource itself for a root-anchored row; each present occurrence otherwise, a choice element's
 * every present variant included. Read from the JSON the document carries, never from a value.
 */
export function anchorOccurrences(resource, row) {
  const none = { complex: 0, primitive: 0 };
  if (!isRecord(resource)) return none;
  const segments = String(row.path).split(".");
  if (segments[0] !== resource.resourceType) return none;
  if (segments.length === 1) return { complex: 1, primitive: 0 };
  let nodes = [resource];
  let leaves = [];
  for (const [i, segment] of segments.slice(1).entries()) {
    const last = i === segments.length - 2;
    const next = [];
    for (const node of nodes) {
      if (!isRecord(node)) continue;
      const names = segment.endsWith("[x]")
        ? Object.keys(node).filter((k) => {
            const base = segment.slice(0, -3);
            return k.startsWith(base) && /^[A-Z]/.test(k.slice(base.length));
          })
        : [segment];
      for (const name of names) {
        const value = node[name];
        const primitiveOnly = value === undefined && node[`_${name}`] !== undefined;
        if (value === undefined && !primitiveOnly) continue;
        const items = primitiveOnly ? [null] : Array.isArray(value) ? value : [value];
        for (const item of items) next.push(item);
      }
      if (segment.endsWith("[x]")) {
        // An extension-only primitive variant (`_valueString` with no `valueString`) is still an
        // occurrence, and a primitive one.
        const base = segment.slice(0, -3);
        for (const k of Object.keys(node)) {
          if (!k.startsWith(`_${base}`) || !/^[A-Z]/.test(k.slice(base.length + 1))) continue;
          if (node[k.slice(1)] === undefined) next.push(null);
        }
      }
    }
    if (last) leaves = next;
    nodes = next;
  }
  let complex = 0;
  let primitive = 0;
  for (const leaf of leaves) {
    if (isRecord(leaf)) complex += 1;
    else primitive += 1;
  }
  return { complex, primitive };
}

/** Whether a finding's location is at the row's anchor: the anchor itself, or one indexed occurrence. */
function atAnchor(location, row) {
  const loc = String(location ?? "");
  const anchor = String(row.path);
  return (
    loc === anchor || (loc.startsWith(`${anchor}[`) && /^\[\d+\]$/.test(loc.slice(anchor.length)))
  );
}

/**
 * This library's answer for one row on one document that reaches it, from the findings it made
 * (`{ code, constraint, location }` each) and how the anchor occurs.
 */
export function rowAnswer(issues, row, occurrences) {
  const carrying = issues.filter((i) => i.constraint === row.key && atAnchor(i.location, row));
  if (carrying.some((i) => i.code === "INVARIANT_VIOLATED")) return ROW_ANSWER.VIOLATED;
  if (carrying.length > 0 && carrying.every((i) => i.code === "INVARIANT_UNCHECKED")) {
    return ROW_ANSWER.UNCHECKED;
  }
  return occurrences.complex > 0 ? ROW_ANSWER.SATISFIED : ROW_ANSWER.NOT_EVALUATED;
}

/** Whether an answer is a decision this library made. `unchecked` and `not evaluated` are not. */
export function isDecided(answer) {
  return answer === ROW_ANSWER.VIOLATED || answer === ROW_ANSWER.SATISFIED;
}

/**
 * The reach report over the compared US Core documents.
 *
 * @param input.rows       the newly evaluated rows
 * @param input.documents  one entry per US Core document the run resolved: `{ id, version, text,
 *                         index, profiles (the resolved canonical URLs, or undefined), record (its
 *                         comparison record), ours (this library's answer) }`
 */
export function reachReport(input) {
  const { rows, documents } = input;
  const compared = documents.filter(
    (d) => d.record?.compared === true && Array.isArray(d.profiles),
  );
  const parsed = new Map();
  const resourceOf = (d) => {
    if (!parsed.has(d.id)) {
      let resource;
      try {
        resource = JSON.parse(d.text);
      } catch {
        resource = undefined;
      }
      parsed.set(d.id, resource);
    }
    return parsed.get(d.id);
  };
  const results = rows.map((row) => {
    const reaching = [];
    let declaring = 0;
    for (const d of compared) {
      if (d.version !== row.version) continue;
      if (!d.profiles.some((url) => carriesRow(url, row, d.index))) continue;
      const resource = resourceOf(d);
      const occurrences = anchorOccurrences(resource, row);
      if (occurrences.complex + occurrences.primitive === 0) continue;
      declaring += 1;
      if (isSliceScoped(row)) continue;
      const issues = d.ours?.ok === true ? d.ours.issues : [];
      const answer = rowAnswer(issues, row, occurrences);
      const violation = VIOLATION_STATUSES.has(String(d.record.status));
      reaching.push({
        id: d.id,
        answer,
        violation,
        agrees: isDecided(answer) && !violation,
        variants: Object.keys(isRecord(resource) ? resource : {}),
      });
    }
    if (isSliceScoped(row)) {
      return { row, reached: false, reason: NOT_REACHED.SLICE_SCOPED, declaring, documents: [] };
    }
    if (reaching.length === 0) {
      return {
        row,
        reached: false,
        reason: NOT_REACHED.NO_COMPARED_DOCUMENT,
        declaring,
        documents: [],
      };
    }
    return { row, reached: true, declaring, documents: reaching };
  });
  return { rows: results, comparedDocuments: compared.length };
}

/** The count of reaching documents whose answer for the row is agreement. */
export function agreeingCount(result) {
  return result.documents.filter((d) => d.agrees).length;
}

/**
 * The compared US Core documents that exercise the UCUM rule: 9.0.0, reaching `us-core-3` with a
 * `valueQuantity`, and decided by this library. A green run needs at least one.
 */
export function ucumExercised(report) {
  const ids = new Set();
  for (const result of report.rows) {
    if (result.row.version !== UCUM_RULE.version || result.row.key !== UCUM_RULE.key) continue;
    for (const d of result.documents) {
      if (d.variants.includes(UCUM_RULE.variant) && isDecided(d.answer)) ids.add(d.id);
    }
  }
  return [...ids].sort();
}

/** The condition AC-7 names, or `null` when the UCUM rule was exercised on a real document. */
export function ucumShortfall(report) {
  if (ucumExercised(report).length > 0) return null;
  return (
    `differential: no compared US Core ${UCUM_RULE.version} document reaches ${UCUM_RULE.key} with a ` +
    `${UCUM_RULE.variant} that this library decided, so the UCUM rule has not been exercised on a ` +
    `real document. This run fails.`
  );
}

/** One row's identity as it is printed. */
function rowLabel(row) {
  return `${row.version}  ${row.profile}  ${row.element}  ${row.key}`;
}

/**
 * The printed reach report: a header saying what agreement on a row means, one line per row with
 * the documents that did not agree named under it, and a closing count. Ids, keys and counts only.
 */
export function formatReachReport(report) {
  const lines = [
    `US Core pass: reach of the ${String(report.rows.length)} newly evaluated constraint row(s) over ` +
      `${String(report.comparedDocuments)} compared US Core document(s). A row counts as agreement only ` +
      `on a compared document that reaches it, where this library decided it and the document-level ` +
      `comparison is not a violation; an unchecked, not evaluated or not reached row is never counted.`,
  ];
  let agreeing = 0;
  let slice = 0;
  let unreached = 0;
  let reachedNoAgreement = 0;
  for (const result of report.rows) {
    const label = rowLabel(result.row);
    if (!result.reached) {
      if (result.reason === NOT_REACHED.SLICE_SCOPED) slice += 1;
      else unreached += 1;
      const declared =
        result.reason === NOT_REACHED.SLICE_SCOPED
          ? `; ${String(result.declaring)} compared document(s) declare a profile carrying it with the ` +
            `sliced element present, and the profile layer does not evaluate a slice-scoped constraint`
          : "";
      lines.push(
        `  ${label}: not reached (${result.reason})${declared}. Not counted as agreement.`,
      );
      continue;
    }
    const count = (answer) => result.documents.filter((d) => d.answer === answer).length;
    const agree = agreeingCount(result);
    if (agree > 0) agreeing += 1;
    else reachedNoAgreement += 1;
    const violated = result.documents.filter((d) => d.violation).length;
    lines.push(
      `  ${label}: reached by ${String(result.documents.length)} compared document(s): ` +
        `${String(agree)} agree, ${String(count(ROW_ANSWER.UNCHECKED))} unchecked, ` +
        `${String(count(ROW_ANSWER.NOT_EVALUATED))} ${ROW_ANSWER.NOT_EVALUATED}, ` +
        `${String(violated)} in a document-level violation.`,
    );
    for (const d of result.documents) {
      if (d.answer === ROW_ANSWER.UNCHECKED) {
        lines.push(
          `    unchecked: ${d.id}, this library's only answer for ${result.row.key} is INVARIANT_UNCHECKED; not counted as agreement.`,
        );
      } else if (d.answer === ROW_ANSWER.NOT_EVALUATED) {
        lines.push(`    ${ROW_ANSWER.NOT_EVALUATED}: ${d.id}; not counted as agreement.`);
      } else if (d.violation) {
        lines.push(`    violation: ${d.id}; not counted as agreement.`);
      }
    }
  }
  lines.push(
    `US Core pass: ${String(agreeing)} of ${String(report.rows.length)} newly evaluated row(s) agree on ` +
      `at least one compared document; ${String(reachedNoAgreement)} reached with no agreeing document, ` +
      `${String(slice)} not reached (${NOT_REACHED.SLICE_SCOPED}), ${String(unreached)} not reached ` +
      `(${NOT_REACHED.NO_COMPARED_DOCUMENT}).`,
  );
  const exercised = ucumExercised(report);
  lines.push(
    exercised.length > 0
      ? `US Core pass: the UCUM rule (${UCUM_RULE.version} ${UCUM_RULE.key} over a ` +
          `${UCUM_RULE.variant}) was decided on ${String(exercised.length)} compared document(s).`
      : String(ucumShortfall(report)),
  );
  return lines;
}

/**
 * The document-level accounting of the US Core pass: how many were compared, and the false valids
 * and spurious errors among them, which fail the run like any other.
 */
export function formatUsCoreDocuments(records, ids) {
  const wanted = new Set(ids);
  const mine = records.filter((r) => wanted.has(r.id));
  const compared = mine.filter((r) => r.compared).length;
  const falseValid = mine.filter((r) => r.status === "false-valid").length;
  const spurious = mine.filter((r) => r.status === "spurious-error").length;
  const unusable = mine.filter((r) => !r.compared).length;
  return [
    `US Core pass: ${String(compared)} US Core document(s) compared, ${String(unusable)} without a ` +
      `readable outcome on one side, ${String(falseValid)} false valid, ${String(spurious)} spurious ` +
      `error.`,
  ];
}
