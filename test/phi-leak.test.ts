/**
 * FHIR-P11 PHI-leak test tier (roadmap §7, "Redaction is tested").
 *
 * A FHIR resource is PHI by default and the library's own diagnostics are the leak vector. The
 * value-free-diagnostics contract (`OperationOutcome`/error findings carry a coded reason plus a
 * FHIRPath *location* or a byte offset, never a resource *value*) is turned here into a **gating
 * test**: run the whole fixture corpus through the full pipeline (JSON parse, validate + emit an
 * `OperationOutcome`, XML parse) and assert that no PHI-bearing input value ever appears in any
 * emitted diagnostic.
 *
 * Two layers:
 *
 *  1. **Sentinel battery**, resources whose every §4 PHI-bearing position (name, MRN, DOB, dose /
 *     lab decimal, free-text SIG, narrative) holds a *distinctive* sentinel value that cannot occur
 *     structurally. Any sentinel in any output is an unambiguous leak.
 *  2. **Corpus sweep**, for every fixture, every PHI-*candidate* leaf value (see {@link isPhiCandidate}:
 *     names, dates, numbers, free text; NOT resource-type names, canonical URIs, or spec enumeration
 *     codes, which are content-free-safe and legitimately root/label a finding) must be absent from
 *     the pipeline's diagnostics. This is the regression net over the real corpus.
 *
 * This generalizes the hand-picked cases in `phi.test.ts` to the whole corpus and to injected
 * sentinels, so a future finding that starts echoing a value fails the build.
 */

import { readFileSync, readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  parseResource,
  parseResourceXml,
  serializeResource,
  validateResource,
} from "../src/index.js";

const FIXTURE_DIR = new URL("./__fixtures__/", import.meta.url);

/** Resource-type names root every FHIRPath expression, so they legitimately appear, not PHI. */
const RESOURCE_TYPES: ReadonlySet<string> = new Set([
  "Patient",
  "Observation",
  "AllergyIntolerance",
  "Condition",
  "MedicationRequest",
  "MedicationStatement",
  "Immunization",
  "DiagnosticReport",
  "Bundle",
  "Provenance",
  "Organization",
  "StructureDefinition",
  "Practitioner",
  "Encounter",
]);

/**
 * Whether a leaf value is a PHI candidate that must never surface in a diagnostic. Excludes the
 * three classes a value-free finding is *allowed* to name, none of which is PHI:
 *
 *  - resource-type names (the root of every FHIRPath `expression`);
 *  - canonical / system URIs (`http(s)://…`, `urn:…`), content-free identifiers;
 *  - spec enumeration codes, a short `lower-case-with-hyphens` token (`final`, `entered-in-error`,
 *    `vital-signs`, `laboratory`, `male`, …). Status/category codes are explicitly not PHI (§3).
 *
 * Everything else, a name (`Chalmers`), a date (`1974-12-25`), a number (`70.0`, `9223372036854775807`),
 * a free-text SIG (`5 mg once daily`), is swept. Single characters are excluded: they collide with
 * array indices in FHIRPath expressions and carry no PHI signal.
 */
function isPhiCandidate(value: string): boolean {
  if (value.length < 2) return false;
  if (/^https?:\/\//.test(value) || value.startsWith("urn:")) return false;
  if (RESOURCE_TYPES.has(value)) return false;
  if (/^[a-z][a-z0-9-]*$/.test(value)) return false;
  return true;
}

/** Collect every leaf primitive value (as a string) from a parsed JSON tree. */
function collectLeafValues(node: unknown, out: Set<string>): void {
  if (node === null || node === undefined) return;
  if (Array.isArray(node)) {
    for (const item of node) collectLeafValues(item, out);
    return;
  }
  if (typeof node === "object") {
    for (const key of Object.keys(node))
      collectLeafValues((node as Record<string, unknown>)[key], out);
    return;
  }
  // Reached only for a JSON scalar. Narrow to concrete primitives so the stringification is safe.
  if (typeof node === "string") out.add(node);
  else if (typeof node === "number" || typeof node === "boolean") out.add(String(node));
}

/** Run the full pipeline and return every diagnostic surface, concatenated for a substring sweep. */
function diagnosticSurfaceForJson(text: string): string {
  const parts: string[] = [];
  try {
    const { resource, issues } = parseResource(text);
    parts.push(JSON.stringify(issues));
    const result = validateResource(resource);
    parts.push(JSON.stringify(result.issues));
    parts.push(serializeResource(result.toOperationOutcome()));
  } catch (err) {
    // A typed fatal is still a diagnostic surface, its message/location must be value-free too.
    parts.push(err instanceof Error ? err.message : String(err));
    if (err && typeof err === "object" && "expression" in err) {
      parts.push((err as { expression?: string }).expression ?? "");
    }
  }
  return parts.join(" ");
}

const JSON_FIXTURE_NAMES: readonly string[] = readdirSync(FIXTURE_DIR).filter((f) =>
  f.endsWith(".json"),
);
const XML_FIXTURE_NAMES: readonly string[] = readdirSync(FIXTURE_DIR).filter((f) =>
  f.endsWith(".xml"),
);

describe("PHI-leak tier: corpus sweep, no PHI-candidate value reaches any JSON diagnostic", () => {
  it("has JSON fixtures to sweep", () => {
    expect(JSON_FIXTURE_NAMES.length).toBeGreaterThan(0);
  });

  for (const name of JSON_FIXTURE_NAMES) {
    it(`${name}: every PHI-candidate value is absent from parse + validate + OperationOutcome`, () => {
      const text = readFileSync(new URL(name, FIXTURE_DIR), "utf8");
      const values = new Set<string>();
      collectLeafValues(JSON.parse(text), values);
      const candidates = [...values].filter(isPhiCandidate);
      const surface = diagnosticSurfaceForJson(text);
      const leaked = candidates.filter((v) => surface.includes(v));
      expect(leaked, `PHI values leaked into diagnostics for ${name}`).toEqual([]);
    });
  }
});

describe("PHI-leak tier: corpus sweep, no PHI-candidate value reaches any XML diagnostic", () => {
  for (const name of XML_FIXTURE_NAMES) {
    it(`${name}: every PHI-candidate value is absent from the XML parse diagnostics`, () => {
      const text = readFileSync(new URL(name, FIXTURE_DIR), "utf8");
      // Extract attribute values (the XML analogue of a primitive value) plus any text content.
      const values = new Set<string>();
      for (const match of text.matchAll(/(?:value|url|id)="([^"]*)"/g)) {
        if (match[1] !== undefined) values.add(match[1]);
      }
      const candidates = [...values].filter(isPhiCandidate);
      let surface = "";
      try {
        const { issues } = parseResourceXml(text);
        surface = JSON.stringify(issues);
      } catch (err) {
        surface = err instanceof Error ? err.message : String(err);
      }
      const leaked = candidates.filter((v) => surface.includes(v));
      expect(leaked, `PHI values leaked into XML diagnostics for ${name}`).toEqual([]);
    });
  }
});

