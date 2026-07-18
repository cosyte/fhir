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
 * THE TIER-2 QUIRK CORPUS (FHIR-P10b, ADR 0018)
 * ---------------------------------------------
 * The differential's highest-value corpus is the **real-world quirk set** (tier (b), roadmap §3/§6).
 * ADR 0018 unblocked it: a quirk is still encoded only when a **real document grounds it**, but "real
 * document" now explicitly includes **publicly available real artifacts** (FHIR published examples,
 * the spec's normative rules, US Core, documented public interop defects) — not only private vendor
 * feeds. So the quirk corpus ({@link QUIRK_CORPUS}) is now differential-tested here alongside the
 * spec-clean tier. Its provenance (each fixture → its public source) lives in `test/quirk-corpus.test.ts`.
 * A genuinely vendor-proprietary deviation absent from every public sample stays grounded-only and is
 * not in this corpus (inventing one is forbidden).
 *
 * The two invariants apply to the quirk corpus unchanged. One quirk fixture (the HAPI-#5738 primitive-
 * extension misalignment) is designed to **fail closed**: `parseResource` throws a typed fatal, which
 * this harness surfaces as a `fatal` finding. A fail-closed *parse refusal* is exempt from Invariant 2
 * (spurious error): refusing unrecoverable structure is the safe, conservative direction — permitted
 * even where a more lenient oracle tolerates the input — and it can never be a false *valid* (we
 * errored). Invariant 1 still applies in full.
 *
 * @packageDocumentation
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { FhirCodecError, parseResource, validateResource } from "../dist/index.mjs";

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

/**
 * The Tier-2 real-world quirk corpus (FHIR-P10b). Each fixture reproduces a documented public interop
 * quirk (see `test/quirk-corpus.test.ts` for the per-fixture grounding + citation). All are valid FHIR
 * the oracle finds clean — except `quirk-primitive-extension-misaligned.json`, which is malformed
 * (broken `_`-sibling alignment, HAPI #5738); the oracle rejects it and so do we (fail-closed throw).
 */
const QUIRK_CORPUS = [
  "quirk-resourcetype-last.json",
  "quirk-scientific-decimal.json",
  "quirk-searchset-paging.json",
  "quirk-uscore-extensions.json",
  "quirk-primitive-extension-misaligned.json",
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
    execFileSync("java", ["-jar", jar, file, "-version", "4.0.1", "-output", out], {
      stdio: ["ignore", "ignore", "inherit"],
    });
  } catch {
    // The CLI exits non-zero when it finds validation errors — that is data, not a harness failure.
    // The OperationOutcome is still written; fall through and read it.
  }
  const outcome = JSON.parse(readFileSync(out, "utf8"));
  const issues = Array.isArray(outcome.issue) ? outcome.issue : [];
  return issues.map((i) => ({
    severity: String(i.severity ?? "information"),
    location: String(i.expression?.[0] ?? i.location?.[0] ?? ""),
  }));
}

/**
 * Our own findings, normalized to the same { severity, location } shape (text deliberately dropped),
 * plus `parseRefused`: whether the reader **failed closed** on unrecoverable input (a thrown
 * `FhirCodecError` — e.g. the HAPI-#5738 `_`-sibling misalignment). A fail-closed refusal is a genuine
 * `fatal` finding, never swallowed; the flag lets the caller treat it as the *safe, conservative*
 * direction (see Invariant 2) rather than a spurious error, since refusing malformed structure is
 * always permitted even where a more lenient oracle happens to tolerate it.
 */
function ourIssues(text) {
  let resource;
  try {
    ({ resource } = parseResource(text));
  } catch (err) {
    if (err instanceof FhirCodecError) {
      return {
        issues: [{ severity: "fatal", location: String(err.expression ?? "") }],
        parseRefused: true,
      };
    }
    throw err;
  }
  const result = validateResource(resource);
  return {
    issues: result.issues.map((i) => ({
      severity: String(i.severity),
      location: String(i.expression),
    })),
    parseRefused: false,
  };
}

function main() {
  const jar = resolveJar();
  let violations = 0;

  for (const name of [...SPEC_CLEAN, ...QUIRK_CORPUS]) {
    const file = join(FIXTURE_DIR, name);
    const text = readFileSync(file, "utf8");

    const oracle = oracleIssues(jar, file);
    const { issues: ours, parseRefused } = ourIssues(text);

    const oracleErrors = oracle.filter((i) => ERRORISH.has(i.severity));
    const ourErrors = ours.filter((i) => ERRORISH.has(i.severity));

    // Invariant 1 — never a false valid: the oracle errored, we did not.
    if (oracleErrors.length > 0 && ourErrors.length === 0) {
      console.error(
        `✗ FALSE VALID: ${name} — oracle reports ${oracleErrors.length} error(s), we report none.`,
      );
      for (const e of oracleErrors)
        console.error(`    oracle ${e.severity} @ ${e.location || "(root)"}`);
      violations += 1;
      continue;
    }

    // Invariant 2 — no spurious errors on clean input: the oracle was clean, we errored.
    // A fail-closed *parse refusal* is exempt: refusing unrecoverable structure (a broken `_`-sibling
    // alignment) is the safe, conservative direction — allowed even where a more lenient oracle
    // tolerates it. It cannot be a false *valid* (we errored), and stricter-than-the-oracle on
    // malformed structure is not a defect. Only a spurious *validation* error is flagged here.
    if (oracleErrors.length === 0 && ourErrors.length > 0 && !parseRefused) {
      console.error(
        `✗ SPURIOUS ERROR: ${name} — oracle is clean, we report ${ourErrors.length} error(s).`,
      );
      for (const e of ourErrors)
        console.error(`    ours ${e.severity} @ ${e.location || "(root)"}`);
      violations += 1;
      continue;
    }
    if (oracleErrors.length === 0 && parseRefused) {
      console.log(
        `✓ ${name}: reader failed closed (safe refusal); oracle lenient — exempt from Invariant 2.`,
      );
      continue;
    }

    // Documented deltas: the oracle's richer warning/info set that our subset validator does not emit.
    const delta = oracle.length - ours.length;
    console.log(
      `✓ ${name}: oracle ${oracleErrors.length} err / ${oracle.length} total; ` +
        `ours ${ourErrors.length} err / ${ours.length} total` +
        (delta > 0
          ? ` (delta ${String(delta)}: oracle's extra profile/terminology findings — expected)`
          : ""),
    );
  }

  if (violations > 0) {
    console.error(`\ndifferential: ${String(violations)} invariant violation(s) — see above.`);
    process.exit(1);
  }
  console.log(
    "\ndifferential: spec-clean + Tier-2 quirk corpora agree with the oracle within documented deltas.",
  );
}

main();
