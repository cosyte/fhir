/**
 * The oracle: which `validator_cli.jar` was used, how it is identified, and how its answer for one
 * document is obtained without ever guessing.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * THE IDENTITY IS DERIVED FROM THE ARTIFACT, NOT FROM A CONFIGURED STRING
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * {@link ORACLE_RELEASE} is the release CI is pinned to, and it is the weaker half of the record:
 * a string in a workflow file says what someone MEANT to run. {@link oracleIdentity} hashes the jar
 * that is actually on disk, so substituting a different artifact changes the recorded identity even
 * when the configured version string does not. If the jar cannot be read, there is no identity, and
 * the harness refuses: comparing documents against an unidentified oracle produces a number nobody
 * can reproduce.
 *
 * THE ORACLE'S ANSWER IS EITHER OBTAINED OR IT IS NOT
 * ---------------------------------------------------
 * A crash, a non-zero exit with no output file, unparseable output, a timeout, or an outcome the
 * harness cannot attribute to exactly one document all resolve to the same thing: no readable
 * outcome for that document. Such a document is neither counted as compared nor reported clean.
 * There is deliberately no "assume clean" branch: that is the false-valid direction.
 *
 * This module holds no `dist/` import on purpose, and every process interaction is injectable, so
 * `test/differential-oracle.test.ts` grades it with no build, no JVM and no network.
 *
 * @packageDocumentation
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";

/**
 * The pinned oracle release. CI downloads THIS tag, not `releases/latest`: a moving pointer means
 * two runs of the same commit can disagree and neither log says why.
 */
export const ORACLE_RELEASE = "6.10.2";

/** The release-pinned download URL, the one `.github/workflows/ci.yml` uses. */
export const ORACLE_DOWNLOAD_URL = `https://github.com/hapifhir/org.hl7.fhir.core/releases/download/${ORACLE_RELEASE}/validator_cli.jar`;

/**
 * The US Core IG the oracle loads (`-ig`) so it can resolve US Core extension definitions. Without
 * it the validator flags a `us-core-*` extension URL it cannot resolve as "not allowed here", an
 * artifact of the ORACLE's missing package rather than a defect in the instance. Unchanged.
 */
export const US_CORE_IG = "hl7.fhir.us.core#6.1.0";

/** The FHIR version the oracle validates against. */
export const FHIR_VERSION = "4.0.1";

/** The extension the validator writes on a per-file OperationOutcome in a multi-file run. */
export const OUTCOME_FILE_EXTENSION =
  "http://hl7.org/fhir/StructureDefinition/operationoutcome-file";

/** The identity of the oracle could not be established, so nothing may be compared against it. */
export class OracleError extends Error {
  constructor(message) {
    super(message);
    this.name = "OracleError";
  }
}

/**
 * The identity of the artifact about to be used, derived from its own bytes.
 *
 * `release` is what the configuration SAYS. `sha256` and `bytes` are what is actually there, so a
 * substituted jar changes the record even when `release` does not. Refuses rather than recording a
 * guess: no path, no file, not a file, or an empty file are all "identity not established".
 */
export function oracleIdentity(jarPath, options = {}) {
  const release = options.release ?? ORACLE_RELEASE;
  if (typeof jarPath !== "string" || jarPath.length === 0) {
    throw new OracleError(
      "the oracle jar path is empty, so the artifact about to be used cannot be identified.",
    );
  }
  let stat;
  try {
    stat = statSync(jarPath);
  } catch (err) {
    throw new OracleError(`the oracle jar at ${jarPath} could not be examined: ${String(err)}`);
  }
  if (!stat.isFile()) {
    throw new OracleError(`the oracle jar at ${jarPath} is not a regular file, so it has no identity.`);
  }
  if (stat.size === 0) {
    throw new OracleError(`the oracle jar at ${jarPath} is empty, so it has no identity.`);
  }
  let buf;
  try {
    buf = readFileSync(jarPath);
  } catch (err) {
    throw new OracleError(`the oracle jar at ${jarPath} could not be read: ${String(err)}`);
  }
  return {
    release,
    artifact: basename(jarPath),
    path: jarPath,
    bytes: buf.length,
    sha256: createHash("sha256").update(buf).digest("hex"),
  };
}

/** The identity as it is printed beside every result. */
export function formatOracleIdentity(identity) {
  return (
    `oracle: validator_cli.jar release ${identity.release}, ` +
    `${String(identity.bytes)} bytes, sha256 ${identity.sha256}`
  );
}

function issueShape(issue) {
  return {
    severity: String(issue.severity ?? "information"),
    location: String(issue.expression?.[0] ?? issue.location?.[0] ?? ""),
  };
}

/** Every string anywhere inside a value, so a file name can be found wherever the validator put it. */
function collectStrings(value, into) {
  if (typeof value === "string") {
    into.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, into);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) collectStrings(item, into);
  }
}

/**
 * Which staged file an OperationOutcome is about.
 *
 * The validator records it in an `operationoutcome-file` extension. That is what is read first;
 * if it is absent, every string in the outcome is searched for exactly one of the staged names.
 * AMBIGUITY IS NOT RESOLVED BY GUESSING: zero matches or two matches both return `null`, and the
 * caller turns that into "no readable outcome" for the documents involved.
 */