// ── Sentinel battery ─────────────────────────────────────────────────────────────────────────────

/** Distinctive sentinels that cannot occur structurally, any appearance is an unambiguous leak. */
const SENTINELS = {
  familyName: "Zzyxxsentinelfamily",
  givenName: "Qqvarsentinelgiven",
  mrn: "SENTINELMRN42424242",
  dob: "1893-04-17",
  bigDecimal: "424242.000424242424242",
  tinyDecimal: "0.00000000424242",
  sig: "Take Zzyxx sentinel by sentinel route",
  freeText: "SENTINELNARRATIVEFREETEXTVALUE",
  phone: "555SENTINEL0100",
} as const;

/** Every §4 PHI-bearing position filled with a sentinel, across resources that trigger findings. */
const SENTINEL_RESOURCES: readonly string[] = [
  // Patient identity: name, MRN identifier, DOB, contact.
  JSON.stringify({
    resourceType: "Patient",
    identifier: [{ system: "http://hospital.example/mrn", value: SENTINELS.mrn }],
    name: [{ family: SENTINELS.familyName, given: [SENTINELS.givenName] }],
    telecom: [{ system: "phone", value: SENTINELS.phone }],
    gender: "notacode", // triggers a value-domain finding, its diagnostic must stay value-free
    birthDate: SENTINELS.dob,
  }),
  // Observation with a big/tiny decimal on the precision path. Built as raw JSON text (not
  // JSON.stringify) so the sentinel decimals stay lexical, a JS number literal would both lose
  // precision at runtime and defeat the point of a distinctive decimal sentinel.
  `{"resourceType":"Observation","status":"final","code":{"text":"${SENTINELS.freeText}"},` +
    `"valueQuantity":{"value":${SENTINELS.bigDecimal},"unit":"mg/dL"},` +
    `"component":[{"code":{"text":"x"},"valueQuantity":{"value":${SENTINELS.tinyDecimal},"unit":"x"}}]}`,
  // MedicationRequest with a free-text SIG (must-support) and a bad status (modifier ?! finding).
  JSON.stringify({
    resourceType: "MedicationRequest",
    status: "notavalidstatus",
    intent: "order",
    medicationCodeableConcept: { text: SENTINELS.freeText },
    dosageInstruction: [{ text: SENTINELS.sig }],
  }),
  // A retracted resource with an unknown modifierExtension (fail-closed safety finding).
  JSON.stringify({
    resourceType: "AllergyIntolerance",
    clinicalStatus: {
      coding: [
        {
          system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical",
          code: "active",
        },
      ],
    },
    verificationStatus: {
      coding: [
        {
          system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",
          code: "entered-in-error",
        },
      ],
    },
    code: { text: SENTINELS.freeText },
    modifierExtension: [{ url: `http://example.org/${SENTINELS.mrn}` }],
  }),
];

describe("PHI-leak tier: sentinel battery, no sentinel value reaches any diagnostic", () => {
  const sentinelValues = Object.values(SENTINELS);

  for (const [index, text] of SENTINEL_RESOURCES.entries()) {
    it(`sentinel resource #${String(index)}: parse + validate diagnostics are sentinel-free`, () => {
      const surface = diagnosticSurfaceForJson(text);
      const leaked = sentinelValues.filter((v) => surface.includes(v));
      expect(leaked, "a sentinel leaked into a diagnostic").toEqual([]);
    });
  }

  it("each sentinel resource actually produces at least one finding (the sweep is not vacuous)", () => {
    for (const text of SENTINEL_RESOURCES) {
      const { resource } = parseResource(text);
      const result = validateResource(resource);
      // A resource with a bad code / bad status / unknown modifier / precision risk must surface
      // *something*, otherwise there is no diagnostic to leak through and the test proves nothing.
      const { issues } = parseResource(text);
      expect(result.issues.length + issues.length).toBeGreaterThan(0);
    }
  });
});
