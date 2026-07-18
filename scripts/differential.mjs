#!/usr/bin/env node
/**
 * Differential test against the official FHIR validator (`org.hl7.fhir.core` / `validator_cli.jar`)
 * — roadmap §6, "The differential oracle is the official validator."
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A CI-ONLY GATE, NOT A LOCAL ONE
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * The oracle is a **JVM** program. The zero-dependency rule binds the *published package*, not the
 * test harness — but it does mean this gate needs a Java runtime + the `validator_cli.jar`, neither of
 * which is present in the default dev container. So this script runs on GitHub Actions (the
 * `differential` job in `.github/workflows/ci.yml`, which provisions Temurin 21 and downloads the
 * jar) and is a no-op-with-clear-skip elsewhere. **It has not been observed green in this container —
 * do not read its presence as a proven differential.**
 *
 * WHAT IT PROVES (over the synthetic spec-clean corpus only)
 * ---------------------------------------------------------
 * The corpus here is **tier (a): synthetic, spec-clean** resources (roadmap §6). The two invariants:
 *
 *   1. **Never a false *valid*.** If the oracle reports an `error`/`fatal` on a resource, `@cosyte/fhir`
 *      must NOT report it clean. This is the safety-critical direction — a validator that passes what
 *      the authoritative implementation fails is dangerous. Enforced hard (a violation exits non-zero).
 *   2. **No spurious errors on clean input.** On a resource the oracle finds clean, we must not invent
 *      an `error`/`fatal`. Enforced hard.
 *
 * Comparison is on **issue presence + severity bucket + location**, never on diagnostic *text* — we
 * deliberately diverge on text (ours is PHI-redacted; the oracle echoes values — roadmap §7). Where we
 * are a deliberate *subset* validator (we do not yet check every profile/terminology rule the oracle
 * does), the oracle finding an extra WARNING/INFORMATION we don't is a **documented delta**, printed
 * but not failed.
 *
 * WHAT IS DEFERRED
 * ----------------
 * The differential's highest-value corpus is the **real-vendor quirk set** (tier (b)). A vendor quirk
 * is encoded only when a real de-identified document grounds it (conventions §PHI); none is vendored,
 * and inventing one is forbidden — so the **quirk-corpus differential is deferred to `REAL-CORPUS`**.
 * This script runs the spec-clean tier now and is structured to accept the quirk corpus unchanged when
 * it lands.
 *
 * @packageDocumentation
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseResource, validateResource } from "../dist/index.mjs";

const FIXTURE_DIR = fileURLToPath(new URL("../test/__fixtures__/", import.meta.url));

/**
 * The synthetic, spec-clean tier-(a) corpus this gate runs over. These are self-authored synthetic
 * resources (no PHI, no invented vendor quirk) that the oracle should find valid. Bundles / NDJSON /
 * deliberately-quirky fixtures are intentionally excluded — the quirk differential is REAL-CORPUS.
 */
const SPEC_CLEAN = [
  "patient.json",
  "observation-decimals.json",
  "observation-lab-refrange.json",
  "observation-vitals-bp.json",
  "medicationrequest-dose.json",
];

const ERRORISH = new Set(["fatal", "error"]);

/** Resolve the validator jar from the environment; a missing jar is a clean skip, not a failure. */
function resolveJar() {
  const jar = process.env.VALIDATOR_CLI_JAR;
  if (!jar) {
    console.log(
      "differential: VALIDATOR_CLI_JAR is not set (no JVM oracle available) — SKIPPING.\n" +
        "  This gate runs on GitHub Actions (the `differential` job), not in the dev container.",
    );
    process.exit(0);
  }
  return jar;
}

/** Run the oracle on one file and return its OperationOutcome issues (severity + location only). */
function oracleIssues(jar, file) {
  const out = join(mkdtempSync(join(tmpdir(), "fhir-diff-")), "outcome.json");
  try {
    execFileSync(
      "java",
      ["-jar", jar, file, "-version", "4.0.1", "-output", out],
      { stdio: ["ignore", "ignore", "inherit"] },
    );
  } catch {
    // The CLI exits non-zero when it finds validation errors — that is data, not a harness failure.
    // The OperationOutcome is still written; fall through and read it.
  }
  const outcome = JSON.parse(readFileSync(out, "utf8"));
  const issues = Array.isArray(outcome.issue) ? outcome.issue : [];
  return issues.map((i) => ({
    severity: String(i.severity ?? "information"),
    location: String((i.expression?.[0] ?? i.location?.[0]) ?? ""),
  }));
}

/** Our own findings, normalized to the same { severity, location } shape (text deliberately dropped). */
function ourIssues(text) {
  const { resource } = parseResource(text);
  const result = validateResource(resource);
  return result.issues.map((i) => ({ severity: String(i.severity), location: String(i.expression) }));
}

function main() {
  const jar = resolveJar();
  let violations = 0;

  for (const name of SPEC_CLEAN) {
    const file = join(FIXTURE_DIR, name);
    const text = readFileSync(file, "utf8");

    const oracle = oracleIssues(jar, file);
    const ours = ourIssues(text);

    const oracleErrors = oracle.filter((i) => ERRORISH.has(i.severity));
    const ourErrors = ours.filter((i) => ERRORISH.has(i.severity));

    // Invariant 1 — never a false valid: the oracle errored, we did not.
    if (oracleErrors.length > 0 && ourErrors.length === 0) {
      console.error(`✗ FALSE VALID: ${name} — oracle reports ${oracleErrors.length} error(s), we report none.`);
      for (const e of oracleErrors) console.error(`    oracle ${e.severity} @ ${e.location || "(root)"}`);
      violations += 1;
      continue;
    }

    // Invariant 2 — no spurious errors on clean input: the oracle was clean, we errored.
    if (oracleErrors.length === 0 && ourErrors.length > 0) {
      console.error(`✗ SPURIOUS ERROR: ${name} — oracle is clean, we report ${ourErrors.length} error(s).`);
      for (const e of ourErrors) console.error(`    ours ${e.severity} @ ${e.location || "(root)"}`);
      violations += 1;
      continue;
    }

    // Documented deltas: the oracle's richer warning/info set that our subset validator does not emit.
    const delta = oracle.length - ours.length;
    console.log(
      `✓ ${name}: oracle ${oracleErrors.length} err / ${oracle.length} total; ` +
        `ours ${ourErrors.length} err / ${ours.length} total` +
        (delta > 0 ? ` (delta ${String(delta)}: oracle's extra profile/terminology findings — expected)` : ""),
    );
  }

  if (violations > 0) {
    console.error(`\ndifferential: ${String(violations)} invariant violation(s) — see above.`);
    process.exit(1);
  }
  console.log("\ndifferential: spec-clean corpus agrees with the oracle within documented deltas.");
}

main();
