/**
 * The run record: what a differential run says about itself in a form two runs can be compared on,
 * and the verdict a determinism check reaches from two of them.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * A RUN RECORD IS A PURE FUNCTION OF THE RUN'S INPUTS
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * The record carries the oracle's identity, the terminology inputs the run declared, the corpus it
 * was asked about, and one line per document. It carries NO wall-clock time, NO temporary staging
 * path and NO run ordinal, because a record containing any of those cannot answer the only question
 * it exists to answer: did the same inputs produce the same result.
 *
 * That is enforced by construction, not by inspection: {@link buildRunRecord} names every field it
 * copies, so a caller handing it a staged file name, a `mkdtemp` directory or a timestamp cannot get
 * one into the record. {@link canonicalJson} then sorts keys at every depth and the documents are
 * sorted by id, so two runs that answered the same way serialise to the same bytes even if they
 * iterated in a different order.
 *
 * WHAT THE RECORD DELIBERATELY DOES NOT CARRY
 * -------------------------------------------
 * No diagnostic text, and no per-finding location. The record is a public CI artifact and the
 * oracle's diagnostic text echoes document values; the harness has never printed it and this does
 * not start. Severity counts, the recorded status and the terminology class are enough to say
 * whether two runs agreed, and a disagreement is reported as `id: statusA -> statusB`.
 *
 * A MISSING ANSWER IS NOT AGREEMENT
 * ---------------------------------
 * {@link determinismVerdict} treats a comparison that contains any document without a readable
 * outcome on one side as DETERMINISM NOT DEMONSTRATED. Two runs that both failed to obtain an
 * answer for the same document produce identical records, and reading that as "the same result
 * twice" would let a permanently broken oracle certify its own determinism. There is deliberately
 * no branch below that reports success or a silent skip.
 *
 * This module is pure: no filesystem, no process, no `dist/` import, so
 * `test/differential-determinism.test.ts` grades every branch with no JVM, no network and no build.
 *
 * @packageDocumentation
 */

import { createHash } from "node:crypto";

import { STATUS } from "./compare.mjs";

/** The shape version of the record, so two records of different shapes never compare equal. */
export const RUN_RECORD_VERSION = 1;

/** The words a failed determinism check reports. One constant, so the log and the tests agree. */
export const NOT_DEMONSTRATED = "determinism NOT demonstrated";

/** The words a passing one reports. */
export const DEMONSTRATED = "determinism demonstrated";

/** Keys sorted at every depth. Arrays keep their order; the caller sorts what needs sorting. */
function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value === null || typeof value !== "object") return value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = sortDeep(value[key]);
  return out;
}

/** The record's one serialisation. Stable under key order, and ends with a newline. */
export function canonicalJson(value) {
  return `${JSON.stringify(sortDeep(value), null, 2)}\n`;
}

/** The digest two runs are compared on. */
export function runRecordDigest(record) {
  return createHash("sha256").update(canonicalJson(record)).digest("hex");
}

const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

/**
 * One document's line in the record. Named fields only: `detail` prose, per-finding locations,
 * staged names and anything else a caller might be carrying stay out by construction.
 */
function documentLine(record) {
  return {
    id: String(record.id),
    status: String(record.status),
    compared: record.compared === true,
    clean: record.clean === true,
    violation: record.violation === true,
    oracleErrors: number(record.oracleErrors),
    ourErrors: number(record.ourErrors),
    terminology: number(record.terminology),
    terminologyErrors: number(record.terminologyErrors),
  };
}

/**
 * Build the run record from the run's inputs and its per-document results.
 *
 * @param input.oracle       the identity `oracle.mjs` derived from the jar's own bytes
 * @param input.terminology  the resolved terminology inputs `terminology.mjs` honoured
 * @param input.corpus       the corpus facts: corpora, declared/excluded counts, floor, subset
 * @param input.records      the per-document records from `compare.mjs`
 * @param input.summary      the fold of those records
 */
export function buildRunRecord(input) {
  const { oracle = {}, terminology = {}, corpus = {}, records = [], summary = {} } = input;
  const documents = records.map(documentLine).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    recordVersion: RUN_RECORD_VERSION,
    oracle: {
      // `path` is deliberately absent: it is a runner-temporary location, not an input.
      release: String(oracle.release ?? ""),
      artifact: String(oracle.artifact ?? ""),
      bytes: number(oracle.bytes),
      sha256: String(oracle.sha256 ?? ""),
    },
    terminology: {
      source: String(terminology.source ?? ""),
      server: String(terminology.server ?? ""),
      cache: String(terminology.cache ?? ""),
      digest: String(terminology.digest ?? ""),
      pinned: (terminology.pinned ?? []).map((entry) => ({
        path: String(entry.path),
        bytes: number(entry.bytes),
        sha256: String(entry.sha256),
      })),
    },
    corpus: {
      declared: number(corpus.declared),
      excluded: number(corpus.excluded),
      floor: number(corpus.floor),
      scope: String(corpus.scope ?? "full"),
      documents: [...(corpus.documents ?? [])].map(String).sort(),
      corpora: [...(corpus.corpora ?? [])]
        .map((c) => ({
          id: String(c.id),
          version: String(c.version),
          licence: String(c.licence),
        }))
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    },
    totals: {
      compared: number(summary.compared),
      clean: number(summary.clean),
      violations: (summary.violations ?? []).length,
      unusable: (summary.unusable ?? []).length,
      excluded: (summary.exclusions ?? []).length,
      terminologyDocuments: number(summary.terminologyDocuments),
      terminologyFindings: number(summary.terminologyFindings),
      terminologyDeltas: number(summary.terminologyDeltas),
      meetsFloor: summary.meetsFloor === true,
    },
    documents,
  };
}

