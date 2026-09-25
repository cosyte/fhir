/**
 * The corpus the base-versus-head READ differential runs over, and the reading it takes of one
 * document.
 *
 * Shared by the capture script (`scripts/capture-base-readouts.ts`, which runs it against a base
 * ref) and by the test that asserts head against the captured data, so the two can never come to
 * disagree about what a document is or about what "the reading" means. Both halves import this one
 * file; neither carries its own copy.
 *
 * The corpus is this package's own JSON fixture set plus the documents the modifier-element channel
 * adds, which is what makes the comparison cover the change rather than only the ground it stands
 * on. Everything is a JSON document: the XML read path has its own base-versus-head harness
 * (`scripts/read-differential.ts`), which this does not duplicate.
 *
 * The reading carries the modifier-element reports and the `MedicationRequest.intent` surfacing as
 * well as the location channels, so a report or a surfaced code that moves is compared rather than
 * passed over. A tree whose readout has no such field reads it as empty.
 */

import { readFileSync, readdirSync } from "node:fs";

const FIXTURES = new URL("./__fixtures__/", import.meta.url);

/** One document, named so a difference can be attributed. */
export interface CorpusDocument {
  readonly name: string;
  readonly json: string;
}

/** One modifier-element report, as either tree renders it. */
export interface ModifierReading {
  readonly element: string;
  readonly location: string;
}

/** One surfaced `MedicationRequest.intent`, as either tree renders it. */
export interface IntentReading {
  readonly code: string;
  readonly location: string;
}

/** Everything one tree makes of one document. A throw is a reading too, and a comparable one. */
export interface Readout {
  readonly thrown: string | undefined;
  readonly issues: readonly string[];
  readonly valid: boolean;
  readonly findings: readonly string[];
  readonly resourceType: string | undefined;
  readonly status: string | undefined;
  readonly retracted: boolean;
  readonly noKnownAllergy: boolean;
  readonly negations: readonly string[];
  readonly safeToSummarize: boolean;
  readonly unhandledModifierExtensions: readonly string[];
  readonly modifierElements: readonly ModifierReading[];
  readonly intents: readonly IntentReading[];
  readonly shadowedProperties: readonly string[];
  readonly arrayWrappedScalars: readonly string[];
  readonly nestedArrays: readonly string[];
  readonly droppedText: readonly string[];
  readonly unreadableBooleans: readonly string[];
  readonly nearMissNegationCodes: readonly string[];
  readonly unreadableNegationCodes: readonly string[];
  readonly unreadableIntents: readonly string[];
}

/** The subset of the package surface a reading needs, so base and head are called identically. */
export interface ReadoutCodec {
  parseResource: (text: string) => { resource: unknown; issues: readonly unknown[] };
  validateResource: (resource: unknown) => { valid: boolean; issues: readonly unknown[] };
  readSafety: (resource: unknown) => Record<string, unknown>;
}

/** The documents the modifier-element channel adds to the corpus, one per shape it decides. */
const ADDED: readonly CorpusDocument[] = [
  {
    name: "added:dose-comparator",
    json: '{"resourceType":"MedicationRequest","dosageInstruction":[{"doseAndRate":[{"doseQuantity":{"value":0.01,"comparator":"<","unit":"mg"}}]}]}',
  },
  {
    name: "added:observation-value-comparator",
    json: '{"resourceType":"Observation","status":"final","valueQuantity":{"value":0.01,"comparator":"<","unit":"mg"}}',
  },
  {
    name: "added:two-component-comparators",
    json: '{"resourceType":"Observation","status":"final","component":[{"valueQuantity":{"value":1,"comparator":"<"}},{"valueQuantity":{"value":2,"comparator":">"}}]}',
  },
  {
    name: "added:implicit-rules",
    json: '{"resourceType":"Patient","implicitRules":"http://ehr.example.org/ig/x"}',
  },
  { name: "added:patient-active-false", json: '{"resourceType":"Patient","active":false}' },
  {
    name: "added:patient-active-underscore-only",
    json: '{"resourceType":"Patient","_active":{"extension":[{"url":"http://x","valueCode":"masked"}]}}',
  },
  {
    name: "added:practitioner-identifier-use",
    json: '{"resourceType":"Practitioner","identifier":[{"use":"official","value":"X"}]}',
  },
  {
    name: "added:unmodeled-type-comparator",
    json: '{"resourceType":"Foo","x":{"comparator":"anything"}}',
  },
  { name: "added:standalone-comparator", json: '{"comparator":"<"}' },
  {
    name: "added:bundle-entry-patient-active",
    json: '{"resourceType":"Bundle","type":"collection","entry":[{"resource":{"resourceType":"Patient","active":true}}]}',
  },
  {
    name: "added:modifier-extension-only",
    json: '{"resourceType":"Patient","modifierExtension":[{"url":"http://example.org/x"}]}',
  },
  {
    name: "added:none-of-the-four",
    json: '{"resourceType":"Observation","status":"final","valueQuantity":{"value":0.01,"unit":"mg"}}',
  },
  {
    // The one safety-critical type this corpus had no document of. Without it the base-versus-head
    // allowance covers `DiagnosticReport` and no document ever reaches that half of it, which is
    // the stale allowance the differential's own docblock warns about. `registered ` carries a
    // trailing space, so head reports the lexical fault at the element rather than the resource
    // being unmodeled, and both directions of the allowance are exercised for this type.
    name: "added:diagnosticreport-status-trailing-space",
    json: '{"resourceType":"DiagnosticReport","status":"registered ","code":{"text":"synthetic panel"}}',
  },
  // S0364-fhir-safety-modifier-3: one document per shape the change decides, AC-14.
  {
    name: "added:patient-deceased-boolean-true",
    json: '{"resourceType":"Patient","deceasedBoolean":true}',
  },
  {
    name: "added:patient-deceased-datetime",
    json: '{"resourceType":"Patient","deceasedDateTime":"1970-01-01"}',
  },
  {
    name: "added:patient-link-replaced-by",
    json: '{"resourceType":"Patient","link":[{"other":{"reference":"Patient/p2"},"type":"replaced-by"}]}',
  },
  {
    name: "added:immunization-subpotent-true",
    json: '{"resourceType":"Immunization","status":"completed","isSubpotent":true}',
  },
  {
    name: "added:medicationrequest-intent-proposal",
    json: '{"resourceType":"MedicationRequest","status":"active","intent":"proposal"}',
  },
  {
    name: "added:medicationrequest-intent-out-of-set",
    json: '{"resourceType":"MedicationRequest","status":"active","intent":"draft"}',
  },
];

