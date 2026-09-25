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

import {
  FhirCodecError,
  loadStructureDefinition,
  parseResource,
  validateResource,
} from "../../dist/index.mjs";

/** Each profile text is parsed and loaded once per run, however many documents declare it. */
const loaded = new Map();

/**
 * One US Core profile, loaded from the verbatim StructureDefinition text its package carries, or
 * `undefined` when this library cannot load it.
 */
function loadProfile(text) {
  if (!loaded.has(text)) {
    let profile;
    try {
      profile = loadStructureDefinition(parseResource(text).resource);
    } catch {
      profile = undefined;
    }
    loaded.set(text, profile);
  }
  return loaded.get(text);
}

/**
 * Our own findings, normalized to the oracle's `{ severity, location }` shape (text deliberately
 * dropped) plus the finding's code and the constraint key it carries, and `parseRefused`: whether
 * the reader **failed closed** on unrecoverable input (a thrown `FhirCodecError`). A fail-closed
 * refusal is a genuine `fatal` finding, never swallowed; the flag lets the accounting treat it as
 * the safe, conservative direction rather than a spurious error. Anything else thrown is an answer
 * we did NOT get, and is reported as such rather than as "no findings".
 *
 * `options.profiles`, when given, is the verbatim StructureDefinition text of every profile the
 * document declares, and the document is validated against exactly those. A profile this library
 * cannot load is an answer we did not get: validating with fewer profiles than were declared would
 * answer a question the document never asked. With no `options.profiles` the document is validated
 * with no profile supplied, which is how every document outside the US Core pass is validated.
 */
export function ourFindings(text, options = {}) {
  let profiles;
  if (options.profiles !== undefined) {
    profiles = [];
    for (const profileText of options.profiles) {
      const profile = loadProfile(profileText);
      if (profile === undefined) {
        return {
          ok: false,
          reason: "a declared profile could not be loaded, so the document is not validated with fewer profiles than it declares",
        };
      }
      profiles.push(profile);
    }
  }
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
    const result =
      profiles === undefined ? validateResource(resource) : validateResource(resource, { profiles });
    return {
      ok: true,
      issues: result.issues.map((i) => ({
        severity: String(i.severity),
        location: String(i.expression),
        code: String(i.code),
        ...(i.constraint === undefined ? {} : { constraint: String(i.constraint) }),
      })),
      parseRefused: false,
    };
  } catch (err) {
    return { ok: false, reason: `validateResource threw: ${String(err)}` };
  }
}