export function attributeOutcome(outcome, stagedNames) {
  const strings = [];
  const extensions = Array.isArray(outcome.extension) ? outcome.extension : [];
  for (const ext of extensions) {
    if (ext !== null && typeof ext === "object" && ext.url === OUTCOME_FILE_EXTENSION) {
      collectStrings(ext.valueString ?? ext.valueUri ?? ext.valueUrl ?? "", strings);
    }
  }
  if (strings.length === 0) collectStrings(outcome, strings);
  const matches = new Set();
  for (const s of strings) {
    for (const name of stagedNames) {
      // Two forms, because the CLI records the file in more than one place and one of them is an
      // `OperationOutcome.id`, which is spelled without the extension. Both are unique: every staged
      // name carries an ordinal prefix.
      const stem = name.replace(/\.[^.]*$/, "");
      for (const form of new Set([name, stem])) {
        // Endswith on a path separator boundary: a bare `includes` would let `a.json` match
        // `xa.json`, which is a mis-attribution and therefore a route to masking a false valid.
        if (s === form || s.endsWith(`/${form}`) || s.endsWith(`\\${form}`)) matches.add(name);
      }
    }
  }
  return matches.size === 1 ? [...matches][0] : null;
}

/**
 * Turn the validator's `-output` document into `staged file name -> issues`.
 *
 * Accepts the two shapes the CLI produces: a bare `OperationOutcome` (single input) and a `Bundle`
 * of them (multiple inputs). Anything else, or JSON that does not parse, yields `{ ok: false }`,
 * which is not the same as "clean" anywhere downstream.
 */
export function parseOracleOutput(text, stagedNames) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    return { ok: false, reason: `the oracle's output is not parseable JSON: ${String(err)}` };
  }
  if (doc === null || typeof doc !== "object") {
    return { ok: false, reason: "the oracle's output is not a FHIR resource" };
  }
  const names = [...stagedNames];
  const byName = new Map();
  if (doc.resourceType === "OperationOutcome") {
    const target = names.length === 1 ? names[0] : attributeOutcome(doc, names);
    if (target === null) {
      return { ok: false, reason: "the oracle returned one outcome for several documents" };
    }
    byName.set(target, (Array.isArray(doc.issue) ? doc.issue : []).map(issueShape));
    return { ok: true, byName };
  }
  if (doc.resourceType === "Bundle") {
    const entries = Array.isArray(doc.entry) ? doc.entry : [];
    const unattributed = [];
    for (const entry of entries) {
      const resource = entry?.resource;
      if (resource === null || typeof resource !== "object") continue;
      if (resource.resourceType !== "OperationOutcome") continue;
      const target = attributeOutcome(resource, names);
      if (target === null) {
        unattributed.push(resource);
        continue;
      }
      byName.set(target, (Array.isArray(resource.issue) ? resource.issue : []).map(issueShape));
    }
    return { ok: true, byName, unattributed: unattributed.length };
  }
  return {
    ok: false,
    reason: `the oracle's output is a ${String(doc.resourceType)}, not an OperationOutcome or a Bundle of them`,
  };
}

/** The argv the oracle is invoked with. One place, so the workflow and the harness cannot drift. */
export function oracleArgs(jar, files, outputPath, options = {}) {
  return [
    "-jar",
    jar,
    ...files,
    "-version",
    options.fhirVersion ?? FHIR_VERSION,
    "-ig",
    options.ig ?? US_CORE_IG,
    "-output",
    outputPath,
  ];
}

/**
 * Run the oracle over one batch of staged files and return `staged name -> issues`.
 *
 * Every failure mode collapses to `{ ok: false, reason }`: the CLI crashed, it exceeded the time
 * bound, it wrote nothing, or it wrote something unreadable. The caller marks every document in the
 * batch as having no readable outcome. `exec` and `read` are injectable so this is graded without a
 * JVM.
 */
export function runOracleBatch(jar, stagedFiles, outputPath, options = {}) {
  const exec = options.exec ?? execFileSync;
  const read = options.read ?? ((p) => readFileSync(p, "utf8"));
  const names = stagedFiles.map((f) => basename(f));
  try {
    exec("java", oracleArgs(jar, stagedFiles, outputPath, options), {
      stdio: ["ignore", "ignore", "inherit"],
      timeout: options.timeoutMs ?? 600_000,
      killSignal: "SIGKILL",
    });
  } catch (err) {
    // A non-zero exit is DATA (the CLI exits non-zero when it finds validation errors) and the
    // outcome is still written, so fall through and read it. A timeout or a spawn failure is not
    // data: there is nothing to read and nothing may be assumed.
    const code = err?.code;
    const signal = err?.signal;
    if (code === "ETIMEDOUT" || signal === "SIGKILL" || signal === "SIGTERM") {
      return {
        ok: false,
        reason: `the oracle exceeded its ${String(options.timeoutMs ?? 600_000)}ms time bound`,
      };
    }
    if (code === "ENOENT") {
      return { ok: false, reason: "no `java` on PATH, so the oracle could not be run" };
    }
  }
  let text;
  try {
    text = read(outputPath);
  } catch (err) {
    return { ok: false, reason: `the oracle wrote no readable output: ${String(err)}` };
  }
  return parseOracleOutput(text, names);
}