/**
 * Every document in the corpus: this package's JSON fixtures, in a stable order, then the documents
 * this channel adds.
 */
export function corpus(): CorpusDocument[] {
  const fixtures = readdirSync(FIXTURES)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => ({
      name: `fixture:${file}`,
      json: readFileSync(new URL(file, FIXTURES), "utf8"),
    }));
  return [...fixtures, ...ADDED];
}

/**
 * Render a list of issue-shaped objects as `code/severity at location` strings, sorted.
 *
 * Joined with ` at ` rather than an `@`, and the reason is a gate rather than taste: this package
 * spells a diagnostic `IssueCode@FHIRPath`, which no email recogniser can tell from an address by
 * shape, and these strings are COMMITTED as expectation data. Not writing the shape keeps the PHI
 * gate's declared-domain list from growing one entry per FHIRPath root in the corpus.
 */
function issueStrings(issues: readonly unknown[]): string[] {
  return issues
    .map((issue) => {
      const record = issue as { code?: unknown; severity?: unknown; expression?: unknown };
      return `${String(record.code)}/${String(record.severity)} at ${String(record.expression)}`;
    })
    .sort();
}

/** A convenience field's value as text, or `undefined`. Both are `string | undefined` on both trees. */
function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Read one string list off a safety readout, whatever tree produced it. */
function locations(readout: Record<string, unknown>, channel: string): string[] {
  const value = readout[channel];
  return Array.isArray(value) ? value.map((entry) => String(entry)) : [];
}

/**
 * Read one list of `{<key>, location}` records off a safety readout, whatever tree produced it,
 * keeping the two fields and nothing else so the captured data holds exactly what is compared.
 */
function records(
  readout: Record<string, unknown>,
  channel: string,
  key: "element" | "code",
): { readonly key: string; readonly location: string }[] {
  const value: unknown = readout[channel];
  if (!Array.isArray(value)) return [];
  return value.map((entry: unknown) => {
    const record = (typeof entry === "object" && entry !== null ? entry : {}) as Record<
      string,
      unknown
    >;
    return { key: String(record[key]), location: String(record["location"]) };
  });
}

/**
 * What one tree makes of one document. Deliberately reads the readout through an index signature:
 * base does not have every channel head does, and a missing one must read as empty rather than
 * throw.
 */
export function readDocument(codec: ReadoutCodec, json: string): Readout {
  try {
    const { resource, issues } = codec.parseResource(json);
    const validation = codec.validateResource(resource);
    const safety = codec.readSafety(resource);
    return {
      thrown: undefined,
      issues: issueStrings(issues),
      valid: validation.valid,
      findings: issueStrings(validation.issues),
      resourceType: text(safety["resourceType"]),
      status: text(safety["status"]),
      retracted: safety["retracted"] === true,
      noKnownAllergy: safety["noKnownAllergy"] === true,
      negations: locations(safety, "negations").sort(),
      safeToSummarize: safety["safeToSummarize"] === true,
      unhandledModifierExtensions: locations(safety, "unhandledModifierExtensions"),
      modifierElements: records(safety, "modifierElements", "element").map((record) => ({
        element: record.key,
        location: record.location,
      })),
      intents: records(safety, "intents", "code").map((record) => ({
        code: record.key,
        location: record.location,
      })),
      shadowedProperties: locations(safety, "shadowedProperties"),
      arrayWrappedScalars: locations(safety, "arrayWrappedScalars"),
      nestedArrays: locations(safety, "nestedArrays"),
      droppedText: locations(safety, "droppedText"),
      unreadableBooleans: locations(safety, "unreadableBooleans"),
      nearMissNegationCodes: locations(safety, "nearMissNegationCodes"),
      unreadableNegationCodes: locations(safety, "unreadableNegationCodes"),
      unreadableIntents: locations(safety, "unreadableIntents"),
    };
  } catch (error) {
    return {
      thrown:
        error instanceof Error
          ? `${error.name}: ${(error as { code?: string }).code ?? ""}`
          : "unknown",
      issues: [],
      valid: false,
      findings: [],
      resourceType: undefined,
      status: undefined,
      retracted: false,
      noKnownAllergy: false,
      negations: [],
      safeToSummarize: false,
      unhandledModifierExtensions: [],
      modifierElements: [],
      intents: [],
      shadowedProperties: [],
      arrayWrappedScalars: [],
      nestedArrays: [],
      droppedText: [],
      unreadableBooleans: [],
      nearMissNegationCodes: [],
      unreadableNegationCodes: [],
      unreadableIntents: [],
    };
  }
}
