/**
 * FHIR-P10b — Tier-2 real-world quirk corpus (roadmap §3 "cross-vendor quirks that bite", Phase 10).
 *
 * This is the **tier-(b) real-world-quirk** corpus of the three-tier conformance strategy (roadmap
 * §6): resources that are shaped the way real US production FHIR is shaped — not the clean spec
 * examples of tier (a) — and that a naive consumer mis-handles. Each fixture asserts the exact
 * value-free issue set `@cosyte/fhir` produces, so a regression that starts dropping an extension,
 * coercing a decimal, or rejecting a tolerable quirk fails the build.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────────
 * GROUNDING (ADR 0018 — public conformance resources unblock the parsers)
 * ─────────────────────────────────────────────────────────────────────────────────────────────────
 * The anti-invention safety rule stands: a quirk is encoded **only when a real document grounds it**.
 * ADR 0018 makes explicit that "real document" includes **publicly available real artifacts** — FHIR
 * published examples, the spec's own normative rules, US Core, and documented public interop defects
 * — not only privately-supplied de-identified vendor feeds. Every fixture below cites its public
 * source in {@link QUIRK_CORPUS}. **Values are synthetic** (`Synth*`, `syn-*`, `example.org`) so the
 * PHI-leak sweep over `__fixtures__` is meaningful; the quirk *shape* is what the public source grounds.
 *
 * A genuinely vendor-*proprietary* deviation that appears in **no** public sample (a named Epic/Cerner/
 * athena quirk that is not publicly documented) stays **grounded-only** and is deliberately absent —
 * inventing one is forbidden (conventions §PHI, ADR 0018). Two roadmap-§3 quirks — *missing
 * must-support* (`MUST_SUPPORT_ABSENT`, info-never-error) and *US Core version drift*
 * (`PROFILE_VERSION_MISMATCH`) — are already exercised by the Phase-6 profile suite
 * (`validate-profile.test.ts`, `profiles-coverage.test.ts`); this corpus targets the read-path /
 * codec / Bundle quirks those profile tests do not reach.
 *
 * The differential half of P10b — running this same corpus through the JVM `validator_cli.jar` oracle
 * — lives in `scripts/differential.mjs` (the `QUIRK_CORPUS` list) and its CI `differential` job. That
 * gate needs a JVM + the jar and so is **CI-only, not observed green in the dev container** (roadmap §6).
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  FATAL_CODES,
  FhirCodecError,
  ISSUE_CODES,
  parseResource,
  resourceType,
  serializeResource,
  validateResource,
} from "../src/index.js";

function fixture(name: string): string {
  return readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");
}

/**
 * The Tier-2 quirk corpus. Each entry is a fixture + the **public source that grounds the quirk** +
 * a one-line statement of the interop hazard it reproduces. This array is the corpus's provenance
 * record (ADR 0018): every quirk traces to a citable public artifact, none is invented.
 */
const QUIRK_CORPUS = [
  {
    file: "quirk-resourcetype-last.json",
    quirk: "resourceType is not the first property",
    // FHIR R4 json.html: JSON property order is not significant; `resourceType` may appear in any
    // position. A streaming consumer that assumes it comes first breaks — the reader must not.
    source:
      "FHIR R4 json.html (property order is not significant; resourceType may be in any order)",
  },
  {
    file: "quirk-scientific-decimal.json",
    quirk: "a decimal in scientific/exponent notation with significant trailing-zero precision",
    // FHIR R4 datatypes.html decimal regex is `-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?` —
    // exponent notation is VALID FHIR. Synthea historically emitted such values (synthetichealth/
    // synthea #675); a naive `JSON.parse` coerces `1.0e2` to the number `100`, destroying the
    // recorded precision. The codec must read it as a valid decimal and preserve it byte-for-byte.
    source:
      "FHIR R4 datatypes.html (decimal regex permits an exponent) + Synthea #675 (scientific-notation decimals)",
  },
  {
    file: "quirk-primitive-extension-misaligned.json",
    quirk: "a repeating primitive's `_`-sibling array length disagrees with the value array",
    // FHIR R4 json.html: a repeating primitive and its `_`-sibling metadata array are index-aligned
    // with `null` padding. A length mismatch means an extension cannot be attributed to a value.
    // This is the single most error-prone part of a FHIR codec (HAPI FHIR #5738). The reader must
    // FAIL CLOSED rather than guess — guessing could bind metadata to the wrong clinical value.
    source: "FHIR R4 json.html (null-padded primitive-extension alignment) + HAPI FHIR #5738",
  },
  {
    file: "quirk-searchset-paging.json",
    quirk: "a searchset Bundle whose results continue via `link[relation=next]`",
    // FHIR R4 bundle-example.json models a searchset with `link` self + next. Epic/Cerner both
    // require a consumer to follow `Bundle.link[next]` to retrieve all results (roadmap §3). The
    // paging link is not a modeled leaf here but MUST survive the round-trip — dropping it silently
    // truncates a patient's record.
    source:
      "FHIR R4 bundle-example.json (searchset self/next link) + roadmap §3 (mandatory pagination)",
  },
  {
    file: "quirk-uscore-extensions.json",
    quirk: "standard extensions on a standard resource (US Core race + birthsex)",
    // US Core defines the us-core-race (complex, ombCategory + text) and us-core-birthsex extensions;
    // the race example uses OMB code 2106-3 "White" verbatim. A vendor puts these on a base Patient.
    // The library does not specially model them — it must preserve them (and every sub-extension)
    // through the round-trip, never dropped (roadmap §10 fail-safe: extensions preserved).
    source: "US Core StructureDefinition/us-core-race + us-core-birthsex (OMB race code 2106-3)",
  },
] as const;