/** The record as it is printed beside every result. */
export function formatRunRecord(record) {
  const t = record.totals;
  return [
    `run record: version ${String(record.recordVersion)}, digest sha256 ${runRecordDigest(record)}`,
    `run record: scope ${record.corpus.scope}, ${String(t.compared)} compared, ` +
      `${String(t.excluded)} excluded, ${String(t.violations)} violation(s), ` +
      `${String(t.unusable)} without a readable outcome, ` +
      `${String(t.terminologyDocuments)} document(s) carrying a terminology-attributable finding.`,
    `run record: a pure function of the corpus bytes, the oracle artifact and the declared ` +
      `terminology inputs. No wall-clock time, no staging path, no run ordinal.`,
  ];
}

/** A determinism verdict that never got as far as two comparisons. */
export function determinismRefusal(reason) {
  return { demonstrated: false, reason: `${NOT_DEMONSTRATED}: ${reason}`, differences: [] };
}

/**
 * Whether a value is a run record this module built. Two things that are not run records serialise
 * identically and would otherwise read as agreement, which is the silent pass this check exists to
 * make impossible.
 */
function isRunRecord(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    value.recordVersion === RUN_RECORD_VERSION &&
    Array.isArray(value.documents) &&
    value.totals !== null &&
    typeof value.totals === "object"
  );
}

/** The statuses that mean one side produced no readable answer for a document. */
const UNUSABLE_STATUSES = new Set([STATUS.NO_ORACLE_OUTCOME, STATUS.NO_OWN_FINDINGS]);

function unusableIds(record) {
  return (record.documents ?? [])
    .filter((d) => d.compared !== true || UNUSABLE_STATUSES.has(String(d.status)))
    .map((d) => String(d.id));
}

/** Where two records disagree, as `id: statusA -> statusB`. No diagnostic text, ever. */
export function differencesBetween(first, second) {
  const out = [];
  const byId = new Map((second.documents ?? []).map((d) => [String(d.id), d]));
  const seen = new Set();
  for (const a of first.documents ?? []) {
    seen.add(String(a.id));
    const b = byId.get(String(a.id));
    if (b === undefined) {
      out.push(`${String(a.id)}: compared in the first comparison, absent from the second`);
      continue;
    }
    if (a.status !== b.status) out.push(`${String(a.id)}: ${String(a.status)} -> ${String(b.status)}`);
    else if (a.oracleErrors !== b.oracleErrors || a.ourErrors !== b.ourErrors) {
      out.push(
        `${String(a.id)}: ${String(a.status)} in both, but the error counts moved ` +
          `(oracle ${String(a.oracleErrors)} -> ${String(b.oracleErrors)}, ` +
          `ours ${String(a.ourErrors)} -> ${String(b.ourErrors)})`,
      );
    }
  }
  for (const b of second.documents ?? []) {
    if (!seen.has(String(b.id))) {
      out.push(`${String(b.id)}: absent from the first comparison, compared in the second`);
    }
  }
  for (const key of Object.keys(first.totals ?? {})) {
    const a = first.totals[key];
    const b = (second.totals ?? {})[key];
    if (a !== b) out.push(`totals.${key}: ${String(a)} -> ${String(b)}`);
  }
  return out;
}

/**
 * The verdict over two comparisons of the same inputs.
 *
 * Not demonstrated, and never a silent pass, when either record is missing, when either comparison
 * contained a document without a readable outcome on one side, or when the two records are not
 * byte-identical.
 */
export function determinismVerdict(first, second) {
  if (!isRunRecord(first) || !isRunRecord(second)) {
    return determinismRefusal(
      "two comparisons were not obtained, so nothing was compared twice. A pair of records that " +
        "are not run records is not agreement between two runs",
    );
  }
  if (first.documents.length === 0 || second.documents.length === 0) {
    return determinismRefusal(
      "a comparison contained no document, so nothing was compared twice. An empty comparison " +
        "repeats identically and demonstrates nothing",
    );
  }
  const missing = [...new Set([...unusableIds(first), ...unusableIds(second)])].sort();
  if (missing.length > 0) {
    return {
      demonstrated: false,
      reason:
        `${NOT_DEMONSTRATED}: ${String(missing.length)} document(s) yielded no readable outcome on ` +
        `one side, and two runs that both failed to obtain an answer are not two runs that agreed`,
      differences: missing.map((id) => `${id}: no readable outcome, neither compared nor clean`),
    };
  }
  const digestA = runRecordDigest(first);
  const digestB = runRecordDigest(second);
  if (digestA !== digestB) {
    return {
      demonstrated: false,
      reason:
        `${NOT_DEMONSTRATED}: the two run records differ (sha256 ${digestA} vs ${digestB}), so the ` +
        `same corpus and the same oracle artifact under the same declared terminology inputs did ` +
        `not produce the same result`,
      differences: differencesBetween(first, second),
    };
  }
  return {
    demonstrated: true,
    reason:
      `${DEMONSTRATED}: two comparisons of ${String(first.totals.compared)} document(s) produced ` +
      `byte-identical run records (sha256 ${digestA})`,
    differences: [],
  };
}

/** The verdict as it is printed. */
export function formatDeterminismVerdict(verdict) {
  const reason = String(verdict.reason);
  return [
    `differential:determinism: ${reason.endsWith(".") ? reason : `${reason}.`}`,
    ...verdict.differences.map((d) => `  - ${d}`),
  ];
}

/** Non-zero unless determinism was demonstrated. There is no third outcome. */
export function exitCodeForDeterminism(verdict) {
  return verdict.demonstrated === true ? 0 : 1;
}
