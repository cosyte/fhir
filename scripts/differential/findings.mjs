/**
 * This library's own findings for one document, normalized to the oracle's shape.
 *
 * Lifted out of `scripts/differential.mjs` so the differential and the determinism check ask the
 * same question of the same code rather than two copies of it. **This is the one module under
 * `scripts/differential/` that imports `dist/`**, which is why the harness's test suites import
 * every other one and never this: they are graded with no build.
 *
 * @packageDocumentation
 */

import { FhirCodecError, parseResource, validateResource } from "../../dist/index.mjs";

/**
 * Our own findings, normalized to the oracle's `{ severity, location }` shape (text deliberately
 * dropped), plus `parseRefused`: whether the reader **failed closed** on unrecoverable input (a
 * thrown `FhirCodecError`). A fail-closed refusal is a genuine `fatal` finding, never swallowed; the
 * flag lets the accounting treat it as the safe, conservative direction rather than a spurious
 * error. Anything else thrown is an answer we did NOT get, and is reported as such rather than as
 * "no findings".
 */
export function ourFindings(text) {
  let resource;
  try {
    ({ resource } = parseResource(text));
  } catch (err) {
    if (err instanceof FhirCodecError) {
      return {
        ok: true,
        issues: [{ severity: "fatal", location: String(err.expression ?? "") }],
        parseRefused: true,
      };
    }
    return { ok: false, reason: `the reader threw a non-codec error: ${String(err)}` };
  }
  try {
    const result = validateResource(resource);
    return {
      ok: true,
      issues: result.issues.map((i) => ({
        severity: String(i.severity),
        location: String(i.expression),
      })),
      parseRefused: false,
    };
  } catch (err) {
    return { ok: false, reason: `validateResource threw: ${String(err)}` };
  }
}