describe("Tier-2 quirk corpus — provenance", () => {
  it("every quirk fixture cites a public source that grounds it (ADR 0018, no invented quirks)", () => {
    for (const entry of QUIRK_CORPUS) {
      expect(entry.source.length, `${entry.file} must cite its grounding source`).toBeGreaterThan(
        20,
      );
    }
  });
});

describe("Tier-2 quirk: resourceType is not the first property (json.html)", () => {
  it("reads clean and resolves the resource type regardless of property position", () => {
    const { resource, issues } = parseResource(fixture("quirk-resourcetype-last.json"));
    expect(issues).toEqual([]);
    expect(resourceType(resource)).toBe("Patient");
    // Structural + safety validation is clean — a mis-positioned resourceType is a non-issue.
    const result = validateResource(resource);
    expect(result.issues.filter((i) => i.severity === "error" || i.severity === "fatal")).toEqual(
      [],
    );
  });

  it("emits spec-clean FHIR with resourceType restored to the front (strict emit)", () => {
    const { resource } = parseResource(fixture("quirk-resourcetype-last.json"));
    const out = serializeResource(resource);
    expect(out.startsWith('{"resourceType":"Patient"')).toBe(true);
  });
});

describe("Tier-2 quirk: scientific-notation decimal (Synthea #675 / datatypes.html)", () => {
  const text = fixture("quirk-scientific-decimal.json");

  it("reads the exponent-notation value as a valid decimal, flagging the precision risk only", () => {
    const { resource, issues } = parseResource(text);
    // The only finding is the informational precision guard — never an error. `1.0e2` is a VALID
    // R4 decimal; a naive JSON.parse would coerce it to `100` and destroy the recorded precision.
    expect(issues).toEqual([
      {
        code: ISSUE_CODES.DECIMAL_PRECISION_AT_RISK,
        severity: "information",
        expression: "Observation.valueQuantity.value",
      },
    ]);
    const result = validateResource(resource);
    expect(result.issues.filter((i) => i.severity === "error" || i.severity === "fatal")).toEqual(
      [],
    );
  });

  it("preserves the exponent lexical form byte-for-byte (never coerced through a JS number)", () => {
    const { resource } = parseResource(text);
    expect(serializeResource(resource)).toContain('"value":1.0e2');
  });
});

describe("Tier-2 quirk: primitive-extension `_`-sibling misalignment (HAPI #5738 / json.html)", () => {
  it("FAILS CLOSED — throws a typed, value-free fatal rather than guessing the alignment", () => {
    let thrown: unknown;
    try {
      parseResource(fixture("quirk-primitive-extension-misaligned.json"));
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(FhirCodecError);
    const err = thrown as FhirCodecError;
    expect(err.code).toBe(FATAL_CODES.PRIMITIVE_EXTENSION_MISALIGNED);
    // Value-free: the location is a FHIRPath, and no `given` value appears in the message.
    expect(err.expression).toBe("Patient.name[0].given");
    expect(err.message).not.toContain("Synthgiven");
    expect(err.message).not.toContain("Synthmiddle");
  });
});

describe("Tier-2 quirk: searchset Bundle pagination link (bundle-example.json)", () => {
  const text = fixture("quirk-searchset-paging.json");

  it("reads clean and never errors on a paged searchset", () => {
    const { resource, issues } = parseResource(text);
    expect(issues).toEqual([]);
    expect(resourceType(resource)).toBe("Bundle");
    const result = validateResource(resource);
    expect(result.issues.filter((i) => i.severity === "error" || i.severity === "fatal")).toEqual(
      [],
    );
  });

  it("preserves the `next` paging link through the round-trip (never truncates the record)", () => {
    const { resource } = parseResource(text);
    const out = serializeResource(resource);
    expect(out).toContain('"relation":"next"');
    expect(out).toContain("page=2");
  });
});

describe("Tier-2 quirk: US Core race + birthsex extensions on a base Patient", () => {
  const text = fixture("quirk-uscore-extensions.json");

  it("reads clean — standard extensions on a standard resource are not an error", () => {
    const { resource, issues } = parseResource(text);
    expect(issues).toEqual([]);
    const result = validateResource(resource);
    expect(result.issues.filter((i) => i.severity === "error" || i.severity === "fatal")).toEqual(
      [],
    );
  });

  it("preserves every extension and sub-extension through the round-trip (never dropped)", () => {
    const { resource } = parseResource(text);
    const out = serializeResource(resource);
    expect(out).toContain("us-core-race");
    expect(out).toContain("us-core-birthsex");
    // The nested race sub-extension (ombCategory → OMB code) survives too.
    expect(out).toContain("2106-3");
    // Byte-for-byte round-trip (the input is already spec-clean, canonically ordered).
    expect(out).toBe(JSON.stringify(JSON.parse(text)));
  });
});
